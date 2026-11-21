# Avatar lead: plan

Owner: the Avatar lead thread ("Lead the 3D Avatar"). Re-read this file at the start of every session and keep it current.
Shared rules with the other leads (UI/UX, Stylist, Discover) live in `docs/leads/CONTRACTS.md`.

## What this area owns

- `avatar-stage.js`: the 3D mirror (three.js r169, MakeHuman CC0 body, cloth drape, shoes, hair, beard, glasses).
- `garment-baker.js`: front/back photos baked into garment textures once, kept in IndexedDB.
- `avatar-config.js`: body config, slots, sizes, cut-out fit (the data contract with the rest of the app).
- `lookbook-stage.js` + `lookbook-config.js`: the 2.5D Lookbook look.
- `face-photo.js`, `avatar/` (body + hair data), `tools/build-avatar.py`, `tools/build-hair.py`.
- Mirror glue in `app.js` (the "Mirror" section): owned jointly with UI/UX until the app.js split lands.

Rules: zero API calls on the avatar (everything on the device), free assets only (CC0/MIT), never remove the 3D Avatar
without asking Matteo, branch + PR per update, auto-merge when tests pass.

## Split (2026-11-21, Matteo: "the avatar itself and the clothes")

Two threads share this area and this plan file:
- **Avatar body** (thread "Lead the 3D Avatar"): body shape and sliders, face and "From a photo", hair, beard, glasses, pose,
  lights and shadows, the shared 3D test (`tools/avatar.e2e.mjs`) and the stage file split. Files: `avatar-config.js`
  (body part), `face-photo.js`, `avatar/`, `tools/build-avatar.py`, `tools/build-hair.py`, `stage/body*`, `stage/hair*`, `stage/face*`.
- **Avatar clothes** (new thread): `garment-baker.js`, cloth drape, shoes, coats, open/buttoned/tuck, tie, accessories on
  the body, photo sleeves, the Lookbook, a Discover "try it on". Files: `garment-baker.js`, `lookbook-*.js`,
  `avatar-config.js` (garment part), `stage/cloth*`, `stage/shoes*`.
- Shared: the `createStage` API and the garment asset shape below. A change to either goes in this file and is
  messaged to the other thread.
- Order: roadmap steps 1 and 2 (body thread) come first because they give the two threads separate files; the clothes
  thread holds code changes until they merge. Then steps 3-5 and the clothes half of 6 go to the clothes thread;
  hair and shadows (step 6) stay with the body thread.

## Audit (2026-11-20, main at aae4dbd / PR #88)

Working well
- Avatar | Lookbook switch, 21 hairstyles, drape for tops/jackets, coat over blazer, open/buttoned/closed, tuck, tie on the shirt.
- Unit tests for the area pass (hair-styles, fit-back, stage-config: 15/15).
- The 3D acceptance run on the 2026-11-16 backup: 16 checks pass (zero AI calls, back of head, jacket back, heels,
  inner layer through the open jacket, take-off in one frame, drag turns him).

Problems found
1. No reliable safety net. The 3D acceptance harness (`harness3d.mjs`) lives only in the project files, not in the repo,
   with a hard-coded Linux path, so it can't run on Matteo's PC. Today it stopped half way because it assumes today's
   first idea has a jacket, which depends on the date and the weather.
2. One 4,100-line file. `avatar-stage.js` holds body, cloth, shoes, hair, beard and glasses together, so every change
   risks the rest and two leads can't work near it at once.
3. Freezes on the main thread. Exact body + drape rebuild is ~1.5 s after a slider move, a hoodie drape up to ~0.6 s,
   the first bake of a piece 100-200 ms. Fine on the iPad M3, a problem on the Raspberry Pi 5 wall screen.
4. Dead code from the removed grey Mannequin: `bakePiece` in app.js still calls `baker.cutoutPanels` (gone since #83),
   and `createStage` is passed a `mode` it ignores.
5. Things Fit check reads but the avatar can't show: trouser break and rolled sleeves; coats stop at the crotch
   (the coat patch is cut from the body mesh, so long coats are impossible).
6. Visual gaps still open: shoulders a bit padded on jackets, sleeves are plain fabric (no photo sleeves),
   Curly/Wavy/Long hair cards stringy, no self-shadowing, no accessories on the body except glasses and the tie.

## Roadmap (one PR each, in order; nothing starts until Matteo says go)

1. Safety net + cleanup (no visual change)
   - Move the harness into `tools/avatar.e2e.mjs` with its own fixed test wardrobe, date and weather, so it gives the same
     answer every day and runs on Windows (`node --test tools/avatar.e2e.mjs`).
   - Add before/after screenshot output (`SHOTS=<folder>`) so each visual PR shows what changed.
   - Remove the Mannequin leftovers.
2. Split `avatar-stage.js` into `stage/` modules (body, cloth, shoes, hair, face, materials) behind the same
   `createStage` API. After the UI/UX app.js split merges, move the mirror glue into its own screen module.
3. Speed: drape and bake in a Web Worker, so sliders and first wear never freeze the screen. Target: no main-thread task
   over 50 ms on the iPad; measure on the Pi 5 when it exists.
4. Real outerwear: long coats past the hip and knee (their own panel, not cut from the body), less padded shoulders.
5. Draw what Fit check reads: trouser break, rolled sleeves; accessories on the body (watch, cap/beanie, belt, bag).
6. Polish: photo sleeves, curly/wavy/long hair, soft contact shadows.

Cross-area ideas to raise with the other leads
- Discover: "Try it on" a shop piece on the avatar before buying (bake from the shop photo, never saved).
- Stylist: the wear enums (close/tuck/sleeves/break) and outfit roles are a shared contract.

## Contract points this area exposes (to copy into CONTRACTS.md once it exists)

- Stage API: `createStage(host, { onAngle, hairFinish, tuck })` → `setBody, prepare, setGarment(slot, asset, {visible, name}),
  setVisible, snapTo, resize, dispose, setHairFinish, setTuck, pause, resume`.
- Slots: `top, layer, jacket, bottoms, shoes`; outfit role → slot in `avatar-config.js` (`ROLE_TO_SLOT`); a coat takes `jacket`.
- `BakedGarmentAsset` (garment-baker.js, `BAKER_VERSION` 5), `item.cutoutMeta` (scale, offsetY), `asset.wear.close` 0/1/2.
- Device settings: `mirrorMode` (avatar | lookbook), `hairFinish` (real | sculpted), `mirrorTuck`.
- Reads from Stylist: `Brain.wearFor(...)` wear fields.

## Log

- 2026-11-20: thread started, audit done, plan sent to Matteo. Waiting for go.
- 2026-11-21: Matteo asked to split the avatar into body and clothes; asked the coordinator for a clothes thread.
