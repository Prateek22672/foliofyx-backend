// server/engine/index.js
// FYX Site Engine — prompt → finished page, with at most one LLM call.
//
//   parseIntent()     deterministic: niche, names, place, currency, tone, sections
//   pickStyle()       deterministic: palette + fonts from moods / requested colour
//   applyFacts()      deterministic: brand, person, role, currency into niche copy
//   personalizeCopy() optional single LLM call, cached, merged field-by-field
//   composePage()     deterministic: measured layout on the 1200px canvas
//
// "Try another style" re-runs with variant+1 and hits the copy cache, so it
// costs no API call at all.

import { NICHES, getNiche, listNiches } from "./catalog/index.js";
import { parseIntent } from "./intent.js";
import { pickStyle, listStyles, hashString } from "./styles.js";
import { resolveRecipe, composePage, composeSection, sectionAvailable, CANVAS_W } from "./layout.js";
import { applyFacts, personalizeCopy } from "./copy.js";
import { resolveImages } from "./images.js";

const CONTACT = {
  portfolio: { heading: "Let's work together", body: "Open to freelance projects, full-time roles and interesting collaborations. I reply within a day." },
  agency: { heading: "Tell us about your project", body: "Share a few lines about your goals and timeline. A senior team member replies within one business day." },
  restaurant: { heading: "Reserve your table", body: "Tables fill quickly on weekends, so book ahead. Walk-ins are always welcome at the bar." },
  hotel: { heading: "Plan your stay", body: "Tell us your dates and we will hold the best available room while you decide." },
  listing: { heading: "Talk to our team", body: "Tell us what you are looking for and we will send a shortlist within 24 hours." },
  education: { heading: "Talk to admissions", body: "Questions about courses, schedules or fees? Our counsellors reply the same day." },
  nonprofit: { heading: "Get involved", body: "Volunteer, partner with us or ask a question. Every message is read by our team." },
  event: { heading: "Questions about the event?", body: "Reach the organising team for tickets, partnerships or accessibility requests." },
  creator: { heading: "Say hello", body: "For collaborations, sponsorships or just to share an idea, drop a note." },
  store: { heading: "Questions about an order?", body: "Our support team answers within a few hours, seven days a week." },
  saas: { heading: "Talk to sales", body: "Get a walkthrough tailored to your team and a trial workspace set up for you." },
  local: { heading: "Book a visit or ask a question", body: "Call, message or send the form. We usually reply within a couple of hours." },
};

const GALLERY = {
  restaurant: "A look inside", hotel: "Moments from your stay", nonprofit: "Our work in the field",
  event: "Highlights from last year", listing: "Take a closer look",
};

const NEWSLETTER = {
  creator: { label: "NEWSLETTER", heading: "Get new posts in your inbox", sub: "One thoughtful email a week. No spam, unsubscribe anytime." },
  store: { label: "STAY IN THE LOOP", heading: "Early access to new drops", sub: "Be first to hear about launches, restocks and members-only offers." },
};

function slugify(s = "") {
  return s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "").slice(0, 20) || "hello";
}

function contactBlock(archetype, intent, brand) {
  const c = CONTACT[archetype] || CONTACT.local;
  const email = `hello@${slugify(brand)}.com`;
  const phone = intent.country === "IN" ? "+91 98765 43210" : intent.country === "GB" ? "+44 20 7946 0000" : "+1 (555) 010-2030";
  const place = intent.location || "Your city";
  const lines = archetype === "portfolio"
    ? [`Email: ${email}`, `Based in ${place}`]
    : [`Visit: ${place}`, `Call: ${phone}`, `Email: ${email}`];
  if (["restaurant", "local", "store"].includes(archetype)) lines.push("Open Monday to Saturday, 9 am to 8 pm");
  return { label: "GET IN TOUCH", heading: c.heading, body: c.body, lines };
}

function newsletterBlock(archetype) {
  const n = NEWSLETTER[archetype] || NEWSLETTER.creator;
  return { ...n, placeholder: "Your email address", button: "Subscribe" };
}

function makeCtx({ niche, style, copy, intent }) {
  return {
    p: style,
    copy,
    images: resolveImages(niche.images, niche.archetype),
    archetype: niche.archetype,
    brand: copy.brand,
    year: new Date().getFullYear(),
    contact: contactBlock(niche.archetype, intent, copy.brand),
    newsletter: newsletterBlock(niche.archetype),
    galleryHeading: GALLERY[niche.archetype],
  };
}

export function buildPage({ niche, style, copy, intent, variant = 0, include, exclude }) {
  const seed = hashString(`${intent.normalized || ""}|${niche.id}`);
  const keys = resolveRecipe(niche.archetype, copy, {
    variant: variant + (seed % 2),
    include: include ?? intent.sections?.include ?? [],
    exclude: exclude ?? intent.sections?.exclude ?? [],
  });
  const { elements, height } = composePage(makeCtx({ niche, style, copy, intent }), keys);
  return { elements, height, sections: keys };
}

// A single section (e.g. "pricing") laid out from y = 0, or null when the
// niche has no copy for it.
export function buildSection({ niche, style, copy, intent, key }) {
  if (!sectionAvailable(copy, key)) return null;
  return composeSection(makeCtx({ niche, style, copy, intent }), key);
}

function paletteOf(style) {
  const {
    bg, band, card, text, muted, accent, accent2, onAccent, head, body, dark, radius, gradient,
    buttonFill = "solid", buttonShape = "rounded", cardStyle = "shadow", pattern = "none", patternOpacity = 0.07,
  } = style;
  return {
    bg, band, card, text, muted, accent, accent2, onAccent, head, body, dark, radius, gradient,
    buttonFill, buttonShape, cardStyle, pattern, patternOpacity,
  };
}

/**
 * @param {string} prompt  the user's brief
 * @param {object} opts    { variant, nicheId, styleId, useAI, include, exclude }
 */
export async function generateSite(prompt, opts = {}) {
  const { variant = 0, nicheId = null, styleId = null, useAI = true, include, exclude } = opts;
  const brief = String(prompt || "").slice(0, 2000);
  const intent = parseIntent(brief, { nicheId });
  const niche = intent.niche;
  if (!niche) throw Object.assign(new Error("Site engine has no templates loaded."), { statusCode: 503 });

  const style = pickStyle({ niche, intent, variant, styleId });
  const base = applyFacts(niche.copy, niche, intent);

  let copy = base;
  let model = null;
  let changed = 0;
  let cached = false;
  if (useAI) ({ copy, model, changed, cached } = await personalizeCopy({ baseCopy: base, niche, intent, brief }));

  const { elements, height, sections } = buildPage({ niche, style, copy, intent, variant, include, exclude });

  return {
    niche: { id: niche.id, name: niche.name, group: niche.group, archetype: niche.archetype },
    style: { id: style.id, name: style.name, dark: style.dark },
    elements,
    height,
    canvasWidth: CANVAS_W,
    pageBg: style.bg,
    sections,
    seo: copy.seo,
    brand: copy.brand,
    personalized: changed >= 5,
    model,
    cached,
    intent: {
      confidence: intent.confidence,
      alternatives: intent.alternatives,
      brand: intent.brand,
      person: intent.person,
      location: intent.location,
      currency: intent.currency?.code || null,
    },
    meta: {
      engine: 1,
      nicheId: niche.id,
      styleId: style.id,
      variant,
      brand: copy.brand,
      palette: paletteOf(style),
      brief: brief.slice(0, 800),
    },
  };
}

export function catalogSummary() {
  const niches = listNiches();
  const byGroup = {};
  for (const n of niches) (byGroup[n.group] ||= []).push(n);
  return {
    niches,
    groups: byGroup,
    styles: listStyles(),
    counts: { niches: niches.length, styles: listStyles().length, total: NICHES.length },
  };
}

export { parseIntent, getNiche, paletteOf };
