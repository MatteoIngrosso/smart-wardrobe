// The mannequin look of the 3D mirror (avatar-stage.js, mode 'mannequin'): every garment is a gently
// curved shell around the body, painted with the piece's own cut-out photos and nothing else.
//
// - Tops: per 1 cm row, a ring that follows the body's convex outline at that height, a fixed depth
//   (the slot's channel) outside it. The front photo wraps the front half and the back photo the back
//   half by arc length at one scale, so a photo is never stretched; at 180 degrees the back photo reads
//   as photographed. An open jacket's front is parted at the centre, each half of the photo on its side.
//   Sleeves are tubes around the arms in the photo's own fabric (flat-lay sleeves stick out sideways,
//   so they can't be laid on a hanging arm without stretching).
// - Bottoms: a ring round the hips, then one tube per leg, each with its half of the photo.
// - Layers never sort: opaque, alpha-tested (the cut-out's outline), depth-written, drawn inner to
//   outer; the shadows follow the cut-out too (a depth material with the same map and alpha test).
// Units are the body's: decimetres (a 178 cm man is 17.8 tall).

import * as THREE from './vendor/three/three.module.min.js';

// How far each slot's shell stands off the body's outline, at the front and the back (decimetres); a
// top's at the sides less (the arms hang there: SIDE_K of it), round the arms less again (SLEEVE_K).
// The trousers sit closest, all round, so an untucked top always hangs over them.
export const CHANNEL = { top: 0.2, layer: 0.5, jacket: 0.9, bottoms: 0.12 };
const SIDE_K = 0.7, SLEEVE_K = 0.3;
const ORDER = { bottoms: 1, top: 2, layer: 3, jacket: 4 };
const NA = 96;          // bins round a row (support function)
const COLS = 48;        // columns per half shell
const ROW = 0.1;        // 1 cm rows
const ALPHA_CUT = 0.5;
const OPEN_GAP = 0.36;  // half the parting of an open front at the chest (3.6 cm each side of the middle)

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ---------- the body's outline: per row, a centre and the support distance per direction ---------- */

// Rows of points (x, z) by height: where the body's triangle edges cross each row's plane (only
// triangles whose corners `pick` keeps), so even a sparse part of the mesh gives the whole outline.
function bucket(B, D, pick, y0, y1) {
  const n = Math.max(2, Math.ceil((y1 - y0) / ROW) + 1), rows = Array.from({ length: n }, () => []);
  const P = B.P, I = D.index, ok = new Uint8Array(D.m);
  for (let c = 0; c < D.m; c++) ok[c] = pick(c) ? 1 : 0;
  const add = (a, b) => {
    let ya = P[a * 3 + 1], yb = P[b * 3 + 1];
    if (ya > yb) { const t = a; a = b; b = t; const u = ya; ya = yb; yb = u; }
    const k0 = Math.max(0, Math.ceil((ya - y0) / ROW)), k1 = Math.min(n - 1, Math.floor((yb - y0) / ROW));
    for (let k = k0; k <= k1; k++) {
      const t = yb > ya ? (y0 + k * ROW - ya) / (yb - ya) : 0;
      rows[k].push(mix(P[a * 3], P[b * 3], t), mix(P[a * 3 + 2], P[b * 3 + 2], t));
    }
  };
  for (let i = 0; i < I.length; i += 3) {
    const a = I[i], b = I[i + 1], c = I[i + 2];
    if (ok[a] && ok[b] && ok[c]) { add(a, b); add(b, c); add(c, a); }
  }
  return rows;
}
// For one row: its centre (bounding box middle) and h(theta) = how far the outline reaches towards
// theta (0 = front, +x = his left at +90 degrees). A ring at h(theta) lies on or outside the outline.
function support(pts, cx, cz) {
  const h = new Float32Array(NA).fill(0);
  for (let k = 0; k < NA; k++) {
    const t = (k / NA) * 2 * Math.PI - Math.PI, sx = Math.sin(t), sz = Math.cos(t);
    let m = 0; for (let i = 0; i < pts.length; i += 2) { const d = (pts[i] - cx) * sx + (pts[i + 1] - cz) * sz; if (d > m) m = d; }
    h[k] = m;
  }
  return h;
}
// Rings from y0 to y1 (row 0 at y0): centres and support, smoothed along the height and round the row,
// so the shell curves gently. Rows with too few points take their neighbours'.
function rings(B, D, pick, y0, y1, smooth = 3) {
  const rows = bucket(B, D, pick, y0, y1), n = rows.length;
  const cx = new Float32Array(n).fill(NaN), cz = new Float32Array(n).fill(NaN), H = new Array(n).fill(null);
  for (let r = 0; r < n; r++) {
    const p = rows[r]; if (p.length < 16) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
    cx[r] = (x0 + x1) / 2; cz[r] = (z0 + z1) / 2; H[r] = support(p, cx[r], cz[r]);
  }
  for (let r = 1; r < n; r++) if (!H[r] && H[r - 1]) { H[r] = Float32Array.from(H[r - 1]); cx[r] = cx[r - 1]; cz[r] = cz[r - 1]; }
  for (let r = n - 2; r >= 0; r--) if (!H[r] && H[r + 1]) { H[r] = Float32Array.from(H[r + 1]); cx[r] = cx[r + 1]; cz[r] = cz[r + 1]; }
  if (!H[0]) return null;
  // smooth: centres along the height, support along the height (never inwards) and round the row
  for (let pass = 0; pass < smooth; pass++) {
    const a = cx.slice(), b = cz.slice(), h0 = H.map((x) => Float32Array.from(x));
    for (let r = 0; r < n; r++) {
      const lo = Math.max(0, r - 1), hi = Math.min(n - 1, r + 1);
      cx[r] = (a[lo] + a[r] + a[hi]) / 3; cz[r] = (b[lo] + b[r] + b[hi]) / 3;
      for (let k = 0; k < NA; k++) {
        const v = (h0[lo][k] + 2 * h0[r][k] + h0[hi][k]) / 4, w = (h0[r][(k + NA - 1) % NA] + 2 * h0[r][k] + h0[r][(k + 1) % NA]) / 4;
        H[r][k] = Math.max(h0[r][k], (v + w) / 2);
      }
    }
  }
  return { y0, n, cx, cz, H };
}
// Ring b's outline over ring a's where w(y) > 0 (same rows), in place.
function blendRings(a, b, w) {
  for (let r = 0; r < a.n; r++) {
    const t = w(a.y0 + r * ROW); if (t <= 0) continue;
    a.cx[r] = mix(a.cx[r], b.cx[r], t); a.cz[r] = mix(a.cz[r], b.cz[r], t);
    for (let k = 0; k < NA; k++) a.H[r][k] = Math.max(a.H[r][k], mix(a.H[r][k], b.H[r][k], t));
  }
  return a;
}
const ringAt = (Rg, y) => clamp((y - Rg.y0) / ROW, 0, Rg.n - 1.001);
// A point of the shell: row height y, direction theta, the channel depth (less at the sides).
function pointOn(Rg, y, t, ch, out) {
  const f = ringAt(Rg, y), r0 = Math.floor(f), w = f - r0, r1 = r0 + 1;
  const kf = ((t + Math.PI) / (2 * Math.PI)) * NA, k0 = ((Math.floor(kf) % NA) + NA) % NA, k1 = (k0 + 1) % NA, wk = kf - Math.floor(kf);
  const h = mix(mix(Rg.H[r0][k0], Rg.H[r0][k1], wk), mix(Rg.H[r1][k0], Rg.H[r1][k1], wk), w);
  const c = Math.cos(t), d = h + ch * (Rg.chK ? Rg.chK(y) : 1) * mix(Rg.sideK ?? SIDE_K, 1, c * c);
  out[0] = mix(Rg.cx[r0], Rg.cx[r1], w) + Math.sin(t) * d; out[1] = y; out[2] = mix(Rg.cz[r0], Rg.cz[r1], w) + c * d;
  return out;
}
// Arc length of a row from theta a to theta b (dense samples), and theta at an arc length from a.
function arcTable(Rg, y, ch, a, b, n = 128) {
  const th = new Float32Array(n + 1), s = new Float32Array(n + 1), p = [0, 0, 0], q = [0, 0, 0];
  pointOn(Rg, y, a, ch, p);
  for (let i = 0; i <= n; i++) {
    th[i] = mix(a, b, i / n); pointOn(Rg, y, th[i], ch, q);
    s[i] = i ? s[i - 1] + Math.hypot(q[0] - p[0], q[2] - p[2]) : 0; p[0] = q[0]; p[2] = q[2];
  }
  return { th, s, L: s[n], sOf(t) { const f = clamp(((t - a) / (b - a)) * n, 0, n), i = Math.min(n - 1, Math.floor(f)); return mix(s[i], s[i + 1], f - i); }, at(len) { let i = 0; while (i < n - 1 && s[i + 1] < len) i++; const t = (len - s[i]) / Math.max(1e-6, s[i + 1] - s[i]); return mix(th[i], th[i + 1], clamp(t, 0, 1)); } };
}

/* ---------- geometry ---------- */

function gridGeometry(rowsN, colsN, fill) {
  const pos = new Float32Array(rowsN * colsN * 3), uv = new Float32Array(rowsN * colsN * 2), idx = [];
  for (let r = 0; r < rowsN; r++) for (let c = 0; c < colsN; c++) fill(r, c, pos, uv, (r * colsN + c));
  for (let r = 0; r + 1 < rowsN; r++) for (let c = 0; c + 1 < colsN; c++) {
    const a = r * colsN + c, b = a + 1, d = a + colsN, e = d + 1;
    idx.push(a, d, b, b, d, e);
  }
  return { pos, uv, idx };
}
function merge(parts) {
  let nv = 0; for (const p of parts) nv += p.pos.length / 3;
  const pos = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), idx = [];
  let o = 0;
  for (const p of parts) { pos.set(p.pos, o * 3); uv.set(p.uv, o * 2); for (const i of p.idx) idx.push(i + o); o += p.pos.length / 3; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  // (the winding faces outwards on the front half; both sides are drawn, so the inside reads as lining)
  g.computeVertexNormals();
  return g;
}

/* ---------- the photos ---------- */

// Where each row of a cut-out has garment (its alpha), in u (0-1): per row (row 0 = the top), the
// runs [a, b] left to right.
const SPAN_ROWS = 160;
function spansOf(img) {
  const w = Math.min(256, img.width), h = SPAN_ROWS;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, rows = [];
  for (let y = 0; y < h; y++) {
    const runs = []; let s = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && d[(y * w + x) * 4 + 3] > 127;
      if (on && s < 0) s = x;
      if (!on && s >= 0) { runs.push([s, x - 1]); s = -1; }
    }
    const m = [];
    for (const r of runs) { if (m.length && r[0] - m[m.length - 1][1] <= 3) m[m.length - 1][1] = r[1]; else m.push(r); }
    rows.push(m.filter((r) => r[1] - r[0] >= 2).map(([a, b]) => [a / (w - 1), b / (w - 1)]));
  }
  return rows;
}
const rowAt = (rows, v) => rows[clamp(Math.floor((1 - v) * rows.length), 0, rows.length - 1)];
const fullSpan = (runs) => (runs.length ? [runs[0][0], runs[runs.length - 1][1]] : null);
// The mean colour (linear) of an image's garment pixels, small and quick.
const toLin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
function meanColour(img) {
  const c = document.createElement('canvas'); c.width = c.height = 48;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, 48, 48);
  const d = g.getImageData(0, 0, 48, 48).data, m = [0, 0, 0]; let n = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { m[0] += toLin(d[i]); m[1] += toLin(d[i + 1]); m[2] += toLin(d[i + 2]); n++; }
  return n ? m.map((v) => v / n) : null;
}
const toSRGB = (v) => Math.round(255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));
// The back when there is no back photo: the front's outline, mirrored (the back as seen from behind),
// filled with the photo's own colour and the fabric's grain. Never the mirrored photo.
function backFromFront(tex, mean, tile) {
  const img = tex.image, c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  const outline = () => { g.save(); g.translate(c.width, 0); g.scale(-1, 1); g.drawImage(img, 0, 0); g.restore(); };
  outline();
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = `rgb(${mean.map((v) => toSRGB(clamp(v, 0, 1))).join(',')})`; g.fillRect(0, 0, c.width, c.height);
  if (tile?.image) {
    // the grain at about its real size (a top's photo is ~5 dm wide)
    const k = (img.width / 50) * ((tile.userData?.cm || 8) / tile.image.width);
    const pat = g.createPattern(tile.image, 'repeat'); pat.setTransform(new DOMMatrix().scale(k, k));
    g.globalCompositeOperation = 'soft-light'; g.globalAlpha = 0.8; g.fillStyle = pat; g.fillRect(0, 0, c.width, c.height);
    g.globalAlpha = 1; g.globalCompositeOperation = 'destination-in'; outline();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function prepTex(t) {
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.anisotropy = 4; t.needsUpdate = true;
  return t;
}
function shellMaterial(map, color, roughness, alphaTest) {
  const m = new THREE.MeshStandardMaterial({ map, color: map ? 0xffffff : color, roughness, metalness: 0, alphaTest, transparent: false, depthWrite: true, side: THREE.DoubleSide, envMapIntensity: 0.25 });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest, side: THREE.DoubleSide });
  return { m, depth };
}

// How long a top is from the neck base to the hem, for a 178 cm man (decimetres): [shortest, longest].
// The photo keeps its proportions; when filling the chest's width would make it longer or shorter than
// this, it is scaled to the nearest length and the sides get the fabric.
const TOP_LEN = { tee: [5.8, 6.8], tank: [5.8, 6.8], longsleeve: [5.8, 6.8], sweater: [5.8, 6.8], hoodie: [5.8, 6.8], trackjacket: [5.6, 6.6], bomber: [5.0, 5.6], puffer: [5.8, 7.4], jacket_open: [6.0, 7.6] };
const OVERLAP = 0.15; // how far the fabric beside the photo runs under its edge (decimetres)
// Length down the shell's surface from yTop (mean of the front and back centre lines), as a function of
// height, and the height at a length.
function meridian(Rg, ch, yTop, yBot) {
  const ys = rowsBetween(yTop, yBot), m = new Float32Array(ys.length), p = [0, 0, 0], q = [0, 0, 0], a = [0, 0, 0], b = [0, 0, 0];
  for (let r = 1; r < ys.length; r++) {
    pointOn(Rg, ys[r - 1], 0, ch, p); pointOn(Rg, ys[r], 0, ch, q); pointOn(Rg, ys[r - 1], Math.PI, ch, a); pointOn(Rg, ys[r], Math.PI, ch, b);
    m[r] = m[r - 1] + (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2])) / 2;
  }
  const step = ys.length > 1 ? ys[0] - ys[1] : ROW;
  return {
    at(y) { const f = clamp((ys[0] - y) / step, 0, ys.length - 1), i = Math.min(ys.length - 2, Math.floor(f)); return i < 0 ? 0 : mix(m[i], m[i + 1], f - i); },
    yAt(len) { let i = 0; while (i < ys.length - 1 && m[i + 1] < len) i++; if (i >= ys.length - 1) return ys[ys.length - 1]; return mix(ys[i], ys[i + 1], (len - m[i]) / Math.max(1e-6, m[i + 1] - m[i])); },
  };
}
const rowsBetween = (yTop, yBot) => { const n = Math.max(2, Math.ceil((yTop - yBot) / ROW) + 1); return Array.from({ length: n }, (_, r) => mix(yTop, yBot, r / (n - 1))); };

// A strip of a half ring: on row r, from arc length range(r)[0] to range(r)[1] (from the half's start),
// with uv(r, s). The rows' arc tables are shared by every strip of the half.
// cap(theta): the highest the strip reaches there (the fabric beside a photo stops at the shoulder).
function strip(Rg, ys, arcs, ch, range, uv, cap) {
  const p = [0, 0, 0];
  return gridGeometry(ys.length, COLS + 1, (r, c, pos, uvA, i) => {
    const A = arcs[r], [s0, s1] = range(r, A.L), s = mix(s0, s1, c / COLS), t = A.at(s);
    pointOn(Rg, cap ? Math.min(ys[r], cap(t)) : ys[r], t, ch, p); pos.set(p, i * 3);
    const [u, v] = uv(r, s, A.L); uvA[i * 2] = u; uvA[i * 2 + 1] = v;
  });
}
// One half of a ring shell: the photo pieces (each [from, to] in arc length on the row, with the
// photo's u at s), and the fabric on either side (from the half's start to just under the first piece,
// from just under the last one to its end, never into an open front's parting [limL, limR]).
function halfShell(Rg, ys, a, b, ch, pieces, vOf, tileD, lim, cap) {
  const arcs = ys.map((y) => arcTable(Rg, y, ch, a, b, 96)), P = pieces;
  const photo = P.map((pc) => strip(Rg, ys, arcs, ch, (r, L) => pc.range(r, L), (r, s, L) => [pc.u(r, s, L), vOf(ys[r])]));
  const first = (r, L) => P[0].range(r, L)[0], last = (r, L) => P[P.length - 1].range(r, L)[1];
  const chB = ch - 0.02, tuv = (r, s) => [s / tileD, ys[r] / tileD];
  const fabric = [
    strip(Rg, ys, arcs, chB, (r, L) => [0, Math.min(lim ? lim(L)[0] : L, first(r, L) + OVERLAP)], tuv, cap),
    strip(Rg, ys, arcs, chB, (r, L) => [Math.max(lim ? lim(L)[1] : 0, last(r, L) - OVERLAP), L], (r, s, L) => [(s + 7 * L) / tileD, ys[r] / tileD], cap),
  ];
  return { photo, fabric };
}

/* ---------- one worn piece ---------- */

// cut: { front: Texture (with alpha), back: Texture|null } — the garment's crop of each photo (tops:
// shoulder line to hem, side seam to side seam; bottoms: waistband to hems).
export class ShellGarment {
  // size: what the photo and the wearer make of the piece (avatar-config.js: bottomsSize);
  // adjust: the wearer's own { scale, offsetY (cm, + higher) }
  constructor({ slot, sub, spec, cut, fabric, tile, tileCm, roughness, R, size = null, adjust = null }) {
    this.slot = slot; this.sub = sub; this.spec = spec; this.R = R; this.size = size; this.adjust = adjust;
    this.group = new THREE.Group(); this.group.name = 'shell:' + slot;
    this.own = []; // textures this piece made (the plain back)
    const color = fabric || '#777777';
    this.front = cut?.front ? prepTex(cut.front) : null;
    if (tile) { tile.wrapS = tile.wrapT = THREE.RepeatWrapping; tile.userData.cm = tileCm || 8; tile.needsUpdate = true; }
    // the fabric beside the photos and on the sleeves takes the photo's own colour (the baked tile is
    // evened out for the avatar's light; the photo isn't)
    const mean = this.front ? meanColour(this.front.image) : null, tileMean = tile?.image ? meanColour(tile.image) : null;
    this.hasBack = !!cut?.back;
    this.back = cut?.back ? prepTex(cut.back) : this.front ? prepTex(this.ownTex(backFromFront(this.front, mean || [0.2, 0.2, 0.2], tile))) : null;
    this.tileD = (tileCm || 8) / 10;
    const rough = clamp(roughness ?? 0.85, 0.75, 0.95);
    // front photo, back photo, the fabric (sides, sleeves)
    this.mats = [shellMaterial(this.front, color, rough, ALPHA_CUT), shellMaterial(this.back, color, rough, ALPHA_CUT), shellMaterial(tile || null, color, rough, 0)];
    if (tile && mean && tileMean) this.mats[2].m.color.setRGB(...mean.map((v, i) => clamp(v / Math.max(1e-3, tileMean[i]), 0.15, 2.5)));
    else if (mean) this.mats[2].m.color.setRGB(...mean);
    else this.mats[2].m.color.set(tile ? 0xffffff : color);
    this.meshes = this.mats.map(({ m, depth }, i) => {
      const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
      mesh.customDepthMaterial = depth;
      mesh.frustumCulled = false; // (no shadow map since round 8: castShadow stays off)
      mesh.renderOrder = ORDER[slot] ?? 1; mesh.name = ['front', 'back', 'fabric'][i];
      // concentric shells never fight for the same depth: each layer out is drawn a step nearer
      m.polygonOffset = true; m.polygonOffsetFactor = -0.6 * (ORDER[slot] ?? 1); m.polygonOffsetUnits = -1.5 * (ORDER[slot] ?? 1);
      this.group.add(mesh);
      return mesh;
    });
    this.spans = this.front ? { f: spansOf(this.front.image), b: spansOf(this.back.image) } : null;
  }
  ownTex(t) { this.own.push(t); return t; }

  // Build the shell round the body as it is now (every time the body changes).
  // hemMin: the lowest a top may hang (under a jacket: just below its hem, like the avatar's tops)
  // tuckY: the top of the waistband this top is tucked into (it goes inside it and ends just under)
  update(B, D, { hemMin = -Infinity, tuckY = null } = {}) {
    const ch = CHANNEL[this.slot] ?? 0.2;
    const parts = !this.front ? [[], [], []] : this.spec.slot === 'bottoms' ? this.bottoms(B, D, ch) : this.top(B, D, ch, hemMin, tuckY);
    this.meshes.forEach((mesh, i) => {
      mesh.geometry.dispose();
      mesh.geometry = parts[i] && parts[i].length ? merge(parts[i]) : new THREE.BufferGeometry();
    });
    this.info = parts.info;
  }

  top(B, D, ch, hemMin, tuckY = null) {
    const { R, spans } = this, J = B.J, s = B.s, sh = B.height / 17.8;
    const imgF = this.front.image, imgB = this.back.image, aspF = imgF.height / imgF.width, aspB = imgB.height / imgB.width;
    // the photo's top edge at the base of the neck; its width matched to the chest
    const yTop = J.neck[1] - 0.1 * s, yChest = J.chest[1];
    const torso = (c) => (D.region[c] === R.TORSO && D.armW[c] < 0.3) || D.region[c] === R.THIGH || (D.region[c] === R.SHIN && this.spec.slot === 'jacket');
    const floor = J.kneeL[1] - 1.2 * s;
    // over the shoulders the shell takes the deltoids in (no bare shoulder between the body and the
    // sleeve), fading out by the armpit, where the arms hang free of it
    const ySh = (J.shoulderL[1] + J.shoulderR[1]) / 2, yArm = ySh - 0.55 * s;
    const withArms = (c) => torso(c) || (D.region[c] === R.UPPERARM && B.P[c * 3 + 1] > ySh - 0.15 * s);
    const R1 = rings(B, D, torso, floor, yTop + 0.3 * s), R2 = R1 && rings(B, D, withArms, floor, yTop + 0.3 * s);
    if (!R1 || !R2) return [[], [], []];
    const Rg = blendRings(R1, R2, (y) => sstep(ySh - 0.45 * s, ySh, y));
    // the cloth lies on the shoulders: the channel narrows from the armpit up to the neck (every layer
    // alike, so they stay in order)
    // (tucked in: it narrows to the waist too, inside the waistband's own channel)
    Rg.chK = (y) => mix(1, 0.3, sstep(yArm, yTop, y)) * (tuckY == null ? 1 : mix(0.3, 1, sstep(tuckY, tuckY + 0.9 * s, y)));
    if (tuckY != null) hemMin = Math.max(hemMin, tuckY - 0.25 * s);
    const Lc = arcTable(Rg, yChest, ch, -Math.PI / 2, Math.PI / 2).L;
    const cw = fullSpan(rowAt(spans.f, 0.75)) || [0, 1];
    const [lo, hi] = (TOP_LEN[this.sub] || [5.8, 6.8]).map((x) => x * sh);
    // (the wearer's Scale sizes the whole photo; the Vertical offset lifts or drops its hem)
    const adj = this.adjust || {}, len = Math.max(2 * sh, clamp((Lc / Math.max(0.2, cw[1] - cw[0])) * aspF, lo, hi) * (adj.scale || 1) - ((adj.offsetY || 0) / 10) * s), W = len / aspF, WB = len / aspB;
    // the photo runs down the body's surface (over the chest and the shoulder blades, not straight
    // down), so it isn't stretched where the body slopes: its length is measured along the front and
    // back centre lines (their mean), row by row
    const mer = meridian(Rg, ch, yTop, floor + 0.1);
    const yHem = Math.max(floor + 0.1, mer.yAt(len), hemMin), ys = rowsBetween(yTop, yHem);
    const vOf = (y) => 1 - mer.at(y) / len;
    const open = !!this.spec.open, gap = open ? OPEN_GAP * s : 0;
    const spanAt = (rows, r) => fullSpan(rowAt(rows, vOf(ys[r]))) || [0.5, 0.5];
    // front: his right side (-x) to his left; an open front is parted at the middle, each half of the
    // photo starting at the parting
    const frontPieces = open
      ? [
          { range: (r, L) => [clamp(L / 2 - gap + (spanAt(spans.f, r)[0] - 0.5) * W, 0, L / 2 - gap), L / 2 - gap], u: (r, sc, L) => 0.5 + (sc - (L / 2 - gap)) / W },
          { range: (r, L) => [L / 2 + gap, clamp(L / 2 + gap + (spanAt(spans.f, r)[1] - 0.5) * W, L / 2 + gap, L)], u: (r, sc, L) => 0.5 + (sc - (L / 2 + gap)) / W },
        ]
      : [{ range: (r, L) => { const sp = spanAt(spans.f, r); return [clamp(L / 2 + (sp[0] - 0.5) * W, 0, L / 2), clamp(L / 2 + (sp[1] - 0.5) * W, L / 2, L)]; }, u: (r, sc, L) => 0.5 + (sc - L / 2) / W }];
    // the fabric beside the photo slopes down from the neck to the top of the shoulder, like a seam
    const cap = (t) => mix(yTop, ySh + 0.4 * s, sstep(0.3, 0.95, Math.abs(Math.sin(t))));
    const F = halfShell(Rg, ys, -Math.PI / 2, Math.PI / 2, ch, frontPieces, vOf, this.tileD, open ? (L) => [L / 2 - gap, L / 2 + gap] : null, cap);
    // back: his left side (+x) round to his right, i.e. left to right as seen from behind
    const backPieces = [{ range: (r, L) => { const sp = spanAt(spans.b, r); return [clamp(L / 2 + (sp[0] - 0.5) * WB, 0, L / 2), clamp(L / 2 + (sp[1] - 0.5) * WB, L / 2, L)]; }, u: (r, sc, L) => 0.5 + (sc - L / 2) / WB }];
    const Bk = halfShell(Rg, ys, Math.PI / 2, 3 * Math.PI / 2, ch, backPieces, vOf, this.tileD, null, cap);
    const sleeves = this.sleeves(B, D, ch * SLEEVE_K);
    const out = [F.photo, Bk.photo, [...F.fabric, ...Bk.fabric, ...sleeves]];
    out.info = { W, WB, len, yTop, yHem, ch, open, gap, Rg, ys };
    return out;
  }

  sleeves(B, D, ch) {
    const len = this.spec.sleeve || 0; if (len <= 0.05) return [];
    const J = B.J, R = this.R, out = [], tileD = this.tileD;
    for (const side of ['L', 'R']) {
      const a = J['shoulder' + side], b = J['elbow' + side], c = J['wrist' + side];
      const L1 = dist(a, b), L2 = dist(b, c), L = L1 + L2, end = len * L;
      // the arm's radius along its bones (80th percentile per 1 cm), never growing from the wrist up
      const NB = Math.max(4, Math.ceil(L / ROW)), rs = Array.from({ length: NB }, () => []);
      for (let v = 0; v < D.m; v++) {
        const rg = D.region[v]; if (rg !== R.UPPERARM && rg !== R.FOREARM) continue;
        if ((side === 'L') !== (B.P[v * 3] >= 0)) continue;
        const q = chain(B.P, v, a, b, c, L1, L2); if (q.t <= 0 || q.t >= L) continue;
        rs[Math.min(NB - 1, Math.floor((q.t / L) * NB))].push(q.r);
      }
      const prof = new Float32Array(NB);
      for (let k = 0; k < NB; k++) { const l = rs[k].sort((x, y) => x - y); prof[k] = l.length ? l[Math.floor((l.length - 1) * 0.8)] : 0; }
      let run = 0; for (let k = NB - 1; k >= 0; k--) { run = Math.max(run, prof[k]); prof[k] = run; }
      // smooth (no rings where the 1 cm bins step), never inwards
      for (let pass = 0; pass < 3; pass++) { const q = Float32Array.from(prof); for (let k = 0; k < NB; k++) prof[k] = Math.max(q[k], (q[Math.max(0, k - 2)] + q[Math.max(0, k - 1)] + q[k] + q[Math.min(NB - 1, k + 1)] + q[Math.min(NB - 1, k + 2)]) / 5); }
      // a rounded cap over the top of the shoulder, then the tube to the cuff
      const t0 = -0.6 * prof[0], rows = Math.max(2, Math.ceil((end - t0) / ROW) + 1), NS = 24;
      out.push(gridGeometry(rows, NS + 1, (r, k, pos, uv, i) => {
        const t = mix(t0, end, r / (rows - 1)), at = along(a, b, c, L1, t), f = (Math.max(0, t) / L) * NB;
        const k0 = clamp(Math.floor(f - 0.5), 0, NB - 1), k1 = Math.min(NB - 1, k0 + 1);
        const rad = (mix(prof[k0], prof[k1], clamp(f - 0.5 - k0, 0, 1)) + ch) * (t < 0 ? Math.sqrt(1 - 0.8 * (t / t0) ** 2) : 1);
        const ang = (k / NS) * 2 * Math.PI, { u: U, v: V } = at;
        for (let j = 0; j < 3; j++) pos[i * 3 + j] = at.p[j] + (U[j] * Math.cos(ang) + V[j] * Math.sin(ang)) * rad;
        uv[i * 2] = (ang * rad) / tileD; uv[i * 2 + 1] = t / tileD;
      }));
    }
    return out;
  }

  bottoms(B, D, ch) {
    const { R, spans } = this, J = B.J, s = B.s;
    const imgF = this.front.image, imgB = this.back.image, aspF = imgF.height / imgF.width, aspB = imgB.height / imgB.width;
    // the waistband round the high hip; the hems on the shoes; the legs part at the body's crotch
    const z = this.size || {}, legFull = this.spec.leg ?? 1;
    const yWaist = mix(J.pelvis[1], J.waist[1], 0.45) + ((z.waist ?? this.spec.waist ?? 2.02) - (this.spec.waist ?? 2.02)) * s, yAnkle = Math.max(J.ankleL[1], J.ankleR[1]);
    let yCrotch = Infinity; for (let c = 0; c < D.m; c++) if (D.region[c] === R.TORSO && Math.abs(B.P[c * 3]) < 0.25 * s) yCrotch = Math.min(yCrotch, B.P[c * 3 + 1]);
    // The hems: full-length legs on the shoes; shorter ones where the photo's own length for its
    // waistband puts them (z.leg: 0 the hip joint, 1 the ankle), so shorts stay short.
    const leggings = this.sub === 'leggings', yFull = yAnkle + (leggings ? 0.1 : 0.35) * s;
    const L1 = dist(J.hipL, J.kneeL), L2 = dist(J.kneeL, J.ankleL), tK = L1 / (L1 + L2);
    const yLeg = (t) => (t <= tK ? mix(J.hipL[1], J.kneeL[1], t / tK) : mix(J.kneeL[1], J.ankleL[1], (t - tK) / (1 - tK)));
    const yHemWant = z.leg != null && z.leg < legFull - 0.01 ? Math.max(yFull, yLeg(z.leg)) : yFull;
    const len = yWaist - yHemWant, W = len / aspF, WB = len / aspB, vOf = (y) => 1 - (yWaist - y) / len;
    const hips = (c) => D.region[c] === R.TORSO || D.region[c] === R.THIGH;
    const Rg = rings(B, D, hips, yCrotch - 0.2 * s, yWaist + 0.2 * s);
    if (!Rg) return [[], [], []];
    Rg.sideK = 1;
    const photoF = [], photoB = [], fabric = [];
    const one = (Ring, ys, piecesF, piecesB) => {
      const f = halfShell(Ring, ys, -Math.PI / 2, Math.PI / 2, ch, piecesF, vOf, this.tileD, null);
      const b = halfShell(Ring, ys, Math.PI / 2, 3 * Math.PI / 2, ch, piecesB, vOf, this.tileD, null);
      photoF.push(...f.photo); photoB.push(...b.photo); fabric.push(...f.fabric, ...b.fabric);
    };
    // hips: one ring, each photo across it
    const whole = (rows, Wd, ys) => [{ range: (r, L) => { const sp = fullSpan(rowAt(rows, vOf(ys[r]))) || [0.5, 0.5]; return [clamp(L / 2 + (sp[0] - 0.5) * Wd, 0, L / 2), clamp(L / 2 + (sp[1] - 0.5) * Wd, L / 2, L)]; }, u: (r, sc, L) => 0.5 + (sc - L / 2) / Wd }];
    const yH = Math.max(yHemWant, yCrotch), ysH = rowsBetween(yWaist, yH);
    one(Rg, ysH, whole(spans.f, W, ysH), whole(spans.b, WB, ysH));
    // legs: a ring each; each gets its leg of the photo, centred on the leg's front (its back)
    if (yHemWant < yCrotch - 0.05) for (const side of [-1, 1]) {
      const leg = (c) => (D.region[c] === R.THIGH || D.region[c] === R.SHIN || D.region[c] === R.TORSO) && B.P[c * 3] * side > 0.02 * s;
      const Lg = rings(B, D, leg, yHemWant - 0.2 * s, yCrotch + 0.2 * s);
      if (!Lg) continue;
      Lg.sideK = 1;
      const ys = rowsBetween(yCrotch, yHemWant);
      // his right leg (-x) is the photo's left leg from the front, its right leg from behind; at the
      // crotch the leg's photo carries on from the hips' (no step), then follows the photo's leg
      const off = Lg.cx[Math.round(ringAt(Lg, yCrotch))] - Rg.cx[Math.round(ringAt(Rg, yCrotch))];
      const pieceOf = (rows, which, Wd, top) => {
        const runs = ys.map((y) => legRun(rows, vOf(y), which)), cu = smoothCentres(runs);
        for (let r = 0; r < ys.length; r++) cu[r] = mix(top, cu[r], sstep(0, 2.5 * s, yCrotch - ys[r]));
        return [{ range: (r, L) => [clamp(L / 2 + (runs[r][0] - cu[r]) * Wd, 0, L / 2), clamp(L / 2 + (runs[r][1] - cu[r]) * Wd, L / 2, L)], u: (r, sc, L) => cu[r] + (sc - L / 2) / Wd }];
      };
      one(Lg, ys, pieceOf(spans.f, side < 0 ? 0 : 1, W, 0.5 + off / W), pieceOf(spans.b, side < 0 ? 1 : 0, WB, 0.5 - off / WB));
    }
    const out = [photoF, photoB, fabric];
    out.info = { W, WB, len, yTop: yWaist, yHem: yHemWant, yCrotch, ch, Rg };
    return out;
  }

  // The shell's point at height y towards theta (0 = front), for checks and tools.
  probe(y, t) { const Rg = this.info?.Rg; return Rg ? pointOn(Rg, y, t, this.info.ch, [0, 0, 0]) : null; }
  setVisible(v) { this.group.visible = !!v; }
  dispose() {
    for (const m of this.meshes) m.geometry.dispose();
    for (const { m, depth } of this.mats) { m.dispose(); depth.dispose(); }
    for (const t of this.own) t.dispose();
  }
}

// One leg's run on a photo row (which: 0 = the photo's left leg, 1 = its right): the row's first or
// last run when the legs are apart, else that half of the row's span.
function legRun(rows, v, which) {
  const runs = rowAt(rows, v);
  if (!runs.length) return [0.25 + which * 0.5, 0.25 + which * 0.5];
  if (runs.length >= 2) return which ? runs[runs.length - 1] : runs[0];
  const [a, b] = runs[0], m = (a + b) / 2;
  return which ? [m, b] : [a, m];
}
// The middle of each row's run, smoothed down the leg (a splayed leg in the photo hangs straight).
function smoothCentres(runs) {
  const c = runs.map(([a, b]) => (a + b) / 2), out = new Float32Array(c.length);
  for (let i = 0; i < c.length; i++) { let s = 0, n = 0; for (let j = Math.max(0, i - 4); j <= Math.min(c.length - 1, i + 4); j++) { s += c[j]; n++; } out[i] = s / n; }
  return out;
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
// Distance of vertex v from the arm's bones (shoulder-elbow-wrist) and how far along them it is.
function chain(P, v, a, b, c, L1, L2) {
  let best = null;
  for (let sg = 0; sg < 2; sg++) {
    const o = sg ? b : a, e = sg ? c : b, l = sg ? L2 : L1;
    const u = [(e[0] - o[0]) / l, (e[1] - o[1]) / l, (e[2] - o[2]) / l];
    const d = [P[v * 3] - o[0], P[v * 3 + 1] - o[1], P[v * 3 + 2] - o[2]];
    const t = clamp(d[0] * u[0] + d[1] * u[1] + d[2] * u[2], 0, l);
    const r = Math.hypot(d[0] - t * u[0], d[1] - t * u[1], d[2] - t * u[2]);
    if (!best || r < best.r) best = { t: sg ? L1 + t : t, r };
  }
  return best;
}
// A point at arc length t along the bones, with two directions across the arm (smooth at the elbow).
function along(a, b, c, L1, t) {
  const u1 = norm(sub(b, a)), u2 = norm(sub(c, b));
  const p = t <= L1 ? add(a, scale(u1, t)) : add(b, scale(u2, t - L1));
  const w = clamp((t - (L1 - 0.4)) / 0.8, 0, 1), dir = norm(add(scale(u1, 1 - w), scale(u2, w)));
  const ref = Math.abs(dir[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const v = norm(cross(dir, ref)), u = cross(v, dir);
  return { p, u, v };
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/* ---------- the mannequin's head: a smooth egg, no face ---------- */

// Moves the head's vertices onto an egg fitted to the skull (chin to crown, ear-less width, nose-less
// depth), fading into the neck under the jaw. In place, on the drawn copy only (B.J and the shells
// don't use it).
export function eggHead(P, N, D, R, J) {
  let z0 = Infinity, z1 = -Infinity, n = 0;
  const yTop = J.headTop[1], yChin = J.neck3[1] - 0.02 * (yTop - J.neck3[1]);
  for (let c = 0; c < D.m; c++) if (D.region[c] === R.HEAD) { z0 = Math.min(z0, P[c * 3 + 2]); z1 = Math.max(z1, P[c * 3 + 2]); n++; }
  if (!n) return;
  const Hh = yTop - yChin, ry = Hh / 2, cy = yChin + ry, rx = 0.39 * Hh, zf = z1 - 0.13 * Hh; // (no nose)
  const rz = (zf - z0) / 2, cz = z0 + rz;
  for (let c = 0; c < D.m; c++) {
    if (D.region[c] !== R.HEAD && D.region[c] !== R.NECK) continue;
    const o = c * 3, y = P[o + 1];
    const w = clamp((y - (yChin - 0.28 * ry)) / (0.3 * ry), 0, 1);
    if (w <= 0) continue;
    // narrower towards the chin, like a skull
    const dy0 = (y - cy) / ry, taper = 1 - 0.16 * Math.max(0, -dy0);
    const ax = rx * taper, az = rz * (1 - 0.08 * Math.max(0, -dy0));
    const dx = (P[o] - J.head[0]) / ax, dz = (P[o + 2] - cz) / az, l = Math.hypot(dx, dy0, dz) || 1;
    const ex = J.head[0] + (dx / l) * ax, ey = cy + (dy0 / l) * ry, ez = cz + (dz / l) * az;
    P[o] = mix(P[o], ex, w); P[o + 1] = mix(y, ey, w); P[o + 2] = mix(P[o + 2], ez, w);
    const nx = dx / l / ax, ny = dy0 / l / ry, nz = dz / l / az, nl = Math.hypot(nx, ny, nz) || 1;
    N[o] = mix(N[o], nx / nl, w); N[o + 1] = mix(N[o + 1], ny / nl, w); N[o + 2] = mix(N[o + 2], nz / nl, w);
    const ml = Math.hypot(N[o], N[o + 1], N[o + 2]) || 1; N[o] /= ml; N[o + 1] /= ml; N[o + 2] /= ml;
  }
}
