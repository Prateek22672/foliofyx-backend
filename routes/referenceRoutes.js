// server/routes/referenceRoutes.js
// "Design from Reference" routes — protected + rate-limited + accepts an image upload.

import express from "express";
import multer from "multer";
import os from "os";
import rateLimit from "express-rate-limit";
import { protect } from "../middleware/authMiddleware.js";
import { analyzeReference } from "../controllers/referenceController.js";

const router = express.Router();

// Screenshot upload → temp dir, deleted by the controller after analysis.
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 12 * 1024 * 1024 }, // 12MB
  fileFilter: (_req, file, cb) => {
    const ok = ["image/png", "image/jpeg", "image/jpg", "image/webp"].includes(file.mimetype);
    cb(ok ? null : new Error("Only PNG/JPEG/WebP images allowed"), ok);
  },
});

// Reference analysis is heavier than a normal generate — throttle a bit tighter.
const refLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many reference requests. Please slow down and try again shortly." },
});

// Multer errors (wrong type, >12MB) must come back as structured JSON the
// client can show — not a hang or an HTML error page from the default handler.
function uploadImage(req, res, next) {
  upload.single("image")(req, res, (err) => {
    if (err) {
      const message =
        err.code === "LIMIT_FILE_SIZE"
          ? "Image is too large (max 12MB). Please upload a smaller screenshot."
          : err.message || "Upload failed. Please try a different image.";
      return res.status(400).json({ message });
    }
    next();
  });
}

// uploadImage is a no-op for JSON (text mode) bodies, so this one route serves all modes.
router.post("/analyze", protect, refLimiter, uploadImage, analyzeReference);

export default router;
