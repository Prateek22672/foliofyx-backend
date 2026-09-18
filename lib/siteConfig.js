// server/lib/siteConfig.js
// ─────────────────────────────────────────────────────────────────────────────
// Single source of truth for everything "where do published sites live".
//
// Values are exposed as GETTERS (not constants) on purpose: server.js calls
// dotenv.config() after its static imports have already been evaluated, so a
// module-level `process.env.X` read would miss values from a local .env file.
// Reading lazily also lets tests flip env vars at runtime.
// ─────────────────────────────────────────────────────────────────────────────

import net from "net";

const env = (k) => {
  const v = process.env[k];
  return typeof v === "string" ? v.trim() : "";
};

const bool = (v, def) => {
  if (v === undefined || v === null || String(v).trim() === "") return def;
  return /^(1|true|yes|on)$/i.test(String(v).trim());
};

// "https://Foo.com/path:443." → "foo.com"
export function cleanHostname(h) {
  return String(h || "")
    .trim()
    .toLowerCase()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/:\d+$/, "")
    .replace(/\.+$/, "");
}

const stripSlash = (s) => String(s || "").replace(/\/+$/, "");

// Last-resort CNAME target when neither SITE_CNAME_TARGET nor Render's
// RENDER_EXTERNAL_HOSTNAME is available (e.g. local development).
const DEFAULT_CNAME_TARGET = "foliofyx-backend.onrender.com";

export const cfg = {
  /** Apex of the product; user sites get <slug>.<ROOT_DOMAIN>. */
  get ROOT_DOMAIN() {
    return cleanHostname(env("ROOT_DOMAIN")) || "foliofyx.in";
  },

  /** Hosts that are the app/API itself — never treated as a user site. */
  get APP_HOSTS() {
    const root = cfg.ROOT_DOMAIN;
    const hosts = new Set([
      root,
      `www.${root}`,
      `api.${root}`,
      "foliofyx.netlify.app",
      "localhost",
      "127.0.0.1",
      "::1",
      "[::1]",
    ]);
    const renderHost = cleanHostname(env("RENDER_EXTERNAL_HOSTNAME"));
    if (renderHost) hosts.add(renderHost);
    for (const extra of env("APP_HOSTS").split(",")) {
      const h = cleanHostname(extra);
      if (h) hosts.add(h);
    }
    return hosts;
  },

  /** Serve <slug>.<ROOT_DOMAIN> (needs the wildcard DNS + TLS set up). */
  get WILDCARD_SUBDOMAINS() {
    return bool(process.env.WILDCARD_SUBDOMAINS, true);
  },

  /** Optional explicit origin for the /site/<slug> path URLs. */
  get PUBLIC_SITE_BASE() {
    return stripSlash(env("PUBLIC_SITE_BASE"));
  },

  /** What users point CNAME records at. */
  get CNAME_TARGET() {
    return (
      cleanHostname(env("SITE_CNAME_TARGET")) ||
      cleanHostname(env("RENDER_EXTERNAL_HOSTNAME")) ||
      DEFAULT_CNAME_TARGET
    );
  },

  /** What users point apex A records at (Render's load balancer by default). */
  get APEX_A_RECORD() {
    const ip = env("SITE_APEX_IP") || env("SITE_SERVER_IP");
    return net.isIPv4(ip) ? ip : "216.24.57.1";
  },

  get RENDER_API_KEY() {
    return env("RENDER_API_KEY");
  },

  get RENDER_SERVICE_ID() {
    return env("RENDER_SERVICE_ID");
  },

  get RENDER_EXTERNAL_HOSTNAME() {
    return cleanHostname(env("RENDER_EXTERNAL_HOSTNAME"));
  },

  /**
   * Optional shared secret for an edge proxy (e.g. a Cloudflare Worker on
   * *.foliofyx.in) that forwards the visitor's host in X-FYX-Forwarded-Host.
   */
  get SITE_PROXY_SECRET() {
    return env("SITE_PROXY_SECRET");
  },
};

/** True for hosts that belong to the app/API rather than a user site. */
export function isAppHost(host) {
  const h = cleanHostname(host);
  if (!h) return true;
  if (net.isIP(h.replace(/^\[|\]$/g, ""))) return true; // raw IPs (health checks, LAN)
  if (h.endsWith(".onrender.com") || h.endsWith(".netlify.app")) return true;
  const hosts = cfg.APP_HOSTS;
  return hosts.has(h);
}

/** Custom-domain statuses under which the domain actually serves the site. */
export const SERVING_DOMAIN_STATUSES = ["live", "verifying", "verified"];

// ── Public URLs for a site ───────────────────────────────────────────────────

/** Origin that serves /site/<slug> (this API server). */
export function pathOrigin(req) {
  if (cfg.PUBLIC_SITE_BASE) return cfg.PUBLIC_SITE_BASE;
  if (cfg.RENDER_EXTERNAL_HOSTNAME) return `https://${cfg.RENDER_EXTERNAL_HOSTNAME}`;
  if (req && typeof req.get === "function" && req.get("host")) {
    return `${req.protocol || "https"}://${req.get("host")}`;
  }
  return `https://${DEFAULT_CNAME_TARGET}`;
}

export function pathUrlFor(site, req) {
  return site?.slug ? `${pathOrigin(req)}/site/${site.slug}` : null;
}

export function subdomainUrlFor(site) {
  if (!site?.slug || !cfg.WILDCARD_SUBDOMAINS) return null;
  return `https://${site.slug}.${cfg.ROOT_DOMAIN}`;
}

export function customDomainUrlFor(site) {
  const cd = site?.customDomain;
  return cd?.name && cd.status === "live" ? `https://${cd.name}` : null;
}

/**
 * All public URLs of a site. `publishedUrl` is the best one that works:
 * live custom domain → wildcard subdomain → /site/<slug> path.
 */
export function siteUrls(site, req) {
  const pathUrl = pathUrlFor(site, req);
  const subdomainUrl = subdomainUrlFor(site);
  const customDomainUrl = customDomainUrlFor(site);
  return {
    publishedUrl: customDomainUrl || subdomainUrl || pathUrl,
    subdomainUrl,
    pathUrl,
    customDomainUrl,
  };
}
