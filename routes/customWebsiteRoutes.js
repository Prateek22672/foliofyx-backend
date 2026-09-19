// server/routes/customWebsiteRoutes.js

import express from "express";
import rateLimit from "express-rate-limit";
import { protect } from "../middleware/authMiddleware.js"; // your existing JWT middleware
import {
  createWebsite,
  getWebsite,
  getUserWebsites,
  saveWebsite,
  publishWebsite,
  unpublishWebsite,
  deleteWebsite,
  duplicateWebsite,
  logAiGeneration,
  getPublishedWebsite,
  checkSlugAvailability,
  previewWebsite,
} from "../controllers/customWebsiteController.js";

const router = express.Router();

// The Studio's mobile preview re-renders on (debounced) edits.
const previewLimiter = rateLimit({ windowMs: 60_000, max: 90, standardHeaders: true, legacyHeaders: false, message: { message: "Previewing too fast; wait a moment." } });

// ── Public routes (no auth) ──────────────────────────────────────────────────
router.get("/public/:slug", getPublishedWebsite);
router.get("/slug-available/:slug", checkSlugAvailability);

// ── Protected routes (JWT required) ─────────────────────────────────────────
router.use(protect);

router.post("/preview", previewLimiter, previewWebsite); // POST render an unsaved draft (no storage)
router.get("/",              getUserWebsites);   // GET all for current user
router.post("/",             createWebsite);     // POST create new
router.get("/:id",           getWebsite);        // GET one by id
router.put("/:id",           saveWebsite);       // PUT save/autosave
router.delete("/:id",        deleteWebsite);     // DELETE
router.post("/:id/publish",  publishWebsite);    // POST publish
router.post("/:id/unpublish",unpublishWebsite);  // POST unpublish
router.post("/:id/duplicate",duplicateWebsite);  // POST duplicate
router.post("/:id/ai-log",   logAiGeneration);   // POST log AI generation

export default router;