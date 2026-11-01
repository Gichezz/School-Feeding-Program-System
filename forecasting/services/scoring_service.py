"""
Weekly review scoring for one sub-county, as evaluated in the deployment-matching test
(config/anomaly_deployment_test.yaml, data/reports/anomaly/deployment/).

The backend sends the sub-county's records; nothing is stored here and the database is
never read. For the week requested:

  1. The model is Extended Isolation Forest fitted on the sub-county's last 125 school days
     before the most recent refit point (the one-class SVM is kept as a benchmark in the
     evaluation). Refit points fall every 20 school days, so the model only changes about
     monthly, as tested, without any model having to be saved.
  2. School-weeks an officer marked follow-up are left out of the fit.
  3. The week's school-days are scored; each school's week takes its highest day.
  4. Every school is returned in rank order, the top k marked as the week's list, each
     with its two main reasons in plain words. Fixed rule breaches are returned for every
     day, whatever the ranking.
  5. A sub-county with fewer than 60 school days of history is ranked by the rules alone.

The method and its settings are those chosen in protocol version 6 (Extended Isolation
Forest led all three studies; docs/anomaly-detection.md) and stay fixed.
"""

import datetime as dt

# Imported here so a missing or broken isotree stops the service at start-up (and its
# health check), instead of failing the first weekly list
import isotree  # noqa: F401
import numpy as np
import pandas as pd

from anomaly.calendar import school_days
from anomaly.explain import describe, explain
from anomaly.features import build_features
from anomaly.methods import ExtendedIsolationForestMethod, Rules

METHOD = "extended_isolation_forest"
SETTINGS = {"n_estimators": 300, "ndim": 2}
REFIT_EVERY = 20
WINDOW = 125
MIN_HISTORY = 60
DEFAULT_K = 3
NOTICE = ("Ranks records for review; it does not decide anything. Thresholds and settings were tested on "
          "synthetic data and need checking against real records.")


class ScoringError(Exception):
    status_code = 400


def _date(value, field):
    try:
        return dt.date.fromisoformat(str(value)[:10])
    except ValueError as e:
        raise ScoringError(f"{field} must be a date (YYYY-MM-DD)") from e


def _frame(body, key, required):
    rows = body.get(key)
    if not isinstance(rows, list):
        raise ScoringError(f"{key} must be a list")
    df = pd.DataFrame(rows)
    missing = [c for c in required if c not in df.columns] if len(df) else []
    if missing:
        raise ScoringError(f"{key} is missing {', '.join(missing)}")
    return df if len(df) else pd.DataFrame(columns=required)


def calendar_from(body):
    terms = [{"year": int(t["year"]), "term": int(t["term"]), "term_id": t["id"],
              "opens_on": _date(t["opens_on"], "opens_on"), "closes_on": _date(t["closes_on"], "closes_on"),
              "half_term_start": _date(t["half_term_start"], "half_term_start") if t.get("half_term_start") else None,
              "half_term_end": _date(t["half_term_end"], "half_term_end") if t.get("half_term_end") else None}
             for t in body.get("terms", [])]
    if not terms:
        raise ScoringError("terms are required")
    closed = set()
    for e in body.get("closed", []):
        d, last = _date(e["starts_on"], "starts_on"), _date(e["ends_on"], "ends_on")
        while d <= last:
            closed.add(d)
            d += dt.timedelta(days=1)
    return school_days(terms, closed)


def _reasons(contributions, row):
    top = [f for f, _ in sorted(contributions.items(), key=lambda kv: -kv[1])][:2]
    return [describe(f, row) for f in top]


def score_week(body):
    week_start = _date(body.get("week_start"), "week_start")
    k = int(body.get("k", DEFAULT_K))
    calendar = calendar_from(body)
    schools = _frame(body, "schools", ["school_id", "sub_county"])
    enrolment = _frame(body, "enrolment", ["school_id", "term_id", "learners"])
    feeding = _frame(body, "feeding", ["school_id", "date", "feeding_happened", "learners_fed", "cereals_kg", "pulses_kg",
                                       "learners_present", "captured_at", "received_date", "sync_batch_id", "version"])
    counts = _frame(body, "stock_counts", ["school_id", "date", "commodity", "counted_kg", "ledger_kg"])
    if feeding.empty:
        return {"week_start": str(week_start), "mode": "no_records", "items": [], "rule_breaches": [], "notice": NOTICE}

    feeding["learners_present"] = pd.to_numeric(feeding.learners_present, errors="coerce")
    feats = build_features(schools, enrolment, feeding, counts, calendar)
    feats["week"] = feats.date.dt.strftime("%G-%V")
    index = {d: i for i, d in enumerate(pd.to_datetime(calendar.date))}
    feats["day_index"] = feats.date.map(index)
    week_end = week_start + dt.timedelta(days=6)
    week = feats[(feats.date >= pd.Timestamp(week_start)) & (feats.date <= pd.Timestamp(week_end))]
    if week.empty:
        return {"week_start": str(week_start), "mode": "no_records", "items": [], "rule_breaches": [], "notice": NOTICE}

    first = int(week.day_index.min())
    anchor = first - (first % REFIT_EVERY)
    follow_up = {(f["school_id"], f["week"]) for f in body.get("follow_up", [])}
    history = feats[(feats.day_index < anchor) & (feats.day_index >= anchor - WINDOW)]
    keep = [(s, w) not in follow_up for s, w in zip(history.school_id, history.week)]
    history = history[np.array(keep, dtype=bool)]

    rules = Rules()
    rule_scores = rules.score(week)
    model_info = None
    if history.day_index.nunique() >= MIN_HISTORY:
        model = ExtendedIsolationForestMethod(**SETTINGS, random_state=0).fit(history)
        scores = model.score(week)
        mode = METHOD
        model_info = {"method": METHOD, "settings": SETTINGS, "fitted_on_rows": int(len(history)),
                      "window_school_days": int(history.day_index.nunique()),
                      "refit_point": str(pd.Timestamp(calendar.date.iloc[anchor]).date()) if anchor < len(calendar) else None}
    else:
        model, scores, mode = None, rule_scores, "rules_only"

    week = week.assign(score=scores, rule_score=rule_scores)
    items = []
    for school_id, rows in week.groupby("school_id"):
        top = rows.loc[rows.score.idxmax()]
        contributions = model.contributions(top) if model is not None else rules.contributions(top)
        items.append({
            "school_id": school_id,
            "score": float(np.round(top.score, 6)),
            "top_date": str(top.date.date()),
            "reasons": _reasons(contributions, top),
            "explanation": explain(top, contributions),
        })
    items.sort(key=lambda i: -i["score"])
    for rank, item in enumerate(items, 1):
        item["rank"] = rank
        item["listed"] = rank <= k

    breaches = []
    for row in week[week.rule_score >= 1].itertuples():
        for rule in rules.contributions(week.loc[row.Index]):
            breaches.append({"school_id": row.school_id, "date": str(row.date.date()), "rule": rule,
                             "detail": describe(rule, week.loc[row.Index])})
    return {"week_start": str(week_start), "mode": mode, "model": model_info, "k": k, "items": items,
            "rule_breaches": breaches, "notice": NOTICE}
