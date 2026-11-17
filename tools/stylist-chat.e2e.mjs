// Ask the stylist as a conversation, in the app on an iPad-sized page (Playwright, Chromium).
// Gemini is answered here, nothing leaves the machine:
// - Matteo's question ("we meet at 16.30 … the shops … might stay for supper") reaches the AI with
//   the plan read from it (16:30 to about 22:30, in and out of shops), the forecast by hour from
//   16:30 on, and the occasion from the question; the answer line shows the plan
// - ⇄ on a piece lists the other pieces of that kind; picking one changes the outfit at no AI cost,
//   marks it "Changed by you" and is logged as a swap
// - a follow-up sends the outfits on screen (with that change) in short lines and the same system
//   prompt; the reply rewrites only the outfit it names
// - Reshuffle replaces the set; "Back to the previous outfits" brings the last one back
// - "Ask the stylist for another" on a piece asks for just that change
// Run with:  node --test tools/stylist-chat.e2e.mjs      (SHOTS=<dir> also saves screenshots)
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
const dir = mkdtempSync(join(tmpdir(), "wardrobe-chat-"));
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
const browser = await chromium.launch();

// #numbers follow this order.
const WARDROBE = [
  ["c-shirt", "White Oxford shirt", "shirt", ["white"], ["smart casual"]], // 1
  ["c-tee", "Black T-shirt", "tshirt", ["black"], ["casual"]], // 2
  ["c-knit", "Navy sweater", "sweater", ["navy"], ["smart casual"]], // 3
  ["c-cable", "Cream cable-knit sweater", "sweater", ["beige"], ["preppy"]], // 4
  ["c-blazer", "Navy blazer", "jacket", ["navy"], ["smart"]], // 5
  ["c-coat", "Camel wool coat", "coat", ["camel"], ["smart"]], // 6
  ["c-jeans", "Dark jeans", "jeans", ["denim"], ["casual"]], // 7
  ["c-chinos", "Beige chinos", "trousers", ["beige"], ["smart casual"]], // 8
  ["c-grey", "Grey wool trousers", "trousers", ["grey"], ["smart"]], // 9
  ["c-sneak", "White leather sneakers", "sneakers", ["white"], ["casual"]], // 10
  ["c-boots", "Brown suede boots", "boots", ["brown"], ["smart casual"]], // 11
  ["c-belt", "Brown leather belt", "belt", ["brown"], ["smart casual"]], // 12
];
const FIRST = `Here are three looks for the afternoon into dinner.
Outfit 1: Preppy date
#4 Cream cable-knit sweater
#7 Dark jeans
#10 White leather sneakers
Why: warm enough for the evening, easy in the shops.
Outfit 2: Urban minimal
#3 Navy sweater
#9 Grey wool trousers
#11 Brown suede boots
To buy: Black leather belt | search: black leather belt
Why: sharp for dinner.
Outfit 3: Smart layers
#1 White Oxford shirt
#5 Navy blazer
#8 Beige chinos
#11 Brown suede boots
Why: the blazer comes off in the shops.`;

const calls = [];
async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 }, locale: "en-GB", hasTouch: true, deviceScaleFactor: SHOTS ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort()); // nothing leaves the machine
  await page.route(/generativelanguage\.googleapis\.com/, async (r) => {
    const body = JSON.parse(r.request().postData());
    const text = body.contents[0].parts.at(-1).text;
    calls.push({ system: body.system_instruction.parts[0].text, text });
    let out = FIRST;
    if (/^My question:/.test(text)) {
      const now = text.split("Me now: ")[1];
      if (/^Reshuffle/.test(now)) out = "New set\nOutfit 1: Fresh one\n#2 Black T-shirt\n#6 Camel wool coat\n#7 Dark jeans\n#10 White leather sneakers\nWhy: new.\nOutfit 2: Fresh two\n#1 White Oxford shirt\n#3 Navy sweater\n#9 Grey wool trousers\n#11 Brown suede boots\nWhy: new too.";
      else if (/^In Outfit 3, change the Navy blazer/.test(now)) out = "Outfit 3: Smart layers\n#1 White Oxford shirt\n#6 Camel wool coat\n#8 Beige chinos\n#11 Brown suede boots\nWhy: a coat for later.";
      else if (/warmer/i.test(now)) out = "Added the coat for after dark.\nOutfit 2: Urban minimal, warmer\n#3 Navy sweater\n#6 Camel wool coat\n#9 Grey wool trousers\n#11 Brown suede boots\nWhy: warm at 22:00.";
      else out = "Yes, #11 Brown suede boots work for dinner too.";
    }
    await r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ candidates: [{ content: { parts: [{ text: out }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 10 } }) });
  });
  await page.goto(url);
  await page.waitForFunction(() => window.__t?.state?.items?.length >= 5 && window.__t.Style.ready(), null, { timeout: 60000 });
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
    for (const [id, name, category, colors, styles] of list) {
      const it = { id, name, category, colors, styles, formality: t.formalityOf(styles, category), warmth: t.CAT[category].warmth, tags: [], fit: "",
        photos: [await photo(t.COLORS[colors[0]]?.hex || "#999999")], createdAt: at, wearCount: 0, lastWorn: null, favorite: false };
      t.state.items.push(it);
      await t.store.put("items", it);
    }
    Object.assign(t.state.settings, { aiProvider: "gemini", geminiKey: "test-key", city: "Roma", lat: 41.9, lon: 12.5 });
    // Today's forecast in Rome: 17° at 16:00, cooling by a degree an hour.
    const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const time = [], feels = [];
    for (let h = 0; h < 24; h++) { time.push(`${day}T${String(h).padStart(2, "0")}:00`); feels.push(17 - Math.abs(16 - h)); }
    t.state.weather = { at: Date.now(), lat: 41.9, temp: 17, feels: 17, code: 1, min: 9, max: 18, rainChance: 5, hourly: { time, feels, rain: time.map(() => 5), code: time.map(() => 1), humid: time.map(() => 60) }, sunset: [`${day}T16:52`] };
    t.state.outfits = [];
    t.go("today");
  }, WARDROBE);
  return { page, errors };
}
const shot = (page, name) => SHOTS && page.locator(".ai-box").screenshot({ path: join(SHOTS, `${name}.png`) });
const looks = (page) => page.$$eval("#ai-answer .look", (els) => els.map((e) => ({ title: e.querySelector("h3").textContent.trim(), pieces: [...e.querySelectorAll(".pieces > .swap-wrap span")].map((s) => s.textContent.trim()) })));

test("the stylist reads the plan, and its outfits can be changed and talked about", async () => {
  const { page, errors } = await open();
  const Q = "This afternoon i have a date with a girl, we’ll go in Piazza Venezia(Rome) and probably from there to the shops around. I need an outfit, weI’ll meet there at 16.30, and we might stay for supper.";
  await page.fill("#ask-input", Q);
  await page.click('[data-act="ask"]');
  await page.waitForSelector("#ai-answer .look");
  // 1. The prompt carries the plan and the weather from 16:30 on.
  const first = calls[0];
  assert.match(first.system, /Plan read from the question: Today from 16:30 to maybe about 22:30 \(dinner\)\. In and out: outdoors, in and out of shops\./);
  assert.match(first.system, /Forecast in Roma, feels like: 16:30 17°C, 18:00 15°C, 20:00 13°C, 22:00 11°C; dry; dark from 16:52\./);
  assert.match(first.system, /warm enough at the coolest point \(11°C\)/);
  assert.match(first.system, /Occasion: Night out \(from the question\)/);
  assert.equal(first.text, Q);
  assert.match(await page.textContent(".plan-read"), /Dressing for 16:30 to maybe about 22:30 · in and out · feels 17° → 11°/);
  assert.equal((await looks(page)).length, 3);
  await shot(page, "1-answer");

  // 2. ⇄ on the jeans of Outfit 1: the other trousers, then chinos by hand.
  await page.click('#ai-answer .look:nth-child(1) [data-cswap$="|c-jeans"]');
  const opts = await page.$$eval("#ai-answer .swap-pick .piece span", (els) => els.map((e) => e.textContent.trim()));
  assert.deepEqual(opts.sort(), ["Beige chinos", "Grey wool trousers"]);
  await shot(page, "2-swap-picker");
  const n = calls.length;
  await page.click('#ai-answer [data-cto$="|c-jeans|c-chinos"]');
  await page.waitForFunction(() => window.__t.state.aiChat.edited.includes(0));
  assert.equal(calls.length, n, "no AI call for a change by hand");
  assert.deepEqual((await looks(page))[0].pieces, ["Cream cable-knit sweater", "Beige chinos", "White leather sneakers"]);
  assert.match((await looks(page))[0].title, /Changed by you/);
  const log = await page.evaluate(() => window.__t.state.log.at(-1));
  assert.equal(log.kind, "swap");
  assert.equal(log.removed, "c-jeans");
  assert.equal(log.added, "c-chinos");

  // 3. A follow-up: the outfits on screen in short lines, the same system prompt, only Outfit 2 changes.
  await page.fill("#cfollow-input", "Can you make outfit 2 warmer for later?");
  await page.click('[data-act="cfollow"]');
  await page.waitForFunction(() => window.__t.state.aiChat.history.length === 1 && !window.__t.state.aiChat.busy);
  const fu = calls.at(-1);
  assert.equal(fu.system, first.system, "the same system prompt for the whole conversation");
  assert.match(fu.text, /The outfits on my screen now \(I changed Outfit 1 myself\):\nOutfit 1: Preppy date\n#4 Cream cable-knit sweater\n#8 Beige chinos\n#10 White leather sneakers/);
  assert.match(fu.text, /Me now: Can you make outfit 2 warmer for later\?/);
  assert.ok(fu.text.length < 1500, `short follow-up (${fu.text.length} chars)`);
  const after = await looks(page);
  assert.equal(after.length, 3);
  assert.deepEqual(after[0].pieces, ["Cream cable-knit sweater", "Beige chinos", "White leather sneakers"], "Outfit 1 keeps the change by hand");
  assert.deepEqual(after[1].pieces, ["Navy sweater", "Camel wool coat", "Grey wool trousers", "Brown suede boots"]);
  assert.match(after[1].title, /Urban minimal, warmer.*Updated/);
  assert.match(await page.textContent(".chat-log"), /Can you make outfit 2 warmer for later\?.*Added the coat for after dark/s);
  await shot(page, "3-follow-up");

  // 4. A question about them: the outfits stay, the answer shows with the piece's photo.
  await page.fill("#cfollow-input", "Are the boots ok for dinner?");
  await page.press("#cfollow-input", "Enter");
  await page.waitForFunction(() => window.__t.state.aiChat.history.length === 2 && !window.__t.state.aiChat.busy);
  assert.equal((await looks(page)).length, 3);
  assert.equal(await page.locator(".chat-log .chat-you .tip .piece").count(), 1);

  // 5. Ask the stylist for another blazer in Outfit 3.
  await page.click('#ai-answer .look:nth-child(3) [data-cswap$="|c-blazer"]');
  await page.click('#ai-answer [data-caskswap$="|c-blazer"]');
  await page.waitForFunction(() => window.__t.state.aiChat.history.length === 3 && !window.__t.state.aiChat.busy);
  assert.match(calls.at(-1).text, /Me now: In Outfit 3, change the Navy blazer for something else from my wardrobe\. Keep the rest unless it no longer goes\./);
  assert.deepEqual((await looks(page))[2].pieces, ["White Oxford shirt", "Camel wool coat", "Beige chinos", "Brown suede boots"]);

  // 6. Reshuffle, then Back.
  await page.click("[data-creshuffle]");
  await page.waitForFunction(() => window.__t.state.aiChat.history.length === 4 && !window.__t.state.aiChat.busy);
  assert.match(calls.at(-1).text, /Me now: Reshuffle: a new set/);
  assert.deepEqual((await looks(page)).map((l) => l.title.replace(/\s*Updated$/, "")), ["Fresh one", "Fresh two"]);
  await shot(page, "4-reshuffle");
  await page.click("[data-cback]");
  assert.equal((await looks(page)).length, 3);
  assert.deepEqual((await looks(page))[2].pieces, ["White Oxford shirt", "Camel wool coat", "Beige chinos", "Brown suede boots"]);

  // 7. A new question starts a new conversation.
  await page.fill("#ask-input", "3 outfits for today");
  await page.click('[data-act="ask"]');
  await page.waitForFunction(() => window.__t.state.aiChat.question === "3 outfits for today" && window.__t.state.aiChat.answer);
  assert.equal(await page.locator(".plan-read").count(), 0, "no plan in that question");
  assert.equal(await page.locator(".chat-log").count(), 0);
  assert.doesNotMatch(calls.at(-1).system, /Plan read from the question/);
  assert.deepEqual(errors, []);
  await page.context().close();
});

test.after(async () => { await browser.close(); server.close(); });
