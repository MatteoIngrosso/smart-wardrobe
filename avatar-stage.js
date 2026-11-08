// The 3D mirror on Today: a customizable man (the CC0 MakeHuman base mesh, built into avatar/ by
// tools/build-avatar.py) dressed in concentric garment shells painted with the panels that
// garment-baker.js bakes. Everything is drawn on the device with three.js: no server, no AI.
//
//   const stage = await createStage(container, { onAngle, onReady });
//   stage.setBody(config)                  live while sliders move (geometry refits at most every ~90 ms)
//   await stage.prepare(asset)             decode the textures and build the materials ahead
//   stage.setGarment(slot, asset | null, { visible })   instant (same frame) once prepared
//   stage.setVisible(slot, visible)        a ~170 ms fade that starts in the same frame
//   stage.snapTo(deg)                      0 front, 90 his right side, 180 back, 270 his left side
//   stage.angle; stage.resize(); stage.dispose(); stage.debug
//
// How the clothes are made: every garment is a patch of the body surface (clipped along smooth
// fields so hems, cuffs, necklines and the open front of a jacket are clean lines), subdivided once
// and pushed out along smoothed normals by a height field: the slot's distance (SLOT_OFFSET_MM), a
// drape (each row hangs from the widest part above it, bridging the body's hollows), folds, and the
// order of the layers (an outer piece is always at least a few millimetres outside every inner piece
// it overlaps, so nothing pokes through; an inner piece is not even drawn where an outer one fully
// covers it). Front and back panels are projected flat onto the front and back of the torso; the
// rest of the cloth uses the fabric tile.

import * as THREE from './vendor/three/three.module.min.js';
import { RoomEnvironment } from './vendor/three/addons/RoomEnvironment.js';
import { SLOTS, SLOT_OFFSET_MM, FACE_FRAME, cleanBody } from './avatar-config.js';
import { ShellGarment, eggHead } from './mannequin-shells.js';

const DATA = new URL('./avatar/', import.meta.url);
const BACKDROP = '#141413';
const D2R = Math.PI / 180;
const MM = 0.01;                 // the body is built in decimetres (MakeHuman units)
const ARM_DOWN = 9 * D2R;        // the upper arms hang 9 degrees away from the body (relaxed, not an A-pose)
const ELBOW_BEND = 8 * D2R;      // and the elbows stay a little bent
const FINGER_CURL = 38 * D2R;    // fingertips curl this much towards the palm
const LID_DROP = 8 * D2R;        // the upper lids come down a little (no wide-eyed stare)
const LEG_IN = 0.02;             // feet a touch closer than MakeHuman's stance (rad)
const FADE_MS = 170;
const SNAP_MS = 520;
const REFIT_MS = 90;             // live body changes refit the clothes at most this often
const SLOT_INDEX = { top: 0, layer: 1, jacket: 2, bottoms: 3, shoes: 4 };
// Which slots cover which (outer → inner), for the "not drawn where fully covered" test.
const OUTER_OF = { top: ['layer', 'jacket'], layer: ['jacket'], jacket: [], bottoms: ['top', 'layer', 'jacket'], shoes: ['bottoms'], skin: SLOTS };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const wrapAngle = (a) => ((a % 360) + 360) % 360;

/* =====================================================================================
   Data: avatar.bin + avatar.json (see tools/build-avatar.py)
   ===================================================================================== */

async function loadAvatarData() {
  const get = async (name, kind) => {
    const r = await fetch(new URL(name, DATA));
    if (!r.ok) throw new Error(`avatar-stage: ${name} ${r.status}`);
    return kind === 'json' ? r.json() : r.arrayBuffer();
  };
  const [hdr, buf] = await Promise.all([get('avatar.json', 'json'), get('avatar.bin')]);
  const T = { float32: Float32Array, uint32: Uint32Array, uint8: Uint8Array };
  const arr = (k) => new T[hdr[k].type](buf, hdr[k].offset, hdr[k].length);
  const N = hdr.vertexCount, full = arr('base'), indexFull = arr('index');
  // the body's own vertices (the helpers only place joints)
  const used = new Uint8Array(N);
  for (let k = 0; k < indexFull.length; k++) used[indexFull[k]] = 1;
  const ids = [], toC = new Int32Array(N).fill(-1);
  for (let i = 0; i < N; i++) if (used[i]) { toC[i] = ids.length; ids.push(i); }
  const m = ids.length;
  const index = new Uint32Array(indexFull.length);
  for (let k = 0; k < index.length; k++) index[k] = toC[indexFull[k]];
  const reg = arr('region'), aL = arr('armL'), aR = arr('armR'), lL = arr('legL'), lR = arr('legR');
  const rest = new Float32Array(m * 3), region = new Uint8Array(m), armW = new Float32Array(m), legW = new Float32Array(m);
  const aoAll = hdr.ao ? arr('ao') : null, ao = new Float32Array(m).fill(1);
  for (let c = 0; c < m; c++) {
    const i = ids[c];
    if (aoAll) ao[c] = aoAll[i] / 255;
    rest[c * 3] = full[i * 3]; rest[c * 3 + 1] = full[i * 3 + 1]; rest[c * 3 + 2] = full[i * 3 + 2];
    region[c] = reg[i];
    armW[c] = Math.max(aL[i], aR[i]) / 255;
    legW[c] = Math.max(lL[i], lR[i]) / 255;
  }
  const morphs = {};
  for (const name of hdr.morphs) morphs[name] = { i: arr(`m:${name}:i`), d: arr(`m:${name}:d`) };
  return {
    N, full, ids, m, index, rest, region, armW, legW, ao, morphs, joints: hdr.joints,
    eyeRel: arr('eyeRel'), eyeUV: arr('eyeUV'), eyeSide: arr('eyeSide'), irises: hdr.irises || [],
  };
}

const R = { TORSO: 1, UPPERARM: 2, FOREARM: 3, HAND: 4, THIGH: 5, SHIN: 6, FOOT: 7, HEAD: 8, NECK: 9 };

// Neighbour lists (CSR) of a triangle mesh.
function adjacency(n, index) {
  const sets = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    sets[a].add(b); sets[a].add(c); sets[b].add(a); sets[b].add(c); sets[c].add(a); sets[c].add(b);
  }
  const off = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) off[i + 1] = off[i] + sets[i].size;
  const nb = new Uint32Array(off[n]);
  for (let i = 0; i < n; i++) { let k = off[i]; for (const j of sets[i]) nb[k++] = j; }
  return { off, nb };
}

function vertexNormals(P, index, out) {
  out.fill(0);
  for (let t = 0; t < index.length; t += 3) {
    const i = index[t] * 3, j = index[t + 1] * 3, k = index[t + 2] * 3;
    const ax = P[j] - P[i], ay = P[j + 1] - P[i + 1], az = P[j + 2] - P[i + 2];
    const bx = P[k] - P[i], by = P[k + 1] - P[i + 1], bz = P[k + 2] - P[i + 2];
    const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
    out[i] += nx; out[i + 1] += ny; out[i + 2] += nz;
    out[j] += nx; out[j + 1] += ny; out[j + 2] += nz;
    out[k] += nx; out[k + 1] += ny; out[k + 2] += nz;
  }
  normalize3(out);
  return out;
}
function normalize3(a) {
  for (let o = 0; o < a.length; o += 3) {
    const l = Math.hypot(a[o], a[o + 1], a[o + 2]) || 1;
    a[o] /= l; a[o + 1] /= l; a[o + 2] /= l;
  }
}
// Average each vector with its neighbours, `iters` times (normals that ignore small bumps).
function smoothVectors(V, adj, iters, tmp = new Float32Array(V.length)) {
  const { off, nb } = adj, n = off.length - 1;
  for (let it = 0; it < iters; it++) {
    for (let v = 0; v < n; v++) {
      let x = V[v * 3], y = V[v * 3 + 1], z = V[v * 3 + 2];
      for (let k = off[v]; k < off[v + 1]; k++) { const u = nb[k] * 3; x += V[u]; y += V[u + 1]; z += V[u + 2]; }
      const l = Math.hypot(x, y, z) || 1;
      tmp[v * 3] = x / l; tmp[v * 3 + 1] = y / l; tmp[v * 3 + 2] = z / l;
    }
    V.set(tmp);
  }
  return V;
}

/* =====================================================================================
   Static fields over the rest (base) mesh: they never change with the body, so the clipped
   garment patches built from them keep their topology while the sliders move.
   ===================================================================================== */

function jointsOf(D, F) {
  const J = {};
  for (const [name, ids] of Object.entries(D.joints)) {
    let x = 0, y = 0, z = 0;
    for (const i of ids) { x += F[i * 3]; y += F[i * 3 + 1]; z += F[i * 3 + 2]; }
    J[name] = [x / ids.length, y / ids.length, z / ids.length];
  }
  return J;
}

const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// Parameter along a polyline A-B-C (0 at A, 1 at C, beyond at the ends) and the distance to it.
function chainT(p, A, B, C) {
  const L1 = len3(sub3(B, A)), L2 = len3(sub3(C, B)), L = L1 + L2;
  const seg = (a, b, l) => { const d = sub3(b, a); const t = dot3(sub3(p, a), d) / (l * l); const tc = clamp(t, 0, 1); const q = [a[0] + d[0] * tc, a[1] + d[1] * tc, a[2] + d[2] * tc]; return { t, dist: len3(sub3(p, q)) }; };
  const s1 = seg(A, B, L1), s2 = seg(B, C, L2);
  if (s1.dist <= s2.dist) return { t: (Math.min(s1.t, 1) * L1) / L, dist: s1.dist };
  return { t: (L1 + Math.max(s2.t, 0) * L2) / L, dist: s2.dist };
}

function staticFields(D) {
  const { m, rest, index, region, armW, legW } = D;
  const S = { adj: adjacency(m, index) };
  const J = jointsOf(D, D.full);
  S.J = J;
  // landmarks of the rest mesh
  let floorY = Infinity, topY = -Infinity;
  for (let c = 0; c < m; c++) {
    const y = rest[c * 3 + 1];
    if (region[c] === R.FOOT && y < floorY) floorY = y;
    if (region[c] === R.HEAD && y > topY) topY = y;
  }
  S.floorY = floorY; S.topY = topY;
  // the crotch: the lowest torso point near the middle
  let crotch = Infinity;
  for (let c = 0; c < m; c++) if (Math.abs(rest[c * 3]) < 0.25 && rest[c * 3 + 1] < J.hipL[1] && region[c] !== R.HAND && armW[c] < 0.1) {
    const y = rest[c * 3 + 1];
    if (y > floorY + 5 && y < crotch) crotch = y;
  }
  S.crotchY = crotch;
  { let r = 0; const e = D.eyeRel; for (let i = 0; i < e.length; i += 3) r = Math.max(r, Math.hypot(e[i], e[i + 1], e[i + 2])); S.eyeRadius = r || 0.12; }
  // torso rows: z centre and half width (side seam to side seam) by height
  S.rowY0 = crotch - 0.6; S.rowDy = 0.1; S.rows = Math.ceil((J.neck[1] + 0.6 - S.rowY0) / S.rowDy);
  const zmin = new Float32Array(S.rows).fill(Infinity), zmax = new Float32Array(S.rows).fill(-Infinity), xmax = new Float32Array(S.rows);
  S.torsoish = new Uint8Array(m);
  for (let c = 0; c < m; c++) {
    const y = rest[c * 3 + 1];
    const t = armW[c] < 0.12 && region[c] !== R.HAND && region[c] !== R.HEAD && y > crotch - 0.55 && y < J.neck[1] + 0.6;
    if (!t) continue;
    S.torsoish[c] = 1;
    const r = Math.round((y - S.rowY0) / S.rowDy);
    if (r < 0 || r >= S.rows) continue;
    const z = rest[c * 3 + 2], x = Math.abs(rest[c * 3]);
    if (z < zmin[r]) zmin[r] = z; if (z > zmax[r]) zmax[r] = z;
    if (armW[c] < 0.45 && x > xmax[r]) xmax[r] = x;
  }
  const fillRows = (a, bad) => { for (let r = 0; r < a.length; r++) if (bad(a[r])) { let k = 1; while (k < a.length) { const lo = a[r - k], hi = a[r + k]; if (lo !== undefined && !bad(lo)) { a[r] = lo; break; } if (hi !== undefined && !bad(hi)) { a[r] = hi; break; } k++; } } };
  fillRows(zmin, (v) => !isFinite(v)); fillRows(zmax, (v) => !isFinite(v)); fillRows(xmax, (v) => v === 0);
  const smoothRows = (a, it) => { for (let k = 0; k < it; k++) { const b = a.slice(); for (let r = 1; r < a.length - 1; r++) a[r] = (b[r - 1] + 2 * b[r] + b[r + 1]) / 4; } return a; };
  S.zc = smoothRows(Float32Array.from(zmin, (v, r) => (v + zmax[r]) / 2), 3);
  S.halfW = smoothRows(xmax, 2);
  S.rowOf = (y) => clamp((y - S.rowY0) / S.rowDy, 0, S.rows - 1.001);
  S.rowVal = (a, y) => { const f = S.rowOf(y), r = Math.floor(f), t = f - r; return a[r] * (1 - t) + a[Math.min(r + 1, a.length - 1)] * t; };

  // per vertex: torso azimuth, neck azimuth, head azimuth, arm and leg parameters
  S.theta = new Float32Array(m); S.thetaN = new Float32Array(m);
  S.armT = new Float32Array(m).fill(-1); S.legT = new Float32Array(m).fill(-1); S.legPhi = new Float32Array(m);
  S.armLen = len3(sub3(J.elbowL, J.shoulderL)) + len3(sub3(J.wristL, J.elbowL));
  S.legLen = len3(sub3(J.kneeL, J.hipL)) + len3(sub3(J.ankleL, J.kneeL));
  S.neckZ = (S.rowVal(zmin, J.neck[1]) + S.rowVal(zmax, J.neck[1])) / 2;
  for (let c = 0; c < m; c++) {
    const p = [rest[c * 3], rest[c * 3 + 1], rest[c * 3 + 2]];
    S.theta[c] = Math.atan2(p[0], p[2] - S.rowVal(S.zc, p[1]));
    S.thetaN[c] = Math.atan2(p[0], p[2] - S.neckZ);
    const L = p[0] >= 0;
    if (armW[c] > 0.003 || region[c] === R.UPPERARM || region[c] === R.FOREARM || region[c] === R.HAND) {
      S.armT[c] = chainT(p, L ? J.shoulderL : J.shoulderR, L ? J.elbowL : J.elbowR, L ? J.wristL : J.wristR).t;
    }
    if (legW[c] > 0.003 || region[c] === R.THIGH || region[c] === R.SHIN || region[c] === R.FOOT) {
      const A = L ? J.hipL : J.hipR, B = L ? J.kneeL : J.kneeR, C = L ? J.ankleL : J.ankleR;
      const q = chainT(p, A, B, C);
      S.legT[c] = q.t;
      // angle around the leg (0 = front, +90 = outer side), from the axis point at that height
      const t = clamp(q.t, 0, 1) * S.legLen, l1 = len3(sub3(B, A));
      const ax = t <= l1 ? A.map((v, k) => v + (B[k] - v) * (t / l1)) : B.map((v, k) => v + (C[k] - v) * ((t - l1) / (S.legLen - l1)));
      S.legPhi[c] = Math.atan2((p[0] - ax[0]) * (L ? 1 : -1), p[2] - ax[2]);
    }
  }
  // the leg axis x (rest) by height, to straighten the legs when projecting the bottoms panels
  S.hipX = J.hipL[0]; S.ankleX = J.ankleL[0];
  // the feet (rest): heel and toe along +z, for the shoes' side projection
  S.foot = [J.ankleL, J.ankleR].map((ank, s) => {
    let heel = Infinity, toe = -Infinity, cx = 0, n = 0;
    for (let c = 0; c < m; c++) if (region[c] === R.FOOT && (rest[c * 3] >= 0) === (s === 0)) {
      const z = rest[c * 3 + 2]; if (z < heel) heel = z; if (z > toe) toe = z; cx += rest[c * 3]; n++;
    }
    return { heel, toe, cx: cx / n, side: s === 0 ? 1 : -1 };
  });
  S.restN = vertexNormals(rest, index, new Float32Array(m * 3));
  return S;
}

/* =====================================================================================
   The body: morphs (height, weight via BMI, build), the relaxed pose, exact height
   ===================================================================================== */

const BUILD_SHAPES = {
  slim: { muscle: 0.32, extra: { 'torso-scale-horiz-decr': 0.25, 'measure-shoulder-dist-decr': 0.3 } },
  regular: { muscle: 0.5, extra: {} },
  athletic: { muscle: 0.8, extra: { 'torso-vshape-incr': 0.55, 'measure-shoulder-dist-incr': 0.25, 'measure-upperarm-circ-incr': 0.25 } },
  broad: { muscle: 0.7, extra: { 'torso-scale-horiz-incr': 0.45, 'measure-shoulder-dist-incr': 0.55, 'measure-neck-circ-incr': 0.35, 'measure-upperarm-circ-incr': 0.2 } },
};

function morphWeights(cfg) {
  const h = cfg.heightCm, bmi = cfg.weightKg / (h / 100) ** 2;
  const weight = bmi < 22.5 ? clamp(0.5 - ((22.5 - bmi) / 6) * 0.5, 0, 1) : clamp(0.5 + ((bmi - 22.5) / 11) * 0.5, 0, 1);
  const b = BUILD_SHAPES[cfg.build] || BUILD_SHAPES.regular;
  const height = 0.22 + (0.56 * (h - 160)) / 40;
  const tri = (v) => (v < 0.5 ? [1 - 2 * v, 2 * v, 0] : [0, 2 - 2 * v, 2 * v - 1]);
  const [m0, m1, m2] = tri(b.muscle), [w0, w1, w2] = tri(weight);
  const M = { min: m0, average: m1, max: m2 }, W = { min: w0, average: w1, max: w2 };
  const out = {};
  for (const m of ['min', 'average', 'max']) for (const w of ['min', 'average', 'max']) {
    if (m === 'average' && w === 'average') continue;
    out[`u-${m}muscle-${w}weight`] = M[m] * W[w];
  }
  // the average-muscle weight targets are faint: heavy bodies take some of the soft (low-muscle) one,
  // thin ones some of its lean counterpart, so 120 kg reads heavier than 50 kg at any height
  out['u-minmuscle-maxweight'] = (out['u-minmuscle-maxweight'] || 0) + W.max * 0.45 * (1 - 0.5 * b.muscle);
  out['u-minmuscle-minweight'] = (out['u-minmuscle-minweight'] || 0) + W.min * 0.4;
  // height targets change proportions (and the frame is scaled to the exact height anyway): keep them mild
  out.minheight = 0.6 * Math.max(0, 1 - 2 * height);
  out.maxheight = 0.6 * Math.max(0, 2 * height - 1);
  Object.assign(out, b.extra);
  out['stomach-pregnant-incr'] = clamp((bmi - 27) / 16, 0, 0.45);
  // a heavier man carries it in the belly and waist, not in breasts: the soft targets round the chest,
  // so flatten it back as the weight goes up (the base mesh is already flat-chested)
  out['breast-point-decr'] = W.max * 1.2;
  out['measure-bust-circ-decr'] = W.max * 0.5;
  out['buttocks-volume-decr'] = W.max * 0.5;
  return out;
}

function rotateAround(P, o, pivot, axis, ang) {
  // Rodrigues rotation of point P[o..o+2] about an axis through pivot
  const x = P[o] - pivot[0], y = P[o + 1] - pivot[1], z = P[o + 2] - pivot[2];
  const c = Math.cos(ang), s = Math.sin(ang), [kx, ky, kz] = axis;
  const d = kx * x + ky * y + kz * z;
  const cx = ky * z - kz * y, cy = kz * x - kx * z, cz = kx * y - ky * x;
  P[o] = pivot[0] + x * c + cx * s + kx * d * (1 - c);
  P[o + 1] = pivot[1] + y * c + cy * s + ky * d * (1 - c);
  P[o + 2] = pivot[2] + z * c + cz * s + kz * d * (1 - c);
}

// The hand, still in MakeHuman's rest orientation: the fan of the fingers closes a little and the
// fingers curl towards the palm (more towards the tips), about the knuckle line.
function relaxHand(D, P, W, sgn) {
  const ids = [];
  for (let c = 0; c < D.m; c++) if (D.region[c] === R.HAND && (D.rest[c * 3] >= 0 ? 1 : -1) === sgn) ids.push(c);
  if (ids.length < 10) return;
  let L = 0, tip = W;
  for (const c of ids) { const q = [P[c * 3], P[c * 3 + 1], P[c * 3 + 2]], d = Math.hypot(q[0] - W[0], q[1] - W[1], q[2] - W[2]); if (d > L) { L = d; tip = q; } }
  const h = norm3(sub3(tip, W));
  // the palm's normal: the hand's thinnest direction (covariance), pointing down in the rest pose
  let cx = 0, cy = 0, cz = 0;
  for (const c of ids) { cx += P[c * 3]; cy += P[c * 3 + 1]; cz += P[c * 3 + 2]; }
  cx /= ids.length; cy /= ids.length; cz /= ids.length;
  const C = [0, 0, 0, 0, 0, 0];
  for (const c of ids) { const x = P[c * 3] - cx, y = P[c * 3 + 1] - cy, z = P[c * 3 + 2] - cz; C[0] += x * x; C[1] += y * y; C[2] += z * z; C[3] += x * y; C[4] += x * z; C[5] += y * z; }
  // smallest eigenvector by inverse iteration on the 3x3 covariance (shifted)
  const M = [[C[0], C[3], C[4]], [C[3], C[1], C[5]], [C[4], C[5], C[2]]];
  let n = [0, -1, 0];
  const tr = C[0] + C[1] + C[2];
  for (let it = 0; it < 30; it++) {
    // power iteration on (tr·I − M) finds M's smallest eigenvector
    const v = [tr * n[0] - (M[0][0] * n[0] + M[0][1] * n[1] + M[0][2] * n[2]), tr * n[1] - (M[1][0] * n[0] + M[1][1] * n[1] + M[1][2] * n[2]), tr * n[2] - (M[2][0] * n[0] + M[2][1] * n[1] + M[2][2] * n[2])];
    n = norm3(v);
  }
  // orthogonal to the hand's length, towards the palm (down in the rest pose)
  const hn = dot3(n, h); n = norm3([n[0] - h[0] * hn, n[1] - h[1] * hn, n[2] - h[2] * hn]);
  if (n[1] > 0) n = n.map((v) => -v);
  const lat = norm3(cross3(n, h)), axis = norm3(cross3(h, n));
  const aK = 0.5 * L, K = [W[0] + h[0] * aK, W[1] + h[1] * aK, W[2] + h[2] * aK];
  for (const c of ids) {
    const o = c * 3, along = (P[o] - W[0]) * h[0] + (P[o + 1] - W[1]) * h[1] + (P[o + 2] - W[2]) * h[2];
    if (along <= aK) continue;
    const f = clamp((along - aK) / (L - aK), 0, 1);
    const l = (P[o] - K[0]) * lat[0] + (P[o + 1] - K[1]) * lat[1] + (P[o + 2] - K[2]) * lat[2];
    const k = -0.2 * f * l;
    P[o] += lat[0] * k; P[o + 1] += lat[1] * k; P[o + 2] += lat[2] * k;
    rotateAround(P, o, K, axis, FINGER_CURL * (0.35 + 0.65 * f) * sstep(0, 0.15, f));
  }
}

function shapeBody(D, S, cfg) {
  const F = Float32Array.from(D.full);
  for (const [name, w] of Object.entries(morphWeights(cfg))) {
    const t = D.morphs[name]; if (!t || !w) continue;
    for (let k = 0; k < t.i.length; k++) { const o = t.i[k] * 3, q = k * 3; F[o] += w * t.d[q]; F[o + 1] += w * t.d[q + 1]; F[o + 2] += w * t.d[q + 2]; }
  }
  const J = jointsOf(D, F);
  const m = D.m, P = new Float32Array(m * 3);
  for (let c = 0; c < m; c++) { const i = D.ids[c]; P[c * 3] = F[i * 3]; P[c * 3 + 1] = F[i * 3 + 1]; P[c * 3 + 2] = F[i * 3 + 2]; }
  const jp = (name) => J[name];
  const moveJoint = (name, pivot, axis, ang) => { const a = Float32Array.from(J[name]); rotateAround(a, 0, pivot, axis, ang); J[name] = [a[0], a[1], a[2]]; };
  for (const side of ['L', 'R']) {
    const sgn = side === 'L' ? 1 : -1;
    const Sh = jp('shoulder' + side), E = jp('elbow' + side), W = jp('wrist' + side);
    // 1. straighten the elbow (MakeHuman's forearms point forward) to a light bend
    const u = norm3(sub3(E, Sh)), f = norm3(sub3(W, E));
    const bend = Math.acos(clamp(dot3(u, f), -1, 1)), dAng = bend - ELBOW_BEND;
    const axis = norm3(cross3(f, u));
    if (dAng > 0) {
      for (let c = 0; c < m; c++) {
        if (D.armW[c] <= 0 || (D.rest[c * 3] >= 0 ? 1 : -1) !== sgn) continue;
        const o = c * 3, along = (P[o] - E[0]) * u[0] + (P[o + 1] - E[1]) * u[1] + (P[o + 2] - E[2]) * u[2];
        const w = D.armW[c] * sstep(-0.35, 0.3, along);
        if (w > 0) rotateAround(P, o, E, axis, dAng * w);
      }
      moveJoint('wrist' + side, E, axis, dAng);
    }
    // 1b. relax the hand: fingers a little closer together and softly curled towards the palm
    relaxHand(D, P, J['wrist' + side], sgn);
    // 2. lower the arm in the frontal plane, about the shoulder
    const cur = Math.atan2(Math.abs(E[0] - Sh[0]), -(E[1] - Sh[1]));
    const ang = -sgn * (cur - ARM_DOWN), zAxis = [0, 0, 1];
    for (let c = 0; c < m; c++) {
      if (D.armW[c] <= 0 || (D.rest[c * 3] >= 0 ? 1 : -1) !== sgn) continue;
      rotateAround(P, c * 3, Sh, zAxis, ang * D.armW[c]);
    }
    moveJoint('elbow' + side, Sh, zAxis, ang); moveJoint('wrist' + side, Sh, zAxis, ang);
    // 3. legs a little closer
    const H = jp('hip' + side), la = sgn * -LEG_IN;
    for (let c = 0; c < m; c++) {
      if (D.legW[c] <= 0 || (D.rest[c * 3] >= 0 ? 1 : -1) !== sgn) continue;
      rotateAround(P, c * 3, H, zAxis, la * D.legW[c]);
    }
    for (const j of ['knee', 'ankle', 'toe']) moveJoint(j + side, H, zAxis, la);
  }
  // the upper lids: rotate the skin above each eye a little down about the eyeball's centre
  for (const E of [J.eyeL, J.eyeR]) {
    const R0 = S.eyeRadius, sg = E[0] >= 0 ? 1 : -1;
    for (let c = 0; c < m; c++) {
      if (D.region[c] !== R.HEAD || (P[c * 3] >= 0 ? 1 : -1) !== sg) continue;
      const o = c * 3, dx = P[o] - E[0], dy = P[o + 1] - E[1], dz = P[o + 2] - E[2], d = Math.hypot(dx, dy, dz);
      if (d > 1.8 * R0 || dz <= 0) continue;
      const w = sstep(1.8 * R0, 1.2 * R0, d) * sstep(-0.05 * R0, 0.4 * R0, dy) * sstep(0, 0.4 * R0, dz);
      if (w > 0) rotateAround(P, o, E, [1, 0, 0], LID_DROP * w);
    }
  }
  // stand on the floor, exact height, turn about the middle of the pelvis
  let lo = Infinity, hi = -Infinity;
  for (let c = 0; c < m; c++) {
    const y = P[c * 3 + 1];
    if (D.region[c] === R.FOOT && y < lo) lo = y;
    if (D.region[c] === R.HEAD && y > hi) hi = y;
  }
  const s = cfg.heightCm / 10 / (hi - lo);
  const zAxisPos = (J.pelvis[2] + (J.ankleL[2] + J.ankleR[2]) / 2) / 2;
  for (let c = 0; c < m; c++) { const o = c * 3; P[o] *= s; P[o + 1] = (P[o + 1] - lo) * s; P[o + 2] = (P[o + 2] - zAxisPos) * s; }
  for (const k in J) J[k] = [J[k][0] * s, (J[k][1] - lo) * s, (J[k][2] - zAxisPos) * s];
  const N = vertexNormals(P, D.index, new Float32Array(m * 3));
  const Ns = smoothVectors(Float32Array.from(N), S.adj, 7);
  return { cfg, P, N, Ns, J, s, lo, zAxisPos, height: cfg.heightCm / 10 };
}

/* ---------- envelopes: how the cloth hangs over the torso and the legs ---------- */

// Radius of the convex hull of a ring of points (polar bins around a centre), per bin.
function hullRadii(Rs, nb, out) {
  const pts = [];
  for (let b = 0; b < nb; b++) { const a = -Math.PI + ((b + 0.5) * 2 * Math.PI) / nb; pts.push([Math.sin(a) * Rs[b], Math.cos(a) * Rs[b]]); }
  pts.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const crossZ = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  for (let b = 0; b < nb; b++) {
    const a = -Math.PI + ((b + 0.5) * 2 * Math.PI) / nb, dx = Math.sin(a), dz = Math.cos(a);
    let best = Rs[b];
    for (let i = 0; i < hull.length; i++) {
      const p = hull[i], q = hull[(i + 1) % hull.length];
      const ex = q[0] - p[0], ez = q[1] - p[1];
      const den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) continue;
      const t = (p[0] * ez - p[1] * ex) / den, u = (p[0] * dz - p[1] * dx) / den;
      if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6 && t > best) best = t;
    }
    out[b] = best;
  }
  return out;
}

// round a convex slice's corners: a few circular [1 2 1] passes, never outwards (a flat side stays put)
function filletRadii(Rs, passes) {
  const n = Rs.length, out = Float32Array.from(Rs), tmp = new Float32Array(n);
  for (let k = 0; k < passes; k++) {
    for (let b = 0; b < n; b++) tmp[b] = (out[(b + n - 1) % n] + 2 * out[b] + out[(b + 1) % n]) / 4;
    for (let b = 0; b < n; b++) out[b] = Math.min(Rs[b], tmp[b]);
  }
  return out;
}
function fillBins(Rs, nb) {
  let any = false;
  for (let b = 0; b < nb; b++) if (Rs[b] > 0) { any = true; break; }
  if (!any) return false;
  for (let b = 0; b < nb; b++) if (!(Rs[b] > 0)) {
    let l = 1, r = 1;
    while (!(Rs[(b - l + nb) % nb] > 0)) l++;
    while (!(Rs[(b + r) % nb] > 0)) r++;
    Rs[b] = (Rs[(b - l + nb) % nb] * r + Rs[(b + r) % nb] * l) / (l + r);
  }
  return true;
}

const TB = 48; // torso bins
function torsoEnvelope(D, S, B) {
  const rows = S.rows, P = B.P;
  // row centre: middle of the front-back extent (vertex density is uneven), smoothed over rows
  const zmin = new Float32Array(rows).fill(Infinity), zmax = new Float32Array(rows).fill(-Infinity);
  const ysum = new Float32Array(rows), cnt = new Float32Array(rows);
  const rowOfV = new Int16Array(D.m).fill(-1);
  for (let c = 0; c < D.m; c++) if (S.torsoish[c]) {
    const r = Math.round((D.rest[c * 3 + 1] - S.rowY0) / S.rowDy); if (r < 0 || r >= rows) continue;
    rowOfV[c] = r;
    const z = P[c * 3 + 2];
    for (let k = Math.max(0, r - 1); k <= Math.min(rows - 1, r + 1); k++) { if (z < zmin[k]) zmin[k] = z; if (z > zmax[k]) zmax[k] = z; }
    ysum[r] += P[c * 3 + 1]; cnt[r]++;
  }
  const zc = new Float32Array(rows), yc = new Float32Array(rows);
  for (let r = 0; r < rows; r++) { zc[r] = isFinite(zmin[r]) ? (zmin[r] + zmax[r]) / 2 : NaN; yc[r] = cnt[r] ? ysum[r] / cnt[r] : NaN; }
  for (const a of [zc, yc]) for (let r = 0; r < rows; r++) if (isNaN(a[r])) { let k = 1; while (isNaN(a[r - k] ?? NaN) && isNaN(a[r + k] ?? NaN) && k < rows) k++; a[r] = !isNaN(a[r - k] ?? NaN) ? a[r - k] : a[r + k]; }
  for (let it = 0; it < 3; it++) { const b = zc.slice(); for (let r = 1; r < rows - 1; r++) zc[r] = (b[r - 1] + 2 * b[r] + b[r + 1]) / 4; }
  const raw = new Float32Array(rows * TB);
  for (let c = 0; c < D.m; c++) {
    const r = rowOfV[c]; if (r < 0) continue;
    const b = clamp(Math.floor(((S.theta[c] + Math.PI) / (2 * Math.PI)) * TB), 0, TB - 1);
    for (let k = Math.max(0, r - 1); k <= Math.min(rows - 1, r + 1); k++) {
      const rr = Math.hypot(P[c * 3], P[c * 3 + 2] - zc[k]);
      if (rr > raw[k * TB + b]) raw[k * TB + b] = rr;
    }
  }
  const hull = new Float32Array(rows * TB), tmp = new Float32Array(TB);
  let last = -1;
  for (let r = 0; r < rows; r++) {
    const row = raw.subarray(r * TB, r * TB + TB);
    if (fillBins(row, TB)) { hullRadii(row, TB, tmp); hull.set(tmp, r * TB); last = r; }
    else if (last >= 0) hull.set(hull.subarray(last * TB, last * TB + TB), r * TB);
  }
  for (let r = rows - 1; r >= 0; r--) if (!hull[r * TB]) hull.set(hull.subarray(Math.min(rows - 1, r + 1) * TB, Math.min(rows - 1, r + 1) * TB + TB), r * TB);
  return { zc, yc, hull, raw };
}

// Which way each body point pushes the cloth out: horizontal from the torso's axis below the
// shoulders, perpendicular to the leg's axis on the legs, the smoothed normal elsewhere.
function clothDirections(D, S, B, env) {
  const { m, rest, armW, legW } = D, { Ns, P } = B, out = new Float32Array(m * 3);
  for (let c = 0; c < m; c++) {
    const o = c * 3, y = rest[o + 1];
    const as = sstep(0.12, 0.5, armW[c]), ls = sstep(0.25, 0.6, legW[c]);
    let x = Ns[o], yy = Ns[o + 1], z = Ns[o + 2];
    if (as < 1) {
      // torso
      const zc = S.rowVal(env.torso.zc, y), rx = P[o], rz = P[o + 2] - zc, rl = Math.hypot(rx, rz) || 1;
      // (not under the crotch: the cloth there follows the body, it doesn't fold over sideways)
      const kT = 0.85 * sstep(6.1, 5.2, y) * (1 - ls) * (1 - sstep(0.2, 0.6, -Ns[o + 1]));
      let tx = mix(Ns[o], rx / rl, kT), ty = mix(Ns[o + 1], 0, kT), tz = mix(Ns[o + 2], rz / rl, kT);
      // legs
      if (ls > 0 && S.legT[c] >= -0.1 && S.legT[c] < 0.98) {
        const L = env.legs[rest[o] >= 0 ? 0 : 1], ax = L.axisAt(S.legT[c]);
        const lx = P[o] - ax[0], lz = P[o + 2] - ax[2], ll = Math.hypot(lx, lz) || 1;
        const kL = 0.85 * sstep(0.1, 0.45, ls);
        tx = mix(tx, lx / ll, kL); ty = mix(ty, 0, kL); tz = mix(tz, lz / ll, kL);
      }
      x = mix(tx, Ns[o], as); yy = mix(ty, Ns[o + 1], as); z = mix(tz, Ns[o + 2], as);
    }
    const l = Math.hypot(x, yy, z) || 1;
    out[o] = x / l; out[o + 1] = yy / l; out[o + 2] = z / l;
  }
  return smoothVectors(out, S.adj, 2);
}

const LB = 32, LROWS = 48, LT0 = -0.08, LT1 = 1.12; // leg bins and rows over legT
function legEnvelopes(D, S, B) {
  const out = [];
  for (const side of ['L', 'R']) {
    const sg = side === 'L' ? 1 : -1;
    const A = B.J['hip' + side], Bk = B.J['knee' + side], C = B.J['ankle' + side];
    const raw = new Float32Array(LROWS * LB);
    const axisAt = (t) => { const l1 = len3(sub3(Bk, A)), L = l1 + len3(sub3(C, Bk)), d = clamp(t, 0, 1.2) * L; return d <= l1 ? A.map((v, k) => v + (Bk[k] - v) * (d / l1)) : Bk.map((v, k) => v + (C[k] - v) * ((d - l1) / (L - l1))); };
    for (let c = 0; c < D.m; c++) {
      if (S.legT[c] < LT0 || S.legT[c] > 0.97 || (D.rest[c * 3] >= 0 ? 1 : -1) !== sg || D.legW[c] < 0.7 || D.region[c] === R.FOOT) continue;
      const row = Math.round(((S.legT[c] - LT0) / (LT1 - LT0)) * (LROWS - 1));
      const ax = axisAt(S.legT[c]);
      const rr = Math.hypot(B.P[c * 3] - ax[0], B.P[c * 3 + 2] - ax[2]);
      const b = clamp(Math.floor(((S.legPhi[c] + Math.PI) / (2 * Math.PI)) * LB), 0, LB - 1);
      if (rr > raw[row * LB + b]) raw[row * LB + b] = rr;
    }
    const hull = new Float32Array(LROWS * LB), tmp = new Float32Array(LB);
    let last = -1;
    for (let r = 0; r < LROWS; r++) {
      const row = raw.subarray(r * LB, r * LB + LB);
      if (fillBins(row, LB)) { hullRadii(row, LB, tmp); hull.set(tmp, r * LB); last = r; }
      else if (last >= 0) hull.set(hull.subarray(last * LB, last * LB + LB), r * LB);
    }
    for (let r = LROWS - 1; r >= 0; r--) if (!hull[r * LB]) { const k = r + 1 < LROWS && hull[(r + 1) * LB] ? r + 1 : Math.max(0, r - 1); hull.set(hull.subarray(k * LB, k * LB + LB), r * LB); }
    out.push({ side: sg, axisAt, hull });
  }
  return out;
}

// Rows hang from the widest part above them: radius may shrink by at most `taper` per unit length.
function hangDown(grid, nb, rows, fromRow, toRow, step, taper) {
  const out = Float32Array.from(grid);
  const dir = toRow > fromRow ? 1 : -1;
  for (let r = fromRow + dir; dir > 0 ? r <= toRow : r >= toRow; r += dir) {
    for (let b = 0; b < nb; b++) {
      const above = out[(r - dir) * nb + b] - taper * step;
      if (above > out[r * nb + b]) out[r * nb + b] = above;
    }
  }
  return out;
}

const sampleGrid = (grid, nb, rows, rowF, ang) => {
  const r0 = clamp(Math.floor(rowF), 0, rows - 1), r1 = Math.min(r0 + 1, rows - 1), tr = clamp(rowF - r0, 0, 1);
  const bf = ((ang + Math.PI) / (2 * Math.PI)) * nb - 0.5;
  const b0 = ((Math.floor(bf) % nb) + nb) % nb, b1 = (b0 + 1) % nb, tb = bf - Math.floor(bf);
  const g = (r, b) => grid[r * nb + b];
  return mix(mix(g(r0, b0), g(r0, b1), tb), mix(g(r1, b0), g(r1, b1), tb), tr);
};

/* =====================================================================================
   Patches: a part of the body surface clipped along scalar fields (clean hems), split into
   material groups along other fields, and subdivided once. Every vertex is a weighted mix of
   body vertices, so the patch follows the body as it changes.
   ===================================================================================== */

function buildPatch(m, index, fields, coverIds, splitIds, groupOf, subdivide = true) {
  const nf = fields.length;
  const recs = [], keyMap = new Map(), baseRec = new Int32Array(m).fill(-1);
  const base = (i) => {
    if (baseRec[i] < 0) {
      const f = new Float32Array(nf);
      for (let k = 0; k < nf; k++) { const v = fields[k][i]; f[k] = v === 0 ? 1e-6 : v; }
      baseRec[i] = recs.length; recs.push({ w: [i, 1], f });
    }
    return baseRec[i];
  };
  const between = (a, b, t, tag) => {
    const key = a < b ? `${a},${b},${tag}` : `${b},${a},${tag}`;
    const got = keyMap.get(key); if (got !== undefined) return got;
    if (a > b) { [a, b] = [b, a]; t = 1 - t; }
    const A = recs[a], Bq = recs[b], w = new Map();
    for (let k = 0; k < A.w.length; k += 2) w.set(A.w[k], (w.get(A.w[k]) || 0) + A.w[k + 1] * (1 - t));
    for (let k = 0; k < Bq.w.length; k += 2) w.set(Bq.w[k], (w.get(Bq.w[k]) || 0) + Bq.w[k + 1] * t);
    const f = new Float32Array(nf);
    for (let k = 0; k < nf; k++) { const v = A.f[k] * (1 - t) + Bq.f[k] * t; f[k] = typeof tag === 'number' && k === tag ? 0 : v === 0 ? 1e-6 : v; }
    const flat = []; for (const [i, wt] of w) if (wt > 1e-5) flat.push(i, wt);
    const id = recs.length; recs.push({ w: flat, f }); keyMap.set(key, id); return id;
  };
  const clip = (poly, k, keepNeg) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      const fa = recs[a].f[k], fb = recs[b].f[k];
      const ia = keepNeg ? fa <= 0 : fa > 0, ib = keepNeg ? fb <= 0 : fb > 0;
      if (ia) out.push(a);
      if (ia !== ib && fa !== 0 && fb !== 0) out.push(between(a, b, fa / (fa - fb), k));
    }
    // drop repeats (a vertex sitting exactly on the line)
    return out.filter((v, i) => v !== out[(i + 1) % out.length]);
  };
  const tris = [], groups = [];
  for (let t = 0; t < index.length; t += 3) {
    const a = index[t], b = index[t + 1], c = index[t + 2];
    let out = false;
    for (const k of coverIds) if (fields[k][a] > 0 && fields[k][b] > 0 && fields[k][c] > 0) { out = true; break; }
    if (out) continue;
    let poly = [base(a), base(b), base(c)];
    for (const k of coverIds) {
      if (poly.every((v) => recs[v].f[k] <= 0)) continue;
      poly = clip(poly, k, true);
      if (poly.length < 3) break;
    }
    if (poly.length < 3) continue;
    let polys = [poly];
    for (const k of splitIds) {
      const next = [];
      for (const p of polys) {
        const neg = p.some((v) => recs[v].f[k] <= 0), pos = p.some((v) => recs[v].f[k] > 0);
        if (!(neg && pos)) { next.push(p); continue; }
        const p1 = clip(p, k, true), p2 = clip(p, k, false);
        if (p1.length >= 3) next.push(p1);
        if (p2.length >= 3) next.push(p2);
      }
      polys = next;
    }
    for (const p of polys) {
      const avg = new Float32Array(nf);
      for (const v of p) for (let k = 0; k < nf; k++) avg[k] += recs[v].f[k] / p.length;
      const g = groupOf(avg);
      if (g < 0) continue;
      for (let i = 1; i + 1 < p.length; i++) { tris.push(p[0], p[i], p[i + 1]); groups.push(g); }
    }
  }
  let T = tris, G = groups;
  if (subdivide) {
    T = []; G = [];
    for (let t = 0; t < tris.length; t += 3) {
      const a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const ab = between(a, b, 0.5, 'm'), bc = between(b, c, 0.5, 'm'), ca = between(c, a, 0.5, 'm');
      T.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
      const g = groups[t / 3]; G.push(g, g, g, g);
    }
  }
  // weld: keep the used records
  const remap = new Int32Array(recs.length).fill(-1), used = [];
  for (const v of T) if (remap[v] < 0) { remap[v] = used.length; used.push(v); }
  const nv = used.length, wOff = new Uint32Array(nv + 1), wIdx = [], wVal = [], vf = new Float32Array(nv * nf);
  used.forEach((r, i) => {
    const rec = recs[r];
    let s = 0; for (let k = 1; k < rec.w.length; k += 2) s += rec.w[k];
    for (let k = 0; k < rec.w.length; k += 2) { wIdx.push(rec.w[k]); wVal.push(rec.w[k + 1] / s); }
    wOff[i + 1] = wIdx.length;
    vf.set(rec.f, i * nf);
  });
  const triW = Uint32Array.from(T, (v) => remap[v]);
  return { nv, nt: triW.length / 3, wOff, wIdx: Uint32Array.from(wIdx), wVal: Float32Array.from(wVal), tris: triW, groups: Uint8Array.from(G), vf, nf };
}

// Interpolate a per-body-vertex array (k components) onto the patch's vertices.
function interp(patch, src, k, out = new Float32Array(patch.nv * k)) {
  const { wOff, wIdx, wVal } = patch;
  for (let v = 0; v < patch.nv; v++) {
    for (let c = 0; c < k; c++) out[v * k + c] = 0;
    for (let j = wOff[v]; j < wOff[v + 1]; j++) { const i = wIdx[j], w = wVal[j]; for (let c = 0; c < k; c++) out[v * k + c] += src[i * k + c] * w; }
  }
  return out;
}

// Boundary edges (one triangle) of a welded triangle list, with the triangle's third vertex.
function boundaryEdges(tris, groups) {
  const seen = new Map();
  for (let t = 0; t < tris.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = tris[t + e], b = tris[t + ((e + 1) % 3)], c = tris[t + ((e + 2) % 3)];
    const key = a < b ? a * 4194304 + b : b * 4194304 + a;
    const got = seen.get(key);
    if (got) got.n++; else seen.set(key, { a, b, c, g: groups[t / 3], n: 1 });
  }
  const out = [];
  for (const e of seen.values()) if (e.n === 1) out.push(e);
  return out;
}

/* =====================================================================================
   Garment specs. Heights are on the rest mesh (decimetres; the crotch is near 0.1, the neck
   base near 6.6); sleeve ends are along the arm (0 shoulder, 1 wrist); hems of bottoms along
   the leg (0 hip, 1 ankle).
   ===================================================================================== */

const SPECS = {
  tee: { slot: 'top', sleeve: 0.3, hem: 0.45, neck: 'crew', taper: 0.25, loose: 0.04, flare: 0.1, thick: 0.035, collar: 'rim' },
  // a tank top: no sleeves, armholes cut deep into the side (armhole: the arm weight it is cut at)
  tank: { slot: 'top', sleeve: 0, hem: 0.45, neck: 'tank', taper: 0.25, loose: 0.03, thick: 0.03, collar: 'rim', armhole: 0.1 },
  longsleeve: { slot: 'top', sleeve: 0.97, hem: 0.45, neck: 'crew', taper: 0.25, loose: 0.035, sleeveLoose: 0.035, thick: 0.03, collar: 'rim' },
  sweater: { slot: 'layer', sleeve: 0.985, hem: 0.62, neck: 'crew', taper: 0.2, loose: 0.06, sleeveLoose: 0.07, thick: 0.05, rib: 0.55, cuff: 0.11, collar: 'rib' },
  // fit-style knobs (all lengths in decimetres before the body's scale):
  //   loft: how far the cloth stands off whatever is under it, below the chest (a jacket's volume);
  //   loftTop: [rest y where it starts, rest y where it is full] (never on the tops of the shoulders);
  //   blouse: the extra bag just above a rib/elastic hem; ribPull: how tightly the hem band pulls the
  //   cloth back in (0-1); rolls / cuffRolls: soft horizontal folds above the hem / the cuffs;
  //   sleeveTap: the sleeve's ease kept at [the deltoid, the wrist]; sleeveRamp: the share of it already
  //   at the shoulder seam (the rest comes in by the biceps); baffle: quilting
  hoodie: { slot: 'layer', sleeve: 0.985, hem: 0.58, neck: 'hood', taper: 0.18, loose: 0.08, sleeveLoose: 0.09, thick: 0.04, rib: 0.6, cuff: 0.11, hood: true, loft: 0.15, loftTop: [5.4, 4.6], blouse: 0.05, ribPull: 0.75 },
  trackjacket: { slot: 'layer', sleeve: 0.985, hem: 0.62, neck: 'crew', taper: 0.2, loose: 0.05, sleeveLoose: 0.06, thick: 0.035, rib: 0.35, cuff: 0.08, collar: 'stand', ribPull: 0.6 },
  // MA-1 blouson: a short body that billows just above a tight rib waistband (at the belt line), a
  // flat chest, a zip front whose edges hang straight down (zip: the gap between them), rib cuffs
  bomber: { slot: 'jacket', sleeve: 0.955, hem: 1.8, neck: 'jacket', open: 0.24, zip: 0.7, taper: 0.2, loose: 0.06, sleeveLoose: 0.14, sleeveTap: [0.85, 0.8], sleeveRamp: 0.6, thick: 0.035, rib: 0.55, cuff: 0.1, collar: 'stand', loft: 0.2, loftTop: [4.9, 4.3], blouse: 0.16, ribPull: 0.85, rolls: 0.045, cuffRolls: 0.03 },
  // a quilted down jacket: inflated, horizontal baffles every ~10 cm, a high stand collar, elastic hem and cuffs
  puffer: { slot: 'jacket', sleeve: 0.97, hem: 1.05, neck: 'crew', taper: 0.06, loose: 0.08, sleeveLoose: 0.55, sleeveTap: [1, 0.8], sleeveRamp: 0.5, thick: 0.06, cuff: 0.07, collar: 'stand', collarR: 0.12, loft: 0.66, loftTop: [6.2, 5.5], hemPull: 0.3, ribPull: 0.4, baffle: { step: 1.05, amp: 0.12, armStep: 0.85, armAmp: 0.08 } },
  jacket_open: { slot: 'jacket', sleeve: 0.955, hem: 0.3, neck: 'jacket', open: 0.56, taper: 0.12, loose: 0.06, sleeveLoose: 0.08, thick: 0.03, collar: 'fold' },
  jeans: { slot: 'bottoms', waist: 2.02, leg: 1.0, loose: 0.06, taper: 0.12, thick: 0.015 },
  cargo: { slot: 'bottoms', waist: 2.02, leg: 1.0, loose: 0.1, taper: 0.06, thick: 0.015, pockets: true },
  // joggers and track pants: tapered from the knee to an elastic ankle cuff (band: its height; tight:
  // how far it stands off the leg), the cloth gathering just above it
  jogger: { slot: 'bottoms', waist: 2.02, leg: 0.965, loose: 0.07, taper: 0.12, thick: 0.015, jogger: { band: 0.55, tight: 0.05, gather: 0.13 } },
  // leggings: on the skin (skin: the offset), no drape and no folds
  leggings: { slot: 'bottoms', waist: 2.02, leg: 0.975, loose: 0, taper: 0, thick: 0.008, skin: 0.018 },
  // footwear shells: a low sneaker, a high-top (higher collar, a tongue standing up at the front),
  // a boot (a ~15 cm shaft on a chunky lug sole)
  sneakers: { slot: 'shoes', collar: 1.02, sole: 0.3, toe: 0.24, bulk: 0.1, tongue: 0.05 },
  hightop: { slot: 'shoes', collar: 1.22, sole: 0.32, toe: 0.24, bulk: 0.11, tongue: 0.16 },
  boots: { slot: 'shoes', collar: 1.42, sole: 0.42, toe: 0.22, bulk: 0.14, tongue: 0.06, lug: true },
};
// A quilted baffle along u (one baffle per unit): 0 on the stitch lines, 1 in the middle of the puff.
const puffOf = (u) => { const f = u - Math.floor(u), d = 2 * f - 1; return Math.sqrt(Math.max(0, 1 - d * d)); };
const DEFAULT_SUBTYPE = { top: 'tee', layer: 'hoodie', jacket: 'bomber', bottoms: 'jeans', shoes: 'sneakers' };
// How much looser than the spec a fit makes the piece (drape and how slowly it narrows).
const FIT = { slim: 0.5, regular: 1, straight: 1.05, tapered: 0.9, relaxed: 1.2, oversized: 1.5, baggy: 1.7, wide: 1.6, cropped: 1 };
// The fit: a keyword in the item's name first ("Dark blue straight jeans" is straight whatever was
// saved), then the asset's fit, then regular.
const FIT_WORDS = [[/\b(skinny|slim)\b/, 'slim'], [/\b(oversized?|boxy)\b/, 'oversized'], [/\b(baggy|wide)(-leg)?\b/, 'baggy'], [/\b(relaxed|loose)\b/, 'relaxed'], [/\bstraight\b/, 'straight'], [/\b(tapered|joggers?)\b/, 'tapered'], [/\bregular\b/, 'regular']];
// Which shell a shoe gets: the asset's shoeStyle, else its name, then its category.
function shoeShell(asset, name, sub) {
  const style = { low_sneaker: 'sneakers', high_top_sneaker: 'hightop', boot: 'boots' }[asset?.shoeStyle];
  if (style) return style; // the baker's call (it reads the name and the photo)
  const n = `${name || ''} ${asset?.name || ''} ${asset?.category || ''}`.toLowerCase();
  if (/\b(boots?|timberlands?|timbs|chelsea|combat|hiking)\b/.test(n) || sub === 'boots') return 'boots';
  if (/\b(jordan\s*(1|4|i|iv|retro)|air jordan|aj\s*(1|4)|high|hi-?tops?|hi\b|mid\b|dunk high|blazer mid|chuck 70 hi)\b/.test(n)) return 'hightop';
  return 'sneakers';
}
function fitOf(asset, name) {
  const n = String(name || asset?.name || '').toLowerCase();
  for (const [re, f] of FIT_WORDS) if (re.test(n)) return f;
  const f = String(asset?.fit || '').toLowerCase();
  if (f === 'wide') return 'baggy';
  return FIT[f] ? f : 'regular';
}

/* =====================================================================================
   Shaders
   ===================================================================================== */

const GLSL_NOISE = /* glsl */`
float h13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h13(i), h13(i + vec3(1, 0, 0)), f.x), mix(h13(i + vec3(0, 1, 0)), h13(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(h13(i + vec3(0, 0, 1)), h13(i + vec3(1, 0, 1)), f.x), mix(h13(i + vec3(0, 1, 1)), h13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
vec3 bumpN(vec3 n, float h, float scale) {
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
  float dhx = dFdx(h), dhy = dFdy(h);
  vec3 r1 = cross(dpy, n), r2 = cross(n, dpx);
  float det = dot(dpx, r1);
  vec3 g = sign(det) * (dhx * r1 + dhy * r2);
  return normalize(abs(det) * n - scale * g);
}
`;

const COVER_VERT = /* glsl */`
attribute vec3 aRest;
attribute vec4 aCoverA;
attribute float aCoverB;
varying vec3 vRest;
varying vec4 vCoverA;
varying float vCoverB;
`;
const COVER_FRAG = /* glsl */`
uniform vec4 uCoverOn;
uniform float uCoverOnB;
uniform float uCoverMargin;
varying vec3 vRest;
varying vec4 vCoverA;
varying float vCoverB;
`;
const COVER_TEST = /* glsl */`
if (dot(step(vec4(uCoverMargin), vCoverA), uCoverOn) > 0.5 || (vCoverB > uCoverMargin && uCoverOnB > 0.5)) discard;
`;

function hookCommon(shader, uniforms) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\n' + COVER_VERT)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRest = aRest; vCoverA = aCoverA; vCoverB = aCoverB;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + COVER_FRAG + GLSL_NOISE)
    .replace('#include <clipping_planes_fragment>', '#include <clipping_planes_fragment>\n' + COVER_TEST);
}

// The mannequin look: one matte warm grey, the baked AO for a little form; it hides under shoes like
// the skin does (the shells are opaque, so they need no cover).
function mannequinMaterial(U, headY) {
  const mat = new THREE.MeshStandardMaterial({ color: 0x8c867e, roughness: 0.9, metalness: 0, envMapIntensity: 0.6 });
  mat.onBeforeCompile = (shader) => {
    hookCommon(shader, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAO; varying float vAO;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO = aAO;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAO;')
      // (none on the head: the AO was baked for a face it no longer has)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= mix(1.0, vAO, 0.6 * (1.0 - smoothstep(${(headY - 0.3).toFixed(2)}, ${headY.toFixed(2)}, vRest.y)));`);
  };
  mat.customProgramCacheKey = () => 'mannequin';
  return mat;
}

// Skin: wrap lighting with a warm terminator (a cheap stand-in for subsurface scattering), and the
// face painted procedurally from the rest-mesh coordinates: lips, brows, stubble and scalp shadow.
function skinMaterial(U) {
  // physical skin: matte (roughness 0.68) with the faintest clearcoat, no greasy shine
  const mat = new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.68, metalness: 0, clearcoat: 0.05, clearcoatRoughness: 0.55, specularIntensity: 0.6 });
  mat.onBeforeCompile = (shader) => {
    // baked ambient occlusion (tools/build-avatar.py): eye sockets, nostrils, ears, under the jaw
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAO; varying float vAO;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAO = aAO;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying float vAO;
uniform vec3 uSkin, uHair, uLip;
uniform vec4 uEyes[2];    // rest-space eye centres, radius
// the upper lid: a soft shadow in the crease and a dark lash line along the lid's edge
vec2 lidMask(vec3 p) {
  vec4 e = p.x > 0.0 ? uEyes[0] : uEyes[1];
  if (e.x * p.x < 0.0) e = uEyes[0].x * p.x > 0.0 ? uEyes[0] : uEyes[1];
  vec3 d = p - e.xyz; float r = e.w, dist = length(d);
  float front = smoothstep(0.1 * r, 0.5 * r, d.z);
  float above = smoothstep(-0.05 * r, 0.3 * r, d.y);
  float lash = (1.0 - smoothstep(1.03 * r, 1.2 * r, dist)) * above * front;
  float crease = smoothstep(1.0 * r, 1.25 * r, dist) * (1.0 - smoothstep(1.4 * r, 2.0 * r, dist)) * smoothstep(0.1 * r, 0.6 * r, d.y) * front;
  return vec2(lash, crease);
}
uniform vec4 uBeard;      // x stubble darkness, y shadow area (0 none), z moustache, w chin
uniform vec2 uScalp;      // x darkness, y fade height
uniform sampler2D uFace; uniform float uFaceOn; uniform vec3 uFaceMean;
uniform vec4 uFaceBox;    // u0 per x, v0, v per y, -
float lipMask(vec3 p) {
  float up = p.y > 7.315 ? 0.118 : 0.112;
  vec2 q = vec2(p.x / 0.235, (p.y - 7.315 - 0.012 * (1.0 - smoothstep(0.0, 0.08, abs(p.x)))) / up);
  float m = 1.0 - smoothstep(0.78, 1.04, length(q));
  return m * smoothstep(1.38, 1.5, p.z);
}
float browMask(vec3 p) {
  float ax = abs(p.x), t = (ax - 0.075) / 0.5;
  // a man's brows: thick, low and nearly straight (a slight lift, then tapering towards the temple)
  float yc = 8.195 + 0.028 * sin(clamp(t, 0.0, 1.0) * 2.6) - 0.018 * t;
  float th = mix(0.062, 0.034, clamp(t, 0.0, 1.0));
  float m = 1.0 - smoothstep(th * 0.55, th, abs(p.y - yc));
  m *= smoothstep(-0.06, 0.06, t) * (1.0 - smoothstep(0.92, 1.06, t));
  m *= smoothstep(1.12, 1.3, p.z);
  return m * (0.6 + 0.4 * vnoise(vec3(p.x * 140.0, p.y * 30.0, 0.0)));
}
float beardArea(vec3 p) {
  float ax = abs(p.x);
  float up = mix(7.47, 7.86, smoothstep(0.3, 0.74, ax));           // cheek line, up to the sideburns
  float m = smoothstep(up + 0.03, up - 0.06, p.y);
  float low = 7.52 - clamp(p.z - 0.5, 0.0, 0.6) * 1.05;           // under the jaw, down to the throat
  m *= smoothstep(low - 0.08, low + 0.05, p.y);
  m *= smoothstep(0.25, 0.48, p.z);
  m *= 1.0 - smoothstep(0.0, 0.05, ax - 0.82);
  return m;
}
float scalpArea(vec3 p) {
  float th = atan(p.x, p.z - 0.42);
  float c = cos(th);
  float line = mix(7.75, 8.72, smoothstep(-0.2, 0.85, c));          // nape ... forehead
  line = mix(line, 8.08, smoothstep(0.55, 0.9, abs(sin(th))) * smoothstep(-0.3, 0.6, c) * 0.85);
  float m = smoothstep(line - 0.04, line + 0.06, p.y);
  float ear = smoothstep(0.66, 0.74, abs(p.x)) * smoothstep(8.3, 8.2, p.y) * smoothstep(7.5, 7.6, p.y) * smoothstep(0.15, 0.3, p.z) * smoothstep(0.75, 0.62, p.z);
  return m * (1.0 - ear);
}
`)
      .replace('#include <color_fragment>', `#include <color_fragment>
{
  vec3 p = vRest;
  vec3 skin = uSkin;
  float lo = vnoise(p * 2.3) * 0.6 + vnoise(p * 7.0) * 0.4;
  skin *= 0.93 + 0.12 * lo;
  // warmer cheeks, nose, ears; darker knuckles and soles; lighter palms
  float face = smoothstep(7.2, 7.5, p.y) * smoothstep(8.3, 8.0, p.y) * smoothstep(1.0, 1.4, p.z);
  float cheeks = face * smoothstep(0.15, 0.4, abs(p.x)) * (1.0 - smoothstep(0.55, 0.7, abs(p.x)));
  float nose = smoothstep(0.12, 0.0, abs(p.x)) * smoothstep(7.5, 7.62, p.y) * smoothstep(7.85, 7.7, p.y) * smoothstep(1.5, 1.62, p.z);
  float ears = smoothstep(0.68, 0.8, abs(p.x)) * smoothstep(7.5, 7.7, p.y) * smoothstep(8.3, 8.1, p.y);
  skin *= mix(vec3(1.0), vec3(1.07, 0.93, 0.9), clamp(cheeks * 0.7 + nose * 0.8 + ears * 0.6, 0.0, 1.0));
  vec3 lip = uLip * (0.9 + 0.1 * vnoise(p * 40.0));
  float lm = lipMask(p);
  skin = mix(skin, lip, lm);
  // brows and lashes: darker than the hair (towards a deep brown-black)
  vec3 browCol = mix(uHair, vec3(0.0101, 0.0060, 0.0037), 0.6);
  skin = mix(skin, browCol, browMask(p) * 0.88);
  vec2 lid = lidMask(p);
  skin *= 1.0 - 0.28 * lid.y;
  skin = mix(skin, browCol * 0.8, clamp(lid.x, 0.0, 1.0) * 0.9);
  // stubble / shaved shadow
  float grain = vnoise(p * vec3(230.0, 230.0, 230.0));
  float bm = beardArea(p) * (1.0 - lm) * uBeard.y;
  float dots = smoothstep(0.35, 0.75, grain);
  skin = mix(skin, mix(skin, uHair, 0.55) * (0.78 + 0.1 * grain), bm * uBeard.x * (0.55 + 0.45 * dots));
  float sm = scalpArea(p) * uScalp.x;
  skin = mix(skin, mix(skin, uHair, 0.6) * (0.8 + 0.1 * grain), sm * (0.6 + 0.4 * dots));
  if (uFaceOn > 0.5) {
    vec2 fuv = vec2(0.5 + p.x * uFaceBox.x, uFaceBox.y - (8.033 - p.y) * uFaceBox.z);
    float fm = smoothstep(0.62, 0.48, abs(p.x)) * smoothstep(6.9, 7.05, p.y) * smoothstep(8.85, 8.6, p.y) * smoothstep(0.9, 1.25, p.z);
    vec3 photo = texture2D(uFace, fuv).rgb;
    vec3 detail = clamp(photo / max(uFaceMean, vec3(0.02)), 0.0, 2.0);
    skin = mix(skin, skin * detail, fm * uFaceOn * 0.85);
  }
  // occluded skin is darker and a little warmer (light bounced inside the skin)
  float occ = 1.0 - smoothstep(0.0, 1.0, vAO);
  skin *= mix(vec3(1.0), vec3(0.42, 0.34, 0.31), occ);
  diffuseColor.rgb = skin;
}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.5, lipMask(vRest));
roughnessFactor = mix(roughnessFactor, 1.0, 1.0 - vAO); // no shine deep in creases
roughnessFactor *= 0.9 + 0.2 * vnoise(vRest * 60.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef PANEL_EDGE
normal = normalize(mix(nonPerturbedNormal, normal, panelEdge));
#endif
{
  float fade = 1.0 - smoothstep(0.25, 0.9, length(fwidth(vRest * 25.0)));
  float hb = (vnoise(vRest * 25.0) - 0.5) * 0.00012 * fade + (vnoise(vRest * 6.0) - 0.5) * 0.00025;
  normal = bumpN(normal, hb, 1.0);
}`)
      .replace('#include <lights_physical_pars_fragment>', THREE.ShaderChunk.lights_physical_pars_fragment.replace(
        'reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseColor );',
        `{
          vec3 wrapW = vec3(0.42, 0.2, 0.14);
          float ndl = dot(geometryNormal, directLight.direction);
          vec3 wrapped = max(vec3(0.0), (vec3(ndl) + wrapW) / ((1.0 + wrapW) * (1.0 + wrapW)));
          reflectedLight.directDiffuse += wrapped * directLight.color * BRDF_Lambert( material.diffuseColor );
        }`));
    hookCommon(shader, U);
  };
  mat.customProgramCacheKey = () => 'skin-1';
  return mat;
}

// Garment cloth: panels (map + normal + roughness halves), plain fabric (fabric tile in triplanar,
// so sleeves and hoods have no seams), ribbing (procedural ribs). The inside shows a darker lining.
function clothMaterial(kind, opts, U) {
  // cloth is matte: no metal, a high roughness and a weak, clamped specular (a black nylon bomber
  // reads as deep black cloth, not wet grey plastic)
  const mat = new THREE.MeshPhysicalMaterial({
    color: opts.color ?? 0xffffff, map: opts.map || null, normalMap: opts.normalMap || null, roughnessMap: opts.roughnessMap || null,
    roughness: opts.roughness ?? 0.88, metalness: 0, specularIntensity: opts.specular ?? 0.2, envMapIntensity: opts.env ?? 0.55,
    side: THREE.DoubleSide, alphaHash: true, transparent: false,
  });
  // (black cloth: softer creases, and less of the little specular there is)
  if (opts.normalMap) mat.normalScale.setScalar(mix(0.8, 0.45, opts.deep ?? 0));
  mat.specularIntensity *= mix(1, 0.6, opts.deep ?? 0);
  mat.defines = {};
  if (kind === 'fabric' && opts.tile) mat.defines.TRIPLANAR = '';
  if (kind === 'trim') mat.defines.RIBS = '';
  if (kind === 'panel' && opts.map && opts.edge) mat.defines.PANEL_EDGE = '';
  if (kind === 'panel' && opts.map && opts.tile) mat.defines.PANEL_SIDE = '';
  const u = { ...U, uLining: { value: new THREE.Color(opts.lining ?? 0x222222) }, uTile: { value: opts.tile || null }, uTileScale: { value: opts.tileScale ?? 1.6 }, uGrain: { value: opts.grain ?? 1 }, uDeep: { value: opts.deep ?? 0 }, uFabricCol: { value: new THREE.Color(opts.fabric ?? 0x777777) } };
  mat.userData.uniforms = u;
  mat.onBeforeCompile = (shader) => {
    hookCommon(shader, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aRib; varying vec3 vRib; varying vec3 vRestN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRib = aRib; vRestN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uLining; uniform sampler2D uTile; uniform float uTileScale; uniform float uGrain; uniform float uDeep; uniform vec3 uFabricCol; varying vec3 vRib; varying vec3 vRestN;')
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef TRIPLANAR
{
  vec3 q = vRest * uTileScale;
  vec3 bw = pow(abs(normalize(vRestN)), vec3(4.0)); bw /= dot(bw, vec3(1.0));
  vec3 t = texture2D(uTile, q.zy).rgb * bw.x + texture2D(uTile, q.xz).rgb * bw.y + texture2D(uTile, q.xy).rgb * bw.z;
  diffuseColor.rgb *= t;
}
#endif
#ifdef PANEL_EDGE
// the photo's edges (the sleeves laid beside the body, the collar above) fade into the plain cloth
float panelEdge = smoothstep(0.0, 0.14, min(vMapUv.x, 1.0 - vMapUv.x)) * smoothstep(1.0, 0.93, vMapUv.y);
diffuseColor.rgb = mix(uFabricCol, diffuseColor.rgb, panelEdge);
#endif
#ifdef PANEL_SIDE
// a photo is taken from the front (back): where the cloth turns sideways its projection smears into
// streaks, so the sides take the plain fabric (the grain tile, triplanar) and the photo fades out
float panelSide;
{
  vec3 n0 = normalize(vRestN);
  panelSide = smoothstep(0.3, 0.62, abs(n0.z));
  vec3 q = vRest * uTileScale;
  vec3 bw = pow(abs(n0), vec3(4.0)); bw /= dot(bw, vec3(1.0));
  vec3 t = texture2D(uTile, q.zy).rgb * bw.x + texture2D(uTile, q.xz).rgb * bw.y + texture2D(uTile, q.xy).rgb * bw.z;
  diffuseColor.rgb = mix(t, diffuseColor.rgb, panelSide);
}
#endif
// black cloth: a photo of it is lit grey; pull its albedo down to a deep charcoal, keeping its texture
if (uDeep > 0.0) { // (its photo highlights softened too; a bright print on it is left alone)
  float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
  diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 0.66 / (1.0 + 2.5 * diffuseColor.rgb), uDeep * (1.0 - smoothstep(0.2, 0.45, lum)));
}
if (!gl_FrontFacing) diffuseColor.rgb = uLining;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
#ifdef PANEL_EDGE
normal = normalize(mix(nonPerturbedNormal, normal, panelEdge));
#endif
#ifdef PANEL_SIDE
normal = normalize(mix(nonPerturbedNormal, normal, panelSide));
#endif
{
  float hb = 0.0;
#ifdef RIBS
  float ang = atan(vRib.y, vRib.x) * vRib.z;
  float fw = fwidth(ang);
  hb += (0.5 + 0.5 * cos(ang)) * 0.0011 * (1.0 - smoothstep(0.6, 1.6, fw));
#endif
  float fade = 1.0 - smoothstep(0.3, 1.0, length(fwidth(vRest * 18.0)));
  hb += (vnoise(vRest * 18.0) - 0.5) * 0.0007 * fade * uGrain + (vnoise(vRest * 3.0) - 0.5) * 0.0025 * uGrain;
  normal = bumpN(normal, hb, 1.0);
}`);
  };
  mat.customProgramCacheKey = () => 'cloth-4' + (opts.map && opts.edge && kind === 'panel' ? 'e' : '') + (opts.map && opts.tile && kind === 'panel' ? 's' : '');
  return mat;
}

/* =====================================================================================
   Garments
   ===================================================================================== */

// The fields a garment's patch is clipped and split along, on the body's vertices. Values are
// roughly distances in decimetres, negative inside.
function garmentFields(D, S, spec, sub, length) {
  const { m, rest, armW, legW } = D;
  const f = (fn) => { const a = new Float32Array(m); for (let c = 0; c < m; c++) a[c] = fn(c, rest[c * 3], rest[c * 3 + 1], rest[c * 3 + 2]); return a; };
  const armS = (c) => sstep(0.32, 0.62, armW[c]);
  const legS = (c) => sstep(0.3, 0.7, legW[c]);
  const F = {};
  if (spec.slot === 'shoes') {
    const floor = S.floorY;
    F.cover = f((c, x, y, z) => {
      if (S.legT[c] < 0.55) return 1;
      const phi = S.legPhi[c], cf = Math.max(0, Math.cos(phi)), H = spec.collar * (0.86 + 0.14 * Math.cos(phi) ** 2) + 0.08 * cf + (spec.tongue ?? 0) * cf ** 6;
      return Math.max(y - (floor + H), floor + 0.12 - y);
    });
    F.side = f((c, x, y, z) => { const ft = S.foot[x >= 0 ? 0 : 1]; return (x - ft.cx) * ft.side; }); // + lateral, - medial
    return F;
  }
  if (spec.slot === 'bottoms') {
    const legEnd = length === 'short' ? 0.5 : spec.leg;
    F.waist = f((c, x, y, z) => (legS(c) > 0.99 ? -1 : y - (spec.waist + 0.1 * sstep(0.2, -0.6, z - S.rowVal(S.zc, y)))));
    F.legHem = f((c) => { const s = legS(c); return s * (S.legT[c] - legEnd) * S.legLen - (1 - s) * 1; });
    F.arms = f((c) => armW[c] - 0.3);
    F.front = f((c, x, y, z) => { const s = legS(c); return s * Math.cos(S.legPhi[c]) * -1 + (1 - s) * -(z - S.rowVal(S.zc, y)); }); // <0 front
    return F;
  }
  // tops (a top worn under a jacket is cut shorter: see tuckFor)
  const [base, tuck] = String(length || 'full').split('@');
  const hem0 = topHem(spec, sub, base), hemY = tuck ? Math.max(hem0, +tuck) : hem0;
  const neck = spec.neck === 'jacket' ? [6.12, 6.43, 6.6] : spec.neck === 'hood' ? [6.2, 6.5, 6.66] : spec.neck === 'tank' ? [5.95, 6.42, 6.5] : [6.24, 6.52, 6.66];
  const neckY = (c) => { const k = Math.cos(S.thetaN[c]); return k >= 0 ? mix(neck[1], neck[0], k * k) : mix(neck[1], neck[2], k * k); };
  F.hem = f((c, x, y) => { const s = armS(c); return (1 - s) * (hemY - y) - s * 1; });
  F.neck = f((c, x, y) => y - neckY(c));
  F.sleeve = f((c) => { const s = armS(c); return s * (S.armT[c] - spec.sleeve) * S.armLen - (1 - s) * 1; });
  if (spec.open) {
    const g = (y) => openAt(spec, y);
    F.open = f((c, x, y, z) => Math.min(g(y) - Math.abs(x), (z - S.rowVal(S.zc, y)) * 2 - 0.05) - (armS(c) > 0.5 ? 2 : 0));
  }
  if (spec.armhole) F.armhole = f((c) => armW[c] - spec.armhole); // a tank top: cut where the arm begins
  F.arm = f((c) => armW[c] - 0.5);
  F.front = f((c, x, y, z) => -(z - S.rowVal(S.zc, y)));
  if (spec.rib) F.rib = f((c, x, y) => (armS(c) > 0.5 ? 1 : y - (hemY + spec.rib)));
  if (spec.cuff) F.cuff = f((c) => (armS(c) < 0.5 ? 1 : (spec.sleeve - spec.cuff - S.armT[c]) * S.armLen));
  F._hemY = hemY; F._hem0 = hem0;
  return F;
}
// half the width of an open front at rest height y: lapels open into a V by the collar; a zip front
// is straight
const openAt = (spec, y) => (spec.zip ? spec.open : spec.open + 0.22 * sstep(5.5, 6.4, y) - 0.05 * sstep(4.5, 2.5, y));
// the hem of a top on the rest mesh, by its length
const topHem = (spec, sub, length) => (length === 'cropped' ? 1.95 : length === 'long' && (sub === 'jacket_open' || sub === 'puffer') ? 0.18 : spec.hem);

const G_FRONT = 0, G_BACK = 1, G_FABRIC = 2, G_TRIM = 3;

// Build (once per sub type and length) the patch of a garment.
function garmentTopology(D, S, sub, length) {
  const spec = SPECS[sub];
  const F = garmentFields(D, S, spec, sub, length);
  const names = Object.keys(F).filter((k) => !k.startsWith('_'));
  const fields = names.map((k) => F[k]);
  const id = (k) => names.indexOf(k);
  let cover, split, groupOf;
  if (spec.slot === 'shoes') {
    cover = [id('cover')]; split = [id('side')];
    groupOf = (a) => (a[id('side')] > 0 ? G_FRONT : G_BACK);
  } else if (spec.slot === 'bottoms') {
    cover = [id('waist'), id('legHem'), id('arms')]; split = [id('front')];
    groupOf = (a) => (a[id('front')] <= 0 ? G_FRONT : G_BACK);
  } else {
    cover = [id('hem'), id('neck'), id('sleeve')].concat(spec.open ? [id('open')] : [], spec.armhole ? [id('armhole')] : []);
    split = [id('arm'), id('front')].concat(spec.rib ? [id('rib')] : [], spec.cuff ? [id('cuff')] : []);
    groupOf = (a) => {
      if (a[id('arm')] > 0) return spec.cuff && a[id('cuff')] <= 0 ? G_TRIM : G_FABRIC;
      if (spec.rib && a[id('rib')] <= 0) return G_TRIM;
      return a[id('front')] <= 0 ? G_FRONT : G_BACK;
    };
  }
  const patch = buildPatch(D.m, D.index, fields, cover, split, groupOf, spec.slot !== 'shoes');
  patch.names = names; patch.spec = spec; patch.sub = sub; patch.length = length; patch.hemY = F._hemY; patch.hem0 = F._hem0 ?? F._hemY;
  // the body vertices the garment touches, and a ring around them (for smoothing the height field)
  const touched = new Uint8Array(D.m);
  for (let k = 0; k < patch.wIdx.length; k++) touched[patch.wIdx[k]] = 1;
  const ring = Uint8Array.from(touched);
  const { off, nb } = S.adj;
  for (let v = 0; v < D.m; v++) if (touched[v]) for (let k = off[v]; k < off[v + 1]; k++) ring[nb[k]] = 1;
  patch.region = [];
  for (let v = 0; v < D.m; v++) if (ring[v]) patch.region.push(v);
  patch.region = Uint32Array.from(patch.region);
  patch.inRegion = ring;
  // the cover field (inside distance) on body vertices: how deep inside the garment each point is
  patch.coverDepth = new Float32Array(D.m);
  for (let c = 0; c < D.m; c++) { let mx = -Infinity; for (const k of cover) mx = Math.max(mx, fields[k][c]); patch.coverDepth[c] = -mx; }
  // per-vertex rest data
  patch.restP = interp(patch, D.rest, 3);
  patch.restN = interp(patch, S.restN, 3); normalize3(patch.restN);
  patch.armW = interp(patch, D.armW, 1); patch.legW = interp(patch, D.legW, 1);
  patch.armT = interp(patch, S.armT, 1); patch.legT = interp(patch, S.legT, 1);
  patch.bound = boundaryEdges(patch.tris, patch.groups);
  patch.adj = adjacency(patch.nv, patch.tris);
  return patch;
}

/* ---------- height field: how far the cloth stands off the body ---------- */

function baseHeights(D, S, B, env, patch, asset, fitKey) {
  const spec = patch.spec, sub = patch.sub, fit = FIT[fitKey || asset.fit] ?? 1;
  const off = (SLOT_OFFSET_MM[spec.slot] ?? 8) * MM;
  const h = new Float32Array(D.m), hmin = new Float32Array(D.m);
  const { P } = B, Ns = B.Dir;
  const reg = patch.region;
  if (spec.slot === 'shoes') {
    for (const v of reg) {
      const z = D.rest[v * 3 + 2], ft = S.foot[D.rest[v * 3] >= 0 ? 0 : 1];
      const along = (z - ft.heel) / (ft.toe - ft.heel);
      const toe = sstep(0.62, 1.0, along), heel = sstep(0.2, 0.0, along);
      const fwd = Math.max(0, Ns[v * 3 + 2]), up = Math.max(0, Ns[v * 3 + 1]);
      hmin[v] = off + spec.bulk * B.s + (toe * (spec.toe * fwd + 0.08 * up) + heel * 0.05) * B.s;
    }
  } else if (spec.slot === 'bottoms') {
    const torso = env.torso, taperT = spec.taper / fit;
    const startRow = Math.round(S.rowOf(spec.waist - 0.2));
    const hang = hangDown(torso.hull, TB, S.rows, startRow, 0, S.rowDy * B.s, 0.5 / fit);
    const legs = env.legs.map((L) => ({ ...L, hang: hangDown(L.hull, LB, LROWS, Math.round(((0.16 - LT0) / (LT1 - LT0)) * (LROWS - 1)), LROWS - 1, ((LT1 - LT0) / (LROWS - 1)) * S.legLen * B.s, taperT * 4) }));
    const extra = spec.loose * fit * B.s;
    for (const v of reg) {
      if (spec.skin) { hmin[v] = spec.skin * B.s; continue; } // leggings: on the skin, no drape
      const o = v * 3, ls = sstep(0.25, 0.65, D.legW[v]);
      let hd = 0;
      // pelvis: follow the hips' hull
      const above = sstep(S.crotchY + 0.3, S.crotchY + 0.9, D.rest[o + 1]) * sstep(0.45, 0.2, D.legW[v]);
      if (ls < 1 && above > 0) {
        const rowF = S.rowOf(D.rest[o + 1]), zc = S.rowVal(torso.zc, D.rest[o + 1]) ;
        const rT = sampleGrid(hang, TB, S.rows, rowF, S.theta[v]) + extra * 0.6;
        const dx = P[o], dz = P[o + 2] - zc, r = Math.hypot(dx, dz) || 1;
        const cs = (Ns[o] * dx + Ns[o + 2] * dz) / r;
        // only where the body faces sideways (the crotch's underside faces down: no drape there)
        if (cs > 0.25) hd += (1 - ls) * above * Math.max(0, (rT - r) / cs) * sstep(0.6, 0.3, Math.abs(Ns[o + 1]));
      }
      if (ls > 0) {
        const L = legs[D.rest[o] >= 0 ? 0 : 1];
        const t = S.legT[v], rowF = ((t - LT0) / (LT1 - LT0)) * (LROWS - 1);
        const ax = L.axisAt(t);
        const rT = sampleGrid(L.hang, LB, LROWS, rowF, S.legPhi[v]) + extra * (0.7 + 0.6 * sstep(0.2, 0.9, t));
        const dx = P[o] - ax[0], dz = P[o + 2] - ax[2], r = Math.hypot(dx, dz) || 1;
        const cs = (Ns[o] * dx + Ns[o + 2] * dz) / r;
        // the cloth hangs on the outer, front and back sides; between the legs it stays close
        const inner = Math.max(0, -Math.sin(S.legPhi[v]));
        const crotch = sstep(0.05, 0.3, t);
        if (cs > 0.2) hd += ls * Math.max(0, (rT - r) / Math.max(cs, 0.35)) * (1 - inner) ** 2 * mix(0.25, 1, crotch) * sstep(0.7, 0.35, Math.abs(Ns[o + 1]));
        if (spec.pockets) { const ph = Math.sin(S.legPhi[v]); hd += 0.09 * B.s * sstep(0.55, 0.85, ph) * sstep(0.18, 0.3, t) * sstep(0.55, 0.42, t); }
      }
      hmin[v] = off + hd;
    }
  } else {
    // tops: the torso hangs from the chest (and the shoulder blades) down, bridging hollows
    const torso = env.torso, taper = spec.taper / fit;
    const loftK = fitKey === 'slim' ? 0.8 : fitKey === 'oversized' ? 1.2 : fitKey === 'relaxed' ? 1.1 : 1;
    const armpitRow = Math.round(S.rowOf(4.65));
    const hang = hangDown(torso.hull, TB, S.rows, armpitRow, 0, S.rowDy * B.s, taper);
    const extra = spec.loose * fit * B.s;
    const hemY = patch.hemY;
    for (const v of reg) {
      const o = v * 3, y = D.rest[o + 1];
      const as = sstep(0.22, 0.55, D.armW[v]);
      let hd = 0;
      if (as < 1) {
        const rowF = S.rowOf(y), zc = sampleRow(torso.zc, rowF);
        const rT = sampleGrid(hang, TB, S.rows, rowF, S.theta[v]) + extra * sstep(5.8, 4.6, y);
        const dx = P[o], dz = P[o + 2] - zc, r = Math.hypot(dx, dz) || 1;
        const cs = (Ns[o] * dx + Ns[o + 2] * dz) / r;
        if (cs > 0.2) hd = Math.max(0, (rT - r) / Math.max(cs, 0.4)) * (1 - as) * sstep(5.7, 4.9, y) * sstep(0.7, 0.35, -Ns[o + 1]);
        // a ribbed hem gathers the cloth back in (the blouse above it)
        if (spec.rib) hd *= mix(0.25, 1, sstep(hemY + 0.05, hemY + spec.rib * 0.9, y));
        hd += extra * 0.25 * (1 - as);
        // the jacket's volume over the upper chest and back (the drape below takes over under the
        // arms); not where the body faces up, so the shoulders stay unpadded
        if (spec.loft) hd += spec.loft * loftK * B.s * (1 - as) * sstep(spec.loftTop[0], spec.loftTop[1], y) * (1 - 0.7 * sstep(0.3, 0.75, Ns[o + 1]));
        if (spec.baffle) hd += spec.baffle.amp * B.s * (1 - as) * (puffOf((y - hemY) / spec.baffle.step) - 0.75);
      }
      if (as > 0) {
        const t = S.armT[v];
        // a sleeve tapers from the deltoid to the wrist (no inflated tube)
        const tap = spec.sleeve > 0.6 ? mix(spec.sleeveTap ? spec.sleeveTap[0] : spec.slot === 'jacket' ? 0.8 : 1.0, spec.sleeveTap ? spec.sleeveTap[1] : 0.4, sstep(0.12, 0.85, t)) : 1;
        let sl = (spec.sleeveLoose ?? 0.04) * Math.min(fit, 1.25) * B.s * tap * (spec.sleeveRamp ? mix(spec.sleeveRamp, 1, sstep(0.02, 0.25, t)) : 1);
        // quilted sleeves: a puff between stitch lines, round the arm
        if (spec.baffle) sl += spec.baffle.armAmp * B.s * (puffOf((t * S.armLen) / spec.baffle.armStep + 0.5) - 0.75) * sstep(spec.sleeve - (spec.cuff || 0) - 0.01, spec.sleeve - (spec.cuff || 0) - 0.06, t) * sstep(0.04, 0.12, t);
        if (spec.flare) sl += spec.flare * fit * B.s * sstep(0.05, spec.sleeve, t);
        if (spec.cuff) { const ce = spec.sleeve - spec.cuff; sl = mix(sl, 0.012 * B.s, sstep(ce - 0.02, ce + 0.01, t)); sl += 0.06 * B.s * Math.exp(-(((t - (ce - 0.05)) / 0.04) ** 2)); }
        const inner = Math.max(0, -Ns[o] * (D.rest[o] >= 0 ? 1 : -1));
        hd += as * sl * (1 - 0.55 * inner);
      }
      // the slot's distance shrinks along a long sleeve too; and where the body faces up (the tops of
      // the shoulders) the cloth rests on it, so the shoulder line follows the body's slope, unpadded
      const rest = 1 - 0.55 * sstep(0.3, 0.75, Ns[o + 1]) * sstep(4.4, 5.2, y);
      // (a jacket's sleeve is cut close to the arm: little more than a tee's offset over the deltoid)
      const armF = spec.sleeve > 0.6 ? mix(spec.slot === 'jacket' ? 0.45 : 0.3, 0.45, sstep(0.15, 0.85, S.armT[v])) : 0;
      hmin[v] = off * rest * (1 - as * armF) + hd;
    }
  }
  // the cloth bridges small hollows: lift towards the neighbours' average, never below hmin, and
  // hardly at all where two parts of the body face each other (between the legs, arm and torso)
  const cap = new Float32Array(D.m);
  for (const v of reg) {
    let c = (spec.skin ? 0.01 : 0.15) * B.s;
    if (D.legW[v] > 0.2 && S.legT[v] > -0.2) c *= 1 - 0.9 * Math.max(0, -Math.sin(S.legPhi[v])) * sstep(0.2, 0.6, D.legW[v]);
    const aw = D.armW[v]; c *= 1 - 0.8 * sstep(0.1, 0.3, aw) * sstep(0.75, 0.5, aw);
    cap[v] = c;
  }
  h.set(hmin);
  const { off: ao, nb } = S.adj, inR = patch.inRegion;
  const tmp = new Float32Array(D.m);
  const iters = spec.slot === 'shoes' ? 14 : 10;
  for (let it = 0; it < iters; it++) {
    for (const v of reg) {
      const o = v * 3; let s = 0, n = 0;
      for (let k = ao[v]; k < ao[v + 1]; k++) {
        const u = nb[k]; if (!inR[u]) continue;
        if (Math.abs(D.armW[u] - D.armW[v]) > 0.3 || Math.abs(D.legW[u] - D.legW[v]) > 0.3) continue;
        const q = u * 3;
        s += (P[q] + Ns[q] * h[u] - P[o]) * Ns[o] + (P[q + 1] + Ns[q + 1] * h[u] - P[o + 1]) * Ns[o + 1] + (P[q + 2] + Ns[q + 2] * h[u] - P[o + 2]) * Ns[o + 2];
        n++;
      }
      tmp[v] = n ? Math.max(hmin[v], Math.min(s / n, hmin[v] + cap[v])) : hmin[v];
    }
    for (const v of reg) h[v] = tmp[v];
  }
  // bottoms: the two legs never cross the middle
  if (spec.slot === 'bottoms') {
    for (const v of reg) {
      const o = v * 3, sg = D.rest[o] >= 0 ? 1 : -1;
      if (D.legW[v] < 0.3) continue;
      const nx = Ns[o] * sg;
      if (nx < -0.05) { const lim = (P[o] * sg - 0.045 * B.s) / -nx; if (h[v] > lim) h[v] = Math.max(lim, off * 0.6); }
    }
  }
  return h;
}
/* ---------- pants: a convex drape, not an inflated copy of the legs ----------
   Horizontal slices (1 cm). Above the garment's crotch, one slice around the pelvis: the convex hull
   of the body there (the seat, the groin and the cleft are bridged), hanging straight down from the
   hips. Below it, one convex column per leg around the leg's axis: its top is the half of the
   pelvis slice on that side (so the crotch closes on a seam in the middle), the thigh below it, then
   a column that keeps the mid-thigh's width down to the hem (straight) or grows a little to the knee
   and hangs straight from there (baggy), with stacked rings where the hem rests on the shoe. Every
   slice is convex, so the cloth never follows a hollow of the body. */
const PB = 64;
function radialBins(pts, cx, cz) {
  const raw = new Float32Array(PB);
  for (const [x, z] of pts) {
    const dx = x - cx, dz = z - cz, r = Math.hypot(dx, dz);
    const b = clamp(Math.floor(((Math.atan2(dx, dz) + Math.PI) / (2 * Math.PI)) * PB), 0, PB - 1);
    if (r > raw[b]) raw[b] = r;
  }
  return fillBins(raw, PB) ? hullRadii(raw, PB, new Float32Array(PB)) : null;
}
function radiusAt(Rb, a) {
  const f = ((a + Math.PI) / (2 * Math.PI)) * PB - 0.5, b0 = Math.floor(f), t = f - b0;
  return mix(Rb[((b0 % PB) + PB) % PB], Rb[(((b0 + 1) % PB) + PB) % PB], t);
}
function radialPts(Rb, cx, cz, scale = 1, add = 0, out = []) {
  for (let b = 0; b < PB; b++) { const a = -Math.PI + ((b + 0.5) * 2 * Math.PI) / PB, r = Rb[b] * scale + add; out.push([cx + Math.sin(a) * r, cz + Math.cos(a) * r]); }
  return out;
}
const baggyOf = (fitKey) => (fitKey === 'baggy' || fitKey === 'oversized' ? 1 : fitKey === 'relaxed' ? 0.5 : 0);
function pantsTargets(D, S, B, patch, fitKey, shoeG) {
  const P = B.P, s = B.s, m = D.m, spec = patch.spec, fit = FIT[fitKey] ?? 1;
  const baggy = baggyOf(fitKey);
  const ease = (SLOT_OFFSET_MM.bottoms * MM + spec.loose * Math.min(fit, 1.2) * 0.6) * s;
  const sides = [B.J.hipL[0] >= 0 ? 'L' : 'R', B.J.hipL[0] >= 0 ? 'R' : 'L']; // [+x, -x]
  let crotch = Infinity;
  for (let c = 0; c < m; c++) if (D.region[c] === R.TORSO && Math.abs(P[c * 3]) < 0.15 * s) crotch = Math.min(crotch, P[c * 3 + 1]);
  // the one ring holds down to Yc; below it each leg is its own column whose top is the ring's half
  const Yc = crotch + 0.45 * s;
  const dy = 0.1 * s;
  let yLo = Infinity, yHi = -Infinity;
  for (const v of patch.region) { const y = P[v * 3 + 1]; if (y < yLo) yLo = y; if (y > yHi) yHi = y; }
  yLo -= 2 * dy; yHi += 2 * dy;
  const NR = Math.ceil((yHi - yLo) / dy) + 1, rowY = (r) => yLo + r * dy;
  const axisXZ = (side, y) => {
    const H = B.J['hip' + side], K = B.J['knee' + side], A = B.J['ankle' + side];
    const seg = (a, b) => { const t = clamp((y - a[1]) / (b[1] - a[1]), 0, 1); return [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t]; };
    return y >= K[1] ? seg(H, K) : seg(K, A);
  };
  // the points of each slice: the body (no arms, hands or feet) and the shoes' ankles
  const rows = Array.from({ length: NR }, () => []);
  const add = (x, y, z) => { const r = Math.round((y - yLo) / dy); for (let k = r - 1; k <= r + 1; k++) if (k >= 0 && k < NR) rows[k].push([x, z]); };
  for (let c = 0; c < m; c++) {
    const rg = D.region[c];
    if ((rg !== R.TORSO && rg !== R.THIGH && rg !== R.SHIN) || D.armW[c] > 0.05) continue;
    const y = P[c * 3 + 1]; if (y < yLo || y > yHi) continue;
    add(P[c * 3], y, P[c * 3 + 2]);
  }
  if (shoeG) for (let i = 0; i < shoeG.length; i += 3) {
    const x = shoeG[i], y = shoeG[i + 1], z = shoeG[i + 2], side = x >= 0 ? sides[0] : sides[1];
    const [cx, cz] = axisXZ(side, y);
    if (Math.hypot(x - cx, z - cz) < 0.95 * s) add(x, y, z); // (a boot's heel stands ~8 cm behind the ankle)
  }
  // pelvis slices (above the crotch): one convex ring, hanging from the hips
  const rc = Math.max(0, Math.floor((crotch - yLo) / dy)); // first pelvis row (the halves go down to here)
  const pel = new Array(NR).fill(null), pzc = new Float32Array(NR);
  for (let r = Math.max(0, rc); r < NR; r++) {
    let z0 = Infinity, z1 = -Infinity;
    for (const [, z] of rows[r]) { if (z < z0) z0 = z; if (z > z1) z1 = z; }
    pzc[r] = Number.isFinite(z0) ? (z0 + z1) / 2 : 0;
  }
  for (let r = Math.max(0, rc); r < NR; r++) { // smooth the centres
    let a = 0, n = 0; for (let k = r - 2; k <= r + 2; k++) if (k >= rc && k < NR && rows[k].length) { a += pzc[k]; n++; }
    if (n) pzc[r] = a / n;
  }
  for (let r = NR - 1; r >= Math.max(0, rc); r--) {
    const R0 = radialBins(rows[r], 0, pzc[r]);
    pel[r] = R0 ? R0.map((v) => v + ease * 0.8 + 0.03 * baggy * s) : r + 1 < NR ? pel[r + 1] : null;
  }
  // down from the widest row: the seat hangs flat (at most a gentle taper inwards)
  let widest = Math.max(0, rc), wmax = 0;
  for (let r = Math.max(0, rc); r < NR; r++) if (pel[r]) { const w = pel[r].reduce((a, b) => a + b, 0); if (w > wmax) { wmax = w; widest = r; } }
  for (let r = widest - 1; r >= Math.max(0, rc); r--) if (pel[r] && pel[r + 1]) for (let b = 0; b < PB; b++) pel[r][b] = Math.max(pel[r][b], pel[r + 1][b] - 0.02 * dy);
  for (let pass = 0; pass < 2; pass++) {
    const prev = pel.map((A) => A && Float32Array.from(A));
    for (let r = rc + 1; r < NR - 1; r++) if (prev[r] && prev[r - 1] && prev[r + 1]) for (let b = 0; b < PB; b++) pel[r][b] = Math.max(prev[r][b], (prev[r - 1][b] + prev[r][b] * 2 + prev[r + 1][b]) / 4);
  }
  for (let r = 0; r < NR; r++) if (pel[r]) pel[r] = hullRadii(pel[r], PB, new Float32Array(PB));
  const pelBottom = pel[Math.max(0, rc)] || pel.find(Boolean);
  const rYc = clamp(Math.ceil((Yc - yLo) / dy), 0, NR - 1);
  const ySeam = crotch - (0.16 + 0.2 * baggy) * s; // the pants' crotch seam, a little under the body's
  // leg columns
  const leg = [new Array(NR).fill(null), new Array(NR).fill(null)];
  const Tb = (0.6 + 0.4 * baggy) * s;
  for (let k = 0; k < 2; k++) {
    const side = sides[k], sg = k === 0 ? 1 : -1;
    const H = B.J['hip' + side], K = B.J['knee' + side], A = B.J['ankle' + side];
    const yMid = mix(H[1], K[1], 0.45), yKnee = K[1], yAnk = A[1];
    const own = new Array(NR).fill(null);
    for (let r = 0; r <= rYc; r++) {
      const y = rowY(r), [cx, cz] = axisXZ(side, y);
      const pts = rows[r].filter(([x]) => x * sg > 0);
      own[r] = pts.length > 4 ? radialBins(pts, cx, cz) : null;
    }
    for (let r = 0; r < NR; r++) if (!own[r]) { let q = r; while (q < NR && !own[q]) q++; if (q < NR) own[r] = own[q]; }
    // the column: the mid-thigh's slice (plus ease), carried down
    const rMid = clamp(Math.round((yMid - yLo) / dy), 0, NR - 1);
    const colR = own[rMid] ? own[rMid].map((v) => v + ease + 0.05 * baggy * s) : null;
    for (let r = 0; r <= rYc; r++) {
      const y = rowY(r), [cx, cz] = axisXZ(side, y);
      if (!own[r]) continue;
      const pts = radialPts(own[r], cx, cz, 1, ease + 0.03 * baggy * s);
      if (colR && y < yMid) {
        // straight: the same width to the hem (2% narrower at the ankle); baggy: 6% wider by the knee
        const k2 = baggy ? 1 + 0.06 * baggy * sstep(yMid, yKnee, y) : 1;
        radialPts(colR, cx, cz, k2, 0, pts);
      }
      if (y > ySeam - Tb && pelBottom) {
        // the top of the leg: the pelvis' half on this side, flattened onto the middle (the seam);
        // above the crotch it is exactly that half, below it shrinks into the leg
        const rr = Math.max(r, rc), ring = pel[rr] || pelBottom, w = y >= ySeam ? 1 : sstep(ySeam - Tb, ySeam, y), pz = pzc[rr];
        for (const [x, z] of radialPts(ring, 0, pz)) {
          const xs = Math.max(0, x * sg) * sg;
          pts.push([cx + (xs - cx) * w, cz + (z - cz) * w]);
        }
      }
      // a leg never crosses the middle (the two meet on the seam there)
      for (const q of pts) if (q[0] * sg < 0) q[0] = 0;
      // under the crotch the cloth falls straight from the seam: the inner side of each leg is flat
      // against the middle (a D, not a round tube), so the legs meet in a crease, never two round lobes
      const flat = sstep(ySeam - (1.6 + 1.4 * baggy) * s, ySeam - 0.05 * s, y);
      if (flat > 0 && pts.length) {
        let zf = -Infinity, zb = Infinity, xin = Infinity;
        for (const [x, z] of pts) { if (z > zf) zf = z; if (z < zb) zb = z; if (x * sg < xin) xin = x * sg; }
        const xp = sg * mix(xin, 0.008 * s, flat), d = zf - zb;
        for (let t = 0.12; t <= 0.881; t += 0.0475) pts.push([xp, zb + d * t]);
      }
      leg[k][r] = radialBins(pts, cx, cz);
    }
    // never narrower than the rows above by more than a gentle taper (from the crotch down to the
    // mid-thigh the leg follows the thigh; below that the column decides)
    for (let r = rYc - 1; r >= 0; r--) if (leg[k][r] && leg[k][r + 1] && rowY(r) > yMid) {
      for (let b = 0; b < PB; b++) leg[k][r][b] = Math.max(leg[k][r][b], leg[k][r + 1][b] - 0.35 * dy);
    }
    // smooth along the height (no step between slices)
    for (let pass = 0; pass < 5; pass++) {
      const prev = leg[k].map((A) => A && Float32Array.from(A));
      for (let r = 1; r < rYc; r++) if (prev[r] && prev[r - 1] && prev[r + 1] && rowY(r) < ySeam - 0.1 * s) for (let b = 0; b < PB; b++) leg[k][r][b] = Math.max(prev[r][b], (prev[r - 1][b] + prev[r][b] * 2 + prev[r + 1][b]) / 4);
    }
    // below the mid-thigh the column decides: never narrower than the leg at mid-thigh (straight), or
    // a little wider from the knee down (baggy); the shin's hollows are bridged
    {
      const rM = clamp(Math.round(((H[1] + K[1]) / 2 - yLo) / dy), 0, NR - 1), M = leg[k][rM] && Float32Array.from(leg[k][rM]);
      if (M) for (let r = 0; r < rM; r++) if (leg[k][r]) {
        const kk = baggy ? 1 + 0.07 * baggy * sstep((H[1] + K[1]) / 2, yKnee, rowY(r)) : 0.995;
        for (let b = 0; b < PB; b++) leg[k][r][b] = Math.max(leg[k][r][b], M[b] * kk);
      }
    }
    // below the knee the cloth hangs from the calf: never narrower than the row above it, so the leg
    // falls straight from the calf's widest point instead of following the calf in and out (a bump
    // on the back of the lower leg)
    {
      const rK = clamp(Math.round((yKnee - yLo) / dy), 1, NR - 2);
      for (let r = rK - 1; r >= 0; r--) if (leg[k][r] && leg[k][r + 1]) for (let b = 0; b < PB; b++) leg[k][r][b] = Math.max(leg[k][r][b], leg[k][r + 1][b] - 0.004 * dy);
      for (let pass = 0; pass < 4; pass++) {
        const prev = leg[k].map((A) => A && Float32Array.from(A));
        for (let r = 1; r <= rK + 2; r++) if (prev[r] && prev[r - 1] && prev[r + 1]) for (let b = 0; b < PB; b++) leg[k][r][b] = Math.max(prev[r][b], (prev[r - 1][b] + prev[r][b] * 2 + prev[r + 1][b]) / 4);
      }
    }
    // joggers: from the knee the leg narrows to the elastic cuff, which holds close round the ankle
    // (or round a high-top's collar); tapered trousers narrow a little towards the ankle
    const jog = spec.jogger, yCuff = yAnk + (1 - spec.leg) * (H[1] - yAnk) + (jog ? jog.band * s : 0);
    if (jog || fitKey === 'tapered') for (let r = 0; r < NR; r++) {
      const y = rowY(r); if (!leg[k][r] || !own[r] || y > yKnee) continue;
      const w = jog ? sstep(yKnee, yCuff + 0.6 * s, y) : sstep(yKnee, yAnk, y), tightR = (jog ? jog.tight : 0.05) * s;
      for (let b = 0; b < PB; b++) {
        const lo = own[r][b] + tightR, cur = leg[k][r][b];
        leg[k][r][b] = jog ? mix(cur, lo, w) : Math.max(lo, cur * mix(1, 0.88, w));
      }
    }
    // the max and the averages above may leave a dent: each slice convex again, and its corners
    // (where the flat inner side meets the round back, or the shoe's hull) rounded off, so no
    // vertical edge runs down the leg
    for (let r = 0; r < NR; r++) if (leg[k][r]) leg[k][r] = hullRadii(filletRadii(hullRadii(leg[k][r], PB, new Float32Array(PB)), 25), PB, new Float32Array(PB));
    // joggers: the cloth gathers in soft rings just above the cuff
    if (jog) for (let r = 0; r < NR; r++) {
      const y = rowY(r), zz = (y - yCuff) / s; if (!leg[k][r] || zz < -0.05 || zz > 1.1) continue;
      const g = 1 + jog.gather * sstep(-0.02, 0.08, zz) * sstep(1.1, 0.5, zz) * (0.55 + 0.45 * Math.sin((zz / 0.3) * 2 * Math.PI + 1.2));
      for (let b = 0; b < PB; b++) leg[k][r][b] *= g;
    }
    // stacked rings where a long hem rests on the shoe
    if (baggy && !jog) {
      const yH = yAnk, span = 1.3 * s;
      for (let r = 0; r < NR; r++) {
        const y = rowY(r); if (!leg[k][r] || y > yH + span) continue;
        const f = sstep(yH + span, yH + 0.2 * s, y), ring = 0.5 + 0.5 * Math.sin(((y - yH) / (0.4 * s)) * 2 * Math.PI);
        const g = 1 + 0.024 * baggy * f * ring;
        for (let b = 0; b < PB; b++) leg[k][r][b] *= g;
      }
    }
  }
  // the fly: from the waist down to the crotch seam the front is one panel stretched across both
  // thighs (the convex hull of the two legs' slices), never two rounded lobes with a valley between
  const yBr = ySeam - 0.05 * s, rSeam = clamp(Math.floor((yBr - yLo) / dy), 0, NR - 1), zB = pzc[Math.max(0, rc)];
  const bridge = new Array(NR).fill(null);
  for (let r = rSeam; r <= Math.min(NR - 1, rYc + 2); r++) {
    const y = rowY(r), pts = [];
    for (let k = 0; k < 2; k++) if (leg[k][r]) { const [cx, cz] = axisXZ(sides[k], y); radialPts(leg[k][r], cx, cz, 1, 0, pts); }
    if (pts.length) bridge[r] = radialBins(pts, 0, zB);
  }
  const bridgeAt = (y, T, o) => {
    if (y < yBr || y >= Yc + 0.2 * s) return;
    const a = Math.atan2(T[o], T[o + 2] - zB), wF = sstep(-0.3, 0.2, Math.cos(a));
    const wY = sstep(yBr, ySeam + 0.25 * s, y) * sstep(Yc + 0.2 * s, Yc + 0.1 * s, y);
    if (wF * wY <= 0) return;
    const Rr = sampleRows(bridge, y, a); if (Rr == null) return;
    const cur = Math.hypot(T[o], T[o + 2] - zB); if (Rr <= cur) return;
    const R2 = mix(cur, Rr, wF * wY);
    T[o] = Math.sin(a) * R2; T[o + 2] = zB + Math.cos(a) * R2;
  };
  // place every vertex on its slice
  const T = Float32Array.from(P), h = new Float32Array(m);
  const sampleRows = (arr, y, a) => {
    const f = clamp((y - yLo) / dy, 0, NR - 1), r0 = Math.floor(f), t = f - r0;
    let A0 = arr[r0], A1 = arr[Math.min(NR - 1, r0 + 1)];
    if (!A0) A0 = A1; if (!A1) A1 = A0; if (!A0) return null;
    return mix(radiusAt(A0, a), radiusAt(A1, a), t);
  };
  const straightFolds = baggy ? 0 : 0.005 * s;
  const onLeg = (k, x, y, z, o, T, at) => {
    const [cx, cz] = axisXZ(sides[k], y), a = at ?? Math.atan2(x - cx, z - cz);
    let Rr = sampleRows(leg[k], y, a); if (Rr == null) return false;
    Rr += straightFolds * Math.sin(a * 7 + y * 1.3) * sstep(crotch - 1.5 * s, crotch - 3 * s, y);
    T[o] = cx + Math.sin(a) * Rr; T[o + 1] = y; T[o + 2] = cz + Math.cos(a) * Rr;
    return true;
  };
  // the crotch curve: points in the middle (the cleft, the perineum, the fly) go onto the pants'
  // middle outline, seen from the side: down the back centre, along the seam under the crotch, up the
  // front centre. The ring's back and front, and the seam below the crotch, are all on the surface.
  const y0 = crotch + 0.25 * s, zO = pzc[Math.min(NR - 1, rc + 4)];
  const ringAt = (yy, a) => { const zc = pzc[clamp(Math.round((Math.max(yy, crotch) - yLo) / dy), rc, NR - 1)]; const Rr = sampleRows(pel, Math.max(yy, crotch), a); return [zc, Rr]; };
  const seamTarget = (z, y, o, T) => {
    const dz = z - zO, dyv = y - y0, L = Math.hypot(dz, dyv) || 1, ez = dz / L, ey = dyv / L;
    let pz = zO, py = y0;
    for (let t = 0.01 * s; t < 3 * s; t += 0.01 * s) {
      const zz = zO + ez * t, yy = y0 + ey * t;
      if (yy < ySeam) break;
      const [zcF, RF] = ringAt(yy, 0), [zcB, RB] = ringAt(yy, Math.PI);
      if (RF == null || zz > zcF + RF || zz < zcB - RB) break;
      pz = zz; py = yy;
    }
    T[o] = 0; T[o + 1] = py; T[o + 2] = pz;
  };
  const deepMiddle = (x, y, z) => {
    if (Math.abs(x) > 0.25 * s || y > Yc + 0.3 * s || y < ySeam - 0.05 * s) return false;
    const a = Math.atan2(x, z - zO), [zc, Rr] = ringAt(y, a);
    return Rr != null && Math.hypot(x, z - zc) < Rr - 0.05 * s;
  };
  // place one point (of the body, or of the garment's own mesh) on the pants' surface
  const place = (x, y, z, T, o) => {
    if (deepMiddle(x, y, z)) { seamTarget(z, y, o, T); return true; }
    if (y >= Yc) {
      const f = clamp((y - yLo) / dy, 0, NR - 1), zc = mix(pzc[Math.floor(f)], pzc[Math.min(NR - 1, Math.floor(f) + 1)], f - Math.floor(f));
      const a = Math.atan2(x, z - zc), Rr = sampleRows(pel, y, a);
      if (Rr == null) return false;
      T[o] = Math.sin(a) * Rr; T[o + 1] = y; T[o + 2] = zc + Math.cos(a) * Rr;
      return true;
    }
    const k = x >= 0 ? 0 : 1;
    if (!onLeg(k, x, y, z, o, T)) return false;
    // on the seam between the legs above the crotch: inside the one ring there, so down below it
    if (Math.abs(T[o]) < 0.12 * s && y > crotch - 0.03 * s) {
      const f = clamp((y - yLo) / dy, 0, NR - 1), zc = pzc[Math.max(rc, Math.round(f))];
      const Rr = sampleRows(pel, Math.max(y, crotch), Math.atan2(T[o], T[o + 2] - zc));
      if (Rr != null && Math.hypot(T[o], T[o + 2] - zc) < Rr - 0.02 * s) { seamTarget(z, y, o, T); return true; }
    }
    bridgeAt(y, T, o);
    return true;
  };
  for (const v of patch.region) {
    const o = v * 3, x = P[o], y = P[o + 1], z = P[o + 2];
    if (!place(x, y, z, T, o)) continue;
    h[v] = Math.hypot(T[o] - x, T[o + 1] - y, T[o + 2] - z);
  }
  // Below the crotch every point sits on its slice at the angle it has round the leg's axis. Near
  // the ankle the skin is only 2-3 cm from that axis, so the rows of the body's mesh (a few mm apart
  // there) turn into long thin strips on the cloth, and on a curved leg such strips tilt in and out
  // in turns: a dark crease down the back of the calf. Relax the points over the leg as a cylinder
  // (each to the middle of its neighbours, the hem's edge only sideways), then put them back on the
  // slices, so the triangles are even.
  const relax = (W, adj, nv, bound) => {
    const { off, nb } = adj, yTop = ySeam - 0.3 * s, R0 = 1.2 * s;
    const kk = new Int8Array(nv).fill(-1), w = new Float32Array(nv), Q = new Float64Array(nv * 3), Q2 = new Float64Array(nv * 3);
    const onB = new Uint8Array(nv); for (const e of bound) { onB[e.a] = 1; onB[e.b] = 1; }
    for (let v = 0; v < nv; v++) {
      const o = v * 3, y = W[o + 1]; if (y > yTop) continue;
      const k = W[o] >= 0 ? 0 : 1, [cx, cz] = axisXZ(sides[k], y), a = Math.atan2(W[o] - cx, W[o + 2] - cz);
      kk[v] = k; w[v] = sstep(yTop, yTop - 0.6 * s, y);
      Q[o] = Math.sin(a) * R0; Q[o + 1] = y; Q[o + 2] = Math.cos(a) * R0;
    }
    for (let pass = 0; pass < 60; pass++) {
      Q2.set(Q);
      for (let v = 0; v < nv; v++) {
        if (kk[v] < 0 || !w[v]) continue;
        const o = v * 3; let x = 0, y = 0, z = 0, n = 0;
        for (let j = off[v]; j < off[v + 1]; j++) { const u = nb[j]; if (kk[u] !== kk[v]) { n = 0; break; } x += Q2[u * 3]; y += Q2[u * 3 + 1]; z += Q2[u * 3 + 2]; n++; }
        if (!n) continue;
        const f = 0.9 * w[v];
        let qx = Q2[o] + (x / n - Q2[o]) * f, qz = Q2[o + 2] + (z / n - Q2[o + 2]) * f;
        const r = Math.hypot(qx, qz) || 1; qx *= R0 / r; qz *= R0 / r;
        Q[o] = qx; Q[o + 2] = qz;
        if (!onB[v]) Q[o + 1] = Q2[o + 1] + (y / n - Q2[o + 1]) * f;
      }
    }
    for (let v = 0; v < nv; v++) if (kk[v] >= 0 && w[v]) {
      const o = v * 3;
      onLeg(kk[v], 0, Q[o + 1], 0, o, W, Math.atan2(Q[o], Q[o + 2]));
    }
  };
  return { T, h, Yc, crotch, ySeam, place, relax };
}
/* ---------- tops: a convex cylinder from the chest down to the hem ----------
   Below the armpits each 1 cm slice of the torso part of a top is the convex hull of the body there
   and of the pieces worn under it, plus ease; it hangs from the chest (a regular fit narrows only a
   little to the hem, a boxy/oversized one not at all), so the cloth is flat across the lower back and
   the seat and never follows the waist or the spine's hollow. The shoulders and the sleeves keep the
   height field; the two blend over the armpit. */
function topTargets(D, S, B, g, worn) {
  const P = B.P, s = B.s, m = D.m, spec = g.spec, fk = g.fitKey;
  const over = fk === 'oversized' ? 1 : fk === 'relaxed' ? 0.5 : 0, slim = fk === 'slim' ? 1 : 0;
  // over the skin: the slot's offset (a little less, the cloth hangs) and the fit; over an inner layer
  // only the layering gap, so a jacket over a tee is ~1-1.5 cm off it, not a box around it
  const ease = (SLOT_OFFSET_MM[spec.slot] * 0.6 * MM + spec.loose * (0.45 + 0.6 * over) + 0.03 * over) * s * (1 - 0.5 * slim);
  const gapIn = (spec.slot === 'jacket' ? 0.07 : 0.04) * s;
  // the garment's own volume (a bomber, a puffer): it stands this far off the body or the layer under it
  const loft = (spec.loft || 0) * s * (slim ? 0.8 : fk === 'oversized' ? 1.2 : fk === 'relaxed' ? 1.1 : 1);
  // radius lost per unit of height going down, per side: the back follows the shoulder blades in
  // towards the waist, the front falls nearly straight from the chest (no bust), the sides between
  // (a lofted jacket falls plumb all round to its hem band: no waist, no bust)
  const tF = loft ? 0 : slim ? 0.2 : 0.02, tB = loft ? 0.05 : slim ? 0.3 : over ? 0.08 : 0.16;
  const yOf = (ry) => (ry - B.lo) * s;
  const yArm = yOf(4.62), yTop = yArm + 0.85 * s, dy = 0.1 * s;
  let yLo = Infinity;
  for (const v of g.patch.region) if (D.armW[v] < 0.3) yLo = Math.min(yLo, P[v * 3 + 1]);
  yLo -= 2 * dy;
  const yHi = yTop + 2 * dy, NR = Math.ceil((yHi - yLo) / dy) + 1, rowY = (r) => yLo + r * dy;
  const rows = Array.from({ length: NR }, () => []);
  const add = (x, y, z) => { if (y < yLo || y > yHi) return; const r = Math.round((y - yLo) / dy); for (let k = r - 1; k <= r + 1; k++) if (k >= 0 && k < NR) rows[k].push([x, z]); };
  for (let c = 0; c < m; c++) {
    const rg = D.region[c];
    if ((rg !== R.TORSO && rg !== R.THIGH) || D.armW[c] > 0.04) continue;
    add(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]);
  }
  const rowsIn = Array.from({ length: NR }, () => []);
  const addIn = (x, y, z) => { if (y < yLo || y > yHi) return; const r = Math.round((y - yLo) / dy); for (let k = r - 1; k <= r + 1; k++) if (k >= 0 && k < NR) rowsIn[k].push([x, z]); };
  for (const slot of ORDER.slice(1, ORDER.indexOf(spec.slot))) {
    const gi = worn[slot]; if (!gi || !gi.G) continue;
    const Gi = gi.G, aw = gi.patch.armW;
    for (let v = 0; v < gi.patch.nv; v++) if (aw[v] < 0.04) addIn(Gi[v * 3], Gi[v * 3 + 1], Gi[v * 3 + 2]);
  }
  const zc = new Float32Array(NR);
  for (let r = 0; r < NR; r++) { let z0 = Infinity, z1 = -Infinity; for (const [, z] of rows[r].concat(rowsIn[r])) { if (z < z0) z0 = z; if (z > z1) z1 = z; } zc[r] = Number.isFinite(z0) ? (z0 + z1) / 2 : NaN; }
  for (let r = 0; r < NR; r++) if (isNaN(zc[r])) zc[r] = r ? zc[r - 1] : 0;
  for (let it = 0; it < 4; it++) { const b = zc.slice(); for (let r = 1; r < NR - 1; r++) zc[r] = (b[r - 1] + 2 * b[r] + b[r + 1]) / 4; }
  // below the armpits the cloth hangs plumb: one centre for all those rows, so the front falls
  // straight from the chest instead of following the body back in under it (which reads as a bust)
  const rArm = clamp(Math.round((yArm - yLo) / dy), 0, NR - 1);
  for (let r = 0; r < rArm; r++) zc[r] = zc[rArm];
  const ring = new Array(NR).fill(null), tight = new Array(NR).fill(null);
  for (let r = 0; r < NR; r++) {
    const Rb = radialBins(rows[r], 0, zc[r]), Ri = rowsIn[r].length > 8 ? radialBins(rowsIn[r], 0, zc[r]) : null;
    ring[r] = Rb ? Rb.map((v, b) => Math.max(v + Math.max(ease, loft), Ri ? Ri[b] + Math.max(gapIn, loft) : 0)) : null;
    // where a hem band pulls the cloth in to: close over what is under it
    tight[r] = Rb ? Rb.map((v, b) => Math.max(v + ease, Ri ? Ri[b] + gapIn * 0.8 : 0)) : null;
  }
  for (const A of [ring, tight]) {
    for (let r = 1; r < NR; r++) if (!A[r]) A[r] = A[r - 1];
    for (let r = NR - 2; r >= 0; r--) if (!A[r]) A[r] = A[r + 1];
  }
  if (!ring[0]) return null;
  for (let r = 0; r < NR; r++) tight[r] = hullRadii(tight[r], PB, new Float32Array(PB));
  // hang from the chest: from the widest row under the armpits down to the hem
  const tapB = Array.from({ length: PB }, (_, b) => mix(tF, tB, ((1 - Math.cos(-Math.PI + ((b + 0.5) * 2 * Math.PI) / PB)) / 2) ** 3)); // the sides fall nearly straight too
  for (let r = rArm - 1; r >= 0; r--) for (let b = 0; b < PB; b++) ring[r][b] = Math.max(ring[r][b], ring[r + 1][b] - tapB[b] * dy);
  // and over the chest and the shoulder blades it bends round, not at a corner: going up from there the
  // radius may turn in no faster than a ~6 cm curve allows (cloth draped over a curve, never folded)
  const bend = (dy * dy) / (0.6 * s);
  for (let r = Math.max(2, rArm - 4); r < NR; r++) for (let b = 0; b < PB; b++) {
    const want = 2 * ring[r - 1][b] - ring[r - 2][b] - bend;
    if (ring[r][b] < want) ring[r][b] = want;
  }
  // fill the hollows along the height (where the taper meets the seat, the cloth curves, no kink)
  for (let pass = 0; pass < 10; pass++) {
    const prev = ring.map((A) => Float32Array.from(A));
    for (let r = 1; r < NR - 1; r++) for (let b = 0; b < PB; b++) ring[r][b] = Math.max(prev[r][b], (prev[r - 1][b] + 2 * prev[r][b] + prev[r + 1][b]) / 4);
  }
  for (let r = 0; r < NR; r++) ring[r] = hullRadii(ring[r], PB, new Float32Array(PB));
  const band = spec.rib || spec.hemPull || 0;
  const hemTop = band ? yOf(g.patch.hemY + band * 0.9) : -Infinity, hemBot = yOf(g.patch.hemY);
  const place = (x, y, z, T, o) => {
    const f = clamp((y - yLo) / dy, 0, NR - 1), r0 = Math.floor(f), t = f - r0, r1 = Math.min(NR - 1, r0 + 1);
    const c = mix(zc[r0], zc[r1], t), a = Math.atan2(x, z - c);
    let Rr = mix(radiusAt(ring[r0], a), radiusAt(ring[r1], a), t);
    if (spec.ribPull && band) {
      // the band (a rib, an elastic hem) holds the cloth close; above it the cloth bags out and rolls
      const Rt = mix(radiusAt(tight[r0], a), radiusAt(tight[r1], a), t);
      const zz = (y - hemTop) / s;
      if (spec.blouse) Rr += spec.blouse * s * Math.exp(-(((zz - 0.3) / 0.3) ** 2));
      if (spec.rolls) Rr += spec.rolls * s * Math.max(0, Math.sin((zz / 0.28) * 2 * Math.PI + 0.9 * Math.sin(2 * a + 0.7))) ** 1.5 * sstep(0, 0.06, zz) * sstep(1.0, 0.7, zz);
      Rr = mix(Rr, Rt + 0.1 * Math.max(0, Rr - Rt), spec.ribPull * sstep(0.03, -0.06, zz));
    } else if (spec.rib) Rr -= 0.35 * ease * sstep(hemTop, hemBot, y); // a ribbed hem gathers the cloth back in a little
    // quilting: a puff between horizontal stitch lines
    if (spec.baffle) Rr += spec.baffle.amp * s * (puffOf((y - hemBot) / s / spec.baffle.step) - 0.75) * sstep(0, 0.08, (y - hemBot) / s);
    T[o] = Math.sin(a) * Rr; T[o + 1] = y; T[o + 2] = c + Math.cos(a) * Rr;
  };
  const weight = (y, aw) => sstep(0.3, 0.04, aw) * sstep(yTop, yArm - 0.1 * s, y);
  const T = new Float32Array(3), h = new Float32Array(m), w = new Float32Array(m);
  for (const v of g.patch.region) {
    const o = v * 3, ww = weight(P[o + 1], D.armW[v]); if (ww <= 0) continue;
    place(P[o], P[o + 1], P[o + 2], T, 0);
    h[v] = Math.hypot(T[0] - P[o], T[1] - P[o + 1], T[2] - P[o + 2]); w[v] = ww;
  }
  return { place, weight, h, w };
}
const sampleRow = (a, f) => { const r = clamp(Math.floor(f), 0, a.length - 1), t = f - r; return a[r] * (1 - t) + a[Math.min(r + 1, a.length - 1)] * t; };

// The order of the layers: an outer piece stays outside the pieces it overlaps.
const GAP = { 'top>bottoms': 0.05, 'layer>top': 0.05, 'layer>bottoms': 0.08, 'jacket>layer': 0.06, 'jacket>top': 0.07, 'jacket>bottoms': 0.11, 'bottoms>shoes': 0.05 };
const ORDER = ['shoes', 'bottoms', 'top', 'layer', 'jacket'];

/* ---------- cloth: tops and jackets hang on the body (position-based dynamics) ----------
   The shell above is only the starting point. Each piece is then cut as a pattern (every edge as long
   as the body under it plus the pattern's ease: around the body by the fit, along it a little) and let
   fall: gravity, the cloth's own length (it may not stretch, and only slowly gives when pushed
   together), a little stiffness, and the body and the layers under it in the way. The neckline holds
   it. Ribs (waistbands, cuffs) are cut close to the body, so a long-cut body bags over them by itself. */

// ease around the body by fit; per type: x that, the share along the body, the sleeves' ease
const CLOTH_EASE = { slim: 0.03, regular: 0.08, straight: 0.09, tapered: 0.07, relaxed: 0.14, oversized: 0.24, baggy: 0.28, wide: 0.26, cropped: 0.08 };
const CLOTH_TYPE = {
  tee: { around: 1, along: 0.02, sleeve: 1.2 },
  tank: { around: 0.9, along: 0.02, sleeve: 1 },
  longsleeve: { around: 0.8, along: 0.03, sleeve: 0.8 },
  sweater: { around: 1.1, along: 0.04, sleeve: 1 },
  hoodie: { around: 1.3, along: 0.05, sleeve: 1.2 },
  trackjacket: { around: 1.1, along: 0.04, sleeve: 1 },
  // (room: it blouses over its rib; chest / low: the ease over the upper chest and over the lowest
  // quarter, x around: a blouson is flat on the chest and full just above its waistband)
  // (tube: the sleeves hang as round tubes this far off the arm's outline with its hollows bridged,
  // so the deltoid, the biceps and the forearm don't print through)
  bomber: { around: 2.2, along: 0.1, sleeve: 1.5, rib: -0.06, room: 2.2, chest: 0.7, low: 1.25, tube: 0.05 },
  jacket_open: { around: 1.25, along: 0.03, sleeve: 1.1 },
}; // (a puffer keeps its quilted shell)
const CLOTH_STEPS = 30, CLOTH_ITERS = 4;
let clothIds = 0; // (each prepared piece gets one, for the drape cache's keys)


// Round sleeves: per arm, the radius around the arm's bones (shoulder-elbow-wrist) that the arm and
// the sleeves under it stay inside (80th percentile), per ~7 mm along the arm, never growing from the
// deltoid down to the wrist (the dips past the biceps, at the elbow and above the wrist are bridged),
// plus room. It takes over within ~4 cm of the shoulder seam. out(X, v, w, snap) moves point v out to
// the tube (w: how much; snap: onto it, as a pattern).
function sleeveTubes(B, D, inner, gapBody, room) {
  const J = B.J, NB = 72;
  const arms = [[J.shoulderL, J.elbowL, J.wristL], [J.shoulderR, J.elbowR, J.wristR]].map(([a, b, c]) => {
    const u1 = norm3(sub3(b, a)), u2 = norm3(sub3(c, b)), L1 = len3(sub3(b, a)), L2 = len3(sub3(c, b));
    return { a, b, c, u1, u2, L1, L: L1 + L2, rs: Array.from({ length: NB }, () => []), R: new Float32Array(NB) };
  });
  const q = [0, 0, 0, 0]; // T along the arm, r, and the point's offset from the bone (scratch: out)
  const off = [0, 0, 0];
  const proj = (A, x, y, z) => {
    let best = Infinity;
    for (let sgi = 0; sgi < 2; sgi++) {
      const o = sgi ? A.b : A.a, u = sgi ? A.u2 : A.u1, l = sgi ? A.L - A.L1 : A.L1;
      const dx = x - o[0], dy = y - o[1], dz = z - o[2];
      const t = clamp(dx * u[0] + dy * u[1] + dz * u[2], 0, l);
      const ox = dx - t * u[0], oy = dy - t * u[1], oz = dz - t * u[2], r = Math.hypot(ox, oy, oz);
      if (r < best) { best = r; q[0] = sgi ? A.L1 + t : t; q[1] = r; off[0] = ox; off[1] = oy; off[2] = oz; }
    }
    return q;
  };
  const add = (x, y, z, g) => {
    const A = arms[x >= 0 ? 0 : 1], p = proj(A, x, y, z), k = Math.min(NB - 1, Math.floor((p[0] / A.L) * NB));
    if (p[0] > 0) A.rs[k].push(p[1] + g);
  };
  for (let c = 0; c < D.m; c++) if (D.region[c] === R.UPPERARM || D.region[c] === R.FOREARM) add(B.P[c * 3], B.P[c * 3 + 1], B.P[c * 3 + 2], gapBody);
  for (const L of inner) for (let v = 0; v < L.G.length / 3; v++) if (L.aw[v] >= 0.6) add(L.G[v * 3], L.G[v * 3 + 1], L.G[v * 3 + 2], L.gap);
  for (const A of arms) {
    // per bin, the radius most of the outline stays inside (not the odd far point: the arm is oval)
    for (let k = 0; k < NB; k++) { const a = A.rs[k].sort((x, y) => x - y); A.R[k] = a.length ? a[Math.floor((a.length - 1) * 0.8)] : 0; }
    // going up from the wrist the radius never comes in again; a little smoothing; then the room
    const M = new Float32Array(NB);
    let run = 0; for (let k = NB - 1; k >= 0; k--) { run = Math.max(run, A.R[k]); M[k] = run; }
    // (the shoulders stay relaxed: over the deltoid the tube is barely wider than over the biceps; the
    // deltoid keeps the cloth off itself as a collider, it doesn't blow the sleeve up)
    const kB = Math.round(NB * 0.25); for (let k = 0; k < kB; k++) M[k] = Math.min(M[k], M[kB] + 0.05 * B.s * (1 - k / kB));
    const H = new Float32Array(NB);
    for (let k = 0; k < NB; k++) { let sm = 0, n = 0; for (let j = k - 2; j <= k + 2; j++) if (j >= 0 && j < NB) { sm += M[j]; n++; } H[k] = sm / n + room; }
    A.H = H;
  }
  const out = (X, v, w, snap) => {
    const o = v * 3, A = arms[X[o] >= 0 ? 0 : 1], p = proj(A, X[o], X[o + 1], X[o + 2]);
    const f = (p[0] / A.L) * NB - 0.5, k0 = clamp(Math.floor(f), 0, NB - 1), k1 = Math.min(NB - 1, k0 + 1);
    const Rt = mix(A.H[k0], A.H[k1], clamp(f - k0, 0, 1)), r = p[1];
    if (r < 1e-6 || (!snap && r >= Rt)) return;
    const k = (mix(r, Rt, w * sstep(0, 0.08, p[0] / A.L)) - r) / r;
    X[o] += off[0] * k; X[o + 1] += off[1] * k; X[o + 2] += off[2] * k;
  };
  return { out, arms };
}

function clothSolve(gm, B, G0, inner) {
  const ty = CLOTH_TYPE[gm.sub]; if (!ty) return null;
  const t0 = performance.now();
  const p = gm.patch, nv = p.nv, s = B.s, spec = gm.spec;
  const ease = (CLOTH_EASE[gm.fitKey] ?? 0.08) * ty.around;
  const Pb = interp(p, B.P, 3);
  // the ease by height on the torso (a blouson: flat on the chest, full over the lowest quarter)
  const zoneK = new Float32Array(nv).fill(1);
  if (ty.chest != null) {
    const yR = p.hemY + (spec.rib || 0), yA = 4.65;
    for (let v = 0; v < nv; v++) zoneK[v] = mix(1, mix(ty.low ?? 1, ty.chest, sstep(yR + 0.25 * (yA - yR), yR + 0.75 * (yA - yR), p.restP[v * 3 + 1])), sstep(0.5, 0.3, p.armW[v]));
  }
  const fRib = p.names.indexOf('rib'), fCuff = p.names.indexOf('cuff'), fNeck = p.names.indexOf('neck');
  const band = new Float32Array(nv); // 1 in a rib or cuff
  for (let v = 0; v < nv; v++) {
    if (fRib >= 0 && p.vf[v * p.nf + fRib] <= 0.005) band[v] = 1;
    if (fCuff >= 0 && p.vf[v * p.nf + fCuff] <= 0.005) band[v] = 1;
  }
  // the axis the piece hangs along: up the torso, down the arm (shoulder to wrist) on the sleeves
  const J = B.J, armAx = (x) => norm3(sub3(x >= 0 ? J.wristL : J.wristR, x >= 0 ? J.shoulderL : J.shoulderR));
  const axL = armAx(1), axR = armAx(-1);
  // what holds it: the neckline (it rests on the neck and the shoulders)
  const pinned = new Uint8Array(nv);
  if (fNeck >= 0) for (const e of p.bound) for (const v of [e.a, e.b]) if (Math.abs(p.vf[v * p.nf + fNeck]) < 0.02) pinned[v] = 1;
  // what is in the way. The torso: per 1 cm row, the convex outline of the body and of each layer
  // under it, around the row's middle (cloth bridges the hollows: the navel, the spine, between the
  // shoulder blades). The sleeves: the nearest point of the arm or of the sleeve under them.
  const gapBody = (0.02 + (spec.thick ?? 0.03) * 0.5) * s;
  const N = B.N, P = B.P, D = gm.stage.D, aw = p.armW;
  const dyR = 0.1 * s;
  let y0 = Infinity, y1 = -Infinity;
  for (let v = 0; v < nv; v++) if (aw[v] < 0.6) { const y = G0[v * 3 + 1]; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  y0 -= 3 * dyR; y1 += 3 * dyR;
  const NR = Math.max(2, Math.ceil((y1 - y0) / dyR) + 1);
  const rowOf = (y) => Math.round((y - y0) / dyR);
  const ptsB = Array.from({ length: NR }, () => []), ptsI = Array.from({ length: NR }, () => []);
  for (let c = 0; c < D.m; c++) {
    const rg = D.region[c]; if ((rg !== R.TORSO && rg !== R.THIGH && rg !== R.NECK) || D.armW[c] > 0.04) continue;
    const r = rowOf(P[c * 3 + 1]); for (let k = r - 1; k <= r + 1; k++) if (k >= 0 && k < NR) ptsB[k].push([P[c * 3], P[c * 3 + 2]]);
  }
  for (const L of inner) for (let v = 0; v < L.G.length / 3; v++) {
    if (L.aw[v] > 0.04) continue;
    const r = rowOf(L.G[v * 3 + 1]); for (let k = r - 1; k <= r + 1; k++) if (k >= 0 && k < NR) ptsI[k].push([L.G[v * 3], L.G[v * 3 + 2], L.gap]);
  }
  const zc = new Float32Array(NR).fill(NaN);
  for (let r = 0; r < NR; r++) { let a = Infinity, b = -Infinity; for (const q of ptsB[r]) { if (q[1] < a) a = q[1]; if (q[1] > b) b = q[1]; } if (a < b) zc[r] = (a + b) / 2; }
  for (let r = 1; r < NR; r++) if (isNaN(zc[r])) zc[r] = zc[r - 1];
  for (let r = NR - 2; r >= 0; r--) if (isNaN(zc[r])) zc[r] = zc[r + 1];
  for (let it = 0; it < 4; it++) { const b = zc.slice(); for (let r = 1; r < NR - 1; r++) zc[r] = (b[r - 1] + 2 * b[r] + b[r + 1]) / 4; }
  // (the rings are worked on as reach along each bin's direction, so a row's middle moving back or
  // forward (the seat, the chest) is not mistaken for the cloth coming in or going out)
  const cosB = Float32Array.from({ length: PB }, (_, b) => Math.cos(((b + 0.5) / PB) * 2 * Math.PI - Math.PI));
  const toAbs = (A, r, k) => { for (let b = 0; b < PB; b++) A[b] += k * zc[r] * cosB[b]; return A; };
  const ring = new Array(NR).fill(null), ringI = new Array(NR).fill(null), hasI = new Uint8Array(NR);
  for (let r = 0; r < NR; r++) {
    const gI = ptsI[r].length ? ptsI[r][0][2] : 0;
    const Ri = ptsI[r].length > 8 ? radialBins(ptsI[r], 0, zc[r]) : null;
    if (Ri) { ringI[r] = toAbs(Ri.map((v) => v + gI), r, 1); hasI[r] = 1; }
  }
  // (the cloth lies over the layer under it as over a smooth form: a waistband's or a button's edge
  // doesn't print through it, and past the layer's edge it comes back in gradually, at most ~6 degrees
  // off the vertical, instead of stepping in)
  for (let pass = 0; pass < 3; pass++) {
    const prev = ringI.map((A) => A && Float32Array.from(A));
    for (let r = 0; r < NR; r++) if (prev[r]) for (let b = 0; b < PB; b++) {
      let sum = 0, n = 0;
      for (let k = -2; k <= 2; k++) { const A = prev[r + k]; if (A) { sum += (A[(b + PB - 1) % PB] + 2 * A[b] + A[(b + 1) % PB]) / 4; n++; } }
      ringI[r][b] = sum / n;
    }
  }
  for (let r = 0; r < NR; r++) if (!ringI[r]) ringI[r] = new Float32Array(PB).fill(-1e3);
  const fall = 0.105 * dyR; // tan 6 degrees per row
  for (let b = 0; b < PB; b++) {
    for (let r = 1; r < NR; r++) ringI[r][b] = Math.max(ringI[r][b], ringI[r - 1][b] - fall);
    for (let r = NR - 2; r >= 0; r--) ringI[r][b] = Math.max(ringI[r][b], ringI[r + 1][b] - fall);
  }
  for (let r = 0; r < NR; r++) {
    const Rb = ptsB[r].length > 8 ? toAbs(radialBins(ptsB[r], 0, zc[r]).map((v) => v + gapBody), r, 1) : null, Ri = ringI[r];
    if (Rb) ring[r] = Float32Array.from({ length: PB }, (_, b) => Math.max(Rb[b], Ri[b]));
    else if (hasI[r]) ring[r] = Float32Array.from(Ri);
  }
  for (let r = 1; r < NR; r++) if (!ring[r]) ring[r] = toAbs(toAbs(Float32Array.from(ring[r - 1]), r - 1, -1), r, 1);
  for (let r = NR - 2; r >= 0; r--) if (!ring[r]) ring[r] = toAbs(toAbs(Float32Array.from(ring[r + 1]), r + 1, -1), r, 1);
  const ring0 = ring.map((A) => Float32Array.from(A)); // (just what is under it: for the collar, last)
  // below a support (the chest, a waistband) the cloth hangs: going down, the front and the back come
  // in at most ~6 degrees off the vertical; the sides keep following the body's taper
  for (let b = 0; b < PB; b++) {
    const w = Math.cos(((b + 0.5) / PB) * 2 * Math.PI - Math.PI) ** 2, fb = dyR * mix(0.47, 0.105, w);
    for (let r = NR - 2; r >= 0; r--) ring[r][b] = Math.max(ring[r][b], ring[r + 1][b] - fb);
  }
  // and along the height the cloth spans from one support to the next (the chest to the waistband,
  // the shoulder blades to the seat) instead of dipping into the hollows between: per angle, the
  // smallest profile that bends only outwards; a loose piece hangs on it, a slim one keeps closer in
  const span = clamp(0.35 + ease * 4, 0.35, 1);
  for (let b = 0; b < PB; b++) {
    const hull = [];
    for (let r = 0; r < NR; r++) {
      const q = [r, ring[r][b]];
      while (hull.length >= 2) { const o = hull[hull.length - 2], a = hull[hull.length - 1]; if ((a[0] - o[0]) * (q[1] - o[1]) - (a[1] - o[1]) * (q[0] - o[0]) >= 0) hull.pop(); else break; }
      hull.push(q);
    }
    for (let i = 0; i + 1 < hull.length; i++) {
      const [ra, va] = hull[i], [rb, vb] = hull[i + 1];
      for (let r = ra; r <= rb; r++) { const env = mix(va, vb, (r - ra) / Math.max(1, rb - ra)); ring[r][b] = ring[r][b] + span * Math.max(0, env - ring[r][b]); }
    }
  }
  for (let r = 0; r < NR; r++) { toAbs(ring[r], r, -1); for (let b = 0; b < PB; b++) ring[r][b] = Math.max(ring[r][b], 0.01); toAbs(ringI[r], r, -1); toAbs(ring0[r], r, -1); }
  // the edges and their pattern lengths: on the torso, the body's surface with its hollows bridged (the
  // outline the cloth goes over: a navel or the spine's groove would otherwise gather it into a knot),
  // plus the fit's ease; the sleeves from the arm.
  const Q = Float32Array.from(Pb);
  for (let v = 0; v < nv; v++) {
    if (aw[v] >= 0.5) continue;
    const x = Pb[v * 3], y = Pb[v * 3 + 1], z = Pb[v * 3 + 2];
    const f = clamp((y - y0) / dyR, 0, NR - 1.001), r0 = Math.floor(f), t = f - r0;
    const c = mix(zc[r0], zc[r0 + 1], t), dz = z - c, rr = Math.hypot(x, dz) || 1e-6, a = Math.atan2(x, dz);
    const k = mix(radiusAt(ring[r0], a), radiusAt(ring[r0 + 1], a), t) / rr;
    Q[v * 3] = x * k; Q[v * 3 + 1] = y; Q[v * 3 + 2] = c + dz * k;
  }
  const tube = ty.tube ? sleeveTubes(B, D, inner, gapBody, ty.tube * s) : null;
  // the sleeves' pattern: round tubes (see sleeveTubes) where there are any, else the arm
  const tubeW = new Float32Array(nv);
  if (tube) for (let v = 0; v < nv; v++) tubeW[v] = band[v] ? 0 : sstep(0.5, 0.75, aw[v]);
  const QS = Float32Array.from(Pb);
  if (tube) for (let v = 0; v < nv; v++) if (tubeW[v] > 0) tube.out(QS, v, tubeW[v], true);
  const { off, nb } = p.adj;
  const E = [];
  for (let v = 0; v < nv; v++) for (let k = off[v]; k < off[v + 1]; k++) if (nb[k] > v) E.push(v, nb[k]);
  const ne = E.length / 2, rest = new Float32Array(ne);
  const len = (A, a, b) => Math.hypot(A[b * 3] - A[a * 3], A[b * 3 + 1] - A[a * 3 + 1], A[b * 3 + 2] - A[a * 3 + 2]) || 1e-4;
  for (let e = 0; e < ne; e++) {
    const a = E[e * 2], b = E[e * 2 + 1];
    const ew = (aw[a] + aw[b]) / 2, torso = aw[a] < 0.5 && aw[b] < 0.5;
    const S0 = torso ? Q : QS, L = len(S0, a, b);
    const ax = ew > 0.5 ? (Pb[a * 3] >= 0 ? axL : axR) : [0, 1, 0];
    const c2 = (((S0[b * 3] - S0[a * 3]) * ax[0] + (S0[b * 3 + 1] - S0[a * 3 + 1]) * ax[1] + (S0[b * 3 + 2] - S0[a * 3 + 2]) * ax[2]) / L) ** 2; // 1 along, 0 around
    const bd = (band[a] + band[b]) / 2;
    const around = mix(ew > 0.5 ? ease * ty.sleeve * (tube ? 0.4 : 1) : ease * (zoneK[a] + zoneK[b]) / 2, ty.rib ?? 0.015, bd), along = mix(ty.along, 0, bd);
    rest[e] = L * (1 + around * (1 - c2) + along * c2);
  }
  const cp = [], cn = [], cg = [];
  for (let c = 0; c < D.m; c++) {
    const rg = D.region[c];
    if (rg !== R.UPPERARM && rg !== R.FOREARM && rg !== R.HAND && !(rg === R.TORSO && D.armW[c] > 0.02)) continue;
    cp.push(P[c * 3], P[c * 3 + 1], P[c * 3 + 2]); cn.push(N[c * 3], N[c * 3 + 1], N[c * 3 + 2]); cg.push(gapBody);
  }
  for (const L of inner) for (let v = 0; v < L.G.length / 3; v++) {
    if (L.aw[v] < 0.05) continue;
    cp.push(L.G[v * 3], L.G[v * 3 + 1], L.G[v * 3 + 2]); cn.push(L.N[v * 3], L.N[v * 3 + 1], L.N[v * 3 + 2]); cg.push(L.gap);
  }
  const nc = cg.length, CP = Float32Array.from(cp), CN = Float32Array.from(cn), CG = Float32Array.from(cg);
  // a grid of the arm colliders (1.5 cm cells)
  const cell = 0.15 * s, key = (x, y, z) => ((Math.floor(x / cell) + 512) * 1024 + (Math.floor(y / cell) + 512)) * 1024 + (Math.floor(z / cell) + 512);
  const grid = new Map();
  for (let c = 0; c < nc; c++) { const k = key(CP[c * 3], CP[c * 3 + 1], CP[c * 3 + 2]); let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(c); }
  const near = new Array(nv), yNear = J.shoulderL[1] - 0.5 * s; // (and up by the shoulders: the trapezius, the shoulder blades)
  const gather = (X) => {
    for (let v = 0; v < nv; v++) {
      if (aw[v] < 0.08 && X[v * 3 + 1] < yNear) { near[v] = null; continue; }
      const x = X[v * 3], y = X[v * 3 + 1], z = X[v * 3 + 2], out = [];
      const ix = Math.floor(x / cell), iy = Math.floor(y / cell), iz = Math.floor(z / cell);
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) {
        const l = grid.get(((ix + a + 512) * 1024 + (iy + b + 512)) * 1024 + (iz + c + 512)); if (l) for (const i of l) out.push(i);
      }
      near[v] = out;
    }
  };
  const X = Float32Array.from(G0), Xp = Float32Array.from(G0);
  const g = 0.004 * s; // gravity: a small pull down each step (the cloth settles, it is not dropped)
  // the fit: cloth with room to spare settles onto what is under it (its weight lays it on the chest,
  // the shoulder blades, the waistband) instead of standing off it where the old shell put it; how far
  // it stays off is the fit's ease
  const roomV = Float32Array.from(zoneK, (k) => 1 + ease * 0.6 * (ty.room ?? 1) * k), pullK = 0.08;
  const pullW = new Float32Array(nv); // (not by the collar: it rests on the neck and on the collars under it)
  for (let v = 0; v < nv; v++) pullW[v] = fNeck >= 0 ? sstep(0.4 * s, 1.0 * s, Math.abs(p.vf[v * p.nf + fNeck])) : 1;
  const collide = (pull, rings = ring) => {
    for (let v = 0; v < nv; v++) {
      if (pinned[v]) continue;
      let x = X[v * 3], y = X[v * 3 + 1], z = X[v * 3 + 2];
      if (aw[v] < 0.5) { // torso: outside the rows' outlines
        const f = clamp((y - y0) / dyR, 0, NR - 1.001), r0 = Math.floor(f), t = f - r0;
        const c = mix(zc[r0], zc[r0 + 1], t), dz = z - c, rr = Math.hypot(x, dz), a = Math.atan2(x, dz);
        const rmin = mix(radiusAt(rings[r0], a), radiusAt(rings[r0 + 1], a), t) * (1 - sstep(0.3, 0.5, aw[v]));
        if (rr < rmin && rr > 1e-6) { const k = rmin / rr; X[v * 3] = x = x * k; X[v * 3 + 2] = z = c + dz * k; }
        else if (pull && rr > rmin * roomV[v] && pullW[v] > 0) { const k = 1 - (pullK * pullW[v] * (rr - rmin * roomV[v])) / rr; X[v * 3] = x = x * k; X[v * 3 + 2] = z = c + dz * k; }
      }
      if (tubeW[v] > 0) { tube.out(X, v, tubeW[v], false); x = X[v * 3]; y = X[v * 3 + 1]; z = X[v * 3 + 2]; }
      const l = near[v]; if (!l) continue;
      let best = -1, bd = Infinity;
      for (let j = 0; j < l.length; j++) {
        const c = l[j], dx = x - CP[c * 3], dy = y - CP[c * 3 + 1], dz = z - CP[c * 3 + 2], d = dx * dx + dy * dy + dz * dz;
        if (d < bd) { bd = d; best = c; }
      }
      if (best < 0) continue;
      const c = best, nx = CN[c * 3], ny = CN[c * 3 + 1], nz = CN[c * 3 + 2];
      const d = (x - CP[c * 3]) * nx + (y - CP[c * 3 + 1]) * ny + (z - CP[c * 3 + 2]) * nz;
      if (d < CG[c]) { const k = CG[c] - d; X[v * 3] += nx * k; X[v * 3 + 1] += ny * k; X[v * 3 + 2] += nz * k; }
    }
  };
  // a zip front: its two edges hang straight down, spec.zip apart (blending into the collar's shape)
  const fOpen = p.names.indexOf('open'), zipV = [], zipW = [];
  if (spec.zip && fOpen >= 0) {
    const seen = new Uint8Array(nv);
    for (const e of p.bound) for (const v of [e.a, e.b]) {
      if (seen[v] || Math.abs(p.vf[v * p.nf + fOpen]) > 0.01 || aw[v] >= 0.3) continue;
      seen[v] = 1; zipV.push(v); zipW.push(fNeck >= 0 ? sstep(0.15 * s, 0.5 * s, Math.abs(p.vf[v * p.nf + fNeck])) : 1);
    }
  }
  const zipX = (spec.zip ?? 0) * 0.5 * s;
  const zip = () => { for (let i = 0; i < zipV.length; i++) { const o = zipV[i] * 3; X[o] = mix(X[o], Math.sign(X[o]) * zipX, zipW[i]); } };
  const tmp = new Float32Array(nv * 3);
  gather(X);
  for (let step = 0; step < CLOTH_STEPS; step++) {
    for (let v = 0; v < nv; v++) {
      if (pinned[v]) continue;
      for (let k = 0; k < 3; k++) { const i = v * 3 + k, x = X[i]; X[i] += (x - Xp[i]) * 0.5; Xp[i] = x; }
      X[v * 3 + 1] -= g;
    }
    for (let it = 0; it < CLOTH_ITERS; it++) {
      for (let e = 0; e < ne; e++) {
        const a = E[e * 2] * 3, b = E[e * 2 + 1] * 3;
        const dx = X[b] - X[a], dy = X[b + 1] - X[a + 1], dz = X[b + 2] - X[a + 2];
        const L = Math.hypot(dx, dy, dz); if (L < 1e-7) continue;
        const r = rest[e], k = L > r ? 1 : 0.1, f = (k * (L - r)) / L;
        const wa = pinned[a / 3] ? 0 : 1, wb = pinned[b / 3] ? 0 : 1, ws = wa + wb; if (!ws) continue;
        X[a] += dx * f * wa / ws; X[a + 1] += dy * f * wa / ws; X[a + 2] += dz * f * wa / ws;
        X[b] -= dx * f * wb / ws; X[b + 1] -= dy * f * wb / ws; X[b + 2] -= dz * f * wb / ws;
      }
    }
    collide(true);
    // stiffness: each point a little towards its neighbours' middle (no crumpling)
    for (let v = 0; v < nv; v++) {
      let x = 0, y = 0, z = 0, c = off[v + 1] - off[v];
      for (let k = off[v]; k < off[v + 1]; k++) { const u = nb[k] * 3; x += X[u]; y += X[u + 1]; z += X[u + 2]; }
      const lam = pinned[v] || !c ? 0 : 0.12;
      tmp[v * 3] = X[v * 3] + lam * (x / c - X[v * 3]); tmp[v * 3 + 1] = X[v * 3 + 1] + lam * (y / c - X[v * 3 + 1]); tmp[v * 3 + 2] = X[v * 3 + 2] + lam * (z / c - X[v * 3 + 2]);
    }
    X.set(tmp);
    zip();
    collide();
    if (step % 12 === 11) gather(X);
  }
  // a last smoothing that does not shrink (Taubin), then out of the way once more
  taubin(X, p.adj, p.bound, 2);
  zip();
  collide();
  // the collar keeps the shell's shape (its fronts part cleanly over what is under them), blending into
  // the drape over the first few centimetres down; under a hood, the whole upper back does
  const fFront = p.names.indexOf('front');
  if (fNeck >= 0) for (let v = 0; v < nv; v++) {
    const dn = Math.abs(p.vf[v * p.nf + fNeck]), back = gm.clothHood && fFront >= 0 && p.vf[v * p.nf + fFront] > 0;
    const w = back ? sstep(1.3 * s, 2.2 * s, dn) : sstep(0.25 * s, 0.9 * s, dn);
    if (w < 1) for (let k = 0; k < 3; k++) X[v * 3 + k] = mix(G0[v * 3 + k], X[v * 3 + k], w);
  }
  collide(false, ring0); // (outside what is under it, without the spans the drape hangs on)
  // sanity: finite, and no point carried off
  let worst = 0;
  let bad = 0;
  for (let i = 0; i < X.length; i++) { if (!Number.isFinite(X[i])) { bad++; continue; } worst = Math.max(worst, Math.abs(X[i] - G0[i])); }
  gm.clothMs = performance.now() - t0; gm.clothWorst = worst / s; gm.clothBad = bad;
  if (bad) return null;
  if (worst > 1.2 * s) return null;
  return X;
}

/* ---------- a worn garment: geometry built from its patch ---------- */

class GarmentMesh {
  constructor(stage, slot, prepared, name, tuck = null) {
    this.stage = stage; this.slot = slot; this.prep = prepared; this.tuck = tuck;
    this.name = name || prepared.asset.name || '';
    this.fitKey = fitOf(prepared.asset, this.name);
    const { D, S } = stage;
    const asset = prepared.asset;
    this.sub = SPECS[prepared.sub].slot === 'shoes' ? shoeShell(prepared.asset, this.name, prepared.sub) : prepared.sub;
    this.spec = SPECS[this.sub];
    this.patch = stage.topology(this.sub, tuck ? `${prepared.length || 'full'}@${tuck}` : prepared.length);
    const p = this.patch;
    // render vertices: one per (welded vertex, group); bands per boundary edge (6 vertices)
    const key = new Map(), rv = [], rg = [], idxByGroup = [[], [], [], []];
    const isShoe = this.spec.slot === 'shoes'; // shoes: no shell from the body, the photo shoes below
    for (let t = 0; t < (isShoe ? 0 : p.nt); t++) {
      const g = p.groups[t];
      for (let e = 0; e < 3; e++) {
        const w = p.tris[t * 3 + e], k = w * 4 + g;
        let id = key.get(k); if (id === undefined) { id = rv.length; key.set(k, id); rv.push(w); rg.push(g); }
        idxByGroup[g].push(id);
      }
    }
    this.shellCount = rv.length;
    const bandStart = rv.length;
    for (const e of isShoe ? [] : p.bound) {
      const b0 = rv.length;
      for (let r = 0; r < 3; r++) { rv.push(e.a); rg.push(e.g); rv.push(e.b); rg.push(e.g); }
      // rings: (a0,b0) outer edge, (a1,b1) rounded rim, (a2,b2) inside
      const a0 = b0, bb0 = b0 + 1, a1 = b0 + 2, bb1 = b0 + 3, a2 = b0 + 4, bb2 = b0 + 5;
      idxByGroup[e.g].push(a0, a1, bb0, bb0, a1, bb1, a1, a2, bb1, bb1, a2, bb2);
    }
    this.rv = Uint32Array.from(rv); this.rg = Uint8Array.from(rg);
    this.bandStart = bandStart;
    // extras: collar rim / stand collar / hood / sole are appended by their builders
    this.extras = [];
    const extraIdx = [[], [], [], []];
    let n = rv.length;
    const addExtra = (ex) => { ex.start = n; n += ex.count; for (const [g, list] of ex.index) for (const i of list) extraIdx[g].push(i + ex.start); this.extras.push(ex); };
    if (this.spec.collar === 'rim' || this.spec.collar === 'rib') addExtra(collarRim(this, 0.05, 8));
    // jackets: a soft rolled rib along the neckline (no stiff plates standing off the shoulders)
    if (this.spec.collar === 'stand') addExtra(collarRim(this, this.spec.collarR || 0.075, 8));
    if (this.spec.collar === 'fold') addExtra(collarRim(this, 0.06, 8));
    if (this.spec.hood) addExtra(hoodPart(this));
    if (isShoe) {
      // each side of the shoe shows the photo whose toe points that way, so no logo is mirrored: seen
      // from +x the toe is on the left
      const a = prepared.asset, fl = !!a.toeLeft, hasBack = !!a.hasBack;
      const px = fl ? G_FRONT : hasBack ? G_BACK : G_FRONT, nx = fl ? (hasBack ? G_BACK : G_FRONT) : G_FRONT;
      const prof = [a.shoeProfile || defaultShoeProfile(this.sub), a.shoeProfileBack || a.shoeProfile || defaultShoeProfile(this.sub)];
      this.shoe = { px, nx, geo: prof[0], profPx: prof[px === G_FRONT ? 0 : 1], profNx: prof[nx === G_FRONT ? 0 : 1] };
      addExtra(photoShoe(this, 0)); addExtra(photoShoe(this, 1));
    }
    this.count = n;
    const geo = new THREE.BufferGeometry();
    const A = (k, c) => new THREE.BufferAttribute(new Float32Array(n * c), c);
    geo.setAttribute('position', A('p', 3)); geo.setAttribute('normal', A('n', 3)); geo.setAttribute('uv', A('uv', 2));
    geo.setAttribute('aRest', A('r', 3)); geo.setAttribute('aCoverA', A('c', 4)); geo.setAttribute('aCoverB', A('c', 1)); geo.setAttribute('aRib', A('rib', 3));
    const index = [];
    for (let g = 0; g < 4; g++) {
      const start = index.length;
      for (const i of idxByGroup[g]) index.push(i);
      for (const i of extraIdx[g]) index.push(i);
      if (index.length > start) geo.addGroup(start, index.length - start, g);
    }
    geo.setIndex(index);
    this.geo = geo;
    this.mesh = new THREE.Mesh(geo, prepared.materials);
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1 + SLOT_INDEX[slot];
    this.writeStatic();
  }

  // UVs, rest positions, rib coordinates: they only depend on the rest mesh
  writeStatic() {
    const p = this.patch, { S } = this.stage, spec = this.spec;
    const uv = this.geo.attributes.uv.array, rest = this.geo.attributes.aRest.array, rib = this.geo.attributes.aRib.array;
    const hemY = p.hem0 ?? p.hemY, top = 6.45;
    let yLo = Infinity, yHi = -Infinity;
    for (let v = 0; v < p.nv; v++) { const y = p.restP[v * 3 + 1]; if (y < yLo) yLo = y; if (y > yHi) yHi = y; }
    const uvOf = (w, g) => {
      const x = p.restP[w * 3], y = p.restP[w * 3 + 1], z = p.restP[w * 3 + 2];
      if (spec.slot === 'shoes') {
        const ft = S.foot[x >= 0 ? 0 : 1];
        return [clamp((z - ft.heel) / (ft.toe - ft.heel), 0, 1), clamp((y - S.floorY) / (spec.collar * 1.04), 0, 1)];
      }
      if (spec.slot === 'bottoms') {
        const yH = yLo;
        const lean = sstep(S.crotchY + 0.3, S.crotchY - 1.5, y) * ((S.hipX + (S.ankleX - S.hipX) * clamp((S.J.hipL[1] - y) / (S.J.hipL[1] - S.J.ankleL[1]), 0, 1)) - S.hipX) * 0.9;
        const xs = x - Math.sign(x) * lean, hw = 1.95;
        const u = 0.5 + 0.5 * clamp(xs / hw, -1, 1);
        // the photo's crotch (where its legs part) lands on the pants' crotch seam, not on the thighs
        const ySeamR = S.crotchY - (0.16 + 0.2 * baggyOf(this.fitKey)), vc = clamp(this.prep.asset.crotchV ?? 0.72, 0.55, 0.85);
        const v = y >= ySeamR ? mix(vc, 1, clamp((y - ySeamR) / (yHi - ySeamR), 0, 1)) : mix(0, vc, clamp((y - yH) / (ySeamR - yH), 0, 1));
        return [g === G_FRONT ? u : 1 - u, v];
      }
      const hw = Math.max(0.4, S.rowVal(S.halfW, y));
      const v = clamp((y - hemY) / (top - hemY), 0, 1);
      let u;
      if (spec.open && g === G_FRONT) {
        const gO = openAt(spec, y);
        u = x < 0 ? 0.5 * clamp((x + hw) / Math.max(0.1, hw - gO), 0, 1) : 0.5 + 0.5 * clamp((x - gO) / Math.max(0.1, hw - gO), 0, 1);
      } else u = 0.5 + 0.5 * clamp(x / hw, -1, 1);
      return [g === G_FRONT ? u : 1 - u, v];
    };
    for (let i = 0; i < this.rv.length; i++) {
      const w = this.rv[i], g = this.rg[i];
      const [u, v] = uvOf(w, g);
      uv[i * 2] = u; uv[i * 2 + 1] = v;
      rest[i * 3] = p.restP[w * 3]; rest[i * 3 + 1] = p.restP[w * 3 + 1]; rest[i * 3 + 2] = p.restP[w * 3 + 2];
      // ribs run across hems and cuffs
      const x = p.restP[w * 3], y = p.restP[w * 3 + 1], z = p.restP[w * 3 + 2];
      if (p.armW[w] > 0.5) {
        const L = x >= 0, J = S.J, A = L ? J.elbowL : J.elbowR, Bw = L ? J.wristL : J.wristR;
        const ax = norm3(sub3(Bw, A)), rel = sub3([x, y, z], A);
        const ref = norm3(cross3(ax, [0, 0, 1])), ref2 = cross3(ax, ref);
        const a = Math.atan2(dot3(rel, ref2), dot3(rel, ref));
        rib[i * 3] = Math.cos(a); rib[i * 3 + 1] = Math.sin(a); rib[i * 3 + 2] = 26;
      } else {
        const a = Math.atan2(x, z - S.rowVal(S.zc, y));
        rib[i * 3] = Math.cos(a); rib[i * 3 + 1] = Math.sin(a); rib[i * 3 + 2] = 90;
      }
    }
    for (const ex of this.extras) ex.writeStatic?.(ex, this);
    this.geo.attributes.uv.needsUpdate = true; this.geo.attributes.aRest.needsUpdate = true; this.geo.attributes.aRib.needsUpdate = true;
  }

  // Positions and normals for the current body and final height field.
  update(B, hFinal, targets, drape, inner) {
    if (this.spec.slot === 'shoes') { // the photo shoes; their points are what the pants hang over
      for (const ex of this.extras) ex.update(ex, this, B);
      const pos = this.geo.attributes.position.array, pts = [];
      for (const ex of this.extras) for (let j = 0; j < ex.nUpper; j++) { const i = (ex.start + j) * 3; pts.push(pos[i], pos[i + 1], pos[i + 2]); }
      this.G = Float32Array.from(pts);
      this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true; this.geo.attributes.aRest.needsUpdate = true;
      this.geo.computeBoundingSphere();
      return;
    }
    const p = this.patch, nv = p.nv;
    const Pw = interp(p, targets ? targets.T : B.P, 3), Nw = interp(p, B.Dir, 3); normalize3(Nw);
    if (targets) { // each of the garment's own vertices exactly on the slices (an average of points on a convex slice is inside it)
      const Pb = interp(p, B.P, 3);
      for (let v = 0; v < nv; v++) targets.place(Pb[v * 3], Pb[v * 3 + 1], Pb[v * 3 + 2], Pw, v * 3);
      targets.relax?.(Pw, p.adj, nv, p.bound);
    }
    const hw = targets ? new Float32Array(nv) : interp(p, hFinal, 1);
    const spec = this.spec, s = B.s;
    // folds where the cloth gathers (elbows of long sleeves; the pants make their own)
    if (targets) {
      // nothing: the slices are already shaped
    } else if (spec.slot === 'bottoms' && spec.skin) {
      // leggings: no folds
    } else if (spec.slot === 'bottoms') {
      const fit = FIT[this.fitKey] ?? 1, stack = clamp((fit - 0.8) / 1.2, 0, 1);
      for (let v = 0; v < nv; v++) {
        const t = p.legT[v]; if (p.legW[v] < 0.4) continue;
        const x = p.restP[v * 3], z = p.restP[v * 3 + 2], phi = Math.atan2(x, z);
        const knee = Math.exp(-(((t - 0.47) / 0.07) ** 2)) * (0.5 + 0.5 * Math.sin(t * 95 + phi * 2.0));
        const ank = sstep(0.8, 0.98, t) * (0.5 + 0.5 * Math.sin(t * 120 + phi * 1.3 + Math.sin(phi * 3) * 0.8));
        hw[v] += s * (0.025 * knee * (0.6 + stack) + 0.05 * ank * (0.3 + stack));
      }
    } else if (spec.sleeve > 0.6) {
      for (let v = 0; v < nv; v++) {
        if (p.armW[v] < 0.5) continue;
        const t = p.armT[v], x = p.restP[v * 3];
        // the elbow's crease: a few folds on the crook (the front of the bent arm), none on the back
        const crook = sstep(-0.1, 0.6, Nw[v * 3 + 2]);
        const el = Math.exp(-(((t - 0.5) / 0.07) ** 2)) * (0.5 + 0.5 * Math.sin(t * 130 + x * 4)) * crook;
        const lo = sstep(0.66, 0.86, t) * (0.5 + 0.5 * Math.sin(t * 80 + x * 9)) * (spec.cuff ? 0.6 : 0.3);
        hw[v] += s * (0.04 * el + 0.02 * lo) - s * 0.012 * Math.exp(-(((t - 0.5) / 0.05) ** 2)) * crook;
        // soft rolls where the sleeve is gathered into its cuff
        if (spec.cuffRolls) { const ce = spec.sleeve - spec.cuff; hw[v] += spec.cuffRolls * s * Math.max(0, Math.sin(((ce - t) / 0.045) * Math.PI + x * 3)) ** 1.5 * sstep(ce + 0.005, ce - 0.015, t) * sstep(ce - 0.16, ce - 0.1, t); }
      }
    }
    const G = new Float32Array(nv * 3);
    for (let v = 0; v < nv; v++) for (let k = 0; k < 3; k++) G[v * 3 + k] = Pw[v * 3 + k] + Nw[v * 3 + k] * hw[v];
    // round the facets (Taubin: smooth without shrinking); boundary vertices only along the boundary
    if (!targets && !spec.skin) taubin(G, p.adj, p.bound, 2); // (leggings follow the skin as it is)
    if (drape) { // the torso part on its convex slices
      const Pb = interp(p, B.P, 3), T = new Float32Array(3);
      for (let v = 0; v < nv; v++) {
        const w = drape.weight(Pb[v * 3 + 1], p.armW[v]); if (w <= 0) continue;
        drape.place(Pb[v * 3], Pb[v * 3 + 1], Pb[v * 3 + 2], T, 0);
        for (let k = 0; k < 3; k++) G[v * 3 + k] = mix(G[v * 3 + k], T[k], w);
      }
    }
    // then the cloth falls into place (tops, layers, jackets)
    this.clothMs = 0;
    if (inner && !targets) {
      // once per (body, piece, what is under it): wearing shoes or turning doesn't drape it again
      const cache = this.stage.clothCache, ck = this.clothKey;
      let X = ck ? cache.get(ck) : undefined;
      if (X === undefined) {
        X = clothSolve(this, B, G, inner);
        if (ck) { cache.set(ck, X); if (cache.size > 32) cache.delete(cache.keys().next().value); }
      } else this.clothMs = 0;
      this.clothed = !!X; if (X) G.set(X);
    }
    this.stamp = (this.stamp || 0) + 1;
    const Nf = vertexNormals(G, p.tris, new Float32Array(nv * 3));
    this.G = G; this.Nf = Nf; this.hw = hw; this.Nw = Nw; this.Pw = Pw;
    const pos = this.geo.attributes.position.array, nor = this.geo.attributes.normal.array;
    for (let i = 0; i < this.shellCount; i++) {
      const w = this.rv[i];
      pos[i * 3] = G[w * 3]; pos[i * 3 + 1] = G[w * 3 + 1]; pos[i * 3 + 2] = G[w * 3 + 2];
      nor[i * 3] = Nf[w * 3]; nor[i * 3 + 1] = Nf[w * 3 + 1]; nor[i * 3 + 2] = Nf[w * 3 + 2];
    }
    // hem bands: outer edge, a rounded rim, the inside
    const th = (spec.thick ?? 0.04) * s;
    let i = this.bandStart;
    for (const e of p.bound) {
      const out = bandOut(G, Nf, e);
      for (let r = 0; r < 3; r++) {
        for (const v of [e.a, e.b]) {
          const n = [Nf[v * 3], Nf[v * 3 + 1], Nf[v * 3 + 2]];
          const g = [G[v * 3], G[v * 3 + 1], G[v * 3 + 2]];
          let q, nn;
          if (r === 0) { q = g; nn = n; }
          else if (r === 1) { q = g.map((c, k) => c + out[k] * th * 0.55 - n[k] * th * 0.5); nn = out; }
          else { q = g.map((c, k) => c - n[k] * th); nn = n.map((c) => -c); }
          pos[i * 3] = q[0]; pos[i * 3 + 1] = q[1]; pos[i * 3 + 2] = q[2];
          nor[i * 3] = nn[0]; nor[i * 3 + 1] = nn[1]; nor[i * 3 + 2] = nn[2];
          i++;
        }
      }
    }
    for (const ex of this.extras) ex.update(ex, this, B);
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.normal.needsUpdate = true;
    this.geo.computeBoundingSphere();
  }

  // inside-distances of the outer slots, for the "covered, so not drawn" test
  writeCover(depths) {
    const p = this.patch, a = this.geo.attributes.aCoverA.array, b = this.geo.attributes.aCoverB.array;
    const per = SLOTS.map((s) => (depths[s] ? interp(p, depths[s], 1) : null));
    for (let i = 0; i < this.rv.length; i++) {
      const w = this.rv[i];
      for (let k = 0; k < 4; k++) a[i * 4 + k] = per[k] ? per[k][w] : -9;
      b[i] = per[4] ? per[4][w] : -9;
    }
    for (const ex of this.extras) for (let j = 0; j < ex.count; j++) { const i = ex.start + j; for (let k = 0; k < 4; k++) a[i * 4 + k] = -9; b[i] = -9; }
    this.geo.attributes.aCoverA.needsUpdate = true; this.geo.attributes.aCoverB.needsUpdate = true;
  }

  dispose() { this.geo.dispose(); }
}

function bandOut(G, N, e) {
  const a = e.a * 3, b = e.b * 3, c = e.c * 3;
  const t = [G[b] - G[a], G[b + 1] - G[a + 1], G[b + 2] - G[a + 2]];
  const n = [(N[a] + N[b]) / 2, (N[a + 1] + N[b + 1]) / 2, (N[a + 2] + N[b + 2]) / 2];
  let o = norm3(cross3(t, n));
  const mid = [(G[a] + G[b]) / 2 - G[c], (G[a + 1] + G[b + 1]) / 2 - G[c + 1], (G[a + 2] + G[b + 2]) / 2 - G[c + 2]];
  if (dot3(o, mid) < 0) o = o.map((v) => -v);
  return o;
}

function taubin(G, adj, bound, iters) {
  const n = G.length / 3, { off, nb } = adj;
  const onB = new Uint8Array(n), bn = new Map();
  for (const e of bound) { onB[e.a] = 1; onB[e.b] = 1; (bn.get(e.a) || bn.set(e.a, []).get(e.a)).push(e.b); (bn.get(e.b) || bn.set(e.b, []).get(e.b)).push(e.a); }
  const tmp = new Float32Array(G.length);
  const pass = (lam) => {
    for (let v = 0; v < n; v++) {
      let x = 0, y = 0, z = 0, c = 0;
      const list = onB[v] ? bn.get(v) : null;
      if (list) for (const u of list) { x += G[u * 3]; y += G[u * 3 + 1]; z += G[u * 3 + 2]; c++; }
      else for (let k = off[v]; k < off[v + 1]; k++) { const u = nb[k]; x += G[u * 3]; y += G[u * 3 + 1]; z += G[u * 3 + 2]; c++; }
      if (!c) { tmp[v * 3] = G[v * 3]; tmp[v * 3 + 1] = G[v * 3 + 1]; tmp[v * 3 + 2] = G[v * 3 + 2]; continue; }
      tmp[v * 3] = G[v * 3] + lam * (x / c - G[v * 3]);
      tmp[v * 3 + 1] = G[v * 3 + 1] + lam * (y / c - G[v * 3 + 1]);
      tmp[v * 3 + 2] = G[v * 3 + 2] + lam * (z / c - G[v * 3 + 2]);
    }
    G.set(tmp);
  };
  for (let i = 0; i < iters; i++) { pass(0.5); pass(-0.53); }
}

/* ---------- extras: collars, hood, soles ---------- */

// Boundary loop of a patch near the neck (ordered), as welded vertex ids.
function neckLoop(gm) {
  const p = gm.patch, k = p.names.indexOf('neck');
  const on = (v) => Math.abs(p.vf[v * p.nf + k]) < 0.02;
  return orderLoop(p.bound.filter((e) => on(e.a) && on(e.b)));
}
function orderLoop(edges) {
  if (!edges.length) return { ids: [], closed: false };
  const next = new Map(), prev = new Map();
  for (const e of edges) { next.set(e.a, e.b); prev.set(e.b, e.a); }
  // start at an open end if there is one
  let start = edges[0].a;
  for (const e of edges) if (!prev.has(e.a)) { start = e.a; break; }
  const ids = [start]; const seen = new Set([start]);
  let v = start;
  while (next.has(v) && !seen.has(next.get(v))) { v = next.get(v); ids.push(v); seen.add(v); }
  const closed = next.get(v) === start;
  return { ids, closed };
}

// A knit rim around the neckline (tee, sweater): a small tube along the loop.
function collarRim(gm, radius, seg) {
  const loop = neckLoop(gm);
  const L = loop.ids.length, count = L * seg;
  const idx = [];
  const segs = loop.closed ? L : L - 1;
  for (let i = 0; i < segs; i++) for (let k = 0; k < seg; k++) {
    const a = i * seg + k, b = ((i + 1) % L) * seg + k, c = i * seg + ((k + 1) % seg), d = ((i + 1) % L) * seg + ((k + 1) % seg);
    idx.push(a, b, c, c, b, d);
  }
  return {
    count, index: [[G_TRIM, idx]], loop,
    writeStatic(ex, g) {
      const rest = g.geo.attributes.aRest.array, rib = g.geo.attributes.aRib.array;
      for (let i = 0; i < L; i++) for (let k = 0; k < seg; k++) {
        const w = ex.loop.ids[i], j = ex.start + i * seg + k;
        for (let c = 0; c < 3; c++) rest[j * 3 + c] = g.patch.restP[w * 3 + c];
        const a = (i / L) * Math.PI * 2; rib[j * 3] = Math.cos(a); rib[j * 3 + 1] = Math.sin(a); rib[j * 3 + 2] = 70;
      }
    },
    update(ex, g, B) {
      const pos = g.geo.attributes.position.array, nor = g.geo.attributes.normal.array, G = g.G, N = g.Nf;
      const r = radius * B.s;
      for (let i = 0; i < L; i++) {
        const w = ex.loop.ids[i], wp = ex.loop.ids[(i + L - 1) % L], wn = ex.loop.ids[(i + 1) % L];
        const t = norm3([G[wn * 3] - G[wp * 3], G[wn * 3 + 1] - G[wp * 3 + 1], G[wn * 3 + 2] - G[wp * 3 + 2]]);
        const n = [N[w * 3], N[w * 3 + 1], N[w * 3 + 2]];
        const bvec = norm3(cross3(t, n)), nn = cross3(bvec, t);
        const c = [G[w * 3] + nn[0] * r * 0.55, G[w * 3 + 1] + nn[1] * r * 0.55 + r * 0.3, G[w * 3 + 2] + nn[2] * r * 0.55];
        for (let k = 0; k < seg; k++) {
          const a = (k / seg) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
          const d = [nn[0] * ca + bvec[0] * sa, nn[1] * ca + bvec[1] * sa, nn[2] * ca + bvec[2] * sa];
          const j = ex.start + i * seg + k;
          pos[j * 3] = c[0] + d[0] * r; pos[j * 3 + 1] = c[1] + d[1] * r * 1.25; pos[j * 3 + 2] = c[2] + d[2] * r;
          nor[j * 3] = d[0]; nor[j * 3 + 1] = d[1]; nor[j * 3 + 2] = d[2];
        }
      }
    },
  };
}

// How far a draped piece reaches out around the torso, per torso row and bin (what the hood lies on).
function backReach(g, env, S) {
  if (g.reach && g.reachStamp === g.stamp) return g.reach;
  const G = g.G, aw = g.patch.armW, yc = env.torso.yc, zc = env.torso.zc, rows = S.rows;
  const A = g.reach && g.reach.length === rows * TB ? g.reach.fill(0) : new Float32Array(rows * TB);
  for (let v = 0; v < G.length / 3; v++) {
    if (aw[v] > 0.3) continue;
    const x = G[v * 3], y = G[v * 3 + 1];
    let lo = 0, hi = rows - 1; // (the rows' heights go up with the row)
    if (y < yc[0] - 0.05 || y > yc[rows - 1] + 0.05) continue;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (yc[m] <= y) lo = m; else hi = m; }
    const r = y - yc[lo] < yc[hi] - y ? lo : hi, dz = G[v * 3 + 2] - zc[r];
    const b = clamp(Math.floor(((Math.atan2(x, dz) + Math.PI) / (2 * Math.PI)) * TB), 0, TB - 1), R = Math.hypot(x, dz);
    if (R > A[r * TB + b]) A[r * TB + b] = R;
  }
  g.reach = A; g.reachStamp = g.stamp;
  return A;
}

// The hood of a hoodie, down: a thick pillow of cloth on the upper back with a roll behind the neck,
// thinning out towards the shoulders. It rides over a jacket when one is worn (lift follows the
// jacket's fade).
function hoodPart(gm) {
  const NU = 19, NV = 11, count = NU * NV;
  const idx = [];
  for (let i = 0; i + 1 < NU; i++) for (let r = 0; r + 1 < NV; r++) {
    const a = i * NV + r, b = (i + 1) * NV + r;
    idx.push(a, a + 1, b, b, a + 1, b + 1);
  }
  // (it ends in a round lobe high on the shoulder blades, above any back print: no V pointing into it)
  const SPAN = 66 * D2R, Y0 = 6.86, Y1 = 5.78;
  const at = (i, r) => {
    const u = i / (NU - 1), v = r / (NV - 1);
    // v: 0 the rolled top edge (tucked in), 0.1 the roll, then down the back to the rounded point;
    // the hood narrows as it hangs (a shield shape, not a slab)
    const w = Math.max(0, v - 0.1) / 0.9, narrow = 1 - 0.42 * Math.pow(w, 2.2);
    const uc = u - 0.5, y = mix(Y0, Y1, w * (1 - 0.35 * (2 * Math.abs(uc)) ** 2 * w));
    return { u, v, th: Math.PI + uc * 2 * SPAN * narrow, y: y + (v < 0.1 ? 0.05 : 0) };
  };
  return {
    count, index: [[G_FABRIC, idx]], lift: 0,
    writeStatic(ex, g) {
      const rest = g.geo.attributes.aRest.array;
      for (let i = 0; i < NU; i++) for (let r = 0; r < NV; r++) {
        const q = at(i, r), j = ex.start + i * NV + r;
        rest[j * 3] = Math.sin(q.th) * 1.2; rest[j * 3 + 1] = q.y; rest[j * 3 + 2] = Math.cos(q.th) * 1.0;
      }
    },
    update(ex, g, B) {
      const st = g.stage, S = st.S, env = st.env; if (!env) return;
      const pos = g.geo.attributes.position.array, nor = g.geo.attributes.normal.array;
      const s = B.s, lift = (ex.lift || 0) * s;
      const neckRow = S.rowOf(6.45);
      // over a draped jacket it lies on the jacket's back as it is (a few millimetres out), not at a
      // fixed lift that the drape may pass
      const jg = st.worn.jacket, k = jg?.clothed ? clamp((ex.lift || 0) / 0.2, 0, 1) : 0, reach = k > 0 ? backReach(jg, env, S) : null;
      const pts = [];
      for (let i = 0; i < NU; i++) for (let r = 0; r < NV; r++) {
        const q = at(i, r), rowF = S.rowOf(q.y);
        let R0 = sampleGrid(env.torso.hull, TB, S.rows, rowF, q.th);
        if (q.y > 6.45) R0 = Math.max(R0, sampleGrid(env.torso.hull, TB, S.rows, neckRow, q.th) * 0.97);
        const zc = sampleRow(env.torso.zc, Math.min(rowF, neckRow)), yc = sampleRow(env.torso.yc, rowF);
        const side = Math.pow(Math.sin(Math.PI * q.u), 0.8);
        const w = (q.v - 0.1) / 0.9;
        const prof = q.v < 0.1 ? 0.35 + 0.65 * Math.sin((Math.PI / 2) * q.v / 0.1) : r === NV - 1 ? 0 : 1 - 0.7 * Math.pow(w, 1.4);
        const T = 0.3 * side * prof * s;
        let R = R0 + 0.13 * s + lift + T;
        if (reach) {
          const bf = ((((q.th + Math.PI) / (2 * Math.PI)) * TB) % TB + TB) % TB, b = Math.floor(bf), r0 = Math.floor(rowF);
          let Rj = 0;
          for (let rr = r0 - 1; rr <= r0 + 2; rr++) if (rr >= 0 && rr < S.rows) for (let db = -1; db <= 1; db++) Rj = Math.max(Rj, reach[rr * TB + ((b + db + TB) % TB)]);
          if (Rj > 0) R = Math.max(R, R0 + 0.13 * s + T + k * (Rj + 0.04 * s - R0 - 0.13 * s));
        }
        pts.push([Math.sin(q.th) * R, yc + (q.v < 0.1 ? 0.0 : 0), zc + Math.cos(q.th) * R]);
      }
      for (let i = 0; i < NU; i++) for (let r = 0; r < NV; r++) {
        const P0 = pts[i * NV + r];
        const Pi = pts[Math.min(NU - 1, i + 1) * NV + r], Pm = pts[Math.max(0, i - 1) * NV + r];
        const Pr = pts[i * NV + Math.min(NV - 1, r + 1)], Pq = pts[i * NV + Math.max(0, r - 1)];
        let n = norm3(cross3(sub3(Pi, Pm), sub3(Pr, Pq)));
        if (n[0] * P0[0] + n[2] * (P0[2] - B.J.neck[2]) < 0) n = n.map((v) => -v);
        const j = ex.start + i * NV + r;
        pos[j * 3] = P0[0]; pos[j * 3 + 1] = P0[1]; pos[j * 3 + 2] = P0[2];
        nor[j * 3] = n[0]; nor[j * 3 + 1] = n[1]; nor[j * 3 + 2] = n[2];
      }
    },
  };
}

/* ---------- shoes: built from the photo's outline ---------- */

const SHOE_NS = 56, SHOE_NR = 40, SOLE_NR = 24;
// How tall a shoe may be for its length (a three-quarter photo looks taller than the shoe is).
const SHOE_ASPECT = { sneakers: [0.27, 0.37], hightop: [0.33, 0.43], boots: [0.5, 0.72] };
// The sole (decimetres at the heel and at the toe) and how far it sticks out of the upper.
const SHOE_SOLE = { sneakers: [0.29, 0.19, 0.045], hightop: [0.3, 0.2, 0.045], boots: [0.36, 0.29, 0.06] };
// An outline for shoes baked before the baker recorded one.
function defaultShoeProfile(sub) {
  const N = 48, collar = sub === 'boots' ? 0.97 : sub === 'hightop' ? 0.9 : 0.78;
  const top = [], bot = [];
  for (let i = 0; i < N; i++) {
    const u = (i + 0.5) / N;
    top.push(u < 0.42 ? mix(collar * 0.92, collar, sstep(0, 0.12, u)) : mix(collar, 0.36, sstep(0.42, 0.97, u)));
    bot.push(0.05 * sstep(0.8, 1, u) + 0.02 * sstep(0.05, 0, u));
  }
  return { top, bot, aspect: sub === 'boots' ? 0.62 : sub === 'hightop' ? 0.42 : 0.35 };
}
const profAt = (arr, u) => { // the outline at u (0 heel, 1 toe) between the column centres
  const N = arr.length, f = clamp(u * N - 0.5, 0, N - 1), i = Math.min(N - 2, Math.floor(f)), t = f - i;
  return arr[i] * (1 - t) + arr[i + 1] * t;
};
// One foot's shoe: the photo's side outline lofted round the foot. Rings across the foot from heel
// to toe, each a rounded box as tall as the outline at that point and as wide as the foot there;
// the top over the ankle dips into the collar, and a sole in the sole's colour runs under it.
function photoShoe(gm, foot) {
  const NS = SHOE_NS, NR = SHOE_NR, H2 = NR / 2 + 1, perS = 2 * H2;
  const nUpper = NS * perS, nSole = NS * SOLE_NR;
  const { px, nx } = gm.shoe;
  const listA = [], listB = [], listS = [];
  for (let j = 0; j < NS - 1; j++) for (let k = 0; k < NR; k++) {
    // two halves: k 0..NR/2 (+x side) and NR/2..NR (-x side), each with its own copy of the seam
    const half = k < NR / 2 ? 0 : 1, kk = half ? k - NR / 2 : k, L = half ? listB : listA;
    const v = (jj, q) => jj * perS + half * H2 + q;
    const a = v(j, kk), b = v(j, kk + 1), c = v(j + 1, kk), d = v(j + 1, kk + 1);
    L.push(a, b, c, c, b, d);
  }
  for (let j = 0; j < NS - 1; j++) for (let k = 0; k < SOLE_NR; k++) {
    const k1 = (k + 1) % SOLE_NR, v = (jj, q) => nUpper + jj * SOLE_NR + q;
    listS.push(v(j, k), v(j, k1), v(j + 1, k), v(j + 1, k), v(j, k1), v(j + 1, k1));
  }
  // a welded copy of the upper for its normals
  const weld = [];
  for (let j = 0; j < NS - 1; j++) for (let k = 0; k < NR; k++) {
    const a = j * NR + k, b = j * NR + ((k + 1) % NR), c = a + NR, d = b + NR;
    weld.push(a, b, c, c, b, d);
  }
  const soleIdx = listS.map((i) => i - nUpper);
  const ringU = new Float32Array(NR), ringY = new Float32Array(NR), ringX = new Float32Array(NR);
  for (let k = 0; k < NR; k++) { const ph = (k / NR) * 2 * Math.PI; ringX[k] = Math.sin(ph); ringY[k] = -Math.cos(ph); }
  return {
    count: nUpper + nSole, nUpper, foot,
    index: [[px, listA], [nx, listB], [G_TRIM, listS]],
    writeStatic() {},
    update(ex, g, B) {
      const pos = g.geo.attributes.position.array, nor = g.geo.attributes.normal.array, uv = g.geo.attributes.uv.array, rest = g.geo.attributes.aRest.array;
      const { D } = g.stage, P = B.P, s = B.s, J = B.J;
      const isL = foot === 0, pick = (a, b) => ((a[0] >= 0) === isL ? a : b);
      const ank = pick(J.ankleL, J.ankleR), toeJ = pick(J.toeL, J.toeR);
      let dx = toeJ[0] - ank[0], dz = toeJ[2] - ank[2]; const dl = Math.hypot(dx, dz) || 1; dx /= dl; dz /= dl;
      const ex_ = dz, ez = -dx; // across the foot, towards +x
      const sub = g.sub, prof = g.shoe.geo, lim = SHOE_ASPECT[sub] || SHOE_ASPECT.sneakers, so = SHOE_SOLE[sub] || SHOE_SOLE.sneakers;
      // the foot along its length and across, from the ankle
      const mine = (c) => (D.rest[c * 3] >= 0) === isL;
      let aMin = Infinity, aMax = -Infinity;
      for (let c = 0; c < D.m; c++) if (D.region[c] === R.FOOT && mine(c)) {
        const a = (P[c * 3] - ank[0]) * dx + (P[c * 3 + 2] - ank[2]) * dz;
        if (a < aMin) aMin = a; if (a > aMax) aMax = a;
      }
      const heelA = aMin - 0.09 * s, Ls = aMax + 0.16 * s - heelA;
      const Hs = clamp(prof.aspect || 0.4, lim[0], lim[1]) * Ls;
      // the outline (smoothed a little) at each ring
      const yt = new Float32Array(NS), yb = new Float32Array(NS), sh = new Float32Array(NS);
      for (let j = 0; j < NS; j++) {
        const u = j / (NS - 1);
        // (the top smoothed more over the laces: their loops would roll the top into bumps)
        let t = 0, b = 0, n = 0, nt = 0;
        const span = mix(0.012, 0.035, sstep(0.3, 0.5, u) * sstep(0.95, 0.8, u));
        for (let q = -3; q <= 3; q++) { const wq = 4 - Math.abs(q); t += wq * profAt(prof.top, clamp(u + (q / 3) * span, 0, 1)); nt += wq; }
        for (const du of [-0.012, 0, 0.012]) { b += profAt(prof.bot, clamp(u + du, 0, 1)); n++; }
        t = (t / nt) * n;
        sh[j] = mix(so[0], so[1], sstep(0.25, 0.85, u)) * s;
        yb[j] = Math.max(0, (b / n) * Hs);
        yt[j] = Math.max((t / n) * Hs, yb[j] + sh[j] + 0.1 * s);
      }
      // the collar: where the leg goes in (its front and back at the collar's height)
      let yc = 0; for (let j = 0; j < NS * 0.5; j++) yc = Math.max(yc, yt[j]);
      let l0 = Infinity, l1 = -Infinity;
      for (let c = 0; c < D.m; c++) if (D.region[c] === R.SHIN && mine(c) && Math.abs(P[c * 3 + 1] - (yc - 0.1 * s)) < 0.25 * s) {
        const a = (P[c * 3] - ank[0]) * dx + (P[c * 3 + 2] - ank[2]) * dz;
        if (a < l0) l0 = a; if (a > l1) l1 = a;
      }
      const u0 = Number.isFinite(l0) ? (l0 - heelA) / Ls : 0.06, u1 = Number.isFinite(l1) ? (l1 - heelA) / Ls : 0.42;
      // (open right from the heel's back wall)
      const openAt = (u) => sstep(u1 + 0.07, u1 - 0.01, u);
      // how wide: the foot and the ankle at each ring, and a little room
      const wl = new Float32Array(NS).fill(-1), wr = new Float32Array(NS).fill(-1);
      for (let c = 0; c < D.m; c++) {
        const rg = D.region[c]; if ((rg !== R.FOOT && rg !== R.SHIN) || !mine(c)) continue;
        const qx = P[c * 3] - ank[0], qz = P[c * 3 + 2] - ank[2], a = qx * dx + qz * dz, l = qx * ex_ + qz * ez;
        const j = Math.round(((a - heelA) / Ls) * (NS - 1)); if (j < 0 || j >= NS || P[c * 3 + 1] > yt[j]) continue;
        if (l > wr[j]) wr[j] = l; if (-l > wl[j]) wl[j] = -l;
      }
      for (const w of [wl, wr]) {
        for (let j = 0; j < NS; j++) if (w[j] < 0) { let a = j, b = j; while (a >= 0 && w[a] < 0) a--; while (b < NS && w[b] < 0) b++; w[j] = a >= 0 && b < NS ? (w[a] + w[b]) / 2 : a >= 0 ? w[a] : b < NS ? w[b] : 0.4 * s; }
        // the widest over a few rings (the foot's vertices are sparse), then smooth: no ripples along the side
        const t0 = Float32Array.from(w);
        for (let j = 0; j < NS; j++) { let m = 0; for (let q = Math.max(0, j - 3); q <= Math.min(NS - 1, j + 3); q++) m = Math.max(m, t0[q]); w[j] = m; }
        for (let it = 0; it < 12; it++) { const t = Float32Array.from(w); for (let j = 1; j < NS - 1; j++) w[j] = (t[j - 1] + 2 * t[j] + t[j + 1]) / 4; }
        for (let j = 0; j < NS; j++) w[j] += 0.055 * s;
      }
      // round in plan: a half circle at the heel, a longer curve at the toe
      const capAt = (u) => Math.max(0.03, Math.sqrt(Math.max(0, 1 - (1 - Math.min(1, u / 0.12)) ** 2)) * Math.sqrt(Math.max(0, 1 - (1 - Math.min(1, (1 - u) / 0.2)) ** 2)));
      const put = (i, a, l, y) => { const o = i * 3; pos[o] = ank[0] + dx * a + ex_ * l; pos[o + 1] = y; pos[o + 2] = ank[2] + dz * a + ez * l; };
      // the upper (welded, for the normals), then copied to its two halves
      const W = new Float32Array(NS * NR * 3), T = new Float32Array(NS * NR);
      for (let j = 0; j < NS; j++) {
        const u = j / (NS - 1), a = heelA + u * Ls, cap = capAt(u), op = openAt(u);
        // a rounded box: upright sides to a third of the upper's height, then a rounded top (rounder
        // over the toe)
        const yM = yb[j] + sh[j] + 0.3 * Math.max(0, yt[j] - yb[j] - sh[j]), nT = mix(3.6, 2.6, sstep(0.62, 0.97, u)), nB = 6;
        const rec = Math.min(0.24 * s, 0.6 * (yt[j] - yM)) * op;
        let ymax = -Infinity;
        for (let k = 0; k < NR; k++) {
          const cx = ringX[k], cy = ringY[k], n = cy >= 0 ? nT : nB;
          const X = Math.sign(cx) * Math.abs(cx) ** (2 / n), Y = Math.sign(cy) * Math.abs(cy) ** (2 / n);
          const l = X * (X >= 0 ? wr[j] : wl[j]) * cap;
          let y = Y >= 0 ? yM + Y * (yt[j] - yM) : yM + Y * (yM - yb[j]);
          T[j * NR + k] = clamp((y - yb[j]) / Math.max(1e-4, yt[j] - yb[j]), 0, 1);
          if (Y > 0) y -= rec * (1 - Math.abs(X) ** 6);
          W[(j * NR + k) * 3] = a; W[(j * NR + k) * 3 + 1] = y; W[(j * NR + k) * 3 + 2] = l;
          if (y > ymax) ymax = y;
        }
        // the collar's lip stays on the outline's top
        if (ymax > yM + 1e-4) for (let k = 0; k < NR; k++) { const o = (j * NR + k) * 3 + 1; if (W[o] > yM) W[o] = yM + (W[o] - yM) * ((yt[j] - yM) / (ymax - yM)); }
      }
      const Pw = new Float32Array(NS * NR * 3);
      for (let i = 0; i < NS * NR; i++) {
        const a = W[i * 3], y = W[i * 3 + 1], l = W[i * 3 + 2];
        Pw[i * 3] = ank[0] + dx * a + ex_ * l; Pw[i * 3 + 1] = y; Pw[i * 3 + 2] = ank[2] + dz * a + ez * l;
      }
      const Nw = vertexNormals(Pw, weld, new Float32Array(NS * NR * 3));
      const pA = g.shoe.profPx, pB = g.shoe.profNx;
      for (let j = 0; j < NS; j++) {
        const u = j / (NS - 1);
        for (let half = 0; half < 2; half++) {
          const pr = half ? pB : pA, top = profAt(pr.top, u), bot = profAt(pr.bot, u);
          for (let q = 0; q < H2; q++) {
            const k = (half * (NR / 2) + q) % NR, w = j * NR + k, i = ex.start + j * perS + half * H2 + q;
            for (let c = 0; c < 3; c++) { pos[i * 3 + c] = Pw[w * 3 + c]; nor[i * 3 + c] = Nw[w * 3 + c]; rest[i * 3 + c] = Pw[w * 3 + c] / s; }
            // the photo of this side, each column's height on the shoe's own height there
            uv[i * 2] = clamp(u, 0.035, 0.975); uv[i * 2 + 1] = clamp(mix(bot, top, T[w]), bot + 0.01, top - 0.012);
          }
        }
      }
      // the sole: a rounded slab a little wider and longer than the upper, flat on the floor
      const ov = so[2] * s, Sp = new Float32Array(nSole * 3);
      for (let j = 0; j < NS; j++) {
        const u = j / (NS - 1), a = heelA - 0.025 * s + u * (Ls + 0.05 * s), uu = clamp((a - heelA) / Ls, 0, 1);
        const f = uu * (NS - 1), j0 = Math.min(NS - 2, Math.floor(f)), t = f - j0, at = (arr) => arr[j0] * (1 - t) + arr[j0 + 1] * t;
        const cap = Math.max(0.03, capAt(u)), wR = at(wr), wL = at(wl);
        const y0 = at(yb), y1 = y0 + at(sh), yM = (y0 + y1) / 2;
        for (let k = 0; k < SOLE_NR; k++) {
          const ph = (k / SOLE_NR) * 2 * Math.PI, cx = Math.sin(ph), cy = -Math.cos(ph);
          const X = Math.sign(cx) * Math.abs(cx) ** 0.34, Y = Math.sign(cy) * Math.abs(cy) ** 0.34;
          // a boot's lug sole: grooves across the bottom edge
          const lug = sub === 'boots' && Y < -0.5 ? 0.025 * s * (0.5 + 0.5 * Math.sin(((a - heelA) / (0.22 * s)) * 2 * Math.PI)) : 0;
          const l = X * ((X >= 0 ? wR : wL) + ov - lug) * cap, y = yM + Y * (y1 - y0) / 2;
          const o = (j * SOLE_NR + k) * 3;
          Sp[o] = ank[0] + dx * a + ex_ * l; Sp[o + 1] = Math.max(0, y); Sp[o + 2] = ank[2] + dz * a + ez * l;
        }
      }
      const Sn = vertexNormals(Sp, soleIdx, new Float32Array(nSole * 3));
      for (let q = 0; q < nSole; q++) {
        const i = ex.start + nUpper + q;
        for (let c = 0; c < 3; c++) { pos[i * 3 + c] = Sp[q * 3 + c]; nor[i * 3 + c] = Sn[q * 3 + c]; rest[i * 3 + c] = Sp[q * 3 + c] / s; }
        uv[i * 2] = 0; uv[i * 2 + 1] = 0;
      }
      // the skin inside the shoe is not drawn: the foot, and the ankle below the collar's floor
      if (!g.coverDepth || g.coverDepth.length !== D.m) g.coverDepth = new Float32Array(D.m).fill(-9);
      const cd = g.coverDepth;
      for (let c = 0; c < D.m; c++) {
        if (!mine(c)) continue;
        const rg = D.region[c]; if (rg !== R.FOOT && rg !== R.SHIN) continue;
        const qx = P[c * 3] - ank[0], qz = P[c * 3 + 2] - ank[2], a = qx * dx + qz * dz, l = qx * ex_ + qz * ez;
        const u = (a - heelA) / Ls; if (u < -0.03 || u > 1.03) { cd[c] = -9; continue; }
        const j = clamp(Math.round(u * (NS - 1)), 0, NS - 1);
        if (l > wr[j] + 0.03 * s || -l > wl[j] + 0.03 * s) { cd[c] = -9; continue; }
        const op = openAt(u), floorY = yt[j] - Math.min(0.24 * s, 0.45 * (yt[j] - yb[j])) * op * 0.9;
        cd[c] = rg === R.FOOT && op < 0.5 ? 1 : floorY - P[c * 3 + 1];
      }
      ex.dims = { Ls, Hs, heelA, u0, u1, ank, dx, dz };
    },
  };
}

function convexHull2(pts) {
  const P = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of P) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
// K points around a closed polygon, by angle from its centre (counter-clockwise seen from above).
function resampleLoop(poly, K, cx, cz) {
  const out = [];
  for (let k = 0; k < K; k++) {
    const a = (k / K) * Math.PI * 2, dx = Math.cos(a), dz = -Math.sin(a);
    let best = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const px = p[0] - cx, pz = p[1] - cz, ex = q[0] - p[0], ez = q[1] - p[1];
      const den = dx * ez - dz * ex; if (Math.abs(den) < 1e-12) continue;
      const t = (px * ez - pz * ex) / den, u = (px * dz - pz * dx) / den;
      if (t > 0 && u >= -1e-6 && u <= 1 + 1e-6) best = Math.max(best, t);
    }
    out.push([cx + dx * best, cz + dz * best]);
  }
  return out;
}

/* =====================================================================================
   Textures
   ===================================================================================== */

async function blobTexture(blob, srgb) {
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const tex = new THREE.Texture(img);
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    return tex;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
const half = (tex, right) => {
  if (!tex) return null;
  const t = tex.clone(); t.repeat.set(0.5, 1); t.offset.set(right ? 0.5 : 0, 0); t.needsUpdate = true; return t;
};
function canvasTexture(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; return t;
}

/* =====================================================================================
   The stage
   ===================================================================================== */

/**
 * @param {HTMLElement} container
 * @param {{ onAngle?: (deg:number)=>void, onReady?: (stage:object)=>void, mode?: 'avatar'|'mannequin' }} [opts]
 *   mode 'mannequin': a faceless grey mannequin, each piece a curved shell of its cut-out photos
 *   (mannequin-shells.js; prepare() then also takes the asset's cutFront / cutBack PNGs)
 */
export async function createStage(container, { onAngle, onReady, mode = 'avatar' } = {}) {
  const mannequin = mode === 'mannequin';
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(BACKDROP, 1);
  const canvas = renderer.domElement;
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent;outline:none';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  // a studio backdrop: a soft pool of light behind the man, falling off to the corners
  scene.background = canvasTexture(512, 512, (g, w, h) => {
    const grd = g.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.48, w * 0.72);
    grd.addColorStop(0, '#2b2a27'); grd.addColorStop(0.45, '#1d1c1a'); grd.addColorStop(1, '#0e0e0d');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, true);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  scene.environment = envTex;
  scene.environmentIntensity = 0.42;

  // three-point soft lighting; the lights stay with the camera while the man turns
  const key = new THREE.DirectionalLight(0xfff2e6, 2.5); key.position.set(1.7, 2.9, 2.6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 4; key.shadow.bias = -0.0004; key.shadow.normalBias = 0.012;
  Object.assign(key.shadow.camera, { left: -0.75, right: 0.75, top: 1.15, bottom: -1.15, near: 0.5, far: 8 });
  const fill = new THREE.DirectionalLight(0xe4ecff, 0.75); fill.position.set(-2.4, 1.3, 1.9);
  const rim = new THREE.DirectionalLight(0xffffff, 1.5); rim.position.set(-1.1, 2.3, -2.6);
  const rim2 = new THREE.DirectionalLight(0xfff4ea, 0.9); rim2.position.set(1.9, 1.6, -2.2);
  const keyTarget = new THREE.Object3D(); scene.add(keyTarget); key.target = keyTarget;
  scene.add(key, fill, rim, rim2);
  scene.add(new THREE.HemisphereLight(0xfaf6f0, 0x2a2622, 0.25));

  const camera = new THREE.PerspectiveCamera(20, 1, 0.5, 40);

  // floor: soft shadow + a contact shadow under the feet
  const floorMat = new THREE.ShadowMaterial({ opacity: 0.28 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(2.2, 64), floorMat);
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  const contactTex = canvasTexture(256, 256, (g, w, h) => {
    const grd = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grd.addColorStop(0, 'rgba(0,0,0,0.62)'); grd.addColorStop(0.35, 'rgba(0,0,0,0.38)'); grd.addColorStop(0.7, 'rgba(0,0,0,0.1)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
  }, false);
  const contact = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: contactTex, transparent: true, depthWrite: false, toneMapped: false }));
  contact.rotation.x = -Math.PI / 2; contact.position.y = 0.0015; contact.renderOrder = -1;

  const D = await loadAvatarData();
  const S = staticFields(D);
  const avatar = new THREE.Group(); // turns; holds everything in metres
  scene.add(avatar);
  const body = new THREE.Group(); body.scale.setScalar(0.1); avatar.add(body);
  avatar.add(contact);

  // shared uniforms for "covered, so not drawn"
  const coverU = (slots) => ({ uCoverOn: { value: new THREE.Vector4() }, uCoverOnB: { value: 0 }, uCoverMargin: { value: 0.22 }, _slots: slots });

  // ---------- body mesh ----------
  const skinU = {
    ...coverU(SLOTS),
    uSkin: { value: new THREE.Color() }, uHair: { value: new THREE.Color() }, uLip: { value: new THREE.Color() },
    uBeard: { value: new THREE.Vector4() }, uScalp: { value: new THREE.Vector2() },
    uFace: { value: null }, uFaceOn: { value: 0 }, uFaceMean: { value: new THREE.Color(0.5, 0.4, 0.35) }, uFaceBox: { value: new THREE.Vector4() },
    uEyes: { value: (() => { const J0 = jointsOf(D, D.full); return [new THREE.Vector4(...J0.eyeL, S.eyeRadius), new THREE.Vector4(...J0.eyeR, S.eyeRadius)]; })() },
  };
  skinU.uCoverMargin.value = 0.26;
  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(D.m * 3), 3));
  bodyGeo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(D.m * 3), 3));
  bodyGeo.setAttribute('aRest', new THREE.BufferAttribute(D.rest, 3));
  bodyGeo.setAttribute('aAO', new THREE.BufferAttribute(D.ao, 1));
  bodyGeo.setAttribute('aCoverA', new THREE.BufferAttribute(new Float32Array(D.m * 4).fill(-9), 4));
  bodyGeo.setAttribute('aCoverB', new THREE.BufferAttribute(new Float32Array(D.m).fill(-9), 1));
  bodyGeo.setIndex(new THREE.BufferAttribute(D.index, 1));
  const skinMat = mannequin ? mannequinMaterial(skinU, D.rest.reduce((m, v, i) => (i % 3 === 1 && D.region[(i - 1) / 3] === R.HEAD ? Math.min(m, v) : m), Infinity)) : skinMaterial(skinU);
  const bodyMesh = new THREE.Mesh(bodyGeo, skinMat);
  bodyMesh.castShadow = true; bodyMesh.receiveShadow = true; bodyMesh.frustumCulled = false;
  body.add(bodyMesh);

  // ---------- eyes ----------
  const eyeTex = await new THREE.TextureLoader().loadAsync(new URL('eye.png', DATA).href).catch(() => null);
  if (eyeTex) eyeTex.colorSpace = THREE.SRGBColorSpace;
  const eyeU = { uEye: { value: new THREE.Color() }, uIris: { value: (D.irises.length === 2 ? D.irises : [[0.285, 0.286, 0.1226, 0.0439], [0.701, 0.698, 0.1226, 0.0439]]).map((a) => new THREE.Vector4(...a)) } };
  const eyeMat = new THREE.MeshPhysicalMaterial({ map: eyeTex, color: eyeTex ? 0xffffff : 0xdddddd, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.08 });
  eyeMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, eyeU);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uEye; uniform vec4 uIris[2];')
      .replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
{
  float best = 9.0; vec4 ir = uIris[0];
  for (int i = 0; i < 2; i++) { float d = distance(vMapUv, uIris[i].xy) / (uIris[i].z * 1.16); if (d < best) { best = d; ir = uIris[i]; } }
  float pupil = ir.w / ir.z;
  float m = smoothstep(pupil * 0.95, pupil * 1.25, best) * (1.0 - smoothstep(0.86, 1.0, best));
  float l = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
  vec3 iris = uEye * (0.45 + 2.2 * l) * mix(1.0, 0.55, smoothstep(0.75, 1.0, best));
  diffuseColor.rgb = mix(diffuseColor.rgb, iris, m);
}
#endif
// the upper lid shades the top of the eye
diffuseColor.rgb *= mix(1.0, 0.42, smoothstep(0.0, 0.42, vEyeUp));`)
      .replace('#include <common>', '#include <common>\nvarying float vEyeUp;');
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vEyeUp;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEyeUp = normal.y;');
  };
  const eyeCount = D.eyeRel.length / 3;
  const eyeGeo = new THREE.BufferGeometry();
  eyeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(eyeCount * 3), 3));
  eyeGeo.setAttribute('uv', new THREE.BufferAttribute(D.eyeUV, 2));
  { const n = Float32Array.from(D.eyeRel); normalize3(n); eyeGeo.setAttribute('normal', new THREE.BufferAttribute(n, 3)); }
  const eyes = new THREE.Mesh(eyeGeo, eyeMat);
  eyes.frustumCulled = false;
  body.add(eyes);
  if (mannequin) eyes.visible = false;

  // ---------- state ----------
  const st = {
    D, S, cfg: null, B: null, env: null, bodyVersion: 0, clothCache: new Map(),
    topoCache: new Map(), prepCache: new Map(), worn: {}, slotState: {}, mode, shells: {},
    angle: 0, vel: 0, snap: null, fades: new Set(), dirty: true, raf: 0, disposed: false,
    lastFrameMs: 0, buildMs: 0, pendingBody: null, bodyTimer: 0, lastBodyAt: 0,
  };
  for (const s of SLOTS) st.slotState[s] = { visible: true, opacity: 1 };
  st.topology = (sub, length) => {
    const k = sub + ':' + (length || 'full');
    if (!st.topoCache.has(k)) st.topoCache.set(k, garmentTopology(D, S, sub, length));
    return st.topoCache.get(k);
  };

  function applyBodyGeometry() {
    const t0 = performance.now();
    const B = shapeBody(D, S, st.cfg);
    st.B = B;
    st.env = { torso: torsoEnvelope(D, S, B), legs: legEnvelopes(D, S, B) };
    B.Dir = clothDirections(D, S, B, st.env);
    bodyGeo.attributes.position.array.set(B.P);
    bodyGeo.attributes.normal.array.set(B.N);
    if (mannequin) eggHead(bodyGeo.attributes.position.array, bodyGeo.attributes.normal.array, D, R, B.J);
    bodyGeo.attributes.position.needsUpdate = true; bodyGeo.attributes.normal.needsUpdate = true;
    bodyGeo.computeBoundingSphere();
    // eyes at the eye joints
    const ep = eyeGeo.attributes.position.array;
    for (let i = 0; i < eyeCount; i++) {
      const j = D.eyeSide[i] ? B.J.eyeL : B.J.eyeR;
      for (let k = 0; k < 3; k++) ep[i * 3 + k] = j[k] + D.eyeRel[i * 3 + k] * B.s;
    }
    eyeGeo.attributes.position.needsUpdate = true; eyeGeo.computeBoundingSphere();
    st.bodyVersion++;
    for (const s of SLOTS) if (st.worn[s]) st.worn[s].h = null;
    refitGarments();
    if (mannequin) refitShells();
    updateHair();
    frame();
    st.buildMs = performance.now() - t0;
  }

  function frame() {
    const H = st.B.height / 10; // metres
    const aspect = Math.max(0.2, camera.aspect);
    const fov = camera.fov * D2R;
    const needH = H * 1.1 + 0.08, needW = 0.95;
    const dist = Math.max(needH / 2 / Math.tan(fov / 2), needW / 2 / (Math.tan(fov / 2) * aspect));
    const cy = H * 0.5 + 0.01;
    camera.position.set(0, cy + 0.05, dist);
    camera.lookAt(0, cy, 0);
    camera.near = dist - 2; camera.far = dist + 3; camera.updateProjectionMatrix();
    key.shadow.camera.top = H * 0.62; key.shadow.camera.bottom = -H * 0.62; key.shadow.camera.updateProjectionMatrix();
    keyTarget.position.set(0, H * 0.5, 0); key.position.set(1.7, H * 0.5 + 2.1, 2.6);
    contact.scale.set(0.78, 0.62, 1);
    invalidate();
  }

  // ---------- garments ----------
  function heightsFor(slot) {
    const g = st.worn[slot];
    if (!g.h) g.h = baseHeights(D, S, st.B, st.env, g.patch, g.prep.asset, g.fitKey);
    return g.h;
  }
  function refitGarments() {
    const B = st.B; if (!B) return;
    const finals = {};
    for (const slot of ORDER) {
      const g = st.worn[slot]; if (!g) continue;
      if (slot === 'bottoms' && !g.spec.skin) {
        const t = pantsTargets(D, S, B, g.patch, g.fitKey, st.worn.shoes?.G);
        finals[slot] = t.h; g.pants = t;
        g.update(B, t.h, t);
        continue;
      }
      const h = Float32Array.from(heightsFor(slot));
      const reg = g.patch.region, s = B.s;
      for (const inner of ORDER.slice(0, ORDER.indexOf(slot))) {
        const gi = st.worn[inner]; if (!gi) continue;
        const gap = (GAP[`${slot}>${inner}`] ?? 0.05) * s, hi = finals[inner], inR = gi.patch.inRegion;
        for (const v of reg) if (inR[v] && hi[v] + gap > h[v]) h[v] = hi[v] + gap;
      }
      // smooth the kinks the ordering made, only upwards
      const { off, nb } = S.adj, inR = g.patch.inRegion;
      for (let it = 0; it < 2; it++) {
        const t = Float32Array.from(h);
        for (const v of reg) { let a = 0, n = 0; for (let k = off[v]; k < off[v + 1]; k++) if (inR[nb[k]]) { a += t[nb[k]]; n++; } if (n && a / n > h[v]) h[v] = mix(h[v], a / n, 0.5); }
      }
      // the torso part: a convex drape (see topTargets)
      const drape = slot !== 'shoes' && slot !== 'bottoms' ? topTargets(D, S, B, g, st.worn) : null;
      if (drape) for (const v of reg) if (drape.w[v] > 0) h[v] = mix(h[v], Math.max(h[v] * 0.5, drape.h[v]), drape.w[v]);
      finals[slot] = h;
      // the layers it hangs over (already in place): their points, normals and the gap to keep
      const inner = [];
      for (const s2 of ORDER.slice(1, ORDER.indexOf(slot))) {
        const gi = st.worn[s2]; if (!gi?.G || !gi.Nf) continue;
        inner.push({ G: gi.G, N: gi.Nf, aw: gi.patch.armW, gap: (0.5 * ((gi.spec.thick ?? 0.03) + (g.spec.thick ?? 0.03)) + 0.015) * s });
      }
      // (a hood lies on the back, over the jacket's collar: the hoodie and the jacket keep their shells there)
      g.clothHood = (slot === 'jacket' && !!st.worn.layer?.spec.hood) || (slot === 'layer' && !!g.spec.hood);
      g.clothKey = [st.bodyVersion, ...ORDER.slice(0, ORDER.indexOf(slot) + 1).map((s2) => { const gi = st.worn[s2]; return gi ? `${s2}:${(gi.prep.clothId ??= ++clothIds)}:${gi.sub}:${gi.fitKey}:${gi.tuck || ''}` : '-'; })].join('|');
      g.update(B, h, null, drape, inner);
    }
    st.finals = finals;
    const hood = st.worn.layer?.extras.find((e) => e.lift !== undefined); if (hood) hood.done = false; // (the jacket may have moved)
    updateHood();
    writeCovers();
    invalidate();
  }
  function writeCovers() {
    const depths = {};
    for (const s of SLOTS) if (st.worn[s]) depths[s] = st.worn[s].coverDepth || st.worn[s].patch.coverDepth;
    for (const s of SLOTS) if (st.worn[s]) {
      const only = {}; for (const o of OUTER_OF[s]) if (depths[o]) only[o] = depths[o];
      st.worn[s].writeCover(only);
    }
    // the skin
    const a = bodyGeo.attributes.aCoverA.array, b = bodyGeo.attributes.aCoverB.array;
    for (let c = 0; c < D.m; c++) {
      for (let k = 0; k < 4; k++) a[c * 4 + k] = depths[SLOTS[k]] ? depths[SLOTS[k]][c] : -9;
      b[c] = depths.shoes ? depths.shoes[c] : -9;
    }
    bodyGeo.attributes.aCoverA.needsUpdate = true; bodyGeo.attributes.aCoverB.needsUpdate = true;
    updateCoverUniforms();
  }
  function updateCoverUniforms() {
    const opaque = (s) => (st.worn[s] && st.slotState[s].visible && st.slotState[s].opacity >= 1 ? 1 : 0);
    const set = (u, slots) => {
      const v = [0, 0, 0, 0, 0];
      for (const s of slots) v[SLOT_INDEX[s]] = opaque(s);
      u.uCoverOn.value.set(v[0], v[1], v[2], v[3]); u.uCoverOnB.value = v[4];
    };
    set(skinU, SLOTS);
    for (const s of SLOTS) if (st.worn[s]) for (const m of st.worn[s].prep.materials) set(m.userData.uniforms, OUTER_OF[s]);
  }
  function updateHood() {
    const g = st.worn.layer; if (!g) return;
    const hood = g.extras.find((e) => e.lift !== undefined); if (!hood) return;
    const j = st.worn.jacket, op = j ? st.slotState.jacket.opacity * (st.slotState.jacket.visible || st.slotState.jacket.opacity > 0 ? 1 : 0) : 0;
    const lift = j ? 0.2 * op : 0;
    if (Math.abs(hood.lift - lift) > 1e-4 || !hood.done) { hood.lift = lift; hood.done = true; hood.update(hood, g, st.B); g.geo.attributes.position.needsUpdate = true; g.geo.attributes.normal.needsUpdate = true; }
  }

  async function prepare(asset) {
    if (!asset || !asset.garmentId) throw new Error('avatar-stage: prepare needs a BakedGarmentAsset');
    const k = `${asset.garmentId}:${asset.updatedAt || 0}`;
    if (st.prepCache.has(k)) return st.prepCache.get(k).promise;
    const entry = { ready: false };
    entry.promise = (async () => {
      const sub = SPECS[asset.garmentSubType] ? asset.garmentSubType : DEFAULT_SUBTYPE[asset.slot] || 'tee';
      const [front, back, normal, roughMap, tile] = await Promise.all([
        blobTexture(asset.frontChestUV, true), blobTexture(asset.backPanelUV, true), blobTexture(asset.normalMap, false),
        null, blobTexture(asset.fabricTile, true), // (no roughness map: cloth is matte)
      ]);
      if (tile) { tile.wrapS = tile.wrapT = THREE.RepeatWrapping; tile.needsUpdate = true; }
      const fabric = new THREE.Color(asset.fabricBaseColor || '#777777');
      const trim = new THREE.Color(asset.trimColor || asset.fabricBaseColor || '#777777');
      if (!asset.trimColor) trim.multiplyScalar(0.92);
      const lining = fabric.clone().multiplyScalar(0.45);
      const slotOf = SPECS[sub].slot;
      const U = () => coverU(OUTER_OF[slotOf]);
      const isShoe = slotOf === 'shoes';
      // textiles: matte whatever the asset says (a nylon's low roughness reads as plastic); shoes'
      // leather may keep a little more sheen
      // (a down jacket's nylon keeps a soft sheen, so its quilting reads)
      const rough = isShoe ? clamp(asset.roughness ?? 0.6, 0.55, 0.85) : sub === 'puffer' ? clamp(asset.roughness ?? 0.6, 0.72, 0.9) : clamp(asset.roughness ?? 0.88, 0.85, 0.92);
      const spec = isShoe ? 0.35 : 0.2;
      // black cloth (by its base colour or its name) gets the deep-black albedo response
      const fl = 0.2126 * fabric.r + 0.7152 * fabric.g + 0.0722 * fabric.b;
      // (a photo already near black needs none: it would only crush it)
      const deep = isShoe ? 0 : (/\bblack\b/i.test(asset.name || '') ? 1 : sstep(0.12, 0.05, fl)) * sstep(0.025, 0.07, fl);
      // the sole: its own colour, else the trim's, else the upper's (never a made-up white)
      const sole = new THREE.Color(asset.soleColor || asset.trimColor || asset.fabricBaseColor || '#777777');
      const mats = [
        clothMaterial('panel', { map: front, normalMap: isShoe ? null : half(normal, false), roughness: rough, specular: spec, lining, deep, fabric, edge: !isShoe, tile: isShoe ? null : tile, tileScale: 1.4, color: front ? 0xffffff : fabric }, U()),
        clothMaterial('panel', { map: back || front, normalMap: isShoe ? null : half(normal, true), roughness: rough, specular: spec, lining, deep, fabric, edge: !isShoe, tile: isShoe ? null : tile, tileScale: 1.4, color: back || front ? 0xffffff : fabric }, U()),
        clothMaterial('fabric', { color: tile ? 0xffffff : fabric, tile, roughness: rough, specular: spec, lining, deep, tileScale: 1.4 }, U()),
        clothMaterial('trim', { color: isShoe ? sole : trim, roughness: isShoe ? 0.8 : Math.min(0.92, rough + 0.03), specular: spec, lining, deep: isShoe ? 0 : deep, grain: 0.6 }, U()),
      ];
      for (const t of [front, back, normal, roughMap, tile]) if (t) renderer.initTexture(t);
      // the cut of this kind of garment on the body (cached per kind), so putting it on is quick
      await new Promise((r) => setTimeout(r, 0));
      if (!st.disposed) st.topology(sub, asset.length || 'full');
      // the mannequin's shells: the cut-out photos themselves (with their alpha)
      const cut = mannequin && !isShoe && asset.cutFront ? { front: await blobTexture(asset.cutFront, true), back: await blobTexture(asset.cutBack, true) } : null;
      entry.value = { asset, sub, length: asset.length || 'full', materials: mats, textures: [front, back, normal, roughMap, tile, cut?.front, cut?.back].filter(Boolean), cut, tile };
      entry.ready = true;
      return entry.value;
    })();
    st.prepCache.set(k, entry);
    // keep the cache bounded (the worn ones always stay)
    if (st.prepCache.size > 24) {
      for (const [kk, e] of st.prepCache) {
        if (st.prepCache.size <= 20) break;
        if (Object.values(st.worn).some((g) => g && g.prep === e.value)) continue;
        st.prepCache.delete(kk); e.value?.textures.forEach((t) => t.dispose()); e.value?.materials.forEach((m) => m.dispose());
      }
    }
    try { await entry.promise; } catch (e) { st.prepCache.delete(k); throw e; }
    return entry.promise;
  }

  const slotToken = {};
  async function setGarment(slot, asset, { visible = true, name } = {}) {
    if (!SLOTS.includes(slot)) throw new Error('avatar-stage: unknown slot ' + slot);
    const token = (slotToken[slot] = (slotToken[slot] || 0) + 1);
    if (!asset) { putOn(slot, null, visible); return; }
    const nm = name ?? asset.name;
    const k = `${asset.garmentId}:${asset.updatedAt || 0}`;
    const entry = st.prepCache.get(k);
    const prep = entry && entry.ready ? entry.value : await prepare(asset);
    if (slotToken[slot] !== token || st.disposed) return;
    putOn(slot, prep, visible, nm);
  }
  function putOn(slot, prep, visible, name) {
    if (mannequin && slot !== 'shoes') { putShell(slot, prep, visible); return; }
    const old = st.worn[slot];
    if (old && prep && old.prep === prep && (name ?? old.name) === old.name) { setVisibleNow(slot, visible); return; }
    if (old) { body.remove(old.mesh); old.dispose(); delete st.worn[slot]; }
    if (prep) {
      const g = new GarmentMesh(st, slot, prep, name, tuckFor(slot, prep));
      st.worn[slot] = g;
      body.add(g.mesh);
    }
    setVisibleNow(slot, visible);
    retuck();
    if (st.B) refitGarments();
  }
  // The mannequin look: every piece but the shoes is a shell of its photos (mannequin-shells.js).
  function putShell(slot, prep, visible) {
    const old = st.shells[slot];
    if (old && prep && old.prep === prep) { setVisibleNow(slot, visible); return; }
    if (old) { body.remove(old.group); old.dispose(); delete st.shells[slot]; }
    if (prep) {
      const a = prep.asset;
      const g = new ShellGarment({ slot, sub: prep.sub, spec: SPECS[prep.sub], cut: prep.cut, fabric: a.fabricBaseColor, tile: prep.tile, tileCm: a.fabricTileCm, roughness: a.roughness, R });
      g.prep = prep; st.shells[slot] = g; body.add(g.group);
    }
    setVisibleNow(slot, visible);
    if (st.B) refitShells();
  }
  function refitShells() {
    const j = st.shells.jacket; j?.update(st.B, D);
    const hemMin = j && st.slotState.jacket.visible && j.info ? j.info.yHem - 0.15 * st.B.s : -Infinity;
    st.shells.bottoms?.update(st.B, D);
    for (const s of ['top', 'layer']) st.shells[s]?.update(st.B, D, { hemMin });
    invalidate();
  }
  // Layer lengths: under a jacket that is worn and shown, a top hangs at most ~1.5 cm below the
  // jacket's hem (a hoodie or a tee never sticks out a hand's width under a bomber); the top under a
  // layer ends a little higher than the layer, so it stays hidden. Rest-mesh decimetres.
  const TUCK = { layer: 0.08, top: 0.03 };
  function tuckFor(slot, prep) {
    if (slot !== 'top' && slot !== 'layer') return null;
    const j = st.worn.jacket; if (!j || !st.slotState.jacket.visible) return null;
    const sub = prep.sub, spec = SPECS[sub]; if (!spec || spec.slot !== 'top' && spec.slot !== 'layer') return null;
    const under = slot === 'top' && st.worn.layer && st.slotState.layer.visible;
    const want = Math.ceil((j.patch.hemY - (under ? TUCK.top : TUCK.layer)) * 50) / 50; // (2 mm steps: few cuts to cache)
    return want > topHem(spec, sub, prep.length || 'full') + 0.02 ? want.toFixed(2) : null;
  }
  function retuck() {
    let changed = false;
    for (const slot of ['layer', 'top']) {
      const g = st.worn[slot]; if (!g) continue;
      const want = tuckFor(slot, g.prep); if (want === g.tuck) continue;
      const ng = new GarmentMesh(st, slot, g.prep, g.name, want);
      body.remove(g.mesh); g.dispose(); st.worn[slot] = ng; body.add(ng.mesh);
      applyOpacity(slot); changed = true;
    }
    return changed;
  }
  function setVisibleNow(slot, visible) {
    const ss = st.slotState[slot];
    ss.visible = !!visible; ss.opacity = visible ? 1 : 0; st.fades.delete(slot);
    applyOpacity(slot);
  }
  function applyOpacity(slot) {
    const g = st.worn[slot], ss = st.slotState[slot];
    if (g) {
      g.mesh.visible = ss.opacity > 0.001;
      for (const m of g.prep.materials) m.opacity = ss.opacity;
    }
    if (st.shells[slot]) st.shells[slot].setVisible(ss.opacity > 0.5); // (opaque shells switch half-way)
    updateCoverUniforms();
    if (slot === 'jacket') updateHood();
    invalidate();
  }
  function setVisible(slot, visible) {
    const ss = st.slotState[slot]; if (!ss) return;
    ss.visible = !!visible;
    ss.from = ss.opacity; ss.t0 = performance.now();
    st.fades.add(slot);
    // the inner layers show again at once, before the fade starts
    applyOpacity(slot);
    if (retuck() && st.B) refitGarments(); // (the tops under a jacket get their length back, or lose it)
    if (mannequin && slot === 'jacket' && st.B) refitShells();
  }

  // ---------- hair, beard, glasses ----------
  const hairGroup = new THREE.Group(); body.add(hairGroup);
  let hairKey = '';
  function updateHair() { if (!mannequin) hairKey = buildHead(st, hairGroup, skinU, hairKey); }
  st.onHairLoaded = () => { if (st.disposed) return; hairKey = ''; updateHair(); invalidate(); };

  // ---------- body config ----------
  function applyColors(cfg) {
    skinU.uSkin.value.setStyle(cfg.skinTone, THREE.SRGBColorSpace);
    skinU.uHair.value.setStyle(cfg.hairColor, THREE.SRGBColorSpace);
    const lip = new THREE.Color().setStyle(cfg.skinTone, THREE.SRGBColorSpace);
    const hsl = {}; lip.getHSL(hsl); lip.setHSL((hsl.h + 0.99) % 1, Math.min(1, hsl.s * 0.95 + 0.03), hsl.l * 0.86); // a man's lips: close to the skin, no rosy tint
    skinU.uLip.value.copy(lip);
    eyeU.uEye.value.setStyle(cfg.eyeColor, THREE.SRGBColorSpace);
    const beard = cfg.beard || 'clean';
    skinU.uBeard.value.set(beard === 'stubble' ? 0.75 : beard === 'clean' ? 0.2 : 0.5, 1, 0, 0);
    skinU.uScalp.value.set(cfg.hairStyle === 'shaved' ? 0.4 : cfg.hairStyle === 'buzz' ? 0.85 : cfg.hairStyle === 'fade' ? 0.75 : 0.5, 0);
  }

  function setBody(config) {
    const cfg = cleanBody(config || {});
    const prev = st.cfg;
    st.cfg = cfg;
    applyColors(cfg);
    const geomChanged = !prev || prev.heightCm !== cfg.heightCm || prev.weightKg !== cfg.weightKg || prev.build !== cfg.build;
    if (!mannequin && cfg.facePhotoDataUrl !== prev?.facePhotoDataUrl) loadFace(cfg.facePhotoDataUrl);
    if (geomChanged) {
      const now = performance.now();
      if (!prev || now - st.lastBodyAt > REFIT_MS) { st.lastBodyAt = now; clearTimeout(st.bodyTimer); applyBodyGeometry(); }
      else { clearTimeout(st.bodyTimer); st.bodyTimer = setTimeout(() => { st.lastBodyAt = performance.now(); applyBodyGeometry(); }, REFIT_MS - (now - st.lastBodyAt)); }
    } else { updateHair(); invalidate(); }
  }

  let faceTex = null;
  async function loadFace(url) {
    if (faceTex) { faceTex.dispose(); faceTex = null; }
    skinU.uFaceOn.value = 0;
    if (!url) { invalidate(); return; }
    try {
      const img = new Image(); img.src = url; await img.decode();
      if (st.cfg.facePhotoDataUrl !== url) return;
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d'); g.drawImage(img, 0, 0, 64, 64);
      const px = g.getImageData(16, 20, 32, 30).data; let r = 0, gg = 0, b = 0, n = 0;
      for (let i = 0; i < px.length; i += 4) { r += px[i]; gg += px[i + 1]; b += px[i + 2]; n++; }
      skinU.uFaceMean.value.setRGB(r / n / 255, gg / n / 255, b / n / 255, THREE.SRGBColorSpace);
      faceTex = new THREE.Texture(img); faceTex.colorSpace = THREE.SRGBColorSpace; faceTex.needsUpdate = true;
      skinU.uFace.value = faceTex; skinU.uFaceOn.value = 1;
      // FACE_FRAME: eye line at eyeY of the height, cheek to cheek (about 1.34 dm on the mesh) faceW of the width, chin at chinY
      const cheek = 1.34, eyeToChin = 8.033 - 6.93;
      skinU.uFaceBox.value.set(FACE_FRAME.faceW / cheek, 1 - FACE_FRAME.eyeY, (FACE_FRAME.chinY - FACE_FRAME.eyeY) / eyeToChin, 0);
      invalidate();
    } catch { /* a bad photo just leaves the plain skin */ }
  }

  // ---------- turning ----------
  let lastSentAngle = null;
  const setAngle = (a) => {
    st.angle = a;
    avatar.rotation.y = a * D2R;
    const w = wrapAngle(a);
    if (onAngle && (lastSentAngle === null || Math.abs(w - lastSentAngle) > 0.01)) { lastSentAngle = w; try { onAngle(w); } catch (e) { console.error(e); } }
    invalidate();
  };
  function snapTo(deg) {
    const target = Number(deg) || 0;
    const delta = ((target - wrapAngle(st.angle) + 540) % 360) - 180;
    st.vel = 0;
    st.snap = { from: st.angle, to: st.angle + delta, t0: performance.now() };
    invalidate();
  }

  let drag = null;
  const degPerPx = () => 360 / Math.max(300, canvas.clientWidth * 1.3);
  function onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, lastX: e.clientX, lastT: performance.now(), decided: false, horiz: false, v: 0 };
  }
  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.decided) {
      if (Math.hypot(dx, dy) < 6) return;
      drag.decided = true; drag.horiz = Math.abs(dx) > Math.abs(dy) * 1.1;
      if (!drag.horiz) { drag = null; return; }
      try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      st.snap = null; st.vel = 0;
    }
    if (e.cancelable) e.preventDefault();
    const now = performance.now(), ddx = e.clientX - drag.lastX, dt = Math.max(1, now - drag.lastT);
    drag.v = mix(drag.v, (ddx * degPerPx()) / (dt / 1000), 0.35);
    drag.lastX = e.clientX; drag.lastT = now;
    setAngle(st.angle + ddx * degPerPx());
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (drag.horiz) { st.vel = performance.now() - drag.lastT < 80 ? clamp(drag.v, -720, 720) : 0; st.lastT = performance.now(); invalidate(); }
    drag = null;
  }
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  // ---------- render on demand ----------
  function invalidate() { if (!st.raf && !st.disposed) st.raf = requestAnimationFrame(tick); }
  function tick(now) {
    st.raf = 0;
    let more = false;
    if (st.snap) {
      const t = clamp((now - st.snap.t0) / SNAP_MS, 0, 1), e = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      setAngle(mix(st.snap.from, st.snap.to, e));
      if (t >= 1) { setAngle(st.snap.to); st.snap = null; } else more = true;
    } else if (Math.abs(st.vel) > 2 && !drag) {
      const dt = Math.min(0.05, (now - (st.lastT || now)) / 1000); st.lastT = now;
      setAngle(st.angle + st.vel * dt);
      st.vel *= Math.exp(-dt * 4.2);
      more = true;
    } else st.vel = 0;
    for (const slot of [...st.fades]) {
      const ss = st.slotState[slot];
      const t = clamp((now - ss.t0) / FADE_MS, 0, 1);
      ss.opacity = mix(ss.from, ss.visible ? 1 : 0, t);
      if (t >= 1) st.fades.delete(slot); else more = true;
      applyOpacity(slot);
    }
    render();
    if (more) invalidate();
  }
  function render() {
    const t0 = performance.now();
    renderer.render(scene, camera);
    st.lastFrameMs = performance.now() - t0;
  }

  function resize() {
    const w = Math.max(1, container.clientWidth), h = Math.max(1, container.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    if (st.B) frame(); else camera.updateProjectionMatrix();
    invalidate();
  }
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => resize()) : null;
  ro?.observe(container);

  function dispose() {
    st.disposed = true;
    cancelAnimationFrame(st.raf); clearTimeout(st.bodyTimer);
    ro?.disconnect();
    canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
    for (const s of SLOTS) if (st.worn[s]) st.worn[s].dispose();
    for (const s of SLOTS) st.shells[s]?.dispose();
    for (const e of st.prepCache.values()) { e.value?.textures.forEach((t) => t.dispose()); e.value?.materials.forEach((m) => m.dispose()); }
    scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); } });
    envTex.dispose(); contactTex.dispose(); eyeTex?.dispose(); faceTex?.dispose();
    renderer.dispose();
    canvas.remove();
  }

  st.renderer = renderer;
  const stage = {
    setBody, prepare, setGarment, setVisible, snapTo, resize, dispose, mode,
    get angle() { return wrapAngle(st.angle); },
    debug: {
      renderer, scene, camera, avatar, body: bodyMesh, head: hairGroup, state: st,
      render() { render(); return st.lastFrameMs; },
      get lastFrameMs() { return st.lastFrameMs; },
      get buildMs() { return st.buildMs; },
      triangles() { let n = 0; scene.traverse((o) => { if (o.isMesh && o.visible && o.geometry.index) n += o.geometry.index.count / 3; }); return n; },
      setAngleNow(a) { st.snap = null; st.vel = 0; setAngle(a); render(); },
      // resolves once the current hairstyle's photo is loaded and on the head
      async hairReady() { const style = st.cfg?.hairStyle; if (HAIR_FILES.has(style)) await loadHairAsset(style); await null; },
    },
  };
  resize();
  setBody(cleanBody({}));
  render();
  try { onReady?.(stage); } catch (e) { console.error(e); }
  return stage;
}

/* =====================================================================================
   Hair, beard, glasses (built per style; cheap)
   ===================================================================================== */

// value noise (the same idea as the shader's), for lumps and waves in the geometry
function hash3(x, y, z) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function vnoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy); fz = fz * fz * (3 - 2 * fz);
  const L = mix, H = hash3;
  return L(L(L(H(xi, yi, zi), H(xi + 1, yi, zi), fx), L(H(xi, yi + 1, zi), H(xi + 1, yi + 1, zi), fx), fy),
    L(L(H(xi, yi, zi + 1), H(xi + 1, yi, zi + 1), fx), L(H(xi, yi + 1, zi + 1), H(xi + 1, yi + 1, zi + 1), fx), fy), fz);
}

// posed ≈ s · rest + off, fitted on the skull (the morphs barely move it)
function headFrame(D, B) {
  let ox = 0, oy = 0, oz = 0, n = 0;
  for (let c = 0; c < D.m; c++) {
    if (D.region[c] !== R.HEAD || D.rest[c * 3 + 1] < 7.9) continue;
    const o = c * 3;
    ox += B.P[o] - B.s * D.rest[o]; oy += B.P[o + 1] - B.s * D.rest[o + 1]; oz += B.P[o + 2] - B.s * D.rest[o + 2]; n++;
  }
  const s = B.s, off = [ox / n, oy / n, oz / n];
  return { s, off, at: (x, y, z) => [s * x + off[0], s * y + off[1], s * z + off[2]], restY: (y) => (y - off[1]) / s };
}

// The head seen from a point inside the skull: the outermost surface radius per direction
// (azimuth around y, polar angle from the top), rasterised from the head and neck triangles.
const HA = 128, HP = 90;
function headRadius(D, B, c, tris) {
  const R = new Float32Array(HA * HP), P = B.P;
  const da = (2 * Math.PI) / HA, dp = Math.PI / (HP - 1);
  const A = [0, 0, 0], Q = [0, 0, 0];
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t], b = tris[t + 1], e = tris[t + 2];
    const vs = [a, b, e];
    for (let k = 0; k < 3; k++) {
      const o = vs[k] * 3, x = P[o] - c[0], y = P[o + 1] - c[1], z = P[o + 2] - c[2];
      A[k] = Math.atan2(x, z); Q[k] = Math.acos(clamp(y / (Math.hypot(x, y, z) || 1), -1, 1));
    }
    let a0 = Math.min(A[0], A[1], A[2]), a1 = Math.max(A[0], A[1], A[2]);
    if (a1 - a0 > Math.PI) { for (let k = 0; k < 3; k++) if (A[k] < 0) A[k] += 2 * Math.PI; a0 = Math.min(A[0], A[1], A[2]); a1 = Math.max(A[0], A[1], A[2]); }
    const q0 = Math.min(Q[0], Q[1], Q[2]), q1 = Math.max(Q[0], Q[1], Q[2]);
    let i0 = Math.floor((a0 + Math.PI) / da) - 1, i1 = Math.ceil((a1 + Math.PI) / da) + 1;
    if (q0 < 0.2 || q1 > Math.PI - 0.2) { i0 = 0; i1 = HA - 1; }
    const j0 = Math.max(0, Math.floor(q0 / dp) - 1), j1 = Math.min(HP - 1, Math.ceil(q1 / dp) + 1);
    const ao = a * 3, bo = b * 3, eo = e * 3;
    const e1x = P[bo] - P[ao], e1y = P[bo + 1] - P[ao + 1], e1z = P[bo + 2] - P[ao + 2];
    const e2x = P[eo] - P[ao], e2y = P[eo + 1] - P[ao + 1], e2z = P[eo + 2] - P[ao + 2];
    const tx = c[0] - P[ao], ty = c[1] - P[ao + 1], tz = c[2] - P[ao + 2];
    const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
    for (let i = i0; i <= i1; i++) {
      const ii = ((i % HA) + HA) % HA, az = -Math.PI + ii * da, sa = Math.sin(az), ca = Math.cos(az);
      for (let j = j0; j <= j1; j++) {
        const sp = Math.sin(j * dp), dx = sp * sa, dy = Math.cos(j * dp), dz = sp * ca;
        const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
        const det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det, u = (tx * px + ty * py + tz * pz) * inv;
        if (u < -1e-4 || u > 1 + 1e-4) continue;
        const v = (dx * qx + dy * qy + dz * qz) * inv;
        if (v < -1e-4 || u + v > 1 + 1e-4) continue;
        const d = (e2x * qx + e2y * qy + e2z * qz) * inv;
        const k = ii * HP + j;
        if (d > R[k]) R[k] = d;
      }
    }
  }
  // fill the gaps, then round off the facets (never inwards: the hair stays outside the skin)
  for (let pass = 0; pass < 40; pass++) {
    let empty = 0; const nx = Float32Array.from(R);
    for (let i = 0; i < HA; i++) for (let j = 0; j < HP; j++) {
      const k = i * HP + j; if (R[k] > 0) continue;
      let s = 0, n = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const jj = j + dj; if (jj < 0 || jj >= HP) continue;
        const v = R[(((i + di) % HA + HA) % HA) * HP + jj]; if (v > 0) { s += v; n++; }
      }
      if (n) nx[k] = s / n; else empty++;
    }
    R.set(nx); if (!empty) break;
  }
  for (let pass = 0; pass < 2; pass++) {
    const nx = Float32Array.from(R);
    for (let i = 0; i < HA; i++) for (let j = 1; j < HP - 1; j++) {
      let s = 0;
      for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) s += R[(((i + di) % HA + HA) % HA) * HP + j + dj];
      nx[i * HP + j] = Math.max(R[i * HP + j], s / 9);
    }
    R.set(nx);
  }
  return (az, q) => {
    let fi = (az + Math.PI) / da, fj = clamp(q / dp, 0, HP - 1.001);
    const i = Math.floor(fi), j = Math.floor(fj), ti = fi - i, tj = fj - j;
    const i0 = ((i % HA) + HA) % HA, i1 = (i0 + 1) % HA;
    return mix(mix(R[i0 * HP + j], R[i0 * HP + j + 1], tj), mix(R[i1 * HP + j], R[i1 * HP + j + 1], tj), ti);
  };
}

// Hairlines: rest height (dm) by the angle around the head (0 front, 180 back), symmetric.
const LINE_SHORT = [[0, 8.72], [22, 8.67], [38, 8.56], [50, 8.44], [55, 8.3], [58, 7.9], [62, 7.88], [65.5, 8.36], [104, 8.38], [118, 8.02], [135, 7.78], [180, 7.72]];
const LINE_CROP = [[0, 8.47], [26, 8.48], [40, 8.46], [50, 8.4], [55, 8.3], [58, 7.9], [62, 7.88], [65.5, 8.36], [104, 8.38], [118, 8.02], [135, 7.78], [180, 7.72]];
// men's lengths: wavy is a textured flow over the tops of the ears and down to the nape, long reaches
// the bottom of the ears and the top of the neck (never a jaw-length bob or hair past the shoulders)
const LINE_WAVY = [[0, 8.7], [22, 8.64], [38, 8.5], [50, 8.3], [56, 8.14], [70, 8.08], [100, 8.0], [125, 7.8], [150, 7.62], [180, 7.56]];
const LINE_LONG = [[0, 8.7], [22, 8.64], [38, 8.48], [50, 8.2], [58, 7.86], [80, 7.72], [115, 7.5], [150, 7.34], [180, 7.3]];
function lineAt(L, A) {
  for (let k = 1; k < L.length; k++) if (A <= L[k][0]) { const [a0, y0] = L[k - 1], [a1, y1] = L[k]; return mix(y0, y1, sstep(a0, a1, A)); }
  return L[L.length - 1][1];
}
// T: thickness top / sides / back (dm); edge: the soft fringe (fraction of the length);
// mode: strand pattern in the shader (0 from the crown, 1 combed back, 2 curls); str: strand frequency
const HAIR_SPECS = {
  shaved: null,
  buzz: { T: [0.02, 0.016, 0.016], alpha: 0.55, edge: 0.14, line: LINE_SHORT, mode: 0, str: [140, 6], rough: 0.7, bump: 0.00025 },
  short: { T: [0.11, 0.05, 0.07], edge: 0.12, line: LINE_SHORT, mode: 0, str: [90, 4], rough: 0.5 },
  fade: { T: [0.13, 0.012, 0.015], fade: [8.02, 8.42], edge: 0.1, line: LINE_SHORT, mode: 0, str: [90, 4], rough: 0.5 },
  sidepart: { T: [0.14, 0.055, 0.08], part: 0.3, edge: 0.11, line: LINE_SHORT, mode: 1, str: [70, 3], rough: 0.42 },
  crop: { T: [0.12, 0.045, 0.065], blunt: [0, 42], edge: 0.1, line: LINE_CROP, mode: 0, str: [90, 4], rough: 0.5 },
  slick: { T: [0.1, 0.04, 0.085], edge: 0.06, line: LINE_SHORT, mode: 1, str: [80, 3], rough: 0.3 },
  curly: { T: [0.2, 0.12, 0.15], curl: 0.08, edge: 0.14, line: LINE_SHORT, mode: 2, str: [40, 40], rough: 0.55, bump: 0.0007 },
  wavy: { T: [0.17, 0.075, 0.1], wave: 0.022, hang: 0.03, blunt: [64, 181], edge: 0.1, line: LINE_WAVY, mode: 0, str: [80, 3], rough: 0.48 },
  long: { T: [0.15, 0.085, 0.11], wave: 0.014, hang: 0.04, blunt: [56, 181], edge: 0.08, line: LINE_LONG, mode: 1, str: [70, 3], rough: 0.44 },
};
const HAIR_CENTER = [0, 8.25, 0.35];

function hairMaterial(skinU, opts) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: opts.rough ?? 0.5, metalness: 0, side: THREE.DoubleSide, alphaHash: true });
  const U = { uHair: skinU.uHair, uHairP: { value: new THREE.Vector4(opts.mode ?? 0, opts.str?.[0] ?? 90, opts.str?.[1] ?? 4, opts.bump ?? 0.0004) }, uHairP2: { value: opts.under ? 0.62 : 1 } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aHair; varying vec3 vHair; varying vec3 vHP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHair = aHair; vHP = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHair; uniform vec4 uHairP; uniform float uHairP2; varying vec3 vHair; varying vec3 vHP;\n' + GLSL_NOISE + `
float hairN() {
  float m = uHairP.x;
  if (m < 0.5) return vnoise(vec3(cos(vHair.x) * uHairP.y, sin(vHair.x) * uHairP.y, vHair.y * uHairP.z));
  if (m < 1.5) return vnoise(vec3(vHP.x * uHairP.y, vHP.y * uHairP.z, vHP.z * uHairP.z));
  if (m < 2.5) return vnoise(vHP * uHairP.y) * 0.55 + vnoise(vHP * uHairP.y * 2.9) * 0.45;
  return vnoise(vec3(vHP.x * uHairP.y, vHP.y * uHairP.z, vHP.z * uHairP.y));
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
float hn = hairN();
float clump = vnoise(vec3(cos(vHair.x) * 7.0, sin(vHair.x) * 7.0, vHair.y * 1.5));
diffuseColor.rgb = uHair * (0.6 + 0.6 * hn) * (0.82 + 0.36 * clump) * uHairP2;
diffuseColor.a = clamp(vHair.z * 1.7 - 0.35 + (hn - 0.5) * 0.9, 0.0, 1.0);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor *= 0.8 + 0.45 * hn;')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = bumpN(normal, (hn - 0.5) * uHairP.w, 1.0);');
  };
  mat.customProgramCacheKey = () => 'hair-1';
  return mat;
}

function hairGeometry(D, B, hf, spec, Rs, c) {
  const NA = 120, NT = 32, s = hf.s;
  const da = (2 * Math.PI) / NA;
  const pos = [], hair = [];
  const push = (az, q, r, t, a) => {
    const sp = Math.sin(q);
    pos.push(c[0] + r * sp * Math.sin(az), c[1] + r * Math.cos(q), c[2] + r * sp * Math.cos(az));
    hair.push(az, q, a);
  };
  // pole
  push(0, 0, Rs(0, 0) + spec.T[0] * s, 0, 1);
  const cols = [];
  for (let i = 0; i < NA; i++) {
    const az = -Math.PI + i * da, A = Math.abs(az) * 180 / Math.PI;
    const yl = spec.line ? lineAt(spec.line, A) * s + hf.off[1] : 0;
    let qEnd = Math.PI * 0.97;
    for (let q = 0.02; q < Math.PI * 0.97; q += 0.006) { if (c[1] + Rs(az, q) * Math.cos(q) <= yl) { qEnd = q; break; } }
    const blunt = spec.blunt && A >= spec.blunt[0] && A <= spec.blunt[1];
    let rhoMax = 0, yWide = 0;
    const col = [];
    for (let j = 1; j <= NT; j++) {
      const t = j / NT, q = qEnd * t, sp = Math.sin(q);
      const rs = Rs(az, q), ySurf = c[1] + rs * Math.cos(q), yR = hf.restY(ySurf);
      const side = mix(spec.T[1], spec.T[2], sstep(95, 150, A));
      const top = Math.max(sstep(8.35, 8.8, yR), sstep(40, 15, A) * sstep(8.2, 8.5, yR));
      let T = mix(side, spec.T[0], top);
      let alpha = spec.alpha ?? 1;
      if (spec.fade && A > 30) { const f = sstep(spec.fade[0], spec.fade[1], yR); T = mix(spec.T[1], T, f); alpha = mix(0.15, 1, f); }
      let e = sstep(1, 1 - spec.edge, t);
      if (blunt) e = mix(0.55, 1, e); else alpha *= sstep(1, 1 - spec.edge * 0.9, t);
      let r = rs + (T * e + 0.004) * s;
      if (spec.curl) r += spec.curl * s * e * ((vnoise3(sp * Math.sin(az) * 7, Math.cos(q) * 7, sp * Math.cos(az) * 7) - 0.45) * 1.3 + (vnoise3(sp * Math.sin(az) * 15 + 9, Math.cos(q) * 15, sp * Math.cos(az) * 15) - 0.5) * 0.6);
      if (spec.wave) r += spec.wave * s * Math.sin(q * 15 + az * 2) * e * sstep(0.2, 0.5, t);
      if (spec.part) {
        const px = (r * sp * Math.sin(az) + c[0] - hf.off[0]) / s;
        const front = sstep(-0.5, 0.2, Math.cos(az)) * sstep(8.3, 8.6, yR);
        r -= 0.055 * s * Math.exp(-(((px - spec.part) / 0.045) ** 2)) * front;
        r += 0.03 * s * sstep(0.25, -0.35, px) * top;
      }
      if (spec.hang) {
        const rho = r * sp, y = c[1] + r * Math.cos(q);
        if (rho > rhoMax) { rhoMax = rho; yWide = y; }
        else {
          const want = rhoMax * (1 - spec.hang * Math.max(0, yWide - y) / s);
          if (rho < want && sp > 0.05) r = want / sp;
        }
      }
      col.push([az, q, r, t, alpha]);
    }
    cols.push({ col, qEnd, blunt, az });
  }
  for (let j = 0; j < NT; j++) for (const { col } of cols) { const [az, q, r, t, a] = col[j]; push(az, q, r, t, a); }
  // the edge: back to the skin (or, for long ends, an inner layer of hair)
  for (const { col, qEnd, blunt, az } of cols) {
    const last = col[col.length - 1], rs = Rs(az, qEnd);
    push(az, qEnd, blunt ? Math.max(rs + 0.003 * s, last[2] - 0.07 * s) : rs + 0.002 * s, 1, last[4]);
  }
  const idx = [], V = (i, j) => 1 + (j - 1) * NA + (((i % NA) + NA) % NA);
  for (let i = 0; i < NA; i++) idx.push(0, V(i, 1), V(i + 1, 1));
  for (let j = 1; j < NT + 1; j++) for (let i = 0; i < NA; i++) {
    const a = V(i, j), b = V(i + 1, j), cc = V(i, j + 1), d = V(i + 1, j + 1);
    idx.push(a, cc, b, b, cc, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aHair', new THREE.Float32BufferAttribute(hair, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* ---------- beards: a shell over the face, cut by masks on the rest mesh ---------- */
function lipOut(x, y, z) {
  const up = y > 7.315 ? 0.118 : 0.112;
  const r = Math.hypot(x / 0.235, (y - 7.315 - 0.012 * (1 - sstep(0, 0.08, Math.abs(x)))) / up);
  return 1 - (1 - sstep(1.02, 1.25, r)) * sstep(1.15, 1.3, z);
}
function beardArea(x, y, z, grow = 0) {
  const ax = Math.abs(x), up = mix(7.47, 7.86, sstep(0.3, 0.74, ax)) + grow * 0.04;
  let m = sstep(up + 0.03, up - 0.06, y);
  const low = 7.52 - clamp(z - 0.5, 0, 0.6) * 1.05 - grow * 0.12;
  m *= sstep(low - 0.08, low + 0.05, y) * sstep(0.25, 0.48, z) * (1 - sstep(0, 0.05, ax - 0.82));
  return m;
}
function moustache(x, y, z) {
  const ax = Math.abs(x), lo = 7.445 - 0.17 * sstep(0.17, 0.3, ax), hi = 7.565 - 0.05 * sstep(0.12, 0.28, ax);
  return sstep(lo - 0.01, lo + 0.025, y) * sstep(hi + 0.01, hi - 0.025, y) * sstep(0.34, 0.28, ax) * sstep(1.2, 1.32, z);
}
function goatee(x, y, z) {
  const ax = Math.abs(x);
  const chin = sstep(0.3, 0.21, ax) * sstep(7.22, 7.14, y) * sstep(6.8, 6.92, y) * sstep(0.8, 1.0, z);
  const ring = sstep(0.34, 0.27, ax) * sstep(7.0, 7.08, y) * sstep(7.5, 7.44, y) * sstep(1.1, 1.25, z);
  return Math.max(moustache(x, y, z), chin, ring);
}
const BEARD_SPECS = {
  short: { mask: (x, y, z) => Math.max(beardArea(x, y, z), moustache(x, y, z)) * lipOut(x, y, z), T: 0.018, chin: 0.01, alpha: 0.8 },
  full: { mask: (x, y, z) => Math.max(beardArea(x, y, z, 1), moustache(x, y, z)) * lipOut(x, y, z), T: 0.085, chin: 0.06 },
  moustache: { mask: (x, y, z) => moustache(x, y, z) * lipOut(x, y, z), T: 0.04, chin: 0 },
  goatee: { mask: (x, y, z) => goatee(x, y, z) * lipOut(x, y, z), T: 0.045, chin: 0.03 },
};
function beardTopology(D, spec) {
  const f = new Float32Array(D.m);
  for (let c = 0; c < D.m; c++) {
    const o = c * 3, y = D.rest[o + 1];
    f[c] = D.region[c] === R.HEAD || D.region[c] === R.NECK ? (y > 6.4 && y < 8.1 ? 0.45 - spec.mask(D.rest[o], y, D.rest[o + 2]) : 1) : 1;
  }
  const patch = buildPatch(D.m, D.index, [f], [0], [], () => 0, true);
  patch.restP = interp(patch, D.rest, 3);
  return patch;
}
function beardGeometry(D, B, patch, spec) {
  const P = interp(patch, B.P, 3), N = interp(patch, B.Ns, 3); normalize3(N);
  const pos = new Float32Array(patch.nv * 3), hair = new Float32Array(patch.nv * 3), s = B.s;
  for (let v = 0; v < patch.nv; v++) {
    const o = v * 3, x = patch.restP[o], y = patch.restP[o + 1], z = patch.restP[o + 2];
    const m = spec.mask(x, y, z), e = sstep(0.45, 0.85, m);
    const chin = spec.chin * sstep(7.2, 6.95, y) * sstep(0.45, 0.1, Math.abs(x));
    const n = vnoise3(x * 9, y * 9, z * 9);
    const T = ((spec.T + chin) * e * (0.85 + 0.3 * n) + 0.003) * s;
    for (let k = 0; k < 3; k++) pos[o + k] = P[o + k] + N[o + k] * T;
    hair[o] = Math.atan2(x, z - 0.3); hair[o + 1] = y; hair[o + 2] = sstep(0.45, 0.62, m) * (spec.alpha ?? 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aHair', new THREE.BufferAttribute(hair, 3));
  g.setIndex(new THREE.BufferAttribute(patch.tris, 1));
  g.computeVertexNormals();
  return g;
}

/* ---------- glasses: a thin acetate frame in front of the eyes ---------- */
function glassesGroup(D, B, hf) {
  const s = B.s, eL = B.J.eyeL, eR = B.J.eyeR;
  const yE = (eL[1] + eR[1]) / 2 - 0.015 * s, zF = Math.max(eL[2], eR[2]) + 0.25 * s;
  // the head's half width at the temples, so the arms clear it
  let half = 0;
  for (let c = 0; c < D.m; c++) {
    if (D.region[c] !== R.HEAD) continue;
    const o = c * 3, y = D.rest[o + 1], z = D.rest[o + 2];
    if (y > 7.95 && y < 8.35 && z > 0.2 && z < 1.15) half = Math.max(half, Math.abs(B.P[o] - hf.off[0]));
  }
  half += 0.035 * s;
  const frame = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.32, metalness: 0.05 });
  const lens = new THREE.MeshPhysicalMaterial({ color: 0xdfe8ee, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.14, depthWrite: false });
  const g = new THREE.Group();
  const W = 0.215 * s, H = 0.16 * s;
  for (const eye of [eL, eR]) {
    const sg = eye[0] >= hf.off[0] ? 1 : -1, cx = eye[0] + sg * 0.02 * s;
    const pts = [];
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
      // a soft rectangle, a little deeper at the outer bottom
      const px = Math.sign(ca) * Math.abs(ca) ** 0.55 * W, py = Math.sign(sa) * Math.abs(sa) ** 0.6 * H * (sa < 0 ? 1.04 : 0.96);
      const out = sg * px / W;
      pts.push(new THREE.Vector3(cx + px, yE + py, zF - 0.05 * s * Math.max(0, out) ** 2 - 0.012 * s * (py / H) ** 2));
    }
    const curve = new THREE.CatmullRomCurve3(pts, true);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 84, 0.024 * s, 6, true), frame));
    // the lens: a fan inside the rim
    const lp = [cx, yE, zF - 0.012 * s];
    for (const p of pts) lp.push(p.x, p.y, p.z - 0.004 * s);
    const li = []; for (let k = 0; k < pts.length; k++) li.push(0, 1 + k, 1 + ((k + 1) % pts.length));
    const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); lg.setIndex(li); lg.computeVertexNormals();
    g.add(new THREE.Mesh(lg, lens));
    // the arm: from the hinge back over the ear, then down behind it
    const hx = cx + sg * W * 1.0, hz = zF - 0.05 * s;
    const ear = hf.at(0, 8.17, 0.45), back = hf.at(0, 7.92, 0.22);
    const arm = new THREE.CatmullRomCurve3([
      new THREE.Vector3(hx, yE + H * 0.45, hz),
      new THREE.Vector3(hf.off[0] + sg * half, yE + H * 0.45, mix(hz, ear[2], 0.35)),
      new THREE.Vector3(hf.off[0] + sg * half, ear[1], ear[2]),
      new THREE.Vector3(hf.off[0] + sg * (half - 0.04 * s), back[1], back[2]),
    ]);
    g.add(new THREE.Mesh(new THREE.TubeGeometry(arm, 40, 0.016 * s, 5, false), frame));
  }
  // the bridge over the nose
  const xL = eL[0], xR = eR[0], xm = (xL + xR) / 2, gap = Math.abs(xL - xR) / 2 - W + 0.02 * s;
  const br = new THREE.CatmullRomCurve3([
    new THREE.Vector3(xm - gap - 0.01 * s, yE + H * 0.35, zF), new THREE.Vector3(xm, yE + H * 0.5, zF + 0.015 * s), new THREE.Vector3(xm + gap + 0.01 * s, yE + H * 0.35, zF),
  ]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(br, 16, 0.02 * s, 6, false), frame));
  g.traverse((o) => { if (o.isMesh) { o.castShadow = o.material === frame; o.frustumCulled = false; } });
  return g;
}

/* ---------- strand cards: the hair itself, over a thin dark under-layer ---------- */

// Real hair: photographed hair from Microsoft Rocketbox's male heads (MIT, avatar/hair/LICENSE-rocketbox.md),
// fitted to our head by tools/build-hair.py. Per style: avatar/hair/<style>.json (each vertex as a
// direction from HAIR_CENTER + its height above the scalp, kind 0 = the hair painted on the scalp,
// 1 = a hair card) and <style>.webp (the hair's luminance + alpha). Loaded only when the style is shown.
const HAIR_FILES = new Set(['buzz', 'short', 'fade', 'sidepart', 'crop', 'slick', 'curly', 'wavy', 'long']);
const CAP_OFF = 0.018; // the painted hair sits 1.8 mm off the scalp (dm, rest)
const hairAssets = new Map();
function loadHairAsset(style) {
  if (!hairAssets.has(style)) {
    const p = (async () => {
      const [js, tex] = await Promise.all([
        fetch(new URL(`hair/${style}.json`, DATA)).then((r) => { if (!r.ok) throw new Error(`hair/${style}.json ${r.status}`); return r.json(); }),
        new THREE.TextureLoader().loadAsync(new URL(`hair/${style}.webp`, DATA).href),
      ]);
      tex.colorSpace = THREE.NoColorSpace; tex.anisotropy = 8; tex.generateMipmaps = true;
      return { ...js, tex };
    })();
    p.catch((e) => { console.warn('avatar-stage: hair', e); });
    hairAssets.set(style, p.then((v) => { hairAssets.set(style, v); return v; }, () => { hairAssets.set(style, null); return null; }));
  }
  return hairAssets.get(style);
}

function realHairGeometry(H, hf, Rs, c) {
  const n = H.k.length, s = hf.s;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  for (let v = 0; v < n; v++) {
    const dx = H.d[v * 3], dy = H.d[v * 3 + 1], dz = H.d[v * 3 + 2];
    const r = Rs(Math.atan2(dx, dz), Math.acos(clamp(dy, -1, 1))) + (CAP_OFF + H.h[v]) * s;
    pos[v * 3] = c[0] + r * dx; pos[v * 3 + 1] = c[1] + r * dy; pos[v * 3 + 2] = c[2] + r * dz;
    // lit as one soft volume (each card's own plane would flicker as the head turns)
    nor[v * 3] = dx; nor[v * 3 + 1] = dy; nor[v * 3 + 2] = dz;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(H.uv), 2));
  g.setAttribute('aEdge', new THREE.BufferAttribute(H.e ? Float32Array.from(H.e) : new Float32Array(n).fill(1), 1));
  g.setIndex(H.i);
  return g;
}

// Two passes over the same mesh, no dithering: the solid hair (alpha ≥ 0.5) with depth writes, then
// the soft edges and stray strands blended on top without depth writes. The photo's luminance keeps
// its strands and highlights; the colour is the chosen hair colour.
function realHairMaterial(skinU, H, soft) {
  // (the photo already holds the hair's shine: little reflection of its own, or the cards turn grey at grazing angles)
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: H.tex, roughness: 0.75, metalness: 0, side: THREE.DoubleSide,
    envMapIntensity: 0.2, alphaTest: soft ? 0.02 : 0.5, transparent: soft, depthWrite: !soft });
  const U = { uHair: skinU.uHair, uLum: { value: 1 / Math.max(0.03, H.lum) } };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aEdge; varying float vEdge;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvEdge = aEdge;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uHair; uniform float uLum; varying float vEdge;')
      .replace('#include <map_fragment>', `
vec4 hairS = texture2D(map, vMapUv, 0.6); // a slightly softer mip: no single-pixel grain
float hr = clamp(hairS.r * uLum, 0.12, 2.8);
diffuseColor.rgb = uHair * pow(vec3(hr), vec3(2.2));
float hairA = hairS.a * smoothstep(0.0, 1.0, vEdge);
diffuseColor.a = ${soft ? 'hairA < 0.5 ? min(1.0, hairA * 1.4) : 0.0' : 'hairA'};`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(0.85, 0.6, smoothstep(0.6, 1.6, hr));');
  };
  mat.customProgramCacheKey = () => (soft ? 'hair-real-soft-1' : 'hair-real-1');
  return mat;
}

function buildHead(st, group, skinU, prevKey) {
  const { D, B, cfg } = st;
  if (!B || !cfg) return prevKey;
  let key = [st.bodyVersion, cfg.hairStyle, cfg.beard, cfg.glasses].join('|');
  if (key === prevKey) return key;
  for (const o of [...group.children]) {
    group.remove(o);
    o.traverse((m) => { if (m.isMesh) { m.geometry.dispose(); m.material.dispose(); } });
  }
  const hf = headFrame(D, B);
  const hs = HAIR_SPECS[cfg.hairStyle];
  if (hs) {
    if (!st.headTris) {
      const t = [];
      for (let k = 0; k < D.index.length; k += 3) {
        const a = D.index[k], b = D.index[k + 1], c = D.index[k + 2], ok = (v) => D.region[v] === R.HEAD || D.region[v] === R.NECK;
        if (ok(a) && ok(b) && ok(c)) t.push(a, b, c);
      }
      st.headTris = Uint32Array.from(t);
    }
    const c = hf.at(...HAIR_CENTER);
    const Rs = headRadius(D, B, c, st.headTris);
    const H = HAIR_FILES.has(cfg.hairStyle) ? loadHairAsset(cfg.hairStyle) : null;
    if (H && !(H instanceof Promise)) {
      const g = realHairGeometry(H, hf, Rs, c);
      const solid = new THREE.Mesh(g, realHairMaterial(skinU, H, false));
      solid.castShadow = true; solid.receiveShadow = true; solid.frustumCulled = false; solid.name = 'hair';
      const soft = new THREE.Mesh(g, realHairMaterial(skinU, H, true));
      soft.receiveShadow = true; soft.frustumCulled = false; soft.name = 'hair-soft'; soft.renderOrder = 1;
      group.add(solid, soft);
    } else {
      // while the style's photo loads (or if it can't): a thin hair shell
      const under = { ...hs, T: hs.T.map((t) => t * 0.32), edge: Math.max(hs.edge, 0.3), blunt: null, under: true };
      const mesh = new THREE.Mesh(hairGeometry(D, B, hf, under, Rs, c), hairMaterial(skinU, under));
      mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = 'hair';
      group.add(mesh);
      if (H) { const style = cfg.hairStyle; H.then((v) => { if (v && st.cfg?.hairStyle === style) st.onHairLoaded?.(); }); key = 'loading'; }
    }
  }
  const bs = BEARD_SPECS[cfg.beard];
  if (bs) {
    st.beardTopo ??= {};
    st.beardTopo[cfg.beard] ??= beardTopology(D, bs);
    const mesh = new THREE.Mesh(beardGeometry(D, B, st.beardTopo[cfg.beard], bs), hairMaterial(skinU, { mode: 3, str: [160, 9], rough: 0.6, bump: 0.0005 }));
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.name = 'beard';
    group.add(mesh);
  }
  if (cfg.glasses === 'glasses') { const g = glassesGroup(D, B, hf); g.name = 'glasses'; group.add(g); }
  return key;
}
