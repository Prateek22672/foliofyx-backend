// server/lib/hostCache.js
// ─────────────────────────────────────────────────────────────────────────────
// Bounded LRU cache for "which published site does this host / slug serve?".
//
//   • hits live 60s, misses 10s (so a freshly published site shows up fast)
//   • bounded by entry count AND approximate bytes (site documents can be big)
//   • invalidateSite(site) drops every key that could point at a site — call
//     it on publish / unpublish / slug change / save of a published site /
//     domain connect / verify / disconnect / delete.
//
// Keys: bare hostnames ("rahul.foliofyx.in", "mystudio.com") and
// "path:<slug>" for the /site/<slug> route.
// ─────────────────────────────────────────────────────────────────────────────

import { cfg } from "./siteConfig.js";

const approxSize = (value) => {
  if (value == null) return 64;
  try {
    return JSON.stringify(value).length + 64;
  } catch {
    return 4096;
  }
};

const normKey = (key) => String(key || "").trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");

export class HostCache {
  constructor({ max = 1000, maxBytes = 48 * 1024 * 1024, hitTtl = 60_000, missTtl = 10_000, now = Date.now } = {}) {
    this.max = max;
    this.maxBytes = maxBytes;
    this.hitTtl = hitTtl;
    this.missTtl = missTtl;
    this.now = now;
    this.map = new Map(); // key → { value, expires, size, siteId }
    this.bytes = 0;
    this.bySite = new Map(); // siteId → Set<key>
  }

  get size() {
    return this.map.size;
  }

  /** undefined = not cached; null = cached miss; otherwise the cached value. */
  get(key) {
    const k = normKey(key);
    const entry = this.map.get(k);
    if (!entry) return undefined;
    if (entry.expires <= this.now()) {
      this._remove(k);
      return undefined;
    }
    // Refresh recency.
    this.map.delete(k);
    this.map.set(k, entry);
    return entry.value;
  }

  /** Cache a value; null/undefined caches a (short-lived) miss. */
  set(key, value) {
    const k = normKey(key);
    if (!k) return;
    this._remove(k);
    const isMiss = value == null;
    const siteId = !isMiss && value.site && value.site._id ? String(value.site._id) : null;
    const entry = {
      value: isMiss ? null : value,
      expires: this.now() + (isMiss ? this.missTtl : this.hitTtl),
      size: approxSize(value),
      siteId,
    };
    // A single oversized document is simply not cached.
    if (entry.size > this.maxBytes) return;
    this.map.set(k, entry);
    this.bytes += entry.size;
    if (siteId) {
      if (!this.bySite.has(siteId)) this.bySite.set(siteId, new Set());
      this.bySite.get(siteId).add(k);
    }
    this._evict();
  }

  delete(key) {
    this._remove(normKey(key));
  }

  clear() {
    this.map.clear();
    this.bySite.clear();
    this.bytes = 0;
  }

  /**
   * Drop every cached key that could resolve to this site.
   * @param site   { _id, slug, customDomain: { name } }
   * @param extra  { oldSlug, oldDomain } — previous values after a change
   */
  invalidateSite(site = {}, extra = {}) {
    const root = cfg.ROOT_DOMAIN;
    const slugs = [site?.slug, extra?.oldSlug].filter(Boolean);
    const domains = [site?.customDomain?.name, extra?.oldDomain].filter(Boolean);
    for (const slug of slugs) {
      this.delete(`${slug}.${root}`);
      this.delete(`path:${slug}`);
    }
    for (const d of domains) this.delete(d);
    const id = site?._id ? String(site._id) : null;
    if (id && this.bySite.has(id)) {
      for (const k of [...this.bySite.get(id)]) this._remove(k);
      this.bySite.delete(id);
    }
  }

  _remove(k) {
    const entry = this.map.get(k);
    if (!entry) return;
    this.map.delete(k);
    this.bytes -= entry.size;
    if (entry.siteId && this.bySite.has(entry.siteId)) {
      const set = this.bySite.get(entry.siteId);
      set.delete(k);
      if (!set.size) this.bySite.delete(entry.siteId);
    }
  }

  _evict() {
    while (this.map.size > this.max || this.bytes > this.maxBytes) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this._remove(oldest);
    }
  }
}

export const hostCache = new HostCache();

export function invalidateSite(site, extra) {
  try {
    hostCache.invalidateSite(site, extra);
  } catch (err) {
    console.warn("[host-cache] invalidate failed:", err.message);
  }
}

export function invalidateHost(host) {
  hostCache.delete(host);
}
