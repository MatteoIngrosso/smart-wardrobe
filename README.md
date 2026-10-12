# Smart Wardrobe

A touch-first web app for a self-built wardrobe tablet. It catalogues your clothes from two photos each (front and back), suggests outfits for the weather and the occasion, and points out what's worth buying next. It has no build step. Every device keeps its own copy of the wardrobe, so it works offline, and the small `server.py` keeps those copies in sync.

Plain HTML, CSS and JavaScript (ES modules), IndexedDB for storage, Open-Meteo for weather, and optional AI from Gemini or Claude.

## Run it

```bash
git clone https://github.com/MatteoIngrosso/smart-wardrobe.git
cd smart-wardrobe
python3 server.py
# open http://localhost:8000 (or http://<computer-ip>:8000 from the tablet or phone)
```

`server.py` serves the app and keeps **one shared wardrobe** for every device that opens it. Add a piece on the phone and it appears on the tablet and the computer within a second or two. The shared data lives in `data/` next to the script (photos in `data/blobs/`, everything else in `data/db.json`). That folder is never committed, so back it up, or use **Export backup**. `python3 -m http.server 8000` still works, but then each device keeps its own separate wardrobe.

On the tablet, use the browser's "Add to Home screen" option. The app then opens fullscreen like a kiosk.
The camera button and "Use this device's location" need **https** or **localhost**. To use the in-app camera on the phone or tablet, run `python3 server.py --cert cert.pem --key key.pem` with a certificate for the computer's address. Without one, **Take photos** opens the phone's own camera app instead, which works over plain http.

### Sharing one wardrobe between devices
- Every device keeps a full copy in IndexedDB, so it keeps working when the computer is off. Changes made in the meantime are sent when the server is back.
- Pieces, the wear log and the wishlist are shared. Settings, the weather city and API keys stay on each device.
- If two devices change the same piece, the latest change wins.
- Photos are uploaded once, named by a hash of their contents.
- The first time a device connects, the server's copy wins for anything both have. Pieces only that device has are uploaded. Sample pieces already shared by another device aren't added twice.
- Settings > Data shows whether the device is connected.

### Putting it online

Live weather and Gemini need the app on a normal web address (they're blocked inside the Claude preview). The repository is private, and GitHub Pages only serves private repositories on a paid GitHub plan. Cloudflare Pages and Netlify can both deploy a private GitHub repository for free: connect the repository, leave the build command empty and set the output folder to the repository root.

The first time it opens, it loads your 30 sample pieces (17 tops and jackets from `Photos-1-001`, plus 13 shorts and trousers from the second batch). Their backgrounds are already removed. **Load sample wardrobe** in Settings loads them again.

## What it does

| Tab | Features |
|---|---|
| **Today** | Live weather (Open-Meteo, no key needed) and a "feels like" slider. With no internet (or in the Claude preview, which blocks outside connections) it uses the usual temperatures for the month from a built-in list of 75 cities, and switches back to live weather by itself once online. Occasion chips: everyday, smart casual, work, night out. You get 3 outfit ideas with the reason for each, and **Wear this today** logs the outfit. **Ask the stylist** (with an AI key) suggests 3 different outfits when you ask what to wear (or tap **3 outfits for today**). Each one gets its own card, with photos of your pieces, a placeholder for anything to buy, and its own **Wear this today** button. |
| **Wardrobe** | Photo grid of cut-out pieces with search, category, style and colour filters, and sorting by newest, most worn or least worn. Tapping a piece shows its front and back photos, wear history, favourite, edit and delete, and **What goes with it?** |
| **Add** | Two photos per piece: **Take photos** opens the camera inside the app, you shoot the front, flip the piece, shoot the back. The app then removes the background, turns both photos upright, detects colours and recognises style from the brand. With an AI key, Gemini or Claude also fills in type, name, brand and style and double-checks which way is up. Check it and tap **Save and add the next piece**, which reopens the camera. **Scan price tag** (with an AI key) reads brand, product name, price, size and material from a photo of the tag or care label. The tag photo isn't kept. The piece then shows its price and cost per wear, and Discover shows the total value of priced pieces. **Choose from gallery** pairs front and back photos by the time they were taken. **Turn** rotates a photo by hand. |
| **Discover** | Your style mix (tap a style to see those pieces), brands with their tier (luxury, premium, mainstream, high street), wardrobe balance by category, your colour palette, pieces you never wear, and a **Worth adding** list explaining why each item fills a gap. Each item has links to Google Shopping, Zalando, Vinted and ASOS, plus a wishlist. |
| **Settings** | City or GPS for weather, °C/°F, theme, which shops to link to, background removal on or off, the AI provider (Gemini or Claude) with its key and model, a token counter for the month, and export, import or erase of all data. |

### Running it in the Claude preview

The Claude preview blocks every outside website. Inside it:

- **Weather** can't reach Open-Meteo (free, no key), so Today uses the usual temperatures for the month from the built-in city list.
- **Gemini and the Claude API** can't be reached with a key, so recognition and the stylist go through the viewer's own Claude account instead. The preview asks to allow it the first time.

On the tablet, or on any normal web address, the app uses live weather and your Gemini key as usual.

### How the outfit ideas work (offline, no AI)
- **Layers come from the temperature.** A base layer (tee) and a mid layer (hoodie or knit) are always included. Outerwear is added below 15° or when it's raining, and heavy puffers are avoided above 12°.
- **Colour.** Neutrals go with anything. One accent colour scores best, and two clashing accents or two graphic prints lose points.
- **Rotation.** Pieces worn in the last 1–4 days are pushed down, and forgotten ones get a turn.
- **Occasion and style.** Each style has a formality level (casual 1 to formal 4). The outfit's average should match the occasion, pieces that share a style score higher, and clashes such as sporty with formal lose points.

### Background removal (no AI tokens)
Runs on the tablet. The first time, the app downloads an AI cut-out model (about 40 MB, `@imgly/background-removal`) and the browser keeps it. Without internet it uses a quick colour-based cut-out, which works best on a plain surface that contrasts with the garment. The original photo is always kept.

The sample photos were cut out ahead of time with the `u2net` model, with the mattress showing between trouser legs and feet at the hem cleaned off.

### Upright photos (no AI tokens)
Every piece is shown the same way: upright, collar or waistband at the top, centred on a 3:4 card. The app finds the garment's left-right symmetry line to know which way it runs, then decides which end is the top: legs go at the bottom, a hood or neckline goes at the top. On the 58 sample photos it picks the right way on its own for 53, and knowing the type (top or bottom) fixes most of the rest. With an AI key, the AI's answer about which way is up corrects any photo that is still wrong, at no extra cost because it is part of the same request.

The in-app camera needs https or localhost. Where it isn't available, the system camera opens instead, once for the front and once for the back.

### Brand and style recognition
- **Offline.** About 85 brands are built in with a tier and their usual styles, so typing "Lacoste" sets the style to preppy and smart casual. Without a known brand, the style comes from the garment type and tags (cargo or graphic means streetwear, knit means smart casual, plain means minimal).
- **Any other brand (Wikidata, free, no key).** The Brand box suggests matching brands from Wikidata as you type, and brands that aren't built in are looked up there once and remembered on the device. Wikidata only gives a short description ("British streetwear brand", "Italian luxury fashion company"), so the app reads the style from it, and the tier only when the description says luxury or fast fashion. The built-in list stays the reliable source for tiers. Lookups need internet. If Wikidata asks the app to slow down, it waits 10 minutes.
- **Still no tier or style?** With an AI key, Gemini (or Claude) is asked once for that brand's tier and 1 to 3 styles. That's about 150 tokens per brand, saved on the device. The order is: built-in list, then Wikidata (free), then AI only for what's still missing.
- **With AI.** Gemini or Claude reads the photo once, reading the logo or label when one is visible, and returns type, colours, brand, 1 to 3 styles, warmth and tags as structured JSON. **Recognise pieces without a brand** in Settings does the same for pieces you already have.

### Optional AI: Gemini or Claude
Choose the provider in Settings and paste a key. The key stays on the tablet.

- **Gemini** (default model `gemini-flash-latest`; `gemini-flash-lite-latest` and `gemini-pro-latest` are listed too). Get a key at aistudio.google.com. A Gemini app subscription (Gemini Pro or Advanced) does **not** include API access, but AI Studio has a free tier that should cover the light use this app makes of it.
- **Claude** uses `claude-opus-5-5` through the official `@anthropic-ai/sdk`.

**How the app keeps token use low**
| Feature | Tokens |
|---|---|
| Background removal, colours, daily outfits, pairings, shopping gaps | 0 (on the tablet) |
| Recognising a new piece | Roughly 500–1,000 (estimate): front and back cut-outs sent as **one** 768×512 picture, JSON reply capped at 320 tokens, Gemini thinking off. Done once per piece and saved. |
| Reading a price tag | Roughly 400–600 (estimate): one photo at 1024 px, JSON reply capped at 200 tokens. Only when you tap **Scan price tag**. |
| Classifying a brand the list and Wikidata can't place | About 150, once per brand, saved on the device. |
| Stylist question | About 900 in plus up to 800 out: the wardrobe is sent as one short numbered line per piece (about 15 tokens each), and answers are capped at 20 short lines. |

Settings shows how many requests and tokens were used this month.

## Files
- `index.html`, `styles.css`, `app.js`: the whole app
- `server.py`: serves the app and keeps the shared wardrobe in `data/` (Python 3 standard library only)
- `sample/`: resized copies of your photos (`*.jpg`), their cut-outs (`cut/*.webp`) and `seed.js`, which holds the catalogue data for them
- `manifest.webmanifest`, `icon.svg`: let you install the app on the home screen
- `tools/build_preview.py`: builds a one-page copy in `dist/` for the Claude preview

## How changes are made
`main` always holds the working app. Every update goes on its own branch (for example `update/weather-offline`) with a pull request describing what changed, and is merged into `main` once it's checked.

API keys are typed into Settings on the device and stored only there. They are never part of this repository.

## Ideas for next steps
- Sync away from home: today the devices share the wardrobe through the computer running `server.py` on the same Wi-Fi. A hosted backend (for example Supabase) would let the phone sync from anywhere
- Calendar integration so outfit ideas match your events
- Laundry status ("in the wash") so dirty pieces are left out of outfit ideas
