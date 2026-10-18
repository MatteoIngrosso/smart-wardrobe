"""Training, and the fashion bible it produces.

`train()` fits the rule weights to every example outfit (hand-written and learnt), merges
the tips from every source, and writes:
  bible/fashion-bible.json  everything in one file, for the app to load later
  bible/fashion-bible.md    the same, to read
"""
import json
from collections import defaultdict
from datetime import datetime, timezone

from . import APP_BIBLE, BIBLE
from .knowledge import load_examples, load_learned, load_rulebook, merged_tips
from .model import Model, accuracy, cross_validated, example_rows, features
from .outfit import Context, Outfit
from .rules import LEATHER_FAMILY, SOFT_NEUTRALS
from . import vocab
from .vocab import OCCASIONS, TOPICS

PROMPT_CHARS = 2500  # the stylist prompt stays around 600 tokens


def train(log=print):
    rulebook = load_rulebook()
    rules = rulebook["rules"]
    prior = {r["id"]: r["weight"] for r in rules}
    learned = load_learned()

    core = [{**e, "source": "rulebook"} for e in load_examples()]
    found = [{**o, "source": rec["source"].get("title") or rec["source"]["url"]} for rec in learned for o in rec.get("outfits", [])]
    core_rows, bad1 = example_rows(rules, core, weight=1.0)
    found_rows, bad2 = example_rows(rules, found, weight=0.7)  # learnt outfits count a bit less than checked ones
    for e, err in bad1 + bad2:
        log(f"  skipped an example ({err}): {e['outfit'][:60]}")
    rows = core_rows + found_rows

    log(f"Training on {len(rows)} outfits ({len(core_rows)} from the rulebook, {len(found_rows)} learnt from {len(learned)} sources)...")
    model = Model.train(rows, prior)
    stats = {
        "training": accuracy(model, rows),
        "unseen": cross_validated(rows, prior),
        "rulebook_only_unseen": cross_validated(rows, prior, fixed=True),  # the starting weights, only the bias fitted
    }
    tips = sorted(merged_tips(rulebook, learned), key=lambda t: -t["rank"])
    bible = {
        "name": "Fashion bible",
        "version": 1,
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "about": "Menswear rules, tips and example outfits, in the Smart Wardrobe app's vocabulary "
                 "(garment types, colours, styles, fits and occasions as in app.js). "
                 "Score an outfit with: sigmoid(model.bias + sum(rule.weight * check(rule))).",
        "model": {
            "bias": model.bias,
            "trained_on": {"outfits": len(rows), "rulebook": len(core_rows), "learnt": len(found_rows), "sources": len(learned)},
            "accuracy": {k: (round(v, 3) if v is not None else None) for k, v in stats.items()},
        },
        "rules": [{**{k: r[k] for k in ("id", "title", "why", "check") if k in r},
                   "params": r.get("params", {}), "weight": model.w[r["id"]], "prior": r["weight"],
                   "topics": r.get("topics", []), "occasions": r.get("occasions", [])} for r in rules],
        "tips": [{k: t[k] for k in ("id", "text", "why", "topics", "occasions", "strength", "support", "rank", "sources") if k in t} for t in tips],
        "sources": [{**rec["source"], "learned_at": rec.get("learned_at"), "tips": len(rec.get("tips", [])),
                     "outfits": len(rec.get("outfits", []))} for rec in learned],
        "examples": [{k: e[k] for k in ("outfit", "occasion", "feels", "wet", "verdict", "why", "source") if k in e} for e in core + found],
    }
    bible["prompt"] = prompt_text(bible)
    BIBLE.mkdir(parents=True, exist_ok=True)
    (BIBLE / "fashion-bible.json").write_text(json.dumps(bible, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    (BIBLE / "fashion-bible.md").write_text(markdown(bible), encoding="utf-8")
    export_for_app(bible)
    report(bible, log)
    return bible


def app_vocab():
    """The words the rules are said in, so the app's copy of the checks needs nothing else."""
    return {
        "cats": {k: list(v) for k, v in vocab.CATS.items()},
        "colors": {k: list(v) for k, v in vocab.COLORS.items()},
        "styles": dict(vocab.STYLES),
        "fits": dict(vocab.FITS),
        "occasions": {k: list(v) for k, v in vocab.OCCASIONS.items()},
        "material_tags": sorted(vocab.MATERIAL_TAGS),
        "pattern_tags": sorted(vocab.PATTERN_TAGS),
        "statement_tags": sorted(vocab.STATEMENT_TAGS),
        "soft_neutrals": sorted(SOFT_NEUTRALS),
        "leather_family": dict(LEATHER_FAMILY),
    }


def export_for_app(bible=None, path=None):
    """The part of the bible the app needs, as one small file at the top of the repository
    (fashion-bible.json): rules with their weights, tips, and the vocabulary. Left out: the
    example outfits, the source list and which source said what, which only matter here."""
    bible = bible or load_bible()
    if bible is None:
        raise FileNotFoundError("No bible yet: run  python -m fashion train")
    slim = {
        "name": bible["name"], "version": bible["version"], "built_at": bible["built_at"],
        "model": {"bias": bible["model"]["bias"], "trained_on": bible["model"]["trained_on"], "accuracy": bible["model"]["accuracy"]},
        "rules": [{k: r[k] for k in ("id", "title", "why", "check", "params", "weight", "occasions")} for r in bible["rules"]],
        "tips": [{k: t[k] for k in ("id", "text", "why", "topics", "occasions", "strength", "support", "rank") if k in t} for t in bible["tips"]],
        "vocab": app_vocab(),
    }
    out = path or APP_BIBLE
    out.write_text(json.dumps(slim, separators=(",", ":"), ensure_ascii=False) + "\n", encoding="utf-8")
    return out


def report(bible, log):
    acc = bible["model"]["accuracy"]
    pct = lambda v: "n/a" if v is None else f"{v:.0%}"
    log(f"Accuracy on outfits it trained on: {pct(acc['training'])}")
    log(f"Accuracy on outfits it hadn't seen: {pct(acc['unseen'])} (rulebook weights alone: {pct(acc['rulebook_only_unseen'])})")
    moved = sorted(bible["rules"], key=lambda r: -abs(r["weight"] - r["prior"]))[:5]
    if moved and abs(moved[0]["weight"] - moved[0]["prior"]) >= 0.05:
        log("Biggest changes from the rulebook:")
        for r in moved:
            if abs(r["weight"] - r["prior"]) >= 0.05:
                log(f"  {r['title']}: {r['prior']} -> {r['weight']}")
    log(f"Tips: {len(bible['tips'])} ({sum(t['support'] > 1 for t in bible['tips'])} confirmed by more than one source)")
    log(f"Wrote {BIBLE / 'fashion-bible.json'} and fashion-bible.md")


def prompt_text(bible, limit=PROMPT_CHARS):
    """A compact version for an AI stylist's instructions: the rules that matter most, then
    the best-supported tips, until the limit."""
    lines = ["Menswear rules, most important first:"]
    for r in sorted(bible["rules"], key=lambda r: -r["weight"]):
        if r["weight"] >= 0.5:
            lines.append(f"- {r['title']}.")
    lines.append("Tips:")
    for t in bible["tips"]:
        if t.get("strength") == "opinion":
            continue
        line = f"- {t['text']}"
        if sum(map(len, lines)) + len(line) + len(lines) > limit:
            break
        lines.append(line)
    return "\n".join(lines)


def markdown(b):
    m = b["model"]
    acc = m["accuracy"]
    pct = lambda v: "n/a" if v is None else f"{v:.0%}"
    out = [
        "# Fashion bible", "",
        f"Built {b['built_at'][:10]} from {m['trained_on']['sources']} learnt sources, "
        f"{len(b['rules'])} rules, {len(b['tips'])} tips and {m['trained_on']['outfits']} example outfits.", "",
        f"Model accuracy on outfits it hadn't seen: **{pct(acc['unseen'])}** "
        f"(rulebook weights alone: {pct(acc['rulebook_only_unseen'])}).", "",
        "## Rules", "",
        "Checked automatically on every outfit. Weight is how much each one matters after training (rulebook value in brackets).", "",
        "| Rule | Weight | Why |", "|---|---|---|",
    ]
    for r in sorted(b["rules"], key=lambda r: -r["weight"]):
        out.append(f"| {r['title']} | {r['weight']:.2f} ({r['prior']}) | {r['why']} |")
    out += ["", "## Tips", ""]
    by_topic = defaultdict(list)
    for t in b["tips"]:
        by_topic[(t.get("topics") or ["wardrobe"])[0]].append(t)
    for topic in TOPICS:
        if not by_topic.get(topic):
            continue
        out += [f"### {topic.capitalize()}", ""]
        for t in by_topic[topic]:
            extra = []
            if t.get("support", 1) > 1:
                extra.append(f"{t['support']} sources")
            if t.get("strength") == "opinion":
                extra.append("opinion")
            if t.get("occasions"):
                extra.append(", ".join(OCCASIONS[o][0] for o in t["occasions"] if o in OCCASIONS))
            out.append(f"- {t['text']}" + (f" _{t['why']}_" if t.get("why") else "") + (f" ({'; '.join(extra)})" if extra else ""))
        out.append("")
    out += ["## Example outfits", ""]
    for verdict, head in (("good", "Good"), ("avoid", "Avoid")):
        out += [f"### {head}", ""]
        for e in b["examples"]:
            if e["verdict"] == verdict:
                occ = OCCASIONS.get(e.get("occasion"), ("",))[0]
                out.append(f"- **{occ}**: {e['outfit']}. {e.get('why', '')}")
        out.append("")
    if b["sources"]:
        out += ["## Sources", ""]
        for s in b["sources"]:
            out.append(f"- [{s.get('title') or s['url']}]({s['url']}) {s.get('author', '')}: {s['tips']} tips, {s['outfits']} outfits")
        out.append("")
    return "\n".join(out)


def load_bible():
    path = BIBLE / "fashion-bible.json"
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else None


def judge(outfit, ctx=None, bible=None):
    """How good an outfit is (0-1) and why: [(rule title, check score, points, note)], biggest effect first.
    Uses the trained bible if it exists, else the rulebook's starting weights."""
    bible = bible or load_bible()
    rules = bible["rules"] if bible else load_rulebook()["rules"]
    model = Model({r["id"]: r["weight"] for r in rules}, bible["model"]["bias"] if bible else 0.0)
    if isinstance(outfit, str):
        outfit = Outfit.parse(outfit)
    x, notes = features(rules, outfit, ctx or Context())
    by_id = {r["id"]: r for r in rules}
    why = sorted(((by_id[k]["title"], v, model.w.get(k, 0) * v, notes.get(k)) for k, v in x.items()), key=lambda t: -abs(t[2]))
    return model.prob(x), why
