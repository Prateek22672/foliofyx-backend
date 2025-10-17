import Portfolio from "../models/Portfolio.js";
import jwt from "jsonwebtoken";
import User from "../models/User.js";
import path from "path";
import fs from "fs";

// ✅ Helper: Verify JWT manually
const verifyUser = async (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Unauthorized: No token provided");
  }

  const token = authHeader.split(" ")[1];
  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded.id).select("-password");

  if (!user) throw new Error("User not found");
  return user;
};

// ✅ Save or Update Portfolio (Protected)
export const savePortfolio = async (req, res) => {
  try {
    const user = await verifyUser(req);
    const userId = user._id;
    const { _id, ...data } = req.body;

    let existingPortfolio = null;
    if (_id) {
      existingPortfolio = await Portfolio.findOne({ _id, userId });
    }

    // ✅ If a new file is uploaded
    let imagePath = existingPortfolio?.image || "";
    if (req.file) {
      // Delete old image if it exists and was a local upload
      if (
        existingPortfolio?.image &&
        existingPortfolio.image.startsWith("/uploads/")
      ) {
        const oldPath = path.join(process.cwd(), existingPortfolio.image);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      // Save new image path
      imagePath = `/uploads/${req.file.filename}`;
    } else if (data.image && !data.image.startsWith("/uploads/")) {
      // For base64 images or direct URL (no file upload)
      imagePath = data.image;
    }

    const cleanData = {
      ...data,
      userId,
      image: imagePath,
      name: data.name || "",
      role: data.role || "",
      bio: data.bio || "",
      experience: data.experience || "",
      education: data.education || "",
      linkedin: data.linkedin || "",
      github: data.github || "",
      email: data.email || "",
      skills: Array.isArray(data.skills)
        ? data.skills.map((s) =>
            typeof s === "string" ? { name: s, level: "Intermediate" } : s
          )
        : [],
      projects: Array.isArray(data.projects)
        ? data.projects.map((p) =>
            typeof p === "string" ? { title: p, tech: "" } : p
          )
        : [],
    };

    let portfolio;
    if (existingPortfolio) {
      portfolio = await Portfolio.findOneAndUpdate(
        { _id, userId },
        cleanData,
        { new: true }
      );
    } else {
      portfolio = await Portfolio.create(cleanData);
    }

    res.status(201).json({ message: "Portfolio saved", id: portfolio._id });
  } catch (err) {
    console.error("❌ Save Portfolio Error:", err.message);
    res.status(401).json({ message: err.message || "Unauthorized" });
  }
};


// ✅ Get All Portfolios (for the logged-in user)
export const getAllPortfolios = async (req, res) => {
  try {
    const user = await verifyUser(req);
    const portfolios = await Portfolio.find({ userId: user._id }).sort({
      createdAt: -1,
    });
    res.json(portfolios);
  } catch (err) {
    console.error("❌ Fetch All Portfolios Error:", err.message);
    res.status(401).json({ message: err.message });
  }
};

// ✅ Get Single Portfolio (public)
export const getPortfolio = async (req, res) => {
  try {
    const portfolio = await Portfolio.findById(req.params.id);
    if (!portfolio)
      return res.status(404).json({ message: "Portfolio not found" });
    res.json(portfolio);
  } catch (err) {
    console.error("❌ Get Portfolio Error:", err.message);
    res.status(500).json({ message: "Error fetching portfolio" });
  }
};

// ✅ Delete Portfolio (protected)
export const deletePortfolio = async (req, res) => {
  try {
    const user = await verifyUser(req);
    const deleted = await Portfolio.findOneAndDelete({
      _id: req.params.id,
      userId: user._id,
    });

    if (!deleted)
      return res
        .status(404)
        .json({ message: "Portfolio not found or not owned by user" });

    // Optional: delete image file if exists
    if (deleted.image && deleted.image.startsWith("/uploads/")) {
      const imagePath = path.join(process.cwd(), deleted.image);
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
    }

    res.json({ message: "Portfolio deleted successfully", id: req.params.id });
  } catch (err) {
    console.error("❌ Delete Portfolio Error:", err.message);
    res.status(401).json({ message: err.message });
  }
};
