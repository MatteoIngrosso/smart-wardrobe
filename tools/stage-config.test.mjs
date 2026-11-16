// The Lookbook look's contracts (lookbook-config.js): its slots, which pieces go in each, and the
// per-piece nudge kept on the piece as cutoutMeta.  Run: node --test tools/stage-config.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { STAGE_SLOTS, SLOT_IDS, ROLE_TO_SLOT, STAGE_LAYOUT, SIDE_ORDER, accSlotOf, slotCats, isShort, cleanCutMeta, isPlainCut, CUT_SCALE, CUT_OFFSET, CUT_Z } from "../lookbook-config.js";

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

test("the stage's sideways nudge and layer step are kept only when set, and clamped", () => {
  assert.equal("offsetX" in cleanCutMeta({ offsetX: 0 }), false);
  assert.equal("z" in cleanCutMeta({ z: 0 }), false);
  const m = cleanCutMeta({ offsetX: 40, z: -9 });
  assert.equal(m.offsetX, CUT_OFFSET[1]);
  assert.equal(m.z, CUT_Z[0]);
  assert.equal(cleanCutMeta({ offsetX: 1.26 }).offsetX, 1.5); // half-cm steps
  assert.ok(isPlainCut({ scale: 1, offsetY: 0, aspectRatio: 1.2 }));
  assert.ok(!isPlainCut({ offsetX: 2 }));
  assert.ok(!isPlainCut({ z: 1 }));
});

test("every outfit role and every stage accessory has one slot", () => {
  for (const s of STAGE_SLOTS) assert.ok(s.where === "column" ? STAGE_LAYOUT[s.id] : SIDE_ORDER[s.where].includes(s.id), s.id);
  assert.deepEqual([...new Set(Object.values(ROLE_TO_SLOT))].sort(), ["bottoms", "jacket", "layer", "shoes", "top"]);
  assert.equal(new Set(SLOT_IDS).size, SLOT_IDS.length);
  const cats = STAGE_SLOTS.flatMap((s) => s.cats || []);
  assert.equal(new Set(cats).size, cats.length, "a category in one slot only");
  assert.equal(accSlotOf("belt"), "belt");
  assert.equal(accSlotOf("tie"), "tie");
  assert.equal(accSlotOf("cap"), "hat");
  assert.equal(accSlotOf("ring"), "jewelry");
  assert.equal(accSlotOf("sunglasses"), "eyewear");
  assert.equal(accSlotOf("backpack"), "bag");
  assert.equal(accSlotOf("umbrella"), null);
  assert.deepEqual(slotCats("top"), []);
  assert.ok(isShort({ category: "shorts" }) && !isShort({ category: "jeans" }));
});

test("the column runs hat, tops, belt, bottoms, shoes from top to bottom", () => {
  const L = STAGE_LAYOUT;
  assert.ok(L.hat.top < L.top.top && L.top.top < L.belt.top && L.belt.top < L.bottoms.top && L.bottoms.top < L.shoes.top);
  // Drawn back to front: bottoms behind the top, the top behind its layer and the jacket, the hat in front.
  assert.ok(L.bottoms.z < L.top.z && L.top.z < L.tie.z && L.tie.z < L.layer.z && L.layer.z < L.jacket.z && L.jacket.z < L.hat.z);
  assert.ok(L.bottoms.z < L.belt.z);
  for (const [id, l] of Object.entries(L)) assert.ok(l.top >= 0 && l.top + l.h <= 1.0001, id);
});
