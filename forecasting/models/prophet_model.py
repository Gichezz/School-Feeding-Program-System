"""
Facebook Prophet model: build, fit, predict, save and load.

Input is school days only (ds = date, y = estimated_meal_demand). Prophet
handles the irregular spacing; it is only asked to predict school days.

Reproducibility: the Stan optimiser (L-BFGS) starts from Prophet's fixed
initial values, so point fits are deterministic for the same data and
versions. Interval sampling uses NumPy's global RNG, which is seeded before
every prediction.
"""

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd

logging.getLogger("prophet.plot").setLevel(logging.CRITICAL)  # optional plotly not installed
logging.getLogger("cmdstanpy").setLevel(logging.WARNING)

from prophet import Prophet  # noqa: E402
from prophet.serialize import model_from_json, model_to_json  # noqa: E402

PROPHET_PARAM_KEYS = {
    "weekly_seasonality", "yearly_seasonality", "daily_seasonality",
    "changepoint_prior_scale", "seasonality_mode", "seasonality_prior_scale",
}


def build_prophet(params, regressors=(), interval_width=0.8, uncertainty_samples=1000):
    kwargs = {k: v for k, v in params.items() if k in PROPHET_PARAM_KEYS}
    m = Prophet(interval_width=interval_width, uncertainty_samples=uncertainty_samples, **kwargs)
    for r in regressors:
        m.add_regressor(r)
    return m


def training_frame(school_days, target, regressors=(), date_column="date"):
    cols = {"ds": school_days[date_column].values, "y": school_days[target].astype(float).values}
    for r in regressors:
        cols[r] = school_days[r].astype(float).values
    frame = pd.DataFrame(cols)
    if frame[["y", *regressors]].isna().any().any():
        raise ValueError("Training frame contains missing values")
    return frame


def fit_prophet(train, params, regressors=(), interval_width=0.8, uncertainty_samples=1000):
    m = build_prophet(params, regressors, interval_width, uncertainty_samples)
    m.fit(train)
    return m


def predict_prophet(model, future, seed=0, interval_width=None):
    """
    Predict for the rows in `future` (columns ds + any regressors). Returns
    ds, yhat, yhat_lower, yhat_upper, clipped at zero (demand cannot be negative).
    """
    missing = [r for r in model.extra_regressors if r not in future.columns]
    if missing:
        raise ValueError(f"Future frame is missing regressors: {missing}")
    original = model.interval_width
    if interval_width is not None:
        model.interval_width = interval_width
    try:
        np.random.seed(seed)
        fc = model.predict(future)
    finally:
        model.interval_width = original
    out = fc[["ds", "yhat", "yhat_lower", "yhat_upper"]].copy()
    for c in ("yhat", "yhat_lower", "yhat_upper"):
        out[c] = out[c].clip(lower=0)
    return out.reset_index(drop=True)


def save_model(model, metadata, directory, model_file="prophet_model.json", metadata_file="model_metadata.json"):
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    (directory / model_file).write_text(model_to_json(model), encoding="utf-8")
    (directory / metadata_file).write_text(json.dumps(metadata, indent=2, default=str) + "\n", encoding="utf-8")
    return directory / model_file, directory / metadata_file


def load_model(directory, model_file="prophet_model.json", metadata_file="model_metadata.json"):
    directory = Path(directory)
    mpath, meta_path = directory / model_file, directory / metadata_file
    if not mpath.exists() or not meta_path.exists():
        raise FileNotFoundError(f"Model artifact not found in {directory} (expected {model_file} and {metadata_file})")
    model = model_from_json(mpath.read_text(encoding="utf-8"))
    metadata = json.loads(meta_path.read_text(encoding="utf-8"))
    return model, metadata
