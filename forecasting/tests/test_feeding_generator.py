import copy
import sys
from pathlib import Path

import pandas as pd
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

from generate_feeding_dataset import CONFIG, generate  # noqa: E402
from run_anomaly_robustness import deep_merge  # noqa: E402


def small_config(**overrides):
    cfg = yaml.safe_load(open(CONFIG, encoding="utf-8"))
    cfg = deep_merge(copy.deepcopy(cfg), {"sub_counties": ["A", "B"], "schools_per_sub_county": 4,
                                          "anomalies": {"episodes_per_year": 4}})
    return deep_merge(cfg, overrides)


def read(out_dir, name):
    return pd.read_csv(out_dir / f"{name}.csv")


def test_the_same_seed_gives_the_same_records(tmp_path):
    generate(small_config(), tmp_path / "a", quiet=True)
    generate(small_config(), tmp_path / "b", quiet=True)

    pd.testing.assert_frame_equal(read(tmp_path / "a", "feeding"), read(tmp_path / "b", "feeding"))


def test_held_out_anomaly_types_only_appear_in_the_test_year(tmp_path):
    generate(small_config(), tmp_path, quiet=True)
    labels = read(tmp_path, "labels").assign(date=lambda d: pd.to_datetime(d.date))

    early = labels[labels.date < "2026-01-01"].label
    assert not early.isin(["backdated_bulk_entry", "round_number_entry"]).any()
    assert labels[labels.date >= "2026-01-01"].label.isin(["backdated_bulk_entry", "round_number_entry"]).any()


def test_records_follow_the_calendar_and_the_rules_schools_keep(tmp_path):
    generate(small_config(), tmp_path, quiet=True)
    feeding = read(tmp_path, "feeding").assign(date=lambda d: pd.to_datetime(d.date))
    enrolment = read(tmp_path, "enrolment")
    days = read(tmp_path, "school_days").assign(date=lambda d: pd.to_datetime(d.date))

    assert feeding.date.dt.weekday.max() < 5
    assert not feeding.date.isin(pd.to_datetime(["2026-10-20", "2025-06-02"])).any()  # Mashujaa Day, Madaraka observed
    merged = feeding.merge(days[["date", "term_id"]], on="date").merge(enrolment, on=["school_id", "term_id"])
    assert (merged.learners_fed <= merged.learners).all()
    assert (feeding[~feeding.feeding_happened][["learners_fed", "cereals_kg", "pulses_kg"]] == 0).all().all()
    assert feeding[~feeding.feeding_happened].reason_code.notna().all()


def test_a_scenario_override_changes_only_what_it_names():
    cfg = small_config(stock={"count_every_school_days": 10})

    assert cfg["stock"]["count_every_school_days"] == 10
    assert cfg["stock"]["purchase_every_school_days"] == 20
