"""
Machine-learning alternatives to Prophet (issue #48): Random Forest and
gradient-boosted trees (scikit-learn), evaluated with the same rolling-origin
windows as every other model.

Tree models have no built-in notion of time, so time is given to them as
features (the feature engineering the literature review notes they need):
  * calendar: weekday, month, position in the year (sine/cosine), term number,
    week of term, first day/week of term, exam period;
  * enrollment: actual value for training rows, and the last value known at the
    origin for forecast rows (school records, held constant like Prophet);
  * lagged demand, always at least LAG_GAP_DAYS before the day being predicted:
    the mean over [t - 58, t - 30] days and the value on t - 35 days (same
    weekday). Because the gap is at least the longest horizon (30 days), every
    forecast in the horizon can be built from history before the origin alone,
    with the same features the model was trained on. No forecast is fed back as
    an input (no recursion) and no value on or after the origin is ever used.
The model is refitted at every forecast origin on all school days before it.
"""

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor, RandomForestRegressor

LAG_GAP_DAYS = 30
LAG_WINDOW_DAYS = 28
SAME_WEEKDAY_LAG_DAYS = 35

FEATURES = [
    "day_of_week", "month", "doy_sin", "doy_cos", "term_number", "week_of_term",
    "first_day_of_term", "first_week_of_term", "exam_period", "students_enrolled",
    "lag_mean_30_58", "lag_same_weekday_35",
]


def calendar_features(frame):
    """Calendar features for school-day rows with date, term, week_of_term and the flags."""
    dates = pd.to_datetime(frame["date"])
    doy = dates.dt.dayofyear.to_numpy(dtype=float)
    return pd.DataFrame({
        "day_of_week": dates.dt.dayofweek.to_numpy(dtype=float),
        "month": dates.dt.month.to_numpy(dtype=float),
        "doy_sin": np.sin(2 * np.pi * doy / 365.25),
        "doy_cos": np.cos(2 * np.pi * doy / 365.25),
        "term_number": frame["term"].astype(str).str[-1].astype(float).to_numpy(),
        "week_of_term": frame["week_of_term"].astype(float).to_numpy(),
        "first_day_of_term": frame["first_day_of_term"].astype(float).to_numpy(),
        "first_week_of_term": frame["first_week_of_term"].astype(float).to_numpy(),
        "exam_period": frame["exam_period"].astype(float).to_numpy(),
    }, index=frame.index)


def lag_features(dates, history_dates, history_values):
    """
    Lagged demand for each date, from history (school days before the origin) only.
    History is laid on a daily calendar (NaN on non-school days) so the lags are
    in calendar days, as in the module docstring.
    """
    known = pd.Series(np.asarray(history_values, dtype=float), index=pd.to_datetime(history_dates))
    if known.empty:
        return pd.DataFrame({"lag_mean_30_58": np.nan, "lag_same_weekday_35": np.nan}, index=range(len(dates)))
    dates = pd.to_datetime(pd.Series(dates)).reset_index(drop=True)
    end = max(known.index.max(), dates.max())
    daily = known.reindex(pd.date_range(known.index.min(), end, freq="D"))
    window_mean = daily.shift(LAG_GAP_DAYS).rolling(LAG_WINDOW_DAYS + 1, min_periods=1).mean()
    same_weekday = daily.shift(SAME_WEEKDAY_LAG_DAYS)
    out = pd.DataFrame({
        "lag_mean_30_58": window_mean.reindex(dates).to_numpy(),
        "lag_same_weekday_35": same_weekday.reindex(dates).to_numpy(),
    })
    # A holiday 35 days back has no value: use the window mean instead
    out["lag_same_weekday_35"] = out["lag_same_weekday_35"].fillna(out["lag_mean_30_58"])
    return out


def feature_matrix(rows, history, target, enrollment=None):
    """
    Features for `rows` (school days) using only `history` (school days before
    the origin). enrollment: a constant for forecast rows, or None to use each
    row's own value (training rows, where it was known on the day).
    """
    X = calendar_features(rows).reset_index(drop=True)
    X["students_enrolled"] = (float(enrollment) if enrollment is not None
                              else rows["students_enrolled"].astype(float).to_numpy())
    lags = lag_features(rows["date"], history["date"], history[target])
    X["lag_mean_30_58"] = lags["lag_mean_30_58"].to_numpy()
    X["lag_same_weekday_35"] = lags["lag_same_weekday_35"].to_numpy()
    return X[FEATURES]


class TreeForecaster:
    """Shared fit-at-origin / predict-the-window logic for the tree models."""

    def __init__(self, name, target, random_seed):
        self.name = name
        self.target = target
        self.random_seed = random_seed

    def build(self):
        raise NotImplementedError

    def predict_window(self, history, targets, enrollment):
        if (targets["days_ahead"] > LAG_GAP_DAYS).any():
            raise ValueError(f"Lag features support horizons up to {LAG_GAP_DAYS} days")
        X_train = feature_matrix(history, history, self.target)
        y_train = history[self.target].astype(float).to_numpy()
        usable = X_train["lag_mean_30_58"].notna().to_numpy()
        model = self.build()
        model.fit(X_train[usable], y_train[usable])
        return model.predict(feature_matrix(targets, history, self.target, enrollment))


class RandomForestForecaster(TreeForecaster):
    def __init__(self, name, target, random_seed, n_estimators=300, min_samples_leaf=1, max_features=0.5):
        super().__init__(name, target, random_seed)
        self.params = {"n_estimators": n_estimators, "min_samples_leaf": min_samples_leaf, "max_features": max_features}

    def build(self):
        return RandomForestRegressor(random_state=self.random_seed, n_jobs=-1, **self.params)


class GradientBoostingForecaster(TreeForecaster):
    """Histogram-based gradient-boosted trees (the LightGBM algorithm, in scikit-learn)."""

    def __init__(self, name, target, random_seed, learning_rate=0.05, max_iter=400, max_leaf_nodes=15):
        super().__init__(name, target, random_seed)
        self.params = {"learning_rate": learning_rate, "max_iter": max_iter, "max_leaf_nodes": max_leaf_nodes}

    def build(self):
        return HistGradientBoostingRegressor(random_state=self.random_seed, **self.params)
