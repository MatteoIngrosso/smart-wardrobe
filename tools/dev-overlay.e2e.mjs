// Run with:  node --test tools/dev-overlay.e2e.mjs
// The localhost bug-marking overlay (dev-overlay.js) in headless Chromium, on the sample wardrobe at the
// iPad Air 13" size. Checks:
// - it loads on 127.0.0.1 inside a Shadow DOM host marked data-dev-overlay, and not on another host name
// - Alt+D draws; a circle saved as an issue goes to IndexedDB SmartWardrobeDevDB with its view key,
//   viewport, marks, console errors and a WebP screenshot (the marks-only fallback when the screenshot
//   library can't load; set MODERN_SCREENSHOT=<path to modern-screenshot's dist/index.mjs> to test the
//   real capture offline)
// - marks show only on their view, follow the scrolling, hide when fixed; numbered pins
// - the element picker gives a unique selector; Jump to view goes back; the Claude report
// - the app works as usual underneath in Interact mode; no page errors
// Needs Playwright with Chromium.
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// A copy of the app with every top-level function and constant of app.js on window.__t.
const dir = mkdtempSync(join(tmpdir(), "wardrobe-devoverlay-"));
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
}).listen(0);
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}/`;

// Open-Meteo answers with a mild, partly cloudy day; nothing else leaves the machine.
const hours = Array.from({ length: 48 }, (_, k) => new Date(Date.now() - 3600e3 * 6 + k * 3600e3).toISOString().slice(0, 13) + ":00");
const WEATHER = {
  current: { temperature_2m: 14.2, apparent_temperature: 13.1, relative_humidity_2m: 60, weather_code: 2, wind_speed_10m: 8, precipitation: 0 },
};
const MS = process.env.MODERN_SCREENSHOT, SHOTS = process.env.SHOTS;
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: false, deviceScaleFactor: 1 });
const errors = [];
async function open(host = "127.0.0.1") {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.\d)/, (r) => {
    const u = r.request().url();
    if (/open-meteo/.test(u)) return r.fulfill({ contentType: "application/json", body: JSON.stringify(WEATHER) });
    if (MS && /esm\.sh\/modern-screenshot/.test(u)) return r.fulfill({ contentType: "text/javascript", body: readFileSync(MS, "utf8") });
    return r.abort();
  });
  await page.goto(url.replace("127.0.0.1", host));
  await page.waitForFunction(() => window.__t?.state && window.__t.state.items.length >= 20, null, { timeout: 60000 });
  await page.evaluate(async () => { const t = window.__t; Object.assign(t.state.settings, { city: "Milano", lat: 45.46, lon: 9.19 }); await t.loadWeather(true); t.state.outfits = []; t.go("today"); });
  await page.waitForTimeout(600);
  return page;
}
const page = await open();
await page.waitForFunction(() => window.__devOverlay, null, { timeout: 20000 });
const shapes = () => page.evaluate(() => window.__devOverlay.root.querySelectorAll(".shapes > *").length);
const dbIssues = () => page.evaluate(() => new Promise((res) => { const r = indexedDB.open("SmartWardrobeDevDB"); r.onsuccess = () => { const q = r.result.transaction("issues").objectStore("issues").getAll(); q.onsuccess = () => res(q.result.map((i) => ({ ...i, shot: i.screenshotBlob ? { type: i.screenshotBlob.type, size: i.screenshotBlob.size } : null, screenshotBlob: undefined }))); }; }));

test.after(async () => { await browser.close(); server.close(); rmSync(dir, { recursive: true, force: true }); });

test("loads on 127.0.0.1 in a Shadow DOM host; the view key is today", async () => {
  const r = await page.evaluate(() => ({ host: document.querySelectorAll('[data-dev-overlay="true"]').length, shadow: !!document.querySelector("[data-dev-overlay]").shadowRoot, key: window.__devOverlay.getCurrentViewKey(), bar: !!window.__devOverlay.root.querySelector(".bar button[data-act=mode]") }));
  assert.deepEqual(r, { host: 1, shadow: true, key: "today", bar: true });
});

test("Interact mode: the app works underneath", async () => {
  await page.click('#nav [data-view="wardrobe"]');
  assert.equal(await page.evaluate(() => window.__devOverlay.getCurrentViewKey()), "wardrobe");
  await page.click('#nav [data-view="today"]');
  assert.equal(await page.evaluate(() => window.__devOverlay.getCurrentViewKey()), "today");
});

test("Alt+D, circle something, save: the issue is stored with its screenshot and context", async () => {
  await page.evaluate(() => console.error(new Error("boom from the test")));
  await page.keyboard.press("Alt+KeyD");
  assert.equal(await page.evaluate(() => window.__devOverlay.root.querySelector(".layer").classList.contains("drawing")), true);
  await page.mouse.move(300, 300); await page.mouse.down();
  for (let a = 0; a <= 6.4; a += 0.4) await page.mouse.move(400 + Math.cos(a) * 90, 300 + Math.sin(a) * 50);
  await page.mouse.up();
  assert.equal(await shapes(), 1);
  await page.locator('[data-dev-overlay] button[data-act="save"]').click();
  await page.locator('[data-dev-overlay] [data-f="title"]').fill("Weather card too tall");
  await page.locator('[data-dev-overlay] [data-f="note"]').fill("It pushes the avatar down.");
  await page.locator('[data-dev-overlay] [data-p="save"]').click();
  await page.waitForFunction(() => window.__devOverlay.issues().length === 1, null, { timeout: 30000 });
  const [i] = await dbIssues();
  console.log(`  screenshot: ${JSON.stringify(i.shot)}`);
  assert.equal(i.viewKey, "today"); assert.equal(i.status, "open"); assert.equal(i.n, 1);
  assert.equal(i.title, "Weather card too tall");
  assert.equal(i.annotations.length, 1); assert.equal(i.annotations[0].type, "pen");
  assert.deepEqual([i.viewport.width, i.viewport.height], [1024, 1366]);
  assert.ok(i.consoleErrors.some((e) => /boom from the test/.test(e.message)));
  assert.equal(i.shot?.type, "image/webp"); assert.ok(i.shot.size > 1000);
  if (SHOTS) {
    const b64 = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open("SmartWardrobeDevDB"); r.onsuccess = () => { const q = r.result.transaction("issues").objectStore("issues").getAll(); q.onsuccess = () => { const fr = new FileReader(); fr.onload = () => res(fr.result.split(",")[1]); fr.readAsDataURL(q.result[0].screenshotBlob); }; }; }));
    writeFileSync(join(SHOTS, "issue-1.webp"), Buffer.from(b64, "base64"));
  }
  assert.equal(await page.evaluate(() => window.__devOverlay.root.querySelector(".layer").classList.contains("drawing")), false, "back to Interact after saving");
  assert.equal(await page.evaluate(() => window.__devOverlay.root.querySelectorAll(".badge").length), 1, "a numbered pin");
});

test("marks stay on their view and follow the scrolling", async () => {
  await page.click('#nav [data-view="settings"]'); await page.waitForTimeout(200);
  assert.equal(await shapes(), 0, "not on Settings");
  await page.click('#nav [data-view="today"]'); await page.waitForTimeout(200);
  assert.equal(await shapes(), 1, "back on Today");
  const ty = () => page.evaluate(() => +window.__devOverlay.root.querySelector(".shapes").getAttribute("transform").match(/translate\(([-\d.]+) ([-\d.]+)\)/)[2]);
  const y0 = await ty();
  await page.evaluate(() => { document.querySelector("main").scrollTop = 300; }); await page.waitForTimeout(150);
  assert.equal(Math.round(y0 - (await ty())), 300);
  await page.evaluate(() => { document.querySelector("main").scrollTop = 0; }); await page.waitForTimeout(150);
});

test("the element picker locks a unique selector and saves it with the issue", async () => {
  await page.locator('[data-dev-overlay] button[data-act="pick"]').click();
  const b = await page.locator('main [data-act="shuffle"]').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.waitForTimeout(100);
  const label = await page.evaluate(() => window.__devOverlay.root.querySelector(".pick-label").textContent);
  assert.match(label, /^button/);
  await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await page.locator('[data-dev-overlay] [data-f="title"]').fill("New ideas button looks disabled");
  await page.locator('[data-dev-overlay] [data-p="save"]').click();
  await page.waitForFunction(() => window.__devOverlay.issues().length === 2, null, { timeout: 30000 });
  const i = (await dbIssues()).find((x) => x.n === 2);
  assert.equal(await page.evaluate((s) => document.querySelectorAll(s).length === 1 && document.querySelector(s).dataset.act, i.targetElement.selector), "shuffle", i.targetElement.selector);
  assert.ok(i.targetElement.outerHTMLSnippet.length <= 300);
  assert.ok(i.targetElement.styles.display);
});

test("the Claude report groups open issues by view with selector, snippet and errors", async () => {
  const md = await page.evaluate(() => window.__devOverlay.report());
  assert.match(md, /## View `today` \(2\)/);
  assert.match(md, /### #1 Weather card too tall/);
  assert.match(md, /Element: `[^`]+`/);
  assert.match(md, /```html/);
  assert.match(md, /boom from the test/);
  assert.match(md, /issue-1\.webp/);
});

test("drawer: Jump to view from another tab, then Fixed hides the marks", async () => {
  await page.click('#nav [data-view="settings"]');
  await page.locator('[data-dev-overlay] button[data-act="drawer"]').click();
  await page.locator('[data-dev-overlay] input[data-d="scope"]').check();
  const card = page.locator('[data-dev-overlay] .card').filter({ hasText: "Weather card too tall" });
  await card.locator('[data-d="jump"]').click();
  await page.waitForTimeout(500);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "overlay-drawer-1024x1366.png") });
  assert.equal(await page.evaluate(() => window.__devOverlay.getCurrentViewKey()), "today");
  await card.locator('input[data-d="fixed"]').check();
  await page.waitForTimeout(150);
  const r = await page.evaluate(() => ({ badges: window.__devOverlay.root.querySelectorAll(".badge").length, open: window.__devOverlay.issues().filter((i) => i.status === "open").length }));
  assert.deepEqual(r, { badges: 1, open: 1 });
  await page.locator('[data-dev-overlay] [data-d="close"]').click();
});

test("the overlay follows a popup: Settings > Your avatar is its own view", async () => {
  await page.click('#nav [data-view="settings"]');
  await page.click('[data-act="avatar-edit"]');
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => window.__devOverlay.getCurrentViewKey()), "modal:avatar-editor");
  await page.click('.sheet-panel [data-close]');
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__devOverlay.getCurrentViewKey()), "settings");
});

test("not loaded on another host name (only localhost, 127.0.0.1, [::1])", async () => {
  const p2 = await open("127.0.0.2");
  await p2.waitForTimeout(1500);
  const r = await p2.evaluate(() => ({ overlay: !!window.__devOverlay, host: !!document.querySelector("[data-dev-overlay]"), dev: !!window.__wardrobeDev }));
  assert.deepEqual(r, { overlay: false, host: false, dev: false });
  await p2.close();
});

test("no page errors", () => assert.deepEqual(errors, []));
