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
import { hostRouter, siteRoute } from "./lib/siteServing.js";
import { startDomainMonitor } from "./lib/domainMonitor.js";
import { requestMonitor, recordError } from "./lib/monitor.js";
import adminRoutes from "./routes/adminRoutes.js";


connectDB();

const app = express();
// Behind a proxy (Render/Railway/Nginx) trust X-Forwarded-* so req.hostname,
// req.protocol and express-rate-limit see the real client values.
app.set("trust proxy", 1);

// Latency / error tracking for the admin dashboard (API routes only).
app.use(requestMonitor());

/* ============================
   ✅ USER SITE SERVING (before CORS / API)
   <slug>.<ROOT_DOMAIN> and connected custom domains are served here;
   app and API hosts fall through to the routes below.
============================ */
app.use(hostRouter());

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

app.use("/api/custom-websites", express.json({ limit: "10mb" }), customWebsiteRoutes);


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
// Admin dashboard (protect + adminOnly inside the router).
app.use("/api/admin", adminRoutes);

/* ============================
   ✅ PUBLISHED SITE SSR: /site/:slug[/page]
============================ */
app.get(["/site/:slug", "/site/:slug/*"], siteRoute);

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
  recordError(err, req);

  // Keep CORS headers on errors, but only for origins we actually allow.
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Vary", "Origin");
  }

  res.status(500).json({ message: "Internal Server Error" });
});

process.on("unhandledRejection", (reason) => {
  console.error("Unhandled rejection:", reason?.message || reason);
  recordError(reason instanceof Error ? reason : new Error(String(reason)));
});

/* ============================
   ✅ START SERVER
============================ */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Backend running on port ${PORT}`);
  startDomainMonitor();
});

