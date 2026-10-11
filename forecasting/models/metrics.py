"""
Forecast error metrics.

WAPE (sum |error| / sum |actual|) is the primary percentage metric. MAPE is
also reported, but only over actuals >= `mape_min_actual`, so it never divides
by zero; the number of excluded observations is returned alongside it.
"""

import numpy as np


def compute_metrics(actual, predicted, mape_min_actual=1.0):
    a = np.asarray(actual, dtype=float)
    p = np.asarray(predicted, dtype=float)
    if a.shape != p.shape:
        raise ValueError("actual and predicted must have the same shape")
    if a.size == 0:
        return {"n": 0, "mae": None, "rmse": None, "wape": None, "mape": None, "mape_n": 0,
                "mape_excluded": 0, "bias": None}
    err = p - a
    denom = np.abs(a).sum()
    ok = np.abs(a) >= mape_min_actual
    return {
        "n": int(a.size),
        "mae": float(np.mean(np.abs(err))),
        "rmse": float(np.sqrt(np.mean(err ** 2))),
        "wape": float(np.abs(err).sum() / denom) if denom > 0 else None,
        "mape": float(np.mean(np.abs(err[ok]) / np.abs(a[ok]))) if ok.any() else None,
        "mape_n": int(ok.sum()),
        "mape_excluded": int((~ok).sum()),
        "bias": float(np.mean(err)),
    }


def interval_coverage(actual, lower, upper):
    a, lo, hi = (np.asarray(x, dtype=float) for x in (actual, lower, upper))
    if a.size == 0:
        return None
    return float(np.mean((a >= lo) & (a <= hi)))
