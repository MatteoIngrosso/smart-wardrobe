// Garment fit and made backs (round 9): the sizes a piece gets from its photo and the wearer's Scale
// and Vertical offset, and the back made on the device for a piece photographed from the front only.
// Pure functions, no browser: node --test tools/fit-back.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { topSize, bottomsSize, cleanCutMeta, CUT_SCALE, CUT_OFFSET } from "../avatar-config.js";
import { synthBack, BAKER_VERSION } from "../garment-baker.js";

test("cutoutMeta is cleaned and clamped", () => {
  assert.deepEqual(cleanCutMeta(null), { scale: 1, offsetY: 0 });
  const m = cleanCutMeta({ scale: 9, offsetY: -30, aspectRatio: "1.33333", trimBounds: [0.1, 0.2, 0.5, 0.6] });
  assert.equal(m.scale, CUT_SCALE[1]);
  assert.equal(m.offsetY, CUT_OFFSET[0]);
  assert.equal(m.aspectRatio, 1.333);
  assert.deepEqual(m.trimBounds, [0.1, 0.2, 0.5, 0.6]);
  assert.equal(cleanCutMeta({ scale: "x", offsetY: "" }).scale, 1);
  assert.equal(cleanCutMeta({ trimBounds: [1, 2] }).trimBounds, undefined);
});

test("a tee laid flat sets its own length; a cropped one ends higher than a long one", () => {
  const cropped = topSize({ shape: { ratio: 1.18, how: "run" } }, { hem: 0.45 });
  const regular = topSize({ shape: { ratio: 1.27, how: "run" } }, { hem: 0.45 });
  const long = topSize({ shape: { ratio: 1.6, how: "run" } }, { hem: 0.45 });
  assert.ok(cropped.hem > regular.hem && regular.hem > long.hem, JSON.stringify([cropped, regular, long]));
  // never down past the top of the legs
  assert.ok(long.hem >= 0.05);
  // a width the print keeps: about the flat chest, so a print isn't squeezed onto the silhouette
  assert.ok(regular.width > 4 && regular.width < 5, String(regular.width));
});

test("a hoodie's photo width isn't trusted for its length: the kind's hem stays", () => {
  const z = topSize({ shape: { ratio: 2.1, how: "seams" } }, { hem: 0.58 });
  assert.equal(z.hem, 0.58);
  assert.equal(z.changed, false);
  assert.ok(z.width >= 2.6 && z.width <= 5.6);
});

test("Scale and Vertical offset move a top's hem", () => {
  const base = topSize({}, { hem: 0.45 });
  const longer = topSize({ adjust: { scale: 1.1 } }, { hem: 0.45 });
  const higher = topSize({ adjust: { offsetY: 5 } }, { hem: 0.45 });
  assert.ok(longer.hem < base.hem, "longer");
  assert.ok(Math.abs(higher.hem - (base.hem + 0.5)) < 0.03, "5 cm higher");
});

test("shorts stay short and trousers reach the ankle", () => {
  const shorts = bottomsSize({ shape: { ratio: 1.5 } }, { short: true });
  const longShorts = bottomsSize({ shape: { ratio: 1.79 } }, { short: true });
  const jeans = bottomsSize({ shape: { ratio: 2.27 } }, { leg: 1 });
  assert.ok(shorts.leg < 0.6 && longShorts.leg > shorts.leg && longShorts.leg <= 0.66, JSON.stringify([shorts, longShorts]));
  assert.equal(jeans.leg, 1);
  // no measurement: the kind's own length
  assert.equal(bottomsSize({}, { short: true }).leg, 0.5);
  // Scale shortens the legs from the waistband; the offset raises waistband and hems together
  const scaled = bottomsSize({ shape: { ratio: 2.27 }, adjust: { scale: 0.9 } }, { leg: 1 });
  assert.ok(scaled.leg < 1);
  const raised = bottomsSize({ adjust: { offsetY: 4 } }, { leg: 1 });
  assert.ok(raised.waist > 2.3 && raised.leg < 1);
});

// a fabric as the baker describes it: its colour and a ΔE-like distance of every 15-bit colour to it
function fabricOf(rgb) {
  const dist = new Float32Array(32768);
  for (let i = 0; i < 32768; i++) {
    const r = ((i >> 10) & 31) * 8 + 4, g = ((i >> 5) & 31) * 8 + 4, b = (i & 31) * 8 + 4;
    dist[i] = Math.hypot(r - rgb[0], g - rgb[1], b - rgb[2]) / 2.5;
  }
  return { rgb, tol: 12, dist };
}
const grain = { hf: new Float32Array(256 * 256 * 3).map((_, i) => ((i * 7919) % 13) - 6) };

test("a front print doesn't reach the back; the back is the fabric's own colour", () => {
  const w = 96, h = 128, src = new Float32Array(w * h * 3).fill(235), valid = new Uint8Array(w * h).fill(1);
  // a black logo on the wearer's left chest (the photo's right)
  for (let y = 20; y < 44; y++) for (let x = 56; x < 80; x++) src.fill(15, (y * w + x) * 3, (y * w + x) * 3 + 3);
  const out = synthBack(src, w, h, fabricOf([235, 235, 235]), grain, { kind: "top", sub: "tee", valid });
  assert.equal(out.pattern, false);
  let darkest = 255;
  for (let i = 0; i < w * h; i++) darkest = Math.min(darkest, out.rgb[i * 3]);
  assert.ok(darkest > 150, `no logo left (darkest ${darkest})`);
});

test("an all-over pattern stays on the back", () => {
  const w = 96, h = 128, src = new Float32Array(w * h * 3), valid = new Uint8Array(w * h).fill(1);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) src.fill(((y >> 3) & 1) ? 30 : 220, (y * w + x) * 3, (y * w + x) * 3 + 3);
  const out = synthBack(src, w, h, fabricOf([220, 220, 220]), grain, { kind: "top", sub: "tee", valid });
  assert.equal(out.pattern, true);
  let lo = 0;
  for (let i = 0; i < w * h; i++) if (out.rgb[i * 3] < 90) lo++;
  assert.ok(lo > w * h * 0.3, "the stripes are kept");
});

test("with an outline: mirrored, the open front closed and the neckline raised", () => {
  const w = 100, h = 120, src = new Float32Array(w * h * 3).fill(60), alpha = new Uint8ClampedArray(w * h);
  // a tee's outline: shoulders at row 10, a deep V neck in the middle (down to row 40), body offset to the left
  for (let y = 10; y < h; y++) for (let x = 8; x < 88; x++) {
    const dip = Math.max(0, 30 - Math.abs(x - 48) * 1.5);
    if (y >= 10 + dip) alpha[y * w + x] = 255;
  }
  const valid = Uint8Array.from(alpha, (a) => (a ? 1 : 0));
  const out = synthBack(src, w, h, fabricOf([60, 60, 60]), grain, { kind: "top", sub: "tee", valid, alpha });
  // mirrored: the body ran from 8 to 87, so it now runs from 12 to 91
  assert.equal(out.alpha[60 * w + 10], 0);
  assert.equal(out.alpha[60 * w + 90], 255);
  // the back neckline is much shallower than the front's V
  const topAt = (a, x) => { for (let y = 0; y < h; y++) if (a[y * w + x] >= 128) return y; return h; };
  assert.ok(topAt(out.alpha, 52) < topAt(alpha, 48) - 15, `raised (${topAt(out.alpha, 52)} vs ${topAt(alpha, 48)})`);
  assert.ok(out.neck && out.neck.raised > 10);
});

test("bottoms get their back seams (darker lines), and the baker's version moved on", () => {
  const w = 120, h = 240, src = new Float32Array(w * h * 3).fill(120), valid = new Uint8Array(w * h).fill(1);
  const out = synthBack(src, w, h, fabricOf([120, 120, 120]), { hf: new Float32Array(256 * 256 * 3) }, { kind: "bottoms", sub: "jeans", valid, crotchV: 0.7, ratio: 2.3, aspect: 0.6, denim: true });
  // the seat seam down the middle, under the waistband
  const mid = out.rgb[(Math.round(h * 0.15) * w + Math.round((w - 1) / 2)) * 3], side = out.rgb[(Math.round(h * 0.15) * w + Math.round(w * 0.12)) * 3];
  assert.ok(mid < side - 3, `seam ${mid} vs ${side}`);
  assert.ok(BAKER_VERSION >= 5);
});
