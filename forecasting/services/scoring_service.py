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
  5. A sub-county with fewer than 60 school days of history is ranked by the rules alone;
     then only schools that broke a rule are listed, so a quiet week lists nobody.

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
from anomaly.explain import describe, explain as explain_row
from anomaly.features import build_features
from anomaly.methods import ExtendedIsolationForestMethod, Rules
from anomaly.weekly import WEEKLY_AGGREGATION, review_threshold, two_week_mean, weekly_scores

METHOD = "extended_isolation_forest"
REFIT_EVERY = 20
WINDOW = 125
MIN_HISTORY = 60
DEFAULT_K = 3
# Version 8 as the service ran it before protocol version 11 (protocol version 6's trees
# and ndim; version 7's review threshold: a school-week is listed only if it is also more
# unusual than this share of the school-weeks in the model's own training window, so a
# quiet week can list fewer than 3, or none).
VERSION_8 = {"n_estimators": 300, "ndim": 2, "scale_floor": False, "threshold": "interpolated", "review_quantile": 0.98,
             "window": WINDOW, "weekly": WEEKLY_AGGREGATION}
# The setting the service runs (config/anomaly_v11.yaml, data/reports/anomaly/v11)
CONFIG = dict(VERSION_8)
SETTINGS = {"n_estimators": CONFIG["n_estimators"], "ndim": CONFIG["ndim"]}
REVIEW_QUANTILE = CONFIG["review_quantile"]
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
    # A practice term (a labelled period outside the national calendar) has no number
    terms = [{"year": int(t["year"]), "term": int(t["term"]) if t.get("term") is not None else None, "term_id": t["id"],
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


def features_for(body):
    """The school-day features for the records in a request, with each day's school week and
    school-day index; None when there are no feeding records."""
    calendar = calendar_from(body)
    schools = _frame(body, "schools", ["school_id", "sub_county"])
    enrolment = _frame(body, "enrolment", ["school_id", "term_id", "learners"])
    feeding = _frame(body, "feeding", ["school_id", "date", "feeding_happened", "learners_fed", "cereals_kg", "pulses_kg",
                                       "learners_present", "captured_at", "received_date", "sync_batch_id", "version"])
    counts = _frame(body, "stock_counts", ["school_id", "date", "commodity", "counted_kg", "ledger_kg"])
    if feeding.empty:
        return None, calendar
    feeding["learners_present"] = pd.to_numeric(feeding.learners_present, errors="coerce")
    return add_week_index(build_features(schools, enrolment, feeding, counts, calendar), calendar), calendar


def add_week_index(feats, calendar):
    feats["week"] = feats.date.dt.strftime("%G-%V")
    feats["day_index"] = feats.date.map({d: i for i, d in enumerate(pd.to_datetime(calendar.date))})
    return feats


def _model_for(history, refit_point, follow_up, config, model_seed, cache):
    """The model and review threshold for a refit point, fitted on the school-days before it.
    cache (the evaluation's): {key: (model, threshold)}, one per sub-county. The key is the
    refit point's date, since the calendar a request carries (and so the day index) slides."""
    weeks = set(history.week)
    key = (refit_point, tuple(sorted(f for f in follow_up if f[1] in weeks)))
    if cache is not None and key in cache:
        return cache[key]
    model = ExtendedIsolationForestMethod(n_estimators=config["n_estimators"], ndim=config["ndim"],
                                          scale_floor=config["scale_floor"], random_state=model_seed).fit(history)
    # The same weekly score as the list (protocol version 8: the mean of the two highest days)
    weekly_history = weekly_scores(history.assign(score=model.score(history)))
    if config["weekly"] == "two_week_mean":
        weekly_history = two_week_mean(weekly_history)
    threshold = review_threshold(weekly_history.to_numpy(), config["review_quantile"], config["threshold"])
    if cache is not None:
        cache[key] = (model, threshold)
    return model, threshold


def rank_week(feats, calendar, week_start, k=DEFAULT_K, follow_up=(), config=None, model_seed=0, cache=None, explain=True):
    """Rank a week's schools from their school-day features. follow_up: {(school_id, ISO
    week)} marked follow-up, left out of the fit. The evaluation calls this with its own
    config, model seed and model cache; the service with CONFIG."""
    config = config or CONFIG
    follow_up = set(map(tuple, follow_up))
    week_end = week_start + dt.timedelta(days=6)
    week = feats[(feats.date >= pd.Timestamp(week_start)) & (feats.date <= pd.Timestamp(week_end))]
    if week.empty:
        return {"week_start": str(week_start), "mode": "no_records", "items": [], "rule_breaches": [], "notice": NOTICE}

    first = int(week.day_index.min())
    anchor = first - (first % REFIT_EVERY)
    history = feats[(feats.day_index < anchor) & (feats.day_index >= anchor - config["window"])]
    keep = [(s, w) not in follow_up for s, w in zip(history.school_id, history.week)]
    history = history[np.array(keep, dtype=bool)]

    rules = Rules()
    rule_scores = rules.score(week)
    model_info = None
    if history.day_index.nunique() >= MIN_HISTORY:
        refit_point = str(pd.Timestamp(calendar.date.iloc[anchor]).date()) if anchor < len(calendar) else None
        model, threshold = _model_for(history, refit_point, follow_up, config, model_seed, cache)
        scores = model.score(week)
        mode = METHOD
        if config["weekly"] == "two_week_mean":
            # Each school's previous week with records (since the start of the training
            # window), scored by the same model
            before = feats[(feats.date < pd.Timestamp(week_start)) & (feats.day_index >= anchor - config["window"])]
            before = before[before.week == before.groupby("school_id").week.transform("max")]
            previous = weekly_scores(before.assign(score=model.score(before))).droplevel("week") if len(before) else pd.Series(dtype=float)
        model_info = {"method": METHOD, "settings": {"n_estimators": config["n_estimators"], "ndim": config["ndim"]},
                      "scale_floor": config["scale_floor"], "fitted_on_rows": int(len(history)),
                      "window_school_days": int(history.day_index.nunique()),
                      "refit_point": refit_point,
                      "review_quantile": config["review_quantile"], "review_threshold": threshold,
                      "threshold_estimator": config["threshold"], "weekly_score": config["weekly"]}
    else:
        model, scores, mode, threshold = None, rule_scores, "rules_only", None

    week = week.assign(score=scores, rule_score=rule_scores)
    items = []
    for school_id, rows in week.groupby("school_id"):
        # The reasons come from the school's most unusual day; its weekly score, for the model,
        # is the mean of its two highest days. Ranked by the rules alone it stays the highest
        top = rows.loc[rows.score.idxmax()]
        week_score = top.score if model is None else float(weekly_scores(rows).iloc[0])
        if model is not None and config["weekly"] == "two_week_mean" and school_id in previous.index:
            week_score = (week_score + float(previous[school_id])) / 2
        item = {"school_id": school_id, "score": float(np.round(week_score, 6)), "top_date": str(top.date.date())}
        if explain:
            contributions = model.contributions(top) if model is not None else rules.contributions(top)
            item["reasons"] = _reasons(contributions, top)
            item["explanation"] = explain_row(top, contributions)
        items.append(item)
    items.sort(key=lambda i: -i["score"])
    for rank, item in enumerate(items, 1):
        item["rank"] = rank
        # Ranked by the fixed checks alone, a school that broke none has nothing to look into;
        # ranked by the model, only a week above the review threshold is listed
        if mode == "rules_only":
            item["listed"] = rank <= k and item["score"] > 0
        else:
            item["listed"] = rank <= k and (threshold is None or item["score"] > threshold)

    breaches = []
    if explain:
        for row in week[week.rule_score >= 1].itertuples():
            for rule in rules.contributions(week.loc[row.Index]):
                breaches.append({"school_id": row.school_id, "date": str(row.date.date()), "rule": rule,
                                 "detail": describe(rule, week.loc[row.Index])})
    return {"week_start": str(week_start), "mode": mode, "model": model_info, "k": k, "items": items,
            "rule_breaches": breaches, "notice": NOTICE}


def score_week(body):
    week_start = _date(body.get("week_start"), "week_start")
    k = int(body.get("k", DEFAULT_K))
    feats, calendar = features_for(body)
    if feats is None:
        return {"week_start": str(week_start), "mode": "no_records", "items": [], "rule_breaches": [], "notice": NOTICE}
    follow_up = {(f["school_id"], f["week"]) for f in body.get("follow_up", [])}
    return rank_week(feats, calendar, week_start, k=k, follow_up=follow_up)
