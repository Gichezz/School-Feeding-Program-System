"""
One row of features per school-day, from the records the server holds.

Every feature is something a programme officer could check by hand, so a flag can be
explained in the same terms. Baselines (a school's usual numbers, its recent trend) use
only earlier days, so a score never depends on the future.

The kind of day (first days after a break, the closing day) changes what is normal; it
is not itself evidence. Learners fed is compared with what is normal for that kind of
day, and days with no feeding (which carry a reason code) are neutral on the feeding
figures.

Inputs are data frames shaped like the server's tables (see
scripts/generate_feeding_dataset.py): schools, enrolment, feeding, stock_counts,
school_days.
"""

import numpy as np
import pandas as pd

RATION_KG = {"cereals": 0.150, "pulses": 0.040}

# The features the learning methods use, and how each is described in an explanation.
# The same list, with the reason for each, is fixed in config/anomaly_evaluation.yaml.
FEATURES = {
    "fed_rate": "learners fed as a share of enrolment, for that kind of day",
    "fed_vs_own": "learners fed against the school's usual number for that kind of day",
    "fed_vs_peers": "learners fed against similar schools nearby that day",
    "fed_rate_vs_last_term": "the share fed against the school's share last term",
    "enrolment_change": "enrolment against last term",
    "uptake": "learners fed as a share of learners present",
    "cereal_ratio": "cereals issued against the ration for learners fed",
    "pulse_ratio": "pulses issued against the ration for learners fed",
    "usage_trend": "the recent rise in food issued per learner",
    "count_gap_change": "the change in the store count's gap with the records",
    "entry_delay": "school days between the date and when the record reached the server",
    "batch_dates": "dates sent together in one sync",
    "after_hours_share": "recent records entered outside school hours",
    "round_share": "round numbers among recent records",
    "fed_steadiness": "how little learners fed changed from day to day",
}

# A school's usual number: the median of 40 school days, ending 10 school days back, so
# an episode that has run for a couple of weeks cannot become its own baseline
OWN_HISTORY = 40
OWN_GAP = 10
SCHOOL_HOURS = (6, 18)   # the same window the server's outside-hours check uses
TREND_RECENT = 10
TREND_BEFORE = 30
ROUND_WINDOW = 10
PATTERN_WINDOW = 10


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
    # The share fed as recorded (the rules and the explanations use it as it is)
    f["share_fed"] = (fed / f.learners).fillna(0.0)
    usual = f.groupby("school_id").learners_fed.transform(
        lambda s: s.where(s > 0).shift(OWN_GAP).rolling(OWN_HISTORY, min_periods=10).median())
    # What each kind of day does to learners fed: the median, across schools, of learners
    # fed against the school's usual number (no labels are used)
    effect = (fed / usual).groupby(f.day_type).median()
    effect = (effect / effect.get("ordinary", 1.0)).fillna(1.0)
    f["day_effect"] = f.day_type.map(effect).fillna(1.0)
    usual_rate = f.share_fed.where(f.feeding_happened).groupby(f.school_id).transform("median")
    f["fed_rate"] = (f.share_fed / f.day_effect).where(f.feeding_happened).fillna(usual_rate).fillna(0.0)
    f["fed_vs_own"] = np.log((fed + 1) / (usual * f.day_effect + 1)).fillna(0.0)
    peers = f[f.feeding_happened].groupby(["sub_county", "date"]).share_fed.median().rename("peer_rate")
    f = f.join(peers, on=["sub_county", "date"])
    f["fed_vs_peers"] = (f.share_fed - f.peer_rate).where(f.feeding_happened).fillna(0.0)

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
    f["count_gap_change"] = f.count_gap_change.astype(float).fillna(0.0)

    f["entry_delay"] = [index.get(r, index[d]) - index[d] if r in index else (r - d).days * 5 / 7
                        for d, r in zip(f.date, f.received_date)]
    f["batch_dates"] = f.groupby("sync_batch_id").date.transform("nunique")
    round_fed = ((f.learners_fed % 10 == 0) & (f.learners_fed > 0)).astype(float).where(f.feeding_happened)
    f["round_share"] = round_fed.groupby(f.school_id).transform(lambda s: s.rolling(ROUND_WINDOW, min_periods=3).mean()).fillna(0.0)
    change = np.log(fed).groupby(f.school_id).diff().abs()
    f["fed_steadiness"] = -change.groupby(f.school_id).transform(lambda s: s.rolling(ROUND_WINDOW, min_periods=3).mean()).fillna(0.05)
    # Enrolment and the share fed against the school's previous term
    terms = days.drop_duplicates("term_id")[["term_id"]].reset_index(drop=True)
    order = {t: i for i, t in enumerate(terms.term_id)}
    e = enrolment.assign(order=enrolment.term_id.map(order)).sort_values(["school_id", "order"])
    e["previous"] = e.groupby("school_id").learners.shift(1)
    e["enrolment_change"] = np.log(e.learners / e.previous).fillna(0.0)
    f = f.merge(e[["school_id", "term_id", "enrolment_change"]], on=["school_id", "term_id"], how="left")
    term_rate = f[f.feeding_happened].groupby(["school_id", "term_id"]).share_fed.mean().rename("term_rate").reset_index()
    term_rate["order"] = term_rate.term_id.map(order)
    term_rate = term_rate.sort_values(["school_id", "order"])
    term_rate["last_term_rate"] = term_rate.groupby("school_id").term_rate.shift(1)
    f = f.merge(term_rate[["school_id", "term_id", "last_term_rate"]], on=["school_id", "term_id"], how="left")
    f["fed_rate_vs_last_term"] = (f.share_fed - f.last_term_rate).where(f.feeding_happened).fillna(0.0)

    # Learners fed as a share of present, where present is recorded; elsewhere the
    # typical value, so a school that leaves the field empty is not singled out
    present = f.learners_present.where(f.feeding_happened & (f.learners_present > 0))
    uptake = f.learners_fed / present
    f["uptake"] = uptake.fillna(uptake.median() if uptake.notna().any() else 1.0)

    # One late entry means little; a school that often enters records late at night or at
    # weekends is a pattern worth a look
    captured = pd.to_datetime(f.captured_at)
    f["outside_hours"] = ((captured.dt.hour < SCHOOL_HOURS[0]) | (captured.dt.hour >= SCHOOL_HOURS[1])
                          | (captured.dt.weekday >= 5)).astype(float)
    f["after_hours_share"] = f.groupby("school_id").outside_hours.transform(
        lambda s: s.rolling(PATTERN_WINDOW, min_periods=1).mean())
    return f
