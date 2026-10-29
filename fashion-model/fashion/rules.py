"""Checks that judge an outfit against one styling rule each.

Every check returns (score, note): score from -1 (breaks the rule) to +1 (a textbook use
of it), or None when the rule doesn't apply to this outfit. The rulebook
(knowledge/rulebook.json) says which check each rule uses, with what settings and how much
it matters; training then adjusts those weights from example outfits.
"""
from .outfit import Context, Outfit
from .vocab import COLORS, CORE, MATERIAL_TAGS, OCCASIONS, PATTERN_TAGS, STATEMENT_TAGS, wanted_warmth

CHECKS = {}


def check(fn):
    CHECKS[fn.__name__] = fn
    return fn


def clamp(x, lo=-1.0, hi=1.0):
    return max(lo, min(hi, x))


def main_colours(pieces):
    return [p.colour for p in pieces if p.colour]


# Pale shirting blue behaves like a neutral next to other colours.
SOFT_NEUTRALS = {"light blue"}


def is_accent(c):
    return not COLORS[c][0] and c not in SOFT_NEUTRALS


def clothes(o):
    """The core pieces minus shoes: shoes and belts follow their own leather rules."""
    return [p for p in o.core if p.slot != "shoes"]


# ---------- Colour ----------

@check
def accent_colours(o, ctx, limit=1):
    """Neutrals as the base, at most `limit` bright accent colour(s)."""
    accents = sorted({c for c in main_colours(o.core) if is_accent(c)})
    if not main_colours(o.core):
        return None, None
    if not accents:
        return 0.5, "All neutrals, easy to match"
    if len(accents) <= limit:
        return 1.0, f"{accents[0].capitalize()} as the single accent colour" if len(accents) == 1 else None
    return clamp(-(len(accents) - limit) * 0.7), f"Too many accent colours ({', '.join(accents)})"


@check
def colour_count(o, ctx, limit=3):
    """No more than `limit` different colours in the clothes (shoes and accessories aside)."""
    n = len(set(main_colours(clothes(o))))
    if n < 2:
        return None, None
    return (0.3, None) if n <= limit else (clamp(-(n - limit) * 0.6), f"{n} different colours: busy")


@check
def light_dark_contrast(o, ctx):
    """Light next to dark gives an outfit shape; all mid-tones can look flat."""
    tones = {COLORS[c][1] for c in main_colours(o.core)}
    if len(main_colours(o.core)) < 2:
        return None, None
    if "light" in tones and "dark" in tones:
        return 1.0, "Light and dark pieces give contrast"
    return (-0.3, "Little contrast between the pieces") if tones == {"mid"} else (0.0, None)


@check
def tonal(o, ctx):
    """One colour in different shades (tonal dressing) reads as deliberate."""
    cols = main_colours(o.core)
    if len(cols) >= 3 and len(set(cols)) == 1:
        return 1.0, f"Tonal {cols[0]} look"
    return None, None


def _pair_in(pairs, a, b):
    return any({a, b} == set(p) or (a == b and p[0] == p[1] == a) for p in pairs)


@check
def classic_pairs(o, ctx, pairs=()):
    """Top and bottom colours that are known to work together."""
    h, b = o.hero, o.bottom
    if not (h and b and h.colour and b.colour):
        return None, None
    if _pair_in(pairs, h.colour, b.colour):
        return 1.0, f"{h.colour.capitalize()} with {b.colour}: a classic pairing"
    return None, None


@check
def clashing_pairs(o, ctx, pairs=()):
    """Colours that fight each other when worn together."""
    cols = set(main_colours(o.core))
    for a, b in pairs:
        if a in cols and b in cols:
            return -1.0, f"{a.capitalize()} and {b} clash"
    return None, None


# ---------- Dressiness and style ----------

@check
def formality_spread(o, ctx, limit=1.5):
    """All clothes within `limit` of each other in dressiness (shoes have their own rule)."""
    fs = [p.formality for p in clothes(o)]
    if len(fs) < 2:
        return None, None
    spread = max(fs) - min(fs)
    if spread <= limit:
        return 0.5, None
    return clamp(-(spread - limit) / 1.5), "Mixes very casual and very dressy pieces"


@check
def occasion_formality(o, ctx):
    """As dressy as the occasion. Better a notch overdressed than underdressed, so dressing up
    is forgiven more than dressing down. Shoes are left out (they have their own rule)."""
    if ctx.occasion not in OCCASIONS or not o.core:
        return None, None
    label, target, _ = OCCASIONS[ctx.occasion]
    worn = clothes(o) or o.core
    gap = sum(p.formality for p in worn) / len(worn) - target
    over = gap > 0
    excess = abs(gap) - (0.9 if over else 0.4)
    if excess <= 0:
        return 1.0, f"Right level of dressiness for {label.lower()}"
    score = clamp(1 - excess * (0.8 if over else 1.2))
    return score, (("Overdressed" if over else "Underdressed") + f" for {label.lower()}" if score < 0.3 else None)


@check
def occasion_styles(o, ctx):
    """Pieces whose style suits the occasion."""
    if ctx.occasion not in OCCASIONS or not o.core:
        return None, None
    _, target, likes = OCCASIONS[ctx.occasion]

    def suits(p):
        if any(s in likes for s in p.styles):
            return 1.0
        # A notch dressier than the occasion still works (a knit and boots on an everyday walk).
        return 0.75 if ctx.occasion != "gym" and 0 < p.formality - target <= 1.5 else 0.0

    share = sum(suits(p) for p in o.core) / len(o.core)
    return clamp(share * 2 - 1), None


@check
def style_clash(o, ctx, pairs=(), kit=()):
    """Styles that don't belong in the same outfit (gym kit with tailoring...). Shoes have their own rule.
    `kit` pairs count the first style only on pieces that have no other: a pure gym top clashes with
    smart pieces, a sporty streetwear hoodie over a smart polo doesn't."""
    worn = clothes(o)
    present = {s for p in worn for s in p.styles}
    for a, b in pairs:
        if a in present and b in present:
            return -1.0, f"{a.capitalize()} and {b} pieces clash"
    for a, b in kit:
        if b in present and any(set(p.styles) == {a} for p in worn):
            return -1.0, f"{a.capitalize()} kit with {b} pieces"
    return None, None


@check
def consistent_style(o, ctx):
    """Every piece shares a style: the look tells one story."""
    if len(o.core) < 3:
        return None, None
    shared = set(o.core[0].styles).intersection(*(p.styles for p in o.core[1:]))
    if shared:
        return 1.0, f"A consistent {sorted(shared)[0]} look"
    return 0.0, None


# ---------- Silhouette ----------

@check
def proportions(o, ctx):
    """Balance volume: roomy with slim. Baggy on baggy only as a streetwear look, or on anyone under 30,
    for whom an oversized top over baggy or wide trousers is the look of the moment (smart casual too)."""
    h, b = o.hero, o.bottom
    if not (h and b) or h.volume is None or b.volume is None or ctx.occasion == "gym":
        return None, None
    top, bottom = h.volume, b.volume
    if top >= 1 and bottom <= 0:
        return 1.0, f"{h.fit.capitalize()} top balanced by {b.fit} {b.category}"
    if top <= -1 and bottom >= 1:
        return 0.8, f"Fitted top with {b.fit} {b.category}"
    if top >= 2 and bottom >= 2:
        street = any("streetwear" in p.styles for p in o.core)
        young = ctx.age is not None and ctx.age < 30
        relaxed = ctx.occasion in (None, "casual", "night")
        if relaxed and (street or young):
            return 0.3, "Relaxed streetwear proportions"
        return (0.0, None) if young and ctx.occasion == "smart" else (-1.0, "Roomy top and roomy bottom: shapeless")
    if top <= -1 and bottom <= -1:
        return 0.4, None
    return 0.0, None


# ---------- Statement pieces and patterns ----------

@check
def statement_limit(o, ctx, limit=1):
    """One loud piece (big graphic, logo, statement) per outfit; the rest supports it.
    On an accessory (sunglasses, a watch, a cap) a logo or small graphic is a detail: only a loud or
    statement accessory counts."""
    loud = [p for p in o.pieces if p.tags & STATEMENT_TAGS and (p.slot in CORE or p.tags & {"loud", "statement"})]
    if not loud:
        return None, None
    if len(loud) <= limit:
        return 0.5, None
    return clamp(-(len(loud) - limit) * 0.7), "More than one statement piece"


@check
def pattern_mixing(o, ctx):
    """One pattern is easy; two or more need different scales, so keep it rare."""
    patterned = [p for p in o.pieces if p.tags & PATTERN_TAGS]
    if not patterned:
        return None, None
    if len(patterned) == 1:
        return 0.3, None
    return clamp(-0.5 * (len(patterned) - 1)), "Several patterns at once"


@check
def denim_on_denim(o, ctx):
    """A denim top with jeans in the same wash reads as a uniform."""
    if not (o.bottom and o.bottom.category == "jeans"):
        return None, None
    if any(p.colour == "denim" or p.has("denim") for p in o.tops):
        denim = [p for p in o.tops + [o.bottom] if p.colour == "denim" or p.has("denim") or p.category == "jeans"]
        if len(denim) >= 3:
            return -1.0, "Denim from head to toe"
        washes = {p.colour for p in denim}
        return (-0.2, "Denim on denim, different washes") if len(washes) > 1 else (-0.8, "Denim on denim in the same wash")
    return None, None


# ---------- Shoes, belts, ties, suits ----------

@check
def shoe_formality(o, ctx):
    """Shoes at the same level as the clothes."""
    s = o.shoes
    if not s:
        return None, None
    casual_bits = [p for p in o.core if p.category in ("joggers", "shorts", "hoodie", "zip-hoodie", "sweatshirt", "track-pants")]
    tailored = bool(o.find("tie")) or _is_suit(o)
    if s.category == "dress-shoes" and casual_bits and not s.has("loafers"):
        return -1.0, f"Dress shoes with {casual_bits[0].category}"
    dressy_day = ctx.occasion in ("event", "work")
    if s.category in ("sneakers", "training-shoes") and tailored and (dressy_day or o.find("tie")):
        return -1.0, "Sneakers with tailoring"
    # Sporty sneakers or rugged boots with dressy clothes: a formal piece (dress shirt, formal trousers) and
    # nothing casual to balance it, or for work a mostly dressy outfit. Clean leather sneakers are fine, and so
    # is the high-low mix of a blazer over a T-shirt and jeans.
    worn = clothes(o)
    if s.category in ("sneakers", "boots") and s.formality <= 1.5 and any(st in ("sporty", "streetwear", "outdoor") for st in s.styles) and worn:
        unbalanced = any(p.formality >= 3.5 for p in worn) and not any(p.formality <= 1.5 for p in worn)
        if unbalanced or (dressy_day and sum(p.formality for p in worn) / len(worn) >= 2.3):
            return (-1.0 if dressy_day else -0.7 if ctx.occasion == "smart" else -0.4), \
                f"{'Sneakers' if s.category == 'sneakers' else 'Boots'} too casual for the rest"
    if s.category in ("sneakers", "training-shoes") and tailored:
        return -0.4, "Sneakers with tailoring"
    if s.category == "training-shoes" and ctx.occasion != "gym":
        return -0.5, "Training shoes outside the gym"
    if s.category in ("dress-shoes", "boots") and o.bottom and o.bottom.formality >= 2:
        return 0.6, None
    return 0.0, None


LEATHER_FAMILY = {"black": "black", "charcoal": "black", "brown": "brown", "burgundy": "brown", "beige": "brown", "cream": "brown"}


@check
def belt_matches_shoes(o, ctx):
    """Leather belt and leather shoes in the same colour family (black with black, brown with brown)."""
    belts = o.find("belt")
    s = o.shoes
    if not belts or not s or not (s.category in ("dress-shoes", "boots") or s.has("leather", "suede")):
        return None, None
    a, b = LEATHER_FAMILY.get(belts[0].colour), LEATHER_FAMILY.get(s.colour)
    if not a or not b:
        return None, None
    pair = f"{belts[0].colour.capitalize()} belt with {s.colour} shoes"
    return (1.0, pair) if a == b else (-1.0, pair)


@check
def tie_rules(o, ctx):
    """A tie goes with a collared shirt and long trousers, never with a hoodie."""
    if not o.find("tie"):
        return None, None
    if not (o.base and o.base.category == "shirt"):
        return -1.0, "A tie needs a collared shirt"
    if o.bottom and o.bottom.category in ("shorts", "joggers", "track-pants"):
        return -1.0, f"Tie with {o.bottom.category}"
    if o.mid and o.mid.category in ("hoodie", "zip-hoodie", "sweatshirt"):
        return -1.0, "Tie under a hoodie"
    return 0.6, None


def _is_suit(o):
    """Jacket and trousers of one suit: both tagged suit, or same colour, same cloth and both dressy."""
    j, t = o.outer, o.bottom
    if not (j and t and j.category == "jacket" and t.category == "trousers"):
        return False
    if j.has("suit") and t.has("suit"):
        return True
    same_cloth = (j.tags & MATERIAL_TAGS) == (t.tags & MATERIAL_TAGS)
    return j.colour == t.colour and same_cloth and j.formality >= 3 and t.formality >= 3


@check
def suit_rules(o, ctx):
    """A suit wants a shirt (or a fine knit) and leather shoes."""
    if not _is_suit(o):
        return None, None
    scores, note = [], "A proper suit"
    if o.base and o.base.category == "tshirt" and not o.mid:
        scores.append(-0.8 if ctx.occasion in ("work", "event") else 0.0)
        note = "T-shirt under a suit is casual"
    else:
        scores.append(1.0)
    if o.shoes:
        scores.append(1.0 if o.shoes.category in ("dress-shoes", "boots") else -0.7)
    return sum(scores) / len(scores), note


@check
def outerwear_match(o, ctx):
    """The coat at the same level as the outfit under it."""
    out = o.outer
    under = [p for p in o.core if p is not out]
    if not out or not under:
        return None, None
    f = sum(p.formality for p in under) / len(under)
    if out.category in ("puffer", "rain") and f >= 2.8:
        return -0.8, f"A {out.category} over a dressy outfit"
    if out.category == "coat" and f >= 2.3:
        return 0.8, "A coat that suits the outfit"
    if out.category == "jacket" and out.has("blazer") and o.mid and o.mid.category in ("hoodie", "zip-hoodie"):
        return -0.3, "Blazer over a hoodie"
    return 0.0, None


@check
def metals(o, ctx):
    """Keep metals on accessories consistent: all gold or all silver."""
    m = {t for p in o.extras for t in p.tags if t in ("gold", "silver")}
    if len(m) > 1:
        return -0.5, "Gold and silver mixed"
    return (0.2, None) if m else (None, None)


# ---------- Weather and fabrics ----------

@check
def warmth_for_weather(o, ctx):
    """Enough layers for the temperature, not too many."""
    if ctx.feels is None or not o.tops:
        return None, None
    have = sum(p.warmth for p in o.tops)
    gap = have - wanted_warmth(ctx.feels) - ctx.offset
    if abs(gap) <= 1:
        return 1.0, None
    return clamp(1 - abs(gap) / 2.5), ("Too warm" if gap > 0 else "Not warm enough") + f" for {round(ctx.feels)}°C"


@check
def shorts_weather(o, ctx):
    """Shorts when it's warm, long trousers when it isn't."""
    b = o.bottom
    if ctx.feels is None or not b:
        return None, None
    shorts = b.category in ("shorts", "gym-shorts")
    if shorts and ctx.feels < 17:
        return (-0.4 if ctx.occasion == "gym" else -1.0), f"Shorts at {round(ctx.feels)}°C"
    if shorts and ctx.feels >= 23:
        return 0.6, "Shorts weather"
    if not shorts and ctx.feels >= 28 and ctx.occasion in (None, "casual"):
        return -0.3, None
    return None, None


@check
def rain_ready(o, ctx):
    """On wet days: a jacket that keeps the rain off, shoes that don't mind it."""
    if not ctx.wet:
        return None, None
    s = 0.0
    if o.outer:
        s += 1.0 if o.outer.category == "rain" or o.outer.has("waterproof") else 0.3
    else:
        s -= 0.6
    if o.shoes and (o.shoes.has("suede") or (o.shoes.category == "sneakers" and o.shoes.colour in ("white", "cream"))):
        s -= 0.6
    return clamp(s), None


@check
def fabric_season(o, ctx):
    """Light fabrics (linen, seersucker) when hot, heavy ones (tweed, flannel, corduroy) when cold."""
    if ctx.feels is None:
        return None, None
    light = [p for p in o.pieces if p.has("linen", "seersucker")]
    heavy = [p for p in o.pieces if p.has("tweed", "flannel", "corduroy", "fleece")]
    if not light and not heavy:
        return None, None
    s = 0.0
    if light:
        s += 0.8 if ctx.feels >= 22 else -0.8 if ctx.feels < 14 else 0
    if heavy:
        s += 0.6 if ctx.feels < 12 else -0.8 if ctx.feels >= 22 else 0
    return clamp(s), ("Fabrics suit the season" if s > 0 else "Fabric weight doesn't suit the weather" if s < 0 else None)


@check
def gym_kit(o, ctx):
    """At the gym: sports clothes and training shoes."""
    if ctx.occasion != "gym" or not o.core:
        return None, None
    share = sum("sporty" in p.styles for p in o.core) / len(o.core)
    return clamp(share * 2 - 1), (None if share >= 0.8 else "Not all of it is made for training")


def evaluate(rules, outfit, ctx=None):
    """Run each rule's check. Returns [(rule, score, note)] for the rules that apply."""
    ctx = ctx or Context()
    if isinstance(outfit, str):
        outfit = Outfit.parse(outfit)
    out = []
    for r in rules:
        fn = CHECKS.get(r.get("check"))
        if not fn:
            continue
        if r.get("occasions") and ctx.occasion not in r["occasions"]:
            continue
        score, note = fn(outfit, ctx, **r.get("params", {}))
        if score is not None:
            out.append((r, score, note))
    return out
