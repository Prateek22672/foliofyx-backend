// server/data/pageTemplates.js
// ─────────────────────────────────────────────────────────────────────────────
// Curated, designer-quality PAGE TEMPLATES — one per domain.
//
// Why this exists:
//   LLMs are bad at pixel-positioning a whole page from scratch (overlaps, ugly
//   spacing, broken hierarchy). So instead of asking Groq to invent the layout,
//   we keep these proven, hand-built layouts and let Groq only rewrite the TEXT
//   to match the user's brief (see aiBuilderController.personalizeCopy).
//
// Each template is composed from reusable section builders so spacing/columns
// stay consistent. Canvas is 1200px wide; inner content lives at x:100..1100.
// ─────────────────────────────────────────────────────────────────────────────

import { SHADOWS } from "./designSystem.js";

const CANVAS_W = 1200;
const MARGIN = 100;
const INNER = CANVAS_W - MARGIN * 2; // 1000

const img = (id) => `https://images.unsplash.com/photo-${id}?w=1200&q=85&fit=crop`;

// ── Domain palettes ───────────────────────────────────────────────────────────
// `hero` / `about` are Unsplash photo ids used by the hero and story sections.
const PALETTES = {
  saas:       { bg: "#f8f9ff", band: "#ffffff", accent: "#6366f1", accent2: "#7c3aed", card: "#ffffff", text: "#0f172a", muted: "#64748b", head: "Space Grotesk", body: "Outfit", dark: false, hero: "1551434678-e076c223a692", about: "1522071820081-009f0129c71c" },
  marketing:  { bg: "#0a0a0f", band: "#0f0f17", accent: "#818cf8", accent2: "#8b5cf6", card: "#14141f", text: "#f1f5f9", muted: "#94a3b8", head: "Syne", body: "DM Sans", dark: true, hero: "1497366216548-37526070297c", about: "1552664730-d307ca884978" },
  realestate: { bg: "#faf9f7", band: "#ffffff", accent: "#059669", accent2: "#047857", card: "#ffffff", text: "#1c1917", muted: "#78716c", head: "Playfair Display", body: "DM Sans", dark: false, hero: "1560518883-ce09059eeffa", about: "1600585154340-be6161a56a0c" },
  restaurant: { bg: "#1a0f0a", band: "#241510", accent: "#f59e0b", accent2: "#d97706", card: "#261510", text: "#fef3c7", muted: "#b08968", head: "Playfair Display", body: "DM Sans", dark: true, hero: "1414235077428-338989a2e8c0", about: "1556910103-1c02745aae4d" },
  portfolio:  { bg: "#0c0c14", band: "#11111c", accent: "#818cf8", accent2: "#6366f1", card: "#14141f", text: "#f1f5f9", muted: "#94a3b8", head: "Syne", body: "DM Sans", dark: true, hero: "1517245386807-bb43f82c33c4", about: "1499951360447-b19be8fe80f5" },
  general:    { bg: "#0f172a", band: "#162033", accent: "#6366f1", accent2: "#8b5cf6", card: "#1e293b", text: "#f1f5f9", muted: "#94a3b8", head: "Syne", body: "Outfit", dark: true, hero: "1557804506-669a67965ba0", about: "1522202176988-66273c2fd55f" },
};

// Band color for a section: templates alternate "bg" and "band" tones so the
// page reads as distinct blocks (design-system banding rule).
const toneColor = (p, tone) => (tone === "band" ? p.band : p.bg);
const cardShadow = (p) => (p.dark ? SHADOWS.cardDark : SHADOWS.card);

// ── Low-level element factory (id is assigned later by compose) ───────────────
const E = (type, x, y, width, height, content, styles = {}, extra = {}) => ({
  type, x, y, width, height,
  zIndex: extra.zIndex ?? 2,
  visible: true, locked: false,
  content: content ?? "",
  src: extra.src ?? "",
  alt: extra.alt ?? "",
  href: extra.href ?? "",
  styles,
});

// Background band behind a section (so colored sections read as blocks).
const band = (y, h, color) => E("section", 0, y, CANVAS_W, h, "", { bgColor: color }, { zIndex: 1 });

// ── Section builders — each returns { els, h } already offset by `y` ──────────

function navbar(p, brand) {
  return (y) => ({
    h: 72,
    els: [
      band(y, 72, p.band),
      E("navbar", 0, y, CANVAS_W, 72, brand,
        { bgColor: "transparent", color: p.text, borderColor: p.accent, fontFamily: p.head, padding: MARGIN }),
    ],
  });
}

// Split hero: text left, image right.
function heroSplit(p, { label, heading, sub, cta1, cta2 }) {
  const H = 560;
  return (y) => ({
    h: H,
    els: [
      band(y, H, p.bg),
      E("label",     MARGIN, y + 96,  540, 20,  label,   { color: p.accent, fontFamily: p.body, letterSpacing: 3, fontWeight: "700" }),
      E("heading",   MARGIN, y + 130, 560, 150, heading, { color: p.text, fontFamily: p.head, fontSize: 56, fontWeight: "800", lineHeight: 1.08 }),
      E("paragraph", MARGIN, y + 300, 500, 80,  sub,     { color: p.muted, fontFamily: p.body, fontSize: 18, lineHeight: 1.6 }),
      E("button",    MARGIN, y + 410, 190, 52,  cta1,    { bgType: "gradient", gradientFrom: p.accent, gradientTo: p.accent2, gradientDir: "135deg", color: "#fff", borderRadius: 10, fontFamily: p.body, boxShadow: "0 10px 28px rgba(99,102,241,0.4)" }),
      E("button",    MARGIN + 206, y + 410, 170, 52, cta2, { bgColor: "transparent", bgType: "transparent", borderColor: p.text, borderWidth: 2, color: p.text, borderRadius: 10, fontFamily: p.body }),
      E("image",     680, y + 110, 420, 360, "", { borderRadius: 20, objectFit: "cover", boxShadow: SHADOWS.lift }, { src: img(p.hero), alt: heading }),
    ],
  });
}

// Overlay hero: full-bleed image + dark overlay + centered text.
function heroOverlay(p, { label, heading, sub, cta1, cta2 }) {
  const H = 600;
  return (y) => ({
    h: H,
    els: [
      E("image",   0, y, CANVAS_W, H, "", { objectFit: "cover" }, { zIndex: 1, src: img(p.hero), alt: heading }),
      E("section", 0, y, CANVAS_W, H, "", { bgType: "gradient", gradientFrom: "rgba(8,8,12,0.35)", gradientTo: "rgba(8,8,12,0.85)", gradientDir: "180deg" }, { zIndex: 2 }),
      E("label",     300, y + 170, 600, 20,  label,   { color: "#ffffff", fontFamily: p.body, letterSpacing: 4, fontWeight: "700", textAlign: "center" }, { zIndex: 3 }),
      E("heading",   200, y + 205, 800, 150, heading, { color: "#ffffff", fontFamily: p.head, fontSize: 60, fontWeight: "800", lineHeight: 1.1, textAlign: "center" }, { zIndex: 3 }),
      E("paragraph", 300, y + 372, 600, 70,  sub,     { color: "rgba(255,255,255,0.85)", fontFamily: p.body, fontSize: 19, lineHeight: 1.6, textAlign: "center" }, { zIndex: 3 }),
      E("button",    402, y + 470, 190, 54, cta1, { bgType: "gradient", gradientFrom: p.accent, gradientTo: p.accent2, gradientDir: "135deg", color: "#fff", borderRadius: 10, fontFamily: p.body, boxShadow: "0 12px 32px rgba(0,0,0,0.4)" }, { zIndex: 3 }),
      E("button",    608, y + 470, 190, 54, cta2, { bgColor: "transparent", bgType: "transparent", borderColor: "#ffffff", borderWidth: 2, color: "#ffffff", borderRadius: 10, fontFamily: p.body }, { zIndex: 3 }),
    ],
  });
}

function logos(p, brands) {
  const H = 110;
  return (y) => ({
    h: H,
    els: [
      band(y, H, p.band),
      E("logostrip", MARGIN, y + 30, INNER, 50, brands.join("|"), { color: p.muted, fontFamily: p.body, padding: 0 }),
    ],
  });
}

// Section heading block (label + heading + optional sub), centered.
function sectionHead(p, y, label, heading, sub) {
  const els = [
    E("label",   300, y, 600, 18, label, { color: p.accent, fontFamily: p.body, letterSpacing: 3, fontWeight: "700", textAlign: "center" }),
    E("heading", 250, y + 28, 700, 60, heading, { color: p.text, fontFamily: p.head, fontSize: 40, fontWeight: "800", textAlign: "center", lineHeight: 1.15 }),
  ];
  if (sub) els.push(E("paragraph", 320, y + 96, 560, 50, sub, { color: p.muted, fontFamily: p.body, fontSize: 16, lineHeight: 1.6, textAlign: "center" }));
  return els;
}

// Card grid of a composite type ("feature" | "service" | "team" | "property").
// Lays out up to 6 items in rows of 3 (menus / service lists need 6).
function cardsGrid(p, y, type, items, cardH) {
  const gap = 32;
  const w = Math.round((INNER - gap * 2) / 3);
  return items.slice(0, 6).map((c, i) => {
    const x = MARGIN + (i % 3) * (w + gap);
    const cy = y + Math.floor(i / 3) * (cardH + gap);
    return E(type, x, cy, w, cardH,
      c.content,
      { bgColor: p.card, borderColor: p.accent, color: p.text, fontFamily: p.head, borderRadius: 18, padding: 28, boxShadow: cardShadow(p) },
      c.src ? { src: c.src } : {});
  });
}

function features(p, { label, heading, sub, items, tone = "bg" }) {
  const cardH = 200;
  const gap = 32;
  const rows = Math.max(1, Math.ceil(Math.min(items.length, 6) / 3));
  const top = 226; // section head ends at ~216; cards start below it
  const H = top + rows * cardH + (rows - 1) * gap + 54;
  return (y) => ({
    h: H,
    els: [
      band(y, H, toneColor(p, tone)),
      ...sectionHead(p, y + 70, label, heading, sub),
      ...cardsGrid(p, y + top, "feature", items, cardH),
    ],
  });
}

function stats(p, items, tone = "band") {
  const H = 220;
  const gap = 32;
  const w = Math.round((INNER - gap * 3) / 4);
  return (y) => ({
    h: H,
    els: [
      band(y, H, toneColor(p, tone)),
      ...items.slice(0, 4).map((s, i) =>
        E("stats", MARGIN + i * (w + gap), y + 60, w, 100, s,
          { color: p.accent, fontFamily: p.head, fontSize: 52, textAlign: "center" })),
    ],
  });
}

// About / story band: image on the left, label + heading + two paragraphs right.
function about(p, { label, heading, body1, body2, tone = "band" }) {
  const H = 520;
  return (y) => ({
    h: H,
    els: [
      band(y, H, toneColor(p, tone)),
      E("image", MARGIN, y + 80, 440, 360, "",
        { borderRadius: 20, objectFit: "cover", boxShadow: p.dark ? SHADOWS.cardDark : SHADOWS.lift },
        { src: img(p.about || p.hero), alt: heading }),
      E("label",     600, y + 96,  460, 20,  label,   { color: p.accent, fontFamily: p.body, letterSpacing: 3, fontWeight: "700" }),
      E("heading",   600, y + 130, 480, 100, heading, { color: p.text, fontFamily: p.head, fontSize: 38, fontWeight: "800", lineHeight: 1.15 }),
      E("paragraph", 600, y + 246, 480, 84,  body1,   { color: p.muted, fontFamily: p.body, fontSize: 16, lineHeight: 1.7 }),
      E("paragraph", 600, y + 342, 480, 84,  body2,   { color: p.muted, fontFamily: p.body, fontSize: 16, lineHeight: 1.7 }),
    ],
  });
}

function pricing(p, { label, heading, plans, tone = "bg" }) {
  const H = 600;
  const gap = 32;
  const w = Math.round((INNER - gap * 2) / 3);
  return (y) => ({
    h: H,
    els: [
      band(y, H, toneColor(p, tone)),
      ...sectionHead(p, y + 64, label, heading),
      ...plans.slice(0, 3).map((pl, i) => {
        const featured = i === 1;
        return E("pricing", MARGIN + i * (w + gap), y + 200, w, 340, pl,
          featured
            ? { bgType: "gradient", gradientFrom: p.accent, gradientTo: p.accent2, gradientDir: "160deg", color: "#ffffff", fontFamily: p.head, borderRadius: 18, padding: 30, boxShadow: SHADOWS.glow(p.accent) }
            : { bgColor: p.card, borderColor: p.accent, color: p.text, fontFamily: p.head, borderRadius: 18, borderWidth: 1, padding: 30, boxShadow: cardShadow(p) });
      }),
    ],
  });
}

function testimonials(p, { label, heading, items, tone = "band" }) {
  const H = 480;
  const gap = 32;
  const w = Math.round((INNER - gap * 2) / 3);
  return (y) => ({
    h: H,
    els: [
      band(y, H, toneColor(p, tone)),
      ...sectionHead(p, y + 64, label, heading),
      ...items.slice(0, 3).map((t, i) =>
        E("testimonial", MARGIN + i * (w + gap), y + 200, w, 230, t,
          { bgColor: p.card, borderColor: p.accent, color: p.text, fontFamily: p.body, borderRadius: 18, padding: 28, boxShadow: cardShadow(p) })),
    ],
  });
}

function propertyGrid(p, { label, heading, items, tone = "bg" }) {
  const H = 560;
  const gap = 32;
  const w = Math.round((INNER - gap * 2) / 3);
  return (y) => ({
    h: H,
    els: [
      band(y, H, toneColor(p, tone)),
      ...sectionHead(p, y + 64, label, heading),
      ...items.slice(0, 3).map((c, i) =>
        E("property", MARGIN + i * (w + gap), y + 200, w, 300, c.content,
          { bgColor: p.card, color: p.text, fontFamily: p.head, borderRadius: 18, boxShadow: cardShadow(p) },
          c.src ? { src: c.src } : {})),
    ],
  });
}

function cta(p, { heading, sub, button }) {
  const H = 320;
  return (y) => ({
    h: H,
    els: [
      E("section", 0, y, CANVAS_W, H, "", { bgType: "gradient", gradientFrom: p.accent, gradientTo: p.accent2, gradientDir: "120deg" }, { zIndex: 1 }),
      E("heading",   250, y + 90,  700, 60, heading, { color: "#ffffff", fontFamily: p.head, fontSize: 40, fontWeight: "800", textAlign: "center" }, { zIndex: 2 }),
      E("paragraph", 320, y + 160, 560, 40, sub,     { color: "rgba(255,255,255,0.9)", fontFamily: p.body, fontSize: 17, textAlign: "center", lineHeight: 1.6 }, { zIndex: 2 }),
      E("button",    505, y + 222, 190, 52, button,  { bgColor: "#ffffff", color: p.accent2, borderRadius: 10, fontFamily: p.body, fontWeight: "700", boxShadow: "0 10px 30px rgba(0,0,0,0.2)" }, { zIndex: 2 }),
    ],
  });
}

function footer(p, brand) {
  const H = 100;
  return (y) => ({
    h: H,
    els: [
      band(y, H, p.band),
      E("footer", 0, y + 30, CANVAS_W, 40, `© 2025 ${brand}. All rights reserved.`, { color: p.muted, fontFamily: p.body, padding: MARGIN }),
    ],
  });
}

// ── Compose: stack sections, assign sequential stable ids, total page bg ──────
function compose(p, sections) {
  let y = 0;
  const out = [];
  for (const make of sections) {
    const { els, h } = make(y);
    out.push(...els);
    y += h;
  }
  return out.map((el, i) => ({ ...el, id: `t${i}` }));
}

// ── DOMAIN TEMPLATES ──────────────────────────────────────────────────────────
const TEMPLATES = {
  saas: () => {
    const p = PALETTES.saas;
    return compose(p, [
      navbar(p, "Nimbus"),
      heroSplit(p, {
        label: "THE ALL-IN-ONE PLATFORM",
        heading: "Ship products your customers love, faster",
        sub: "Nimbus brings planning, building, and shipping into one fast, beautiful workspace your whole team will actually enjoy using.",
        cta1: "Start Free Trial", cta2: "Watch Demo",
      }),
      logos(p, ["Linear", "Vercel", "Notion", "Figma", "Stripe"]),
      features(p, {
        label: "WHY TEAMS CHOOSE US", heading: "Everything you need, nothing you don't",
        sub: "Powerful building blocks that scale from your first user to your millionth.",
        items: [
          { content: "Lightning Fast|Sub-50ms interactions everywhere, so your team never waits on the tool.|⚡" },
          { content: "Built-in Analytics|Understand exactly how your product is used with zero setup.|📊" },
          { content: "Enterprise Security|SOC 2 Type II, SSO, and granular permissions out of the box.|🔒" },
        ],
      }),
      stats(p, ["12,000+|Active Teams", "99.99%|Uptime", "4.9/5|Avg Rating", "60+|Integrations"]),
      about(p, {
        tone: "bg",
        label: "OUR STORY",
        heading: "Built by a team that lived the problem",
        body1: "Nimbus started when our founding team spent one release cycle too many fighting their own tools. We built the workspace we always wanted: fast, opinionated, and honest about what shipping teams actually need.",
        body2: "Today more than 12,000 teams across 40 countries run on Nimbus, and every feature still passes one rule before it ships: it must save a team real time in its first week.",
      }),
      pricing(p, {
        tone: "band",
        label: "PRICING", heading: "Simple, transparent pricing",
        plans: [
          "Starter|$29|/mo|For small teams getting started|Up to 5 members|10 projects|Community support",
          "Pro|$79|/mo|For growing teams that ship fast|Unlimited members|Unlimited projects|Priority support|Advanced analytics",
          "Enterprise|$199|/mo|For organizations at scale|Everything in Pro|SSO & SAML|Dedicated manager|99.99% SLA",
        ].map((c) => c),
      }),
      testimonials(p, {
        tone: "bg",
        label: "LOVED BY TEAMS", heading: "Don't just take our word for it",
        items: [
          "We shipped our biggest release 3x faster after switching to Nimbus. It just gets out of the way.|Sarah Chen|VP Engineering, Drift",
          "The analytics alone paid for the entire subscription in the first month. A no-brainer.|Marcus Lee|Founder, Rampview",
          "Onboarding took five minutes and the whole team was productive on day one.|Priya Nair|Head of Product, Cobalt",
        ],
      }),
      cta(p, { heading: "Ready to build something great?", sub: "Join 12,000+ teams already shipping faster with Nimbus.", button: "Get Started Free" }),
      footer(p, "Nimbus"),
    ]);
  },

  marketing: () => {
    const p = PALETTES.marketing;
    return compose(p, [
      navbar(p, "Vantage"),
      heroOverlay(p, {
        label: "AWARD-WINNING DIGITAL AGENCY",
        heading: "We build brands that define their industry",
        sub: "Strategy, design, and technology working as one to turn ambitious ideas into market-leading experiences.",
        cta1: "Start a Project", cta2: "View Our Work",
      }),
      logos(p, ["Nike", "Spotify", "Airbnb", "Adobe", "Mercedes"]),
      features(p, {
        label: "WHAT WE DO", heading: "End-to-end digital excellence",
        sub: "From the first sketch to launch day and beyond, we own the outcome.",
        items: [
          { content: "Brand Strategy|Positioning, identity, and messaging that makes you impossible to ignore.|✦" },
          { content: "Experience Design|Interfaces and journeys crafted to convert and delight.|◈" },
          { content: "Engineering|Fast, scalable builds engineered for growth and reliability.|⬡" },
        ],
      }),
      stats(p, ["240+|Projects Delivered", "$142M|Revenue Generated", "98%|Client Satisfaction", "14|Industry Awards"]),
      about(p, {
        tone: "bg",
        label: "WHO WE ARE",
        heading: "A senior team, zero hand-offs",
        body1: "Vantage is a thirty-person studio of strategists, designers, and engineers who work in one room on one plan. The people who pitch your project are the same people who build it.",
        body2: "That structure is why our average engagement lasts over three years, and why eight of our ten largest clients arrived by referral.",
      }),
      testimonials(p, {
        label: "CLIENT STORIES", heading: "Results that speak for themselves",
        items: [
          "Vantage rebranded us top to bottom and our inbound leads tripled within a quarter.|Elena Ross|CMO, Northwind",
          "Easily the most strategic partner we've worked with. They think like owners.|David Kim|CEO, Lumen",
          "Every deliverable was award-worthy. Our investors noticed immediately.|Aisha Bello|Founder, Orbit",
        ],
      }),
      cta(p, { heading: "Let's build your next chapter", sub: "Tell us about your vision and we'll show you what's possible.", button: "Start a Project" }),
      footer(p, "Vantage"),
    ]);
  },

  realestate: () => {
    const p = PALETTES.realestate;
    return compose(p, [
      navbar(p, "Haven"),
      heroOverlay(p, {
        label: "LUXURY REAL ESTATE",
        heading: "Find where your story begins",
        sub: "Curated homes in the world's most desirable neighborhoods, matched to the life you want to live.",
        cta1: "Browse Listings", cta2: "Book a Tour",
      }),
      stats(p, ["12,847|Active Listings", "1,203|Sold This Year", "$4.2B|In Total Sales", "320|Expert Agents"]),
      propertyGrid(p, {
        label: "FEATURED HOMES", heading: "This week's finest listings",
        items: [
          { content: "Sunset Ridge Villa|$4,250,000|5 Bed • 4.5 Bath • 5,200 sqft", src: img("1564013799919-ab600027ffc6") },
          { content: "The Glass House|$2,890,000|4 Bed • 3 Bath • 3,800 sqft", src: img("1512917774080-9991f1c4c750") },
          { content: "Harborview Estate|$6,750,000|6 Bed • 5 Bath • 7,100 sqft", src: img("1600596542815-ffad4c1539a9") },
        ],
      }),
      features(p, {
        tone: "band",
        label: "WHY HAVEN", heading: "A smarter way to find home",
        items: [
          { content: "White-Glove Service|A dedicated agent guides you from first viewing to closing day.|🏡" },
          { content: "Off-Market Access|See exclusive listings before they ever hit the public market.|🔑" },
          { content: "Trusted Expertise|Three decades of local knowledge in every neighborhood we serve.|⭐" },
        ],
      }),
      about(p, {
        tone: "bg",
        label: "OUR APPROACH",
        heading: "Three decades in the neighborhoods you want",
        body1: "Haven began as a two-agent office in 1994 and grew the slow way: one well-matched home at a time. We still walk every property before we list it, and we still say no to listings we would not buy ourselves.",
        body2: "Our agents live in the neighborhoods they serve, so you hear about the school catchments, the quiet streets, and the noisy ones before you ever book a tour.",
      }),
      testimonials(p, {
        tone: "band",
        label: "CLIENT STORIES", heading: "Families who found home with us",
        items: [
          "Haven found us an off-market craftsman in three weeks after a year of searching on our own.|Rachel Adler|Buyer, Sunset Ridge",
          "They negotiated nine percent under asking in a seller's market. Consummate professionals.|Tom Okafor|First-time Buyer",
          "Our home sold in eleven days, over asking, with zero stress. We cannot recommend them enough.|The Muellers|Sellers, Harborview",
        ],
      }),
      cta(p, { heading: "Ready to find your dream home?", sub: "Speak with a Haven specialist today — no pressure, just expert guidance.", button: "Get Started" }),
      footer(p, "Haven"),
    ]);
  },

  restaurant: () => {
    const p = PALETTES.restaurant;
    return compose(p, [
      navbar(p, "Ember"),
      heroOverlay(p, {
        label: "MODERN FINE DINING",
        heading: "Crafted with passion & purpose",
        sub: "A seasonal tasting menu built around the finest local ingredients and unforgettable hospitality.",
        cta1: "Reserve a Table", cta2: "View Menu",
      }),
      features(p, {
        tone: "bg",
        label: "SEASONAL MENU", heading: "Signature dishes",
        sub: "Each plate is a story told through fire, technique, and the harvest.",
        items: [
          { content: "Charred Octopus|Smoked paprika, fennel, and citrus over saffron aioli.|🔥" },
          { content: "Wagyu Tartare|Hand-cut prime beef, quail egg, and crisp shallot.|🥩" },
          { content: "Wild Mushroom Risotto|Aged parmesan, truffle, and slow-cooked arborio.|🍄" },
          { content: "Ember-Roasted Cauliflower|Charred over coals with smoked almond cream and golden raisins.|✦" },
          { content: "Cedar-Plank Salmon|Line-caught salmon, burnt lemon, and pickled mustard seed.|❖" },
          { content: "Basque Cheesecake|Burnt custard center with macerated seasonal berries.|✧" },
        ],
      }),
      stats(p, ["12|Years of Service", "4.9|Guest Rating", "38|Seasonal Dishes", "2|Chef Awards"]),
      about(p, {
        tone: "bg",
        label: "OUR STORY",
        heading: "From a family kitchen to your table",
        body1: "Ember began in a cramped family kitchen where the wood stove never went cold. Two generations later we cook the same way: over live fire, from whole ingredients, for people we treat as guests rather than customers.",
        body2: "We buy directly from twelve local farms, mill our flour weekly, and rewrite the menu with every season. Dinner is served Tuesday through Sunday from six in the evening.",
      }),
      testimonials(p, {
        tone: "band",
        label: "GUEST REVIEWS", heading: "An evening to remember",
        items: [
          "The best dining experience we've had in years — every course was a revelation.|Olivia Grant|Food & Wine",
          "Impeccable service and a menu that surprised us at every turn. We'll be back.|James Whitfield|Regular Guest",
          "Worth every star. The tasting menu is pure theatre on a plate.|Nadia Cruz|The Local Table",
        ],
      }),
      cta(p, { heading: "Join us for an unforgettable evening", sub: "Reservations fill quickly — secure your table today.", button: "Reserve Now" }),
      footer(p, "Ember"),
    ]);
  },

  portfolio: () => {
    const p = PALETTES.portfolio;
    return compose(p, [
      navbar(p, "Alex Rivera"),
      heroSplit(p, {
        label: "PRODUCT DESIGNER & DEVELOPER",
        heading: "I design and build digital products that feel effortless",
        sub: "Currently crafting interfaces for fast-moving teams. Previously at Stripe and Linear.",
        cta1: "View Work", cta2: "Get in Touch",
      }),
      features(p, {
        tone: "band",
        label: "WHAT I DO", heading: "Selected capabilities",
        items: [
          { content: "Product Design|End-to-end UX from research and flows to polished, shippable UI.|◈" },
          { content: "Frontend Engineering|React, TypeScript, and design systems built to scale.|⬡" },
          { content: "Brand & Motion|Identity and micro-interactions that give products personality.|✦" },
        ],
      }),
      about(p, {
        tone: "bg",
        label: "ABOUT ME",
        heading: "Design first, ego last",
        body1: "I spent eight years inside product teams at Stripe and Linear learning what actually ships: small teams, strong opinions, and interfaces that respect the person using them.",
        body2: "Now I partner with founders and product leads who want that same bar without the big-company process. One project at a time, always hands-on.",
      }),
      stats(p, ["8+|Years Experience", "40+|Projects Shipped", "12|Happy Clients", "3|Design Awards"]),
      testimonials(p, {
        tone: "bg",
        label: "KIND WORDS", heading: "What people say",
        items: [
          "Alex is the rare designer who can also build. Our velocity doubled.|Sam Powell|Eng Lead, Linear",
          "Thoughtful, fast, and genuinely a joy to work with. Highly recommend.|Mia Chen|PM, Stripe",
          "Turned a vague idea into a product our users love. Real craft.|Leo Martins|Founder, Pace",
        ],
      }),
      cta(p, { heading: "Have a project in mind?", sub: "I'm open to select freelance and full-time opportunities.", button: "Let's Talk" }),
      footer(p, "Alex Rivera"),
    ]);
  },

  general: () => {
    const p = PALETTES.general;
    return compose(p, [
      navbar(p, "Brand"),
      heroSplit(p, {
        label: "WELCOME",
        heading: "Build something people will remember",
        sub: "A clean, modern starting point you can shape into anything — adjust the copy, colors, and images to make it yours.",
        cta1: "Get Started", cta2: "Learn More",
      }),
      features(p, {
        tone: "band",
        label: "WHAT WE OFFER", heading: "Designed to impress",
        items: [
          { content: "Fast & Modern|A polished, responsive foundation ready for your content.|⚡" },
          { content: "Fully Customizable|Every element can be edited, restyled, and rearranged.|✦" },
          { content: "Built to Convert|Clear hierarchy and calls-to-action that guide your visitors.|◈" },
        ],
      }),
      stats(p, ["100%|Customizable", "24/7|Always On", "10k+|Happy Users", "5★|Top Rated"], "bg"),
      about(p, {
        tone: "band",
        label: "ABOUT US",
        heading: "A small team with serious standards",
        body1: "We started this company because we kept seeing good businesses held back by websites that undersold them. Every project here gets the same attention, whether it is a one-page launch or a full platform.",
        body2: "No account managers, no runaround: you work directly with the people doing the work, and we measure ourselves on the results your visitors see.",
      }),
      testimonials(p, {
        tone: "bg",
        label: "TESTIMONIALS", heading: "People love it",
        items: [
          "Exactly the head start I needed. I had a live site the same afternoon.|Jordan Bell|Small Business Owner",
          "Looks like it cost thousands. It didn't. Incredible value.|Taylor Reed|Creator",
          "Editing was effortless and the result looks genuinely professional.|Sam Quinn|Freelancer",
        ],
      }),
      cta(p, { heading: "Ready to get started?", sub: "Make it yours in minutes — no code required.", button: "Get Started" }),
      footer(p, "Brand"),
    ]);
  },
};

// Industries that don't have a bespoke template fall back to the closest match.
const ALIASES = { ecommerce: "saas", law: "marketing", hotel: "restaurant" };

export function getPageTemplate(industry) {
  const key = TEMPLATES[industry] ? industry : (ALIASES[industry] || "general");
  return TEMPLATES[key]();
}

export const TEMPLATE_INDUSTRIES = Object.keys(TEMPLATES);

// ─────────────────────────────────────────────────────────────────────────────
// ── REFERENCE PIPELINE SUPPORT ────────────────────────────────────────────────
// Lets the "Design from Reference" feature build a page from an explicit spec
// (section list + extracted design tokens) instead of a fixed industry template.
// ─────────────────────────────────────────────────────────────────────────────

// The menu of sections the reference mapper is allowed to choose from. Sent to
// the LLM so it can only ever pick a renderable section (no "unknown type"),
// and used to describe the copy slots each one needs.
export const SECTION_CATALOG = [
  { type: "navbar",       desc: "top navigation bar with a brand name + links",                                  slots: "brand" },
  { type: "heroSplit",    desc: "hero: headline + subtext + 2 buttons on the left, image on the right",          slots: "label, heading, sub, cta1, cta2" },
  { type: "heroOverlay",  desc: "full-width hero: background image with dark overlay, centered headline+buttons", slots: "label, heading, sub, cta1, cta2" },
  { type: "logos",        desc: "horizontal strip of client/partner brand names (social proof)",                 slots: "brands[] (5 short names)" },
  { type: "features",     desc: "section heading + a row of 3 feature cards (icon+title+desc)",                   slots: "label, heading, sub, items[3] each 'title|description|emoji'" },
  { type: "stats",        desc: "a band of 4 big number+label stats",                                            slots: "items[4] each 'number|label'" },
  { type: "about",        desc: "story/about band: image left, label + heading + two paragraphs right",          slots: "label, heading, body1, body2" },
  { type: "pricing",      desc: "section heading + 3 pricing plan cards (middle one featured)",                  slots: "label, heading, plans[3] each 'plan|price|period|desc|feature|feature'" },
  { type: "testimonials", desc: "section heading + 3 quote cards",                                               slots: "label, heading, items[3] each 'quote|name|role'" },
  { type: "propertyGrid", desc: "section heading + 3 image cards with name+price+details (listings / work)",     slots: "label, heading, items[3] each {content:'name|price|details'}" },
  { type: "cta",          desc: "full-width gradient call-to-action band",                                       slots: "heading, sub, button" },
  { type: "footer",       desc: "footer bar with copyright + links",                                            slots: "brand" },
];

// Merge extracted design tokens over the nearest base palette.
function resolvePalette(industry, tokens = {}) {
  const key  = PALETTES[industry] ? industry : (ALIASES[industry] && PALETTES[ALIASES[industry]] ? ALIASES[industry] : "general");
  const base = PALETTES[key];
  const t = tokens || {};
  return {
    ...base,
    ...(t.bg      && { bg: t.bg }),
    ...(t.band    && { band: t.band }),
    ...(t.accent  && { accent: t.accent }),
    ...(t.accent2 && { accent2: t.accent2 }),
    ...(t.card    && { card: t.card }),
    ...(t.text    && { text: t.text }),
    ...(t.muted   && { muted: t.muted }),
    ...(t.head    && { head: t.head }),
    ...(t.body    && { body: t.body }),
    ...(typeof t.dark === "boolean" && { dark: t.dark }),
    ...(t.hero    && { hero: t.hero }),
  };
}

// section.type → the matching builder, called with (palette, section).
const BUILDERS = {
  navbar:       (p, s) => navbar(p, s.brand || "Brand"),
  heroSplit:    (p, s) => heroSplit(p, s),
  heroOverlay:  (p, s) => heroOverlay(p, s),
  logos:        (p, s) => logos(p, Array.isArray(s.brands) ? s.brands : ["Brand A", "Brand B", "Brand C", "Brand D", "Brand E"]),
  features:     (p, s) => features(p, { ...s, items: s.items || [] }),
  stats:        (p, s) => stats(p, Array.isArray(s.items) ? s.items : []),
  about:        (p, s) => about(p, s),
  pricing:      (p, s) => pricing(p, { ...s, plans: s.plans || [] }),
  testimonials: (p, s) => testimonials(p, { ...s, items: s.items || [] }),
  propertyGrid: (p, s) => propertyGrid(p, { ...s, items: s.items || [] }),
  cta:          (p, s) => cta(p, s),
  footer:       (p, s) => footer(p, s.brand || "Brand"),
};

export const REFERENCE_SECTION_TYPES = Object.keys(BUILDERS);

/**
 * Build a full page from a reference spec.
 * spec = {
 *   industry: "saas",
 *   tokens:   { bg, accent, text, head, body, dark, ... },   // extracted design tokens
 *   sections: [ { type: "navbar", brand: "..." }, { type: "heroSplit", heading: "...", ... }, ... ],
 * }
 * Falls back to a full industry template if the spec has no usable sections.
 */
export function buildFromSpec(spec = {}) {
  const industry = spec.industry || "general";
  const p = resolvePalette(industry, spec.tokens || {});
  const sections = Array.isArray(spec.sections) ? spec.sections : [];
  const makers = sections
    .filter((s) => s && BUILDERS[s.type])
    .map((s) => BUILDERS[s.type](p, s));
  if (!makers.length) return getPageTemplate(industry);
  return compose(p, makers);
}
