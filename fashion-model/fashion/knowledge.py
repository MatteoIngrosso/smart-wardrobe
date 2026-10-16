"""Everything the model knows: the hand-written rulebook and examples, plus what was learnt
from each source. Tips that several sources agree on are merged and rank higher."""
import json
import math
import re
from collections import Counter

from . import KNOWLEDGE, LEARNED

STOP = set("""a an the and or but of to in on at for with without from by is are be it its this that these those you your
your's yours as if so not no never always than then very can could should would will just more most less much many one two
up out over under into about when what which who how all any each every some such them they their there here do does don't
wear wearing worn look looks""".split())


def words(text):
    return [w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOP and len(w) > 1]


def stem(w):
    """Rough word stem, so "longer" finds "long" and "buttons" finds "button"."""
    if w.endswith("er") and len(w) >= 6:
        return w[:-2]
    for end in ("ing", "ed", "es", "s"):
        if w.endswith(end) and len(w) - len(end) >= 3:
            return w[: -len(end)]
    return w


def load_rulebook():
    return json.loads((KNOWLEDGE / "rulebook.json").read_text(encoding="utf-8"))


def load_examples():
    return json.loads((KNOWLEDGE / "examples.json").read_text(encoding="utf-8"))["examples"]


def load_learned():
    """One record per source learnt (see learn.py), oldest first."""
    if not LEARNED.exists():
        return []
    recs = [json.loads(p.read_text(encoding="utf-8")) for p in sorted(LEARNED.glob("*.json"))]
    return sorted(recs, key=lambda r: r.get("learned_at", ""))


def similar(a, b):
    """A fallback for tips Gemini didn't link: the same advice when most meaningful words are shared."""
    wa, wb = {stem(w) for w in words(a)}, {stem(w) for w in words(b)}
    if not wa or not wb:
        return False
    shared = len(wa & wb)
    return shared / len(wa | wb) >= 0.5 or (shared >= 4 and shared / min(len(wa), len(wb)) >= 0.75)


STRENGTH = {"core": 1.0, "rule": 1.0, "tip": 0.8, "opinion": 0.4}


def merged_tips(rulebook=None, learned=None):
    """Core tips first, then learnt ones. A learnt tip that repeats an earlier one (Gemini's
    same_as, or the same words) adds a source to it instead of a new line; `support` counts
    how many sources gave the advice."""
    rulebook = rulebook or load_rulebook()
    learned = load_learned() if learned is None else learned
    tips = [{**t, "strength": "core", "sources": ["rulebook"], "support": 1} for t in rulebook["tips"]]
    by_id = {t["id"]: t for t in tips}  # also maps merged tips' ids to the tip they joined
    for rec in learned:
        src = rec["source"].get("title") or rec["source"]["url"]
        for t in rec.get("tips", []):
            same = by_id.get(t.get("same_as")) or next((x for x in tips if similar(x["text"], t["text"])), None)
            if same:
                by_id[t["id"]] = same
                if src not in same["sources"]:
                    same["sources"].append(src)
                    same["support"] += 1
                same["topics"] = same["topics"] + [x for x in t.get("topics", []) if x not in same["topics"]]
                continue
            tips.append({"id": t["id"], "text": t["text"], "why": t.get("why", ""), "topics": t.get("topics", []),
                         "occasions": t.get("occasions", []), "strength": t.get("strength", "tip"),
                         "sources": [src], "support": 1})
            by_id[t["id"]] = tips[-1]
    for t in tips:
        t["rank"] = round(STRENGTH.get(t["strength"], 0.8) * (1 + math.log(t["support"])), 3)
    return tips


class Search:
    """BM25 search over tips, so a question only pulls in the few tips it needs."""

    def __init__(self, tips, k1=1.4, b=0.75):
        self.tips, self.k1, self.b = tips, k1, b
        self.docs = [[stem(w) for w in words(" ".join([t["text"], t.get("why", ""), *t.get("topics", []), *t.get("occasions", [])]))] for t in tips]
        self.avg = sum(map(len, self.docs)) / max(1, len(self.docs))
        df = Counter(w for d in self.docs for w in set(d))
        n = len(self.docs)
        self.idf = {w: math.log(1 + (n - f + 0.5) / (f + 0.5)) for w, f in df.items()}

    def __call__(self, query, k=5, occasion=None):
        q = [stem(w) for w in words(query)]
        scored = []
        for t, d in zip(self.tips, self.docs):
            tf = Counter(d)
            s = sum(self.idf.get(w, 0) * tf[w] * (self.k1 + 1) / (tf[w] + self.k1 * (1 - self.b + self.b * len(d) / self.avg)) for w in q)
            if occasion and occasion in t.get("occasions", []):
                s += 1.0
            if s > 0:
                scored.append((s * (0.7 + 0.3 * t.get("rank", 1)), t))
        return [t for _, t in sorted(scored, key=lambda x: -x[0])[:k]]
