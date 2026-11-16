"""
A school's score for a week, from its school-days' scores.

Protocol version 8 (config/anomaly_v8.yaml, data/reports/anomaly/v8) chose the mean of the
two highest days on the selection year: one unusual day at an ordinary school no longer
outranks a problem that lasts several days. A week with one school day uses that day.
Version 7 used the single highest day ("max").
"""

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
