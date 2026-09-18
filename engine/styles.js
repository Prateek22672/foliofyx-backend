// server/engine/styles.js
// Style presets (palette + type pairing + UI treatment) and deterministic
// selection from the niche's mood tags and whatever tone/colour words the user
// asked for.

import { colorUtil } from "../data/designSystem.js";

const { clampHex, lum, shade } = colorUtil;

// All fonts are Google Fonts the canvas renderer loads on demand.
// `ui` is each preset's default button/card/pattern treatment; pickStyle()
// varies it per prompt so two sites on the same preset still look different.
// Gradients are off by default (FolioFYX design direction); users can turn
// them on per site in the Studio's Design tab.
// Keep in sync with client/src/pages/Customize/customize-editor/custom/siteDesign.js.
export const STYLES = [
  { id: "paper-minimal", name: "Paper Minimal", dark: false, tags: ["minimal", "clean", "editorial"], radius: 12, gradient: false,
    palette: { bg: "#ffffff", band: "#f6f6f4", card: "#ffffff", text: "#111111", muted: "#5f6368", accent: "#111111", accent2: "#3a3a3a", onAccent: "#ffffff" },
    fonts: { head: "Manrope", body: "Inter" }, ui: { buttonFill: "solid", buttonShape: "rounded", cardStyle: "border", pattern: "none" } },
  { id: "studio-mono", name: "Studio Mono", dark: true, tags: ["dark", "minimal", "bold", "editorial"], radius: 10, gradient: false,
    palette: { bg: "#0b0b0c", band: "#121214", card: "#17171a", text: "#f5f5f5", muted: "#a1a1aa", accent: "#ffffff", accent2: "#d4d4d8", onAccent: "#0b0b0c" },
    fonts: { head: "Syne", body: "Inter" }, ui: { buttonFill: "solid", buttonShape: "rounded", cardStyle: "border", pattern: "none" } },
  { id: "indigo-product", name: "Indigo Product", dark: false, tags: ["tech", "clean", "corporate"], radius: 14, gradient: false,
    palette: { bg: "#f8f9ff", band: "#ffffff", card: "#ffffff", text: "#0f172a", muted: "#64748b", accent: "#4f46e5", accent2: "#7c3aed", onAccent: "#ffffff" },
    fonts: { head: "Space Grotesk", body: "Inter" }, ui: { buttonFill: "solid", buttonShape: "rounded", cardStyle: "shadow", pattern: "grid" } },
  { id: "midnight-tech", name: "Midnight Tech", dark: true, tags: ["tech", "dark", "bold"], radius: 14, gradient: false,
    palette: { bg: "#0a0e1a", band: "#0f1424", card: "#141b2e", text: "#eef2ff", muted: "#94a3b8", accent: "#22d3ee", accent2: "#6366f1", onAccent: "#04111a" },
    fonts: { head: "Sora", body: "Inter" }, ui: { buttonFill: "solid", buttonShape: "rounded", cardStyle: "border", pattern: "grid" } },
  { id: "noir-gold", name: "Noir & Gold", dark: true, tags: ["luxury", "elegant", "dark"], radius: 6, gradient: false,
    palette: { bg: "#0d0c0a", band: "#15130f", card: "#1b1813", text: "#f6efe2", muted: "#b5a88f", accent: "#c9a45c", accent2: "#a8843f", onAccent: "#120f08" },
    fonts: { head: "Cormorant Garamond", body: "Montserrat" }, ui: { buttonFill: "outline", buttonShape: "sharp", cardStyle: "border", pattern: "none" } },
  { id: "ivory-elegant", name: "Ivory Elegant", dark: false, tags: ["elegant", "luxury", "soft"], radius: 8, gradient: false,
    palette: { bg: "#fbf8f3", band: "#f3ede3", card: "#ffffff", text: "#1f1a14", muted: "#6f6556", accent: "#8a6a3b", accent2: "#6f5330", onAccent: "#ffffff" },
    fonts: { head: "Playfair Display", body: "DM Sans" }, ui: { buttonFill: "solid", buttonShape: "sharp", cardStyle: "tint", pattern: "none" } },
  { id: "terracotta", name: "Terracotta", dark: false, tags: ["warm", "earthy", "retro"], radius: 14, gradient: false,
    palette: { bg: "#fdf7f2", band: "#f7ebe0", card: "#ffffff", text: "#2b1d16", muted: "#7a6255", accent: "#c2562f", accent2: "#9c3f1f", onAccent: "#ffffff" },
    fonts: { head: "Fraunces", body: "Manrope" }, ui: { buttonFill: "solid", buttonShape: "pill", cardStyle: "tint", pattern: "none" } },
  { id: "ember", name: "Ember", dark: true, tags: ["warm", "dark", "luxury"], radius: 12, gradient: false,
    palette: { bg: "#1a0f0a", band: "#221410", card: "#2a1913", text: "#fdf1e4", muted: "#c3a58d", accent: "#f59e0b", accent2: "#d97706", onAccent: "#1a0f0a" },
    fonts: { head: "Playfair Display", body: "DM Sans" }, ui: { buttonFill: "solid", buttonShape: "rounded", cardStyle: "shadow", pattern: "none" } },
  { id: "sage", name: "Sage", dark: false, tags: ["organic", "earthy", "soft"], radius: 16, gradient: false,
    palette: { bg: "#f6f8f3", band: "#eaf0e3", card: "#ffffff", text: "#1d2a1f", muted: "#5f6f60", accent: "#3f7d4e", accent2: "#2e5e3a", onAccent: "#ffffff" },
    fonts: { head: "DM Serif Display", body: "Nunito Sans" }, ui: { buttonFill: "solid", buttonShape: "pill", cardStyle: "tint", pattern: "none" } },
  { id: "ocean", name: "Ocean Clean", dark: false, tags: ["clean", "soft", "corporate"], radius: 16, gradient: false,
    palette: { bg: "#f5fafd", band: "#ffffff", card: "#ffffff", text: "#0c2233", muted: "#557085", accent: "#0284c7", accent2: "#0e7490", onAccent: "#ffffff" },
    fonts: { head: "Plus Jakarta Sans", body: "Plus Jakarta Sans" }, ui: { buttonFill: "solid", buttonShape: "rounded", cardStyle: "shadow", pattern: "dots" } },
  { id: "navy-corporate", name: "Navy Corporate", dark: false, tags: ["corporate", "clean", "elegant"], radius: 10, gradient: false,
    palette: { bg: "#ffffff", band: "#f4f6fa", card: "#ffffff", text: "#0b1b33", muted: "#5b6b82", accent: "#1e3a8a", accent2: "#1d4ed8", onAccent: "#ffffff" },
    fonts: { head: "Sora", body: "Inter" }, ui: { buttonFill: "solid", buttonShape: "rounded", cardStyle: "border", pattern: "none" } },
  { id: "candy-pop", name: "Candy Pop", dark: false, tags: ["playful", "vibrant", "soft"], radius: 22, gradient: false,
    palette: { bg: "#fffaf5", band: "#fff0f6", card: "#ffffff", text: "#2a1740", muted: "#6b5a7b", accent: "#ec4899", accent2: "#8b5cf6", onAccent: "#ffffff" },
    fonts: { head: "Poppins", body: "Nunito" }, ui: { buttonFill: "solid", buttonShape: "pill", cardStyle: "shadow", pattern: "dots" } },
  { id: "citrus-bold", name: "Citrus Bold", dark: false, tags: ["bold", "vibrant", "playful"], radius: 12, gradient: false,
    palette: { bg: "#fffef7", band: "#fff6d6", card: "#ffffff", text: "#161616", muted: "#5c5c5c", accent: "#ea580c", accent2: "#c2410c", onAccent: "#ffffff" },
    fonts: { head: "Archivo Black", body: "Archivo" }, ui: { buttonFill: "solid", buttonShape: "rounded", cardStyle: "border", pattern: "diagonal" } },
  { id: "neon-night", name: "Neon Night", dark: true, tags: ["vibrant", "dark", "bold"], radius: 18, gradient: false,
    palette: { bg: "#0b0716", band: "#120b22", card: "#1a1030", text: "#f4efff", muted: "#a99cc6", accent: "#a855f7", accent2: "#ec4899", onAccent: "#ffffff" },
    fonts: { head: "Unbounded", body: "Inter" }, ui: { buttonFill: "solid", buttonShape: "pill", cardStyle: "border", pattern: "dots" } },
  { id: "blush", name: "Blush", dark: false, tags: ["soft", "elegant", "playful"], radius: 20, gradient: false,
    palette: { bg: "#fff8f8", band: "#fbeeee", card: "#ffffff", text: "#3a2427", muted: "#85686c", accent: "#c65f6b", accent2: "#a84a56", onAccent: "#ffffff" },
    fonts: { head: "Lora", body: "Lato" }, ui: { buttonFill: "solid", buttonShape: "pill", cardStyle: "tint", pattern: "none" } },
  { id: "retro-cream", name: "Retro Cream", dark: false, tags: ["retro", "warm", "editorial"], radius: 6, gradient: false,
    palette: { bg: "#f8f1e3", band: "#efe3cc", card: "#fffaf0", text: "#2d2418", muted: "#75664f", accent: "#b4452a", accent2: "#2f6f6a", onAccent: "#ffffff" },
    fonts: { head: "Bricolage Grotesque", body: "Karla" }, ui: { buttonFill: "solid", buttonShape: "sharp", cardStyle: "border", pattern: "lines" } },
  { id: "editorial-serif", name: "Editorial Serif", dark: false, tags: ["editorial", "minimal", "elegant"], radius: 4, gradient: false,
    palette: { bg: "#ffffff", band: "#f5f3ef", card: "#ffffff", text: "#121212", muted: "#5d5a55", accent: "#b91c1c", accent2: "#7f1d1d", onAccent: "#ffffff" },
    fonts: { head: "Libre Baskerville", body: "Inter" }, ui: { buttonFill: "solid", buttonShape: "sharp", cardStyle: "border", pattern: "none" } },
  { id: "forest-night", name: "Forest Night", dark: true, tags: ["organic", "dark", "tech"], radius: 14, gradient: false,
    palette: { bg: "#0c1511", band: "#111d17", card: "#16241d", text: "#ecf5ef", muted: "#9db3a6", accent: "#4ade80", accent2: "#16a34a", onAccent: "#06120b" },
    fonts: { head: "Outfit", body: "Outfit" }, ui: { buttonFill: "solid", buttonShape: "rounded", cardStyle: "border", pattern: "none" } },
  { id: "slate-pro", name: "Slate Professional", dark: false, tags: ["corporate", "clean", "minimal"], radius: 10, gradient: false,
    palette: { bg: "#f8fafc", band: "#eef2f6", card: "#ffffff", text: "#0f172a", muted: "#475569", accent: "#0f766e", accent2: "#115e59", onAccent: "#ffffff" },
    fonts: { head: "Manrope", body: "Manrope" }, ui: { buttonFill: "solid", buttonShape: "rounded", cardStyle: "shadow", pattern: "none" } },
  { id: "sunset", name: "Sunset", dark: false, tags: ["vibrant", "bold", "warm"], radius: 16, gradient: false,
    palette: { bg: "#fffaf7", band: "#fff1ea", card: "#ffffff", text: "#1f1235", muted: "#6b5d7a", accent: "#e11d48", accent2: "#f97316", onAccent: "#ffffff" },
    fonts: { head: "Outfit", body: "Inter" }, ui: { buttonFill: "solid", buttonShape: "pill", cardStyle: "shadow", pattern: "none" } },
  { id: "graphite", name: "Graphite", dark: true, tags: ["dark", "bold", "tech"], radius: 8, gradient: false,
    palette: { bg: "#121212", band: "#1a1a1a", card: "#202020", text: "#ededed", muted: "#9e9e9e", accent: "#f97316", accent2: "#ea580c", onAccent: "#111111" },
    fonts: { head: "Space Grotesk", body: "Inter" }, ui: { buttonFill: "solid", buttonShape: "rounded", cardStyle: "border", pattern: "lines" } },
  { id: "lilac", name: "Lilac", dark: false, tags: ["soft", "playful", "clean"], radius: 18, gradient: false,
    palette: { bg: "#fbf9ff", band: "#f3effd", card: "#ffffff", text: "#221a33", muted: "#6b6280", accent: "#7c3aed", accent2: "#6d28d9", onAccent: "#ffffff" },
    fonts: { head: "Plus Jakarta Sans", body: "Inter" }, ui: { buttonFill: "solid", buttonShape: "pill", cardStyle: "shadow", pattern: "none" } },
  { id: "mint-fresh", name: "Mint Fresh", dark: false, tags: ["clean", "soft", "organic"], radius: 16, gradient: false,
    palette: { bg: "#f7fdfb", band: "#e9f7f1", card: "#ffffff", text: "#0f2a22", muted: "#4e6b61", accent: "#059669", accent2: "#047857", onAccent: "#ffffff" },
    fonts: { head: "Urbanist", body: "Inter" }, ui: { buttonFill: "solid", buttonShape: "pill", cardStyle: "tint", pattern: "dots" } },
  { id: "brutalist", name: "Brutalist", dark: false, tags: ["bold", "retro", "playful"], radius: 0, gradient: false,
    palette: { bg: "#fffdf5", band: "#fff3b0", card: "#ffffff", text: "#000000", muted: "#333333", accent: "#ff4d00", accent2: "#cc3d00", onAccent: "#000000" },
    fonts: { head: "Space Grotesk", body: "Space Mono" }, ui: { buttonFill: "solid", buttonShape: "sharp", cardStyle: "border", pattern: "checks" } },
  { id: "cobalt", name: "Cobalt", dark: false, tags: ["corporate", "tech", "clean"], radius: 12, gradient: false,
    palette: { bg: "#ffffff", band: "#eef4ff", card: "#ffffff", text: "#0a1a3f", muted: "#4a5a7a", accent: "#2563eb", accent2: "#1d4ed8", onAccent: "#ffffff" },
    fonts: { head: "Figtree", body: "Figtree" }, ui: { buttonFill: "solid", buttonShape: "rounded", cardStyle: "shadow", pattern: "none" } },
  { id: "wine-bar", name: "Wine Bar", dark: true, tags: ["luxury", "elegant", "warm"], radius: 4, gradient: false,
    palette: { bg: "#1a0b10", band: "#230f16", card: "#2c131c", text: "#fbeef2", muted: "#c9a2ae", accent: "#e0a458", accent2: "#c98a3a", onAccent: "#1a0b10" },
    fonts: { head: "Cormorant Garamond", body: "Lato" }, ui: { buttonFill: "outline", buttonShape: "sharp", cardStyle: "tint", pattern: "none" } },
  { id: "sand-dune", name: "Sand Dune", dark: false, tags: ["warm", "earthy", "elegant"], radius: 10, gradient: false,
    palette: { bg: "#faf6ef", band: "#f1e8d8", card: "#fffdf8", text: "#2a2118", muted: "#7a6a55", accent: "#a16207", accent2: "#854d0e", onAccent: "#ffffff" },
    fonts: { head: "Fraunces", body: "Work Sans" }, ui: { buttonFill: "solid", buttonShape: "rounded", cardStyle: "tint", pattern: "none" } },
  { id: "arctic", name: "Arctic", dark: false, tags: ["clean", "minimal", "tech"], radius: 14, gradient: false,
    palette: { bg: "#f8fbff", band: "#eef5fb", card: "#ffffff", text: "#0b2239", muted: "#56708a", accent: "#0891b2", accent2: "#0e7490", onAccent: "#ffffff" },
    fonts: { head: "Lexend", body: "Lexend" }, ui: { buttonFill: "soft", buttonShape: "rounded", cardStyle: "border", pattern: "grid" } },
  { id: "royal-night", name: "Royal Night", dark: true, tags: ["luxury", "dark", "elegant"], radius: 10, gradient: false,
    palette: { bg: "#0d0a24", band: "#141033", card: "#1b1640", text: "#f1efff", muted: "#a7a2cf", accent: "#fbbf24", accent2: "#f59e0b", onAccent: "#1b1300" },
    fonts: { head: "Playfair Display", body: "Inter" }, ui: { buttonFill: "solid", buttonShape: "rounded", cardStyle: "border", pattern: "none" } },
  { id: "peach", name: "Peach", dark: false, tags: ["playful", "soft", "warm"], radius: 22, gradient: false,
    palette: { bg: "#fff8f3", band: "#ffeee3", card: "#ffffff", text: "#3b1f14", muted: "#8a6556", accent: "#e8553f", accent2: "#c9432f", onAccent: "#ffffff" },
    fonts: { head: "Quicksand", body: "Nunito" }, ui: { buttonFill: "solid", buttonShape: "pill", cardStyle: "shadow", pattern: "dots" } },
  { id: "matcha", name: "Matcha", dark: false, tags: ["organic", "earthy", "minimal"], radius: 12, gradient: false,
    palette: { bg: "#f8f9f2", band: "#eef1e1", card: "#ffffff", text: "#1f2616", muted: "#626d52", accent: "#5b7a1f", accent2: "#46601a", onAccent: "#ffffff" },
    fonts: { head: "Lora", body: "Karla" }, ui: { buttonFill: "solid", buttonShape: "rounded", cardStyle: "border", pattern: "none" } },
  { id: "carbon-lime", name: "Carbon Lime", dark: true, tags: ["tech", "dark", "vibrant"], radius: 6, gradient: false,
    palette: { bg: "#0a0a0a", band: "#111111", card: "#161616", text: "#fafafa", muted: "#a3a3a3", accent: "#a3e635", accent2: "#84cc16", onAccent: "#0a0a0a" },
    fonts: { head: "Unbounded", body: "Inter" }, ui: { buttonFill: "solid", buttonShape: "sharp", cardStyle: "border", pattern: "grid" } },
  { id: "rose-quartz", name: "Rose Quartz", dark: false, tags: ["elegant", "soft", "luxury"], radius: 16, gradient: false,
    palette: { bg: "#fffafb", band: "#fdf0f3", card: "#ffffff", text: "#2d1b22", muted: "#7d6069", accent: "#be185d", accent2: "#9d174d", onAccent: "#ffffff" },
    fonts: { head: "DM Serif Display", body: "DM Sans" }, ui: { buttonFill: "solid", buttonShape: "pill", cardStyle: "shadow", pattern: "none" } },
  { id: "newsprint", name: "Newsprint", dark: false, tags: ["editorial", "retro", "minimal"], radius: 0, gradient: false,
    palette: { bg: "#f4f1ea", band: "#ebe6db", card: "#faf8f3", text: "#1a1a1a", muted: "#555048", accent: "#c0392b", accent2: "#962d22", onAccent: "#ffffff" },
    fonts: { head: "EB Garamond", body: "IBM Plex Sans" }, ui: { buttonFill: "solid", buttonShape: "sharp", cardStyle: "border", pattern: "lines" } },
];

const BY_ID = new Map(STYLES.map((s) => [s.id, s]));

export function getStyle(id) {
  return BY_ID.get(id) || null;
}

export const DEFAULT_UI = { buttonFill: "solid", buttonShape: "rounded", cardStyle: "shadow", pattern: "none", patternOpacity: 0.07 };

// Named colours users type → an accent pair that reads well on both modes.
const COLOR_WORDS = {
  red: ["#dc2626", "#b91c1c"], crimson: ["#be123c", "#9f1239"], maroon: ["#9f1239", "#881337"],
  orange: ["#ea580c", "#c2410c"], amber: ["#d97706", "#b45309"], yellow: ["#ca8a04", "#a16207"],
  gold: ["#c9a45c", "#a8843f"], golden: ["#c9a45c", "#a8843f"], green: ["#16a34a", "#15803d"],
  emerald: ["#059669", "#047857"], mint: ["#10b981", "#059669"], olive: ["#65a30d", "#4d7c0f"],
  teal: ["#0d9488", "#0f766e"], cyan: ["#0891b2", "#0e7490"], blue: ["#2563eb", "#1d4ed8"],
  navy: ["#1e3a8a", "#1e40af"], "sky blue": ["#0284c7", "#0369a1"], indigo: ["#4f46e5", "#4338ca"],
  purple: ["#7c3aed", "#6d28d9"], violet: ["#8b5cf6", "#7c3aed"], lavender: ["#a78bfa", "#8b5cf6"],
  pink: ["#db2777", "#be185d"], rose: ["#e11d48", "#be123c"], magenta: ["#c026d3", "#a21caf"],
  brown: ["#92400e", "#78350f"], beige: ["#a8845c", "#8a6a3b"], black: ["#111111", "#333333"],
  grey: ["#4b5563", "#374151"], gray: ["#4b5563", "#374151"], silver: ["#6b7280", "#4b5563"],
};

export function colorFromWords(text = "") {
  const t = ` ${text.toLowerCase()} `;
  const hex = t.match(/#([0-9a-f]{6})\b/);
  if (hex) {
    const a = clampHex(`#${hex[1]}`);
    return { accent: a, accent2: shade(a, -0.18) };
  }
  for (const word of Object.keys(COLOR_WORDS).sort((a, b) => b.length - a.length)) {
    if (new RegExp(`[^a-z]${word}[^a-z]`).test(t)) {
      const [accent, accent2] = COLOR_WORDS[word];
      return { accent, accent2, word };
    }
  }
  return null;
}

function hashString(s = "") {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export { hashString };

// The pattern a preset's mood suggests when a prompt gets one.
function moodPattern(style) {
  const t = new Set(style.tags);
  if (t.has("tech")) return "grid";
  if (t.has("playful") || t.has("vibrant")) return "dots";
  if (t.has("retro") || t.has("editorial")) return "lines";
  if (t.has("luxury")) return "diagonal";
  return "dots";
}

/**
 * The preset's UI treatment with a stable per-prompt twist: about a third of
 * prompts swap the card treatment, a quarter gain a subtle section pattern and
 * a third of patterned presets drop theirs.
 */
export function varyUi(style, seed = 0) {
  const ui = { ...DEFAULT_UI, ...(style.ui || {}) };
  if ((seed >>> 3) % 3 === 0) {
    ui.cardStyle = ui.cardStyle === "shadow" ? "border" : ui.cardStyle === "border" ? (style.dark ? "shadow" : "flat") : "border";
  }
  if (ui.pattern === "none") {
    if ((seed >>> 7) % 4 === 0) ui.pattern = moodPattern(style);
  } else if ((seed >>> 11) % 3 === 0) {
    ui.pattern = "none";
  }
  return ui;
}

/**
 * Pick a style for a niche + intent.
 * Scoring: user-requested moods beat niche moods; an explicit light/dark
 * request is a hard preference. `variant` walks down the ranked list so
 * "try another style" always produces something different.
 */
export function pickStyle({ niche, intent = {}, variant = 0, styleId = null }) {
  const forced = styleId && getStyle(styleId);
  const seed = hashString(`${intent.normalized || ""}|${niche?.id || ""}`);
  let base = forced;

  if (!base) {
    const wantMoods = new Set(intent.moods || []);
    const nicheMoods = new Set(niche?.mood || []);

    const ranked = STYLES.map((s, i) => {
      let score = 0;
      for (const t of s.tags) {
        if (wantMoods.has(t)) score += 3;
        if (nicheMoods.has(t)) score += 2;
      }
      if (intent.mode === "dark") score += s.dark ? 5 : -12;
      if (intent.mode === "light") score += s.dark ? -12 : 5;
      // Dark palettes only when something actually points to them.
      if (!intent.mode && s.dark && !wantMoods.has("dark") && !nicheMoods.has("dark")) score -= 2;
      // Stable per-prompt jitter so two users with the same niche don't get identical sites.
      score += ((seed >> (i % 24)) & 3) * 0.25;
      return { s, score };
    }).sort((a, b) => b.score - a.score);

    const pool = ranked.slice(0, Math.max(3, Math.min(6, ranked.filter((r) => r.score >= ranked[0].score - 3).length)));
    // The prompt picks its starting point in the pool, so similar briefs spread
    // across every good match instead of all landing on the top one.
    base = pool[(Math.abs(variant) + (seed % pool.length)) % pool.length].s;
  }

  return resolveStyle(base, intent, varyUi(base, (seed ^ Math.imul(variant + 1, 2654435761)) >>> 0));
}

// Apply user colour overrides and derive contrast-safe values.
export function resolveStyle(style, intent = {}, ui = null) {
  const p = { ...style.palette };
  const color = intent.color;
  if (color?.accent) {
    let accent = color.accent;
    let accent2 = color.accent2 || shade(accent, -0.18);
    // Keep the accent readable against the page background.
    if (!style.dark && lum(accent) > 200) { accent = shade(accent, -0.35); accent2 = shade(accent2, -0.35); }
    if (style.dark && lum(accent) < 45) { accent = shade(accent, 0.55); accent2 = shade(accent2, 0.45); }
    p.accent = accent;
    p.accent2 = accent2;
    p.onAccent = lum(accent) > 150 ? "#111111" : "#ffffff";
  }
  return {
    id: style.id,
    name: style.name,
    dark: style.dark,
    radius: style.radius,
    gradient: style.gradient,
    ...p,
    head: style.fonts.head,
    body: style.fonts.body,
    ...DEFAULT_UI,
    ...(ui || style.ui || {}),
  };
}

export function listStyles() {
  return STYLES.map(({ id, name, dark, tags, palette, fonts }) => ({
    id, name, dark, tags, accent: palette.accent, bg: palette.bg, head: fonts.head,
  }));
}
