// server/routes/resumeParserRoute.js

import express from "express";
import multer from "multer";
import os from "os";
import rateLimit from "express-rate-limit";
import { parseResume } from "../controllers/resumeParserController.js";
import { optionalAuth } from "../middleware/authMiddleware.js";

const router = express.Router();

// Resume parsing spawns Python + several LLM calls, so it's the priciest
// anonymous-facing endpoint — throttled harder per IP than the chat builder
// (10/min for a signed-in caller, but guests ("work first, log in to save" —
// see create/index.jsx) get a stricter 3/min).
const parseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: (req) => (req.user ? 10 : 3),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many resume uploads — try again in a minute." },
});

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/jpg",
      "image/webp",
    ];

    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF and image files allowed"));
    }
  },
});

// 🔥 Add try-catch wrapper (important)
router.post("/parse-resume", optionalAuth, parseLimiter, upload.single("resume"), async (req, res) => {
  try {
    await parseResume(req, res);
  } catch (err) {
    console.error("[Route Error]:", err);
    res.status(500).json({ error: "Route failed" });
  }
});

export default router;