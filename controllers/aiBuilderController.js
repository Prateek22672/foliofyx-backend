// server/controllers/aiBuilderController.js
// ─────────────────────────────────────────────────────────────────────────────
// AI site generation endpoints, backed by the FYX Site Engine (server/engine).
//
// The engine matches the prompt to one of ~180 niche templates, lays out a
// measured page and spends at most ONE LLM call personalising the copy — so a
// good site comes back even when Groq is slow, rate-limited or unconfigured.
//
// Also exports the shared Groq helpers other controllers use (reference studio).
// ─────────────────────────────────────────────────────────────────────────────

import { getPooledGroq, callGroqPool, poolAvailable } from "../lib/groqPool.js";
import { detectIndustry } from "../rag/industry.js";
import { generateSite, catalogSummary } from "../engine/index.js";
import { textModels } from "../lib/aiModels.js";
import { recordBuilder } from "../lib/monitor.js";

export { detectIndustry };

export function getGroq() {
  return getPooledGroq();
}

const MODELS = textModels(5000);

export function aiAvailable() {
  return poolAvailable();
}

export async function callGroq(messages, maxOut, models = MODELS, opts = {}) {
  return callGroqPool(messages, maxOut, models, opts);
}

export function parseObject(raw) {
  const text = String(raw).trim().replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "").trim();
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s === -1 || e === -1) return {};
  try {
    const obj = JSON.parse(text.slice(s, e + 1));
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

// Old archetype names the client and RAG knowledge base still understand.
const LEGACY_INDUSTRY = {
  store: "ecommerce", restaurant: "restaurant", hotel: "hotel", saas: "saas", agency: "marketing",
  portfolio: "portfolio", listing: "realestate", local: "general", event: "general",
  nonprofit: "general", education: "general", creator: "general",
};

export function legacyIndustry(archetype) {
  return LEGACY_INDUSTRY[archetype] || "general";
}

const freshId = (i) => `el_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;

/** Shared by /generate and the chat builder. */
export async function generatePageElements(prompt, opts = {}) {
  const site = await generateSite(prompt, opts);
  return {
    ...site,
    industry: legacyIndustry(site.niche.archetype),
    elements: site.elements.map((el, i) => ({ ...el, id: freshId(i) })),
  };
}

// ── POST /api/ai-builder/generate ─────────────────────────────────────────────
export const generateSection = async (req, res) => {
  try {
    const prompt = (req.body?.prompt || "").toString().trim();
    if (!prompt) return res.status(400).json({ message: "A prompt is required." });
    if (prompt.length > 2000) return res.status(400).json({ message: "Prompt is too long (max 2000 characters)." });

    const variant = Number.isInteger(req.body?.variant) ? Math.max(0, Math.min(50, req.body.variant)) : 0;
    const nicheId = typeof req.body?.nicheId === "string" ? req.body.nicheId.slice(0, 60) : null;
    const styleId = typeof req.body?.styleId === "string" ? req.body.styleId.slice(0, 40) : null;

    const t0 = Date.now();
    const out = await generatePageElements(prompt, { variant, nicheId, styleId });
    recordBuilder({
      ok: true, ms: Date.now() - t0, userId: req.user?._id,
      meta: { intent: "studio-generate", niche: out.niche?.id, style: out.style?.id, model: out.model, personalized: out.personalized, prompt: prompt.slice(0, 140) },
    });
    return res.json({
      industry: out.industry,
      niche: out.niche,
      style: out.style,
      model: out.model,
      personalized: out.personalized,
      elements: out.elements,
      pageBg: out.pageBg,
      seo: out.seo,
      meta: out.meta,
      count: out.elements.length,
    });
  } catch (err) {
    console.error("❌ AI generate error:", err.message);
    return res.status(err.statusCode || 500).json({ message: err.statusCode ? err.message : "Site generation failed. Please try again." });
  }
};

// ── GET /api/ai-builder/catalog ───────────────────────────────────────────────
export const getCatalog = (_req, res) => {
  res.set("Cache-Control", "public, max-age=3600");
  return res.json(catalogSummary());
};
