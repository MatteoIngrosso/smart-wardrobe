// Run with:  node --test tools/integration.test.mjs
// How the files work together, after the refactors of November 2026:
// - sw.js (run in Node with a fake service-worker world): the code is network-first with the kept
//   copy as a fallback, the heavy files and CDN scripts cache-first, the API and sign-in untouched,
//   and nothing at all without a deploy version (development);
// - app.js in headless Chromium on the sample wardrobe: no page or console errors on any screen,
//   every photo on a screen has a URL that still resolves, a "Try a piece" photo keeps its URL
//   across screens, a photo shown by the page is never revoked, and a failing tap shows a toast;
// - avatar-stage.js on its own page: a slower piece never overwrites the one asked for last in the
//   same slot, a hidden container keeps the canvas at its last size, and a lost GPU context comes
//   back with the scene drawn again.
// Needs Playwright with Chromium.
import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/* ======================================================================
   sw.js in a fake service-worker world
   ====================================================================== */
const ORIGIN = "https://wardrobe.test";
// What sw.js reads of a Response (Node's own Response can't be given type "basic").
class FakeResponse {
  constructor({ status = 200, type = "basic", redirected = false, headers = {}, body = "" } = {}) {
    Object.assign(this, { status, type, redirected, body });
    this.headers = new Headers(headers);
    this.ok = status >= 200 && status < 300;
  }
  clone() { return new FakeResponse({ status: this.status, type: this.type, redirected: this.redirected, headers: Object.fromEntries(this.headers), body: this.body }); }
}
const file = (body, type = "text/javascript") => new FakeResponse({ body, headers: { "Content-Type": type } });

// A service worker with `net` as the network: net(url, request) returns a FakeResponse, throws, or
// returns a promise that never settles (a slow connection).
function startSW({ live = true, net }) {
  const handlers = {};
  const stores = new Map();
  const calls = [];
  const cacheOf = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    const key = (u) => (typeof u === "string" ? u : u.url);
    return {
      async match(u) { const r = m.get(key(u)); return r ? r.clone() : undefined; },
      async put(u, res) { m.set(key(u), res); },
      async keys() { return [...m.keys()].map((u) => new Request(u)); },
    };
  };
  const ctx = {
    self: null, console, URL, Request, Headers, Symbol, setTimeout, clearTimeout, Promise,
    caches: { open: async (n) => cacheOf(n), keys: async () => [...stores.keys()], delete: async (n) => stores.delete(n) },
    fetch: async (input, init) => { const url = typeof input === "string" ? input : input.url; calls.push(url); return net(url, input, init); },
  };
  ctx.self = { addEventListener: (t, f) => (handlers[t] = f), registration: { scope: ORIGIN + "/", active: null }, location: { origin: ORIGIN }, skipWaiting: async () => {}, clients: { claim: async () => {} } };
  const code = readFileSync(join(ROOT, "sw.js"), "utf8").replace('"__SW_VERSION__"', live ? '"vtest1"' : '"__SW_VERSION__"');
  vm.runInNewContext(code, ctx, { filename: "sw.js" });
  const cache = cacheOf("wardrobe-vtest1");
  // A GET from a page: the response the service worker gives, or undefined when it leaves the request alone.
  async function ask(path, { method = "GET", mode = "cors", cache: cacheMode = "default", headers = {} } = {}) {
    const request = new Request(path.startsWith("http") ? path : ORIGIN + path, { method, headers, cache: cacheMode });
    Object.defineProperty(request, "mode", { value: mode });
    let answer;
    handlers.fetch({ request, respondWith: (p) => { answer = p; }, waitUntil: () => {} });
    return answer === undefined ? undefined : await answer;
  }
  return { ask, cache, calls, stores, handlers };
}

test("sw.js: the code comes from the network first and the copy is kept", async () => {
  const sw = startSW({ net: (url) => file(`// fresh ${url}`) });
  const res = await sw.ask("/app.js");
  assert.equal(res.body, `// fresh ${ORIGIN}/app.js`);
  await new Promise((r) => setTimeout(r, 0));
  assert.equal((await sw.cache.match(ORIGIN + "/app.js"))?.body, `// fresh ${ORIGIN}/app.js`, "the network's answer is kept");
  for (const p of ["/styles.css", "/calendar.js", "/fashion-bible.json"]) assert.equal((await sw.ask(p)).body, `// fresh ${ORIGIN}${p}`);
});

test("sw.js: offline, or on a bad answer, the kept copy of the code stands in", async () => {
  let online = true, answer = () => file("// new");
  const sw = startSW({ net: () => { if (!online) throw new TypeError("Failed to fetch"); return answer(); } });
  await sw.ask("/app.js");
  await new Promise((r) => setTimeout(r, 0));
  online = false;
  assert.equal((await sw.ask("/app.js")).body, "// new", "offline: the kept copy");
  online = true;
  answer = () => new FakeResponse({ status: 200, redirected: true, headers: { "Content-Type": "text/html" }, body: "<form>sign in</form>" });
  assert.equal((await sw.ask("/app.js")).body, "// new", "a redirect to the sign-in page: the kept copy");
  answer = () => new FakeResponse({ status: 503, body: "busy" });
  assert.equal((await sw.ask("/app.js")).body, "// new", "a server error: the kept copy");
  answer = () => new FakeResponse({ status: 503, body: "busy" });
  assert.equal((await sw.ask("/never-seen.js")).status, 503, "nothing kept: the network's answer, whatever it is");
  online = false;
  await assert.rejects(sw.ask("/never-seen.js"), "nothing kept and offline: the request fails as it would without a service worker");
});

test("sw.js: a slow network gives way to the kept copy after NET_MS", async () => {
  let slow = false;
  const sw = startSW({ net: () => (slow ? new Promise(() => {}) : file("// kept")) });
  await sw.ask("/app.js");
  await new Promise((r) => setTimeout(r, 0));
  slow = true;
  const t0 = Date.now();
  assert.equal((await sw.ask("/app.js")).body, "// kept");
  const ms = Date.now() - t0;
  assert.ok(ms >= 3500 && ms < 6000, `after about 4 s (${ms} ms)`);
});

test("sw.js: the heavy files come from the cache once seen, CDN scripts too; everything else is left alone", async () => {
  const sw = startSW({ net: (url, req) => {
    if (url.startsWith("https://cdn.jsdelivr.net/")) return new FakeResponse({ type: "cors", body: "export default 1", headers: { "Content-Type": "text/javascript" } });
    return file("bytes", url.endsWith(".bin") ? "application/octet-stream" : "text/javascript");
  } });
  for (const p of ["/avatar/avatar.bin", "/vendor/three/three.module.min.js", "/sample/seed.js", "/icon.svg"]) {
    await sw.ask(p); await new Promise((r) => setTimeout(r, 0));
    const before = sw.calls.length;
    assert.equal((await sw.ask(p)).body, "bytes", p);
    assert.equal(sw.calls.length, before, `${p}: the second time, no network`);
  }
  const cdn = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";
  assert.equal((await sw.ask(cdn)).body, "export default 1");
  await new Promise((r) => setTimeout(r, 0));
  const before = sw.calls.length;
  assert.equal((await sw.ask(cdn)).body, "export default 1");
  assert.equal(sw.calls.length, before, "the CDN script is kept");
  assert.equal(await sw.ask("https://cdn.jsdelivr.net/npm/@imgly/background-removal-data@1.7.0/dist/model.onnx"), undefined, "a model file is not the service worker's business");
  for (const [p, opts] of [["/api/ping"], ["/api/changes?since=0"], ["/lens/abc"], ["/login"], ["/sw.js"], ["/app.js", { method: "POST" }], ["/app.js", { cache: "no-store" }], ["/app.js", { cache: "reload" }], ["/app.js", { headers: { Range: "bytes=0-10" } }], ["https://api.open-meteo.com/v1/forecast"]]) {
    assert.equal(await sw.ask(p, opts), undefined, `${p} ${JSON.stringify(opts || {})} goes straight to the network`);
  }
});

test("sw.js: without a deploy version (development) nothing is touched", async () => {
  const sw = startSW({ live: false, net: () => file("// dev") });
  assert.equal(await sw.ask("/app.js"), undefined);
  assert.equal(await sw.ask("/avatar/avatar.bin"), undefined);
  assert.equal(await sw.ask("/", { mode: "navigate" }), undefined);
});

test("sw.js: the page is asked from the network and kept; the kept page stands in offline", async () => {
  let online = true;
  const sw = startSW({ net: () => { if (!online) throw new TypeError("Failed to fetch"); return file("<html>app</html>", "text/html; charset=utf-8"); } });
  assert.equal((await sw.ask("/", { mode: "navigate" })).body, "<html>app</html>");
  await new Promise((r) => setTimeout(r, 0));
  online = false;
  assert.equal((await sw.ask("/", { mode: "navigate" })).body, "<html>app</html>");
});

/* ======================================================================
   The app and the 3D stage in headless Chromium
   ====================================================================== */
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = mkdtempSync(join(tmpdir(), "wardrobe-integration-"));
for (const f of ["index.html", "app.js", "stylist.js", "label.js", "calendar.js", "cutout-editor.js", "avatar-config.js", "avatar-stage.js", "garment-baker.js", "mannequin-shells.js", "face-photo.js", "styles.css", "fashion-bible.json", "manifest.webmanifest", "icon.svg"])
  if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(dir, f));
for (const d of ["sample", "vendor", "avatar"]) if (existsSync(join(ROOT, d))) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
const src = readFileSync(join(ROOT, "app.js"), "utf8");
const DECL = /^(?:async\s+)?function\s+([\w$]+)|^(?:const|let)\s+([\w$]+)\s*=|^import \* as ([\w$]+)/gm;
const names = [...new Set(Array.from(src.matchAll(DECL), (m) => m[1] || m[2] || m[3]))];
writeFileSync(join(dir, "app.js"), `${src}\nwindow.__t = {${names.map((n) => `get ${n}() { return ${n}; }`).join(",")}};\n`);
writeFileSync(join(dir, "stage.html"), `<!doctype html><title>stage</title><style>html,body{margin:0;height:100%;background:#000}#host{width:480px;height:640px;position:relative}</style>
<div id="host"></div><script type="module">import { createStage } from "./avatar-stage.js"; import * as baker from "./garment-baker.js"; window.__s = { createStage, baker };</script>`);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".bin": "application/octet-stream", ".webmanifest": "application/manifest+json" };
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
const errors = [], consoleErrors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|net::ERR_|ERR_FAILED/.test(m.text())) consoleErrors.push(m.text()); });
await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort()); // no weather, AI or CDN: all on the device

test.after(async () => { await browser.close(); server.close(); rmSync(dir, { recursive: true, force: true }); });

const VIEWS = ["today", "plan", "wardrobe", "add", "shop", "settings"];
// Every <img> on the screen: its src is a real address, and a blob: one still resolves.
const checkImages = () => page.evaluate(async () => {
  const out = { n: 0, bad: [] };
  for (const img of document.images) {
    out.n++;
    const s = img.getAttribute("src") || "";
    if (!/^(blob:|data:|https?:|[a-z0-9_./-]+$)/i.test(s)) out.bad.push(`odd src ${s.slice(0, 40)}`);
    if (s.startsWith("blob:")) { try { if (!(await fetch(s)).ok) out.bad.push(`dead ${s}`); } catch { out.bad.push(`dead ${s}`); } }
  }
  return out;
});

test("the sample wardrobe opens on every screen without errors, every photo shown resolves", async () => {
  await page.goto(url);
  await page.waitForFunction(() => window.__t?.state?.items?.length >= 20, null, { timeout: 60000 });
  await page.waitForFunction(() => window.__t.mirror.stage || window.__t.mirror.failed, null, { timeout: 120000 });
  assert.equal(await page.evaluate(() => window.__t.mirror.failed?.message || ""), "", "the 3D mirror started");
  for (const v of VIEWS) {
    await page.evaluate((v) => window.__t.go(v), v);
    await page.waitForTimeout(300);
    const imgs = await checkImages();
    assert.deepEqual(imgs.bad, [], `${v}: ${imgs.n} images`);
  }
  // a piece's sheet, with its full photos
  await page.evaluate(() => { window.__t.go("wardrobe"); window.__t.openItem(window.__t.state.items[0].id); });
  const imgs = await checkImages();
  assert.deepEqual(imgs.bad, []);
  assert.ok(imgs.n > 10, `${imgs.n} images on the wardrobe screen with a sheet open`);
  assert.deepEqual(errors, [], "page errors");
  assert.deepEqual(consoleErrors, [], "console errors");
});

test("photo URLs: one per Blob; a 'Try a piece' photo and any photo on the page survive a change of screen", async () => {
  const r = await page.evaluate(async () => {
    const { state, photoURL, urlCache, BlobUrlManager } = window.__t;
    const t = window.__t;
    const blobOf = async () => (await fetch("sample/cut/124743029.webp")).blob();
    const live = async (u) => { try { return (await fetch(u)).ok; } catch { return false; } };
    const item = state.items[0];
    const same = photoURL(item.photos[0]) === photoURL(item.photos[0]) && BlobUrlManager.url(item) === photoURL(item.photos[0]);
    // a photo under "Try a piece", held by nothing else
    const tryBlob = await blobOf();
    state.disc.try.shown = { title: "Test tee", cat: "tshirt", color: "black", photo: tryBlob };
    const tryURL = photoURL(tryBlob);
    // a photo shown by the page (in the sheet) that no record holds
    const loose = await blobOf();
    const looseURL = photoURL(loose);
    document.querySelector(".sheet-panel").innerHTML = `<img id="loose" src="${looseURL}" alt="">`;
    // a photo nobody holds or shows
    const orphan = await blobOf();
    const orphanURL = photoURL(orphan);
    const before = urlCache.size;
    t.go("wardrobe");
    t.go("settings");
    const after = urlCache.size;
    const kept = { tryAlive: await live(tryURL), looseAlive: await live(looseURL), orphanAlive: await live(orphanURL), trySame: photoURL(tryBlob) === tryURL };
    document.querySelector(".sheet-panel").innerHTML = "";
    state.disc.try.shown = null;
    t.go("today");
    const gone = { tryAlive: await live(tryURL), looseAlive: await live(looseURL) };
    return { same, kept, gone, before, after, count: BlobUrlManager.count };
  });
  assert.ok(r.same, "the same Blob always gives the same URL, by Blob or by piece");
  assert.deepEqual(r.kept, { tryAlive: true, looseAlive: true, orphanAlive: false, trySame: true }, "what is held or shown stays; what nobody holds goes");
  assert.deepEqual(r.gone, { tryAlive: false, looseAlive: false }, "released once nothing holds or shows them");
  assert.ok(r.after <= r.before, "the sweep never grows the cache");
  assert.equal(typeof r.count, "number");
});

test("a tap on something that is gone does nothing; an error in a tap shows a toast instead of vanishing", async () => {
  const r = await page.evaluate(async () => {
    const t = window.__t;
    t.go("wardrobe");
    document.body.insertAdjacentHTML("beforeend", `<button id="ghost" data-wash="no-such-piece">x</button><button id="boom" data-act="city">y</button>`);
    document.getElementById("ghost").click();
    await new Promise((r) => setTimeout(r, 50));
    const toast = document.getElementById("toast");
    const quiet = toast.hidden;
    t.failed(new Error("boom"), "a test");
    const shown = !toast.hidden && toast.textContent;
    document.getElementById("ghost").remove(); document.getElementById("boom").remove();
    return { quiet, shown };
  });
  assert.equal(r.quiet, true, "a stale tap is ignored quietly");
  assert.match(r.shown || "", /Something went wrong with a test: boom/);
  assert.deepEqual(errors, [], "page errors");
});

/* ---------- the 3D stage on its own ---------- */
const stagePage = await ctx.newPage();
const stageErrors = [];
stagePage.on("pageerror", (e) => stageErrors.push(String(e)));

// Two synthetic tops (a filled shape with a neckline, a coloured block as the print), baked by the
// garment baker, so the stage gets real BakedGarmentAssets without AI or photos.
const makeAssets = () => stagePage.evaluate(async () => {
  const make = (fabric, block) => {
    const c = Object.assign(document.createElement("canvas"), { width: 640, height: 760 }), g = c.getContext("2d");
    g.fillStyle = fabric; g.beginPath();
    g.moveTo(210, 70); g.lineTo(430, 70); g.lineTo(600, 160); g.lineTo(560, 290); g.lineTo(470, 250);
    g.lineTo(470, 720); g.lineTo(170, 720); g.lineTo(170, 250); g.lineTo(80, 290); g.lineTo(40, 160); g.closePath(); g.fill();
    g.globalCompositeOperation = "destination-out"; g.beginPath(); g.ellipse(320, 66, 62, 40, 0, 0, Math.PI * 2); g.fill();
    g.globalCompositeOperation = "source-over"; g.fillStyle = block; g.fillRect(260, 260, 120, 120);
    return new Promise((r) => c.toBlob(r, "image/png"));
  };
  const base = { category: "tshirt", fit: "regular", colors: ["white"], styles: ["casual"], warmth: 2, tags: [] };
  const out = {};
  for (const [id, fabric, block] of [["A", "#e6e6e6", "#ff8a00"], ["B", "#303030", "#16d43a"]]) {
    const front = await make(fabric, block), back = await make(fabric, "#8a2be2");
    out[id] = await window.__s.baker.bakeGarment({ ...base, id, name: `Test ${id}` }, { front, back }, { sig: id });
  }
  window.__assets = out;
  return Object.fromEntries(Object.entries(out).map(([k, a]) => [k, !!a && a.slot]));
});

test("3D stage: a slower piece never overwrites the one asked for last in the same slot", async () => {
  await stagePage.goto(url + "stage.html");
  await stagePage.waitForFunction(() => !!window.__s, null, { timeout: 30000 });
  await stagePage.evaluate(async () => { window.stage = await window.__s.createStage(document.getElementById("host"), {}); });
  assert.deepEqual(await makeAssets(), { A: "top", B: "top" });
  const r = await stagePage.evaluate(async () => {
    const { A, B } = window.__assets, stage = window.stage;
    await stage.prepare(B); // B is ready at once; A still has to decode its textures
    const pa = stage.setGarment("top", A, { name: "Test A" });
    const pb = stage.setGarment("top", B, { name: "Test B" });
    await Promise.all([pa, pb]);
    await new Promise((r) => setTimeout(r, 100));
    const worn1 = stage.debug.state.worn.top?.prep.asset.garmentId;
    // and the other way round: the one asked for last wins even when it's the slow one
    stage.setGarment("top", null);
    const pb2 = stage.setGarment("top", B, { name: "Test B" });
    await pb2;
    const worn2 = stage.debug.state.worn.top?.prep.asset.garmentId;
    // taken off while loading: nothing goes on
    stage.setGarment("top", null);
    const slow = stage.setGarment("top", { ...A, updatedAt: 7 }, { name: "Test A" }); // (a new key: prepared again)
    stage.setGarment("top", null);
    await slow;
    await new Promise((r) => setTimeout(r, 100));
    const worn3 = stage.debug.state.worn.top ? stage.debug.state.worn.top.prep.asset.garmentId : null;
    return { worn1, worn2, worn3 };
  });
  assert.deepEqual(r, { worn1: "B", worn2: "B", worn3: null });
  assert.deepEqual(stageErrors, []);
});

test("3D stage: a hidden container keeps the canvas at its last size; shown again it fits", async () => {
  const r = await stagePage.evaluate(async () => {
    const stage = window.stage, host = document.getElementById("host"), canvas = stage.debug.renderer.domElement;
    const frames = (n) => new Promise((r) => { const f = () => (n-- > 0 ? requestAnimationFrame(f) : r()); f(); });
    await frames(2);
    const ratio = stage.debug.renderer.getPixelRatio();
    const shown = { w: canvas.width, h: canvas.height };
    host.style.display = "none";
    await frames(3);
    const hidden = { w: canvas.width, h: canvas.height, stale: !!stage.debug.state.sizeStale };
    host.style.display = ""; host.style.width = "360px"; host.style.height = "500px";
    await frames(3);
    const back = { w: canvas.width, h: canvas.height, want: [Math.floor(360 * ratio), Math.floor(500 * ratio)], stale: !!stage.debug.state.sizeStale };
    host.style.width = "480px"; host.style.height = "640px";
    await frames(3);
    return { shown, hidden, back };
  });
  assert.ok(r.shown.w > 100 && r.shown.h > 100, `drawn at ${r.shown.w}x${r.shown.h}`);
  assert.deepEqual([r.hidden.w, r.hidden.h, r.hidden.stale], [r.shown.w, r.shown.h, true], "hidden: the last size stays, marked stale");
  assert.deepEqual([r.back.w, r.back.h, r.back.stale], [...r.back.want, false], "shown again: the new size");
});

test("3D stage: a lost GPU context comes back with the scene drawn again", async () => {
  const r = await stagePage.evaluate(async () => {
    const stage = window.stage, renderer = stage.debug.renderer, gl = renderer.getContext();
    const until = (f, ms = 5000) => new Promise((res, rej) => { const t0 = performance.now(); const tick = () => (f() ? res() : performance.now() - t0 > ms ? rej(new Error("timeout")) : setTimeout(tick, 20)); tick(); });
    // the bright pixels across the middle of the picture (the body, over the dark backdrop)
    const bright = () => {
      stage.debug.render();
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, px = new Uint8Array(w * 4);
      gl.readPixels(0, (h / 2) | 0, w, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      let n = 0; for (let i = 0; i < w; i++) if (Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]) > 80) n++;
      return n / w;
    };
    const before = bright();
    const supported = stage.debug.loseContext();
    if (!supported) return { supported };
    await until(() => stage.debug.contextLost);
    const lost = { flag: stage.debug.contextLost, gl: gl.isContextLost() };
    stage.debug.restoreContext();
    await until(() => !stage.debug.contextLost && !gl.isContextLost());
    await new Promise((r) => setTimeout(r, 200));
    const after = bright();
    const env = !!stage.debug.scene.environment;
    return { supported, before, lost, after, env, triangles: renderer.info.render.triangles };
  });
  assert.equal(r.supported, true, "WEBGL_lose_context is available here");
  assert.ok(r.before > 0.05, `the body shows before (${r.before.toFixed(3)} of the middle row is bright)`);
  assert.deepEqual(r.lost, { flag: true, gl: true });
  assert.ok(r.after > 0.05 && Math.abs(r.after - r.before) < 0.15, `drawn again after (${r.after.toFixed(3)} bright, was ${r.before.toFixed(3)})`);
  assert.equal(r.env, true, "the environment light is back");
  assert.ok(r.triangles > 1000, `${r.triangles} triangles drawn`);
  assert.deepEqual(stageErrors, []);
});
