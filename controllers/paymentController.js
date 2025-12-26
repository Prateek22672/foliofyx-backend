import User from "../models/User.js";

// Plan Configurations
const PLANS = {
  plus: { months: 3, price: 29 }, // Mock price
  max: { months: 6, price: 59 }   // Mock price
};

// @desc    Simulate successful payment (MOCK)
// @route   POST /api/payment/mock-success
// @access  Private
export const mockPaymentSuccess = async (req, res) => {
  const { planType, paymentId } = req.body; // Expects 'plus' or 'max'
  const userId = req.user.id; // Comes from authMiddleware

  try {
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ msg: 'User not found' });

    if (!PLANS[planType]) {
      return res.status(400).json({ msg: 'Invalid plan type' });
    }

    // 1. Calculate Expiration Date
    const startDate = new Date();
    const endDate = new Date();
    // Add months to current date
    endDate.setMonth(endDate.getMonth() + PLANS[planType].months);

    // 2. Update User Record
    user.plan = planType;
    user.subscription = {
      startDate: startDate,
      endDate: endDate,
      isActive: true,
      paymentId: paymentId || `MOCK_${Date.now()}`,
      provider: 'mock'
    };

    await user.save();

    res.json({ 
      success: true, 
      msg: `Successfully upgraded to ${planType}`, 
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        subscription: user.subscription
      }
    });

  } catch (err) {
    console.error("Payment Controller Error:", err.message);
    res.status(500).send('Server Error');
  }
};

// @desc    Real PhonePe Callback (Placeholder for future)
// @route   POST /api/payment/callback
export const phonePeCallback = async (req, res) => {
    // Logic for verifying X-VERIFY header and decoding body goes here
    console.log("PhonePe Callback Received");
    res.send({ status: "success" });
};



// ✅ NEW: Cancel Subscription
// @route   POST /api/payment/cancel
export const cancelSubscription = async (req, res) => {
    try {
        const user = await User.findById(req.user.id);
        
        if (!user) return res.status(404).json({ msg: 'User not found' });

        // Revert to free
        user.plan = 'free';
        user.subscription.isActive = false;
        user.subscription.endDate = new Date(); // Expire immediately

        await user.save();

        res.json({ 
            success: true, 
            msg: "Subscription cancelled. You are now on the Free plan.",
            user: {
                id: user._id,
                name: user.name,
                email: user.email,
                plan: user.plan
            }
        });

    } catch (err) {
        console.error("Cancel Error:", err);
        res.status(500).send("Server Error");
    }
};