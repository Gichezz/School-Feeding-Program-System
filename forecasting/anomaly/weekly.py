"""
A school's score for a week, from its school-days' scores.

Protocol version 8 (config/anomaly_v8.yaml, data/reports/anomaly/v8) chose the mean of the
two highest days on the selection year: one unusual day at an ordinary school no longer
outranks a problem that lasts several days. A week with one school day uses that day.
Version 7 used the single highest day ("max").
"""

import numpy as np
from scipy.stats import beta

WEEKLY_AGGREGATION = "top2_mean"


def weekly_scores(frame, aggregation=WEEKLY_AGGREGATION, keys=("school_id", "week")):
    """frame has a score column and the key columns; returns a Series indexed by the keys."""
    days = frame.groupby(list(keys)).score
    first = days.max()
    if aggregation == "max":
        return first
    second = days.apply(lambda s: s.nlargest(2).iloc[-1])
    if aggregation == "top2_mean":
        return (first + second) / 2
    if aggregation == "weighted":
        return 0.6 * first + 0.4 * second
    raise ValueError(f"Unknown weekly aggregation: {aggregation}")


def two_week_mean(weekly):
    """Each school-week's score averaged with the school's previous week that has records
    (protocol version 11, step 5): a problem that goes on scores higher than one odd week.
    weekly: a Series indexed by (school_id, week), weeks as ISO "%G-%V"; a school's first
    week keeps its own score."""
    weekly = weekly.sort_index()
    previous = weekly.groupby(level=0).shift(1)
    return ((weekly + previous) / 2).fillna(weekly)


def review_threshold(scores, q, estimator="interpolated"):
    """The q-quantile of the training window's school-week scores; None for no threshold.

    interpolated: between the two nearest school-weeks (versions 7-10).
    harrell_davis: a weighted mean of every school-week's score, weighted towards the
        q-quantile (Harrell and Davis, 1982), so the threshold does not rest on the few
        school-weeks at the top (protocol version 11, step 4)."""
    if q is None:
        return None
    values = np.asarray(scores, dtype=float)
    if estimator == "interpolated":
        return float(np.quantile(values, q))
    if estimator == "harrell_davis":
        x = np.sort(values)
        n = len(x)
        edges = beta.cdf(np.arange(n + 1) / n, (n + 1) * q, (n + 1) * (1 - q))
        return float(np.dot(np.diff(edges), x))
    raise ValueError(f"Unknown threshold estimator: {estimator}")
