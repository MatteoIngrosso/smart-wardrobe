/* ======================================================================
   Fixing a cut-out by hand
   A full-screen editor over the photo, made for fingers:
   - Erase: paint over background the AI left in.
   - Restore: paint back parts of the piece the AI cut off.
   - Cut around: draw a loop round the piece, everything outside goes.
   - Move: one finger moves the photo (two fingers always pinch and move).
   The editor works on a mask the size of the photo (at most WORK_MAX px on
   its longest side): white where the piece is kept. editCutout() resolves
   with the new mask at the photo's own size, or null if cancelled.
   Undo / redo replay strokes: the last UNDO_MAX of them. Older strokes are
   painted into a checkpoint copy of the mask, so an undo never replays more
   than UNDO_MAX strokes and memory stays the same however long you edit.
   Closing the editor empties the stacks and frees every canvas it made.

   The second half of this file is the cut-out pipeline the app shares:
   photos are scaled to WORK_MAX when they come in (workingCopy), the
   colour-based background removal for when the AI can't run (basicCutout),
   and the last step of every cut-out (frameCutout): trimmed to the piece,
   edges defringed, centred on a 768x1024 frame and saved as WebP.
   ====================================================================== */

/** Longest side, in px, that photos of pieces are worked on (import, editor, cut-out). */
export const WORK_MAX = 1024;
/** Undo steps the editor keeps. */
export const UNDO_MAX = 8;
/** Every finished cut-out: 3:4 like the cards and the mirror's top and trouser panels (PANEL_SIZE). */
export const FRAME_W = 768, FRAME_H = 1024;
/** Empty border round the piece in the frame, as a share of the frame's width and height. */
export const FRAME_MARGIN = 0.06;
export const CUT_TYPE = "image/webp", CUT_QUALITY = 0.88;

const ICON = {
  erase: `<svg viewBox="0 0 24 24"><path d="M16 4l4 4-9.5 9.5H6.5l-3-3z"/><path d="M11 9l4 4M6.5 17.5H20"/></svg>`,
  restore: `<svg viewBox="0 0 24 24"><path d="M4 20c2-1 3-2.5 3.5-4.5L16 7l1 1-8.5 8.5C8 18.5 6.5 19.5 4 20z"/><path d="M14.5 5.5 16 4l4 4-1.5 1.5"/></svg>`,
  lasso: `<svg viewBox="0 0 24 24"><path d="M12 4c4.4 0 8 2.2 8 5s-3.6 5-8 5-8-2.2-8-5 3.6-5 8-5z" stroke-dasharray="3 2.5"/><path d="M7 13c-.5 2 .5 3.5 2 3.5S11 15 9.5 14M9 16.5c0 1.5-.5 2.5-2 3.5"/></svg>`,
  move: `<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>`,
  undo: `<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg>`,
  redo: `<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/></svg>`,
  fit: `<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>`,
  plus: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M11 8v6M8 11h6M16 16l4 4"/></svg>`,
  minus: `<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M8 11h6M16 16l4 4"/></svg>`,
  eye: `<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
};
const TOOLS = [
  ["erase", "Erase"],
  ["restore", "Restore"],
  ["lasso", "Cut around"],
  ["move", "Move"],
];
const HINT = {
  erase: "Paint over the background that should go.",
  restore: "Paint back the parts of the piece that were cut off.",
  lasso: "Draw a loop round the piece: everything outside it goes.",
  move: "Drag to move. Pinch with two fingers to zoom.",
};
const TINT = "rgba(214, 48, 49, 0.5)"; // removed parts, like a quick mask

const canvas = (w, h) => Object.assign(document.createElement("canvas"), { width: w, height: h });

/**
 * photo: ImageBitmap or canvas, the photo the way it is shown (upright).
 * mask: canvas of the same size; its alpha is what is kept.
 * note: an extra line under the title, e.g. why Restore is limited.
 * Resolves with the kept mask as a canvas the size of `photo`, or null.
 */
export function editCutout(photo, mask, { note = "" } = {}) {
  return new Promise((resolve) => {
    // A bigger photo is edited at WORK_MAX; the mask goes back at the photo's size on Done.
    const W0 = photo.width, H0 = photo.height;
    const ks = Math.min(1, WORK_MAX / Math.max(W0, H0));
    const w = Math.max(1, Math.round(W0 * ks)), h = Math.max(1, Math.round(H0 * ks));
    const pic = ks < 1 ? scaledCopy(photo, w, h) : photo;
    const base = canvas(w, h); // the mask as it came in ("Start over")
    base.getContext("2d").drawImage(mask, 0, 0, w, h);
    const keep = canvas(w, h), kctx = keep.getContext("2d"); // checkpoint: base + the strokes too old to undo
    kctx.drawImage(base, 0, 0);
    const work = canvas(w, h);
    const wctx = work.getContext("2d");
    const comp = canvas(w, h), cctx = comp.getContext("2d"); // the cut-out
    const tint = canvas(w, h), tctx = tint.getContext("2d"); // red over what's removed

    let tool = "erase", size = 40, showRemoved = true;
    const ops = [], redo = []; // at most UNDO_MAX each
    let older = 0; // strokes painted into `keep`: no longer undoable, still changes
    let live = null; // the stroke under the finger
    let dirtyComp = true, dirtyTint = true, frame = 0, discardArmed = false;
    let view = { s: 1, x: 0, y: 0 };
    let fitted = true; // follow the screen size until the photo is zoomed or moved
    let cursor = null; // {x, y} on screen, for the brush ring

    const el = document.createElement("div");
    el.className = "cutfix";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-modal", "true");
    el.setAttribute("aria-label", "Fix the cut-out");
    el.innerHTML = `
      <div class="cutfix-top">
        <button class="btn ghost" data-fx="cancel">Cancel</button>
        <div class="cutfix-title"><b>Fix the cut-out</b><span class="muted small" data-fx-hint></span>${note ? `<span class="small cutfix-note"></span>` : ""}</div>
        <button class="btn primary" data-fx="done">Done</button>
      </div>
      <div class="cutfix-stage"><canvas></canvas></div>
      <div class="cutfix-bar">
        <div class="cutfix-tools" role="group" aria-label="Tool">
          ${TOOLS.map(([id, label]) => `<button class="chip" data-tool="${id}" aria-pressed="${id === tool}">${ICON[id]}${label}</button>`).join("")}
        </div>
        <label class="cutfix-size" data-fx-size><span class="muted small">Brush</span><input type="range" min="10" max="140" value="${size}" aria-label="Brush size"><i></i></label>
        <div class="cutfix-actions">
          <button class="btn icon-btn" data-fx="undo" aria-label="Undo">${ICON.undo}</button>
          <button class="btn icon-btn" data-fx="redo" aria-label="Redo">${ICON.redo}</button>
          <button class="btn icon-btn" data-fx="out" aria-label="Zoom out">${ICON.minus}</button>
          <button class="btn icon-btn" data-fx="in" aria-label="Zoom in">${ICON.plus}</button>
          <button class="btn icon-btn" data-fx="fit" aria-label="Fit to screen">${ICON.fit}</button>
          <button class="chip" data-fx="removed" aria-pressed="true">${ICON.eye}Removed parts</button>
          <button class="chip" data-fx="reset">Start over</button>
        </div>
      </div>`;
    if (note) el.querySelector(".cutfix-note").textContent = note;
    document.body.append(el);
    const stage = el.querySelector(".cutfix-stage");
    const cv = stage.querySelector("canvas");
    const ctx = cv.getContext("2d");
    const sizeInput = el.querySelector('[data-fx-size] input');
    const sizeDot = el.querySelector('[data-fx-size] i');

    /* ---------- the mask ---------- */
    function apply(op, c, from = 0) {
      c.save();
      if (op.tool === "reset") {
        c.globalCompositeOperation = "copy";
        c.drawImage(base, 0, 0);
      } else if (op.tool === "lasso") {
        if (op.pts.length >= 6) {
          c.globalCompositeOperation = "destination-in";
          c.beginPath();
          c.moveTo(op.pts[0], op.pts[1]);
          for (let i = 2; i < op.pts.length; i += 2) c.lineTo(op.pts[i], op.pts[i + 1]);
          c.closePath();
          c.fillStyle = "#000";
          c.fill();
        }
      } else {
        c.globalCompositeOperation = op.tool === "erase" ? "destination-out" : "source-over";
        c.fillStyle = c.strokeStyle = "#000";
        c.lineWidth = op.r * 2;
        c.lineCap = c.lineJoin = "round";
        const p = op.pts;
        if (p.length === 2) {
          c.beginPath(); c.arc(p[0], p[1], op.r, 0, Math.PI * 2); c.fill();
        } else {
          const i0 = Math.max(0, from - 2);
          c.beginPath();
          c.moveTo(p[i0], p[i0 + 1]);
          for (let i = i0 + 2; i < p.length; i += 2) c.lineTo(p[i], p[i + 1]);
          c.stroke();
        }
      }
      c.restore();
    }
    // The mask again from the checkpoint: at most UNDO_MAX strokes to replay.
    function rebuild() {
      wctx.save();
      wctx.globalCompositeOperation = "copy";
      wctx.drawImage(keep, 0, 0);
      wctx.restore();
      for (const op of ops) apply(op, wctx);
      changed();
    }
    // A finished stroke joins the undo list; past UNDO_MAX the oldest goes into the checkpoint.
    function record(op) {
      ops.push(op);
      while (ops.length > UNDO_MAX) { apply(ops.shift(), kctx); older++; }
    }
    const edited = () => ops.length > 0 || older > 0;
    const touch = () => { dirtyComp = dirtyTint = true; };
    function changed() { touch(); paint(); updateButtons(); }
    // Only the layer on screen is redrawn: the tint while "Removed parts" shows, else the cut-out.
    function refreshComp() {
      cctx.save();
      cctx.globalCompositeOperation = "copy";
      cctx.drawImage(work, 0, 0);
      cctx.globalCompositeOperation = "source-in";
      cctx.drawImage(pic, 0, 0, w, h);
      cctx.restore();
      dirtyComp = false;
    }
    function refreshTint() {
      tctx.save();
      tctx.globalCompositeOperation = "copy";
      tctx.fillStyle = TINT;
      tctx.fillRect(0, 0, w, h);
      tctx.globalCompositeOperation = "destination-out";
      tctx.drawImage(work, 0, 0);
      tctx.restore();
      dirtyTint = false;
    }

    /* ---------- drawing the screen ---------- */
    const dpr = () => window.devicePixelRatio || 1;
    function fitView() {
      const W = stage.clientWidth, H = stage.clientHeight;
      const s = Math.min(W / w, H / h) * 0.94;
      view = { s, x: (W - w * s) / 2, y: (H - h * s) / 2 };
      fitted = true;
      paint();
    }
    function resize() {
      const r = dpr();
      cv.width = Math.max(1, Math.round(stage.clientWidth * r));
      cv.height = Math.max(1, Math.round(stage.clientHeight * r));
      cv.style.width = stage.clientWidth + "px";
      cv.style.height = stage.clientHeight + "px";
      paint();
    }
    function paint() {
      if (!frame) frame = requestAnimationFrame(draw);
    }
    function draw() {
      frame = 0;
      if (showRemoved ? dirtyTint : dirtyComp) (showRemoved ? refreshTint : refreshComp)();
      const r = dpr();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(r * view.s, 0, 0, r * view.s, r * view.x, r * view.y);
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = "#e9e2d6"; // the studio card the pieces sit on
      ctx.fillRect(0, 0, w, h);
      if (showRemoved) {
        ctx.drawImage(pic, 0, 0, w, h);
        ctx.drawImage(tint, 0, 0);
      } else ctx.drawImage(comp, 0, 0);
      ctx.setTransform(r, 0, 0, r, 0, 0);
      if (live?.tool === "lasso" && live.pts.length >= 4) {
        ctx.beginPath();
        for (let i = 0; i < live.pts.length; i += 2) {
          const x = live.pts[i] * view.s + view.x, y = live.pts[i + 1] * view.s + view.y;
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        }
        ctx.lineWidth = 3; ctx.strokeStyle = "#fff"; ctx.setLineDash([]); ctx.stroke();
        ctx.lineWidth = 3; ctx.strokeStyle = "#111"; ctx.setLineDash([8, 8]); ctx.stroke();
        ctx.setLineDash([]);
      }
      if (cursor && (tool === "erase" || tool === "restore")) {
        ctx.beginPath();
        ctx.arc(cursor.x, cursor.y, size / 2, 0, Math.PI * 2);
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,.55)"; ctx.stroke();
        ctx.lineWidth = 1.5; ctx.strokeStyle = "#fff"; ctx.stroke();
      }
    }
    const toImage = (sx, sy) => [(sx - view.x) / view.s, (sy - view.y) / view.s];
    function zoomAt(f, sx, sy) {
      const fit = Math.min(stage.clientWidth / w, stage.clientHeight / h);
      const s = Math.min(fit * 12, Math.max(fit * 0.5, view.s * f));
      const [ix, iy] = toImage(sx, sy);
      view = { s, x: sx - ix * s, y: sy - iy * s };
      fitted = false;
      paint();
    }

    /* ---------- fingers, pen and mouse ---------- */
    const pointers = new Map();
    let pinch = null, pan = null;
    const local = (e) => { const b = cv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top }; };
    function startPinch() {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, view: { ...view } };
    }
    function cancelLive() {
      if (!live) return;
      const was = live;
      live = null;
      if (was.tool !== "lasso" && was.pts.length) rebuild(); // take back what it already painted
      paint();
    }
    cv.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);
      if (pointers.size === 2) { cancelLive(); pan = null; startPinch(); return; }
      if (pointers.size > 2) return;
      if (tool === "move" || e.button === 1 || e.button === 2) { pan = { x: p.x, y: p.y, view: { ...view } }; return; }
      const [ix, iy] = toImage(p.x, p.y);
      live = { tool, r: size / 2 / view.s, pts: [ix, iy] };
      redo.length = 0;
      if (tool !== "lasso") { apply(live, wctx); changed(); }
      cursor = e.pointerType === "touch" ? null : p;
      paint();
    });
    cv.addEventListener("pointermove", (e) => {
      const p = local(e);
      if (!pointers.has(e.pointerId)) {
        if (e.pointerType !== "touch") { cursor = p; paint(); }
        return;
      }
      pointers.set(e.pointerId, p);
      if (pinch && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const fit = Math.min(stage.clientWidth / w, stage.clientHeight / h);
        const s = Math.min(fit * 12, Math.max(fit * 0.5, pinch.view.s * d / pinch.d));
        const ix = (pinch.mx - pinch.view.x) / pinch.view.s, iy = (pinch.my - pinch.view.y) / pinch.view.s;
        view = { s, x: mx - ix * s, y: my - iy * s };
        fitted = false;
        return paint();
      }
      if (pan) {
        view = { ...pan.view, x: pan.view.x + p.x - pan.x, y: pan.view.y + p.y - pan.y };
        fitted = false;
        return paint();
      }
      if (!live) return;
      const [ix, iy] = toImage(p.x, p.y);
      const n = live.pts.length;
      const step = live.tool === "lasso" ? 3 / view.s : Math.max(0.6, live.r * 0.15);
      if (Math.hypot(ix - live.pts[n - 2], iy - live.pts[n - 1]) < step) return;
      live.pts.push(ix, iy);
      if (live.tool !== "lasso") { apply(live, wctx, n); touch(); }
      cursor = e.pointerType === "touch" ? null : p;
      paint();
    });
    const lift = (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.delete(e.pointerId);
      if (pinch) { if (pointers.size < 2) pinch = null; return; }
      pan = null;
      if (!live) return;
      const op = live;
      live = null;
      if (op.tool === "lasso") {
        if (op.pts.length >= 6) { apply(op, wctx); record(op); }
      } else record(op);
      if (e.pointerType === "touch") cursor = null;
      changed();
    };
    cv.addEventListener("pointerup", lift);
    cv.addEventListener("pointercancel", (e) => { if (pointers.size === 1) cancelLive(); lift(e); });
    cv.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch" && !pointers.size) { cursor = null; paint(); } });
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = local(e);
      zoomAt(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
    }, { passive: false });

    /* ---------- buttons ---------- */
    function updateButtons() {
      el.querySelector('[data-fx="undo"]').disabled = !ops.length;
      el.querySelector('[data-fx="redo"]').disabled = !redo.length;
      el.querySelectorAll("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tool === tool));
      el.querySelector('[data-fx="removed"]').setAttribute("aria-pressed", showRemoved);
      el.querySelector("[data-fx-hint]").textContent = HINT[tool];
      el.querySelector("[data-fx-size]").classList.toggle("off", tool === "lasso" || tool === "move"); // hidden, keeps its place
      sizeDot.style.width = sizeDot.style.height = Math.min(40, size / 2.5 + 6) + "px";
      const cancel = el.querySelector('[data-fx="cancel"]');
      cancel.textContent = discardArmed ? "Discard changes?" : "Cancel";
      cancel.classList.toggle("danger", discardArmed);
    }
    const undo = () => { if (ops.length) { redo.push(ops.pop()); rebuild(); } };
    const redoOne = () => { if (redo.length) { const op = redo.pop(); record(op); apply(op, wctx); changed(); } };
    function close(result) {
      cancelAnimationFrame(frame);
      ro.disconnect();
      document.removeEventListener("keydown", onKey, true);
      el.remove();
      // Nothing of the editor stays in memory: the strokes go, and every canvas it made is
      // emptied (a 0 x 0 canvas gives its pixels back at once, which Safari needs).
      ops.length = redo.length = 0;
      live = pinch = pan = null;
      pointers.clear();
      for (const c of [base, keep, work, comp, tint, cv, pic === photo ? null : pic]) if (c) c.width = c.height = 0;
      resolve(result);
    }
    el.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      e.stopPropagation(); // the app's own click handler stays out of it
      const act = b.dataset.fx;
      if (act !== "cancel") discardArmed = false;
      if (b.dataset.tool) { tool = b.dataset.tool; cursor = null; }
      else if (act === "undo") undo();
      else if (act === "redo") redoOne();
      else if (act === "in") zoomAt(1.4, stage.clientWidth / 2, stage.clientHeight / 2);
      else if (act === "out") zoomAt(1 / 1.4, stage.clientWidth / 2, stage.clientHeight / 2);
      else if (act === "fit") fitView();
      else if (act === "removed") { showRemoved = !showRemoved; paint(); }
      else if (act === "reset") { if (edited() && ops[ops.length - 1]?.tool !== "reset") { record({ tool: "reset" }); redo.length = 0; rebuild(); } }
      else if (act === "done") {
        if (!edited()) return close(null);
        const out = canvas(W0, H0), octx = out.getContext("2d");
        octx.imageSmoothingQuality = "high";
        octx.drawImage(work, 0, 0, W0, H0);
        return close(out);
      } else if (act === "cancel") {
        if (edited() && !discardArmed) { discardArmed = true; return updateButtons(); }
        return close(null);
      }
      updateButtons();
      paint();
    });
    sizeInput.addEventListener("input", () => { size = +sizeInput.value; updateButtons(); paint(); });
    function onKey(e) {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.stopPropagation(); return e.shiftKey ? redoOne() : undo(); }
      if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); e.stopPropagation(); return redoOne(); }
      if (e.target.closest?.("input, textarea")) return;
      const pick = { e: "erase", r: "restore", l: "lasso", m: "move" }[k];
      if (pick) { tool = pick; updateButtons(); paint(); }
      if (k === "[" || k === "]") { size = Math.min(140, Math.max(10, size + (k === "]" ? 10 : -10))); sizeInput.value = size; updateButtons(); paint(); }
    }
    document.addEventListener("keydown", onKey, true);

    const ro = new ResizeObserver(() => { resize(); if (fitted) fitView(); });
    ro.observe(stage);
    wctx.drawImage(base, 0, 0);
    resize();
    fitView();
    updateButtons();
  });
}

function scaledCopy(src, w, h) {
  const c = canvas(w, h), g = c.getContext("2d");
  g.imageSmoothingQuality = "high";
  g.drawImage(src, 0, 0, w, h);
  return c;
}

/* ======================================================================
   The cut-out pipeline
   Pixel loops read each pixel as one 32-bit number through a Uint32Array
   view of the ImageData buffer (alpha is its top byte on the little-endian
   CPUs every phone, tablet and PC uses). The parts that only touch pixels
   take typed arrays and need no DOM, so tools/cutout.test.mjs runs them in Node.
   ====================================================================== */
const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
const SA = LE ? 24 : 0, SR = LE ? 0 : 24, SG = LE ? 8 : 16, SB = LE ? 16 : 8; // byte shifts in a 32-bit pixel
const view32 = (data) => new Uint32Array(data.buffer, data.byteOffset, data.byteLength >> 2);

/* ---------- photos in ---------- */
// One photo decoded at a time: a pile of 48 MP gallery photos can't fill the memory at once.
let decoding = Promise.resolve();
/**
 * A photo (Blob, File, ImageBitmap or canvas) as a canvas at most `max` px on its longest side,
 * turned the way the camera held it. Big photos shrink in halving steps with high-quality
 * smoothing (one big jump would alias fine knits and stripes); the decoded original is closed
 * straight away.
 */
export function workingCopy(src, max = WORK_MAX) {
  const job = decoding.then(() => shrinkPhoto(src, max));
  decoding = job.catch(() => {});
  return job;
}
async function shrinkPhoto(src, max) {
  const own = src instanceof Blob;
  const bmp = own ? await createImageBitmap(src, { imageOrientation: "from-image" }).catch(() => createImageBitmap(src)) : src;
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const W = Math.max(1, Math.round(bmp.width * s)), H = Math.max(1, Math.round(bmp.height * s));
  const drop = (c) => { if (c !== bmp) c.width = c.height = 0; else if (own) bmp.close?.(); };
  let cur = bmp;
  while (cur.width >= W * 2 && cur.height >= H * 2) {
    const next = scaledCopy(cur, Math.round(cur.width / 2), Math.round(cur.height / 2));
    drop(cur);
    cur = next;
  }
  const out = cur !== bmp && cur.width === W && cur.height === H ? cur : scaledCopy(cur, W, H);
  if (cur !== out) drop(cur);
  return out;
}

/* ---------- the colour cut-out (when the AI can't run) ---------- */
/**
 * The garment's mask (1 = garment) from a photo's RGBA pixels: the background is modelled from
 * the photo's border with a few colour clusters, grown inwards through background-like pixels,
 * cleaned up (opened) and the biggest piece kept. Throws when no garment-sized piece is left.
 */
export function colourMask(rgba, w, h) {
  const px = view32(rgba), N = w * h;
  const bw = Math.max(3, Math.round(Math.min(w, h) * 0.03));
  const R = new Uint8Array(N), G = new Uint8Array(N), B = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const v = px[i]; R[i] = (v >>> SR) & 255; G[i] = (v >>> SG) & 255; B[i] = (v >>> SB) & 255; }
  const edge = new Uint8Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < bw || y < bw || x >= w - bw || y >= h - bw) edge[y * w + x] = 1;

  // Background colours: k-means (5 clusters, 8 rounds) on every other border pixel.
  let nb = 0;
  const border = new Int32Array(N);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (edge[y * w + x] && (x + y) % 2 === 0) border[nb++] = y * w + x;
  const K = 5, C = new Float64Array(K * 3);
  for (let k = 0; k < K; k++) { const i = border[Math.floor(((k + 0.5) * nb) / K)]; C[k * 3] = R[i]; C[k * 3 + 1] = G[i]; C[k * 3 + 2] = B[i]; }
  const sum = new Float64Array(K * 4);
  for (let it = 0; it < 8; it++) {
    sum.fill(0);
    for (let n = 0; n < nb; n++) {
      const i = border[n], r = R[i], g = G[i], b = B[i];
      let bi = 0, bd = Infinity;
      for (let k = 0; k < K; k++) { const d = (r - C[k * 3]) ** 2 + (g - C[k * 3 + 1]) ** 2 + (b - C[k * 3 + 2]) ** 2; if (d < bd) { bd = d; bi = k; } }
      sum[bi * 4] += r; sum[bi * 4 + 1] += g; sum[bi * 4 + 2] += b; sum[bi * 4 + 3]++;
    }
    for (let k = 0; k < K; k++) if (sum[k * 4 + 3]) for (let c = 0; c < 3; c++) C[k * 3 + c] = sum[k * 4 + c] / sum[k * 4 + 3];
  }
  const distBg = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const r = R[i], g = G[i], b = B[i];
    let bd = Infinity;
    for (let k = 0; k < K; k++) bd = Math.min(bd, Math.sqrt((r - C[k * 3]) ** 2 + (g - C[k * 3 + 1]) ** 2 + (b - C[k * 3 + 2]) ** 2));
    distBg[i] = bd;
  }
  let ne = 0;
  const bd = new Float32Array(N);
  for (let i = 0; i < N; i++) if (edge[i]) bd[ne++] = distBg[i];
  const bdists = bd.subarray(0, ne).sort();
  const T = Math.max(18, bdists[Math.floor(ne * 0.9)] * 1.25);

  // Grow the background inwards from the border through background-like pixels.
  const bg = new Uint8Array(N), q = new Int32Array(N);
  let qh = 0, qt = 0;
  const seed = (i) => { if (!bg[i] && distBg[i] < T * 1.6) { bg[i] = 1; q[qt++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  const T18 = T * 1.8;
  const grow = (i, j) => {
    if (bg[j]) return;
    const d = distBg[j];
    if (d < T || (d < T18 && Math.abs(R[i] - R[j]) + Math.abs(G[i] - G[j]) + Math.abs(B[i] - B[j]) < 9)) { bg[j] = 1; q[qt++] = j; }
  };
  while (qh < qt) {
    const i = q[qh++], x = i % w;
    if (x > 0) grow(i, i - 1);
    if (x < w - 1) grow(i, i + 1);
    if (i >= w) grow(i, i - w);
    if (i < N - w) grow(i, i + w);
  }
  // Clean up: open (erode + dilate) the foreground, keep the biggest piece.
  let fg = new Uint8Array(N);
  for (let i = 0; i < N; i++) fg[i] = bg[i] ? 0 : 1;
  const morph = (src, erode) => {
    const out = new Uint8Array(N);
    for (let y = 1; y < h - 1; y++) for (let x = 1, i = y * w + 1; x < w - 1; x++, i++) {
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
    label++;
    let size = 0;
    qh = qt = 0; q[qt++] = s; lab[s] = label;
    while (qh < qt) {
      const i = q[qh++], x = i % w;
      size++;
      if (x > 0 && fg[i - 1] && !lab[i - 1]) { lab[i - 1] = label; q[qt++] = i - 1; }
      if (x < w - 1 && fg[i + 1] && !lab[i + 1]) { lab[i + 1] = label; q[qt++] = i + 1; }
      if (i >= w && fg[i - w] && !lab[i - w]) { lab[i - w] = label; q[qt++] = i - w; }
      if (i < N - w && fg[i + w] && !lab[i + w]) { lab[i + w] = label; q[qt++] = i + w; }
    }
    if (size > bestSize) { bestSize = size; best = label; }
  }
  const share = bestSize / N;
  if (share < 0.06 || share > 0.92) throw new Error("Couldn't find the garment");
  const mask = new Uint8Array(N);
  for (let i = 0; i < N; i++) mask[i] = lab[i] === best ? 1 : 0;
  return mask;
}

/** Colour-based background removal: a PNG of the photo with the background transparent. */
export async function basicCutout(blob) {
  const bmp = await createImageBitmap(blob);
  const S = 360 / Math.max(bmp.width, bmp.height);
  const w = Math.round(bmp.width * S), h = Math.round(bmp.height * S);
  const small = canvas(w, h), sctx = small.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(bmp, 0, 0, w, h);
  const img = sctx.getImageData(0, 0, w, h);
  const mask = colourMask(img.data, w, h);
  // the mask as alpha, in the same buffer
  const px = view32(img.data);
  for (let i = 0; i < mask.length; i++) px[i] = mask[i] ? 255 << SA : 0;
  sctx.putImageData(img, 0, 0);
  const out = canvas(bmp.width, bmp.height);
  const octx = out.getContext("2d");
  octx.drawImage(bmp, 0, 0);
  octx.globalCompositeOperation = "destination-in";
  octx.filter = "blur(1.5px)";
  octx.imageSmoothingQuality = "high";
  octx.drawImage(small, 0, 0, out.width, out.height);
  bmp.close?.();
  small.width = small.height = 0;
  const png = await encode(out, "image/png");
  out.width = out.height = 0;
  return png;
}

/* ---------- trim, defringe, frame ---------- */
/** The tight box of the pixels more opaque than `min` (alpha 0-255), or null when there are none. */
export function alphaBox(rgba, w, h, min = 16) {
  const px = view32(rgba);
  const lim = (min + 1) << SA >>> 0; // alpha > min, compared on the whole pixel when alpha is the top byte
  const on = LE ? (i) => px[i] >= lim : (i) => ((px[i] >>> SA) & 255) > min;
  const rowOn = (y) => { for (let i = y * w, e = i + w; i < e; i++) if (on(i)) return true; return false; };
  let y0 = 0, y1 = h - 1;
  while (y0 < h && !rowOn(y0)) y0++;
  if (y0 === h) return null;
  while (y1 > y0 && !rowOn(y1)) y1--;
  let x0 = w, x1 = -1;
  for (let y = y0; y <= y1; y++) {
    const r = y * w;
    for (let x = 0; x < x0; x++) if (on(r + x)) { x0 = x; break; }
    for (let x = w - 1; x > x1; x--) if (on(r + x)) { x1 = x; break; }
  }
  return { x0, y0, x1, y1 };
}

/**
 * Clean edges for the dark 3D stage, in place on RGBA pixels:
 * 1. pixels at most `faint` opaque (haze the AI left) go fully transparent;
 * 2. the edge band (the `band` px nearest the outside) is checked against the garment just inside
 *    it: the colour of the inside is carried out ring by ring, the outermost ring always takes it
 *    (a 1 px defringe), and the rings behind it take it where they're far off it (a light rim of
 *    bed sheet, a grey shadow), so no halo shows on the dark stage. Detail that matches the
 *    garment stays, and so does anything deeper in;
 * 3. a hard step from solid to transparent gets a 1 px feather (the mean of its 3 x 3 alpha), so
 *    edges aren't jagged. Alpha is never raised and a soft or feathered edge stays as it is, so
 *    framing a cut-out twice (after a turn) doesn't wear the edge away.
 */
export function defringe(rgba, w, h, { faint = 16, solid = 250, band = 4, off = 36 } = {}) {
  const px = view32(rgba), N = w * h;
  const a = new Uint8Array(N);
  for (let i = 0; i < N; i++) {
    const v = (px[i] >>> SA) & 255;
    if (v <= faint) { if (px[i]) px[i] = 0; } else a[i] = v;
  }
  // Distance to the outside in px (8 neighbours, two chamfer passes), capped past the band.
  const far = band + 1, d = new Uint8Array(N);
  for (let i = 0; i < N; i++) d[i] = a[i] ? far : 0;
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    if (!d[i]) continue;
    let m = d[i];
    if (x > 0) m = Math.min(m, d[i - 1] + 1);
    if (y > 0) { m = Math.min(m, d[i - w] + 1); if (x > 0) m = Math.min(m, d[i - w - 1] + 1); if (x < w - 1) m = Math.min(m, d[i - w + 1] + 1); }
    d[i] = m;
  }
  for (let y = h - 1, i = N - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--, i--) {
    if (!d[i]) continue;
    let m = d[i];
    if (x < w - 1) m = Math.min(m, d[i + 1] + 1);
    if (y < h - 1) { m = Math.min(m, d[i + w] + 1); if (x < w - 1) m = Math.min(m, d[i + w + 1] + 1); if (x > 0) m = Math.min(m, d[i + w - 1] + 1); }
    d[i] = m;
  }
  // The band, ring by ring.
  const count = new Int32Array(band + 2);
  for (let i = 0; i < N; i++) if (d[i] && d[i] <= band) count[d[i]]++;
  const start = new Int32Array(band + 2);
  for (let k = 1; k <= band; k++) start[k + 1] = start[k] + count[k];
  const ring = new Int32Array(start[band + 1]), fill = start.slice();
  for (let i = 0; i < N; i++) if (d[i] && d[i] <= band) ring[fill[d[i]]++] = i;
  // The inside's colour carried out from ring `band` to ring 1: each pixel gets the mean of its
  // neighbours one ring further in (thin parts with nothing further in keep their own).
  const R = new Uint8Array(N), G = new Uint8Array(N), B = new Uint8Array(N);
  for (let n = 0; n < ring.length; n++) { const i = ring[n], v = px[i]; R[i] = (v >>> SR) & 255; G[i] = (v >>> SG) & 255; B[i] = (v >>> SB) & 255; }
  const ref = (j) => (d[j] > band ? px[j] : null);
  for (let k = band; k >= 1; k--) {
    for (let n = start[k]; n < start[k + 1]; n++) {
      const i = ring[n], x = i % w, y = (i - x) / w;
      let r = 0, g = 0, b = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w || (!dx && !dy)) continue;
          const j = yy * w + xx;
          if (d[j] <= k) continue;
          const v = ref(j);
          if (v === null) { r += R[j]; g += G[j]; b += B[j]; } else { r += (v >>> SR) & 255; g += (v >>> SG) & 255; b += (v >>> SB) & 255; }
          c++;
        }
      }
      if (!c) continue;
      r = Math.round(r / c); g = Math.round(g / c); b = Math.round(b / c);
      const o = i * 4, dr = rgba[o + (SR >> 3)] - r, dg = rgba[o + (SG >> 3)] - g, db = rgba[o + (SB >> 3)] - b;
      const replace = k === 1 || dr * dr + dg * dg + db * db > off * off;
      if (replace) { rgba[o + (SR >> 3)] = r; rgba[o + (SG >> 3)] = g; rgba[o + (SB >> 3)] = b; }
      // what this pixel hands on to the ring outside it: the inside's colour, or its own detail
      R[i] = replace ? r : rgba[o + (SR >> 3)]; G[i] = replace ? g : rgba[o + (SG >> 3)]; B[i] = replace ? b : rgba[o + (SB >> 3)];
    }
  }
  // Feather the hard steps, from the alpha as it was.
  for (let n = start[1]; n < start[2]; n++) {
    const i = ring[n];
    if (a[i] < solid) continue; // the soft rim keeps its alpha
    const x = i % w, y = (i - x) / w;
    if (!((x > 0 && !a[i - 1]) || (x < w - 1 && !a[i + 1]) || (y > 0 && !a[i - w]) || (y < h - 1 && !a[i + w]))) continue;
    let s = 0, c = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        s += a[yy * w + xx]; c++;
      }
    }
    rgba[i * 4 + (SA >> 3)] = Math.min(a[i], Math.round(s / c));
  }
  return rgba;
}

/** Where a w x h piece goes in the frame: scale and offset (centred, inside the margins). */
export function frameFit(bw, bh) {
  const s = Math.min((FRAME_W * (1 - 2 * FRAME_MARGIN)) / bw, (FRAME_H * (1 - 2 * FRAME_MARGIN)) / bh);
  return { s, dx: (FRAME_W - bw * s) / 2, dy: (FRAME_H - bh * s) / 2 };
}

/**
 * The last step of every cut-out: trimmed to the piece (alpha > 16), centred on a transparent
 * FRAME_W x FRAME_H frame inside FRAME_MARGIN, edges defringed, saved as WebP (q 0.88; a browser
 * that can't write WebP from a canvas, like older Safari, gives a PNG). `m` maps each pixel of `src` (a Blob, bitmap
 * or canvas) to where it lands in the frame. Same size, margins and centring for every piece, so
 * cards, thumbnails and the 3D mirror's panels all start from the same framing. The piece is never
 * stretched to the frame: `meta` keeps its own proportions (aspectRatio = height / width of the
 * trimmed piece) and where it was in `src` (trimBounds = [x, y, w, h] as fractions of src), which the
 * piece keeps as its cutoutMeta (avatar-config.js).
 */
export async function frameCutout(src) {
  const own = src instanceof Blob;
  const bmp = own ? await createImageBitmap(src) : src;
  const sw = bmp.width, sh = bmp.height;
  const rc = canvas(sw, sh), rctx = rc.getContext("2d", { willReadFrequently: true });
  rctx.drawImage(bmp, 0, 0);
  if (own) bmp.close?.();
  try {
    const box = alphaBox(rctx.getImageData(0, 0, sw, sh).data, sw, sh);
    if (!box) return { blob: own ? src : await encode(rc, "image/png"), m: new DOMMatrix(), meta: null };
    const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
    const r4 = (v) => Math.round(v * 10000) / 10000;
    const meta = { aspectRatio: Math.round((bh / bw) * 1000) / 1000, trimBounds: [r4(box.x0 / sw), r4(box.y0 / sh), r4(bw / sw), r4(bh / sh)] };
    const { s, dx, dy } = frameFit(bw, bh);
    const c = canvas(FRAME_W, FRAME_H), ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(rc, box.x0, box.y0, bw, bh, dx, dy, bw * s, bh * s);
    const img = ctx.getImageData(0, 0, FRAME_W, FRAME_H);
    defringe(img.data, FRAME_W, FRAME_H);
    ctx.putImageData(img, 0, 0);
    const blob = await encode(c, CUT_TYPE, CUT_QUALITY);
    c.width = c.height = 0;
    return { blob, m: new DOMMatrix().translate(dx, dy).scale(s).translate(-box.x0, -box.y0), meta };
  } finally {
    rc.width = rc.height = 0;
  }
}

function encode(c, type, quality) {
  return new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("Couldn't save the picture"))), type, quality));
}
