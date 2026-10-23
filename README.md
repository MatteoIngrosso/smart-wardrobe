# Smart Wardrobe

A touch-first web app for a self-built wardrobe tablet. It catalogues your clothes from two photos each (front and back), suggests outfits for the weather and the occasion, and points out what's worth buying next. It has no build step. Every device keeps its own copy of the wardrobe, so it works offline, and a small sync server keeps those copies in sync: `server.py` on a computer at home, or the free Cloudflare Worker in `worker/` when the app is online.

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
- Pieces, the wear log and the wishlist are shared. Settings and the weather city stay on each device. API keys stay on each device too, unless they're saved on the Cloudflare server (see below), in which case no device holds them.
- If two devices change the same piece, the latest change wins.
- Photos are uploaded once, named by a hash of their contents.
- The first time a device connects, the server's copy wins for anything both have. Pieces only that device has are uploaded. Sample pieces already shared by another device aren't added twice.
- Settings > Data shows whether the device is connected.

### Putting it online (free, with Cloudflare)

This puts the app on its own web address so it works from anywhere, with no computer left on at home. Everything below fits in Cloudflare's free plan.

- **A Cloudflare Worker** called `smart-wardrobe` is connected to this private repository, and every push to `main` (every merged pull request) deploys it again. `wrangler.jsonc` holds its settings. The app's files are served as they are, and `.assetsignore` lists what is never served (the README, `server.py`, `worker/`…).
- **`worker/api.js`** takes over from `server.py`. It offers the same sync API and keeps the shared wardrobe in **D1**, Cloudflare's free database: one table of records and one of photos. Cloudflare creates the database on the first deploy, and the tables are created on the first request. Every device still keeps its own copy, so the app works offline and sends its changes when it's back online.
- **A password page** comes first. Until you sign in, the Worker shows nothing else: no app, photos, wardrobe or AI. After the right password, the device stays signed in for a year (a signed, HttpOnly cookie). After 10 wrong passwords from one address, the page pauses for 15 minutes. Changing the password signs every device out. Without a password set, the site shows only a "set APP_PASSWORD" message.
- **The Gemini key** (and the Claude key, if you use it) is saved as a secret in Cloudflare. The app sends AI requests through `/api/ai/…` and the Worker adds the key, so no device stores it and nobody can read it from the app.

**One-time setup** (Cloudflare dashboard → Compute → Workers & Pages → `smart-wardrobe`):
1. **Connect the repository.** If the Worker already deploys from GitHub, this is done: Settings → Build should show `MatteoIngrosso/smart-wardrobe` on branch `main`. Leave the deploy command as `npx wrangler deploy`.
2. **Add the secrets.** Settings → Variables and Secrets → Add, choosing type **Secret** for each:
   - `APP_PASSWORD`: the password for the sign-in page. Make it long, for example four random words.
   - `GEMINI_KEY`: your key from aistudio.google.com (optional `CLAUDE_KEY` the same way)
   - `SERPAPI_KEY` (optional): real product photos in Discover, see "Product photos" below
3. **Open the site** (`https://smart-wardrobe.<your-account>.workers.dev`) on each device, sign in and use "Add to Home screen". Settings > Data should say the wardrobe is shared live, and Settings > AI should say the key is saved on your server. If a device still has an old key saved, tap **Remove the old key from this device**.

To sign a device out, open `/logout` on it.

**Product photos.** Without them, Discover draws each suggested piece in its colour. With a free SerpApi key, it shows real products from Google Shopping instead, with price and shop, and **Real photos** lists them without using any AI tokens. Sign up at serpapi.com (Free plan: 250 searches a month, no card needed when this was written), copy the API key from your dashboard and add it to the Worker as the secret `SERPAPI_KEY` (step 2 above). Each search is kept in the database for two weeks and shared by every device, and a tile only searches once it's on screen, so an idea costs one search however often you look at it. Settings > Look says whether product photos are on. Google's own image search API is closed to new users and Brave's needs a card, so SerpApi is the free option. Without the key, **Real photos** uses Gemini with Google Search and reads each product page's photo.

**Moving your wardrobe over.** The browser keeps each address's data separately. Open the old app (`localhost:8000`), tap **Export backup**, then open the new address and tap **Import backup**. The imported pieces are sent to the online wardrobe and reach every device.

**If sync stops.** When a sign-in expires (after a year) or the password changes, the app keeps working on its own copy and shows "Can't reach the sync server". Reload the page and sign in again; any changes waiting on the device are then sent.

**Trying it on a computer.** Put `APP_PASSWORD=something` in a `.dev.vars` file (never committed), then `npm install` and `npm run dev`. That runs the site with a local database on `localhost:8787`.

`server.py` still works the same way at home, for example on a Raspberry Pi in the wardrobe.

The first time it opens, it loads your 30 sample pieces (17 tops and jackets from `Photos-1-001`, plus 13 shorts and trousers from the second batch). Their backgrounds are already removed. **Load sample wardrobe** in Settings loads them again.

## What it does

| Tab | Features |
|---|---|
| **Today** | Live weather (Open-Meteo, no key needed) and a "feels like" slider. With no internet (or in the Claude preview, which blocks outside connections) it uses the usual temperatures for the month from a built-in list of 75 cities, and switches back to live weather by itself once online. Occasion chips: everyday, smart casual, work, night out, elegant and gym. You get 3 outfit ideas with the reason for each. **Wear this today** logs the outfit, **♥** says you like it, and **Not for me** asks what's off (too warm, too cold, colours, not my style, just not today) and swaps in another idea. **⇄** on any piece of an idea opens every other piece that could take its place, best match with the rest of the outfit first (the top 3 are marked, and chips such as Jeans or Shorts narrow the list) (a jacket or a second top layer can also be left off), so you can change just the trousers and keep the rest. **Start from a piece** (or **Build outfits with it** on any piece, or **Keep it, build around it** in the swap list) lets you pick what you want to wear: every idea then includes it and the app picks the rest, until you tap **Show all ideas** or wear one. The ideas learn from all of these (see below). **New ideas** always brings outfits you haven't just seen. **Ask the stylist** (with an AI key) suggests 3 different outfits when you ask what to wear (or tap **3 outfits for today**). Each one gets its own card, with photos of your pieces, a picture and a shop link for anything to buy, and its own **Wear this today** button. Any other advice (what to donate, what to pack) shows the photos of the pieces each line talks about, even when the AI names a piece without its number. **Your day** (once a calendar is added in Settings) lists today's events, and after 6 pm tomorrow's, each with its occasion and how warm it will feel then (see below). |
| **Wardrobe** | Photo grid of cut-out pieces with search, section, style and colour filters. The sections are tops, knits, outerwear, bottoms, shoes, headwear, accessories, gym, and underwear & socks. Inside a section there's one chip per type you own (for example Accessories → Watches, Bracelets, Umbrellas). Sort by newest, most worn or least worn. Tapping a piece shows its front and back photos, wear history, favourite, **In the wash**, edit and delete, and **What goes with it?** The **In the wash** chip shows what's in the laundry, with **Laundry done** to put it all back. |
| **Add** | Two photos per piece: **Take photos** opens the camera inside the app, you shoot the front, flip the piece, shoot the back. The app then removes the background, turns both photos upright, detects colours and recognises style from the brand. With an AI key, Gemini or Claude also fills in type, name, brand and style and double-checks which way is up. Check it and tap **Save and add the next piece**, which reopens the camera. **Scan the label**: just bought something? Take one photo of its price tag. The app reads the QR code on the device, and with an AI key it also reads brand, reference, price, size and material from the printed text. It then opens the shop's product page (from the QR link; for Pull&Bear straight from the reference, e.g. `3660/516/833` → `pullandbear.com/it/…-l03660516?cS=833`; for other shops through Google Shopping or Gemini with Google Search) and fills in name, type, fit and colour, uses the shop's product photo as the piece's picture (background removed as usual) and saves the product link. If the shop's photo shows another colour than the one on the label, or the page can't be read, it says so and you add your own photo. Inside a piece, the same button fills in only what's missing. The label photo isn't kept. The piece then shows its price and cost per wear, and Discover shows the total value of priced pieces. **Choose from gallery** pairs front and back photos by the time they were taken. **Turn** rotates a photo by hand. |
| **Discover** | Four tabs. **For you**: each **Worth adding** idea comes in three versions (for example white, light blue or navy), drawn in its colour, with how many of your pieces each goes with, the best match first. Tap a version to see the pieces you own it goes with, shop links, a wishlist button and **Real photos**. Below: your wishlist, style mix (tap a style to see those pieces), brands with their tier, wardrobe balance, palette, pieces you never wear and **What should I buy next?** (with an AI key). **Try a piece**: pick a type, colour and optionally fit, style, brand and details, or take a photo of it in the shop (with an AI key). The app says how easy it is to wear with what you own, warns when you already have something similar, and builds three outfits with it from your wardrobe for the occasion you pick. **Shop trip**: type a mall, outlet, shopping street or a single shop anywhere in the world. Gemini looks up which clothing shops are there with Google Search (once per place; the answer is kept on the device), and while the trip is on, every idea in Discover only shows those shops, each linking to a search on that shop's own website. A brand the app knows needs no lookup. **New look**: pick season, style and occasion for a complete outfit of new pieces, each with shop links. With an AI key it's one short request; without one the app builds it from its own list of pieces and colour stories. **Real photos** shows a few real products for one idea: from Google Shopping when the server has a SerpApi key (see "Product photos"), otherwise Gemini searches Google and the server reads each product page's photo, name and price (some shops block this; their products then show as plain links). **Settings > Look > Shop for** (Men or Women) decides who every shop search, product photo, shop trip and new look is for. |
| **Settings** | City or GPS for weather, your calendar links, whether T-shirts and the like go in the wash after one wear, °C/°F, theme, which shops to link to, background removal on or off, the AI provider (Gemini or Claude) with its key and model, a token counter for the month, and export, import or erase of all data. |

### Running it in the Claude preview

The Claude preview blocks every outside website. Inside it:

- **Weather** can't reach Open-Meteo (free, no key), so Today uses the usual temperatures for the month from the built-in city list.
- **Gemini and the Claude API** can't be reached with a key, so recognition and the stylist go through the viewer's own Claude account instead. The preview asks to allow it the first time.

On the tablet, or on any normal web address, the app uses live weather and your Gemini key as usual.

### How the outfit ideas work (offline, no AI)
- **Layers come from the temperature.** A base layer (tee) and a mid layer (hoodie or knit) are always included. Outerwear is added below 15° or when it's raining, and heavy puffers are avoided above 12°.
- **Colour.** Neutrals go with anything. One accent colour scores best, and two clashing accents or two graphic prints lose points.
- **Rotation.** Pieces worn in the last 1–4 days are pushed down, and forgotten ones get a turn.
- **Headwear and accessories.** Each idea adds the extras that fit: an umbrella when rain is likely, a beanie, beret or hat plus a scarf below 8° (gloves below 4°), a cap and sunglasses above 22° (no cap for smart occasions), a watch, and a belt or tie for smart occasions. Each pick favours colours that go with the outfit and pieces not worn lately. **Wear this today** logs them too.
- **Gym.** Gym pieces have their own section and types: gym T-shirt, tank top, long-sleeve top, sports bra, training hoodie, track jacket, gym shorts, leggings, track pants, training shoes, gym bag and gym accessory. They only appear when the **Gym** occasion is picked, which builds a workout outfit (top, a layer when it's cool, bottom, training shoes, gym bag) and adds an everyday jacket on cold or rainy days. Until you've added gym pieces for a part of the outfit, everyday T-shirts, hoodies, shorts, joggers and sneakers stand in.
- **Underwear and socks** are catalogued but left out of outfit ideas, the stylist prompt and "never worn".
- **Occasion and style.** Each style has a formality level (casual 1 to formal 4). The outfit's average should match the occasion, pieces that share a style score higher, and clashes such as sporty with formal lose points.
- **Fit and proportions.** Tops can be slim, regular, relaxed, oversized or cropped; bottoms slim, straight, regular, relaxed, baggy or wide leg. A roomy top over slimmer bottoms (or a fitted top with wide trousers) scores higher. Baggy on baggy is fine for a casual streetwear look and loses points for anything dressier, and roomy pieces lose points at work and elegant occasions. Set the fit when adding a piece (the AI fills it in), by tapping it on any piece, or for every piece at once from Settings (**Find the fit of N pieces**, one small AI request each).
- **Double denim.** A denim top with jeans loses a point.

### Calendar (no AI)
Paste your calendar's private iCal link in Settings > Calendar (Google Calendar: Settings, your calendar, **Secret address in iCal format**; Outlook: Publish a calendar, **ICS** link; iCloud: Public Calendar link). You can add several. The link is saved with the wardrobe, so every device uses it. Browsers can't read another site's calendar file, so the Worker fetches it (`POST /api/calendar`) and passes it on unchanged; `calendar.js` reads the events on the device, including repeating ones, and checks again every half hour.
- **Occasion from the event's name and place**, in English and Italian (plus common French, Spanish and German words): dinner, aperitivo or a party → Night out, a meeting, riunione or exam → Work, palestra or yoga → Gym, a wedding or the theatre → Elegant, lunch or a museum → Smart casual. Anything else is Everyday, and a whole-day entry (a birthday reminder, a holiday) doesn't change what you wear unless it's clearly an occasion. Tap an event's occasion to change it; that event name keeps your choice, on every device.
- **Ideas dress for the smartest event still to come today** unless you pick an occasion yourself. Tap any event to dress for it, and tap it again to go back. A gym session is only picked when you tap it.
- **Weather at that time.** The forecast comes hour by hour, so an evening event uses the evening temperature. Dressing now for something later today, an idea is warm enough for both.
- **Plan tomorrow.** After 6 pm tomorrow's events show too. Tap one and the ideas use tomorrow's forecast for that time; **Plan it for tomorrow** saves the outfit, which comes first on Today the next morning as **Planned last night**.
- With `server.py` or in the Claude preview there is no calendar reader, so only calendars that allow direct reading work there.

### Laundry
**In the wash** on any piece (or the toast after **Wear this today**) keeps it in your wardrobe but out of outfit ideas, swaps, **Start from a piece** and the stylist's outfits until it's back. T-shirts and shirts, underwear and socks, and gym clothes go in the wash by themselves when you log wearing them, with an **Undo**; jeans, knits, jackets and shoes stay until you mark them. This can be turned off in Settings > Laundry. **Laundry done** puts everything back at once.

### How the outfit ideas learn from you (on the tablet, no AI)
Real model training would need thousands of examples, paid computing and a hosted model, so the app learns from your own choices instead. **Wear this today**, **♥** and **Not for me** are saved in the wear log, which every device shares and backups include. Each idea is then scored on top of the rules above by:
- **Pairs of pieces** you've worn or liked together (higher) and combinations you turned down (lower). A piece you swap out counts against it going with the rest of that outfit.
- **Pieces and styles you reach for in each occasion**, so Night out learns what you wear on a night out.
- **Colour pairings and fits** of top and bottom you go for, which carries over to new pieces too.
- **How warm you dress.** Each outfit you wear is compared with the rule of thumb for how it felt that day; "too warm" and "too cold" count as well. If you run warm, ideas go a layer lighter, and the other way round. A few outfits don't swing it.
- **No repeats of a no.** An outfit you turned down stays out of the ideas for a month ("just not today", "too warm" and "too cold" only for the day).

Older signals count half as much after 60 days, so the ideas follow your taste as it changes. The line under the ideas says what they've learnt so far, and Settings > Data has **Forget likes and skips**. The stylist also gets a few short taste lines (about 50 tokens): pieces you often wear together, outfits you liked or turned down, whether you dress warmer or lighter, and what you wore in the last 2 days.

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
Choose the provider in Settings and paste a key; it stays on that device. Online, save the key in Cloudflare instead (see "Putting it online") and no device needs one.

- **Gemini** (default model `gemini-flash-latest`; `gemini-flash-lite-latest` and `gemini-pro-latest` are listed too). Get a key at aistudio.google.com. A Gemini app subscription (Gemini Pro or Advanced) does **not** include API access, but AI Studio has a free tier that should cover the light use this app makes of it.
- **Claude** uses `claude-opus-5-5` through the official `@anthropic-ai/sdk`.

**How the app keeps token use low**
| Feature | Tokens |
|---|---|
| Background removal, colours, daily outfits, pairings, shopping gaps | 0 (on the tablet) |
| Recognising a new piece | Roughly 500–1,000 (estimate): front and back cut-outs sent as **one** 768×512 picture, JSON reply capped at 320 tokens, Gemini thinking off. Done once per piece and saved. |
| Reading a label | Roughly 400–600 (estimate): one photo at 1024 px, JSON reply capped at 220 tokens. Only when you tap **Scan the label**. The QR code is read on the device (0 tokens). If neither the QR link nor the reference leads to the product page (and Google Shopping isn't set up), one more search request of about 300. |
| Classifying a brand the list and Wikidata can't place | About 150, once per brand, saved on the device. |
| Stylist question | About 1,000 in plus up to 800 out: the wardrobe is sent as one short numbered line per piece (about 15 tokens each) plus a few taste lines, and answers are capped at 24 short lines. The fashion bible adds about 400 tokens (its rules and the tips that fit the question). If an outfit in the answer breaks an important rule, one more request asks for a fix. |
| Finding the fit of pieces saved before fit existed | About 300 per piece (one small picture, a one-word reply). Only when you tap **Find the fit of N pieces**. |

Settings shows how many requests and tokens were used this month.

## Files
- `index.html`, `styles.css`, `app.js`: the whole app
- `calendar.js`: reads iCal calendar feeds (events, repeats, time zones) and guesses each event's occasion
- `label.js`: adding a piece from its label: product references, Pull&Bear links, product page titles (Italian words included) and QR links
- `vendor/jsqr.min.js`: jsQR 1.4.0 (Apache 2.0), reads QR codes where the browser can't
- `server.py`: serves the app and keeps the shared wardrobe in `data/` (Python 3 standard library only)
- `worker/api.js`, `wrangler.jsonc`, `.assetsignore`: the same sync API as a Cloudflare Worker, plus the AI pass-through that keeps keys off the devices
- `sample/`: resized copies of your photos (`*.jpg`), their cut-outs (`cut/*.webp`) and `seed.js`, which holds the catalogue data for them
- `manifest.webmanifest`, `icon.svg`: let you install the app on the home screen
- `tools/build_preview.py`: builds a one-page copy in `dist/` for the Claude preview
- `stylist.js`, `fashion-bible.json`: the fashion bible inside the app. The rules, tips and weights of the Python model below; every outfit idea is scored by them and the AI stylist must follow them (see `fashion-model/README.md`, "In the app")
- `fashion-model/`: a Python menswear model that learns from videos, magazines and styling rules and builds the "fashion bible" (never served; see its README). Training writes `fashion-bible.json` for the app
- `tools/stylist.test.mjs`: checks that `stylist.js` judges outfits exactly like the Python model (`node --test tools/stylist.test.mjs`)
- `tools/label.test.mjs`: checks `label.js` (`node --test tools/label.test.mjs`)

## How changes are made
`main` always holds the working app. Every update goes on its own branch (for example `update/weather-offline`) with a pull request describing what changed, and is merged into `main` once it's checked.

API keys are saved as secrets in Cloudflare, or typed into Settings on a device and stored only there. They are never part of this repository.
