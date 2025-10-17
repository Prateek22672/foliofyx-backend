import mongoose from "mongoose";

// 🧠 Skill Schema
const skillSchema = new mongoose.Schema({
  name: { type: String, required: true },
  level: { type: String, default: "Intermediate" },
});

// 💼 Project Schema
const projectSchema = new mongoose.Schema({
  title: { type: String, required: true },
  tech: { type: String, default: "" },
  github: { type: String, default: "" },
  demo: { type: String, default: "" },
});

// 🖼️ Portfolio Schema
const portfolioSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    name: { type: String, default: "" },
    role: { type: String, default: "" },
    cvLink: { type: String, default: "" },
    bio: { type: String, default: "" },
    experience: { type: String, default: "" },
    education: { type: String, default: "" },
    skills: { type: [skillSchema], default: [] },
    projects: { type: [projectSchema], default: [] },
    linkedin: { type: String, default: "" },
    github: { type: String, default: "" },
    email: { type: String, default: "" },
    image: { type: String, default: "/uploads/default-profile.jpg" }, // ✅ for uploaded profile picture
  },
  { timestamps: true }
);

export default mongoose.model("Portfolio", portfolioSchema);
