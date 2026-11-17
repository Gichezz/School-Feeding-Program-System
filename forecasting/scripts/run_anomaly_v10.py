"""
Protocol version 10 (config/anomaly_v10.yaml, committed before it was run).

Development (default): steps 1-6 on the 10 development datasets (seeds 8001-8010), 2025
only, so no 2026 week of a development dataset is scored. Every run is cached on disk,
so an interrupted development run resumes where it stopped.
Robustness (--robustness): version 8 and the setting reached in development on the
robustness scenarios, with the deployment loop.
Final (--final): only with a frozen setting in the protocol; generates the 20 test
datasets (seeds 9101-9120) and scores each one's 2026 once, versions 8 and 10.

A setting is
  detectors     a list from: eif, over_recording, stock_variance (with carry N), rules
  combination   'eif_only' (version 8's exact rule), 'day_max' or 'independent'
  q             the shared review threshold
  persistence   the extended operating point

Outputs: data/reports/anomaly/v10/development.json, robustness.json, final.json
"""

import argparse
import copy
import hashlib
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

from anomaly.features import FEATURES  # noqa: E402
from anomaly.methods import METHODS  # noqa: E402
from anomaly.weekly import weekly_scores  # noqa: E402
from common import PROCESSED_DIR, REPORTS_DIR, write_json  # noqa: E402
from generate_feeding_dataset import generate  # noqa: E402
from run_anomaly_robustness import deep_merge  # noqa: E402
import run_anomaly_deployment_test as v7  # noqa: E402
import run_anomaly_v8 as v8  # noqa: E402

PLAN = FORECASTING_DIR / "config" / "anomaly_v10.yaml"
ROBUST_PLAN = FORECASTING_DIR / "config" / "anomaly_robustness.yaml"
REPORT_DIR = REPORTS_DIR / "anomaly" / "v10"
ROOT = PROCESSED_DIR / "feeding_deployment" / "v10"
CACHE = ROOT / "cache"
LOOP_START = "2025-01-06"
QGRID = ["0.95", "0.96", "0.97", "0.98", "0.99"]
V8 = {"detectors": ["eif"], "combination": "eif_only", "carry": 10, "persistence": False}
PERSIST = 0.90


def _mid_rank(sorted_ref, values):
    left = np.searchsorted(sorted_ref, values, side="left")
    right = np.searchsorted(sorted_ref, values, side="right")
    return (left + right) / (2 * len(sorted_ref))


def _detector(name, params, model_seed, carry):
    if name == "eif":
        m = METHODS["extended_isolation_forest"](**dict(params, random_state=model_seed))
        m.features = list(FEATURES)
        return m
    if name == "over_recording":
        return METHODS["over_recording"]()
    if name == "stock_variance":
        return METHODS["stock_variance"](carry=carry)
    if name == "rules":
        return METHODS["rules"]()
    raise ValueError(name)


class Fitted:
    """The detectors of one setting fitted on one training window, with their reference
    distributions (school-day and school-week scores in the window)."""

    def __init__(self, setting, params, model_seed, history, q):
        self.setting, self.q = setting, float(q)
        self.models, self.day_ref, self.week_ref = {}, {}, {}
        for d in setting["detectors"]:
            m = _detector(d, params, model_seed, setting["carry"]).fit(history)
            days = m.score(history)
            self.models[d] = m
            self.day_ref[d] = np.sort(days)
            self.week_ref[d] = np.sort(weekly_scores(history.assign(score=days)).to_numpy())
        if setting["combination"] == "day_max":
            comb = self._day_combined(history)
            self.comb_week_ref = np.sort(weekly_scores(history.assign(score=comb)).to_numpy())
        if setting["combination"] == "eif_only":
            hist = weekly_scores(history.assign(score=self.models["eif"].score(history)))
            self.raw_threshold = float(hist.quantile(self.q))
            self.raw_p90 = float(hist.quantile(PERSIST))

    def _day_pct(self, frame):
        return {d: _mid_rank(self.day_ref[d], m.score(frame)) for d, m in self.models.items()}

    def _day_combined(self, frame):
        return np.max(np.vstack(list(self._day_pct(frame).values())), axis=0)

    def week(self, rows):
        """For one week's school-days: per school, the ranking value, whether it qualifies,
        whether it is above the persistence level, and whether a day is flagged."""
        c = self.setting["combination"]
        if c == "eif_only":
            raw = weekly_scores(rows.assign(score=self.models["eif"].score(rows))).droplevel("week")
            out = pd.DataFrame({"value": raw, "qualifies": raw > self.raw_threshold, "high": raw > self.raw_p90,
                                "tie": raw})
            day_flag = self.models["eif"].score(rows) > np.quantile(self.day_ref["eif"], self.q)
        elif c == "day_max":
            comb = self._day_combined(rows)
            w = weekly_scores(rows.assign(score=comb)).droplevel("week")
            pct = pd.Series(_mid_rank(self.comb_week_ref, w.to_numpy()), index=w.index)
            out = pd.DataFrame({"value": pct, "qualifies": pct > self.q, "high": pct > PERSIST, "tie": pct})
            day_flag = comb > self.q
        else:   # independent
            pcts = {}
            for d, m in self.models.items():
                w = weekly_scores(rows.assign(score=m.score(rows))).droplevel("week")
                pcts[d] = pd.Series(_mid_rank(self.week_ref[d], w.to_numpy()), index=w.index)
            pcts = pd.DataFrame(pcts)
            best = pcts.max(axis=1)
            tie = pcts["eif"] if "eif" in pcts else best
            out = pd.DataFrame({"value": best, "qualifies": best > self.q, "high": best > PERSIST, "tie": tie})
            day_flag = self._day_combined(rows) > self.q
        return out, day_flag


def run(task):
    """One setting x dataset x model seed: every scored school-week, listed or not."""
    data_dir, setting, params, model_seed, q, dep, end = task
    feats = v7._dataset(data_dir, "capture")
    start, end = pd.Timestamp(LOOP_START), pd.Timestamp(end)
    k = dep["review_list"]["k"]
    rules = METHODS["rules"]()
    out, days_out = [], []
    rules_only_setting = setting["detectors"] == ["rules"]
    for sub_county, rows in feats.groupby("sub_county"):
        rows = rows.sort_values(["date", "school_id"])
        follow_up, fitted, next_refit = set(), None, None
        last_high, last_listed = {}, set()
        for week, wr in rows[(rows.date >= start) & (rows.date <= end)].groupby("week", sort=True):
            first = int(wr.day_index.min())
            if not rules_only_setting and (fitted is None or first >= next_refit):
                history = rows[(rows.day_index < first) & (rows.day_index >= first - dep["window_school_days"])]
                history = history[[(s, w) not in follow_up for s, w in zip(history.school_id, history.week)]]
                if history.day_index.nunique() < dep["min_history_school_days"]:
                    fitted = None
                else:
                    fitted = Fitted(setting, params, model_seed, history, q)
                    next_refit = first + dep["refit_every_school_days"]
            if rules_only_setting or fitted is None:
                r = wr.assign(score=rules.score(wr)).groupby("school_id").score.max()
                table = pd.DataFrame({"value": r, "qualifies": r > 0, "high": False, "tie": r})
                day_flag = rules.score(wr) > 0
            else:
                table, day_flag = fitted.week(wr)
            ranked = table[table.qualifies].sort_values(["value", "tie"], ascending=False)
            listed = list(ranked.index[:k])
            extended = list(listed)
            if setting["persistence"]:
                for s in table.sort_values(["value", "tie"], ascending=False).index:
                    if len(extended) >= k:
                        break
                    if s not in extended and table.high[s] and last_high.get(s) and s not in last_listed:
                        extended.append(s)
            labels = wr.groupby("school_id").label.agg(lambda x: sorted(set(x) - {""}))
            info = wr.groupby("school_id").agg(in_outage=("in_outage", "max"), size_group=("size_group", "first"),
                                                programme_group=("programme_group", "first"), sync_group=("sync_group", "first"))
            for s in table.index:
                types = labels[s]
                out.append({"sub_county": sub_county, "week": week, "school_id": s, "value": float(table.value[s]),
                            "listed": s in extended, "standard_listed": s in listed, "anomalous": bool(types), "types": types,
                            "in_outage": bool(info.in_outage[s]), "size_group": info.size_group[s],
                            "programme_group": info.programme_group[s], "sync_group": info.sync_group[s]})
                if s in extended and types and dep["exclude_follow_up_from_training"]:
                    follow_up.add((s, week))
            days_out.append(pd.DataFrame({"week": week, "flag": np.asarray(day_flag, dtype=bool),
                                          "problem": (wr.label != "").to_numpy()}))
            last_high, last_listed = table.high.to_dict(), set(extended)
    return pd.DataFrame(out), pd.concat(days_out, ignore_index=True)


def key(setting, data_dir, model_seed, q, end):
    raw = json.dumps([setting, str(data_dir), model_seed, q, end], sort_keys=True)
    return hashlib.sha1(raw.encode()).hexdigest()


def _cached(task):
    path = CACHE / f"{key(task[1], task[0], task[3], task[4], task[6])}.pkl"
    if path.exists():
        return pickle.loads(path.read_bytes())
    result = run(task)
    path.write_bytes(pickle.dumps(result))
    return result


def runs(setting, q, datasets, params, plan, dep, end, workers):
    """{(dataset, model_seed): (weeks, days)} for one setting and q, using the cache."""
    CACHE.mkdir(parents=True, exist_ok=True)
    tasks = [(str(d), setting, params, s, q, dep, end) for d in datasets.values() for s in plan["model_seeds"]]
    names = [(n, s) for n in datasets for s in plan["model_seeds"]]
    with ProcessPoolExecutor(max_workers=workers) as pool:
        results = list(pool.map(_cached, tasks))
    return dict(zip(names, results))


def measures(results, datasets, period, k, limit, listed_col="listed"):
    rows, episodes, parts = [], [], []
    for (name, seed), (weeks, days) in results.items():
        w = v7.split(weeks, {"p": period})["p"].copy()
        w["listed"] = w[listed_col]
        m = v7.measure(w, k)
        dd = days[days.week.isin(set(w.week))]
        tp, fp, fn = int((dd.flag & dd.problem).sum()), int((dd.flag & ~dd.problem).sum()), int((~dd.flag & dd.problem).sum())
        day_f1 = 2 * tp / (2 * tp + fp + fn) if tp else 0.0
        pr_auc = average_precision_score(w.anomalous, w.value) if w.anomalous.any() else np.nan
        e = v8.episodes_caught(w, datasets[name], period).assign(dataset=name, seed=seed)
        episodes.append(e)
        parts.append(w)
        rows.append({"dataset": name, "seed": seed, "precision_at_k": m["precision_at_k"], "recall_at_k": m["recall_at_k"],
                     "f1_at_k": m["f1_at_k"], "pr_auc": pr_auc, "day_level_f1": day_f1,
                     "false_listings_per_officer_term": m["false_listings_per_officer_term"],
                     "listings_per_officer_week": m["listings_per_officer_week"], "listed_by_type": m["listed_by_type"]})
    df = pd.DataFrame(rows)
    ep = pd.concat(episodes, ignore_index=True)
    ep["weeks_to_catch"] = pd.to_numeric(ep.weeks_to_catch, errors="coerce")
    summary = v8.episode_summary([ep])
    numeric = ["precision_at_k", "recall_at_k", "f1_at_k", "pr_auc", "day_level_f1", "false_listings_per_officer_term",
               "listings_per_officer_week"]
    by_dataset = []
    for name, g in df.groupby("dataset"):
        e = ep[ep.dataset == name]
        by_dataset.append({"dataset": name, **g[numeric].mean().to_dict(), "problems_caught": float(e.caught.mean()),
                           "problems_caught_within_2_weeks": float((e.caught & (e.weeks_to_catch <= 1)).mean())})
    fair = v7.fairness(pd.concat(parts, ignore_index=True), limit)
    return {"mean": {**df[numeric].mean().round(4).to_dict(), "problems_caught": round(summary["episodes_caught"], 4),
                     "problems_caught_within_2_weeks": round(summary["episodes_caught_within_2_weeks"], 4),
                     "median_weeks_to_catch": summary["median_weeks_to_catch"],
                     "listed_by_type": pd.DataFrame(list(df.listed_by_type)).mean().round(4).to_dict(),
                     "caught_by_type": summary["caught_by_type"],
                     "fairness_max_ratio": round(max(v["false_listing_ratio"] for v in fair["groups"].values()), 3),
                     "over_listed": fair["over_listed"]},
            "by_dataset": by_dataset, "fairness": fair, "episodes": summary["episodes"]}


def label(s):
    d = "+".join(x if x != "stock_variance" else f"stock_variance({s['carry']})" for x in s["detectors"])
    return f"{d} [{s['combination']}]" + (" +persistence" if s["persistence"] else "")


def make_datasets(seeds, folder, base):
    out = {}
    for seed in seeds:
        path = ROOT / folder / f"seed_{seed}"
        if not (path / "labels.csv").exists():
            generate(dict(copy.deepcopy(base), seed=seed), path, quiet=True)
        out[f"seed_{seed}"] = path
    return out


def setup():
    plan = yaml.safe_load(open(PLAN, encoding="utf-8"))
    dep_plan = yaml.safe_load(open(v7.PLAN, encoding="utf-8"))
    params = json.load(open(v7.EVALUATION, encoding="utf-8"))["results"]["extended_isolation_forest"]["params"]
    base = yaml.safe_load(open(FORECASTING_DIR.parent / dep_plan["datasets"]["main"], encoding="utf-8"))
    return plan, dep_plan, params, base


def development(args):
    plan, dep_plan, params, base = setup()
    dep, k, limit = dep_plan["deployment"], dep_plan["deployment"]["review_list"]["k"], dep_plan["fairness_v7"]["over_listed_ratio"]
    period = {"start": "2025-01-06", "end": "2025-12-31"}
    datasets = make_datasets(plan["datasets"]["development"]["seeds"], "development", base)
    started = time.time()
    rules = plan["adoption_rules"]

    def evaluate(setting, q, listed_col="listed"):
        r = runs(setting, q, datasets, params, plan, dep, period["end"], args.workers)
        out = measures(r, datasets, period, k, limit, listed_col)
        m = out["mean"]
        print(f"  {label(setting)} q={q}: F1@3 {m['f1_at_k'] * 100:.1f}%, caught {m['problems_caught'] * 100:.1f}%, "
              f"PR-AUC {m['pr_auc']:.3f}, ordinary/term {m['false_listings_per_officer_term']:.1f} ({time.time() - started:.0f}s)", flush=True)
        return out, r

    def choose_q(setting):
        res = {q: evaluate(setting, q)[0] for q in QGRID}
        best = max(res[q]["mean"]["f1_at_k"] for q in QGRID)
        q = [q for q in QGRID if res[q]["mean"]["f1_at_k"] >= best - 1e-12][0]
        return q, res[q], {q_: res[q_]["mean"]["f1_at_k"] for q_ in QGRID}

    log = {}
    print("Step 1: baseline (version 8)", flush=True)
    q8, base8, grid8 = choose_q(V8)
    log["1_baseline"] = {"q": q8, "f1_by_q": grid8, **base8["mean"],
                         "by_size": {g: v for g, v in base8["fairness"]["groups"].items() if v["by"] == "size_group"},
                         "by_sub_county": {g: v for g, v in base8["fairness"]["groups"].items() if v["by"] == "sub_county"}}
    workload_limit = base8["mean"]["false_listings_per_officer_term"] + 1.0

    print("Step 2: complementarity", flush=True)
    singles = {"eif": dict(V8), "over_recording": {**V8, "detectors": ["over_recording"], "combination": "independent"},
               "stock_variance": {**V8, "detectors": ["stock_variance"], "combination": "independent"},
               "rules": {**V8, "detectors": ["rules"], "combination": "independent"}}
    listed = {}
    comp = {}
    for name, s in singles.items():
        res, raw = evaluate(s, "0.98")
        comp[name] = {"precision_at_k": res["mean"]["precision_at_k"], "recall_at_k": res["mean"]["recall_at_k"],
                      "f1_at_k": res["mean"]["f1_at_k"], "problems_caught": res["mean"]["problems_caught"],
                      "listed_by_type": res["mean"]["listed_by_type"]}
        frames = []
        for (dname, seed), (weeks, _) in raw.items():
            w = v7.split(weeks, {"p": period})["p"]
            frames.append(w.assign(dataset=dname, seed=seed)[["dataset", "seed", "sub_county", "week", "school_id", "listed", "anomalous", "types"]])
        listed[name] = pd.concat(frames, ignore_index=True)
    keycols = ["dataset", "seed", "school_id", "week"]
    base_frame = listed["eif"].set_index(keycols)
    total_problems = int(base_frame.anomalous.sum())
    others = {n: listed[n].set_index(keycols).listed for n in listed}
    for name in singles:
        mine = others[name]
        not_eif = mine & ~others["eif"].reindex(mine.index, fill_value=False)
        not_any = mine.copy()
        for other in singles:
            if other != name:
                not_any &= ~others[other].reindex(mine.index, fill_value=False)
        anom = base_frame.anomalous.reindex(mine.index, fill_value=False)
        types = base_frame.types.reindex(mine.index)
        comp[name].update({
            "problem_weeks_listed": int((mine & anom).sum()),
            "problem_weeks_not_listed_by_eif": int((not_eif & anom).sum()),
            "share_of_problem_weeks_not_listed_by_eif": round(float((not_eif & anom).sum() / total_problems), 4),
            "problem_weeks_listed_by_no_other": int((not_any & anom).sum()),
            "false_listings": int((mine & ~anom).sum()),
            "false_listings_not_listed_by_eif": int((not_eif & ~anom).sum()),
            "unique_by_type": {t: int(sum(1 for i in (not_eif & anom)[lambda x: x].index if t in types[i]))
                               for t in ("consumption_drift", "inflated_headcount", "stock_leakage")},
        })
    go = {n: comp[n]["share_of_problem_weeks_not_listed_by_eif"] >= 0.02 for n in ("over_recording", "stock_variance")}
    log["2_complementarity"] = {"total_problem_weeks": total_problems, "detectors": comp, "go": go}
    print("  go:", go, flush=True)

    current, current_res, q_cur = dict(V8), base8, q8

    def adopt(step, cand_setting):
        nonlocal current, current_res, q_cur
        qc, rc, grid = choose_q(cand_setting)
        gain = (rc["mean"]["f1_at_k"] - current_res["mean"]["f1_at_k"]) * 100
        checks = {"f1_margin": gain >= plan["adoption_rules"]["margins"][step],
                  "problems_caught_not_lower": rc["mean"]["problems_caught"] >= current_res["mean"]["problems_caught"] - 1e-12,
                  "workload_within_1": rc["mean"]["false_listings_per_officer_term"] <= workload_limit + 1e-12,
                  "fairness_within_1_5": not rc["mean"]["over_listed"]}
        ok = all(checks.values())
        entry = {"candidate": label(cand_setting), "q": qc, "f1_by_q": grid, "gain_f1_points": round(gain, 2),
                 "checks": checks, "adopted": ok, **rc["mean"]}
        if ok:
            current, current_res, q_cur = cand_setting, rc, qc
        print(f"  {label(cand_setting)}: {'ADOPTED' if ok else 'not adopted'} ({gain:+.1f}; {checks})", flush=True)
        return entry

    if go["over_recording"]:
        print("Step 3: combination", flush=True)
        cands = {}
        for comb in ("day_max", "independent"):
            s = {**V8, "detectors": ["eif", "over_recording"], "combination": comb}
            cands[comb] = (s, choose_q(s))
        better = max(cands, key=lambda c: cands[c][1][1]["mean"]["f1_at_k"])
        log["3_combination"] = {"compared": {c: {"q": v[1][0], "f1_at_k": v[1][1]["mean"]["f1_at_k"]} for c, v in cands.items()},
                                "better": better, "decision": adopt("3_combination", cands[better][0])}
    else:
        log["3_combination"] = {"skipped": "over_recording did not pass step 2"}

    if go["stock_variance"]:
        print("Step 4: stock variance", flush=True)
        comb = current["combination"] if current["combination"] != "eif_only" else "independent"
        dets = current["detectors"] if current["combination"] != "eif_only" else ["eif"]
        by_n = {}
        for n in (5, 10, 20):
            s = {**V8, "detectors": dets + ["stock_variance"], "combination": comb, "carry": n}
            by_n[n] = (s, evaluate(s, q_cur)[0]["mean"]["f1_at_k"])
        n_best = max(by_n, key=lambda n: by_n[n][1])
        log["4_stock_variance"] = {"f1_by_carry_at_current_q": {n: v[1] for n, v in by_n.items()}, "carry": n_best,
                                   "decision": adopt("4_stock_variance", by_n[n_best][0])}
    else:
        log["4_stock_variance"] = {"skipped": "stock_variance did not pass step 2"}

    print("Step 5: threshold", flush=True)
    q5, r5, grid5 = choose_q(current)
    log["5_threshold"] = {"setting": label(current), "q": q5, "f1_by_q": grid5, **r5["mean"]}

    print("Step 6: persistence (extended operating point)", flush=True)
    ext = {**current, "persistence": True}
    r6, _ = evaluate(ext, q5)
    r6s = measures(runs(ext, q5, datasets, params, plan, dep, period["end"], args.workers), datasets, period, k, limit, "standard_listed")
    log["6_persistence"] = {"extended": r6["mean"], "standard_in_the_same_run": r6s["mean"],
                            "extra_ordinary_per_officer_term": round(r6["mean"]["false_listings_per_officer_term"] - r5["mean"]["false_listings_per_officer_term"], 2)}

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(REPORT_DIR / "development.json", {"plan": "config/anomaly_v10.yaml", "period": period, "steps": log,
                                                 "reached": {**current, "q": q5}, "runtime_seconds": round(time.time() - started)})
    print("Reached:", label(current), "q =", q5, flush=True)


def robustness(args):
    plan, dep_plan, params, base = setup()
    dep, k, limit = dep_plan["deployment"], dep_plan["deployment"]["review_list"]["k"], dep_plan["fairness_v7"]["over_listed_ratio"]
    reached = json.load(open(REPORT_DIR / "development.json", encoding="utf-8"))["reached"]
    q10 = reached.pop("q")
    q8 = json.load(open(REPORT_DIR / "development.json", encoding="utf-8"))["steps"]["1_baseline"]["q"]
    rp = yaml.safe_load(open(ROBUST_PLAN, encoding="utf-8"))
    period = {"start": "2025-01-06", "end": "2026-10-23"}
    out = {}
    for scenario, spec in rp["scenarios"].items():
        cfg = deep_merge(copy.deepcopy(base), spec.get("overrides", {}) or {})
        datasets = {}
        for seed in rp["seeds"]:
            path = ROOT / "robustness" / f"{scenario}_{seed}"
            if not (path / "labels.csv").exists():
                generate(dict(copy.deepcopy(cfg), seed=seed), path, quiet=True)
            datasets[f"{scenario}_{seed}"] = path
        small = dict(plan, model_seeds=plan["model_seeds"][:3])
        res = {}
        for name, s, q in (("version_8", V8, q8), ("version_10", reached, q10)):
            res[name] = measures(runs(s, q, datasets, params, small, dep, period["end"], args.workers), datasets, period, k, limit)["mean"]["f1_at_k"]
        out[scenario] = res
        print(scenario, res, flush=True)
    mean8 = np.mean([v["version_8"] for v in out.values()])
    mean10 = np.mean([v["version_10"] for v in out.values()])
    worst = min((v["version_10"] - v["version_8"]) * 100 for v in out.values())
    passed = mean10 >= mean8 - 1e-12 and worst >= -3.0
    write_json(REPORT_DIR / "robustness.json", {"by_scenario": out, "mean_version_8": round(float(mean8), 4),
                                                "mean_version_10": round(float(mean10), 4), "worst_difference_points": round(worst, 2),
                                                "passed": bool(passed), "period": period})
    print("passed" if passed else "FAILED", round(mean8, 4), round(mean10, 4), round(worst, 2))


def bootstrap(values, n=2000):
    rng = np.random.default_rng(0)
    values = np.asarray(values, dtype=float)
    means = [rng.choice(values, len(values)).mean() for _ in range(n)]
    return [round(float(np.percentile(means, 2.5)), 4), round(float(np.percentile(means, 97.5)), 4)]


def final(args):
    plan, dep_plan, params, base = setup()
    frozen = plan.get("frozen")
    if not frozen:
        raise SystemExit("No frozen setting in the protocol: freeze version 10 before the final test.")
    dep, k, limit = dep_plan["deployment"], dep_plan["deployment"]["review_list"]["k"], dep_plan["fairness_v7"]["over_listed_ratio"]
    period = plan["datasets"]["test"]["period"]
    period = {"start": str(period["start"]), "end": str(period["end"])}
    datasets = make_datasets(plan["datasets"]["test"]["seeds"], "test", base)
    setting = {x: frozen[x] for x in ("detectors", "combination", "carry", "persistence")}
    versions = {}
    for name, s, q in (("version_8", V8, "0.98"), ("version_10", setting, str(frozen["q"]))):
        if name == "version_10" and s == V8 and q == "0.98":
            versions[name] = versions["version_8"]
            continue
        versions[name] = measures(runs(s, q, datasets, params, plan, dep, period["end"], args.workers), datasets, period, k, limit)
        print(name, versions[name]["mean"], flush=True)
    if frozen.get("extended_persistence"):
        ext = {**setting, "persistence": True}
        versions["version_10_extended"] = measures(runs(ext, str(frozen["q"]), datasets, params, plan, dep, period["end"], args.workers),
                                                   datasets, period, k, limit)
    names = ["precision_at_k", "recall_at_k", "f1_at_k", "pr_auc", "day_level_f1", "problems_caught",
             "problems_caught_within_2_weeks", "false_listings_per_officer_term", "listings_per_officer_week"]
    summary = {}
    for v, r in versions.items():
        bd = pd.DataFrame(r["by_dataset"]).set_index("dataset")
        summary[v] = {m: {"mean": round(float(bd[m].mean()), 4), "sd": round(float(bd[m].std()), 4), "ci95": bootstrap(bd[m])} for m in names}
    d8 = pd.DataFrame(versions["version_8"]["by_dataset"]).set_index("dataset")
    d10 = pd.DataFrame(versions["version_10"]["by_dataset"]).set_index("dataset")
    diff = {m: {"mean": round(float((d10[m] - d8[m]).mean()), 4), "ci95": bootstrap(d10[m] - d8[m])} for m in names}
    write_json(REPORT_DIR / "final.json", {"frozen": frozen, "period": period, "datasets": list(datasets),
                                           "versions": versions, "summary": summary, "difference_v10_minus_v8": diff})
    print(json.dumps({"summary": summary, "difference": diff}, indent=1))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--final", action="store_true")
    parser.add_argument("--robustness", action="store_true")
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()
    (final if args.final else robustness if args.robustness else development)(args)


if __name__ == "__main__":
    main()
