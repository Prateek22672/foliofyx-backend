// server/controllers/adminController.js
// Read-only admin dashboard API (mounted behind protect + adminOnly).

import mongoose from "mongoose";
import User from "../models/User.js";
import Portfolio from "../models/Portfolio.js";
import CustomWebsite from "../models/CustomWebsite.js";
import MonitorEvent from "../models/MonitorEvent.js";
import { requestSnapshot, modelSnapshot } from "../lib/monitor.js";
import { poolStatus, poolAvailable, retiredModelIds, getPooledGroq } from "../lib/groqPool.js";
import { textModels, visionModelIds } from "../lib/aiModels.js";
import { cfg } from "../lib/siteConfig.js";
import * as render from "../lib/renderDomains.js";
import { catalogSummary } from "../engine/index.js";
import { isAdminUser } from "../middleware/authMiddleware.js";

const DAY = 24 * 60 * 60 * 1000;
const fail = (res, err, what) => {
  console.error(`[admin] ${what}:`, err.message);
  res.status(500).json({ message: `Couldn't load ${what}.` });
};

function dailySeries(rows, days) {
  const map = new Map(rows.map((r) => [r._id, r.n]));
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * DAY).toISOString().slice(0, 10);
    out.push({ date: d, count: map.get(d) || 0 });
  }
  return out;
}

const perDay = (Model, field, since) =>
  Model.aggregate([
    { $match: { [field]: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: `$${field}` } }, n: { $sum: 1 } } },
  ]);

// ── GET /api/admin/me ─────────────────────────────────────────────────────────
export const adminMe = (req, res) => res.json({ isAdmin: isAdminUser(req.user), email: req.user.email });

// ── GET /api/admin/overview ───────────────────────────────────────────────────
export async function overview(req, res) {
  try {
    const now = Date.now();
    const since30 = new Date(now - 30 * DAY);
    const [
      users, signupsToday, signups7, signups30, active24, active7, active30,
      portfolios, publicPortfolios, sites, publishedSites, domainsByStatus,
      signupRows, siteRows, aiAgg, builderAgg, errors24,
    ] = await Promise.all([
      User.estimatedDocumentCount(),
      User.countDocuments({ createdAt: { $gte: new Date(now - DAY) } }),
      User.countDocuments({ createdAt: { $gte: new Date(now - 7 * DAY) } }),
      User.countDocuments({ createdAt: { $gte: since30 } }),
      User.countDocuments({ lastActiveAt: { $gte: new Date(now - DAY) } }),
      User.countDocuments({ lastActiveAt: { $gte: new Date(now - 7 * DAY) } }),
      User.countDocuments({ lastActiveAt: { $gte: since30 } }),
      Portfolio.estimatedDocumentCount(),
      Portfolio.countDocuments({ isPublic: true }),
      CustomWebsite.estimatedDocumentCount(),
      CustomWebsite.countDocuments({ status: "published" }),
      CustomWebsite.aggregate([{ $match: { "customDomain.name": { $exists: true, $ne: null } } }, { $group: { _id: "$customDomain.status", n: { $sum: 1 } } }]),
      perDay(User, "createdAt", since30),
      perDay(CustomWebsite, "createdAt", since30),
      MonitorEvent.aggregate([
        { $match: { type: "ai", at: { $gte: new Date(now - DAY) } } },
        { $group: { _id: null, calls: { $sum: 1 }, failures: { $sum: { $cond: ["$ok", 0, 1] } }, avgMs: { $avg: "$ms" } } },
      ]),
      MonitorEvent.aggregate([
        { $match: { type: "builder", at: { $gte: new Date(now - DAY) } } },
        { $group: { _id: null, runs: { $sum: 1 }, failures: { $sum: { $cond: ["$ok", 0, 1] } }, avgMs: { $avg: "$ms" } } },
      ]),
      MonitorEvent.countDocuments({ type: "error", at: { $gte: new Date(now - DAY) } }),
    ]);

    const ai = aiAgg[0] || { calls: 0, failures: 0, avgMs: 0 };
    const builder = builderAgg[0] || { runs: 0, failures: 0, avgMs: 0 };
    res.json({
      users: { total: users, signups: { today: signupsToday, d7: signups7, d30: signups30 }, active: { d1: active24, d7: active7, d30: active30 } },
      content: { portfolios, publicPortfolios, sites, publishedSites },
      domains: Object.fromEntries(domainsByStatus.map((d) => [d._id || "unknown", d.n])),
      series: { signups: dailySeries(signupRows, 30), sites: dailySeries(siteRows, 30) },
      ai: { calls24h: ai.calls, failures24h: ai.failures, avgMs: Math.round(ai.avgMs || 0) },
      builder: { runs24h: builder.runs, failures24h: builder.failures, avgMs: Math.round(builder.avgMs || 0) },
      errors24h: errors24,
      requests: requestSnapshot(),
      server: { node: process.version, memoryMb: Math.round(process.memoryUsage().rss / 1048576), db: mongoose.connection.readyState === 1 ? "connected" : "down" },
    });
  } catch (err) {
    fail(res, err, "overview");
  }
}

// ── GET /api/admin/users?search=&page= ───────────────────────────────────────
export async function users(req, res) {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const search = String(req.query.search || "").trim().slice(0, 80);
    const q = search ? { $or: [{ email: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }, { name: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }] } : {};
    const [list, total] = await Promise.all([
      User.find(q).select("name email plan role isStudent createdAt lastActiveAt").sort({ createdAt: -1 }).skip((page - 1) * 50).limit(50).lean(),
      User.countDocuments(q),
    ]);
    const ids = list.map((u) => u._id);
    const [pc, sc] = await Promise.all([
      Portfolio.aggregate([{ $match: { userId: { $in: ids } } }, { $group: { _id: "$userId", n: { $sum: 1 } } }]),
      CustomWebsite.aggregate([{ $match: { userId: { $in: ids } } }, { $group: { _id: "$userId", n: { $sum: 1 }, published: { $sum: { $cond: [{ $eq: ["$status", "published"] }, 1, 0] } } } }]),
    ]);
    const pMap = new Map(pc.map((r) => [String(r._id), r.n]));
    const sMap = new Map(sc.map((r) => [String(r._id), r]));
    res.json({
      total, page, pages: Math.ceil(total / 50),
      users: list.map((u) => ({ ...u, portfolios: pMap.get(String(u._id)) || 0, sites: sMap.get(String(u._id))?.n || 0, publishedSites: sMap.get(String(u._id))?.published || 0 })),
    });
  } catch (err) {
    fail(res, err, "users");
  }
}

// ── GET /api/admin/sites ──────────────────────────────────────────────────────
export async function sites(req, res) {
  try {
    const list = await CustomWebsite.find({})
      .select("title slug status industry userId updatedAt publishedAt customDomain.name customDomain.status customDomain.lastError customDomain.lastCheckedAt")
      .sort({ updatedAt: -1 }).limit(200).populate("userId", "email name").lean();
    res.json({
      rootDomain: cfg.ROOT_DOMAIN,
      sites: list.map((s) => ({
        id: s._id, title: s.title, slug: s.slug, status: s.status, industry: s.industry, updatedAt: s.updatedAt, publishedAt: s.publishedAt,
        owner: s.userId ? { email: s.userId.email, name: s.userId.name } : null,
        subdomain: s.slug ? `${s.slug}.${cfg.ROOT_DOMAIN}` : null,
        domain: s.customDomain?.name ? { name: s.customDomain.name, status: s.customDomain.status, lastError: s.customDomain.lastError, lastCheckedAt: s.customDomain.lastCheckedAt } : null,
      })),
    });
  } catch (err) {
    fail(res, err, "sites");
  }
}

// ── GET /api/admin/ai ─────────────────────────────────────────────────────────
export async function ai(req, res) {
  try {
    const [recentBuilder, recentFailures, perModel24] = await Promise.all([
      MonitorEvent.find({ type: "builder" }).sort({ at: -1 }).limit(80).populate("userId", "email").lean(),
      MonitorEvent.find({ type: "ai", ok: false }).sort({ at: -1 }).limit(50).lean(),
      MonitorEvent.aggregate([
        { $match: { type: "ai", at: { $gte: new Date(Date.now() - DAY) } } },
        { $group: { _id: "$model", calls: { $sum: 1 }, failures: { $sum: { $cond: ["$ok", 0, 1] } }, avgMs: { $avg: "$ms" }, lastAt: { $max: "$at" } } },
      ]),
    ]);
    res.json({
      configured: poolAvailable(),
      keys: poolStatus(),
      textModels: textModels(0).map((m) => m.id),
      visionModels: visionModelIds(),
      retired: retiredModelIds(),
      sinceRestart: modelSnapshot(),
      last24h: perModel24.map((m) => ({ model: m._id, calls: m.calls, failures: m.failures, avgMs: Math.round(m.avgMs || 0), lastAt: m.lastAt })),
      builderLogs: recentBuilder.map((e) => ({ at: e.at, ok: e.ok, ms: e.ms, intent: e.feature, user: e.userId?.email || null, meta: e.meta, message: e.message })),
      failures: recentFailures.map((e) => ({ at: e.at, model: e.model, feature: e.feature, ms: e.ms, message: e.message })),
    });
  } catch (err) {
    fail(res, err, "AI status");
  }
}

// ── POST /api/admin/ai/probe ──────────────────────────────────────────────────
export async function probeModels(req, res) {
  const client = getPooledGroq();
  if (!client) return res.status(503).json({ message: "No Groq keys configured." });
  const results = await Promise.all(
    textModels(256).map(async (m) => {
      const t0 = Date.now();
      try {
        const c = await client.chat.completions.create({
          model: m.id, max_tokens: 256, temperature: 0, ...(m.extra || {}),
          messages: [{ role: "user", content: "Reply with the single word OK." }],
        });
        return { model: m.id, ok: true, ms: Date.now() - t0, reply: String(c?.choices?.[0]?.message?.content || "").slice(0, 40) };
      } catch (err) {
        return { model: m.id, ok: false, ms: Date.now() - t0, error: `${err?.status || ""} ${err?.message || err}`.trim().slice(0, 300) };
      }
    })
  );
  res.json({ at: new Date(), results });
}

// ── GET /api/admin/errors ─────────────────────────────────────────────────────
export async function errors(req, res) {
  try {
    const [errs, slow] = await Promise.all([
      MonitorEvent.find({ type: "error" }).sort({ at: -1 }).limit(100).lean(),
      MonitorEvent.find({ type: "slow" }).sort({ at: -1 }).limit(100).lean(),
    ]);
    res.json({ errors: errs, slow, requests: requestSnapshot() });
  } catch (err) {
    fail(res, err, "errors");
  }
}

// ── GET /api/admin/system ─────────────────────────────────────────────────────
export function system(req, res) {
  const catalog = catalogSummary();
  res.json({
    architecture: [
      { name: "Web app", tech: "React 19 + Vite SPA, prerendered SEO pages", host: "Netlify", url: `https://${cfg.ROOT_DOMAIN}` },
      { name: "API", tech: "Node.js + Express", host: "Render", url: cfg.RENDER_EXTERNAL_HOSTNAME ? `https://${cfg.RENDER_EXTERNAL_HOSTNAME}` : "(set by Render)" },
      { name: "Database", tech: "MongoDB (Mongoose)", host: "MongoDB Atlas", url: null },
      { name: "AI", tech: "Groq key pool with model fallback", host: "Groq", url: null },
      { name: "Site engine", tech: `${catalog.counts.niches} website types × ${catalog.counts.styles} styles, measured layouts, 1 AI call per site`, host: "API", url: null },
      { name: "Published sites", tech: "Server-rendered HTML, wildcard subdomains, custom domains with DNS monitor", host: "API (Render)", url: `https://<slug>.${cfg.ROOT_DOMAIN}` },
    ],
    config: {
      rootDomain: cfg.ROOT_DOMAIN,
      wildcardSubdomains: cfg.WILDCARD_SUBDOMAINS,
      cnameTarget: cfg.CNAME_TARGET,
      apexIp: cfg.APEX_A_RECORD,
      renderApiConfigured: render.isConfigured(),
      groqKeys: poolStatus().length,
      domainMonitor: process.env.DOMAIN_MONITOR !== "off",
      adminEmailsConfigured: Boolean(process.env.ADMIN_EMAILS),
      nodeEnv: process.env.NODE_ENV || "development",
    },
    catalog: catalog.counts,
  });
}

// ── GET /api/admin/pipelines ───────────────────────────────────────────────────
// Health for "extra processing" features — multi-step pipelines beyond a
// single AI call (today: resume parsing — file upload → Python extraction →
// several Groq calls). One MonitorEvent per attempt (lib/monitor.js /
// controllers/resumeParserController.js), so a reported "it doesn't work" has
// an actual reason attached instead of nothing to go on.
export async function pipelines(req, res) {
  try {
    const since = new Date(Date.now() - DAY);
    const [recent, dayStats] = await Promise.all([
      MonitorEvent.find({ type: "resume_parse" }).sort({ at: -1 }).limit(80).populate("userId", "email").lean(),
      MonitorEvent.aggregate([
        { $match: { type: "resume_parse", at: { $gte: since } } },
        { $group: { _id: "$ok", n: { $sum: 1 }, avgMs: { $avg: "$ms" } } },
      ]),
    ]);
    const okDay = dayStats.find((d) => d._id === true)?.n || 0;
    const failDay = dayStats.find((d) => d._id === false)?.n || 0;
    const attemptsDay = okDay + failDay;
    const avgMsDay = attemptsDay
      ? Math.round(dayStats.reduce((sum, d) => sum + (d.avgMs || 0) * (d.n || 0), 0) / attemptsDay)
      : 0;

    res.json({
      resumeParser: {
        status: "beta",
        last24h: {
          attempts: attemptsDay,
          ok: okDay,
          failed: failDay,
          successRate: attemptsDay ? Math.round((okDay / attemptsDay) * 1000) / 10 : null,
          avgMs: avgMsDay,
        },
        recent: recent.map((e) => ({
          at: e.at,
          ok: e.ok,
          ms: e.ms,
          stage: e.feature,
          message: e.message,
          user: e.userId?.email || null,
          file: e.meta?.file || null,
        })),
      },
    });
  } catch (err) {
    fail(res, err, "pipelines");
  }
}
