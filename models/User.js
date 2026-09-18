import mongoose from "mongoose";

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    
    // ✅ FIX: Remove 'required: true' to support Google/OAuth users
    password: { type: String, default: "" }, 
    
    // Verification Flag
    isStudent: { type: Boolean, default: false },

    // Admin dashboard access (also granted via ADMIN_EMAILS).
    role: { type: String, enum: ["user", "admin"], default: "user" },
    // Updated at most every few minutes by the auth middleware.
    lastActiveAt: { type: Date, index: true },

    // Plan Field
    plan: { 
      type: String, 
      enum: ['free', 'max'], 
      default: 'free' 
    },

    // Subscription Object
    subscription: {
      startDate: { type: Date },
      endDate: { type: Date },
      isActive: { type: Boolean, default: false },
      paymentId: { type: String },
      provider: { type: String }
    },
  },
  { timestamps: true }
);

// Helper Method
userSchema.methods.checkSubscriptionStatus = function() {
  if (this.plan !== 'free' && this.subscription && this.subscription.endDate) {
    const today = new Date();
    if (today > this.subscription.endDate) {
      this.plan = 'free';
      this.subscription.isActive = false;
      return false; // Expired
    }
  }
  return true; // Active
};

export default mongoose.model("User", userSchema);