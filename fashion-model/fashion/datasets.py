"""Outfit datasets made by stylists, read into the model's own words.

FashionStylist (https://github.com/recsys-benchmark/FashionStylist, CC BY-NC 4.0, V1 English): 300
men's outfits, every piece labelled by fashion experts (type, style, fit, material, colour, pattern,
details) and every outfit with its season and occasion. The CSVs are kept in
knowledge/datasets/fashionstylist/ with their licence. Nothing here needs a key or the internet.

  python -m fashion dataset          turns the outfits into knowledge/learned/fashionstylist-men.json
                                     (4 in 5 of them; the rest are kept back for the benchmark)
  python -m fashion bench            how often the bible scores a real outfit above the same outfit
                                     with one piece swapped for another outfit's piece of that kind

The outfits are mostly East Asian streetwear (Cityboy, Korean trendy, avant-garde, techwear, American
vintage, quiet luxury) for home, travel, school and social life, with no business looks: they count
less than the magazines' outfits (WEIGHT), so they teach the bible today's relaxed menswear without
overruling the rest.
"""
import csv
import json
import random
import re
from datetime import datetime, timezone

from . import KNOWLEDGE
from .outfit import Piece, Outfit, Context
from .vocab import CORE, MATERIAL_TAGS

DIR = KNOWLEDGE / "datasets" / "fashionstylist"
OUT = KNOWLEDGE / "learned" / "fashionstylist-men.json"
URL = "https://github.com/recsys-benchmark/FashionStylist"
WEIGHT = 0.35  # the magazines' outfits count 0.7, the hand-written ones 1
HELD_OUT = 5   # every 5th outfit (b5, b10...) is kept back for the benchmark

SEASON_FEELS = {"Spring": 17, "Summer": 27, "Autumn": 14, "Winter": 5, "Spring/Summer": 22, "Autumn/Winter": 9}
OCCASION = {"Social": "night"}  # Home, Travel, School, Sports and their mixes: everyday

# Colour words, longest first: the first one found in the label is the piece's colour.
COLOURS = [
    ("off-white", "cream"), ("ivory", "cream"), ("oatmeal", "cream"), ("cream", "cream"), ("apricot", "cream"),
    ("navy blue", "navy"), ("olive green", "olive"), ("light gray", "grey"), ("light grey", "grey"),
    ("light blue", "light blue"), ("sky blue", "light blue"), ("navy", "navy"), ("dark blue", "navy"),
    ("charcoal", "charcoal"), ("dark gray", "charcoal"), ("dark grey", "charcoal"),
    ("light khaki", "beige"), ("khaki", "beige"), ("light beige", "beige"), ("beige", "beige"), ("wheat", "beige"),
    ("camel", "beige"), ("sand", "beige"), ("tan", "beige"),
    ("brownish red", "burgundy"), ("wine", "burgundy"), ("burgundy", "burgundy"),
    ("coffee", "brown"), ("chocolate", "brown"), ("brown", "brown"), ("leopard", "brown"),
    ("army green", "olive"), ("olive", "olive"), ("dark green", "olive"), ("green", "green"),
    ("gray", "grey"), ("grey", "grey"), ("silver", "grey"),
    ("black", "black"), ("white", "white"), ("blue", "blue"), ("red", "red"), ("orange", "orange"),
    ("yellow", "yellow"), ("pink", "pink"), ("purple", "purple"),
]
STYLE_WORDS = [
    ("quiet luxury", "luxury"), ("old money", "luxury"), ("luxury", "luxury"), ("formal", "formal"), ("suit", "formal"),
    ("business casual", "smart casual"), ("smart casual", "smart casual"), ("commuter", "smart casual"),
    ("business", "smart"), ("elegant", "smart"), ("gentleman", "smart"), ("dress", "smart"),
    ("minimalist", "minimal"), ("minimal", "minimal"), ("vintage", "vintage"), ("retro", "vintage"), ("american", "vintage"),
    ("techwear", "outdoor"), ("outdoor", "outdoor"), ("utility", "outdoor"), ("cargo", "outdoor"),
    ("trendy", "streetwear"), ("street", "streetwear"), ("cityboy", "streetwear"), ("hip-hop", "streetwear"),
    ("avant-garde", "streetwear"), ("sport", "sporty"), ("athletic", "sporty"),
    ("casual", "casual"), ("basic", "casual"), ("daily", "casual"), ("relaxed", "casual"),
]
PATTERNS = [("plaid", "check"), ("check", "check"), ("stripe", "stripes"), ("camouflage", "camo"), ("camo", "camo"),
            ("leopard", "print"), ("print", "print"), ("graphic", "graphic"), ("letter", "graphic"), ("logo", "logo")]


def _type(cat, title, style):
    """The app's garment type (and any tags it implies) for one labelled piece, or None to leave it out."""
    t = f" {title.lower()} "
    has = lambda *w: any(x in t for x in w)
    if cat == "onepiece":
        return None
    if cat == "bag":
        return ("backpack", []) if has("backpack") else ("bag", [])
    if cat == "accessory":
        for words, out in [(("beanie",), "beanie"), (("bucket",), "bucket-hat"), (("beret",), "beret"), (("cap",), "cap"),
                           (("hat",), "hat"), (("scarf",), "scarf"), (("necklace", "chain", "pendant"), "necklace"),
                           (("bracelet", "bangle"), "bracelet"), ((" ring",), "ring"), (("earring",), "earrings"),
                           (("watch",), "watch"), (("belt",), "belt"), (("sunglass",), "sunglasses"), (("glasses",), "glasses"),
                           ((" tie ",), "tie"), (("glove",), "gloves")]:
            if has(*words):
                return out, []
        return "accessory", []
    if cat == "shoes":
        if has("boot"):
            return "boots", ["chelsea"] if has("chelsea") else []
        if has("loafer"):
            return "dress-shoes", ["loafers"]
        if has("derby", "oxford", "brogue", "monk", "leather shoe", "dress shoe"):
            return "dress-shoes", []
        if has("slide", "clog", "sandal", "slipper"):
            return None  # no such type in the app
        return "sneakers", []
    if cat == "bottom":
        if has("short"):
            return "shorts", []
        if has("jean", "denim"):
            return "jeans", []
        if has("jogger", "sweatpant", "track pant"):
            return "joggers", []
        if has("skirt"):
            return None
        return "trousers", ["cargo"] if has("cargo") else []
    if cat == "outerwear":
        if has("puffer", "down jacket", "down coat", "padded"):
            return "puffer", []
        if has("parka"):
            return "coat", ["parka"]
        if has("coat", "trench"):
            return "coat", []
        if has("blazer", "suit jacket"):
            return "jacket", ["blazer"]
        if has("windbreaker", "rain"):
            return "rain", []
        if has("cardigan"):
            return "sweater", ["cardigan"]
        if has("shirt jacket", "overshirt", "shacket", "shirt"):
            return "overshirt", []
        return "jacket", ["denim"] if has("denim") else []
    if cat == "mid_layer_top":
        if has("hood"):
            return ("zip-hoodie" if has("zip-up", "full-zip", "zip hood") and not has("half-zip") else "hoodie"), []
        if has("sweatshirt", "crewneck"):
            return "sweatshirt", []
        if has("cardigan"):
            return "sweater", ["cardigan"]
        if has("turtleneck"):
            return "sweater", ["turtleneck"]
        if has("polo"):
            return "polo", []
        if has("shirt") and not has("t-shirt", "tee"):
            return "overshirt", []
        if has("t-shirt", "tee"):
            return "tshirt", []
        return "sweater", []
    if cat == "inner_top":
        if has("turtleneck"):
            return "sweater", ["turtleneck"]
        if has("polo"):
            return "polo", []
        if has("shirt") and not has("t-shirt", "tee"):
            return "shirt", []
        if has("knit", "sweater"):
            return "sweater", []
        return "tshirt", []
    return None


def _colours(text, material):
    t, found = text.lower(), []
    for word, colour in COLOURS:
        at = t.find(word)
        if at >= 0 and colour not in [c for _, c in found]:
            found.append((at, colour))
            t = t.replace(word, " " * len(word))
    out = [c for _, c in sorted(found)][:2]
    if "denim" in material.lower() and out[:1] in (["blue"], ["light blue"]):
        out[0] = "denim"
    return out


def _fit(outline, category, slot):
    o = outline.lower()
    if slot not in ("base", "mid", "outer", "bottom"):
        return ""
    if "wide" in o or "flare" in o:
        return "wide"
    if "slim" in o or "fitted" in o or "form-fitting" in o or "stretch" in o:
        return "slim"
    if "crop" in o:
        return "cropped"
    if "drop-shoulder" in o or "oversized" in o:
        return "oversized"
    if "loose" in o or "jogger" in o:
        return "baggy" if slot == "bottom" and category in ("jeans", "trousers") else "relaxed"
    if "straight" in o:
        return "straight"
    if "regular" in o:
        return "regular"
    return ""


def _styles(text):
    t, out = text.lower(), []
    for word, style in STYLE_WORDS:
        if word in t and style not in out:
            out.append(style)
            t = t.replace(word, " ")
    return out[:2]


def piece_of(row):
    """One labelled piece -> a Piece in the app's words, or None when the app has no such type."""
    typ = _type(row["category"], row["title"], row["style"])
    if not typ:
        return None
    category, tags = typ
    text = " ".join(row.get(k, "") for k in ("title", "pattern", "detail")).lower()
    tags = set(tags) | {m for m in MATERIAL_TAGS if m in row["materials"].lower()}
    tags |= {tag for word, tag in PATTERNS if word in text}
    if category in ("jeans", "trousers", "shorts") and ("distressed" in text or "ripped" in text):
        tags.add("ripped")
    p = Piece(category, _colours(row["color"], row["materials"]), "", _styles(f"{row['style']} {row['title']}"), tags)
    p.fit = _fit(row["outline"], category, p.slot)
    return p


def load():
    """The 300 men's outfits: [{id, number, pieces, occasion, feels, look}]."""
    labels = {r["itemID"].strip(): r for r in csv.DictReader(open(DIR / "male-label_en.csv", encoding="utf-8-sig"))}
    out = []
    for r in csv.DictReader(open(DIR / "male-look_en.csv", encoding="utf-8-sig")):
        ids = [x.strip() for x in re.split(r"[,，]", r["items"]) if x.strip()]
        pieces, taken = [], set()
        for i in ids:
            p = labels.get(i) and piece_of(labels[i])
            if not p:
                continue
            if p.slot in CORE and p.slot in taken:
                continue  # a second inner top is an alternative in the listing, not a second layer
            taken.add(p.slot)
            pieces.append(p)
        if not ({"base", "mid"} & taken and "bottom" in taken):
            continue
        occasion = OCCASION.get(r["occasion"].strip(), "casual")
        if occasion == "night" and re.search(r"quiet luxury|old money", r["look"], re.I):
            occasion = "smart"
        out.append({"id": r["outfitID"].strip(), "number": int(re.sub(r"\D", "", r["outfitID"]) or 0), "pieces": pieces,
                    "occasion": occasion, "feels": SEASON_FEELS.get(r["season"].strip()), "look": " ".join(r["look"].split())})
    return out


def write():
    """knowledge/learned/fashionstylist-men.json: the training outfits as one learnt source, all "good".
    (Tried: the same outfits with one piece swapped as light "avoid" examples. The rules can't tell most
    swaps from the real thing, so training only shrank every weight towards 0: no.)"""
    outfits = [o for o in load() if o["number"] % HELD_OUT]
    record = {
        "source": {"kind": "dataset", "url": URL, "title": "FashionStylist V1 (men), expert-labelled outfits", "author": "FashionStylist authors, CC BY-NC 4.0"},
        "learned_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": "dataset",
        "tokens": {"in": 0, "out": 0},
        "tips": [],
        "outfits": [{"outfit": ", ".join(str(p) for p in o["pieces"]), "occasion": o["occasion"], "feels": o["feels"],
                     "verdict": "good", "why": o["look"][:200], "weight": WEIGHT} for o in outfits],
    }
    OUT.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return OUT, len(outfits)


def bench(rules, model, swaps=5, seed=7, held_out=True):
    """The share of (real outfit, same outfit with one piece swapped) pairs where the real one scores
    higher. The swapped piece is the same kind (top, bottoms, shoes...) from another outfit, so the
    swap is plausible but wasn't chosen by a stylist. Ties count half."""
    from .model import features
    rng = random.Random(seed)
    data = [o for o in load() if not held_out or o["number"] % HELD_OUT == 0]
    pool = {}
    for o in load():
        for p in o["pieces"]:
            if p.slot in CORE:
                pool.setdefault(p.slot, []).append((o["id"], p))
    wins = total = 0.0
    for o in data:
        ctx = Context(o["occasion"], o["feels"])
        real = model.prob(features(rules, Outfit(o["pieces"]), ctx)[0])
        core = [i for i, p in enumerate(o["pieces"]) if p.slot in CORE]
        for _ in range(swaps):
            i = rng.choice(core)
            slot = o["pieces"][i].slot
            choices = [p for oid, p in pool[slot] if oid != o["id"]]
            fake = list(o["pieces"])
            fake[i] = rng.choice(choices)
            s = model.prob(features(rules, Outfit(fake), ctx)[0])
            wins += 1 if real > s else 0.5 if real == s else 0
            total += 1
    return wins / total if total else 0.0, len(data)
