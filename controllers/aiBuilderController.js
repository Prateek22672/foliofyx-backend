// server/controllers/aiBuilderController.js
// ─────────────────────────────────────────────────────────────────────────────
// AI Section Builder — server-side template engine + Groq copywriting.
//
// Why this design (and not "ask the LLM for a whole page"):
//   LLMs position elements badly — overlaps, broken spacing, weak hierarchy.
//   Instead we keep curated, designer-built PAGE TEMPLATES per industry
//   (server/data/pageTemplates.js) and use Groq ONLY as a copywriter to rewrite
//   the text to the user's brief. A structure guard rejects any rewrite that
//   would change a layout slot, so the design can never break. If Groq is
//   unavailable, the user still gets the polished template as-is.
//
// Pipeline:
//   1. detectIndustry(prompt)            → choose the template
//   2. getPageTemplate(industry)         → proven layout + styling + placeholder copy
//   3. personalizeCopy(prompt, slots)    → Groq rewrites only the text (guarded)
//   4. merge + assign fresh ids          → return canvas-ready elements
// ─────────────────────────────────────────────────────────────────────────────

import { getPageTemplate } from "../data/pageTemplates.js";
import { getPooledGroq, callGroqPool, poolAvailable } from "../lib/groqPool.js";
import { detectIndustry } from "../rag/industry.js";
import { buildDesignContext, classifyIndustry } from "../rag/retriever.js";

// Re-exported for controllers that historically imported it from here.
export { detectIndustry };

// Pooled client accessor — supports several keys (GROQ_API_KEYS) with
// rotation/cooldown; returns null when no key is configured.
export function getGroq() {
  return getPooledGroq();
}

// Model fallback order — first is tried first, we fall back on rate limits.
// Creation-time copy is quality-critical: the 70B model writes dramatically
// better, more specific copy, so it goes FIRST; the 8B instant model is only
// the availability fallback.
const MODELS = [
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", maxOut: 3500 },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B", maxOut: 3500 },
];

// Element types whose `content` is user-facing copy we want personalized.
const PERSONALIZABLE = new Set([
  "heading", "subheading", "paragraph", "label", "button", "quote", "list",
  "feature", "service", "stats", "testimonial", "pricing", "property", "team",
  "faq", "timeline", "cta", "logostrip", "navbar", "footer",
]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Is the Groq client configured? (used by other controllers) ───────────────
export function aiAvailable() {
  return poolAvailable();
}

// ── Generic Groq chat helper — model fallback + multi-key rotation ───────────
export async function callGroq(messages, maxOut, models = MODELS, opts = {}) {
  return callGroqPool(messages, maxOut, models, opts);
}

// ── Parse a JSON object out of a model response ───────────────────────────────
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

// ── RAG step 3: rewrite the template's copy to match the brief ────────────────
async function personalizeCopy(brief, industry, slots) {
  // RAG: pull copywriting + industry craft chunks for this brief.
  const ragContext = buildDesignContext(`${brief} headlines copywriting voice tone`, { k: 4, industry });
  const year = new Date().getFullYear();

  const sys = `You are a senior conversion copywriter at a top design studio. You receive a JSON object mapping element ids to their current placeholder text, plus a client brief. Rewrite EVERY value so the whole page reads as one cohesive, professional ${industry} website written specifically for THIS client.

STEP 1 — extract the concrete facts from the brief before writing anything: business name, city or neighborhood, cuisine / product / service specifics, audience, and price point. Every fact the client gives you MUST appear somewhere in the copy. If the brief names the business, use that exact name in the navbar brand, hero, CTA, and footer copyright — never keep the placeholder brand.

STEP 2 — write to these quality bars:
- Specific beats generic: every line should be concrete enough that it could only belong to this business ("Single-origin beans roasted in Indiranagar" — never "great products and services").
- Lead with the benefit to the customer, not a description of the company.
- Headlines: 8 words maximum, no ending period, strong and confident.
- Labels (ALL-CAPS kickers above headings): 2 to 5 words.
- Buttons: 2 to 4 words, starting with an action verb ("Reserve a Table", "See the Menu").
- Stats, prices, and menu prices must be realistic for the industry and the client's city/currency.
- Testimonials must sound like real, distinct people: give them plausible local names and specific outcomes.
- FORBIDDEN (never output these or close variants): "Welcome to our website", "Lorem", "Your success is our priority", "Look no further", "We are the best", "high-quality solutions", "one-stop shop", "unlock your potential", "in today's fast-paced world", "your satisfaction is our", "wide range of". No square brackets, no TODO, no placeholders.
- Never ADD new emojis to prose. Typographic symbols are fine and must be preserved: keep the © in copyright lines, keep stars/currency symbols. When a "|" segment is a single emoji or icon glyph (like a feature card's icon slot), copy that segment through EXACTLY as given — never delete or empty it.
- Footer copyright lines keep the exact format "© ${year} <Brand>. All rights reserved." with the client's brand name (the © character is required).

${ragContext}

STRICT OUTPUT RULES:
- Return ONLY a JSON object with the EXACT same keys you were given. No markdown, no comments, no extra keys.
- If a value contains "|" characters, it maps to fixed layout slots — return the SAME number of "|" segments, in the same order and meaning (stat is "number|label"; pricing is "plan|price|period|description|feature|feature..."; testimonial is "quote|name|role"; feature is "title|description|icon"; property is "name|price|details"; logostrip is "name|name|name..."). NEVER add or remove "|" segments.`;

  const user = `CLIENT BRIEF: ${brief}\n\nTEXT TO REWRITE (return the same JSON keys):\n${JSON.stringify(slots)}`;

  const { text, model } = await callGroq(
    [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    3500,
    MODELS,
    { temperature: 0.55, responseFormat: { type: "json_object" } }
  );
  return { map: parseObject(text), model };
}

// Same number of "|" segments → safe to swap without breaking the layout.
function sameShape(orig = "", next = "") {
  return String(orig).split("|").length === String(next).split("|").length;
}

// Deterministic repair of model slips the prompt alone can't guarantee:
// any segment the model emptied (usually the icon slot) is restored from the
// original, and a dropped © in copyright lines is put back.
function mergeSegments(orig = "", next = "") {
  const o = String(orig).split("|");
  const merged = String(next)
    .split("|")
    .map((seg, i) => (seg.trim() === "" && o[i] && o[i].trim() !== "" ? o[i] : seg))
    .join("|");
  if (String(orig).trimStart().startsWith("©") && !merged.includes("©")) {
    return "© " + merged.trimStart();
  }
  return merged;
}

const freshId = (i) => `el_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;

// ── Core generator (shared by /generate and the AI chat builder) ─────────────
export async function generatePageElements(prompt) {
  // Trained Python classifier first (confidence-gated), regex fallback inside.
  const industry = await classifyIndustry(prompt);
  let template = getPageTemplate(industry); // designer-built, always good
  let personalized = false;
  let model = null;

  // If AI is available, personalize the copy. Any failure → keep the template.
  if (getGroq()) {
    try {
      const slots = {};
      for (const el of template) {
        if (PERSONALIZABLE.has(el.type) && typeof el.content === "string" && el.content.trim()) {
          slots[el.id] = el.content;
        }
      }
      const { map, model: usedModel } = await personalizeCopy(prompt, industry, slots);
      model = usedModel;
      template = template.map((el) => {
        const nv = map[el.id];
        if (typeof nv === "string" && nv.trim() && sameShape(el.content, nv)) {
          personalized = true;
          return { ...el, content: mergeSegments(el.content, nv) };
        }
        return el;
      });
    } catch (err) {
      console.warn("⚠ AI personalization skipped:", err.message);
      // fall through with the un-personalized (still polished) template
    }
  }

  // Assign canvas-ready unique ids.
  const elements = template.map((el, i) => ({ ...el, id: freshId(i) }));
  return { industry, model, personalized, elements };
}

// ── POST /api/ai-builder/generate ─────────────────────────────────────────────
export const generateSection = async (req, res) => {
  try {
    const prompt = (req.body?.prompt || "").toString().trim();
    if (!prompt) return res.status(400).json({ message: "A prompt is required." });
    if (prompt.length > 2000) return res.status(400).json({ message: "Prompt is too long (max 2000 chars)." });

    const { industry, model, personalized, elements } = await generatePageElements(prompt);
    return res.json({ industry, model, personalized, elements, count: elements.length });
  } catch (err) {
    console.error("❌ AI generate error:", err.message);
    return res.status(err.statusCode || 500).json({ message: err.message || "AI generation failed." });
  }
};
