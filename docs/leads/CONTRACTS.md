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

_To be added by the Stylist lead._

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
