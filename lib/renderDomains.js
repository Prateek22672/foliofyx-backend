// server/lib/renderDomains.js
// ─────────────────────────────────────────────────────────────────────────────
// Thin client for Render's custom-domain API. Render only routes traffic and
// issues Let's Encrypt certificates for domains that are ADDED to the service,
// so a user's domain must be registered here once its DNS points at us.
//
//   POST   /v1/services/{serviceId}/custom-domains                 { name } → 201 [domain…]
//   GET    /v1/services/{serviceId}/custom-domains/{nameOrId}      → 200 domain | 404
//   POST   /v1/services/{serviceId}/custom-domains/{nameOrId}/verify → 202
//   DELETE /v1/services/{serviceId}/custom-domains/{nameOrId}      → 204 | 404
//
// Env-gated (RENDER_API_KEY + RENDER_SERVICE_ID) and fail-soft: every failure
// becomes a RenderDomainError with a human-readable `userMessage`; raw fetch
// errors never reach users.
// ─────────────────────────────────────────────────────────────────────────────

import { cfg } from "./siteConfig.js";

const API_BASE = "https://api.render.com/v1";
const TIMEOUT_MS = 10_000;

export class RenderDomainError extends Error {
  constructor(message, { status = 0, code = "RENDER_ERROR", retryable = false, userMessage, detail } = {}) {
    super(message);
    this.name = "RenderDomainError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.detail = detail || "";
    this.userMessage =
      userMessage ||
      "DNS looks good, but we couldn't activate the domain on our hosting yet. We'll retry automatically.";
  }
}

export function isConfigured() {
  return Boolean(cfg.RENDER_API_KEY && cfg.RENDER_SERVICE_ID);
}

function normalizeDomain(d) {
  if (!d || typeof d !== "object") return null;
  return {
    id: d.id || "",
    name: d.name || "",
    domainType: d.domainType || "",
    verificationStatus: d.verificationStatus || "unverified",
    redirectForName: d.redirectForName || "",
    createdAt: d.createdAt || null,
  };
}

async function call(method, path, body) {
  if (!isConfigured()) {
    throw new RenderDomainError("Render API is not configured", {
      code: "RENDER_NOT_CONFIGURED",
      userMessage: "Domain activation isn't configured on the server yet.",
    });
  }
  const url = `${API_BASE}/services/${encodeURIComponent(cfg.RENDER_SERVICE_ID)}${path}`;
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${cfg.RENDER_API_KEY}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timeout = err?.name === "TimeoutError" || err?.name === "AbortError";
    throw new RenderDomainError(`Render API ${method} ${path} failed: ${err?.message || err}`, {
      code: timeout ? "RENDER_TIMEOUT" : "RENDER_UNREACHABLE",
      retryable: true,
    });
  }
  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

function toError(action, { status, data }) {
  const detail = (data && (data.message || data.error)) || "";
  const msg = `Render API ${action} → HTTP ${status}${detail ? `: ${detail}` : ""}`;
  switch (true) {
    case status === 401 || status === 403:
      return new RenderDomainError(msg, { status, code: "RENDER_AUTH", detail });
    case status === 402:
      return new RenderDomainError(msg, {
        status,
        code: "RENDER_PAYMENT_REQUIRED",
        detail,
        userMessage:
          "DNS looks good, but our hosting plan's custom-domain limit was reached. We've been notified and will retry automatically.",
      });
    case status === 404:
      return new RenderDomainError(msg, { status, code: "RENDER_NOT_FOUND", detail });
    case status === 429:
      return new RenderDomainError(msg, { status, code: "RENDER_RATE_LIMITED", retryable: true, detail });
    case status === 400 || status === 409 || status === 422:
      return new RenderDomainError(msg, {
        status,
        code: "RENDER_REJECTED",
        detail,
        userMessage: detail
          ? `Our hosting provider rejected this domain: ${String(detail).slice(0, 200)}`
          : "Our hosting provider rejected this domain. Check the spelling and try again.",
      });
    default:
      return new RenderDomainError(msg, { status, code: "RENDER_UNAVAILABLE", retryable: true, detail });
  }
}

/** Fetch one custom domain by name (or id). Returns null when it isn't added. */
export async function getDomain(name) {
  const r = await call("GET", `/custom-domains/${encodeURIComponent(name)}`);
  if (r.status === 404) return null;
  if (!r.ok) throw toError("get domain", r);
  return normalizeDomain(r.data);
}

/**
 * Add a custom domain. Idempotent: "already exists" counts as success and
 * returns the existing record. Render auto-adds the www/apex companion.
 */
export async function addDomain(name) {
  const r = await call("POST", "/custom-domains", { name });
  if (r.status === 201 || r.status === 200) {
    const list = Array.isArray(r.data) ? r.data : [r.data];
    const mine = list.map(normalizeDomain).find((d) => d && d.name === name);
    return mine || (await getDomain(name)) || normalizeDomain(list[0]);
  }
  const detail = String((r.data && r.data.message) || "");
  const looksDuplicate = r.status === 409 || /already|exists|in use/i.test(detail);
  if (looksDuplicate) {
    const existing = await getDomain(name);
    if (existing) return existing;
    // Exists somewhere else on Render (another account/service).
    throw new RenderDomainError(`Render API add domain → HTTP ${r.status}: ${detail}`, {
      status: r.status,
      code: "RENDER_DOMAIN_IN_USE",
      detail,
      userMessage:
        "This domain is already attached to a different hosting account. Remove it there, then press Check now.",
    });
  }
  throw toError("add domain", r);
}

/** Ask Render to re-check DNS now. Returns false when the domain isn't added. */
export async function verifyDomain(name) {
  const r = await call("POST", `/custom-domains/${encodeURIComponent(name)}/verify`);
  if (r.status === 404) return false;
  if (!r.ok) throw toError("verify domain", r);
  return true;
}

/** Remove a custom domain. Missing counts as success. */
export async function removeDomain(name) {
  const r = await call("DELETE", `/custom-domains/${encodeURIComponent(name)}`);
  if (r.status === 404 || r.status === 410) return true;
  if (!r.ok) throw toError("remove domain", r);
  return true;
}

export default { isConfigured, getDomain, addDomain, verifyDomain, removeDomain, RenderDomainError };
