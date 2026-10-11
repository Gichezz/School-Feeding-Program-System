"""
Phase 10: rolling-origin evaluation of the forecasting approaches.

  1. Load and preprocess the synthetic dataset (school days only).
  2. Chronological split: train / validation / test (config/forecasting.yaml).
  3. VALIDATION: compare historical-average variants, moving-average windows
     and Prophet configurations; select the best of each by mean MAE over
     the configured horizons.
  4. TEST: evaluate only the selected configurations, once.
  5. Write the comparison report, metrics JSON and per-forecast predictions.

Usage
  python forecasting/scripts/evaluate_forecasting_models.py [--origin-step DAYS]
"""

import argparse
import datetime as dt
import json
import sys
import time
from pathlib import Path

FORECASTING_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(FORECASTING_DIR))

import pandas as pd  # noqa: E402

from common import md_table, sha256_of  # noqa: E402
from models.baselines import HistoricalAverage, MovingAverage  # noqa: E402
from models.data import load_forecast_config, load_school_days, resolve, split_by_dates  # noqa: E402
from models.evaluation import (  # noqa: E402
    forecast_windows, mean_metric, run_baseline, run_prophet, summarise, summary_records)
from models.features import add_calendar_features, future_school_days  # noqa: E402


def prophet_specs(cfg):
    p = cfg["prophet"]
    return [{"name": c["name"], "regressors": c["regressors"], "params": dict(p["base_params"])}
            for c in p["candidates"]]


def tuned_specs(best, cfg):
    specs = []
    for change in cfg["prophet"]["tuning_grid"]:
        params = {**best["params"], **change}
        suffix = "_".join(f"{k.replace('changepoint_prior_scale', 'cps').replace('seasonality_mode', 'mode')}_{v}"
                          for k, v in change.items())
        specs.append({"name": f"{best['name']}__{suffix}", "regressors": best["regressors"], "params": params})
    return specs


def check_calendar_consistency(school):
    """The future-calendar builder must reproduce the dataset's calendar for past dates."""
    rebuilt, _ = future_school_days(school["date"].min(), school["date"].max())
    same_days = rebuilt["date"].reset_index(drop=True).equals(school["date"].reset_index(drop=True))
    flags_equal = same_days and all(
        (rebuilt[c].values == school[c].values).all()
        for c in ("first_day_of_term", "first_week_of_term", "exam_period"))
    return {"school_days_match": bool(same_days), "calendar_regressors_match": bool(flags_equal)}


def fmt(x, pct=False):
    if x is None or (isinstance(x, float) and pd.isna(x)):
        return "n/a"
    return f"{100 * x:.2f}%" if pct else f"{x:.2f}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--origin-step", type=int, help="override evaluation.origin_step_days")
    args = ap.parse_args()

    t0 = time.time()
    cfg = load_forecast_config()
    ev = cfg["evaluation"]
    step = args.origin_step or ev["origin_step_days"]
    horizons = ev["horizons_days"]
    max_h = max(horizons)
    target = cfg["dataset"]["target"]

    school, summary = load_school_days(cfg)
    school = add_calendar_features(school)
    consistency = check_calendar_consistency(school)
    if not all(consistency.values()):
        sys.exit(f"ERROR: future calendar does not reproduce the dataset calendar: {consistency}")
    splits = split_by_dates(school, cfg["split"])
    split_info = {n: {"start": str(f["date"].min().date()), "end": str(f["date"].max().date()),
                      "configured": cfg["split"][n], "school_days": len(f)} for n, f in splits.items()}

    val_windows = forecast_windows(school, cfg["split"]["validation"]["start"], cfg["split"]["validation"]["end"],
                                   step, max_h)
    test_windows = forecast_windows(school, cfg["split"]["test"]["start"], cfg["split"]["test"]["end"], step, max_h)
    # Guard: no validation forecast may use history from the test period, and vice versa targets stay in period.
    assert all(h["date"].max() < pd.Timestamp(cfg["split"]["test"]["start"]) for _, h, _ in val_windows)
    print(f"Validation origins: {len(val_windows)}, test origins: {len(test_windows)} (step {step} days)")

    covs = cfg["prophet"]["coverage_levels"]
    mape_min = ev["mape_min_actual"]

    # ---- Validation: baselines ------------------------------------------------
    ha_models = [HistoricalAverage(v.get("window_days")) for v in cfg["baselines"]["historical_average"]["variants"]]
    ma_models = [MovingAverage(w) for w in cfg["baselines"]["moving_average"]["windows_school_days"]]
    val_preds = [run_baseline(m, val_windows, target) for m in ha_models + ma_models]

    # ---- Validation: Prophet stage 1 (regressor sets) then stage 2 (tuning) -----
    stage1 = prophet_specs(cfg)
    for s in stage1:
        print(f"  validating {s['name']} ...", flush=True)
        val_preds.append(run_prophet(s, val_windows, target, cfg["prophet"], covs))
    val_summary = summarise(pd.concat(val_preds, ignore_index=True), horizons, mape_min)
    best1 = min(stage1, key=lambda s: mean_metric(val_summary, s["name"], "mae"))
    stage2 = tuned_specs(best1, cfg)
    for s in stage2:
        print(f"  validating {s['name']} ...", flush=True)
        val_preds.append(run_prophet(s, val_windows, target, cfg["prophet"], covs))
    val_all = pd.concat(val_preds, ignore_index=True)
    val_summary = summarise(val_all, horizons, mape_min)

    pick = lambda names: min(names, key=lambda n: mean_metric(val_summary, n, "mae"))  # noqa: E731
    sel_ha = pick([m.name for m in ha_models])
    sel_ma = pick([m.name for m in ma_models])
    prophet_all = stage1 + stage2
    sel_p = next(s for s in prophet_all if s["name"] == pick([s["name"] for s in prophet_all]))
    best_overall = pick([sel_ha, sel_ma, sel_p["name"]])
    print(f"Selected on validation: {sel_ha}, {sel_ma}, {sel_p['name']} (lowest overall: {best_overall})")

    # ---- Test: selected configurations only ------------------------------------
    test_preds = [run_baseline(next(m for m in ha_models if m.name == sel_ha), test_windows, target),
                  run_baseline(next(m for m in ma_models if m.name == sel_ma), test_windows, target)]
    print(f"  testing {sel_p['name']} ...", flush=True)
    test_preds.append(run_prophet(sel_p, test_windows, target, cfg["prophet"], covs))
    test_all = pd.concat(test_preds, ignore_index=True)
    test_summary = summarise(test_all, horizons, mape_min)

    # ---- Outputs -----------------------------------------------------------------
    art = cfg["artifacts"]
    preds_out = pd.concat([val_all.assign(split="validation"), test_all.assign(split="test")], ignore_index=True)
    for c in ("origin", "date"):
        preds_out[c] = preds_out[c].dt.strftime("%Y-%m-%d")
    resolve(art["evaluation_predictions"]).parent.mkdir(parents=True, exist_ok=True)
    preds_out.round(3).to_csv(resolve(art["evaluation_predictions"]), index=False)

    dataset_path = resolve(cfg["dataset"]["path"])
    result = {
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "dataset": {"path": cfg["dataset"]["path"], "sha256": sha256_of(dataset_path)},
        "preprocessing": summary.as_dict(),
        "calendar_consistency": consistency,
        "split": split_info,
        "evaluation_design": {"origin_step_days": step, "horizons_days": horizons,
                              "validation_origins": len(val_windows), "test_origins": len(test_windows),
                              "selection_metric": f"mean {ev['selection_metric']} over horizons (validation)"},
        "selected": {"historical_average": sel_ha, "moving_average": sel_ma, "prophet": sel_p,
                     "lowest_validation_error": best_overall},
        "validation": summary_records(val_summary),
        "test": summary_records(test_summary),
        "runtime_seconds": round(time.time() - t0, 1),
    }
    Path(resolve(art["evaluation_json"])).write_text(json.dumps(result, indent=2, default=str) + "\n",
                                                     encoding="utf-8")
    resolve(art["evaluation_report"]).write_text(render_report(result, cfg), encoding="utf-8")
    print(f"Done in {result['runtime_seconds']} s")
    for k in ("evaluation_json", "evaluation_report", "evaluation_predictions"):
        print(f"  wrote {resolve(art[k])}")


def render_report(r, cfg):
    L = ["# Forecasting Evaluation Report (Phase 10)\n",
         "Generated by `forecasting/scripts/evaluate_forecasting_models.py`.\n",
         "> **Synthetic data.** All results come from a synthetic dataset representing one simulated Kenyan school "
         "(Phase 9). They show how the methods compare on data generated from documented assumptions; they do "
         "**not** show forecasting accuracy for any real Kenyan school.\n"]
    pp = r["preprocessing"]
    L.append("## 1. Data and preprocessing\n")
    L.append(md_table([
        ["Dataset", f"`forecasting/{r['dataset']['path']}` (sha256 `{r['dataset']['sha256'][:16]}...`)"],
        ["Records / range", f"{pp['records']:,} daily records, {pp['start']} to {pp['end']}"],
        ["Daily frequency without gaps", pp["daily_frequency_without_gaps"]],
        ["Duplicate dates", pp["duplicate_dates"]],
        ["School days / non-school days", f"{pp['school_days']:,} / {pp['non_school_days']:,}"],
        ["Target", f"`{pp['target']}` (min {pp['target_min']:.0f}, max {pp['target_max']:.0f})"],
        ["Target missing on school days", pp["target_missing_on_school_days"]],
        ["Target present on non-school days", pp["target_present_on_non_school_days"]],
        ["Negative targets", pp["target_negative"]],
        ["Future calendar reproduces dataset calendar",
         f"school days: {r['calendar_consistency']['school_days_match']}, "
         f"regressors: {r['calendar_consistency']['calendar_regressors_match']}"],
    ], ["Check", "Result"]))
    L.append("\nModels use school days only. Non-school days are excluded rather than treated as zero demand.\n")
    L.append("## 2. Chronological split\n")
    L.append(md_table([[n, s["start"], s["end"], s["school_days"]] for n, s in r["split"].items()],
                      ["Split", "First school day", "Last school day", "School days"]))
    d = r["evaluation_design"]
    L.append(f"\nRolling-origin evaluation: a forecast origin every {d['origin_step_days']} calendar days "
             f"({d['validation_origins']} validation origins, {d['test_origins']} test origins). At each origin, "
             "models use only school days before the origin (expanding history) and forecast every school day in the "
             f"next {max(d['horizons_days'])} calendar days that falls in the same split. Horizons "
             f"{', '.join(str(h) for h in d['horizons_days'])} score the targets up to 7, 14 or 30 days ahead. "
             "Prophet is refitted at every origin. Selection uses validation only; the test period is evaluated once.\n")

    def table(rows, cols):
        return md_table([[x["model"], x["horizon_days"], x["n"], x["origins"], fmt(x["mae"]), fmt(x["rmse"]),
                          fmt(x["wape"], True), fmt(x["mape"], True), fmt(x["bias"])] for x in rows],
                        ["Model", "Horizon (days)", "Forecasts", "Origins", "MAE", "RMSE", "WAPE", "MAPE", "Bias"])

    L.append("## 3. Validation results (all candidates)\n")
    L.append(table(r["validation"], None))
    L.append("\nBias = mean(forecast - actual); positive values mean over-forecasting.\n")
    sel = r["selected"]
    L.append(f"Selected on validation (lowest mean MAE over horizons): **{sel['historical_average']}**, "
             f"**{sel['moving_average']}**, **{sel['prophet']['name']}**. Lowest validation error overall: "
             f"**{sel['lowest_validation_error']}**.\n")
    L.append(f"Selected Prophet configuration: regressors `{sel['prophet']['regressors']}`, "
             f"parameters `{sel['prophet']['params']}`.\n")

    L.append("## 4. Model comparison (validation vs final test)\n")
    names = [sel["historical_average"], sel["moving_average"], sel["prophet"]["name"]]
    val = {(x["model"], x["horizon_days"]): x for x in r["validation"]}
    rows = []
    for x in r["test"]:
        v = val[(x["model"], x["horizon_days"])]
        rows.append([x["model"], x["horizon_days"], fmt(v["mae"]), fmt(v["rmse"]), fmt(v["wape"], True), v["n"],
                     fmt(x["mae"]), fmt(x["rmse"]), fmt(x["wape"], True), x["n"]])
    rows.sort(key=lambda z: (z[1], names.index(z[0])))
    L.append(md_table(rows, ["Model", "Horizon", "Val MAE", "Val RMSE", "Val WAPE", "Val n",
                             "Test MAE", "Test RMSE", "Test WAPE", "Test n"]))
    ranges = {x["horizon_days"]: (x["first_target"], x["last_target"])
              for x in r["test"] if x["model"] == sel["prophet"]["name"]}
    L.append("\nTest target dates by horizon: " + "; ".join(
        f"{h} days: {a} to {b}" for h, (a, b) in sorted(ranges.items())) +
        ". All models are scored on the same origins and target dates. With origins every "
        f"{r['evaluation_design']['origin_step_days']} days, longer horizons overlap, so a date can be "
        "forecast from more than one origin; each forecast is counted.\n")
    L.append("### Test results with MAPE and bias\n")
    L.append(table(r["test"], None))

    L.append("\n## 5. Prophet prediction-interval coverage\n")
    L.append("Share of actual values inside Prophet's intervals. Nominal coverage is what the interval width "
             "claims; empirical coverage is what was observed on held-out data.\n")
    rows = []
    for split in ("validation", "test"):
        for x in r[split]:
            if x["model"] == sel["prophet"]["name"]:
                rows.append([split, x["horizon_days"], x["n"],
                             fmt(x.get("coverage_80"), True), fmt(x.get("coverage_95"), True)])
    L.append(md_table(rows, ["Split", "Horizon", "Forecasts", "80% interval coverage", "95% interval coverage"]))
    L.append("\nPrediction intervals reflect Prophet's trend uncertainty and residual noise, assuming the future "
             "behaves like the training data. They are not guaranteed bounds. Because the data is synthetic, "
             "coverage here says nothing reliable about uncertainty for a real school.\n")
    L.append(f"\nRuntime: {r['runtime_seconds']} s.\n")
    return "\n".join(L)


if __name__ == "__main__":
    main()
