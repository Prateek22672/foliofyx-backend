// server/engine/intent.js
// Deterministic prompt understanding — no API calls. Extracts the niche,
// brand / person name, role, location + currency, tone, colours and the
// sections the user explicitly asked for (or asked to leave out).

import { NICHES, getNiche, fallbackFor } from "./catalog/index.js";
import { colorFromWords } from "./styles.js";

// ── Text normalisation ────────────────────────────────────────────────────────
export function stem(w) {
  if (w.length <= 3) return w;
  if (w.endsWith("ies") && w.length > 4) return `${w.slice(0, -3)}y`;
  if (/(sses|xes|ches|shes|zes)$/.test(w)) return w.slice(0, -2);
  if (w.endsWith("s") && !/(ss|us|is|os)$/.test(w)) return w.slice(0, -1);
  return w;
}

const SPELLING = [
  [/\bparlour/g, "parlor"], [/\bcolour/g, "color"], [/\bjewellery\b/g, "jewelry"], [/\bjeweller/g, "jeweler"],
  [/\bcentre/g, "center"], [/\borganisation/g, "organization"], [/\btheatre/g, "theater"], [/\bcatalogue/g, "catalog"],
  [/\bprogramme/g, "program"], [/\bcosy\b/g, "cozy"], [/\bpractise/g, "practice"], [/\bfavourite/g, "favorite"],
  [/\bspecialis/g, "specializ"], [/\bgrey\b/g, "gray"], [/\bbeautician/g, "beauty"],
];

export function normalize(text = "") {
  let s = String(text).toLowerCase();
  for (const [re, to] of SPELLING) s = s.replace(re, to);
  return s
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/(\w)\.(\w)/g, "$1$2")
    .replace(/[^a-z0-9+#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const toStems = (text) => normalize(text).split(" ").filter(Boolean).map(stem);

function containsSeq(hay, needle) {
  if (!needle.length || needle.length > hay.length) return false;
  outer: for (let i = 0; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

// ── Keyword index (built once) ────────────────────────────────────────────────
// Two signals: whole keyword phrases (strong), and single keyword tokens
// weighted by rarity across the catalog (a tiny TF-IDF model) so prompts that
// only share a distinctive word ("veterinary", "stray") still land correctly.
const STOP = new Set([
  "a", "an", "the", "and", "or", "for", "of", "to", "in", "on", "at", "by", "with", "my", "our", "your", "me", "i", "we",
  "website", "site", "page", "web", "online", "service", "business", "company", "shop", "store", "brand", "studio",
  "agency", "center", "app", "platform", "portfolio", "professional", "best", "new", "local", "services", "product",
  "practice", "firm", "group", "team", "work", "owner",
]);

const INDEX = NICHES.map((n) => {
  const keywords = [...new Set([...(n.keywords || []), n.name])].map((k) => toStems(k)).filter((s) => s.length);
  return {
    niche: n,
    keywords,
    tokens: new Set(keywords.flat().filter((t) => t.length > 2 && !STOP.has(t))),
    negative: (n.negative || []).map((k) => toStems(k)).filter((s) => s.length),
    generic: n.id.startsWith("general-"),
  };
});

const TOKEN_DF = new Map();
for (const e of INDEX) {
  if (e.generic) continue;
  for (const t of e.tokens) TOKEN_DF.set(t, (TOKEN_DF.get(t) || 0) + 1);
}

const PERSONAL_RE = /\b(portfolio|resume|cv|my work|about me|hire me|personal (site|website|page|brand)|i am a|i am an|im a|im an|myself|fresher|student|job hunt|placement|internship)\b/;
const BUSINESS_RE = /\b(my|our) (shop|store|business|company|firm|clinic|salon|restaurant|cafe|studio|agency|brand|startup|hotel|school|academy|team|practice|center|centre)\b|\bwe are\b|\bwere a\b/;
const SELLING_RE = /\b(sell|selling|buy|order online|ecommerce|e commerce|online store|online shop|shop online|product catalog|add to cart)\b/;

function scoreNiches(stems, norm) {
  const personal = PERSONAL_RE.test(norm);
  const business = BUSINESS_RE.test(norm);
  const selling = SELLING_RE.test(norm);

  const promptTokens = [...new Set(stems.filter((t) => t.length > 2 && !STOP.has(t)))];
  const scored = [];
  for (const entry of INDEX) {
    let score = 0;
    let hits = 0;
    const covered = new Set();
    for (const kw of entry.keywords) {
      if (containsSeq(stems, kw)) {
        score += 2 + 1.5 * (kw.length - 1);
        hits++;
        kw.forEach((t) => covered.add(t));
      }
    }
    if (!entry.generic) {
      for (const t of promptTokens) {
        if (covered.has(t) || !entry.tokens.has(t)) continue;
        score += 1.4 / Math.sqrt(TOKEN_DF.get(t) || 1);
        hits += 0.5;
      }
    }
    if (!hits) continue;
    for (const neg of entry.negative) if (containsSeq(stems, neg)) score -= 4;
    if (entry.generic) score *= 0.6;
    const a = entry.niche.archetype;
    if (personal && a === "portfolio") score += 2.5;
    if (business && a !== "portfolio") score += 1.5;
    if (selling && a === "store") score += 1.5;
    if (score > 0) scored.push({ niche: entry.niche, score, hits, generic: entry.generic });
  }
  // Generic fallbacks only compete when nothing specific matched convincingly.
  const specific = scored.some((s) => !s.generic && s.score >= 1.3);
  return scored
    .filter((s) => !(specific && s.generic))
    .sort((a, b) => b.score - a.score || b.hits - a.hits);
}

function guessArchetype(norm) {
  if (PERSONAL_RE.test(norm)) return "portfolio";
  if (SELLING_RE.test(norm)) return "store";
  if (/\b(app|software|saas|platform|startup|ai tool|dashboard|api)\b/.test(norm)) return "saas";
  if (/\b(food|restaurant|cafe|menu|kitchen|dine|dining)\b/.test(norm)) return "restaurant";
  if (/\b(event|conference|wedding|festival|summit|meetup)\b/.test(norm)) return "event";
  if (/\b(course|class|school|academy|coaching|tuition|training)\b/.test(norm)) return "education";
  if (/\b(ngo|charity|nonprofit|non profit|foundation|volunteer|donat)/.test(norm)) return "nonprofit";
  if (/\b(blog|podcast|youtube|channel|creator|newsletter|vlog)\b/.test(norm)) return "creator";
  if (/\b(hotel|resort|stay|homestay|rooms|guest ?house)\b/.test(norm)) return "hotel";
  if (/\b(agency|consult|marketing|design studio)\b/.test(norm)) return "agency";
  return "local";
}

// ── Tone / mode / sections ────────────────────────────────────────────────────
const MOOD_WORDS = [
  [/\b(luxury|luxurious|premium|high end|upscale|exclusive|lavish)\b/, ["luxury", "elegant"]],
  [/\b(minimal|minimalist|simple|clean|sleek|uncluttered)\b/, ["minimal", "clean"]],
  [/\b(modern|contemporary|fresh)\b/, ["clean"]],
  [/\b(elegant|classy|sophisticated|graceful|refined)\b/, ["elegant"]],
  [/\b(bold|striking|loud|confident|powerful)\b/, ["bold"]],
  [/\b(playful|fun|quirky|cute|colorful|colourful|kids)\b/, ["playful", "vibrant"]],
  [/\b(vibrant|bright|energetic|lively|neon)\b/, ["vibrant"]],
  [/\b(warm|cozy|cosy|homely|rustic|friendly)\b/, ["warm"]],
  [/\b(natural|organic|eco|green living|sustainable|earthy)\b/, ["organic", "earthy"]],
  [/\b(retro|vintage|classic|old school|nostalgic)\b/, ["retro"]],
  [/\b(corporate|professional|formal|trustworthy|business like)\b/, ["corporate"]],
  [/\b(techy|futuristic|tech|developer|cyber|hacker)\b/, ["tech"]],
  [/\b(soft|pastel|calm|gentle|serene|peaceful)\b/, ["soft"]],
  [/\b(editorial|magazine|typographic|artsy)\b/, ["editorial"]],
];

const SECTION_WORDS = {
  pricing: /\b(pricing|price list|prices|plans|packages|rates|tariff|fees)\b/,
  faq: /\b(faq|faqs|questions)\b/,
  team: /\b(team|staff|doctors|our people|instructors|speakers|faculty)\b/,
  testimonials: /\b(testimonials|reviews|feedback|what clients say)\b/,
  gallery: /\b(gallery|photos|pictures|portfolio images)\b/,
  contact: /\b(contact|contact form|enquiry|inquiry|reach us|get in touch|booking form|appointment form)\b/,
  timeline: /\b(timeline|experience|journey|schedule|agenda|itinerary|history)\b/,
  stats: /\b(stats|numbers|achievements|milestones)\b/,
  showcase: /\b(products|menu|projects|listings|rooms|work samples|catalog|collection)\b/,
};

function detectSections(norm) {
  const include = [];
  const exclude = [];
  for (const [key, re] of Object.entries(SECTION_WORDS)) {
    const m = norm.match(re);
    if (!m) continue;
    const before = norm.slice(Math.max(0, m.index - 22), m.index);
    if (/\b(no|without|skip|remove|dont need|dont want|not)\b[^.]*$/.test(before)) exclude.push(key);
    else include.push(key);
  }
  return { include, exclude };
}

// ── Location → currency ───────────────────────────────────────────────────────
const CURRENCIES = {
  IN: { code: "INR", symbol: "₹", rate: 83, locale: "en-IN" },
  GB: { code: "GBP", symbol: "£", rate: 0.79, locale: "en-GB" },
  EU: { code: "EUR", symbol: "€", rate: 0.92, locale: "de-DE" },
  AE: { code: "AED", symbol: "AED ", rate: 3.67, locale: "en-AE" },
  CA: { code: "CAD", symbol: "C$", rate: 1.36, locale: "en-CA" },
  AU: { code: "AUD", symbol: "A$", rate: 1.52, locale: "en-AU" },
  SG: { code: "SGD", symbol: "S$", rate: 1.35, locale: "en-SG" },
  US: { code: "USD", symbol: "$", rate: 1, locale: "en-US" },
};

const PLACES = {
  IN: ["india", "mumbai", "bombay", "delhi", "new delhi", "bangalore", "bengaluru", "hyderabad", "chennai", "kolkata", "pune", "ahmedabad", "jaipur", "lucknow", "kochi", "cochin", "indore", "bhopal", "nagpur", "surat", "vadodara", "chandigarh", "noida", "gurgaon", "gurugram", "goa", "coimbatore", "madurai", "mysore", "mysuru", "visakhapatnam", "vizag", "vijayawada", "patna", "ranchi", "bhubaneswar", "guwahati", "dehradun", "amritsar", "ludhiana", "kanpur", "varanasi", "agra", "nashik", "thane", "navi mumbai", "trivandrum", "thiruvananthapuram", "mangalore", "hubli", "warangal", "tirupati", "raipur", "jodhpur", "udaipur", "kerala", "karnataka", "tamil nadu", "telangana", "andhra pradesh", "maharashtra", "gujarat", "rajasthan", "punjab", "west bengal", "bihar", "odisha", "assam"],
  GB: ["uk", "united kingdom", "england", "london", "manchester", "birmingham", "liverpool", "leeds", "glasgow", "edinburgh", "bristol", "scotland", "wales"],
  EU: ["germany", "berlin", "munich", "france", "paris", "lyon", "spain", "madrid", "barcelona", "italy", "rome", "milan", "netherlands", "amsterdam", "ireland", "dublin", "portugal", "lisbon", "belgium", "brussels", "austria", "vienna", "finland", "helsinki", "greece", "athens"],
  AE: ["dubai", "abu dhabi", "sharjah", "uae", "united arab emirates"],
  CA: ["canada", "toronto", "vancouver", "montreal", "calgary", "ottawa"],
  AU: ["australia", "sydney", "melbourne", "brisbane", "perth", "adelaide"],
  SG: ["singapore"],
  US: ["usa", "united states", "america", "new york", "nyc", "los angeles", "san francisco", "chicago", "houston", "austin", "seattle", "boston", "miami", "denver", "atlanta", "dallas", "texas", "california", "florida"],
};

const PLACE_INDEX = Object.entries(PLACES)
  .flatMap(([country, names]) => names.map((name) => ({ country, name, stems: normalize(name).split(" ") })))
  .sort((a, b) => b.stems.length - a.stems.length);

function detectCountry(norm, rawLower) {
  if (/₹|\brupees?\b|\binr\b|\brs\b/.test(rawLower)) return "IN";
  if (/£|\bpounds?\b|\bgbp\b/.test(rawLower)) return "GB";
  if (/€|\beuros?\b/.test(rawLower)) return "EU";
  if (/\baed\b|\bdirhams?\b/.test(rawLower)) return "AE";
  const words = norm.split(" ");
  for (const p of PLACE_INDEX) if (containsSeq(words, p.stems)) return p.country;
  return null;
}

// ── Names ─────────────────────────────────────────────────────────────────────
const LEADING_NOISE = new Set([
  "create", "make", "build", "design", "generate", "need", "want", "please", "hi", "hello", "hey",
  "website", "site", "page", "landing", "portfolio", "a", "an", "the", "my", "our", "i", "im", "we",
  "for", "can", "could", "you", "help", "me", "new", "modern", "simple", "professional", "beautiful",
  "online", "business", "company", "store", "shop", "and", "with", "in", "at", "is", "it", "its",
]);

const ACRONYMS = new Set(["AI", "ML", "UX", "UI", "CSE", "IT", "SEO", "JEE", "NEET", "CA", "GST", "SaaS", "API", "B2B", "D2C", "CEO", "USA", "UK", "UAE", "NGO", "MBA", "BTech", "B.Tech", "MERN", "HR", "PR", "3D", "AR", "VR", "IIT", "NIT"]);

const STOP_AFTER = /^(in|at|from|based|located|with|that|which|who|where|and|for|to|near|,|\.|—|-|selling|offering|providing|specializing|specialising)$/i;

// Capitalised tools/platforms people mention that are never the brand.
const NOT_A_BRAND = /\b(power bi|react|node|next\.?js|vue|angular|flutter|android|ios|figma|excel|python|java|javascript|typescript|google|aws|azure|gcp|tableau|tensorflow|pytorch|sql|mongodb|docker|kubernetes|adobe|photoshop|illustrator|instagram|youtube|linkedin|github|shopify|wordpress|canva|notion|whatsapp|facebook|tiktok|chatgpt|openai|mern|mean|django|flask|spring|laravel|php|c\+\+|golang|rust|swift|kotlin|unity|unreal|blender)\b/i;

function titleCase(s) {
  return s.replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

function cleanName(s = "") {
  return s.replace(/^[\s"'“”‘’]+|[\s"'“”‘’.,;:!?]+$/g, "").replace(/\s+/g, " ").trim();
}

function takeWords(fragment, max = 5) {
  const out = [];
  for (const w of fragment.split(/\s+/)) {
    if (!w) continue;
    const bare = w.replace(/[,.;:!?]+$/, "");
    if (STOP_AFTER.test(bare) && out.length) break;
    out.push(bare);
    if (w !== bare || out.length >= max) break;
  }
  return out.join(" ");
}

function isCapitalizedWord(w) {
  return /^[A-Z0-9][\w'’&.-]*$/.test(w) && !ACRONYMS.has(w);
}

function extractNames(raw) {
  const text = String(raw).replace(/\s+/g, " ").trim();
  let brand = null;
  let person = null;
  let role = null;
  let location = null;

  // Person: "I'm Priya Sharma", "I am John", "my name is Ana", "for me, Ananya".
  const personMatch =
    text.match(/\bmy name is\s+([A-Za-z][A-Za-z'’.-]*(?:\s+[A-Z][A-Za-z'’.-]*){0,2})/i) ||
    text.match(/\b(?:I'm|I’m|Im|I am)\s+([A-Z][a-z'’.-]+(?:\s+[A-Z][a-z'’.-]+){0,2})(?=[\s,.!]|$)/) ||
    text.match(/\bfor me,?\s+([A-Z][a-z'’.-]+(?:\s+[A-Z][a-z'’.-]+){0,2})/);
  if (personMatch) {
    const cand = cleanName(personMatch[1]);
    const first = cand.split(" ")[0];
    if (!/^(a|an|the|looking|building|starting|currently|and|i|i'm|i’m|im|me|my|we|us|our|just|also)$/i.test(first)) person = titleCase(cand);
  }

  // Quoted names are the most explicit brand signal.
  const quoted = text.match(/["“‘']([^"”’']{2,40})["”’']/);
  if (quoted) brand = cleanName(quoted[1]);

  // "called X" / "named X" / "brand is X" (but not "my name is X", handled above).
  if (!brand) {
    const m = text.match(/\b(?:called|named|brand(?: name)? is|business name is|company name is|shop name is|store name is|titled)\s+(.{2,60})/i);
    if (m) {
      const candidate = cleanName(takeWords(m[1], 5));
      if (candidate) brand = candidate[0] === candidate[0].toLowerCase() ? titleCase(candidate) : candidate;
    }
  }

  // Role: "I'm a UX designer", "as a data scientist", "who is a final-year CSE student".
  const ROLE_TAIL = "([A-Za-z][\\w+#.\\- ]{2,60}?)(?=\\s+(?:who|with|based|from|in|at|and|looking|that|currently|specializing|specialising)\\b|[,.!;]|$)";
  const roleMatch =
    text.match(new RegExp(`\\b(?:I'm|I’m|Im|I am|as|who is|she is|he is|they are)\\s+(?:a|an)\\s+${ROLE_TAIL}`, "i")) ||
    (person && text.match(new RegExp(`${person.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[,\\s]+(?:a|an)\\s+${ROLE_TAIL}`, "i")));
  if (roleMatch) role = cleanName(roleMatch[1]);

  // Location: "in Pune", "based in New Delhi", "located at Koramangala, Bangalore".
  const locMatch = text.match(/\b(?:based in|located in|located at|in|at|from)\s+([A-Z][a-zA-Z.-]+(?:[\s,]+[A-Z][a-zA-Z.-]+){0,2})/);
  if (locMatch) location = cleanName(locMatch[1]).replace(/,\s*$/, "");

  // Capitalised span before a niche noun: "Dr. Rao's Smile Care dental clinic".
  if (!brand) {
    const words = text.split(" ");
    const ABBREV = /^(Dr|Mr|Mrs|Ms|St|Jr|Sr|Co|Inc|Ltd)\.$/;
    let best = null;
    for (let i = 0; i < words.length; i++) {
      if (!isCapitalizedWord(words[i].replace(/[,.;:!?]+$/, ""))) continue;
      const span = [];
      let j = i;
      let appositive = false;
      while (j < words.length) {
        const rawWord = words[j];
        const w = ABBREV.test(rawWord) ? rawWord : rawWord.replace(/[,.;:!?]+$/, "");
        const connector = /^(&|and|of|the|de|la|by)$/i.test(w) && span.length;
        if (!(isCapitalizedWord(w) || connector)) break;
        span.push(w);
        j++;
        if (w !== rawWord) {
          appositive = /,$/.test(rawWord) && /^(a|an|the)$/i.test(words[j] || "");
          break;
        }
      }
      while (span.length && /^(&|and|of|the|de|la|by)$/i.test(span[span.length - 1])) span.pop();
      const lowered = span.map((w) => w.toLowerCase().replace(/['’]/g, ""));
      const noisy = lowered.every((w) => LEADING_NOISE.has(w));
      const preceded = (words[i - 1] || "").toLowerCase();
      const joined = span.join(" ");
      const isPerson = person && (joined === person || person.includes(joined));
      const isPlace = location && (joined === location || location.includes(joined) || joined.startsWith(location));
      const introduced = /^(for|of|called|named|by)$/.test(preceded);
      const possessive = /['’]s$/.test(span[span.length - 1] || "");
      const plausible = span.length >= 2 || introduced || appositive || possessive;
      if (span.length && !noisy && !isPerson && !isPlace && plausible && i > 0 && !NOT_A_BRAND.test(joined)) {
        const score = span.length + (introduced ? 2 : 0) + (appositive ? 1 : 0);
        if (!best || score > best.score) best = { name: joined.replace(/['’]s$/, possessive && !introduced ? "" : "$&"), score };
      }
      i = Math.max(i, j - 1);
    }
    if (best) brand = cleanName(best.name.replace(/^(The|A|An|My|Our)\s+(?=[A-Z])/, (m) => (m.trim() === "The" ? m : "")));
  }

  if (brand && brand.length > 28) brand = brand.split(" ").slice(0, 4).join(" ").slice(0, 28).trim();
  if (person && person.length > 28) person = person.split(" ").slice(0, 3).join(" ");
  if (role && role.length > 32) role = role.split(" ").slice(0, 5).join(" ").slice(0, 32).trim();
  if (brand && person && brand.toLowerCase() === person.toLowerCase()) brand = null;

  return { brand, person, role, location };
}

// ── Public API ────────────────────────────────────────────────────────────────
export function parseIntent(prompt = "", { nicheId = null } = {}) {
  const raw = String(prompt).slice(0, 3000);
  const norm = normalize(raw);
  const stems = norm.split(" ").filter(Boolean).map(stem);

  const names = extractNames(raw);
  // A named person with no business name is almost always a personal site.
  const personalHint = Boolean((names.person || names.role) && !names.brand);

  const ranked = scoreNiches(stems, personalHint ? `${norm} portfolio` : norm);
  let niche = nicheId ? getNiche(nicheId) : null;
  let confidence = niche ? 1 : 0;
  if (!niche) {
    const top = ranked[0];
    if (top && top.score >= 1.3) {
      niche = top.niche;
      const second = ranked[1]?.score || 0;
      confidence = Math.min(1, top.score / 6) * (second ? Math.min(1, (top.score - second) / 2 + 0.5) : 1);
    } else {
      niche = fallbackFor(personalHint ? "portfolio" : guessArchetype(norm));
      confidence = 0.2;
    }
  }

  const moods = [...new Set(MOOD_WORDS.flatMap(([re, tags]) => (re.test(norm) ? tags : [])))];
  let mode = null;
  if (/\b(dark (mode|theme|background|look|design|colors?|colours?|palette|aesthetic|style|website|site)|black (theme|background)|dark and (moody|elegant|bold|sleek|minimal)|(make|keep) it dark|in dark)\b/.test(norm)) mode = "dark";
  if (/\b(light (mode|theme|background)|white (theme|background)|bright background)\b/.test(norm)) mode = "light";

  const country = detectCountry(norm, raw.toLowerCase());

  return {
    raw,
    normalized: norm,
    niche,
    confidence: Number(confidence.toFixed(2)),
    alternatives: ranked.filter((r) => r.niche.id !== niche?.id).slice(0, 3).map((r) => ({ id: r.niche.id, name: r.niche.name })),
    ...names,
    country,
    currency: country ? CURRENCIES[country] : null,
    moods,
    mode,
    color: colorFromWords(raw),
    sections: detectSections(norm),
  };
}

export { CURRENCIES };
