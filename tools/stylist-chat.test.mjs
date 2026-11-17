// stylist-chat.js: the plan read from a question, its weather, and merging follow-up answers.
//   node --test tools/stylist-chat.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readPlan, spanWeather, planText, splitBlocks, mergeReply, followupText, hhmm } from "../stylist-chat.js";

const NOW = new Date(2026, 10, 17, 13, 30); // 17 November 2026, 13:30 local
const span = (p) => p && `${p.day ? "tomorrow " : ""}${hhmm(p.start)}-${hhmm(p.end)}`;

test("Matteo's date: 16:30, Piazza Venezia then the shops, maybe supper", () => {
  const q = "This afternoon i have a date with a girl, we’ll go in Piazza Venezia(Rome) and probably from there to the shops around. I need an outfit, weI’ll meet there at 16.30, and we might stay for supper.";
  const p = readPlan(q, NOW);
  assert.equal(span(p), "16:30-22:30");
  assert.equal(p.endWhy, "dinner");
  assert.equal(p.maybe, true);
  assert.equal(p.where, "in and out");
  assert.ok(p.out && p.shops, "outdoors and shops");
  assert.equal(p.evening, true);
});

test("times and spans in other words", () => {
  const cases = {
    "dinner at 8 tomorrow": "tomorrow 20:00-23:00",
    "meeting from 10 to 14": "10:00-14:00",
    "work 9-18": "09:00-18:00",
    "lunch with my parents at 1pm": "13:00-16:00",
    "walk in the park for 2 hours at 11": "11:00-13:00",
    "aperitivo alle 19 poi cena": "19:00-22:30",
    "party tonight": "22:00-02:00",
    "drinks at 7.30pm": "19:30-22:30",
    "this afternoon": "15:00-18:30",
    "we meet at 5 and stay late": "17:00-23:30",
    "a wedding from 11:00 until 23:00": "11:00-23:00",
  };
  for (const [q, want] of Object.entries(cases)) assert.equal(span(readPlan(q, NOW)), want, q);
});

test("no plan where the question says nothing about time", () => {
  for (const q of ["3 outfits for today", "Which pieces should I donate?", "Build me a capsule for a weekend trip", "I'm 25 and need an outfit", "Going to 2 shops with friends", "What goes with my 501 jeans?"]) {
    assert.equal(readPlan(q, NOW), null, q);
  }
});

test("outdoors, indoors, in and out", () => {
  assert.equal(readPlan("walk in the park at 11", NOW).where, "outdoors");
  assert.equal(readPlan("dinner at a restaurant at 20:00", NOW).where, "indoors");
  assert.equal(readPlan("shopping at 15:00", NOW).where, "in and out");
  assert.equal(readPlan("at 18:00 a walk then a bar", NOW).where, "in and out");
});

// A day that cools from 18° at 14:00 by 0.7° an hour.
const time = [], feels = [], rain = [], code = [];
for (let h = 0; h < 48; h++) {
  const d = new Date(2026, 10, 17 + Math.floor(h / 24), h % 24);
  time.push(`${d.getFullYear()}-11-${String(d.getDate()).padStart(2, "0")}T${String(h % 24).padStart(2, "0")}:00`);
  feels.push(18 - Math.abs(14 - (h % 24)) * 0.7);
  rain.push(h % 24 === 21 ? 60 : 5);
  code.push(1);
}

test("the weather over the plan: every two hours, coolest and warmest, rain, dark", () => {
  const p = readPlan("we meet at 16.30, maybe supper after", NOW);
  const wx = spanWeather({ hourly: { time, feels, rain, code }, sunset: "2026-11-17T16:52" }, p.start, p.end);
  assert.deepEqual(wx.points.map((x) => hhmm(x.at)), ["16:30", "18:00", "20:00", "22:00"]);
  assert.equal(Math.round(wx.max), 17);
  assert.equal(Math.round(wx.min), 12);
  assert.equal(wx.wet, true, "60% at 21:00");
  assert.equal(hhmm(wx.dark), "16:52");
  const text = planText(p, wx, { place: "Rome" });
  assert.match(text, /Today from 16:30 to maybe about 22:30 \(dinner\)/);
  assert.match(text, /Forecast in Rome, feels like: 16:30 17°C, 18:00 15°C, 20:00 14°C, 22:00 12°C; rain likely \(up to 60%\); dark from 16:52/);
  assert.match(text, /coolest point \(12°C\)/);
  assert.match(text, /still look right in the evening/);
});

test("the usual weather when there's no forecast: cooler in the evening", () => {
  const p = readPlan("at 16:30 until 23:00", NOW);
  const wx = spanWeather({ min: 7, max: 16 }, p.start, p.end);
  assert.equal(wx.usual, true);
  assert.ok(wx.first > wx.last, "cools down");
  assert.equal(Math.round(wx.min), 8);
  assert.match(planText(p, wx), /^Usual weather for the month/m);
  assert.equal(spanWeather({}, p.start, p.end), null);
});

const FIRST = `Here are three ideas.
Outfit 1: Preppy smart casual
#1 Cable-knit sweater
#5 Dark jeans
Why: clean and warm.
Outfit 2: Urban minimalist
#2 Black sweater
#6 Charcoal jeans
Why: simple.
Outfit 3: Relaxed streetwear
#3 Crewneck
#7 Wide jeans
Why: relaxed.`;

test("splitting an answer into outfits", () => {
  const { intro, blocks } = splitBlocks(FIRST);
  assert.deepEqual(intro, ["Here are three ideas."]);
  assert.deepEqual(blocks.map((b) => [b.num, b.title, b.lines.length]), [[1, "Preppy smart casual", 3], [2, "Urban minimalist", 3], [3, "Relaxed streetwear", 3]]);
});

test("a follow-up rewrites only the outfit it names", () => {
  const r = mergeReply(FIRST, "Swapped in a coat.\n**Outfit 2: Urban minimalist, warmer**\n#2 Black sweater\n#9 Navy coat\n#6 Charcoal jeans\nWhy: warm at night.", {});
  assert.deepEqual(r.changed, [1]);
  assert.equal(r.replaced, false);
  assert.equal(r.note, "Swapped in a coat.");
  const b = splitBlocks(r.text).blocks;
  assert.equal(b.length, 3);
  assert.equal(b[0].title, "Preppy smart casual");
  assert.deepEqual(b[1].lines, ["#2 Black sweater", "#9 Navy coat", "#6 Charcoal jeans", "Why: warm at night."]);
});

test("Reshuffle and 'New set' replace them all; a question changes nothing", () => {
  const set = "Outfit 1: A\n#4 x\nOutfit 2: B\n#8 y";
  assert.equal(splitBlocks(mergeReply(FIRST, set, { replaceAll: true }).text).blocks.length, 2);
  const ns = mergeReply(FIRST, `New set\n${set}`);
  assert.equal(ns.replaced, true);
  assert.deepEqual(ns.changed, [0, 1]);
  const q = mergeReply(FIRST, "Yes, the sweater works for dinner too.");
  assert.deepEqual(q.changed, []);
  assert.equal(q.note, "Yes, the sweater works for dinner too.");
  assert.equal(splitBlocks(q.text).blocks.length, 3);
  // unnumbered: by title, else added
  const t = mergeReply(FIRST, "Outfit: Relaxed streetwear\n#3 Crewneck\n#5 Dark jeans");
  assert.deepEqual(t.changed, [2]);
  const add = mergeReply(FIRST, "Outfit: Something new\n#4 x");
  assert.deepEqual(add.changed, [3]);
});

test("the follow-up text: outfits on screen, own changes, recent turns, the rules", () => {
  const text = followupText({ question: "date at 16:30", outfits: "Outfit 1: A\n#4 x", edited: [0], history: [{ q: "warmer", a: "x".repeat(300) }], message: "Reshuffle" });
  assert.match(text, /^My question: date at 16:30/);
  assert.match(text, /The outfits on my screen now \(I changed Outfit 1 myself\):\nOutfit 1: A\n#4 x/);
  assert.match(text, /Me: warmer\nYou: x{200}…/);
  assert.match(text, /Me now: Reshuffle/);
  assert.match(text, /write only the outfits that change/);
  assert.ok(text.length < 1200, "short");
});
