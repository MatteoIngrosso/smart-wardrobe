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

7. **FashionStylist dataset** as bible examples and a benchmark. See "Research repos" below.
8. **CLHE experiment on Matteo's RTX 3060**, only after step 7 gives us the benchmark. See "Research repos" below.

9. **Style Trainer, PARKED** (Matteo 2026-11-21: "for later or at least go in UI/UX"; focus stays on the stylist) (Matteo's idea, 2026-11-21): a "Taste" button opens swipe cards of outfits from his wardrobe. Right = like, left = pass, down = "almost": tap the piece that's off, pick a reason chip (colour, fit, too dressy, too casual, not my style) plus optional text. Cards mix sure bets with outfits the engine is unsure about, so each swipe teaches the most. Swipes feed the same `taste()` at about half the weight of real wears, and after about 50 swipes the device refits the bible's rule weights to him (a "personal bible", small logistic regression in JS, no tokens). Own module `style-trainer.js` exporting `open(container)`. UI/UX lead's contract (CONTRACTS.md "Style Trainer", 2026-11-21): "Taste" button in the Today header next to New ideas + a row in Settings > Look, no dock tab; full-screen with X top-left returning to the opener; after their split it registers as `registerScreen("trainer", { title: "Taste", render: open, fullscreen: true })` (before it, a small Today button + full-screen container in app.js). The card area sets `touch-action: none`; 56 px Pass / Almost / Like buttons for the kiosk; paper tiles, one outfit per card; fits 1024x1366 and 800x1280 without scrolling; tokens and classes only, no inline colours (ask UI/UX for new tokens).

## Research repos (reviewed 2026-11-21, Matteo found them)

What we keep from each, and what we don't.

**FashionStylist** (github.com/recsys-benchmark/FashionStylist, CC BY-NC 4.0: fine for a personal app). USE.
- Men's set: 300 outfits, 1,390 pieces, expert labels per piece (category, style, outline/fit, material, colour, pattern, detail, donning) and per outfit (look description, season, occasion: Home, Travel, Social, School, Sports). Plain CSV, no images needed.
- Keep 1: **more knowledge for the bible.** Map its labels to our vocab (category -> slots, outline -> FITS, materials, colours) and feed the outfits to the fashion-model learner as examples (`add --no-train`, then `train`). Weight them below the magazine sources: mostly Asian streetwear (Cityboy, Korean, avant-garde, quiet luxury), no business or formal looks.
- Keep 2: **a benchmark for our scorer**, copied from its Task 2 (outfit completion) and Task 3 (outfit evaluation): each real outfit should score above the same outfit with one piece swapped at random. Gives one accuracy number to track every engine PR, and the yardstick for CLHE.
- Its look descriptions ("quiet luxury: oatmeal collared knit over a turtleneck, black wide-leg trousers") can also become bible tips for Ask the stylist.

**CLHE** (github.com/Xiaohao-Liu/CLHE, bundle construction, WSDM 2024). EXPERIMENT, not a replacement.
- What it is: learns which items make a good bundle (outfit) from multimodal item features plus item-level user feedback, trained on POG (Alibaba iFashion/Taobao outfits, mostly women's, around 2018). PyTorch + CUDA.
- Matteo's PC has an RTX 3060 (12 GB): enough to train it (small model on pre-extracted features).
- Keep: **its idea of using item-level feedback** (we already do: pairs worn/liked, stars, skips, swaps, fit-check tags) and **multimodal item features** (we have `item.look` from the photo; image embeddings would add similarity).
- Experiment: train on the PC via Remote Control, extract the same features for his cut-outs, precompute a "goes together" score for every pair of his pieces into app data (works offline, PC off; re-run after adding pieces). Adopt only if it beats our scorer on the FashionStylist benchmark, and then as one more signal next to the bible.

**DiFashion** (github.com/YiyanXu/DiFashion, generative outfit recommendation, SIGIR 2024). DON'T USE.
- What it is: fine-tuned Stable Diffusion that paints images of invented garments to complete an outfit (iFashion + Polyvore data, mostly women's, 2017-19).
- Why not: our job is choosing among pieces he owns, not drawing new ones; training is tight on 12 GB and every suggestion needs many denoising steps on the GPU (PC on each time); no free host for a custom SD model.
- Keep: **the "history condition" idea** (personalise from past outfits: our taste learning) and **its evaluation set-up** (fill-in-the-blank with 1 right piece among 5 candidates), which the FashionStylist benchmark copies. Drawing a "missing piece" picture could suit Discover one day (Discover lead's call).

Cross-lead notes:
- UI/UX: I hold large `app.js` edits until the split merges. After it, the engine is a module the screens import.
- Avatar: Fit Check's "how you wore it" (`wear` per piece: open/closed, tuck) is produced by the Stylist and drawn by the Avatar; it belongs in CONTRACTS.md.
- Discover: uses engine scores for "goes with" and the Outfit Multiplier; it should call the engine API from step 2.

## Working locally

Matteo's PC folder `C:\Users\matte\Documents\Wardrobe2.0` (approved). When it's online, tests can run there with `node --test tools/…` and `python -m fashion …`; the plan file stays in the repo so either side picks it up.

## Log

- 2026-11-20: thread started, audit done, plan written. No PRs yet.
- 2026-11-21: Step 7 done: 224 FashionStylist men's outfits taught to the bible (weight 0.35, positives only: swapped-piece negatives shrank every weight to ~0, dropped). Benchmark `python -m fashion bench` on 56 held-out outfits: bible 58%, rulebook 57%, 50% = chance. The rules catch mistakes, not great combinations: the bar CLHE must beat. audit-sim 25/25.
- 2026-11-21: Matteo: "apply everything" (go on steps 1-8; Style Trainer stays parked; he won't work locally for now). Step 1 done: shorts idea at 23° on Everyday (`withShorts`), blazer carried in the heat on Elegant (`carriesBlazer`, 40% warmth), off-level tiers by distance. audit-sim 25/25 on the 11-16 backup. gym-everyday eval fails the same on main (pre-existing).
- 2026-11-21: "Research repos" section added on Matteo's ask (keep what's useful).
- 2026-11-21: Style Trainer parked; DiFashion explained as rejected (draws invented garments, heavy SD inference, iFashion/Polyvore women's data).
- 2026-11-21: explained the scoring scheme; reviewed FashionStylist / CLHE / DiFashion (step 7).
