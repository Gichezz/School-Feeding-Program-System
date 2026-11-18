"""
Protocol version 9, part B (config/anomaly_v9.yaml): the three changes from the approved
investigation, tested in order on 2025, then the frozen setting tested once on 10 fresh
datasets against version 8.

Development (default): the deployment loop is version 8's, stopped at the end of 2025, so
no part of 2026 is scored. Each candidate is run over the 4 existing datasets x 5 model
seeds x 4 review thresholds; a change is adopted only under the protocol's rules.

Final (--final): reads the frozen setting from the protocol (it refuses to run without
one), generates the 10 fresh datasets and scores each one's 2026 once, for version 8 and
the frozen version 9, with bootstrap intervals over datasets.

Outputs
  data/reports/anomaly/v9/development.json, development.md
  data/reports/anomaly/v9/final.json, final.md

Usage
  python forecasting/scripts/run_anomaly_v9.py --workers 6
  python forecasting/scripts/run_anomaly_v9.py --final --workers 6
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
from common import PROCESSED_DIR, REPORTS_DIR, md_table, write_json  # noqa: E402
from generate_feeding_dataset import OUT_DIR as MAIN_DATA, generate  # noqa: E402
import run_anomaly_deployment_test as v7  # noqa: E402
import run_anomaly_v8 as v8  # noqa: E402

PLAN = FORECASTING_DIR / "config" / "anomaly_v9.yaml"
REPORT_DIR = REPORTS_DIR / "anomaly" / "v9"
FRESH_ROOT = PROCESSED_DIR / "feeding_deployment" / "v9_fresh"
DEV = {"start": "2025-01-06", "end": "2025-12-31"}
TEST = {"start": "2026-01-01", "end": "2026-10-23"}
V8_SETTING = {"method": "extended_isolation_forest", "features": list(FEATURES), "persistence": False}
PERSIST_Q = 0.90


def make_model(setting, params, model_seed):
    if setting["method"] == "extended_isolation_forest":
        m = METHODS["extended_isolation_forest"](**dict(params, random_state=model_seed))
        m.features = setting["features"]
        return m
    return METHODS[setting["method"]](features=setting["features"], random_state=model_seed, **params)


def run(task):
    """One setting, dataset, model seed and threshold: every scored school-week from the
    start of 2025 to `end`, with whether it was listed and what it contained."""
    data_dir, setting, params, model_seed, q, dep, end = task
    feats = v7._dataset(data_dir, "capture")
    start, end = pd.Timestamp(DEV["start"]), pd.Timestamp(end)
    k = dep["review_list"]["k"]
    rules = METHODS["rules"]()
    out = []
    for sub_county, rows in feats.groupby("sub_county"):
        rows = rows.sort_values(["date", "school_id"])
        follow_up = set()
        model, next_refit, threshold, p90 = None, None, None, None
        last_high, last_listed = {}, set()
        for week, week_rows in rows[(rows.date >= start) & (rows.date <= end)].groupby("week", sort=True):
            first_day = int(week_rows.day_index.min())
            if model is None or first_day >= next_refit:
                history = rows[(rows.day_index < first_day) & (rows.day_index >= first_day - dep["window_school_days"])]
                history = history[[(s, w) not in follow_up for s, w in zip(history.school_id, history.week)]]
                if history.day_index.nunique() < dep["min_history_school_days"]:
                    model = None
                else:
                    model = make_model(setting, params, model_seed).fit(history)
                    next_refit = first_day + dep["refit_every_school_days"]
                    hist = weekly_scores(history.assign(score=model.score(history)))
                    threshold = -np.inf if q == "none" else float(hist.quantile(float(q)))
                    p90 = float(hist.quantile(PERSIST_Q))
            if model is None:
                score = week_rows.assign(score=rules.score(week_rows)).groupby("school_id").score.max()
                cut, high = 0.0, {}
            else:
                score = weekly_scores(week_rows.assign(score=model.score(week_rows))).droplevel("week")
                cut = threshold
                high = {s: bool(v > p90) for s, v in score.items()}
            ranked = score.sort_values(ascending=False)
            listed = [s for s in ranked.index if ranked[s] > cut][:k]
            if setting["persistence"] and model is not None:
                # Above the window's 90th percentile this week and last; not listed last week
                for s in ranked.index:
                    if len(listed) >= k:
                        break
                    if s not in listed and high.get(s) and last_high.get(s) and s not in last_listed:
                        listed.append(s)
            labels = week_rows.groupby("school_id").label.agg(lambda x: sorted(set(x) - {""}))
            info = week_rows.groupby("school_id").agg(in_outage=("in_outage", "max"), size_group=("size_group", "first"),
                                                       programme_group=("programme_group", "first"),
                                                       sync_group=("sync_group", "first"))
            for s in score.index:
                types = labels[s]
                out.append({"sub_county": sub_county, "week": week, "school_id": s, "listed": s in listed,
                            "anomalous": bool(types), "types": types, "in_outage": bool(info.in_outage[s]),
                            "size_group": info.size_group[s], "programme_group": info.programme_group[s],
                            "sync_group": info.sync_group[s]})
                if s in listed and types and dep["exclude_follow_up_from_training"]:
                    follow_up.add((s, week))
            last_high, last_listed = high, set(listed)
    return pd.DataFrame(out)


def label(setting):
    extra = [f for f in setting["features"] if f not in FEATURES]
    return (f"{'isolation model + over-recording' if setting['method'] != 'extended_isolation_forest' else 'isolation model'}"
            f"{'; +' + ', +'.join(extra) if extra else ''}{'; persistence' if setting['persistence'] else ''}")


def summarise(weeks_by_run, period, k, ratio_limit):
    """Mean measures over runs, problems caught, and fairness, for one period."""
    rows, episodes, parts = [], [], []
    for (dataset, data_dir, model_seed), weeks in weeks_by_run:
        part = v7.split(weeks, {"p": period})["p"]
        m = v7.measure(part, k)
        rows.append({"dataset": dataset, "model_seed": model_seed, **{x: m[x] for x in (
            "precision_at_k", "recall_at_k", "f1_at_k", "empty_weeks_share", "listings_per_officer_week",
            "false_listings_per_officer_term")}, "listed_by_type": m["listed_by_type"]})
        ep = v8.episodes_caught(part, data_dir, period).assign(dataset=dataset, model_seed=model_seed)
        episodes.append(ep)
        parts.append(part)
    df = pd.DataFrame(rows)
    ep = pd.concat(episodes, ignore_index=True)
    caught = v8.episode_summary([ep])
    by_dataset = []
    for d, g in df.groupby("dataset"):
        e = ep[ep.dataset == d].copy()
        e["weeks_to_catch"] = pd.to_numeric(e.weeks_to_catch, errors="coerce")
        by_dataset.append({"dataset": d, **g[["precision_at_k", "recall_at_k", "f1_at_k", "false_listings_per_officer_term",
                                               "listings_per_officer_week"]].mean().to_dict(),
                           "problems_caught": float(e.caught.mean()),
                           "problems_caught_within_2_weeks": float((e.caught & (e.weeks_to_catch <= 1)).mean())})
    fair = v7.fairness(pd.concat(parts, ignore_index=True), ratio_limit)
    return {"mean": {**df[["precision_at_k", "recall_at_k", "f1_at_k", "empty_weeks_share", "listings_per_officer_week",
                           "false_listings_per_officer_term"]].mean().round(4).to_dict(),
                     "problems_caught": round(caught["episodes_caught"], 4),
                     "problems_caught_within_2_weeks": round(caught["episodes_caught_within_2_weeks"], 4),
                     "median_weeks_to_catch": caught["median_weeks_to_catch"],
                     "listed_by_type": pd.DataFrame(list(df.listed_by_type)).mean().round(4).to_dict(),
                     "caught_by_type": caught["caught_by_type"]},
            "by_dataset": by_dataset, "fairness": fair, "episodes": caught["episodes"]}


def datasets_for(names_and_seeds, base):
    out = {}
    for name, seed in names_and_seeds:
        if seed is None:
            out[name] = MAIN_DATA
            continue
        path = (v7.DATA_ROOT if name.startswith("seed_") else FRESH_ROOT) / name
        generate(dict(copy.deepcopy(base), seed=seed), path, quiet=True)
        out[name] = path
    return out


def evaluate(setting, datasets, quantiles, params, dep, plan_dep, workers, end, choose_on):
    tasks, keys = [], []
    for name, d in datasets.items():
        for s in plan_dep["model_seeds"]:
            for q in quantiles:
                tasks.append((str(d), setting, params, s, str(q), dep, end))
                keys.append((name, str(d), s, str(q)))
    with ProcessPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(run, tasks))
    by_q = {}
    for (name, d, s, q), w in zip(keys, results):
        by_q.setdefault(q, []).append(((name, d, s), w))
    return by_q


def development(args, plan, plan_dep, params, base):
    dep = plan_dep["deployment"]
    k, limit = dep["review_list"]["k"], plan_dep["fairness_v7"]["over_listed_ratio"]
    quantiles = [str(q) for q in plan_dep["review_threshold"]["candidates"]]
    datasets = datasets_for([("main", None)] + [(f"seed_{s}", s) for s in plan_dep["datasets"]["seeds"]], base)
    rules = plan["part_b"]
    started = time.time()
    cache = {}

    def result(setting):
        key = json.dumps(setting, sort_keys=True)
        if key not in cache:
            by_q = evaluate(setting, datasets, quantiles, params, dep, plan_dep, args.workers, DEV["end"], DEV)
            summaries = {q: summarise(runs, DEV, k, limit) for q, runs in by_q.items()}
            f1 = {q: s["mean"]["f1_at_k"] for q, s in summaries.items()}
            q_best = sorted([q for q in quantiles if f1[q] >= max(f1.values()) - 1e-12], key=quantiles.index)[0]
            cache[key] = {"setting": setting, "label": label(setting), "q": q_best, "f1_by_q": f1, **summaries[q_best]}
            m = cache[key]["mean"]
            print(f"  {label(setting)}: q={q_best}, F1@3 {m['f1_at_k'] * 100:.1f}%, caught {m['problems_caught'] * 100:.1f}%, "
                  f"ordinary/term {m['false_listings_per_officer_term']:.1f} ({time.time() - started:.0f}s)")
        return cache[key]

    current = dict(V8_SETTING)
    print("Version 8 on 2025")
    baseline = result(current)
    log = []
    candidates = [
        ("change_1_over_recording", lambda c: dict(c, method="extended_isolation_forest_with_over_recording")),
        ("change_2_store_gap", lambda c: dict(c, features=c["features"] + ["count_gap_recent"])),
        ("change_3_persistence", lambda c: dict(c, persistence=True)),
    ]
    margins = {c["name"]: c["margin_f1_points"] for c in rules["changes"]}
    for name, make in candidates:
        print(name)
        inc, cand = result(current), result(make(current))
        gain = (cand["mean"]["f1_at_k"] - inc["mean"]["f1_at_k"]) * 100
        checks = {
            "f1_margin": gain >= margins[name],
            "problems_caught_not_lower": cand["mean"]["problems_caught"] >= inc["mean"]["problems_caught"] - 1e-12,
            "workload_within_1": cand["mean"]["false_listings_per_officer_term"] <= baseline["mean"]["false_listings_per_officer_term"] + 1.0,
            "fairness_within_1_5": not cand["fairness"]["over_listed"],
        }
        adopted = all(checks.values())
        log.append({"change": name, "margin": margins[name], "candidate": cand["label"], "gain_f1_points": round(gain, 2),
                    "current": {"label": inc["label"], "q": inc["q"], **inc["mean"]},
                    "candidate_result": {"label": cand["label"], "q": cand["q"], **cand["mean"],
                                         "fairness_max_ratio": max(v["false_listing_ratio"] for v in cand["fairness"]["groups"].values()),
                                         "by_size": {g: v for g, v in cand["fairness"]["groups"].items() if v["by"] == "size_group"},
                                         "by_sub_county": {g: v for g, v in cand["fairness"]["groups"].items() if v["by"] == "sub_county"}},
                    "checks": checks, "adopted": adopted})
        print(f"  {'ADOPTED' if adopted else 'not adopted'} ({gain:+.1f} F1 points; {checks})")
        if adopted:
            current = make(current)
    final = result(current)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(REPORT_DIR / "development.json", {
        "plan": "config/anomaly_v9.yaml part B", "period": "2025 (development)", "baseline_version_8": {"q": baseline["q"], **baseline["mean"]},
        "stages": log, "recommended_setting": {**current, "q": final["q"]}, "recommended": {"q": final["q"], **final["mean"]},
        "runtime_seconds": round(time.time() - started)})
    print("Recommended:", label(current), "q =", final["q"])


def bootstrap(values, n=2000, seed=0):
    rng = np.random.default_rng(seed)
    values = np.asarray(values, dtype=float)
    means = [rng.choice(values, len(values), replace=True).mean() for _ in range(n)]
    return [round(float(np.percentile(means, 2.5)), 4), round(float(np.percentile(means, 97.5)), 4)]


def final(args, plan, plan_dep, params, base):
    frozen = plan.get("frozen")
    if not frozen:
        raise SystemExit("No frozen setting in the protocol: freeze version 9 before the final test.")
    dep = plan_dep["deployment"]
    k, limit = dep["review_list"]["k"], plan_dep["fairness_v7"]["over_listed_ratio"]
    seeds = list(range(9001, 9011))
    datasets = datasets_for([(f"fresh_{s}", s) for s in seeds], base)
    v9_setting = {"method": frozen["method"], "features": frozen["features"], "persistence": frozen["persistence"]}
    out = {"plan": "config/anomaly_v9.yaml part B, final evaluation", "frozen": frozen, "datasets": list(datasets),
           "period": TEST}
    started = time.time()
    per_version = {}
    for name, setting, q in (("version_8", V8_SETTING, "0.98"), ("version_9", v9_setting, str(frozen["q"]))):
        # Version 9 frozen as version 8 is the same run: scored once
        if name == "version_9" and setting == V8_SETTING and q == "0.98":
            per_version[name] = per_version["version_8"]
            continue
        by_q = evaluate(setting, datasets, [q], params, dep, plan_dep, args.workers, TEST["end"], TEST)
        per_version[name] = summarise(by_q[q], TEST, k, limit)
        print(f"{name}: {per_version[name]['mean']} ({time.time() - started:.0f}s)")
    measures = ["precision_at_k", "recall_at_k", "f1_at_k", "problems_caught", "problems_caught_within_2_weeks",
                "false_listings_per_officer_term", "listings_per_officer_week"]
    table = {}
    for v, r in per_version.items():
        bd = pd.DataFrame(r["by_dataset"]).set_index("dataset")
        table[v] = {m: {"mean": round(float(bd[m].mean()), 4), "sd": round(float(bd[m].std()), 4), "ci95": bootstrap(bd[m])}
                    for m in measures}
    d8 = pd.DataFrame(per_version["version_8"]["by_dataset"]).set_index("dataset")
    d9 = pd.DataFrame(per_version["version_9"]["by_dataset"]).set_index("dataset")
    diff = {m: {"mean": round(float((d9[m] - d8[m]).mean()), 4), "ci95": bootstrap(d9[m] - d8[m])} for m in measures}
    out.update({"versions": per_version, "summary": table, "difference_v9_minus_v8": diff,
                "runtime_seconds": round(time.time() - started)})
    write_json(REPORT_DIR / "final.json", out)
    print(json.dumps({"summary": table, "difference": diff}, indent=1))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--final", action="store_true")
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) // 2))
    args = parser.parse_args()
    plan = yaml.safe_load(open(PLAN, encoding="utf-8"))
    plan_dep = yaml.safe_load(open(v7.PLAN, encoding="utf-8"))
    params = json.load(open(v7.EVALUATION, encoding="utf-8"))["results"]["extended_isolation_forest"]["params"]
    base = yaml.safe_load(open(FORECASTING_DIR.parent / plan_dep["datasets"]["main"], encoding="utf-8"))
    (final if args.final else development)(args, plan, plan_dep, params, base)


if __name__ == "__main__":
    main()
