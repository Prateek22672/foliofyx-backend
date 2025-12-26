import Portfolio from "../models/Portfolio.js";
import User from "../models/User.js";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";

const verifyUser = async (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("Unauthorized: No token provided");
  }

  const token = authHeader.split(" ")[1];
  if (!process.env.JWT_SECRET) {
    throw new Error("Server Error: JWT_SECRET is not defined");
  }

  const decoded = jwt.verify(token, process.env.JWT_SECRET);
  const user = await User.findById(decoded.id).select("-password");

  if (!user) throw new Error("User not found");
  return user;
};

// =========================================================
// 💾 SAVE / UPDATE PORTFOLIO
// =========================================================
export const savePortfolio = async (req, res) => {
  try {
    const user = await verifyUser(req);
    const userId = user._id;

    const targetId = req.params.id || req.body._id; 
    const { _id, ...data } = req.body;

    // --- PARSE ARRAYS ---
    let skillsData = data.skills;
    if (typeof skillsData === 'string') {
        try { skillsData = JSON.parse(skillsData); } catch (e) { skillsData = []; }
    }
    
    let projectsData = data.projects;
    if (typeof projectsData === 'string') {
        try { projectsData = JSON.parse(projectsData); } catch (e) { projectsData = []; }
    }

    let experienceData = data.experience;
    if (typeof experienceData === 'string') {
        if (experienceData.trim().startsWith("[")) {
            try { experienceData = JSON.parse(experienceData); } catch (e) { experienceData = []; }
        } else {
            experienceData = [{
                company: "General",
                role: "Experience", 
                period: experienceData, 
                desc: "Total professional experience"
            }];
        }
    }

    // --- IMAGE HANDLING ---
    let existingPortfolio = null;
    if (targetId) {
      existingPortfolio = await Portfolio.findOne({ _id: targetId, userId });
    }

    let imagePath = existingPortfolio?.image || "";
    if (req.file) {
      if (existingPortfolio?.image && existingPortfolio.image.startsWith("/uploads/")) {
        const oldPath = path.join(process.cwd(), existingPortfolio.image);
        if (fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath); } catch(e) { console.error("Failed to delete old image"); }
        }
      }
      imagePath = `/uploads/${req.file.filename}`;
    } else if (data.image) {
      imagePath = data.image;
    }

    // --- PREPARE CLEAN DATA ---
    const cleanData = {
      ...data,
      userId,
      template: data.template || existingPortfolio?.template || "modern",
      image: imagePath,
      username: data.username || undefined,

      // ✅ ADDED: Explicitly handle Chatbot Boolean
      enableChatbot: String(data.enableChatbot) === "true",

      isPublic: String(data.isPublic) === "true",
      
      themeBg: data.themeBg || existingPortfolio?.themeBg || "#000000",
      themeFont: data.themeFont || existingPortfolio?.themeFont || "#FFFFFF",
      accentColor: data.accentColor || existingPortfolio?.accentColor || "#A855F7",
      headerColor: data.headerColor || existingPortfolio?.headerColor || "#000000",

      name: data.name || "",
      role: data.role || "",
      bio: data.bio || "",
      education: data.education || "",
      linkedin: data.linkedin || "",
      github: data.github || "",
      email: data.email || "",
      cvLink: data.cvLink || "",

      skills: Array.isArray(skillsData) ? skillsData : [],
      projects: Array.isArray(projectsData) ? projectsData : [],
      experience: Array.isArray(experienceData) ? experienceData : [],
    };

    // --- DB OPERATION ---
    let portfolio;
    if (existingPortfolio) {
      portfolio = await Portfolio.findByIdAndUpdate(targetId, cleanData, { new: true });
    } else {
      portfolio = await Portfolio.create(cleanData);
    }

    res.status(201).json(portfolio);

  } catch (err) {
    console.error("❌ Save Portfolio Error:", err.message);
    if (err.code === 11000 && err.keyPattern && err.keyPattern.username) {
        return res.status(400).json({ message: "Username already taken. Please choose another." });
    }
    res.status(500).json({ message: err.message || "Failed to save portfolio" });
  }
};

// =========================================================
// 🔍 GET SINGLE PORTFOLIO
// =========================================================
export const getPortfolio = async (req, res) => {
  try {
    const { id } = req.params;
    const isMongoId = /^[0-9a-fA-F]{24}$/.test(id);

    let query;
    if (isMongoId) {
        query = { _id: id };
    } else {
        query = { username: id };
    }

    const portfolio = await Portfolio.findOne(query).populate("userId", "name email");

    if (!portfolio) {
        return res.status(404).json({ message: "Portfolio not found" });
    }

    res.json(portfolio);
  } catch (err) {
    console.error("Fetch Error:", err);
    res.status(500).json({ message: "Error fetching portfolio" });
  }
};

// =========================================================
// 📂 GET ALL USER PORTFOLIOS
// =========================================================
export const getAllPortfolios = async (req, res) => {
  try {
    const user = await verifyUser(req);
    const portfolios = await Portfolio.find({ userId: user._id }).sort({ createdAt: -1 });
    res.json(portfolios);
  } catch (err) {
    res.status(401).json({ message: err.message });
  }
};

// =========================================================
// 🌍 GET PUBLIC PORTFOLIOS
// =========================================================
export const getPublicPortfolios = async (req, res) => {
  try {
    const portfolios = await Portfolio.find({ isPublic: true })
        .sort({ createdAt: -1 })
        .populate("userId", "name email"); 
    res.json(portfolios);
  } catch (err) {
    console.error("Public Fetch Error:", err);
    res.status(500).json({ message: "Failed to fetch talents" });
  }
};

// =========================================================
// 🗑️ DELETE PORTFOLIO
// =========================================================
export const deletePortfolio = async (req, res) => {
  try {
    const user = await verifyUser(req);
    const deleted = await Portfolio.findOneAndDelete({ _id: req.params.id, userId: user._id });
    
    if (!deleted) return res.status(404).json({ message: "Not found or unauthorized" });
    
    if (deleted.image && deleted.image.startsWith("/uploads/")) {
        const filePath = path.join(process.cwd(), deleted.image);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }

    res.json({ message: "Portfolio deleted successfully" });
  } catch (err) {
    res.status(401).json({ message: err.message });
  }
};