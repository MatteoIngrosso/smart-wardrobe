// Run with:  node --test tools/kiosk.e2e.mjs
// The wall screen layer (kiosk.js) in headless Chromium, on the sample wardrobe at the iPad Air 13"
// size (portrait 1024 x 1366, touch). Checks:
// - after 3 minutes without a touch the ambient screen comes: clock, weather, today's outfit; the
//   app underneath isn't painted and the 3D mirror draws nothing; the clock block moves every minute
// - a tap wakes it in well under 50 ms, the tap presses nothing, and the 3D mirror draws again
// - 5 taps on the page title open the diagnostics: graphics chip, frames, the mirror's memory,
//   storage, the offline cache; reset camera, the speed test and the cache refresh work
// - everything you tap in the item sheet, the confirm box, the cut-out editor and the diagnostics
//   is at least 48 x 48 px; rows that scroll sideways show no scrollbar and a mouse can drag them
// - Settings > Wall screen saves the minutes; a reload while asleep comes back asleep
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
const dir = mkdtempSync(join(tmpdir(), "wardrobe-kiosk-"));
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
const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const IPAD = { viewport: { width: 1024, height: 1366 }, hasTouch: true, isMobile: false, deviceScaleFactor: 1 };
const errors = [];
async function open(ctx) {
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => (/open-meteo/.test(r.request().url())
    ? r.fulfill({ contentType: "application/json", body: JSON.stringify(WEATHER) }) : r.abort()));
  return page;
}
// The sample wardrobe, a city (so the weather shows), Today with the 3D mirror running.
async function ready(page, { mirror = true } = {}) {
  await page.waitForFunction(() => window.__t?.kiosk && window.__t.state.items.length >= 20, null, { timeout: 60000 });
  await page.evaluate(async () => {
    const t = window.__t;
    Object.assign(t.state.settings, { city: "Milano", lat: 45.46, lon: 9.19 });
    await t.loadWeather(true);
    t.state.outfits = [];
    t.go("today");
  });
  if (mirror) await page.waitForFunction(() => window.__t.mirror.stage && !window.__t.mirror.loading, null, { timeout: 90000 });
  // the pieces baked for the mirror and the thumbnails made (after 3 idle minutes they long are)
  await page.waitForFunction(() => !window.__t.mirror.pending.size && !window.__t.thumbsBusy, null, { timeout: 120000 });
  await page.waitForTimeout(500);
}
const angleNear = (page, deg) => page.waitForFunction((d) => Math.abs(((window.__t.mirror.stage.angle - d + 540) % 360) - 180) < 1, deg, { timeout: 10000 });
const frames = (page) => page.evaluate(() => window.__t.mirror.stage?.debug.renderer.info.render.frame ?? -1);

const ctx = await browser.newContext(IPAD);
const page = await open(ctx);
await page.goto(url);
await ready(page);

test.after(async () => { await browser.close(); server.close(); rmSync(dir, { recursive: true, force: true }); });

test("on a big touch screen the ambient screen is on, after 3 minutes", async () => {
  const r = await page.evaluate(() => ({ minutes: window.__t.kiosk.minutes, card: !!window.__t.kiosk.card().includes('data-kiosk-idle="3" aria-pressed="true"') }));
  assert.equal(r.minutes, 3);
  assert.ok(r.card, "Settings shows 3 min picked");
});

test("asleep: clock, weather, today's outfit; nothing of the app painted; the 3D mirror draws nothing", async () => {
  await page.evaluate(() => window.__t.kiosk.sleep());
  const r = await page.evaluate(() => {
    const s = document.querySelector(".ambient-screen"), cs = (sel) => getComputedStyle(document.querySelector(sel));
    return {
      shown: !s.hidden && getComputedStyle(s).display !== "none",
      time: s.querySelector(".amb-time").textContent, date: s.querySelector(".amb-date").textContent,
      wx: s.querySelector(".amb-wx")?.textContent || "", wxIcon: !!s.querySelector(".amb-wx svg"),
      label: s.querySelector(".amb-label")?.textContent || "", pics: s.querySelectorAll(".amb-pics img").length,
      names: s.querySelector(".amb-names")?.textContent || "",
      main: cs("#main").visibility, nav: cs("#nav").visibility, bg: getComputedStyle(s).backgroundColor,
      paused: window.__t.mirror.stage.paused,
    };
  });
  console.log(`  ${r.time} · ${r.date} · ${r.wx} · ${r.label}: ${r.names}`);
  assert.ok(r.shown);
  assert.match(r.time, /\d{1,2}[:.]\d{2}/);
  assert.ok(r.date.length > 5);
  assert.match(r.wx, /14°/, "the temperature now");
  assert.match(r.wx, /Partly cloudy/);
  assert.ok(r.wxIcon);
  assert.ok(/today/i.test(r.label) && r.pics >= 3, `${r.label}, ${r.pics} photos`);
  assert.equal(r.main, "hidden"); assert.equal(r.nav, "hidden");
  assert.equal(r.bg, "rgb(0, 0, 0)");
  assert.ok(r.paused, "the stage is paused");
  // the 3D mirror is asked to turn: while asleep it draws not one frame
  const before = await frames(page);
  await page.evaluate(() => window.__t.mirror.stage.snapTo(90));
  await page.waitForTimeout(900);
  assert.equal(await frames(page), before, "no 3D frames while asleep");
  await page.screenshot({ path: join(dir, "ambient.png") });
});

test("a tap wakes it at once, presses nothing, and the 3D mirror draws again", async () => {
  const chip = await page.evaluate(() => {
    const t = window.__t; t.state.occasion = "casual";
    const r = document.querySelector('[data-occ="work"]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.evaluate(() => {
    // after kiosk.js's own listener: how long the wake took, and when the next frame came
    addEventListener("pointerdown", (e) => {
      const at = performance.now();
      window.__wake = { handled: at - e.timeStamp, asleep: document.documentElement.classList.contains("kiosk-asleep"), opacity: getComputedStyle(document.querySelector(".ambient-screen")).opacity };
      requestAnimationFrame((f) => (window.__wake.frame = f - e.timeStamp));
    }, { capture: true, once: true });
  });
  const before = await frames(page);
  await page.touchscreen.tap(chip.x, chip.y); // right on the Work chip
  await page.waitForTimeout(900);
  const r = await page.evaluate(() => ({ ...window.__wake, occ: window.__t.state.occasion, hidden: document.querySelector(".ambient-screen").hidden, main: getComputedStyle(document.querySelector("#main")).visibility, paused: window.__t.mirror.stage.paused, angle: window.__t.mirror.stage.angle }));
  console.log(`  woke in ${r.handled.toFixed(1)} ms, next frame after ${r.frame.toFixed(1)} ms`);
  assert.equal(r.asleep, false, "awake during the tap itself");
  assert.equal(r.opacity, "0", "the ambient screen is see-through at once");
  assert.ok(r.handled < 50 && r.frame < 50, `wake ${r.handled} ms, frame ${r.frame} ms`);
  assert.equal(r.occ, "casual", "the tap that woke it didn't press the chip");
  assert.ok(r.hidden); assert.equal(r.main, "visible"); assert.equal(r.paused, false);
  assert.ok((await frames(page)) > before, "the 3D mirror drew again");
  assert.ok(Math.abs(r.angle - 90) < 1, "and finished the turn asked for while asleep");
  await page.touchscreen.tap(chip.x, chip.y);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__t.state.occasion), "work", "awake, the same tap presses it");
});

test("5 taps on the page title open the diagnostics", async () => {
  await page.evaluate(() => { window.__t.state.occasion = "casual"; window.__t.generateOutfits(); window.__t.render(); });
  const h1 = await page.locator("#main h1").first().boundingBox();
  for (let k = 0; k < 5; k++) await page.touchscreen.tap(h1.x + 40, h1.y + h1.height / 2);
  await page.waitForSelector(".kdiag");
  await page.waitForTimeout(2600); // a couple of frame counts, and the storage and cache lines
  const r = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll(".kdiag dt")].map((dt) => [dt.textContent, dt.nextElementSibling.textContent])));
  for (const [k, v] of Object.entries(r)) console.log(`  ${k}: ${v}`);
  assert.ok(r["Graphics chip"].length > 3 && !/…/.test(r["Graphics chip"]));
  assert.match(r["Drawn by"], /processor|graphics chip/);
  assert.match(r["Frames per second"], /Screen \d+ · 3D mirror \d+/);
  assert.match(r["3D mirror in graphics memory"], /\d+ meshes · \d+ textures · \d+ shaders/);
  assert.match(r["Storage on this device"], /MB|GB/);
  assert.match(r["Offline cache"], /service worker|Nothing cached/);
  assert.match(r["Ambient screen"], /After 3 min/);
});

test("diagnostics: reset camera, 3D speed test", async () => {
  await page.evaluate(() => window.__t.mirror.stage.snapTo(180));
  await angleNear(page, 180);
  await page.click('[data-kdiag="camera"]');
  await angleNear(page, 0); // faces front again
  assert.match(await page.textContent("#kd-note"), /faces you again/);
  await page.click('[data-kdiag="speed"]');
  await page.waitForFunction(() => /frames a second while turning/.test(document.querySelector("#kd-note").textContent), null, { timeout: 15000 });
  console.log(`  ${await page.textContent("#kd-note")}`);
});

test("everything you tap in sheets, the cut-out editor and the diagnostics is at least 48 x 48", async () => {
  const small = () => page.evaluate(() => {
    const out = [];
    for (const root of document.querySelectorAll(".sheet:not([hidden]) .sheet-panel, .cutfix, .kdiag-panel")) {
      for (const el of root.querySelectorAll("button, a[href], [role=button], [data-close]")) {
        if (!el.getClientRects().length || getComputedStyle(el).visibility === "hidden") continue;
        const b = el.getBoundingClientRect();
        if (b.width < 47.5 || b.height < 47.5) out.push(`${el.className || el.tagName} "${(el.getAttribute("aria-label") || el.textContent).trim().slice(0, 30)}" ${Math.round(b.width)}x${Math.round(b.height)}`);
      }
    }
    return out;
  });
  const found = { diag: await small() };
  await page.click('.kdiag [data-kdiag="close"] >> nth=-1');
  await page.evaluate(() => window.__t.openItem(window.__t.state.items[0].id));
  await page.waitForSelector(".sheet:not([hidden]) .sheet-panel button");
  found.item = await small();
  await page.evaluate(() => { window.__t.closeSheet(); window.__t.confirmBox("Delete this?", "Delete"); });
  found.confirm = await small();
  await page.click("#cb-no");
  await page.evaluate(() => {
    const c = Object.assign(document.createElement("canvas"), { width: 600, height: 800 });
    c.getContext("2d").fillRect(100, 100, 400, 600);
    const m = Object.assign(document.createElement("canvas"), { width: 600, height: 800 });
    m.getContext("2d").fillRect(150, 150, 300, 500);
    window.__editing = import("/cutout-editor.js").then((x) => x.editCutout(c, m));
  });
  await page.waitForSelector(".cutfix");
  found.editor = await small();
  await page.click('.cutfix [data-fx="cancel"]');
  const bad = Object.entries(found).flatMap(([k, list]) => list.map((x) => `${k}: ${x}`));
  assert.deepEqual(bad, []);
});

test("rows that scroll sideways show no scrollbar, and a mouse can drag them without pressing a chip", async () => {
  await page.evaluate(() => { window.__t.go("wardrobe"); });
  const r = await page.evaluate(() => {
    const row = [...document.querySelectorAll(".scroller")].find((el) => el.scrollWidth > el.clientWidth + 20);
    if (!row) return null;
    row.id = "drag-row"; row.scrollLeft = 0;
    const b = row.getBoundingClientRect();
    return { x: b.x + b.width * 0.7, y: b.y + b.height / 2, bar: getComputedStyle(row).scrollbarWidth, slot: window.__t.state.filters.slot };
  });
  assert.ok(r, "a chip row wider than the screen");
  assert.equal(r.bar, "none");
  await page.mouse.move(r.x, r.y);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(r.x - k * 30, r.y);
  await page.mouse.up();
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ({ left: document.querySelector("#drag-row").scrollLeft, slot: window.__t.state.filters.slot }));
  assert.ok(after.left >= 250, `scrolled ${after.left} px`);
  assert.equal(after.slot, r.slot, "no chip pressed by the drag");
});

test("Settings > Wall screen keeps the minutes; a reload while asleep comes back asleep", async () => {
  await page.evaluate(() => window.__t.go("settings"));
  await page.click('[data-kiosk-idle="5"]');
  await page.waitForTimeout(300);
  assert.equal(await page.getAttribute('[data-kiosk-idle="5"]', "aria-pressed"), "true");
  await page.click('[data-kiosk="now"]');
  assert.ok(await page.evaluate(() => window.__t.kiosk.asleep));
  await page.reload();
  await page.waitForFunction(() => window.__t?.kiosk, null, { timeout: 60000 });
  await page.waitForTimeout(300);
  const r = await page.evaluate(() => ({ asleep: window.__t.kiosk.asleep, minutes: window.__t.kiosk.minutes }));
  assert.equal(r.minutes, 5);
  assert.ok(r.asleep, "back on the ambient screen after the reload");
  await page.mouse.click(500, 500);
  assert.equal(await page.evaluate(() => window.__t.kiosk.asleep), false);
});

test("Force refresh empties the offline cache and loads the app again", async () => {
  await page.evaluate(async () => { const c = await caches.open("wardrobe-vtest"); await c.put("/styles.css", new Response("x")); });
  await page.evaluate(() => window.__t.kiosk.openDiag());
  await Promise.all([page.waitForEvent("load"), page.click('[data-kdiag="refresh"]')]);
  await page.waitForFunction(() => window.__t?.kiosk, null, { timeout: 60000 });
  assert.deepEqual(await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith("wardrobe-"))), []);
});

test("with a fake clock: idle 3 minutes → asleep; the clock block moves every minute and stays on screen", async () => {
  const c2 = await browser.newContext(IPAD);
  const p2 = await open(c2);
  await p2.clock.install();
  await p2.goto(url);
  await ready(p2, { mirror: false });
  await p2.evaluate(() => window.__t.go("wardrobe"));
  await p2.mouse.move(10, 10); // a last touch now
  await p2.clock.fastForward("02:50");
  assert.equal(await p2.evaluate(() => window.__t.kiosk.asleep), false, "not yet at 2:50");
  await p2.clock.fastForward("00:15");
  assert.equal(await p2.evaluate(() => window.__t.kiosk.asleep), true, "asleep after 3 minutes");
  const at = () => p2.evaluate(() => {
    // where it's going (style), not where the transition has got to (it runs on the real clock)
    const b = document.querySelector(".amb-block"), m = b.style.transform.match(/-?[\d.]+/g).map(Number);
    return { x: m[0], y: m[1], w: b.offsetWidth, h: b.offsetHeight };
  });
  const a = await at();
  await p2.clock.fastForward("01:01");
  const b = await at();
  assert.ok(Math.hypot(b.x - a.x, b.y - a.y) > 1, `moved from ${a.x},${a.y} to ${b.x},${b.y}`);
  for (const q of [a, b]) assert.ok(q.x >= 0 && q.y >= 0 && q.x + q.w <= 1024 && q.y + q.h <= 1366, `on screen: ${JSON.stringify(q)}`);
  await c2.close();
});

test("no errors on the page", () => {
  assert.deepEqual(errors, []);
});
