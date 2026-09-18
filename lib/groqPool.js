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
import { recordAi } from "./monitor.js";

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

// Groq rate limits are per key AND per model, so cooldowns are tracked per
// (key, model); a revoked key (401/403) is benched for every model via "*".
let _pool = null; // [{ key, label, client, cooldowns: Map<modelId|"*", until>, uses, rateLimits }]
let _cursor = 0;
const retiredModels = new Map(); // modelId → skip until (ms)

function pool() {
  if (!_pool) {
    _pool = readKeys().map((key, i) => ({
      key,
      label: `key#${i + 1}`,
      client: new Groq({ apiKey: key }),
      cooldowns: new Map(),
      uses: 0,
      rateLimits: 0,
    }));
  }
  return _pool;
}

const readyAt = (entry, modelId) => Math.max(entry.cooldowns.get("*") || 0, modelId ? entry.cooldowns.get(modelId) || 0 : 0);

/** True when at least one Groq key is configured. */
export function poolAvailable() {
  return pool().length > 0;
}

/** Models skipped because Groq reported them missing/retired. */
export function retiredModelIds() {
  const now = Date.now();
  return [...retiredModels.entries()].filter(([, until]) => until > now).map(([id, until]) => ({ id, until: new Date(until) }));
}

/** Diagnostics — never exposes the key material itself. */
export function poolStatus() {
  const now = Date.now();
  return pool().map((e) => ({
    label: e.label,
    cooldowns: Object.fromEntries([...e.cooldowns].map(([m, until]) => [m, Math.max(0, until - now)])),
    uses: e.uses,
    rateLimits: e.rateLimits,
  }));
}

/** Next usable entry for a model (round-robin, skipping cooldowns), or the one
 *  that frees up soonest when every key is cooling down. Null when no keys. */
function nextEntry(modelId) {
  const entries = pool();
  if (!entries.length) return null;
  const now = Date.now();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[(_cursor + i) % entries.length];
    if (readyAt(e, modelId) <= now) {
      _cursor = (_cursor + i + 1) % entries.length;
      return e;
    }
  }
  return entries.reduce((a, b) => (readyAt(a, modelId) <= readyAt(b, modelId) ? a : b));
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
  // Groq phrases waits as "try again in 8.2s", "in 7m12.5s" or "in 1h2m3s".
  const m = String(err?.message || "").match(/in\s+(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/);
  const secs = m && (m[1] || m[2] || m[3])
    ? (Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0)
    : 8;
  // Daily-quota waits can be hours; honour them (capped) instead of hammering the key.
  return Math.min(secs * 1000 + 500, 6 * 60 * 60 * 1000);
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
    if ((retiredModels.get(model.id) || 0) > Date.now()) continue;
    // Try up to one attempt per key for this model before falling back.
    for (let k = 0; k < entries.length; k++) {
      const entry = nextEntry(model.id);
      const wait = readyAt(entry, model.id) - Date.now();
      if (wait > 0) {
        // Every key is cooling down for this model. Short waits are worth
        // sitting out; long (quota) waits mean fall back to the next model.
        if (wait > 9000) break;
        await sleep(wait);
      }
      const t0 = Date.now();
      try {
        entry.uses++;
        const completion = await entry.client.chat.completions.create({
          model: model.id,
          temperature,
          max_tokens: maxOut || model.maxOut,
          stream: false,
          ...(responseFormat ? { response_format: responseFormat } : {}),
          ...(model.extra || {}),
          messages,
        });
        recordAi({ model: model.id, ok: true, ms: Date.now() - t0, feature: opts.feature, finishReason: completion?.choices?.[0]?.finish_reason });
        return {
          text: completion?.choices?.[0]?.message?.content || "",
          finishReason: completion?.choices?.[0]?.finish_reason || null,
          model: model.label,
          keyLabel: entry.label,
        };
      } catch (err) {
        lastErr = err;
        const status = err?.status || err?.response?.status;
        recordAi({ model: model.id, ok: false, ms: Date.now() - t0, feature: opts.feature, error: `${status || ""} ${err?.message || err}`.trim() });
        if (status === 429 || status === 401 || status === 403) {
          entry.rateLimits += status === 429 ? 1 : 0;
          entry.cooldowns.set(status === 429 ? model.id : "*", Date.now() + cooldownFromError(err));
          continue; // another key, same model
        }
        // Retired / unknown model: stop trying it for an hour (Groq retires ids regularly).
        if (status === 404 || /model_not_found|decommissioned/i.test(String(err?.message || ""))) {
          retiredModels.set(model.id, Date.now() + 60 * 60 * 1000);
          console.warn(`[groq] model ${model.id} unavailable; skipping it for 1h. Update GROQ_TEXT_MODELS if this persists.`);
        }
        break; // model-level problem (400/404/5xx) — fall back to next model
      }
    }
  }
  throw lastErr || new Error("AI generation failed.");
}
