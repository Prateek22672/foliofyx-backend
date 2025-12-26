import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";

import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import portfolioRoutes from "./routes/portfolioRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";

dotenv.config();

// 🔌 Connect to MongoDB
connectDB();

const app = express();

/* --------------------------------------------------
   ✅ 1. CORS CONFIG (CRITICAL)
-------------------------------------------------- */
const allowedOrigins = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "https://foliofyx.netlify.app"
];

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (Postman, curl, mobile apps)
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS not allowed"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ✅ THIS LINE FIXES YOUR ERROR (Preflight OPTIONS)
app.options("*", cors());

/* --------------------------------------------------
   ✅ 2. GOOGLE AUTH SAFE HEADERS
-------------------------------------------------- */
app.use((req, res, next) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  next();
});

/* --------------------------------------------------
   ✅ 3. BODY PARSERS
-------------------------------------------------- */
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ limit: "10mb", extended: true }));

/* --------------------------------------------------
   ✅ 4. STATIC FILES
-------------------------------------------------- */
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

/* --------------------------------------------------
   ✅ 5. ROUTES
-------------------------------------------------- */
app.use("/api/auth", authRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/payment", paymentRoutes);

/* --------------------------------------------------
   ✅ 6. HEALTH CHECK
-------------------------------------------------- */
app.get("/", (req, res) => {
  res.status(200).send("✅ Backend is Connected & Running!");
});

/* --------------------------------------------------
   ✅ 7. START SERVER
-------------------------------------------------- */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
