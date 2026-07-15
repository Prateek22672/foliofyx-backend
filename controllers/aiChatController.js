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
  const t = text.toLowerCase().trim();
  const greeting = /^(hi+|hello|hey+|yo|thanks?|thank you|good (morning|afternoon|evening))[!,. ]*$/.test(t);
  const wantsNew =
    /(create|build|make|generate|start|design|redo|rebuild)\b.{0,40}\b(website|site|page|portfolio|store|shop|landing)/.test(t) ||
    /^(new site|start over|from scratch)/.test(t);
  const isQuestion =
    /^(what|why|how|which|should|would|is it|are there|do you|can you (explain|recommend|suggest)|advice|suggest|recommend)\b/.test(t) &&
    !wantsNew;
  // Concrete edit language ("change the hero", "warmer palette", "shorter headline")
  // beats question phrasing when a canvas exists.
  const editVerb =
    /\b(change|update|edit|set|move|resize|rename|rewrite|reword|shorten|shorter|longer|bigger|smaller|larger|swap|replace|delete|remove|add|insert|align|center|centre|darker|lighter|warmer|cooler|bolder|palette|colou?rs?|font|headline|heading|title|hero|button|cta|image|photo|section|footer|navbar|menu|testimonial|pricing|stat|spacing|background)\b/.test(t);

  if (!hasElements) return greeting || isQuestion ? "chat" : "create";
  if (wantsNew && /(new|another|different|start over|from scratch|replace|redo|rebuild)/.test(t)) return "create";
  if (greeting) return "chat";
  if (editVerb) return "edit";
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

// Pre-validate model ops against the real canvas: unknown ids/types/op names
// are dropped with a reason instead of silently mangling (or 500-ing) anything.
function validateOps(rawOps, elements) {
  const knownIds = new Set(elements.map((e) => e.id));
  const ops = [];
  const rejected = [];
  for (const op of (Array.isArray(rawOps) ? rawOps : []).slice(0, MAX_OPS)) {
    if (!op || typeof op !== "object") {
      rejected.push("a malformed op");
    } else if (op.op === "update" || op.op === "remove") {
      if (knownIds.has(op.id)) ops.push(op);
      else rejected.push(`${op.op} on unknown element "${String(op.id).slice(0, 30)}"`);
    } else if (op.op === "add") {
      if (op.element && ALLOWED_TYPES.has(op.element.type)) ops.push(op);
      else rejected.push(`add with unsupported type "${String(op.element?.type).slice(0, 30)}"`);
    } else {
      rejected.push(`unknown op "${String(op.op).slice(0, 20)}"`);
    }
  }
  return { ops, rejected };
}

// ── Edit intent: LLM proposes ops, we validate and apply them safely ─────────
async function editWithAI(instruction, history, page, industry) {
  const ragContext = buildDesignContext(instruction, { k: 4, industry });
  const summary = summarizeElements(page.elements);

  const sys = `You are an expert web designer operating a canvas website editor. The canvas is ${CANVAS_W}px wide; elements are absolutely positioned (x from left, y from top, in px). Full-width "section" elements are background bands sitting behind the content (zIndex 1); foreground content sits on top of them. You receive the current elements and an instruction. Respond with ONLY a JSON object:
{"reply": "one short friendly sentence describing what you changed",
 "ops": [
   {"op":"update","id":"<existing id>","set":{"content"?, "x"?, "y"?, "width"?, "height"?, "src"?, "href"?, "styles"?:{...}}},
   {"op":"add","element":{"type":"<one of: ${[...ALLOWED_TYPES].join(", ")}>","x","y","width","height","content","styles":{...}}},
   {"op":"remove","id":"<existing id>"}
 ]}

RULES:
- Use ONLY ids that exist in CURRENT ELEMENTS. Never invent ids.
- Keep the existing design language (fonts, colors, spacing) unless asked to change it.
- Palette/color changes must stay coherent: update the section band bgColors AND keep every text color readable against its band (light text on dark bands, dark text on light bands). Update buttons/gradients to match.
- Copy quality: headlines 8 words max, specific and benefit-led. Never write filler like "Welcome to our website". No emojis in any copy.
- Multi-part elements use "|" separators in content (feature = "title|description|icon", testimonial = "quote|name|role", stats = "number|label", pricing = "plan|price|period|description|feature|feature"). NEVER change the number of "|" segments on update.
- Never overlap foreground elements: leave at least 16px between them; y grows downward. Background "section" bands may sit behind content.
- Style keys allowed: ${[...STYLE_KEYS].join(", ")}. Colors are hex strings, fontSize is a number.
- Prefer few precise ops over many. Max ${MAX_OPS} ops. If the request cannot be done with these ops, return {"reply":"<explain briefly>","ops":[]}.

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
  const { ops, rejected } = validateOps(parsed.ops, page.elements);

  // Nothing valid to do — answer honestly and conversationally instead of
  // failing (and never echo a model reply that claims a change happened).
  if (!ops.length) {
    return {
      reply:
        "I didn't change anything — I couldn't map that request onto the elements currently on the canvas. " +
        "Try pointing me at a section, for example: \"make the hero headline shorter\" or \"change the pricing card colors\".",
      elements: null,
      applied: 0,
      notes: rejected,
      model,
    };
  }

  const { elements, applied, notes } = applyOps(
    [...page.elements.map((e) => (e.toObject ? e.toObject() : { ...e, styles: { ...(e.styles || {}) } }))],
    ops
  );
  return {
    reply: typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : `Done — applied ${applied} change${applied === 1 ? "" : "s"}.`,
    elements,
    applied,
    notes: [...rejected, ...notes],
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

    // EDIT — validated ops on the active page. Invalid/unmappable model output
    // degrades to a helpful chat reply (never a 500, never a corrupted canvas).
    if (intent === "edit" && activePage) {
      const { reply, elements, applied, model, notes } = await editWithAI(
        instruction, messages.slice(0, -1), activePage, industry
      );
      if (!applied || !elements) {
        return res.json({ intent: "chat", reply, applied: 0, model, notes, pageId: activePage.id });
      }
      return res.json({ intent, reply, elements, applied, model, notes, pageId: activePage.id });
    }

    // CHAT — grounded advice.
    const { reply, model } = await adviseWithAI(instruction, messages.slice(0, -1), industry);
    return res.json({ intent: "chat", reply, model });
  } catch (err) {
    console.error("❌ AI chat error:", err.message);
    return res.status(err.statusCode || 500).json({ message: err.message || "AI chat failed." });
  }
}
