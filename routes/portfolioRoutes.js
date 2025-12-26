import express from "express";
import { 
  savePortfolio, 
  getAllPortfolios, 
  getPortfolio, 
  deletePortfolio,
  getPublicPortfolios // ✅ Import this
} from "../controllers/portfolioController.js";

const router = express.Router();

router.post("/create", savePortfolio); 
router.put("/:id", savePortfolio);
router.get("/all", getAllPortfolios);

// ✅ NEW: Public Route (MUST BE BEFORE /:id)
router.get("/public", getPublicPortfolios);

router.get("/:id", getPortfolio);
router.delete("/:id", deletePortfolio);

export default router;