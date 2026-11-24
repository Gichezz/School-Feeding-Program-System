"""
Protocol version 12 (config/anomaly_v12.yaml, committed before any of its data existed).

  --step data         generate the development, validation and count-interval datasets
  --step features     build the point-in-time scorings (56-day window) for them
  --step parity       the harness against services.scoring_service.rank_week, version 11
  --step stage        run one stage's candidates (--stage S2|S3|M1|M2|M3)
  --step validate     a stage's result on the validation datasets, once
  --step final        the final datasets (generated after the final freeze), once

Outputs: data/reports/anomaly/v12/*.json and v12_report.md

Usage
  python forecasting/scripts/run_anomaly_v12.py --step features --workers 3
"""

import argparse
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

FORECASTING_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(FORECASTING_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import warnings  # noqa: E402
warnings.filterwarnings("ignore")

import json  # noqa: E402

import yaml  # noqa: E402

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402

import run_anomaly_v11 as h  # noqa: E402
from anomaly import evaluation_v12 as ev  # noqa: E402
from common import PROCESSED_DIR, REPORTS_DIR, write_json  # noqa: E402
from services import scoring_service as service  # noqa: E402

PLAN = FORECASTING_DIR / "config" / "anomaly_v12.yaml"
ROOT = PROCESSED_DIR / "feeding_deployment" / "v12"
FEATURE_CACHE = ROOT / "features"
REPORT_DIR = REPORTS_DIR / "anomaly" / "v12"
WINDOW_DAYS = 56
LOOP_FROM, START, END = "2025-07-07", "2026-01-01", "2026-12-31"

DATASETS = {
    "development": ("8101-8130", 20),
    "validation": ("8201-8220", 20),
    "count10": ("8101-8115", 10),
    "count5": ("8101-8115", 5),
}


def seeds(spec):
    a, b = (int(x) for x in spec.split("-"))
    return range(a, b + 1)


def dataset_dirs(name):
    spec, _ = DATASETS[name]
    return [ROOT / name / f"seed_{s}" for s in seeds(spec)]


def step_data(args):
    gen = FORECASTING_DIR / "scripts" / "generate_feeding_dataset_realistic.py"
    for name in args.datasets.split(","):
        spec, every = DATASETS[name]
        subprocess.run([sys.executable, str(gen), "--out", str(ROOT / name), "--seeds", spec,
                        "--count-every", str(every), "--workers", str(args.workers)], check=True)


def _build(task):
    h.RESCORE_DAYS = WINDOW_DAYS
    return h.build_scorings(task)


def step_features(args):
    tasks = []
    for name in args.datasets.split(","):
        for d in dataset_dirs(name):
            for sc in sorted(h.read(d, "schools").sub_county.unique()):
                tasks.append((str(d), sc, LOOP_FROM, END, "point_in_time", str(FEATURE_CACHE)))
    t = time.time()
    with ProcessPoolExecutor(args.workers) as pool:
        for i, _ in enumerate(pool.map(_build, tasks), 1):
            if i % 20 == 0:
                print(f"built {i}/{len(tasks)} in {time.time() - t:.0f}s", flush=True)
    print(f"built {len(tasks)} scorings files in {time.time() - t:.0f}s", flush=True)


# -- evaluation -----------------------------------------------------------------------------

Q_GRID = [0.95, 0.97, 0.98, 0.985, 0.99, 0.995, 0.998, 0.999]
BUDGET = 2.5
RESULTS = ROOT / "results"
MEASURES = ["problem_f1", "problem_precision", "problem_recall", "one_day_claims_caught", "f1_at_k",
            "precision_at_k", "recall_at_k", "recall_at_k_covered", "pr_auc", "pr_auc_within_sub_county",
            "false_listings_per_officer_term", "false_from_shortfall_per_officer_term", "visits_per_officer_term",
            "problems_caught_within_2_weeks", "median_days_to_catch", *[f"caught_{t}" for t in ev.SIX_TYPES]]
TYPES7 = [f"caught_{t}" for t in ev.SIX_TYPES] + ["one_day_claims_caught"]


def _eval_task(task):
    data_dir, cfg, qs, model_seed, covers = task
    out = ev.run_dataset(data_dir, FEATURE_CACHE, cfg, qs, model_seed=model_seed, loop_start=LOOP_FROM,
                         start=START, end=END, calendar_for=h.calendar_for, read=h.read)
    uni = h.school_weeks(data_dir, START, END)
    schools = h.read(data_dir, "schools")
    rows = []
    for q, scorings in out.items():
        w = ev.collapse(scorings, uni)
        eps = h.episodes_caught(w, data_dir, START, END)
        row = {"dataset": Path(data_dir).name, "q": q, "model_seed": model_seed, **ev.measures(w, eps, schools)}
        for c in covers:
            m = ev.measures(w, eps, schools, cover=c)
            row[f"problem_f1_cover{c}"], row[f"problem_precision_cover{c}"] = m["problem_f1"], m["problem_precision"]
            row[f"recall_at_k_covered_cover{c}"] = m["recall_at_k_covered"]
        rows.append(row)
    return rows


def evaluate(cfg, datasets, workers, qs=Q_GRID, tag="dev", model_seed=1, covers=()):
    """Every dataset x q for one setting; cached by tag and setting name."""
    RESULTS.mkdir(parents=True, exist_ok=True)
    path = RESULTS / f"{tag}_{cfg['name']}_s{model_seed}.pkl"
    if path.exists():
        return pd.read_pickle(path)
    t = time.time()
    tasks = [(str(d), cfg, list(qs), model_seed, covers) for d in datasets]
    with ProcessPoolExecutor(workers) as pool:
        rows = [r for rs in pool.map(_eval_task, tasks) for r in rs]
    df = pd.DataFrame(rows)
    df.to_pickle(path)
    print(f"  {tag} {cfg['name']}: {len(tasks)} datasets in {time.time() - t:.0f}s", flush=True)
    return df


def at_workload(df, budget=BUDGET, q=None):
    """Each dataset's measures at the q that gives `budget` false listings per officer-term on
    average (or at a given q), by linear interpolation over the grid."""
    mean = df.groupby("q").false_listings_per_officer_term.mean().sort_index()
    qs = mean.index.to_numpy()
    reached = True
    if q is None:
        fl = mean.to_numpy()
        if budget > fl.max() or budget < fl.min():
            reached = False
            q = float(qs[np.argmin(np.abs(fl - budget))])
        else:
            q = float(np.interp(-budget, -fl, qs))     # false listings fall as q rises
    out = []
    cols = [c for c in df.columns if c not in ("dataset", "q", "model_seed") and pd.api.types.is_numeric_dtype(df[c])]
    for d, g in df.groupby("dataset"):
        g = g.sort_values("q")
        out.append({"dataset": d, **{c: float(np.interp(q, g.q, g[c])) for c in cols}})
    res = pd.DataFrame(out).set_index("dataset")
    res.attrs.update(q=q, reached=reached)
    return res


def floor(df):
    return float(df.groupby("q").false_listings_per_officer_term.mean().min())


def common(df_a, df_b, budget=BUDGET):
    """Amendment 1: both settings at one workload, 2.5 or the lowest level both can reach."""
    level = max(budget, floor(df_a), floor(df_b))
    return at_workload(df_a, level), at_workload(df_b, level), level


def paired(a, b, col, n=4000, seed=0):
    """Mean of b - a over datasets, its 95% bootstrap interval and the share of datasets won."""
    d = (b[col] - a[col]).dropna().to_numpy()
    if not len(d):
        return {"diff": np.nan, "lo": np.nan, "hi": np.nan, "won": np.nan}
    rng = np.random.default_rng(seed)
    boot = d[rng.integers(0, len(d), (n, len(d)))].mean(axis=1)
    return {"diff": float(d.mean()), "lo": float(np.quantile(boot, 0.025)), "hi": float(np.quantile(boot, 0.975)),
            "won": float((d > 0).mean())}


def decide(base, cand, exempt_week_f1=False):
    """The protocol's adoption rule (points are percentage points)."""
    f1 = paired(base, cand, "problem_f1")
    checks = {
        "problem_f1_gain": f1["diff"] * 100 >= 1.0 and f1["lo"] > 0,
        "problem_recall": paired(base, cand, "problem_recall")["diff"] * 100 >= -2.0,
        "types": all(not (cand[c].mean() * 100 < base[c].mean() * 100 - 10) for c in TYPES7
                     if c in cand and not np.isnan(base[c].mean())),
        "week_f1": exempt_week_f1 or paired(base, cand, "f1_at_k")["diff"] * 100 >= -2.0,
    }
    return all(checks.values()), checks, f1


def summary(res, raw=None):
    s = {c: float(res[c].mean()) for c in res.columns}
    s.update(q=res.attrs.get("q"), reached=res.attrs.get("reached"))
    if raw is not None:
        s["lowest_workload"] = floor(raw)
    return s


def comparison(base, cand):
    return {c: paired(base, cand, c) for c in MEASURES if c in base and c in cand}


# -- settings and stages --------------------------------------------------------------------

BASELINES = {
    "V8_28": {"one_sided": False, "shortfall": False, "window": 28},
    "V8_56": {"one_sided": False, "shortfall": False},
    "V11_28": {"window": 28},
    "V11_56": {},
}
STATE = RESULTS / "state.json"


def setting(name, **kw):
    return {"name": name, **kw}


def combine(current, delta):
    """A candidate's change applied to the current setting (features left out and features
    added accumulate)."""
    out = {k: v for k, v in current.items()}
    for k, v in delta.items():
        if k in ("drop", "extras"):
            out[k] = sorted(set(out.get(k, [])) | set(v))
        elif k != "name":
            out[k] = v
    return out


def candidates(stage):
    if stage == "S2":
        return {"S2_suppress": {"suppress": True}}
    if stage == "M1":
        c = {"M1a_scale_floor": {"scale_floor": True}}
        for f in ("fed_rate", "fed_vs_own", "fed_vs_peers", "fed_rate_vs_last_term", "uptake", "enrolment_change"):
            c[f"M1b_drop_{f}"] = {"drop": [f]}
        c["M1c_low_headcount"] = {"two_sided": ["fed_rate", "fed_rate_vs_last_term"]}
        c["M1d_sample_256"] = {"sample": 256}
        c["M1d_sample_128"] = {"sample": 128}
        return c
    if stage == "M2":
        return {"M2a_split": {"model": "split"}, "M2b_split_no_shortfall": {"model": "split", "shortfall": False}}
    if stage == "M3":
        return {"M3a_cusum": {"extras": [f"cusum_{f}" for f in ev.TEMPORAL_BASE]},
                "M3b_rolling_means": {"extras": [f"mean{n}_{f}" for n in (5, 10, 20) for f in ev.TEMPORAL_BASE]},
                "M3c_existing_candidates": {"extras": ["fed_vs_peers_trend", "fed_rate_vs_last_term_trend"]},
                "M3d_weekly_peak": {"agg": "top1"},
                "M3e_weekly_persistence": {"agg": "mean"}}
    raise ValueError(stage)


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text())
    return {"current": setting("V11_56"), "stages": {}}


def save_state(state):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(state, indent=2))


def name_of(cfg):
    keys = sorted(k for k in cfg if k != "name")
    return "cur_" + "_".join(f"{k}-{'+'.join(map(str, v)) if isinstance(v, list) else v}" for k, v in ((k, cfg[k]) for k in keys)) if keys else "V11_56"


def run_stage(stage, base_cfg, cands, datasets, tag, workers, exempt_week_f1=False, datasets_for=None):
    """Each candidate against the stage's start, then the passing ones combined in order of gain."""
    base_raw = evaluate(base_cfg, datasets, workers, tag=tag)
    base_alone = at_workload(base_raw)
    record = {"stage": stage, "start": base_cfg, "start_result": summary(base_alone, base_raw), "candidates": {}}
    passing, results = [], {}
    for cname, delta in cands.items():
        cfg = combine(base_cfg, delta)
        cfg["name"] = name_of(cfg)
        raw = evaluate(cfg, datasets, workers, tag=tag)
        results[cname] = raw
        base, res, level = common(base_raw, raw)
        ok, checks, f1 = decide(base, res, exempt_week_f1)
        record["candidates"][cname] = {"change": delta, "workload": level, "result": summary(res, raw),
                                       "start_at_same_workload": summary(base, base_raw),
                                       "against_start": comparison(base, res), "checks": checks, "adopted_alone": ok}
        print(f"{cname}: problem F1 {res.problem_f1.mean():.3f} vs {base.problem_f1.mean():.3f} "
              f"({f1['diff'] * 100:+.1f}, {f1['lo'] * 100:+.1f} to {f1['hi'] * 100:+.1f}) workload {level:.2f} "
              f"q {res.attrs['q']:.4f} vs {base.attrs['q']:.4f} pass={ok}", flush=True)
        if ok:
            passing.append((f1["diff"], cname, delta))
    current, cur_raw = dict(base_cfg), base_raw
    kept = []
    for _, cname, delta in sorted(passing, key=lambda x: -x[0]):
        cfg = combine(current, delta)
        cfg["name"] = name_of(cfg)
        # the first is the candidate alone, already run
        raw = results[cname] if not kept else evaluate(cfg, datasets, workers, tag=tag)
        prev, res, level = common(cur_raw, raw)
        ok, checks, f1 = decide(prev, res, exempt_week_f1)
        record.setdefault("combination", []).append({"added": cname, "setting": cfg, "checks": checks, "workload": level,
                                                     "kept": ok, "against_previous": comparison(prev, res)})
        if ok:
            current, cur_raw = cfg, raw
            kept.append(cname)
    record["kept"] = kept
    record["result_setting"] = current
    base, res, level = common(base_raw, cur_raw)
    record["result"] = summary(res, cur_raw)
    record["result_against_start"] = {"workload": level, **comparison(base, res)}
    return record, current, base, res


def step_parity(args):
    """Version 11 through the v12 loop against services.scoring_service.rank_week (the v11
    harness's run), q 0.99, two development datasets: the listings must be identical."""
    h.FEATURE_CACHE = FEATURE_CACHE
    out = {}
    for d in dataset_dirs("development")[:2]:
        scs = sorted(h.read(d, "schools").sub_county.unique())
        ref = h.run((str(d), dict(service.CONFIG), 1, "point_in_time", scs, LOOP_FROM, END, False))
        ref = ref[ref.week >= "2026-01"]
        mine = ev.run_dataset(str(d), FEATURE_CACHE, {"name": "V11_56"}, [service.CONFIG["review_quantile"]],
                              loop_start=LOOP_FROM, start=START, end=END, calendar_for=h.calendar_for, read=h.read)
        mine = next(iter(mine.values()))
        a = set(map(tuple, ref[ref.listed][["week", "school_id", "moment"]].astype(str).values))
        b = set(map(tuple, mine[mine.listed][["week", "school_id", "moment"]].astype(str).values))
        out[d.name] = {"service_listings": len(a), "harness_listings": len(b), "only_service": len(a - b), "only_harness": len(b - a)}
        print(d.name, out[d.name], flush=True)
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(REPORT_DIR / "parity.json", out)


def protocol_text(stage):
    plan = yaml.safe_load(PLAN.read_text(encoding="utf-8"))
    for group in plan["stages"].values():
        for key, value in group.items():
            if key.startswith(stage):
                return value
    return None


def step_stage(args):
    state = load_state()
    stage = args.stage
    base_cfg = state["current"]
    dev = dataset_dirs("development")
    if stage == "baselines":
        rec = {}
        raws = {n: evaluate(setting(n, **kw), dev, args.workers, covers=(2, 8)) for n, kw in BASELINES.items()}
        res = {n: at_workload(r) for n, r in raws.items()}
        for n, r in res.items():
            rec[n] = summary(r, raws[n])
            print(n, {k: round(rec[n][k], 3) for k in ("q", "problem_f1", "problem_precision", "problem_recall", "f1_at_k",
                                                       "precision_at_k", "recall_at_k", "pr_auc", "one_day_claims_caught",
                                                       "false_listings_per_officer_term")}, flush=True)
        for n in ("V8_28", "V8_56", "V11_28"):
            a, b, level = common(raws[n], raws["V11_56"])
            rec[f"V11_56_vs_{n}"] = {"workload": level, n: summary(a), "V11_56": summary(b), **comparison(a, b)}
        for n, kw in BASELINES.items():   # as committed: version 8 at q 0.98, version 11 at q 0.99
            q = 0.98 if n.startswith("V8") else 0.99
            rec[f"{n}_as_committed_q"] = summary(at_workload(evaluate(setting(n, **kw), dev, args.workers, covers=(2, 8)), q=q))
        write_json(REPORT_DIR / "baselines.json", rec)
        return
    if stage == "S3":
        names = [d.name for d in dataset_dirs("count10")]
        base_ds = [ROOT / "development" / n for n in names]
        cands = {"S3_summed_20": ({"shortfall": "summed"}, base_ds, "dev")}
        for every in (10, 5):
            ds = dataset_dirs(f"count{every}")
            cands[f"S3_count{every}"] = ({}, ds, f"count{every}")
            cands[f"S3_count{every}_summed"] = ({"shortfall": "summed"}, ds, f"count{every}")
        base_raw = evaluate(base_cfg, base_ds, args.workers, tag="dev15")
        record = {"stage": "S3", "protocol": protocol_text("S3"), "start": base_cfg,
                  "start_result": summary(at_workload(base_raw), base_raw), "candidates": {}}
        best = None
        for cname, (delta, ds, tag) in cands.items():
            cfg = combine(base_cfg, delta)
            cfg["name"] = name_of(cfg)
            raw = evaluate(cfg, ds, args.workers, tag=tag if tag != "dev" else "dev15")
            base, res, level = common(base_raw, raw)
            ok, checks, f1 = decide(base, res)
            record["candidates"][cname] = {"change": delta, "data": tag, "workload": level, "result": summary(res, raw),
                                           "start_at_same_workload": summary(base, base_raw),
                                           "against_start": comparison(base, res), "checks": checks, "adopted_alone": ok}
            print(f"{cname}: problem F1 {res.problem_f1.mean():.3f} vs {base.problem_f1.mean():.3f} "
                  f"({f1['diff'] * 100:+.1f}, {f1['lo'] * 100:+.1f} to {f1['hi'] * 100:+.1f}) false from shortfall "
                  f"{res.false_from_shortfall_per_officer_term.mean():.2f} pass={ok}", flush=True)
            if ok and (best is None or f1["diff"] > best[0]):
                best = (f1["diff"], cname, delta, tag)
        # one interval and one count rule: the best passing candidate
        record["kept"] = [best[1]] if best else []
        state["stages"]["S3"] = {"start": base_cfg, "kept": record["kept"], "validated": None,
                                 "count_every": int(best[3][5:]) if best and best[3].startswith("count") else 20}
        if best:
            prop = combine(base_cfg, best[2])
            prop["name"] = name_of(prop)
            state["stages"]["S3"]["proposed"] = prop
            state["current"] = prop      # a procedure change: no validation datasets at other intervals
            state["count_every"] = state["stages"]["S3"]["count_every"]
        save_state(state)
        write_json(REPORT_DIR / "stage_S3.json", record)
        return
    exempt = stage == "S2"
    record, current, base, cur = run_stage(stage, base_cfg, candidates(stage), dev, "dev", args.workers, exempt_week_f1=exempt)
    record["protocol"] = {c: protocol_text(c.split("_")[0]) for c in candidates(stage)}
    state["stages"][stage] = {"start": base_cfg, "proposed": current, "kept": record["kept"], "validated": None}
    write_json(REPORT_DIR / f"stage_{stage}.json", record)
    save_state(state)
    print("kept:", record["kept"], flush=True)


def step_validate(args):
    """A stage's result against its start on the validation datasets, once, each at the q found
    on development data. The stage's change is kept only if the problem-level F1 gain has a 95%
    interval above 0."""
    state = load_state()
    st = state["stages"][args.stage]
    if not st["kept"]:
        print("nothing proposed; nothing to validate")
        return
    if st.get("validated") is not None:
        raise SystemExit("already validated: the validation datasets are used once per stage")
    dev, val = dataset_dirs("development"), dataset_dirs("validation")
    start, prop = st["start"], st["proposed"]
    d0, d1, level = common(evaluate(start, dev, args.workers), evaluate(prop, dev, args.workers))
    q0, q1 = d0.attrs["q"], d1.attrs["q"]
    a = at_workload(evaluate(start, val, args.workers, tag="val"), q=q0)
    b = at_workload(evaluate(prop, val, args.workers, tag="val"), q=q1)
    f1 = paired(a, b, "problem_f1")
    ok = f1["lo"] > 0
    rec = {"stage": args.stage, "start": start, "proposed": prop, "q_start": q0, "q_proposed": q1, "dev_workload": level,
           "start_result": summary(a), "proposed_result": summary(b), "comparison": comparison(a, b), "kept": ok}
    write_json(REPORT_DIR / f"validation_{args.stage}.json", rec)
    st["validated"] = ok
    state["current"] = prop if ok else start
    save_state(state)
    print(f"validation {args.stage}: problem F1 {f1['diff'] * 100:+.1f} ({f1['lo'] * 100:+.1f} to {f1['hi'] * 100:+.1f}) kept={ok}")


def step_final(args):
    raise SystemExit("the final step is written after the freeze")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--step", required=True)
    p.add_argument("--datasets", default="development,validation,count10,count5")
    p.add_argument("--stage")
    p.add_argument("--workers", type=int, default=3)
    a = p.parse_args()
    {"data": step_data, "features": step_features, "parity": step_parity, "stage": step_stage,
     "validate": step_validate, "final": step_final}[a.step](a)


if __name__ == "__main__":
    main()
