import jwt from "jsonwebtoken";
import User from "../models/User.js";

const ACTIVE_WRITE_EVERY_MS = 5 * 60 * 1000;

export const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Not authorized, no token" });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await User.findById(decoded.id).select("-password");

    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    // Activity for the admin dashboard; throttled and never blocks the request.
    if (!user.lastActiveAt || Date.now() - user.lastActiveAt.getTime() > ACTIVE_WRITE_EVERY_MS) {
      User.updateOne({ _id: user._id }, { $set: { lastActiveAt: new Date() } }).catch(() => {});
    }

    req.user = user;
    next();
  } catch (err) {
    if (err?.name !== "TokenExpiredError" && err?.name !== "JsonWebTokenError") {
      console.error("Auth middleware error:", err.message);
    }
    return res.status(401).json({ message: "Not authorized" });
  }
};

// The owner's account is always an admin. ADMIN_EMAILS (comma separated) adds more.
const OWNER_ADMIN_EMAILS = ["prateek.koratala@gmail.com"];

const adminEmails = () =>
  new Set([
    ...OWNER_ADMIN_EMAILS,
    ...String(process.env.ADMIN_EMAILS || "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean),
  ]);

export const isAdminUser = (user) => Boolean(user) && (user.role === "admin" || adminEmails().has(String(user.email || "").toLowerCase()));

/** Use after `protect`. */
export const adminOnly = (req, res, next) => {
  if (!isAdminUser(req.user)) return res.status(403).json({ message: "Admin access required." });
  next();
};
