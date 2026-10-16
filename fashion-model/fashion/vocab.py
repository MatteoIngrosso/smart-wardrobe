"""The app's vocabulary: garment types, colours, styles, fits and occasions.

These mirror the constants at the top of app.js (CATS, COLORS, STYLES, FITS, OCCASIONS),
so everything the model learns is said in words the app already understands.
"""

# Garment types: id -> (slot, warmth 1-5, default styles). Gym pieces carry a role instead.
CATS = {
    "tshirt": ("base", 1, ["casual"]),
    "shirt": ("base", 1, ["smart casual"]),
    "polo": ("base", 1, ["smart casual", "preppy"]),
    "sweatshirt": ("mid", 2, ["casual"]),
    "hoodie": ("mid", 3, ["casual"]),
    "zip-hoodie": ("mid", 3, ["casual"]),
    "sweater": ("mid", 3, ["smart casual"]),
    "overshirt": ("mid", 2, ["smart casual"]),
    "jacket": ("outer", 3, ["smart casual"]),
    "rain": ("outer", 2, ["outdoor"]),
    "coat": ("outer", 4, ["smart"]),
    "puffer": ("outer", 5, ["casual", "outdoor"]),
    "jeans": ("bottom", 2, ["casual"]),
    "trousers": ("bottom", 2, ["smart casual"]),
    "joggers": ("bottom", 2, ["sporty"]),
    "shorts": ("bottom", 1, ["casual"]),
    "skirt": ("bottom", 1, ["smart casual"]),
    "sneakers": ("shoes", 2, ["casual"]),
    "boots": ("shoes", 4, ["smart casual"]),
    "dress-shoes": ("shoes", 2, ["formal"]),
    "cap": ("head", 1, ["casual", "streetwear"]),
    "beanie": ("head", 3, ["casual", "streetwear"]),
    "beret": ("head", 2, ["smart casual", "vintage"]),
    "bucket-hat": ("head", 1, ["streetwear"]),
    "hat": ("head", 2, ["smart"]),
    "watch": ("acc", 1, []),
    "bracelet": ("acc", 1, []),
    "necklace": ("acc", 1, []),
    "ring": ("acc", 1, []),
    "sunglasses": ("acc", 1, []),
    "belt": ("acc", 1, ["smart casual"]),
    "bag": ("acc", 1, []),
    "backpack": ("acc", 1, ["casual"]),
    "wallet": ("acc", 1, []),
    "scarf": ("acc", 3, ["smart casual"]),
    "gloves": ("acc", 3, []),
    "tie": ("acc", 1, ["smart", "formal"]),
    "umbrella": ("acc", 1, []),
    "accessory": ("acc", 1, []),
    "gym-top": ("base", 1, ["sporty"]),
    "tank-top": ("base", 1, ["sporty"]),
    "long-sleeve-top": ("base", 2, ["sporty"]),
    "gym-hoodie": ("mid", 3, ["sporty"]),
    "track-jacket": ("mid", 2, ["sporty"]),
    "gym-shorts": ("bottom", 1, ["sporty"]),
    "leggings": ("bottom", 2, ["sporty"]),
    "track-pants": ("bottom", 2, ["sporty"]),
    "training-shoes": ("shoes", 2, ["sporty"]),
}
CORE = ["base", "mid", "outer", "bottom", "shoes"]

# Colours: name -> (neutral?, tone)
COLORS = {
    "black": (True, "dark"), "charcoal": (True, "dark"), "grey": (True, "mid"),
    "white": (True, "light"), "cream": (True, "light"), "beige": (True, "light"),
    "brown": (True, "dark"), "navy": (True, "dark"), "denim": (True, "mid"),
    "olive": (True, "mid"), "burgundy": (False, "dark"), "red": (False, "mid"),
    "orange": (False, "mid"), "yellow": (False, "light"), "green": (False, "mid"),
    "blue": (False, "mid"), "light blue": (False, "light"), "purple": (False, "mid"),
    "pink": (False, "light"),
}

# Styles: name -> how dressy (1 casual ... 4 formal)
STYLES = {
    "casual": 1, "streetwear": 1, "sporty": 1, "outdoor": 1,
    "minimal": 2, "vintage": 2, "smart casual": 2,
    "preppy": 3, "smart": 3, "luxury": 3, "formal": 4,
}

# Fits: name -> volume (-1 close to the body ... 2 roomy)
FITS = {
    "slim": -1, "regular": 0, "straight": 0, "relaxed": 1,
    "oversized": 2, "baggy": 2, "wide": 2, "cropped": 0,
}

# Occasions: id -> (label, target dressiness, styles that suit it)
OCCASIONS = {
    "casual": ("Everyday", 1.3, ["casual", "streetwear", "sporty", "outdoor", "minimal", "vintage"]),
    "smart": ("Smart casual", 2.3, ["smart casual", "minimal", "preppy", "smart"]),
    "work": ("Work / meeting", 2.9, ["smart", "smart casual", "preppy", "formal", "minimal"]),
    "night": ("Night out", 2.1, ["streetwear", "luxury", "smart casual", "minimal", "smart"]),
    "event": ("Elegant", 3.4, ["formal", "smart", "luxury"]),
    "gym": ("Gym", 1.0, ["sporty", "outdoor", "casual"]),
}

# Topics the fashion bible is organised by.
TOPICS = [
    "colour", "fit", "proportions", "suits", "shirts", "knitwear", "outerwear", "trousers",
    "denim", "shoes", "accessories", "layering", "weather", "fabrics", "patterns",
    "occasions", "formal", "smart casual", "casual", "streetwear", "sportswear", "wardrobe", "care",
]

# Words that describe a piece beyond its type, written as +tags (as in the app).
MATERIAL_TAGS = {"linen", "seersucker", "cotton", "wool", "flannel", "tweed", "corduroy", "cashmere",
                 "merino", "leather", "suede", "denim", "silk", "velvet", "nylon", "fleece"}
PATTERN_TAGS = {"stripes", "striped", "check", "checked", "plaid", "tartan", "houndstooth",
                "herringbone", "print", "printed", "floral", "camo", "paisley", "polka"}
STATEMENT_TAGS = {"graphic", "statement", "logo", "loud"}


def slot_of(category):
    return CATS.get(category, ("acc", 1, []))[0]


def formality_of(styles, category=None):
    """How dressy a piece is, from its styles (or its type's usual styles)."""
    fs = [STYLES[s] for s in styles if s in STYLES]
    if not fs and category in CATS:
        fs = [STYLES[s] for s in CATS[category][2] if s in STYLES]
    return round(sum(fs) / len(fs), 1) if fs else 1.0


def wanted_warmth(feels):
    """Warmth points of the top layers that suit a temperature (same rule of thumb as the app)."""
    if feels >= 24: return 1
    if feels >= 19: return 2.5
    if feels >= 14: return 3.5
    if feels >= 8: return 6
    if feels >= 2: return 8
    return 9.5
