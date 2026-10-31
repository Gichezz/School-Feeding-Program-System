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

Usage
  python forecasting/scripts/run_anomaly_deployment_test.py
"""

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
                      .groupby("school_id").agg(score=("score", "max"), labels=("label", lambda s: sorted(set(s) - {""})))
                      .reset_index())
            top = weekly.sort_values("score", ascending=False).head(k)
            for row in top.itertuples():
                listed.append({"sub_county": sub_county, "week": week, "school_id": row.school_id,
                               "anomalous": bool(row.labels), "types": row.labels})
                if row.labels and dep["exclude_follow_up_from_training"]:
                    follow_up.add((row.school_id, week))
    return pd.DataFrame(listed), (float(np.mean(fit_seconds)) if fit_seconds else 0.0)


def truth_weeks(feats, plan):
    dep = plan["deployment"]
    scored = feats[(feats.date >= pd.Timestamp(dep["scored_period"]["start"])) & (feats.date <= pd.Timestamp(dep["scored_period"]["end"]))]
    weeks = scored.groupby(["sub_county", "week", "school_id"]).label.agg(lambda s: sorted(set(s) - {""})).reset_index()
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
    return {"precision_at_k": precision, "share_of_ceiling": precision / ceiling, "anomalous_weeks_listed": recall,
            "listed_by_type": by_type, "ceiling": ceiling}


def main():
    started = time.time()
    plan = yaml.safe_load(open(PLAN, encoding="utf-8"))
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
    best = summary.index[0]
    recommended = evaluation["recommended"]
    holds = summary.loc[recommended, "precision_at_k"] >= summary.loc[best, "precision_at_k"] - 0.01
    conclusion = (f"The evaluation's conclusion holds in deployment: {LABELS[recommended]} "
                  + ("has the highest mean precision@k." if best == recommended else
                     f"is within 1 point of the best ({LABELS[best]}).")
                  if holds else
                  f"Deployed, the methods rank differently from the evaluation: {LABELS[best]} does best, "
                  f"{(summary.loc[best, 'precision_at_k'] - summary.loc[recommended, 'precision_at_k']) * 100:.1f} points "
                  f"above {LABELS[recommended]}.")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(REPORT_DIR / "anomaly_deployment_test.json", {
        "plan": str(PLAN.relative_to(FORECASTING_DIR.parent)), "settings": params,
        "summary": summary.round(4).reset_index().to_dict(orient="records"),
        "listed_by_type": by_type.round(4).reset_index().to_dict(orient="records"),
        "per_run": df.drop(columns="listed_by_type").round(4).to_dict(orient="records"),
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
        "## Precision by dataset",
        "",
        md_table([[LABELS[m]] + [pct(by_dataset.loc[m, d]) for d in by_dataset.columns] for m in names],
                 ["Method"] + list(by_dataset.columns)),
        "",
        "Synthetic data: the test shows the methods behave in deployment as in the evaluation, not how often they would be right "
        "at real schools.",
        "",
    ]
    (REPORT_DIR / "anomaly_deployment_test.md").write_text("\n".join(lines), encoding="utf-8")
    print(conclusion)
    print(f"Wrote {REPORT_DIR / 'anomaly_deployment_test.md'} ({time.time() - started:.0f}s)")


if __name__ == "__main__":
    main()
