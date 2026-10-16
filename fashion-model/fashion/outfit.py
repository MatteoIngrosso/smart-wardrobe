"""Pieces and outfits, and a short way to write them.

A piece is written as words: its type, then any colours, fit, styles and +tags, e.g.
    "jacket navy slim smart +blazer +wool"
An outfit is pieces separated by commas:
    "jacket navy +blazer, shirt white, trousers grey, dress-shoes brown +leather, belt brown"
Everyday names work too ("blazer", "loafers", "chinos"...), see ALIASES.
"""
from dataclasses import dataclass, field

from .vocab import CATS, COLORS, CORE, FITS, STYLES, formality_of, slot_of

# Everyday garment names -> (app type, tags they imply)
ALIASES = {
    "t-shirt": ("tshirt", []), "tee": ("tshirt", []), "henley": ("tshirt", ["henley"]),
    "oxford": ("shirt", ["oxford"]), "dress-shirt": ("shirt", ["dress shirt"]),
    "knit": ("sweater", []), "jumper": ("sweater", []), "cardigan": ("sweater", ["cardigan"]),
    "turtleneck": ("sweater", ["turtleneck"]), "crewneck": ("sweatshirt", []),
    "blazer": ("jacket", ["blazer"]), "suit-jacket": ("jacket", ["suit"]), "sport-coat": ("jacket", ["blazer"]),
    "bomber": ("jacket", ["bomber"]), "denim-jacket": ("jacket", ["denim"]), "leather-jacket": ("jacket", ["leather"]),
    "field-jacket": ("jacket", ["field jacket"]), "harrington": ("jacket", ["harrington"]),
    "overcoat": ("coat", []), "parka": ("coat", ["parka"]), "trench": ("coat", ["trench"]), "peacoat": ("coat", ["peacoat"]),
    "chinos": ("trousers", ["chinos"]), "suit-trousers": ("trousers", ["suit"]), "cargo": ("trousers", ["cargo"]),
    "sweatpants": ("joggers", []),
    "trainers": ("sneakers", []), "loafers": ("dress-shoes", ["loafers"]), "derbies": ("dress-shoes", ["derby"]),
    "oxfords": ("dress-shoes", ["oxford"]), "brogues": ("dress-shoes", ["brogue"]), "monks": ("dress-shoes", ["monk strap"]),
    "chelsea": ("boots", ["chelsea"]), "chelsea-boots": ("boots", ["chelsea"]), "desert-boots": ("boots", ["suede"]),
    "pocket-square": ("accessory", ["pocket square"]),
}
MULTIWORD = sorted([c for c in COLORS if " " in c] + [s for s in STYLES if " " in s], key=len, reverse=True)


@dataclass
class Piece:
    category: str
    colors: list = field(default_factory=list)
    fit: str = ""
    styles: list = field(default_factory=list)
    tags: set = field(default_factory=set)
    warmth: int = 0
    name: str = ""

    def __post_init__(self):
        if self.category not in CATS:
            raise ValueError(f"Unknown garment type: {self.category!r}")
        if not self.warmth:
            self.warmth = CATS[self.category][1]
        if not self.styles:
            self.styles = list(CATS[self.category][2])
        self.tags = {t.lower() for t in self.tags}

    @property
    def slot(self):
        return slot_of(self.category)

    @property
    def colour(self):
        return self.colors[0] if self.colors else None

    @property
    def formality(self):
        return formality_of(self.styles, self.category)

    @property
    def volume(self):
        return FITS.get(self.fit)

    def has(self, *tags):
        return any(t in self.tags for t in tags)

    def __str__(self):
        words = [self.category, *self.colors, self.fit, *self.styles, *(f"+{t.replace(' ', '-')}" for t in sorted(self.tags))]
        return " ".join(w for w in words if w)

    @classmethod
    def parse(cls, text):
        """"jacket navy slim smart +blazer" -> Piece. Unknown words become tags."""
        s = f" {text.strip().lower()} "
        colors, styles, tags, fit, category = [], [], [], "", None
        # Two-word names first ("light blue", "smart casual"), so their words aren't read apart.
        for name in MULTIWORD:
            while f" {name} " in s:
                (colors if name in COLORS else styles).append(name)
                s = s.replace(f" {name} ", " ", 1)
        for word in s.split():
            if word.startswith("+"):
                tags.append(word[1:].replace("-", " "))
            elif category is None and word in CATS:
                category = word
            elif category is None and word in ALIASES:
                category, implied = ALIASES[word]
                tags += implied
            elif word in COLORS:
                colors.append(word)
            elif word in STYLES:
                styles.append(word)
            elif word in FITS:
                fit = word
            else:
                tags.append(word)
        if category is None:
            raise ValueError(f"No garment type in {text!r}")
        return cls(category, colors, fit, styles, set(tags))

    @classmethod
    def from_dict(cls, d):
        """A piece as the app stores it ({category, colors, fit, styles, tags, warmth, name})
        or as the learner writes it ({type, colour, fit, style, tags})."""
        category = d.get("category") or d.get("type")
        tags = list(d.get("tags") or [])
        if category in ALIASES:
            category, implied = ALIASES[category]
            tags += implied
        colors = d.get("colors") or ([d["colour"]] if d.get("colour") else [])
        styles = d.get("styles") or ([d["style"]] if d.get("style") else [])
        return cls(category, [c for c in colors if c in COLORS], d.get("fit") if d.get("fit") in FITS else "",
                   [s for s in styles if s in STYLES], set(tags), int(d.get("warmth") or 0), d.get("name", ""))


@dataclass
class Context:
    """What the outfit is for. Anything left out is simply not judged."""
    occasion: str = None
    feels: float = None
    wet: bool = False


class Outfit:
    def __init__(self, pieces):
        self.pieces = list(pieces)
        self.role = {}      # base, mid, outer, bottom, shoes -> the piece in that place
        self.extras = []    # headwear, accessories, and any second layer of the same kind
        for p in self.pieces:
            if p.slot in CORE and p.slot not in self.role:
                self.role[p.slot] = p
            else:
                self.extras.append(p)

    @classmethod
    def parse(cls, text):
        return cls(Piece.parse(part) for part in text.split(",") if part.strip())

    def __getattr__(self, name):
        if name in CORE:
            return self.role.get(name)
        raise AttributeError(name)

    @property
    def core(self):
        return [self.role[r] for r in CORE if r in self.role]

    @property
    def hero(self):
        """The top people see first (under any jacket): it sets the outfit's colour and fit."""
        return self.role.get("mid") or self.role.get("base")

    @property
    def tops(self):
        return [p for p in self.pieces if p.slot in ("base", "mid", "outer")]

    def find(self, *categories):
        return [p for p in self.pieces if p.category in categories]

    def __str__(self):
        return ", ".join(str(p) for p in self.pieces)
