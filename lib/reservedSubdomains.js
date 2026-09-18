// server/lib/reservedSubdomains.js
// Subdomain labels that must never resolve to a user site — shared by the
// wildcard host router (server.js) and the slug/username claim paths, so a
// user can never register e.g. "api" and shadow real infrastructure.
//
// Deliberately limited to infrastructure and phishing-sensitive words: adding
// a label here stops an existing site with that slug from serving on its
// subdomain, so don't reserve ordinary words.
export const RESERVED_SUBDOMAINS = new Set([
  // infrastructure / DNS / mail
  "www", "www1", "www2", "api", "app", "apps", "admin", "administrator", "root",
  "mail", "email", "webmail", "smtp", "imap", "pop", "pop3", "ftp", "sftp", "ssh",
  "vpn", "ns", "ns1", "ns2", "dns", "mx", "autodiscover", "autoconfig",
  "_acme-challenge", "_cf-custom-hostname", "_domainkey", "_dmarc", "_foliofyx",
  // product surfaces (and names that would make convincing phishing pages)
  "site", "sites", "studio", "dashboard", "account", "accounts", "auth", "login",
  "logout", "signin", "signup", "register", "password", "verify", "secure",
  "billing", "pay", "payment", "payments", "checkout", "foliofyx",
  // content / support
  "blog", "docs", "help", "support", "status",
  // assets / environments
  "cdn", "static", "assets", "media", "uploads", "dev", "staging", "test",
  "internal", "localhost",
]);

export function isReservedSubdomain(label) {
  return RESERVED_SUBDOMAINS.has(String(label || "").toLowerCase().trim());
}
