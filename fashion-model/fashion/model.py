"""The trainable part: how much each rule matters.

An outfit is turned into one number per rule (that rule's check, -1 ... +1, or 0 when it
doesn't apply). The model is a logistic regression over those numbers:
    P(good outfit) = sigmoid(bias + sum(weight[rule] * check[rule]))
Training starts from the rulebook's weights and moves them to fit the example outfits.
The fewer the examples, the closer it stays to the rulebook (a pull towards those
starting weights), so a handful of odd examples can't wreck it. Weights never go below
zero: a rule can matter little, but breaking it never earns points.
"""
import math

from .outfit import Context, Outfit
from .rules import evaluate


def sigmoid(z):
    return 1 / (1 + math.exp(-max(-30, min(30, z))))


def features(rules, outfit, ctx):
    """{rule id: check score} for the rules that apply, plus their notes."""
    x, notes = {}, {}
    for r, score, note in evaluate(rules, outfit, ctx):
        x[r["id"]] = score
        if note:
            notes[r["id"]] = note
    return x, notes


def example_rows(rules, examples, weight=1.0):
    """Example outfits -> (features, 1 for good / 0 for avoid, sample weight). Skips ones that don't parse."""
    rows, skipped = [], []
    for e in examples:
        try:
            o = Outfit.parse(e["outfit"])
        except ValueError as err:
            skipped.append((e, str(err)))
            continue
        ctx = Context(e.get("occasion"), e.get("feels"), bool(e.get("wet")))
        x, _ = features(rules, o, ctx)
        rows.append((x, 1 if e["verdict"] == "good" else 0, e.get("weight", weight)))
    return rows, skipped


class Model:
    def __init__(self, weights, bias=0.0):
        self.w, self.bias = dict(weights), bias

    def logit(self, x):
        return self.bias + sum(self.w.get(k, 0) * v for k, v in x.items())

    def prob(self, x):
        return sigmoid(self.logit(x))

    @classmethod
    def train(cls, rows, prior, pull=1.0, lr=0.05, steps=3000, fixed=False):
        """Gradient descent on weighted log-loss + pull * sum((w - prior)^2).
        fixed=True keeps the rulebook's weights and fits only the bias (to compare against)."""
        w, bias = dict(prior), 0.0
        keys = list(prior)
        if not rows:
            return cls(w, bias)
        total = sum(sw for _, _, sw in rows)
        for _ in range(steps):
            g = dict.fromkeys(keys, 0.0)
            gb = 0.0
            for x, y, sw in rows:
                err = (sigmoid(bias + sum(w[k] * v for k, v in x.items() if k in w)) - y) * sw
                gb += err
                for k, v in x.items():
                    if k in g:
                        g[k] += err * v
            for k in ([] if fixed else keys):
                g[k] = (g[k] + 2 * pull * (w[k] - prior[k])) / total
                w[k] = max(0.0, w[k] - lr * 10 * g[k])
            bias -= lr * 10 * gb / total
        return cls({k: round(v, 3) for k, v in w.items()}, round(bias, 3))


def accuracy(model, rows):
    if not rows:
        return None
    return sum((model.prob(x) >= 0.5) == bool(y) for x, y, _ in rows) / len(rows)


def cross_validated(rows, prior, folds=None, **kw):
    """Accuracy on outfits the model didn't train on: leave-one-out for small sets, 5 folds above 60."""
    n = len(rows)
    if n < 4:
        return None
    folds = folds or (n if n <= 60 else 5)
    right = 0
    for f in range(folds):
        test = [r for i, r in enumerate(rows) if i % folds == f]
        train = [r for i, r in enumerate(rows) if i % folds != f]
        m = Model.train(train, prior, steps=600, **kw)
        right += sum((m.prob(x) >= 0.5) == bool(y) for x, y, _ in test)
    return right / n
