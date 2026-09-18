// server/engine/edits.js
// Deterministic chat edits that need no LLM call: new style/variation, dark or
// light mode, accent colour, mood restyle, rename, font swap and "add a
// section". Palette swaps map every colour of the old palette to the new one,
// so the user's text edits survive a restyle.

import { SHADOWS } from "../data/designSystem.js";
import { STYLES, pickStyle, colorFromWords, resolveStyle, getStyle } from "./styles.js";
import { normalize, parseIntent } from "./intent.js";
import { getNiche } from "./catalog/index.js";
import { applyFacts } from "./copy.js";
import { buildSection, paletteOf } from "./index.js";

const FONTS = [
  "Inter", "Poppins", "Roboto", "Montserrat", "Lato", "Open Sans", "Playfair Display", "Lora",
  "Merriweather", "Raleway", "Nunito", "Nunito Sans", "DM Sans", "DM Serif Display", "Manrope",
  "Space Grotesk", "Sora", "Outfit", "Syne", "Fraunces", "Oswald", "Bebas Neue", "Work Sans",
  "Rubik", "Karla", "Libre Baskerville", "Cormorant Garamond", "EB Garamond", "Archivo",
  "Archivo Black", "Plus Jakarta Sans", "Urbanist", "Lexend", "Josefin Sans", "Quicksand",
  "Figtree", "Source Sans 3", "IBM Plex Sans", "Space Mono", "JetBrains Mono", "Unbounded",
  "Bricolage Grotesque", "Caveat", "Pacifico", "Dancing Script",
];

const MOOD_EDITS = [
  [/\b(more )?(luxur(y|ious)|premium|high end|classy|elegant)\b/, ["luxury", "elegant"]],
  [/\b(more )?(minimal|minimalist|simpler|cleaner)\b/, ["minimal", "clean"]],
  [/\b(more )?(playful|fun|colorful|colourful|vibrant)\b/, ["playful", "vibrant"]],
  [/\b(more )?(professional|corporate|formal)\b/, ["corporate", "clean"]],
  [/\b(more )?(warm|cozy|cosy|earthy|rustic)\b/, ["warm", "earthy"]],
  [/\b(more )?(bold|striking|punchy)\b/, ["bold"]],
  [/\b(more )?(techy|futuristic|modern tech)\b/, ["tech"]],
  [/\b(more )?(soft|pastel|calm)\b/, ["soft"]],
];

const SECTION_ADD = {
  pricing: /\b(pricing|prices|plans|packages)\b/,
  faq: /\b(faq|faqs|questions)\b/,
  team: /\b(team|staff|our people)\b/,
  testimonials: /\b(testimonials|reviews)\b/,
  gallery: /\b(gallery|photos)\b/,
  contact: /\b(contact|contact form|enquiry form|inquiry form)\b/,
  timeline: /\b(timeline|experience|schedule|agenda)\b/,
  stats: /\b(stats|numbers|achievements)\b/,
};

/** Classify an instruction into a deterministic edit, or null when the LLM is needed. */
export function detectQuickEdit(text = "") {
  const t = normalize(text);
  const raw = String(text);

  if (/\b(another|different|new|other|fresh) (style|design|look|layout|theme|version|variation|take)\b|\b(regenerate|shuffle|surprise me|try again|redesign it)\b/.test(t)) {
    return { kind: "variation" };
  }

  const addMatch = t.match(/\b(add|include|insert|put|show)\b(.{0,30})/);
  if (addMatch) {
    for (const [section, re] of Object.entries(SECTION_ADD)) {
      if (re.test(addMatch[2])) return { kind: "addSection", section };
    }
  }

  const renameMatch = raw.match(/\b(?:rename(?: the)?(?: business| brand| site| store| shop| company)?|change the (?:business |brand |site |store |shop |company )?name|call (?:it|the site|the business))\s*(?:to|as)?\s+["“']?([^"”'\n.]{2,40})["”']?\s*$/i);
  if (renameMatch) return { kind: "rename", to: renameMatch[1].trim() };

  const fontName = FONTS.find((f) => new RegExp(`\\b${f.replace(/ /g, "\\s+")}\\b`, "i").test(raw));
  if (fontName && /\b(font|typeface|typography|type)\b/.test(t)) {
    const target = /\b(heading|headline|title)s?\b/.test(t) ? "head" : /\bbody|paragraph|text font\b/.test(t) ? "body" : "both";
    return { kind: "font", family: fontName, target };
  }

  const wantsDark = /\b(make|switch|turn|change|convert|go)\b.{0,20}\b(dark|black)\b|\bdark (mode|theme|version|background)\b/.test(t);
  const wantsLight = /\b(make|switch|turn|change|convert|go)\b.{0,20}\b(light|white|bright)\b|\blight (mode|theme|version|background)\b/.test(t);
  const color = colorFromWords(raw);
  const colorAsk = color && /\b(colou?rs?|accent|theme|palette|make it|change|use|switch|turn|brand)\b/.test(t);
  const moods = [...new Set(MOOD_EDITS.flatMap(([re, tags]) => (re.test(t) && /\b(make|more|look|feel|style|restyle|change)\b/.test(t) ? tags : [])))];

  if (wantsDark || wantsLight || moods.length) {
    return { kind: "restyle", mode: wantsDark ? "dark" : wantsLight ? "light" : null, moods, color: colorAsk ? color : null };
  }
  if (colorAsk) return { kind: "recolor", color };
  return null;
}

// ── Palette mapping ───────────────────────────────────────────────────────────
const CARDISH = new Set(["feature", "service", "testimonial", "pricing", "team", "property", "faq", "timeline", "stats", "form", "cta"]);
const lc = (v) => (typeof v === "string" ? v.toLowerCase() : v);

function hexToRgba(hex, a) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return null;
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

function mapColor(value, from, to, prefer) {
  if (typeof value !== "string") return value;
  // "#rrggbbaa" washes (soft buttons, tinted cards, outlines): map the base colour, keep the alpha.
  const alpha = /^(#[0-9a-f]{6})([0-9a-f]{2})$/i.exec(value);
  if (alpha) {
    const base = mapColor(alpha[1], from, to, prefer);
    return base === alpha[1] ? value : `${base}${alpha[2]}`;
  }
  const v = lc(value);
  for (const k of prefer) if (lc(from[k]) === v) return to[k];
  for (const k of ["bg", "band", "card", "text", "muted", "accent", "accent2", "onAccent"]) if (lc(from[k]) === v) return to[k];
  return value;
}

export function applyPalette(elements, from, to) {
  const glowFrom = hexToRgba(from.accent, 0.45);
  const glowTo = hexToRgba(to.accent, 0.45);
  return elements.map((el) => {
    const s = { ...(el.styles || {}) };
    const isBand = el.type === "section";
    const isCard = CARDISH.has(el.type);
    const isButton = el.type === "button";

    if (s.bgColor) s.bgColor = mapColor(s.bgColor, from, to, isBand ? ["bg", "band"] : isCard ? ["card", "accent"] : isButton ? ["accent", "onAccent"] : ["bg", "band", "card"]);
    if (s.color) s.color = mapColor(s.color, from, to, isButton ? ["onAccent", "accent", "text"] : ["text", "muted", "accent", "onAccent"]);
    if (s.borderColor) {
      s.borderColor = mapColor(s.borderColor, from, to, ["accent", "text"]);
      if (s.borderColor === "#ffffff1f" && !to.dark) s.borderColor = "#0f172a14";
      else if (s.borderColor === "#0f172a14" && to.dark) s.borderColor = "#ffffff1f";
    }
    if (s.cardBorder) s.cardBorder = mapColor(s.cardBorder, from, to, ["text"]);
    if (s.patternColor) s.patternColor = mapColor(s.patternColor, from, to, ["text"]);
    if (s.gradientFrom) s.gradientFrom = mapColor(s.gradientFrom, from, to, ["accent", "accent2"]);
    if (s.gradientTo) s.gradientTo = mapColor(s.gradientTo, from, to, ["accent2", "accent"]);
    if (s.fontFamily === from.head) s.fontFamily = to.head;
    else if (s.fontFamily === from.body) s.fontFamily = to.body;
    if (typeof s.boxShadow === "string") {
      if (glowFrom && glowTo && s.boxShadow.includes(glowFrom)) s.boxShadow = s.boxShadow.replace(glowFrom, glowTo);
      if (to.dark && s.boxShadow === SHADOWS.card) s.boxShadow = SHADOWS.cardDark;
      else if (!to.dark && s.boxShadow === SHADOWS.cardDark) s.boxShadow = SHADOWS.card;
    }
    if (typeof s.borderRadius === "number" && from.radius !== to.radius && !isBand) {
      if (s.borderRadius === 999) s.borderRadius = to.radius >= 20 ? 999 : Math.min(to.radius, 14);
      else if (s.borderRadius >= from.radius) s.borderRadius = Math.max(0, s.borderRadius - from.radius + to.radius);
    }
    return { ...el, styles: s };
  });
}

function nextStyle({ meta, mode, moods = [], color }) {
  const niche = getNiche(meta.nicheId);
  const intent = { mode: mode || (meta.palette?.dark ? "dark" : "light"), moods, normalized: meta.brief || "", color };
  for (let v = 0; v < STYLES.length; v++) {
    const candidate = pickStyle({ niche, intent, variant: v });
    if (candidate.id !== meta.styleId) return candidate;
  }
  return pickStyle({ niche, intent, variant: 1 });
}

/**
 * Apply a quick edit to the active page. Returns
 * { elements, meta, pageBg, reply, replaceAll? } or null when it can't apply.
 */
export async function applyQuickEdit(edit, { page, meta, generate }) {
  if (!meta?.engine || !meta.palette || !getNiche(meta.nicheId)) return null;
  const elements = page.elements.map((e) => ({ ...e, styles: { ...(e.styles || {}) } }));
  const from = meta.palette;

  if (edit.kind === "variation") {
    const next = await generate(meta.brief, { nicheId: meta.nicheId, variant: (meta.variant || 0) + 1 });
    return {
      elements: next.elements, meta: next.meta, pageBg: next.pageBg, replaceAll: true,
      reply: `Here's a fresh take: the ${next.style.name} style with a different layout. Ask for another any time, or tell me what to change.`,
    };
  }

  if (edit.kind === "restyle" || edit.kind === "recolor") {
    let target;
    if (edit.kind === "recolor") {
      const base = getStyle(meta.styleId);
      target = base ? resolveStyle(base, { color: edit.color }) : { ...from, ...edit.color };
      if (!base) target.onAccent = from.onAccent;
    } else {
      target = nextStyle({ meta, mode: edit.mode, moods: edit.moods, color: edit.color });
    }
    const to = paletteOf(target);
    return {
      elements: applyPalette(elements, from, to),
      meta: { ...meta, styleId: target.id || meta.styleId, palette: to },
      pageBg: to.bg,
      reply: edit.kind === "recolor"
        ? `Switched the accent to ${edit.color.word || edit.color.accent} across buttons, highlights and cards.`
        : `Restyled the site in the ${target.name} look${edit.mode ? ` (${edit.mode} mode)` : ""}. Your text and layout are unchanged.`,
    };
  }

  if (edit.kind === "font") {
    const to = { ...from };
    if (edit.target !== "body") to.head = edit.family;
    if (edit.target !== "head") to.body = edit.family;
    return {
      elements: applyPalette(elements, from, to),
      meta: { ...meta, palette: to },
      pageBg: from.bg,
      reply: `Updated the ${edit.target === "both" ? "headings and body text" : edit.target === "head" ? "headings" : "body text"} to ${edit.family}.`,
    };
  }

  if (edit.kind === "rename") {
    const oldName = meta.brand;
    const newName = edit.to.slice(0, 28);
    if (!oldName || oldName === newName) return null;
    const re = new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
    const renamed = elements.map((el) => (typeof el.content === "string" && el.content.includes(oldName) ? { ...el, content: el.content.replace(re, newName) } : el));
    return {
      elements: renamed,
      meta: { ...meta, brand: newName },
      pageBg: from.bg,
      reply: `Renamed "${oldName}" to "${newName}" everywhere on the page.`,
    };
  }

  if (edit.kind === "addSection") {
    const niche = getNiche(meta.nicheId);
    const intent = parseIntent(meta.brief || "", { nicheId: meta.nicheId });
    const copy = applyFacts(niche.copy, niche, intent);
    copy.brand = meta.brand || copy.brand;
    const style = { ...from, id: meta.styleId, name: "" };
    const built = buildSection({ niche, style, copy, intent, key: edit.section });
    if (!built) {
      return { elements: null, meta, pageBg: from.bg, reply: `This kind of site doesn't have ready-made ${edit.section} content I can add. Describe what should go in it and I'll write it.` };
    }

    // Insert above the closing CTA band (or the footer when there's no CTA).
    const footerY = Math.min(
      ...elements.filter((e) => e.type === "footer").map((e) => e.y - 35),
      ...elements.filter((e) => e.type === "section" && e.styles?.bgType === "gradient" && e.width >= 1100 && e.y > 400).map((e) => e.y),
      Infinity
    );
    const insertY = Number.isFinite(footerY) ? footerY : Math.max(0, ...elements.map((e) => e.y + (Number(e.height) || 0)));
    const shifted = elements.map((e) => (e.y >= insertY ? { ...e, y: e.y + built.height } : e));
    const stamp = Date.now();
    const sectionEls = built.elements.map((el, i) => ({ ...el, id: `el_${stamp}_${i}`, y: el.y + insertY }));
    return {
      elements: [...shifted, ...sectionEls],
      meta,
      pageBg: from.bg,
      reply: `Added a ${edit.section} section above the closing call to action. You can edit its text right on the canvas.`,
    };
  }

  return null;
}
