// Run with:  node --test tools/avatar-editor.e2e.mjs
// Settings > Your avatar in headless Chromium, on the sample wardrobe at the iPad Air 13" size
// (portrait 1024 x 1366, touch). Checks:
// - Today's mirror has no body panel any more: the stage and Today's ideas only
// - Settings has a Your avatar card; Customize avatar opens a popup with the Body / Face & hair panel
//   next to the 3D avatar (the same stage, moved into the popup)
// - More detail: the shoulders and leg length sliders reshape the body; old saved bodies are unchanged;
//   Reset puts them back
// - a slider changes the avatar in the popup; Save keeps it and the Settings line says the new height
// - closing the popup gives the stage back to Today
// Set SHOTS=<dir> for screenshots. Needs Playwright with Chromium.
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
const dir = mkdtempSync(join(tmpdir(), "wardrobe-avatar-editor-"));
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

// Open-Meteo answers with a mild, partly cloudy day; nothing else leaves the machine.
const hours = Array.from({ length: 48 }, (_, k) => new Date(Date.now() - 3600e3 * 6 + k * 3600e3).toISOString().slice(0, 13) + ":00");
const WEATHER = {
  current: { temperature_2m: 14.2, apparent_temperature: 13.1, relative_humidity_2m: 60, weather_code: 2, wind_speed_10m: 8, precipitation: 0 },
  hourly: { time: hours, apparent_temperature: hours.map(() => 13), precipitation_probability: hours.map(() => 10), weather_code: hours.map(() => 2), relative_humidity_2m: hours.map(() => 60) },
  daily: { temperature_2m_max: [16, 15], temperature_2m_min: [9, 8], precipitation_probability_max: [20, 10] },
};
const SHOTS = process.env.SHOTS;
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: false, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => (/open-meteo/.test(r.request().url())
  ? r.fulfill({ contentType: "application/json", body: JSON.stringify(WEATHER) }) : r.abort()));
await page.goto(url);
await page.waitForFunction(() => window.__t?.state && window.__t.state.items.length >= 20, null, { timeout: 60000 });
await page.evaluate(async () => {
  const t = window.__t;
  Object.assign(t.state.settings, { city: "Milano", lat: 45.46, lon: 9.19 });
  await t.loadWeather(true);
  t.state.outfits = [];
  t.go("today");
});
await page.waitForFunction(() => window.__t.mirror.stage || window.__t.mirror.failed, null, { timeout: 90000 });

test.after(async () => { await browser.close(); server.close(); rmSync(dir, { recursive: true, force: true }); });

test("Today: the mirror has no body panel, the stage is wider", async () => {
  const r = await page.evaluate(() => ({
    body: !!document.querySelector(".mirror-body"),
    stage: document.querySelector("#stage3d").getBoundingClientRect().width,
    host: !!document.querySelector("#stage3d .stage3d-host"),
  }));
  assert.equal(r.body, false);
  assert.ok(r.host, "the 3D stage is on Today");
  assert.ok(r.stage > 600, `stage ${r.stage}px wide`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "today-1024x1366.png") });
});

test("Settings > Your avatar opens the panel next to the 3D avatar", async () => {
  await page.evaluate(() => window.__t.go("settings"));
  const card = await page.evaluate(() => [...document.querySelectorAll("main section h2")].map((h) => h.textContent));
  assert.ok(card.includes("Your avatar"), card.join(", "));
  await page.click('[data-act="avatar-edit"]');
  await page.waitForFunction(() => document.querySelector("#stage3d-preview .stage3d-host") && window.__t.mirror.stage);
  const r = await page.evaluate(() => ({
    sheet: !document.querySelector("#sheet").hidden,
    panel: !!document.querySelector(".sheet-panel .mirror-body"),
    tabs: [...document.querySelectorAll(".sheet-panel [data-mbtab]")].map((b) => b.textContent),
    sliders: document.querySelectorAll('.sheet-panel input[type="range"][data-input^="mb-"]').length,
    stage: document.querySelector("#stage3d-preview").getBoundingClientRect().width,
  }));
  assert.ok(r.sheet && r.panel);
  assert.deepEqual(r.tabs, ["Body", "Face & hair"]);
  assert.equal(r.sliders, 11, "height, weight, build and the 8 of More detail");
  assert.ok(r.stage > 400, `stage ${r.stage}px wide`);
  await page.click('.sheet-panel [data-mbtab="face"]');
  assert.ok(await page.evaluate(() => document.querySelectorAll('.sheet-panel [data-mb="hairStyle"]').length > 5), "Face & hair shows the hairstyles");
  await page.click('.sheet-panel [data-mbtab="body"]');
});

test("a slider changes the avatar; Save keeps it and Settings says so", async () => {
  await page.evaluate(() => {
    const s = document.querySelector("#mb-height");
    s.value = "191";
    s.dispatchEvent(new Event("input", { bubbles: true }));
    s.dispatchEvent(new Event("change", { bubbles: true }));
  });
  assert.equal(await page.textContent("#mb-height-v"), "191 cm");
  assert.equal(await page.textContent("#mb-save"), "Save body");
  await page.waitForTimeout(800);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "settings-avatar-popup-1024x1366.png") });
  await page.click("#mb-save");
  await page.waitForFunction(() => window.__t.state.avatar?.body?.heightCm === 191);
  await page.waitForFunction(() => document.querySelector("#mb-save")?.textContent === "Saved", null, { timeout: 5000 }); // (once it's stored)
  assert.match(await page.evaluate(() => document.querySelector('main [data-act="avatar-edit"]').closest("section").textContent), /191/);
});

test("More detail: shoulders and leg length reshape him; Reset puts them back", async () => {
  // the stage's built body: shoulder joints apart and the hip joint's height (metres-ish, as built)
  const measure = () => page.evaluate(() => {
    const J = window.__t.mirror.stage.debug.state.B.J;
    return { shoulders: J.shoulderL[0] - J.shoulderR[0], hip: J.hipL[1], id: window.__t.mirror.stage.debug.state.bodyId };
  });
  const move = (k, v) => page.evaluate(([k, v]) => {
    const s = document.querySelector(`#mb-shape-${k}`);
    s.value = String(v);
    s.dispatchEvent(new Event("input", { bubbles: true }));
    s.dispatchEvent(new Event("change", { bubbles: true }));
  }, [k, v]);
  const rebuilt = (id) => page.waitForFunction((id) => window.__t.mirror.stage.debug.state.bodyId !== id, id, { timeout: 60000 });
  const before = await measure();
  assert.equal(await page.textContent("#mb-shape-shoulders-v"), "Average");
  await move("shoulders", 10);
  assert.equal(await page.textContent("#mb-shape-shoulders-v"), "Broader +10");
  await rebuilt(before.id);
  const broad = await measure();
  assert.ok(broad.shoulders > before.shoulders * 1.03, `shoulders ${before.shoulders.toFixed(3)} → ${broad.shoulders.toFixed(3)}`);
  await move("legs", 10);
  await rebuilt(broad.id);
  const legs = await measure();
  assert.ok(legs.hip > broad.hip * 1.02, `hip height ${broad.hip.toFixed(3)} → ${legs.hip.toFixed(3)} (same height, longer legs)`);
  assert.deepEqual(await page.evaluate(() => window.__t.bodyDraft().shape), { shoulders: 10, chest: 0, waist: 0, belly: 0, hips: 0, arms: 0, legs: 10, neck: 0 });
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "settings-avatar-more-detail-1024x1366.png") });
  await page.click('.sheet-panel [data-act="body-shape-reset"]');
  await rebuilt(legs.id);
  const back = await measure();
  assert.ok(Math.abs(back.shoulders - before.shoulders) < 1e-4 && Math.abs(back.hip - before.hip) < 1e-4, "Reset gives the same body back");
  assert.equal(await page.textContent("#mb-shape-legs-v"), "Average");
  // a body saved before More detail existed is the same body
  assert.ok(await page.evaluate(() => window.__t.Avatar.sameBody({ heightCm: 180, weightKg: 75, build: "regular" }, { heightCm: 180, weightKg: 75, build: "regular", shape: { legs: 0 } })));
});

test("closing the popup gives the stage back to Today; no errors", async () => {
  await page.click('.sheet-panel [data-close]');
  await page.evaluate(() => window.__t.go("today"));
  await page.waitForFunction(() => document.querySelector("#stage3d .stage3d-host"));
  const r = await page.evaluate(() => ({ preview: window.__t.mirror.preview, sheet: document.querySelector("#sheet").hidden }));
  assert.equal(r.preview, null);
  assert.equal(r.sheet, true);
  assert.deepEqual(errors, []);
});
