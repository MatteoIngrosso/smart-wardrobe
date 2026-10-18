// Run with:  node --test tools/stylist.test.mjs
// Checks that stylist.js (the app's copy of the fashion model) says exactly what the Python
// model says: every rule score and note, and the tip search. The expected answers come from
// fashion-model/tests/parity.json (python -m fashion parity).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as S from "../stylist.js";

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8"));
const bible = read("../fashion-bible.json");
const parity = read("../fashion-model/tests/parity.json");

test("the bible loads", () => {
  assert.equal(S.setBible(bible), true);
  assert.equal(S.ready(), true);
  assert.equal(S.setBible({}), false, "something that isn't a bible is refused");
  assert.equal(S.ready(), true, "and the one in use stays");
  S.setBible(null);
  assert.equal(S.ready(), false);
  S.setBible(bible);
});

test("every rule scores like the Python model", () => {
  S.setBible(bible);
  let checked = 0;
  for (const c of parity.cases) {
    const o = S.outfitFrom(c.pieces);
    const got = {}, notes = {};
    for (const r of S.evaluate(o, c.ctx)) {
      got[r.rule.id] = r.score;
      if (r.note) notes[r.rule.id] = r.note;
    }
    const where = JSON.stringify({ pieces: c.pieces.map((p) => p.category + " " + p.colors), ctx: c.ctx });
    assert.deepEqual(Object.keys(got).sort(), Object.keys(c.x).sort(), `rules that apply differ for ${where}`);
    for (const [id, want] of Object.entries(c.x)) assert.ok(Math.abs(got[id] - want) < 1e-6, `${id}: ${got[id]} vs ${want} for ${where}`);
    assert.deepEqual(notes, c.notes, `notes differ for ${where}`);
    checked++;
  }
  assert.ok(checked > 100);
});

test("the tip search ranks like the Python model", () => {
  S.setBible({ ...bible, tips: parity.tips });
  for (const s of parity.searches) {
    assert.deepEqual(S.tips(s.query, 6, s.occasion).map((t) => t.id), s.ids, s.query);
  }
  S.setBible(bible);
});

const item = (category, colors, extra = {}) => ({ category, colors, ...extra });

test("an app piece becomes what the checks need", () => {
  S.setBible(bible);
  const p = S.pieceFrom({ category: "jacket", colors: ["navy"], name: "Navy wool blazer", tags: ["Slim Fit"], styles: [], fit: "slim", warmth: 0 });
  assert.equal(p.slot, "outer");
  assert.equal(p.warmth, 3, "type's usual warmth when none is set");
  assert.deepEqual(p.styles, ["smart casual"], "type's usual styles when none are set");
  assert.ok(p.has("blazer") && p.has("wool") && p.has("slim fit"));
  assert.equal(S.pieceFrom({ category: "socks" }), null);
  assert.equal(S.pieceFrom({ category: "gym-top", colors: ["black"] }).slot, "base", "gym pieces take their role");
});

test("an outfit that breaks mandatory rules is a violation", () => {
  S.setBible(bible);
  const ctx = { occasion: "work", feels: 16, wet: false };
  const bad = S.judge([item("hoodie", ["grey"]), item("jeans", ["denim"]), item("dress-shoes", ["black"]), item("tie", ["red"])], ctx);
  const titles = bad.violations.map((v) => v.rule.id);
  assert.ok(titles.includes("tie-rules"), titles.join());
  assert.ok(titles.includes("shoe-formality"), titles.join());
  const good = S.judge([item("shirt", ["white"]), item("trousers", ["grey"], { styles: ["smart"] }), item("dress-shoes", ["brown"]), item("belt", ["brown"])], ctx);
  assert.equal(good.violations.length, 0, JSON.stringify(good.violations.map((v) => v.rule.id)));
  assert.ok(good.logit > bad.logit);
});

test("the warmth rule follows the wearer's own preference", () => {
  S.setBible(bible);
  const look = [item("tshirt", ["white"]), item("hoodie", ["grey"]), item("jeans", ["denim"])];
  const plain = S.evaluate(S.outfitFrom(look), { feels: 12 }).find((r) => r.rule.id === "warmth");
  const lighter = S.evaluate(S.outfitFrom(look), { feels: 12, offset: -2 }).find((r) => r.rule.id === "warmth");
  assert.ok(lighter.score > plain.score, "someone who dresses lighter than usual is judged against a lighter target");
});

test("the guide has the mandatory rules and the tips for the question", () => {
  S.setBible(bible);
  const g = S.guideText({ question: "how long should my tie be", occasion: "work" });
  assert.match(g, /STYLE GUIDE/);
  assert.match(g, /A tie needs a collar and long trousers/);
  assert.match(g, /tie/i);
  assert.ok(g.length < 3200, `guide is ${g.length} characters`);
  S.setBible(null);
  assert.equal(S.guideText({ question: "x" }), "");
  assert.equal(S.judge([item("shirt", ["white"])]), null, "without a bible nothing is judged");
  S.setBible(bible);
});

test("looks made of new pieces (type and colour only) can be judged too", () => {
  S.setBible(bible);
  const look = (...pairs) => pairs.map(([category, color]) => ({ category, colors: [color], name: category }));
  assert.equal(S.judge(look(["shirt", "white"], ["trousers", "grey"], ["dress-shoes", "brown"], ["belt", "brown"]), { occasion: "work" }).violations.length, 0);
  const clash = S.judge(look(["shirt", "red"], ["trousers", "pink"], ["sneakers", "green"], ["tshirt", "orange"]), { occasion: "casual" });
  assert.ok(clash.violations.some((v) => v.rule.id === "clashing-pairs"), "red and pink clash");
});

test("a belt must match the leather shoes", () => {
  S.setBible(bible);
  const shoes = item("dress-shoes", ["brown"], { tags: ["leather"] });
  assert.ok(S.ruleScore([shoes, item("belt", ["black"])], "belt-shoes") <= -0.5);
  assert.equal(S.ruleScore([shoes, item("belt", ["brown"])], "belt-shoes"), 1);
  assert.equal(S.ruleScore([shoes, item("belt", ["red"])], "belt-shoes"), null, "no leather colour to compare");
});
