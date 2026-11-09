// Smart Wardrobe service worker: the app's own files (code, styles, the fashion bible, the 3D
// mirror's body, hair and three.js, icons) come from a cache on the device, so the app opens and
// the mirror loads without waiting for the network, also offline. Nothing else is touched:
//   - /api/…, /lens/…, /login and /logout, every other site, and anything that isn't a GET always
//     go to the network and are never stored (wardrobe data, photos, AI answers, the sign-in);
//   - the page itself (/) is asked from the network first, so the sign-in check still runs; the
//     last good copy is only used when there is no connection;
//   - opening /logout empties the cache; /?clear-cache empties it too, for troubleshooting.
// Each deploy gets its own cache. The Worker writes its version id into VERSION when it serves
// this file (worker/api.js, serviceWorker), so after every deploy the browser finds a new service
// worker, which fills a new cache from that deploy and drops the old one once it takes over.
// sw-register.js picks a quiet moment for that. Served without the Worker (server.py, the preview),
// VERSION keeps its placeholder and nothing is cached.

const VERSION = "__SW_VERSION__";
const LIVE = !VERSION.startsWith("__");
const PREFIX = "wardrobe-";
const CACHE = PREFIX + VERSION;
const SCOPE = self.registration.scope;
const SHELL = new URL("./", SCOPE).href;

// Fetched when a version installs, so the whole app comes from one deploy. Files a page used
// that aren't listed here (the hair styles, sample photos, files added later) are kept the first
// time they're used, and every new version fetches them again too.
const CORE = [
  "./", "styles.css", "app.js", "sw-register.js", "sample/seed.js",
  "calendar.js", "stylist.js", "label.js", "cutout-editor.js", "fashion-bible.json",
  "avatar-config.js", "avatar-stage.js", "garment-baker.js", "mannequin-shells.js", "face-photo.js",
  "vendor/three/three.module.min.js", "vendor/three/addons/RoomEnvironment.js", "vendor/jsqr.min.js",
  "avatar/avatar.json", "avatar/avatar.bin", "avatar/eye.png",
  "manifest.webmanifest", "icon.svg", "apple-touch-icon.png",
];

const NETWORK_ONLY = /^\/(?:api|lens)\/|^\/(?:login|logout|sw\.js)$/;
const STATIC = /\.(?:m?js|css|json|bin|webp|png|jpe?g|gif|svg|ico|webmanifest|woff2?|ttf|wasm|glb|gltf|ktx2|hdr)$/i;

// Only a plain, complete answer from this site is stored: never a redirect (the sign-in page),
// an error, or anything marked no-store or private.
const storable = (res) =>
  !!res && res.status === 200 && res.type === "basic" && !res.redirected &&
  !/no-store|private/i.test(res.headers.get("Cache-Control") || "");
const storableFile = (res) => storable(res) && !/^text\/html/i.test(res.headers.get("Content-Type") || "");

const isAppFile = (url) => {
  const u = new URL(url);
  return u.origin === self.location.origin && !NETWORK_ONLY.test(u.pathname) && STATIC.test(u.pathname);
};

// Keeps the service worker running until the promise ends, where the event still allows it.
const later = (event, promise) => {
  try {
    event.waitUntil(promise);
  } catch {
    // The answer has already gone out; the promise finishes anyway.
  }
};

const forget = async () => {
  for (const name of await caches.keys()) if (name.startsWith(PREFIX)) await caches.delete(name);
};

async function save(cache, url) {
  try {
    // no-cache: the browser checks with the server, which answers "not modified" for files this
    // deploy didn't change, so a new version costs little more than a list of requests.
    const res = await fetch(url, { cache: "no-cache" });
    if (url === SHELL ? storable(res) : storableFile(res)) await cache.put(url, res);
  } catch {
    // Offline, or the file is gone: it is fetched when the page asks for it.
  }
}

async function fill() {
  const cache = await caches.open(CACHE);
  const urls = new Set(CORE.map((p) => new URL(p, SCOPE).href));
  for (const name of await caches.keys()) {
    if (!name.startsWith(PREFIX) || name === CACHE) continue;
    for (const req of await (await caches.open(name)).keys()) {
      if (req.url === SHELL || isAppFile(req.url)) urls.add(req.url);
    }
  }
  const queue = [...urls];
  const next = async () => {
    for (let url = queue.shift(); url; url = queue.shift()) await save(cache, url);
  };
  await Promise.all([next(), next(), next(), next()]);
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    if (LIVE) await fill().catch(() => {});
    // The first service worker takes over at once (there is nothing to mix up yet). A newer one
    // waits until sw-register.js says the page can reload, so a page never runs two versions.
    if (!LIVE || !self.registration.active) await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(PREFIX) && name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data === "activate-now") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (!LIVE || req.method !== "GET" || req.headers.has("Range")) return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname === "/logout") {
    event.waitUntil(forget());
    return;
  }
  if (NETWORK_ONLY.test(url.pathname)) return;
  if (req.mode === "navigate") {
    if (url.pathname !== new URL(SHELL).pathname) return;
    if (url.searchParams.has("clear-cache")) {
      event.waitUntil(forget());
      return;
    }
    event.respondWith(page(event));
    return;
  }
  if (!STATIC.test(url.pathname) || req.cache === "no-store" || req.cache === "reload") return;
  event.respondWith(appFile(event));
});

// The page: from the network, so the Worker checks the sign-in and the newest page is used. The
// last good copy only stands in when the network fails, or gives no answer within 6 seconds.
async function page(event) {
  const kept = caches.open(CACHE).then((c) => c.match(SHELL)).catch(() => undefined);
  const net = fetch(event.request).then((res) => {
    if (storable(res)) {
      const copy = res.clone();
      later(event, caches.open(CACHE).then((c) => c.put(SHELL, copy)).catch(() => {}));
    }
    return res;
  });
  const slow = new Promise((resolve) => setTimeout(resolve, 6000)).then(() => kept).then((copy) => copy || net);
  slow.catch(() => {});
  try {
    return await Promise.race([net, slow]);
  } catch (err) {
    const copy = await kept;
    if (copy) return copy;
    throw err;
  }
}

// The app's files: from the cache of this version, else from the network (and kept).
async function appFile(event) {
  const req = event.request;
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req.url, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (storableFile(res)) {
    const copy = res.clone();
    later(event, cache.put(req.url, copy).catch(() => {}));
  }
  return res;
}
