// Run with:  node --test tools/link.test.mjs
// GET /api/link (worker/api.js): where a pasted link really goes. Short links are followed one hop
// at a time (fetch is replaced here: nothing leaves the machine), Google pages give the shop link
// inside them or the words searched, and only public web addresses are opened.
import assert from "node:assert/strict";
import test from "node:test";
import { resolveLink } from "../worker/api.js";

const real = globalThis.fetch;
// Each address answers from this table: a redirect (string), an HTML page ({html}) or a status.
function serve(table) {
  const asked = [];
  globalThis.fetch = async (u, opts = {}) => {
    const href = String(u.href || u);
    asked.push(href);
    assert.equal(opts.redirect, "manual", "redirects are followed by hand, one hop at a time");
    const a = table[href];
    if (a === undefined) return new Response("", { status: 404 });
    if (typeof a === "string") return new Response(null, { status: 302, headers: { Location: a } });
    if (a.html) return new Response(a.html, { status: 200, headers: { "Content-Type": "text/html" } });
    return new Response("", { status: a.status });
  };
  return asked;
}
const read = async (raw) => { const r = await resolveLink(raw); return { status: r.status, ...(await r.json()) }; };
test.after(() => { globalThis.fetch = real; });

const BOSS = "https://www.hugoboss.com/it/camicia-slim-fit-in-cotone-elasticizzato/hbeu50525359_100.html";

test("a share link that leads to the shop", async () => {
  const asked = serve({ "https://share.google/H3toR0wOO1aU6OEhX": BOSS });
  const r = await read("https://share.google/H3toR0wOO1aU6OEhX");
  assert.equal(r.kind, "shop");
  assert.equal(r.url, BOSS);
  assert.deepEqual(asked, ["https://share.google/H3toR0wOO1aU6OEhX"], "the shop itself isn't opened here");
});

test("a share link that leads to a Google search: the words searched", async () => {
  serve({ "https://share.google/abc": "https://www.google.com/search?q=BOSS+-+Camicia+slim+fit+in+cotone+elasticizzato+-+Bianco&ibp=oshop&prds=catalogid:1" });
  const r = await read("https://share.google/abc");
  assert.equal(r.kind, "google");
  assert.equal(r.query, "BOSS - Camicia slim fit in cotone elasticizzato - Bianco");
});

test("Google pages with the shop's address inside, a consent page, and a page redirect", async () => {
  const asked = serve({
    "https://share.google/c": "https://consent.google.com/ml?continue=https://www.google.com/url?q%3D" + encodeURIComponent(BOSS),
    "https://bit.ly/x": { html: `<html><head><meta http-equiv="refresh" content="0; url=${BOSS}"></head></html>` },
    "https://amzn.eu/d/y": { html: `<script>window.location.replace("https:\\/\\/www.amazon.it\\/dp\\/B0ABC");</script>` },
  });
  assert.equal((await read("https://www.google.com/url?q=" + encodeURIComponent(BOSS) + "&sa=U")).url, BOSS);
  assert.equal((await read("https://www.google.it/imgres?imgurl=x&imgrefurl=" + encodeURIComponent(BOSS))).url, BOSS);
  const c = await read("https://share.google/c");
  assert.equal(c.kind, "shop");
  assert.equal(c.url, BOSS);
  assert.ok(!asked.some((u) => /consent|google\.com/.test(u)), "Google's own pages are never opened");
  assert.equal((await read("https://bit.ly/x")).url, BOSS);
  assert.equal((await read("https://amzn.eu/d/y")).url, "https://www.amazon.it/dp/B0ABC");
});

test("a plain shop link isn't opened, and only public web addresses are", async () => {
  const asked = serve({});
  assert.equal((await read(BOSS)).kind, "shop");
  assert.equal(asked.length, 0);
  for (const bad of ["ftp://x.com/a", "javascript:alert(1)", "http://127.0.0.1/a", "http://localhost/a", "https://x.com:8443/a", "https://user:pw@x.com/", "not a link"]) {
    assert.equal((await read(bad)).status, 400, bad);
  }
  serve({ "https://bit.ly/in": "http://10.0.0.1/admin" });
  assert.equal((await read("https://bit.ly/in")).status, 400, "a redirect into a private address is refused");
});

test("a loop stops after 5 hops, a dead link says so", async () => {
  serve({ "https://bit.ly/a": "https://tinyurl.com/b", "https://tinyurl.com/b": "https://bit.ly/a" });
  const r = await read("https://bit.ly/a");
  assert.equal(r.status, 502);
  assert.match(r.error, /circles/);
  serve({});
  assert.match((await read("https://share.google/gone")).error, /doesn't work any more/);
});

// GET /api/page with a code from the link (Hugo Boss hbeu<model>_<colour>): every photo of this
// shirt in this colour from its image server, which names photos without a file type.
test("a Hugo Boss page gives every photo of the product in its colour", async () => {
  const { handleApi } = await import("../worker/api.js");
  const img = (v, c = "100") => `https://images.hugoboss.com/is/image/boss/hbeu50525359_${c}_${v}?$re_fullPageZoom$&amp;qlt=85&amp;wid=1200`;
  const html = `<html><head><title>BOSS - Camicia slim fit in cotone elasticizzato - Bianco</title>
    <meta property="og:title" content="BOSS - Camicia slim fit in cotone elasticizzato - Bianco">
    <meta property="og:image" content="https://images.hugoboss.com/is/image/boss/hbeu50525359_100_100?$social_sharing$">
    <script type="application/ld+json">{"@type":"Product","name":"Camicia slim fit","brand":{"name":"BOSS"},"offers":{"price":"199.95","priceCurrency":"EUR"}}</script></head>
    <body>${["100", "200", "300", "340"].map((v) => `<img src="${img(v)}">`).join("")}<img src="${img(200, "455")}">
    <img src="https://images.hugoboss.com/is/image/boss/hbeu50525359_100_SW"></body></html>`;
  globalThis.fetch = async (u) => (String(u.href || u).startsWith("https://www.hugoboss.com/")
    ? new Response(html, { headers: { "Content-Type": "text/html" } })
    : new Response("", { status: 404 }));
  const page = "https://www.hugoboss.com/it/camicia/hbeu50525359_100.html";
  const r = await handleApi(new Request(`https://app.example/api/page?url=${encodeURIComponent(page)}&code=hbeu50525359_100`), {});
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.equal(j.price, "199.95 EUR");
  const views = j.images.map((u) => u.match(/hbeu\d+_(\d+_\w+)/)?.[1]);
  for (const v of ["100_100", "100_200", "100_300", "100_340"]) assert.ok(views.includes(v), `${v} in ${views}`);
  assert.ok(!views.includes("455_200"), "not the other colour");
  assert.ok(!views.some((v) => /_SW$/i.test(v)), "not the colour swatches");
  assert.ok(j.images.every((u) => u.includes("$")), "Scene7 preset names stay as written");
});
