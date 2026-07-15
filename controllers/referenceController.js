// server/controllers/referenceController.js
// ─────────────────────────────────────────────────────────────────────────────
// "Design from Reference" — rebuild a page's *structure* from a reference.
//
// Modes:
//   text  → describe a site in words            (no CV step, no Python — ever)
//   image → upload a screenshot                 (Python CV: palette + layout bands)
//   url   → paste a live URL    (Phase 2: needs Playwright — returns 501 for now)
//   html  → upload code/zip     (Phase 2: needs Playwright — returns 501 for now)
//
// Failure ladder (each rung degrades, never dies):
//   1. Python CV fails            → continue vision-only with the original upload
//   2. Freeform vision fails      → catalog vision mapping
//   3. Catalog vision fails       → text mapping (works with or without CV facts)
//   4. Text mapping fails         → structural default layout (palette-matched)
// Every thrown error that escapes returns a structured 4xx/5xx JSON message.
//
// RAG: the brief's industry is classified (trained classifier w/ regex
// fallback) and buildDesignContext() injects retrieved design rules into BOTH
// the freeform replication prompt and the catalog/text mapping prompts.
//
// IP-safe by design: we copy layout + colours only — never the reference's
// logos, photos, or text. Copy is generic/structural.
// ─────────────────────────────────────────────────────────────────────────────

import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

import { buildFromSpec, SECTION_CATALOG, REFERENCE_SECTION_TYPES } from "../data/pageTemplates.js";
import { detectIndustry, aiAvailable, callGroq, parseObject, getGroq } from "./aiBuilderController.js";
import { buildDesignContext, classifyIndustry } from "../rag/retriever.js";
import { resolvePremiumTokens, polishElements, stockUrl } from "../data/designSystem.js";

// Multimodal models — these actually SEE the screenshot (current Groq vision LLMs).
const VISION_MODELS = [
  "meta-llama/llama-4-scout-17b-16e-instruct",
  "meta-llama/llama-4-maverick-17b-128e-instruct",
];
// Prefer the strong text model for the no-image (describe) path.
const TEXT_MODELS = [
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", maxOut: 3800 },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B", maxOut: 3800 },
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PYTHON_SCRIPT = path.join(__dirname, "../python/design_extractor.py");
// Allow an explicit override (e.g. PYTHON_BIN=py or a full path) so deployments
// can point at the interpreter that actually has numpy/pillow installed.
const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");

// Groq rejects very large base64 image payloads; keep well under the limit
// when we have to send the raw upload because the Python resize step failed.
const MAX_VISION_BYTES = 3_500_000;

// ── Python CV step — best-effort, with a hard timeout. Never crashes a request:
//    the caller catches and continues vision-only when this rejects. ──────────
function runPython(filePath) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(v);
    };
    const proc = spawn(PYTHON_BIN, [PYTHON_SCRIPT, filePath]);
    const timer = setTimeout(() => {
      try { proc.kill(); } catch (_) {}
      finish(reject, new Error("Image analysis timed out."));
    }, 25_000);
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", () => {
      if (stderr) console.warn("[design_extractor stderr]", stderr.substring(0, 400));
      if (!stdout.trim()) return finish(reject, new Error("Image analysis produced no output."));
      try {
        finish(resolve, JSON.parse(stdout.trim()));
      } catch {
        finish(reject, new Error("Image analysis returned invalid JSON."));
      }
    });
    proc.on("error", (err) =>
      finish(reject, new Error(err.code === "ENOENT" ? "Python not found on server." : "Analysis error: " + err.message))
    );
  });
}

// ── Tolerant JSON extraction (fences anywhere, outermost braces, common repairs)
function extractJson(raw) {
  const first = parseObject(raw);
  if (first && Object.keys(first).length) return first;
  const text = String(raw || "").replace(/```(?:json)?/gi, "");
  const s = text.indexOf("{");
  const e = text.lastIndexOf("}");
  if (s === -1 || e === -1 || e <= s) return {};
  const body = text
    .slice(s, e + 1)
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, "$1");
  try {
    const obj = JSON.parse(body);
    return obj && typeof obj === "object" ? obj : {};
  } catch {
    return {};
  }
}

// ── Turn the CV palette into our token shape (colours we're confident about) ──
function tokensFromCV(cv) {
  const p = cv?.palette || {};
  const t = {};
  if (p.bg) t.bg = p.bg;
  if (p.band) t.band = p.band;
  if (p.text) t.text = p.text;
  if (p.accent) { t.accent = p.accent; t.accent2 = p.accent; }
  if (p.muted) t.muted = p.muted;
  if (typeof p.dark === "boolean") t.dark = p.dark;
  return t;
}

// ── Which image do we show the vision model? Prefer the small CV resize; fall
//    back to the raw upload when Python failed (vision-only degrade path). ────
function visionSource(cv, tempPath, uploadMime) {
  if (cv?.resized) {
    try { if (fs.existsSync(cv.resized)) return { path: cv.resized, mime: "image/jpeg" }; } catch (_) {}
  }
  if (tempPath) {
    try {
      if (fs.existsSync(tempPath) && fs.statSync(tempPath).size <= MAX_VISION_BYTES) {
        return { path: tempPath, mime: uploadMime || "image/jpeg" };
      }
    } catch (_) {}
  }
  return null;
}

// ── Fallback structural layout when Groq is unavailable ──────────────────────
const DEFAULT_SECTIONS = [
  { type: "navbar", brand: "Brand" },
  { type: "heroSplit", label: "WELCOME", heading: "A bold headline that sets the tone", sub: "A short supporting line that explains the value in one sentence.", cta1: "Get Started", cta2: "Learn More" },
  { type: "features", label: "HIGHLIGHTS", heading: "What makes this great", items: [
    { content: "First Benefit|A concise, concrete description of this benefit.|✦" },
    { content: "Second Benefit|A concise, concrete description of this benefit.|◈" },
    { content: "Third Benefit|A concise, concrete description of this benefit.|⬡" },
  ] },
  { type: "stats", items: ["100+|Metric One", "99%|Metric Two", "4.9/5|Metric Three", "24/7|Metric Four"] },
  { type: "testimonials", label: "TESTIMONIALS", heading: "What people say", items: [
    "A short, believable quote about the experience.|Name One|Role, Company",
    "A short, believable quote about the experience.|Name Two|Role, Company",
    "A short, believable quote about the experience.|Name Three|Role, Company",
  ] },
  { type: "cta", heading: "Ready to get started?", sub: "A final nudge that invites the visitor to act.", button: "Get Started" },
  { type: "footer", brand: "Brand" },
];

// ── Shared system prompt for both the text and vision catalog mappers ────────
function buildSysPrompt(seesImage, ragContext = "") {
  const catalog = SECTION_CATALOG.map((s) => `- ${s.type}: ${s.desc}  [slots: ${s.slots}]`).join("\n");
  return `You are a senior web designer. ${seesImage
    ? "You are shown a screenshot of a real website. Recreate its STRUCTURE, mood and typography (NOT its exact words, logos, or photos)."
    : "Design a website structure from the brief."} Use ONLY these section types:
${catalog}

Return ONLY a JSON object (no markdown, no comments):
{
  "industry": "one of: saas | marketing | realestate | restaurant | portfolio | ecommerce | law | hotel | general",
  "tokens": {
    "head": "<Google font that matches the headline style — e.g. 'Playfair Display' for elegant serif, 'Syne'/'Space Grotesk' for modern, 'Oswald' for bold condensed>",
    "body": "<Google font for body text>",
    "dark": <true if the design is dark-themed>,
    "band": "<hex for section bands, slightly different from bg>",
    "card": "<hex for card surfaces>",
    "accent2": "<a second accent hex for gradients, near the main accent>"
  },
  "sections": [ { "type": "<catalog type>", ...all the slots for that type... } ]
}

RULES:
- Use ONLY catalog types. Order sections top→bottom to mirror the real page${seesImage ? " you see" : ""} (start with navbar, end with footer).
- FILL EVERY SLOT with concrete, specific, believable copy that matches the design's TONE and apparent purpose. Real headlines and benefits — NEVER leave a slot empty, NEVER output "Heading"/"Your text here"/"Button"/placeholders/lorem ipsum/square brackets. Do NOT copy the reference's real brand name or exact sentences; write fresh copy in the same spirit.
- For pipe "|" slots, keep the EXACT segment count from the catalog (e.g. stats "number|label", pricing "plan|price|period|desc|feature|feature", testimonial "quote|name|role"). Keep a leading emoji on feature/service items.
- Match the headline FONT to what you see (serif display → 'Playfair Display'; bold modern sans → 'Syne'/'Space Grotesk').
- ${seesImage ? "Use the EXACT hex colours provided as ground truth (the screenshot's real palette) — don't guess colours." : "Pick tasteful colours that fit the brief."}
- 6–9 sections is ideal. A hero is required.${ragContext ? `\n\n${ragContext}` : ""}`;
}

// Keep only token keys our builders understand.
function sanitizeTokens(t = {}) {
  const out = {};
  for (const k of ["head", "body", "band", "card", "accent", "accent2", "bg", "text", "muted"]) {
    if (typeof t[k] === "string" && t[k].trim()) out[k] = t[k].trim();
  }
  if (typeof t.dark === "boolean") out.dark = t.dark;
  return out;
}

function specFromObj(obj, industry) {
  let sections = Array.isArray(obj.sections)
    ? obj.sections.filter((s) => s && REFERENCE_SECTION_TYPES.includes(s.type))
    : [];
  if (!sections.length) sections = DEFAULT_SECTIONS;
  return {
    industry: typeof obj.industry === "string" ? obj.industry : industry,
    tokens: sanitizeTokens(obj.tokens),
    sections,
  };
}

// ── VISION path: the model actually SEES the screenshot (catalog mapping) ─────
async function mapToSpecVision({ source, cv, description, industry, ragContext }) {
  const groq = getGroq();
  if (!groq) throw new Error("AI not configured");
  const b64 = fs.readFileSync(source.path).toString("base64");
  const dataUrl = `data:${source.mime};base64,${b64}`;

  const messages = [
    { role: "system", content: buildSysPrompt(true, ragContext) },
    {
      role: "user",
      content: [
        { type: "text", text: `Recreate this website's design.\nEXACT colours extracted from the image (use these as ground truth): ${JSON.stringify(cv?.palette || {})}\nExtra context from the user: ${description || "(none)"}` },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ];

  let lastErr;
  for (const model of VISION_MODELS) {
    try {
      const c = await groq.chat.completions.create({ model, temperature: 0.5, max_tokens: 4000, messages });
      const obj = extractJson(c?.choices?.[0]?.message?.content || "");
      const sections = Array.isArray(obj.sections) ? obj.sections.filter((s) => s && REFERENCE_SECTION_TYPES.includes(s.type)) : [];
      if (sections.length) return { ...specFromObj(obj, industry), model };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Vision mapping failed.");
}

// ── TEXT path: no image (Describe mode), or vision fallback. NEVER touches
//    Python — CV facts are optional extra context only. ───────────────────────
async function mapToSpec({ cv, description, industry, ragContext }) {
  const facts = cv
    ? `EXTRACTED PALETTE: ${JSON.stringify(cv.palette)}\nDETECTED LAYOUT BANDS (top→bottom, fractions of page height): ${JSON.stringify(cv.regions)}`
    : "No screenshot analysis is available — design a sensible layout from the description alone.";
  const user = `BRIEF: ${description || "(none — infer a fitting design)"}\nDETECTED INDUSTRY GUESS: ${industry}\n${facts}`;

  const { text, model } = await callGroq([
    { role: "system", content: buildSysPrompt(false, ragContext) },
    { role: "user", content: user },
  ], 3800, TEXT_MODELS);

  return { ...specFromObj(extractJson(text), industry), model };
}

const freshId = (i) => `el_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;

// ─────────────────────────────────────────────────────────────────────────────
// ── FREEFORM REPLICATION ──────────────────────────────────────────────────────
// The vision model emits the ACTUAL positioned elements it sees (each heading,
// button, image at its real spot) instead of picking from the section catalog.
// Coordinates are pixels on a 1200px-wide canvas (fractions also accepted for
// robustness) and are validated/clamped server-side before reaching the studio.
// ─────────────────────────────────────────────────────────────────────────────

const CANVAS_W = 1200;

// Element types the freeform model may use (all renderable by the studio's
// CanvasElementRenderer and editable via the PropertyPanel).
const FREEFORM_TYPES = new Set([
  "heading", "subheading", "paragraph", "label", "quote", "button",
  "image", "logo", "avatar", "icon", "section", "divider", "navbar", "footer",
]);

const TEXT_TYPES = ["heading", "subheading", "paragraph", "label", "quote"];

const clamp01 = (v) => (typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(1, v)) : null);
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);

function freeformSysPrompt(pageH, ragContext = "") {
  return `You are a pixel-accurate web design replicator. You are shown a screenshot of a website. Reproduce it as a flat list of absolutely-positioned canvas elements that recreate what you SEE — same layout, same reading order, same colours and fonts.

The canvas is ${CANVAS_W}px wide and about ${pageH}px tall. All coordinates are pixels on that canvas: x grows rightward (0..${CANVAS_W}), y grows DOWN the page (0 at the top).

Return ONLY JSON (no markdown):
{
  "industry": "saas|marketing|realestate|restaurant|portfolio|ecommerce|law|hotel|general",
  "page": { "bg": "<page background hex>", "dark": <bool> },
  "tokens": { "head": "<Google font matching the headlines>", "body": "<Google font>" },
  "elements": [
    {
      "type": "navbar|heading|subheading|paragraph|label|quote|button|image|logo|icon|section|divider|footer",
      "x": <left px>, "y": <top px>, "width": <px, max ${CANVAS_W}>, "height": <px>,
      "zIndex": <1 for full-width background "section" bands, 2 for everything on top>,
      "content": "<the visible text; for images leave empty>",
      "isImage": <true ONLY for photo/image regions>,
      "styles": { "color":"#hex", "bgColor":"#hex or transparent", "fontSize":<px>, "fontWeight":"400-900", "textAlign":"left|center|right", "fontFamily":"<Google font>", "borderRadius":<px>, "bgType":"solid|gradient|transparent", "gradientFrom":"#hex", "gradientTo":"#hex" }
    }
  ]
}

RULES:
- COMPLETE coverage: recreate EVERY visible text block, button and image as its own element, in the positions you see. A full landing-page reference must produce AT LEAST 12 elements (14-24 is typical). Fewer than 12 means you missed content.
- Elements must NOT overlap each other. The ONLY allowed overlap is content sitting on top of a full-width zIndex:1 "section" background band. Keep at least 16px of air between neighbouring elements.
- y strictly increases down the page in reading order: navbar near y:0, hero next, footer last. No negative coordinates; x + width never exceeds ${CANVAS_W}.
- Put a big background block (type:"section", x:0, width:${CANVAS_W}, the band's bg colour/gradient) BEHIND each coloured region, with zIndex 1; list backgrounds before the content that sits on them.
- For any photo/illustration/hero image, set "type":"image" and "isImage":true with its bounding box.
- Use the EXACT text you can read. Match colours to what you see. Match fonts (serif headline → 'Playfair Display'; bold modern → 'Syne'/'Space Grotesk'; condensed → 'Oswald').
- fontSize is in px on the ${CANVAS_W}px-wide canvas (a big hero headline is ~60-90; body text 15-18; labels 11-13).
- Never invent placeholder text like "Heading"/"Your text here". If you truly can't read it, summarise what's there.${ragContext ? `\n\n${ragContext}` : ""}`;
}

// Convert one model element (px preferred, fractions accepted) → a canvas element.
function toCanvasElement(raw, pageH, idx) {
  let type = String(raw.type || "paragraph").toLowerCase();
  if (raw.isImage === true && !["image", "logo", "avatar"].includes(type)) type = "image";
  if (!FREEFORM_TYPES.has(type)) type = "paragraph";

  const n = (v) => (typeof v === "number" && isFinite(v) ? v : null);
  let x, y, w, h;
  if (n(raw.fx) != null || n(raw.fy) != null || n(raw.fw) != null) {
    // Legacy fraction shape (0..1 of the screenshot).
    x = Math.round((clamp01(raw.fx) ?? 0) * CANVAS_W);
    y = Math.round((clamp01(raw.fy) ?? 0) * pageH);
    w = Math.round((clamp01(raw.fw) ?? 0.3) * CANVAS_W);
    h = Math.round((clamp01(raw.fh) ?? 0.05) * pageH);
  } else {
    x = n(raw.x) ?? 0;
    y = n(raw.y) ?? idx * 96;
    w = n(raw.width) ?? 360;
    h = n(raw.height) ?? 48;
    // Some models still answer in fractions even when asked for px.
    if (x <= 1 && w <= 1.5 && y <= 1.5) {
      x = Math.round(x * CANVAS_W);
      y = Math.round(y * pageH);
      w = Math.round(Math.max(0.02, w) * CANVAS_W);
      h = Math.round(Math.max(0.02, h) * pageH);
    }
  }

  const isText = TEXT_TYPES.includes(type);
  const isButton = type === "button";
  const heightPx = Math.max(isText || isButton ? 24 : 40, Math.round(h));

  const s = raw.styles || {};
  const styles = {
    color: typeof s.color === "string" ? s.color : undefined,
    bgColor: typeof s.bgColor === "string" ? s.bgColor : undefined,
    fontSize: num(s.fontSize, undefined),
    fontWeight: s.fontWeight ? String(s.fontWeight) : undefined,
    textAlign: ["left", "center", "right"].includes(s.textAlign) ? s.textAlign : undefined,
    fontFamily: typeof s.fontFamily === "string" ? s.fontFamily : undefined,
    borderRadius: num(s.borderRadius, undefined),
    lineHeight: num(s.lineHeight, isText ? 1.25 : undefined),
    bgType: ["solid", "gradient", "transparent"].includes(s.bgType) ? s.bgType : undefined,
    gradientFrom: typeof s.gradientFrom === "string" ? s.gradientFrom : undefined,
    gradientTo: typeof s.gradientTo === "string" ? s.gradientTo : undefined,
    objectFit: type === "image" ? "cover" : undefined,
  };
  Object.keys(styles).forEach((k) => styles[k] === undefined && delete styles[k]);

  const zIndex = Number.isFinite(raw.zIndex)
    ? Math.max(1, Math.min(10, Math.round(raw.zIndex)))
    : (type === "section" ? 1 : 2);

  // Field shape mirrors the studio's createElement() factory
  // (client/src/pages/Templates/Custom/constants.js): id, type, x, y, width,
  // height ("auto" for flowing text), zIndex, locked, visible, content, src,
  // alt, href, styles — so every recreated element is fully editable.
  return {
    id: freshId(idx),
    type,
    x: Math.round(x),
    y: Math.round(y),
    width: Math.round(w),
    height: type === "section" || type === "image" || isButton ? heightPx : (isText ? "auto" : heightPx),
    zIndex,
    visible: true,
    locked: false,
    content: typeof raw.content === "string" ? raw.content : "",
    src: "",
    alt: "",
    href: "",
    styles,
    _box: { isImage: type === "image" || raw.isImage === true },
  };
}

// Estimate the rendered height of an element (text heights are "auto").
function estimateHeight(el) {
  if (typeof el.height === "number") return el.height;
  const s = el.styles || {};
  const fontSize = typeof s.fontSize === "number" ? s.fontSize : 16;
  const lineHeight = typeof s.lineHeight === "number" ? s.lineHeight : 1.3;
  const chars = String(el.content || "").length || 12;
  const charsPerLine = Math.max(4, Math.floor((el.width || 300) / (fontSize * 0.55)));
  const lines = Math.max(1, Math.ceil(chars / charsPerLine));
  return Math.round(lines * fontSize * lineHeight) + 8;
}

// ── Server-side geometry validation ───────────────────────────────────────────
// Clamp everything onto the 1200px canvas (no negative coords, no width>1200),
// order background bands before foreground content (paint order = array order
// in the studio canvas), and auto-stack foreground elements that overlap by
// more than 60% of the smaller element's area.
function validateGeometry(elements) {
  const els = elements.map((el) => {
    let width = Math.max(20, Math.min(Math.round(Number(el.width) || 300), CANVAS_W));
    let x = Math.max(0, Math.round(Number(el.x) || 0));
    if (x + width > CANVAS_W) x = Math.max(0, CANVAS_W - width);
    const y = Math.max(0, Math.round(Number(el.y) || 0));
    const height = el.height === "auto" ? "auto" : Math.max(2, Math.round(Number(el.height) || 40));
    return { ...el, x, y, width, height };
  });

  // Paint order: zIndex 1 bands first, then content top-to-bottom, left-to-right.
  els.sort((a, b) => (a.zIndex || 2) - (b.zIndex || 2) || a.y - b.y || a.x - b.x);

  // Auto-stack: a foreground element overlapping a previous one by >60% gets
  // pushed below it (text over a zIndex:1 section band is intentional layering).
  const fg = els.filter((e) => (e.zIndex || 2) >= 2 && e.type !== "section");
  for (let i = 1; i < fg.length; i++) {
    const b = fg[i];
    for (let j = 0; j < i; j++) {
      const a = fg[j];
      const ah = estimateHeight(a);
      const bh = estimateHeight(b);
      const ox = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const oy = Math.max(0, Math.min(a.y + ah, b.y + bh) - Math.max(a.y, b.y));
      const inter = ox * oy;
      const smaller = Math.max(1, Math.min(a.width * ah, b.width * bh));
      if (inter / smaller > 0.6) {
        b.y = a.y + ah + 16;
      }
    }
  }

  // Stretch the final background band if auto-stacking pushed content past it.
  const contentBottom = fg.reduce((m, e) => Math.max(m, e.y + estimateHeight(e)), 0);
  for (const el of els) {
    if (el.type === "section" && (el.zIndex || 2) === 1 && typeof el.height === "number") {
      const isLastBand = el.y + el.height >= contentBottom - 200;
      if (isLastBand && contentBottom > el.y + el.height) el.height = contentBottom - el.y + 40;
    }
  }
  return els;
}

// Full freeform replication: vision → positioned elements → validated geometry.
async function replicateFreeform({ source, cv, description, industry, ragContext }) {
  const groq = getGroq();
  if (!groq) throw new Error("AI not configured");
  const b64 = fs.readFileSync(source.path).toString("base64");
  const dataUrl = `data:${source.mime};base64,${b64}`;
  const meta = cv?.meta || { width: 1200, height: 1600 };
  const pageH = Math.round(CANVAS_W * (meta.height / Math.max(1, meta.width)));

  const messages = [
    { role: "system", content: freeformSysPrompt(pageH, ragContext) },
    {
      role: "user",
      content: [
        { type: "text", text: `Replicate this exact design as positioned elements.\nReal colours from the image (ground truth): ${JSON.stringify(cv?.palette || {})}\nUser note: ${description || "(none)"}` },
        { type: "image_url", image_url: { url: dataUrl } },
      ],
    },
  ];

  let obj = null, usedModel = null, lastErr;
  for (const model of VISION_MODELS) {
    try {
      const c = await groq.chat.completions.create({ model, temperature: 0.3, max_tokens: 5000, messages });
      const parsed = extractJson(c?.choices?.[0]?.message?.content || "");
      // A full-page replication needs real coverage — reject skeleton answers
      // so the catalog path takes over instead of shipping a broken shell.
      if (Array.isArray(parsed.elements) && parsed.elements.length >= 8) { obj = parsed; usedModel = model; break; }
    } catch (err) { lastErr = err; }
  }
  if (!obj) throw lastErr || new Error("Freeform replication returned too few elements.");

  let elements = obj.elements.slice(0, 40).map((e, i) => toCanvasElement(e, pageH, i));
  const industryOut = typeof obj.industry === "string" ? obj.industry : industry;

  // Resolve a premium, coherent token set (curated font pairing + cohesive palette)
  // from the model's read + the CV-extracted colours, then snap every element onto it.
  const T = resolvePremiumTokens({
    tokens: sanitizeTokens(obj.tokens),
    palette: { ...(cv?.palette || {}), bg: obj.page?.bg || cv?.palette?.bg, dark: obj.page?.dark },
    industry: industryOut,
  });

  // Images: per user preference we do NOT reuse the reference's pixels. A photo
  // region becomes a tasteful themed stock image; everything else stays a clean
  // surface.
  for (const e of elements) {
    if (e._box.isImage || ["image", "logo", "avatar"].includes(e.type)) {
      e.type = "image";
      e.src = stockUrl(industryOut);
    }
  }
  elements.forEach((e) => delete e._box);

  elements = validateGeometry(polishElements(elements, T));

  const page = { bg: T.bg, dark: T.dark };
  const tokens = { head: T.head, body: T.body, accent: T.accent, accent2: T.accent2, bg: T.bg, text: T.text, muted: T.muted, dark: T.dark };
  const sections = [...new Set(elements.map((e) => e.type))];
  return { industry: industryOut, elements, page, tokens, sections, model: usedModel };
}

// ── POST /api/reference/analyze ───────────────────────────────────────────────
export const analyzeReference = async (req, res) => {
  const tempPath = req.file?.path;
  let cvResizedPath = null;
  try {
    const mode = (req.body?.mode || (tempPath ? "image" : "text")).toString();
    const description = (req.body?.description || "").toString().slice(0, 2000);

    if (mode === "url" || mode === "html") {
      return res.status(501).json({
        message: "URL and code import are coming soon. For now, upload a screenshot of the design or describe it in words.",
      });
    }
    if (mode !== "image" && mode !== "text") {
      return res.status(400).json({ message: `Unknown mode "${mode}". Use "text" or "image".` });
    }

    // 1. CV facts (image mode only) — BEST EFFORT. A missing Python runtime or
    //    missing pillow/numpy must never kill image mode: we degrade to
    //    vision-only using the original upload.
    let cv = null;
    let cvWarning = null;
    if (mode === "image") {
      if (!tempPath) return res.status(400).json({ message: "No image uploaded." });
      try {
        const out = await runPython(tempPath);
        if (out?.error) {
          cvWarning = out.error;
          console.warn("⚠ design_extractor degraded:", out.error);
        } else {
          cv = out;
          cvResizedPath = cv?.resized || null;
        }
      } catch (err) {
        cvWarning = err.message;
        console.warn("⚠ design_extractor unavailable, continuing vision-only:", err.message);
      }
    } else if (!description.trim()) {
      return res.status(400).json({ message: "Describe the design you want, or upload a screenshot." });
    }

    // 2. Industry (trained classifier with regex fallback — never throws and
    //    never blocks text mode on Python) + token base + retrieved design rules.
    const brief = description.trim();
    const industry = brief ? await classifyIndustry(brief) : detectIndustry("");
    const cvTokens = tokensFromCV(cv);
    let ragContext = "";
    try {
      ragContext = buildDesignContext(
        `${brief || "landing page"} recreate reference layout sections spacing hierarchy palette typography`,
        { k: 4, industry }
      );
    } catch (err) {
      console.warn("⚠ RAG context unavailable:", err.message);
    }

    // 3. Build the page. Priority for a screenshot:
    //    (a) FREEFORM replication — model emits the real positioned elements.
    //    (b) catalog VISION — model picks our section templates (reliable).
    //    (c) text mapper (no Python, no image needed), then (d) structural default.
    let elements = null, industryOut = industry, tokensOut = cvTokens;
    let pageBg = cv?.palette?.bg || null, sectionsOut = [];
    let model = null, personalized = false, sawImage = false, replicated = false;

    const source = mode === "image" ? visionSource(cv, tempPath, req.file?.mimetype) : null;

    if (aiAvailable()) {
      // (a) Freeform replication (image mode only, needs a sendable image)
      if (source) {
        try {
          const r = await replicateFreeform({ source, cv, description, industry, ragContext });
          elements = r.elements;
          industryOut = r.industry;
          tokensOut = { ...r.tokens, ...cvTokens };
          pageBg = r.page.bg || pageBg;
          sectionsOut = r.sections;
          model = r.model;
          personalized = true; sawImage = true; replicated = true;
        } catch (err) {
          console.warn("⚠ freeform replication failed, trying catalog:", err.message);
        }
      }

      // (b/c) Catalog mapping (vision then text) if freeform didn't produce a page
      if (!elements) {
        let mapped = null;
        if (source) {
          try {
            mapped = await mapToSpecVision({ source, cv, description, industry, ragContext });
            sawImage = true;
          } catch (err) { console.warn("⚠ catalog vision failed:", err.message); }
        }
        if (!mapped) {
          try { mapped = await mapToSpec({ cv, description, industry, ragContext }); }
          catch (err) { console.warn("⚠ text mapping fell back:", err.message); }
        }
        if (mapped) {
          const spec = { industry: mapped.industry, tokens: { ...mapped.tokens, ...cvTokens }, sections: mapped.sections };
          elements = buildFromSpec(spec).map((el, i) => ({ ...el, id: freshId(i) }));
          industryOut = spec.industry; tokensOut = spec.tokens;
          sectionsOut = spec.sections.map((s) => s.type);
          model = mapped.model; personalized = true;
        }
      }
    }

    // (d) Structural default — never fail to return a page.
    if (!elements) {
      const spec = { industry, tokens: cvTokens, sections: DEFAULT_SECTIONS };
      elements = buildFromSpec(spec).map((el, i) => ({ ...el, id: freshId(i) }));
      sectionsOut = DEFAULT_SECTIONS.map((s) => s.type);
    }

    return res.json({
      mode,
      industry: industryOut,
      tokens: tokensOut,
      page: { bg: pageBg },
      palette: cv?.palette || null,
      sections: sectionsOut,
      personalized,
      sawImage,
      replicated,
      model,
      warning: cvWarning || undefined,
      elements,
      count: elements.length,
    });
  } catch (err) {
    console.error("❌ reference analyze error:", err.message);
    const status = Number.isInteger(err.statusCode) ? err.statusCode : 500;
    return res.status(status).json({ message: err.message || "Reference analysis failed. Please try again." });
  } finally {
    if (tempPath) { try { fs.unlinkSync(tempPath); } catch (_) {} }
    // The downscaled JPEG the Python step wrote for the vision model.
    if (cvResizedPath) { try { fs.unlinkSync(cvResizedPath); } catch (_) {} }
  }
};
