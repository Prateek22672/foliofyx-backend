import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import path from "path";
import connectDB from "./config/db.js";

import authRoutes from "./routes/authRoutes.js";
import portfolioRoutes from "./routes/portfolioRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";

dotenv.config();
connectDB();

const app = express();

/* ============================
   ✅ FINAL CORS CONFIG (PROD)
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
    origin: function (origin, callback) {
      // Allow server-to-server & tools like Postman
      if (!origin) return callback(null, true);

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error(`CORS blocked: ${origin}`));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// REQUIRED for preflight
app.options("*", cors());

/* ============================
   ✅ MIDDLEWARES (PAYLOAD LIMIT FIX)
============================ */
// This line fixes the "413 Payload Too Large" error
app.use(express.json({ limit: "10mb" })); 
app.use(express.urlencoded({ limit: "10mb", extended: true }));

app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

/* ============================
   ✅ WAKE-UP ROUTE
============================ */
app.get("/api/ping", (req, res) => {
  res.status(200).send("Pong! Server is awake.");
});

/* ============================
   APP ROUTES
============================ */
app.use("/api/auth", authRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/payment", paymentRoutes);

app.get("/", (req, res) => {
  res.send("FolioFYX Backend Running");
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`🚀 Backend running on port ${PORT}`)
);