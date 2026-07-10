// server/lib/groqPool.js
// ─────────────────────────────────────────────────────────────────────────────
// Multi-key Groq pool — rotation, cooldown and failover across several API
// keys so simultaneous users never stall on a single key's rate limit.
//
// Keys are read from (all optional, merged, de-duplicated):
//   GROQ_API_KEYS   = "gsk_a,gsk_b,gsk_c"     ← preferred, comma/space separated
//   GROQ_API_KEY    = "gsk_a"                  ← legacy single key
//   GROQ_API_KEY_1..GROQ_API_KEY_9             ← numbered keys
//
// Selection: round-robin over keys that are not cooling down. A key is put on
// cooldown when Groq answers 429 (for the hinted wait time) and disabled for
// an hour on 401/403 (invalid/revoked). If every key is cooling down we wait
// for the soonest one rather than failing the request.
// ─────────────────────────────────────────────────────────────────────────────

import Groq from "groq-sdk";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readKeys() {
  const raw = [];
  if (process.env.GROQ_API_KEYS) raw.push(...process.env.GROQ_API_KEYS.split(/[\s,;]+/));
  if (process.env.GROQ_API_KEY) raw.push(process.env.GROQ_API_KEY);
  for (let i = 1; i <= 9; i++) {
    if (process.env[`GROQ_API_KEY_${i}`]) raw.push(process.env[`GROQ_API_KEY_${i}`]);
  }
  return [...new Set(raw.map((k) => k.trim()).filter(Boolean))];
}

let _pool = null; // [{ key, client, cooldownUntil, uses, rateLimits, disabled }]
let _cursor = 0;

function pool() {
  if (!_pool) {
    _pool = readKeys().map((key, i) => ({
      key,
      label: `key#${i + 1}`,
      client: new Groq({ apiKey: key }),
      cooldownUntil: 0,
      uses: 0,
      rateLimits: 0,
    }));
  }
  return _pool;
}

/** True when at least one Groq key is configured. */
export function poolAvailable() {
  return pool().length > 0;
}

/** Diagnostics — never exposes the key material itself. */
export function poolStatus() {
  const now = Date.now();
  return pool().map((e) => ({
    label: e.label,
    coolingDownMs: Math.max(0, e.cooldownUntil - now),
    uses: e.uses,
    rateLimits: e.rateLimits,
  }));
}

/** Next usable pool entry (round-robin, skipping cooldowns), or the one that
 *  frees up soonest when everything is cooling down. Null when no keys. */
function nextEntry() {
  const entries = pool();
  if (!entries.length) return null;
  const now = Date.now();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[(_cursor + i) % entries.length];
    if (e.cooldownUntil <= now) {
      _cursor = (_cursor + i + 1) % entries.length;
      return e;
    }
  }
  return entries.reduce((a, b) => (a.cooldownUntil <= b.cooldownUntil ? a : b));
}

/** Legacy-compatible accessor: a ready Groq client, or null when unconfigured.
 *  Each call may hand out a different key, which spreads load per request. */
export function getPooledGroq() {
  const e = nextEntry();
  return e ? e.client : null;
}

function cooldownFromError(err) {
  const status = err?.status || err?.response?.status;
  if (status === 401 || status === 403) return 60 * 60 * 1000; // bad key — bench it
  const secs = parseFloat(String(err?.message || "").match(/in\s+([\d.]+)s/)?.[1] || "8");
  return Math.min(secs * 1000 + 500, 60_000);
}

/**
 * Chat completion with model fallback AND key rotation.
 * Signature is a superset of the old aiBuilderController.callGroq:
 *   callGroqPool(messages, maxOut, models, opts?)
 * opts: { temperature, responseFormat, retriesPerModel }
 */
export async function callGroqPool(messages, maxOut, models, opts = {}) {
  const entries = pool();
  if (!entries.length) {
    const e = new Error("AI not configured");
    e.statusCode = 503;
    throw e;
  }

  const { temperature = 0.4, responseFormat = null } = opts;
  let lastErr;

  for (const model of models) {
    // Try up to one attempt per key for this model before falling back.
    for (let k = 0; k < entries.length; k++) {
      const entry = nextEntry();
      const now = Date.now();
      if (entry.cooldownUntil > now) {
        // Everything is cooling down — wait for the soonest key (capped).
        await sleep(Math.min(entry.cooldownUntil - now, 9000));
      }
      try {
        entry.uses++;
        const completion = await entry.client.chat.completions.create({
          model: model.id,
          temperature,
          max_tokens: maxOut || model.maxOut,
          stream: false,
          ...(responseFormat ? { response_format: responseFormat } : {}),
          messages,
        });
        return {
          text: completion?.choices?.[0]?.message?.content || "",
          model: model.label,
          keyLabel: entry.label,
        };
      } catch (err) {
        lastErr = err;
        const status = err?.status || err?.response?.status;
        if (status === 429 || status === 401 || status === 403) {
          entry.rateLimits += status === 429 ? 1 : 0;
          entry.cooldownUntil = Date.now() + cooldownFromError(err);
          continue; // another key, same model
        }
        break; // model-level problem (400/404/5xx) — fall back to next model
      }
    }
  }
  throw lastErr || new Error("AI generation failed.");
}
