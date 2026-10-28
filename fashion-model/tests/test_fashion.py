"""Run with:  python -m unittest discover -s tests   (from the fashion-model folder)"""
import io
import json
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest import mock

from fashion import __main__ as cli
from fashion import APP_BIBLE, bible, knowledge, learn, parity, vocab
from fashion.knowledge import Search, merged_tips, similar
from fashion.model import Model, example_rows
from fashion.outfit import Context, Outfit, Piece
from fashion.rules import CHECKS, evaluate
from fashion.sources import article_text, youtube_id

RULES = knowledge.load_rulebook()["rules"]


def scores(outfit, **ctx):
    return {r["id"]: s for r, s, _ in evaluate(RULES, outfit, Context(**ctx))}


class Pieces(unittest.TestCase):
    def test_parse_words(self):
        p = Piece.parse("jacket navy slim smart +blazer +wool")
        self.assertEqual((p.category, p.colors, p.fit, p.styles), ("jacket", ["navy"], "slim", ["smart"]))
        self.assertEqual(p.tags, {"blazer", "wool"})

    def test_two_word_names(self):
        p = Piece.parse("shirt light blue smart casual")
        self.assertEqual(p.colors, ["light blue"])
        self.assertEqual(p.styles, ["smart casual"])

    def test_everyday_names(self):
        p = Piece.parse("loafers brown")
        self.assertEqual(p.category, "dress-shoes")
        self.assertIn("loafers", p.tags)

    def test_type_defaults(self):
        p = Piece.parse("hoodie grey")
        self.assertEqual(p.warmth, 3)
        self.assertEqual(p.styles, ["casual"])

    def test_no_type_is_an_error(self):
        with self.assertRaises(ValueError):
            Piece.parse("navy slim")

    def test_from_app_and_learner_dicts(self):
        a = Piece.from_dict({"category": "shirt", "colors": ["white"], "styles": ["smart"], "tags": ["oxford"], "warmth": 1})
        b = Piece.from_dict({"type": "blazer", "colour": "navy", "fit": "slim", "style": "smart"})
        self.assertEqual((a.category, a.colour), ("shirt", "white"))
        self.assertEqual((b.category, b.fit), ("jacket", "slim"))
        self.assertIn("blazer", b.tags)

    def test_multiword_tags_round_trip(self):
        p = Piece.from_dict({"type": "jacket", "colour": "olive", "tags": ["field jacket"]})
        self.assertEqual(str(p), "jacket olive smart casual +field-jacket")
        self.assertEqual(Piece.parse(str(p)).tags, {"field jacket"})

    def test_outfit_roles(self):
        o = Outfit.parse("tshirt white, overshirt olive, jeans navy, sneakers white, watch silver")
        self.assertEqual(o.hero.category, "overshirt")
        self.assertEqual(o.base.category, "tshirt")
        self.assertEqual([p.category for p in o.extras], ["watch"])


class Rules(unittest.TestCase):
    def test_every_rule_has_a_check(self):
        for r in RULES:
            self.assertIn(r["check"], CHECKS, r["id"])

    def test_one_accent_is_good_two_are_not(self):
        self.assertEqual(scores("tshirt red, jeans navy, sneakers white")["accent-colours"], 1.0)
        self.assertLess(scores("tshirt red, trousers green, sneakers white")["accent-colours"], 0)

    def test_light_blue_counts_as_neutral(self):
        self.assertEqual(scores("sweater burgundy, shirt light blue, trousers grey")["accent-colours"], 1.0)

    def test_tie_needs_shirt(self):
        self.assertEqual(scores("hoodie black, trousers grey, tie navy")["tie-rules"], -1.0)
        self.assertGreater(scores("shirt white, trousers grey, tie navy")["tie-rules"], 0)

    def test_belt_and_shoes(self):
        self.assertEqual(scores("shirt white, trousers grey, dress-shoes black, belt brown")["belt-shoes"], -1.0)
        self.assertEqual(scores("shirt white, trousers grey, dress-shoes brown, belt brown")["belt-shoes"], 1.0)

    def test_dress_shoes_with_joggers(self):
        self.assertEqual(scores("tshirt white, joggers grey, dress-shoes black")["shoe-formality"], -1.0)

    def test_suit_needs_same_cloth(self):
        self.assertIn("suit-rules", scores("jacket navy smart, shirt white, trousers navy smart, dress-shoes brown"))
        self.assertNotIn("suit-rules", scores("jacket brown smart +tweed, shirt white, trousers brown smart +corduroy"))

    def test_suit_with_tshirt_at_work(self):
        s = scores("jacket charcoal +suit, tshirt white, trousers charcoal +suit, sneakers white", occasion="work")
        self.assertLess(s["suit-rules"], 0)
        self.assertLess(s["shoe-formality"], 0)

    def test_weather(self):
        self.assertEqual(scores("tshirt white, shorts navy", feels=7)["shorts-weather"], -1.0)
        self.assertLess(scores("puffer black, hoodie grey, tshirt white, jeans navy", feels=26)["warmth"], 0)
        self.assertLess(scores("shirt white +linen, trousers beige +linen", feels=4)["fabric-season"], 0)

    def test_proportions(self):
        self.assertEqual(scores("hoodie grey oversized, jeans navy slim")["proportions"], 1.0)
        self.assertEqual(scores("hoodie grey oversized, jeans grey baggy", occasion="work")["proportions"], -1.0)

    def test_a_notch_overdressed_is_fine_underdressed_is_not(self):
        smart_weekend = scores("jacket olive smart casual +waxed, sweater navy smart casual, jeans navy, boots brown", occasion="casual")
        self.assertEqual(smart_weekend["occasion-formality"], 1.0)
        self.assertGreater(smart_weekend["occasion-styles"], 0)
        self.assertLess(scores("hoodie grey, joggers grey, sneakers white", occasion="work")["occasion-formality"], 0)
        self.assertLess(scores("jacket black formal +suit, shirt white formal, trousers black formal +suit, tie black", occasion="casual")["occasion-styles"], 0)

    def test_occasion_only_rules_skip_other_days(self):
        self.assertNotIn("gym-kit", scores("tshirt white, jeans navy", occasion="casual"))
        self.assertIn("gym-kit", scores("gym-top black, gym-shorts black", occasion="gym"))

    def test_rules_without_context_are_skipped(self):
        s = scores("tshirt white, jeans navy")
        for rid in ("warmth", "shorts-weather", "occasion-formality", "rain-ready"):
            self.assertNotIn(rid, s)


class Training(unittest.TestCase):
    def test_examples_all_parse(self):
        rows, skipped = example_rows(RULES, knowledge.load_examples())
        self.assertEqual(skipped, [])
        self.assertGreater(len(rows), 30)

    def test_learns_what_examples_care_about(self):
        prior = {"a": 1.0, "b": 1.0}
        # Outfits are good exactly when rule "a" is followed; rule "b" says nothing.
        rows = [({"a": 1, "b": 1}, 1, 1), ({"a": 1, "b": -1}, 1, 1), ({"a": -1, "b": 1}, 0, 1), ({"a": -1, "b": -1}, 0, 1)] * 5
        m = Model.train(rows, prior, pull=0.5)
        self.assertGreater(m.w["a"], 1.5)
        self.assertLess(m.w["b"], 1.1)

    def test_weights_never_negative(self):
        rows = [({"a": 1}, 0, 1), ({"a": -1}, 1, 1)] * 10
        self.assertEqual(Model.train(rows, {"a": 1.0}, pull=0.01).w["a"], 0.0)

    def test_fixed_keeps_rulebook_weights(self):
        rows = [({"a": 1}, 0, 1), ({"a": -1}, 1, 1)] * 10
        self.assertEqual(Model.train(rows, {"a": 1.0}, fixed=True).w["a"], 1.0)

    def test_no_examples_means_rulebook(self):
        self.assertEqual(Model.train([], {"a": 1.3}).w, {"a": 1.3})


class Knowledge(unittest.TestCase):
    def test_similar_tips(self):
        self.assertTrue(similar("Never fasten the bottom button of your jacket.", "Leave the bottom button of a jacket unfastened, never fasten it."))
        self.assertFalse(similar("Never fasten the bottom button of your jacket.", "Match your belt to your shoes."))

    def test_repeated_advice_is_merged_and_counted(self):
        learned = [{"source": {"title": "Video A", "url": "x"}, "tips": [
            {"id": "a-1", "text": "Fit matters more than brand or price: a cheap piece that fits beats an expensive one.", "topics": ["fit"], "strength": "rule"},
            {"id": "a-2", "text": "Roll your sleeves twice above the elbow for a relaxed look.", "topics": ["shirts"], "strength": "tip"},
        ]}]
        tips = merged_tips(learned=learned)
        fit = next(t for t in tips if t["id"] == "fit-first")
        self.assertEqual(fit["support"], 2)
        self.assertIn("Video A", fit["sources"])
        self.assertTrue(any(t["id"] == "a-2" for t in tips))

    def test_same_as_can_point_at_a_later_tip_and_chains(self):
        learned = [
            {"source": {"title": "Video A", "url": "a"}, "tips": [
                {"id": "a-1", "text": "Pair a grey flannel suit with a burgundy knitted tie.", "topics": ["suits"], "same_as": "b-1"}]},
            {"source": {"title": "Video B", "url": "b"}, "tips": [
                {"id": "b-1", "text": "Grey flannel and burgundy knit ties go together well.", "topics": ["colour"]},
                {"id": "b-2", "text": "Shoulders of a jacket should end where yours do.", "topics": ["fit"], "same_as": "c-1"}]},
            {"source": {"title": "Video C", "url": "c"}, "tips": [
                {"id": "c-1", "text": "The jacket's shoulder seam sits at the edge of your shoulder.", "topics": ["fit"], "same_as": "jacket-shoulders"}]},
        ]
        tips = {t["id"]: t for t in merged_tips(learned=learned)}
        self.assertNotIn("a-1", tips)
        self.assertEqual(tips["b-1"]["support"], 2)
        self.assertEqual(tips["b-1"]["topics"], ["colour", "suits"])
        self.assertNotIn("b-2", tips)
        self.assertNotIn("c-1", tips)
        self.assertEqual(tips["jacket-shoulders"]["support"], 3)

    def test_search(self):
        found = Search(merged_tips(learned=[]))("which jacket button should I leave open", k=3)
        self.assertEqual(found[0]["id"], "bottom-button")


class Sources(unittest.TestCase):
    def test_youtube_links(self):
        for link in ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ?t=3",
                     "https://www.youtube.com/shorts/dQw4w9WgXcQ", "https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ"):
            self.assertEqual(youtube_id(link), "dQw4w9WgXcQ", link)
        self.assertIsNone(youtube_id("https://www.vogue.com/article/x"))

    def test_article_text(self):
        html = """<html><head><meta property="og:title" content="How to wear a suit"><title>x</title></head>
        <body><nav><p>Menu menu menu menu menu menu menu menu</p></nav><article>
        <h1>How to wear a suit, the complete guide</h1><p>Always leave the bottom button of the jacket undone, it is cut that way.</p>
        <script>var x = "<p>not text</p>";</script></article><footer><p>Copyright footer text that should be skipped</p></footer></body></html>"""
        title, text = article_text(html)
        self.assertEqual(title, "How to wear a suit")
        self.assertIn("bottom button", text)
        self.assertNotIn("Menu", text)
        self.assertNotIn("Copyright", text)


FAKE_ANSWER = {
    "title": "5 suit rules",
    "tips": [
        {"text": "Leave the bottom button of a suit jacket undone.", "why": "It's cut to be worn open there.", "topics": ["suits"], "strength": "rule", "same_as": "bottom-button"},
        {"text": "Pick a navy suit as your first suit.", "why": "Most versatile.", "topics": ["suits", "nonsense-topic"], "occasions": ["work"], "strength": "tip"},
        {"text": "short", "why": "", "topics": [], "strength": "tip"},
        {"text": "Wear a hat to every meeting.", "why": "", "topics": ["accessories"], "strength": "opinion", "same_as": "made-up-id"},
    ],
    "outfits": [
        {"pieces": [{"type": "blazer", "colour": "navy", "style": "smart"}, {"type": "shirt", "colour": "white"},
                    {"type": "trousers", "colour": "grey", "fit": "slim"}, {"type": "dress-shoes", "colour": "brown"}],
         "occasion": "work", "verdict": "good", "why": "Classic."},
        {"pieces": [{"type": "sneakers", "colour": "white"}], "occasion": "work", "verdict": "good", "why": "No top or bottom."},
        {"pieces": [{"type": "spaceship", "colour": "red"}, {"type": "jeans", "colour": "navy"}], "occasion": "casual", "verdict": "avoid", "why": "Unknown type."},
    ],
}


class Learning(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        tmp = Path(self.tmp.name)
        self.patches = [mock.patch.object(learn, "LEARNED", tmp / "learned"), mock.patch.object(knowledge, "LEARNED", tmp / "learned"),
                        mock.patch.object(bible, "BIBLE", tmp / "bible"), mock.patch.object(bible, "APP_BIBLE", tmp / "app-bible.json")]
        for p in self.patches:
            p.start()
        self.source = tmp / "suit-guide.txt"
        self.source.write_text("A long transcript about suits...", encoding="utf-8")

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def test_learn_then_train(self):
        calls = []
        def fake(system, text, schema, **kw):
            calls.append(text)
            self.system = system
            return FAKE_ANSWER, {"in": 1000, "out": 200}
        with mock.patch.object(learn, "generate_json", fake):
            path = learn.learn(str(self.source), log=lambda *_: None)
            learn.learn(str(self.source), log=lambda *_: None)  # already learnt: no second call
        self.assertEqual(len(calls), 1)
        rec = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(len(rec["tips"]), 3)                      # the too-short tip is dropped
        self.assertEqual(rec["tips"][1]["topics"], ["suits"])      # unknown topics are dropped
        self.assertNotIn("same_as", rec["tips"][2])                # links to tips that don't exist are dropped
        self.assertIn("bottom-button: On a two-", self.system)          # Gemini sees the tips it can link to
        self.assertEqual(len(rec["outfits"]), 1)                   # only the complete, valid outfit is kept
        self.assertIn("jacket navy smart +blazer", rec["outfits"][0]["outfit"])

        b = bible.train(log=lambda *_: None)
        self.assertEqual(b["model"]["trained_on"]["learnt"], 1)
        self.assertEqual(len(b["sources"]), 1)
        button = next(t for t in b["tips"] if t["id"] == "bottom-button")
        self.assertEqual(button["support"], 2)                     # the rulebook tip, confirmed by the video
        self.assertLessEqual(len(b["prompt"]), bible.PROMPT_CHARS)
        self.assertTrue((Path(self.tmp.name) / "bible" / "fashion-bible.md").exists())


    def test_add_without_gemini(self):
        answer = Path(self.tmp.name) / "answer.json"
        answer.write_text(json.dumps(FAKE_ANSWER), encoding="utf-8")
        with redirect_stdout(io.StringIO()):
            self.assertEqual(cli.main(["add", str(answer), "--source", "https://youtu.be/dQw4w9WgXcQ", "--no-train"]), 0)
        rec = json.loads((Path(self.tmp.name) / "learned" / "yt-dQw4w9WgXcQ.json").read_text(encoding="utf-8"))
        self.assertEqual(rec["source"]["url"], "https://www.youtube.com/watch?v=dQw4w9WgXcQ")
        self.assertEqual(rec["model"], "by hand")
        self.assertEqual(len(rec["tips"]), 3)
        self.assertEqual(rec["tips"][0]["same_as"], "bottom-button")
        self.assertEqual(len(rec["outfits"]), 1)

    def test_instructions_list_known_tips(self):
        text = learn.instructions()
        self.assertIn("KNOWN TIPS:", text)
        self.assertIn("bottom-button:", text)
        self.assertIn("dress-shoes", text)

    def test_suit_halves_get_the_same_styles(self):
        piece = lambda t, c, st, tags: {"type": t, "colour": c, "style": st, "tags": tags}
        out = learn.clean_outfits([{"pieces": [
            piece("jacket", "navy", "smart", ["suit"]), piece("shirt", "white", "smart casual", []),
            piece("trousers", "navy", "smart casual", ["suit"])], "occasion": "work", "verdict": "good", "why": ""}])
        self.assertEqual(out[0]["outfit"], "jacket navy smart +suit, shirt white smart casual, trousers navy smart +suit")

    def test_known_tips_follow_the_source_once_there_are_many(self):
        transcript = "Knitwear care: never hang a wool sweater, fold it. Wash wool cold and dry it flat on a towel."
        ids = [t["id"] for t in learn.known_tips(limit=9, text=transcript)]
        self.assertEqual(len(ids), 9)
        self.assertIn("care-knits", ids)
        self.assertNotIn("care-knits", [t["id"] for t in learn.known_tips(limit=9)])


class ForTheApp(unittest.TestCase):
    """The app (stylist.js) reads a slim copy of the bible and runs its own copy of the checks."""

    def test_the_slim_copy_is_current(self):
        # Fails after training or editing the rulebook without running  python -m fashion export
        self.assertTrue(APP_BIBLE.exists(), "run  python -m fashion export")
        with tempfile.TemporaryDirectory() as d:
            fresh = bible.export_for_app(path=Path(d) / "b.json")
            self.assertEqual(json.loads(fresh.read_text(encoding="utf-8")), json.loads(APP_BIBLE.read_text(encoding="utf-8")),
                             "fashion-bible.json is out of date: run  python -m fashion export")

    def test_it_has_what_the_app_needs_and_nothing_else(self):
        slim = json.loads(APP_BIBLE.read_text(encoding="utf-8"))
        self.assertEqual(set(slim), {"name", "version", "built_at", "model", "rules", "tips", "vocab"})
        self.assertTrue(all("rank" in t for t in slim["tips"]))
        self.assertTrue(all({"id", "check", "params", "weight"} <= set(r) for r in slim["rules"]))
        self.assertEqual(set(slim["vocab"]["cats"]), set(vocab.CATS))
        self.assertEqual(slim["vocab"]["occasions"]["work"][0], "Work / meeting")

    def test_parity_cases_are_current(self):
        # The cases tools/stylist.test.mjs checks stylist.js against; regenerate with  python -m fashion parity
        self.assertEqual(parity.build(), json.loads(parity.PATH.read_text(encoding="utf-8")),
                         "tests/parity.json is out of date: run  python -m fashion parity")

    def test_warmth_follows_the_wearers_offset(self):
        o = Outfit.parse("tshirt white, hoodie grey, jeans denim")
        plain = scores_of(o, Context(feels=12))["warmth"]
        lighter = scores_of(o, Context(feels=12, offset=-2))["warmth"]
        self.assertGreater(lighter, plain)

    def test_gym_kit_clashes_with_smart_but_sporty_streetwear_does_not(self):
        kit = Outfit.parse("jacket navy smart +blazer, overshirt black sporty, shirt white smart, trousers navy smart, sneakers white")
        self.assertEqual(scores_of(kit, Context(occasion="smart"))["style-clash"], -1.0)
        street = Outfit.parse("hoodie black sporty streetwear, tshirt white smart, jeans black, sneakers black sporty streetwear")
        self.assertNotIn("style-clash", scores_of(street, Context(occasion="casual")))

    def test_sporty_sneakers_are_too_casual_under_dressy_clothes(self):
        dressy = Outfit.parse("jacket black minimal, shirt white formal, trousers navy slim formal, sneakers black streetwear sporty")
        self.assertEqual(scores_of(dressy, Context(occasion="work"))["shoe-formality"], -1.0)
        clean = Outfit.parse("jacket black minimal, shirt white formal, trousers navy slim formal, sneakers white minimal +leather")
        self.assertGreaterEqual(scores_of(clean, Context(occasion="work"))["shoe-formality"], 0)
        blazer_tee = Outfit.parse("jacket navy formal +blazer, tshirt white, jeans black, sneakers red streetwear sporty")
        self.assertEqual(scores_of(blazer_tee, Context(occasion="casual"))["shoe-formality"], 0)

    def test_roomy_on_roomy_is_fine_under_30(self):
        o = Outfit.parse("tshirt black oversized, jeans black baggy, sneakers white")
        self.assertEqual(scores_of(o, Context(occasion="casual"))["proportions"], -1.0)
        self.assertEqual(scores_of(o, Context(occasion="casual", age=45))["proportions"], -1.0)
        self.assertGreater(scores_of(o, Context(occasion="casual", age=20))["proportions"], 0)
        self.assertEqual(scores_of(o, Context(occasion="smart", age=20))["proportions"], 0)
        self.assertEqual(scores_of(o, Context(occasion="work", age=20))["proportions"], -1.0)

    def test_export_command(self):
        with tempfile.TemporaryDirectory() as d, mock.patch.object(bible, "APP_BIBLE", Path(d) / "b.json"):
            code, out = CommandLine.run_cli(None, "export")
            self.assertEqual(code, 0)
            self.assertTrue((Path(d) / "b.json").exists())


def scores_of(outfit, ctx):
    return {r["id"]: s for r, s, _ in evaluate(RULES, outfit, ctx)}


class CommandLine(unittest.TestCase):
    def run_cli(self, *args):
        out = io.StringIO()
        with redirect_stdout(out):
            code = cli.main(list(args))
        return code, out.getvalue()

    def test_check(self):
        code, out = self.run_cli("check", "hoodie black, shirt white, trousers grey, dress-shoes black, tie navy", "--occasion", "work")
        self.assertEqual(code, 0)
        self.assertIn("Tie under a hoodie", out)

    def test_search(self):
        code, out = self.run_cli("search", "belt and shoes colour")
        self.assertEqual(code, 0)
        self.assertIn("belt", out.lower())

    def test_bad_outfit(self):
        with redirect_stdout(io.StringIO()), mock.patch("sys.stderr", io.StringIO()) as err:
            self.assertEqual(cli.main(["check", "navy slim"]), 1)
        self.assertIn("No garment type", err.getvalue())


if __name__ == "__main__":
    unittest.main()
