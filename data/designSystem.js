// server/data/designSystem.js
// ─────────────────────────────────────────────────────────────────────────────
// PREMIUM DESIGN SYSTEM (RAG resource library)
//
// A curated, reusable knowledge base of award-winning design tokens — font
// pairings, colour treatments, shadow/spacing scales — used to lift the
// "Design from Reference" output from "ok" to "premium / studio quality".
//
// Two jobs:
//   1. describePremiumGuide(vibe)  → text injected into the vision prompt so the
//      model designs to a high bar (the RAG retrieval step).
//   2. polishElements(...)         → deterministic post-processing that snaps the
//      model's output onto these premium tokens (the "ML can't be trusted to be
//      consistent, so enforce it" step). This is what guarantees quality even
//      when the model is sloppy.
//
// Everything here is plain data → easy to extend, and shared by any feature.
// ─────────────────────────────────────────────────────────────────────────────

// ── Award-winning Google-font pairings, keyed by visual vibe ──────────────────
// (heading, body). All are real Google Fonts the renderer can load on demand.
export const FONT_PAIRINGS = {
  editorial:   { head: "Playfair Display", body: "DM Sans",        note: "elegant serif display + clean sans — luxury / editorial / agency" },
  modern:      { head: "Syne",             body: "Inter",          note: "geometric display + neutral sans — modern tech / creative" },
  techy:       { head: "Space Grotesk",    body: "Inter",          note: "engineered grotesk — SaaS / product / startup" },
  bold:        { head: "Oswald",           body: "Inter",          note: "tall condensed — sport / bold marketing / events" },
  refined:     { head: "Fraunces",         body: "Outfit",         note: "soft modern serif — premium brand / wellness" },
  minimal:     { head: "Outfit",           body: "Outfit",         note: "single clean geometric — minimal portfolio" },
  corporate:   { head: "Sora",             body: "Inter",          note: "balanced sans — finance / law / corporate" },
  warm:        { head: "Playfair Display", body: "Nunito Sans",    note: "serif + friendly sans — restaurant / hospitality" },
};

// Map an industry → default vibe when the model doesn't pick one.
const INDUSTRY_VIBE = {
  saas: "techy", marketing: "modern", realestate: "editorial", restaurant: "warm",
  portfolio: "modern", ecommerce: "minimal", law: "corporate", hotel: "refined", general: "modern",
};

// All fonts we actively recommend (so we can tell the model the menu).
export const PREMIUM_FONTS = [
  "Playfair Display", "Fraunces", "Syne", "Space Grotesk", "Sora", "Outfit",
  "Inter", "DM Sans", "Oswald", "Nunito Sans", "Manrope", "Bricolage Grotesque",
];

// Premium shadow scale (soft, layered — the kind that reads as "expensive").
export const SHADOWS = {
  card:    "0 10px 30px rgba(2,6,23,0.08), 0 2px 8px rgba(2,6,23,0.04)",
  cardDark:"0 18px 50px rgba(0,0,0,0.45)",
  lift:    "0 24px 60px rgba(2,6,23,0.18)",
  glow:    (hex) => `0 14px 40px ${hexA(hex, 0.45)}`,
};

export const RADIUS = { sm: 10, md: 16, lg: 24, pill: 999 };

// ── colour helpers ────────────────────────────────────────────────────────────
function clampHex(h, fb = "#6366f1") {
  return typeof h === "string" && /^#?[0-9a-fA-F]{6}$/.test(h.replace("#", "")) ? (h[0] === "#" ? h : "#" + h) : fb;
}
function toRgb(hex) {
  const h = clampHex(hex).slice(1);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function hexA(hex, a) {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function lum(hex) {
  const [r, g, b] = toRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
// Shift a hex toward black/white by t (−1..1).
function shade(hex, t) {
  let [r, g, b] = toRgb(hex);
  const tgt = t < 0 ? 0 : 255;
  const a = Math.abs(t);
  r = Math.round(r + (tgt - r) * a);
  g = Math.round(g + (tgt - g) * a);
  b = Math.round(b + (tgt - b) * a);
  return "#" + [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
}
export const colorUtil = { clampHex, hexA, lum, shade, toRgb };

// Build a coherent premium palette from a base bg + accent (+ dark flag).
export function buildPalette({ bg, accent, dark }) {
  bg = clampHex(bg, dark ? "#0b0d14" : "#ffffff");
  accent = clampHex(accent, "#6366f1");
  const isDark = typeof dark === "boolean" ? dark : lum(bg) < 128;
  return {
    bg,
    dark: isDark,
    text: isDark ? "#f8fafc" : "#0f172a",
    muted: isDark ? "#94a3b8" : "#64748b",
    accent,
    accent2: shade(accent, isDark ? 0.18 : -0.18),
    band: isDark ? shade(bg, 0.06) : shade(bg, -0.02),
    card: isDark ? shade(bg, 0.1) : "#ffffff",
    border: isDark ? hexA("#ffffff", 0.08) : hexA("#0f172a", 0.08),
  };
}

// ── RAG retrieval: a premium design brief for the vision model ────────────────
export function describePremiumGuide() {
  const pairs = Object.entries(FONT_PAIRINGS)
    .map(([k, v]) => `  • ${k}: "${v.head}" + "${v.body}" — ${v.note}`)
    .join("\n");
  return `PREMIUM DESIGN DIRECTION (follow this to award-winning standard):
- Treat yourself as an award-winning art director. The result must look like a $20k agency site, not a template.
- Strong visual hierarchy: one dominant hero headline (huge, 64–104px), generous whitespace, clear rhythm.
- Choose ONE font pairing that fits the design's mood, from this curated set (head + body):
${pairs}
- Colour: pick a confident, cohesive palette. Prefer a rich background + one vivid accent. Dark, cinematic palettes read as premium. Use subtle gradients on hero/CTA bands.
- Use tasteful gradient or solid background BANDS to separate sections; never leave large flat empty voids.
- Buttons: solid accent or gradient with soft shadow; secondary buttons outlined. Rounded (10–16px).
- Cards: surface colour + soft layered shadow + rounded corners (16–24px).
- Copy: confident, specific, benefit-driven. Never placeholders.`;
}

// ── Post-processing: snap model output onto premium tokens ────────────────────
// Guarantees quality regardless of how careful the model was.
export function resolvePremiumTokens({ tokens = {}, palette = {}, industry = "general" }) {
  // Pick the font pairing: honour the model's choice if it's one of ours,
  // else pick by detected vibe/industry.
  const wantHead = tokens.head;
  let pairing = Object.values(FONT_PAIRINGS).find((p) => p.head === wantHead);
  if (!pairing) pairing = FONT_PAIRINGS[INDUSTRY_VIBE[industry] || "modern"];

  const pal = buildPalette({
    bg: palette.bg || tokens.bg,
    accent: palette.accent || tokens.accent,
    dark: typeof palette.dark === "boolean" ? palette.dark : tokens.dark,
  });

  return {
    head: pairing.head,
    body: tokens.body && PREMIUM_FONTS.includes(tokens.body) ? tokens.body : pairing.body,
    ...pal,
  };
}

// Apply premium polish to a flat element list (mutates copies, returns new array).
// `T` = resolved premium tokens from resolvePremiumTokens().
export function polishElements(elements, T) {
  return elements.map((el) => {
    const s = { ...(el.styles || {}) };
    const isHeading = el.type === "heading";
    const isText = ["heading", "subheading", "paragraph", "label", "quote"].includes(el.type);

    // Fonts: headings → display font, body text → body font (unless model set one we trust).
    if (isText && !s.fontFamily) s.fontFamily = isHeading || el.type === "subheading" ? T.head : T.body;
    if (el.type === "navbar" || el.type === "footer") s.fontFamily = s.fontFamily || T.body;

    // Text colour: ensure readable against the page.
    if (isText && !s.color) s.color = el.type === "label" ? T.accent : (el.type === "paragraph" ? T.muted : T.text);

    // Headings: premium weight + tight tracking if the model didn't specify.
    if (isHeading) {
      s.fontWeight = s.fontWeight || "800";
      if (s.letterSpacing == null) s.letterSpacing = -1;
      s.lineHeight = s.lineHeight || 1.08;
    }

    // Buttons: premium fill + shadow.
    if (el.type === "button") {
      if (!s.bgColor && s.bgType !== "transparent") {
        s.bgType = "gradient"; s.gradientFrom = T.accent; s.gradientTo = T.accent2; s.gradientDir = "135deg";
        s.color = s.color || "#ffffff";
      }
      s.borderRadius = s.borderRadius ?? RADIUS.sm;
      s.boxShadow = s.boxShadow || SHADOWS.glow(T.accent);
      s.fontWeight = s.fontWeight || "700";
    }

    // Section/background bands: give cards/surfaces premium shadow + radius.
    if (el.type === "section") {
      if (!s.bgColor && s.bgType !== "gradient") s.bgColor = T.band;
    }

    // Image blocks: rounded + soft shadow so they read as designed, not raw.
    if (["image", "logo", "avatar"].includes(el.type)) {
      s.borderRadius = s.borderRadius ?? RADIUS.md;
      s.boxShadow = s.boxShadow || (T.dark ? SHADOWS.cardDark : SHADOWS.card);
      s.objectFit = s.objectFit || "cover";
    }

    return { ...el, styles: s };
  });
}

// Themed stock photo (used instead of cropping the reference — user preference).
const STOCK = {
  saas: "1551434678-e076c223a692", marketing: "1497366216548-37526070297c",
  realestate: "1560518883-ce09059eeffa", restaurant: "1414235077428-338989a2e8c0",
  portfolio: "1517245386807-bb43f82c33c4", ecommerce: "1483985988355-763728e1935b",
  law: "1505664194779-8beaceb93744", hotel: "1566073771259-6a8506099945", general: "1557804506-669a67965ba0",
};
export function stockUrl(industry) {
  return `https://images.unsplash.com/photo-${STOCK[industry] || STOCK.general}?w=1400&q=80&fit=crop`;
}
