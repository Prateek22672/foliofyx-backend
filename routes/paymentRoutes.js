import express from "express";
import { mockPaymentSuccess, phonePeCallback, cancelSubscription } from "../controllers/paymentController.js";
import { protect } from "../middleware/authMiddleware.js";

const router = express.Router();

router.post('/mock-success', protect, mockPaymentSuccess);
router.post('/callback', phonePeCallback);
// ✅ NEW: Cancel Route
router.post('/cancel', protect, cancelSubscription);

export default router;