// Add > Paste a link, in the app on an iPad-sized page (Playwright, Chromium). Every /api call
// and the AI are answered here, nothing leaves the machine:
// - the Google app's Share text for a BOSS shirt fills a new piece: brand, type, colour, fit,
//   price, material and link from the shop's page, the app's own simple name, the shop's name in
//   the notes, and only the shop's photos of the shirt on its own (front, then back): no worn
//   photo, no photo of the other colour
// - with the AI failing, no shop photo is kept at all (the main one is often worn)
// - a share link that only leads to a Google search finds the shop's page by the product's name
// - editing a piece you have: your name, size and wears stay, the shop's photo goes first and
//   yours after it; Cancel leaves the saved piece as it was
// - Google Lens matches still fill the piece in and pick its photos as before
// Run with:  node --test tools/link-add.e2e.mjs      (SHOTS=<dir> also saves screenshots)
import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SHOTS = process.env.SHOTS || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

// A copy of the app with every top-level function and constant of app.js on window.__t.
const dir = mkdtempSync(join(tmpdir(), "wardrobe-link-"));
for (const f of readdirSync(ROOT)) if (/\.(js|css|html|json|webmanifest|svg|png)$/.test(f) && !/^(package|wrangler)/.test(f)) cpSync(join(ROOT, f), join(dir, f));
for (const d of ["sample", "vendor", "avatar"]) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
const src = readFileSync(join(ROOT, "app.js"), "utf8");
const DECL = /^(?:async\s+)?function\s+([\w$]+)|^(?:const|let)\s+([\w$]+)\s*=|^import \* as ([\w$]+)/gm;
const names = [...new Set(Array.from(src.matchAll(DECL), (m) => m[1] || m[2] || m[3]))];
writeFileSync(join(dir, "app.js"), `${src}\nwindow.__t = {${names.map((n) => `get ${n}() { return ${n}; }`).join(",")}, set draft(v) { draft = v; }};\n`);

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

// The shop: a Hugo Boss page with 6 photos named the way its image server names them
// (hbeu<model>_<colour>_<view>): the shirt flat front (100) and back (200), worn three times
// (300, 340, 350) and the same shirt in light blue (455).
const BOSS = "https://www.hugoboss.com/it/camicia-slim-fit-in-cotone-elasticizzato/hbeu50525359_100.html";
const IMG = (v, c = "100") => `https://images.hugoboss.com/is/image/boss/hbeu50525359_${c}_${v}?$re_fullPageZoom$&qlt=85&wid=1200`;
const PHOTOS = { [IMG(100)]: "flat-front", [IMG(300)]: "worn", [IMG(200)]: "flat-back", [IMG(340)]: "worn", [IMG(350)]: "worn", [IMG(100, "455")]: "blue" };
const PAGE = {
  url: BOSS, title: "BOSS - Camicia slim fit in cotone elasticizzato - Bianco", image: IMG(100), images: Object.keys(PHOTOS),
  description: "Camicia slim fit in cotone elasticizzato con collo alla francese.", color: "", brand: "BOSS", price: "199.95 EUR", site: "hugoboss.com", text: "", tried: ["shop: 6 photos"],
};
const SHARE = "BOSS - Camicia slim fit in cotone elasticizzato - Bianco https://share.google/H3toR0wOO1aU6OEhX";
const DETAILS = "name: Camicia slim fit in cotone elasticizzato\nbrand: BOSS\ntype: shirt\ncolour: white\nfit: slim\nmaterial: 98% cotton, 2% elastane\ndescription: A slim-fit stretch cotton shirt.\nprice: 199.95 EUR";

// The photos, drawn: a white shirt on the shop's grey, or worn by someone (skin, trousers).
async function drawPhotos(page) {
  const out = {};
  for (const kind of ["flat-front", "flat-back", "worn", "blue"]) {
    const b64 = await page.evaluate(async (kind) => {
      const c = new OffscreenCanvas(400, 600), g = c.getContext("2d");
      g.fillStyle = "#ebebeb"; g.fillRect(0, 0, 400, 600);
      g.fillStyle = kind === "blue" ? "#9cc3e6" : "#ffffff";
      if (kind === "worn") {
        g.fillStyle = "#c9a184"; g.beginPath(); g.arc(200, 70, 45, 0, 7); g.fill();
        g.fillStyle = "#ffffff"; g.fillRect(110, 120, 180, 230);
        g.fillStyle = "#23283a"; g.fillRect(120, 350, 160, 230);
      } else {
        g.fillRect(110, 90, 180, 420); g.fillRect(40, 100, 70, 260); g.fillRect(290, 100, 70, 260);
        g.fillStyle = kind === "flat-back" ? "#f2f2f2" : "#dcdcdc"; g.fillRect(185, 90, 30, kind === "flat-back" ? 10 : 420);
      }
      const blob = await c.convertToBlob({ type: "image/png" });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let s = ""; for (const x of bytes) s += String.fromCharCode(x);
      return btoa(s);
    }, kind);
    out[kind] = Buffer.from(b64, "base64");
  }
  return out;
}

// Everything the app asks the server, answered from here. `calls` counts what each link cost.
async function mockServer(page, { link = () => ({ kind: "shop", url: BOSS, query: "" }), ai = "ok", photos = [] } = {}) {
  const art = await drawPhotos(page);
  const calls = { link: [], page: [], images: [], photos: [], products: [], gemini: [], geminiChars: 0 };
  const reply = (r, body, status = 200) => r.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.route(/\/api\//, async (r) => {
    const u = new URL(r.request().url());
    const path = u.pathname.replace(/^.*\/api\//, "");
    if (path === "link") { calls.link.push(u.searchParams.get("url")); return reply(r, link(u.searchParams.get("url"))); }
    if (path === "page") { calls.page.push({ url: u.searchParams.get("url"), code: u.searchParams.get("code") }); return reply(r, u.searchParams.get("url") === BOSS ? PAGE : { error: "answered 404" }, u.searchParams.get("url") === BOSS ? 200 : 502); }
    if (path === "image") {
      const kind = PHOTOS[u.searchParams.get("url")];
      calls.images.push(kind);
      return kind ? r.fulfill({ status: 200, contentType: "image/png", body: art[kind] }) : reply(r, { error: "no" }, 502);
    }
    if (path === "photos") { calls.photos.push(u.searchParams.get("q")); return reply(r, { items: photos }); }
    if (path === "products") { calls.products.push(u.searchParams.get("q")); return reply(r, { items: [] }); }
    if (path.startsWith("ai/gemini/")) {
      const body = r.request().postDataJSON();
      calls.gemini.push(body);
      calls.geminiChars += JSON.stringify(body.system_instruction) .length + body.contents[0].parts.map((p) => p.text || "").join("").length;
      if (ai === "fail") return reply(r, { error: { message: "quota" } }, 429);
      const schema = JSON.stringify(body.generationConfig?.responseSchema || "");
      // The contact sheet: the numbers of the photos that show the shirt alone. The app puts the
      // photos on it in the order it got them, which this test knows (see `sheetOrder`).
      const text = schema.includes("piece_only") ? JSON.stringify({ piece_only: [sheetOrder.indexOf("flat-front") + 1, sheetOrder.indexOf("flat-back") + 1] }) : DETAILS;
      return reply(r, { candidates: [{ content: { parts: [{ text }] } }], usageMetadata: { promptTokenCount: 0, candidatesTokenCount: 0 } });
    }
    if (path === "ping") return reply(r, { ok: true, sync: false, rev: 0, keys: { gemini: true, products: true } });
    return reply(r, { error: "Not found" }, 404);
  });
  return calls;
}
// The shop's photos the app keeps, in the order the page lists them once the code filter has
// run (the other colour drops out): what the contact sheet holds.
const sheetOrder = Object.entries(PHOTOS).filter(([u]) => u.includes("hbeu50525359_100_")).map(([, k]) => k);

const errors = [];
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 }, hasTouch: true, deviceScaleFactor: SHOTS ? 2 : 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  return page;
}
async function boot(page, opts) {
  const calls = await mockServer(page, opts);
  await page.goto(url);
  await page.waitForFunction(() => window.__t?.state?.items?.length >= 10, null, { timeout: 60000 });
  await page.evaluate(() => { const t = window.__t; t.state.serverKeys = { gemini: true, products: true }; t.state.settings.aiProvider = "gemini"; });
  return calls;
}
// Which drawing a kept photo is, read from its pixels: skin = worn, light blue = other colour.
async function keptPhotos(page) {
  return page.evaluate(async () => {
    const out = [];
    for (const p of window.__t.draft.photos) {
      const bmp = await createImageBitmap(p.orig);
      const c = new OffscreenCanvas(40, 60), g = c.getContext("2d", { willReadFrequently: true });
      g.drawImage(bmp, 0, 0, 40, 60);
      const at = (x, y) => [...g.getImageData(x, y, 1, 1).data.slice(0, 3)];
      const head = at(20, 4), body = at(20, 30), seam = at(20, 40);
      out.push(!p.shop ? "own" : head[0] - head[2] > 40 ? "worn" : body[2] - body[0] > 40 ? "blue" : seam[0] < 230 ? "flat-front" : "flat-back");
    }
    return out;
  });
}
// Done once the link has filled the piece in (its page is set) and every photo is ready.
const settle = (page) => page.waitForFunction(() => { const d = window.__t.draft; return d?.link && !/share\.google/.test(d.link) && !d.scanningTag && !d.photos.some((p) => p.busy); }, null, { timeout: 60000 });

test("Paste a link: a BOSS shirt from the Google app's Share text", async () => {
  const page = await open();
  const calls = await boot(page);
  await page.evaluate(() => window.__t.go("add"));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "1-add-start.png") });
  await page.click('[data-act="link-start"]');
  await page.waitForSelector("#f-link");
  await page.fill("#f-link", SHARE);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "2-paste-link.png") });
  await page.click('[data-act="link-go"]');
  await settle(page);
  const d = await page.evaluate(() => { const d = window.__t.draft; return { name: d.name, brand: d.brand, category: d.category, colors: d.colors, fit: d.fit, price: d.price, currency: d.currency, material: d.material, link: d.link, notes: d.notes, note: d.labelNote, auto: window.__t.autoName(d) }; });
  assert.match(d.brand, /^boss$/i, "BOSS, written as the brand list writes it");
  assert.equal(d.category, "shirt");
  assert.deepEqual(d.colors, ["white"]);
  assert.equal(d.fit, "slim");
  assert.equal(d.price, "199.95");
  assert.equal(d.currency, "EUR");
  assert.match(d.material, /98% cotton/);
  assert.equal(d.link, BOSS, "the shop's page, not the share link");
  assert.equal(d.name, "", "the app's own simple name is kept");
  assert.match(d.auto, /white/i);
  assert.match(d.notes, /Shop name: Camicia slim fit in cotone elasticizzato/);
  assert.deepEqual(await keptPhotos(page), ["flat-front", "flat-back"], d.note);
  assert.deepEqual(calls.link, ["https://share.google/H3toR0wOO1aU6OEhX"]);
  assert.equal(calls.page[0].code, "hbeu50525359_100", "the page is asked for every photo of this code");
  assert.ok(!calls.images.includes("blue"), "the other colour's photo isn't even loaded");
  const serp = calls.photos.length + calls.products.length;
  console.log(`  SerpApi searches: ${serp}, Gemini calls: ${calls.gemini.length} (~${Math.round(calls.geminiChars / 4)} prompt text tokens + 1 contact sheet image)`);
  assert.ok(serp <= 2);
  if (process.env.DEBUG) console.log(calls.gemini.map((b) => b.system_instruction.parts[0].text.slice(0, 90)));
  if (SHOTS) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(SHOTS, "3-filled.png") });
  }
  await page.context().close();
});

test("with the AI failing, no shop photo is kept", async () => {
  const page = await open();
  await boot(page, { ai: "fail" });
  await page.evaluate(() => { const t = window.__t; t.draft = { ...t.newDraft(), fromLabel: true, linkOpen: true }; t.go("add"); });
  await page.fill("#f-link", SHARE);
  await page.press("#f-link", "Enter");
  await settle(page);
  const d = await page.evaluate(() => ({ photos: window.__t.draft.photos.length, note: window.__t.draft.labelNote, brand: window.__t.draft.brand, category: window.__t.draft.category }));
  assert.equal(d.photos, 0);
  assert.match(d.note, /none was kept/);
  assert.match(d.brand, /^boss$/i, "the shop's page still fills it in");
  assert.equal(d.category, "shirt");
  await page.context().close();
});

test("a share link that leads to a Google search finds the shop by the product's name", async () => {
  const page = await open();
  const calls = await boot(page, {
    link: () => ({ kind: "google", url: "https://www.google.com/search?q=BOSS", query: "BOSS - Camicia slim fit in cotone elasticizzato - Bianco" }),
    photos: [
      { title: "Camicia bianca | Zalando", image: "https://img.zalando.example/x.jpg", thumb: "", url: "https://www.zalando.it/boss-camicia.html", shop: "Zalando" },
      { title: "Camicia slim fit in cotone elasticizzato | BOSS", image: IMG(100), thumb: "", url: BOSS, shop: "hugoboss.com" },
    ],
  });
  await page.evaluate(() => { const t = window.__t; t.draft = { ...t.newDraft(), fromLabel: true, linkOpen: true }; t.go("add"); });
  await page.fill("#f-link", "https://share.google/abc");
  await page.click('[data-act="link-go"]');
  await settle(page);
  assert.deepEqual(calls.photos, ["BOSS - Camicia slim fit in cotone elasticizzato - Bianco"], "one Google Images search");
  assert.equal(calls.products.length, 0);
  assert.equal(calls.page[0].url, BOSS, "the brand's own page wins");
  assert.equal(await page.evaluate(() => window.__t.draft.link), BOSS);
  assert.deepEqual(await keptPhotos(page), ["flat-front", "flat-back"]);
  await page.context().close();
});

test("editing a piece you have: your name, size and wears stay, the shop's photo goes first", async () => {
  const page = await open();
  await boot(page);
  const before = await page.evaluate(async () => {
    const t = window.__t;
    const c = new OffscreenCanvas(96, 128), g = c.getContext("2d");
    g.fillStyle = "#3355aa"; g.fillRect(0, 0, 96, 128);
    const it = { id: "mine", name: "My white shirt", category: "shirt", colors: ["white"], styles: ["smart casual"], formality: 3, warmth: 2, tags: ["work"], fit: "regular",
      size: "M", photos: [await c.convertToBlob({ type: "image/png" })], createdAt: new Date().toISOString(), wearCount: 3, lastWorn: "2026-11-01", favorite: true };
    t.state.items.push(it);
    await t.store.put("items", it);
    document.body.insertAdjacentHTML("beforeend", '<button id="edit-mine" data-edit="mine">Edit</button>');
    return JSON.stringify({ ...it, photos: it.photos.length });
  });
  await page.click("#edit-mine");
  await page.waitForSelector('[data-act="link-open"]');
  await page.click('[data-act="link-open"]');
  await page.fill("#f-link", SHARE);
  await page.click('[data-act="link-go"]');
  await settle(page);
  const d = await page.evaluate(() => { const d = window.__t.draft; return { name: d.name, size: d.size, tags: d.tags, brand: d.brand, link: d.link, colors: d.colors }; });
  assert.equal(d.name, "My white shirt");
  assert.equal(d.size, "M");
  assert.equal(d.tags, "work");
  assert.deepEqual(d.colors, ["white"]);
  assert.match(d.brand, /^boss$/i, "BOSS, written as the brand list writes it");
  assert.equal(d.link, BOSS);
  assert.deepEqual(await keptPhotos(page), ["flat-front", "flat-back", "own"]);
  if (SHOTS) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: join(SHOTS, "4-edit.png") }); }
  // Cancel: the saved piece is as it was.
  await page.click('[data-act="cancel-add"]');
  const after = await page.evaluate(async () => { const it = (await window.__t.store.all("items")).find((i) => i.id === "mine"); return JSON.stringify({ ...it, photos: it.photos.length }); });
  assert.equal(after, before);
  // Again, and Save: wears, size and name stay; the shop's photo is the piece's first photo.
  await page.click("#edit-mine");
  await page.waitForSelector('[data-act="link-open"]');
  await page.click('[data-act="link-open"]');
  await page.fill("#f-link", SHARE);
  await page.click('[data-act="link-go"]');
  await settle(page);
  await page.click('[data-act="save"]');
  await page.waitForFunction(() => !window.__t.draft);
  const saved = await page.evaluate(() => { const it = window.__t.state.items.find((i) => i.id === "mine"); return { name: it.name, size: it.size, wearCount: it.wearCount, lastWorn: it.lastWorn, favorite: it.favorite, photos: it.photos.length, link: it.link, brand: it.brand }; });
  assert.deepEqual(saved, { name: "My white shirt", size: "M", wearCount: 3, lastWorn: "2026-11-01", favorite: true, photos: 3, link: BOSS, brand: "Boss" });
  await page.context().close();
});

test("Google Lens matches still fill the piece in and pick its photos", async () => {
  const page = await open();
  await boot(page);
  await page.evaluate((img) => {
    const t = window.__t;
    t.draft = { ...t.newDraft(), fromLabel: true, lens: { items: [{ title: "Camicia slim fit | BOSS", shop: "hugoboss.com", price: "199,95 €", url: "https://www.hugoboss.com/it/camicia/hbeu50525359_100.html", image: img, thumb: "/icon.svg" }] } }; // a thumbnail that loads (cards whose picture fails are taken away)
    t.go("add");
  }, IMG(100));
  await page.click('[data-lens="0"]');
  await settle(page);
  const d = await page.evaluate(() => ({ brand: window.__t.draft.brand, category: window.__t.draft.category, link: window.__t.draft.link, photos: window.__t.draft.photos.length }));
  assert.match(d.brand, /^boss$/i, "BOSS, written as the brand list writes it");
  assert.equal(d.category, "shirt");
  assert.match(d.link, /hbeu50525359_100\.html$/);
  assert.ok(d.photos >= 1, "the Lens photo is kept when the page can't be opened");
  await page.context().close();
});

test("no page errors", async () => {
  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
});
