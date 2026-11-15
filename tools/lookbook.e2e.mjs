// Run with:  node --test tools/lookbook.e2e.mjs        (SHOTS=<folder> also saves screenshots there)
// The lookbook stage on Today in headless Chromium, at the iPad Air 13" sizes (landscape 1366 x 1024
// and portrait 1024 x 1366), on the sample wardrobe plus a few drawn accessories (the samples have
// no shoes or accessories). Checks:
// - nothing asks for the old 3D files (avatar/…, vendor/three/…), and no canvas or WebGL is on the stage
// - Today's idea shows in its column order: hat, top/layer/jacket, belt at the waist, bottoms, shoes,
//   with the jewelry and watch docked on the left and the eyewear and bag on the right
// - tapping a piece opens the picker with only that slot's pieces; picking one puts it on
// - Arrange: dragging a piece moves it, and the move is kept on the piece after a reload
// Needs Playwright with Chromium.
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
const dir = mkdtempSync(join(tmpdir(), "wardrobe-lookbook-"));
for (const f of readdirSync(ROOT)) if (/\.(js|css|html|json|webmanifest|svg|png)$/.test(f) && !/^(package|wrangler)/.test(f)) cpSync(join(ROOT, f), join(dir, f));
for (const d of ["sample", "vendor"]) if (existsSync(join(ROOT, d))) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
const src = readFileSync(join(ROOT, "app.js"), "utf8");
const DECL = /^(?:async\s+)?function\s+([\w$]+)|^(?:const|let)\s+([\w$]+)\s*=|^import \* as ([\w$]+)/gm;
const names = [...new Set(Array.from(src.matchAll(DECL), (m) => m[1] || m[2] || m[3]))];
writeFileSync(join(dir, "app.js"), `${src}\nwindow.__t = {${names.map((n) => `get ${n}() { return ${n}; }`).join(",")}};\n`);

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp" };
const server = createServer((req, res) => {
  const p = join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/$/, "/index.html"));
  if (!p.startsWith(dir) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const errors = [], requests = [];
async function open(viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: SHOTS ? 2 : 1, hasTouch: true, colorScheme: "dark" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("request", (r) => requests.push(r.url()));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort()); // no weather, AI or CDN: all on the device
  await page.goto(url);
  await page.waitForFunction(() => window.__t?.state?.items?.length >= 20 && window.__t.mirror.stage, null, { timeout: 60000 });
  return { ctx, page };
}

// Accessories and shoes drawn on transparent photos (the shapes only need to read as what they are).
const addAccessories = (page) => page.evaluate(async () => {
  const t = window.__t;
  const draw = (w, h, fn) => {
    const c = Object.assign(document.createElement("canvas"), { width: w, height: h }), g = c.getContext("2d");
    fn(g, w, h);
    return new Promise((r) => c.toBlob(r, "image/png"));
  };
  const round = (g, x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };
  const P = {
    sneakers: await draw(1024, 512, (g) => {
      g.fillStyle = "#f2f0ea"; g.beginPath(); g.moveTo(120, 300); g.quadraticCurveTo(160, 150, 420, 150); g.lineTo(560, 170); g.quadraticCurveTo(820, 230, 900, 330); g.lineTo(900, 380); g.lineTo(110, 380); g.closePath(); g.fill();
      g.fillStyle = "#d9d5cb"; round(g, 100, 370, 820, 50, 18);
      g.strokeStyle = "#3a3a3a"; g.lineWidth = 14; g.beginPath(); g.moveTo(330, 330); g.quadraticCurveTo(470, 210, 690, 320); g.stroke();
    }),
    cap: await draw(800, 520, (g) => {
      g.fillStyle = "#1f2a44"; g.beginPath(); g.ellipse(380, 330, 250, 210, 0, Math.PI, 0); g.fill();
      g.beginPath(); g.ellipse(560, 340, 220, 46, -0.08, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#30406a"; g.beginPath(); g.arc(380, 125, 16, 0, Math.PI * 2); g.fill();
    }),
    belt: await draw(1200, 220, (g) => {
      g.fillStyle = "#5e4130"; round(g, 40, 80, 1100, 64, 14);
      g.strokeStyle = "#c9c9c9"; g.lineWidth = 16; g.strokeRect(70, 60, 120, 104);
    }),
    watch: await draw(420, 900, (g) => {
      g.fillStyle = "#3b2a20"; round(g, 150, 40, 120, 820, 40);
      g.fillStyle = "#c9c9c9"; g.beginPath(); g.arc(210, 450, 150, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#1c1c1c"; g.beginPath(); g.arc(210, 450, 120, 0, Math.PI * 2); g.fill();
    }),
    necklace: await draw(700, 700, (g) => {
      g.strokeStyle = "#cfcfcf"; g.lineWidth = 12; g.beginPath(); g.ellipse(350, 270, 230, 220, 0, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
      g.fillStyle = "#e3e3e3"; g.beginPath(); g.arc(350, 520, 40, 0, Math.PI * 2); g.fill();
    }),
    sunglasses: await draw(1000, 360, (g) => {
      g.fillStyle = "#151515"; round(g, 90, 110, 330, 190, 80); round(g, 580, 110, 330, 190, 80);
      g.fillRect(400, 140, 200, 26); g.fillRect(40, 120, 70, 20); g.fillRect(890, 120, 70, 20);
    }),
    bag: await draw(800, 900, (g) => {
      g.strokeStyle = "#2b211b"; g.lineWidth = 34; g.beginPath(); g.arc(400, 330, 170, Math.PI, 0); g.stroke();
      g.fillStyle = "#cbb58e"; round(g, 130, 320, 540, 520, 30);
    }),
  };
  const mk = (id, name, category, colors, photo) => ({ id, name, category, colors, styles: [], warmth: 1, tags: [], notes: "", wearCount: 0, lastWorn: null, favorite: false, createdAt: new Date().toISOString(), photos: [photo] });
  const add = [
    mk("t-sneakers", "White leather sneakers", "sneakers", ["white"], P.sneakers),
    mk("t-cap", "Navy cap", "cap", ["navy"], P.cap),
    mk("t-belt", "Brown leather belt", "belt", ["brown"], P.belt),
    mk("t-watch", "Silver watch", "watch", ["grey"], P.watch),
    mk("t-watch2", "Steel diver watch", "watch", ["black"], P.watch),
    mk("t-necklace", "Silver chain", "necklace", ["grey"], P.necklace),
    mk("t-sunglasses", "Black sunglasses", "sunglasses", ["black"], P.sunglasses),
    mk("t-bag", "Canvas tote", "bag", ["beige"], P.bag),
  ];
  for (const it of add) if (!t.state.items.some((i) => i.id === it.id)) { await t.store.put("items", it); t.state.items.push(it); }
  return add.length;
});
// Today's first idea wearing the drawn shoes and accessories, on the stage.
const dressUp = (page) => page.evaluate(async () => {
  const t = window.__t, by = (id) => t.state.items.find((i) => i.id === id);
  t.go("today");
  const o = t.state.outfits[0];
  o.pieces.shoes = by("t-sneakers");
  o.extras = ["t-cap", "t-belt", "t-watch", "t-necklace", "t-sunglasses", "t-bag"].map(by);
  t.mirror.pick = 0;
  t.render();
  const want = t.wornList(o).length;
  for (let k = 0; k < 100 && t.mirror.stage.debug.layers().length < want; k++) await new Promise((r) => setTimeout(r, 50));
  await new Promise((r) => setTimeout(r, 300));
  document.getElementById("toast").hidden = true; // (the samples' "Added 30 pieces")
  return { want, ids: t.wornList(o).map((w) => w.item.id) };
});
const layers = (page) => page.evaluate(() => window.__t.mirror.stage.debug.layers());

test.after(async () => { await browser.close(); server.close(); rmSync(dir, { recursive: true, force: true }); });

let land;
test("landscape iPad: Today's idea on the stage in column order, with the accessories docked at the sides", async () => {
  land = await open({ width: 1366, height: 1024 });
  const { page } = land;
  assert.equal(await addAccessories(page), 8);
  const { want, ids } = await dressUp(page);
  const L = await layers(page);
  assert.equal(L.length, want, "every piece of the idea is on the stage");
  assert.deepEqual(L.map((l) => l.id).sort(), [...ids].sort());
  const g = Object.fromEntries(L.map((l) => [l.slot, l.garment]));
  const torso = ["top", "layer", "jacket"].filter((k) => g[k]);
  assert.ok(torso.length >= 1, "a top, layer or jacket");
  const torsoTop = Math.min(...torso.map((k) => g[k].y)), torsoBottom = Math.max(...torso.map((k) => g[k].y + g[k].h));
  assert.ok(g.hat.y + g.hat.h <= torsoTop + 4, "the hat above the clothes");
  assert.ok(g.belt.y > torsoTop && g.belt.y < g.bottoms.y + g.bottoms.h * 0.15, "the belt at the waist");
  assert.ok(g.bottoms.y > torsoTop + (torsoBottom - torsoTop) * 0.6, "the bottoms under the top");
  assert.ok(g.shoes.y > g.bottoms.y + g.bottoms.h * 0.75, "the shoes at the base");
  const jacketX = Math.min(...torso.map((k) => g[k].x)), jacketR = Math.max(...torso.map((k) => g[k].x + g[k].w));
  for (const k of ["jewelry", "watch"]) assert.ok(g[k].x + g[k].w < jacketX, `${k} on the left`);
  for (const k of ["eyewear", "bag"]) assert.ok(g[k].x > jacketR, `${k} on the right`);
  assert.equal(await page.evaluate(() => document.querySelectorAll("#lookbook canvas").length), 0, "no canvas on the stage");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "today-landscape-1366x1024.png") });
});

test("tapping a piece opens the picker with only that slot's pieces; picking one puts it on", async () => {
  const { page } = land;
  const tapSlot = async (slot) => {
    // on the garment itself, near its top (the middle of a pair of jeans is the gap between the legs)
    const r = await page.evaluate((s) => { const g = window.__t.mirror.stage.debug.layers().find((l) => l.slot === s).garment; return { x: g.x + g.w / 2, y: g.y + g.h * (s === "bottoms" ? 0.12 : 0.5) }; }, slot);
    await page.mouse.click(r.x, r.y);
    await page.waitForSelector("#sheet:not([hidden]) .slot-pick", { state: "attached" });
  };
  await tapSlot("bottoms");
  const bottoms = await page.evaluate(() => {
    const t = window.__t;
    return { title: document.querySelector(".sheet-panel h1").textContent, roles: [...document.querySelectorAll(".slot-pick [data-slotpick]")].map((b) => t.roleOf(t.state.items.find((i) => i.id === b.dataset.slotpick.split(":")[1]))) };
  });
  assert.match(bottoms.title, /bottoms/i);
  assert.ok(bottoms.roles.length >= 2 && bottoms.roles.every((r) => r === "bottom"), JSON.stringify(bottoms.roles));
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "picker-bottoms-1366x1024.png") });
  // pick the second one: the idea and the stage wear it
  const picked = await page.evaluate(() => document.querySelectorAll(".slot-pick [data-slotpick]")[1].dataset.slotpick.split(":")[1]);
  await page.click(".slot-pick [data-slotpick] >> nth=1");
  await page.waitForFunction((id) => window.__t.mirror.stage.debug.state.worn.bottoms?.id === id, picked, { timeout: 5000 });
  assert.equal(await page.evaluate(() => window.__t.state.outfits[0].pieces.bottom.id), picked);
  // an accessory card: only watches
  await tapSlot("watch");
  const cats = await page.evaluate(() => [...document.querySelectorAll(".slot-pick [data-slotpick]")].map((b) => b.dataset.slotpick));
  assert.deepEqual(cats, ["watch:t-watch2"], "only the other watch");
  await page.evaluate(() => window.__t.closeSheet());
});

test("Arrange: a dragged piece moves, and the move is kept on the piece after a reload", async () => {
  const { page } = land;
  await page.click("[data-medit]");
  await page.waitForFunction(() => window.__t.mirror.stage.editing);
  const { id, x, y } = await page.evaluate(() => {
    const w = window.__t.mirror.stage.debug.state.worn.bottoms, b = document.querySelector('#lookbook [data-slot="bottoms"] img').getBoundingClientRect();
    return { id: w.id, x: b.x + b.width / 2, y: b.y + b.height * 0.3 };
  });
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "arrange-1366x1024.png") });
  await page.mouse.move(x, y);
  await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(x + k * 6, y - k * 3);
  await page.mouse.up();
  await page.waitForTimeout(400);
  const saved = await page.evaluate((id) => window.__t.state.items.find((i) => i.id === id).cutoutMeta, id);
  assert.ok(saved?.offsetX > 2 && saved?.offsetY > 1, `moved right and up: ${JSON.stringify(saved)}`);
  await page.reload();
  await page.waitForFunction(() => window.__t?.state?.items?.length >= 20 && window.__t.mirror.stage, null, { timeout: 60000 });
  const after = await page.evaluate((id) => window.__t.state.items.find((i) => i.id === id).cutoutMeta, id);
  assert.equal(after.offsetX, saved.offsetX);
  assert.equal(after.offsetY, saved.offsetY);
  await page.evaluate(() => { window.__t.mirror.editing = false; });
});

test("portrait iPad: the stage fits, nothing asks for the old 3D files, no errors", async () => {
  const { page, ctx } = await open({ width: 1024, height: 1366 });
  await addAccessories(page);
  await dressUp(page);
  const r = await page.evaluate(() => {
    const host = document.querySelector("#lookbook").getBoundingClientRect();
    return { host: [host.width, host.height], out: window.__t.mirror.stage.debug.layers().filter((l) => l.garment.x < host.x - 1 || l.garment.x + l.garment.w > host.right + 1).map((l) => l.slot) };
  });
  assert.ok(r.host[0] > 500, `stage ${r.host}`);
  assert.deepEqual(r.out, [], "every piece inside the stage");
  if (SHOTS) {
    await page.screenshot({ path: join(SHOTS, "today-portrait-1024x1366.png") });
    await page.evaluate(() => window.__t.setMirrorSide("back"));
    await page.waitForTimeout(600);
    await page.locator("#mirror").screenshot({ path: join(SHOTS, "back-portrait-1024x1366.png") });
  }
  await ctx.close();
  assert.deepEqual(requests.filter((u) => /\/avatar\/|\/vendor\/three\/|garment-baker|mannequin-shells|face-photo/.test(u)), [], "no request for the old 3D files");
  assert.deepEqual(errors, []);
});
