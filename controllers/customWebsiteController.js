// server/controllers/customWebsiteController.js

import CustomWebsite from "../models/CustomWebsite.js";
import mongoose from "mongoose";

// ── Helper: verify ownership ──────────────────────────────────────────────────
async function getOwnedSite(siteId, userId) {
  if (!mongoose.Types.ObjectId.isValid(siteId)) return null;
  return CustomWebsite.findOne({ _id: siteId, userId });
}

// ── CREATE ────────────────────────────────────────────────────────────────────
export async function createWebsite(req, res) {
  try {
    const { title, industry, pages, activePage, settings } = req.body;
    const userId = req.user._id;

    // Default first page
    const defaultPage = {
      id:       `page_${Date.now()}`,
      name:     "Home",
      slug:     "/",
      pageType: "page",
      elements: [],
      bgColor:  "#ffffff",
      bgType:   "solid",
    };

    const site = await CustomWebsite.create({
      userId,
      title:      title || "My Website",
      industry:   industry || "general",
      pages:      pages || [defaultPage],
      activePage: activePage || defaultPage.id,
      settings:   settings || {},
    });

    res.status(201).json({ success: true, site });
  } catch (err) {
    console.error("[customWebsite] create:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET ONE ───────────────────────────────────────────────────────────────────
export async function getWebsite(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return res.status(404).json({ success: false, message: "Website not found" });
    res.json({ success: true, site });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET ALL FOR USER ──────────────────────────────────────────────────────────
export async function getUserWebsites(req, res) {
  try {
    const sites = await CustomWebsite.find(
      { userId: req.user._id },
      { title: 1, slug: 1, industry: 1, status: 1, thumbnail: 1, updatedAt: 1, "pages.name": 1 }
    ).sort({ updatedAt: -1 }).limit(50);

    res.json({ success: true, sites });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── SAVE / AUTO-SAVE ──────────────────────────────────────────────────────────
// Called on every auto-save (debounced 3s on client)
export async function saveWebsite(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return res.status(404).json({ success: false, message: "Website not found" });

    const { pages, activePage, title, industry, settings, thumbnail } = req.body;

    if (pages      !== undefined) site.pages      = pages;
    if (activePage !== undefined) site.activePage = activePage;
    if (title      !== undefined) site.title      = title;
    if (industry   !== undefined) site.industry   = industry;
    if (settings   !== undefined) site.settings   = { ...site.settings, ...settings };
    if (thumbnail  !== undefined) site.thumbnail  = thumbnail;

    await site.save();
    res.json({ success: true, updatedAt: site.updatedAt });
  } catch (err) {
    console.error("[customWebsite] save:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── PUBLISH ───────────────────────────────────────────────────────────────────
export async function publishWebsite(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return res.status(404).json({ success: false, message: "Website not found" });

    site.status       = "published";
    site.publishedAt  = new Date();
    // The SSR host that actually serves /site/:slug (this API server) —
    // override with PUBLIC_SITE_BASE when it lives behind its own domain.
    const base = process.env.PUBLIC_SITE_BASE || `${req.protocol}://${req.get("host")}`;
    site.publishedUrl = `${base}/site/${site.slug}`;

    await site.save();
    res.json({
      success: true,
      publishedUrl: site.publishedUrl,
      // Wildcard subdomain (needs the *.foliofyx.in DNS record + wildcard
      // domain on the host — see the host middleware in server.js).
      subdomainUrl: `https://${site.slug}.foliofyx.in`,
      slug: site.slug,
      customDomain: site.customDomain?.status === "live" ? site.customDomain.name : null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── UNPUBLISH ─────────────────────────────────────────────────────────────────
export async function unpublishWebsite(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return res.status(404).json({ success: false, message: "Website not found" });

    site.status = "draft";
    await site.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────
export async function deleteWebsite(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return res.status(404).json({ success: false, message: "Website not found" });

    await site.deleteOne();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── DUPLICATE ─────────────────────────────────────────────────────────────────
export async function duplicateWebsite(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return res.status(404).json({ success: false, message: "Website not found" });

    const copy = await CustomWebsite.create({
      userId:     req.user._id,
      title:      `${site.title} (Copy)`,
      industry:   site.industry,
      pages:      site.pages,
      activePage: site.activePage,
      settings:   site.settings,
      status:     "draft",
    });

    res.status(201).json({ success: true, site: copy });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── LOG AI GENERATION ─────────────────────────────────────────────────────────
export async function logAiGeneration(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return res.status(404).json({ success: false, message: "Website not found" });

    const { prompt, industry, elemCount } = req.body;

    // Keep last 10 only
    site.aiHistory.push({ prompt, industry, elemCount, createdAt: new Date() });
    if (site.aiHistory.length > 10) site.aiHistory = site.aiHistory.slice(-10);

    await site.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── PUBLIC VIEW (no auth) ─────────────────────────────────────────────────────
export async function getPublishedWebsite(req, res) {
  try {
    const { slug } = req.params;
    const site = await CustomWebsite.findOne({ slug, status: "published" });
    if (!site) return res.status(404).json({ success: false, message: "Website not found or not published" });

    // Return only what renderer needs
    res.json({
      success: true,
      site: {
        title:      site.title,
        pages:      site.pages,
        activePage: site.activePage,
        settings:   site.settings,
        industry:   site.industry,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}