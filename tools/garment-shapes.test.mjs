// Which 3D shape each wardrobe piece is drawn with on the Avatar (avatar-config.js subTypeOf), and that
// the baker and the stage both know every shape.  Run: node --test tools/garment-shapes.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { subTypeOf, defaultClose } from "../avatar-config.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (f) => readFileSync(join(ROOT, f), "utf8");
const shape = (category, name = "", tags) => subTypeOf({ category, name, tags });

test("shirts, polos, blazers and dress shoes get their own shapes", () => {
  assert.equal(shape("shirt", "white dress shirt", ["button-down", "long-sleeve"]), "shirt");
  assert.equal(shape("shirt", "Linen short sleeve shirt"), "shortshirt");
  assert.equal(shape("shirt", "Camp collar shirt", ["short-sleeve"]), "shortshirt");
  assert.equal(shape("polo", "Navy Ralph Lauren polo"), "polo");
  assert.equal(shape("tshirt", "White tee"), "tee");
  // a blazer is a blazer whatever it was saved as (his navy blazer is an "overshirt")
  assert.equal(shape("overshirt", "Dark blue single-breasted blazer"), "blazer");
  assert.equal(shape("jacket", "Navy suit jacket"), "blazer");
  assert.equal(shape("coat", "Grey tweed sport coat"), "blazer");
  assert.equal(shape("overshirt", "Denim overshirt"), "sweater");
  assert.equal(shape("jacket", "Black Zara jacket"), "jacket_open");
  assert.equal(shape("jacket", "Tommy Jeans bomber"), "bomber");
  assert.equal(shape("dress-shoes", "Black GEOX dress shoes"), "dress");
  assert.equal(shape("sneakers", "Brown suede loafers"), "dress");
  assert.equal(shape("sneakers", "Jordan 1 Mid"), "sneakers");
  assert.equal(shape("boots", "Timberland Boots"), "boots");
  assert.equal(shape("zip-hoodie", "Burgundy zip hoodie"), "ziphoodie");
  assert.equal(shape("hoodie", "Stüssy hoodie"), "hoodie");
  assert.equal(shape("watch", "Omega"), null);
});

test("how a piece that opens is worn when nothing says", () => {
  assert.equal(defaultClose({ category: "overshirt", name: "Navy blazer" }), "buttoned");
  assert.equal(defaultClose({ category: "zip-hoodie", name: "Zip hoodie" }), "closed");
  assert.equal(defaultClose({ category: "jacket", name: "Black Zara jacket" }), "open");
  assert.equal(defaultClose({ category: "coat", name: "Navy wool coat" }), "open");
});

test("the baker and the stage know every shape", () => {
  const cats = [...src("app.js").matchAll(/\{ id: "([\w-]+)", label: "[^"]+", slot: "(?:base|mid|outer|bottom|shoes|gym)"/g)].map((m) => m[1]);
  assert.ok(cats.length > 20, "categories found in app.js");
  const names = ["", "blazer", "loafers", "short sleeve", "puffer", "bomber", "cargo", "joggers"];
  const shapes = new Set();
  for (const c of cats) for (const n of names) { const s = shape(c, n); if (s) shapes.add(s); }
  const stage = src("avatar-stage.js"), baker = src("garment-baker.js");
  const specs = stage.slice(stage.indexOf("const SPECS = {"), stage.indexOf("const puffOf"));
  const slotOf = baker.match(/const SLOT_OF = \{([^}]*)\}/)[1], kindOf = baker.match(/const KIND_OF = \{([^}]*)\}/)[1];
  for (const s of shapes) {
    assert.match(specs, new RegExp(`\\n  ${s}: \\{ slot: '`), `stage SPECS has ${s}`);
    assert.match(slotOf, new RegExp(`\\b${s}: "`), `baker SLOT_OF has ${s}`);
    assert.match(kindOf, new RegExp(`\\b${s}: "`), `baker KIND_OF has ${s}`);
  }
  for (const s of ["shirt", "shortshirt", "polo", "blazer", "ziphoodie", "dress"]) assert.ok(shapes.has(s), s);
  // every draped shape has its cloth cut (CLOTH_TYPE), except the quilted puffer, which keeps its shell
  const cloth = stage.slice(stage.indexOf("const CLOTH_TYPE = {"), stage.indexOf("const CLOTH_STEPS"));
  for (const s of shapes) {
    if (!/slot: '(top|layer|jacket)'/.test(specs.match(new RegExp(`\\n  ${s}: \\{[^\\n]*`))[0]) || s === "puffer") continue;
    assert.match(cloth, new RegExp(`\\n  ${s}: \\{`), `CLOTH_TYPE has ${s}`);
  }
});
