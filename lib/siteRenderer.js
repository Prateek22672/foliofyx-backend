// server/lib/siteRenderer.js
// ─────────────────────────────────────────────────────────────────────────────
// Server-side renderer: CustomWebsite JSON → a complete, standalone HTML page.
//
// This is what makes "publish" real: /site/:slug and connected custom domains
// serve this output directly, so published sites are crawlable (full SEO tags,
// JSON-LD), fast (zero framework payload) and interactive (small vanilla-JS
// runtime: scroll-reveal, smooth anchors, sticky nav, accordion, and an
// add-to-cart drawer persisted in localStorage when the page sells products).
//
// The canvas model is 1200px wide with absolutely positioned elements; we
// render it 1:1 and scale the whole stage to the viewport width with a tiny
// resize script — identical geometry to the editor, no reflow surprises.
// ─────────────────────────────────────────────────────────────────────────────

const CANVAS_W = 1200;

const esc = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

const escAttr = esc;
const parts = (content) => String(content || "").split("|").map((p) => p.trim());

// ── Style serialization ──────────────────────────────────────────────────────
function styleCSS(el) {
  const s = el.styles || {};
  const css = [];
  const px = (v) => (typeof v === "number" ? `${v}px` : v);

  css.push(`left:${el.x || 0}px`, `top:${el.y || 0}px`, `width:${el.width || 200}px`);
  css.push(el.height === "auto" || el.height === undefined ? "height:auto" : `height:${px(el.height)}`);
  css.push(`z-index:${el.zIndex || 1}`);

  if (s.fontFamily) css.push(`font-family:'${s.fontFamily}',sans-serif`);
  if (s.fontSize) css.push(`font-size:${px(s.fontSize)}`);
  if (s.fontWeight) css.push(`font-weight:${s.fontWeight}`);
  if (s.fontStyle) css.push(`font-style:${s.fontStyle}`);
  if (s.color) css.push(`color:${s.color}`);
  if (s.textAlign) css.push(`text-align:${s.textAlign}`);
  if (s.lineHeight) css.push(`line-height:${s.lineHeight}`);
  if (s.letterSpacing) css.push(`letter-spacing:${s.letterSpacing}px`);
  if (s.textTransform) css.push(`text-transform:${s.textTransform}`);
  if (s.textShadow) css.push(`text-shadow:${s.textShadow}`);

  if (s.bgType === "gradient" && s.gradientFrom && s.gradientTo) {
    css.push(`background:linear-gradient(${s.gradientDir || "135deg"},${s.gradientFrom},${s.gradientTo})`);
  } else if (s.bgType === "image" && s.bgImage) {
    css.push(`background-image:url('${escAttr(s.bgImage)}')`, `background-size:${s.bgSize || "cover"}`, "background-position:center");
  } else if (s.bgColor && s.bgType !== "transparent") {
    css.push(`background-color:${s.bgColor}`);
  }

  if (s.borderRadius !== undefined) css.push(`border-radius:${px(s.borderRadius)}`);
  if (s.borderWidth) css.push(`border:${s.borderWidth}px ${s.borderStyle || "solid"} ${s.borderColor || "#000"}`);
  if (s.padding !== undefined) css.push(`padding:${px(s.padding)}`);
  if (s.boxShadow) css.push(`box-shadow:${s.boxShadow}`);
  if (s.opacity !== undefined && s.opacity !== 1) css.push(`opacity:${s.opacity}`);
  if (s.objectFit) css.push(`object-fit:${s.objectFit}`);
  if (s.overflow) css.push(`overflow:${s.overflow}`);
  if (s.backdropBlur) css.push(`backdrop-filter:blur(${s.backdropBlur}px)`);
  if (s.filter) css.push(`filter:${s.filter}`);
  if (s.mixBlendMode) css.push(`mix-blend-mode:${s.mixBlendMode}`);
  if (s.rotate) css.push(`transform:rotate(${s.rotate}deg)`);
  return css.join(";");
}

// ── Per-type inner HTML ──────────────────────────────────────────────────────
function inner(el, ctx) {
  const c = el.content || "";
  switch (el.type) {
    // "heading" is handled in renderElement (needs the h1-once bookkeeping).
    case "subheading": return `<h3 class="fyx-txt">${esc(c)}</h3>`;
    case "paragraph":
    case "quote":      return `<p class="fyx-txt">${esc(c)}</p>`;
    case "label":
    case "badge":      return `<span class="fyx-txt">${esc(c)}</span>`;
    case "button": {
      const isCart = /add to cart|buy now/i.test(c);
      const href = el.href ? ` href="${escAttr(el.href)}"` : ` href="#"`;
      if (isCart) ctx.hasCart = true;
      return isCart
        ? `<button type="button" class="fyx-btn" data-cart-add data-name="${escAttr(ctx.lastProductName || "Item")}" data-price="${escAttr(ctx.lastProductPrice || "0")}">${esc(c)}</button>`
        : `<a${href} class="fyx-btn"${el.target === "_blank" ? ' target="_blank" rel="noopener"' : ""}>${esc(c)}</a>`;
    }
    case "image":
      return `<img src="${escAttr(el.src || "")}" alt="${escAttr(el.alt || el.content || "image")}" loading="lazy">`;
    case "video":
      return el.src ? `<video src="${escAttr(el.src)}" controls playsinline style="width:100%;height:100%"></video>` : "";
    case "list":
      return `<ul class="fyx-list">${parts(c).map((li) => `<li>${esc(li)}</li>`).join("")}</ul>`;
    case "feature":
    case "service": {
      const [title, desc, emoji] = parts(c);
      return `<div class="fyx-card-in">${emoji ? `<div class="fyx-emoji">${esc(emoji)}</div>` : ""}<div class="fyx-card-t">${esc(title || "")}</div><div class="fyx-card-d">${esc(desc || "")}</div></div>`;
    }
    case "stats": {
      const [num, label] = parts(c);
      return `<div class="fyx-stat"><div class="fyx-stat-n">${esc(num || "")}</div><div class="fyx-stat-l">${esc(label || "")}</div></div>`;
    }
    case "testimonial": {
      const [quote, name, role] = parts(c);
      return `<figure class="fyx-quote"><blockquote>&ldquo;${esc(quote || "")}&rdquo;</blockquote><figcaption><strong>${esc(name || "")}</strong>${role ? ` · ${esc(role)}` : ""}</figcaption></figure>`;
    }
    case "pricing": {
      const [plan, price, period, desc, ...features] = parts(c);
      return `<div class="fyx-price"><div class="fyx-price-plan">${esc(plan || "")}</div><div class="fyx-price-amt">${esc(price || "")}<span>${esc(period || "")}</span></div><div class="fyx-price-desc">${esc(desc || "")}</div><ul>${features.map((f) => `<li>${esc(f)}</li>`).join("")}</ul></div>`;
    }
    case "property": {
      const [name, price, details] = parts(c);
      ctx.lastProductName = name; ctx.lastProductPrice = (price || "").replace(/[^0-9.]/g, "");
      return `<div class="fyx-card-in"><div class="fyx-card-t">${esc(name || "")}</div><div class="fyx-price-amt" style="font-size:20px">${esc(price || "")}</div><div class="fyx-card-d">${esc(details || "")}</div></div>`;
    }
    case "team": {
      const [name, role] = parts(c);
      return `<div class="fyx-card-in"><div class="fyx-card-t">${esc(name || "")}</div><div class="fyx-card-d">${esc(role || "")}</div></div>`;
    }
    case "faq": {
      const [q, a] = parts(c);
      return `<details class="fyx-faq"><summary>${esc(q || "")}</summary><p>${esc(a || "")}</p></details>`;
    }
    case "timeline": {
      const [when, what, detail] = parts(c);
      return `<div class="fyx-tl"><span class="fyx-tl-when">${esc(when || "")}</span><strong>${esc(what || "")}</strong><p>${esc(detail || "")}</p></div>`;
    }
    case "cta": {
      const [title, sub] = parts(c);
      return `<div class="fyx-cta"><h2>${esc(title || "")}</h2>${sub ? `<p>${esc(sub)}</p>` : ""}</div>`;
    }
    case "navbar": {
      const items = parts(c);
      const brand = items.shift() || "";
      return `<nav class="fyx-nav"><span class="fyx-nav-brand">${esc(brand)}</span><span class="fyx-nav-links">${items.map((i) => `<a href="#${escAttr(i.toLowerCase().replace(/\s+/g, "-"))}">${esc(i)}</a>`).join("")}</span><span class="fyx-cart-btn" data-cart-open hidden>🛒 <b data-cart-count>0</b></span></nav>`;
    }
    case "logostrip":
      return `<div class="fyx-logos">${parts(c).map((l) => `<span>${esc(l)}</span>`).join("")}</div>`;
    case "divider":  return `<hr class="fyx-hr">`;
    case "shape":
    case "box":
    case "spacer":   return "";
    case "icon":     return `<span class="fyx-emoji">${esc(c)}</span>`;
    case "social":
      return `<div class="fyx-social">${parts(c).map((s) => `<span>${esc(s)}</span>`).join("")}</div>`;
    default:
      return c ? `<div class="fyx-txt">${esc(c)}</div>` : "";
  }
}

function renderElement(el, ctx) {
  if (el.visible === false) return "";
  let body;
  if (el.type === "heading") {
    const tag = ctx.h1Used ? "h2" : "h1";
    ctx.h1Used = true;
    body = `<${tag} class="fyx-txt">${esc(el.content || "")}</${tag}>`;
  } else {
    body = inner(el, ctx);
  }
  const anim = el.animation && el.animation !== "none" ? ` data-reveal` : "";
  const wrapped = el.linkWrap ? `<a href="${escAttr(el.linkWrap)}">${body}</a>` : body;
  const idAttr = el.htmlId ? ` id="${escAttr(el.htmlId)}"` : "";
  return `<div class="fyx-el fyx-${escAttr(el.type)}${el.className ? " " + escAttr(el.className) : ""}"${idAttr} style="${styleCSS(el)}"${anim}>${wrapped}</div>`;
}

// ── Google Fonts link from every font used on the page ──────────────────────
function fontsLink(site, page) {
  const fams = new Set([site?.settings?.globalFont || "DM Sans"]);
  for (const el of page.elements || []) if (el.styles?.fontFamily) fams.add(el.styles.fontFamily);
  const q = [...fams].filter(Boolean).slice(0, 6)
    .map((f) => `family=${encodeURIComponent(f).replace(/%20/g, "+")}:wght@400;500;600;700;800`)
    .join("&");
  return `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?${q}&display=swap" rel="stylesheet">`;
}

// ── JSON-LD by industry ──────────────────────────────────────────────────────
function jsonLd(site, url) {
  const name = site.settings?.metaTitle || site.title || "Website";
  const desc = site.settings?.metaDesc || "";
  const base = { "@context": "https://schema.org", name, url, description: desc };
  const byIndustry = {
    restaurant: { "@type": "Restaurant", servesCuisine: "" },
    hotel: { "@type": "Hotel" },
    realestate: { "@type": "RealEstateAgent" },
    law: { "@type": "LegalService" },
    portfolio: { "@type": "Person" },
    ecommerce: { "@type": "OnlineStore" },
  };
  const extra = byIndustry[site.industry] || { "@type": "Organization" };
  return `<script type="application/ld+json">${JSON.stringify({ ...base, ...extra })}</script>`;
}

// ── Page background CSS ──────────────────────────────────────────────────────
function pageBg(page) {
  if (page.bgType === "gradient" && page.gradFrom && page.gradTo) {
    return `background:linear-gradient(${page.gradDir || "135deg"},${page.gradFrom},${page.gradTo})`;
  }
  if (page.bgType === "image" && page.bgImage) {
    return `background-image:url('${escAttr(page.bgImage)}');background-size:${page.bgSize || "cover"};background-position:${page.bgPos || "center"};background-repeat:${page.bgRepeat || "no-repeat"}`;
  }
  return `background-color:${page.bgColor || "#ffffff"}`;
}

const BASE_CSS = `
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{-webkit-font-smoothing:antialiased;overflow-x:hidden}
img{max-width:100%;display:block;width:100%;height:100%;object-fit:cover;border-radius:inherit}
a{color:inherit;text-decoration:none}
.fyx-viewport{width:100%;overflow:hidden;position:relative}
.fyx-stage{width:${CANVAS_W}px;position:relative;transform-origin:top left}
.fyx-el{position:absolute}
.fyx-txt{font:inherit;color:inherit;line-height:inherit;letter-spacing:inherit;text-align:inherit;font-size:inherit;font-weight:inherit}
h1.fyx-txt,h2.fyx-txt,h3.fyx-txt{font-size:inherit;font-weight:inherit}
.fyx-btn{display:inline-flex;align-items:center;justify-content:center;width:100%;height:100%;font:inherit;color:inherit;background:transparent;border:0;cursor:pointer;border-radius:inherit;transition:transform .2s ease,box-shadow .2s ease}
.fyx-btn:hover{transform:translateY(-2px)}
.fyx-list{list-style-position:inside}
.fyx-card-in{display:flex;flex-direction:column;gap:10px;height:100%}
.fyx-emoji{font-size:30px;line-height:1}
.fyx-card-t{font-weight:700;font-size:1.1em}
.fyx-card-d{opacity:.72;font-size:.92em;line-height:1.55}
.fyx-stat{display:flex;flex-direction:column;gap:4px;align-items:inherit}
.fyx-stat-n{font-weight:800;font-size:2.2em;line-height:1}
.fyx-stat-l{opacity:.65;font-size:.85em;text-transform:uppercase;letter-spacing:1.5px}
.fyx-quote blockquote{font-size:1.15em;line-height:1.6;font-style:italic}
.fyx-quote figcaption{margin-top:14px;opacity:.75;font-size:.9em}
.fyx-price ul{list-style:none;margin-top:12px;display:flex;flex-direction:column;gap:8px;font-size:.92em}
.fyx-price ul li::before{content:"✓ ";opacity:.6}
.fyx-price-plan{font-weight:600;letter-spacing:1px;text-transform:uppercase;font-size:.8em;opacity:.7}
.fyx-price-amt{font-size:2em;font-weight:800;margin:6px 0}
.fyx-price-amt span{font-size:.45em;font-weight:500;opacity:.6;margin-left:4px}
.fyx-price-desc{opacity:.72;font-size:.9em}
.fyx-faq summary{cursor:pointer;font-weight:600;padding:6px 0}
.fyx-faq p{padding:6px 0 10px;opacity:.75;line-height:1.6}
.fyx-nav{display:flex;align-items:center;justify-content:space-between;width:100%;height:100%}
.fyx-nav-brand{font-weight:800;font-size:1.15em}
.fyx-nav-links{display:flex;gap:28px;align-items:center;font-size:.95em}
.fyx-nav-links a{opacity:.8;transition:opacity .2s}.fyx-nav-links a:hover{opacity:1}
.fyx-logos{display:flex;gap:40px;align-items:center;justify-content:space-between;width:100%;opacity:.55;font-weight:700}
.fyx-hr{border:0;border-top:1px solid currentColor;opacity:.15;width:100%}
.fyx-tl-when{font-size:.8em;opacity:.6;display:block}
.fyx-cta h2{font-size:1.8em}
.fyx-social{display:flex;gap:16px}
[data-reveal]{opacity:0;transform:translateY(26px);transition:opacity .6s ease-out,transform .6s ease-out}
[data-reveal].fyx-in{opacity:1;transform:none}
.fyx-cart-btn{cursor:pointer;margin-left:20px}
.fyx-cart-btn b{display:inline-block;min-width:18px;text-align:center;background:#111;color:#fff;border-radius:999px;font-size:11px;padding:1px 5px}
#fyx-cart{position:fixed;top:0;right:-360px;width:340px;height:100vh;background:#fff;color:#111;box-shadow:-12px 0 40px rgba(0,0,0,.18);transition:right .3s ease;z-index:9999;display:flex;flex-direction:column;font-family:inherit}
#fyx-cart.open{right:0}
#fyx-cart header{display:flex;justify-content:space-between;align-items:center;padding:18px;border-bottom:1px solid #eee;font-weight:700}
#fyx-cart .items{flex:1;overflow-y:auto;padding:12px 18px;display:flex;flex-direction:column;gap:14px}
#fyx-cart .item{display:flex;justify-content:space-between;gap:10px;font-size:14px;align-items:center}
#fyx-cart .qty{display:flex;gap:8px;align-items:center}
#fyx-cart .qty button{width:22px;height:22px;border:1px solid #ddd;background:#fff;border-radius:6px;cursor:pointer}
#fyx-cart footer{padding:18px;border-top:1px solid #eee}
#fyx-cart .checkout{width:100%;padding:13px;background:#111;color:#fff;border:0;border-radius:10px;font-weight:600;cursor:pointer}
@media (prefers-reduced-motion:reduce){[data-reveal]{transition:none;opacity:1;transform:none}}
`;

const RUNTIME_JS = `
(function(){
  // Scale the 1200px stage to the viewport.
  var stage=document.querySelector('.fyx-stage'),vp=document.querySelector('.fyx-viewport');
  function fit(){var s=Math.min(1,vp.clientWidth/${CANVAS_W});if(window.innerWidth<${CANVAS_W})s=vp.clientWidth/${CANVAS_W};stage.style.transform='scale('+s+')';vp.style.height=(stage.offsetHeight*s)+'px';}
  window.addEventListener('resize',fit);window.addEventListener('load',fit);fit();
  // Scroll reveal.
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('fyx-in');io.unobserve(e.target);}});},{threshold:.15});
    document.querySelectorAll('[data-reveal]').forEach(function(el){io.observe(el);});
  }else{document.querySelectorAll('[data-reveal]').forEach(function(el){el.classList.add('fyx-in');});}
})();
`;

const CART_JS = `
(function(){
  var KEY='fyx_cart_'+location.hostname+location.pathname.split('/')[1];
  function load(){try{return JSON.parse(localStorage.getItem(KEY))||[]}catch(e){return[]}}
  function save(c){localStorage.setItem(KEY,JSON.stringify(c));render();}
  var cart=load();
  var drawer=document.createElement('div');drawer.id='fyx-cart';
  drawer.innerHTML='<header><span>Your cart</span><span style="cursor:pointer" data-cart-close>✕</span></header><div class="items"></div><footer><div style="display:flex;justify-content:space-between;font-weight:700;margin-bottom:12px"><span>Subtotal</span><span data-cart-total>$0.00</span></div><button class="checkout">Checkout</button></footer>';
  document.body.appendChild(drawer);
  document.querySelectorAll('[data-cart-open]').forEach(function(b){b.hidden=false;});
  function money(n){return '$'+n.toFixed(2)}
  function render(){
    var box=drawer.querySelector('.items');box.innerHTML='';var total=0,count=0;
    if(!cart.length)box.innerHTML='<p style="opacity:.6;text-align:center;margin-top:30px">Your cart is empty.<br>Continue shopping ✨</p>';
    cart.forEach(function(it,i){
      total+=it.price*it.qty;count+=it.qty;
      var row=document.createElement('div');row.className='item';
      row.innerHTML='<span style="flex:1">'+it.name+'</span><span class="qty"><button data-a="-">−</button>'+it.qty+'<button data-a="+">+</button></span><b>'+money(it.price*it.qty)+'</b>';
      row.querySelectorAll('button').forEach(function(b){b.onclick=function(){it.qty+=b.dataset.a==='+'?1:-1;if(it.qty<1)cart.splice(i,1);save(cart);};});
      box.appendChild(row);
    });
    drawer.querySelector('[data-cart-total]').textContent=money(total);
    document.querySelectorAll('[data-cart-count]').forEach(function(el){el.textContent=count;});
  }
  document.addEventListener('click',function(e){
    var add=e.target.closest('[data-cart-add]');
    if(add){
      var name=add.dataset.name||'Item',price=parseFloat(add.dataset.price)||0;
      var hit=cart.find(function(i){return i.name===name});
      if(hit)hit.qty++;else cart.push({name:name,price:price,qty:1});
      save(cart);var t=add.textContent;add.textContent='Added ✓';setTimeout(function(){add.textContent=t;},900);
      drawer.classList.add('open');
    }
    if(e.target.closest('[data-cart-open]'))drawer.classList.add('open');
    if(e.target.closest('[data-cart-close]'))drawer.classList.remove('open');
  });
  render();
})();
`;

/**
 * Render one page of a site to a complete HTML document.
 * @param site  CustomWebsite-shaped object (title, pages, settings, industry)
 * @param opts  { pageSlug, baseUrl }  baseUrl = canonical origin+path prefix
 */
export function renderSiteHTML(site, { pageSlug = "/", baseUrl = "" } = {}) {
  const pages = site.pages || [];
  const page =
    pages.find((p) => p.slug === pageSlug) ||
    pages.find((p) => p.id === site.activePage) ||
    pages[0];
  if (!page) return null;

  const ctx = { h1Used: false, hasCart: false, lastProductName: "", lastProductPrice: "" };
  const elementsHTML = (page.elements || [])
    .slice()
    .sort((a, b) => (a.y || 0) - (b.y || 0) || (a.x || 0) - (b.x || 0))
    .map((el) => renderElement(el, ctx))
    .join("\n");

  const stageH = Math.max(
    ...((page.elements || []).map((el) => (el.y || 0) + (typeof el.height === "number" ? el.height : 120))),
    600
  );

  const title = page.seoTitle || site.settings?.metaTitle || site.title || "Website";
  const desc = page.seoDesc || site.settings?.metaDesc || `${site.title} — built with FolioFYX.`;
  const url = `${baseUrl}${page.slug === "/" ? "" : page.slug}` || baseUrl;
  const ogImage = page.ogImage || site.thumbnail || "";
  const favicon = site.settings?.favicon || "";
  const ga = site.settings?.googleAnalyticsId || "";
  const hasCart = ctx.hasCart || site.industry === "ecommerce";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${escAttr(desc)}">
${url ? `<link rel="canonical" href="${escAttr(url)}">` : ""}
<meta property="og:type" content="website">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(desc)}">
${ogImage ? `<meta property="og:image" content="${escAttr(ogImage)}">` : ""}
${url ? `<meta property="og:url" content="${escAttr(url)}">` : ""}
<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">
<meta name="generator" content="FolioFYX">
${favicon ? `<link rel="icon" href="${escAttr(favicon)}">` : ""}
${fontsLink(site, page)}
${jsonLd(site, url)}
<style>${BASE_CSS}
body{font-family:'${escAttr(site.settings?.globalFont || "DM Sans")}',sans-serif}
.fyx-page{${pageBg(page)};min-height:100vh}
${site.settings?.customCSS ? `/* user CSS */\n${site.settings.customCSS}` : ""}
</style>
${ga ? `<script async src="https://www.googletagmanager.com/gtag/js?id=${escAttr(ga)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)};gtag('js',new Date());gtag('config','${escAttr(ga)}');</script>` : ""}
</head>
<body>
<main class="fyx-page">
  <div class="fyx-viewport">
    <div class="fyx-stage" style="height:${stageH}px">
${elementsHTML}
    </div>
  </div>
</main>
<script>${RUNTIME_JS}</script>
${hasCart ? `<script>${CART_JS}</script>` : ""}
</body>
</html>`;
}
