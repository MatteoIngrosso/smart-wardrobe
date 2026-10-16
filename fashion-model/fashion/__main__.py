"""Command line: python -m fashion <command>

  learn <link or file> [...]     read videos/articles with Gemini and save what they teach
  learn --list sources.txt       the same for every link in a file
  train                          fit the model to all example outfits and write the bible
  check "<outfit>"               score an outfit and say why
  search "<question>"            the tips that answer a question
  stats                          what the model knows so far
"""
import argparse
import sys

from . import KNOWLEDGE


def main(argv=None):
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles: show °C and accents
    p = argparse.ArgumentParser(prog="python -m fashion", description="Train a menswear fashion model and build the fashion bible.")
    sub = p.add_subparsers(dest="cmd", required=True)

    pl = sub.add_parser("learn", help="learn from YouTube videos, articles or text files")
    pl.add_argument("sources", nargs="*", help="YouTube links, article links or .txt/.html files")
    pl.add_argument("--list", help=f"a file with one link per line (default list: {KNOWLEDGE / 'sources.txt'})", nargs="?", const=str(KNOWLEDGE / "sources.txt"))
    pl.add_argument("--force", action="store_true", help="read sources again even if already learnt")
    pl.add_argument("--key", help="Gemini API key (otherwise GEMINI_KEY or .env)")
    pl.add_argument("--model", default=None, help="Gemini model (default gemini-flash-latest)")
    pl.add_argument("--no-train", action="store_true", help="don't retrain after learning")

    sub.add_parser("train", help="train on all example outfits and write bible/fashion-bible.json")

    pc = sub.add_parser("check", help="score an outfit")
    pc.add_argument("outfit", help='e.g. "blazer navy, shirt white, chinos beige, loafers brown"')
    pc.add_argument("--occasion", choices=["casual", "smart", "work", "night", "event", "gym"])
    pc.add_argument("--temp", type=float, help="how warm it feels, in °C")
    pc.add_argument("--wet", action="store_true", help="rainy day")

    ps = sub.add_parser("search", help="find tips")
    ps.add_argument("query")
    ps.add_argument("-n", type=int, default=6)
    ps.add_argument("--occasion")

    sub.add_parser("stats", help="what the model knows so far")

    a = p.parse_args(argv)
    try:
        return COMMANDS[a.cmd](a)
    except (RuntimeError, ValueError, FileNotFoundError) as e:
        print(f"Error: {e}", file=sys.stderr)
        return 1


def cmd_learn(a):
    from .gemini import DEFAULT_MODEL
    from .learn import learn, read_list
    sources = list(a.sources) + (read_list(a.list) if a.list else [])
    if not sources:
        print("Give one or more links or files, or --list to use knowledge/sources.txt")
        return 1
    ok = failed = 0
    for i, src in enumerate(sources, 1):
        print(f"[{i}/{len(sources)}] {src}")
        try:
            learn(src, key=a.key, model=a.model or DEFAULT_MODEL, force=a.force)
            ok += 1
        except Exception as e:  # one bad link shouldn't stop the rest
            print(f"  couldn't learn from it: {e}")
            failed += 1
    print(f"Done: {ok} learnt" + (f", {failed} failed" if failed else ""))
    if ok and not a.no_train:
        print()
        cmd_train(a)
    return 0 if ok else 1


def cmd_train(a):
    from .bible import train
    train()
    return 0


def cmd_check(a):
    from .bible import judge
    from .outfit import Context, Outfit
    o = Outfit.parse(a.outfit)
    p, why = judge(o, Context(a.occasion, a.temp, a.wet))
    verdict = "great" if p >= 0.8 else "good" if p >= 0.6 else "so-so" if p >= 0.4 else "avoid"
    print(f"{o}\nScore: {p:.0%} ({verdict})")
    for title, score, points, note in why:
        if abs(points) < 0.05:
            continue
        sign = "+" if points > 0 else "-"
        print(f"  {sign} {title}{': ' + note if note and note.lower() != title.lower() else ''}  ({points:+.2f})")
    return 0


def cmd_search(a):
    from .knowledge import Search, merged_tips
    for t in Search(merged_tips())(a.query, k=a.n, occasion=a.occasion):
        src = f" [{t['support']} sources]" if t["support"] > 1 else ""
        print(f"- {t['text']}{src}\n    {t.get('why', '')}")
    return 0


def cmd_stats(a):
    from .bible import load_bible
    from .knowledge import load_examples, load_learned, load_rulebook, merged_tips
    rb, learned = load_rulebook(), load_learned()
    tips = merged_tips(rb, learned)
    print(f"Rulebook: {len(rb['rules'])} checked rules, {len(rb['tips'])} tips, {len(load_examples())} example outfits")
    print(f"Learnt: {len(learned)} sources, {sum(len(r.get('tips', [])) for r in learned)} tips, {sum(len(r.get('outfits', [])) for r in learned)} outfits")
    print(f"After merging repeats: {len(tips)} tips, {sum(t['support'] > 1 for t in tips)} confirmed by more than one source")
    tokens = sum(r.get("tokens", {}).get("in", 0) + r.get("tokens", {}).get("out", 0) for r in learned)
    if tokens:
        print(f"Gemini tokens spent learning: {tokens:,}")
    b = load_bible()
    if b:
        acc = b["model"]["accuracy"]["unseen"]
        print(f"Bible built {b['built_at'][:16].replace('T', ' ')}" + (f", accuracy on unseen outfits {acc:.0%}" if acc is not None else ""))
    else:
        print("No bible yet: run  python -m fashion train")
    return 0


COMMANDS = {"learn": cmd_learn, "train": cmd_train, "check": cmd_check, "search": cmd_search, "stats": cmd_stats}

if __name__ == "__main__":
    sys.exit(main())
