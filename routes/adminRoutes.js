// server/routes/adminRoutes.js
import express from "express";
import rateLimit from "express-rate-limit";
import { protect, adminOnly } from "../middleware/authMiddleware.js";
import { adminMe, overview, users, sites, ai, probeModels, errors, system } from "../controllers/adminController.js";

const router = express.Router();

const probeLimiter = rateLimit({ windowMs: 60_000, max: 4, standardHeaders: true, legacyHeaders: false, message: { message: "Probing too often; wait a minute." } });

router.get("/me", protect, adminMe);
router.use(protect, adminOnly);
router.get("/overview", overview);
router.get("/users", users);
router.get("/sites", sites);
router.get("/ai", ai);
router.post("/ai/probe", probeLimiter, probeModels);
router.get("/errors", errors);
router.get("/system", system);

export default router;
