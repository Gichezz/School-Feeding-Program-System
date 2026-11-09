"""POST /score: weekly review scoring for one sub-county, with the records the backend sends."""

import copy
import datetime as dt
import sys
from pathlib import Path

import pandas as pd
import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from app import create_app  # noqa: E402
from generate_feeding_dataset import CONFIG, generate  # noqa: E402
from run_anomaly_robustness import deep_merge  # noqa: E402

INPUTS = Path(__file__).resolve().parent.parent / "config" / "kenya_inputs.yaml"


@pytest.fixture(scope="module")
def dataset(tmp_path_factory):
    out = tmp_path_factory.mktemp("feeding")
    cfg = yaml.safe_load(open(CONFIG, encoding="utf-8"))
    cfg = deep_merge(copy.deepcopy(cfg), {"sub_counties": ["North", "South"], "schools_per_sub_county": 6})
    generate(cfg, out, quiet=True)
    return out


@pytest.fixture(scope="module")
def client():
    return create_app().test_client()


def calendar_body():
    """Terms and closed dates as the backend sends them (school_terms and calendar_events)."""
    inputs = yaml.safe_load(open(INPUTS, encoding="utf-8"))
    terms, closed = [], []
    for year, cal in inputs["school_calendar"].items():
        halves = {h["term"]: h for h in cal.get("half_terms", [])}
        for t in cal["terms"]:
            h = halves.get(t["term"])
            terms.append({"id": f"{year}-T{t['term']}", "year": year, "term": t["term"], "opens_on": str(t["open"]),
                          "closes_on": str(t["close"]), "half_term_start": str(h["start"]) if h else None,
                          "half_term_end": str(h["end"]) if h else None})
        for h in inputs["public_holidays"]["fixed"]:
            d = dt.date(year, h["month"], h["day"])
            d = d + dt.timedelta(days=1) if d.weekday() == 6 else d
            closed.append({"starts_on": str(d), "ends_on": str(d)})
        closed += [{"starts_on": str(h["date"]), "ends_on": str(h["date"])} for h in inputs["public_holidays"]["movable"].get(year, [])]
    return terms, closed


def body_for(dataset, sub_county, week_start, since="2024-01-01", follow_up=()):
    read = lambda n: pd.read_csv(dataset / f"{n}.csv")  # noqa: E731
    schools = read("schools")
    schools = schools[schools.sub_county == sub_county]
    ids = set(schools.school_id)
    feeding = read("feeding")
    feeding = feeding[feeding.school_id.isin(ids) & (feeding.date >= since) & (feeding.date <= week_start[:4] + "-12-31")]
    terms, closed = calendar_body()
    return {
        "week_start": week_start, "k": 3, "terms": terms, "closed": closed,
        "schools": schools[["school_id", "sub_county"]].to_dict(orient="records"),
        "enrolment": read("enrolment").query("school_id in @ids").to_dict(orient="records"),
        "feeding": feeding.astype(object).where(feeding.notna(), None).to_dict(orient="records"),
        "stock_counts": read("stock_counts").query("school_id in @ids").to_dict(orient="records"),
        "follow_up": list(follow_up),
    }


def test_health(client):
    assert client.get("/health").get_json() == {"status": "ok", "service": "school-feeding-scoring", "method": "extended_isolation_forest"}


def test_ranks_every_school_lists_the_top_three_and_explains_each(client, dataset):
    res = client.post("/score", json=body_for(dataset, "North", "2026-03-02"))

    body = res.get_json()
    assert res.status_code == 200
    assert body["mode"] == "extended_isolation_forest"
    assert len(body["items"]) == 6
    assert [i["rank"] for i in body["items"]] == [1, 2, 3, 4, 5, 6]
    assert [i["listed"] for i in body["items"]] == [True] * 3 + [False] * 3
    assert all(i["explanation"].startswith("Needs review") for i in body["items"])
    assert body["model"]["window_school_days"] <= 125
    assert "does not decide anything" in body["notice"]


def test_the_same_week_gives_the_same_list_and_the_model_changes_only_at_refit_points(client, dataset):
    first = client.post("/score", json=body_for(dataset, "North", "2026-03-02")).get_json()
    again = client.post("/score", json=body_for(dataset, "North", "2026-03-02")).get_json()
    next_week = client.post("/score", json=body_for(dataset, "North", "2026-03-09")).get_json()

    assert [i["school_id"] for i in first["items"]] == [i["school_id"] for i in again["items"]]
    # Refit points fall every 20 school days, so two consecutive weeks usually share one
    later = [client.post("/score", json=body_for(dataset, "North", w)).get_json()["model"]["refit_point"]
             for w in ("2026-03-02", "2026-03-09", "2026-03-16", "2026-03-23")]
    assert len(set(later)) <= 2
    assert next_week["model"]["refit_point"] >= first["model"]["refit_point"]


def test_a_new_sub_county_is_ranked_by_the_rules_alone(client, dataset):
    # Records only from the start of 2026: fewer than 60 school days before the week
    body = client.post("/score", json=body_for(dataset, "North", "2026-02-02", since="2026-01-01")).get_json()

    assert body["mode"] == "rules_only"
    assert body["model"] is None
    # Only schools that broke a rule are listed; the rest are ranked but not listed
    breaking = {b["school_id"] for b in body["rule_breaches"]}
    assert {i["school_id"] for i in body["items"] if i["listed"]} <= breaking
    assert all(i["score"] > 0 for i in body["items"] if i["listed"])


def test_a_quiet_week_ranked_by_the_rules_alone_lists_nobody(client, dataset):
    body = body_for(dataset, "North", "2026-02-02", since="2026-01-01")
    # Every record ordinary: on time, during school hours, food at the ration
    for r in body["feeding"]:
        r.update(received_date=r["date"], captured_at=f"{r['date']}T10:00:00", sync_batch_id=f"{r['school_id']}-{r['date']}")
        if r["feeding_happened"]:
            r.update(cereals_kg=round(r["learners_fed"] * 0.15 * 2) / 2, pulses_kg=round(r["learners_fed"] * 0.04 * 2) / 2)
    body["stock_counts"] = []

    result = client.post("/score", json=body).get_json()

    assert result["mode"] == "rules_only"
    assert result["rule_breaches"] == []
    assert not any(i["listed"] for i in result["items"])
    assert len(result["items"]) == len(body["schools"])


def test_a_sub_county_with_a_few_days_and_no_stock_counts_is_still_ranked(client, dataset):
    body = body_for(dataset, "North", "2026-01-12", since="2026-01-05")
    body["stock_counts"] = []

    res = client.post("/score", json=body)

    assert res.status_code == 200
    assert res.get_json()["mode"] == "rules_only"
    assert len(res.get_json()["items"]) == 6


def test_follow_up_school_weeks_are_left_out_of_the_fit(client, dataset):
    plain = client.post("/score", json=body_for(dataset, "North", "2026-03-02")).get_json()
    feeding = pd.read_csv(dataset / "feeding.csv")
    school = pd.read_csv(dataset / "schools.csv").query("sub_county == 'North'").school_id.iloc[0]
    dates = pd.to_datetime(feeding[feeding.school_id == school].date)
    # Weeks inside the training window before 2 March 2026
    weeks = dates[(dates >= "2025-09-01") & (dates < "2026-02-01")].dt.strftime("%G-%V").unique()[:4]
    excluded = client.post("/score", json=body_for(dataset, "North", "2026-03-02",
                                                   follow_up=[{"school_id": school, "week": w} for w in weeks])).get_json()

    assert excluded["model"]["fitted_on_rows"] < plain["model"]["fitted_on_rows"]


def test_a_backdated_catch_up_makes_the_list_for_its_week(client, dataset):
    episodes = pd.read_csv(dataset / "episodes.csv", parse_dates=["start", "end"])
    ep = episodes[episodes.type == "backdated_bulk_entry"].iloc[0]
    sub_county = pd.read_csv(dataset / "schools.csv").set_index("school_id").sub_county[ep.school_id]
    monday = (ep.start + pd.Timedelta(days=7) - pd.Timedelta(days=(ep.start + pd.Timedelta(days=7)).weekday())).date()

    body = client.post("/score", json=body_for(dataset, sub_county, str(monday))).get_json()

    listed = [i["school_id"] for i in body["items"] if i["listed"]]
    assert ep.school_id in listed


@pytest.mark.parametrize("change, message", [
    (lambda b: b.pop("week_start"), "week_start"),
    (lambda b: b.update(terms=[]), "terms"),
    (lambda b: b.update(feeding=[{"school_id": "S01", "date": "2026-03-02"}]), "feeding is missing"),
])
def test_refuses_an_incomplete_request(client, dataset, change, message):
    body = body_for(dataset, "North", "2026-03-02")
    change(body)

    res = client.post("/score", json=body)

    assert res.status_code == 400
    assert message in res.get_json()["error"]


def test_refuses_a_body_that_is_not_json(client):
    res = client.post("/score", data="not json", content_type="text/plain")

    assert res.status_code == 400


def test_a_practice_term_without_a_number_is_accepted(client, dataset):
    body = body_for(dataset, "North", "2026-03-02")
    body["terms"].append({"id": "practice", "year": 2026, "term": None, "opens_on": "2026-10-26", "closes_on": "2026-12-18",
                          "half_term_start": None, "half_term_end": None})

    res = client.post("/score", json=body)

    assert res.status_code == 200
    assert res.get_json()["mode"] == "extended_isolation_forest"
