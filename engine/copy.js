// server/engine/copy.js
// Copy personalisation in two tiers:
//   1. applyFacts()      — deterministic, free: brand / person / role / currency.
//   2. personalizeCopy() — one LLM call that rewrites the niche copy for this
//      brief. The result is merged field-by-field over the defaults, so a
//      partial or malformed answer can only improve the page, never break it.

import { LIMITS } from "./catalog/schema.js";
import { callGroqPool, poolAvailable } from "../lib/groqPool.js";
import { hashString } from "./styles.js";
import { textModels } from "../lib/aiModels.js";

const MODELS = textModels(6000);

const FORBIDDEN = [
  /welcome to (our|my) (website|site)/i, /lorem/i, /your success is our priority/i, /look no further/i,
  /we are the best/i, /high[- ]quality solutions/i, /one[- ]stop[- ]shop/i, /unlock your potential/i,
  /fast[- ]paced world/i, /your satisfaction is our/i, /wide range of/i, /state[- ]of[- ]the[- ]art/i,
  /cutting[- ]edge/i, /\[[^\]]*\]/, /\bTODO\b/, /\{\{|\}\}/, /as an ai\b/i,
];

const clone = (v) => JSON.parse(JSON.stringify(v));

// ── Path → character limit ────────────────────────────────────────────────────
function limitFor(path) {
  const leaf = path[path.length - 1];
  const parent = path.find((p) => typeof p === "string" && ["offerings", "showcase", "stats", "about", "testimonials", "faq", "pricing", "timeline", "team", "cta", "seo"].includes(p));
  const inItems = path.includes("items") || path.includes("plans");
  switch (leaf) {
    case "brand": return LIMITS.brand;
    case "label": return parent === "stats" ? LIMITS.statLabel : LIMITS.label;
    case "heading": return parent === "about" ? LIMITS.aboutHeading : LIMITS.heading;
    case "sub": return LIMITS.sub;
    case "cta1": case "cta2": case "button": return LIMITS.cta;
    case "title":
      if (parent === "seo") return LIMITS.seoTitle;
      if (parent === "timeline") return LIMITS.tlTitle;
      if (parent === "team") return LIMITS.role;
      return LIMITS.itemTitle;
    case "desc":
      if (parent === "timeline") return LIMITS.tlDesc;
      if (parent === "pricing") return LIMITS.planDesc;
      return LIMITS.itemDesc;
    case "description": return LIMITS.seoDesc;
    case "icon": return LIMITS.icon;
    case "num": return LIMITS.statNum;
    case "body1": case "body2": return LIMITS.body;
    case "quote": return LIMITS.quote;
    case "name": return parent === "showcase" ? LIMITS.showName : LIMITS.person;
    case "role": return LIMITS.role;
    case "q": return LIMITS.question;
    case "a": return LIMITS.answer;
    case "meta": return LIMITS.showMeta;
    case "details": return LIMITS.showDetails;
    case "plan": return LIMITS.plan;
    case "price": return LIMITS.price;
    case "period": return LIMITS.period;
    case "year": return LIMITS.tlYear;
    case "bio": return LIMITS.itemDesc;
    default:
      if (typeof leaf === "number" && path.includes("features")) return LIMITS.planFeature;
      return inItems ? LIMITS.itemDesc : 160;
  }
}

function trimTo(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max + 1);
  const at = Math.max(cut.lastIndexOf(" "), cut.lastIndexOf(","));
  return (at > max * 0.6 ? cut.slice(0, at) : text.slice(0, max)).replace(/[\s,;:–—-]+$/, "");
}

function acceptString(candidate, fallback, path) {
  if (typeof candidate !== "string") return null;
  let s = candidate.replace(/\s+/g, " ").trim();
  if (!s || s.includes("|")) return null;
  if (FORBIDDEN.some((re) => re.test(s))) return null;
  const max = limitFor(path);
  if (path[path.length - 1] === "icon") return s.length <= max ? s : null;
  if (s.length > max * 1.35) return null;
  s = trimTo(s, max);
  if (path[path.length - 1] === "heading" || path[path.length - 1] === "title") s = s.replace(/\.$/, "");
  return s === fallback ? null : s;
}

// Merge `next` over `base` following base's exact shape; returns count of replaced leaves.
function mergeShape(base, next, path = []) {
  let changed = 0;
  if (Array.isArray(base)) {
    if (!Array.isArray(next)) return 0;
    for (let i = 0; i < base.length; i++) {
      if (typeof base[i] === "string") {
        const v = acceptString(next[i], base[i], [...path, i]);
        if (v) { base[i] = v; changed++; }
      } else if (base[i] && typeof base[i] === "object") {
        changed += mergeShape(base[i], next[i], [...path, i]);
      }
    }
    return changed;
  }
  if (!next || typeof next !== "object") return 0;
  for (const key of Object.keys(base)) {
    if (typeof base[key] === "string") {
      const v = acceptString(next[key], base[key], [...path, key]);
      if (v) { base[key] = v; changed++; }
    } else if (base[key] && typeof base[key] === "object") {
      changed += mergeShape(base[key], next[key], [...path, key]);
    }
  }
  return changed;
}

function walkStrings(obj, fn) {
  if (Array.isArray(obj)) obj.forEach((v, i) => (typeof v === "string" ? (obj[i] = fn(v)) : walkStrings(v, fn)));
  else if (obj && typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === "string") obj[k] = fn(obj[k]);
      else walkStrings(obj[k], fn);
    }
  }
}

// ── Currency ──────────────────────────────────────────────────────────────────
function nicePrice(value, charm) {
  if (value < 20) return Math.round(value);
  if (value < 1000) return charm ? Math.round(value / 10) * 10 - 1 : Math.round(value / 10) * 10;
  if (value < 100000) return charm ? Math.round(value / 100) * 100 - 1 : Math.round(value / 100) * 100;
  return Math.round(value / 1000) * 1000;
}

export function convertPrice(text, currency) {
  if (!currency || currency.code === "USD" || typeof text !== "string") return text;
  return text.replace(/\$\s?(\d[\d,]*(?:\.\d+)?)(\s?[kKmM])?/g, (all, num, suffix) => {
    if (suffix) return all;
    const usd = parseFloat(num.replace(/,/g, ""));
    if (!Number.isFinite(usd)) return all;
    const charm = /9$/.test(num.replace(/[.,]\d*$/, ""));
    const local = nicePrice(usd * currency.rate, charm);
    return `${currency.symbol}${local.toLocaleString(currency.locale)}`;
  });
}

// ── Tier 1: deterministic facts ───────────────────────────────────────────────
export function applyFacts(nicheCopy, niche, intent = {}) {
  const copy = clone(nicheCopy);
  const personal = niche.archetype === "portfolio";
  const newName = personal ? intent.person || intent.brand : intent.brand || intent.person;
  const oldName = copy.brand;

  if (newName && newName !== oldName) {
    const first = oldName.split(" ")[0];
    const newFirst = newName.split(" ")[0];
    walkStrings(copy, (s) => {
      let out = s.split(oldName).join(newName);
      // Portfolio copy often says "Hi, I'm Alex" — swap the first name too.
      if (personal && first.length > 2 && first !== newFirst) out = out.replace(new RegExp(`\\b${first}\\b`, "g"), newFirst);
      return out;
    });
    copy.brand = newName.slice(0, LIMITS.brand);
  }

  if (personal && intent.role) {
    copy.label = intent.role.toUpperCase().slice(0, LIMITS.label);
  }

  if (intent.currency) {
    if (copy.showcase) copy.showcase.items.forEach((it) => { it.meta = convertPrice(it.meta, intent.currency); });
    if (copy.pricing) copy.pricing.plans.forEach((pl) => { pl.price = convertPrice(pl.price, intent.currency); });
  }

  if (newName && !copy.seo.title.includes(copy.brand)) {
    copy.seo.title = trimTo(`${copy.brand} – ${niche.name}`, LIMITS.seoTitle);
  }
  return copy;
}

// ── Tier 2: LLM rewrite (cached) ──────────────────────────────────────────────
const CACHE = new Map();
const CACHE_MAX = 300;

function cacheGet(key) {
  const hit = CACHE.get(key);
  if (!hit) return null;
  CACHE.delete(key);
  CACHE.set(key, hit);
  return clone(hit);
}

function cacheSet(key, value) {
  CACHE.set(key, clone(value));
  if (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
}

function factsLine(niche, intent) {
  const facts = [
    `Business type: ${niche.name}`,
    intent.brand && `Business/brand name: ${intent.brand}`,
    intent.person && `Person's name: ${intent.person}`,
    intent.role && `Role: ${intent.role}`,
    intent.location && `Location: ${intent.location}`,
    intent.currency && `Currency: ${intent.currency.code} (write prices like ${intent.currency.symbol}1,299)`,
    intent.moods?.length && `Tone: ${intent.moods.join(", ")}`,
  ].filter(Boolean);
  return facts.join("\n");
}

function limitsTable() {
  return Object.entries(LIMITS).map(([k, v]) => `${k}≤${v}`).join(", ");
}

/**
 * Returns { copy, model, changed } — copy is the merged result (never worse
 * than `baseCopy`). Throws nothing: any failure returns baseCopy unchanged.
 */
export async function personalizeCopy({ baseCopy, niche, intent, brief }) {
  if (!poolAvailable()) return { copy: baseCopy, model: null, changed: 0, cached: false };

  const key = `${hashString(`${niche.id}|${intent.normalized || brief}`)}`;
  const cached = cacheGet(key);
  if (cached) return { ...cached, cached: true };

  const year = new Date().getFullYear();
  const personal = niche.archetype === "portfolio";
  const system = `You are a senior conversion copywriter at a top web design studio. You receive the complete text of a ${niche.name} website as JSON, plus a client brief. Rewrite the text so the whole site reads as one cohesive, specific, professional website for THIS client.

Rules:
- The text you receive is a template written for a DIFFERENT, fictional business. Rewrite it for this client: replace its specific claims (product names, numbers, turnaround times, founding story, testimonial names) with ones that fit the client. Wherever the brief states a fact (a number, a speciality, a timeframe), use the client's value everywhere that topic appears, including stats and the SEO description.
- Use every concrete fact in the brief (name, place, specialities, audience, price point, years, tools). When a location is given, testimonials use plausible local names and the copy mentions the place naturally once or twice. ${personal ? "It is a personal portfolio: write about the person in first person (\"I build...\"), and keep testimonials in third person from others." : "Use the client's business name wherever the brand appears."}
- Specific beats generic: every line must fit only this client. Lead with customer benefit.
- Headlines ≤ 8 words, no trailing period. "label" fields are ALL-CAPS kickers of 2-5 words. Buttons 2-4 words starting with a verb.
- Numbers, stats and prices must be realistic for this client, city and currency.
- Testimonials sound like distinct real people with plausible local names and specific outcomes.
- Never use: "Welcome to our website", "Lorem", "look no further", "one-stop shop", "wide range of", "state-of-the-art", "cutting-edge", "unlock your potential", placeholders, brackets or emojis in prose. Keep each "icon" value as a single emoji.
- Hard character limits (field≤max): ${limitsTable()}.
- Return ONLY the JSON object with the EXACT same keys, nesting and array lengths. Never add or remove keys or array items. No "|" characters. Current year is ${year}.`;

  const user = `CLIENT BRIEF: ${String(brief).slice(0, 1500)}\n\nKNOWN FACTS:\n${factsLine(niche, intent)}\n\nWEBSITE TEXT (rewrite and return the same JSON shape):\n${JSON.stringify(baseCopy)}`;

  try {
    const { text, model, finishReason } = await callGroqPool(
      [{ role: "system", content: system }, { role: "user", content: user }],
      6000,
      MODELS,
      { temperature: 0.6, responseFormat: { type: "json_object" } }
    );
    let parsed = null;
    try {
      const raw = String(text).trim().replace(/^```(?:json)?\s*/m, "").replace(/\s*```$/m, "");
      parsed = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
    } catch {
      parsed = null;
    }
    if (!parsed) {
      console.warn(`⚠ copy personalisation unparseable (finish: ${finishReason || "?"}, model: ${model})`);
      return { copy: baseCopy, model, changed: 0, cached: false };
    }
    const merged = clone(baseCopy);
    const changed = mergeShape(merged, parsed);
    // Brand facts the user stated always win over the model's paraphrase.
    const statedName = personal ? intent.person || intent.brand : intent.brand || intent.person;
    if (statedName) merged.brand = baseCopy.brand;
    if (intent.currency) {
      if (merged.showcase) merged.showcase.items.forEach((it) => { it.meta = convertPrice(it.meta, intent.currency); });
      if (merged.pricing) merged.pricing.plans.forEach((pl) => { pl.price = convertPrice(pl.price, intent.currency); });
    }
    const result = { copy: merged, model, changed };
    if (changed >= 8) cacheSet(key, result);
    return { ...result, cached: false };
  } catch (err) {
    console.warn(`⚠ copy personalisation skipped: ${err.message}`);
    return { copy: baseCopy, model: null, changed: 0, cached: false };
  }
}
