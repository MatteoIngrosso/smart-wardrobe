// Garment baker: turns a wardrobe piece's front and back cut-out photos into the textures the 3D
// mirror dresses the avatar with (a BakedGarmentAsset, see avatar-config.js), once per piece.
// Everything runs on the device with canvas and typed arrays: no network, no AI. Baked pieces are
// kept in IndexedDB ("wardrobe-garments" / "baked") and in memory, so wearing one again costs nothing.
//
//   1. Auto-crop and de-fringe: the garment's mask (alpha, or the background flooded in from the
//      border for photos on white), small specks dropped, 2 px eroded, tight box.
//   2. Torso core: for tops the torso without sleeves or hood; bottoms whole; shoes levelled, cropped
//      and turned so the toe points right.
//   3. Fabric: the room's light taken off the panels (retinex: the fabric's own colour, blurred, is
//      the light; prints are left out of it and keep their contrast), then the dominant colour of the
//      core, the trim (ribbing, sole), and a seamless 256 px tile of the fabric's own grain.
//   4. Panels: the core, sharp and never mirrored, with every background pixel or hole inpainted with
//      the fabric (pull-push fill plus grain) and the edge feathered: fully opaque, no cut-out edge.
//      The last 24 px all round fade into the plain fabric (cosine), so no rectangle can show where
//      the panel meets the stage's fabric.
//   5. Normal map (Sobel of the panel's luminance, subtle) and roughness map, front and back side by side.
import { subTypeOf, lengthOf, PANEL_SIZE } from "./avatar-config.js";

/** Raise it when the bake changes, so every piece is baked again. */
export const BAKER_VERSION = 3;

const DB_NAME = "wardrobe-garments", STORE = "baked";
const SLOT_OF = { tee: "top", hoodie: "layer", sweater: "layer", bomber: "jacket", jacket_open: "jacket", jeans: "bottoms", cargo: "bottoms", sneakers: "shoes", boots: "shoes" };
const KIND_OF = { tee: "top", hoodie: "top", sweater: "top", bomber: "top", jacket_open: "top", jeans: "bottoms", cargo: "bottoms", sneakers: "shoes", boots: "shoes" };
const WORK_MAX = 1400; // photos are decoded at most this big
const TILE = 256; // the seamless fabric tile
// How wide the front panel is on the body, roughly: for the fabric tile's real size.
const PANEL_CM = { top: 54, bottoms: 60, shoes: 30 };
const FEATHER = 24; // px of the panel's border that fade into the plain fabric

/* ======================================================================
   Public API
   ====================================================================== */

/**
 * Bake one piece. Pure: Blobs in, asset out (no cache). Null when the piece isn't drawn on the
 * mirror (accessories…) or has no front photo.
 * @param {{id:string, name?:string, category:string, fit?:string, colors?:string[]}} item
 * @param {{front?:Blob|null, back?:Blob|null}} photos
 * @param {{sig?:string, debug?:boolean}} [opts]
 * @returns {Promise<import("./avatar-config.js").BakedGarmentAsset|null>}
 */
export async function bakeGarment(item, { front, back } = {}, opts = {}) {
  const sub = subTypeOf(item);
  if (!sub || !front) return null;
  const kind = KIND_OF[sub];
  const t0 = now();
  const debug = opts.debug ? { steps: {} } : null;
  const mark = (k) => { if (debug) debug.steps[k] = Math.round(now() - t0); };

  // 1-2. Masks and the part of each photo that becomes a panel.
  const fa = await analysePhoto(front, kind);
  mark("front");
  await yieldNow();
  let ba = back ? await analysePhoto(back, kind).catch(() => null) : null;
  // a second shoe photo that is no side view even levelled (a boot shot from above, on its toe: taller
  // than long) would draw a tilted shoe: the front photo does both sides then
  if (ba && kind === "shoes" && ba.box.y1 - ba.box.y0 > (ba.box.x1 - ba.box.x0) * 1.1) ba = null;
  mark("back");
  await yieldNow();

  // The panels' pixels (before filling), at panel size.
  const [PW, PH] = PANEL_SIZE[kind];
  const fp = cropPanel(fa, PW, PH);
  await yieldNow();
  const bp = ba ? cropPanel(ba, PW, PH) : null;
  mark("crop");
  await yieldNow();

  // 3. The room's light off the panels (not shoes: their shading is their shape), then the fabric
  // colours from both sides' cores and the grain tile from a plain patch, all from the even panels.
  const panels = [fp, bp].filter(Boolean);
  // Shoes with white parts: the photo's exposure, from those whites (white leather in the room's light
  // reads light grey); the panels and the sole are brightened alike.
  let expo = 1;
  if (kind === "shoes") {
    const refs = [fa, ba].filter((a) => a && a.white && a.white.frac >= 0.08).map((a) => a.white.L);
    if (refs.length) expo = Math.max(1, Math.min(1.6, yOfL(94) / yOfL(median(refs))));
    if (expo > 1) for (const p of panels) brighten(p.rgb, expo);
  }
  let fabric = fabricColours(panels, kind);
  let light = null;
  if (kind !== "shoes") {
    await yieldNow();
    light = await delight(panels, fabric, kind);
    await yieldNow();
    fabric = fabricColours(panels, kind);
  }
  await yieldNow();
  const tile = fabricTile(panels, fabric, kind);
  mark("fabric");
  await yieldNow();

  // 4. Fill, feather, grain: opaque panels.
  const edge = (rgb) => (kind === "shoes" ? rgb : featherEdge(rgb, PW, PH, fabric, tile)); // shoes: the sole runs along the edge
  const frontRGB = edge(await finishPanel(fp, fabric, tile));
  await yieldNow();
  let backRGB;
  if (bp) backRGB = edge(await finishPanel(bp, fabric, tile));
  else if (kind === "top") backRGB = plainPanel(PW, PH, fabric, tile);
  else backRGB = kind === "bottoms" ? mirrored(frontRGB, PW, PH) : frontRGB.slice(); // shoes: the same side again
  mark("panels");
  await yieldNow();

  // 5. Normals and roughness, front and back side by side at half size.
  const roughness = roughnessOf(item, sub);
  const fH = half(frontRGB, PW, PH), bH = half(backRGB, PW, PH);
  const normalMap = await encodePair(PW >> 1, PH >> 1, (rgb, w, h) => normalsOf(rgb, w, h), fH, bH, "image/png");
  await yieldNow();
  const roughnessMap = await encodePair(PW >> 1, PH >> 1, (rgb, w, h) => roughnessOfPanel(rgb, w, h, fabric, roughness), fH, bH, "image/jpeg", 0.85);
  mark("maps");
  await yieldNow();

  const asset = {
    garmentId: String(item.id),
    slot: SLOT_OF[sub],
    garmentSubType: sub,
    frontChestUV: await encodeRGB(frontRGB, PW, PH, "image/jpeg", 0.9),
    backPanelUV: await encodeRGB(backRGB, PW, PH, "image/jpeg", 0.9),
    fabricBaseColor: hexOf(fabric.rgb),
    normalMap,
    updatedAt: Date.now(),
    sig: opts.sig || (await photoSig(front, back)),
    fabricTile: await encodeRGB(tile.rgb, TILE, TILE, "image/jpeg", 0.9),
    fabricNormal: await encodeRGBA(normalsRGBA(tile.height, TILE, TILE, 2.2, true), TILE, TILE, "image/png"),
    fabricTileCm: Math.round((tile.size / PW) * PANEL_CM[kind] * 10) / 10,
    roughnessMap,
    roughness,
    fit: item.fit || undefined,
    length: lengthOf(item),
    hasBack: !!bp,
  };
  if (kind === "bottoms") { const c = crotchOf(fp); if (c) asset.crotchV = c; }
  if (fabric.trim) asset.trimColor = hexOf(fabric.trim);
  if (fabric.second) asset.secondaryColor = hexOf(fabric.second);
  if (kind === "shoes") {
    asset.toeLeft = !!fa.toeLeft;
    // the outline of each levelled photo (heel to toe): the stage builds the 3D shoe from it
    asset.shoeProfile = shoeProfileOf(fa);
    if (ba) { asset.backToeLeft = !!ba.toeLeft; asset.shoeProfileBack = shoeProfileOf(ba); }
    const sole = dominantRGB([...(fa.sole || []), ...((ba && ba.sole) || [])]);
    if (sole) { if (expo > 1) brighten(sole, expo); asset.soleColor = hexOf(sole); }
    asset.shoeStyle = shoeStyleOf(item);
  }
  for (const k of Object.keys(asset)) if (asset[k] === undefined) delete asset[k];
  mark("encode");
  if (debug) {
    debug.ms = Math.round(now() - t0);
    // what the baker saw (the working photo, levelled for shoes, and its mask), to draw overlays
    const seen = (a) => ({ w: a.w, h: a.h, box: a.box, core: a.core, how: a.how, angle: a.angle, toeLeft: a.toeLeft, fromAlpha: a.fromAlpha, stats: a.stats, peeled: a.peeled, peelInfo: a.peelInfo, data: a.data, mask: a.mask });
    debug.front = seen(fa);
    if (ba) debug.back = seen(ba);
    if (light) debug.light = light;
    if (kind === "shoes") debug.shoe = { expo: +expo.toFixed(3), white: [fa.white, ba && ba.white] };
    debug.fabric = { base: hexOf(fabric.rgb), trim: fabric.trim && hexOf(fabric.trim), second: fabric.second && hexOf(fabric.second), tile: tile.size, tileFrom: tile.from };
    asset.debug = debug;
  }
  return asset;
}

const mem = new Map(); // garmentId → asset
const inflight = new Map(); // garmentId|sig → Promise

/**
 * The baked piece, from memory or IndexedDB when its photos haven't changed, else baked now (one
 * bake at a time) and kept. Null when the piece isn't drawn on the mirror or can't be read.
 */
export async function getBaked(item, { front, back } = {}) {
  const sub = subTypeOf(item);
  if (!item?.id || !front || !sub) return null;
  const id = String(item.id);
  const sig = await photoSig(front, back);
  const fresh = (a) => a && a.sig === sig && a.garmentSubType === sub; // the sig carries BAKER_VERSION
  const m = mem.get(id);
  if (fresh(m)) return withItem(m, item);
  const key = `${id}|${sig}`;
  if (inflight.has(key)) return inflight.get(key);
  const job = (async () => {
    const stored = await idbGet(id).catch(() => null);
    if (fresh(stored)) { mem.set(id, stored); return withItem(stored, item); }
    const asset = await queued(() => bakeGarment(item, { front, back }, { sig })).catch((e) => {
      console.warn("Garment baker:", item.name || id, e);
      return null;
    });
    if (asset) { mem.set(id, asset); idbPut(asset).catch(() => {}); }
    return asset;
  })().finally(() => inflight.delete(key));
  inflight.set(key, job);
  return job;
}
// The fit and length are the item's, not the photo's: follow edits without baking again.
function withItem(a, item) {
  const fit = item.fit || undefined, length = lengthOf(item);
  if (a.fit === fit && a.length === length) return a;
  const b = { ...a, fit, length };
  if (!fit) delete b.fit;
  mem.set(b.garmentId, b);
  idbPut(b).catch(() => {});
  return b;
}

/** A baked piece without checking its photos: memory first, then IndexedDB. Null if never baked. */
export async function peekBaked(garmentId) {
  const id = String(garmentId);
  if (mem.has(id)) return mem.get(id);
  const a = await idbGet(id).catch(() => null);
  if (a) mem.set(id, a);
  return a || null;
}
/** The baked piece if it's already in memory (instant), else null. */
export const bakedNow = (garmentId) => mem.get(String(garmentId)) || null;

/** Forget every baked piece (memory and IndexedDB): they bake again when next worn. */
export async function clearBaked() {
  mem.clear();
  await idbDo("readwrite", (s) => s.clear()).catch(() => {});
}
/** How many pieces are baked on this device. */
export async function countBaked() {
  const n = await idbDo("readonly", (s) => s.count()).catch(() => null);
  return n ?? mem.size;
}

const sigCache = new WeakMap();
/** A cheap signature of the photos: sizes and a sampled hash of their bytes, plus BAKER_VERSION. */
export async function photoSig(front, back) {
  const one = async (b) => {
    if (!b) return "-";
    if (sigCache.has(b)) return sigCache.get(b);
    const head = new Uint8Array(await b.slice(0, 16384).arrayBuffer());
    const tail = new Uint8Array(await b.slice(Math.max(0, b.size - 16384)).arrayBuffer());
    let h = 0x811c9dc5;
    for (const part of [head, tail]) for (let i = 0; i < part.length; i += 3) h = Math.imul(h ^ part[i], 16777619) >>> 0;
    const s = `${b.size.toString(36)}.${h.toString(36)}`;
    sigCache.set(b, s);
    return s;
  };
  return `v${BAKER_VERSION}:${await one(front)}:${await one(back)}`;
}

/* ---------- one bake at a time ---------- */
let chain = Promise.resolve();
function queued(fn) {
  const p = chain.then(fn, fn);
  chain = p.catch(() => {});
  return p;
}
const now = () => (globalThis.performance ? performance.now() : Date.now());
const yieldNow = () => (globalThis.scheduler?.yield ? globalThis.scheduler.yield() : new Promise((r) => setTimeout(r, 0)));

/* ---------- IndexedDB ---------- */
let dbp = null;
function db() {
  if (!globalThis.indexedDB) return Promise.reject(new Error("No IndexedDB"));
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "garmentId" }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => { dbp = null; rej(r.error); };
    r.onblocked = () => { dbp = null; rej(new Error("IndexedDB blocked")); };
  }));
}
async function idbDo(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const tx = d.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => res(req?.result);
    tx.onerror = () => rej(tx.error);
    tx.onabort = () => rej(tx.error);
  });
}
const idbGet = (id) => idbDo("readonly", (s) => s.get(id));
const idbPut = (a) => idbDo("readwrite", (s) => s.put(stripDebug(a)));
const stripDebug = (a) => { if (!a.debug) return a; const { debug, ...rest } = a; return rest; };

/* ======================================================================
   Canvas helpers (OffscreenCanvas when it works, else a document canvas)
   ====================================================================== */
const OFFSCREEN = (() => {
  try { return typeof OffscreenCanvas !== "undefined" && !!new OffscreenCanvas(1, 1).getContext("2d"); } catch { return false; }
})();
function newCanvas(w, h) {
  if (OFFSCREEN) return new OffscreenCanvas(w, h);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return c;
}
const ctx2d = (c) => c.getContext("2d", { willReadFrequently: true });
function encode(c, type, quality) {
  if (c.convertToBlob) return c.convertToBlob({ type, quality });
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't encode"))), type, quality));
}
function encodeRGBA(rgba, w, h, type, quality) {
  const c = newCanvas(w, h);
  ctx2d(c).putImageData(new ImageData(rgba, w, h), 0, 0);
  return encode(c, type, quality);
}
function encodeRGB(rgb, w, h, type, quality) {
  const n = w * h, out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) { out[i * 4] = rgb[i * 3]; out[i * 4 + 1] = rgb[i * 3 + 1]; out[i * 4 + 2] = rgb[i * 3 + 2]; out[i * 4 + 3] = 255; }
  return encodeRGBA(out, w, h, type, quality);
}
// Front and back maps side by side (each made from the panel at half size).
async function encodePair(w, h, make, frontHalf, backHalf, type, quality) {
  const a = make(frontHalf, w, h), b = make(backHalf, w, h);
  const out = new Uint8ClampedArray(w * 2 * h * 4);
  for (let y = 0; y < h; y++) {
    out.set(a.subarray(y * w * 4, (y + 1) * w * 4), y * w * 8);
    out.set(b.subarray(y * w * 4, (y + 1) * w * 4), y * w * 8 + w * 4);
  }
  return encodeRGBA(out, w * 2, h, type, quality);
}
function half(rgb, w, h) {
  const w2 = w >> 1, h2 = h >> 1, out = new Float32Array(w2 * h2 * 3);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    const o = (y * w2 + x) * 3, a = ((y * 2) * w + x * 2) * 3, b = a + w * 3;
    for (let c = 0; c < 3; c++) out[o + c] = (rgb[a + c] + rgb[a + 3 + c] + rgb[b + c] + rgb[b + 3 + c]) / 4;
  }
  return out;
}

async function decode(blob) {
  let bmp;
  try { bmp = await createImageBitmap(blob); } catch { bmp = await viaImage(blob); }
  const s = Math.min(1, WORK_MAX / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const c = newCanvas(w, h), g = ctx2d(c);
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return { w, h, data: g.getImageData(0, 0, w, h).data };
}
function viaImage(blob) {
  if (typeof Image === "undefined") return Promise.reject(new Error("Can't decode this photo"));
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  return img.decode().then(() => img, (e) => { throw e; }).finally(() => URL.revokeObjectURL(url));
}

/* ======================================================================
   1-2. Mask, box, core
   ====================================================================== */
async function analysePhoto(blob, kind) {
  const img = await decode(blob);
  await yieldNow();
  let { w, h, data } = img;
  const fromAlpha = hasAlpha(data);
  const bgRef = fromAlpha ? null : [0, 0, 0];
  let mask = fromAlpha ? alphaMask(data, w, h) : floodBackground(data, w, h, bgRef);
  mask = keepBig(mask, w, h);
  await yieldNow();
  let peeled = 0, peelInfo = null, far = null;
  if (kind !== "shoes") {
    // What's left of the floor, a stick or a shadow along the outline goes (soles would, so not shoes).
    const fab = fabricGuess(data, mask, w, h);
    if (fab) {
      far = farFrom(data, mask, fab);
      await yieldNow();
      // bottoms: the gap between the legs, where the flood can stop short in the narrow top of the gap
      const b0 = kind === "bottoms" ? boxOf(mask, w, h) : null;
      const gap = b0 && [Math.round(b0.x0 + (b0.x1 - b0.x0) * 0.35), Math.round(b0.x0 + (b0.x1 - b0.x0) * 0.65)];
      peeled = peelRemnants(far, mask, w, h, data, bgRef && labOf(...bgRef), fab, gap);
      peelInfo = PEEL_INFO;
      if (peeled) mask = keepBig(mask, w, h);
    }
    await yieldNow();
  }
  let angle = 0, toeLeft = false;
  if (kind === "shoes") {
    // Level the sole and turn the toe to the right: redraw the photo rotated (and flipped).
    angle = soleAngle(mask, w, h);
    const box0 = boxOf(mask, w, h);
    toeLeft = toeIsLeft(rotateMask(mask, w, h, box0, angle));
    ({ w, h, data, mask } = redraw(data, mask, w, h, box0, angle, toeLeft));
    mask = keepBig(mask, w, h);
    await yieldNow();
  }
  const box = boxOf(mask, w, h);
  if (!box) throw new Error("No garment found in the photo");
  // The pixels a panel may use: inside the outline by 2 px, and on a cut-out's soft edge only the fully
  // opaque ones (the half-transparent rim still carries the old background's colour).
  let eroded = erode(mask, w, h, 2);
  if (fromAlpha) {
    const solid = new Uint8Array(w * h);
    for (let i = 0; i < solid.length; i++) solid[i] = mask[i] && data[i * 4 + 3] >= 250 ? 1 : 0;
    const deep = erode(eroded, w, h, 6), rim = erode(solid, w, h, 1);
    for (let i = 0; i < solid.length; i++) eroded[i] = deep[i] || (eroded[i] && rim[i]) ? 1 : 0;
  }
  await yieldNow();
  let core, how, stats;
  if (kind === "top") ({ core, how, stats } = topCore(mask, w, h, box, luminance(data, w * h), far));
  else if (kind === "bottoms") ({ core, how } = bottomsCore(mask, w, h, box));
  else { core = { x0: box.x0, y0: box.y0, x1: box.x1, y1: box.y1 }; how = "shoe"; }
  // Shoes: the sole's colour, from the bottom 18% of the levelled shoe (its own pixels only).
  // And how bright its whites are (light, neutral parts: leather, laces, midsole), for the exposure.
  let sole = null, white = null;
  if (kind === "shoes") {
    sole = [];
    const bh = box.y1 - box.y0 + 1, step = Math.max(1, Math.round((box.x1 - box.x0 + 1) / 260));
    for (let y = box.y1; y > box.y1 - bh * 0.18; y -= step) for (let x = box.x0; x <= box.x1; x += step) {
      const i = y * w + x;
      if (eroded[i]) sole.push([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]);
    }
    const t = labLUT(), Ls = [];
    let all = 0;
    for (let y = box.y0; y <= box.y1; y += step) for (let x = box.x0; x <= box.x1; x += step) {
      const i = y * w + x;
      if (!eroded[i]) continue;
      all++;
      const o = lutIndex(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) * 3;
      if (t[o] > 55 && Math.hypot(t[o + 1], t[o + 2]) < 12) Ls.push(t[o]);
    }
    white = { frac: all ? Ls.length / all : 0, L: Ls.length ? percentile(Ls, 0.95) : 0 };
  }
  return { w, h, data, mask, eroded, box, core, how, stats, peeled, peelInfo, fromAlpha, angle, toeLeft, sole, white };
}

function hasAlpha(d) {
  let t = 0;
  const n = d.length >> 2;
  for (let i = 3; i < d.length; i += 16) if (d[i] < 250) t++;
  return t > (n / 4) * 0.02;
}
function alphaMask(d, w, h) {
  const m = new Uint8Array(w * h);
  for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
  return m;
}
function luminance(d, n) {
  const L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return L;
}
// Photos without a cut-out (shop photos on white or grey): flood the background in from the border,
// a step at a time, stopping at edges. A flat studio background gets a tight tolerance, so a white
// tee on white keeps its outline; then small pockets of background the flood couldn't reach (between
// the legs, under an arm) go too.
function floodBackground(d, w, h, refOut) {
  const n = w * h, L = luminance(d, n);
  const G = new Float32Array(n);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const gx = L[i - w + 1] + 2 * L[i + 1] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - 1] - L[i + w - 1];
    const gy = L[i + w - 1] + 2 * L[i + w] + L[i + w + 1] - L[i - w - 1] - 2 * L[i - w] - L[i - w + 1];
    G[i] = Math.hypot(gx, gy) / 8;
  }
  // The background's colour and how much it varies: the border.
  const rs = [], gs = [], bs = [], ls = [];
  const take = (i) => { rs.push(d[i * 4]); gs.push(d[i * 4 + 1]); bs.push(d[i * 4 + 2]); ls.push(L[i]); };
  for (let x = 0; x < w; x += 2) { take(x); take((h - 1) * w + x); }
  for (let y = 0; y < h; y += 2) { take(y * w); take(y * w + w - 1); }
  const ref = [median(rs), median(gs), median(bs)];
  if (refOut) refOut.splice(0, 3, ...ref);
  const mad = median(ls.map((v) => Math.abs(v - median(ls))));
  const flat = mad <= 1.5;
  const tRef = flat ? 9 : Math.max(18, Math.min(55, 6 * mad + 14));
  const tStep = flat ? 8 : 18, tG = flat ? 3.5 : 7;
  const dRef = (i) => Math.hypot(d[i * 4] - ref[0], d[i * 4 + 1] - ref[1], d[i * 4 + 2] - ref[2]);
  const dStep = (i, j) => Math.abs(d[i * 4] - d[j * 4]) + Math.abs(d[i * 4 + 1] - d[j * 4 + 1]) + Math.abs(d[i * 4 + 2] - d[j * 4 + 2]);
  const bg = new Uint8Array(n), stack = new Int32Array(n), got = new Int32Array(n);
  const flood = (seeds, mark) => {
    let sp = 0, count = 0;
    for (const i of seeds) if (!bg[i] && dRef(i) < tRef) { bg[i] = mark; stack[sp++] = i; got[count++] = i; }
    while (sp) {
      const i = stack[--sp], x = i % w;
      const nb0 = x > 0 ? i - 1 : -1, nb1 = x < w - 1 ? i + 1 : -1, nb2 = i >= w ? i - w : -1, nb3 = i < n - w ? i + w : -1;
      for (const j of [nb0, nb1, nb2, nb3]) {
        if (j < 0 || bg[j]) continue;
        if (dRef(j) < tRef && dStep(i, j) < tStep && G[j] < tG) { bg[j] = mark; stack[sp++] = j; got[count++] = j; }
      }
    }
    return count;
  };
  const border = [];
  for (let x = 0; x < w; x++) border.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) border.push(y * w, y * w + w - 1);
  flood(border, 1);
  // Pockets: smooth patches of exactly the background's colour inside the outline.
  for (let i = 0; i < n; i += 3) {
    if (bg[i] || dRef(i) > tRef * 0.5 || G[i] > tG * 0.5) continue;
    const c = flood([i], 2);
    const mark = c > n * 0.0003 && c < n * 0.015 ? 1 : 3; // 3: garment after all
    for (let k = 0; k < c; k++) bg[got[k]] = mark;
  }
  const m = new Uint8Array(n);
  for (let i = 0; i < n; i++) m[i] = bg[i] === 1 ? 0 : 1;
  // close small gaps along the outline the flood couldn't reach
  return erode(dilate(m, w, h, 1), w, h, 1);
}
// Keep the garment: the biggest connected part and any other part at least a fifth of its size.
function keepBig(m, w, h) {
  const { lab: labels, sizes } = components(m, w, h, true);
  let big = 0;
  for (const v of sizes) if (v > big) big = v;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) if (labels[i] && sizes[labels[i]] >= big * 0.2) out[i] = 1;
  return out;
}
// Connected parts of a 0/1 map (two passes with union-find): a label per pixel (0 = none) and each
// label's size.
function components(m, w, h, eight) {
  const n = w * h, lab = new Int32Array(n);
  let par = new Int32Array(4096), next = 1;
  const find = (a) => { while (par[a] !== a) { par[a] = par[par[a]]; a = par[a]; } return a; };
  const join = (a, b) => { a = find(a); b = find(b); if (a < b) par[b] = a; else if (b < a) par[a] = b; return a < b ? a : b; };
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      if (!m[i]) continue;
      let l = x > 0 && m[i - 1] ? lab[i - 1] : 0;
      if (y > 0) {
        const u = i - w;
        if (m[u]) l = l ? join(l, lab[u]) : lab[u];
        if (eight) {
          if (x > 0 && m[u - 1]) l = l ? join(l, lab[u - 1]) : lab[u - 1];
          if (x < w - 1 && m[u + 1]) l = l ? join(l, lab[u + 1]) : lab[u + 1];
        }
      }
      if (!l) {
        if (next >= par.length) { const p2 = new Int32Array(par.length * 2); p2.set(par); par = p2; }
        par[next] = next; l = next++;
      }
      lab[i] = l;
    }
  }
  const remap = new Int32Array(next);
  let K = 1;
  for (let l = 1; l < next; l++) remap[l] = find(l) === l ? K++ : remap[find(l)];
  const sizes = new Array(K).fill(0);
  for (let i = 0; i < n; i++) if (lab[i]) { const l = remap[lab[i]]; lab[i] = l; sizes[l]++; }
  return { lab, sizes };
}
// The garment's main colour: the biggest colour cluster of the whole cut-out (Lab), or null.
function fabricGuess(d, m, w, h) {
  const box = boxOf(m, w, h);
  if (!box) return null;
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  const pts = [];
  const step = Math.max(1, Math.round(Math.sqrt((bw * bh) / 3000)));
  for (let y = box.y0; y <= box.y1; y += step) for (let x = box.x0; x <= box.x1; x += step) {
    const i = y * w + x;
    if (m[i]) pts.push(labOf(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]));
  }
  if (pts.length < 50) return null;
  const { centers, counts } = kmeans(pts, 4, 8);
  return centers[counts.indexOf(Math.max(...counts))];
}
// Garment pixels of another colour than the fabric (ΔE > 30).
function farFrom(d, m, fab) {
  const far = new Uint8Array(m.length), dist = distLUT(fab);
  for (let i = 0; i < m.length; i++) if (m[i] && dist[lutIndex(d[i * 4], d[i * 4 + 1], d[i * 4 + 2])] > 30) far[i] = 1;
  return far;
}
// Remnants of what the garment lay on (the floor under the hem, a stick, a shadow): parts of another
// colour than the fabric that run along the outline for a good share of their edge and are thick.
// A print touches the outline at a point at most, so it stays. On a shop photo (bg: the background's
// Lab) a part close to the background's colour is its shadow, however big. Changes the mask; returns
// the pixels taken.
let PEEL_INFO = null;
function peelRemnants(far, m, w, h, d, bg, fab, gap) {
  PEEL_INFO = null;
  let fringe = 0;
  const distBg = bg && distLUT(bg), distFab = distLUT(fab);
  const bgLike = (i) => { const c = lutIndex(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]); return distBg[c] < distFab[c]; };
  if (bg) {
    // de-fringe a shop photo: outline pixels nearer the background's colour than the fabric's go, a few times
    for (let pass = 0; pass < 3; pass++) {
      const drop = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!m[i]) continue;
        if ((x === 0 || !m[i - 1] || x === w - 1 || !m[i + 1] || y === 0 || !m[i - w] || y === h - 1 || !m[i + w]) && bgLike(i)) drop.push(i);
      }
      for (const i of drop) { m[i] = 0; far[i] = 0; }
      fringe += drop.length;
    }
    // The rest of a background-coloured channel running up between the legs (bottoms; middle columns
    // only, so stripes along the outer seams stay).
    if (gap) {
      const [xa, xb] = gap, seen = new Uint8Array(w * h), stack = [], took = [];
      let area = 0;
      for (let i = 0; i < m.length; i++) area += m[i];
      for (let y = 1; y < h - 1; y++) for (let x = Math.max(1, xa); x <= Math.min(w - 2, xb); x++) {
        const i = y * w + x;
        if (m[i] && (!m[i - 1] || !m[i + 1] || !m[i - w] || !m[i + w]) && bgLike(i)) { seen[i] = 1; stack.push(i); }
      }
      while (stack.length) {
        const i = stack.pop(), x = i % w;
        took.push(i);
        for (const j of [i - 1, i + 1, i - w, i + w]) {
          const xj = j % w;
          if (j < w || j >= w * (h - 1) || xj < xa || xj > xb || Math.abs(xj - x) > 1 || seen[j] || !m[j] || !bgLike(j)) continue;
          seen[j] = 1; stack.push(j);
        }
      }
      if (took.length && took.length < area * 0.03) {
        for (const i of took) { m[i] = 0; far[i] = 0; }
        fringe += took.length;
      }
    }
  }
  let area = 0;
  for (let i = 0; i < m.length; i++) area += m[i];
  const { lab: labels, sizes } = components(far, w, h, false);
  // "along the outline": within 3 px of the outside (cut-outs often leave a dark rim)
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = m[i] ? 0 : 1;
  const nearOut = dilate(out, w, h, 3);
  const K = sizes.length, edge = new Float64Array(K), contact = new Float64Array(K);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, l = labels[i];
    if (!l) continue;
    const isEdge = x === 0 || x === w - 1 || y === 0 || y === h - 1 || labels[i - 1] !== l || labels[i + 1] !== l || labels[i - w] !== l || labels[i + w] !== l;
    if (isEdge) { edge[l]++; if (nearOut[i]) contact[l]++; }
  }
  // how close each part is to the background's colour (shop photos)
  const nearBg = new Float64Array(K);
  if (bg) {
    const cnt = new Float64Array(K);
    for (let i = 0; i < m.length; i += 5) { const l = labels[i]; if (l) { cnt[l]++; if (bgLike(i)) nearBg[l]++; } }
    for (let l = 1; l < K; l++) nearBg[l] = cnt[l] ? nearBg[l] / cnt[l] : 0;
  }
  let taken = 0;
  const drop = new Uint8Array(K);
  for (let l = 1; l < K; l++) {
    const a = sizes[l], shadow = nearBg[l] > 0.7;
    if (a < area * 0.002 || a > area * (shadow ? 0.4 : 0.12) || contact[l] < edge[l] * (shadow ? 0.2 : 0.3) || a < contact[l] * 5) continue;
    drop[l] = 1; taken += a;
  }
  PEEL_INFO = [...sizes.keys()].slice(1).sort((a, b) => sizes[b] - sizes[a]).slice(0, 5)
    .map((l) => [+(sizes[l] / area).toFixed(3), +(contact[l] / edge[l]).toFixed(2), Math.round(sizes[l] / Math.max(1, contact[l])), drop[l]]);
  if (!taken || taken > area * (bg ? 0.45 : 0.2)) return fringe;
  for (let i = 0; i < m.length; i++) if (drop[labels[i]]) { m[i] = 0; far[i] = 0; }
  return taken + fringe;
}
function erode(m, w, h, r) {
  let a = m;
  for (let k = 0; k < r; k++) {
    const b = new Uint8Array(w * h);
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      b[i] = a[i] & a[i - 1] & a[i + 1] & a[i - w] & a[i + w];
    }
    a = b;
  }
  return a;
}
function dilate(m, w, h, r) {
  let a = m;
  for (let k = 0; k < r; k++) {
    const b = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      b[i] = a[i] | (x > 0 && a[i - 1]) | (x < w - 1 && a[i + 1]) | (y > 0 && a[i - w]) | (y < h - 1 && a[i + w]);
    }
    a = b;
  }
  return a;
}
function boxOf(m, w, h) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x]) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

// Tops: the torso between the sleeves, from the shoulder line (beside the hood or collar) to the hem.
function topCore(m, w, h, box, L, far) {
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  const Y = (f) => Math.round(box.y0 + f * (bh - 1));
  const rowsIn = (a, b) => { const r = []; for (let y = Y(a); y <= Y(b); y++) r.push(y); return r; };
  // The top and bottom of the garment in each column.
  const colT = new Int32Array(w).fill(-1), colB = new Int32Array(w).fill(-1);
  for (let x = box.x0; x <= box.x1; x++) {
    for (let y = box.y0; y <= box.y1; y++) if (m[y * w + x]) { colT[x] = y; break; }
    for (let y = box.y1; y >= box.y0; y--) if (m[y * w + x]) { colB[x] = y; break; }
  }
  // The centre line: the middle of each row, lower two thirds.
  const mids = [];
  for (const y of rowsIn(0.35, 0.9)) {
    let l = -1, r = -1;
    for (let x = box.x0; x <= box.x1; x++) if (m[y * w + x]) { if (l < 0) l = x; r = x; }
    if (l >= 0) mids.push((l + r) / 2);
  }
  const cx = Math.round(mids.length ? median(mids) : (box.x0 + box.x1) / 2);
  // The run of garment through the centre of each row (gaps of a few px bridged).
  const runL = new Int32Array(h).fill(-1), runR = new Int32Array(h).fill(-1);
  const reach = Math.max(3, Math.round(bw * 0.04)), bridge = Math.max(2, Math.round(bw * 0.006));
  for (let y = box.y0; y <= box.y1; y++) {
    const row = y * w;
    let s = -1;
    for (let d = 0; d <= reach && s < 0; d++) { if (m[row + cx + d]) s = cx + d; else if (m[row + cx - d]) s = cx - d; }
    if (s < 0) continue;
    let l = s, r = s, gap = 0;
    for (let x = s; x >= box.x0; x--) { if (m[row + x]) { l = x; gap = 0; } else if (++gap > bridge) break; }
    gap = 0;
    for (let x = s; x <= box.x1; x++) { if (m[row + x]) { r = x; gap = 0; } else if (++gap > bridge) break; }
    runL[y] = l; runR[y] = r;
  }
  const widthAt = (y) => (runL[y] >= 0 ? runR[y] - runL[y] + 1 : 0);
  const vals = (arr, ys) => ys.map((y) => arr[y]).filter((v) => v >= 0);
  const low = rowsIn(0.55, 0.88);
  const lowW = median(low.map(widthAt).filter((v) => v > 0)) || 0;
  const upW = percentile(rowsIn(0.12, 0.4).map(widthAt), 0.9);
  const midW = median(rowsIn(0.45, 0.7).map(widthAt).filter((v) => v > 0)) || bw;
  const stats = { lowW: +(lowW / bw).toFixed(2), upW: +(upW / bw).toFixed(2), midW: +(midW / bw).toFixed(2) };
  let xL, xR, how;
  if (lowW > 0 && lowW < bw * 0.86 && upW > lowW * 1.22) {
    // Sleeves standing out (tees laid with arms apart) or apart from the body: the lower rows are the torso.
    xL = median(vals(runL, low)); xR = median(vals(runR, low)); how = "run";
  } else {
    // Sleeves hanging alongside the body (hoodies, knits, jackets): the rows below the cuffs, or the
    // seams between sleeve and body, else the middle 60%.
    const hemRows = rowsIn(0.8, 0.99).filter((y) => runL[y] >= 0 && widthAt(y) < midW * 0.8 && widthAt(y) > midW * 0.45);
    const seams = seamsOf(m, w, L, box, rowsIn(0.42, 0.86), cx);
    stats.hemRows = hemRows.length; stats.seams = seams.l != null ? [+((seams.l - box.x0) / bw).toFixed(2), +((seams.r - box.x0) / bw).toFixed(2)] : null;
    if (hemRows.length >= Math.max(4, bh * 0.03)) {
      // the hem between the cuffs; a cuff touching it on one side makes that side wider: the other side counts
      const half = Math.min(cx - median(hemRows.map((y) => runL[y])), median(hemRows.map((y) => runR[y])) - cx);
      xL = cx - half; xR = cx + half; how = "hem";
      // a gathered hem is a little narrower than the body: meet the seams if they agree
      if (seams.l != null && seams.r != null && Math.abs(seams.r - seams.l - 2 * half) < bw * 0.14) { xL = Math.min(xL, seams.l); xR = Math.max(xR, seams.r); }
    } else if (seams.l != null && seams.r != null) {
      xL = seams.l; xR = seams.r; how = "seams";
    } else {
      xL = box.x0 + bw * 0.2; xR = box.x1 - bw * 0.2; how = "middle";
    }
  }
  xL = Math.round(Math.max(box.x0, xL)); xR = Math.round(Math.min(box.x1, xR));
  if (xR - xL < bw * 0.3) { xL = Math.round(box.x0 + bw * 0.2); xR = Math.round(box.x1 - bw * 0.2); how += "+fallback"; }
  const span = xR - xL;
  // Hem: the lowest garment pixel of the core's inner columns (median).
  const bottoms = [];
  for (let x = Math.round(xL + span * 0.1); x <= xR - span * 0.1; x++) if (colB[x] >= 0) bottoms.push(colB[x]);
  let y1 = Math.round(bottoms.length ? median(bottoms) : box.y1);
  // A band of another colour right across the bottom (the lining or the other side showing below the
  // hem, the floor): the hem is above it.
  if (far) {
    const xa = Math.round(xL + span * 0.05), xb = Math.round(xR - span * 0.05), H = y1 - box.y0;
    const fracAt = (y) => {
      let f = 0, c = 0;
      for (let x = xa; x <= xb; x++) { const i = y * w + x; if (m[i]) { c++; f += far[i]; } }
      return c > (xb - xa) * 0.5 ? f / c : 0;
    };
    const tall = Math.max(2, Math.round(H * 0.015));
    for (let y = Math.round(y1 - H * 0.14); y <= y1 - tall; y++) {
      if (fracAt(y) < 0.7) continue;
      let ok = true;
      for (let k = 1; k <= tall && ok; k++) if (fracAt(y + k) < 0.6) ok = false;
      if (ok) { stats.band = +((y1 - y) / H).toFixed(3); y1 = y - 1; how += "+band"; break; }
    }
  }
  // Shoulder line: walk the top outline from each side of the core towards the middle; where it turns
  // steeply up (a hood or a standing collar) is the neck. Without one (tees) the collar's top.
  const k = Math.max(3, Math.round(span * 0.02));
  const neck = (start, dir) => {
    const end = cx - dir * Math.round(span * 0.06);
    for (let x = start; dir > 0 ? x + 3 * k <= end : x - 3 * k >= end; x += dir) {
      const t = colT[x], a = colT[x + dir * k], f = colT[x + dir * 3 * k];
      if (t < 0 || a < 0 || f < 0) continue;
      if (t - a > k * 2.2 && t - f > bh * 0.04) return t;
    }
    return null;
  };
  const nl = neck(Math.round(xL + span * 0.03), 1), nr = neck(Math.round(xR - span * 0.03), -1);
  let y0;
  const okNeck = (v) => (v != null && v <= box.y0 + bh * 0.36 ? v : Infinity);
  if (okNeck(nl) < Infinity || okNeck(nr) < Infinity) y0 = Math.min(okNeck(nl), okNeck(nr));
  else {
    let t = Infinity;
    for (let x = Math.round(xL + span * 0.03); x <= xR - span * 0.03; x++) if (colT[x] >= 0) t = Math.min(t, colT[x]);
    y0 = t;
  }
  if (!(y0 < box.y0 + bh * 0.5) || y1 - y0 < bh * 0.35) {
    const ts = [];
    for (let x = xL; x <= xR; x++) if (colT[x] >= 0) ts.push(colT[x]);
    y0 = Math.min(Math.round(percentile(ts, 0.5)), Y(0.45));
    how += "+top";
  }
  stats.neck = [nl != null ? +((nl - box.y0) / bh).toFixed(2) : null, nr != null ? +((nr - box.y0) / bh).toFixed(2) : null];
  return { core: { x0: xL, y0: Math.round(y0), x1: xR, y1, cx }, how, stats };
}
// The seams between sleeve and body: columns with gaps in the garment, or a strong vertical edge
// (crease, shadow), 6-36% in from each side. The outermost strong column, as pockets and prints
// make strong edges further in.
function seamsOf(m, w, L, box, rows, cx) {
  const bw = box.x1 - box.x0 + 1;
  const score = new Float32Array(bw);
  for (const y of rows) {
    const row = y * w;
    let l = -1, r = -1;
    for (let x = box.x0; x <= box.x1; x++) if (m[row + x]) { if (l < 0) l = x; r = x; }
    if (l < 0) continue;
    for (let x = l + 2; x <= r - 2; x++) {
      const i = row + x;
      if (!m[i]) { score[x - box.x0] += 3; continue; } // a gap between sleeve and body
      if (!m[i - 2] || !m[i + 2]) continue;
      score[x - box.x0] += Math.min(40, Math.abs(L[i + 2] - L[i - 2])) / 40;
    }
  }
  const n = Math.max(1, rows.length), sm = new Float32Array(bw);
  for (let x = 0; x < bw; x++) { let s = 0, c = 0; for (let k = -4; k <= 4; k++) if (x + k >= 0 && x + k < bw) { s += score[x + k]; c++; } sm[x] = s / c / n; }
  // A seam on each side at about the same distance from the centre line; of the good pairs the widest,
  // as pockets and prints make strong edges further in.
  const tol = Math.max(2, Math.round(bw * 0.025)), c = cx - box.x0;
  const best = (x) => {
    let v = 0, at = -1;
    for (let k = x - tol; k <= x + tol; k++) if (k >= 0 && k < bw && sm[k] > v) { v = sm[k]; at = k; }
    return [v, at];
  };
  const pairs = [];
  let top = 0;
  for (let d = Math.round(bw * 0.12); d <= bw * 0.45; d++) {
    const [vl, al] = best(c - d), [vr, ar] = best(c + d);
    if (al < 0 || ar < 0) continue;
    const S = vl + vr;
    pairs.push([d, S, al, ar, Math.min(vl, vr)]);
    top = Math.max(top, S);
  }
  const all = [];
  for (let x = Math.round(bw * 0.06); x < bw * 0.94; x++) all.push(sm[x]);
  const base = median(all);
  for (let i = pairs.length - 1; i >= 0; i--) {
    const [, S, al, ar, lo] = pairs[i];
    if (S >= top * 0.55 && lo > base * 1.3 + 0.02) return { l: al + box.x0, r: ar + box.x0 };
  }
  return { l: null, r: null };
}
// Bottoms: the whole garment, from the waistband (not a label sticking up) to the hems.
// Where the legs part in the photo: the top of the gap between them, as a v (1 = the waistband, 0 =
// the hems), so the stage can put the photo's crotch on the 3D crotch seam.
function crotchOf(p) {
  const { w, h, valid } = p, tops = [];
  for (let x = Math.round(w * 0.46); x <= Math.round(w * 0.54); x++) {
    for (let y = Math.round(h * 0.12); y < Math.round(h * 0.7); y++) if (!valid[y * w + x]) { tops.push(y); break; }
  }
  if (tops.length < 3) return null;
  return Math.round((1 - median(tops) / h) * 1000) / 1000;
}
function bottomsCore(m, w, h, box) {
  const bw = box.x1 - box.x0 + 1, tops = [];
  for (let x = Math.round(box.x0 + bw * 0.25); x <= box.x1 - bw * 0.25; x++) {
    for (let y = box.y0; y <= box.y1; y++) if (m[y * w + x]) { tops.push(y); break; }
  }
  const y0 = tops.length ? Math.round(percentile(tops, 0.2)) : box.y0;
  return { core: { x0: box.x0, y0, x1: box.x1, y1: box.y1 }, how: "whole" };
}

/* ---------- shoes ---------- */
// The tilt of the sole: the longest edge along the bottom of the outline's convex hull.
function soleAngle(m, w, h) {
  const box = boxOf(m, w, h);
  if (!box) return 0;
  const pts = [];
  for (let x = box.x0; x <= box.x1; x += 2) {
    for (let y = box.y1; y >= box.y0; y--) if (m[y * w + x]) { pts.push([x, -y]); break; }
  }
  const hull = [];
  for (const p of pts) {
    while (hull.length >= 2) {
      const [o, a] = [hull[hull.length - 2], hull[hull.length - 1]];
      if ((a[0] - o[0]) * (p[1] - o[1]) - (a[1] - o[1]) * (p[0] - o[0]) <= 0) hull.pop(); else break;
    }
    hull.push(p);
  }
  let best = null;
  for (let i = 1; i < hull.length; i++) {
    const dx = hull[i][0] - hull[i - 1][0], dy = -(hull[i][1] - hull[i - 1][1]);
    if (!best || dx > best.dx) best = { dx, dy };
  }
  const a = best && best.dx >= (box.x1 - box.x0) * 0.25 ? Math.atan2(best.dy, best.dx) : null;
  if (a != null && Math.abs(a) <= (32 * Math.PI) / 180) return a;
  // (a boot shot from above, taller than long: its sole may be steeper)
  if (a != null && box.y1 - box.y0 > (box.x1 - box.x0) * 1.15 && Math.abs(a) <= (60 * Math.PI) / 180) return a;
  // No long flat edge (a boot shot from above and the side stands at up to ~45°): level the lowest
  // points of its two ends, where it would rest on the floor.
  const bw = box.x1 - box.x0 + 1, low = (x0, x1) => {
    let bx = 0, by = -1;
    for (let x = x0; x <= x1; x++) for (let y = box.y1; y >= box.y0; y--) if (m[y * w + x]) { if (y > by) { by = y; bx = x; } break; }
    return [bx, by];
  };
  const [lx, ly] = low(box.x0, box.x0 + Math.round(bw * 0.3)), [rx, ry] = low(box.x1 - Math.round(bw * 0.3), box.x1);
  const b = Math.atan2(ry - ly, rx - lx);
  return rx > lx && Math.abs(b) <= (50 * Math.PI) / 180 ? b : 0;
}
function rotateMask(m, w, h, box, angle) {
  if (!angle) return { m, w, h };
  const c = newCanvas(w, h), g = ctx2d(c);
  const id = g.createImageData(w, h);
  for (let i = 0; i < m.length; i++) id.data[i * 4 + 3] = m[i] * 255;
  g.putImageData(id, 0, 0);
  const { canvas: out, w: w2, h: h2 } = rotated(c, w, h, box, angle, false);
  const d = ctx2d(out).getImageData(0, 0, w2, h2).data;
  return { m: alphaMask(d, w2, h2), w: w2, h: h2 };
}
// Draw the photo rotated about its box centre by -angle (sole level), flipped if the toe points left.
function rotated(src, w, h, box, angle, flip) {
  const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
  const diag = Math.ceil(Math.hypot(box.x1 - box.x0 + 1, box.y1 - box.y0 + 1)) + 8;
  const c = newCanvas(diag, diag), g = ctx2d(c);
  g.translate(diag / 2, diag / 2);
  if (flip) g.scale(-1, 1);
  g.rotate(-angle);
  g.drawImage(src, -cx, -cy);
  return { canvas: c, w: diag, h: diag };
}
// Which way the toe points: the collar (the shoe's highest point, over the heel) is at the back; when
// it's near the middle, the lower end is the toe.
function toeIsLeft({ m, w, h }) {
  const box = boxOf(m, w, h);
  if (!box) return false;
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  const tops = new Int32Array(bw).fill(-1), heights = new Float64Array(bw);
  for (let x = box.x0; x <= box.x1; x++) {
    let t = -1, b = -1;
    for (let y = box.y0; y <= box.y1; y++) if (m[y * w + x]) { if (t < 0) t = y; b = y; }
    tops[x - box.x0] = t; heights[x - box.x0] = t < 0 ? 0 : b - t;
  }
  // Not a side view (a boot shot three-quarters from the front, taller than long): the toe is the
  // lowest point.
  if (bw < bh * 1.1) {
    let lx = 0, ln = 0;
    for (let y = box.y1; y >= box.y1 - bh * 0.04; y--) for (let x = box.x0; x <= box.x1; x++) if (m[y * w + x]) { lx += x - box.x0; ln++; }
    const lo = ln ? lx / ln / bw - 0.5 : 0;
    if (Math.abs(lo) > 0.1) return lo < 0;
  }
  let sx = 0, n = 0;
  for (let x = 0; x < bw; x++) if (tops[x] >= 0 && tops[x] <= box.y0 + bh * 0.03) { sx += x; n++; }
  const off = n ? sx / n / bw - 0.5 : 0;
  if (Math.abs(off) > 0.1) return off > 0;
  let left = 0, right = 0, nl = 0, nr = 0;
  for (let x = 0; x < bw * 0.28; x++) { left += heights[x]; nl++; }
  for (let x = Math.round(bw * 0.72); x < bw; x++) { right += heights[x]; nr++; }
  return left / nl < right / nr; // the toe is the lower end
}
// The outline of a levelled shoe (toe to the right) as its top and bottom edge in N columns from
// heel to toe, 0-1 up from the bottom of its box, and the box's height over its length.
function shoeProfileOf(a, N = 48) {
  const { mask: m, w, box } = a;
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  const top = new Array(N).fill(null), bot = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    const xa = box.x0 + Math.floor((i * bw) / N), xb = Math.max(xa, box.x0 + Math.floor(((i + 1) * bw) / N) - 1);
    // the column's solid part: its runs of shoe (small gaps closed), the biggest one (a three-quarter
    // photo can show a strip of the far collar above a gap, which no side outline has)
    const on = new Uint8Array(bh);
    for (let x = xa; x <= xb; x++) for (let y = box.y0; y <= box.y1; y++) if (m[y * w + x]) on[y - box.y0] = 1;
    const gap = Math.max(2, Math.round(bh * 0.05));
    let best = null, cur = null, last = -1e9;
    for (let y = 0; y < bh; y++) {
      if (!on[y]) continue;
      if (cur && y - last <= gap) { cur.b = y; cur.n++; } else { cur = { t: y, b: y, n: 1 }; }
      last = y;
      if (!best || cur.n > best.n) best = cur;
    }
    if (best) { top[i] = 1 - best.t / bh; bot[i] = 1 - (best.b + 1) / bh; }
  }
  // empty columns (a gap in the mask): the neighbours' values
  for (const arr of [top, bot]) for (let i = 0; i < N; i++) if (arr[i] == null) {
    let l = i - 1, r = i + 1; while (l >= 0 && arr[l] == null) l--; while (r < N && arr[r] == null) r++;
    arr[i] = l >= 0 && r < N ? (arr[l] + arr[r]) / 2 : l >= 0 ? arr[l] : r < N ? arr[r] : 0.5;
  }
  const r3 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;
  return { top: top.map(r3), bot: bot.map(r3), aspect: Math.round((bh / bw) * 1000) / 1000 };
}
function redraw(data, mask, w, h, box, angle, flip) {
  if (!angle && !flip) return { w, h, data, mask };
  const c = newCanvas(w, h), g = ctx2d(c);
  const id = g.createImageData(w, h);
  for (let i = 0; i < w * h; i++) {
    id.data[i * 4] = data[i * 4]; id.data[i * 4 + 1] = data[i * 4 + 1]; id.data[i * 4 + 2] = data[i * 4 + 2];
    id.data[i * 4 + 3] = mask[i] ? data[i * 4 + 3] : 0;
  }
  g.putImageData(id, 0, 0);
  const r = rotated(c, w, h, box, angle, flip);
  const d = ctx2d(r.canvas).getImageData(0, 0, r.w, r.h).data;
  return { w: r.w, h: r.h, data: d, mask: alphaMask(d, r.w, r.h) };
}

/* ======================================================================
   The panel's pixels: the core resampled to panel size
   ====================================================================== */
// RGB (0-255 floats) and how much of each pixel is garment (0-1), from the eroded mask.
function cropPanel(a, PW, PH) {
  const { w, h, data, eroded, core } = a;
  const sx = (core.x1 - core.x0 + 1) / PW, sy = (core.y1 - core.y0 + 1) / PH;
  const n = PW * PH, rgb = new Float32Array(n * 3), valid = new Float32Array(n);
  // bilinear, weighted by the mask so no background colour bleeds in
  for (let y = 0; y < PH; y++) {
    const fy = Math.max(0, Math.min(h - 1, core.y0 + (y + 0.5) * sy - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < PW; x++) {
      const fx = Math.max(0, Math.min(w - 1, core.x0 + (x + 0.5) * sx - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w - 1, x0 + 1), tx = fx - x0;
      const i00 = y0 * w + x0, i01 = y0 * w + x1, i10 = y1 * w + x0, i11 = y1 * w + x1;
      const w00 = (1 - tx) * (1 - ty) * eroded[i00], w01 = tx * (1 - ty) * eroded[i01], w10 = (1 - tx) * ty * eroded[i10], w11 = tx * ty * eroded[i11];
      const al = w00 + w01 + w10 + w11, o = y * PW + x;
      valid[o] = al >= 0.98 ? 1 : 0;
      if (al > 0) {
        const q = 1 / al, a0 = i00 * 4, a1 = i01 * 4, a2 = i10 * 4, a3 = i11 * 4;
        rgb[o * 3] = (data[a0] * w00 + data[a1] * w01 + data[a2] * w10 + data[a3] * w11) * q;
        rgb[o * 3 + 1] = (data[a0 + 1] * w00 + data[a1 + 1] * w01 + data[a2 + 1] * w10 + data[a3 + 1] * w11) * q;
        rgb[o * 3 + 2] = (data[a0 + 2] * w00 + data[a1 + 2] * w01 + data[a2 + 2] * w10 + data[a3 + 2] * w11) * q;
      }
    }
  }
  return { w: PW, h: PH, rgb, valid };
}

/* ======================================================================
   3. Fabric: colours and the grain tile
   ====================================================================== */
const LIN = new Float32Array(256).map((_, i) => { const c = i / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
function lab(r, g, b) {
  const R = LIN[Math.max(0, Math.min(255, Math.round(r)))], G = LIN[Math.max(0, Math.min(255, Math.round(g)))], B = LIN[Math.max(0, Math.min(255, Math.round(b)))];
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), Y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), Z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}
const dE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Lab of every colour, 5 bits a channel (32 KB entries): fast enough to look up per pixel.
let LAB_LUT = null;
function labLUT() {
  if (LAB_LUT) return LAB_LUT;
  const t = new Float32Array(32768 * 3);
  for (let r = 0; r < 32; r++) for (let g = 0; g < 32; g++) for (let b = 0; b < 32; b++) {
    const v = lab(r * 8 + 4, g * 8 + 4, b * 8 + 4), i = ((r << 10) | (g << 5) | b) * 3;
    t[i] = v[0]; t[i + 1] = v[1]; t[i + 2] = v[2];
  }
  return (LAB_LUT = t);
}
const lutIndex = (r, g, b) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
const labOf = (r, g, b) => { const t = labLUT(), i = lutIndex(r, g, b) * 3; return [t[i], t[i + 1], t[i + 2]]; };
// The distance (ΔE) of every colour of the table to one colour.
function distLUT(to) {
  const t = labLUT(), out = new Float32Array(32768);
  for (let i = 0; i < 32768; i++) out[i] = Math.hypot(t[i * 3] - to[0], t[i * 3 + 1] - to[1], t[i * 3 + 2] - to[2]);
  return out;
}

// The dominant colour of the panels (k-means in Lab, the biggest cluster plus its near neighbours),
// the trim (hem band for tops, sole for shoes) and a second colour when there is one.
function fabricColours(panels, kind) {
  const samples = [];
  for (const p of panels) {
    const { w, h, rgb, valid } = p;
    const yMax = kind === "shoes" ? 0.8 : 1;
    const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 4000)));
    for (let y = 0; y < h * yMax; y += step) for (let x = 0; x < w; x += step) {
      const i = y * w + x;
      if (valid[i]) samples.push([rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]]);
    }
  }
  if (!samples.length) return { rgb: [128, 128, 128], lab: lab(128, 128, 128), tol: 20, dist: distLUT(lab(128, 128, 128)) };
  const labs = samples.map((s) => labOf(s[0], s[1], s[2]));
  const { centers, assign, counts } = kmeans(labs, Math.min(5, labs.length), 10);
  const order = counts.map((c, k) => k).sort((a, b) => counts[b] - counts[a]);
  const top = order[0];
  const group = new Set([top]);
  for (const k of order) if (k !== top && dE(centers[k], centers[top]) < 14) group.add(k);
  const members = [];
  labs.forEach((_, i) => { if (group.has(assign[i])) members.push(i); });
  const rgb = [0, 1, 2].map((c) => median(members.map((i) => samples[i][c])));
  const L = lab(...rgb);
  const spread = median(members.map((i) => dE(labs[i], L)));
  const out = { rgb, lab: L, tol: Math.max(10, Math.min(26, spread * 2.5)), dist: distLUT(L) };
  // A second colour: the biggest cluster outside the group, if it covers a good share.
  const total = counts.reduce((a, b) => a + b, 0);
  const other = order.find((k) => !group.has(k) && counts[k] > total * 0.15 && dE(centers[k], L) > 20);
  if (other != null) {
    const ms = [];
    labs.forEach((_, i) => { if (assign[i] === other) ms.push(i); });
    out.second = [0, 1, 2].map((c) => median(ms.map((i) => samples[i][c])));
  }
  // Trim: the hem band (tops) or the sole (shoes), when it's another colour.
  const p = panels[0];
  if (kind === "top" || kind === "shoes") {
    const ys = kind === "top" ? [0.93, 0.995] : [0.86, 0.99];
    const xs = kind === "top" ? [0.2, 0.8] : [0.1, 0.9];
    const t = [];
    for (let y = Math.round(p.h * ys[0]); y < p.h * ys[1]; y += 2) for (let x = Math.round(p.w * xs[0]); x < p.w * xs[1]; x += 2) {
      const i = y * p.w + x;
      if (p.valid[i]) t.push([p.rgb[i * 3], p.rgb[i * 3 + 1], p.rgb[i * 3 + 2]]);
    }
    if (t.length > 30) {
      const trim = [0, 1, 2].map((c) => median(t.map((s) => s[c])));
      if (dE(lab(...trim), L) > 9) out.trim = trim;
    }
  }
  return out;
}
function kmeans(pts, k, iters) {
  // k-means++ with a fixed seed, so a piece always bakes the same
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296);
  const centers = [pts[Math.floor(rnd() * pts.length)].slice()];
  const d2 = new Float64Array(pts.length);
  while (centers.length < k) {
    let sum = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      let m = Infinity;
      for (const c of centers) m = Math.min(m, (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2);
      d2[i] = m; sum += m;
    }
    let r = rnd() * sum, j = 0;
    while (j < pts.length - 1 && (r -= d2[j]) > 0) j++;
    centers.push(pts[j].slice());
  }
  const assign = new Int32Array(pts.length);
  for (let it = 0; it < iters; it++) {
    for (let i = 0; i < pts.length; i++) {
      let best = 0, bd = Infinity;
      const p = pts[i];
      for (let c = 0; c < k; c++) {
        const q = centers[c], d = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
        if (d < bd) { bd = d; best = c; }
      }
      assign[i] = best;
    }
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < pts.length; i++) { const s = sums[assign[i]]; s[0] += pts[i][0]; s[1] += pts[i][1]; s[2] += pts[i][2]; s[3]++; }
    sums.forEach((s, c) => { if (s[3]) centers[c] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const counts = new Array(k).fill(0);
  for (let i = 0; i < pts.length; i++) counts[assign[i]]++;
  return { centers, assign, counts };
}

// A seamless tile of the fabric's grain: the fine detail (colour minus its blur) of the plainest
// patch of fabric, cross-faded with itself shifted by half, on the fabric colour.
function fabricTile(panels, fabric, kind) {
  let best = null;
  for (const p of panels) {
    // searched on every other pixel; the patch is then read from the full panel
    const { rgb, valid } = p, w = p.w >> 1, h = p.h >> 1, dist = fabric.dist;
    const n = w * h, fab = new Float32Array(n), Lm = new Float32Array(n), L2 = new Float32Array(n);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, j = (y * 2) * p.w + x * 2;
      const L = 0.299 * rgb[j * 3] + 0.587 * rgb[j * 3 + 1] + 0.114 * rgb[j * 3 + 2];
      Lm[i] = L; L2[i] = L * L;
      fab[i] = valid[j] && dist[lutIndex(rgb[j * 3], rgb[j * 3 + 1], rgb[j * 3 + 2])] < fabric.tol ? 1 : 0;
    }
    const If = integral(fab, w, h), IL = integral(Lm, w, h), IL2 = integral(L2, w, h);
    const yMax = kind === "shoes" ? 0.8 : 1;
    for (const S of [128, 96, 64, 48]) {
      if (S > w || S > h * yMax) continue;
      const step = Math.max(4, S >> 2);
      for (let y = 0; y + S <= h * yMax; y += step) for (let x = 0; x + S <= w; x += step) {
        const frac = rectSum(If, w, x, y, S, S) / (S * S);
        if (frac < 0.9) continue;
        const m = rectSum(IL, w, x, y, S, S) / (S * S), v = rectSum(IL2, w, x, y, S, S) / (S * S) - m * m;
        const score = frac * 100 - Math.sqrt(Math.max(0, v)) + S / 32;
        if (!best || score > best.score) best = { score, p, x: x * 2, y: y * 2, S: S * 2 };
      }
      if (best && best.S === S * 2 && best.score > 90) break;
    }
  }
  const T = TILE, out = new Float32Array(T * T * 3), height = new Float32Array(T * T);
  let hf, from = "photo";
  if (best) {
    // the patch, resampled to the tile, minus its blur
    const { p, x, y, S } = best;
    const patch = new Float32Array(T * T * 3);
    for (let ty = 0; ty < T; ty++) for (let tx = 0; tx < T; tx++) {
      const sx = x + ((tx + 0.5) * S) / T - 0.5, sy = y + ((ty + 0.5) * S) / T - 0.5;
      bilinear(p.rgb, p.w, p.h, sx, sy, patch, (ty * T + tx) * 3);
    }
    const blur = boxBlur3(patch, T, T, 6, 2);
    hf = new Float32Array(T * T * 3);
    for (let i = 0; i < hf.length; i++) hf[i] = patch[i] - blur[i];
    // keep it subtle: clamp outliers (lint, a stray thread)
    const sd = Math.sqrt(hf.reduce((s, v) => s + v * v, 0) / hf.length) || 1;
    for (let i = 0; i < hf.length; i++) hf[i] = Math.max(-2.5 * sd, Math.min(2.5 * sd, hf[i]));
  } else {
    // no plain patch (all print): a fine synthetic weave
    from = "synthetic";
    hf = new Float32Array(T * T * 3);
    let s = 7;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296 - 0.5);
    for (let i = 0; i < T * T; i++) { const v = rnd() * 6; hf[i * 3] = hf[i * 3 + 1] = hf[i * 3 + 2] = v; }
  }
  // seamless: cross-fade with itself rolled by half, weights 1 in the middle and 0 at the edges
  const tri = (t) => 1 - Math.abs((t + 0.5) / T * 2 - 1);
  for (let ty = 0; ty < T; ty++) for (let tx = 0; tx < T; tx++) {
    const a = Math.min(tri(tx), tri(ty)), b = 1 - a, norm = 1 / Math.sqrt(a * a + b * b);
    const i = (ty * T + tx) * 3, j = (((ty + T / 2) % T) * T + ((tx + T / 2) % T)) * 3;
    for (let c = 0; c < 3; c++) out[i + c] = (hf[i + c] * a + hf[j + c] * b) * norm;
  }
  const rgb = new Float32Array(T * T * 3);
  for (let i = 0; i < T * T; i++) {
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = clamp255(fabric.rgb[c] + out[i * 3 + c]);
    height[i] = (0.299 * out[i * 3] + 0.587 * out[i * 3 + 1] + 0.114 * out[i * 3 + 2]) / 255;
  }
  return { rgb, hf: out, height, size: best ? best.S : T, from };
}
function integral(a, w, h) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += a[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
  }
  return I;
}
const rectSum = (I, w, x, y, sw, sh) => { const W = w + 1; return I[(y + sh) * W + x + sw] - I[y * W + x + sw] - I[(y + sh) * W + x] + I[y * W + x]; };
function bilinear(rgb, w, h, x, y, out, o) {
  x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y));
  const x0 = Math.floor(x), y0 = Math.floor(y), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1), fx = x - x0, fy = y - y0;
  for (let c = 0; c < 3; c++) {
    const a = rgb[(y0 * w + x0) * 3 + c], b = rgb[(y0 * w + x1) * 3 + c], d = rgb[(y1 * w + x0) * 3 + c], e = rgb[(y1 * w + x1) * 3 + c];
    out[o + c] = (a * (1 - fx) + b * fx) * (1 - fy) + (d * (1 - fx) + e * fx) * fy;
  }
}
// Box blur (radius r, `passes` times) of a 3-channel image, edges clamped.
function boxBlur3(src, w, h, r, passes) {
  let a = src;
  for (let p = 0; p < passes; p++) {
    const tmp = new Float32Array(a.length), out = new Float32Array(a.length);
    for (let y = 0; y < h; y++) for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += a[(y * w + Math.max(0, Math.min(w - 1, k))) * 3 + c];
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 3 + c] = s / (2 * r + 1);
        s += a[(y * w + Math.min(w - 1, x + r + 1)) * 3 + c] - a[(y * w + Math.max(0, x - r)) * 3 + c];
      }
    }
    for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += tmp[(Math.max(0, Math.min(h - 1, k)) * w + x) * 3 + c];
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 3 + c] = s / (2 * r + 1);
        s += tmp[(Math.min(h - 1, y + r + 1) * w + x) * 3 + c] - tmp[(Math.max(0, y - r) * w + x) * 3 + c];
      }
    }
    a = out;
  }
  return a;
}
function boxBlur1(src, w, h, r) {
  const tmp = new Float32Array(src.length), out = new Float32Array(src.length), inv = 1 / (2 * r + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w, last = row + w - 1;
    let s = src[row] * (r + 1);
    for (let k = 1; k <= r; k++) s += src[row + Math.min(w - 1, k)];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = s * inv;
      s += (x + r + 1 < w ? src[row + x + r + 1] : src[last]) - (x - r >= 0 ? src[row + x - r] : src[row]);
    }
  }
  // vertical: running column sums, a row at a time
  const col = new Float32Array(w);
  for (let x = 0; x < w; x++) { let s = tmp[x] * (r + 1); for (let k = 1; k <= r; k++) s += tmp[Math.min(h - 1, k) * w + x]; col[x] = s; }
  for (let y = 0; y < h; y++) {
    const row = y * w, add = (y + r + 1 < h ? y + r + 1 : h - 1) * w, sub = (y - r >= 0 ? y - r : 0) * w;
    for (let x = 0; x < w; x++) { out[row + x] = col[x] * inv; col[x] += tmp[add + x] - tmp[sub + x]; }
  }
  return out;
}

/* ---------- the room's light off the panels (retinex) ---------- */
// sRGB 0-255 <-> linear 0-1, by table: in steps of 1/16, out by the square root of the linear value
// (fine steps in the shadows).
let TO_LIN = null, FROM_LIN = null;
function linTables() {
  if (TO_LIN) return;
  TO_LIN = new Float32Array(4097);
  for (let i = 0; i <= 4096; i++) { const c = Math.min(1, i / 16 / 255); TO_LIN[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
  FROM_LIN = new Float32Array(4097);
  for (let i = 0; i <= 4096; i++) { const l = (i / 4096) ** 2; FROM_LIN[i] = 255 * (l <= 0.0031308 ? l * 12.92 : 1.055 * l ** (1 / 2.4) - 0.055); }
}
// Linear light scaled by k (rgb 0-255, in place).
function brighten(rgb, k) {
  linTables();
  for (let i = 0; i < rgb.length; i++) rgb[i] = fromLin(toLin(rgb[i]) * k);
  return rgb;
}
const yOfL = (L) => (L > 8 ? ((L + 16) / 116) ** 3 : L / 903.3);
const toLin = (v) => TO_LIN[v <= 0 ? 0 : v >= 256 ? 4096 : (v * 16 + 0.5) | 0];
const fromLin = (l) => FROM_LIN[l <= 0 ? 0 : l >= 1 ? 4096 : (Math.sqrt(l) * 4096 + 0.5) | 0];

// Flat-lay photos are lit unevenly (brighter at the chest, darker to the hem, shadows in the folds).
// The light is the fabric's own colour, blurred wide (prints, logos and zips left out and filled in
// from the fabric around them); every pixel, prints included, is divided by it and multiplied by the
// fabric's colour, so the fabric comes out even and prints keep their own contrast and colour.
// Tops: the light followed closely (folds and shadows go); bottoms: only a plane (a gradient across
// the panel), so the wash and fading of denim stay. Changes the panels' rgb in place.
async function delight(panels, fabric, kind) {
  linTables();
  const eps = 0.004, f0 = fabric.rgb.map(toLin);
  const Y0 = 0.2126 * f0[0] + 0.7152 * f0[1] + 0.0722 * f0[2];
  // pass 1 bounds: the fabric's chromaticity (r/g, b/g) within ±25%, its brightness 0.25-3x
  const k1 = Math.exp(0.25), ur = (f0[0] + eps) / (f0[1] + eps), vr = (f0[2] + eps) / (f0[1] + eps);
  const uLo = ur / k1, uHi = ur * k1, vLo = vr / k1, vHi = vr * k1, yLo = (Y0 + eps) * 0.25 - eps, yHi = (Y0 + eps) * 3 - eps;
  // The light is worked out at half size (cells of 2 x 2 there, 4 x 4 px of the panel), applied at full size.
  const R = kind === "top" ? 3 : 8;
  const fields = [];
  for (const p of panels) {
    const { w, h, rgb, valid } = p, w2 = w >> 1, h2 = h >> 1, n = w2 * h2;
    const lin = new Float32Array(n * 3), Y = new Float32Array(n);
    const fab = new Uint8Array(n), notFab = new Uint8Array(n);
    for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
      const i = y * w2 + x, a = (y * 2) * w + x * 2, q = [a, a + 1, a + w, a + w + 1];
      let r = 0, g = 0, b = 0, ok = 1;
      for (const j of q) { r += toLin(rgb[j * 3]); g += toLin(rgb[j * 3 + 1]); b += toLin(rgb[j * 3 + 2]); ok &= valid[j]; }
      r /= 4; g /= 4; b /= 4;
      lin[i * 3] = r; lin[i * 3 + 1] = g; lin[i * 3 + 2] = b;
      const yy = (Y[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b);
      if (!ok) continue;
      const u = (r + eps) / (g + eps), v = (b + eps) / (g + eps);
      if (yy > yLo && yy < yHi && u > uLo && u < uHi && v > vLo && v < vHi) fab[i] = 1; else notFab[i] = 1;
    }
    // the soft edges of prints aren't fabric either
    const near = dilate(notFab, w2, h2, 1);
    for (let i = 0; i < n; i++) if (near[i]) fab[i] = 0;
    const check = fab.slice(); // what the checks call fabric
    let E = lightField(lin, fab, w2, h2, 2, R, f0, false);
    // pass 2: prints in the fabric's own colours stand out from the light around them (by more than
    // 0.64-1.57x in brightness or ±12% in chromaticity)
    const gw = Math.ceil(w2 / 2), gh = Math.ceil(h2 / 2), print = new Uint8Array(n);
    const kY = Math.exp(0.45), kC = Math.exp(0.12);
    for (let y = 0; y < h2; y++) {
      const crow = Math.min(gh - 1, y >> 1) * gw;
      for (let x = 0; x < w2; x++) {
        const i = y * w2 + x;
        if (!fab[i]) continue;
        const o = (crow + Math.min(gw - 1, x >> 1)) * 3, er = E[o], eg = E[o + 1], eb = E[o + 2];
        const qy = (Y[i] + eps) / (0.2126 * er + 0.7152 * eg + 0.0722 * eb + eps);
        const qu = ((lin[i * 3] + eps) / (lin[i * 3 + 1] + eps)) * ((eg + eps) / (er + eps));
        const qv = ((lin[i * 3 + 2] + eps) / (lin[i * 3 + 1] + eps)) * ((eg + eps) / (eb + eps));
        if (qy > kY || qy * kY < 1 || qu > kC || qu * kC < 1 || qv > kC || qv * kC < 1) print[i] = 1;
      }
    }
    const drop = dilate(print, w2, h2, 1);
    for (let i = 0; i < n; i++) if (drop[i]) fab[i] = 0;
    E = lightField(lin, fab, w2, h2, 2, R, f0, kind !== "top");
    fields.push({ p, fab, check, E, gw, gh, w2, h2 });
    await yieldNow();
  }
  // The fabric's colour under even light: where the garment is best lit (the light's 75th percentile
  // in brightness, the median's colour), as shadows and fall-off only ever darken it.
  const pick = (fn) => { const out = []; for (const f of fields) for (let i = 0; i < f.gw * f.gh; i += 3) out.push(fn(f.E, i * 3)); return out; };
  const med = [0, 1, 2].map((c) => median(pick((E, o) => E[o + c])));
  const lift = percentile(pick((E, o) => 0.2126 * E[o] + 0.7152 * E[o + 1] + 0.0722 * E[o + 2]), 0.75) / Math.max(1e-4, 0.2126 * med[0] + 0.7152 * med[1] + 0.0722 * med[2]);
  const target = med.map((v) => Math.min(1, v * lift));
  for (const f of fields) {
    const { p, E, gw, gh } = f, { w, h, rgb } = p;
    const gain = new Float32Array(gw * gh * 3);
    for (let i = 0; i < gw * gh; i++) for (let c = 0; c < 3; c++) gain[i * 3 + c] = Math.max(0.4, Math.min(2.5, target[c] / Math.max(1e-4, E[i * 3 + c])));
    // the gain read back bilinearly (cell k's centre at (k + 0.5) * 4 px)
    const X0 = new Int32Array(w), X1 = new Int32Array(w), TX = new Float32Array(w);
    for (let x = 0; x < w; x++) { const fx = Math.max(0, Math.min(gw - 1, (x + 0.5) / 4 - 0.5)); X0[x] = fx | 0; X1[x] = Math.min(gw - 1, X0[x] + 1); TX[x] = fx - X0[x]; }
    for (let y = 0; y < h; y++) {
      const fy = Math.max(0, Math.min(gh - 1, (y + 0.5) / 4 - 0.5)), y0 = fy | 0, y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
      const ra = y0 * gw, rb = y1 * gw;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 3, a = (ra + X0[x]) * 3, b = (ra + X1[x]) * 3, c = (rb + X0[x]) * 3, d = (rb + X1[x]) * 3, tx = TX[x];
        for (let k = 0; k < 3; k++) {
          const g = (gain[a + k] + (gain[b + k] - gain[a + k]) * tx) * (1 - ty) + (gain[c + k] + (gain[d + k] - gain[c + k]) * tx) * ty;
          rgb[i + k] = fromLin(toLin(rgb[i + k]) * g);
        }
      }
    }
    await yieldNow();
  }
  return { target: hexOf(target.map(fromLin)), masks: fields.map((f) => ({ w: f.w2, h: f.h2, fabric: f.check, used: f.fab })) };
}
// The light over a panel, on cells of F px: the mean linear colour of the fabric in each cell, cells
// without fabric filled in from around them (pull-push), blurred (box blur x3 of radius R cells, about
// a Gaussian); or (`plane`) a plane fitted to the log of the light, a gradient across the panel.
function lightField(lin, fab, w, h, F, R, fallback, plane) {
  const gw = Math.ceil(w / F), gh = Math.ceil(h / F), C = new Float32Array(gw * gh * 3), Wt = new Float32Array(gw * gh);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (!fab[i]) continue;
    const o = ((y / F) | 0) * gw + ((x / F) | 0);
    Wt[o]++; C[o * 3] += lin[i * 3]; C[o * 3 + 1] += lin[i * 3 + 1]; C[o * 3 + 2] += lin[i * 3 + 2];
  }
  for (let o = 0; o < gw * gh; o++) if (Wt[o]) { for (let c = 0; c < 3; c++) C[o * 3 + c] /= Wt[o]; Wt[o] /= F * F; }
  if (plane) {
    // weighted least squares of log(light) = a + b x + c y, per channel
    const out = new Float32Array(gw * gh * 3);
    for (let c = 0; c < 3; c++) {
      let s = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, t = 0, tx = 0, ty = 0;
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
        const o = y * gw + x, wt = Wt[o];
        if (wt < 0.25) continue;
        const X = x / gw - 0.5, Yc = y / gh - 0.5, v = Math.log(Math.max(1e-4, C[o * 3 + c]));
        s += wt; sx += wt * X; sy += wt * Yc; sxx += wt * X * X; syy += wt * Yc * Yc; sxy += wt * X * Yc;
        t += wt * v; tx += wt * v * X; ty += wt * v * Yc;
      }
      const sol = solve3([[s, sx, sy], [sx, sxx, sxy], [sy, sxy, syy]], [t, tx, ty]) || [Math.log(Math.max(1e-4, fallback[c])), 0, 0];
      for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) out[(y * gw + x) * 3 + c] = Math.exp(sol[0] + sol[1] * (x / gw - 0.5) + sol[2] * (y / gh - 0.5));
    }
    return out;
  }
  return boxBlur3(pullPush(C, Wt, gw, gh, fallback), gw, gh, R, 3);
}
function solve3(A, b) {
  const det = (m) => m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  if (!(Math.abs(D) > 1e-12)) return null;
  return [0, 1, 2].map((k) => det(A.map((row, r) => row.map((v, c) => (c === k ? b[r] : v)))) / D);
}

/* ======================================================================
   4. Opaque panels
   ====================================================================== */
// The panel's border fades into the plain fabric (its colour and grain) over FEATHER px, cosine-shaped:
// wherever the stage's projection ends, no edge or rectangle shows. Still fully opaque.
function featherEdge(rgb, w, h, fabric, tile) {
  const hf = tile.hf, F = fabric.rgb;
  for (let y = 0; y < h; y++) {
    const dy = Math.min(y, h - 1 - y), trow = (y & 255) << 8;
    for (let x = 0; x < w; x++) {
      const d = Math.min(dy, x, w - 1 - x);
      if (d >= FEATHER) { x = w - FEATHER - 1; continue; } // on to the right-hand border
      const f = 0.5 * (1 + Math.cos((Math.PI * (d + 0.5)) / FEATHER)), o = (y * w + x) * 3, t = (trow | (x & 255)) * 3;
      for (let c = 0; c < 3; c++) rgb[o + c] = clamp255(rgb[o + c] * (1 - f) + (F[c] + hf[t + c]) * f);
    }
  }
  return rgb;
}
// Holes and background filled from the garment around them (pull-push), the edge cross-faded over a
// few pixels, and the filled part given the fabric's grain, so nothing looks cut out.
async function finishPanel(p, fabric, tile) {
  const { w, h, rgb, valid } = p;
  const n = w * h;
  let any = false;
  for (let i = 0; i < n; i++) if (valid[i]) { any = true; break; }
  if (!any) return plainPanel(w, h, fabric, tile);
  // The fill (pull-push) at half size, as it's smooth anyway; read back bilinearly.
  const w2 = w >> 1, h2 = h >> 1, rgb2 = new Float32Array(w2 * h2 * 3), v2 = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    const o = y * w2 + x, a = (y * 2) * w + x * 2;
    let sv = 0, r = 0, g = 0, b = 0;
    for (let q = 0; q < 4; q++) {
      const i = a + (q & 1) + (q >> 1) * w, v = valid[i];
      sv += v; r += rgb[i * 3] * v; g += rgb[i * 3 + 1] * v; b += rgb[i * 3 + 2] * v;
    }
    v2[o] = sv / 4;
    if (sv) { rgb2[o * 3] = r / sv; rgb2[o * 3 + 1] = g / sv; rgb2[o * 3 + 2] = b / sv; }
  }
  const fill2 = pullPush(rgb2, v2, w2, h2, fabric.rgb);
  await yieldNow();
  // Far from the garment the fill turns into the plain fabric, not a smear of whatever was nearest.
  const R = Math.max(2, Math.round(w2 * 0.03)), near = boxBlur1(boxBlur1(v2, w2, h2, R), w2, h2, R), F = fabric.rgb;
  for (let o = 0; o < w2 * h2; o++) {
    const f = Math.min(1, near[o] * 4);
    for (let k = 0; k < 3; k++) fill2[o * 3 + k] = F[k] + (fill2[o * 3 + k] - F[k]) * f;
  }
  // Feather the edge over ~3 px and give the filled part the fabric's grain; the fill read back
  // bilinearly where it shows.
  const soft = boxBlur1(boxBlur1(valid, w, h, 1), w, h, 1), hf = tile.hf, out = new Float32Array(n * 3), f3 = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    const trow = (y & 255) << 8;
    const fy = Math.max(0, Math.min(h2 - 1, (y + 0.5) / 2 - 0.5)), y0 = Math.floor(fy), y1 = Math.min(h2 - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x, o = i * 3;
      if (valid[i] && soft[i] > 0.999) { out[o] = rgb[o]; out[o + 1] = rgb[o + 1]; out[o + 2] = rgb[o + 2]; continue; }
      const fx = Math.max(0, Math.min(w2 - 1, (x + 0.5) / 2 - 0.5)), x0 = Math.floor(fx), x1 = Math.min(w2 - 1, x0 + 1), tx = fx - x0;
      const pa = (y0 * w2 + x0) * 3, pb = (y0 * w2 + x1) * 3, pc = (y1 * w2 + x0) * 3, pd = (y1 * w2 + x1) * 3;
      for (let k = 0; k < 3; k++) f3[k] = (fill2[pa + k] * (1 - tx) + fill2[pb + k] * tx) * (1 - ty) + (fill2[pc + k] * (1 - tx) + fill2[pd + k] * tx) * ty;
      const a = valid[i] ? soft[i] : 0, t = (trow | (x & 255)) * 3;
      for (let k = 0; k < 3; k++) out[o + k] = clamp255(f3[k] * (1 - a) + (a ? rgb[o + k] : f3[k]) * a + hf[t + k] * (1 - a));
    }
  }
  return out;
}
// A back with no photo: the fabric with its grain, and the trim colour along the hem.
function plainPanel(w, h, fabric, tile) {
  const out = new Float32Array(w * h * 3), T = TILE, band = Math.round(h * 0.94);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3, t = ((y % T) * T + (x % T)) * 3;
    const base = fabric.trim && y >= band ? fabric.trim : fabric.rgb;
    for (let c = 0; c < 3; c++) out[i + c] = clamp255(base[c] + tile.hf[t + c]);
  }
  return out;
}
function mirrored(rgb, w, h) {
  const out = new Float32Array(rgb.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 3, j = (y * w + (w - 1 - x)) * 3;
    out[i] = rgb[j]; out[i + 1] = rgb[j + 1]; out[i + 2] = rgb[j + 2];
  }
  return out;
}
// Pull-push: average the valid pixels down a pyramid, then fill each level's gaps from the level
// below it (bilinear), from the coarsest up. Smooth and local, like the cloth around the gap.
function pullPush(rgb, valid, w, h, fallback) {
  const levels = [{ w, h, c: new Float32Array(w * h * 3), a: new Float32Array(w * h) }];
  for (let i = 0; i < w * h; i++) {
    const v = valid[i];
    levels[0].a[i] = v;
    for (let c = 0; c < 3; c++) levels[0].c[i * 3 + c] = rgb[i * 3 + c] * v;
  }
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) {
    const p = levels[levels.length - 1];
    const W = Math.max(1, Math.ceil(p.w / 2)), H = Math.max(1, Math.ceil(p.h / 2));
    const c = new Float32Array(W * H * 3), a = new Float32Array(W * H);
    for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
      const i = y * p.w + x, j = (y >> 1) * W + (x >> 1);
      a[j] += p.a[i];
      for (let k = 0; k < 3; k++) c[j * 3 + k] += p.c[i * 3 + k];
    }
    levels.push({ w: W, h: H, c, a });
  }
  // normalise each level to plain colours with a 0-1 weight
  for (const l of levels) for (let i = 0; i < l.w * l.h; i++) {
    const a = l.a[i];
    for (let k = 0; k < 3; k++) l.c[i * 3 + k] = a > 0 ? l.c[i * 3 + k] / a : 0;
    l.a[i] = Math.min(1, a);
  }
  const top = levels[levels.length - 1];
  if (top.a[0] <= 0) for (let k = 0; k < 3; k++) top.c[k] = fallback[k];
  top.a[0] = 1;
  const tmp = new Float32Array(3);
  for (let li = levels.length - 2; li >= 0; li--) {
    const l = levels[li], up = levels[li + 1];
    for (let y = 0; y < l.h; y++) for (let x = 0; x < l.w; x++) {
      const i = y * l.w + x, a = l.a[i];
      if (a >= 1) continue;
      bilinear(up.c, up.w, up.h, (x + 0.5) / 2 - 0.5, (y + 0.5) / 2 - 0.5, tmp, 0);
      for (let k = 0; k < 3; k++) l.c[i * 3 + k] = l.c[i * 3 + k] * a + tmp[k] * (1 - a);
      l.a[i] = 1;
    }
  }
  return levels[0].c;
}

/* ======================================================================
   5. Normal and roughness maps
   ====================================================================== */
function normalsOf(rgb, w, h) {
  const n = w * h, L = new Float32Array(n);
  for (let i = 0; i < n; i++) L[i] = (0.299 * rgb[i * 3] + 0.587 * rgb[i * 3 + 1] + 0.114 * rgb[i * 3 + 2]) / 255;
  return normalsRGBA(boxBlur1(L, w, h, 1), w, h, 1.6, false);
}
// Tangent-space normals from a height map (Sobel), OpenGL style: +Y is up in the texture (three.js
// textures are flipped, so image-down is -v). `wrap`: the map tiles (the fabric tile).
function normalsRGBA(H, w, h, strength, wrap) {
  const out = new Uint8ClampedArray(w * h * 4), xm = new Int32Array(w), xp = new Int32Array(w);
  for (let x = 0; x < w; x++) { xm[x] = wrap ? (x - 1 + w) % w : Math.max(0, x - 1); xp[x] = wrap ? (x + 1) % w : Math.min(w - 1, x + 1); }
  for (let y = 0; y < h; y++) {
    const ym = (wrap ? (y - 1 + h) % h : Math.max(0, y - 1)) * w, yc = y * w, yp = (wrap ? (y + 1) % h : Math.min(h - 1, y + 1)) * w;
    for (let x = 0; x < w; x++) {
      const a = xm[x], b = xp[x];
      const gx = (H[ym + b] + 2 * H[yc + b] + H[yp + b] - H[ym + a] - 2 * H[yc + a] - H[yp + a]) / 8;
      const gy = (H[yp + a] + 2 * H[yp + x] + H[yp + b] - H[ym + a] - 2 * H[ym + x] - H[ym + b]) / 8;
      let nx = -gx * strength, ny = gy * strength;
      nx = nx < -0.35 ? -0.35 : nx > 0.35 ? 0.35 : nx;
      ny = ny < -0.35 ? -0.35 : ny > 0.35 ? 0.35 : ny;
      const il = 1 / Math.sqrt(nx * nx + ny * ny + 1), o = (yc + x) * 4;
      out[o] = (nx * il * 0.5 + 0.5) * 255; out[o + 1] = (ny * il * 0.5 + 0.5) * 255; out[o + 2] = (il * 0.5 + 0.5) * 255; out[o + 3] = 255;
    }
  }
  return out;
}
// Prints and coatings are a little smoother than the cloth: lower roughness where the colour is far
// from the fabric's.
function roughnessOfPanel(rgb, w, h, fabric, base) {
  const n = w * h, print = new Float32Array(n);
  const dist = fabric.dist;
  for (let i = 0; i < n; i++) print[i] = Math.min(1, Math.max(0, (dist[lutIndex(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2])] - fabric.tol) / 25));
  const soft = boxBlur1(print, w, h, 2);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const r = Math.max(0.15, Math.min(1, base - 0.18 * soft[i])) * 255;
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = r; out[i * 4 + 3] = 255;
  }
  return out;
}
// The sole's colour: the biggest group of the samples' colours (k-means in Lab), its median.
function dominantRGB(samples) {
  if (samples.length < 30) return null;
  const labs = samples.map((s) => labOf(s[0], s[1], s[2]));
  const { centers, assign, counts } = kmeans(labs, 3, 8);
  const top = counts.indexOf(Math.max(...counts));
  const group = new Set([top]);
  centers.forEach((c, k) => { if (k !== top && dE(c, centers[top]) < 14) group.add(k); });
  const ms = [];
  labs.forEach((_, i) => { if (group.has(assign[i])) ms.push(samples[i]); });
  return [0, 1, 2].map((c) => median(ms.map((s) => s[c])));
}
// Which 3D shoe the stage draws.
function shoeStyleOf(item) {
  const name = (item.name || "").toLowerCase();
  if (item.category === "boots" || /\bboots?\b/.test(name)) return "boot";
  if (/\bjordan\s*(1|4)\b|\bhigh\b|\bhi-?top\b|\bmid\b/.test(name)) return "high_top_sneaker";
  return "low_sneaker";
}
function roughnessOf(item, sub) {
  const c = item.category, name = (item.name || "").toLowerCase();
  if (c === "puffer") return 0.4;
  if (c === "rain") return 0.42;
  if (c === "coat") return 0.9;
  if (/leather/.test(name)) return 0.45;
  if (sub === "bomber") return /wool|varsity/.test(name) ? 0.85 : 0.45;
  if (sub === "jacket_open") return /blazer|suit/.test(name) ? 0.75 : /denim/.test(name) ? 0.8 : 0.65;
  if (sub === "jeans" || sub === "cargo") {
    if (["joggers", "track-pants", "gym-shorts"].includes(c) || /fleece|sweat|jogger/.test(name)) return 0.9;
    if (c === "leggings") return 0.5;
    if (c === "trousers" && !/cargo|denim/.test(name)) return 0.72;
    return 0.8;
  }
  if (sub === "sneakers") return /knit|mesh|suede|canvas/.test(name) ? 0.8 : c === "dress-shoes" ? 0.35 : 0.45;
  if (sub === "boots") return /timberland|nubuck|suede/.test(name) ? 0.9 : 0.5;
  if (c === "polo" || c === "shirt") return 0.8;
  return 0.88; // cotton tees, fleece hoodies, knits
}

/* ---------- small helpers ---------- */
function median(a) {
  if (!a.length) return NaN;
  const s = Float64Array.from(a).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
function percentile(a, p) {
  if (!a.length) return 0;
  const s = Float64Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
}
const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
const hexOf = (rgb) => "#" + rgb.map((v) => Math.round(clamp255(v)).toString(16).padStart(2, "0")).join("");
