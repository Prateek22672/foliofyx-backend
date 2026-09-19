// server/models/CustomWebsite.js
// Completely separate from Portfolio model.
// Stores canvas-based websites built with the custom builder.

import mongoose from "mongoose";
import { isReservedSubdomain } from "../lib/reservedSubdomains.js";
import { numberSetter, normalizeBgType, toNumber } from "../lib/sanitizeSite.js";
import { CustomDomainSchema, DOMAIN_STATUSES as SHARED_DOMAIN_STATUSES } from "./customDomainSchema.js";

// Numeric style/geometry fields accept "48px"-style strings from editors and
// AI output — the setter coerces before Mongoose casts, so no CastError.
const Num = (extra = {}) => ({ type: Number, set: numberSetter, ...extra });

// ── Element style schema ─────────────────────────────────────────────────────
const StyleSchema = new mongoose.Schema({
  fontFamily:      { type: String },
  fontSize:        Num(),
  fontWeight:      { type: String },
  fontStyle:       { type: String },
  color:           { type: String },
  textAlign:       { type: String },
  lineHeight:      Num(),
  letterSpacing:   Num(),
  textTransform:   { type: String },
  textShadow:      { type: String },
  bgColor:         { type: String },
  bgType:          { type: String, enum: ["solid", "gradient", "transparent", "image"], set: normalizeBgType },
  bgImage:         { type: String },
  bgSize:          { type: String },
  gradientFrom:    { type: String },
  gradientTo:      { type: String },
  gradientDir:     { type: String },
  borderRadius:    Num(),
  borderTopLeftRadius:     Num(),
  borderTopRightRadius:    Num(),
  borderBottomRightRadius: Num(),
  borderBottomLeftRadius:  Num(),
  borderWidth:     Num(),
  borderStyle:     { type: String },
  borderColor:     { type: String },
  padding:         Num(),
  paddingObj:      { type: mongoose.Schema.Types.Mixed },
  marginObj:       { type: mongoose.Schema.Types.Mixed },
  boxShadow:       { type: String },
  opacity:         Num(),
  objectFit:       { type: String },
  objectPosition:  { type: String },
  overflow:        { type: String },
  backdropBlur:    Num(),
  filter:          { type: String },
  mixBlendMode:    { type: String },
  cursor:          { type: String },
  rotate:          Num(),
  hoverEffect:     { type: String },
}, { _id: false });

// height is number | "auto"
const heightSetter = (v) => {
  if (v === undefined || v === null || v === "" || String(v).trim().toLowerCase() === "auto") return "auto";
  const n = toNumber(v);
  return n === undefined ? "auto" : n;
};

// ── Canvas element schema ────────────────────────────────────────────────────
const ElementSchema = new mongoose.Schema({
  id:        { type: String, required: true },
  type:      { type: String, required: true },
  x:         Num({ default: 0 }),
  y:         Num({ default: 0 }),
  width:     Num({ default: 200 }),
  height:    { type: mongoose.Schema.Types.Mixed, default: "auto", set: heightSetter },
  zIndex:    Num({ default: 1 }),
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
  animDelay: Num({ default: 0 }),
  animDuration: Num({ default: 600 }),
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
  noindex:     { type: Boolean, default: false },

  // Transitions
  scrollBehavior:  { type: String, default: "auto" },
  pageTransition:  { type: String, default: "none" },
}, { _id: false });

// Custom-domain sub-schema now lives in ./customDomainSchema.js, shared with
// Portfolio — kept re-exported here in case anything still imports it hence.
export const DOMAIN_STATUSES = SHARED_DOMAIN_STATUSES;

// ── Main CustomWebsite schema ────────────────────────────────────────────────
const CustomWebsiteSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
    index: true,
  },

  // Identity — unique+sparse index is declared once, below.
  title:    { type: String, default: "My Website" },
  slug:     { type: String, trim: true, lowercase: true },
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
    lang:        { type: String, default: "en" },
    noindex:     { type: Boolean, default: false },
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
    ...CustomDomainSchema,
  },

  // Thumbnail (auto-generated screenshot URL or manual)
  thumbnail: { type: String, default: "" },

}, { timestamps: true });

// ── Indexes ──────────────────────────────────────────────────────────────────
CustomWebsiteSchema.index({ userId: 1, createdAt: -1 });
CustomWebsiteSchema.index({ slug: 1 }, { unique: true, sparse: true });
CustomWebsiteSchema.index({ status: 1 });
// One site per domain; sparse so sites without a domain don't collide on null.
CustomWebsiteSchema.index({ "customDomain.name": 1 }, { unique: true, sparse: true });
// Domain monitor scans.
CustomWebsiteSchema.index({ "customDomain.status": 1, "customDomain.nextCheckAt": 1 });

// ── Slug generator helper ─────────────────────────────────────────────────────
const SLUG_MAX = 32;
const rand = (n) => Math.random().toString(36).slice(2, 2 + n).padEnd(n, "0");

function slugBase(title) {
  const base = String(title || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, SLUG_MAX - 6) // leave room for "-xxxxx"
    .replace(/-+$/g, "");
  return base.length >= 2 ? base : "site";
}

async function slugTaken(doc, slug) {
  const Model = doc.constructor;
  if (await Model.exists({ slug, _id: { $ne: doc._id } })) return true;
  const Portfolio = mongoose.models.Portfolio;
  if (Portfolio && (await Portfolio.exists({ username: slug }))) return true;
  return false;
}

CustomWebsiteSchema.pre("save", async function (next) {
  try {
    if (!this.slug) {
      const base = slugBase(this.title);
      let candidate = `${base}-${rand(5)}`;
      for (let i = 0; i < 5 && (isReservedSubdomain(candidate) || (await slugTaken(this, candidate))); i++) {
        candidate = `${base}-${rand(5)}`;
      }
      this.slug = candidate;
    }
    // Reserved labels (www, api, admin…) double as *.foliofyx.in subdomains —
    // suffix rather than reject so an unlucky title never blocks a save.
    if (this.slug && isReservedSubdomain(this.slug)) {
      this.slug = `${this.slug.slice(0, SLUG_MAX - 5)}-${rand(4)}`;
    }
    next();
  } catch (err) {
    next(err);
  }
});

export default mongoose.model("CustomWebsite", CustomWebsiteSchema);
