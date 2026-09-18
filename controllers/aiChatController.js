// server/controllers/aiChatController.js
// ─────────────────────────────────────────────────────────────────────────────
// AI Chat Builder — conversational website creation ("chat = create website").
//
// One endpoint, three intents:
//   create — build a full page through the FYX Site Engine (≤ 1 LLM call).
//   edit   — first try a deterministic quick edit (restyle, recolour, rename,
//            font, add section, new variation: 0 LLM calls); otherwise the
//            model returns JSON operations that are validated and applied
//            server-side, so a sloppy model can never corrupt the canvas.
//   chat   — design questions, answered with RAG design knowledge.
//
// The chat never writes to the DB; the client owns persistence.
// ─────────────────────────────────────────────────────────────────────────────

import { aiAvailable, callGroq, parseObject, generatePageElements, legacyIndustry } from "./aiBuilderController.js";
import { buildDesignContext } from "../rag/retriever.js";
import { parseIntent } from "../engine/index.js";
import { detectQuickEdit, applyQuickEdit } from "../engine/edits.js";
import { textModels } from "../lib/aiModels.js";
import { recordBuilder } from "../lib/monitor.js";

const CHAT_MODELS = textModels(6000);

// Exactly the element types CanvasElementRenderer paints.
const ALLOWED_TYPES = new Set([
  "heading", "subheading", "paragraph", "label", "button", "quote", "list",
  "feature", "service", "stats", "testimonial", "pricing", "property", "team",
  "faq", "timeline", "cta", "logostrip", "navbar", "footer", "section", "card",
  "container", "image", "video", "divider", "spacer", "icon", "form", "input",
  "social", "gallery", "tabs", "breadcrumb",
]);

// "|"-separated composite content — the segment count is a layout contract.
const MULTIPART = new Set(["feature", "service", "stats", "testimonial", "pricing", "property", "team", "faq", "timeline", "logostrip"]);

const STYLE_KEYS = new Set([
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "color", "textAlign",
  "lineHeight", "letterSpacing", "textTransform", "textShadow", "bgColor",
  "bgType", "bgImage", "bgSize", "gradientFrom", "gradientTo", "gradientDir",
  "borderRadius", "borderWidth", "borderStyle", "borderColor", "padding",
  "boxShadow", "opacity", "objectFit", "objectPosition", "overflow",
  "backdropBlur", "filter", "mixBlendMode", "cursor", "rotate", "hoverEffect",
]);
const NUMERIC_STYLE = new Set(["fontSize", "letterSpacing", "padding", "borderRadius", "borderWidth", "lineHeight", "opacity", "backdropBlur", "rotate"]);
const BG_TYPES = new Set(["solid", "gradient", "transparent", "image"]);

const CANVAS_W = 1200;
const MAX_OPS = 40;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number(n) || 0));
const freshId = (i) => `el_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 6)}`;
const segments = (s) => String(s ?? "").split("|").length;

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
  const editVerb =
    /\b(change|update|edit|set|move|resize|rename|rewrite|reword|shorten|shorter|longer|bigger|smaller|larger|swap|replace|delete|remove|add|insert|align|center|centre|dark|darker|light|lighter|warmer|cooler|bolder|palette|colou?rs?|accent|font|headline|heading|title|hero|button|cta|image|photo|section|footer|navbar|menu|testimonial|pricing|stat|spacing|background|style|theme|layout|design|look|shuffle|regenerate|another)\b/.test(t);

  if (!hasElements) return greeting || isQuestion ? "chat" : "create";
  if (wantsNew && /(new|another website|different website|start over|from scratch|replace|redo|rebuild)/.test(t) && !/\b(style|design|look|layout|theme)\b/.test(t)) return "create";
  if (greeting) return "chat";
  if (editVerb) return "edit";
  if (isQuestion) return "chat";
  return "edit";
}

// ── Compact canvas summary the model can reason about cheaply ────────────────
function summarizeElements(elements = []) {
  return elements.slice(0, 110).map((el) => {
    const s = el.styles || {};
    const pick = ["fontSize", "fontWeight", "fontFamily", "color", "bgColor", "bgType", "gradientFrom", "gradientTo", "textAlign", "borderRadius"];
    return {
      id: el.id,
      type: el.type,
      x: el.x, y: el.y, w: el.width, h: el.height,
      content: typeof el.content === "string" ? el.content.slice(0, MULTIPART.has(el.type) ? 240 : 160) : "",
      ...(el.src ? { src: String(el.src).slice(0, 80) } : {}),
      s: Object.fromEntries(pick.filter((k) => s[k] !== undefined && s[k] !== "").map((k) => [k, s[k]])),
    };
  });
}

// ── Op validation & application ───────────────────────────────────────────────
function sanitizeStyles(styles = {}) {
  const out = {};
  for (const [k, v] of Object.entries(styles || {})) {
    if (!STYLE_KEYS.has(k)) continue;
    if (NUMERIC_STYLE.has(k)) {
      const n = typeof v === "number" ? v : parseFloat(String(v));
      if (Number.isFinite(n)) out[k] = n;
    } else if (k === "bgType") {
      if (BG_TYPES.has(v)) out[k] = v;
    } else if (typeof v === "string" || typeof v === "number") {
      out[k] = String(v).slice(0, 300);
    }
  }
  return out;
}

const bottom = (e) => (Number(e.y) || 0) + (Number(e.height) || 0);

function applyOps(elements, ops) {
  const byId = new Map(elements.map((el) => [el.id, el]));
  let applied = 0;
  const notes = [];

  for (const op of ops.slice(0, MAX_OPS)) {
    try {
      if (op.op === "update" && byId.has(op.id)) {
        const el = byId.get(op.id);
        const set = op.set || {};
        if (typeof set.content === "string") {
          const next = set.content.slice(0, 2000);
          if (MULTIPART.has(el.type) && segments(next) !== segments(el.content)) {
            notes.push(`kept ${el.type} content (segment count changed)`);
          } else {
            el.content = next;
          }
        }
        if (typeof set.src === "string" && /^https?:\/\//.test(set.src)) el.src = set.src.slice(0, 500);
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
          x: clamp(e.x ?? 100, 0, CANVAS_W - 20),
          y: clamp(e.y ?? 0, 0, 40000),
          width: clamp(e.width ?? 400, 20, CANVAS_W),
          height: clamp(e.height ?? 60, 10, 8000),
          zIndex: clamp(e.zIndex ?? (e.type === "section" ? 1 : 2), 0, 999),
          content: typeof e.content === "string" ? e.content.slice(0, 2000) : "",
          src: typeof e.src === "string" && /^https?:\/\//.test(e.src) ? e.src.slice(0, 500) : "",
          href: typeof e.href === "string" ? e.href.slice(0, 500) : "",
          animation: "none",
          styles: sanitizeStyles(e.styles || {}),
          visible: true,
          locked: false,
        };
        // Make room: foreground blocks the new element would sit on top of move down.
        if (el.type !== "section") {
          const collides = elements.some((o) => o.type !== "section" && o.y < bottom(el) && bottom(o) > el.y && o.x < el.x + el.width && o.x + o.width > el.x);
          if (collides) {
            const push = el.height + 24;
            for (const o of elements) if (o.y >= el.y) o.y += push;
          }
        }
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

function validateOps(rawOps, elements) {
  const knownIds = new Set(elements.map((e) => e.id));
  const ops = [];
  const rejected = [];
  for (const op of (Array.isArray(rawOps) ? rawOps : []).slice(0, MAX_OPS)) {
    if (!op || typeof op !== "object") rejected.push("a malformed op");
    else if (op.op === "update" || op.op === "remove") {
      if (knownIds.has(op.id)) ops.push(op);
      else rejected.push(`${op.op} on unknown element "${String(op.id).slice(0, 30)}"`);
    } else if (op.op === "add") {
      if (op.element && ALLOWED_TYPES.has(op.element.type)) ops.push(op);
      else rejected.push(`add with unsupported type "${String(op.element?.type).slice(0, 30)}"`);
    } else rejected.push(`unknown op "${String(op.op).slice(0, 20)}"`);
  }
  return { ops, rejected };
}

// ── Edit intent: LLM proposes ops, we validate and apply them safely ─────────
async function editWithAI(instruction, history, page, industry) {
  const ragContext = buildDesignContext(instruction, { k: 3, industry });
  // Models mangle long random ids, so they see short aliases (e1, e2…) that
  // are mapped back to the real ids before validation.
  const aliasToId = new Map();
  const summary = summarizeElements(page.elements).map((s, i) => {
    const alias = `e${i + 1}`;
    aliasToId.set(alias, s.id);
    return { ...s, id: alias };
  });

  const sys = `You are an expert web designer operating a canvas website editor. The canvas is ${CANVAS_W}px wide; elements are absolutely positioned (x from left, y from top, px). Full-width "section" elements are background bands behind content (zIndex 1). You receive the current elements and an instruction. Respond with ONLY a JSON object:
{"reply": "one short friendly sentence describing what you changed",
 "ops": [
   {"op":"update","id":"<existing id>","set":{"content"?, "x"?, "y"?, "width"?, "height"?, "src"?, "href"?, "styles"?:{...}}},
   {"op":"add","element":{"type":"<one of: ${[...ALLOWED_TYPES].join(", ")}>","x","y","width","height","content","styles":{...}}},
   {"op":"remove","id":"<existing id>"}
 ]}

RULES:
- Use ONLY ids that exist in CURRENT ELEMENTS. Never invent ids.
- Keep the existing design language (fonts, colours, spacing) unless asked to change it.
- Colour changes must stay readable: light text on dark bands, dark text on light bands. Gradient elements use bgType "gradient" with gradientFrom/gradientTo; solid ones use bgType "solid" with bgColor.
- Copy: headlines 8 words max, specific and benefit-led. No filler, no emojis in copy.
- Composite elements use "|" separators (feature/service "title|description|icon", testimonial "quote|name|role", stats "number|label", pricing "plan|price|period|description|feature|...", property "name|price|details", team "name|title|bio", faq "question|answer", timeline "title|description|year"). NEVER change the number of "|" segments on update.
- Never overlap foreground elements: leave at least 16px between them.
- Style keys allowed: ${[...STYLE_KEYS].join(", ")}. Colours are hex strings; fontSize, padding, borderRadius, borderWidth, letterSpacing, lineHeight are numbers.
- Prefer few precise ops. Max ${MAX_OPS}. If impossible, return {"reply":"<explain briefly>","ops":[]}.

${ragContext}`;

  const messages = [
    { role: "system", content: sys },
    ...history.slice(-6).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 1200) })),
    { role: "user", content: `CURRENT ELEMENTS:\n${JSON.stringify(summary)}\n\nINSTRUCTION: ${instruction}` },
  ];

  const { text, model } = await callGroq(messages, 6000, CHAT_MODELS, { temperature: 0.3, responseFormat: { type: "json_object" } });
  const parsed = parseObject(text);
  const rawOps = (Array.isArray(parsed.ops) ? parsed.ops : []).map((op) =>
    op && typeof op === "object" && aliasToId.has(String(op.id)) ? { ...op, id: aliasToId.get(String(op.id)) } : op);
  const { ops, rejected } = validateOps(rawOps, page.elements);

  if (!ops.length) {
    return {
      reply:
        "I didn't change anything: I couldn't map that onto the current page. " +
        "Try pointing at a section, like \"make the hero headline shorter\" or \"change the pricing card colours\".",
      elements: null, applied: 0, notes: rejected, model,
    };
  }

  const { elements, applied, notes } = applyOps(
    page.elements.map((e) => (e.toObject ? e.toObject() : { ...e, styles: { ...(e.styles || {}) } })),
    ops
  );
  return {
    reply: typeof parsed.reply === "string" && parsed.reply.trim() ? parsed.reply.trim().slice(0, 400) : `Done: applied ${applied} change${applied === 1 ? "" : "s"}.`,
    elements, applied, notes: [...rejected, ...notes], model,
  };
}

async function adviseWithAI(instruction, history, industry) {
  const ragContext = buildDesignContext(instruction, { k: 3, industry });
  const { text, model } = await callGroq(
    [
      { role: "system", content: `You are FYX, the AI design partner inside a website builder. Answer briefly (2-5 sentences), concretely and warmly. When useful, suggest what the user could ask you to build or change next.\n\n${ragContext}` },
      ...history.slice(-8).map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content).slice(0, 1200) })),
      { role: "user", content: instruction },
    ],
    2000,
    CHAT_MODELS,
    { temperature: 0.6 }
  );
  return { reply: text.trim(), model };
}

function suggestionsFor(result) {
  const dark = result.style?.dark;
  return [
    "Try another style",
    dark ? "Make it light" : "Make it dark",
    "Use a blue accent",
    "Add an FAQ section",
  ];
}

function createReply(r) {
  const who = r.brand ? ` for ${r.brand}` : "";
  const personal = r.personalized ? " and wrote the copy around your brief" : "";
  const kind = r.niche.name.toLowerCase();
  const article = /^[aeiou]/.test(kind) ? "an" : "a";
  return `I built ${article} ${kind} site${who} in the ${r.style.name} style${personal}: ${r.sections.length} sections, ready to edit. ` +
    `Ask for changes like "make it dark", "use a green accent" or "add a pricing section", or publish when it feels right.`;
}

// ── POST /api/ai-chat/message ─────────────────────────────────────────────────
export async function chatMessage(req, res) {
  // One builder log per request for the admin dashboard.
  const t0 = Date.now();
  const sendJson = res.json.bind(res);
  res.json = (body) => {
    const lastUser = [...(req.body?.messages || [])].reverse().find((m) => m?.role === "user");
    recordBuilder({
      ok: res.statusCode < 400,
      ms: Date.now() - t0,
      userId: req.user?._id,
      message: res.statusCode >= 400 ? String(body?.message || "").slice(0, 300) : undefined,
      meta: {
        intent: body?.quick ? `quick:${body.quick}` : body?.intent || "error",
        niche: body?.niche?.id, style: body?.style?.id, model: body?.model,
        personalized: body?.personalized, applied: body?.applied,
        prompt: String(lastUser?.content || "").slice(0, 140),
      },
    });
    return sendJson(body);
  };

  try {
    const { messages = [], site = null, mode = null, options = {} } = req.body || {};
    if (!Array.isArray(messages) || !messages.length) return res.status(400).json({ message: "messages[] is required." });
    const last = [...messages].reverse().find((m) => m.role === "user");
    const instruction = (last?.content || "").toString().trim().slice(0, 3000);
    if (!instruction) return res.status(400).json({ message: "No user message found." });

    const activePage = site?.pages?.find((p) => p.id === site.activePage) || site?.pages?.[0] || null;
    const hasElements = Boolean(activePage?.elements?.length);
    const meta = site?.meta && typeof site.meta === "object" ? site.meta : null;

    const intent = ["create", "edit", "chat"].includes(mode) ? mode : routeIntent(instruction, hasElements);

    if (intent === "create") {
      // Before a site exists every user turn is part of the brief; afterwards
      // only the latest message describes the new site.
      const brief = hasElements
        ? instruction
        : messages.filter((m) => m.role === "user").map((m) => String(m.content)).join(". ").slice(0, 1800);
      const nicheId = typeof options.nicheId === "string" ? options.nicheId.slice(0, 60) : null;
      const styleId = typeof options.styleId === "string" ? options.styleId.slice(0, 40) : null;
      const variant = Number.isInteger(options.variant) ? Math.max(0, Math.min(50, options.variant)) : 0;
      const r = await generatePageElements(brief || instruction, { nicheId, styleId, variant });
      return res.json({
        intent: "create",
        industry: r.industry,
        niche: r.niche,
        style: r.style,
        model: r.model,
        personalized: r.personalized,
        elements: r.elements,
        pageBg: r.pageBg,
        seo: r.seo,
        meta: r.meta,
        reply: createReply(r),
        suggestions: suggestionsFor(r),
      });
    }

    // Deterministic quick edits first: free, instant, and they keep user edits.
    if (intent === "edit" && activePage) {
      const quick = detectQuickEdit(instruction);
      if (quick && meta) {
        const out = await applyQuickEdit(quick, {
          page: activePage,
          meta,
          generate: (b, o) => generatePageElements(b, o),
        });
        // No ready-made content for that section: let the AI editor write it instead.
        if (out && !out.elements && !aiAvailable()) {
          return res.json({ intent: "chat", reply: out.reply, applied: 0, pageId: activePage.id });
        }
        if (out?.elements) {
          return res.json({
            intent: "edit",
            quick: quick.kind,
            reply: out.reply,
            elements: out.elements,
            pageBg: out.pageBg,
            meta: out.meta,
            applied: 1,
            replaceAll: Boolean(out.replaceAll),
            pageId: activePage.id,
          });
        }
      }
    }

    if (!aiAvailable()) {
      return res.status(503).json({ message: "AI edits are temporarily unavailable. Quick edits like \"make it dark\" or \"try another style\" still work." });
    }

    const industry = legacyIndustry(parseIntent(`${instruction} ${meta?.brief || ""}`).niche?.archetype);

    if (intent === "edit" && activePage) {
      const { reply, elements, applied, model, notes } = await editWithAI(instruction, messages.slice(0, -1), activePage, industry);
      if (!applied || !elements) return res.json({ intent: "chat", reply, applied: 0, model, notes, pageId: activePage.id });
      return res.json({ intent, reply, elements, applied, model, notes, pageId: activePage.id });
    }

    const { reply, model } = await adviseWithAI(instruction, messages.slice(0, -1), industry);
    return res.json({ intent: "chat", reply, model });
  } catch (err) {
    console.error("❌ AI chat error:", err.message);
    const status = err.statusCode || err.status || 500;
    return res.status(status >= 400 && status < 600 ? status : 500).json({
      message: status === 429 ? "The AI is busy right now. Please try again in a minute." : "Something went wrong with that request. Please try again.",
    });
  }
}
