"""
Phase 10: train and save the Prophet model used by the Flask service.

Fits the Prophet configuration selected on the validation period (read from
data/reports/forecast_evaluation.json, produced by
evaluate_forecasting_models.py) on all school days up to --train-end
(default: the end of the dataset), then saves:

  models/artifacts/prophet_model.json   Prophet's own JSON serialisation
  models/artifacts/model_metadata.json  configuration, data ranges, metrics, versions

Usage
  python forecasting/scripts/train_forecasting_model.py [--train-end YYYY-MM-DD] [--candidate NAME]
"""

import argparse
import datetime as dt
import json
import sys
from importlib.metadata import version
from pathlib import Path

FORECASTING_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(FORECASTING_DIR))

import pandas as pd  # noqa: E402

from common import CONFIG_PATH as CALENDAR_CONFIG_PATH, sha256_of  # noqa: E402
from models.data import load_forecast_config, load_school_days, resolve  # noqa: E402
from models.features import add_calendar_features  # noqa: E402
from models.prophet_model import fit_prophet, save_model, training_frame  # noqa: E402


def select_spec(cfg, candidate):
    evaluation_path = resolve(cfg["artifacts"]["evaluation_json"])
    if candidate:
        base = cfg["prophet"]["base_params"]
        for c in cfg["prophet"]["candidates"]:
            if c["name"] == candidate:
                return {"name": c["name"], "regressors": c["regressors"], "params": dict(base)}, None
        sys.exit(f"ERROR: unknown candidate '{candidate}'")
    if not evaluation_path.exists():
        sys.exit(f"ERROR: {evaluation_path} not found. Run evaluate_forecasting_models.py first, "
                 "or pass --candidate NAME.")
    evaluation = json.loads(evaluation_path.read_text(encoding="utf-8"))
    return evaluation["selected"]["prophet"], evaluation


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--train-end", help="last date used for training (default: end of dataset)")
    ap.add_argument("--candidate", help="train a named stage-1 candidate instead of the validated selection")
    ap.add_argument("--output-dir", help="artifact directory (default from config)")
    args = ap.parse_args()

    cfg = load_forecast_config()
    spec, evaluation = select_spec(cfg, args.candidate)
    target = cfg["dataset"]["target"]
    school, summary = load_school_days(cfg)
    school = add_calendar_features(school)
    if args.train_end:
        school = school[school["date"] <= pd.Timestamp(args.train_end)]

    regs = spec["regressors"]
    pc = cfg["prophet"]
    model = fit_prophet(training_frame(school, target, regs), spec["params"], regs,
                        pc["interval_width"], pc["uncertainty_samples"])

    metrics = None
    if evaluation:
        pick = lambda rows: [r for r in rows if r["model"] == spec["name"]]  # noqa: E731
        metrics = {"validation": pick(evaluation["validation"]), "test": pick(evaluation["test"]),
                   "evaluation_design": evaluation["evaluation_design"],
                   "baselines_test": [r for r in evaluation["test"] if r["model"] != spec["name"]]}

    metadata = {
        "model_type": "prophet",
        "model_name": spec["name"],
        "target": target,
        "regressors": regs,
        "regressor_availability": {r: pc["available_regressors"][r] for r in regs},
        "prophet_params": spec["params"],
        "interval_width": pc["interval_width"],
        "uncertainty_samples": pc["uncertainty_samples"],
        "random_seed": pc["random_seed"],
        "training_data": {
            "first_date": str(school["date"].min().date()),
            "last_date": str(school["date"].max().date()),
            "school_days": len(school),
            "unit": "school days only (non-school days excluded, not zero)",
            "last_known_enrollment": int(school["students_enrolled"].iloc[-1]),
        },
        "horizon": cfg["horizon"],
        "dataset": {"path": cfg["dataset"]["path"], "sha256": sha256_of(resolve(cfg["dataset"]["path"])),
                    "synthetic": True,
                    "description": "Synthetic data for one simulated Kenyan school (Phase 9). Not real records."},
        "calendar_config_sha256": sha256_of(CALENDAR_CONFIG_PATH),
        "evaluation_metrics": metrics,
        "selection": "validated selection" if evaluation else f"manual candidate '{spec['name']}' (not validated)",
        "library_versions": {p: version(p) for p in ("prophet", "cmdstanpy", "pandas", "numpy")},
        "trained_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }
    out_dir = Path(args.output_dir) if args.output_dir else resolve(cfg["artifacts"]["dir"])
    mpath, meta_path = save_model(model, metadata, out_dir, cfg["artifacts"]["model_file"],
                                  cfg["artifacts"]["metadata_file"])
    print(f"Trained {spec['name']} on {metadata['training_data']['school_days']:,} school days "
          f"({metadata['training_data']['first_date']} to {metadata['training_data']['last_date']}).")
    print(f"  wrote {mpath}\n  wrote {meta_path}")


if __name__ == "__main__":
    main()
