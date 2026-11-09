// Starts the service worker (sw.js, the offline cache of the app's files) and moves the app to a
// new deploy at a quiet moment: while the app is in the background, or when nobody has touched the
// screen for 2 minutes and nothing is open (a sheet, the cut-out editor, a text field). The page
// then reloads once, so it never runs a mix of old and new files. New deploys are looked for when
// the app opens, every 30 minutes and when it comes back to the front.
(() => {
  const sw = navigator.serviceWorker;
  if (!sw || !window.isSecureContext || window.top !== window) return;

  const QUIET_MS = 2 * 60_000;
  const CHECK_MS = 30 * 60_000;
  let touched = Date.now();
  let controlled = !!sw.controller;
  let reloadDue = false;
  let reloading = false;
  let lastCheck = Date.now();
  let reg = null;

  for (const type of ["pointerdown", "keydown", "wheel", "touchstart"]) {
    addEventListener(type, () => { touched = Date.now(); }, { capture: true, passive: true });
  }

  const busy = () => {
    const el = document.activeElement;
    if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return true;
    return [...document.querySelectorAll("dialog[open], [aria-modal='true']")].some((d) => d.getClientRects().length > 0);
  };
  const quiet = () => document.visibilityState === "hidden" || (Date.now() - touched >= QUIET_MS && !busy());

  const tick = () => {
    if (reloadDue && !reloading && quiet()) {
      reloading = true;
      location.reload();
    } else if (reg?.waiting && sw.controller && !reloadDue && quiet()) {
      reg.waiting.postMessage("activate-now");
    }
  };
  const check = () => {
    lastCheck = Date.now();
    reg?.update().catch(() => {});
  };

  // The first service worker only takes the page over (nothing to reload); every later one is a
  // new deploy, which the page picks up by reloading.
  sw.addEventListener("controllerchange", () => {
    if (!controlled) {
      controlled = true;
      return;
    }
    reloadDue = true;
    tick();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastCheck > 5 * 60_000) check();
    tick();
  });
  setInterval(() => {
    if (Date.now() - lastCheck >= CHECK_MS) check();
    tick();
  }, 15_000);

  const start = () => {
    sw.register("sw.js", { updateViaCache: "none" })
      .then((r) => {
        reg = r;
        r.addEventListener("updatefound", () => r.installing?.addEventListener("statechange", tick));
        tick();
      })
      .catch((e) => console.warn("Offline cache not started:", e));
  };
  if (document.readyState === "complete") start();
  else addEventListener("load", start, { once: true });
})();
