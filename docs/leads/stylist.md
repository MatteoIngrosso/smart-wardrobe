# Stylist lead

Owner thread: "Lead the Stylist". Re-read this file at the start of every session.
Shared contract with the other leads (UI/UX, Avatar, Discover): `docs/leads/CONTRACTS.md` (written by the UI/UX lead).

## What the Stylist owns

| Part | Where it lives today |
| --- | --- |
| Outfit idea engine (pool, scoring, picks, levels, weather, rotation, variety, accessories) | `app.js` (`ideaPool`, `scoreOutfit`, `pickIdeas`, `generateOutfits`, `dressLevel`, `sense`, `weatherPieces`, `extrasFor`, `ageScore`, `withLoved`) |
| Learning from wears, stars, skips, swaps | `app.js` (`taste`, `tasteScore`, `tasteText`) |
| StylistBrain (fit check learning) | `stylist-brain.js` |
| Fit Check flow (photo, review, how you wore it) | `app.js` (`startFitCheck` … `saveFitCheck`, `readWear`) |
| Ask the stylist chat | `stylist-chat.js` + `app.js` (`stylistSystem`, `chatSystem`, `chatSwap`, `wardrobeText`) |
| Calendar day picks, laundry | `calendar.js` + `app.js` (`suggestDay`, `nextIdea`, `wearable`) |
| Fashion bible | `stylist.js`, `fashion-bible.json`, `fashion-model/` (Python) |

Not mine: how screens look (UI/UX), the 3D/Lookbook rendering (Avatar), shopping and product photos (Discover). Discover uses the engine's scores ("goes with N pieces", Outfit Multiplier), so the engine API below is part of the contract.

## Audit, 2026-11-20 (main at aae4dbd)

Tests: `stylist.test` 14/14, `stylist-brain.test` 14/14, `stylist-chat.test` 10/10, `calendar.test` 11/11, fashion-model pytest 53/53, bible parity OK. `gym-everyday.test` skips unless `WARDROBE_BACKUP` is set. No GitHub CI: tests are run by the thread before merging.

`node tools/audit-sim.mjs smart-wardrobe-backup-2026-11-16.json --runs 2` (86 pieces): **23 of 25 pass**. Fails:
1. **Everyday at 23°C: 0% of ideas have shorts** (target 25%+). The 22-25° band says "shorts come first", but none come.
2. **Elegant at 28°C: 48 "Too warm" warnings.** Blazer + trousers is all Elegant can build, so every idea warns. It should pick the lightest tailoring, drop the jacket where the bible allows, and say once why.

Structural findings:
3. **The engine is buried in `app.js`** (about 2,500 of its 11,400 lines are stylist logic, mixed with rendering). It can only be tested through a browser harness, every change risks UI code, and the UI/UX split will move it around. The bible, Brain and chat are already pure modules; the engine should be too.
4. **Two scorers in practice.** Today's ideas, Calendar's `suggestDay`, Try a piece, Discover's "goes with" and the chat swap picker each call the engine a bit differently (own weather reading, own occasion guess: `stylistSystem` vs `stylistSystemLite`). One entry point would stop them drifting.
5. **Stylist chat token use is fine** (about 1,000 in per question, cached system prompt), but follow-ups resend the full wardrobe on every new conversation. A wardrobe digest that only changes when pieces change would keep it cacheable across conversations too.
6. **Loved pieces still dominate**: Black Zara jacket is the top pick on 11 of 21 simulated days, washed black baggy jeans 9 of 21. Passes the thresholds, but it's what Matteo complained about in October.

## Plan (proposed, waiting for Matteo's go)

Each step is one branch + PR, auto-merged when tests pass.

1. **Fix the two hot-weather fails** (shorts at 22-25° on Everyday; Elegant in heat: lightest tailoring, jacket optional, one note instead of 3 warnings). Small, self-contained, can go now.
2. **Extract the engine into `stylist-engine.js`** (pure, Node-testable, no DOM): `ideas({ items, log, cond, occasion, level, anchor, avoid, n })`, `score(outfit, ctx)`, `level(pieces)`, `taste(log, brain)`. `app.js` keeps only rendering. **Waits for the UI/UX split of `app.js` to merge**, then lands as one move-only PR (no behaviour change, audit-sim identical), then the API goes in CONTRACTS.md.
3. **One entry point for everyone**: Today, Calendar, Try a piece, chat swaps and Discover's "goes with" all call the engine API with the same context (weather, occasion, laundry). Removes `stylistSystemLite` and the duplicated weather/occasion reading.
4. **Fairer rotation for loved pieces**: lower the top-pick share of the Zara jacket and baggy jeans to about 1 day in 3, keeping them in at least one idea when they fit. New audit-sim threshold.
5. **Engine tests in plain Node** (`tools/stylist-engine.test.mjs`) on a trimmed copy of the real backup committed without photos, so `gym-everyday` and the audit checks run every time instead of being skipped.
6. **Chat tokens**: a wardrobe digest cached across conversations; `gemini-flash-lite-latest` for follow-ups (free tier, fewer tokens). Measure before and after.

Cross-lead notes:
- UI/UX: I hold large `app.js` edits until the split merges. After it, the engine is a module the screens import.
- Avatar: Fit Check's "how you wore it" (`wear` per piece: open/closed, tuck) is produced by the Stylist and drawn by the Avatar; it belongs in CONTRACTS.md.
- Discover: uses engine scores for "goes with" and the Outfit Multiplier; it should call the engine API from step 2.

## Working locally

Matteo's PC folder `C:\Users\matte\Documents\Wardrobe2.0` (approved). When it's online, tests can run there with `node --test tools/…` and `python -m fashion …`; the plan file stays in the repo so either side picks it up.

## Log

- 2026-11-20: thread started, audit done, plan written. No PRs yet.
