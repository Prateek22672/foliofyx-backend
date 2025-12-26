import express from "express";
import {
  registerUser,
  loginUser,
  googleLogin,
  getUserProfile,
} from "../controllers/authController.js";
import { protect } from "../middleware/authMiddleware.js"; // Assuming you have this

const router = express.Router();

router.post("/signup", registerUser);
router.post("/login", loginUser);
router.post("/google-login", googleLogin);

// Protected Route to get current user data
router.get("/me", protect, getUserProfile);

export default router;