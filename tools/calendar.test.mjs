// The Calendar's logic in calendar.js: days, the forecast and its cache, planned days, rotation.
//   node --test tools/calendar.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  monthGrid, addDays, addMonths, dayDiff, isoDay, parseForecast, getForecast, dayWeather, wxKind, wxIcon, forecastURL,
  FORECAST_TTL, makeEntry, entryIds, resolveEntry, pruneDays, nearbyCost, nearestUse, ROTATION_DAYS,
} from "../calendar.js";

test("month grid: whole weeks, Monday first", () => {
  const nov = monthGrid("2026-11"); // 1 November 2026 is a Sunday
  assert.equal(nov.length % 7, 0);
  assert.equal(nov[0].date, "2026-10-26");
  assert.equal(nov[0].inMonth, false);
  assert.equal(nov[6].date, "2026-11-01");
  assert.equal(nov.filter((d) => d.inMonth).length, 30);
  assert.equal(nov.at(-1).date, "2026-12-06");
  const feb = monthGrid("2027-02"); // starts on a Monday, 28 days: exactly four weeks
  assert.equal(feb.length, 28);
  assert.equal(feb[0].date, "2027-02-01");
});

test("day maths ignores daylight saving and month ends", () => {
  assert.equal(addDays("2026-03-28", 2), "2026-03-30"); // over the clocks going forward in Europe
  assert.equal(addDays("2026-10-24", 2), "2026-10-26"); // and back
  assert.equal(dayDiff("2026-12-30", "2027-01-02"), 3);
  assert.equal(dayDiff("2026-11-10", "2026-11-05"), -5);
  assert.equal(addMonths("2026-12", 1), "2027-01");
  assert.equal(addMonths("2026-01", -1), "2025-12");
  assert.equal(isoDay(2026, 10, 32), "2026-12-02");
});

const sample = {
  daily: {
    time: ["2026-11-09", "2026-11-10", "2026-11-11"],
    weather_code: [3, 61, 0],
    temperature_2m_max: [13.2, 16, 25],
    temperature_2m_min: [6.1, 10, 15],
    apparent_temperature_max: [11, 15, 26],
    apparent_temperature_min: [3.5, 8, 15],
    precipitation_probability_max: [10, 80, 41],
  },
};

test("forecast: Open-Meteo's daily lists become one entry per day", () => {
  const days = parseForecast(sample);
  assert.deepEqual(Object.keys(days), ["2026-11-09", "2026-11-10", "2026-11-11"]);
  assert.deepEqual(days["2026-11-10"], { code: 61, max: 16, min: 10, feelsMax: 15, feelsMin: 8, rain: 80 });
  assert.deepEqual(parseForecast(null), {});
  assert.deepEqual(parseForecast({ daily: { time: ["2026-11-09"], temperature_2m_max: [null], temperature_2m_min: [3] } }), {});
  assert.match(forecastURL(41.9, 12.5), /forecast_days=14/);
  assert.match(forecastURL(41.9, 12.5), /precipitation_probability_max/);
});

test("forecast weather for the outfit ideas: daytime feel, rain over 40%, cool under 14°", () => {
  const days = parseForecast(sample);
  assert.deepEqual(dayWeather(days["2026-11-09"]), { feels: 8.5, wet: false, cool: true, humid: 0 });
  assert.equal(dayWeather(days["2026-11-10"]).wet, true);
  assert.equal(dayWeather(days["2026-11-11"]).wet, true); // 41%
  assert.equal(dayWeather(days["2026-11-11"]).cool, false);
  assert.equal(dayWeather(null), null);
});

test("weather icons", () => {
  assert.equal(wxKind(0), "sun");
  assert.equal(wxKind(2), "part");
  assert.equal(wxKind(45), "fog");
  assert.equal(wxKind(63), "rain");
  assert.equal(wxKind(81), "rain");
  assert.equal(wxKind(75), "snow");
  assert.equal(wxKind(95), "storm");
  assert.match(wxIcon(61), /^<svg class="wx-ic"/);
  assert.equal(wxIcon(null), "");
});

// A localStorage stand-in.
const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) }; };

test("forecast cache: 3 hours per place, then fresh; offline, the older copy", async () => {
  const storage = memory();
  let calls = 0, fail = false;
  const fetchJSON = async () => { calls++; if (fail) throw new Error("offline"); return sample; };
  const t0 = Date.UTC(2026, 10, 9, 8);
  const a = await getForecast({ lat: 41.9, lon: 12.5, fetchJSON, storage, now: t0 });
  assert.equal(calls, 1);
  assert.equal(a.stale, false);
  assert.equal(a.days["2026-11-10"].rain, 80);
  await getForecast({ lat: 41.9, lon: 12.5, fetchJSON, storage, now: t0 + FORECAST_TTL - 1 });
  assert.equal(calls, 1, "under 3 hours: from the cache");
  await getForecast({ lat: 41.9, lon: 12.5, fetchJSON, storage, now: t0 + FORECAST_TTL + 1 });
  assert.equal(calls, 2, "after 3 hours: read again");
  await getForecast({ lat: 45.46, lon: 9.19, fetchJSON, storage, now: t0 + FORECAST_TTL + 2 });
  assert.equal(calls, 3, "another city: read again");
  fail = true;
  const off = await getForecast({ lat: 45.46, lon: 9.19, fetchJSON, storage, now: t0 + 2 * FORECAST_TTL + 10 });
  assert.equal(off.stale, true);
  assert.equal(off.days["2026-11-09"].max, 13.2);
  assert.equal(await getForecast({ lat: 45.46, lon: 9.19, fetchJSON, storage, now: t0 + 72 * 3600e3 }), null, "too old to use");
  assert.equal(await getForecast({ lat: null, lon: null, fetchJSON, storage }), null);
});

test("forecast works without storage, and with storage that throws", async () => {
  const fetchJSON = async () => sample;
  assert.ok((await getForecast({ lat: 1, lon: 2, fetchJSON, storage: null })).days["2026-11-11"]);
  const locked = { getItem() { throw new Error("SecurityError"); }, setItem() { throw new Error("QuotaExceeded"); } };
  assert.ok((await getForecast({ lat: 1, lon: 2, fetchJSON, storage: locked })).days["2026-11-11"]);
});

test("a planned day keeps piece ids only", () => {
  const shirt = { id: "s1", name: "White shirt", photos: ["data:image/webp;base64,AAAA"] };
  const e = makeEntry({ date: "2026-11-12", pieces: { base: shirt, bottom: "t1", shoes: { id: "sh1" }, mid: undefined }, coat: { id: "c1" }, extras: [{ id: "w1" }, "w1", null, "c1"], occasion: "work", at: "2026-11-09T10:00:00Z" });
  assert.deepEqual(e, { date: "2026-11-12", slots: { base: "s1", bottom: "t1", shoes: "sh1" }, coat: "c1", extras: ["w1"], occasion: "work", title: "", notes: "", src: "calendar", at: "2026-11-09T10:00:00Z" });
  assert.ok(!JSON.stringify(e).includes("base64"), "no photos in the plan");
  assert.deepEqual(entryIds(e), ["c1", "s1", "t1", "sh1", "w1"]);
});

test("a deleted piece shows as removed, and bad data never throws", () => {
  const byId = new Map([["s1", { id: "s1", name: "Shirt" }], ["sh1", { id: "sh1", name: "Loafers" }]]);
  const e = { date: "2026-11-12", slots: { base: "s1", bottom: "gone", shoes: "sh1" }, coat: null, extras: ["gone2"] };
  const parts = resolveEntry(e, byId);
  assert.deepEqual(parts.map((x) => [x.role, x.id, x.item?.name ?? null]), [["base", "s1", "Shirt"], ["bottom", "gone", null], ["shoes", "sh1", "Loafers"], ["extra", "gone2", null]]);
  for (const bad of [null, undefined, 3, "x", {}, { slots: null, extras: "nope" }, { slots: { base: 5, bottom: { id: "s1" } }, coat: 7 }]) {
    assert.deepEqual(resolveEntry(bad, byId), []);
    assert.deepEqual(entryIds(bad), []);
  }
});

test("old plans are dropped from the shared record", () => {
  const days = { "2026-01-01": { date: "2026-01-01" }, "2026-11-01": { date: "2026-11-01" }, "2026-12-01": { date: "2026-12-01" }, junk: { a: 1 }, "2026-11-02": null };
  assert.deepEqual(Object.keys(pruneDays(days, "2026-11-09")), ["2026-11-01", "2026-12-01"]);
});

test("rotation: the closer a piece is worn or planned, the more it costs", () => {
  assert.equal(nearbyCost(0), 0);
  assert.equal(nearbyCost(Infinity), 0);
  assert.ok(nearbyCost(1) > nearbyCost(2) && nearbyCost(2) > nearbyCost(5) && nearbyCost(5) > 0);
  assert.equal(nearbyCost(ROTATION_DAYS + 1), 0);
  const uses = new Map([["a", [{ date: "2026-11-05", kind: "worn" }, { date: "2026-11-12", kind: "planned" }, { date: "2026-11-10", kind: "planned" }]]]);
  assert.deepEqual(nearestUse(uses, "a", "2026-11-11"), { k: 1, date: "2026-11-12", kind: "planned" });
  assert.deepEqual(nearestUse(uses, "a", "2026-11-10"), { k: 2, date: "2026-11-12", kind: "planned" }, "the day itself doesn't count");
  assert.deepEqual(nearestUse(uses, "b", "2026-11-10"), { k: Infinity });
});
