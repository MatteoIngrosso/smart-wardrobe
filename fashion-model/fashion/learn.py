"""Learning from a source: Gemini reads a video transcript or article once and writes down
the styling rules and the example outfits in it, in the app's vocabulary.

Each source becomes one file in knowledge/learned/, so you can read what was learnt, fix it
by hand, or delete it. A source already learnt is skipped (no tokens spent) unless forced.
"""
import json
import re
from datetime import datetime, timezone

from . import LEARNED
from .gemini import DEFAULT_MODEL, generate_json
from .knowledge import merged_tips
from .outfit import Piece
from .sources import fetch
from .vocab import CATS, COLORS, FITS, OCCASIONS, STYLES, TOPICS

SYSTEM = (
    "You are a menswear editor building a style rulebook. From the transcript or article you get, extract:\n"
    "1. tips: every concrete piece of styling advice (fit, colour, proportions, dress codes, fabrics, shoes, "
    "accessories, layering, care). Write each one in your own words, in English, as one short instruction "
    "(at most 30 words), with a short reason. Don't quote. Merge repeats. Mark 'rule' for widely accepted "
    "rules, 'tip' for good advice, 'opinion' for the author's personal taste or trends.\n"
    "2. outfits: complete men's outfits the source recommends or warns against, with at least a top and a "
    "bottom. Describe each piece with the allowed values only; leave out fit or style when unknown. "
    "Use tags for details such as blazer, suit, oxford, loafers, chelsea, linen, wool, tweed, suede, leather, "
    "graphic, logo, stripes, check, waterproof.\n"
    "Skip sponsor messages, product plugs, prices, and small talk. Womenswear-only advice is skipped. "
    "If the source has no styling advice, return empty lists.\n"
    "3. When a tip says the same thing as one of the KNOWN TIPS below, set same_as to that tip's id "
    "(still write the tip). Otherwise leave same_as out."
)

_s = lambda **kw: {"type": "STRING", **kw}
SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "title": _s(description="The video's or article's title"),
        "tips": {"type": "ARRAY", "items": {
            "type": "OBJECT",
            "properties": {
                "text": _s(), "why": _s(),
                "topics": {"type": "ARRAY", "items": _s(enum=TOPICS)},
                "occasions": {"type": "ARRAY", "items": _s(enum=list(OCCASIONS))},
                "strength": _s(enum=["rule", "tip", "opinion"]),
                "same_as": _s(),
            },
            "required": ["text", "why", "topics", "strength"],
            "propertyOrdering": ["text", "why", "topics", "occasions", "strength", "same_as"],
        }},
        "outfits": {"type": "ARRAY", "items": {
            "type": "OBJECT",
            "properties": {
                "pieces": {"type": "ARRAY", "items": {
                    "type": "OBJECT",
                    "properties": {
                        "type": _s(enum=list(CATS)), "colour": _s(enum=list(COLORS)),
                        "fit": _s(enum=list(FITS)), "style": _s(enum=list(STYLES)),
                        "tags": {"type": "ARRAY", "items": _s()},
                    },
                    "required": ["type", "colour"],
                    "propertyOrdering": ["type", "colour", "fit", "style", "tags"],
                }},
                "occasion": _s(enum=list(OCCASIONS)),
                "verdict": _s(enum=["good", "avoid"]),
                "why": _s(),
            },
            "required": ["pieces", "occasion", "verdict", "why"],
            "propertyOrdering": ["pieces", "occasion", "verdict", "why"],
        }},
    },
    "required": ["title", "tips", "outfits"],
    "propertyOrdering": ["title", "tips", "outfits"],
}


def slug(src):
    """A file name for a source: the YouTube id, or the link's words."""
    from .sources import youtube_id
    vid = youtube_id(src)
    if vid:
        return f"yt-{vid}"
    s = re.sub(r"^https?://(www\.)?", "", src.strip().lower())
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")[:80]


def learnt_path(src):
    return LEARNED / f"{slug(src)}.json"


def learn(src, key=None, model=DEFAULT_MODEL, force=False, log=print):
    """Learn from one source. Returns the path of its file in knowledge/learned/."""
    path = learnt_path(src)
    if path.exists() and not force:
        log(f"  already learnt: {path.name} (use --force to read it again)")
        return path
    s = fetch(src)
    log(f"  read {s['kind']}: {s['title'][:70]} ({len(s['text']):,} characters)")
    known = known_tips()
    system = SYSTEM + "\n\nKNOWN TIPS:\n" + "\n".join(f"{t['id']}: {t['text'][:90]}" for t in known)
    data, usage = generate_json(system, f"Title: {s['title']}\nBy: {s['author']}\n\n{s['text']}", SCHEMA, key=key, model=model)
    return save(src, s, data, {t["id"] for t in known}, model, usage, log)


def add(src, data, log=print):
    """Learn from a source read some other way (by you, or by another AI): `data` has the same
    shape as Gemini's answer ({title, tips, outfits}, see `instructions()`). Checked and saved
    exactly like a Gemini answer."""
    from .sources import youtube_id
    vid = youtube_id(src)
    kind = "video" if vid else "article" if src.startswith(("http://", "https://")) else "file"
    url = f"https://www.youtube.com/watch?v={vid}" if vid else src
    meta = {"kind": kind, "url": url, "title": data.get("title") or url, "author": data.get("author", "")}
    return save(src, meta, data, {t["id"] for t in merged_tips()}, "by hand", None, log)


def save(src, meta, data, known_ids, model, usage=None, log=print):
    path = learnt_path(src)
    usage = usage or {"in": 0, "out": 0}
    tips, outfits = clean_tips(data.get("tips", []), known_ids), clean_outfits(data.get("outfits", []))
    record = {
        "source": {"kind": meta["kind"], "url": meta["url"], "title": data.get("title") or meta["title"], "author": meta.get("author", "")},
        "learned_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "model": model,
        "tokens": usage,
        "tips": [{"id": f"{path.stem}-{n + 1}", **t} for n, t in enumerate(tips)],
        "outfits": outfits,
    }
    LEARNED.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    spent = f" ({usage['in']:,} tokens in, {usage['out']:,} out)" if usage["in"] else ""
    log(f"  learnt {len(tips)} tips and {len(outfits)} outfits{spent} -> {path.name}")
    return path


def instructions():
    """What Gemini is told, as text, for reading a source without Gemini and saving it with `add`."""
    known = known_tips()
    return "\n".join([
        SYSTEM, "",
        "Answer with JSON only, shaped like this:",
        '{"title": "...", "tips": [{"text": "...", "why": "...", "topics": ["..."], "occasions": ["..."], '
        '"strength": "rule|tip|opinion", "same_as": "known tip id, or leave out"}], '
        '"outfits": [{"pieces": [{"type": "...", "colour": "...", "fit": "...", "style": "...", "tags": ["..."]}], '
        '"occasion": "...", "verdict": "good|avoid", "why": "..."}]}',
        "Allowed values:",
        f"- topics: {', '.join(TOPICS)}",
        f"- occasions: {', '.join(OCCASIONS)}",
        f"- type: {', '.join(CATS)} (also: blazer, chinos, loafers, chelsea, oxfords, cardigan, turtleneck, parka...)",
        f"- colour: {', '.join(COLORS)}",
        f"- fit: {', '.join(FITS)}",
        f"- style: {', '.join(STYLES)}",
        "", "KNOWN TIPS:", *(f"{t['id']}: {t['text'][:90]}" for t in known),
    ])


def known_tips(limit=150):
    """The tips already in the bible, best supported first, so Gemini can say which ones a source repeats.
    About 20 tokens each."""
    return sorted(merged_tips(), key=lambda t: -t["rank"])[:limit]


def clean_tips(tips, known_ids=()):
    out = []
    for t in tips:
        text = " ".join(str(t.get("text", "")).split())
        if len(text) < 12:
            continue
        tip = {
            "text": text, "why": " ".join(str(t.get("why", "")).split()),
            "topics": [x for x in t.get("topics", []) if x in TOPICS] or ["wardrobe"],
            "occasions": [x for x in t.get("occasions", []) if x in OCCASIONS],
            "strength": t.get("strength") if t.get("strength") in ("rule", "tip", "opinion") else "tip",
        }
        if t.get("same_as") in known_ids:
            tip["same_as"] = t["same_as"]
        out.append(tip)
    return out


def clean_outfits(outfits):
    """Keeps outfits the app could build (a top and a bottom at least), written in the short form."""
    out = []
    for o in outfits:
        pieces = []
        for p in o.get("pieces", []):
            try:
                pieces.append(Piece.from_dict(p))
            except ValueError:
                continue
        slots = {p.slot for p in pieces}
        if not ({"base", "mid"} & slots and "bottom" in slots):
            continue
        if o.get("verdict") not in ("good", "avoid") or o.get("occasion") not in OCCASIONS:
            continue
        out.append({"outfit": ", ".join(str(p) for p in pieces), "occasion": o["occasion"],
                    "verdict": o["verdict"], "why": " ".join(str(o.get("why", "")).split())})
    return out


def read_list(path):
    """Links in a text file, one per line. Lines starting with # are notes."""
    lines = [l.strip() for l in open(path, encoding="utf-8")]
    return [l.split()[0] for l in lines if l and not l.startswith("#")]
