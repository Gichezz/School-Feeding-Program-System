"""
Baseline forecasters.

Both baselines produce a single level from observations strictly before the
forecast origin and use it for every school day in the horizon. Later days in
the horizon never use actual values from earlier days in the same horizon.
"""

import numpy as np
import pandas as pd


class InsufficientHistoryError(ValueError):
    """Raised when there are no past observations to forecast from."""


def _history_before(dates, values, origin):
    dates = pd.to_datetime(pd.Series(dates)).reset_index(drop=True)
    values = pd.Series(values, dtype=float).reset_index(drop=True)
    mask = dates < pd.Timestamp(origin)
    return dates[mask], values[mask]


class HistoricalAverage:
    """
    Mean demand of previous school days.

    window_days=None -> expanding mean over all history before the origin.
    window_days=N    -> mean over school days in the N calendar days before the
                        origin. If that window is empty (e.g. after a long
                        break), it falls back to the expanding mean.
    """

    def __init__(self, window_days=None):
        self.window_days = window_days
        self.name = "historical_average_" + (f"trailing_{window_days}d" if window_days else "expanding")

    def forecast_level(self, dates, values, origin):
        d, v = _history_before(dates, values, origin)
        if v.empty:
            raise InsufficientHistoryError("No school days before the forecast origin")
        if self.window_days:
            recent = v[d >= pd.Timestamp(origin) - pd.Timedelta(days=self.window_days)]
            if not recent.empty:
                return float(recent.mean())
        return float(v.mean())

    def predict(self, dates, values, origin, target_dates):
        level = self.forecast_level(dates, values, origin)
        return np.full(len(target_dates), level)


class MovingAverage:
    """
    Mean of the last `window` school days before the origin.

    With fewer than `window` (but at least one) past observations, the mean of
    the available ones is used; with none, InsufficientHistoryError is raised.
    """

    def __init__(self, window):
        if window < 1:
            raise ValueError("window must be >= 1")
        self.window = int(window)
        self.name = f"moving_average_{self.window}"

    def forecast_level(self, dates, values, origin):
        _, v = _history_before(dates, values, origin)
        if v.empty:
            raise InsufficientHistoryError("No school days before the forecast origin")
        return float(v.iloc[-self.window:].mean())

    def predict(self, dates, values, origin, target_dates):
        level = self.forecast_level(dates, values, origin)
        return np.full(len(target_dates), level)
