"""
Rolling-origin evaluation.

For each forecast origin o (a forecast made using data up to o - 1 day):
  * history  = school days strictly before o (expanding window);
  * targets  = school days in [o, o + max_horizon - 1] that fall inside the
               evaluation period (validation or test);
  * every model forecasts the same targets from the same history, without
    seeing any actual value inside the horizon.
A horizon of H days scores the targets with days_ahead <= H.
"""

import numpy as np
import pandas as pd

from models.baselines import InsufficientHistoryError
from models.features import last_known_enrollment
from models.metrics import compute_metrics, interval_coverage
from models.prophet_model import fit_prophet, predict_prophet, training_frame


def make_origins(start, end, step_days):
    return list(pd.date_range(pd.Timestamp(start), pd.Timestamp(end), freq=f"{int(step_days)}D"))


def forecast_windows(school, period_start, period_end, step_days, max_horizon):
    """Yield (origin, history_frame, target_frame) for each origin with >= 1 target."""
    period_start, period_end = pd.Timestamp(period_start), pd.Timestamp(period_end)
    windows = []
    for o in make_origins(period_start, period_end, step_days):
        last = min(o + pd.Timedelta(days=max_horizon - 1), period_end)
        targets = school[(school["date"] >= o) & (school["date"] <= last)].copy()
        if targets.empty:
            continue
        history = school[school["date"] < o]
        targets["days_ahead"] = (targets["date"] - o).dt.days + 1
        windows.append((o, history, targets))
    return windows


def run_baseline(model, windows, target):
    rows = []
    for origin, history, targets in windows:
        try:
            yhat = model.predict(history["date"], history[target], origin, targets["date"])
        except InsufficientHistoryError:
            continue
        rows.append(pd.DataFrame({
            "model": model.name, "origin": origin, "date": targets["date"].values,
            "days_ahead": targets["days_ahead"].values, "actual": targets[target].values, "yhat": yhat,
        }))
    return pd.concat(rows, ignore_index=True)


def prophet_future_frame(targets, regressors, enrollment):
    future = pd.DataFrame({"ds": targets["date"].values})
    for r in regressors:
        # Enrollment is not known for future days: hold the last known value constant.
        future[r] = enrollment if r == "students_enrolled" else targets[r].astype(float).values
    return future


def run_prophet(spec, windows, target, prophet_cfg, coverage_levels=()):
    regs = spec["regressors"]
    rows = []
    for origin, history, targets in windows:
        train = training_frame(history, target, regs)
        m = fit_prophet(train, spec["params"], regs, prophet_cfg["interval_width"],
                        prophet_cfg["uncertainty_samples"])
        enrollment = last_known_enrollment(history, origin) if "students_enrolled" in regs else None
        future = prophet_future_frame(targets, regs, enrollment)
        fc = predict_prophet(m, future, seed=prophet_cfg["random_seed"])
        part = pd.DataFrame({
            "model": spec["name"], "origin": origin, "date": targets["date"].values,
            "days_ahead": targets["days_ahead"].values, "actual": targets[target].values,
            "yhat": fc["yhat"].values,
        })
        for level in coverage_levels:
            iv = predict_prophet(m, future, seed=prophet_cfg["random_seed"], interval_width=level)
            tag = int(round(level * 100))
            part[f"lower_{tag}"] = iv["yhat_lower"].values
            part[f"upper_{tag}"] = iv["yhat_upper"].values
        rows.append(part)
    return pd.concat(rows, ignore_index=True)


def summarise(preds, horizons, mape_min_actual):
    """Metrics per (model, horizon), including counts, date ranges and interval coverage."""
    out = []
    for model, g in preds.groupby("model", sort=False):
        for h in horizons:
            s = g[g["days_ahead"] <= h]
            row = {"model": model, "horizon_days": h,
                   **compute_metrics(s["actual"], s["yhat"], mape_min_actual),
                   "origins": int(s["origin"].nunique()),
                   "first_target": str(s["date"].min().date()) if len(s) else None,
                   "last_target": str(s["date"].max().date()) if len(s) else None}
            for col in s.columns:
                if col.startswith("lower_"):
                    tag = col.split("_")[1]
                    # Models without intervals (the baselines) have NaN bounds: report None, not 0% coverage
                    has_iv = s[col].notna() & s[f"upper_{tag}"].notna()
                    row[f"coverage_{tag}"] = (interval_coverage(s.loc[has_iv, "actual"], s.loc[has_iv, col],
                                                                s.loc[has_iv, f"upper_{tag}"])
                                              if has_iv.all() and len(s) else None)
            out.append(row)
    return pd.DataFrame(out)


def summary_records(summary):
    """Summary rows as dicts with missing values as None (JSON null, never NaN)."""
    return [{k: (None if isinstance(v, float) and np.isnan(v) else v) for k, v in row.items()}
            for row in summary.to_dict("records")]


def mean_metric(summary, model, metric):
    return float(np.mean(summary.loc[summary["model"] == model, metric]))
