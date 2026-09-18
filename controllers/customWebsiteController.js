// server/controllers/customWebsiteController.js
// CRUD + publish for CustomWebsite documents. Every write is sanitised
// (lib/sanitizeSite.js) so editor or AI output can't trigger a CastError, and
// every change that affects what a host serves invalidates the host cache.

import mongoose from "mongoose";
import CustomWebsite from "../models/CustomWebsite.js";
import Portfolio from "../models/Portfolio.js";
import { isReservedSubdomain } from "../lib/reservedSubdomains.js";
import {
  sanitizePages, sanitizeSettings, sanitizeTitle, sanitizeIndustry, sanitizeThumbnail, countVisibleElements,
} from "../lib/sanitizeSite.js";
import { siteUrls } from "../lib/siteConfig.js";
import { invalidateSite } from "../lib/hostCache.js";
import { domainPayload, releaseDomain } from "../lib/domainService.js";

const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });

// ── Slugs (= the <slug>.foliofyx.in label) ───────────────────────────────────
export function normalizeSlug(raw) {
  return String(raw || "").toLowerCase().trim().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-+|-+$/g, "");
}

function validateSlugFormat(slug) {
  if (!slug || slug.length < 3 || slug.length > 32) return "Address must be between 3 and 32 characters.";
  if (!/^[a-z0-9-]+$/.test(slug)) return "Address can only contain letters, numbers and hyphens.";
  return null;
}

/** null when usable, else { status, message, code }. Checks sites AND legacy portfolio usernames. */
async function slugProblem(slug, { excludeSiteId, userId } = {}) {
  const formatError = validateSlugFormat(slug);
  if (formatError) return { status: 400, message: formatError, code: "SLUG_INVALID" };
  if (isReservedSubdomain(slug)) return { status: 400, message: "That address is reserved and cannot be used.", code: "SLUG_RESERVED" };
  const siteQuery = { slug, ...(excludeSiteId ? { _id: { $ne: excludeSiteId } } : {}) };
  if (await CustomWebsite.exists(siteQuery)) return { status: 409, message: "That address is already taken.", code: "SLUG_TAKEN" };
  // A user may reuse their own portfolio username for their own site.
  const owner = await Portfolio.findOne({ username: slug }).select("userId").lean();
  if (owner && (!userId || String(owner.userId) !== String(userId))) {
    return { status: 409, message: "That address is already taken.", code: "SLUG_TAKEN" };
  }
  return null;
}

async function getOwnedSite(siteId, userId) {
  if (!mongoose.Types.ObjectId.isValid(siteId)) return null;
  return CustomWebsite.findOne({ _id: siteId, userId });
}

function isDupSlug(err) {
  return err?.code === 11000 && (err.keyPattern?.slug || /slug/.test(err.message || ""));
}

// ── CREATE ────────────────────────────────────────────────────────────────────
export async function createWebsite(req, res) {
  try {
    const { title, industry, pages, activePage, settings, slug } = req.body || {};
    const cleanPages = sanitizePages(pages);
    const defaultPage = { id: `page_${Date.now()}`, name: "Home", slug: "/", pageType: "page", elements: [], bgColor: "#ffffff", bgType: "solid" };
    const finalPages = cleanPages && cleanPages.length ? cleanPages : [defaultPage];

    let cleanSlug;
    if (slug) {
      cleanSlug = normalizeSlug(slug);
      const problem = await slugProblem(cleanSlug, { userId: req.user._id });
      if (problem) return fail(res, problem.status, problem.message, problem.code);
    }

    let site;
    try {
      site = await CustomWebsite.create({
        userId: req.user._id,
        title: sanitizeTitle(title),
        industry: sanitizeIndustry(industry),
        pages: finalPages,
        activePage: finalPages.some((p) => p.id === activePage) ? activePage : finalPages[0].id,
        settings: sanitizeSettings(settings),
        ...(cleanSlug ? { slug: cleanSlug } : {}),
      });
    } catch (err) {
      if (isDupSlug(err)) return fail(res, 409, "That address is already taken.", "SLUG_TAKEN");
      throw err;
    }
    res.status(201).json({ success: true, site });
  } catch (err) {
    console.error("[customWebsite] create:", err);
    fail(res, 500, "Couldn't create your website. Please try again.");
  }
}

// ── GET ONE ───────────────────────────────────────────────────────────────────
export async function getWebsite(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return fail(res, 404, "Website not found.");
    res.json({ success: true, site, ...siteUrls(site, req) });
  } catch (err) {
    console.error("[customWebsite] get:", err);
    fail(res, 500, "Couldn't load your website.");
  }
}

// ── GET ALL FOR USER ──────────────────────────────────────────────────────────
export async function getUserWebsites(req, res) {
  try {
    const sites = await CustomWebsite.find(
      { userId: req.user._id },
      { title: 1, slug: 1, industry: 1, status: 1, thumbnail: 1, updatedAt: 1, publishedAt: 1, "pages.name": 1, customDomain: 1 }
    ).sort({ updatedAt: -1 }).limit(50).lean();

    res.json({
      success: true,
      sites: sites.map((s) => {
        const urls = s.status === "published" ? siteUrls(s, req) : { publishedUrl: null, subdomainUrl: null, pathUrl: null, customDomainUrl: null };
        const { customDomain, ...rest } = s;
        return { ...rest, ...urls, customDomain: customDomain?.name ? domainPayload(s) : null };
      }),
    });
  } catch (err) {
    console.error("[customWebsite] list:", err);
    fail(res, 500, "Couldn't load your websites.");
  }
}

// ── SAVE / AUTO-SAVE ──────────────────────────────────────────────────────────
export async function saveWebsite(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return fail(res, 404, "Website not found.");

    const { pages, activePage, title, industry, settings, thumbnail, slug } = req.body || {};
    const oldSlug = site.slug;

    if (pages !== undefined) {
      const clean = sanitizePages(pages);
      if (!clean) return fail(res, 400, "Pages must be a list.", "BAD_PAGES");
      site.pages = clean;
    }
    if (activePage !== undefined && typeof activePage === "string") site.activePage = activePage.slice(0, 100);
    if (title !== undefined) site.title = sanitizeTitle(title, site.title);
    if (industry !== undefined) site.industry = sanitizeIndustry(industry);
    if (settings !== undefined) site.settings = { ...(site.settings?.toObject?.() || site.settings || {}), ...sanitizeSettings(settings) };
    if (thumbnail !== undefined) site.thumbnail = sanitizeThumbnail(thumbnail);

    if (slug) {
      const normalized = normalizeSlug(slug);
      if (normalized !== site.slug) {
        const problem = await slugProblem(normalized, { excludeSiteId: site._id, userId: req.user._id });
        if (problem) return fail(res, problem.status, problem.message, problem.code);
        site.slug = normalized;
      }
    }

    try {
      await site.save();
    } catch (err) {
      if (isDupSlug(err)) return fail(res, 409, "That address is already taken.", "SLUG_TAKEN");
      throw err;
    }
    if (site.status === "published") invalidateSite(site, { oldSlug });
    res.json({ success: true, updatedAt: site.updatedAt, slug: site.slug });
  } catch (err) {
    console.error("[customWebsite] save:", err);
    fail(res, 500, "Couldn't save your website. Please try again.");
  }
}

// ── SLUG AVAILABILITY (public) ────────────────────────────────────────────────
export async function checkSlugAvailability(req, res) {
  try {
    const slug = normalizeSlug(req.params.slug);
    const { siteId } = req.query;
    const excludeSiteId = siteId && mongoose.Types.ObjectId.isValid(siteId) ? siteId : undefined;
    const problem = await slugProblem(slug, { excludeSiteId, userId: req.user?._id });
    if (problem) return res.json({ available: false, reason: problem.message, code: problem.code });
    res.json({ available: true });
  } catch (err) {
    console.error("[customWebsite] slug check:", err);
    res.status(500).json({ available: false, reason: "Could not check availability right now." });
  }
}

// ── PUBLISH ───────────────────────────────────────────────────────────────────
export async function publishWebsite(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return fail(res, 404, "Website not found.");
    if (countVisibleElements(site.pages) === 0) {
      return fail(res, 400, "Your site is empty. Add some content before publishing.", "EMPTY_SITE");
    }

    site.status = "published";
    site.publishedAt = new Date();
    const urls = siteUrls(site, req);
    site.publishedUrl = urls.publishedUrl;
    await site.save();
    invalidateSite(site);

    res.json({ success: true, website: site, slug: site.slug, ...urls });
  } catch (err) {
    console.error("[customWebsite] publish:", err);
    fail(res, 500, "Publishing failed. Please try again.");
  }
}

// ── UNPUBLISH ─────────────────────────────────────────────────────────────────
export async function unpublishWebsite(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return fail(res, 404, "Website not found.");
    site.status = "draft";
    await site.save();
    invalidateSite(site);
    res.json({ success: true });
  } catch (err) {
    console.error("[customWebsite] unpublish:", err);
    fail(res, 500, "Couldn't unpublish the website.");
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────
export async function deleteWebsite(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return fail(res, 404, "Website not found.");
    const domain = site.customDomain?.name;
    invalidateSite(site);
    await site.deleteOne();
    if (domain) releaseDomain(domain);
    res.json({ success: true });
  } catch (err) {
    console.error("[customWebsite] delete:", err);
    fail(res, 500, "Couldn't delete the website.");
  }
}

// ── DUPLICATE ─────────────────────────────────────────────────────────────────
export async function duplicateWebsite(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return fail(res, 404, "Website not found.");
    const copy = await CustomWebsite.create({
      userId: req.user._id,
      title: `${site.title} (Copy)`.slice(0, 120),
      industry: site.industry,
      pages: site.pages,
      activePage: site.activePage,
      settings: site.settings,
      status: "draft",
    });
    res.status(201).json({ success: true, site: copy });
  } catch (err) {
    console.error("[customWebsite] duplicate:", err);
    fail(res, 500, "Couldn't duplicate the website.");
  }
}

// ── LOG AI GENERATION ─────────────────────────────────────────────────────────
export async function logAiGeneration(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return fail(res, 404, "Website not found.");
    const { prompt, industry, elemCount } = req.body || {};
    site.aiHistory.push({
      prompt: String(prompt || "").slice(0, 2000),
      industry: sanitizeIndustry(industry),
      elemCount: Number(elemCount) || 0,
      createdAt: new Date(),
    });
    if (site.aiHistory.length > 10) site.aiHistory = site.aiHistory.slice(-10);
    await site.save();
    res.json({ success: true });
  } catch (err) {
    console.error("[customWebsite] ai-log:", err);
    fail(res, 500, "Couldn't log that generation.");
  }
}

// ── PUBLIC VIEW (no auth) ─────────────────────────────────────────────────────
export async function getPublishedWebsite(req, res) {
  try {
    const site = await CustomWebsite.findOne({ slug: normalizeSlug(req.params.slug), status: "published" }).lean();
    if (!site) return fail(res, 404, "Website not found or not published.");
    res.json({
      success: true,
      site: { title: site.title, pages: site.pages, activePage: site.activePage, settings: site.settings, industry: site.industry },
    });
  } catch (err) {
    console.error("[customWebsite] public:", err);
    fail(res, 500, "Couldn't load that website.");
  }
}
