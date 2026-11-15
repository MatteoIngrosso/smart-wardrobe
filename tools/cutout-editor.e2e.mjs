// The cut-out pipeline and the hand editor in a real browser (headless Chromium):
//   node tools/cutout-editor.e2e.mjs
// Needs Playwright (require("playwright") with its Chromium). Serves the repo on a free port.
// Checks: photos come in at 1024 px; every cut-out is a 768x1024 WebP, trimmed and centred, whose
// matrix puts it back exactly on the photo; the editor keeps 8 undo steps, gives the mask back at
// the photo's size and frees its canvases; and the 3D mirror's baker sees the same garment in a
// re-framed cut-out as in the old one.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = createRequire(import.meta.url)("playwright");
const TYPES = { ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".html": "text/html", ".json": "application/json", ".webp": "image/webp", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml", ".bin": "application/octet-stream" };
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/__test.html") { res.writeHead(200, { "content-type": "text/html" }); return res.end("<!doctype html><meta charset=utf-8><link rel=stylesheet href=/styles.css><body>"); } // the app's own styles: the editor is laid out as in the app
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  try { const b = await readFile(file); res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" }); res.end(b); }
  catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1366, height: 1024 } });
page.on("pageerror", (e) => console.log("page error:", e.message));
await page.goto(`${base}/__test.html`);

const results = [];
const check = (name, ok, info = "") => { results.push(ok); console.log(`${ok ? "PASS" : "FAIL"} ${name}${info ? `: ${info}` : ""}`); };

// 1. Photos in: a 48 MP photo becomes a 1024 px working copy.
{
  const r = await page.evaluate(async () => {
    const { workingCopy } = await import("/cutout-editor.js");
    const c = Object.assign(document.createElement("canvas"), { width: 6000, height: 8000 });
    const g = c.getContext("2d");
    for (let y = 0; y < 8000; y += 4) { g.fillStyle = (y / 4) % 2 ? "#123" : "#ddd"; g.fillRect(0, y, 6000, 2); } // fine stripes
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.9));
    c.width = c.height = 0;
    const t = performance.now();
    const out = await workingCopy(blob);
    const ms = performance.now() - t;
    // halving steps average the 2 px stripes to an even grey instead of aliasing them
    const d = out.getContext("2d").getImageData(0, 0, out.width, out.height).data;
    let lo = 255, hi = 0;
    for (let i = (out.height >> 1) * out.width * 4; i < ((out.height >> 1) + 40) * out.width * 4; i += 4) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
    const many = await Promise.all(Array.from({ length: 6 }, () => workingCopy(blob, 1024))); // one at a time inside
    return { w: out.width, h: out.height, ms, spread: hi - lo, many: many.every((m) => m.width === 768 && m.height === 1024) };
  });
  check("48 MP photo comes in at 1024 px", r.w === 768 && r.h === 1024, `${r.w}x${r.h} in ${r.ms.toFixed(0)} ms`);
  check("fine stripes don't alias when shrunk", r.spread < 60, `spread ${r.spread}`);
  check("six photos at once all come in", r.many);
}

// 2. Every cut-out: 768x1024 WebP, trimmed, centred, and its matrix maps it back onto the photo.
{
  const r = await page.evaluate(async () => {
    const { frameCutout, alphaBox, FRAME_W, FRAME_H, FRAME_MARGIN } = await import("/cutout-editor.js");
    const out = [];
    for (const name of ["123659645", "125852471", "2132232964", "2131955316"]) {
      const src = await createImageBitmap(await (await fetch(`/sample/cut/${name}.webp`)).blob());
      // put the old cut-out somewhere on a bigger, tilted "photo" so trimming and the matrix matter
      const ph = Object.assign(document.createElement("canvas"), { width: 1024, height: 1365 });
      const pg = ph.getContext("2d");
      pg.translate(560, 640); pg.rotate(0.21); pg.drawImage(src, -src.width * 0.45, -src.height * 0.5, src.width * 0.9, src.height);
      const t = performance.now();
      const { blob, m } = await frameCutout(ph);
      const ms = performance.now() - t;
      const fr = await createImageBitmap(blob);
      const fc = Object.assign(document.createElement("canvas"), { width: fr.width, height: fr.height });
      fc.getContext("2d").drawImage(fr, 0, 0);
      const fd = fc.getContext("2d").getImageData(0, 0, fr.width, fr.height).data;
      const box = alphaBox(fd, fr.width, fr.height);
      // back onto the photo with the inverse matrix, as the hand editor does with a saved piece
      const bk = Object.assign(document.createElement("canvas"), { width: 1024, height: 1365 });
      const bg = bk.getContext("2d");
      bg.setTransform(m.inverse()); bg.drawImage(fr, 0, 0);
      const a = pg.getImageData(0, 0, 1024, 1365).data, b = bg.getImageData(0, 0, 1024, 1365).data;
      let both = 0, either = 0;
      for (let i = 3; i < a.length; i += 4) { const x = a[i] > 128, y = b[i] > 128; both += x && y; either += x || y; }
      const mx = FRAME_W * FRAME_MARGIN, my = FRAME_H * FRAME_MARGIN;
      out.push({
        name, ms, type: blob.type, kb: blob.size / 1024, w: fr.width, h: fr.height, iou: both / either,
        inside: box.x0 >= mx - 2 && box.y0 >= my - 2 && box.x1 <= FRAME_W - mx + 1 && box.y1 <= FRAME_H - my + 1,
        touches: Math.abs(box.y0 - my) <= 2 || Math.abs(box.x0 - mx) <= 2,
        centred: Math.abs(box.x0 + box.x1 + 1 - FRAME_W) <= 3 && Math.abs(box.y0 + box.y1 + 1 - FRAME_H) <= 3,
      });
    }
    return out;
  });
  for (const x of r) {
    check(`cut-out ${x.name}: 768x1024 WebP`, x.w === 768 && x.h === 1024 && x.type === "image/webp", `${x.w}x${x.h} ${x.type} ${x.kb.toFixed(0)} KB, ${x.ms.toFixed(0)} ms`);
    check(`cut-out ${x.name}: trimmed and centred in the margins`, x.inside && x.touches && x.centred);
    check(`cut-out ${x.name}: matrix puts it back on the photo`, x.iou > 0.98, `IoU ${x.iou.toFixed(4)}`);
  }
}

// 3. The hand editor: a 2000x1500 photo (edited at 1024), 12 strokes, 8 undo steps, mask back at 2000x1500.
{
  await page.evaluate(async () => {
    const { editCutout } = await import("/cutout-editor.js");
    const photo = Object.assign(document.createElement("canvas"), { width: 2000, height: 1500 });
    const g = photo.getContext("2d");
    g.fillStyle = "#3a6"; g.fillRect(0, 0, 2000, 1500);
    const mask = Object.assign(document.createElement("canvas"), { width: 2000, height: 1500 });
    mask.getContext("2d").fillRect(0, 0, 2000, 1500); // all kept
    // watch the canvases the editor makes
    const made = (window.__made = []), mk = document.createElement.bind(document);
    document.createElement = (t, o) => { const e = mk(t, o); if (String(t).toLowerCase() === "canvas") made.push(e); return e; };
    window.__done = editCutout(photo, mask).then((m) => { document.createElement = mk; return m; });
  });
  const cv = await page.locator(".cutfix-stage canvas").boundingBox();
  const fitS = await page.evaluate(() => { const s = document.querySelector(".cutfix-stage"); return Math.min(s.clientWidth / 1024, s.clientHeight / 768) * 0.94; });
  const at = (ix, iy) => ({ x: cv.x + cv.width / 2 + (ix - 512) * fitS, y: cv.y + cv.height / 2 + (iy - 384) * fitS });
  // 12 short strokes along a row, each in its own column, 70 px apart in editor pixels
  const col = (k) => 80 + k * 72;
  for (let k = 0; k < 12; k++) {
    const p = at(col(k), 300), q = at(col(k), 460);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    for (let s = 1; s <= 6; s++) await page.mouse.move(p.x, p.y + ((q.y - p.y) * s) / 6);
    await page.mouse.up();
  }
  let undos = 0;
  while (undos < 20 && !(await page.locator('[data-fx="undo"]').isDisabled())) { await page.click('[data-fx="undo"]'); undos++; }
  check("undo keeps 8 steps", undos === 8, `${undos} undos`);
  await page.click('[data-fx="redo"]'); // stroke 5 back
  const t = Date.now();
  await page.click('[data-fx="done"]');
  const r = await page.evaluate(async () => {
    const m = await window.__done;
    const d = m.getContext("2d").getImageData(0, 0, m.width, m.height).data;
    const sx = m.width / 1024;
    const kept = (ix, iy) => d[(Math.round(iy * sx) * m.width + Math.round(ix * sx)) * 4 + 3] > 128;
    const strokes = Array.from({ length: 12 }, (_, k) => !kept(80 + k * 72, 380));
    const left = window.__made.filter((c) => c !== m && (c.width || c.height)).length;
    return { w: m.width, h: m.height, strokes, left, open: !!document.querySelector(".cutfix") };
  });
  const want = [true, true, true, true, true, false, false, false, false, false, false, false];
  check("mask comes back at the photo's size", r.w === 2000 && r.h === 1500, `${r.w}x${r.h}, ${Date.now() - t} ms`);
  check("strokes past the 8 undo steps stay, undone ones are gone, redo works", JSON.stringify(r.strokes) === JSON.stringify(want), r.strokes.map((s) => (s ? "x" : ".")).join(""));
  check("closing frees every canvas the editor made", r.left === 0 && !r.open, `${r.left} left`);
}

// 4. Undo stays quick however long you edit: 60 strokes, then undo.
{
  await page.evaluate(async () => {
    const { editCutout } = await import("/cutout-editor.js");
    const photo = Object.assign(document.createElement("canvas"), { width: 1024, height: 1365 });
    photo.getContext("2d").fillRect(0, 0, 1024, 1365);
    const mask = Object.assign(document.createElement("canvas"), { width: 1024, height: 1365 });
    mask.getContext("2d").fillRect(0, 0, 1024, 1365);
    window.__done = editCutout(photo, mask);
  });
  const cv = await page.locator(".cutfix-stage canvas").boundingBox();
  for (let k = 0; k < 60; k++) {
    const x = cv.x + cv.width * (0.3 + (k % 10) * 0.04), y = cv.y + cv.height * (0.2 + Math.floor(k / 10) * 0.1);
    await page.mouse.move(x, y); await page.mouse.down();
    for (let s = 1; s <= 12; s++) await page.mouse.move(x + s * 6, y + s * 3);
    await page.mouse.up();
  }
  const ms = await page.evaluate(async () => {
    const b = document.querySelector('[data-fx="undo"]');
    const t = performance.now();
    for (let i = 0; i < 8; i++) b.click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return (performance.now() - t) / 8;
  });
  check("undo after 60 strokes", ms < 40, `${ms.toFixed(1)} ms per undo`);
  await page.click('[data-fx="cancel"]'); await page.click('[data-fx="cancel"]');
}

// 5. The 3D mirror's baker: an old cut-out and the same one re-framed bake to the same panels.
{
  const r = await page.evaluate(async () => {
    const { frameCutout } = await import("/cutout-editor.js");
    const { bakeGarment, cutoutPanels } = await import("/garment-baker.js");
    const items = [
      { id: "a", name: "All City hoodie", category: "hoodie", photo: "123659645" },
      { id: "b", name: "Tommy Jeans bomber", category: "jacket", photo: "125852471" },
      { id: "c", name: "Dark blue straight jeans", category: "jeans", photo: "2132232964" },
      { id: "d", name: "Reebok sweat shorts", category: "shorts", photo: "2131955316" },
    ];
    const pixels = async (blob) => {
      const b = await createImageBitmap(blob), c = Object.assign(document.createElement("canvas"), { width: b.width, height: b.height });
      c.getContext("2d").drawImage(b, 0, 0);
      return { w: b.width, h: b.height, d: c.getContext("2d").getImageData(0, 0, b.width, b.height).data };
    };
    const out = [];
    for (const it of items) {
      const old = await (await fetch(`/sample/cut/${it.photo}.webp`)).blob();
      const now = (await frameCutout(old)).blob;
      const [A, B] = [await bakeGarment(it, { front: old }), await bakeGarment(it, { front: now })];
      const [pa, pb] = [await pixels(A.frontChestUV), await pixels(B.frontChestUV)];
      let diff = 0;
      for (let i = 0; i < pa.d.length; i += 4) diff += Math.abs(pa.d[i] - pb.d[i]) + Math.abs(pa.d[i + 1] - pb.d[i + 1]) + Math.abs(pa.d[i + 2] - pb.d[i + 2]);
      const hex = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
      const ca = hex(A.fabricBaseColor), cb = hex(B.fabricBaseColor);
      const [ka, kb] = [await cutoutPanels(it, { front: old }), await cutoutPanels(it, { front: now })];
      const [qa, qb] = [await createImageBitmap(ka.front), await createImageBitmap(kb.front)];
      out.push({
        name: it.name, panelDiff: diff / (pa.d.length / 4) / 3,
        colourDiff: Math.max(...ca.map((v, k) => Math.abs(v - cb[k]))),
        crotch: [A.crotchV, B.crotchV],
        aspect: [qa.width / qa.height, qb.width / qb.height],
      });
    }
    return out;
  });
  for (const x of r) {
    check(`baker, ${x.name}: same front panel`, x.panelDiff < 6, `mean difference ${x.panelDiff.toFixed(2)} / 255`);
    check(`baker, ${x.name}: same fabric colour`, x.colourDiff <= 6, `${x.colourDiff}`);
    check(`mannequin, ${x.name}: same panel shape`, Math.abs(x.aspect[0] - x.aspect[1]) < 0.03, x.aspect.map((v) => v.toFixed(3)).join(" vs "));
    if (x.crotch[0] != null) check(`baker, ${x.name}: same crotch line`, Math.abs(x.crotch[0] - x.crotch[1]) < 0.03, x.crotch.map((v) => v.toFixed(3)).join(" vs "));
  }
}

await browser.close();
server.close();
const failed = results.filter((ok) => !ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks pass`);
process.exit(failed ? 1 : 0);
