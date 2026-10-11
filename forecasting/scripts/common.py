"""
Shared paths and helpers for the Phase 9 dataset scripts.

All scripts resolve paths relative to the forecasting/ folder so they can be
run from the repository root or from inside forecasting/.
"""

import hashlib
import json
from pathlib import Path

import yaml

FORECASTING_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = FORECASTING_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
REPORTS_DIR = DATA_DIR / "reports"
CONFIG_PATH = FORECASTING_DIR / "config" / "synthetic_kenya_school.yaml"

# Raw dataset as downloaded from Kaggle. Never written to by these scripts.
RAW_US_DATASET = RAW_DIR / "us_school_attendance.csv"

# Outputs
US_INSPECTION_JSON = REPORTS_DIR / "us_dataset_inspection.json"
US_INSPECTION_MD = REPORTS_DIR / "us_dataset_inspection.md"
US_REFERENCE_DAILY = PROCESSED_DIR / "us_reference_daily.csv"
US_REFERENCE_PROFILE = PROCESSED_DIR / "us_reference_profile.json"
SYNTHETIC_DATASET = PROCESSED_DIR / "synthetic_kenya_school_daily.csv"
SYNTHETIC_METADATA = PROCESSED_DIR / "synthetic_kenya_school_metadata.json"
VALIDATION_JSON = REPORTS_DIR / "validation_report.json"
VALIDATION_MD = REPORTS_DIR / "validation_report.md"
QUALITY_MD = REPORTS_DIR / "data_quality_report.md"


def ensure_output_dirs():
    for d in (PROCESSED_DIR, REPORTS_DIR):
        d.mkdir(parents=True, exist_ok=True)


def sha256_of(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def load_config(path=CONFIG_PATH):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def write_json(path, obj):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, indent=2, default=str)
        f.write("\n")


def read_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def md_table(rows, headers):
    """Render a list of row lists as a GitHub-flavoured markdown table."""
    out = ["| " + " | ".join(headers) + " |", "|" + "|".join("---" for _ in headers) + "|"]
    for r in rows:
        out.append("| " + " | ".join(str(v) for v in r) + " |")
    return "\n".join(out)
