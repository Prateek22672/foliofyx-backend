# ── FolioFYX backend ──────────────────────────────────────────────────────────
# Node + Python: the API runs on Node, but the resume parser spawns `python3`
# (see controllers/resumeParserController.js), so both runtimes live in one image.
FROM node:20-bookworm-slim

# Python 3.11 (matches runtime.txt) for the resume extractor.
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Node dependencies (production only — nodemon is a devDependency).
COPY package*.json ./
RUN npm ci --omit=dev

# Python dependencies for the resume parser.
COPY requirements.txt ./
RUN pip3 install --no-cache-dir --break-system-packages -r requirements.txt

# Application source.
COPY . .

ENV NODE_ENV=production
ENV PORT=5000
EXPOSE 5000

CMD ["node", "server.js"]
