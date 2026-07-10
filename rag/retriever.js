// server/rag/retriever.js
// ─────────────────────────────────────────────────────────────────────────────
// RAG retriever — chunking + BM25 over the design-knowledge corpus.
//
// Runs fully in-process (no external services, no embeddings API needed) so
// retrieval adds ~0ms to a generation request. The Python engine
// (server/python/rag_engine.py) provides the trained industry classifier and
// an identical BM25 implementation for offline evaluation; this JS index is
// the hot path. Both consume the same corpus from server/rag/knowledge.js.
//
// Public API:
//   retrieve(query, { k, industry, tags })  → [{ id, docId, text, score }]
//   buildDesignContext(query, { k, industry }) → prompt-ready string
//   classifyIndustry(prompt)                → Promise<industry> (python model,
//                                             regex fallback, never throws)
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { KNOWLEDGE_DOCS, CLASSIFIER_SEED } from "./knowledge.js";
import { detectIndustry } from "./industry.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Tokenization ─────────────────────────────────────────────────────────────
const STOP = new Set(("a an and are as at be by for from has have in is it its of on or that the this to was were will with you your our we they their not no so if then than one two per each every all any".split(" ")));

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

// ── Chunking ─────────────────────────────────────────────────────────────────
// Paragraph-first, sentence-aware chunks of ~CHUNK_CHARS with
// OVERLAP_SENTENCES of carry-over. Paragraph boundaries are respected when a
// chunk is already half full, so related rules stay in one chunk instead of
// being split mid-topic; the overlap means a rule split across sentences is
// never lost at a chunk boundary. Tiny tail chunks are merged into the
// previous chunk — a 60-char fragment retrieves badly on its own.
const CHUNK_CHARS = 700;
const OVERLAP_SENTENCES = 2;
const MIN_TAIL_CHARS = 160;

export function chunkText(text, docId = "doc") {
  const paras = String(text)
    .replace(/\r/g, "")
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const chunks = [];
  let cur = [];
  let curLen = 0;

  const flush = () => {
    if (!cur.length) return;
    chunks.push(cur.join(" "));
    cur = cur.slice(-OVERLAP_SENTENCES);
    curLen = cur.reduce((n, x) => n + x.length + 1, 0);
  };

  for (const para of paras) {
    // Break at the paragraph boundary when the next paragraph would overflow
    // an already half-full chunk — keeps whole paragraphs together.
    if (curLen && curLen + para.length + 1 > CHUNK_CHARS && curLen >= CHUNK_CHARS / 2) flush();
    for (const s of para.split(/(?<=[.!?])\s+/)) {
      cur.push(s);
      curLen += s.length + 1;
      if (curLen >= CHUNK_CHARS) flush();
    }
  }

  // Emit the tail only if it holds sentences beyond the carried overlap.
  const fresh = cur.slice(chunks.length ? OVERLAP_SENTENCES : 0);
  if (fresh.length) {
    const tail = cur.join(" ");
    if (chunks.length && tail.length < MIN_TAIL_CHARS) {
      chunks[chunks.length - 1] += " " + fresh.join(" ");
    } else {
      chunks.push(tail);
    }
  }
  return chunks.map((text, i) => ({ id: `${docId}#${i}`, docId, text }));
}

// ── BM25 index (built lazily once) ───────────────────────────────────────────
const K1 = 1.4;
const B = 0.75;

let _index = null;

function buildIndex() {
  const chunks = [];
  for (const doc of KNOWLEDGE_DOCS) {
    for (const c of chunkText(doc.text, doc.id)) {
      chunks.push({ ...c, tags: doc.tags || [], industry: doc.industry || null });
    }
  }
  const df = new Map();
  const docs = chunks.map((c) => {
    const tokens = tokenize(c.text);
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const t of tf.keys()) df.set(t, (df.get(t) || 0) + 1);
    return { ...c, tf, len: tokens.length };
  });
  const N = docs.length;
  const avgdl = docs.reduce((n, d) => n + d.len, 0) / Math.max(1, N);
  const idf = new Map();
  for (const [t, n] of df) idf.set(t, Math.log(1 + (N - n + 0.5) / (n + 0.5)));
  return { docs, idf, avgdl };
}

function index() {
  if (!_index) _index = buildIndex();
  return _index;
}

// ── Retrieval ────────────────────────────────────────────────────────────────
export function retrieve(query, { k = 4, industry = null, tags = null, diversify = true } = {}) {
  const { docs, idf, avgdl } = index();
  const qTokens = [...new Set(tokenize(query))];
  const scored = docs
    .map((d) => {
      let score = 0;
      for (const t of qTokens) {
        const f = d.tf.get(t);
        if (!f) continue;
        score += (idf.get(t) || 0) * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.len) / avgdl)));
      }
      // Domain boosts: same-industry chunks and requested tags float upward.
      if (industry && d.industry === industry) score *= 1.6;
      if (industry && d.industry && d.industry !== industry) score *= 0.35;
      if (tags && d.tags.some((t) => tags.includes(t))) score *= 1.3;
      return { id: d.id, docId: d.docId, text: d.text, tags: d.tags, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!diversify || scored.length <= k) return scored.slice(0, k);

  // MMR-lite: greedily pick from a widened candidate pool, discounting each
  // candidate by its token overlap with what's already picked. The k slots go
  // to k *different* rules instead of three restatements of the top hit.
  const pool = scored.slice(0, Math.max(k * 4, 12));
  const picked = [];
  const tokCache = new Map();
  const toks = (c) => {
    if (!tokCache.has(c.id)) tokCache.set(c.id, new Set(tokenize(c.text)));
    return tokCache.get(c.id);
  };
  while (picked.length < k && pool.length) {
    let bestI = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const cand = pool[i];
      let maxSim = 0;
      for (const p of picked) {
        const a = toks(cand);
        const b = toks(p);
        let inter = 0;
        for (const t of a) if (b.has(t)) inter++;
        const sim = inter / Math.max(1, Math.min(a.size, b.size));
        if (sim > maxSim) maxSim = sim;
      }
      const val = cand.score * (1 - 0.6 * maxSim);
      if (val > bestVal) {
        bestVal = val;
        bestI = i;
      }
    }
    picked.push(pool.splice(bestI, 1)[0]);
  }
  return picked;
}

/**
 * Prompt-ready design context for a brief. Always includes the industry
 * blueprint (when one exists) plus the top-k craft chunks for the query.
 */
export function buildDesignContext(query, { k = 5, industry = null } = {}) {
  const picks = [];
  const seen = new Set();

  if (industry) {
    const blueprint = index().docs.find((d) => d.docId === `blueprint-${industry}`);
    if (blueprint) {
      picks.push({ docId: blueprint.docId, text: blueprint.text });
      seen.add(blueprint.docId);
    }
  }
  for (const hit of retrieve(query, { k: k + seen.size, industry })) {
    if (seen.has(hit.docId)) continue;
    seen.add(hit.docId);
    picks.push(hit);
    if (picks.length >= k) break;
  }
  if (!picks.length) return "";
  return (
    "DESIGN KNOWLEDGE (retrieved for this brief — follow these rules exactly):\n" +
    picks.map((p, i) => `[${i + 1}] ${p.text}`).join("\n\n")
  );
}

// ── Python-trained industry classifier (with regex fallback) ────────────────
const PY_ENGINE = path.join(__dirname, "..", "python", "rag_engine.py");
let _pyBroken = false; // remember a failed spawn so we stop retrying every call

export function classifyIndustry(prompt) {
  return new Promise((resolve) => {
    const fallback = () => resolve(detectIndustry(prompt));
    if (_pyBroken) return fallback();

    const py = spawn(process.env.PYTHON_BIN || "python", [PY_ENGINE, "classify"], {
      stdio: ["pipe", "pipe", "ignore"],
    });
    let out = "";
    const timer = setTimeout(() => { py.kill(); fallback(); }, 4000);

    py.stdout.on("data", (d) => (out += d));
    py.on("error", () => { _pyBroken = true; clearTimeout(timer); fallback(); });
    py.on("close", () => {
      clearTimeout(timer);
      try {
        const res = JSON.parse(out);
        // Trust the trained model only when it is confident; otherwise the
        // deterministic regex rules are safer.
        if (res.industry && res.confidence >= 0.55) return resolve(res.industry);
      } catch { /* fall through */ }
      fallback();
    });
    py.stdin.write(JSON.stringify({ text: prompt, seed: CLASSIFIER_SEED }));
    py.stdin.end();
  });
}
