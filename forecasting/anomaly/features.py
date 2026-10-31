"""
One row of features per school-day, from the records the server holds.

Every feature is something a programme officer could check by hand, so a flag can be
explained in the same terms. Baselines (a school's usual numbers, its recent trend) use
only earlier days, so a score never depends on the future.

Inputs are data frames shaped like the server's tables (see
scripts/generate_feeding_dataset.py): schools, enrolment, feeding, stock_counts,
school_days.
"""

import numpy as np
import pandas as pd

RATION_KG = {"cereals": 0.150, "pulses": 0.040}

# The features the learning methods use, and how each is described in an explanation
FEATURES = {
    "fed_rate": "learners fed as a share of enrolment",
    "fed_vs_own": "learners fed against the school's usual number",
    "fed_vs_peers": "learners fed against similar schools nearby that day",
    "cereal_ratio": "cereals issued against the ration for learners fed",
    "pulse_ratio": "pulses issued against the ration for learners fed",
    "usage_trend": "the recent rise in food issued per learner",
    "count_gap_change": "the change in the store count's gap with the records",
    "entry_delay": "school days between the date and when the record reached the server",
    "batch_dates": "dates sent together in one sync",
    "round_share": "round numbers among recent records",
    "fed_steadiness": "how little learners fed changed from day to day",
    "edits": "times the record was edited",
    "term_position": "how far into the term the day is",
    "closing_day": "the last day of the school year",
    "opening_days": "the first days after a break",
}

# A school's usual number: the median of 40 school days, ending 10 school days back, so
# an episode that has run for a couple of weeks cannot become its own baseline
OWN_HISTORY = 40
OWN_GAP = 10
TREND_RECENT = 10
TREND_BEFORE = 30
ROUND_WINDOW = 10


def _school_day_index(school_days):
    return {d: i for i, d in enumerate(pd.to_datetime(school_days.date))}


def build_features(schools, enrolment, feeding, counts, school_days):
    days = school_days.assign(date=pd.to_datetime(school_days.date))
    index = _school_day_index(days)
    f = feeding.assign(date=pd.to_datetime(feeding.date), received_date=pd.to_datetime(feeding.received_date))
    f = f.merge(days[["date", "term_id", "term_day", "term_days", "day_type"]], on="date")
    f = f.merge(enrolment, on=["school_id", "term_id"]).merge(schools[["school_id", "sub_county"]], on="school_id")
    f = f.sort_values(["school_id", "date"]).reset_index(drop=True)

    fed = f.learners_fed.where(f.feeding_happened)
    f["fed_rate"] = (fed / f.learners).fillna(0.0)
    usual = f.groupby("school_id").learners_fed.transform(
        lambda s: s.where(s > 0).shift(OWN_GAP).rolling(OWN_HISTORY, min_periods=10).median())
    f["fed_vs_own"] = np.log((fed + 1) / (usual + 1)).fillna(0.0)
    peers = f[f.feeding_happened].groupby(["sub_county", "date"]).fed_rate.median().rename("peer_rate")
    f = f.join(peers, on=["sub_county", "date"])
    f["fed_vs_peers"] = (f.fed_rate - f.peer_rate).where(f.feeding_happened).fillna(0.0)

    for name, commodity in (("cereal_ratio", "cereals"), ("pulse_ratio", "pulses")):
        expected = fed * RATION_KG[commodity]
        f[name] = np.log((f[f"{commodity}_kg"] + 0.1) / (expected + 0.1)).where(f.feeding_happened).fillna(0.0)
    ratio = f.cereal_ratio.where(f.feeding_happened)
    recent = ratio.groupby(f.school_id).transform(lambda s: s.rolling(TREND_RECENT, min_periods=3).mean())
    before = ratio.groupby(f.school_id).transform(
        lambda s: s.shift(TREND_RECENT).rolling(TREND_BEFORE, min_periods=10).mean())
    f["usage_trend"] = (recent - before).fillna(0.0)

    # Store counts: the new gap since the last count, in days of food (cereals and
    # pulses; the worse of the two), on the day of the count
    c = counts.assign(date=pd.to_datetime(counts.date)).sort_values(["school_id", "commodity", "date"])
    c["gap"] = c.counted_kg - c.ledger_kg
    c["new_gap"] = c.gap - c.groupby(["school_id", "commodity"]).gap.shift(1).fillna(0.0)
    daily_use = f[f.feeding_happened].groupby("school_id")[["cereals_kg", "pulses_kg"]].median()
    c["daily_use"] = [daily_use.loc[s, f"{k}_kg"] if s in daily_use.index else np.nan for s, k in zip(c.school_id, c.commodity)]
    c["gap_days"] = c.new_gap / c.daily_use.replace(0, np.nan)
    worst = c.groupby(["school_id", "date"]).gap_days.min().rename("count_gap_change")
    f = f.join(worst, on=["school_id", "date"])
    f["count_gap_change"] = f.count_gap_change.fillna(0.0)

    f["entry_delay"] = [index.get(r, index[d]) - index[d] if r in index else (r - d).days * 5 / 7
                        for d, r in zip(f.date, f.received_date)]
    f["batch_dates"] = f.groupby("sync_batch_id").date.transform("nunique")
    round_fed = ((f.learners_fed % 10 == 0) & (f.learners_fed > 0)).astype(float).where(f.feeding_happened)
    f["round_share"] = round_fed.groupby(f.school_id).transform(lambda s: s.rolling(ROUND_WINDOW, min_periods=3).mean()).fillna(0.0)
    change = np.log(fed).groupby(f.school_id).diff().abs()
    f["fed_steadiness"] = -change.groupby(f.school_id).transform(lambda s: s.rolling(ROUND_WINDOW, min_periods=3).mean()).fillna(0.05)
    f["edits"] = f.version - 1
    f["term_position"] = f.term_day / f.term_days
    f["closing_day"] = (f.day_type == "last day of school year").astype(float)
    f["opening_days"] = f.day_type.isin(["first days after a break", "first day of school year"]).astype(float)
    return f
