// server/rag/industry.js
// Deterministic regex industry detection — the always-available fallback the
// trained Python classifier (rag_engine.py) is checked against. Moved out of
// aiBuilderController so both the controller and the retriever can import it
// without a circular dependency.

export function detectIndustry(prompt = "") {
  const p = prompt.toLowerCase();
  if (/real.?estat|propert|listing|realtor|house|apartment|condo|for sale|for rent/.test(p)) return "realestate";
  if (/restaurant|food|menu|chef|dining|cuisine|cafe|bistro|eatery|bar & grill/.test(p)) return "restaurant";
  if (/ecommerce|e-commerce|shop|store|cart|checkout|fashion|product launch|dtc|sell online|merch/.test(p)) return "ecommerce";
  if (/saas|software|app|dashboard|platform|startup|api|b2b|tool|product/.test(p)) return "saas";
  if (/portfolio|designer|developer|freelance|photographer|my work|personal site|resume/.test(p)) return "portfolio";
  if (/law|legal|attorney|counsel|law firm|lawyer|advocate/.test(p)) return "law";
  if (/hotel|resort|hospitality|spa|villa|booking/.test(p)) return "hotel";
  if (/agency|marketing|digital|seo|advertis|campaign|branding/.test(p)) return "marketing";
  return "general";
}
