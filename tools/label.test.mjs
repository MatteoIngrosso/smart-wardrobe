// Run with:  node --test tools/label.test.mjs
// Checks how label.js reads product references, shop links and product page text.
import assert from "node:assert/strict";
import test from "node:test";
import * as L from "../label.js";

test("references as labels print them", () => {
  for (const t of ["REF. 3660/516/833", "Ref 3660 516 833", "03660/516/833", "MOD. 3660-516-833", "3660516833"]) {
    assert.deepEqual(L.refFrom(t), { model: "03660516", colour: "833", text: "3660/516/833" }, t);
  }
  assert.deepEqual(L.refFrom("7683/515"), { model: "07683515", colour: "", text: "7683/515" });
  assert.equal(L.refFrom("8445678123456"), null, "a barcode number isn't a reference");
  assert.equal(L.refFrom("29,99 EUR · M"), null);
  assert.equal(L.refFrom(""), null);
});

test("references inside Pull&Bear links", () => {
  assert.deepEqual(L.refInUrl("https://www.pullandbear.com/it/jeans-baggy-l03660516?cS=833&pelement=1"), { model: "03660516", colour: "833", text: "3660/516/833" });
  assert.deepEqual(L.refInUrl("https://www.pullandbear.com/us/baggy-jeans-l03660516"), { model: "03660516", colour: "", text: "3660/516" });
  assert.equal(L.refInUrl("https://www.pullandbear.com/it/"), null);
  assert.equal(L.refInUrl("not a link"), null);
});

test("Pull&Bear product links are built from the reference", () => {
  const ref = L.refFrom("3660/516/833");
  for (const b of ["Pull&Bear", "PULL & BEAR", "pull and bear", "https://www.pullandbear.com/it/"]) assert.ok(L.isPullBear(b), b);
  assert.equal(L.isPullBear("Bershka"), false);
  assert.equal(L.shopUrl("Pull&Bear", ref, "it"), "https://www.pullandbear.com/it/p-l03660516?cS=833");
  assert.equal(L.shopUrl("Pull&Bear", ref, "com"), "https://www.pullandbear.com/us/p-l03660516?cS=833");
  assert.equal(L.shopUrl("Zara", ref), "", "only shops whose links can be built");
  assert.equal(L.shopUrl("Pull&Bear", null), "");
});

test("whether the shop's photo is the colour on the label", () => {
  const img = "https://static.pullandbear.net/assets/public/a1a1/449f/3ac34c88a0a8/a23cdb916529/03660516833-M/03660516833-M.jpg?ts=1";
  assert.equal(L.photoColourMatches(img, L.refFrom("3660/516/833")), true);
  assert.equal(L.photoColourMatches(img, L.refFrom("3660/516/400")), false);
  assert.equal(L.photoColourMatches(img, L.refFrom("3660/516")), null, "no colour on the label");
  assert.equal(L.photoColourMatches("https://shop.example/photo.jpg", L.refFrom("3660/516/833")), null);
});

test("product page titles and Italian words", () => {
  assert.equal(L.cleanTitle("Jeans baggy | Pull&Bear Italy"), "Jeans baggy");
  assert.equal(L.cleanTitle("Baggy jeans - Pull&Bear United States"), "Baggy jeans");
  assert.equal(L.cleanTitle("Levi's 501 Original Jeans", "Levi's"), "501 Original Jeans");
  assert.equal(L.toEnglish("Felpa con cappuccio nera"), "hoodie black");
  assert.equal(L.toEnglish("Pantaloni cargo ampi"), "trousers cargo baggy");
  assert.equal(L.toEnglish("Baggy jeans with a five-pocket design"), "baggy jeans with a five-pocket design", "English stays as it is");
  assert.equal(L.fitIn("Jeans baggy"), "baggy");
  assert.equal(L.fitIn("Jeans super baggy"), "baggy");
  assert.equal(L.fitIn("Camicia regular fit"), "regular");
  assert.equal(L.fitIn("Pantaloni dritti"), "straight");
  assert.equal(L.fitIn("Hoodie"), "");
});

test("links in QR codes", () => {
  assert.equal(L.linkIn("https://www.pullandbear.com/it/jeans-baggy-l03660516?cS=833"), "https://www.pullandbear.com/it/jeans-baggy-l03660516?cS=833");
  assert.equal(L.linkIn("www.pullandbear.com/qr/AB12"), "https://www.pullandbear.com/qr/AB12");
  assert.equal(L.linkIn("8445678123456"), "");
  assert.equal(L.linkIn("javascript:alert(1)"), "");
  assert.equal(L.linkIn(""), "");
});
