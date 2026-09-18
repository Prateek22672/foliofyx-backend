// server/lib/monitor.js
// Lightweight observability for the admin dashboard.
//   • In memory (since last restart): per-route latency/error stats, per-minute
//     request buckets for 24h, per-model AI health.
//   • Persisted (MonitorEvent, 30-day TTL): server errors, slow requests, AI
//     calls and builder generations — so history survives restarts.
// Recording never throws and never blocks a response.

import MonitorEvent from "../models/MonitorEvent.js";

const startedAt = Date.now();
const SLOW_MS = 2000;
const MAX_SAMPLES = 200;
const BUCKET_MS = 60_000;
const BUCKETS = 24 * 60;

const routes = new Map(); // key → { count, errors, totalMs, maxMs, samples[] }
const buckets = new Map(); // minuteIndex → { requests, errors, totalMs }
const models = new Map(); // model → { calls, ok, fail, totalMs, lastError, lastErrorAt, lastOkAt }
let totals = { requests: 0, errors: 0 };

function persist(doc) {
  try {
    MonitorEvent.create(doc).catch(() => {});
  } catch {
    /* model not ready — ignore */
  }
}

// /api/portfolio/64f1…/x → /api/portfolio/:id/x
export function routeKey(req) {
  const base = req.baseUrl || "";
  const path = req.route?.path && typeof req.route.path === "string" ? `${base}${req.route.path}` : `${base}${req.path || ""}`;
  return `${req.method} ${path
    .replace(/[0-9a-f]{24}/gi, ":id")
    .replace(/\/\d+(?=\/|$)/g, "/:n")
    .slice(0, 120)}`;
}

function pct(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

/** Express middleware: time every /api request. */
export function requestMonitor() {
  return (req, res, next) => {
    if (!req.path.startsWith("/api") || req.path.startsWith("/api/admin") || req.path === "/api/ping") return next();
    const t0 = process.hrtime.bigint();
    res.on("finish", () => {
      try {
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        const key = routeKey(req);
        const isErr = res.statusCode >= 500;
        totals.requests++;
        if (isErr) totals.errors++;

        const r = routes.get(key) || { count: 0, errors: 0, totalMs: 0, maxMs: 0, samples: [] };
        r.count++;
        if (isErr) r.errors++;
        r.totalMs += ms;
        r.maxMs = Math.max(r.maxMs, ms);
        r.samples.push(ms);
        if (r.samples.length > MAX_SAMPLES) r.samples.shift();
        routes.set(key, r);

        const idx = Math.floor(Date.now() / BUCKET_MS);
        const b = buckets.get(idx) || { requests: 0, errors: 0, totalMs: 0 };
        b.requests++;
        if (isErr) b.errors++;
        b.totalMs += ms;
        buckets.set(idx, b);
        if (buckets.size > BUCKETS + 5) {
          for (const k of buckets.keys()) if (k < idx - BUCKETS) buckets.delete(k);
        }

        if (!isErr && ms >= SLOW_MS) {
          persist({ type: "slow", route: key, method: req.method, status: res.statusCode, ms: Math.round(ms), userId: req.user?._id });
        }
        if (isErr && !res.locals.monitorRecorded) {
          persist({ type: "error", ok: false, route: key, method: req.method, status: res.statusCode, ms: Math.round(ms), message: res.locals.errorMessage || `HTTP ${res.statusCode}`, userId: req.user?._id });
        }
      } catch {
        /* never break a response */
      }
    });
    next();
  };
}

/** Record an exception (error handler, unhandled rejections). */
export function recordError(err, req) {
  try {
    if (req?.res) req.res.locals.monitorRecorded = true;
    persist({
      type: "error",
      ok: false,
      route: req ? routeKey(req) : "process",
      method: req?.method,
      status: 500,
      message: String(err?.message || err).slice(0, 500),
      stack: String(err?.stack || "").split("\n").slice(0, 6).join("\n").slice(0, 1500),
      userId: req?.user?._id,
    });
  } catch {
    /* ignore */
  }
}

/** Record one AI model call (called by the Groq pool). */
export function recordAi({ model, ok, ms, error, feature, finishReason }) {
  try {
    const m = models.get(model) || { calls: 0, ok: 0, fail: 0, totalMs: 0, lastError: "", lastErrorAt: null, lastOkAt: null, recent: [] };
    m.calls++;
    m.totalMs += ms || 0;
    if (ok) { m.ok++; m.lastOkAt = new Date(); } else { m.fail++; m.lastError = String(error || "").slice(0, 300); m.lastErrorAt = new Date(); }
    m.recent.push(ok ? 1 : 0);
    if (m.recent.length > 50) m.recent.shift();
    models.set(model, m);
    persist({ type: "ai", ok, model, ms: Math.round(ms || 0), feature: feature || "ai", message: ok ? finishReason || "" : String(error || "").slice(0, 500) });
  } catch {
    /* ignore */
  }
}

/** Record an AI builder generation / edit (one per user request). */
export function recordBuilder({ ok = true, ms, userId, meta, message }) {
  persist({ type: "builder", ok, ms: Math.round(ms || 0), userId, feature: meta?.intent || "builder", meta, message });
}

export function recordEvent(type, doc = {}) {
  persist({ type, ...doc });
}

// ── Snapshots for the admin API ───────────────────────────────────────────────
export function requestSnapshot() {
  const now = Math.floor(Date.now() / BUCKET_MS);
  const series = [];
  for (let i = 59; i >= 0; i--) {
    const b = buckets.get(now - i) || { requests: 0, errors: 0, totalMs: 0 };
    series.push({ t: (now - i) * BUCKET_MS, requests: b.requests, errors: b.errors, avgMs: b.requests ? Math.round(b.totalMs / b.requests) : 0 });
  }
  let last24 = { requests: 0, errors: 0, totalMs: 0 };
  for (const [k, b] of buckets) {
    if (k >= now - BUCKETS) { last24.requests += b.requests; last24.errors += b.errors; last24.totalMs += b.totalMs; }
  }
  const all = [...routes.values()].flatMap((r) => r.samples).sort((a, b) => a - b);
  const routeRows = [...routes.entries()].map(([route, r]) => {
    const s = [...r.samples].sort((a, b) => a - b);
    return { route, count: r.count, errors: r.errors, avgMs: Math.round(r.totalMs / r.count), p95Ms: Math.round(pct(s, 95)), maxMs: Math.round(r.maxMs) };
  }).sort((a, b) => b.p95Ms - a.p95Ms);
  return {
    since: new Date(startedAt),
    uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    totals,
    last24h: { requests: last24.requests, errors: last24.errors, avgMs: last24.requests ? Math.round(last24.totalMs / last24.requests) : 0 },
    p50Ms: Math.round(pct(all, 50)),
    p95Ms: Math.round(pct(all, 95)),
    lastHour: series,
    routes: routeRows.slice(0, 60),
  };
}

export function modelSnapshot() {
  return [...models.entries()].map(([model, m]) => ({
    model,
    calls: m.calls,
    ok: m.ok,
    fail: m.fail,
    successRate: m.calls ? Math.round((m.ok / m.calls) * 1000) / 10 : null,
    recentSuccessRate: m.recent.length ? Math.round((m.recent.reduce((a, b) => a + b, 0) / m.recent.length) * 1000) / 10 : null,
    avgMs: m.calls ? Math.round(m.totalMs / m.calls) : 0,
    lastError: m.lastError,
    lastErrorAt: m.lastErrorAt,
    lastOkAt: m.lastOkAt,
  }));
}
