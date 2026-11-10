// The wall screen's own layer (the Raspberry Pi kiosk in device/, the iPad on the wall), on top of
// the app. app.js starts it once with a few hooks (startKiosk at the end of app.js):
//
//   - The ambient screen: after a few minutes nobody touches the screen (3 by default on a touch
//     screen, Settings > Wall screen), a black screen with a clock, the weather and today's outfit
//     takes over. The 3D mirror stops drawing (stage.pause(): 0% GPU) and the app underneath isn't
//     painted. The clock block glides to a new spot every minute so nothing burns into the panel.
//     A tap anywhere (or a key) brings the app back at once, as it was; that tap does nothing else.
//   - Rows that scroll sideways (chips, photo strips, the gallery) can be dragged with a mouse too,
//     for touch screens that Linux reports as a mouse (they don't scroll by themselves).
//   - The diagnostics: tap a page title (or the logo) 5 times. The graphics chip and whether it
//     really draws (not a software fallback), frames per second, the 3D mirror's meshes and
//     textures in graphics memory, storage used on the device, the offline cache, and buttons to
//     force a fresh copy of the app, reset the 3D camera and time the 3D drawing.
//
// Nothing here talks to a server. Settings: settings.ambientMinutes (0 = off; unset = the default
// for this device), kept on this device like the other settings.

export const AMBIENT_CHOICES = [0, 1, 3, 5, 10];
const DEFAULT_MINUTES = 3;
const DRIFT_MS = 60_000; // the clock block moves this often…
const GLIDE_S = 12; // …taking this long to get there (a transition: no script runs meanwhile)
const TAPS = 5, TAP_WINDOW = 3000; // taps on a title that open the diagnostics, within this many ms
const KIOSK_FLAG = "wardrobe.kiosk"; // set when kiosk.sh opened the app (?kiosk=1)
const ASLEEP_FLAG = "wardrobe.ambient"; // the ambient screen was showing when the page reloaded

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = (kind) => { try { return globalThis[kind] || null; } catch { return null; } };
const getFlag = (kind, k) => { try { return store(kind)?.getItem(k) ?? null; } catch { return null; } };
const setFlag = (kind, k, v) => { try { if (v == null) store(kind)?.removeItem(k); else store(kind)?.setItem(k, v); } catch { /* blocked: fine */ } };
const safe = (fn, fallback = null) => { try { return fn(); } catch (e) { console.warn("Wall screen:", e); return fallback; } };
const mb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
const ICON_X = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;

/**
 * @param {object} app
 *   settings, saveSettings()    the app's settings (this device) and how to save them
 *   stage()                     the 3D mirror's stage, or null (pause, resume, snapTo, debug.renderer)
 *   ambient()                   { weather: {icon, temp, text, detail} | null, next: "19:30 Dinner" | "",
 *                                 outfit: { label, pieces: [{ name, src }] } }
 *   refreshWeather()            a Promise: the weather again (the app keeps it 30 minutes)
 *   resetCamera()               the 3D mirror back to the front, framed again; false if there's none
 *   woke(sinceMs)               the ambient screen was on from sinceMs until now
 */
export function startKiosk(app) {
  const html = document.documentElement;
  const params = new URLSearchParams(location.search);
  if (params.has("kiosk")) {
    setFlag("localStorage", KIOSK_FLAG, "1");
    params.delete("kiosk");
    safe(() => history.replaceState(history.state, "", `${location.pathname}${params.size ? `?${params}` : ""}${location.hash}`));
  }
  const isKiosk = getFlag("localStorage", KIOSK_FLAG) === "1";
  // A tablet or the wall (a touch screen at least ~700 px across): the ambient screen is on unless
  // turned off. A phone or a computer with a mouse: off unless turned on.
  const bigTouch = () => matchMedia("(pointer: coarse)").matches && Math.min(screen.width, screen.height) >= 700;
  const minutes = () => {
    const m = app.settings.ambientMinutes;
    return AMBIENT_CHOICES.includes(m) ? m : isKiosk || bigTouch() ? DEFAULT_MINUTES : 0;
  };

  /* ---------------- idle → the ambient screen ---------------- */
  let last = performance.now(), timer = 0, asleep = false, since = 0;
  const arm = () => {
    clearTimeout(timer);
    const ms = minutes() * 60_000;
    if (!ms || asleep) return;
    timer = setTimeout(check, Math.max(1000, ms - (performance.now() - last)));
  };
  // Not while the camera is filming (it's in use): looked at again a little later.
  const busy = () => !!document.querySelector(".cam:not([hidden])");
  function check() {
    const ms = minutes() * 60_000;
    if (!ms || asleep) return;
    if (performance.now() - last < ms - 250) return arm();
    if (busy()) { last = performance.now() - ms + 30_000; return arm(); }
    sleep();
  }
  const activity = (e) => {
    last = performance.now();
    if (asleep) wake(e);
  };
  for (const type of ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"]) {
    addEventListener(type, activity, { capture: true, passive: true });
  }
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") { last = performance.now(); arm(); } });

  let screenEl = null, blockEl = null, driftTimer = 0, tickTimer = 0, weatherAt = 0, lastInfo = "", pos = null;
  function build() {
    screenEl = document.createElement("div");
    screenEl.className = "ambient-screen";
    screenEl.hidden = true;
    screenEl.setAttribute("role", "region"); // (not a dialog: the offline cache may reload the app meanwhile)
    screenEl.setAttribute("aria-label", "Ambient screen. Tap anywhere to open the app.");
    screenEl.innerHTML = `<div class="amb-block"><div class="amb-time"></div><div class="amb-date"></div><div class="amb-more"></div></div>`;
    blockEl = screenEl.firstElementChild;
    document.body.append(screenEl);
  }
  function paint() {
    if (!screenEl) return;
    const now = new Date();
    blockEl.querySelector(".amb-time").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    blockEl.querySelector(".amb-date").textContent = now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
    const info = safe(() => app.ambient(), {}) || {};
    const key = JSON.stringify(info);
    if (key === lastInfo) return; // the photos aren't decoded again every minute
    lastInfo = key;
    const w = info.weather, fit = info.outfit;
    blockEl.querySelector(".amb-more").innerHTML = `
      ${w ? `<div class="amb-wx">${w.icon || ""}<b>${esc(w.temp)}</b><span>${esc(w.text)}${w.detail ? ` · ${esc(w.detail)}` : ""}</span></div>` : ""}
      ${info.next ? `<div class="amb-next">Next: ${esc(info.next)}</div>` : ""}
      ${fit?.pieces?.length ? `<div class="amb-fit"><span class="amb-label">${esc(fit.label)}</span>
        <div class="amb-pics">${fit.pieces.filter((p) => p.src).map((p) => `<img src="${esc(p.src)}" alt="" decoding="async">`).join("")}</div>
        <span class="amb-names">${esc(fit.pieces.map((p) => p.name).join(" · "))}</span></div>` : ""}`;
  }
  // Every minute: the time, and the rest when it changed; the weather every 15 minutes.
  function tick() {
    if (!asleep) return;
    if (Date.now() - weatherAt > 15 * 60_000) {
      weatherAt = Date.now();
      Promise.resolve(safe(() => app.refreshWeather())).then(() => asleep && paint(), () => {});
    }
    paint();
    tickTimer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
  }
  // A new spot for the clock block, a short way from the last one, inside the screen.
  function drift(first = false) {
    if (!asleep) return;
    const W = screenEl.clientWidth, H = screenEl.clientHeight, w = blockEl.offsetWidth, h = blockEl.offsetHeight;
    const pad = Math.min(48, W * 0.05), maxX = Math.max(pad, W - w - pad), maxY = Math.max(pad, H - h - pad);
    const rnd = (lo, hi) => lo + Math.random() * Math.max(0, hi - lo);
    const step = (v, lo, hi, span) => Math.min(hi, Math.max(lo, v + (Math.random() * 2 - 1) * span));
    pos = first || !pos ? { x: rnd(pad, maxX), y: rnd(pad, maxY) }
      : { x: step(pos.x, pad, maxX, W * 0.18), y: step(pos.y, pad, maxY, H * 0.14) };
    blockEl.style.transition = first ? "none" : `transform ${GLIDE_S}s ease-in-out`;
    blockEl.style.transform = `translate3d(${Math.round(pos.x)}px, ${Math.round(pos.y)}px, 0)`;
    driftTimer = setTimeout(() => drift(), DRIFT_MS);
  }
  function sleep() {
    if (asleep) return;
    if (!screenEl) build();
    closeDiag();
    const f = document.activeElement;
    if (f && f !== document.body && /^(INPUT|TEXTAREA|SELECT)$/.test(f.tagName)) f.blur(); // the on-screen keyboard goes too
    asleep = true;
    since = Date.now();
    safe(() => app.stage()?.pause?.());
    html.classList.add("kiosk-asleep");
    screenEl.classList.remove("waking");
    screenEl.hidden = false;
    lastInfo = "";
    tick();
    drift(true);
    setFlag("sessionStorage", ASLEEP_FLAG, "1");
  }
  // At once, in the same event: the app is back before the next frame. The tap that woke it is
  // kept by the (now see-through) screen until its click has gone, then the screen goes.
  let dropTimer = 0;
  function wake(e) {
    if (!asleep) return;
    asleep = false;
    clearTimeout(tickTimer); clearTimeout(driftTimer);
    html.classList.remove("kiosk-asleep");
    safe(() => app.stage()?.resume?.());
    setFlag("sessionStorage", ASLEEP_FLAG, null);
    const drop = () => { clearTimeout(dropTimer); screenEl.hidden = true; screenEl.classList.remove("waking"); };
    if (e && /^(pointerdown|touchstart)$/.test(e.type) && e.target?.closest?.(".ambient-screen")) {
      screenEl.classList.add("waking");
      screenEl.addEventListener("click", drop, { once: true });
      dropTimer = setTimeout(drop, 700);
    } else drop();
    last = performance.now();
    arm();
    const from = since;
    setTimeout(() => safe(() => app.woke?.(from)), 0); // after the first frame of the app is out
  }

  /* ---------------- dragging sideways rows with a mouse ---------------- */
  const NO_DRAG = "input, textarea, select, canvas, .stage3d, .cutfix-stage, [contenteditable]";
  const sideways = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      if (n.scrollWidth > n.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(n).overflowX)) return n;
    }
    return null;
  };
  let drag = null;
  addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0 || asleep || e.target.closest?.(NO_DRAG)) return;
    const el = sideways(e.target);
    if (el) drag = { el, id: e.pointerId, x: e.clientX, left: el.scrollLeft, moved: false, v: 0, t: e.timeStamp, lx: e.clientX };
  }, true);
  addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved) {
      if (Math.abs(dx) < 6) return;
      drag.moved = true;
      drag.el.classList.add("drag-scrolling"); // (no snapping while it's held)
    }
    const dt = Math.max(1, e.timeStamp - drag.t);
    drag.v = 0.7 * drag.v + 0.3 * ((e.clientX - drag.lx) / dt);
    drag.t = e.timeStamp; drag.lx = e.clientX;
    drag.el.scrollLeft = drag.left - dx;
  }, true);
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const { el, moved } = drag;
    let v = e.type === "pointerup" && e.timeStamp - drag.t < 80 ? drag.v : 0;
    drag = null;
    if (!moved) return;
    // the click that ends a drag doesn't press the chip under the mouse
    const stop = (c) => { c.stopPropagation(); c.preventDefault(); };
    addEventListener("click", stop, { capture: true, once: true });
    setTimeout(() => removeEventListener("click", stop, { capture: true }), 0);
    // a little glide, then the row may snap again
    const glide = () => {
      if (Math.abs(v) < 0.02) return el.classList.remove("drag-scrolling");
      el.scrollLeft -= v * 16; v *= 0.92;
      requestAnimationFrame(glide);
    };
    glide();
  };
  addEventListener("pointerup", endDrag, true);
  addEventListener("pointercancel", endDrag, true);

  /* ---------------- the diagnostics ---------------- */
  let taps = [];
  // (pointerdown, not click: iPad Safari sends no click for a tap on plain text)
  addEventListener("pointerdown", (e) => {
    if (asleep || !e.isPrimary || !e.target.closest?.(".rail .brand, #main h1")) return;
    const now = performance.now();
    taps = taps.filter((t) => now - t < TAP_WINDOW);
    taps.push(now);
    if (taps.length >= TAPS) { taps = []; openDiag(); }
  }, true);

  let diagEl = null, diagRaf = 0, diagTimer = 0, gpu = null, note = "";
  const fps = { screen: null, stage: null, frames: 0, t0: 0, f0: 0 };
  const stageInfo = () => safe(() => app.stage()?.debug?.renderer?.info) || null;
  function readGPU() {
    const r = safe(() => app.stage()?.debug?.renderer);
    let gl = safe(() => r?.getContext()), temp = null;
    if (!gl) {
      temp = document.createElement("canvas");
      gl = temp.getContext("webgl2") || temp.getContext("webgl");
    }
    if (!gl) return { none: true };
    const plain = gl.getParameter(gl.RENDERER) || "";
    // Chrome and Safari give a generic name; the real one comes with WEBGL_debug_renderer_info.
    const ext = /^(WebKit WebGL|Mozilla|)$/.test(plain) ? gl.getExtension("WEBGL_debug_renderer_info") : null;
    const out = {
      renderer: (ext && gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) || plain || "Unknown",
      vendor: (ext && gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)) || gl.getParameter(gl.VENDOR) || "",
      version: gl.getParameter(gl.VERSION) || "",
      maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    };
    out.soft = /swiftshader|llvmpipe|softpipe|software|basic render|lavapipe/i.test(out.renderer);
    if (temp) safe(() => gl.getExtension("WEBGL_lose_context")?.loseContext());
    return out;
  }
  const row = (label, id) => `<div><dt>${label}</dt><dd id="kd-${id}">…</dd></div>`;
  function openDiag() {
    if (diagEl) return;
    diagEl = document.createElement("div");
    diagEl.className = "kdiag";
    diagEl.setAttribute("role", "dialog");
    diagEl.setAttribute("aria-modal", "true"); // (so the offline cache doesn't reload the app while it's open)
    diagEl.setAttribute("aria-label", "Diagnostics");
    diagEl.innerHTML = `<div class="kdiag-backdrop" data-kdiag="close"></div>
      <section class="kdiag-panel">
        <div class="kdiag-head"><h2>Diagnostics</h2><button class="btn ghost icon-btn" data-kdiag="close" aria-label="Close">${ICON_X}</button></div>
        <dl class="kdiag-list">
          ${row("Graphics chip", "gpu")}${row("Drawn by", "accel")}${row("Frames per second", "fps")}
          ${row("3D mirror in graphics memory", "mem")}${row("Last 3D frame", "frame")}
          ${row("Storage on this device", "store")}${row("Offline cache", "sw")}
          ${row("Screen", "screen")}${row("Browser", "browser")}${row("Ambient screen", "amb")}
        </dl>
        <div class="kdiag-actions">
          <button class="btn" data-kdiag="speed">Test the 3D speed</button>
          <button class="btn" data-kdiag="camera">Reset avatar camera</button>
          <button class="btn" data-kdiag="refresh">Force refresh offline cache</button>
          <button class="btn" data-kdiag="ambient">Show the ambient screen</button>
        </div>
        <p class="muted small kdiag-note" id="kd-note" role="status"></p>
      </section>`;
    document.body.append(diagEl);
    gpu = readGPU();
    note = "";
    fps.screen = fps.stage = null;
    fps.frames = 0; fps.t0 = performance.now(); fps.f0 = stageInfo()?.render.frame ?? 0;
    const loop = (now) => {
      fps.frames++;
      if (now - fps.t0 >= 1000) {
        const f = stageInfo()?.render.frame ?? 0;
        fps.screen = (fps.frames * 1000) / (now - fps.t0);
        fps.stage = ((f - fps.f0) * 1000) / (now - fps.t0);
        fps.frames = 0; fps.t0 = now; fps.f0 = f;
        paintDiag();
      }
      diagRaf = requestAnimationFrame(loop);
    };
    diagRaf = requestAnimationFrame(loop);
    paintDiag(true);
    diagTimer = setInterval(() => paintDiag(true), 5000); // the slower ones (storage, the cache)
  }
  function closeDiag() {
    if (!diagEl) return;
    cancelAnimationFrame(diagRaf); clearInterval(diagTimer);
    diagEl.remove();
    diagEl = null;
  }
  const put = (id, text) => { const el = diagEl?.querySelector(`#kd-${id}`); if (el && el.textContent !== text) el.textContent = text; };
  async function paintDiag(slow = false) {
    if (!diagEl) return;
    const g = gpu || {};
    put("gpu", g.none ? "No WebGL here: the 3D mirror can't run" : `${g.renderer}${g.vendor && !g.renderer.includes(g.vendor) ? ` (${g.vendor})` : ""}`);
    put("accel", g.none ? "Nothing (no WebGL)" : g.soft ? "The processor (software drawing: the graphics chip isn't used, so the 3D mirror is slow)" : `The graphics chip · ${g.version} · textures up to ${g.maxTex} px`);
    const st = app.stage(), info = stageInfo();
    put("fps", fps.screen == null ? "Measuring…" : `Screen ${Math.round(fps.screen)} · 3D mirror ${Math.round(fps.stage)}${st?.paused ? " (paused)" : fps.stage < 1 ? " (it only draws while something moves)" : ""}`);
    put("mem", info ? `${info.memory.geometries} meshes · ${info.memory.textures} textures · ${info.programs?.length ?? 0} shaders` : "The 3D mirror hasn't started (open Today)");
    put("frame", info && info.render.frame ? `${st.debug.lastFrameMs.toFixed(1)} ms on the processor · ${info.render.calls} draw calls · ${Math.round(info.render.triangles / 1000)}k triangles` : "None yet");
    put("screen", `${innerWidth} × ${innerHeight} (${devicePixelRatio}x) · ${screen.orientation?.type?.split("-")[0] || (innerHeight > innerWidth ? "portrait" : "landscape")} · ${navigator.maxTouchPoints ? `touch, ${navigator.maxTouchPoints} points` : "no touch"}${matchMedia("(pointer: coarse)").matches ? "" : " · mouse"}`);
    const heap = performance.memory?.usedJSHeapSize;
    const up = Math.round(performance.now() / 60_000);
    put("browser", `${browserName()} · ${navigator.onLine ? "online" : "offline"} · open ${up >= 60 ? `${Math.floor(up / 60)} h ${up % 60} min` : `${up} min`}${heap ? ` · app memory ${mb(heap)}` : ""}`);
    put("amb", `${minutes() ? `After ${minutes()} min without a touch` : "Off"}${isKiosk ? " · opened by the wall screen (kiosk.sh)" : ""}`);
    if (note) put("note", note);
    if (!slow) return;
    try {
      const e = await navigator.storage?.estimate?.();
      const kept = await navigator.storage?.persisted?.().catch(() => null);
      const idb = e?.usageDetails?.indexedDB;
      put("store", e ? `${mb(e.usage || 0)} of ${mb(e.quota || 0)}${idb != null ? ` (wardrobe and photos ${mb(idb)})` : ""}${kept == null ? "" : kept ? " · kept by the browser" : " · the browser may clear it when space runs low"}` : "Can't be read here");
    } catch { put("store", "Can't be read here"); }
    try {
      const reg = await navigator.serviceWorker?.getRegistration?.();
      const names = (await caches.keys()).filter((n) => n.startsWith("wardrobe-"));
      const files = (await Promise.all(names.map(async (n) => (await (await caches.open(n)).keys()).length))).reduce((a, b) => a + b, 0);
      const state = !reg ? "no service worker" : reg.waiting ? "a new version is waiting for a quiet moment" : reg.active ? "service worker on" : "service worker starting";
      put("sw", names.length ? `${names.map((n) => n.slice(9, 21)).join(", ")} · ${files} files · ${state}` : `Nothing cached · ${state}`);
    } catch { put("sw", "Can't be read here"); }
  }
  function browserName() {
    const ua = navigator.userAgent;
    const m = ua.match(/(Edg|Chrome|Chromium|Firefox|CriOS|FxiOS)\/(\d+)/) || (/Safari/.test(ua) && ua.match(/Version\/(\d+)/) && ["", "Safari", ua.match(/Version\/(\d+)/)[1]]);
    const os = /iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1 ? "iPad" : /Android/.test(ua) ? "Android" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? (/aarch64|arm/.test(ua) ? "Linux (ARM)" : "Linux") : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "";
    const name = m ? `${{ Edg: "Edge", CriOS: "Chrome", FxiOS: "Firefox" }[m[1]] || m[1]} ${m[2]}` : "Browser";
    return os ? `${name} on ${os}` : name;
  }
  // Turn him once, drawing every frame, and count the frames: 50-60 means the graphics chip draws.
  async function speedTest(btn) {
    const st = app.stage();
    if (!st?.debug || !document.getElementById("stage3d")) { note = "Open Today first: the test turns the 3D mirror once."; return paintDiag(); }
    btn.disabled = true;
    note = "Turning him once…";
    paintDiag();
    const from = st.angle, t0 = performance.now(), ms = 3000;
    let n = 0, cpu = 0;
    await new Promise((done) => {
      const step = (now) => {
        if (!diagEl) return done();
        const t = Math.min(1, (now - t0) / ms);
        st.debug.setAngleNow(from + t * 360);
        cpu += st.debug.lastFrameMs; n++;
        if (t < 1) requestAnimationFrame(step); else done();
      };
      requestAnimationFrame(step);
    });
    const secs = (performance.now() - t0) / 1000, rate = n / secs;
    note = `${Math.round(rate)} frames a second while turning (${(cpu / n).toFixed(1)} ms each on the processor). ${rate >= 50 ? "Smooth: the graphics chip draws the mirror." : rate >= 30 ? "Fine, a little short of smooth." : "Slow: check that the graphics chip is used (GPU_BOOST=1 in kiosk.conf on the wall screen)."}`;
    btn.disabled = false;
    paintDiag();
  }
  // The newest copy of the app from the server: the offline cache emptied, its service worker
  // removed, and the page loaded again (sw-register.js starts a fresh service worker).
  async function forceRefresh(btn) {
    btn.disabled = true;
    note = "Emptying the offline cache…";
    paintDiag();
    try {
      for (const n of await caches.keys()) if (n.startsWith("wardrobe-")) await caches.delete(n);
      for (const r of (await navigator.serviceWorker?.getRegistrations?.()) || []) await r.unregister();
    } catch (e) { console.warn("Wall screen: cache", e); }
    location.reload();
  }
  document.addEventListener("click", (e) => {
    const b = e.target.closest?.("[data-kdiag], [data-kiosk-idle], [data-kiosk]");
    if (!b) return;
    const ds = b.dataset;
    if (ds.kdiag === "close") return closeDiag();
    if (ds.kdiag === "speed") return speedTest(b);
    if (ds.kdiag === "refresh") return forceRefresh(b);
    if (ds.kdiag === "camera") { note = safe(() => app.resetCamera()) ? "The 3D mirror faces you again." : "The 3D mirror hasn't started (open Today)."; return paintDiag(); }
    if (ds.kdiag === "ambient" || ds.kiosk === "now") { e.stopPropagation(); return sleep(); }
    if (ds.kioskIdle != null) {
      app.settings.ambientMinutes = +ds.kioskIdle;
      document.querySelectorAll("[data-kiosk-idle]").forEach((x) => x.setAttribute("aria-pressed", String(+x.dataset.kioskIdle === minutes())));
      Promise.resolve(app.saveSettings()).catch(() => {});
      last = performance.now();
      arm();
    }
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape" && diagEl) closeDiag(); });

  arm();
  // The app reloaded (a new version at a quiet moment) while the ambient screen was on: back to it.
  if (getFlag("sessionStorage", ASLEEP_FLAG) === "1" && minutes()) setTimeout(sleep, 0);

  return {
    sleep, wake: () => wake(null), openDiag, closeDiag,
    get asleep() { return asleep; },
    get minutes() { return minutes(); },
    isKiosk,
    // Settings > Wall screen
    card: () => `<section class="card stack">
      <h2 style="margin:0">Wall screen</h2>
      <p class="muted small" style="margin:0">When nobody touches the screen, a dark ambient screen shows the clock, the weather and today's outfit, and the 3D mirror stops drawing. It moves a little every minute so nothing burns into the screen. A tap brings the app back as it was. For this device:</p>
      <div class="chips" role="group" aria-label="Ambient screen after">${AMBIENT_CHOICES.map((m) => `<button class="chip" data-kiosk-idle="${m}" aria-pressed="${m === minutes()}">${m ? `${m} min` : "Off"}</button>`).join("")}</div>
      <div class="row" style="justify-content:space-between"><span class="muted small" style="flex:1;min-width:200px">Tap a page title 5 times for the diagnostics: the graphics chip, frames per second, storage and a fresh copy of the app.</span><button class="btn" data-kiosk="now">Show it now</button></div>
    </section>`,
  };
}
