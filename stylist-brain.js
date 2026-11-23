// StylistBrain: what fit checks teach the outfit ideas.
//
// A fit check is a photo of an outfit you actually wore, with 1-5 stars and a few tags ("Needed a
// belt", "Colours clashed"...). Its photo stays in IndexedDB ("fit_checks"); a small summary of each
// one goes into the shared kv record `brain`, so every device learns the same. Nothing here ranks
// outfits on its own: learn() turns the summaries into pair scores and flags that app.js adds to
// taste(), the same learning that stars, wears and skips feed (same 60-day half-life).
//
// Also here: the photo metrics worked out on the device (contrast, where the outfit splits top
// from bottom), and analyzeWithExternalAI(), which asks a local AI server of your own when one is
// set in Settings, and falls back to the device's own metrics otherwise. No paid service is used.

export const HALF_LIFE = 60; // days, like taste()
export const AI_TIMEOUT = 15000;
export const AI_URL_KEY = "LOCAL_AI_SERVER_URL";

// The tags on the review sheet. `good` tags are praise; the rest say what was off.
export const TAGS = [
  { id: "proportions", label: "Great proportions", good: true },
  { id: "fit", label: "Perfect fit", good: true },
  { id: "harmony", label: "Great colour harmony", good: true },
  { id: "accessories", label: "Love the accessories", good: true },
  { id: "boxy", label: "Top too boxy or long" },
  { id: "pants", label: "Pants too loose or tight" },
  { id: "belt", label: "Needed a belt" },
  { id: "shoes", label: "Wrong shoe match" },
  { id: "clash", label: "Colours clashed" },
  { id: "warm", label: "Too warm" },
  { id: "cold", label: "Too cold" },
];
const TAG_IDS = new Set(TAGS.map((t) => t.id));
export const tagLabel = (id) => TAGS.find((t) => t.id === id)?.label || id;
// "Too warm" and "Too cold" can't both be true.
export const EXCLUSIVE = { warm: "cold", cold: "warm" };

export const emptyBrain = () => ({ v: 1, checks: {} });
export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

const JEWELRY = ["necklace", "bracelet", "ring", "earrings"];
// What stars on a fit check do to its pairs: 4-5 add, 3 nothing, 1-2 subtract.
const STAR_PAIR = { 5: 1.5, 4: 0.8, 3: 0, 2: -0.8, 1: -1.5 };

// The summary kept in `brain` for one fit check (no photo, no metrics: those stay on the record).
export function summarize(fc) {
  const wear = cleanWear(fc.wear);
  return {
    at: fc.at, date: fc.date, occasion: fc.occasion || "",
    slots: { ...(fc.itemIds || {}) }, extras: [...(fc.extras || [])],
    ...(fc.coat && { coat: fc.coat }),
    stars: fc.stars || 0, tags: (fc.tags || []).filter((t) => TAG_IDS.has(t)),
    ...(wear && { wear }),
  };
}

/* ---------- How each piece was worn ----------
   The same piece is worn in different ways for different occasions: a coat buttoned up on a cold
   work morning and open over the blazer for dinner, a shirt tucked in under a suit and out with
   jeans. A fit check keeps, per piece id, how it was worn in its photo (read by the AI, or set by
   hand on the review sheet), and wearFor() gives the 3D avatar the closest one for an outfit: the
   same occasion first, then the check that shares the most pieces with it, then the newest.
   - close: a jacket, blazer or coat worn open, buttoned (a blazer's waist button: a V above it),
     or closed up (a coat buttoned to the chest, a zip done up)
   - tuck: a shirt or top tucked into the trousers, worn out, or half-tucked (the front only)
   - sleeves: down or rolled up; break: where the trousers meet the shoes (none, slight, full) */
export const WEAR = {
  close: { label: "Front", values: [["open", "Open"], ["buttoned", "Buttoned"], ["closed", "Closed up"]] },
  tuck: { label: "Tuck", values: [["in", "Tucked in"], ["out", "Worn out"], ["half", "Half-tucked"]] },
  sleeves: { label: "Sleeves", values: [["down", "Sleeves down"], ["rolled", "Sleeves rolled"]] },
  break: { label: "Trouser break", values: [["none", "No break"], ["slight", "Slight break"], ["full", "Full break"]] },
};
const WEAR_OK = Object.fromEntries(Object.entries(WEAR).map(([k, v]) => [k, new Set(v.values.map((x) => x[0]))]));
export const wearWord = (field, v) => WEAR[field]?.values.find((x) => x[0] === v)?.[1] || "";
// Which of these a piece can have, by its outfit role and its category.
const OPENS = new Set(["jacket", "coat", "rain", "puffer", "overshirt", "track-jacket", "zip-hoodie", "gym-hoodie"]);
const TUCKS = new Set(["shirt", "tshirt", "polo", "long-sleeve-top", "tank-top", "gym-top"]);
const SLEEVED = new Set(["shirt", "overshirt", "long-sleeve-top", "sweater", "sweatshirt"]);
export function wearFields(role, category) {
  const out = [];
  if (role === "coat" || role === "outer" || OPENS.has(category)) out.push("close");
  if ((role === "base" || role === "mid") && TUCKS.has(category)) out.push("tuck");
  if (SLEEVED.has(category) && role !== "coat" && role !== "outer") out.push("sleeves");
  if (role === "bottom" && ["trousers", "jeans"].includes(category)) out.push("break");
  return out;
}
// {pieceId: {close, tuck, sleeves, break}} with only known values (null when nothing is left).
export function cleanWear(w) {
  if (!w || typeof w !== "object") return null;
  const out = {};
  for (const [id, st] of Object.entries(w)) {
    if (!id || !st || typeof st !== "object") continue;
    const one = {};
    for (const k of Object.keys(WEAR)) if (WEAR_OK[k].has(st[k])) one[k] = st[k];
    if (Object.keys(one).length) out[id] = one;
  }
  return Object.keys(out).length ? out : null;
}
// How to wear these pieces (ids) for this occasion: {pieceId: {...style, from: date}} from the fit
// checks that saw them. Per piece and per field, the closest check wins: the same occasion counts
// most, then the pieces it shares with this outfit, then the newest.
export function wearFor(brain, ids, occasion) {
  const want = new Set((ids || []).filter(Boolean)), best = {};
  if (!want.size) return {};
  for (const s of Object.values(brain?.checks || {})) {
    const w = s && cleanWear(s.wear); if (!w) continue;
    const worn = [...Object.values(s.slots || {}), s.coat, ...(s.extras || [])].filter(Boolean);
    const score = (occasion && s.occasion === occasion ? 100 : 0) + worn.filter((id) => want.has(id)).length;
    for (const [id, st] of Object.entries(w)) {
      if (!want.has(id)) continue;
      for (const [k, v] of Object.entries(st)) {
        const b = (best[id] ||= {})[k];
        if (!b || score > b.score || (score === b.score && String(s.at || s.date || "") > String(b.at))) best[id][k] = { v, score, at: String(s.at || s.date || ""), date: s.date };
      }
    }
  }
  const out = {};
  for (const [id, f] of Object.entries(best)) {
    out[id] = Object.fromEntries(Object.entries(f).map(([k, b]) => [k, b.v]));
    out[id].from = Object.values(f).map((b) => b.date).filter(Boolean).sort().pop() || "";
  }
  return out;
}

// The request that reads how each piece is worn in a fit check photo: one small JPEG and one short
// line per piece (refs p1, p2… instead of ids), answered with a few enums (about 600 tokens in all).
// `pieces`: [{id, role, name, category}].
export function wearRequest(pieces) {
  const list = (pieces || []).map((p, k) => ({ ...p, ref: `p${k + 1}`, fields: wearFields(p.role, p.category) })).filter((p) => p.fields.length);
  const NA = "n/a";
  const en = (k) => ({ type: "string", enum: [...WEAR[k].values.map((x) => x[0]), NA] });
  const schema = {
    type: "object", additionalProperties: false, required: ["pieces", "note"],
    properties: {
      pieces: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: ["ref", "seen", "close", "tuck", "sleeves", "break"],
          properties: { ref: { type: "string" }, seen: { type: "boolean" }, close: en("close"), tuck: en("tuck"), sleeves: en("sleeves"), break: en("break") },
        },
      },
      note: { type: "string", description: "At most 12 words: anything else about how it is worn (collar up, scarf, coat length)." },
    },
  };
  const ROLE = { coat: "coat", outer: "jacket", mid: "layer", base: "top", bottom: "bottoms" };
  const text = `The man in this mirror photo wears this outfit. For each piece say how he wears it here (${NA} when it doesn't apply or can't be seen; seen=false if the piece isn't in the photo).
close: open, buttoned (a jacket's button done, V above it; on a piece that zips: zipped half way) or closed (buttoned or zipped up to the chest). tuck: in, out or half (front only). sleeves: down or rolled. break: trousers at the shoes, none, slight or full.
${list.map((p) => `${p.ref} | ${ROLE[p.role] || p.role} | ${p.name} (${p.category}${p.fastening === "zip" ? ", zips" : ""}) | ${p.fields.join(", ")}`).join("\n")}`;
  return {
    refs: Object.fromEntries(list.map((p) => [p.ref, p])),
    system: "You look at outfit photos for a wardrobe app and say how each listed piece is worn. Reply with JSON only.",
    text, schema, maxTokens: 60 + 45 * list.length, empty: !list.length,
  };
}
// The answer as {wear: {pieceId: style}, note, unseen: [ids]}; only the fields each piece can have.
export function parseWear(answer, refs) {
  let j = answer;
  if (typeof j === "string") { try { j = JSON.parse(j.replace(/^```(json)?|```$/g, "").trim()); } catch { return { wear: null, note: "", unseen: [] }; } }
  const raw = {}, unseen = [];
  for (const x of Array.isArray(j?.pieces) ? j.pieces : []) {
    const p = refs?.[x?.ref]; if (!p) continue;
    if (x.seen === false) { unseen.push(p.id); continue; }
    raw[p.id] = Object.fromEntries(p.fields.filter((k) => x[k] && x[k] !== "n/a").map((k) => [k, x[k]]));
  }
  const note = typeof j?.note === "string" ? j.note.trim().split(/\s+/).slice(0, 16).join(" ") : "";
  return { wear: cleanWear(raw), note, unseen };
}

// The pairs a fit check speaks about, each with its kind:
// top+bottom, bottom+shoes, shoes+belt, top+tie, top+jewelry.
export function pairsOf(sum, byId) {
  const s = sum.slots || {};
  const top = s.mid || s.base, shirt = s.base || s.mid;
  const extras = (sum.extras || []).map((id) => byId.get(id)).filter(Boolean);
  const out = [];
  if (top && s.bottom) out.push(["top-bottom", top, s.bottom]);
  if (s.bottom && s.shoes) out.push(["bottom-shoes", s.bottom, s.shoes]);
  for (const x of extras) {
    if (x.category === "belt" && s.shoes) out.push(["shoes-belt", s.shoes, x.id]);
    if (x.category === "tie" && shirt) out.push(["top-tie", shirt, x.id]);
    if (JEWELRY.includes(x.category) && shirt) out.push(["top-jewelry", shirt, x.id]);
  }
  return out;
}

// What one fit check does to each kind of pair: its stars, then its tags (the pair a tag names
// gets the bigger share: "Wrong shoe match" hits the shoes' pairs, "Colours clashed" the top and bottom).
export function pairDelta(kind, sum) {
  const tags = new Set(sum.tags || []);
  let v = STAR_PAIR[sum.stars] || 0;
  if (tags.has("clash")) v += kind === "top-bottom" ? -1.5 : -0.4;
  if (tags.has("shoes")) v += kind === "bottom-shoes" ? -1.5 : kind === "shoes-belt" ? -1 : 0;
  if (tags.has("harmony") && kind === "top-bottom") v += 0.6;
  if ((tags.has("proportions") || tags.has("fit")) && kind === "top-bottom") v += 0.4;
  if (tags.has("accessories") && ["shoes-belt", "top-tie", "top-jewelry"].includes(kind)) v += 0.6;
  return v;
}

// Everything the fit checks taught, weighted by age:
// pairs {pairKey: score}, boxy {topId: weight} (a top you found boxy or long), needsBelt {bottomId:
// weight} (bottoms that needed a belt), loose {bottomId: weight} (pants too loose or tight), n.
export function learn(brain, byId, now = Date.now()) {
  const out = { pairs: {}, boxy: {}, needsBelt: {}, loose: {}, n: 0 };
  const add = (map, k, v) => (map[k] = (map[k] || 0) + v);
  for (const sum of Object.values(brain?.checks || {})) {
    if (!sum || typeof sum !== "object") continue;
    const age = Math.max(0, (now - Date.parse(sum.at || sum.date || 0)) / 864e5);
    if (!Number.isFinite(age)) continue;
    const w = 0.5 ** (age / HALF_LIFE);
    out.n++;
    for (const [kind, a, b] of pairsOf(sum, byId)) {
      if (!byId.has(a) || !byId.has(b)) continue;
      const v = pairDelta(kind, sum) * w;
      if (v) add(out.pairs, pairKey(a, b), v);
    }
    const s = sum.slots || {}, tags = new Set(sum.tags || []);
    const top = s.mid || s.base;
    if (tags.has("boxy") && top) add(out.boxy, top, w);
    if (tags.has("belt") && s.bottom) add(out.needsBelt, s.bottom, w);
    if (tags.has("pants") && s.bottom) add(out.loose, s.bottom, w);
    // Worn with a belt and loved: those bottoms keep wanting one.
    const belted = (sum.extras || []).some((id) => byId.get(id)?.category === "belt");
    if (belted && sum.stars >= 4 && s.bottom && out.needsBelt[s.bottom]) add(out.needsBelt, s.bottom, 0.5 * w);
  }
  return out;
}

/* ---------- Metrics from the worn photo (on the device, no API) ----------
   analysePixels() takes RGBA pixels of the photo (any size; app.js passes about 160 x 240) and
   finds the person: the pixels that differ from the colour along the photo's left, right and top
   edges (a wall, a mirror's frame). From those:
   - contrast: how far apart the darkest and lightest parts of the outfit are (0 to 1)
   - waist: the row where the outfit's colour changes most between top and bottom, as a share of
     the person's height from the top (about 0.38 is the classic thirds, 0.5 a boxy half split)
   - fg: which pixels are the person, for the colour groups app.js reads (palette cohesion).
   They are estimates: a busy background or a photo cut at the knees moves them. */
export function analysePixels(data, w, h) {
  const n = w * h;
  const fg = new Uint8Array(n);
  // The edge colour: left and right columns and the top rows (the floor is often a different colour).
  const band = Math.max(1, Math.round(Math.min(w, h) * 0.04));
  let sr = 0, sg = 0, sb = 0, cnt = 0;
  const edge = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!(x < band || x >= w - band || y < band)) continue;
    const i = (y * w + x) * 4;
    edge.push(i);
    sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; cnt++;
  }
  const br = sr / cnt, bg = sg / cnt, bb = sb / cnt;
  let spread = 0;
  for (const i of edge) spread += Math.hypot(data[i] - br, data[i + 1] - bg, data[i + 2] - bb);
  spread /= cnt;
  const T = Math.max(34, spread * 1.8);
  let on = 0;
  const x0 = Math.round(w * 0.08), x1 = Math.round(w * 0.92);
  for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) {
    const i = (y * w + x) * 4;
    if (data[i + 3] < 128) continue;
    if (Math.hypot(data[i] - br, data[i + 1] - bg, data[i + 2] - bb) > T) { fg[y * w + x] = 1; on++; }
  }
  // Nothing stands out (or everything does): use the middle of the photo instead.
  let guessed = false;
  if (on < n * 0.04 || on > n * 0.85) {
    guessed = true;
    fg.fill(0);
    for (let y = Math.round(h * 0.05); y < Math.round(h * 0.95); y++) for (let x = Math.round(w * 0.3); x < Math.round(w * 0.7); x++) fg[y * w + x] = 1;
  }
  // Rows: the person's top and bottom, and each row's mean colour.
  const rowN = new Float64Array(h), rowC = Array.from({ length: h }, () => [0, 0, 0]);
  const lum = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!fg[y * w + x]) continue;
    const i = (y * w + x) * 4;
    rowN[y]++;
    rowC[y][0] += data[i]; rowC[y][1] += data[i + 1]; rowC[y][2] += data[i + 2];
    lum.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
  }
  const minRow = Math.max(2, w * 0.03);
  let top = -1, bottom = -1;
  for (let y = 0; y < h; y++) if (rowN[y] >= minRow) { if (top < 0) top = y; bottom = y; }
  lum.sort((a, b) => a - b);
  const q = (p) => lum[Math.min(lum.length - 1, Math.floor(p * lum.length))] || 0;
  const contrast = lum.length ? Math.round(((q(0.95) - q(0.05)) / 255) * 100) / 100 : null;
  let waist = null, split = 0;
  const H = bottom - top + 1;
  if (top >= 0 && H >= 20) {
    const k = Math.max(2, Math.round(H * 0.06));
    const mean = (a, b) => {
      let r = 0, g = 0, bl = 0, m = 0;
      for (let y = Math.max(top, a); y < Math.min(bottom + 1, b); y++) { r += rowC[y][0]; g += rowC[y][1]; bl += rowC[y][2]; m += rowN[y]; }
      return m ? [r / m, g / m, bl / m] : null;
    };
    for (let y = top + Math.round(H * 0.22); y <= top + Math.round(H * 0.7); y++) {
      const a = mean(y - k, y), b = mean(y, y + k);
      if (!a || !b) continue;
      const d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      if (d > split) { split = d; waist = (y - top) / H; }
    }
    if (split < 22) waist = null; // one colour top to bottom: no clear waistline
    else waist = Math.round(waist * 100) / 100;
  }
  return { fg, contrast, waist, split: Math.round(split), guessed, top, bottom };
}

// The metrics as plain sentences (they are estimates, and say so).
export function metricLines(m) {
  const out = [];
  if (m.contrast != null) out.push(m.contrast >= 0.55 ? "Strong light and dark contrast" : m.contrast >= 0.3 ? "Medium contrast between light and dark" : "Low contrast: a soft, tonal look");
  if (m.cohesion != null) out.push(m.cohesion >= 0.7 ? `Colours that go together${m.palette?.length ? ` (${m.palette.join(", ")})` : ""}` : m.cohesion >= 0.4 ? `Colours mostly go together${m.palette?.length ? ` (${m.palette.join(", ")})` : ""}` : `Colours that fight a little${m.palette?.length ? ` (${m.palette.join(", ")})` : ""}`);
  if (m.waist != null) {
    const v = m.waist.toFixed(2);
    out.push(m.waist <= 0.42 ? `Waistline at about ${v} of your height: good thirds` : m.waist < 0.47 ? `Waistline at about ${v} of your height: close to a half split` : `Waistline at about ${v} of your height: a boxy half split. Tucking the top in or a belt moves it up`);
  } else if (m.contrast != null) out.push("No clear waistline: top and bottom blend together");
  for (const t of m.notes || []) if (typeof t === "string" && t.trim()) out.push(t.trim().slice(0, 160));
  return out;
}

/* ---------- A local AI server (optional) ----------
   Settings > Fit check > Local AI server URL (also kept in localStorage LOCAL_AI_SERVER_URL). When
   set, the photo and the outfit go there as a form POST ("photo", "outfit" as JSON) and any
   { tags: [...], metrics: { contrast, cohesion, waist }, notes: [...] } that comes back is merged
   with the device's own metrics. No answer within 15 s, an error, or no URL: the device's metrics. */
export function localAIUrl() {
  try { return (localStorage.getItem(AI_URL_KEY) || "").trim(); } catch { return ""; }
}
export function cleanAIUrl(u) {
  u = String(u || "").trim();
  if (!u) return "";
  try { const x = new URL(u); return /^https?:$/.test(x.protocol) ? x.href : null; } catch { return null; }
}
const num01 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(1, Math.round(v * 100) / 100)) : undefined);
// Tags named by id or by label ("Needed a belt", "needed a belt", "belt").
export function matchTags(list) {
  const out = [];
  for (const t of Array.isArray(list) ? list : []) {
    const s = String(t || "").toLowerCase().trim();
    const hit = TAGS.find((x) => x.id === s || x.label.toLowerCase() === s || x.label.toLowerCase().replace(/ or .*/, "") === s);
    if (hit && !out.includes(hit.id)) out.push(hit.id);
  }
  return out;
}
export async function analyzeWithExternalAI(fitCheckBlob, outfitData, { local, url = localAIUrl(), timeout = AI_TIMEOUT, fetchImpl = globalThis.fetch } = {}) {
  const base = local ? await local() : {};
  const clean = cleanAIUrl(url);
  if (!clean) return { ...base, source: "device" };
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const form = new FormData();
    form.append("photo", fitCheckBlob, "fit-check.webp");
    form.append("outfit", JSON.stringify(outfitData || {}));
    const r = await fetchImpl(clean, { method: "POST", body: form, signal: ctl.signal });
    if (!r.ok) throw new Error(`${r.status}`);
    const j = await r.json();
    const m = j?.metrics || {};
    const merged = { ...base, source: "local AI server", aiTags: matchTags(j?.tags) };
    for (const k of ["contrast", "cohesion", "waist"]) if (num01(m[k]) !== undefined) merged[k] = num01(m[k]);
    const notes = (Array.isArray(j?.notes) ? j.notes : typeof j?.notes === "string" ? [j.notes] : []).filter((x) => typeof x === "string").slice(0, 4);
    if (notes.length) merged.notes = notes;
    return merged;
  } catch (e) {
    return { ...base, source: "device", aiError: e?.name === "AbortError" ? "The local AI server didn't answer within 15 s" : "The local AI server couldn't be reached" };
  } finally {
    clearTimeout(timer);
  }
}
