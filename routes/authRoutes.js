// routes/authRoutes.js
import express from "express";
import { registerUser, loginUser, refreshToken } from "../controllers/authController.js";

const router = express.Router();

router.post("/signup", registerUser);
router.post("/login", loginUser);
router.post("/refresh", refreshToken);

export default router;
