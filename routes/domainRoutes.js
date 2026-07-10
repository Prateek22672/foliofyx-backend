// server/routes/domainRoutes.js
// Custom-domain (DNS) routes — all owner-protected; verify is rate-limited
// because each call performs live DNS lookups.

import express from "express";
import rateLimit from "express-rate-limit";
import { protect } from "../middleware/authMiddleware.js";
import { connectDomain, verifyDomain, domainStatus, disconnectDomain } from "../controllers/domainController.js";

const router = express.Router();

const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many verification attempts — DNS needs a moment to propagate anyway. Try again shortly." },
});

router.post("/:id/connect", protect, connectDomain);
router.post("/:id/verify", protect, verifyLimiter, verifyDomain);
router.get("/:id/status", protect, domainStatus);
router.delete("/:id", protect, disconnectDomain);

export default router;
