# Fashion model

A menswear style model in Python that learns from YouTube videos, magazine articles and styling rules, and packs everything it knows into one file, the **fashion bible** (`bible/fashion-bible.json`), for the Smart Wardrobe app to use later. It is separate from the app: nothing here changes the live site.

It runs free on your computer. It needs Python 3.10 or newer, no other packages (plus one small optional package for YouTube), and a Gemini key from Google AI Studio for reading videos and articles. Everything else (training, checking outfits, searching tips) needs no key and no internet.

## How it works

1. **The rulebook** (`knowledge/rulebook.json`) holds the starting knowledge, written by hand:
   - 26 **rules** the model can check on any outfit by itself: one accent colour, balance roomy with slim, belt matches the shoes, a tie needs a collared shirt, suits want leather shoes, dress for the temperature, and so on. Each rule has a check in `fashion/rules.py` and a starting weight (how much it matters).
   - 64 **tips** a check can't see: how a jacket should fit at the shoulders, never fasten the bottom button, how long a tie should be, what "business casual" means...
2. **Learning** (`python -m fashion learn <link>`): Gemini reads a video's transcript or an article once and writes down its advice as short tips in its own words, plus any complete outfits it recommends or warns against, using the app's own words for garment types, colours, fits, styles and occasions. Each source is saved as one file in `knowledge/learned/`, so you can read it, correct it, or delete it. A source is never read twice, so it never costs tokens twice. Advice that several sources repeat is merged, counted, and ranks higher in the bible.
3. **Training** (`python -m fashion train`): every example outfit (42 hand-written ones in `knowledge/examples.json`, plus the ones learnt from sources) is scored by each rule. A logistic regression then learns how much each rule really matters, starting from the rulebook's weights. With few examples it stays close to the rulebook, so a couple of odd outfits can't throw it off; as sources add outfits, the data takes over. Training prints how often it judges outfits right that it didn't train on, next to the rulebook's weights alone.
4. **The fashion bible** is written at the end of training:
   - `bible/fashion-bible.json`: rules with their checks and learnt weights, every tip with its sources and how many sources agree, example outfits, the list of sources, and a short `prompt` (about 600 tokens) with the most important rules and tips for an AI stylist.
   - `bible/fashion-bible.md`: the same, to read.

## On your computer (Windows)

```bat
cd C:\Users\matte\Documents\Wardrobe2.0
git pull
cd fashion-model
pip install youtube-transcript-api
```

Save your Gemini key in a file called `.env` in the `fashion-model` folder, with one line (the file is never committed):

```
GEMINI_KEY=AIza...
```

Then:

```bat
:: learn from one or more videos or articles (it retrains afterwards)
python -m fashion learn https://www.youtube.com/watch?v=VIDEO_ID https://www.example.com/some-style-article

:: learn from every link in knowledge\sources.txt (one per line)
python -m fashion learn --list

:: an article behind a paywall or a magazine scan: save its text as a .txt file and learn from the file
python -m fashion learn articles\suit-guide.txt

:: retrain and rebuild the bible by hand
python -m fashion train

:: score an outfit and see why
python -m fashion check "blazer navy slim, shirt white +oxford, chinos beige, loafers brown, belt brown" --occasion smart --temp 18

:: find the tips that answer a question
python -m fashion search "how long should my tie be"

:: what it knows so far
python -m fashion stats
```

### Without a Gemini key

Another AI (or you) can do Gemini's reading instead, and the result is checked and saved the same way:

```bat
python -m fashion fetch https://www.youtube.com/watch?v=VIDEO_ID --out transcript.txt
python -m fashion instructions
:: read transcript.txt following those instructions, save the answer as answer.json, then:
python -m fashion add answer.json --source https://www.youtube.com/watch?v=VIDEO_ID
```

### Writing an outfit

Pieces are separated by commas. Each piece is its type, then any colours, fit, styles and `+tags`:

```
jacket navy slim smart +blazer +wool, shirt light blue +oxford, trousers grey slim, dress-shoes brown +leather
```

- Types are the app's (`tshirt`, `shirt`, `polo`, `sweater`, `hoodie`, `overshirt`, `jacket`, `coat`, `puffer`, `rain`, `jeans`, `trousers`, `joggers`, `shorts`, `sneakers`, `boots`, `dress-shoes`, `belt`, `tie`, `watch`...). Everyday names work too: `blazer`, `chinos`, `loafers`, `chelsea`, `oxfords`, `cardigan`, `turtleneck`, `parka`...
- Colours, fits (`slim`, `regular`, `straight`, `relaxed`, `oversized`, `baggy`, `wide`) and styles (`casual`, `streetwear`, `smart casual`, `smart`, `formal`...) are the app's too.
- `+tags` add detail the rules use: `+suit`, `+blazer`, `+linen`, `+tweed`, `+flannel`, `+suede`, `+leather`, `+graphic`, `+logo`, `+stripes`, `+check`, `+waterproof`, `+gold`, `+silver`.
- `--occasion` is one of `casual`, `smart`, `work`, `night`, `event`, `gym`; `--temp` is how warm it feels in °C; `--wet` for rain.

### What to feed it

Good sources explain *why* something works and show complete outfits: menswear channels that teach rules (fit, colours, dress codes, suits), magazine style guides, and books or guides you own (saved as text). Mix a few classic-menswear sources with a few modern or streetwear ones, so the bible doesn't end up with one person's taste. Videos need captions (most have automatic ones). Only the short tips and outfits are kept, never the transcript or article itself; still, use sources you're allowed to read, and save paywalled articles as text only from your own subscription.

Each source costs one Gemini call: a 15-minute video is about 5,000 to 8,000 tokens in and 1,000 to 2,000 out, which fits easily in AI Studio's free tier.

## Files

- `fashion/vocab.py`: the app's garment types, colours, styles, fits and occasions (mirrors `app.js`)
- `fashion/outfit.py`: pieces and outfits, and the short way to write them
- `fashion/rules.py`: one check per rule, each scoring an outfit from -1 to +1
- `fashion/sources.py`: reads YouTube transcripts, web articles and text files
- `fashion/gemini.py`: a minimal Gemini client (no packages)
- `fashion/learn.py`: turns a source into tips and outfits with Gemini
- `fashion/knowledge.py`: loads everything, merges repeated tips, searches tips
- `fashion/model.py`: the logistic regression and its cross-validation
- `fashion/bible.py`: training, and writing the bible
- `knowledge/rulebook.json`, `knowledge/examples.json`: the hand-written rules, tips and example outfits
- `knowledge/sources.txt`: your list of links to learn from
- `knowledge/learned/`: one file per source learnt
- `bible/`: the fashion bible, rebuilt by every training
- `tests/`: run `python -m unittest discover -s tests` from this folder

## In the app

The app follows the bible. Everything it needs is in two files at the top of the repository:

- `fashion-bible.json`: a slim copy of the bible (rules with their learnt weights, tips, and the app's vocabulary). `python -m fashion train` rewrites it every time; `python -m fashion export` rewrites it without retraining. The app downloads it, keeps a copy on the device so it also works offline, and picks up a newer one by itself.
- `stylist.js`: the app's JavaScript copy of the 26 checks and the tip search. It reads the rules from `fashion-bible.json`, so teaching the model something new needs no change there. A change to a *check* (`fashion/rules.py`) does: change both, then run `python -m fashion parity` and `node --test tools/stylist.test.mjs` from the top of the repository. The Python tests fail if `tests/parity.json` or `fashion-bible.json` is out of date, and the JavaScript test fails if the two copies ever score an outfit differently.

What the app does with it:

- **Outfit ideas** (Today, Start from a piece, swaps, Discover): every candidate is scored by the bible's rules, together with the app's own weather comfort, rotation and taste. A candidate that breaks an important rule (weight 0.5 or more, broken by half or more) is only shown when nothing else is left, and then its card says what is off. Belts are matched to the shoes.
- **Ask the stylist and Discover looks**: each request carries the mandatory rules (about 20 short lines) plus the few tips that best answer the question (found with the same search as `python -m fashion search`), roughly 400 tokens. The outfits that come back are checked against the same rules; if one breaks an important rule, the AI is asked once to fix it, and anything still broken is flagged on its card. Weather and occasion aren't checked on the AI's outfits, because the question may be about another day.
- Settings has a Fashion bible card with what it knows.

If the bible can't be loaded (first visit offline), the app falls back to its older built-in rules.
