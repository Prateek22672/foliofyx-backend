// server/routes/aiBuilderRoutes.js
// AI Section Builder routes — protected + rate-limited to guard the Groq quota.

import express from "express";
import rateLimit from "express-rate-limit";
import { protect } from "../middleware/authMiddleware.js";
import { generateSection } from "../controllers/aiBuilderController.js";

const router = express.Router();

// Per-user/IP throttle: max 20 generations per minute.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many AI requests. Please slow down and try again shortly." },
});

router.post("/generate", protect, aiLimiter, generateSection);

export default router;
