"""Calendar features, Prophet training, saving/loading and forecast output."""

import numpy as np
import pandas as pd
import pytest

from models.evaluation import forecast_windows, run_prophet
from models.features import future_school_days, last_known_enrollment
from models.prophet_model import fit_prophet, load_model, predict_prophet, save_model, training_frame

TARGET = "estimated_meal_demand"


def test_future_school_days_excludes_weekends_and_holidays():
    days, calendar_days = future_school_days("2026-12-01", "2027-01-31")
    assert calendar_days == 62
    assert (days["date"].dt.dayofweek < 5).all()
    assert days["is_school_day"].all()
    assert not days["date"].isin(pd.to_datetime(["2026-12-25", "2027-01-01"])).any()
    # December is an inter-term holiday in the configured calendar
    assert (days["date"] >= pd.Timestamp("2027-01-01")).all()


def test_future_calendar_matches_dataset_calendar(small_school_days):
    rebuilt, _ = future_school_days("2022-01-01", "2023-12-31")
    assert list(rebuilt["date"]) == list(small_school_days["date"])
    for c in ("first_day_of_term", "first_week_of_term", "exam_period"):
        assert np.array_equal(rebuilt[c].values, small_school_days[c].values)
    assert rebuilt["first_day_of_term"].sum() == 6  # three terms per year


def test_last_known_enrollment_uses_only_past(small_school_days):
    origin = small_school_days["date"].iloc[100]
    assert last_known_enrollment(small_school_days, origin) == small_school_days["students_enrolled"].iloc[99]
    with pytest.raises(ValueError):
        last_known_enrollment(small_school_days, "2000-01-01")


def test_training_frame_format(small_school_days):
    tf = training_frame(small_school_days, TARGET, ["exam_period"])
    assert list(tf.columns) == ["ds", "y", "exam_period"]
    assert len(tf) == len(small_school_days)


def test_training_frame_rejects_missing_values(small_school_days):
    broken = small_school_days.copy()
    broken.loc[0, TARGET] = np.nan
    with pytest.raises(ValueError):
        training_frame(broken, TARGET)


def test_prophet_save_load_roundtrip_gives_same_forecast(trained_model_dir, tmp_path):
    model, meta = load_model(trained_model_dir)
    days, _ = future_school_days("2024-01-08", "2024-02-02")
    future = pd.DataFrame({"ds": days["date"]})
    for r in meta["regressors"]:
        future[r] = 540.0 if r == "students_enrolled" else days[r].astype(float).values
    a = predict_prophet(model, future, seed=3)
    save_model(model, meta, tmp_path)
    model2, _ = load_model(tmp_path)
    b = predict_prophet(model2, future, seed=3)
    pd.testing.assert_frame_equal(a, b)
    assert (a["yhat_lower"] <= a["yhat"]).all() and (a["yhat"] <= a["yhat_upper"]).all()


def test_load_model_missing_artifact(tmp_path):
    with pytest.raises(FileNotFoundError):
        load_model(tmp_path)


def test_predict_requires_regressors(trained_model_dir):
    model, _ = load_model(trained_model_dir)
    with pytest.raises(ValueError, match="missing regressors"):
        predict_prophet(model, pd.DataFrame({"ds": pd.to_datetime(["2024-01-08"])}))


def test_predictions_are_clipped_at_zero():
    ds = pd.date_range("2024-01-01", periods=60, freq="D")
    train = pd.DataFrame({"ds": ds, "y": np.linspace(50, 1, 60)})  # falling towards zero
    m = fit_prophet(train, {"weekly_seasonality": False, "yearly_seasonality": False,
                            "daily_seasonality": False}, uncertainty_samples=100)
    fc = predict_prophet(m, pd.DataFrame({"ds": pd.date_range("2024-03-15", periods=30)}))
    assert (fc[["yhat", "yhat_lower", "yhat_upper"]] >= 0).all().all()
    assert (fc["yhat"] == 0).any()


def test_rolling_prophet_evaluation_small(small_school_days, forecast_config):
    windows = forecast_windows(small_school_days, "2023-09-01", "2023-10-31", 28, 14)[:2]
    spec = {"name": "p", "regressors": ["exam_period", "students_enrolled"],
            "params": dict(forecast_config["prophet"]["base_params"], yearly_seasonality=False)}
    cfg = dict(forecast_config["prophet"], uncertainty_samples=100)
    preds = run_prophet(spec, windows, TARGET, cfg, coverage_levels=[0.8])
    assert len(preds) == sum(len(t) for _, _, t in windows)
    assert {"lower_80", "upper_80"} <= set(preds.columns)
    assert (preds["yhat"] >= 0).all()
