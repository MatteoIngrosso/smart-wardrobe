// Adding a piece from its label: the helpers that don't need the network.
// The app reads the label photo (QR code on the device, the printed text with the AI), finds
// the shop's product page and fills the piece in from it. This file knows how shops write
// their product references and pages, so it can be tested on its own.

/* ---------- Product references ---------- */

// Inditex labels (Pull&Bear, Zara, Bershka…) print the reference as model/quality/colour,
// e.g. "REF 3660/516/833" or "03660 516 833". Pull&Bear's product pages use the first two
// parts as "l03660516" and the colour as "?cS=833".
// H&M tags print no brand at all, only the article and its colour variant followed by size
// and other codes: "1101074 049 73 4 5828" is article 1101074, colour 049 (shop: "hm").
export function refFrom(text, brand = "") {
  const t = String(text || "");
  const hm = t.match(/(?<!\d)(\d{7})\s+(\d{3})(?!\d)/) || (isHM(brand) ? t.match(/(?<!\d)(\d{7})(\d{3})(?!\d)/) : null);
  if (hm) return { shop: "hm", model: hm[1], colour: hm[2], text: `${hm[1]} ${hm[2]}` };
  if (isHM(brand)) return null;
  const m = t.match(/(?<!\d)0?(\d{4})\s*[/.\s-]\s*(\d{3})(?:\s*[/.\s-]\s*(\d{3}))?(?!\d)/) || t.match(/(?<!\d)0?(\d{4})(\d{3})(\d{3})?(?!\d)/);
  if (!m) return null;
  return { model: `0${m[1]}${m[2]}`, colour: m[3] || "", text: [m[1], m[2], m[3]].filter(Boolean).join("/") };
}
const refOf = (model, colour = "") => ({ model, colour, text: [model.slice(1, 5), model.slice(5), colour].filter(Boolean).join("/") });
// The reference inside a Pull&Bear link: a product page (…/baggy-jeans-l03660516?cS=833) or
// the QR code on the tag (pullandbear.com/qr/0766050843436: model, quality, colour, size).
export function refInUrl(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const hm = /(^|\.)hm\.com$/.test(u.hostname) && u.pathname.match(/productpage\.(\d{7})(\d{3})\.html$/);
  if (hm) return { shop: "hm", model: hm[1], colour: hm[2], text: `${hm[1]} ${hm[2]}` };
  const qr = u.pathname.match(/\/qr\/(0\d{12,13})\/?$/);
  if (qr) return refFromCode(qr[1]);
  const m = u.pathname.match(/-l(\d{8})(?:$|[/?#.])/);
  if (!m) return null;
  return refOf(m[1], (u.searchParams.get("cS") || "").match(/^\d{3}$/)?.[0] || "");
}
// Inditex codes and barcodes start with the reference too: 07660508434368 is model 7660,
// quality 508, colour 434, size 36 and a check digit.
export function refFromCode(code) {
  const m = String(code || "").trim().match(/^(0\d{7})(\d{3})\d{2,3}$/);
  return m ? refOf(m[1], m[2]) : null;
}
// A QR link that only stands for the tag (not a page worth opening), like Pull&Bear's /qr/ codes.
export const isTagLink = (url) => /pullandbear\.com\/qr\//i.test(String(url || ""));

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
// "Pull&Bear", "Pull and Bear", "PULL&BEAR" or a pullandbear.com link.
export const isPullBear = (s) => /pull(and)?bear/.test(norm(s));
// "H&M", "Hennes & Mauritz" or an hm.com link.
export const isHM = (s) => norm(s) === "hm" || /hennes|^(https?)?(www2?)?hmcom/.test(norm(s));
// The brand a reference gives away when the tag doesn't print one (H&M's article line).
export const brandOfRef = (ref) => (ref?.shop === "hm" ? "H&M" : "");
// The code a shop's photo names hold, for the server to pick the product's photos from a page:
// Inditex model and colour; none for H&M, whose photo names are random.
export const photoCode = (ref) => (ref?.model && ref.shop !== "hm" ? ref.model + ref.colour : "");
// How to search for a reference: H&M writes its article number as one, e.g. "1101074049".
export const refWords = (ref) => (!ref ? "" : ref.shop === "hm" ? `article number ${ref.model}${ref.colour}` : `reference ${ref.text}`);

// The product page a reference leads to, for shops whose links can be built from it.
// The words before "-l…" don't matter to the shop, so any name works.
export function shopUrl(brand, ref, region = "it") {
  if (!ref?.model) return "";
  if (ref.shop === "hm") return ref.colour ? `https://www2.hm.com/${region === "it" ? "it_it" : "en_us"}/productpage.${ref.model}${ref.colour}.html` : "";
  if (isPullBear(brand)) {
    const country = region === "it" ? "it" : "us";
    return `https://www.pullandbear.com/${country}/p-l${ref.model}${ref.colour ? `?cS=${ref.colour}` : ""}`;
  }
  return "";
}
// Inditex photo names hold model and colour (…/03660516833-M.jpg). The page's main photo is
// in its first colour, so it may not be the colour on the label: true, false, or null (can't tell).
export function photoColourMatches(image, ref) {
  if (!ref?.colour || ref.shop === "hm") return null; // H&M's photo names are random
  const m = String(image || "").match(/\/(\d{8})(\d{3})[-_]/);
  if (!m || m[1] !== ref.model) return null;
  return m[2] === ref.colour;
}

// Whether a photo (or link) is of this reference: Inditex photo names hold model and colour,
// with or without the leading 0 (Pull&Bear …/07660508434-M.jpg, Zara …/7660508434_1_1_8.jpg);
// H&M's links hold article and colour (…/productpage.1101074049.html).
export function codeIn(url, ref) {
  if (!ref?.model || !ref.colour) return false;
  const code = ref.shop === "hm" ? ref.model + ref.colour : `0?${ref.model.slice(1)}${ref.colour}`;
  return new RegExp(`(?<!\\d)${code}(?!\\d)`).test(String(url || ""));
}

// "https://www.pullandbear.com/it/…" → "pullandbear.com", "https://www2.hm.com/…" → "hm.com"
export function siteOf(url) {
  try { return new URL(url).hostname.replace(/^www\d*\./, ""); } catch { return ""; }
}

/* ---------- Product page text ---------- */

// "Jeans baggy | Pull&Bear Italy" → "Jeans baggy"
export function cleanTitle(title, brand = "") {
  let t = String(title || "").replace(/\s+/g, " ").trim();
  t = t.split(/\s[|–—]\s|\s-\s(?=[^-]*$)/)[0].trim();
  if (brand) t = t.replace(new RegExp(`^${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[-:·]?\\s*`, "i"), "");
  return t.slice(0, 80);
}

// Shops in Italy write their pages in Italian. The app's own word lists are English, so the
// words that say the type, colour and fit are turned into English first.
const IT_WORDS = [
  [/felpa con cappuccio|felpa cappuccio/, "hoodie"], [/felpa con zip|felpa zip/, "zip hoodie"], [/felpa/, "sweatshirt"],
  [/sovracamicia/, "overshirt"], [/camicia|camicie/, "shirt"], [/maglietta|magliette/, "t-shirt"],
  [/canotta/, "tank"], [/maglione|maglioni|\bmaglia\b|\bpullover\b/, "sweater"],
  [/piumino|piumini/, "puffer"], [/cappotto|cappotti/, "coat"], [/impermeabile|giacca a vento/, "rain jacket"],
  [/giubbotto|giubbino|giacca|giacche/, "jacket"],
  [/pantaloncini|bermuda/, "shorts"], [/pantaloni della tuta|pantaloni tuta|\bjoggers?\b/, "joggers"], [/pantaloni|pantalone|\bchinos?\b/, "trousers"],
  [/gonna/, "skirt"], [/stivali|stivaletti|anfibi/, "boots"], [/scarpe da ginnastica|\bsneakers?\b/, "sneakers"], [/mocassini|scarpe/, "shoes"],
  [/berretto|cuffia/, "beanie"], [/cappellino/, "cap"], [/cappello/, "hat"], [/cintura|cinture/, "belt"], [/zaino/, "backpack"],
  [/borsa|marsupio/, "bag"], [/portafoglio/, "wallet"], [/sciarpa/, "scarf"], [/guanti/, "gloves"], [/calzini|calze/, "socks"],
  [/occhiali da sole/, "sunglasses"], [/collana|catenina/, "necklace"], [/bracciale/, "bracelet"], [/anello/, "ring"],
  [/\bnero|\bnera|\bneri|\bnere/, "black"], [/\bbianc[oaih]+/, "white"], [/grigio|grigia|grigi/, "grey"], [/azzurr[oaie]/, "light blue"],
  [/blu navy|blu scuro/, "navy"], [/\bblu\b/, "blue"], [/verde oliva/, "olive"], [/\bverd[ei]\b/, "green"], [/marrone|marroni|cioccolato/, "brown"],
  [/\bross[oaie]\b/, "red"], [/\brosa\b/, "pink"], [/\bgiall[oaie]\b/, "yellow"], [/arancione/, "orange"], [/\bviola\b/, "purple"],
  [/\bcrema\b|\bpanna\b/, "cream"], [/cammello/, "camel"], [/lavaggio chiaro|denim chiaro/, "light-wash"],
  [/\bampi[oae]?\b|\blargh[ie]\b|\blarg[oa]\b/, "baggy"], [/\bdritt[oaie]\b/, "straight"], [/aderent[ei]/, "skinny"],
  [/regolare|vestibilità regular/, "regular"], [/\bcort[oaie]\b|\bcrop\b|\bcropped\b/, "cropped"], [/a zampa|\bflared?\b/, "flared"],
];
export function toEnglish(text) {
  let t = ` ${String(text || "").toLowerCase()} `;
  for (const [re, en] of IT_WORDS) t = t.replace(new RegExp(re.source, "g"), ` ${en} `);
  return t.replace(/\s+/g, " ").trim();
}
// The fit a product name or description gives: "Baggy jeans" → "baggy".
export function fitIn(text) {
  const t = toEnglish(text);
  return [[/super baggy|baggy|balloon/, "baggy"], [/oversize/, "oversized"], [/wide/, "wide"], [/relaxed|loose/, "relaxed"],
    [/skinny/, "skinny"], [/slim/, "slim"], [/straight/, "straight"], [/flared|bootcut/, "flared"], [/cropped/, "cropped"], [/regular/, "regular"]]
    .find(([re]) => re.test(t))?.[1] || "";
}

/* ---------- QR codes ---------- */

// What a QR code holds: a web link ("www.…" counts too), or nothing useful.
export function linkIn(text) {
  const t = String(text || "").trim();
  const m = t.match(/https?:\/\/[^\s"<>]+/i) || t.match(/(?:^|\s)((?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\/[^\s"<>]*)/i);
  if (!m) return "";
  const raw = m[1] || m[0];
  try {
    const u = new URL(/^https?:/i.test(raw) ? raw : `https://${raw}`);
    return /^https?:$/.test(u.protocol) ? u.href : "";
  } catch { return ""; }
}
