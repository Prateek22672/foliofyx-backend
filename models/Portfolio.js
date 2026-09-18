import mongoose from "mongoose";

const ExperienceSchema = new mongoose.Schema({
  company: { type: String, default: "General" },
  role: { type: String, default: "Experience" },
  period: { type: String, default: "" },
  desc: { type: String, default: "" }
}, { _id: false });

const SkillSchema = new mongoose.Schema({
  name: { type: String, required: true },
  level: { type: String, default: "Intermediate" }
}, { _id: false });

const ProjectSchema = new mongoose.Schema({
  title: { type: String, required: true },
  tech: { type: String, default: "" },
  github: { type: String, default: "" },
  demo: { type: String, default: "" },
  description: { type: String, default: "" } 
}, { _id: false });

const PortfolioSchema = new mongoose.Schema(
  {
    userId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true 
    },
    
    // Doubles as the <username>.foliofyx.in subdomain label, so it follows the
    // same rules as CustomWebsite slugs: 3-32 chars of a-z, 0-9 and hyphens.
    // Mongoose only validates it when the value changes, so legacy usernames load.
    username: {
      type: String,
      unique: true,
      sparse: true,
      trim: true,
      lowercase: true,
      validate: {
        validator: (v) => v === undefined || v === null || v === "" || /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(v),
        message: "Username must be 3-32 characters: letters, numbers and hyphens (not at the start or end).",
      },
    },

    name: { type: String, required: true },
    template: { type: String, default: "modern" },
    role: { type: String, default: "" },
    bio: { type: String, default: "" },
    
    education: { type: String, default: "" }, 
    
    // ✅ ADDED LOCATION FIELD
    // This allows you to store specific location data separately from extraText
    location: { type: String, default: "India" }, 
    caption: { type: String, default: "" },
    
    currentFocus: { type: String, default: "" }, 

    // ✅ KEEPING EXTRATEXT
    // Your Pulse About page is currently saving "Location" here
    extraText: { type: String, default: "" }, 
    
    image: { type: String, default: "" },

    // AI Status
    enableChatbot: { type: Boolean, default: false },

    experience: [ExperienceSchema],
    skills: [SkillSchema],
    projects: [ProjectSchema],

    linkedin: { type: String, default: "" },
    github: { type: String, default: "" },
    email: { type: String, default: "" },
    cvLink: { type: String, default: "" },

    // THEME SETTINGS
    themeBg: { type: String, default: "#ffffff" },
    themeFont: { type: String, default: "#000000" },
    themeFontFamily: { type: String, default: "Switzer, sans-serif" }, 
    accentColor: { type: String, default: "#000000" },

    // Personal touches layered over the theme (heading font and weight, image
    // corners, page texture). Sanitised in portfolioController.
    design: { type: mongoose.Schema.Types.Mixed, default: null },

    // CUSTOM BUILDER LAYOUT
    // Free-form canvas document for the "custom" template (pages → elements).
    // Mixed type so the whole builder document persists without a rigid schema.
    // Without this field, Mongoose strict mode silently drops the canvas on save.
    customLayout: { type: mongoose.Schema.Types.Mixed, default: null },

    isPublic: { type: Boolean, default: false }
  },
  { timestamps: true }
);

export default mongoose.model("Portfolio", PortfolioSchema);