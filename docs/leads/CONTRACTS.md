# Cross-lead contracts

The shared rules between the four lead threads: **UI/UX**, **Avatar**, **Stylist**, **Discover**.
Each lead's own plan lives in `docs/leads/<area>.md`. This file holds only what more than one lead depends on:
data shapes, shared screens and components, APIs between modules.

**How to change it:** edit the section you own in your PR, say so in the PR description, and message every lead
whose code uses what changed. Changing another lead's section needs that lead's agreement first.

Common rules for everyone: branch + PR per update, auto-merge when tests pass, no paid APIs (free tiers only),
menswear by default, read project memory at the start of a session.

---

## UI/UX (owner: UI/UX lead)

Status: proposed 2026-11-20. Becomes binding once the app.js split (UI plan step 1) merges.
Until then, other leads should avoid large edits to `app.js` so the split lands cleanly.

### Screens
- Screens register with the shell: `registerScreen(id, { title, render(main), dock?: { icon, label, order } })`.
- Only the UI lead changes the dock (which tabs exist and their order) and the router (`go()` / `render()`).
- Screen ids today: `today`, `plan` (Calendar), `wardrobe`, `add`, `shop` (Discover), `settings`. Planned: `mirror`, `trainer`.
- Full-screen screens with no dock tab register with `{ fullscreen: true }`: the shell hides the dock, adds a close (X, top left)
  and returns to the screen that opened it. Open them with `go(id)` or a `data-go="<id>"` button.

### Style Trainer (parked 2026-11-21, spec only; UI owns the screen, Stylist the learning)
- `style-trainer.js` exports `open(container)`; registered as screen `trainer`, `{ fullscreen: true }`.
- Entry points: a "Taste" button in the Today header next to "New ideas", and a row in Settings > Look. No dock tab.
- The card area sets `touch-action: none` itself (the app default is `pan-x pan-y`). Swipes always have tap buttons
  too (Pass, Almost, Like, 56 px), for the kiosk and for people who don't swipe.
- Card: garments on paper tiles, one outfit per card, sized to fit 1024x1366 and 800x1280 without scrolling.

### Dev overlay (localhost only)
- `dev-overlay.js` (UI lead) loads only on localhost and is listed in `.assetsignore`. It names screens with
  `window.__wardrobeDev` (in app.js, localhost only): `view`, `sub()` (Wardrobe report/fragrances, Discover's tab),
  `goTo("view/sub")`, `renderStages()`. A new tab or sub-tab: keep `sub()` and `goTo()` in step.
- Popups are named from the sheet: give a new sheet a distinctive class or a first heading so its view key is stable.

### Slots
- Screens that show another lead's work expose mount points. The owning lead fills the slot;
  the UI lead decides its size and position.
  - `#mirror-slot` (Avatar): the 3D Avatar / Lookbook stage, on Today (preview) and the Mirror tab.
  - `#ideas-slot` (Stylist): today's outfit ideas.
  - `#ask-slot` (Stylist): Ask the stylist.
  - The Discover screen's tab content (Discover).

### Shared components (UI lead owns, everyone calls)
- `outfitCard(outfit, opts)`, `pieceTile(item, opts)`, `chips(items, opts)`, `emptyState(title, text, actions)`,
  `openSheet(html)`, `toast(msg, action)`.
- Changing their arguments or output is a contract change: update this section and message the affected leads.

### Styling
- No hex colours and no inline `style="..."` in new code. Use tokens (`var(--...)`) and classes.
- New tokens are added by the UI lead (ask in its thread).
- Garment photos sit on the light "paper" tile token in every theme.

### Sizes
- Every screen must work at **1024x1366** portrait (iPad Air 13", dev screen) and **800x1280** portrait
  (Pi Touch Display 2, kiosk `?kiosk=1`). Touch targets 48 px or more. No horizontal page scroll.
- Once `tools/ui-shots.mjs` exists (UI plan step 2), run it in any PR that changes what a screen looks like
  and attach the before/after.

---

## Avatar (owner: Avatar lead)

_To be added by the Avatar lead._

## Stylist (owner: Stylist lead)

Status: written 2026-11-23. Plan: `docs/leads/stylist.md`. The engine still lives in `app.js`; it moves to
`stylist-engine.js` (pure, no DOM) after the UI split merges, and this section then gives its final API.

### What the Stylist owns
- The outfit engine (`ideaPool`, `scoreOutfit`, `pickIdeas`, `generateOutfits`, `dressLevel`, `sense`,
  `weatherPieces`, `coatFor`, `extrasFor`, `withLoved`, `withShorts`), learning (`taste`, `tasteScore`, `tasteText`),
  Ask the stylist (`stylist-chat.js`, `stylistSystem`, `chatSystem`, `wardrobeText`), Fit Check and
  StylistBrain (`stylist-brain.js`), Calendar picks (`suggestDay`, `nextIdea`) and laundry (`wearable`, `wash`).
- The fashion bible: `stylist.js` (JS checks) + root `fashion-bible.json`, both built from `fashion-model/`
  (Python). The JS checks must stay identical to `fashion/rules.py`: change both, then `python -m fashion parity`
  and `node --test tools/stylist.test.mjs`. `python -m fashion bench` must not drop.
- `tools/audit-sim.mjs` thresholds (25 checks on a real backup). Any PR that touches ranking runs it.

### Engine API others call (planned module `stylist-engine.js`; same names in `app.js` until then)
- `ideas({ occasion, level, feels, wet, anchor, avoid, n })` → outfits `{ key, pieces: { base, mid, outer, bottom, shoes },
  coat, extras, score, reasons, warn, level }`. Today, Calendar, Try a piece and the mirror all use it.
- `score(pieces, { occasion, feels, wet })` → `{ score, reasons, broken }`; `level(pieces)` → 1-5.
- `goesWith(piece, { occasion })` → how many good outfits a piece (owned or not) makes: Discover's "goes with N"
  and Outfit Multiplier (`multiplier`, `ownsLike`, `auditFeed` today).
- Discover and UI never re-rank outfits themselves: ask the engine. Weather comes from `conditions()` (UI owns
  the weather widget, the Stylist owns what the numbers mean for clothes).

### Data the Stylist reads and writes (changing a shape is a contract change)
- Items: reads `category, colors, fit, styles, tags, warmth, formality, look, suit, rating, favorite, disliked,
  wash, wornSinceWash, everyday, leather, metal, fastening`; writes `rating, disliked, wash, wornSinceWash, fit,
  look, suit` (the item page UI calls the Stylist's functions for these).
- Log entries (`state.log`, shared): no `kind` = a wear `{ date, at, itemIds, occasion, feels, source }`; `like`, `rate`
  `{ stars }`, `skip` `{ reason }`, `swap` `{ removed, added }`, `scent`. Discover writes its own kinds; the Stylist
  only learns from these.
- Shared kv: `days` (Calendar plans, ids only via `makeEntry`/`entryIds` in `calendar.js`), `plan`, `brain`
  (StylistBrain summaries), `calendar` (iCal links + event occasions).
- `wants` (Must-Buy) belongs to Discover: only Discover writes it (`answerWant`). The Stylist reads Must-Buy
  and recent No's for its prompt, and a buy idea from the stylist goes through Discover's `verdictHTML` / `data-yes`.
  Product searches (SerpApi, 250 a month shared) are asked of the Discover lead. A change to how outfits are
  scored or counted (`generateOutfits`, `multiplier`, the bible) is messaged to the Discover lead, so Must-Buy's
  "+N outfits" stays right.
- Fit check records `fit:<id>` with per-piece `wear` `{ close: open|buttoned|closed, tuck: in|out|half,
  sleeves: down|rolled, break: none|slight|full }` (`Brain.WEAR`). The Stylist decides the values; the Avatar
  draws them and owns the words shown (`Avatar.closeWord`: "Half-zipped" / "Zipped up" when `fastening` is zip).

### Slots and screens
- The Stylist fills `#ideas-slot` (outfit idea cards, via the UI's `outfitCard`) and `#ask-slot` (Ask the stylist).
- Style Trainer (parked): Stylist owns how swipes feed `taste()`: a swipe logs `like` / `skip` with
  `source: "trainer"` at half a wear's weight.

### AI use
- All Gemini calls go through `aiGenerate` (free tier, key on the server). Stylist prompts start with the
  stable part (instructions, the bible's rules, the wardrobe) and end with what the question changes, so
  Gemini's cache can reuse the start. About 2,000-2,600 tokens in per question with 86 pieces; keep new
  prompts inside that.

## Discover (owner: Discover lead)

Status: proposed 2026-11-23 (shapes as they are on main today). Names may move into a Discover screen file after the
app.js split; the shapes and calls below stay the same.

### A buy idea (what any screen passes to Discover)
- `mkIdea({ cat, color, noun, brand, fit, title, why, styles })` → `{ title, cat, color, noun, query, why, styles, ... }`.
  `cat` is a `CAT` id, `color` a colour name from `COLORS`, `query` the shop search words (menswear is added later by
  `forWho()`, so don't put "men" in it). `asPiece(b)` turns it into a virtual item for outfit scoring.
- A buy idea's identity is `wantId(b)` = hash of `cat|noun|color`: same piece, same want, from any screen.

### Wants (Must-Buy), collection `wants`, synced by the Worker like items
`{ id, sig, kind: garment|accessory|fragrance, title, cat, noun, color, fit, styles, query, why,
   source: { type: foryou|try|look|trip|today|touch|event|wishlist|scent }, status: wanted|rejected|snoozed|bought,
   reason?: style|colour|similar|price|later, until?, eventId?, needBy?, scent?, boughtItemId?, createdAt, decidedAt }`
- Only Discover writes wants, through `answerWant(b, status)`. Other screens show a Yes/No with `verdictHTML(b)`
  (taps `data-yes` / `data-no`) and Discover saves it. Pass `source` and, for an event, `eventId` + `needBy`.
- Planned (Discover plan step 3-4, additive): `product?: { url, shop, price, image, at }`.
- Stylist reads wants (the stylist prompt lists Must-Buy and recent No's with reasons); it doesn't write them. Add sets `boughtItemId` when a bought want is saved as a piece.

### Buy tiles and rows (Discover owns the content, UI the look)
- `buyTile(b)`, `buyRow(b, { label, shops, extra })`, `artTile(b)`: a drawing of the piece, with a real product photo
  on top when SerpApi is on. Today, the stylist and events use them; keep calling these, not your own markup.
- Tiles that carry `data-prod` load their photo when on screen (`watchTiles()` after render). Each such tile can cost
  one search, see the budget below.

### Searches (SerpApi free plan: 250 a month for the whole app)
- Worker `GET /api/products?q&gl&hl` (Google Shopping), `/api/photos` (Google Images), `/api/lens` (Google Lens),
  `/api/link`, `/api/page`. Results of products/photos are kept 14 days in D1, shared by every device.
- Only Discover code calls these. Another lead that needs a product search asks in the Discover thread, so the
  monthly budget stays in one place (Discover plan step 2 adds a counter and keeps ~60 a month for Add).
- Gemini search fallback (`realPhotos()`) is free-tier only, one call per tap, never on render.

### Uses from other leads
- Outfit Multiplier (`multiplier(b)`) and the For you audit score with the Stylist's fashion bible and `generateOutfits`
  pieces; a change to those rules can change Discover's counts. Stylist lead: please message Discover when the
  scoring a want depends on changes shape.
- The Discover screen (`shop`) and its tab content follow the UI section above.
