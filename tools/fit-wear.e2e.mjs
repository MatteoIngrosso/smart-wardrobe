// How each piece is worn, from a fit check photo to the 3D avatar (Playwright, Chromium, Gemini stubbed):
// - the review sheet asks Gemini once (a small JPEG, one line per piece) and shows what it read as
//   chips to correct; it's saved on the check and in the brain
// - the avatar wears the outfit that way: a coat over the blazer (blazer in the layer's place), its
//   front open/buttoned/closed, the top tucked, the tie painted on the shirt's front
// - Today's idea card: + Coat over the blazer, change it, No coat
// - a saved check: chips to correct it, "Read it from the photo" again
// Run with:  node --test tools/fit-wear.e2e.mjs      (SHOTS=<dir> also saves screenshots)
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// A copy of the app with every top-level function and constant of app.js on window.__t.
const dir = mkdtempSync(join(tmpdir(), "wardrobe-wear-"));
for (const f of readdirSync(ROOT)) if (/\.(js|css|html|json|webmanifest|svg|png)$/.test(f) && !/^(package|wrangler)/.test(f)) cpSync(join(ROOT, f), join(dir, f));
for (const d of ["sample", "vendor", "avatar"]) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
const src = readFileSync(join(ROOT, "app.js"), "utf8");
const DECL = /^(?:async\s+)?function\s+([\w$]+)|^(?:const|let)\s+([\w$]+)\s*=|^import \* as ([\w$]+)/gm;
const names = [...new Set(Array.from(src.matchAll(DECL), (m) => m[1] || m[2] || m[3]))];
writeFileSync(join(dir, "app.js"), `${src}\nwindow.__t = {${names.map((n) => `get ${n}() { return ${n}; }`).join(",")}};\n`);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".bin": "application/octet-stream" };
const server = createServer((req, res) => {
  const p = join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/$/, "/index.html"));
  if (!p.startsWith(dir) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const errors = [];
async function open(viewport, view = "wardrobe") {
  const ctx = await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: SHOTS ? 2 : 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort()); // nothing leaves the machine
  await page.goto(url);
  await page.waitForFunction(() => window.__t?.state?.items?.length >= 10 && window.__t.Style.ready(), null, { timeout: 60000 });
  await page.evaluate((v) => window.__t.go(v), view);
  return page;
}


// The test wardrobe: a suit's pieces, a coat, a tie, and enough else for ideas.
const WARDROBE = [
  ["w-shirt", "White dress shirt", "shirt", ["white"], ["smart", "formal"]],
  ["w-tee", "White T-shirt", "tshirt", ["white"], ["casual"]],
  ["w-blazer", "Dark blue single-breasted blazer", "jacket", ["navy"], ["smart", "formal"], { formality: 4 }],
  ["w-coat", "Navy wool coat", "coat", ["navy"], ["smart"], { warmth: 4 }],
  ["w-parka", "Olive parka", "coat", ["olive"], ["casual"], { warmth: 4 }],
  ["w-trousers", "Dark blue slim trousers", "trousers", ["navy"], ["smart", "formal"], { fit: "slim" }],
  ["w-jeans", "Dark jeans", "jeans", ["denim"], ["casual"]],
  ["w-shoes", "Black dress shoes", "dress-shoes", ["black"], ["formal"], { leather: "black" }],
  ["w-sneak", "White sneakers", "sneakers", ["white"], ["casual"]],
  ["w-tie", "Burgundy tie", "tie", ["burgundy"], ["formal"]],
  ["w-belt", "Black leather belt", "belt", ["black"], ["smart"], { leather: "black" }],
];
async function useWardrobe(page) {
  await page.evaluate(async (list) => {
    const t = window.__t;
    const photo = async (hex) => {
      const c = new OffscreenCanvas(96, 128), g = c.getContext("2d");
      g.fillStyle = hex; g.fillRect(16, 16, 64, 96);
      return c.convertToBlob({ type: "image/png" });
    };
    for (const it of [...t.state.items]) await t.store.del("items", it.id);
    t.state.items.length = 0;
    const at = new Date(Date.now() - 864e5 * 30).toISOString();
    for (const [id, name, category, colors, styles, extra = {}] of list) {
      const hex = t.COLORS[colors[0]]?.hex || "#999999";
      const it = { id, name, category, colors, styles, formality: t.formalityOf(styles, category), warmth: t.CAT[category].warmth, tags: [], fit: "",
        photos: [await photo(hex)], createdAt: at, wearCount: 0, lastWorn: null, favorite: false, ...extra };
      t.state.items.push(it);
      await t.store.put("items", it);
    }
    Object.assign(t.state, { outfits: [], manualTemp: 18, occasion: "work" });
  }, WARDROBE);
}
const PHOTO = await (async () => {
  const p = await browser.newPage();
  const b64 = await p.evaluate(async () => {
    const c = new OffscreenCanvas(600, 900), g = c.getContext("2d");
    g.fillStyle = "#e8e4dc"; g.fillRect(0, 0, 600, 900);
    g.fillStyle = "#c9a184"; g.beginPath(); g.arc(300, 95, 55, 0, 7); g.fill();
    g.fillStyle = "#1d2236"; g.fillRect(190, 150, 220, 420);
    g.fillStyle = "#23283a"; g.fillRect(215, 570, 170, 255);
    g.fillStyle = "#111111"; g.fillRect(205, 825, 190, 45);
    const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  });
  await p.close();
  return b64;
})();

// Gemini, stubbed: what the app sends, and a reading of the photo back.
const asked = [];
let answer = null;
async function stubGemini(page) {
  await page.route(/generativelanguage\.googleapis\.com/, async (r) => {
    const body = JSON.parse(r.request().postData() || "{}");
    asked.push(body);
    await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(answer(body)) }] } }], usageMetadata: { promptTokenCount: 600, candidatesTokenCount: 80 } }) });
  });
  await page.evaluate(() => Object.assign(window.__t.state.settings, { aiProvider: "gemini", geminiKey: "test-key" }));
}
const SUIT = { slots: { base: "w-shirt", outer: "w-blazer", bottom: "w-trousers", shoes: "w-shoes" }, coat: "w-coat", extras: ["w-tie"] };

const page = await (async () => {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 1024 }, hasTouch: true, deviceScaleFactor: SHOTS ? 2 : 1 });
  const pg = await ctx.newPage();
  pg.on("pageerror", (e) => errors.push(String(e)));
  await pg.route(/^https?:\/\/(?!127\.0\.0\.1|generativelanguage)/, (r) => r.abort());
  await pg.goto(url);
  await pg.waitForFunction(() => window.__t?.state?.items?.length >= 10 && window.__t.Style.ready(), null, { timeout: 60000 });
  return pg;
})();
await useWardrobe(page);
await stubGemini(page);
test.after(async () => { await browser.close(); server.close(); rmSync(dir, { recursive: true, force: true }); });

test("the fit check photo is read by Gemini: one small JPEG, one line per piece, a few enums", async () => {
  answer = (body) => {
    const text = body.contents[0].parts.find((p) => p.text).text, ref = (name) => text.split("\n").find((l) => l.includes(name)).split(" | ")[0];
    return { pieces: [
      { ref: ref("Navy wool coat"), seen: true, close: "open", tuck: "n/a", sleeves: "n/a", break: "n/a" },
      { ref: ref("single-breasted blazer"), seen: true, close: "buttoned", tuck: "n/a", sleeves: "n/a", break: "n/a" },
      { ref: ref("White dress shirt"), seen: true, close: "n/a", tuck: "in", sleeves: "down", break: "n/a" },
      { ref: ref("slim trousers"), seen: true, close: "n/a", tuck: "n/a", sleeves: "n/a", break: "slight" },
    ], note: "coat collar turned up" };
  };
  await page.evaluate(async ({ outfit, b64 }) => {
    const t = window.__t;
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await t.openFitReview({ date: t.localDay(), occasion: "work", feels: 6, ...outfit }, new Blob([bytes], { type: "image/jpeg" }));
  }, { outfit: SUIT, b64: PHOTO });
  await page.waitForSelector('.fc-wear [data-fcstyle="draft|w-coat|close|open"][aria-pressed="true"]', { timeout: 20000 });
  assert.equal(asked.length, 1);
  const req = asked[0], parts = req.contents[0].parts, img = parts.find((p) => p.inline_data), text = parts.find((p) => p.text).text;
  assert.equal(img.inline_data.mime_type, "image/jpeg");
  assert.ok(img.inline_data.data.length < 200000, "a small photo");
  assert.ok(req.generationConfig.maxOutputTokens <= 300, `output capped (${req.generationConfig.maxOutputTokens})`);
  assert.equal(text.split("\n").filter((l) => /^p\d+ \| /.test(l)).length, 4, "the coat, the blazer, the shirt and the trousers (no shoes, no tie)");
  assert.ok(!/w-coat|w-blazer/.test(text), "short refs, not ids");
  for (const sel of ['"draft|w-blazer|close|buttoned"', '"draft|w-shirt|tuck|in"', '"draft|w-trousers|break|slight"']) assert.equal(await page.getAttribute(`[data-fcstyle=${sel}]`, "aria-pressed"), "true", sel);
  assert.match(await page.textContent(".sheet-panel .fc-form"), /coat collar turned up/);
  // a blazer has no "Closed up"; a coat does
  assert.equal(await page.$('[data-fcstyle="draft|w-blazer|close|closed"]'), null);
  // corrected by hand: the coat was buttoned after all
  await page.click('[data-fcstyle="draft|w-coat|close|buttoned"]');
  await page.waitForSelector('[data-fcstyle="draft|w-coat|close|buttoned"][aria-pressed="true"]');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "fit-wear-review-1366x1024.png") });
  await page.click('[data-fcstar="draft|5"]');
  await page.click("[data-fcsave]");
  await page.waitForFunction(() => window.__t.state.fitChecks.length === 1);
  const saved = await page.evaluate(() => { const t = window.__t, fc = t.state.fitChecks[0]; return { wear: fc.wear, by: fc.wearBy, sum: t.state.brain.checks[fc.id] }; });
  assert.deepEqual(saved.wear["w-coat"], { close: "buttoned" });
  assert.deepEqual(saved.wear["w-shirt"], { tuck: "in", sleeves: "down" });
  assert.equal(saved.by, "ai");
  assert.equal(saved.sum.coat, "w-coat", "the brain knows the coat");
  assert.deepEqual(saved.sum.wear, saved.wear);
});

test("the avatar wears that outfit that way: coat over the blazer, fronts closed, top tucked, tie on the shirt", async () => {
  const r = await page.evaluate(() => {
    const t = window.__t, get = (id) => t.state.items.find((x) => x.id === id);
    const o = { key: "test-suit", pieces: { base: get("w-shirt"), outer: get("w-blazer"), bottom: get("w-trousers"), shoes: get("w-shoes") }, coat: get("w-coat"), extras: [get("w-tie")] };
    const slots = t.slotsFor(o), wear = t.wearNow(o);
    const fake = { garmentId: "x", frontChestUV: null };
    const coat = t.styledAsset(slots.jacket, fake, wear, o), blazer = t.styledAsset(slots.layer, fake, wear, o);
    t.mirror.off[o.key] = ["coat"];
    const without = t.slotsFor(o);
    delete t.mirror.off[o.key];
    return {
      jacket: slots.jacket?.item.id, layer: slots.layer?.item.id, top: slots.top?.item.id,
      coat: coat.asset.wear, blazer: blazer.asset.wear, tuck: t.tuckNow(o, wear), from: wear["w-coat"].from,
      noCoat: { jacket: without.jacket?.item.id, jacketOn: without.jacket?.on, layer: without.layer?.item.id || null },
      tie: t.tieOf(o)?.id,
      otherOcc: (() => { t.state.occasion = "casual"; const w = t.wearNow(o); t.state.occasion = "work"; return w["w-coat"]?.close; })(),
    };
  });
  assert.equal(r.jacket, "w-coat");
  assert.equal(r.layer, "w-blazer", "the blazer goes under the coat");
  assert.equal(r.top, "w-shirt");
  assert.deepEqual(r.coat, { close: 1 }, "the coat buttoned (corrected by hand)");
  assert.deepEqual(r.blazer, { close: 1 });
  assert.equal(r.tuck, true);
  assert.ok(r.from);
  assert.deepEqual(r.noCoat, { jacket: "w-blazer", jacketOn: true, layer: null }, "coat off: the blazer is the jacket again");
  assert.equal(r.tie, "w-tie");
  assert.equal(r.otherOcc, "buttoned", "another occasion with no check of its own falls back to this one");
});

test("the tie is painted down the shirt's front panel, where the avatar's front is", async () => {
  const px = await page.evaluate(async () => {
    const [lib, baker] = await Promise.all([import("./avatar-stage.js"), import("./garment-baker.js")]);
    const c = new OffscreenCanvas(768, 1024), g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, 768, 1024);
    const panel = await c.convertToBlob({ type: "image/png" });
    const F = lib.panelFrame({ garmentSubType: "tee", length: "full" }, "White dress shirt");
    const out = await baker.paintTie(panel, F, "#6a1d2b");
    const bmp = await createImageBitmap(out), k = new OffscreenCanvas(768, 1024).getContext("2d");
    k.drawImage(bmp, 0, 0);
    const at = (u, y) => Array.from(k.getImageData(Math.round(768 * u), Math.round(1024 * (F.top - y) / (F.top - F.hem)), 1, 1).data.slice(0, 3));
    return { F, chest: at(0.5, 4.5), side: at(0.75, 4.5), belowTip: at(0.5, F.waist - 0.3), knot: at(0.5, F.neck - 0.15) };
  });
  const red = ([r, g, b]) => r > 70 && r > g * 1.6 && r > b * 1.4;
  assert.ok(red(px.chest), `tie on the chest ${px.chest}`);
  assert.ok(red(px.knot), `knot under the collar ${px.knot}`);
  assert.ok(px.side.every((v) => v > 240), "the shirt beside it stays white");
  assert.ok(px.belowTip.every((v) => v > 240), "nothing below the tip");
});

test("Today: a coat goes over the blazer from the idea card (+ Coat), and comes off again", async () => {
  await page.evaluate(() => { const t = window.__t; t.state.outfits = []; t.state.manualTemp = 18; t.go("today"); });
  await page.waitForFunction(() => window.__t.state.outfits.length > 0, null, { timeout: 30000 });
  // the best idea, in the suit's blazer (whatever the ideas picked for this weather)
  const i = await page.evaluate(() => { const t = window.__t; t.state.outfits[0] = { ...t.state.outfits[0], pieces: { ...t.state.outfits[0].pieces, outer: t.state.items.find((x) => x.id === "w-blazer") } }; return 0; });
  await page.evaluate((i) => { const t = window.__t; t.state.outfits[i] = { ...t.state.outfits[i], coat: null }; t.render(); }, i);
  await page.click(`button.add-coat[data-cswap="${i}"]`);
  await page.waitForSelector(`[data-cto="${i}:w-coat"]`);
  const opts = await page.$$eval(`[data-cto^="${i}:"]`, (els) => els.map((e) => e.dataset.cto.split(":")[1]).filter(Boolean));
  assert.ok(!opts.includes("w-blazer"), "not the blazer itself");
  assert.ok(opts.includes("w-parka"));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "coat-picker-1366x1024.png") });
  await page.click(`[data-cto="${i}:w-coat"]`);
  await page.waitForFunction((i) => window.__t.state.outfits[i].coat?.id === "w-coat", i);
  assert.ok(await page.$(`.swap-btn[data-cswap="${i}"]`), "the coat has its own swap button");
  await page.click(`.swap-btn[data-cswap="${i}"]`);
  await page.click(`[data-cto="${i}:"]`);
  await page.waitForFunction((i) => !window.__t.state.outfits[i].coat, i);
});

test("a saved check: corrected by hand, or read again from its photo", async () => {
  const id = await page.evaluate(() => window.__t.state.fitChecks[0].id);
  await page.evaluate((id) => window.__t.openFitCheck(id), id);
  await page.waitForSelector(`[data-fcstyle="fc:${id}|w-coat|close|buttoned"][aria-pressed="true"]`);
  await page.click(`[data-fcstyle="fc:${id}|w-coat|close|open"]`);
  await page.waitForFunction((id) => window.__t.state.fitChecks[0].wear["w-coat"].close === "open" && window.__t.state.brain.checks[id].wear["w-coat"].close === "open", id);
  assert.equal(await page.evaluate(() => window.__t.state.fitChecks[0].wearBy), "hand");
  answer = () => ({ pieces: [{ ref: "p1", seen: true, close: "closed", tuck: "n/a", sleeves: "n/a", break: "n/a" }], note: "" });
  await page.click(`[data-fcread="${id}"]`);
  await page.waitForFunction(() => window.__t.state.fitChecks[0].wearBy === "ai");
  assert.deepEqual(await page.evaluate(() => window.__t.state.fitChecks[0].wear), { "w-coat": { close: "closed" } });
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "fit-wear-saved-1366x1024.png") });
});

test("no page errors", () => assert.deepEqual(errors, []));
