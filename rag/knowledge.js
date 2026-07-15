// server/rag/knowledge.js
// ─────────────────────────────────────────────────────────────────────────────
// Design-knowledge corpus for the RAG pipeline.
//
// Each doc is a focused piece of award-winning web-design craft. The retriever
// (server/rag/retriever.js or python/rag_engine.py) chunks these, indexes them
// with BM25, and injects the top-k chunks into generation prompts so every
// AI-built page follows real design systems instead of model instinct.
//
// Doc shape: { id, tags: [..], industry?: "saas"|..., text }
// Keep each doc self-contained — chunks must make sense out of order.
// ─────────────────────────────────────────────────────────────────────────────

export const KNOWLEDGE_DOCS = [
  // ── Layout & composition ────────────────────────────────────────────────────
  {
    id: "layout-hero",
    tags: ["layout", "hero", "above-the-fold"],
    text: `Hero section rules. The hero must communicate one idea in under 3 seconds: who this is, what they offer, and one action. Structure: small eyebrow label (12-14px, uppercase, letter-spaced 1.5-3px, accent color), one dominant headline (56-88px desktop, 6-9 words max, tight line-height 1.02-1.1), one supporting sentence (18-20px, max 60ch, 60-70% opacity), then exactly one primary button plus at most one ghost/secondary button. Vertical rhythm: eyebrow to headline 16px, headline to subcopy 20-24px, subcopy to buttons 32-40px. Keep the hero between 88vh and 100vh. Never center more than 3 stacked text blocks; left-aligned heroes with a right-side visual convert better for products, centered heroes suit portfolios and studios.`,
  },
  {
    id: "layout-grid",
    tags: ["layout", "grid", "spacing", "alignment"],
    text: `Grid and spacing system. Use an 8px base unit; all gaps, paddings and offsets are multiples of 8 (8, 16, 24, 32, 48, 64, 96, 120). Page gutter: 80-120px on a 1200px canvas (content width 960-1040px). Section vertical padding: 96-140px top and bottom; consecutive sections must alternate rhythm (tight/spacious) to avoid monotony. Card grids: 3 columns for features (each ~340px wide, 32px gap), 2 columns for case studies, 4 columns max for logos/stats. Never let two adjacent elements sit closer than 16px. Align everything to a shared left edge — mixed alignments read as broken. Whitespace is a feature: if a section feels empty, improve the copy, do not add filler elements.`,
  },
  {
    id: "layout-sections-order",
    tags: ["layout", "structure", "narrative", "page"],
    text: `Page narrative order. High-converting single pages follow a story arc: 1) Hero (promise), 2) social proof strip (logos or a single strong metric), 3) problem/value section (3 features max, benefit-first), 4) show-the-work (screenshots, portfolio pieces, menu, listings — the concrete proof), 5) testimonial (one strong quote beats three weak ones), 6) pricing or offer (if commercial), 7) FAQ (objection handling, 4-6 items), 8) final CTA (repeat the hero promise with urgency), 9) footer (nav, contact, socials, legal). Skip a stage rather than fill it with weak content. Every section needs its own mini-hierarchy: label, heading, body — with the heading carrying the message.`,
  },
  {
    id: "layout-asymmetry",
    tags: ["layout", "composition", "cinematic", "award"],
    text: `Award-level composition. Perfectly symmetric layouts feel template-made. Introduce controlled asymmetry: offset the headline block to the left third, let one image bleed off-canvas, overlap a card 24-40px onto the previous section's background. Use big numbers (01, 02, 03) as graphic anchors for process/steps sections. One oversized element per viewport (a 120px+ display word, a full-bleed image) creates the "designed" feel. Contrast scale hard: pair a 96px display heading with 14px meta text. Diagonal or curved section dividers are dated — separate sections with color-block changes or generous whitespace instead.`,
  },

  // ── Typography ──────────────────────────────────────────────────────────────
  {
    id: "type-pairing",
    tags: ["typography", "fonts", "pairing"],
    text: `Font pairing rules. Use exactly two families per site: one display/heading face with personality, one neutral text face. Proven premium pairs: Playfair Display + Inter (editorial luxury), Space Grotesk + Inter (tech/startup), Fraunces + Work Sans (warm brand), Syne + DM Sans (creative studio), Libre Caslon + Source Sans 3 (law/finance), Sora + Inter (SaaS product), Cormorant Garamond + Montserrat (hospitality/restaurant), Archivo Black + Archivo (bold agency). Never pair two display faces. Headings: weight 600-800, letter-spacing -0.02em to -0.04em for large sizes. Body: 16-18px, line-height 1.6-1.75, weight 400, never pure black on white — use #1a1a2e-ish ink on warm white, or #e8e8f0 on dark.`,
  },
  {
    id: "type-scale",
    tags: ["typography", "scale", "hierarchy"],
    text: `Type scale. Use a modular scale around 1.25-1.333: 14 (meta/labels), 16-18 (body), 20 (lead), 24 (h4), 32 (h3), 40-48 (h2, section headings), 64-88 (h1/display, hero only). Every page needs at least 4 distinct levels visible above the fold. Uppercase only for labels/eyebrows 14px and below, always with +1.5px letter-spacing. Line length: 45-72 characters; wider text columns are unreadable. Numbers in stats look best in the display face with tabular figures, sized 48-72px with a small unit suffix.`,
  },

  // ── Color ───────────────────────────────────────────────────────────────────
  {
    id: "color-system",
    tags: ["color", "palette", "contrast"],
    text: `Color system. Build from exactly one accent hue plus a neutral ramp. Ratios: 60% background neutrals, 30% ink/text, 10% accent. The accent appears only on: primary buttons, links, eyebrow labels, key stats, and one decorative moment per viewport. Backgrounds: never flat #ffffff for the whole page — alternate warm white (#faf9f7 / #f7f7f9) sections with one dark contrast section (near-black with the accent) and optionally one tinted section (accent at 4-6% opacity). Dark sections make a page feel premium; use one for testimonials, stats, or the final CTA. Check contrast: body text 7:1, large headings 4.5:1 minimum. Gradients: only two stops, hues within 40 degrees of each other, applied to buttons or text-clips — never full-page rainbow gradients.`,
  },
  {
    id: "color-industry",
    tags: ["color", "industry", "mood"],
    text: `Industry palettes that convert. SaaS/tech: indigo/violet accent (#6366f1, #7c3aed) on cool neutrals, dark navy hero. Luxury/hotel: champagne gold (#b08d57) or deep green (#1a3a2f) on cream (#f6f2ea), serif display. Restaurant: appetite colors — terracotta (#c4532d), olive, cream; food photography full-bleed. Real estate: deep slate blue (#1e3a5f) + warm gray, trust-building. Law/finance: navy (#12233d) + burgundy or gold accents, conservative spacing. Creative/portfolio: near-black canvas (#0a0a0c) with one loud accent (electric blue, acid green, coral) and huge type. Health/wellness: sage (#87a08e), soft sand, rounded corners. E-commerce/fashion: monochrome black/white with product imagery carrying all color.`,
  },

  // ── Buttons, cards, imagery ────────────────────────────────────────────────
  {
    id: "components-buttons",
    tags: ["components", "buttons", "cta"],
    text: `Button craft. Primary button: accent background, white text, 16-18px semibold, padding 14-18px vertical / 28-40px horizontal, radius either 8-12px (product) or fully-rounded 999px (consumer/creative) — pick one radius language site-wide. Add a soft colored shadow: 0 8px 24px accent-at-25%. Hover: lift 2px + shadow deepens (transition 200ms ease-out). Secondary: 1.5px border in ink-at-15%, transparent bg, same padding. Button copy is a verb phrase with specificity: "Start building free", "Book a table", "View listings" — never "Submit", "Click here", "Learn more" as primary. Max one primary CTA per viewport.`,
  },
  {
    id: "components-cards",
    tags: ["components", "cards", "shadows", "depth"],
    text: `Card and depth system. Cards: white (or 4% tint) on the section background, radius 12-20px (match the button radius language), padding 28-40px, border 1px at ink-6% OR shadow — not both heavy. Shadow scale (pick per elevation): sm 0 1px 3px rgba(16,24,40,.08); md 0 8px 24px rgba(16,24,40,.10); lg 0 24px 48px -12px rgba(16,24,40,.18). Hover on interactive cards: translateY(-4px) + md→lg shadow, 200ms. Inside a card: icon or emoji in a 48px accent-tinted rounded square, 16px gap, 20px semibold title, 15-16px body at 65% opacity. Keep all cards in a row equal height with aligned baselines.`,
  },
  {
    id: "components-imagery",
    tags: ["images", "photography", "media"],
    text: `Imagery rules. Photography must share one grade across the site: same warmth, same saturation. Use large images sparingly but decisively — one full-bleed image section beats six small ones. Radius on images matches the site radius language. Always set meaningful alt text describing the subject (SEO + accessibility). Portraits for testimonials: 48-64px circles. Product/portfolio shots: 4:3 or 16:10, consistent per grid. Overlay text on images only with a gradient scrim (black at 55% from the bottom) and white text. Never stretch or squash; use object-fit cover with a sensible focal position.`,
  },

  // ── Motion & cinematic feel ────────────────────────────────────────────────
  {
    id: "motion-principles",
    tags: ["motion", "animation", "cinematic", "scroll"],
    text: `Motion principles for a cinematic feel. Animate on scroll-into-view: fade-up 24-32px with 500-700ms ease-out, staggered 80-120ms between siblings. Hero elements animate on load: headline first, subcopy +120ms, buttons +240ms. Use scale-in (0.96→1) for images and cards. Never animate more than 3 property types at once, never bounce business content, and keep every duration under 800ms — slow animation reads as lag, not luxury. Parallax: background moves at 0.85-0.9x scroll speed maximum; subtle or not at all. Hover micro-interactions (lift, underline slide-in, arrow nudge 4px right) do more for perceived quality than big scroll effects. Respect prefers-reduced-motion by disabling all of it.`,
  },

  // ── Copywriting ────────────────────────────────────────────────────────────
  {
    id: "copy-headlines",
    tags: ["copywriting", "headlines", "conversion"],
    text: `Headline craft. Lead with the outcome, not the category: "Fill every table, every night" beats "Restaurant Marketing Services". Formulas that work: outcome + timeframe ("Launch your store in a weekend"), pain inversion ("Stop losing leads to slow follow-up"), identity claim ("Built for chefs who own the room"). 6-9 words. Subheadline explains the how in one concrete sentence with a number or specific noun. Ban list: "Welcome to", "We are a", "solutions", "innovative", "cutting-edge", "unleash", "elevate your", lorem ipsum, and any bracketed placeholder. Every stat needs a unit and a noun: "2,400+ homes sold", not "2400+".`,
  },
  {
    id: "copy-voice",
    tags: ["copywriting", "voice", "credibility"],
    text: `Voice and credibility. Write like a confident specialist, not a brochure: short sentences, active verbs, second person ("you") for benefits, first person plural ("we") sparingly for process. Specificity is credibility — name the neighborhood, the cuisine, the tech stack, the year founded. Testimonials must sound spoken, include a full name, role and company, and mention one concrete result. Feature blocks: title is the benefit (3-5 words), body is the mechanism (one sentence, max 16 words). FAQs answer real objections (price, time, ownership, support) in 2-3 sentences, first person, no corporate hedging.`,
  },

  // ── E-commerce & interactivity ─────────────────────────────────────────────
  {
    id: "ecom-product-grid",
    tags: ["ecommerce", "shop", "products", "cart"],
    industry: "ecommerce",
    text: `E-commerce layout. Product grid: 3-4 columns, each card = image (1:1 or 4:5, cover), name (16px semibold), one-line variant/description (14px, 60% opacity), price (16px bold, accent or ink), and an "Add to cart" button that appears persistent on mobile and on-hover on desktop. Show 6-8 products on the landing grid with a "View all" link. A cart icon with a live count badge belongs in the navbar (top right). Product detail emphasis: big image left, name/price/CTA right, trust row (shipping, returns, secure checkout) under the button. Category filter chips above the grid. Currency symbol always with the price. Cross-sell strip ("You may also like") before the footer.`,
  },
  {
    id: "ecom-cart-ux",
    tags: ["ecommerce", "cart", "checkout", "javascript"],
    industry: "ecommerce",
    text: `Cart UX logic. Add-to-cart must give instant feedback: button briefly swaps to "Added ✓", cart badge increments with a small pop animation. The cart itself: slide-in drawer from the right (not a separate page for small stores), listing each item with thumbnail, name, unit price, quantity stepper (- 1 +), line total, and remove. Footer of drawer: subtotal, shipping note ("Free shipping over $75"), primary checkout button. Persist the cart in localStorage under a single JSON key so it survives reloads. Empty state: friendly message + "Continue shopping". Quantity changes recalc totals instantly, no page reload. Keep the whole cart runtime dependency-free vanilla JS.`,
  },
  {
    id: "js-interactions",
    tags: ["javascript", "interactions", "logic", "runtime"],
    text: `Standard interactive behaviors for a static site runtime (vanilla JS, no libraries): 1) Mobile nav toggle — hamburger swaps to X, menu slides down, body scroll locks. 2) Smooth-scroll for same-page anchor links with a 72px header offset. 3) Scroll-reveal — IntersectionObserver adds a .visible class once, threshold 0.15. 4) Sticky header that gains a shadow + shrinks padding after 40px scroll. 5) Accordion FAQs — one open at a time, height animates, chevron rotates. 6) Tabs — aria-selected switching, arrow-key support. 7) Simple carousel/testimonial rotator — auto-advance 6s, pauses on hover, dots. 8) Form validation — inline errors on blur, disable submit while sending, success state replaces the form. 9) Countdown timers for offers. 10) Cart runtime (see cart UX). All listeners attach after DOMContentLoaded; everything works without console errors when elements are absent.`,
  },

  // ── Industry blueprints ────────────────────────────────────────────────────
  {
    id: "blueprint-restaurant",
    tags: ["blueprint", "restaurant", "structure"],
    industry: "restaurant",
    text: `Restaurant site blueprint. Sections: full-bleed hero (dish or interior photo, scrim, script or serif display name, one line of cuisine/neighborhood, "Book a table" + "View menu"), signature dishes grid (3, photo-led, price), story block (chef photo + 2 short paragraphs, founded year), menu preview (2-column list: dish name dotted-leader price, 8-12 items, PDF/full menu link), ambience gallery (3-5 photos, one large), reviews (one big quote + reviewer), visit block (address, hours table, map hint, phone as tel: link), reservation CTA band, footer. Colors: appetite palette, dark section for the reviews. Tone: sensory adjectives, no corporate speak.`,
  },
  {
    id: "blueprint-saas",
    tags: ["blueprint", "saas", "structure"],
    industry: "saas",
    text: `SaaS site blueprint. Sections: hero (left text + right product screenshot in a browser frame with soft shadow; headline = outcome, sub = mechanism + integration count; CTA "Start free" + "Book demo"), logo strip ("Trusted by" 5-6 grayscale logos), 3 feature cards (icon, benefit title, mechanism line), deep-dive feature rows (alternating screenshot left/right, 2-3 rows), metrics band on dark (3-4 stats), testimonial (photo + quote + name/role), pricing (3 tiers, middle highlighted "Most popular", feature checklists, annual toggle note), FAQ (5), final CTA band (accent bg, white headline, one button), footer with product/company/legal columns. Radius language 8-12px, indigo-family accent.`,
  },
  {
    id: "blueprint-portfolio",
    tags: ["blueprint", "portfolio", "personal", "structure"],
    industry: "portfolio",
    text: `Personal portfolio blueprint. Sections: hero (huge name or role statement 72-96px, one-line positioning, availability badge "Open to work" with green dot, links: email + GitHub + LinkedIn), selected work (2-column large cards: cover, project name, one-line impact, tech tags; 4-6 projects), about (photo + 3 short paragraphs: now, before, beyond work), skills/stack (grouped chips, not progress bars — skill bars are amateur), experience timeline (role, company, dates, one impact bullet each), testimonial/reference quote optional, contact CTA (big "Let's work together", email button), minimal footer. Dark near-black canvas with one loud accent works best. Big type, generous whitespace, zero clutter.`,
  },
  {
    id: "blueprint-realestate",
    tags: ["blueprint", "realestate", "structure"],
    industry: "realestate",
    text: `Real-estate site blueprint. Sections: hero (skyline/interior photo with scrim, headline "Find your place in [City]", search-style CTA), featured listings grid (3-6 cards: photo, price bold 20px, address, beds/baths/sqft meta row, "View" link), value props (3: local expertise, negotiation record, concierge process), stats band ($ volume sold, homes closed, avg days on market), agent/team block (portrait + bio + license number for trust), testimonial, neighborhood guide teasers (3 area cards), CTA band ("Get a free valuation"), footer with brokerage legal line. Palette: deep slate blue + warm neutrals; photography does the selling.`,
  },
  {
    id: "blueprint-agency",
    tags: ["blueprint", "agency", "marketing", "structure"],
    industry: "marketing",
    text: `Agency site blueprint. Sections: hero (bold claim about outcomes, client-count proof line, "See our work"), marquee client logo strip, services (3-4 cards named as outcomes: "Brands that stick", "Traffic that converts"), case studies (2 large cards: cover, client, metric headline "+212% organic traffic", link), process (3-4 numbered steps with the big-number graphic treatment), team strip optional, testimonial on dark, awards/press mentions row, CTA band ("Book a strategy call" with calendar promise), footer. Tone: confident, numbers everywhere, zero generic "we are passionate" filler. Big display type, one acid accent on near-black or stark white.`,
  },
  {
    id: "blueprint-hotel",
    tags: ["blueprint", "hotel", "hospitality", "structure"],
    industry: "hotel",
    text: `Hotel/resort blueprint. Sections: cinematic full-bleed hero (property at golden hour, serif display name, location line, "Check availability" CTA + date hint), intro editorial block (centered serif paragraph, generous whitespace), rooms & suites (2-3 large cards: photo, name, from-price per night, 2-line description, "Explore"), amenities grid (6 icon items: spa, dining, pool...), dining highlight (full-width image + overlay card), experiences/local guide (3 cards), guest reviews (one elegant quote, star row), location block (map hint + travel notes), booking CTA band, footer with contact/concierge. Palette: cream + champagne gold or deep green; serif display + light sans body; slow fade-up motion only.`,
  },
  {
    id: "blueprint-ecommerce",
    tags: ["blueprint", "ecommerce", "shop", "structure"],
    industry: "ecommerce",
    text: `E-commerce landing blueprint. Sections: announcement bar (offer/shipping threshold), navbar with cart icon + count, hero (product lifestyle shot, headline = product promise, "Shop now"), category tiles (2-4), bestsellers grid (6-8 product cards with add-to-cart), value props strip (free shipping, returns, secure payment — icon row), featured collection banner (full-width, seasonal), reviews with stars (2-3 short ones with names), Instagram/social proof grid optional, email capture ("10% off your first order"), footer with shop/help/legal columns. Cart drawer + localStorage runtime required. Monochrome base, product photography carries the color.`,
  },

  // ── Template recreation ────────────────────────────────────────────────────
  {
    id: "recreate-fidelity",
    tags: ["recreation", "reference", "fidelity", "replicate"],
    text: `Recreating a reference design. Priority order for fidelity: 1) structural skeleton — section count, order, and each section's layout pattern (split/centered/grid); 2) spacing rhythm — match section heights and paddings within 10%; 3) typography hierarchy — match relative scale jumps, then find the closest available font (serif→Playfair/Fraunces, geometric sans→Space Grotesk/Sora, grotesque→Inter/Archivo, rounded→Nunito/Quicksand); 4) exact colors — sample dominant background, ink, and accent; 5) content mapping — keep the reference's content types (nav labels count, card counts, stat counts) but never copy its copyrighted text verbatim, paraphrase the intent. Alignment beats decoration: if the reference is left-aligned 12-col, matching that matters more than matching its icons. Reproduce hover/motion character last.`,
  },

  {
    id: "recreate-band-mapping",
    tags: ["recreation", "reference", "bands", "sections", "layout"],
    text: `Mapping visual bands to sections when recreating a reference. Read the screenshot as horizontal bands from top to bottom and assign each band exactly one section role. A thin dense band at the very top (under ~8% of page height, text at both edges) is the navbar. The first tall band after it (25-45% of page height, one dominant text cluster, often a large image or colored background) is the hero. A short low-density strip of small repeated marks after the hero is a logo/social-proof strip. A band with 2-4 equal-width repeated blocks is a card grid (features, services, listings); count the columns and reproduce the same count. A band whose background contrasts hard with the page (dark on light or accent-filled) is a stats band or CTA band - short content, big numbers or one headline plus one button. A band with a single centered quote is a testimonial. The final dense low-height band is the footer. Preserve band ORDER exactly; never merge two bands into one section or split one band into two. When a band is ambiguous, prefer the simpler role and keep its height proportion.`,
  },
  {
    id: "recreate-palette-five",
    tags: ["recreation", "reference", "color", "palette", "accent"],
    text: `Extracting a working palette from a reference. Reduce the reference to exactly FIVE colors with fixed roles: 1) background - the largest area color; 2) surface/band - the second large neutral used for alternating sections and cards, within 10% luminance of the background; 3) ink/text - the highest-contrast color against the background; 4) muted - a mid-luminance gray for secondary text; 5) ONE accent - the most saturated color that occupies a real area (buttons, links, highlights). Never promote two accent hues: if the reference shows several saturated colors, pick the one used on the primary button and demote the rest. Apply the accent only to primary buttons, eyebrow labels, key stats and one decorative moment; everything else stays on the neutral ramp. Preserve the light/dark relationship of the original: a dark reference (background luminance under 50%) must be recreated dark, with text near-white, never inverted. Gradients in the recreation use the accent and a shade of the same hue, never two unrelated hues.`,
  },
  {
    id: "recreate-proportions-typography",
    tags: ["recreation", "reference", "layout", "proportions", "typography", "fonts"],
    text: `Preserving layout proportions on a 1200px canvas. Convert every position and size from the reference into pixels on a 1200px-wide canvas: multiply horizontal fractions by 1200 and vertical fractions by 1200 times the reference's height/width ratio. Keep each section's height within 10% of its proportional height in the reference - a hero that filled half the screenshot stays about half. Full-width bands run x:0 to 1200; inner content sits inside 80-120px gutters (content x between roughly 100 and 1100). Keep left/right split ratios (a 60/40 hero stays 60/40) and column counts. Nothing may have negative coordinates or exceed the canvas width, and y always increases down the page in reading order.

Typography pairing when recreating. Identify the reference's heading style, then map it to the closest available pair - high-contrast serif display: Playfair Display or Fraunces with Inter or DM Sans body; geometric or grotesque sans: Space Grotesk, Syne or Sora with Inter body; tall condensed: Oswald with Inter body; rounded friendly: Nunito Sans pairing. Use exactly one display face for headings and one neutral face for body. Match the SCALE RATIO between levels rather than absolute sizes: if the hero headline is about 4x the body size in the reference, keep that ratio (body 16-18px, hero 64-88px on the 1200px canvas). Keep heading weight 700-800 with slightly negative letter-spacing, and uppercase treatment only where the reference uses it (labels, eyebrows).`,
  },

  // ── SEO for generated sites ────────────────────────────────────────────────
  {
    id: "seo-generated-sites",
    tags: ["seo", "meta", "structure"],
    text: `SEO for generated sites. Every page needs: a unique title (primary keyword + brand, under 60 chars), meta description (140-155 chars, includes the keyword and a reason to click), exactly one h1 (the hero headline), h2s for each section heading in logical order, descriptive alt text on all images, and internal anchor links in the nav. Add Open Graph (og:title, og:description, og:image 1200x630) and twitter:card summary_large_image. JSON-LD: LocalBusiness for restaurants/hotels/local services (name, address, phone, hours, priceRange), Person for portfolios (name, jobTitle, sameAs socials), Product with offers for e-commerce items, Organization elsewhere. Load fonts with display=swap, keep total page weight lean, semantic tags (header, main, section, footer) over div soup.`,
  },
];

// Labeled examples for the trainable industry/intent classifier (python side).
// Format: [text, industry]. Extend freely — retraining is automatic.
export const CLASSIFIER_SEED = [
  ["modern sushi restaurant in downtown with omakase menu and reservations", "restaurant"],
  ["cozy italian bistro website with menu pasta wine list book a table", "restaurant"],
  ["coffee shop cafe landing page with pastries and opening hours", "restaurant"],
  ["b2b saas analytics dashboard startup free trial pricing tiers", "saas"],
  ["project management tool for remote teams with integrations api", "saas"],
  ["ai writing assistant app subscription software product landing", "saas"],
  ["personal portfolio for a frontend developer with projects and resume", "portfolio"],
  ["photographer portfolio gallery with booking and prints", "portfolio"],
  ["ux designer personal site case studies about contact", "portfolio"],
  ["luxury real estate listings agency homes for sale in miami", "realestate"],
  ["realtor website property search featured listings free valuation", "realestate"],
  ["apartment rentals condos property management company", "realestate"],
  ["online fashion store with cart checkout and new arrivals", "ecommerce"],
  ["handmade jewelry shop product grid add to cart free shipping", "ecommerce"],
  ["sneaker store ecommerce bestsellers collections discount code", "ecommerce"],
  ["law firm website attorneys practice areas free consultation", "law"],
  ["criminal defense lawyer legal counsel case results", "law"],
  ["boutique hotel resort spa rooms suites booking availability", "hotel"],
  ["beach villa resort with restaurant pool and experiences", "hotel"],
  ["digital marketing agency seo campaigns case studies clients", "marketing"],
  ["branding studio creative agency portfolio of client work", "marketing"],
  ["fitness coach personal training programs testimonials", "general"],
  ["nonprofit charity donation volunteer community", "general"],
  ["wedding planner events services gallery pricing", "general"],
];
