"""
School days and the kind of each day, from term dates and closed dates.

Shared by the synthetic data generator and the scoring service, so the day types the
models were evaluated on are computed exactly as in production.
"""

import datetime as dt

import pandas as pd


def school_days(terms, closed_dates, end_date=None):
    """
    terms: [{year, term, opens_on, closes_on, half_term_start, half_term_end}] (dates);
    closed_dates: public holidays and school closures. Returns one row per school day:
    date, year, term, term_id, term_day, term_days, day_type.
    """
    closed = set(closed_dates)
    rows = []
    for t in sorted(terms, key=lambda t: t["opens_on"]):
        last = min(t["closes_on"], end_date) if end_date else t["closes_on"]
        half = (t.get("half_term_start"), t.get("half_term_end"))
        days = []
        d = t["opens_on"]
        while d <= last:
            in_half = half[0] is not None and half[0] <= d <= half[1]
            if d.weekday() < 5 and d not in closed and not in_half:
                days.append(d)
            d += dt.timedelta(days=1)
        for i, d in enumerate(days):
            after_break = i == 0 or (d - days[i - 1]).days > 3
            before_break = i == len(days) - 1 or (days[i + 1] - d).days > 3
            if i == 0 and t["term"] == 1:
                day_type = "first day of school year"
            elif i == len(days) - 1 and t["term"] == 3:
                day_type = "last day of school year"
            elif after_break:
                day_type = "first days after a break"
            elif before_break:
                day_type = "last days before a break"
            else:
                day_type = "ordinary"
            rows.append({"date": d, "year": t["year"], "term": t["term"], "term_id": t.get("term_id", f"{t['year']}-T{t['term']}"),
                         "term_day": i, "term_days": len(days), "day_type": day_type})
    return pd.DataFrame(rows)
