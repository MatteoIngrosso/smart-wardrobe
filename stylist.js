/* ======================================================================
   The fashion bible, inside the app
   A copy of the Python model in fashion-model/ (rules.py, outfit.py, model.py,
   knowledge.py): the same 26 checks, the same weights, the same tip search, so
   the app judges an outfit exactly the way the model does. The rules and tips
   themselves come from fashion-bible.json (python -m fashion export), so
   teaching the model something new needs no change here.
   Pure functions, no DOM: tools/stylist.test.mjs runs it against fixtures the
   Python model wrote (fashion-model/tests/parity.json).
   ====================================================================== */
let B = null; // the loaded bible
let V = null; // its vocabulary
let search = null;

const CORE = ["base", "mid", "outer", "bottom", "shoes"];
const HARD_WEIGHT = 0.5; // a rule this important...
const HARD_SCORE = -0.5; // ...broken this badly is a violation

// null forgets the bible. Something that isn't a bible is refused and the one in use stays.
export function setBible(bible) {
  if (bible !== null && !(bible && Array.isArray(bible.rules) && Array.isArray(bible.tips) && bible.vocab && bible.model)) return false;
  B = bible;
  V = B?.vocab || null;
  search = null;
  pieces = new WeakMap();
  return !!B;
}
export const bible = () => B;
export const ready = () => !!B;

/* ---------- Small helpers (Python's own rounding and capitals, so notes match) ---------- */
const clamp = (x, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);
// Python rounds halves to the nearest even number.
function pyRound(x, digits = 0) {
  const m = 10 ** digits, v = x * m, f = Math.floor(v), d = v - f;
  return (d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1) / m;
}
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));

/* ---------- Pieces and outfits ---------- */
let pieces = new WeakMap();
const words = (text) => (String(text || "").toLowerCase().match(/[a-z0-9]+/g) || []);

// An app item ({category, colors, fit, styles, tags, warmth, name, material}) as the checks see it.
// null for things that aren't clothes the rules know about (underwear, socks, gym bags).
export function pieceFrom(item) {
  if (!item || !V) return null;
  const sig = [item.category, item.colors, item.fit, item.styles, item.tags, item.warmth, item.name, item.material].join("\u0001");
  const hit = typeof item === "object" ? pieces.get(item) : null;
  if (hit && hit.sig === sig) return hit.piece;
  const piece = build(item);
  if (typeof item === "object") pieces.set(item, { sig, piece });
  return piece;
}
function build(item) {
  const cat = V.cats[item.category];
  if (!cat) return null;
  const colors = (item.colors || []).filter((c) => V.colors[c]);
  const styles = (item.styles || []).filter((s) => V.styles[s] !== undefined);
  const list = styles.length ? styles : cat[2];
  // Tags are what the app stores, plus the words of the name and material ("Navy blazer", "linen").
  const tags = new Set();
  for (const t of item.tags || []) {
    const w = String(t).toLowerCase().trim();
    if (w) tags.add(w);
    for (const x of words(w)) tags.add(x);
  }
  for (const x of [...words(item.name), ...words(item.material)]) tags.add(x);
  const fs = list.map((s) => V.styles[s]).filter((f) => f !== undefined);
  const base = fs.length ? pyRound(fs.reduce((a, b) => a + b, 0) / fs.length, 1) : 1;
  const fit = V.fits[item.fit] !== undefined ? item.fit : "";
  return {
    isPiece: true, item, category: item.category, slot: cat[0], colors, colour: colors[0] || null, fit,
    volume: fit ? V.fits[fit] : null, styles: list, tags, warmth: Math.trunc(+item.warmth || 0) || cat[1],
    formality: base,
    has: (...names) => names.some((t) => tags.has(t)),
  };
}

export function outfitFrom(things) {
  const ps = things.map((t) => (t?.isPiece ? t : pieceFrom(t))).filter(Boolean);
  const role = {}, extras = [];
  for (const p of ps) {
    if (CORE.includes(p.slot) && !(p.slot in role)) role[p.slot] = p;
    else extras.push(p);
  }
  const core = CORE.filter((r) => role[r]).map((r) => role[r]);
  return {
    pieces: ps, role, extras, core,
    base: role.base, mid: role.mid, outer: role.outer, bottom: role.bottom, shoes: role.shoes,
    hero: role.mid || role.base,
    tops: ps.filter((p) => ["base", "mid", "outer"].includes(p.slot)),
    find: (...cats) => ps.filter((p) => cats.includes(p.category)),
  };
}

/* ---------- The checks (fashion-model/fashion/rules.py) ----------
   Each returns [score, note]: -1 breaks the rule ... +1 a textbook use, or [null, null] when it doesn't apply. */
const NONE = [null, null];
const mainColours = (ps) => ps.map((p) => p.colour).filter(Boolean);
const isAccent = (c) => !V.colors[c][0] && !V.soft_neutrals.includes(c);
const clothes = (o) => o.core.filter((p) => p.slot !== "shoes");
const pairIn = (pairs, a, b) => pairs.some((p) => (p[0] === a && p[1] === b) || (p[0] === b && p[1] === a));
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;

const CHECKS = {
  accent_colours(o, ctx, { limit = 1 }) {
    const cols = mainColours(o.core);
    const accents = [...new Set(cols.filter(isAccent))].sort();
    if (!cols.length) return NONE;
    if (!accents.length) return [0.5, "All neutrals, easy to match"];
    if (accents.length <= limit) return [1, accents.length === 1 ? `${cap(accents[0])} as the single accent colour` : null];
    return [clamp(-(accents.length - limit) * 0.7), `Too many accent colours (${accents.join(", ")})`];
  },
  colour_count(o, ctx, { limit = 3 }) {
    const n = new Set(mainColours(clothes(o))).size;
    if (n < 2) return NONE;
    return n <= limit ? [0.3, null] : [clamp(-(n - limit) * 0.6), `${n} different colours: busy`];
  },
  light_dark_contrast(o) {
    const cols = mainColours(o.core);
    if (cols.length < 2) return NONE;
    const tones = new Set(cols.map((c) => V.colors[c][1]));
    if (tones.has("light") && tones.has("dark")) return [1, "Light and dark pieces give contrast"];
    return tones.size === 1 && tones.has("mid") ? [-0.3, "Little contrast between the pieces"] : [0, null];
  },
  tonal(o) {
    const cols = mainColours(o.core);
    return cols.length >= 3 && new Set(cols).size === 1 ? [1, `Tonal ${cols[0]} look`] : NONE;
  },
  classic_pairs(o, ctx, { pairs = [] }) {
    const h = o.hero, b = o.bottom;
    if (!(h && b && h.colour && b.colour)) return NONE;
    return pairIn(pairs, h.colour, b.colour) ? [1, `${cap(h.colour)} with ${b.colour}: a classic pairing`] : NONE;
  },
  clashing_pairs(o, ctx, { pairs = [] }) {
    const cols = new Set(mainColours(o.core));
    for (const [a, b] of pairs) if (cols.has(a) && cols.has(b)) return [-1, `${cap(a)} and ${b} clash`];
    return NONE;
  },
  formality_spread(o, ctx, { limit = 1.5 }) {
    const fs = clothes(o).map((p) => p.formality);
    if (fs.length < 2) return NONE;
    const spread = Math.max(...fs) - Math.min(...fs);
    return spread <= limit ? [0.5, null] : [clamp(-(spread - limit) / 1.5), "Mixes very casual and very dressy pieces"];
  },
  occasion_formality(o, ctx) {
    if (!V.occasions[ctx.occasion] || !o.core.length) return NONE;
    const [label, target] = V.occasions[ctx.occasion];
    const worn = clothes(o).length ? clothes(o) : o.core;
    const gap = mean(worn.map((p) => p.formality)) - target;
    const over = gap > 0;
    const excess = Math.abs(gap) - (over ? 0.9 : 0.4);
    if (excess <= 0) return [1, `Right level of dressiness for ${label.toLowerCase()}`];
    const score = clamp(1 - excess * (over ? 0.8 : 1.2));
    return [score, score < 0.3 ? `${over ? "Overdressed" : "Underdressed"} for ${label.toLowerCase()}` : null];
  },
  occasion_styles(o, ctx) {
    if (!V.occasions[ctx.occasion] || !o.core.length) return NONE;
    const [, target, likes] = V.occasions[ctx.occasion];
    const suits = (p) => (p.styles.some((s) => likes.includes(s)) ? 1 : ctx.occasion !== "gym" && p.formality - target > 0 && p.formality - target <= 1.5 ? 0.75 : 0);
    return [clamp((o.core.reduce((a, p) => a + suits(p), 0) / o.core.length) * 2 - 1), null];
  },
  style_clash(o, ctx, { pairs = [] }) {
    const present = new Set(o.core.flatMap((p) => p.styles));
    for (const [a, b] of pairs) if (present.has(a) && present.has(b)) return [-1, `${cap(a)} and ${b} pieces clash`];
    return NONE;
  },
  consistent_style(o) {
    if (o.core.length < 3) return NONE;
    const shared = o.core[0].styles.filter((s) => o.core.every((p) => p.styles.includes(s)));
    return shared.length ? [1, `A consistent ${[...new Set(shared)].sort()[0]} look`] : [0, null];
  },
  proportions(o, ctx) {
    const h = o.hero, b = o.bottom;
    if (!(h && b) || h.volume == null || b.volume == null || ctx.occasion === "gym") return NONE;
    const top = h.volume, bottom = b.volume;
    if (top >= 1 && bottom <= 0) return [1, `${cap(h.fit)} top balanced by ${b.fit} ${b.category}`];
    if (top <= -1 && bottom >= 1) return [0.8, `Fitted top with ${b.fit} ${b.category}`];
    if (top >= 2 && bottom >= 2) {
      const street = o.core.some((p) => p.styles.includes("streetwear"));
      const relaxed = [null, undefined, "casual", "night"].includes(ctx.occasion);
      return street && relaxed ? [0.3, "Relaxed streetwear proportions"] : [-1, "Roomy top and roomy bottom: shapeless"];
    }
    if (top <= -1 && bottom <= -1) return [0.4, null];
    return [0, null];
  },
  statement_limit(o, ctx, { limit = 1 }) {
    const loud = o.pieces.filter((p) => V.statement_tags.some((t) => p.tags.has(t)));
    if (!loud.length) return NONE;
    return loud.length <= limit ? [0.5, null] : [clamp(-(loud.length - limit) * 0.7), "More than one statement piece"];
  },
  pattern_mixing(o) {
    const patterned = o.pieces.filter((p) => V.pattern_tags.some((t) => p.tags.has(t)));
    if (!patterned.length) return NONE;
    return patterned.length === 1 ? [0.3, null] : [clamp(-0.5 * (patterned.length - 1)), "Several patterns at once"];
  },
  denim_on_denim(o) {
    if (!(o.bottom && o.bottom.category === "jeans")) return NONE;
    const isDenim = (p) => p.colour === "denim" || p.has("denim");
    if (!o.tops.some(isDenim)) return NONE;
    const denim = [...o.tops, o.bottom].filter((p) => isDenim(p) || p.category === "jeans");
    if (denim.length >= 3) return [-1, "Denim from head to toe"];
    return new Set(denim.map((p) => p.colour)).size > 1 ? [-0.2, "Denim on denim, different washes"] : [-0.8, "Denim on denim in the same wash"];
  },
  shoe_formality(o, ctx) {
    const s = o.shoes;
    if (!s) return NONE;
    const casualBits = o.core.filter((p) => ["joggers", "shorts", "hoodie", "zip-hoodie", "sweatshirt", "track-pants"].includes(p.category));
    const tie = o.find("tie").length > 0;
    const tailored = tie || isSuit(o);
    if (s.category === "dress-shoes" && casualBits.length && !s.has("loafers")) return [-1, `Dress shoes with ${casualBits[0].category}`];
    if (["sneakers", "training-shoes"].includes(s.category) && tailored) return [["event", "work"].includes(ctx.occasion) || tie ? -1 : -0.4, "Sneakers with tailoring"];
    if (s.category === "training-shoes" && ctx.occasion !== "gym") return [-0.5, "Training shoes outside the gym"];
    if (["dress-shoes", "boots"].includes(s.category) && o.bottom && o.bottom.formality >= 2) return [0.6, null];
    return [0, null];
  },
  belt_matches_shoes(o) {
    const belts = o.find("belt"), s = o.shoes;
    if (!belts.length || !s || !(["dress-shoes", "boots"].includes(s.category) || s.has("leather", "suede"))) return NONE;
    const a = V.leather_family[belts[0].colour], b = V.leather_family[s.colour];
    if (!a || !b) return NONE;
    const pair = `${cap(belts[0].colour)} belt with ${s.colour} shoes`;
    return a === b ? [1, pair] : [-1, pair];
  },
  tie_rules(o) {
    if (!o.find("tie").length) return NONE;
    if (!(o.base && o.base.category === "shirt")) return [-1, "A tie needs a collared shirt"];
    if (o.bottom && ["shorts", "joggers", "track-pants"].includes(o.bottom.category)) return [-1, `Tie with ${o.bottom.category}`];
    if (o.mid && ["hoodie", "zip-hoodie", "sweatshirt"].includes(o.mid.category)) return [-1, "Tie under a hoodie"];
    return [0.6, null];
  },
  suit_rules(o, ctx) {
    if (!isSuit(o)) return NONE;
    const scores = [];
    let note = "A proper suit";
    if (o.base && o.base.category === "tshirt" && !o.mid) {
      scores.push(["work", "event"].includes(ctx.occasion) ? -0.8 : 0);
      note = "T-shirt under a suit is casual";
    } else scores.push(1);
    if (o.shoes) scores.push(["dress-shoes", "boots"].includes(o.shoes.category) ? 1 : -0.7);
    return [mean(scores), note];
  },
  outerwear_match(o) {
    const out = o.outer, under = o.core.filter((p) => p !== out);
    if (!out || !under.length) return NONE;
    const f = mean(under.map((p) => p.formality));
    if (["puffer", "rain"].includes(out.category) && f >= 2.8) return [-0.8, `A ${out.category} over a dressy outfit`];
    if (out.category === "coat" && f >= 2.3) return [0.8, "A coat that suits the outfit"];
    if (out.category === "jacket" && out.has("blazer") && o.mid && ["hoodie", "zip-hoodie"].includes(o.mid.category)) return [-0.3, "Blazer over a hoodie"];
    return [0, null];
  },
  metals(o) {
    const m = new Set(o.extras.flatMap((p) => ["gold", "silver"].filter((t) => p.tags.has(t))));
    if (m.size > 1) return [-0.5, "Gold and silver mixed"];
    return m.size ? [0.2, null] : NONE;
  },
  warmth_for_weather(o, ctx) {
    if (ctx.feels == null || !o.tops.length) return NONE;
    const have = o.tops.reduce((a, p) => a + p.warmth, 0);
    const gap = have - wantedWarmth(ctx.feels) - (ctx.offset || 0);
    if (Math.abs(gap) <= 1) return [1, null];
    return [clamp(1 - Math.abs(gap) / 2.5), `${gap > 0 ? "Too warm" : "Not warm enough"} for ${pyRound(ctx.feels)}°C`];
  },
  shorts_weather(o, ctx) {
    const b = o.bottom;
    if (ctx.feels == null || !b) return NONE;
    const shorts = ["shorts", "gym-shorts"].includes(b.category);
    if (shorts && ctx.feels < 17) return [ctx.occasion === "gym" ? -0.4 : -1, `Shorts at ${pyRound(ctx.feels)}°C`];
    if (shorts && ctx.feels >= 23) return [0.6, "Shorts weather"];
    if (!shorts && ctx.feels >= 28 && [null, undefined, "casual"].includes(ctx.occasion)) return [-0.3, null];
    return NONE;
  },
  rain_ready(o, ctx) {
    if (!ctx.wet) return NONE;
    let s = 0;
    if (o.outer) s += o.outer.category === "rain" || o.outer.has("waterproof") ? 1 : 0.3;
    else s -= 0.6;
    if (o.shoes && (o.shoes.has("suede") || (o.shoes.category === "sneakers" && ["white", "cream"].includes(o.shoes.colour)))) s -= 0.6;
    return [clamp(s), null];
  },
  fabric_season(o, ctx) {
    if (ctx.feels == null) return NONE;
    const light = o.pieces.filter((p) => p.has("linen", "seersucker"));
    const heavy = o.pieces.filter((p) => p.has("tweed", "flannel", "corduroy", "fleece"));
    if (!light.length && !heavy.length) return NONE;
    let s = 0;
    if (light.length) s += ctx.feels >= 22 ? 0.8 : ctx.feels < 14 ? -0.8 : 0;
    if (heavy.length) s += ctx.feels < 12 ? 0.6 : ctx.feels >= 22 ? -0.8 : 0;
    return [clamp(s), s > 0 ? "Fabrics suit the season" : s < 0 ? "Fabric weight doesn't suit the weather" : null];
  },
  gym_kit(o, ctx) {
    if (ctx.occasion !== "gym" || !o.core.length) return NONE;
    const share = o.core.filter((p) => p.styles.includes("sporty")).length / o.core.length;
    return [clamp(share * 2 - 1), share >= 0.8 ? null : "Not all of it is made for training"];
  },
};

export function wantedWarmth(feels) {
  return feels >= 24 ? 1 : feels >= 19 ? 2.5 : feels >= 14 ? 3.5 : feels >= 8 ? 6 : feels >= 2 ? 8 : 9.5;
}
// Jacket and trousers of one suit: both tagged suit, or the same colour and cloth and both dressy.
export function isSuit(o) {
  const j = o.outer, t = o.bottom;
  if (!(j && t && j.category === "jacket" && t.category === "trousers")) return false;
  if (j.has("suit") && t.has("suit")) return true;
  const cloth = (p) => new Set(V.material_tags.filter((m) => p.tags.has(m)));
  return j.colour === t.colour && sameSet(cloth(j), cloth(t)) && j.formality >= 3 && t.formality >= 3;
}

/* ---------- Judging ---------- */
// ctx: { occasion, feels, wet, offset }. Anything left out is simply not judged.
// Returns the rules that apply: [{ rule, score, note, points }], points being weight × score.
export function evaluate(outfit, ctx = {}) {
  const out = [];
  for (const rule of B?.rules || []) {
    const fn = CHECKS[rule.check];
    if (!fn) continue;
    if (rule.occasions?.length && !rule.occasions.includes(ctx.occasion)) continue;
    const [score, note] = fn(outfit, ctx, rule.params || {});
    if (score != null) out.push({ rule, score, note, points: rule.weight * score });
  }
  return out;
}
// items: app pieces (or an outfit already built). `ignore`: rules the caller scores itself; they
// are left out of the points but still count as violations when badly broken.
export function judge(items, ctx = {}, ignore = []) {
  if (!B) return null;
  const o = Array.isArray(items) ? outfitFrom(items) : items;
  const all = evaluate(o, ctx);
  const logit = all.filter((r) => !ignore.includes(r.rule.id)).reduce((a, r) => a + r.points, 0);
  const violations = all.filter((r) => r.rule.weight >= HARD_WEIGHT && r.score <= HARD_SCORE).sort((a, b) => a.points - b.points);
  return {
    results: all, logit, prob: sigmoid(B.model.bias + logit), violations,
    // What speaks for the outfit, strongest first.
    praise: all.filter((r) => r.note && r.points > 0.3).sort((a, b) => b.points - a.points).map((r) => r.note),
  };
}
// One rule's score for some pieces (null when it doesn't apply), e.g. ruleScore([shoes, belt], "belt-shoes").
export function ruleScore(items, ruleId, ctx = {}) {
  return evaluate(outfitFrom(items), ctx).find((r) => r.rule.id === ruleId)?.score ?? null;
}
// "Brown belt with black shoes" (or the rule's name) for each broken rule.
export const explain = (violations) => violations.map((v) => v.note || v.rule.title);

/* ---------- Tips: BM25 search over the bible's tips (fashion-model/fashion/knowledge.py) ---------- */
const STOP = new Set(`a an the and or but of to in on at for with without from by is are be it its this that these those you your
your's yours as if so not no never always than then very can could should would will just more most less much many one two
up out over under into about when what which who how all any each every some such them they their there here do does don't
wear wearing worn look looks`.split(/\s+/));
const meaningful = (text) => words(text).filter((w) => !STOP.has(w) && w.length > 1);
export function stem(w) {
  if (w.endsWith("er") && w.length >= 6) return w.slice(0, -2);
  for (const end of ["ing", "ed", "es", "s"]) if (w.endsWith(end) && w.length - end.length >= 3) return w.slice(0, -end.length);
  return w;
}

class Search {
  constructor(tips, k1 = 1.4, b = 0.75) {
    this.tips = tips;
    this.k1 = k1;
    this.b = b;
    this.docs = tips.map((t) => meaningful([t.text, t.why || "", ...(t.topics || []), ...(t.occasions || [])].join(" ")).map(stem));
    this.avg = this.docs.reduce((a, d) => a + d.length, 0) / Math.max(1, this.docs.length);
    const df = new Map();
    for (const d of this.docs) for (const w of new Set(d)) df.set(w, (df.get(w) || 0) + 1);
    const n = this.docs.length;
    this.idf = new Map([...df].map(([w, f]) => [w, Math.log(1 + (n - f + 0.5) / (f + 0.5))]));
  }
  find(query, k = 5, occasion = null) {
    const q = meaningful(query).map(stem);
    const scored = [];
    this.tips.forEach((t, i) => {
      const d = this.docs[i], tf = new Map();
      for (const w of d) tf.set(w, (tf.get(w) || 0) + 1);
      let s = 0;
      for (const w of q) {
        const f = tf.get(w) || 0;
        s += (this.idf.get(w) || 0) * f * (this.k1 + 1) / (f + this.k1 * (1 - this.b + this.b * d.length / this.avg));
      }
      if (occasion && (t.occasions || []).includes(occasion)) s += 1;
      if (s > 0) scored.push([s * (0.7 + 0.3 * (t.rank ?? 1)), t]);
    });
    return scored.sort((a, b) => b[0] - a[0]).slice(0, k).map(([, t]) => t);
  }
}
export function tips(query, k = 5, occasion = null) {
  if (!B) return [];
  search ||= new Search(B.tips);
  return search.find(query, k, occasion);
}

/* ---------- For the AI stylist ---------- */
// The rules every outfit must follow (the ones that matter most) and the few tips that answer
// this question, ready for the start of a prompt. About 400 tokens.
export function guideText({ question = "", occasion = null, extra = "", k = 8 } = {}) {
  if (!B) return "";
  const rules = [...B.rules].filter((r) => r.weight >= HARD_WEIGHT).sort((a, b) => b.weight - a.weight).map((r) => `- ${r.title}.`);
  const picked = tips(`${question} ${extra}`, k * 2, occasion).filter((t) => t.strength !== "opinion").slice(0, k);
  return [
    "STYLE GUIDE (mandatory). Every outfit you suggest must follow these rules, most important first:",
    ...rules,
    ...(picked.length ? ["Advice that applies to this question:", ...picked.map((t) => `- ${t.text}`)] : []),
  ].join("\n");
}
