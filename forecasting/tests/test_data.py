"""Dataset loading, preprocessing, date handling and chronological splitting."""

import pandas as pd
import pytest

from models.data import (
    DataValidationError,
    load_dataset,
    load_forecast_config,
    load_school_days,
    preprocess,
    resolve,
    split_by_dates,
)

TARGET = "estimated_meal_demand"


def test_load_parses_dates_and_sorts(tmp_path, small_daily):
    shuffled = small_daily.sample(frac=1, random_state=0)
    path = tmp_path / "shuffled.csv"
    shuffled.to_csv(path, index=False)
    df = load_dataset(path)
    assert pd.api.types.is_datetime64_any_dtype(df["date"])
    assert df["date"].is_monotonic_increasing
    assert df["is_school_day"].dtype == bool


def test_load_missing_file_raises(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_dataset(tmp_path / "nope.csv")


def test_load_rejects_bad_dates(tmp_path, small_daily):
    bad = small_daily.copy()
    bad.loc[3, "date"] = "2022-13-45"
    path = tmp_path / "bad.csv"
    bad.to_csv(path, index=False)
    with pytest.raises(DataValidationError, match="unparseable"):
        load_dataset(path)


def test_preprocess_keeps_school_days_only_without_zero_filling(small_csv):
    df = load_dataset(small_csv)
    school, summary = preprocess(df, TARGET)
    assert len(school) == df["is_school_day"].sum() == summary.school_days
    assert summary.non_school_days == (~df["is_school_day"]).sum()
    assert school[TARGET].notna().all()
    # Non-school days are excluded, not converted to zero demand
    assert (school[TARGET] > 0).all()
    assert summary.target_present_on_non_school_days == 0
    assert summary.daily_frequency_without_gaps


def test_preprocess_rejects_missing_target_column(small_csv):
    df = load_dataset(small_csv).drop(columns=[TARGET])
    with pytest.raises(DataValidationError, match="not found"):
        preprocess(df, TARGET)


def test_preprocess_rejects_missing_target_on_school_day(small_csv):
    df = load_dataset(small_csv)
    i = df.index[df["is_school_day"]][5]
    df.loc[i, TARGET] = None
    with pytest.raises(DataValidationError, match="missing on 1 school days"):
        preprocess(df, TARGET)


def test_preprocess_rejects_negative_target(small_csv):
    df = load_dataset(small_csv)
    df.loc[df.index[df["is_school_day"]][0], TARGET] = -1
    with pytest.raises(DataValidationError, match="negative"):
        preprocess(df, TARGET)


def test_preprocess_rejects_duplicate_dates(small_csv):
    df = load_dataset(small_csv)
    df = pd.concat([df, df.iloc[[10]]]).sort_values("date").reset_index(drop=True)
    with pytest.raises(DataValidationError, match="duplicate"):
        preprocess(df, TARGET)


def test_preprocess_reports_gaps(small_csv):
    df = load_dataset(small_csv).drop(index=[50]).reset_index(drop=True)
    _, summary = preprocess(df, TARGET)
    assert summary.daily_frequency_without_gaps is False


SPLIT = {"train": {"start": "2022-01-01", "end": "2022-12-31"},
         "validation": {"start": "2023-01-01", "end": "2023-06-30"},
         "test": {"start": "2023-07-01", "end": "2023-12-31"}}


def test_split_is_chronological_and_disjoint(small_school_days):
    parts = split_by_dates(small_school_days, SPLIT)
    assert parts["train"]["date"].max() < parts["validation"]["date"].min()
    assert parts["validation"]["date"].max() < parts["test"]["date"].min()
    assert sum(len(p) for p in parts.values()) == len(small_school_days)
    dates = pd.concat([p["date"] for p in parts.values()])
    assert not dates.duplicated().any()


def test_split_rejects_overlap_or_wrong_order(small_school_days):
    bad = {**SPLIT, "validation": {"start": "2022-06-01", "end": "2023-06-30"}}
    with pytest.raises(DataValidationError, match="must end before"):
        split_by_dates(small_school_days, bad)


def test_split_rejects_empty_split(small_school_days):
    bad = {**SPLIT, "test": {"start": "2030-01-01", "end": "2030-12-31"}}
    with pytest.raises(DataValidationError, match="no records"):
        split_by_dates(small_school_days, bad)


@pytest.mark.skipif(not resolve(load_forecast_config()["dataset"]["path"]).exists(),
                    reason="synthetic dataset not generated")
def test_real_dataset_matches_documented_structure():
    cfg = load_forecast_config()
    school, summary = load_school_days(cfg)
    assert summary.records == 10227
    assert summary.school_days == 4867
    assert summary.duplicate_dates == 0
    assert summary.daily_frequency_without_gaps
    parts = split_by_dates(school, cfg["split"])
    assert [len(parts[k]) for k in ("train", "validation", "test")] == [4173, 347, 347]
