// server/lib/aiModels.js
// Groq model lists in ONE place. Groq retires models regularly (the Llama 3.x
// ids this app used are gone), so every controller reads from here and the
// lists can be changed without a deploy via env:
//   GROQ_TEXT_MODELS="openai/gpt-oss-120b,openai/gpt-oss-20b"
//   GROQ_VISION_MODELS="some/vision-model"
// Check what a key can use: GET https://api.groq.com/openai/v1/models

const DEFAULT_TEXT = [
  { id: "openai/gpt-oss-120b", label: "GPT-OSS 120B" },
  { id: "openai/gpt-oss-20b", label: "GPT-OSS 20B" },
  { id: "qwen/qwen3.8-27b", label: "Qwen 3.8 27B" },
];

// Per-family request options: keep reasoning short so JSON answers fit the
// token budget and responses stay fast.
function extraFor(id) {
  if (id.startsWith("openai/gpt-oss")) return { reasoning_effort: "low" };
  if (id.startsWith("qwen/")) return { reasoning_effort: "none" };
  return {};
}

function fromEnv(name) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return null;
  return raw.split(/[\s,]+/).filter(Boolean).map((id) => ({ id, label: id.split("/").pop() }));
}

/** Text/chat models, best first, each with the given output budget. */
export function textModels(maxOut) {
  return (fromEnv("GROQ_TEXT_MODELS") || DEFAULT_TEXT).map((m) => ({ ...m, maxOut, extra: extraFor(m.id) }));
}

/** Vision models (image input), best first. Empty when none are configured. */
export function visionModelIds() {
  return (fromEnv("GROQ_VISION_MODELS") || []).map((m) => m.id);
}
