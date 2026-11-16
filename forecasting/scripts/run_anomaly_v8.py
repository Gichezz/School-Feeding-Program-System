"""
Protocol version 8 (config/anomaly_v8.yaml, committed before it was run): four changes to
the weekly review list, tested in a fixed order and chosen on the selection year (2025)
only, then the test year (2026) scored once for the final settings and for version 7's.

The deployment loop is version 7's (scripts/run_anomaly_deployment_test.py): each
sub-county refitted every 20 school days on its last 125, follow-up weeks left out of
later fits, at most 3 school-weeks a week above the review threshold. A setting is:
    aggregation   how a school's week is scored from its days: max, top2_mean or weighted
    features      the features the model uses
    grouped       one model per group of features and one on all, the highest standardised
    rules_first   school-weeks that broke a fixed rule listed first

Outputs
  data/reports/anomaly/v8/anomaly_v8.json
  data/reports/anomaly/v8/anomaly_v8.md

Usage
  python forecasting/scripts/run_anomaly_v8.py --workers 11
  python forecasting/scripts/run_anomaly_v8.py --report-only
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

from anomaly.features import FEATURES  # noqa: E402
from anomaly.methods import METHODS  # noqa: E402
from anomaly.weekly import weekly_scores  # noqa: E402
from common import REPORTS_DIR, md_table, write_json  # noqa: E402
from generate_feeding_dataset import OUT_DIR as MAIN_DATA, generate  # noqa: E402
import run_anomaly_deployment_test as v7  # noqa: E402

PLAN = FORECASTING_DIR / "config" / "anomaly_v8.yaml"
REPORT_DIR = REPORTS_DIR / "anomaly" / "v8"
V7_FEATURES = list(FEATURES)
METHOD = "extended_isolation_forest"


def make_model(setting, params, model_seed, groups):
    if setting["grouped"]:
        g = {name: [f for f in feats if f in setting["features"]] for name, feats in groups.items()}
        return METHODS["grouped_extended_isolation_forest"](groups=g, features=setting["features"],
                                                            random_state=model_seed, **params)
    model = METHODS[METHOD](**dict(params, random_state=model_seed))
    model.features = setting["features"]
    return model


def run(task):
    """One setting, one model seed, one dataset, one threshold: every scored school-week
    with its score, whether it was listed and what it really contained."""
    data_dir, setting, params, model_seed, q, dep, groups = task
    feats = v7._dataset(data_dir, "capture")
    start, end = pd.Timestamp(dep["scored_period"]["start"]), pd.Timestamp(dep["scored_period"]["end"])
    k, how = dep["review_list"]["k"], setting["aggregation"]
    rules = METHODS["rules"]()
    out = []
    for sub_county, rows in feats.groupby("sub_county"):
        rows = rows.sort_values(["date", "school_id"])
        follow_up = set()
        model, next_refit, threshold = None, None, None
        for week, week_rows in rows[(rows.date >= start) & (rows.date <= end)].groupby("week", sort=True):
            first_day = int(week_rows.day_index.min())
            if model is None or first_day >= next_refit:
                history = rows[(rows.day_index < first_day) & (rows.day_index >= first_day - dep["window_school_days"])]
                history = history[[(s, w) not in follow_up for s, w in zip(history.school_id, history.week)]]
                if history.day_index.nunique() < dep["min_history_school_days"]:
                    model = None
                else:
                    model = make_model(setting, params, model_seed, groups).fit(history)
                    next_refit = first_day + dep["refit_every_school_days"]
                    hist = weekly_scores(history.assign(score=model.score(history)), how)
                    threshold = -np.inf if q == "none" else float(hist.quantile(float(q)))
            rule_week = week_rows.assign(score=rules.score(week_rows)).groupby("school_id").score.max()
            if model is None:
                score, cut = rule_week, 0.0
            else:
                score = weekly_scores(week_rows.assign(score=model.score(week_rows)), how).droplevel("week")
                cut = threshold
            labels = week_rows.groupby("school_id").label.agg(lambda s: sorted(set(s) - {""}))
            info = week_rows.groupby("school_id").agg(in_outage=("in_outage", "max"), size_group=("size_group", "first"),
                                                       programme_group=("programme_group", "first"),
                                                       sync_group=("sync_group", "first"))
            listed = []
            if setting["rules_first"] and model is not None:
                listed = list(rule_week[rule_week > 0].sort_values(ascending=False).index[:k])
            for school in score[score > cut].sort_values(ascending=False).index:
                if len(listed) >= k:
                    break
                if school not in listed:
                    listed.append(school)
            for school in score.index:
                types = labels[school]
                out.append({"sub_county": sub_county, "week": week, "school_id": school, "listed": school in listed,
                            "anomalous": bool(types), "types": types, "in_outage": bool(info.in_outage[school]),
                            "size_group": info.size_group[school], "programme_group": info.programme_group[school],
                            "sync_group": info.sync_group[school]})
                if school in listed and types and dep["exclude_follow_up_from_training"]:
                    follow_up.add((school, week))
    return pd.DataFrame(out)


def episodes_caught(weeks, data_dir, period):
    """For each injected episode that starts in the period: caught if any school-week it
    covers is listed, and how many school weeks from its first week to the first listing."""
    ep = pd.read_csv(Path(data_dir) / "episodes.csv", parse_dates=["start", "end"])
    ep = ep[(ep.start >= pd.Timestamp(period["start"])) & (ep.start <= pd.Timestamp(period["end"]))]
    rows = []
    by_school = {s: g.sort_values("week") for s, g in weeks.groupby("school_id")}
    for e in ep.itertuples():
        covered = {d.strftime("%G-%V") for d in pd.date_range(e.start, e.end)}
        w = by_school.get(e.school_id)
        w = w[w.week.isin(covered)] if w is not None else pd.DataFrame(columns=["week", "listed"])
        hit = w.reset_index(drop=True).listed
        first = int(hit.idxmax()) if hit.any() else None
        rows.append({"type": e.type, "caught": first is not None, "weeks_to_catch": first, "weeks_covered": len(w)})
    return pd.DataFrame(rows)


def episode_summary(frames):
    df = pd.concat(frames, ignore_index=True)
    df["weeks_to_catch"] = pd.to_numeric(df.weeks_to_catch, errors="coerce")
    caught = df[df.caught]
    return {
        "episodes": int(len(df)),
        "episodes_caught": float(df.caught.mean()),
        "episodes_caught_within_2_weeks": float((df.caught & (df.weeks_to_catch <= 1)).mean()),
        "median_weeks_to_catch": float(caught.weeks_to_catch.median()) if len(caught) else float("nan"),
        "caught_by_type": df.groupby("type").caught.mean().round(4).to_dict(),
    }


def label(setting):
    extra = [f for f in setting["features"] if f not in V7_FEATURES]
    return (f"{setting['aggregation']}; {'+' + ', +'.join(extra) if extra else 'v7 features'}; "
            f"{'grouped' if setting['grouped'] else 'one model'}; {'rules first' if setting['rules_first'] else 'model list'}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    parser.add_argument("--report-only", action="store_true")
    args = parser.parse_args()
    if args.report_only:
        write_report(json.load(open(REPORT_DIR / "anomaly_v8.json", encoding="utf-8")))
        return
    started = time.time()
    plan = yaml.safe_load(open(PLAN, encoding="utf-8"))
    dep_plan = yaml.safe_load(open(v7.PLAN, encoding="utf-8"))
    dep = dep_plan["deployment"]
    k = dep["review_list"]["k"]
    params = json.load(open(v7.EVALUATION, encoding="utf-8"))["results"][METHOD]["params"]
    quantiles = [str(q) for q in dep_plan["review_threshold"]["candidates"]]
    stages = {s["name"]: s for s in plan["stages"]}
    groups = stages["stage_3_grouped_models"]["groups"]
    periods = {"selection": plan["selection"], "test": plan["test"]}
    base = yaml.safe_load(open(FORECASTING_DIR.parent / dep_plan["datasets"]["main"], encoding="utf-8"))
    datasets = {"main": MAIN_DATA}
    for seed in dep_plan["datasets"]["seeds"]:
        out = v7.DATA_ROOT / f"seed_{seed}"
        generate(dict(copy.deepcopy(base), seed=seed), out, quiet=True)
        datasets[f"seed_{seed}"] = out
    cache = {}

    def evaluate(setting):
        """Every dataset x model seed x q for one setting; q chosen on the selection year."""
        key = json.dumps(setting, sort_keys=True)
        if key in cache:
            return cache[key]
        tasks, keys = [], []
        for name, d in datasets.items():
            for s in dep_plan["model_seeds"]:
                for q in quantiles:
                    tasks.append((str(d), setting, params, s, q, dep, groups))
                    keys.append((name, s, q))
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            results = list(pool.map(run, tasks))
        rows = []
        for (name, s, q), weeks in zip(keys, results):
            for period, part in v7.split(weeks, periods).items():
                rows.append({"dataset": name, "model_seed": s, "q": q, "period": period, **v7.measure(part, k)})
        df = pd.DataFrame(rows)
        sel = df[df.period == "selection"].groupby("q").f1_at_k.mean()
        q_best = sorted([q for q, v in sel.items() if v >= sel.max() - 1e-12], key=quantiles.index)[0]
        chosen = df[(df.q == q_best)]
        summary = {p: chosen[chosen.period == p][["precision_at_k", "recall_at_k", "f1_at_k", "empty_weeks_share",
                                                  "listings_per_officer_week", "false_listings_per_officer_term"]].mean().round(4).to_dict()
                   for p in periods}
        test_weeks = [(w, datasets[n]) for (n, s, q), w in zip(keys, results) if q == q_best]
        cache[key] = {"setting": setting, "label": label(setting), "q": q_best, "summary": summary,
                      "selection_by_q": sel.round(4).to_dict(), "_weeks": test_weeks}
        print(f"  {label(setting)}: q={q_best}, 2025 F1@3 {summary['selection']['f1_at_k'] * 100:.1f}% ({time.time() - started:.0f}s)")
        return cache[key]

    current = {"aggregation": "max", "features": V7_FEATURES, "grouped": False, "rules_first": False}
    version_7 = dict(current)
    stage_log = []

    def stage(name, candidates, margin):
        nonlocal current
        print(f"{name}")
        results = {cname: evaluate(c) for cname, c in candidates.items()}
        incumbent = evaluate(current)
        best_name = max(results, key=lambda n: results[n]["summary"]["selection"]["f1_at_k"])
        best = results[best_name]
        gain = (best["summary"]["selection"]["f1_at_k"] - incumbent["summary"]["selection"]["f1_at_k"]) * 100
        adopt = best["setting"] != current and gain >= margin
        extra_ok = True
        if adopt and name == "stage_3_grouped_models":
            fair = v7.fairness(pd.concat([v7.split(w, periods)["selection"] for w, _ in best["_weeks"]], ignore_index=True),
                               dep_plan["fairness_v7"]["over_listed_ratio"])
            extra_ok = not fair["over_listed"]
            adopt = adopt and extra_ok
        stage_log.append({"stage": name, "margin": margin,
                          "candidates": {n: {"label": r["label"], "q": r["q"], "selection": r["summary"]["selection"]}
                                         for n, r in results.items()},
                          "incumbent": incumbent["label"], "best": best_name, "gain_f1_points": round(gain, 2),
                          "adopted": adopt, "fairness_ok": extra_ok})
        if adopt:
            current = best["setting"]
        print(f"  best {best_name} ({gain:+.1f} F1 points): {'adopted' if adopt else 'kept current'}")

    m = plan["margins"]
    stage("stage_1_aggregation", {a: dict(current, aggregation=a) for a in ("max", "top2_mean", "weighted")}, m["stage_1_aggregation"])
    stage("stage_2_features", {
        "fed_vs_peers_trend": dict(current, features=V7_FEATURES + ["fed_vs_peers_trend"]),
        "count_gap_recent": dict(current, features=V7_FEATURES + ["count_gap_recent"]),
        "both": dict(current, features=V7_FEATURES + ["fed_vs_peers_trend", "count_gap_recent"]),
    }, m["stage_2_features"])
    stage("stage_3_grouped_models", {"grouped": dict(current, grouped=True)}, m["stage_3_grouped_models"])
    stage("stage_4_rules_first", {"rules_first": dict(current, rules_first=True)}, m["stage_4_rules_first"])

    # The test year, once, for the final settings and version 7's
    final, v7_run = evaluate(current), evaluate(version_7)
    test = {}
    for name, r in (("version_8", final), ("version_7", v7_run)):
        test_parts = [(v7.split(w, periods)["test"], d) for w, d in r["_weeks"]]
        weeks = pd.concat([w for w, _ in test_parts], ignore_index=True)
        by_type = pd.DataFrame([v7.measure(w, k)["listed_by_type"] for w, _ in test_parts]).mean().round(4).to_dict()
        test[name] = {"label": r["label"], "q": r["q"], **r["summary"]["test"], "listed_by_type": by_type,
                      **episode_summary([episodes_caught(w, d, periods["test"]) for w, d in test_parts]),
                      "fairness": v7.fairness(weeks, dep_plan["fairness_v7"]["over_listed_ratio"])}
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(REPORT_DIR / "anomaly_v8.json", {
        "plan": str(PLAN.relative_to(FORECASTING_DIR.parent)), "protocol_version": 8, "settings": params,
        "final_setting": current, "stages": stage_log, "test": test, "runtime_seconds": round(time.time() - started)})
    write_report(json.load(open(REPORT_DIR / "anomaly_v8.json", encoding="utf-8")))
    print(f"Done ({time.time() - started:.0f}s)")


def write_report(out):
    pct = lambda v: "–" if v is None or (isinstance(v, float) and np.isnan(v)) else f"{v * 100:.1f}%"  # noqa: E731
    t8, t7 = out["test"]["version_8"], out["test"]["version_7"]
    lines = [
        "# Anomaly detection: protocol version 8",
        "",
        "Plan: [`forecasting/config/anomaly_v8.yaml`](../../../../config/anomaly_v8.yaml), committed before it was run. "
        "Four changes tested in order, each chosen on 2025 only and adopted only if it beat the current setting by the "
        "plan's margin. 2026 was then scored once for the final settings and for version 7's. Extended Isolation Forest, "
        "the version 7 deployment loop, 4 datasets × 5 model seeds.",
        "",
        f"**Final setting:** {t8['label']}, review threshold q = {t8['q']}.",
        "",
        "## Test year (2026)",
        "",
        md_table([[name, pct(t["precision_at_k"]), pct(t["recall_at_k"]), pct(t["f1_at_k"]),
                   f"{t['listings_per_officer_week']:.2f}", f"{t['false_listings_per_officer_term']:.1f}",
                   pct(t["episodes_caught"]), pct(t["episodes_caught_within_2_weeks"]),
                   "–" if np.isnan(t["median_weeks_to_catch"]) else f"{t['median_weeks_to_catch']:.0f}"]
                  for name, t in (("Version 8", t8), ("Version 7", t7))],
                 ["", "Precision@3", "Recall@3", "F1@3", "Schools listed per officer-week",
                  "Ordinary schools listed per officer-term", "Problems caught", "Caught within 2 weeks",
                  "Median weeks to catch"]),
        "",
        "A problem is one injected episode (one school, one type, first to last day); it is caught if any school-week it "
        "covers is listed. Weeks to catch counts from the episode's first week (0 = its first week).",
        "",
        "### Problems caught, by type",
        "",
        md_table([[t, pct(t8["caught_by_type"].get(t)), pct(t7["caught_by_type"].get(t))] for t in sorted(t8["caught_by_type"])],
                 ["Type", "Version 8", "Version 7"]),
        "",
        "### Problem school-weeks listed, by type",
        "",
        md_table([[t, pct(t8["listed_by_type"].get(t)), pct(t7["listed_by_type"].get(t))] for t in sorted(t8["listed_by_type"])],
                 ["Type", "Version 8", "Version 7"]),
        "",
        f"**Fairness (version 8, preliminary):** highest false listing ratio "
        f"{max(v['false_listing_ratio'] for v in t8['fairness']['groups'].values()):.2f} (limit 1.5); over-listed: "
        f"{', '.join(t8['fairness']['over_listed']) or 'none'}.",
        "",
        "## Stages (2025, the selection year)",
        "",
    ]
    for s in out["stages"]:
        lines += [f"### {s['stage'].replace('_', ' ').capitalize()}", "",
                  f"Current: {s['incumbent']}. Margin to adopt: {s['margin']:.1f} F1 points.", "",
                  md_table([[n, c["label"], c["q"], pct(c["selection"]["precision_at_k"]), pct(c["selection"]["recall_at_k"]),
                             pct(c["selection"]["f1_at_k"])] for n, c in s["candidates"].items()],
                           ["Candidate", "Setting", "q", "Precision@3", "Recall@3", "F1@3"]),
                  "",
                  f"Best: {s['best']} ({s['gain_f1_points']:+.1f} points). "
                  f"{'Adopted.' if s['adopted'] else 'Not adopted: the current setting stays.'}"
                  + ("" if s["fairness_ok"] else " (A group was over-listed.)"), ""]
    lines += ["Synthetic data: these figures show how the list behaves on records shaped like Kenyan school feeding "
              "records with planted problems, not how often it would be right at real schools.", ""]
    (REPORT_DIR / "anomaly_v8.md").write_text(chr(10).join(lines), encoding="utf-8")
    print(f"Wrote {REPORT_DIR / 'anomaly_v8.md'}")


if __name__ == "__main__":
    main()
