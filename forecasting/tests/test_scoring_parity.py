"""
The evaluation measures the scorer that runs (protocol version 11; version 12 kept its model).

The point-in-time harness (scripts/run_anomaly_v11.py) scores each week from the records
the backend would send at that moment. Here one sub-county-week is scored twice: through
POST /score's code with the request the backend builds (reviewInputs.js: records dated in
the 365 days before the week, received by then, and the terms around it), and through the
harness's own data path. The scores and the list must be identical.
"""

import copy
import sys
from pathlib import Path

import pandas as pd
import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import run_anomaly_v11 as harness  # noqa: E402
from generate_feeding_dataset import CONFIG, generate  # noqa: E402
from run_anomaly_robustness import deep_merge  # noqa: E402
from services import scoring_service as service  # noqa: E402
from test_scoring_api import calendar_body  # noqa: E402

SUB_COUNTY = "North"
WEEK = pd.Timestamp("2026-03-02")


@pytest.fixture(scope="module")
def dataset(tmp_path_factory):
    out = tmp_path_factory.mktemp("parity") / "data" / "seed"
    cfg = yaml.safe_load(open(CONFIG, encoding="utf-8"))
    cfg = deep_merge(copy.deepcopy(cfg), {"sub_counties": ["North", "South"], "schools_per_sub_county": 6})
    generate(cfg, out, quiet=True)
    return out


@pytest.fixture(scope="module")
def scorings(dataset, tmp_path_factory):
    import pickle
    cache = tmp_path_factory.mktemp("cache")
    path = harness.build_scorings((str(dataset), SUB_COUNTY, str(WEEK.date()), str((WEEK + pd.Timedelta(days=6)).date()),
                                   "point_in_time", str(cache)))
    return pickle.loads(Path(path).read_bytes())


def backend_body(dataset, moment):
    """The request the backend sends for the week at that moment."""
    read = lambda n: pd.read_csv(dataset / f"{n}.csv")  # noqa: E731
    schools = read("schools")
    schools = schools[schools.sub_county == SUB_COUNTY]
    ids = set(schools.school_id)
    since, until = WEEK - pd.Timedelta(days=harness.HISTORY_DAYS), WEEK + pd.Timedelta(days=6)
    feeding = read("feeding")
    dates, received = pd.to_datetime(feeding.date), pd.to_datetime(feeding.received_date)
    feeding = feeding[feeding.school_id.isin(ids) & (dates >= since) & (dates <= until) & (received <= moment)]
    counts = read("stock_counts")
    counts = counts.merge(feeding[["school_id", "date"]], on=["school_id", "date"])
    terms, closed = calendar_body()
    window = WEEK - pd.Timedelta(days=harness.CALENDAR_DAYS)
    terms = [t for t in terms if pd.Timestamp(t["closes_on"]) >= window and pd.Timestamp(t["opens_on"]) <= until]
    return {
        "week_start": str(WEEK.date()), "k": 3, "terms": terms, "closed": closed,
        "schools": schools[["school_id", "sub_county"]].to_dict(orient="records"),
        "enrolment": read("enrolment").query("school_id in @ids").to_dict(orient="records"),
        "feeding": feeding.astype(object).where(feeding.notna(), None).to_dict(orient="records"),
        "stock_counts": counts.to_dict(orient="records"),
        "follow_up": [],
    }


def test_the_week_is_scored_the_day_after_it_ends_and_again_when_records_arrive(scorings):
    moments = sorted(m for (w, m) in scorings if w == WEEK.date())
    assert moments and moments[0] <= (WEEK + pd.Timedelta(days=6)).date()
    assert all(m <= (WEEK + pd.Timedelta(days=6 + harness.RESCORE_DAYS)).date() for m in moments)


def test_the_harness_scores_a_week_exactly_as_the_service_does(dataset, scorings):
    for (week, moment) in sorted(k for k in scorings if k[0] == WEEK.date()):
        served = service.score_week(backend_body(dataset, pd.Timestamp(moment)))
        frame, calendar_start = scorings[(week, moment)]
        measured = service.rank_week(frame, harness.calendar_for(dataset, calendar_start), week, k=3, explain=False)
        assert served["mode"] == measured["mode"]
        assert [(i["school_id"], i["score"], i["listed"]) for i in served["items"]] == \
            [(i["school_id"], i["score"], i["listed"]) for i in measured["items"]]


def test_the_service_runs_the_setting_the_protocol_froze():
    # Version 12 kept version 11's model and changed only the review quantile (and the
    # backend's rescoring window), so the model settings come from version 11's plan
    frozen = yaml.safe_load(open(harness.PLAN, encoding="utf-8")).get("frozen")
    v12 = yaml.safe_load(open(harness.PLAN.with_name("anomaly_v12.yaml"), encoding="utf-8"))["frozen"]
    model = [k for k in service.VERSION_8 if k != "review_quantile"]
    assert {k: service.CONFIG[k] for k in model} == {k: frozen[k] for k in model}
    assert service.DEFAULT_REVIEW_QUANTILE == v12["review_quantile"]


def test_the_review_quantile_is_one_with_a_measured_workload():
    assert service.review_quantile_from(None) == 0.999
    assert service.review_quantile_from("0.98") == 0.98
    for wrong in ("0.97", "98", "high"):
        with pytest.raises(ValueError, match="REVIEW_QUANTILE"):
            service.review_quantile_from(wrong)


@pytest.mark.parametrize("change", [{"weekly": "two_week_mean"}, {"window": harness.MAX_WINDOW}, {"one_sided": True},
                                    {"one_sided": True, "list_store_shortfall": True}],
                         ids=["two_week_score", "longest_window", "one_sided", "store_shortfall"])
def test_the_harness_keeps_every_row_a_setting_it_tries_needs(dataset, scorings, change):
    """Plan amendment 1's settings read rows before the refit point's 125 school days, or the
    previous week; the harness's cached rows must give the same ranking as the full request."""
    config = dict(service.VERSION_8, **change)
    for (week, moment) in sorted(k for k in scorings if k[0] == WEEK.date()):
        feats, calendar = service.features_for(backend_body(dataset, pd.Timestamp(moment)))
        served = service.rank_week(feats, calendar, week, k=3, config=config, explain=False)
        frame, calendar_start = scorings[(week, moment)]
        measured = service.rank_week(frame, harness.calendar_for(dataset, calendar_start), week, k=3, config=config, explain=False)
        assert [(i["school_id"], i["score"], i["listed"]) for i in served["items"]] == \
            [(i["school_id"], i["score"], i["listed"]) for i in measured["items"]]
