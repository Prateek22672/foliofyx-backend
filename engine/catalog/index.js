// server/engine/catalog/index.js
// Loads every catalog file, validates it once at startup and builds the
// keyword index the intent matcher scores against.

import { validateCatalog } from "./schema.js";

const FILES = [
  "./retail.js",
  "./food-hospitality.js",
  "./services-health.js",
  "./tech-business-community.js",
  "./portfolios.js",
  "./fallbacks.js",
];

const loaded = await Promise.all(
  FILES.map((f) =>
    import(f)
      .then((m) => (Array.isArray(m.default) ? m.default : []))
      .catch((err) => {
        console.error(`❌ engine catalog ${f} failed to load: ${err.message}`);
        return [];
      })
  )
);

// Matching fixes learned from real prompts: extra keywords / negatives merged
// into catalog entries (kept here so tuning never touches the content files).
const TUNING = {
  "ai-startup": { keywords: ["ai app", "ai tool", "ai assistant", "ai powered", "ai based", "gpt", "llm app", "chatbot app", "copilot", "note taking app", "ai note"] },
  "handmade-crafts-shop": { keywords: ["candle", "handmade candle", "soy candle", "scented candle", "resin art", "macrame", "crochet"] },
  "full-stack-developer": { keywords: ["full stack", "fullstack", "mern", "mean stack", "full stack developer"] },
  "organic-food-store": { keywords: ["organic", "organic vegetable", "organic produce", "farm fresh", "organic grocery"] },
  "grocery-store": { negative: ["organic"] },
  "engineering-student-fresher": { keywords: ["fresher", "placement", "campus placement", "job ready", "entry level", "graduate resume"] },
  "saas-b2b-platform": { keywords: ["invoicing", "invoice software", "crm", "erp", "b2b software", "subscription software"] },
  "interior-design-studio": { keywords: ["interior designer", "interior design"] },
  hotel: { keywords: ["hotel room", "hotel booking", "rooms and booking"] },
  "pet-store": { keywords: ["dog training", "dog trainer", "pet training", "pet grooming", "dog grooming"] },
  "architecture-firm": { keywords: ["architecture practice", "architecture firm", "architects"] },
};

const all = loaded.flat().map((n) => {
  const t = n && TUNING[n.id];
  if (!t) return n;
  return {
    ...n,
    keywords: [...new Set([...(n.keywords || []), ...(t.keywords || [])])],
    ...(t.negative ? { negative: [...new Set([...(n.negative || []), ...t.negative])] } : {}),
  };
});
const problems = validateCatalog(all);
if (problems.length) {
  console.warn(`⚠ engine catalog has ${problems.length} validation issue(s); first: ${problems[0]}`);
}

// Drop only entries that are structurally unusable so one bad niche can't
// take the engine down.
const badIds = new Set(
  problems
    .filter((p) => /is required|must be an array|not an object|not in ARCHETYPES/.test(p))
    .map((p) => p.match(/^\[([^\]]+)\]/)?.[1])
);

export const NICHES = all.filter((n, i, arr) => n && !badIds.has(n.id) && arr.findIndex((x) => x.id === n.id) === i);

const BY_ID = new Map(NICHES.map((n) => [n.id, n]));

export function getNiche(id) {
  return BY_ID.get(id) || null;
}

export function fallbackFor(archetype) {
  return (
    NICHES.find((n) => n.id.startsWith("general-") && n.archetype === archetype) ||
    getNiche("general-local-business") ||
    NICHES[0] ||
    null
  );
}

export function listNiches() {
  return NICHES.filter((n) => !n.id.startsWith("general-")).map(({ id, name, group, archetype }) => ({
    id, name, group, archetype,
  }));
}
