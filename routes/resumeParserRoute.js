// server/routes/resumeParserRoute.js

import express from "express";
import multer from "multer";
import os from "os";
import { parseResume } from "../controllers/resumeParserController.js";

const router = express.Router();

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
router.post("/parse-resume", upload.single("resume"), async (req, res) => {
  try {
    await parseResume(req, res);
  } catch (err) {
    console.error("[Route Error]:", err);
    res.status(500).json({ error: "Route failed" });
  }
});

export default router;