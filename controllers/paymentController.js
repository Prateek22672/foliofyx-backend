import User from "../models/User.js";

// ✅ 1. CLAIM OFFER (Fixes 500 Error)
// server/controllers/paymentController.js

export const claimStudentOffer = async (req, res) => {
  console.log("⚡ Claim Offer Triggered");

  try {
    // 1. Get User
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ msg: 'User not found' });

    console.log(`Processing upgrade for: ${user.email}`);

    // 2. Set Dates (6 months free)
    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + 6);

    // 3. Update Fields
    user.plan = 'max';
    user.isStudent = true;
    
    // Force create subscription object
    // We replace the whole object to ensure structure is correct
    user.subscription = {
      startDate: startDate,
      endDate: endDate,
      isActive: true,
      paymentId: `OFFER_${Date.now()}`,
      provider: 'free-claim'
    };

    // ✅ CRITICAL FIX: Tell Mongoose this field changed
    // This fixes the "500 Error" if Mongoose wasn't detecting the nested update
    user.markModified('subscription');
    
    // 4. Save
    await user.save();
    console.log("✅ User upgraded successfully");

    res.json({ 
      success: true, 
      msg: 'Offer Claimed! Plan updated to Max.', 
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        plan: user.plan,
        isStudent: user.isStudent
      }
    });

  } catch (err) {
    // This logs the ACTUAL error to your backend terminal
    console.error("❌ Crash in claimStudentOffer:", err);
    // This sends the specific error to the frontend so you can see it
    res.status(500).json({ msg: `Server Error: ${err.message}` });
  }
};

// ✅ 2. CANCEL SUBSCRIPTION (Fixes Missing Export Error)
export const cancelSubscription = async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ msg: 'User not found' });

    user.plan = 'free';
    user.isStudent = false; 
    
    // Safety check before accessing properties
    if (!user.subscription) user.subscription = {};
    
    user.subscription.isActive = false;
    user.subscription.endDate = new Date(); // Expire now

    user.markModified('subscription');
    await user.save();

    res.json({ success: true, msg: "Plan Cancelled" });

  } catch (err) {
    console.error("Cancel Error:", err);
    res.status(500).send("Server Error");
  }
};

// ✅ 3. GET STATUS
export const getSubscriptionStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) return res.status(404).json({ msg: 'User not found' });

    const isActive = user.checkSubscriptionStatus(); 
    if (!isActive) await user.save(); 

    res.json({ plan: user.plan, isStudent: user.isStudent });
  } catch (err) {
    res.status(500).send('Server Error');
  }
};

// ✅ 4. UPGRADE (Mock)
export const upgradeToPro = async (req, res) => {
    // Keep your existing upgrade logic here if needed, or leave empty
    res.json({ msg: "Upgrade endpoint" });
};