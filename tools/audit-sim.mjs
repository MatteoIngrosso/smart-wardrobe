// Run with:  node tools/audit-sim.mjs <backup.json> [--runs 3] [--json out.json]
// Uses the app on a real wardrobe backup (Settings > Export backup) and measures how the outfit
// ideas behave: rotation over 21 days, the weather, tailoring, laundry and the words on screen.
// Prints one line per metric with PASS or FAIL against the thresholds in the fixing plan.
// The backup is only read, never copied into the repo. Needs Playwright with Chromium.
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const backupPath = args.find((a) => a.endsWith(".json") && a !== opt("--json"));
if (!backupPath || !existsSync(backupPath)) { console.error("Usage: node tools/audit-sim.mjs <backup.json> [--runs 3] [--json out.json]"); process.exit(2); }
const RUNS = +opt("--runs", 3);

// A copy of the app with every top-level function and constant of app.js on window.__t.
const dir = mkdtempSync(join(tmpdir(), "wardrobe-sim-"));
for (const f of ["index.html", "app.js", "stylist.js", "label.js", "calendar.js", "cutout-editor.js", "styles.css", "fashion-bible.json", "manifest.webmanifest", "icon.svg"])
  if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(dir, f));
for (const d of ["sample", "vendor"]) if (existsSync(join(ROOT, d))) cpSync(join(ROOT, d), join(dir, d), { recursive: true });
const src = readFileSync(join(ROOT, "app.js"), "utf8");
const DECL = /^(?:async\s+)?function\s+([\w$]+)|^(?:const|let)\s+([\w$]+)\s*=|^import \* as ([\w$]+)/gm;
const names = [...new Set(Array.from(src.matchAll(DECL), (m) => m[1] || m[2] || m[3]))];
writeFileSync(join(dir, "app.js"), `${src}\nwindow.__t = {${names.map((n) => `get ${n}() { return ${n}; }`).join(",")}, set view(v) {}};\n`);
// The wardrobe without photos (the engine doesn't look at them; it keeps the run fast).
const backup = JSON.parse(readFileSync(backupPath, "utf8"));
for (const i of backup.items || []) { i.photos = []; delete i.originals; }
for (const s of backup.scents || []) s.photos = [];
writeFileSync(join(dir, "backup.json"), JSON.stringify(backup));

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const p = join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/$/, "/index.html"));
  if (!p.startsWith(dir) || !existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
  res.end(readFileSync(p));
}).listen(0, "127.0.0.1");
await new Promise((r) => server.once("listening", r));
const url = `http://127.0.0.1:${server.address().port}/`;

const browser = await chromium.launch();
const errors = [];
async function openApp() {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, timezoneId: "Europe/Rome", locale: "en-GB" });
  const page = await ctx.newPage();
  // A clock the run can move forward, for the 21 days of wear.
  await page.addInitScript(() => {
    const R = Date; let off = 0;
    class F extends R { constructor(...a) { if (!a.length) super(R.now() + off); else super(...a); } static now() { return R.now() + off; } }
    window.Date = F; window.__advance = (d) => { off += d * 864e5; };
  });
  page.on("pageerror", (e) => errors.push(String(e)));
  // The live weather and the AI are off: the run sets its own temperatures.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (r) => r.abort());
  await page.goto(url);
  await page.waitForFunction(() => window.__t?.state, null, { timeout: 30000 });
  await page.waitForTimeout(4500); // an empty device loads the samples after 4 s: let it, then replace them
  await page.evaluate(async () => {
    const { raw, state } = window.__t;
    for (const s of ["items", "log", "scents", "wants", "events"]) await raw.clear(s);
    const data = await (await fetch("backup.json")).json();
    for (const i of data.items) await raw.put("items", i);
    for (const s of data.scents || []) await raw.put("scents", s);
    for (const l of data.log || []) await raw.put("log", l);
    for (const w of data.wants || []) await raw.put("wants", w);
    await raw.put("kv", true, "seeded"); await raw.put("kv", 3, "seedVersion");
    await raw.put("kv", { ...state.settings, ...(data.settings || {}), city: "Rome", lat: 41.89, lon: 12.48, gender: "men" }, "settings");
  });
  await page.reload();
  await page.waitForFunction((n) => window.__t?.state?.items.length >= n && window.__t.Style.ready(), backup.items.length, { timeout: 30000 });
  return { ctx, page };
}

// One run: snapshots of the ideas at fixed temperatures, then 21 days of wearing the top idea.
async function run() {
  const { ctx, page } = await openApp();
  const r = await page.evaluate(() => {
    const T = window.__t, st = T.state, m = {};
    const piecesOf = (o) => Object.values(o.pieces).filter(Boolean);
    const clothes = (o) => Object.entries(o.pieces).filter(([r, p]) => p && r !== "shoes" && r !== "coat").map(([, p]) => p);
    const ideas = (occ, temp, n = 24) => {
      const sets = [];
      st.occasion = occ; st.manualTemp = temp; st.level = null; st.anchor = null;
      for (let i = 0; i < n; i++) { st.outfits = []; T.generateOutfits(3); sets.push(st.outfits.slice()); }
      return sets;
    };
    const share = (sets, f) => { const all = sets.flat(); return all.length ? all.filter(f).length / all.length : 0; };
    const inAll3 = (sets) => sets.filter((s) => s.length === 3 && clothes(s[0]).some((p) => s.every((o) => clothes(o).includes(p)))).length / sets.length;
    const outOfWash = () => st.items.forEach((i) => { i.wash = null; });
    outOfWash();

    // Variety within a set
    for (const occ of ["casual", "smart", "work"]) m[`in3_${occ}`] = inAll3(ideas(occ, 15));
    // Weather
    const knit = (p) => ["sweater", "cardigan"].includes(p.category);
    const c28 = ideas("casual", 28), c23 = ideas("casual", 23);
    m.shorts28 = share(c28, (o) => o.pieces.bottom?.category === "shorts");
    m.shorts23 = share(c23, (o) => o.pieces.bottom?.category === "shorts");
    m.knit23 = share(c23, (o) => piecesOf(o).some(knit));
    m.tooWarmEvent28 = ideas("event", 28).flat().reduce((a, o) => a + (o.warn || []).filter((w) => /warm/i.test(w)).length, 0);
    const cold = ["casual", "smart", "work", "night", "event"].flatMap((occ) => ideas(occ, 2, 8));
    m.warmOuter2 = share(cold, (o) => [o.pieces.outer, o.coat].some((p) => p && (p.warmth || 0) >= 4));
    // Tailoring
    const ev15 = ideas("event", 15);
    const soft = (p) => p && T.softTrousers(p);
    m.linenBest = ev15.filter((s) => soft(s[0]?.pieces.bottom)).length / ev15.length;
    m.eventL4 = share(ev15, (o) => T.dressLevel(piecesOf(o)) >= 4);
    m.eventBestL4 = ev15.filter((s) => s[0] && T.dressLevel(piecesOf(s[0])) >= 4).length / ev15.length;
    m.eventShirt = share(ev15, (o) => o.pieces.base?.category === "shirt");
    const sporty = (o) => o.pieces.shoes && ["sneakers", "boots"].includes(o.pieces.shoes.category) && (o.pieces.shoes.formality || 0) <= 1.5 && o.pieces.base?.category === "shirt";
    const w15 = ideas("work", 15), s15 = ideas("smart", 15);
    m.sportyDress = share([...w15, ...s15], sporty);
    m.workL4 = share(w15, (o) => T.dressLevel(piecesOf(o)) >= 4);
    const wedding = { id: "sim-wedding", title: "Wedding", date: new Date(Date.now() + 9 * 864e5).toLocaleDateString("sv"), weather: { feels: 18, wet: false },
      dressCode: { occasion: "event", label: "Wedding", musts: [], avoid: [], avoidColors: [], formality: 3.4 } };
    const wi = T.eventIdeas(wedding).ideas;
    m.weddingShirt = wi.length ? wi.filter((o) => o.pieces.base?.category === "shirt").length / wi.length : 0;
    // Statement warnings that only an accessory causes
    const allSets = [...c28, ...c23, ...ev15, ...w15, ...s15];
    m.accStatement = allSets.flat().filter((o) => (o.warn || []).some((w) => /statement/i.test(w)) &&
      !T.Style.judge(piecesOf(o), T.styleCtx(T.conditions(), T.OCCASIONS.find((x) => x.id === "casual"), T.taste())).violations.some((v) => /statement/i.test(T.ruleLine(v)))).length;
    // The only dress shirt in the wash
    const shirts = st.items.filter((i) => i.category === "shirt" && !i.disliked);
    shirts.forEach((s) => { s.wash = new Date().toISOString(); });
    st.occasion = "event"; st.manualTemp = 15; st.outfits = []; T.generateOutfits(3);
    m.missingShirtInWash = !!st.levelGap?.needs?.some((n) => /shirt/i.test(n[1]));
    outOfWash();
    // Words: doubled words in shopping titles
    const titles = [...st.wants.map((w) => w.title || ""), ...T.auditFeed().map((x) => T.mkIdea({ cat: x.cat, color: x.colors?.[0], noun: x.noun }).title)];
    m.doubled = titles.filter((t) => /\b(\w+) \1\b/i.test(t || "")).length;
    m.promptChars = T.wardrobeText().length;

    // 21 days: wear the top idea every day (Everyday, 12–17°C); clothes come back from the wash after 2 days
    const temps = [17, 16, 15, 14, 16, 13, 12, 14, 15, 16, 13, 12, 14, 15, 16, 14, 13, 15, 14, 12, 13];
    const top = {}, worn = {};
    return (async () => {
      for (let d = 0; d < 21; d++) {
        window.__advance(1);
        for (const i of st.items) if (i.wash && (Date.now() - new Date(i.wash)) / 864e5 >= 2) { i.wash = null; i.wornSinceWash = 0; }
        st.occasion = "casual"; st.manualTemp = temps[d]; st.level = null; st.anchor = null; st.outfits = [];
        T.generateOutfits(3);
        const pick = st.outfits[0];
        clothes(pick).forEach((p) => { top[p.id] = (top[p.id] || 0) + 1; });
        const items = [...piecesOf(pick), ...(pick.extras || [])];
        items.forEach((p) => { worn[p.id] = (worn[p.id] || 0) + 1; });
        await T.wearOutfit(items, { occasion: "casual", feels: temps[d], source: "idea" });
      }
      const byId = (id) => st.items.find((i) => i.id === id);
      const most = (f) => Object.entries(top).filter(([id]) => f(T.roleOf(byId(id)))).sort((a, b) => b[1] - a[1])[0] || [null, 0];
      const [tb, tbN] = most((r) => r !== "outer"), [ou, ouN] = most((r) => r === "outer");
      m.topDaysMax = tbN; m.topDaysPiece = byId(tb)?.name || "";
      m.outerDaysMax = ouN; m.outerDaysPiece = byId(ou)?.name || "";
      m.topList = Object.entries(top).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, n]) => `${n} ${byId(id)?.name}`);
      const hoodies = st.items.filter((i) => ["hoodie", "zip-hoodie", "sweatshirt"].includes(i.category) && !i.disliked && !T.leaving(i));
      m.hoodiesWorn = hoodies.filter((h) => worn[h.id]).length;
      m.hoodies = hoodies.length;
      m.hoodiesUnworn = hoodies.filter((h) => !worn[h.id]).map((h) => h.name);
      const core = st.items.filter((i) => T.CORE.includes(T.roleOf(i)) && T.roleOf(i) !== "shoes" && T.slotOf(i) !== "gym" && !i.disliked);
      const rate = (arr) => (arr.length ? arr.reduce((a, i) => a + (worn[i.id] || 0), 0) / arr.length : 0);
      const loved = core.filter((i) => (T.starsOf(i) || 0) >= 4), rest = core.filter((i) => (T.starsOf(i) || 0) < 4);
      m.lovedRatio = rate(rest) ? rate(loved) / rate(rest) : 0;
      return m;
    })();
  });
  await ctx.close();
  return r;
}

// --shots <dir>: screenshots of Today (each occasion) and Settings at phone and tablet width, the wash as in the backup.
async function shots(out) {
  for (const [w, h] of [[390, 844], [1280, 800]]) {
    const { ctx, page } = await openApp();
    await page.setViewportSize({ width: w, height: h });
    for (const occ of ["casual", "smart", "work", "event"]) {
      await page.evaluate((occ) => { const T = window.__t; T.state.occasion = occ; T.state.manualTemp = 15; T.state.outfits = []; T.go("today"); }, occ);
      await page.waitForTimeout(600);
      const full = await page.evaluate(() => document.querySelector("main")?.scrollHeight || 2000);
      await page.setViewportSize({ width: w, height: Math.min(full + 120, 9000) });
      await page.screenshot({ path: join(out, `today-${occ}-${w}.png`) });
      await page.setViewportSize({ width: w, height: h });
    }
    await page.evaluate(() => window.__t.go("settings"));
    await page.waitForTimeout(600);
    const full = await page.evaluate(() => document.querySelector("main")?.scrollHeight || 2000);
    await page.setViewportSize({ width: w, height: Math.min(full + 120, 12000) });
    await page.screenshot({ path: join(out, `settings-${w}.png`) });
    await ctx.close();
  }
}
if (opt("--shots")) await shots(opt("--shots"));
// --eval <file.js>: runs the file's code (an expression or async function body using window.__t) in the app and prints what it returns.
if (opt("--eval")) {
  const { ctx, page } = await openApp();
  const code = readFileSync(opt("--eval"), "utf8");
  console.log(JSON.stringify(await page.evaluate(`(async () => { const T = window.__t, st = T.state; ${code} })()`), null, 1));
  await ctx.close();
}
const runs = [];
for (let i = 0; i < RUNS; i++) runs.push(await run());
await browser.close();
server.close();
rmSync(dir, { recursive: true, force: true });

const avg = (k) => runs.reduce((a, r) => a + (typeof r[k] === "boolean" ? +r[k] : r[k] || 0), 0) / runs.length;
const pct = (x) => `${Math.round(x * 100)}%`;
// [label, value, shown, pass, PR]
const rows = !RUNS ? [] : [
  ["Days the most-picked top or bottom is in the top pick (of 21)", avg("topDaysMax"), (v) => `${v.toFixed(1)} (${runs.map((r) => r.topDaysPiece).join(", ")})`, (v) => v <= 9, "A"],
  ["Days the most-picked jacket or coat is in the top pick (of 21)", avg("outerDaysMax"), (v) => `${v.toFixed(1)} (${runs.map((r) => r.outerDaysPiece).join(", ")})`, (v) => v <= 12, "A"],
  ["Hoodies worn at least once in 21 days", avg("hoodiesWorn"), (v) => `${v.toFixed(1)} of ${runs[0].hoodies}`, (v) => v >= 7, "A"],
  ["Wears per loved piece vs the rest", avg("lovedRatio"), (v) => `${v.toFixed(2)}x`, (v) => v >= 1.5, "A"],
  ["Smart casual sets with one piece in all 3", avg("in3_smart"), pct, (v) => v <= 0.15, "A"],
  ["Work sets with one piece in all 3", avg("in3_work"), pct, (v) => v <= 0.15, "A"],
  ["Everyday sets with one piece in all 3", avg("in3_casual"), pct, (v) => v <= 0.15, "A"],
  ["Everyday ideas with shorts at 28°C", avg("shorts28"), pct, (v) => v >= 0.6, "B"],
  ["Everyday ideas with shorts at 23°C", avg("shorts23"), pct, (v) => v >= 0.25, "B"],
  ["Everyday ideas with a knit at 23°C", avg("knit23"), pct, (v) => v <= 0.03, "B"],
  ["'Too warm' warnings on Elegant at 28°C", avg("tooWarmEvent28"), (v) => v.toFixed(0), (v) => v === 0, "B"],
  ["Ideas with a warm outer layer at 2°C", avg("warmOuter2"), pct, (v) => v >= 0.8, "B"],
  ["Elegant: linen/drawstring trousers as best match (15°C)", avg("linenBest"), pct, (v) => v <= 0.09, "C"],
  ["Elegant best match at level 4 or 5 (15°C)", avg("eventBestL4"), pct, (v) => v >= 0.95, "C"],
  ["Elegant ideas at level 4 or 5 (15°C), all three", avg("eventL4"), pct, (v) => v >= 0.6, "C"],
  ["Work/Smart casual: sporty shoes with a dress shirt", avg("sportyDress"), pct, (v) => v <= 0.1, "C"],
  ["Work ideas at level 4 (15°C)", avg("workL4"), pct, (v) => v >= 0.15, "C"],
  ["Wedding plans with a shirt", avg("weddingShirt"), pct, (v) => v >= 0.999, "C"],
  ["'Missing: a shirt' with the shirt in the wash", avg("missingShirtInWash"), (v) => (v ? "shown" : "never"), (v) => v === 0, "D"],
  ["Statement warnings caused by accessories", avg("accStatement"), (v) => v.toFixed(0), (v) => v === 0, "E"],
  ["Doubled words in shopping titles", avg("doubled"), (v) => v.toFixed(0), (v) => v === 0, "E"],
  ["Wardrobe text for the stylist (characters)", avg("promptChars"), (v) => v.toFixed(0), (v) => v < 7000, "F"],
];
if (RUNS) console.log(`\n${RUNS} runs on ${backup.items.length} pieces\n`);
if (RUNS) for (const [label, v, show, pass, pr] of rows) console.log(`${pass(v) ? "PASS" : "FAIL"}  [${pr}] ${label}: ${show(v)}`);
const errs = [...new Set(errors)].filter((e) => !/Failed to fetch|NetworkError|net::/i.test(e));
if (errs.length) console.log("\nPage errors:\n" + errs.slice(0, 8).join("\n"));
if (args.includes("--verbose")) for (const r of runs) console.log("\nTop picks:", r.topList.join(" | "), "\nHoodies never worn:", r.hoodiesUnworn.join(", "));
if (opt("--json")) writeFileSync(opt("--json"), JSON.stringify({ runs, rows: rows.map(([l, v, s, p, pr]) => ({ pr, label: l, value: v, pass: p(v) })) }, null, 1));
