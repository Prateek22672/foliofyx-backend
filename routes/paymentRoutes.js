import express from 'express';
// ✅ Import ALL functions
import { 
  claimStudentOffer, 
  cancelSubscription, 
  getSubscriptionStatus,
  upgradeToPro 
} from '../controllers/paymentController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/status', protect, getSubscriptionStatus);
router.post('/claim-offer', protect, claimStudentOffer);
router.post('/cancel', protect, cancelSubscription);
router.post('/upgrade', protect, upgradeToPro);

export default router;