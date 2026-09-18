// server/lib/siteRenderer.js
// ─────────────────────────────────────────────────────────────────────────────
// Server-side renderer: CustomWebsite JSON → a complete, standalone HTML page.
//
// This is what makes "publish" real: /site/:slug and connected custom domains
// serve this output directly, so published sites are crawlable (full SEO tags,
// JSON-LD), fast (zero framework payload) and interactive (small vanilla-JS
// runtime: scroll-reveal, smooth anchors, sticky nav, accordion, add-to-cart
// drawer, and a no-backend contact-form "thanks" flow).
//
// The canvas model is 1200px wide with absolutely positioned elements. Above
// 760px we render that 1:1 and scale the whole stage to the viewport width
// (identical geometry to the editor). At 760px and below we ALSO render a
// second, stacked "mobile" layout built by grouping elements into vertical
// bands — both blocks ship in the HTML and CSS media queries pick one.
//
// client/src/pages/Customize/customize-editor/custom/CanvasElementRenderer.jsx
// is the source of truth for how each element type looks; every renderer
// below mirrors its defaults, colours, the CardShell wrapper and soften().
// ─────────────────────────────────────────────────────────────────────────────

import { cfg } from "./siteConfig.js";

const CANVAS_W = 1200;
const MOBILE_BP = 760;

// ── Escaping ──────────────────────────────────────────────────────────────────
// Full escape for both HTML text nodes and quoted attribute values.
function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
const escAttr = esc;

// Safe embedding of data inside a <script type="application/ld+json"> block:
// JSON.stringify already escapes control chars/quotes; `<` still needs
// neutralising so a value can never contain a literal `</script>`.
function jsonForScript(obj) {
  return JSON.stringify(obj).replace(/</g, "\\u003c");
}

// ── Small numeric / string helpers ───────────────────────────────────────────
const numOr = (v, d) => (typeof v === "number" && Number.isFinite(v) ? v : d);

// Strips CSS constructs that have no business in user-supplied style values
// (legacy IE expression()/behavior()/-moz-binding, javascript: pseudo-urls)
// and caps length. Used for every raw CSS fragment we interpolate — on top of
// this, every finished `style="..."` attribute is still HTML-escaped once,
// which is what actually prevents breaking out of the attribute.
function cssStr(raw, max = 300) {
  return String(raw ?? "")
    .slice(0, max)
    .replace(/expression\s*\(/gi, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/behavior\s*:/gi, "")
    .replace(/-moz-binding/gi, "")
    .replace(/[\r\n]+/g, " ");
}

const px = (v, fallback) => {
  if (v === undefined || v === null || v === "") return fallback;
  return typeof v === "number" ? `${v}px` : cssStr(v, 40);
};

const fontFamilyCSS = (fam) => (fam ? `'${cssStr(fam, 80)}',sans-serif` : "inherit");

/** Join CSS declaration fragments into one HTML-escaped style="" attribute. */
function sty(pairs) {
  const css = pairs.filter(Boolean).join(";");
  return css ? ` style="${escAttr(css)}"` : "";
}

// Muted text colour derived from the element's own colour — identical rule to
// the client's soften(): only kicks in for a validated #rrggbb hex.
function soften(color, alphaHex, fallback) {
  return typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color) ? `${color}${alphaHex}` : fallback;
}

const parts = (content) => String(content ?? "").split("|").map((p) => p.trim());

// ── URL whitelist ─────────────────────────────────────────────────────────────
// http(s), mailto:, tel:, #anchors, relative paths, and (only when allowData)
// data:image/*. Anything else (javascript:, vbscript:, data: non-image, …)
// is rejected outright — callers fall back to "#" or omit the attribute.
function safeUrl(raw, { allowData = false } = {}) {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (v.startsWith("#")) return v.slice(0, 200);
  if (allowData && /^data:image\/(png|jpe?g|gif|webp|svg\+xml|avif|bmp|x-icon);base64,/i.test(v)) {
    return v.length <= 3 * 1024 * 1024 ? v : "";
  }
  const schemeMatch = v.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/);
  if (schemeMatch) {
    const scheme = schemeMatch[1].toLowerCase();
    return scheme === "http" || scheme === "https" || scheme === "mailto" || scheme === "tel"
      ? v.slice(0, 2048)
      : "";
  }
  if (v.startsWith("//")) return ""; // protocol-relative — ambiguous, reject
  if (v.startsWith("/") || /^[.\w]/.test(v)) return v.slice(0, 2048); // relative path
  return "";
}
const hrefSafe = (raw) => safeUrl(raw) || "#";

// ── Background pattern (mirrors client patternLayers() in siteDesign.js) ────
function patternRgba(color, opacity) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(color || ""));
  const a = Math.min(1, Math.max(0, Number(opacity) || 0.08));
  if (!m) return `rgba(17,17,17,${a})`;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function patternLayers(s = {}) {
  const kind = s.bgPattern;
  if (!kind || kind === "none") return "";
  const c = patternRgba(s.patternColor, s.patternOpacity);
  const size = Number(s.patternSize);
  const z = size > 0 ? Math.round(Math.min(200, Math.max(4, size))) : 0;
  switch (kind) {
    case "dots": { const d = z || 22; return `radial-gradient(circle, ${c} 1.4px, transparent 1.8px) 0 0 / ${d}px ${d}px`; }
    case "grid": { const d = z || 32; return `linear-gradient(${c} 1px, transparent 1px) 0 0 / ${d}px ${d}px, linear-gradient(90deg, ${c} 1px, transparent 1px) 0 0 / ${d}px ${d}px`; }
    case "lines": { const d = z || 26; return `linear-gradient(${c} 1px, transparent 1px) 0 0 / 100% ${d}px`; }
    case "diagonal": { const d = z || 16; return `repeating-linear-gradient(45deg, ${c} 0 1px, transparent 1px ${d}px)`; }
    case "crosshatch": { const d = z || 18; return `repeating-linear-gradient(45deg, ${c} 0 1px, transparent 1px ${d}px), repeating-linear-gradient(-45deg, ${c} 0 1px, transparent 1px ${d}px)`; }
    case "checks": { const d = z || 24; return `repeating-conic-gradient(${c} 0 25%, transparent 0 50%) 0 0 / ${d}px ${d}px`; }
    default: return "";
  }
}

// ── Background (mirrors client buildBackground() exactly, priority order) ───
function buildBackground(s = {}) {
  const img = s.bgImage ? safeUrl(s.bgImage) : "";
  if (img) return `url("${img}") center / ${cssStr(s.bgSize || "cover", 20)} no-repeat`;
  if (s.bgType === "gradient" && s.gradientFrom && s.gradientTo) {
    return `linear-gradient(${cssStr(s.gradientDir || "135deg", 20)}, ${cssStr(s.gradientFrom, 60)}, ${cssStr(s.gradientTo, 60)})`;
  }
  const color = s.bgColor && s.bgColor !== "transparent" ? cssStr(s.bgColor, 60) : "transparent";
  const pattern = patternLayers(s);
  return pattern ? `${pattern}, ${color}` : color;
}

// Card surface used by every composite block type.
function cardShellWrap(s = {}, innerHtml) {
  const css = ["width:100%", "height:100%", "box-sizing:border-box", "overflow:hidden", `background:${buildBackground(s)}`];
  if (s.borderRadius !== undefined) css.push(`border-radius:${px(s.borderRadius)}`);
  if (s.boxShadow && s.boxShadow !== "none") css.push(`box-shadow:${cssStr(s.boxShadow, 150)}`);
  if (s.borderWidth) css.push(`border:${numOr(s.borderWidth, 0)}px ${cssStr(s.borderStyle || "solid", 20)} ${cssStr(s.cardBorder || s.borderColor || "transparent", 60)}`);
  return `<div${sty(css)}>${innerHtml}</div>`;
}

// ── settings.customCSS sanitation ────────────────────────────────────────────
// This text lands verbatim inside a <style> element (HTML "raw text" — entity
// decoding does NOT happen there), so the only way out is the literal
// sequence "</style"; stripping every "<" kills that and any embedded tag.
function sanitizeCustomCSS(raw) {
  let css = String(raw ?? "").slice(0, 30_000);
  css = css.replace(/<\/style/gi, "");
  css = css.replace(/</g, "");
  css = css.replace(/expression\s*\(/gi, "");
  css = css.replace(/javascript\s*:/gi, "");
  css = css.replace(/behavior\s*:/gi, "");
  css = css.replace(/-moz-binding/gi, "");
  // @import only for https:// targets — drop every other @import statement.
  css = css.replace(/@import[^;]*;?/gi, (m) => (/^@import\s+(?:url\(\s*)?["']?https:\/\//i.test(m) ? m : ""));
  return css;
}

function safeLang(site) {
  const lang = String(site?.settings?.lang || "").trim();
  return /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i.test(lang) ? lang : "en";
}

function safeGAId(raw) {
  const id = String(raw || "").trim();
  return /^[A-Z]{1,3}-[A-Z0-9-]{4,30}$/i.test(id) ? id : "";
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Per-type inner content (mirrors CanvasElementRenderer.jsx) ──────────────
// Every function here returns HTML meant to fill width:100%;height:100% of
// its positioned wrapper — exactly what each client component renders.
// `mobile` scales font sizes per the stacked-layout rules; everything else
// (colours, paddings, structure) is identical between the two passes.
// ─────────────────────────────────────────────────────────────────────────────

function headingFontSize(basePx, mobile) {
  if (!mobile) return `${basePx}px`;
  return `${Math.min(40, Math.max(26, Math.round(basePx * 0.62)))}px`;
}
function bodyFontSize(basePx, mobile) {
  if (!mobile) return `${basePx}px`;
  return `${Math.max(14, Math.round(basePx * 0.9))}px`;
}

function renderHeading(el, ctx, mobile) {
  const s = el.styles || {};
  const tag = ctx.h1Used ? "h2" : "h1";
  ctx.h1Used = true;
  const base = s.fontSize !== undefined ? numOr(s.fontSize, 48) : 48;
  const css = [
    "margin:0", "width:100%",
    s.padding !== undefined ? `padding:${px(s.padding)}` : "",
    `font-family:${fontFamilyCSS(s.fontFamily)}`,
    `font-size:${headingFontSize(base, mobile)}`,
    `font-weight:${s.fontWeight ? cssStr(s.fontWeight, 20) : "800"}`,
    s.color ? `color:${cssStr(s.color, 60)}` : "",
    s.textAlign ? `text-align:${cssStr(s.textAlign, 20)}` : "",
    `line-height:${s.lineHeight !== undefined ? s.lineHeight : 1.15}`,
    `letter-spacing:${s.letterSpacing !== undefined ? px(s.letterSpacing) : "-1px"}`,
    s.textShadow && s.textShadow !== "none" ? `text-shadow:${cssStr(s.textShadow, 120)}` : "",
  ];
  return `<${tag}${sty(css)}>${esc(el.content || "Heading")}</${tag}>`;
}

function renderSubheading(el, mobile) {
  const s = el.styles || {};
  const base = s.fontSize !== undefined ? numOr(s.fontSize, 24) : 24;
  const css = [
    "margin:0", "width:100%",
    s.padding !== undefined ? `padding:${px(s.padding)}` : "",
    `font-family:${fontFamilyCSS(s.fontFamily)}`,
    `font-size:${bodyFontSize(base, mobile)}`,
    `font-weight:${s.fontWeight ? cssStr(s.fontWeight, 20) : "500"}`,
    s.color ? `color:${cssStr(s.color, 60)}` : "",
    s.textAlign ? `text-align:${cssStr(s.textAlign, 20)}` : "",
    `line-height:${s.lineHeight !== undefined ? s.lineHeight : 1.5}`,
  ];
  return `<h2${sty(css)}>${esc(el.content || "Subheading")}</h2>`;
}

function renderParagraph(el, mobile) {
  const s = el.styles || {};
  const base = s.fontSize !== undefined ? numOr(s.fontSize, 16) : 16;
  const css = [
    "margin:0", "width:100%",
    s.padding !== undefined ? `padding:${px(s.padding)}` : "",
    `font-family:${fontFamilyCSS(s.fontFamily)}`,
    `font-size:${bodyFontSize(base, mobile)}`,
    s.fontWeight ? `font-weight:${cssStr(s.fontWeight, 20)}` : "",
    s.color ? `color:${cssStr(s.color, 60)}` : "",
    s.textAlign ? `text-align:${cssStr(s.textAlign, 20)}` : "",
    `line-height:${s.lineHeight !== undefined ? s.lineHeight : 1.7}`,
  ];
  return `<p${sty(css)}>${esc(el.content || "Your text here.")}</p>`;
}

function renderLabel(el, mobile) {
  const s = el.styles || {};
  const base = s.fontSize !== undefined ? numOr(s.fontSize, 11) : 11;
  const css = [
    `font-size:${bodyFontSize(base, mobile)}`,
    `font-weight:${s.fontWeight ? cssStr(s.fontWeight, 20) : "700"}`,
    `letter-spacing:${s.letterSpacing !== undefined ? px(s.letterSpacing) : "3px"}`,
    `text-transform:${s.textTransform ? cssStr(s.textTransform, 20) : "uppercase"}`,
    s.color ? `color:${cssStr(s.color, 60)}` : "",
    `font-family:${fontFamilyCSS(s.fontFamily)}`,
    "display:inline-block",
  ];
  return `<div style="display:flex;align-items:center;height:100%"><span${sty(css)}>${esc(el.content || "LABEL")}</span></div>`;
}

function renderQuote(el, mobile) {
  const s = el.styles || {};
  const base = s.fontSize !== undefined ? numOr(s.fontSize, 20) : 20;
  const css = [
    `border-left:4px solid ${s.borderColor ? cssStr(s.borderColor, 60) : "#6366f1"}`,
    "padding-left:20px", "margin:0",
    `font-size:${bodyFontSize(base, mobile)}`,
    "font-style:italic",
    `line-height:${s.lineHeight !== undefined ? s.lineHeight : 1.6}`,
    s.color ? `color:${cssStr(s.color, 60)}` : "",
    `font-family:${fontFamilyCSS(s.fontFamily)}`,
  ];
  return `<blockquote${sty(css)}>${esc(el.content || "Your inspiring quote.")}</blockquote>`;
}

function renderList(el, mobile) {
  const s = el.styles || {};
  const base = s.fontSize !== undefined ? numOr(s.fontSize, 16) : 16;
  const css = [
    "padding-left:20px", "margin:0",
    `line-height:${s.lineHeight !== undefined ? s.lineHeight : 1.8}`,
    `font-size:${bodyFontSize(base, mobile)}`,
    s.color ? `color:${cssStr(s.color, 60)}` : "",
    `font-family:${fontFamilyCSS(s.fontFamily)}`,
  ];
  const items = String(el.content || "Item one\nItem two\nItem three").split("\n");
  return `<ul${sty(css)}>${items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
}

function renderIcon(el) {
  const s = el.styles || {};
  const justify = s.textAlign === "center" ? "center" : s.textAlign === "right" ? "flex-end" : "flex-start";
  const css = [
    "display:flex", "align-items:center", `justify-content:${justify}`, "height:100%",
    s.padding !== undefined ? `padding:${px(s.padding)}` : "padding:0",
  ];
  const glyphCss = [`font-size:${s.fontSize !== undefined ? px(s.fontSize) : "32px"}`, `color:${s.color ? cssStr(s.color, 60) : "#6366f1"}`];
  return `<div${sty(css)}><span${sty(glyphCss)}>${esc(el.content || "★")}</span></div>`;
}

function renderButton(el, ctx) {
  const s = el.styles || {};
  const content = el.content || "Button";
  const outlined = s.bgType === "transparent" || !s.bgColor || s.bgColor === "transparent";
  let bg = outlined ? "transparent" : cssStr(s.bgColor, 60);
  if (s.bgType === "gradient" && s.gradientFrom && s.gradientTo) {
    bg = `linear-gradient(${cssStr(s.gradientDir || "135deg", 20)}, ${cssStr(s.gradientFrom, 60)}, ${cssStr(s.gradientTo, 60)})`;
  }
  const color = s.color ? cssStr(s.color, 60) : "#ffffff";
  const pad = typeof s.padding === "number" ? `${s.padding * 0.5}px ${s.padding}px` : "12px 28px";
  const css = [
    "display:inline-flex", "align-items:center", "justify-content:center",
    "width:100%", "height:100%", `padding:${pad}`, `background:${bg}`, `color:${color}`,
    `font-family:${fontFamilyCSS(s.fontFamily)}`, `font-size:${s.fontSize !== undefined ? px(s.fontSize) : "15px"}`,
    `font-weight:${s.fontWeight ? cssStr(s.fontWeight, 20) : "700"}`,
    `border-radius:${s.borderRadius !== undefined ? px(s.borderRadius) : "8px"}`,
    outlined ? `border:${numOr(s.borderWidth, 2)}px solid ${s.borderColor ? cssStr(s.borderColor, 60) : (s.color ? cssStr(s.color, 60) : "#ffffff")}` : "border:none",
    s.boxShadow && s.boxShadow !== "none" ? `box-shadow:${cssStr(s.boxShadow, 150)}` : "",
    s.letterSpacing !== undefined ? `letter-spacing:${px(s.letterSpacing)}` : "",
    s.textTransform ? `text-transform:${cssStr(s.textTransform, 20)}` : "",
    "white-space:nowrap", "overflow:hidden", "text-overflow:ellipsis", "cursor:pointer", "box-sizing:border-box",
  ];
  const isCart = /add to cart|buy now/i.test(content);
  if (isCart) {
    ctx.hasCart = true;
    return `<button type="button" class="fyx-btn" data-cart-add data-name="${escAttr(ctx.lastProductName || "Item")}" data-price="${escAttr(ctx.lastProductPrice || "0")}"${sty(css)}>${esc(content)}</button>`;
  }
  if (el.href) {
    const target = el.target === "_blank" ? ' target="_blank" rel="noopener"' : "";
    return `<a href="${escAttr(hrefSafe(el.href))}"${target}${sty(css)}>${esc(content)}</a>`;
  }
  return `<button type="button" class="fyx-btn"${sty(css)}>${esc(content)}</button>`;
}

function renderInput(el) {
  const s = el.styles || {};
  const css = [
    "width:100%", `padding:10px 14px`,
    `border:${numOr(s.borderWidth, 1)}px solid ${s.borderColor ? cssStr(s.borderColor, 60) : "#e2e8f0"}`,
    `border-radius:${s.borderRadius !== undefined ? px(s.borderRadius) : "8px"}`,
    `font-size:${s.fontSize !== undefined ? px(s.fontSize) : "15px"}`,
    `color:${s.color ? cssStr(s.color, 60) : "#374151"}`,
    `background:${s.bgColor ? cssStr(s.bgColor, 60) : "#fff"}`,
    "outline:none", "box-sizing:border-box",
  ];
  return `<div style="display:flex;align-items:center;width:100%;height:100%"><input type="text" name="field" placeholder="${escAttr(el.content || "Type here...")}"${sty(css)}></div>`;
}

function renderForm(el, ctx) {
  const s = el.styles || {};
  ctx.hasForm = true;
  const pad = numOr(s.padding, 24);
  const btnBg = s.borderColor ? cssStr(s.borderColor, 80) : "#111111";
  const btnColor = s.color ? cssStr(s.color, 60) : "#fff";
  const fieldCss = ["width:100%", "padding:10px 14px", "border:1px solid #e2e8f0", "border-radius:8px", "font-size:14px", "background:#fafafa", "box-sizing:border-box", "font-family:inherit"];
  const btnCss = ["padding:11px 24px", `background:${btnBg}`, `color:${btnColor}`, "border:none", "border-radius:8px", "font-size:14px", "font-weight:700", "cursor:pointer"];
  return `<form class="fyx-form" data-fyx-form${sty(["padding:" + pad + "px", "display:flex", "flex-direction:column", "gap:12px", "height:100%", "box-sizing:border-box"])}>
<input${sty(fieldCss)} type="text" name="name" placeholder="Name" autocomplete="name" required>
<input${sty(fieldCss)} type="email" name="email" placeholder="Email" autocomplete="email" required>
<textarea${sty(fieldCss)} name="message" placeholder="Message" rows="3" required></textarea>
<button type="submit" class="fyx-form-submit"${sty(btnCss)}>Send Message</button>
<p class="fyx-form-thanks" hidden style="margin:0;font-size:14px;font-weight:600;color:#16a34a">Thanks — your message has been sent.</p>
</form>`;
}

function embedForVideoUrl(url) {
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]+)/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}?rel=0`;
  const vm = url.match(/vimeo\.com\/(\d+)/);
  if (vm) return `https://player.vimeo.com/video/${vm[1]}`;
  return "";
}

function renderVideo(el) {
  const s = el.styles || {};
  const src = safeUrl(el.src || "");
  const radius = s.borderRadius !== undefined ? px(s.borderRadius) : "8px";
  const shellCss = ["width:100%", "height:100%", "background:#0f172a", `border-radius:${radius}`, "overflow:hidden"];
  if (!src) {
    return `<div${sty(shellCss)}><div style="display:flex;align-items:center;justify-content:center;height:100%;flex-direction:column;gap:8px;color:#94a3b8"><span style="font-size:36px;opacity:.3">▶</span><span style="font-size:11px">No video source</span></div></div>`;
  }
  const embed = embedForVideoUrl(src);
  if (embed) {
    return `<div${sty(shellCss)}><iframe src="${escAttr(embed)}" width="100%" height="100%" style="border:none;display:block" allow="autoplay; fullscreen" title="video" loading="lazy"></iframe></div>`;
  }
  return `<div${sty(shellCss)}><video src="${escAttr(src)}" controls playsinline style="width:100%;height:100%;display:block;object-fit:cover"></video></div>`;
}

function renderImage(el, isAvatar) {
  const s = el.styles || {};
  const src = safeUrl(el.src || "", { allowData: true });
  if (!src) {
    const css = [
      "width:100%", "height:100%", "background:#eef1f5",
      "display:flex", "flex-direction:column", "align-items:center", "justify-content:center", "gap:8px",
      isAvatar ? "border-radius:50%" : s.borderRadius !== undefined ? `border-radius:${px(s.borderRadius)}` : "",
    ];
    return `<div${sty(css)}><span style="font-size:28px;opacity:.4">🖼</span></div>`;
  }
  const css = [
    "width:100%", "height:100%",
    `object-fit:${s.objectFit ? cssStr(s.objectFit, 20) : "cover"}`,
    `object-position:${s.objectPosition ? cssStr(s.objectPosition, 40) : "center"}`,
    isAvatar ? "border-radius:50%" : s.borderRadius !== undefined ? `border-radius:${px(s.borderRadius)}` : "",
    "display:block",
    s.filter && s.filter !== "none" ? `filter:${cssStr(s.filter, 120)}` : "",
    s.opacity !== undefined ? `opacity:${s.opacity}` : "",
  ];
  return `<img src="${escAttr(src)}" alt="${escAttr(el.alt || "")}" loading="lazy"${sty(css)}>`;
}

function renderGallery(el) {
  const s = el.styles || {};
  const css = ["display:grid", "grid-template-columns:repeat(3,1fr)", "gap:8px", `padding:${s.padding !== undefined ? px(s.padding) : "8px"}`, "height:100%", "box-sizing:border-box"];
  const tiles = Array.from({ length: 6 })
    .map(() => `<div style="background:#eef1f5;border-radius:8px;aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:20px;color:#94a3b8">🖼</div>`)
    .join("");
  return `<div${sty(css)}>${tiles}</div>`;
}

function renderMap() {
  return `<div style="width:100%;height:100%;border-radius:8px;overflow:hidden"><iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d387193.30593530316!2d-74.25986548248684!3d40.69714941932609!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x89c24fa5d33f083b%3A0xc80b8f06e177fe62!2sNew%20York%2C%20NY%2C%20USA!5e0!3m2!1sen!2sus!4v1719000000000!5m2!1sen!2sus" width="100%" height="100%" style="border:none;display:block" loading="lazy" title="map"></iframe></div>`;
}

function renderCountdown(el) {
  const s = el.styles || {};
  const cells = [["00", "Days"], ["00", "Hours"], ["00", "Mins"], ["00", "Secs"]];
  const numCss = [`font-size:${s.fontSize !== undefined ? px(s.fontSize) : "40px"}`, "font-weight:800", `color:${s.color ? cssStr(s.color, 60) : "#0f172a"}`, `font-family:${fontFamilyCSS(s.fontFamily)}`, "line-height:1"];
  return `<div style="display:flex;align-items:center;justify-content:center;gap:16px;height:100%;padding:${s.padding !== undefined ? px(s.padding) : "16px"}">${cells
    .map(([v, l]) => `<div style="text-align:center"><div${sty(numCss)}>${v}</div><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin-top:4px">${esc(l)}</div></div>`)
    .join("")}</div>`;
}

function renderTabs(el) {
  const s = el.styles || {};
  const tabs = parts(el.content || "Tab 1|Tab 2|Tab 3");
  const border = s.borderColor ? cssStr(s.borderColor, 60) : "#e2e8f0";
  const active = s.color ? cssStr(s.color, 60) : "#6366f1";
  const tabsHtml = tabs
    .map((t, i) => `<div style="padding:10px 20px;font-size:14px;font-weight:${i === 0 ? 700 : 500};color:${i === 0 ? active : "#94a3b8"};border-bottom:${i === 0 ? `2px solid ${active}` : "none"};margin-bottom:-2px">${esc(t)}</div>`)
    .join("");
  return `<div style="padding:${s.padding !== undefined ? px(s.padding) : "16px"};height:100%;box-sizing:border-box"><div style="display:flex;border-bottom:2px solid ${border};margin-bottom:16px">${tabsHtml}</div><p style="font-size:14px;color:#64748b;line-height:1.6;margin:0">Tab content goes here.</p></div>`;
}

function renderBreadcrumb(el) {
  const s = el.styles || {};
  const crumbs = parts(el.content || "Home|Page");
  const html = crumbs
    .map((c, i) => {
      const last = i === crumbs.length - 1;
      const css = [`font-size:${s.fontSize !== undefined ? px(s.fontSize) : "13px"}`, `color:${last ? (s.color ? cssStr(s.color, 60) : "#0f172a") : "#94a3b8"}`, `font-weight:${last ? 600 : 400}`, `font-family:${fontFamilyCSS(s.fontFamily)}`];
      return `<span${sty(css)}>${esc(c)}</span>${!last ? '<span style="color:#94a3b8;font-size:12px">›</span>' : ""}`;
    })
    .join("");
  return `<div style="display:flex;align-items:center;gap:8px;padding:${s.padding !== undefined ? px(s.padding) : "12px"};height:100%;box-sizing:border-box">${html}</div>`;
}

function renderSocial(el) {
  const s = el.styles || {};
  const icons = ["𝕏", "in", "f", "▶"];
  const bg = s.bgColor ? cssStr(s.bgColor, 60) : "#f1f5f9";
  const border = s.borderColor ? cssStr(s.borderColor, 60) : "#e2e8f0";
  const color = s.color ? cssStr(s.color, 60) : "#374151";
  const items = icons
    .map((ic) => `<div style="width:36px;height:36px;border-radius:50%;background:${escAttr(bg)};display:flex;align-items:center;justify-content:center;font-size:14px;border:1px solid ${escAttr(border)};color:${escAttr(color)}">${esc(ic)}</div>`)
    .join("");
  return `<div style="display:flex;align-items:center;gap:12px;padding:${s.padding !== undefined ? px(s.padding) : "12px"};height:100%;box-sizing:border-box">${items}</div>`;
}

function renderLogostrip(el) {
  const s = el.styles || {};
  const brands = parts(el.content || "Brand A|Brand B|Brand C|Brand D|Brand E");
  const color = s.color ? cssStr(s.color, 60) : "#94a3b8";
  const items = brands.map((b) => `<div style="font-size:14px;font-weight:700;color:${escAttr(color)};letter-spacing:1px;text-transform:uppercase;font-family:${escAttr(fontFamilyCSS(s.fontFamily))}">${esc(b)}</div>`).join("");
  return `<div style="display:flex;align-items:center;justify-content:space-around;padding:0 ${s.padding !== undefined ? px(s.padding) : "40px"};height:100%;flex-wrap:wrap;gap:20px">${items}</div>`;
}

function renderDivider(el) {
  const s = el.styles || {};
  const color = s.bgColor ? cssStr(s.bgColor, 60) : s.borderColor ? cssStr(s.borderColor, 60) : "#e2e8f0";
  return `<div style="width:100%;height:100%;display:flex;align-items:center"><div style="width:100%;height:${numOr(s.borderWidth, 1)}px;background:${escAttr(color)}"></div></div>`;
}

// ── Card-shell composite types ───────────────────────────────────────────────
function renderStats(el) {
  const s = el.styles || {};
  const [num, label] = parts(el.content || "0|Label");
  const align = s.textAlign === "center" ? "center" : "flex-start";
  const numCss = [`font-size:${s.fontSize !== undefined ? px(s.fontSize) : "56px"}`, "font-weight:800", `color:${s.color ? cssStr(s.color, 60) : "#6366f1"}`, `font-family:${fontFamilyCSS(s.fontFamily)}`, "line-height:1", `letter-spacing:${s.letterSpacing !== undefined ? px(s.letterSpacing) : "-1px"}`];
  const lblCss = ["font-size:14px", "font-weight:500", `color:${soften(s.color, "99", "#94a3b8")}`, `font-family:${fontFamilyCSS(s.fontFamily)}`, "letter-spacing:.5px", s.textTransform ? `text-transform:${cssStr(s.textTransform, 20)}` : ""];
  return `<div style="display:flex;flex-direction:column;align-items:${align};justify-content:center;height:100%;gap:6px;padding:${s.padding !== undefined ? px(s.padding) : "16px"}"><div${sty(numCss)}>${esc(num || "0")}</div>${label ? `<div${sty(lblCss)}>${esc(label)}</div>` : ""}</div>`;
}

function renderTestimonial(el) {
  const s = el.styles || {};
  const [quote, name, role] = parts(el.content || "Great product!|Name|Role");
  const pad = numOr(s.padding, 28);
  const markColor = s.borderColor ? cssStr(s.borderColor, 60) : "#6366f1";
  const qCss = [`font-size:${s.fontSize !== undefined ? px(s.fontSize) : "16px"}`, `color:${s.color ? cssStr(s.color, 60) : "#374151"}`, `font-family:${fontFamilyCSS(s.fontFamily)}`, `line-height:${s.lineHeight !== undefined ? s.lineHeight : 1.7}`, "font-style:italic", "margin:0"];
  return `<div style="padding:${pad}px;display:flex;flex-direction:column;gap:12px;height:100%;box-sizing:border-box"><div style="font-size:60px;line-height:1;color:${escAttr(markColor)};opacity:.15;font-family:Georgia,serif;margin-bottom:-16px">&ldquo;</div><p${sty(qCss)}>${esc(quote || "")}</p><div style="margin-top:auto"><div style="color:#f59e0b;font-size:13px;margin-bottom:6px">★★★★★</div>${name ? `<div style="font-size:14px;font-weight:700;color:${escAttr(s.color ? cssStr(s.color, 60) : "#0f172a")}">${esc(name)}</div>` : ""}${role ? `<div style="font-size:12px;color:${escAttr(soften(s.color, "99", "#94a3b8"))};margin-top:2px">${esc(role)}</div>` : ""}</div></div>`;
}

function renderPricing(el) {
  const s = el.styles || {};
  const [plan, price, period, desc, ...features] = parts(el.content || "Pro|$79|/mo");
  const pad = numOr(s.padding, 32);
  const priceCss = [`font-size:${s.fontSize !== undefined ? px(s.fontSize) : "48px"}`, "font-weight:800", `color:${s.color ? cssStr(s.color, 60) : "#0f172a"}`, `font-family:${fontFamilyCSS(s.fontFamily)}`, "line-height:1"];
  const feats = features.length
    ? `<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px;flex:1">${features.map((f) => `<li style="display:flex;align-items:center;gap:8px;font-size:14px;color:${escAttr(s.color ? cssStr(s.color, 60) : "#374151")}"><span style="color:#22c55e;font-weight:700;flex-shrink:0">✓</span> ${esc(f)}</li>`).join("")}</ul>`
    : "";
  return `<div style="padding:${pad}px;display:flex;flex-direction:column;gap:16px;height:100%;box-sizing:border-box"><div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:2px;color:${escAttr(soften(s.color, "aa", "#6366f1"))}">${esc(plan || "Plan")}</div><div style="display:flex;align-items:baseline;gap:2px"><span${sty(priceCss)}>${esc(price || "$0")}</span><span style="font-size:14px;color:${escAttr(soften(s.color, "99", "#94a3b8"))}">${esc(period || "/mo")}</span></div>${desc ? `<p style="margin:0;font-size:14px;color:${escAttr(soften(s.color, "b3", "#64748b"))};line-height:1.5">${esc(desc)}</p>` : ""}${feats}</div>`;
}

function renderTeam(el) {
  const s = el.styles || {};
  const [name, title, bio] = parts(el.content || "Name|Title|Bio");
  const pad = numOr(s.padding, 24);
  const src = safeUrl(el.src || "", { allowData: true });
  const avatar = src
    ? `<img src="${escAttr(src)}" alt="${escAttr(name || "")}" loading="lazy" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid ${escAttr(s.borderColor ? cssStr(s.borderColor, 60) : "#e0e7ff")};box-shadow:0 4px 12px rgba(0,0,0,.1)">`
    : `<div style="width:80px;height:80px;border-radius:50%;background:#111111;display:flex;align-items:center;justify-content:center;font-size:28px;color:#fff;flex-shrink:0">${esc((name || "?").charAt(0))}</div>`;
  const nameCss = [`font-size:${s.fontSize !== undefined ? px(s.fontSize) : "17px"}`, "font-weight:700", `color:${s.color ? cssStr(s.color, 60) : "#0f172a"}`, `font-family:${fontFamilyCSS(s.fontFamily)}`];
  return `<div style="padding:${pad}px;display:flex;flex-direction:column;align-items:center;gap:12px;text-align:center;height:100%;box-sizing:border-box">${avatar}<div><div${sty(nameCss)}>${esc(name || "Team Member")}</div><div style="font-size:13px;color:${escAttr(s.borderColor ? cssStr(s.borderColor, 60) : "#6366f1")};font-weight:600;margin-top:2px">${esc(title || "Role")}</div>${bio ? `<p style="margin:8px 0 0;font-size:13px;color:${escAttr(soften(s.color, "b3", "#6b7280"))};line-height:1.5">${esc(bio)}</p>` : ""}</div></div>`;
}

function renderFeature(el) {
  const s = el.styles || {};
  const [ttl, desc, icon] = parts(el.content || "Feature|Description|✦");
  const pad = numOr(s.padding, 24);
  const accent = s.borderColor ? cssStr(s.borderColor, 60) : "#6366f1";
  const titleCss = [`font-size:${s.fontSize !== undefined ? px(s.fontSize) : "18px"}`, "font-weight:700", `color:${s.color ? cssStr(s.color, 60) : "#0f172a"}`, `font-family:${fontFamilyCSS(s.fontFamily)}`];
  return `<div style="padding:${pad}px;display:flex;flex-direction:column;gap:12px;height:100%;box-sizing:border-box"><div style="width:48px;height:48px;border-radius:12px;background:${escAttr(s.borderColor ? `${cssStr(s.borderColor, 60)}18` : "#f0f0ff")};display:flex;align-items:center;justify-content:center;font-size:22px;color:${escAttr(accent)};flex-shrink:0">${esc(icon || "✦")}</div><div${sty(titleCss)}>${esc(ttl || "Feature")}</div>${desc ? `<p style="margin:0;font-size:14px;color:${escAttr(soften(s.color, "b3", "#64748b"))};line-height:1.6">${esc(desc)}</p>` : ""}</div>`;
}

function renderService(el) {
  const s = el.styles || {};
  const [ttl, desc, icon] = parts(el.content || "Service|Description|⚙");
  const pad = numOr(s.padding, 24);
  const accent = s.borderColor ? cssStr(s.borderColor, 60) : "#6366f1";
  const titleCss = [`font-size:${s.fontSize !== undefined ? px(s.fontSize) : "16px"}`, "font-weight:700", `color:${s.color ? cssStr(s.color, 60) : "#0f172a"}`, `font-family:${fontFamilyCSS(s.fontFamily)}`];
  return `<div style="padding:${pad}px;display:flex;gap:16px;align-items:flex-start;height:100%;box-sizing:border-box"><div style="width:44px;height:44px;border-radius:10px;background:${escAttr(s.borderColor ? `${cssStr(s.borderColor, 60)}15` : "#f0f0ff")};display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0;color:${escAttr(accent)}">${esc(icon || "⚙")}</div><div><div${sty(titleCss)}>${esc(ttl || "Service")}</div>${desc ? `<p style="margin:6px 0 0;font-size:13px;color:${escAttr(soften(s.color, "b3", "#64748b"))};line-height:1.5">${esc(desc)}</p>` : ""}</div></div>`;
}

function renderPropertyCard(el, ctx) {
  const s = el.styles || {};
  const [name, price, details] = parts(el.content || "Property|$500,000|3 Bed • 2 Bath");
  ctx.lastProductName = name || "Property";
  ctx.lastProductPrice = String(price || "").replace(/[^0-9.]/g, "");
  const src = safeUrl(el.src || "", { allowData: true });
  const img = src
    ? `<img src="${escAttr(src)}" alt="${escAttr(name || "Property")}" loading="lazy" style="width:100%;height:180px;object-fit:cover;display:block;flex-shrink:0">`
    : `<div style="width:100%;height:180px;background:#eef1f5;display:flex;align-items:center;justify-content:center;flex-shrink:0"><span style="font-size:32px;opacity:.3">🏠</span></div>`;
  const priceColor = s.borderColor ? cssStr(s.borderColor, 60) : "#059669";
  const nameCss = [`font-size:${s.fontSize !== undefined ? px(s.fontSize) : "17px"}`, "font-weight:700", `color:${s.color ? cssStr(s.color, 60) : "#0f172a"}`, `font-family:${fontFamilyCSS(s.fontFamily)}`];
  return `<div style="width:100%;height:100%;overflow:hidden;display:flex;flex-direction:column">${img}<div style="padding:16px 20px;flex:1"><div${sty(nameCss)}>${esc(name || "Property")}</div><div style="font-size:22px;font-weight:800;color:${escAttr(priceColor)};margin:6px 0">${esc(price || "$0")}</div>${details ? `<div style="font-size:13px;color:${escAttr(soften(s.color, "99", "#64748b"))}">${esc(details)}</div>` : ""}</div></div>`;
}

function renderFAQ(el) {
  const s = el.styles || {};
  const [q, a] = parts(el.content || "Question?|Answer.");
  const pad = numOr(s.padding, 20);
  const accent = s.borderColor ? cssStr(s.borderColor, 60) : "#6366f1";
  const qCss = [`font-size:${s.fontSize !== undefined ? px(s.fontSize) : "17px"}`, "font-weight:700", `color:${s.color ? cssStr(s.color, 60) : "#0f172a"}`, `font-family:${fontFamilyCSS(s.fontFamily)}`, "line-height:1.4"];
  return `<div style="padding:${pad}px;border-bottom:1px solid ${escAttr(soften(s.color, "1f", "#f1f5f9"))};height:100%;box-sizing:border-box"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px"><div${sty(qCss)}>${esc(q || "Question?")}</div><span style="font-size:20px;color:${escAttr(accent)};font-weight:300;flex-shrink:0">+</span></div><p style="margin:10px 0 0;font-size:14px;color:${escAttr(soften(s.color, "b3", "#64748b"))};line-height:1.6">${esc(a || "Answer.")}</p></div>`;
}

function renderTimeline(el) {
  const s = el.styles || {};
  const [ttl, desc, year] = parts(el.content || "Milestone|Description|2024");
  const pad = numOr(s.padding, 16);
  const accent = s.borderColor ? cssStr(s.borderColor, 60) : "#6366f1";
  const titleCss = [`font-size:${s.fontSize !== undefined ? px(s.fontSize) : "16px"}`, "font-weight:700", `color:${s.color ? cssStr(s.color, 60) : "#0f172a"}`, `font-family:${fontFamilyCSS(s.fontFamily)}`];
  return `<div style="padding:${pad}px;display:flex;gap:16px;height:100%;box-sizing:border-box"><div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0"><div style="width:12px;height:12px;border-radius:50%;background:${escAttr(accent)};flex-shrink:0"></div><div style="width:2px;flex:1;background:${escAttr(accent)}30"></div></div><div style="padding-bottom:16px">${year ? `<div style="font-size:11px;font-weight:700;color:${escAttr(accent)};margin-bottom:4px;letter-spacing:1px;text-transform:uppercase">${esc(year)}</div>` : ""}<div${sty(titleCss)}>${esc(ttl || "Milestone")}</div>${desc ? `<p style="margin:4px 0 0;font-size:13px;color:${escAttr(soften(s.color, "b3", "#64748b"))};line-height:1.5">${esc(desc)}</p>` : ""}</div></div>`;
}

function renderCTA(el) {
  const s = el.styles || {};
  const pad = numOr(s.padding, 48);
  const css = [`font-size:${s.fontSize !== undefined ? px(s.fontSize) : "22px"}`, `color:${s.color ? cssStr(s.color, 60) : "#f1f5f9"}`, `font-family:${fontFamilyCSS(s.fontFamily)}`, `line-height:${s.lineHeight !== undefined ? s.lineHeight : 1.5}`, `font-weight:${s.fontWeight ? cssStr(s.fontWeight, 20) : "600"}`, "margin:0"];
  return `<div style="padding:${pad}px 40px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;text-align:center;height:100%;box-sizing:border-box"><p${sty(css)}>${esc(el.content || "Ready to get started?")}</p></div>`;
}

// ── Section / container / hero / bg block ────────────────────────────────────
function renderSection(el) {
  const s = el.styles || {};
  const css = [
    "width:100%", "height:100%", `background:${buildBackground(s)}`,
    s.borderRadius !== undefined ? `border-radius:${px(s.borderRadius)}` : "",
    s.boxShadow && s.boxShadow !== "none" ? `box-shadow:${cssStr(s.boxShadow, 150)}` : "",
    s.padding ? `padding:${px(s.padding)}` : "",
    s.opacity !== undefined ? `opacity:${s.opacity}` : "",
    "box-sizing:border-box",
    s.backdropBlur ? `backdrop-filter:blur(${numOr(s.backdropBlur, 0)}px)` : "",
  ];
  const text = el.content
    ? `<p style="margin:0;font-size:${s.fontSize !== undefined ? px(s.fontSize) : "15px"};color:${escAttr(s.color ? cssStr(s.color, 60) : "#374151")};font-family:${escAttr(fontFamilyCSS(s.fontFamily))};line-height:${s.lineHeight !== undefined ? s.lineHeight : 1.6}">${esc(el.content)}</p>`
    : "";
  return `<div${sty(css)}>${text}</div>`;
}

// ── Navbar / footer ───────────────────────────────────────────────────────────
function visiblePages(site) {
  return (Array.isArray(site?.pages) ? site.pages : []).filter((p) => !p?.hiddenFromNav);
}
function pageHref(baseUrl, slug) {
  const path = slug === "/" ? "" : slug || "";
  return `${baseUrl || ""}${path}` || "/";
}

function renderNavbar(el, site, ctx, baseUrl, mobile = false) {
  const s = el.styles || {};
  const brand = el.content || "Brand";
  const links = visiblePages(site)
    .slice(0, 8)
    .map((p) => `<a href="${escAttr(pageHref(baseUrl, p.slug))}">${esc(p.name || "Page")}</a>`)
    .join("");
  const brandCss = [`font-size:${s.fontSize !== undefined ? px(s.fontSize) : "18px"}`, "font-weight:800", `color:${s.color ? cssStr(s.color, 60) : "#0f172a"}`, `font-family:${fontFamilyCSS(s.fontFamily)}`, "flex-shrink:0"];
  ctx.hasNavbar = true;
  if (mobile) {
    // Fixed side padding + a non-wrapping link row would overflow a 360px
    // viewport, so mobile gets its own layout: brand, then a horizontally
    // scrollable link strip (never a page-width overflow).
    const wrapCss = ["display:flex", "flex-direction:column", "gap:10px", "width:100%", "padding:14px 4px", `background:${buildBackground(s)}`, "box-sizing:border-box"];
    const linkRowCss = ["display:flex", "gap:18px", "overflow-x:auto", "-webkit-overflow-scrolling:touch", "white-space:nowrap", "padding-bottom:4px", "font-size:14px", "max-width:100%"];
    return `<div${sty(wrapCss)}><span${sty(brandCss)}>${esc(brand)}</span><div${sty(linkRowCss)}>${links}<span class="fyx-cart-btn" data-cart-open hidden>🛒 <b data-cart-count>0</b></span></div></div>`;
  }
  const css = ["display:flex", "align-items:center", `padding:0 ${s.padding !== undefined ? px(s.padding) : "40px"}`, "height:100%", "gap:32px", `background:${buildBackground(s)}`];
  return `<nav${sty(css)}><span${sty(brandCss)}>${esc(brand)}</span><span style="display:flex;gap:24px;margin-left:auto;font-size:14px">${links}</span><span class="fyx-cart-btn" data-cart-open hidden>🛒 <b data-cart-count>0</b></span></nav>`;
}

function renderFooter(el) {
  const s = el.styles || {};
  const color = s.color ? cssStr(s.color, 60) : "#94a3b8";
  const legal = ["Privacy", "Terms", "Contact"].map((item) => `<span style="font-size:13px;color:${escAttr(color)}">${esc(item)}</span>`).join("");
  const brandCss = ["font-size:14px", "font-weight:700", `color:${escAttr(color)}`, `font-family:${fontFamilyCSS(s.fontFamily)}`];
  return `<div style="display:flex;align-items:center;justify-content:space-between;padding:0 ${s.padding !== undefined ? px(s.padding) : "40px"};height:100%;flex-wrap:wrap;gap:12px"><div${sty(brandCss)}>${esc(el.content || "© 2025 Company. All rights reserved.")}</div><div style="display:flex;gap:20px">${legal}</div></div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Type dispatch ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
function renderTypeContent(el, ctx, site, baseUrl, mobile = false) {
  const s = el.styles || {};
  switch (el.type) {
    case "heading": return renderHeading(el, ctx, mobile);
    case "subheading": return renderSubheading(el, mobile);
    case "paragraph": return renderParagraph(el, mobile);
    case "label": return renderLabel(el, mobile);
    case "quote": return renderQuote(el, mobile);
    case "list": return renderList(el, mobile);
    case "icon": return renderIcon(el);

    case "button": return renderButton(el, ctx);
    case "input": return renderInput(el);
    case "form": return cardShellWrap(s, renderForm(el, ctx));

    case "image": case "avatar": case "logo": return renderImage(el, el.type === "avatar");
    case "video": return renderVideo(el);
    case "gallery": return renderGallery(el);

    case "divider": return renderDivider(el);
    case "spacer": return "";

    case "card": case "container": case "columns": case "section": case "hero": case "bg":
      return renderSection(el);

    case "cta": return cardShellWrap(s, renderCTA(el));

    case "navbar": return renderNavbar(el, site, ctx, baseUrl, mobile);
    case "footer": return renderFooter(el);
    case "breadcrumb": return renderBreadcrumb(el);
    case "tabs": return renderTabs(el);

    case "stats": return cardShellWrap(s, renderStats(el));
    case "testimonial": return cardShellWrap(s, renderTestimonial(el));
    case "pricing": return cardShellWrap(s, renderPricing(el));
    case "team": return cardShellWrap(s, renderTeam(el));
    case "feature": return cardShellWrap(s, renderFeature(el));
    case "service": return cardShellWrap(s, renderService(el));
    case "property": return cardShellWrap(s, renderPropertyCard(el, ctx));
    case "faq": return cardShellWrap(s, renderFAQ(el));
    case "timeline": return cardShellWrap(s, renderTimeline(el));

    case "logostrip": return renderLogostrip(el);
    case "social": return renderSocial(el);
    case "map": return renderMap();
    case "countdown": return renderCountdown(el);

    default: {
      if (!el.content) return "";
      const css = ["margin:0", `font-family:${fontFamilyCSS(s.fontFamily)}`, s.fontSize !== undefined ? `font-size:${px(s.fontSize)}` : "", s.color ? `color:${cssStr(s.color, 60)}` : ""];
      return `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;padding:${s.padding !== undefined ? px(s.padding) : "12px"};box-sizing:border-box"><p${sty(css)}>${esc(el.content)}</p></div>`;
    }
  }
}

// ── Desktop (absolute, 1200px stage) ─────────────────────────────────────────
function renderElementAbs(el, ctx, site, baseUrl) {
  if (el.visible === false) return "";
  const hNum = typeof el.height === "number" ? el.height : undefined;
  const wrapCss = [
    "position:absolute", `left:${numOr(el.x, 0)}px`, `top:${numOr(el.y, 0)}px`,
    `width:${numOr(el.width, 200)}px`, hNum !== undefined ? `height:${hNum}px` : "height:auto",
    `z-index:${numOr(el.zIndex, 1)}`,
  ];
  const inner = renderTypeContent(el, ctx, site, baseUrl, false);
  const body = el.linkWrap ? `<a href="${escAttr(hrefSafe(el.linkWrap))}" style="display:block;width:100%;height:100%">${inner}</a>` : inner;
  const anim = el.animation && el.animation !== "none" ? " data-reveal" : "";
  const safeType = String(el.type || "").replace(/[^a-z0-9_-]/gi, "").slice(0, 40);
  const safeClass = el.className ? ` ${String(el.className).replace(/[^\w\s-]/g, "").trim()}` : "";
  const idAttr = el.htmlId ? ` id="${escAttr(String(el.htmlId).replace(/[^\w-]/g, "").slice(0, 100))}"` : "";
  return `<div class="fyx-el fyx-${escAttr(safeType)}${escAttr(safeClass)}"${idAttr}${sty(wrapCss)}${anim}>${body}</div>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Mobile stacked layout ─────────────────────────────────────────────────────
// Bands = full-width background elements (section/hero/bg, or width>=1100),
// sorted by y. Every other visible element joins the band whose y-range
// contains its vertical centre (or becomes a standalone band of its own).
// Within a band, elements are grouped into rows (|Δy|<=24 = same row),
// ordered by x; an all-"stats" row becomes a 2-col grid, anything else stacks.
// ─────────────────────────────────────────────────────────────────────────────
function estimatedHeight(el) {
  if (typeof el.height === "number") return el.height;
  const guess = { heading: 70, subheading: 40, paragraph: 60, navbar: 70, footer: 90 };
  return guess[el.type] || 80;
}

function groupRows(members) {
  const sorted = members.slice().sort((a, b) => numOr(a.y, 0) - numOr(b.y, 0));
  const rows = [];
  for (const el of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(numOr(el.y, 0) - last.anchorY) <= 24) last.items.push(el);
    else rows.push({ anchorY: numOr(el.y, 0), items: [el] });
  }
  for (const row of rows) row.items.sort((a, b) => numOr(a.x, 0) - numOr(b.x, 0));
  return rows;
}

function bandBackgroundCSS(bandEls) {
  const imgEl = bandEls.find((e) => e.type === "image" && e.src);
  const overlayEl = bandEls.find((e) => e !== imgEl && ["section", "hero", "bg"].includes(e.type));
  if (imgEl) {
    const src = safeUrl(imgEl.src, { allowData: true });
    const imgLayer = src ? `url("${src}") center/cover no-repeat` : "";
    if (overlayEl) {
      const overlayBg = buildBackground({ ...(overlayEl.styles || {}), bgPattern: undefined });
      if (overlayBg && overlayBg !== "transparent" && imgLayer) {
        // Layer the overlay (colour/gradient) on top of the photo in one shorthand.
        const layer = overlayBg.startsWith("url(") ? overlayBg : overlayBg.startsWith("linear-gradient") ? overlayBg : `linear-gradient(${overlayBg},${overlayBg})`;
        return `${layer}, ${imgLayer}`;
      }
    }
    return imgLayer || "transparent";
  }
  const anchor = bandEls.find((e) => ["section", "hero", "bg"].includes(e.type));
  return anchor ? buildBackground(anchor.styles || {}) : "transparent";
}

function mobileLeaf(el, ctx, site, baseUrl) {
  const s = el.styles || {};
  const cardTypes = new Set(["feature", "service", "testimonial", "pricing", "team", "property", "faq", "timeline", "stats", "form", "cta"]);
  if (cardTypes.has(el.type)) {
    return `<div style="width:100%;height:auto;min-height:56px">${renderTypeContent(el, ctx, site, baseUrl, true)}</div>`;
  }
  if (el.type === "image" || el.type === "avatar" || el.type === "logo" || el.type === "video") {
    const inner = renderTypeContent(el, ctx, site, baseUrl, true);
    return `<div style="width:100%;height:auto;max-height:320px;overflow:hidden;border-radius:${s.borderRadius !== undefined ? px(s.borderRadius) : "0"}">${inner}</div>`;
  }
  if (el.type === "button") {
    return `<div style="width:100%;height:${el.height && typeof el.height === "number" ? Math.min(el.height, 56) : 48}px">${renderTypeContent(el, ctx, site, baseUrl, true)}</div>`;
  }
  if (el.type === "navbar" || el.type === "footer" || el.type === "divider" || el.type === "spacer" || el.type === "logostrip" || el.type === "social" || el.type === "map" || el.type === "countdown" || el.type === "tabs" || el.type === "breadcrumb" || el.type === "gallery") {
    return `<div style="width:100%;height:auto">${renderTypeContent(el, ctx, site, baseUrl, true)}</div>`;
  }
  // Plain text-ish elements: natural height.
  return `<div style="width:100%;height:auto">${renderTypeContent(el, ctx, site, baseUrl, true)}</div>`;
}

function renderRow(row, ctx, site, baseUrl) {
  if (row.items.length > 1 && row.items.every((e) => e.type === "stats")) {
    const cells = row.items.map((e) => `<div style="width:100%;height:auto">${renderTypeContent(e, ctx, site, baseUrl, true)}</div>`).join("");
    return `<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;width:100%">${cells}</div>`;
  }
  return row.items.map((e) => mobileLeaf(e, ctx, site, baseUrl)).join("");
}

function buildMobileHTML(page, site, ctx, baseUrl) {
  const all = (page.elements || []).filter((el) => el.visible !== false);
  // Decorative full-width spacers/dividers add nothing when stacked.
  const visible = all.filter((el) => !((el.type === "spacer" || el.type === "divider") && numOr(el.width, 0) >= 1100 && (el.height === "auto" || numOr(el.height, 0) <= 4)));

  const bandAnchors = visible
    .filter((el) => ["section", "hero", "bg"].includes(el.type) || numOr(el.width, 0) >= 1100)
    .sort((a, b) => numOr(a.y, 0) - numOr(b.y, 0));

  // Merge same-y anchors (e.g. full-bleed image + translucent overlay) into one band.
  const bandGroups = [];
  for (const el of bandAnchors) {
    const last = bandGroups[bandGroups.length - 1];
    if (last && Math.abs(numOr(el.y, 0) - last.y) <= 24) last.els.push(el);
    else bandGroups.push({ y: numOr(el.y, 0), els: [el] });
  }
  for (const g of bandGroups) {
    g.height = Math.max(...g.els.map(estimatedHeight));
  }

  const anchorSet = new Set(bandAnchors);
  const rest = visible.filter((el) => !anchorSet.has(el));

  const bands = bandGroups.map((g) => ({ y: g.y, height: g.height, els: g.els, members: [] }));
  for (const el of rest) {
    const centerY = numOr(el.y, 0) + estimatedHeight(el) / 2;
    const band = bands.find((b) => centerY >= b.y && centerY < b.y + b.height);
    if (band) band.members.push(el);
    else bands.push({ y: numOr(el.y, 0), height: estimatedHeight(el), els: [], members: [el], standalone: true });
  }
  bands.sort((a, b) => a.y - b.y);

  const blocks = bands
    .map((band) => {
      const bg = band.els.length ? bandBackgroundCSS(band.els) : "transparent";
      let inner = "";
      // Self-contained band anchors (navbar / footer / a lone wide element with its
      // own content) render their own type content once, ahead of any children.
      for (const el of band.els) {
        if (el.type === "navbar" || el.type === "footer") {
          inner += `<div style="width:100%">${renderTypeContent(el, ctx, site, baseUrl, true)}</div>`;
        } else if (el.type !== "section" && el.type !== "hero" && el.type !== "bg" && el.type !== "image") {
          inner += mobileLeaf(el, ctx, site, baseUrl);
        }
      }
      const rows = groupRows(band.members);
      inner += `<div style="display:flex;flex-direction:column;gap:14px;width:100%">${rows.map((r) => renderRow(r, ctx, site, baseUrl)).join("")}</div>`;
      const bandCss = ["width:100%", "box-sizing:border-box", "padding:28px 20px", `background:${bg}`];
      return `<div class="fyx-band"${sty(bandCss)}>${inner}</div>`;
    })
    .join("");

  return `<div class="fyx-mobile">${blocks}</div>`;
}

// ── Google Fonts ──────────────────────────────────────────────────────────────
function fontsLink(site, page) {
  const fams = new Set([site?.settings?.globalFont || "DM Sans"]);
  for (const el of page.elements || []) if (el.styles?.fontFamily) fams.add(el.styles.fontFamily);
  const safeFams = [...fams]
    .filter(Boolean)
    .map((f) => String(f).replace(/[^\w\s-]/g, "").trim())
    .filter(Boolean)
    .slice(0, 6);
  const q = safeFams.map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700;800`).join("&");
  if (!q) return "";
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?${q}&display=swap" rel="stylesheet">`;
}

// ── JSON-LD by industry ──────────────────────────────────────────────────────
function jsonLd(site, url) {
  const name = site.settings?.metaTitle || site.title || "Website";
  const desc = site.settings?.metaDesc || "";
  const base = { "@context": "https://schema.org", name, url, description: desc };
  const byIndustry = {
    restaurant: { "@type": "Restaurant", servesCuisine: "" },
    hotel: { "@type": "Hotel" },
    realestate: { "@type": "RealEstateAgent" },
    law: { "@type": "LegalService" },
    portfolio: { "@type": "Person" },
    ecommerce: { "@type": "OnlineStore" },
  };
  const extra = byIndustry[site.industry] || { "@type": "Organization" };
  return `<script type="application/ld+json">${jsonForScript({ ...base, ...extra })}</script>`;
}

// ── Page background CSS (desktop stage) ──────────────────────────────────────
function pageBg(page) {
  if (page.bgType === "gradient" && page.gradFrom && page.gradTo) {
    return `background:linear-gradient(${cssStr(page.gradDir || "135deg", 20)},${cssStr(page.gradFrom, 60)},${cssStr(page.gradTo, 60)})`;
  }
  if (page.bgType === "image" && page.bgImage) {
    const src = safeUrl(page.bgImage);
    if (src) return `background-image:url('${src}');background-size:${cssStr(page.bgSize || "cover", 20)};background-position:${cssStr(page.bgPos || "center", 30)};background-repeat:${cssStr(page.bgRepeat || "no-repeat", 20)}`;
  }
  return `background-color:${cssStr(page.bgColor || "#ffffff", 60)}`;
}

// ── Static CSS ────────────────────────────────────────────────────────────────
const BASE_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{-webkit-font-smoothing:antialiased;overflow-x:hidden;max-width:100vw}
img{max-width:100%;display:block}
a{color:inherit;text-decoration:none}
.fyx-viewport{width:100%;overflow:hidden;position:relative}
.fyx-stage{width:${CANVAS_W}px;position:relative;transform-origin:top left}
.fyx-el{position:absolute}
.fyx-btn{cursor:pointer}
.fyx-btn:hover{filter:brightness(1.04)}
[data-reveal]{opacity:0;transform:translateY(26px);transition:opacity .6s ease-out,transform .6s ease-out}
[data-reveal].fyx-in{opacity:1;transform:none}
.fyx-mobile{display:none;width:100%;overflow-x:hidden}
.fyx-mobile *{overflow-wrap:break-word;word-break:break-word;max-width:100%}
.fyx-band{max-width:100vw}
.fyx-band img,.fyx-band video,.fyx-band iframe{max-width:100%}
.fyx-cart-btn{cursor:pointer;margin-left:20px}
.fyx-cart-btn b{display:inline-block;min-width:18px;text-align:center;background:#111;color:#fff;border-radius:999px;font-size:11px;padding:1px 5px}
#fyx-cart{position:fixed;top:0;right:-360px;width:340px;max-width:92vw;height:100vh;background:#fff;color:#111;box-shadow:-12px 0 40px rgba(0,0,0,.18);transition:right .3s ease;z-index:9999;display:flex;flex-direction:column;font-family:inherit}
#fyx-cart.open{right:0}
#fyx-cart header{display:flex;justify-content:space-between;align-items:center;padding:18px;border-bottom:1px solid #eee;font-weight:700}
#fyx-cart .items{flex:1;overflow-y:auto;padding:12px 18px;display:flex;flex-direction:column;gap:14px}
#fyx-cart .item{display:flex;justify-content:space-between;gap:10px;font-size:14px;align-items:center}
#fyx-cart .qty{display:flex;gap:8px;align-items:center}
#fyx-cart .qty button{width:22px;height:22px;border:1px solid #ddd;background:#fff;border-radius:6px;cursor:pointer}
#fyx-cart footer{padding:18px;border-top:1px solid #eee}
#fyx-cart .checkout{width:100%;padding:13px;background:#111;color:#fff;border:0;border-radius:10px;font-weight:600;cursor:pointer}
.fyx-badge{position:fixed;right:14px;bottom:14px;z-index:9998;display:inline-flex;align-items:center;gap:6px;padding:7px 12px;background:#ffffff;color:#334155;font:500 12px/1.2 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;border:1px solid #e5e7eb;border-radius:999px;box-shadow:0 2px 10px rgba(15,23,42,.12);text-decoration:none}
.fyx-badge:hover{color:#0f172a}
@media (max-width:${MOBILE_BP}px){
  .fyx-viewport{display:none}
  .fyx-mobile{display:block}
  .fyx-has-badge .fyx-mobile{padding-bottom:60px}
}
@media (prefers-reduced-motion:reduce){[data-reveal]{transition:none;opacity:1;transform:none}}
`;

const RUNTIME_JS = `
(function(){
  var stage=document.querySelector('.fyx-stage'),vp=document.querySelector('.fyx-viewport');
  function fit(){
    if(!stage||!vp||window.innerWidth<=${MOBILE_BP})return;
    var s=vp.clientWidth/${CANVAS_W};
    stage.style.transform='scale('+s+')';
    vp.style.height=(stage.offsetHeight*s)+'px';
  }
  window.addEventListener('resize',fit);window.addEventListener('load',fit);fit();
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('fyx-in');io.unobserve(e.target);}});},{threshold:.15});
    document.querySelectorAll('[data-reveal]').forEach(function(el){io.observe(el);});
  }else{document.querySelectorAll('[data-reveal]').forEach(function(el){el.classList.add('fyx-in');});}
})();
`;

const CART_JS = `
(function(){
  var KEY='fyx_cart_'+location.hostname+location.pathname.split('/')[1];
  function load(){try{return JSON.parse(localStorage.getItem(KEY))||[]}catch(e){return[]}}
  function save(c){localStorage.setItem(KEY,JSON.stringify(c));render();}
  var cart=load();
  var drawer=document.createElement('div');drawer.id='fyx-cart';
  drawer.innerHTML='<header><span>Your cart</span><span style="cursor:pointer" data-cart-close>✕</span></header><div class="items"></div><footer><div style="display:flex;justify-content:space-between;font-weight:700;margin-bottom:12px"><span>Subtotal</span><span data-cart-total>$0.00</span></div><button class="checkout">Checkout</button></footer>';
  document.body.appendChild(drawer);
  document.querySelectorAll('[data-cart-open]').forEach(function(b){b.hidden=false;});
  function money(n){return '$'+n.toFixed(2)}
  function render(){
    var box=drawer.querySelector('.items');box.innerHTML='';var total=0,count=0;
    if(!cart.length)box.innerHTML='<p style="opacity:.6;text-align:center;margin-top:30px">Your cart is empty.<br>Continue shopping ✨</p>';
    cart.forEach(function(it,i){
      total+=it.price*it.qty;count+=it.qty;
      var row=document.createElement('div');row.className='item';
      row.innerHTML='<span style="flex:1"></span><span class="qty"><button data-a="-">−</button>'+it.qty+'<button data-a="+">+</button></span><b>'+money(it.price*it.qty)+'</b>';
      row.querySelector('span').textContent=it.name;
      row.querySelectorAll('button').forEach(function(b){b.onclick=function(){it.qty+=b.dataset.a==='+'?1:-1;if(it.qty<1)cart.splice(i,1);save(cart);};});
      box.appendChild(row);
    });
    drawer.querySelector('[data-cart-total]').textContent=money(total);
    document.querySelectorAll('[data-cart-count]').forEach(function(el){el.textContent=count;});
  }
  document.addEventListener('click',function(e){
    var add=e.target.closest('[data-cart-add]');
    if(add){
      var name=add.dataset.name||'Item',price=parseFloat(add.dataset.price)||0;
      var hit=cart.find(function(i){return i.name===name});
      if(hit)hit.qty++;else cart.push({name:name,price:price,qty:1});
      save(cart);var t=add.textContent;add.textContent='Added ✓';setTimeout(function(){add.textContent=t;},900);
      drawer.classList.add('open');
    }
    if(e.target.closest('[data-cart-open]'))drawer.classList.add('open');
    if(e.target.closest('[data-cart-close]'))drawer.classList.remove('open');
  });
  render();
})();
`;

const FORM_JS = `
(function(){
  document.querySelectorAll('[data-fyx-form]').forEach(function(form){
    form.addEventListener('submit',function(e){
      e.preventDefault();
      var thanks=form.querySelector('.fyx-form-thanks');
      Array.prototype.forEach.call(form.elements,function(el){ el.hidden=true; });
      if(thanks)thanks.hidden=false;
    });
  });
})();
`;

// ── Badge ─────────────────────────────────────────────────────────────────────
function badgeHTML() {
  const href = `https://${cfg.ROOT_DOMAIN}/?ref=site-badge`;
  return `<a class="fyx-badge" href="${escAttr(href)}" aria-label="Made with FolioFYX — build your own site">Made with FolioFYX</a>`;
}

function normSlugForMatch(s) {
  let v = String(s ?? "/").trim();
  if (!v) v = "/";
  if (v !== "/") v = v.replace(/\/+$/, "");
  return v.toLowerCase();
}

function firstAbsoluteImage(elements) {
  for (const el of elements || []) {
    if (el.visible === false) continue;
    if ((el.type === "image" || el.type === "avatar" || el.type === "logo") && el.src) {
      const s = String(el.src).trim();
      if (/^https?:\/\//i.test(s)) return s;
    }
  }
  return "";
}

// ─────────────────────────────────────────────────────────────────────────────
// ── Public API ────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render one page of a site to a complete HTML document, or null when
 * `pageSlug` doesn't match any page (callers should 404, never fall back).
 * @param site  CustomWebsite-shaped object (title, pages, settings, industry)
 * @param opts  { pageSlug, baseUrl, badge } baseUrl = canonical origin+path prefix
 */
export function renderSiteHTML(site, { pageSlug = "/", baseUrl = "", badge = true } = {}) {
  const pages = Array.isArray(site?.pages) ? site.pages : [];
  const wanted = normSlugForMatch(pageSlug);
  const page = pages.find((p) => normSlugForMatch(p.slug) === wanted);
  if (!page) return null;

  const base = String(baseUrl || "").replace(/\/+$/, "");
  const lang = safeLang(site);

  // Desktop pass.
  const ctxD = { h1Used: false, hasCart: false, hasForm: false, lastProductName: "", lastProductPrice: "" };
  const elementsHTML = (page.elements || [])
    .slice()
    .sort((a, b) => numOr(a.y, 0) - numOr(b.y, 0) || numOr(a.x, 0) - numOr(b.x, 0))
    .map((el) => renderElementAbs(el, ctxD, site, base))
    .join("\n");
  const stageH = Math.max(
    ...(page.elements || []).map((el) => numOr(el.y, 0) + (typeof el.height === "number" ? el.height : 120)),
    600
  );

  // Mobile pass (independent h1/product bookkeeping — see buildMobileHTML).
  const ctxM = { h1Used: false, hasCart: false, hasForm: false, lastProductName: "", lastProductPrice: "" };
  const mobileHTML = buildMobileHTML(page, site, ctxM, base);

  const hasCart = ctxD.hasCart || ctxM.hasCart || site.industry === "ecommerce";
  const hasForm = ctxD.hasForm || ctxM.hasForm;

  const title = page.seoTitle || site.settings?.metaTitle || site.title || "Website";
  const fallbackDesc = `${site.title || "This site"} — built with FolioFYX.`;
  const desc = page.seoDesc || site.settings?.metaDesc || fallbackDesc;
  const pagePath = page.slug === "/" ? "" : page.slug;
  const url = base ? `${base}${pagePath}` : "";
  const noindex = !!(site.settings?.noindex || page.noindex);
  const robotsMeta = noindex ? "noindex, nofollow" : "index, follow, max-image-preview:large";

  const ogFromPage = page.ogImage && /^https?:\/\//i.test(page.ogImage) ? page.ogImage : "";
  const ogFromThumb = site.thumbnail && /^https?:\/\//i.test(site.thumbnail) ? site.thumbnail : "";
  const ogImage = ogFromPage || firstAbsoluteImage(page.elements) || ogFromThumb;

  const favicon = safeUrl(site.settings?.favicon || "", { allowData: true });
  const ga = safeGAId(site.settings?.googleAnalyticsId);
  const accent = site.settings?.globalAccent && /^#[0-9a-fA-F]{3,8}$/.test(site.settings.globalAccent) ? site.settings.globalAccent : "#6366f1";
  const customCSS = sanitizeCustomCSS(site.settings?.customCSS);
  const bodyClass = badge !== false ? ' class="fyx-has-badge"' : "";

  return `<!doctype html>
<html lang="${escAttr(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${escAttr(desc)}">
${url ? `<link rel="canonical" href="${escAttr(url)}">` : ""}
<meta name="robots" content="${escAttr(robotsMeta)}">
<meta name="theme-color" content="${escAttr(accent)}">
<meta property="og:type" content="website">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(desc)}">
${ogImage ? `<meta property="og:image" content="${escAttr(ogImage)}">` : ""}
${url ? `<meta property="og:url" content="${escAttr(url)}">` : ""}
${site.title ? `<meta property="og:site_name" content="${escAttr(site.title)}">` : ""}
<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">
<meta name="twitter:title" content="${escAttr(title)}">
<meta name="twitter:description" content="${escAttr(desc)}">
${ogImage ? `<meta name="twitter:image" content="${escAttr(ogImage)}">` : ""}
<meta name="generator" content="FolioFYX">
${favicon ? `<link rel="icon" href="${escAttr(favicon)}">` : ""}
${fontsLink(site, page)}
${jsonLd(site, url || base)}
<style>${BASE_CSS}
body{font-family:${escAttr(fontFamilyCSS(site.settings?.globalFont || "DM Sans"))}}
.fyx-page{${pageBg(page)};min-height:100vh}
${customCSS ? `/* user CSS */\n${customCSS}` : ""}
</style>
${ga ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${escAttr(ga)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config','${escAttr(ga)}');</script>` : ""}
</head>
<body${bodyClass}>
<main class="fyx-page">
  <div class="fyx-viewport">
    <div class="fyx-stage" style="height:${stageH}px">
${elementsHTML}
    </div>
  </div>
  ${mobileHTML}
</main>
${badge !== false ? badgeHTML() : ""}
<script>${RUNTIME_JS}</script>
${hasCart ? `<script>${CART_JS}</script>` : ""}
${hasForm ? `<script>${FORM_JS}</script>` : ""}
</body>
</html>`;
}

/** Small styled 404 for an unpublished/unknown path, in the site's own font. */
export function renderNotFoundHTML(site, { baseUrl = "" } = {}) {
  const lang = safeLang(site);
  const font = fontFamilyCSS(site?.settings?.globalFont || "DM Sans");
  const home = baseUrl || "/";
  const siteTitle = site?.title ? esc(site.title) : "";
  return `<!doctype html>
<html lang="${escAttr(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Page not found${siteTitle ? ` — ${siteTitle}` : ""}</title>
<meta name="robots" content="noindex, nofollow">
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;font-family:${escAttr(font)};color:#0f172a;text-align:center;padding:24px}
.fyx-404{max-width:420px}
.fyx-404 h1{font-size:72px;margin:0 0 8px;font-weight:800;color:#6366f1;line-height:1}
.fyx-404 p{font-size:16px;color:#64748b;margin:0 0 24px;line-height:1.6}
.fyx-404 a{display:inline-flex;align-items:center;justify-content:center;padding:12px 28px;background:#111827;color:#fff;border-radius:10px;font-weight:600;text-decoration:none}
</style>
</head>
<body>
  <div class="fyx-404">
    <h1>404</h1>
    <p>This page doesn't exist${siteTitle ? ` on ${siteTitle}` : ""}.</p>
    <a href="${escAttr(home)}">Back home</a>
  </div>
</body>
</html>`;
}

/** robots.txt for a published site. */
export function renderRobotsTxt(site, { origin = "" } = {}) {
  const rule = site?.settings?.noindex ? "Disallow: /" : "Allow: /";
  return `User-agent: *\n${rule}\nSitemap: ${origin}/sitemap.xml\n`;
}

/** sitemap.xml listing every non-noindex page of the site. */
export function renderSitemapXml(site, { origin = "" } = {}) {
  const pages = Array.isArray(site?.pages) ? site.pages : [];
  const lastmod = site?.updatedAt ? new Date(site.updatedAt).toISOString() : new Date().toISOString();
  const urls = pages
    .filter((p) => p && !p.noindex)
    .map((p) => {
      const path = p.slug === "/" ? "" : p.slug || "";
      const loc = `${origin}${path}`;
      return `  <url><loc>${esc(loc)}</loc><lastmod>${lastmod}</lastmod></url>`;
    })
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}
