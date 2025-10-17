import express from "express";
import multer from "multer";
import path from "path";
import {
  savePortfolio,
  getPortfolio,
  getAllPortfolios,
  deletePortfolio,
} from "../controllers/portfolioController.js";

const router = express.Router();

// ✅ Multer setup for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, "uploads/"),
  filename: (req, file, cb) =>
    cb(null, `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`),
});

const upload = multer({
  storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB limit
  fileFilter: (req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/jpg"];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error("Only .png, .jpg, and .jpeg allowed"));
    }
    cb(null, true);
  },
});

// ✅ Routes
router.post("/", upload.single("image"), savePortfolio);
router.get("/", getAllPortfolios);
router.delete("/:id", deletePortfolio);
router.get("/:id", getPortfolio);

export default router;
