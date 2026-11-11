"""
Deployment-matching test: run the anomaly detection methods the way they would run in
the system, following config/anomaly_deployment_test.yaml (committed before it was run).

For each sub-county, week by week through the scored period:
  1. if 20 school days have passed since the last fit, refit on the sub-county's last
     125 school days, leaving out school-weeks an officer has marked follow-up;
  2. score the week's school-days with the current model; each school's week takes its
     highest-scoring day;
  3. list up to 3 school-weeks: the highest-scoring, and (version 7) only those whose
     score is above the review threshold, the q-quantile of the school-week scores in the
     model's own training window. q = none lists the top 3 every week;
  4. the officer marks a listed school-week follow-up when it really contains a problem
     (from the injected labels, which nothing else here uses), so later fits leave it out.
Settings are those chosen in the main evaluation and stay fixed. Because what is listed
feeds back into later fits, every threshold is its own run.

Version 7 reports, for the selection year (2025) and the test year (2026) separately:
Precision@3, Recall@3, F1@3, empty officer-weeks, listings per officer-week and false
listings per officer-term; q is chosen per method on the selection year by F1@3. For the
recommended method it also reports fairness by school size, programme type, sub-county and
connectivity, and a connectivity check against version 6's sync-based timing features.

Outputs
  data/reports/anomaly/deployment/anomaly_deployment_test.json
  data/reports/anomaly/deployment/anomaly_deployment_test.md

Usage
  python forecasting/scripts/run_anomaly_deployment_test.py
  python forecasting/scripts/run_anomaly_deployment_test.py --methods extended_isolation_forest --workers 6
"""

import argparse
import copy
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor
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
WEEK_TYPES = {"last day of school year": "school_year_end", "first day of school year": "school_year_start"}
LABELS = {"rules": "Fixed rules", "isolation_forest": "Isolation Forest", "extended_isolation_forest": "Extended Isolation Forest",
          "one_class_svm": "One-class SVM", "local_outlier_factor": "Local Outlier Factor",
          "sgd_one_class_svm": "SGD one-class SVM"}
WEEKS_PER_TERM = 13
_CACHE = {}


def load_dataset(data_dir, timing="capture"):
    r = lambda n: pd.read_csv(data_dir / f"{n}.csv")  # noqa: E731
    feats = build_features(r("schools"), r("enrolment"), r("feeding"), r("stock_counts"), r("school_days"), timing=timing)
    labels = r("labels").assign(date=lambda d: pd.to_datetime(d.date))
    feats = feats.merge(labels, on=["school_id", "date"], how="left")
    feats["label"] = feats.label.fillna("")
    days = pd.to_datetime(r("school_days").date)
    feats["day_index"] = feats.date.map({d: i for i, d in enumerate(days)})
    feats["week"] = feats.date.dt.strftime("%G-%V")
    kinds = feats[feats.day_type.isin(WEEK_TYPES)].drop_duplicates("week").set_index("week").day_type.map(WEEK_TYPES)
    feats["week_type"] = feats.week.map(kinds).fillna("other")
    schools = r("schools").set_index("school_id")
    size = r("enrolment").groupby("school_id").learners.mean()
    feats["size_group"] = feats.school_id.map(pd.qcut(size, 3, labels=["small schools", "medium schools", "large schools"]).astype(str))
    feats["programme_group"] = feats.school_id.map(schools.programme_type.map({"in_kind": "food delivered", "cash_transfer": "cash transfer"}))
    feats["sync_group"] = feats.school_id.map(schools.sync_every.map(lambda n: "syncs every 1-2 days" if n <= 2 else "syncs every 3-5 days"))
    # A school-day inside a connectivity outage (the device could not sync that day)
    feats["in_outage"] = False
    path = data_dir / "outages.csv"
    if path.exists():
        for o in pd.read_csv(path, parse_dates=["start", "end"]).itertuples():
            feats.loc[(feats.school_id == o.school_id) & feats.date.between(o.start, o.end), "in_outage"] = True
    return feats


def _dataset(data_dir, timing):
    key = (str(data_dir), timing)
    if key not in _CACHE:
        _CACHE[key] = load_dataset(Path(data_dir), timing)
    return _CACHE[key]


def run(task):
    """One method, one model seed, one dataset, one threshold: every scored school-week
    with its score, whether it was listed, and what it really contained."""
    data_dir, timing, method, params, model_seed, q, dep = task
    feats = _dataset(data_dir, timing)
    start, end = pd.Timestamp(dep["scored_period"]["start"]), pd.Timestamp(dep["scored_period"]["end"])
    k = dep["review_list"]["k"]
    rows_out = []
    for sub_county, rows in feats.groupby("sub_county"):
        rows = rows.sort_values(["date", "school_id"])
        follow_up = set()
        model, next_refit, threshold = None, None, None
        for week, week_rows in rows[(rows.date >= start) & (rows.date <= end)].groupby("week", sort=True):
            first_day = int(week_rows.day_index.min())
            rules_only = method == "rules"
            if not rules_only and (model is None or first_day >= next_refit):
                history = rows[(rows.day_index < first_day) & (rows.day_index >= first_day - dep["window_school_days"])]
                history = history[[(s, w) not in follow_up for s, w in zip(history.school_id, history.week)]]
                if history.day_index.nunique() < dep["min_history_school_days"]:
                    model = None
                else:
                    model = METHODS[method](**dict(params, random_state=model_seed)).fit(history)
                    next_refit = first_day + dep["refit_every_school_days"]
                    weekly_hist = history.assign(score=model.score(history)).groupby(["school_id", "week"]).score.max()
                    threshold = -np.inf if q == "none" else float(weekly_hist.quantile(float(q)))
            if rules_only or model is None:
                # Ranked by the fixed checks: only a school that broke one is listed
                scores, cut = METHODS["rules"]().score(week_rows), 0.0
            else:
                scores, cut = model.score(week_rows), threshold
            weekly = (week_rows.assign(score=scores)
                      .groupby("school_id").agg(score=("score", "max"), labels=("label", lambda s: sorted(set(s) - {""})),
                                                week_type=("week_type", "first"), in_outage=("in_outage", "max"),
                                                size_group=("size_group", "first"), programme_group=("programme_group", "first"),
                                                sync_group=("sync_group", "first"))
                      .reset_index().sort_values("score", ascending=False))
            weekly["listed"] = False
            eligible = weekly[weekly.score > cut].head(k).index
            weekly.loc[eligible, "listed"] = True
            for row in weekly.itertuples():
                rows_out.append({"sub_county": sub_county, "week": week, "school_id": row.school_id, "listed": bool(row.listed),
                                 "anomalous": bool(row.labels), "types": row.labels, "week_type": row.week_type,
                                 "in_outage": bool(row.in_outage), "size_group": row.size_group,
                                 "programme_group": row.programme_group, "sync_group": row.sync_group})
                if row.listed and row.labels and dep["exclude_follow_up_from_training"]:
                    follow_up.add((row.school_id, week))
    return pd.DataFrame(rows_out)


def week_date(week):
    return pd.Timestamp.fromisocalendar(int(week[:4]), int(week[5:]), 1)


def measure(weeks, k):
    """Precision@k, Recall@k, F1@k and workload for a table of scored school-weeks."""
    listed = weeks[weeks.listed]
    officer_weeks = weeks.groupby(["sub_county", "week"]).listed.sum()
    precision = float(listed.anomalous.mean()) if len(listed) else float("nan")
    problems = weeks[weeks.anomalous]
    recall = float(problems.listed.mean()) if len(problems) else float("nan")
    f1 = 2 * precision * recall / (precision + recall) if precision and recall and precision + recall > 0 else 0.0
    by_type = {}
    for t in sorted({x for xs in weeks.types for x in xs}):
        of_type = weeks[weeks.types.map(lambda xs, t=t: t in xs)]
        by_type[t] = float(of_type.listed.mean())
    per_week = weeks.groupby(["sub_county", "week"]).anomalous.sum()
    ceiling = float(np.minimum(per_week, k).sum() / (k * len(per_week)))
    return {
        "precision_at_k": precision, "recall_at_k": recall, "f1_at_k": f1,
        "empty_weeks_share": float((officer_weeks == 0).mean()),
        "listings_per_officer_week": float(officer_weeks.mean()),
        "false_listings_per_officer_term": float((~listed.anomalous).sum() / len(officer_weeks) * WEEKS_PER_TERM),
        "listed_by_type": by_type, "precision_ceiling_top_k": ceiling,
    }


def split(weeks, periods):
    dates = weeks.week.map(week_date)
    out = {}
    for name, p in periods.items():
        out[name] = weeks[(dates >= pd.Timestamp(p["start"])) & (dates <= pd.Timestamp(p["end"]))]
    return out


def fairness(weeks, ratio_limit):
    """False listing and detection rates by group, against the overall rates."""
    ordinary, problems = weeks[~weeks.anomalous], weeks[weeks.anomalous]
    overall_false = float(ordinary.listed.mean())
    groups = {}
    for column, label in (("size_group", None), ("programme_group", None), ("sub_county", None),
                          ("sync_group", None), ("in_outage", {True: "week with an outage", False: "week without"})):
        for value in weeks[column].dropna().unique():
            name = label[value] if label else value
            o, p = ordinary[ordinary[column] == value], problems[problems[column] == value]
            false_rate = float(o.listed.mean()) if len(o) else float("nan")
            groups[str(name)] = {
                "by": column, "ordinary_weeks": int(len(o)), "problem_weeks": int(len(p)),
                "false_listing_rate": false_rate, "detection_rate": float(p.listed.mean()) if len(p) else float("nan"),
                "false_listing_ratio": false_rate / overall_false if overall_false else float("nan"),
            }
    over = [g for g, v in groups.items() if v["false_listing_ratio"] > ratio_limit]
    return {"overall_false_listing_rate": overall_false, "overall_detection_rate": float(problems.listed.mean()),
            "groups": groups, "over_listed": over}


def write_report(out, plan, report_dir):
    """The Markdown report, from the saved results (so it can be rebuilt with --report-only)."""
    dep, k = plan["deployment"], plan["deployment"]["review_list"]["k"]
    pct = lambda v: "–" if v is None or (isinstance(v, float) and np.isnan(v)) else f"{v * 100:.1f}%"  # noqa: E731
    qlabel = lambda q: "none (always 3)" if q == "none" else f"{float(q):.2f}"  # noqa: E731
    year = lambda d: str(d)[:4]  # noqa: E731
    summary, fair, conn = out["summary"], out["fairness"], out["connectivity_check"]
    rec = out["evaluation_recommended"]
    types = sorted({t for r in out["listed_by_type"] for t in r if t != "method"})
    by_type = {r["method"]: r for r in out["listed_by_type"]}
    lines = [
        "# Anomaly detection: deployment-matching test (protocol version 7)",
        "",
        f"Plan: [`{out['plan'].replace(chr(92), '/')}`](../../../../config/anomaly_deployment_test.yaml), written before it was run. "
        f"Each sub-county is refitted every {dep['refit_every_school_days']} school days on its last {dep['window_school_days']}, "
        f"with the settings fixed from the main evaluation and no labels. Each week the officer gets up to {k} school-weeks: the "
        "highest-scoring, above the review threshold. School-weeks marked follow-up are left out of later fits. "
        f"{1 + len(plan['datasets']['seeds'])} datasets × {len(plan['model_seeds'])} model seeds. The unit is the school-week. "
        f"The threshold is chosen on {year(plan['periods']['selection']['start'])}; the figures below are for "
        f"{year(plan['periods']['test']['start'])}.",
        "",
        f"**{out['conclusion']}**",
        "",
        md_table([[LABELS[r["method"]], qlabel(r["q"]), pct(r["precision_at_k"]), pct(r["recall_at_k"]), pct(r["f1_at_k"]),
                   pct(r["empty_weeks_share"]), f"{r['listings_per_officer_week']:.2f}", f"{r['false_listings_per_officer_term']:.1f}"]
                  for r in summary],
                 ["Method", "Review threshold (q)", "Precision@3", "Recall@3", "F1@3", "Weeks with nothing listed",
                  "Schools listed per officer-week", "Ordinary schools listed per officer-term"]),
        "",
        "## The same methods without a threshold (always 3 a week)",
        "",
        md_table([[LABELS[r["method"]], pct(r["precision_at_k"]), pct(r["recall_at_k"]), pct(r["f1_at_k"]),
                   f"{r['false_listings_per_officer_term']:.1f}"] for r in out["without_threshold"]],
                 ["Method", "Precision@3", "Recall@3", "F1@3", "Ordinary schools listed per officer-term"]),
        "",
        f"## Choosing the threshold ({year(plan['periods']['selection']['start'])}, the selection year)",
        "",
        "The protocol chooses each method's q by the highest F1@3 on the selection year; ties go to the lower q.",
        "",
        md_table([[LABELS[r["method"]], qlabel(r["q"]), pct(r["precision_at_k"]), pct(r["recall_at_k"]), pct(r["f1_at_k"])]
                  for r in out["selection_by_threshold"]],
                 ["Method", "q", "Precision@3", "Recall@3", "F1@3"]),
        "",
        "## Problem school-weeks listed, by type",
        "",
        md_table([[LABELS[r["method"]]] + [pct(by_type[r["method"]].get(t)) for t in types] for r in summary if r["method"] in by_type],
                 ["Method"] + types),
        "",
    ]
    if fair:
        lines += [
            f"## Fairness ({LABELS[rec]}, preliminary)",
            "",
            "For each group, ordinary school-weeks listed (false listing rate) and problem school-weeks listed (detection rate), "
            f"against the overall rates ({pct(fair['overall_false_listing_rate'])} and {pct(fair['overall_detection_rate'])}). "
            f"A group is over-listed above {plan['fairness_v7']['over_listed_ratio']:.1f} times the overall false listing rate. "
            "40 synthetic schools: small groups, so these are indications, not conclusions.",
            "",
            md_table([[g, v["by"].replace("_group", "").replace("_", " "), str(v["ordinary_weeks"]), pct(v["false_listing_rate"]),
                       f"{v['false_listing_ratio']:.2f}", pct(v["detection_rate"])] for g, v in fair["groups"].items()],
                     ["Group", "By", "Ordinary weeks", "False listing rate", "Against overall", "Detection rate"]),
            "",
            f"**Over-listed:** {', '.join(fair['over_listed']) if fair['over_listed'] else 'none'}.",
            "",
        ]
    if conn:
        lines += [
            "## Connectivity check",
            "",
            "Ordinary school-weeks listed, in weeks when the school's device could not sync and in other weeks, with version 7's "
            "features (entry measured from capture) and with version 6's (entry measured from server receipt), on the same data.",
            "",
            md_table([[name, pct(c["outage_weeks"]), pct(c["other_weeks"]), pct(c["precision_at_k"]), pct(c["recall_at_k"])]
                      for name, c in (("Version 7 (capture)", conn["version_7"]), ("Version 6 timing (server receipt)", conn["version_6_timing"]))],
                     ["Timing features", "Ordinary outage weeks listed", "Ordinary other weeks listed", "Precision@3", "Recall@3"]),
            "",
        ]
    lines += ["Synthetic data: this shows how the methods behave in deployment on records shaped like Kenyan school feeding "
              "records, not how often they would be right at real schools.", ""]
    (report_dir / "anomaly_deployment_test.md").write_text(chr(10).join(lines), encoding="utf-8")
    print(f"Wrote {report_dir / 'anomaly_deployment_test.md'}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--methods", nargs="*", help="only these methods (default: the plan's)")
    parser.add_argument("--report-dir", type=Path, default=REPORT_DIR)
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    parser.add_argument("--report-only", action="store_true", help="rebuild the report from the saved results")
    args = parser.parse_args()
    started = time.time()
    plan = yaml.safe_load(open(PLAN, encoding="utf-8"))
    if args.report_only:
        write_report(json.load(open(args.report_dir / "anomaly_deployment_test.json", encoding="utf-8")), plan, args.report_dir)
        return
    if args.methods:
        plan["methods"] = args.methods
    dep, k = plan["deployment"], plan["deployment"]["review_list"]["k"]
    evaluation = json.load(open(EVALUATION, encoding="utf-8"))
    params = {m: evaluation["results"][m]["params"] for m in plan["methods"] if m in evaluation["results"]}
    recommended = evaluation["recommended"]
    base = yaml.safe_load(open(FORECASTING_DIR.parent / plan["datasets"]["main"], encoding="utf-8"))
    datasets = {"main": MAIN_DATA}
    for seed in plan["datasets"]["seeds"]:
        out = DATA_ROOT / f"seed_{seed}"
        generate(dict(copy.deepcopy(base), seed=seed), out, quiet=True)
        datasets[f"seed_{seed}"] = out
    quantiles = plan["review_threshold"]["candidates"]

    # Every method x seed x dataset x threshold, plus the connectivity check
    tasks, keys = [], []
    for dataset, data_dir in datasets.items():
        for method in plan["methods"]:
            seeds = [plan["model_seeds"][0]] if method == "rules" else plan["model_seeds"]
            for model_seed in seeds:
                for q in (["none"] if method == "rules" else quantiles):
                    tasks.append((str(data_dir), "capture", method, params.get(method, {}), model_seed, str(q), dep))
                    keys.append((dataset, method, model_seed, str(q), "capture"))
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        results = list(pool.map(run, tasks))
    print(f"Main runs done ({time.time() - started:.0f}s)")

    def table(rows):
        return pd.DataFrame(rows)

    per_run = []
    for (dataset, method, model_seed, q, _), weeks in zip(keys, results):
        for period, part in split(weeks, plan["periods"]).items():
            per_run.append({"dataset": dataset, "method": method, "model_seed": model_seed, "q": q, "period": period, **measure(part, k)})
    df = table(per_run)

    # q chosen per method on the selection year: highest mean F1@k; ties to the lower q
    order = {str(q): i for i, q in enumerate(quantiles)}
    chosen = {}
    for method, part in df[df.period == "selection"].groupby("method"):
        means = part.groupby("q").f1_at_k.mean()
        best = means.max()
        chosen[method] = sorted([q for q, v in means.items() if v >= best - 1e-12], key=lambda q: order.get(q, -1))[0]
    test = df[(df.period == "test") & (df.apply(lambda r: r.q == chosen[r.method], axis=1))]
    summary = test.groupby("method").agg(
        q=("q", "first"), precision_at_k=("precision_at_k", "mean"), precision_sd=("precision_at_k", "std"),
        recall_at_k=("recall_at_k", "mean"), f1_at_k=("f1_at_k", "mean"), empty_weeks_share=("empty_weeks_share", "mean"),
        listings_per_officer_week=("listings_per_officer_week", "mean"),
        false_listings_per_officer_term=("false_listings_per_officer_term", "mean")).sort_values("precision_at_k", ascending=False)
    no_threshold = df[(df.period == "test") & (df.q == "none")].groupby("method")[
        ["precision_at_k", "recall_at_k", "f1_at_k", "false_listings_per_officer_term"]].mean()
    by_type = pd.DataFrame([{"method": r.method, **r.listed_by_type} for r in test.itertuples()]).groupby("method").mean()
    selection_grid = df[df.period == "selection"].groupby(["method", "q"])[["precision_at_k", "recall_at_k", "f1_at_k"]].mean()

    # Fairness and the connectivity check, for the recommended method at its chosen q
    fair = conn = None
    if recommended in chosen:
        rec_q = chosen[recommended]
        rec_weeks = [w for key, w in zip(keys, results) if key[1] == recommended and key[3] == rec_q]
        test_weeks = pd.concat([split(w, plan["periods"])["test"] for w in rec_weeks], ignore_index=True)
        fair = fairness(test_weeks, plan["fairness_v7"]["over_listed_ratio"])
        conn_tasks = [(str(d), "sync", recommended, params[recommended], s, rec_q, dep)
                      for d in datasets.values() for s in plan["model_seeds"]]
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            v6 = pd.concat([split(w, plan["periods"])["test"] for w in pool.map(run, conn_tasks)], ignore_index=True)

        def outage_rates(weeks):
            ordinary = weeks[~weeks.anomalous]
            return {"outage_weeks": float(ordinary[ordinary.in_outage].listed.mean()),
                    "other_weeks": float(ordinary[~ordinary.in_outage].listed.mean()),
                    "precision_at_k": float(weeks[weeks.listed].anomalous.mean()),
                    "recall_at_k": float(weeks[weeks.anomalous].listed.mean())}
        conn = {"version_7": outage_rates(test_weeks), "version_6_timing": outage_rates(v6)}
        print(f"Fairness and connectivity done ({time.time() - started:.0f}s)")

    best = summary.index[0]
    holds = recommended in summary.index and summary.loc[recommended, "precision_at_k"] >= summary.loc[best, "precision_at_k"] - 0.01
    conclusion = (f"The evaluation's conclusion holds in deployment: {LABELS[recommended]} "
                  + ("has the highest mean Precision@3." if best == recommended else f"is within 1 point of the best ({LABELS[best]}).")
                  if holds else
                  f"Deployed, {LABELS[best]} does best, "
                  f"{(summary.loc[best, 'precision_at_k'] - summary.loc[recommended, 'precision_at_k']) * 100:.1f} points above "
                  f"{LABELS[recommended]}.")

    report_dir = args.report_dir
    report_dir.mkdir(parents=True, exist_ok=True)
    write_json(report_dir / "anomaly_deployment_test.json", {
        "plan": str(PLAN.relative_to(FORECASTING_DIR.parent)), "protocol_version": 7, "settings": params,
        "chosen_threshold_quantile": chosen,
        "summary": summary.round(4).reset_index().to_dict(orient="records"),
        "without_threshold": no_threshold.round(4).reset_index().to_dict(orient="records"),
        "selection_by_threshold": selection_grid.round(4).reset_index().to_dict(orient="records"),
        "listed_by_type": by_type.round(4).reset_index().to_dict(orient="records"),
        "fairness": fair, "connectivity_check": conn,
        "per_run": df.drop(columns=["listed_by_type"]).round(4).to_dict(orient="records"),
        "evaluation_recommended": recommended, "deployed_best": best, "conclusion": conclusion,
        "runtime_seconds": round(time.time() - started),
    })

    write_report(json.load(open(report_dir / "anomaly_deployment_test.json", encoding="utf-8")), plan, report_dir)
    print(conclusion)
    print(f"Done ({time.time() - started:.0f}s)")


if __name__ == "__main__":
    main()
