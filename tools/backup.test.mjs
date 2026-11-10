// Run with:  node --test tools/backup.test.mjs
// Checks, in headless Chromium on the sample wardrobe:
// - Settings > Export wardrobe backup: one file with every piece and its photos, the log, the
//   Calendar, the 3D body and the settings, never an API key
// - importing it: "Replace" brings back exactly the backup, "Add" merges (nothing twice, a piece
//   changed here since the backup keeps its changes), photos come back as Blobs
// - the laundry basket on wardrobe tiles, "Laundry done" in the filters, the "Worn N×" badge
// - the Calendar logs wears: "Wear it today", "I wore it" for a past plan, once per day, with Undo
// - "On the avatar" shows a Calendar idea on the 3D stage in a sheet, and gives the stage back
// Needs Playwright with Chromium.
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// A copy of the app with every top-level function and constant of app.js on window.__t (as audit-sim.mjs does).
const dir = mkdtempSync(join(tmpdir(), "wardrobe-backup-"));
for (const f of ["index.html", "app.js", "stylist.js", "label.js", "calendar.js", "cutout-editor.js", "avatar-config.js", "avatar-stage.js", "garment-baker.js", "mannequin-shells.js", "face-photo.js", "styles.css", "fashion-bible.json", "manifest.webmanifest", "icon.svg"])
  if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(dir, f));
for (const d of ["sample", "vendor", "avatar"]) if (existsSync(join(ROOT, d))) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
const src = readFileSync(join(ROOT, "app.js"), "utf8");
const DECL = /^(?:async\s+)?function\s+([\w$]+)|^(?:const|let)\s+([\w$]+)\s*=|^import \* as ([\w$]+)/gm;
const names = [...new Set([...Array.from(src.matchAll(DECL), (m) => m[1] || m[2] || m[3]), "addDays", "dayDiff", "makeEntry", "entryIds", "resolveEntry"])];
writeFileSync(join(dir, "app.js"), `${src}\nwindow.__t = {${names.map((n) => `get ${n}() { return ${n}; }`).join(",")}, get view() { return view; }};\n`);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".bin": "application/octet-stream" };
const server = createServer((req, res) => {
  const p = join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/$/, "/index.html"));
  if (!p.startsWith(dir) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 1024 }, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort()); // no weather, AI or CDN: all on the device

test.after(async () => { await browser.close(); server.close(); rmSync(dir, { recursive: true, force: true }); });

const tick = (ms = 60) => page.waitForTimeout(ms);
let backupText = "";

test("the sample wardrobe loads, with a wear, a wash, a plan, a body and settings", async () => {
  await page.goto(url);
  await page.waitForFunction(() => window.__t?.state, null, { timeout: 30000 });
  await page.evaluate(async () => {
    const { state, loadSeed, wearOutfit, setWash, setDay, makeEntry, localDay, addDays, saveSettings, store } = window.__t;
    if (!state.items.length) await loadSeed();
    const by = (cat) => state.items.find((i) => i.category === cat);
    await wearOutfit([by("hoodie"), by("jeans"), by("jacket")], { occasion: "casual", feels: 18, source: "idea" });
    await setWash([by("sweater")], true);
    await setDay(addDays(localDay(), 2), makeEntry({ date: addDays(localDay(), 2), pieces: { mid: by("sweater"), bottom: by("trousers") }, occasion: "smart", notes: "Lunch with Luca" }));
    state.avatar = { body: { heightCm: 183, weightKg: 77, build: "athletic", skinTone: "#c99a74", hairColor: "#2b211b", hairStyle: "short", beard: "stubble", eyeColor: "#5a4632", glasses: "none" }, at: new Date().toISOString() };
    await store.put("kv", state.avatar, "avatar");
    Object.assign(state.settings, { city: "Milano", lat: 45.46, lon: 9.19, age: 27, geminiKey: "AIzaSECRETKEY", apiKey: "sk-ant-SECRET" });
    await saveSettings();
  });
  const n = await page.evaluate(() => window.__t.state.items.length);
  assert.ok(n >= 25, `sample wardrobe loaded (${n} pieces)`);
});

test("export: one file with every piece and its photos, the log, plans, body and settings, no keys", async () => {
  await page.evaluate(() => window.__t.go("settings"));
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click('[data-act="export"]')]);
  assert.match(download.suggestedFilename(), /^smart-wardrobe-backup-\d{4}-\d{2}-\d{2}\.json$/);
  backupText = readFileSync(await download.path(), "utf8");
  const data = JSON.parse(backupText);
  const r = await page.evaluate(() => {
    const { state } = window.__t;
    return { items: state.items.length, photos: state.items.reduce((a, i) => a + (i.photos?.length || 0) + (i.originals?.length || 0), 0), log: state.log.length };
  });
  assert.equal(data.app, "smart-wardrobe");
  assert.equal(data.version, 3);
  assert.equal(data.items.length, r.items);
  assert.equal(data.items.reduce((a, i) => a + (i.photos?.length || 0) + (i.originals?.length || 0), 0), r.photos, "every photo is in the file");
  assert.ok(data.items.every((i) => i.photos.every((p) => /^data:image\/(webp|jpeg|png);base64,/.test(p))), "photos are base64 inside the file");
  assert.equal(data.log.length, r.log);
  assert.equal(data.avatar.body.heightCm, 183);
  assert.ok(Object.values(data.days).some((d) => d.notes === "Lunch with Luca"), "the Calendar's plans");
  assert.equal(data.settings.city, "Milano");
  assert.ok(!backupText.includes("SECRET"), "no API key in the file");
  assert.ok(!("geminiKey" in data.settings) && !("apiKey" in data.settings));
  assert.ok(data.items.some((i) => i.wash), "the laundry state travels too");
  assert.ok(data.items.some((i) => i.wearCount === 1 && i.lastWorn), "wear counts too");
  const shown = await page.textContent("#backup");
  assert.match(shown, /Last backup from this device/);
});

test("replace: the wardrobe becomes exactly the backup; this device keeps its own keys", async () => {
  const r = await page.evaluate(async (text) => {
    const { state, store, restoreBackup, saveSettings } = window.__t;
    const data = JSON.parse(text);
    // change things after the backup: delete a piece, rename one, add a log entry, change the city
    const gone = state.items[0], renamed = state.items[1];
    await store.del("items", gone.id);
    state.items = state.items.filter((i) => i !== gone);
    renamed.name = "Renamed after the backup";
    await store.put("items", renamed);
    await window.__t.addLog({ kind: "like", itemIds: [renamed.id] });
    Object.assign(state.settings, { city: "Roma", geminiKey: "AIzaLOCALKEY" });
    await saveSettings();
    const res = await restoreBackup(data, { replace: true });
    const back = state.items.find((i) => i.id === gone.id), again = state.items.find((i) => i.id === renamed.id);
    return {
      res, items: state.items.length, want: data.items.length, log: state.log.length, wantLog: data.log.length,
      back: !!back, blobs: state.items.every((i) => i.photos.every((p) => p instanceof Blob)) && state.items.every((i) => !i.originals || i.originals.every((p) => p instanceof Blob)),
      type: back?.photos[0]?.type, name: again?.name, wantName: data.items.find((i) => i.id === renamed.id).name,
      city: state.settings.city, key: state.settings.geminiKey, body: state.avatar?.body?.heightCm,
      days: Object.values(state.days).some((d) => d.notes === "Lunch with Luca"), wash: state.items.filter((i) => i.wash).length,
      onDisk: (await store.all("items")).length,
    };
  }, backupText);
  assert.equal(r.items, r.want, "every piece of the backup is back");
  assert.equal(r.onDisk, r.want, "and in IndexedDB");
  assert.equal(r.log, r.wantLog, "the log is the backup's (the later like is gone)");
  assert.ok(r.back, "the deleted piece is back");
  assert.ok(r.blobs, "photos are Blobs again");
  assert.match(r.type, /^image\//);
  assert.equal(r.name, r.wantName, "the rename after the backup is undone");
  assert.equal(r.city, "Milano");
  assert.equal(r.key, "AIzaLOCALKEY", "this device's key is kept");
  assert.equal(r.body, 183);
  assert.ok(r.days);
  assert.equal(r.wash, 1);
});

test("add: importing twice adds nothing twice; a piece changed here since the backup keeps its change", async () => {
  const r = await page.evaluate(async (text) => {
    const { state, store, restoreBackup } = window.__t;
    const data = JSON.parse(text);
    const log0 = state.log.length, items0 = state.items.length;
    const first = await restoreBackup(data);
    const log1 = state.log.length;
    await new Promise((res) => setTimeout(res, 5));
    const it = state.items[2];
    it.name = "Changed on this device";
    await store.put("items", it);
    const second = await restoreBackup(data);
    const name = state.items.find((i) => i.id === it.id)?.name;
    // an old backup without log ids: still not added twice
    const old = { ...data, exportedAt: undefined, log: data.log.map(({ id, ...l }) => l) };
    const third = await restoreBackup(old);
    return { log0, log1, log2: state.log.length, items0, items: state.items.length, first, second, third, name, dirty: [...window.__t.sync.dirty].length };
  }, backupText);
  assert.equal(r.log1, r.log0, "no log entry twice");
  assert.equal(r.log2, r.log0, "not even from a backup without ids");
  assert.equal(r.items, r.items0);
  assert.equal(r.first.added, 0);
  assert.equal(r.first.updated, 0, "pieces that are the same aren't written again");
  assert.equal(r.first.same, r.items0);
  assert.equal(r.second.kept, 1, "the piece changed here is kept");
  assert.equal(r.name, "Changed on this device");
});

test("import through Settings: pick the file, see what's in it, add it", async () => {
  await page.evaluate(() => window.__t.go("settings"));
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click('[data-act="import"]')]);
  await chooser.setFiles({ name: "smart-wardrobe-backup.json", mimeType: "application/json", buffer: Buffer.from(backupText) });
  await page.waitForSelector("#bk-merge", { timeout: 20000 });
  const text = await page.textContent(".sheet-panel");
  assert.match(text, /\d+ pieces/);
  assert.match(text, /your 3D body/);
  await page.click("#bk-merge");
  await page.waitForFunction(() => /Imported/.test(document.getElementById("toast").textContent), null, { timeout: 30000 });
});

test("wardrobe tiles: the basket puts a piece in the wash and back; Laundry done; worn badge", async () => {
  await page.evaluate(() => { const { state, go } = window.__t; Object.assign(state.filters, { slot: "all", cat: "all", q: "", style: "all", color: "all" }); go("wardrobe"); });
  const id = await page.evaluate(() => window.__t.state.items.find((i) => i.category === "hoodie" && !i.wash).id);
  await page.click(`[data-basket="${id}"]`);
  await page.waitForSelector(`#grid > .item[data-item="${id}"] .wash-badge`, { timeout: 5000 }).catch(() => {});
  let r = await page.evaluate((id) => {
    const it = window.__t.state.items.find((i) => i.id === id);
    const tile = document.querySelector(`#grid > .item[data-item="${id}"]`);
    return { wash: !!it.wash, badge: tile?.querySelector(".wash-badge")?.textContent, pressed: tile?.querySelector(".basket")?.getAttribute("aria-pressed"), chip: !!document.querySelector(".chip.wash-all"), nested: !!document.querySelector("button button") };
  }, id);
  assert.ok(r.wash, "in the wash");
  assert.equal(r.badge, "In the wash");
  assert.equal(r.pressed, "true");
  assert.ok(r.chip, "Laundry done is in the filter bar");
  assert.ok(!r.nested, "no button inside a button");
  await page.click(`[data-basket="${id}"]`);
  await page.waitForFunction((id) => !window.__t.state.items.find((i) => i.id === id).wash && !document.querySelector(`#grid > .item[data-item="${id}"] .wash-badge`), id, { timeout: 5000 }).catch(() => {});
  assert.equal(await page.evaluate((id) => !!window.__t.state.items.find((i) => i.id === id).wash, id), false, "back from the wash");
  // two in the wash, then Laundry done brings everything back
  await page.evaluate(async () => { const { state, setWash, refilter } = window.__t; await setWash(state.items.filter((i) => i.category === "zip-hoodie").slice(0, 2), true); refilter(); });
  await page.click(".chip.wash-all");
  await page.waitForFunction(() => !window.__t.inWash().length && !document.querySelector(".chip.wash-all"), null, { timeout: 5000 }).catch(() => {});
  r = await page.evaluate(() => ({ washing: window.__t.inWash().length, worn: [...document.querySelectorAll("#grid .worn-badge")].map((b) => b.textContent) }));
  assert.equal(r.washing, 0);
  assert.ok(r.worn.includes("Worn 1×"), `a worn piece says so (${r.worn.join(", ")})`);
  // tapping the tile still opens the piece
  await page.click(`#grid > .item[data-item="${id}"] .item-open`);
  await page.waitForSelector("#sheet:not([hidden]) [data-wash]");
  await page.evaluate(() => window.__t.closeSheet());
});

test("Calendar: Wear it today logs the idea once; a past plan is logged at its day", async () => {
  const r = await page.evaluate(async () => {
    const t = window.__t, { state, localDay, addDays } = t;
    const until = async (fn, ms = 8000) => { const end = Date.now() + ms; while (!fn() && Date.now() < end) await new Promise((res) => setTimeout(res, 25)); };
    t.go("plan");
    t.pickDay(localDay());
    document.querySelector(`[data-calsuggest="${localDay()}"]`).click();
    await new Promise((res) => setTimeout(res, 50));
    const o = t.planner.sugg.ideas[t.planner.sugg.k];
    const pieces = t.allPieces(o);
    const before = pieces.map((p) => p.wearCount || 0), logs = state.log.filter((l) => t.logKind(l) === "wear").length;
    document.querySelector(`[data-calwear="${localDay()}"]`).click();
    await until(() => t.dayPlan(localDay())?.worn);
    const after = pieces.map((p) => p.wearCount || 0);
    const plan = t.dayPlan(localDay());
    const again = await t.wearDay(localDay(), pieces, { occasion: "casual" });
    const panel = document.getElementById("cal-day").textContent;
    // a plan of yesterday, logged from Today's question
    const y = addDays(localDay(), -1), by = (c) => state.items.find((i) => i.category === c && !pieces.includes(i));
    const yp = [by("zip-hoodie") || by("sweatshirt"), by("shorts") || by("trousers"), by("puffer") || by("jacket")].filter(Boolean);
    await t.setDay(y, t.makeEntry({ date: y, pieces: { mid: yp[0], bottom: yp[1], outer: yp[2] }, occasion: "casual" }));
    const lastBefore = yp.map((p) => p.lastWorn || null), countBefore = yp.map((p) => p.wearCount || 0);
    t.go("today");
    await new Promise((res) => setTimeout(res, 50));
    const asked = !!document.querySelector(`[data-calworn="${y}"]`);
    document.querySelector(`[data-calworn="${y}"]`)?.click();
    await until(() => t.dayPlan(y)?.worn && !document.querySelector(`[data-calworn="${y}"]`));
    const yLog = state.log.filter((l) => t.logKind(l) === "wear" && t.logDay(l) === y);
    const askedAfter = !!document.querySelector(`[data-calworn="${y}"]`);
    // Undo from the toast takes it back
    document.querySelector("#toast [data-toast]")?.click();
    await until(() => !t.dayPlan(y)?.worn);
    return {
      before, after, logs, logsAfter: state.log.filter((l) => t.logKind(l) === "wear").length, worn: !!plan?.worn, again, panel,
      asked, askedAfter, yLog: yLog.length, yAt: yLog[0]?.at, countAfterY: yp.map((p) => p.wearCount || 0), countBefore, lastBefore, lastAfterUndo: yp.map((p) => p.lastWorn || null),
      yWorn: !!t.dayPlan(y)?.worn, yLogAfterUndo: state.log.filter((l) => t.logKind(l) === "wear" && t.logDay(l) === y).length,
    };
  });
  assert.deepEqual(r.after, r.before.map((n) => n + 1), "each piece counts one wear");
  assert.equal(r.logsAfter >= r.logs + 1, true);
  assert.ok(r.worn, "the day is planned and worn");
  assert.equal(r.again, null, "the same outfit isn't counted twice that day");
  assert.match(r.panel, /Planned and worn/);
  assert.ok(r.asked, "Today asks about yesterday's plan");
  assert.equal(r.yLog, 1, "yesterday's plan is logged");
  assert.ok(!r.askedAfter, "and isn't asked again");
  assert.equal(new Date(r.yAt).toLocaleDateString("sv"), (() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.toLocaleDateString("sv"); })(), "logged at that day");
  assert.equal(r.yLogAfterUndo, 0, "Undo takes it back");
  assert.deepEqual(r.lastAfterUndo, r.lastBefore, "and puts last worn back");
  assert.ok(!r.yWorn, "and the plan isn't ticked any more");
});

test("On the avatar: a Calendar idea on the 3D stage in a sheet, then back to Today", async () => {
  const r = await page.evaluate(async () => {
    const t = window.__t, { localDay, addDays, mirror } = t;
    await (mirror.loading || Promise.resolve());
    const d = addDays(localDay(), 3);
    t.go("plan");
    t.pickDay(d);
    document.querySelector(`[data-calsuggest="${d}"]`).click();
    await new Promise((res) => setTimeout(res, 50));
    const btn = document.querySelector(`[data-calpreview="idea|${d}"]`);
    if (btn) btn.click(); else t.openCalPreview("idea", d);
    await new Promise((res) => setTimeout(res, 100));
    const slot = document.getElementById("stage3d-preview");
    const idea = t.planner.sugg.ideas[t.planner.sugg.k];
    const res = {
      failed: mirror.failed ? String(mirror.failed.message || mirror.failed) : "", button: !!btn, open: !document.getElementById("sheet").hidden, slot: !!slot,
      hostIn: !!slot && !!mirror.host && slot.contains(mirror.host), wears: t.mirrorIdea()?.pieces?.base?.id === idea.pieces.base?.id,
      actions: [...document.querySelectorAll(".sheet-panel [data-calplan], .sheet-panel [data-calnext]")].length,
    };
    // Another idea inside the sheet shows the next one
    document.querySelector(".sheet-panel [data-calnext]")?.click();
    await new Promise((res) => setTimeout(res, 100));
    res.next = t.planner.sugg.k === 1 && !!document.getElementById("stage3d-preview");
    t.closeSheet();
    res.closed = !mirror.preview;
    t.go("today");
    await new Promise((res) => setTimeout(res, 100));
    res.home = !!mirror.host && document.getElementById("stage3d")?.contains(mirror.host);
    res.tryon = document.querySelectorAll("[data-tryon]").length;
    return res;
  });
  console.log(`  3D stage here: ${r.failed ? `couldn't start (${r.failed})` : "running"}`);
  assert.ok(r.open && r.slot, "the sheet opens with a stage");
  assert.ok(r.hostIn, "the 3D stage moved into the sheet");
  assert.ok(r.wears, "the avatar wears that idea");
  assert.equal(r.actions, 2, "Plan it and Another idea are in the sheet");
  assert.ok(r.next, "Another idea shows the next one in the sheet");
  assert.ok(r.closed);
  assert.ok(r.home, "the stage is back on Today");
  if (!r.failed) { assert.ok(r.button, "the Calendar offers On the avatar"); assert.ok(r.tryon >= 1, "Today's ideas offer it too"); }
});

test("no errors on the page", () => {
  assert.deepEqual(errors, []);
});
