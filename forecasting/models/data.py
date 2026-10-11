"""
Dataset loading, preprocessing and chronological splitting.

Design decision: the dataset has one row per calendar day, but meal fields are
null on non-school days (no session, so no observation). Forecasting models
are therefore trained and evaluated on SCHOOL DAYS ONLY. Non-school days are
dropped, never converted to zero demand, and forecasts are only produced for
dates the configured school calendar marks as school days.
"""

from dataclasses import dataclass
from pathlib import Path

import pandas as pd
import yaml

FORECASTING_DIR = Path(__file__).resolve().parent.parent
FORECAST_CONFIG_PATH = FORECASTING_DIR / "config" / "forecasting.yaml"

BOOL_COLUMNS = ["is_school_day", "is_school_holiday", "is_half_term", "is_exam_period", "is_special_event"]


class DataValidationError(ValueError):
    """Raised when the dataset fails a preprocessing check."""


def load_forecast_config(path=FORECAST_CONFIG_PATH):
    with open(path, "r", encoding="utf-8") as f:
        return yaml.safe_load(f)


def resolve(path):
    """Resolve a config path relative to the forecasting/ folder."""
    p = Path(path)
    return p if p.is_absolute() else FORECASTING_DIR / p


def _parse_bool(series, name):
    mapped = series.map({True: True, False: False, "True": True, "False": False})
    if mapped.isna().any():
        raise DataValidationError(f"Column '{name}' has {int(mapped.isna().sum())} non-boolean values")
    return mapped.astype(bool)


def load_dataset(path, date_column="date"):
    """Load the daily CSV, parse dates and booleans, and sort chronologically."""
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(f"Dataset not found: {path}")
    df = pd.read_csv(path)
    if date_column not in df.columns:
        raise DataValidationError(f"Date column '{date_column}' missing")
    parsed = pd.to_datetime(df[date_column], format="%Y-%m-%d", errors="coerce")
    if parsed.isna().any():
        raise DataValidationError(f"{int(parsed.isna().sum())} unparseable dates in '{date_column}'")
    df[date_column] = parsed
    for c in BOOL_COLUMNS:
        if c in df.columns:
            df[c] = _parse_bool(df[c], c)
    return df.sort_values(date_column, kind="stable").reset_index(drop=True)


@dataclass
class PreprocessingSummary:
    records: int
    start: str
    end: str
    daily_frequency_without_gaps: bool
    duplicate_dates: int
    school_days: int
    non_school_days: int
    target: str
    target_missing_on_school_days: int
    target_present_on_non_school_days: int
    target_negative: int
    target_min: float
    target_max: float

    def as_dict(self):
        return dict(self.__dict__)


def preprocess(df, target, date_column="date", school_day_column="is_school_day"):
    """
    Validate the dataset and return (school_day_frame, summary).

    Raises DataValidationError on: missing target column, duplicate dates,
    missing or negative targets on school days. Missing targets are never
    filled with zero.
    """
    if target not in df.columns:
        raise DataValidationError(f"Target column '{target}' not found; available: {list(df.columns)}")
    if school_day_column not in df.columns:
        raise DataValidationError(f"School-day column '{school_day_column}' not found")

    dates = df[date_column]
    dup = int(dates.duplicated().sum())
    if dup:
        raise DataValidationError(f"{dup} duplicate dates")
    if not dates.is_monotonic_increasing:
        raise DataValidationError("Dates are not sorted")
    gaps_ok = bool((dates.diff().dropna() == pd.Timedelta(days=1)).all())

    is_sd = df[school_day_column]
    y = pd.to_numeric(df[target], errors="coerce")
    missing_sd = int((is_sd & y.isna()).sum())
    if missing_sd:
        raise DataValidationError(f"Target missing on {missing_sd} school days")
    negative = int((y < 0).sum())
    if negative:
        raise DataValidationError(f"{negative} negative target values")

    school = df.loc[is_sd].copy()
    school[target] = y[is_sd].astype(float)
    summary = PreprocessingSummary(
        records=len(df),
        start=str(dates.iloc[0].date()),
        end=str(dates.iloc[-1].date()),
        daily_frequency_without_gaps=gaps_ok,
        duplicate_dates=dup,
        school_days=int(is_sd.sum()),
        non_school_days=int((~is_sd).sum()),
        target=target,
        target_missing_on_school_days=missing_sd,
        target_present_on_non_school_days=int((~is_sd & y.notna()).sum()),
        target_negative=negative,
        target_min=float(school[target].min()),
        target_max=float(school[target].max()),
    )
    return school.reset_index(drop=True), summary


def split_by_dates(frame, split_cfg, date_column="date"):
    """
    Chronological split into train/validation/test using inclusive date ranges.
    Raises if the ranges overlap or are out of order, or a split is empty.
    """
    names = ["train", "validation", "test"]
    bounds = [(pd.Timestamp(split_cfg[n]["start"]), pd.Timestamp(split_cfg[n]["end"])) for n in names]
    for (s1, e1), (s2, _), n1, n2 in zip(bounds, bounds[1:], names, names[1:]):
        if not s1 <= e1 < s2:
            raise DataValidationError(f"Split '{n1}' must end before '{n2}' starts")
    out = {}
    for n, (s, e) in zip(names, bounds):
        part = frame[(frame[date_column] >= s) & (frame[date_column] <= e)]
        if part.empty:
            raise DataValidationError(f"Split '{n}' ({s.date()}..{e.date()}) has no records")
        out[n] = part.reset_index(drop=True)
    return out


def load_school_days(cfg=None):
    """Convenience: load + preprocess using forecasting.yaml settings."""
    cfg = cfg or load_forecast_config()
    d = cfg["dataset"]
    df = load_dataset(resolve(d["path"]), d["date_column"])
    return preprocess(df, d["target"], d["date_column"], d["school_day_column"])
