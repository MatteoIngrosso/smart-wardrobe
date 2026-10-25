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
//     GET  /api/page?url=…&code=…         a shop's product page: {url, title, image, images, description, price, site, text, tried}
//     GET  /api/image?url=…               a product photo from a shop (to keep as a piece's picture)
//     GET  /api/products?q=…&gl=it&hl=it  real products with photos (Google Shopping via SerpApi)
//     GET  /api/photos?q=…&gl=it&hl=it    photos for a search, e.g. a label's reference (Google Images via SerpApi)
//     POST /api/lens?q=…&country=it&hl=it a photo (JPEG body): the products in it, {items} (Google Lens via SerpApi)
//     GET  /lens/<name>.jpg               that photo, for Google Lens to fetch: no sign-in, gone once Lens has answered
//     POST /api/calendar                  {"url": "..."}: reads a calendar's private iCal link
//
// Settings (see README, "Putting it online"):
//     DB            D1 database binding, created on the first deploy (wrangler.jsonc)
//     APP_PASSWORD  secret: the password for the sign-in page. Without it nothing is served.
//     GEMINI_KEY    optional secret
//     CLAUDE_KEY    optional secret
//     SERPAPI_KEY   optional secret: product photos in Discover, Google Images and Google Lens for
//                   adding pieces (free plan, 250 searches a month)

const COLS = new Set(["items", "log", "kv", "wants", "scents", "events"]);
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
    if (url.pathname.startsWith("/lens/")) return lensPhoto(env, url.pathname.slice("/lens/".length));
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
    if (path === "page" && method === "GET") return await productPage(new URL(request.url).searchParams);
    if (path === "image" && method === "GET") return await productImage(new URL(request.url).searchParams.get("url"));
    if (path === "products" && method === "GET") return await products(env, new URL(request.url).searchParams);
    if (path === "photos" && method === "GET") return await photoSearch(env, new URL(request.url).searchParams);
    if (path === "calendar" && method === "POST") return await calendar(request);
    if (path === "ping" && method === "GET") {
      const keys = { gemini: !!env.GEMINI_KEY, claude: !!env.CLAUDE_KEY, products: !!env.SERPAPI_KEY };
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
    if (path === "lens" && method === "POST") return await lens(request, env);
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
    db.prepare("CREATE TABLE IF NOT EXISTS products (q TEXT PRIMARY KEY, data TEXT NOT NULL, at INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS lens (name TEXT PRIMARY KEY, body BLOB NOT NULL, at INTEGER NOT NULL)"),
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

// Some shops (Pull&Bear, Zara…) turn away requests from cloud servers like this one, or send
// a "checking your browser" page instead. So after the shop itself, the page is read through
// Google Translate's page proxy (Google's own servers fetch it) and through Jina Reader (free,
// no key, opens it in a real browser). Only the shop's address is sent to them.
// With `code` (model and colour from the label, e.g. 07660508434) the app wants every photo of
// the product and the page's text, which only the page as a browser shows it has; Jina's reading
// is asked for then. `tried` says how each way went, for the app to show when nothing worked.
async function productPage(params) {
  let url;
  try { url = new URL(params.get("url")); } catch { return fail(400, "Bad URL"); }
  if (!/^https?:$/.test(url.protocol)) return fail(400, "Bad URL");
  const code = (params.get("code") || "").match(/^\d{6,14}$/)?.[0] || "";
  const tried = [];
  let best = null;
  const merge = (info) => {
    if (!best) { best = info; return; }
    for (const k of ["title", "description", "color", "brand", "price", "site", "text"]) if (!best[k] && info[k]) best[k] = info[k];
    best.images = [...new Set([...best.images, ...info.images])].slice(0, 12);
    best.image = best.images[0] || "";
  };
  const ways = [
    ["shop", () => readHtml(url, BROWSER, 8000).then(([html, page]) => pageInfo(html, page, code))],
    ["Google", () => viaTranslate(url, code)],
    ["Jina", () => (code ? viaJinaText(url, code) : viaJina(url))],
  ];
  for (const [via, run] of ways) {
    try {
      const info = await run();
      tried.push(`${via}: ${info.images.length ? `${info.images.length} photo${info.images.length > 1 ? "s" : ""}` : info.title ? "no photo" : "empty page"}`);
      merge(info);
    } catch (e) {
      tried.push(`${via}: ${e.message}`);
    }
    // Enough: a photo (and, when the gallery is wanted, the browser's reading too).
    if (best?.image && (!code || via === "Jina" || best.text)) break;
  }
  if (!best?.image && !best?.title) return fail(502, tried.join(" · "));
  return json({ ...best, tried });
}
// A page's HTML (only its first PAGE_BYTES: the tags we need are near the top) and where it ended up.
async function readHtml(url, headers, wait = 9000, htmlOnly = true) {
  let r;
  try {
    r = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(wait), cf: { cacheTtl: 86400, cacheEverything: true } });
  } catch {
    throw new Error("no answer");
  }
  if (!r.ok) throw new Error(`answered ${r.status}`);
  if (htmlOnly && !(r.headers.get("Content-Type") || "").includes("html")) throw new Error(`sent ${(r.headers.get("Content-Type") || "no page").split(";")[0]}`);
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let html = "";
  while (html.length < PAGE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    html += dec.decode(value, { stream: true });
  }
  reader.cancel().catch(() => {});
  return [html, new URL(r.url || url)];
}
// Google Translate serves any page from its own servers at <host with dashes>.translate.goog.
// Links in it point back through Google; they're turned into the shop's own again.
const viaGoogle = (u) => new URL(`https://${u.hostname.replace(/-/g, "--").replace(/\./g, "-")}.translate.goog${u.pathname}${u.search}${u.search ? "&" : "?"}_x_tr_sl=auto&_x_tr_tl=it&_x_tr_hl=it`);
function fromGoogle(text) {
  return text.replace(/https:\/\/([a-z0-9-]+)\.translate\.goog(\/[^"'\s<>)]*)?/gi, (m, host, rest = "") => {
    const shop = host.replace(/--/g, "\0").replace(/-/g, ".").replace(/\0/g, "-");
    try {
      const u = new URL(`https://${shop}${unescapeHtml(rest)}`);
      for (const k of [...u.searchParams.keys()]) if (k.startsWith("_x_tr_")) u.searchParams.delete(k);
      return u.href;
    } catch { return m; }
  });
}
async function viaTranslate(url, code) {
  const [html] = await readHtml(viaGoogle(url), BROWSER, 8000);
  return pageInfo(fromGoogle(html), url, code);
}
async function viaJina(url) {
  // Jina Reader opens the page in a browser and, asked for HTML, sends the page as it rendered.
  const [html] = await readHtml(new URL(`https://r.jina.ai/${url.href}`), { "X-Return-Format": "html", Accept: "text/html" }, 12000, false);
  return pageInfo(html, url);
}
// The page as text, as a browser shows it (web components included), with every photo on it:
// the product's own photos are the ones whose file name holds its model and colour.
async function viaJinaText(url, code) {
  let r;
  try {
    r = await fetch(`https://r.jina.ai/${url.href}`, {
      headers: { Accept: "text/plain", "X-With-Images-Summary": "true", "X-With-Shadow-Dom": "true", "X-Timeout": "15" },
      signal: AbortSignal.timeout(22000),
    });
  } catch { throw new Error("no answer"); }
  if (!r.ok) throw new Error(`answered ${r.status}`);
  const text = (await r.text()).slice(0, 300_000);
  const title = text.match(/^Title:\s*(.+)$/m)?.[1]?.trim() || "";
  const images = productPhotos(text, code);
  const body = text.replace(/^(Title|URL Source|Published Time|Warning):.*$/gm, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\n{3,}/g, "\n\n").trim();
  return { url: url.href, title: title.slice(0, 140), image: images[0] || "", images, description: "", color: "", brand: "", price: "", site: url.hostname.replace(/^www\d*\./, ""), text: body.slice(0, 8000) };
}
// Photo addresses in a page that belong to the product (their name holds its code), one per
// photo: the same photo in other sizes counts once, at full size.
function productPhotos(text, code) {
  if (!code) return [];
  const found = new Map();
  const re = new RegExp(`https?:\\/\\/[^"'\\s<>()\\\\]*${code}[^"'\\s<>()\\\\]*?\\.(?:jpe?g|png|webp)(?:\\?[^"'\\s<>()\\\\]*)?`, "gi");
  for (const m of text.replace(/\\\//g, "/").matchAll(re)) {
    let u;
    try { u = new URL(unescapeHtml(m[0])); } catch { continue; }
    for (const k of ["w", "h", "imwidth", "width", "f"]) u.searchParams.delete(k);
    const key = u.pathname.replace(/\/[^/]*$/, "");
    if (!found.has(key)) found.set(key, u.href.replace(/^http:/, "https:"));
  }
  return [...found.values()].slice(0, 12);
}
// What a product page shares for link previews (Open Graph tags, or schema.org Product data).
function pageInfo(html, page, code = "") {
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
  const ldImages = [product?.image].flat().map((i) => (typeof i === "string" ? i : i?.url || i?.contentUrl)).filter(Boolean);
  const amount = meta("product:price:amount", "og:price:amount") || offer?.price || offer?.lowPrice || "";
  const currency = meta("product:price:currency", "og:price:currency") || offer?.priceCurrency || "";
  // Every photo the page shares (a page can have several og:image tags), main one first.
  const ogImages = [...html.matchAll(/<meta[^>]+(?:property|name)=["']og:image(?::secure_url)?["'][^>]*>/gi)]
    .map((t) => t[0].match(/content=(?:"([^"]*)"|'([^']*)')/i)).filter(Boolean).map((v) => unescapeHtml(v[1] || v[2] || ""));
  const images = [...new Set([...ogImages, meta("twitter:image", "image"), ...ldImages].map(absolute).filter(Boolean).concat(productPhotos(html, code)))].slice(0, 12);
  return {
    url: page.href,
    title: (meta("og:title", "twitter:title") || product?.name || html.match(/<title[^>]*>([^<]*)/i)?.[1] || "").trim().slice(0, 140),
    image: images[0] || "",
    images,
    description: (meta("og:description", "description") || product?.description || "").trim().slice(0, 300),
    color: typeof product?.color === "string" ? product.color.slice(0, 40) : "",
    brand: String(product?.brand?.name || product?.brand || "").slice(0, 60),
    price: amount ? `${amount} ${currency}`.trim() : "",
    site: meta("og:site_name") || page.hostname.replace(/^www\d*\./, ""),
  };
}

// A product photo, so the app can keep it as the piece's picture (shops' photos can't be
// copied by the browser itself). Only images, at most 8 MB.
const IMAGE_BYTES = 8_000_000;
async function productImage(target) {
  let url;
  try { url = new URL(target); } catch { return fail(400, "Bad URL"); }
  if (url.protocol !== "https:") return fail(400, "Bad URL");
  // If the shop won't send it here, the free images.weserv.nl image cache fetches it instead.
  let error = "The shop didn't send the photo.";
  for (const from of [url.href, `https://images.weserv.nl/?${new URLSearchParams({ url: url.href, w: "1600", we: "1" })}`]) {
    let r;
    try {
      r = await fetch(from, { headers: { ...BROWSER, Accept: "image/avif,image/webp,image/*,*/*;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(12000), cf: { cacheTtl: 86400, cacheEverything: true } });
    } catch { continue; }
    const type = r.headers.get("Content-Type") || "";
    if (!r.ok || !type.startsWith("image/")) { error = `The shop answered ${r.status}.`; continue; }
    if (Number(r.headers.get("Content-Length") || 0) > IMAGE_BYTES) return fail(413, "That photo is too large.");
    const body = await r.arrayBuffer();
    if (body.byteLength > IMAGE_BYTES) return fail(413, "That photo is too large.");
    return new Response(body, { headers: { "Content-Type": type, "Cache-Control": "private, max-age=86400" } });
  }
  return fail(502, error);
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

/* ---------- Products (Discover photos) ---------- */
// Real products for a search, with photo, price and shop, from Google Shopping through
// SerpApi. Its free plan has 250 searches a month, so each answer is kept in the database
// for two weeks and shared by every device: the same idea never costs a second search.

const PRODUCT_DAYS = 14;
async function products(env, params) {
  if (!env.SERPAPI_KEY) return fail(404, "No SERPAPI_KEY is saved on the server.");
  const q = (params.get("q") || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!q) return fail(400, "What should be searched?");
  const gl = /^[a-z]{2}$/.test(params.get("gl") || "") ? params.get("gl") : "us";
  const hl = /^[a-z]{2}$/.test(params.get("hl") || "") ? params.get("hl") : "en";
  const key = `${gl}|${hl}|${q.toLowerCase()}`;
  if (env.DB) {
    await ready(env.DB);
    const row = await env.DB.prepare("SELECT data, at FROM products WHERE q = ?").bind(key).first();
    if (row && Date.now() - row.at < PRODUCT_DAYS * 864e5) return json({ items: JSON.parse(row.data), cached: true });
  }
  const j = await serpApi(env, { engine: "google_shopping", q, gl, hl });
  const items = (j.shopping_results || []).map((x) => ({
    title: String(x.title || "").slice(0, 140),
    price: x.price || "",
    shop: x.source || "",
    image: [x.thumbnails?.[0], x.serpapi_thumbnail, x.thumbnail].find((u) => /^https:\/\//.test(u || "")) || "",
    url: [x.link, x.product_link].find((u) => /^https?:\/\//.test(u || "")) || "",
  })).filter((x) => x.image && x.url).slice(0, 8);
  if (env.DB) await env.DB.prepare("INSERT OR REPLACE INTO products (q, data, at) VALUES (?, ?, ?)").bind(key, JSON.stringify(items), Date.now()).run();
  return json({ items, cached: false });
}
// One SerpApi search. "No results" is an answer (worth keeping); anything else that went wrong
// (no searches left this month, a bad key) is an error, said as "SerpApi: …".
async function serpApi(env, params, wait = 20000) {
  let r;
  try {
    r = await fetch(`https://serpapi.com/search.json?${new URLSearchParams({ ...params, api_key: env.SERPAPI_KEY })}`, { signal: AbortSignal.timeout(wait) });
  } catch {
    throw Object.assign(new Error("SerpApi didn't answer."), { status: 502 });
  }
  const j = await r.json().catch(() => ({}));
  if (j.error && !/hasn't returned any results/i.test(j.error)) throw Object.assign(new Error(`SerpApi: ${j.error}`), { status: 502 });
  if (!r.ok && !j.error) throw Object.assign(new Error(`SerpApi answered ${r.status}.`), { status: 502 });
  return j;
}
const firstHttps = (...urls) => urls.find((u) => /^https:\/\//.test(u || "")) || "";
const place = (params, name, fallback) => (/^[a-z]{2}$/.test(params.get(name) || "") ? params.get(name) : fallback);

/* ---------- Google Images and Google Lens (adding a piece) ---------- */
// Some shops (Pull&Bear, Zara…) show their product pages to no server at all, but Google
// already has their photos. These go through SerpApi too, with the same key and free searches.

// Photos for a search, e.g. a label's reference ("Pull&Bear 07660508434"): the shop's own
// photo and Google's small copy of it, which always loads. Kept two weeks, like products.
async function photoSearch(env, params) {
  if (!env.SERPAPI_KEY) return fail(404, "No SERPAPI_KEY is saved on the server.");
  const q = (params.get("q") || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!q) return fail(400, "What should be searched?");
  const gl = place(params, "gl", "us"), hl = place(params, "hl", "en");
  const key = `photos|${gl}|${hl}|${q.toLowerCase()}`;
  if (env.DB) {
    await ready(env.DB);
    const row = await env.DB.prepare("SELECT data, at FROM products WHERE q = ?").bind(key).first();
    if (row && Date.now() - row.at < PRODUCT_DAYS * 864e5) return json({ items: JSON.parse(row.data), cached: true });
  }
  const j = await serpApi(env, { engine: "google_images", q, gl, hl });
  const items = (j.images_results || []).map((x) => ({
    title: String(x.title || "").slice(0, 140),
    image: firstHttps(x.original),
    thumb: firstHttps(x.thumbnail),
    url: firstHttps(x.link),
    shop: String(x.source || "").slice(0, 60),
  })).filter((x) => x.image || x.thumb).slice(0, 30);
  if (env.DB) await env.DB.prepare("INSERT OR REPLACE INTO products (q, data, at) VALUES (?, ?, ?)").bind(key, JSON.stringify(items), Date.now()).run();
  return json({ items, cached: false });
}

// Google Lens: the products in a photo (of a piece, or its label), with shop, price and photo.
// Lens only takes a photo at a public address, so the photo is kept here under a random name
// (GET /lens/<name>.jpg, the one address that works without signing in) and deleted as soon
// as Lens has answered; any left over are deleted after ten minutes.
const LENS_MS = 10 * 60_000;
async function lens(request, env) {
  if (!env.SERPAPI_KEY) return fail(404, "No SERPAPI_KEY is saved on the server.");
  const body = await request.arrayBuffer();
  if (!body.byteLength) return fail(400, "No photo");
  if (body.byteLength > MAX_BLOB) return fail(413, "Photo too large");
  const params = new URL(request.url).searchParams;
  const name = toHex(crypto.getRandomValues(new Uint8Array(16)));
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM lens WHERE at < ?").bind(now - LENS_MS),
    env.DB.prepare("INSERT INTO lens (name, body, at) VALUES (?, ?, ?)").bind(name, body, now),
  ]);
  try {
    const q = (params.get("q") || "").trim().replace(/\s+/g, " ").slice(0, 120);
    const search = { engine: "google_lens", url: `${new URL(request.url).origin}/lens/${name}.jpg`, hl: place(params, "hl", "en"), country: place(params, "country", "us"), ...(q ? { q } : {}) };
    // The shopping results first; if Lens sees nothing to buy, everything it matched.
    let items = lensItems(await serpApi(env, { ...search, type: "products" }, 40000));
    if (!items.length) items = lensItems(await serpApi(env, search, 40000));
    return json({ items });
  } finally {
    await env.DB.prepare("DELETE FROM lens WHERE name = ?").bind(name).run().catch(() => {});
  }
}
function lensItems(j) {
  const seen = new Set();
  return [...(j.visual_matches || []), ...(j.products || []), ...(j.exact_matches || [])].map((x) => ({
    title: String(x.title || "").slice(0, 140),
    url: /^https?:\/\//.test(x.link || "") ? x.link : "",
    shop: String(x.source || "").slice(0, 60),
    image: firstHttps(x.image, x.thumbnail),
    thumb: firstHttps(x.thumbnail, x.image),
    price: String(x.price?.value || (x.price?.extracted_value ? `${x.price.extracted_value} ${x.price.currency || ""}` : "")).trim(),
  })).filter((x) => x.url && x.thumb && !seen.has(x.url) && seen.add(x.url)).slice(0, 24);
}
async function lensPhoto(env, file) {
  const name = file.match(/^([0-9a-f]{32})\.jpg$/)?.[1];
  if (!name || !env.DB) return new Response("Not found", { status: 404 });
  await ready(env.DB);
  const row = await env.DB.prepare("SELECT body FROM lens WHERE name = ? AND at > ?").bind(name, Date.now() - LENS_MS).first();
  if (!row) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(row.body), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-store" } });
}
