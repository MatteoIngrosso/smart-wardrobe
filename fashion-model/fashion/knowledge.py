"""Everything the model knows: the hand-written rulebook and examples, plus what was learnt
from each source. Tips that several sources agree on are merged and rank higher."""
import json
import math
import re
from collections import Counter, defaultdict

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


def stems(text):
    return {stem(w) for w in words(text)}


def similar(a, b):
    """A fallback for tips Gemini didn't link: the same advice when most meaningful words are shared."""
    return alike(stems(a), stems(b))


def alike(wa, wb):
    if not wa or not wb:
        return False
    shared = len(wa & wb)
    return shared / len(wa | wb) >= 0.5 or (shared >= 4 and shared / min(len(wa), len(wb)) >= 0.75)


STRENGTH = {"core": 1.0, "rule": 1.0, "tip": 0.8, "opinion": 0.4}


def merged_tips(rulebook=None, learned=None):
    """Core tips first, then learnt ones. A learnt tip that repeats another (its same_as, or the
    same words) adds a source to that tip instead of a new line; `support` counts how many sources
    gave the advice. same_as can point at any tip, learnt before or after it, and chains of
    same_as are followed."""
    rulebook = rulebook or load_rulebook()
    learned = load_learned() if learned is None else learned
    tips, words_of = [], []
    by_id = {}               # also maps merged tips' ids to the tip they joined
    index = defaultdict(list)  # word stem -> positions in tips, so repeats are found without comparing every pair

    def new(tip):
        ws = stems(tip["text"])
        for w in ws:
            index[w].append(len(tips))
        tips.append(tip)
        words_of.append(ws)
        by_id[tip["id"]] = tip

    def repeat_of(text):
        ws = stems(text)
        return next((tips[i] for i in sorted({i for w in ws for i in index.get(w, ())}) if alike(ws, words_of[i])), None)

    for t in rulebook["tips"]:
        new({**t, "strength": "core", "sources": ["rulebook"], "support": 1})
    raw = {t["id"]: t for rec in learned for t in rec.get("tips", [])}
    known = set(raw) | set(by_id)

    def root(tid):
        seen = set()
        while tid in raw and tid not in seen and raw[tid].get("same_as") in known:
            seen.add(tid)
            tid = raw[tid]["same_as"]
        return min(seen) if tid in seen else tid  # a loop of same_as: any one of them, always the same

    def join(tip, t, src):
        by_id[t["id"]] = tip
        if src not in tip["sources"]:
            tip["sources"].append(src)
            tip["support"] += 1
        tip["topics"] = tip["topics"] + [x for x in t.get("topics", []) if x not in tip["topics"]]

    linked = []
    for rec in learned:
        src = rec["source"].get("title") or rec["source"]["url"]
        for t in rec.get("tips", []):
            if root(t["id"]) != t["id"]:
                linked.append((t, src))
                continue
            same = repeat_of(t["text"])
            if same:
                join(same, t, src)
            else:
                new({"id": t["id"], "text": t["text"], "why": t.get("why", ""), "topics": t.get("topics", []),
                     "occasions": t.get("occasions", []), "strength": t.get("strength", "tip"),
                     "sources": [src], "support": 1})
    for t, src in linked:
        join(by_id[root(t["id"])], t, src)
    for t in tips:
        t["rank"] = round(STRENGTH.get(t["strength"], 0.8) * (1 + math.log(t["support"])), 3)
    return tips


def relevant(tips, text, k):
    """The k tips a long text (a transcript, an article) is most likely to repeat: those sharing
    the most of its words, rare words counting more."""
    have = stems(text)
    docs = [stems(t["text"]) for t in tips]
    df = Counter(w for d in docs for w in d)
    score = [sum(math.log(len(docs) / df[w]) for w in d if w in have) / math.sqrt(len(d) or 1) for d in docs]
    return [tips[i] for i in sorted(range(len(tips)), key=lambda i: -score[i])[:k]]


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
