"""
Deployment-matching test: run the anomaly detection methods the way they would run in
the system, following config/anomaly_deployment_test.yaml (committed before it was run).

For each sub-county, week by week through the scored period:
  1. if 20 school days have passed since the last fit, refit on the sub-county's last
     125 school days, leaving out school-weeks an officer has marked follow-up;
  2. score the week's school-days with the current model;
  3. list the 3 school-weeks with the highest scores for the officer;
  4. the officer marks a listed school-week follow-up when it really contains a problem
     (from the injected labels, which nothing else here uses), so later fits leave it out.
Settings are those chosen in the main evaluation and stay fixed. No threshold is used.

Outputs
  data/reports/anomaly/deployment/anomaly_deployment_test.json
  data/reports/anomaly/deployment/anomaly_deployment_test.md

Precision is also reported by kind of week (the week holding the last day of the school
year, the week holding the first, and the rest), with each kind's best possible.

Usage
  python forecasting/scripts/run_anomaly_deployment_test.py
  # Only some methods, into another folder (for example a baseline under older features)
  python forecasting/scripts/run_anomaly_deployment_test.py --methods one_class_svm --report-dir <folder>
"""

import argparse
import copy
import json
import sys
import time
from pathlib import Path

FORECASTING_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(FORECASTING_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import yaml  # noqa: E402

from anomaly.features import build_features  # noqa: E402
from anomaly.methods import METHODS  # noqa: E402
from common import PROCESSED_DIR, REPORTS_DIR, md_table, write_json  # noqa: E402
from generate_feeding_dataset import OUT_DIR as MAIN_DATA, generate  # noqa: E402

PLAN = FORECASTING_DIR / "config" / "anomaly_deployment_test.yaml"
EVALUATION = REPORTS_DIR / "anomaly" / "anomaly_evaluation.json"
DATA_ROOT = PROCESSED_DIR / "feeding_deployment"
REPORT_DIR = REPORTS_DIR / "anomaly" / "deployment"
BASELINE = REPORT_DIR / "version_4_week_types" / "anomaly_deployment_test.json"
WEEK_TYPES = {"last day of school year": "school_year_end", "first day of school year": "school_year_start"}
LABELS = {"rules": "Fixed rules", "isolation_forest": "Isolation Forest", "extended_isolation_forest": "Extended Isolation Forest",
          "one_class_svm": "One-class SVM", "local_outlier_factor": "Local Outlier Factor"}


def load_dataset(data_dir):
    r = lambda n: pd.read_csv(data_dir / f"{n}.csv")  # noqa: E731
    feats = build_features(r("schools"), r("enrolment"), r("feeding"), r("stock_counts"), r("school_days"))
    labels = r("labels").assign(date=lambda d: pd.to_datetime(d.date))
    feats = feats.merge(labels, on=["school_id", "date"], how="left")
    feats["label"] = feats.label.fillna("")
    days = pd.to_datetime(r("school_days").date)
    feats["day_index"] = feats.date.map({d: i for i, d in enumerate(days)})
    feats["week"] = feats.date.dt.strftime("%G-%V")
    kinds = feats[feats.day_type.isin(WEEK_TYPES)].drop_duplicates("week").set_index("week").day_type.map(WEEK_TYPES)
    feats["week_type"] = feats.week.map(kinds).fillna("other")
    return feats


def run(feats, method, params, model_seed, plan):
    """Weekly lists for one method, deployed per sub-county. Returns the listed school-weeks."""
    dep = plan["deployment"]
    start, end = pd.Timestamp(dep["scored_period"]["start"]), pd.Timestamp(dep["scored_period"]["end"])
    k = dep["review_list"]["k"]
    listed, fit_seconds = [], []
    for sub_county, rows in feats.groupby("sub_county"):
        rows = rows.sort_values(["date", "school_id"])
        follow_up = set()                       # (school_id, week) marked follow-up
        model, next_refit = None, None
        for week, week_rows in rows[(rows.date >= start) & (rows.date <= end)].groupby("week", sort=True):
            first_day = int(week_rows.day_index.min())
            if method == "rules":
                scores = METHODS["rules"]().score(week_rows)
            else:
                if model is None or first_day >= next_refit:
                    history = rows[(rows.day_index < first_day) & (rows.day_index >= first_day - dep["window_school_days"])]
                    keep = [(s, w) not in follow_up for s, w in zip(history.school_id, history.week)]
                    history = history[keep]
                    if history.day_index.nunique() < dep["min_history_school_days"]:
                        scores = METHODS["rules"]().score(week_rows)
                        model = None
                    else:
                        kwargs = dict(params, random_state=model_seed)
                        began = time.perf_counter()
                        model = METHODS[method](**kwargs).fit(history)
                        fit_seconds.append(time.perf_counter() - began)
                        next_refit = first_day + dep["refit_every_school_days"]
                if model is not None:
                    scores = model.score(week_rows)
            weekly = (week_rows.assign(score=scores)
                      .groupby("school_id").agg(score=("score", "max"), labels=("label", lambda s: sorted(set(s) - {""})),
                                                week_type=("week_type", "first"))
                      .reset_index())
            top = weekly.sort_values("score", ascending=False).head(k)
            for row in top.itertuples():
                listed.append({"sub_county": sub_county, "week": week, "school_id": row.school_id,
                               "anomalous": bool(row.labels), "types": row.labels, "week_type": row.week_type})
                if row.labels and dep["exclude_follow_up_from_training"]:
                    follow_up.add((row.school_id, week))
    return pd.DataFrame(listed), (float(np.mean(fit_seconds)) if fit_seconds else 0.0)


def truth_weeks(feats, plan):
    dep = plan["deployment"]
    scored = feats[(feats.date >= pd.Timestamp(dep["scored_period"]["start"])) & (feats.date <= pd.Timestamp(dep["scored_period"]["end"]))]
    weeks = (scored.groupby(["sub_county", "week", "school_id"])
             .agg(label=("label", lambda s: sorted(set(s) - {""})), week_type=("week_type", "first")).reset_index())
    weeks["anomalous"] = weeks.label.map(bool)
    return weeks


def measure(listed, truth, k):
    per_week = truth.groupby(["sub_county", "week"]).anomalous.sum()
    ceiling = float(np.minimum(per_week, k).sum() / (k * len(per_week)))
    precision = float(listed.anomalous.mean())
    caught = listed[listed.anomalous].set_index(["sub_county", "week", "school_id"]).index
    anomalous = truth[truth.anomalous].set_index(["sub_county", "week", "school_id"])
    recall = float(anomalous.index.isin(caught).mean())
    by_type = {}
    for t in sorted({x for xs in truth.label for x in xs}):
        of_type = truth[truth.label.map(lambda xs, t=t: t in xs)].set_index(["sub_county", "week", "school_id"]).index
        by_type[t] = float(of_type.isin(caught).mean())
    by_week_type = {}
    for kind, of_kind in truth.groupby("week_type"):
        per_kind_week = of_kind.groupby(["sub_county", "week"]).anomalous.sum()
        kind_ceiling = float(np.minimum(per_kind_week, k).sum() / (k * len(per_kind_week)))
        kind_precision = float(listed[listed.week_type == kind].anomalous.mean())
        by_week_type[kind] = {"precision_at_k": kind_precision, "ceiling": kind_ceiling,
                              "share_of_ceiling": kind_precision / kind_ceiling if kind_ceiling else float("nan"),
                              "weeks": int(len(per_kind_week))}
    return {"precision_at_k": precision, "share_of_ceiling": precision / ceiling, "anomalous_weeks_listed": recall,
            "listed_by_type": by_type, "by_week_type": by_week_type, "ceiling": ceiling}


def week_type_table(df):
    """Mean precision, best possible and share of it, per method and kind of week."""
    rows = [{"method": r.method, "week_type": kind, **v} for r in df.itertuples() for kind, v in r.by_week_type.items()]
    return pd.DataFrame(rows).groupby(["method", "week_type"])[["precision_at_k", "ceiling", "share_of_ceiling"]].mean()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--methods", nargs="*", help="only these methods (default: the plan's)")
    parser.add_argument("--report-dir", type=Path, default=REPORT_DIR)
    args = parser.parse_args()
    report_dir = args.report_dir
    started = time.time()
    plan = yaml.safe_load(open(PLAN, encoding="utf-8"))
    if args.methods:
        plan["methods"] = args.methods
    evaluation = json.load(open(EVALUATION, encoding="utf-8"))
    params = {m: evaluation["results"][m]["params"] for m in plan["methods"] if m in evaluation["results"]}
    base = yaml.safe_load(open(FORECASTING_DIR.parent / plan["datasets"]["main"], encoding="utf-8"))
    datasets = {"main": MAIN_DATA}
    for seed in plan["datasets"]["seeds"]:
        out = DATA_ROOT / f"seed_{seed}"
        generate(dict(copy.deepcopy(base), seed=seed), out, quiet=True)
        datasets[f"seed_{seed}"] = out

    rows = []
    for dataset, data_dir in datasets.items():
        feats = load_dataset(data_dir)
        truth = truth_weeks(feats, plan)
        for method in plan["methods"]:
            seeds = [plan["model_seeds"][0]] if method == "rules" else plan["model_seeds"]
            for model_seed in seeds:
                listed, fit_s = run(feats, method, params.get(method, {}), model_seed, plan)
                m = measure(listed, truth, plan["deployment"]["review_list"]["k"])
                rows.append({"dataset": dataset, "method": method, "model_seed": model_seed, "fit_seconds": fit_s, **m})
            print(f"{dataset} {method} done ({time.time() - started:.0f}s)")
    df = pd.DataFrame(rows)

    summary = df.groupby("method").agg(
        precision_at_k=("precision_at_k", "mean"), precision_sd=("precision_at_k", "std"),
        share_of_ceiling=("share_of_ceiling", "mean"), anomalous_weeks_listed=("anomalous_weeks_listed", "mean"),
        fit_seconds=("fit_seconds", "mean")).sort_values("precision_at_k", ascending=False)
    by_type = pd.DataFrame([{**{"method": r.method}, **r.listed_by_type} for r in df.itertuples()]).groupby("method").mean()
    by_dataset = df.pivot_table(index="method", columns="dataset", values="precision_at_k", aggfunc="mean")
    by_week = week_type_table(df)
    best = summary.index[0]
    recommended = evaluation["recommended"]
    holds = summary.loc[recommended, "precision_at_k"] >= summary.loc[best, "precision_at_k"] - 0.01

    # The closing-week check (plan: week_type_check), for the recommended method
    week_check = None
    if recommended in by_week.index.get_level_values(0) and "school_year_end" in by_week.loc[recommended].index:
        mine = by_week.loc[recommended]
        gap = mine.loc["other", "share_of_ceiling"] - mine.loc["school_year_end", "share_of_ceiling"]
        baseline = None
        if BASELINE.exists() and report_dir.resolve() != BASELINE.parent.resolve():
            old = pd.DataFrame(json.load(open(BASELINE, encoding="utf-8"))["by_week_type"]).set_index(["method", "week_type"])
            if recommended in old.index.get_level_values(0):
                baseline = old.loc[recommended].share_of_ceiling.to_dict()
        week_check = {"method": recommended, "gap_points": round(float(gap) * 100, 1), "fixed": bool(gap <= 0.10),
                      "share_of_ceiling": mine.share_of_ceiling.round(4).to_dict(), "version_4": baseline}
    conclusion = (f"The evaluation's conclusion holds in deployment: {LABELS[recommended]} "
                  + ("has the highest mean precision@k." if best == recommended else
                     f"is within 1 point of the best ({LABELS[best]}).")
                  if holds else
                  f"Deployed, the methods rank differently from the evaluation: {LABELS[best]} does best, "
                  f"{(summary.loc[best, 'precision_at_k'] - summary.loc[recommended, 'precision_at_k']) * 100:.1f} points "
                  f"above {LABELS[recommended]}.")

    report_dir.mkdir(parents=True, exist_ok=True)
    write_json(report_dir / "anomaly_deployment_test.json", {
        "plan": str(PLAN.relative_to(FORECASTING_DIR.parent)), "settings": params,
        "summary": summary.round(4).reset_index().to_dict(orient="records"),
        "listed_by_type": by_type.round(4).reset_index().to_dict(orient="records"),
        "by_week_type": by_week.round(4).reset_index().to_dict(orient="records"),
        "week_type_check": week_check,
        "per_run": df.drop(columns=["listed_by_type", "by_week_type"]).round(4).to_dict(orient="records"),
        "evaluation_recommended": recommended, "deployed_best": best, "conclusion": conclusion,
        "runtime_seconds": round(time.time() - started),
    })
    pct = lambda v: f"{v * 100:.1f}%"  # noqa: E731
    dep = plan["deployment"]
    names = list(summary.index)
    types = list(by_type.columns)
    lines = [
        "# Anomaly detection: deployment-matching test",
        "",
        f"Plan: [`{PLAN.relative_to(FORECASTING_DIR.parent)}`](../../../../config/anomaly_deployment_test.yaml), committed before "
        f"it was run. Each sub-county is refitted every {dep['refit_every_school_days']} school days on its last "
        f"{dep['window_school_days']} school days, with the settings fixed from the main evaluation and no labels or threshold; "
        f"each week every officer gets the top {dep['review_list']['k']} school-weeks; school-weeks the officer marks follow-up "
        f"are left out of later fits. {len(datasets)} datasets × {len(plan['model_seeds'])} model seeds; scored "
        f"{dep['scored_period']['start']} to {dep['scored_period']['end']}.",
        "",
        f"**{conclusion}**",
        "",
        md_table([[LABELS[m], pct(r.precision_at_k), f"±{r.precision_sd * 100:.1f}" if not np.isnan(r.precision_sd) else "–",
                   pct(r.share_of_ceiling), pct(r.anomalous_weeks_listed), f"{r.fit_seconds:.2f}"]
                  for m, r in summary.iterrows()],
                 ["Method", f"Precision@{dep['review_list']['k']} (mean)", "Spread across runs (sd, points)",
                  "Share of best possible", "Problem school-weeks listed", "Seconds per refit"]),
        "",
        "## Problem school-weeks listed, by type",
        "",
        md_table([[LABELS[m]] + [pct(by_type.loc[m, t]) for t in types] for m in names], ["Method"] + types),
        "",
        "## Precision by kind of week",
        "",
        "Weeks holding the last day of the school year (closing day), the first day, and all others. The best possible "
        "differs by kind of week, so the share of it is the fair comparison.",
        "",
        md_table([[LABELS[m], kind, pct(r.precision_at_k), pct(r.ceiling), pct(r.share_of_ceiling)]
                  for (m, kind), r in by_week.iterrows()],
                 ["Method", "Kind of week", f"Precision@{dep['review_list']['k']}", "Best possible", "Share of best possible"]),
        "",
        *([f"**Closing-week check ({LABELS[week_check['method']]}):** share of the best possible "
           f"{week_check['gap_points']:.1f} points lower in school-year-end weeks than in other weeks - "
           + ("within the plan's 10 points, so the closing-week problem counts as fixed."
              if week_check["fixed"] else "more than the plan's 10 points, so the weakness remains.")
           + (f" Under version 4's features: {pct(week_check['version_4']['school_year_end'])} in school-year-end weeks "
              f"against {pct(week_check['version_4']['other'])} in other weeks." if week_check["version_4"] else ""),
           ""] if week_check else []),
        "## Precision by dataset",
        "",
        md_table([[LABELS[m]] + [pct(by_dataset.loc[m, d]) for d in by_dataset.columns] for m in names],
                 ["Method"] + list(by_dataset.columns)),
        "",
        "Synthetic data: the test shows the methods behave in deployment as in the evaluation, not how often they would be right "
        "at real schools.",
        "",
    ]
    (report_dir / "anomaly_deployment_test.md").write_text("\n".join(lines), encoding="utf-8")
    print(conclusion)
    print(f"Wrote {report_dir / 'anomaly_deployment_test.md'} ({time.time() - started:.0f}s)")


if __name__ == "__main__":
    main()
