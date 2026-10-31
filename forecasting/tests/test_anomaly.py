from pathlib import Path

import numpy as np
import pandas as pd
import pytest
import yaml

from anomaly.explain import explain
from anomaly.features import FEATURES, build_features
from anomaly.methods import METHODS


def tiny_dataset(days=60, inflate_from=None):
    """Three schools in one sub-county; school A optionally records 30% more learners fed."""
    dates = pd.bdate_range("2026-01-05", periods=days)
    school_days = pd.DataFrame({"date": dates, "term_id": "2026-T1", "term_day": range(days), "term_days": days,
                                "day_type": "ordinary"})
    schools = pd.DataFrame({"school_id": ["A", "B", "C"], "sub_county": ["X", "X", "X"]})
    enrolment = pd.DataFrame({"school_id": ["A", "B", "C"], "term_id": "2026-T1", "learners": [400, 400, 400]})
    rng = np.random.default_rng(0)
    rows = []
    for s in ("A", "B", "C"):
        for i, d in enumerate(dates):
            fed = int(352 * np.exp(rng.normal(0, 0.03)))
            if s == "A" and inflate_from is not None and i >= inflate_from:
                fed = min(399, int(fed * 1.3))
            rows.append({"school_id": s, "date": d, "feeding_happened": True, "learners_fed": fed,
                         "cereals_kg": round(fed * 0.15 * 2) / 2, "pulses_kg": round(fed * 0.04 * 2) / 2,
                         "learners_present": None, "reason_code": None, "captured_date": d, "received_date": d,
                         "captured_at": f"{d.date()}T10:00:00",
                         "sync_batch_id": f"{s}-{i}", "version": 1})
    counts = pd.DataFrame(columns=["school_id", "date", "commodity", "counted_kg", "ledger_kg"])
    return schools, enrolment, pd.DataFrame(rows), counts, school_days


def test_the_features_are_exactly_those_fixed_in_the_protocol():
    protocol = yaml.safe_load(open(Path(__file__).resolve().parent.parent / "config" / "anomaly_evaluation.yaml", encoding="utf-8"))

    assert list(FEATURES) == list(protocol["features"])


def test_features_cover_every_named_feature_and_use_the_term_enrolment():
    f = build_features(*tiny_dataset())

    assert set(FEATURES) <= set(f.columns)
    assert f.fed_rate.between(0.8, 0.95).all()
    assert f.entry_delay.eq(0).all()


def test_an_inflated_headcount_stands_out_against_the_school_and_its_peers():
    f = build_features(*tiny_dataset(inflate_from=45))
    late_a = f[(f.school_id == "A") & (f.date >= f.date.unique()[50])]

    # Capped just below enrolment (399 of 400): about 13% above the usual 352
    assert late_a.fed_vs_own.median() > 0.1
    # About 10 points of enrolment above the other schools that day
    assert late_a.fed_vs_peers.median() > 0.08


@pytest.mark.parametrize("name", list(METHODS))
def test_every_method_scores_the_inflated_days_above_ordinary_ones(name):
    f = build_features(*tiny_dataset(inflate_from=45))
    kwargs = {} if name in ("rules", "robust_zscore") else {"random_state": 0}
    model = METHODS[name](**kwargs).fit(f[f.date < f.date.unique()[40]])
    scores = pd.Series(model.score(f), index=f.index)
    inflated = (f.school_id == "A") & (f.date >= f.date.unique()[50])

    if name == "rules":
        # More fed than present is not more fed than enrolled: the rules do not see it
        assert scores[inflated].max() == 0
    else:
        assert scores[inflated].median() > scores[~inflated].median()


def test_explanations_say_needs_review_and_name_the_figure():
    f = build_features(*tiny_dataset(inflate_from=45))
    row = f[(f.school_id == "A")].iloc[-1]

    text = explain(row, {"fed_vs_peers": 2.0, "fed_rate": 1.0})

    assert text.startswith("Needs review: ")
    assert "similar schools nearby" in text
    assert "fraud" not in text.lower()


def test_ghost_learners_show_as_an_enrolment_jump_and_a_fall_in_the_share_fed():
    schools, enrolment, feeding, counts, school_days = tiny_dataset(days=60)
    # Two terms; school A's register gains a quarter more learners in the second, who are not fed
    school_days["term_id"] = ["2026-T1"] * 30 + ["2026-T2"] * 30
    school_days["term_day"] = list(range(30)) * 2
    school_days["term_days"] = 30
    enrolment = pd.concat([enrolment, enrolment.assign(term_id="2026-T2")])
    enrolment.loc[(enrolment.school_id == "A") & (enrolment.term_id == "2026-T2"), "learners"] = 500

    f = build_features(schools, enrolment, feeding, counts, school_days)
    a_t2 = f[(f.school_id == "A") & (f.term_id == "2026-T2")]

    assert a_t2.enrolment_change.iloc[0] == pytest.approx(np.log(500 / 400))
    assert a_t2.fed_rate_vs_last_term.median() < -0.15
    assert f[f.school_id == "B"].enrolment_change.abs().max() == 0


def test_uptake_is_neutral_where_present_is_not_recorded_and_after_hours_is_flagged():
    schools, enrolment, feeding, counts, school_days = tiny_dataset()
    feeding.loc[feeding.school_id == "B", "learners_present"] = (feeding.learners_fed / 0.98).round()
    feeding.loc[feeding.index[:3], "captured_at"] = [f"{d.date()}T20:30:00" for d in feeding.date[:3]]

    f = build_features(schools, enrolment, feeding, counts, school_days)

    assert f[f.school_id == "A"].uptake.nunique() == 1          # no present recorded: the typical value
    assert f[f.school_id == "B"].uptake.between(0.97, 0.99).all()
    assert f.outside_hours.sum() == 3


def test_explanations_read_correctly_at_the_edges():
    from anomaly.explain import describe

    assert describe("batch_dates", {"batch_dates": 1}) == "synced on its own, apart from the school's other records"
    assert describe("batch_dates", {"batch_dates": 6}) == "6 dates sent together in one sync"
    assert describe("fed_steadiness", {"fed_steadiness": -0.005}) == "almost the same number of learners fed day after day"
    assert describe("fed_steadiness", {"fed_steadiness": -0.2}) == "learners fed changing by 20% a day on average"
    assert describe("fed_rate_vs_last_term", {"fed_rate_vs_last_term": -0.57}) == "a share of learners fed 57 percentage points below last term's"
