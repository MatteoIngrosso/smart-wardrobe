// Calendar events for outfit ideas: reads an iCal (.ics) feed, the private link that Google
// Calendar, Outlook and iCloud all offer, and works out which occasion each event dresses for.
// Runs on the device. The Worker only fetches the feed (browsers can't read other sites' files).

/* ---------- Parsing ---------- */

// Lines starting with a space continue the line before; values escape , ; \ and newlines.
const unfold = (text) => text.replace(/\r\n|\r/g, "\n").replace(/\n[ \t]/g, "");
const unescape = (v) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

function prop(line) {
  // NAME;PARAM=a;PARAM2="b:c":value. A colon inside quotes belongs to the parameter.
  let i = 0, quoted = false;
  for (; i < line.length; i++) {
    if (line[i] === '"') quoted = !quoted;
    else if (line[i] === ":" && !quoted) break;
  }
  const [name, ...params] = line.slice(0, i).split(";");
  const p = {};
  for (const kv of params) { const [k, v = ""] = kv.split("="); p[k.toUpperCase()] = v.replace(/^"|"$/g, ""); }
  return { name: name.toUpperCase(), params: p, value: line.slice(i + 1) };
}

// "20261015T193000" (+ "Z" for UTC) or "20261015" (a whole day) → wall-clock parts and its zone.
function parseTime(value, params = {}) {
  const m = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const allDay = params.VALUE === "DATE" || !m[4];
  const tz = m[7] ? "UTC" : allDay ? null : cleanZone(params.TZID);
  return { y: +m[1], mo: +m[2], d: +m[3], h: +(m[4] || 0), mi: +(m[5] || 0), s: +(m[6] || 0), allDay, tz };
}
// Outlook writes Windows zone names and some apps add a prefix; anything Intl doesn't know is
// read as the device's own time zone, which is right for nearly every personal calendar.
const WINDOWS_ZONES = {
  "W. Europe Standard Time": "Europe/Berlin", "Romance Standard Time": "Europe/Paris", "Central Europe Standard Time": "Europe/Budapest",
  "Central European Standard Time": "Europe/Warsaw", "GMT Standard Time": "Europe/London", "E. Europe Standard Time": "Europe/Bucharest",
  "FLE Standard Time": "Europe/Kiev", "GTB Standard Time": "Europe/Athens", "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago", "Mountain Standard Time": "America/Denver", "Pacific Standard Time": "America/Los_Angeles",
  "Tokyo Standard Time": "Asia/Tokyo", "China Standard Time": "Asia/Shanghai", "India Standard Time": "Asia/Kolkata",
  "AUS Eastern Standard Time": "Australia/Sydney", "UTC": "UTC",
};
function cleanZone(tzid) {
  if (!tzid) return null;
  const z = WINDOWS_ZONES[tzid] || tzid.replace(/^\/[^/]+\/[^/]+\//, "").replace(/^\//, "");
  try { new Intl.DateTimeFormat("en", { timeZone: z }); return z; } catch { return null; }
}

// Every event in the feed: its title, place, start, end and how it repeats.
export function parseICS(text) {
  const events = [];
  let ev = null, depth = 0, calName = "";
  for (const line of unfold(text).split("\n")) {
    if (!line) continue;
    if (line === "BEGIN:VEVENT") { ev = { exdates: [] }; depth = 0; continue; }
    if (!ev) {
      if (line.startsWith("X-WR-CALNAME:")) calName = unescape(line.slice(13));
      continue;
    }
    if (line.startsWith("BEGIN:")) { depth++; continue; } // alarms inside the event
    if (line.startsWith("END:") && depth) { depth--; continue; }
    if (line === "END:VEVENT") { if (ev.start) events.push(ev); ev = null; continue; }
    if (depth) continue;
    const { name, params, value } = prop(line);
    if (name === "SUMMARY") ev.title = unescape(value);
    else if (name === "LOCATION") ev.location = unescape(value);
    else if (name === "UID") ev.uid = value;
    else if (name === "STATUS") ev.cancelled = /CANCELLED/i.test(value);
    else if (name === "TRANSP") ev.free = /TRANSPARENT/i.test(value);
    else if (name === "DTSTART") ev.start = parseTime(value, params);
    else if (name === "DTEND") ev.end = parseTime(value, params);
    else if (name === "DURATION") ev.duration = parseDuration(value);
    else if (name === "RRULE") ev.rrule = Object.fromEntries(value.split(";").map((kv) => kv.split("=")).map(([k, v]) => [k.toUpperCase(), v]));
    else if (name === "EXDATE") for (const v of value.split(",")) { const t = parseTime(v, params); if (t) ev.exdates.push(t); }
    else if (name === "RECURRENCE-ID") ev.recurrenceId = parseTime(value, params);
  }
  return { name: calName, events };
}
function parseDuration(v) {
  const m = v.match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * ((+m[2] || 0) * 604800 + (+m[3] || 0) * 86400 + (+m[4] || 0) * 3600 + (+m[5] || 0) * 60 + (+m[6] || 0)) * 1000;
}

/* ---------- Time ---------- */

// Wall-clock arithmetic is done on fake-UTC numbers, so daylight saving never shifts a repeat.
const wallMs = (t) => Date.UTC(t.y, t.mo - 1, t.d, t.h, t.mi, t.s);
const fromWall = (ms, like) => { const d = new Date(ms); return { ...like, y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() }; };
const formats = new Map();
function zoneOffset(ms, tz) {
  if (!formats.has(tz)) formats.set(tz, new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  const p = Object.fromEntries(formats.get(tz).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - Math.floor(ms / 1000) * 1000;
}
// The real moment a wall-clock time happens: in its own zone, or this device's.
export function instant(t) {
  if (t.tz === "UTC") return wallMs(t);
  if (!t.tz) return new Date(t.y, t.mo - 1, t.d, t.h, t.mi, t.s).getTime();
  const guess = wallMs(t);
  const first = guess - zoneOffset(guess, t.tz);
  return guess - zoneOffset(first, t.tz);
}

/* ---------- Repeats ---------- */

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const MAX_STEPS = 6000; // a daily event for 16 years; anything older stops there

// Each start of a repeating event that could touch [fromMs, toMs), as wall-clock times.
function* occurrences(ev, fromMs, toMs) {
  const r = ev.rrule, start = ev.start;
  if (!r) { yield start; return; }
  const freq = r.FREQ, step = Math.max(1, +r.INTERVAL || 1);
  const count = +r.COUNT || Infinity;
  // A date-only UNTIL includes that whole day; a time without a zone is in the event's zone.
  const u = r.UNTIL ? parseTime(r.UNTIL) : null;
  const untilMs = !u ? Infinity : u.allDay ? instant({ ...u, allDay: false, tz: start.tz }) + 864e5 - 1 : instant(u.tz ? u : { ...u, tz: start.tz });
  const byDay = (r.BYDAY || "").split(",").map((x) => x.match(/^([+-]?\d+)?([A-Z]{2})$/)).filter(Boolean).map((m) => ({ n: +m[1] || 0, wd: DAYS.indexOf(m[2]) }));
  const byMonthDay = (r.BYMONTHDAY || "").split(",").filter(Boolean).map(Number);
  const byMonth = (r.BYMONTH || "").split(",").filter(Boolean).map(Number);
  const base = wallMs(start), s = new Date(base);
  // Wall-clock and real time differ by at most 14 hours: repeats well before the window are
  // only counted (for COUNT), not converted, which keeps years-old weekly events cheap.
  const early = fromMs - 2 * 864e5 - 864e5 * Math.ceil((wallMs(ev.end || start) - base) / 864e5);
  let n = 0;
  for (let k = 0; k < MAX_STEPS; k++) {
    let days = [];
    if (freq === "DAILY") days = [base + k * step * 864e5];
    else if (freq === "WEEKLY") {
      // The week (Monday first) that is k*step weeks after the first one.
      const weekStart = base - ((s.getUTCDay() + 6) % 7) * 864e5 + k * step * 7 * 864e5;
      days = (byDay.length ? byDay.map((b) => b.wd) : [s.getUTCDay()]).map((wd) => weekStart + ((wd + 6) % 7) * 864e5).sort((a, b) => a - b);
    } else if (freq === "MONTHLY" || freq === "YEARLY") {
      const months = freq === "MONTHLY" ? [s.getUTCMonth() + k * step] : (byMonth.length ? byMonth.map((m) => m - 1) : [s.getUTCMonth()]).map((m) => m + 12 * k * step);
      for (const m of months) {
        const y = s.getUTCFullYear() + Math.floor(m / 12), mo = ((m % 12) + 12) % 12;
        const len = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
        const at = (d) => Date.UTC(y, mo, d, s.getUTCHours(), s.getUTCMinutes(), s.getUTCSeconds());
        if (byDay.length) {
          for (const { n: nth, wd } of byDay) {
            const all = [];
            for (let d = 1; d <= len; d++) if (new Date(Date.UTC(y, mo, d)).getUTCDay() === wd) all.push(d);
            for (const d of nth > 0 ? [all[nth - 1]] : nth < 0 ? [all[all.length + nth]] : all) if (d) days.push(at(d));
          }
        } else if (byMonthDay.length) {
          for (const md of byMonthDay) { const d = md > 0 ? md : len + md + 1; if (d >= 1 && d <= len) days.push(at(d)); }
        } else if (s.getUTCDate() <= len) days.push(at(s.getUTCDate())); // the 31st skips shorter months
      }
      days.sort((a, b) => a - b);
    } else { yield start; return; } // HOURLY and the like: just the first one
    for (const ms of days) {
      if (ms < base) continue;
      if (n >= count || ms - 864e5 > untilMs || ms - 864e5 > toMs) return;
      n++;
      if (ms < early) continue;
      const t = fromWall(ms, start);
      const at = instant(t);
      if (at > untilMs) return;
      if (at >= toMs) return;
      yield t;
    }
  }
}

// The events that overlap [fromMs, toMs), each with real start and end times, earliest first.
export function eventsBetween(events, fromMs, toMs) {
  // A changed single repeat (RECURRENCE-ID) replaces that repeat of the series.
  const moved = new Map();
  for (const ev of events) if (ev.recurrenceId && ev.uid) moved.set(ev.uid, [...(moved.get(ev.uid) || []), ev.recurrenceId]);
  const out = [];
  for (const ev of events) {
    if (ev.cancelled) continue;
    const len = ev.end ? wallMs(ev.end) - wallMs(ev.start) : ev.duration || (ev.start.allDay ? 864e5 : 3600e3);
    if (!ev.rrule && instant(ev.start) >= toMs) continue;
    const skip = [...ev.exdates, ...(ev.rrule ? moved.get(ev.uid) || [] : [])].map((x) => (x.allDay ? x : instant(x)));
    for (const t of occurrences(ev, fromMs, toMs)) {
      const start = instant(t);
      const end = ev.start.allDay ? instant(fromWall(wallMs(t) + len, t)) : start + len;
      if (end <= fromMs) continue;
      if (skip.some((x) => (typeof x === "number" ? x === start : x.y === t.y && x.mo === t.mo && x.d === t.d))) continue;
      out.push({ title: ev.title || "Busy", location: ev.location || "", start, end, allDay: ev.start.allDay });
    }
  }
  return out.sort((a, b) => a.start - b.start || a.title.localeCompare(b.title));
}

/* ---------- Occasions ---------- */

// Words in an event's title or place that say how to dress. English and Italian first, plus
// the common ones in French, Spanish and German. The first group that matches wins.
const RULES = [
  ["event", /wedding|matrimonio|\bsposi\b|\bnozze\b|\bgala\b|ceremon|cerimoni|black tie|\bopera\b|theat(re|er)|teatro|ballet|balletto|graduation|laurea|cresima|comunione|battesimo|baptism|christening|funeral|funerale|mariage|\bboda\b|hochzeit|premiere|award|premiazione/i],
  ["gym", /\bgym\b|palestra|workout|allenamento|crossfit|pilates|\byoga\b|spinning|fitness|\brun\b|running|\bcorsa\b|calcetto|calcio|basket|tennis|padel|\bswim|nuoto|piscina|boxing|\bboxe\b|muay|climbing|arrampicata|entrenamiento|gimnasio/i],
  ["night", /dinner|\bcena\b|aperitivo|aperitif|\bdrinks?\b|\bbar\b|\bpub\b|party|\bfesta\b|\bclub\b|disco|serata|night out|\bdate\b|appuntamento|concert|concerto|cocktail|dîner|soirée|fiesta|abendessen/i],
  ["work", /meeting|riunione|interview|colloquio|office|ufficio|lavoro|\bwork\b|client|cliente|presentation|presentazione|conference|conferenza|convegno|seminar|seminario|standup|stand-up|workshop|\besame\b|\bexam\b|réunion|besprechung|entrevista|bewerbung/i],
  ["smart", /lunch|pranzo|brunch|museum|\bmuseo\b|exhibition|\bmostra\b|gallery|galleria|restaurant|ristorante|parents|genitori|\bnonni\b|in-laws|church|chiesa|\bmessa\b|déjeuner|almuerzo|mittagessen/i],
  ["casual", /shopping|cinema|movie|\bfilm\b|\bwalk\b|passeggiata|picnic|beach|spiaggia|\bmare\b|\bhike\b|escursione|\btrip\b|\bgita\b|travel|viaggio|flight|\bvolo\b|\btrain\b|\btreno\b/i],
];
export function guessOccasion(ev) {
  const text = `${ev.title} ${ev.location || ""}`;
  return RULES.find(([, re]) => re.test(text))?.[0] || null;
}
// The same event name, however it's spaced or capitalised, gets the same fix you made once.
export const titleKey = (t) => String(t || "").toLowerCase().replace(/\d{1,2}[:.]\d{2}/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().slice(0, 60);

/* ======================================================================
   Planning days (the Calendar screen; app.js draws it, the logic is here)
   ====================================================================== */

/* ---------- Days ---------- */
// Calendar days are "YYYY-MM-DD" text. The maths runs on UTC numbers, so daylight saving never
// moves a day.
const dayMs = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
export const isoDay = (y, m, d) => isoOf(Date.UTC(y, m, d)); // m from 0; 32 November is 2 December
export const addDays = (iso, n) => isoOf(dayMs(iso) + n * 864e5);
export const dayDiff = (from, to) => Math.round((dayMs(to) - dayMs(from)) / 864e5);
export const addMonths = (month, n) => isoDay(+month.slice(0, 4), +month.slice(5, 7) - 1 + n, 1).slice(0, 7);
// The days shown for a month ("2026-11"): whole weeks, Monday first, from the week of the 1st to the
// week of the last day. Each is { date, inMonth }.
export function monthGrid(month, weekStart = 1) {
  const y = +month.slice(0, 4), m = +month.slice(5, 7) - 1;
  const first = Date.UTC(y, m, 1), days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const lead = (new Date(first).getUTCDay() - weekStart + 7) % 7;
  return Array.from({ length: Math.ceil((lead + days) / 7) * 7 }, (_, k) => {
    const date = isoOf(first + (k - lead) * 864e5);
    return { date, inMonth: date.slice(0, 7) === month };
  });
}

/* ---------- The forecast (Open-Meteo: free, no key) ---------- */
export const FORECAST_DAYS = 14;
export const FORECAST_TTL = 3 * 3600e3; // read again after 3 hours
const FORECAST_KEEP = 48 * 3600e3; // offline, an older copy still beats nothing for two days
const FORECAST_KEY = "sw.forecast";
export const forecastURL = (lat, lon, days = FORECAST_DAYS) =>
  `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weather_code,temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min,precipitation_probability_max&forecast_days=${days}&timezone=auto`;
// Open-Meteo's daily lists as { "2026-11-12": { code, max, min, feelsMax, feelsMin, rain } } (°C, rain in %).
export function parseForecast(j) {
  const d = j?.daily, out = {};
  if (!Array.isArray(d?.time)) return out;
  d.time.forEach((date, k) => {
    const max = d.temperature_2m_max?.[k], min = d.temperature_2m_min?.[k];
    if (typeof date !== "string" || typeof max !== "number" || typeof min !== "number") return;
    out[date] = {
      code: d.weather_code?.[k] ?? null, max, min,
      feelsMax: d.apparent_temperature_max?.[k] ?? max, feelsMin: d.apparent_temperature_min?.[k] ?? min,
      rain: d.precipitation_probability_max?.[k] ?? 0,
    };
  });
  return out;
}
// localStorage can be missing or locked (private windows, blocked site data): then nothing is cached.
const deviceStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };
const readCache = (s) => { try { return JSON.parse(s?.getItem(FORECAST_KEY) || "null"); } catch { return null; } };
const writeCache = (s, v) => { try { s?.setItem(FORECAST_KEY, JSON.stringify(v)); } catch {} };
const samePlace = (c, lat, lon) => !!c && Math.abs(c.lat - lat) < 0.01 && Math.abs(c.lon - lon) < 0.01; // within about a kilometre
// The next two weeks at a place, as { days, at, stale }: this device's copy while it's under 3 hours
// old, else a fresh one from Open-Meteo; when that can't be reached, a copy up to 2 days old (stale).
// null when there's nothing. `fetchJSON(url)` is the app's own fetch with a timeout.
export async function getForecast({ lat, lon, fetchJSON, storage = deviceStorage(), now = Date.now(), force = false }) {
  if (lat == null || lon == null) return null;
  const cached = readCache(storage);
  const here = samePlace(cached, lat, lon) && cached.days && typeof cached.at === "number";
  if (!force && here && now - cached.at < FORECAST_TTL) return { days: cached.days, at: cached.at, stale: false };
  try {
    const days = parseForecast(await fetchJSON(forecastURL(lat, lon)));
    if (!Object.keys(days).length) throw new Error("No forecast");
    writeCache(storage, { lat, lon, at: now, days });
    return { days, at: now, stale: false };
  } catch {
    return here && now - cached.at < FORECAST_KEEP ? { days: cached.days, at: cached.at, stale: true } : null;
  }
}
// How a day will feel for the outfit ideas: the daytime feel (two parts the warmest, one part the
// coolest, like the usual weather of a month), wet when rain is more than 40% likely, and cool when
// the warmest it gets is under 14° (a jacket or another layer in every idea).
export const RAIN_LIKELY = 40;
export const COOL_BELOW = 14;
export function dayWeather(d) {
  if (!d) return null;
  return { feels: Math.round(((2 * d.feelsMax + d.feelsMin) / 3) * 10) / 10, wet: (d.rain ?? 0) > RAIN_LIKELY, cool: d.max < COOL_BELOW, humid: 0 };
}
// The kind of weather a WMO code means, and a small line icon for it (24×24, drawn with the text colour).
export function wxKind(code) {
  if (code == null) return "";
  return code === 0 ? "sun" : code <= 2 ? "part" : code === 3 ? "cloud" : code <= 48 ? "fog" : code <= 57 ? "drizzle" : code <= 67 ? "rain"
    : code <= 77 ? "snow" : code <= 82 ? "rain" : code <= 86 ? "snow" : "storm";
}
const CLOUD = "M7 16h10a3.5 3.5 0 0 0 .4-7A5.5 5.5 0 0 0 6.8 9.6 3.2 3.2 0 0 0 7 16z";
const WX_PATHS = {
  sun: `<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/>`,
  part: `<circle cx="8.5" cy="8.5" r="3"/><path d="M8.5 2.5v1.2M2.5 8.5h1.2M4.3 4.3l.9.9M12.7 4.3l-.9.9"/><path d="M10 20h7.5a3 3 0 0 0 .3-6 4.6 4.6 0 0 0-8.7 1.2A2.4 2.4 0 0 0 10 20z"/>`,
  cloud: `<path d="M6.5 19h11a4 4 0 0 0 .5-8 6 6 0 0 0-11.6 1.6A3.3 3.3 0 0 0 6.5 19z"/>`,
  fog: `<path d="M4 9h16M3 13h18M6 17h12"/>`,
  drizzle: `<path d="${CLOUD}"/><path d="M9 19v1M13 19v1M17 19v1"/>`,
  rain: `<path d="${CLOUD}"/><path d="M9 18.5l-1 2.5M13 18.5l-1 2.5M17 18.5l-1 2.5"/>`,
  snow: `<path d="${CLOUD}"/><path d="M9 18.5v2.5M7.8 19.75h2.4M15 18.5v2.5M13.8 19.75h2.4"/>`,
  storm: `<path d="${CLOUD}"/><path d="M13 16.5l-2 3.5h3l-2 3"/>`,
};
export const wxIcon = (code) => (WX_PATHS[wxKind(code)] ? `<svg class="wx-ic" viewBox="0 0 24 24" aria-hidden="true">${WX_PATHS[wxKind(code)]}</svg>` : "");

/* ---------- A planned day ----------
   Saved by piece id only, never the pieces or their photos, so a piece you rename or cut out again
   shows as it is now, and one you delete shows as "Removed":
   { date, slots: { outer, mid, base, bottom, shoes }, coat, extras: [ids], occasion, title, notes, src, at, worn } */
export const DAY_ROLES = ["outer", "mid", "base", "bottom", "shoes"]; // the order they're shown in
const idOf = (x) => (typeof x === "string" && x ? x : typeof x?.id === "string" && x.id ? x.id : null);
export function makeEntry({ date, pieces = {}, coat = null, extras = [], occasion = "casual", title = "", notes = "", src = "calendar", at = new Date().toISOString() }) {
  const slots = {};
  for (const r of DAY_ROLES) { const id = idOf(pieces?.[r]); if (id) slots[r] = id; }
  const coatId = idOf(coat);
  return {
    date, slots, coat: coatId, extras: [...new Set((Array.isArray(extras) ? extras : []).map(idOf).filter((id) => id && id !== coatId))],
    occasion, title: String(title || ""), notes: String(notes || ""), src, at,
  };
}
// Every piece id in a planned day (anything that isn't an id is ignored).
export function entryIds(e) {
  if (!e || typeof e !== "object") return [];
  const s = e.slots && typeof e.slots === "object" ? e.slots : {};
  return [...new Set([e.coat, ...DAY_ROLES.map((r) => s[r]), ...(Array.isArray(e.extras) ? e.extras : [])].filter((x) => typeof x === "string" && x))];
}
// The pieces of a planned day as they are now: [{ role, id, item }], item null when it was deleted.
export function resolveEntry(e, byId) {
  if (!e || typeof e !== "object") return [];
  const s = e.slots && typeof e.slots === "object" ? e.slots : {};
  const one = (role, id) => ({ role, id, item: byId.get(id) || null });
  return [
    ...(typeof e.coat === "string" && e.coat ? [one("coat", e.coat)] : []),
    ...DAY_ROLES.filter((r) => typeof s[r] === "string" && s[r]).map((r) => one(r, s[r])),
    ...(Array.isArray(e.extras) ? e.extras : []).filter((id) => typeof id === "string" && id).map((id) => one("extra", id)),
  ];
}
// Plans older than this are dropped when the days are saved, so the shared record stays small.
export function pruneDays(days, today, keep = 180) {
  const out = {};
  for (const [d, e] of Object.entries(days || {})) if (/^\d{4}-\d{2}-\d{2}$/.test(d) && e && typeof e === "object" && dayDiff(d, today) <= keep) out[d] = e;
  return out;
}

/* ---------- Turning the wardrobe over, day to day ----------
   A piece worn or planned 1 to 5 days away from the day being planned costs an idea this much (the
   app multiplies it by its usual discount for pieces you love), so a week planned day by day uses
   the whole wardrobe instead of the same favourites. */
export const ROTATION_DAYS = 5;
const NEARBY = [0, 3, 2.2, 1.5, 1, 0.6];
export const nearbyCost = (k) => (k >= 1 && k <= ROTATION_DAYS ? NEARBY[k] : 0);
// `uses`: Map of piece id → [{ date, kind: "worn" | "planned" }]. The closest of them to `date`
// (the day itself doesn't count), as { k: days away, date, kind }, or { k: Infinity }.
export function nearestUse(uses, id, date) {
  let best = { k: Infinity };
  for (const u of uses.get(id) || []) {
    const k = Math.abs(dayDiff(u.date, date));
    if (k > 0 && (k < best.k || (k === best.k && u.kind === "worn"))) best = { k, date: u.date, kind: u.kind };
  }
  return best;
}
