// Smart Wardrobe on Cloudflare Workers: the same sync API as server.py, kept in a D1
// database, plus a pass-through to Gemini and Claude so API keys never reach a device.
// The app's files are served from the assets in this repository (wrangler.jsonc), but
// only after you sign in with the password.
//
//     GET  /login, POST /login, GET /logout   the password page
//     GET  /api/ping                      {"ok": true, "rev": n, "sync": bool, "keys": {...}}
//     GET  /api/changes?since=r&wait=s    records changed after rev r; waits up to s seconds
//     POST /api/records                   {"records": [...]}, the newest updatedAt wins
//     POST /api/missing                   {"keys": [...]}, which photos the server still needs
//     HEAD/GET/PUT /api/blob/<key>        photos, stored once by content hash
//     POST /api/ai/gemini/<model>         Gemini generateContent with the GEMINI_KEY secret
//     POST /api/ai/claude/v1/messages     Claude Messages API with the CLAUDE_KEY secret
//     GET  /api/page?url=…                a shop's product page: {url, title, image, price, site}
//     POST /api/calendar                  {"url": "..."}: reads a calendar's private iCal link
//
// Settings (see README, "Putting it online"):
//     DB            D1 database binding, created on the first deploy (wrangler.jsonc)
//     APP_PASSWORD  secret: the password for the sign-in page. Without it nothing is served.
//     GEMINI_KEY    optional secret
//     CLAUDE_KEY    optional secret

const COLS = new Set(["items", "log", "kv"]);
const BLOB_KEY = /^[0-9a-z-]{4,80}\.(jpg|webp|png|bin)$/;
const BLOB_TYPE = { jpg: "image/jpeg", webp: "image/webp", png: "image/png", bin: "application/octet-stream" };
const MAX_BLOB = 1_900_000; // a D1 row holds up to 2 MB; photos are resized to 1100 px, far below that
const MAX_BODY = 25 * 1024 * 1024;
const PUBLIC = new Set(["/manifest.webmanifest", "/icon.svg"]); // browsers fetch these without cookies
const SESSION_DAYS = 365;
const MAX_TRIES = 10; // wrong passwords per address before a 15-minute pause
const PAUSE_MS = 15 * 60_000;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const fail = (status, error) => json({ error }, status);
const redirect = (to, cookie) => new Response(null, { status: 303, headers: { Location: to, "Cache-Control": "no-store", ...(cookie ? { "Set-Cookie": cookie } : {}) } });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (PUBLIC.has(url.pathname)) return env.ASSETS.fetch(request);
    if (!env.APP_PASSWORD) return loginPage(503, "", "Almost there: add the APP_PASSWORD secret in the Worker's settings, then reload.");
    if (url.pathname === "/login") return request.method === "POST" ? login(request, env) : loginPage(200);
    if (url.pathname === "/logout") return redirect("/login", sessionCookie("", 0));
    if (!(await signedIn(request, env))) return url.pathname.startsWith("/api/") ? fail(401, "Sign in first.") : redirect("/login");
    if (url.pathname.startsWith("/api/")) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};

export async function handleApi(request, env) {
  const path = new URL(request.url).pathname.slice("/api/".length);
  const method = request.method;
  try {
    if (path.startsWith("ai/")) return await ai(request, env, path.slice(3));
    if (path === "page" && method === "GET") return await productPage(new URL(request.url).searchParams.get("url"));
    if (path === "calendar" && method === "POST") return await calendar(request);
    if (path === "ping" && method === "GET") {
      const keys = { gemini: !!env.GEMINI_KEY, claude: !!env.CLAUDE_KEY };
      if (!env.DB) return json({ ok: true, sync: false, rev: 0, keys });
      return json({ ok: true, sync: true, rev: await currentRev(env.DB), keys });
    }
    if (!env.DB) return fail(404, "No database is bound to this deployment.");
    await ready(env.DB);
    if (path === "changes" && method === "GET") return await changes(env.DB, new URL(request.url).searchParams);
    if (path === "records" && method === "POST") return await putRecords(env.DB, await readJson(request));
    if (path === "missing" && method === "POST") {
      const keys = ((await readJson(request)).keys || []).filter((k) => typeof k === "string" && BLOB_KEY.test(k));
      const have = await existingBlobs(env.DB, keys);
      return json({ missing: keys.filter((k) => !have.has(k)) });
    }
    if (path.startsWith("blob/")) return await blob(request, env.DB, path.slice(5));
    return fail(404, "Not found");
  } catch (e) {
    return fail(e.status || 500, e.status ? e.message : "Server error");
  }
}

/* ---------- Sign-in (one password, kept as a Cloudflare secret) ---------- */

// A session is "<expiry>.<signature>", signed with a key made from the password, so changing
// the password signs every device out.
const enc = new TextEncoder();
const hmacKey = (secret) => crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const fromHex = (hex) => new Uint8Array((hex.match(/../g) || []).map((h) => parseInt(h, 16)));
const sessionCookie = (value, maxAge) => `wardrobe_session=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

async function signedIn(request, env) {
  const m = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)wardrobe_session=(\d+)\.([0-9a-f]{64})(?:;|$)/);
  if (!m || Number(m[1]) < Date.now()) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(`session:${env.APP_PASSWORD}`), fromHex(m[2]), enc.encode(m[1]));
}

async function login(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "local";
  const db = env.DB;
  if (db) {
    await ready(db);
    const row = await db.prepare("SELECT n, at FROM login_fails WHERE ip = ?").bind(ip).first();
    if (row && row.n >= MAX_TRIES && Date.now() - row.at < PAUSE_MS) return loginPage(429, "", "Too many wrong passwords. Try again in 15 minutes.");
  }
  const given = String((await request.formData().catch(() => null))?.get("password") || "");
  // Compare signatures instead of the strings themselves, so the time taken gives nothing away.
  const k = await hmacKey("password-check");
  const ok = await crypto.subtle.verify("HMAC", k, await crypto.subtle.sign("HMAC", k, enc.encode(env.APP_PASSWORD)), enc.encode(given));
  if (!ok) {
    if (db) {
      await db.prepare(`INSERT INTO login_fails (ip, n, at) VALUES (?1, 1, ?2)
        ON CONFLICT (ip) DO UPDATE SET n = CASE WHEN ?2 - at > ${PAUSE_MS} THEN 1 ELSE n + 1 END, at = ?2`).bind(ip, Date.now()).run();
    }
    await new Promise((r) => setTimeout(r, 800));
    return loginPage(401, "That password isn't right.");
  }
  if (db) await db.prepare("DELETE FROM login_fails WHERE ip = ?").bind(ip).run();
  const exp = String(Date.now() + SESSION_DAYS * 864e5);
  const sig = toHex(await crypto.subtle.sign("HMAC", await hmacKey(`session:${env.APP_PASSWORD}`), enc.encode(exp)));
  return redirect("/", sessionCookie(`${exp}.${sig}`, SESSION_DAYS * 86400));
}

function loginPage(status, error = "", note = "") {
  const esc = (t) => t.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Smart Wardrobe</title><link rel="icon" href="/icon.svg"><meta name="theme-color" content="#f4efe8">
<style>
  :root { color-scheme: light dark; --bg: #f4efe8; --card: #fffaf3; --text: #1f1a14; --muted: #6f6558; --line: #e4dbcf; --accent: #b8782e; }
  @media (prefers-color-scheme: dark) { :root { --bg: #16130f; --card: #211c17; --text: #f3ece3; --muted: #a99d8e; --line: #3a3229; } }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
  form { width: min(380px, 100%); background: var(--card); border: 1px solid var(--line); border-radius: 22px; padding: 28px; display: grid; gap: 14px; }
  h1 { margin: 0; font-size: 1.5rem; }
  p { margin: 0; color: var(--muted); }
  input { font: inherit; padding: 14px 16px; border-radius: 14px; border: 1px solid var(--line); background: var(--bg); color: var(--text); }
  button { font: inherit; font-weight: 600; padding: 14px; border: 0; border-radius: 999px; background: var(--accent); color: #fff; cursor: pointer; }
  .error { color: #c0392b; }
</style></head><body>
<form method="post" action="/login">
  <h1>Smart Wardrobe</h1>
  ${note ? `<p>${esc(note)}</p>` : `<p>Enter your password. This device then stays signed in for a year.</p>
  <input type="password" name="password" autocomplete="current-password" aria-label="Password" placeholder="Password" required autofocus>
  ${error ? `<p class="error">${esc(error)}</p>` : ""}
  <button type="submit">Open my wardrobe</button>`}
</form></body></html>`, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}

/* ---------- Sync ---------- */

let schema;
function ready(db) {
  schema ||= db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, col TEXT NOT NULL, id TEXT NOT NULL,
      rev INTEGER NOT NULL, updatedAt TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, data TEXT)`),
    db.prepare("CREATE INDEX IF NOT EXISTS records_rev ON records (rev)"),
    db.prepare("CREATE TABLE IF NOT EXISTS blobs (key TEXT PRIMARY KEY, type TEXT NOT NULL, body BLOB NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS login_fails (ip TEXT PRIMARY KEY, n INTEGER NOT NULL, at INTEGER NOT NULL)"),
  ]).catch((e) => { schema = null; throw e; });
  return schema;
}

async function currentRev(db) {
  await ready(db);
  return (await db.prepare("SELECT COALESCE(MAX(rev), 0) AS rev FROM records").first("rev")) || 0;
}

const toRecord = (r) => ({ col: r.col, id: r.id, rev: r.rev, updatedAt: r.updatedAt, deleted: !!r.deleted, data: r.data == null ? null : JSON.parse(r.data) });

async function changes(db, q) {
  const since = parseInt(q.get("since") || "0", 10) || 0;
  // Long polling: look for a change every 2 seconds, for up to 20 seconds.
  const until = Date.now() + Math.min(20, Math.max(0, parseFloat(q.get("wait") || "0") || 0)) * 1000;
  let rev = await currentRev(db);
  while (rev <= since && Date.now() + 2000 <= until) {
    await new Promise((r) => setTimeout(r, 2000));
    rev = await currentRev(db);
  }
  if (rev <= since) return json({ rev, records: [] });
  const { results } = await db.prepare("SELECT * FROM records WHERE rev > ? ORDER BY rev").bind(since).all();
  return json({ rev: results.length ? results[results.length - 1].rev : rev, records: results.map(toRecord) });
}

function blobRefs(data, out = []) {
  if (Array.isArray(data)) data.forEach((v) => blobRefs(v, out));
  else if (data && typeof data === "object") {
    if (typeof data.$blob === "string") out.push(data.$blob);
    else Object.values(data).forEach((v) => blobRefs(v, out));
  }
  return out;
}

async function existingBlobs(db, keys) {
  const have = new Set();
  const unique = [...new Set(keys)];
  for (let i = 0; i < unique.length; i += 90) {
    const part = unique.slice(i, i + 90);
    const { results } = await db.prepare(`SELECT key FROM blobs WHERE key IN (${part.map(() => "?").join(",")})`).bind(...part).all();
    results.forEach((r) => have.add(r.key));
  }
  return have;
}

async function putRecords(db, body) {
  if (!Array.isArray(body.records)) throw Object.assign(new Error("Expected records"), { status: 400 });
  const valid = body.records.filter((r) => r && COLS.has(r.col) && typeof r.id === "string" && typeof r.updatedAt === "string");
  const have = await existingBlobs(db, valid.flatMap((r) => blobRefs(r.data)));
  const missing = [], incoming = [];
  for (const r of valid) {
    const lacking = blobRefs(r.data).filter((k) => !BLOB_KEY.test(k) || !have.has(k));
    if (lacking.length) missing.push(...lacking); // the device thinks it uploaded these photos; it sends them again
    else incoming.push(r);
  }
  const keys = incoming.map((r) => `${r.col}/${r.id}`);
  const before = new Map();
  for (let i = 0; i < keys.length; i += 90) {
    const part = keys.slice(i, i + 90);
    const { results } = await db.prepare(`SELECT key, updatedAt FROM records WHERE key IN (${part.map(() => "?").join(",")})`).bind(...part).all();
    results.forEach((r) => before.set(r.key, r.updatedAt));
  }
  // One transaction. Each record gets the next rev unless the stored copy was changed more recently.
  const upsert = db.prepare(`INSERT INTO records (key, col, id, rev, updatedAt, deleted, data)
    VALUES (?1, ?2, ?3, (SELECT COALESCE(MAX(rev), 0) + 1 FROM records), ?4, ?5, ?6)
    ON CONFLICT (key) DO UPDATE SET rev = excluded.rev, updatedAt = excluded.updatedAt, deleted = excluded.deleted, data = excluded.data
    WHERE excluded.updatedAt >= records.updatedAt`);
  if (incoming.length) {
    await db.batch(incoming.map((r, k) => upsert.bind(keys[k], r.col, r.id, r.updatedAt, r.deleted ? 1 : 0, r.data == null ? null : JSON.stringify(r.data))));
  }
  const accepted = keys.filter((k, i) => !before.has(k) || before.get(k) <= incoming[i].updatedAt);
  return json({ rev: await currentRev(db), accepted, missing: [...new Set(missing)] });
}

async function blob(request, db, key) {
  if (!BLOB_KEY.test(key)) return fail(404, "Not found");
  if (request.method === "PUT") {
    const body = await request.arrayBuffer();
    if (body.byteLength > MAX_BLOB) return fail(413, "Photo too large");
    await db.prepare("INSERT OR IGNORE INTO blobs (key, type, body) VALUES (?, ?, ?)").bind(key, BLOB_TYPE[key.split(".").pop()], body).run();
    return json({ ok: true, key });
  }
  if (request.method !== "GET" && request.method !== "HEAD") return fail(405, "Method not allowed");
  const row = await db.prepare("SELECT type, body FROM blobs WHERE key = ?").bind(key).first();
  if (!row) return fail(404, "Not found");
  const bytes = new Uint8Array(row.body);
  return new Response(request.method === "HEAD" ? null : bytes, {
    headers: { "Content-Type": row.type, "Content-Length": String(bytes.byteLength), "Cache-Control": "private, max-age=31536000, immutable" },
  });
}

async function readJson(request) {
  const n = Number(request.headers.get("Content-Length") || 0);
  if (n > MAX_BODY) throw Object.assign(new Error("Too large"), { status: 413 });
  try {
    return await request.json();
  } catch {
    throw Object.assign(new Error("Expected JSON"), { status: 400 });
  }
}

/* ---------- Calendar ---------- */

// Browsers can't read a calendar feed from another site, so the Worker fetches it and passes
// it on unchanged; the app reads the events itself. Only https addresses with a real host name.
const MAX_CALENDAR = 15 * 1024 * 1024;
async function calendar(request) {
  const { url } = await readJson(request);
  let u;
  try { u = new URL(String(url || "").trim().replace(/^webcals?:\/\//i, "https://")); } catch { return fail(400, "That isn't a link."); }
  const host = u.hostname.toLowerCase();
  if (u.protocol !== "https:" || u.username || u.password || !host.includes(".") || /^[\d.]+$|:|localhost$|\.local$|\.internal$/.test(host) || host === new URL(request.url).hostname) {
    return fail(400, "Use the calendar's https:// or webcal:// link.");
  }
  let r;
  try {
    r = await fetch(u, { headers: { Accept: "text/calendar, */*" }, redirect: "follow", signal: AbortSignal.timeout(20000) });
  } catch {
    return fail(502, "The calendar didn't answer.");
  }
  if (!r.ok) return fail(502, r.status === 404 || r.status === 403 ? "The calendar link doesn't work any more. Copy it again from your calendar's settings." : `The calendar answered ${r.status}.`);
  if (Number(r.headers.get("Content-Length") || 0) > MAX_CALENDAR) return fail(413, "That calendar is too large.");
  return new Response(r.body, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "no-store" } });
}

/* ---------- AI pass-through ---------- */

async function ai(request, env, rest) {
  if (request.method !== "POST") return fail(405, "Method not allowed");
  const gemini = rest.match(/^gemini\/([a-z0-9.-]{1,60})$/);
  if (gemini) {
    if (!env.GEMINI_KEY) return fail(404, "No Gemini key is saved on the server.");
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${gemini[1]}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
      body: await request.text(),
    });
    return new Response(r.body, { status: r.status, headers: { "Content-Type": r.headers.get("Content-Type") || "application/json" } });
  }
  if (rest === "claude/v1/messages") {
    if (!env.CLAUDE_KEY) return fail(404, "No Claude key is saved on the server.");
    const headers = { "Content-Type": "application/json", "x-api-key": env.CLAUDE_KEY };
    for (const h of ["anthropic-version", "anthropic-beta"]) if (request.headers.get(h)) headers[h] = request.headers.get(h);
    const r = await fetch(`https://api.anthropic.com/v1/messages${new URL(request.url).search}`, { method: "POST", headers, body: await request.text() });
    return new Response(r.body, { status: r.status, headers: { "Content-Type": r.headers.get("Content-Type") || "application/json" } });
  }
  return fail(404, "Not found");
}

/* ---------- Product pages (Discover, "Real photos") ---------- */
// Opens a shop's product page and reads the photo, name and price it shares for link
// previews (Open Graph tags, or schema.org Product data), so the app can show real
// products. Browsers can't do this themselves: shops don't allow it from other sites.

const PAGE_BYTES = 800_000;
const BROWSER = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en;q=0.9,it;q=0.8,*;q=0.5",
};
const unescapeHtml = (s) => s.replace(/&(amp|quot|#39|#x27|#x2F|lt|gt);/gi, (m, e) => ({ amp: "&", quot: '"', "#39": "'", "#x27": "'", "#x2f": "/", lt: "<", gt: ">" })[e.toLowerCase()]);

async function productPage(target) {
  let url;
  try { url = new URL(target); } catch { return fail(400, "Bad URL"); }
  if (!/^https?:$/.test(url.protocol)) return fail(400, "Bad URL");
  let r;
  try {
    r = await fetch(url, { headers: BROWSER, redirect: "follow", signal: AbortSignal.timeout(9000), cf: { cacheTtl: 86400, cacheEverything: true } });
  } catch {
    return fail(502, "The shop didn't answer.");
  }
  if (!r.ok || !(r.headers.get("Content-Type") || "").includes("html")) return fail(502, `The shop answered ${r.status}.`);
  // The tags we need are near the top; don't read a whole 3 MB page.
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let html = "";
  while (html.length < PAGE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    html += dec.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  const page = new URL(r.url || url);
  const meta = (...names) => {
    for (const n of names) {
      const tag = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${n}["'][^>]*>`, "i"))?.[0];
      const v = tag?.match(/content=(?:"([^"]*)"|'([^']*)')/i);
      if (v && (v[1] || v[2])) return unescapeHtml((v[1] || v[2]).trim());
    }
    return "";
  };
  const product = jsonLdProduct(html);
  const offer = [product?.offers].flat().flat().find((o) => o && (o.price || o.lowPrice));
  const absolute = (u) => {
    try { return u ? new URL(u, page).href.replace(/^http:/, "https:") : ""; } catch { return ""; }
  };
  const ldImage = [product?.image].flat().map((i) => (typeof i === "string" ? i : i?.url || i?.contentUrl)).find(Boolean);
  const amount = meta("product:price:amount", "og:price:amount") || offer?.price || offer?.lowPrice || "";
  const currency = meta("product:price:currency", "og:price:currency") || offer?.priceCurrency || "";
  return json({
    url: page.href,
    title: (meta("og:title", "twitter:title") || product?.name || html.match(/<title[^>]*>([^<]*)/i)?.[1] || "").trim().slice(0, 140),
    image: absolute(meta("og:image", "og:image:secure_url", "twitter:image", "image") || ldImage),
    price: amount ? `${amount} ${currency}`.trim() : "",
    site: meta("og:site_name") || page.hostname.replace(/^www\./, ""),
  });
}
function jsonLdProduct(html) {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    let data;
    try { data = JSON.parse(m[1].trim()); } catch { continue; }
    const stack = [data];
    while (stack.length) {
      const d = stack.pop();
      if (!d || typeof d !== "object") continue;
      if (Array.isArray(d)) { stack.push(...d); continue; }
      if ([d["@type"]].flat().includes("Product")) return d;
      if (d["@graph"]) stack.push(d["@graph"]);
    }
  }
  return null;
}
