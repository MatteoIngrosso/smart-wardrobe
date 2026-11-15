// The lookbook stage on Today: an "invisible mannequin". Only the clothes and accessories show,
// each piece's own cut-out photo floating in its own layer with depth and a soft shadow, stacked in
// a column as they're worn (hat, top, tie, layer, jacket, belt, bottoms, shoes), with the jewelry,
// watch, eyewear and bag docked in cards on either side.
// No WebGL, no canvas drawing, no library: plain <img> layers in a CSS 3D-transformed container, so
// the graphics chip composites them and nothing is redrawn while it moves. Dragging tilts the stack
// a little (parallax), pinch or the wheel zooms, a double tap resets, Front/Back flips to the back
// photos. Tapping a piece calls onSlot (app.js opens the picker for that slot); in Edit mode a piece
// can be dragged and resized, and onNudge reports its new cutoutMeta (scale, offsetX, offsetY, z).
import { STAGE_SLOTS, SLOT, STAGE_LAYOUT, SHORT_H, CARD, SIDE_ORDER, STAGE_MOTION, COLUMN_CM, cleanCutMeta } from "./avatar-config.js";

const COLUMN = STAGE_SLOTS.filter((s) => s.where === "column").map((s) => s.id);
const CARDS = [...SIDE_ORDER.left, ...SIDE_ORDER.right];
const Z_STEP = 12; // one step of cutoutMeta.z moves a layer past about one neighbour
const TAP_PX = 9, TAP_MS = 450, DOUBLE_MS = 320;
const MAX_KEPT = 60; // photos measured and kept decoded, about three days of outfits
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const SLOT_HINT = { hat: "a hat", top: "a top", tie: "a tie", layer: "a layer", jacket: "a jacket", belt: "a belt", bottoms: "bottoms", shoes: "shoes", jewelry: "jewelry", watch: "a watch", eyewear: "eyewear", bag: "a bag" };

/* ---------- its own styles (so it works on any page; the colours of the backdrop are the page's) ---------- */
const STYLE = `
.lb { position: absolute; inset: 0; touch-action: pan-y; cursor: grab; }
.lb.is-editing { touch-action: none; cursor: default; }
.lb-view, .lb-world, .lb-flip { position: absolute; inset: 0; transform-style: preserve-3d; }
.lb-world { will-change: transform; transform-origin: 50% 50%; }
.lb-world.lb-settle { transition: transform .6s cubic-bezier(.2, .8, .2, 1); }
.lb-floor { position: absolute; border-radius: 50%; background: radial-gradient(closest-side, rgba(0, 0, 0, .62), rgba(0, 0, 0, .28) 55%, transparent); transform: translateZ(0); pointer-events: none; }
.lb-slot, .lb-card { position: absolute; transform-style: preserve-3d; transition: opacity .25s ease; }
.lb-nudge { position: absolute; inset: 0; will-change: transform; }
.lb-img { position: absolute; max-width: none; pointer-events: none; -webkit-user-drag: none;
          filter: drop-shadow(0 0 1px rgba(255, 255, 255, .2)) drop-shadow(0 14px 16px rgba(0, 0, 0, .5)) drop-shadow(0 2px 3px rgba(0, 0, 0, .35)); }
.lb-mirror { transform: scaleX(-1); }
.lb-slot.is-empty .lb-img, .lb-card.is-empty .lb-img { display: none; }
.lb-slot.is-off, .lb-card.is-off { opacity: 0; pointer-events: none; }
.lb-slot.is-selected .lb-img, .lb-card.is-selected .lb-img { filter: drop-shadow(0 0 1.5px #f2f2f2) drop-shadow(0 0 1.5px #f2f2f2) drop-shadow(0 14px 16px rgba(0, 0, 0, .5)); }
.lb[data-side="back"] .lb-slot[data-slot="tie"], .lb[data-side="back"] .lb-card[data-slot="jewelry"] { opacity: 0; pointer-events: none; }
.lb-slot.no-back .lb-img { opacity: .55; }
.lb-slot { pointer-events: none; }
.lb-card { display: grid; place-items: center; border-radius: 18px; background: radial-gradient(90% 90% at 50% 40%, rgba(255, 255, 255, .13), rgba(255, 255, 255, .05)); border: 1px solid rgba(255, 255, 255, .1);
           box-shadow: 0 18px 30px rgba(0, 0, 0, .35); }
.lb-card .lb-nudge { border-radius: inherit; }
.lb-card-label { position: absolute; left: 0; right: 0; top: calc(100% + 6px); text-align: center; font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #8f8c86; }
.lb-card.is-empty { visibility: hidden; }
/* Editing: the empty slots show as faint dashed outlines, each one a place to add a piece. */
.lb.is-editing .lb-slot.is-empty, .lb.is-editing .lb-card.is-empty { visibility: visible; pointer-events: auto; border: 1.5px dashed rgba(242, 242, 242, .18); border-radius: 14px; background: none; box-shadow: none; cursor: pointer; }
.lb.is-editing .lb-slot.is-empty::after { content: attr(data-slot); position: absolute; inset: 0; display: grid; place-items: center; font-size: 11px; letter-spacing: .08em; text-transform: uppercase; color: rgba(242, 242, 242, .32); }
.lb.is-editing .lb-slot:not(.is-empty) .lb-img { cursor: move; }
.lb.is-paused .lb-world { visibility: hidden; }
.lb-tools { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; align-items: center; gap: 6px; padding: 6px; border-radius: 999px;
            background: rgba(20, 20, 19, .86); border: 1px solid #3a3833; max-width: calc(100% - 24px); overflow-x: auto; }
.lb-tools[hidden] { display: none; }
.lb-tools-name { padding: 0 8px 0 10px; font-size: 14px; color: #b9b6ae; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 180px; }
.lb-tools button { min-height: 44px; min-width: 44px; padding: 0 12px; border-radius: 999px; border: 1px solid #3a3833; background: #1d1c1a; color: #f2f2f2; font-size: 15px; }
`;
function addStyle() {
  if (document.getElementById("lb-style")) return;
  const el = document.createElement("style");
  el.id = "lb-style";
  el.textContent = STYLE;
  document.head.append(el);
}

/* ---------- the garment inside its photo ---------- */
// Where the garment is inside its photo (the box of its opaque pixels, found at 128 px), so a piece is
// placed by the garment, not by the photo's margins: an old cut-out with wide margins and a framed
// one land the same. Measured once per photo address.
const measured = new Map(); // src → Promise<{ W, H, box: [x, y, w, h] }>
function loadImage(src) {
  const img = new Image();
  img.decoding = "async";
  img.draggable = false;
  img.alt = "";
  img.src = src;
  return (img.decode ? img.decode() : new Promise((r, j) => { img.onload = r; img.onerror = j; })).then(() => img);
}
function measureImage(img) {
  const W = img.naturalWidth || 1, H = img.naturalHeight || 1, full = { W, H, box: [0, 0, 1, 1] };
  const k = 128 / Math.max(W, H), w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  try {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(img, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    const alpha = new Uint8Array(w * h); // where the garment is, for taps (a tap on a see-through margin goes through)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (d[(y * w + x) * 4 + 3] > 24) { alpha[y * w + x] = 1; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    c.width = c.height = 0;
    return x1 < 0 ? full : { W, H, box: [x0 / w, y0 / h, (x1 + 1 - x0) / w, (y1 + 1 - y0) / h], alpha, aw: w, ah: h };
  } catch { return full; } // (a photo from elsewhere that can't be read: its whole frame)
}
function prepare(src) {
  let p = measured.get(src);
  if (!p) {
    p = loadImage(src).then((img) => ({ img, m: measureImage(img) }));
    measured.set(src, p);
    p.catch(() => measured.delete(src));
    if (measured.size > MAX_KEPT) measured.delete(measured.keys().next().value); // (the oldest)
  }
  // every layer gets its own <img> (the decoded picture is shared by the browser)
  return p.then(({ img, m }) => ({ img: img.isConnected ? cloneImg(img) : img, m }));
}
const cloneImg = (img) => Object.assign(img.cloneNode(), { draggable: false });

/**
 * @param {HTMLElement} container  the stage fills it
 * @param {{ onSlot?: (slot:string, o:{id:string|null, editing:boolean}) => void,
 *           onNudge?: (slot:string, id:string, meta:object) => void }} [opts]
 */
export function createStage(container, { onSlot, onNudge } = {}) {
  const st = {
    worn: {}, // slot → { id, src, on, meta, category, name, el, m }
    want: {}, // slot → the spec asked for last
    req: {}, // slot → request number (a slower photo never overwrites the one asked for last)
    side: "front", editing: false, selected: null, tuck: false, paused: false, disposed: false,
    tilt: { x: 0, y: 0 }, zoom: 1, pan: { x: 0, y: 0 },
    box: null, sizeStale: false, frames: 0, lastFrameMs: 0, layouts: 0,
  };
  addStyle();
  const root = document.createElement("div");
  root.className = "lb";
  root.dataset.side = "front";
  root.innerHTML = `<div class="lb-view"><div class="lb-world"><div class="lb-flip"><div class="lb-floor"></div></div></div></div>
    <div class="lb-tools" role="toolbar" aria-label="Arrange this piece" hidden>
      <span class="lb-tools-name"></span>
      <button type="button" data-lbt="smaller" aria-label="Smaller">−</button><button type="button" data-lbt="bigger" aria-label="Bigger">+</button>
      <button type="button" data-lbt="back">Back</button><button type="button" data-lbt="front">Forward</button>
      <button type="button" data-lbt="reset">Reset</button><button type="button" data-lbt="change">Change</button>
    </div>`;
  container.append(root);
  const view = root.querySelector(".lb-view"), world = root.querySelector(".lb-world"), flip = root.querySelector(".lb-flip");
  const floor = root.querySelector(".lb-floor"), tools = root.querySelector(".lb-tools");
  view.style.perspective = `${STAGE_MOTION.perspective}px`;

  // One element per slot, made once: a column layer (a box, a nudge wrapper, the photo) or a card.
  const els = {};
  for (const s of STAGE_SLOTS) {
    const el = document.createElement("div");
    el.dataset.slot = s.id;
    el.className = s.where === "column" ? "lb-slot is-empty" : `lb-card lb-${s.where} is-empty`;
    el.setAttribute("role", "button");
    el.setAttribute("aria-label", `${s.label}: none`);
    el.innerHTML = s.where === "column" ? `<div class="lb-nudge"></div>` : `<div class="lb-nudge"></div><span class="lb-card-label">${s.label}</span>`;
    flip.append(el);
    els[s.id] = el;
  }

  /* ---------- layout: where every slot sits for this size ---------- */
  function measureBox() {
    const W = container.clientWidth, H = container.clientHeight;
    if (!W || !H) { st.sizeStale = true; return null; } // hidden: keep the last layout
    st.sizeStale = false;
    const card = (h) => Math.min(CARD.max, h * CARD.size);
    let h = H * 0.9;
    while (h > 160 && h * 0.56 + 2 * (card(h) + 20) > W) h *= 0.96; // room for the cards on both sides
    const top = (H - h) * 0.5;
    return { W, H, h, top, cx: W / 2, cm: h / COLUMN_CM, card: card(h) };
  }
  // The column slot's box in px, inside the stage.
  function slotBox(slot, b) {
    const L = STAGE_LAYOUT[slot], w = st.worn[slot];
    const hh = (slot === "bottoms" && w?.short ? SHORT_H : L.h) * b.h, ww = L.w * b.h;
    return { left: b.cx - ww / 2, top: b.top + L.top * b.h, width: ww, height: hh, anchor: L.anchor };
  }
  function cardBox(slot, b) {
    const side = SIDE_ORDER.left.includes(slot) ? "left" : "right", i = SIDE_ORDER[side].indexOf(slot);
    const c = b.card, gap = Math.max(10, c * 0.22) + 22; // (its label under it)
    const x = side === "left" ? Math.max(10, b.cx - b.h * 0.29 - c - 14) : Math.min(b.W - c - 10, b.cx + b.h * 0.29 + 14);
    return { left: x, top: b.top + b.h * 0.12 + i * (c + gap), width: c, height: c, anchor: "center" };
  }
  // The photo inside a box: the garment (not the photo) fits the box, keeping its own shape.
  function fitInto(m, box, pad = 0) {
    const [bx, by, bw, bh] = m.box, gw = Math.max(1, bw * m.W), gh = Math.max(1, bh * m.H);
    const aw = box.width * (1 - pad * 2), ah = box.height * (1 - pad * 2);
    const s = Math.min(aw / gw, ah / gh);
    const w = m.W * s, h = m.H * s;
    const left = box.width / 2 - (bx + bw / 2) * m.W * s;
    const top = box.anchor === "top" ? -by * m.H * s
      : box.anchor === "bottom" ? box.height - (by + bh) * m.H * s
      : box.height / 2 - (by + bh / 2) * m.H * s;
    return { left, top, width: w, height: h, gw: gw * s, gh: gh * s };
  }
  const zOf = (slot) => {
    const w = st.worn[slot];
    if (SLOT[slot].where !== "column") return CARD.z;
    let z = STAGE_LAYOUT[slot].z;
    if (slot === "top" && st.tuck && st.worn.bottoms?.on) z = 3; // tucked in: under the bottoms' waistband
    return z + (w?.meta?.z || 0) * Z_STEP;
  };
  function placeSlot(slot) {
    const b = st.box, w = st.worn[slot], el = els[slot];
    if (!b) return;
    const card = SLOT[slot].where !== "column";
    const box = card ? cardBox(slot, b) : slotBox(slot, b);
    Object.assign(el.style, { left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px`, zIndex: String(Math.round(zOf(slot) + 100)) });
    el.style.transform = `translateZ(${(zOf(slot) * STAGE_MOTION.depthPerZ).toFixed(1)}px)`;
    const nudge = el.firstElementChild, imgs = nudge.querySelectorAll("img");
    if (!w || !imgs.length) { nudge.style.transform = ""; return; }
    // the photo(s)
    if (slot === "shoes" && imgs.length === 2) { // a side view: the pair, one mirrored, toes out
      const half = { ...box, width: box.width * 0.56 };
      const f = fitInto(w.m, half);
      imgs.forEach((img, k) => Object.assign(img.style, { left: `${(k ? box.width - half.width : 0) + f.left}px`, top: `${f.top}px`, width: `${f.width}px`, height: `${f.height}px` }));
    } else {
      const f = fitInto(w.m, box, card ? 0.12 : 0);
      Object.assign(imgs[0].style, { left: `${f.left}px`, top: `${f.top}px`, width: `${f.width}px`, height: `${f.height}px` });
    }
    applyNudge(slot);
    // tucked in: the top stops at the waistband
    if (slot === "top") {
      const cut = st.tuck && st.worn.bottoms?.on && !card ? Math.max(0, box.top + box.height - (b.top + STAGE_LAYOUT.bottoms.top * b.h) - b.h * 0.012) : 0;
      el.style.clipPath = cut ? `inset(-40px -40px ${cut}px -40px)` : "";
    }
  }
  function applyNudge(slot) {
    const b = st.box, w = st.worn[slot], el = els[slot];
    if (!b || !w) return;
    const m = w.meta || {}, sign = st.side === "back" ? -1 : 1; // seen from behind, right is left
    const origin = SLOT[slot].where !== "column" ? "50% 50%" : STAGE_LAYOUT[slot].anchor === "bottom" ? "50% 100%" : STAGE_LAYOUT[slot].anchor === "top" ? "50% 0%" : "50% 50%";
    const nudge = el.firstElementChild;
    nudge.style.transformOrigin = origin;
    nudge.style.transform = `translate(${((m.offsetX || 0) * b.cm * sign).toFixed(1)}px, ${(-(m.offsetY || 0) * b.cm).toFixed(1)}px) scale(${m.scale ?? 1})`;
  }
  function placeFloor() {
    const b = st.box;
    if (!b) return;
    const feet = st.worn.shoes?.on ? 0.995 : st.worn.bottoms?.on ? (st.worn.bottoms.short ? STAGE_LAYOUT.bottoms.top + SHORT_H : 0.9) + 0.02 : 0.6;
    Object.assign(floor.style, { left: `${b.cx - b.h * 0.24}px`, top: `${b.top + feet * b.h - b.h * 0.02}px`, width: `${b.h * 0.48}px`, height: `${b.h * 0.045}px` });
  }
  function layout() {
    const b = measureBox();
    if (!b) return;
    st.box = b;
    st.layouts++;
    for (const s of STAGE_SLOTS) placeSlot(s.id);
    placeFloor();
    placeTools();
  }

  /* ---------- what's worn ---------- */
  const sameMeta = (a, b) => JSON.stringify(a || {}) === JSON.stringify(b || {});
  const srcFor = (spec) => (st.side === "back" && spec.back ? spec.back : spec.front);
  // Put one slot's piece on (or take it off). Resolves when its photo shows.
  async function putOn(slot, spec) {
    const el = els[slot], now = st.worn[slot];
    if (!spec || !spec.front) {
      st.req[slot] = (st.req[slot] || 0) + 1;
      if (now) { el.firstElementChild.replaceChildren(); delete st.worn[slot]; }
      paintSlot(slot);
      return;
    }
    const src = srcFor(spec), meta = cleanCutMeta(spec.meta), short = !!spec.short;
    if (now && now.id === spec.id && now.src === src) { // the same photo: only its state changes
      const moved = !sameMeta(now.meta, meta) || now.short !== short;
      Object.assign(now, { on: spec.on !== false, meta, short, name: spec.name || now.name });
      paintSlot(slot);
      if (moved) { placeSlot(slot); placeFloor(); }
      return;
    }
    const req = (st.req[slot] = (st.req[slot] || 0) + 1);
    let got;
    try { got = await prepare(src); } catch (e) { if (st.req[slot] === req) console.warn("Lookbook: couldn't show", spec.name, e); return; }
    if (st.req[slot] !== req || st.disposed) return; // something else was asked for since
    const { img, m } = got, nudge = el.firstElementChild;
    img.className = "lb-img";
    const imgs = [img];
    // shoes photographed from the side: the pair, the left one mirrored
    if (slot === "shoes" && (m.box[2] * m.W) / Math.max(1, m.box[3] * m.H) > 1.35) { const twin = cloneImg(img); twin.className = "lb-img lb-mirror"; imgs.unshift(twin); }
    nudge.replaceChildren(...imgs);
    st.worn[slot] = { id: spec.id, src, on: spec.on !== false, meta, short, category: spec.category, name: spec.name || "", m, hasBack: !!spec.back };
    paintSlot(slot);
    placeSlot(slot);
    if (slot === "bottoms" || slot === "shoes") { placeFloor(); placeSlot("top"); }
  }
  function paintSlot(slot) {
    const el = els[slot], w = st.worn[slot], label = SLOT[slot].label;
    el.classList.toggle("is-empty", !w);
    el.classList.toggle("is-off", !!w && !w.on);
    el.classList.toggle("is-selected", st.selected === slot);
    el.classList.toggle("no-back", !!w && st.side === "back" && !w.hasBack);
    el.setAttribute("aria-label", w ? `${label}: ${w.name}${w.on ? "" : " (taken off)"}` : `${label}: none. Tap to add ${SLOT_HINT[slot]}.`);
    el.tabIndex = w || st.editing ? 0 : -1;
  }
  // The outfit: { slot: { id, name, front, back, meta, on, category, short } }, anything missing is empty.
  async function set(spec = {}, { tuck = st.tuck } = {}) {
    const tuckChanged = !!tuck !== st.tuck;
    st.tuck = !!tuck;
    st.want = spec;
    await Promise.all(STAGE_SLOTS.map((s) => putOn(s.id, spec[s.id] || null)));
    if (tuckChanged) { placeSlot("top"); }
    if (st.selected && !st.worn[st.selected] && !st.editing) select(null);
    placeFloor();
    placeTools();
  }

  /* ---------- moving it: tilt, zoom, pan ---------- */
  let raf = 0;
  function writeWorld() {
    raf = 0;
    if (st.paused) return;
    const t0 = performance.now();
    const { x: tx, y: ty } = st.tilt;
    world.style.transform = `translate(${st.pan.x.toFixed(1)}px, ${st.pan.y.toFixed(1)}px) scale(${st.zoom.toFixed(3)}) rotateX(${tx.toFixed(2)}deg) rotateY(${ty.toFixed(2)}deg)`;
    st.frames++;
    st.lastFrameMs = performance.now() - t0;
  }
  const schedule = () => { if (!raf && !st.paused) raf = requestAnimationFrame(writeWorld); };
  function settle() {
    world.classList.add("lb-settle");
    st.tilt = { x: 0, y: 0 };
    schedule();
    setTimeout(() => world.classList.remove("lb-settle"), 650);
  }
  function reset() {
    world.classList.add("lb-settle");
    st.tilt = { x: 0, y: 0 }; st.zoom = 1; st.pan = { x: 0, y: 0 };
    schedule();
    setTimeout(() => world.classList.remove("lb-settle"), 650);
  }
  const clampPan = () => {
    const b = st.box || { W: 0, H: 0 }, mx = ((st.zoom - 1) * b.W) / 2, my = ((st.zoom - 1) * b.H) / 2;
    st.pan.x = clamp(st.pan.x, -mx, mx); st.pan.y = clamp(st.pan.y, -my, my);
  };
  function zoomBy(f) {
    st.zoom = clamp(st.zoom * f, STAGE_MOTION.zoom[0], STAGE_MOTION.zoom[1]);
    clampPan();
    schedule();
  }

  /* ---------- pointer: tap, drag, pinch ---------- */
  const pts = new Map(); // pointerId → { x, y }
  let gesture = null, lastTap = { t: 0, x: 0, y: 0 };
  // The piece under a point: the cards by their square, the column by the garment's own pixels (a
  // tap on the see-through margin of a jacket's photo reaches the jeans under it), front to back.
  // In Edit mode an empty place counts too.
  function slotAt(x, y) {
    const inside = (r) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
    const hidden = (slot) => st.side === "back" && (slot === "tie" || slot === "jewelry");
    for (const slot of CARDS) if (!hidden(slot) && (st.worn[slot]?.on || st.editing) && inside(els[slot].getBoundingClientRect())) return slot;
    const order = COLUMN.filter((k) => st.worn[k]?.on && !hidden(k)).sort((a, b) => zOf(b) - zOf(a));
    for (const slot of order) {
      const m = st.worn[slot].m;
      for (const img of els[slot].querySelectorAll("img")) {
        const r = img.getBoundingClientRect();
        if (!inside(r)) continue;
        if (!m.alpha) return slot;
        let u = (x - r.left) / r.width, v = (y - r.top) / r.height;
        if (img.classList.contains("lb-mirror")) u = 1 - u;
        const cx = Math.floor(u * m.aw), cy = Math.floor(v * m.ah);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const px = cx + dx, py = cy + dy;
          if (px >= 0 && py >= 0 && px < m.aw && py < m.ah && m.alpha[py * m.aw + px]) return slot;
        }
      }
    }
    if (st.editing) for (const slot of COLUMN) if (!st.worn[slot] && inside(els[slot].getBoundingClientRect())) return slot;
    return null;
  }
  function onDown(e) {
    if (st.paused || e.target.closest(".lb-tools")) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    try { root.setPointerCapture(e.pointerId); } catch { /* (an old browser) */ }
    if (pts.size === 2) { // pinch
      const [a, b] = [...pts.values()];
      gesture = { kind: "pinch", d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: st.zoom };
      return;
    }
    const slot = slotAt(e.clientX, e.clientY);
    const w = slot && st.worn[slot];
    gesture = {
      kind: st.editing && w && SLOT[slot].where === "column" ? "nudge" : st.zoom > 1.01 ? "pan" : "tilt",
      slot, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false,
      meta0: w ? { ...w.meta } : null, pan0: { ...st.pan },
    };
  }
  function onMove(e) {
    if (!pts.has(e.pointerId) || !gesture) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture.kind === "pinch") {
      if (pts.size < 2) return;
      const [a, b] = [...pts.values()];
      st.zoom = clamp(gesture.z0 * (Math.hypot(a.x - b.x, a.y - b.y) / gesture.d0), STAGE_MOTION.zoom[0], STAGE_MOTION.zoom[1]);
      clampPan();
      return schedule();
    }
    const dx = e.clientX - gesture.x0, dy = e.clientY - gesture.y0;
    if (!gesture.moved && Math.hypot(dx, dy) < TAP_PX) return;
    gesture.moved = true;
    const b = st.box || { W: 1, H: 1, cm: 1 };
    if (gesture.kind === "nudge") {
      const w = st.worn[gesture.slot];
      if (!w) return;
      const sign = st.side === "back" ? -1 : 1, z = st.zoom;
      w.meta = cleanCutMeta({ ...gesture.meta0, offsetX: (gesture.meta0.offsetX || 0) + (dx / z / b.cm) * sign, offsetY: (gesture.meta0.offsetY || 0) - dy / z / b.cm });
      applyNudge(gesture.slot);
      return;
    }
    if (gesture.kind === "pan") {
      st.pan = { x: gesture.pan0.x + dx, y: gesture.pan0.y + dy };
      clampPan();
      return schedule();
    }
    const max = STAGE_MOTION.tilt;
    st.tilt = { x: clamp((-dy / b.H) * 2 * max, -max, max), y: clamp((dx / b.W) * 2 * max, -max, max) };
    schedule();
  }
  function onUp(e) {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    const g = gesture;
    if (g?.kind === "pinch") { if (!pts.size) gesture = null; return; }
    gesture = null;
    if (!g) return;
    if (e.type === "pointercancel") { if (g.kind === "tilt") settle(); return; }
    if (g.moved) {
      if (g.kind === "tilt") settle();
      if (g.kind === "nudge") { const w = st.worn[g.slot]; if (w) { placeSlot(g.slot); onNudge?.(g.slot, w.id, w.meta); } }
      return;
    }
    if (performance.now() - g.t0 > TAP_MS) return;
    tap(g.slot, e.clientX, e.clientY);
  }
  function tap(slot, x, y) {
    const now = performance.now();
    const double = now - lastTap.t < DOUBLE_MS && Math.hypot(x - lastTap.x, y - lastTap.y) < 30;
    lastTap = { t: double ? 0 : now, x, y };
    if (!slot) {
      if (double) reset();
      else if (st.selected) select(null);
      return;
    }
    const w = st.worn[slot];
    if (!w && !st.editing) return; // (an empty slot only shows, and takes taps, while editing)
    select(slot);
    // in Edit mode a tap picks the piece to arrange (Change opens the picker); otherwise it opens the picker
    if (!st.editing || !w) onSlot?.(slot, { id: w?.id || null, editing: st.editing });
  }
  const onWheel = (e) => {
    if (st.paused) return;
    e.preventDefault();
    zoomBy(Math.exp(-e.deltaY * 0.0015));
  };
  const onDbl = (e) => { if (!slotAt(e.clientX, e.clientY)) reset(); };
  const onKey = (e) => {
    if (e.key === "Escape" && st.selected) { select(null); e.stopPropagation(); }
    const s = e.target?.closest?.("[data-slot]")?.dataset.slot;
    if ((e.key === "Enter" || e.key === " ") && s) { e.preventDefault(); select(s); onSlot?.(s, { id: st.worn[s]?.id || null, editing: st.editing }); }
  };
  root.addEventListener("pointerdown", onDown);
  root.addEventListener("pointermove", onMove);
  root.addEventListener("pointerup", onUp);
  root.addEventListener("pointercancel", onUp);
  root.addEventListener("wheel", onWheel, { passive: false });
  root.addEventListener("dblclick", onDbl);
  root.addEventListener("keydown", onKey);
  root.addEventListener("dragstart", (e) => e.preventDefault());

  /* ---------- Edit mode: the selected piece's toolbar ---------- */
  function select(slot) {
    const was = st.selected;
    st.selected = slot && SLOT[slot] ? slot : null;
    if (was && was !== st.selected) paintSlot(was);
    if (st.selected) paintSlot(st.selected);
    placeTools();
  }
  function placeTools() {
    const w = st.selected && st.worn[st.selected];
    const show = st.editing && !!w && SLOT[st.selected].where === "column";
    tools.hidden = !show;
    if (show) tools.querySelector(".lb-tools-name").textContent = w.name || SLOT[st.selected].label;
  }
  tools.addEventListener("click", (e) => {
    const k = e.target.closest("[data-lbt]")?.dataset.lbt, slot = st.selected, w = slot && st.worn[slot];
    if (!k || !w) return;
    if (k === "change") return onSlot?.(slot, { id: w.id, editing: true, change: true });
    const m = { ...w.meta };
    if (k === "smaller") m.scale = (m.scale ?? 1) - 0.05;
    if (k === "bigger") m.scale = (m.scale ?? 1) + 0.05;
    if (k === "back") m.z = (m.z || 0) - 1;
    if (k === "front") m.z = (m.z || 0) + 1;
    w.meta = cleanCutMeta(k === "reset" ? { aspectRatio: m.aspectRatio, trimBounds: m.trimBounds } : m);
    placeSlot(slot);
    onNudge?.(slot, w.id, w.meta);
  });
  function setEditing(on) {
    st.editing = !!on;
    root.classList.toggle("is-editing", st.editing);
    for (const s of STAGE_SLOTS) paintSlot(s.id);
    if (!st.editing && st.selected) select(null);
    placeTools();
  }

  /* ---------- Front / Back ---------- */
  const calm = () => st.paused || matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  async function setSide(side) {
    side = side === "back" ? "back" : "front";
    if (side === st.side) return;
    const anim = !calm() && flip.animate;
    if (anim) await flip.animate([{ transform: "rotateY(0deg)" }, { transform: "rotateY(90deg)" }], { duration: 140, easing: "ease-in" }).finished.catch(() => {});
    st.side = side;
    root.dataset.side = side;
    await set(st.want, { tuck: st.tuck });
    for (const s of STAGE_SLOTS) { paintSlot(s.id); applyNudge(s.id); }
    if (anim) await flip.animate([{ transform: "rotateY(-90deg)" }, { transform: "rotateY(0deg)" }], { duration: 200, easing: "ease-out" }).finished.catch(() => {});
  }

  /* ---------- size, pause, dispose ---------- */
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => layout()) : null;
  ro?.observe(container);
  layout();

  return {
    set,
    setSide,
    get side() { return st.side; },
    setEditing,
    get editing() { return st.editing; },
    select,
    get selected() { return st.selected; },
    reset,
    zoomBy,
    // the stage moved to another container (Today, a sheet)
    mount(next) {
      if (next && root.parentNode !== next) { ro?.unobserve(container); container = next; next.append(root); ro?.observe(next); }
      layout();
    },
    resize: layout,
    // The ambient screen covers it: nothing moves or is written until it's back.
    pause() { st.paused = true; if (raf) cancelAnimationFrame(raf); raf = 0; root.classList.add("is-paused"); },
    resume() { st.paused = false; root.classList.remove("is-paused"); layout(); schedule(); },
    get paused() { return st.paused; },
    dispose() {
      st.disposed = true;
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
      root.remove();
    },
    debug: {
      state: st,
      get frames() { return st.frames; },
      get lastFrameMs() { return st.lastFrameMs; },
      // the diagnostics' speed test: one tilt written now, in this frame
      tiltNow(x, y) { st.tilt = { x: clamp(x, -STAGE_MOTION.tilt, STAGE_MOTION.tilt), y: clamp(y, -STAGE_MOTION.tilt, STAGE_MOTION.tilt) }; writeWorld(); },
      // what's on the stage, back to front, with where it shows (for tests and the diagnostics)
      layers() {
        return STAGE_SLOTS.filter((s) => st.worn[s.id]).map((s) => {
          const r = els[s.id].firstElementChild.querySelector("img")?.getBoundingClientRect();
          const [bx, by, bw, bh] = st.worn[s.id].m.box;
          return { slot: s.id, id: st.worn[s.id].id, on: st.worn[s.id].on, z: zOf(s.id), rect: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null,
            // the garment itself (its opaque pixels), where it shows
            garment: r ? { x: r.x + bx * r.width, y: r.y + by * r.height, w: bw * r.width, h: bh * r.height } : null };
        }).sort((a, b) => a.z - b.z);
      },
      root,
      COLUMN, CARDS,
    },
  };
}
