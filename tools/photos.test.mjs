// Run with:  node --test tools/photos.test.mjs
// Checks, in headless Chromium on the sample wardrobe, how app.js keeps and shows photos:
// - a device on the old database (version 4) upgrades, and photos kept as base64 text become Blobs
// - colours and the outline guess read from the cut-outs on the device, against the samples' labels
// - thumbnails: one small copy per piece, used by the wardrobe grid
// - filtering and searching the grid reuse its tiles (nothing rebuilt) and stay fast with 130 pieces
// - deleting a piece frees its photo URLs and its thumbnail; moving screen frees unused URLs
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
const dir = mkdtempSync(join(tmpdir(), "wardrobe-photos-"));
for (const f of ["index.html", "app.js", "stylist.js", "label.js", "calendar.js", "cutout-editor.js", "avatar-config.js", "avatar-stage.js", "garment-baker.js", "mannequin-shells.js", "face-photo.js", "styles.css", "fashion-bible.json", "manifest.webmanifest", "icon.svg"])
  if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(dir, f));
for (const d of ["sample", "vendor", "avatar"]) if (existsSync(join(ROOT, d))) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
const src = readFileSync(join(ROOT, "app.js"), "utf8");
const DECL = /^(?:async\s+)?function\s+([\w$]+)|^(?:const|let)\s+([\w$]+)\s*=|^import \* as ([\w$]+)/gm;
const names = [...new Set(Array.from(src.matchAll(DECL), (m) => m[1] || m[2] || m[3]))];
writeFileSync(join(dir, "app.js"), `${src}\nwindow.__t = {${names.map((n) => `get ${n}() { return ${n}; }`).join(",")}};\n`);
writeFileSync(join(dir, "blank.html"), "<!doctype html><title>blank</title>");

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".bin": "application/octet-stream" };
const server = createServer((req, res) => {
  const p = join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/$/, "/index.html"));
  if (!p.startsWith(dir) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1366, height: 1024 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort()); // no weather, AI or CDN: all on the device

test.after(async () => { await browser.close(); server.close(); rmSync(dir, { recursive: true, force: true }); });

test("a device on database version 4 upgrades; base64 photos become Blobs", async () => {
  await page.goto(url + "blank.html");
  await page.evaluate(async () => {
    const cut = await (await fetch("sample/cut/124743029.webp")).blob();
    const dataURL = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(cut); });
    await new Promise((resolve, reject) => {
      const req = indexedDB.open("smart-wardrobe", 4);
      req.onupgradeneeded = () => {
        const d = req.result;
        for (const [n, o] of [["items", { keyPath: "id" }], ["log", { keyPath: "id", autoIncrement: true }], ["kv"], ["wants", { keyPath: "id" }], ["events", { keyPath: "id" }], ["scents", { keyPath: "id" }]]) d.createObjectStore(n, o);
      };
      req.onsuccess = () => {
        const d = req.result, t = d.transaction(["items", "kv"], "readwrite");
        t.objectStore("items").put({ id: "old-1", name: "Old grey hoodie", category: "hoodie", colors: ["grey"], styles: ["casual"], warmth: 3, tags: [], createdAt: "2026-10-01T10:00:00Z", photos: [dataURL] });
        t.objectStore("kv").put(true, "seeded");
        t.objectStore("kv").put(3, "seedVersion");
        t.oncomplete = () => { d.close(); resolve(); };
        t.onerror = () => reject(t.error);
      };
      req.onerror = () => reject(req.error);
    });
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__t?.state?.items?.length >= 1, null, { timeout: 30000 });
  const r = await page.evaluate(async () => {
    const { state, raw, db } = window.__t;
    const it = state.items.find((i) => i.id === "old-1");
    const kept = await raw.get("items", "old-1");
    return { version: db.version, stores: [...db.objectStoreNames], inMemory: it?.photos[0] instanceof Blob, onDisk: kept?.photos[0] instanceof Blob, type: kept?.photos[0]?.type };
  });
  assert.equal(r.version, 5);
  assert.ok(r.stores.includes("thumbs"), "the thumbs store is made");
  assert.ok(r.inMemory && r.onDisk, "the data: photo is a Blob in memory and in IndexedDB");
  assert.equal(r.type, "image/webp");
});

test("colours and outline read from the sample cut-outs (no tokens)", async () => {
  await page.evaluate(() => window.__t.loadSeed());
  const r = await page.evaluate(async () => {
    const { state, readPhoto, SHAPE_TYPES } = window.__t;
    const out = { main: 0, total: 0, shapeRight: 0, shapeWrong: 0, wrong: [] };
    for (const s of window.WARDROBE_SEED) {
      const it = state.items.find((i) => i.id === `seed-${s.photos[0]}`);
      const seen = await readPhoto(it.photos[0]);
      out.total++;
      if (seen.colors[0] === s.colors[0]) out.main++;
      if (seen.shape) (SHAPE_TYPES[seen.shape].includes(s.category) ? out.shapeRight++ : (out.shapeWrong++, out.wrong.push(`${s.name}: ${seen.shape}`)));
    }
    return out;
  });
  console.log(`  main colour right ${r.main}/${r.total}; outline right ${r.shapeRight}, wrong ${r.shapeWrong} ${r.wrong.join("; ")}`);
  assert.ok(r.main >= 14, `main colour right on ${r.main} of ${r.total} samples (the swatch colours got 8)`);
  assert.ok(r.shapeRight >= 26 && r.shapeWrong <= 1, `outline: ${r.shapeRight} right, ${r.shapeWrong} wrong`);
});

test("the wardrobe grid shows one small thumbnail per piece", async () => {
  await page.evaluate(() => { window.__t.go("wardrobe"); window.__t.warmThumbs(); });
  await page.waitForFunction(() => window.__t.thumbs.size >= window.__t.state.items.length, null, { timeout: 60000 });
  await page.waitForTimeout(100);
  const r = await page.evaluate(async () => {
    const { state, thumbs, raw, photoURL } = window.__t;
    let biggest = 0, smaller = 0;
    for (const i of state.items) {
      const t = thumbs.get(i.id), b = await createImageBitmap(t.blob);
      biggest = Math.max(biggest, b.width, b.height);
      if (t.blob.size < i.photos[0].size) smaller++;
    }
    const imgs = [...document.querySelectorAll("#grid img[data-thumb]")];
    return {
      items: state.items.length, onDisk: (await raw.all("thumbs")).length, biggest, smaller, imgs: imgs.length,
      onThumb: imgs.filter((img) => img.getAttribute("src") === photoURL(thumbs.get(img.dataset.thumb).blob)).length,
      lazy: imgs.every((img) => img.loading === "lazy" && img.decoding === "async"),
    };
  });
  assert.equal(r.onDisk, r.items, "every piece has its thumbnail kept on the device");
  assert.ok(r.biggest <= 512, `thumbnails are at most 512 px (${r.biggest})`);
  assert.ok(r.smaller >= r.items - 1, `thumbnails are smaller files than the photos (${r.smaller}/${r.items})`);
  assert.equal(r.onThumb, r.imgs, "the grid shows the thumbnails");
  assert.ok(r.lazy, "grid photos load lazily and decode off the main thread");
});

test("filtering and searching reuse the grid's tiles, fast with 130 pieces", async () => {
  const r = await page.evaluate(async () => {
    const { state, go, refilter, refreshGrid } = window.__t;
    // 100 more pieces, in memory only, copies of the samples.
    const base = state.items.slice();
    for (let k = 0; k < 100; k++) { const b = base[k % base.length]; state.items.push({ ...b, id: `copy-${k}`, name: `${b.name} ${k}`, createdAt: new Date(Date.parse(b.createdAt) - (k + 1) * 6e4).toISOString() }); }
    go("wardrobe");
    let grid = document.getElementById("grid");
    let before, imgsBefore;
    const remember = () => { before = new Map([...grid.children].map((el) => [el.dataset.item, el])); imgsBefore = new Set(grid.querySelectorAll("img")); };
    remember();
    // Each change in its own frame, as taps are; only the script's own time is counted.
    const frame = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const time = async (fn, n = 20) => { let ms = 0; for (let k = 0; k < n; k++) { await frame(); const t0 = performance.now(); fn(k); ms += performance.now() - t0; } return ms / n; };
    const slots = ["bottom", "mid", "outer", "all"];
    const filterMs = await time((k) => { state.filters.slot = slots[k % slots.length]; refilter(); });
    const fullMs = await time((k) => { state.filters.slot = slots[k % slots.length]; window.__t.render(); }, 8); // drawing the whole screen again, as before
    grid = document.getElementById("grid");
    const fullKeeps = [...grid.children].every((el) => before.get(el.dataset.item) === el);
    state.filters.slot = "bottom"; refilter();
    const bottoms = [...grid.children].filter((el) => !el.hidden).map((el) => el.dataset.item);
    const wantBottoms = state.items.filter((i) => window.__t.slotOf(i) === "bottom").map((i) => i.id);
    state.filters.slot = "all"; refilter();
    const input = document.getElementById("search-input");
    const words = ["h", "ho", "hoo", "hood", "hoodie", "", "jeans", ""];
    const searchMs = await time((k) => { input.value = words[k % words.length]; input.dispatchEvent(new Event("input", { bubbles: true })); });
    input.value = "jeans"; input.dispatchEvent(new Event("input", { bubbles: true }));
    const jeans = [...grid.children].filter((el) => !el.hidden).length;
    input.value = ""; input.dispatchEvent(new Event("input", { bubbles: true }));
    state.filters.sort = "name"; refilter();
    const names = [...grid.children].filter((el) => !el.hidden).map((el) => el.querySelector(".name").textContent);
    state.filters.sort = "recent"; refilter();
    const after = [...grid.children];
    // a chip tap goes through the app's own click handler
    document.querySelector('[data-slot="shoes"]').click();
    await new Promise((r) => setTimeout(r, 50));
    const chipShown = [...grid.children].filter((el) => !el.hidden).length;
    const chipPressed = document.querySelector('[data-slot="shoes"]').getAttribute("aria-pressed");
    document.querySelector('[data-slot="all"]').click();
    await new Promise((r) => setTimeout(r, 50));
    return {
      n: state.items.length, filterMs, fullMs, searchMs, fullKeeps, bottomsOk: JSON.stringify([...bottoms].sort()) === JSON.stringify([...wantBottoms].sort()),
      jeans, wantJeans: window.__t.filteredItems.length >= 0 && state.items.filter((i) => /jeans/i.test([i.name, i.category, ...(i.tags || [])].join(" "))).length,
      sorted: names.every((v, k) => !k || names[k - 1].localeCompare(v) <= 0),
      sameTiles: after.length === before.size && after.every((el) => before.get(el.dataset.item) === el),
      sameImgs: [...grid.querySelectorAll("img")].every((img) => imgsBefore.has(img)),
      chipShown, chipPressed, shoes: state.items.filter((i) => window.__t.slotOf(i) === "shoes").length,
    };
  });
  console.log(`  ${r.n} pieces: a filter change takes ${r.filterMs.toFixed(2)} ms (drawing the screen again: ${r.fullMs.toFixed(2)} ms), a search keystroke ${r.searchMs.toFixed(2)} ms`);
  assert.ok(r.fullKeeps, "drawing the Wardrobe screen again reuses the tiles too");
  assert.ok(r.bottomsOk, "Bottoms shows exactly the bottoms");
  assert.ok(r.jeans >= 1, "search finds the jeans");
  assert.ok(r.sorted, "A–Z sorts the tiles");
  assert.ok(r.sameTiles, "the same tile elements are kept, none rebuilt");
  assert.ok(r.sameImgs, "no photo is loaded again");
  assert.equal(r.chipPressed, "true");
  assert.equal(r.chipShown, r.shoes, "a chip tap filters the grid");
  assert.ok(r.filterMs < 6, `filter change ${r.filterMs.toFixed(2)} ms`);
  assert.ok(r.searchMs < 4, `search keystroke ${r.searchMs.toFixed(2)} ms`);
  await page.evaluate(() => { const { state } = window.__t; state.items = state.items.filter((i) => !String(i.id).startsWith("copy-")); window.__t.go("wardrobe"); });
});

test("deleting a piece frees its photo URLs and thumbnail; leaving a screen frees unused URLs", async () => {
  const r = await page.evaluate(async () => {
    const { state, store, raw, urlCache, thumbs, photoURL, go } = window.__t;
    const it = state.items.find((i) => i.id.startsWith("seed-"));
    for (const b of [...it.photos, ...(it.originals || [])]) photoURL(b);
    const had = it.photos.every((b) => urlCache.has(b)) && thumbs.has(it.id);
    await store.del("items", it.id);
    state.items = state.items.filter((i) => i !== it);
    const freed = ![...it.photos, ...(it.originals || [])].some((b) => urlCache.has(b));
    const thumbGone = !thumbs.has(it.id) && !(await raw.get("thumbs", it.id));
    const stray = new Blob(["x"], { type: "image/png" });
    photoURL(stray);
    go("today");
    return { had, freed, thumbGone, strayFreed: !urlCache.has(stray), kept: state.items.every((i) => !thumbs.get(i.id) || urlCache.has(thumbs.get(i.id).blob) || true) };
  });
  assert.ok(r.had, "the piece had URLs and a thumbnail");
  assert.ok(r.freed, "its photo URLs are revoked");
  assert.ok(r.thumbGone, "its thumbnail is gone, in memory and on disk");
  assert.ok(r.strayFreed, "a URL nothing uses any more is revoked when the screen changes");
});

test("touch screen rules: no pinch zoom, no bounce", async () => {
  const r = await page.evaluate(() => {
    const cs = (el) => getComputedStyle(el);
    const chip = document.querySelector(".chip"), range = document.querySelector('input[type="range"]');
    return { body: cs(document.body).touchAction, main: cs(document.querySelector("main")).touchAction, chip: chip && cs(chip).touchAction, range: range && cs(range).touchAction, bounce: cs(document.querySelector("main")).overscrollBehaviorY };
  });
  assert.equal(r.body, "pan-x pan-y");
  assert.equal(r.main, "pan-x pan-y");
  if (r.chip) assert.equal(r.chip, "pan-x pan-y");
  if (r.range) assert.notEqual(r.range, "pan-x pan-y", "sliders keep their own touch handling");
  assert.equal(r.bounce, "none");
});

test("no errors on the page", () => {
  assert.deepEqual(errors, []);
});
