# Avatar clothes lead: plan

Owner: the clothes thread ("Lead the Avatar clothes"). Re-read this file at the start of every session and keep it current.
The body thread ("Lead the 3D Avatar") owns `docs/leads/avatar.md`, which has the ownership split, the shared stage API
and the contract points. Rules shared by all leads: `docs/leads/CONTRACTS.md`.

## What this thread owns

Clothes on the avatar: `garment-baker.js`, the garment half of `avatar-config.js` (`subTypeOf`, `lengthOf`, sizes,
`cutoutMeta`), cloth drape, shoes, coats, open/buttoned/tuck, tie, accessories on the body, photo sleeves,
the Lookbook (`lookbook-stage.js`, `lookbook-config.js`) and a future Discover "Try it on".
After the stage split: `stage/cloth*`, `stage/shoes*`. Tests: `tools/fit-back.test.mjs`, `tools/stage-config.test.mjs`,
`tools/lookbook.e2e.mjs`, `tools/fit-wear.e2e.mjs`, and the clothes checks in the shared `tools/avatar.e2e.mjs`.

Rules: zero API calls for the avatar, free assets only, never remove the 3D Avatar without asking Matteo,
branch + PR per update, auto-merge once tests pass. No code changes until the body thread's first two PRs merge
(test harness into the repo, `avatar-stage.js` split into `stage/` modules).

## Audit (2026-11-21, main at c59e7ae)

Tests for the area pass: fit-back, stage-config, hair-styles 15/15; lookbook.e2e + fit-wear.e2e 11/11.

Checked against Matteo's own wardrobe (backup 2026-11-16, 86 pieces). Each piece gets one of 15 shells (`subTypeOf`):

| His pieces | Drawn today as | What's wrong |
|---|---|---|
| white dress shirt (1) | tee | short sleeves, no collar, no buttons |
| 2 Ralph Lauren polos | tee | no collar, no placket |
| Dark blue single-breasted blazer (saved as "overshirt") | sweater | crew neck with a rib hem: reads as a jumper, not a blazer |
| Black GEOX dress shoes | sneakers | chunky sneaker shell with a tongue |
| Navy wool coat | open jacket | stops at the crotch (the coat patch is cut from the body mesh) |
| 5 zip hoodies | hoodie | always zipped; can't be worn open over a tee |
| shorts (5), trousers (6) | jeans shape | fine with the photo texture; trouser break not drawn |
| watch, 2 belts, 2 sunglasses, tie | only the tie (painted) | nothing else shows on the body |

Other gaps (from the earlier audit): drape and first bake run on the main thread (hoodie drape up to ~0.6 s,
first bake 100-200 ms: a problem on the Pi 5), jacket shoulders still a bit padded, sleeves are plain fabric
(no photo sleeves), Fit check reads break and rolled sleeves but the avatar can't show them.
Dead code to remove with the body thread's cleanup PR: `bakePiece` in app.js still calls `baker.cutoutPanels`.

## Roadmap (one PR each, in order; starts after body PRs 1-2 merge and Matteo says go)

1. **The right shape for each piece** (fixes the table above, smallest step with the biggest visible change)
   - New shells: `shirt` (collar, button placket, long sleeves, short when the photo shows short sleeves),
     `polo` (collar, short placket), `blazer` (notch lapels, buttoned/open from Fit check), `dress` shoes
     (low, slim sole, no tongue).
   - Blazer/suit jacket found by name too, so his "overshirt" blazer draws right without re-saving it.
   - Zip hoodies open or closed with the same close chip as jackets (`asset.wear.close`).
   - Tests: a unit test for every category to shell, before/after renders of his pieces.
2. **No freezes**: drape and bake in a Web Worker. Target: no main-thread task over 50 ms on the iPad.
3. **Real coats**: their own panel down to the knee, swinging free of the legs; less padded shoulders.
4. **Draw what Fit check reads**: trouser break (none/slight/full, stacked), rolled sleeves, shirt tuck with the belt showing.
5. **Accessories on the body**: watch on the wrist, belt at the waistband, sunglasses (with the body thread,
   which owns glasses), cap/beanie (with the body thread: hair under a hat), bag/backpack on the shoulder.
6. **Photo sleeves**: the baker finds the sleeves in the photo and the sleeves get their own UVs (stripes, logos on arms).
7. **Discover "Try it on"**: bake a shop photo in memory (never saved) and put it on the avatar.
   Needs the Discover lead: the shop piece shape and an image route the page can read (shop photos are cross-origin).

The Lookbook stays as it is (bug fixes only) unless Matteo asks for more.

## Looked at and not used

- img2threejs (github.com/img2threejs/img2threejs, Apache-2.0, checked 2026-11-21): an agent skill where a coding agent
  rebuilds one object from one image as procedural three.js code, with an AI vision review at every pass. It runs on a
  developer's machine, spends model tokens per object, and its roadmap leaves clothing and fitting to a body out.
  So it can't turn his photos into clothes on the avatar inside the app. Its one useful idea (render, compare with the
  photo, fix, repeat) is what the before/after renders in every PR already do.

## Contract points (shared with the body thread, copy into CONTRACTS.md with it)

- New shells change `subTypeOf` and the `SPECS` table; the slot list (`top, layer, jacket, bottoms, shoes`) stays.
- Accessories on the body need new stage calls (`setAccessory(group, asset)`), agreed with the body thread first.
- Reads from Stylist: `Brain.wearFor(...)` (close, tuck, sleeves, break).

## Log

- 2026-11-21: thread started. Audit done against his wardrobe, plan sent to Matteo.
- 2026-11-21: Matteo: "now lets just work in the pice shape, and 3d resoult of them" (go, before the body split). Step 1 built: shirt/shortshirt/polo/blazer/ziphoodie/dress shells, folded collars and lapels (`foldCollar`, `lapels`, `sweptExtra` in avatar-stage.js), blazer buttoned and zip hoodie zipped by default (`defaultClose`), glossy dress shoes (GLOSS). Renders: project files 3d-mirror/shapes-before-after.png. Still open: hanger bar and label left in the blazer photo, slim trousers drawn wide.
- 2026-11-21: Matteo: "Not all the jackets/hoodies/whatever have buttons, some of them use zips". Added `fasteningOf` (zip / buttons / none from the name and kind, or `item.fastening` set on the piece page), `closeWord`/`closeWays` (zip: Open / Half-zipped / Zipped up), `specFor` in the stage (a zip front hangs straight, half-zip opens above the chest). Track jackets open too. Fit-check prompt marks zip pieces. Renders: project files 3d-mirror/zips-open-half-zipped.png.
