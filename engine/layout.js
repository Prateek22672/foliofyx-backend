// server/engine/layout.js
// Section builders + page composition for the 1200px absolute-positioned
// canvas. Every text box is measured before it is placed, so longer copy
// grows its section instead of overlapping the next element.

import { SHADOWS } from "../data/designSystem.js";

export const CANVAS_W = 1200;
const M = 100;
const INNER = CANVAS_W - M * 2;
const GAP = 32;
const COL3 = Math.round((INNER - GAP * 2) / 3);
const COL2 = Math.round((INNER - GAP) / 2);

// Average glyph width as a fraction of font size (conservative, so boxes are
// never too short).
const HEAD_FACTOR = {
  "Archivo Black": 0.66, Unbounded: 0.7, Syne: 0.62, "Space Grotesk": 0.57, Sora: 0.59,
  Poppins: 0.61, Montserrat: 0.61, "Playfair Display": 0.56, "Cormorant Garamond": 0.5,
  "Libre Baskerville": 0.62, "DM Serif Display": 0.53, Fraunces: 0.57, Lora: 0.56,
  "Bricolage Grotesque": 0.57, Outfit: 0.56, Manrope: 0.57, "Plus Jakarta Sans": 0.58,
  "Space Mono": 0.62, "EB Garamond": 0.5, Urbanist: 0.55, Lexend: 0.6, Figtree: 0.56, Quicksand: 0.56,
};
const BODY_FACTOR = {
  Montserrat: 0.57, Nunito: 0.53, "Nunito Sans": 0.53, Archivo: 0.54, Karla: 0.52, Lato: 0.52, "DM Sans": 0.53, Inter: 0.53,
  Manrope: 0.54, "Plus Jakarta Sans": 0.55, Outfit: 0.52, "Space Mono": 0.62, "Work Sans": 0.55, "IBM Plex Sans": 0.55,
  Lexend: 0.58, Figtree: 0.53,
};
const hf = (p) => HEAD_FACTOR[p.head] ?? 0.58;
const bf = (p) => BODY_FACTOR[p.body] ?? 0.54;

export function countLines(text, width, fontSize, factor, letterSpacing = 0) {
  const charW = fontSize * factor + letterSpacing;
  const perLine = Math.max(1, Math.floor(width / charW));
  let total = 0;
  for (const para of String(text ?? "").split("\n")) {
    let lines = 1;
    let cur = 0;
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const len = word.length;
      if (len > perLine) {
        lines += (cur ? 1 : 0) + Math.floor((len - 1) / perLine);
        cur = len % perLine || perLine;
      } else if (cur === 0) cur = len;
      else if (cur + 1 + len <= perLine) cur += 1 + len;
      else { lines++; cur = len; }
    }
    total += lines;
  }
  return Math.max(1, total);
}

const textH = (text, width, size, lh, factor, ls = 0) =>
  Math.ceil(countLines(text, width, size, factor, ls) * size * lh) + 6;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

// ── Element factory ───────────────────────────────────────────────────────────
const E = (type, x, y, width, height, content, styles = {}, extra = {}) => ({
  type,
  x: Math.round(x),
  y: Math.round(y),
  width: Math.round(width),
  height: Math.round(height),
  zIndex: extra.zIndex ?? 2,
  visible: true,
  locked: false,
  content: content ?? "",
  src: extra.src ?? "",
  alt: extra.alt ?? "",
  href: extra.href ?? "",
  styles,
});

const band = (y, h, color) => E("section", 0, y, CANVAS_W, h, "", { bgType: "solid", bgColor: color }, { zIndex: 1 });

const toneColor = (p, tone) => (tone === "band" ? p.band : p.bg);
const cardShadow = (p) => (p.dark ? SHADOWS.cardDark : SHADOWS.card);
// "#rrggbb" + two alpha hex digits; anything else passes through unchanged.
const withAlpha = (hex, aa) => (/^#[0-9a-f]{6}$/i.test(hex) ? `${hex}${aa}` : hex);
function btnRadius(p) {
  if (p.buttonShape === "pill") return 999;
  if (p.buttonShape === "sharp") return 0;
  if (p.buttonShape === "rounded") return clamp(p.radius, 6, 14);
  return p.radius >= 20 ? 999 : clamp(p.radius, 4, 14);
}
const btnWidth = (text) => clamp(Math.round(String(text).length * 15 * 0.64 + 64), 140, 320);

function primaryBtn(p) {
  const base = { bgType: "solid", bgColor: p.accent, color: p.onAccent, borderRadius: btnRadius(p), fontFamily: p.body, fontWeight: "700", fontSize: 15 };
  if (p.buttonFill === "outline") return { ...base, bgType: "transparent", bgColor: "transparent", borderColor: p.accent, borderWidth: 2, color: p.accent };
  if (p.buttonFill === "soft") return { ...base, bgColor: withAlpha(p.accent, p.dark ? "2e" : "1f"), color: p.dark ? p.text : p.accent };
  if (!p.gradient) return base;
  return { ...base, bgType: "gradient", gradientFrom: p.accent, gradientTo: p.accent2, gradientDir: "135deg", boxShadow: SHADOWS.glow(p.accent) };
}

function secondaryBtn(p, onColor = p.text) {
  return { bgType: "transparent", bgColor: "transparent", borderColor: onColor, borderWidth: 2, color: onColor, borderRadius: btnRadius(p), fontFamily: p.body, fontWeight: "600", fontSize: 15 };
}

// Card surface per the style's cardStyle: shadow (lifted), border (hairline
// outline), tint (soft accent wash) or flat (plain card colour).
function cardSurface(p) {
  if (p.cardStyle === "border") return { boxShadow: "none", borderWidth: 1, cardBorder: withAlpha(p.text, p.dark ? "29" : "1f") };
  if (p.cardStyle === "tint") return { bgColor: withAlpha(p.accent, p.dark ? "1a" : "0f"), boxShadow: "none" };
  if (p.cardStyle === "flat") return { boxShadow: "none" };
  return { boxShadow: cardShadow(p) };
}

function cardStyle(p, extra = {}) {
  return { bgType: "solid", bgColor: p.card, color: p.text, borderColor: p.accent, fontFamily: p.head, borderRadius: p.radius + 4, ...cardSurface(p), ...extra };
}

// Subtle background pattern on the alternate (band-tone) sections.
function decorate(elements, p) {
  if (!p.pattern || p.pattern === "none") return elements;
  return elements.map((el) => (
    el.type === "section" && el.width >= CANVAS_W && el.height >= 160 && el.styles?.bgType === "solid" && el.styles.bgColor === p.band
      ? { ...el, styles: { ...el.styles, bgPattern: p.pattern, patternColor: p.text, patternOpacity: p.patternOpacity ?? 0.07 } }
      : el
  ));
}

function buttonRow(p, x, y, cta1, cta2, { align = "left", onDark = false } = {}) {
  const w1 = btnWidth(cta1);
  const w2 = cta2 ? btnWidth(cta2) : 0;
  const total = w1 + (cta2 ? 14 + w2 : 0);
  const startX = align === "center" ? (CANVAS_W - total) / 2 : x;
  // Over a photo only a solid fill stays legible.
  const els = [E("button", startX, y, w1, 54, cta1, primaryBtn(onDark ? { ...p, buttonFill: "solid" } : p), { zIndex: 3 })];
  if (cta2) els.push(E("button", startX + w1 + 14, y, w2, 54, cta2, secondaryBtn(p, onDark ? "#ffffff" : p.text), { zIndex: 3 }));
  return els;
}

// Centered (or left) label + heading + optional sub. Returns elements and the y below them.
function sectionHead(p, y, { label, heading, sub }, { align = "center", x = M, w = INNER, color } = {}) {
  const els = [];
  const hw = align === "center" ? 760 : w;
  const hx = align === "center" ? (CANVAS_W - hw) / 2 : x;
  let cy = y;
  if (label) {
    els.push(E("label", hx, cy, hw, 20, label, { color: p.accent, fontFamily: p.body, fontSize: 12, letterSpacing: 3, fontWeight: "700", textAlign: align }));
    cy += 34;
  }
  const hh = textH(heading, hw, 40, 1.15, hf(p));
  els.push(E("heading", hx, cy, hw, hh, heading, { color: color || p.text, fontFamily: p.head, fontSize: 40, fontWeight: "800", lineHeight: 1.15, letterSpacing: -0.5, textAlign: align }));
  cy += hh;
  if (sub) {
    const sw = align === "center" ? 640 : w;
    const sx = align === "center" ? (CANVAS_W - sw) / 2 : x;
    const sh = textH(sub, sw, 17, 1.6, bf(p));
    els.push(E("paragraph", sx, cy + 14, sw, sh, sub, { color: p.muted, fontFamily: p.body, fontSize: 17, lineHeight: 1.6, textAlign: align }));
    cy += 14 + sh;
  }
  return { els, bottom: cy };
}

const PAD = 96;

// ── Sections ──────────────────────────────────────────────────────────────────
// Each builder: (ctx, tone) => (y) => ({ els, h })

function navbar(ctx) {
  const { p } = ctx;
  return (y) => ({
    h: 76,
    els: [
      band(y, 76, p.bg),
      E("navbar", 0, y, CANVAS_W, 76, ctx.brand, { bgColor: "transparent", color: p.text, borderColor: p.accent, fontFamily: p.head, fontSize: 20, padding: M }, { zIndex: 3 }),
    ],
  });
}

function heroText(ctx, width, align, onDark) {
  const { p, copy } = ctx;
  const size = align === "center" ? 60 : 54;
  const hh = textH(copy.heading, width, size, 1.08, hf(p));
  const subW = align === "center" ? Math.min(width, 640) : Math.min(width, 500);
  const sh = textH(copy.sub, subW, 18, 1.6, bf(p));
  const height = 20 + 18 + hh + 20 + sh + 34 + 54;
  const build = (x, y) => {
    const tx = align === "center" ? (CANVAS_W - width) / 2 : x;
    const sx = align === "center" ? (CANVAS_W - subW) / 2 : x;
    const text = onDark ? "#ffffff" : p.text;
    const muted = onDark ? "rgba(255,255,255,0.86)" : p.muted;
    const labelColor = onDark ? "#ffffff" : p.accent;
    let cy = y;
    const els = [];
    els.push(E("label", tx, cy, width, 20, copy.label, { color: labelColor, fontFamily: p.body, fontSize: 12, letterSpacing: 3, fontWeight: "700", textAlign: align }, { zIndex: 3 }));
    cy += 38;
    els.push(E("heading", tx, cy, width, hh, copy.heading, { color: text, fontFamily: p.head, fontSize: size, fontWeight: "800", lineHeight: 1.08, letterSpacing: -1, textAlign: align }, { zIndex: 3 }));
    cy += hh + 20;
    els.push(E("paragraph", sx, cy, subW, sh, copy.sub, { color: muted, fontFamily: p.body, fontSize: 18, lineHeight: 1.6, textAlign: align }, { zIndex: 3 }));
    cy += sh + 34;
    els.push(...buttonRow(p, x, cy, copy.cta1, copy.cta2, { align, onDark }));
    return els;
  };
  return { height, build };
}

function heroSplit(ctx) {
  const { p, images, copy } = ctx;
  return (y) => {
    const t = heroText(ctx, 520, "left", false);
    const imgH = 460;
    const H = Math.max(t.height, imgH) + 2 * 76;
    return {
      h: H,
      els: [
        band(y, H, p.bg),
        ...t.build(M, y + (H - t.height) / 2),
        E("image", 660, y + (H - imgH) / 2, 440, imgH, "", { borderRadius: p.radius + 10, objectFit: "cover", boxShadow: SHADOWS.lift }, { src: images.hero, alt: copy.heading }),
      ],
    };
  };
}

function heroOverlay(ctx) {
  const { p, images, copy } = ctx;
  return (y) => {
    const t = heroText(ctx, 840, "center", true);
    const H = Math.max(620, t.height + 300);
    return {
      h: H,
      els: [
        E("image", 0, y, CANVAS_W, H, "", { objectFit: "cover" }, { zIndex: 1, src: images.hero, alt: copy.heading }),
        E("section", 0, y, CANVAS_W, H, "", { bgType: "gradient", gradientFrom: "rgba(8,8,12,0.45)", gradientTo: "rgba(8,8,12,0.82)", gradientDir: "180deg" }, { zIndex: 2 }),
        ...t.build(M, y + (H - t.height) / 2),
      ],
    };
  };
}

function heroStacked(ctx) {
  const { p, images, copy } = ctx;
  return (y) => {
    const t = heroText(ctx, 860, "center", false);
    const imgH = 460;
    const H = 88 + t.height + 64 + imgH + 88;
    return {
      h: H,
      els: [
        band(y, H, p.bg),
        ...t.build(M, y + 88),
        E("image", M, y + 88 + t.height + 64, INNER, imgH, "", { borderRadius: p.radius + 10, objectFit: "cover", boxShadow: SHADOWS.lift }, { src: images.hero, alt: copy.heading }),
      ],
    };
  };
}

const PARTNERS = ["Northwind", "Lumen", "Arcadia", "Kestrel", "Halcyon"];

function logos(ctx, tone) {
  const { p } = ctx;
  return (y) => ({
    h: 120,
    els: [
      band(y, 120, toneColor(p, tone)),
      E("label", M, y + 18, INNER, 20, ctx.archetype === "agency" ? "TRUSTED BY TEAMS AT" : "USED BY TEAMS AT", { color: p.muted, fontFamily: p.body, fontSize: 11, letterSpacing: 3, fontWeight: "700", textAlign: "center" }),
      E("logostrip", M, y + 48, INNER, 50, PARTNERS.join("|"), { color: p.muted, fontFamily: p.head, padding: 0 }),
    ],
  });
}

function stats(ctx, tone) {
  const { p, copy } = ctx;
  const w = Math.round((INNER - GAP * 3) / 4);
  return (y) => ({
    h: 210,
    els: [
      band(y, 210, toneColor(p, tone)),
      ...copy.stats.slice(0, 4).map((s, i) =>
        E("stats", M + i * (w + GAP), y + 55, w, 100, `${s.num}|${s.label}`, { color: p.accent, fontFamily: p.head, fontSize: 48, textAlign: "center" })),
    ],
  });
}

function offeringsGrid(ctx, tone, count = 6) {
  const { p, copy } = ctx;
  const items = copy.offerings.items.slice(0, count);
  const inner = COL3 - 56;
  const cardH = Math.max(...items.map((it) =>
    28 + 48 + 12 + textH(it.title, inner, 18, 1.3, hf(p)) + 12 + textH(it.desc, inner, 14, 1.6, 0.54) + 28));
  return (y) => {
    const head = sectionHead(p, y + PAD, copy.offerings);
    const top = head.bottom + 52;
    const rows = Math.ceil(items.length / 3);
    const H = top - y + rows * cardH + (rows - 1) * GAP + PAD;
    return {
      h: H,
      els: [
        band(y, H, toneColor(p, tone)),
        ...head.els,
        ...items.map((it, i) => E("feature", M + (i % 3) * (COL3 + GAP), top + Math.floor(i / 3) * (cardH + GAP), COL3, cardH,
          `${it.title}|${it.desc}|${it.icon}`, cardStyle(p, { padding: 28 }))),
      ],
    };
  };
}

function offeringsList(ctx, tone) {
  const { p, copy } = ctx;
  const items = copy.offerings.items.slice(0, 6);
  const inner = COL2 - 48 - 44 - 16;
  const rowH = Math.max(...items.map((it) =>
    48 + Math.max(44, textH(it.title, inner, 16, 1.3, hf(p)) + 6 + textH(it.desc, inner, 13, 1.5, 0.54))));
  return (y) => {
    const head = sectionHead(p, y + PAD, copy.offerings);
    const top = head.bottom + 52;
    const rows = Math.ceil(items.length / 2);
    const H = top - y + rows * rowH + (rows - 1) * 20 + PAD;
    return {
      h: H,
      els: [
        band(y, H, toneColor(p, tone)),
        ...head.els,
        ...items.map((it, i) => E("service", M + (i % 2) * (COL2 + GAP), top + Math.floor(i / 2) * (rowH + 20), COL2, rowH,
          `${it.title}|${it.desc}|${it.icon}`, cardStyle(p, { padding: 24 }))),
      ],
    };
  };
}

function showcase(ctx, tone, count = 3) {
  const { p, copy, images } = ctx;
  const items = copy.showcase.items.slice(0, count);
  const inner = COL3 - 40;
  const cardH = Math.max(...items.map((it) =>
    180 + 16 + textH(it.name, inner, 17, 1.3, hf(p)) + 6 + 30 + 6 + textH(it.details, inner, 13, 1.45, 0.54) + 20));
  return (y) => {
    const head = sectionHead(p, y + PAD, copy.showcase);
    const top = head.bottom + 52;
    const rows = Math.ceil(items.length / 3);
    const H = top - y + rows * cardH + (rows - 1) * GAP + PAD;
    return {
      h: H,
      els: [
        band(y, H, toneColor(p, tone)),
        ...head.els,
        ...items.map((it, i) => E("property", M + (i % 3) * (COL3 + GAP), top + Math.floor(i / 3) * (cardH + GAP), COL3, cardH,
          `${it.name}|${it.meta}|${it.details}`, cardStyle(p, { borderColor: p.accent }),
          { src: images.items[i % images.items.length], alt: it.name })),
      ],
    };
  };
}

function about(ctx, tone, imageLeft = true) {
  const { p, copy, images } = ctx;
  const a = copy.about;
  const tw = 480;
  const hh = textH(a.heading, tw, 36, 1.15, hf(p));
  const b1 = textH(a.body1, tw, 16, 1.7, bf(p));
  const b2 = textH(a.body2, tw, 16, 1.7, bf(p));
  const contentH = 34 + hh + 20 + b1 + 14 + b2;
  const imgH = 420;
  return (y) => {
    const H = Math.max(imgH, contentH) + 2 * PAD;
    const ix = imageLeft ? M : CANVAS_W - M - 460;
    const tx = imageLeft ? 620 : M;
    let cy = y + (H - contentH) / 2;
    const els = [
      band(y, H, toneColor(p, tone)),
      E("image", ix, y + (H - imgH) / 2, 460, imgH, "", { borderRadius: p.radius + 8, objectFit: "cover", boxShadow: p.dark ? SHADOWS.cardDark : SHADOWS.lift }, { src: images.about, alt: a.heading }),
      E("label", tx, cy, tw, 20, a.label, { color: p.accent, fontFamily: p.body, fontSize: 12, letterSpacing: 3, fontWeight: "700" }),
    ];
    cy += 34;
    els.push(E("heading", tx, cy, tw, hh, a.heading, { color: p.text, fontFamily: p.head, fontSize: 36, fontWeight: "800", lineHeight: 1.15, letterSpacing: -0.5 }));
    cy += hh + 20;
    els.push(E("paragraph", tx, cy, tw, b1, a.body1, { color: p.muted, fontFamily: p.body, fontSize: 16, lineHeight: 1.7 }));
    cy += b1 + 14;
    els.push(E("paragraph", tx, cy, tw, b2, a.body2, { color: p.muted, fontFamily: p.body, fontSize: 16, lineHeight: 1.7 }));
    return { h: H, els };
  };
}

function testimonials(ctx, tone) {
  const { p, copy } = ctx;
  const items = copy.testimonials.items.slice(0, 3);
  const inner = COL3 - 56;
  const cardH = Math.max(...items.map((t) => 28 + 44 + 12 + textH(t.quote, inner, 16, 1.7, 0.56) + 18 + 22 + 22 + 20 + 28));
  return (y) => {
    const head = sectionHead(p, y + PAD, copy.testimonials);
    const top = head.bottom + 52;
    const H = top - y + cardH + PAD;
    return {
      h: H,
      els: [
        band(y, H, toneColor(p, tone)),
        ...head.els,
        ...items.map((t, i) => E("testimonial", M + i * (COL3 + GAP), top, COL3, cardH, `${t.quote}|${t.name}|${t.role}`,
          cardStyle(p, { fontFamily: p.body, padding: 28 }))),
      ],
    };
  };
}

function faq(ctx, tone) {
  const { p, copy } = ctx;
  const items = copy.faq.items.slice(0, 4);
  const inner = COL2 - 48;
  const heights = items.map((f) => 24 + textH(f.q, inner - 32, 17, 1.4, hf(p)) + 10 + textH(f.a, inner, 14, 1.6, 0.54) + 24);
  return (y) => {
    const head = sectionHead(p, y + PAD, copy.faq);
    const top = head.bottom + 52;
    const rowH = [Math.max(heights[0] || 0, heights[1] || 0), Math.max(heights[2] || 0, heights[3] || 0)];
    const rows = Math.ceil(items.length / 2);
    const H = top - y + rowH.slice(0, rows).reduce((a, b) => a + b, 0) + (rows - 1) * 20 + PAD;
    return {
      h: H,
      els: [
        band(y, H, toneColor(p, tone)),
        ...head.els,
        ...items.map((f, i) => {
          const row = Math.floor(i / 2);
          const ry = top + (row === 0 ? 0 : rowH[0] + 20);
          return E("faq", M + (i % 2) * (COL2 + GAP), ry, COL2, rowH[row], `${f.q}|${f.a}`, cardStyle(p, { padding: 24 }));
        }),
      ],
    };
  };
}

function pricing(ctx, tone) {
  const { p, copy } = ctx;
  const plans = copy.pricing.plans.slice(0, 3);
  const inner = COL3 - 60;
  const cardH = Math.max(...plans.map((pl) =>
    30 + 15 + 16 + 46 + 16 + textH(pl.desc, inner, 14, 1.5, 0.54) + 16 + pl.features.length * 21 + (pl.features.length - 1) * 8 + 34));
  return (y) => {
    const head = sectionHead(p, y + PAD, copy.pricing);
    const top = head.bottom + 52;
    const H = top - y + cardH + PAD;
    return {
      h: H,
      els: [
        band(y, H, toneColor(p, tone)),
        ...head.els,
        ...plans.map((pl, i) => {
          const featured = i === 1;
          const content = [pl.plan, pl.price, pl.period || "", pl.desc, ...pl.features].join("|");
          const style = featured
            ? {
              ...(p.gradient
                ? { bgType: "gradient", bgColor: p.accent, gradientFrom: p.accent, gradientTo: p.accent2, gradientDir: "160deg", boxShadow: SHADOWS.glow(p.accent) }
                : { bgType: "solid", bgColor: p.accent, boxShadow: cardShadow(p) }),
              color: p.onAccent, fontFamily: p.head, fontSize: 44, borderRadius: p.radius + 4, padding: 30,
            }
            : cardStyle(p, { fontSize: 44, padding: 30, borderWidth: 1, borderColor: p.dark ? "#ffffff1f" : "#0f172a14" });
          return E("pricing", M + i * (COL3 + GAP), top, COL3, cardH, content, style);
        }),
      ],
    };
  };
}

function timeline(ctx, tone) {
  const { p, copy } = ctx;
  const items = copy.timeline.items.slice(0, 4);
  const tx = 540;
  const tw = CANVAS_W - M - tx;
  const inner = tw - 32 - 28;
  const itemHs = items.map((t) => 16 + 18 + textH(t.title, inner, 16, 1.3, hf(p)) + 4 + textH(t.desc, inner, 13, 1.5, 0.54) + 32);
  return (y) => {
    const head = sectionHead(p, y + PAD, copy.timeline, { align: "left", x: M, w: 380 });
    const listH = itemHs.reduce((a, b) => a + b, 0);
    const H = Math.max(head.bottom - y, listH) + 2 * PAD;
    let cy = y + PAD;
    const els = [band(y, H, toneColor(p, tone)), ...head.els];
    items.forEach((t, i) => {
      els.push(E("timeline", tx, cy, tw, itemHs[i], `${t.title}|${t.desc}|${t.year}`, { color: p.text, borderColor: p.accent, fontFamily: p.head, padding: 16 }));
      cy += itemHs[i];
    });
    return { h: H, els };
  };
}

function team(ctx, tone) {
  const { p, copy } = ctx;
  const items = copy.team.items.slice(0, 3);
  const inner = COL3 - 48;
  const cardH = Math.max(...items.map((t) => 24 + 80 + 12 + textH(t.name, inner, 17, 1.3, hf(p)) + 20 + 8 + textH(t.bio, inner, 13, 1.5, 0.54) + 28));
  return (y) => {
    const head = sectionHead(p, y + PAD, copy.team);
    const top = head.bottom + 52;
    const H = top - y + cardH + PAD;
    return {
      h: H,
      els: [
        band(y, H, toneColor(p, tone)),
        ...head.els,
        ...items.map((t, i) => E("team", M + i * (COL3 + GAP), top, COL3, cardH, `${t.name}|${t.title}|${t.bio}`, cardStyle(p, { padding: 24 }))),
      ],
    };
  };
}

function gallery(ctx, tone) {
  const { p, images, copy } = ctx;
  const pool = [images.hero, images.about, ...images.items].filter(Boolean);
  const pics = Array.from({ length: 6 }, (_, i) => pool[i % pool.length]);
  const head = { label: "GALLERY", heading: ctx.galleryHeading || `Inside ${ctx.brand}` };
  return (y) => {
    const h = sectionHead(p, y + PAD, head);
    const top = h.bottom + 52;
    const H = top - y + 2 * 250 + GAP + PAD;
    return {
      h: H,
      els: [
        band(y, H, toneColor(p, tone)),
        ...h.els,
        ...pics.map((src, i) => E("image", M + (i % 3) * (COL3 + GAP), top + Math.floor(i / 3) * (250 + GAP), COL3, 250, "",
          { borderRadius: p.radius + 4, objectFit: "cover" }, { src, alt: `${copy.heading} ${i + 1}` })),
      ],
    };
  };
}

function contact(ctx, tone) {
  const { p } = ctx;
  const c = ctx.contact;
  const tw = 440;
  const hh = textH(c.heading, tw, 36, 1.15, hf(p));
  const bh = textH(c.body, tw, 16, 1.7, bf(p));
  const lineH = c.lines.map((l) => textH(l, tw, 15, 1.5, bf(p)));
  const contentH = 34 + hh + 18 + bh + 24 + lineH.reduce((a, b) => a + b + 8, 0);
  const formH = 380;
  return (y) => {
    const H = Math.max(contentH, formH) + 2 * PAD;
    let cy = y + (H - contentH) / 2;
    const els = [
      band(y, H, toneColor(p, tone)),
      E("label", M, cy, tw, 20, c.label, { color: p.accent, fontFamily: p.body, fontSize: 12, letterSpacing: 3, fontWeight: "700" }),
    ];
    cy += 34;
    els.push(E("heading", M, cy, tw, hh, c.heading, { color: p.text, fontFamily: p.head, fontSize: 36, fontWeight: "800", lineHeight: 1.15, letterSpacing: -0.5 }));
    cy += hh + 18;
    els.push(E("paragraph", M, cy, tw, bh, c.body, { color: p.muted, fontFamily: p.body, fontSize: 16, lineHeight: 1.7 }));
    cy += bh + 24;
    c.lines.forEach((line, i) => {
      els.push(E("paragraph", M, cy, tw, lineH[i], line, { color: p.text, fontFamily: p.body, fontSize: 15, lineHeight: 1.5, fontWeight: "600" }));
      cy += lineH[i] + 8;
    });
    els.push(E("form", 620, y + (H - formH) / 2, 480, formH, "", {
      bgType: "solid", bgColor: p.card, borderColor: p.accent, color: p.onAccent, borderRadius: p.radius + 4, boxShadow: cardShadow(p), padding: 32,
    }));
    return { h: H, els };
  };
}

function newsletter(ctx, tone) {
  const { p } = ctx;
  const n = ctx.newsletter;
  return (y) => {
    const head = sectionHead(p, y + PAD, n);
    const top = head.bottom + 36;
    const bw = btnWidth(n.button);
    const total = 380 + 12 + bw;
    const x0 = (CANVAS_W - total) / 2;
    const H = top - y + 54 + PAD;
    return {
      h: H,
      els: [
        band(y, H, toneColor(p, tone)),
        ...head.els,
        E("input", x0, top, 380, 54, n.placeholder, { borderColor: p.dark ? "#ffffff33" : "#0f172a26", borderRadius: btnRadius(p), fontSize: 15, color: "#374151", bgColor: "#ffffff" }),
        E("button", x0 + 392, top, bw, 54, n.button, primaryBtn(p)),
      ],
    };
  };
}

function ctaBand(ctx) {
  const { p, copy } = ctx;
  const c = copy.cta;
  const hw = 760;
  const hh = textH(c.heading, hw, 40, 1.15, hf(p));
  const sh = textH(c.sub, 620, 17, 1.6, bf(p));
  const contentH = hh + 16 + sh + 30 + 54;
  const light = p.onAccent.toLowerCase() === "#ffffff";
  return (y) => {
    const H = contentH + 2 * PAD;
    let cy = y + PAD;
    const bg = p.gradient
      ? { bgType: "gradient", bgColor: p.accent, gradientFrom: p.accent, gradientTo: p.accent2, gradientDir: "120deg" }
      : { bgType: "solid", bgColor: p.accent };
    const els = [E("section", 0, y, CANVAS_W, H, "", bg, { zIndex: 1 })];
    els.push(E("heading", (CANVAS_W - hw) / 2, cy, hw, hh, c.heading, { color: p.onAccent, fontFamily: p.head, fontSize: 40, fontWeight: "800", lineHeight: 1.15, letterSpacing: -0.5, textAlign: "center" }));
    cy += hh + 16;
    els.push(E("paragraph", (CANVAS_W - 620) / 2, cy, 620, sh, c.sub, { color: light ? "rgba(255,255,255,0.9)" : p.onAccent, fontFamily: p.body, fontSize: 17, lineHeight: 1.6, textAlign: "center" }));
    cy += sh + 30;
    const bw = btnWidth(c.button);
    els.push(E("button", (CANVAS_W - bw) / 2, cy, bw, 54, c.button, {
      bgType: "solid", bgColor: p.onAccent, color: light ? p.accent2 : p.accent, borderRadius: btnRadius(p), fontFamily: p.body, fontWeight: "700", fontSize: 15, boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
    }));
    return { h: H, els };
  };
}

function footer(ctx) {
  const { p } = ctx;
  return (y) => ({
    h: 110,
    els: [
      band(y, 110, p.band),
      E("footer", 0, y + 35, CANVAS_W, 40, `© ${ctx.year} ${ctx.brand}. All rights reserved.`, { color: p.muted, fontFamily: p.body, padding: M }),
    ],
  });
}

// ── Recipes ───────────────────────────────────────────────────────────────────
// "?" = only when the niche copy has that block. Tone alternates automatically.
export const RECIPES = {
  store: [
    ["navbar", "heroSplit", "showcase6", "offeringsGrid", "stats", "about", "testimonials", "faq", "cta", "footer"],
    ["navbar", "heroOverlay", "offeringsList", "showcase3", "aboutRight", "testimonials", "faq", "cta", "footer"],
    ["navbar", "heroStacked", "showcase6", "about", "offeringsGrid3", "testimonials", "newsletter", "footer"],
  ],
  restaurant: [
    ["navbar", "heroOverlay", "about", "showcase6", "offeringsList", "gallery", "testimonials", "contact", "footer"],
    ["navbar", "heroSplit", "showcase3", "aboutRight", "stats", "testimonials", "faq", "cta", "footer"],
  ],
  hotel: [
    ["navbar", "heroOverlay", "offeringsGrid", "showcase3", "about", "gallery", "testimonials", "faq", "cta", "footer"],
    ["navbar", "heroStacked", "showcase3", "offeringsList", "stats", "testimonials", "contact", "footer"],
  ],
  saas: [
    ["navbar", "heroSplit", "logos", "offeringsGrid", "stats", "pricing", "testimonials", "faq", "cta", "footer"],
    ["navbar", "heroStacked", "offeringsGrid", "aboutRight", "pricing", "testimonials", "faq", "cta", "footer"],
  ],
  agency: [
    ["navbar", "heroOverlay", "logos", "offeringsList", "showcase3?", "stats", "testimonials", "team?", "cta", "footer"],
    ["navbar", "heroSplit", "offeringsGrid", "showcase6?", "about", "testimonials", "contact", "footer"],
  ],
  local: [
    ["navbar", "heroSplit", "offeringsGrid", "about", "stats", "pricing?", "testimonials", "faq", "contact", "footer"],
    ["navbar", "heroOverlay", "offeringsList", "aboutRight", "team?", "testimonials", "faq", "cta", "footer"],
  ],
  portfolio: [
    ["navbar", "heroSplit", "stats", "offeringsGrid", "showcase3", "timeline", "testimonials", "contact", "footer"],
    ["navbar", "heroStacked", "showcase6", "offeringsList", "timeline", "testimonials", "faq", "cta", "footer"],
  ],
  event: [
    ["navbar", "heroOverlay", "about", "timeline", "team?", "pricing?", "faq", "cta", "footer"],
    ["navbar", "heroStacked", "stats", "timeline", "offeringsGrid3", "pricing?", "faq", "cta", "footer"],
  ],
  nonprofit: [
    ["navbar", "heroOverlay", "stats", "about", "offeringsGrid", "testimonials", "pricing?", "faq", "cta", "footer"],
    ["navbar", "heroSplit", "aboutRight", "offeringsList", "stats", "gallery", "testimonials", "cta", "footer"],
  ],
  listing: [
    ["navbar", "heroOverlay", "stats", "showcase6", "offeringsGrid3", "about", "testimonials", "faq", "cta", "footer"],
    ["navbar", "heroSplit", "showcase3", "offeringsList", "testimonials", "contact", "footer"],
  ],
  education: [
    ["navbar", "heroSplit", "offeringsGrid", "stats", "pricing", "team?", "testimonials", "faq", "cta", "footer"],
    ["navbar", "heroStacked", "about", "offeringsList", "pricing", "testimonials", "faq", "cta", "footer"],
  ],
  creator: [
    ["navbar", "heroSplit", "showcase3", "about", "stats", "testimonials", "newsletter", "footer"],
    ["navbar", "heroStacked", "showcase6", "offeringsGrid3", "testimonials", "newsletter", "footer"],
  ],
};

// section key → { build, needs (copy block), tone: true when it takes the alternating tone }
const SECTIONS = {
  navbar: { build: (c) => navbar(c) },
  heroSplit: { build: (c) => heroSplit(c), hero: true },
  heroOverlay: { build: (c) => heroOverlay(c), hero: true },
  heroStacked: { build: (c) => heroStacked(c), hero: true },
  logos: { build: (c, t) => logos(c, t), tone: true },
  stats: { build: (c, t) => stats(c, t), tone: true, needs: "stats" },
  offeringsGrid: { build: (c, t) => offeringsGrid(c, t, 6), tone: true, needs: "offerings" },
  offeringsGrid3: { build: (c, t) => offeringsGrid(c, t, 3), tone: true, needs: "offerings" },
  offeringsList: { build: (c, t) => offeringsList(c, t), tone: true, needs: "offerings" },
  showcase3: { build: (c, t) => showcase(c, t, 3), tone: true, needs: "showcase" },
  showcase6: { build: (c, t) => showcase(c, t, c.copy.showcase.items.length >= 6 ? 6 : 3), tone: true, needs: "showcase" },
  about: { build: (c, t) => about(c, t, true), tone: true, needs: "about" },
  aboutRight: { build: (c, t) => about(c, t, false), tone: true, needs: "about" },
  testimonials: { build: (c, t) => testimonials(c, t), tone: true, needs: "testimonials" },
  faq: { build: (c, t) => faq(c, t), tone: true, needs: "faq" },
  pricing: { build: (c, t) => pricing(c, t), tone: true, needs: "pricing" },
  timeline: { build: (c, t) => timeline(c, t), tone: true, needs: "timeline" },
  team: { build: (c, t) => team(c, t), tone: true, needs: "team" },
  gallery: { build: (c, t) => gallery(c, t), tone: true },
  contact: { build: (c, t) => contact(c, t), tone: true },
  newsletter: { build: (c, t) => newsletter(c, t), tone: true },
  cta: { build: (c) => ctaBand(c), needs: "cta" },
  footer: { build: (c) => footer(c) },
};

// Canonical section names used by intent include/exclude.
const FAMILY = {
  showcase: ["showcase3", "showcase6"],
  pricing: ["pricing"],
  faq: ["faq"],
  team: ["team"],
  testimonials: ["testimonials"],
  gallery: ["gallery"],
  contact: ["contact"],
  timeline: ["timeline"],
  stats: ["stats"],
};

function hasBlock(copy, needs) {
  if (!needs) return true;
  const b = copy[needs];
  if (!b) return false;
  if (Array.isArray(b)) return b.length > 0;
  return !(b.items && !b.items.length) && !(b.plans && !b.plans.length);
}

export function resolveRecipe(archetype, copy, { variant = 0, include = [], exclude = [] } = {}) {
  const list = RECIPES[archetype] || RECIPES.local;
  const base = list[Math.abs(variant) % list.length];
  let keys = base
    .map((k) => k.replace(/\?$/, ""))
    .filter((k) => SECTIONS[k] && hasBlock(copy, SECTIONS[k].needs));

  for (const fam of exclude) {
    const drop = new Set(FAMILY[fam] || []);
    keys = keys.filter((k) => !drop.has(k));
  }
  for (const fam of include) {
    const members = FAMILY[fam];
    if (!members || keys.some((k) => members.includes(k))) continue;
    const key = members[0];
    if (!hasBlock(copy, SECTIONS[key].needs)) continue;
    const before = keys.findIndex((k) => k === "cta" || k === "newsletter" || k === "footer");
    keys.splice(before === -1 ? keys.length : before, 0, key);
  }
  return keys;
}

export function sectionAvailable(copy, key) {
  return Boolean(SECTIONS[key]) && hasBlock(copy, SECTIONS[key].needs);
}

// One section laid out from y = 0 (for inserting into an existing page).
export function composeSection(ctx, key, tone = "band") {
  const def = SECTIONS[key];
  const { els, h } = def.build(ctx, def.tone ? tone : undefined)(0);
  return { elements: decorate(els, ctx.p), height: h };
}

export function composePage(ctx, keys) {
  let y = 0;
  let toneIdx = 0;
  let prevHeroOverlay = false;
  const out = [];
  for (const key of keys) {
    const def = SECTIONS[key];
    let tone;
    if (def.tone) {
      // The section right after a plain hero starts on the band tone for contrast.
      tone = toneIdx % 2 === 0 ? (prevHeroOverlay ? "bg" : "band") : (prevHeroOverlay ? "band" : "bg");
      toneIdx++;
    }
    const { els, h } = def.build(ctx, tone)(y);
    if (def.hero) prevHeroOverlay = key === "heroOverlay";
    out.push(...els);
    y += h;
  }
  return { elements: decorate(out, ctx.p).map((el, i) => ({ ...el, id: `t${i}` })), height: y };
}
