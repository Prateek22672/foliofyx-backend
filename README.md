# FolioFyx Backend

The API and AI engine behind [FolioFyx](https://foliofyx.in) — a no-code website and portfolio builder for students, developers, and creators. This service powers AI site generation, conversational editing, design-from-reference, resume parsing, publishing, and custom-domain serving.

## About

FolioFyx started as a free portfolio builder for students and has grown into a full AI website studio. The backend's job is to make "describe it → get a real, editable website" actually work: a retrieval-augmented design engine grounds every generation in curated design knowledge, a multi-key LLM pool keeps generation fast for simultaneous users, and published sites are server-rendered with SEO baked in — on a FolioFyx link or on the user's own domain.

## What's inside

| Area | Description |
|---|---|
| AI Site Builder | `POST /api/ai-builder/generate` — industry-classified, template-grounded page generation with LLM copywriting |
| AI Chat Builder | `POST /api/ai-chat/message` — conversational create / edit / advise over a site's canvas elements |
| Design from Reference | `POST /api/reference/analyze` — recreate a layout from a text brief or screenshot (vision models + palette/layout extraction) |
| Resume Parser | `POST /api/parse-resume` — PDF/image resume → structured portfolio data (pdfplumber + parallel LLM extraction) |
| Custom Websites | `/api/custom-websites/*` — CRUD, autosave, publish/unpublish, duplicate |
| Custom Domains | `/api/domains/*` — connect, DNS-verify (TXT ownership + A/CNAME pointing), status, disconnect |
| Published Serving | SSR of published sites at `/site/:slug` and via Host-header routing for verified custom domains |

## Architecture notes

- **RAG design engine** (`rag/`, `python/rag_engine.py`) — an in-process BM25 retriever over a curated design-knowledge corpus. Chunking is paragraph-first and sentence-aware with overlap; retrieval uses MMR-style diversification so prompts get distinct design rules, not restatements. A trained Naive Bayes classifier (Python, cached) routes briefs to an industry blueprint, with deterministic regex fallback. No external vector DB — retrieval adds ~0ms per request.
- **Groq key pool** (`lib/groqPool.js`) — all LLM calls rotate across multiple Groq API keys with per-key rate-limit cooldowns and model fallback (Llama 3.3 70B → Llama 3.1 8B), so concurrent users never stall on one key's limits.
- **Resume pipeline** (`python/resume_extractor.py` + `controllers/resumeParserController.js`) — Python extracts and section-splits the document; six parallel LLM extractions (identity, bio, education, skills, experience, projects) run through the pool with strict schemas, full-text fallbacks for unusually formatted resumes, and heavy sanitization.
- **Publishing** (`lib/siteRenderer.js`) — published sites render to standalone HTML with meta tags and JSON-LD; custom-domain requests are matched by Host header before the API middleware chain.

## Getting started

Requirements: Node 20+, Python 3.11+ (`pip install -r requirements.txt`), MongoDB.

```bash
npm install
pip install -r requirements.txt
cp .env.example .env   # fill in real values
node server.js
```

The server listens on `PORT` (default 5000). See `.env.example` for every variable — the important ones:

- `MONGO_URI` — MongoDB connection string
- `JWT_SECRET` — auth token signing secret
- `GROQ_API_KEYS` — comma-separated Groq keys (the pool rotates across them); `GROQ_API_KEY` also works for a single key
- `PUBLIC_SITE_BASE`, `SITE_SERVER_IP`, `SITE_CNAME_TARGET` — required for custom-domain "live" verification and published URLs

### Docker

```bash
docker build -t foliofyx-backend .
docker run -p 5000:5000 --env-file .env foliofyx-backend
```

Or use the `docker-compose.yml` in the [frontend repo](https://github.com/Prateek22672/foliofyx), which runs client and server together.

## Related

- Frontend: [Prateek22672/foliofyx](https://github.com/Prateek22672/foliofyx)
- Live site: [foliofyx.in](https://foliofyx.in)

## License

MIT
