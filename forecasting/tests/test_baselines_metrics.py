"""Baselines, metrics and rolling-origin windows."""

import math

import numpy as np
import pandas as pd
import pytest

from models.baselines import HistoricalAverage, InsufficientHistoryError, MovingAverage
from models.evaluation import forecast_windows, run_baseline, summarise, summary_records
from models.metrics import compute_metrics, interval_coverage

DATES = pd.to_datetime(["2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11", "2024-01-12",
                        "2024-01-15", "2024-01-16"])
VALUES = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0]
ORIGIN = "2024-01-15"  # history = first five values
TARGETS = pd.to_datetime(["2024-01-15", "2024-01-16", "2024-01-17"])


def test_historical_average_expanding():
    assert HistoricalAverage().forecast_level(DATES, VALUES, ORIGIN) == 30.0


def test_historical_average_trailing_window():
    # Window of 3 calendar days before 2024-01-15 covers 12 Jan only
    assert HistoricalAverage(window_days=3).forecast_level(DATES, VALUES, ORIGIN) == 50.0


def test_historical_average_empty_window_falls_back_to_expanding():
    assert HistoricalAverage(window_days=1).forecast_level(DATES, VALUES, "2024-03-01") == 40.0


@pytest.mark.parametrize("window,expected", [(1, 50.0), (2, 45.0), (5, 30.0)])
def test_moving_average_windows(window, expected):
    assert MovingAverage(window).forecast_level(DATES, VALUES, ORIGIN) == expected


def test_moving_average_insufficient_history_uses_available():
    assert MovingAverage(20).forecast_level(DATES, VALUES, ORIGIN) == 30.0


@pytest.mark.parametrize("model", [HistoricalAverage(), MovingAverage(5)])
def test_baselines_raise_without_history(model):
    with pytest.raises(InsufficientHistoryError):
        model.predict(DATES, VALUES, "2024-01-01", TARGETS)


@pytest.mark.parametrize("model", [HistoricalAverage(), HistoricalAverage(30), MovingAverage(3)])
def test_baselines_ignore_values_on_or_after_origin(model):
    changed = VALUES[:5] + [9999.0, -9999.0]
    a = model.predict(DATES, VALUES, ORIGIN, TARGETS)
    b = model.predict(DATES, changed, ORIGIN, TARGETS)
    assert np.array_equal(a, b)
    assert len(a) == len(TARGETS) and np.all(a == a[0])  # same level across the horizon


def test_moving_average_rejects_bad_window():
    with pytest.raises(ValueError):
        MovingAverage(0)


def test_metrics_values():
    m = compute_metrics([100, 200, 300], [110, 190, 330])
    assert m["n"] == 3
    assert m["mae"] == pytest.approx(50 / 3)
    assert m["rmse"] == pytest.approx(math.sqrt((100 + 100 + 900) / 3))
    assert m["wape"] == pytest.approx(50 / 600)
    assert m["mape"] == pytest.approx((0.1 + 0.05 + 0.1) / 3)
    assert m["bias"] == pytest.approx(10.0)  # errors +10, -10, +30


def test_mape_excludes_zero_actuals_without_dividing_by_zero():
    m = compute_metrics([0, 100], [5, 110], mape_min_actual=1.0)
    assert m["mape"] == pytest.approx(0.1)
    assert m["mape_n"] == 1 and m["mape_excluded"] == 1
    allzero = compute_metrics([0, 0], [1, 2])
    assert allzero["mape"] is None and allzero["wape"] is None


def test_metrics_empty_and_shape_mismatch():
    assert compute_metrics([], [])["n"] == 0
    with pytest.raises(ValueError):
        compute_metrics([1, 2], [1])


def test_interval_coverage():
    assert interval_coverage([1, 5, 10], [0, 6, 9], [2, 7, 11]) == pytest.approx(2 / 3)


def test_forecast_windows_have_no_leakage(small_school_days):
    windows = forecast_windows(small_school_days, "2023-01-01", "2023-06-30", step_days=14, max_horizon=30)
    assert windows
    for origin, history, targets in windows:
        assert history["date"].max() < origin
        assert targets["date"].min() >= origin
        assert targets["date"].max() <= pd.Timestamp("2023-06-30")
        assert targets["days_ahead"].between(1, 30).all()


def test_summary_coverage_is_none_for_models_without_intervals():
    preds = pd.DataFrame({
        "model": ["base", "base", "prophet", "prophet"],
        "origin": pd.to_datetime(["2024-01-08"] * 4),
        "date": pd.to_datetime(["2024-01-08", "2024-01-09"] * 2),
        "days_ahead": [1, 2, 1, 2],
        "actual": [100.0, 110.0, 100.0, 110.0],
        "yhat": [105.0, 105.0, 101.0, 112.0],
        "lower_80": [np.nan, np.nan, 95.0, 111.0],
        "upper_80": [np.nan, np.nan, 105.0, 115.0],
    })
    rows = {r["model"]: r for r in summary_records(summarise(preds, [7], 1.0))}
    assert rows["base"]["coverage_80"] is None  # JSON null, not 0.0 or NaN
    assert rows["prophet"]["coverage_80"] == pytest.approx(0.5)


def test_run_baseline_and_summary(small_school_days):
    windows = forecast_windows(small_school_days, "2023-01-01", "2023-06-30", 14, 30)
    preds = run_baseline(MovingAverage(5), windows, "estimated_meal_demand")
    s = summarise(preds, [7, 30], 1.0)
    assert list(s["horizon_days"]) == [7, 30]
    assert s.iloc[0]["n"] <= s.iloc[1]["n"]
    assert (s["mae"] >= 0).all()
