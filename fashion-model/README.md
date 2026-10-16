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

The app doesn't use the bible yet; how it plugs in comes next.
