// server/controllers/domainController.js
// ─────────────────────────────────────────────────────────────────────────────
// Custom domain (DNS) connection for published websites.
//
// Flow (same model as Wix/Netlify):
//   1. connectDomain  — user enters "mystudio.com"; we store it as pending and
//      hand back the exact DNS records to create at their registrar:
//        TXT  _foliofyx.mystudio.com     → fyx-verify-<token>   (ownership)
//        A    @                          → SITE_SERVER_IP        (apex)
//        CNAME www                       → SITE_CNAME_TARGET     (www)
//   2. verifyDomain   — we resolve those records live (node:dns over public
//      resolvers). TXT match proves ownership → "verified"; A/CNAME pointing
//      at us as well → "live". Re-runnable any time; DNS propagation can take
//      minutes to 48h and this endpoint just reports current truth.
//   3. Host-based serving — server.js routes any request whose Host header is
//      a live custom domain to the SSR renderer for that site.
//
// Env: SITE_SERVER_IP (A record target), SITE_CNAME_TARGET (default
// "sites.foliofyx.in"). Without SITE_SERVER_IP we still verify ownership via
// TXT and mark "verified"; "live" additionally requires the A/CNAME hookup.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "crypto";
import { Resolver } from "dns/promises";
import CustomWebsite from "../models/CustomWebsite.js";
import mongoose from "mongoose";

const CNAME_TARGET = () => process.env.SITE_CNAME_TARGET || "sites.foliofyx.in";
const SERVER_IP = () => process.env.SITE_SERVER_IP || "";

// Public resolvers so we see what the world sees, not a local cache.
function freshResolver() {
  const r = new Resolver();
  r.setServers(["1.1.1.1", "8.8.8.8"]);
  return r;
}

// Reserved hosts we never allow as custom domains.
const BLOCKED = /(^|\.)foliofyx\.(in|com)$|(^|\.)netlify\.app$|(^|\.)localhost$/i;
const DOMAIN_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

function normalizeDomain(raw) {
  return String(raw || "")
    .trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/.*$/, "");
}

async function getOwnedSite(siteId, userId) {
  if (!mongoose.Types.ObjectId.isValid(siteId)) return null;
  return CustomWebsite.findOne({ _id: siteId, userId });
}

function dnsInstructions(domain, token) {
  const records = [
    {
      type: "TXT",
      host: `_foliofyx.${domain}`,
      value: token,
      purpose: "Proves you own the domain",
    },
    {
      type: "CNAME",
      host: "www",
      value: CNAME_TARGET(),
      purpose: "Points www to your site",
    },
  ];
  if (SERVER_IP()) {
    records.splice(1, 0, {
      type: "A",
      host: "@",
      value: SERVER_IP(),
      purpose: "Points the root domain to your site",
    });
  }
  return records;
}

// ── POST /api/domains/:id/connect  { domain } ────────────────────────────────
export async function connectDomain(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return res.status(404).json({ success: false, message: "Website not found" });

    const domain = normalizeDomain(req.body?.domain);
    if (!DOMAIN_RE.test(domain) || BLOCKED.test(domain)) {
      return res.status(400).json({ success: false, message: "Please enter a valid domain you own, like mystudio.com" });
    }

    const taken = await CustomWebsite.findOne({ "customDomain.name": domain, _id: { $ne: site._id } });
    if (taken) return res.status(409).json({ success: false, message: "That domain is already connected to another site." });

    const token = site.customDomain?.name === domain && site.customDomain?.verificationToken
      ? site.customDomain.verificationToken // keep token stable across retries
      : `fyx-verify-${crypto.randomBytes(12).toString("hex")}`;

    site.customDomain = { name: domain, status: "pending", verificationToken: token };
    await site.save();

    res.json({
      success: true,
      domain,
      status: "pending",
      records: dnsInstructions(domain, token),
      note: "Add these records at your domain registrar (GoDaddy, Namecheap, Hostinger…). DNS changes usually apply in minutes but can take up to 48 hours. Then hit Verify.",
    });
  } catch (err) {
    console.error("[domains] connect:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── POST /api/domains/:id/verify ─────────────────────────────────────────────
export async function verifyDomain(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site?.customDomain?.name) {
      return res.status(400).json({ success: false, message: "No domain is connected to this site yet." });
    }
    const { name: domain, verificationToken } = site.customDomain;
    const r = freshResolver();
    const checks = { txt: false, apex: false, www: false };

    // 1) Ownership: TXT _foliofyx.<domain> contains our token.
    try {
      const txt = await r.resolveTxt(`_foliofyx.${domain}`);
      checks.txt = txt.some((rec) => rec.join("").includes(verificationToken));
    } catch { /* NXDOMAIN etc. — stays false */ }

    // 2) Apex A record → our IP (only checkable when SITE_SERVER_IP is set).
    if (SERVER_IP()) {
      try {
        const a = await r.resolve4(domain);
        checks.apex = a.includes(SERVER_IP());
      } catch { /* stays false */ }
    }

    // 3) www CNAME → our target (or resolves to our IP).
    try {
      const cname = await r.resolveCname(`www.${domain}`);
      checks.www = cname.some((c) => c.toLowerCase().replace(/\.$/, "") === CNAME_TARGET());
    } catch {
      if (SERVER_IP()) {
        try {
          const a = await r.resolve4(`www.${domain}`);
          checks.www = a.includes(SERVER_IP());
        } catch { /* stays false */ }
      }
    }

    const pointed = checks.apex || checks.www;
    let status = "pending";
    if (checks.txt && pointed) status = "live";
    else if (checks.txt) status = "verified";

    site.customDomain.status = status;
    site.customDomain.lastCheckedAt = new Date();
    site.customDomain.lastError = checks.txt ? "" : "TXT verification record not found yet";
    if (status !== "pending" && !site.customDomain.verifiedAt) site.customDomain.verifiedAt = new Date();
    await site.save();

    res.json({
      success: true,
      status,
      checks,
      records: dnsInstructions(domain, verificationToken),
      message:
        status === "live" ? `${domain} is verified and pointing at your site. You're live!`
        : status === "verified" ? "Ownership verified! Now point your A/CNAME records at us to go live."
        : "We couldn't see the records yet — DNS can take a while to propagate. Try again in a few minutes.",
    });
  } catch (err) {
    console.error("[domains] verify:", err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET /api/domains/:id/status ──────────────────────────────────────────────
export async function domainStatus(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return res.status(404).json({ success: false, message: "Website not found" });
    const cd = site.customDomain || {};
    res.json({
      success: true,
      domain: cd.name || null,
      status: cd.status || null,
      records: cd.name ? dnsInstructions(cd.name, cd.verificationToken) : [],
      lastCheckedAt: cd.lastCheckedAt || null,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── DELETE /api/domains/:id ──────────────────────────────────────────────────
export async function disconnectDomain(req, res) {
  try {
    const site = await getOwnedSite(req.params.id, req.user._id);
    if (!site) return res.status(404).json({ success: false, message: "Website not found" });
    site.customDomain = undefined;
    await site.save();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
}
