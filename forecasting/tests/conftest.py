"""
Shared fixtures. Tests use a small two-year dataset built from the configured
school calendar, so they never need the full dataset or a long training run.
"""

import copy
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

FORECASTING_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(FORECASTING_DIR))

from models.data import load_forecast_config  # noqa: E402
from models.features import add_calendar_features, build_calendar, load_calendar_config  # noqa: E402
from models.prophet_model import fit_prophet, save_model, training_frame  # noqa: E402

TARGET = "estimated_meal_demand"
FIXTURE_REGRESSORS = ["first_day_of_term", "exam_period", "students_enrolled"]


@pytest.fixture(scope="session")
def forecast_config():
    return load_forecast_config()


@pytest.fixture(scope="session")
def small_daily():
    """Two calendar years (2022-2023), one row per day, target null on non-school days."""
    cfg = copy.deepcopy(load_calendar_config())
    cfg["period"] = {"start_date": "2022-01-01", "end_date": "2023-12-31"}
    cal, _ = build_calendar(cfg)
    rng = np.random.default_rng(7)
    n = len(cal)
    enrolled = np.linspace(500, 540, n).round()
    weekday = cal["date"].dt.dayofweek.map({0: -5, 1: 3, 2: 4, 3: 2, 4: -8}).fillna(0).to_numpy()
    demand = np.round(0.88 * enrolled + weekday + rng.normal(0, 6, n))
    df = pd.DataFrame({
        "date": cal["date"].dt.strftime("%Y-%m-%d"),
        "day_of_week": cal["day_of_week"],
        "is_school_day": cal["is_school_day"],
        "term": cal["term"],
        "week_of_term": cal["week_of_term"],
        "is_exam_period": cal["is_exam_period"],
        "students_enrolled": enrolled.astype(int),
        TARGET: pd.array(np.where(cal["is_school_day"], demand, np.nan)).astype("Int64"),
    })
    return df


@pytest.fixture
def small_csv(tmp_path, small_daily):
    path = tmp_path / "small.csv"
    small_daily.to_csv(path, index=False)
    return path


@pytest.fixture(scope="session")
def small_school_days(small_daily):
    sd = small_daily[small_daily["is_school_day"]].copy()
    sd["date"] = pd.to_datetime(sd["date"])
    sd[TARGET] = sd[TARGET].astype(float)
    return add_calendar_features(sd.reset_index(drop=True))


@pytest.fixture(scope="session")
def trained_model_dir(tmp_path_factory, small_school_days, forecast_config):
    """A tiny Prophet artifact trained on the fixture data (fits in about a second)."""
    out = tmp_path_factory.mktemp("model")
    params = dict(forecast_config["prophet"]["base_params"], yearly_seasonality=False)
    model = fit_prophet(training_frame(small_school_days, TARGET, FIXTURE_REGRESSORS), params,
                        FIXTURE_REGRESSORS, 0.8, 200)
    metadata = {
        "model_type": "prophet", "model_name": "test_prophet", "target": TARGET,
        "regressors": FIXTURE_REGRESSORS, "prophet_params": params, "interval_width": 0.8,
        "random_seed": 1, "trained_at_utc": "2026-01-01T00:00:00+00:00",
        "training_data": {"first_date": "2022-01-03", "last_date": "2023-12-31", "school_days": len(small_school_days),
                          "last_known_enrollment": 540},
        "horizon": forecast_config["horizon"],
    }
    save_model(model, metadata, out)
    return out
