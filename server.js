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
   ✅ CORS CONFIG (FIXED)
============================ */
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://foliofyx.netlify.app",
  "https://foliofyx.in",
  "https://www.foliofyx.in",
];

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  })
);

// ✅ Handle preflight properly
app.options("*", cors());

/* ============================
   ✅ MIDDLEWARES
============================ */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

/* ============================
   ✅ ROUTES
============================ */
app.get("/api/ping", (req, res) => {
  res.status(200).send("Pong! Server is awake.");
});

app.use("/api/auth", authRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/payment", paymentRoutes);

// ⚠️ Keep this LAST if unsure (debug safety)
app.use("/api", resumeParserRoute);

app.get("/", (req, res) => {
  res.send("FolioFYX Backend Running");
});

/* ============================
   ✅ ERROR HANDLER (IMPORTANT)
============================ */
app.use((err, req, res, next) => {
  console.error("🔥 Server Error:", err.message);
  res.status(500).json({ message: "Internal Server Error" });
});

/* ============================
   ✅ START SERVER
============================ */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Backend running on port ${PORT}`));