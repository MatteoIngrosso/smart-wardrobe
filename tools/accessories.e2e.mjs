// Accessories everywhere, in the app on an iPad-sized page (Playwright, Chromium):
// - the Accessories filter has Belt, Tie, Jewelry, Watch, Hat, Bag and Eyewear (hats too)
// - earrings and glasses are types; metal and leather tones are guessed from the words and the
//   photo, set on the piece's page and kept after a reload; How dressy is set there too
// - outfit ideas on a test wardrobe with belts, watches, ties, a chain and a cap: the belt's leather
//   is like the shoes', one metal, a tie only with a shirt in a dressy outfit or under a blazer
// - a planned day keeps its accessories (kv `days` extras) and shows them in their slots
// Run with:  node --test tools/accessories.e2e.mjs      (SHOTS=<dir> also saves screenshots)
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

// A copy of the app with every top-level function and constant of app.js on window.__t.
const dir = mkdtempSync(join(tmpdir(), "wardrobe-acc-"));
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
async function open(viewport) {
  const ctx = await browser.newContext({ viewport, hasTouch: true, deviceScaleFactor: SHOTS ? 2 : 1 });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort()); // nothing leaves the machine
  await page.goto(url);
  await page.waitForFunction(() => window.__t?.state?.items?.length >= 10 && window.__t.Style.ready(), null, { timeout: 60000 });
  await page.evaluate(() => window.__t.go("wardrobe"));
  return page;
}

// The test wardrobe: plain colour photos, real types, tones set where the test needs them.
const WARDROBE = [
  ["w-shirt", "White Oxford shirt", "shirt", ["white"], ["smart casual"]],
  ["w-shirt2", "Light blue dress shirt", "shirt", ["light blue"], ["formal"]],
  ["w-tee", "White T-shirt", "tshirt", ["white"], ["casual"]],
  ["w-tee2", "Black T-shirt", "tshirt", ["black"], ["casual"]],
  ["w-hoodie", "Grey hoodie", "hoodie", ["grey"], ["casual"]],
  ["w-knit", "Navy sweater", "sweater", ["navy"], ["smart casual"]],
  ["w-blazer", "Navy blazer", "jacket", ["navy"], ["smart"]],
  ["w-trousers", "Grey wool trousers", "trousers", ["grey"], ["smart"]],
  ["w-chinos", "Beige chinos", "trousers", ["beige"], ["smart casual"]],
  ["w-jeans", "Dark jeans", "jeans", ["denim"], ["casual"]],
  ["w-joggers", "Grey joggers", "joggers", ["grey"], ["sporty"]],
  ["w-derby", "Black leather derbies", "dress-shoes", ["black"], ["formal"], { leather: "black" }],
  ["w-boots", "Brown leather boots", "boots", ["brown"], ["smart casual"], { leather: "brown" }],
  ["w-sneak", "White sneakers", "sneakers", ["white"], ["casual"]],
  ["w-belt-blk", "Black leather belt", "belt", ["black"], ["smart casual"], { leather: "black", metal: "silver" }],
  ["w-belt-brn", "Brown leather belt", "belt", ["brown"], ["smart casual"], { leather: "brown", metal: "gold" }],
  ["w-watch-gold", "Gold watch", "watch", ["brown"], [], { metal: "gold", leather: "brown" }],
  ["w-watch-steel", "Steel watch", "watch", ["grey"], [], { metal: "silver", leather: "" }],
  ["w-tie", "Navy silk tie", "tie", ["navy"], ["smart", "formal"]],
  ["w-tie2", "Burgundy knit tie", "tie", ["burgundy"], ["smart", "formal"]],
  ["w-chain", "Gold chain", "necklace", ["yellow"], [], { metal: "gold" }],
  ["w-bracelet", "Silver bracelet", "bracelet", ["grey"], [], { metal: "silver" }],
  ["w-cap", "Black cap", "cap", ["black"], ["casual", "streetwear"]],
  ["w-glasses", "Tortoise glasses", "glasses", ["brown"], []],
  ["w-earring", "Silver stud earrings", "earrings", ["grey"], [], { metal: "silver" }],
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
    t.state.outfits = [];
  }, WARDROBE);
}
// Many ideas for an occasion: each round asks for ideas not shown yet.
async function ideasFor(page, occasion, rounds = 8) {
  return page.evaluate(({ occasion, rounds }) => {
    const t = window.__t, out = [], seen = [];
    t.state.occasion = occasion;
    for (let k = 0; k < rounds; k++) {
      t.generateOutfits(3, seen);
      for (const o of t.state.outfits) {
        seen.push(o.key);
        const p = (x) => x && { id: x.id, category: x.category, name: x.name, leather: x.leather, metal: x.metal, colors: x.colors };
        out.push({ pieces: Object.fromEntries(Object.entries(o.pieces).map(([r, x]) => [r, p(x)])), coat: p(o.coat), extras: (o.extras || []).map(p) });
      }
    }
    return out;
  }, { occasion, rounds });
}
const FAMILY = { black: "black", brown: "brown", tan: "brown" };
const WARM = ["gold", "rose gold", "bronze"];

const page = await open({ width: 1366, height: 1024 });
await useWardrobe(page);
test.after(async () => { await browser.close(); server.close(); rmSync(dir, { recursive: true, force: true }); });

test("Accessories: a chip for each kind, hats in it too, owned or not", async () => {
  await page.evaluate(() => { const t = window.__t; Object.assign(t.state.filters, { slot: "acc", cat: "all" }); t.render(); });
  const chips = await page.$$eval('[data-row="types"] [data-catf]', (els) => els.map((e) => e.textContent.replace(/\s+\d+$/, "").trim()));
  assert.deepEqual(chips, ["All accessories", "Belt", "Tie", "Jewelry", "Watch", "Hat", "Bag", "Eyewear"]);
  const shown = async () => page.$$eval("#grid > [data-item]:not([hidden])", (els) => els.map((e) => e.dataset.item).sort());
  assert.ok((await shown()).includes("w-cap"), "the cap is under Accessories");
  assert.ok(!(await shown()).includes("w-shirt"));
  await page.click('[data-catf="acc:belt"]');
  assert.deepEqual(await shown(), ["w-belt-blk", "w-belt-brn"]);
  await page.click('[data-catf="acc:jewelry"]');
  assert.deepEqual(await shown(), ["w-bracelet", "w-chain", "w-earring"]);
  await page.click('[data-catf="acc:eyewear"]');
  assert.deepEqual(await shown(), ["w-glasses"]);
  await page.click('[data-catf="acc:hat"]');
  assert.deepEqual(await shown(), ["w-cap"]);
  await page.click('[data-catf="acc:bag"]');
  assert.deepEqual(await shown(), [], "no bag yet: the chip is there anyway");
  await page.click('[data-catf="acc:jewelry"]');
  if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: join(SHOTS, "accessories-filter-1366x1024.png") }); }
  const types = await page.evaluate(() => ["earrings", "glasses"].map((c) => [window.__t.CAT[c]?.slot, window.__t.NOT_WASHED.includes(c)]));
  assert.deepEqual(types, [["acc", true], ["acc", true]], "earrings and glasses are accessories that don't go in the wash");
});

test("tones are guessed from the words, the colours and the photo", async () => {
  const r = await page.evaluate(async () => {
    const t = window.__t;
    const lab = (r, g, b) => t.toLab(r, g, b);
    return {
      cognac: t.guessTones({ category: "belt", name: "Cognac leather belt", colors: ["black"] }),
      rose: t.guessTones({ category: "bracelet", name: "Rose gold bracelet" }),
      rubber: t.guessTones({ category: "watch", name: "Steel diver watch", tags: ["rubber strap"] }),
      colour: t.guessTones({ category: "dress-shoes", name: "Derbies", colors: ["burgundy"] }),
      canvas: t.guessTones({ category: "sneakers", name: "Canvas sneakers", colors: ["black"] }),
      kept: t.guessTones({ category: "belt", name: "Belt", metal: "gold", leather: "tan" }),
      photoGold: t.guessTones({ category: "ring", name: "Ring" }, [{ lab: lab(212, 175, 55), share: 0.8 }]),
      photoSilver: t.guessTones({ category: "necklace", name: "Chain" }, [{ lab: lab(190, 192, 195), share: 0.7 }]),
      photoBlack: t.guessTones({ category: "boots", name: "Boots" }, [{ lab: lab(22, 21, 22), share: 0.8 }]),
      photoTan: t.guessTones({ category: "boots", name: "Boots" }, [{ lab: lab(190, 140, 80), share: 0.8 }]),
    };
  });
  assert.deepEqual(r.cognac, { metal: "", leather: "brown" }, "the words win over the colour");
  assert.deepEqual(r.rose, { metal: "rose gold" });
  assert.deepEqual(r.rubber, { metal: "silver", leather: "" }, "a rubber strap isn't leather");
  assert.deepEqual(r.colour, { leather: "brown" });
  assert.deepEqual(r.canvas, { leather: "" });
  assert.deepEqual(r.kept, {}, "tones already set stay");
  assert.deepEqual(r.photoGold, { metal: "gold" });
  assert.deepEqual(r.photoSilver, { metal: "silver" });
  assert.deepEqual(r.photoBlack, { leather: "black" });
  assert.deepEqual(r.photoTan, { leather: "tan" });
});

test("pieces saved before the tones get them once, from their photo", async () => {
  const r = await page.evaluate(async () => {
    const t = window.__t;
    const c = new OffscreenCanvas(48, 64), g = c.getContext("2d");
    g.fillStyle = "rgb(212,175,55)"; g.fillRect(8, 8, 32, 48);
    const it = { id: "w-old-ring", name: "Ring", category: "ring", colors: ["yellow"], styles: [], formality: 2, warmth: 1, tags: [], photos: [await c.convertToBlob({ type: "image/png" })], createdAt: new Date().toISOString(), wearCount: 0 };
    t.state.items.push(it);
    await t.store.put("items", it);
    await t.backfillTones();
    const saved = await t.store.get("items", "w-old-ring");
    const derby = t.state.items.find((i) => i.id === "w-derby");
    return { metal: saved.metal, leather: "leather" in saved, derby: derby.leather };
  });
  assert.equal(r.metal, "gold");
  assert.equal(r.leather, false, "a ring has no leather");
  assert.equal(r.derby, "black", "set by hand: kept");
});

test("the piece's page: metal, leather and How dressy, kept after a reload", async () => {
  await page.evaluate(() => window.__t.openItem("w-belt-brn"));
  const labels = await page.$$eval(".sheet-panel .field > label", (els) => els.map((e) => e.firstChild.textContent.trim()));
  assert.ok(labels.includes("Buckle metal") && labels.includes("Leather") && labels.includes("How dressy"), labels.join(", "));
  // each tap saves the piece, then draws its page again
  for (const sel of ['[data-setleather="w-belt-brn|tan"]', '[data-setmetal="w-belt-brn|bronze"]', '[data-setform="w-belt-brn|4"]']) {
    await page.click(sel);
    await page.waitForSelector(`${sel}[aria-pressed="true"]`);
  }
  assert.equal(await page.evaluate(() => window.__t.state.items.find((x) => x.id === "w-belt-brn").formality), 3);
  assert.equal(await page.getAttribute('[data-setleather="w-belt-brn|tan"]', "aria-pressed"), "true");
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "belt-sheet-1366x1024.png") });
  await page.reload();
  await page.waitForFunction(() => window.__t?.state?.items?.some((i) => i.id === "w-belt-brn"), null, { timeout: 60000 });
  const it = await page.evaluate(() => { const i = window.__t.state.items.find((x) => x.id === "w-belt-brn"); return { leather: i.leather, metal: i.metal, formality: i.formality }; });
  assert.deepEqual(it, { leather: "tan", metal: "bronze", formality: 3 }, "level 4 Smart is formality 3");
  // back as it was, for the outfit tests
  await page.evaluate(async () => { const t = window.__t, i = t.state.items.find((x) => x.id === "w-belt-brn"); Object.assign(i, { leather: "brown", metal: "gold", formality: t.formalityOf(i.styles, i.category) }); await t.store.put("items", i); t.go("wardrobe"); });
});

test("Work and Smart casual ideas: the belt like the shoes, one metal, a tie only when it's dressy", async () => {
  await page.waitForFunction(() => window.__t.Style.ready());
  let belts = 0, ties = 0, watches = 0;
  for (const occ of ["work", "smart"]) {
    const ideas = await ideasFor(page, occ);
    assert.ok(ideas.length >= 12, `${occ}: ${ideas.length} ideas`);
    for (const o of ideas) {
      const what = `${occ}: ${Object.values(o.pieces).filter(Boolean).map((p) => p.name).join(", ")} + ${o.extras.map((x) => x.name).join(", ")}`;
      const belt = o.extras.find((x) => x.category === "belt"), shoes = o.pieces.shoes;
      if (belt && shoes?.leather) { belts++; assert.equal(FAMILY[belt.leather], FAMILY[shoes.leather], `belt and shoes: ${what}`); }
      const tie = o.extras.find((x) => x.category === "tie");
      if (tie) {
        ties++;
        assert.equal(o.pieces.base?.category, "shirt", `a tie needs a shirt: ${what}`);
        assert.ok(!["hoodie", "zip-hoodie", "sweatshirt"].includes(o.pieces.mid?.category), `no tie under a hoodie: ${what}`);
        const blazer = [o.pieces.outer, o.coat].some((p) => p?.category === "jacket");
        assert.ok(blazer || o.pieces.base?.id === "w-shirt2", `a tie wants a blazer or a dress shirt: ${what}`);
      }
      const metals = o.extras.map((x) => x.metal).filter(Boolean);
      if (metals.some((m) => m === "gold") || metals.some((m) => m === "silver")) watches += o.extras.some((x) => x.category === "watch") ? 1 : 0;
      assert.ok(!(metals.some((m) => WARM.includes(m)) && metals.some((m) => !WARM.includes(m))), `one metal: ${what} (${metals.join(", ")})`);
    }
  }
  console.log(`  ${belts} belts with leather shoes, ${ties} ties, ${watches} watches with matching metal`);
  assert.ok(belts >= 6, "belts are added to Work and Smart ideas");
  assert.ok(ties >= 1, "a tie is added when the outfit allows");
  assert.ok(watches >= 6, "watches are added");
});

test("Everyday ideas: never a tie; a chain or a cap only on casual clothes", async () => {
  const ideas = await ideasFor(page, "casual", 10);
  let accents = 0;
  for (const o of ideas) {
    const what = `${Object.values(o.pieces).filter(Boolean).map((p) => p.name).join(", ")} + ${o.extras.map((x) => x.name).join(", ")}`;
    assert.ok(!o.extras.some((x) => x.category === "tie"), `no tie on an everyday outfit: ${what}`);
    if (o.extras.some((x) => ["necklace", "cap"].includes(x.category))) {
      accents++;
      assert.ok(!["w-blazer"].includes(o.pieces.outer?.id) && !["w-trousers"].includes(o.pieces.bottom?.id), `a chain or cap on casual clothes: ${what}`);
    }
  }
  console.log(`  ${accents} of ${ideas.length} everyday ideas got a chain or a cap`);
  assert.ok(accents >= 2, "some casual ideas get one");
  assert.ok(accents < ideas.length, "but not every one");
});

test("a planned day keeps its accessories and shows them in their slots", async () => {
  const r = await page.evaluate(async () => {
    const t = window.__t;
    t.state.occasion = "work";
    t.state.outfits = [];
    t.generateOutfits();
    const o = t.state.outfits.find((x) => x.extras?.length >= 2) || t.state.outfits[0];
    const date = t.localDay(2);
    const { makeEntry } = await import("/calendar.js");
    await t.setDay(date, makeEntry({ date, pieces: o.pieces, coat: o.coat, extras: o.extras, occasion: "work" }));
    t.planner.sel = date;
    t.planner.month = date.slice(0, 7);
    t.go("plan");
    return { date, extras: o.extras.map((x) => x.id) };
  });
  assert.ok(r.extras.length >= 2, "the idea has accessories");
  const stored = await page.evaluate((d) => window.__t.state.days[d]?.extras, r.date);
  assert.deepEqual(stored, r.extras, "kept in the day's plan");
  await page.waitForSelector("#cal-day .acc-slot");
  const slots = await page.$$eval("#cal-day .pieces.extras .acc-slot", (els) => els.map((e) => e.textContent));
  const order = ["Belt", "Tie", "Jewelry", "Watch", "Hat", "Bag", "Eyewear"];
  assert.equal(slots.length, r.extras.length);
  assert.deepEqual(slots, [...slots].sort((a, b) => order.indexOf(a) - order.indexOf(b)), `in slot order: ${slots.join(", ")}`);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, "calendar-day-1366x1024.png") });
});

test("portrait iPad: the filter row and a piece's page fit", async () => {
  const p2 = await open({ width: 1024, height: 1366 });
  await useWardrobe(p2);
  await p2.evaluate(() => { const t = window.__t; Object.assign(t.state.filters, { slot: "acc", cat: "acc:watch" }); t.render(); });
  const wide = await p2.evaluate(() => {
    const over = [...document.querySelectorAll("body *")].filter((e) => e.getBoundingClientRect().right > innerWidth + 1 && !e.closest(".scroller")).slice(0, 5).map((e) => `${e.tagName}.${e.className} ${Math.round(e.getBoundingClientRect().right)}`);
    return { ok: document.documentElement.scrollWidth <= innerWidth + 1, sw: document.documentElement.scrollWidth, over };
  });
  assert.ok(wide.ok, `no sideways scrolling: ${JSON.stringify(wide)}`);
  if (SHOTS) await p2.screenshot({ path: join(SHOTS, "accessories-filter-1024x1366.png") });
  await p2.evaluate(() => window.__t.openItem("w-watch-gold"));
  const labels = await p2.$$eval(".sheet-panel .field > label", (els) => els.map((e) => e.firstChild.textContent.trim()));
  assert.ok(labels.includes("Watch metal") && labels.includes("Strap leather"), labels.join(", "));
  if (SHOTS) await p2.screenshot({ path: join(SHOTS, "watch-sheet-1024x1366.png") });
  await p2.context().close();
});

test("no errors on the page", () => {
  assert.deepEqual(errors, []);
});
