/* ======================================================================
   Fixing a cut-out by hand
   A full-screen editor over the photo, made for fingers:
   - Erase: paint over background the AI left in.
   - Restore: paint back parts of the piece the AI cut off.
   - Cut around: draw a loop round the piece, everything outside goes.
   - Move: one finger moves the photo (two fingers always pinch and move).
   Undo / redo replay the strokes, so they cost no memory per step.
   The editor works on a mask the size of the photo: white where the piece
   is kept. editCutout() resolves with the new mask, or null if cancelled.
   ====================================================================== */

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
 */
export function editCutout(photo, mask, { note = "" } = {}) {
  return new Promise((resolve) => {
    const w = photo.width, h = photo.height;
    const base = canvas(w, h);
    base.getContext("2d").drawImage(mask, 0, 0, w, h);
    const work = canvas(w, h);
    const wctx = work.getContext("2d");
    const comp = canvas(w, h), cctx = comp.getContext("2d"); // the cut-out
    const tint = canvas(w, h), tctx = tint.getContext("2d"); // red over what's removed

    let tool = "erase", size = 40, showRemoved = true;
    const ops = [], redo = [];
    let live = null; // the stroke under the finger
    let dirty = true, frame = 0, discardArmed = false;
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
    function rebuild() {
      wctx.save();
      wctx.globalCompositeOperation = "copy";
      wctx.drawImage(base, 0, 0);
      wctx.restore();
      for (const op of ops) apply(op, wctx);
      changed();
    }
    function changed() { dirty = true; paint(); updateButtons(); }
    function refreshLayers() {
      cctx.save();
      cctx.globalCompositeOperation = "copy";
      cctx.drawImage(work, 0, 0);
      cctx.globalCompositeOperation = "source-in";
      cctx.drawImage(photo, 0, 0, w, h);
      cctx.restore();
      tctx.save();
      tctx.globalCompositeOperation = "copy";
      tctx.fillStyle = TINT;
      tctx.fillRect(0, 0, w, h);
      tctx.globalCompositeOperation = "destination-out";
      tctx.drawImage(work, 0, 0);
      tctx.restore();
      dirty = false;
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
      if (dirty) refreshLayers();
      const r = dpr();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.setTransform(r * view.s, 0, 0, r * view.s, r * view.x, r * view.y);
      ctx.imageSmoothingQuality = "high";
      ctx.fillStyle = "#e9e2d6"; // the studio card the pieces sit on
      ctx.fillRect(0, 0, w, h);
      if (showRemoved) {
        ctx.drawImage(photo, 0, 0, w, h);
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
      if (live.tool !== "lasso") { apply(live, wctx, n); dirty = true; }
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
        if (op.pts.length >= 6) { apply(op, wctx); ops.push(op); }
      } else ops.push(op);
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
    const redoOne = () => { if (redo.length) { const op = redo.pop(); ops.push(op); apply(op, wctx); changed(); } };
    function close(result) {
      cancelAnimationFrame(frame);
      ro.disconnect();
      document.removeEventListener("keydown", onKey, true);
      el.remove();
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
      else if (act === "reset") { if (ops.length && ops[ops.length - 1].tool !== "reset") { ops.push({ tool: "reset" }); redo.length = 0; rebuild(); } }
      else if (act === "done") {
        const out = canvas(w, h);
        out.getContext("2d").drawImage(work, 0, 0);
        return close(ops.length ? out : null);
      } else if (act === "cancel") {
        if (ops.length && !discardArmed) { discardArmed = true; return updateButtons(); }
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
