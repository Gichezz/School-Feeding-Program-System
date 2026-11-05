"""
Faithfulness of the weekly list's reasons, following config/explanation_faithfulness.yaml
(written before it was run).

The deployed method runs as in the deployment-matching test: Extended Isolation Forest
with the service's settings, per sub-county, refitted every 20 school days on the last
125, the top 3 school-weeks a week, follow-up weeks left out of later fits. For every
listed school-week, on its highest-scoring day:

  1. deletion: the score's drop when the two named features are reset together to the
     sub-county's median, against every pair of the 15 features;
  2. agreement: whether a reason is a figure the injected problem changes;
  3. stability: whether a second model seed gives the same reasons.

Outputs
  data/reports/anomaly/explanations/explanation_faithfulness.json
  data/reports/anomaly/explanations/explanation_faithfulness.md

Usage
  python forecasting/scripts/check_explanation_faithfulness.py
"""

import itertools
import sys
import time
from math import comb
from pathlib import Path

FORECASTING_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(FORECASTING_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import yaml  # noqa: E402

from anomaly.methods import FEATURE_NAMES, METHODS, ExtendedIsolationForestMethod  # noqa: E402
from common import REPORTS_DIR, md_table, write_json  # noqa: E402
from run_anomaly_deployment_test import PLAN as DEPLOYMENT_PLAN, load_dataset  # noqa: E402
from services.scoring_service import METHOD, SETTINGS  # noqa: E402

PLAN = FORECASTING_DIR / "config" / "explanation_faithfulness.yaml"
REPORT_DIR = REPORTS_DIR / "anomaly" / "explanations"
PAIRS = list(itertools.combinations(range(len(FEATURE_NAMES)), 2))
SHARE_OF_BEST, BEATS_MEDIAN, MIN_LISTINGS = 0.80, 0.90, 20   # plan: deletion.pass, agreement.pass


def named_pair(contributions):
    """The two reasons the list shows: the features whose own reset lowers the score most."""
    top = [f for f, _ in sorted(contributions.items(), key=lambda kv: -kv[1])][:2]
    return tuple(top)


def explain_listing(model, row):
    """Reasons, and the drop for the named pair and for every pair, on one school-day."""
    named = named_pair(model.contributions(row))
    x = model._x(pd.DataFrame([row]))
    base = model._score(x)[0]
    variants = np.repeat(x, len(PAIRS), axis=0)
    for k, (i, j) in enumerate(PAIRS):
        variants[k, [i, j]] = 0.0     # robust-scaled, so 0 is the training median
    drops = base - model._score(variants)
    out = {"named": named, "score": float(base)}
    if len(named) == 2:
        pair = tuple(sorted(FEATURE_NAMES.index(f) for f in named))
        own = float(drops[PAIRS.index(pair)])
        out.update(named_drop=own, best_drop=float(drops.max()), median_drop=float(np.median(drops)),
                   percentile=float((drops <= own).mean() * 100))
    return out


def run(feats, model_seed, dep):
    """Weekly lists for the deployed method, with each listing's reasons and deletion check."""
    start, end = pd.Timestamp(dep["scored_period"]["start"]), pd.Timestamp(dep["scored_period"]["end"])
    k = dep["review_list"]["k"]
    rows_out = []
    for sub_county, rows in feats.groupby("sub_county"):
        rows = rows.sort_values(["date", "school_id"])
        follow_up, model, next_refit = set(), None, None
        for week, week_rows in rows[(rows.date >= start) & (rows.date <= end)].groupby("week", sort=True):
            first_day = int(week_rows.day_index.min())
            if model is None or first_day >= next_refit:
                history = rows[(rows.day_index < first_day) & (rows.day_index >= first_day - dep["window_school_days"])]
                history = history[[(s, w) not in follow_up for s, w in zip(history.school_id, history.week)]]
                if history.day_index.nunique() < dep["min_history_school_days"]:
                    model = None
                    continue      # the rules alone: no model reasons to check
                model = ExtendedIsolationForestMethod(**SETTINGS, random_state=model_seed).fit(history)
                next_refit = first_day + dep["refit_every_school_days"]
            scored = week_rows.assign(score=model.score(week_rows))
            top_days = scored.loc[scored.groupby("school_id").score.idxmax()].sort_values("score", ascending=False).head(k)
            for _, top in top_days.iterrows():
                types = sorted(set(week_rows[week_rows.school_id == top.school_id].label) - {""})
                rows_out.append({"sub_county": sub_county, "week": week, "school_id": top.school_id, "types": types,
                                 **explain_listing(model, top)})
                if types and dep["exclude_follow_up_from_training"]:
                    follow_up.add((top.school_id, week))
    return pd.DataFrame(rows_out)


def chance(m, n=len(FEATURE_NAMES)):
    """Two of n features drawn at random, at least one among m."""
    return 1 - comb(n - m, 2) / comb(n, 2)


def main():
    started = time.time()
    plan = yaml.safe_load(open(PLAN, encoding="utf-8"))
    dep = yaml.safe_load(open(DEPLOYMENT_PLAN, encoding="utf-8"))["deployment"]
    assert METHOD == "extended_isolation_forest" and METHOD in METHODS
    root = FORECASTING_DIR.parent
    datasets = {"main": root / plan["datasets"]["main"]}
    datasets.update({Path(p).name: root / p for p in plan["datasets"]["others"]})

    frames, loaded = [], {}
    for name, path in datasets.items():
        loaded[name] = load_dataset(path)
        for seed in plan["model_seeds"]:
            frames.append(run(loaded[name], seed, dep).assign(dataset=name, model_seed=seed))
        print(f"{name} done ({time.time() - started:.0f}s)")
    listings = pd.concat(frames, ignore_index=True)

    # 1. Deletion
    checked = listings.dropna(subset=["named_drop"])
    share_of_best = float((checked.named_drop / checked.best_drop.where(checked.best_drop > 0)).fillna(1.0).mean())
    beats_median = float((checked.named_drop > checked.median_drop).mean())
    percentile = float(checked.percentile.mean())
    faithful = share_of_best >= SHARE_OF_BEST and beats_median >= BEATS_MEDIAN
    with_problem = checked[checked.types.map(bool)]
    ordinary = checked[~checked.types.map(bool)]
    by_kind = {kind: {"listings": int(len(part)), "share_of_best_pair": float((part.named_drop / part.best_drop.where(part.best_drop > 0)).fillna(1.0).mean()),
                      "beats_median_pair": float((part.named_drop > part.median_drop).mean())}
               for kind, part in (("with a problem", with_problem), ("ordinary", ordinary)) if len(part)}

    # 2. Agreement
    mapping = plan["agreement"]["features_by_type"]
    single = listings[listings.types.map(len) == 1].assign(type=lambda d: d.types.map(lambda t: t[0]))
    agreement = {}
    for t, features in mapping.items():
        part = single[single.type == t]
        hit = part.named.map(lambda named, fs=set(features): bool(fs & set(named)))
        rate = float(hit.mean()) if len(part) else float("nan")
        agreement[t] = {"listings": int(len(part)), "agreement": rate, "chance": chance(len(features)),
                        "judged": bool(len(part) >= MIN_LISTINGS),
                        "better_than_chance": bool(len(part) >= MIN_LISTINGS and rate > chance(len(features)))}
    named_counts = pd.Series([f for pair in single.named for f in pair]).value_counts()

    # 3. Stability on the main dataset
    second = run(loaded["main"], plan["stability_seed"], dep)
    key = ["sub_county", "week", "school_id"]
    first = listings[(listings.dataset == "main") & (listings.model_seed == plan["model_seeds"][0])]
    both = first.merge(second, on=key, suffixes=("_a", "_b"))
    same = float((both.named_a.map(set) == both.named_b.map(set)).mean())
    overlap = float(pd.Series([bool(set(a) & set(b)) for a, b in zip(both.named_a, both.named_b)]).mean())
    listed_both = float(len(both) / len(first))

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    result = {
        "plan": str(PLAN.relative_to(root)), "method": METHOD, "settings": SETTINGS,
        "datasets": list(datasets), "listings": int(len(listings)), "deletion_checked": int(len(checked)),
        "deletion": {"share_of_best_pair": share_of_best, "beats_median_pair": beats_median, "pair_percentile": percentile,
                     "faithful": faithful, "by_kind": by_kind},
        "agreement": agreement,
        "reasons_named_on_single_type_listings": named_counts.to_dict(),
        "stability": {"listed_under_both_seeds": listed_both, "same_two_reasons": same, "at_least_one_in_common": overlap,
                      "compared": int(len(both))},
        "runtime_seconds": round(time.time() - started),
    }
    write_json(REPORT_DIR / "explanation_faithfulness.json", result)

    pct = lambda v: f"{v * 100:.1f}%"  # noqa: E731
    judged = {t: a for t, a in agreement.items() if a["judged"]}
    lines = [
        "# Faithfulness of the weekly list's reasons",
        "",
        f"Plan: [`{PLAN.relative_to(root).as_posix()}`](../../../../config/explanation_faithfulness.yaml), written before it was run. "
        f"Extended Isolation Forest deployed as in the deployment-matching test ({', '.join(datasets)}; "
        f"{len(listings)} listed school-weeks). Each listing's two reasons are the features whose own reset to the "
        "sub-county's median lowers the score most.",
        "",
        "## 1. Do the reasons name what the model reacted to?",
        "",
        "On each listing's highest-scoring day, the two named features are reset together, and so is every other pair of "
        f"the 15 features ({len(PAIRS)} pairs).",
        "",
        md_table([["Named pair's drop, as a share of the best pair's (mean)", pct(share_of_best), f"≥ {SHARE_OF_BEST:.0%}"],
                  ["Listings where the named pair drops more than the median pair", pct(beats_median), f"≥ {BEATS_MEDIAN:.0%}"],
                  ["Where the named pair falls among all pairs (mean percentile)", f"{percentile:.1f}", "–"]],
                 ["Measure", "Result", "Plan's bar"]),
        "",
        md_table([[kind, str(v["listings"]), pct(v["share_of_best_pair"]), pct(v["beats_median_pair"])] for kind, v in by_kind.items()],
                 ["Listings", "Count", "Share of best pair", "Beats the median pair"]),
        "",
        f"**{'The reasons are faithful by the plan' if faithful else 'The reasons fall short of the plan'}'s rule.**",
        "",
        "## 2. Do the reasons point at the problem that was there?",
        "",
        "Listings holding one injected problem type: the share where at least one reason is a figure that type changes "
        "(fixed in the plan), against two features drawn at random.",
        "",
        md_table([[t, str(a["listings"]), pct(a["agreement"]) if a["listings"] else "–", pct(a["chance"]),
                   ("yes" if a["better_than_chance"] else "no") if a["judged"] else "too few to judge"]
                  for t, a in agreement.items()],
                 ["Problem type", "Listings", "A reason matches", "Chance", "Better than chance"]),
        "",
        f"Better than chance for {sum(a['better_than_chance'] for a in judged.values())} of the {len(judged)} types with at least "
        f"{MIN_LISTINGS} listings.",
        "",
        "## 3. Does a second model seed give the same reasons?",
        "",
        f"On the main dataset, {pct(listed_both)} of school-weeks listed under seed {plan['model_seeds'][0]} are listed under seed "
        f"{plan['stability_seed']} too. Of those ({len(both)}), {pct(same)} get the same two reasons and {pct(overlap)} share at "
        "least one. Reported, not judged.",
        "",
        "Synthetic data: this shows the reasons describe the model and the injected problems; whether officers find them "
        "useful needs real use.",
        "",
    ]
    (REPORT_DIR / "explanation_faithfulness.md").write_text("\n".join(lines), encoding="utf-8")
    print(f"Wrote {REPORT_DIR / 'explanation_faithfulness.md'} ({time.time() - started:.0f}s)")


if __name__ == "__main__":
    main()
