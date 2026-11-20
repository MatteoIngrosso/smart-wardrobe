# UI/UX lead: plan

Owner: the "Lead UI/UX for the app" thread. Re-read this file at the start of every session and keep it current.
Status: **proposal, waiting for Matteo's go** (2026-11-20). No PRs until he says go.

## What this lead owns

- The app shell: `index.html`, the nav (`#nav`), the router (`go()` / `render()` in `app.js`), the sheet and toast.
- Design tokens and shared styles: `styles.css`, `kiosk.css`, the look ("Showroom Night" mockup, https://claude.ai/artifact/PYsbyoN5x5ao6PxkKpptn9).
- Layout of every screen at the two target sizes: iPad Air 13" portrait 1024x1366 (dev screen) and the Pi Touch Display 2 10.1" portrait 800x1280 (kiosk, `?kiosk=1`).
- Shared components other leads render into: outfit card, piece tile, chips/segments, empty state, sheet, toast.
- Screens with no other owner: Today (layout), Wardrobe, Add, Calendar (layout), Settings, the ambient screen.

Other leads own what goes *inside* their slots: Avatar = the Mirror stage (`avatar-stage.js`, `lookbook-stage.js`, `garment-baker.js`); Stylist = ideas, Fit check, Ask the stylist, fashion model; Discover = the Discover screen's tabs and shopping.

## Audit (main aae4dbd, 2026-11-20, sample wardrobe at 1024x1366)

1. **One 11,368-line `app.js` holds every screen.** All four leads would edit the same file at once: constant merge conflicts. Biggest structural risk for the new team setup.
2. **Today is three screens tall (3,022 px).** The 3D Mirror with body sliders fills the whole first screen; weather, occasion chips and the outfit ideas start below the fold. The thing you open the app for (what to wear) isn't visible without scrolling.
3. **Discover is seven screens tall (9,035 px)** on For you: each suggestion card is a full screen. Settings is 4,760 px in a single 760 px column, leaving the right third of the iPad empty.
4. **Things are hard to find:** Report hides behind a button on Wardrobe, Fragrances is a side tab inside Wardrobe, Fit checks is a button on Calendar, Mirror lives inside Today, Settings takes a full dock slot.
5. **No real token system.** `styles.css` has 12 colour tokens and no type, spacing or elevation scale; `app.js` has 225 inline `style="..."` attributes. A restyle (Showroom Night) can't be done cleanly until these go through tokens and classes.
6. **The look follows the system theme** (white on the iPad by day). The mockup and a wall screen want one fixed dark look with garments on light paper tiles.
7. **Kiosk size untested.** No screenshots or checks at 800x1280; tests only use 1024x1366.
8. Good already: 48-56 px touch targets, no zoom/bounce, safe areas, ambient screen, offline cache.

## Plan (one PR each, in this order)

| # | PR | Visible change | Why first |
|---|----|----------------|-----------|
| 1 | **Split screens out of app.js** into `ui/` (shell, router, shared components) and `screens/` files per area, with a screen registry. Behaviour identical, all tests pass. | None | Lets 4 leads work in parallel without conflicts |
| 2 | **Token system + screenshot harness**: `tokens.css` (colour, type, space, radius, elevation), move inline styles to classes; `tools/ui-shots.mjs` screenshots every screen at 1024x1366 and 800x1280 so every PR (any lead) shows before/after | None to tiny | Makes 3-6 safe and reviewable |
| 3 | **Showroom Night look**: dark ground, garments on paper tiles, one tangerine accent, blue for cold/rain/wash, Archivo + Inter Tight (self-hosted for offline) | Whole app restyled | The mockup Matteo already saw |
| 4 | **New navigation**: dock Today, Calendar, Wardrobe, Add, Mirror, Discover; Settings behind the round "M" button; Report, Fragrances and Fit checks get clear homes | Nav | Mirror leaves Today |
| 5 | **Today, decluttered**: weather + occasion + 3 ideas above the fold, small Mirror preview that opens the Mirror tab, Ask the stylist one tap away | Today | Main daily screen |
| 6 | **Long screens**: Settings in two columns with a section index; Discover cards compact (Discover lead owns content, UI lead the layout); Wardrobe filters collapse | Settings, Discover, Wardrobe | Less scrolling |
| 7 | **Kiosk pass** at 800x1280: dock, type sizes, ambient screen | Pi screen | Before the Pi build |

## UI contract

Now lives in `docs/leads/CONTRACTS.md` (UI/UX section; this lead owns the file). Summary:

- **Screens** register with the shell: `registerScreen(id, { title, render(main), dock?: {icon, label, order} })`. Only the UI lead edits the dock order.
- **Slots**: Today and Mirror expose mount points (`#mirror-slot`, `#ideas-slot`, `#ask-slot`); the owning lead fills them, the UI lead decides their size and position.
- **Shared components** (UI lead owns, others call): `outfitCard(outfit, opts)`, `pieceTile(item, opts)`, `chips(items, opts)`, `emptyState()`, `openSheet()`, `toast()`. Changing their arguments = a CONTRACTS change + message to affected leads.
- **Styling rule**: no hex colours or inline `style=` in new code; use tokens (`var(--...)`) and classes. New tokens go through the UI lead.
- **Sizes**: every screen must work at 1024x1366 and 800x1280 portrait, touch targets 48 px or more.

## Log

- 2026-11-20: thread started, audit done, plan proposed. Waiting for go.
- 2026-11-20: Discover lead holds big app.js edits until the split merges. When it merges, message the Discover thread with where Discover lives and the screen API. Its code today: app.js ~6395-6740 (shop, Must-Buy), ~6737-7085 (Events), ~7882-8190 (For you audit), ~8362-8900 (Try a piece, Shop trip, New look, photos). Put those in `screens/discover.js` in the split.
