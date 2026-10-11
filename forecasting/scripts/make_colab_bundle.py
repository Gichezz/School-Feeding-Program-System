"""
Build a zip of the forecasting files needed to run the Colab notebook.

The zip keeps the project layout (forecasting/...), so after unzipping in
Colab the notebook imports the same modules, config, dataset, saved model and
evaluation results as the local project. The raw US dataset, the virtualenv
and caches are left out.

Usage
  python forecasting/scripts/make_colab_bundle.py [--output PATH]
"""

import argparse
import zipfile
from pathlib import Path

FORECASTING_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = FORECASTING_DIR.parent
DEFAULT_OUTPUT = REPO_DIR / "school_feeding_forecasting_colab.zip"

INCLUDE = [
    "forecasting/app.py",
    "forecasting/requirements.txt",
    "forecasting/requirements-dev.txt",
    "forecasting/config/*.yaml",
    "forecasting/models/*.py",
    "forecasting/models/artifacts/*.json",
    "forecasting/services/*.py",
    "forecasting/scripts/*.py",
    "forecasting/tests/*.py",
    "forecasting/notebooks/*.ipynb",
    "forecasting/data/processed/synthetic_kenya_school_daily.csv",
    "forecasting/data/processed/synthetic_kenya_school_metadata.json",
    "forecasting/data/reports/forecast_evaluation.json",
    "forecasting/data/reports/forecast_evaluation_report.md",
    "forecasting/data/reports/forecast_evaluation_predictions.csv",
    "docs/forecasting.md",
    "docs/synthetic-dataset.md",
]
REQUIRED = [
    "forecasting/models/artifacts/prophet_model.json",
    "forecasting/data/processed/synthetic_kenya_school_daily.csv",
    "forecasting/data/reports/forecast_evaluation.json",
]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = ap.parse_args()

    missing = [p for p in REQUIRED if not (REPO_DIR / p).exists()]
    if missing:
        raise SystemExit(f"ERROR: missing {missing}. Run the evaluation and training scripts first.")

    files = sorted({f for pattern in INCLUDE for f in REPO_DIR.glob(pattern) if f.is_file()})
    with zipfile.ZipFile(args.output, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(f, f.relative_to(REPO_DIR).as_posix())
    print(f"Wrote {args.output} ({len(files)} files, {args.output.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
