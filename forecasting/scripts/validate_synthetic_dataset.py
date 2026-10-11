"""
Phase 9 - Step 3: automated validation of the synthetic dataset.

Every check is executed against the saved files; results are written to
data/reports/validation_report.{md,json}. Exits with status 1 if any check fails.

Usage
  python forecasting/scripts/validate_synthetic_dataset.py [--skip-reproducibility]
"""

import argparse
import sys

import numpy as np
import pandas as pd

from common import (
    CONFIG_PATH,
    RAW_US_DATASET,
    SYNTHETIC_DATASET,
    SYNTHETIC_METADATA,
    US_INSPECTION_JSON,
    US_REFERENCE_DAILY,
    VALIDATION_JSON,
    VALIDATION_MD,
    load_config,
    md_table,
    read_json,
    sha256_of,
    write_json,
)
from generate_synthetic_dataset import (
    COLUMNS,
    DOW_NAMES,
    generate,
    load_dataset,
    plan_meals,
    resolve_reference_values,
)

REQUIRED_NON_NULL = [
    "date", "day_of_week", "is_school_day", "is_school_holiday", "is_public_holiday", "term",
    "school_year", "is_half_term", "is_exam_period", "students_enrolled", "rainfall_mm",
    "weather_category", "is_special_event", "source_type", "synthetic_scenario",
]
SCHOOL_DAY_ONLY = [
    "students_present", "meals_planned", "meals_prepared", "meals_served",
    "estimated_meal_demand", "is_supply_shortfall",
]


class Checker:
    def __init__(self):
        self.results = []

    def check(self, group, name, passed, detail=""):
        self.results.append({"group": group, "check": name, "passed": bool(passed), "detail": str(detail)})

    def count(self, group, name, bad_mask, what="rows violating"):
        # A null in a violation mask counts as a violation
        n = int(pd.Series(bad_mask).astype("boolean").fillna(True).sum())
        self.check(group, name, n == 0, f"{n} {what}")


def run_checks(skip_repro=False):
    c = Checker()
    cfg = load_config(CONFIG_PATH)
    resolve_reference_values(cfg)

    if not SYNTHETIC_DATASET.exists():
        c.check("files", "synthetic dataset exists", False, f"missing {SYNTHETIC_DATASET}")
        return c.results
    df = load_dataset(SYNTHETIC_DATASET)
    meta = read_json(SYNTHETIC_METADATA) if SYNTHETIC_METADATA.exists() else None

    # --- Structure -----------------------------------------------------------
    g = "structure"
    c.check(g, "expected columns in expected order", list(df.columns) == COLUMNS,
            f"got {len(df.columns)} columns")
    for col in REQUIRED_NON_NULL:
        c.count(g, f"required field '{col}' has no nulls", df[col].isna(), "null values")
    c.check(g, "metadata row count matches file", meta is not None and meta["records"] == len(df),
            f"metadata={meta and meta['records']}, file={len(df)}")
    c.check(g, "metadata dataset hash matches file",
            meta is not None and meta["dataset_sha256"] == sha256_of(SYNTHETIC_DATASET), "")

    # --- Dates ---------------------------------------------------------------
    g = "dates"
    dates = pd.to_datetime(df["date"], format="%Y-%m-%d", errors="coerce")
    c.count(g, "all dates valid ISO dates", dates.isna(), "invalid dates")
    c.count(g, "dates unique (no duplicate dates)", df["date"].duplicated(), "duplicate dates")
    c.check(g, "records in chronological order", dates.is_monotonic_increasing, "")
    expected = pd.date_range(cfg["period"]["start_date"], cfg["period"]["end_date"], freq="D")
    c.check(g, "no gaps: every day of configured period present",
            len(dates) == len(expected) and (dates.values == expected.values).all(),
            f"{len(dates)} records vs {len(expected)} days in "
            f"{cfg['period']['start_date']}..{cfg['period']['end_date']}")

    # --- Calendar ------------------------------------------------------------
    g = "calendar"
    dow = dates.dt.dayofweek
    c.count(g, "day_of_week matches date", df["day_of_week"] != dow.map(lambda i: DOW_NAMES[i]))
    c.count(g, "school_year equals calendar year of date", df["school_year"] != dates.dt.year)
    c.count(g, "school days fall on configured weekdays",
            df["is_school_day"] & ~df["day_of_week"].isin(cfg["calendar"]["school_weekdays"]))
    c.count(g, "school day is never a school holiday", df["is_school_day"] & df["is_school_holiday"])
    c.count(g, "school holiday <=> inter-term, half-term or public holiday",
            df["is_school_holiday"] != ((df["term"] == "holiday") | df["is_half_term"] | df["is_public_holiday"]))
    c.count(g, "in-term weekday that is not a holiday is a school day",
            (df["term"] != "holiday") & df["day_of_week"].isin(cfg["calendar"]["school_weekdays"])
            & ~df["is_school_holiday"] & ~df["is_school_day"])
    hol = df["term"] == "holiday"
    c.count(g, "week_of_term null outside term", hol & df["week_of_term"].notna())
    c.count(g, "week_of_term >= 1 inside term", ~hol & (df["week_of_term"].isna() | (df["week_of_term"] < 1)))
    c.count(g, "half-term only inside a term", hol & df["is_half_term"])
    c.count(g, "exam period only on school days", df["is_exam_period"] & ~df["is_school_day"])
    term_fmt = df.loc[~hol, "term"].str.fullmatch(r"\d{4}-T[1-3]")
    c.count(g, "term label format YYYY-Tn or 'holiday'", ~term_fmt, "bad labels")
    c.count(g, "term year matches school_year",
            ~hol & (df["term"].str[:4] != df["school_year"].astype(str)))
    spans = df[~hol].assign(d=dates[~hol]).groupby("term")["d"].agg(["min", "max", "count"])
    contiguous = (spans["max"] - spans["min"]).dt.days + 1 == spans["count"]
    c.count(g, "each term is one contiguous date span", ~contiguous, "terms split")
    spans = spans.sort_values("min")
    c.count(g, "terms do not overlap", spans["min"].iloc[1:].values <= spans["max"].iloc[:-1].values, "overlaps")
    order_ok = spans.reset_index().assign(y=lambda x: x.term.str[:4]).groupby("y")["term"].apply(
        lambda s: list(s) == sorted(s))
    c.count(g, "terms ordered T1<T2<T3 within each year", ~order_ok, "years out of order")
    sd_per_term = df[df["is_school_day"]].groupby("term").size()
    c.check(g, "every term has school days", set(sd_per_term.index) == set(spans.index),
            f"{len(spans)} terms, min {sd_per_term.min()} school days")

    # --- Events --------------------------------------------------------------
    g = "events"
    ev = df["is_special_event"]
    c.count(g, "event type null when no event", ~ev & df["special_event_type"].notna())
    c.count(g, "event type present when event", ev & df["special_event_type"].isna())
    c.count(g, "event type in allowed set",
            df["special_event_type"].notna() & ~df["special_event_type"].isin(cfg["special_events"]["types"]))
    c.count(g, "events only on school days", ev & ~df["is_school_day"])

    # --- Enrollment and weather ----------------------------------------------
    g = "enrollment_weather"
    e = df["students_enrolled"]
    c.count(g, "enrollment positive", e <= 0)
    c.count(g, "enrollment within configured min/max",
            (e < cfg["enrollment"]["min"]) | (e > cfg["enrollment"]["max"]))
    change = (e.astype(float).diff().abs() / e.astype(float).shift(1)).fillna(0)
    lim = cfg["enrollment"]["max_daily_change_fraction"]
    c.count(g, f"enrollment changes gradually (daily change <= {lim:.0%})", change > lim,
            f"days exceeding (max observed {change.max():.2%})")
    c.count(g, "enrollment constant on non-school days within a holiday",
            (df["term"] == "holiday") & (df["term"].shift(1) == "holiday") & (e != e.shift(1)))
    c.count(g, "rainfall nonnegative", df["rainfall_mm"] < 0)
    cats = sorted(cfg["weather_categories"], key=lambda x: x["min_mm"])
    expected_cat = pd.Series(cats[0]["name"], index=df.index)
    for cat in cats[1:]:
        expected_cat[df["rainfall_mm"] >= cat["min_mm"]] = cat["name"]
    c.count(g, "weather_category consistent with rainfall thresholds", df["weather_category"] != expected_cat)

    # --- Attendance and meals --------------------------------------------------
    g = "attendance_meals"
    sd = df["is_school_day"]
    for col in SCHOOL_DAY_ONLY:
        c.count(g, f"{col} present on every school day", sd & df[col].isna(), "missing on school days")
        c.count(g, f"{col} null on non-school days", ~sd & df[col].notna(), "filled on non-school days")
    s = df[sd]
    c.count(g, "attendance nonnegative", s["students_present"] < 0)
    c.count(g, "attendance <= enrollment", s["students_present"] > s["students_enrolled"])
    for col in ("meals_planned", "meals_prepared", "meals_served", "estimated_meal_demand"):
        c.count(g, f"{col} nonnegative", s[col] < 0)
    c.count(g, "meals_served <= meals_prepared", s["meals_served"] > s["meals_prepared"])
    c.count(g, "meals_served <= students_present", s["meals_served"] > s["students_present"])
    c.count(g, "estimated_meal_demand <= students_present", s["estimated_meal_demand"] > s["students_present"])
    c.count(g, "meals_served == min(demand, prepared)",
            s["meals_served"] != np.minimum(s["estimated_meal_demand"], s["meals_prepared"]))

    # --- Leakage ---------------------------------------------------------------
    g = "leakage"
    recomputed = plan_meals(df, cfg)
    c.count(g, "meals_planned reproducible from prior-day information only",
            recomputed.to_numpy() != s["meals_planned"].to_numpy(), "school days differ")
    # Perturb same-day attendance and rainfall: planned value for that day must not change
    probe = df.copy()
    rng = np.random.default_rng(0)
    idx = rng.choice(s.index.to_numpy(), size=min(200, len(s)), replace=False)
    changed = 0
    for i in idx:
        p = probe.copy()
        p.loc[i, "students_present"] = 0
        p.loc[i, "rainfall_mm"] = 999.0
        changed += int(plan_meals(p, cfg).loc[i] != recomputed.loc[i])
    c.check(g, "same-day attendance/rainfall do not affect that day's plan", changed == 0,
            f"{changed} of {len(idx)} sampled days changed after perturbation")

    # --- Provenance ------------------------------------------------------------
    g = "provenance"
    c.count(g, "source_type is 'synthetic' for all generated records", df["source_type"] != "synthetic")
    c.count(g, "synthetic_scenario equals configured scenario",
            df["synthetic_scenario"] != cfg["scenario"]["name"])
    if US_REFERENCE_DAILY.exists():
        us = pd.read_csv(US_REFERENCE_DAILY)
        c.count(g, "US reference records labelled 'transformed'", us["source_type"] != "transformed")
        c.count(g, "US reference records have no synthetic_scenario", us["synthetic_scenario"].notna())
    else:
        c.check(g, "US reference daily file exists", False, f"missing {US_REFERENCE_DAILY}")
    if US_INSPECTION_JSON.exists() and RAW_US_DATASET.exists():
        recorded = read_json(US_INSPECTION_JSON)["file"]["sha256"]
        c.check(g, "raw US dataset unchanged since inspection", recorded == sha256_of(RAW_US_DATASET),
                f"sha256 {recorded[:12]}...")
    else:
        c.check(g, "raw US dataset and inspection record exist", False, "run inspect_us_dataset.py")

    # --- Reproducibility -------------------------------------------------------
    g = "reproducibility"
    if skip_repro:
        c.check(g, "regeneration with same config and seed is identical", False, "SKIPPED by flag")
    else:
        regen, _, _ = generate(CONFIG_PATH)
        regen.to_csv(SYNTHETIC_DATASET.with_suffix(".regen.tmp"), index=False)
        same = sha256_of(SYNTHETIC_DATASET.with_suffix(".regen.tmp")) == sha256_of(SYNTHETIC_DATASET)
        SYNTHETIC_DATASET.with_suffix(".regen.tmp").unlink()
        c.check(g, "regeneration with same config and seed is byte-identical", same, "")
        if meta:
            c.check(g, "config unchanged since generation", meta["config_sha256"] == sha256_of(CONFIG_PATH), "")
    return c.results


def render(results):
    passed = sum(r["passed"] for r in results)
    L = ["# Synthetic Dataset - Validation Report\n",
         "Generated by `forecasting/scripts/validate_synthetic_dataset.py`. Every row below is the result of a "
         "check that was executed against `forecasting/data/processed/synthetic_kenya_school_daily.csv`.\n",
         f"**{passed} of {len(results)} checks passed; {len(results) - passed} failed.**\n"]
    for group in dict.fromkeys(r["group"] for r in results):
        L.append(f"## {group}\n")
        L.append(md_table([["PASS" if r["passed"] else "FAIL", r["check"], r["detail"]]
                           for r in results if r["group"] == group], ["Result", "Check", "Detail"]))
        L.append("")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-reproducibility", action="store_true")
    args = ap.parse_args()
    results = run_checks(args.skip_reproducibility)
    write_json(VALIDATION_JSON, {"passed": sum(r["passed"] for r in results), "total": len(results),
                                 "results": results})
    VALIDATION_MD.write_text(render(results), encoding="utf-8")
    failed = [r for r in results if not r["passed"]]
    print(f"{len(results) - len(failed)}/{len(results)} checks passed.")
    for r in failed:
        print(f"  FAIL [{r['group']}] {r['check']}: {r['detail']}")
    print(f"  wrote {VALIDATION_MD}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
