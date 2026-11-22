"""
Protocol version 11 (config/anomaly_v11.yaml, committed before it was run).

The point-in-time harness: each sub-county's finished weeks are scored the way the system
scores them (backend weeklyReviewSchedule.js and reviewInputs.js): the day after the week
ends from the records received by then, and again on any of the next 28 days on which one
of the week's records arrives, each time from the records received so far and dated in the
365 days before the week. The ranking is the scoring service's own code
(services.scoring_service.rank_week), with the setting under test.

  --step features     build and cache every scoring's features (no model, no labels)
  --step development  steps 1-4 on the development datasets (2025)
  --step amendment    plan amendment 1: steps 5-6 and 8 weeks of rescoring (reported only)
  --step parity       one dataset: a model per request against the cached model per refit point
  --step robustness   version 8 and the current setting on the robustness scenarios
  --step final        the test datasets (generated after the freeze), 2026, once

Outputs: data/reports/anomaly/v11/*.json and v11_report.md

Usage
  python forecasting/scripts/run_anomaly_v11.py --step development --workers 11
"""

import argparse
import copy
import datetime as dt
import json
import os
import pickle
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
from sklearn.metrics import average_precision_score  # noqa: E402

from anomaly.features import FEATURES, build_features  # noqa: E402
from common import PROCESSED_DIR, REPORTS_DIR, write_json  # noqa: E402
from services import scoring_service as service  # noqa: E402
import run_anomaly_deployment_test as v7  # noqa: E402

PLAN = FORECASTING_DIR / "config" / "anomaly_v11.yaml"
ROOT = PROCESSED_DIR / "feeding_deployment" / "v11"
FEATURE_CACHE = ROOT / "features"
DEV_DATA = PROCESSED_DIR / "feeding_deployment" / "v10" / "development"
ROBUSTNESS_DATA = PROCESSED_DIR / "feeding_deployment" / "v10" / "robustness"
REPORT_DIR = REPORTS_DIR / "anomaly" / "v11"
HISTORY_DAYS = 365          # backend reviewInputs.js
CALENDAR_DAYS = HISTORY_DAYS + 120
RESCORE_DAYS = 28           # backend weeklyReviewSchedule.js: the last 4 finished weeks
LONG_RESCORE_DAYS = 56      # amendment: reported only, the effect of 8 weeks of rescoring
MAX_WINDOW = 150            # the longest training window tried (amendment step 6)
K = 3
WEEKS_PER_TERM = 13
KEEP = ["school_id", "sub_county", "date", "week", "day_index", "share_fed", *FEATURES]
RULE_ONLY = ["share_fed"]

VERSION_8 = dict(service.VERSION_8)
EVALUATED = dict(VERSION_8, n_estimators=100, ndim=15)


# -- data -----------------------------------------------------------------------

def read(data_dir, name, **kw):
    return pd.read_csv(Path(data_dir) / f"{name}.csv", **kw)


def school_weeks(data_dir, start, end):
    """Every school-week of the period with its labels and groups: the universe a run is
    measured on, whatever was scored."""
    days = read(data_dir, "school_days", parse_dates=["date"])
    days = days[(days.date >= pd.Timestamp(start)) & (days.date <= pd.Timestamp(end))]
    schools = read(data_dir, "schools")
    labels = read(data_dir, "labels", parse_dates=["date"])
    grid = schools[["school_id", "sub_county"]].merge(days[["date"]], how="cross")
    grid = grid.merge(labels, on=["school_id", "date"], how="left")
    grid["label"] = grid.label.fillna("")
    grid["week"] = grid.date.dt.strftime("%G-%V")
    weeks = grid.groupby(["sub_county", "week", "school_id"]).label.agg(lambda s: sorted(set(s) - {""})).rename("types").reset_index()
    weeks["anomalous"] = weeks.types.map(bool)
    size = read(data_dir, "enrolment").groupby("school_id").learners.mean()
    s = schools.set_index("school_id")
    weeks["size_group"] = weeks.school_id.map(pd.qcut(size, 3, labels=["small schools", "medium schools", "large schools"]).astype(str))
    weeks["programme_group"] = weeks.school_id.map(s.programme_type.map({"in_kind": "food delivered", "cash_transfer": "cash transfer"}))
    weeks["sync_group"] = weeks.school_id.map(s.sync_every.map(lambda n: "syncs every 1-2 days" if n <= 2 else "syncs every 3-5 days"))
    weeks["in_outage"] = False
    path = Path(data_dir) / "outages.csv"
    if path.exists():
        out = pd.read_csv(path, parse_dates=["start", "end"])
        for o in out.itertuples():
            hit = grid[(grid.school_id == o.school_id) & grid.date.between(o.start, o.end)].week.unique()
            weeks.loc[(weeks.school_id == o.school_id) & weeks.week.isin(hit), "in_outage"] = True
    return weeks


def _slim(feats, week_start):
    """The rows a scoring of the week can use: from the longest window tried before its refit
    point to the end of the week."""
    week = feats[(feats.date >= pd.Timestamp(week_start)) & (feats.date <= pd.Timestamp(week_start) + pd.Timedelta(days=6))]
    first = int(week.day_index.min())
    anchor = first - first % service.REFIT_EVERY
    rows = feats[((feats.day_index >= anchor - MAX_WINDOW) & (feats.date < pd.Timestamp(week_start))) | feats.index.isin(week.index)]
    return rows[KEEP].copy()


def build_scorings(task):
    """Every scoring of one sub-county's weeks in [start, end]: {(week_start, day): (frame,
    calendar start)}. mode 'point_in_time' (as the system), 'point_in_time_56' (rescored for
    56 days) or 'whole' (every record known)."""
    data_dir, sub_county, start, end, mode = task[:5]
    cache_root = Path(task[5]) if len(task) > 5 else FEATURE_CACHE
    data_dir = Path(data_dir)
    out_path = cache_root / data_dir.parent.name / data_dir.name / f"{mode}_{sub_county}.pkl"
    if out_path.exists():
        return str(out_path)
    schools = read(data_dir, "schools")
    schools = schools[schools.sub_county == sub_county]
    ids = set(schools.school_id)
    enrolment = read(data_dir, "enrolment")
    enrolment = enrolment[enrolment.school_id.isin(ids)]
    feeding = read(data_dir, "feeding", parse_dates=["date", "received_date"])
    feeding = feeding[feeding.school_id.isin(ids)]
    counts = read(data_dir, "stock_counts", parse_dates=["date"])
    counts = counts[counts.school_id.isin(ids)].merge(feeding[["school_id", "date", "received_date"]], on=["school_id", "date"], how="left")
    days = read(data_dir, "school_days", parse_dates=["date"])
    terms = days.groupby("term_id").date.agg(["min", "max"])
    mondays = pd.date_range(pd.Timestamp(start) - pd.Timedelta(days=pd.Timestamp(start).weekday()), pd.Timestamp(end), freq="7D")
    scorings = {}
    rescore_days = LONG_RESCORE_DAYS if mode == "point_in_time_56" else RESCORE_DAYS

    def features(f, c, cal):
        f = f.assign(date=f.date.dt.strftime("%Y-%m-%d"), received_date=f.received_date.dt.strftime("%Y-%m-%d"))
        c = c.drop(columns="received_date").assign(date=c.date.dt.strftime("%Y-%m-%d"))
        feats = build_features(schools, enrolment, f, c, cal.assign(date=cal.date.dt.date))
        return service.add_week_index(feats, cal)

    if mode == "whole":
        feats = features(feeding, counts, days)
        for monday in mondays:
            if ((feats.date >= monday) & (feats.date <= monday + pd.Timedelta(days=6))).any():
                scorings[(monday.date(), (monday + pd.Timedelta(days=6)).date())] = (_slim(feats, monday), str(days.date.iloc[0].date()))
    else:
        for monday in mondays:
            sunday = monday + pd.Timedelta(days=6)
            in_week = feeding[(feeding.date >= monday) & (feeding.date <= sunday)]
            if in_week.empty:
                continue
            arrivals = sorted(d for d in in_week.received_date.unique() if sunday < d <= sunday + pd.Timedelta(days=rescore_days))
            moments = ([sunday] if (in_week.received_date <= sunday).any() else []) + list(arrivals)
            keep_terms = terms[(terms["max"] >= monday - pd.Timedelta(days=CALENDAR_DAYS)) & (terms["min"] <= sunday)].index
            cal = days[days.term_id.isin(keep_terms)].reset_index(drop=True)
            since = monday - pd.Timedelta(days=HISTORY_DAYS)
            for moment in moments:
                f = feeding[(feeding.received_date <= moment) & (feeding.date >= since) & (feeding.date <= sunday)]
                c = counts[(counts.received_date <= moment) & (counts.date >= since) & (counts.date <= sunday)]
                if not ((f.date >= monday)).any():
                    continue
                feats = features(f, c, cal)
                scorings[(monday.date(), moment.date())] = (_slim(feats, monday), str(cal.date.iloc[0].date()))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(pickle.dumps(scorings, protocol=5))
    return str(out_path)


_CALENDARS = {}


def calendar_for(data_dir, first_date):
    key = (str(data_dir), first_date)
    if key not in _CALENDARS:
        days = read(data_dir, "school_days", parse_dates=["date"])
        _CALENDARS[key] = days[days.date >= pd.Timestamp(first_date)].reset_index(drop=True)
    return _CALENDARS[key]


# -- the loop -------------------------------------------------------------------

def run(task):
    """One dataset, setting, model seed and q: every scoring's listings."""
    data_dir, config, model_seed, mode, sub_counties, start, end, per_request = task
    rows = []
    for sub_county in sub_counties:
        path = FEATURE_CACHE / Path(data_dir).parent.name / Path(data_dir).name / f"{mode}_{sub_county}.pkl"
        scorings = pickle.loads(path.read_bytes())
        labels = read(data_dir, "labels", parse_dates=["date"])
        labelled = set(zip(labels.school_id, labels.date.dt.strftime("%G-%V")))
        follow_up, cache = set(), ({} if not per_request else None)
        for (monday, moment) in sorted(scorings, key=lambda k: (k[1], k[0])):
            if not (pd.Timestamp(start) <= pd.Timestamp(monday) <= pd.Timestamp(end)):
                continue
            frame, cal_start = scorings[(monday, moment)]
            calendar = calendar_for(data_dir, cal_start)
            result = service.rank_week(frame, calendar, monday, k=K, follow_up=follow_up, config=config,
                                       model_seed=model_seed, cache=cache, explain=False)
            week = pd.Timestamp(monday).strftime("%G-%V")
            for item in result["items"]:
                rows.append((sub_county, week, item["school_id"], moment, item["score"], item["listed"], result["mode"]))
                if item["listed"] and (item["school_id"], week) in labelled:
                    follow_up.add((item["school_id"], week))
    return pd.DataFrame(rows, columns=["sub_county", "week", "school_id", "moment", "score", "listed", "mode"])


def collapse(scorings, universe):
    """One row per school-week: listed by any scoring, the day of the first listing, the last
    scoring's score."""
    s = scorings.sort_values("moment")
    last = s.groupby(["sub_county", "week", "school_id"]).score.last()
    listed = s[s.listed].groupby(["sub_county", "week", "school_id"]).moment.min().rename("listed_on")
    w = universe.join(last, on=["sub_county", "week", "school_id"]).join(listed, on=["sub_county", "week", "school_id"])
    w["listed"] = w.listed_on.notna()
    w["scored"] = w.score.notna()
    w["score"] = w.score.fillna(w.score.min() - 1 if w.score.notna().any() else 0)
    return w


def episodes_caught(weeks, data_dir, start, end):
    """Each episode: caught if a school-week it covers is listed. A stock leak is only visible
    at the next store count, which the labels mark as part of it (the generator), so for a
    leak the week of the first count after it ends counts too (plan amendment 1); caught_within
    keeps the episode's own weeks only, as steps 1-4 counted."""
    ep = read(data_dir, "episodes", parse_dates=["start", "end"])
    ep = ep[(ep.start >= pd.Timestamp(start)) & (ep.start <= pd.Timestamp(end))]
    counts = read(data_dir, "stock_counts", parse_dates=["date"])
    count_days = {s: np.sort(g.date.unique()) for s, g in counts.groupby("school_id")}
    by_school = {s: g for s, g in weeks.groupby("school_id")}
    out = []
    for e in ep.itertuples():
        covered = {d.strftime("%G-%V") for d in pd.date_range(e.start, e.end)}
        own = set(covered)
        if e.type == "stock_leakage":
            later = [d for d in count_days.get(e.school_id, []) if pd.Timestamp(d) > e.end]
            if later:
                covered.add(pd.Timestamp(later[0]).strftime("%G-%V"))
        w = by_school.get(e.school_id)
        hit = w[w.week.isin(covered) & w.listed] if w is not None else pd.DataFrame()
        first_week_end = (e.start + pd.Timedelta(days=6 - e.start.weekday())).date()
        days = (min(hit.listed_on) - first_week_end).days if len(hit) else None
        out.append({"type": e.type, "caught": len(hit) > 0, "caught_within": bool(len(hit) and hit.week.isin(own).any()),
                    "days_to_catch": days})
    return pd.DataFrame(out, columns=["type", "caught", "caught_within", "days_to_catch"])


def measure(weeks, eps):
    m = v7.measure(weeks, K)
    within = [average_precision_score(g.anomalous, g.score) for _, g in weeks.groupby("sub_county") if g.anomalous.any()]
    days = pd.to_numeric(eps.days_to_catch, errors="coerce")
    return {
        "precision_at_k": m["precision_at_k"], "recall_at_k": m["recall_at_k"], "f1_at_k": m["f1_at_k"],
        "pr_auc": float(average_precision_score(weeks.anomalous, weeks.score)) if weeks.anomalous.any() else np.nan,
        "pr_auc_within_sub_county": float(np.mean(within)) if within else np.nan,
        "problems_caught": float(eps.caught.mean()) if len(eps) else np.nan,
        "problems_caught_in_own_weeks": float(eps.caught_within.mean()) if len(eps) else np.nan,
        "problems_caught_within_2_weeks": float((eps.caught & (days <= 14)).mean()) if len(eps) else np.nan,
        "median_days_to_catch": float(days[eps.caught].median()) if eps.caught.any() else np.nan,
        "false_listings_per_officer_term": m["false_listings_per_officer_term"],
        "listings_per_officer_week": m["listings_per_officer_week"],
        "school_weeks_never_scored": float((~weeks.scored).mean()),
        "listed_by_type": m["listed_by_type"],
        "caught_by_type": eps.groupby("type").caught.mean().round(4).to_dict() if len(eps) else {},
    }


NUMERIC = ["precision_at_k", "recall_at_k", "f1_at_k", "pr_auc", "pr_auc_within_sub_county", "problems_caught",
           "problems_caught_in_own_weeks",
           "problems_caught_within_2_weeks", "median_days_to_catch", "false_listings_per_officer_term",
           "listings_per_officer_week", "school_weeks_never_scored"]


def evaluate(config, datasets, seeds, mode, start, end, period, workers, per_request=False, loop_start=None):
    """Every dataset x model seed for one config. period: what is measured; the loop runs from
    loop_start (default start)."""
    loop_start = loop_start or start
    tasks, keys = [], []
    for d in datasets:
        sub_counties = sorted(read(d, "schools").sub_county.unique())
        for s in seeds:
            tasks.append((str(d), config, s, mode, sub_counties, loop_start, end, per_request))
            keys.append((d, s))
    with ProcessPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(run, tasks))
    rows, universes, weeks_all = [], {}, []
    for (d, s), scorings in zip(keys, results):
        if d not in universes:
            universes[d] = school_weeks(d, period["start"], period["end"])
        w = collapse(scorings, universes[d])
        eps = episodes_caught(w, d, period["start"], period["end"])
        rows.append({"dataset": Path(d).name, "seed": s, **measure(w, eps), "_eps": eps})
        weeks_all.append(w)
    return summarise(rows, weeks_all)


def summarise(rows, weeks_all):
    df = pd.DataFrame(rows)
    eps = pd.concat(list(df._eps), ignore_index=True)
    days = pd.to_numeric(eps.days_to_catch, errors="coerce")
    fair = v7.fairness(pd.concat(weeks_all, ignore_index=True), 1.5)
    by_dataset = df.groupby("dataset")[NUMERIC].mean()
    return {
        "mean": {**df[NUMERIC].mean().round(4).to_dict(),
                 "problems_caught": round(float(eps.caught.mean()), 4),
                 "problems_caught_in_own_weeks": round(float(eps.caught_within.mean()), 4),
                 "median_days_to_catch": float(days[eps.caught].median()) if eps.caught.any() else None,
                 "listed_by_type": pd.DataFrame(list(df.listed_by_type)).mean().round(4).to_dict(),
                 "caught_by_type": eps.groupby("type").caught.mean().round(4).to_dict(),
                 "fairness_max_ratio": round(max(v["false_listing_ratio"] for v in fair["groups"].values()), 3),
                 "over_listed": fair["over_listed"], "episodes": int(len(eps))},
        "by_dataset": by_dataset.round(4).reset_index().to_dict(orient="records"),
    }


def paired_interval(a, b, measure="f1_at_k", n=2000):
    """Mean of b - a over datasets and a 95% interval from resampling the datasets."""
    da = {r["dataset"]: r[measure] for r in a["by_dataset"]}
    db = {r["dataset"]: r[measure] for r in b["by_dataset"]}
    diff = np.array([db[k] - da[k] for k in sorted(da)])
    rng = np.random.default_rng(0)
    means = [rng.choice(diff, len(diff)).mean() for _ in range(n)]
    return {"difference": round(float(diff.mean()), 4), "interval": [round(float(np.percentile(means, 2.5)), 4),
                                                                      round(float(np.percentile(means, 97.5)), 4)]}


# -- steps ----------------------------------------------------------------------

def plan():
    return yaml.safe_load(open(PLAN, encoding="utf-8"))


def q_value(q):
    return None if q == "none" else float(q)


def choose_q(config, datasets, seeds, period, workers, log, label, mode="point_in_time"):
    grid = plan()["threshold_grid"]
    results = {}
    for q in grid:
        r = evaluate(dict(config, review_quantile=q_value(q)), datasets, seeds, mode, period["start"], period["end"], period, workers)
        results[str(q)] = r
        print(f"  {label} q={q}: F1@3 {r['mean']['f1_at_k'] * 100:.1f}%  caught {r['mean']['problems_caught'] * 100:.1f}%", flush=True)
    best = max(results.values(), key=lambda r: r["mean"]["f1_at_k"])["mean"]["f1_at_k"]
    q_best = next(str(q) for q in grid if results[str(q)]["mean"]["f1_at_k"] >= best - 1e-12)
    log.append({"label": label, "config": config, "by_q": {q: r["mean"]["f1_at_k"] for q, r in results.items()}, "q": q_best})
    return dict(config, review_quantile=q_value(q_best)), results[q_best]


def adopt(current, current_result, candidate, candidate_result):
    rules = {}
    gain = (candidate_result["mean"]["f1_at_k"] - current_result["mean"]["f1_at_k"]) * 100
    interval = paired_interval(current_result, candidate_result)
    rules["f1_gain"] = gain >= 1.0
    rules["interval"] = interval["interval"][0] > 0
    rules["problems_caught"] = (candidate_result["mean"]["problems_caught"] - current_result["mean"]["problems_caught"]) * 100 >= -2.0
    rules["workload"] = (candidate_result["mean"]["false_listings_per_officer_term"]
                         - current_result["mean"]["false_listings_per_officer_term"]) <= 1.0
    rules["fairness"] = not candidate_result["mean"]["over_listed"]
    return all(rules.values()), {"gain_f1_points": round(gain, 2), "interval": interval, "rules": rules}


def prepare_features(datasets, start, end, workers, modes=("point_in_time",)):
    tasks = [(str(d), sc, start, end, m) for d in datasets for sc in sorted(read(d, "schools").sub_county.unique()) for m in modes]
    t = time.time()
    with ProcessPoolExecutor(max_workers=workers) as pool:
        list(pool.map(build_scorings, tasks))
    print(f"features ready: {len(tasks)} sub-county runs ({time.time() - t:.0f}s)", flush=True)


def dev_datasets():
    return [DEV_DATA / f"seed_{s}" for s in plan()["datasets"]["development"]["seeds"]]


def development(args):
    p = plan()
    period = p["datasets"]["development"]["period"]
    seeds = p["model_seeds"]["development"]
    datasets = dev_datasets()
    prepare_features(datasets, period["start"], period["end"], args.workers, modes=("point_in_time", "whole"))
    log, steps = [], {}
    started = time.time()

    print("step 1: version 8 as deployed and as evaluated", flush=True)
    deployed, r_deployed = choose_q(VERSION_8, datasets, seeds, period, args.workers, log, "as deployed")
    evaluated, r_evaluated = choose_q(EVALUATED, datasets, seeds, period, args.workers, log, "as evaluated")
    whole = {name: evaluate(cfg, datasets, seeds, "whole", period["start"], period["end"], period, args.workers)
             for name, cfg in (("as deployed", deployed), ("as evaluated", evaluated))}
    steps["1_measure_as_deployed"] = {"as_deployed": {"config": deployed, **r_deployed},
                                      "as_evaluated": {"config": evaluated, **r_evaluated},
                                      "whole_dataset_mode": whole}

    print("step 2: one model", flush=True)
    gain = (r_evaluated["mean"]["f1_at_k"] - r_deployed["mean"]["f1_at_k"]) * 100
    current, current_r = (evaluated, r_evaluated) if gain > 1.0 else (deployed, r_deployed)
    steps["2_one_model"] = {"gain_evaluated_over_deployed_f1_points": round(gain, 2),
                            "interval": paired_interval(r_deployed, r_evaluated),
                            "chosen": "as evaluated" if current is evaluated else "as deployed"}
    print(f"  {steps['2_one_model']['chosen']} ({gain:+.1f} points)", flush=True)

    for name, change in (("3_scaling_floor", {"scale_floor": True}), ("4_threshold_estimate", {"threshold": "harrell_davis"})):
        print(f"step {name}", flush=True)
        candidate, r_candidate = choose_q(dict(current, **change), datasets, seeds, period, args.workers, log, name)
        ok, detail = adopt(current, current_r, candidate, r_candidate)
        steps[name] = {"candidate": {"config": candidate, **r_candidate}, **detail, "adopted": ok}
        print(f"  {detail['gain_f1_points']:+.1f} points, interval {detail['interval']['interval']}: "
              f"{'adopted' if ok else 'not adopted'} {detail['rules']}", flush=True)
        if ok:
            current, current_r = candidate, r_candidate

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(REPORT_DIR / "development.json", {"plan": "forecasting/config/anomaly_v11.yaml", "steps": steps, "q_log": log,
                                                 "final_setting": current, "final": current_r,
                                                 "runtime_seconds": round(time.time() - started)})
    print("final setting:", current, flush=True)


def amendment(args):
    """Plan amendment 1: version 8 re-measured with the corrected count of leaks caught, then
    steps 5 and 6 against it, then 8 weeks of rescoring, reported only."""
    p = plan()
    period = p["datasets"]["development"]["period"]
    seeds = p["model_seeds"]["development"]
    datasets = dev_datasets()
    prepare_features(datasets, period["start"], period["end"], args.workers)
    dev = json.load(open(REPORT_DIR / "development.json", encoding="utf-8"))
    current = dict(VERSION_8, **dev["final_setting"])
    started = time.time()
    log, steps = [], {}
    current_r = evaluate(current, datasets, seeds, "point_in_time", period["start"], period["end"], period, args.workers)
    steps["remeasure"] = {"config": current, **current_r, "f1_at_k_in_steps_1_4": dev["final"]["mean"]["f1_at_k"]}
    print(f"version 8 re-measured: F1@3 {current_r['mean']['f1_at_k'] * 100:.2f}% (steps 1-4: "
          f"{dev['final']['mean']['f1_at_k'] * 100:.2f}%), caught {current_r['mean']['problems_caught'] * 100:.1f}% "
          f"(own weeks only {current_r['mean']['problems_caught_in_own_weeks'] * 100:.1f}%)", flush=True)
    for name, change in (("5_two_week_score", {"weekly": "two_week_mean"}), ("6_window", {"window": MAX_WINDOW})):
        print(f"step {name}", flush=True)
        candidate, r_candidate = choose_q(dict(current, **change), datasets, seeds, period, args.workers, log, name)
        ok, detail = adopt(current, current_r, candidate, r_candidate)
        steps[name] = {"candidate": {"config": candidate, **r_candidate}, **detail, "adopted": ok}
        print(f"  {detail['gain_f1_points']:+.1f} points, interval {detail['interval']['interval']}: "
              f"{'adopted' if ok else 'not adopted'} {detail['rules']}", flush=True)
        if ok:
            current, current_r = candidate, r_candidate
    prepare_features(datasets, period["start"], period["end"], args.workers, modes=("point_in_time_56",))
    r56 = evaluate(current, datasets, seeds, "point_in_time_56", period["start"], period["end"], period, args.workers)
    steps["rescoring_56_days"] = {"reported_only": True, "config": current, **r56,
                                  "difference_from_28_days": {m: paired_interval(current_r, r56, m) for m in
                                                              ("f1_at_k", "problems_caught", "false_listings_per_officer_term")}}
    print(f"56 days of rescoring: F1@3 {r56['mean']['f1_at_k'] * 100:.1f}%  caught {r56['mean']['problems_caught'] * 100:.1f}%", flush=True)
    write_json(REPORT_DIR / "development_amendment.json", {"plan": "forecasting/config/anomaly_v11.yaml (amendment_1)",
                                                           "steps": steps, "q_log": log, "final_setting": current,
                                                           "final": current_r, "runtime_seconds": round(time.time() - started)})
    print("final setting:", current, flush=True)


def dev_final_setting():
    path = REPORT_DIR / "development_amendment.json"
    if not path.exists():
        raise SystemExit("Run --step amendment first")
    return json.load(open(path, encoding="utf-8"))["final_setting"]


def parity(args):
    """The cached model per refit point against a model fitted on every request, one dataset."""
    p = plan()
    period = p["datasets"]["development"]["period"]
    d = [dev_datasets()[0]]
    a = evaluate(VERSION_8, d, [1], "point_in_time", period["start"], period["end"], period, args.workers)
    b = evaluate(VERSION_8, d, [1], "point_in_time", period["start"], period["end"], period, args.workers, per_request=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(REPORT_DIR / "cache_check.json", {"dataset": d[0].name, "cached": a["mean"], "per_request": b["mean"]})
    print({k: (a["mean"][k], b["mean"][k]) for k in ("precision_at_k", "recall_at_k", "f1_at_k", "problems_caught")})


def robustness(args):
    final = dev_final_setting()
    deployed = VERSION_8
    datasets = sorted(p for p in ROBUSTNESS_DATA.iterdir() if p.is_dir())
    period = plan()["datasets"]["development"]["period"]
    prepare_features(datasets, period["start"], period["end"], args.workers)
    out = {}
    for name, cfg in (("version_8", deployed), ("final", final)):
        r = evaluate(cfg, datasets, [1, 2, 3], "point_in_time", period["start"], period["end"], period, args.workers)
        out[name] = r
    scen = {}
    for name in ("version_8", "final"):
        for row in out[name]["by_dataset"]:
            scen.setdefault(row["dataset"].rsplit("_", 1)[0], {}).setdefault(name, []).append(row["f1_at_k"])
    by_scenario = {s: {n: round(float(np.mean(v)), 4) for n, v in x.items()} for s, x in scen.items()}
    mean = {n: round(float(np.mean([by_scenario[s][n] for s in by_scenario])), 4) for n in ("version_8", "final")}
    worst = min((by_scenario[s]["final"] - by_scenario[s]["version_8"]) * 100 for s in by_scenario)
    passed = mean["final"] >= mean["version_8"] and worst >= -3.0
    write_json(REPORT_DIR / "robustness.json", {"by_scenario_f1": by_scenario, "mean_f1": mean, "worst_difference_points": round(worst, 2),
                                                "passed": passed, "results": out})
    print(by_scenario, mean, worst, "passed" if passed else "FAILED", flush=True)


def final(args):
    p = plan()
    frozen = p.get("frozen")
    if not frozen:
        raise SystemExit("The plan has no frozen setting: freeze and commit it first")
    from generate_feeding_dataset import CONFIG as BASE_CONFIG, generate
    base = yaml.safe_load(open(BASE_CONFIG, encoding="utf-8"))
    test = p["datasets"]["test"]
    datasets = []
    for seed in test["seeds"]:
        out = ROOT / "test" / f"seed_{seed}"
        if not (out / "labels.csv").exists():
            generate(dict(copy.deepcopy(base), seed=seed), out, quiet=True)
        datasets.append(out)
    period = test["period"]
    modes = ("point_in_time", "whole", "point_in_time_56")   # the last reported only (amendment 1)
    prepare_features(datasets, test["loop_from"], period["end"], args.workers, modes=modes)
    seeds = p["model_seeds"]["final"]
    setting = {k: frozen[k] for k in VERSION_8}
    results = {}
    for mode in modes:
        for name, cfg in (("version_8", VERSION_8), ("version_11", setting)):
            results[f"{name}_{mode}"] = evaluate(cfg, datasets, seeds, mode, test["loop_from"], period["end"], period,
                                                 args.workers)
            print(f"{name} {mode}: F1@3 {results[f'{name}_{mode}']['mean']['f1_at_k'] * 100:.1f}%", flush=True)
    diffs = {mode: {m: paired_interval(results[f"version_8_{mode}"], results[f"version_11_{mode}"], m) for m in NUMERIC}
             for mode in modes}
    write_json(REPORT_DIR / "final.json", {"frozen": frozen, "results": results, "differences": diffs})


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--step", required=True, choices=["development", "amendment", "parity", "robustness", "final"])
    parser.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    args = parser.parse_args()
    {"development": development, "amendment": amendment, "parity": parity, "robustness": robustness, "final": final}[args.step](args)


if __name__ == "__main__":
    main()
