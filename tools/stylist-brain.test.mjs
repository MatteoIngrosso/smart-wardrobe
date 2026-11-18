// StylistBrain (stylist-brain.js): what fit checks teach, the photo metrics, the local AI server.
// Run with:  node --test tools/stylist-brain.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import * as Brain from "../stylist-brain.js";

const NOW = Date.parse("2026-11-15T12:00:00Z");
const ago = (days) => new Date(NOW - days * 864e5).toISOString();
const items = [
  ["tee", "tshirt"], ["shirt", "shirt"], ["knit", "sweater"], ["jeans", "jeans"], ["chinos", "trousers"],
  ["sneak", "sneakers"], ["boots", "boots"], ["belt", "belt"], ["tie", "tie"], ["chain", "necklace"], ["watch", "watch"],
].map(([id, category]) => ({ id, category }));
const byId = new Map(items.map((i) => [i.id, i]));
const check = (fields) => ({ at: ago(0), date: "2026-11-15", occasion: "casual", slots: { base: "tee", bottom: "jeans", shoes: "sneak" }, extras: [], stars: 3, tags: [], ...fields });
const brainOf = (...checks) => ({ v: 1, checks: Object.fromEntries(checks.map((c, k) => [`c${k}`, c])) });
const pk = Brain.pairKey;

test("summarize keeps the outfit, stars and known tags, no photo", () => {
  const s = Brain.summarize({ id: "x", at: ago(0), date: "2026-11-15", occasion: "work", itemIds: { base: "shirt", bottom: "chinos" }, extras: ["belt"], stars: 4, tags: ["belt", "nonsense"], photo: {}, metrics: { contrast: 0.5 } });
  assert.deepEqual(s, { at: ago(0), date: "2026-11-15", occasion: "work", slots: { base: "shirt", bottom: "chinos" }, extras: ["belt"], stars: 4, tags: ["belt"] });
});

test("the five kinds of pairs", () => {
  const kinds = Brain.pairsOf(check({ slots: { base: "shirt", mid: "knit", bottom: "chinos", shoes: "boots" }, extras: ["belt", "tie", "chain", "watch"] }), byId).map(([k, a, b]) => `${k}:${a}+${b}`);
  assert.deepEqual(kinds, ["top-bottom:knit+chinos", "bottom-shoes:chinos+boots", "shoes-belt:boots+belt", "top-tie:shirt+tie", "top-jewelry:shirt+chain"]);
});

test("5 stars add to every pair, 1 star takes away", () => {
  const good = Brain.learn(brainOf(check({ stars: 5, extras: ["belt"] })), byId, NOW);
  assert.ok(good.pairs[pk("tee", "jeans")] > 1);
  assert.ok(good.pairs[pk("jeans", "sneak")] > 1);
  assert.ok(good.pairs[pk("sneak", "belt")] > 1);
  const bad = Brain.learn(brainOf(check({ stars: 1 })), byId, NOW);
  assert.ok(bad.pairs[pk("tee", "jeans")] < -1);
  assert.equal(Brain.learn(brainOf(check({ stars: 3 })), byId, NOW).pairs[pk("tee", "jeans")], undefined, "3 stars: nothing");
});

test("a tag hits the pair it names hardest", () => {
  const clash = Brain.learn(brainOf(check({ stars: 3, tags: ["clash"] })), byId, NOW).pairs;
  assert.ok(clash[pk("tee", "jeans")] < clash[pk("jeans", "sneak")], "colours clashed: top and bottom");
  const shoes = Brain.learn(brainOf(check({ stars: 3, tags: ["shoes"], extras: ["belt"] })), byId, NOW).pairs;
  assert.ok(shoes[pk("jeans", "sneak")] <= -1.5);
  assert.ok(shoes[pk("sneak", "belt")] < 0);
  assert.equal(shoes[pk("tee", "jeans")], undefined, "wrong shoes says nothing about the top");
  const loved = Brain.learn(brainOf(check({ stars: 4, tags: ["accessories"], extras: ["belt"] })), byId, NOW).pairs;
  assert.ok(loved[pk("sneak", "belt")] > loved[pk("jeans", "sneak")]);
});

test("the same 60-day half-life as taste()", () => {
  const now = Brain.learn(brainOf(check({ stars: 5 })), byId, NOW).pairs[pk("tee", "jeans")];
  const old = Brain.learn(brainOf(check({ stars: 5, at: ago(60) })), byId, NOW).pairs[pk("tee", "jeans")];
  assert.ok(Math.abs(old - now / 2) < 1e-9);
});

test("boxy tops, belts needed, loose pants", () => {
  const l = Brain.learn(brainOf(check({ slots: { base: "tee", mid: "knit", bottom: "jeans", shoes: "sneak" }, tags: ["boxy", "belt", "pants"] })), byId, NOW);
  assert.ok(l.boxy.knit > 0.99, "the outer top of the two");
  assert.ok(l.needsBelt.jeans > 0.99);
  assert.ok(l.loose.jeans > 0.99);
  assert.equal(l.n, 1);
  // pieces gone from the wardrobe teach nothing
  assert.deepEqual(Brain.learn(brainOf(check({ slots: { base: "gone", bottom: "jeans" }, stars: 5 })), byId, NOW).pairs, {});
});

// A test photo: a light wall, a navy top from 15% to 44% of the height, beige trousers to 92%.
function photo(w = 120, h = 240, { topEnd = 0.44 } = {}) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, inBody = x > w * 0.32 && x < w * 0.68;
    let c = [232, 228, 220];
    if (inBody && y >= h * 0.15 && y < h * topEnd) c = [30, 40, 80];
    else if (inBody && y >= h * topEnd && y < h * 0.92) c = [200, 180, 140];
    data.set([...c, 255], i);
  }
  return data;
}

test("analysePixels finds the person, the contrast and the waistline", () => {
  const m = Brain.analysePixels(photo(), 120, 240);
  assert.equal(m.guessed, false);
  assert.ok(Math.abs(m.waist - (0.44 - 0.15) / (0.92 - 0.15)) < 0.04, `waist ${m.waist}`);
  assert.ok(m.contrast > 0.5, `contrast ${m.contrast}`);
  const boxy = Brain.analysePixels(photo(120, 240, { topEnd: 0.535 }), 120, 240);
  assert.ok(boxy.waist >= 0.47, `a top down to mid-thigh reads as a half split (${boxy.waist})`);
  const lines = Brain.metricLines({ ...m, cohesion: 0.8, palette: ["navy", "beige"] });
  assert.match(lines.join(" | "), /good thirds/);
  assert.match(lines.join(" | "), /Colours that go together \(navy, beige\)/);
  assert.match(Brain.metricLines(boxy).join(" | "), /boxy half split/);
});

test("one colour top to bottom: no waistline, and a blank photo falls back to the middle", () => {
  const w = 60, h = 120, data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(i % w > 20 && i % w < 40 && i > w * 10 ? [20, 20, 20, 255] : [240, 240, 240, 255], i * 4);
  assert.equal(Brain.analysePixels(data, w, h).waist, null);
  const blank = new Uint8ClampedArray(w * h * 4).fill(255);
  assert.equal(Brain.analysePixels(blank, w, h).guessed, true);
});

test("tags from an AI answer, by id or label", () => {
  assert.deepEqual(Brain.matchTags(["Needed a belt", "clash", "top too boxy", "???", "belt"]), ["belt", "clash", "boxy"]);
  assert.equal(Brain.cleanAIUrl(""), "");
  assert.equal(Brain.cleanAIUrl("ftp://x"), null);
  assert.equal(Brain.cleanAIUrl("not a url"), null);
  assert.equal(Brain.cleanAIUrl("https://pc.local:8080/fit"), "https://pc.local:8080/fit");
});

test("analyzeWithExternalAI: the server's answer merged, else the device's metrics", async () => {
  const local = async () => ({ contrast: 0.4, waist: 0.4, cohesion: 0.6 });
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: "image/webp" });
  // no URL: the device only, and nothing is sent
  let calls = 0;
  const none = await Brain.analyzeWithExternalAI(blob, {}, { local, url: "", fetchImpl: async () => { calls++; } });
  assert.equal(none.source, "device");
  assert.equal(calls, 0);
  // an answer: merged
  let sent;
  const ok = await Brain.analyzeWithExternalAI(blob, { slots: { base: { id: "tee" } } }, {
    local, url: "https://ai.example/fit",
    fetchImpl: async (u, opts) => { sent = { u, opts }; return { ok: true, json: async () => ({ tags: ["Needed a belt"], metrics: { contrast: 0.9, waist: 2 }, notes: ["Try a darker shoe"] }) }; },
  });
  assert.equal(sent.u, "https://ai.example/fit");
  assert.equal(sent.opts.method, "POST");
  assert.ok(sent.opts.body.get("photo") instanceof Blob);
  assert.deepEqual(JSON.parse(sent.opts.body.get("outfit")), { slots: { base: { id: "tee" } } });
  assert.equal(ok.source, "local AI server");
  assert.deepEqual(ok.aiTags, ["belt"]);
  assert.equal(ok.contrast, 0.9);
  assert.equal(ok.waist, 1, "clamped to 0..1");
  assert.equal(ok.cohesion, 0.6, "kept from the device");
  assert.deepEqual(ok.notes, ["Try a darker shoe"]);
  // an error, or no answer in time: the device's metrics
  const err = await Brain.analyzeWithExternalAI(blob, {}, { local, url: "https://ai.example/fit", fetchImpl: async () => ({ ok: false, status: 500 }) });
  assert.equal(err.source, "device");
  assert.equal(err.contrast, 0.4);
  assert.match(err.aiError, /couldn't be reached/);
  const slow = await Brain.analyzeWithExternalAI(blob, {}, {
    local, url: "https://ai.example/fit", timeout: 50,
    fetchImpl: (u, { signal }) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
  });
  assert.equal(slow.source, "device");
  assert.match(slow.aiError, /within 15 s/);
});

// ---------- how each piece was worn (fit check → avatar) ----------
test("wear: which ways a piece can be worn, and only known values are kept", () => {
  assert.deepEqual(Brain.wearFields("coat", "coat"), ["close"]);
  assert.deepEqual(Brain.wearFields("outer", "jacket"), ["close"]);
  assert.deepEqual(Brain.wearFields("mid", "jacket"), ["close"], "a blazer saved as a layer still buttons");
  assert.deepEqual(Brain.wearFields("base", "shirt"), ["tuck", "sleeves"]);
  assert.deepEqual(Brain.wearFields("bottom", "trousers"), ["break"]);
  assert.deepEqual(Brain.wearFields("shoes", "dress-shoes"), []);
  assert.deepEqual(Brain.cleanWear({ a: { close: "open", tuck: "sideways" }, b: { nope: 1 }, "": { close: "open" } }), { a: { close: "open" } });
  assert.equal(Brain.cleanWear({}), null);
  assert.equal(Brain.wearWord("close", "closed"), "Closed up");
});

test("wear: the summary keeps the coat and the wear", () => {
  const s = Brain.summarize({ at: "2026-11-14T09:00:00Z", date: "2026-11-14", occasion: "work", itemIds: { base: "s" }, coat: "c", extras: [], stars: 5, tags: [], wear: { c: { close: "open", x: 1 } } });
  assert.equal(s.coat, "c");
  assert.deepEqual(s.wear, { c: { close: "open" } });
  assert.equal("wear" in Brain.summarize({ itemIds: {}, extras: [] }), false);
});

test("wear: the same occasion first, then the check sharing the most pieces, then the newest", () => {
  const brain = { checks: {
    a: { at: "2026-11-01T08:00:00Z", date: "2026-11-01", occasion: "work", slots: { base: "shirt", outer: "blazer" }, coat: "coat", extras: [], wear: { coat: { close: "closed" }, shirt: { tuck: "in" } } },
    b: { at: "2026-11-10T20:00:00Z", date: "2026-11-10", occasion: "night", slots: { base: "shirt", outer: "blazer" }, coat: "coat", extras: [], wear: { coat: { close: "open" }, shirt: { tuck: "out" } } },
    c: { at: "2026-11-12T20:00:00Z", date: "2026-11-12", occasion: "work", slots: { base: "tee" }, coat: "coat", extras: [], wear: { coat: { close: "buttoned" } } },
  } };
  const ids = ["shirt", "blazer", "coat"];
  const work = Brain.wearFor(brain, ids, "work");
  assert.equal(work.coat.close, "closed", "the work check with the same suit beats a newer work check with a tee");
  assert.equal(work.shirt.tuck, "in");
  assert.equal(work.coat.from, "2026-11-01");
  const night = Brain.wearFor(brain, ids, "night");
  assert.deepEqual([night.coat.close, night.shirt.tuck], ["open", "out"]);
  const casual = Brain.wearFor(brain, ids, "casual");
  assert.equal(casual.coat.close, "open", "no casual check: the ones sharing the most pieces (a and b), the newest of them");
  assert.deepEqual(Brain.wearFor(brain, ["jeans"], "work"), {});
  assert.deepEqual(Brain.wearFor({}, ids, "work"), {});
});

test("wear: the request is short, and the answer maps back to the piece ids", () => {
  const r = Brain.wearRequest([
    { id: "c1", role: "coat", name: "Navy wool coat", category: "coat" },
    { id: "s1", role: "base", name: "White shirt", category: "shirt" },
    { id: "sh", role: "shoes", name: "Black shoes", category: "dress-shoes" },
  ]);
  assert.equal(Object.keys(r.refs).length, 2, "shoes have nothing to read");
  assert.ok(r.text.length < 700, `${r.text.length} characters`);
  assert.ok(r.maxTokens <= 200);
  assert.deepEqual(r.schema.properties.pieces.items.properties.close.enum, ["open", "buttoned", "closed", "n/a"]);
  const p = Brain.parseWear(JSON.stringify({ pieces: [
    { ref: "p1", seen: true, close: "open", tuck: "in", sleeves: "n/a", break: "n/a" }, // (a coat has no tuck: dropped)
    { ref: "p2", seen: false, close: "n/a", tuck: "in", sleeves: "down", break: "n/a" },
    { ref: "p9", seen: true, close: "open" },
  ], note: "collar up" }), r.refs);
  assert.deepEqual(p.wear, { c1: { close: "open" } });
  assert.deepEqual(p.unseen, ["s1"]);
  assert.equal(p.note, "collar up");
  assert.deepEqual(Brain.parseWear("not json", r.refs).wear, null);
  assert.ok(Brain.wearRequest([]).empty);
});
