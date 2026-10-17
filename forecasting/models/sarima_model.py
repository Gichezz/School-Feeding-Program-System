"""
Seasonal ARIMA with calendar regressors (SARIMAX, statsmodels): the classical
statistical alternative to Prophet (issue #48).

The series is the sequence of school days, so the weekly season is 5 steps.
Holidays are gaps in the calendar, not zeros, exactly as for the other models.
ARIMA has no yearly season or calendar events of its own, so they are given
as exogenous regressors: first day/week of term, exam period, enrollment (last
known value held constant over the horizon) and the position in the year
(sine/cosine). This makes it a fair opponent rather than a plain ARIMA.

The model is refitted at every forecast origin on the most recent
`history_school_days` school days (about three school years by default) to keep
fitting time reasonable; the order is chosen on the validation period from a
small set of candidates, like Prophet's settings.
"""

import warnings

import numpy as np
import pandas as pd
from statsmodels.tools.sm_exceptions import ConvergenceWarning
from statsmodels.tsa.statespace.sarimax import SARIMAX

EXOG = ["first_day_of_term", "first_week_of_term", "exam_period", "students_enrolled", "doy_sin", "doy_cos"]


def exog_frame(rows, enrollment=None):
    """Exogenous regressors for school-day rows; enrollment constant for forecast rows."""
    doy = pd.to_datetime(rows["date"]).dt.dayofyear.to_numpy(dtype=float)
    return pd.DataFrame({
        "first_day_of_term": rows["first_day_of_term"].astype(float).to_numpy(),
        "first_week_of_term": rows["first_week_of_term"].astype(float).to_numpy(),
        "exam_period": rows["exam_period"].astype(float).to_numpy(),
        "students_enrolled": (np.full(len(rows), float(enrollment)) if enrollment is not None
                              else rows["students_enrolled"].astype(float).to_numpy()),
        "doy_sin": np.sin(2 * np.pi * doy / 365.25),
        "doy_cos": np.cos(2 * np.pi * doy / 365.25),
    })[EXOG]


class SarimaForecaster:
    def __init__(self, name, target, order, seasonal_order, trend="c", history_school_days=750):
        self.name = name
        self.target = target
        self.order = tuple(order)
        self.seasonal_order = tuple(seasonal_order)
        self.trend = trend
        self.history_school_days = int(history_school_days)

    def fit(self, history):
        recent = history.tail(self.history_school_days)
        model = SARIMAX(
            recent[self.target].astype(float).to_numpy(),
            exog=exog_frame(recent).to_numpy(),
            order=self.order,
            seasonal_order=self.seasonal_order,
            trend=self.trend,
            enforce_stationarity=False,
            enforce_invertibility=False,
        )
        with warnings.catch_warnings():
            # The optimiser's occasional convergence notices are expected on a refit-per-origin run
            warnings.simplefilter("ignore", ConvergenceWarning)
            warnings.simplefilter("ignore", UserWarning)
            return model.fit(disp=False, maxiter=200)

    def predict_window(self, history, targets, enrollment):
        """
        Targets must be the school days straight after the history (as built by
        forecast_windows), so `len(targets)` steps ahead covers them in order.
        """
        fitted = self.fit(history)
        future = exog_frame(targets, enrollment).to_numpy()
        return np.asarray(fitted.forecast(steps=len(targets), exog=future), dtype=float)
