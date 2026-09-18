// server/lib/sanitizeSite.js
// ─────────────────────────────────────────────────────────────────────────────
// Server-side sanitation of CustomWebsite payloads (pages → elements → styles,
// settings). Guarantees that valid-looking editor / AI output can never make
// Mongoose throw a CastError (fontSize:"48px", bgType:"linear", height:"320px"…)
// and caps sizes so one save can't balloon a document.
//
// The small coercion helpers are also used as Mongoose setters in
// models/CustomWebsite.js, so every write path (including ones that bypass the
// controller) gets the same protection.
// ─────────────────────────────────────────────────────────────────────────────

export const CANVAS_W = 1200;
export const LIMITS = {
  pages: 40,
  elementsPerPage: 500,
  content: 10_000,
  shortText: 200,
  url: 2048,
  dataUrl: 3 * 1024 * 1024, // uploaded images are stored as data: URLs
  styleString: 400,
  customCSS: 30_000,
};

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * "48px" → 48, "1.5" → 1.5, "2rem" → 32, 12 → 12, "abc" → undefined.
 * `percentAsFraction` turns "50%" into 0.5 (for opacity).
 */
export function toNumber(value, { percentAsFraction = false } = {}) {
  if (value === null || value === undefined || value === "") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return undefined;
  const s = String(value).trim().toLowerCase();
  const m = s.match(/^(-?\d*\.?\d+(?:e-?\d+)?)\s*(px|rem|em|%|deg|pt|vh|vw|s|ms)?\b/);
  if (!m) return undefined;
  let n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return undefined;
  const unit = m[2] || "";
  if (unit === "rem" || unit === "em") n *= 16;
  else if (unit === "pt") n *= 4 / 3;
  else if (unit === "%" && percentAsFraction) n /= 100;
  return Math.round(n * 1000) / 1000;
}

const clampNum = (n, lo, hi) => (n === undefined ? undefined : Math.min(hi, Math.max(lo, n)));

/** Mongoose-setter friendly numeric coercion (keeps undefined as undefined). */
export const numberSetter = (v) => toNumber(v);

/** "linear-gradient" → "gradient", "color" → "solid", junk → undefined. */
export function normalizeBgType(value) {
  if (value === null || value === undefined || value === "") return undefined;
  const s = String(value).trim().toLowerCase();
  if (["solid", "gradient", "transparent", "image"].includes(s)) return s;
  if (/grad|linear|radial|conic/.test(s)) return "gradient";
  if (/^(none|clear|transparent)$/.test(s)) return "transparent";
  if (/image|img|photo|picture|url/.test(s)) return "image";
  if (/solid|color|colour|fill|flat/.test(s)) return "solid";
  return undefined;
}

const str = (v, max = LIMITS.shortText) => {
  if (v === null || v === undefined) return undefined;
  if (typeof v === "string") return v.slice(0, max);
  if (typeof v === "number" || typeof v === "boolean") return String(v).slice(0, max);
  return undefined;
};

const bool = (v, def) => {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1 || v === "1") return true;
  if (v === "false" || v === 0 || v === "0") return false;
  return def;
};

/** URL-ish strings: plain URLs capped at 2KB, data:image URLs at 3MB. */
function urlString(v) {
  if (typeof v !== "string") return v === null ? null : undefined;
  const s = v.trim();
  if (/^data:image\//i.test(s)) return s.length <= LIMITS.dataUrl ? s : "";
  return s.slice(0, LIMITS.url);
}

// ── Styles ────────────────────────────────────────────────────────────────────
const NUMERIC_STYLE = {
  fontSize: [1, 400],
  lineHeight: [0.5, 400],
  letterSpacing: [-50, 100],
  borderRadius: [0, 9999],
  borderTopLeftRadius: [0, 9999],
  borderTopRightRadius: [0, 9999],
  borderBottomRightRadius: [0, 9999],
  borderBottomLeftRadius: [0, 9999],
  borderWidth: [0, 100],
  padding: [0, 400],
  opacity: [0, 1],
  backdropBlur: [0, 200],
  rotate: [-360, 360],
  patternOpacity: [0, 1],
  patternSize: [4, 200],
};

const STRING_STYLE = new Set([
  "fontFamily", "fontWeight", "fontStyle", "color", "textAlign", "textTransform",
  "textShadow", "bgColor", "bgImage", "bgSize", "gradientFrom", "gradientTo",
  "gradientDir", "borderStyle", "borderColor", "boxShadow", "objectFit",
  "objectPosition", "overflow", "filter", "mixBlendMode", "cursor", "hoverEffect",
  "bgPattern", "patternColor", "cardBorder",
]);

function sanitizeBox(obj) {
  if (!isPlainObject(obj)) return undefined;
  const out = {};
  for (const k of ["top", "right", "bottom", "left"]) {
    const n = toNumber(obj[k]);
    if (n !== undefined) out[k] = clampNum(n, -400, 400);
  }
  return Object.keys(out).length ? out : undefined;
}

export function sanitizeStyles(styles) {
  if (!isPlainObject(styles)) return {};
  const out = {};
  for (const [key, raw] of Object.entries(styles)) {
    if (raw === null || raw === undefined || raw === "") continue;
    if (NUMERIC_STYLE[key]) {
      let n;
      if (key === "opacity") n = toNumber(raw, { percentAsFraction: true });
      else if (key === "borderRadius" && /%\s*$/.test(String(raw))) n = 9999; // "50%" → pill/circle
      else n = toNumber(raw);
      if (key === "lineHeight" && n !== undefined && /px\s*$/i.test(String(raw))) {
        // "24px" line-height stored as a unitless multiplier.
        const fs = toNumber(styles.fontSize) || 16;
        n = Math.round((n / fs) * 100) / 100;
      }
      if (n === undefined) continue;
      const [lo, hi] = NUMERIC_STYLE[key];
      out[key] = clampNum(n, lo, hi);
    } else if (key === "bgType") {
      const t = normalizeBgType(raw);
      if (t) out.bgType = t;
    } else if (key === "bgImage") {
      const u = urlString(typeof raw === "string" ? raw : "");
      if (u) out.bgImage = u;
    } else if (key === "paddingObj" || key === "marginObj") {
      const b = sanitizeBox(raw);
      if (b) out[key] = b;
    } else if (STRING_STYLE.has(key)) {
      const s = str(raw, LIMITS.styleString);
      if (s !== undefined && s !== "") out[key] = s;
    }
    // Unknown keys are dropped.
  }
  return out;
}

// ── Elements ──────────────────────────────────────────────────────────────────
let idCounter = 0;
const freshId = (prefix) => `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;

export function sanitizeElement(el) {
  if (!isPlainObject(el)) return null;
  const type = String(el.type || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);
  const out = {
    id: str(el.id, 100) || freshId("el"),
    type: type || "paragraph",
    x: clampNum(toNumber(el.x) ?? 0, -CANVAS_W, CANVAS_W * 2),
    y: clampNum(toNumber(el.y) ?? 0, -2000, 100_000),
    width: clampNum(toNumber(el.width) ?? 200, 1, CANVAS_W * 3),
    zIndex: Math.round(clampNum(toNumber(el.zIndex) ?? 1, -1000, 100_000)),
    visible: bool(el.visible, true),
    locked: bool(el.locked, false),
    content: str(el.content, LIMITS.content) ?? "",
    src: urlString(el.src) || "",
    alt: str(el.alt, 500) ?? "",
    href: typeof el.href === "string" ? el.href.trim().slice(0, LIMITS.url) : "",
    target: el.target === "_blank" ? "_blank" : "_self",
    className: (str(el.className, 200) ?? "").replace(/[^\w\s-]/g, ""),
    htmlId: (str(el.htmlId, 100) ?? "").replace(/[^\w-]/g, ""),
    linkWrap: typeof el.linkWrap === "string" ? el.linkWrap.trim().slice(0, LIMITS.url) : "",
    animation: (str(el.animation, 40) ?? "none") || "none",
    animDelay: clampNum(toNumber(el.animDelay) ?? 0, 0, 30_000),
    animDuration: clampNum(toNumber(el.animDuration) ?? 600, 0, 30_000),
    styles: sanitizeStyles(el.styles),
  };
  const h = el.height;
  if (h === undefined || h === null || h === "" || String(h).trim().toLowerCase() === "auto") {
    out.height = "auto";
  } else {
    const n = toNumber(h);
    out.height = n === undefined ? "auto" : clampNum(n, 1, 50_000);
  }
  return out;
}

// ── Pages ─────────────────────────────────────────────────────────────────────
export function normalizePageSlug(raw) {
  let s = String(raw ?? "/").trim().toLowerCase();
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep raw */
  }
  s = s
    .replace(/[^a-z0-9/_-]+/g, "-")
    .replace(/\/{2,}/g, "/")
    .replace(/-+/g, "-")
    .replace(/(^|\/)-+|-+(\/|$)/g, "$1$2")
    .replace(/\/+$/, "");
  if (!s || s === "/") return "/";
  return s.startsWith("/") ? s.slice(0, 120) : `/${s}`.slice(0, 120);
}

const PAGE_STRINGS = {
  name: 80, pageType: 40, bgType: 40, bgColor: 120, bgSize: 60, bgPos: 60, bgRepeat: 40,
  bgOverlay: 200, bgPattern: 2000, gradFrom: 120, gradTo: 120, gradDir: 40, maxWidth: 40,
  minHeight: 40, overflow: 40, seoTitle: 200, seoDesc: 500, scrollBehavior: 40, pageTransition: 40,
};

export function sanitizePage(page, index = 0) {
  if (!isPlainObject(page)) return null;
  const out = { id: str(page.id, 100) || freshId("page") };
  for (const [k, max] of Object.entries(PAGE_STRINGS)) {
    const v = str(page[k], max);
    if (v !== undefined) out[k] = v;
  }
  if (!out.name) out.name = index === 0 ? "Home" : `Page ${index + 1}`;
  out.slug = normalizePageSlug(page.slug ?? (index === 0 ? "/" : out.name));
  if (page.bgImage === null) out.bgImage = null;
  else if (typeof page.bgImage === "string") out.bgImage = urlString(page.bgImage);
  if (typeof page.ogImage === "string") out.ogImage = page.ogImage.trim().slice(0, LIMITS.url);
  out.bgParallax = bool(page.bgParallax, false);
  out.hiddenFromNav = bool(page.hiddenFromNav, false);
  out.noindex = bool(page.noindex, false);
  const elements = Array.isArray(page.elements) ? page.elements : [];
  out.elements = elements
    .slice(0, LIMITS.elementsPerPage)
    .map(sanitizeElement)
    .filter(Boolean);
  return out;
}

/** Returns a clean pages array, or null when the input isn't an array. */
export function sanitizePages(pages) {
  if (!Array.isArray(pages)) return null;
  const out = pages.slice(0, LIMITS.pages).map(sanitizePage).filter(Boolean);
  // Page slugs must be unique or later pages become unreachable.
  const seen = new Set();
  for (const p of out) {
    let slug = p.slug;
    let n = 2;
    while (seen.has(slug)) slug = `${p.slug === "/" ? "/page" : p.slug}-${n++}`;
    p.slug = slug;
    seen.add(slug);
  }
  return out;
}

// ── Settings & top-level fields ──────────────────────────────────────────────
export function sanitizeSettings(settings) {
  if (!isPlainObject(settings)) return {};
  const out = {};
  if (typeof settings.favicon === "string") out.favicon = urlString(settings.favicon) || "";
  if (settings.globalFont !== undefined) out.globalFont = (str(settings.globalFont, 60) ?? "").replace(/[^\w\s-]/g, "");
  if (settings.globalBg !== undefined) out.globalBg = str(settings.globalBg, 120) ?? "";
  if (settings.globalAccent !== undefined) out.globalAccent = str(settings.globalAccent, 120) ?? "";
  if (settings.customCSS !== undefined) out.customCSS = str(settings.customCSS, LIMITS.customCSS) ?? "";
  if (settings.googleAnalyticsId !== undefined) {
    const id = String(settings.googleAnalyticsId || "").trim();
    out.googleAnalyticsId = /^[A-Z]{1,3}-[A-Z0-9-]{4,30}$/i.test(id) ? id : "";
  }
  if (settings.metaTitle !== undefined) out.metaTitle = str(settings.metaTitle, 200) ?? "";
  if (settings.metaDesc !== undefined) out.metaDesc = str(settings.metaDesc, 500) ?? "";
  if (settings.lang !== undefined) {
    const lang = String(settings.lang || "").trim();
    out.lang = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(lang) ? lang : "en";
  }
  if (settings.noindex !== undefined) out.noindex = bool(settings.noindex, false);
  return out;
}

export function sanitizeTitle(v, fallback = "My Website") {
  const s = str(v, 120);
  return s && s.trim() ? s.trim() : fallback;
}

export function sanitizeIndustry(v) {
  const s = String(v || "general").toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
  return s || "general";
}

export function sanitizeThumbnail(v) {
  return typeof v === "string" ? urlString(v) || "" : "";
}

/** Number of elements a visitor would actually see across all pages. */
export function countVisibleElements(pages) {
  let n = 0;
  for (const p of Array.isArray(pages) ? pages : []) {
    for (const el of Array.isArray(p?.elements) ? p.elements : []) {
      if (el && el.visible !== false) n++;
    }
  }
  return n;
}
