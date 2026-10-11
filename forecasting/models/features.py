"""
Forecast-time features.

Only information available BEFORE a forecast date is used:
  * calendar flags (school day, first day/week of term, exam period) come from
    the configured school calendar in config/synthetic_kenya_school.yaml, via
    the Phase 9 calendar builder, so future dates use the same rules;
  * enrollment is the last value known at the forecast origin, held constant
    over the horizon (school records).
Same-day attendance, meals, rainfall and unscheduled events are never used.
"""

import copy
import sys

import pandas as pd

from models.data import FORECASTING_DIR

SCRIPTS_DIR = FORECASTING_DIR / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from common import load_config as load_calendar_config  # noqa: E402  (Phase 9 helper)
from generate_synthetic_dataset import build_calendar  # noqa: E402  (Phase 9 calendar)

CALENDAR_REGRESSORS = ["first_day_of_term", "first_week_of_term", "exam_period"]


def add_calendar_features(frame):
    """
    Add calendar regressors to a frame of SCHOOL DAYS sorted by date, with
    columns: term, week_of_term, is_exam_period.
    """
    out = frame.copy()
    out["first_day_of_term"] = (~out["term"].duplicated()).astype(float)
    out["first_week_of_term"] = (out["week_of_term"].astype(float) == 1).astype(float)
    out["exam_period"] = out["is_exam_period"].astype(bool).astype(float)
    return out


def future_school_days(start, end, calendar_cfg=None):
    """
    School days between start and end (inclusive) according to the configured
    calendar, with calendar regressors. Whole years are built so that
    'first day of term' is detected correctly at the window edges.
    """
    start, end = pd.Timestamp(start), pd.Timestamp(end)
    cfg = copy.deepcopy(calendar_cfg or load_calendar_config())
    cfg["period"] = {"start_date": f"{start.year}-01-01", "end_date": f"{end.year}-12-31"}
    cal, _ = build_calendar(cfg)
    school = cal[cal["is_school_day"]].reset_index(drop=True)
    school = add_calendar_features(school)
    window = school[(school["date"] >= start) & (school["date"] <= end)]
    calendar_days = (end - start).days + 1
    return window.reset_index(drop=True), calendar_days


def last_known_enrollment(school_days, origin):
    """Enrollment on the last school day strictly before the forecast origin."""
    past = school_days[school_days["date"] < pd.Timestamp(origin)]
    if past.empty:
        raise ValueError("No enrollment known before the forecast origin")
    return float(past["students_enrolled"].iloc[-1])
