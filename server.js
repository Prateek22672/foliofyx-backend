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

connectDB();

const app = express();

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