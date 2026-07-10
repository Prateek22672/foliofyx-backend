// server/routes/aiChatRoutes.js
// AI Chat Builder routes — protected + rate-limited to guard the Groq quota.

import express from "express";
import rateLimit from "express-rate-limit";
import { protect } from "../middleware/authMiddleware.js";
import { chatMessage } from "../controllers/aiChatController.js";

const router = express.Router();

// Chat turns are heavier than one-shot generations: max 30 per minute.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many AI requests. Please slow down and try again shortly." },
});

router.post("/message", protect, chatLimiter, chatMessage);

export default router;
