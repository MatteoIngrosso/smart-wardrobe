"""Test cases for the app's JavaScript copy of the checks (stylist.js).

`python -m fashion parity` runs the Python checks on many outfits and weather/occasion settings and
saves what they said in tests/parity.json. tools/stylist.test.mjs runs the same outfits through
stylist.js and fails if a single score or note differs, so the two can't drift apart.
Only the checks and the search are covered, not the learnt weights or tips, so training doesn't
change the file.
"""
import json
import random

from . import ROOT
from .knowledge import Search, load_examples, load_rulebook, merged_tips
from .model import features
from .outfit import Context, Outfit

PATH = ROOT / "tests" / "parity.json"

OUTFITS = [
    "jacket navy slim smart +blazer +wool, shirt white +oxford, trousers grey slim, dress-shoes brown +leather, belt brown",
    "jacket charcoal smart +suit +wool, trousers charcoal smart +suit +wool, shirt light blue, tie navy, dress-shoes black +leather, belt black",
    "tshirt white regular, jeans denim straight, sneakers white, watch silver",
    "tshirt black oversized +graphic streetwear, jeans black baggy streetwear, sneakers white streetwear, cap black",
    "hoodie grey oversized, joggers grey relaxed, sneakers white",
    "sweater burgundy +wool, trousers beige regular, boots brown +suede, scarf grey",
    "shirt blue +stripes, jeans denim, jacket denim +denim, sneakers cream",
    "polo green, shorts beige, sneakers white, sunglasses black, watch gold, bracelet silver",
    "coat camel smart, sweater navy, trousers grey smart, dress-shoes black, belt brown",
    "gym-top black sporty, gym-shorts grey sporty, training-shoes white sporty, backpack black",
    "puffer black, hoodie grey, jeans black slim, boots black +leather",
    "shirt white +linen, trousers beige +linen, loafers brown, belt black",
    "tshirt red, shirt pink, trousers orange, sneakers green",
    "shirt white, hoodie navy, tie red, shorts grey, dress-shoes black",
    "jacket olive +field-jacket, tshirt cream slim, jeans denim slim, boots brown +leather +waterproof, umbrella black",
    "rain yellow, tshirt white, trousers navy, sneakers white +suede",
    "sweater cream +cashmere, trousers cream +flannel, dress-shoes beige, watch gold, ring silver",
    "tshirt navy slim, jeans navy slim, sneakers navy",
    "shirt navy +check, jacket grey +tweed +blazer, trousers charcoal +stripes, dress-shoes black",
    "tank-top black sporty, track-pants black sporty, shirt white, dress-shoes black",
    "jacket black minimal, shirt white formal luxury, trousers navy slim formal luxury, sneakers black streetwear sporty",
    "sweater grey smart, trousers charcoal formal, boots brown outdoor",
    "jacket navy formal +blazer, tshirt white, jeans black baggy streetwear, sneakers red streetwear sporty",
]
SEARCHES = [
    ("how long should my tie be", None), ("what to wear with a navy blazer", "smart"), ("white sneakers", None),
    ("jeans fit", "casual"), ("shoes for a wedding", "event"), ("layering when it is cold", None),
    ("a watch and a belt", "work"), ("linen in summer", None), ("how do I wear a suit", "work"),
    ("stripes and checks together", None), ("what colours go with olive", "casual"), ("gym", "gym"),
]


def piece_dict(p):
    return {"category": p.category, "colors": list(p.colors), "fit": p.fit, "styles": list(p.styles), "tags": sorted(p.tags), "warmth": p.warmth}


def contexts(seed=7, n=8):
    rnd = random.Random(seed)
    occasions = [None, "casual", "smart", "work", "night", "event", "gym"]
    out = []
    for _ in range(n):
        out.append({"occasion": rnd.choice(occasions), "feels": rnd.choice([None, -3, 2, 6.5, 10, 13.5, 16, 19.5, 22, 24, 27, 31]),
                    "wet": rnd.random() < 0.3, "offset": rnd.choice([0, 0, 0, 1.5, -1])})
    return out


def build():
    rules = load_rulebook()["rules"]
    cases = []

    def add(outfit, ctx):
        x, notes = features(rules, outfit, Context(**ctx))
        cases.append({"pieces": [piece_dict(p) for p in outfit.pieces], "ctx": ctx,
                      "x": {k: round(v, 9) for k, v in x.items()}, "notes": notes})

    for e in load_examples():
        add(Outfit.parse(e["outfit"]), {"occasion": e.get("occasion"), "feels": e.get("feels"), "wet": bool(e.get("wet")), "offset": 0})
    for text in OUTFITS:
        o = Outfit.parse(text)
        for ctx in contexts():
            add(o, ctx)
        for occasion in ("casual", "smart", "work"):
            for age in (19, 45):
                add(o, {"occasion": occasion, "feels": None, "wet": False, "offset": 0, "age": age})
    tips = merged_tips(load_rulebook(), [])
    slim = [{k: t[k] for k in ("id", "text", "why", "topics", "occasions", "strength", "support", "rank") if k in t} for t in tips]
    search = Search(tips)
    return {"cases": cases, "tips": slim,
            "searches": [{"query": q, "occasion": occ, "ids": [t["id"] for t in search(q, k=6, occasion=occ)]} for q, occ in SEARCHES]}


def write():
    PATH.write_text(json.dumps(build(), separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    return PATH
