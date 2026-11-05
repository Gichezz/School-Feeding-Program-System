"""
Behaviour tests for the weekly review list, in the CheckList style (Ribeiro et al., 2020).

They run the deployed scorer (services.scoring_service.score_week) on a generated
sub-county and change one school's records in the scored week:

- minimum functionality: a record any officer would want to see is listed, with a reason
  or rule that names it;
- invariance: changes that carry no information (the order records arrive in, the names
  of sync batches, the hour of a record inside school hours) leave the list unchanged;
- direction: making a figure more unusual never makes the school look less unusual.

The model is fitted on records before the week's refit point, so changing the week's
records changes only what is scored, never the model.
"""

import copy
import random
import sys
from pathlib import Path

import pandas as pd
import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from generate_feeding_dataset import CONFIG, generate  # noqa: E402
from run_anomaly_robustness import deep_merge  # noqa: E402
from services.scoring_service import score_week  # noqa: E402
from test_scoring_api import body_for  # noqa: E402

SUB_COUNTY = "North"
WEEK = "2026-03-02"
WEEK_DAYS = [str(d.date()) for d in pd.bdate_range(WEEK, periods=5)]


@pytest.fixture(scope="module")
def dataset(tmp_path_factory):
    out = tmp_path_factory.mktemp("behaviour")
    cfg = yaml.safe_load(open(CONFIG, encoding="utf-8"))
    cfg = deep_merge(copy.deepcopy(cfg), {"sub_counties": ["North", "South"], "schools_per_sub_county": 6})
    generate(cfg, out, quiet=True)
    return out


@pytest.fixture(scope="module")
def base(dataset):
    return body_for(dataset, SUB_COUNTY, WEEK)


@pytest.fixture(scope="module")
def school(dataset, base):
    """A school with no injected problem from two months before the week to its end, whose
    week is not already on the list: a change to its records is the only thing to find."""
    episodes = pd.read_csv(dataset / "episodes.csv", parse_dates=["start", "end"])
    window = (pd.Timestamp(WEEK) - pd.Timedelta(days=60), pd.Timestamp(WEEK) + pd.Timedelta(days=6))
    busy = set(episodes[(episodes.start <= window[1]) & (episodes.end >= window[0])].school_id)
    listed = {i["school_id"] for i in score_week(base)["items"] if i["listed"]}
    quiet = sorted({s["school_id"] for s in base["schools"]} - busy - listed)
    assert quiet, "the generated sub-county needs a quiet school for these tests"
    return quiet[0]


def week_records(body, school):
    return [r for r in body["feeding"] if r["school_id"] == school and str(r["date"])[:10] in WEEK_DAYS]


def item(result, school):
    return next(i for i in result["items"] if i["school_id"] == school)


def listed(result):
    return [i["school_id"] for i in result["items"] if i["listed"]]


def breaches(result, school):
    return {b["rule"] for b in result["rule_breaches"] if b["school_id"] == school}


def ranking(result):
    return [(i["school_id"], i["score"], i["top_date"], tuple(i["reasons"])) for i in result["items"]]


# Minimum functionality -------------------------------------------------------------------

def test_food_issued_on_a_day_nobody_was_fed_is_listed(base, school):
    body = copy.deepcopy(base)
    day = [r for r in week_records(body, school) if r["feeding_happened"] and r["cereals_kg"] > 0][-1]
    # Validation refuses food issued on a day feeding did not happen; a day recorded as a
    # feeding day with nobody fed and food issued gets through, so the list must catch it
    day.update(learners_fed=0, learners_present=None)

    result = score_week(body)

    assert school in listed(result)
    assert item(result, school)["top_date"] == day["date"][:10]
    assert "cereal_ratio" in breaches(result, school)


def test_more_learners_fed_than_enrolled_is_listed_and_breaks_the_rule(base, school):
    body = copy.deepcopy(base)
    enrolled = sum(e["learners"] for e in body["enrolment"] if e["school_id"] == school and e["term_id"] == "2026-T1")
    for r in week_records(body, school):
        r.update(learners_fed=int(enrolled * 1.15), learners_present=None)

    result = score_week(body)

    assert school in listed(result)
    assert "share_fed" in breaches(result, school)


def test_a_store_count_far_short_of_the_records_is_listed(base, school):
    body = copy.deepcopy(base)
    daily = sum(r["cereals_kg"] for r in week_records(body, school)) / 5
    earlier = [c for c in body["stock_counts"] if c["school_id"] == school and c["commodity"] == "cereals"
               and str(c["date"])[:10] < WEEK]
    gap = earlier[-1]["counted_kg"] - earlier[-1]["ledger_kg"] if earlier else 0.0
    # Ten days of cereals missing since the last count
    body["stock_counts"].append({"school_id": school, "date": WEEK_DAYS[3], "commodity": "cereals",
                                 "ledger_kg": 1000.0, "counted_kg": 1000.0 + gap - 10 * daily})

    result = score_week(body)

    assert school in listed(result)
    assert "count_gap_change" in breaches(result, school)


def test_three_weeks_entered_together_long_after_the_fact_are_listed(base, school):
    body = copy.deepcopy(base)
    days = [str(d.date()) for d in pd.bdate_range(end=WEEK_DAYS[-1], periods=15)]
    late = str((pd.Timestamp(WEEK_DAYS[-1]) + pd.Timedelta(days=14)).date())
    for r in body["feeding"]:
        if r["school_id"] == school and str(r["date"])[:10] in days:
            r.update(received_date=late, captured_at=f"{late}T19:30:00", sync_batch_id="catch-up")

    result = score_week(body)

    assert school in listed(result)
    assert {"entry_delay", "batch_dates"} & breaches(result, school)


# Invariance ------------------------------------------------------------------------------

def test_the_order_records_arrive_in_does_not_change_the_list(base):
    body = copy.deepcopy(base)
    for key in ("feeding", "enrolment", "stock_counts", "schools"):
        random.Random(7).shuffle(body[key])

    assert ranking(score_week(body)) == ranking(score_week(base))


def test_the_names_of_sync_batches_do_not_change_the_list(base):
    body = copy.deepcopy(base)
    names = {}
    for r in body["feeding"]:
        r["sync_batch_id"] = names.setdefault(r["sync_batch_id"], f"batch-{len(names):05d}-renamed")

    assert ranking(score_week(body)) == ranking(score_week(base))


def test_the_hour_a_record_was_entered_within_school_hours_does_not_change_the_list(base):
    body = copy.deepcopy(base)
    moved = 0
    for r in body["feeding"]:
        stamp = pd.Timestamp(r["captured_at"])
        if stamp.weekday() < 5 and 8 <= stamp.hour < 15:
            r["captured_at"] = (stamp + pd.Timedelta(hours=2)).isoformat()
            moved += 1
    assert moved > 0

    assert ranking(score_week(body)) == ranking(score_week(base))


def test_the_same_records_give_the_same_list_every_time(base):
    assert ranking(score_week(copy.deepcopy(base))) == ranking(score_week(copy.deepcopy(base)))


# Direction -------------------------------------------------------------------------------

def score_with(base, school, change):
    body = copy.deepcopy(base)
    for r in week_records(body, school):
        change(r)
    return item(score_week(body), school)["score"]


def test_more_learners_recorded_as_fed_never_lowers_the_score(base, school):
    usual = {r["date"]: r["learners_fed"] for r in week_records(base, school)}

    scores = [score_with(base, school, lambda r, f=f: r.update(learners_fed=round(usual[r["date"]] * f), learners_present=None))
              for f in (1.0, 1.15, 1.3)]

    assert scores == sorted(scores)
    assert scores[-1] > scores[0]


def test_more_food_issued_for_the_same_learners_never_lowers_the_score(base, school):
    usual = {r["date"]: r["cereals_kg"] for r in week_records(base, school)}

    scores = [score_with(base, school, lambda r, f=f: r.update(cereals_kg=round(usual[r["date"]] * f * 2) / 2))
              for f in (1.0, 1.3, 1.6)]

    assert scores == sorted(scores)
    assert scores[-1] > scores[0]


def test_records_reaching_the_server_later_never_lower_the_score(base, school):
    def delay(days):
        return lambda r: r.update(received_date=str((pd.Timestamp(r["date"]) + pd.Timedelta(days=days)).date()))

    scores = [score_with(base, school, delay(d)) for d in (0, 7, 14)]

    assert scores == sorted(scores)
    assert scores[-1] > scores[0]
