"""Alternative models compared with Prophet (issue #48): seasonal naive, SARIMA, Random Forest, gradient boosting."""

import numpy as np
import pandas as pd
import pytest

from models.baselines import InsufficientHistoryError, SeasonalNaive
from models.evaluation import forecast_windows, head_to_head, run_baseline, run_forecaster, summarise, summary_records
from models.ml_models import (LAG_GAP_DAYS, GradientBoostingForecaster, RandomForestForecaster, feature_matrix,
                              lag_features)
from models.sarima_model import SarimaForecaster

TARGET = "estimated_meal_demand"

# Mon 8 Jan 2024 to Tue 16 Jan 2024 (school days)
DATES = pd.to_datetime(["2024-01-08", "2024-01-09", "2024-01-10", "2024-01-11", "2024-01-12",
                        "2024-01-15", "2024-01-16"])
VALUES = [10.0, 20.0, 30.0, 40.0, 50.0, 60.0, 70.0]


# ---- Seasonal naive -------------------------------------------------------------

def test_seasonal_naive_uses_the_same_weekday_last_week():
    targets = pd.to_datetime(["2024-01-15", "2024-01-16", "2024-01-19"])  # Mon, Tue, Fri
    yhat = SeasonalNaive().predict(DATES, VALUES, "2024-01-15", targets)

    assert list(yhat) == [10.0, 20.0, 50.0]


def test_seasonal_naive_ignores_values_on_or_after_the_origin():
    changed = VALUES[:5] + [9999.0, -9999.0]
    targets = pd.to_datetime(["2024-01-15", "2024-01-16"])

    assert list(SeasonalNaive().predict(DATES, changed, "2024-01-15", targets)) == [10.0, 20.0]


def test_seasonal_naive_falls_back_to_the_last_value_for_an_unseen_weekday():
    yhat = SeasonalNaive().predict(DATES[:2], VALUES[:2], "2024-01-10", pd.to_datetime(["2024-01-11"]))

    assert list(yhat) == [20.0]


def test_seasonal_naive_needs_history():
    with pytest.raises(InsufficientHistoryError):
        SeasonalNaive().predict(DATES, VALUES, "2024-01-01", DATES)


# ---- Lag features: no leakage ---------------------------------------------------

def test_lag_features_use_only_values_at_least_30_days_back():
    history_dates = pd.date_range("2024-01-01", "2024-03-31", freq="D")
    history_values = np.arange(len(history_dates), dtype=float)
    target = pd.Timestamp("2024-03-31")

    lags = lag_features([target], history_dates, history_values)

    window = (history_dates >= target - pd.Timedelta(days=58)) & (history_dates <= target - pd.Timedelta(days=30))
    assert lags["lag_mean_30_58"].iloc[0] == pytest.approx(history_values[window].mean())
    assert lags["lag_same_weekday_35"].iloc[0] == history_values[history_dates == target - pd.Timedelta(days=35)][0]


def test_lag_features_for_a_30_day_horizon_need_nothing_after_the_origin(small_school_days):
    origin = pd.Timestamp("2023-06-01")
    history = small_school_days[small_school_days["date"] < origin]
    later = small_school_days[(small_school_days["date"] >= origin)
                              & (small_school_days["date"] < origin + pd.Timedelta(days=LAG_GAP_DAYS))]

    features = feature_matrix(later, history, TARGET, enrollment=500)

    assert features["lag_mean_30_58"].notna().all()


def tree_and_sarima_models():
    return [
        RandomForestForecaster("rf", TARGET, 1, n_estimators=40),
        GradientBoostingForecaster("gb", TARGET, 1, max_iter=60),
        SarimaForecaster("sarima", TARGET, (1, 0, 1), (1, 0, 1, 5), history_school_days=200),
    ]


@pytest.mark.parametrize("model", tree_and_sarima_models(), ids=lambda m: m.name)
def test_forecasts_never_see_the_actual_values_being_forecast(model, small_school_days):
    windows = forecast_windows(small_school_days, "2023-06-01", "2023-07-31", 30, 30)[:1]
    origin, history, targets = windows[0]
    hidden = targets.copy()
    hidden[TARGET] = -1.0

    yhat = model.predict_window(history, targets, 530)
    yhat_hidden = model.predict_window(history, hidden, 530)

    np.testing.assert_allclose(yhat, yhat_hidden)
    assert len(yhat) == len(targets) and np.isfinite(yhat).all()


@pytest.mark.parametrize("model", tree_and_sarima_models(), ids=lambda m: m.name)
def test_forecasts_are_close_to_the_school_level(model, small_school_days):
    windows = forecast_windows(small_school_days, "2023-06-01", "2023-07-31", 30, 30)[:1]
    _, history, targets = windows[0]

    yhat = model.predict_window(history, targets, 530)

    # The fixture's demand is about 0.88 x enrollment with noise of 6 meals
    assert np.abs(yhat - targets[TARGET].to_numpy()).mean() < 25


def test_tree_models_refuse_horizons_beyond_the_lag_gap(small_school_days):
    windows = forecast_windows(small_school_days, "2023-03-01", "2023-05-31", 30, 45)[:1]
    _, history, targets = windows[0]

    with pytest.raises(ValueError, match="horizons up to 30"):
        RandomForestForecaster("rf", TARGET, 1, n_estimators=10).predict_window(history, targets, 530)


def test_random_forest_is_reproducible_with_a_seed(small_school_days):
    _, history, targets = forecast_windows(small_school_days, "2023-06-01", "2023-07-31", 30, 30)[0]

    first = RandomForestForecaster("rf", TARGET, 7, n_estimators=30).predict_window(history, targets, 530)
    second = RandomForestForecaster("rf", TARGET, 7, n_estimators=30).predict_window(history, targets, 530)

    np.testing.assert_allclose(first, second)


# ---- Evaluation harness -----------------------------------------------------------

def test_run_forecaster_scores_every_target_and_records_fitting_time(small_school_days):
    windows = forecast_windows(small_school_days, "2023-05-01", "2023-07-31", 30, 30)
    model = GradientBoostingForecaster("gb", TARGET, 1, max_iter=30)

    preds = run_forecaster(model, windows, TARGET)
    baseline = run_baseline(SeasonalNaive(), windows, TARGET)
    summary = summary_records(summarise(pd.concat([preds, baseline], ignore_index=True), [7, 30], 1.0))

    assert len(preds) == sum(len(t) for _, _, t in windows)
    assert (preds["fit_seconds"] > 0).all()
    by_model = {(row["model"], row["horizon_days"]): row for row in summary}
    assert by_model[("gb", 30)]["seconds_per_origin"] > 0
    assert by_model[("seasonal_naive_weekly", 30)].get("seconds_per_origin") is None


def test_head_to_head_counts_origins_where_the_reference_is_more_accurate():
    def preds(model, errors):
        origins = pd.to_datetime(["2024-01-08", "2024-01-22", "2024-02-05"])
        return pd.DataFrame({"model": model, "origin": origins, "days_ahead": 1, "actual": 100.0,
                             "yhat": [100.0 + e for e in errors]})

    both = pd.concat([preds("prophet", [1, 5, 2]), preds("other", [3, 4, 6])], ignore_index=True)

    assert head_to_head(both, "prophet", 30) == {"other": {"reference_better": 2, "origins": 3}}
