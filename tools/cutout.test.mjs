// Run with:  node --test tools/cutout.test.mjs
// Checks the pixel side of cutout-editor.js: the colour cut-out gives the same mask as before
// (and faster), the tight box, the edge clean-up and the frame every cut-out is saved in.
import assert from "node:assert/strict";
import test from "node:test";
import { colourMask, alphaBox, defringe, frameFit, FRAME_W, FRAME_H, FRAME_MARGIN, WORK_MAX, UNDO_MAX } from "../cutout-editor.js";

// The colour cut-out exactly as app.js had it before (arrays per pixel), as the reference.
function oldMask(px, w, h) {
  const N = w * h;
  const rgb = (i) => [px[i * 4], px[i * 4 + 1], px[i * 4 + 2]];
  const isEdge = (x, y, bw) => x < bw || y < bw || x >= w - bw || y >= h - bw;
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
  const m = new Uint8Array(N);
  for (let i = 0; i < N; i++) m[i] = lab[i] === best ? 1 : 0;
  return m;
}

// A random seeded "photo": a noisy bed sheet with a tee-like shape (body, sleeves, a print).
function rng(seed) { let s = seed >>> 0; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) ^ Math.imul(s ^ (s >>> 13), 3266489909)) >>> 0) / 4294967296; }
function photo(w, h, seed, { bg = [214, 206, 196], fg = [32, 44, 86], noise = 14 } = {}) {
  const r = rng(seed), px = new Uint8ClampedArray(w * h * 4);
  const cx = w * (0.45 + r() * 0.1), top = h * (0.12 + r() * 0.08), bot = h * (0.8 + r() * 0.1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, shade = (y / h) * 18 - 9; // light falls off across the sheet
    const body = y > top && y < bot && Math.abs(x - cx) < w * 0.22;
    const sleeve = y > top && y < top + h * 0.22 && Math.abs(x - cx) < w * 0.38 - (y - top) * 0.4;
    const print = body && Math.hypot(x - cx, y - (top + h * 0.2)) < w * 0.07;
    const c = print ? [230, 200, 40] : body || sleeve ? fg : bg;
    for (let k = 0; k < 3; k++) px[o + k] = c[k] + shade + (r() - 0.5) * noise;
    px[o + 3] = 255;
  }
  return px;
}

test("constants the app and the 3D mirror rely on", () => {
  assert.equal(WORK_MAX, 1024);
  assert.equal(UNDO_MAX, 8);
  assert.deepEqual([FRAME_W, FRAME_H], [768, 1024], "the frame is the mirror's top and trouser panel size");
});

test("the colour cut-out gives exactly the old mask, faster", () => {
  let tOld = 0, tNew = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const w = 270 + (seed % 3) * 45, h = 360;
    const px = photo(w, h, seed, seed % 2 ? {} : { bg: [120, 140, 128], fg: [236, 236, 230], noise: 22 });
    let t = performance.now();
    const a = oldMask(px, w, h);
    tOld += performance.now() - t;
    t = performance.now();
    const b = colourMask(px, w, h);
    tNew += performance.now() - t;
    assert.equal(b.length, a.length);
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += a[i] !== b[i];
    assert.equal(diff, 0, `seed ${seed}: ${diff} pixels differ`);
    const share = b.reduce((s, v) => s + v, 0) / b.length;
    assert.ok(share > 0.1 && share < 0.6, `seed ${seed}: garment share ${share}`);
  }
  console.log(`colour cut-out, 12 photos: before ${tOld.toFixed(0)} ms, now ${tNew.toFixed(0)} ms (${(tOld / tNew).toFixed(1)}x)`);
  assert.ok(tNew < tOld, "typed arrays are faster");
  // nothing garment-sized: an even sheet
  const flat = new Uint8ClampedArray(200 * 200 * 4).fill(200);
  assert.throws(() => colourMask(flat, 200, 200), /garment/);
});

test("tight box of what's visible", () => {
  const w = 97, h = 61, r = rng(7);
  for (let t = 0; t < 40; t++) {
    const px = new Uint8ClampedArray(w * h * 4);
    const n = 1 + Math.floor(r() * 30);
    for (let k = 0; k < n; k++) px[(Math.floor(r() * w * h)) * 4 + 3] = Math.floor(r() * 256);
    px[(Math.floor(r() * w * h)) * 4 + 1] = 255; // colour without alpha doesn't count
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 16) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    assert.deepEqual(alphaBox(px, w, h), x1 < 0 ? null : { x0, y0, x1, y1 });
  }
  assert.equal(alphaBox(new Uint8ClampedArray(16 * 16 * 4), 16, 16), null);
});

// A navy square on transparent: a soft white rim on the left (1 px, half opaque), a solid 3 px
// light rim of bed sheet on the right, a white stripe deep inside and some denim-like texture
// near the top edge, and a speck of haze.
function haloPiece(w = 40, h = 40) {
  const px = new Uint8ClampedArray(w * h * 4);
  const set = (x, y, c, a) => { const o = (y * w + x) * 4; px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = a; };
  for (let y = 10; y < 30; y++) for (let x = 10; x < 30; x++) set(x, y, [30, 40, 90], 255);
  for (let y = 9; y < 31; y++) set(9, y, [245, 245, 245], 128);
  for (let y = 10; y < 30; y++) for (let x = 27; x < 30; x++) set(x, y, [236, 232, 226], 255);
  for (let y = 10; y < 30; y++) set(19, y, [250, 250, 250], 255);
  for (let x = 12; x < 18; x++) set(x, 11, [44, 52, 104], 255); // ring 2 from the top: close to navy
  set(2, 2, [255, 255, 255], 10);
  return px;
}
const at = (px, w, x, y) => Array.from(px.slice((y * w + x) * 4, (y * w + x) * 4 + 4));

test("defringe: no halo, 1 px feather, detail kept, nothing grows", () => {
  const w = 40, h = 40, px = haloPiece(w, h), before = px.slice();
  defringe(px, w, h);
  assert.deepEqual(at(px, w, 2, 2), [0, 0, 0, 0], "faint haze goes");
  const rim = at(px, w, 9, 20);
  assert.ok(rim[0] < 60 && rim[2] > 70, `soft rim takes the navy from inside: ${rim}`);
  assert.equal(rim[3], 128, "a soft rim keeps its alpha");
  for (const x of [27, 28, 29]) {
    const p = at(px, w, x, 20);
    assert.ok(p[0] < 60 && p[2] > 70, `3 px light rim at x=${x} takes the navy: ${p}`);
  }
  assert.ok(at(px, w, 29, 20)[3] > 140 && at(px, w, 29, 20)[3] < 200, `hard step feathered: ${at(px, w, 29, 20)[3]}`);
  assert.equal(at(px, w, 28, 20)[3], 255, "only the outer pixel is feathered");
  assert.deepEqual(at(px, w, 19, 20), [250, 250, 250, 255], "a white stripe deeper in stays");
  assert.deepEqual(at(px, w, 14, 11), [44, 52, 104, 255], "texture near the edge that matches the garment stays");
  assert.deepEqual(at(px, w, 22, 20), [30, 40, 90, 255], "inside stays as it was");
  for (let i = 0; i < w * h; i++) assert.ok(px[i * 4 + 3] <= before[i * 4 + 3], "never adds alpha");
  // Framing a cut-out twice (after a turn) doesn't eat the edge.
  const once = px.slice();
  defringe(px, w, h);
  let moved = 0, recol = 0;
  for (let i = 0; i < w * h; i++) {
    moved = Math.max(moved, Math.abs(px[i * 4 + 3] - once[i * 4 + 3]));
    for (let c = 0; c < 3; c++) recol = Math.max(recol, Math.abs(px[i * 4 + c] - once[i * 4 + c]));
  }
  assert.equal(moved, 0, "alpha is stable on a second pass");
  assert.ok(recol <= 2, `colours are stable on a second pass (${recol})`);
});

test("defringe is quick on a full frame", () => {
  const w = FRAME_W, h = FRAME_H, px = new Uint8ClampedArray(w * h * 4), r = rng(3);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot((x - w / 2) / (w * 0.4), (y - h / 2) / (h * 0.45)) + (r() - 0.5) * 0.02;
    const o = (y * w + x) * 4;
    px[o] = 40; px[o + 1] = 90; px[o + 2] = 60; px[o + 3] = d < 1 ? 255 : d < 1.01 ? 120 : 0;
  }
  const t = performance.now();
  defringe(px, w, h);
  const ms = performance.now() - t;
  console.log(`defringe 768 x 1024: ${ms.toFixed(1)} ms`);
  assert.ok(ms < 250, `${ms} ms`);
});

test("the frame: same size, margins and centring for every piece", () => {
  for (const [bw, bh] of [[300, 900], [900, 300], [500, 500], [37, 61], [2000, 2600]]) {
    const { s, dx, dy } = frameFit(bw, bh);
    const W = bw * s, H = bh * s;
    assert.ok(dx >= FRAME_W * FRAME_MARGIN - 1e-6 && dy >= FRAME_H * FRAME_MARGIN - 1e-6, "inside the margins");
    assert.ok(Math.abs(dx * 2 + W - FRAME_W) < 1e-6 && Math.abs(dy * 2 + H - FRAME_H) < 1e-6, "centred");
    assert.ok(Math.abs(dx - FRAME_W * FRAME_MARGIN) < 1e-6 || Math.abs(dy - FRAME_H * FRAME_MARGIN) < 1e-6, "touches the margin on one side");
  }
});
