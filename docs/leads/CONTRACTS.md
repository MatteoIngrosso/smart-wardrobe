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

### Style Trainer (Stylist owns the module, UI owns the placement)
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

_To be added by the Discover lead._
