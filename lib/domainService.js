// server/lib/domainService.js
// ─────────────────────────────────────────────────────────────────────────────
// Custom domains, end to end. Shared by the domain API (connect / "Check now")
// and the background monitor, so both apply exactly the same rules.
//
// Records a user creates at their registrar:
//   TXT   _foliofyx.<domain>  = <token>                  ownership proof
//   apex  A     @             = APEX_A_RECORD (Render LB) routing
//         CNAME www           = CNAME_TARGET             routing (recommended)
//   sub   CNAME <sub>         = CNAME_TARGET             routing
//
// Status machine (customDomain.status):
//   pending_dns → verifying (DNS ok, host issuing TLS) → live
//                ↘ failed (never verified within 7 days)
//   live → dns_missing (records removed; stops serving) → live again when fixed
// Legacy values "pending" / "verified" are treated as pending_dns / verifying.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "crypto";
import { domainToASCII } from "url";
import { Resolver } from "dns/promises";
import { cfg } from "./siteConfig.js";
import * as render from "./renderDomains.js";
import { invalidateSite } from "./hostCache.js";

const DOMAIN_RE = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "ac", "edu", "ltd", "plc", "nic", "res", "gen", "firm", "ind"]);

// Cloudflare's published IPv4 ranges — proxied ("orange cloud") records hide our IP.
const CLOUDFLARE_V4 = [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
  "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
  "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
];

const ipToInt = (ip) => ip.split(".").reduce((a, o) => (a << 8) + (Number(o) & 255), 0) >>> 0;
function inCidr(ip, cidr) {
  const [base, bits] = cidr.split("/");
  const mask = bits === "0" ? 0 : (~0 << (32 - Number(bits))) >>> 0;
  return (ipToInt(ip) & mask) === (ipToInt(base) & mask);
}
const isCloudflare = (ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && CLOUDFLARE_V4.some((c) => inCidr(ip, c));

// ── Input ─────────────────────────────────────────────────────────────────────
/**
 * Normalise what a user typed ("https://www.Shop.Example.com/about") into a
 * hostname. Returns { domain, isApex } or { error }.
 */
export function normalizeCustomDomain(raw) {
  let host = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.+$/, "");
  if (host.startsWith("www.")) host = host.slice(4);
  const ascii = domainToASCII(host);
  if (!ascii || !DOMAIN_RE.test(ascii)) {
    return { error: "Enter a domain you own, like mystudio.com or shop.mystudio.com." };
  }
  const root = cfg.ROOT_DOMAIN;
  if (ascii === root || ascii.endsWith(`.${root}`)) {
    return { error: `Free ${root} addresses are set with your site address, not here. Enter a domain you own.` };
  }
  if (/(^|\.)(netlify\.app|onrender\.com|vercel\.app|localhost|local|test|example)$/.test(ascii)) {
    return { error: "That hostname can't be connected. Enter a domain you own." };
  }
  const labels = ascii.split(".");
  const tld = labels[labels.length - 1];
  const sld = labels[labels.length - 2];
  const registrable = SECOND_LEVEL.has(sld) && tld.length === 2 ? 3 : 2;
  return { domain: ascii, isApex: labels.length <= registrable, zoneLabels: labels.length - registrable };
}

export const newToken = () => `fyx-verify-${crypto.randomBytes(12).toString("hex")}`;

/** The records the user must create, relative to their DNS zone. */
export function requiredRecords(domain, token, isApex) {
  const labels = domain.split(".");
  const n = normalizeCustomDomain(domain);
  const subPart = isApex ? "" : labels.slice(0, n.zoneLabels || 1).join(".");
  const records = [
    {
      type: "TXT",
      host: subPart ? `_foliofyx.${subPart}` : "_foliofyx",
      name: `_foliofyx.${domain}`,
      value: token,
      purpose: "Proves you own the domain",
      required: true,
    },
  ];
  if (isApex) {
    records.push(
      { type: "A", host: "@", name: domain, value: cfg.APEX_A_RECORD, purpose: `Points ${domain} to your site`, required: true },
      { type: "CNAME", host: "www", name: `www.${domain}`, value: cfg.CNAME_TARGET, purpose: `Points www.${domain} to your site`, required: false },
    );
  } else {
    records.push({ type: "CNAME", host: subPart, name: domain, value: cfg.CNAME_TARGET, purpose: `Points ${domain} to your site`, required: true });
  }
  return records;
}

// ── DNS checks ────────────────────────────────────────────────────────────────
function resolver() {
  const r = new Resolver({ timeout: 4000, tries: 2 });
  r.setServers(["1.1.1.1", "8.8.8.8"]);
  return r;
}

const clean = (h) => String(h || "").toLowerCase().replace(/\.$/, "");
const safe = (p) => p.then((v) => v).catch(() => []);

let targetIpsCache = { at: 0, ips: [] };
async function cnameTargetIps(r) {
  if (Date.now() - targetIpsCache.at < 10 * 60_000 && targetIpsCache.ips.length) return targetIpsCache.ips;
  const ips = await safe(r.resolve4(cfg.CNAME_TARGET));
  targetIpsCache = { at: Date.now(), ips };
  return ips;
}

/** Check one routing record: CNAME to our target, or A records that land on us. */
async function checkRouting(r, name, { allowApexIp }) {
  const cnames = (await safe(r.resolveCname(name))).map(clean);
  if (cnames.includes(cfg.CNAME_TARGET)) return { ok: true, found: cnames };
  const ips = await safe(r.resolve4(name));
  const ours = new Set([...(allowApexIp ? [cfg.APEX_A_RECORD] : []), ...(await cnameTargetIps(r))]);
  if (ips.some((ip) => ours.has(ip))) return { ok: true, found: ips };
  const found = cnames.length ? cnames : ips;
  let problem;
  if (ips.length && ips.every(isCloudflare)) {
    problem = "This record is proxied by Cloudflare (orange cloud). Set it to DNS only (grey cloud) so we can issue your SSL certificate.";
  } else if (cnames.length) {
    problem = `Points to ${cnames[0]}; it should point to ${cfg.CNAME_TARGET}.`;
  } else if (ips.length) {
    problem = `Points to ${ips.slice(0, 2).join(", ")}; it should point to ${allowApexIp ? cfg.APEX_A_RECORD : cfg.CNAME_TARGET}.`;
  } else {
    problem = "No record found yet.";
  }
  return { ok: false, found, problem };
}

/** Resolve every required record and annotate it with ok / found / problem. */
export async function checkRecords(domain, token, isApex) {
  const r = resolver();
  const records = requiredRecords(domain, token, isApex);
  await Promise.all(
    records.map(async (rec) => {
      if (rec.type === "TXT") {
        const txt = (await safe(r.resolveTxt(rec.name))).map((parts) => parts.join(""));
        rec.ok = txt.some((t) => t.trim() === token);
        rec.found = txt.slice(0, 3);
        if (!rec.ok) rec.problem = txt.length ? "A TXT record exists but doesn't contain your code yet." : "No TXT record found yet.";
      } else {
        const res = await checkRouting(r, rec.name, { allowApexIp: rec.type === "A" });
        rec.ok = res.ok;
        rec.found = res.found.slice(0, 3);
        if (res.problem) rec.problem = res.problem;
      }
    })
  );
  const ownershipOk = records.find((x) => x.type === "TXT").ok;
  const routingOk = records.filter((x) => x.type !== "TXT" && x.required).every((x) => x.ok);
  return { records, ownershipOk, routingOk };
}

// ── State machine ─────────────────────────────────────────────────────────────
const MIN = 60_000;
const BACKOFF = [5, 15, 30, 60, 180, 360].map((m) => m * MIN);
const LIVE_RECHECK = 6 * 60 * MIN;
const GIVE_UP_AFTER = 7 * 24 * 60 * MIN;

export const ACTIVE_STATUSES = ["pending", "pending_dns", "verified", "verifying", "dns_missing", "live"];

function summarize(records) {
  const bad = records.filter((r) => r.required && !r.ok);
  if (!bad.length) return "";
  return bad.map((r) => `${r.type} ${r.host}: ${r.problem || "not found yet"}`).join(" ");
}

/**
 * Re-check a site's domain and move it through the status machine. Mutates
 * `site.customDomain` (call site.save() afterwards). Never throws.
 */
export async function runDomainCheck(site) {
  const cd = site.customDomain;
  if (!cd?.name || !cd.verificationToken) return site;
  const now = new Date();
  const before = cd.status;
  const { domain, isApex } = normalizeCustomDomain(cd.name);
  const target = domain || cd.name;

  let check;
  try {
    check = await checkRecords(target, cd.verificationToken, isApex ?? true);
  } catch (err) {
    cd.lastError = "We couldn't reach DNS servers just now. We'll try again shortly.";
    cd.lastCheckedAt = now;
    cd.nextCheckAt = new Date(now.getTime() + 5 * MIN);
    console.warn(`[domains] DNS check error for ${target}:`, err.message);
    return site;
  }

  cd.records = check.records;
  cd.lastCheckedAt = now;
  cd.checkCount = (cd.checkCount || 0) + 1;
  const warnings = [];
  const wwwRec = check.records.find((r) => r.host === "www" && !r.required);
  if (wwwRec && !wwwRec.ok) warnings.push(`Add the www CNAME too so www.${target} also opens your site.`);

  const wasLive = ["live", "verifying", "verified", "dns_missing"].includes(before);

  if (!check.ownershipOk || !check.routingOk) {
    const connectedAt = cd.connectedAt || cd.verifiedAt || now;
    if (wasLive && cd.verifiedAt) {
      cd.status = "dns_missing";
      if (!cd.dnsMissingSince) cd.dnsMissingSince = now;
      cd.lastError = `Your DNS records changed and ${target} no longer points to your site. ${summarize(check.records)}`.trim();
    } else if (now - new Date(connectedAt) > GIVE_UP_AFTER) {
      cd.status = "failed";
      cd.lastError = `We couldn't see the DNS records after 7 days. ${summarize(check.records)} Fix them and press Check now.`.trim();
    } else {
      cd.status = "pending_dns";
      cd.lastError = summarize(check.records) || "Waiting for your DNS records.";
    }
    const step = BACKOFF[Math.min(BACKOFF.length - 1, Math.max(0, (cd.checkCount || 1) - 1))];
    cd.nextCheckAt = new Date(now.getTime() + (cd.status === "failed" ? 24 * 60 * MIN : step));
  } else {
    if (!cd.verifiedAt) cd.verifiedAt = now;
    cd.dnsMissingSince = undefined;
    if (render.isConfigured()) {
      try {
        const added = await render.addDomain(target);
        cd.renderDomainId = added?.id || cd.renderDomainId;
        if (added && added.verificationStatus !== "verified") await render.verifyDomain(target).catch(() => false);
        const fresh = (await render.getDomain(target)) || added;
        cd.renderStatus = fresh?.verificationStatus || "unverified";
        if (cd.renderStatus === "verified") {
          cd.status = "live";
          cd.lastError = "";
        } else {
          cd.status = "verifying";
          cd.lastError = "DNS is correct. We're issuing your SSL certificate now; this usually takes a few minutes.";
        }
      } catch (err) {
        cd.status = "verifying";
        cd.lastError = err.userMessage || "DNS is correct. We're finishing the setup on our side and will retry automatically.";
        console.warn(`[domains] Render activation for ${target} failed:`, err.message);
      }
    } else {
      cd.status = "live";
      cd.lastError = "";
      warnings.push("SSL certificates are issued once the domain is added on our hosting provider.");
      console.warn(`[domains] ${target} DNS verified but RENDER_API_KEY / RENDER_SERVICE_ID are not set — add the domain to the Render service manually for TLS.`);
    }
    if (cd.status === "live" && !cd.liveAt) cd.liveAt = now;
    cd.nextCheckAt = new Date(now.getTime() + (cd.status === "live" ? LIVE_RECHECK : 5 * MIN));
  }
  cd.warnings = warnings.length ? warnings : undefined;

  if (cd.status !== before) invalidateSite(site);
  if (typeof site.markModified === "function") site.markModified("customDomain");
  return site;
}

/** What the client sees for a site's domain. */
export function domainPayload(site) {
  const cd = site?.customDomain || {};
  if (!cd.name) {
    return { domain: null, status: null, records: [], cnameTarget: cfg.CNAME_TARGET, apexIp: cfg.APEX_A_RECORD, sslManaged: render.isConfigured() };
  }
  const { isApex } = normalizeCustomDomain(cd.name);
  const records = Array.isArray(cd.records) && cd.records.length
    ? cd.records.map((r) => (typeof r.toObject === "function" ? r.toObject() : r))
    : requiredRecords(cd.name, cd.verificationToken, isApex ?? true);
  const legacy = { pending: "pending_dns", verified: "verifying" };
  return {
    domain: cd.name,
    status: legacy[cd.status] || cd.status || "pending_dns",
    isApex: isApex ?? true,
    records,
    lastError: cd.lastError || "",
    warnings: cd.warnings || [],
    connectedAt: cd.connectedAt || null,
    verifiedAt: cd.verifiedAt || null,
    liveAt: cd.liveAt || null,
    lastCheckedAt: cd.lastCheckedAt || null,
    nextCheckAt: cd.nextCheckAt || null,
    url: ["live", "verifying", "verified"].includes(cd.status) ? `https://${cd.name}` : null,
    cnameTarget: cfg.CNAME_TARGET,
    apexIp: cfg.APEX_A_RECORD,
    sslManaged: render.isConfigured(),
  };
}

export async function releaseDomain(name) {
  if (!name || !render.isConfigured()) return;
  try {
    await render.removeDomain(name);
  } catch (err) {
    console.warn(`[domains] couldn't remove ${name} from Render:`, err.message);
  }
}
