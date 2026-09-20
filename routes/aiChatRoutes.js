// server/routes/aiChatRoutes.js
// AI Chat Builder routes — rate-limited to guard the Groq quota. Open to
// guests ("work first, log in to save/publish" — see AIBuilder/index.jsx):
// the per-IP rate limit was always the actual abuse control here (it isn't
// keyed by account), so dropping the login requirement adds no new cost
// exposure, only removes a top-of-funnel friction gate.

import express from "express";
import rateLimit from "express-rate-limit";
import { optionalAuth } from "../middleware/authMiddleware.js";
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

router.post("/message", optionalAuth, chatLimiter, chatMessage);

export default router;
