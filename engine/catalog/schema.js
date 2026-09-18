// server/engine/catalog/schema.js
// Contract for niche catalog entries. Every catalog file default-exports an
// array of niches; validateNiche() is the single source of truth for shape and
// length limits (the engine clamps to the same LIMITS at generation time).

export const GROUPS = [
  "retail", "food", "hospitality", "services", "health", "tech", "business",
  "creative", "education", "community", "events", "personal",
];

export const ARCHETYPES = [
  "store", "restaurant", "saas", "agency", "local", "portfolio", "event",
  "nonprofit", "listing", "education", "creator", "hotel",
];

export const STYLE_TAGS = [
  "clean", "minimal", "luxury", "bold", "playful", "warm", "earthy", "dark",
  "tech", "corporate", "elegant", "vibrant", "soft", "retro", "editorial", "organic",
];

// Visual pools in ../images.js. A niche names one instead of carrying photo ids,
// so imagery is verified once and reused across related niches.
export const POOL_KEYS = [
  "eyewear", "fashion", "jewelry", "shoes", "beauty", "skincare", "perfume",
  "furniture", "homedecor", "electronics", "mobile", "books", "toys", "pets",
  "grocery", "organic", "plants", "flowers", "sports", "bicycle", "crafts",
  "art", "gifts", "stationery", "coffee", "tea", "supplements", "cars",
  "restaurant", "cafe", "bakery", "pizza", "burger", "bar", "sweets", "juice",
  "icecream", "sushi", "indianfood", "streetfood", "hotel", "resort", "homestay",
  "hostel", "travel", "adventure", "banquet",
  "salon", "barber", "makeup", "nails", "spa", "gym", "yoga", "dental", "clinic",
  "physio", "therapy", "vet", "pharmacy", "lab", "ayurveda", "skinclinic",
  "plumber", "electrician", "cleaning", "pestcontrol", "movers", "autorepair",
  "carwash", "law", "accounting", "insurance", "realestate", "architecture",
  "interior", "construction", "wedding", "events", "photography", "laundry",
  "tailor", "printing", "security", "itsupport", "coworking", "driving",
  "saas", "mobileapp", "ai", "devtools", "fintech", "web3", "edtech", "fitnessapp",
  "startup", "product", "devagency", "marketing", "branding", "seo", "socialmedia",
  "video", "consulting", "recruitment", "logistics", "manufacturing", "trading",
  "course", "coaching", "tuition", "school", "college", "language", "music",
  "ngo", "religious", "community", "animalshelter", "conference", "weddingsite",
  "festival", "workshop", "podcast", "youtube", "blog", "newsletter", "band",
  "developer", "frontend", "backend", "gamedev", "datascience", "aiml", "devops",
  "cybersecurity", "student", "mba", "productmanager", "marketer", "research",
  "teacher", "doctor", "freelancer", "uxdesign", "graphicdesign", "illustration",
  "photographer", "filmmaker", "architect", "fashiondesign", "model", "writer",
  "trainer", "business", "office", "team", "abstract", "shop",
];

export const LIMITS = {
  brand: 28, label: 32, heading: 60, sub: 150, cta: 20,
  itemTitle: 28, itemDesc: 110, icon: 4,
  statNum: 8, statLabel: 22,
  aboutHeading: 50, body: 260,
  quote: 140, person: 24, role: 30,
  question: 70, answer: 200,
  showName: 30, showMeta: 18, showDetails: 60,
  plan: 16, price: 10, period: 8, planDesc: 60, planFeature: 32,
  tlTitle: 36, tlDesc: 110, tlYear: 12,
  seoTitle: 60, seoDesc: 155,
};

const POOL_SET = new Set(POOL_KEYS);

function str(errors, path, v, max, { required = true } = {}) {
  if (v === undefined || v === null) {
    if (required) errors.push(`${path} is required`);
    return;
  }
  if (typeof v !== "string" || !v.trim()) return errors.push(`${path} must be a non-empty string`);
  if (v.length > max) errors.push(`${path} is ${v.length} chars (max ${max})`);
  if (v.includes("|")) errors.push(`${path} must not contain "|"`);
}

function list(errors, path, v, { min, max }) {
  if (!Array.isArray(v)) { errors.push(`${path} must be an array`); return []; }
  if (v.length < min || v.length > max) errors.push(`${path} needs ${min}-${max} items (has ${v.length})`);
  return v;
}

function head(errors, path, block, { sub = false } = {}) {
  str(errors, `${path}.label`, block.label, LIMITS.label);
  str(errors, `${path}.heading`, block.heading, LIMITS.heading);
  if (sub) str(errors, `${path}.sub`, block.sub, LIMITS.sub, { required: false });
}

export function validateNiche(n) {
  const errors = [];
  if (!n || typeof n !== "object") return ["niche is not an object"];
  const at = n.id || "(no id)";

  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(n.id || "")) errors.push("id must be kebab-case");
  str(errors, "name", n.name, 40);
  if (!GROUPS.includes(n.group)) errors.push(`group "${n.group}" not in GROUPS`);
  if (!ARCHETYPES.includes(n.archetype)) errors.push(`archetype "${n.archetype}" not in ARCHETYPES`);

  const kws = list(errors, "keywords", n.keywords, { min: 6, max: 30 });
  for (const k of kws) {
    if (typeof k !== "string" || k !== k.toLowerCase() || !k.trim()) errors.push(`keyword "${k}" must be lowercase non-empty`);
  }
  if (n.negative !== undefined) list(errors, "negative", n.negative, { min: 1, max: 20 });

  const moods = list(errors, "mood", n.mood, { min: 1, max: 3 });
  for (const m of moods) if (!STYLE_TAGS.includes(m)) errors.push(`mood "${m}" not in STYLE_TAGS`);

  if (!POOL_SET.has(n.images)) errors.push(`images "${n.images}" is not a POOL_KEYS entry`);

  const c = n.copy || {};
  str(errors, "copy.brand", c.brand, LIMITS.brand);
  str(errors, "copy.label", c.label, LIMITS.label);
  str(errors, "copy.heading", c.heading, LIMITS.heading);
  str(errors, "copy.sub", c.sub, LIMITS.sub);
  str(errors, "copy.cta1", c.cta1, LIMITS.cta);
  str(errors, "copy.cta2", c.cta2, LIMITS.cta);

  const off = c.offerings || {};
  head(errors, "copy.offerings", off, { sub: true });
  for (const [i, it] of list(errors, "copy.offerings.items", off.items, { min: 6, max: 6 }).entries()) {
    str(errors, `copy.offerings.items[${i}].title`, it?.title, LIMITS.itemTitle);
    str(errors, `copy.offerings.items[${i}].desc`, it?.desc, LIMITS.itemDesc);
    str(errors, `copy.offerings.items[${i}].icon`, it?.icon, LIMITS.icon);
  }

  for (const [i, s] of list(errors, "copy.stats", c.stats, { min: 4, max: 4 }).entries()) {
    str(errors, `copy.stats[${i}].num`, s?.num, LIMITS.statNum);
    str(errors, `copy.stats[${i}].label`, s?.label, LIMITS.statLabel);
  }

  const ab = c.about || {};
  str(errors, "copy.about.label", ab.label, LIMITS.label);
  str(errors, "copy.about.heading", ab.heading, LIMITS.aboutHeading);
  str(errors, "copy.about.body1", ab.body1, LIMITS.body);
  str(errors, "copy.about.body2", ab.body2, LIMITS.body);

  const te = c.testimonials || {};
  head(errors, "copy.testimonials", te);
  for (const [i, t] of list(errors, "copy.testimonials.items", te.items, { min: 3, max: 3 }).entries()) {
    str(errors, `copy.testimonials.items[${i}].quote`, t?.quote, LIMITS.quote);
    str(errors, `copy.testimonials.items[${i}].name`, t?.name, LIMITS.person);
    str(errors, `copy.testimonials.items[${i}].role`, t?.role, LIMITS.role);
  }

  const fq = c.faq || {};
  head(errors, "copy.faq", fq);
  for (const [i, f] of list(errors, "copy.faq.items", fq.items, { min: 4, max: 4 }).entries()) {
    str(errors, `copy.faq.items[${i}].q`, f?.q, LIMITS.question);
    str(errors, `copy.faq.items[${i}].a`, f?.a, LIMITS.answer);
  }

  const ct = c.cta || {};
  str(errors, "copy.cta.heading", ct.heading, LIMITS.heading);
  str(errors, "copy.cta.sub", ct.sub, LIMITS.sub);
  str(errors, "copy.cta.button", ct.button, LIMITS.cta);

  const seo = c.seo || {};
  str(errors, "copy.seo.title", seo.title, LIMITS.seoTitle);
  str(errors, "copy.seo.description", seo.description, LIMITS.seoDesc);

  if (c.showcase !== undefined) {
    head(errors, "copy.showcase", c.showcase);
    for (const [i, s] of list(errors, "copy.showcase.items", c.showcase.items, { min: 3, max: 6 }).entries()) {
      str(errors, `copy.showcase.items[${i}].name`, s?.name, LIMITS.showName);
      str(errors, `copy.showcase.items[${i}].meta`, s?.meta, LIMITS.showMeta);
      str(errors, `copy.showcase.items[${i}].details`, s?.details, LIMITS.showDetails);
    }
  }

  if (c.pricing !== undefined) {
    head(errors, "copy.pricing", c.pricing);
    for (const [i, p] of list(errors, "copy.pricing.plans", c.pricing.plans, { min: 3, max: 3 }).entries()) {
      str(errors, `copy.pricing.plans[${i}].plan`, p?.plan, LIMITS.plan);
      str(errors, `copy.pricing.plans[${i}].price`, p?.price, LIMITS.price);
      str(errors, `copy.pricing.plans[${i}].period`, p?.period, LIMITS.period, { required: false });
      str(errors, `copy.pricing.plans[${i}].desc`, p?.desc, LIMITS.planDesc);
      for (const [j, f] of list(errors, `copy.pricing.plans[${i}].features`, p?.features, { min: 3, max: 4 }).entries()) {
        str(errors, `copy.pricing.plans[${i}].features[${j}]`, f, LIMITS.planFeature);
      }
    }
  }

  if (c.timeline !== undefined) {
    head(errors, "copy.timeline", c.timeline);
    for (const [i, t] of list(errors, "copy.timeline.items", c.timeline.items, { min: 3, max: 4 }).entries()) {
      str(errors, `copy.timeline.items[${i}].title`, t?.title, LIMITS.tlTitle);
      str(errors, `copy.timeline.items[${i}].desc`, t?.desc, LIMITS.tlDesc);
      str(errors, `copy.timeline.items[${i}].year`, t?.year, LIMITS.tlYear);
    }
  }

  if (c.team !== undefined) {
    head(errors, "copy.team", c.team);
    for (const [i, t] of list(errors, "copy.team.items", c.team.items, { min: 3, max: 3 }).entries()) {
      str(errors, `copy.team.items[${i}].name`, t?.name, LIMITS.person);
      str(errors, `copy.team.items[${i}].title`, t?.title, LIMITS.role);
      str(errors, `copy.team.items[${i}].bio`, t?.bio, LIMITS.itemDesc);
    }
  }

  const needsShowcase = ["store", "restaurant", "listing", "hotel", "portfolio", "creator"];
  if (needsShowcase.includes(n.archetype) && c.showcase === undefined) errors.push(`archetype ${n.archetype} requires copy.showcase`);
  if (["saas", "education"].includes(n.archetype) && c.pricing === undefined) errors.push(`archetype ${n.archetype} requires copy.pricing`);
  if (["portfolio", "event"].includes(n.archetype) && c.timeline === undefined) errors.push(`archetype ${n.archetype} requires copy.timeline`);

  return errors.map((e) => `[${at}] ${e}`);
}

export function validateCatalog(niches) {
  const errors = [];
  const ids = new Set();
  for (const n of niches) {
    if (ids.has(n?.id)) errors.push(`[${n.id}] duplicate id`);
    ids.add(n?.id);
    errors.push(...validateNiche(n));
  }
  return errors;
}
