// Ask the stylist, as a conversation. Pure logic, no DOM and no AI calls (app.js does those), so
// it runs in Node for the tests (tools/stylist-chat.test.mjs):
//   - readPlan: what the question says about timing and places, read here at no token cost:
//     the day, the start time ("we meet at 16.30"), how long it lasts ("for 3 hours", "we might
//     stay for supper" → until about 22:30) and whether it's outdoors, indoors or in and out
//     ("Piazza Venezia, then the shops around");
//   - spanWeather: the hourly forecast over that span (it gets cooler towards the evening), or the
//     usual temperatures for the month when there's no forecast;
//   - planText: both in a few lines for the stylist's prompt;
//   - splitBlocks / mergeReply / followupText: a follow-up ("make Outfit 2 warmer", "reshuffle",
//     "change the jeans") sends the outfits on screen in a few short lines instead of the whole
//     conversation, and the answer rewrites only the outfits it changes.

const pad = (n) => String(n).padStart(2, "0");
export const hhmm = (ms) => { const d = new Date(ms); return `${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const HOUR = 3600e3;
const WORD_NUM = { one: 1, an: 1, a: 1, two: 2, three: 3, four: 4, five: 5, six: 6, "a couple of": 2, "a few": 3, un: 1, una: 1, due: 2, tre: 3, quattro: 4 };

// Words that say where the time goes. Shops: inside, but walking between them, so in and out.
const IN_OUT = /\b(shops?|stores?|shopping|boutiques?|negozi|vetrine|market|mercato|mall|outlet|errands?|commissioni|sightseeing|giro)\b/i;
const OUTDOOR = /\b(piazza|square|park|parco|walk(?:ing)?|stroll|passeggiata|passeggio|outside|outdoors?|all'aperto|fuori|terrace|terrazza|rooftop|beach|spiaggia|garden|giardino|hike|hiking|picnic|street|strade?|centro|downtown|around (?:the )?(?:city|town|centre|center)|stadium|stadio|concert in the park|scooter|vespa|motorbike|bike|bici|boat|barca|festival|fair|fiera|zoo|tour)\b/i;
const INDOOR = /\b(restaurant|ristorante|trattoria|osteria|pizzeria|dinner|supper|cena|lunch|pranzo|brunch|cinema|movies?|film|theat(?:re|er)|teatro|museum|museo|gallery|galleria|office|ufficio|meeting|bar|pub|club|disco|home|casa|indoors?|inside|dentro|mall|cafe|café|caffè)\b/i;

// The span of the day each word stands for, when no time is given: [start, end] in hours.
const PARTS = [
  [/\b(this morning|stamattina|morning|mattina|mattino)\b/i, 9, 12.5, "morning"],
  [/\b(brunch)\b/i, 11, 14, "brunch"],
  [/\b(lunch|pranzo)\b/i, 12.5, 15, "lunch"],
  [/\b(this afternoon|oggi pomeriggio|afternoon|pomeriggio)\b/i, 15, 18.5, "afternoon"],
  [/\b(aperitivo|aperitif|drinks?|happy hour|apericena)\b/i, 18.5, 21, "drinks"],
  [/\b(dinner|supper|cena|dîner)\b/i, 20, 23, "dinner"],
  [/\b(night out|party|festa|club|disco|clubbing|late night)\b/i, 22, 26, "night out"],
  [/\b(this evening|tonight|stasera|evening|sera|serata)\b/i, 19, 23, "evening"],
];
// What makes a plan last longer than it starts: the end it reaches at least.
const ENDS = [
  [/\b(dinner|supper|cena|dîner)\b/i, 22.5, "dinner"],
  [/\b(aperitivo|aperitif|drinks|happy hour)\b/i, 21, "drinks"],
  [/\b(night out|party|festa|club|disco|clubbing|dancing|ballare)\b/i, 26, "a night out"],
  [/\b(late|tardi|all night|tutta la notte)\b/i, 23.5, "late"],
];

// One time said in the text: "16.30", "16:30", "4.30pm", "8 pm", "20h", "at 8", "alle 20".
// A bare number only counts after a word that announces a time ("at 8"), so "3 outfits" isn't one.
const TIME_RE = /(?:\b(at|from|until|till|til|to|by|around|about|alle|dalle|alle ore|fino alle|verso le|ore|after|before|tra le|between)\s+)?(?<![\d.:,€$£])\b(\d{1,2})(?:([:.])(\d{2})|(h)(\d{2})?\b)?(?:\s*(a\.?m\.?|p\.?m\.?)(?![a-z]))?(?![\d%°€$£])/gi;
// After a bare number ("at 8"), only these words keep it a time: "at 8 and", "at 8 we".
const AFTER_BARE = /^\s*(?:$|[,.;!?)]|(?:o'?clock|ish|and|or|then|to|till|until|with|for|in|at|we|i|so|tonight|today|tomorrow|this|e|poi|con|per|in punto)\b)/i;
const END_WORDS = new Set(["until", "till", "til", "to", "fino alle", "before"]);

// Reads timing and places from a question. Returns null when it says nothing about time.
export function readPlan(text, now = new Date()) {
  const t = ` ${String(text || "")} `;
  const day = /\b(tomorrow|domani)\b/i.test(t) ? 1 : 0;
  const morningSaid = /\b(morning|mattina|mattino|stamattina|a\.?m\.?)\b/i.test(t);
  const eveningSaid = /\b(evening|tonight|sera|stasera|dinner|supper|cena|night)\b/i.test(t);
  const times = [];
  for (const m of t.matchAll(TIME_RE)) {
    const [whole, prep, hs, sep, mm, hMark, hmm, ampm] = m;
    const bare = !sep && !hMark && !ampm;
    if (bare && (!prep || !AFTER_BARE.test(t.slice(m.index + whole.length)))) continue;
    let h = +hs, min = +(mm || hmm || 0);
    if (h > 24 || min > 59) continue;
    if (ampm) { const pm = /p/i.test(ampm); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    else if (h >= 1 && h <= 7 && !morningSaid) h += 12; // "at 5" is in the afternoon
    else if (h >= 8 && h <= 11 && eveningSaid && !morningSaid && !sep) h += 12; // "dinner at 8"
    times.push({ h: h + min / 60, end: END_WORDS.has(String(prep || "").toLowerCase()), at: m.index });
  }
  // "10-14", "16:30–19": a range.
  const range = t.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*[-–]\s*(\d{1,2})(?:[:.](\d{2}))?\b(?!\s*(?:°|outfits?|pieces?|days?))/);
  if (/\b(noon|midday|mezzogiorno)\b/i.test(t)) times.push({ h: 12, end: false, at: t.search(/\b(noon|midday|mezzogiorno)\b/i) });
  if (/\b(midnight|mezzanotte)\b/i.test(t)) times.push({ h: 24, end: true, at: t.search(/\b(midnight|mezzanotte)\b/i) });
  times.sort((a, b) => a.at - b.at);

  const part = PARTS.find(([re]) => re.test(t));
  let start = null, end = null, endWhy = "";
  if (range && (range[2] || range[4] || +range[1] > 6) && +range[1] <= 24 && +range[3] <= 26) {
    start = +range[1] + (+range[2] || 0) / 60;
    end = +range[3] + (+range[4] || 0) / 60;
    if (start <= 7 && !morningSaid) start += 12;
    if (end <= start) end += 12;
    endWhy = "said";
  } else {
    const s = times.find((x) => !x.end), e = times.find((x) => x.end && (!s || x.at > s.at));
    if (s) start = s.h;
    if (e) { end = e.h; endWhy = "said"; }
  }
  if (start == null && part) start = part[1];
  if (start == null && end == null) {
    const allDay = /\b(all day|tutto il giorno|whole day|giornata)\b/i.test(t);
    if (!allDay) return null;
    start = 9; end = 22; endWhy = "all day";
  }
  if (start == null) start = Math.max(8, end - 3);
  // How long it lasts: said ("for 3 hours"), or what comes after (dinner → about 22:30).
  const dur = t.match(/\bfor\s+(\d+(?:[.,]5)?|one|two|three|four|five|six|an?|a couple of|a few)\s*(?:hours?|hrs?|h)\b|\bper\s+(\d+|un'?|una|due|tre|quattro)\s*or[ae]\b/i);
  if (end == null && dur) {
    const n = dur[1] || dur[2];
    end = start + (WORD_NUM[n.toLowerCase().replace("'", "")] ?? parseFloat(n.replace(",", ".")));
    endWhy = "said";
  }
  if (/\bhalf an hour|mezz'?ora\b/i.test(t) && end == null) { end = start + 0.5; endWhy = "said"; }
  if (end == null) {
    end = start + 3;
    for (const [re, h, why] of ENDS) if (re.test(t) && h > end) { end = h; endWhy = why; }
    if (!endWhy && part && part[2] > end) { end = part[2]; endWhy = part[3]; }
    if (!endWhy) endWhy = "about 3 hours";
  }
  if (end <= start) end = start + 1;
  const base = new Date(now); base.setHours(0, 0, 0, 0); base.setDate(base.getDate() + day);
  const at = (h) => base.getTime() + Math.round(h * 60) * 60e3;
  const shops = IN_OUT.test(t), out = OUTDOOR.test(t), inside = INDOOR.test(t);
  const where = shops || (out && inside) ? "in and out" : out ? "outdoors" : inside ? "indoors" : null;
  const maybe = /\b(might|may|maybe|probably|perhaps|forse|magari|possibly)\b[^.!?]{0,40}\b(stay|dinner|supper|cena|late|restare|rimanere)\b/i.test(t);
  return {
    day, start: at(start), end: at(end), endWhy, maybe, where,
    shops, out, inside, // what the text mentions, for the prompt
    evening: end >= 19 && start < 19, // it runs into the evening
  };
}

const isWetCode = (c) => (c >= 51 && c <= 67) || (c >= 80 && c <= 99);
// The weather over a span, from Open-Meteo's hourly lists (local times, "2026-11-17T16:00"),
// or from the month's usual low and high when there's no forecast (typical: { min, max }).
// Returns the hours to show (at most 5: the start, every two hours, the end), the coolest and
// warmest feel, and whether rain is likely at any point.
export function spanWeather({ hourly, min, max, sunset } = {}, start, end) {
  let pts = [];
  if (hourly?.time?.length) {
    for (let k = 0; k < hourly.time.length; k++) {
      const ts = new Date(hourly.time[k]).getTime();
      if (ts + HOUR > start && ts <= end && hourly.feels[k] != null) pts.push({ at: Math.max(ts, start), feels: hourly.feels[k], rain: hourly.rain?.[k] ?? 0, wet: isWetCode(hourly.code?.[k]) || (hourly.rain?.[k] ?? 0) >= 55 });
    }
  } else if (min != null && max != null) {
    // Usual temperatures: warmest mid-afternoon, coolest late at night.
    for (let ts = start; ts <= end; ts += HOUR) {
      const h = new Date(ts).getHours() + new Date(ts).getMinutes() / 60;
      const f = h >= 22 || h < 6 ? min + 1 : h >= 18 ? (2 * min + max) / 3 : h >= 10 ? (min + 2 * max) / 3 : (2 * min + max) / 3;
      pts.push({ at: ts, feels: f, rain: 0, wet: false, usual: true });
    }
  }
  if (!pts.length) return null;
  const shown = pts.filter((p, k) => k % 2 === 0 || k === pts.length - 1);
  while (shown.length > 5) shown.splice(Math.floor(shown.length / 2), 1);
  const feels = pts.map((p) => p.feels);
  const sun = sunset ? new Date(sunset).getTime() : null;
  return {
    points: shown, min: Math.min(...feels), max: Math.max(...feels), first: pts[0].feels, last: pts.at(-1).feels,
    wet: pts.some((p) => p.wet), rainMax: Math.max(...pts.map((p) => p.rain)), usual: !!pts[0].usual,
    dark: sun && sun > start && sun < end ? sun : null,
  };
}

// The plan and its weather for the stylist, in a few lines (°C, 24-hour times).
export function planText(plan, wx, { place = "" } = {}) {
  if (!plan) return "";
  const when = `${plan.day ? "Tomorrow" : "Today"} from ${hhmm(plan.start)} to ${plan.maybe ? "maybe " : ""}about ${hhmm(plan.end)}`;
  const why = plan.endWhy && !["said", "about 3 hours"].includes(plan.endWhy) ? ` (${plan.endWhy})` : "";
  const where = plan.where === "in and out" ? `In and out: ${[plan.out && "outdoors", plan.shops && "in and out of shops", plan.inside && !plan.shops && "indoors"].filter(Boolean).join(", ")}.`
    : plan.where === "outdoors" ? "Mostly outdoors." : plan.where === "indoors" ? "Mostly indoors." : "";
  const lines = [`Plan read from the question: ${when}${why}. ${where}`.trim()];
  if (wx) {
    const r = (x) => Math.round(x);
    lines.push(`${wx.usual ? "Usual weather for the month" : "Forecast"}${place ? ` in ${place}` : ""}, feels like: ${wx.points.map((p) => `${hhmm(p.at)} ${r(p.feels)}°C`).join(", ")}; ${wx.wet ? `rain likely (up to ${r(wx.rainMax)}%)` : "dry"}${wx.dark ? `; dark from ${hhmm(wx.dark)}` : ""}.`);
    const span = r(wx.max) - r(wx.min);
    lines.push(`Dress for the whole span: warm enough at the coolest point (${r(wx.min)}°C)${span >= 3 ? `, with a top layer that comes off or opens when it's ${r(wx.max)}°C` : ""}${plan.where === "in and out" ? " and in heated shops: easy to open, take off and carry" : ""}${plan.evening ? "; it must still look right in the evening" : ""}${wx.wet ? "; shoes and a jacket that cope with rain" : ""}.`);
  } else if (plan.evening) {
    lines.push("It runs into the evening: it gets cooler, so bring a layer, and it must still look right for the evening.");
  }
  return lines.join("\n");
}

/* ---------- The conversation ---------- */
// An answer as its outfit blocks: "Outfit 2: City walk" (the number is optional), the lines under
// it, and the lines before the first outfit (intro). Same header rule as app.js's parseAnswer.
const HEAD = /^(?:outfit|look|option)(?:\s*(\d+))?\s*(?:[:.)–—-]\s*(.*))?$/i;
const clean = (s) => s.replace(/\*\*|__/g, "").replace(/^[\s*•·–-]+/, "").trim();
export function splitBlocks(text) {
  const intro = [], blocks = [];
  let cur = null, newSet = false;
  for (const src of String(text || "").split("\n")) {
    const line = clean(src);
    if (!line) continue;
    if (!blocks.length && !cur && /^new set\b[.:!]*$/i.test(line)) { newSet = true; continue; }
    const h = line.match(HEAD);
    if (h) { cur = { num: h[1] ? +h[1] : null, title: (h[2] || "").trim(), lines: [] }; blocks.push(cur); continue; }
    (cur ? cur.lines : intro).push(line);
  }
  return { intro, blocks, newSet };
}
export const joinBlocks = (blocks, intro = []) => [...intro, ...blocks.flatMap((b, k) => [`Outfit ${k + 1}: ${b.title || `Outfit ${k + 1}`}`, ...b.lines])].join("\n");

// The reply to a follow-up merged into the outfits on screen. Numbered outfits replace that
// number; unnumbered ones replace the outfit with the same title, or all of them when there are
// as many as on screen; anything else is added. "New set" (or a reshuffle) replaces them all.
// Returns { text, changed (indices of the outfits that are new or changed), note (the reply's
// words that aren't an outfit), replaced (all of them) }.
export function mergeReply(curText, replyText, { replaceAll = false } = {}) {
  const cur = splitBlocks(curText).blocks, rep = splitBlocks(replyText);
  const note = rep.intro.join("\n");
  if (!rep.blocks.length) return { text: joinBlocks(cur), changed: [], note, replaced: false };
  const numbered = rep.blocks.some((b) => b.num);
  if (replaceAll || rep.newSet || !cur.length || (!numbered && rep.blocks.length >= cur.length && !rep.blocks.some((b) => cur.some((c) => same(c.title, b.title))))) {
    return { text: joinBlocks(rep.blocks), changed: rep.blocks.map((_, k) => k), note, replaced: true };
  }
  const out = cur.map((b) => ({ ...b })), changed = new Set();
  for (const b of rep.blocks) {
    let k = b.num && b.num <= out.length ? b.num - 1 : out.findIndex((c) => same(c.title, b.title));
    if (k < 0) { out.push(b); k = out.length - 1; } else out[k] = { ...b, title: b.title || out[k].title };
    changed.add(k);
  }
  return { text: joinBlocks(out), changed: [...changed].sort((a, b) => a - b), note, replaced: false };
}
const same = (a, b) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

// How the stylist answers a follow-up, so only what changes is written (fewer output tokens).
export const FOLLOW_RULES =
  "Answer my last message. If it changes outfits, write only the outfits that change, each with its number and title ('Outfit 2: <title>'), one line per piece with its #number, and a 'Why:' line; outfits you don't write stay as they are. " +
  "For a whole new set, write 'New set' on the first line, then all the outfits numbered from 1. " +
  "If it's only a question, answer in at most 6 short lines without Outfit lines.";
export const RESHUFFLE =
  "Reshuffle: a new set of 3 clearly different outfits for the same plan, using other pieces than the ones above wherever the wardrobe allows.";

// The text of a follow-up: the first question, the outfits on screen now (a few short lines,
// with the user's own changes), the last few exchanges in short, and the new message.
// `history`: [{ q, a }] oldest first (a: the stylist's short note, or which outfits changed).
export function followupText({ question, outfits, lastAnswer = "", edited = [], history = [], message }) {
  const parts = [`My question: ${question}`];
  if (outfits) parts.push(`The outfits on my screen now${edited.length ? ` (I changed ${edited.map((k) => `Outfit ${k + 1}`).join(" and ")} myself)` : ""}:\n${outfits}`);
  else if (lastAnswer) parts.push(`Your answer:\n${lastAnswer.length > 900 ? lastAnswer.slice(0, 900) + "…" : lastAnswer}`);
  const recent = history.slice(-3);
  if (recent.length) parts.push(`Since then:\n${recent.map((h) => `Me: ${h.q}\nYou: ${h.a.length > 200 ? h.a.slice(0, 200) + "…" : h.a}`).join("\n")}`);
  parts.push(`Me now: ${message}`);
  parts.push(FOLLOW_RULES);
  return parts.join("\n\n");
}
