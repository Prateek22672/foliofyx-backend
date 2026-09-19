// server/edge/subdomain-worker.js
// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare Worker that serves every free <name>.foliofyx.in site.
//
// Why: Render refuses a wildcard custom domain (*.foliofyx.in) while any other
// Render account has a matching specific domain (e.g. fraudlens.foliofyx.in),
// and proxying the wildcard straight to Render gives Cloudflare Error 1000.
// This Worker sidesteps both: Cloudflare answers for *.foliofyx.in (its
// Universal SSL certificate already covers it) and forwards the request to the
// backend on Render's own onrender.com address, telling it which host the
// visitor asked for. The backend (lib/siteServing.js) trusts that header only
// when the shared secret matches.
//
// One-time setup (Cloudflare dashboard, zone foliofyx.in):
//   1. Workers & Pages → Create → Worker → paste this file → Deploy.
//   2. Worker → Settings → Variables and Secrets:
//        SITE_PROXY_SECRET  (Secret)  a long random string
//        PASS_THROUGH       (optional) comma list of PROXIED subdomains that
//                           belong to other apps (defaults below)
//   3. Render → foliofyx-backend → Environment: SITE_PROXY_SECRET = the same string.
//   4. Worker → Settings → Domains & Routes → Add route:  *.foliofyx.in/*
//   5. DNS: delete the `*` CNAME, add  AAAA  *  100::  (Proxied / orange cloud).
//      Explicit records (www, agentfury, fraudlens, …) keep working untouched.
//
// Do NOT add edge caching here without keying the cache on the visitor's host:
// every user's site is fetched from the same origin URL, so a shared cache key
// would serve one person's site on another person's address.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_ORIGIN = "https://foliofyx-backend.onrender.com";
const DEFAULT_ROOT = "foliofyx.in";

// Subdomains that already belong to other apps. Only records that are PROXIED
// (orange) ever reach a Worker, but listing all of them is harmless.
const DEFAULT_PASS_THROUGH = "www,agentfury,fraudlens,hireview,poster-ai-engine,prateek,veecos,voice";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const host = url.hostname.toLowerCase();
    const root = (env.ROOT_DOMAIN || DEFAULT_ROOT).toLowerCase();

    const label = host.endsWith(`.${root}`) ? host.slice(0, -(root.length + 1)) : "";
    const passThrough = new Set(
      String(env.PASS_THROUGH || DEFAULT_PASS_THROUGH).split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    );

    // Not a single-label user subdomain, or one that belongs to another app:
    // hand the request to whatever the DNS record for that host points at.
    if (!label || label.includes(".") || passThrough.has(label)) return fetch(request);

    if (!env.SITE_PROXY_SECRET) {
      return new Response("Site proxy is not configured.", { status: 500 });
    }

    const target = new URL(url.pathname + url.search, env.ORIGIN || DEFAULT_ORIGIN);
    const headers = new Headers(request.headers);
    // set() overwrites anything a visitor tried to send under these names.
    headers.set("x-fyx-proxy-secret", env.SITE_PROXY_SECRET);
    headers.set("x-fyx-forwarded-host", host);

    return fetch(target, {
      method: request.method,
      headers,
      body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      redirect: "manual", // pass the backend's redirects straight to the visitor
    });
  },
};
