// Fit check and StylistBrain, in the app on iPad-sized pages (Playwright, Chromium):
// - "Log fit check" on Today's mirror and on a Calendar day takes a photo (a test image here), shows
//   it next to the outfit with stars, tags and the metrics read on the device, and saves it
// - it stays after a reload, goes through a backup and back, and syncs as a shared kv record
// - a 5-star check lifts its pairs, a 1-star check sinks them; "Needed a belt" puts a belt on the
//   next idea with those bottoms; "Top too boxy" keeps that top from roomy bottoms
// - Calendar > Fit checks: the lookbook, the 5-star filter, "Wear again" onto a day (kv `days`)
// - a local AI server (Settings) is asked first, and its answer merged; no answer: the device's metrics
// Run with:  node --test tools/fitcheck.e2e.mjs      (SHOTS=<dir> also saves screenshots)
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
const dir = mkdtempSync(join(tmpdir(), "wardrobe-fit-"));
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

// The test wardrobe: plain colour photos, real types.
const WARDROBE = [
  ["w-tee", "White T-shirt", "tshirt", ["white"], ["casual"]],
  ["w-tee2", "Black T-shirt", "tshirt", ["black"], ["casual"]],
  ["w-tee3", "Grey T-shirt", "tshirt", ["grey"], ["casual"]],
  ["w-boxy", "Oversized cream tee", "tshirt", ["beige"], ["casual", "streetwear"], { fit: "oversized" }],
  ["w-shirt", "White Oxford shirt", "shirt", ["white"], ["smart casual"]],
  ["w-knit", "Navy sweater", "sweater", ["navy"], ["smart casual"]],
  ["w-chinos", "Beige chinos", "trousers", ["beige"], ["smart casual"], { fit: "slim" }],
  ["w-jeans", "Dark jeans", "jeans", ["denim"], ["casual"], { fit: "straight" }],
  ["w-wide", "Wide black jeans", "jeans", ["black"], ["casual", "streetwear"], { fit: "wide" }],
  ["w-sneak", "White sneakers", "sneakers", ["white"], ["casual"]],
  ["w-boots", "Brown leather boots", "boots", ["brown"], ["smart casual"], { leather: "brown" }],
  ["w-belt", "Brown leather belt", "belt", ["brown"], ["smart casual"], { leather: "brown", metal: "silver" }],
  ["w-watch", "Steel watch", "watch", ["grey"], [], { metal: "silver", leather: "" }],
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
    Object.assign(t.state, { outfits: [], manualTemp: 18, occasion: "casual" });
  }, WARDROBE);
}
// A photo of "someone" in front of a wall: a navy top over beige trousers and dark shoes (the waistline
// at about 0.4 of the height, head included).
const PHOTO = await (async () => {
  const p = await browser.newPage();
  const b64 = await p.evaluate(async () => {
    const c = new OffscreenCanvas(600, 900), g = c.getContext("2d");
    g.fillStyle = "#e8e4dc"; g.fillRect(0, 0, 600, 900);
    g.fillStyle = "#c9a184"; g.beginPath(); g.arc(300, 95, 55, 0, 7); g.fill(); // head
    g.fillStyle = "#23283a"; g.fillRect(200, 150, 200, 220); // a navy top, to 41% of the height
    g.fillStyle = "#b5a58e"; g.fillRect(215, 370, 170, 455); // beige trousers
    g.fillStyle = "#222222"; g.fillRect(205, 825, 190, 45); // shoes
    const blob = await c.convertToBlob({ type: "image/jpeg", quality: 0.9 });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let s = ""; for (const x of bytes) s += String.fromCharCode(x);
    return btoa(s);
  });
  await p.close();
  return { name: "fit.jpg", mimeType: "image/jpeg", buffer: Buffer.from(b64, "base64") };
})();
// Tap a "Log fit check" button and give it the photo; wait for the review and its metrics.
async function logFit(page, selector) {
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click(selector)]);
  await chooser.setFiles(PHOTO);
  await page.waitForSelector(".sheet-panel .fc-worn img");
  await page.waitForSelector(".sheet-panel .fc-metrics li", { timeout: 20000 });
}
async function rateAndSave(page, stars, tags = []) {
  await page.click(`[data-fcstar="draft|${stars}"]`);
  for (const t of tags) { await page.click(`[data-fctag="${t}"]`); await page.waitForSelector(`[data-fctag="${t}"][aria-pressed="true"]`); }
  await page.waitForSelector("[data-fcsave]:not([disabled])");
  const n = await page.evaluate(() => window.__t.state.fitChecks.length);
  await page.click("[data-fcsave]");
  await page.waitForFunction((n) => window.__t.state.fitChecks.length === n + 1, n);
}
// Log a check straight from an outfit (the review sheet and saving are the app's own).
async function logOutfit(page, outfit, stars, tags = []) {
  await page.evaluate(async ({ outfit, b64 }) => {
    const t = window.__t;
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await t.openFitReview({ date: t.localDay(), occasion: "casual", coat: null, extras: [], feels: 18, ...outfit }, new Blob([bytes], { type: "image/jpeg" }));
  }, { outfit, b64: PHOTO.buffer.toString("base64") });
  await page.waitForSelector(".sheet-panel .fc-metrics li", { timeout: 20000 });
  await rateAndSave(page, stars, tags);
}
const scores = (page, outfits, occ = "casual") => page.evaluate(({ outfits, occ }) => {
  const t = window.__t, byId = new Map(t.state.items.map((i) => [i.id, i]));
  const o = t.OCCASIONS.find((x) => x.id === occ), cond = t.conditions();
  return outfits.map((slots) => {
    const pieces = Object.fromEntries(Object.entries(slots).map(([r, id]) => [r, byId.get(id)]));
    return { taste: t.tasteScore(pieces, o, t.taste()).score, total: t.scoreOutfit(pieces, cond, o).score };
  });
}, { outfits, occ });

const page = await open({ width: 1366, height: 1024 }, "wardrobe");
await useWardrobe(page);
test.after(async () => { await browser.close(); server.close(); rmSync(dir, { recursive: true, force: true }); });

test("Today: Log fit check on the mirror, review with metrics, saved", async () => {
  await page.evaluate(() => window.__t.go("today"));
  await page.waitForSelector('[data-fitlog="today"]', { timeout: 30000 });
  await logFit(page, '[data-fitlog="today"]');
  // the outfit next to the photo, the stars, the tags, the metrics as sentences
  assert.ok(await page.$$eval(".fc-stack img", (els) => els.length) >= 3);
  assert.equal(await page.$$eval(".fc-tags .chip", (els) => els.length), 11);
  const lines = await page.$$eval(".fc-metrics li", (els) => els.map((e) => e.textContent));
  assert.ok(lines.some((l) => /contrast/i.test(l)), lines.join(" | "));
  assert.ok(lines.some((l) => /Waistline at about 0\.[3-4]\d of your height: good thirds/.test(l)), lines.join(" | "));
  assert.ok(lines.some((l) => /Colours that go together \((navy, beige|beige, navy)/.test(l)), lines.join(" | "));
  assert.match(await page.textContent(".fc-metrics-box"), /Estimates worked out on this device/);
  assert.equal(await page.getAttribute("[data-fcsave]", "disabled"), "", "no stars yet: can't save");
  await page.click('[data-fctag="warm"]');
  await page.click('[data-fctag="cold"]');
  assert.equal(await page.getAttribute('[data-fctag="warm"]', "aria-pressed"), "false", "too warm and too cold don't go together");
  assert.equal(await page.getAttribute('[data-fctag="cold"]', "aria-pressed"), "true");
  await page.click('[data-fcstar="draft|4"]');
  await page.click('[data-fctag="proportions"]');
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "fit-review-today-1366x1024.png") });
  await page.click("[data-fcsave]");
  await page.waitForFunction(() => window.__t.state.fitChecks.length === 1);
  const saved = await page.evaluate(async () => {
    const t = window.__t, fc = t.state.fitChecks[0];
    const disk = await t.raw.get("fit_checks", fc.id);
    const log = t.state.log.find((l) => l.fitId === fc.id);
    return {
      slots: Object.keys(fc.itemIds), stars: fc.stars, tags: fc.tags, type: disk.photo.type, w: (await createImageBitmap(disk.photo)).width, thumb: disk.thumb.size < disk.photo.size,
      metrics: fc.metrics, brain: !!t.state.brain.checks[fc.id], log: log && { kind: log.kind, stars: log.stars, reason: log.reason, source: log.source, n: log.itemIds.length },
      dirty: t.sync.dirty.has(`kv/fit:${fc.id}`) || t.sync.status !== "on",
    };
  });
  assert.ok(saved.slots.includes("base") && saved.slots.includes("bottom"));
  assert.deepEqual([saved.stars, saved.tags], [4, ["cold", "proportions"]]);
  assert.equal(saved.type, "image/webp");
  assert.ok(saved.w <= 1280 && saved.w > 100);
  assert.ok(saved.thumb);
  assert.ok(saved.metrics.contrast > 0.3 && saved.metrics.waist > 0.3);
  assert.ok(saved.brain, "summed up in kv brain");
  assert.deepEqual(saved.log, { kind: "rate", stars: 4, reason: "cold", source: "fitcheck", n: saved.log.n });
  assert.ok(saved.log.n >= 3);
});

test("it stays after a reload, and goes through a backup and back", async () => {
  await page.reload();
  await page.waitForFunction(() => window.__t?.state?.items?.length >= 10 && window.__t.Style.ready(), null, { timeout: 60000 });
  const after = await page.evaluate(() => ({ n: window.__t.state.fitChecks.length, blob: window.__t.state.fitChecks[0]?.photo instanceof Blob, brain: Object.keys(window.__t.state.brain.checks).length }));
  assert.deepEqual(after, { n: 1, blob: true, brain: 1 });
  const trip = await page.evaluate(async () => {
    const t = window.__t, before = t.state.fitChecks[0];
    const data = JSON.parse(await (await t.backupBlob()).text());
    const inFile = { n: data.fitChecks?.length, photo: String(data.fitChecks?.[0]?.photo).slice(0, 22), brain: Object.keys(data.brain?.checks || {}).length, counted: data.counts.fitChecks, summary: t.backupSummary(data).text };
    // replace everything with the backup: the check comes back with its photo and what it taught
    await t.restoreBackup(data, { replace: true });
    const fc = t.state.fitChecks[0];
    return { inFile, n: t.state.fitChecks.length, same: fc?.id === before.id && fc.photo instanceof Blob && fc.photo.size === before.photo.size && fc.stars === before.stars, brain: Object.keys(t.state.brain.checks).length };
  });
  assert.deepEqual(trip.inFile, { n: 1, photo: "data:image/webp;base64", brain: 1, counted: 1, summary: trip.inFile.summary });
  assert.match(trip.inFile.summary, /1 fit check/);
  assert.equal(trip.n, 1);
  assert.ok(trip.same);
  assert.equal(trip.brain, 1);
});

test("it syncs like a piece: a kv record with the photo as a blob ref, back into the fit_checks store", async () => {
  const r = await page.evaluate(async () => {
    const t = window.__t, fc = t.state.fitChecks[0];
    const key = t.syncKey("fit_checks", fc.id);
    const [col, id] = t.splitKey(key);
    const local = t.localOf(col, id);
    // what another device would receive: apply it as a new check
    const other = { ...fc, id: "from-another-device", stars: 2 };
    t.sync.meta["kv/fit:from-another-device"] = "";
    const changed = await t.applyRecords([{ col: "kv", id: "fit:from-another-device", updatedAt: new Date(Date.now() + 1000).toISOString(), data: other }]);
    const arrived = await t.raw.get("fit_checks", "from-another-device");
    await t.applyRecords([{ col: "kv", id: "fit:from-another-device", updatedAt: new Date(Date.now() + 2000).toISOString(), deleted: true, data: null }]);
    return { key, local, changed, arrived: arrived?.stars, gone: !(await t.raw.get("fit_checks", "from-another-device")), n: t.state.fitChecks.length };
  });
  assert.equal(r.key, `kv/fit:${r.local[1]}`);
  assert.equal(r.local[0], "fit_checks");
  assert.equal(r.changed, true);
  assert.equal(r.arrived, 2);
  assert.ok(r.gone);
  assert.equal(r.n, 1);
});

test("a 5-star check lifts its pairs, a 1-star check sinks them", async () => {
  const good = { base: "w-tee2", bottom: "w-chinos", shoes: "w-boots" }, bad = { base: "w-tee3", bottom: "w-jeans", shoes: "w-sneak" };
  const before = await scores(page, [good, bad]);
  await logOutfit(page, { slots: good, extras: ["w-belt"] }, 5, ["harmony"]);
  await logOutfit(page, { slots: bad }, 1, ["clash"]);
  const after = await scores(page, [good, bad]);
  assert.ok(after[0].total > before[0].total + 1, `good: ${before[0].total.toFixed(2)} -> ${after[0].total.toFixed(2)}`);
  assert.ok(after[1].total < before[1].total - 1, `bad: ${before[1].total.toFixed(2)} -> ${after[1].total.toFixed(2)}`);
  // and the next ideas: the good pair comes before the bad one
  const rank = await page.evaluate(() => {
    const t = window.__t;
    t.state.occasion = "casual";
    t.generateOutfits(3, []);
    const keys = t.state.outfits.map((o) => `${o.pieces.base?.id}+${o.pieces.bottom?.id}`);
    return keys;
  });
  assert.ok(!rank.includes("w-tee3+w-jeans"), `the 1-star outfit stays out of the ideas: ${rank}`);
  // the accessory pair learnt too: the belt with the boots
  const belt = await page.evaluate(() => window.__t.taste().pairs[window.__t.pairKey("w-boots", "w-belt")]);
  assert.ok(belt > 1, `belt + boots: ${belt}`);
});

test("Needed a belt: those bottoms get a belt from now on; a boxy top stays off roomy bottoms", async () => {
  const extrasFor = (slots) => page.evaluate((slots) => {
    const t = window.__t, byId = new Map(t.state.items.map((i) => [i.id, i]));
    const pieces = Object.fromEntries(Object.entries(slots).map(([r, id]) => [r, byId.get(id)]));
    const r = t.extrasFor(pieces, t.conditions(), t.OCCASIONS.find((x) => x.id === "casual"), new Set());
    return { cats: r.extras.map((x) => x.category), why: r.extrasWhy };
  }, slots);
  const slots = { base: "w-tee", bottom: "w-wide", shoes: "w-sneak" };
  assert.ok(!(await extrasFor(slots)).cats.includes("belt"), "an everyday outfit gets no belt by itself");
  await logOutfit(page, { slots }, 3, ["belt"]);
  const now = await extrasFor(slots);
  assert.ok(now.cats.includes("belt"), JSON.stringify(now));
  assert.ok(now.why.some((w) => /needed one on your fit check/.test(w)));
  // the next ideas with those jeans all wear a belt
  const ideas = await page.evaluate(() => {
    const t = window.__t, out = [], seen = [];
    for (let k = 0; k < 8; k++) {
      t.generateOutfits(3, seen);
      for (const o of t.state.outfits) { seen.push(o.key); if (o.pieces.bottom?.id === "w-wide") out.push((o.extras || []).some((x) => x.category === "belt")); }
    }
    return out;
  });
  assert.ok(ideas.length > 0, "the wide jeans come up");
  assert.ok(ideas.every(Boolean), `ideas with the wide jeans and a belt: ${ideas}`);
  // Top too boxy: the oversized tee with wide jeans loses points, with slim chinos it doesn't
  const boxy = { base: "w-boxy", bottom: "w-wide", shoes: "w-sneak" }, slim = { base: "w-boxy", bottom: "w-chinos", shoes: "w-sneak" };
  const before = await scores(page, [boxy, slim]);
  await logOutfit(page, { slots: boxy }, 3, ["boxy"]);
  const after = await scores(page, [boxy, slim]);
  assert.ok(after[0].taste < before[0].taste - 1, `boxy on wide: ${before[0].taste} -> ${after[0].taste}`);
  assert.ok(after[1].taste >= before[1].taste, `boxy on slim: ${before[1].taste} -> ${after[1].taste}`);
  const tuck = await extrasFor(slim);
  assert.ok(tuck.why.some((w) => /Tuck the Oversized cream tee in/.test(w)), JSON.stringify(tuck));
});

test("Calendar: Log fit check on a day, the lookbook, 5-star filter, Wear again (portrait)", async () => {
  const p2 = await open({ width: 1024, height: 1366 }, "wardrobe");
  await useWardrobe(p2);
  await logOutfit(p2, { slots: { base: "w-tee", bottom: "w-jeans", shoes: "w-sneak" } }, 2);
  const today = await p2.evaluate(async () => {
    const t = window.__t, { makeEntry } = await import("/calendar.js");
    const byId = new Map(t.state.items.map((i) => [i.id, i]));
    const d = t.localDay();
    await t.setDay(d, makeEntry({ date: d, pieces: { base: byId.get("w-shirt"), bottom: byId.get("w-chinos"), shoes: byId.get("w-boots") }, extras: [byId.get("w-belt"), byId.get("w-watch")], occasion: "smart" }));
    t.planner.sel = d;
    t.go("plan");
    return d;
  });
  await p2.waitForSelector(`[data-fitlog="day|${today}"]`);
  await logFit(p2, `[data-fitlog="day|${today}"]`);
  assert.ok(await p2.$$eval(".fc-extras img", (els) => els.length) === 2, "the belt and the watch beside the outfit");
  await p2.click('[data-fcstar="draft|5"]');
  await p2.click('[data-fctag="accessories"]');
  if (SHOTS) await p2.screenshot({ path: join(SHOTS, "fit-review-calendar-1024x1366.png") });
  await p2.click("[data-fcsave]");
  await p2.waitForFunction(() => window.__t.state.fitChecks.some((x) => x.stars === 5 && x.extras.length === 2));
  await p2.waitForSelector(".fc-day .fc-card");
  // the lookbook: all, then 5 stars only
  await p2.click("[data-fitgallery]");
  await p2.waitForSelector(".fc-grid .fc-card");
  const all = await p2.$$eval(".fc-grid .fc-card", (els) => els.length);
  const total = await p2.evaluate(() => window.__t.state.fitChecks.length);
  assert.equal(all, total);
  await p2.click('[data-fcfilter="5"]');
  const five = await p2.$$eval(".fc-grid .fc-card", (els) => els.length);
  const fives = await p2.evaluate(() => window.__t.state.fitChecks.filter((x) => x.stars === 5).length);
  assert.equal(five, fives);
  assert.ok(five >= 1 && five < all);
  if (SHOTS) await p2.screenshot({ path: join(SHOTS, "fit-lookbook-1024x1366.png") });
  // open one, Wear again in a week
  const id = await p2.evaluate(() => window.__t.state.fitChecks.find((x) => x.stars === 5 && x.extras.length === 2).id);
  await p2.click(`.sheet-panel [data-fcopen="${id}"]`);
  await p2.waitForSelector("[data-fcwear]");
  if (SHOTS) await p2.screenshot({ path: join(SHOTS, "fit-detail-1024x1366.png") });
  const later = await p2.evaluate(async () => (await import("/calendar.js")).addDays(window.__t.localDay(), 7));
  await p2.fill("#fc-date", later);
  await p2.click("[data-fcwear]");
  await p2.waitForFunction((d) => window.__t.state.days?.[d]?.slots?.base === "w-shirt", later);
  const day = await p2.evaluate((d) => window.__t.state.days[d], later);
  assert.deepEqual(day.slots, { base: "w-shirt", bottom: "w-chinos", shoes: "w-boots" });
  assert.deepEqual(day.extras.sort(), ["w-belt", "w-watch"]);
  assert.equal(day.src, "fitcheck");
  assert.equal(await p2.evaluate(() => window.__t.view), "plan");
  await p2.close();
});

test("a local AI server is asked first and its answer merged; no answer: the device's metrics", async () => {
  const p3 = await open({ width: 1366, height: 1024 }, "settings");
  let got = null;
  await p3.route(`${url}fit-ai`, async (route) => {
    got = { method: route.request().method(), type: route.request().headers()["content-type"] || "" };
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ tags: ["Needed a belt"], metrics: { contrast: 0.91 }, notes: ["Shoes a shade darker would help"] }) });
  });
  await p3.fill("#local-ai", `${url}fit-ai`);
  await p3.waitForFunction((u) => localStorage.getItem("LOCAL_AI_SERVER_URL") === u && window.__t.state.settings.localAIUrl === u, `${url}fit-ai`);
  if (SHOTS) await p3.screenshot({ path: join(SHOTS, "fit-settings-1366x1024.png") });
  await p3.evaluate(async (b64) => {
    const t = window.__t, bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    await t.openFitReview({ date: t.localDay(), occasion: "casual", slots: { base: "w-tee", bottom: "w-jeans", shoes: "w-sneak" }, coat: null, extras: [], feels: 18 }, new Blob([bytes], { type: "image/jpeg" }));
  }, PHOTO.buffer.toString("base64"));
  await p3.waitForSelector(".sheet-panel .fc-metrics li", { timeout: 20000 });
  assert.equal(got?.method, "POST");
  assert.match(got.type, /multipart\/form-data/);
  assert.equal(await p3.getAttribute('[data-fctag="belt"]', "aria-pressed"), "true", "the server's tag is ticked, ready to untick");
  const box = await p3.textContent(".fc-metrics-box");
  assert.match(box, /Strong light and dark contrast/);
  assert.match(box, /Shoes a shade darker would help/);
  assert.match(box, /from your local AI server/);
  // a server that doesn't answer: the device's metrics after the timeout
  const slow = await p3.evaluate(async () => {
    const t = window.__t;
    const r = await t.Brain.analyzeWithExternalAI(new Blob([new Uint8Array([1])]), {}, { url: "https://192.0.2.1/never", timeout: 300, local: async () => ({ contrast: 0.2 }) });
    return r;
  });
  assert.equal(slow.source, "device");
  assert.equal(slow.contrast, 0.2);
  assert.ok(slow.aiError);
  await p3.close();
});

test("no errors on the page", () => {
  assert.deepEqual(errors, []);
});
