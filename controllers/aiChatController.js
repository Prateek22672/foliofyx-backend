// server/controllers/aiChatController.js
// ─────────────────────────────────────────────────────────────────────────────
// AI Chat Builder — conversational website creation ("chat = create website").
//
// One endpoint, three intents:
//   create — no site yet (or user asks for a new one): run the proven
//            template+RAG generation pipeline and return a full page.
//   edit   — site exists: the model sees a compact summary of the current
//            canvas and returns a JSON list of operations (update/add/remove)
//            which we validate and apply server-side, so a sloppy model can
//            never corrupt the canvas.
//   chat   — design questions/advice, answered with RAG design knowledge.
//
// The chat never mutates the DB — the client owns persistence through the
// existing /api/custom-websites auto-save, so an AI mistake is always undoable.
// ─────────────────────────────────────────────────────────────────────────────

import {
  aiAvailable,
  callGroq,
  parseObject,
  generatePageElements,
} from "./aiBuilderController.js";
import { buildDesignContext, classifyIndustry } from "../rag/retriever.js";

const CHAT_MODELS = [
  { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", maxOut: 4000 },
  { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B", maxOut: 4000 },
];

// Element types the editor's CanvasElementRenderer knows how to paint.
const ALLOWED_TYPES = new Set([
  "heading", "subheading", "paragraph", "label", "button", "quote", "list",
  "feature", "service", "stats", "testimonial", "pricing", "property", "team",
  "faq", "timeline", "cta", "logostrip", "navbar", "image", "video", "shape",
  "divider", "spacer", "icon", "badge", "card", "box", "form", "input", "map",
  "social",
]);

// Style keys that exist on the CustomWebsite StyleSchema — anything else is dropped.
const STYLE_KEYS = new Set([
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "color", "textAlign",
  "lineHeight", "letterSpacing", "textTransform", "textShadow", "bgColor",
  "bgType", "bgImage", "bgSize", "gradientFrom", "gradientTo", "gradientDir",
  "borderRadius", "borderWidth", "borderStyle", "borderColor", "padding",
  "boxShadow", "opacity", "objectFit", "objectPosition", "overflow",
  "backdropBlur", "filter", "mixBlendMode", "cursor", "rotate", "hoverEffect",
]);

const CANVAS_W = 1200;
const MAX_OPS = 40;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));
const freshId = (i) => `el_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;

// ── Intent routing ────────────────────────────────────────────────────────────
function routeIntent(text, hasElements) {
  const t = text.toLowerCase();
  const wantsNew = /(create|build|make|generate|start|design)\b.{0,40}\b(website|site|page|portfolio|store|shop|landing)/.test(t) ||
                   /^(new site|start over|from scratch)/.test(t);
  const isQuestion = /^(what|why|how|which|should|can you explain|advice|suggest)\b/.test(t) && !wantsNew;
  if (!hasElements) return isQuestion ? "chat" : "create";
  if (wantsNew && /(new|another|different|start over|from scratch|replace)/.test(t)) return "create";
  if (isQuestion) return "chat";
  return "edit";
}

// ── Compact canvas summary the model can reason about cheaply ────────────────
function summarizeElements(elements = []) {
  return elements.slice(0, 90).map((el) => ({
    id: el.id,
    type: el.type,
    x: el.x, y: el.y, w: el.width, h: el.height,
    content: typeof el.content === "string" ? el.content.slice(0, 90) : "",
    ...(el.src ? { src: String(el.src).slice(0, 60) } : {}),
    s: {
      ...(el.styles?.fontSize ? { fontSize: el.styles.fontSize } : {}),
      ...(el.styles?.color ? { color: el.styles.color } : {}),
      ...(el.styles?.bgColor ? { bgColor: el.styles.bgColor } : {}),
      ...(el.styles?.fontFamily ? { fontFamily: el.styles.fontFamily } : {}),
    },
  }));
}

// ── Op validation & application ───────────────────────────────────────────────
function sanitizeStyles(styles = {}) {
  const out = {};
  for (const [k, v] of Object.entries(styles)) {
    if (STYLE_KEYS.has(k) && (typeof v === "string" || typeof v === "number")) out[k] = v;
  }
  return out;
}

function applyOps(elements, ops) {
  const byId = new Map(elements.map((el) => [el.id, el]));
  let applied = 0;
  const notes = [];

  for (const op of (Array.isArray(ops) ? ops : []).slice(0, MAX_OPS)) {
    try {
      if (op.op === "update" && byId.has(op.id)) {
        const el = byId.get(op.id);
        const set = op.set || {};
        if (typeof set.content === "string") el.content = set.content.slice(0, 2000);
        if (typeof set.src === "string") el.src = set.src.slice(0, 500);
        if (typeof set.href === "string") el.href = set.href.slice(0, 500);
        if (set.x !== undefined) el.x = clamp(set.x, 0, CANVAS_W - 20);
        if (set.y !== undefined) el.y = clamp(set.y, 0, 40000);
        if (set.width !== undefined) el.width = clamp(set.width, 20, CANVAS_W);
        if (set.height !== undefined && set.height !== "auto") el.height = clamp(set.height, 10, 8000);
        if (set.styles) el.styles = { ...(el.styles || {}), ...sanitizeStyles(set.styles) };
        applied++;
      } else if (op.op === "add" && op.element && ALLOWED_TYPES.has(op.element.type)) {
        const e = op.element;
        const el = {
          id: freshId(applied),
          type: e.type,
          x: clamp(e.x ?? 80, 0, CANVAS_W - 20),
          y: clamp(e.y ?? 0, 0, 40000),
          width: clamp(e.width ?? 400, 20, CANVAS_W),
          height: e.height === "auto" || e.height === undefined ? "auto" : clamp(e.height, 10, 8000),
          zIndex: clamp(e.zIndex ?? 1, 0, 999),
          content: typeof e.content === "string" ? e.content.slice(0, 2000) : "",
          src: typeof e.src === "string" ? e.src.slice(0, 500) : "",
          href: typeof e.href === "string" ? e.href.slice(0, 500) : "",
          animation: typeof e.animation === "string" ? e.animation : "none",
          styles: sanitizeStyles(e.styles || {}),
          visible: true,
          locked: false,
        };
        byId.set(el.id, el);
        elements.push(el);
        applied++;
      } else if (op.op === "remove" && byId.has(op.id)) {
        const idx = elements.findIndex((el) => el.id === op.id);
        if (idx !== -1) elements.splice(idx, 1);
        byId.delete(op.id);
        applied++;
      } else {
        notes.push(`skipped op: ${op.op || "?"}`);
      }
    } catch (e) {
      notes.push(`bad op: ${e.message}`);
    }
  }
  return { elements, applied, notes };
}

// ── Edit intent: LLM proposes ops, we apply them safely ──────────────────────
async function editWithAI(instruction, history, page, industry) {
  const ragContext = buildDesignContext(instruction, { k: 3, industry });
  const summary = summarizeElements(page.elements);

  const sys = `You are an expert web designer operating a canvas website editor. The canvas is ${CANVAS_W}px wide; elements are absolutely positioned (x from left, y from top, in px). You receive the current elements and an instruction. Respond with ONLY a JSON object:
{"reply": "one short friendly sentence describing what you changed",
 "ops": [
   {"op":"update","id":"<existing id>","set":{"content"?, "x"?, "y"?, "width"?, "height"?, "src"?, "href"?, "styles"?:{...}}},
   {"op":"add","element":{"type":"<one of: ${[...ALLOWED_TYPES].join(", ")}>","x","y","width","height","content","styles":{...}}},
   {"op":"remove","id":"<existing id>"}
 ]}

RULES:
- Keep the existing design language (fonts, colors, spacing) unless asked to change it.
- Multi-part elements use "|" separators in content (feature = "title|description|emoji", testimonial = "quote|name|role", stats = "number|label", pricing = "plan|price|period|description|feature|feature"). NEVER change the number of "|" segments on update.
- Never overlap elements: leave at least 16px between them; y grows downward.
- Style keys allowed: ${[...STYLE_KEYS].join(", ")}. Colors are hex strings, fontSize is a number.
- Prefer few precise ops over many. Max ${MAX_OPS} ops.

${ragContext}`;

  const messages = [
    { role: "system", content: sys },
    ...history.slice(-6).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 1200) })),
    { role: "user", content: `CURRENT ELEMENTS:\n${JSON.stringify(summary)}\n\nINSTRUCTION: ${instruction}` },
  ];

  const { text, model } = await callGroq(messages, 4000, CHAT_MODELS, {
    temperature: 0.35,
    responseFormat: { type: "json_object" },
  });
  const parsed = parseObject(text);
  const { elements, applied, notes } = applyOps([...page.elements.map((e) => (e.toObject ? e.toObject() : { ...e, styles: { ...(e.styles || {}) } }))], parsed.ops);
  return {
    reply: typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : `Done — applied ${applied} change${applied === 1 ? "" : "s"}.`,
    elements,
    applied,
    notes,
    model,
  };
}

// ── Chat intent: grounded design advice ───────────────────────────────────────
async function adviseWithAI(instruction, history, industry) {
  const ragContext = buildDesignContext(instruction, { k: 3, industry });
  const { text, model } = await callGroq(
    [
      {
        role: "system",
        content: `You are FYX, the AI design partner inside a website builder. Answer briefly (2-5 sentences), concretely and warmly. When useful, suggest what the user could ask you to build or change next.\n\n${ragContext}`,
      },
      ...history.slice(-8).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 1200) })),
      { role: "user", content: instruction },
    ],
    900,
    CHAT_MODELS,
    { temperature: 0.6 }
  );
  return { reply: text.trim(), model };
}

// ── POST /api/ai-chat/message ─────────────────────────────────────────────────
export async function chatMessage(req, res) {
  try {
    const { messages = [], site = null, mode = null } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ message: "messages[] is required." });
    }
    const last = [...messages].reverse().find((m) => m.role === "user");
    const instruction = (last?.content || "").toString().trim().slice(0, 3000);
    if (!instruction) return res.status(400).json({ message: "No user message found." });

    const activePage =
      site?.pages?.find((p) => p.id === site.activePage) || site?.pages?.[0] || null;
    const hasElements = !!activePage?.elements?.length;

    const intent = ["create", "edit", "chat"].includes(mode)
      ? mode
      : routeIntent(instruction, hasElements);

    // CREATE — full page through the guarded template+RAG pipeline.
    if (intent === "create") {
      const brief = messages
        .filter((m) => m.role === "user")
        .map((m) => String(m.content))
        .join(" — ")
        .slice(0, 1800);
      const { industry, model, personalized, elements } = await generatePageElements(brief || instruction);
      const sections = new Set(elements.map((e) => e.type)).size;
      return res.json({
        intent,
        industry,
        model,
        personalized,
        elements,
        reply:
          `I designed a ${industry === "general" ? "" : industry + " "}website draft with ` +
          `${elements.length} elements across ${sections} block types. ` +
          `Tell me anything to change — colors, copy, sections, layout — or say "publish" when it feels right.`,
      });
    }

    if (!aiAvailable()) {
      return res.status(503).json({ message: "AI is not configured on the server." });
    }

    const industry = await classifyIndustry(instruction + " " + (site?.industry || ""));

    // EDIT — validated ops on the active page.
    if (intent === "edit" && activePage) {
      const { reply, elements, applied, model } = await editWithAI(
        instruction, messages.slice(0, -1), activePage, industry
      );
      return res.json({ intent, reply, elements, applied, model, pageId: activePage.id });
    }

    // CHAT — grounded advice.
    const { reply, model } = await adviseWithAI(instruction, messages.slice(0, -1), industry);
    return res.json({ intent: "chat", reply, model });
  } catch (err) {
    console.error("❌ AI chat error:", err.message);
    return res.status(err.statusCode || 500).json({ message: err.message || "AI chat failed." });
  }
}
