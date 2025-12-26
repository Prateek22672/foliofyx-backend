import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, default: "" },

    // ✅ NEW: SUBSCRIPTION FIELDS
    plan: { 
      type: String, 
      enum: ['free', 'plus', 'max'], 
      default: 'free' 
    },
    subscription: {
      startDate: { type: Date },
      endDate: { type: Date }, // Critical for expiration
      isActive: { type: Boolean, default: false },
      paymentId: { type: String }, // To store PhonePe Transaction ID later
      provider: { type: String, default: 'manual' } // 'phonepe', 'manual', etc.
    },
  },
  { timestamps: true }
);

// ✅ METHOD: Check Expiration
// Call this whenever you fetch the user to ensure status is real-time
userSchema.methods.checkSubscriptionStatus = function() {
  // Only check if they are NOT free and have an end date
  if (this.plan !== 'free' && this.subscription.endDate) {
    const today = new Date();
    // If today is past the end date
    if (today > this.subscription.endDate) {
      this.plan = 'free';
      this.subscription.isActive = false;
      return false; // Expired
    }
  }
  return true; // Active
};

export default mongoose.model("User", userSchema);