"""
Robustness study: the anomaly detection protocol on many differently generated datasets.

Follows config/anomaly_robustness.yaml, committed before the study was run. Each run
generates a dataset from the base generator config with a scenario's overrides and a
seed, then evaluates it with the unchanged protocol (config/anomaly_evaluation.yaml).
The main evaluation's result is not changed by this study.

Outputs
  data/reports/anomaly/robustness/anomaly_robustness.json
  data/reports/anomaly/robustness/anomaly_robustness.md

Usage
  python forecasting/scripts/run_anomaly_robustness.py [--workers N]
"""

import argparse
import copy
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

from common import PROCESSED_DIR, REPORTS_DIR, md_table, write_json  # noqa: E402

PLAN = FORECASTING_DIR / "config" / "anomaly_robustness.yaml"
DATA_ROOT = PROCESSED_DIR / "feeding_robustness"
REPORT_DIR = REPORTS_DIR / "anomaly" / "robustness"
LABELS = {"rules": "Fixed rules", "robust_zscore": "Robust z-score", "isolation_forest": "Isolation Forest",
          "local_outlier_factor": "Local Outlier Factor", "one_class_svm": "One-class SVM"}


def deep_merge(base, override):
    """base with override's values, merged key by key (lists are replaced)."""
    out = dict(base)
    for key, value in override.items():
        out[key] = deep_merge(out[key], value) if isinstance(value, dict) and isinstance(out.get(key), dict) else value
    return out


def run_one(task):
    """Generate and evaluate one scenario and seed (runs in a worker process)."""
    from evaluate_anomaly_detection import evaluate
    from generate_feeding_dataset import generate

    scenario, seed, cfg = task
    out_dir = DATA_ROOT / f"{scenario}_{seed}"
    generate(cfg, out_dir, quiet=True)
    result = evaluate(out_dir, report_dir=None, quiet=True)
    rows = []
    for method, r in result["results"].items():
        rows.append({
            "scenario": scenario, "seed": seed, "method": method,
            "precision_at_k": r["precision_at_k"],
            "precision_at_k_share_of_ceiling": r["precision_at_k"] / result["precision_at_k_ceiling"],
            "f1": r["test"]["f1"],
            "recall_held_out": r["test"]["recall_held_out"],
            "recommended": method == result["recommended"],
            "tied_with_recommended": method == result["recommended"] or (
                result["recommended"] == result["leader"] and method in result["tied_with_leader"]),
            "ceiling": result["precision_at_k_ceiling"],
        })
    return rows


def main(workers):
    started = time.time()
    plan = yaml.safe_load(open(PLAN, encoding="utf-8"))
    base = yaml.safe_load(open(FORECASTING_DIR.parent / plan["base"], encoding="utf-8"))
    tasks = []
    for scenario, spec in plan["scenarios"].items():
        for seed in plan["seeds"]:
            cfg = deep_merge(copy.deepcopy(base), spec["overrides"])
            cfg["seed"] = seed
            tasks.append((scenario, seed, cfg))
    rows = []
    with ProcessPoolExecutor(max_workers=workers) as pool:
        for i, result in enumerate(pool.map(run_one, tasks), 1):
            rows += result
            print(f"{i}/{len(tasks)} runs done ({time.time() - started:.0f}s)")
    df = pd.DataFrame(rows)
    # Rank within each run by precision@k (1 = best; ties share the average rank)
    df["rank"] = df.groupby(["scenario", "seed"]).precision_at_k.rank(ascending=False, method="average")

    runs = df.groupby(["scenario", "seed"]).ngroups
    overall = df.groupby("method").agg(
        precision_at_k=("precision_at_k", "mean"),
        share_of_ceiling=("precision_at_k_share_of_ceiling", "mean"),
        f1=("f1", "mean"),
        recall_held_out=("recall_held_out", "mean"),
        average_rank=("rank", "mean"),
        recommended=("recommended", "sum"),
        recommended_or_tied=("tied_with_recommended", "sum"),
        precision_min=("precision_at_k", "min"),
        precision_max=("precision_at_k", "max"),
    ).sort_values("average_rank")
    by_scenario = df.pivot_table(index="method", columns="scenario", values="rank", aggfunc="mean")

    best = overall.index[0]
    robust = overall.loc[best, "recommended_or_tied"] >= (2 / 3) * runs
    conclusion = (f"{LABELS[best]} is robustly best: best average rank, and recommended or tied with the recommended "
                  f"method in {int(overall.loc[best, 'recommended_or_tied'])} of {runs} runs."
                  if robust else
                  f"No single method is robustly best. {LABELS[best]} has the best average rank but is recommended or tied "
                  f"with the recommended method in only {int(overall.loc[best, 'recommended_or_tied'])} of {runs} runs.")

    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    write_json(REPORT_DIR / "anomaly_robustness.json", {
        "plan": str(PLAN.relative_to(FORECASTING_DIR.parent)), "runs": runs,
        "overall": overall.round(4).reset_index().to_dict(orient="records"),
        "average_rank_by_scenario": by_scenario.round(2).reset_index().to_dict(orient="records"),
        "per_run": df.round(4).to_dict(orient="records"),
        "conclusion": conclusion, "robustly_best": best if robust else None,
        "runtime_seconds": round(time.time() - started),
    })
    pct = lambda v: f"{v * 100:.1f}%"
    scenarios = list(plan["scenarios"])
    lines = [
        "# Anomaly detection: robustness study",
        "",
        f"Plan: [`{PLAN.relative_to(FORECASTING_DIR.parent)}`](../../../../config/anomaly_robustness.yaml), committed before it "
        f"was run. {runs} runs: {len(scenarios)} data scenarios × {len(plan['seeds'])} seeds, each generated afresh and evaluated "
        "with the unchanged protocol (same methods, tuning grid, periods, held-out anomaly types, metric and decision rule).",
        "",
        f"**{conclusion}**",
        "",
        "## Across all runs",
        "",
        md_table([[LABELS[m], f"{r.average_rank:.2f}", pct(r.precision_at_k), f"{pct(r.precision_min)} – {pct(r.precision_max)}",
                   pct(r.share_of_ceiling), pct(r.f1), pct(r.recall_held_out), f"{int(r.recommended)}", f"{int(r.recommended_or_tied)}"]
                  for m, r in overall.iterrows()],
                 ["Method", "Average rank", "Precision@k (mean)", "Range", "Share of best possible", "F1",
                  "Recall, held-out types", f"Recommended (of {runs})", f"Recommended or tied (of {runs})"]),
        "",
        "Rank is by precision@k within each run (1 = best). \"Share of best possible\" divides precision@k by the most any "
        "method could reach in that run, given how many school-weeks contain an anomaly.",
        "",
        "## Average rank by scenario",
        "",
        md_table([[LABELS[m]] + [f"{by_scenario.loc[m, s]:.1f}" for s in scenarios] for m in overall.index],
                 ["Method"] + scenarios),
        "",
        "Scenarios: " + "; ".join(f"**{s}**: {plan['scenarios'][s]['description']}" for s in scenarios) + ".",
        "",
        "All runs use synthetic data, so the study shows how stable the comparison is under different assumptions, not how "
        "the methods would do at real schools.",
        "",
    ]
    (REPORT_DIR / "anomaly_robustness.md").write_text("\n".join(lines), encoding="utf-8")
    print(conclusion)
    print(f"Wrote {REPORT_DIR / 'anomaly_robustness.md'} ({time.time() - started:.0f}s)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=6)
    main(parser.parse_args().workers)
