# server/python/rag_engine.py
# ------------------------------------------------------------------------------
# Python RAG engine for FolioFYX.
#
# Commands (first argv arg), all speaking JSON over stdin/stdout:
#   classify  stdin {"text": "...", "seed": [[text, label], ...]}
#             -> {"industry": "...", "confidence": 0.0-1.0}
#             Multinomial Naive Bayes trained on the seed examples sent by the
#             Node side (server/rag/knowledge.js CLASSIFIER_SEED is canonical).
#             Trained weights are cached to rag_model.json next to this file
#             keyed by a hash of the seed, so retraining only happens when the
#             seed data changes.
#   retrieve  stdin {"query": "...", "k": 4,
#                    "corpus": [{"id","text","tags","industry"}, ...]}
#             -> {"hits": [{"id","score"}, ...]}
#             BM25 (k1=1.4, b=0.75) — mirrors server/rag/retriever.js.
#   chunk     stdin {"text": "...", "size": 700, "overlap": 1}
#             -> {"chunks": ["...", ...]}  sentence-aware chunking.
#
# Standard library only — no downloads, no network, deploys anywhere.
# ------------------------------------------------------------------------------

import sys, json, math, re, hashlib, os

STOP = set(("a an and are as at be by for from has have in is it its of on or that "
            "the this to was were will with you your our we they their not no so if "
            "then than one two per each every all any").split())

def tokenize(text):
    text = re.sub(r"[^a-z0-9\s-]", " ", str(text).lower())
    return [t for t in re.split(r"[\s-]+", text) if len(t) > 1 and t not in STOP]

# ── Multinomial Naive Bayes (trained, cached) ─────────────────────────────────

MODEL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rag_model.json")

def seed_hash(seed):
    return hashlib.sha1(json.dumps(seed, sort_keys=True).encode()).hexdigest()

def train_nb(seed):
    """seed: [[text, label], ...] -> model dict with log priors + log likelihoods."""
    vocab, class_tf, class_total, class_count = set(), {}, {}, {}
    for text, label in seed:
        toks = tokenize(text)
        class_count[label] = class_count.get(label, 0) + 1
        tf = class_tf.setdefault(label, {})
        for t in toks:
            vocab.add(t)
            tf[t] = tf.get(t, 0) + 1
            class_total[label] = class_total.get(label, 0) + 1
    n_docs = sum(class_count.values())
    v = max(1, len(vocab))
    model = {"classes": {}, "vocab_size": v}
    for label, count in class_count.items():
        total = class_total.get(label, 0)
        loglik = {t: math.log((f + 1.0) / (total + v)) for t, f in class_tf[label].items()}
        model["classes"][label] = {
            "log_prior": math.log(count / n_docs),
            "log_unseen": math.log(1.0 / (total + v)),
            "loglik": loglik,
        }
    return model

def load_or_train(seed):
    h = seed_hash(seed)
    try:
        with open(MODEL_PATH, "r", encoding="utf-8") as f:
            cached = json.load(f)
        if cached.get("seed_hash") == h:
            return cached["model"]
    except Exception:
        pass
    model = train_nb(seed)
    try:
        with open(MODEL_PATH, "w", encoding="utf-8") as f:
            json.dump({"seed_hash": h, "model": model}, f)
    except Exception:
        pass  # cache is an optimization, never a requirement
    return model

def classify(payload):
    text = payload.get("text", "")
    seed = payload.get("seed") or []
    if not seed:
        return {"industry": None, "confidence": 0.0}
    model = load_or_train(seed)
    toks = tokenize(text)
    scores = {}
    for label, cls in model["classes"].items():
        s = cls["log_prior"]
        for t in toks:
            s += cls["loglik"].get(t, cls["log_unseen"])
        scores[label] = s
    if not scores:
        return {"industry": None, "confidence": 0.0}
    # softmax over log scores for a usable confidence value
    mx = max(scores.values())
    exp = {k: math.exp(v - mx) for k, v in scores.items()}
    z = sum(exp.values())
    best = max(exp, key=exp.get)
    return {"industry": best, "confidence": exp[best] / z}

# ── BM25 retrieval (parity with retriever.js) ─────────────────────────────────

def retrieve(payload):
    query, corpus, k = payload.get("query", ""), payload.get("corpus", []), payload.get("k", 4)
    docs = []
    df = {}
    for c in corpus:
        toks = tokenize(c.get("text", ""))
        tf = {}
        for t in toks:
            tf[t] = tf.get(t, 0) + 1
        for t in tf:
            df[t] = df.get(t, 0) + 1
        docs.append({"id": c.get("id"), "tf": tf, "len": len(toks)})
    n = len(docs)
    if not n:
        return {"hits": []}
    avgdl = sum(d["len"] for d in docs) / n
    idf = {t: math.log(1 + (n - c + 0.5) / (c + 0.5)) for t, c in df.items()}
    k1, b = 1.4, 0.75
    q = list(dict.fromkeys(tokenize(query)))
    hits = []
    for d in docs:
        score = 0.0
        for t in q:
            f = d["tf"].get(t)
            if not f:
                continue
            score += idf.get(t, 0) * (f * (k1 + 1)) / (f + k1 * (1 - b + b * d["len"] / avgdl))
        if score > 0:
            hits.append({"id": d["id"], "score": round(score, 4)})
    hits.sort(key=lambda h: -h["score"])
    return {"hits": hits[:k]}

# ── Paragraph-first, sentence-aware chunking ─────────────────────────────────
# Mirrors server/rag/retriever.js chunkText(): paragraph boundaries are
# respected when a chunk is already half full, sentence overlap carries
# context across boundaries, and tiny tail chunks merge into the previous one.

def chunk(payload):
    size = int(payload.get("size", 700))
    overlap = int(payload.get("overlap", 2))
    min_tail = int(payload.get("min_tail", 160))
    raw = str(payload.get("text", "")).replace("\r", "")
    paras = [re.sub(r"\s+", " ", p).strip() for p in re.split(r"\n{2,}", raw)]
    paras = [p for p in paras if p]

    chunks, cur, cur_len = [], [], 0

    def flush():
        nonlocal cur, cur_len
        if not cur:
            return
        chunks.append(" ".join(cur))
        cur = cur[-overlap:] if overlap else []
        cur_len = sum(len(x) + 1 for x in cur)

    for para in paras:
        if cur_len and cur_len + len(para) + 1 > size and cur_len >= size / 2:
            flush()
        for s in re.split(r"(?<=[.!?])\s+", para):
            cur.append(s)
            cur_len += len(s) + 1
            if cur_len >= size:
                flush()

    fresh = cur[overlap:] if chunks else cur
    if fresh:
        tail = " ".join(cur)
        if chunks and len(tail) < min_tail:
            chunks[-1] += " " + " ".join(fresh)
        else:
            chunks.append(tail)
    return {"chunks": chunks}

# ── Entry point ──────────────────────────────────────────────────────────────

COMMANDS = {"classify": classify, "retrieve": retrieve, "chunk": chunk}

def main():
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    fn = COMMANDS.get(cmd)
    if not fn:
        print(json.dumps({"error": f"unknown command: {cmd}"}))
        sys.exit(1)
    try:
        payload = json.loads(sys.stdin.read() or "{}")
        print(json.dumps(fn(payload)))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
