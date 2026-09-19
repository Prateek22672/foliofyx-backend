// server/lib/siteServing.js
// Serves published user sites:
//   • <slug>.<ROOT_DOMAIN>   (wildcard subdomain)   → host middleware
//   • verified custom domains                       → host middleware
//   • /site/<slug>[/page] on the API host           → siteRoute
// Lookups go through the bounded host cache (lib/hostCache.js), which the
// controllers invalidate on publish / unpublish / slug / domain changes.

import CustomWebsite from "../models/CustomWebsite.js";
import Portfolio from "../models/Portfolio.js";
import { cfg, cleanHostname, isAppHost, SERVING_DOMAIN_STATUSES, pathOrigin } from "./siteConfig.js";
import { hostCache } from "./hostCache.js";
import { isReservedSubdomain } from "./reservedSubdomains.js";
import { renderSiteHTML, renderNotFoundHTML, renderRobotsTxt, renderSitemapXml } from "./siteRenderer.js";

const ASSET_RE = /\.(?:js|mjs|css|map|png|jpe?g|gif|webp|avif|svg|ico|woff2?|ttf|otf|json|txt|xml|webmanifest|php|env|git)$/i;

function pageSlugOf(path) {
  const p = String(path || "/").replace(/\/+$/, "");
  return p === "" ? "/" : p;
}

function sendSite(req, res, site, { origin, pageSlug, noindexHeader = false }) {
  if (noindexHeader) res.set("X-Robots-Tag", "noindex");
  if (pageSlug === "/robots.txt") return res.type("text/plain").send(renderRobotsTxt(site, { origin }));
  if (pageSlug === "/sitemap.xml") return res.type("application/xml").send(renderSitemapXml(site, { origin }));
  if (pageSlug === "/favicon.ico") {
    const fav = site.settings?.favicon;
    return /^https?:\/\//i.test(fav || "") ? res.redirect(302, fav) : res.status(204).end();
  }
  if (ASSET_RE.test(pageSlug)) return res.status(404).type("text/plain").send("Not found");

  const html = renderSiteHTML(site, { pageSlug, baseUrl: origin });
  if (!html) return res.status(404).type("html").send(renderNotFoundHTML(site, { baseUrl: origin }));
  res.set("Cache-Control", "public, max-age=60");
  return res.status(200).type("html").send(html);
}

async function resolveHost(host, label) {
  const cached = hostCache.get(host);
  if (cached !== undefined) return cached;
  let value = null;
  if (label) {
    const site = await CustomWebsite.findOne({ slug: label, status: "published" }).lean();
    if (site) value = { site };
    else {
      const p = await Portfolio.findOne({ username: label }).select("_id").lean();
      if (p) value = { portfolioId: String(p._id) };
    }
  } else {
    const site = await CustomWebsite.findOne({
      "customDomain.name": host,
      "customDomain.status": { $in: SERVING_DOMAIN_STATUSES },
      status: "published",
    }).lean();
    if (site) value = { site };
    else {
      // A bring-your-own domain on a regular template portfolio: same
      // "vanity domain lands on the app" handling as a claimed subdomain
      // (there's no data-driven SSR renderer for the legacy templates).
      const p = await Portfolio.findOne({
        "customDomain.name": host,
        "customDomain.status": { $in: SERVING_DOMAIN_STATUSES },
        isPublic: true,
      }).select("_id").lean();
      if (p) value = { portfolioId: String(p._id) };
    }
  }
  hostCache.set(host, value);
  return value;
}

const UNCONNECTED_HTML = (host) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Site not found</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#fafafa;color:#111}main{max-width:440px;padding:32px;text-align:center}h1{font-size:22px;margin:0 0 8px}p{color:#555;line-height:1.6}a{color:#111;font-weight:600}</style></head>
<body><main><h1>No website here yet</h1><p>${String(host).replace(/[<>&"']/g, "")} isn't connected to a published FolioFYX site.</p><p><a href="https://${cfg.ROOT_DOMAIN}/?ref=unconnected-domain">Build a free website with FolioFYX</a></p></main></body></html>`;

/** Express middleware: serve user sites by Host header; everything else → next(). */
export function hostRouter() {
  return async (req, res, next) => {
    try {
      // An optional edge proxy (e.g. Cloudflare Worker) may forward the visitor's host.
      const forwarded = cfg.SITE_PROXY_SECRET && req.get("x-fyx-proxy-secret") === cfg.SITE_PROXY_SECRET
        ? req.get("x-fyx-forwarded-host")
        : null;
      const host = cleanHostname(forwarded || req.hostname);
      if (isAppHost(host)) return next();

      const root = cfg.ROOT_DOMAIN;
      const bare = host.replace(/^www\./, "");
      const isSub = bare.endsWith(`.${root}`);
      const label = isSub ? bare.slice(0, -(root.length + 1)) : null;
      if (isSub && (!cfg.WILDCARD_SUBDOMAINS || label.includes(".") || isReservedSubdomain(label))) return next();

      // User hosts never expose the API or server uploads.
      if (req.path === "/api" || req.path.startsWith("/api/") || req.path.startsWith("/uploads/")) {
        return res.status(404).type("text/plain").send("Not found");
      }
      if (req.method !== "GET" && req.method !== "HEAD") return res.status(405).set("Allow", "GET, HEAD").end();

      const hit = await resolveHost(bare, label);
      if (!hit) {
        if (isSub) return res.redirect(302, `https://${root}/?claim=${encodeURIComponent(label)}`);
        return res.status(404).type("html").send(UNCONNECTED_HTML(bare));
      }
      if (hit.portfolioId) return res.redirect(302, `https://${root}/portfolio/${hit.portfolioId}`);

      // One canonical address per site: a live custom domain wins over the subdomain.
      const cd = hit.site.customDomain;
      if (isSub && cd?.name && cd.status === "live") {
        return res.redirect(301, `https://${cd.name}${req.originalUrl || "/"}`);
      }
      return sendSite(req, res, hit.site, { origin: `https://${host}`, pageSlug: pageSlugOf(req.path) });
    } catch (err) {
      console.error("[site-host]", err.message);
      return res.status(500).type("html").send("<h1>Something went wrong</h1><p>Please refresh in a moment.</p>");
    }
  };
}

/** GET /site/:slug[/*] on the API host. */
export async function siteRoute(req, res) {
  try {
    const slug = String(req.params.slug || "").toLowerCase();
    const key = `path:${slug}`;
    let hit = hostCache.get(key);
    if (hit === undefined) {
      const site = await CustomWebsite.findOne({ slug, status: "published" }).lean();
      hit = site ? { site } : null;
      hostCache.set(key, hit);
    }
    if (!hit) {
      return res.status(404).type("html").send(UNCONNECTED_HTML(`${pathOrigin(req)}/site/${slug}`));
    }
    const sub = req.params[0] ? `/${req.params[0]}` : "/";
    // The subdomain / custom domain is the canonical copy once wildcard DNS is on.
    return sendSite(req, res, hit.site, {
      origin: `${pathOrigin(req)}/site/${slug}`,
      pageSlug: pageSlugOf(sub),
      noindexHeader: cfg.WILDCARD_SUBDOMAINS,
    });
  } catch (err) {
    console.error("[site-ssr]", err.message);
    return res.status(500).type("html").send("<h1>Something went wrong</h1><p>Please refresh in a moment.</p>");
  }
}
