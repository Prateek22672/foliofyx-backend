// controllers/authController.js
import User from "../models/User.js";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// Helper — generate both tokens
const generateTokens = (user) => {
  // ensure secrets exist
  if (!process.env.JWT_SECRET || !process.env.REFRESH_SECRET) {
    throw new Error("Missing JWT_SECRET or REFRESH_SECRET in environment");
  }

  const accessToken = jwt.sign(
    { id: user._id, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRE || "15m" }
  );

  const refreshToken = jwt.sign(
    { id: user._id, email: user.email },
    process.env.REFRESH_SECRET,
    { expiresIn: process.env.REFRESH_EXPIRE || "7d" }
  );

  return { accessToken, refreshToken };
};

// REGISTER
export const registerUser = async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: "Missing fields" });

    const existing = await User.findOne({ email });
    if (existing)
      return res.status(400).json({ message: "User already exists" });

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ name, email, password: hashed });

    const { accessToken, refreshToken } = generateTokens(user);

    res.status(201).json({
      message: "User registered successfully",
      accessToken,
      refreshToken,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error("registerUser error:", err);
    // If our helper threw about missing env, return clear message
    if (err.message && err.message.includes("Missing JWT_SECRET"))
      return res.status(500).json({ message: err.message });
    res.status(500).json({ message: "Server error" });
  }
};

// LOGIN
export const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: "Missing fields" });

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ message: "Invalid credentials" });

    const { accessToken, refreshToken } = generateTokens(user);

    res.json({
      message: "Login successful",
      accessToken,
      refreshToken,
      user: { id: user._id, name: user.name, email: user.email },
    });
  } catch (err) {
    console.error("loginUser error:", err);
    if (err.message && err.message.includes("Missing JWT_SECRET"))
      return res.status(500).json({ message: err.message });
    res.status(500).json({ message: "Server error" });
  }
};

// REFRESH TOKEN
export const refreshToken = (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken)
    return res.status(401).json({ message: "No refresh token provided" });

  if (!process.env.REFRESH_SECRET || !process.env.JWT_SECRET) {
    return res.status(500).json({ message: "Missing JWT secrets in server env" });
  }

  jwt.verify(refreshToken, process.env.REFRESH_SECRET, (err, decoded) => {
    if (err)
      return res.status(403).json({ message: "Invalid or expired refresh token" });

    const newAccessToken = jwt.sign(
      { id: decoded.id, email: decoded.email },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRE || "15m" }
    );

    res.json({ accessToken: newAccessToken });
  });
};
