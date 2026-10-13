// Smart Wardrobe on Cloudflare Workers: the same sync API as server.py, kept in a D1
// database, plus a pass-through to Gemini and Claude so API keys never reach a device.
// The app's files are served as static assets (wrangler.jsonc); only /api/* runs here.
//
//     GET  /api/ping                      {"ok": true, "rev": n, "sync": bool, "keys": {...}}
//     GET  /api/changes?since=r&wait=s    records changed after rev r; waits up to s seconds
//     POST /api/records                   {"records": [...]}, the newest updatedAt wins
//     POST /api/missing                   {"keys": [...]}, which photos the server still needs
//     HEAD/GET/PUT /api/blob/<key>        photos, stored once by content hash
//     POST /api/ai/gemini/<model>         Gemini generateContent with the GEMINI_KEY secret
//     POST /api/ai/claude/v1/messages     Claude Messages API with the CLAUDE_KEY secret
//
// Settings (see README, "Putting it online"):
//     DB            D1 database binding, created on the first deploy (wrangler.jsonc)
//     ACCESS_TEAM   Cloudflare Access team name (the part before .cloudflareaccess.com)
//     ACCESS_AUD    Application Audience (AUD) tag of the Access application
//     GEMINI_KEY    optional secret
//     CLAUDE_KEY    optional secret
//
// Every request must carry a valid Cloudflare Access login. Without ACCESS_TEAM and
// ACCESS_AUD the API answers nothing, so the wardrobe and keys are never open to the web.

const COLS = new Set(["items", "log", "kv"]);
const BLOB_KEY = /^[0-9a-z-]{4,80}\.(jpg|webp|png|bin)$/;
const BLOB_TYPE = { jpg: "image/jpeg", webp: "image/webp", png: "image/png", bin: "application/octet-stream" };
const MAX_BLOB = 1_900_000; // a D1 row holds up to 2 MB; photos are resized to 1100 px, far below that
const MAX_BODY = 25 * 1024 * 1024;

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
const fail = (status, error) => json({ error }, status);

export default {
  fetch(request, env) {
    if (new URL(request.url).pathname.startsWith("/api/")) return handleApi(request, env);
    return env.ASSETS.fetch(request);
  },
};

export async function handleApi(request, env) {
  if (!(await signedIn(request, env))) return fail(403, "Sign in through Cloudflare Access first.");
  const path = new URL(request.url).pathname.slice("/api/".length);
  const method = request.method;
  try {
    if (path.startsWith("ai/")) return await ai(request, env, path.slice(3));
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

/* ---------- Sign-in (Cloudflare Access) ---------- */

let certs = { team: "", at: 0, keys: [] };
const b64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));

async function accessKeys(team, refresh) {
  if (refresh || certs.team !== team || Date.now() - certs.at > 3600_000) {
    const r = await fetch(`https://${team}.cloudflareaccess.com/cdn-cgi/access/certs`);
    if (!r.ok) throw new Error("Couldn't load the Cloudflare Access keys");
    certs = { team, at: Date.now(), keys: (await r.json()).keys || [] };
  }
  return certs.keys;
}

async function signedIn(request, env) {
  const host = new URL(request.url).hostname;
  if (host === "localhost" || host === "127.0.0.1") return true; // `wrangler dev` on your own computer
  const team = String(env.ACCESS_TEAM || "").replace(/^https?:\/\//, "").replace(/\.cloudflareaccess\.com.*$/, "").replace(/\/.*$/, "");
  const aud = String(env.ACCESS_AUD || "").trim();
  if (!team || !aud) return false;
  const cookie = (request.headers.get("Cookie") || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  const token = request.headers.get("Cf-Access-Jwt-Assertion") || cookie?.[1];
  if (!token) return false;
  try {
    const [h, p, sig] = token.split(".");
    const header = JSON.parse(new TextDecoder().decode(b64url(h)));
    const claims = JSON.parse(new TextDecoder().decode(b64url(p)));
    if (header.alg !== "RS256") return false;
    let jwk = (await accessKeys(team)).find((k) => k.kid === header.kid);
    if (!jwk) jwk = (await accessKeys(team, true)).find((k) => k.kid === header.kid);
    if (!jwk) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
    const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    return ok && auds.includes(aud) && claims.iss === `https://${team}.cloudflareaccess.com` && claims.exp * 1000 > Date.now();
  } catch {
    return false;
  }
}

/* ---------- Sync ---------- */

let schema;
function ready(db) {
  schema ||= db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, col TEXT NOT NULL, id TEXT NOT NULL,
      rev INTEGER NOT NULL, updatedAt TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, data TEXT)`),
    db.prepare("CREATE INDEX IF NOT EXISTS records_rev ON records (rev)"),
    db.prepare("CREATE TABLE IF NOT EXISTS blobs (key TEXT PRIMARY KEY, type TEXT NOT NULL, body BLOB NOT NULL)"),
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
