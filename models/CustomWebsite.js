// server/models/CustomWebsite.js
// Completely separate from Portfolio model.
// Stores canvas-based websites built with the custom builder.

import mongoose from "mongoose";

// ── Element style schema ─────────────────────────────────────────────────────
const StyleSchema = new mongoose.Schema({
  fontFamily:      { type: String },
  fontSize:        { type: Number },
  fontWeight:      { type: String },
  fontStyle:       { type: String },
  color:           { type: String },
  textAlign:       { type: String },
  lineHeight:      { type: Number },
  letterSpacing:   { type: Number },
  textTransform:   { type: String },
  textShadow:      { type: String },
  bgColor:         { type: String },
  bgType:          { type: String, enum: ["solid", "gradient", "transparent", "image"] },
  bgImage:         { type: String },
  bgSize:          { type: String },
  gradientFrom:    { type: String },
  gradientTo:      { type: String },
  gradientDir:     { type: String },
  borderRadius:    { type: Number },
  borderTopLeftRadius:     { type: Number },
  borderTopRightRadius:    { type: Number },
  borderBottomRightRadius: { type: Number },
  borderBottomLeftRadius:  { type: Number },
  borderWidth:     { type: Number },
  borderStyle:     { type: String },
  borderColor:     { type: String },
  padding:         { type: Number },
  paddingObj:      { type: mongoose.Schema.Types.Mixed },
  marginObj:       { type: mongoose.Schema.Types.Mixed },
  boxShadow:       { type: String },
  opacity:         { type: Number },
  objectFit:       { type: String },
  objectPosition:  { type: String },
  overflow:        { type: String },
  backdropBlur:    { type: Number },
  filter:          { type: String },
  mixBlendMode:    { type: String },
  cursor:          { type: String },
  rotate:          { type: Number },
  hoverEffect:     { type: String },
}, { _id: false });

// ── Canvas element schema ────────────────────────────────────────────────────
const ElementSchema = new mongoose.Schema({
  id:        { type: String, required: true },
  type:      { type: String, required: true },
  x:         { type: Number, default: 0 },
  y:         { type: Number, default: 0 },
  width:     { type: Number, default: 200 },
  height:    { type: mongoose.Schema.Types.Mixed, default: "auto" }, // number or "auto"
  zIndex:    { type: Number, default: 1 },
  visible:   { type: Boolean, default: true },
  locked:    { type: Boolean, default: false },
  content:   { type: String, default: "" },
  src:       { type: String, default: "" },
  alt:       { type: String, default: "" },
  href:      { type: String, default: "" },
  target:    { type: String, default: "_self" },
  className: { type: String, default: "" },
  htmlId:    { type: String, default: "" },
  linkWrap:  { type: String, default: "" },
  animation: { type: String, default: "none" },
  animDelay: { type: Number, default: 0 },
  animDuration: { type: Number, default: 600 },
  styles:    { type: StyleSchema, default: () => ({}) },
}, { _id: false });

// ── Page schema ──────────────────────────────────────────────────────────────
const PageSchema = new mongoose.Schema({
  id:          { type: String, required: true },
  name:        { type: String, default: "Page" },
  slug:        { type: String, default: "/" },
  pageType:    { type: String, default: "page" },
  elements:    { type: [ElementSchema], default: [] },

  // Background
  bgType:      { type: String, default: "solid" },
  bgColor:     { type: String, default: "#ffffff" },
  bgImage:     { type: String },
  bgSize:      { type: String, default: "cover" },
  bgPos:       { type: String, default: "center" },
  bgRepeat:    { type: String, default: "no-repeat" },
  bgParallax:  { type: Boolean, default: false },
  bgOverlay:   { type: String, default: "none" },
  bgPattern:   { type: String, default: "none" },
  gradFrom:    { type: String },
  gradTo:      { type: String },
  gradDir:     { type: String, default: "135deg" },

  // Layout
  maxWidth:    { type: String, default: "100%" },
  minHeight:   { type: String, default: "100vh" },
  overflow:    { type: String, default: "auto" },

  // SEO
  seoTitle:    { type: String, default: "" },
  seoDesc:     { type: String, default: "" },
  ogImage:     { type: String, default: "" },
  hiddenFromNav: { type: Boolean, default: false },

  // Transitions
  scrollBehavior:  { type: String, default: "auto" },
  pageTransition:  { type: String, default: "none" },
}, { _id: false });

// ── Main CustomWebsite schema ────────────────────────────────────────────────
const CustomWebsiteSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },

  // Identity
  title:    { type: String, default: "My Website" },
  slug:     { type: String, unique: true, sparse: true, trim: true, lowercase: true },
  industry: { type: String, default: "general" },

  // Status
  status: {
    type: String,
    enum: ["draft", "published", "archived"],
    default: "draft",
  },

  // Canvas layout
  pages:      { type: [PageSchema], default: [] },
  activePage: { type: String, default: "" },

  // Global site settings
  settings: {
    favicon:     { type: String, default: "" },
    globalFont:  { type: String, default: "DM Sans" },
    globalBg:    { type: String, default: "#ffffff" },
    globalAccent:{ type: String, default: "#6366f1" },
    customCSS:   { type: String, default: "" },
    googleAnalyticsId: { type: String, default: "" },
    metaTitle:   { type: String, default: "" },
    metaDesc:    { type: String, default: "" },
  },

  // AI generation history (last 10)
  aiHistory: [{
    prompt:    { type: String },
    industry:  { type: String },
    elemCount: { type: Number },
    createdAt: { type: Date, default: Date.now },
  }],

  // Publish info
  publishedAt: { type: Date },
  publishedUrl:{ type: String, default: "" },

  // Custom domain (DNS) connection
  customDomain: {
    name:              { type: String, lowercase: true, trim: true }, // e.g. "mystudio.com"
    status:            { type: String, enum: ["pending", "verified", "live", "failed"], default: undefined },
    verificationToken: { type: String },
    verifiedAt:        { type: Date },
    lastCheckedAt:     { type: Date },
    lastError:         { type: String },
  },

  // Thumbnail (auto-generated screenshot URL or manual)
  thumbnail: { type: String, default: "" },

}, { timestamps: true });

// ── Indexes ──────────────────────────────────────────────────────────────────
CustomWebsiteSchema.index({ userId: 1, createdAt: -1 });
CustomWebsiteSchema.index({ slug: 1 });
CustomWebsiteSchema.index({ status: 1 });
// One site per domain; sparse so sites without a domain don't collide on null.
CustomWebsiteSchema.index({ "customDomain.name": 1 }, { unique: true, sparse: true });

// ── Slug generator helper ─────────────────────────────────────────────────────
CustomWebsiteSchema.pre("save", async function (next) {
  if (!this.slug && this.title) {
    const base = this.title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 40);
    const rand  = Math.random().toString(36).slice(2, 7);
    this.slug   = `${base}-${rand}`;
  }
  next();
});

export default mongoose.model("CustomWebsite", CustomWebsiteSchema);