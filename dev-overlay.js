// dev-overlay.js: a bug-marking layer for working on the app on this computer (localhost only).
//
// app.js loads it only when the page is served from localhost / 127.0.0.1 / [::1], and
// .assetsignore keeps this file off Cloudflare, so the live app never has it.
//
// What it does: a floating toolbar (drag it to any edge) with
//   Interact | Draw (Alt+D, or Alt+Shift+D where the browser keeps Alt+D; Esc goes back to Interact),
//   pen / rectangle / arrow / comment pin, 5 colours, S M L strokes, undo / redo / clear,
//   an element picker (hover to see an element, click to lock it), the console errors badge,
//   Save issue, and the Issues drawer (Open / Fixed / All, this view or all views, jump to view,
//   mark fixed, delete, Copy for Claude, Export open issues as Markdown + annotated screenshots).
//
// Every drawing belongs to the screen it was made on (the "view key": the tab, its sub-tab and
// any open popup), and is kept in the scroll space of that screen's scrolling area, so a circle
// stays on its element when you scroll and only shows on that screen.
//
// Storage: IndexedDB "SmartWardrobeDevDB" (issues, with their screenshots), separate from the
// wardrobe's own database; toolbar place, colour, size and collapsed state in localStorage.
// Everything sits in a Shadow DOM under <div data-dev-overlay="true">, so the app's styles never
// reach it and screenshots and the picker skip it.

if (!window.__devOverlay) window.__devOverlay = start();

function start() {
  const DEV = () => window.__wardrobeDev || null; // app.js's helpers: view, sub-tab, go, 3D render
  const COLORS = ["#ff3b30", "#ffcc00", "#32ade6", "#34c759", "#ffffff"];
  const SIZES = { S: 2, M: 4, L: 7 };
  const PREFS_KEY = "wardrobe.devOverlay";
  const MS_URL = "https://esm.sh/modern-screenshot@4.7.0";

  /* ---------------- preferences (localStorage) ---------------- */
  const prefs = Object.assign({ edge: "right", offset: 0.25, color: COLORS[0], size: "M", collapsed: false, eye: true, scopeAll: false, filter: "open" }, readPrefs());
  function readPrefs() { try { return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}"); } catch { return {}; } }
  function savePrefs() { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {} }

  /* ---------------- console errors (ring buffer of 30) ---------------- */
  const errors = [];
  const pushError = (message, stack = "") => {
    errors.push({ message: String(message).slice(0, 2000), stack: String(stack || "").slice(0, 4000), at: new Date().toISOString(), viewKey: safeViewKey() });
    if (errors.length > 30) errors.shift();
    try { paintErrorBadge(); if (ui.drawerOpen && ui.tab === "console") paintDrawer(); } catch {} // (the toolbar may not exist yet)
  };
  const fmtArg = (a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })());
  const origError = console.error.bind(console);
  console.error = (...args) => {
    try { const err = args.find((a) => a instanceof Error); pushError(args.map(fmtArg).join(" "), err?.stack); } catch {}
    origError(...args);
  };
  addEventListener("error", (e) => pushError(e.message || "Error", e.error?.stack || `${e.filename || ""}:${e.lineno || ""}:${e.colno || ""}`));
  addEventListener("unhandledrejection", (e) => pushError(`Unhandled rejection: ${fmtArg(e.reason)}`, e.reason?.stack));

  /* ---------------- IndexedDB ---------------- */
  const dbReady = new Promise((resolve, reject) => {
    const req = indexedDB.open("SmartWardrobeDevDB", 1);
    req.onupgradeneeded = () => req.result.objectStoreNames.contains("issues") || req.result.createObjectStore("issues", { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const tx = async (mode, fn) => {
    const db = await dbReady;
    return new Promise((resolve, reject) => {
      const t = db.transaction("issues", mode), st = t.objectStore("issues");
      const r = fn(st);
      t.oncomplete = () => resolve(r?.result);
      t.onerror = () => reject(t.error);
    });
  };
  const dbAll = () => tx("readonly", (st) => st.getAll());
  const dbPut = (rec) => tx("readwrite", (st) => st.put(rec));
  const dbDel = (id) => tx("readwrite", (st) => st.delete(id));
  let issues = [];
  const loadIssues = async () => { issues = ((await dbAll()) || []).sort((a, b) => a.n - b.n); paintAll(); };

  /* ---------------- which screen is showing ---------------- */
  const visible = (el) => !!el && !el.hidden && el.isConnected && getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden";
  const slug = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32);
  function modalKey() {
    if (visible(document.querySelector(".kdiag"))) return "modal:diagnostics";
    if (visible(document.querySelector(".cutfix"))) return "modal:cutout-editor";
    if (visible(document.querySelector(".cam"))) return "modal:camera";
    if (visible(document.querySelector(".ambient-screen"))) return "ambient";
    const sheet = document.querySelector("#sheet");
    if (sheet && !sheet.hidden) {
      const p = sheet.querySelector(".sheet-panel");
      if (p?.querySelector(".avatar-editor")) return "modal:avatar-editor";
      if (p?.querySelector("#stage3d-preview")) return "modal:on-avatar";
      if (p?.querySelector("[data-fcwear]")) return "modal:fit-check";
      const h = p?.querySelector("h1, h2");
      return `modal:${slug(h?.textContent) || "sheet"}`;
    }
    return null;
  }
  function baseKey() {
    const d = DEV();
    if (!d) return "app";
    const sub = d.sub();
    return sub ? `${d.view}/${sub}` : d.view;
  }
  function getCurrentViewKey() { return modalKey() || baseKey(); }
  function safeViewKey() { try { return getCurrentViewKey(); } catch { return "unknown"; } }
  // The scrolling area a view's drawings live in.
  function scrollerFor(key) {
    if (key.startsWith("modal:") && !["modal:diagnostics", "modal:cutout-editor", "modal:camera"].includes(key)) return document.querySelector("#sheet .sheet-panel");
    if (key === "ambient" || key.startsWith("modal:")) return null;
    return document.querySelector("#main");
  }
  // Content space of a scroller: page point -> stored point, and back.
  function frame(key) {
    const el = scrollerFor(key);
    if (!el) return { ox: 0, oy: 0, clip: { x: 0, y: 0, w: innerWidth, h: innerHeight }, el: null };
    const r = el.getBoundingClientRect();
    return { ox: r.left - el.scrollLeft, oy: r.top - el.scrollTop, clip: { x: r.left, y: r.top, w: r.width, h: r.height }, el };
  }

  /* ---------------- the Shadow DOM ---------------- */
  const host = document.createElement("div");
  host.dataset.devOverlay = "true";
  host.style.cssText = "position:fixed;inset:0;z-index:2147483000;pointer-events:none;";
  document.body.append(host);
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>${STYLES()}</style>
    <svg class="layer" part="layer"><defs><clipPath id="clip"><rect/></clipPath></defs><g class="clipped" clip-path="url(#clip)"><g class="shapes"></g></g></svg>
    <div class="pins"></div>
    <div class="pick-box" hidden><span class="pick-label"></span></div>
    <div class="pulse" hidden></div>
    <div class="bar"></div>
    <div class="pop" hidden></div>
    <aside class="drawer" hidden></aside>
    <div class="lightbox" hidden><img alt=""></div>
    <div class="toast" hidden></div>`;
  const $ = (s) => root.querySelector(s);
  const svg = $(".layer"), shapesG = $(".shapes"), clipRect = $("#clip rect"), pinsEl = $(".pins"), bar = $(".bar"), pop = $(".pop"), drawer = $(".drawer");

  /* ---------------- state ---------------- */
  const ui = { mode: "interact", tool: "pen", drawerOpen: false, tab: "issues", picking: false, locked: null };
  const draft = { key: null, shapes: [], redo: [], target: null };
  let live = null; // the shape being drawn

  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  function toast(msg) { const t = $(".toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2200); }

  /* ---------------- shapes -> SVG and canvas ---------------- */
  const smooth = (pts) => {
    if (pts.length < 3) return pts.length ? `M${pts.map((p) => `${p[0]},${p[1]}`).join(" L")}` : "";
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 1; i < pts.length - 1; i++) { const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2; d += ` Q${pts[i][0]},${pts[i][1]} ${mx},${my}`; }
    const l = pts[pts.length - 1];
    return `${d} L${l[0]},${l[1]}`;
  };
  const arrowHead = (a, b, w) => {
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), len = 10 + w * 2.5;
    return [[b[0] - len * Math.cos(ang - 0.45), b[1] - len * Math.sin(ang - 0.45)], [b[0] - len * Math.cos(ang + 0.45), b[1] - len * Math.sin(ang + 0.45)]];
  };
  function shapeSVG(s, extra = "") {
    const st = `stroke="${s.color}" stroke-width="${s.strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round"${extra}`;
    if (s.type === "pen") return `<path d="${smooth(s.points)}" ${st}/>`;
    if (s.type === "rect") { const [a, b] = s.points; return `<rect x="${Math.min(a[0], b[0])}" y="${Math.min(a[1], b[1])}" width="${Math.abs(b[0] - a[0])}" height="${Math.abs(b[1] - a[1])}" rx="4" ${st}/>`; }
    if (s.type === "arrow") { const [a, b] = s.points, [h1, h2] = arrowHead(a, b, s.strokeWidth); return `<path d="M${a[0]},${a[1]} L${b[0]},${b[1]} M${h1[0]},${h1[1]} L${b[0]},${b[1]} L${h2[0]},${h2[1]}" ${st}/>`; }
    if (s.type === "pin") { const [p] = s.points; return `<circle cx="${p[0]}" cy="${p[1]}" r="9" fill="${s.color}" stroke="#000" stroke-opacity=".5" stroke-width="1.5"${extra}/><circle cx="${p[0]}" cy="${p[1]}" r="3" fill="#000" fill-opacity=".55"/>`; }
    return "";
  }
  function drawShape(ctx, s, dx, dy) {
    ctx.save();
    ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.strokeWidth; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const P = s.points.map((p) => [p[0] + dx, p[1] + dy]);
    ctx.beginPath();
    if (s.type === "pen") { ctx.stroke(new Path2D(smooth(P))); }
    else if (s.type === "rect") { const [a, b] = P; ctx.strokeRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1])); }
    else if (s.type === "arrow") { const [a, b] = P, [h1, h2] = arrowHead(a, b, s.strokeWidth); ctx.moveTo(...a); ctx.lineTo(...b); ctx.moveTo(...h1); ctx.lineTo(...b); ctx.lineTo(...h2); ctx.stroke(); }
    else if (s.type === "pin") {
      const [p] = P; ctx.arc(p[0], p[1], 9, 0, Math.PI * 2); ctx.fill();
      if (s.text) { ctx.font = "600 13px system-ui, sans-serif"; const w = ctx.measureText(s.text).width; ctx.fillStyle = "rgba(0,0,0,.78)"; ctx.fillRect(p[0] + 14, p[1] - 11, w + 12, 22); ctx.fillStyle = "#fff"; ctx.fillText(s.text, p[0] + 20, p[1] + 5); }
    }
    ctx.restore();
  }
  const bbox = (shapes) => {
    const pts = shapes.flatMap((s) => s.points);
    if (!pts.length) return null;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    return { x: Math.min(...xs) - 12, y: Math.min(...ys) - 12, w: Math.max(...xs) - Math.min(...xs) + 24, h: Math.max(...ys) - Math.min(...ys) + 24 };
  };
  const anchorOf = (iss) => {
    const p = iss.annotations[0]?.points?.[0];
    if (p) return p;
    const r = iss.targetElement?.docRect;
    return r ? [r.x + r.w, r.y] : null;
  };

  /* ---------------- painting the layer, pins and toolbar ---------------- */
  let paintQueued = false;
  const paintSoon = () => { if (!paintQueued) { paintQueued = true; requestAnimationFrame(() => { paintQueued = false; paintLayer(); }); } };
  let lastKey = null;
  function paintLayer() {
    host.style.display = document.documentElement.classList.contains("kiosk-asleep") ? "none" : ""; // not over the ambient screen
    const key = safeViewKey();
    if (key !== lastKey) { lastKey = key; if (draft.shapes.length && draft.key !== key) toast(`Unsaved marks belong to ${draft.key}: they show again there`); paintBar(); if (ui.drawerOpen && !prefs.scopeAll) paintDrawer(); }
    const f = frame(key);
    clipRect.setAttribute("x", f.clip.x); clipRect.setAttribute("y", f.clip.y); clipRect.setAttribute("width", f.clip.w); clipRect.setAttribute("height", f.clip.h);
    shapesG.setAttribute("transform", `translate(${f.ox} ${f.oy})`);
    const saved = prefs.eye ? issues.filter((i) => i.status === "open" && i.viewKey === key) : [];
    const mine = draft.key === key ? [...draft.shapes, ...(live ? [live] : [])] : [];
    shapesG.innerHTML = saved.map((i) => `<g data-issue="${i.id}" opacity=".9">${i.annotations.map((s) => shapeSVG(s)).join("")}${i.targetElement?.docRect && !i.annotations.length ? (() => { const r = i.targetElement.docRect; return `<rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" stroke="#ff3b30" stroke-dasharray="6 4" stroke-width="2" fill="none"/>`; })() : ""}</g>`).join("")
      + mine.map((s) => shapeSVG(s)).join("");
    // numbered pins for saved issues (clickable even in Interact mode), clipped to the scroller
    pinsEl.innerHTML = saved.map((i) => {
      const a = anchorOf(i); if (!a) return "";
      const x = a[0] + f.ox, y = a[1] + f.oy;
      if (x < f.clip.x - 10 || y < f.clip.y - 10 || x > f.clip.x + f.clip.w + 10 || y > f.clip.y + f.clip.h + 10) return "";
      return `<button class="badge" data-open-issue="${i.id}" style="left:${x + 8}px;top:${y - 26}px" title="${esc(i.title)}">#${i.n}</button>`;
    }).join("");
    svg.classList.toggle("drawing", ui.mode === "draw" || ui.picking);
  }

  const ICON = {
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-6.5v-1a1.5 1.5 0 0 1 3 0V12m0-6a1.5 1.5 0 0 1 3 0v6m0-3.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1.6a6 6 0 0 1-4.6-2.2L4 15.5a1.6 1.6 0 0 1 2.4-2L8 15"/>',
    pen: '<path d="M4 20l4-1 11-11-3-3L5 16z"/><path d="M14 6l3 3"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="2"/>',
    arrow: '<path d="M5 19L19 5M10 5h9v9"/>',
    pin: '<path d="M12 21s-6-5.5-6-11a6 6 0 0 1 12 0c0 5.5-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
    pick: '<path d="M4 4l7 17 2.5-7.5L21 11z"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    clear: '<path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6A17 17 0 0 0 2 12s3.5 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/>',
    save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
    bug: '<path d="M8 8a4 4 0 0 1 8 0v1H8zM6 9h12v5a6 6 0 0 1-12 0z"/><path d="M12 13v7M3 13h3M18 13h3M4 7l3 2M20 7l-3 2M4 19l3-2M20 19l-3-2"/>',
    min: '<path d="M6 12h12"/>',
    grip: '<circle cx="9" cy="6" r="1"/><circle cx="15" cy="6" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="9" cy="18" r="1"/><circle cx="15" cy="18" r="1"/>',
  };
  const ic = (n) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[n]}</svg>`;
  function paintBar() {
    const vertical = prefs.edge === "left" || prefs.edge === "right";
    bar.className = `bar ${vertical ? "v" : "h"} edge-${prefs.edge}${prefs.collapsed ? " collapsed" : ""}`;
    placeBar();
    const open = issues.filter((i) => i.status === "open").length;
    if (prefs.collapsed) {
      bar.innerHTML = `<button class="grip" data-grip title="Drag to move">${ic("grip")}</button><button data-act="expand" title="Open the dev toolbar">${ic("bug")}</button>${open ? `<span class="count">${open}</span>` : ""}${errors.length ? `<span class="err-pill" data-act="console">${errors.length}</span>` : ""}`;
      return;
    }
    const tool = (t, label) => `<button data-tool="${t}" aria-pressed="${ui.mode === "draw" && ui.tool === t && !ui.picking}" title="${label}">${ic(t)}</button>`;
    bar.innerHTML = `
      <button class="grip" data-grip title="Drag to move; it docks to the nearest edge">${ic("grip")}</button>
      <button class="mode${ui.mode === "draw" ? " on" : ""}" data-act="mode" title="Interact / Draw (Alt+D)">${ui.mode === "draw" ? ic("pen") : ic("hand")}<span>${ui.mode === "draw" ? "Draw" : "Use"}</span></button>
      <button data-act="eye" aria-pressed="${!prefs.eye}" title="${prefs.eye ? "Hide" : "Show"} saved marks">${ic(prefs.eye ? "eye" : "eyeOff")}</button>
      <span class="sep"></span>
      ${tool("pen", "Pen / circle")}${tool("rect", "Rectangle")}${tool("arrow", "Arrow")}${tool("pin", "Comment pin")}
      <button data-act="pick" aria-pressed="${ui.picking}" title="Pick an element">${ic("pick")}</button>
      <span class="sep"></span>
      <span class="colors">${COLORS.map((c) => `<button class="sw" data-color="${c}" style="--c:${c}" aria-pressed="${prefs.color === c}" title="${c}"></button>`).join("")}</span>
      <span class="sizes">${Object.keys(SIZES).map((k) => `<button class="sz" data-size="${k}" aria-pressed="${prefs.size === k}">${k}</button>`).join("")}</span>
      <span class="sep"></span>
      <button data-act="undo" title="Undo" ${draft.shapes.length ? "" : "disabled"}>${ic("undo")}</button>
      <button data-act="redo" title="Redo" ${draft.redo.length ? "" : "disabled"}>${ic("redo")}</button>
      <button data-act="clear" title="Clear unsaved marks" ${draft.shapes.length || draft.target ? "" : "disabled"}>${ic("clear")}</button>
      <button class="save" data-act="save" title="Save issue" ${draft.shapes.length || draft.target ? "" : "disabled"}>${ic("save")}<span>Save</span></button>
      <span class="sep"></span>
      ${errors.length ? `<button class="err-pill" data-act="console" title="Console errors">${errors.length}</button>` : ""}
      <button data-act="drawer" aria-pressed="${ui.drawerOpen}" title="Issues">${ic("list")}${open ? `<span class="count">${open}</span>` : ""}</button>
      <button data-act="collapse" title="Collapse">${ic("min")}</button>`;
  }
  function placeBar() {
    const s = bar.style;
    s.left = s.right = s.top = s.bottom = s.transform = "";
    const pct = `${Math.round(prefs.offset * 100)}%`;
    if (prefs.edge === "left") { s.left = "8px"; s.top = pct; }
    else if (prefs.edge === "right") { s.right = ui.drawerOpen ? `${Math.min(innerWidth, 400) + 8}px` : "8px"; s.top = pct; } // beside the open drawer
    else if (prefs.edge === "top") { s.top = "8px"; s.left = pct; }
    else { s.bottom = "8px"; s.left = pct; }
    requestAnimationFrame(() => { // keep it on screen
      const r = bar.getBoundingClientRect();
      if (r.bottom > innerHeight - 4) s.top = `${Math.max(4, innerHeight - r.height - 4)}px`;
      if (r.right > innerWidth - 4) s.left = `${Math.max(4, innerWidth - r.width - 4)}px`;
    });
  }
  function paintErrorBadge() { if (bar.isConnected) paintBar(); }
  function paintAll() { paintBar(); paintLayer(); if (ui.drawerOpen) paintDrawer(); }

  /* ---------------- modes, tools ---------------- */
  function setMode(m) {
    ui.mode = m;
    if (m === "interact") { ui.picking = false; $(".pick-box").hidden = true; }
    paintBar(); paintLayer();
  }
  addEventListener("keydown", (e) => {
    if (e.altKey && e.code === "KeyD") { e.preventDefault(); setMode(ui.mode === "draw" ? "interact" : "draw"); }
    else if (e.key === "Escape" && (ui.mode === "draw" || ui.picking || !pop.hidden)) { closePop(); setMode("interact"); }
    else if ((e.ctrlKey || e.metaKey) && e.code === "KeyZ" && ui.mode === "draw") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  }, true);
  const undo = () => { if (draft.shapes.length) { draft.redo.push(draft.shapes.pop()); paintAll(); } };
  const redo = () => { if (draft.redo.length) { draft.shapes.push(draft.redo.pop()); paintAll(); } };

  bar.addEventListener("click", (e) => {
    const b = e.target.closest("button, [data-act]"); if (!b || b.dataset.grip !== undefined) return;
    const ds = b.dataset;
    if (ds.tool) { ui.tool = ds.tool; ui.picking = false; $(".pick-box").hidden = true; return setMode("draw"); }
    if (ds.color) { prefs.color = ds.color; savePrefs(); return paintBar(); }
    if (ds.size) { prefs.size = ds.size; savePrefs(); return paintBar(); }
    switch (ds.act) {
      case "mode": return setMode(ui.mode === "draw" ? "interact" : "draw");
      case "eye": prefs.eye = !prefs.eye; savePrefs(); return paintAll();
      case "pick": ui.picking = !ui.picking; $(".pick-box").hidden = true; ui.locked = null; if (ui.picking) ui.mode = "draw"; return paintAll();
      case "undo": return undo();
      case "redo": return redo();
      case "clear": draft.shapes = []; draft.redo = []; draft.target = null; return paintAll();
      case "save": return openSavePop();
      case "drawer": ui.drawerOpen = !ui.drawerOpen; ui.tab = "issues"; return paintDrawerShell();
      case "console": ui.drawerOpen = true; ui.tab = "console"; if (prefs.collapsed) { prefs.collapsed = false; savePrefs(); } return paintDrawerShell();
      case "collapse": prefs.collapsed = true; savePrefs(); setMode("interact"); return paintBar();
      case "expand": prefs.collapsed = false; savePrefs(); return paintBar();
    }
  });
  // drag the toolbar; on release it docks to the nearest edge
  bar.addEventListener("pointerdown", (e) => {
    if (!e.target.closest("[data-grip]")) return;
    e.preventDefault();
    const r0 = bar.getBoundingClientRect(), dx = e.clientX - r0.left, dy = e.clientY - r0.top;
    bar.setPointerCapture(e.pointerId);
    const move = (ev) => { Object.assign(bar.style, { left: `${ev.clientX - dx}px`, top: `${ev.clientY - dy}px`, right: "", bottom: "" }); };
    const up = (ev) => {
      bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up);
      const x = ev.clientX, y = ev.clientY;
      const d = { left: x, right: innerWidth - x, top: y, bottom: innerHeight - y };
      prefs.edge = Object.entries(d).sort((a, b) => a[1] - b[1])[0][0];
      prefs.offset = prefs.edge === "left" || prefs.edge === "right" ? Math.min(0.9, Math.max(0, (y - dy) / innerHeight)) : Math.min(0.9, Math.max(0, (x - dx) / innerWidth));
      savePrefs(); paintBar();
    };
    bar.addEventListener("pointermove", move); bar.addEventListener("pointerup", up);
  });

  /* ---------------- drawing ---------------- */
  const toDoc = (e) => { const f = frame(safeViewKey()); return [Math.round(e.clientX - f.ox), Math.round(e.clientY - f.oy)]; };
  svg.addEventListener("pointerdown", (e) => {
    if (ui.picking) return;
    if (ui.mode !== "draw") return;
    e.preventDefault();
    const key = safeViewKey();
    if (draft.key !== key) { if (draft.shapes.length && !confirm(`You have unsaved marks on ${draft.key}. Drop them and start on ${key}?`)) return; draft.shapes = []; draft.redo = []; draft.target = null; draft.key = key; }
    const p = toDoc(e), base = { color: prefs.color, strokeWidth: SIZES[prefs.size] };
    if (ui.tool === "pin") {
      const shape = { ...base, type: "pin", points: [p], text: "" };
      draft.shapes.push(shape); draft.redo = []; paintAll();
      return openPinPop(shape, e.clientX, e.clientY);
    }
    live = { ...base, type: ui.tool, points: ui.tool === "pen" ? [p] : [p, p] };
    svg.setPointerCapture(e.pointerId);
  });
  svg.addEventListener("pointermove", (e) => {
    if (ui.picking) return hoverPick(e);
    if (!live) return;
    const p = toDoc(e);
    if (live.type === "pen") { const l = live.points[live.points.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) > 2) live.points.push(p); }
    else live.points[1] = p;
    paintSoon();
  });
  const endStroke = () => {
    if (!live) return;
    const ok = live.type === "pen" ? live.points.length > 1 : Math.hypot(live.points[1][0] - live.points[0][0], live.points[1][1] - live.points[0][1]) > 6;
    if (ok) { draft.shapes.push(live); draft.redo = []; }
    live = null; paintAll();
  };
  svg.addEventListener("pointerup", endStroke);
  svg.addEventListener("pointercancel", endStroke);
  svg.addEventListener("click", (e) => { if (ui.picking) lockPick(e); });

  /* ---------------- element picker ---------------- */
  const under = (x, y) => document.elementsFromPoint(x, y).find((el) => el !== host && !host.contains(el) && el !== document.documentElement && el !== document.body);
  const label = (el) => { const r = el.getBoundingClientRect(); return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${[...el.classList].slice(0, 3).map((c) => `.${c}`).join("")} (${Math.round(r.width)}×${Math.round(r.height)}px)`; };
  function hoverPick(e) {
    if (ui.locked) return;
    const el = under(e.clientX, e.clientY), box = $(".pick-box");
    if (!el) { box.hidden = true; return; }
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    box.firstElementChild.textContent = label(el);
    box.classList.toggle("below", r.top < 26);
    box.hidden = false;
  }
  function cssSelector(el) {
    const q = (s) => { try { return document.querySelectorAll(s).length === 1; } catch { return false; } };
    if (el.id && q(`#${CSS.escape(el.id)}`)) return `#${CSS.escape(el.id)}`;
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.body; node = node.parentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
      const data = [...node.attributes].find((a) => /^data-(view|act|go|item|occ|mlook|wear|tool|disc|sort|fitlog|mangle|mpiece|swap)$/.test(a.name));
      if (data) part += `[${data.name}="${CSS.escape(data.value)}"]`;
      const cls = [...node.classList].filter((c) => !/^(on|is-|active)/.test(c)).slice(0, 2);
      if (cls.length) part += cls.map((c) => `.${CSS.escape(c)}`).join("");
      const sibs = node.parentElement ? [...node.parentElement.children].filter((s) => s.tagName === node.tagName) : [];
      if (sibs.length > 1 && !data) part += `:nth-of-type(${sibs.indexOf(node) + 1})`;
      parts.unshift(part);
      if (q(parts.join(" > "))) break;
    }
    return parts.join(" > ");
  }
  function lockPick(e) {
    const el = under(e.clientX, e.clientY); if (!el) return;
    const key = safeViewKey(), f = frame(key), r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (draft.key !== key) { draft.shapes = []; draft.redo = []; draft.key = key; }
    draft.target = {
      selector: cssSelector(el), tagName: el.tagName.toLowerCase(), classes: [...el.classList],
      textSnippet: (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 120),
      boundingRect: { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) },
      docRect: { x: Math.round(r.left - f.ox), y: Math.round(r.top - f.oy), w: Math.round(r.width), h: Math.round(r.height) },
      outerHTMLSnippet: el.outerHTML.replace(/\s+/g, " ").slice(0, 300),
      styles: Object.fromEntries(["display", "position", "z-index", "overflow", "width", "height"].map((k) => [k, cs.getPropertyValue(k)])),
    };
    // a rectangle around it, so it shows on the screenshot too
    draft.shapes.push({ type: "rect", color: prefs.color, strokeWidth: SIZES[prefs.size], points: [[draft.target.docRect.x - 3, draft.target.docRect.y - 3], [draft.target.docRect.x + r.width + 3, draft.target.docRect.y + r.height + 3]] });
    ui.picking = false; $(".pick-box").hidden = true;
    paintAll();
    openSavePop(`Picked ${label(el)}`);
  }

  /* ---------------- popovers ---------------- */
  function closePop() { pop.hidden = true; pop.innerHTML = ""; }
  function placePop(x, y) {
    pop.hidden = false;
    const r = pop.getBoundingClientRect();
    pop.style.left = `${Math.min(Math.max(8, x), innerWidth - r.width - 8)}px`;
    pop.style.top = `${Math.min(Math.max(8, y), innerHeight - r.height - 8)}px`;
  }
  function openPinPop(shape, x, y) {
    pop.innerHTML = `<b>Comment pin</b><input class="in" data-f="text" placeholder="What's wrong here?" value="${esc(shape.text)}">
      <div class="row"><button data-p="pin-del" class="ghost">Remove</button><button data-p="pin-ok" class="primary">OK</button></div>`;
    placePop(x + 16, y - 10);
    const input = pop.querySelector("input"); input.focus();
    pop.onclick = (e) => {
      const p = e.target.closest("[data-p]")?.dataset.p;
      if (p === "pin-ok") { shape.text = input.value.trim(); closePop(); paintAll(); }
      if (p === "pin-del") { draft.shapes.splice(draft.shapes.indexOf(shape), 1); closePop(); paintAll(); }
    };
    input.onkeydown = (e) => { if (e.key === "Enter") pop.querySelector('[data-p="pin-ok"]').click(); };
  }
  function openSavePop(head = "Save issue") {
    if (!draft.shapes.length && !draft.target) return toast("Draw, pin or pick something first");
    const t = draft.target, pinTexts = draft.shapes.filter((s) => s.type === "pin" && s.text).map((s) => s.text);
    pop.innerHTML = `<b>${esc(head)}</b><span class="muted">${esc(draft.key || safeViewKey())}</span>
      ${t ? `<code class="sel">${esc(t.selector)}</code>` : ""}
      <input class="in" data-f="title" placeholder="Title (what's broken)" value="${esc(pinTexts[0] || "")}">
      <textarea class="in" data-f="note" rows="4" placeholder="Note: what you expected, what happens instead"></textarea>
      <div class="row"><button data-p="keep" class="ghost">${t ? "Keep drawing" : "Cancel"}</button><button data-p="save" class="primary">Save issue</button></div>`;
    placePop(innerWidth / 2 - 170, innerHeight * 0.28);
    pop.querySelector('[data-f="title"]').focus();
    pop.onclick = async (e) => {
      const p = e.target.closest("[data-p]")?.dataset.p;
      if (p === "keep") return closePop();
      if (p === "save") {
        const title = pop.querySelector('[data-f="title"]').value.trim(), note = pop.querySelector('[data-f="note"]').value.trim();
        if (!title && !note) return pop.querySelector('[data-f="title"]').focus();
        closePop();
        await saveIssue(title || note.split("\n")[0].slice(0, 80), note);
      }
    };
  }
  function openIssuePop(id, x, y) {
    const i = issues.find((z) => z.id === id); if (!i) return;
    pop.innerHTML = `<b>#${i.n} ${esc(i.title)}</b><span class="muted">${esc(i.viewKey)} · ${new Date(i.createdAt).toLocaleString()}</span>
      ${i.note ? `<p class="note">${esc(i.note)}</p>` : ""}
      ${i.targetElement ? `<code class="sel">${esc(i.targetElement.selector)}</code>` : ""}
      <div class="row"><button data-p="del" class="ghost danger">Delete</button><button data-p="list" class="ghost">In the list</button><button data-p="fixed" class="primary">Mark fixed</button></div>`;
    placePop(x + 12, y + 12);
    pop.onclick = async (e) => {
      const p = e.target.closest("[data-p]")?.dataset.p;
      if (p === "fixed") { await setStatus(i, "fixed"); closePop(); }
      if (p === "del") { if (confirm(`Delete issue #${i.n}?`)) { await removeIssue(i); closePop(); } }
      if (p === "list") { closePop(); ui.drawerOpen = true; ui.tab = "issues"; paintDrawerShell(); root.querySelector(`[data-card="${i.id}"]`)?.scrollIntoView({ block: "center" }); }
    };
  }
  // typing in the overlay never reaches the app's keyboard shortcuts (the app sees only the host element)
  for (const el of [pop, drawer]) el.addEventListener("keydown", (e) => { if (e.key !== "Escape") e.stopPropagation(); });
  pinsEl.addEventListener("click", (e) => { const b = e.target.closest("[data-open-issue]"); if (b) { const r = b.getBoundingClientRect(); openIssuePop(b.dataset.openIssue, r.left, r.bottom); } });

  /* ---------------- saving an issue (with the annotated screenshot) ---------------- */
  async function saveIssue(title, note) {
    const key = draft.key || safeViewKey();
    const f = frame(key), sc = f.el;
    const rec = {
      id: uuid(), n: (issues.reduce((m, i) => Math.max(m, i.n || 0), 0) || 0) + 1, createdAt: new Date().toISOString(), status: "open",
      viewKey: key, title, note,
      viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio, scrollX: sc ? sc.scrollLeft : scrollX, scrollY: sc ? sc.scrollTop : scrollY },
      annotations: draft.shapes.map((s) => ({ ...s, points: s.points.map((p) => [...p]) })),
      targetElement: draft.target,
      consoleErrors: errors.slice(-10),
      screenshotBlob: null,
    };
    toast("Saving: taking the screenshot…");
    try { rec.screenshotBlob = await screenshot(rec, f); } catch (e) { origError("Dev overlay screenshot:", e); }
    await dbPut(rec);
    draft.shapes = []; draft.redo = []; draft.target = null;
    issues.push(rec);
    setMode("interact");
    paintAll();
    toast(`Saved issue #${rec.n}${rec.screenshotBlob ? "" : " (no screenshot)"}`);
  }
  let shotLib = null;
  async function screenshot(rec, f) {
    const W = innerWidth, H = innerHeight;
    let canvas = null;
    // 3D/2D canvases: draw a fresh frame and copy it into an <img> for the capture (WebGL keeps no buffer)
    const swaps = [];
    try {
      try { DEV()?.renderStages?.(); } catch {}
      for (const c of document.querySelectorAll("canvas")) {
        if (host.contains(c) || !c.width || !c.height || !visible(c)) continue;
        let url = ""; try { url = c.toDataURL("image/png"); } catch { continue; }
        const img = new Image(); img.src = url; img.className = c.className;
        img.style.cssText = c.style.cssText; img.style.width = `${c.clientWidth}px`; img.style.height = `${c.clientHeight}px`; img.style.display = getComputedStyle(c).display;
        c.after(img); const prev = c.style.display; c.style.display = "none";
        swaps.push(() => { img.remove(); c.style.display = prev; });
      }
      shotLib ||= await import(MS_URL);
      canvas = await shotLib.domToCanvas(document.body, {
        width: W, height: H, scale: 1, backgroundColor: getComputedStyle(document.body).backgroundColor || "#000",
        filter: (n) => !(n.nodeType === 1 && n.dataset?.devOverlay), features: { restoreScrollPosition: true }, timeout: 8000,
      });
    } catch (e) {
      origError("Dev overlay: screenshot fell back to marks only:", e);
      canvas = Object.assign(document.createElement("canvas"), { width: W, height: H });
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#1c1c1c"; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = "#bbb"; ctx.font = "16px system-ui, sans-serif";
      ctx.fillText(`Screenshot unavailable (${String(e?.message || e).slice(0, 80)}); marks only. View: ${rec.viewKey}`, 20, 30);
    } finally { swaps.forEach((u) => u()); }
    const ctx = canvas.getContext("2d");
    const k = canvas.width / W;
    ctx.save(); ctx.scale(k, k);
    ctx.beginPath(); ctx.rect(f.clip.x, f.clip.y, f.clip.w, f.clip.h); ctx.clip();
    rec.annotations.forEach((s) => drawShape(ctx, s, f.ox, f.oy));
    ctx.restore();
    return new Promise((res) => canvas.toBlob((b) => res(b), "image/webp", 0.82));
  }

  /* ---------------- status, delete, jump ---------------- */
  async function setStatus(i, status) { i.status = status; i.fixedAt = status === "fixed" ? new Date().toISOString() : undefined; await dbPut(i); paintAll(); }
  async function removeIssue(i) { await dbDel(i.id); issues = issues.filter((z) => z.id !== i.id); paintAll(); }
  async function jumpTo(i) {
    const base = i.viewKey.startsWith("modal:") || i.viewKey === "ambient" ? null : i.viewKey;
    try { if (base) DEV()?.goTo?.(base); } catch (e) { origError(e); }
    if (!base) toast(`${i.viewKey} is a popup: open it, and its marks show again`);
    await new Promise((r) => setTimeout(r, 250));
    const f0 = frame(i.viewKey), b = bbox(i.annotations) || (i.targetElement?.docRect && { ...i.targetElement.docRect });
    if (b && f0.el) { f0.el.scrollTop = Math.max(0, b.y - f0.el.clientHeight / 2 + b.h / 2); await new Promise((r) => setTimeout(r, 60)); }
    paintLayer();
    if (b) {
      const f = frame(i.viewKey), p = $(".pulse");
      Object.assign(p.style, { left: `${b.x + f.ox}px`, top: `${b.y + f.oy}px`, width: `${b.w}px`, height: `${b.h}px` });
      p.hidden = false; p.classList.remove("go"); void p.offsetWidth; p.classList.add("go");
      setTimeout(() => (p.hidden = true), 1800);
    }
  }

  /* ---------------- the drawer ---------------- */
  const thumbs = new Map(); // id -> object URL
  const thumb = (i) => { if (!i.screenshotBlob) return ""; if (!thumbs.has(i.id)) thumbs.set(i.id, URL.createObjectURL(i.screenshotBlob)); return thumbs.get(i.id); };
  function paintDrawerShell() { drawer.hidden = !ui.drawerOpen; paintBar(); if (ui.drawerOpen) paintDrawer(); }
  function paintDrawer() {
    const key = safeViewKey();
    const inScope = issues.filter((i) => prefs.scopeAll || i.viewKey === key);
    const nOpen = inScope.filter((i) => i.status === "open").length, nFixed = inScope.length - nOpen;
    const shown = inScope.filter((i) => prefs.filter === "all" || i.status === prefs.filter).slice().reverse();
    const tabs = `<div class="tabs"><button data-d="tab-issues" aria-pressed="${ui.tab === "issues"}">Issues</button><button data-d="tab-console" aria-pressed="${ui.tab === "console"}">Console${errors.length ? ` <span class="err-pill sm">${errors.length}</span>` : ""}</button><button data-d="close" class="x" title="Close">✕</button></div>`;
    if (ui.tab === "console") {
      drawer.innerHTML = `${tabs}<div class="row"><button data-d="copy-errors" class="primary"${errors.length ? "" : " disabled"}>Copy errors</button><button data-d="clear-errors" class="ghost">Clear</button></div>
        <div class="log">${errors.slice().reverse().map((e) => `<div class="err"><span class="muted">${new Date(e.at).toLocaleTimeString()} · ${esc(e.viewKey)}</span><b>${esc(e.message)}</b>${e.stack ? `<pre>${esc(e.stack)}</pre>` : ""}</div>`).join("") || `<p class="muted">No errors since the page loaded.</p>`}</div>`;
      return;
    }
    drawer.innerHTML = `${tabs}
      <div class="filters"><span class="seg">${[["open", `Open (${nOpen})`], ["fixed", `Fixed (${nFixed})`], ["all", "All"]].map(([k, l]) => `<button data-d="f-${k}" aria-pressed="${prefs.filter === k}">${l}</button>`).join("")}</span>
        <label class="chk"><input type="checkbox" data-d="scope" ${prefs.scopeAll ? "checked" : ""}> All views</label></div>
      <p class="muted">${prefs.scopeAll ? "Every view" : `This view: <code>${esc(key)}</code>`}</p>
      <div class="row"><button data-d="export-md" class="primary">Copy Markdown report</button><button data-d="export-shots" class="ghost">Download screenshots</button></div>
      <div class="cards">${shown.map((i) => `<article class="card${i.status === "fixed" ? " fixed" : ""}" data-card="${i.id}">
        ${i.screenshotBlob ? `<img class="thumb" src="${thumb(i)}" data-d="zoom" data-id="${i.id}" alt="Screenshot of issue ${i.n}">` : `<div class="thumb none">no screenshot</div>`}
        <div class="body"><div class="top"><b>#${i.n}</b><span class="vk">${esc(i.viewKey)}</span></div>
          <div class="title">${esc(i.title)}</div>${i.note ? `<div class="note">${esc(i.note)}</div>` : ""}
          ${i.targetElement ? `<code class="sel">${esc(i.targetElement.selector)}</code>` : ""}
          ${i.consoleErrors?.length ? `<span class="muted">${i.consoleErrors.length} console error${i.consoleErrors.length === 1 ? "" : "s"}</span>` : ""}
          <div class="acts"><label class="chk"><input type="checkbox" data-d="fixed" data-id="${i.id}" ${i.status === "fixed" ? "checked" : ""}> Fixed</label>
            <button data-d="jump" data-id="${i.id}">Jump to view</button><button data-d="copy" data-id="${i.id}">Copy for Claude</button><button data-d="del" data-id="${i.id}" class="danger">Delete</button></div></div>
      </article>`).join("") || `<p class="muted">No ${prefs.filter === "all" ? "" : prefs.filter + " "}issues ${prefs.scopeAll ? "yet" : "on this view"}.</p>`}</div>`;
  }
  drawer.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-d]"); if (!b) return;
    const d = b.dataset.d, i = b.dataset.id && issues.find((z) => z.id === b.dataset.id);
    if (d === "close") { ui.drawerOpen = false; return paintDrawerShell(); }
    if (d === "tab-issues" || d === "tab-console") { ui.tab = d.slice(4); return paintDrawer(); }
    if (d.startsWith("f-")) { prefs.filter = d.slice(2); savePrefs(); return paintDrawer(); }
    if (d === "scope") { prefs.scopeAll = b.checked; savePrefs(); return paintDrawer(); }
    if (d === "fixed" && i) return setStatus(i, b.checked ? "fixed" : "open");
    if (d === "jump" && i) return jumpTo(i);
    if (d === "copy" && i) return copy(report([i]), "Copied issue for Claude");
    if (d === "del" && i) { if (confirm(`Delete issue #${i.n}?`)) await removeIssue(i); return; }
    if (d === "zoom" && i) { const lb = $(".lightbox"); lb.firstElementChild.src = thumb(i); lb.hidden = false; return; }
    if (d === "export-md") { const open = issues.filter((z) => z.status === "open"); return open.length ? copy(report(open), `Copied ${open.length} open issue${open.length === 1 ? "" : "s"} for Claude`) : toast("No open issues"); }
    if (d === "export-shots") return downloadAll();
    if (d === "copy-errors") return copy(errors.map((x) => `[${x.at}] (${x.viewKey}) ${x.message}${x.stack ? `\n${x.stack}` : ""}`).join("\n\n"), "Copied errors");
    if (d === "clear-errors") { errors.length = 0; return paintAll(); }
  });
  $(".lightbox").addEventListener("click", () => ($(".lightbox").hidden = true));

  /* ---------------- export for Claude ---------------- */
  const shotName = (i) => `issue-${i.n}.webp`;
  function report(list) {
    const groups = new Map();
    for (const i of list) { if (!groups.has(i.viewKey)) groups.set(i.viewKey, []); groups.get(i.viewKey).push(i); }
    const kinds = (a) => Object.entries(a.reduce((m, s) => ((m[s.type] = (m[s.type] || 0) + 1), m), {})).map(([k, n]) => `${n} ${k === "pen" ? "circle/freehand" : k}`).join(", ");
    let md = `# Smart Wardrobe: UI issues to fix (${list.length})\n\n`
      + `Marked with the dev overlay on ${new Date().toLocaleString()} at ${location.origin}. `
      + `Each issue names the screen (view key: tab/sub-tab, or modal:<popup>), the viewport, and where it has one the picked element. `
      + `The annotated screenshots are the attached ${list.filter((i) => i.screenshotBlob).map(shotName).join(", ") || "(none)"}.\n`;
    for (const [key, items] of groups) {
      md += `\n## View \`${key}\` (${items.length})\n`;
      for (const i of items) {
        const v = i.viewport, t = i.targetElement;
        md += `\n### #${i.n} ${i.title}\n`;
        if (i.note) md += `\n${i.note}\n`;
        md += `\n- Status: ${i.status} · saved ${new Date(i.createdAt).toLocaleString()}\n`;
        md += `- Viewport: ${v.width}×${v.height} @${v.dpr}x, scrolled ${Math.round(v.scrollX)},${Math.round(v.scrollY)}\n`;
        if (i.annotations.length) md += `- Marks on the screenshot: ${kinds(i.annotations)}${i.annotations.some((s) => s.text) ? `; pin notes: ${i.annotations.filter((s) => s.text).map((s) => `"${s.text}"`).join(", ")}` : ""}\n`;
        if (t) {
          md += `- Element: \`${t.selector}\` (${t.tagName}, ${t.boundingRect.width}×${t.boundingRect.height}px at ${t.boundingRect.x},${t.boundingRect.y} in the viewport)\n`;
          if (t.textSnippet) md += `- Its text: "${t.textSnippet}"\n`;
          md += `- Styles: ${Object.entries(t.styles || {}).map(([k, val]) => `${k}: ${val}`).join("; ")}\n`;
          md += `\n\`\`\`html\n${t.outerHTMLSnippet}\n\`\`\`\n`;
        }
        if (i.consoleErrors?.length) md += `\nConsole errors when it was saved:\n\n\`\`\`\n${i.consoleErrors.map((e) => `[${e.at}] (${e.viewKey}) ${e.message}${e.stack ? `\n${e.stack}` : ""}`).join("\n\n")}\n\`\`\`\n`;
        if (i.screenshotBlob) md += `\nScreenshot: ${shotName(i)}\n`;
      }
    }
    return md;
  }
  async function copy(text, msg) {
    try { await navigator.clipboard.writeText(text); toast(msg); }
    catch { const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "position:fixed;opacity:0"; root.append(ta); ta.select(); document.execCommand("copy"); ta.remove(); toast(msg); }
  }
  function download(blob, name) {
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; root.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  async function downloadAll() {
    const open = issues.filter((i) => i.status === "open");
    if (!open.length) return toast("No open issues");
    download(new Blob([report(open)], { type: "text/markdown" }), "wardrobe-issues.md");
    const json = open.map(({ screenshotBlob, ...rest }) => ({ ...rest, screenshot: screenshotBlob ? shotName(rest) : null }));
    download(new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), origin: location.origin, issues: json }, null, 2)], { type: "application/json" }), "wardrobe-issues.json");
    for (const i of open) if (i.screenshotBlob) { await new Promise((r) => setTimeout(r, 350)); download(i.screenshotBlob, shotName(i)); }
    toast(`Downloaded the report and ${open.filter((i) => i.screenshotBlob).length} screenshot(s)`);
  }

  /* ---------------- follow the app: views, popups, scrolling ---------------- */
  new MutationObserver(paintSoon).observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  new MutationObserver(paintSoon).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class", "aria-current"] });
  addEventListener("scroll", paintSoon, { capture: true, passive: true });
  addEventListener("resize", () => { placeBar(); paintSoon(); });
  addEventListener("wardrobe:view", paintSoon);

  paintBar();
  loadIssues().catch((e) => origError("Dev overlay DB:", e));
  console.info("Dev overlay on (localhost). Alt+D: draw, Esc: back to the app.");
  return { getCurrentViewKey, issues: () => issues, errors, setMode, report: () => report(issues.filter((i) => i.status === "open")), root };

  /* ---------------- styles (Shadow DOM only) ---------------- */
  function STYLES() {
    return `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    button { font: inherit; color: inherit; cursor: pointer; }
    svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
    .layer { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; overflow: visible; }
    .layer.drawing { pointer-events: auto; cursor: crosshair; touch-action: none; }
    .layer path, .layer rect, .layer circle { vector-effect: non-scaling-stroke; }
    .pins { position: fixed; inset: 0; pointer-events: none; }
    .badge { position: fixed; pointer-events: auto; min-width: 30px; height: 24px; padding: 0 8px; border-radius: 12px; border: 2px solid #fff;
      background: #ff3b30; color: #fff; font-size: 12px; font-weight: 700; box-shadow: 0 2px 8px rgba(0,0,0,.45); }
    .pick-box { position: fixed; pointer-events: none; border: 2px solid #32ade6; background: rgba(50,173,230,.12); border-radius: 3px; }
    .pick-label { position: absolute; left: -2px; top: -24px; white-space: nowrap; background: #32ade6; color: #001018; font: 600 12px/20px ui-monospace, Menlo, monospace; padding: 0 6px; border-radius: 4px; }
    .pick-box.below .pick-label { top: auto; bottom: -24px; }
    .pulse { position: fixed; pointer-events: none; border: 3px solid #ffcc00; border-radius: 10px; }
    .pulse.go { animation: pulse 1.6s ease-out; }
    @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(255,204,0,.8); opacity: 1; } 70% { box-shadow: 0 0 0 22px rgba(255,204,0,0); } 100% { opacity: 0; } }
    .bar { position: fixed; pointer-events: auto; display: flex; gap: 4px; align-items: center; padding: 6px; border-radius: 14px;
      background: rgba(22,22,24,.94); color: #eee; border: 1px solid rgba(255,255,255,.12); box-shadow: 0 8px 28px rgba(0,0,0,.45); backdrop-filter: blur(8px); user-select: none; }
    .bar.v { flex-direction: column; max-height: calc(100vh - 16px); overflow-y: auto; scrollbar-width: none; }
    .bar.h { flex-direction: row; max-width: calc(100vw - 16px); overflow-x: auto; scrollbar-width: none; }
    .bar button { position: relative; width: 36px; height: 36px; border-radius: 9px; border: 0; background: transparent; display: grid; place-items: center; flex: 0 0 auto; }
    .bar button:hover { background: rgba(255,255,255,.08); }
    .bar button[aria-pressed="true"] { background: #ff3b30; color: #fff; }
    .bar button:disabled { opacity: .35; cursor: default; }
    .bar .grip { cursor: grab; height: 22px; opacity: .6; touch-action: none; }
    .bar.h .grip { width: 22px; height: 36px; }
    .bar .mode, .bar .save { width: auto; padding: 0 8px; display: flex; gap: 4px; font-size: 12px; font-weight: 600; }
    .bar.v .mode, .bar.v .save { width: 36px; padding: 0; flex-direction: column; gap: 0; font-size: 9px; height: 42px; }
    .bar .mode.on { background: #32ade6; color: #001018; }
    .bar .save:not(:disabled) { background: #34c759; color: #031; }
    .sep { flex: 0 0 auto; background: rgba(255,255,255,.14); }
    .bar.v .sep { width: 22px; height: 1px; margin: 2px 0; } .bar.h .sep { width: 1px; height: 22px; margin: 0 2px; }
    .colors, .sizes { display: flex; gap: 3px; } .bar.v .colors, .bar.v .sizes { flex-direction: column; }
    .bar .sw { width: 22px; height: 22px; border-radius: 50%; background: var(--c); border: 2px solid rgba(0,0,0,.4); }
    .bar .sw[aria-pressed="true"] { background: var(--c); outline: 2px solid #fff; outline-offset: 1px; }
    .bar .sz { width: 26px; height: 24px; font-size: 11px; font-weight: 700; }
    .count { position: absolute; top: -4px; right: -4px; min-width: 16px; height: 16px; border-radius: 8px; background: #ffcc00; color: #000; font-size: 10px; font-weight: 800; display: grid; place-items: center; padding: 0 3px; }
    .err-pill { background: #ff3b30 !important; color: #fff; font-size: 11px; font-weight: 800; border-radius: 999px !important; height: 22px !important; min-width: 26px; width: auto !important; padding: 0 7px; display: grid; place-items: center; cursor: pointer; }
    .err-pill.sm { display: inline-grid; height: 18px !important; font-size: 10px; margin-left: 4px; }
    .bar.collapsed button[data-act="expand"] { width: 40px; height: 40px; }
    .pop { position: fixed; pointer-events: auto; width: 340px; display: grid; gap: 8px; padding: 14px; border-radius: 14px; background: #1c1c1e; color: #eee;
      border: 1px solid rgba(255,255,255,.14); box-shadow: 0 12px 40px rgba(0,0,0,.55); font-size: 14px; }
    .in { -webkit-user-select: text; user-select: text; width: 100%; padding: 9px 10px; border-radius: 8px; border: 1px solid #3a3a3c; background: #2c2c2e; color: #fff; font: inherit; resize: vertical; }
    .row { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
    .row button, .acts button, .tabs button, .seg button { border-radius: 8px; border: 1px solid #3a3a3c; background: #2c2c2e; color: #eee; padding: 7px 11px; font-size: 13px; }
    button.primary { background: #ff3b30; border-color: #ff3b30; color: #fff; font-weight: 600; }
    button.ghost { background: transparent; }
    button.danger { color: #ff6961; }
    button:disabled { opacity: .4; }
    .muted { color: #9a9aa0; font-size: 12px; }
    code, .sel { font: 12px/1.4 ui-monospace, Menlo, monospace; color: #7fd1ff; background: rgba(50,173,230,.1); padding: 2px 6px; border-radius: 5px; word-break: break-all; }
    .note { white-space: pre-wrap; color: #ccc; font-size: 13px; margin: 0; }
    .drawer { position: fixed; pointer-events: auto; top: 0; right: 0; bottom: 0; width: min(400px, 100vw); background: #141416; color: #eee; border-left: 1px solid #2c2c2e;
      box-shadow: -10px 0 40px rgba(0,0,0,.5); display: flex; flex-direction: column; gap: 10px; padding: 12px; overflow-y: auto; font-size: 14px; }
    .tabs { display: flex; gap: 6px; } .tabs .x { margin-left: auto; }
    .tabs button[aria-pressed="true"], .seg button[aria-pressed="true"] { background: #eee; color: #111; border-color: #eee; }
    .filters { display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap; } .seg { display: flex; gap: 4px; }
    .chk { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; cursor: pointer; }
    .cards { display: grid; gap: 10px; }
    .card { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 10px; padding: 10px; border-radius: 12px; background: #1c1c1e; border: 1px solid #2c2c2e; }
    .card.fixed { opacity: .55; } .card.fixed .title { text-decoration: line-through; }
    .thumb { width: 110px; height: 140px; object-fit: cover; object-position: top; border-radius: 8px; background: #000; cursor: zoom-in; }
    .thumb.none { display: grid; place-items: center; color: #666; font-size: 11px; cursor: default; }
    .body { display: grid; gap: 5px; align-content: start; min-width: 0; }
    .top { display: flex; gap: 8px; align-items: center; } .vk { font: 11px ui-monospace, Menlo, monospace; background: #2c2c2e; padding: 2px 6px; border-radius: 5px; }
    .title { font-weight: 600; }
    .acts { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; } .acts button { padding: 5px 8px; font-size: 12px; }
    .log { display: grid; gap: 8px; } .err { display: grid; gap: 3px; padding: 8px; border-radius: 8px; background: #2a1414; border: 1px solid #4a1f1f; }
    .err pre { margin: 0; white-space: pre-wrap; font: 11px/1.35 ui-monospace, Menlo, monospace; color: #f2b8b5; max-height: 160px; overflow: auto; }
    .lightbox { position: fixed; inset: 0; pointer-events: auto; background: rgba(0,0,0,.85); display: grid; place-items: center; cursor: zoom-out; }
    .lightbox img { max-width: 94vw; max-height: 94vh; border-radius: 8px; }
    .toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); background: #2c2c2e; color: #fff; padding: 10px 16px; border-radius: 999px; font-size: 13px; box-shadow: 0 6px 20px rgba(0,0,0,.4); }
    [hidden] { display: none !important; }`;
  }
}
