// server/models/MonitorEvent.js
// Operational events for the admin dashboard: server errors, slow requests,
// AI calls and AI-builder generations. Auto-expire after 30 days.

import mongoose from "mongoose";

const MonitorEventSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ["error", "slow", "ai", "builder", "domain", "auth", "resume_parse"], required: true, index: true },
    at: { type: Date, default: Date.now },
    ok: { type: Boolean, default: true },
    route: { type: String },
    method: { type: String },
    status: { type: Number },
    ms: { type: Number },
    message: { type: String },
    stack: { type: String },
    model: { type: String },
    feature: { type: String },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    meta: { type: mongoose.Schema.Types.Mixed },
  },
  { versionKey: false }
);

MonitorEventSchema.index({ at: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
MonitorEventSchema.index({ type: 1, at: -1 });

export default mongoose.model("MonitorEvent", MonitorEventSchema);
