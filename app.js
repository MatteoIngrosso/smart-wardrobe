// Smart Wardrobe — a touch-first, offline-first wardrobe app.
// Everything (items, photos, wear log, settings) lives in IndexedDB on the device.
// Token budget: background removal and daily outfit ideas run on the device and
// cost nothing; the AI (Gemini or Claude) is only called to recognise a new photo
// once, and when you ask the stylist something.
import { parseICS, eventsBetween, guessOccasion, titleKey } from "./calendar.js";
import * as Style from "./stylist.js";
import * as Label from "./label.js";
import { editCutout } from "./cutout-editor.js";
import * as TryOn from "./tryon.js";

/* ======================================================================
   Reference data
   ====================================================================== */
const CATS = [
  { id: "tshirt", label: "T-shirt", slot: "base", warmth: 1, styles: ["casual"] },
  { id: "shirt", label: "Shirt", slot: "base", warmth: 1, styles: ["smart casual"] },
  { id: "polo", label: "Polo", slot: "base", warmth: 1, styles: ["smart casual", "preppy"] },
  { id: "sweatshirt", label: "Sweatshirt", slot: "mid", warmth: 2, styles: ["casual"] },
  { id: "hoodie", label: "Hoodie", slot: "mid", warmth: 3, styles: ["casual"] },
  { id: "zip-hoodie", label: "Zip hoodie", slot: "mid", warmth: 3, styles: ["casual"] },
  { id: "sweater", label: "Sweater", slot: "mid", warmth: 3, styles: ["smart casual"] },
  { id: "overshirt", label: "Overshirt", slot: "mid", warmth: 2, styles: ["smart casual"] },
  { id: "jacket", label: "Jacket", slot: "outer", warmth: 3, styles: ["smart casual"] },
  { id: "rain", label: "Rain jacket", slot: "outer", warmth: 2, styles: ["outdoor"] },
  { id: "coat", label: "Coat", slot: "outer", warmth: 4, styles: ["smart"] },
  { id: "puffer", label: "Puffer", slot: "outer", warmth: 5, styles: ["casual", "outdoor"] },
  { id: "jeans", label: "Jeans", slot: "bottom", warmth: 2, styles: ["casual"] },
  { id: "trousers", label: "Trousers", slot: "bottom", warmth: 2, styles: ["smart casual"] },
  { id: "joggers", label: "Joggers", slot: "bottom", warmth: 2, styles: ["sporty"] },
  { id: "shorts", label: "Shorts", slot: "bottom", warmth: 1, styles: ["casual"] },
  { id: "skirt", label: "Skirt", slot: "bottom", warmth: 1, styles: ["smart casual"] },
  { id: "sneakers", label: "Sneakers", slot: "shoes", warmth: 2, styles: ["casual"] },
  { id: "boots", label: "Boots", slot: "shoes", warmth: 4, styles: ["smart casual"] },
  { id: "dress-shoes", label: "Dress shoes", slot: "shoes", warmth: 2, styles: ["formal"] },
  { id: "cap", label: "Cap", slot: "head", warmth: 1, styles: ["casual", "streetwear"] },
  { id: "beanie", label: "Beanie", slot: "head", warmth: 3, styles: ["casual", "streetwear"] },
  { id: "beret", label: "Beret", slot: "head", warmth: 2, styles: ["smart casual", "vintage"] },
  { id: "bucket-hat", label: "Bucket hat", slot: "head", warmth: 1, styles: ["streetwear"] },
  { id: "hat", label: "Hat", slot: "head", warmth: 2, styles: ["smart"] },
  { id: "watch", label: "Watch", slot: "acc", warmth: 1, styles: [] },
  { id: "bracelet", label: "Bracelet", slot: "acc", warmth: 1, styles: [] },
  { id: "necklace", label: "Necklace", slot: "acc", warmth: 1, styles: [] },
  { id: "ring", label: "Ring", slot: "acc", warmth: 1, styles: [] },
  { id: "sunglasses", label: "Sunglasses", slot: "acc", warmth: 1, styles: [] },
  { id: "belt", label: "Belt", slot: "acc", warmth: 1, styles: ["smart casual"] },
  { id: "bag", label: "Bag", slot: "acc", warmth: 1, styles: [] },
  { id: "backpack", label: "Backpack", slot: "acc", warmth: 1, styles: ["casual"] },
  { id: "wallet", label: "Wallet", slot: "acc", warmth: 1, styles: [] },
  { id: "scarf", label: "Scarf", slot: "acc", warmth: 3, styles: ["smart casual"] },
  { id: "gloves", label: "Gloves", slot: "acc", warmth: 3, styles: [] },
  { id: "tie", label: "Tie", slot: "acc", warmth: 1, styles: ["smart", "formal"] },
  { id: "umbrella", label: "Umbrella", slot: "acc", warmth: 1, styles: [] },
  { id: "accessory", label: "Other accessory", slot: "acc", warmth: 1, styles: [] },
  // Gym: its own section. `role` says where each piece goes in a gym outfit.
  { id: "gym-top", label: "Gym T-shirt", slot: "gym", role: "base", warmth: 1, styles: ["sporty"] },
  { id: "tank-top", label: "Tank top", slot: "gym", role: "base", warmth: 1, styles: ["sporty"] },
  { id: "long-sleeve-top", label: "Long-sleeve top", slot: "gym", role: "base", warmth: 2, styles: ["sporty"] },
  { id: "sports-bra", label: "Sports bra", slot: "gym", role: "base", warmth: 1, styles: ["sporty"] },
  { id: "gym-hoodie", label: "Training hoodie", slot: "gym", role: "mid", warmth: 3, styles: ["sporty"] },
  { id: "track-jacket", label: "Track jacket", slot: "gym", role: "mid", warmth: 2, styles: ["sporty"] },
  { id: "gym-shorts", label: "Gym shorts", slot: "gym", role: "bottom", warmth: 1, styles: ["sporty"] },
  { id: "leggings", label: "Leggings", slot: "gym", role: "bottom", warmth: 2, styles: ["sporty"] },
  { id: "track-pants", label: "Track pants", slot: "gym", role: "bottom", warmth: 2, styles: ["sporty"] },
  { id: "training-shoes", label: "Training shoes", slot: "gym", role: "shoes", warmth: 2, styles: ["sporty"] },
  { id: "gym-bag", label: "Gym bag", slot: "gym", role: "acc", warmth: 1, styles: ["sporty"] },
  { id: "gym-gear", label: "Gym accessory", slot: "gym", role: "acc", warmth: 1, styles: ["sporty"] },
  { id: "underwear", label: "Underwear", slot: "under", warmth: 1, styles: [] },
  { id: "socks", label: "Socks", slot: "under", warmth: 1, styles: [] },
];
const CAT = Object.fromEntries(CATS.map((c) => [c.id, c]));
const SLOTS = {
  base: "T-shirts & shirts", mid: "Hoodies & knits", outer: "Outerwear",
  bottom: "Bottoms", shoes: "Shoes", head: "Headwear", acc: "Accessories", gym: "Gym", under: "Underwear & socks",
};
// How many pieces per slot make a comfortable rotation.
const SLOT_TARGET = { base: 6, mid: 4, outer: 2, bottom: 4, shoes: 3, head: 0, acc: 0, gym: 0, under: 0 };

// How a piece fits. `v` is its volume (-1 close to the body … 2 roomy), which outfit
// ideas use to balance the silhouette; `on` says which pieces can have it.
const FITS = {
  slim: { label: "Slim", v: -1, on: ["top", "bottom"] },
  regular: { label: "Regular", v: 0, on: ["top", "bottom"] },
  straight: { label: "Straight", v: 0, on: ["bottom"] },
  relaxed: { label: "Relaxed", v: 1, on: ["top", "bottom"] },
  oversized: { label: "Oversized", v: 2, on: ["top"] },
  baggy: { label: "Baggy", v: 2, on: ["bottom"] },
  wide: { label: "Wide leg", v: 2, on: ["bottom"] },
  cropped: { label: "Cropped", v: 0, on: ["top"] },
};
// Tops and bottoms have a fit; shoes, accessories and underwear don't.
const fitPart = (item) => ({ base: "top", mid: "top", outer: "top", bottom: "bottom" })[roleOf(item)];
const fitsFor = (item) => Object.keys(FITS).filter((f) => FITS[f].on.includes(fitPart(item)));
const fitVol = (item) => FITS[item?.fit]?.v;

const COLORS = {
  black: { hex: "#1c1c1c", neutral: true, tone: "dark" },
  charcoal: { hex: "#3d3d3d", neutral: true, tone: "dark" },
  grey: { hex: "#8b8b8b", neutral: true, tone: "mid" },
  white: { hex: "#f4f4f0", neutral: true, tone: "light" },
  cream: { hex: "#ebe2cc", neutral: true, tone: "light" },
  beige: { hex: "#cbb58e", neutral: true, tone: "light" },
  brown: { hex: "#5e4130", neutral: true, tone: "dark" },
  navy: { hex: "#1f2a44", neutral: true, tone: "dark" },
  denim: { hex: "#4d6a8c", neutral: true, tone: "mid" },
  olive: { hex: "#5f6237", neutral: true, tone: "mid" },
  burgundy: { hex: "#6a1d2b", neutral: false, tone: "dark" },
  red: { hex: "#c0302b", neutral: false, tone: "mid" },
  orange: { hex: "#e07a2e", neutral: false, tone: "mid" },
  yellow: { hex: "#e8c547", neutral: false, tone: "light" },
  green: { hex: "#3f7a47", neutral: false, tone: "mid" },
  blue: { hex: "#3466b3", neutral: false, tone: "mid" },
  "light blue": { hex: "#a3c6e6", neutral: false, tone: "light" },
  purple: { hex: "#6b4a8c", neutral: false, tone: "mid" },
  pink: { hex: "#e8a3b3", neutral: false, tone: "light" },
};

// Style vocabulary. `f` is how dressy the style is (1 casual … 4 formal).
const STYLES = {
  casual: { label: "Casual", f: 1 },
  streetwear: { label: "Streetwear", f: 1 },
  sporty: { label: "Sporty", f: 1 },
  outdoor: { label: "Outdoor", f: 1 },
  minimal: { label: "Minimal", f: 2 },
  vintage: { label: "Vintage", f: 2 },
  "smart casual": { label: "Smart casual", f: 2 },
  preppy: { label: "Preppy", f: 3 },
  smart: { label: "Smart", f: 3 },
  luxury: { label: "Luxury", f: 3 },
  formal: { label: "Formal", f: 4 },
};
const STYLE_CLASH = [["sporty", "formal"], ["outdoor", "formal"], ["streetwear", "formal"], ["sporty", "smart"]];

// Brand knowledge used to recognise style offline (name, tier, typical styles).
const BRAND_LIST = [
  ["Gucci", "luxury", "luxury"], ["Prada", "luxury", "luxury smart"], ["Louis Vuitton", "luxury", "luxury"], ["Balenciaga", "luxury", "luxury streetwear"],
  ["Dior", "luxury", "luxury smart"], ["Saint Laurent", "luxury", "luxury smart"], ["Burberry", "luxury", "luxury smart preppy"], ["Moncler", "luxury", "luxury outdoor"],
  ["Fendi", "luxury", "luxury"], ["Versace", "luxury", "luxury"], ["Givenchy", "luxury", "luxury streetwear"], ["Valentino", "luxury", "luxury smart"],
  ["Bottega Veneta", "luxury", "luxury minimal"], ["Loewe", "luxury", "luxury"], ["Celine", "luxury", "luxury minimal"], ["Hermès", "luxury", "luxury smart"],
  ["Giorgio Armani", "luxury", "luxury smart"], ["Dolce & Gabbana", "luxury", "luxury"], ["Off-White", "luxury", "luxury streetwear"], ["Fear of God", "luxury", "luxury streetwear minimal"],
  ["Amiri", "luxury", "luxury streetwear"], ["Palm Angels", "luxury", "luxury streetwear"], ["Rick Owens", "luxury", "luxury"], ["Brunello Cucinelli", "luxury", "luxury smart"],
  ["Loro Piana", "luxury", "luxury smart minimal"], ["Zegna", "luxury", "luxury smart"], ["Max Mara", "luxury", "luxury smart"], ["Canada Goose", "luxury", "outdoor luxury"],
  ["Stone Island", "premium", "streetwear sporty"], ["CP Company", "premium", "streetwear sporty"], ["Acne Studios", "premium", "minimal"], ["Ami Paris", "premium", "smart casual minimal"],
  ["Maison Kitsuné", "premium", "smart casual preppy"], ["Kenzo", "premium", "streetwear"], ["Represent", "premium", "streetwear"],
  ["Ralph Lauren", "premium", "preppy smart casual"], ["Polo Ralph Lauren", "premium", "preppy smart casual"], ["Tommy Hilfiger", "premium", "preppy casual"], ["Tommy Jeans", "premium", "casual streetwear"],
  ["Lacoste", "premium", "preppy smart casual"], ["Hugo Boss", "premium", "smart"], ["Boss", "premium", "smart"], ["Armani Exchange", "premium", "smart casual sporty"],
  ["Emporio Armani", "premium", "smart casual"], ["Calvin Klein", "premium", "minimal casual"], ["Stüssy", "premium", "streetwear"], ["Carhartt WIP", "premium", "streetwear casual"],
  ["The North Face", "premium", "outdoor casual"], ["Patagonia", "premium", "outdoor casual"], ["Arc'teryx", "premium", "outdoor minimal"], ["Supreme", "premium", "streetwear"],
  ["Palace", "premium", "streetwear"], ["Kith", "premium", "streetwear minimal"], ["Napapijri", "premium", "outdoor casual"], ["Woolrich", "premium", "outdoor smart casual"],
  ["Fred Perry", "premium", "preppy casual"], ["Barbour", "premium", "smart casual outdoor"], ["Diesel", "premium", "casual"], ["Gant", "premium", "preppy smart casual"],
  ["Levi's", "mainstream", "casual vintage"], ["Guess", "mainstream", "casual"], ["Champion", "mainstream", "casual vintage sporty"], ["Columbia", "mainstream", "outdoor"],
  ["Massimo Dutti", "mainstream", "smart casual smart"], ["COS", "mainstream", "minimal"], ["Arket", "mainstream", "minimal"],
  ["Nike", "mainstream", "sporty streetwear"], ["Adidas", "mainstream", "sporty streetwear"], ["Puma", "mainstream", "sporty"], ["Reebok", "mainstream", "sporty casual"],
  ["New Balance", "mainstream", "sporty casual"], ["Jordan", "mainstream", "streetwear sporty"], ["Vans", "mainstream", "streetwear casual"], ["Converse", "mainstream", "casual"],
  ["Formula 1", "mainstream", "sporty"], ["Superdry", "mainstream", "casual"], ["Abercrombie & Fitch", "mainstream", "casual preppy"],
  ["Zara", "high street", "casual smart casual"], ["H&M", "high street", "casual"], ["Uniqlo", "high street", "minimal casual"], ["Pull&Bear", "high street", "casual streetwear"],
  ["Bershka", "high street", "casual streetwear"], ["Mango", "high street", "smart casual"], ["Jack & Jones", "high street", "casual"], ["Primark", "high street", "casual"],
  ["Gap", "high street", "casual"], ["Hollister", "high street", "casual"],
];
const normBrand = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9&]/g, "");
const brandKey = (s) => normBrand(s).replace(/^the(?=.{3})/, "");
// Brands that may be one spelt two ways: one letter apart on a short name (H&M, Hi&M), or one name
// inside the other (Armani, Armani Exchange). Report > Brands asks; Merge renames the pieces.
function brandTwins(names) {
  const lev = (a, b) => { const d = Array.from({ length: b.length + 1 }, (_, j) => j); for (let i = 1; i <= a.length; i++) { let p = d[0]; d[0] = i; for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, p + (a[i - 1] === b[j - 1] ? 0 : 1)); p = t; } } return d[b.length]; };
  const out = [];
  for (let x = 0; x < names.length; x++) for (let y = x + 1; y < names.length; y++) {
    const a = brandKey(names[x]), b = brandKey(names[y]);
    if ((Math.max(a.length, b.length) <= 6 && lev(a, b) === 1) || (Math.min(a.length, b.length) >= 4 && (a.startsWith(b) || b.startsWith(a)))) out.push([names[x], names[y]]);
  }
  return out.filter(([a, b]) => !(state.settings.brandsApart || []).includes(`${brandKey(a)}|${brandKey(b)}`));
}
// "preppy smart casual" → ["preppy", "smart casual"]: longest style names are matched first.
function parseStyles(str) {
  let rest = ` ${str} `;
  const found = [];
  for (const s of Object.keys(STYLES).sort((a, b) => b.length - a.length)) {
    const at = rest.indexOf(` ${s} `);
    if (at === -1) continue;
    found.push([at, s]);
    rest = rest.slice(0, at) + " " + "_".repeat(s.length) + rest.slice(at + s.length + 1);
  }
  return found.sort((a, b) => a[0] - b[0]).map(([, s]) => s);
}
const BRANDS = Object.fromEntries(BRAND_LIST.map(([name, tier, styles]) => [normBrand(name), { name, tier, styles: parseStyles(styles) }]));
// Brands not in the list above are looked up online (see "Brand lookup") and kept here.
const brandCache = {};
const brandInfo = (b) => { const k = normBrand(b); return BRANDS[k] || (brandCache[k]?.name ? brandCache[k] : undefined); };
const TIER_LABEL = { luxury: "Luxury brand", premium: "Premium brand", mainstream: "Mainstream brand", "high street": "High-street brand" };

const OCCASIONS = [
  { id: "casual", label: "Everyday", target: 1.3, likes: ["casual", "streetwear", "sporty", "outdoor", "minimal", "vintage"] },
  { id: "smart", label: "Smart casual", target: 2.3, likes: ["smart casual", "minimal", "preppy", "smart"] },
  { id: "work", label: "Work / meeting", target: 2.9, likes: ["smart", "smart casual", "preppy", "formal", "minimal"] },
  { id: "night", label: "Night out", target: 2.1, likes: ["streetwear", "casual", "luxury", "smart casual", "minimal", "smart"] },
  { id: "event", label: "Elegant", target: 3.4, likes: ["formal", "smart", "luxury"] },
  { id: "gym", label: "Gym", target: 1, likes: ["sporty", "outdoor", "casual"] },
];
// Gym outfits use gym pieces; until there are some for a role, everyday sporty ones stand in.
// A jacket over the top only comes from the everyday outerwear (cold or rainy days).
const GYM_FALLBACK = { base: ["tshirt"], mid: ["hoodie", "zip-hoodie", "sweatshirt"], outer: ["rain", "puffer", "jacket"], bottom: ["shorts", "joggers"], shoes: ["sneakers"] };
const SEED_VERSION = 3;

/* ======================================================================
   Storage (IndexedDB)
   ====================================================================== */
const db = await new Promise((resolve, reject) => {
  const req = indexedDB.open("smart-wardrobe", 4);
  req.onupgradeneeded = () => {
    const d = req.result;
    // Version 2 adds "wants": Must-Buy, and suggestions you said no to. Version 3: "events". Version 4: "scents".
    for (const [name, opts] of [["items", { keyPath: "id" }], ["log", { keyPath: "id", autoIncrement: true }], ["kv"], ["wants", { keyPath: "id" }], ["events", { keyPath: "id" }], ["scents", { keyPath: "id" }]]) {
      if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, opts);
    }
  };
  // An older copy of the app open in another tab holds the old version until it's closed.
  req.onblocked = () => document.body.insertAdjacentHTML("afterbegin", `<p class="muted" style="position:fixed;inset:16px auto auto 16px;z-index:9">Updating. Close Smart Wardrobe in your other tabs or windows to finish.</p>`);
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
// A newer copy of the app opened elsewhere needs the database: step aside and reload as that version.
db.onversionchange = () => { db.close(); location.reload(); };
function tx(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r && "result" in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
  });
}
const raw = {
  all: (s) => tx(s, "readonly", (o) => o.getAll()),
  put: (s, v, k) => tx(s, "readwrite", (o) => o.put(v, k)),
  del: (s, k) => tx(s, "readwrite", (o) => o.delete(k)),
  get: (s, k) => tx(s, "readonly", (o) => o.get(k)),
  clear: (s) => tx(s, "readwrite", (o) => o.clear()),
};
// Same as `raw`, but changes to shared records (pieces, fragrances, wear log, Must-Buy, events) are
// also queued for the other devices (see Sync below).
const store = {
  all: raw.all,
  get: raw.get,
  async put(s, v, k) {
    if (s === "log" && v.id == null) v.id = uid();
    const r = await raw.put(s, v, k);
    await syncTouch(syncKey(s, k ?? v.id));
    return r;
  },
  async del(s, k) {
    if (s === "items") await syncTomb(await raw.get(s, k));
    await raw.del(s, k);
    await syncTouch(syncKey(s, k));
  },
  async clear(s) {
    const gone = await raw.all(s);
    await raw.clear(s);
    for (const v of gone) {
      if (s === "items") await syncTomb(v);
      await syncTouch(syncKey(s, v.id));
    }
  },
};

const state = {
  items: [],
  log: [],
  settings: {
    city: "", lat: null, lon: null, unit: "C", theme: "auto",
    region: (navigator.language || "en").slice(0, 2) === "it" ? "it" : "com",
    gender: "men", // who the shopping ideas are for: "men" or "women"
    age: null, // the wearer's age: outfit ideas and the AI follow what's in fashion now at that age (see AGE_BANDS)
    touches: true, // a "Finish it with…" line on Today when an accessory you don't own would help
    scents: true, // a scent from your cabinet on each outfit idea (Wardrobe > Fragrances)
    aiProvider: "gemini", geminiKey: "", geminiModel: "gemini-flash-latest", apiKey: "",
    autoCutout: true, aiAuto: true, autoWash: true,
    washAfter: { hoodies: 3, knits: 4, trousers: 4, jeans: 6 }, // wears before these go in the wash (Settings > Laundry; 0 = never)
    washBack: 0, // days after which clothes come back from the wash by themselves (0: the app asks)
    tryon: true, // Today's mirror draws all four sides of the three ideas in the background (Settings > Try-on)
    tryonCap: 40, // try-on pictures a day on this device, at most
  },
  usage: { month: "", requests: 0, input: 0, output: 0 },
  wishlist: [], // before Must-Buy: moved into `wants` once (see moveWishlist)
  audit: null, // shared: the last full audit { at, items, summary, ideas }
  events: [], // shared: events you're dressing for (see Events)
  scents: [], // shared: the fragrance cabinet (see Wardrobe > Fragrances)
  wardSide: "clothes", // Wardrobe shows "clothes" or "scents"
  scentFilter: "all",
  scentUI: {}, // per outfit or event ("t:<outfit key>", "e:<event id>"): {open, pick} (pick "" = no scent)
  better: {}, // "even better" fragrances by kind of outfit: {picks} | "busy" | {error}
  wants: [], // shared: every suggestion you answered: Must-Buy (yes), no, bought (see Must-Buy)
  whyNo: null, // the suggestion whose "Why not?" is open
  buying: null, // the Must-Buy piece you tapped "Bought it" on: the next piece you add starts as it
  filters: { q: "", slot: "all", cat: "all", color: "all", style: "all", sort: "recent" },
  occasion: "casual",
  manualTemp: null,
  level: null, // an elegance level (1-5) picked by hand for today's ideas; null: the occasion's
  levelGap: null, // when no idea reaches the level wanted: { want, top, needs } (see levelGap)
  previewAI: false, // true inside the Claude preview, where AI goes through the viewer's Claude account
  serverKeys: {}, // {gemini, claude}: keys saved on the hosted server (Cloudflare), so this device needs none
  weather: null,
  outfits: [],
  anchor: null, // id of a piece you picked to build today's ideas around
  calendar: { links: [], occ: {} }, // shared: private iCal links, and the occasion you set for an event name
  cal: { at: 0, from: 0, events: [], errors: {}, names: {}, loading: false }, // today's and tomorrow's events (this device)
  event: null, // the calendar event the ideas dress for
  occChosen: "", // the day you picked an occasion yourself, so the calendar leaves it alone
  editingEvent: null, // key of the event whose occasion is being changed
  plan: null, // shared: an outfit planned the evening before {date, itemIds, occasion, title}
  aiAnswer: "",
  // Discover: the open tab, which version of each idea is picked, real photos found,
  // "Try a piece", "New look" and the shop trip being planned.
  disc: {
    tab: "foryou", pick: {}, photos: {}, tripq: "", tripBusy: "",
    try: { cat: "", color: "", fit: "", style: "", brand: "", text: "", occ: "", shown: null, answer: "", busy: false },
    look: { season: "", style: "", occ: "casual", result: null, busy: false, seen: [] },
    ev: null, evForm: { text: "", date: "", time: "", place: "" }, evPick: {}, evBusy: "", evOcc: false,
  },
  trip: null, // the mall or shop you're going to: { key, name, stores: [{ name, domain, sells, price }] }
  trips: [], // places looked up before (kept on this device, so each costs one AI request)
};

async function loadAll() {
  state.items = (await store.all("items")) || [];
  state.log = (await store.all("log")) || [];
  state.wants = (await store.all("wants")) || [];
  // Titles saved before mkIdea stopped doubling colours ("Black black leather loafers").
  for (const w of state.wants) if (w.kind !== "fragrance" && w.title) {
    if (w.color && w.noun && w.title.toLowerCase() === `${w.color} ${w.noun}`.toLowerCase()) w.title = mkIdea({ cat: w.cat, color: w.color, noun: w.noun }).title;
    w.title = cap(dedupeWords(w.title));
  }
  state.events = (await store.all("events")) || [];
  state.scents = (await store.all("scents")) || [];
  Object.assign(state.settings, (await store.get("kv", "settings")) || {});
  for (const [k, empty] of Object.entries(SHARED_KV)) state[k] = (await store.get("kv", k)) ?? empty();
  state.cal = { ...state.cal, ...((await raw.get("kv", "calEvents")) || {}), loading: false };
  state.usage = (await store.get("kv", "usage")) || state.usage;
  state.trips = (await store.get("kv", "trips")) || [];
  state.trip = (await store.get("kv", "trip")) || null;
  Object.assign(brandCache, (await raw.get("kv", "brandCache")) || {});
  Object.assign(sync, (await raw.get("kv", SYNC_STATE)) || {});
  sync.dirty = new Set(sync.dirty);
  for (const it of state.items) {
    if (!it.styles) { it.styles = guessStyles(it); it.formality = formalityOf(it.styles); }
    if (!it.fit) it.fit = guessFit(it);
  }
}
const saveSettings = () => store.put("kv", state.settings, "settings");
const saveWishlist = () => store.put("kv", state.wishlist, "wishlist");
const saveCalendar = () => store.put("kv", state.calendar, "calendar");
const savePlan = () => store.put("kv", state.plan, "plan");
const saveAudit = () => store.put("kv", state.audit, "audit");

/* ======================================================================
   Sync: one shared wardrobe for every device (server.py)
   Each device keeps its full copy in IndexedDB, so it works offline. When the
   app is opened through server.py, changes go to the computer running it and
   come back to the other devices through a long-poll, within a second or two.
   - pieces, fragrances, the wear log, Must-Buy, events, calendar links and a planned outfit are shared;
     settings and keys are not
   - the newest change to a record wins
   - photos are uploaded once, keyed by a hash of their bytes
   With no server (plain http.server, a static host, the Claude preview) the app
   works exactly as before, on this device only.
   ====================================================================== */
const sync = {
  status: "connecting", // connecting | on | offline (retrying) | off (no sync server)
  joined: false, // this device has merged its data with the server once
  rev: 0, // last server revision applied here
  meta: {}, // "items/<id>" → updatedAt of the copy on this device
  dirty: new Set(), // keys changed here and not sent yet
  tombs: {}, // deleted sample pieces → their seedKey, so other devices don't re-add them
  lastAt: null,
  poll: null,
  pendingRender: false,
};
const SYNC_STATE = "sync";
// Shared values kept under "kv", and what each is when there's nothing yet.
const SHARED_KV = { wishlist: () => [], calendar: () => ({ links: [], occ: {} }), plan: () => null, audit: () => null, avatar: () => null };
function syncKey(s, k) {
  if (["items", "log", "wants", "events", "scents"].includes(s)) return `${s}/${k}`;
  return s === "kv" && Object.hasOwn(SHARED_KV, k) ? `kv/${k}` : null;
}
const splitKey = (key) => { const i = key.indexOf("/"); return [key.slice(0, i), key.slice(i + 1)]; };
const saveSyncState = () => raw.put("kv", { joined: sync.joined, rev: sync.rev, meta: sync.meta, dirty: [...sync.dirty], tombs: sync.tombs }, SYNC_STATE);

async function syncTouch(key, push = true) {
  if (!key) return;
  // Always newer than the copy we have, even if this device's clock is behind.
  const prev = Date.parse(sync.meta[key] || 0) || 0;
  sync.meta[key] = new Date(Math.max(Date.now(), prev + 1)).toISOString();
  sync.dirty.add(key);
  await saveSyncState();
  if (push) schedulePush();
}
async function syncTomb(item) {
  if (item?.seedKey) sync.tombs[`items/${item.id}`] = item.seedKey;
}

async function api(path, opts = {}) {
  const r = await fetch(`api/${path}`, { cache: "no-store", ...opts });
  if (!r.ok) throw Object.assign(new Error(`Sync server answered ${r.status}`), { status: r.status });
  return r.json();
}

// Photos travel as {$blob: key}. The key is a 64-bit hash of the bytes plus the size,
// so the same photo is uploaded once however many devices or edits it goes through.
const blobKeys = new WeakMap();
const blobCache = new Map();
const uploaded = new Set();
function hashBytes(bytes) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < bytes.length; i++) {
    h1 = Math.imul(h1 ^ bytes[i], 2654435761);
    h2 = Math.imul(h2 ^ bytes[i], 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}
async function blobKey(blob) {
  if (!blobKeys.has(blob)) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const sig = String.fromCharCode(...bytes.subarray(0, 12));
    // Some photos are stored without a type, so look at the file's first bytes.
    const ext = { "image/webp": "webp", "image/png": "png", "image/jpeg": "jpg" }[blob.type] ||
      (sig.startsWith("RIFF") && sig.endsWith("WEBP") ? "webp" : sig.startsWith("\x89PNG") ? "png" : sig.startsWith("\xff\xd8") ? "jpg" : "bin");
    blobKeys.set(blob, `${hashBytes(bytes)}-${blob.size.toString(36)}.${ext}`);
  }
  return blobKeys.get(blob);
}
async function walkBlobs(v, fn) {
  if (v instanceof Blob || v?.$blob) return fn(v);
  if (Array.isArray(v)) { const out = []; for (const x of v) out.push(await walkBlobs(x, fn)); return out; }
  if (v && typeof v === "object" && v.constructor === Object) {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = await walkBlobs(x, fn);
    return out;
  }
  return v;
}
// Replace the photos in `values` with {$blob} refs, uploading the ones the server lacks.
async function packBlobs(values) {
  const fresh = new Map();
  await walkBlobs(values, async (b) => {
    if (b instanceof Blob) { const key = await blobKey(b); if (!uploaded.has(key)) fresh.set(key, b); }
  });
  if (fresh.size) {
    const { missing } = await api("missing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ keys: [...fresh.keys()] }) });
    for (const key of missing) {
      const b = fresh.get(key);
      const r = await fetch(`api/blob/${key}`, { method: "PUT", body: b, headers: { "Content-Type": b.type || "application/octet-stream" } });
      if (!r.ok) throw new Error(`Photo upload failed (${r.status})`);
    }
    for (const key of fresh.keys()) uploaded.add(key);
  }
  return walkBlobs(values, async (b) => (b instanceof Blob ? { $blob: await blobKey(b) } : b));
}
const unpackBlobs = (v) => walkBlobs(v, async (ref) => {
  if (!ref?.$blob) return ref;
  if (!blobCache.has(ref.$blob)) {
    const r = await fetch(`api/blob/${ref.$blob}`);
    if (!r.ok) throw new Error(`Photo download failed (${r.status})`);
    const b = await r.blob();
    blobKeys.set(b, ref.$blob);
    uploaded.add(ref.$blob);
    blobCache.set(ref.$blob, b);
  }
  return blobCache.get(ref.$blob);
});

let pushTimer, pushing = false;
function schedulePush(ms = 300) {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, ms);
}
async function pushNow() {
  if (sync.status !== "on" || pushing || !sync.dirty.size) return;
  pushing = true;
  let again = 0;
  try {
    const records = [];
    for (const key of [...sync.dirty].slice(0, 20)) {
      const [col, id] = splitKey(key);
      const v = await raw.get(col, id);
      const updatedAt = sync.meta[key];
      records.push(v === undefined
        ? { col, id, updatedAt, deleted: true, data: sync.tombs[key] ? { seedKey: sync.tombs[key] } : null }
        : { col, id, updatedAt, data: v });
    }
    const packed = await packBlobs(records.map((r) => r.data));
    records.forEach((r, k) => (r.data = packed[k]));
    const res = await api("records", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ records }) });
    // Photos the server lost (its data folder was reset): upload them again next round.
    const missing = res.missing || [];
    for (const k of missing) uploaded.delete(k);
    const retry = new Set(records.filter((r) => missing.some((k) => JSON.stringify(r.data).includes(k))).map((r) => `${r.col}/${r.id}`));
    // Sent. If the server already had something newer, it comes back with the next pull.
    for (const r of records) {
      const key = `${r.col}/${r.id}`;
      if (sync.meta[key] === r.updatedAt && !retry.has(key)) { sync.dirty.delete(key); delete sync.tombs[key]; }
    }
    await saveSyncState();
    sync.lastAt = new Date();
    again = sync.dirty.size ? 0 : -1;
  } catch {
    again = 5000;
  } finally {
    pushing = false;
    if (again >= 0) schedulePush(again);
  }
}

// Apply records from the server to this device. Returns true if anything changed.
async function applyRecords(records) {
  let changed = false, newSet = false;
  for (const rec of records) {
    const key = `${rec.col}/${rec.id}`;
    if ((sync.meta[key] || "") >= rec.updatedAt) continue; // our own change, or older
    if (rec.col === "items") {
      const at = state.items.findIndex((i) => i.id === rec.id);
      if (rec.deleted) {
        await raw.del("items", rec.id);
        if (at >= 0) { state.items.splice(at, 1); newSet = true; }
      } else {
        const it = await unpackBlobs(rec.data);
        await raw.put("items", it);
        if (at >= 0) state.items[at] = it; else { state.items.push(it); newSet = true; }
      }
    } else if (rec.col === "scents") {
      const at = state.scents.findIndex((x) => x.id === rec.id);
      if (rec.deleted) { await raw.del("scents", rec.id); if (at >= 0) state.scents.splice(at, 1); }
      else {
        const sc = await unpackBlobs(rec.data);
        await raw.put("scents", sc);
        if (at >= 0) state.scents[at] = sc; else state.scents.push(sc);
      }
    } else if (rec.col === "log" || rec.col === "wants" || rec.col === "events") {
      const list = state[rec.col];
      const at = list.findIndex((l) => l.id === rec.id);
      if (rec.deleted) { await raw.del(rec.col, rec.id); if (at >= 0) list.splice(at, 1); }
      else { await raw.put(rec.col, rec.data); if (at >= 0) list[at] = rec.data; else list.push(rec.data); }
      if (rec.col === "events" && (rec.data?.date || list[at]?.date) === localDay()) state.outfits = []; // a plan for today
    } else if (rec.col === "kv" && Object.hasOwn(SHARED_KV, rec.id)) {
      state[rec.id] = (rec.deleted ? null : rec.data) ?? SHARED_KV[rec.id]();
      await raw.put("kv", state[rec.id], rec.id);
      if (rec.id === "calendar") state.cal.at = 0; // read the calendars again
      if (rec.id === "plan") state.outfits = [];
      if (rec.id === "audit") state.disc.feedMemo = null;
      if (rec.id === "avatar") mirror.draft = null; // a body saved on another device
    } else continue;
    sync.meta[key] = rec.updatedAt;
    sync.dirty.delete(key);
    changed = true;
  }
  if (newSet) state.outfits = [];
  return changed;
}

// The first time a device meets the server: keep the server's copy of anything both
// have, send what only this device has, and drop sample pieces another device
// already shared (every device loads its own copy of the samples).
async function joinServer() {
  uploaded.clear();
  for (const l of state.log) {
    if (typeof l.id !== "number") continue; // older versions numbered log entries per device
    await raw.del("log", l.id);
    l.id = uid();
    await raw.put("log", l);
  }
  const { rev, records } = await api("changes?since=0");
  const onServer = new Map(records.map((r) => [`${r.col}/${r.id}`, r]));
  const seedOwner = new Map();
  for (const r of records) if (r.col === "items" && r.data?.seedKey) seedOwner.set(r.data.seedKey, r.deleted ? null : r.id);
  sync.meta = {};
  sync.dirty = new Set();
  for (const it of [...state.items]) {
    if (onServer.has(`items/${it.id}`)) continue;
    if (it.seedKey && seedOwner.has(it.seedKey)) {
      const to = seedOwner.get(it.seedKey);
      await raw.del("items", it.id);
      state.items = state.items.filter((i) => i !== it);
      for (const l of state.log) {
        if (!l.itemIds?.includes(it.id)) continue;
        l.itemIds = l.itemIds.map((i) => (i === it.id ? to : i)).filter(Boolean);
        await raw.put("log", l);
      }
      continue;
    }
    await syncTouch(`items/${it.id}`, false);
  }
  for (const l of state.log) if (!onServer.has(`log/${l.id}`)) await syncTouch(`log/${l.id}`, false);
  for (const w of state.wants) if (!onServer.has(`wants/${w.id}`)) await syncTouch(`wants/${w.id}`, false);
  for (const e of state.events) if (!onServer.has(`events/${e.id}`)) await syncTouch(`events/${e.id}`, false);
  for (const sc of state.scents) if (!onServer.has(`scents/${sc.id}`)) await syncTouch(`scents/${sc.id}`, false);
  const sw = onServer.get("kv/wishlist");
  const theirs = sw && !sw.deleted ? sw.data || [] : [];
  const mine = state.wishlist.filter((w) => !theirs.some((t) => t.title === w.title));
  if (mine.length) {
    state.wishlist = [...theirs, ...mine];
    await raw.put("kv", state.wishlist, "wishlist");
    if (sw) sync.meta["kv/wishlist"] = sw.updatedAt;
    await syncTouch("kv/wishlist", false);
  }
  // Calendar links added on this device before it joined go to the others too.
  const sc = onServer.get("kv/calendar");
  const cal = sc && !sc.deleted && sc.data ? sc.data : SHARED_KV.calendar();
  const newLinks = (state.calendar.links || []).filter((l) => !(cal.links || []).some((x) => x.url === l.url));
  if (newLinks.length) {
    state.calendar = { links: [...(cal.links || []), ...newLinks], occ: { ...state.calendar.occ, ...cal.occ } };
    await raw.put("kv", state.calendar, "calendar");
    if (sc) sync.meta["kv/calendar"] = sc.updatedAt;
    await syncTouch("kv/calendar", false);
  }
  await applyRecords(records);
  state.outfits = [];
  sync.rev = rev;
  sync.joined = true;
  await saveSyncState();
}

function syncChanged() {
  if (state.wishlist?.length) return void moveWishlist().then(syncChanged); // a wishlist from a device that hadn't updated yet
  // Refresh the screen, unless that would disturb someone typing or adding a piece.
  if (view === "add" || document.activeElement?.matches("input, textarea")) { sync.pendingRender = true; return; }
  sync.pendingRender = false;
  render();
}

let syncReady;
const syncFirst = new Promise((r) => (syncReady = r));
async function syncLoop() {
  let fails = 0;
  for (;;) {
    try {
      if (sync.status !== "on") {
        const ping = await fetch("api/ping", { cache: "no-store" });
        if (!ping.ok || !(ping.headers.get("Content-Type") || "").includes("json")) {
          sync.status = "off"; // no sync server here: this device only
          syncReady();
          if (view === "settings") syncChanged();
          return;
        }
        const { rev, sync: shared, keys } = await ping.json();
        state.serverKeys = keys || {};
        if (shared === false) { // hosted without a database: AI keys on the server, wardrobe on this device
          sync.status = "off";
          syncReady();
          return render();
        }
        if (!sync.joined || rev < sync.rev) await joinServer(); // first visit, or the server's data was reset
        sync.status = "on";
        fails = 0;
        syncReady();
        syncChanged();
        schedulePush(0);
      }
      sync.poll = new AbortController();
      const { rev, records } = await api(`changes?since=${sync.rev}&wait=25`, { signal: sync.poll.signal });
      const changed = await applyRecords(records);
      sync.rev = rev;
      sync.lastAt = new Date();
      await saveSyncState();
      if (changed) syncChanged();
    } catch (e) {
      if (e.name === "AbortError") continue;
      // Never connected: probably no sync server at all (keep trying quietly). Connected before: it's just unreachable.
      const status = sync.joined ? "offline" : "off";
      if (sync.status !== status) { sync.status = status; if (view === "settings") syncChanged(); }
      syncReady();
      await new Promise((r) => setTimeout(r, Math.min(30000, 1000 * 2 ** fails++)));
    }
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  sync.poll?.abort(); // check for changes right away instead of waiting for the long-poll
  schedulePush(0);
});
document.addEventListener("focusout", () => setTimeout(() => {
  if (sync.pendingRender && view !== "add" && !document.activeElement?.matches("input, textarea")) syncChanged();
}, 300));
function syncLine() {
  const n = state.items.length, o = state.log.filter((l) => logKind(l) === "wear").length;
  const pieces = `${n} piece${n === 1 ? "" : "s"} · ${o} outfit${o === 1 ? "" : "s"} logged`;
  if (sync.status === "on") return `${pieces}. Shared live with every device that opens the app from the same address${sync.dirty.size ? ` · sending ${sync.dirty.size} change${sync.dirty.size === 1 ? "" : "s"}…` : ""}.`;
  if (sync.status === "offline") return `${pieces}. Can't reach the sync server right now; changes are kept here and sent when it's back${sync.dirty.size ? ` (${sync.dirty.size} waiting)` : ""}.`;
  if (sync.status === "connecting") return `${pieces}. Connecting to the sync server…`;
  return `${pieces}. Stored on this device only. Start the app with <code>python3 server.py</code>, or put it online (see the README), to share one wardrobe between devices.`;
}

/* ======================================================================
   Helpers
   ====================================================================== */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const today = () => new Date().toISOString().slice(0, 10);
// The calendar day here (today() above is the UTC date, which the wear log has always used).
const localDay = (n = 0) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toLocaleDateString("sv"); };
const startOfDay = (n = 0) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime(); };
const fmtTime = (ms) => new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : Infinity);
const slotOf = (item) => CAT[item.category]?.slot || "acc";
// Where a piece goes in an outfit: its section, or for gym pieces their role (top, bottom, shoes…).
const roleOf = (item) => CAT[item.category]?.role || slotOf(item);
const catLabel = (id) => CAT[id]?.label || id;
const styleLabel = (s) => STYLES[s]?.label || s;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtTemp = (c) => (state.settings.unit === "F" ? `${Math.round(c * 9 / 5 + 32)}°F` : `${Math.round(c)}°`);
const formalityOf = (styles = []) => {
  const fs = styles.map((s) => STYLES[s]?.f).filter(Boolean);
  return fs.length ? Math.round((fs.reduce((a, b) => a + b, 0) / fs.length) * 10) / 10 : 1;
};

// Offline style recognition: brand knowledge first, then the type of garment and its tags.
function guessStyles({ brand, category, tags = [] }) {
  const out = new Set(brandInfo(brand)?.styles || []);
  if (!out.size) for (const s of CAT[category]?.styles || []) out.add(s);
  if (tags.some((t) => /graphic|statement|cargo|baggy/.test(t))) { out.add("streetwear"); out.delete("smart"); }
  if (tags.some((t) => /knit|wool|cashmere/.test(t)) && !out.has("streetwear")) out.add("smart casual");
  if (tags.some((t) => /plain|basic/.test(t))) out.add("minimal");
  return [...out].slice(0, 3);
}

// Fit from the tags ("oversized", "baggy"…) when nobody has set it.
function guessFit(item) {
  const tags = (item.tags || []).join(" ");
  const f = [[/oversize/, "oversized"], [/baggy|loose fit/, "baggy"], [/wide/, "wide"], [/relaxed|loose/, "relaxed"], [/skinny|slim/, "slim"], [/straight/, "straight"], [/cropped/, "cropped"], [/regular/, "regular"]]
    .find(([re]) => re.test(tags))?.[1];
  return f && fitsFor(item).includes(f) ? f : f === "baggy" && fitsFor(item).includes("oversized") ? "oversized" : undefined;
}

const urlCache = new WeakMap();
function photoURL(blob) {
  if (!blob) return "";
  if (typeof blob === "string") return blob;
  if (!urlCache.has(blob)) urlCache.set(blob, URL.createObjectURL(blob));
  return urlCache.get(blob);
}
const swatches = (colors = []) =>
  `<span class="swatches">${colors.map((c) => `<i style="background:${COLORS[c]?.hex || "#888"}" title="${esc(c)}"></i>`).join("")}</span>`;

let toastTimer, toastAction = null;
// `action`: an optional button in the toast, e.g. { label: "Undo", run() {…} }.
function toast(msg, action) {
  const t = $("#toast");
  t.innerHTML = esc(msg) + (action ? `<button class="toast-act" data-toast="1">${esc(action.label)}</button>` : "");
  toastAction = action?.run || null;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; toastAction = null; }, action ? 6000 : 2600);
}

function applyTheme() {
  const t = state.settings.theme;
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
}

/* ---------- images ---------- */
const newCanvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });
const canvasBlob = (c, type = "image/webp", q = 0.86) => new Promise((r) => c.toBlob(r, type, q));

async function resizeImage(file, max = 1100) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = newCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return canvasBlob(c, "image/jpeg", 0.82);
}

// Whether a photo already has a plain light background (shop photos usually do): the frame
// around its edge is near-white, grey or even, with no colours of a room or a bed.
async function plainBackground(blob) {
  try {
    const n = 48;
    const ctx = newCanvas(n, n).getContext("2d", { willReadFrequently: true });
    ctx.drawImage(await createImageBitmap(blob), 0, 0, n, n);
    const { data } = ctx.getImageData(0, 0, n, n);
    const lum = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      if (x > 2 && x < n - 3 && y > 2 && y < n - 3) continue; // only the outer edge
      const i = (y * n + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) > 24) return false;
      lum.push((r + g + b) / 3);
    }
    const mean = lum.reduce((a, v) => a + v, 0) / lum.length;
    return mean > 200 && Math.sqrt(lum.reduce((a, v) => a + (v - mean) ** 2, 0) / lum.length) < 12;
  } catch { return false; }
}
// Guess the garment colours. On a cut-out photo only the garment pixels count;
// on a normal photo we sample the centre.
async function detectColors(blob) {
  const bmp = await createImageBitmap(blob);
  const w = 60, h = 80;
  const ctx = newCanvas(w, h).getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  let { data } = ctx.getImageData(0, 0, w, h);
  let opaque = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 200) opaque++;
  const cutout = opaque < (w * h) * 0.9;
  if (!cutout) data = ctx.getImageData(Math.round(w * 0.3), Math.round(h * 0.28), Math.round(w * 0.4), Math.round(h * 0.44)).data;
  const palette = Object.entries(COLORS).map(([name, v]) => [name, hexToRgb(v.hex)]);
  const counts = {};
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (cutout && data[i + 3] < 200) continue;
    total++;
    const p = [data[i], data[i + 1], data[i + 2]];
    let best = null, bd = Infinity;
    for (const [name, rgb] of palette) {
      const d = colorDist(p, rgb);
      if (d < bd) { bd = d; best = name; }
    }
    counts[best] = (counts[best] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1]).filter(([, n], i) => i === 0 || n / total > 0.3).slice(0, 2).map(([n]) => n);
}
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; }
function colorDist(a, b) {
  const rm = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0], dg = a[1] - b[1], db = a[2] - b[2];
  return (2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db;
}
function blobToBase64(blob) {
  return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(",")[1]); fr.readAsDataURL(blob); });
}
function blobToDataURL(blob) {
  return new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });
}

/* ======================================================================
   Background removal (on the device, no tokens)
   1. AI model running in the browser (@imgly/background-removal). Needs
      internet the first time to download the model (~40 MB), then it's cached.
   2. Fallback: a fast colour-based cut-out that works anywhere. Good on a
      plain, contrasting surface (a bed sheet, the floor, a wall).
   ====================================================================== */
let imgly = null;
let imglyBroken = false;
async function aiCutout(blob) {
  if (imglyBroken) throw new Error("unavailable");
  try {
    imgly = imgly || (await import("https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm"));
    return await imgly.removeBackground(blob, { model: "isnet_fp16", output: { format: "image/png" } });
  } catch (e) {
    imglyBroken = true;
    throw e;
  }
}

async function basicCutout(blob) {
  const bmp = await createImageBitmap(blob);
  const S = 360 / Math.max(bmp.width, bmp.height);
  const w = Math.round(bmp.width * S), h = Math.round(bmp.height * S);
  const ctx = newCanvas(w, h).getContext("2d", { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, w, h);
  const px = ctx.getImageData(0, 0, w, h).data;
  const N = w * h;
  const rgb = (i) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];
  const isEdge = (x, y, bw) => x < bw || y < bw || x >= w - bw || y >= h - bw;

  // Model the background from the photo's border with a few colour clusters.
  const bw = Math.max(3, Math.round(Math.min(w, h) * 0.03));
  const border = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isEdge(x, y, bw) && (x + y) % 2 === 0) border.push(rgb(y * w + x));
  let centers = Array.from({ length: 5 }, (_, k) => border[Math.floor((k + 0.5) * border.length / 5)].slice());
  for (let it = 0; it < 8; it++) {
    const sum = centers.map(() => [0, 0, 0, 0]);
    for (const p of border) {
      let bi = 0, bd = Infinity;
      centers.forEach((c, k) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2; if (d < bd) { bd = d; bi = k; } });
      sum[bi][0] += p[0]; sum[bi][1] += p[1]; sum[bi][2] += p[2]; sum[bi][3]++;
    }
    centers = sum.map((s, k) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centers[k]));
  }
  const distBg = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const p = rgb(i);
    let bd = Infinity;
    for (const c of centers) bd = Math.min(bd, Math.sqrt((p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2));
    distBg[i] = bd;
  }
  const bdists = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (isEdge(x, y, bw)) bdists.push(distBg[y * w + x]);
  bdists.sort((a, b) => a - b);
  const T = Math.max(18, bdists[Math.floor(bdists.length * 0.9)] * 1.25);

  // Grow the background inwards from the border through background-like pixels.
  const bg = new Uint8Array(N);
  const q = new Int32Array(N);
  let qh = 0, qt = 0;
  const seed = (i) => { if (!bg[i] && distBg[i] < T * 1.6) { bg[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (qh < qt) {
    const i = q[qh++], x = i % w, y = (i / w) | 0;
    const a = rgb(i);
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0 || bg[j]) continue;
      const b = rgb(j);
      const step = Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
      if (distBg[j] < T || (step < 9 && distBg[j] < T * 1.8)) { bg[j] = 1; q[qt++] = j; }
    }
  }
  // Clean up: open (erode + dilate) the foreground, keep the biggest piece.
  let fg = new Uint8Array(N);
  for (let i = 0; i < N; i++) fg[i] = bg[i] ? 0 : 1;
  const morph = (src, erode) => {
    const out = new Uint8Array(N);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const n = src[i] + src[i - 1] + src[i + 1] + src[i - w] + src[i + w];
      out[i] = erode ? (n === 5 ? 1 : 0) : (n > 0 ? 1 : 0);
    }
    return out;
  };
  fg = morph(morph(fg, true), false);
  const lab = new Int32Array(N);
  let best = 0, bestSize = 0, label = 0;
  for (let s = 0; s < N; s++) {
    if (!fg[s] || lab[s]) continue;
    label++; let size = 0; qh = qt = 0; q[qt++] = s; lab[s] = label;
    while (qh < qt) {
      const i = q[qh++]; size++;
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j >= 0 && j < N && fg[j] && !lab[j]) { lab[j] = label; q[qt++] = j; }
      }
    }
    if (size > bestSize) { bestSize = size; best = label; }
  }
  const share = bestSize / N;
  if (share < 0.06 || share > 0.92) throw new Error("Couldn't find the garment");

  const mask = newCanvas(w, h);
  const mctx = mask.getContext("2d");
  const md = mctx.createImageData(w, h);
  for (let i = 0; i < N; i++) md.data[i * 4 + 3] = lab[i] === best ? 255 : 0;
  mctx.putImageData(md, 0, 0);

  const out = newCanvas(bmp.width, bmp.height);
  const octx = out.getContext("2d");
  octx.drawImage(bmp, 0, 0);
  octx.globalCompositeOperation = "destination-in";
  octx.filter = "blur(1.5px)";
  octx.imageSmoothingQuality = "high";
  octx.drawImage(mask, 0, 0, out.width, out.height);
  return canvasBlob(out, "image/png");
}

// Crop to the garment and centre it on a transparent 3:4 canvas.
const framePiece = async (src) => (await frameGeo(src)).blob;
// The same, plus where each pixel of `src` (a blob or canvas) lands in the result.
async function frameGeo(src) {
  const bmp = src instanceof Blob ? await createImageBitmap(src) : src;
  const s = 200 / Math.max(bmp.width, bmp.height);
  const sw = Math.max(1, Math.round(bmp.width * s)), sh = Math.max(1, Math.round(bmp.height * s));
  const sctx = newCanvas(sw, sh).getContext("2d", { willReadFrequently: true });
  sctx.drawImage(bmp, 0, 0, sw, sh);
  const a = sctx.getImageData(0, 0, sw, sh).data;
  let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (a[(y * sw + x) * 4 + 3] > 40) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return { blob: src instanceof Blob ? src : await canvasBlob(src, "image/png"), m: new DOMMatrix() };
  const bx = Math.max(0, (x0 - 1) / s), by = Math.max(0, (y0 - 1) / s);
  const bwid = Math.min(bmp.width - bx, (x1 - x0 + 3) / s), bhei = Math.min(bmp.height - by, (y1 - y0 + 3) / s);
  const m = Math.max(bwid, bhei) * 0.06;
  const W = Math.max(bwid + 2 * m, (bhei + 2 * m) * 0.75), H = W / 0.75;
  const scale = Math.min(1, 1200 / H);
  const c = newCanvas(Math.round(W * scale), Math.round(H * scale));
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, bx, by, bwid, bhei, (W - bwid) / 2 * scale, (H - bhei) / 2 * scale, bwid * scale, bhei * scale);
  return { blob: await canvasBlob(c, "image/webp", 0.86), m: new DOMMatrix().scale(scale).translate((W - bwid) / 2 - bx, (H - bhei) / 2 - by) };
}

// Returns { blob, raw, engine } or throws if no method could find the garment.
// `raw` is the cut-out before framing, pixel for pixel on top of the photo: the hand editor starts from it.
async function removeBackground(blob) {
  let raw, engine = "ai";
  try { raw = await aiCutout(blob); } catch { raw = await basicCutout(blob); engine = "basic"; }
  const [a, b] = await Promise.all([createImageBitmap(blob), createImageBitmap(raw)]);
  if (a.width !== b.width || a.height !== b.height) {
    const c = newCanvas(a.width, a.height);
    c.getContext("2d").drawImage(b, 0, 0, a.width, a.height);
    raw = await canvasBlob(c, "image/png");
  }
  return { blob: await framePiece(raw), raw, engine };
}

/* ---------- Standing pieces upright (on the device, no tokens) ---------- */
// Stand a cut-out garment upright. Returns the clockwise rotation in degrees: the garment's
// left-right symmetry gives the axis, then the ends decide which way is up (legs go down;
// a hood, collar or neckline goes up). `kind` is "top", "bottom" or "" when not known yet.
async function uprightAngle(blob, kind = "") {
  const bmp = await createImageBitmap(blob);
  const N = 120, fit = 84 / Math.max(bmp.width, bmp.height);
  const cv = Object.assign(document.createElement("canvas"), { width: N, height: N });
  const ctx = cv.getContext("2d", { willReadFrequently: true });
  const maskAt = (deg) => {
    ctx.setTransform(1, 0, 0, 1, N / 2, N / 2);
    ctx.clearRect(-N, -N, 2 * N, 2 * N);
    ctx.rotate((deg * Math.PI) / 180);
    ctx.drawImage(bmp, (-bmp.width * fit) / 2, (-bmp.height * fit) / 2, bmp.width * fit, bmp.height * fit);
    const a = ctx.getImageData(0, 0, N, N).data;
    const m = new Uint8Array(N * N);
    for (let i = 0; i < N * N; i++) m[i] = a[i * 4 + 3] > 127 ? 1 : 0;
    return m;
  };
  const centreX = (m) => { let sx = 0, n = 0; for (let i = 0; i < N * N; i++) if (m[i]) { sx += i % N; n++; } return n ? sx / n : N / 2; };
  // How well the garment mirrors onto itself across a vertical line through its middle.
  const symmetry = (m) => {
    const cx = centreX(m);
    let both = 0, either = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const mx = Math.round(2 * cx - x);
      const a = m[y * N + x], b = mx >= 0 && mx < N ? m[y * N + mx] : 0;
      both += a & b; either += a | b;
    }
    return either ? both / either : 0;
  };
  // Shape of both ends once the axis is vertical.
  const ends = (m) => {
    const cx = Math.round(centreX(m));
    const rows = [];
    for (let y = 0; y < N; y++) {
      let w = 0;
      for (let x = 0; x < N; x++) w += m[y * N + x];
      if (w) rows.push({ y, w });
    }
    let L = N, R = 0;
    for (let i = 0; i < N * N; i++) if (m[i]) { L = Math.min(L, i % N); R = Math.max(R, i % N); }
    const H = rows.length, maxW = Math.max(...rows.map((r) => r.w));
    const side = (list) => {
      // legs: the middle stays empty for a long way in from this end
      let gap = 0;
      for (const r of list.slice(0, Math.round(H * 0.6))) { if (m[r.y * N + cx] || m[r.y * N + cx - 1] || m[r.y * N + cx + 1]) break; gap++; }
      // hood or collar: the edge of this end is uneven across the middle of the garment
      const prof = [];
      for (let x = Math.round(L + (R - L) * 0.2); x <= L + (R - L) * 0.8; x++) {
        let d = 0;
        for (const r of list) { if (m[r.y * N + x]) break; d++; }
        prof.push(d / H);
      }
      const mean = prof.reduce((a, b) => a + b, 0) / prof.length;
      const dev = Math.sqrt(prof.reduce((a, b) => a + (b - mean) ** 2, 0) / prof.length);
      const k = list.slice(0, Math.max(2, Math.round(H * 0.15)));
      return { gap: gap / H, dev, width: k.reduce((s, r) => s + r.w, 0) / k.length / maxW };
    };
    return H < 8 ? null : { top: side(rows), bottom: side([...rows].reverse()) };
  };
  // Decide which end is up. Returns [flip, confidence 0..2].
  const decide = ({ top, bottom }) => {
    const gapD = top.gap - bottom.gap, devD = top.dev - bottom.dev;
    const trousers = Math.max(top.dev, bottom.dev) >= 0.17 && Math.abs(devD) >= 0.08;
    const legs = kind === "bottom" || (kind !== "top" && (trousers || (Math.max(top.gap, bottom.gap) >= 0.15 && Math.abs(gapD) >= 0.08)));
    if (legs) {
      if (Math.abs(gapD) >= 0.08) return [gapD > 0, 2];
      if (Math.abs(devD) >= 0.04) return [devD > 0, trousers ? 2 : 1];
      return [false, 0];
    }
    if (Math.abs(devD) >= 0.05) return [devD < 0, 1.5];
    if (Math.abs(top.width - bottom.width) >= 0.15) return [bottom.width < top.width, 0.5];
    return [false, 0];
  };

  let best = 0, bestS = -1;
  for (let d = -90; d < 90; d += 4) { const s = symmetry(maskAt(d)); if (s > bestS) { bestS = s; best = d; } }
  for (let d = best - 3; d <= best + 3; d++) { const s = symmetry(maskAt(d)); if (s > bestS) { bestS = s; best = d; } }
  // Square-ish pieces (shorts, folded knits) can be almost as symmetric the other way round;
  // then the axis whose ends tell a clearer story wins.
  const cands = [{ d: best, s: bestS }];
  const other = best + 90, so = symmetry(maskAt(other));
  if (bestS - so < 0.06) cands.push({ d: other, s: so });
  let pick = null;
  for (const c of cands) {
    const e = ends(maskAt(c.d));
    if (!e) continue;
    let [flip, conf] = decide(e);
    // Not sure which end is up: stay as close as possible to the photo as it was taken.
    const deg = (d) => ((Math.round(d) % 360) + 360) % 360;
    const turn = (d) => Math.min(deg(d), 360 - deg(d));
    if (conf < 1 && turn(c.d + 180) < turn(c.d) - 20) flip = true;
    if (conf < 1 && turn(c.d) < turn(c.d + 180) - 20) flip = false;
    const score = conf + (c.s - bestS) * 10;
    if (!pick || score > pick.score) pick = { deg: deg(c.d + (flip ? 180 : 0)), score, conf };
  }
  return pick ? pick.deg : 0;
}

const kindOf = (category) => {
  const slot = CAT[category]?.slot;
  return slot === "bottom" ? "bottom" : ["base", "mid", "outer"].includes(slot) ? "top" : "";
};

// A clockwise turn of a w×h image by `deg`: the canvas grows to fit, `m` maps old pixels to new ones.
function turnGeo(w, h, deg) {
  const r = (deg * Math.PI) / 180, cos = Math.abs(Math.cos(r)), sin = Math.abs(Math.sin(r));
  const W = Math.round(w * cos + h * sin), H = Math.round(w * sin + h * cos);
  return { W, H, m: new DOMMatrix().translate(W / 2, H / 2).rotate(deg).translate(-w / 2, -h / 2) };
}
function turnCanvas(bmp, deg) {
  const g = turnGeo(bmp.width, bmp.height, deg);
  const c = newCanvas(g.W, g.H);
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.setTransform(g.m);
  ctx.drawImage(bmp, 0, 0);
  return { c, m: g.m };
}
const quarterOf = (deg) => (((Math.round(deg / 90) * 90) % 360) + 360) % 360;
// Turn an image clockwise. Cut-outs are re-framed afterwards; photos only turn in quarter steps.
async function rotateImage(blob, deg, cutout) {
  if (!cutout) deg = Math.round(deg / 90) * 90;
  deg = ((Math.round(deg) % 360) + 360) % 360;
  if (!deg) return blob;
  const { c } = turnCanvas(await createImageBitmap(blob), deg);
  return cutout ? framePiece(c) : canvasBlob(c, "image/jpeg", 0.85);
}
// The framed cut-out of a photo turned by `rot`, from its raw cut-out (see removeBackground),
// and `geo`: where each pixel of the upright photo (the photo turned in quarter steps, as kept
// in `originals`) lands in the cut-out. Saved with the piece, it lets the cut-out be fixed by hand later.
async function makeCut(raw, rot) {
  const bmp = raw instanceof Blob ? await createImageBitmap(raw) : raw;
  const t = turnCanvas(bmp, rot);
  const f = await frameGeo(t.c);
  const toOrig = turnGeo(bmp.width, bmp.height, quarterOf(rot)).m;
  return { blob: f.blob, geo: f.m.multiply(t.m).multiply(toOrig.inverse()) };
}
const geoList = (m) => m && [m.a, m.b, m.c, m.d, m.e, m.f].map((v) => Math.round(v * 1e5) / 1e5);

/* ======================================================================
   Weather (Open-Meteo, no key needed)
   ====================================================================== */
const WMO = (c) =>
  c === 0 ? "Clear sky" : c <= 2 ? "Partly cloudy" : c === 3 ? "Overcast" : c <= 48 ? "Fog" :
  c <= 57 ? "Drizzle" : c <= 67 ? "Rain" : c <= 77 ? "Snow" : c <= 82 ? "Showers" : c <= 86 ? "Snow showers" : "Thunderstorm";
const isWet = (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 99);

// Cities that can be found without internet, with their usual temperatures: approximate
// monthly averages of the daily high and low (°C, January to December). When live weather
// can't be reached (no connection, or a preview that blocks it), the app uses these.
const CITY_DATA = `
Roma|Rome|IT|41.90|12.50|13 14 17 20 24 28 31 32 28 23 17 13|3 4 5 8 12 16 18 18 15 12 7 4
Milano|Milan|IT|45.46|9.19|8 10 15 19 24 28 30 30 25 19 12 8|1 2 5 9 13 17 20 19 16 11 6 2
Napoli|Naples|IT|40.85|14.27|13 14 16 19 24 28 31 31 27 23 18 14|5 5 7 9 13 17 19 20 17 13 9 6
Torino|Turin|IT|45.07|7.69|8 10 15 18 22 26 29 28 24 18 12 9|-1 0 4 7 11 15 18 17 13 9 4 0
Palermo||IT|38.12|13.36|16 16 18 20 24 28 31 31 28 25 20 17|9 9 10 12 16 19 22 23 20 17 13 10
Genova|Genoa|IT|44.41|8.93|12 13 15 18 21 25 28 29 25 21 16 13|6 6 9 11 15 18 21 21 18 15 10 7
Bologna||IT|44.49|11.34|7 10 15 19 24 29 32 31 26 19 12 7|0 1 5 9 13 17 20 20 16 11 6 1
Firenze|Florence|IT|43.77|11.25|11 13 17 20 25 29 33 33 28 22 16 12|2 3 5 8 12 16 18 18 15 11 6 3
Bari||IT|41.12|16.87|13 14 16 19 24 28 30 30 27 22 18 14|5 5 7 10 14 18 20 20 17 14 10 6
Catania||IT|37.50|15.09|16 16 18 21 25 30 33 33 29 25 21 17|6 6 8 10 14 18 21 21 18 15 11 8
Venezia|Venice,Mestre|IT|45.44|12.33|7 9 13 17 22 26 28 28 24 18 12 8|0 1 4 8 13 17 19 18 15 10 6 1
Verona||IT|45.44|10.99|7 10 15 19 24 28 31 30 25 19 12 7|-1 0 4 8 12 16 19 18 14 10 5 0
Messina||IT|38.19|15.55|15 15 17 19 23 27 30 31 28 24 20 16|10 10 11 13 16 20 23 24 21 18 14 11
Padova|Padua|IT|45.41|11.88|7 10 15 19 24 28 30 30 25 19 12 7|-1 0 4 8 12 16 18 18 14 10 5 0
Trieste||IT|45.65|13.78|9 10 13 17 22 26 28 28 24 19 13 10|4 4 7 10 15 19 21 21 17 13 8 5
Brescia||IT|45.54|10.21|7 10 15 19 24 28 31 30 25 19 12 7|-1 0 4 8 13 17 19 19 15 10 5 0
Bergamo||IT|45.70|9.67|7 10 14 18 23 27 29 29 24 18 12 8|0 1 5 8 13 17 19 19 15 11 5 1
Parma||IT|44.80|10.33|6 9 14 18 23 28 31 30 25 18 11 7|-1 0 4 8 12 16 19 18 15 10 5 0
Modena||IT|44.65|10.93|6 9 14 18 23 28 31 30 25 19 11 7|-1 0 4 8 12 16 19 19 15 10 5 0
Reggio Emilia||IT|44.70|10.63|6 9 14 18 23 28 31 30 25 19 11 7|-1 0 4 8 12 16 19 18 15 10 5 0
Reggio Calabria||IT|38.11|15.65|15 15 17 20 24 28 31 31 28 24 20 16|9 9 10 12 16 20 23 23 21 17 13 10
Perugia||IT|43.11|12.39|9 11 14 18 23 27 31 31 26 20 14 10|2 2 5 7 11 15 18 18 14 10 6 3
Livorno||IT|43.55|10.31|12 13 15 18 22 26 29 29 26 21 16 13|5 5 7 10 13 17 20 20 17 14 9 6
Pisa||IT|43.72|10.40|12 13 16 19 23 27 30 30 27 22 16 13|3 3 5 8 12 15 18 18 15 11 7 4
Ravenna||IT|44.42|12.20|7 9 13 18 23 27 30 30 25 19 13 8|0 1 4 8 12 16 19 18 15 10 5 1
Rimini||IT|44.06|12.57|9 10 14 18 23 27 30 30 25 20 14 10|1 2 5 8 13 17 19 19 15 11 7 3
Cagliari||IT|39.22|9.12|15 15 17 20 24 28 31 32 28 24 19 16|6 6 8 10 13 17 20 20 18 15 10 7
Sassari||IT|40.73|8.56|13 14 16 18 23 27 31 31 27 23 18 14|5 5 7 9 12 16 19 19 17 14 10 7
Salerno||IT|40.68|14.77|13 14 16 19 24 28 31 31 27 23 18 14|5 5 7 9 13 17 19 20 17 13 9 6
Foggia||IT|41.46|15.55|12 13 16 20 25 30 33 33 28 22 17 13|3 3 5 8 12 16 19 19 16 12 8 4
Lecce||IT|40.35|18.17|14 14 17 20 24 29 32 32 28 23 18 15|5 5 7 9 13 17 19 20 17 13 10 6
Taranto||IT|40.47|17.24|13 14 16 19 24 28 31 31 27 23 18 14|6 6 8 10 14 18 21 21 18 15 11 7
Siracusa|Syracuse|IT|37.08|15.29|16 16 18 21 25 29 32 32 29 25 21 17|7 7 8 10 14 18 21 21 19 16 12 9
Pescara||IT|42.46|14.21|12 13 15 18 23 27 30 30 26 21 16 13|3 4 6 9 13 17 19 19 16 12 8 4
Ancona||IT|43.62|13.52|10 11 14 17 22 26 29 29 25 20 15 11|3 4 6 9 13 17 20 20 16 12 8 5
Trento||IT|46.07|11.12|6 10 15 18 23 27 30 29 24 18 11 6|-3 -2 3 7 11 15 17 17 13 8 3 -2
Bolzano|Bozen|IT|46.50|11.35|7 11 16 20 25 29 31 30 25 19 11 6|-5 -3 2 6 10 14 16 15 11 7 1 -4
Udine||IT|46.06|13.24|8 10 14 17 22 26 29 28 24 18 12 8|-1 0 4 7 12 16 18 17 13 9 5 0
Vicenza||IT|45.55|11.55|7 10 15 19 24 28 30 30 25 19 12 7|-1 0 4 8 12 16 18 18 14 10 5 0
Monza||IT|45.58|9.27|7 10 15 18 23 27 30 29 25 19 12 8|0 1 5 8 13 17 19 19 15 11 5 1
Como||IT|45.81|9.09|7 10 14 18 22 26 29 28 24 18 12 8|0 1 4 8 12 16 18 18 14 10 5 1
Latina||IT|41.47|12.90|13 14 17 19 24 28 31 31 27 23 18 14|3 4 6 8 12 16 18 19 16 12 8 5
Aosta||IT|45.74|7.32|5 9 14 18 22 26 29 28 23 17 10 5|-5 -3 1 4 9 12 14 14 10 6 0 -4
L'Aquila|Aquila|IT|42.35|13.40|6 8 11 15 20 25 29 29 24 18 12 7|-3 -3 0 4 8 11 14 14 10 6 2 -2
Potenza||IT|40.64|15.80|7 7 10 14 19 23 27 27 22 16 11 8|0 0 2 5 9 13 15 16 12 8 5 2
Campobasso||IT|41.56|14.66|7 8 11 15 20 25 28 28 23 17 12 8|1 1 3 6 10 14 17 17 13 10 6 2
London|Londra|GB|51.51|-0.13|8 9 12 15 18 21 24 23 20 16 11 9|2 2 4 6 9 12 14 14 12 9 5 3
Paris|Parigi|FR|48.86|2.35|8 9 13 16 20 23 26 25 21 16 11 8|3 3 5 8 11 14 17 16 13 10 6 4
Nice|Nizza|FR|43.70|7.27|14 14 16 18 22 25 28 29 26 22 17 14|6 6 8 11 14 18 21 21 18 14 10 7
Madrid||ES|40.42|-3.70|10 12 16 19 23 29 33 32 27 20 14 11|3 3 6 8 11 16 19 19 15 11 6 4
Barcelona|Barcellona|ES|41.39|2.17|15 15 17 19 22 26 29 29 27 23 18 15|8 8 10 12 16 20 23 23 20 17 12 9
Berlin|Berlino|DE|52.52|13.40|3 5 9 15 20 23 25 25 20 14 8 4|-2 -1 2 5 9 13 15 14 11 7 3 -1
München|Munich,Monaco di Baviera|DE|48.14|11.58|3 5 10 15 19 23 25 24 20 14 8 4|-4 -3 0 4 8 12 14 13 10 6 1 -3
Amsterdam||NL|52.37|4.90|6 7 10 14 18 20 23 23 19 15 10 7|1 1 3 5 8 11 13 13 11 8 4 2
Bruxelles|Brussels|BE|50.85|4.35|7 8 11 15 19 22 24 23 20 15 10 7|1 1 4 6 9 12 14 14 11 8 5 2
Wien|Vienna|AT|48.21|16.37|4 6 11 16 21 24 27 26 21 15 9 4|-2 -1 3 7 12 15 17 17 13 8 4 0
Zürich|Zurich,Zurigo|CH|47.37|8.54|4 6 10 15 19 22 24 24 19 14 8 5|-2 -2 2 5 9 12 14 14 10 7 2 -1
Genève|Geneva,Ginevra|CH|46.20|6.14|5 7 12 16 20 24 27 26 21 16 9 6|-1 -1 2 5 9 13 15 14 11 8 3 0
Lisboa|Lisbon,Lisbona|PT|38.72|-9.14|15 16 19 20 23 26 28 29 27 23 18 15|8 9 11 12 14 17 18 19 18 15 12 9
Dublin|Dublino|IE|53.35|-6.26|8 9 10 12 15 18 19 19 17 14 10 9|3 3 4 5 7 10 12 11 10 7 5 3
Praha|Prague,Praga|CZ|50.08|14.44|2 4 8 14 19 22 25 25 19 13 7 3|-4 -3 0 4 8 12 14 13 10 6 2 -2
Warszawa|Warsaw,Varsavia|PL|52.23|21.01|1 2 7 14 20 23 25 24 19 13 6 2|-5 -4 -1 4 9 12 14 13 9 5 1 -3
Budapest||HU|47.50|19.04|3 6 11 17 22 26 28 28 23 16 9 4|-3 -2 2 6 11 15 17 16 12 7 3 -2
Athína|Athens,Atene|GR|37.98|23.73|14 15 17 21 26 31 34 34 29 24 19 15|7 8 9 12 16 21 24 24 20 16 12 9
Stockholm|Stoccolma|SE|59.33|18.07|0 0 4 10 16 20 23 22 17 10 5 2|-5 -5 -3 2 7 11 14 13 9 5 1 -3
København|Copenhagen,Copenaghen|DK|55.68|12.57|3 4 6 11 16 19 22 22 18 13 8 5|-1 -2 0 3 8 11 14 14 11 7 4 1
Oslo||NO|59.91|10.75|-1 0 5 10 16 20 23 21 16 10 4 0|-7 -7 -4 1 6 10 13 12 8 4 -1 -6
Helsinki||FI|60.17|24.94|-2 -3 2 8 15 19 22 21 15 9 4 0|-7 -8 -5 1 6 11 14 13 8 4 -1 -5
New York|NYC|US|40.71|-74.01|4 6 10 17 22 27 30 29 25 19 12 7|-3 -2 2 8 13 18 21 21 17 11 5 1
Los Angeles||US|34.05|-118.24|20 20 21 22 23 25 28 29 29 26 23 20|9 10 11 13 15 17 19 19 18 15 11 9
Miami||US|25.76|-80.19|25 26 27 29 31 32 33 33 32 30 28 26|16 17 19 21 23 25 26 26 25 23 20 18
Toronto||CA|43.65|-79.38|-1 0 5 12 19 24 27 26 22 15 8 2|-7 -7 -3 3 9 14 17 17 13 7 1 -4
Dubai||AE|25.20|55.27|25 26 29 34 38 40 42 42 39 35 30 26|15 17 19 23 27 29 31 31 29 25 20 17
Tokyo|Tokio|JP|35.68|139.69|10 11 14 20 24 26 30 32 28 22 17 13|1 2 5 10 15 19 23 24 21 15 9 4
Sydney|Sidney|AU|-33.87|151.21|26 26 25 23 20 18 17 19 21 23 24 26|19 19 18 15 12 9 8 9 11 14 16 18
`;
const CITIES = CITY_DATA.trim().split("\n").map((l) => {
  const [name, aka, cc, lat, lon, hi, lo] = l.split("|");
  return { name, aka: aka ? aka.split(",") : [], cc, lat: +lat, lon: +lon, hi: hi.split(" ").map(Number), lo: lo.split(" ").map(Number) };
});
const fold = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z]/g, "");
const MONTH = (m = new Date().getMonth()) => new Date(2000, m, 1).toLocaleDateString(undefined, { month: "long" });
function offlineCities(q) {
  const k = fold(q);
  if (!k) return [];
  const rank = (c) => {
    const names = [c.name, ...c.aka].map(fold);
    return names.includes(k) ? 0 : names.some((n) => n.startsWith(k)) ? 1 : names.some((n) => n.includes(k)) ? 2 : 9;
  };
  return CITIES.map((c) => [rank(c), c]).filter(([r]) => r < 9).sort((a, b) => a[0] - b[0]).slice(0, 5)
    .map(([, c]) => ({ name: c.name, latitude: c.lat, longitude: c.lon, country_code: c.cc }));
}
function nearestCity(lat, lon, maxKm = 200) {
  let best = null, bd = Infinity;
  for (const c of CITIES) {
    const dx = (c.lon - lon) * 111 * Math.cos((lat * Math.PI) / 180), dy = (c.lat - lat) * 111;
    const d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = c; }
  }
  return bd <= maxKm ? best : null;
}
function typicalWeather(lat, lon) {
  const c = nearestCity(lat, lon);
  if (!c) return null;
  const m = new Date().getMonth(), hi = c.hi[m], lo = c.lo[m];
  const day = Math.round((2 * hi + lo) / 3);
  return { at: Date.now(), lat, typical: true, near: c.name, temp: day, feels: day, max: hi, min: lo, code: null, rainChance: null };
}
const getJSON = async (u) => {
  const r = await fetch(u, AbortSignal.timeout ? { signal: AbortSignal.timeout(8000) } : {});
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

async function loadWeather(force = false) {
  const { lat, lon } = state.settings;
  if (lat == null) return (state.weather = null);
  const cached = await store.get("kv", "weather");
  const fresh = cached && !cached.typical && cached.lat === lat && cached.hourly; // older copies had no hourly forecast
  if (!force && fresh && Date.now() - cached.at < 30 * 60e3) return (state.weather = cached);
  try {
    const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation&hourly=apparent_temperature,precipitation_probability,weather_code,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=2&timezone=auto`);
    const w = {
      at: Date.now(), lat,
      temp: j.current.temperature_2m, feels: j.current.apparent_temperature, code: j.current.weather_code,
      wind: j.current.wind_speed_10m, humid: j.current.relative_humidity_2m, max: j.daily.temperature_2m_max[0], min: j.daily.temperature_2m_min[0],
      rainChance: j.daily.precipitation_probability_max[0] ?? 0,
      // Hour by hour for today and tomorrow, for events later in the day (local times, "2026-10-15T19:00").
      hourly: { time: j.hourly.time, feels: j.hourly.apparent_temperature, rain: j.hourly.precipitation_probability, code: j.hourly.weather_code, humid: j.hourly.relative_humidity_2m },
    };
    await store.put("kv", w, "weather");
    return (state.weather = w);
  } catch {
    // Offline: today's forecast from earlier still counts; otherwise the usual temperatures.
    if (fresh && Date.now() - cached.at < 12 * 3600e3) return (state.weather = cached);
    return (state.weather = typicalWeather(lat, lon));
  }
}
// Returns { results, offline }: the live city search, or the built-in list when it can't be reached.
async function searchCity(name) {
  try {
    const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=5&language=en`);
    if (j.results?.length) return { results: j.results, offline: false };
    return { results: offlineCities(name), offline: false };
  } catch {
    return { results: offlineCities(name), offline: true };
  }
}

// One line for Settings saying where today's temperatures come from.
function weatherSource() {
  const w = state.weather, s = state.settings;
  if (s.lat == null) return `<p class="muted small" style="margin:0">Pick your city so outfits match the weather.</p>`;
  if (!w) return `<p class="muted small" style="margin:0">${esc(s.city)}: weather can't load here, and there's no built-in city nearby. Use the slider on Today.</p>`;
  if (w.typical) return `<p class="muted small" style="margin:0">${esc(s.city)}: live weather can't be reached here, so outfits use the usual ${esc(MONTH())} temperatures${w.near !== s.city ? ` for ${esc(w.near)}` : ""} (${fmtTemp(w.min)}–${fmtTemp(w.max)}). Live weather comes back by itself once the app is online.</p>`;
  return `<p class="muted small" style="margin:0">${esc(s.city)}: live weather, updated ${new Date(w.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}.</p>`;
}

/* ======================================================================
   Outfit engine (rule-based, works offline, no tokens)
   The rules below score each candidate outfit; your taste (next section) adds to
   that score, so the ideas move towards what you actually wear and like.
   ====================================================================== */
function conditions() {
  const w = state.weather;
  let feels = w ? Math.min(w.feels, (w.min + w.max) / 2 + 1) : 15;
  let wet = w ? isWet(w.code) || w.rainChance >= 55 : false;
  let humid = w?.humid ?? 0; // relative humidity, %: picks lighter scents when the air is heavy
  const at = state.event && eventWeather(state.event);
  if (at) {
    // Dressing now for something later today: warm enough for both. Tomorrow: for that time.
    if (state.event.day === "tomorrow") ({ feels, wet, humid } = at);
    else { feels = Math.min(feels, at.feels); wet ||= at.wet; }
  }
  return { feels: state.manualTemp ?? feels, wet, humid };
}
// How it will feel during an event (its first four hours), from the hourly forecast.
// With only the usual temperatures for the month, evenings and mornings are cooler than midday.
function eventWeather(ev) {
  const w = state.weather;
  if (!w || ev.allDay) return null;
  const h = w.hourly;
  if (!h) {
    const hr = new Date(ev.start).getHours();
    return hr >= 19 || hr < 9 ? { feels: (2 * w.min + w.max) / 3, wet: false, humid: 0 } : null;
  }
  const to = Math.max(ev.start + 3600e3, Math.min(ev.end, ev.start + 4 * 3600e3));
  const idx = h.time.map((t, k) => [new Date(t).getTime(), k]).filter(([t]) => t + 3600e3 > ev.start && t < to).map(([, k]) => k);
  if (!idx.length) return null;
  const feels = idx.reduce((a, k) => a + h.feels[k], 0) / idx.length;
  return { feels, wet: idx.some((k) => isWet(h.code[k]) || (h.rain[k] ?? 0) >= 55), humid: h.humid ? idx.reduce((a, k) => a + (h.humid[k] ?? 0), 0) / idx.length : 0 };
}
const CORE = ["base", "mid", "outer", "bottom", "shoes"];

/* ---------- The fashion bible (fashion-bible.json, see stylist.js) ----------
   The rules and tips of the Python fashion model. Every outfit idea is scored by its rules,
   outfits that break an important one are only shown when nothing else is left, and the AI
   stylist is given the same rules and the tips that fit the question. */
// Saved on the device after the first download, so it also works offline; a newer one replaces it.
async function loadBible() {
  const saved = await raw.get("kv", "bible").catch(() => null);
  if (saved) Style.setBible(saved);
  const fetched = fetch("fashion-bible.json", { cache: "no-cache" })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status))))
    .then(async (b) => {
      if (!Style.setBible(b)) return false;
      if (b.built_at === saved?.built_at) return false;
      await raw.put("kv", b, "bible").catch(() => {});
      return true;
    })
    .catch(() => false);
  if (!saved) await fetched; // nothing saved yet: the first download comes before the first outfits
  else fetched.then((changed) => { if (changed) { tasteMemo = null; state.outfits = []; if (view === "today") render(); } });
}
// What the rules need to know about the day. Warmth rules use how warm this person likes to dress.
const styleCtx = (cond, occ, t) => ({ occasion: occ.id, feels: cond.feels, wet: cond.wet, offset: occ.id === "gym" ? 0 : t?.offset || 0, age: state.settings.age || null });

// What's in fashion now at each age (Settings > Look > Age). `fit` and `style` are points for the top,
// the bottoms and each piece's styles: under 25 baggy and wide jeans, boxy and oversized tops and
// streetwear; then straighter, cleaner lines; from 50 classic regular fits and quiet pieces.
// `now` goes to the AI stylist, Discover looks and the audit in a few words.
const AGE_BANDS = [
  { upTo: 24, now: "baggy or wide-leg jeans and cargos, boxy or oversized tees and hoodies, statement sneakers, layered streetwear and outdoor pieces",
    fit: { baggy: 0.8, wide: 0.8, oversized: 0.6, relaxed: 0.4, slim: -0.5 }, style: { streetwear: 0.5, vintage: 0.3, outdoor: 0.2, sporty: 0.2, preppy: -0.2 } },
  { upTo: 34, now: "straight or relaxed jeans, relaxed tailoring, overshirts, clean minimal sneakers, streetwear mixed with smart pieces",
    fit: { straight: 0.4, relaxed: 0.4, regular: 0.2, baggy: 0.2, wide: 0.2, oversized: 0.1, slim: -0.2 }, style: { minimal: 0.3, "smart casual": 0.3, streetwear: 0.1 } },
  { upTo: 49, now: "regular and straight fits, tailoring that isn't tight, knitwear and overshirts, leather sneakers and loafers, quiet logos",
    fit: { regular: 0.4, straight: 0.4, slim: 0.2, relaxed: 0.1, oversized: -0.6, baggy: -0.6, wide: -0.3 }, style: { "smart casual": 0.3, minimal: 0.3, preppy: 0.2, streetwear: -0.4 } },
  { upTo: Infinity, now: "classic regular fits, quality knits, chinos, loafers and clean leather sneakers, few or no logos",
    fit: { regular: 0.5, straight: 0.4, slim: 0.1, relaxed: 0.1, oversized: -1, baggy: -1, wide: -0.4 }, style: { "smart casual": 0.3, smart: 0.3, preppy: 0.2, minimal: 0.2, luxury: 0.2, streetwear: -0.7, sporty: -0.3 } },
];
const ageBand = (age = state.settings.age) => (age ? AGE_BANDS.find((b) => age <= b.upTo) : null);
const ageNow = () => (ageBand() ? ` In fashion now at ${state.settings.age}: ${ageBand().now}.` : "");
// How current an outfit looks for the wearer's age: the fit of the top and the bottoms, and the pieces'
// styles. Dressier occasions follow it less (a suit is a suit at any age), the gym not at all.
function ageScore(o, pieces, occ) {
  const band = ageBand();
  if (!band || occ.id === "gym") return { s: 0 };
  let s = 0, best = null;
  for (const p of [heroOf(o), o.bottom].filter(Boolean)) {
    let v = band.fit[p.fit] || 0;
    if (v < 0 && p.fit === "slim" && p.category !== "jeans") v = 0; // slim tailoring is fine at any age, skinny jeans aren't now
    s += v;
    if (v >= 0.6 && v > (best?.v || 0)) best = { v, p };
  }
  const styled = pieces.filter((p) => p.styles?.length);
  s += 1.5 * mean(styled.map((p) => p.styles.map((st) => band.style[st] || 0).reduce((a, v) => (Math.abs(v) > Math.abs(a) ? v : a), 0)));
  s = Math.max(-1.5, Math.min(1.5, s)) * (occ.level >= 4 || ["work", "event"].includes(occ.id) ? 0.4 : occ.id === "smart" ? 0.7 : 1);
  const reason = best && s >= 0.6 ? `${FITS[best.p.fit].label} ${catLabel(best.p.category).toLowerCase()}: in fashion at ${state.settings.age}` : null;
  return { s, reason };
}
// The rules the engine scores in its own, personal way (see scoreOutfit); they still count as violations.
const OWN_COMFORT_RULES = ["warmth", "shorts-weather"];
const ruleLine = (v) => v.note || v.rule.title;

// Warmth points of the top layers, and how many the rule of thumb wants at a temperature.
const layerWarmth = (pieces) => pieces.filter((p) => ["base", "mid", "outer"].includes(roleOf(p))).reduce((a, p) => a + (p.warmth || 2), 0);
const wantedWarmth = (feels) => (feels >= 24 ? 1 : feels >= 19 ? 2.5 : feels >= 14 ? 3.5 : feels >= 8 ? 6 : feels >= 2 ? 8 : 9.5);
// The piece people see first (the top under any jacket), which sets the outfit's colour and fit.
const heroOf = (o) => o.mid || o.base;
const outfitKey = (pieces) => pieces.filter((p) => p && CORE.includes(roleOf(p))).map((p) => p.id).sort().join("|");

/* ---------- Elegance levels ----------
   How dressed-up a whole outfit is, from 1 to 5:
   1 Relaxed: a hoodie, sweatshirt, joggers or shorts in it.
   2 Casual: T-shirt, jeans, sporty sneakers, or anything whose own styles are casual (cargo pants,
     Timberland-style boots, a streetwear bomber), when there's more than one or nothing smarter around.
   3 Smart casual: shirts, knits, chinos or trousers, leather shoes (one casual piece is fine, like
     a blazer and shirt with jeans).
   4 Tailored: a blazer over a shirt, with trousers and dress shoes or boots.
   5 Full suit: the same, with jacket and trousers of one suit.
   The jacket you wear against the weather (a puffer, a rain jacket) doesn't change the level.
   Each occasion has the levels that suit it; the chips under the occasions pick one by hand. */
const RELAXED = ["hoodie", "zip-hoodie", "sweatshirt", "joggers", "shorts", "track-pants", "gym-shorts", "training-shoes", "slides"];
const EVERYDAY = ["tshirt", "jeans", "tank-top"];
// A casual piece: a T-shirt or jeans, sneakers that aren't smart (clean leather ones are), or anything
// whose styles are all casual (streetwear cargo pants, outdoor boots).
// When the AI has looked at the photo, its own dressiness (1-5) decides instead of the styles.
const casualPiece = (p) => {
  if (EVERYDAY.includes(p.category)) return true;
  const look = lookOf(p);
  if (look?.dressiness) return look.dressiness <= 2;
  return (p.category === "sneakers" && p.formality < 2.5) || p.formality < 1.8;
};
// What the AI saw in a piece's photo (see lookAt), for an app item or a piece of the fashion bible's.
const lookOf = (p) => p?.look || p?.item?.look || null;
// Jacket and trousers of one suit: linked by you (item.suit), or the fashion bible's own test (same
// colour and fabric, both formal), unless you said on the piece's page that they aren't one.
const suitPair = (j, t) => {
  if (!j || !t) return false;
  const a = j.item || j, b = t.item || t;
  if ((a.notSuit || []).includes(b.id) || (b.notSuit || []).includes(a.id)) return false;
  return (!!a.suit && a.suit === b.suit) || Style.isSuit(Style.outfitFrom([a, b]));
};
// The other half of a piece's suit: the one you linked, else the first the bible's test pairs it with.
// Used everywhere a suit counts (the levels, the level card, the piece's page, the stylist).
function suitOf(it) {
  const mate = suitMate(it);
  if (mate || !["jacket", "trousers"].includes(it?.category) || !Style.ready()) return mate || null;
  const want = it.category === "jacket" ? "trousers" : "jacket";
  return state.items.find((x) => x.category === want && !x.suit && !x.disliked && !leaving(x) && suitPair(it, x)) || null;
}
// How dressy a piece is, 1 (lounge) to 5 (formal): what the AI saw in the photo, else its type nudged
// by its styles (a blazer 4.5, a dress shirt 4.5, a polo 3.5, a T-shirt 2, a hoodie 1).
const DRESS_BASE = { tshirt: 2, "tank-top": 1.5, "long-sleeve-top": 2, polo: 3, shirt: 3.5, overshirt: 2.5, sweater: 3, jacket: 2.5, rain: 2, coat: 3.5, puffer: 1.5, jeans: 2, trousers: 3, skirt: 3, sneakers: 2, boots: 2.5, "dress-shoes": 4.5 };
function dressOf(p) {
  const it = p?.item || p, look = lookOf(it);
  if (look?.dressiness) return look.dressiness;
  if (RELAXED.includes(it.category)) return 1;
  const words = `${it.name} ${(it.tags || []).join(" ")}`;
  let base = DRESS_BASE[it.category] ?? (it.formality || 1) + 0.5;
  if (it.category === "jacket" && /blazer|suit/i.test(words)) base = 4;
  if (/cargo|parachute/i.test(words)) base -= 0.5;
  if (it.suit) base = Math.max(base, 4);
  const d = Math.min(5, Math.max(1, base + ((it.formality || 1) - 1.5) * 0.6));
  return it.category === "trousers" && softTrousers(it) ? Math.min(d, 2.5) : d;
}
// The pieces of tailoring (levels 4 and 5): a blazer or suit jacket, and smart trousers (not cargo).
const isBlazer = (p) => p.category === "jacket" && (!!p.suit || lookOf(p)?.tailored || (lookOf(p)?.dressiness ?? 0) >= 4 || (!lookOf(p) && p.formality >= 3) || /blazer|suit/i.test(`${p.name} ${(p.tags || []).join(" ")}`));
// Drawstring, elastic or jogger waists, and baggy or wide linen trousers, are relaxed trousers, not tailoring.
const softTrousers = (p) => /drawstring|elastic|jogger/i.test(`${p.name} ${(p.tags || []).join(" ")}`) ||
  (/linen/i.test(`${p.name} ${p.material || ""} ${(p.tags || []).join(" ")}`) && ["baggy", "wide"].includes(p.fit));
const isSmartTrousers = (p) => p.category === "trousers" && !/cargo|parachute/i.test(`${p.name} ${(p.tags || []).join(" ")}`) && !softTrousers(p) && (!!p.suit || lookOf(p)?.tailored || (lookOf(p)?.dressiness ?? 0) >= 3 || (!lookOf(p) && p.formality >= 2));
const LEVELS = { 1: "Relaxed", 2: "Casual", 3: "Smart casual", 4: "Tailored", 5: "Full suit" };
// [lowest, best, highest] level for each occasion.
const OCC_LEVELS = { casual: [1, 2, 3], smart: [3, 3, 4], work: [3, 4, 5], night: [2, 3, 4], event: [4, 5, 5] };
// Levels that are all at their best for an occasion: a hoodie and jeans is as good an everyday outfit
// as a T-shirt and chinos. Others: the middle of OCC_LEVELS.
const BEST_LEVELS = { casual: [1, 2] };
function dressLevel(pieces) {
  const o = Style.outfitFrom(pieces);
  const worn = o.core.filter((p) => p !== o.outer || p.category === "jacket");
  if (!worn.length) return 1;
  if (worn.some((p) => RELAXED.includes(p.category))) return 1;
  const tailoredBit = (p, min) => lookOf(p)?.tailored || (lookOf(p)?.dressiness ?? 0) >= 4 || (!lookOf(p) && p.formality >= min);
  // 4: a blazer and a shirt with smart trousers and leather shoes (or smart sneakers). 5: the jacket and
  // trousers are one suit, with dress shoes. A blazer with jeans or over a T-shirt stays smart casual.
  const blazer = o.outer && isBlazer(o.outer.item), trousers = o.bottom && isSmartTrousers(o.bottom.item);
  const dressShoes = o.shoes && (o.shoes.category === "dress-shoes" || (o.shoes.category === "boots" && tailoredBit(o.shoes, 2)));
  if (blazer && trousers && o.base?.category === "shirt" && o.shoes && (dressShoes || !casualPiece(o.shoes))) return dressShoes && suitPair(o.outer, o.bottom) ? 5 : 4;
  const casual = worn.filter(casualPiece).length;
  return casual === 0 || (casual === 1 && mean(worn.map((p) => p.formality)) >= 2) ? 3 : 2;
}
// What pieces an outfit needs to reach a level, for a wardrobe that can't: shown on Today with a
// link to Discover. Each is [need chip, label, does a piece fill it].
const LEVEL_NEEDS = {
  3: [["Shirts", "a shirt, polo or knit", (i) => ["shirt", "polo", "sweater", "overshirt"].includes(i.category) && i.formality >= 2],
    ["Trousers", "chinos or smart trousers", (i) => i.category === "trousers" && i.formality >= 2],
    ["Shoes", "leather shoes or smart sneakers", (i) => slotOf(i) === "shoes" && !casualPiece(i) && i.formality >= 2]],
  4: [["Shirts", "a shirt", (i) => i.category === "shirt"],
    ["Jackets", "a blazer", isBlazer],
    ["Trousers", "tailored trousers", isSmartTrousers],
    ["Shoes", "dress shoes", (i) => i.category === "dress-shoes" || (i.category === "boots" && (i.look?.dressiness ?? 0) >= 4)]],
};
LEVEL_NEEDS[5] = [...LEVEL_NEEDS[4], ["Jackets", "a suit (jacket and trousers)", (i) => i.category === "jacket" && !!suitOf(i)]];
// When none of today's ideas reach the occasion's lowest level: what's missing for it. A piece you own
// that's only in the wash isn't missing: the card says it's in the wash instead.
function levelGap(pool) {
  const range = Style.ready() && levelsFor(pool.occ);
  if (!range || !pool.cands.length) return null;
  const top = Math.max(...pool.cands.map((c) => c.level));
  if (top >= range[1]) return null;
  // Below the lowest level: nothing fits. Below the best (a suit for Elegant): a hint of what's missing.
  const want = top < range[0] ? range[0] : range[1], own = owned(), clean = suggestable();
  const needs = (LEVEL_NEEDS[want] || []).filter(([, , has]) => !own.some(has));
  const washing = [...new Set((LEVEL_NEEDS[want] || []).filter(([, , has]) => !clean.some(has) && own.some(has)).map(([, , has]) => own.find(has)))];
  return top < range[0] || needs.length || washing.length ? { want, top, short: top >= range[0], needs, washing } : null;
}
// Common sense the fashion bible doesn't check: linen out of season, heavy boots with linen, shorts or tailoring,
// ripped jeans anywhere smart, and colours on the details (a yellow sole, a red logo) that clash with
// the rest of the outfit.
function sense(pieces, feels, occ) {
  let s = 0;
  const reasons = [], has = (p, ...w) => w.some((x) => (p.tags || []).includes(x) || new RegExp(`\\b${x}\\b`, "i").test(`${p.name} ${p.material || ""}`));
  const linen = pieces.filter((p) => has(p, "linen", "seersucker") || lookOf(p)?.material === "linen");
  // Fabric weight seen in the photo: a heavy piece on a warm day, a summer-weight layer in the cold.
  for (const p of pieces) {
    const w = lookOf(p)?.weight;
    if (w === "heavy" && feels >= 22) s -= 1.5;
    else if (w === "light" && feels < 10 && ["mid", "outer"].includes(roleOf(p))) s -= 1;
  }
  if (linen.length && feels < 19) s -= 2;
  const heavyBoots = pieces.find((p) => p.category === "boots" && ((p.warmth || 0) >= 4 || has(p, "timberland", "hiking", "work")));
  if (heavyBoots && pieces.some((p) => /shorts/.test(p.category) || linen.includes(p))) s -= 1.5;
  // Work or hiking boots with a blazer or tailored trousers; a blazer with cargo pants, joggers or shorts.
  const blazer = pieces.some((p) => isBlazer(p.item || p));
  if (heavyBoots && (blazer || pieces.some((p) => p.category === "trousers" && (p.formality >= 3 || lookOf(p)?.tailored)))) s -= 2.5;
  if (blazer && pieces.some((p) => ["joggers", "shorts"].includes(p.category) || has(p, "cargo", "parachute", "jogger"))) s -= 2;
  // A dress shirt under a hoodie or sweatshirt.
  if (pieces.some((p) => p.category === "shirt" && dressOf(p) >= 4) && pieces.some((p) => ["hoodie", "zip-hoodie", "sweatshirt"].includes(p.category))) s -= 2;
  if (occ.target >= 2.2 && pieces.some((p) => has(p, "ripped", "distressed", "destroyed"))) s -= 2.5;
  // The loudest piece sets the accent colours; other pieces should echo them or stay neutral.
  const accents = (p) => new Set([...(p.colors || []), ...(lookOf(p)?.details || [])].filter((c) => COLORS[c] && !COLORS[c].neutral));
  const loud = pieces.map(accents).sort((a, b) => b.size - a.size)[0] || new Set();
  const extra = new Set(pieces.flatMap((p) => [...accents(p)]).filter((c) => !loud.has(c)));
  s -= extra.size;
  if (!extra.size && loud.size) {
    const [c] = [...loud], echo = pieces.filter((p) => accents(p).has(c));
    if (echo.length >= 2) { s += 0.6; reasons.push(`The ${c} in the ${echo[0].name} picks up the ${echo[1].name}`); }
  }
  return { s, reasons };
}
// The levels wanted now: the occasion's, or the one picked by hand ({ level } on the occasion).
const levelsFor = (occ) => (occ.level ? [occ.level, occ.level, occ.level] : OCC_LEVELS[occ.id] || null);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function scoreOutfit(o, cond, occ, t = taste()) {
  const reasons = [];
  let s = 0;
  const pieces = Object.values(o).filter(Boolean);

  // Warmth / layering, shifted by how warm you like to dress (learnt from what you wear)
  const { feels, wet } = cond;
  const coat = coatFor(o, cond, occ);
  const warmth = layerWarmth(pieces) + (coat?.warmth || 0);
  const want = wantedWarmth(feels) + (occ.id === "gym" ? 0 : t.offset);
  const wOff = occ.id === "gym" ? 0 : Math.abs(warmth - want);
  s -= Math.abs(warmth - want) * 0.7;
  // Too hot for a hoodie or knit (outfits with more pieces collect more style points, so say it clearly).
  if (o.mid && feels >= 24) s -= 3;
  else if (o.mid && feels >= 21 && o.mid.warmth >= 3) s -= 1;
  if (o.outer) {
    if (o.outer.warmth >= 5 && feels > 12) s -= 3;
    if (feels < 6 && (o.outer.warmth || 0) < 4 && !coat) s -= 1.5 * (4 - (o.outer.warmth || 0)); // a light jacket in the cold
    if (feels < 6 && o.outer.warmth >= 4) reasons.push(`${o.outer.name} keeps you warm at ${fmtTemp(feels)}`);
    else if (feels < 14) reasons.push(`A light layer for ${fmtTemp(feels)}`);
    if (wet && o.outer.category === "rain") { s += 1.5; reasons.push("Rain jacket for the showers"); }
  }
  if (o.shoes?.category === "boots") s -= feels >= 24 ? 3 : feels >= 20 ? 1 : 0; // boots in the heat
  if (o.bottom) {
    const shorts = /shorts/.test(o.bottom.category);
    // Everyday on a hot day: shorts first, long trousers and jeans lose more the hotter it is.
    const relaxed = occ.id === "casual" && !occ.level;
    if (shorts && feels < 17) s -= o.bottom.category === "gym-shorts" ? 1 : 5; // you train indoors in gym shorts
    else if (shorts && feels >= 23) { s += relaxed ? (feels >= 27 ? 2.5 : feels >= 25 ? 2 : 1.8) : 1; reasons.push(`Shorts weather at ${fmtTemp(feels)}`); }
    else if (!shorts && relaxed && feels >= 23) s -= feels >= 28 ? 3 : feels >= 26 ? 2 : feels >= 24 ? 1 : 0.8;
    else if (!shorts && feels >= 27) s -= 1.5;
  }
  // The style: the fashion bible's rules (colour, dressiness, shoes, proportions, patterns...)
  let broken = [];
  if (Style.ready()) {
    const j = Style.judge(pieces, styleCtx(cond, occ, t), OWN_COMFORT_RULES);
    s += j.logit;
    reasons.unshift(...j.praise.slice(0, 2));
    broken = j.violations;
  } else {
    if (wet && o.shoes?.category === "sneakers" && /white|cream/.test(o.shoes.colors?.[0])) s -= 1;

    // Colour harmony
    const cols = pieces.map((p) => p.colors?.[0]).filter(Boolean);
    const accents = [...new Set(cols.filter((c) => !COLORS[c]?.neutral))];
    if (accents.length === 0) { s += 1; reasons.push(new Set(cols).size === 1 ? `Tonal ${cols[0]} look` : "All neutrals, easy to match"); }
    else if (accents.length === 1) { s += 2; reasons.push(`${cap(accents[0])} as the single accent colour`); }
    else { s -= 2.5 * (accents.length - 1); }
    const tones = new Set(cols.map((c) => COLORS[c]?.tone));
    if (tones.has("light") && tones.has("dark")) { s += 0.8; reasons.push("Light and dark pieces give contrast"); }
    const graphics = pieces.filter((p) => (p.tags || []).some((t) => /graphic|statement/.test(t)));
    if (graphics.length > 1) s -= 1.5 * (graphics.length - 1);
    // Denim top with jeans reads as a costume unless the washes clearly differ.
    if (o.bottom?.category === "jeans" && [o.base, o.mid, o.outer].some((p) => p?.colors?.[0] === "denim")) s -= 1;

    // Silhouette: a roomy top looks best over slimmer bottoms and the other way round.
    // Baggy on baggy is a streetwear look: fine for streetwear, sloppy for anything dressier.
    const hero = heroOf(o);
    const top = fitVol(hero), bottom = fitVol(o.bottom);
    if (occ.id !== "gym" && top != null && bottom != null) {
      if (top >= 1 && bottom <= 0) { s += 1; reasons.push(`${FITS[hero.fit].label} top balanced by ${FITS[o.bottom.fit].label.toLowerCase()} ${catLabel(o.bottom.category).toLowerCase()}`); }
      else if (top <= -1 && bottom >= 1) { s += 0.8; reasons.push(`Fitted top with ${FITS[o.bottom.fit].label.toLowerCase()} ${catLabel(o.bottom.category).toLowerCase()}`); }
      else if (top >= 2 && bottom >= 2) {
        const street = pieces.some((p) => (p.styles || []).includes("streetwear")) || (state.settings.age || 99) < 30;
        if (street && occ.target < 2.2) { s += 0.5; reasons.push("Relaxed streetwear proportions"); } else s -= 1.5;
      } else if (top <= -1 && bottom <= -1 && occ.target >= 2.2) s += 0.5;
    }
    if (occ.target >= 2.9) for (const p of [hero, o.bottom]) if (fitVol(p) >= 2) s -= 0.8;

    // Style: fits the occasion, and the pieces speak the same language
    const f = pieces.reduce((a, p) => a + (p.formality || 1), 0) / Math.max(1, pieces.length);
    s -= Math.abs(f - occ.target) * 1.2;
    for (const p of pieces) s += (p.styles || []).some((st) => occ.likes.includes(st)) ? 0.7 : -0.5;
    const freq = {};
    for (const p of pieces) for (const st of p.styles || []) freq[st] = (freq[st] || 0) + 1;
    const [topStyle, topN] = Object.entries(freq).sort((a, b) => b[1] - a[1])[0] || [];
    if (pieces.length > 1 && topN === pieces.length) { s += 1.2; reasons.unshift(`A consistent ${styleLabel(topStyle).toLowerCase()} look`); }
    for (const [a, b] of STYLE_CLASH) if (freq[a] && freq[b]) s -= 1.5;
  }

  const common = sense(pieces, feels, occ);
  s += common.s;
  reasons.push(...common.reasons);
  const now = ageScore(o, pieces, occ);
  s += now.s;
  if (now.reason) reasons.splice(1, 0, now.reason);

  // Elegance: each step outside the levels the occasion wants costs more than a loved piece earns
  // (a level you picked by hand even more), the best level for it earns a little. Elegant wants a full
  // suit first, then tailored separates.
  const range = Style.ready() && levelsFor(occ);
  if (range) {
    const lvl = dressLevel(pieces), [lo, best, hi] = range, step = occ.level ? 4.5 : 3;
    const bests = !occ.level && BEST_LEVELS[occ.id] || [best];
    s += lvl < lo ? -step * (lo - lvl) : lvl > hi ? -step * (lvl - hi) : bests.includes(lvl) ? 1.2 : 0.4;
    if (lvl === 5 && lvl >= lo) reasons.unshift("A full suit: blazer, trousers, shirt and dress shoes");
    // Within a level, how dressy the pieces themselves are (what the AI saw in the photos, else their
    // type) should match the level wanted, so the steps are gradual: Elegant reaches for the dressiest
    // pieces, smart casual leaves the blazer and dress shirt for the levels above.
    const worn = pieces.filter((p) => roleOf(p) !== "outer" || p.category === "jacket");
    const aim = mean(bests), dz = mean(worn.map(dressOf)), k = occ.level ? 2 : occ.id === "event" ? 2.5 : bests.length > 1 ? 0.6 : 1.2;
    s -= dz < aim ? (aim - dz) * k : (dz - aim) * k * (hi > best ? 0.5 : 1);
    if (best >= 4 && suitPair(o.outer, o.bottom)) { s += 1; if (lvl < 5) reasons.push(`The ${o.outer.name} and ${o.bottom.name} as a suit`); }
  }

  // Rotation: don't repeat what you wore recently, keep each piece within its weekly budget (bigger
  // for pieces you love) and give the ones you haven't worn for two weeks a turn.
  const recent = recentWears();
  let idle = 0;
  for (const p of pieces) {
    const d = daysSince(p.lastWorn), k = ROTATION[starsOf(p)] || 1;
    if (d <= 1) s -= 3 * k; else if (d <= 4) s -= 1.2 * k;
    const over = (recent.w7.get(p.id) || 0) + 1 - budgetOf(p);
    if (over > 0) s -= 3 * over;
    if (!p.isNew && budgetGroup(p) && !recent.w14.get(p.id) && d > 14) idle += 1.2;
  }
  s += Math.min(idle, 2);
  const fresh = pieces.find((p) => !p.isNew && budgetGroup(p) && (!p.wearCount || daysSince(p.lastWorn) > 21));

  // Your taste: what you've worn, liked and skipped before
  const learnt = tasteScore(o, occ, t);
  s += learnt.score;
  if (learnt.reason) reasons.unshift(learnt.reason);
  if (fresh) reasons.push(`Gives the ${fresh.name} some wear`);
  return { score: s, wOff, love: learnt.love, reasons: reasons.slice(0, 3), broken: broken.map(ruleLine), brokenIds: broken.map((v) => v.rule.id) };
}

// Today's candidates, best first. Cheap enough to redo on every tap (900 tries).
// The pieces that can fill each part of an outfit for an occasion (none that are in the wash).
// Pieces you disliked are left out, except when you pick one yourself (`all`, for the ⇄ list).
function piecesByRole(occ, all = false) {
  const gym = occ.id === "gym";
  const by = { base: [], mid: [], outer: [], bottom: [], shoes: [] };
  const from = all ? wearable() : suggestable();
  for (const it of from) if (by[roleOf(it)] && (slotOf(it) === "gym") === gym) by[roleOf(it)].push(it);
  if (gym) for (const [role, cats] of Object.entries(GYM_FALLBACK)) if (!by[role].length) by[role] = from.filter((i) => cats.includes(i.category));
  return by;
}
// `opts` lets Discover ask for ideas around a piece you don't own yet ({ anchor, occ, cond }).
// Events pass the pieces that suit their dress code (`by`) and whether a jacket is a must (`outer`).
function ideaPool(opts = {}) {
  const occNow = OCCASIONS.find((o) => o.id === state.occasion);
  const occ = opts.occ || (state.level && occNow.id !== "gym" ? { ...occNow, level: state.level } : occNow);
  const cond = opts.cond || conditions();
  const t = taste();
  const dressy = occ.level ? occ.level >= 4 : occ.target >= 2.9;
  const by = weatherPieces(opts.by || piecesByRole(occ), cond, occ, dressy);
  // Below 6°: most ideas get one of your warm jackets (warmth 4–5), the score decides the rest.
  const warmOuter = cond.feels < 6 ? by.outer.filter((p) => (p.warmth || 0) >= 4) : [];
  // Pieces you love are tried more often (and the ones you rated low less), so they're in more ideas.
  // For work and Elegant, casual pieces are tried less, so a mostly casual wardrobe still gives the
  // score enough smart outfits to choose from.
  // A piece already worn as often as its weekly budget allows is tried less, so there are enough
  // outfits around the others.
  const tries = (x) => (({ 5: 3, 4: 2, 2: 0.6, 1: 0.4 })[starsOf(x)] || 1) * (dressy && casualPiece(x) ? 0.35 : 1) * (atBudget(x) ? 0.4 : 1);
  const pick = (arr) => {
    let r = rand() * arr.reduce((a, x) => a + tries(x), 0);
    for (const x of arr) if ((r -= tries(x)) < 0) return x;
    return arr.at(-1);
  };
  const wantMid = cond.feels < 20 || by.base.length === 0;
  const wantOuter = opts.outer || cond.feels < 15 || cond.wet;
  // Milder days: a light jacket or blazer is tried in about half of the ideas (most of them on dressy
  // occasions) and the score decides; without this a jacket never showed up above 15°.
  const maybeOuter = !wantOuter && occ.id !== "gym" && cond.feels < (dressy ? 27 : 22) ? (dressy ? 0.8 : 0.5) : 0;
  // Dressy occasions: pairs of jacket and trousers that make one suit, tried in a third of the ideas
  // (picking them by chance would rarely find the match in a big wardrobe).
  const suits = dressy && Style.ready() ? by.outer.flatMap((j) => by.bottom.filter((b) => suitPair(j, b)).map((b) => [j, b])) : [];
  // Levels 4 and 5 wanted: a blazer, a shirt and smart trousers together in a quarter of the ideas, for
  // the same reason.
  const kit = dressy && (occ.level || levelsFor(occ)?.[1] || 0) >= 4
    ? { j: by.outer.filter(isBlazer), s: by.base.filter((p) => p.category === "shirt"), b: by.bottom.filter(isSmartTrousers) } : null;
  const useKit = kit && kit.j.length && kit.s.length && kit.b.length;
  // A piece you picked goes in every idea; the rest is built around it.
  const anchor = "anchor" in opts ? opts.anchor : state.items.find((i) => i.id === state.anchor && CORE.includes(roleOf(i)) && !i.wash);

  const seen = new Set();
  const cands = [];
  for (let i = 0; i < 900; i++) {
    const o = {};
    // Cool days: mostly base + mid layer. Warm days: mostly a base layer alone, but mid
    // layers are still tried (the score decides), so a wardrobe with one or two T-shirts
    // still gets three different ideas.
    const r = rand();
    if (by.base.length && (!by.mid.length || r < (wantMid ? 0.85 : 0.7))) o.base = pick(by.base);
    // On a mild day a jacket is the layer: it comes instead of a sweater or hoodie, not on top of one.
    const mildJacket = by.outer.length && !wantOuter && rand() < maybeOuter;
    if (by.mid.length && (!o.base || (wantMid && !mildJacket) || (r < 0.15 && cond.feels < 22))) o.mid = pick(by.mid);
    if (by.outer.length && (wantOuter || mildJacket)) o.outer = warmOuter.length && rand() < 0.8 ? pick(warmOuter) : pick(by.outer);
    if (by.bottom.length) o.bottom = pick(by.bottom);
    if (useKit && rand() < 0.25) [o.outer, o.base, o.bottom] = [pick(kit.j), pick(kit.s), pick(kit.b)];
    if (suits.length && rand() < 0.33) [o.outer, o.bottom] = pick(suits);
    if (by.shoes.length) o.shoes = pick(by.shoes);
    if (anchor) o[roleOf(anchor)] = anchor;
    if (!o.base && !o.mid) continue;
    if (opts.needBase && !o.base) o.base = pick(by.base);
    const key = outfitKey(Object.values(o));
    if (seen.has(key)) continue;
    seen.add(key);
    const scored = scoreOutfit(o, cond, occ, t);
    const level = Style.ready() ? dressLevel(Object.values(o).filter(Boolean)) : 0, range = level && levelsFor(occ);
    cands.push({ key, pieces: o, ...scored, level, levelOff: !range ? 0 : level < range[0] ? range[0] - level : Math.max(0, level - range[2]), jitter: rand() * 0.6, blocked: t.blocked.has(key), isBroken: scored.broken.length > 0 });
  }
  cands.sort((a, b) => b.score + b.jitter - (a.score + a.jitter));
  const missing = ["bottom", "shoes"].filter((s) => !by[s].length && roleOf(anchor || {}) !== s);
  if (!by.base.length && cond.feels >= 22) missing.unshift("base");
  return { occ, cond, cands, missing };
}

// Comfort before stars: on warm days knits and hoodies stay in the drawer (from 22° everything but a
// light overshirt or sweatshirt, from 25° all but an overshirt), and jackets too, except a blazer on a dressy day or a rain
// jacket in the rain. A part of the outfit that would be left empty keeps all its pieces.
function weatherPieces(by, cond, occ, dressy) {
  const f = cond.feels;
  if (occ.id === "gym" || f < 22) return by;
  const out = { ...by };
  if (by.base.length) out.mid = by.mid.filter((p) => (p.warmth || 2) <= 2 && p.category !== "sweater" && (f < 25 || p.category === "overshirt"));
  out.outer = by.outer.filter((p) => (dressy && isBlazer(p)) || (cond.wet && p.category === "rain"));
  return out;
}
// A coat over the blazer on cold days: an outfit has one outer layer, so below 8° the warmest coat,
// parka or puffer you have goes over the blazer for the way there (on dressy days the dressiest one).
// It counts for warmth, not for the elegance level or the style rules.
const COAT_BELOW = 8;
function coatFor(pieces, cond, occ) {
  if (cond.feels >= COAT_BELOW || !pieces.outer || !isBlazer(pieces.outer) || occ.id === "gym") return null;
  const dressy = occ.level ? occ.level >= 4 : occ.target >= 2.9;
  const coats = suggestable().filter((i) => roleOf(i) === "outer" && slotOf(i) !== "gym" && !isBlazer(i) && (i.warmth || 0) >= 4);
  return coats.sort((a, b) => (dressy ? dressOf(b) - dressOf(a) : 0) || (b.warmth || 0) - (a.warmth || 0))[0] || null;
}
// Everything you'd put on for an idea: its clothes, the coat over the blazer and the accessories.
const allPieces = (o) => [...Object.values(o.pieces), o.coat, ...(o.extras || [])].filter(Boolean);

// Pick `n` ideas that differ from each other and from the ones in `keep`: ideally no shared
// hero piece or bottom. If the wardrobe is too small for that (one T-shirt on a hot day),
// sharing one of them beats a much worse outfit (a hoodie at 29°); only then anything left.
// Outfits you said no to are left out while there's anything else, and outfits that break
// one of the fashion bible's important rules only come when nothing else is left.
function pickIdeas(pool, n, keep = [], avoid = []) {
  const { cands } = pool;
  const out = [];
  const shown = new Set([...keep.map((o) => o.key), ...avoid]);
  const heroes = new Set(keep.map((o) => heroOf(o.pieces).id)), bottoms = new Set(keep.map((o) => o.pieces.bottom?.id).filter(Boolean));
  const outers = new Set(keep.map((o) => o.pieces.outer?.id).filter(Boolean));
  const differ = (h, b) => !heroes.has(h) && !(b && bottoms.has(b));
  const half = (h, b) => !heroes.has(h) || !(b && bottoms.has(b));
  // Variety: the first passes want each idea to bring clothes not in the other ideas (and other shoes,
  // and for "New ideas" clothes not in the ideas just shown; then shoes may repeat), so a piece you love
  // comes often but not in all three, and the rest of the wardrobe gets its turn.
  const clothesOf = (c) => Object.entries(c.pieces).filter(([r, p]) => p && r !== "shoes" && p.id !== state.anchor).map(([, p]) => p.id);
  const inSet = new Set(keep.flatMap(clothesOf)), shoesInSet = new Set(keep.map((c) => c.pieces.shoes?.id));
  const justShown = new Set(avoid.flatMap((k) => k.split("|")).filter((id) => roleOf(state.items.find((i) => i.id === id) || {}) !== "shoes"));
  const fresh = (c, level) => !level || (clothesOf(c).every((id) => !inSet.has(id) && (level < 2 || !justShown.has(id))) && (level < 2 || !shoesInSet.has(c.pieces.shoes?.id)));
  // Three tiers: outfits at the occasion's level that break no rule, then the ones that break one, then
  // anything off the level. When nothing you own reaches the level, the closest level comes first, and
  // shoes too casual for the rest (the only rule broken) don't hold an outfit back: with no dress shoes
  // yet, the blazer, shirt and trousers with your smartest sneakers can lead for Elegant (the card
  // above the ideas says dress shoes are missing).
  const closest = Math.min(...cands.filter((c) => !c.blocked).map((c) => c.levelOff ?? 0), Infinity);
  const onlyShoes = (c) => c.brokenIds?.length === 1 && c.brokenIds[0] === "shoe-formality" && (closest > 0 || (!ownsDressShoes() && c.pieces.shoes && !casualPiece(c.pieces.shoes) && /^Sneakers with tailoring/.test(c.broken[0])));
  // Comfort: an outfit far too warm or too cold for the day (more than 3.5 warmth points off, and a point
  // worse than the best at the right level) waits with the ones off the level, whatever its stars.
  const wBest = Math.min(...cands.filter((c) => !c.blocked && (c.levelOff ?? 0) <= closest).map((c) => c.wOff ?? 0), Infinity);
  const tooFar = (c) => (c.wOff ?? 0) > Math.max(3.5, wBest + 1);
  const tier = (c) => ((c.levelOff ?? 0) > closest || tooFar(c) ? 2 : c.isBroken && !onlyShoes(c) ? 1 : 0);
  const good = (cands.find((c) => !c.blocked && tier(c) === 0)?.score ?? cands.find((c) => !c.blocked && tier(c) < 2)?.score ?? cands[0]?.score ?? 0) - 3;
  // For variety an outfit is judged without the pull of the stars on its pieces: one that is good on its
  // own and brings other clothes beats a third idea with the same loved shirt.
  const own = (c) => c.score - (c.love || 0);
  const goodOwn = Math.max(...cands.filter((c) => !c.blocked && tier(c) === 0).map(own), -Infinity) - 3;
  // A jacket you love shouldn't fill every idea: the first passes want each idea to bring a different one.
  // A slightly weaker outfit with another jacket beats the same jacket three times.
  // Repeating a top or bottom beats an outfit far behind the best (shorts at 17° for Elegant).
  const any = () => true;
  // A piece already in both other ideas doesn't go in the third as well, unless it's the only one of
  // its kind that suits the occasion (your only blazer for Elegant).
  const kinds = {};
  for (const c of cands) if (!c.blocked && tier(c) < 2) for (const [r, p] of Object.entries(c.pieces)) if (p) (kinds[r] ||= new Set()).add(p.id);
  const only = (id) => { const p = state.items.find((i) => i.id === id); return !p || (kinds[roleOf(p)]?.size || 0) <= 1; };
  const inAll = (c) => { const ideas = [...keep, ...out]; return ideas.length === 2 && clothesOf(c).some((id) => !only(id) && ideas.every((o) => clothesOf(o).includes(id))); };
  const passes = [[differ, good, true, 2], [differ, good, true, 1], [differ, good, false, 1], [differ, good, true], [half, good, true], [differ, good - 3, true], [half, good - 3, true], [differ, good], [half, good], [any, good], [differ, -Infinity], [half, -Infinity], [any, -Infinity]];
  for (const [allowBlocked, maxTier] of [[false, 0], [true, 0], [false, 1], [true, 1], [true, 2]]) {
    for (const [ok, min, newOuter, freshness] of passes) {
      for (const c of cands) {
        if (out.length === n) break;
        const hero = heroOf(c.pieces).id;
        const bottom = c.pieces.bottom?.id;
        const outer = c.pieces.outer?.id;
        if (out.includes(c) || shown.has(c.key) || (c.blocked && !allowBlocked) || tier(c) > maxTier || !ok(hero, bottom) || (newOuter && outer && outers.has(outer))) continue;
        if (freshness ? !fresh(c, freshness) || (c.score < min && own(c) < goodOwn) : c.score < min) continue;
        if (min > -Infinity && inAll(c)) continue;
        clothesOf(c).forEach((id) => inSet.add(id));
        shoesInSet.add(c.pieces.shoes?.id);
        if (outer) outers.add(outer);
        heroes.add(hero);
        if (bottom) bottoms.add(bottom);
        out.push(c);
      }
    }
  }
  return out;
}
// An idea you already rated today keeps its stars when it comes back (a ♥ from before stars counts as 5).
function ratedToday(key) {
  const l = state.log.find((l) => (l.kind === "rate" || l.kind === "like") && l.date === today() && outfitKey((l.itemIds || []).map((id) => state.items.find((i) => i.id === id))) === key);
  return { ratedId: l?.id || null, stars: l ? (l.kind === "like" ? 5 : l.stars) : 0, rating: false };
}
const dressIdea = (c, pool, used) => {
  const coat = coatFor(c.pieces, pool.cond, pool.occ), x = extrasFor(c.pieces, pool.cond, pool.occ, used);
  if (coat) x.extrasWhy.unshift(`${coat.name} over the ${c.pieces.outer.name} at ${fmtTemp(pool.cond.feels)}`);
  return withWarn({ ...c, coat, missing: pool.missing, ...ratedToday(c.key), ...x }, pool.cond, pool.occ);
};
// Dress shoes you own (in the wash too), or boots the AI saw as dressy: without them your smartest
// sneakers with tailoring are the best you can do, so they don't hold an outfit back or warn (the card
// says so). Sporty sneakers with tailoring still do.
const ownsDressShoes = () => state.items.some((i) => !i.disliked && !leaving(i) && (i.category === "dress-shoes" || (i.category === "boots" && (lookOf(i)?.dressiness ?? 0) >= 4)));
// An idea that still breaks one of the fashion bible's important rules once its headwear and
// accessories are on (only shown when nothing better is left) says so on its card.
function withWarn(idea, cond, occ) {
  const j = Style.ready() ? Style.judge([...Object.values(idea.pieces), ...(idea.extras || [])].filter(Boolean), styleCtx(cond, occ, taste())) : null;
  // The warmth rule says the temperature the way the screen does (feels like, in your unit).
  const line = (v) => (v.rule.id === "warmth" ? ruleLine(v).replace(/ for -?\d+°C$/, ` for today (feels like ${fmtTemp(cond.feels)})`) : ruleLine(v));
  const shoesOnly = (v) => v.rule.id === "shoe-formality" && /^Sneakers with tailoring/.test(ruleLine(v)) && idea.pieces.shoes && !casualPiece(idea.pieces.shoes) && !ownsDressShoes();
  return { ...idea, warn: j ? j.violations.filter((v) => !shoesOnly(v)).map(line) : [], noDressShoes: !!j?.violations.some(shoesOnly) };
}

// `avoid`: outfits just shown, so "New ideas" always brings different ones.
// Today's ideas come out the same each time the app opens on the same day, for the same occasion,
// level, piece, event and temperature, so the try-on pictures drawn for them (see Mirror) stay
// useful all day. "New ideas" moves the seed on; tomorrow starts afresh.
let rand = Math.random;
function seedIdeas(s) {
  let a = parseInt(TryOn.hash(s).slice(0, 8), 16);
  rand = () => { // mulberry32
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function generateOutfits(n = 3, avoid = []) {
  seedIdeas([localDay(), state.occasion, state.level, state.anchor, Math.round(conditions().feels), state.event?.key, avoid.length].join("|"));
  tasteMemo = null; // pieces may have changed (colours, fit) since it was worked out
  const pool = ideaPool();
  const used = new Set();
  const plan = plannedIdea(pool);
  if (plan) { n--; plan.extras.forEach((x) => used.add(x.id)); }
  const keep = plan ? [plan] : [];
  const picks = pickIdeas(pool, n, keep, avoid);
  state.lastFresh = picks.length; // ideas not in `avoid` (see "New ideas")
  if (picks.length < n) picks.push(...pickIdeas(pool, n - picks.length, [...keep, ...picks])); // small wardrobe: repeats are fine
  if (!state.anchor) withLoved(pool, picks, keep, avoid);
  state.outfits = [...keep, ...picks.map((c) => dressIdea(c, pool, used))];
  state.levelGap = state.anchor ? null : levelGap(pool);
  // A piece in all three ideas is the only one of its kind that suits the occasion (see pickIdeas): say so.
  const clothesIn = (o) => Object.entries(o.pieces).filter(([r, p]) => p && r !== "shoes").map(([, p]) => p);
  const shared = state.outfits.length === 3 && clothesIn(state.outfits[0]).find((p) => state.outfits.every((o) => clothesIn(o).includes(p)));
  state.onlyNote = shared ? `Your ${shared.name} is the only ${catLabel(shared.category).toLowerCase()} you have that suits this, so it's in every idea.` : null;
}
// A piece you love (5 stars, then 4) that suits today goes in at least one idea, when it's in none
// yet: the one you wore longest ago, in its best outfit that breaks no rule and isn't far behind.
// It takes the place of the last idea that has no loved piece. Not the day after you wore it, and
// never in an outfit too casual or too dressy for the occasion.
function withLoved(pool, picks, keep, avoid) {
  const loved = (p) => (starsOf(p) || 0) >= 4;
  const ideas = [...keep, ...picks];
  const shown = new Set(ideas.flatMap((o) => Object.values(o.pieces).filter(Boolean).map((p) => p.id)));
  const top = pool.cands.find((c) => !c.blocked && !c.isBroken)?.score ?? 0;
  const keys = new Set([...ideas.map((o) => o.key), ...avoid]);
  const range = Style.ready() && levelsFor(pool.occ);
  const fits = (c) => {
    if (!range) return true;
    const l = dressLevel(Object.values(c.pieces).filter(Boolean));
    return l >= range[0] && l <= range[2];
  };
  let best = null, rank = null;
  for (const c of pool.cands) {
    if (c.blocked || c.isBroken || c.score < top - 5 || keys.has(c.key) || !fits(c) || (c.wOff ?? 0) > 3.5) continue;
    for (const p of Object.values(c.pieces)) {
      if (!p || !loved(p) || shown.has(p.id) || daysSince(p.lastWorn) <= 1 || atBudget(p)) continue;
      const r = [starsOf(p), Math.min(daysSince(p.lastWorn), 365), c.score];
      if (!rank || r[0] > rank[0] || (r[0] === rank[0] && (r[1] > rank[1] || (r[1] === rank[1] && r[2] > rank[2])))) { best = c; rank = r; }
    }
  }
  if (!best) return;
  const swap = picks.findLastIndex((c, i) => (i > 0 || keep.length) && !Object.values(c.pieces).some((p) => p && loved(p)));
  if (swap >= 0) picks[swap] = best;
  else if (picks.length < 3 - keep.length) picks.push(best);
}
// The outfit you planned last night comes first today, while all of it is out of the wash.
function plannedIdea(pool) {
  const ev = state.events.find((e) => e.date === localDay() && e.outfit?.itemIds?.length);
  const p = state.plan?.date === localDay() ? state.plan : ev && { date: ev.date, itemIds: ev.outfit.itemIds, occasion: ev.dressCode?.occasion, title: ev.title, eventId: ev.id };
  if (!p || state.event?.day === "tomorrow" || state.anchor) return null;
  const items = (p.itemIds || []).map((id) => state.items.find((i) => i.id === id)).filter(Boolean);
  if (!items.length || items.some((i) => i.wash)) return null;
  const pieces = {}, extras = [];
  let coat = null;
  for (const it of items) {
    if (CORE.includes(roleOf(it)) && !pieces[roleOf(it)]) pieces[roleOf(it)] = it;
    else if (roleOf(it) === "outer" && !coat) coat = it;
    else extras.push(it);
  }
  if (!pieces.base && !pieces.mid) return null;
  if (coat && pieces.outer && !isBlazer(pieces.outer) && isBlazer(coat)) [pieces.outer, coat] = [coat, pieces.outer];
  const key = outfitKey([...Object.values(pieces)]);
  return withWarn({ key, pieces, coat, planned: p, missing: [], ...ratedToday(key), ...scoreOutfit(pieces, pool.cond, pool.occ), extras, extrasWhy: [] }, pool.cond, pool.occ);
}
async function planOutfit(o) {
  const e = state.event;
  state.plan = { date: localDay(1), itemIds: allPieces(o).map((p) => p.id), occasion: state.occasion, title: e?.title || "", at: new Date().toISOString() };
  await savePlan();
  await addLog({ kind: "like", itemIds: Object.values(o.pieces).filter(Boolean).map((p) => p.id), ...outfitContext(), source: "plan" });
}
// Swapping one piece of an idea: every other piece that could take its place, best fit with
// the rest of the outfit first. A jacket, or one of two top layers, can also just be left off.
function swapOptions(o, role) {
  const occ = OCCASIONS.find((x) => x.id === state.occasion);
  const cond = conditions(), t = taste();
  const cur = o.pieces[role];
  const options = piecesByRole(occ, true)[role]
    .filter((p) => p.id !== cur?.id)
    .map((p) => ({ p, s: scoreOutfit({ ...o.pieces, [role]: p }, cond, occ, t).score }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
  const canDrop = role === "outer" || (role === "mid" && o.pieces.base) || (role === "base" && o.pieces.mid);
  return { options, canDrop };
}
async function swapPiece(i, role, toId) {
  const o = state.outfits[i];
  const from = o.pieces[role];
  const to = toId ? state.items.find((x) => x.id === toId) : null;
  // What you swap out counts against it going with the rest of this outfit.
  await addLog({ kind: "swap", itemIds: Object.values(o.pieces).filter(Boolean).map((p) => p.id), removed: from?.id, added: to?.id || null, ...outfitContext() });
  const occ = OCCASIONS.find((x) => x.id === state.occasion);
  const pieces = { ...o.pieces, [role]: to || undefined };
  if (!to) delete pieces[role];
  const used = new Set(state.outfits.filter((_, k) => k !== i).flatMap((x) => (x.extras || []).map((e) => e.id)));
  const key = outfitKey(Object.values(pieces));
  const cond = conditions();
  state.outfits[i] = withWarn({ ...o, key, pieces, swapping: null, ...ratedToday(key), ...scoreOutfit(pieces, cond, occ), ...extrasFor(pieces, cond, occ, used) }, cond, occ);
}

// After "Not for me": swap that idea for the next best one, keeping the others where they are.
function replaceOutfit(i) {
  const pool = ideaPool();
  const keep = state.outfits.filter((_, k) => k !== i);
  const used = new Set(keep.flatMap((o) => (o.extras || []).map((x) => x.id)));
  const [next] = pickIdeas(pool, 1, keep);
  if (next) state.outfits[i] = dressIdea(next, pool, used);
  else state.outfits.splice(i, 1);
}

/* ======================================================================
   Taste: what the outfit ideas learn from you (on the device, no tokens)
   Every "Wear this today", ♥ and "Not for me" goes in the wear log, which every
   device shares. From it the ideas learn, per piece, pair and occasion:
   - pieces you put together, and combinations you turned down
   - colour pairings and fits you go for (top with bottom)
   - which pieces and styles you reach for in each occasion
   - whether you dress warmer or lighter than the rule of thumb for the temperature
   A signal counts half as much after 60 days, so the ideas follow your taste as it changes.
   ====================================================================== */
const SKIP_REASONS = [["warm", "Too warm"], ["cold", "Too cold"], ["colours", "Colours"], ["style", "Not my style"], ["today", "Just not today"]];
const logKind = (l) => l.kind || "wear";
// Your stars for a piece, 1–5 (null: not rated). Pieces marked ★ Favourite before stars existed count as 5.
const starsOf = (i) => i?.rating || (i?.favorite ? 5 : null);
const isFavourite = (i) => (starsOf(i) || 0) >= 4;
const STAR_WORDS = ["", "Hate it", "Meh", "Fine", "Like it", "Love it"];
// How much a piece's own stars pull an outfit with it up or down. Loved pieces should come up often.
const STAR_PULL = { 5: 2.5, 4: 1.2, 3: 0, 2: -1.2, 1: -2.5 };
// Loved pieces come back sooner after you wore them (the rotation penalty is scaled down).
const ROTATION = { 5: 0.35, 4: 0.6 };
// How many times in 7 days a piece can be worn before its outfits lose points (3 for each wear over),
// by stars 1 to 5 (unrated counts as 3): loved pieces are still worn the most, but not every day, and
// the rest of the wardrobe gets its turn. Shoes and gym clothes have no budget.
const WEAR_BUDGET = { top: [1, 1, 1.5, 2, 2.5], bottom: [1, 1, 2, 2.5, 3], outer: [1.5, 1.5, 2.5, 3, 4] };
const budgetGroup = (p) => (slotOf(p) === "gym" ? null : { base: "top", mid: "top", bottom: "bottom", outer: "outer" }[roleOf(p)] || null);
const budgetOf = (p) => (budgetGroup(p) ? WEAR_BUDGET[budgetGroup(p)][(starsOf(p) || 3) - 1] : Infinity);
// How often each piece was worn in the last 7 and 14 days, from the wear log.
let wearsMemo = null;
function recentWears() {
  const key = `${state.log.length}|${today()}`;
  if (wearsMemo?.key === key) return wearsMemo;
  const w7 = new Map(), w14 = new Map(), now = Date.now();
  for (const l of state.log) {
    if (logKind(l) !== "wear") continue;
    const d = (now - new Date(l.at || l.date).getTime()) / 864e5;
    if (!(d < 14)) continue;
    for (const id of l.itemIds || []) {
      w14.set(id, (w14.get(id) || 0) + 1);
      if (d < 7) w7.set(id, (w7.get(id) || 0) + 1);
    }
  }
  return (wearsMemo = { key, w7, w14 });
}
const atBudget = (p) => (recentWears().w7.get(p.id) || 0) >= budgetOf(p);
// What stars on an outfit teach: 4 and 5 count like a wear and more, 3 nothing, 2 and 1 count against it.
const RATE_WEIGHT = { 5: 2, 4: 1, 3: 0, 2: -1, 1: -2 };
// What a piece is, for learning from the stars on pieces: its main colour, type, fit and styles.
const traitsOf = (p) => [p.colors?.[0] && `colour:${p.colors[0]}`, `type:${p.category}`, p.fit && `fit:${p.fit}`, ...(p.styles || []).map((st) => `style:${st}`)].filter(Boolean);
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
let tasteMemo = null;

function taste() {
  const stars = state.items.reduce((a, i) => a + (starsOf(i) || 0) * 3 + (i.disliked ? 1 : 0), 0);
  const sig = `${state.log.length}|${state.items.length}|${today()}|${state.log.at(-1)?.id}|${stars}`;
  if (tasteMemo?.sig === sig) return tasteMemo.t;
  const byId = new Map(state.items.map((i) => [i.id, i]));
  const t = { pairs: {}, items: {}, colours: {}, fits: {}, styles: {}, stars: {}, traits: {}, traitN: {}, offset: 0, blocked: new Set(), counts: { wear: 0, like: 0, skip: 0, swap: 0, rate: 0, rated: 0, disliked: 0 }, comfortN: 0 };
  const add = (map, k, v) => (map[k] = (map[k] || 0) + v);
  // Your stars on pieces: the piece itself, and a little of what it is (colour, type, fit, style),
  // averaged as if 3 neutral pieces agreed, so one 1-star red shirt doesn't put you off red.
  const traitSum = {};
  for (const p of state.items) {
    const r = starsOf(p);
    if (!r && !p.disliked) continue;
    const v = p.disliked ? -2 : (r - 3) * 0.8;
    t.stars[p.id] = v;
    if (r) t.counts.rated++;
    if (p.disliked) t.counts.disliked++;
    for (const k of traitsOf(p)) { const a = (traitSum[k] ||= [0, 0]); a[0] += v; a[1]++; }
  }
  for (const [k, [sum, n]] of Object.entries(traitSum)) { t.traits[k] = sum / (n + 3); t.traitN[k] = n; }
  let warmSum = 0, warmW = 0;
  for (const l of state.log) {
    const kind = logKind(l);
    const pieces = (l.itemIds || []).map((id) => byId.get(id)).filter((p) => p && CORE.includes(roleOf(p)));
    if (!pieces.length) continue;
    t.counts[kind] = (t.counts[kind] || 0) + 1;
    const age = Math.max(0, daysSince(l.at || l.date));
    const w = 0.5 ** (age / 60);
    const occ = l.occasion || "*";
    const o = {};
    for (const p of pieces) o[roleOf(p)] = p;

    // How warm you dressed (or wanted to) for how it felt
    if (l.feels != null && occ !== "gym" && (o.base || o.mid)) {
      const nudge = { warm: -1.5, cold: 1.5 }[l.reason];
      if (kind === "wear" || kind === "like" || nudge) {
        const ww = w * (kind === "like" ? 0.5 : 1);
        warmSum += ww * (layerWarmth(pieces) + (nudge || 0) - wantedWarmth(l.feels));
        warmW += ww;
        t.comfortN++;
      }
    }
    if (kind === "swap") {
      // A piece taken out of an outfit doesn't go with the rest of it (or not for this occasion).
      const out = pieces.find((p) => p.id === l.removed);
      if (!out) continue;
      const v = -0.8 * w;
      for (const p of pieces) if (p !== out) add(t.pairs, pairKey(out.id, p.id), v);
      add(t.items, `${occ}|${out.id}`, v * 0.3);
      const hero = heroOf(o);
      if ((out === hero || out === o.bottom) && hero && o.bottom) {
        add(t.colours, `${hero.colors?.[0]}|${o.bottom.colors?.[0]}`, v * 0.6);
        if (hero.fit && o.bottom.fit) add(t.fits, `${hero.fit}|${o.bottom.fit}`, v * 0.6);
      }
      continue;
    }
    if (kind === "skip") {
      // That exact outfit stays out of the ideas: for today if it was the weather or the day, else for a month.
      const short = ["today", "warm", "cold"].includes(l.reason);
      if (short ? l.date === today() : age < 30) t.blocked.add(outfitKey(pieces));
      if (short) continue;
    }
    const v = w * (kind === "rate" ? RATE_WEIGHT[l.stars] || 0 : { wear: 1, like: 1.5, skip: -1.2 }[kind] || 0);
    const onlyColours = l.reason === "colours";
    const hero = heroOf(o);
    if (hero && o.bottom) {
      const [c1, c2] = [hero.colors?.[0], o.bottom.colors?.[0]];
      if (c1 && c2) add(t.colours, `${c1}|${c2}`, onlyColours ? v * 1.5 : v);
      if (!onlyColours && hero.fit && o.bottom.fit) add(t.fits, `${hero.fit}|${o.bottom.fit}`, v);
    }
    if (pieces.length < 2) { add(t.items, `*|${pieces[0].id}`, v); continue; } // "Wearing it today" on one piece
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) add(t.pairs, pairKey(pieces[i].id, pieces[j].id), onlyColours ? v * 0.5 : v);
    if (onlyColours) continue;
    for (const p of pieces) {
      add(t.items, `${occ}|${p.id}`, v < 0 ? v * 0.3 : v);
      for (const st of p.styles || []) add(t.styles, `${occ}|${st}`, v / pieces.length);
    }
  }
  // A few outfits shouldn't swing it: start from the rule of thumb (as if 3 outfits agreed with it).
  t.offset = warmW ? clamp(warmSum / (warmW + 3), -3, 3) : 0;
  tasteMemo = { sig, t };
  return t;
}

function tasteScore(o, occ, t) {
  const pieces = Object.values(o).filter(Boolean);
  let s = 0, reason = null;
  if (t.blocked.has(outfitKey(pieces))) s -= 6;
  // Pairs of pieces you've worn or liked together (or turned down)
  let ps = 0, best = null;
  for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
    const a = t.pairs[pairKey(pieces[i].id, pieces[j].id)];
    if (!a) continue;
    ps += Math.tanh(a / 2) * 0.9;
    if (a >= 0.8 && (!best || a > best[0])) best = [a, pieces[i], pieces[j]];
  }
  s += clamp(ps, -3, 3);
  // Pieces you reach for in this occasion (and in general)
  let is = 0;
  for (const p of pieces) is += Math.tanh(((t.items[`${occ.id}|${p.id}`] || 0) + 0.3 * (t.items[`*|${p.id}`] || 0)) / 3) * 0.5;
  s += clamp(is, -1.5, 1.5);
  // Styles you wear for this occasion
  let ss = 0;
  for (const p of pieces) for (const st of p.styles || []) ss += Math.tanh((t.styles[`${occ.id}|${st}`] || 0) / 4) * 0.25;
  s += clamp(ss, -1, 1);
  // Top and bottom: colours and fits you go for
  const hero = heroOf(o);
  let colourLiked = false;
  if (hero && o.bottom) {
    const c = t.colours[`${hero.colors?.[0]}|${o.bottom.colors?.[0]}`];
    if (c) { s += Math.tanh(c / 2); colourLiked = c >= 1.5; }
    const f = t.fits[`${hero.fit}|${o.bottom.fit}`];
    if (f) s += Math.tanh(f / 2) * 0.8;
  }
  // Pieces you gave stars to (a strong pull: a piece you love should be worn often),
  // and a little of what you tend to rate high or low (colours, types, fits, styles)
  let sp = 0, rs = 0;
  for (const p of pieces) {
    sp += p.disliked ? -3 : STAR_PULL[starsOf(p)] || 0;
    for (const k of traitsOf(p)) rs += (t.traits[k] || 0) * 0.3;
  }
  const love = clamp(sp, -5, 5);
  s += love + clamp(rs, -1, 1);
  const loved = pieces.find((p) => starsOf(p) === 5);
  if (loved) reason = `With your ${loved.name}: you love it`;
  else if (best) reason = `You like the ${best[1].name} with the ${best[2].name}`;
  else if (colourLiked) reason = `${cap(hero.colors[0])} with ${o.bottom.colors[0]}: a pairing you go for`;
  return { score: s, reason, love };
}

// One line under the ideas saying what they've learnt so far.
function tasteLine() {
  const t = taste();
  const { wear, like, skip, swap, rate, rated, disliked } = t.counts;
  if (!wear && !like && !skip && !swap && !rate && !rated && !disliked) return "Ideas learn from you: tap Wear this today, ☆, Not for me or ⇄ on a piece, or give your pieces stars, and they get closer to your taste.";
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  let line = `Learning from ${[wear && n(wear, "outfit worn", "outfits worn"), (like || rate) && n(like + rate, "outfit rating", "outfit ratings"), skip && n(skip, "skip", "skips"), swap && n(swap, "swap", "swaps"), rated && n(rated, "rated piece", "rated pieces"), disliked && n(disliked, "disliked piece", "disliked pieces")].filter(Boolean).join(", ")}.`;
  if (t.offset <= -0.8) line += " You dress lighter than most for the weather, so ideas go a layer lighter.";
  else if (t.offset >= 0.8) line += " You like to dress warmer than most, so ideas add a layer sooner.";
  return line;
}

// The same, for the stylist: a few short lines, using the wardrobe's #numbers.
function tasteText() {
  const t = taste();
  const num = new Map(state.items.map((i, n) => [i.id, `#${n + 1}`]));
  const byId = new Map(state.items.map((i) => [i.id, i]));
  const refs = (ids) => ids.map((id) => num.get(id)).filter(Boolean).join("+");
  const lines = [];
  if (Math.abs(t.offset) >= 0.8) lines.push(`Dresses ${t.offset > 0 ? "warmer" : "lighter"} than usual for the temperature (about ${Math.abs(t.offset).toFixed(1)} warmth points).`);
  const pairs = Object.entries(t.pairs).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k]) => refs(k.split("|")));
  if (pairs.length) lines.push(`Often worn or liked together: ${pairs.join(", ")}.`);
  const recent = (kind, filter = () => true) => state.log.filter((l) => logKind(l) === kind && filter(l) && daysSince(l.at || l.date) < 90).slice(-3).reverse();
  const liked = [...recent("like"), ...recent("rate", (l) => l.stars >= 4)].map((l) => refs(l.itemIds.filter((id) => byId.has(id)))).filter(Boolean);
  if (liked.length) lines.push(`Liked outfits: ${liked.join(", ")}.`);
  const pieceList = (f) => state.items.filter((i) => slotOf(i) !== "under" && f(i)).map((i) => num.get(i.id)).slice(0, 12).join(", ");
  const loved = pieceList((i) => !i.disliked && starsOf(i) >= 4);
  if (loved) lines.push(`Pieces rated 4-5 stars: ${loved}.`);
  const meh = pieceList((i) => !i.disliked && starsOf(i) && starsOf(i) <= 2);
  if (meh) lines.push(`Pieces rated 1-2 stars (use rarely): ${meh}.`);
  const disliked = pieceList((i) => i.disliked);
  if (disliked) lines.push(`Disliked pieces (never suggest unless asked): ${disliked}.`);
  const nope = [...recent("skip", (l) => ["colours", "style", undefined].includes(l.reason)).map((l) => `${refs(l.itemIds)}${l.reason ? ` (${l.reason})` : ""}`),
    ...recent("rate", (l) => l.stars <= 2).map((l) => `${refs(l.itemIds)} (rated ${l.stars} stars)`)].filter((x) => /#/.test(x));
  if (nope.length) lines.push(`Turned down: ${nope.join(", ")}.`);
  const swapped = recent("swap", (l) => num.has(l.removed)).map((l) => `${num.get(l.removed)} (with ${refs(l.itemIds.filter((id) => id !== l.removed))})`);
  if (swapped.length) lines.push(`Swapped out of outfits: ${swapped.join(", ")}.`);
  const wantList = state.wants.filter((w) => w.status === "wanted").slice(-6).map((w) => w.title);
  if (wantList.length) lines.push(`Already on the Must-Buy list: ${wantList.join(", ")}.`);
  const nos = state.wants.filter((w) => w.status === "rejected" && daysSince(w.decidedAt) < 180).slice(-6).map((w) => `${w.title}${w.reason ? ` (${REASON_WORDS[w.reason]?.toLowerCase()})` : ""}`);
  if (nos.length) lines.push(`Turned down as buys, don't suggest again: ${nos.join(", ")}.`);
  const fits = Object.entries(t.fits).filter(([, v]) => v >= 1).sort((a, b) => b[1] - a[1])[0];
  if (fits) lines.push(`Favourite proportions: ${fits[0].split("|").map((f) => FITS[f]?.label.toLowerCase()).join(" top, ")} bottom.`);
  const worn = state.items.filter((i) => daysSince(i.lastWorn) <= 2 && slotOf(i) !== "under").map((i) => num.get(i.id));
  if (worn.length) lines.push(`Worn in the last 2 days (avoid unless asked): ${worn.join(", ")}.`);
  return lines.join("\n");
}

// Headwear and accessories that suit the weather and the occasion, added to an outfit.
// Each need picks one piece: colours that go with the outfit, the occasion's styles,
// and pieces not worn lately come first; the other ideas get a different one if possible.
function extrasFor(pieces, cond, occ, used) {
  const { feels, wet } = cond;
  const smart = occ.target >= 2.2; // smart casual and up
  const needs = [];
  if (wet) needs.push([["umbrella"], "Umbrella: rain is likely"]);
  if (feels < 8) needs.push([["beanie", "beret", "hat"], `Something on your head at ${fmtTemp(feels)}`], [["scarf"], ""]);
  if (feels < 4) needs.push([["gloves"], ""]);
  if (feels >= 22 && !wet) {
    if (!smart) needs.push([["cap", "bucket-hat"], ""]);
    needs.push([["sunglasses"], ""]);
  }
  if (occ.id === "gym") needs.push([["gym-bag", "backpack"], ""]);
  needs.push([["watch"], ""]);
  const bottom = pieces.bottom?.category;
  if (smart && ["trousers", "jeans"].includes(bottom)) needs.push([["belt"], ""]);
  if (occ.target >= 2.9 && pieces.base?.category === "shirt") needs.push([["tie"], ""]);

  const cols = Object.values(pieces).filter(Boolean).map((p) => p.colors?.[0]).filter(Boolean);
  const accent = cols.find((c) => !COLORS[c]?.neutral);
  const extras = [], why = [];
  // An accessory that would break a rule the outfit doesn't break (a second statement piece, a clash)
  // stays off: the card shouldn't warn about something the app added.
  const ctx = Style.ready() && styleCtx(cond, occ, taste());
  const clothes = Object.values(pieces).filter(Boolean);
  const broken = ctx && new Set(Style.judge(clothes, ctx).violations.map((v) => v.rule.id));
  const adds = (i) => ctx && Style.judge([...clothes, ...extras, i], ctx).violations.some((v) => !broken.has(v.rule.id));
  for (const [cats, reason] of needs) {
    let options = suggestable().filter((i) => cats.includes(i.category) && !adds(i));
    // A belt in the same colour family as the leather shoes (black with black, brown with brown).
    if (cats[0] === "belt" && pieces.shoes && Style.ready()) options = options.filter((i) => !((Style.ruleScore([pieces.shoes, i], "belt-shoes") ?? 0) <= -0.5));
    if (!options.length) continue;
    const score = (i) => {
      const c = i.colors?.[0];
      let s = COLORS[c]?.neutral || !c ? 1 : c === accent ? 1.5 : accent ? -1.5 : 0.5;
      if ((i.styles || []).some((st) => occ.likes.includes(st))) s += 0.7;
      const d = daysSince(i.lastWorn);
      if (d <= 1) s -= 1.5;
      if (isFavourite(i)) s += 0.4;
      if (used.has(i.id)) s -= 1;
      return s + rand() * 0.3;
    };
    const best = options.map((i) => [i, score(i)]).sort((a, b) => b[1] - a[1])[0][0];
    used.add(best.id);
    extras.push(best);
    if (reason) why.push(reason);
  }
  return { extras, extrasWhy: why };
}

// `ctx` (for whole outfits) records the occasion and how warm it felt, so ideas can learn from it.
// Returns the pieces that went straight into the wash (see Laundry).
async function wearOutfit(items, ctx) {
  const now = new Date().toISOString();
  const washed = state.settings.autoWash ? items.filter((it) => washAfterWear(it) && !it.wash) : [];
  for (const it of items) {
    it.wearCount = (it.wearCount || 0) + 1;
    it.lastWorn = now;
    it.wornSinceWash = (it.wornSinceWash || 0) + 1;
    if (washed.includes(it)) { it.wash = now; it.wornSinceWash = 0; }
    await store.put("items", it);
  }
  await addLog({ itemIds: items.map((i) => i.id), ...(ctx && outfitContext()), ...ctx });
  return washed;
}
// Settings > Laundry > Back from the wash: clothes come back by themselves after that many days.
async function washBack() {
  const days = state.settings.washBack;
  const back = days ? inWash().filter((i) => daysSince(i.wash) >= days) : [];
  if (!back.length) return;
  await setWash(back, false);
  toast(`${back.length === 1 ? back[0].name : `${back.length} pieces`} back from the wash`, { label: "Undo", run: async () => { await setWash(back, true); refreshViews(); } });
}
// "Logged" with an Undo for the pieces that went in the wash, in case they didn't.
function wornToast(msg, washed) {
  if (!washed.length) return toast(msg);
  const names = washed.length === 1 ? washed[0].name : `${washed.length} pieces`;
  toast(`${msg} ${names} went in the wash.`, { label: "Undo", run: async () => { await setWash(washed, false); toast("Kept out of the wash"); refreshViews(); } });
}
// After a change from a toast: the screen, and the piece's page if it's open.
function refreshViews() {
  render();
  const open = !$("#sheet").hidden && $(".sheet-panel [data-wash]")?.dataset.wash;
  if (open) openItem(open);
}

/* ======================================================================
   Laundry: a piece in the wash stays in your wardrobe but is left out of outfit
   ideas, swaps, "Start from a piece" and the stylist's outfits until it's back.
   ====================================================================== */
// Worn once, then washed: T-shirts and shirts, underwear and socks, and gym clothes. Hoodies, knits,
// trousers and jeans after a few wears (Settings > Laundry). Jackets, coats, shoes and bags never.
const WASH_GROUPS = { hoodies: ["hoodie", "zip-hoodie", "sweatshirt"], knits: ["sweater", "overshirt"], trousers: ["trousers", "joggers", "shorts", "skirt"], jeans: ["jeans"] };
const WASH_LABELS = { hoodies: "Hoodies", knits: "Knits", trousers: "Trousers, shorts", jeans: "Jeans" };
const WASH_DEFAULTS = { hoodies: 3, knits: 4, trousers: 4, jeans: 6 };
const washGroup = (it) => Object.keys(WASH_GROUPS).find((g) => WASH_GROUPS[g].includes(it.category));
function washLimit(it) {
  if (["base", "under"].includes(slotOf(it)) || (slotOf(it) === "gym" && ["base", "mid", "bottom"].includes(roleOf(it)))) return 1;
  const g = washGroup(it);
  return g ? state.settings.washAfter?.[g] ?? WASH_DEFAULTS[g] : 0;
}
const washAfterWear = (it) => washLimit(it) > 0 && (it.wornSinceWash || 0) + 1 >= washLimit(it);
const wearable = () => state.items.filter((i) => !i.wash);
// What outfit ideas and accessories are picked from: out of the wash, and not disliked.
// Pieces you're giving away or selling (Wardrobe > Report) are left out of ideas and the audit.
const leaving = (i) => ["donate", "sell"].includes(i.fate?.status);
const suggestable = () => wearable().filter((i) => !i.disliked && !leaving(i));
// What you own, the wash included: what the level card, Must-Buy and the audit count as yours.
const owned = () => state.items.filter((i) => !i.disliked && !leaving(i));
const inWash = () => state.items.filter((i) => i.wash);
async function setWash(items, on) {
  const now = new Date().toISOString();
  for (const it of items) {
    if (on) it.wash = now; else delete it.wash;
    it.wornSinceWash = 0;
    await store.put("items", it);
  }
  if (on && items.some((i) => i.id === state.anchor)) state.anchor = null;
  state.outfits = [];
}
// Stars on an outfit idea ("o"), a piece ("i"), a fragrance ("s") or the outfit you wore ("w"; 0 = skip the question).
// Outfit ratings go in the wear log (kind "rate"), piece and fragrance ratings on the piece or bottle.
async function rate(kind, ref, n) {
  n = +n;
  tasteMemo = null;
  if (kind === "o") {
    const o = state.outfits[+ref];
    if (!o) return render();
    const stars = o.stars === n ? 0 : n;
    const l = o.ratedId && state.log.find((x) => x.id === o.ratedId);
    if (l && !stars) await dropLog(l.id);
    else if (l) { l.kind = "rate"; l.stars = stars; await store.put("log", l); }
    else if (stars) o.ratedId = (await addLog({ kind: "rate", stars, itemIds: Object.values(o.pieces).filter(Boolean).map((p) => p.id), ...outfitContext(), source: o.planned ? "plan" : "idea" })).id;
    Object.assign(o, { stars, rating: false, ratedId: stars ? o.ratedId : null });
    if (stars) toast(stars >= 4 ? "Saved. More ideas like this one." : stars <= 2 ? "Saved. Fewer ideas like this one." : "Saved");
    return render();
  }
  if (kind === "i") {
    const it = state.items.find((i) => i.id === ref);
    if (!it) return render();
    const stars = starsOf(it) === n ? 0 : n;
    if (stars) it.rating = stars; else delete it.rating;
    delete it.favorite; // the stars replace ★ Favourite
    it.ratedAt = new Date().toISOString();
    await store.put("items", it);
    state.outfits = [];
    openItem(it.id);
    return render();
  }
  if (kind === "s") {
    const sc = state.scents.find((x) => x.id === ref);
    if (!sc) return render();
    const stars = starsOf(sc) === n ? 0 : n;
    if (stars) sc.rating = stars; else delete sc.rating;
    sc.ratedAt = new Date().toISOString();
    await store.put("scents", sc);
    openScent(sc.id);
    return render();
  }
  const wear = state.log.find((l) => l.id === ref);
  if (!wear) return render();
  if (n) {
    await addLog({ kind: "rate", stars: n, itemIds: wear.itemIds, occasion: wear.occasion, feels: wear.feels, wearId: wear.id, source: "worn" });
    toast(n >= 4 ? "Thanks. More outfits like it." : n <= 2 ? "Thanks. Fewer outfits like it." : "Thanks");
  } else {
    wear.rateSkip = true;
    await store.put("log", wear);
  }
  state.outfits = [];
  return render();
}
// Likes and skips go in the wear log too (with a `kind`), so they reach every device and backups.
async function addLog(fields) {
  const entry = { date: today(), at: new Date().toISOString(), ...fields };
  await store.put("log", entry);
  state.log.push(entry);
  return entry;
}
async function dropLog(id) {
  await store.del("log", id);
  state.log = state.log.filter((l) => l.id !== id);
}
const outfitContext = () => ({ occasion: state.occasion, feels: Math.round(conditions().feels), ...(state.event && { event: state.event.title }) });

/* ======================================================================
   Calendar: outfit ideas for what's on today (and tomorrow, in the evening)
   Your calendar's private iCal link is read through your own server (browsers can't
   read other sites' files) and the events are worked out here (calendar.js). Each event's
   name says the occasion (dinner → Night out); fix one once and that name keeps it.
   No AI tokens.
   ====================================================================== */
const CAL_FRESH = 30 * 60e3;
const CAL_DAYS = 42;
async function fetchCalendar(url) {
  let r;
  try {
    r = await fetch("api/calendar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }), cache: "no-store" });
  } catch { r = null; }
  if (r?.ok) return r.text();
  if (r && (r.headers.get("Content-Type") || "").includes("json") && r.status !== 404) throw new Error((await r.json()).error || `Error ${r.status}`);
  // No calendar reader here (server.py, the preview): some calendars can still be read directly.
  try {
    const d = await fetch(url.replace(/^webcals?:\/\//i, "https://"), { cache: "no-store" });
    if (d.ok) return d.text();
  } catch {}
  throw new Error("Calendars are read by the online app. Open it from its web address to see your events.");
}
// Read every calendar again if it's been a while (or `force`). True when the events changed.
async function loadCalendar(force = false) {
  const links = state.calendar.links || [];
  // Six weeks ahead: today and tomorrow dress the ideas, the rest is listed in Discover > Events.
  const from = startOfDay(0), to = startOfDay(CAL_DAYS);
  if (!links.length) {
    const had = state.cal.events.length;
    state.cal = { ...state.cal, at: 0, events: [], errors: {} };
    return had > 0;
  }
  if (state.cal.loading || (!force && state.cal.from === from && Date.now() - state.cal.at < CAL_FRESH)) return false;
  state.cal.loading = true;
  const events = [], errors = {}, names = {};
  await Promise.all(links.map(async (l) => {
    try {
      const text = await fetchCalendar(l.url);
      if (!/BEGIN:VCALENDAR/i.test(text.slice(0, 2000))) throw new Error("That link isn't a calendar (an .ics or iCal link).");
      const cal = parseICS(text);
      names[l.url] = cal.name;
      for (const ev of eventsBetween(cal.events, from, to)) events.push({ ...ev, cal: l.url });
    } catch (e) { errors[l.url] = e.message; }
  }));
  // The same event in two calendars (shared with you) shows once.
  const seen = new Set();
  const unique = events.sort((a, b) => a.start - b.start).filter((e) => { const k = `${titleKey(e.title)}|${e.start}`; return !seen.has(k) && seen.add(k); });
  const before = JSON.stringify(state.cal.events);
  state.cal = { at: Date.now(), from, events: unique, errors, names, loading: false };
  await raw.put("kv", { at: state.cal.at, from, events: unique, errors, names }, "calEvents");
  return JSON.stringify(unique) !== before;
}
// The occasion an event dresses for: the one you set for its name, else a guess from its words.
// "skip" means it doesn't change what you wear. A whole-day entry is usually a reminder (a
// birthday, a holiday), so it only counts when it's clearly an occasion, like a wedding.
function eventOcc(e) {
  const set = state.calendar.occ?.[titleKey(e.title)];
  if (set) return set;
  const guess = guessOccasion(e);
  return e.allDay ? (guess === "event" ? guess : "skip") : guess || "casual";
}
const eventKey = (e) => `${e.start}|${titleKey(e.title)}`;
// Today's events still to come, and after 6 pm tomorrow's too.
function dayEvents() {
  const now = Date.now(), mid = startOfDay(1);
  const dress = (e, day) => ({ ...e, day, key: eventKey(e), occasion: eventOcc(e) });
  return {
    today: state.cal.events.filter((e) => e.end > now && e.start < mid).map((e) => dress(e, "today")),
    tomorrow: new Date().getHours() >= 18 ? state.cal.events.filter((e) => e.start >= mid && e.start < startOfDay(2)).map((e) => dress(e, "tomorrow")) : [],
  };
}
// Unless you've picked an occasion yourself today, the ideas dress for the smartest event still
// to come today (a gym session is a change of clothes, so it's only picked if you tap it).
function autoPickEvent() {
  if (state.occChosen === localDay()) return;
  const { today: list } = dayEvents();
  const target = (e) => OCCASIONS.find((o) => o.id === e.occasion)?.target ?? 0;
  const best = list.filter((e) => !["skip", "gym", "casual"].includes(e.occasion))
    .sort((a, b) => target(b) - target(a) || a.start - b.start)[0];
  if ((best?.key || null) === (state.event?.key || null)) return;
  state.event = best || null;
  state.occasion = best ? best.occasion : "casual";
  state.outfits = [];
}
function pickEvent(key) {
  const { today: t, tomorrow: tm } = dayEvents();
  const e = [...t, ...tm].find((x) => x.key === key);
  state.occChosen = localDay();
  state.editingEvent = null;
  if (!e || state.event?.key === key) state.event = null; // tapping it again: back to the day as it is now
  else {
    state.event = e;
    if (e.occasion !== "skip") state.occasion = e.occasion;
  }
  generateOutfits();
}
async function setEventOcc(key, occ) {
  const { today: t, tomorrow: tm } = dayEvents();
  const e = [...t, ...tm].find((x) => x.key === key);
  if (!e) return;
  state.calendar.occ = { ...state.calendar.occ, [titleKey(e.title)]: occ };
  await saveCalendar();
  state.editingEvent = null;
  if (state.event?.key === key) {
    state.event = { ...state.event, occasion: occ };
    if (occ !== "skip") state.occasion = occ;
  }
  if (state.occChosen !== localDay()) autoPickEvent();
  generateOutfits();
}
const occLabel = (id) => (id === "skip" ? "Doesn't matter" : OCCASIONS.find((o) => o.id === id)?.label || id);
// For the stylist: what's on, in a line or two.
function calendarText() {
  const { today: t, tomorrow: tm } = dayEvents();
  const line = (e) => `${e.allDay ? "all day" : fmtTime(e.start)} ${e.title}${e.occasion !== "skip" ? ` (${occLabel(e.occasion)})` : ""}`;
  const parts = [];
  if (t.length) parts.push(`Calendar today: ${t.slice(0, 6).map(line).join("; ")}.`);
  if (tm.length) parts.push(`Tomorrow: ${tm.slice(0, 6).map(line).join("; ")}.`);
  if (state.event) parts.push(`Dressing for: ${state.event.title}${state.event.allDay ? "" : ` at ${fmtTime(state.event.start)}`}${state.event.day === "tomorrow" ? " tomorrow" : ""}.`);
  return parts.join("\n");
}
async function addCalendar(url) {
  url = url.trim().replace(/^webcals?:\/\//i, "https://");
  if (!/^https:\/\/[^\s]+$/.test(url)) return toast("Paste the calendar's https:// or webcal:// link");
  if (/calendar\.google\.com\/calendar\/(u\/\d\/)?(r|embed)/.test(url)) return toast("That's the page link. In Google Calendar's settings, copy the “Secret address in iCal format”.");
  if (state.calendar.links.some((l) => l.url === url)) return toast("That calendar is already added");
  state.calendar.links = [...state.calendar.links, { url, added: new Date().toISOString() }];
  await saveCalendar();
  toast("Reading your calendar…");
  await loadCalendar(true);
  const err = state.cal.errors[url];
  if (!err) { autoPickEvent(); toast(`Calendar added: ${state.cal.events.filter((e) => e.cal === url && e.start < startOfDay(2)).length} events today and tomorrow`); }
  render();
}

/* ======================================================================
   Shopping / gap analysis
   ====================================================================== */
function analyse() {
  const items = state.items;
  const bySlot = Object.fromEntries(Object.keys(SLOTS).map((s) => [s, items.filter((i) => slotOf(i) === s)]));
  const colorCount = {};
  for (const i of items) { const c = i.colors?.[0]; if (c) colorCount[c] = (colorCount[c] || 0) + 1; }
  const styleCount = {};
  for (const i of items) for (const st of i.styles || []) styleCount[st] = (styleCount[st] || 0) + 1;
  // One brand however it's spelt ("The North Face" and "North Face"): the spelling used most.
  const brandCount = {}, spell = {};
  for (const i of items) if (i.brand) { const k = brandKey(i.brand); (spell[k] ||= {})[i.brand] = (spell[k][i.brand] || 0) + 1; }
  for (const s of Object.values(spell)) { const all = Object.entries(s).sort((a, b) => b[1] - a[1]); brandCount[all[0][0]] = all.reduce((a, [, n]) => a + n, 0); }
  const share = (n) => (items.length ? n / items.length : 0);
  const darkShare = share(items.filter((i) => COLORS[i.colors?.[0]]?.tone === "dark").length);
  const graphicShare = share(items.filter((i) => (i.tags || []).some((t) => /graphic|statement/.test(t))).length);
  const hoodieShare = share(items.filter((i) => /hoodie|sweatshirt/.test(i.category)).length);
  const smartShare = share(items.filter((i) => (i.formality || 1) >= 2.5).length);
  const avgFormality = items.reduce((a, i) => a + (i.formality || 1), 0) / Math.max(1, items.length);
  const tracked = items.filter((i) => slotOf(i) !== "under"); // underwear and socks aren't logged per wear
  const unworn = tracked.filter((i) => !i.wearCount);
  const stale = tracked.filter((i) => i.wearCount && daysSince(i.lastWorn) > 60);
  const longBottoms = bySlot.bottom.filter((i) => i.category !== "shorts");

  const s = [];
  // `opt`: [type, what it is without a colour, colours to offer], so each idea comes in a few versions.
  const add = (prio, title, why, query, [cat, noun, colors] = []) => s.push({ prio, title, why, query, cat, noun, colors });
  const mostlyDark = darkShare > 0.55;

  if (bySlot.bottom.length < 2) {
    add("high", mostlyDark ? "Light-wash or grey straight jeans" : "Dark indigo straight jeans", `You have ${bySlot.bottom.length || "no"} bottoms saved, so every outfit is missing half. ${mostlyDark ? "Your tops are mostly dark, so a lighter jean adds contrast." : ""}`.trim(), mostlyDark ? "light wash straight jeans" : "dark indigo straight jeans",
      ["jeans", "straight jeans", mostlyDark ? ["light-wash", "grey", "denim"] : ["indigo", "denim", "black"]]);
    add("high", "Black relaxed trousers or cargo pants", "Black bottoms pair with every hoodie and jacket you own.", "black relaxed cargo trousers", ["trousers", "relaxed cargo trousers", ["black", "olive", "beige"]]);
  } else if (bySlot.bottom.length < SLOT_TARGET.bottom) {
    add("medium", "Beige or stone chinos", "A light neutral bottom widens your combinations.", "beige relaxed chinos", ["trousers", "chinos", ["beige", "stone", "navy"]]);
  } else if (longBottoms.length && !items.some((i) => i.category === "trousers" && (i.formality || 1) >= 2)) {
    add("medium", "Tailored trousers in grey or navy", "All your bottoms are denim, cargo or shorts. One pair of tailored trousers covers smart days with your knits and bombers.", "tailored pleated trousers grey", ["trousers", "tailored trousers", ["grey", "navy", "charcoal"]]);
  }
  if (bySlot.shoes.length < 2) {
    add("high", "White leather sneakers", "Clean white sneakers lift dark outfits and go with every piece you have.", "white leather sneakers minimal", ["sneakers", "leather sneakers", ["white", "cream", "black"]]);
    if (avgFormality > 1.6 || bySlot.outer.length) add("medium", "Black leather boots or derbies", "For your knits and bomber jackets on smarter days.", "black leather chelsea boots", ["boots", "leather Chelsea boots", ["black", "brown", "tan"]]);
  }
  if (bySlot.base.length < 3) {
    add("high", "Heavyweight plain T-shirts (white, black, grey)", "Base layers to wear under hoodies and alone when it's warm. Plain ones balance graphic tops.", "heavyweight plain t-shirt pack", ["tshirt", "heavyweight plain T-shirt", ["white", "black", "grey"]]);
  }
  if (graphicShare > 0.4) {
    add("medium", "A plain, quality knit or polo", `${Math.round(graphicShare * 100)}% of your pieces have prints or big logos; plain pieces make outfits calmer.`, "merino knit polo", ["polo", "knitted polo", ["navy", "cream", "olive"]]);
  }
  if (smartShare < 0.25 && items.length > 5) {
    add("medium", "An Oxford shirt in white or light blue", `Only ${Math.round(smartShare * 100)}% of your wardrobe works for smart occasions. An Oxford shirt goes under your knits and bombers.`, "oxford shirt white", ["shirt", "Oxford shirt", ["white", "light blue", "navy"]]);
  }
  if (hoodieShare > 0.4 && !items.some((i) => i.category === "overshirt")) {
    add("medium", "Overshirt or shacket", "Something between a hoodie and a jacket for smart-casual days.", "wool overshirt", ["overshirt", "wool overshirt", ["olive", "brown", "charcoal"]]);
  }
  if (!items.some((i) => i.category === "rain")) {
    add("low", "Lightweight rain shell", "None of your outerwear is made for rain.", "lightweight rain jacket packable", ["rain", "lightweight rain jacket", ["black", "olive", "navy"]]);
  }
  if (bySlot.outer.length && !items.some((i) => i.category === "coat")) {
    add("low", "Wool overcoat (camel or charcoal)", "A smart option for cold work days or evenings.", "wool overcoat camel", ["coat", "wool overcoat", ["camel", "charcoal", "navy"]]);
  }
  if (darkShare > 0.6) {
    add("low", "One colour piece in olive, forest green or rust", "Your palette is mostly black and dark tones; one earthy colour adds variety without clashing.", "olive green crewneck sweatshirt", ["sweatshirt", "crewneck sweatshirt", ["olive", "forest green", "rust"]]);
  }
  return { bySlot, colorCount, styleCount, brandCount, darkShare, graphicShare, unworn, stale, suggestions: s };
}

// Shop searches say who they're for ("men"/"women", or "uomo"/"donna" for Italian shops),
// unless the words already do.
const GENDER_WORDS = { men: { en: "men", it: "uomo" }, women: { en: "women", it: "donna" } };
const forWho = (query, lang = state.settings.region === "it" ? "it" : "en") =>
  /\b(men|man|mens|women|woman|womens|uomo|donna|unisex)\b/i.test(query) ? query : `${query} ${GENDER_WORDS[state.settings.gender]?.[lang] || "men"}`;
// Settings > Look > Age: what it changes, in a line.
const ageHint = () => (ageBand()
  ? `Outfit ideas follow what's in fashion now at ${state.settings.age}: ${ageBand().now}. The AI stylist, Discover and the audit know it too.`
  : "Outfit ideas, the AI stylist and Discover follow what's in fashion now at your age.");
const shopperText = () => (state.settings.gender === "women" ? "a woman (womenswear)" : "a man (menswear)") + (state.settings.age ? `, aged ${state.settings.age}` : "");
function shopLinks(query) {
  const r = state.settings.region;
  const q = encodeURIComponent(forWho(query));
  const it = r === "it";
  return [
    ["Google Shopping", `https://www.google.com/search?tbm=shop&q=${q}`],
    ["Zalando", `https://www.zalando.${it ? "it" : "co.uk"}/catalog/?q=${q}`],
    ["Vinted", `https://www.vinted.${it ? "it" : "com"}/catalog?search_text=${q}`],
    ["ASOS", `https://www.asos.com/search/?q=${q}`],
  ];
}

/* ======================================================================
   AI (optional): Google Gemini or Anthropic Claude, with your own key.
   Keys stay on this device. Token-saving rules:
   - photos are sent once, as the cut-out (no background), at 512 px
   - results are stored on the item and never requested again
   - the stylist gets a compact one-line-per-piece wardrobe list
   - output length is capped
   ====================================================================== */
const PROVIDERS = { gemini: "Gemini (Google)", claude: "Claude (Anthropic)", off: "Off" };
function aiReady() {
  const s = state.settings;
  if (s.aiProvider === "off") return false;
  return state.previewAI || (s.aiProvider === "gemini" && !!(s.geminiKey || state.serverKeys.gemini)) ||
    (s.aiProvider === "claude" && !!(s.apiKey || state.serverKeys.claude));
}
const aiName = () => (state.previewAI || state.settings.aiProvider === "claude" ? "Claude" : "Gemini");
const NO_AI = "Add a Gemini or Claude API key in Settings to use this.";

async function trackUsage(input = 0, output = 0) {
  const month = today().slice(0, 7);
  if (state.usage.month !== month) state.usage = { month, requests: 0, input: 0, output: 0 };
  state.usage.requests++;
  state.usage.input += input;
  state.usage.output += output;
  await store.put("kv", state.usage, "usage");
}

// One small JPEG on white for the AI: front on the left, back on the right. One picture
// instead of two costs fewer image tokens, and the garments fill the frame.
async function aiImage(front, back, h = 512) {
  const w = Math.round(h * 0.75);
  const c = newCanvas(back ? w * 2 : w, h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  for (const [k, blob] of [front, back].entries()) {
    if (!blob) continue;
    const bmp = await createImageBitmap(blob);
    const s = Math.min(w / bmp.width, h / bmp.height);
    ctx.drawImage(bmp, k * w + (w - bmp.width * s) / 2, (h - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  }
  return canvasBlob(c, "image/jpeg", 0.8);
}

// --- Gemini (REST) ---
function toGeminiSchema(s) {
  const out = {};
  if (s.type) out.type = s.type.toUpperCase();
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.items) out.items = toGeminiSchema(s.items);
  if (s.properties) {
    out.properties = Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, toGeminiSchema(v)]));
    out.required = s.required;
    out.propertyOrdering = Object.keys(s.properties);
  }
  return out;
}
// `search`: let Gemini look things up with Google Search (shops in a mall, real products);
// `onSources` then gets the web pages it used ({ uri, title }). `wait`: give up after that many ms.
async function geminiGenerate({ system, text, image, schema, maxTokens, search, urlContext, onSources, wait }) {
  const { geminiKey, geminiModel } = state.settings;
  const parts = [];
  if (image) parts.push({ inline_data: { mime_type: "image/jpeg", data: await blobToBase64(image) } });
  parts.push({ text });
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    ...(search || urlContext ? { tools: [...(search ? [{ google_search: {} }] : []), ...(urlContext ? [{ url_context: {} }] : [])] } : {}),
    generationConfig: {
      maxOutputTokens: maxTokens,
      thinkingConfig: { thinkingBudget: 0 }, // no hidden "thinking" tokens for these short tasks
      ...(schema ? { responseMimeType: "application/json", responseSchema: toGeminiSchema(schema) } : {}),
    },
  };
  const model = encodeURIComponent(geminiModel || "gemini-flash-latest");
  // With the key saved on the server, the request goes through it and this device never holds the key.
  const signal = () => (wait && AbortSignal.timeout ? { signal: AbortSignal.timeout(wait) } : {});
  const call = (b) => state.serverKeys.gemini
    ? fetch(`api/ai/gemini/${model}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b), ...signal() })
    : fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify(b),
      ...signal(),
    });
  let res = await call(body);
  if (res.status === 400) {
    // Some models don't accept a thinking budget; retry with the model's default.
    delete body.generationConfig.thinkingConfig;
    res = await call(body);
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j.error?.message ? `Gemini: ${j.error.message}` : `Gemini error ${res.status}`);
  const u = j.usageMetadata || {};
  await trackUsage(u.promptTokenCount || 0, (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0));
  const out = (j.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!out) throw new Error("Gemini returned no answer. Try again.");
  onSources?.((j.candidates[0].groundingMetadata?.groundingChunks || []).map((c) => c.web).filter((w) => w?.uri));
  return out;
}

// --- Claude (official SDK) ---
const CLAUDE_MODEL = "claude-opus-5-5";
let anthropicClient, anthropicFor;
async function claudeClient() {
  // With the key saved on the server, the SDK talks to it and the server adds the key.
  const viaServer = !!state.serverKeys.claude;
  const want = viaServer ? "server" : state.settings.apiKey;
  if (!anthropicClient || anthropicFor !== want) {
    const { default: Anthropic } = await import("https://esm.sh/@anthropic-ai/sdk@0.133.0");
    anthropicClient = viaServer
      ? new Anthropic({ apiKey: "kept-on-server", baseURL: new URL("api/ai/claude", location.href).href, dangerouslyAllowBrowser: true })
      : new Anthropic({ apiKey: state.settings.apiKey, dangerouslyAllowBrowser: true });
    anthropicFor = want;
  }
  return anthropicClient;
}
async function claudeGenerate({ system, text, image, schema }) {
  const client = await claudeClient();
  const content = image
    ? [{ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await blobToBase64(image) } }, { type: "text", text }]
    : text;
  const res = await client.beta.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 8000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: schema ? { effort: "low", format: { type: "json_schema", schema } } : { effort: "low" },
    system,
    messages: [{ role: "user", content }],
  });
  await trackUsage(res.usage?.input_tokens || 0, res.usage?.output_tokens || 0);
  if (res.stop_reason === "refusal") throw new Error("Claude declined this request.");
  return res.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
}

// --- Claude preview ---
// The Claude preview blocks every outside website, so Gemini and the Claude API can't be
// reached there with a key. It lets the page ask Claude on the viewer's own claude.ai account
// instead (the viewer allows it once). Anywhere else window.claude doesn't exist and this is null.
const previewSample = window.claude?.use ? window.claude.use("sample").then((f) => f || null, () => null) : Promise.resolve(null);
const PREVIEW_ERRORS = {
  not_granted: "Claude isn't allowed in this preview. Reload and tap Allow when it asks, or use your Gemini key on the tablet.",
  sampling_disabled: "Claude isn't available for this account in the preview.",
  rate_limited: "Too many requests just now. Try again in a minute.",
  session_expired: "Sign in to Claude again, then try once more.",
  images_unavailable: "This preview can't send photos to Claude.",
  image_rejected: "Claude couldn't read this photo. Try another one.",
  refused: "Claude couldn't help with that one. Try asking another way.",
  invalid_json: "Claude's answer couldn't be read. Tap Recognise again.",
};
async function previewGenerate({ system, text, image, schema, onText }) {
  const sample = await previewSample;
  const prompt = `${system}\n\n${text}` + (schema ? `\n\nReply with only one JSON object that follows this JSON Schema:\n${JSON.stringify(schema)}` : "");
  const opts = { modelTier: "default", effort: "low", ...(image ? { images: [image] } : {}), ...(onText ? { onText: ({ text }) => onText(text) } : {}) };
  try {
    if (schema) return JSON.stringify(await sample.json(prompt, opts));
    return (await sample(prompt, opts)).text.trim();
  } catch (e) {
    throw new Error(PREVIEW_ERRORS[e?.code] || "Claude couldn't answer right now. Try again in a moment.");
  }
}

async function aiGenerate(opts) {
  if (!aiReady()) throw new Error(NO_AI);
  if (state.previewAI) return previewGenerate(opts);
  try {
    return await (state.settings.aiProvider === "claude" ? claudeGenerate(opts) : geminiGenerate(opts));
  } catch (e) {
    if (e instanceof TypeError && /fetch|network|load failed/i.test(e.message)) throw new Error(`Couldn't reach ${aiName()}. Check the internet connection and try again.`);
    if (e?.name === "TimeoutError") throw new Error(`${aiName()} took too long to answer.`);
    throw e;
  }
}

// One line per piece, short fields: keeps the stylist prompt to roughly 15 tokens per item.
// "#n" numbers let the answer point at pieces, so their photos can be shown.
// The wardrobe for the AI, one short line a piece (#numbers follow state.items, so the app finds them).
// Left out to save tokens: underwear and socks, pieces you're giving away, and gym clothes unless the
// question is about training (`gym`). The type, brand or colour isn't repeated when the name says it.
function wardrobeText({ gym = false } = {}) {
  return state.items.map((i, n) => {
    if (slotOf(i) === "under" || leaving(i) || (!gym && slotOf(i) === "gym")) return "";
    const b = brandInfo(i.brand), says = (w) => w && i.name.toLowerCase().includes(String(w).toLowerCase());
    const type = catLabel(i.category);
    return [
      `#${n + 1} ${i.name}`, says(type) || says(type.replace(/s$/, "")) ? "" : type.toLowerCase(),
      (i.colors || []).filter((c, k) => k || !says(c)).join("/"),
      i.brand && !says(i.brand) ? i.brand + (b?.tier ? ` (${b.tier})` : "") : b?.tier ? `(${b.tier})` : "",
      (i.styles || []).join("/"), FITS[i.fit] ? i.fit : "", `w${i.warmth}`,
      i.look ? `looks ${DRESSINESS[i.look.dressiness].toLowerCase()}${i.look.material !== "other" ? `, ${i.look.material}` : ""}` : "",
      suitOf(i) ? `suit with #${state.items.indexOf(suitOf(i)) + 1}` : "",
      i.wearCount ? `worn ${i.wearCount}x${daysSince(i.lastWorn) <= 7 ? ` (${daysSince(i.lastWorn)}d ago)` : ""}` : "unworn",
      i.disliked ? "disliked" : "",
      i.wash ? "IN THE WASH" : "",
    ].filter(Boolean).join("; ");
  }).filter(Boolean).join("\n");
}
const STYLIST_SYSTEM =
  "You are a personal stylist in a smart-wardrobe app. Whenever you mention one of the user's pieces, in any kind of answer, write its #number and name, e.g. '#4 Navy knit', so the app can show its photo. " +
  "When the question is about what to wear (a day, an occasion, a trip), suggest 3 clearly different outfits, best first, unless the user asks for another number. " +
  "For every outfit, write a line 'Outfit: <short title>', then one line per piece, then one line starting 'Why:'. " +
  "For anything the user doesn't own (a missing piece, a suggested buy), write its own line: 'To buy: <item> | search: <words to paste into a shop>'. " +
  "Dress for the temperature: add up the warmth of the top layers (about 1 when hot, 3-4 when mild, 6+ when cold). " +
  "Never put a piece marked IN THE WASH in an outfit. " +
  "Follow the user's taste notes when given: build on pairings they wear and like, avoid what they turned down, and don't repeat pieces worn in the last 2 days unless asked. " +
  "Plain text, no markdown, at most 24 short lines.";
// Used when the fashion bible hasn't loaded (it normally brings these and many more rules).
const BASIC_RULES = "Keep to one accent colour and one graphic piece per outfit, and balance proportions: roomy (oversized, baggy, wide) with slimmer pieces, unless it's a deliberate streetwear look.";
const SHOP_QUESTION =
  "Looking at my wardrobe and style, what are the 5 most useful things to buy next? " +
  "One line each: 'To buy: <item> | <why, a few words> | search: <words to paste into a shop> | with: <#numbers of my pieces it goes with>'.";

// Stylist answers: each "Outfit:" block becomes its own card with the pieces' photos,
// and every other line of advice shows photos of the pieces it mentions.
// `refs` maps the #numbers to item ids as they were when the question was asked.
function refName(refs, n) { return state.items.find((i) => i.id === refs[n - 1]); }
function cleanRefs(text, refs) {
  // "#4 Navy knit" → "Navy knit"; a bare "#4" → the piece's name; "the Zara jacket #3" → "the Black
  // Zara jacket" (the words just before that are part of the name aren't written twice).
  return text.replace(/((?:[\w&'-]+ +){0,4})#(\d+)\s*/g, (m, before, n, at, s) => {
    const it = refName(refs, +n);
    if (!it) return before;
    const rest = s.slice(at + m.length);
    if (rest.toLowerCase().startsWith(it.name.toLowerCase())) return before;
    const name = it.name.toLowerCase().split(/\s+/), words = before.trim().split(/ +/).filter(Boolean);
    let k = 0;
    while (k < words.length && name.includes(words[words.length - 1 - k].toLowerCase())) k++;
    const kept = k ? words.slice(0, words.length - k).join(" ") + (words.length > k ? " " : "") : before;
    return kept + (/^\w/.test(rest) ? `${it.name} ` : it.name);
  });
}
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Pieces that can be found by name when the AI forgets the #number, longest names first.
const namedPieces = (refs) => refs.map((id) => state.items.find((i) => i.id === id))
  .filter((i) => i && i.name.length >= 4).sort((a, b) => b.name.length - a.name.length);
// The pieces a line of advice talks about, in the order it mentions them: "#4" numbers, then plain names.
function piecesIn(text, refs, named = []) {
  const found = new Map();
  let rest = text.toLowerCase();
  const blank = (s) => " ".repeat(s.length); // keeps positions, so a name isn't found twice
  for (const m of text.matchAll(/#(\d+)/g)) {
    const it = refName(refs, +m[1]);
    if (!it) continue;
    if (!found.has(it)) found.set(it, m.index);
    rest = rest.replace(new RegExp(`#${m[1]}(?!\\d)\\s*(?:${escRe(it.name.toLowerCase())})?`), blank);
  }
  for (const it of named) {
    if (found.has(it)) continue;
    const re = new RegExp(`(?<![\\p{L}\\d])${escRe(it.name.toLowerCase())}(?![\\p{L}\\d])`, "u");
    const at = rest.search(re);
    if (at < 0) continue;
    found.set(it, at);
    rest = rest.replace(re, blank);
  }
  return [...found].sort((a, b) => a[1] - b[1]).map(([it]) => it);
}

// Line icons for pieces you don't own yet, so a suggested buy has a picture too.
const KIND_ICON = {
  tee: "M8.5 3 3 6l1.8 4 2.7-1.1V21h9V8.9l2.7 1.1L21 6l-5.5-3c-.6 1.4-1.9 2.2-3.5 2.2S9.1 4.4 8.5 3z",
  shirt: "M9 3 4.5 5.2 2.5 16l2.8.6L7.5 9v12h9V9l2.2 7.6 2.8-.6-2-10.8L15 3l-3 3.2zM12 6.2V21M9 3l1.2 4.5L12 6.2l1.8 1.3L15 3M14 11h.01M14 15h.01",
  hoodie: "M9 3.5c0-.8 1.3-1.5 3-1.5s3 .7 3 1.5l4.5 2 2 10.5-2.8.6L16.5 10v11h-9V10l-2.2 6.6-2.8-.6 2-10.5zM9 3.5c0 2.2 1.3 4 3 4s3-1.8 3-4M9.5 15h5",
  knit: "M8.5 3 4.5 5 2.5 16l2.8.6L7.5 10v11h9V10l2.2 6.6 2.8-.6-2-11-4-2c-.6 1.3-1.9 2-3.5 2s-2.9-.7-3.5-2zM7.5 18.5h9",
  jacket: "M8.5 3 4.5 5 2.5 17l2.8.6L7.5 11v10h9V11l2.2 6.6 2.8-.6-2-12-4-2L12 6zM12 6v15",
  coat: "M8.5 2 4.5 4 3 16l2.8.5L7.5 10v12h9V10l1.7 6.5L21 16 19.5 4l-4-2L12 6zM12 6v16M10 12h.01M10 16h.01",
  trousers: "M6 3h12l1.5 18h-5L12 9.5 9.5 21h-5zM6 6.5h12",
  shorts: "M5 5h14l1.5 10.5H14L12 10l-2 5.5H3.5zM5 8h14",
  skirt: "M8 4h8l4 16H4zM8 7h8",
  shoe: "M2.5 9.5V18h19v-1.6c0-1.6-1.1-2.9-2.7-3.3L13 11.5 9 9.5c-1 1.2-2.5 1.6-4 1.5-1 0-1.8-.6-2.5-1.5zM2.5 15.5h19",
  boot: "M7 3h6v9.5l5.5 2.7c1.3.6 2.5 1.6 2.5 3.3V20H7zM7 17h14",
  cap: "M4 15.5a8 8 0 0 1 16 0zM20 15.5c1.5 0 2.5.5 2.5 1.2s-1 1.3-2.5 1.3h-8M12 7.5V6",
  beanie: "M5 15a7 7 0 0 1 14 0M4 15h16v3.5H4zM12 8V5.5",
  bag: "M4.5 8h15l-1.2 13H5.7zM9 8V6a3 3 0 0 1 6 0v2",
  belt: "M2 9.5h20v5H2zM9 8.5h5v7H9zM11.5 12H14",
  watch: "M12 16.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zM9 8l.8-5h4.4L15 8M9 16l.8 5h4.4l.8-5M12 10v2l1.5 1",
  glasses: "M2 10h20M4 10l.8 4.2A2 2 0 0 0 6.8 16h2.4a2 2 0 0 0 2-1.8L11.5 11h1l.3 3.2a2 2 0 0 0 2 1.8h2.4a2 2 0 0 0 2-1.8L20 10",
  jewel: "M12 20a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM10 8l2-3.5L14 8",
  wallet: "M3 7.5h17v12H3zM3 7.5 15 4v3.5M15 12h5v4h-5z",
  scarf: "M6 4c2 1.5 10 1.5 12 0v5c-2 1.5-10 1.5-12 0zM10 9.8V21h3.5V10",
  tie: "M10 3h4l-1 3 2.5 10L12 20l-3.5-4L11 6z",
  umbrella: "M3 12a9 9 0 0 1 18 0zM12 12v6.5a2 2 0 0 1-4 0",
  socks: "M8.5 2.5h6v9.5l3.3 3.3a3 3 0 0 1-4.2 4.2l-4.2-4.2c-.6-.6-.9-1.3-.9-2.1zM8.5 6h6",
  underwear: "M3 6.5h18v3l-1.2 8.5h-5.6L12 13l-2.2 5H4.2L3 9.5zM3 9.5h18",
  hanger: "M12 7.5a2 2 0 1 1 2-2M12 7.5v1L3.3 14.6c-.7.5-.4 1.4.5 1.4h16.4c.9 0 1.2-.9.5-1.4L12 8.5",
  dumbbell: "M6.5 6.5v11M3.5 9v6M17.5 6.5v11M20.5 9v6M6.5 12h11",
};
// What a suggested buy would be saved as, from its words: [pattern, type, icon]. First match wins.
const BUY_KINDS = [
  [/leggings|tights/, "leggings", "trousers"], [/sports bra/, "sports-bra", "tee"], [/gym bag|duffel/, "gym-bag", "bag"],
  [/track jacket/, "track-jacket", "jacket"], [/track pants|tracksuit bottoms/, "track-pants", "trousers"],
  [/training shoes|gym shoes|running shoes/, "training-shoes", "shoe"], [/lifting|wrist wraps|gym gloves|resistance band/, "gym-gear", "dumbbell"],
  [/hoodie/, "hoodie", "hoodie"], [/sweatshirt|crewneck/, "sweatshirt", "hoodie"],
  [/knit|sweater|jumper|cardigan|merino|cashmere/, "sweater", "knit"],
  [/overshirt|shacket/, "overshirt", "jacket"], [/puffer|down jacket/, "puffer", "coat"],
  [/coat|parka|trench/, "coat", "coat"], [/rain|\bshell\b|waterproof/, "rain", "jacket"],
  [/jacket|bomber|blazer|windbreaker/, "jacket", "jacket"],
  [/t-?shirts?|\btees?\b|tank/, "tshirt", "tee"], [/\bpolos?\b/, "polo", "tee"],
  [/shirt|oxford|blouse/, "shirt", "shirt"],
  [/jeans|denim/, "jeans", "trousers"], [/joggers|sweatpants|track pants/, "joggers", "trousers"],
  [/trousers|chinos|cargo|pants|slacks/, "trousers", "trousers"], [/shorts/, "shorts", "shorts"],
  [/skirt/, "skirt", "skirt"],
  [/boots?\b/, "boots", "boot"], [/derby|derbies|loafers?|brogues|dress shoes/, "dress-shoes", "shoe"],
  [/sneakers?|trainers?|runners|shoes/, "sneakers", "shoe"],
  [/beanie/, "beanie", "beanie"], [/beret/, "beret", "beanie"], [/bucket hat/, "bucket-hat", "cap"],
  [/\bcaps?\b/, "cap", "cap"], [/\bhats?\b|fedora/, "hat", "cap"],
  [/watch/, "watch", "watch"], [/sunglasses|shades/, "sunglasses", "glasses"],
  [/bracelet/, "bracelet", "jewel"], [/necklace|chain/, "necklace", "jewel"], [/\brings?\b/, "ring", "jewel"],
  [/belt/, "belt", "belt"], [/backpack/, "backpack", "bag"], [/\bbags?\b|tote/, "bag", "bag"],
  [/wallet|cardholder/, "wallet", "wallet"], [/scarf|scarves/, "scarf", "scarf"], [/gloves/, "gloves", "hanger"],
  [/\bties?\b/, "tie", "tie"], [/umbrella/, "umbrella", "umbrella"],
  [/socks?\b/, "socks", "socks"], [/boxers|briefs|underwear|trunks/, "underwear", "underwear"],
];
function buyKind(title) {
  const k = BUY_KINDS.find(([re]) => re.test(title.toLowerCase()));
  return k ? { cat: k[1], icon: k[2] } : { cat: "accessory", icon: "hanger" };
}
const SLOT_ICON = { base: "tee", mid: "hoodie", outer: "jacket", bottom: "trousers", shoes: "shoe", head: "cap", acc: "watch", gym: "dumbbell", under: "socks" };
const kindIcon = (name) => `<svg class="kind" viewBox="0 0 24 24" aria-hidden="true"><path d="${KIND_ICON[name] || KIND_ICON.hanger}"/></svg>`;

// Pieces you own that would make an outfit with something you don't have yet: the best match per section.
function goesWith(title, n = 4) {
  const t = title.toLowerCase().replace(/\bgray\b/g, "grey");
  const { cat } = buyKind(t);
  return goesWithPiece(asPiece({ cat, color: colourIn(t), title }), n);
}
// The best match per part of an outfit (top, layer, jacket, bottom, shoes).
function goesWithPiece(piece, n = 4) {
  const picks = [];
  for (const o of pairingsFor(piece, Infinity)) if (CORE.includes(roleOf(o)) && !picks.some((p) => roleOf(p) === roleOf(o))) picks.push(o);
  return picks.slice(0, n);
}

// "To buy: White leather sneakers | lifts dark outfits | search: white leather sneakers | with: #3, #7"
const isBuyLine = (line) => /^(?:\d+[.)]\s*)?(?:to buy|buy)\s*[:–—-]|\|\s*search\s*:|\(to buy\)|[–—-]\s*to buy\b/i.test(line);
function parseBuy(line, refs, named) {
  let title = "", query = "", why = [], withText = "";
  for (const part of line.split("|").map((s) => s.trim()).filter(Boolean)) {
    const m = part.match(/^(search(?: for)?|(?:goes |pairs )?with)\b\s*:?\s*(.*)$/i);
    if (m && /^search/i.test(m[1])) query = m[2];
    else if (m) withText += " " + m[2];
    else if (!title) {
      const t = part.replace(/^(?:\d+[.)]\s*)?(?:to buy|buy)\s*[:–—-]?\s*/i, "").replace(/\s*[(–—-]*\s*to buy\s*\)?[:.]?/i, "").replace(/^\w{1,12}:\s+/, "");
      const [head, ...tail] = t.split(/\s[–—-]\s|:\s/);
      title = head.replace(/[.;,]+$/, "").trim();
      if (tail.length) why.push(tail.join(" – "));
    } else why.push(part);
  }
  const whyText = why.join(" · ");
  let pieces = piecesIn(`${withText} ${whyText}`, refs, named);
  if (!pieces.length && title) pieces = goesWith(title);
  return { title: cap(cleanRefs(title, refs)), why: cleanRefs(whyText, refs).trim(), query: query.replace(/^["']|["']$/g, "") || title, with: pieces };
}
const buyTile = (b) => `<a class="piece buy" href="${shopsFor(b)[0]?.[1] || shopLinks(b.query)[0][1]}" target="_blank" rel="noopener">${artTile(b)}<span>To buy: ${esc(b.title)}</span></a>`;
// A suggested buy with its picture, the pieces you own that it goes with, and shop links.
function buyRow(b, { label = "To buy", shops = 4, extra = "" } = {}) {
  return `<div class="buy-row">
    <a class="buy-ic art-tile" href="${shopsFor(b)[0]?.[1] || shopLinks(b.query)[0][1]}" target="_blank" rel="noopener" aria-label="Search for ${esc(b.title)}"${prodAttr(b)}>${tileInner(b)}</a>
    <div class="buy-body">
      ${label ? `<span class="prio">${label}</span>` : ""}<h3>${esc(b.title)}</h3>${b.why ? `<p>${esc(b.why)}</p>` : ""}
      ${b.with.length ? `<div class="goes-with"><span class="muted small">Goes with</span><div class="pieces mini">${b.with.map(pieceTile).join("")}</div></div>` : ""}
      <div class="shops">${shopsFor(b).slice(0, state.trip ? 8 : shops).map(([n, u]) => `<a class="btn" href="${u}" target="_blank" rel="noopener">${esc(n)}</a>`).join("")}${realBtn(b)}${extra}</div>
      ${photosHTML(b)}
    </div>
  </div>`;
}
const wishBtn = (b) => verdictHTML(b);

const pieceTile = (p) => `<button class="piece" data-item="${p.id}"><img class="pic-bg" src="${photoURL(p.photos?.[0])}" alt=""><span>${esc(p.name)}</span></button>`;
// Advice that isn't an outfit: each line with photos of the pieces it mentions; buys get their own row.
function tipsHTML(lines, refs, named) {
  const out = [];
  let plain = [];
  const flush = () => { if (plain.length) out.push(`<p>${esc(plain.join("\n"))}</p>`); plain = []; };
  for (const line of lines) {
    if (isBuyLine(line)) { flush(); const b = parseBuy(line, refs, named); out.push(buyRow(b, { extra: wishBtn(b) })); continue; }
    const items = piecesIn(line, refs, named);
    if (!items.length) { plain.push(cleanRefs(line, refs)); continue; }
    flush();
    out.push(`<div class="tip"><p>${esc(cleanRefs(line, refs))}</p><div class="pieces mini">${items.map(pieceTile).join("")}</div></div>`);
  }
  flush();
  return out.join("");
}
// The answer split into plain advice and "Outfit:" blocks (title, the user's pieces, buys, other lines).
function parseAnswer(ans) {
  const named = namedPieces(ans.refs);
  const intro = [], looks = [];
  let look = null;
  for (const src of ans.text.split("\n")) {
    const line = src.replace(/\*\*|__/g, "").replace(/^[\s*•·–-]+/, "").trim();
    if (!line) continue;
    const head = line.match(/^(?:outfit|look|option)(?:\s*\d+)?\s*(?:[:.)–—-]\s*(.*))?$/i);
    if (head) { look = { title: head[1] || `Outfit ${looks.length + 1}`, items: [], buy: [], lines: [] }; looks.push(look); continue; }
    const why = /^why\b/i.test(line);
    if (look && !why && /to buy/i.test(line) && !/#\d/.test(line)) { look.buy.push(parseBuy(line, ans.refs, named)); continue; }
    const items = look && !why ? piecesIn(line, ans.refs, named) : [];
    if (items.length) { for (const it of items) if (!look.items.includes(it)) look.items.push(it); continue; }
    (look ? look.lines : intro).push(line);
  }
  return { named, intro, looks };
}
function answerHTML(ans) {
  if (!ans) return "";
  if (typeof ans === "string") return esc(ans);
  const { named, intro, looks } = parseAnswer(ans);
  if (!looks.length) return `<div class="ai-rich">${tipsHTML(intro, ans.refs, named)}</div>`;
  return `<div class="ai-rich">${tipsHTML(intro, ans.refs, named)}<div class="looks">${looks.map((l) => `<article class="look"><h3>${esc(cleanRefs(l.title, ans.refs))}</h3><div class="pieces">${l.items.map(pieceTile).join("")}${l.buy.map(buyTile).join("")}</div>${l.lines.length ? `<p class="why">${esc(l.lines.map((x) => cleanRefs(x, ans.refs)).join("\n"))}</p>` : ""}${ans.warn?.[looks.indexOf(l)]?.length ? `<p class="why warn">Heads up: ${ans.warn[looks.indexOf(l)].map(esc).join(" · ")}</p>` : ""}${l.items.length ? `<div class="row"><button class="btn" data-wearids="${l.items.map((i) => i.id).join(",")}">Wear this today</button><button class="btn icon-btn like" data-likeids="${l.items.map((i) => i.id).join(",")}" aria-pressed="false" aria-label="Like this outfit">${ICON_HEART}</button></div>` : ""}</article>`).join("")}</div></div>`;
}

/* ---------- What the AI sees in a piece's photo ----------
   Read once per piece (with the first recognition of a new photo, or from Settings for pieces saved
   before) and kept on the item as `look`, so outfit ideas use it offline at no further cost:
   how dressy it really looks, fabric, pattern, the colours of small details, tailoring, whether it's
   half of a suit, and how heavy the fabric is. */
const MATERIALS = ["cotton", "denim", "wool", "linen", "leather", "suede", "knit", "jersey", "fleece", "nylon", "polyester", "corduroy", "silk", "cashmere", "velvet", "tweed", "flannel", "canvas", "mesh", "other"];
const PATTERNS = ["solid", "stripes", "check", "print", "graphic", "logo", "camo", "floral", "other"];
const PATTERN_TAG = { stripes: "striped", check: "check", print: "print", graphic: "graphic", logo: "logo", camo: "camo", floral: "floral" };
const DRESSINESS = ["", "Sporty or lounge", "Casual", "Smart casual", "Smart", "Formal"];
const LOOK_FIELDS = {
  dressiness: { type: "integer", description: "How dressy it looks in the photo: 1 sporty or lounge, 2 casual, 3 smart casual, 4 smart (blazer, dress shirt, tailored trousers, leather shoes), 5 formal (suit, tuxedo, oxfords)" },
  material: { type: "string", enum: MATERIALS, description: "Main fabric or material as it looks" },
  pattern: { type: "string", enum: PATTERNS, description: "solid if plain; logo for a small logo only on an otherwise plain piece" },
  details: { type: "array", items: { type: "string", enum: Object.keys(COLORS) }, description: "Colours of small details that differ from the main colours (logo, sole, trim, stitching, buttons); empty if none" },
  tailored: { type: "boolean", description: "Structured tailoring: a blazer or suit jacket, trousers with a crease, a dress shirt, dress shoes" },
  suit_part: { type: "boolean", description: "Looks like the jacket or the trousers of a matching suit" },
  weight: { type: "string", enum: ["light", "mid", "heavy"], description: "Fabric weight: light for summer, heavy for winter" },
};
// Turn an AI answer into the `look` kept on the item (null if it says nothing useful).
function lookFrom(r) {
  if (!r || !(r.dressiness >= 1)) return null;
  return {
    dressiness: Math.min(5, Math.max(1, Math.round(r.dressiness))),
    material: MATERIALS.includes(r.material) ? r.material : "other",
    pattern: PATTERNS.includes(r.pattern) ? r.pattern : "solid",
    details: [...new Set((r.details || []).filter((c) => COLORS[c]))].slice(0, 3),
    tailored: !!r.tailored, suitPart: !!r.suit_part,
    weight: ["light", "mid", "heavy"].includes(r.weight) ? r.weight : "mid",
    at: new Date().toISOString(),
  };
}
// Keep the look on the item, and give the fashion bible what it reads from names and tags: the
// material (fabric for the season, the cloth of a suit) and the pattern (pattern mixing, logos).
function applyLook(item, look) {
  if (!look) return;
  item.look = look;
  if (!item.material && look.material !== "other") item.material = look.material;
  const tag = PATTERN_TAG[look.pattern];
  if (tag && !(item.tags || []).includes(tag)) item.tags = [...(item.tags || []), tag];
}
const lookLine = (l) => [`${DRESSINESS[l.dressiness]} (${l.dressiness}/5)`, l.material !== "other" && l.material, l.pattern !== "solid" && l.pattern, l.tailored && "tailored", l.suitPart && "looks like part of a suit", `${l.weight} fabric`, l.details.length && `${l.details.join(", ")} details`].filter(Boolean).join(" · ");
async function lookAt(item) {
  const text = await aiGenerate({
    system: "You describe clothes for a wardrobe app's stylist, judging from the photo. Reply with JSON only.",
    text: `This is a ${catLabel(item.category).toLowerCase()} saved as "${item.name}".${item.photos[1] ? " Left: front. Right: back." : ""}`,
    image: await aiImage(item.photos[0], item.photos[1]),
    schema: { type: "object", additionalProperties: false, required: Object.keys(LOOK_FIELDS), properties: LOOK_FIELDS },
    maxTokens: 140,
  });
  const look = lookFrom(JSON.parse(text.replace(/^```(json)?|```$/g, "").trim()));
  if (!look) throw new Error("The AI didn't describe the photo");
  applyLook(item, look);
  await store.put("items", item);
  return look;
}
const unlooked = () => state.items.filter((i) => !i.look && i.photos?.length && slotOf(i) !== "under");
// Pieces saved before: one small request each (about 350 tokens), then suits are paired up.
async function lookAll() {
  const todo = unlooked();
  let done = 0, err = "";
  for (const [k, it] of todo.entries()) {
    toast(`Looking at the photos… ${k + 1} of ${todo.length}`);
    try { await lookAt(it); done++; } catch (e) { err = e.message || "Couldn't look at the photo"; break; }
  }
  const linked = await autoLinkSuits();
  state.outfits = [];
  tasteMemo = null;
  toast(`${done || !err ? `Looked at ${done} piece${done === 1 ? "" : "s"}` : err}${linked.length ? `; linked ${linked.join(" and ")} as one suit` : ""}${done && err ? `. Stopped: ${err}` : ""}`);
  render();
}

/* ---------- Suits ----------
   A suit saved as two pieces: the jacket and the trousers share `suit` (an id), and both carry the
   tag "suit" so the fashion bible sees it too. Linked by hand on either piece, or by the app when
   the AI saw exactly one jacket and one pair of trousers of a suit in the same colour. */
async function linkSuit(a, b) {
  const id = a.suit || b.suit || uid();
  for (const it of [a, b]) {
    it.suit = id;
    if (!(it.tags || []).includes("suit")) it.tags = [...(it.tags || []), "suit"];
    await store.put("items", it);
  }
}
async function unlinkSuit(it) {
  for (const x of state.items.filter((x) => x.suit && x.suit === it.suit)) {
    delete x.suit;
    x.tags = (x.tags || []).filter((t) => t !== "suit");
    await store.put("items", x);
  }
}
const suitMate = (it) => it.suit && state.items.find((x) => x !== it && x.suit === it.suit);
// The other half a piece could form a suit with: trousers for a jacket and the other way round,
// the same main colour first.
function suitCandidates(it) {
  const want = it.category === "jacket" ? "trousers" : it.category === "trousers" ? "jacket" : null;
  if (!want) return [];
  return state.items.filter((x) => x.category === want && !x.suit).sort((a, b) => (b.colors?.[0] === it.colors?.[0]) - (a.colors?.[0] === it.colors?.[0]));
}
async function autoLinkSuits() {
  const halves = (cat) => state.items.filter((i) => i.category === cat && !i.suit && i.look?.suitPart);
  const linked = [];
  for (const j of halves("jacket")) {
    const same = halves("trousers").filter((t) => t.colors?.[0] === j.colors?.[0] && (t.look.material === j.look.material || [t.look.material, j.look.material].includes("other")));
    const rivals = halves("jacket").filter((x) => x.colors?.[0] === j.colors?.[0]);
    if (same.length === 1 && rivals.length === 1) { await linkSuit(j, same[0]); linked.push(j.name, same[0].name); }
  }
  return linked;
}

// Recognise type, colours, brand and style from one photo (and what it looks like, see above).
const TAG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "category", "colors", "brand", "styles", "fit", "warmth", "tags", "front_top", "back_top", ...Object.keys(LOOK_FIELDS)],
  properties: {
    name: { type: "string", description: "Short name, e.g. 'Navy cable-knit sweater'" },
    category: { type: "string", enum: CATS.map((c) => c.id), description: "Use the gym types (gym-top, leggings, training-shoes…) only for clothes made for training" },
    colors: { type: "array", items: { type: "string", enum: Object.keys(COLORS) }, description: "Main colour first, at most 3" },
    brand: { type: "string", description: "Brand from a visible logo, label or very distinctive design; empty if unsure" },
    styles: { type: "array", items: { type: "string", enum: Object.keys(STYLES) }, description: "1 to 3 styles, best first" },
    fit: { type: "string", enum: [...Object.keys(FITS), "none"], description: "How it fits on the body: tops slim/regular/relaxed/oversized/cropped, bottoms slim/straight/regular/relaxed/baggy/wide; none for shoes and accessories" },
    warmth: { type: "integer", description: "1 very light to 5 winter" },
    tags: { type: "array", items: { type: "string" }, description: "Up to 4 short lowercase tags, e.g. graphic, knit, logo, cargo" },
    front_top: { type: "string", enum: ["up", "right", "down", "left"], description: "In the front photo, which way the collar, hood or waistband points" },
    back_top: { type: "string", enum: ["up", "right", "down", "left"], description: "Same for the back photo; 'up' if there is none" },
    ...LOOK_FIELDS,
  },
};
// Clockwise turn that brings the collar or waistband to the top.
const TURN_FOR = { up: 0, right: 270, down: 180, left: 90 };
async function aiTagPhoto(front, back) {
  const text = await aiGenerate({
    system: "You catalogue clothing for a wardrobe app. Reply with JSON only.",
    text: back
      ? "Catalogue this garment. Left: its front. Right: its back. Recognise the brand if a logo or label is visible and describe its style."
      : "Catalogue this garment. Recognise the brand if a logo or label is visible and describe its style.",
    image: await aiImage(front, back),
    schema: TAG_SCHEMA,
    maxTokens: 440,
  });
  return JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
}

/* ======================================================================
   Views
   ====================================================================== */
const main = $("#main");
let view = "today";
let draft = null; // item being added / edited

function go(v) {
  if (v === "wardrobe") state.wardView = null;
  if (v !== "add" && scentDraft && !scentDraft.id && !scentDraft.name.trim() && !scentDraft.photos.length) scentDraft = null; // started, nothing in it
  view = v;
  document.querySelectorAll(".tab").forEach((b) => (b.dataset.view === v ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  render();
  main.scrollTop = 0;
}
function render() {
  ({ today: renderToday, wardrobe: renderWardrobe, add: renderAdd, shop: renderShop, settings: renderSettings })[view]();
  watchTiles();
}

/* ---------- Today ---------- */
function renderToday() {
  const w = state.weather;
  const cond = conditions();
  const greet = new Date().getHours() < 12 ? "Good morning" : new Date().getHours() < 18 ? "Good afternoon" : "Good evening";
  const dateStr = new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });

  if (!state.items.length) {
    main.innerHTML = `
      <div class="head"><div><h1>${greet}</h1><p class="sub">${esc(dateStr)}</p></div></div>
      ${emptyState("Your wardrobe is empty", "Add your first piece, or load the sample wardrobe from your photos.", `<button class="btn primary" data-go="add">Add clothes</button><button class="btn" data-act="seed">Load sample wardrobe</button>`)}`;
    return;
  }
  if (!state.outfits.length) { autoPickEvent(); generateOutfits(); }

  const weatherHtml = w?.typical
    ? `<div class="weather"><div class="temp">${fmtTemp(state.manualTemp ?? w.temp)}</div>
        <div class="wx"><b>${state.manualTemp != null ? "Manual temperature" : `Usual ${esc(MONTH())} weather`}</b>
        <span class="muted small">${esc(state.settings.city)} · usually ${fmtTemp(w.min)}–${fmtTemp(w.max)} · live weather shows once the app is online</span></div></div>`
    : w
    ? `<div class="weather"><div class="temp">${fmtTemp(state.manualTemp ?? w.temp)}</div>
        <div class="wx"><b>${state.manualTemp != null ? "Manual temperature" : esc(WMO(w.code))}</b>
        <span class="muted small">${esc(state.settings.city)} · feels ${fmtTemp(w.feels)} · ${fmtTemp(w.min)}–${fmtTemp(w.max)} · rain ${w.rainChance}%</span></div></div>`
    : `<div class="weather"><div class="temp">${fmtTemp(cond.feels)}</div><div class="wx"><b>No weather yet</b><span class="muted small">${state.settings.lat == null ? "Set your city in Settings for live weather." : "Weather can't load here right now. Set how it feels with the slider below."}</span></div></div>`;

  main.innerHTML = `
    <div class="head">
      <div><h1>${greet}</h1><p class="sub">${esc(dateStr)}</p></div>
      <button class="btn" data-act="shuffle"><svg viewBox="0 0 24 24"><path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>New ideas</button>
    </div>
    ${safeMirrorHTML()}
    <div class="stack">
      <div class="card row" style="justify-content:space-between">
        ${weatherHtml}
        <div class="field" style="min-width:min(260px,100%);flex:1;max-width:420px">
          <label for="temp-slider">Feels like ${fmtTemp(cond.feels)}${state.manualTemp != null ? ' · <a href="#" data-act="autotemp" style="color:var(--accent)">use weather</a>' : ""}</label>
          <input id="temp-slider" type="range" min="-10" max="35" step="1" value="${Math.round(cond.feels)}" data-input="temp">
        </div>
      </div>
      ${dayCard()}
      ${rateCard()}
      <div class="chips scroller">${OCCASIONS.map((o) => `<button class="chip" aria-pressed="${state.occasion === o.id}" data-occ="${o.id}">${o.label}</button>`).join("")}</div>
      ${levelChips()}
      ${anchorBar()}
      ${levelGapLine()}
      ${boughtLine()}
      ${state.onlyNote && !state.anchor ? `<p class="muted small" style="margin:0">${esc(state.onlyNote)}</p>` : ""}
      <div class="outfits">${state.outfits.map((o, i) => outfitCard(o, i)).join("") || `<p class="muted">Add a few more tops to get outfit ideas.</p>`}</div>
      ${laundryLine()}
      <p class="muted small" style="margin:0">${esc(tasteLine())}</p>
      ${aiCard()}
    </div>`;
  mountMirror();
}
const ICON_CAL = `<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>`;
// What's on today (and tomorrow, in the evening). Tap an event to dress for it; tap its
// occasion to change it, which is remembered for that event name.
function dayCard() {
  if (!state.calendar.links?.length) return "";
  const { today: t, tomorrow: tm } = dayEvents();
  const errors = Object.values(state.cal.errors || {});
  const row = (e) => {
    const at = eventWeather(e);
    const when = e.allDay ? "All day" : `${fmtTime(e.start)}–${fmtTime(e.end)}`;
    return `<div class="event" aria-current="${state.event?.key === e.key}">
      <button class="event-main" data-event="${esc(e.key)}"><b>${when}</b><span class="event-title">${esc(e.title)}</span>${at && !e.allDay ? `<span class="muted small">feels ${fmtTemp(at.feels)}${at.wet ? ", rain" : ""}</span>` : ""}</button>
      <button class="chip" data-evocc="${esc(e.key)}" aria-pressed="${state.editingEvent === e.key}">${esc(occLabel(e.occasion))}</button>
    </div>
    ${state.editingEvent === e.key ? `<div class="chips event-occ"><span class="muted small">Dress for “${esc(e.title)}” as:</span>${[...OCCASIONS.map((o) => o.id), "skip"].map((id) => `<button class="chip" aria-pressed="${e.occasion === id}" data-setevocc="${esc(e.key)}|${id}">${esc(occLabel(id))}</button>`).join("")}</div>` : ""}`;
  };
  const block = (label, list) => (list.length ? `<div class="stack" style="gap:6px"><span class="muted small event-day">${label}</span>${list.map(row).join("")}</div>` : "");
  const body = t.length || tm.length
    ? block("Today", t) + block("Tomorrow", tm)
    : `<span class="muted small">${state.cal.loading && !state.cal.at ? "Reading your calendar…" : "Nothing else in your calendar today."}</span>`;
  return `<section class="card day-card stack" style="gap:10px">
    <div class="row" style="justify-content:space-between"><h2 style="margin:0;display:flex;gap:8px;align-items:center">${ICON_CAL}Your day</h2>
      ${state.event ? `<span class="muted small">Ideas for <b>${esc(state.event.title)}</b>${state.event.day === "tomorrow" ? " tomorrow" : ""}</span>` : `<button class="linkish small" data-disc="events">Plan for later events</button>`}</div>
    ${body}
    ${errors.length ? `<p class="small" style="margin:0;color:var(--danger)">${esc(errors[0])}</p>` : ""}
  </section>`;
}
// Pieces marked Bought on Must-Buy that never made it into the wardrobe: no piece was added from them,
// and no piece of the same type (and colour) was added since they went on Must-Buy. Asked about two days later; "Not yet"
// asks again in three days. `all`: also the ones bought less than two days ago or put off.
function pendingBuys(all = false) {
  return state.wants.filter((w) => w.status === "bought" && w.kind !== "fragrance" && CAT[w.cat] && !w.boughtItemId &&
    !state.items.some((i) => i.category === w.cat && (i.createdAt || "") >= (w.createdAt || w.decidedAt || "") && (!w.color || !COLORS[w.color] || (i.colors || []).includes(w.color))) &&
    (all || (daysSince(w.decidedAt) >= 2 && !(w.askAfter && Date.now() < Date.parse(w.askAfter)))));
}
// A bought piece as a wardrobe piece, for LEVEL_NEEDS' tests.
const fillsNeed = (w, has) => has({ category: w.cat, name: w.title, tags: [], styles: w.styles || [], formality: 3, colors: [w.color] });
function boughtLine() {
  // Not when the level card above already offers to add it.
  const w = pendingBuys().find((x) => !state.levelGap?.needs?.some(([, , has]) => fillsNeed(x, has)));
  if (!w) return "";
  return `<div class="card stack" style="gap:8px"><span>Did the <b>${esc(w.title.toLowerCase())}</b> you bought arrive? Add ${/s$/.test(w.title) ? "them" : "it"} and your outfit ideas can use ${/s$/.test(w.title) ? "them" : "it"}.</span>
    <div class="chips"><button class="chip" data-addbought="${w.id}">Add ${/s$/.test(w.title) ? "them" : "it"}</button><button class="chip" data-boughtlater="${w.id}">Not yet</button><button class="chip" data-boughtback="${w.id}">I sent ${/s$/.test(w.title) ? "them" : "it"} back</button></div></div>`;
}
function laundryLine() {
  const n = inWash().length;
  if (!n) return "";
  // In the wash for two days or more: probably clean by now (loved pieces first). "Not yet" asks again tomorrow.
  const due = state.settings.washAskedOn === today() ? [] : inWash().filter((i) => daysSince(i.wash) >= 2).sort((a, b) => (starsOf(b) || 0) - (starsOf(a) || 0));
  if (due.length) return `<div class="card stack laundry-back" style="gap:8px"><b>Back from the wash?</b>
    <div class="chips">${due.map((i) => `<button class="chip" data-washback="${i.id}">${esc(i.name)}</button>`).join("")}</div>
    <div class="row"><button class="btn" data-act="wash-done">All ${n} back</button><button class="btn" data-act="wash-later">Not yet</button><span class="muted small">Tap what's clean. Pieces in the wash are left out of these ideas.</span></div></div>`;
  return `<div class="row laundry-row"><span class="muted small">${n} piece${n === 1 ? " is" : "s are"} in the wash and left out of these ideas.</span><button class="chip" data-act="see-wash">See them</button><button class="chip" data-act="wash-done">Laundry done</button></div>`;
}
// Five stars to tap. `key` says what is rated ("o|<card>", "i|<piece id>", "w|<wear id>"); the same star again takes the rating off.
const starPicker = (key, current = 0) => `<div class="stars" role="group" aria-label="Your rating">${[1, 2, 3, 4, 5].map((n) => `<button class="star" aria-pressed="${n <= current}" aria-label="${n} star${n > 1 ? "s" : ""}: ${STAR_WORDS[n]}" data-stars="${key}|${n}">${n <= current ? "★" : "☆"}</button>`).join("")}<span class="muted small">${current ? STAR_WORDS[current] : "1 hate it · 5 love it"}</span></div>`;
// The outfit you wore yesterday (or the day before), until you rate it or skip it.
function rateDue() {
  const rated = new Set(state.log.filter((l) => l.kind === "rate" && l.wearId).map((l) => l.wearId));
  const byId = new Map(state.items.map((i) => [i.id, i]));
  return state.log
    .filter((l) => logKind(l) === "wear" && l.occasion && !l.rateSkip && l.date !== today() && daysSince(l.at || l.date) <= 2 && !rated.has(l.id) &&
      (l.itemIds || []).filter((id) => byId.has(id) && CORE.includes(roleOf(byId.get(id)))).length >= 2)
    .sort((a, b) => String(b.at || b.date).localeCompare(String(a.at || a.date)))[0];
}
function rateCard() {
  const l = rateDue();
  if (!l) return "";
  const pieces = l.itemIds.map((id) => state.items.find((i) => i.id === id)).filter((p) => p && CORE.includes(roleOf(p)));
  const yesterday = new Date(Date.now() - 864e5).toISOString().slice(0, 10);
  return `<section class="card rate-card">
    <div class="pieces mini">${pieces.map(pieceTile).join("")}</div>
    <div class="stack" style="gap:8px">
      <h2 style="margin:0">How did ${l.date === yesterday ? "yesterday's" : "your last"} outfit feel?</h2>
      <span class="muted small">${esc(occLabel(l.occasion))}${l.feels != null ? ` · ${fmtTemp(l.feels)}` : ""}${l.event ? ` · ${esc(l.event)}` : ""}</span>
      <div class="row">${starPicker(`w|${l.id}`)}<button class="chip" data-stars="w|${l.id}|0">Skip</button></div>
    </div>
  </section>`;
}
const ICON_HEART = `<svg viewBox="0 0 24 24"><path d="M12 20s-7.5-4.6-9.3-9.4C1.5 7.3 3.6 4 7 4c2.1 0 3.6 1.2 5 3 1.4-1.8 2.9-3 5-3 3.4 0 5.5 3.3 4.3 6.6C19.5 15.4 12 20 12 20z"/></svg>`;
const ICON_SWAP = `<svg viewBox="0 0 24 24"><path d="M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/></svg>`;
const DROP_LABEL = { outer: "No jacket", mid: "No layer", base: "No T-shirt" };
// "Start from a piece": you pick what you want to wear, the ideas complete the outfit.
function anchorBar() {
  const a = state.items.find((i) => i.id === state.anchor);
  if (!a) return `<div class="row"><button class="btn" data-act="anchor-pick"><svg viewBox="0 0 24 24"><path d="${KIND_ICON.hanger}"/></svg>Start from a piece</button><span class="muted small">Pick what you want to wear and get outfits built around it.</span></div>`;
  return `<div class="card row anchor-bar">
    <img class="pic-bg" src="${photoURL(a.photos?.[0])}" alt="">
    <span style="flex:1;min-width:0">Ideas built around your <b>${esc(a.name)}</b></span>
    <button class="chip" data-act="anchor-pick">Pick another</button>
    <button class="chip" data-act="anchor-clear">Show all ideas</button>
  </div>`;
}
function openAnchorPicker() {
  const occ = OCCASIONS.find((x) => x.id === state.occasion);
  const by = piecesByRole(occ);
  const groups = [["base", "T-shirts & shirts"], ["mid", "Hoodies & knits"], ["outer", "Outerwear"], ["bottom", "Bottoms"], ["shoes", "Shoes"]].filter(([r]) => by[r].length);
  $(".sheet-panel").innerHTML = `
    <div class="detail-head">
      <div><h1 style="font-size:28px">What do you want to wear?</h1><p class="sub">Pick a piece and the outfit ideas are built around it.</p></div>
      <button class="btn icon-btn ghost" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div>
    <div class="stack">${groups.map(([r, label]) => `<section><h2 style="margin:0 0 10px">${label}</h2><div class="pieces mini anchor-grid">${by[r].map((p) => `<button class="piece" data-anchor="${p.id}" aria-pressed="${state.anchor === p.id}"><img class="pic-bg" src="${photoURL(p.photos?.[0])}" alt=""><span>${esc(p.name)}</span></button>`).join("")}</div></section>`).join("") || `<p class="muted">Add some clothes first.</p>`}</div>`;
  $("#sheet").hidden = false;
}
async function setAnchor(id) {
  const it = state.items.find((i) => i.id === id);
  state.anchor = it ? id : null;
  // A gym piece belongs in a gym outfit, and an everyday piece in an everyday one.
  if (it && (slotOf(it) === "gym") !== (state.occasion === "gym")) state.occasion = slotOf(it) === "gym" ? "gym" : "casual";
  closeSheet();
  generateOutfits();
  if (view !== "today") return go("today");
  render();
}

function swapPicker(o, i) {
  const role = o.swapping;
  const { options, canDrop } = swapOptions(o, role);
  // Every piece of this kind you own, best match first; with several types (jeans, shorts…)
  // a chip per type narrows the list.
  const cats = [...new Set(options.map((p) => p.category))];
  const cat = cats.includes(o.swapCat) ? o.swapCat : "all";
  const shown = options.filter((p) => cat === "all" || p.category === cat);
  const top = new Set(options.slice(0, 3).map((p) => p.id));
  return `<div class="swap-pick stack" style="gap:8px">
    <span class="muted small">Instead of the ${esc(o.pieces[role]?.name)}: all ${options.length} option${options.length === 1 ? "" : "s"}, best match first.</span>
    ${cats.length > 1 ? `<div class="chips"><button class="chip" aria-pressed="${cat === "all"}" data-swapcat="${i}:all">All</button>${cats.map((c) => `<button class="chip" aria-pressed="${cat === c}" data-swapcat="${i}:${c}">${esc(catLabel(c))} <span class="muted">${options.filter((p) => p.category === c).length}</span></button>`).join("")}</div>` : ""}
    <div class="pieces mini">${shown.map((p) => `<button class="piece" data-swapto="${i}:${role}:${p.id}">${top.has(p.id) ? `<em class="best">Best match</em>` : ""}<img class="pic-bg" src="${photoURL(p.photos?.[0])}" alt=""><span>${esc(p.name)}</span></button>`).join("")}</div>
    ${!options.length ? `<span class="muted small">Nothing else of this kind for this occasion yet.</span>` : ""}
    <div class="chips">${canDrop ? `<button class="chip" data-swapto="${i}:${role}:">${DROP_LABEL[role]}</button>` : ""}${state.anchor !== o.pieces[role]?.id ? `<button class="chip" data-anchor="${o.pieces[role]?.id}">Keep it, build around it</button>` : ""}<button class="chip" data-swap="${i}:${role}">Cancel</button></div>
  </div>`;
}
// One accessory you don't own that would finish the best idea (a belt with trousers, a watch on smart days).
// Once answered (Must-Buy or no), it doesn't come back. Settings > Look turns it off.
function finishingTouch(o) {
  if (state.settings.touches === false) return "";
  const pieces = Object.values(o.pieces).filter(Boolean);
  const occ = OCCASIONS.find((x) => x.id === state.occasion);
  if (!occ || occ.id === "gym") return "";
  const shoes = o.pieces.shoes?.colors?.[0];
  const a = ACC_KIT.find((x) => !state.items.some((i) => i.category === x.cat) && (!x.when || x.when(pieces)) && (!x.occs || x.occs.includes(occ.id)) && (!x.seasons || x.seasons.includes(seasonNow())) && x.cat !== "tie");
  if (!a) return "";
  const color = a.cat === "belt" && ["black", "brown"].includes(shoes) ? shoes : a.colors[0];
  const b = mkIdea({ cat: a.cat, color, noun: a.noun });
  if (wantOf(b)) return "";
  const data = esc(JSON.stringify({ title: b.title, cat: b.cat, noun: b.noun, color: b.color, query: b.query, why: a.why, source: "touch" }));
  return `<div class="touch"><span>Finish it with a <b>${esc(b.title.toLowerCase())}</b>. You don't have one.</span><button class="chip" data-yes="${data}">Add to Must-Buy</button><button class="chip" data-no="${data}" data-quiet="1">No thanks</button></div>`;
}
// Elegance: Auto (the occasion's levels) or one level picked by hand, for today's ideas.
function levelChips() {
  const r = OCC_LEVELS[state.occasion];
  if (!r || !Style.ready()) return "";
  const auto = r[0] === r[2] ? `${r[0]}` : `${r[0]}–${r[2]}`;
  return `<div class="chips scroller levels"><span class="muted small">Elegance</span><button class="chip" aria-pressed="${!state.level}" data-level="0">Auto (${auto})</button>${Object.entries(LEVELS).map(([n, l]) => `<button class="chip" aria-pressed="${state.level === +n}" data-level="${n}">${n} ${l}</button>`).join("")}</div>`;
}
// Nothing you own reaches the occasion's level: say so, and what would get there.
function levelGapLine() {
  const g = state.levelGap;
  if (!g) return "";
  const occ = OCCASIONS.find((o) => o.id === state.occasion).label;
  const what = state.level ? `level ${g.want} (${LEVELS[g.want]})` : `${occ} (level ${g.want}, ${LEVELS[g.want]})`;
  const list = (sep) => g.needs.map(([, l]) => esc(l)).join(sep);
  const washing = g.washing || [];
  const washLine = washing.length ? `Your ${washing.map((p) => esc(p.name)).join(" and ")} ${washing.length > 1 ? "are" : "is"} in the wash, so these ideas don't reach ${esc(LEVELS[g.want])}.` : "";
  const line = washing.length ? `${washLine}${g.needs.length ? ` You'd also need ${list(" and ")}.` : ""}` : g.short
    ? `These ideas reach ${esc(LEVELS[g.top])}. For ${esc(occ)} at its best (${esc(LEVELS[g.want])}) you'd need ${list(" and ")}.`
    : `None of your clothes make ${esc(what)} yet, so these are the dressiest you have (${esc(LEVELS[g.top])}).`;
  // A piece you bought on Must-Buy and haven't added yet fills the need: add it instead of finding one.
  const bought = (has) => pendingBuys(true).find((w) => fillsNeed(w, has));
  const chips = g.needs.map(([chip, l, has]) => { const w = bought(has); return w ? `<button class="chip" data-addbought="${w.id}">Add the ${esc(w.title.toLowerCase())} you bought</button>` : `<button class="chip" data-needgo="${esc(chip)}">Find ${esc(l)}</button>`; });
  chips.push(...washing.map((p) => `<button class="chip" data-washback="${p.id}">${esc(cap(p.name))} is back from the wash</button>`));
  return `<div class="card stack" style="gap:8px"><span>${line}</span>${g.needs.length && !g.short && !washing.length ? `<span class="muted small">Missing: ${list(", ")}.</span>` : ""}${chips.length ? `<div class="chips">${chips.join("")}</div>` : ""}</div>`;
}
const levelBadge = (o) => {
  if (!Style.ready() || !o.pieces) return "";
  const n = dressLevel(Object.values(o.pieces).filter(Boolean));
  return `<span class="level" title="Elegance level ${n} of 5">${"●".repeat(n)}${"○".repeat(5 - n)} ${LEVELS[n]}</span>`;
};
function outfitCard(o, i) {
  const order = ["outer", "mid", "base", "bottom", "shoes"];
  const ph = (o.missing || []).map((m) => `<button class="piece" data-go="shop"><div class="ph">${kindIcon(SLOT_ICON[m])}<small>No ${SLOTS[m].toLowerCase()} yet<br>tap to shop</small></div><span>${SLOTS[m]}</span></button>`).join("");
  return `<article class="card outfit">
    <div class="row" style="justify-content:space-between"><h2 style="margin:0">${o.planned ? (o.planned.eventId ? `Planned for ${esc(o.planned.title)}` : `Planned last night${o.planned.title ? `: ${esc(o.planned.title)}` : ""}`) : ["Best match", "Option 2", "Option 3"][i] || "Option"}</h2>${levelBadge(o)}${o.planned ? '<span class="score">Your plan</span>' : i === 0 ? '<span class="score">Top<span class="wide"> pick</span></span>' : ""}</div>
    <div class="pieces">${order.filter((k) => o.pieces[k]).map((k) => `<div class="swap-wrap">${pieceTile(o.pieces[k])}<button class="swap-btn" data-swap="${i}:${k}" aria-pressed="${o.swapping === k}" aria-label="Swap the ${esc(o.pieces[k].name)}">${ICON_SWAP}</button></div>`).join("")}${ph}</div>
    ${o.swapping ? swapPicker(o, i) : ""}
    ${o.coat || o.extras?.length ? `<div class="pieces extras">${[o.coat, ...(o.extras || [])].filter(Boolean).map(pieceTile).join("")}</div>` : ""}
    ${o.reasons.length || o.extrasWhy?.length ? `<p class="why">${[...o.reasons, ...(o.extrasWhy || [])].map(esc).join(" · ")}</p>` : ""}
    ${o.warn?.length ? `<p class="why warn">Heads up: ${o.warn.map(esc).join(" · ")}</p>` : ""}
    ${o.noDressShoes ? `<p class="why">Best with dress shoes: you don't have any yet.</p>` : ""}
    ${i === 0 && !o.planned ? finishingTouch(o) : ""}
    ${i > 0 && sharedScent() ? "" : todayScent(o)}
    ${o.asking
      ? `<div class="stack" style="gap:8px"><span class="muted small">What's off? The next ideas take it into account.</span><div class="chips">${SKIP_REASONS.map(([k, l]) => `<button class="chip" data-skipwhy="${i}:${k}">${l}</button>`).join("")}<button class="chip" data-skip="${i}" data-cancel="1">Cancel</button></div></div>`
      : `<div class="row outfit-actions">
          ${state.event?.day === "tomorrow" ? `<button class="btn primary" data-plan="${i}">Plan it for tomorrow</button>` : `<button class="btn primary" data-wear="${i}">Wear this today</button>`}
          <button class="btn rate${o.stars ? "" : " icon-btn"}" data-rate="${i}" aria-pressed="${!!o.stars}" aria-expanded="${!!o.rating}" aria-label="${o.stars ? `Rated ${o.stars} stars, change` : "Rate this outfit"}">${o.stars ? `★ ${o.stars}` : "☆"}</button>
          <button class="btn ghost" data-skip="${i}">Not for me</button>
        </div>
        ${o.rating ? starPicker(`o|${i}`, o.stars) : ""}`}
  </article>`;
}
function aiCard() {
  return `<section class="card ai-box">
    <h2 style="margin:0">Ask the stylist</h2>
    <p class="muted small" style="margin:0">${aiReady() ? `Ask anything about your clothes. Answers come from ${aiName()}.` : "Optional: add a Gemini or Claude API key in Settings for free-form styling advice. Outfit ideas above work without it."}</p>
    <div class="chips">
      ${["3 outfits for today", "What should I wear for a dinner date?", "Which pieces should I donate?", "Build me a capsule for a weekend trip"].map((q) => `<button class="chip" data-ask="${esc(q)}">${esc(q)}</button>`).join("")}
    </div>
    <div class="row"><input id="ask-input" class="input" style="flex:1;min-width:0" placeholder="Ask about your wardrobe…" data-input="ask"><button class="btn primary" data-act="ask">Ask</button></div>
    <div class="ai-answer" id="ai-answer">${answerHTML(state.aiAnswer)}</div>
  </section>`;
}

/* ---------- Mirror: you, wearing today's ideas (see tryon.js) ---------- */
// The top of Today: your body on the left, you in the middle (drag to turn), today's ideas on the
// right with what you're wearing, each piece can come off. the image model draws you once from four sides
// (Save Body), then each outfit on those pictures; every picture is kept on the server under a
// hash of body + pieces + angle, so no combination is drawn twice.
const mirror = {
  draft: null, // the body on the sliders; the saved one is state.avatar.body
  pick: 0, // which of today's ideas he wears
  angle: 0, // 0 front, 1 right, 2 back, 3 left
  off: {}, // per idea key: the roles taken off ("outer", "shoes"…)
  combos: [], // per idea: { list, pieces, keys } (see mirrorRefresh)
  now: null, // what he wears now: an idea, or one with pieces taken off ({ ..., custom })
  sig: "", // the last combination shown, to start a new one from the front
  shown: {}, // per angle: the last dressed picture shown, kept on him while the next one is drawn
  shownFor: null, // the avatar those pictures are of
  run: 0,
};
const MIRROR_ROLES = ["outer", "mid", "base", "bottom", "shoes"];
const ROLE_WORD = { coat: "Coat", outer: "Jacket", mid: "Layer", base: "Top", bottom: "Bottoms", shoes: "Shoes" };
const tryonCount = { day: "", n: 0, month: "", m: 0 };
let deviceId = "";

// Pictures are drawn by Cloudflare Workers AI on your server (free daily allocation), so only the hosted app can make them.
const tryonKey = () => !!state.serverKeys.image;
const tryonCap = () => Math.max(0, Math.round(state.settings.tryonCap ?? 40));
function tryonSpent() {
  const d = localDay(), m = d.slice(0, 7);
  if (tryonCount.day !== d) Object.assign(tryonCount, { day: d, n: 0 });
  if (tryonCount.month !== m) Object.assign(tryonCount, { month: m, m: 0 });
  return tryonCount;
}
TryOn.init({
  post: (form) => fetch("api/ai/image", { method: "POST", body: form }),
  server: () => sync.status === "on",
  get me() { return deviceId; },
  budget: {
    // Pictures nobody has asked to see yet stop at three quarters of the daily limit, so there's room for the ones you pick.
    ok: (background) => tryonSpent().n < (background ? Math.floor(tryonCap() * 0.75) : tryonCap()),
    why: () => `Today's limit of ${tryonCap()} try-on pictures is used up on this device. Change it in Settings > Try-on.`,
    spend: () => { const c = tryonSpent(); c.n++; c.m++; raw.put("kv", { ...c }, "tryonCount"); },
  },
  onChange: () => {
    if (!mirror.frame) mirror.frame = requestAnimationFrame(() => { mirror.frame = 0; try { paintMirror(); } catch (e) { console.error("Mirror:", e); } });
  },
});
async function loadTryOn() {
  Object.assign(tryonCount, (await raw.get("kv", "tryonCount")) || {});
  deviceId = (await raw.get("kv", "deviceId")) || "";
  if (!deviceId) { deviceId = uid(); await raw.put("kv", deviceId, "deviceId"); }
}

const bodyDraft = () => (mirror.draft ||= TryOn.cleanBody({ age: state.settings.age, ...TryOn.cleanBody(state.avatar?.body || {}) }));
function wornList(o) {
  if (!o) return [];
  return [...(o.coat ? [{ role: "coat", item: o.coat }] : []), ...MIRROR_ROLES.filter((r) => o.pieces[r]).map((r) => ({ role: r, item: o.pieces[r] }))];
}
const mirrorOff = (o) => (o && mirror.off[o.key]) || [];
// What you'd log with "Wear this today" from the mirror: the idea without the pieces taken off.
function mirrorWorn(o) {
  const offIds = new Set(wornList(o).filter((x) => mirrorOff(o).includes(x.role)).map((x) => x.item.id));
  return allPieces(o).filter((p) => !offIds.has(p.id));
}
const asBlob = async (x) => (x instanceof Blob ? x : x ? fetch(x).then((r) => r.blob()).catch(() => null) : null);
async function tryonPiece({ role, item }) {
  const [front, back] = await Promise.all([asBlob(item.photos?.[0]), asBlob(item.photos?.[1])]);
  return {
    role, id: item.id, name: item.name, kind: catLabel(item.category).toLowerCase(), fit: FITS[item.fit]?.label, colors: item.colors || [], front, back,
    photo: front ? (await blobKey(front)).split(".")[0] : "",
  };
}
async function comboFor(list) {
  const pieces = await Promise.all(list.map(tryonPiece));
  return { list, pieces, keys: TryOn.comboKeys(state.avatar.id, pieces) };
}
const specKeys = (spec) => [spec.key, ...spec.deps.flatMap(specKeys)];

// Work out what he wears and which pictures it needs, then ask for them, most wanted first:
// the base sheet, the angle you're looking at, the rest of this outfit, then the other ideas.
// `user`: you just picked, turned or took something off. New ideas that came by themselves (the
// weather loading, the calendar) wait a moment first, in case they change again straight away.
async function mirrorRefresh(user = false) {
  const run = ++mirror.run;
  const av = state.avatar;
  if (!av || !tryonKey() || !["on", "off"].includes(sync.status)) { mirror.now = null; return paintMirror(); }
  const ideas = state.outfits.slice(0, 3);
  mirror.pick = Math.min(mirror.pick, Math.max(0, ideas.length - 1));
  for (const k of Object.keys(mirror.off)) if (!ideas.some((o) => o.key === k)) delete mirror.off[k];
  const o = ideas[mirror.pick], off = mirrorOff(o);
  const combos = await Promise.all(ideas.map((x) => comboFor(wornList(x))));
  const now = !o ? await comboFor([]) : off.length ? await comboFor(wornList(o).filter((x) => !off.includes(x.role))) : combos[mirror.pick];
  if (run !== mirror.run || state.avatar !== av) return;
  mirror.combos = combos;
  mirror.now = { ...now, custom: off.length > 0 };
  // A combination not drawn yet starts from the front, which is drawn first.
  if (now.keys.front !== mirror.sig) { mirror.sig = now.keys.front; if (!TryOn.url(now.keys.front)) mirror.angle = 0; }
  const wanted = [];
  const ask = (pieces, angle, prio, background) => {
    const spec = TryOn.outfitSpec(av.id, av.body, pieces, angle);
    wanted.push(...specKeys(spec));
    TryOn.want(spec, prio, background);
  };
  TryOn.ANGLES.forEach((a) => ask([], a, a === "front" ? 0 : 1, false)); // the base sheet from Save Body
  const dress = () => {
    if (run !== mirror.run) return;
    const cur = TryOn.ANGLES[mirror.angle];
    ask(now.pieces, cur, 2, false);
    TryOn.ANGLES.forEach((a) => a !== cur && ask(now.pieces, a, 3, false));
    if (state.settings.tryon !== false) {
      combos.forEach((c, i) => {
        if (i === mirror.pick && !off.length) return;
        TryOn.ANGLES.forEach((a) => ask(c.pieces, a, a === "front" ? 4 + i * 0.1 : 5 + i * 0.1, true));
      });
    }
    TryOn.keepOnly(wanted);
    paintMirror();
  };
  const set = [now.keys.front, ...combos.map((c) => c.keys.front)].join();
  clearTimeout(mirror.later);
  if (set !== mirror.set && !user) {
    mirror.set = set;
    TryOn.keepOnly(wanted); // what was waiting for the old ideas is dropped now
    mirror.later = setTimeout(dress, 2500);
    return paintMirror();
  }
  mirror.set = set;
  dress();
}

const SILHOUETTE = `<svg class="tt-ghost" viewBox="0 0 120 300" aria-hidden="true"><circle cx="60" cy="30" r="17"/><path d="M60 52c-17 0-30 6-33 16l-8 70c-1 7 9 9 11 2l9-58v74l-4 128c0 8 13 8 14 0l9-112h4l9 112c1 8 14 8 14 0l-4-128V82l9 58c2 7 12 5 11-2l-8-70c-3-10-16-16-33-16z"/></svg>`;
// The left panel: your photo, then Body (height, weight, build, skin) or Face & hair, and Save Body.
function bodyPanelHTML() {
  const b = bodyDraft(), tab = mirror.bodyTab || "body";
  const range = (k, label, min, max, val, shown) => `<div class="field mb-field"><label for="mb-${k}">${label} <b id="mb-${k}-v">${esc(shown)}</b></label><input id="mb-${k}" type="range" min="${min}" max="${max}" step="1" value="${val}" data-input="mb-${k}"></div>`;
  const swatches = (field, label, list, val) => `<div class="field mb-field"><label>${label}</label><div class="swatch-row">${list.map((x, i) => {
    const v = x.id ?? i;
    return `<button class="swatch" style="--sw:${x.hex}" data-mb="${field}" data-v="${v}" aria-pressed="${val === v}" aria-label="${esc(x.words)}"></button>`;
  }).join("")}</div></div>`;
  const chips = (field, label, list, val) => `<div class="field mb-field"><label>${label}</label><div class="mb-chips">${list.map((x) =>
    `<button class="chip" data-mb="${field}" data-v="${x.id}" aria-pressed="${val === x.id}">${x.label}</button>`).join("")}</div></div>`;
  const pic = b.photo && TryOn.photo(b.photo);
  const photo = b.photo
    ? `<div class="mb-photo"><span class="mb-face">${pic ? `<img src="${pic}" alt="Your photo">` : ""}</span><span class="mb-photo-text"><b>Your photo</b><span class="muted small">${mirror.reading ? "Reading it…" : "Sets your face"}</span></span><button class="chip" data-act="body-photo-off">Remove</button></div>`
    : "";
  return `<aside class="mirror-side mirror-body" aria-label="Your body">
      <div class="mb-head"><h2>You</h2>${b.photo ? "" : `<button class="chip mb-photo-btn" data-act="body-photo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>From a photo</button>`}</div>
      ${photo}
      <div class="seg mb-tabs" role="tablist">${[["body", "Body"], ["face", "Face & hair"]].map(([k, l]) => `<button role="tab" aria-selected="${tab === k}" data-mbtab="${k}">${l}</button>`).join("")}</div>
      ${tab === "body" ? `${range("height", "Height", 160, 200, b.height, `${b.height} cm`)}
      ${range("weight", "Weight", 0, 4, b.weight, TryOn.WEIGHTS[b.weight])}
      ${range("build", "Build", 0, 4, b.build, TryOn.BUILDS[b.build])}
      ${swatches("skin", "Skin tone", TryOn.SKINS, b.skin)}`
      : `<div class="mb-face-tab">${swatches("hairColor", "Hair colour", TryOn.HAIR_COLORS, b.hairColor)}
      ${chips("hairStyle", "Hair", TryOn.HAIR_STYLES, b.hairStyle)}
      ${chips("beard", "Beard", TryOn.BEARDS, b.beard)}
      ${swatches("eyes", "Eyes", TryOn.EYES, b.eyes)}
      ${chips("glasses", "Glasses", [{ id: "no", label: "None" }, { id: "yes", label: "Glasses" }], b.glasses ? "yes" : "no")}</div>`}
      <button class="btn primary" data-act="body-save" id="mb-save">Save body</button>
      <p class="muted small" id="mb-hint" style="margin:0"></p>
    </aside>`;
}
function remountBody() {
  const el = $("#mirror .mirror-body");
  if (!el) return;
  el.outerHTML = bodyPanelHTML();
  bodyUI();
}
// "From a photo": your photo sets the face, and the AI (if there is one) fills in skin, hair, beard and eyes from it.
const bodyPhotoInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", hidden: true });
document.body.append(bodyPhotoInput);
bodyPhotoInput.onchange = () => { const f = bodyPhotoInput.files[0]; bodyPhotoInput.value = ""; if (f) bodyPhoto(f).catch((e) => toast(e.message || "Couldn't use that photo")); };
const FACE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["skin", "hairColor", "hairStyle", "beard", "eyes", "glasses"],
  properties: {
    skin: { type: "string", enum: TryOn.SKINS.map((x) => x.words) },
    hairColor: { type: "string", enum: TryOn.HAIR_COLORS.map((x) => x.words) },
    hairStyle: { type: "string", enum: TryOn.HAIR_STYLES.map((x) => x.id), description: TryOn.HAIR_STYLES.map((x) => `${x.id}: ${x.words.replace("{c} ", "")}`).join("; ") },
    beard: { type: "string", enum: TryOn.BEARDS.map((x) => x.id) },
    eyes: { type: "string", enum: TryOn.EYES.map((x) => x.id) },
    glasses: { type: "boolean", description: "Wears glasses (not sunglasses) in the photo" },
  },
};
async function bodyPhoto(file) {
  if (!tryonKey()) throw new Error("The try-on needs the hosted app.");
  const blob = await resizeImage(file, 1024);
  const b = bodyDraft();
  b.photo = await TryOn.addPhoto(blob);
  mirror.bodyTab = "face";
  mirror.reading = aiReady();
  remountBody();
  if (!mirror.reading) return toast("Your face will come from the photo. Set hair and beard under Face & hair, then tap Save body.");
  try {
    const text = await aiGenerate({
      system: "You describe a person's appearance for an avatar maker. Reply with JSON only.",
      text: "Describe the man in this photo: skin tone, hair colour, hairstyle, beard, eye colour and whether he wears glasses. Pick the closest option for each.",
      image: await resizeImage(blob, 512),
      schema: FACE_SCHEMA,
      maxTokens: 120,
    });
    const r = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
    const at = (list, w) => list.findIndex((x) => x.words === w);
    if (at(TryOn.SKINS, r.skin) >= 0) b.skin = at(TryOn.SKINS, r.skin);
    if (at(TryOn.HAIR_COLORS, r.hairColor) >= 0) b.hairColor = at(TryOn.HAIR_COLORS, r.hairColor);
    Object.assign(b, TryOn.cleanBody({ ...b, hairStyle: r.hairStyle, beard: r.beard, eyes: r.eyes, glasses: !!r.glasses }));
    toast("Filled in from your photo. Check it, then tap Save body.");
  } catch (e) {
    toast(`Couldn't read the photo (${e.message || e}). Set hair and beard yourself.`);
  } finally {
    mirror.reading = false;
    remountBody();
  }
}
function mirrorHTML() {
  const av = state.avatar;
  const ideas = state.outfits.slice(0, 3);
  const o = ideas[Math.min(mirror.pick, Math.max(0, ideas.length - 1))];
  const pick = ideas.indexOf(o);
  const off = mirrorOff(o);
  const stageNote = !tryonKey()
    ? `<b>Try-on runs on your server</b><span>${sync.status === "connecting" ? "Connecting…" : "Pictures are drawn for free by Cloudflare, so open the app from its web address (not the PC copy) to use the try-on."}</span>`
    : !av ? `<b>Make your avatar</b><span>Set your body on the ${innerWidth > 760 ? "left" : "panel below"}, then tap Save Body. You're drawn once from the front, both sides and the back, for free.</span>` : "";
  return `<section class="mirror" id="mirror">
    ${bodyPanelHTML()}
    <div class="mirror-stage">
      <div class="tt${av && tryonKey() ? "" : " empty"}" tabindex="0" role="img" aria-label="You, dressed in the outfit picked on the right. Drag sideways to turn.">
        ${TryOn.ANGLES.map((a) => `<img class="tt-frame" data-angle="${a}" alt="" draggable="false">`).join("")}
        ${SILHOUETTE}
        <div class="tt-scan" aria-hidden="true"></div>
        <div class="tt-note" role="status">${stageNote}</div>
      </div>
      <div class="tt-bar">
        <button class="btn icon-btn ghost" data-tt="-1" aria-label="Turn him to the left"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button>
        <div class="tt-dots">${TryOn.ANGLES.map((a, i) => `<button class="tt-dot" data-tta="${i}" aria-label="${TryOn.ANGLE_LABEL[a]}"><i></i></button>`).join("")}</div>
        <span class="tt-angle muted small"></span>
        <button class="btn icon-btn ghost" data-tt="1" aria-label="Turn him to the right"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button>
      </div>
    </div>
    <aside class="mirror-side mirror-looks" aria-label="Today's ideas">
      <h2>Today's ideas</h2>
      <div class="m-looks">${ideas.map((x, i) => `<button class="m-look" data-mlook="${i}" aria-pressed="${i === pick}">
        <span class="look-pics">${wornList(x).filter((w) => w.role !== "coat").map((w) => `<img src="${photoURL(w.item.photos?.[0])}" alt="">`).join("")}</span>
        <span class="look-text"><b>${x.planned ? "Your plan" : ["Best match", "Option 2", "Option 3"][i]}</b><span class="muted small" data-lookstate="${i}"></span></span>
      </button>`).join("") || `<p class="muted small">Add a few more tops to get outfit ideas.</p>`}</div>
      ${o ? `<h2 class="wearing-head">Wearing</h2>
      <div class="wearing">${wornList(o).map((w) => {
        const on = !off.includes(w.role);
        return `<div class="wear-row${on ? "" : " is-off"}"><img src="${photoURL(w.item.photos?.[0])}" alt=""><span class="wear-name"><b>${esc(w.item.name)}</b><span class="muted small">${ROLE_WORD[w.role]}</span></span><button class="chip" data-mpiece="${w.role}" aria-pressed="${!on}">${on ? "Take off" : "Put on"}</button></div>`;
      }).join("")}</div>
      ${state.event?.day === "tomorrow" ? `<button class="btn primary" data-plan="${pick}">Plan it for tomorrow</button>` : `<button class="btn primary" data-wear="${pick}" data-mirror="1">Wear this today</button>`}` : ""}
    </aside>
  </section>`;
}
function safeMirrorHTML() {
  try { return mirrorHTML(); } catch (e) { console.error("Mirror:", e); return ""; }
}
// Put the mirror on the page again (a new idea picked, a piece taken off) without redrawing the rest of Today.
function remountMirror() {
  const el = $("#mirror");
  if (!el) return;
  el.outerHTML = safeMirrorHTML();
  mountMirror(true);
}
function mountMirror(user = false) {
  try { mountTurntable(user); } catch (e) { console.error("Mirror:", e); } // never in the way of the rest of Today
}
function mountTurntable(user) {
  const tt = $("#mirror .tt");
  if (!tt) return;
  TryOn.turntable(tt, {
    get: () => mirror.angle,
    set: (n) => { mirror.angle = n; paintMirror(); mirrorRefresh(true); },
    paint: setFrames,
  });
  bodyUI();
  paintMirror();
  mirrorRefresh(user).catch((e) => console.error("Mirror:", e));
}
// The four pictures at a position between angles: each fades in as he turns to it.
function setFrames(pos) {
  const w = TryOn.weights(pos);
  document.querySelectorAll("#mirror .tt-frame").forEach((img, i) => {
    let d = ((i - pos) % 4 + 6) % 4 - 2; // -2…2: how far this angle is from the one shown, and on which side
    img.style.opacity = img.getAttribute("src") ? w[i] : 0;
    img.style.transform = `translateX(${(-d * 7).toFixed(2)}%)`;
  });
}
function paintMirror() {
  const root = $("#mirror");
  if (!root) return;
  const av = state.avatar, keys = mirror.now?.keys;
  const base = av && Object.fromEntries(TryOn.ANGLES.map((a) => [a, TryOn.baseKey(av.id, a)]));
  if (mirror.shownFor !== (av?.id || null)) { mirror.shown = {}; mirror.shownFor = av?.id || null; }
  root.querySelectorAll(".tt-frame").forEach((img) => {
    const a = img.dataset.angle;
    // While a new combination is drawn, the last outfit stays on him under the scan (or the base picture).
    const dressed = keys && TryOn.url(keys[a]);
    if (dressed) mirror.shown[a] = dressed;
    const src = dressed || mirror.shown[a] || (base && TryOn.url(base[a])) || "";
    if ((img.getAttribute("src") || "") !== src) { if (src) img.src = src; else img.removeAttribute("src"); }
  });
  setFrames(mirror.angle);
  // Your photo in the body panel, once it's back from the server.
  const face = root.querySelector(".mb-face");
  const me = face && !face.firstChild && TryOn.photo(bodyDraft().photo);
  if (me) face.innerHTML = `<img src="${me}" alt="Your photo">`;
  const a = TryOn.ANGLES[mirror.angle];
  root.querySelectorAll(".tt-dot").forEach((d, i) => d.setAttribute("aria-current", i === mirror.angle));
  const label = root.querySelector(".tt-angle");
  if (label) label.textContent = TryOn.ANGLE_LABEL[a];
  const tt = root.querySelector(".tt");
  const note = root.querySelector(".tt-note");
  if (!av || !tryonKey()) { tt.classList.remove("scanning"); return; }
  // What's happening to the picture you're looking at.
  const key = keys?.[a] || base[a];
  const st = TryOn.state(key);
  const err = TryOn.halted || (st === "error" && TryOn.errorOf(key));
  const isBase = !keys || key === base[a];
  const working = ["waiting", "queued", "making"].includes(st);
  tt.classList.toggle("scanning", working && !err);
  tt.classList.toggle("has-pic", !!root.querySelector(".tt-frame[src]"));
  let html = "";
  if (sync.status === "connecting") html = `<span>Connecting…</span>`;
  else if (sync.status === "offline" && st !== "ready") html = `<b>Offline</b><span>New pictures are drawn when the app can reach your server again.</span>`;
  else if (err) html = err.until ? `<b>Free pictures used up for today</b><span>${esc(err.message)}</span>`
    : `<b>${err.capped ? "Daily limit reached" : "Couldn't draw this one"}</b><span>${esc(err.message)}</span>${err.capped ? `<button class="chip" data-go="settings">Settings</button>` : `<button class="chip" data-act="tryon-retry">Try again</button>`}`;
  else if (working) {
    // Waiting on another picture first: your base picture, or the dressed front the other sides copy.
    const what = TryOn.state(base[a]) === "making" || TryOn.state(base.front) === "making" ? "Drawing you"
      : st === "making" || (keys && TryOn.state(keys.front) === "making") ? "Dressing you" : "In line";
    html = `<span class="tt-pill">${what} · ${TryOn.ANGLE_LABEL[a]}</span>`;
  }
  if (note.dataset.html !== html) { note.innerHTML = html; note.dataset.html = html; }
  note.classList.toggle("is-error", !!err);
  // How far along each idea is.
  mirror.combos.forEach((c, i) => {
    const el = root.querySelector(`[data-lookstate="${i}"]`);
    if (!el) return;
    const states = TryOn.ANGLES.map((x) => TryOn.state(c.keys[x]));
    const ready = states.filter((s) => s === "ready").length;
    el.textContent = ready === 4 ? "Ready from every side"
      : states.includes("making") ? `Drawing ${Math.min(4, ready + 1)} of 4…`
      : states.includes("error") ? (ready ? `${ready} of 4 ready` : "Not drawn")
      : state.settings.tryon === false && i !== mirror.pick ? "Drawn when you pick it"
      : ready ? `${ready} of 4 ready` : "Waiting to be drawn";
  });
}
// The Save Body button and the line under it.
function bodyUI() {
  const btn = $("#mb-save"), hint = $("#mb-hint");
  if (!btn) return;
  const id = TryOn.avatarId(bodyDraft()), saved = state.avatar?.id === id;
  btn.disabled = saved || !tryonKey() || !!mirror.reading;
  btn.textContent = saved ? "Saved" : "Save body";
  hint.textContent = !tryonKey() ? "Needs the hosted app (its web address)."
    : mirror.reading ? "Reading your photo…"
    : !state.avatar ? "You're drawn from four sides once: 4 free pictures."
    : saved ? `${TryOn.bodyLine(state.avatar.body)}. Every device shows this body.`
    : "Save to draw the new you (4 free pictures). Today's outfits are drawn again on the new body.";
}
function bodyInput(k, v) {
  const b = bodyDraft();
  b[k] = +v;
  const shown = { height: `${b.height} cm`, weight: TryOn.WEIGHTS[b.weight], build: TryOn.BUILDS[b.build] }[k];
  const out = $(`#mb-${k}-v`);
  if (out) out.textContent = shown;
  bodyUI();
}
async function saveBody() {
  const body = TryOn.cleanBody(bodyDraft());
  state.avatar = { body, id: TryOn.avatarId(body), at: new Date().toISOString() };
  mirror.draft = { ...body };
  mirror.angle = 0;
  await store.put("kv", state.avatar, "avatar");
  remountMirror();
}

// Settings > Try-on: the avatar on Today, the free daily pictures, and the limits.
function tryonCard() {
  const s = state.settings, c = tryonSpent();
  const toggle = `<button class="toggle" role="switch" aria-checked="${s.tryon !== false}" data-toggle="tryon"><span class="knob"></span><span class="toggle-text"><b>Get today's ideas ready</b><span class="muted small">Draws all four sides of the three ideas in the background, so picking one and turning him is instant. Up to 12 pictures each time the ideas change; ideas already drawn aren't drawn again.</span></span></button>`;
  return `<section class="card stack">
    <h2 style="margin:0">Try-on</h2>
    <p class="muted small" style="margin:0">The avatar on Today. Cloudflare Workers AI (FLUX.2) draws you once from four sides (Save Body on Today), then each outfit on those pictures. It's free: Cloudflare's free plan pays for about ${TryOn.FREE_A_DAY} pictures a day across all your devices, then stops until ${TryOn.resetTime()} instead of charging. Every picture is kept on your server under a hash of body, pieces and angle, so a combination is never drawn twice, on any device.</p>
    ${!tryonKey() ? `<p class="small" style="margin:0;color:var(--warn)">Only works in the hosted app: open it from its web address.</p>` : ""}
    ${toggle}
    <div class="field"><label for="tryon-cap">Daily limit</label><div class="row"><input id="tryon-cap" class="input" style="max-width:7rem" type="number" inputmode="numeric" min="0" max="500" data-input="tryoncap" value="${tryonCap()}"><span class="muted small">pictures a day on this device (ideas in the background stop at three quarters of it)</span></div></div>
    <p class="muted small" style="margin:0">Today: ${c.n} of ${tryonCap()} pictures · this month: ${c.m} · nothing charged${state.avatar ? ` · body: ${esc(TryOn.bodyLine(state.avatar.body))}` : ""}</p>
  </section>`;
}

/* ---------- Wardrobe ---------- */
function filteredItems() {
  const { q, slot, cat, color, style, sort } = state.filters;
  const ql = q.trim().toLowerCase();
  const list = state.items.filter((i) =>
    (slot === "all" || (slot === "fav" ? isFavourite(i) : slot === "wash" ? i.wash : slot === "disliked" ? i.disliked : slotOf(i) === slot)) &&
    (cat === "all" || i.category === cat) &&
    (color === "all" || (i.colors || []).includes(color)) &&
    (style === "all" || (i.styles || []).includes(style)) &&
    (!ql || [i.name, i.brand, catLabel(i.category), FITS[i.fit]?.label, ...(i.tags || []), ...(i.colors || []), ...(i.styles || [])].join(" ").toLowerCase().includes(ql)));
  const by = {
    recent: (a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""),
    most: (a, b) => (b.wearCount || 0) - (a.wearCount || 0),
    least: (a, b) => (a.wearCount || 0) - (b.wearCount || 0) || (a.lastWorn || "").localeCompare(b.lastWorn || ""),
    name: (a, b) => a.name.localeCompare(b.name),
  };
  return list.sort(by[sort]);
}
function renderWardrobe() {
  if (state.wardView === "report") return renderReport();
  if (state.wardSide === "scents") return renderCabinet();
  const list = filteredItems();
  const usedColors = [...new Set(state.items.flatMap((i) => i.colors || []))];
  const usedStyles = Object.keys(STYLES).filter((s) => state.items.some((i) => (i.styles || []).includes(s)));
  const f = state.filters;
  const washing = inWash().length;
  main.innerHTML = `
    <div class="head">
      <div><h1>Wardrobe</h1><p class="sub">${state.items.length} pieces${washing ? ` · ${washing} in the wash` : ""}</p></div>
      <div class="chips"><button class="chip report-btn" data-act="report">${ICON_CHART}Report</button>${[["recent", "Newest"], ["most", "Most worn"], ["least", "Least worn"], ["name", "A–Z"]].map(([k, l]) => `<button class="chip" aria-pressed="${f.sort === k}" data-sort="${k}">${l}</button>`).join("")}</div>
    </div>
    ${sideSwitch()}
    <div class="toolbar">
      <div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="search-input" class="input" placeholder="Search name, brand, style, tag…" value="${esc(f.q)}" data-input="q"></div>
      <div class="chips scroller">
        <button class="chip" aria-pressed="${f.slot === "all"}" data-slot="all">All</button>
        <button class="chip" aria-pressed="${f.slot === "fav"}" data-slot="fav">★ Favourites</button>
        ${washing || f.slot === "wash" ? `<button class="chip" aria-pressed="${f.slot === "wash"}" data-slot="wash">In the wash <span class="muted">${washing}</span></button>` : ""}
        ${state.items.some((i) => i.disliked) || f.slot === "disliked" ? `<button class="chip" aria-pressed="${f.slot === "disliked"}" data-slot="disliked">Disliked <span class="muted">${state.items.filter((i) => i.disliked).length}</span></button>` : ""}
        ${Object.entries(SLOTS).map(([k, l]) => `<button class="chip" aria-pressed="${f.slot === k}" data-slot="${k}">${l}</button>`).join("")}
      </div>
      ${(() => {
        // Inside a section (e.g. Accessories): one chip per type you own, e.g. Watches, Bracelets.
        const types = CATS.filter((c) => c.slot === f.slot && state.items.some((i) => i.category === c.id));
        return types.length > 1 ? `<div class="chips scroller"><button class="chip" aria-pressed="${f.cat === "all"}" data-catf="all">All ${esc(SLOTS[f.slot].toLowerCase())}</button>${types.map((c) => `<button class="chip" aria-pressed="${f.cat === c.id}" data-catf="${c.id}">${c.label} <span class="muted">${state.items.filter((i) => i.category === c.id).length}</span></button>`).join("")}</div>` : "";
      })()}
      ${usedStyles.length > 1 ? `<div class="chips scroller"><button class="chip" aria-pressed="${f.style === "all"}" data-style="all">Any style</button>${usedStyles.map((s) => `<button class="chip" aria-pressed="${f.style === s}" data-style="${esc(s)}">${styleLabel(s)}</button>`).join("")}</div>` : ""}
      ${usedColors.length > 1 ? `<div class="chips scroller"><button class="chip" aria-pressed="${f.color === "all"}" data-color="all">Any colour</button>${usedColors.map((c) => `<button class="chip" aria-pressed="${f.color === c}" data-color="${esc(c)}"><span class="dot" style="background:${COLORS[c]?.hex}"></span>${esc(cap(c))}</button>`).join("")}</div>` : ""}
    </div>
    ${f.slot === "wash" ? `<div class="row laundry-row"><span class="muted small">${washing ? "These pieces are left out of outfit ideas until they're back." : "Nothing in the wash. Everything is back in your wardrobe."}</span>${washing ? `<button class="btn" data-act="wash-done">Laundry done: all ${washing} back</button>` : ""}</div>` : ""}
    ${list.length ? `<div class="grid" id="grid">${list.map(itemTile).join("")}</div>` :
      state.items.length ? `<p class="muted">Nothing matches these filters.</p>` :
      emptyState("No clothes yet", "Snap a photo of each piece to start your catalogue.", `<button class="btn primary" data-go="add">Add clothes</button><button class="btn" data-act="seed">Load sample wardrobe</button>`)}`;
}
function itemTile(i) {
  const sub = [i.brand, (i.styles || []).slice(0, 1).map(styleLabel)[0]].filter(Boolean).join(" · ") || catLabel(i.category);
  return `<button class="item" data-item="${i.id}">
    <div class="pic${i.wash ? " washing" : ""}"><img class="thumb pic-bg" loading="lazy" src="${photoURL(i.photos?.[0])}" alt="">${isFavourite(i) ? `<span class="fav">★ ${starsOf(i)}</span>` : ""}${i.wash ? '<span class="wash-badge">In the wash</span>' : leaving(i) ? `<span class="wash-badge">To ${i.fate.status}</span>` : ""}</div>
    <div class="meta"><span class="name">${esc(i.name)}</span><span class="info">${swatches(i.colors)} ${esc(sub)}</span></div>
  </button>`;
}
function emptyState(title, text, actions) {
  return `<div class="empty"><svg viewBox="0 0 24 24"><path d="M12 3a2 2 0 0 0-2 2h-.5L3 9l1.6 3.2L7 11v10h10V11l2.4 1.2L21 9l-6.5-4H14a2 2 0 0 0-2-2z"/></svg><h2 style="margin:0;color:var(--text)">${title}</h2><p style="margin:0">${text}</p><div class="row" style="justify-content:center">${actions}</div></div>`;
}

/* ---------- Item detail (sheet) ---------- */
function openItem(id, showOriginal = false) {
  const i = state.items.find((x) => x.id === id);
  if (!i) return;
  const b = brandInfo(i.brand);
  const pics = showOriginal && i.originals?.length ? i.originals : i.photos || [];
  const panel = $(".sheet-panel");
  panel.innerHTML = `
    <div class="detail-head">
      <div><h1 style="font-size:28px">${esc(i.name)}</h1><p class="sub">${esc([catLabel(i.category), i.brand].filter(Boolean).join(" · "))}${b?.tier ? ` · <span class="tier">${TIER_LABEL[b.tier]}</span>` : ""}</p></div>
      <button class="btn icon-btn ghost" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div>
    <div class="row item-rate">
      ${starPicker(`i|${i.id}`, starsOf(i) || 0)}
      <button class="btn" data-dislike="${i.id}" aria-pressed="${!!i.disliked}">${i.disliked ? "Disliked" : "Dislike"}</button>
      ${i.disliked ? `<span class="muted small">Left out of outfit ideas. You can still build outfits around it.</span>` : ""}
    </div>
    <div class="gallery">${pics.map((p) => `<img class="pic-bg" src="${photoURL(p)}" alt="">`).join("")}</div>
    ${i.originals?.length ? `<div class="row" style="margin-top:10px"><button class="chip" data-orig="${i.id}" data-show="${showOriginal ? 0 : 1}">${showOriginal ? "Show cut-out" : "Show original photo"}</button></div>` : ""}
    <div class="kv" style="margin:18px 0">
      <div><b>Style</b>${(i.styles || []).map(styleLabel).join(", ") || "Not set"}</div>
      <div><b>Colours</b>${swatches(i.colors)} ${esc((i.colors || []).join(", "))}</div>
      <div><b>Warmth</b>${"●".repeat(i.warmth || 1)}${"○".repeat(5 - (i.warmth || 1))}</div>
      <div><b>Worn</b>${i.wearCount ? i.wearCount + "×" : "Not yet"} ${i.lastWorn ? `· ${daysSince(i.lastWorn) === 0 ? "today" : daysSince(i.lastWorn) + " days ago"}` : ""}</div>
      ${i.wash ? `<div><b>Laundry</b>In the wash since ${daysSince(i.wash) === 0 ? "today" : new Date(i.wash).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</div>` : ""}
      ${i.price ? `<div><b>Price</b>${fmtPrice(i.price, i.currency)}${i.wearCount ? ` · ${fmtPrice(i.price / i.wearCount, i.currency)} per wear` : ""}</div>` : ""}
      ${i.size ? `<div><b>Size</b>${esc(i.size)}</div>` : ""}
      ${i.material ? `<div><b>Material</b>${esc(i.material)}</div>` : ""}
      ${i.link && /^https?:\/\//.test(i.link) ? `<div><b>Shop</b><a href="${esc(i.link)}" target="_blank" rel="noopener">Product page ↗</a>${i.reference ? ` · ref ${esc(i.reference)}` : ""}</div>` : ""}
    </div>
    ${fitsFor(i).length ? `<div class="field" style="margin-bottom:14px"><label>Fit</label><div class="chips">${fitsFor(i).map((f) => `<button class="chip" aria-pressed="${i.fit === f}" data-setfit="${i.id}:${f}">${FITS[f].label}</button>`).join("")}</div></div>` : ""}
    ${suitField(i)}
    ${i.look || (aiReady() && i.photos?.length) ? `<div class="field" style="margin-bottom:14px"><label>What the AI sees in the photo</label>
      <div class="row">${i.look ? `<span>${esc(lookLine(i.look))}</span>` : `<span class="muted small">Not looked at yet. Outfit ideas use it once it has (about 350 tokens, once).</span>`}
      ${aiReady() && i.photos?.length ? `<button class="chip" data-lookat="${i.id}">${i.look ? "Look again" : "Look at the photo"}</button>` : ""}</div></div>` : ""}
    ${i.tags?.length ? `<div class="chips" style="margin-bottom:14px">${i.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>` : ""}
    ${i.notes ? `<p>${esc(i.notes)}</p>` : ""}
    <div class="row">
      <button class="btn primary" data-wear-item="${i.id}">Wearing it today</button>
      <button class="btn" data-wash="${i.id}" aria-pressed="${!!i.wash}">${i.wash ? "Back from the wash" : "In the wash"}</button>
      ${CORE.includes(roleOf(i)) && !i.wash ? `<button class="btn" data-anchor="${i.id}">Build outfits with it</button>` : ""}
      <button class="btn" data-pair="${i.id}">What goes with it?</button>
      <button class="btn" data-edit="${i.id}">Edit</button>
      <button class="btn ghost danger" data-del="${i.id}">Delete</button>
    </div>
    <div class="ai-answer" id="pair-answer" style="margin-top:16px"></div>`;
  $("#sheet").hidden = false;
}
// A jacket or trousers: which piece it makes a suit with, or the ones it could.
function suitField(i) {
  const mate = suitMate(i);
  if (mate) return `<div class="field" style="margin-bottom:14px"><label>Suit</label><div class="row"><span>One suit with the <b>${esc(mate.name)}</b></span><button class="chip" data-unsuit="${i.id}">Not a suit</button></div></div>`;
  // The app counts it as a suit with another piece (same colour and fabric, both formal): ask.
  const auto = suitOf(i);
  if (auto) return `<div class="field" style="margin-bottom:14px"><label>Suit</label><span>Is this a suit with the <b>${esc(auto.name)}</b>? Outfit ideas count them as one now.</span><div class="chips"><button class="chip" data-suit="${i.id}:${auto.id}">Yes, one suit</button><button class="chip" data-notsuit="${i.id}:${auto.id}">No</button></div></div>`;
  const cands = suitCandidates(i);
  if (!cands.length) return "";
  return `<div class="field" style="margin-bottom:14px"><label>Part of a suit? Same suit as…</label><div class="chips">${cands.slice(0, 6).map((x) => `<button class="chip" data-suit="${i.id}:${x.id}">${esc(x.name)}</button>`).join("")}</div></div>`;
}
const closeSheet = () => ($("#sheet").hidden = true);
function confirmBox(message, okLabel) {
  return new Promise((resolve) => {
    const panel = $(".sheet-panel");
    panel.innerHTML = `<div class="stack" style="max-width:560px;margin:0 auto;text-align:center">
      <h2 style="margin:0">${esc(message)}</h2>
      <div class="row" style="justify-content:center"><button class="btn" id="cb-no">Cancel</button><button class="btn primary" id="cb-yes">${esc(okLabel)}</button></div></div>`;
    $("#sheet").hidden = false;
    const done = (v) => { closeSheet(); resolve(v); };
    $("#cb-yes").onclick = (e) => { e.stopPropagation(); done(true); };
    $("#cb-no").onclick = (e) => { e.stopPropagation(); done(false); };
  });
}

// Rule-based: neutrals with anything, avoid a second accent colour, avoid two graphic pieces, prefer a shared style.
function pairScore(item, o) {
  const c = item.colors?.[0];
  const accent = c && !COLORS[c]?.neutral;
  const graphic = (item.tags || []).some((t) => /graphic|statement/.test(t));
  const has = (x, st) => (x.styles || []).includes(st);
  const oc = o.colors?.[0];
  let s = COLORS[oc]?.neutral ? 2 : accent ? -2 : 1;
  if (graphic && (o.tags || []).some((t) => /graphic|statement/.test(t))) s -= 1.5;
  if (COLORS[oc]?.tone !== COLORS[c]?.tone) s += 0.7;
  if ((o.styles || []).some((st) => has(item, st))) s += 1;
  for (const [a, b] of STYLE_CLASH) if ((has(o, a) && has(item, b)) || (has(o, b) && has(item, a))) s -= 1.5;
  return s;
}
function pairingsFor(item, limit = 6) {
  return state.items
    .filter((o) => o.id !== item.id && roleOf(o) !== roleOf(item) && slotOf(o) !== "under" && (slotOf(o) !== "gym" || slotOf(item) === "gym"))
    .map((o) => ({ o, s: pairScore(item, o) }))
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.o);
}

/* ---------- Add / edit ---------- */
// A draft photo keeps the photo as taken (src) and its cut-out (cutSrc; raw is the same before
// framing), plus what is shown after turning it upright by `rot` degrees: orig (photo) and cut
// (cut-out), and geo, which maps orig onto cut (see makeCut).
const shown = (p) => (p.useCut && p.cut ? p.cut : p.orig);
const newPhoto = (src) => ({ src, orig: src, cutSrc: null, cut: null, useCut: false, rot: 0 });
function newDraft() {
  return { id: null, photos: [], active: 0, name: "", category: "", colors: [], brand: "", styles: [], stylesTouched: false, fit: "", warmth: 3, tags: "", notes: "", price: "", currency: "", size: "", material: "", analysing: false };
}
function brandHint(brand) {
  const b = brandInfo(brand);
  if (!b) return "";
  const styles = b.styles?.length ? `usually ${b.styles.map(styleLabel).join(" / ").toLowerCase()}` : "";
  const source = b.about && b.ai ? " (from Wikidata and AI)" : b.about ? " (from Wikidata)" : b.ai ? " (from AI)" : "";
  return [b.about && cap(b.about), TIER_LABEL[b.tier], styles].filter(Boolean).join(", ") + source;
}

/* ---------- Brand lookup (Wikidata: free, no key) ----------
   The list above knows the tier and usual styles of about 85 brands. Any other brand
   is looked up on Wikidata, which recognises thousands of labels, from luxury houses
   to small streetwear brands. Its short description ("British streetwear brand",
   "Italian luxury fashion company") gives a style and sometimes a tier. Results are
   kept on the device, so each brand is looked up once. */
const BRAND_WORDS = [
  [/luxury|haute couture|fashion house/, "luxury", "luxury"],
  [/streetwear|skate/, null, "streetwear"],
  [/sportswear|sports?(wear| apparel| equipment| clothing)|athletic|activewear/, null, "sporty"],
  [/outdoor|mountaineering|hiking/, null, "outdoor"],
  [/fast fashion|retail chain|department store/, "high street", "casual"],
  [/tailor|\bsuits?\b|menswear/, null, "smart"],
  [/preppy/, null, "preppy"],
  [/vintage/, null, "vintage"],
  [/minimalis/, null, "minimal"],
  [/denim|jeans|workwear/, null, "casual"],
];
const FASHION_WORDS = /cloth|fashion|apparel|garment|footwear|shoe|sneaker|streetwear|sportswear|couture|designer|retailer|knitwear|denim|luxury/;
const NOT_FASHION = /\b(cars?|automobiles?|vehicles?|motorcycles?|tractors?|beer|wine|food|drinks?|software|video game|album|song|film|band|rapper|singer|cigarettes?|bank|airline|record label)\b/;
// "Patagonia, Inc." → "Patagonia"
const plainBrand = (name) => name.replace(/,?\s+(inc|ltd|llc|plc|s\.?p\.?a|s\.?a|gmbh|ag|co|corp|corporation|group|company)\.?$/i, "").trim();
function brandFromWikidata(hit) {
  const about = (hit.description || "").toLowerCase();
  if (NOT_FASHION.test(about) || !(FASHION_WORDS.test(about) || /\b(brand|company)\b/.test(about))) return null;
  let tier;
  const styles = [];
  for (const [re, t, s] of BRAND_WORDS) if (re.test(about)) { tier = tier || t || undefined; if (!styles.includes(s)) styles.push(s); }
  return { name: plainBrand(hit.label), tier, styles: styles.slice(0, 3), about: hit.description, at: today() };
}
let brandPauseUntil = 0;
async function searchBrands(q) {
  if (Date.now() < brandPauseUntil) throw new Error("paused");
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&uselang=en&type=item&limit=10&format=json&origin=*`;
  const r = await fetch(url);
  if (!r.ok) {
    if (r.status === 429) brandPauseUntil = Date.now() + 10 * 60e3; // asked to slow down: try again in 10 minutes
    throw new Error(`Wikidata ${r.status}`);
  }
  return ((await r.json()).search || []).map(brandFromWikidata).filter(Boolean);
}
const saveBrandCache = () => raw.put("kv", brandCache, "brandCache");
// Keep every brand found, and return the one meant by `k`: the exact name, or a
// longer one that starts with it ("Lululemon" → "Lululemon Athletica").
function rememberBrands(hits, k) {
  for (const h of hits) if (!BRANDS[normBrand(h.name)] && !brandCache[normBrand(h.name)]?.name) brandCache[normBrand(h.name)] = h;
  const hit = hits.find((h) => normBrand(h.name) === k) || (k.length >= 4 && hits.find((h) => normBrand(h.name).startsWith(k)));
  if (hit && !brandCache[k]?.name) brandCache[k] = hit;
  return hit;
}
// Look a brand up once (misses are retried after a month). Returns true if something new was learnt.
async function lookupBrand(brand) {
  const k = normBrand(brand);
  if (!k || k.length < 2 || BRANDS[k]) return false;
  let c = brandCache[k], learnt = false;
  if (!c || (!c.name && daysSince(c.at) >= 30)) {
    try {
      c = brandCache[k] = rememberBrands(await searchBrands(brand.trim()), k) || { at: today() };
      learnt = !!c.name;
    } catch { /* offline or blocked: the list above still works */ }
  }
  // Wikidata didn't say the tier or style (or doesn't know the brand): ask the AI once, if a key is set.
  if ((!c?.tier || !c.styles?.length) && !c?.aiAt && aiReady() && !state.previewAI) {
    try {
      const r = await aiBrand(brand.trim());
      c = brandCache[k] = !r.known ? { ...c, at: c?.at || today(), aiAt: today() } : {
        ...c, name: c?.name || r.name || brand.trim(), at: c?.at || today(), aiAt: today(), ai: true,
        tier: c?.tier || (TIER_LABEL[r.tier] ? r.tier : undefined),
        styles: c?.styles?.length ? c.styles : (r.styles || []).filter((s) => STYLES[s]).slice(0, 3),
      };
      learnt = learnt || r.known;
    } catch { /* no answer: Wikidata's info stays */ }
  }
  await saveBrandCache();
  return learnt;
}
// About 150 tokens, once per brand the list and Wikidata can't place.
const BRAND_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["known", "name", "tier", "styles"],
  properties: {
    known: { type: "boolean", description: "false if you don't know this clothing brand" },
    name: { type: "string", description: "The brand's usual spelling" },
    tier: { type: "string", enum: [...Object.keys(TIER_LABEL), "unknown"] },
    styles: { type: "array", items: { type: "string", enum: Object.keys(STYLES) }, description: "1 to 3 styles the brand is known for, best first" },
  },
};
async function aiBrand(brand) {
  const text = await aiGenerate({
    system: "You classify clothing brands for a wardrobe app. Reply with JSON only. Tiers: luxury (designer houses), premium (Stone Island, Ralph Lauren), mainstream (Nike, Levi's), high street (Zara, H&M).",
    text: `Clothing brand: "${brand}"`,
    schema: BRAND_SCHEMA,
    maxTokens: 120,
  });
  return JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
}
// Fill in brands of pieces already in the wardrobe (Discover shows their tier and style).
async function lookupWardrobeBrands() {
  let learnt = false;
  for (const b of [...new Set(state.items.map((i) => i.brand).filter(Boolean))]) learnt = (await lookupBrand(b)) || learnt;
  if (learnt && view === "shop") render();
}
// While typing a brand: suggest matching brands from Wikidata and update the hint.
let brandTimer;
function brandTyped(value) {
  clearTimeout(brandTimer);
  brandTimer = setTimeout(async () => {
    const q = value.trim();
    if (q.length < 2 || BRANDS[normBrand(q)]) return;
    let hits = [];
    try { hits = await searchBrands(q); } catch { return; }
    rememberBrands(hits, ""); // half-typed names aren't saved as aliases; lookupBrand does that on save
    await saveBrandCache();
    const list = $("#brand-list");
    if (list) for (const h of hits) if (!list.querySelector(`option[value="${CSS.escape(h.name)}"]`)) list.insertAdjacentHTML("afterbegin", `<option value="${esc(h.name)}"></option>`);
    if (!draft || normBrand(draft.brand) !== normBrand(value)) return;
    refreshStyles();
    const hint = $("#brand-hint");
    if (hint) hint.textContent = brandHint(draft.brand);
    document.querySelectorAll("[data-sty]").forEach((c) => c.setAttribute("aria-pressed", draft.styles.includes(c.dataset.sty)));
  }, 400);
}
const ICON_CAMERA = `<svg viewBox="0 0 24 24"><path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="4"/></svg>`;
const ICON_GALLERY = `<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/></svg>`;
const ICON_TAG = `<svg viewBox="0 0 24 24"><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="8" cy="8" r="1.5"/></svg>`;
const ICON_LENS = `<svg viewBox="0 0 24 24"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3.5"/></svg>`;
const ICON_SCISSORS = `<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M8.1 8.1 20 20M8.1 15.9 20 4"/></svg>`;
const ICON_BOTTLE = `<svg viewBox="0 0 24 24"><path d="M10 2.5h4v3h-4zM8.5 5.5h7V8h-7zM6.5 11a3 3 0 0 1 3-3h5a3 3 0 0 1 3 3v8a2.5 2.5 0 0 1-2.5 2.5H9A2.5 2.5 0 0 1 6.5 19zM9.5 14.5h5"/></svg>`;
const ICON_ROTATE =`<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>`;

function renderAdd() {
  if (scentDraft) return renderScentAdd();
  if (!draft) draft = newDraft();
  const d = draft;
  if (pendingShots.length) {
    // System-camera path: the front is in, now the back.
    main.innerHTML = `
      <div class="head"><div><h1>Now the back</h1><p class="sub">Flip the piece over, keep the collar or waistband at the top, and take the second photo.</p></div></div>
      <div class="shot-step">
        <img class="pic-bg" src="${photoURL(pendingShots[0])}" alt="Front photo">
        <div class="stack">
          <button class="btn primary big" data-act="shoot">${ICON_CAMERA}Take back photo</button>
          <button class="btn ghost" data-act="shoot-done">No back photo, continue</button>
        </div>
      </div>`;
    return;
  }
  if (!d.photos.length && !d.id && !d.fromLabel) {
    main.innerHTML = `
      <div class="head"><div><h1>Add clothes</h1><p class="sub">Two photos per piece: the front, then the back. The app does the rest. Just bought it? Snap the label instead.</p></div></div>
      <div class="add-start">
        <button class="btn primary big" data-act="shoot">${ICON_CAMERA}<span class="big-label">Take photos<small>Front, then back</small></span></button>
        <button class="btn big" data-act="gallery">${ICON_GALLERY}<span class="big-label">Choose from gallery<small>Front and back photos are paired up</small></span></button>
        <button class="btn big" data-act="scan-label">${ICON_TAG}<span class="big-label">Scan the label<small>Fills it in from the shop</small></span></button>
        <button class="btn big" data-act="lens-start">${ICON_LENS}<span class="big-label">Google Lens<small>Finds it in the shops</small></span></button>
        <button class="btn big" data-act="scent-start">${ICON_BOTTLE}<span class="big-label">Fragrance<small>A bottle photo or its name</small></span></button>
      </div>
      <ol class="how">
        <li>Lay the piece flat on a plain surface, collar or waistband at the top.</li>
        <li>Take the front, flip it over, take the back.</li>
        <li>The background is removed, the photos are turned upright, and type, colours, brand and style are filled in${aiReady() ? ` by ${aiName()}` : " (add a Gemini key in Settings so the type is filled in too)"}. Check it and tap Save.</li>
      </ol>`;
    return;
  }
  const cur = d.photos[d.active] || d.photos[0];
  const working = d.photos.some((p) => p.busy) || d.analysing || d.scanningTag;
  const status = d.scanningTag ? d.labelStep || "Reading the label…" : d.photos.some((p) => p.busy) ? "Removing backgrounds and straightening…" : d.analysing ? `Recognising with ${aiName()}…` : "";
  const site = (u) => { try { return new URL(u).hostname.replace(/^www\d*\./, ""); } catch { return ""; } };
  main.innerHTML = `
    <div class="head">
      <div><h1>${d.id ? "Edit piece" : "New piece"}</h1>${status ? `<p class="sub row" style="gap:10px"><span class="spinner"></span>${status}</p>` : queue.length ? `<p class="sub">${queue.length} more piece${queue.length > 1 ? "s" : ""} waiting</p>` : ""}</div>
      <div class="row">
        ${aiReady() && !working && cur ? `<button class="btn" data-act="ai-tag"><svg viewBox="0 0 24 24"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/></svg>Recognise again</button>` : ""}
        <button class="btn ghost" data-act="cancel-add">Cancel</button>
      </div>
    </div>
    <div class="add-grid">
      <div class="photos">
        ${!cur ? `<div class="photo-wrap no-photo">${d.scanningTag
          ? `<div class="busy"><div class="spinner"></div><span>${esc(d.labelStep || "Reading the label…")}</span></div>`
          : `<div class="stack" style="align-items:center;text-align:center;padding:24px"><p class="muted" style="margin:0">No photo from the shop. Take one of the piece, or pick one.</p>
              <button class="btn primary" data-act="label-shoot">${ICON_CAMERA}Take a photo</button><button class="btn" data-act="more-photo">${ICON_GALLERY}Choose from gallery</button></div>`}</div>` : `
        <div class="photo-wrap">
          <img class="photo-main pic-bg" src="${photoURL(shown(cur))}" alt="">
          ${cur.busy ? `<div class="busy"><div class="spinner"></div><span>${esc(cur.busyText || "Removing background…")}</span></div>` : ""}
          ${d.photos.length > 1 ? `<span class="photo-tag">${d.active === 0 ? "Front" : d.active === 1 ? "Back" : `Photo ${d.active + 1}`}</span>` : ""}
        </div>
        <div class="row">
          ${cur.busy ? "" : `<button class="chip" data-act="rotate">${ICON_ROTATE}Turn</button>`}
          ${cur.cut && cur.useCut && !cur.busy ? `<button class="chip" data-act="fix-cut">${ICON_SCISSORS}Fix cut-out</button>` : ""}
          ${cur.cut ? `<button class="chip" data-cutview="${cur.useCut ? 0 : 1}">${cur.useCut ? "Use original photo" : "Use cut-out"}</button>` : cur.busy ? "" : `<button class="chip" data-act="cutout">Remove background</button>`}
          ${cur.engine === "basic" && cur.useCut ? `<span class="muted small">Quick cut-out. The AI cut-out needs internet the first time.</span>` : ""}
        </div>
        <div class="photo-strip">
          ${d.photos.map((p, k) => `<div class="mini ${k === d.active ? "on" : ""}"><img class="pic-bg" src="${photoURL(shown(p))}" data-photo="${k}" alt="">${p.busy ? '<div class="mini-busy"><div class="spinner"></div></div>' : ""}<button class="x" data-rmphoto="${k}" aria-label="Remove photo">×</button></div>`).join("")}
          <button class="add-photo" data-act="more-photo" aria-label="Add photo">+</button>
        </div>
        ${d.photos[0]?.shop ? `<p class="muted small" style="margin:0">Photo from ${esc(d.shopPhoto.site || "the shop")}.${d.shopPhoto.otherColour ? " It shows the piece in another colour: add your own photo with + and remove this one." : d.photos.some((p) => !p.shop) ? " Yours are after it." : " Add your own with +."}</p>` : ""}`}
      </div>
      <div class="stack">
        ${lensHTML(d)}
        <div class="field"><label for="f-name">Name</label><input id="f-name" class="input" data-input="name" value="${esc(d.name || "")}" placeholder="${esc(autoName(d) || "e.g. Navy cable-knit sweater")}"></div>
        <div class="field"><label>Type</label>${Object.entries(SLOTS).map(([slot, label]) => `<div class="type-group"><span class="muted small">${label}</span><div class="chips">${CATS.filter((c) => c.slot === slot).map((c) => `<button class="chip" aria-pressed="${d.category === c.id}" data-cat="${c.id}">${c.label}</button>`).join("")}</div></div>`).join("")}</div>
        <div class="field"><label for="f-brand">Brand</label>
          <input id="f-brand" class="input" data-input="brand" value="${esc(d.brand)}" placeholder="e.g. Lacoste" list="brand-list" autocomplete="off">
          <datalist id="brand-list">${BRAND_LIST.map(([n]) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
          <span class="muted small" id="brand-hint">${esc(brandHint(d.brand))}</span>
        </div>
        <div class="field"><label>Label <span style="text-transform:none;font-weight:400">(optional)</span></label>
          <div class="row">
            <button class="btn" data-act="scan-tag" ${d.scanningTag ? "disabled" : ""}>${d.scanningTag ? `<span class="spinner"></span>${esc(d.labelStep || "Reading the label…")}` : `${ICON_TAG}Scan the label`}</button>
            <button class="btn" data-act="lens" ${d.scanningTag || d.lens?.busy ? "disabled" : ""}>${d.lens?.busy ? `<span class="spinner"></span>Searching with Google Lens…` : `${ICON_LENS}Google Lens`}</button>
            <span class="muted small">${aiReady() ? `Reads the QR code, and ${aiName()} reads brand, price, size and material from a photo of the tag or label. Google Lens finds the piece in the shops from its photo.` : "Reads the QR code on the tag. Add a Gemini key in Settings to read the printed text too, or type it in."}</span>
          </div>
          ${d.labelNote ? `<p class="muted small" style="margin:0">${esc(d.labelNote)}</p>` : ""}
          ${d.link ? `<a class="btn ghost" href="${esc(d.link)}" target="_blank" rel="noopener">Product page on ${esc(site(d.link))}${d.reference ? ` · ref ${esc(d.reference)}` : ""} ↗</a>` : ""}
          <div class="tag-fields">
            <input class="input" data-input="price" inputmode="decimal" value="${esc(d.price ?? "")}" placeholder="Price${d.currency ? ` (${esc(d.currency)})` : ""}" aria-label="Price">
            <input class="input" data-input="size" value="${esc(d.size || "")}" placeholder="Size" aria-label="Size">
            <input class="input" data-input="material" value="${esc(d.material || "")}" placeholder="Material, e.g. 100% cotton" aria-label="Material">
          </div>
        </div>
        <div class="field"><label>Style <span style="text-transform:none;font-weight:400">(${d.stylesTouched ? "set" : "recognised from brand and type, tap to change"})</span></label><div class="chips">${Object.entries(STYLES).map(([k, v]) => `<button class="chip" aria-pressed="${d.styles.includes(k)}" data-sty="${esc(k)}">${v.label}</button>`).join("")}</div></div>
        <div class="field"><label>Colours <span style="text-transform:none;font-weight:400">(main colour first)</span></label><div class="chips">${Object.entries(COLORS).map(([n, v]) => `<button class="chip" aria-pressed="${d.colors.includes(n)}" data-col="${esc(n)}"><span class="dot" style="background:${v.hex}"></span>${cap(n)}${d.colors[0] === n ? " ·main" : ""}</button>`).join("")}</div></div>
        <div class="field"><label for="f-warmth">Warmth</label><input id="f-warmth" type="range" min="1" max="5" value="${d.warmth}" data-input="warmth"><div class="warm-scale"><span>Light</span><span>Medium</span><span>Winter</span></div></div>
        ${fitsFor(d).length ? `<div class="field"><label>Fit</label><div class="chips">${fitsFor(d).map((f) => `<button class="chip" aria-pressed="${d.fit === f}" data-fit="${f}">${FITS[f].label}</button>`).join("")}</div></div>` : ""}
        <div class="field"><label for="f-tags">Tags</label><input id="f-tags" class="input" data-input="tags" value="${esc(d.tags)}" placeholder="graphic, knit, gift from mum…"></div>
        <div class="field"><label for="f-notes">Notes</label><textarea id="f-notes" class="input" data-input="notes" placeholder="Size, where you bought it, care…">${esc(d.notes)}</textarea></div>
        <div class="row">
          ${d.id
            ? `<button class="btn primary big" data-act="save" ${d.category ? "" : "disabled"}>Save changes</button>`
            : `<button class="btn primary big" data-act="save-next" ${d.category && cur && !working ? "" : "disabled"}>${queue.length ? `Save, next piece (${queue.length} left)` : "Save and add the next piece"}</button>
               <button class="btn big" data-act="save" ${d.category && cur && !working ? "" : "disabled"}>Save</button>`}
        </div>
        ${!working && (!d.category || !cur) ? `<p class="muted small" style="margin:0">${!cur ? "Add a photo" : "Pick the type"}${!cur && !d.category ? " and pick the type" : ""} to save.</p>` : ""}
      </div>
    </div>`;
}
function autoName(d) {
  if (!d.category) return "";
  return cap([d.colors[0], d.brand, catLabel(d.category).toLowerCase()].filter(Boolean).join(" "));
}
function refreshStyles() {
  if (draft && !draft.stylesTouched) draft.styles = guessStyles({ brand: draft.brand, category: draft.category, tags: draft.tags.split(",").map((t) => t.trim().toLowerCase()) });
}

// Hidden file inputs: one opens the system camera, one the gallery.
const camInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", capture: "environment", hidden: true });
const galInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", multiple: true, hidden: true });
document.body.append(camInput, galInput);
let queue = []; // more pieces chosen from the gallery, each a [front, back?] list of photos
let pendingShots = []; // system-camera path: the front photo while waiting for the back
let addingExtraPhoto = false;
const rerenderAdd = (d) => { if (draft === d && view === "add") render(); };

async function applyRotation(p) {
  p.orig = await rotateImage(p.src, p.rot, false);
  if (p.raw) { const c = await makeCut(p.raw, p.rot); p.cut = c.blob; p.geo = c.geo; }
  else if (p.cutSrc) { p.cut = await rotateImage(p.cutSrc, p.rot, true); p.geo = null; }
}
// Cut the background out and stand the piece upright.
async function preparePhoto(p, d, cut = state.settings.autoCutout) {
  p.busy = true;
  rerenderAdd(d);
  try {
    if (cut && !p.cutSrc) {
      const r = await removeBackground(p.src);
      p.cutSrc = r.blob; p.raw = r.raw; p.engine = r.engine; p.useCut = true;
    }
    if (p.cutSrc && !p.manual) p.rot = await uprightAngle(p.cutSrc, kindOf(d.category));
    await applyRotation(p);
    if (d.photos[0] === p && !d.keepColors) d.colors = await detectColors(shown(p)).catch(() => d.colors);
  } catch {
    if (draft === d && view === "add") toast("Couldn't separate the garment from the background");
  }
  p.busy = false;
  rerenderAdd(d);
}
// Without AI, knowing the type (top or bottom) makes the upright guess more reliable.
async function reorient(d) {
  for (const p of d.photos) {
    if (!p.cutSrc || p.manual || p.aiChecked || p.busy) continue;
    const rot = await uprightAngle(p.cutSrc, kindOf(d.category));
    if (Math.abs(rot - p.rot) > 2) { p.rot = rot; await applyRotation(p); }
  }
  rerenderAdd(d);
}
// Fix a cut-out by hand (cutout-editor.js). The editor gets the upright photo and what is kept of it.
async function fixCutout(d, p) {
  if (!p?.cut || p.busy) return;
  p.busy = true;
  p.busyText = "Opening the editor…";
  rerenderAdd(d);
  let photo, mask, start, note = "";
  try {
    start = await rawFor(p, d).catch(() => null);
    if (start) {
      photo = await createImageBitmap(await rotateImage(p.src, start.rot, false));
      mask = turnCanvas(await createImageBitmap(start.raw), quarterOf(start.rot)).c;
    } else {
      // The original photo couldn't be cut out again (offline): edit the cut-out itself.
      photo = await createImageBitmap(p.cut);
      mask = newCanvas(photo.width, photo.height);
      mask.getContext("2d").drawImage(photo, 0, 0);
      note = "Offline: Restore only brings back what you erased here.";
    }
  } catch {
    toast("Couldn't open the editor for this photo");
  }
  p.busy = false;
  p.busyText = "";
  rerenderAdd(d);
  if (!mask) return;
  const kept = await editCutout(photo, mask, { note });
  if (!kept) return;
  p.busy = true;
  p.busyText = "Saving the cut-out…";
  rerenderAdd(d);
  try {
    // The kept pixels of the upright photo, turned back to the photo as taken.
    const kctx = kept.getContext("2d");
    kctx.globalCompositeOperation = "source-in";
    kctx.drawImage(photo, 0, 0);
    if (start) {
      const src = await createImageBitmap(p.src);
      const back = newCanvas(src.width, src.height);
      const bctx = back.getContext("2d");
      bctx.setTransform(turnGeo(src.width, src.height, quarterOf(start.rot)).m.inverse());
      bctx.drawImage(kept, 0, 0);
      p.raw = await canvasBlob(back, "image/png");
      p.cutSrc = await framePiece(p.raw);
      p.rot = start.rot;
    } else p.cutSrc = await rotateImage(await framePiece(kept), -p.rot, true);
    p.useCut = true;
    p.manual = true;
    p.engine = "hand";
    await applyRotation(p);
    if (d.photos[0] === p && !d.keepColors) d.colors = await detectColors(shown(p)).catch(() => d.colors);
  } catch {
    toast("Couldn't save the cut-out");
  }
  p.busy = false;
  p.busyText = "";
  rerenderAdd(d);
}
// The raw cut-out of a photo (see removeBackground) and the turn it is shown with.
async function rawFor(p, d) {
  if (p.raw) return { raw: p.raw, rot: p.rot };
  const src = await createImageBitmap(p.src);
  if (p.geo) {
    // Saved with the piece: put the cut-out back over the photo as taken.
    const toCut = p.geo.multiply(turnGeo(src.width, src.height, quarterOf(p.rot)).m);
    const c = newCanvas(src.width, src.height);
    const ctx = c.getContext("2d");
    ctx.setTransform(toCut.inverse());
    ctx.drawImage(await createImageBitmap(p.cut), 0, 0);
    ctx.resetTransform();
    ctx.globalCompositeOperation = "source-in";
    ctx.drawImage(src, 0, 0);
    return { raw: await canvasBlob(c, "image/png"), rot: p.rot };
  }
  // Saved before the editor existed: cut the original photo out again, keeping the slight tilt
  // that stands it upright (the original is only turned in quarter steps).
  const r = await removeBackground(p.src);
  const a = await uprightAngle(r.blob, kindOf(d.category));
  const tilt = ((((a + 45) % 90) + 90) % 90) - 45;
  return { raw: r.raw, rot: quarterOf(p.rot) + tilt };
}
async function startDraft(srcs) {
  draft = newDraft();
  const d = draft;
  d.photos = srcs.slice(0, 4).map(newPhoto);
  d.colors = await detectColors(srcs[0]).catch(() => []);
  const w = state.buying && state.wants.find((x) => x.id === state.buying);
  if (w) {
    Object.assign(d, { category: CAT[w.cat] ? w.cat : d.category, name: w.title, fit: w.fit || "", want: w.id });
    if (COLORS[w.color]) d.colors = [w.color, ...d.colors.filter((c) => c !== w.color)];
  }
  render();
  for (const p of d.photos) await preparePhoto(p, d);
  if (aiReady() && state.settings.aiAuto) await recognise(d);
}
async function recognise(d) {
  d.analysing = true;
  rerenderAdd(d);
  try {
    const [front, back] = d.photos;
    const r = await aiTagPhoto(shown(front), back && shown(back));
    Object.assign(d, {
      name: d.name || r.name || "",
      category: CAT[r.category] ? r.category : d.category,
      colors: (r.colors || []).filter((c) => COLORS[c]).slice(0, 3),
      brand: r.brand || d.brand,
      styles: (r.styles || []).filter((s) => STYLES[s]).slice(0, 3),
      stylesTouched: true,
      warmth: Math.min(5, Math.max(1, r.warmth || 3)),
      tags: (r.tags || []).join(", "),
    });
    if (FITS[r.fit] && fitsFor(d).includes(r.fit)) d.fit = r.fit;
    d.look = lookFrom(r) || d.look;
    // The AI also says which way is up in each photo: turn any that are still sideways.
    for (const [k, side] of [[0, r.front_top], [1, r.back_top]]) {
      const p = d.photos[k];
      if (!p || p.manual) continue;
      p.aiChecked = true;
      if (TURN_FOR[side]) { p.rot = (p.rot + TURN_FOR[side]) % 360; await applyRotation(p); }
    }
    if (draft === d) toast(r.brand ? `Recognised ${r.brand}` : "Filled in, check and save");
    if (r.brand) lookupBrand(r.brand).then((learnt) => learnt && rerenderAdd(d));
  } catch (err) {
    if (draft === d) toast(err.message || "Couldn't read the photos");
  }
  d.analysing = false;
  rerenderAdd(d);
}

/* ---------- Add from the label ---------- */
// One photo of the label or price tag fills the piece in. The QR code is read on the device
// (no tokens). With an AI key the printed text is read too: brand, reference, price, size,
// material (about 400 tokens). The shop's product page then gives the name and its photo,
// which becomes the piece's picture. Pull&Bear pages are found from the reference alone;
// other shops through the QR link, Google Shopping (SerpApi, no tokens) or the AI searching
// Google for the reference (about 300 tokens). The label photo itself isn't kept.
const TAG_LABEL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["brand", "name", "reference", "category", "color", "price", "currency", "size", "material"],
  properties: {
    brand: { type: "string", description: "Brand printed on the tag. If none is printed but the tag is surely a known chain's, that brand (H&M tags print no brand: just the price, 'TAILLE/TAGLIA/MAAT' sizes and an article line like '1101074 049 73 4 5828'). Else empty" },
    name: { type: "string", description: "Product name or short description if printed, e.g. 'Slim fit chinos'; empty if none" },
    reference: { type: "string", description: "Product reference, article or style number as printed, with its spaces and slashes, e.g. '3660/516/833', 'REF 7683 515 400', or H&M's whole article line '1101074 049 73 4 5828'; not the barcode number; empty if none" },
    category: { type: "string", enum: [...CATS.map((c) => c.id), "unknown"], description: "Type of garment if the tag makes it clear; unknown if not" }, // Gemini refuses an empty choice
    color: { type: "string", description: "Colour name if printed, in English, e.g. 'mid blue'; empty if none" },
    price: { type: "number", description: "Current selling price (the discounted one if there are two); 0 if none" },
    currency: { type: "string", description: "ISO code such as EUR, GBP, USD; empty if no price" },
    size: { type: "string", description: "This piece's size, e.g. M, 32/32, EU 42. Tags that list several sizes mark this one in bold, circled or ticked: give only that one. Empty if none" },
    material: { type: "string", description: "Composition, e.g. '100% cotton'; empty if none" },
  },
};
const tagInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", capture: "environment", hidden: true });
document.body.append(tagInput);
const tryInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", capture: "environment", hidden: true });
document.body.append(tryInput);
tryInput.onchange = () => { const f = tryInput.files[0]; tryInput.value = ""; if (f) tryPhoto(f); };
// Google Lens from the start of Add: the photo becomes the new piece's and is searched at once.
// Inside a piece without photos it joins the piece.
const lensInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", capture: "environment", hidden: true });
document.body.append(lensInput);
lensInput.onchange = async () => {
  const f = lensInput.files[0];
  lensInput.value = "";
  if (!f) return;
  const blob = await resizeImage(f);
  if (draft && (draft.photos.length || draft.id || draft.fromLabel)) {
    const p = newPhoto(blob);
    draft.photos.push(p);
    draft.active = draft.photos.length - 1;
    preparePhoto(p, draft);
  } else startDraft([blob]); // sets the new draft at once, then removes the background and recognises it
  lensSearch(draft, blob);
};
tagInput.onchange = () => {
  const f = tagInput.files[0];
  tagInput.value = "";
  if (!f) return;
  // From the start of Add, the label makes a new piece; inside a piece, it fills in what's missing.
  if (!draft || (!draft.photos.length && !draft.id && !draft.fromLabel)) { draft = { ...newDraft(), fromLabel: true }; go("add"); }
  scanTag(draft, f);
};

// Codes are read on the device: by the browser where it can (Android, Mac: QR codes and
// barcodes), else by jsQR (vendor/jsqr.min.js, Apache 2.0, loaded the first time; QR only).
// On a label photo the QR code is small next to other marks, so after the whole photo jsQR
// looks at overlapping parts of it, the way you'd hold a scanner closer.
let jsQRLoad;
const loadJsQR = () => (jsQRLoad ||= new Promise((ok, no) => {
  if (window.jsQR) return ok(window.jsQR);
  const s = Object.assign(document.createElement("script"), { src: "vendor/jsqr.min.js" });
  s.onload = () => (window.jsQR ? ok(window.jsQR) : no(new Error("jsQR didn't load")));
  s.onerror = () => { jsQRLoad = null; no(new Error("jsQR didn't load")); };
  document.head.append(s);
}));
// → { qr, barcode }: the QR code's text and the barcode's digits, each "" if not found.
async function readCodes(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
  const out = { qr: "", barcode: "" };
  if ("BarcodeDetector" in window) {
    try {
      const formats = (await BarcodeDetector.getSupportedFormats?.()) || ["qr_code"];
      const codes = await new BarcodeDetector({ formats: ["qr_code", "ean_13", "code_128", "itf", "upc_a"].filter((f) => formats.includes(f)) }).detect(bmp);
      out.qr = codes.find((c) => c.format === "qr_code")?.rawValue || "";
      out.barcode = codes.find((c) => c.format !== "qr_code" && /^\d{8,14}$/.test(c.rawValue))?.rawValue || "";
      if (out.qr) return out;
    } catch { /* this browser can't read codes */ }
  }
  const jsQR = await loadJsQR();
  const scale = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const W = Math.round(bmp.width * scale), H = Math.round(bmp.height * scale);
  const full = newCanvas(W, H);
  full.getContext("2d").drawImage(bmp, 0, 0, W, H);
  const look = (x, y, w, h, max) => {
    const k = Math.min(1, max / Math.max(w, h));
    const c = newCanvas(Math.round(w * k), Math.round(h * k));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(full, x, y, w, h, 0, 0, c.width, c.height);
    return jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: "attemptBoth" })?.data || "";
  };
  const tries = [[0, 0, W, H, 1200], [0, 0, W, H, 2400]];
  for (const n of [2, 3]) { // parts a half, then a third of the photo, overlapping by half
    const w = W / n, h = H / n;
    for (let y = 0; y + h <= H + 1; y += h / 2) for (let x = 0; x + w <= W + 1; x += w / 2) tries.push([x, y, w, h, 1000]);
  }
  for (const t of tries) {
    out.qr = look(...t);
    if (out.qr) break;
    await new Promise((r) => setTimeout(r)); // keep the screen responsive between parts
  }
  return out;
}
async function readTagText(file) {
  const text = await aiGenerate({
    system: "You read clothing price tags and labels for a wardrobe app. Reply with JSON only. Leave a field empty (or 0) rather than guess.",
    text: "Read this tag or label.",
    image: await resizeImage(file, 1024),
    schema: TAG_LABEL_SCHEMA,
    maxTokens: 220,
  });
  return JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
}
// The shop's page for the piece on the label: { page, ref, link, why }. Tries the QR link,
// then a link built from the reference, then Google Shopping, then the AI with Google Search.
// `why` says what went wrong when no page could be read.
// What a label points to: its QR link, reference, brand, and the product page they give.
function labelTarget(codes, tag) {
  const qrLink = Label.linkIn(codes.qr);
  const said = tag?.brand || "";
  const ref = Label.refFrom(tag?.reference, said) || Label.refInUrl(qrLink) || Label.refFromCode(codes.barcode) || (!qrLink && Label.refFrom(codes.qr, said)) || null;
  const brand = said || Label.brandOfRef(ref); // H&M tags print no brand, but their article line gives it away
  // A Pull&Bear tag's QR stands for the tag, not a page: its reference says which page.
  const fromCode = !!(Label.refInUrl(qrLink) || Label.refFromCode(codes.barcode));
  const built = Label.shopUrl(brand || qrLink || (fromCode && !brand ? "Pull&Bear" : ""), ref, state.settings.region);
  return { qrLink, ref, brand, built, link: built || (Label.isTagLink(qrLink) ? "" : qrLink) };
}
async function findProduct(codes, tag, step) {
  const { qrLink, ref, brand, built } = labelTarget(codes, tag);
  let best = null, why = "";
  const code = Label.photoCode(ref);
  const open = async (url) => {
    let page = await pageInfo(url, 45000, code);
    if (!page?.image && !page?.noServer) page = (await microlinkInfo(url)) || page;
    if (page?.noServer) throw Object.assign(new Error("Product pages can only be opened on the hosted app."), { noServer: true });
    if (page?.error) why = page.error;
    // A page built from a barcode alone must really be that product.
    if (url === built && !brand && page?.url && !page.url.includes(`l${ref.model}`)) return false;
    if (page?.title && (!best || (page.image && !best.image))) best = page;
    return !!page?.image;
  };
  const done = () => ({ page: best, ref, link: best?.url || built || (Label.isTagLink(qrLink) ? "" : qrLink), why });
  step("Opening the product page…");
  for (const url of [...new Set([Label.isTagLink(qrLink) ? "" : qrLink, built].filter(Boolean))]) if (await open(url)) return done();
  const words = [brand, tag?.name, ref?.text || tag?.reference].filter(Boolean).join(" ");
  if (!tag?.name && !ref && !tag?.reference) return done(); // nothing to look for
  if (productsOn() && brand && !built) { // a built link is the exact page; Shopping can't search by reference
    step("Looking it up on Google Shopping…");
    const it = state.settings.region === "it";
    const r = await fetch(`api/products?${new URLSearchParams({ q: words, gl: it ? "it" : "us", hl: it ? "it" : "en" })}`).catch(() => null);
    const items = (await r?.json().catch(() => null))?.items || [];
    const hit = items.find((p) => normBrand(p.shop).includes(normBrand(brand)) || normBrand(p.title).includes(normBrand(brand)));
    if (hit && (await open(hit.url))) return done();
    if (hit && !best?.image) best = { url: hit.url, title: hit.title, image: hit.image, images: [hit.image], price: hit.price, site: hit.shop };
    if (best?.image) return done();
  }
  if (aiReady() && !built) { // a built link is the right page already; searching would find the same one
    step("Searching the shop's website…");
    let sources = [];
    const text = await aiGenerate({
      system: "You find the official product page of a piece of clothing from what its label says. Use Google Search. If no brand is printed, work it out from the reference's format and what the search finds. Reply with the product page URL only.",
      text: [brand ? `Brand: ${brand}` : "No brand printed on the tag", tag?.name && `Name: ${tag.name}`, (tag?.reference || ref?.text) && `Reference: ${tag?.reference || ref.text}`,
        tag?.price > 0 && `Price: ${tag.price} ${tag.currency || ""}`.trim(), qrLink && `Its QR code links to ${qrLink}`].filter(Boolean).join("\n"),
      search: true, maxTokens: 120, onSources: (w) => (sources = w),
    }).catch(() => "");
    for (const url of [...new Set([Label.linkIn(text), ...sources.map((s) => s.uri)].filter(Boolean))].slice(0, 3)) if (await open(url)) break;
  }
  return done();
}
// Microlink, a free link-preview service (50 pages a day without a key), opens pages for shops
// that turn the app's server away. Asked from this device, so the 50 are this device's own.
async function microlinkInfo(url) {
  try {
    const r = await fetch(`https://api.microlink.io/?${new URLSearchParams({ url })}`, AbortSignal.timeout ? { signal: AbortSignal.timeout(12000) } : {});
    const d = (await r.json()).data;
    const image = /^https:\/\//.test(d?.image?.url || "") ? d.image.url : "";
    if (!image) return null;
    let host = "";
    try { host = new URL(d.url).hostname; } catch { /* no address given */ }
    return {
      url: host === new URL(url).hostname ? url : d.url || url, title: String(d.title || "").slice(0, 140), image, images: [image],
      description: String(d.description || "").slice(0, 300), color: "", brand: "", price: "", site: d.publisher || host.replace(/^www\./, ""),
    };
  } catch { return null; }
}
// A shop's photo, fetched through the app's server (shops don't let other sites copy them).
async function productPhoto(url) {
  try {
    const r = await fetch(`api/image?url=${encodeURIComponent(url)}`, AbortSignal.timeout ? { signal: AbortSignal.timeout(15000) } : {});
    if (!r.ok || !(r.headers.get("Content-Type") || "").startsWith("image/")) return null;
    return await resizeImage(await r.blob(), 1400);
  } catch { return null; }
}
// "Blu" on a pair of jeans means denim; colours shops use and the wardrobe doesn't become the closest one.
function wardrobeColour(text, category) {
  const c = colourIn(Label.toEnglish(text));
  const col = COLORS[c] ? c : EXTRA_COLOURS[c]?.[1] || "";
  return category === "jeans" && ["blue", "light blue", "navy"].includes(col) && !/navy|dark/.test(Label.toEnglish(text)) ? "denim" : col;
}
// What the AI finds about the product (the label rarely says the material or the fit). Shops
// like Pull&Bear hide their pages from servers, so Gemini also searches Google for it, with
// whatever the shop's page showed as a start (about 1,500 tokens). Claude reads the page only.
const searchesWeb = () => state.settings.aiProvider !== "claude" && !state.previewAI;
async function productDetails(page, link, tag, ref) {
  const what = [tag?.brand, Label.refWords(ref)].filter(Boolean).join(", ");
  const ask = "Reply with exactly these lines, in English, leaving a value empty when no source says it:\n" +
    "name: <product name as the shop writes it>\nbrand: <brand>\ntype: <garment type, e.g. jeans, hoodie>\ncolour: <colour>\nfit: <e.g. baggy, slim, regular>\n" +
    "material: <composition, e.g. 100% cotton>\ndescription: <one short sentence about the piece>\nprice: <price with currency>";
  const shown = page?.text ? page.text.slice(0, 4000) : [page?.title, page?.description].filter(Boolean).join("\n");
  let text;
  if (searchesWeb() && (link || what)) {
    const open = !!link && !page?.text; // the page's own text is better than Gemini's try at opening it
    const q = {
      system: "You find a clothing product's details for a wardrobe app. Search Google for the product (its reference and name)" + (open ? " and open its page with URL context" : "") + ". Never guess: leave a value empty if no source says it. Plain text only, no markdown.",
      text: `Product page: ${link || "unknown"}${what ? `\n(${what})` : ""}${shown ? `\nWhat the shop's page showed (it may be incomplete):\n${shown}` : ""}\n\n${ask}${open ? "\nphotos: <full addresses of the product's photos on the page, space separated>" : ""}`,
      maxTokens: 450,
      wait: 30000, // opening a page that turns Google away can hang
    };
    text = await aiGenerate({ ...q, search: true, urlContext: open }).catch(() => aiGenerate({ ...q, search: true }));
  } else if (shown) {
    text = await aiGenerate({
      system: "You read a clothing product page for a wardrobe app. Plain text only, no markdown.",
      text: `Product page${what ? ` (${what})` : ""}:\n${shown}\n\n${ask}`, maxTokens: 250,
    });
  } else return null;
  const out = {};
  for (const line of text.split("\n")) {
    const m = line.replace(/\*\*/g, "").match(/^\s*[-•]?\s*(name|brand|type|colou?r|fit|material|description|price|photos)\s*:\s*(.*)$/i);
    if (m) out[m[1].toLowerCase().replace("color", "colour")] = m[2].trim().replace(/^<.*>$|^(none|n\/a|unknown|not (stated|specified|available|found)|-)\.?$/i, "");
  }
  out.photos = (out.photos || "").match(/https:\/\/[^\s,<>"')]+/g) || [];
  return out;
}
// Which of the shop's photos show the piece on its own, not worn: they're put on one numbered
// sheet and the AI answers with the numbers (about 600 tokens). Best first: front, then back.
const PIECE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["piece_only"],
  properties: {
    piece_only: { type: "array", items: { type: "integer" }, description: "Numbers of the photos that show only the garment, with no person, face, hands, legs or body visible: laid flat, on a hanger or floating. Best first: the full front view, then the full back view. Leave out close-ups of details." },
  },
};
// A candidate photo is { url, thumb }: thumb is Google's small copy, used if the shop's won't load.
const shopPhoto = async (x) => (await productPhoto(x.url)) || (x.thumb ? await productPhoto(x.thumb) : null);
async function pieceOnlyPhotos(list, colour = "") {
  const got = (await Promise.all(list.slice(0, 8).map(async (x) => ({ url: x.url, blob: await shopPhoto(x) })))).filter((x) => x.blob);
  if (!got.length) return null; // none could be loaded: not the same as "all worn"
  const cols = Math.min(4, got.length), w = 240, h = 320;
  const c = newCanvas(cols * w, Math.ceil(got.length / cols) * h);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, c.width, c.height);
  for (const [k, x] of got.entries()) {
    const bmp = await createImageBitmap(x.blob);
    const sc = Math.min(w / bmp.width, h / bmp.height), cx = (k % cols) * w, cy = Math.floor(k / cols) * h;
    ctx.drawImage(bmp, cx + (w - bmp.width * sc) / 2, cy + (h - bmp.height * sc) / 2, bmp.width * sc, bmp.height * sc);
    ctx.fillStyle = "#000";
    ctx.fillRect(cx, cy, 44, 44);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 30px sans-serif";
    ctx.fillText(String(k + 1), cx + (k + 1 > 9 ? 4 : 13), cy + 33);
  }
  const text = await aiGenerate({
    system: "You sort a clothing shop's product photos for a wardrobe app. Reply with JSON only.",
    text: `These are ${got.length} numbered photos of one product. Which show the garment alone, not worn by anyone, and in ${colour || "the same colour as photo 1"}? Shops also show the other colours: leave those out.`,
    image: await canvasBlob(c, "image/jpeg", 0.85),
    schema: PIECE_SCHEMA,
    maxTokens: 60,
  });
  const nums = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim()).piece_only || [];
  return [...new Set(nums)].map((n) => got[n - 1]).filter(Boolean).slice(0, 2);
}
// The shop's photos from its page, as candidates: only this colour's when their names say it,
// the same photo in another size once, video stills last.
function photoCandidates(urls, ref) {
  const seen = new Set();
  let list = urls.filter((u) => {
    const key = /\.(jpe?g|png|webp)(\?|$)/i.test(u) ? u.split("?")[0] : u;
    return /^https:\/\//.test(u) && !seen.has(key) && seen.add(key);
  });
  if (ref?.colour && list.some((u) => Label.codeIn(u, ref))) list = list.filter((u) => Label.codeIn(u, ref));
  return list.sort((a, b) => /poster/i.test(a) - /poster/i.test(b)).map((url) => ({ url }));
}
// The shop's own photos of a reference, through Google Images, for shops that show their pages
// to no server (one search, kept two weeks on the server). Only photos named after the
// reference, or from its product page, so they're surely this piece in this colour.
async function galleryPhotos(ref, brand, name = "") {
  if (!productsOn() || !ref?.colour) return [];
  const it = state.settings.region === "it";
  // By reference first; then by the shop's product name, still keeping only this reference's photos.
  for (const q of [`${brand} ${ref.model}${ref.colour}`, `${brand} ${ref.text}`, name && `${brand} ${name}`].filter(Boolean)) {
    const r = await fetch(`api/photos?${new URLSearchParams({ q: q.trim(), gl: it ? "it" : "us", hl: it ? "it" : "en" })}`).catch(() => null);
    const j = await r?.json().catch(() => null);
    if (!r?.ok) {
      if (/^SerpApi/.test(j?.error || "")) productsDown = j.error;
      return [];
    }
    const hits = (j.items || []).filter((x) => {
      const page = Label.refInUrl(x.url);
      return Label.codeIn(x.image, ref) || (page?.model === ref.model && (!page.colour || page.colour === ref.colour));
    });
    if (hits.length) return hits.map((x) => ({ url: x.image || x.thumb, thumb: x.thumb }));
  }
  return [];
}
// Puts the shop's photos of the piece on its own first (`replace`: instead of the piece's
// photos). Says why when none could be kept.
async function useShopPhotos(d, list, { site, ref, colour, replace, step }) {
  let chosen = null;
  if (aiReady()) {
    step("Picking the photos of the piece on its own…");
    chosen = await pieceOnlyPhotos(list, colour).catch(() => null);
  }
  if (!chosen) { // no AI to tell worn photos apart (or it failed): the shop's main photo
    step("Getting the shop's photo…");
    const blob = await shopPhoto(list[0]);
    chosen = blob ? [{ url: list[0].url, blob }] : [];
  }
  if (!chosen.length) return aiReady() ? "The shop's photos all show it worn, so none was kept: take a photo of the piece." : "The shop's photo couldn't be loaded: take a photo of the piece.";
  if (draft !== d) return "";
  const shop = chosen.map((x) => ({ ...newPhoto(x.blob), manual: true, shop: true })); // shop photos are already upright
  d.photos = replace ? shop : [...shop, ...d.photos.filter((p) => !p.shop)];
  d.active = 0;
  d.shopPhoto = { site, otherColour: Label.photoColourMatches(chosen[0].url, ref) === false };
  if (replace) {
    d.keepColors = !!colour; // the label's colour wins over the colours in the photo
    if (!colour) d.colors = await detectColors(chosen[0].blob).catch(() => []);
  } else d.keepColors = d.keepColors || !!d.colors.length; // the colours already come from your own photo
  d.scanningTag = false;
  // Shop photos are usually on a plain light background already: removing it would gain nothing.
  (async () => { for (const p of shop) await preparePhoto(p, d, state.settings.autoCutout && !(await plainBackground(p.src))); })();
  return "";
}
// Fills a piece in from what's known about the product: its label (tag), the shop's page and
// what the AI found (info). Only fields still empty, unless `override` (a match picked in
// Google Lens: you chose that product). Returns the colour the shop gives, in wardrobe terms.
function fillFromProduct(d, { tag: r, page, info, ref, link, qr = "", override = false }) {
  const title = Label.cleanTitle(page?.title, r?.brand || page?.brand || info?.brand || "");
  const name = override ? info?.name || title : title || info?.name || r?.name || "";
  const words = Label.toEnglish(`${info?.type || ""} ${name}`);
  const about = `${words} ${Label.toEnglish(info?.fit)} ${Label.toEnglish(page?.description)} ${Label.toEnglish(info?.description)}`;
  // What the label says comes first, then the product page.
  const said = (r?.brand || page?.brand || info?.brand || (Label.isPullBear(page?.url || link || Label.linkIn(qr)) ? "Pull&Bear" : "")).trim();
  const brand = brandInfo(said)?.name || said; // "PULL&BEAR" on the tag → "Pull&Bear"
  if (brand && (override || !d.brand)) d.brand = brand;
  const kind = BUY_KINDS.find(([re]) => re.test(words)) || BUY_KINDS.find(([re]) => re.test(about));
  const cat = CAT[r?.category] ? r.category : kind?.[1];
  if (cat && (override || !d.category)) { d.category = cat; d.warmth = CAT[cat].warmth; }
  // The wardrobe's own simple name ("Light blue Pull&Bear jeans") is kept: shops' product
  // names often don't fit, so the shop's name goes in the notes.
  const fit = Label.fitIn(about);
  if (fit && (override || !d.fit)) d.fit = fitsFor(d).includes(fit) ? fit : fit === "baggy" && fitsFor(d).includes("oversized") ? "oversized" : fit === "oversized" && fitsFor(d).includes("baggy") ? "baggy" : d.fit;
  const pagePrice = [page?.price, info?.price].find((p) => /\d/.test(p || "")) || "";
  const price = r?.price > 0 ? r.price : parseFloat(pagePrice.replace(/[^\d.,]/g, "").replace(",", "."));
  if (price > 0 && (r?.price > 0 || override || !d.price)) { d.price = String(price); d.currency = ((r?.price > 0 ? r.currency : pagePrice.match(/[A-Z]{3}/)?.[0] || (/€/.test(pagePrice) ? "EUR" : "")) || "").toUpperCase(); }
  if (r?.size) d.size = r.size.trim();
  const material = r?.material || info?.material;
  if (material && (override || !d.material)) d.material = material.trim().slice(0, 120);
  const description = info?.description || "";
  const shopName = (info?.name || name).trim();
  if (!d.notes && (shopName || description)) d.notes = [shopName && d.name !== cap(shopName) && `Shop name: ${shopName}.`, description].filter(Boolean).join(" ").slice(0, 300);
  if (link && (override || !d.link)) d.link = link;
  if (ref) d.reference = ref.text;
  return wardrobeColour(r?.color || info?.colour || page?.color || name, d.category);
}
async function scanTag(d, file) {
  d.scanningTag = true;
  d.labelStep = "Reading the label…";
  const step = (s) => { d.labelStep = s; rerenderAdd(d); };
  rerenderAdd(d);
  const fresh = !d.photos.length;
  try {
    const [codes, tag] = await Promise.all([
      readCodes(file).catch(() => ({ qr: "", barcode: "" })),
      aiReady() ? readTagText(file).catch((e) => ({ error: e.message })) : null,
    ]);
    const qr = codes.qr;
    if (tag?.error && !qr && !codes.barcode) throw new Error(tag.error);
    const r = tag?.error ? null : tag;
    if (r && !r.brand) r.brand = Label.brandOfRef(Label.refFrom(r.reference)); // H&M: no brand on the tag
    let found = { page: null, ref: Label.refFrom(r?.reference, r?.brand), why: "" };
    // Gemini looks the product up on Google while the shop's page opens: shops that turn the
    // server away take half a minute to give up.
    const t = labelTarget(codes, r);
    const early = aiReady() && searchesWeb() && (t.link || (t.ref && t.brand)) ? productDetails(null, t.link, r, t.ref).catch((e) => ({ error: e.message })) : null;
    try { found = await findProduct(codes, r, step); } catch (e) { if (e.noServer) found.why = e.message; }
    const page = found.page;
    let info = null;
    if (early || (aiReady() && (page || found.link || (found.ref && r?.brand)))) {
      step("Reading the product details…");
      info = await (early || productDetails(page, found.link, r, found.ref).catch((e) => ({ error: e.message })));
    }
    const lookupError = info?.error || "";
    if (lookupError) info = null;
    const colour = fillFromProduct(d, { tag: r, page, info, ref: found.ref, link: found.link, qr });
    const known = Label.cleanTitle(page?.title) || info?.name || page?.image; // the page may give a photo but no name
    // Said under the Label button until the next scan, so it isn't missed like a toast.
    d.labelNote = known ? "" : [
      found.ref || qr ? `Couldn't open the product page${found.why ? ` (${found.why.replace(/\.$/, "")})` : ""}.` : "No QR code or reference found on that photo. Try again closer, with the QR code and the ART./REF number sharp.",
      tag?.error ? `${aiName()} couldn't read the printed text: ${tag.error}` : "",
      lookupError ? `${aiName()} couldn't look it up: ${lookupError}` : "",
      found.ref ? `Reference ${found.ref.text}.` : "",
    ].filter(Boolean).join(" ");
    if (colour && (fresh || !d.colors.length)) d.colors = [colour];
    refreshStyles();
    if (d.brand) lookupBrand(d.brand).then((learnt) => learnt && (refreshStyles(), rerenderAdd(d)));
    if (fresh) {
      let list = photoCandidates([...(page?.images || []), ...(info?.photos || [])], found.ref);
      if (list.length < 3 && found.ref && productsOn()) { // a page shares one or two photos; Google has the whole gallery
        step("Finding the shop's photos on Google…");
        const more = (await galleryPhotos(found.ref, d.brand, info?.name)).filter((x) => !list.some((y) => y.url.split("?")[0] === x.url.split("?")[0]));
        list = [...list, ...more];
      }
      const note = list.length
        ? await useShopPhotos(d, list, { site: page?.site || Label.siteOf(found.link), ref: found.ref, colour, replace: true, step })
        : !known ? ""
        : productsOn() ? "Google has no photos of this one yet: take a photo of the piece, then Google Lens can find its shop photos."
        : "The shop doesn't show its photos to the app's server. With the free SerpApi key on the server (see Settings > Look) they come through Google instead. For now, take a photo of the piece.";
      if (note) d.labelNote = [d.labelNote, note].filter(Boolean).join(" ");
      // The shop's page and Google said too little: the AI looks at the shop's photo instead,
      // as it does for your own photos (about 600 tokens).
      if (d.photos[0]?.shop && (!d.category || !colour) && aiReady() && draft === d) {
        d.scanningTag = true;
        step("Recognising the piece in the photo…");
        const t = await aiTagPhoto(d.photos[0].orig).catch(() => null);
        if (t && draft === d) {
          if (!d.category && CAT[t.category]) { d.category = t.category; d.warmth = CAT[t.category].warmth; }
          if (!d.fit && FITS[t.fit] && fitsFor(d).includes(t.fit)) d.fit = t.fit;
          const cols = (t.colors || []).filter((c) => COLORS[c]).slice(0, 3);
          if (!colour && cols.length) { d.colors = cols; d.keepColors = true; } // better than the pixels: navy isn't black
          refreshStyles();
        }
      }
    }
    if (draft === d) {
      const what = [d.name || autoName(d) || d.brand, (page?.site || found.link) && `from ${page?.site || Label.siteOf(found.link)}`].filter(Boolean).join(" ");
      toast(known ? `Found ${what}` : found.ref ? `Read the label, but couldn't open the product page${fresh ? ". Take a photo of the piece" : ""}` : r || qr ? "Read the label" : aiReady() ? "Nothing readable on that label" : "No QR code found. Add a Gemini key in Settings to read the printed text too.");
    }
  } catch (err) {
    if (draft === d) toast(err.message || "Couldn't read the label");
  }
  d.scanningTag = false;
  d.labelStep = "";
  rerenderAdd(d);
}

/* ---------- Google Lens ----------
   A photo of the piece finds it in the shops, like Google Lens on a phone: one SerpApi search
   (free plan, 250 a month), no AI tokens. You tap the one you have; then the AI reads its
   details and the shop's photos of the piece on its own go first. */
const LENS_OFF = "Google Lens needs the free SerpApi key on the server: add it as the SERPAPI_KEY secret (Settings > Look says how).";
async function lensSearch(d, blob) {
  if (!state.serverKeys.products) { d.labelNote = LENS_OFF; return rerenderAdd(d); }
  d.lens = { busy: true, items: [] };
  d.labelNote = "";
  rerenderAdd(d);
  try {
    const it = state.settings.region === "it";
    const r = await fetch(`api/lens?${new URLSearchParams({ hl: it ? "it" : "en", country: it ? "it" : "us" })}`, {
      method: "POST", headers: { "Content-Type": "image/jpeg" }, body: await resizeImage(blob, 1024),
      ...(AbortSignal.timeout ? { signal: AbortSignal.timeout(90000) } : {}),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `The app's server answered ${r.status}.`);
    d.lens = { items: j.items || [] };
    if (!d.lens.items.length) d.labelNote = "Google Lens found no shop selling it. Try again with the whole piece in the photo, flat and in good light.";
  } catch (e) {
    d.lens = null;
    if (/^SerpApi/.test(e.message)) productsDown = e.message;
    d.labelNote = `Google Lens didn't work: ${e.message.replace(/\.$/, "")}.`;
  }
  rerenderAdd(d);
}
// Google Lens's matches, above the form: tap the one you have. Once picked they fold into one line.
function lensHTML(d) {
  const l = d.lens;
  if (!l) return "";
  if (l.busy) return `<div class="row"><div class="spinner"></div><span class="muted">Searching the shops with Google Lens…</span></div>`;
  if (!l.items.length) return "";
  const picked = l.items[l.picked];
  if (picked && !l.open) return `<div class="row"><span class="muted small" style="flex:1;min-width:0">From Google Lens: ${esc([picked.title, picked.shop].filter(Boolean).join(" · "))}</span><button class="chip" data-act="lens-more">Other matches</button></div>`;
  return `<div class="field"><label>Google Lens found <span style="text-transform:none;font-weight:400">(tap the one you have)</span></label>
    <div class="real">${l.items.map((m, k) => `<button class="real-card lens-card" data-lens="${k}" aria-pressed="${l.picked === k}" ${d.scanningTag ? "disabled" : ""}><img class="real-img" src="${esc(m.thumb)}" referrerpolicy="no-referrer" loading="lazy" alt=""><b>${esc(m.title)}</b><span class="muted small">${esc([m.shop, m.price].filter(Boolean).join(" · "))}</span></button>`).join("")}</div></div>`;
}
async function pickLens(d, k) {
  const m = d.lens?.items?.[k];
  if (!m || d.scanningTag) return;
  d.lens.picked = k;
  d.lens.open = false;
  d.scanningTag = true;
  const step = (s) => { d.labelStep = s; rerenderAdd(d); };
  try {
    const ref = Label.refInUrl(m.url);
    const site = m.shop || Label.siteOf(m.url);
    step("Opening the product page…");
    const got = await pageInfo(m.url, 20000, ref?.colour ? Label.photoCode(ref) : ""); // shops that block the server are skipped after 20 s
    const lensPage = { url: m.url, title: m.title, image: m.image, images: [m.image].filter(Boolean), price: m.price, site, description: "" };
    const page = got?.title ? { ...lensPage, ...got, images: [...(got.images || []), ...lensPage.images], price: got.price || m.price, site: got.site || site } : lensPage;
    let info = null;
    if (aiReady()) {
      step("Reading the product details…");
      info = await productDetails(page, m.url, null, ref).catch(() => null);
    }
    const colour = fillFromProduct(d, { page, info, ref, link: m.url, override: true });
    if (colour && !d.colors.length) d.colors = [colour];
    refreshStyles();
    if (d.brand) lookupBrand(d.brand).then((learnt) => learnt && (refreshStyles(), rerenderAdd(d)));
    let list = photoCandidates([...page.images, ...(info?.photos || [])], ref).map((x) => (x.url === m.image ? { ...x, thumb: m.thumb } : x));
    if (ref?.colour && list.length < 3 && productsOn()) { // Lens shows one photo; the shop has its whole gallery on Google
      step("Finding the shop's photos on Google…");
      const more = (await galleryPhotos(ref, d.brand)).filter((x) => !list.some((y) => y.url.split("?")[0] === x.url.split("?")[0]));
      list = [...list, ...more];
    }
    d.labelNote = list.length ? await useShopPhotos(d, list, { site: page.site, ref, colour, replace: !d.photos.length, step }) : "";
    if (draft === d) toast(`Filled in from ${page.site || "the shop"}`);
  } catch (e) {
    if (draft === d) toast(e.message || "Couldn't read that product");
  }
  d.scanningTag = false;
  d.labelStep = "";
  rerenderAdd(d);
}
function fmtPrice(n, currency) {
  const cur = currency || (state.settings.region === "it" ? "EUR" : "");
  try { if (cur) return new Intl.NumberFormat(undefined, { style: "currency", currency: cur }).format(n); } catch { /* unknown code */ }
  return `${Math.round(n * 100) / 100}${cur ? ` ${cur}` : ""}`;
}

// Front and back are usually taken within a minute of each other, so gallery photos are
// paired by the time they were taken: from camera file names like PXL_20261012_132131204.jpg
// or IMG_20261012_132131.jpg, else the file date, else the order they were chosen in.
function photoTime(f) {
  const m = f.name.match(/(20\d{2})(\d{2})(\d{2})[_-]?(\d{2})(\d{2})(\d{2})/);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() : f.lastModified;
}
function pairPhotos(files) {
  const list = [...files].map((f) => ({ f, t: photoTime(f) })).sort((a, b) => a.t - b.t);
  const timed = list.length > 1 && list.at(-1).t - list[0].t > 2000;
  const groups = [];
  for (const x of list) {
    const g = groups.at(-1);
    if (g && g.length < 2 && (!timed || x.t - g.last < 90e3)) { g.push(x.f); g.last = x.t; }
    else groups.push(Object.assign([x.f], { last: x.t }));
  }
  return groups;
}
async function handleFiles(files, fromCamera) {
  files = [...files];
  if (!files.length) return;
  if (fromCamera && !addingExtraPhoto) {
    const blob = await resizeImage(files[0]);
    if (!pendingShots.length) { pendingShots = [blob]; return go("add"); }
    const shots = [pendingShots[0], blob];
    pendingShots = [];
    return startDraft(shots);
  }
  toast("Preparing photos…");
  if (addingExtraPhoto && draft) {
    addingExtraPhoto = false;
    const d = draft;
    const added = (await Promise.all(files.map((f) => resizeImage(f)))).map(newPhoto);
    d.photos.push(...added);
    d.active = d.photos.length - 1;
    render();
    for (const p of added) await preparePhoto(p, d);
    return;
  }
  const groups = pairPhotos(files);
  queue = groups.slice(1);
  await startDraft(await Promise.all(groups[0].map((f) => resizeImage(f))));
}
camInput.onchange = () => { handleFiles(camInput.files, true); camInput.value = ""; };
galInput.onchange = () => { handleFiles(galInput.files, false); galInput.value = ""; };

/* ---------- In-app camera: front, then back ---------- */
// Uses the tablet's camera inside the app (needs https or localhost). If it isn't available,
// the system camera opens instead, once for the front and once for the back.
let liveCamera = !!navigator.mediaDevices?.getUserMedia;
const cam = { el: null, stream: null, shots: [] };
async function startShooting() {
  if (!liveCamera) return camInput.click();
  if (!cam.el) {
    cam.el = document.createElement("div");
    cam.el.className = "cam";
    cam.el.innerHTML = `
      <video playsinline muted autoplay></video>
      <div class="cam-guide" aria-hidden="true"><span>▲ Collar or waistband this way</span></div>
      <div class="cam-top"><b class="cam-step"></b><button class="btn icon-btn" data-cam="close" aria-label="Close camera"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></div>
      <div class="cam-bar">
        <div class="cam-thumbs"></div>
        <button class="shutter" data-cam="snap" aria-label="Take photo"></button>
        <button class="btn" data-cam="skip">No back photo</button>
      </div>`;
    document.body.append(cam.el);
  }
  cam.shots = [];
  try {
    cam.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1920 } } });
  } catch {
    liveCamera = false;
    cam.el.hidden = true;
    toast("The camera can't open inside the app here. Tap Take photos again to use the system camera.");
    return;
  }
  cam.el.querySelector("video").srcObject = cam.stream;
  cam.el.hidden = false;
  updateCamera();
}
function updateCamera() {
  const back = cam.shots.length === 1;
  cam.el.querySelector(".cam-step").textContent = back ? "2 of 2 · Back: flip it over" : "1 of 2 · Front";
  cam.el.querySelector('[data-cam="skip"]').hidden = !back;
  cam.el.querySelector(".cam-thumbs").innerHTML = cam.shots.map((b) => `<img src="${photoURL(b)}" alt="">`).join("");
}
function stopCamera() {
  cam.stream?.getTracks().forEach((t) => t.stop());
  cam.stream = null;
  if (cam.el) cam.el.hidden = true;
}
async function snap() {
  const v = cam.el.querySelector("video");
  if (!v.videoWidth) return;
  const c = newCanvas(v.videoWidth, v.videoHeight);
  c.getContext("2d").drawImage(v, 0, 0);
  cam.el.classList.add("flash");
  setTimeout(() => cam.el.classList.remove("flash"), 150);
  cam.shots.push(await resizeImage(await canvasBlob(c, "image/jpeg", 0.92)));
  if (cam.shots.length < 2) return updateCamera();
  finishShooting();
}
function finishShooting() {
  const shots = cam.shots;
  stopCamera();
  if (!shots.length) return;
  go("add");
  startDraft(shots);
}

async function saveDraft(next = false) {
  const d = draft;
  const existing = d.id && state.items.find((i) => i.id === d.id);
  const tags = d.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const styles = d.styles.length ? d.styles : guessStyles({ brand: d.brand, category: d.category, tags });
  const anyCut = d.photos.some((p) => p.useCut && p.cut);
  const item = {
    ...(existing || { id: uid(), createdAt: new Date().toISOString(), wearCount: 0, lastWorn: null, favorite: false }),
    name: d.name.trim() || autoName(d) || "Untitled piece",
    category: d.category, colors: d.colors, brand: d.brand.trim(), styles, formality: formalityOf(styles),
    warmth: +d.warmth, tags, notes: d.notes.trim(),
    fit: (fitsFor(d).includes(d.fit) ? d.fit : "") || guessFit({ category: d.category, tags }),
    price: parseFloat(String(d.price ?? "").replace(",", ".")) || undefined, currency: d.currency || undefined,
    size: (d.size || "").trim() || undefined, material: (d.material || "").trim() || undefined,
    link: d.link || undefined, reference: d.reference || undefined,
    photos: d.photos.map(shown),
    originals: anyCut ? d.photos.map((p) => p.orig) : undefined,
    cutGeo: anyCut && d.photos.some((p) => p.useCut && p.geo) ? d.photos.map((p) => (p.useCut && p.cut ? geoList(p.geo) : null) || null) : undefined,
    aiChecked: existing?.aiChecked || d.photos.some((p) => p.aiChecked) || undefined,
  };
  if (d.look) applyLook(item, d.look);
  // Added from Must-Buy's Bought, or the only piece you bought in this type that isn't in yet.
  const sameType = !existing && !d.want ? pendingBuys(true).filter((w) => w.cat === item.category) : [];
  await store.put("items", item);
  if (existing) Object.assign(existing, item); else state.items.push(item);
  const bought = (d.want && state.wants.find((w) => w.id === d.want)) || (sameType.length === 1 ? sameType[0] : null);
  if (bought) { bought.boughtItemId = item.id; await store.put("wants", bought); state.buying = null; }
  lookupBrand(item.brand);
  state.outfits = [];
  toast(existing ? "Saved" : `Added ${item.name}`);
  draft = null;
  if (queue.length) {
    const group = queue.shift();
    return startDraft(await Promise.all(group.map((f) => resizeImage(f))));
  }
  if (next) { go("add"); return startShooting(); }
  go("wardrobe");
}

/* ---------- Discover / shop ---------- */
// Four tabs: ideas for you (each in a few versions), "Try a piece" (something you'd like,
// checked against your wardrobe), "Shop trip" (only what the shops in a mall or one shop
// sell) and "New look" (a complete outfit of new pieces). Pieces you don't own yet are
// drawn in their colour for free; "Real photos" looks up actual products when tapped.

// Colours that shops use but the wardrobe doesn't, and the wardrobe colour they act like.
const EXTRA_COLOURS = {
  camel: ["#b5885a", "beige"], rust: ["#a0522d", "orange"], "forest green": ["#2e5539", "green"], stone: ["#c8bea9", "beige"],
  khaki: ["#a39a6c", "olive"], tan: ["#b08458", "brown"], indigo: ["#283862", "navy"], "light-wash": ["#9db8d3", "denim"],
  ecru: ["#ece3cf", "cream"], sand: ["#d8c6a1", "beige"],
};
const colourHex = (c) => COLORS[c]?.hex || EXTRA_COLOURS[c]?.[0] || "";
const ALL_COLOURS = [...Object.keys(COLORS), ...Object.keys(EXTRA_COLOURS)].sort((a, b) => b.length - a.length);
// The first colour named in a text: "Light blue Oxford shirt" → "light blue".
function colourIn(text) {
  const t = ` ${String(text || "").toLowerCase().replace(/\bgray\b/g, "grey").replace(/light[ -]wash/g, "light-wash")} `;
  return ALL_COLOURS.find((c) => new RegExp(`[^a-z-]${escRe(c)}[^a-z-]`).test(t)) || "";
}
const CAT_ICON = {
  tshirt: "tee", polo: "tee", shirt: "shirt", sweatshirt: "hoodie", hoodie: "hoodie", "zip-hoodie": "hoodie", sweater: "knit",
  overshirt: "jacket", jacket: "jacket", rain: "jacket", coat: "coat", puffer: "coat", jeans: "trousers", trousers: "trousers",
  joggers: "trousers", shorts: "shorts", skirt: "skirt", sneakers: "shoe", "dress-shoes": "shoe", boots: "boot",
  cap: "cap", hat: "cap", "bucket-hat": "cap", beanie: "beanie", beret: "beanie", watch: "watch", sunglasses: "glasses",
  bracelet: "jewel", necklace: "jewel", ring: "jewel", belt: "belt", bag: "bag", backpack: "bag", wallet: "wallet",
  scarf: "scarf", tie: "tie", umbrella: "umbrella", socks: "socks", underwear: "underwear",
  "gym-top": "tee", "tank-top": "tee", "long-sleeve-top": "tee", "sports-bra": "tee", "gym-hoodie": "hoodie", "track-jacket": "jacket",
  "gym-shorts": "shorts", leggings: "trousers", "track-pants": "trousers", "training-shoes": "shoe", "gym-bag": "bag", "gym-gear": "dumbbell",
};
// A drawing of a piece you don't own, filled with its colour.
function garmentArt(b) {
  const c = b.color || colourIn(b.title);
  const hex = colourHex(c) || "#d9d3ca";
  const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const light = 0.299 * r + 0.587 * g + 0.114 * bl > 150;
  const icon = CAT_ICON[b.cat] || buyKind(b.title || "").icon;
  return `<svg class="art" viewBox="0 0 24 24" aria-hidden="true"><path d="${KIND_ICON[icon] || KIND_ICON.hanger}" style="fill:${hex};stroke:${light ? "#7d7468" : "#1b1712"};stroke-width:.45;stroke-linejoin:round;stroke-linecap:round"/></svg>`;
}
const artTile = (b) => `<div class="art-tile"${prodAttr(b)}>${tileInner(b)}</div>`;

// Something to buy: { cat, color, title, query }. Shop searches add who it's for (forWho).
// "Grey grey wool crewneck sweater", "Grey silver chain necklace": the colour isn't added when the noun
// already has a colour or metal, nor the brand when the noun starts with it, and no word comes twice in a row.
const dedupeWords = (s) => String(s || "").replace(/\b([\w&'-]+)(\s+\1\b)+/gi, "$1");
const METALS = ["silver", "gold", "rose gold", "gunmetal", "bronze", "copper"];
function mkIdea({ cat, color = "", noun = "", brand = "", fit = "", title = "", why = "", styles }) {
  const n = ` ${(noun || "").toLowerCase()} `;
  const says = (w) => w && n.includes(` ${String(w).toLowerCase()} `);
  const colourInNoun = [...Object.keys(COLORS), ...Object.keys(EXTRA_COLOURS), ...METALS].some(says);
  const words = dedupeWords([n.trim().startsWith(String(brand).toLowerCase()) && brand ? "" : brand, colourInNoun ? "" : color, fit ? FITS[fit]?.label.toLowerCase() : "", noun || catLabel(cat).toLowerCase()].filter(Boolean).join(" "));
  return { cat, color, brand, fit, styles, noun, title: title || cap(words), query: title ? [brand, title].filter(Boolean).join(" ") : words, why };
}
// The same idea as a wardrobe piece, so the outfit rules can try it with what you own.
// It counts as worn ten days ago: no "never worn" bonus, no "worn yesterday" penalty.
function asPiece(b) {
  const styles = b.styles?.length ? b.styles : brandInfo(b.brand)?.styles?.length ? brandInfo(b.brand).styles : CAT[b.cat]?.styles || [];
  const c = COLORS[b.color] ? b.color : EXTRA_COLOURS[b.color]?.[1];
  return {
    id: "new", isNew: true, name: b.title, category: b.cat, colors: c ? [c] : [], styles, formality: formalityOf(styles),
    warmth: CAT[b.cat]?.warmth || 2, fit: b.fit || undefined, tags: [], photos: b.photo ? [b.photo] : [],
    wearCount: 1, lastWorn: new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10), idea: b,
  };
}
// Pieces you own that could be worn with it (other parts of an outfit) and those that go well.
const wornWith = (piece) => state.items.filter((o) => CORE.includes(roleOf(o)) && roleOf(o) !== roleOf(piece) && (slotOf(o) === "gym") === (slotOf(piece) === "gym"));
const matchesFor = (piece) => wornWith(piece).filter((o) => pairScore(piece, o) >= 2);
const goesLine = (n) => (n ? `Goes with ${n} of your pieces` : "Hard to match with what you own");

// The versions of a "Worth adding" idea, the one that goes with most of your pieces first,
// leaning away from what you've said no to. Colours you turned down for it are left out.
function variantsOf(s) {
  if (!s.cat) return [{ ...s, cat: buyKind(s.title).cat, n: goesWith(s.title).length }];
  return s.colors.map((color, i) => {
    const b = { ...mkIdea({ cat: s.cat, color, noun: s.noun, why: s.why, styles: s.styles }), lifts: s.lifts };
    const piece = asPiece(b);
    const match = wornWith(piece).reduce((a, o) => a + pairScore(piece, o), 0) + shopScore(b) * 3;
    return { ...b, n: matchesFor(piece).length, match, i };
  }).filter((b) => wantOf(b)?.reason !== "colour").sort((a, b) => b.match - a.match || a.i - b.i);
}

/* Shop trip: what the shops sell, in a few groups the AI is asked to use. */
const SELL_GROUPS = ["tops", "shirts", "knitwear", "jackets", "coats", "jeans", "trousers", "shorts", "sneakers", "boots", "smart shoes", "accessories", "sportswear"];
const GROUP_OF = {
  tshirt: "tops", polo: "tops", sweatshirt: "tops", hoodie: "tops", "zip-hoodie": "tops", shirt: "shirts", overshirt: "shirts",
  sweater: "knitwear", jacket: "jackets", rain: "jackets", coat: "coats", puffer: "coats", jeans: "jeans", trousers: "trousers",
  joggers: "trousers", skirt: "trousers", shorts: "shorts", sneakers: "sneakers", boots: "boots", "dress-shoes": "smart shoes",
};
const groupOf = (cat) => GROUP_OF[cat] || (CAT[cat]?.slot === "gym" ? "sportswear" : "accessories");
const sellsIt = (store, b) => !store.sells?.length || store.sells.includes(groupOf(b.cat || buyKind(b.title || "").cat));
// The shops on the trip that sell it, or null when no trip is planned.
const tripStores = (b) => (state.trip ? state.trip.stores.filter((st) => sellsIt(st, b)) : null);
// A search on the shop's own website, through Google: works for any shop in any country.
const storeLink = (st, query) => `https://www.google.com/search?q=${encodeURIComponent(st.domain ? `${forWho(query)} site:${st.domain}` : `${st.name} ${forWho(query)}`)}`;
function shopsFor(b) {
  const st = tripStores(b);
  // The shop a new look named for this piece comes first.
  return st ? st.sort((x, y) => (y.name === b.store) - (x.name === b.store)).map((x) => [x.name, storeLink(x, b.query)]) : shopLinks(b.query);
}
const soldHere = (b) => !state.trip || tripStores(b).length > 0;

function renderShop() {
  const d = state.disc;
  if (d.tab === "foryou" && !d.auditBusy) setTimeout(autoAudit, 0);
  const must = mustBuy().length;
  const evs = upcomingEvents().length;
  const tabs = [["foryou", "For you"], ["must", `Must-Buy${must ? ` <span class="muted">${must}</span>` : ""}`], ["events", `Events${evs ? ` <span class="muted">${evs}</span>` : ""}`], ["explore", "Explore"]];
  const exploring = ["try", "trip", "look"].includes(d.tab);
  const sub = {
    foryou: "What your wardrobe is missing, or ask for something. Yes goes to Must-Buy, no teaches it what to skip.",
    must: "What you said yes to, by how many new outfits each piece unlocks with what you own.",
    events: "Something coming up? Get its dress code, an outfit from your wardrobe for the weather that day, and what's missing.",
    try: "Thinking of buying something? See what it goes with first.",
    trip: "Going to a mall or a shop? See only what you can buy there.",
    look: "A complete outfit of new pieces for the season, style and occasion you pick.",
  }[d.tab];
  main.innerHTML = `
    <div class="head"><div><h1>Discover</h1><p class="sub">${sub}</p></div></div>
    <div class="chips disc-tabs" role="tablist">${tabs.map(([k, l]) => { const on = d.tab === k || (k === "explore" && exploring); return `<button class="chip" role="tab" aria-selected="${on}" aria-pressed="${on}" data-disc="${k === "explore" ? d.explore || "try" : k}">${l}</button>`; }).join("")}</div>
    ${exploring ? `<div class="seg" role="tablist">${[["try", "Try a piece"], ["trip", "Shop trip"], ["look", "New look"]].map(([k, l]) => `<button role="tab" aria-selected="${d.tab === k}" data-disc="${k}">${l}</button>`).join("")}</div>` : ""}
    ${state.trip && d.tab !== "trip" ? tripBar() : ""}
    <div class="stack">${({ foryou: forYouTab, must: mustTab, events: eventsTab, try: tryTab, trip: tripTab, look: lookTab })[d.tab]()}</div>`;
}
const tripBar = () => `<div class="card row trip-bar"><span>Showing only what you can buy at <b>${esc(state.trip.name.split(",")[0])}</b></span><button class="chip" data-disc="trip">Change</button><button class="chip" data-act="trip-clear">Show all shops</button></div>`;

// One idea in a few versions: pick a version to see what it goes with, where to buy it and real photos.
function ideaBlock(key, { label = "", title, why = "", options }) {
  const sel = Math.min(state.disc.pick[key] || 0, options.length - 1);
  const b = options[sel];
  return `<div class="idea">
    ${label ? `<span class="prio">${label}</span>` : ""}
    <h3>${esc(title)}</h3>${why ? `<p class="muted">${esc(why)}</p>` : ""}
    ${options.length > 1 ? `<div class="options">${options.map((o, i) => `<button class="option" data-pick="${esc(key)}:${i}" aria-pressed="${i === sel}">
      ${artTile(o)}<b>${esc(o.color ? cap(o.color.replace("-", " ")) : o.title)}</b><span class="muted small">${goesLine(o.n)}</span>${i === 0 ? `<span class="badge">Best match</span>` : ""}
    </button>`).join("")}</div>` : `<div class="options one">${artTile(b)}</div>`}
    ${ideaDetail(b)}
  </div>`;
}
function ideaDetail(b, { withPieces = true } = {}) {
  const pieces = withPieces ? goesWithPiece(asPiece(b)) : [];
  const shops = shopsFor(b);
  return `<div class="idea-detail">
    ${pieces.length ? `<div class="goes-with"><span class="muted small">${esc(b.title)} goes with</span><div class="pieces mini">${pieces.map(pieceTile).join("")}</div></div>` : ""}
    ${multiplierLine(b) || (b.lifts ? `<div class="multi"><b>${b.lifts}</b><span>of your outfits it would finish</span></div>` : "")}
    <div class="shops">${shops.slice(0, state.trip ? 8 : 4).map(([n, u]) => `<a class="btn" href="${u}" target="_blank" rel="noopener">${esc(n)}</a>`).join("")}${realBtn(b)}</div>
    ${verdictHTML(b)}
    ${photosHTML(b)}
  </div>`;
}

/* ---- Must-Buy ----
   Every suggestion in the app (For you, Try a piece, New look, the stylist's buys) can be
   answered: "Yes, I like this" puts it on Must-Buy, "No" (with an optional reason) teaches
   the ideas what to leave out. Answers are records in "wants", shared by every device:
   { id, sig, kind, title, cat, noun, color, fit, styles, query, why, source, status
     (wanted | rejected | snoozed | bought), reason, until, createdAt, decidedAt, boughtItemId } */
const REASONS = [["style", "Not my style"], ["colour", "Colour"], ["similar", "I have something similar"], ["price", "Too pricey"], ["later", "Not now"]];
const REASON_WORDS = Object.fromEntries(REASONS);
// The same idea always gets the same id, so it's never asked twice, even from two devices.
function sigOf(b) {
  const cat = b.cat || buyKind(b.title || "").cat;
  const color = b.color || colourIn((b.title || "").toLowerCase()) || "";
  const noun = (b.noun || (b.title || "").toLowerCase().replace(color, "")).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  return `${cat}|${noun}|${color}`;
}
const wantId = (b) => "w" + hashText(sigOf(b));
function hashText(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = (h * 33) ^ str.charCodeAt(i);
  return (h >>> 0).toString(36);
}
const wantOf = (b) => state.wants.find((w) => w.id === wantId(b));
const mustBuy = () => state.wants.filter((w) => w.status === "wanted");
// Answered, so it leaves the For you feed: a no for its colour only hides that version.
function settled(s) {
  const opts = s.cat ? s.colors.map((color) => mkIdea({ cat: s.cat, color, noun: s.noun })) : [{ ...s, cat: buyKind(s.title).cat }];
  const ws = opts.map(wantOf);
  const open = (w) => !w || w.id === state.whyNo || (w.status === "snoozed" && Date.now() > Date.parse(w.until)) || (w.status === "rejected" && w.reason === "colour");
  return !ws.every(open) || ws.every((w) => w?.reason === "colour");
}
async function answerWant(b, status) {
  const id = wantId(b);
  let w = state.wants.find((x) => x.id === id);
  const now = new Date().toISOString();
  if (!w) {
    const cat = b.cat || buyKind(b.title || "").cat;
    w = {
      id, sig: sigOf(b), kind: cat === "fragrance" ? "fragrance" : ["acc", "head"].includes(CAT[cat]?.slot) ? "accessory" : "garment",
      ...(b.scent && { scent: b.scent }),
      title: b.title, cat, noun: b.noun || "", color: b.color || colourIn((b.title || "").toLowerCase()) || "", fit: b.fit || "",
      styles: b.styles || [], query: b.query || b.title, why: b.why || "", source: { type: b.source || (view === "shop" ? state.disc.tab : view) }, createdAt: now,
    };
    state.wants.push(w);
  }
  Object.assign(w, { status, decidedAt: now });
  // Needed for an event: Must-Buy sorts it up as the day gets closer.
  if (status === "wanted" && b.eventId) Object.assign(w, { eventId: b.eventId, needBy: b.needBy });
  state.disc.feedMemo = null;
  delete w.reason;
  delete w.until;
  await store.put("wants", w);
  shopMemo = null;
  return w;
}
// The wishlist from before Must-Buy, moved over once (on whichever device opens first).
async function moveWishlist() {
  if (!state.wishlist?.length) return;
  for (const b of state.wishlist) if (b?.title && !wantOf(b)) await answerWant({ ...b, source: "wishlist" }, "wanted");
  state.wishlist = [];
  await saveWishlist();
}

// What your answers teach, as points per trait (type, noun, colour, style, fit). A no counts
// only against what its reason names; "Not now" and "Too pricey" teach nothing. Half as much after 180 days.
let shopMemo = null;
function shopTaste() {
  if (shopMemo) return shopMemo;
  const traits = {};
  const add = (k, v) => (traits[k] = (traits[k] || 0) + v);
  for (const w of state.wants) {
    if (w.id === state.whyNo) continue; // its reason isn't in yet, and the idea stays as it was until it is
    const d = 0.5 ** (daysSince(w.decidedAt) / 180);
    const tr = wantTraits(w);
    if (w.status === "wanted" || w.status === "bought") { for (const k of Object.values(tr)) if (k) add(k, 0.5 * d); continue; }
    if (w.status !== "rejected") continue;
    const keys = { style: [tr.noun, tr.fit, ...tr.styles], colour: [tr.colour], similar: [tr.typeColour] }[w.reason] || (w.reason ? [] : [tr.noun, tr.typeColour]);
    for (const k of keys.filter(Boolean)) add(k, -1 * d);
  }
  return (shopMemo = traits);
}
function wantTraits(b) {
  const cat = b.cat || buyKind(b.title || "").cat;
  const [, noun, colour] = sigOf(b).split("|");
  return { type: `type:${cat}`, noun: noun && `noun:${noun}`, colour: colour && `colour:${colour}`, typeColour: `type:${cat}|${colour}`, fit: b.fit && `fit:${b.fit}`, styles: (b.styles || []).map((st) => `style:${st}`) };
}
// Above 0: like things you said yes to. Below 0: like things you said no to.
function shopScore(b) {
  const t = shopTaste(), tr = wantTraits(b);
  const keys = [tr.noun, tr.colour, tr.typeColour, tr.fit, ...tr.styles].filter(Boolean);
  return clamp(keys.reduce((a, k) => a + (t[k] || 0), 0), -3, 3);
}

// Yes / No on a suggestion, or what you answered.
function verdictHTML(b) {
  const w = wantOf(b);
  const data = esc(JSON.stringify({ title: b.title, cat: b.cat, noun: b.noun, color: b.color, fit: b.fit, styles: b.styles, query: b.query, why: b.why || "", eventId: b.eventId, needBy: b.needBy, scent: b.scent, source: typeof b.source === "string" ? b.source : undefined }));
  if (w?.status === "wanted") return `<div class="verdict"><button class="btn" data-disc="must">✓ On your Must-Buy</button><button class="chip" data-unwant="${w.id}">Undo</button></div>`;
  if (w?.status === "bought") return `<div class="verdict"><span class="muted small">You bought this</span></div>`;
  if (w && state.whyNo === w.id) return `<div class="verdict stack" style="gap:8px"><span class="muted small">Why not? Optional: it decides what the ideas learn.</span><div class="chips">${REASONS.map(([k, l]) => `<button class="chip" data-whyno="${w.id}|${k}">${l}</button>`).join("")}<button class="chip" data-whyno="${w.id}|">Skip</button></div></div>`;
  if (w && (w.status === "rejected" || (w.status === "snoozed" && Date.now() < Date.parse(w.until)))) return `<div class="verdict"><span class="muted small">${w.status === "snoozed" ? "Hidden for now" : `Not for you${w.reason ? `: ${REASON_WORDS[w.reason].toLowerCase()}` : ""}`}</span><button class="chip" data-unwant="${w.id}">Undo</button></div>`;
  return `<div class="verdict"><button class="btn" data-no="${data}">No</button><button class="btn primary" data-yes="${data}">Yes, I like this</button></div>`;
}

/* The Outfit Multiplier: how many new outfits a piece would make with what you own.
   Every combination with it (a top layer or two, a jacket when it's cold, bottoms, shoes) at the
   usual temperature of each season is checked against the fashion bible for each occasion; the
   ones it rates as good outfits (and that break none of its important rules) count. An outfit
   is what people see: the top (or the layer over it), bottoms and shoes; jackets and what's
   under a knit don't make it a different one. Pieces you disliked don't count. When a season has
   more than 150 combinations, 150 picked at random are checked and the count is scaled up.
   No AI: at most 3000 rule checks, kept until the wardrobe changes. */
const MULTI_GOOD = 0.6; // how sure the fashion bible's model must be that it's a good outfit
// `o`: the pieces, or the outfit Style.outfitFrom built from them (quicker when judged for several occasions).
const goodOutfit = (o, occ, feels) => {
  const j = Style.judge(o, { occasion: occ, feels, wet: false, offset: 0, age: state.settings.age || null });
  return !j.violations.length && j.prob >= MULTI_GOOD;
};
// The pieces you own that can go in an everyday outfit (not disliked, not gym), by role.
function ownedByRole(extra) {
  const by = { base: [], mid: [], outer: [], bottom: [], shoes: [] };
  for (const i of owned()) if (CORE.includes(roleOf(i)) && slotOf(i) !== "gym") by[roleOf(i)].push(i);
  if (extra) by[roleOf(extra)] = [extra];
  return by;
}
// A repeatable random sequence (mulberry32), so the same wardrobe always gets the same answer.
function seeded(seed = 7) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Outfits for a temperature: one top or a top with a layer, a jacket when it's cool (always one
// when it's cold, if you have one), bottoms and shoes. `key` is what people see. All of them in
// a shuffled order, or `n` picked at random when there are more: a big wardrobe has hundreds of
// thousands, and judging a few hundred tells as much.
function outfitsAt(by, feels, n = 400) {
  const tops = feels >= 22 ? by.base.map((x) => [x])
    : feels >= 12 ? [...by.base.map((x) => [x]), ...by.mid.map((x) => [x]), ...by.base.flatMap((x) => by.mid.map((m) => [x, m]))]
    : by.base.flatMap((x) => by.mid.map((m) => [x, m]));
  const outers = feels >= 17 ? [null] : feels >= 12 ? [null, ...by.outer] : by.outer.length ? by.outer : [null];
  const parts = [tops, outers, by.bottom, by.shoes.length ? by.shoes : [null]];
  const total = parts.reduce((a, l) => a * l.length, 1);
  const outfit = (k) => {
    const [top, outer, bottom, shoes] = parts.map((l) => { const x = l[k % l.length]; k = Math.floor(k / l.length); return x; });
    return { pieces: [...top, outer, bottom, shoes].filter(Boolean), key: [top.at(-1), bottom, shoes].map((p) => p?.id).join("|") };
  };
  const rnd = seeded(Math.round(feels) + 7);
  if (total <= n) {
    const ks = Array.from({ length: total }, (_, k) => k);
    for (let i = ks.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [ks[i], ks[j]] = [ks[j], ks[i]]; }
    return Object.assign(ks.map(outfit), { total, parts });
  }
  const seen = new Set();
  while (seen.size < n) seen.add(Math.floor(rnd() * total));
  return Object.assign([...seen].map(outfit), { total, parts });
}
const seasonTemps = () => Object.values(SEASONS).map((x) => x.feels);
const everydayOccs = () => OCCASIONS.filter((o) => o.id !== "gym");
const multiMemo = new Map();
function multiplier(b) {
  if (!Style.ready()) return null;
  const piece = asPiece(b);
  const role = roleOf(piece);
  if (!CORE.includes(role) || slotOf(piece) === "gym") return null;
  const by = ownedByRole(piece);
  const key = `${sigOf(b)}|${state.settings.age}|${Object.values(ownedByRole()).flat().map((i) => i.id).join()}`;
  if (multiMemo.has(key)) return multiMemo.get(key);
  const found = new Map(); // outfit → occasions it works for
  const tried = new Set(), every = new Set();
  let sampled = false;
  for (const feels of seasonTemps()) {
    const list = outfitsAt(by, feels, 150);
    const [tops, outers, bottoms, shoes] = list.parts;
    if (role === "outer" && !outers.includes(piece)) continue;
    // Every outfit there is (as people see it), to scale up what a sample finds.
    if (list.total > list.length) sampled = true;
    const seen = new Set(tops.filter((t) => !["base", "mid"].includes(role) || t.includes(piece)).map((t) => t.at(-1)));
    for (const t of seen) for (const bo of bottoms) for (const sh of shoes) every.add(`${t.id}|${bo.id}|${sh?.id ?? ""}`);
    for (const { pieces, key: k } of list) {
      if (!pieces.includes(piece)) continue;
      tried.add(k);
      const o = Style.outfitFrom(pieces);
      for (const occ of everydayOccs()) {
        if (found.get(k)?.has(occ.id) || !goodOutfit(o, occ.id, feels)) continue;
        if (!found.has(k)) found.set(k, new Set());
        found.get(k).add(occ.id);
      }
    }
  }
  const byOcc = {};
  for (const set of found.values()) for (const o of set) byOcc[o] = (byOcc[o] || 0) + 1;
  const scale = sampled && tried.size ? Math.max(1, every.size / tried.size) : 1;
  const res = { n: Math.round(found.size * scale), byOcc, estimate: scale > 1 && found.size > 0 };
  multiMemo.set(key, res);
  return res;
}
function multiplierLine(b) {
  const m = multiplier(b);
  if (!m) return "";
  const top = Object.entries(m.byOcc).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([o]) => occLabel(o));
  return `<div class="multi"><b>${m.n ? `+${m.n}` : "0"}</b><span>${m.n ? `new outfit${m.n > 1 ? "s" : ""} with what you own${m.estimate ? " (estimated)" : ""}${top.length ? `, mostly ${top.join(" and ")}` : ""}` : "new outfits: nothing you own goes with it by the fashion bible's rules"}</span></div>`;
}

// A piece you already own (the wash counts) like a suggestion: same type, a colour of the same family,
// and the same kind (crewneck, loafer, bomber…) when the suggestion names one.
const KIND_WORDS = ["crewneck", "v-neck", "turtleneck", "cardigan", "zip", "chino", "cargo", "loafer", "oxford", "derby", "chelsea", "polo", "overshirt", "bomber", "puffer", "parka", "trench", "overcoat", "blazer", "hoodie", "sweatshirt", "denim", "linen"];
const COLOUR_FAMILY = { navy: "blue", "dark blue": "blue", indigo: "blue", charcoal: "grey", grey: "grey", "light grey": "grey", beige: "beige", cream: "beige", sand: "beige", stone: "beige", camel: "beige", ecru: "beige", white: "white", "off-white": "white", brown: "brown", tan: "brown", chocolate: "brown", olive: "green", khaki: "green", "forest green": "green" };
const family = (c) => COLOUR_FAMILY[c] || c;
function ownsLike(b) {
  if (!b?.cat || b.kind === "fragrance") return null;
  const kinds = KIND_WORDS.filter((w) => new RegExp(`\\b${w}`, "i").test(`${b.noun || ""} ${b.title || ""}`));
  return owned().find((i) => i.category === b.cat && (!b.color || family(i.colors?.[0]) === family(b.color)) &&
    (!kinds.length || kinds.some((w) => new RegExp(`\\b${w}`, "i").test(`${i.name} ${(i.tags || []).join(" ")}`)))) || null;
}
function mustRow(w) {
  if (w.kind === "fragrance") return scentWantRow(w);
  const b = { ...w, with: goesWith(w.title) };
  const ev = forEvent(w);
  const m = multiplier(w);
  const have = ownsLike(w);
  if (have) return buyRow(b, {
    label: `You have one: ${esc(have.name)}`,
    extra: `<button class="btn" data-item="${have.id}">See it</button><button class="btn ghost" data-unwant="${w.id}">Remove</button><button class="btn ghost" data-bought="${w.id}">Bought another</button>`,
  });
  const from = { foryou: "From For you", try: "From Try a piece", look: "From a new look", trip: "From a shop trip", today: "From the stylist", touch: "From Today's outfit", event: "For an event", wishlist: "From your wishlist", scent: "From an outfit's scent" }[w.source?.type] || "";
  return buyRow(b, {
    label: ev ? `For ${esc(ev.title)} · ${fmtDay(ev.date)}` : m ? `+${m.n} outfit${m.n === 1 ? "" : "s"}` : from,
    extra: `<button class="btn primary" data-bought="${w.id}">Bought it</button><button class="btn ghost" data-unwant="${w.id}">Remove</button>`,
  });
}
// The upcoming event a Must-Buy piece is for, if any.
const forEvent = (w) => (w.eventId && w.needBy >= localDay() ? state.events.find((e) => e.id === w.eventId) : null);
function mustTab() {
  const f = state.disc.mustf || "all";
  const all = mustBuy();
  // Pieces for an event in the next month first, soonest first; then the ones that unlock the most outfits.
  const soon = (w) => (forEvent(w) && daysUntil(w.needBy) <= 31 ? w.needBy : "~");
  const list = all.filter((w) => f === "all" || (f === "event" ? forEvent(w) : w.kind === f)).filter(soldHere)
    .map((w) => [w, multiplier(w)?.n ?? -1]).sort((a, b) => soon(a[0]).localeCompare(soon(b[0])) || b[1] - a[1]).map(([w]) => w);
  const kinds = [["all", "All"], ["garment", "Clothes"], ["accessory", "Accessories"], ["fragrance", "Fragrances"], ["event", "For an event"]].filter(([k]) => k === "all" || all.some((w) => (k === "event" ? forEvent(w) : w.kind === k)));
  const bought = state.wants.filter((w) => w.status === "bought").length;
  return `
    ${kinds.length > 2 ? `<div class="chips">${kinds.map(([k, l]) => `<button class="chip" aria-pressed="${f === k}" data-mustf="${k}">${l}</button>`).join("")}</div>` : ""}
    <section class="card">
      ${list.length ? `<div class="sugg">${list.map(mustRow).join("")}</div>`
        : `<p class="muted" style="margin:0">${all.length ? `Nothing here is sold at ${esc(state.trip?.name || "this shop")}.` : "Nothing yet. Tap <b>Yes, I like this</b> on any idea in For you, Try a piece, New look or the stylist's advice, and it lands here with how many new outfits it unlocks."}</p>`}
      ${!state.trip && list.length ? `<p class="muted small" style="margin:14px 0 0">Going shopping? <button class="linkish" data-disc="trip">Pick the mall or shop</button> to see only what's sold there.</p>` : ""}
      ${bought ? `<p class="muted small" style="margin:8px 0 0">${bought} bought so far.</p>` : ""}
    </section>`;
}

/* ---- Events: dressing for something coming up ----
   An event you type (or pick from your calendar) gets a dress code, the weather it will probably
   have (the forecast up to 15 days ahead, the usual weather for that month after that), an outfit
   from your wardrobe that follows both, and the pieces you'd need to buy, which Yes puts on
   Must-Buy for that date. The AI reads the dress code once per event (a small request: the
   event and the weather, not your wardrobe); without a key the event's words decide the
   occasion and its usual dress code. Everything else runs on the device. Events are records in
   "events", shared by every device: { id, title, date, time, place: {name, lat, lon},
   calendarKey, dressCode, weather: {feels, wet, source}, outfit: {itemIds}, createdAt }. */
const EVENT_CODES = {
  casual: { label: "Casual", musts: [], avoid: [], avoidColors: [] },
  smart: { label: "Smart casual", musts: [], avoid: ["hoodie", "zip-hoodie", "sweatshirt", "joggers"], avoidColors: [] },
  work: { label: "Business casual", musts: [], avoid: ["hoodie", "zip-hoodie", "sweatshirt", "joggers", "shorts"], avoidColors: [] },
  night: { label: "Going out", musts: [], avoid: ["zip-hoodie", "joggers"], avoidColors: [] },
  event: { label: "Elegant", musts: ["jacket", "dress-shoes"], avoid: ["hoodie", "zip-hoodie", "sweatshirt", "joggers", "shorts", "sneakers", "tshirt", "puffer", "rain"], avoidColors: [] },
};
const EVENT_EXAMPLES = ["Summer wedding", "Job interview", "Business dinner", "First date", "Graduation party"];
const fmtDay = (date) => new Date(`${date}T12:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const daysUntil = (date) => Math.round((new Date(`${date}T12:00`).getTime() - startOfDay(0)) / 864e5 - 0.5);
const upcomingEvents = () => state.events.filter((e) => e.date >= localDay()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
const saveEvent = (ev) => { ev.updatedAt = new Date().toISOString(); return store.put("events", ev); };
function guessCode(text) {
  const occ = guessOccasion({ title: text }) || "smart";
  return { occasion: occ, ...EVENT_CODES[occ], formality: OCCASIONS.find((o) => o.id === occ).target, tips: [], source: "guess" };
}
// The usual weather at a place for the event's month: day or evening.
function usualWeather(lat, lon, date, hour) {
  const c = nearestCity(lat, lon);
  if (!c) return null;
  const m = +date.slice(5, 7) - 1, hi = c.hi[m], lo = c.lo[m];
  const evening = hour != null && (hour >= 19 || hour < 9);
  return { feels: Math.round(evening ? (2 * lo + hi) / 3 : (2 * hi + lo) / 3), wet: false, source: "usual", at: Date.now() };
}
// The forecast for the event's first four hours (midday to evening when it has no time).
async function forecastWeather(lat, lon, date, hour) {
  const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=apparent_temperature,precipitation_probability,weather_code,relative_humidity_2m&start_date=${date}&end_date=${date}&timezone=auto`);
  const h = j.hourly;
  const hrs = (hour == null ? [11, 12, 13, 14, 15, 16, 17] : [hour, hour + 1, hour + 2, hour + 3]).filter((k) => k < h.time.length);
  return {
    feels: Math.round(hrs.reduce((a, k) => a + h.apparent_temperature[k], 0) / hrs.length),
    wet: hrs.some((k) => isWet(h.weather_code[k]) || (h.precipitation_probability[k] ?? 0) >= 55), source: "forecast", at: Date.now(),
    humid: h.relative_humidity_2m ? Math.round(hrs.reduce((a, k) => a + (h.relative_humidity_2m[k] ?? 0), 0) / hrs.length) : 0,
  };
}
async function weatherForEvent(ev) {
  const lat = ev.place?.lat ?? state.settings.lat, lon = ev.place?.lon ?? state.settings.lon;
  if (lat == null) return null;
  const hour = ev.time ? +ev.time.slice(0, 2) : null;
  const d = daysUntil(ev.date);
  if (d >= 0 && d <= 15) { try { return await forecastWeather(lat, lon, ev.date, hour); } catch {} }
  return usualWeather(lat, lon, ev.date, hour);
}
// Once the forecast reaches the event (and every 6 hours after), it replaces the usual weather.
const weatherTried = new Map();
async function refreshEventWeather(ev) {
  const d = daysUntil(ev.date);
  const old = ev.weather;
  const due = !old || (d >= 0 && d <= 15 && (old.source !== "forecast" || Date.now() - old.at > 6 * 3600e3));
  if (!due || Date.now() - (weatherTried.get(ev.id) || 0) < 30 * 60e3) return;
  weatherTried.set(ev.id, Date.now());
  const w = await weatherForEvent(ev);
  if (!w || (old && w.source === old.source && w.feels === old.feels && w.wet === old.wet)) return;
  ev.weather = w;
  await saveEvent(ev);
  if (view === "shop" && state.disc.tab === "events") render();
}
// A place typed by you or from a calendar ("Via Roma 1, 20121 Milano MI, Italy"): the first
// part the city search knows.
async function placeFrom(text) {
  const parts = [text, ...text.split(",").map((x) => x.replace(/\b\d+\b|\b[A-Z]{2}\b/g, "").trim()).filter((x) => x.length > 2).reverse().slice(1, 4)];
  for (const q of parts) {
    const { results } = await searchCity(q);
    const c = results?.[0];
    if (c) return { name: q === text ? text.split(",")[0].trim() : c.name, lat: c.latitude, lon: c.longitude };
  }
  return { name: text.trim() };
}
const EVENT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["occasion", "dressCode", "formality", "musts", "avoid", "avoidColors", "tips"],
  properties: {
    occasion: { type: "string", enum: ["casual", "smart", "work", "night", "event"], description: "casual, smart (smart casual), work (meeting, interview), night (going out), event (elegant: wedding, gala)" },
    dressCode: { type: "string", description: "The dress code in 1-3 words, e.g. 'Cocktail', 'Smart casual', 'Business'" },
    formality: { type: "number", description: "1 casual … 4 formal" },
    musts: { type: "array", items: { type: "string", enum: CATS.filter((c) => !["under", "gym"].includes(c.slot)).map((c) => c.id) }, description: "Types of piece the outfit needs, if any (e.g. jacket, dress-shoes, tie)" },
    avoid: { type: "array", items: { type: "string", enum: CATS.filter((c) => !["under", "gym"].includes(c.slot)).map((c) => c.id) }, description: "Types of piece that would be wrong here" },
    avoidColors: { type: "array", items: { type: "string", enum: Object.keys(COLORS) }, description: "Colours to avoid, if the occasion has a rule (e.g. white at a wedding)" },
    tips: { type: "array", items: { type: "string" }, description: "Up to 3 short tips, under 12 words each" },
  },
};
async function readDressCode(ev) {
  const w = ev.weather;
  const text = await aiGenerate({
    system: "You read an event someone is going to and say how to dress for it: the occasion, the dress code, what the outfit needs and what would be wrong there. Reply with JSON only.",
    text: `Event: "${ev.title}", ${fmtDay(ev.date)}${ev.time ? ` at ${ev.time}` : ""}${ev.place?.name ? `, ${ev.place.name}` : ""}.${w ? ` Expected to feel ${w.feels}°C${w.wet ? ", rain likely" : ""}.` : ""} Dressing ${shopperText()}.`,
    schema: EVENT_SCHEMA,
    maxTokens: 400,
  });
  const r = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
  const occ = EVENT_CODES[r.occasion] ? r.occasion : guessCode(ev.title).occasion;
  const cats = (l) => [...new Set((l || []).filter((c) => CAT[c]))].slice(0, 5);
  return {
    occasion: occ, label: String(r.dressCode || EVENT_CODES[occ].label).slice(0, 40), formality: clamp(+r.formality || OCCASIONS.find((o) => o.id === occ).target, 1, 4),
    musts: cats(r.musts), avoid: cats(r.avoid).filter((c) => !(r.musts || []).includes(c)), avoidColors: [...new Set((r.avoidColors || []).filter((c) => COLORS[c]))].slice(0, 4),
    tips: (r.tips || []).map((x) => String(x).trim()).filter(Boolean).slice(0, 3), source: "ai",
  };
}
async function readCodeFor(id) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev || !aiReady() || state.disc.evBusy) return;
  state.disc.evBusy = id;
  render();
  try {
    ev.dressCode = await readDressCode(ev);
    await saveEvent(ev);
  } catch (e) {
    toast(e.message || "Couldn't read the dress code");
  }
  state.disc.evBusy = "";
  render();
}
async function createEvent({ title, date, time = "", placeText = "", calendarKey = "", words = "" }) {
  const now = new Date().toISOString();
  const ev = { id: uid(), title: title.trim(), date, time, place: null, calendarKey, dressCode: guessCode(`${title} ${words}`), weather: null, outfit: null, createdAt: now, updatedAt: now };
  state.disc.evBusy = "new";
  render();
  if (placeText.trim()) ev.place = await placeFrom(placeText.trim());
  ev.weather = await weatherForEvent(ev);
  weatherTried.set(ev.id, Date.now());
  state.events.push(ev);
  await saveEvent(ev);
  state.disc.evBusy = "";
  state.disc.ev = ev.id;
  state.disc.evForm = { text: "", date: "", time: "", place: "" };
  render();
  main.scrollTop = 0;
  if (aiReady()) await readCodeFor(ev.id);
}
function addEventFromForm() {
  const f = state.disc.evForm;
  if (!f.text.trim()) return toast("Say what the event is");
  if (!f.date) return toast("Pick the date");
  if (f.date < localDay()) return toast("That date has passed");
  return createEvent({ title: f.text, date: f.date, time: f.time, placeText: f.place });
}
// Events in your calendar for the coming weeks that are worth dressing for.
function calendarAhead() {
  const saved = new Set(state.events.map((e) => e.calendarKey).filter(Boolean));
  return state.cal.events.filter((e) => e.start >= startOfDay(1) && !saved.has(eventKey(e)) && !["skip", "casual", "gym"].includes(eventOcc(e))).slice(0, 6);
}
function eventFromCalendar(key) {
  const e = state.cal.events.find((x) => eventKey(x) === key);
  if (!e) return;
  const d = new Date(e.start);
  return createEvent({ title: e.title, date: d.toLocaleDateString("sv"), time: e.allDay ? "" : d.toTimeString().slice(0, 5), placeText: e.location || "", calendarKey: key, words: e.location || "" });
}
async function editCode(id, fn) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  ev.dressCode = { ...fn(ev.dressCode), source: "you" };
  ev.dressCode.formality ??= OCCASIONS.find((o) => o.id === ev.dressCode.occasion).target;
  state.disc.evOcc = false;
  await saveEvent(ev);
  render();
}
async function planEvent(id, undo = false) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev) return;
  if (undo) ev.outfit = null;
  else {
    const o = eventIdeas(ev).ideas[state.disc.evPick[id] || 0];
    if (!o) return;
    const sc = scentShown.get(`e:${ev.id}`)?.chosen;
    ev.outfit = { itemIds: allPieces(o).map((p) => p.id), ...(sc && { scentId: sc.id }), at: new Date().toISOString() };
    toast(ev.date === localDay() ? "Planned. It's the first idea on Today." : `Planned. On ${fmtDay(ev.date)} it's the first idea on Today.`);
  }
  if (ev.date === localDay()) state.outfits = [];
  await saveEvent(ev);
  render();
}
async function removeEvent(id) {
  const ev = state.events.find((e) => e.id === id);
  if (!ev || !(await confirmBox(`Remove “${ev.title}”?`, "Remove"))) return;
  await store.del("events", id);
  state.events = state.events.filter((e) => e !== ev);
  if (ev.date === localDay()) state.outfits = [];
  state.disc.ev = null;
  render();
}
// The outfit ideas for an event, and what you'd need to buy for it. Kept until the event, its
// dress code, its weather or your wardrobe change (the ideas are picked with some chance).
const evMemo = new Map();
function eventIdeas(ev) {
  const code = ev.dressCode;
  const occ = OCCASIONS.find((o) => o.id === code.occasion) || OCCASIONS[1];
  const cond = { feels: ev.weather?.feels ?? 18, wet: !!ev.weather?.wet };
  const soon = ev.date === localDay();
  const sig = JSON.stringify([code, cond, soon, state.items.map((i) => `${i.id}${i.disliked ? "x" : ""}${soon && i.wash ? "w" : ""}`).join()]);
  const hit = evMemo.get(ev.id);
  if (hit?.sig === sig) return hit;
  const fits = (i) => !i.disliked && slotOf(i) !== "gym" && !(soon && i.wash) && !code.avoid.includes(i.category) && !code.avoidColors.includes(i.colors?.[0]);
  const by = { base: [], mid: [], outer: [], bottom: [], shoes: [] };
  for (const i of state.items) if (by[roleOf(i)] && fits(i)) by[roleOf(i)].push(i);
  const need = [];
  for (const cat of code.musts) {
    const role = roleOf({ category: cat });
    if (!CORE.includes(role)) { if (!state.items.some((i) => i.category === cat && fits(i))) need.push({ cat, role }); continue; }
    const own = by[role].filter((i) => i.category === cat);
    if (own.length) by[role] = own;
    else { by[role] = []; need.push({ cat, role }); }
  }
  const outer = code.musts.some((c) => roleOf({ category: c }) === "outer") && by.outer.length > 0;
  // Elegant events (levels 4–5): a shirt under everything, a knit only over one.
  const shirts = by.base.filter((i) => i.category === "shirt");
  const formal = (levelsFor(occ)?.[0] || 0) >= 4 && shirts.length > 0;
  if (formal) by.base = shirts;
  const pool = ideaPool({ occ, cond, by, anchor: null, outer, needBase: formal });
  for (const role of pool.missing) if (!need.some((n) => n.role === role)) need.push({ role });
  if (!by.base.length && !by.mid.length && !need.some((n) => n.role === "base")) need.push({ role: "base" });
  const used = new Set();
  const ideas = pickIdeas(pool, 3).map((c) => {
    const o = dressIdea(c, pool, used);
    // An accessory the dress code asks for, when you have one.
    for (const cat of code.musts) {
      if (CORE.includes(roleOf({ category: cat })) || o.extras?.some((x) => x.category === cat)) continue;
      const a = state.items.find((i) => i.category === cat && fits(i));
      if (a) o.extras = [...(o.extras || []), a];
    }
    return o;
  });
  const res = { sig, occ, cond, ideas, need: need.map((n) => buyFor(n, ev, occ, cond)).filter(Boolean) };
  evMemo.set(ev.id, res);
  return res;
}
// A piece to buy for a must you don't have, or a part of the outfit nothing you own suits.
function buyFor(n, ev, occ, cond) {
  const code = ev.dressCode, target = code.formality ?? occ.target;
  const warmthOff = (k) => (k.role === "shoes" || k.role === "bottom" ? 0 : cond.feels >= 22 ? Math.max(0, k.w - 1) : cond.feels < 10 ? Math.max(0, 3 - k.w) : 0);
  const k = LOOK_KIT_FOR().filter((x) => (n.cat ? x.cat === n.cat : x.role === n.role) && !code.avoid.includes(x.cat))
    .sort((a, b) => Math.abs(a.f - target) + warmthOff(a) - (Math.abs(b.f - target) + warmthOff(b)))[0];
  const what = n.cat ? catLabel(n.cat).toLowerCase() : SLOTS[n.role].toLowerCase();
  const plural = /s$/.test(what);
  // Owned, but only in a colour the dress code rules out.
  const wrong = n.cat && state.items.some((i) => i.category === n.cat && !i.disliked && code.avoidColors.includes(i.colors?.[0]));
  const why = n.cat
    ? `${code.label} calls for ${plural ? "" : "a "}${what}, and you don't have ${wrong ? `${plural ? "any" : "one"} that isn't ${code.avoidColors.join(" or ")}` : plural ? "any" : "one"}.`
    : `None of your ${what} suit${plural ? "" : "s"} ${code.label.toLowerCase()}.`;
  const okColour = (c) => !code.avoidColors.includes(c) && (COLORS[c] || EXTRA_COLOURS[c]);
  if (!k) {
    const a = ACC_KIT.find((x) => x.cat === n.cat);
    if (!n.cat) return null;
    return { title: cap(a?.noun || what), cat: n.cat, noun: a?.noun || "", colors: (a?.colors || ["black", "navy", "brown"]).filter(okColour).slice(0, 3), why, role: n.role };
  }
  return { title: cap(k.noun), cat: k.cat, noun: k.noun, styles: k.styles, colors: bestColours(k.cat, 5, k.styles).filter(okColour).slice(0, 3), why, role: n.role };
}
function eventsTab() {
  const ev = state.events.find((e) => e.id === state.disc.ev);
  if (ev) return eventDetail(ev);
  const f = state.disc.evForm;
  const list = upcomingEvents();
  const ahead = calendarAhead();
  const row = (e) => {
    const r = eventIdeas(e);
    const status = e.outfit ? (r.need.length ? `Planned · ${r.need.length} to buy` : "Ready ✓") : r.need.length ? `${r.need.length} piece${r.need.length > 1 ? "s" : ""} missing` : "Not planned yet";
    return `<button class="event-row" data-evopen="${e.id}"><b>${esc(e.title)}</b><span class="muted small">${fmtDay(e.date)}${e.time ? `, ${e.time}` : ""}${e.place?.name ? ` · ${esc(e.place.name)}` : ""}</span><span class="ev-status${e.outfit && !r.need.length ? " ok" : ""}">${status}</span></button>`;
  };
  return `
    <section class="card stack">
      <h2 style="margin:0">What's coming up?</h2>
      <input class="input" data-input="evtext" value="${esc(f.text)}" placeholder="A wedding in Puglia, a job interview, dinner with clients…" aria-label="The event">
      <div class="chips scroller">${EVENT_EXAMPLES.map((x) => `<button class="chip" data-evex="${esc(x)}">${esc(x)}</button>`).join("")}</div>
      <div class="ev-form">
        <label class="field"><span>Date</span><input class="input" type="date" data-input="evdate" min="${localDay()}" value="${esc(f.date)}"></label>
        <label class="field"><span>Time <i class="muted">(optional)</i></span><input class="input" type="time" data-input="evtime" value="${esc(f.time)}"></label>
        <label class="field" style="flex:2 1 220px"><span>Where <i class="muted">(city, optional)</i></span><input class="input" data-input="evplace" value="${esc(f.place)}" placeholder="${esc(state.settings.city || "City")}"></label>
      </div>
      <div class="row"><button class="btn primary" data-act="ev-add" ${state.disc.evBusy === "new" ? "disabled" : ""}>${state.disc.evBusy === "new" ? `<span class="spinner inline"></span> Getting the weather…` : "Plan what to wear"}</button></div>
    </section>
    ${list.length ? `<section class="card stack" style="gap:8px"><h2 style="margin:0">Your events</h2>${list.map(row).join("")}</section>` : ""}
    ${ahead.length ? `<section class="card stack" style="gap:8px"><h2 style="margin:0">From your calendar</h2><p class="muted small" style="margin:0">The next six weeks. Tap one to plan it.</p>${ahead.map((e) => `<button class="event-row" data-evcal="${esc(eventKey(e))}"><b>${esc(e.title)}</b><span class="muted small">${fmtDay(new Date(e.start).toLocaleDateString("sv"))}${e.allDay ? "" : `, ${fmtTime(e.start)}`}${e.location ? ` · ${esc(e.location.split(",")[0])}` : ""}</span><span class="ev-status">${esc(occLabel(eventOcc(e)))}</span></button>`).join("")}</section>` : ""}`;
}
function eventDetail(ev) {
  setTimeout(() => refreshEventWeather(ev), 0);
  const code = ev.dressCode;
  const r = eventIdeas(ev);
  const w = ev.weather;
  const past = ev.date < localDay();
  const wLine = w ? `${w.source === "forecast" ? "forecast" : `usually`} ${fmtTemp(w.feels)}${w.source === "usual" ? ` in ${new Date(`${ev.date}T12:00`).toLocaleDateString(undefined, { month: "long" })}` : ""}${w.wet ? ", rain likely" : ""}` : "weather unknown";
  const planned = ev.outfit && ev.outfit.itemIds.map((id) => state.items.find((i) => i.id === id)).filter(Boolean);
  const k = Math.min(state.disc.evPick[ev.id] || 0, Math.max(0, r.ideas.length - 1));
  const o = r.ideas[k];
  const order = ["outer", "mid", "base", "bottom", "shoes"];
  const dashed = r.need.filter((n) => CORE.includes(n.role)).map((n) => `<div class="piece"><div class="ph">${kindIcon(SLOT_ICON[n.role])}<small>${esc(n.title)}<br>to buy</small></div><span>${esc(SLOTS[n.role])}</span></div>`).join("");
  const scent = scentOn() ? scentBlock(`e:${ev.id}`, eventScentContext(ev, planned?.length ? planned : o ? allPieces(o) : []), ev.outfit?.scentId) : "";
  const outfit = planned?.length
    ? `<div class="pieces">${planned.map(pieceTile).join("")}</div>${scent}
       <div class="row outfit-actions"><span class="score">Planned for the day</span><button class="btn ghost" data-evunplan="${ev.id}">Change</button></div>`
    : o
      ? `<div class="pieces">${order.filter((x) => o.pieces[x]).map((x) => pieceTile(o.pieces[x])).join("")}${dashed}</div>
         ${o.coat || o.extras?.length ? `<div class="pieces extras">${[o.coat, ...(o.extras || [])].filter(Boolean).map(pieceTile).join("")}</div>` : ""}
         ${o.reasons.length ? `<p class="why">${o.reasons.map(esc).join(" · ")}</p>` : ""}
         ${o.warn?.length ? `<p class="why warn">Heads up: ${o.warn.map(esc).join(" · ")}</p>` : ""}${scent}
         ${ev.date > localDay() ? allPieces(o).filter((p) => p.wash).map((p) => `<p class="why warn">Your ${esc(p.name)} is in the wash: wash it before ${esc(fmtDay(ev.date))}.</p>`).join("") : ""}
         <div class="row outfit-actions"><button class="btn primary" data-evplan="${ev.id}">Plan it for the day</button>${r.ideas.length > 1 ? `<button class="btn" data-evpick="${ev.id}|${(k + 1) % r.ideas.length}">Another outfit (${k + 1} of ${r.ideas.length})</button>` : ""}</div>`
      : `<p class="muted" style="margin:0">Nothing you own makes an outfit for this yet.</p>${dashed ? `<div class="pieces">${dashed}</div>` : ""}`;
  const chip = (field, v, l) => `<button class="chip" data-evdrop="${ev.id}|${field}|${esc(v)}" aria-label="Remove ${esc(l)}">${esc(l)} ✕</button>`;
  return `
    <div class="row" style="justify-content:space-between"><button class="chip" data-act="ev-close">← All events</button><button class="btn ghost danger" data-evrm="${ev.id}">Remove</button></div>
    <section class="card stack event-plan">
      <div><h2 style="margin:0">${esc(ev.title)}</h2>
        <p class="muted" style="margin:4px 0 0">${fmtDay(ev.date)}${ev.time ? `, ${ev.time}` : ""}${ev.place?.name ? ` · ${esc(ev.place.name)}` : ""} · ${wLine}${past ? " · this was before today" : ""}</p></div>
      <div class="stack" style="gap:8px">
        <div class="row" style="justify-content:space-between;align-items:baseline"><span class="muted small">Dress code${code.source === "ai" ? ` · read by ${esc(aiName())}` : code.source === "you" ? " · edited by you" : " · guessed from the name"}</span>
          ${aiReady() && code.source !== "ai" ? (state.disc.evBusy === ev.id ? `<span class="muted small"><span class="spinner inline"></span> Reading it…</span>` : `<button class="linkish small" data-evai="${ev.id}">Read it with AI</button>`) : state.disc.evBusy === ev.id ? `<span class="muted small"><span class="spinner inline"></span> Reading it…</span>` : ""}</div>
        <div class="chips">
          <button class="chip" aria-pressed="true" data-act="ev-occ" aria-expanded="${state.disc.evOcc}">${esc(occLabel(code.occasion))}${code.label && code.label !== occLabel(code.occasion) ? ` · ${esc(code.label)}` : ""}</button>
          ${code.musts.map((c) => chip("musts", c, `Needs ${catLabel(c).toLowerCase()}`)).join("")}
          ${code.avoid.map((c) => chip("avoid", c, `No ${catLabel(c).toLowerCase()}`)).join("")}
          ${code.avoidColors.map((c) => chip("avoidColors", c, `No ${c}`)).join("")}
        </div>
        ${state.disc.evOcc ? `<div class="chips event-occ"><span class="muted small">Dress for it as:</span>${everydayOccs().map((x) => `<button class="chip" aria-pressed="${code.occasion === x.id}" data-evsetocc="${ev.id}|${x.id}">${esc(x.label)}</button>`).join("")}</div>` : ""}
        ${code.tips?.length ? `<ul class="ev-tips">${code.tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      </div>
      <div class="stack" style="gap:10px"><h3 style="margin:0">From your wardrobe</h3>${outfit}</div>
    </section>
    ${r.need.length ? `<section class="card"><h2 style="margin:0">To buy for it</h2><div class="sugg">${r.need.map((s, j) => {
      const options = variantsOf(s).filter(soldHere).map((b) => ({ ...b, eventId: ev.id, needBy: ev.date, source: "event" }));
      return options.length ? ideaBlock(`ev${ev.id}:${j}:${s.title}`, { label: SLOTS[s.role] ? cap(SLOTS[s.role]) : "", title: s.title, why: s.why, options }) : "";
    }).join("") || `<p class="muted">None of it is sold at ${esc(state.trip?.name)}.</p>`}</div></section>` : ""}`;
}

/* ---- The closet audit (For you) ----
   What the wardrobe can wear now, worked out on the device: for each season and occasion, the
   outfits the fashion bible rates good (up to COVER_CAP each, from at most 300 combinations per
   season picked at random). From that:
   - gaps: a season and occasion with (almost) no outfits, and the one piece that fixes most of it
   - bottlenecks: one piece that most of an occasion's outfits depend on
   - accessories you don't have that would finish many outfits ("Lifts N outfits")
   Ideas from the full audit (AI, on request) and analyse()'s rules of thumb join them. */
const COVER_CAP = 25;
let coverMemo = null;
const coverSig = () => `${state.settings.age}|` + Object.values(ownedByRole()).flat().map((i) => i.id).join();
// False while the audit still has to look through the wardrobe (a moment on a big one).
const coverageDone = () => !Style.ready() || coverMemo?.sig === coverSig();
function coverage() {
  if (!Style.ready()) return null;
  const by = ownedByRole();
  const sig = coverSig();
  if (coverMemo?.sig === sig) return coverMemo;
  const cells = {};
  for (const [season, { feels }] of Object.entries(SEASONS)) {
    const list = outfitsAt(by, feels, 300);
    for (const occ of everydayOccs()) {
      const found = [];
      for (const o of list) {
        if (found.length >= COVER_CAP) break;
        if (goodOutfit((o.built ||= Style.outfitFrom(o.pieces)), occ.id, feels)) found.push(o.pieces);
      }
      cells[`${season}|${occ.id}`] = found;
    }
  }
  return (coverMemo = { sig, cells });
}
const LOOK_KIT_FOR = () => LOOK_KIT.filter((k) => !k.who || k.who === state.settings.gender);
// The colours each kind of piece usually comes in (others: the neutrals).
const KIT_COLOURS = {
  jeans: ["indigo", "denim", "black", "grey"], "dress-shoes": ["black", "brown", "tan", "burgundy"], boots: ["brown", "black", "tan", "sand"],
  sneakers: ["white", "black", "grey", "navy", "cream"], coat: ["camel", "charcoal", "navy", "black", "grey", "beige"],
};
// The best colour of a kit piece for this wardrobe: the neutral that goes with most of what you own.
function bestColours(cat, n = 3, styles) {
  const choices = KIT_COLOURS[cat] || ["navy", "white", "black", "grey", "beige", "olive", "brown", "cream", "charcoal"];
  return choices.map((color) => {
    const b = mkIdea({ cat, color, styles });
    const piece = asPiece(b);
    return [color, wornWith(piece).reduce((a, o) => a + pairScore(piece, o), 0) + shopScore(b) * 3];
  }).sort((a, b) => b[1] - a[1]).slice(0, n).map(([c]) => c);
}
// How many good outfits a piece you don't own would make for one season and occasion (up to `cap`).
function cellCount(b, season, occ, cap = 6) {
  const piece = asPiece(b), feels = SEASONS[season].feels;
  let n = 0;
  for (const o of outfitsAt(ownedByRole(piece), feels, 60)) {
    if (n >= cap) break;
    if (o.pieces.includes(piece) && goodOutfit(o.pieces, occ, feels)) n++;
  }
  return n;
}
const ACC_KIT = [
  { cat: "belt", noun: "leather belt", colors: ["brown", "black", "tan"], when: (o) => o.some((p) => ["trousers", "jeans"].includes(p.category)), why: "Trousers and jeans look finished with a belt, in the same colour family as your shoes." },
  { cat: "watch", noun: "minimal watch", colors: ["black", "brown", "navy"], occs: ["smart", "work", "night", "event"], why: "A plain watch is the one accessory that suits every smart outfit." },
  { cat: "sunglasses", noun: "classic sunglasses", colors: ["black", "brown"], seasons: ["summer"], why: "For sunny days, and they sharpen a simple summer outfit." },
  { cat: "scarf", noun: "wool scarf", colors: ["grey", "navy", "camel"], seasons: ["winter", "autumn"], why: "Warmth at the neck, and an easy way to add colour to a coat." },
  { cat: "tie", noun: "knitted tie", colors: ["navy", "burgundy", "brown"], occs: ["work", "event"], when: (o) => o.some((p) => p.category === "shirt"), why: "For your shirts on work days and elegant evenings." },
];
const AUDIT_LIMIT = 8;
function auditFeed() {
  const cov = coverage();
  const memoKey = `${state.items.length}|${state.wants.length}|${state.audit?.at}|${cov?.sig}|${state.settings.gender}`;
  if (state.disc.feedMemo?.key === memoKey) return state.disc.feedMemo.feed;
  const feed = [], seen = new Set();
  const push = (s) => {
    const k = `${s.cat}|${s.noun || s.title}`;
    if (seen.has(k) || feed.length >= 12) return;
    seen.add(k);
    feed.push(s);
  };
  if (cov) {
    // Gaps: season + occasion pairs with (almost) nothing to wear, the most everyday ones first,
    // each with the piece from the kit that makes the most good outfits there.
    const gaps = Object.entries(cov.cells).filter(([, f]) => f.length < 2)
      .map(([k]) => k.split("|")).sort((a, b) => (OCCASIONS.find((o) => o.id === a[1]).target - OCCASIONS.find((o) => o.id === b[1]).target));
    for (const [season, occId] of gaps.slice(0, 2)) {
      const occ = OCCASIONS.find((o) => o.id === occId);
      const kit = LOOK_KIT_FOR().filter((k) => Math.abs(k.f - occ.target) <= 0.8 && (season !== "summer" || k.w <= 2) && (season !== "winter" || k.role !== "outer" || k.w >= 3));
      let best = null;
      for (const k of kit) {
        const b = mkIdea({ cat: k.cat, color: bestColours(k.cat, 1, k.styles)[0], noun: k.noun, styles: k.styles });
        if (shopScore(b) <= -1) continue;
        const n = cellCount(b, season, occId);
        if (n && (!best || n > best.n)) best = { k, n };
      }
      if (!best) continue;
      const have = cov.cells[`${season}|${occId}`].length;
      push({ prio: "high", label: `Fills a gap: ${SEASONS[season].label.toLowerCase()} ${occ.label.toLowerCase()}`, title: cap(best.k.noun),
        why: `${have ? "Only one outfit" : "Nothing you own"} makes a good ${occ.label.toLowerCase()} outfit for ${SEASONS[season].label.toLowerCase()} by the fashion bible. ${cap(best.k.noun)} would make ${best.n >= 6 ? "6 or more" : best.n}.`,
        cat: best.k.cat, noun: best.k.noun, styles: best.k.styles, colors: bestColours(best.k.cat, 3, best.k.styles) });
    }
    // Bottlenecks: one piece in most of an occasion's outfits.
    for (const occ of everydayOccs()) {
      const outfits = Object.keys(SEASONS).flatMap((se) => cov.cells[`${se}|${occ.id}`]);
      if (outfits.length < 6) continue;
      const count = new Map();
      for (const o of outfits) for (const p of o) count.set(p, (count.get(p) || 0) + 1);
      const [piece, n] = [...count].filter(([p]) => ["bottom", "shoes", "outer"].includes(roleOf(p))).sort((a, b) => b[1] - a[1])[0] || [];
      if (!piece || n / outfits.length < 0.6) continue;
      const k = LOOK_KIT_FOR().filter((x) => x.cat === piece.category && Math.abs(x.f - occ.target) <= 1).sort((a, b) => Math.abs(a.f - occ.target) - Math.abs(b.f - occ.target))[0];
      if (!k) continue;
      push({ prio: "medium", label: "Bottleneck", title: cap(k.noun),
        why: `Your ${piece.name} is in ${Math.round((n / outfits.length) * 100)}% of your ${occ.label.toLowerCase()} outfits. ${/^[aeiou]/i.test(k.noun) ? "An" : "A"} ${k.noun} in another colour takes the pressure off it.`,
        cat: k.cat, noun: k.noun, styles: k.styles, colors: bestColours(k.cat, 4, k.styles).filter((c) => !(piece.colors || []).includes(c)).slice(0, 3) });
    }
  }
  // From the full audit (AI): only pieces that make at least one good outfit with what you own.
  for (const x of state.audit?.ideas || []) {
    if (!CAT[x.category]) continue;
    const s = { prio: x.priority || "medium", label: { gap: "Fills a gap", bottleneck: "Bottleneck", upgrade: "Upgrade", accessory: "Finishing touch" }[x.kind] || "From the audit", title: cap(x.noun), why: x.why, cat: x.category, noun: x.noun, colors: (x.colors || []).filter((c) => c).slice(0, 3) };
    if (!s.colors.length) s.colors = bestColours(s.cat);
    const m = multiplier(mkIdea({ cat: s.cat, color: s.colors[0], noun: s.noun }));
    if (m && !m.n) continue;
    push(s);
  }
  // The rules of thumb, unless a finding above already covers that kind of piece.
  for (const x of analyse().suggestions) if (!x.cat || !feed.some((f) => f.cat === x.cat)) push(x);
  // Accessories you don't have that would finish many of your outfits.
  if (cov) for (const a of ACC_KIT) {
    if (state.items.some((i) => i.category === a.cat)) continue;
    const lifted = new Set();
    let capped = false;
    for (const [k, f] of Object.entries(cov.cells)) {
      const [season, occ] = k.split("|");
      if ((a.seasons && !a.seasons.includes(season)) || (a.occs && !a.occs.includes(occ))) continue;
      for (const o of f) if (!a.when || a.when(o)) lifted.add(o.map((p) => p.id).join());
      if (f.length >= COVER_CAP) capped = true;
    }
    if (lifted.size < 3) continue;
    const lifts = `${lifted.size}${capped ? "+" : ""}`;
    push({ prio: "low", label: `Lifts ${lifts} outfits`, title: cap(a.noun), why: a.why, cat: a.cat, noun: a.noun, colors: a.colors.filter((c) => COLORS[c] || EXTRA_COLOURS[c]), lifts });
  }
  state.disc.feedMemo = { key: memoKey, feed };
  return feed;
}

// "What do you need?": a type of piece, typed or tapped. Ideas from the kit, ranked by how many
// new outfits they make with what you own; "Smarter picks" asks the AI for more.
const NEED_CHIPS = [["Shoes", ["sneakers", "boots", "dress-shoes"]], ["T-shirts", ["tshirt"]], ["Shirts", ["shirt", "polo"]], ["Knitwear", ["sweater", "sweatshirt", "overshirt"]], ["Trousers", ["trousers", "jeans"]], ["Jackets", ["jacket", "coat"]], ["Accessories", ["belt", "watch", "sunglasses", "scarf", "tie"]]];
const NEED_WORDS = [
  [/\b(t-?shirts?|tees?)\b/, ["tshirt"]], [/\bpolos?\b/, ["polo"]], [/hoodie|sweatshirt|crewneck/, ["hoodie", "sweatshirt"]], [/(?<!\bt[- ]?)\bshirts?\b|oxford/, ["shirt"]],
  [/knit|sweater|jumper|cardigan/, ["sweater"]], [/overshirt|shacket/, ["overshirt"]], [/shoe|sneaker|trainer|boot|loafer|derby|footwear/, ["sneakers", "boots", "dress-shoes"]],
  [/blazer|jacket|bomber/, ["jacket"]], [/\bcoats?\b|overcoat|trench/, ["coat"]], [/jeans|denim/, ["jeans"]], [/trousers|pants|chinos/, ["trousers"]], [/shorts/, ["shorts"]],
  [/belt/, ["belt"]], [/watch/, ["watch"]], [/sunglasses/, ["sunglasses"]], [/scarf/, ["scarf"]], [/\bties?\b/, ["tie"]], [/accessor/, ["belt", "watch", "sunglasses", "scarf", "tie"]],
];
function needCats(text) {
  const t = text.toLowerCase();
  const out = new Set();
  for (const [re, cats] of NEED_WORDS) if (re.test(t)) cats.forEach((c) => out.add(c));
  return [...out];
}
function needBar() {
  const n = state.disc.need;
  return `<section class="card stack need">
    <div class="row"><input class="input" style="flex:1;min-width:0" data-input="need" value="${esc(n?.text || "")}" placeholder="What do you need? “New shoes”, “T-shirts that match my wardrobe”…" aria-label="What do you need?"><button class="btn primary" data-act="need">Show me</button></div>
    <div class="chips scroller">${NEED_CHIPS.map(([l]) => `<button class="chip" aria-pressed="${n?.chip === l}" data-needchip="${esc(l)}">${l}</button>`).join("")}${n ? `<button class="chip" data-act="need-clear">✕ Back to For you</button>` : ""}</div>
    ${n && !n.cats?.length ? `<p class="muted small" style="margin:0">${aiReady() ? "That isn't a type of piece the app knows. Try “Smarter picks” below, or tap a chip." : "That isn't a type of piece the app knows: tap one of the chips."}</p>` : ""}
  </section>`;
}
function needResults(n) {
  const acc = n.cats.filter((c) => ACC_KIT.some((a) => a.cat === c));
  const kit = LOOK_KIT_FOR().filter((k) => n.cats.includes(k.cat));
  // Each kit piece in its best colours, the ones that make the most new outfits first.
  const blocks = kit.map((k) => {
    const colors = bestColours(k.cat, 3, k.styles);
    const b = mkIdea({ cat: k.cat, color: colors[0], noun: k.noun, styles: k.styles });
    return { s: { title: cap(k.noun), cat: k.cat, noun: k.noun, styles: k.styles, colors, why: "" }, n: (multiplier(b)?.n ?? 0) + shopScore(b) * 3 };
  });
  for (const c of acc) { const a = ACC_KIT.find((x) => x.cat === c); blocks.push({ s: { title: cap(a.noun), cat: a.cat, noun: a.noun, colors: a.colors.filter((x) => COLORS[x] || EXTRA_COLOURS[x]), why: a.why }, n: 0 }); }
  blocks.sort((a, b) => b.n - a.n);
  const ai = (n.ai || []).map((x) => ({ s: { title: cap(x.noun), cat: x.category, noun: x.noun, colors: x.colors.filter(Boolean).slice(0, 3), why: x.why, label: "Smarter pick" } }));
  const list = [...ai, ...blocks].filter(({ s }) => !settled(s)).map(({ s }) => ({ s, options: variantsOf(s).filter(soldHere) })).filter((x) => x.options.length).slice(0, 8);
  return `<section class="card">
    <div class="row" style="justify-content:space-between;align-items:baseline"><h2 style="margin:0">${esc(n.chip || cap(n.text))}</h2>
      ${aiReady() ? (n.busy ? `<span class="muted small"><span class="spinner inline"></span> Asking ${esc(aiName())}…</span>` : `<button class="linkish" data-act="need-ai">${n.ai ? "More smart picks" : "Smarter picks with AI"}</button>`) : ""}</div>
    <div class="sugg">${list.map(({ s, options }, k) => ideaBlock(`n${k}:${s.title}`, { label: s.label || "", title: s.title, why: s.why, options })).join("") || `<p class="muted">Nothing to suggest here${state.trip ? ` at ${esc(state.trip.name)}` : ""}.</p>`}</div>
  </section>`;
}
function askNeed(text, chip = "") {
  const cats = chip ? NEED_CHIPS.find(([l]) => l === chip)[1] : needCats(text);
  state.disc.need = { text: chip || text, chip, cats, ai: null };
  if (!cats.length && aiReady() && text.trim()) return smarterPicks();
  render();
}
const IDEAS_SCHEMA = {
  type: "object", additionalProperties: false, required: ["summary", "ideas"],
  properties: {
    summary: { type: "string", description: "One or two sentences on the wardrobe's biggest gaps" },
    ideas: {
      type: "array", description: "Up to 8 pieces to buy, most useful first",
      items: {
        type: "object", additionalProperties: false, required: ["kind", "category", "noun", "colors", "why", "priority"],
        properties: {
          kind: { type: "string", enum: ["gap", "bottleneck", "upgrade", "accessory"] },
          category: { type: "string", enum: CATS.filter((c) => c.slot !== "under").map((c) => c.id) },
          noun: { type: "string", description: "What it is without the colour, e.g. 'suede Chelsea boots'" },
          colors: { type: "array", items: { type: "string", enum: Object.keys(COLORS) }, description: "3 colours that work with the wardrobe, best first" },
          why: { type: "string", description: "One sentence, naming pieces it goes with by their #number" },
          priority: { type: "string", enum: ["high", "medium", "low"] },
        },
      },
    },
  },
};
// The local findings and your answers, in a few lines, so the AI builds on them.
function auditText() {
  const cov = coverage();
  const lines = [];
  if (cov) {
    const thin = Object.entries(cov.cells).filter(([, f]) => f.length < 2).map(([k]) => { const [se, o] = k.split("|"); return `${SEASONS[se].label} ${occLabel(o)}`; });
    if (thin.length) lines.push(`Season/occasion combinations with almost no good outfits: ${thin.join(", ")}.`);
  }
  const counts = Object.entries(SLOTS).map(([k, l]) => `${l} ${state.items.filter((i) => slotOf(i) === k).length}`).join(", ");
  lines.push(`Pieces per section: ${counts}.`);
  return lines.join("\n");
}
async function runAudit(auto = false) {
  if (!aiReady() || state.disc.auditBusy) return;
  state.disc.auditBusy = true;
  render();
  try {
    const text = await aiGenerate({
      system: `You are a personal stylist auditing a client's whole wardrobe in a wardrobe app. Find missing essentials, gaps for seasons and occasions, bottlenecks (one piece carrying too many outfits) and accessories that would lift what they own. Only suggest pieces that work with what they already own. Reply with JSON only.\n\n${Style.guideText({ question: "wardrobe essentials capsule gaps", k: 4 })}`,
      text: `For ${shopperText()}.${ageNow()}\nWardrobe:\n${wardrobeText()}\n\nWhat the app found:\n${auditText()}\n\nTheir taste:\n${tasteText() || "Not known yet."}`,
      schema: IDEAS_SCHEMA,
      maxTokens: 900,
    });
    const r = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
    state.audit = { at: new Date().toISOString(), items: state.items.length, summary: cleanRefs(r.summary || "", state.items.map((i) => i.id)), ideas: (r.ideas || []).slice(0, AUDIT_LIMIT).map((x) => ({ ...x, why: cleanRefs(x.why || "", state.items.map((i) => i.id)) })) };
    await saveAudit();
  } catch (e) {
    if (!auto) toast(e.message || "Couldn't run the audit");
  }
  state.disc.auditBusy = false;
  render();
}
// At most once a week, by itself, when 5 or more pieces came or went since the last one.
function autoAudit() {
  const au = state.audit;
  if (aiReady() && au && daysSince(au.at) >= 7 && Math.abs(state.items.length - (au.items || 0)) >= 5) runAudit(true);
}
async function smarterPicks() {
  const n = state.disc.need;
  if (!n || n.busy) return;
  n.busy = true;
  render();
  try {
    const text = await aiGenerate({
      system: `You are a personal stylist in a wardrobe app. Suggest pieces to buy for what the client asks, that work with what they already own. Reply with JSON only.\n\n${Style.guideText({ question: n.text, k: 4 })}`,
      text: `For ${shopperText()}.${ageNow()} They ask: "${n.text}".${n.ai?.length ? ` Different from: ${n.ai.map((x) => x.noun).join(", ")}.` : ""}\nWardrobe:\n${wardrobeText()}\n\nTheir taste:\n${tasteText() || "Not known yet."}`,
      schema: IDEAS_SCHEMA,
      maxTokens: 700,
    });
    const r = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
    const ideas = (r.ideas || []).filter((x) => CAT[x.category]).map((x) => ({ ...x, why: cleanRefs(x.why || "", state.items.map((i) => i.id)) }));
    n.ai = [...ideas, ...(n.ai || [])].slice(0, 8);
    if (!n.cats.length) n.cats = [...new Set(ideas.map((x) => x.category))];
  } catch (e) {
    toast(e.message || "Couldn't reach the stylist");
  }
  n.busy = false;
  render();
}

/* ---- For you ---- */
function forYouTab() {
  const need = state.disc.need;
  if (need?.cats?.length) return needBar() + needResults(need);
  if (!coverageDone()) {
    // Show the page first, then look through the wardrobe.
    setTimeout(() => { coverage(); if (view === "shop" && state.disc.tab === "foryou") render(); }, 30);
    return `${needBar()}<section class="card"><h2 style="margin:0">Worth adding</h2><p class="muted" style="margin:12px 0 0"><span class="spinner inline"></span> Looking through your wardrobe…</p></section>`;
  }
  const feed = auditFeed();
  const fresh = feed.filter((s) => !settled(s));
  const blocks = fresh.map((s, k) => ({ s, k, options: variantsOf(s).filter(soldHere).filter((b) => !ownsLike(b)) })).filter((x) => x.options.length);
  const notHere = fresh.length - blocks.length;
  const answered = feed.length - fresh.length;
  const au = state.audit;
  return `
    ${needBar()}
    <section class="card">
      <div class="row" style="justify-content:space-between;align-items:baseline"><h2 style="margin:0">Worth adding</h2>
        ${aiReady() ? `<span class="muted small">${state.disc.auditBusy ? `<span class="spinner inline"></span> ${esc(aiName())} is looking through your wardrobe…` : `${au ? `Full audit ${daysSince(au.at) === 0 ? "today" : `${daysSince(au.at)} day${daysSince(au.at) > 1 ? "s" : ""} ago`} · ` : ""}<button class="linkish" data-act="audit">${au ? "Run it again" : "Run a full audit"}</button>`}</span>` : ""}
      </div>
      ${au?.summary ? `<p class="muted" style="margin:10px 0 0">${esc(au.summary)}</p>` : ""}
      <div class="sugg">${blocks.map(({ s, k, options }) => ideaBlock(`s${k}:${s.title}`, {
        label: s.label || (s.prio === "high" ? "Fills a gap" : s.prio === "medium" ? "Adds range" : "Nice to have"), title: s.title, why: s.why, options,
      })).join("") || `<p class="muted">${fresh.length ? `None of these ideas are sold at ${esc(state.trip?.name)}.` : "Your wardrobe looks well balanced."}</p>`}</div>
      ${notHere && blocks.length ? `<p class="muted small" style="margin:12px 0 0">${notHere} more idea${notHere > 1 ? "s aren't" : " isn't"} sold at ${esc(state.trip.name)}.</p>` : ""}
      ${answered ? `<p class="muted small" style="margin:12px 0 0">${answered} idea${answered > 1 ? "s" : ""} answered. The ones you liked are in <button class="linkish" data-disc="must">Must-Buy</button>.</p>` : ""}
    </section>
    <p class="muted small" style="margin:0">Your style mix, palette, brands and the pieces you don't wear are in <button class="linkish" data-act="report-open">Wardrobe › Report</button>.</p>
    <section class="card ai-box">
      <h2 style="margin:0">Personal shopping advice</h2>
      <p class="muted small" style="margin:0">${aiReady() ? `${aiName()} looks at your whole wardrobe and suggests the next few buys.` : "Add a Gemini or Claude API key in Settings for tailored shopping advice."}</p>
      <div class="row"><button class="btn primary" data-ask="${esc(SHOP_QUESTION)}">What should I buy next?</button></div>
      <div class="ai-answer" id="ai-answer">${answerHTML(state.aiAnswer)}</div>
    </section>`;
}

/* ======================================================================
   Wardrobe > Report: what you own, what it can do, and what you don't wear
   All worked out on the device, no AI. Seasonal readiness counts the outfits that pass the
   fashion bible at each season's usual temperature for each occasion (from 250 combinations per
   season picked at random when there are more, scaled up). Dead weight compares your stars with
   how often you wear each piece, per week it was in season, so a coat isn't flagged in July.
   ====================================================================== */
const ICON_CHART = `<svg viewBox="0 0 24 24" aria-hidden="true" style="width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/></svg>`;
let readyMemo = null;
const readinessDone = () => !Style.ready() || readyMemo?.sig === coverSig();
function readiness() {
  if (!Style.ready()) return null;
  const sig = coverSig();
  if (readyMemo?.sig === sig) return readyMemo;
  const by = ownedByRole();
  const grid = {}, good = new Set(), tried = new Set(), every = new Set();
  for (const [season, { feels }] of Object.entries(SEASONS)) {
    const list = outfitsAt(by, feels, 250);
    const [tops, , bottoms, shoes] = list.parts;
    const keys = new Set(list.map((o) => o.key));
    const all = new Set();
    for (const t of new Set(tops.map((x) => x.at(-1)))) for (const bo of bottoms) for (const sh of shoes) all.add(`${t.id}|${bo.id}|${sh?.id ?? ""}`);
    all.forEach((k) => every.add(k));
    keys.forEach((k) => tried.add(k));
    const scale = keys.size ? all.size / keys.size : 1;
    for (const occ of everydayOccs()) {
      const ok = new Set();
      for (const o of list) if (goodOutfit((o.built ||= Style.outfitFrom(o.pieces)), occ.id, feels)) ok.add(o.key);
      ok.forEach((k) => good.add(k));
      grid[`${season}|${occ.id}`] = Math.round(ok.size * scale);
    }
  }
  // Seasons share outfits, so the total is scaled over all of them (and is at least the biggest cell).
  const total = Math.max(Math.round(good.size * (tried.size ? every.size / tried.size : 1)), ...Object.values(grid));
  return (readyMemo = { sig, grid, total });
}
// The usual temperature of each month where you live (the app's built-in cities), else the seasons.
function monthTemps() {
  const c = state.settings.lat != null ? nearestCity(state.settings.lat, state.settings.lon) : null;
  const south = (state.settings.lat ?? 45) < 0;
  return Array.from({ length: 12 }, (_, m) => (c ? (2 * c.hi[m] + c.lo[m]) / 3 : SEASONS[["winter", "winter", "spring", "spring", "spring", "summer", "summer", "summer", "autumn", "autumn", "autumn", "winter"][(m + (south ? 6 : 0)) % 12]].feels));
}
// Would you wear it at this temperature? Coats in the cold, shorts in the heat, most things all year.
function inSeason(p, t) {
  const r = roleOf(p), w = p.warmth || 2;
  if (r === "outer") return t < (w >= 4 ? 12 : w >= 3 ? 17 : 20);
  if (r === "mid") return t < (w >= 3 ? 18 : 22);
  if (p.category === "shorts") return t >= 20;
  if (p.category === "boots") return t < 18;
  if (["scarf", "beanie", "gloves"].includes(p.category)) return t < 14;
  return true;
}
const REPORT_DAYS = 180;
// Each piece's stars (yours, else the average of the outfits with it you rated) and how often you
// wear it per week it was in season, over the last 6 months (or since you added it).
function pieceUse() {
  const temps = monthTemps();
  const from = Date.now() - REPORT_DAYS * 864e5;
  const wears = new Map(), outfitStars = new Map();
  for (const l of state.log) {
    const kind = logKind(l), at = Date.parse(l.at || l.date);
    if (kind === "wear" && at >= from) for (const id of l.itemIds || []) wears.set(id, (wears.get(id) || 0) + 1);
    if (kind === "rate" && l.stars) for (const id of l.itemIds || []) { const a = outfitStars.get(id) || [0, 0]; a[0] += l.stars; a[1]++; outfitStars.set(id, a); }
  }
  return state.items.filter((i) => slotOf(i) !== "under").map((i) => {
    const since = Math.max(from, Date.parse(i.createdAt || 0) || from);
    let days = 0;
    for (let d = since; d < Date.now(); d += 864e5) if (inSeason(i, temps[new Date(d).getMonth()])) days++;
    const os = outfitStars.get(i.id);
    const stars = i.disliked ? 1 : starsOf(i) || (os && os[1] >= 2 ? os[0] / os[1] : null);
    const n = wears.get(i.id) || 0;
    return { item: i, stars, wears: n, perWeek: days >= 7 ? n / (days / 7) : null, age: daysSince(i.createdAt) };
  });
}
// Hidden gems, core, dead weight, upgrade, and forgotten pieces (not rated, rarely worn).
function deadWeight() {
  const groups = { gems: [], core: [], dead: [], upgrade: [], forgotten: [], leaving: [] };
  for (const u of pieceUse()) {
    const i = u.item;
    if (leaving(i)) { groups.leaving.push(u); continue; }
    if (u.age < 60 || i.wash || u.perWeek == null) continue; // too new, in the wash, or not its season yet
    if (i.fate?.status === "keep" && daysSince(i.fate.at) < 90) continue;
    const often = u.perWeek >= 0.2; // about once every five weeks it's in season
    if (u.stars == null) { if (!often) groups.forgotten.push(u); else groups.core.push(u); continue; }
    if (u.stars >= 3.5) groups[often ? "core" : "gems"].push(u);
    else if (u.stars <= 2.5) groups[often ? "upgrade" : "dead"].push(u);
  }
  return groups;
}
function renderReport() {
  const a = analyse();
  const total = state.items.length || 1;
  const palette = Object.entries(a.colorCount).sort((x, y) => y[1] - x[1]);
  const styleMix = Object.entries(a.styleCount).sort((x, y) => y[1] - x[1]);
  const brands = Object.entries(a.brandCount).sort((x, y) => y[1] - x[1]);
  const tiers = {};
  for (const i of state.items) { const t = brandInfo(i.brand)?.tier; if (t) tiers[t] = (tiers[t] || 0) + 1; }
  const use = pieceUse();
  const tracked = use.length || 1;
  const worn90 = state.items.filter((i) => slotOf(i) !== "under" && daysSince(i.lastWorn) <= 90).length;
  // The share of pieces that make 70% of what you wear.
  const counts = use.map((u) => u.wears).sort((x, y) => y - x), wornTotal = counts.reduce((x, y) => x + y, 0);
  let k = 0, acc = 0;
  while (wornTotal && acc < wornTotal * 0.7) acc += counts[k++];
  const priced = state.items.filter((i) => i.price && i.wearCount);
  const cur = priced[0]?.currency;
  const cpw = priced.length && priced.every((i) => i.currency === cur) ? priced.reduce((x, i) => x + i.price, 0) / priced.reduce((x, i) => x + i.wearCount, 0) : null;
  const ready = readinessDone() ? readiness() : null;
  if (!readinessDone()) setTimeout(() => { readiness(); if (view === "wardrobe" && state.wardView === "report") render(); }, 30);
  const g = deadWeight();
  const tile = (u, act) => `<div class="dw-piece">${pieceTile(u.item)}<span class="muted small">${u.stars ? `${"★".repeat(Math.round(u.stars))} · ` : ""}${u.wears ? `worn ${u.wears}×` : "not worn"}</span>${act(u.item)}</div>`;
  const group = (key, title, hint, act) => (g[key].length ? `<div class="dw-group"><div class="row" style="justify-content:space-between;align-items:baseline"><h3 style="margin:0">${title} <span class="muted">${g[key].length}</span></h3><span class="muted small">${hint}</span></div><div class="dw-list">${g[key].slice(0, 8).map((u) => tile(u, act)).join("")}</div></div>` : "");
  const fateBtns = (i) => `<div class="chips"><button class="chip" data-fate="${i.id}|donate">Donate</button><button class="chip" data-fate="${i.id}|sell">Sell</button><button class="chip" data-fate="${i.id}|keep">Keep</button></div>`;
  const upgradeBtn = (i) => {
    const b = mkIdea({ cat: i.category, color: i.colors?.[0] || "", noun: catLabel(i.category).toLowerCase(), styles: i.styles });
    const w = wantOf(b);
    const data = esc(JSON.stringify({ title: b.title, cat: b.cat, noun: b.noun, color: b.color, styles: b.styles, query: b.query, why: `To replace your ${i.name}: you wear it a lot but rate it ${Math.round(starsOf(i) || 2)} stars.`, source: "report" }));
    return w?.status === "wanted" ? `<button class="chip" data-disc="must">✓ On Must-Buy</button>` : `<button class="chip" data-yes="${data}">A better one to Must-Buy</button>`;
  };
  const occs = everydayOccs();
  return (main.innerHTML = `
    <div class="head"><div><h1>Report</h1><p class="sub">Your wardrobe at a glance, worked out on this device.</p></div>
      <div class="chips"><button class="chip" data-act="report-close">← Wardrobe</button></div></div>
    <div class="stack">
    <div class="stats">
      <div class="stat"><b>${state.items.length}</b><span>pieces</span></div>
      <div class="stat"><b>${ready ? ready.total : "…"}</b><span>outfits that pass the fashion bible</span></div>
      <div class="stat"><b>${Math.round((worn90 / tracked) * 100)}%</b><span>worn in the last 90 days</span></div>
      ${cpw != null ? `<div class="stat"><b>${fmtPrice(cpw, cur)}</b><span>average cost per wear</span></div>` : ""}
      ${wornTotal >= 10 ? `<div class="stat"><b>${Math.round((k / tracked) * 100)}%</b><span>of your pieces make 70% of what you wear</span></div>` : ""}
    </div>
    <section class="card">
      <h2>Ready for each season</h2>
      ${ready ? `<div class="ready-wrap"><table class="ready"><thead><tr><th></th>${occs.map((o) => `<th>${esc(o.label.split(" /")[0])}</th>`).join("")}</tr></thead><tbody>
        ${Object.entries(SEASONS).map(([se, { label }]) => `<tr><th>${label}</th>${occs.map((o) => { const n = ready.grid[`${se}|${o.id}`]; return `<td class="${n === 0 ? "zero" : n < 3 ? "low" : ""}">${n}</td>`; }).join("")}</tr>`).join("")}
      </tbody></table></div>
      <p class="muted small" style="margin:12px 0 0">Outfits that pass the fashion bible at each season's usual temperature. A 0 is a gap: <button class="linkish" data-disc="foryou">For you</button> suggests what fills it.</p>`
        : Style.ready() ? `<p class="muted"><span class="spinner inline"></span> Counting outfits…</p>` : `<p class="muted">The fashion bible hasn't loaded yet.</p>`}
    </section>
    <section class="card stack">
      <h2 style="margin:0">Worn and loved</h2>
      <p class="muted small" style="margin:0">Your stars against how often you wear each piece when it's in season, over the last 6 months. Pieces added in the last 60 days aren't judged yet.</p>
      ${group("gems", "Hidden gems", "Rated high, rarely worn", (i) => `<button class="chip" data-anchor="${i.id}">Wear it this week</button>`)}
      ${group("dead", "Dead weight", "Rated low, rarely worn", fateBtns)}
      ${group("upgrade", "Upgrade", "Rated low, worn often", upgradeBtn)}
      ${group("forgotten", "Forgotten", "Not rated, rarely worn", (i) => `<div class="chips"><button class="chip" data-anchor="${i.id}">Wear it</button><button class="chip" data-fate="${i.id}|donate">Donate</button><button class="chip" data-fate="${i.id}|keep">Keep</button></div>`)}
      ${group("leaving", "On their way out", "Left out of outfit ideas", (i) => `<div class="chips"><button class="chip" data-gone="${i.id}">It's gone</button><button class="chip" data-fateclear="${i.id}">Keep it after all</button></div>`)}
      ${g.core.length ? `<p class="muted small" style="margin:0"><b>Core:</b> ${g.core.length} piece${g.core.length > 1 ? "s" : ""} you rate well and wear often.</p>` : ""}
      ${!["gems", "dead", "upgrade", "forgotten", "leaving", "core"].some((x) => g[x].length) ? `<p class="muted" style="margin:0">Nothing to judge yet: rate pieces and wear outfits for a few weeks.</p>` : ""}
    </section>
    ${state.scents.length ? scentReport() : ""}
    <div class="two-col">
      <section class="card">
        <h2>Your style</h2>
        <div class="stack" style="gap:12px">
          ${styleMix.length ? styleMix.map(([st, n]) => `<button class="style-row" data-stylego="${esc(st)}"><span>${styleLabel(st)}</span><span class="muted">${Math.round((n / total) * 100)}%</span><span class="bar"><i style="width:${(n / total) * 100}%"></i></span></button>`).join("") : `<p class="muted">Add pieces to see your style mix.</p>`}
        </div>
      </section>
      <section class="card">
        <h2>Brands</h2>
        ${brands.length ? `<div class="chips">${brands.map(([b, n]) => { const t = brandInfo(b)?.tier; return `<button class="chip" data-brandgo="${esc(b)}">${esc(b)}${n > 1 ? ` <span class="muted">×${n}</span>` : ""}${t ? ` <span class="tier">${t}</span>` : ""}</button>`; }).join("")}</div>` : `<p class="muted">No brands recorded yet.</p>`}
        ${brandTwins(brands.map(([b]) => b)).map(([a, b]) => `<div class="row" style="margin-top:10px;gap:8px"><span class="muted small" style="flex:1">Same brand? <b>${esc(a)}</b> and <b>${esc(b)}</b></span><button class="chip" data-brandmerge="${esc(b)}|${esc(a)}">Merge as ${esc(a)}</button><button class="chip" data-brandapart="${esc(a)}|${esc(b)}">Different</button></div>`).join("")}
        ${Object.keys(tiers).length ? `<p class="muted small" style="margin:14px 0 0">${Object.entries(tiers).map(([t, n]) => `${n} ${t}`).join(" · ")}</p>` : ""}
        ${palette.length ? `<h2 style="margin-top:22px">Palette</h2><div class="chips">${palette.map(([c, n]) => `<span class="chip"><span class="dot" style="background:${COLORS[c]?.hex}"></span>${cap(c)} ${Math.round((n / total) * 100)}%</span>`).join("")}</div>
          <p class="muted small" style="margin:12px 0 0">${Math.round((palette.filter(([c]) => COLORS[c]?.neutral).reduce((x, [, n]) => x + n, 0) / total) * 100)}% neutrals.</p>` : ""}
      </section>
    </div>
    <section class="card">
      <h2>Over and under</h2>
      <div class="stack" style="gap:14px">
        ${Object.entries(SLOTS).filter(([k]) => SLOT_TARGET[k]).map(([k, l]) => {
          const n = a.bySlot[k].length, t = SLOT_TARGET[k];
          return `<div><div class="row" style="justify-content:space-between"><span>${l}</span><span class="muted">${n} / ${t} suggested${n > t * 2 ? " · a lot" : n === 0 ? " · none" : ""}</span></div><div class="bar"><i style="width:${Math.min(100, (n / t) * 100)}%;${n === 0 ? "background:var(--warn);width:4%" : ""}"></i></div></div>`;
        }).join("")}
        ${(() => { const miss = ACC_KIT.filter((x) => !state.items.some((i) => i.category === x.cat)).map((x) => catLabel(x.cat).toLowerCase()); return miss.length ? `<p class="muted small" style="margin:0">Accessories you don't have: ${miss.join(", ")}.</p>` : ""; })()}
      </div>
    </section>
    </div>`);
}

/* ---- Try a piece ---- */
const TRY_CATS = CATS.filter((c) => CORE.includes(c.slot));
// The day an idea is shown for: a puffer on a cold day, shorts on a hot one.
function tempFor(p) {
  const w = p.warmth || 2, r = roleOf(p);
  if (r === "outer") return [18, 17, 15, 11, 6, 1][w];
  if (r === "mid") return w >= 3 ? 11 : 15;
  if (p.category === "shorts") return 26;
  if (r === "base") return 21;
  if (p.category === "boots") return 8;
  return Math.min(22, Math.max(8, conditions().feels));
}
// The occasion a piece is made for: closest dressiness, and a style the occasion likes.
function bestOcc(p) {
  const gym = slotOf(p) === "gym";
  return OCCASIONS.filter((o) => (o.id === "gym") === gym)
    .map((o) => [Math.abs(o.target - (p.formality || 1)) - ((p.styles || []).some((s) => o.likes.includes(s)) ? 0.5 : 0), o])
    .sort((a, b) => a[0] - b[0])[0][1];
}
function tryTab() {
  const t = state.disc.try;
  const fits = t.cat ? fitsFor({ category: t.cat }) : [];
  const myBrands = Object.entries(analyse().brandCount).sort((x, y) => y[1] - x[1]).map(([b]) => b);
  const chip = (attr, k, label, on, extra = "") => `<button class="chip" aria-pressed="${on}" data-${attr}="${esc(k)}">${extra}${esc(label)}</button>`;
  return `
    <section class="card stack find">
      <h2 style="margin:0">What are you thinking of buying?</h2>
      <p class="muted small" style="margin:0">Pick what it is and its colour${aiReady() ? ", or take a photo of it in the shop" : ""}. The app checks it against everything you own and builds outfits with it.</p>
      <div class="field"><label>Type</label><div class="chips">${TRY_CATS.filter((c) => c.id !== "skirt" || state.settings.gender === "women").map((c) => chip("trycat", c.id, c.label, t.cat === c.id)).join("")}</div></div>
      <div class="field"><label>Colour</label><div class="chips">${Object.keys(COLORS).map((c) => chip("trycolor", c, cap(c), t.color === c, `<span class="dot" style="background:${COLORS[c].hex}"></span>`)).join("")}</div></div>
      ${fits.length ? `<div class="field"><label>Fit <span class="muted">(optional)</span></label><div class="chips">${fits.map((k) => chip("tryfit", k, FITS[k].label, t.fit === k)).join("")}</div></div>` : ""}
      <div class="field"><label>Style <span class="muted">(optional)</span></label><div class="chips scroller">${Object.keys(STYLES).map((k) => chip("trystyle", k, styleLabel(k), t.style === k)).join("")}</div></div>
      <div class="find-fields">
        <input class="input" data-input="trytext" value="${esc(t.text)}" placeholder="Details, e.g. cargo, suede, striped (optional)" aria-label="Details">
        <input class="input" data-input="trybrand" value="${esc(t.brand)}" placeholder="Brand (optional)" list="try-brands" autocomplete="off" aria-label="Brand">
        <datalist id="try-brands">${[...new Set([...myBrands, ...BRAND_LIST.map(([n]) => n)])].map((n) => `<option value="${esc(n)}"></option>`).join("")}</datalist>
      </div>
      ${myBrands.length ? `<div class="chips scroller"><span class="muted small" style="align-self:center;white-space:nowrap">Your brands</span>${myBrands.slice(0, 12).map((n) => chip("trybrand", n, n, t.brand === n)).join("")}</div>` : ""}
      <div class="row">
        <button class="btn primary" data-act="try">Check my wardrobe</button>
        ${aiReady() ? `<button class="btn" data-act="try-photo" ${t.busy ? "disabled" : ""}><svg viewBox="0 0 24 24"><path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/></svg>${t.busy ? "Looking at the photo…" : "Take a photo of it"}</button>` : ""}
      </div>
    </section>
    ${t.shown ? tryResult(t) : ""}`;
}
function tryIt() {
  const t = state.disc.try;
  const text = t.text.trim().replace(/\s+/g, " ");
  const cat = t.cat || (text ? buyKind(text.toLowerCase()).cat : "");
  if (!cat || !CORE.includes(roleOf({ category: cat }))) return toast("Pick what kind of piece it is first");
  const color = t.color || colourIn(text);
  // "cargo" with Trousers → "cargo trousers"; "white leather sneakers" stays as typed.
  let noun = text.replace(new RegExp(`\\b${escRe(color)}\\b`, "i"), "").trim();
  if (!noun || buyKind(noun.toLowerCase()).cat !== cat) noun = `${noun} ${catLabel(cat).toLowerCase()}`.trim();
  const styles = t.style ? [t.style] : undefined;
  t.shown = mkIdea({ cat, color, noun, brand: t.brand.trim(), fit: fitsFor({ category: cat }).includes(t.fit) ? t.fit : "", styles });
  t.occ = "";
  t.answer = "";
  render();
}
async function tryPhoto(file) {
  const t = state.disc.try;
  t.busy = true;
  render();
  try {
    const blob = await resizeImage(file, 900);
    const r = await aiTagPhoto(blob, null);
    if (!CORE.includes(roleOf({ category: r.category }))) throw new Error("That doesn't look like a top, bottom, jacket or pair of shoes. Try another photo.");
    Object.assign(t, { cat: r.category, color: r.colors?.[0] || "", fit: FITS[r.fit] ? r.fit : "", style: r.styles?.[0] || "", brand: r.brand || "", text: "", occ: "", answer: "" });
    t.shown = { ...mkIdea({ cat: r.category, color: t.color, brand: t.brand, title: cap(r.name || catLabel(r.category)), fit: t.fit, styles: r.styles }), photo: blob };
  } catch (e) {
    toast(e.message || "Couldn't read that photo");
  }
  t.busy = false;
  render();
}
function tryResult(t) {
  const b = t.shown;
  const piece = asPiece(b);
  const could = wornWith(piece), matches = matchesFor(piece);
  const share = could.length ? matches.length / could.length : 0;
  const [verdict, line] = !could.length ? ["Nothing to compare yet", "Add pieces from other parts of an outfit to see how it fits in."]
    : share >= 0.6 ? ["Easy to wear", `It goes with ${matches.length} of the ${could.length} pieces you'd wear it with.`]
    : share >= 0.3 ? ["Works well", `It goes with ${matches.length} of the ${could.length} pieces you'd wear it with.`]
    : ["Hard to match", `Only ${matches.length} of your ${could.length} pieces go with it. A more neutral colour would be easier to wear.`];
  const similar = state.items.filter((o) => o.category === b.cat && o.colors?.[0] && o.colors[0] === piece.colors[0]);
  const occ = OCCASIONS.find((o) => o.id === t.occ) || bestOcc(piece);
  const cond = { feels: tempFor(piece), wet: false };
  const ideas = could.length ? pickIdeas(ideaPool({ anchor: piece, occ, cond }), 3) : [];
  const order = ["outer", "mid", "base", "bottom", "shoes"];
  return `<section class="card stack">
    <div class="try-head">
      ${artTile(b)}
      <div class="stack" style="gap:6px">
        <span class="prio">${verdict}</span>
        <h2 style="margin:0">${esc(b.title)}</h2>
        <p class="muted" style="margin:0">${line}</p>
        ${similar.length ? `<p style="margin:0">You already own ${similar.length === 1 ? "something similar" : `${similar.length} similar pieces`}:</p><div class="pieces mini">${similar.slice(0, 4).map(pieceTile).join("")}</div>` : ""}
      </div>
    </div>
    ${ideas.length ? `<h2 style="margin:6px 0 0">Outfits with it</h2>
      <div class="chips scroller">${OCCASIONS.filter((o) => (o.id === "gym") === (slotOf(piece) === "gym")).map((o) => `<button class="chip" aria-pressed="${o.id === occ.id}" data-tryocc="${o.id}">${o.label}</button>`).join("")}</div>
      <p class="muted small" style="margin:0">From your wardrobe, for a ${fmtTemp(cond.feels)} day.</p>
      <div class="looks try-looks">${ideas.map((c) => `<article class="look"><div class="pieces">${order.filter((k) => c.pieces[k]).map((k) => (c.pieces[k].isNew ? `<div class="piece new">${artTile(b)}<span>New: ${esc(b.title)}</span></div>` : pieceTile(c.pieces[k]))).join("")}</div>${c.reasons.length ? `<p class="why">${c.reasons.map(esc).join(" · ")}</p>` : ""}</article>`).join("")}</div>` : ""}
    ${ideaDetail(b, { withPieces: false })}
    ${aiReady() ? `<div class="row"><button class="btn" data-act="try-ai">Ask the stylist about it</button></div>` : ""}
    <div class="ai-answer" id="try-ai">${answerHTML(t.answer)}</div>
  </section>`;
}

/* ---- Shop trip ---- */
const TRIP_SYSTEM =
  "You help a shopper plan a trip to a shopping mall, outlet, shopping street or a single shop, anywhere in the world. " +
  "Use Google Search to check which shops are really there now. Plain text, no markdown. " +
  "Line 1: 'Place: <official name>, <city>, <country>', or 'Place: not found'. " +
  "Then one line per shop that sells clothes, shoes or accessories (for a single shop, only that shop; at most 40 lines): " +
  `<shop name> | <its website domain, e.g. zara.com> | <what it sells, comma-separated, only from: ${SELL_GROUPS.join(", ")}> | <price: budget, mid, premium or luxury>`;
function parseTrip(text, key) {
  let name = "";
  const stores = [];
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\*\*/g, "").replace(/^[\s*•·-]*(\d+[.)]\s+)?/, "").trim();
    const place = line.match(/^place\s*:\s*(.+)$/i);
    if (place) { name = /not found/i.test(place[1]) ? "" : place[1].trim(); continue; }
    const p = line.split("|").map((x) => x.trim());
    if (p.length < 3 || !p[0]) continue;
    const domain = (p[1].toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/\s]/)[0].match(/^[a-z0-9.-]+\.[a-z]{2,}$/) || [""])[0];
    const sells = p[2].toLowerCase().split(/\s*,\s*/).flatMap((g) => (g === "shoes" ? ["sneakers", "boots", "smart shoes"] : SELL_GROUPS.includes(g) ? [g] : []));
    if (!stores.some((s) => s.name.toLowerCase() === p[0].toLowerCase())) stores.push({ name: p[0], domain, sells: [...new Set(sells)], price: (p[3] || "").toLowerCase() });
  }
  return name && stores.length ? { key, name, stores, at: today() } : null;
}
async function setTrip(trip) {
  state.trip = trip;
  if (trip) {
    state.trips = [trip, ...state.trips.filter((t) => t.key !== trip.key)].slice(0, 8);
    await store.put("kv", state.trips, "trips");
  }
  await store.put("kv", trip, "trip");
  render();
}
async function lookupTrip(raw) {
  const place = String(raw || "").trim().replace(/\s+/g, " ");
  if (!place) return toast("Type a mall or a shop first");
  const key = fold(place);
  const known = state.trips.find((t) => t.key === key);
  if (known) return setTrip(known);
  // A brand the app knows is one shop: no need to look anything up.
  const brand = brandInfo(place);
  if (brand) return setTrip({ key, name: brand.name, single: true, stores: [{ name: brand.name, domain: "", sells: [] }] });
  if (!aiReady()) {
    toast("Without an AI key the app can't look inside a mall, so it searches this name as one shop.");
    return setTrip({ key, name: place, single: true, stores: [{ name: place, domain: "", sells: [] }] });
  }
  state.disc.tripBusy = place;
  render();
  try {
    const text = await aiGenerate({ system: TRIP_SYSTEM, text: `Place: ${place}\nThe shopper lives in: ${state.settings.city || "unknown"}\nThe shopper is ${shopperText()}: list only shops that sell for them.`, search: true, maxTokens: 1600 });
    const trip = parseTrip(text, key);
    state.disc.tripBusy = "";
    if (!trip) { toast(`Couldn't find “${place}”. Try adding the city.`); return render(); }
    return setTrip(trip);
  } catch (e) {
    state.disc.tripBusy = "";
    toast(e.message || "Couldn't look that place up");
    render();
  }
}
function tripTab() {
  const tr = state.trip, d = state.disc;
  const a = analyse();
  const blocks = tr ? a.suggestions.filter((s) => !settled(s)).map((s, k) => ({ s, k, options: variantsOf(s).filter(soldHere) })).filter((x) => x.options.length) : [];
  const wish = tr ? mustBuy().filter(soldHere) : [];
  return `
    <section class="card stack">
      <h2 style="margin:0">Where are you going shopping?</h2>
      <p class="muted small" style="margin:0">A mall, an outlet, a shopping street or a single shop, anywhere in the world. ${aiReady() ? `${aiName()} looks up which clothing shops are there (once per place), then every idea in Discover only shows those shops.` : "Add an AI key in Settings to look up the shops inside a mall; without it, the name is searched as one shop."}</p>
      <div class="row"><input class="input" style="flex:1;min-width:0" data-input="tripq" value="${esc(d.tripq)}" placeholder="e.g. Westfield Milano, Il Centro Arese, Uniqlo" aria-label="Mall or shop"><button class="btn primary" data-act="trip" ${d.tripBusy ? "disabled" : ""}>Look it up</button></div>
      ${state.trips.length ? `<div class="chips scroller"><span class="muted small" style="align-self:center;white-space:nowrap">Recent</span>${state.trips.map((t) => `<button class="chip" aria-pressed="${tr?.key === t.key}" data-tripgo="${esc(t.key)}">${esc(t.name.split(",")[0])}</button>`).join("")}</div>` : ""}
      ${d.tripBusy ? `<div class="row"><div class="spinner"></div><span class="muted">Looking up the shops at ${esc(d.tripBusy)}…</span></div>` : ""}
    </section>
    ${tr ? `<section class="card stack">
      <div class="row" style="justify-content:space-between"><div><h2 style="margin:0">${esc(tr.name)}</h2><p class="muted small" style="margin:4px 0 0">${tr.single ? "One shop" : `${tr.stores.length} shops with clothes, shoes or accessories`}</p></div><button class="btn ghost" data-act="trip-clear">Stop filtering</button></div>
      <div class="chips">${tr.stores.map((st) => `<a class="chip" href="${st.domain ? `https://${esc(st.domain)}` : `https://www.google.com/search?q=${encodeURIComponent(st.name)}`}" target="_blank" rel="noopener">${esc(st.name)}${st.price ? ` <span class="tier">${esc(st.price)}</span>` : ""}</a>`).join("")}</div>
      <p class="muted small" style="margin:0">Try a piece and New look also use only these shops while this trip is on.</p>
    </section>
    <section class="card">
      <h2>What you could buy here</h2>
      <div class="sugg">${blocks.map(({ s, k, options }) => ideaBlock(`s${k}:${s.title}`, { label: s.prio === "high" ? "Fills a gap" : s.prio === "medium" ? "Adds range" : "Nice to have", title: s.title, why: s.why, options })).join("") || `<p class="muted">None of the ideas for your wardrobe are sold here. Try a piece or New look to search these shops anyway.</p>`}</div>
    </section>
    ${wish.length ? `<section class="card"><h2>From your Must-Buy</h2><div class="sugg">${wish.map(mustRow).join("")}</div></section>` : ""}` : ""}`;
}

/* ---- New look ---- */
const SEASONS = { spring: { label: "Spring", feels: 16 }, summer: { label: "Summer", feels: 27 }, autumn: { label: "Autumn", feels: 12 }, winter: { label: "Winter", feels: 3 } };
function seasonNow(m = new Date().getMonth()) {
  const south = (state.settings.lat ?? 45) < 0;
  const n = m >= 2 && m <= 4 ? "spring" : m >= 5 && m <= 7 ? "summer" : m >= 8 && m <= 10 ? "autumn" : "winter";
  return south ? { spring: "autumn", summer: "winter", autumn: "spring", winter: "summer" }[n] : n;
}
// Built-in looks (no AI): pieces with how dressy (f) and warm (w) they are and the styles
// they suit, and colour stories where every part already goes together.
const LOOK_KIT = [
  ["base", "tshirt", "heavyweight T-shirt", 1, 1, "casual streetwear minimal sporty vintage outdoor"],
  ["base", "tshirt", "boxy graphic T-shirt", 1, 1, "streetwear"],
  ["base", "polo", "knitted polo", 2.5, 1, "smart casual preppy minimal luxury"],
  ["base", "polo", "piqué polo", 2, 1, "preppy smart casual casual sporty"],
  ["base", "shirt", "Oxford shirt", 2.5, 1, "preppy smart casual smart casual"],
  ["base", "shirt", "linen shirt", 2, 1, "smart casual minimal casual luxury"],
  ["base", "shirt", "poplin shirt", 3.5, 1, "smart formal luxury"],
  ["base", "shirt", "flannel shirt", 1.5, 2, "vintage outdoor casual"],
  ["mid", "sweatshirt", "crewneck sweatshirt", 1, 2, "casual sporty vintage minimal"],
  ["mid", "hoodie", "heavyweight hoodie", 1, 3, "streetwear casual sporty"],
  ["mid", "sweater", "merino crewneck", 2.5, 2, "minimal smart casual smart preppy luxury"],
  ["mid", "sweater", "cable-knit sweater", 2, 3, "preppy vintage smart casual outdoor"],
  ["mid", "sweater", "roll-neck sweater", 3.2, 3, "smart luxury formal minimal"],
  ["mid", "overshirt", "wool overshirt", 2, 2, "smart casual outdoor vintage minimal streetwear"],
  ["mid", "zip-hoodie", "zip track top", 1, 2, "sporty streetwear"],
  ["outer", "jacket", "denim jacket", 1, 2, "casual vintage streetwear"],
  ["outer", "jacket", "bomber jacket", 1.5, 3, "streetwear casual minimal"],
  ["outer", "jacket", "suede jacket", 2.5, 3, "smart casual vintage luxury"],
  ["outer", "jacket", "unstructured blazer", 3, 2, "smart smart casual preppy luxury formal"],
  ["outer", "jacket", "Harrington jacket", 2, 2, "preppy vintage smart casual"],
  ["outer", "jacket", "leather jacket", 2, 3, "streetwear vintage luxury"],
  ["outer", "jacket", "quilted jacket", 2, 3, "preppy outdoor smart casual"],
  ["outer", "rain", "technical shell jacket", 1, 2, "outdoor sporty streetwear"],
  ["outer", "coat", "trench coat", 3, 3, "smart preppy luxury minimal"],
  ["outer", "coat", "wool overcoat", 3.3, 4, "smart luxury formal minimal smart casual"],
  ["outer", "puffer", "puffer jacket", 1, 5, "streetwear outdoor casual sporty minimal"],
  ["bottom", "jeans", "straight-leg jeans", 1.2, 2, "casual vintage minimal streetwear smart casual"],
  ["bottom", "jeans", "baggy jeans", 1, 2, "streetwear"],
  ["bottom", "trousers", "cargo trousers", 1, 2, "streetwear outdoor casual"],
  ["bottom", "trousers", "chinos", 2, 2, "smart casual preppy casual"],
  ["bottom", "trousers", "pleated wool trousers", 3.2, 2, "smart luxury formal minimal"],
  ["bottom", "trousers", "linen trousers", 2.3, 1, "smart casual minimal luxury"],
  ["bottom", "joggers", "joggers", 1, 2, "sporty streetwear"],
  ["bottom", "shorts", "chino shorts", 1.5, 1, "casual preppy smart casual minimal"],
  ["bottom", "shorts", "denim shorts", 1, 1, "casual streetwear vintage"],
  ["bottom", "shorts", "training shorts", 1, 1, "sporty"],
  ["shoes", "sneakers", "leather sneakers", 1.8, 2, "minimal smart casual casual luxury preppy"],
  ["shoes", "sneakers", "retro running sneakers", 1, 2, "sporty streetwear casual vintage"],
  ["shoes", "sneakers", "chunky sneakers", 1, 2, "streetwear"],
  ["shoes", "sneakers", "canvas sneakers", 1, 2, "casual vintage"],
  ["shoes", "boots", "suede Chelsea boots", 2.5, 4, "smart casual minimal smart vintage luxury"],
  ["shoes", "boots", "leather work boots", 1.5, 4, "outdoor vintage casual streetwear"],
  ["shoes", "dress-shoes", "leather loafers", 3, 2, "preppy smart luxury smart casual"],
  ["shoes", "dress-shoes", "Derby shoes", 3.5, 2, "smart formal"],
  // Only offered when shopping for women (Settings > Shop for).
  ["base", "tshirt", "fitted rib top", 1.5, 1, "minimal casual smart casual", "women"],
  ["bottom", "skirt", "midi skirt", 2.5, 1, "smart casual minimal luxury preppy", "women"],
  ["bottom", "skirt", "pleated mini skirt", 1.8, 1, "preppy casual streetwear vintage", "women"],
  ["shoes", "dress-shoes", "ballet flats", 2.3, 2, "minimal preppy smart casual luxury", "women"],
].map(([role, cat, noun, f, w, styles, who]) => ({ role, cat, noun, f, w, styles: parseStyles(styles), who }));
// Colours for [base, mid, outer, bottom, shoes]; jeans and denim keep their own colour.
const LOOK_PALETTES = [
  { name: "Monochrome", c: ["white", "grey", "black", "black", "white"], styles: "minimal streetwear smart sporty luxury" },
  { name: "Navy and cream", c: ["white", "navy", "navy", "cream", "brown"], styles: "preppy smart casual smart minimal" },
  { name: "Earth tones", c: ["cream", "olive", "brown", "beige", "brown"], styles: "vintage outdoor casual smart casual" },
  { name: "Charcoal and white", c: ["white", "charcoal", "charcoal", "grey", "black"], styles: "smart formal luxury minimal" },
  { name: "Camel and cream", c: ["cream", "beige", "camel", "cream", "brown"], styles: "luxury smart minimal smart casual" },
  { name: "Black and olive", c: ["black", "black", "olive", "black", "black"], styles: "streetwear outdoor minimal" },
  { name: "Burgundy accent", c: ["white", "burgundy", "navy", "charcoal", "white"], styles: "preppy smart casual casual vintage" },
  { name: "Summer whites", c: ["white", "light blue", "beige", "beige", "white"], styles: "smart casual minimal casual preppy luxury" },
  { name: "Grey marl", c: ["white", "grey", "navy", "grey", "white"], styles: "sporty casual minimal streetwear" },
  { name: "Brown tonal", c: ["cream", "brown", "brown", "cream", "brown"], styles: "luxury minimal vintage smart casual" },
].map((p) => ({ ...p, styles: parseStyles(p.styles) }));
const ROLE_IDX = { base: 0, mid: 1, outer: 2, bottom: 3, shoes: 4 };
function builtInLook(season, style, occ) {
  const want = 0.6 * occ.target + 0.4 * (STYLES[style]?.f || 1.5);
  const hot = season === "summer", cold = season === "winter";
  const roles = ["base", "bottom", "shoes"];
  if (!hot) roles.splice(1, 0, cold ? "mid" : Math.random() < 0.5 ? "mid" : "outer");
  if (cold) roles.splice(2, 0, "outer");
  if (hot && want >= 2.9) roles.splice(1, 0, "outer"); // a light blazer for work or an elegant evening
  const fitsSeason = (k) => {
    if (k.role === "outer") return hot ? k.noun === "unstructured blazer" : cold ? k.w >= 3 : k.w <= 3;
    if (k.role === "mid") return !cold || k.w >= 2;
    if (k.role === "bottom") return hot ? k.w <= 1 || k.cat === "jeans" && want < 2 : k.cat !== "shorts" && (cold ? k.w >= 2 : true);
    if (k.role === "shoes") return hot ? k.cat !== "boots" : true;
    return !hot || k.w <= 1;
  };
  const pal = LOOK_PALETTES.map((p) => [p.styles.includes(style) ? 2 + Math.random() : Math.random(), p]).sort((a, b) => b[0] - a[0])[0][1];
  const pieces = roles.map((role) => {
    const best = LOOK_KIT.filter((k) => k.role === role && fitsSeason(k) && (!k.who || k.who === state.settings.gender))
      .map((k) => [(k.styles.includes(style) ? 3 : 0) - Math.abs(k.f - want) * 1.5 + (cold && k.cat === "boots" ? 1 : 0) + Math.random() * 1.6, k])
      .sort((a, b) => b[0] - a[0])[0]?.[1];
    if (!best) return null;
    let color = pal.c[ROLE_IDX[role]];
    if (best.cat === "jeans") color = COLORS[color]?.tone === "light" ? "light-wash" : color === "black" ? "black" : "indigo";
    if (best.noun === "denim jacket" || best.noun === "denim shorts") color = "denim";
    return mkIdea({ cat: best.cat, color, noun: best.noun.replace(/^denim /, (m) => (color === "denim" ? "" : m)) });
  }).filter(Boolean);
  return { title: `${pal.name} ${SEASONS[season].label.toLowerCase()} look`, why: `${styleLabel(style)} pieces in a ${pal.name.toLowerCase()} colour story, dressed right for ${occ.label.toLowerCase()}.`, pieces };
}
const LOOK_CATS = CATS.filter((c) => !["under"].includes(c.slot)).map((c) => c.id);
const LOOK_SCHEMA = {
  type: "object", additionalProperties: false, required: ["title", "why", "pieces"],
  properties: {
    title: { type: "string", description: "A short name for the look" },
    why: { type: "string", description: "One sentence on why it works" },
    pieces: {
      type: "array", description: "4 to 6 pieces: top, bottom and shoes, a layer or outerwear when the season needs it, at most one accessory",
      items: {
        type: "object", additionalProperties: false, required: ["name", "category", "color", "search", "store"],
        properties: {
          name: { type: "string", description: "Colour first, e.g. 'Ecru cable-knit sweater'" },
          category: { type: "string", enum: LOOK_CATS },
          color: { type: "string", enum: Object.keys(COLORS) },
          search: { type: "string", description: "Words to paste into a shop's search box" },
          store: { type: "string", description: "Which of the listed shops sells it; empty when no shops are listed" },
        },
      },
    },
  },
};
// The important fashion bible rules a designed look (new pieces: type and colour only) still breaks.
const lookBreaks = (r, occ) => (Style.ready() ? Style.judge((r.pieces || []).map((p) => ({ category: p.category, colors: [p.color], name: p.name })), { occasion: occ.id }).violations.map(ruleLine) : []);
async function makeLook() {
  const L = state.disc.look;
  const season = L.season || seasonNow(), style = L.style || topStyle() || "casual", occ = OCCASIONS.find((o) => o.id === L.occ) || OCCASIONS[0];
  if (!aiReady()) { L.result = builtInLook(season, style, occ); return render(); }
  L.busy = true;
  render();
  try {
    const a = analyse();
    const palette = Object.entries(a.colorCount).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([c]) => c).join(", ");
    const brands = Object.entries(a.brandCount).sort((x, y) => y[1] - x[1]).slice(0, 4).map(([b]) => b).join(", ");
    const shops = state.trip ? state.trip.stores.map((s) => s.name).slice(0, 30).join(", ") : "";
    const guide = Style.guideText({ question: `${styleLabel(style)} ${occ.label} ${SEASONS[season].label}`, occasion: occ.id, k: 4 });
    const request = (fix = "") => aiGenerate({
      system: `You are a stylist in a wardrobe app. Design one complete outfit made only of new pieces the user can buy. Reply with JSON only.${guide ? "\n\n" + guide : ""}`,
      text: `For ${shopperText()}.${ageNow()} Season: ${SEASONS[season].label}. Style: ${styleLabel(style)}. Occasion: ${occ.label}.` +
        (palette ? ` Colours they usually wear: ${palette}.` : "") + (brands ? ` Brands they own: ${brands}.` : "") +
        (shops ? ` Only use pieces sold by these shops and name the shop for each: ${shops}.` : "") +
        ` Real, easy-to-find pieces; at most one accent colour.` + (L.seen.length ? ` Make it different from: ${L.seen.slice(-4).join("; ")}.` : "") + fix,
      schema: LOOK_SCHEMA,
      maxTokens: 700,
    });
    const parse = (text) => JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
    let r = parse(await request());
    // A look that breaks an important rule of the fashion bible gets one more try.
    let breaks = lookBreaks(r, occ);
    if (breaks.length) {
      const again = parse(await request(` Your last look broke the style guide: ${breaks.join("; ")}. Design another that follows it.`));
      const left = lookBreaks(again, occ);
      if (left.length <= breaks.length) { r = again; breaks = left; }
    }
    const pieces = (r.pieces || []).filter((p) => CAT[p.category]).slice(0, 6).map((p) => {
      const st = state.trip?.stores.find((s) => s.name.toLowerCase() === String(p.store || "").toLowerCase());
      return { ...mkIdea({ cat: p.category, color: p.color, title: cap(p.name) }), query: p.search || p.name, store: st?.name || "" };
    });
    if (!pieces.length) throw new Error("The stylist didn't send any pieces. Try again.");
    L.result = { title: r.title, why: r.why, pieces, ai: true, warn: breaks };
    L.seen.push(r.title);
  } catch (e) {
    toast(`${e.message || "Couldn't reach the stylist"} Showing a built-in look instead.`);
    L.result = builtInLook(season, style, occ);
  }
  L.busy = false;
  render();
}
const topStyle = () => Object.entries(analyse().styleCount).sort((x, y) => y[1] - x[1])[0]?.[0];
function lookTab() {
  const L = state.disc.look;
  const season = L.season || seasonNow(), style = L.style || topStyle() || "casual";
  const r = L.result;
  return `
    <section class="card stack">
      <h2 style="margin:0">Build me a new look</h2>
      <p class="muted small" style="margin:0">${aiReady() ? `${aiName()} designs it (one short request).` : "Built-in looks. Add an AI key in Settings for more variety."} Every piece is new, with shop links.</p>
      <div class="field"><label>Season</label><div class="chips">${Object.entries(SEASONS).map(([k, s]) => `<button class="chip" aria-pressed="${season === k}" data-lookseason="${k}">${s.label}</button>`).join("")}</div></div>
      <div class="field"><label>Style</label><div class="chips scroller">${Object.keys(STYLES).map((k) => `<button class="chip" aria-pressed="${style === k}" data-lookstyle="${esc(k)}">${styleLabel(k)}</button>`).join("")}</div></div>
      <div class="field"><label>Occasion</label><div class="chips scroller">${OCCASIONS.map((o) => `<button class="chip" aria-pressed="${L.occ === o.id}" data-lookocc="${o.id}">${o.label}</button>`).join("")}</div></div>
      <div class="row"><button class="btn primary" data-act="look" ${L.busy ? "disabled" : ""}>${r ? "Another look" : "Create a look"}</button>${L.busy ? `<div class="spinner"></div><span class="muted">Putting a look together…</span>` : ""}</div>
    </section>
    ${r ? `<section class="card stack">
      <div><h2 style="margin:0">${esc(r.title)}</h2>${r.why ? `<p class="muted" style="margin:6px 0 0">${esc(r.why)}</p>` : ""}${r.warn?.length ? `<p class="why warn" style="margin:6px 0 0">Heads up: ${r.warn.map(esc).join(" · ")}</p>` : ""}</div>
      <div class="pieces look-row">${r.pieces.map((b) => `<div class="piece">${artTile(b)}<span>${esc(b.title)}</span></div>`).join("")}</div>
      <div class="sugg">${r.pieces.map((b) => `<div class="look-piece"><div class="row" style="gap:10px">${artTile(b)}<div><h3 style="margin:0">${esc(b.title)}</h3>${b.store ? `<span class="muted small">At ${esc(b.store)}</span>` : state.trip && !soldHere(b) ? `<span class="muted small">Not sold at ${esc(state.trip.name)}</span>` : ""}</div></div>${ideaDetail(b, { withPieces: false })}</div>`).join("")}</div>
    </section>` : ""}`;
}

/* ---- Real photos ---- */
// Asked for one idea at a time: Gemini searches Google for real products, and the app's
// server opens each page to read its product photo (shops don't let a browser do that).
const photoKey = (b) => `${b.query}|${state.settings.gender}|${state.trip?.key || ""}`;
const realBtn = (b) => `<button class="btn" data-real="${esc(JSON.stringify({ title: b.title, query: b.query, cat: b.cat, color: b.color }))}"><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m21 16-5-5-8 8"/></svg>Real photos</button>`;
function photosHTML(b) {
  const ph = state.disc.photos[photoKey(b)];
  if (!ph) return "";
  if (ph.busy) return `<div class="row"><div class="spinner"></div><span class="muted">Searching the shops for ${esc(b.title)}…</span></div>`;
  if (ph.error) return `<p class="muted small" style="margin:0">${esc(ph.error)}</p>`;
  const safe = (u) => (/^https?:\/\//i.test(u || "") ? u : "");
  return `<div class="real">
    ${ph.note ? `<p class="muted small" style="margin:0;grid-column:1/-1">${esc(ph.note)}</p>` : ""}
    ${ph.items.map((p) => `<a class="real-card" href="${esc(safe(p.url))}" target="_blank" rel="noopener"><img class="real-img" src="${esc(safe(p.image))}" referrerpolicy="no-referrer" loading="lazy" alt=""><b>${esc(p.title)}</b><span class="muted small">${esc([p.shop, p.price].filter(Boolean).join(" · "))}</span></a>`).join("")}
    ${!ph.items.length && ph.links.length ? `<div class="stack" style="gap:6px"><span class="muted small">${ph.noServer ? "Photos can only be loaded on the hosted app. Products found:" : "No photos could be loaded from these shops. Products found:"}</span>${ph.links.map((p) => `<a class="btn ghost" href="${esc(safe(p.url))}" target="_blank" rel="noopener">${esc([p.title, p.shop, p.price].filter(Boolean).join(" · "))}</a>`).join("")}</div>` : ""}
    ${!ph.items.length && !ph.links.length ? `<p class="muted small" style="margin:0">No products found this time. The shop buttons above still search for it.</p>` : ""}
  </div>`;
}
// What a product page shows: its photo, name and price (worker/api.js, GET /api/page).
// When the shop turns the server away, the server tries free link-preview services, which can take longer.
// `code` (model and colour) asks for every photo of that product and the page's text too.
async function pageInfo(url, wait = 12000, code = "") {
  try {
    const r = await fetch(`api/page?${new URLSearchParams({ url, ...(code ? { code } : {}) })}`, AbortSignal.timeout ? { signal: AbortSignal.timeout(wait) } : {});
    if (r.status === 404 && !(r.headers.get("Content-Type") || "").includes("json")) return { noServer: true };
    const j = await r.json().catch(() => ({}));
    return r.ok ? j : { error: j.error || `The app's server answered ${r.status}.` };
  } catch { return { error: "The product page took too long to open." }; }
}
async function realPhotos(b) {
  if (!productsOn() && !aiReady()) return toast("Real photos need a SerpApi key on the server (see Settings > Look) or an AI key.");
  const k = photoKey(b);
  if (state.disc.photos[k]?.busy) return;
  state.disc.photos[k] = { busy: true };
  if (view !== "add") render();
  if (productsOn()) {
    try {
      await loadProducts(b);
      const items = productsFor(b).slice(0, 6);
      const st = tripStores(b);
      const here = st ? items.filter((p) => atShops(p, st)).length : items.length;
      state.disc.photos[k] = { items, links: [], note: st && !here && items.length ? `None of these are from the shops at ${state.trip.name.split(",")[0]}; similar products elsewhere:` : "" };
      if (view !== "add") render();
      return;
    } catch (e) {
      if (!aiReady()) { state.disc.photos[k] = { error: e.message }; if (view !== "add") render(); return; }
    }
  }
  try {
    let sources = [];
    const st = tripStores(b);
    const where = st?.length ? `Only products sold by: ${st.slice(0, 12).map((s) => s.name).join(", ")}.` : `The shopper lives in ${state.settings.city || "Europe"}; pick shops that deliver there.`;
    const text = await aiGenerate({
      system: "You find real clothes for sale online for a shopping app. Use Google Search. Plain text only, no markdown.",
      text: `Find 4 different products for ${shopperText()} for sale now that match: ${b.title} (search words: ${forWho(b.query, "en")}). ${where}\nOne line each: product name | shop | price with currency | product page URL`,
      search: true, maxTokens: 700, onSources: (w) => (sources = w),
    });
    const found = [];
    for (const line of text.split("\n")) {
      const url = line.match(/https?:\/\/[^\s|)\]>"]+/)?.[0];
      const p = line.split("|").map((x) => x.replace(/\*\*/g, "").trim());
      if (url && p.length >= 3) found.push({ title: p[0].replace(/^[\s*•·-]*(\d+[.)]\s+)?/, ""), shop: p[1], price: /\d/.test(p[2]) ? p[2] : "", url });
    }
    for (const w of sources) if (found.length < 8 && !found.some((f) => f.url === w.uri)) found.push({ title: "", shop: w.title || "", price: "", url: w.uri, fromSearch: true });
    const pages = await Promise.all(found.slice(0, 8).map(async (f) => ({ ...f, page: await pageInfo(f.url) })));
    const items = [], seen = new Set();
    for (const p of pages) {
      const img = p.page?.image;
      if (!img || seen.has(img) || items.length >= 4) continue;
      seen.add(img);
      items.push({ title: p.title || p.page.title || b.title, shop: p.shop || p.page.site || "", price: p.price || p.page.price || "", url: p.page.url || p.url, image: img });
    }
    const noServer = pages.some((p) => p.page?.noServer);
    state.disc.photos[k] = { items, noServer, links: items.length ? [] : found.filter((f) => !f.fromSearch).slice(0, 4) };
  } catch (e) {
    state.disc.photos[k] = { error: e.message || "Couldn't search the shops right now." };
  }
  if (view !== "add") render();
}
// A photo a shop won't let us show: drop its card, or show the drawing under it.
document.addEventListener("error", (e) => {
  if (e.target.matches?.("img.real-img")) e.target.closest(".real-card")?.remove();
  if (e.target.matches?.("img.prod-img")) e.target.remove();
}, true);
document.addEventListener("load", (e) => { if (e.target.matches?.("img.prod-img")) e.target.classList.add("ok"); }, true);

/* ---- Product photos ---- */
// With a SerpApi key on the server (SERPAPI_KEY, free plan: 250 searches a month), ideas
// show a real product photo instead of the drawing, and "Real photos" lists the products of
// the same search: no AI tokens. The server keeps each search for two weeks, so an idea
// costs one search however often it's shown. Tiles only ask once they're on screen.
const products = new Map(); // search key → { items } once loaded, or the pending Promise
let productsDown = ""; // set when the server says searches can't run (none left this month…)
const productsOn = () => !!state.serverKeys.products && !productsDown;
function productSearch(b) {
  const it = state.settings.region === "it";
  return { q: forWho(b.query, it ? "it" : "en"), gl: it ? "it" : "us", hl: it ? "it" : "en" };
}
const productKey = (b) => { const { q, gl } = productSearch(b); return `${gl}|${q.toLowerCase()}`; };
const atShops = (p, stores) => stores.some((s) => (p.shop || "").toLowerCase().includes(s.name.toLowerCase()) || (s.domain && (p.url || "").includes(s.domain)));
// The products found, those from the shops on the trip (if one is on) first.
function productsFor(b) {
  const got = products.get(productKey(b));
  if (!got?.items) return null;
  const st = tripStores(b);
  return st ? [...got.items.filter((p) => atShops(p, st)), ...got.items.filter((p) => !atShops(p, st))] : got.items;
}
function loadProducts(b) {
  const key = productKey(b);
  if (products.has(key)) return Promise.resolve(products.get(key));
  const { q, gl, hl } = productSearch(b);
  const job = fetch(`api/products?${new URLSearchParams({ q, gl, hl })}`)
    .then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Product search failed (${r.status}).`);
      return { items: j.items || [] };
    })
    .then((v) => { products.set(key, v); return v; }, (e) => {
      products.delete(key);
      if (/^SerpApi/.test(e.message)) { productsDown = e.message; if (view === "settings") render(); }
      throw e;
    });
  products.set(key, job);
  return job;
}
// Inside a picture tile: your own photo, a product photo, or the drawing.
function tileInner(b) {
  if (b.photo) return `<img src="${photoURL(b.photo)}" alt="">`;
  const img = productsOn() && productsFor(b)?.[0]?.image;
  // The drawing stays underneath, so a photo that won't load just goes away.
  return garmentArt(b) + (img ? `<img class="prod-img" src="${esc(img)}" referrerpolicy="no-referrer" alt="">` : "");
}
const prodAttr = (b) => (productsOn() && !b.photo && !productsFor(b) ? ` data-prod="${esc(JSON.stringify({ title: b.title, query: b.query, cat: b.cat, color: b.color }))}"` : "");
const tileWatch = "IntersectionObserver" in window
  ? new IntersectionObserver((seen) => { for (const e of seen) if (e.isIntersecting) { tileWatch.unobserve(e.target); fillTile(e.target); } }, { rootMargin: "150px" })
  : null;
async function fillTile(el) {
  const spec = el.dataset.prod;
  if (!spec) return;
  const b = JSON.parse(spec);
  try { await loadProducts(b); } catch { return; }
  for (const t of document.querySelectorAll("[data-prod]")) if (t.dataset.prod === spec) { t.innerHTML = tileInner(b); delete t.dataset.prod; }
}
function watchTiles() {
  if (!productsOn()) return;
  tileWatch?.disconnect();
  for (const el of document.querySelectorAll("[data-prod]")) tileWatch ? tileWatch.observe(el) : fillTile(el);
}

/* ======================================================================
   Wardrobe > Fragrances: the cabinet
   Each bottle keeps its notes, families and a small profile (how fresh, sweet, heavy and
   loud it is), plus when it works: seasons, day or evening, how dressy. A photo of the
   bottle or its name is enough: the AI reads the bottle and looks the fragrance up once,
   and the answer is kept on the server for every device (ai_cache), so the same fragrance
   never costs a second request. Everything stays editable.
   ====================================================================== */
const SCENT_FAMILIES = {
  fresh: "Fresh", citrus: "Citrus", aquatic: "Aquatic", green: "Green", aromatic: "Aromatic", fougere: "Fougère", woody: "Woody",
  spicy: "Spicy", amber: "Amber", gourmand: "Gourmand", leather: "Leather", floral: "Floral", musky: "Musky", chypre: "Chypre",
};
// The cabinet's filter chips, each a group of families.
const SCENT_GROUPS = [
  ["fresh", "Fresh", ["fresh", "citrus", "aquatic", "green", "aromatic", "fougere"]],
  ["woody", "Woody", ["woody", "leather", "chypre"]],
  ["amber", "Amber", ["amber", "spicy", "gourmand"]],
  ["floral", "Floral", ["floral", "musky"]],
];
const CONCENTRATIONS = { EDC: "Eau de Cologne", EDT: "Eau de Toilette", EDP: "Eau de Parfum", Parfum: "Parfum", Extrait: "Extrait de Parfum" };
const SCENT_TIMES = { day: "Day", night: "Evening", both: "Day and evening" };
const SCENT_DRESS = ["", "Casual", "Smart casual", "Smart", "Formal"]; // 1–4, the same scale as clothes (STYLES[…].f)
const FILLS = { full: "Full", half: "Half", low: "Running low", empty: "Empty" };
// The profile the matching reads: [key, label, lowest, highest].
const PROFILE_BARS = [["fresh", "Freshness", 0, 3], ["sweet", "Sweetness", 0, 3], ["weight", "Weight", 1, 5], ["projection", "Projection", 1, 5], ["longevity", "Longevity", 1, 5]];
const PROFILE_WORDS = {
  fresh: ["Not fresh", "A little fresh", "Fresh", "Very fresh"],
  sweet: ["Dry", "Slightly sweet", "Sweet", "Very sweet"],
  weight: ["", "Very light", "Light", "Medium", "Rich", "Heavy"],
  projection: ["", "Skin scent", "Close", "Moderate", "Strong", "Fills a room"],
  longevity: ["", "Under 3 hours", "3 to 5 hours", "5 to 7 hours", "7 to 10 hours", "Over 10 hours"],
};
const runningLow = (sc) => ["low", "empty"].includes(sc.fill);
const scentNorm = (x) => String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
// The same fragrance gets the same key on every device: "hermes|terre d hermes|EDT".
const scentKey = (sc) => `${scentNorm(sc.house)}|${scentNorm(sc.name)}|${sc.concentration || ""}`;

// AI answers kept for every device (the server's ai_cache), or on this device when there's no server.
const CACHE_DAYS = { scent: Infinity, pair: 30 };
async function cacheGet(kind, q) {
  try {
    const r = await fetch(`api/cache?${new URLSearchParams({ kind, q })}`, { cache: "no-store" });
    if (r.ok && (r.headers.get("Content-Type") || "").includes("json")) {
      const { data } = await r.json();
      if (data) return data;
    }
  } catch {}
  const hit = ((await raw.get("kv", "aiCache")) || {})[`${kind}:${q}`];
  return hit && Date.now() - hit.at < CACHE_DAYS[kind] * 864e5 ? hit.data : null;
}
async function cachePut(kind, q, data) {
  const local = (await raw.get("kv", "aiCache")) || {};
  local[`${kind}:${q}`] = { data, at: Date.now() };
  await raw.put("kv", local, "aiCache");
  fetch("api/cache", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, q, data }) }).catch(() => {});
}

const SCENT_SYSTEM = "You know perfumes and colognes well: their notes, families, and when and how they're worn. Reply with JSON only. If you don't know the fragrance, set found to false and leave the rest empty or 0.";
const SCENT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["found", "name", "house", "concentration", "sizeMl", "top", "heart", "base", "accords", "families", "fresh", "sweet", "weight", "projection", "longevity", "spring", "summer", "autumn", "winter", "time", "formality", "vibes"],
  properties: {
    found: { type: "boolean", description: "true if you know this fragrance" },
    name: { type: "string", description: "The fragrance's name without the house, e.g. 'Sauvage'" },
    house: { type: "string", description: "The perfume house, e.g. 'Dior'" },
    concentration: { type: "string", enum: [...Object.keys(CONCENTRATIONS), "unknown"] },
    sizeMl: { type: "number", description: "The bottle's size in ml if it's printed on it, else 0" },
    top: { type: "array", items: { type: "string" }, description: "Up to 4 top notes, lower case" },
    heart: { type: "array", items: { type: "string" }, description: "Up to 4 heart notes, lower case" },
    base: { type: "array", items: { type: "string" }, description: "Up to 4 base notes, lower case" },
    accords: { type: "array", items: { type: "string" }, description: "Up to 4 main accords, lower case" },
    families: { type: "array", items: { type: "string", enum: Object.keys(SCENT_FAMILIES) }, description: "1 to 3 families, main first" },
    fresh: { type: "number", description: "0 not fresh … 3 very fresh" },
    sweet: { type: "number", description: "0 dry … 3 very sweet" },
    weight: { type: "number", description: "1 very light … 5 heavy and dense" },
    projection: { type: "number", description: "1 stays on the skin … 5 fills a room" },
    longevity: { type: "number", description: "1 under 3 hours … 5 over 10 hours" },
    spring: { type: "number", description: "0 wrong season, 1 fine, 2 ideal" },
    summer: { type: "number", description: "0 wrong season, 1 fine, 2 ideal" },
    autumn: { type: "number", description: "0 wrong season, 1 fine, 2 ideal" },
    winter: { type: "number", description: "0 wrong season, 1 fine, 2 ideal" },
    time: { type: "string", enum: Object.keys(SCENT_TIMES) },
    formality: { type: "number", description: "How dressy: 1 casual, 2 smart casual, 3 smart, 4 formal" },
    vibes: { type: "array", items: { type: "string", enum: Object.keys(STYLES) }, description: "1 to 3 clothing styles it suits" },
  },
};
// The AI's answer as the fields a bottle keeps (the bottle's own size and fill aren't part of it).
function scentFromAI(r) {
  const list = (a, n) => [...new Set((a || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean))].slice(0, n);
  const num = (x, lo, hi, dflt) => (Number.isFinite(+x) ? clamp(Math.round(+x), lo, hi) : dflt);
  return {
    name: String(r.name || "").trim().slice(0, 60), house: String(r.house || "").trim().slice(0, 40),
    concentration: CONCENTRATIONS[r.concentration] ? r.concentration : "",
    notes: { top: list(r.top, 5), heart: list(r.heart, 5), base: list(r.base, 5) },
    accords: list(r.accords, 5),
    families: [...new Set((r.families || []).filter((f) => SCENT_FAMILIES[f]))].slice(0, 3),
    profile: { fresh: num(r.fresh, 0, 3, 1), sweet: num(r.sweet, 0, 3, 1), weight: num(r.weight, 1, 5, 3), projection: num(r.projection, 1, 5, 3), longevity: num(r.longevity, 1, 5, 3) },
    seasons: Object.fromEntries(Object.keys(SEASONS).map((k) => [k, num(r[k], 0, 2, 1) / 2])),
    time: SCENT_TIMES[r.time] ? r.time : "both",
    formality: num(r.formality, 1, 4, 2),
    vibes: [...new Set((r.vibes || []).filter((v) => STYLES[v]))].slice(0, 3),
  };
}

/* ---- Adding and editing a bottle ---- */
let scentDraft = null; // the bottle being added or edited
const newScentDraft = () => ({
  id: null, photos: [], name: "", house: "", concentration: "", notes: { top: [], heart: [], base: [] }, accords: [], families: [],
  profile: { fresh: 1, sweet: 1, weight: 3, projection: 3, longevity: 3 }, seasons: { spring: 1, summer: 1, autumn: 1, winter: 1 },
  time: "both", formality: 2, vibes: [], sizeMl: "", fill: "full", info: { source: "manual" }, busy: "", note: "",
});
const rerenderScent = (d) => { if (scentDraft === d && view === "add") render(); };
const scentEdited = (d) => (d.info = { source: "manual", at: new Date().toISOString() });
function applyScentInfo(d, info, keepConc) {
  Object.assign(d, JSON.parse(JSON.stringify(info)));
  if (keepConc) d.concentration = keepConc; // the bottle you typed it for
  d.info = { source: "ai", at: new Date().toISOString() };
}
// Fills the draft in from the name typed (the shared cache first, then the AI), or from the
// bottle's photo when there's no name yet.
async function lookupScent(d, fromPhoto = false) {
  if (!d || d.busy) return;
  const photo = d.photos[0];
  const byName = !fromPhoto && d.name.trim();
  if (!byName && !photo) { d.note = "Type its name (and house), or add a photo of the bottle."; return rerenderScent(d); }
  d.note = "";
  const asked = byName && { key: scentKey(d), conc: d.concentration };
  if (asked) {
    const hit = await cacheGet("scent", asked.key);
    if (hit) {
      applyScentInfo(d, hit, asked.conc);
      d.note = "Filled in from a lookup made before, no AI needed. Check it and save.";
      return rerenderScent(d);
    }
  }
  if (!aiReady()) { d.note = "Add a Gemini key in Settings to fill in the notes for you, or fill them in below."; return rerenderScent(d); }
  d.busy = byName ? `Looking up ${d.name.trim()}…` : "Reading the bottle…";
  rerenderScent(d);
  try {
    const text = await aiGenerate({
      system: SCENT_SYSTEM,
      text: byName
        ? `Describe this fragrance: ${[d.house, d.name, CONCENTRATIONS[d.concentration]].filter(Boolean).join(" ")}.`
        : "Read this perfume bottle: the fragrance's name, house and concentration as printed on it, and its size in ml if shown. Then describe that fragrance.",
      ...(byName ? {} : { image: await resizeImage(photo, 1024) }),
      schema: SCENT_SCHEMA,
      maxTokens: 500,
    });
    const r = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
    if (!r.found || !String(r.name || "").trim()) {
      d.note = byName ? "This fragrance wasn't recognised. Check the name and house, or fill in what you know." : "Couldn't tell which fragrance this is. Type its name and house, then tap Look it up.";
    } else {
      const info = scentFromAI(r);
      if (!byName && +r.sizeMl > 0 && !d.sizeMl) d.sizeMl = String(Math.round(+r.sizeMl));
      applyScentInfo(d, info, asked?.conc);
      // Kept under the AI's own spelling, and under what you typed if that was different.
      cachePut("scent", scentKey(info), info);
      if (asked && asked.key !== scentKey(info)) cachePut("scent", asked.key, info);
      d.note = "Filled in by AI. Check it and save.";
    }
  } catch (e) {
    d.note = e.message || "Couldn't look it up. Try again.";
  }
  d.busy = "";
  rerenderScent(d);
}
const scentCam = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", capture: "environment", hidden: true });
const scentGal = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", hidden: true });
document.body.append(scentCam, scentGal);
for (const input of [scentCam, scentGal]) {
  input.onchange = async () => {
    const f = input.files[0];
    input.value = "";
    const d = scentDraft;
    if (!f || !d) return;
    d.photos.push(await resizeImage(f));
    rerenderScent(d);
    if (d.photos.length === 1 && !d.name.trim()) lookupScent(d, true); // the bottle says what it is
  };
}
function renderScentAdd() {
  const d = scentDraft;
  const cur = d.photos[0];
  const chip = (attr, value, on, label) => `<button class="chip" aria-pressed="${!!on}" data-${attr}="${esc(String(value))}">${label}</button>`;
  main.innerHTML = `
    <div class="head">
      <div><h1>${d.id ? "Edit fragrance" : "New fragrance"}</h1>${d.busy ? `<p class="sub row" style="gap:10px"><span class="spinner"></span>${esc(d.busy)}</p>` : d.id ? "" : `<p class="sub">A photo of the bottle, or its name. The notes and the rest are filled in for you.</p>`}</div>
      <div class="row"><button class="btn ghost" data-act="scent-cancel">Cancel</button></div>
    </div>
    <div class="add-grid">
      <div class="photos">
        ${cur ? `
          <div class="photo-wrap"><img class="photo-main pic-bg" src="${photoURL(cur)}" alt="">${d.busy && !d.name.trim() ? `<div class="busy"><div class="spinner"></div><span>${esc(d.busy)}</span></div>` : ""}</div>
          <div class="photo-strip">
            ${d.photos.map((p, k) => `<div class="mini${k === 0 ? " on" : ""}"><img class="pic-bg" src="${photoURL(p)}" alt=""><button class="x" data-scrmphoto="${k}" aria-label="Remove photo">×</button></div>`).join("")}
            <button class="add-photo" data-act="scent-gallery" aria-label="Add photo">+</button>
          </div>` : `
          <div class="photo-wrap no-photo"><div class="stack" style="align-items:center;text-align:center;padding:24px">
            <p class="muted" style="margin:0">Take a photo of the bottle with its name in view.</p>
            <button class="btn primary" data-act="scent-shoot">${ICON_CAMERA}Take a photo</button>
            <button class="btn" data-act="scent-gallery">${ICON_GALLERY}Choose from gallery</button>
          </div></div>`}
      </div>
      <div class="stack">
        <div class="field"><label for="sc-name">Name</label><input id="sc-name" class="input" data-input="sc-name" value="${esc(d.name)}" placeholder="e.g. Terre d'Hermès" autocomplete="off"></div>
        <div class="field"><label for="sc-house">House</label><input id="sc-house" class="input" data-input="sc-house" value="${esc(d.house)}" placeholder="e.g. Hermès" autocomplete="off"></div>
        <div class="field"><label>Concentration</label><div class="chips">${Object.entries(CONCENTRATIONS).map(([k, l]) => `<button class="chip" aria-pressed="${d.concentration === k}" data-scconc="${k}" title="${l}">${k}</button>`).join("")}</div></div>
        <div class="row">
          <button class="btn" data-act="scent-lookup" ${d.busy ? "disabled" : ""}><svg viewBox="0 0 24 24"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/></svg>Look it up</button>
          <span class="muted small">${aiReady() ? "Fills in the notes, families, seasons and the rest from the name. Looked up once, then kept for every device." : "Fills in what was looked up before. Add a Gemini key in Settings to look up new ones."}</span>
        </div>
        ${d.note ? `<p class="muted small" style="margin:0">${esc(d.note)}</p>` : ""}
        <div class="field"><label>Families <span style="text-transform:none;font-weight:400">(main first)</span></label><div class="chips">${Object.entries(SCENT_FAMILIES).map(([k, l]) => chip("scfam", k, d.families.includes(k), `${l}${d.families[0] === k && d.families.length > 1 ? " ·main" : ""}`)).join("")}</div></div>
        <div class="field"><label>Notes</label><div class="note-fields">${[["top", "Top, e.g. bergamot, lemon"], ["heart", "Heart, e.g. pepper, lavender"], ["base", "Base, e.g. vetiver, cedar"]].map(([k, ph]) => `<input class="input" data-input="sc-${k}" value="${esc(d.notes[k].join(", "))}" placeholder="${ph}" aria-label="${cap(k)} notes">`).join("")}</div></div>
        <div class="field"><label>Profile</label><div class="sc-sliders">${PROFILE_BARS.map(([k, l, lo, hi]) => `<label class="sc-slider"><span>${l}</span><input type="range" min="${lo}" max="${hi}" step="1" value="${d.profile[k]}" data-input="sc-${k}"><span class="muted small" id="scv-${k}">${PROFILE_WORDS[k][d.profile[k]]}</span></label>`).join("")}</div></div>
        <div class="field"><label>Seasons</label><div class="chips">${Object.entries(SEASONS).map(([k, v]) => chip("scseason", k, (d.seasons[k] ?? 1) >= 0.5, v.label)).join("")}</div></div>
        <div class="field"><label>Time of day</label><div class="chips">${Object.entries(SCENT_TIMES).map(([k, l]) => chip("sctime", k, d.time === k, l)).join("")}</div></div>
        <div class="field"><label>How dressy</label><div class="chips">${[1, 2, 3, 4].map((n) => chip("scform", n, d.formality === n, SCENT_DRESS[n])).join("")}</div></div>
        <div class="field"><label>Styles it suits</label><div class="chips">${Object.entries(STYLES).map(([k, v]) => chip("scvibe", k, d.vibes.includes(k), v.label)).join("")}</div></div>
        <div class="field"><label>Bottle</label><div class="row">
          <input class="input sc-size" data-input="sc-size" inputmode="numeric" value="${esc(String(d.sizeMl || ""))}" placeholder="Size in ml" aria-label="Bottle size in ml">
          <div class="chips">${Object.entries(FILLS).map(([k, l]) => chip("scdfill", k, d.fill === k, l)).join("")}</div>
        </div></div>
        <div class="row">
          <button class="btn primary big" data-act="scent-save" ${d.name.trim() && !d.busy ? "" : "disabled"}>${d.id ? "Save changes" : "Save to cabinet"}</button>
          <span class="muted small" id="sc-need"${d.name.trim() || d.busy ? " hidden" : ""}>Add its name to save.</span>
        </div>
      </div>
    </div>`;
}
// Typing in the bottle form: kept in the draft without redrawing the screen.
function scentTyped(d, k, v) {
  if (k === "name" || k === "house") {
    d[k] = v;
    const save = $('[data-act="scent-save"]');
    if (save) save.disabled = !d.name.trim() || !!d.busy;
    const need = $("#sc-need");
    if (need) need.hidden = !!d.name.trim() || !!d.busy;
    return;
  }
  if (k === "size") { d.sizeMl = v.replace(/\D/g, "").slice(0, 4); return; }
  if (d.notes[k]) d.notes[k] = v.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean).slice(0, 8);
  else if (PROFILE_WORDS[k]) {
    d.profile[k] = +v;
    const out = $(`#scv-${k}`);
    if (out) out.textContent = PROFILE_WORDS[k][+v];
  } else return;
  scentEdited(d);
}
// A chip in the bottle form. True if it was one.
function scentChip(d, ds) {
  const toggle = (list, v) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);
  if (ds.scconc) d.concentration = d.concentration === ds.scconc ? "" : ds.scconc;
  else if (ds.scdfill) d.fill = ds.scdfill;
  else if (ds.scrmphoto != null) d.photos.splice(+ds.scrmphoto, 1);
  else {
    if (ds.scfam) d.families = toggle(d.families, ds.scfam);
    else if (ds.scseason) d.seasons[ds.scseason] = (d.seasons[ds.scseason] ?? 1) >= 0.5 ? 0 : 1;
    else if (ds.sctime) d.time = ds.sctime;
    else if (ds.scform) d.formality = +ds.scform;
    else if (ds.scvibe) d.vibes = toggle(d.vibes, ds.scvibe);
    else return false;
    scentEdited(d);
  }
  render();
  return true;
}
async function saveScent() {
  const d = scentDraft;
  if (!d?.name.trim() || d.busy) return;
  const old = d.id && state.scents.find((x) => x.id === d.id);
  const now = new Date().toISOString();
  const sc = {
    ...(old || { wearCount: 0, createdAt: now }), id: d.id || uid(),
    name: d.name.trim(), house: d.house.trim(), concentration: d.concentration, photos: d.photos,
    notes: d.notes, accords: d.accords, families: d.families, profile: d.profile, seasons: d.seasons, time: d.time,
    formality: d.formality, vibes: d.vibes, sizeMl: +d.sizeMl || null, fill: d.fill, info: d.info, updatedAt: now,
  };
  await store.put("scents", sc);
  if (old) state.scents[state.scents.indexOf(old)] = sc; else state.scents.push(sc);
  scentDraft = null;
  state.wardSide = "scents";
  toast(old ? "Saved" : `${sc.name} is in your cabinet`);
  go("wardrobe");
}
function editScent(sc) {
  scentDraft = {
    ...newScentDraft(), ...JSON.parse(JSON.stringify({ ...sc, photos: [] })),
    id: sc.id, photos: [...(sc.photos || [])], sizeMl: sc.sizeMl ? String(sc.sizeMl) : "", busy: "", note: "",
  };
  closeSheet();
  go("add");
}

/* ---- The cabinet ---- */
const sideSwitch = () => `<div class="seg" role="tablist">${[["clothes", "Clothes"], ["scents", "Fragrances"]].map(([k, l]) => `<button role="tab" aria-selected="${state.wardSide === k}" data-side="${k}">${l}</button>`).join("")}</div>`;
const inGroup = (sc, g) => (sc.families || []).some((f) => SCENT_GROUPS.find(([id]) => id === g)[2].includes(f));
function seasonDots(sc) {
  const on = Object.keys(SEASONS).filter((k) => (sc.seasons?.[k] ?? 1) >= 0.5);
  return `<span class="sdots" title="${esc(on.map((k) => SEASONS[k].label).join(", ") || "No season set")}" aria-label="Seasons: ${esc(on.map((k) => SEASONS[k].label).join(", "))}">${Object.keys(SEASONS).map((k) => `<i class="${(sc.seasons?.[k] ?? 1) >= 1 ? "on" : (sc.seasons?.[k] ?? 1) >= 0.5 ? "half" : ""}"></i>`).join("")}</span>`;
}
function scentTile(sc) {
  const kind = [sc.concentration, (sc.families || []).slice(0, 2).map((f) => SCENT_FAMILIES[f].toLowerCase()).join(" ")].filter(Boolean).join(" · ");
  return `<button class="item bottle" data-scent="${sc.id}">
    <div class="pic">${sc.photos?.[0] ? `<img class="thumb pic-bg" loading="lazy" src="${photoURL(sc.photos[0])}" alt="">` : `<div class="thumb bottle-ph">${ICON_BOTTLE}</div>`}${isFavourite(sc) ? `<span class="fav">★ ${starsOf(sc)}</span>` : ""}${runningLow(sc) ? `<span class="wash-badge">${FILLS[sc.fill]}</span>` : ""}</div>
    <div class="meta"><span class="name">${esc(sc.name)}</span><span class="info">${esc(sc.house || "")}</span><span class="info">${seasonDots(sc)}${esc(kind)}</span></div>
  </button>`;
}
function renderCabinet() {
  const all = state.scents;
  const f = state.scentFilter;
  const low = all.filter(runningLow);
  const groups = SCENT_GROUPS.filter(([g]) => all.some((sc) => inGroup(sc, g)));
  const list = all.filter((sc) => f === "all" || (f === "low" ? runningLow(sc) : f === "fav" ? isFavourite(sc) : inGroup(sc, f)))
    .sort((a, b) => (starsOf(b) || 0) - (starsOf(a) || 0) || String(a.name).localeCompare(String(b.name)));
  main.innerHTML = `
    <div class="head">
      <div><h1>Wardrobe</h1><p class="sub">${all.length} fragrance${all.length === 1 ? "" : "s"}${low.some((sc) => sc.fill === "low") ? ` · ${low.filter((sc) => sc.fill === "low").length} running low` : ""}${low.some((sc) => sc.fill === "empty") ? ` · ${low.filter((sc) => sc.fill === "empty").length} empty` : ""}</p></div>
      ${all.length ? `<div class="chips"><button class="chip" data-act="scent-start">${ICON_BOTTLE}Add a fragrance</button></div>` : ""}
    </div>
    ${sideSwitch()}
    ${all.length ? `<div class="chips scroller cabinet-filters">
      <button class="chip" aria-pressed="${f === "all"}" data-scf="all">All <span class="muted">${all.length}</span></button>
      ${all.some(isFavourite) ? `<button class="chip" aria-pressed="${f === "fav"}" data-scf="fav">★ Favourites</button>` : ""}
      ${groups.map(([g, l]) => `<button class="chip" aria-pressed="${f === g}" data-scf="${g}">${l} <span class="muted">${all.filter((sc) => inGroup(sc, g)).length}</span></button>`).join("")}
      ${low.length || f === "low" ? `<button class="chip" aria-pressed="${f === "low"}" data-scf="low">Running low <span class="muted">${low.length}</span></button>` : ""}
    </div>` : ""}
    ${list.length ? `<div class="grid bottles">${list.map(scentTile).join("")}</div>` :
      all.length ? `<p class="muted">No fragrances match this filter.</p>` :
      emptyState("No fragrances yet", "Snap a bottle or type its name. Its notes, seasons and how dressy it is are filled in for you, ready for matching scents to outfits.", `<button class="btn primary" data-act="scent-start">${ICON_BOTTLE}Add a fragrance</button>`)}`;
}

/* ---- A bottle's page (sheet) ---- */
function openScent(id) {
  const sc = state.scents.find((x) => x.id === id);
  if (!sc) return;
  const p = sc.profile || {};
  const notes = [["Top", sc.notes?.top], ["Heart", sc.notes?.heart], ["Base", sc.notes?.base]].filter(([, l]) => l?.length);
  const seasons = Object.keys(SEASONS).filter((k) => (sc.seasons?.[k] ?? 1) >= 0.5);
  const ago = (d) => (daysSince(d) === 0 ? "today" : daysSince(d) === 1 ? "yesterday" : `${daysSince(d)} days ago`);
  $(".sheet-panel").innerHTML = `
    <div class="detail-head">
      <div><h1 style="font-size:28px">${esc(sc.name)}</h1><p class="sub">${esc([sc.house, CONCENTRATIONS[sc.concentration]].filter(Boolean).join(" · ") || "Fragrance")}</p></div>
      <button class="btn icon-btn ghost" data-close aria-label="Close"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div>
    <div class="row item-rate">
      ${starPicker(`s|${sc.id}`, starsOf(sc) || 0)}
      <button class="btn" data-scdislike="${sc.id}" aria-pressed="${!!sc.disliked}">${sc.disliked ? "Disliked" : "Dislike"}</button>
      ${sc.disliked ? `<span class="muted small">Won't be suggested with outfits.</span>` : ""}
    </div>
    ${sc.photos?.length ? `<div class="gallery bottle-gallery">${sc.photos.map((ph) => `<img class="pic-bg" src="${photoURL(ph)}" alt="">`).join("")}</div>` : ""}
    ${notes.length ? `<div class="kv scent-notes">${notes.map(([l, list]) => `<div><b>${l}</b>${esc(list.join(", "))}</div>`).join("")}</div>` : ""}
    ${sc.families?.length || sc.accords?.length ? `<div class="chips" style="margin:14px 0">${(sc.families || []).map((f) => `<span class="chip on">${SCENT_FAMILIES[f]}</span>`).join("")}${(sc.accords || []).filter((a) => !(sc.families || []).some((f) => scentNorm(SCENT_FAMILIES[f]) === scentNorm(a))).map((a) => `<span class="chip">${esc(a)}</span>`).join("")}</div>` : ""}
    <div class="pbars">${PROFILE_BARS.map(([k, l, lo, hi]) => p[k] == null ? "" : `<div class="pbar"><span>${l}</span><i style="--v:${(p[k] - lo) / (hi - lo)}"></i><span class="muted small">${PROFILE_WORDS[k][p[k]]}</span></div>`).join("")}</div>
    <div class="kv" style="margin:18px 0">
      <div><b>When</b>${seasons.length === 4 ? "All year" : seasons.map((k) => SEASONS[k].label).join(", ") || "Not set"} · ${SCENT_TIMES[sc.time] || SCENT_TIMES.both}</div>
      <div><b>How dressy</b>${SCENT_DRESS[sc.formality] || "Not set"}${sc.vibes?.length ? ` · ${sc.vibes.map(styleLabel).join(", ")}` : ""}</div>
      <div><b>Worn</b>${sc.wearCount ? `${sc.wearCount}×` : "Not yet"}${sc.lastWorn ? ` · ${ago(sc.lastWorn)}` : ""}</div>
      ${sc.sizeMl ? `<div><b>Size</b>${sc.sizeMl} ml</div>` : ""}
    </div>
    <div class="field" style="margin-bottom:14px"><label>Bottle</label><div class="chips">${Object.entries(FILLS).map(([k, l]) => `<button class="chip" aria-pressed="${(sc.fill || "full") === k}" data-scfill="${sc.id}|${k}">${l}</button>`).join("")}</div></div>
    ${sc.info?.source === "ai" ? `<p class="muted small">Notes and profile looked up by AI. Tap Edit to change any of it.</p>` : ""}
    <div class="row">
      <button class="btn primary" data-scwear="${sc.id}">Wearing it today</button>
      <button class="btn" data-scedit="${sc.id}">Edit</button>
      <button class="btn ghost danger" data-scdel="${sc.id}">Delete</button>
    </div>`;
  $("#sheet").hidden = false;
}
// Worn today: counted on the bottle, and added to today's outfit in the wear log if it's there.
async function countScentWear(sc) {
  sc.wearCount = (sc.wearCount || 0) + 1;
  sc.lastWorn = new Date().toISOString();
  await store.put("scents", sc);
}
async function wearScent(sc) {
  await countScentWear(sc);
  const wear = [...state.log].reverse().find((l) => logKind(l) === "wear" && l.date === today());
  if (wear && !(wear.scentIds || []).includes(sc.id)) {
    wear.scentIds = [...(wear.scentIds || []), sc.id];
    await store.put("log", wear);
  }
  toast(`Logged ${sc.name}.`);
}

/* ---- A scent for each outfit ----
   Picked on the device, no AI: the weather (the "feels like" temperature, with humid air counting
   2° warmer), the occasion, how dressy the outfit is and its styles, day or evening, the seasons the
   bottle is made for, your stars, what you picked before for that occasion and temperature, and
   not yesterday's scent again. Evenings and events also get a layering idea from two bottles you
   own. "Even better" asks the AI once per kind of outfit for fragrances you don't own; the answer
   is kept 30 days for every device (ai_cache "pair"). */
const HUMID = 70; // % relative humidity from which the air counts 2° warmer
const FRESH_FAMS = ["fresh", "citrus", "aquatic", "green"];
const MILD_FAMS = ["aromatic", "fougere", "citrus", "green", "woody"];
const WARM_FAMS = ["woody", "amber", "spicy", "leather", "gourmand"];
const tempBand = (t) => (t >= 26 ? "hot" : t >= 15 ? "mild" : "cold");
const BAND_WORDS = { hot: "hot weather", mild: "mild weather", cold: "cold weather" };
const wearableScents = () => state.scents.filter((sc) => !sc.disliked && sc.fill !== "empty");
const scentOn = () => state.settings.scents !== false && wearableScents().length > 0;
const prof = (sc) => ({ fresh: 1, sweet: 1, weight: 3, projection: 3, longevity: 3, ...sc.profile });
const words = (list) => (list.length > 1 ? `${list.slice(0, -1).join(", ")} and ${list.at(-1)}` : list[0] || "");

// What a scent is picked for: the weather, the occasion, and the outfit's pieces.
function scentContext(pieces, o = {}) {
  const c = conditions();
  const occasion = o.occasion || state.occasion;
  const feels = o.feels ?? c.feels, humid = o.humid ?? c.humid ?? 0;
  const eff = feels + (humid >= HUMID ? 2 : 0);
  const hour = o.hour ?? (state.event ? new Date(state.event.start).getHours() : new Date().getHours());
  const count = {};
  for (const p of pieces) for (const st of p.styles || []) count[st] = (count[st] || 0) + 1;
  const fs = pieces.map((p) => p.formality ?? formalityOf(p.styles || []));
  return {
    occasion, feels, humid, band: tempBand(eff), season: o.season || seasonNow(), night: occasion === "night" || hour >= 18, event: !!o.event,
    styles: new Set(Object.keys(count)), style: Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] || "casual",
    formality: fs.length ? fs.reduce((a, b) => a + b, 0) / fs.length : OCCASIONS.find((x) => x.id === occasion)?.target || 2,
  };
}
function eventScentContext(ev, pieces) {
  const m = +ev.date.slice(5, 7) - 1;
  return scentContext(pieces, {
    occasion: ev.dressCode?.occasion, feels: ev.weather?.feels ?? conditions().feels, humid: ev.weather?.humid ?? 0,
    hour: ev.time ? +ev.time.slice(0, 2) : 13, season: seasonNow(m), event: true,
  });
}
// What your picks and wears taught: points per scent, occasion and temperature band.
let scentTasteMemo = null;
function scentTaste() {
  if (scentTasteMemo?.n === state.log.length) return scentTasteMemo.t;
  const t = {};
  const add = (id, occ, band, v) => { if (id) t[`${id}|${occ}|${band}`] = (t[`${id}|${occ}|${band}`] || 0) + v; };
  for (const l of state.log) {
    const w = 0.5 ** (Math.max(0, daysSince(l.at || l.date)) / 60);
    if (l.kind === "scent") { add(l.scentId, l.occasion, l.band, w); add(l.from, l.occasion, l.band, -0.5 * w); }
    else if (logKind(l) === "wear" && l.scentIds) for (const id of l.scentIds) add(id, l.occasion, tempBand(l.feels ?? 15), 0.3 * w);
  }
  scentTasteMemo = { n: state.log.length, t };
  return t;
}
function scentScore(sc, ctx) {
  const p = prof(sc);
  const fam = new Set(sc.families || []);
  const has = (list) => list.some((f) => fam.has(f));
  let s = 0;
  if (ctx.band === "hot") s += p.fresh * 0.9 - Math.max(0, p.weight - 2) * 0.9 + (has(FRESH_FAMS) ? 1 : 0) - (has(["amber", "gourmand", "leather"]) ? 1.5 : 0) - Math.max(0, p.sweet - 1) * 0.5;
  else if (ctx.band === "mild") s += (has(MILD_FAMS) ? 0.8 : 0) - Math.abs(p.weight - 3) * 0.5;
  else s += (p.weight - 3) * 0.6 + (has(WARM_FAMS) ? 1 : 0) - (p.fresh >= 3 ? 0.8 : 0) - (fam.has("aquatic") ? 1 : 0);
  s += ((sc.seasons?.[ctx.season] ?? 0.5) - 0.5) * 1.2;
  s -= Math.abs((sc.formality || 2) - ctx.formality) * 0.7;
  if (ctx.occasion === "work" && p.projection > 3) s -= (p.projection - 3) * 1.2; // nobody wants to share an office with it
  s += ctx.night ? (sc.time === "day" ? -1 : sc.time === "night" ? 0.6 : 0) : sc.time === "night" ? -1 : 0;
  s += Math.min(2, (sc.vibes || []).filter((v) => ctx.styles.has(v)).length) * 0.5;
  if (starsOf(sc)) s += (starsOf(sc) - 3) * 0.5;
  s += scentTaste()[`${sc.id}|${ctx.occasion}|${ctx.band}`] || 0;
  if (sc.lastWorn && daysSince(sc.lastWorn) === 1) s -= 0.8; // yesterday's
  return s;
}
// One line on why it fits.
function scentWhy(sc, ctx, others) {
  const p = prof(sc);
  const kind = words([p.weight <= 2 ? "light" : p.weight >= 4 ? "rich" : "", ...(sc.families || []).slice(0, 2).map((f) => SCENT_FAMILIES[f].toLowerCase())].filter(Boolean));
  const extra = ctx.occasion === "work" && p.projection <= 3 ? ", and quiet enough for the office"
    : ctx.night && sc.time === "night" ? ", made for the evening"
    : Math.abs((sc.formality || 2) - ctx.formality) < 0.6 ? ", as dressy as the outfit" : "";
  const heavy = ctx.band === "hot" && p.weight <= 3 && others.some((x) => prof(x).weight >= 4) ? " Your heavier ones would feel too much in this heat."
    : ctx.band === "cold" && p.weight >= 3 && others.some((x) => prof(x).fresh >= 3 && prof(x).weight <= 2) ? " Your lightest ones would fade in the cold." : "";
  return `${cap(kind || "a good match")} for ${fmtTemp(ctx.feels)}${ctx.humid >= HUMID ? " and humid air" : ""}${extra}.${heavy}`;
}
// Two bottles you own worn together, for evenings and events: the heavier one first, a fresher
// one on top, never two sweet ones or two loud ones.
function layering(sc, ctx) {
  if (!(ctx.night || ctx.event || ctx.occasion === "event") || ctx.band === "hot") return "";
  const heavy = (x) => prof(x).weight >= 4 || WARM_FAMS.includes(x.families?.[0]);
  const fresh = (x) => !heavy(x) && (prof(x).fresh >= 2 || [...FRESH_FAMS, "aromatic"].includes(x.families?.[0]));
  const ok = (a, b) => a.id !== b.id && !(prof(a).sweet >= 2 && prof(b).sweet >= 2) && !(prof(a).projection >= 4 && prof(b).projection >= 4);
  const best = (list) => list.map((x) => [x, scentScore(x, ctx)]).sort((a, b) => b[1] - a[1])[0]?.[0];
  const all = wearableScents();
  const [base, top] = heavy(sc) ? [sc, best(all.filter((x) => fresh(x) && ok(sc, x)))] : fresh(sc) ? [best(all.filter((x) => heavy(x) && ok(x, sc))), sc] : [];
  if (!base || !top) return "";
  const fam = (x) => SCENT_FAMILIES[x.families?.[0]]?.toLowerCase() || "";
  return `${base.name} first on the chest, then one spray of ${top.name} on the neck: ${fam(base) || "warm"} underneath, ${fam(top) || "fresh"} on top.`;
}
const scentShown = new Map(); // what each scent line showed: key → {ctx, auto, chosen}
// The scent for an outfit: the one you picked, the one saved with a plan, or the best match.
function scentChoice(key, ctx, saved) {
  const picks = wearableScents().map((sc) => ({ sc, s: scentScore(sc, ctx) })).sort((a, b) => b.s - a.s);
  const ui = state.scentUI[key] || {};
  const want = ui.pick !== undefined ? ui.pick : saved;
  const chosen = want === "" ? null : (want && wearableScents().find((x) => x.id === want)) || picks[0]?.sc || null;
  return { picks, chosen, auto: picks[0]?.sc || null, ui };
}
function scentBlock(key, ctx, saved) {
  const { picks, chosen, auto, ui } = scentChoice(key, ctx, saved);
  if (!auto) return "";
  scentShown.set(key, { ctx, auto, chosen });
  const k = esc(key);
  let more = "";
  if (ui.open) {
    const lay = chosen && layering(chosen, ctx);
    more = `<div class="scent-more">
      <div class="chips"><span class="muted small">Or</span>${picks.filter((x) => x.sc !== chosen).slice(0, 4).map(({ sc }) => `<button class="chip" data-scpick="${k}|${sc.id}">${esc(sc.name)}</button>`).join("")}${chosen ? `<button class="chip" data-scpick="${k}|">No scent</button>` : ""}</div>
      ${lay ? `<p class="why"><b>Layering${ctx.event ? "" : " tonight"}:</b> ${esc(lay)}</p>` : ""}
      ${betterHTML(ctx)}
    </div>`;
  }
  return `<div class="scentline">${ICON_BOTTLE}<div class="scent-main">${chosen
    ? `<b>${esc(chosen.name)}</b> <span class="muted">· ${esc(scentWhy(chosen, ctx, picks.map((x) => x.sc).filter((x) => x !== chosen)))}</span>`
    : `<span class="muted">No scent with this one.</span>`}</div><button class="chip" data-scopen="${k}" aria-expanded="${!!ui.open}">${ui.open ? "Less" : chosen ? "Change" : "Pick one"}</button>${more}</div>`;
}
const todayKey = (o) => `t:${o.key}`;
const todaySaved = (o) => (o.planned?.eventId ? state.events.find((e) => e.id === o.planned.eventId)?.outfit?.scentId : undefined);
const todayPieces = allPieces;
const todayScent = (o) => (scentOn() && state.occasion !== "gym" ? scentBlock(todayKey(o), scentContext(todayPieces(o)), todaySaved(o)) : "");
// The same scent for every idea on Today: shown once, on the first card, and a change there applies to all.
function sharedScent() {
  if (!scentOn() || state.occasion === "gym" || state.outfits.length < 2) return false;
  const ids = state.outfits.map((o) => outfitScent(o)?.id ?? "");
  return ids.every((x) => x === ids[0]);
}
// The scent worn with an outfit from Today (logged with it), or null.
function outfitScent(o) {
  if (!scentOn() || state.occasion === "gym") return null;
  return scentChoice(todayKey(o), scentContext(todayPieces(o)), todaySaved(o)).chosen;
}
async function pickScent(key, id) {
  const seen = scentShown.get(key);
  const shared = key.startsWith("t:") && sharedScent();
  (state.scentUI[key] ||= {}).pick = id;
  if (shared) for (const o of state.outfits) (state.scentUI[todayKey(o)] ||= {}).pick = id;
  // Picking another one teaches: more of it for this occasion and weather, a little less of the one suggested.
  if (id && seen) await addLog({ kind: "scent", scentId: id, ...(seen.auto && seen.auto.id !== id && { from: seen.auto.id }), occasion: seen.ctx.occasion, feels: Math.round(seen.ctx.feels), band: seen.ctx.band });
  const ev = key.startsWith("e:") && state.events.find((e) => e.id === key.slice(2));
  if (ev?.outfit) { ev.outfit.scentId = id; await saveEvent(ev); }
  render();
}

// "Even better": fragrances you don't own for this kind of outfit, asked once and kept 30 days.
const betterKey = (ctx) => [ctx.occasion, ctx.band, ctx.night ? "night" : "day", ctx.style, state.settings.gender].join("|");
const betterCtx = new Map();
const BETTER_SCHEMA = {
  type: "object", additionalProperties: false, required: ["picks"],
  properties: {
    picks: {
      type: "array", description: "3 fragrances",
      items: {
        type: "object", additionalProperties: false, required: ["house", "name", "concentration", "why"],
        properties: {
          house: { type: "string" }, name: { type: "string", description: "Without the house" },
          concentration: { type: "string", enum: [...Object.keys(CONCENTRATIONS), "unknown"] },
          why: { type: "string", description: "Why it suits this kind of outfit and weather, under 16 words" },
        },
      },
    },
  },
};
const scentIdea = (b) => ({
  title: `${b.house} ${b.name}`.trim(), cat: "fragrance", noun: `${b.house} ${b.name}`.trim().toLowerCase(), color: "",
  query: [b.house, b.name, CONCENTRATIONS[b.concentration]].filter(Boolean).join(" "), why: b.why, source: "scent",
  scent: { house: b.house, name: b.name, concentration: b.concentration || "" },
});
function betterHTML(ctx) {
  if (!aiReady()) return "";
  const bk = betterKey(ctx);
  betterCtx.set(bk, ctx);
  const got = state.better[bk];
  if (!got) return `<button class="linkish small" data-scbetter="${esc(bk)}">Even better, not in your cabinet</button>`;
  if (got === "busy") return `<p class="muted small"><span class="spinner inline"></span> Looking for even better ones…</p>`;
  if (got.error) return `<p class="muted small">${esc(got.error)} <button class="linkish small" data-scbetter="${esc(bk)}">Try again</button></p>`;
  const owned = new Set(state.scents.map((sc) => scentNorm(sc.name)));
  const picks = got.picks.filter((b) => !owned.has(scentNorm(b.name))).slice(0, 2);
  if (!picks.length) return `<p class="muted small">Nothing better than your own for this one.</p>`;
  return `<div class="better"><span class="muted small">Even better, not in your cabinet</span>${picks.map((b) => {
    const idea = scentIdea(b);
    return `<div class="better-row"><p><b>${esc(idea.title)}</b> <span class="muted">· ${esc(b.why)}</span></p>${verdictHTML(idea)}</div>`;
  }).join("")}</div>`;
}
async function findBetter(bk) {
  const ctx = betterCtx.get(bk);
  if (!ctx || state.better[bk] === "busy") return;
  state.better[bk] = "busy";
  render();
  try {
    let data = await cacheGet("pair", bk);
    if (!data) {
      const cabinet = state.scents.map((sc) => `${[sc.house, sc.name].filter(Boolean).join(" ")} (${(sc.families || []).map((f) => SCENT_FAMILIES[f]).join(", ") || "?"})`).join("; ");
      const text = await aiGenerate({
        system: "You are a fragrance adviser in a wardrobe app. Suggest real, well-known fragrances that are easy to buy. Reply with JSON only.",
        text: `Kind of outfit: ${occLabel(ctx.occasion)}, ${styleLabel(ctx.style).toLowerCase()} style, ${ctx.night ? "evening" : "daytime"}, ${BAND_WORDS[ctx.band]} (feels about ${Math.round(ctx.feels)}°C${ctx.humid >= HUMID ? ", humid" : ""}). The wearer is ${shopperText()}. Their cabinet: ${cabinet || "empty"}. Suggest 3 fragrances they don't own that would suit this kind of outfit better than anything in the cabinet.`,
        schema: BETTER_SCHEMA,
        maxTokens: 350,
      });
      const r = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim());
      data = {
        picks: (r.picks || []).map((x) => ({
          house: String(x.house || "").trim().slice(0, 40), name: String(x.name || "").trim().slice(0, 60),
          concentration: CONCENTRATIONS[x.concentration] ? x.concentration : "", why: String(x.why || "").trim().slice(0, 140),
        })).filter((x) => x.name).slice(0, 3),
      };
      if (data.picks.length) cachePut("pair", bk, data);
    }
    state.better[bk] = data;
  } catch (e) {
    state.better[bk] = { error: e.message || "Couldn't look just now." };
  }
  render();
}
// A fragrance on Must-Buy.
function scentWantRow(w) {
  const b = { ...w, with: [] };
  const it = state.settings.region === "it";
  const q = encodeURIComponent(w.query || w.title);
  const shops = [["Google Shopping", `https://www.google.com/search?tbm=shop&q=${q}`], ["Notino", `https://www.notino.${it ? "it" : "co.uk"}/search.asp?exps=${q}`], ["Douglas", `https://www.douglas.${it ? "it" : "de"}/search?q=${q}`], ["Sephora", `https://www.sephora.${it ? "it" : "com"}/search?q=${q}`]];
  return `<div class="buy-row">
    <a class="buy-ic art-tile" href="${shops[0][1]}" target="_blank" rel="noopener" aria-label="Search for ${esc(w.title)}"${prodAttr(b)}>${tileInner(b)}</a>
    <div class="buy-body">
      <span class="prio">Fragrance${w.source?.type === "scent" ? " · from an outfit's scent" : ""}</span><h3>${esc(w.title)}</h3>${w.why ? `<p>${esc(w.why)}</p>` : ""}
      <div class="shops">${shops.map(([n, u]) => `<a class="btn" href="${u}" target="_blank" rel="noopener">${esc(n)}</a>`).join("")}<button class="btn primary" data-bought="${w.id}">Bought it</button><button class="btn ghost" data-unwant="${w.id}">Remove</button></div>
    </div>
  </div>`;
}

// Wardrobe > Report: the cabinet by season and time of day.
const SEASON_GAP = { spring: "green or aromatic", summer: "fresh citrus or aquatic", autumn: "woody or spicy", winter: "amber or woody" };
function scentReport() {
  const all = wearableScents();
  const most = [...state.scents].filter((sc) => sc.wearCount).sort((a, b) => b.wearCount - a.wearCount)[0];
  const evening = all.filter((sc) => sc.time !== "day").length, day = all.filter((sc) => sc.time !== "night").length;
  return `<section class="card stack">
    <h2 style="margin:0">Fragrances</h2>
    <div class="scent-seasons">${Object.entries(SEASONS).map(([k, { label }]) => {
      const fit = all.filter((sc) => (sc.seasons?.[k] ?? 1) >= 0.5).sort((a, b) => (b.seasons?.[k] ?? 1) - (a.seasons?.[k] ?? 1));
      return `<div><b>${label}</b>${fit.length ? `<span>${esc(fit.slice(0, 4).map((sc) => sc.name).join(", "))}${fit.length > 4 ? ` +${fit.length - 4}` : ""}</span>` : `<span class="muted">Nothing yet: a ${SEASON_GAP[k]} one would fill it.</span>`}</div>`;
    }).join("")}</div>
    <p class="muted small" style="margin:0">${day} for the day, ${evening} for the evening${most ? ` · worn most: ${esc(most.name)} (${most.wearCount}×)` : ""}${state.scents.some((sc) => sc.fill === "low") ? ` · running low: ${esc(state.scents.filter((sc) => sc.fill === "low").map((sc) => sc.name).join(", "))}` : ""}${state.scents.some((sc) => sc.fill === "empty") ? ` · empty, replace or remove: ${esc(state.scents.filter((sc) => sc.fill === "empty").map((sc) => sc.name).join(", "))}` : ""}.</p>
  </section>`;
}

/* ---------- Settings ---------- */
function renderSettings() {
  const s = state.settings;
  const uncut = state.items.filter((i) => !i.originals?.length).length;
  const unrecognised = state.items.filter((i) => !i.brand && !i.aiChecked).length;
  const noFit = state.items.filter((i) => fitsFor(i).length && !i.fit && i.photos?.length).length;
  const u = state.usage.month === today().slice(0, 7) ? state.usage : { requests: 0, input: 0, output: 0 };
  const toggle = (key, label, hint) => `<button class="toggle" role="switch" aria-checked="${!!s[key]}" data-toggle="${key}"><span class="knob"></span><span class="toggle-text"><b>${label}</b><span class="muted small">${hint}</span></span></button>`;
  const prov = s.aiProvider;
  main.innerHTML = `
    <div class="head"><div><h1>Settings</h1></div></div>
    <div class="stack" style="max-width:760px">
      <section class="card stack">
        <h2 style="margin:0">Weather</h2>
        ${weatherSource()}
        <div class="field"><label for="city-input">City</label>
          <div class="row"><input id="city-input" class="input" style="flex:1;min-width:0" data-input="city" value="${esc(s.city)}" placeholder="e.g. Milano"><button class="btn primary" data-act="city">Find</button></div>
          <div class="chips" id="city-results"></div>
        </div>
        <div class="row"><button class="btn" data-act="geo">Use this device's location</button></div>
        <div class="field"><label>Units</label><div class="chips">${["C", "F"].map((x) => `<button class="chip" aria-pressed="${s.unit === x}" data-unit="${x}">°${x}</button>`).join("")}</div></div>
      </section>
      <section class="card stack">
        <h2 style="margin:0">Calendar</h2>
        <p class="muted small" style="margin:0">Outfit ideas follow your day: a dinner gets a night-out look, a meeting a work one, and an evening event the evening temperature. Paste your calendar's private iCal link; nothing else is needed and no AI is used.</p>
        ${(state.calendar.links || []).map((l, k) => {
          const err = state.cal.errors?.[l.url];
          const n = state.cal.events.filter((e) => e.cal === l.url && e.start < startOfDay(2)).length;
          let host = "";
          try { host = new URL(l.url).hostname.replace(/^www\./, ""); } catch {}
          return `<div class="row cal-link"><span style="flex:1;min-width:0"><b>${esc(state.cal.names?.[l.url] || host || "Calendar")}</b><br><span class="muted small">${err ? `<span style="color:var(--danger)">${esc(err)}</span>` : state.cal.at ? `${n} event${n === 1 ? "" : "s"} today and tomorrow · read ${fmtTime(state.cal.at)}` : "Not read yet"}</span></span><button class="btn ghost danger" data-calrm="${k}">Remove</button></div>`;
        }).join("")}
        <div class="field"><label for="cal-input">${state.calendar.links?.length ? "Add another calendar" : "Calendar link"}</label>
          <div class="row"><input id="cal-input" class="input" style="flex:1;min-width:0" data-input="cal" placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" autocomplete="off"><button class="btn primary" data-act="cal-add">Add</button></div>
        </div>
        <details class="muted small"><summary>Where to find the link</summary>
          <p style="margin:8px 0 0"><b>Google Calendar</b> (on a computer): Settings, pick your calendar on the left, then copy <b>Secret address in iCal format</b>.<br>
          <b>Outlook</b>: Settings, Calendar, Shared calendars, Publish a calendar, then copy the <b>ICS</b> link.<br>
          <b>iPhone (iCloud)</b>: in Calendar, tap ⓘ next to a calendar, turn on Public Calendar and copy the link.<br>
          The link is kept in your wardrobe's database, so every device uses it. Anyone who has it can see your events, so keep it private.</p>
        </details>
        ${state.calendar.links?.length ? `<div class="row"><button class="btn" data-act="cal-refresh">Read calendars again</button></div>` : ""}
      </section>
      <section class="card stack">
        <h2 style="margin:0">Laundry</h2>
        ${toggle("autoWash", "Into the wash after wearing", "T-shirts, shirts, underwear, socks and gym clothes after one wear, the pieces below after a few, with an Undo when you log the outfit. Jackets, coats and shoes never.")}
        ${s.autoWash ? `<div class="field"><label>Wears before the wash <i class="muted">(0: never)</i></label><div class="row wash-after">${Object.keys(WASH_GROUPS).map((g) => `<label class="small">${WASH_LABELS[g]} <input class="input" style="max-width:4.5rem" type="number" inputmode="numeric" min="0" max="30" data-input="wash-${g}" value="${s.washAfter?.[g] ?? WASH_DEFAULTS[g]}"></label>`).join("")}</div></div>` : ""}
        <div class="field"><label>Back from the wash</label><div class="chips">${[[0, "Ask me"], [2, "After 2 days"], [3, "After 3 days"], [4, "After 4 days"]].map(([d, l]) => `<button class="chip" aria-pressed="${(s.washBack || 0) === d}" data-washdays="${d}">${l}</button>`).join("")}</div><span class="muted small">${s.washBack ? `Clothes come back to your wardrobe by themselves ${s.washBack} days after they went in the wash.` : "After two days, Today asks which pieces are clean."}</span></div>
        ${inWash().length ? `<div class="row"><span class="muted small" style="flex:1">${inWash().length} in the wash now.</span><button class="btn" data-act="wash-done">Laundry done: all back</button></div>` : ""}
      </section>
      <section class="card stack">
        <h2 style="margin:0">Photos</h2>
        ${toggle("autoCutout", "Remove backgrounds automatically", "Runs on the tablet, no AI tokens. Downloads a 40 MB model once; offline it uses a quick colour-based cut-out.")}
        ${uncut ? `<div class="row"><button class="btn" data-act="cut-all">Remove background from ${uncut} older piece${uncut > 1 ? "s" : ""}</button></div>` : ""}
      </section>
      <section class="card stack">
        <h2 style="margin:0">AI recognition and stylist</h2>
        <p class="muted small" style="margin:0">Optional. Used to recognise brand and style from a new photo (once per piece) and to answer stylist questions. Daily outfits, cut-outs and style from known brands work without it.</p>
        ${state.previewAI && prov !== "off" ? `<p class="small" style="margin:0;padding:10px 12px;border-radius:12px;background:var(--surface-2)">You're in the Claude preview, which blocks outside websites, so your ${prov === "claude" ? "Claude" : "Gemini"} key can't be used here. Here, recognition and the stylist answer through your Claude account instead (it asks you to allow it the first time). On the tablet the app uses your key.</p>` : ""}
        <div class="chips">${Object.entries(PROVIDERS).map(([k, l]) => `<button class="chip" aria-pressed="${prov === k}" data-provider="${k}">${l}</button>`).join("")}</div>
        ${prov !== "off" && state.serverKeys[prov] ? `
          <p class="small" style="margin:0;padding:10px 12px;border-radius:12px;background:var(--surface-2)">Your ${prov === "claude" ? "Claude" : "Gemini"} key is saved on your server, so it isn't stored on this device and nobody can read it from the app.</p>
          ${(prov === "gemini" ? s.geminiKey : s.apiKey) ? `<div class="row"><button class="btn" data-act="forget-key">Remove the old key from this device</button></div>` : ""}` : ""}
        ${prov === "gemini" ? `${state.serverKeys.gemini ? "" : `
          <div class="field"><label for="gemini-key">Gemini API key</label>
            <div class="row"><input id="gemini-key" class="input" style="flex:1;min-width:0" type="password" data-input="geminikey" value="${esc(s.geminiKey)}" placeholder="AIza…" autocomplete="off"><button class="btn primary" data-act="savegemini">Save</button></div>
            <span class="muted small">Create a free key at aistudio.google.com → Get API key. The Gemini app subscription does not include the API, but AI Studio has a free tier.</span>
          </div>`}
          <div class="field"><label for="gemini-model">Model</label>
            ${state.serverKeys.gemini
              ? `<div class="row"><input id="gemini-model" class="input" style="flex:1;min-width:0" data-input="geminimodel" value="${esc(s.geminiModel)}" list="gemini-models" autocomplete="off"><button class="btn primary" data-act="savemodel">Save</button></div>`
              : `<input id="gemini-model" class="input" data-input="geminimodel" value="${esc(s.geminiModel)}" list="gemini-models" autocomplete="off">`}
            <datalist id="gemini-models"><option value="gemini-flash-latest"></option><option value="gemini-flash-lite-latest"></option><option value="gemini-pro-latest"></option></datalist>
            <span class="muted small">Flash is fast and cheap. Flash-Lite uses the fewest tokens. Pro gives the best styling answers.</span>
          </div>` : ""}
        ${prov === "claude" && !state.serverKeys.claude ? `
          <div class="field"><label for="apikey-input">Claude API key</label>
            <div class="row"><input id="apikey-input" class="input" style="flex:1;min-width:0" type="password" data-input="apikey" value="${esc(s.apiKey)}" placeholder="sk-ant-…" autocomplete="off"><button class="btn primary" data-act="savekey">Save</button></div>
            <span class="muted small">From console.anthropic.com. Stored only on this device.</span>
          </div>` : ""}
        ${prov !== "off" ? toggle("aiAuto", "Recognise new photos automatically", "Fills in type, brand, style and colours, and checks which way is up, right after the cut-out. Roughly 500–1,000 tokens per piece, once.") : ""}
        ${aiReady() && unrecognised ? `<div class="row"><button class="btn" data-act="recognise-all">Recognise ${unrecognised} piece${unrecognised > 1 ? "s" : ""} without a brand</button></div>` : ""}
        ${aiReady() && unlooked().length ? `<div class="row"><button class="btn" data-act="look-all">Let the AI look at ${unlooked().length} photo${unlooked().length > 1 ? "s" : ""}</button><span class="muted small">Once per piece, about 350 tokens each: how dressy it really looks, fabric, pattern, detail colours and suits. Outfit ideas then use it offline.</span></div>` : ""}
        ${aiReady() && noFit ? `<div class="row"><button class="btn" data-act="fit-all">Find the fit of ${noFit} piece${noFit > 1 ? "s" : ""}</button><span class="muted small">About 300 tokens per piece. You can also tap the fit on any piece.</span></div>` : ""}
        <p class="muted small" style="margin:0">This month: ${u.requests} AI request${u.requests === 1 ? "" : "s"} · ${(u.input + u.output).toLocaleString()} tokens (${u.input.toLocaleString()} in, ${u.output.toLocaleString()} out)</p>
      </section>
      ${tryonCard()}
      <section class="card stack">
        <h2 style="margin:0">Fashion bible</h2>
        ${(() => {
          const b = Style.bible();
          if (!b) return `<p class="muted small" style="margin:0">Not loaded yet, so outfit ideas use the app's basic rules. It downloads by itself when the app is online.</p>`;
          const n = b.model.trained_on.sources, acc = b.model.accuracy?.unseen;
          return `<p class="muted small" style="margin:0">The stylist must follow the fashion bible: ${b.rules.length} checked rules and ${b.tips.length} tips${n ? ` learnt from ${n} magazine, article and video sources` : ""}${acc != null ? `, right on ${Math.round(acc * 100)}% of example outfits it hadn't seen` : ""}. Outfit ideas that break an important rule only appear when nothing else is left, and every question to the AI stylist carries the rules and the tips that fit it. Updated ${esc(String(b.built_at).slice(0, 10))}.</p>`;
        })()}
      </section>
      ${tasteCard()}
      <section class="card stack">
        <h2 style="margin:0">Look</h2>
        <div class="chips">${[["auto", "Match system"], ["dark", "Dark"], ["light", "Light"]].map(([k, l]) => `<button class="chip" aria-pressed="${s.theme === k}" data-theme="${k}">${l}</button>`).join("")}</div>
        <div class="field"><label>Shops</label><div class="chips">${[["it", "Italy"], ["com", "International"]].map(([k, l]) => `<button class="chip" aria-pressed="${s.region === k}" data-region="${k}">${l}</button>`).join("")}</div></div>
        <div class="field"><label>Shop for</label><div class="chips">${[["men", "Men"], ["women", "Women"]].map(([k, l]) => `<button class="chip" aria-pressed="${s.gender === k}" data-gender="${k}">${l}</button>`).join("")}</div><span class="muted small">Shopping ideas, shop links, product photos and new looks are for ${s.gender === "women" ? "women" : "men"}.</span></div>
        <div class="field"><label for="age">Age</label><input id="age" class="input" style="max-width:7rem" type="number" inputmode="numeric" min="12" max="99" placeholder="e.g. 25" data-input="age" value="${s.age || ""}"><span id="age-hint" class="muted small">${ageHint()}</span></div>
        ${toggle("touches", "Finishing touches", "One line on today's best outfit when an accessory you don't own (a belt, a watch…) would finish it.")}
        ${toggle("scents", "A scent for each outfit", "A fragrance from your cabinet on each outfit idea and event plan, picked for the weather and the occasion. Logged with the outfit when you wear it.")}
        <div class="field"><label>Product photos</label><span class="muted small">${productsOn()
          ? "On: Discover shows real products from Google Shopping, and Add can find a piece with Google Lens and the shop's photos of a label through Google Images (all through SerpApi, saved on your server). Shopping and image searches are kept for two weeks, so the free 250 searches a month go a long way."
          : state.serverKeys.products ? `Paused: ${esc(productsDown)} Discover shows drawings until it works again.`
          : "Off: Discover shows drawings, and Google Lens in Add is off. For real product photos and Google Lens, sign up for free at serpapi.com, copy your API key and add it to the Worker as the SERPAPI_KEY secret: Cloudflare > Workers & Pages > smart-wardrobe > Settings > Variables and Secrets > Add, type Secret (see the README, “Product photos”)."}</span></div>
      </section>
      <section class="card stack">
        <h2 style="margin:0">Data</h2>
        <div class="row">
          <button class="btn" data-act="seed">Load sample wardrobe</button>
          <button class="btn" data-act="export">Export backup</button>
          <button class="btn" data-act="import">Import backup</button>
          <button class="btn ghost danger" data-act="wipe">Erase everything</button>
        </div>
        <p class="muted small" style="margin:0">${syncLine()}</p>
      </section>
    </div>`;
}

// Settings: what outfit ideas have learnt from your wears, stars and dislikes.
const traitLabel = (k) => {
  const [kind, v] = [k.slice(0, k.indexOf(":")), k.slice(k.indexOf(":") + 1)];
  return { colour: () => `${cap(v)} pieces`, type: () => catLabel(v), fit: () => `${FITS[v]?.label || cap(v)} fit`, style: () => styleLabel(v) }[kind]?.() || v;
};
function tasteCard() {
  const t = taste();
  // Only what at least two rated pieces have in common
  const traits = Object.entries(t.traits).filter(([k]) => t.traitN[k] >= 2).sort((a, b) => b[1] - a[1]);
  const high = traits.filter(([, v]) => v >= 0.4).slice(0, 5).map(([k]) => traitLabel(k));
  const low = traits.filter(([, v]) => v <= -0.4).reverse().slice(0, 5).map(([k]) => traitLabel(k));
  const disliked = state.items.filter((i) => i.disliked);
  return `<section class="card stack">
    <h2 style="margin:0">Your taste</h2>
    <p class="muted small" style="margin:0">${esc(tasteLine())} It all stays in your wardrobe's data: no AI tokens. Outfit ideas still follow the fashion bible first.</p>
    ${high.length ? `<div class="field"><label>You rate highly</label><div class="chips">${high.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div></div>` : ""}
    ${low.length ? `<div class="field"><label>Less keen on</label><div class="chips">${low.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}</div></div>` : ""}
    ${disliked.length ? `<div class="field"><label>Disliked: left out of ideas</label><div class="pieces mini">${disliked.map(pieceTile).join("")}</div></div>` : ""}
    ${state.log.some((l) => logKind(l) !== "wear") ? `<div class="row"><button class="btn" data-act="forget-taste">Forget outfit ratings, likes and skips</button></div>` : ""}
  </section>`;
}

/* ======================================================================
   Actions
   ====================================================================== */
async function loadSeed() {
  const seed = window.WARDROBE_SEED || [];
  if (!seed.length) return toast("No sample data found");
  toast("Loading sample wardrobe…");
  const get = async (u) => { try { const r = await fetch(u); return r.ok ? await r.blob() : null; } catch { return null; } };
  let added = 0, updated = 0;
  for (const [n, s] of seed.entries()) {
    const key = s.photos[0];
    const existing = state.items.find((i) => i.seedKey === key || i.seedKey === `${key}.jpg`); // v1 keys kept the extension
    if (existing && (existing.seedVersion || 1) >= SEED_VERSION) continue;
    const originals = (await Promise.all(s.photos.map((p) => get(`sample/${p}.jpg`)))).filter(Boolean);
    const cuts = (await Promise.all(s.photos.map((p) => get(`sample/cut/${p}.webp`)))).filter(Boolean);
    if (!originals.length) return toast("Open the app through a web server to load samples");
    const useCuts = cuts.length === originals.length;
    const fields = {
      seedVersion: SEED_VERSION, styles: s.styles, formality: formalityOf(s.styles),
      ...(useCuts ? { photos: cuts, originals } : { photos: originals }),
    };
    if (existing) {
      // Upgrade an earlier sample piece to the new (cut-out, upright) photos. Wear history,
      // favourites and edits stay; styles are only filled in if the piece had none (version 1).
      const keepStyles = (existing.seedVersion || 1) >= 2 ? { styles: existing.styles, formality: existing.formality } : {};
      Object.assign(existing, fields, keepStyles, { seedKey: key });
      if (!existing.brand && s.brand) existing.brand = s.brand;
      await store.put("items", existing);
      updated++;
      continue;
    }
    const item = {
      id: `seed-${key}`, seedKey: key, createdAt: new Date(Date.now() - n * 1000).toISOString(),
      name: s.name, category: s.category, colors: s.colors, brand: s.brand, warmth: s.warmth,
      tags: s.tags, notes: "", wearCount: 0, lastWorn: null, favorite: false, ...fields,
    };
    await store.put("items", item);
    state.items.push(item);
    added++;
  }
  state.outfits = [];
  await store.put("kv", true, "seeded");
  await store.put("kv", SEED_VERSION, "seedVersion");
  toast(added || updated ? [added && `Added ${added} pieces`, updated && `updated ${updated}`].filter(Boolean).join(", ") : "Sample wardrobe already loaded");
  render();
}

async function cutAll() {
  const todo = state.items.filter((i) => !i.originals?.length);
  let done = 0;
  for (const it of todo) {
    toast(`Removing backgrounds… ${done + 1} of ${todo.length}`);
    try {
      const cuts = [], originals = [], geos = [];
      for (const p of it.photos) {
        const r = await removeBackground(p);
        const rot = await uprightAngle(r.blob, kindOf(it.category));
        const c = await makeCut(r.raw, rot);
        cuts.push(c.blob);
        geos.push(geoList(c.geo));
        originals.push(await rotateImage(p, rot, false));
      }
      it.originals = originals;
      it.photos = cuts;
      it.cutGeo = geos;
      await store.put("items", it);
      done++;
    } catch { /* keep the original photo */ }
  }
  state.outfits = [];
  toast(`Updated ${done} of ${todo.length} pieces`);
  render();
}
async function recogniseAll() {
  const todo = state.items.filter((i) => !i.brand && !i.aiChecked);
  let found = 0;
  for (const [k, it] of todo.entries()) {
    toast(`Recognising… ${k + 1} of ${todo.length}`);
    try {
      const r = await aiTagPhoto(it.photos[0], it.photos[1]);
      if (r.brand) { it.brand = r.brand; found++; }
      for (const [k, side] of [[0, r.front_top], [1, r.back_top]]) {
        if (!it.photos[k] || !TURN_FOR[side]) continue;
        it.photos[k] = await rotateImage(it.photos[k], TURN_FOR[side], !!it.originals);
        if (it.originals?.[k]) it.originals[k] = await rotateImage(it.originals[k], TURN_FOR[side], false);
        if (it.cutGeo?.[k]) it.cutGeo[k] = null; // the hand editor cuts this one again from the original
      }
      const st = (r.styles || []).filter((s) => STYLES[s]);
      if (st.length) { it.styles = st.slice(0, 3); it.formality = formalityOf(it.styles); }
      if (!it.fit && fitsFor(it).includes(r.fit)) it.fit = r.fit;
      applyLook(it, lookFrom(r));
      it.aiChecked = true; // never pay for the same photo twice
      await store.put("items", it);
    } catch (e) { toast(e.message || "Recognition failed"); break; }
  }
  state.outfits = [];
  toast(`Found ${found} brand${found === 1 ? "" : "s"}; styles updated`);
  render();
  lookupWardrobeBrands();
}

// Fit for pieces saved before the app knew about fit: one small AI request per piece.
async function fitAll() {
  const todo = state.items.filter((i) => fitsFor(i).length && !i.fit && i.photos?.length);
  let found = 0;
  for (const [k, it] of todo.entries()) {
    toast(`Checking the fit… ${k + 1} of ${todo.length}`);
    try {
      const text = await aiGenerate({
        system: "You describe how clothes fit for a wardrobe app. Reply with JSON only.",
        text: `How does this ${catLabel(it.category).toLowerCase()} fit on the body?${it.photos[1] ? " Left: front. Right: back." : ""}`,
        image: await aiImage(it.photos[0], it.photos[1]),
        schema: { type: "object", additionalProperties: false, required: ["fit"], properties: { fit: { type: "string", enum: fitsFor(it) } } },
        maxTokens: 30,
      });
      const fit = JSON.parse(text.replace(/^```(json)?|```$/g, "").trim()).fit;
      if (fitsFor(it).includes(fit)) { it.fit = fit; found++; await store.put("items", it); }
    } catch (e) { toast(e.message || "Couldn't check the fit"); break; }
  }
  state.outfits = [];
  toast(`Set the fit of ${found} piece${found === 1 ? "" : "s"}`);
  render();
}

async function exportBackup() {
  const items = [];
  for (const i of state.items) items.push({
    ...i,
    photos: await Promise.all((i.photos || []).map(blobToDataURL)),
    originals: i.originals ? await Promise.all(i.originals.map(blobToDataURL)) : undefined,
  });
  const scents = [];
  for (const sc of state.scents) scents.push({ ...sc, photos: await Promise.all((sc.photos || []).map(blobToDataURL)) });
  const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), items, scents, log: state.log, wants: state.wants, events: state.events, calendar: state.calendar })], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: `wardrobe-backup-${today()}.json` });
  a.click();
}
const seedBase = (k) => String(k || "").replace(/\.jpg$/, ""); // v1 sample keys kept the extension

// Two copies of the same sample piece (a backup imported before this was handled, or two
// devices that loaded the samples on their own): keep the copy that came with the backup,
// move its wear history over, and remove the other copy on every device.
async function dropDuplicateSamples() {
  const groups = new Map();
  for (const i of state.items) {
    if (!i.seedKey) continue;
    const k = seedBase(i.seedKey);
    groups.set(k, [...(groups.get(k) || []), i]);
  }
  const removed = new Set();
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    // The same choice on every device: the backup's copy (lowest id), else the lowest id.
    const byId = [...group].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    const keep = byId.find((i) => !String(i.id).startsWith("seed-")) || byId[0];
    for (const dup of group) {
      if (dup === keep) continue;
      for (const l of state.log) {
        if (!l.itemIds?.includes(dup.id)) continue;
        l.itemIds = [...new Set(l.itemIds.map((x) => (x === dup.id ? keep.id : x)))];
        await store.put("log", l);
      }
      await store.del("items", dup.id);
      removed.add(dup.id);
    }
  }
  if (removed.size) {
    state.items = state.items.filter((i) => !removed.has(i.id));
    state.outfits = [];
  }
  return removed.size;
}

async function importBackup() {
  const input = Object.assign(document.createElement("input"), { type: "file", accept: "application/json" });
  input.onchange = async () => {
    try {
      const data = JSON.parse(await input.files[0].text());
      const toBlobs = (arr) => Promise.all((arr || []).map(async (u) => (await fetch(u)).blob()));
      for (const i of data.items || []) {
        i.photos = await toBlobs(i.photos);
        if (i.originals) i.originals = await toBlobs(i.originals);
        // Older versions gave sample pieces random ids: keep the backup's copy, not a second one.
        for (const dup of (await store.all("items")).filter((x) => i.seedKey && seedBase(x.seedKey) === seedBase(i.seedKey) && x.id !== i.id)) {
          await store.del("items", dup.id);
        }
        await store.put("items", i);
      }
      for (const sc of data.scents || []) if (sc?.id) { sc.photos = await toBlobs(sc.photos); await store.put("scents", sc); }
      // Wear-log entries keep their ids (ratings point at them, so answered rating cards don't come
      // back); one whose id is taken here by a different entry gets a new id.
      const logs = new Map((await store.all("log")).map((l) => [l.id, l]));
      for (const l of data.log || []) {
        const here = l.id != null && logs.get(l.id);
        if (here && here.at !== l.at) delete l.id;
        await store.put("log", l);
      }
      if (data.wishlist?.length) { state.wishlist = data.wishlist; await moveWishlist(); }
      for (const w of data.wants || []) if (w?.id && !state.wants.some((x) => x.id === w.id)) { state.wants.push(w); await store.put("wants", w); }
      for (const e of data.events || []) if (e?.id && !state.events.some((x) => x.id === e.id)) { state.events.push(e); await store.put("events", e); }
      if (data.calendar?.links) { state.calendar = data.calendar; await saveCalendar(); state.cal.at = 0; }
      await loadAll();
      state.outfits = [];
      toast(`Imported ${data.items?.length || 0} pieces${data.scents?.length ? ` and ${data.scents.length} fragrances` : ""}`);
      render();
    } catch { toast("That file couldn't be imported"); }
  };
  input.click();
}

// What each outfit in a stylist answer still breaks of the fashion bible's important rules.
// Judged without the occasion or weather, which the question may not be about.
function answerBreaks(ans) {
  if (!Style.ready()) return [];
  return parseAnswer(ans).looks.map((l) => (l.items.length >= 2 ? Style.judge(l.items, {}).violations.map(ruleLine) : []));
}

async function ask(question, targetId = "ai-answer") {
  const out = document.getElementById(targetId);
  if (!question?.trim()) return;
  if (out) out.innerHTML = `<div class="row"><div class="spinner"></div><span class="muted">Thinking about your wardrobe…</span></div>`;
  try {
    const c = conditions();
    const likes = tasteText();
    const cal = calendarText();
    const context = `The user is ${shopperText()}.${ageNow()}\n${state.event?.day === "tomorrow" ? "Tomorrow" : "Today"}: feels ${Math.round(c.feels)}°C${c.wet ? ", wet" : ""}. Occasion: ${OCCASIONS.find((o) => o.id === state.occasion).label}.${cal ? `\n${cal}` : ""}\nWardrobe (#number name; type; colours; brand; style; fit; warmth 1-5; wear):\n${wardrobeText({ gym: state.occasion === "gym" || /\b(gym|run|running|train|training|workout|sport)\b/i.test(question) }) || "(empty)"}${likes ? `\nTaste (learnt from what the user wears, likes and skips):\n${likes}` : ""}`;
    const refs = state.items.map((i) => i.id);
    const show = (t) => { const el = document.getElementById(targetId); if (el) el.textContent = cleanRefs(t, refs); };
    // The fashion bible: its mandatory rules and the tips that fit this question.
    const weather = [c.feels < 8 ? "cold winter layers coat" : c.feels >= 24 ? "hot summer light" : "", c.wet ? "rain" : ""].join(" ");
    const occ = OCCASIONS.find((o) => o.id === state.occasion);
    const guide = Style.guideText({ question, occasion: occ.id, extra: `${occ.label} ${occ.likes.join(" ")} ${weather}` });
    const system = `${STYLIST_SYSTEM}${guide ? "" : ` ${BASIC_RULES}`}\n\n${guide ? guide + "\n\n" : ""}${context}`;
    const answer = { text: await aiGenerate({ system, text: question, maxTokens: 800, onText: show }), refs };
    // Check the outfits against the rules; if one breaks an important rule, ask once for a fixed answer.
    let broken = answerBreaks(answer);
    if (broken.some((b) => b.length)) {
      const el = document.getElementById(targetId);
      if (el) el.innerHTML = `<div class="row"><div class="spinner"></div><span class="muted">Checking the outfits against the style guide…</span></div>`;
      const { looks } = parseAnswer(answer);
      const fix = broken.map((b, i) => (b.length ? `- ${looks[i].title}: ${b.join("; ")}` : "")).filter(Boolean).join("\n");
      const retry = { text: await aiGenerate({ system, text: `${question}\n\nYour first answer:\n${answer.text}\n\nIt breaks the style guide:\n${fix}\nWrite the whole answer again in the same format, changing only what is needed to follow the guide.`, maxTokens: 800, onText: show }), refs };
      const again = answerBreaks(retry);
      if (again.flat().length <= broken.flat().length) { answer.text = retry.text; broken = again; }
    }
    if (broken.some((b) => b.length)) answer.warn = broken;
    if (targetId === "ai-answer") state.aiAnswer = answer;
    if (targetId === "try-ai") state.disc.try.answer = answer;
    const el = document.getElementById(targetId);
    if (el) el.innerHTML = answerHTML(answer);
    watchTiles();
  } catch (e) {
    const el = document.getElementById(targetId);
    if (el) el.textContent = e.message || "Something went wrong talking to the AI.";
  }
}

document.addEventListener("click", async (e) => {
  const t = e.target.closest("button, a, [data-close], img[data-photo]");
  if (!t) return;
  const ds = t.dataset;

  if (t.matches("[data-close]")) return closeSheet();
  if (ds.toast) { const run = toastAction; toastAction = null; $("#toast").hidden = true; return run?.(); }
  if (ds.cam === "snap") return snap();
  if (ds.cam === "skip") return finishShooting();
  if (ds.cam === "close") { cam.shots = []; return stopCamera(); }
  if (ds.view) return go(ds.view);
  if (ds.go) { closeSheet(); return go(ds.go); }
  if (ds.item) return openItem(ds.item);
  // Mirror (Today)
  if (ds.mlook != null) { mirror.pick = +ds.mlook; return remountMirror(); }
  if (ds.mpiece) {
    const o = state.outfits[mirror.pick];
    if (!o) return;
    const off = mirrorOff(o);
    mirror.off[o.key] = off.includes(ds.mpiece) ? off.filter((r) => r !== ds.mpiece) : [...off, ds.mpiece];
    return remountMirror();
  }
  if (ds.mb) {
    const b = bodyDraft(), v = ds.v;
    b[ds.mb] = ds.mb === "glasses" ? v === "yes" : /^\d+$/.test(v) ? +v : v;
    document.querySelectorAll(`[data-mb="${ds.mb}"]`).forEach((x) => x.setAttribute("aria-pressed", x === t));
    return bodyUI();
  }
  if (ds.mbtab) { mirror.bodyTab = ds.mbtab; return remountBody(); }
  if (ds.tta != null) { mirror.angle = +ds.tta; paintMirror(); return mirrorRefresh(true); }
  if (ds.tt) { mirror.angle = (mirror.angle + +ds.tt + 4) % 4; paintMirror(); return mirrorRefresh(true); }
  // Fragrances
  if (ds.side) { state.wardSide = ds.side; render(); main.scrollTop = 0; return; }
  if (ds.scf) { state.scentFilter = ds.scf; return render(); }
  if (ds.scent) return openScent(ds.scent);
  if (scentDraft && view === "add" && scentChip(scentDraft, ds)) return;
  if (ds.scopen) { const u = (state.scentUI[ds.scopen] ||= {}); u.open = !u.open; return render(); }
  if (ds.scpick != null) { const at = ds.scpick.lastIndexOf("|"); return pickScent(ds.scpick.slice(0, at), ds.scpick.slice(at + 1)); }
  if (ds.scbetter) return findBetter(ds.scbetter);
  {
    const sc = state.scents.find((x) => x.id === (ds.scfill || ds.scwear || ds.scdislike || ds.scedit || ds.scdel || "").split("|")[0]);
    if (sc && ds.scfill) { sc.fill = ds.scfill.split("|")[1]; await store.put("scents", sc); openScent(sc.id); return render(); }
    if (sc && ds.scwear) { await wearScent(sc); openScent(sc.id); return render(); }
    if (sc && ds.scdislike) {
      if (sc.disliked) delete sc.disliked; else sc.disliked = true;
      await store.put("scents", sc);
      openScent(sc.id);
      return render();
    }
    if (sc && ds.scedit) return editScent(sc);
    if (sc && ds.scdel) {
      if (!(await confirmBox(`Delete “${sc.name}” from your cabinet?`, "Delete"))) return openScent(sc.id);
      await store.del("scents", sc.id);
      state.scents = state.scents.filter((x) => x !== sc);
      toast("Deleted");
      return render();
    }
  }
  if (ds.orig) return openItem(ds.orig, ds.show === "1");
  if (ds.occ) { state.occasion = ds.occ; state.occChosen = localDay(); state.event = null; state.level = null; generateOutfits(); return render(); }
  if (ds.level != null) { state.level = +ds.level || null; generateOutfits(); return render(); }
  if (ds.needgo) { state.disc.tab = "foryou"; askNeed("", ds.needgo); return go("shop"); }
  if (ds.event) { pickEvent(ds.event); return render(); }
  if (ds.evocc) { state.editingEvent = state.editingEvent === ds.evocc ? null : ds.evocc; return render(); }
  if (ds.setevocc) {
    const at = ds.setevocc.lastIndexOf("|");
    await setEventOcc(ds.setevocc.slice(0, at), ds.setevocc.slice(at + 1));
    return render();
  }
  if (ds.calrm != null) {
    const l = state.calendar.links[+ds.calrm];
    if (!l || !(await confirmBox("Remove this calendar? Outfit ideas stop following its events.", "Remove"))) return render();
    state.calendar.links = state.calendar.links.filter((x) => x !== l);
    await saveCalendar();
    await loadCalendar(true);
    if (state.event && state.event.cal === l.url) state.event = null;
    state.outfits = [];
    return render();
  }
  if (ds.washback) {
    const it = state.items.find((i) => i.id === ds.washback);
    if (!it) return;
    await setWash([it], false);
    toast(`${it.name} is back`, { label: "Undo", run: async () => { await setWash([it], true); refreshViews(); } });
    return render();
  }
  if (ds.addbought) {
    const w = state.wants.find((x) => x.id === ds.addbought);
    if (!w) return;
    state.buying = w.id;
    toast(`Take its photos: the type${w.color ? " and colour" : ""} ${w.color ? "are" : "is"} filled in.`);
    return go("add");
  }
  if (ds.boughtlater || ds.boughtback) {
    const w = state.wants.find((x) => x.id === (ds.boughtlater || ds.boughtback));
    if (!w) return;
    if (ds.boughtlater) w.askAfter = new Date(Date.now() + 3 * 864e5).toISOString();
    else Object.assign(w, { status: "returned", decidedAt: new Date().toISOString() });
    await store.put("wants", w);
    if (ds.boughtback) toast(`Noted: you sent the ${w.title.toLowerCase()} back`);
    return render();
  }
  if (ds.washdays != null) { state.settings.washBack = +ds.washdays; await saveSettings(); return render(); }
  if (ds.wash) {
    const it = state.items.find((i) => i.id === ds.wash);
    await setWash([it], !it.wash);
    toast(it.wash ? `${it.name} is in the wash` : `${it.name} is back`);
    openItem(it.id);
    return render();
  }
  if (ds.plan != null) {
    await planOutfit(state.outfits[+ds.plan]);
    toast("Planned. It'll be first on Today tomorrow morning.");
    return render();
  }
  if (ds.slot) { state.filters.slot = ds.slot; state.filters.cat = "all"; return render(); }
  if (ds.catf) { state.filters.cat = ds.catf; return render(); }
  if (ds.color) { state.filters.color = ds.color; return render(); }
  if (ds.style) { state.filters.style = ds.style; return render(); }
  if (ds.stylego) { Object.assign(state.filters, { style: ds.stylego, slot: "all", color: "all", q: "" }); return go("wardrobe"); }
  if (ds.brandmerge) {
    const [from, to] = ds.brandmerge.split("|");
    const moved = state.items.filter((i) => i.brand && brandKey(i.brand) === brandKey(from));
    for (const i of moved) { i.brand = to; await store.put("items", i); }
    toast(`${moved.length} piece${moved.length === 1 ? "" : "s"} now say ${to}`);
    return render();
  }
  if (ds.brandapart) {
    const [a, b] = ds.brandapart.split("|");
    state.settings.brandsApart = [...(state.settings.brandsApart || []), `${brandKey(a)}|${brandKey(b)}`];
    await saveSettings();
    return render();
  }
  if (ds.brandgo) { Object.assign(state.filters, { q: ds.brandgo, style: "all", slot: "all", color: "all" }); return go("wardrobe"); }
  if (ds.sort) { state.filters.sort = ds.sort; return render(); }
  if (ds.cat && draft) {
    const prev = CAT[draft.category];
    draft.category = ds.cat;
    if (!prev || draft.warmth == prev.warmth) draft.warmth = CAT[ds.cat].warmth;
    if (!fitsFor(draft).includes(draft.fit)) draft.fit = "";
    refreshStyles();
    render();
    return reorient(draft);
  }
  if (ds.fit && draft) { draft.fit = draft.fit === ds.fit ? "" : ds.fit; return render(); }
  if (ds.sty && draft) {
    const i = draft.styles.indexOf(ds.sty);
    if (i === -1) draft.styles.push(ds.sty); else draft.styles.splice(i, 1);
    draft.stylesTouched = true;
    return render();
  }
  if (ds.col && draft) {
    const i = draft.colors.indexOf(ds.col);
    if (i === -1) draft.colors.push(ds.col); else draft.colors.splice(i, 1);
    return render();
  }
  if (ds.cutview && draft) { draft.photos[draft.active].useCut = ds.cutview === "1"; return render(); }
  if (ds.photo && draft) { draft.active = +ds.photo; return render(); }
  if (ds.lens != null && draft) return pickLens(draft, +ds.lens);
  if (ds.rmphoto && draft) {
    draft.photos.splice(+ds.rmphoto, 1);
    draft.active = 0;
    if (!draft.photos.length && !draft.id) draft = null;
    return render();
  }
  if (ds.toggle) { state.settings[ds.toggle] = !state.settings[ds.toggle]; await saveSettings(); return render(); }
  if (ds.provider) { state.settings.aiProvider = ds.provider; await saveSettings(); return render(); }
  if (ds.rate != null) { const o = state.outfits[+ds.rate]; o.rating = !o.rating; return render(); }
  if (ds.stars) return rate(...ds.stars.split("|"));
  if (ds.dislike) {
    const it = state.items.find((i) => i.id === ds.dislike);
    if (it.disliked) delete it.disliked; else it.disliked = true;
    await store.put("items", it);
    tasteMemo = null;
    state.outfits = [];
    toast(it.disliked ? "Left out of outfit ideas" : "Back in outfit ideas");
    openItem(it.id);
    return render();
  }
  if (ds.likeids) {
    if (t.getAttribute("aria-pressed") === "true") return;
    await addLog({ kind: "like", itemIds: ds.likeids.split(","), ...outfitContext(), source: "stylist" });
    t.setAttribute("aria-pressed", "true");
    return toast("Liked. Outfit ideas will lean this way.");
  }
  if (ds.anchor) return setAnchor(ds.anchor);
  if (ds.swap) {
    const [i, role] = ds.swap.split(":");
    const o = state.outfits[+i];
    o.swapping = o.swapping === role ? null : role;
    o.swapCat = "all";
    return render();
  }
  if (ds.swapcat) {
    const [i, c] = ds.swapcat.split(":");
    state.outfits[+i].swapCat = c;
    return render();
  }
  if (ds.swapto != null) {
    const [i, role, id] = ds.swapto.split(":");
    await swapPiece(+i, role, id);
    return render();
  }
  if (ds.skip != null) { state.outfits[+ds.skip].asking = !ds.cancel; return render(); }
  if (ds.skipwhy) {
    const [i, reason] = ds.skipwhy.split(":");
    const o = state.outfits[+i];
    await addLog({ kind: "skip", reason, itemIds: Object.values(o.pieces).filter(Boolean).map((p) => p.id), ...outfitContext() });
    if (o.planned) { state.plan = null; await savePlan(); }
    replaceOutfit(+i);
    toast(reason === "today" ? "Okay, here's another idea" : "Got it. Here's another idea");
    return render();
  }
  if (ds.wear != null) {
    const o = state.outfits[+ds.wear];
    const sc = outfitScent(o);
    const washed = await wearOutfit(ds.mirror ? mirrorWorn(o) : allPieces(o), { source: o.planned ? "plan" : "idea", ...(sc && { scentIds: [sc.id] }) });
    if (sc) await countScentWear(sc);
    if (o.planned) { state.plan = null; await savePlan(); }
    state.anchor = null;
    wornToast(sc ? `Logged with ${sc.name}. Enjoy your day!` : "Logged. Enjoy your day!", washed);
    generateOutfits();
    return render();
  }
  if (ds.wearids) {
    const items = ds.wearids.split(",").map((id) => state.items.find((i) => i.id === id)).filter(Boolean);
    wornToast("Logged. Enjoy your day!", await wearOutfit(items, { source: "stylist" }));
    state.outfits = [];
    return render();
  }
  if (ds.wearItem) {
    const it = state.items.find((i) => i.id === ds.wearItem);
    wornToast(`Logged ${it.name}.`, await wearOutfit([it]));
    state.outfits = [];
    return openItem(it.id);
  }
  if (ds.suit) {
    const [a, b] = ds.suit.split(":").map((id) => state.items.find((i) => i.id === id));
    if (a && b) { await linkSuit(a, b); toast(`The ${a.name} and the ${b.name} are now one suit`); }
    state.outfits = [];
    openItem(a.id);
    return render();
  }
  if (ds.notsuit) {
    const [a, b] = ds.notsuit.split(":").map((id) => state.items.find((i) => i.id === id));
    if (!a || !b) return;
    a.notSuit = [...new Set([...(a.notSuit || []), b.id])];
    await store.put("items", a);
    toast(`The ${a.name} and the ${b.name} won't count as a suit`);
    state.outfits = [];
    openItem(a.id);
    return render();
  }
  if (ds.unsuit) {
    const it = state.items.find((i) => i.id === ds.unsuit);
    await unlinkSuit(it);
    state.outfits = [];
    openItem(it.id);
    return render();
  }
  if (ds.lookat) {
    const it = state.items.find((i) => i.id === ds.lookat);
    t.disabled = true;
    t.textContent = "Looking…";
    try { await lookAt(it); await autoLinkSuits(); } catch (e) { toast(e.message || "Couldn't look at the photo"); }
    state.outfits = [];
    tasteMemo = null;
    openItem(it.id);
    return render();
  }
  if (ds.setfit) {
    const [id, fit] = ds.setfit.split(":");
    const it = state.items.find((i) => i.id === id);
    it.fit = it.fit === fit ? "" : fit;
    await store.put("items", it);
    state.outfits = [];
    openItem(it.id);
    return render();
  }
  if (ds.edit) {
    const it = state.items.find((i) => i.id === ds.edit);
    draft = {
      ...newDraft(), ...it,
      photos: (it.photos || []).map((p, k) => (it.originals?.[k]
        ? { ...newPhoto(it.originals[k]), cutSrc: p, cut: p, useCut: true, manual: true, geo: it.cutGeo?.[k] ? new DOMMatrix(it.cutGeo[k]) : null }
        : { ...newPhoto(p), manual: true })),
      active: 0, tags: (it.tags || []).join(", "), colors: [...(it.colors || [])], styles: [...(it.styles || [])], stylesTouched: true,
      notes: it.notes || "", brand: it.brand || "", fit: it.fit || "",
    };
    queue = [];
    pendingShots = [];
    closeSheet();
    return go("add");
  }
  if (ds.del) {
    const it = state.items.find((i) => i.id === ds.del);
    if (!(await confirmBox(`Delete “${it.name}” from your wardrobe?`, "Delete"))) return openItem(it.id);
    await store.del("items", it.id);
    state.items = state.items.filter((i) => i.id !== it.id);
    state.outfits = [];
    toast("Deleted");
    return render();
  }
  if (ds.pair) {
    const it = state.items.find((i) => i.id === ds.pair);
    const out = $("#pair-answer");
    const matches = pairingsFor(it);
    out.innerHTML = matches.length
      ? `<h2>Goes well with</h2><div class="grid">${matches.map(itemTile).join("")}</div>`
      : `<p class="muted">Add pieces from other categories (bottoms, shoes, jackets) to see pairings.</p>`;
    if (aiReady()) {
      out.insertAdjacentHTML("beforeend", `<div id="pair-ai" class="ai-answer" style="margin-top:14px"></div>`);
      ask(`3 outfit ideas built around my "${it.name}", using pieces I own.`, "pair-ai");
    }
    return;
  }
  // Discover
  if (ds.disc) {
    state.disc.tab = ds.disc;
    if (["try", "trip", "look"].includes(ds.disc)) state.disc.explore = ds.disc;
    if (view !== "shop") return go("shop");
    render(); main.scrollTop = 0; return;
  }
  if (ds.pick) { const at = ds.pick.lastIndexOf(":"); state.disc.pick[ds.pick.slice(0, at)] = +ds.pick.slice(at + 1); return render(); }
  if (ds.real) return realPhotos(JSON.parse(ds.real));
  {
    const tr = state.disc.try;
    const toggle = (k, v) => { tr[k] = tr[k] === v ? "" : v; if (k === "cat" && !fitsFor({ category: tr.cat }).includes(tr.fit)) tr.fit = ""; return tr.shown ? tryIt() : render(); };
    if (ds.trycat) return toggle("cat", ds.trycat);
    if (ds.trycolor) return toggle("color", ds.trycolor);
    if (ds.tryfit) return toggle("fit", ds.tryfit);
    if (ds.trystyle) return toggle("style", ds.trystyle);
    if (ds.trybrand != null) return toggle("brand", ds.trybrand);
    if (ds.tryocc) { tr.occ = ds.tryocc; return render(); }
  }
  if (ds.tripgo) return setTrip(state.trips.find((t) => t.key === ds.tripgo) || null);
  if (ds.lookseason) { state.disc.look.season = ds.lookseason; return render(); }
  if (ds.lookstyle) { state.disc.look.style = ds.lookstyle; return render(); }
  if (ds.lookocc) { state.disc.look.occ = ds.lookocc; return render(); }
  if (ds.yes) {
    const w = await answerWant(JSON.parse(ds.yes), "wanted");
    toast(`${w.title} is on your Must-Buy`, { label: "See it", run: () => { state.disc.tab = "must"; go("shop"); } });
    return render();
  }
  if (ds.no) {
    const w = await answerWant(JSON.parse(ds.no), "rejected");
    if (!ds.quiet) state.whyNo = w.id;
    return render();
  }
  if (ds.whyno) {
    const [id, reason] = ds.whyno.split("|");
    const w = state.wants.find((x) => x.id === id);
    state.whyNo = null;
    if (!w) return render();
    if (reason === "later") Object.assign(w, { status: "snoozed", until: new Date(Date.now() + 30 * 864e5).toISOString() });
    else if (reason) w.reason = reason;
    await store.put("wants", w);
    shopMemo = null;
    toast(reason === "later" ? "Hidden for 30 days" : "Got it. Fewer ideas like this.");
    return render();
  }
  if (ds.unwant) {
    const w = state.wants.find((x) => x.id === ds.unwant);
    if (w) { await store.del("wants", w.id); state.wants = state.wants.filter((x) => x !== w); shopMemo = null; }
    return render();
  }
  if (ds.bought) {
    const w = state.wants.find((x) => x.id === ds.bought);
    if (!w) return render();
    Object.assign(w, { status: "bought", decidedAt: new Date().toISOString() });
    await store.put("wants", w);
    if (w.kind === "fragrance") { // the bottle form starts with its name, and its notes are filled in
      scentDraft = { ...newScentDraft(), name: w.scent?.name || w.title, house: w.scent?.house || "", concentration: w.scent?.concentration || "" };
      go("add");
      return lookupScent(scentDraft);
    }
    state.buying = w.id;
    toast(`Great. Take its photos: the type${w.color ? " and colour" : ""} ${w.color ? "are" : "is"} filled in.`);
    return go("add");
  }
  if (ds.mustf) { state.disc.mustf = ds.mustf; return render(); }
  if (ds.fate || ds.fateclear) {
    const [id, status] = (ds.fate || ds.fateclear).split("|");
    const it = state.items.find((i) => i.id === id);
    if (!it) return;
    if (ds.fate) it.fate = { status, at: new Date().toISOString() };
    else delete it.fate;
    await store.put("items", it);
    state.outfits = [];
    if (ds.fate) toast(status === "keep" ? `Keeping ${it.name}. It won't be flagged for 90 days.` : `${it.name} is left out of outfit ideas until it's gone.`);
    return render();
  }
  if (ds.gone) {
    const it = state.items.find((i) => i.id === ds.gone);
    if (!it || !(await confirmBox(`Remove “${it.name}” from your wardrobe? What you wore with it stays in your history.`, "Remove"))) return;
    await store.del("items", it.id);
    state.items = state.items.filter((i) => i.id !== it.id);
    state.outfits = [];
    toast("Removed");
    return render();
  }
  if (ds.evopen) { state.disc.ev = ds.evopen; state.disc.evOcc = false; render(); main.scrollTop = 0; return; }
  if (ds.evcal) return eventFromCalendar(ds.evcal);
  if (ds.evex) { state.disc.evForm.text = ds.evex; render(); $('[data-input="evdate"]')?.focus(); return; }
  if (ds.evpick) { const [id, k] = ds.evpick.split("|"); state.disc.evPick[id] = +k; return render(); }
  if (ds.evplan) return planEvent(ds.evplan);
  if (ds.evunplan) return planEvent(ds.evunplan, true);
  if (ds.evsetocc) { const [id, occ] = ds.evsetocc.split("|"); return editCode(id, (c) => ({ ...EVENT_CODES[occ], tips: [], occasion: occ })); }
  if (ds.evdrop) { const [id, field, v] = ds.evdrop.split("|"); return editCode(id, (c) => ({ ...c, [field]: c[field].filter((x) => x !== v) })); }
  if (ds.evai) return readCodeFor(ds.evai);
  if (ds.evrm) return removeEvent(ds.evrm);
  if (ds.needchip) return askNeed("", ds.needchip);
  if (ds.ask) return ask(ds.ask);
  if (ds.unit) { state.settings.unit = ds.unit; await saveSettings(); return render(); }
  if (ds.theme) { state.settings.theme = ds.theme; applyTheme(); await saveSettings(); return render(); }
  if (ds.region) { state.settings.region = ds.region; await saveSettings(); return render(); }
  if (ds.gender) { state.settings.gender = ds.gender; await saveSettings(); return render(); }
  if (ds.city) {
    const [lat, lon, name] = JSON.parse(ds.city);
    Object.assign(state.settings, { lat, lon, city: name });
    await saveSettings();
    await loadWeather(true);
    state.outfits = [];
    toast(state.weather?.typical ? `${name} set, using its usual ${MONTH()} temperatures for now` : `Weather set to ${name}`);
    return render();
  }

  switch (ds.act) {
    case "body-save": return saveBody();
    case "body-photo": return bodyPhotoInput.click();
    case "body-photo-off": delete bodyDraft().photo; return remountBody();
    case "tryon-retry": TryOn.resume(); return mirrorRefresh(true);
    case "seed": return loadSeed();
    case "shuffle": {
      // Every outfit shown since the morning (for this occasion, level and temperature) stays out, so
      // "New ideas" doesn't switch between two sets. When the best one left is worse than the first set's
      // best (off the level, too warm or cold, or breaking a rule) it says so once, and when nothing new
      // is left it starts from the best again.
      const sig = `${state.occasion}|${state.level}|${state.anchor}|${Math.round(conditions().feels)}|${localDay()}`;
      const tierOf = (o) => ((o.levelOff || 0) > 0 || (o.wOff || 0) > 3.5 ? 2 : o.isBroken ? 1 : 0);
      const best = () => Math.min(2, ...state.outfits.map(tierOf));
      if (state.shown?.sig !== sig) state.shown = { sig, keys: [], tier: best() };
      state.shown.keys.push(...state.outfits.map((o) => o.key));
      generateOutfits(3, state.shown.keys);
      if (state.lastFresh < state.outfits.length) {
        state.shown = null;
        generateOutfits(3);
        toast("You've seen every outfit for this: back to the best ones");
      } else if (best() > state.shown.tier && !state.shown.told) {
        state.shown.told = true;
        toast(`Every good ${occLabel(state.occasion).toLowerCase()} outfit you have was in the ideas before: these are the next best`);
      }
      return render();
    }
    case "autotemp": e.preventDefault(); state.manualTemp = null; generateOutfits(); return render();
    case "shoot": addingExtraPhoto = false; return startShooting();
    case "shoot-done": { const shots = pendingShots; pendingShots = []; return startDraft(shots); }
    case "gallery": addingExtraPhoto = false; return galInput.click();
    case "more-photo": addingExtraPhoto = true; return galInput.click();
    case "cutout": return preparePhoto(draft.photos[draft.active], draft, true);
    case "fix-cut": return fixCutout(draft, draft.photos[draft.active]);
    case "rotate": {
      const d = draft, p = d.photos[d.active];
      p.rot = (p.rot + 90) % 360;
      p.manual = true;
      await applyRotation(p);
      return rerenderAdd(d);
    }
    case "scent-start": scentDraft = newScentDraft(); closeSheet(); return go("add");
    case "scent-shoot": return scentCam.click();
    case "scent-gallery": return scentGal.click();
    case "scent-lookup": return lookupScent(scentDraft);
    case "scent-save": return saveScent();
    case "scent-cancel": scentDraft = null; state.wardSide = "scents"; return go("wardrobe");
    case "cancel-add": draft = null; queue = []; pendingShots = []; return go(state.items.length ? "wardrobe" : "today");
    case "save": return saveDraft(false);
    case "save-next": return saveDraft(true);
    case "ai-tag": return recognise(draft);
    case "scan-tag": case "scan-label": return tagInput.click();
    case "lens-more": draft.lens.open = true; return rerenderAdd(draft);
    case "lens-start": return state.serverKeys.products ? lensInput.click() : toast(LENS_OFF);
    case "lens": {
      const p = draft?.photos[draft.active] || draft?.photos[0];
      if (!state.serverKeys.products) { draft.labelNote = LENS_OFF; return rerenderAdd(draft); }
      return p ? lensSearch(draft, p.orig) : lensInput.click();
    }
    case "label-shoot": addingExtraPhoto = true; return camInput.click();
    case "cut-all": return cutAll();
    case "recognise-all": return recogniseAll();
    case "fit-all": return fitAll();
    case "look-all": return lookAll();
    case "anchor-pick": return openAnchorPicker();
    case "see-wash": Object.assign(state.filters, { slot: "wash", cat: "all", q: "", style: "all", color: "all" }); return go("wardrobe");
    case "wash-later": state.settings.washAskedOn = today(); await saveSettings(); return render();
    case "wash-done": {
      const back = inWash();
      await setWash(back, false);
      toast(`${back.length} piece${back.length === 1 ? " is" : "s are"} back in your wardrobe`, { label: "Undo", run: async () => { await setWash(back, true); refreshViews(); } });
      return render();
    }
    case "cal-add": return addCalendar($('[data-input="cal"]')?.value || "");
    case "cal-refresh": await loadCalendar(true); toast(Object.keys(state.cal.errors).length ? "Some calendars couldn't be read" : "Calendars read"); return render();
    case "anchor-clear": return setAnchor(null);
    case "try": return tryIt();
    case "try-photo": return tryInput.click();
    case "try-ai": {
      const b = state.disc.try.shown;
      return ask(`I'm thinking of buying: ${b.title}. Is it a good addition to my wardrobe? Which colour and version would work best with what I own, and what would I wear it with? If something else would suit me better, say so.`, "try-ai");
    }
    case "trip": return lookupTrip($('[data-input="tripq"]')?.value);
    case "trip-clear": return setTrip(null);
    case "look": return makeLook();
    case "audit": return runAudit();
    case "need": return askNeed($('[data-input="need"]')?.value || "");
    case "need-clear": state.disc.need = null; return render();
    case "need-ai": return smarterPicks();
    case "report": state.wardView = "report"; render(); main.scrollTop = 0; return;
    case "report-open": go("wardrobe"); state.wardView = "report"; return render();
    case "report-close": state.wardView = null; render(); main.scrollTop = 0; return;
    case "ev-add": return addEventFromForm();
    case "ev-close": state.disc.ev = null; return render();
    case "ev-occ": state.disc.evOcc = !state.disc.evOcc; return render();
    case "forget-taste": {
      const learnt = state.log.filter((l) => logKind(l) !== "wear");
      if (!(await confirmBox(`Forget ${learnt.length} outfit ratings, likes, skips and swaps? What you wore and the stars on your pieces stay.`, "Forget them"))) return render();
      for (const l of learnt) await dropLog(l.id);
      tasteMemo = null;
      state.outfits = [];
      toast("Outfit ratings, likes and skips forgotten");
      return render();
    }
    case "ask": return ask($('[data-input="ask"]')?.value);
    case "savekey":
      state.settings.apiKey = $('[data-input="apikey"]').value.trim(); anthropicClient = null;
      await saveSettings(); toast(state.settings.apiKey ? "Claude key saved on this device" : "Claude key removed"); return render();
    case "savegemini":
      state.settings.geminiKey = $('[data-input="geminikey"]').value.trim();
      state.settings.geminiModel = $('[data-input="geminimodel"]').value.trim() || "gemini-flash-latest";
      await saveSettings(); toast(state.settings.geminiKey ? "Gemini key saved on this device" : "Gemini key removed"); return render();
    case "savemodel":
      state.settings.geminiModel = $('[data-input="geminimodel"]').value.trim() || "gemini-flash-latest";
      await saveSettings(); toast("Model saved"); return render();
    case "forget-key":
      if (state.settings.aiProvider === "claude") { state.settings.apiKey = ""; anthropicClient = null; } else state.settings.geminiKey = "";
      await saveSettings(); toast("Key removed from this device"); return render();
    case "city": {
      const q = $('[data-input="city"]').value.trim();
      if (!q) return;
      const box = $("#city-results");
      box.innerHTML = `<div class="spinner"></div>`;
      const { results, offline } = await searchCity(q);
      box.innerHTML = results.map((r) => `<button class="chip" data-city='${esc(JSON.stringify([r.latitude, r.longitude, r.name]))}'>${esc([r.name, r.admin1, r.country_code].filter(Boolean).join(", "))}</button>`).join("") +
        (offline
          ? `<p class="muted small" style="margin:4px 0 0;flex-basis:100%">${results.length ? "No internet here, so this is the built-in list of " + CITIES.length + " cities. Until live weather can load, the app uses their usual temperatures for the month." : `No internet here, and “${esc(q)}” isn't in the built-in list of ${CITIES.length} cities. Try the nearest big city, or set the temperature with the slider on the Today screen.`}</p>`
          : results.length ? "" : `<span class="muted">No city found</span>`);
      return;
    }
    case "geo":
      if (!navigator.geolocation) return toast("Location isn't available on this device");
      navigator.geolocation.getCurrentPosition(async (p) => {
        Object.assign(state.settings, { lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3), city: "Current location" });
        await saveSettings(); await loadWeather(true); state.outfits = [];
        toast(state.weather ? (state.weather.typical ? `Location set, using usual temperatures near ${state.weather.near}` : "Location set") : "Location set, but weather can't load here. Use the slider on Today.");
        render();
      }, () => toast("Location isn't available here. Type your city instead."));
      return;
    case "export": return exportBackup();
    case "import": return importBackup();
    case "wipe":
      if (!(await confirmBox(sync.status === "on" ? "Erase all clothes, fragrances, photos and history? Every device sharing this wardrobe loses them too." : "Erase all clothes, fragrances, photos and history from this device?", "Erase everything"))) return;
      await store.clear("items"); await store.clear("log"); await store.clear("wants"); await store.clear("events"); await store.clear("scents");
      state.items = []; state.log = []; state.wants = []; state.events = []; state.scents = []; state.outfits = [];
      toast("Wardrobe erased");
      return render();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.dataset?.input === "need") askNeed(e.target.value);
  if (e.key === "Enter" && ["evtext", "evplace"].includes(e.target.dataset?.input)) addEventFromForm();
});
document.addEventListener("input", (e) => {
  const k = e.target.dataset.input;
  if (!k) return;
  const v = e.target.value;
  if (k === "q") {
    state.filters.q = v;
    const grid = $("#grid");
    if (grid) grid.innerHTML = filteredItems().map(itemTile).join("");
    else render();
    return;
  }
  if (k.startsWith("mb-")) return bodyInput(k.slice(3), v);
  if (k === "tryoncap") {
    const n = Math.round(+v);
    if (v === "" || !(n >= 0 && n <= 500)) return;
    state.settings.tryonCap = n;
    clearTimeout(e.target._t);
    e.target._t = setTimeout(saveSettings, 400);
    return;
  }
  if (k === "trytext" || k === "trybrand") { state.disc.try[k === "trytext" ? "text" : "brand"] = v; return; }
  if (k === "tripq") { state.disc.tripq = v; return; }
  if (scentDraft && k.startsWith("sc-")) return scentTyped(scentDraft, k.slice(3), v);
  if (["evtext", "evdate", "evtime", "evplace"].includes(k)) { state.disc.evForm[k.slice(2)] = v; return; }
  if (k.startsWith("wash-") && WASH_GROUPS[k.slice(5)]) {
    const n = Math.round(+v);
    if (!(n >= 0 && n <= 30) || v === "") return;
    state.settings.washAfter = { ...WASH_DEFAULTS, ...state.settings.washAfter, [k.slice(5)]: n };
    clearTimeout(e.target._t);
    e.target._t = setTimeout(saveSettings, 400);
    return;
  }
  if (k === "age") {
    const n = Math.round(+v);
    state.settings.age = n >= 12 && n <= 99 ? n : null;
    const hint = $("#age-hint");
    if (hint) hint.textContent = ageHint();
    clearTimeout(e.target._t);
    e.target._t = setTimeout(() => { state.outfits = []; saveSettings(); }, 400);
    return;
  }
  if (k === "temp") {
    state.manualTemp = +v;
    clearTimeout(e.target._t);
    e.target._t = setTimeout(() => { generateOutfits(); render(); }, 250);
    return;
  }
  if (draft && ["name", "brand", "tags", "notes", "warmth", "price", "size", "material"].includes(k)) draft[k] = v;
  if (draft && k === "brand") brandTyped(v);
  if (draft && (k === "brand" || k === "tags")) {
    refreshStyles();
    // Update the hint and style chips without stealing focus from the text box.
    const hint = $("#brand-hint");
    if (hint) hint.textContent = brandHint(draft.brand);
    document.querySelectorAll("[data-sty]").forEach((c) => c.setAttribute("aria-pressed", draft.styles.includes(c.dataset.sty)));
  }
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target.dataset.input === "ask") ask(e.target.value);
  if (e.key === "Enter" && e.target.dataset.input === "city") $('[data-act="city"]').click();
  if (e.key === "Enter" && e.target.dataset.input === "cal") addCalendar(e.target.value);
  if (e.key === "Enter" && ["trytext", "trybrand"].includes(e.target.dataset.input)) tryIt();
  if (e.key === "Enter" && e.target.dataset.input === "tripq") lookupTrip(e.target.value);
  if (e.key === "Escape") { closeSheet(); if (cam.stream) { cam.shots = []; stopCamera(); } }
});

/* ======================================================================
   Boot
   ====================================================================== */
await loadAll();
await loadTryOn();
await washBack();
await moveWishlist();
applyTheme();
await loadBible();
loadWeather().then(() => { if (view === "today") { state.outfits = []; render(); } });
// Calendar events: now, when the app comes back to the front, and every half hour.
async function refreshCalendar() {
  const moved = await loadCalendar();
  const was = state.event?.key;
  if (state.event && !dayEvents().today.concat(dayEvents().tomorrow).some((e) => e.key === was)) state.event = null; // over, or deleted
  autoPickEvent();
  if (moved || state.event?.key !== was) {
    if (state.event?.key !== was) state.outfits = [];
    if (view === "today" && !document.activeElement?.matches("input, textarea")) render();
  }
}
refreshCalendar();
setInterval(refreshCalendar, CAL_FRESH);
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") refreshCalendar(); });
previewSample.then((f) => {
  if (!f) return;
  state.previewAI = true;
  if (view !== "add" && !document.activeElement?.matches("input, textarea")) render();
});
go("today");
syncLoop();
setTimeout(lookupWardrobeBrands, 3000);
{
  // Join the shared wardrobe before deciding whether this device needs the samples.
  await Promise.race([syncFirst, new Promise((r) => setTimeout(r, 4000))]);
  const seeded = await store.get("kv", "seeded");
  const version = (await store.get("kv", "seedVersion")) || 1;
  if ((!seeded && !state.items.length) || (seeded && version < SEED_VERSION)) await loadSeed();
  if (await dropDuplicateSamples()) render();
}
