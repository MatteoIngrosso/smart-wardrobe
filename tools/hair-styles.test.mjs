// Every hairstyle on the body panel can be drawn: a shape in HAIR_SPECS (avatar-stage.js) for both
// hair looks, and, for a photographed (Rocketbox) style, its two files in avatar/hair/.
// Run: node --test tools/hair-styles.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { HAIR_STYLES } from "../avatar-config.js";

const src = readFileSync(new URL("../avatar-stage.js", import.meta.url), "utf8");
const block = src.slice(src.indexOf("const HAIR_SPECS = {"), src.indexOf("};", src.indexOf("const HAIR_SPECS = {")));
const specs = new Set([...block.matchAll(/^\s{2}([a-z]+):/gm)].map((m) => m[1]));
const files = [...src.match(/const HAIR_FILES = new Set\(\[([^\]]*)\]\)/)[1].matchAll(/'([a-z]+)'/g)].map((m) => m[1]);

test("every style has a shape, and only men's styles are listed", () => {
  const ids = HAIR_STYLES.map((h) => h.id);
  assert.equal(new Set(ids).size, ids.length, "no duplicate ids");
  for (const id of ids) assert.ok(specs.has(id), `HAIR_SPECS has ${id}`);
  for (const id of specs) assert.ok(ids.includes(id), `${id} is offered on the body panel`);
  assert.ok(ids.length >= 21);
});

test("every photographed style ships its files", () => {
  for (const id of files) {
    assert.ok(specs.has(id), `${id} has a shape for the Sculpted look`);
    for (const ext of ["json", "webp"]) assert.ok(existsSync(new URL(`../avatar/hair/${id}.${ext}`, import.meta.url)), `avatar/hair/${id}.${ext}`);
  }
});
