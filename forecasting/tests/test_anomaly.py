import numpy as np
import pandas as pd
import pytest

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
                         "reason_code": None, "captured_date": d, "received_date": d,
                         "sync_batch_id": f"{s}-{i}", "version": 1})
    counts = pd.DataFrame(columns=["school_id", "date", "commodity", "counted_kg", "ledger_kg"])
    return schools, enrolment, pd.DataFrame(rows), counts, school_days


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
