// 🔥 dotenv MUST be first
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import path from "path";
import connectDB from "./config/db.js";

import authRoutes from "./routes/authRoutes.js";
import portfolioRoutes from "./routes/portfolioRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import resumeParserRoute from "./routes/resumeParserRoute.js";
import customWebsiteRoutes from "./routes/customWebsiteRoutes.js";
import aiBuilderRoutes from "./routes/aiBuilderRoutes.js";
import referenceRoutes from "./routes/referenceRoutes.js";
import aiChatRoutes from "./routes/aiChatRoutes.js";
import domainRoutes from "./routes/domainRoutes.js";
import CustomWebsite from "./models/CustomWebsite.js";
import { renderSiteHTML } from "./lib/siteRenderer.js";


connectDB();

const app = express();
// Behind a proxy (Render/Railway/Nginx) trust X-Forwarded-* so req.hostname,
// req.protocol and express-rate-limit see the real client values.
app.set("trust proxy", 1);

/* ============================
   ✅ CUSTOM DOMAIN SERVING
   Any request whose Host header is a connected, published custom domain
   gets the SSR-rendered site — this must run before CORS/API routing.
============================ */
const APP_HOSTS = new Set([
  "localhost", "127.0.0.1",
  "foliofyx.netlify.app", "foliofyx.in", "www.foliofyx.in",
]);
const domainCache = new Map(); // host → { site, ts }
const DOMAIN_TTL = 60_000;

app.use(async (req, res, next) => {
  try {
    const host = String(req.hostname || "").toLowerCase().replace(/^www\./, "");
    if (!host || APP_HOSTS.has(req.hostname) || APP_HOSTS.has(host)) return next();
    if (req.path.startsWith("/api") || req.path.startsWith("/uploads")) return next();

    let hit = domainCache.get(host);
    if (!hit || Date.now() - hit.ts > DOMAIN_TTL) {
      const site = await CustomWebsite.findOne({
        "customDomain.name": host,
        "customDomain.status": { $in: ["verified", "live"] },
        status: "published",
      }).lean();
      hit = { site, ts: Date.now() };
      domainCache.set(host, hit);
    }
    if (!hit.site) return next();

    const html = renderSiteHTML(hit.site, {
      pageSlug: req.path === "/" ? "/" : req.path.replace(/\/$/, ""),
      baseUrl: `https://${host}`,
    });
    if (!html) return next();
    return res.status(200).type("html").send(html);
  } catch (err) {
    console.error("[domain-serve]", err.message);
    return next();
  }
});

/* ============================
   ✅ CORS CONFIG (FINAL STABLE)
============================ */
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://foliofyx.netlify.app",
  "https://foliofyx.in",
  "https://www.foliofyx.in",
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests without origin (Postman, server-to-server)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    // ❗ Do NOT throw error → just block silently
    return callback(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// ✅ Apply once
app.use(cors(corsOptions));

// ✅ Handle preflight requests
app.options("*", cors(corsOptions));

//new

app.use("/api/custom-websites", customWebsiteRoutes);


/* ============================
   ✅ MIDDLEWARES
============================ */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

/* ============================
   ✅ ROUTES
============================ */

// Health check
app.get("/api/ping", (req, res) => {
  res.status(200).send("Pong! Server is awake.");
});

app.use("/api/auth", authRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/payment", paymentRoutes);
// AI Section Builder — mounted AFTER express.json() so req.body is parsed.
app.use("/api/ai-builder", aiBuilderRoutes);
// Design-from-Reference — multer handles multipart; JSON bodies pass through.
app.use("/api/reference", referenceRoutes);
// AI Chat Builder — conversational create/edit ("chat = create website").
app.use("/api/ai-chat", aiChatRoutes);
// Custom domain (DNS) connect + verify.
app.use("/api/domains", domainRoutes);

/* ============================
   ✅ PUBLISHED SITE SSR
   /site/:slug[/page] serves the published website as real HTML
   (crawlable, fast, with the interactive runtime baked in).
============================ */
app.get(["/site/:slug", "/site/:slug/*"], async (req, res) => {
  try {
    const site = await CustomWebsite.findOne({ slug: req.params.slug, status: "published" }).lean();
    if (!site) return res.status(404).type("html").send("<h1>404</h1><p>This site isn't published.</p>");
    const sub = req.params[0] ? `/${req.params[0].replace(/\/$/, "")}` : "/";
    const base = (process.env.PUBLIC_SITE_BASE || `${req.protocol}://${req.get("host")}`) + `/site/${site.slug}`;
    const html = renderSiteHTML(site, { pageSlug: sub, baseUrl: base });
    if (!html) return res.status(404).type("html").send("<h1>404</h1><p>Page not found.</p>");
    res.status(200).type("html").send(html);
  } catch (err) {
    console.error("[site-ssr]", err.message);
    res.status(500).type("html").send("<h1>Something went wrong</h1>");
  }
});

// ⚠️ IMPORTANT: keep this LAST
app.use("/api", resumeParserRoute);

app.get("/", (req, res) => {
  res.send("FolioFYX Backend Running");
});

/* ============================
   ✅ ERROR HANDLER (CORS SAFE)
============================ */
app.use((err, req, res, next) => {
  console.error("🔥 Server Error:", err.message);

  // Ensure CORS headers even on error
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header("Access-Control-Allow-Credentials", "true");

  res.status(500).json({ message: "Internal Server Error" });
});

/* ============================
   ✅ START SERVER
============================ */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
});

