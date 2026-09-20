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

// Like `protect`, but never blocks: a valid token attaches req.user, a
// missing or bad one just leaves it undefined and the request proceeds
// anonymously. For endpoints that work for guests (AI Builder chat, resume
// parsing) but still want to know who's asking when a token is present.
export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) return next();

    const token = authHeader.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id).select("-password");
    if (user) {
      if (!user.lastActiveAt || Date.now() - user.lastActiveAt.getTime() > ACTIVE_WRITE_EVERY_MS) {
        User.updateOne({ _id: user._id }, { $set: { lastActiveAt: new Date() } }).catch(() => {});
      }
      req.user = user;
    }
  } catch {
    // Expired/invalid token on an optional-auth route: proceed as a guest
    // rather than 401ing — the caller can still act anonymously.
  }
  next();
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
