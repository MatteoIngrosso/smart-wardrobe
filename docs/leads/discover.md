# Discover lead: plan

Owner: the Discover lead thread ("Lead Discover for new pieces"). Re-read this file at the start of every session.
Shared interfaces with the other leads (UI/UX, Avatar, Stylist) live in `docs/leads/CONTRACTS.md`, created by the UI/UX lead; add the Discover section once it exists.

## What Discover owns

- Discover tab: For you (on-device audit + "What do you need?"), Must-Buy, Events, Explore (Try a piece, Shop trip, New look).
- Product photos and real products: Worker `GET /api/products` (SerpApi Google Shopping, D1 `products`, 14 days), `GET /api/page`, the Gemini search fallback in `realPhotos()`.
- The `wants` collection (Must-Buy, Yes/No verdicts, Outfit Multiplier) and "Bought it".
- Finding a new piece's data: Add > Scan the label (`label.js`, `/api/photos`, `/api/lens`) and Add > Paste a link (`/api/link`).
- Rules: menswear by default (`forWho()`, `shopperText()`, Settings > Look > Shop for), free tiers only, no paid APIs.

## Audit (2026-11-20, main aae4dbd)

Tests in my area pass: label 17/17, link 6/6, photos 7/7, backup 9/9, integration 12/12.

1. **The 250 free SerpApi searches a month can run out fast, silently.** Every picture tile on screen starts its own Google Shopping search (`prodAttr()` / `watchTiles()`), and each idea shows 3 colour versions, so a first visit to For you (up to 12 ideas) can cost about 36 searches. Must-Buy and Today's buy rows add more. Label scan, Google Lens and Paste a link use the same 250. Nothing counts them; when they run out, tiles quietly fall back to drawings and scanning a label gets worse.
2. **"Bought it" forgets the product.** Must-Buy > Bought it opens Add with only the type and colour. Real photos already know the exact product page, which Paste a link can turn into a full piece (brand, price, piece-only photos).
3. **Wants don't keep a product or a price.** The products have prices, but Must-Buy shows none, has no budget, and can't sort by value.
4. **Discover is about 2,400 lines inside app.js (11,400 lines)**, mixed in with Calendar and Fit check. With four leads editing app.js at once, merge conflicts will be constant.
5. **No Discover tests.** `tools/audit-sim.mjs` covers outfit ideas, not shopping (menswear in every search, cache keys, Must-Buy order, the search budget).
6. **Paste a link with a `share.google` link was never checked live** (the cloud can't open it). Needs one real try on Matteo's PC or iPad.

## Plan (one PR each, auto-merge when tests pass)

1. **Move Discover into its own screen file.** No behaviour change. Waits for the UI/UX lead's split of app.js into `ui/` + `screens/` (their first PR): Discover then goes where their screen registry says. Add `tools/discover.test.mjs`. Until that split merges, no large app.js edits from this lead.
2. **Search budget.** Only the colour on screen loads its photo (others on tap). A monthly counter in D1 plus SerpApi's free account check (doesn't use a search) shown in Settings > Look ("118 of 250 searches left, resets 1 Dec"). Keep about 60 a month for Add (label, Lens, link) so Discover can't use them up.
3. **"Bought this one".** On a real product card and on Must-Buy: opens Add by link with that product's page, so everything is filled in. The want keeps `product {url, shop, price, image}`.
4. **Prices and budget.** Must-Buy shows the price of the chosen product; an optional budget per type in Settings; sort by new outfits per euro. Prices refresh only when the 2-week cache expires (no extra searches).
5. **Check Paste a link live** with a real `share.google` link from Matteo's phone, and fix what it shows.

Later, only if Matteo wants them: Must-Buy on the wall screen (with the UI/UX lead), "try it on" a Must-Buy piece on the avatar (with the Avatar lead).

## Status

- 2026-11-20: audit done, plan sent to Matteo. Waiting for his go before any PR.
- 2026-11-23: Discover section added to CONTRACTS.md on this branch (goes to main with the first Discover PR). UI/UX app.js split not started yet; step 1 still waits for it.
- 2026-11-23: Stylist lead agreed on the wants/search contract (Stylist section, PR #97). Bible weights changed in #90/#91 (shape same, +N counts may shift). After the UI split the engine moves to stylist-engine.js with goesWith(piece, { occasion }); switch multiplier() to it when they message.
- 2026-11-25: UI/UX PR #100 dev overlay reads Discover sub-views from state.disc.tab via window.__wardrobeDev in app.js: if a Discover tab is added or renamed, update sub()/goTo() there too (CONTRACTS.md "Dev overlay").
