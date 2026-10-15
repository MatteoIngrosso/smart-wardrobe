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
