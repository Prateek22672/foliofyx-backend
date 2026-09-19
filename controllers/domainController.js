// server/controllers/domainController.js
// Custom-domain API. All DNS / hosting logic lives in lib/domainService.js,
// which the background monitor (lib/domainMonitor.js) shares.

import mongoose from "mongoose";
import CustomWebsite from "../models/CustomWebsite.js";
import Portfolio from "../models/Portfolio.js";
import {
  normalizeCustomDomain, newToken, requiredRecords, runDomainCheck, domainPayload, releaseDomain,
} from "../lib/domainService.js";
import { invalidateSite } from "../lib/hostCache.js";

// A "site" here is either a Custom Builder site or a regular template
// portfolio — both carry a `customDomain` sub-document of the same shape
// (models/customDomainSchema.js), so lib/domainService.js works on either
// unmodified. We just need the right Mongoose doc for a given id.
async function getOwnedSite(siteId, userId) {
  if (!mongoose.Types.ObjectId.isValid(siteId)) return null;
  const site = await CustomWebsite.findOne({ _id: siteId, userId });
  if (site) return site;
  return Portfolio.findOne({ _id: siteId, userId });
}

/** Is `domain` already connected to a different site, of either type? */
async function domainTakenElsewhere(domain, excludeId) {
  const [byCustom, byPortfolio] = await Promise.all([
    CustomWebsite.exists({ "customDomain.name": domain, _id: { $ne: excludeId } }),
    Portfolio.exists({ "customDomain.name": domain, _id: { $ne: excludeId } }),
  ]);
  return Boolean(byCustom || byPortfolio);
}

const fail = (res, status, message, code) => res.status(status).json({ success: false, message, ...(code ? { code } : {}) });

// CustomWebsite gates visibility with `status`, Portfolio with `isPublic`.
const isSiteLive = (site) => site.status === "published" || site.isPublic === true;

function messageFor(p) {
  switch (p.status) {
    case "live": return `${p.domain} is live and serving your site.`;
    case "verifying": return p.lastError || "DNS is correct. We're issuing your SSL certificate now.";
    case "dns_missing": return p.lastError || "Your DNS records changed, so the domain stopped serving your site.";
    case "failed": return p.lastError || "We couldn't verify the domain. Fix the records below and press Check now.";
    default: return "Add the records below at your domain provider, then press Check now. DNS changes can take a few minutes, occasionally up to 48 hours.";
  }
}

// ── POST /api/domains/:id/connect  { domain } ────────────────────────────────
export async function connectDomain(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return fail(res, 404, "Website not found.");

    const { domain, isApex, error } = normalizeCustomDomain(req.body?.domain);
    if (error) return fail(res, 400, error, "INVALID_DOMAIN");

    if (await domainTakenElsewhere(domain, site._id)) {
      return fail(res, 409, "That domain is already connected to another FolioFYX site.", "DOMAIN_TAKEN");
    }

    const previous = site.customDomain?.name;
    const sameDomain = previous === domain;
    const token = sameDomain && site.customDomain?.verificationToken ? site.customDomain.verificationToken : newToken();

    if (sameDomain) {
      site.customDomain.nextCheckAt = new Date();
    } else {
      site.customDomain = {
        name: domain,
        status: "pending_dns",
        verificationToken: token,
        connectedAt: new Date(),
        nextCheckAt: new Date(),
        checkCount: 0,
        records: requiredRecords(domain, token, isApex),
      };
    }

    try {
      await site.save();
    } catch (err) {
      if (err?.code === 11000) return fail(res, 409, "That domain is already connected to another FolioFYX site.", "DOMAIN_TAKEN");
      throw err;
    }
    if (previous && !sameDomain) {
      invalidateSite(site, { oldDomain: previous });
      releaseDomain(previous);
    }

    const payload = domainPayload(site);
    res.json({ success: true, ...payload, message: messageFor(payload) });
  } catch (err) {
    console.error("[domains] connect:", err);
    fail(res, 500, "Couldn't connect that domain right now. Please try again.");
  }
}

// ── POST /api/domains/:id/verify  ("Check now") ──────────────────────────────
export async function verifyDomain(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return fail(res, 404, "Website not found.");
    if (!site.customDomain?.name) return fail(res, 400, "No domain is connected to this site yet.", "NO_DOMAIN");

    await runDomainCheck(site);
    await site.save();

    const payload = domainPayload(site);
    res.json({
      success: true,
      ...payload,
      message: messageFor(payload),
      ...(!isSiteLive(site) && payload.status === "live"
        ? { notice: "Your domain is connected. Publish the site so visitors see it." }
        : {}),
    });
  } catch (err) {
    console.error("[domains] verify:", err);
    fail(res, 500, "Couldn't check the domain right now. Please try again in a minute.");
  }
}

// ── GET /api/domains/:id/status ──────────────────────────────────────────────
export async function domainStatus(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return fail(res, 404, "Website not found.");
    const payload = domainPayload(site);
    res.json({ success: true, ...payload, message: payload.domain ? messageFor(payload) : "" });
  } catch (err) {
    console.error("[domains] status:", err);
    fail(res, 500, "Couldn't load the domain status.");
  }
}

// ── DELETE /api/domains/:id ──────────────────────────────────────────────────
export async function disconnectDomain(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return fail(res, 404, "Website not found.");
    const name = site.customDomain?.name;
    site.customDomain = undefined;
    await site.save();
    if (name) {
      invalidateSite(site, { oldDomain: name });
      releaseDomain(name);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("[domains] disconnect:", err);
    fail(res, 500, "Couldn't disconnect the domain. Please try again.");
  }
}
