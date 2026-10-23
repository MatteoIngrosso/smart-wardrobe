// Smart Wardrobe — a touch-first, offline-first wardrobe app.
// Everything (items, photos, wear log, settings) lives in IndexedDB on the device.
// Token budget: background removal and daily outfit ideas run on the device and
// cost nothing; the AI (Gemini or Claude) is only called to recognise a new photo
// once, and when you ask the stylist something.
import { parseICS, eventsBetween, guessOccasion, titleKey } from "./calendar.js";
import * as Style from "./stylist.js";
import * as Label from "./label.js";

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
  { id: "night", label: "Night out", target: 2.1, likes: ["streetwear", "luxury", "smart casual", "minimal", "smart"] },
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
  const req = indexedDB.open("smart-wardrobe", 1);
  req.onupgradeneeded = () => {
    const d = req.result;
    d.createObjectStore("items", { keyPath: "id" });
    d.createObjectStore("log", { keyPath: "id", autoIncrement: true });
    d.createObjectStore("kv");
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
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
// Same as `raw`, but changes to shared records (pieces, wear log, wishlist) are
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
    aiProvider: "gemini", geminiKey: "", geminiModel: "gemini-flash-latest", apiKey: "",
    autoCutout: true, aiAuto: true, autoWash: true,
  },
  usage: { month: "", requests: 0, input: 0, output: 0 },
  wishlist: [],
  filters: { q: "", slot: "all", cat: "all", color: "all", style: "all", sort: "recent" },
  occasion: "casual",
  manualTemp: null,
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
  },
  trip: null, // the mall or shop you're going to: { key, name, stores: [{ name, domain, sells, price }] }
  trips: [], // places looked up before (kept on this device, so each costs one AI request)
};

async function loadAll() {
  state.items = (await store.all("items")) || [];
  state.log = (await store.all("log")) || [];
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

/* ======================================================================
   Sync: one shared wardrobe for every device (server.py)
   Each device keeps its full copy in IndexedDB, so it works offline. When the
   app is opened through server.py, changes go to the computer running it and
   come back to the other devices through a long-poll, within a second or two.
   - pieces, the wear log, the wishlist, calendar links and a planned outfit are shared;
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
const SHARED_KV = { wishlist: () => [], calendar: () => ({ links: [], occ: {} }), plan: () => null };
function syncKey(s, k) {
  if (s === "items" || s === "log") return `${s}/${k}`;
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
    } else if (rec.col === "log") {
      const at = state.log.findIndex((l) => l.id === rec.id);
      if (rec.deleted) { await raw.del("log", rec.id); if (at >= 0) state.log.splice(at, 1); }
      else { await raw.put("log", rec.data); if (at >= 0) state.log[at] = rec.data; else state.log.push(rec.data); }
    } else if (rec.col === "kv" && Object.hasOwn(SHARED_KV, rec.id)) {
      state[rec.id] = (rec.deleted ? null : rec.data) ?? SHARED_KV[rec.id]();
      await raw.put("kv", state[rec.id], rec.id);
      if (rec.id === "calendar") state.cal.at = 0; // read the calendars again
      if (rec.id === "plan") state.outfits = [];
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
async function framePiece(blob) {
  const bmp = await createImageBitmap(blob);
  const s = 200 / Math.max(bmp.width, bmp.height);
  const sw = Math.max(1, Math.round(bmp.width * s)), sh = Math.max(1, Math.round(bmp.height * s));
  const sctx = newCanvas(sw, sh).getContext("2d", { willReadFrequently: true });
  sctx.drawImage(bmp, 0, 0, sw, sh);
  const a = sctx.getImageData(0, 0, sw, sh).data;
  let x0 = sw, y0 = sh, x1 = -1, y1 = -1;
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) if (a[(y * sw + x) * 4 + 3] > 40) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  if (x1 < 0) return blob;
  const bx = Math.max(0, (x0 - 1) / s), by = Math.max(0, (y0 - 1) / s);
  const bwid = Math.min(bmp.width - bx, (x1 - x0 + 3) / s), bhei = Math.min(bmp.height - by, (y1 - y0 + 3) / s);
  const m = Math.max(bwid, bhei) * 0.06;
  const W = Math.max(bwid + 2 * m, (bhei + 2 * m) * 0.75), H = W / 0.75;
  const scale = Math.min(1, 1200 / H);
  const c = newCanvas(Math.round(W * scale), Math.round(H * scale));
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, bx, by, bwid, bhei, (W - bwid) / 2 * scale, (H - bhei) / 2 * scale, bwid * scale, bhei * scale);
  return canvasBlob(c, "image/webp", 0.86);
}

// Returns { blob, engine } or throws if no method could find the garment.
async function removeBackground(blob) {
  try {
    return { blob: await framePiece(await aiCutout(blob)), engine: "ai" };
  } catch {
    return { blob: await framePiece(await basicCutout(blob)), engine: "basic" };
  }
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

// Turn an image clockwise. Cut-outs are re-framed afterwards; photos only turn in quarter steps.
async function rotateImage(blob, deg, cutout) {
  if (!cutout) deg = Math.round(deg / 90) * 90;
  deg = ((Math.round(deg) % 360) + 360) % 360;
  if (!deg) return blob;
  const bmp = await createImageBitmap(blob);
  const r = (deg * Math.PI) / 180, cos = Math.abs(Math.cos(r)), sin = Math.abs(Math.sin(r));
  const c = newCanvas(Math.round(bmp.width * cos + bmp.height * sin), Math.round(bmp.width * sin + bmp.height * cos));
  const ctx = c.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate(r);
  ctx.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
  return cutout ? framePiece(await canvasBlob(c, "image/png")) : canvasBlob(c, "image/jpeg", 0.85);
}

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
    const j = await getJSON(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation&hourly=apparent_temperature,precipitation_probability,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=2&timezone=auto`);
    const w = {
      at: Date.now(), lat,
      temp: j.current.temperature_2m, feels: j.current.apparent_temperature, code: j.current.weather_code,
      wind: j.current.wind_speed_10m, max: j.daily.temperature_2m_max[0], min: j.daily.temperature_2m_min[0],
      rainChance: j.daily.precipitation_probability_max[0] ?? 0,
      // Hour by hour for today and tomorrow, for events later in the day (local times, "2026-10-15T19:00").
      hourly: { time: j.hourly.time, feels: j.hourly.apparent_temperature, rain: j.hourly.precipitation_probability, code: j.hourly.weather_code },
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
  const at = state.event && eventWeather(state.event);
  if (at) {
    // Dressing now for something later today: warm enough for both. Tomorrow: for that time.
    if (state.event.day === "tomorrow") ({ feels, wet } = at);
    else { feels = Math.min(feels, at.feels); wet ||= at.wet; }
  }
  return { feels: state.manualTemp ?? feels, wet };
}
// How it will feel during an event (its first four hours), from the hourly forecast.
// With only the usual temperatures for the month, evenings and mornings are cooler than midday.
function eventWeather(ev) {
  const w = state.weather;
  if (!w || ev.allDay) return null;
  const h = w.hourly;
  if (!h) {
    const hr = new Date(ev.start).getHours();
    return hr >= 19 || hr < 9 ? { feels: (2 * w.min + w.max) / 3, wet: false } : null;
  }
  const to = Math.max(ev.start + 3600e3, Math.min(ev.end, ev.start + 4 * 3600e3));
  const idx = h.time.map((t, k) => [new Date(t).getTime(), k]).filter(([t]) => t + 3600e3 > ev.start && t < to).map(([, k]) => k);
  if (!idx.length) return null;
  const feels = idx.reduce((a, k) => a + h.feels[k], 0) / idx.length;
  return { feels, wet: idx.some((k) => isWet(h.code[k]) || (h.rain[k] ?? 0) >= 55) };
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
const styleCtx = (cond, occ, t) => ({ occasion: occ.id, feels: cond.feels, wet: cond.wet, offset: occ.id === "gym" ? 0 : t?.offset || 0 });
// The rules the engine scores in its own, personal way (see scoreOutfit); they still count as violations.
const OWN_COMFORT_RULES = ["warmth", "shorts-weather"];
const ruleLine = (v) => v.note || v.rule.title;

// Warmth points of the top layers, and how many the rule of thumb wants at a temperature.
const layerWarmth = (pieces) => pieces.filter((p) => ["base", "mid", "outer"].includes(roleOf(p))).reduce((a, p) => a + (p.warmth || 2), 0);
const wantedWarmth = (feels) => (feels >= 24 ? 1 : feels >= 19 ? 2.5 : feels >= 14 ? 3.5 : feels >= 8 ? 6 : feels >= 2 ? 8 : 9.5);
// The piece people see first (the top under any jacket), which sets the outfit's colour and fit.
const heroOf = (o) => o.mid || o.base;
const outfitKey = (pieces) => pieces.filter((p) => p && CORE.includes(roleOf(p))).map((p) => p.id).sort().join("|");

function scoreOutfit(o, cond, occ, t = taste()) {
  const reasons = [];
  let s = 0;
  const pieces = Object.values(o).filter(Boolean);

  // Warmth / layering, shifted by how warm you like to dress (learnt from what you wear)
  const { feels, wet } = cond;
  const warmth = layerWarmth(pieces);
  const want = wantedWarmth(feels) + (occ.id === "gym" ? 0 : t.offset);
  s -= Math.abs(warmth - want) * 0.7;
  // Too hot for a hoodie or knit (outfits with more pieces collect more style points, so say it clearly).
  if (o.mid && feels >= 24) s -= 3;
  else if (o.mid && feels >= 21 && o.mid.warmth >= 3) s -= 1;
  if (o.outer) {
    if (o.outer.warmth >= 5 && feels > 12) s -= 3;
    if (feels < 6 && o.outer.warmth >= 4) reasons.push(`${o.outer.name} keeps you warm at ${fmtTemp(feels)}`);
    else if (feels < 14) reasons.push(`A light layer for ${fmtTemp(feels)}`);
    if (wet && o.outer.category === "rain") { s += 1.5; reasons.push("Rain jacket for the showers"); }
  }
  if (o.shoes?.category === "boots") s -= feels >= 24 ? 3 : feels >= 20 ? 1 : 0; // boots in the heat
  if (o.bottom) {
    const shorts = /shorts/.test(o.bottom.category);
    if (shorts && feels < 17) s -= o.bottom.category === "gym-shorts" ? 1 : 5; // you train indoors in gym shorts
    else if (shorts && feels >= 23) { s += 1; reasons.push(`Shorts weather at ${fmtTemp(feels)}`); }
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
        const street = pieces.some((p) => (p.styles || []).includes("streetwear"));
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

  // Rotation: don't repeat what you wore recently; give the forgotten pieces a turn
  for (const p of pieces) {
    const d = daysSince(p.lastWorn);
    if (d <= 1) s -= 3; else if (d <= 4) s -= 1.2;
    if (p.favorite) s += 0.4;
    if (!p.wearCount) s += 0.3;
  }
  const fresh = pieces.find((p) => !p.wearCount || daysSince(p.lastWorn) > 21);

  // Your taste: what you've worn, liked and skipped before
  const learnt = tasteScore(o, occ, t);
  s += learnt.score;
  if (learnt.reason) reasons.unshift(learnt.reason);
  if (fresh) reasons.push(`Gives the ${fresh.name} some wear`);
  return { score: s, reasons: reasons.slice(0, 3), broken: broken.map(ruleLine) };
}

// Today's candidates, best first. Cheap enough to redo on every tap (900 tries).
// The pieces that can fill each part of an outfit for an occasion (none that are in the wash).
function piecesByRole(occ) {
  const gym = occ.id === "gym";
  const by = { base: [], mid: [], outer: [], bottom: [], shoes: [] };
  for (const it of wearable()) if (by[roleOf(it)] && (slotOf(it) === "gym") === gym) by[roleOf(it)].push(it);
  if (gym) for (const [role, cats] of Object.entries(GYM_FALLBACK)) if (!by[role].length) by[role] = wearable().filter((i) => cats.includes(i.category));
  return by;
}
// `opts` lets Discover ask for ideas around a piece you don't own yet ({ anchor, occ, cond }).
function ideaPool(opts = {}) {
  const occ = opts.occ || OCCASIONS.find((o) => o.id === state.occasion);
  const by = piecesByRole(occ);
  const cond = opts.cond || conditions();
  const t = taste();
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const wantMid = cond.feels < 20 || by.base.length === 0;
  const wantOuter = cond.feels < 15 || cond.wet;
  // A piece you picked goes in every idea; the rest is built around it.
  const anchor = opts.anchor || state.items.find((i) => i.id === state.anchor && CORE.includes(roleOf(i)) && !i.wash);

  const seen = new Set();
  const cands = [];
  for (let i = 0; i < 900; i++) {
    const o = {};
    // Cool days: mostly base + mid layer. Warm days: mostly a base layer alone, but mid
    // layers are still tried (the score decides), so a wardrobe with one or two T-shirts
    // still gets three different ideas.
    const r = Math.random();
    if (by.base.length && (!by.mid.length || r < (wantMid ? 0.85 : 0.7))) o.base = pick(by.base);
    if (by.mid.length && (!o.base || wantMid || r < 0.15)) o.mid = pick(by.mid);
    if (by.outer.length && wantOuter) o.outer = pick(by.outer);
    if (by.bottom.length) o.bottom = pick(by.bottom);
    if (by.shoes.length) o.shoes = pick(by.shoes);
    if (anchor) o[roleOf(anchor)] = anchor;
    if (!o.base && !o.mid) continue;
    const key = outfitKey(Object.values(o));
    if (seen.has(key)) continue;
    seen.add(key);
    const scored = scoreOutfit(o, cond, occ, t);
    cands.push({ key, pieces: o, ...scored, jitter: Math.random() * 0.6, blocked: t.blocked.has(key), isBroken: scored.broken.length > 0 });
  }
  cands.sort((a, b) => b.score + b.jitter - (a.score + a.jitter));
  const missing = ["bottom", "shoes"].filter((s) => !by[s].length && roleOf(anchor || {}) !== s);
  if (!by.base.length && cond.feels >= 22) missing.unshift("base");
  return { occ, cond, cands, missing };
}

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
  const differ = (h, b) => !heroes.has(h) && !(b && bottoms.has(b));
  const half = (h, b) => !heroes.has(h) || !(b && bottoms.has(b));
  const good = (cands.find((c) => !c.blocked && !c.isBroken)?.score ?? cands.find((c) => !c.blocked)?.score ?? 0) - 3;
  const passes = [[differ, good], [half, good], [differ, -Infinity], [half, -Infinity], [() => true, -Infinity]];
  for (const [allowBlocked, allowBroken] of [[false, false], [true, false], [true, true]]) {
    for (const [ok, min] of passes) {
      for (const c of cands) {
        if (out.length === n) break;
        const hero = heroOf(c.pieces).id;
        const bottom = c.pieces.bottom?.id;
        if (out.includes(c) || shown.has(c.key) || (c.blocked && !allowBlocked) || (c.isBroken && !allowBroken) || c.score < min || !ok(hero, bottom)) continue;
        heroes.add(hero);
        if (bottom) bottoms.add(bottom);
        out.push(c);
      }
    }
  }
  return out;
}
// An idea you already ♥ today keeps its heart when it comes back.
const likedToday = (key) => state.log.find((l) => l.kind === "like" && l.date === today() && outfitKey((l.itemIds || []).map((id) => state.items.find((i) => i.id === id))) === key)?.id;
const dressIdea = (c, pool, used) => withWarn({ ...c, missing: pool.missing, likedId: likedToday(c.key), ...extrasFor(c.pieces, pool.cond, pool.occ, used) }, pool.cond, pool.occ);
// An idea that still breaks one of the fashion bible's important rules once its headwear and
// accessories are on (only shown when nothing better is left) says so on its card.
function withWarn(idea, cond, occ) {
  const j = Style.ready() ? Style.judge([...Object.values(idea.pieces), ...(idea.extras || [])].filter(Boolean), styleCtx(cond, occ, taste())) : null;
  return { ...idea, warn: j ? j.violations.map(ruleLine) : [] };
}

// `avoid`: outfits just shown, so "New ideas" always brings different ones.
function generateOutfits(n = 3, avoid = []) {
  tasteMemo = null; // pieces may have changed (colours, fit) since it was worked out
  const pool = ideaPool();
  const used = new Set();
  const plan = plannedIdea(pool);
  if (plan) { n--; plan.extras.forEach((x) => used.add(x.id)); }
  const keep = plan ? [plan] : [];
  const picks = pickIdeas(pool, n, keep, avoid);
  if (picks.length < n) picks.push(...pickIdeas(pool, n - picks.length, [...keep, ...picks])); // small wardrobe: repeats are fine
  state.outfits = [...keep, ...picks.map((c) => dressIdea(c, pool, used))];
}
// The outfit you planned last night comes first today, while all of it is out of the wash.
function plannedIdea(pool) {
  const p = state.plan;
  if (!p || p.date !== localDay() || state.event?.day === "tomorrow" || state.anchor) return null;
  const items = (p.itemIds || []).map((id) => state.items.find((i) => i.id === id)).filter(Boolean);
  if (!items.length || items.some((i) => i.wash)) return null;
  const pieces = {}, extras = [];
  for (const it of items) (CORE.includes(roleOf(it)) && !pieces[roleOf(it)] ? (pieces[roleOf(it)] = it) : extras.push(it));
  if (!pieces.base && !pieces.mid) return null;
  const key = outfitKey(items);
  return withWarn({ key, pieces, planned: p, missing: [], likedId: likedToday(key), ...scoreOutfit(pieces, pool.cond, pool.occ), extras, extrasWhy: [] }, pool.cond, pool.occ);
}
async function planOutfit(o) {
  const e = state.event;
  state.plan = { date: localDay(1), itemIds: [...Object.values(o.pieces), ...(o.extras || [])].filter(Boolean).map((p) => p.id), occasion: state.occasion, title: e?.title || "", at: new Date().toISOString() };
  await savePlan();
  await addLog({ kind: "like", itemIds: Object.values(o.pieces).filter(Boolean).map((p) => p.id), ...outfitContext(), source: "plan" });
}
// Swapping one piece of an idea: every other piece that could take its place, best fit with
// the rest of the outfit first. A jacket, or one of two top layers, can also just be left off.
function swapOptions(o, role) {
  const occ = OCCASIONS.find((x) => x.id === state.occasion);
  const cond = conditions(), t = taste();
  const cur = o.pieces[role];
  const options = piecesByRole(occ)[role]
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
  state.outfits[i] = withWarn({ ...o, key, pieces, swapping: null, likedId: likedToday(key), ...scoreOutfit(pieces, cond, occ), ...extrasFor(pieces, cond, occ, used) }, cond, occ);
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
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
let tasteMemo = null;

function taste() {
  const sig = `${state.log.length}|${state.items.length}|${today()}|${state.log.at(-1)?.id}`;
  if (tasteMemo?.sig === sig) return tasteMemo.t;
  const byId = new Map(state.items.map((i) => [i.id, i]));
  const t = { pairs: {}, items: {}, colours: {}, fits: {}, styles: {}, offset: 0, blocked: new Set(), counts: { wear: 0, like: 0, skip: 0, swap: 0 }, comfortN: 0 };
  const add = (map, k, v) => (map[k] = (map[k] || 0) + v);
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
    const v = w * ({ wear: 1, like: 1.5, skip: -1.2 }[kind] || 0);
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
      add(t.items, `${occ}|${p.id}`, kind === "skip" ? v * 0.3 : v);
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
  if (best) reason = `You like the ${best[1].name} with the ${best[2].name}`;
  else if (colourLiked) reason = `${cap(hero.colors[0])} with ${o.bottom.colors[0]}: a pairing you go for`;
  return { score: s, reason };
}

// One line under the ideas saying what they've learnt so far.
function tasteLine() {
  const t = taste();
  const { wear, like, skip, swap } = t.counts;
  if (!wear && !like && !skip && !swap) return "Ideas learn from you: tap Wear this today, ♥, Not for me or ⇄ on a piece, and they get closer to your taste.";
  const n = (k, one, many) => `${k} ${k === 1 ? one : many}`;
  let line = `Learning from ${[wear && n(wear, "outfit worn", "outfits worn"), like && n(like, "like", "likes"), skip && n(skip, "skip", "skips"), swap && n(swap, "swap", "swaps")].filter(Boolean).join(", ")}.`;
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
  const liked = recent("like").map((l) => refs(l.itemIds.filter((id) => byId.has(id)))).filter(Boolean);
  if (liked.length) lines.push(`Liked outfits: ${liked.join(", ")}.`);
  const nope = recent("skip", (l) => ["colours", "style", undefined].includes(l.reason)).map((l) => `${refs(l.itemIds)}${l.reason ? ` (${l.reason})` : ""}`).filter((x) => /#/.test(x));
  if (nope.length) lines.push(`Turned down: ${nope.join(", ")}.`);
  const swapped = recent("swap", (l) => num.has(l.removed)).map((l) => `${num.get(l.removed)} (with ${refs(l.itemIds.filter((id) => id !== l.removed))})`);
  if (swapped.length) lines.push(`Swapped out of outfits: ${swapped.join(", ")}.`);
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
  for (const [cats, reason] of needs) {
    let options = wearable().filter((i) => cats.includes(i.category));
    // A belt in the same colour family as the leather shoes (black with black, brown with brown).
    if (cats[0] === "belt" && pieces.shoes && Style.ready()) options = options.filter((i) => !((Style.ruleScore([pieces.shoes, i], "belt-shoes") ?? 0) <= -0.5));
    if (!options.length) continue;
    const score = (i) => {
      const c = i.colors?.[0];
      let s = COLORS[c]?.neutral || !c ? 1 : c === accent ? 1.5 : accent ? -1.5 : 0.5;
      if ((i.styles || []).some((st) => occ.likes.includes(st))) s += 0.7;
      const d = daysSince(i.lastWorn);
      if (d <= 1) s -= 1.5;
      if (i.favorite) s += 0.4;
      if (used.has(i.id)) s -= 1;
      return s + Math.random() * 0.3;
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
    if (washed.includes(it)) it.wash = now;
    await store.put("items", it);
  }
  await addLog({ itemIds: items.map((i) => i.id), ...(ctx && outfitContext()), ...ctx });
  return washed;
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
// Worn once, then washed: T-shirts and shirts, underwear and socks, and gym clothes (not shoes or bags).
const washAfterWear = (it) => ["base", "under"].includes(slotOf(it)) || (slotOf(it) === "gym" && ["base", "mid", "bottom"].includes(roleOf(it)));
const wearable = () => state.items.filter((i) => !i.wash);
const inWash = () => state.items.filter((i) => i.wash);
async function setWash(items, on) {
  const now = new Date().toISOString();
  for (const it of items) {
    if (on) it.wash = now; else delete it.wash;
    await store.put("items", it);
  }
  if (on && items.some((i) => i.id === state.anchor)) state.anchor = null;
  state.outfits = [];
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
  const from = startOfDay(0), to = startOfDay(2);
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
  if (!err) { autoPickEvent(); toast(`Calendar added: ${state.cal.events.filter((e) => e.cal === url).length} events today and tomorrow`); }
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
  const brandCount = {};
  for (const i of items) if (i.brand) brandCount[i.brand] = (brandCount[i.brand] || 0) + 1;
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
const shopperText = () => (state.settings.gender === "women" ? "a woman (womenswear)" : "a man (menswear)");
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
// `onSources` then gets the web pages it used ({ uri, title }).
async function geminiGenerate({ system, text, image, schema, maxTokens, search, onSources }) {
  const { geminiKey, geminiModel } = state.settings;
  const parts = [];
  if (image) parts.push({ inline_data: { mime_type: "image/jpeg", data: await blobToBase64(image) } });
  parts.push({ text });
  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts }],
    ...(search ? { tools: [{ google_search: {} }] } : {}),
    generationConfig: {
      maxOutputTokens: maxTokens,
      thinkingConfig: { thinkingBudget: 0 }, // no hidden "thinking" tokens for these short tasks
      ...(schema ? { responseMimeType: "application/json", responseSchema: toGeminiSchema(schema) } : {}),
    },
  };
  const model = encodeURIComponent(geminiModel || "gemini-flash-latest");
  // With the key saved on the server, the request goes through it and this device never holds the key.
  const call = (b) => state.serverKeys.gemini
    ? fetch(`api/ai/gemini/${model}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) })
    : fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": geminiKey },
      body: JSON.stringify(b),
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
    throw e;
  }
}

// One line per piece, short fields: keeps the stylist prompt to roughly 15 tokens per item.
// "#n" numbers let the answer point at pieces, so their photos can be shown.
function wardrobeText() {
  // Underwear and socks are left out: they cost tokens and rarely change the advice.
  return state.items.map((i, n) => {
    if (slotOf(i) === "under") return "";
    const b = brandInfo(i.brand);
    return [
      `#${n + 1} ${i.name}`, catLabel(i.category), (i.colors || []).join("/"),
      i.brand ? i.brand + (b?.tier ? ` (${b.tier})` : "") : "",
      (i.styles || []).join("/"), FITS[i.fit] ? `${i.fit} fit` : "", `w${i.warmth}`,
      i.wearCount ? `worn ${i.wearCount}x${daysSince(i.lastWorn) <= 7 ? `, last ${daysSince(i.lastWorn)}d ago` : ""}` : "unworn",
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
  // "#4 Navy knit" → "Navy knit"; a bare "#4" → the piece's name.
  return text.replace(/#(\d+)\s*/g, (m, n, at, s) => {
    const it = refName(refs, +n);
    if (!it) return "";
    const rest = s.slice(at + m.length);
    if (rest.toLowerCase().startsWith(it.name.toLowerCase())) return "";
    return /^\w/.test(rest) ? `${it.name} ` : it.name;
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
const wishBtn = (b) => `<button class="btn" data-wishbuy="${esc(JSON.stringify({ prio: "medium", title: b.title, why: b.why || "", query: b.query, cat: b.cat, color: b.color }))}">${state.wishlist.some((w) => w.title === b.title) ? "♥ Saved" : "♡ Save"}</button>`;

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

// Recognise type, colours, brand and style from one photo.
const TAG_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "category", "colors", "brand", "styles", "fit", "warmth", "tags", "front_top", "back_top"],
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
    maxTokens: 320,
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
    <div class="stack">
      <div class="card row" style="justify-content:space-between">
        ${weatherHtml}
        <div class="field" style="min-width:min(260px,100%);flex:1;max-width:420px">
          <label for="temp-slider">Feels like ${fmtTemp(cond.feels)}${state.manualTemp != null ? ' · <a href="#" data-act="autotemp" style="color:var(--accent)">use weather</a>' : ""}</label>
          <input id="temp-slider" type="range" min="-10" max="35" step="1" value="${Math.round(cond.feels)}" data-input="temp">
        </div>
      </div>
      ${dayCard()}
      <div class="chips scroller">${OCCASIONS.map((o) => `<button class="chip" aria-pressed="${state.occasion === o.id}" data-occ="${o.id}">${o.label}</button>`).join("")}</div>
      ${anchorBar()}
      <div class="outfits">${state.outfits.map((o, i) => outfitCard(o, i)).join("") || `<p class="muted">Add a few more tops to get outfit ideas.</p>`}</div>
      ${laundryLine()}
      <p class="muted small" style="margin:0">${esc(tasteLine())}</p>
      ${aiCard()}
    </div>`;
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
      ${state.event ? `<span class="muted small">Ideas for <b>${esc(state.event.title)}</b>${state.event.day === "tomorrow" ? " tomorrow" : ""}</span>` : ""}</div>
    ${body}
    ${errors.length ? `<p class="small" style="margin:0;color:var(--danger)">${esc(errors[0])}</p>` : ""}
  </section>`;
}
function laundryLine() {
  const n = inWash().length;
  if (!n) return "";
  return `<div class="row laundry-row"><span class="muted small">${n} piece${n === 1 ? " is" : "s are"} in the wash and left out of these ideas.</span><button class="chip" data-act="see-wash">See them</button><button class="chip" data-act="wash-done">Laundry done</button></div>`;
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
function outfitCard(o, i) {
  const order = ["outer", "mid", "base", "bottom", "shoes"];
  const ph = (o.missing || []).map((m) => `<button class="piece" data-go="shop"><div class="ph">${kindIcon(SLOT_ICON[m])}<small>No ${SLOTS[m].toLowerCase()} yet<br>tap to shop</small></div><span>${SLOTS[m]}</span></button>`).join("");
  return `<article class="card outfit">
    <div class="row" style="justify-content:space-between"><h2 style="margin:0">${o.planned ? `Planned last night${o.planned.title ? `: ${esc(o.planned.title)}` : ""}` : ["Best match", "Option 2", "Option 3"][i] || "Option"}</h2>${o.planned ? '<span class="score">Your plan</span>' : i === 0 ? '<span class="score">Top pick</span>' : ""}</div>
    <div class="pieces">${order.filter((k) => o.pieces[k]).map((k) => `<div class="swap-wrap">${pieceTile(o.pieces[k])}<button class="swap-btn" data-swap="${i}:${k}" aria-pressed="${o.swapping === k}" aria-label="Swap the ${esc(o.pieces[k].name)}">${ICON_SWAP}</button></div>`).join("")}${ph}</div>
    ${o.swapping ? swapPicker(o, i) : ""}
    ${o.extras?.length ? `<div class="pieces extras">${o.extras.map(pieceTile).join("")}</div>` : ""}
    ${o.reasons.length || o.extrasWhy?.length ? `<p class="why">${[...o.reasons, ...(o.extrasWhy || [])].map(esc).join(" · ")}</p>` : ""}
    ${o.warn?.length ? `<p class="why warn">Heads up: ${o.warn.map(esc).join(" · ")}</p>` : ""}
    ${o.asking
      ? `<div class="stack" style="gap:8px"><span class="muted small">What's off? The next ideas take it into account.</span><div class="chips">${SKIP_REASONS.map(([k, l]) => `<button class="chip" data-skipwhy="${i}:${k}">${l}</button>`).join("")}<button class="chip" data-skip="${i}" data-cancel="1">Cancel</button></div></div>`
      : `<div class="row outfit-actions">
          ${state.event?.day === "tomorrow" ? `<button class="btn primary" data-plan="${i}">Plan it for tomorrow</button>` : `<button class="btn primary" data-wear="${i}">Wear this today</button>`}
          <button class="btn icon-btn like" data-like="${i}" aria-pressed="${!!o.likedId}" aria-label="${o.likedId ? "Liked" : "Like this outfit"}">${ICON_HEART}</button>
          <button class="btn ghost" data-skip="${i}">Not for me</button>
        </div>`}
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

/* ---------- Wardrobe ---------- */
function filteredItems() {
  const { q, slot, cat, color, style, sort } = state.filters;
  const ql = q.trim().toLowerCase();
  const list = state.items.filter((i) =>
    (slot === "all" || (slot === "fav" ? i.favorite : slot === "wash" ? i.wash : slotOf(i) === slot)) &&
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
  const list = filteredItems();
  const usedColors = [...new Set(state.items.flatMap((i) => i.colors || []))];
  const usedStyles = Object.keys(STYLES).filter((s) => state.items.some((i) => (i.styles || []).includes(s)));
  const f = state.filters;
  const washing = inWash().length;
  main.innerHTML = `
    <div class="head">
      <div><h1>Wardrobe</h1><p class="sub">${state.items.length} pieces${washing ? ` · ${washing} in the wash` : ""}</p></div>
      <div class="chips">${[["recent", "Newest"], ["most", "Most worn"], ["least", "Least worn"], ["name", "A–Z"]].map(([k, l]) => `<button class="chip" aria-pressed="${f.sort === k}" data-sort="${k}">${l}</button>`).join("")}</div>
    </div>
    <div class="toolbar">
      <div class="search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg><input id="search-input" class="input" placeholder="Search name, brand, style, tag…" value="${esc(f.q)}" data-input="q"></div>
      <div class="chips scroller">
        <button class="chip" aria-pressed="${f.slot === "all"}" data-slot="all">All</button>
        <button class="chip" aria-pressed="${f.slot === "fav"}" data-slot="fav">★ Favourites</button>
        ${washing || f.slot === "wash" ? `<button class="chip" aria-pressed="${f.slot === "wash"}" data-slot="wash">In the wash <span class="muted">${washing}</span></button>` : ""}
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
    <div class="pic${i.wash ? " washing" : ""}"><img class="thumb pic-bg" loading="lazy" src="${photoURL(i.photos?.[0])}" alt="">${i.favorite ? '<span class="fav">★</span>' : ""}${i.wash ? '<span class="wash-badge">In the wash</span>' : ""}</div>
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
    ${i.tags?.length ? `<div class="chips" style="margin-bottom:14px">${i.tags.map((t) => `<span class="chip">${esc(t)}</span>`).join("")}</div>` : ""}
    ${i.notes ? `<p>${esc(i.notes)}</p>` : ""}
    <div class="row">
      <button class="btn primary" data-wear-item="${i.id}">Wearing it today</button>
      <button class="btn" data-fav="${i.id}">${i.favorite ? "★ Favourite" : "☆ Favourite"}</button>
      <button class="btn" data-wash="${i.id}" aria-pressed="${!!i.wash}">${i.wash ? "Back from the wash" : "In the wash"}</button>
      ${CORE.includes(roleOf(i)) && !i.wash ? `<button class="btn" data-anchor="${i.id}">Build outfits with it</button>` : ""}
      <button class="btn" data-pair="${i.id}">What goes with it?</button>
      <button class="btn" data-edit="${i.id}">Edit</button>
      <button class="btn ghost danger" data-del="${i.id}">Delete</button>
    </div>
    <div class="ai-answer" id="pair-answer" style="margin-top:16px"></div>`;
  $("#sheet").hidden = false;
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
// A draft photo keeps the photo as taken (src) and its cut-out (cutSrc), plus what is shown
// after turning it upright by `rot` degrees: orig (photo) and cut (cut-out).
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
const ICON_ROTATE =`<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/></svg>`;

function renderAdd() {
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
  const site = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };
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
          ${cur.busy ? `<div class="busy"><div class="spinner"></div><span>Removing background…</span></div>` : ""}
          ${d.photos.length > 1 ? `<span class="photo-tag">${d.active === 0 ? "Front" : d.active === 1 ? "Back" : `Photo ${d.active + 1}`}</span>` : ""}
        </div>
        <div class="row">
          ${cur.busy ? "" : `<button class="chip" data-act="rotate">${ICON_ROTATE}Turn</button>`}
          ${cur.cut ? `<button class="chip" data-cutview="${cur.useCut ? 0 : 1}">${cur.useCut ? "Use original photo" : "Use cut-out"}</button>` : cur.busy ? "" : `<button class="chip" data-act="cutout">Remove background</button>`}
          ${cur.engine === "basic" && cur.useCut ? `<span class="muted small">Quick cut-out. The AI cut-out needs internet the first time.</span>` : ""}
        </div>
        <div class="photo-strip">
          ${d.photos.map((p, k) => `<div class="mini ${k === d.active ? "on" : ""}"><img class="pic-bg" src="${photoURL(shown(p))}" data-photo="${k}" alt="">${p.busy ? '<div class="mini-busy"><div class="spinner"></div></div>' : ""}<button class="x" data-rmphoto="${k}" aria-label="Remove photo">×</button></div>`).join("")}
          <button class="add-photo" data-act="more-photo" aria-label="Add photo">+</button>
        </div>
        ${d.photos[0]?.shop ? `<p class="muted small" style="margin:0">Photo from ${esc(d.shopPhoto.site || "the shop")}.${d.shopPhoto.otherColour ? " It shows the piece in another colour: add your own photo with + and remove this one." : " Add your own with +."}</p>` : ""}`}
      </div>
      <div class="stack">
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
            <span class="muted small">${aiReady() ? `Reads the QR code, and ${aiName()} reads brand, price, size and material from a photo of the tag or label.` : "Reads the QR code on the tag. Add a Gemini key in Settings to read the printed text too, or type it in."}</span>
          </div>
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
  if (p.cutSrc) p.cut = await rotateImage(p.cutSrc, p.rot, true);
}
// Cut the background out and stand the piece upright.
async function preparePhoto(p, d, cut = state.settings.autoCutout) {
  p.busy = true;
  rerenderAdd(d);
  try {
    if (cut && !p.cutSrc) {
      const r = await removeBackground(p.src);
      p.cutSrc = r.blob; p.engine = r.engine; p.useCut = true;
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
async function startDraft(srcs) {
  draft = newDraft();
  const d = draft;
  d.photos = srcs.slice(0, 4).map(newPhoto);
  d.colors = await detectColors(srcs[0]).catch(() => []);
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
    brand: { type: "string", description: "Brand printed on the tag; empty if none" },
    name: { type: "string", description: "Product name or short description if printed, e.g. 'Slim fit chinos'; empty if none" },
    reference: { type: "string", description: "Product reference or style number as printed, e.g. '3660/516/833' or 'REF 7683 515 400'; not the barcode number; empty if none" },
    category: { type: "string", enum: [...CATS.map((c) => c.id), ""], description: "Type of garment if the tag makes it clear; empty if not" },
    color: { type: "string", description: "Colour name if printed, in English, e.g. 'mid blue'; empty if none" },
    price: { type: "number", description: "Current selling price (the discounted one if there are two); 0 if none" },
    currency: { type: "string", description: "ISO code such as EUR, GBP, USD; empty if no price" },
    size: { type: "string", description: "Size as printed, e.g. M, 32/32, EU 42; empty if none" },
    material: { type: "string", description: "Composition, e.g. '100% cotton'; empty if none" },
  },
};
const tagInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", capture: "environment", hidden: true });
document.body.append(tagInput);
const tryInput = Object.assign(document.createElement("input"), { type: "file", accept: "image/*", capture: "environment", hidden: true });
document.body.append(tryInput);
tryInput.onchange = () => { const f = tryInput.files[0]; tryInput.value = ""; if (f) tryPhoto(f); };
tagInput.onchange = () => {
  const f = tagInput.files[0];
  tagInput.value = "";
  if (!f) return;
  // From the start of Add, the label makes a new piece; inside a piece, it fills in what's missing.
  if (!draft || (!draft.photos.length && !draft.id && !draft.fromLabel)) { draft = { ...newDraft(), fromLabel: true }; go("add"); }
  scanTag(draft, f);
};

// QR codes are read on the device: by the browser where it can (Android, Mac), else by jsQR
// (vendor/jsqr.min.js, Apache 2.0, loaded the first time). A label photo usually shows the
// code small, so it's tried at a few sizes.
let jsQRLoad;
const loadJsQR = () => (jsQRLoad ||= new Promise((ok, no) => {
  if (window.jsQR) return ok(window.jsQR);
  const s = Object.assign(document.createElement("script"), { src: "vendor/jsqr.min.js" });
  s.onload = () => (window.jsQR ? ok(window.jsQR) : no(new Error("jsQR didn't load")));
  s.onerror = () => { jsQRLoad = null; no(new Error("jsQR didn't load")); };
  document.head.append(s);
}));
async function readQR(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => createImageBitmap(file));
  if ("BarcodeDetector" in window) {
    try {
      const hit = (await new BarcodeDetector({ formats: ["qr_code"] }).detect(bmp)).map((c) => c.rawValue).find(Boolean);
      if (hit) return hit;
    } catch { /* this browser has no QR reader */ }
  }
  const jsQR = await loadJsQR();
  for (const max of [1200, 2000, 800]) {
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = newCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale));
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const code = jsQR(ctx.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: "attemptBoth" });
    if (code?.data) return code.data;
  }
  return "";
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
// The shop's page for the piece on the label: { page, ref }. Tries the QR link, then a link
// built from the reference, then Google Shopping, then the AI with Google Search.
async function findProduct(qr, tag, step) {
  const link = Label.linkIn(qr);
  const brand = tag?.brand || "";
  const ref = Label.refFrom(tag?.reference) || Label.refInUrl(link) || (!link && Label.refFrom(qr)) || null;
  let best = null;
  const open = async (url) => {
    const page = await pageInfo(url);
    if (page?.noServer) throw Object.assign(new Error("Product pages can only be opened on the hosted app."), { noServer: true });
    if (page?.title && (!best || (page.image && !best.image))) best = page;
    return !!page?.image;
  };
  step("Opening the product page…");
  for (const url of [link, Label.shopUrl(brand || link, ref, state.settings.region)].filter(Boolean)) if (await open(url)) return { page: best, ref };
  const words = [brand, tag?.name, ref?.text || tag?.reference].filter(Boolean).join(" ");
  if (!brand || words === brand) return { page: best, ref };
  if (productsOn()) {
    step("Looking it up on Google Shopping…");
    const it = state.settings.region === "it";
    const r = await fetch(`api/products?${new URLSearchParams({ q: words, gl: it ? "it" : "us", hl: it ? "it" : "en" })}`).catch(() => null);
    const items = (await r?.json().catch(() => null))?.items || [];
    const hit = items.find((p) => normBrand(p.shop).includes(normBrand(brand)) || normBrand(p.title).includes(normBrand(brand)));
    if (hit && (await open(hit.url))) return { page: best, ref };
    if (hit && !best?.image) best = { url: hit.url, title: hit.title, image: hit.image, images: [hit.image], price: hit.price, site: hit.shop };
    if (best?.image) return { page: best, ref };
  }
  if (aiReady()) {
    step("Searching the shop's website…");
    let sources = [];
    const text = await aiGenerate({
      system: "You find the official product page of a piece of clothing from what its label says. Use Google Search. Reply with the product page URL only.",
      text: `${words}${link ? ` (its QR code links to ${link})` : ""}`,
      search: true, maxTokens: 120, onSources: (w) => (sources = w),
    }).catch(() => "");
    for (const url of [...new Set([Label.linkIn(text), ...sources.map((s) => s.uri)].filter(Boolean))].slice(0, 3)) if (await open(url)) break;
  }
  return { page: best, ref };
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
async function scanTag(d, file) {
  d.scanningTag = true;
  d.labelStep = "Reading the label…";
  const step = (s) => { d.labelStep = s; rerenderAdd(d); };
  rerenderAdd(d);
  const fresh = !d.photos.length;
  try {
    const [qr, tag] = await Promise.all([
      readQR(file).catch(() => ""),
      aiReady() ? readTagText(file).catch((e) => ({ error: e.message })) : null,
    ]);
    if (tag?.error && !qr) throw new Error(tag.error);
    const r = tag?.error ? null : tag;
    let found = { page: null, ref: Label.refFrom(r?.reference) };
    try { found = await findProduct(qr, r, step); } catch (e) { if (e.noServer) toast(e.message); }
    const page = found.page;
    const title = Label.cleanTitle(page?.title, r?.brand || page?.brand || "");
    const words = Label.toEnglish(title);
    const about = `${words} ${Label.toEnglish(page?.description)}`;
    // What the label says comes first, then the product page.
    const said = (r?.brand || page?.brand || (Label.isPullBear(page?.url || Label.linkIn(qr)) ? "Pull&Bear" : "")).trim();
    const brand = brandInfo(said)?.name || said; // "PULL&BEAR" on the tag → "Pull&Bear"
    if (brand && !d.brand) d.brand = brand;
    if (!d.name && (title || r?.name)) d.name = cap((title || r.name).trim());
    const kind = BUY_KINDS.find(([re]) => re.test(words)) || BUY_KINDS.find(([re]) => re.test(about));
    const cat = CAT[r?.category] ? r.category : kind?.[1];
    if (cat && !d.category) { d.category = cat; d.warmth = CAT[cat].warmth; }
    const fit = Label.fitIn(about);
    if (fit && !d.fit) d.fit = fitsFor(d).includes(fit) ? fit : fit === "baggy" && fitsFor(d).includes("oversized") ? "oversized" : fit === "oversized" && fitsFor(d).includes("baggy") ? "baggy" : "";
    const price = r?.price > 0 ? r.price : parseFloat(String(page?.price || "").replace(",", "."));
    if (price > 0) { d.price = String(price); d.currency = ((r?.price > 0 ? r.currency : page.price.split(" ")[1]) || "").toUpperCase(); }
    if (r?.size) d.size = r.size.trim();
    if (r?.material) d.material = r.material.trim();
    if (page?.url) d.link = page.url;
    if (found.ref) d.reference = found.ref.text;
    const colour = wardrobeColour(r?.color || page?.color || title, d.category);
    // The page's photo is in the shop's first colour, which may not be the one on the label.
    const sameColour = Label.photoColourMatches(page?.image, found.ref);
    if (colour && (fresh || !d.colors.length)) d.colors = [colour];
    refreshStyles();
    if (d.brand) lookupBrand(d.brand).then((learnt) => learnt && (refreshStyles(), rerenderAdd(d)));
    if (fresh && page?.image) {
      step("Getting the shop's photo…");
      const blob = await productPhoto(page.image);
      if (blob && draft === d) {
        const p = { ...newPhoto(blob), manual: true, shop: true }; // shop photos are already upright
        d.photos = [p];
        d.active = 0;
        d.shopPhoto = { site: page.site || "", otherColour: sameColour === false };
        d.keepColors = !!colour; // the label's colour wins over the colours in the photo
        if (!colour) d.colors = await detectColors(blob).catch(() => []);
        d.scanningTag = false;
        preparePhoto(p, d);
      }
    }
    if (draft === d) {
      const what = [d.name || d.brand, page?.site && `from ${page.site}`].filter(Boolean).join(" ");
      toast(page ? `Found ${what}` : r || qr ? `Read the label${fresh ? ". No product page found, so take a photo of the piece" : ""}` : aiReady() ? "Nothing readable on that label" : "No QR code found. Add a Gemini key in Settings to read the printed text too.");
    }
  } catch (err) {
    if (draft === d) toast(err.message || "Couldn't read the label");
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
    aiChecked: existing?.aiChecked || d.photos.some((p) => p.aiChecked) || undefined,
  };
  await store.put("items", item);
  if (existing) Object.assign(existing, item); else state.items.push(item);
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
function mkIdea({ cat, color = "", noun = "", brand = "", fit = "", title = "", why = "", styles }) {
  const words = [brand, color, fit ? FITS[fit]?.label.toLowerCase() : "", noun || catLabel(cat).toLowerCase()].filter(Boolean).join(" ");
  return { cat, color, brand, fit, styles, title: title || cap(words), query: title ? [brand, title].filter(Boolean).join(" ") : words, why };
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

// The versions of a "Worth adding" idea, the one that goes with most of your pieces first.
function variantsOf(s) {
  if (!s.cat) return [{ ...s, cat: buyKind(s.title).cat, n: goesWith(s.title).length }];
  return s.colors.map((color, i) => {
    const b = mkIdea({ cat: s.cat, color, noun: s.noun, why: s.why });
    const piece = asPiece(b);
    const fit = wornWith(piece).reduce((a, o) => a + pairScore(piece, o), 0);
    return { ...b, n: matchesFor(piece).length, fit, i };
  }).sort((a, b) => b.fit - a.fit || a.i - b.i);
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
  const tabs = [["foryou", "For you"], ["try", "Try a piece"], ["trip", "Shop trip"], ["look", "New look"]];
  const sub = {
    foryou: "What your wardrobe is missing, in a few versions each.",
    try: "Thinking of buying something? See what it goes with first.",
    trip: "Going to a mall or a shop? See only what you can buy there.",
    look: "A complete outfit of new pieces for the season, style and occasion you pick.",
  }[d.tab];
  main.innerHTML = `
    <div class="head"><div><h1>Discover</h1><p class="sub">${sub}</p></div></div>
    <div class="chips disc-tabs" role="tablist">${tabs.map(([k, l]) => `<button class="chip" role="tab" aria-selected="${d.tab === k}" aria-pressed="${d.tab === k}" data-disc="${k}">${l}</button>`).join("")}</div>
    ${state.trip && d.tab !== "trip" ? tripBar() : ""}
    <div class="stack">${({ foryou: forYouTab, try: tryTab, trip: tripTab, look: lookTab })[d.tab]()}</div>`;
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
    <div class="shops">${shops.slice(0, state.trip ? 8 : 4).map(([n, u]) => `<a class="btn" href="${u}" target="_blank" rel="noopener">${esc(n)}</a>`).join("")}${realBtn(b)}${wishBtn(b)}</div>
    ${photosHTML(b)}
  </div>`;
}

/* ---- For you ---- */
function forYouTab() {
  const a = analyse();
  const total = state.items.length || 1;
  const palette = Object.entries(a.colorCount).sort((x, y) => y[1] - x[1]);
  const styleMix = Object.entries(a.styleCount).sort((x, y) => y[1] - x[1]);
  const brands = Object.entries(a.brandCount).sort((x, y) => y[1] - x[1]);
  const tiers = {};
  for (const i of state.items) { const t = brandInfo(i.brand)?.tier; if (t) tiers[t] = (tiers[t] || 0) + 1; }
  const blocks = a.suggestions.map((s, k) => ({ s, k, options: variantsOf(s).filter(soldHere) })).filter((x) => x.options.length);
  const notHere = a.suggestions.length - blocks.length;
  const wish = state.wishlist.map((w, k) => [w, k]).filter(([w]) => soldHere(w));
  return `
    <section class="card">
      <h2>Worth adding</h2>
      <div class="sugg">${blocks.map(({ s, k, options }) => ideaBlock(`s${k}:${s.title}`, {
        label: s.prio === "high" ? "Fills a gap" : s.prio === "medium" ? "Adds range" : "Nice to have", title: s.title, why: s.why, options,
      })).join("") || `<p class="muted">${a.suggestions.length ? `None of these ideas are sold at ${esc(state.trip?.name)}.` : "Your wardrobe looks well balanced."}</p>`}</div>
      ${notHere && blocks.length ? `<p class="muted small" style="margin:12px 0 0">${notHere} more idea${notHere > 1 ? "s aren't" : " isn't"} sold at ${esc(state.trip.name)}.</p>` : ""}
    </section>
    ${wish.length ? `<section class="card"><h2>Wishlist</h2><div class="sugg">${wish.map(([w, k]) => buyRow({ ...w, with: goesWith(w.title) }, {
      label: "", shops: 2, extra: `<button class="btn ghost" data-unwish="${k}">Remove</button>`,
    })).join("")}</div></section>` : ""}
    <div class="stats">
      <div class="stat"><b>${state.items.length}</b><span>pieces</span></div>
      <div class="stat"><b>${brands.length}</b><span>brands</span></div>
      <div class="stat"><b>${a.unworn.length}</b><span>never worn</span></div>
      <div class="stat"><b>${styleMix[0] ? styleLabel(styleMix[0][0]) : "–"}</b><span>main style</span></div>
      ${(() => {
        const priced = state.items.filter((i) => i.price);
        if (!priced.length) return "";
        const cur = priced[0].currency, same = priced.every((i) => i.currency === cur);
        return same ? `<div class="stat"><b>${fmtPrice(priced.reduce((a, i) => a + i.price, 0), cur)}</b><span>value of ${priced.length} priced piece${priced.length === 1 ? "" : "s"}</span></div>` : "";
      })()}
    </div>
    <div class="two-col">
      <section class="card">
        <h2>Your style</h2>
        <div class="stack" style="gap:12px">
          ${styleMix.length ? styleMix.map(([s, n]) => `<button class="style-row" data-stylego="${esc(s)}"><span>${styleLabel(s)}</span><span class="muted">${Math.round((n / total) * 100)}%</span><span class="bar"><i style="width:${(n / total) * 100}%"></i></span></button>`).join("") : `<p class="muted">Add pieces to see your style mix.</p>`}
        </div>
      </section>
      <section class="card">
        <h2>Brands</h2>
        ${brands.length ? `<div class="chips">${brands.map(([b, n]) => { const t = brandInfo(b)?.tier; return `<button class="chip" data-brandgo="${esc(b)}">${esc(b)}${n > 1 ? ` <span class="muted">×${n}</span>` : ""}${t ? ` <span class="tier">${t}</span>` : ""}</button>`; }).join("")}</div>` : `<p class="muted">No brands recorded yet.</p>`}
        ${Object.keys(tiers).length ? `<p class="muted small" style="margin:14px 0 0">${Object.entries(tiers).map(([t, n]) => `${n} ${t}`).join(" · ")}</p>` : ""}
        ${palette.length ? `<h2 style="margin-top:22px">Palette</h2><div class="chips">${palette.map(([c, n]) => `<span class="chip"><span class="dot" style="background:${COLORS[c]?.hex}"></span>${cap(c)} ${Math.round((n / total) * 100)}%</span>`).join("")}</div>` : ""}
      </section>
    </div>
    <section class="card">
      <h2>Balance</h2>
      <div class="stack" style="gap:14px">
        ${Object.entries(SLOTS).filter(([k]) => SLOT_TARGET[k]).map(([k, l]) => {
          const n = a.bySlot[k].length, t = SLOT_TARGET[k];
          return `<div><div class="row" style="justify-content:space-between"><span>${l}</span><span class="muted">${n} / ${t} suggested</span></div><div class="bar"><i style="width:${Math.min(100, (n / t) * 100)}%;${n === 0 ? "background:var(--warn);width:4%" : ""}"></i></div></div>`;
        }).join("")}
      </div>
    </section>
    ${a.unworn.length || a.stale.length ? `<section class="card"><h2>Forgotten pieces</h2><p class="muted small" style="margin-top:-6px">Wear them, or think about selling or donating.</p><div class="grid">${[...a.unworn, ...a.stale].slice(0, 8).map(itemTile).join("")}</div></section>` : ""}
    <section class="card ai-box">
      <h2 style="margin:0">Personal shopping advice</h2>
      <p class="muted small" style="margin:0">${aiReady() ? `${aiName()} looks at your whole wardrobe and suggests the next few buys.` : "Add a Gemini or Claude API key in Settings for tailored shopping advice."}</p>
      <div class="row"><button class="btn primary" data-ask="${esc(SHOP_QUESTION)}">What should I buy next?</button></div>
      <div class="ai-answer" id="ai-answer">${answerHTML(state.aiAnswer)}</div>
    </section>`;
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
  const blocks = tr ? a.suggestions.map((s, k) => ({ s, k, options: variantsOf(s).filter(soldHere) })).filter((x) => x.options.length) : [];
  const wish = tr ? state.wishlist.map((w, k) => [w, k]).filter(([w]) => soldHere(w)) : [];
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
    ${wish.length ? `<section class="card"><h2>From your wishlist</h2><div class="sugg">${wish.map(([w, k]) => buyRow({ ...w, with: goesWith(w.title) }, { label: "", extra: `<button class="btn ghost" data-unwish="${k}">Remove</button>` })).join("")}</div></section>` : ""}` : ""}`;
}

/* ---- New look ---- */
const SEASONS = { spring: { label: "Spring", feels: 16 }, summer: { label: "Summer", feels: 27 }, autumn: { label: "Autumn", feels: 12 }, winter: { label: "Winter", feels: 3 } };
function seasonNow() {
  const m = new Date().getMonth(), south = (state.settings.lat ?? 45) < 0;
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
      text: `For ${shopperText()}. Season: ${SEASONS[season].label}. Style: ${styleLabel(style)}. Occasion: ${occ.label}.` +
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
async function pageInfo(url) {
  try {
    const r = await fetch(`api/page?url=${encodeURIComponent(url)}`, AbortSignal.timeout ? { signal: AbortSignal.timeout(12000) } : {});
    if (r.status === 404 && !(r.headers.get("Content-Type") || "").includes("json")) return { noServer: true };
    return r.ok ? await r.json() : null;
  } catch { return null; }
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
          const n = state.cal.events.filter((e) => e.cal === l.url).length;
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
        ${toggle("autoWash", "Into the wash after one wear", "T-shirts, shirts, underwear, socks and gym clothes go in the wash when you log wearing them, with an Undo. Anything else you mark from its page.")}
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
        ${aiReady() && noFit ? `<div class="row"><button class="btn" data-act="fit-all">Find the fit of ${noFit} piece${noFit > 1 ? "s" : ""}</button><span class="muted small">About 300 tokens per piece. You can also tap the fit on any piece.</span></div>` : ""}
        <p class="muted small" style="margin:0">This month: ${u.requests} AI request${u.requests === 1 ? "" : "s"} · ${(u.input + u.output).toLocaleString()} tokens (${u.input.toLocaleString()} in, ${u.output.toLocaleString()} out)</p>
      </section>
      <section class="card stack">
        <h2 style="margin:0">Fashion bible</h2>
        ${(() => {
          const b = Style.bible();
          if (!b) return `<p class="muted small" style="margin:0">Not loaded yet, so outfit ideas use the app's basic rules. It downloads by itself when the app is online.</p>`;
          const n = b.model.trained_on.sources, acc = b.model.accuracy?.unseen;
          return `<p class="muted small" style="margin:0">The stylist must follow the fashion bible: ${b.rules.length} checked rules and ${b.tips.length} tips${n ? ` learnt from ${n} magazine, article and video sources` : ""}${acc != null ? `, right on ${Math.round(acc * 100)}% of example outfits it hadn't seen` : ""}. Outfit ideas that break an important rule only appear when nothing else is left, and every question to the AI stylist carries the rules and the tips that fit it. Updated ${esc(String(b.built_at).slice(0, 10))}.</p>`;
        })()}
      </section>
      <section class="card stack">
        <h2 style="margin:0">Look</h2>
        <div class="chips">${[["auto", "Match system"], ["dark", "Dark"], ["light", "Light"]].map(([k, l]) => `<button class="chip" aria-pressed="${s.theme === k}" data-theme="${k}">${l}</button>`).join("")}</div>
        <div class="field"><label>Shops</label><div class="chips">${[["it", "Italy"], ["com", "International"]].map(([k, l]) => `<button class="chip" aria-pressed="${s.region === k}" data-region="${k}">${l}</button>`).join("")}</div></div>
        <div class="field"><label>Shop for</label><div class="chips">${[["men", "Men"], ["women", "Women"]].map(([k, l]) => `<button class="chip" aria-pressed="${s.gender === k}" data-gender="${k}">${l}</button>`).join("")}</div><span class="muted small">Shopping ideas, shop links, product photos and new looks are for ${s.gender === "women" ? "women" : "men"}.</span></div>
        <div class="field"><label>Product photos</label><span class="muted small">${productsOn()
          ? "On: Discover shows real products from Google Shopping (through SerpApi, saved on your server). Each search is kept for two weeks, so the free 250 searches a month go a long way."
          : state.serverKeys.products ? `Paused: ${esc(productsDown)} Discover shows drawings until it works again.`
          : "Off: Discover shows drawings. For real product photos, add a free SerpApi key to the Worker as the SERPAPI_KEY secret (see the README, “Product photos”)."}</span></div>
      </section>
      <section class="card stack">
        <h2 style="margin:0">Data</h2>
        <div class="row">
          <button class="btn" data-act="seed">Load sample wardrobe</button>
          <button class="btn" data-act="export">Export backup</button>
          <button class="btn" data-act="import">Import backup</button>
          ${state.log.some((l) => logKind(l) !== "wear") ? `<button class="btn" data-act="forget-taste">Forget likes and skips</button>` : ""}
          <button class="btn ghost danger" data-act="wipe">Erase everything</button>
        </div>
        <p class="muted small" style="margin:0">${syncLine()}</p>
      </section>
    </div>`;
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
      const cuts = [], originals = [];
      for (const p of it.photos) {
        const cut = (await removeBackground(p)).blob;
        const rot = await uprightAngle(cut, kindOf(it.category));
        cuts.push(await rotateImage(cut, rot, true));
        originals.push(await rotateImage(p, rot, false));
      }
      it.originals = originals;
      it.photos = cuts;
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
      }
      const st = (r.styles || []).filter((s) => STYLES[s]);
      if (st.length) { it.styles = st.slice(0, 3); it.formality = formalityOf(it.styles); }
      if (!it.fit && fitsFor(it).includes(r.fit)) it.fit = r.fit;
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
  const blob = new Blob([JSON.stringify({ version: 2, exportedAt: new Date().toISOString(), items, log: state.log, wishlist: state.wishlist, calendar: state.calendar })], { type: "application/json" });
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
      for (const l of data.log || []) { delete l.id; await store.put("log", l); }
      if (data.wishlist) { state.wishlist = data.wishlist; await saveWishlist(); }
      if (data.calendar?.links) { state.calendar = data.calendar; await saveCalendar(); state.cal.at = 0; }
      await loadAll();
      state.outfits = [];
      toast(`Imported ${data.items?.length || 0} pieces`);
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
    const context = `The user is ${shopperText()}.\n${state.event?.day === "tomorrow" ? "Tomorrow" : "Today"}: feels ${Math.round(c.feels)}°C${c.wet ? ", wet" : ""}. Occasion: ${OCCASIONS.find((o) => o.id === state.occasion).label}.${cal ? `\n${cal}` : ""}\nWardrobe (#number name; type; colours; brand; style; fit; warmth 1-5; wear):\n${wardrobeText() || "(empty)"}${likes ? `\nTaste (learnt from what the user wears, likes and skips):\n${likes}` : ""}`;
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
  if (ds.orig) return openItem(ds.orig, ds.show === "1");
  if (ds.occ) { state.occasion = ds.occ; state.occChosen = localDay(); state.event = null; generateOutfits(); return render(); }
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
  if (ds.rmphoto && draft) {
    draft.photos.splice(+ds.rmphoto, 1);
    draft.active = 0;
    if (!draft.photos.length && !draft.id) draft = null;
    return render();
  }
  if (ds.toggle) { state.settings[ds.toggle] = !state.settings[ds.toggle]; await saveSettings(); return render(); }
  if (ds.provider) { state.settings.aiProvider = ds.provider; await saveSettings(); return render(); }
  if (ds.like != null) {
    const o = state.outfits[+ds.like];
    if (o.likedId) { await dropLog(o.likedId); o.likedId = null; }
    else { o.likedId = (await addLog({ kind: "like", itemIds: Object.values(o.pieces).filter(Boolean).map((p) => p.id), ...outfitContext(), source: "idea" })).id; toast("Liked. More ideas like this one."); }
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
    const washed = await wearOutfit([...Object.values(o.pieces), ...(o.extras || [])].filter(Boolean), { source: o.planned ? "plan" : "idea" });
    if (o.planned) { state.plan = null; await savePlan(); }
    state.anchor = null;
    wornToast("Logged. Enjoy your day!", washed);
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
  if (ds.setfit) {
    const [id, fit] = ds.setfit.split(":");
    const it = state.items.find((i) => i.id === id);
    it.fit = it.fit === fit ? "" : fit;
    await store.put("items", it);
    state.outfits = [];
    openItem(it.id);
    return render();
  }
  if (ds.fav) {
    const it = state.items.find((i) => i.id === ds.fav);
    it.favorite = !it.favorite;
    await store.put("items", it);
    openItem(it.id);
    return render();
  }
  if (ds.edit) {
    const it = state.items.find((i) => i.id === ds.edit);
    draft = {
      ...newDraft(), ...it,
      photos: (it.photos || []).map((p, k) => (it.originals?.[k] ? { ...newPhoto(it.originals[k]), cutSrc: p, cut: p, useCut: true, manual: true } : { ...newPhoto(p), manual: true })),
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
  if (ds.disc) { state.disc.tab = ds.disc; render(); main.scrollTop = 0; return; }
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
  if (ds.wishbuy) {
    const w = JSON.parse(ds.wishbuy);
    if (!state.wishlist.some((x) => x.title === w.title)) { state.wishlist.push(w); await saveWishlist(); toast("Saved to wishlist"); }
    t.textContent = "♥ Saved";
    if (view === "shop") render();
    return;
  }
  if (ds.unwish != null) { state.wishlist.splice(+ds.unwish, 1); await saveWishlist(); return render(); }
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
    case "seed": return loadSeed();
    case "shuffle": generateOutfits(3, state.outfits.map((o) => o.key)); return render();
    case "autotemp": e.preventDefault(); state.manualTemp = null; generateOutfits(); return render();
    case "shoot": addingExtraPhoto = false; return startShooting();
    case "shoot-done": { const shots = pendingShots; pendingShots = []; return startDraft(shots); }
    case "gallery": addingExtraPhoto = false; return galInput.click();
    case "more-photo": addingExtraPhoto = true; return galInput.click();
    case "cutout": return preparePhoto(draft.photos[draft.active], draft, true);
    case "rotate": {
      const d = draft, p = d.photos[d.active];
      p.rot = (p.rot + 90) % 360;
      p.manual = true;
      await applyRotation(p);
      return rerenderAdd(d);
    }
    case "cancel-add": draft = null; queue = []; pendingShots = []; return go(state.items.length ? "wardrobe" : "today");
    case "save": return saveDraft(false);
    case "save-next": return saveDraft(true);
    case "ai-tag": return recognise(draft);
    case "scan-tag": case "scan-label": return tagInput.click();
    case "label-shoot": addingExtraPhoto = true; return camInput.click();
    case "cut-all": return cutAll();
    case "recognise-all": return recogniseAll();
    case "fit-all": return fitAll();
    case "anchor-pick": return openAnchorPicker();
    case "see-wash": Object.assign(state.filters, { slot: "wash", cat: "all", q: "", style: "all", color: "all" }); return go("wardrobe");
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
    case "forget-taste": {
      const learnt = state.log.filter((l) => logKind(l) !== "wear");
      if (!(await confirmBox(`Forget ${learnt.length} likes and skips? What you wore stays.`, "Forget them"))) return render();
      for (const l of learnt) await dropLog(l.id);
      state.outfits = [];
      toast("Likes and skips forgotten");
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
      if (!(await confirmBox(sync.status === "on" ? "Erase all clothes, photos and history? Every device sharing this wardrobe loses them too." : "Erase all clothes, photos and history from this device?", "Erase everything"))) return;
      await store.clear("items"); await store.clear("log");
      state.items = []; state.log = []; state.outfits = [];
      toast("Wardrobe erased");
      return render();
  }
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
  if (k === "trytext" || k === "trybrand") { state.disc.try[k === "trytext" ? "text" : "brand"] = v; return; }
  if (k === "tripq") { state.disc.tripq = v; return; }
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
