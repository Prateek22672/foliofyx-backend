// server/controllers/referenceController.js
// ─────────────────────────────────────────────────────────────────────────────
// "Design from Reference" — rebuild a page's *structure* from a reference.
//
// Modes:
//   text  → describe a site in words            (no CV step)
//   image → upload a screenshot                 (Python CV: palette + layout bands)
//   url   → paste a live URL    (Phase 2: needs Playwright — returns 501 for now)
//   html  → upload code/zip     (Phase 2: needs Playwright — returns 501 for now)
//
// Pipeline (image/text): CV facts + brief → Groq maps to an ORDERED list of our
// section types + design tokens + copy → buildFromSpec() materializes renderable
// elements. The LLM never emits coordinates, so output is always valid. If Groq
// is unavailable we still return a palette-matched structural layout.
//
// IP-safe by design: we copy layout + colours only — never the reference's logos,
// photos, or text. Copy is generic/structural.
// ─────────────────────────────────────────────────────────────────────────────

import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { fileURLToPath } from "url";

import { buildFromSpec, SECTION_CATALOG, REFERENCE_SECTION_TYPES } from "../data/pageTemplates.js";
import { detectIndustry, aiAvailable, callGroq, parseObject, getGroq } from "./aiBuilderController.js";
import {
  describePremiumGuide, resolvePremiumTokens, polishElements, stockUrl, PREMIUM_FONTS,
} from "../data/designSystem.js";

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
// can point at the interpreter that actually has numpy/pillow installed. Falls
// back to the platform default, matching the resume parser.
const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");

// ── Python CV step (same spawn pattern as resumeParserController) ──────────────
function runPython(filePath) {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const proc = spawn(PYTHON_BIN, [PYTHON_SCRIPT, filePath]);
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("close", () => {
      if (stderr) console.warn("[design_extractor stderr]", stderr.substring(0, 400));
      if (!stdout.trim()) return reject(new Error("Image analysis produced no output."));
      try {
        resolve(JSON.parse(stdout.trim()));
      } catch {
        reject(new Error("Image analysis returned invalid JSON."));
      }
    });
    proc.on("error", (err) =>
      reject(new Error(err.code === "ENOENT" ? "Python not found on server." : "Analysis error: " + err.message))
    );
  });
}

// (stockUrl + premium palette/polish come from ../data/designSystem.js)
// (image_cropper.py remains available but reference output uses stock/plain images by design.)

// ── Turn the CV palette into our token shape (colours we're confident about) ──
function tokensFromCV(cv) {
  const p = cv?.palette || {};
  const t = {};
  if (p.bg) t.bg = p.bg;
  if (p.text) t.text = p.text;
  if (p.accent) { t.accent = p.accent; t.accent2 = p.accent; }
  if (p.muted) t.muted = p.muted;
  if (typeof p.dark === "boolean") t.dark = p.dark;
  return t;
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

// ── Shared system prompt for both the text and vision mappers ────────────────
function buildSysPrompt(seesImage) {
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
- 6–9 sections is ideal. A hero is required.`;
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

// ── VISION path: the model actually SEES the screenshot (best quality) ────────
async function mapToSpecVision({ imagePath, mimeType = "image/jpeg", cv, description, industry }) {
  const groq = getGroq();
  if (!groq) throw new Error("AI not configured");
  const b64 = fs.readFileSync(imagePath).toString("base64");
  const dataUrl = `data:${mimeType};base64,${b64}`;

  const messages = [
    { role: "system", content: buildSysPrompt(true) },
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
      const obj = parseObject(c?.choices?.[0]?.message?.content || "");
      const sections = Array.isArray(obj.sections) ? obj.sections.filter((s) => s && REFERENCE_SECTION_TYPES.includes(s.type)) : [];
      if (sections.length) return { ...specFromObj(obj, industry), model };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error("Vision mapping failed.");
}

// ── TEXT path: no image (Describe mode), or vision fallback ──────────────────
async function mapToSpec({ cv, description, industry }) {
  const facts = cv
    ? `EXTRACTED PALETTE: ${JSON.stringify(cv.palette)}\nDETECTED LAYOUT BANDS (top→bottom, fractions of page height): ${JSON.stringify(cv.regions)}`
    : "No screenshot was provided — design a sensible layout from the description alone.";
  const user = `BRIEF: ${description || "(none — infer a fitting design)"}\nDETECTED INDUSTRY GUESS: ${industry}\n${facts}`;

  const { text, model } = await callGroq([
    { role: "system", content: buildSysPrompt(false) },
    { role: "user", content: user },
  ], 3800, TEXT_MODELS);

  return { ...specFromObj(parseObject(text), industry), model };
}

const freshId = (i) => `el_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;

// ─────────────────────────────────────────────────────────────────────────────
// ── FREEFORM REPLICATION ──────────────────────────────────────────────────────
// The vision model emits the ACTUAL positioned elements it sees (each heading,
// button, image at its real spot) instead of picking from the section catalog.
// This is what makes the result look like the uploaded design. Coordinates come
// back as fractions of the image and we scale them onto our 1200px canvas.
// ─────────────────────────────────────────────────────────────────────────────

const CANVAS_W = 1200;

// Element types the freeform model may use (all renderable by CanvasElementRenderer).
const FREEFORM_TYPES = new Set([
  "heading", "subheading", "paragraph", "label", "quote", "button",
  "image", "logo", "avatar", "icon", "section", "divider", "navbar", "footer",
]);

const clamp01 = (v) => (typeof v === "number" && isFinite(v) ? Math.max(0, Math.min(1, v)) : null);
const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);

function freeformSysPrompt() {
  return `You are a pixel-accurate web design replicator. You are shown a screenshot of a website. Reproduce it as a flat list of absolutely-positioned canvas elements that recreate what you SEE — same layout, same reading order, same colours and fonts.

Return ONLY JSON (no markdown):
{
  "industry": "saas|marketing|realestate|restaurant|portfolio|ecommerce|law|hotel|general",
  "page": { "bg": "<page background hex>", "dark": <bool> },
  "tokens": { "head": "<Google font matching the headlines>", "body": "<Google font>" },
  "elements": [
    {
      "type": "navbar|heading|subheading|paragraph|label|quote|button|image|logo|icon|section|divider|footer",
      "fx": <left as fraction 0..1 of width>, "fy": <top as fraction 0..1 of height>,
      "fw": <width fraction 0..1>, "fh": <height fraction 0..1>,
      "content": "<the visible text; for images leave empty>",
      "isImage": <true ONLY for photo/image regions>,
      "styles": { "color":"#hex", "bgColor":"#hex or transparent", "fontSize":<px on a 1200-wide canvas>, "fontWeight":"400-900", "textAlign":"left|center|right", "fontFamily":"<Google font>", "borderRadius":<px>, "bgType":"solid|gradient|transparent", "gradientFrom":"#hex", "gradientTo":"#hex" }
    }
  ]
}

RULES:
- Recreate EVERY visible text block and image as its own element, in the positions you see. 8–24 elements is typical.
- fx/fy/fw/fh are fractions of the screenshot (0..1). Be as accurate as you can about position and size.
- For any photo/illustration/hero image, set "type":"image" and "isImage":true with its bounding box — we will crop the real pixels.
- Put a big background block (type:"section", full width, the hero's bg colour/gradient) BEHIND overlapping hero text when the design has one. Order elements back-to-front (backgrounds first).
- Use the EXACT text you can read. Match colours to what you see. Match fonts (serif headline → 'Playfair Display'; bold modern → 'Syne'/'Space Grotesk'; condensed → 'Oswald').
- fontSize is in px assuming a 1200px-wide canvas (a big hero headline is ~60–90).
- Never invent placeholder text like "Heading"/"Your text here". If you truly can't read it, summarise what's there.`;
}

// Convert one model element (fractions) → a canvas element (px on 1200 canvas).
function toCanvasElement(raw, scaleY, idx) {
  let type = String(raw.type || "paragraph").toLowerCase();
  if (raw.isImage === true && !["image", "logo", "avatar"].includes(type)) type = "image";
  if (!FREEFORM_TYPES.has(type)) type = "paragraph";

  const fx = clamp01(raw.fx) ?? 0;
  const fy = clamp01(raw.fy) ?? 0;
  const fw = clamp01(raw.fw) ?? 0.3;
  const fh = clamp01(raw.fh) ?? 0.05;

  const x = Math.round(fx * CANVAS_W);
  const y = Math.round(fy * scaleY);
  const width = Math.max(20, Math.round(fw * CANVAS_W));
  const isText = ["heading", "subheading", "paragraph", "label", "quote", "button"].includes(type);
  const heightPx = Math.max(isText ? 24 : 40, Math.round(fh * scaleY));

  const s = raw.styles || {};
  const styles = {
    color: typeof s.color === "string" ? s.color : undefined,
    bgColor: typeof s.bgColor === "string" ? s.bgColor : undefined,
    fontSize: num(s.fontSize, undefined),
    fontWeight: s.fontWeight ? String(s.fontWeight) : undefined,
    textAlign: ["left", "center", "right"].includes(s.textAlign) ? s.textAlign : undefined,
    fontFamily: typeof s.fontFamily === "string" ? s.fontFamily : undefined,
    borderRadius: num(s.borderRadius, undefined),
    lineHeight: num(s.lineHeight, isText ? 1.2 : undefined),
    bgType: ["solid", "gradient", "transparent"].includes(s.bgType) ? s.bgType : undefined,
    gradientFrom: typeof s.gradientFrom === "string" ? s.gradientFrom : undefined,
    gradientTo: typeof s.gradientTo === "string" ? s.gradientTo : undefined,
    objectFit: type === "image" ? "cover" : undefined,
  };
  Object.keys(styles).forEach((k) => styles[k] === undefined && delete styles[k]);

  return {
    id: freshId(idx),
    type,
    x: Math.max(0, x),
    y: Math.max(0, y),
    width: Math.min(width, CANVAS_W),
    height: type === "section" || type === "image" ? heightPx : (isText ? "auto" : heightPx),
    zIndex: type === "section" ? 1 : 2,
    visible: true,
    locked: false,
    content: typeof raw.content === "string" ? raw.content : "",
    src: "",
    styles,
    _box: { fx, fy, fw, fh, isImage: type === "image" || raw.isImage === true },
  };
}

// Full freeform replication: vision → positioned elements → crop real images.
async function replicateFreeform({ imagePath, mimeType, cv, description, industry, originalPath }) {
  const groq = getGroq();
  if (!groq) throw new Error("AI not configured");
  const b64 = fs.readFileSync(imagePath).toString("base64");
  const dataUrl = `data:${mimeType};base64,${b64}`;
  const meta = cv?.meta || { width: 1200, height: 1600 };
  const scaleY = Math.round(CANVAS_W * (meta.height / Math.max(1, meta.width)));

  const messages = [
    { role: "system", content: freeformSysPrompt() },
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
      const parsed = parseObject(c?.choices?.[0]?.message?.content || "");
      if (Array.isArray(parsed.elements) && parsed.elements.length >= 4) { obj = parsed; usedModel = model; break; }
    } catch (err) { lastErr = err; }
  }
  if (!obj) throw lastErr || new Error("Freeform replication returned too few elements.");

  let elements = obj.elements.slice(0, 30).map((e, i) => toCanvasElement(e, scaleY, i));
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
  // surface. (image_cropper.py is left in place but unused here.)
  for (const e of elements) {
    if (e._box.isImage || ["image", "logo", "avatar"].includes(e.type)) {
      e.type = "image";
      e.src = stockUrl(industryOut);
    }
  }
  elements.forEach((e) => delete e._box);

  elements = polishElements(elements, T);

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

    // 1. CV facts (image mode only)
    let cv = null;
    if (mode === "image") {
      if (!tempPath) return res.status(400).json({ message: "No image uploaded." });
      cv = await runPython(tempPath);
      if (cv?.error) return res.status(422).json({ message: "Could not analyze image: " + cv.error });
      cvResizedPath = cv?.resized || null;
    } else if (!description.trim()) {
      return res.status(400).json({ message: "Describe the design you want, or upload a screenshot." });
    }

    // 2. Industry + token base
    const industry = detectIndustry(description || "");
    const cvTokens = tokensFromCV(cv);

    // 3. Build the page. Priority for a screenshot:
    //    (a) FREEFORM replication — model emits the real positioned elements
    //        (looks like the upload, crops real images). Best quality.
    //    (b) catalog VISION — model picks our section templates (reliable).
    //    (c) text mapper, then (d) structural default.
    let elements = null, industryOut = industry, tokensOut = cvTokens;
    let pageBg = cv?.palette?.bg || null, sectionsOut = [];
    let model = null, personalized = false, sawImage = false, replicated = false;

    if (aiAvailable()) {
      // (a) Freeform replication (image mode only)
      if (mode === "image" && cv?.resized) {
        try {
          const r = await replicateFreeform({
            imagePath: cv.resized, mimeType: "image/jpeg", cv, description, industry, originalPath: tempPath,
          });
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
        if (mode === "image" && cv?.resized) {
          try {
            mapped = await mapToSpecVision({ imagePath: cv.resized, mimeType: "image/jpeg", cv, description, industry });
            sawImage = true;
          } catch (err) { console.warn("⚠ catalog vision failed:", err.message); }
        }
        if (!mapped) {
          try { mapped = await mapToSpec({ cv, description, industry }); }
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
      elements,
      count: elements.length,
    });
  } catch (err) {
    console.error("❌ reference analyze error:", err.message);
    return res.status(err.statusCode || 500).json({ message: err.message || "Reference analysis failed." });
  } finally {
    if (tempPath) { try { fs.unlinkSync(tempPath); } catch (_) {} }
    // The downscaled JPEG the Python step wrote for the vision model.
    if (cvResizedPath) { try { fs.unlinkSync(cvResizedPath); } catch (_) {} }
  }
};
