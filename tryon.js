// Try-on: the avatar on the home screen, drawn from four sides for free by FLUX.2 [klein] 4B on
// Cloudflare Workers AI (POST /api/ai/image on the Worker). The Workers Free plan includes 10,000
// "neurons" a day, about 50 of these pictures; past that Cloudflare refuses until 00:00 UTC and
// never charges.
//
// - Save Body draws a reference sheet of you once: front, right, back and left, in plain grey
//   athletic wear on the dark studio background of the app.
// - An outfit is drawn on those four pictures, one angle at a time: the front first, then the
//   other three (each also sees the dressed front, so the four agree with each other).
// - Every picture is kept on the server under a hash of (body + pieces + angle), so a combination
//   is never paid for, or waited for, twice, and every device shares them.
// - A small queue runs two pictures at a time, the one you're looking at first. Pictures nobody
//   wants any more (after "New ideas") are dropped before they cost anything.
//
// The app passes in how to reach the server (see init); this file knows nothing of the
// rest of the wardrobe.

export const ANGLES = ["front", "right", "back", "left"]; // in turning order: drag right and he turns to face right
export const ANGLE_LABEL = { front: "Front", right: "Right side", back: "Back", left: "Left side" };
const VERSION = 2; // part of every key: raise it when the prompts change enough to draw everything again
export const FREE_A_DAY = 50; // pictures Cloudflare's free daily neurons pay for, roughly (about 180 neurons each)
const SIZE = { width: 768, height: 1152 }; // 2:3, six 512 px tiles
const REF = 512; // reference pictures must fit in 512 x 512
const MAX_AT_ONCE = 2;
const STUDIO = "#141413";

let io = null; // { post, server, me, budget, onChange }; post(form) sends a picture request to the Worker
export function init(deps) { io = deps; }

/* ---------- keys ---------- */
// 64-bit string hash (two 32-bit FNV-style lanes), as 16 hex characters.
export function hash(s) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}
const keyOf = (...parts) => `tryon-${hash([VERSION, ...parts].join("|"))}.jpg`;

/* ---------- the body ---------- */
export const BODY_DEFAULT = { height: 178, weight: 2, build: 2, skin: 1, hair: 0 };
export const WEIGHTS = ["Slim", "Lean", "Average", "Solid", "Heavy"];
export const BUILDS = ["Soft", "Average", "Fit", "Athletic", "Muscular"];
export const SKINS = [
  { hex: "#f2cfb1", words: "very fair skin" },
  { hex: "#e3b18f", words: "fair skin" },
  { hex: "#c88f6b", words: "light olive skin" },
  { hex: "#a66e4e", words: "warm tan brown skin" },
  { hex: "#7b4b33", words: "brown skin" },
  { hex: "#4e3023", words: "deep dark brown skin" },
];
export const HAIRS = [
  { hex: "#17110d", words: "short black hair" },
  { hex: "#3a2618", words: "short dark brown hair" },
  { hex: "#6e4a2e", words: "short brown hair" },
  { hex: "#b08a58", words: "short dark blonde hair" },
  { hex: "#8b8682", words: "short grey hair" },
  { hex: null, words: "a shaved head", label: "Shaved" },
];
const WEIGHT_WORDS = ["slim, light frame", "lean", "average weight", "solid, a little heavier set", "heavy-set, broad and full-bodied"];
const BUILD_WORDS = ["soft, untrained", "average, lightly toned", "fit and toned", "athletic, visibly muscular shoulders and arms", "very muscular, gym-built"];

export const cleanBody = (b = {}) => ({
  height: Math.min(200, Math.max(160, Math.round(+b.height || BODY_DEFAULT.height))),
  weight: Math.min(4, Math.max(0, Math.round(+(b.weight ?? BODY_DEFAULT.weight)))),
  build: Math.min(4, Math.max(0, Math.round(+(b.build ?? BODY_DEFAULT.build)))),
  skin: Math.min(SKINS.length - 1, Math.max(0, Math.round(+(b.skin ?? BODY_DEFAULT.skin)))),
  hair: Math.min(HAIRS.length - 1, Math.max(0, Math.round(+(b.hair ?? BODY_DEFAULT.hair)))),
  ...(b.age >= 16 && b.age <= 90 ? { age: Math.round(b.age) } : {}),
});
export const avatarId = (body) => hash(JSON.stringify(cleanBody(body))).slice(0, 12);
export const bodyLine = (b) => `${b.height} cm · ${WEIGHTS[b.weight].toLowerCase()} · ${BUILDS[b.build].toLowerCase()}`;

const FRAMING = `Full body from the top of the head to the shoes, with a little space above and below, centred, camera at chest height, 50 mm lens. Seamless dark studio backdrop and floor, flat colour ${STUDIO} (very dark warm charcoal), soft even front light, a faint rim light, a soft shadow at his feet. Photorealistic, natural skin. No text, no logos added, no watermark, no props.`;
const VIEW = {
  front: "facing the camera, looking straight ahead",
  right: "turned 90 degrees so he faces the right edge of the picture: a clean side profile showing his right side",
  back: "turned around, seen straight from behind: his back and the back of his head face the camera",
  left: "turned 90 degrees so he faces the left edge of the picture: a clean side profile showing his left side",
};

function basePrompt(body, angle) {
  const who = `one man, about ${body.age || 28} years old, ${body.height} cm tall, ${WEIGHT_WORDS[body.weight]}, ${BUILD_WORDS[body.build]} build, ${SKINS[body.skin].words}, ${HAIRS[body.hair].words}, clean-shaven`;
  if (angle === "front") {
    return `Studio reference photo of ${who}. He stands straight in a relaxed neutral pose, arms hanging naturally a little away from the body, feet hip-width apart, ${VIEW.front}. He wears plain fitted mid-grey athletic wear: a crew-neck T-shirt, shorts to just above the knee, plain white low socks and plain light grey trainers. ${FRAMING}`;
  }
  return `Image 0 shows a man in a studio and image 1 a close-up of his head and shoulders. Show the same man ${VIEW[angle]}. Keep exactly the same person: face, hair, skin tone, body shape, height and proportions, the same plain grey athletic wear and trainers, the same relaxed pose with arms down, the same lighting, camera distance and scale in the frame. ${FRAMING}`;
}

/* ---------- outfits ---------- */
// `pieces`: what he wears, outermost first: { role, id, photo (a key for the photo, so a new photo
// draws again), name, kind, fit, colors, front: Blob, back: Blob | null }.
const ORDER = ["coat", "outer", "mid", "base", "bottom", "shoes"];
export const sortPieces = (pieces) => [...pieces].sort((a, b) => ORDER.indexOf(a.role) - ORDER.indexOf(b.role));
export function comboKeys(avatar, pieces) {
  const list = sortPieces(pieces);
  const sig = list.map((p) => `${p.role}:${p.id}:${p.photo || ""}`).join(",");
  return Object.fromEntries(ANGLES.map((a) => [a, list.length ? keyOf(avatar, sig, a) : baseKey(avatar, a)]));
}
export const baseKey = (avatar, angle) => keyOf(avatar, "base", angle);

function wornAs(p, list) {
  const has = (r) => list.some((x) => x.role === r);
  const fit = p.fit ? `${p.fit.toLowerCase()} fit, ` : "";
  switch (p.role) {
    case "coat": return `${fit}worn over everything`;
    case "outer": return `${fit}the outer layer${has("mid") || has("base") ? ", worn open so the layer underneath shows" : ""}`;
    case "mid": return `${fit}${has("outer") || has("coat") ? "worn under the jacket" : "worn on its own as the top"}${has("base") ? ", over the T-shirt or shirt" : ""}`;
    case "base": return `${fit}${has("mid") ? "worn underneath, showing a little at the neck and hem" : has("outer") || has("coat") ? "worn under the jacket" : "worn on its own as the top"}`;
    case "bottom": return `${fit}on his legs, at a natural length`;
    case "shoes": return "on his feet";
    default: return "";
  }
}
const outfitList = (list) => list.map((p, i) => `${i + 1}. ${p.name} (${p.kind}${p.colors?.length ? `, ${p.colors.join(" and ")}` : ""}): ${wornAs(p, list)}.`).join("\n");

function dressPrompt(list, angle, side) {
  const rules = `Reproduce every piece faithfully: the same colours, fabric, wash, prints, graphics, logos and details as in the clothing picture, at a believable size on his body, with natural folds for the fit. Replace the grey athletic wear and trainers completely${list.some((p) => p.role === "bottom") ? "" : " except the shorts"}${list.some((p) => p.role === "shoes") ? "" : " except the trainers"}. Keep the same man (face, hair, skin, body), the same pose, angle, framing, lighting and the dark ${STUDIO} background. ${FRAMING}`;
  const pieces = `The numbered pieces:\n${outfitList(list)}`;
  if (angle === "front") return `Image 0 is a man in a studio, image 2 a close-up of his face. Image 1 shows clothing pieces, numbered. Dress the man of image 0 in exactly these pieces, ${VIEW.front}.\n${pieces}\n${rules}`;
  return `Image 0 is a man in a studio, ${VIEW[angle]}. Image 1 is the same man from the front, already dressed in the outfit. Image 2 shows the pieces ${side === "back" ? "from the back" : "laid flat"}, numbered. Image 3 is a close-up of his face. Draw image 0's view (${VIEW[angle]}) with him wearing exactly the outfit of image 1, matching it piece by piece.\n${pieces}\n${rules}`;
}

// The pieces side by side on white, numbered, in one reference picture (at most 512 x 512).
async function collage(list, side) {
  const cols = Math.min(3, list.length), rows = Math.ceil(list.length / cols);
  const tw = Math.floor(REF / cols), th = Math.min(Math.floor(tw * 1.2), Math.floor(REF / rows));
  const c = Object.assign(document.createElement("canvas"), { width: cols * tw, height: rows * th });
  const g = c.getContext("2d");
  g.fillStyle = "#fff";
  g.fillRect(0, 0, c.width, c.height);
  for (const [i, p] of list.entries()) {
    const src = (side === "back" && p.back) || p.front;
    const x = (i % cols) * tw, y = Math.floor(i / cols) * th;
    if (src) {
      const bmp = await createImageBitmap(src);
      const s = Math.min((tw - 24) / bmp.width, (th - 24) / bmp.height);
      g.drawImage(bmp, x + (tw - bmp.width * s) / 2, y + (th - bmp.height * s) / 2, bmp.width * s, bmp.height * s);
      bmp.close?.();
    }
    g.fillStyle = "#111";
    g.beginPath(); g.arc(x + 16, y + 16, 12, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#fff"; g.font = "bold 15px sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(i + 1), x + 16, y + 17);
  }
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.88));
}
// A picture made to fit in 512 x 512 for the model; `head`: only his head and shoulders (the top
// of a full-body picture), so his face keeps its detail at that size.
async function ref(blob, head = false) {
  const bmp = await createImageBitmap(blob);
  const sx = head ? bmp.width * 0.18 : 0, sy = 0, sw = head ? bmp.width * 0.64 : bmp.width, sh = head ? bmp.height * 0.36 : bmp.height;
  const s = Math.min(1, REF / sw, REF / sh);
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(sw * s), height: Math.round(sh * s) });
  c.getContext("2d").drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  bmp.close?.();
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
}
const seedOf = (avatar) => parseInt(avatar.slice(0, 8), 16) % 2147483647; // the same seed for all of one body's pictures

/* ---------- what to draw ---------- */
// A spec says how to get one picture: its key, the pictures it's drawn from, and the request.
export function baseSpec(avatar, body, angle) {
  const front = angle === "front" ? null : baseSpec(avatar, body, "front");
  return {
    key: baseKey(avatar, angle), angle, what: "base",
    deps: front ? [front] : [],
    request: async ([f]) => ({ prompt: basePrompt(body, angle), images: f ? [await ref(f), await ref(f, true)] : [], seed: seedOf(avatar) }),
  };
}
export function outfitSpec(avatar, body, pieces, angle) {
  const list = sortPieces(pieces);
  if (!list.length) return baseSpec(avatar, body, angle);
  const keys = comboKeys(avatar, list);
  const front = angle === "front" ? null : outfitSpec(avatar, body, list, "front");
  const side = angle === "back" ? "back" : "front";
  return {
    key: keys[angle], angle, what: "outfit",
    deps: [baseSpec(avatar, body, angle), ...(front ? [front, baseSpec(avatar, body, "front")] : [])],
    request: async ([base, dressed, baseFront]) => ({
      prompt: dressPrompt(list, angle, side),
      images: dressed
        ? [await ref(base), await ref(dressed), await collage(list, side), await ref(baseFront, true)]
        : [await ref(base), await collage(list, side), await ref(base, true)],
      seed: seedOf(avatar),
    }),
  };
}

/* ---------- pictures we have ---------- */
const pics = new Map(); // key → object URL
const blobs = new Map(); // key → Blob (inputs for the next pictures)
export const url = (key) => pics.get(key) || null;
function keep(key, blob) {
  blobs.set(key, blob);
  if (!pics.has(key)) pics.set(key, URL.createObjectURL(blob));
  return blob;
}
async function fromServer(key) {
  if (!io.server()) return null;
  try {
    const r = await fetch(`api/blob/${key}`);
    return r.ok ? await r.blob() : null;
  } catch { return null; }
}
async function toServer(key, blob) {
  if (!io.server()) return;
  try { await fetch(`api/blob/${key}`, { method: "PUT", body: blob, headers: { "Content-Type": "image/jpeg" } }); } catch { /* kept on this device for now */ }
}
// Another device drawing the same picture right now: it leaves a note for ten minutes.
async function lockedByOther(key) {
  if (!io.server()) return false;
  try {
    const r = await fetch(`api/cache?kind=tryon&q=${encodeURIComponent(key)}`, { cache: "no-store" });
    const j = r.ok ? await r.json() : null;
    return !!(j?.data && j.data.by !== io.me);
  } catch { return false; }
}
function lock(key) {
  if (!io.server()) return;
  fetch("api/cache", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "tryon", q: key, data: { by: io.me } }) }).catch(() => {});
}

/* ---------- the queue ---------- */
const jobs = new Map(); // key → { key, prio, background, state: checking|waiting|queued|making|done|error, error, promise }
const line = []; // jobs waiting for a turn: { job, go, stop }
let busy = 0;
export let halted = null; // an error that stops everything (no image model, or the free pictures used up) until resume()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const changed = (key) => io?.onChange?.(key);

export function state(key) {
  if (pics.has(key)) return "ready";
  return jobs.get(key)?.state || "none";
}
export const errorOf = (key) => jobs.get(key)?.error || null;

function stillHalted() {
  if (halted?.until && Date.now() >= halted.until) halted = null; // a new day: Cloudflare's free pictures are back
  return halted;
}
function turn(job) {
  if (stillHalted()) return Promise.reject(halted);
  return new Promise((go, stop) => { line.push({ job, go, stop }); pump(); });
}
function pump() {
  line.sort((a, b) => a.job.prio - b.job.prio);
  while (busy < MAX_AT_ONCE && line.length) {
    const w = line.shift();
    if (w.job.cancelled) { w.stop(Object.assign(new Error("Not needed any more"), { cancelled: true })); continue; }
    if (halted) { w.stop(halted); continue; }
    busy++;
    w.go();
  }
}
const done = () => { busy--; pump(); };

// Get one picture: from memory, the server, or drawn. `prio`: lower goes first.
// `background`: nobody is looking at it yet (it counts against the daily limit first).
export function want(spec, prio = 5, background = true) {
  if (blobs.has(spec.key)) return Promise.resolve(blobs.get(spec.key));
  let job = jobs.get(spec.key);
  // A picture that failed isn't asked for again by itself (it would cost each time): Try again does that.
  if (job?.state === "error" && !(job.error?.capped && !stillHalted() && io.budget.ok(background))) return job.promise;
  if (job && job.state !== "error") {
    job.prio = Math.min(job.prio, prio);
    job.background &&= background;
    job.cancelled = false;
    spec.deps.forEach((d) => want(d, job.prio, job.background).catch(() => {}));
    pump();
    return job.promise;
  }
  job = { key: spec.key, prio, background, state: "checking" };
  jobs.set(spec.key, job);
  job.promise = (async () => {
    try {
      const have = await fromServer(spec.key);
      if (have) return keep(spec.key, have);
      job.state = "waiting"; changed(spec.key);
      const inputs = await Promise.all(spec.deps.map((d) => want(d, job.prio, job.background)));
      job.state = "queued"; changed(spec.key);
      await turn(job);
      let holding = true;
      try {
        if (await lockedByOther(spec.key)) {
          // Wait for the other device's picture (up to four minutes), then draw it here if it never came.
          done(); holding = false;
          job.state = "waiting"; changed(spec.key);
          for (let t = 0; t < 40; t++) {
            await sleep(6000);
            const b = await fromServer(spec.key);
            if (b) return keep(spec.key, b);
          }
          await turn(job); holding = true;
        }
        if (!io.budget.ok(job.background)) throw Object.assign(new Error(io.budget.why()), { capped: true });
        job.state = "making"; changed(spec.key);
        lock(spec.key);
        const req = await spec.request(inputs);
        const out = await draw(req);
        io.budget.spend();
        keep(spec.key, out);
        await toServer(spec.key, out);
        return out;
      } finally { if (holding) done(); }
    } catch (e) {
      job.state = "error"; job.error = e;
      throw e;
    } finally {
      if (job.state !== "error" || job.error?.cancelled) jobs.delete(spec.key);
      changed(spec.key);
    }
  })();
  job.promise.catch(() => {});
  return job.promise;
}
// Drop the pictures still waiting that nobody wants any more (the ideas changed).
export function keepOnly(keys) {
  const wanted = new Set(keys);
  for (const job of jobs.values()) {
    if (!wanted.has(job.key) && ["checking", "waiting", "queued"].includes(job.state)) job.cancelled = true;
  }
  pump();
}
export function resume() {
  halted = null;
  for (const [k, job] of jobs) if (job.state === "error") jobs.delete(k);
  changed(null);
}

/* ---------- drawing (Cloudflare Workers AI, free) ---------- */
function b64Blob(b64) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const type = b64.startsWith("iVBOR") ? "image/png" : b64.startsWith("UklGR") ? "image/webp" : "image/jpeg";
  return new Blob([bytes], { type });
}
// What comes back, as a JPEG of at most 1248 px high (it fits the server's photo store).
async function asJpeg(blob) {
  const bmp = await createImageBitmap(blob);
  const s = Math.min(1, 1248 / bmp.height);
  const c = Object.assign(document.createElement("canvas"), { width: Math.round(bmp.width * s), height: Math.round(bmp.height * s) });
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  return new Promise((r) => c.toBlob(r, "image/jpeg", 0.86));
}
const stop = (msg, extra = {}) => { halted = Object.assign(new Error(msg), { fatal: true }, extra); changed(null); return halted; };
// Cloudflare's free pictures come back at 00:00 UTC.
function nextReset() {
  const d = new Date();
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}
export const resetTime = () => new Date(nextReset()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

async function draw({ prompt, images, seed }) {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("width", String(SIZE.width));
  form.append("height", String(SIZE.height));
  if (seed != null) form.append("seed", String(seed));
  images.forEach((img, i) => form.append(`input_image_${i}`, img, `image${i}.jpg`));
  for (let tries = 0; ; tries++) {
    let r, j;
    try {
      r = await io.post(form);
      j = await r.json().catch(() => ({}));
    } catch {
      if (tries >= 2) throw new Error("Couldn't reach your server. Check the internet connection.");
      await sleep(4000);
      continue;
    }
    if (r.ok && j.image) return asJpeg(b64Blob(j.image));
    if (j.limit) {
      const at = nextReset();
      throw stop(`Today's free pictures from Cloudflare are used up (about ${FREE_A_DAY} a day for all devices). More from ${resetTime()}, and nothing is ever charged.`, { capped: true, until: at });
    }
    if (r.status === 404) throw stop(j.error || "The server can't draw pictures yet.");
    if ((r.status >= 500 || r.status === 429) && tries < 2) { await sleep((tries + 1) * 5000); continue; }
    throw new Error(j.error ? `Couldn't draw it: ${j.error}` : `Couldn't draw it (error ${r.status}).`);
  }
}

/* ---------- the turntable ---------- */
// Drag across `el` to turn him; the four pictures cross-fade as he turns. `get()` / `set(n)`:
// the angle shown (0 front, 1 right, 2 back, 3 left); `paint(pos)` draws a position between two.
export function turntable(el, { get, set, paint }) {
  let start = null;
  const step = () => Math.max(90, el.clientWidth * 0.45); // pixels of drag per quarter turn
  el.addEventListener("pointerdown", (e) => {
    if (e.button > 0) return;
    start = { x: e.clientX, y: e.clientY, a: get(), id: e.pointerId, moved: false };
  });
  el.addEventListener("pointermove", (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = e.clientX - start.x;
    if (!start.moved) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(e.clientY - start.y) > Math.abs(dx)) { start = null; return; } // scrolling the page
      start.moved = true;
      el.setPointerCapture?.(e.pointerId);
      el.classList.add("turning");
    }
    paint(start.a + dx / step());
  });
  const end = (e) => {
    if (!start || e.pointerId !== start.id) return;
    const moved = start.moved, pos = start.a + (e.clientX - start.x) / step();
    start = null;
    el.classList.remove("turning");
    if (moved) set(((Math.round(pos) % 4) + 4) % 4);
  };
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
  el.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") { set((get() + 1) % 4); e.preventDefault(); }
    if (e.key === "ArrowLeft") { set((get() + 3) % 4); e.preventDefault(); }
  });
}
// How visible each of the four pictures is at a position between them (0…4, wrapping).
export function weights(pos) {
  return ANGLES.map((_, i) => {
    let d = Math.abs((((pos - i) % 4) + 4) % 4);
    if (d > 2) d = 4 - d;
    return Math.max(0, 1 - d);
  });
}
