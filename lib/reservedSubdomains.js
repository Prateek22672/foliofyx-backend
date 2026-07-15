// server/lib/reservedSubdomains.js
// Subdomain labels that must never resolve to a user site — shared by the
// wildcard host router (server.js) and the slug/username claim paths, so a
// user can never register e.g. "api" and shadow real infrastructure.
export const RESERVED_SUBDOMAINS = new Set([
  "www", "api", "app", "admin", "mail", "smtp", "imap", "pop", "ftp",
  "blog", "docs", "help", "support", "status", "dev", "staging", "test",
  "cdn", "assets", "static", "sites", "dashboard", "studio",
]);

export function isReservedSubdomain(label) {
  return RESERVED_SUBDOMAINS.has(String(label || "").toLowerCase().trim());
}
