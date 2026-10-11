"""
Phase 9 - Step 1: inspect the downloaded US school attendance dataset.

Reads the raw CSV (read-only), documents its structure and data-quality issues,
and derives a small reference profile that the synthetic generator may use.

Outputs
  data/reports/us_dataset_inspection.json   machine-readable findings
  data/reports/us_dataset_inspection.md     human-readable report
  data/processed/us_reference_daily.csv     daily all-school aggregate (transformed)
  data/processed/us_reference_profile.json  day-of-week / noise reference stats

Usage
  python forecasting/scripts/inspect_us_dataset.py
"""

import sys

import numpy as np
import pandas as pd

from common import (
    RAW_US_DATASET,
    US_INSPECTION_JSON,
    US_INSPECTION_MD,
    US_REFERENCE_DAILY,
    US_REFERENCE_PROFILE,
    ensure_output_dirs,
    md_table,
    sha256_of,
    write_json,
)

DOW_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
NUMERIC_COLS = ["Enrolled", "Absent", "Present", "Released"]

# Profile-derivation filters (documented in the report)
MIN_RECORDS_PER_SCHOOL = 150
MIN_DATE_COVERAGE = 0.5  # fraction of the maximum number of schools reporting on any date


def logit(p):
    p = np.clip(p, 0.005, 0.995)
    return np.log(p / (1 - p))


def inspect(path):
    if not path.exists():
        sys.exit(
            f"ERROR: raw US dataset not found at {path}.\n"
            "Place the Kaggle CSV there before running this script. "
            "No substitute dataset will be used."
        )

    sha_before = sha256_of(path)
    raw = pd.read_csv(path)  # default inference, to report types as they load
    as_text = pd.read_csv(path, dtype=str, keep_default_na=False)

    info = {
        "file": {
            "filename": path.name,
            "relative_path": "forecasting/data/raw/" + path.name,
            "format": "CSV (comma-separated, header row, UTF-8/ASCII)",
            "size_bytes": path.stat().st_size,
            "sha256": sha_before,
        },
        "shape": {"rows": int(raw.shape[0]), "columns": int(raw.shape[1])},
        "columns": [
            {"name": c, "inferred_dtype": str(raw[c].dtype), "example": as_text[c].iloc[0]}
            for c in raw.columns
        ],
    }

    # Missing values: both true NaN and empty strings
    info["missing_values"] = {
        c: {"nan": int(raw[c].isna().sum()), "empty_string": int((as_text[c].str.strip() == "").sum())}
        for c in raw.columns
    }

    # Dates are stored as integers in YYYYMMDD form
    dates = pd.to_datetime(as_text["Date"], format="%Y%m%d", errors="coerce")
    info["dates"] = {
        "storage_format": "integer YYYYMMDD",
        "unparseable": int(dates.isna().sum()),
        "min": str(dates.min().date()),
        "max": str(dates.max().date()),
        "unique_dates": int(dates.nunique()),
        "calendar_days_in_range": int((dates.max() - dates.min()).days + 1),
        "records_by_weekday": {DOW_NAMES[k]: int(v) for k, v in dates.dt.dayofweek.value_counts().sort_index().items()},
        "unique_dates_by_month": {k: int(v) for k, v in dates.drop_duplicates().dt.strftime("%Y-%m").value_counts().sort_index().items()},
        "weekend_records": int((dates.dt.dayofweek >= 5).sum()),
    }

    df = raw.copy()
    df["date"] = dates
    num = df[NUMERIC_COLS]

    info["duplicates"] = {
        "exact_duplicate_rows": int(df.duplicated(subset=list(raw.columns)).sum()),
        "duplicate_school_date_keys": int(df.duplicated(["School DBN", "Date"]).sum()),
    }

    info["numeric_summary"] = {
        c: {k: round(float(v), 3) for k, v in num[c].describe().items()} for c in NUMERIC_COLS
    }

    per_school = df.groupby("School DBN").size()
    info["schools"] = {
        "unique_schools": int(per_school.size),
        "records_per_school": {k: round(float(v), 1) for k, v in per_school.describe().items()},
        "schools_with_fewer_than_100_records": int((per_school < 100).sum()),
        "dbn_pattern_note": "School DBN looks like District-Borough-Number (e.g. 01M015); "
        "the file itself does not document the code.",
    }

    identity = num["Present"] + num["Absent"] + num["Released"] == num["Enrolled"]
    rate = num["Present"] / num["Enrolled"].where(num["Enrolled"] > 0)
    info["consistency"] = {
        "present_plus_absent_eq_enrolled": int((num["Present"] + num["Absent"] == num["Enrolled"]).sum()),
        "present_plus_absent_plus_released_eq_enrolled": int(identity.sum()),
        "rows_with_released_gt_0": int((num["Released"] > 0).sum()),
        "rows_present_gt_enrolled": int((num["Present"] > num["Enrolled"]).sum()),
        "rows_enrolled_eq_0": int((num["Enrolled"] == 0).sum()),
        "rows_negative_any": int((num < 0).any(axis=1).sum()),
        "rows_enrolled_lt_20": int((num["Enrolled"] < 20).sum()),
        "rows_attendance_rate_lt_0.5": int((rate < 0.5).sum()),
        "rows_released_ge_half_of_enrolled": int((num["Released"] >= 0.5 * num["Enrolled"]).sum()),
    }
    info["attendance_rate_school_day"] = {k: round(float(v), 4) for k, v in rate.describe().items()}

    # Per-date coverage: how many schools reported on each date
    cov = df.groupby("date")["School DBN"].nunique()
    threshold = MIN_DATE_COVERAGE * cov.max()
    low_cov = cov[cov < threshold]
    info["date_coverage"] = {
        "max_schools_on_a_date": int(cov.max()),
        "median_schools_on_a_date": float(cov.median()),
        "low_coverage_threshold": float(threshold),
        "low_coverage_dates": {str(d.date()): int(n) for d, n in low_cov.items()},
    }

    # Daily all-school aggregate (transformed record type)
    daily = df.groupby("date").agg(
        n_schools_reporting=("School DBN", "nunique"),
        enrolled_total=("Enrolled", "sum"),
        present_total=("Present", "sum"),
        absent_total=("Absent", "sum"),
        released_total=("Released", "sum"),
    )
    daily["attendance_rate"] = (daily["present_total"] / daily["enrolled_total"]).round(5)
    daily["day_of_week"] = [DOW_NAMES[d.dayofweek] for d in daily.index]
    daily["is_low_coverage"] = daily["n_schools_reporting"] < threshold
    daily["source_type"] = "transformed"
    daily["source_dataset"] = path.name
    daily["transformation"] = "sum over all schools reporting on the date"
    daily["synthetic_scenario"] = pd.NA
    daily = daily.reset_index()
    daily["date"] = daily["date"].dt.strftime("%Y-%m-%d")

    good_daily = daily[~daily["is_low_coverage"]]
    info["daily_aggregate_rate_full_coverage_dates"] = {
        k: round(float(v), 4) for k, v in good_daily["attendance_rate"].describe().items()
    }
    lowest = good_daily.nsmallest(5, "attendance_rate")[["date", "day_of_week", "attendance_rate"]]
    info["lowest_rate_full_coverage_dates"] = lowest.to_dict("records")

    profile = derive_profile(df, cov, threshold)

    sha_after = sha256_of(path)
    info["raw_file_unchanged"] = sha_before == sha_after
    return info, daily, profile


def derive_profile(df, cov, threshold):
    """Within-school day-of-week offsets, noise level and persistence on the logit scale."""
    good_dates = set(cov[cov >= threshold].index)
    counts = df.groupby("School DBN").size()
    good_schools = set(counts[counts >= MIN_RECORDS_PER_SCHOOL].index)
    d = df[df["date"].isin(good_dates) & df["School DBN"].isin(good_schools)].copy()
    d = d.sort_values(["School DBN", "date"])
    d["lr"] = logit(d["Present"] / d["Enrolled"])
    d["dev"] = d["lr"] - d.groupby("School DBN")["lr"].transform("mean")
    d["dow"] = d["date"].dt.dayofweek

    dow = d.groupby("dow")["dev"].mean()
    dow = dow - dow.mean()
    d["resid"] = d["dev"] - d["dow"].map(dow)

    prev = d.groupby("School DBN")["resid"].shift(1)
    same = prev.notna()
    ar1 = float(np.corrcoef(d.loc[same, "resid"], prev[same])[0, 1])

    # Attendance on the last record before / first record after a gap of >= 4 days
    nxt_gap = (d.groupby("School DBN")["date"].shift(-1) - d["date"]).dt.days
    prv_gap = (d["date"] - d.groupby("School DBN")["date"].shift(1)).dt.days

    return {
        "source_type": "transformed",
        "source_dataset": RAW_US_DATASET.name,
        "note": "Derived from US (New York City-style) school records. Reference only; "
        "not Kenyan data.",
        "filters": {
            "min_records_per_school": MIN_RECORDS_PER_SCHOOL,
            "min_date_coverage_fraction": MIN_DATE_COVERAGE,
            "schools_used": int(d["School DBN"].nunique()),
            "school_days_used": int(len(d)),
        },
        "mean_attendance_rate": round(float((d["Present"] / d["Enrolled"]).mean()), 4),
        "dow_logit_offsets": {DOW_NAMES[k]: round(float(v), 4) for k, v in dow.items()},
        "within_school_residual_sd_logit": round(float(d["resid"].std()), 4),
        "within_school_residual_robust_sd_logit": round(float(1.4826 * (d["resid"] - d["resid"].median()).abs().median()), 4),
        "within_school_residual_lag1_autocorr": round(ar1, 4),
        "pre_break_logit_offset": round(float(d.loc[nxt_gap >= 4, "resid"].mean()), 4),
        "post_break_logit_offset": round(float(d.loc[prv_gap >= 4, "resid"].mean()), 4),
    }


def render_markdown(info, profile):
    L = []
    f = info["file"]
    L.append("# US School Attendance Dataset - Inspection Report\n")
    L.append("Generated by `forecasting/scripts/inspect_us_dataset.py`. The raw file is read-only; "
             f"its SHA-256 was identical before and after inspection: **{info['raw_file_unchanged']}**.\n")
    L.append("> This dataset describes **US schools** (the School DBN codes follow the New York City "
             "Department of Education format). It is **not** Kenyan data and is used only as a reference.\n")
    L.append("## 1. File\n")
    L.append(md_table([
        ["Filename", f["filename"]], ["Location", f["relative_path"]], ["Format", f["format"]],
        ["Size", f"{f['size_bytes']:,} bytes"], ["SHA-256", f"`{f['sha256']}`"],
        ["Rows", f"{info['shape']['rows']:,}"], ["Columns", info["shape"]["columns"]],
    ], ["Property", "Value"]))
    L.append("\n## 2. Columns\n")
    miss = info["missing_values"]
    L.append(md_table([[c["name"], c["inferred_dtype"], c["example"], miss[c["name"]]["nan"],
                        miss[c["name"]]["empty_string"]] for c in info["columns"]],
                      ["Column", "Inferred dtype", "Example", "Missing (NaN)", "Empty strings"]))
    L.append("\n## 3. Dates\n")
    dt = info["dates"]
    L.append(md_table([
        ["Storage", dt["storage_format"]], ["Unparseable", dt["unparseable"]],
        ["Range", f"{dt['min']} to {dt['max']}"], ["Unique dates", dt["unique_dates"]],
        ["Calendar days spanned", dt["calendar_days_in_range"]], ["Weekend records", dt["weekend_records"]],
    ], ["Property", "Value"]))
    L.append("\nRecords by weekday: " + ", ".join(f"{k} {v:,}" for k, v in dt["records_by_weekday"].items()))
    L.append("\n\nUnique dates by month: " + ", ".join(f"{k}: {v}" for k, v in dt["unique_dates_by_month"].items()))
    L.append("\n\nThe dataset covers **one US school year (2018-19)** only, recorded on school days.\n")
    L.append("## 4. Duplicates and schools\n")
    L.append(md_table([
        ["Exact duplicate rows", info["duplicates"]["exact_duplicate_rows"]],
        ["Duplicate (School DBN, Date) keys", info["duplicates"]["duplicate_school_date_keys"]],
        ["Unique schools", info["schools"]["unique_schools"]],
        ["Records per school (min / median / max)",
         f"{info['schools']['records_per_school']['min']:.0f} / {info['schools']['records_per_school']['50%']:.0f} / "
         f"{info['schools']['records_per_school']['max']:.0f}"],
        ["Schools with < 100 records", info["schools"]["schools_with_fewer_than_100_records"]],
    ], ["Check", "Result"]))
    L.append("\n## 5. Numeric fields\n")
    ns = info["numeric_summary"]
    L.append(md_table([[c, ns[c]["mean"], ns[c]["std"], ns[c]["min"], ns[c]["50%"], ns[c]["max"]] for c in ns],
                      ["Column", "Mean", "Std", "Min", "Median", "Max"]))
    L.append("\n## 6. Internal consistency\n")
    cs = info["consistency"]
    L.append(md_table([[k, f"{v:,}"] for k, v in cs.items()], ["Check", "Rows"]))
    L.append(f"\n`Present + Absent + Released = Enrolled` holds on {cs['present_plus_absent_plus_released_eq_enrolled']:,} "
             f"of {info['shape']['rows']:,} rows. The meaning of `Released` is not documented in the file; "
             "it is not interpreted further here.\n")
    L.append("## 7. Attendance\n")
    r = info["attendance_rate_school_day"]
    L.append(f"School-day attendance rate (Present / Enrolled): mean {r['mean']:.3f}, median {r['50%']:.3f}, "
             f"std {r['std']:.3f}, min {r['min']:.4f}, max {r['max']:.3f}.\n")
    g = info["daily_aggregate_rate_full_coverage_dates"]
    L.append(f"All-school daily rate on full-coverage dates: mean {g['mean']:.3f}, min {g['min']:.3f}, max {g['max']:.3f}.\n")
    L.append("Lowest full-coverage dates: " + ", ".join(
        f"{x['date']} ({x['day_of_week']}, {x['attendance_rate']:.3f})" for x in info["lowest_rate_full_coverage_dates"]) +
        ". The dataset has no field explaining these dips (e.g. weather); causes are not inferred.\n")
    L.append("## 8. Date coverage\n")
    dc = info["date_coverage"]
    L.append(f"Up to {dc['max_schools_on_a_date']:,} schools report on a date (median {dc['median_schools_on_a_date']:.0f}). "
             f"Dates with fewer than {dc['low_coverage_threshold']:.0f} schools reporting:\n")
    L.append(md_table([[d, n] for d, n in dc["low_coverage_dates"].items()], ["Date", "Schools reporting"]))
    L.append("\n## 9. Relevance to attendance and meal-demand forecasting\n")
    L.append(md_table([
        ["School DBN", "School identifier", "Grouping only; US-specific code, not reused"],
        ["Date", "Calendar date of a school day", "Used to derive day-of-week and break-adjacency patterns"],
        ["Enrolled", "Students on register", "Used only to compute rates; US enrolment levels are not reused"],
        ["Present", "Students present", "Attendance-rate reference (via Present / Enrolled)"],
        ["Absent", "Students absent", "Redundant with Present (identity above)"],
        ["Released", "Undocumented count", "Not used"],
    ], ["Field", "Content", "Relevance"]))
    L.append("\nThe dataset contains **no** meal, weather, holiday, examination or special-event fields. "
             "It only covers school days, so non-school days are absent rather than recorded.\n")
    L.append("## 10. Data-quality issues\n")
    issues = [
        f"Only one school year (185 dates) - too short to learn yearly seasonality directly.",
        f"{len(dc['low_coverage_dates'])} dates have very few schools reporting; including them would distort aggregates.",
        f"{info['schools']['schools_with_fewer_than_100_records']} schools have fewer than 100 records (openings, closures or reporting gaps).",
        f"{cs['rows_released_ge_half_of_enrolled']:,} rows have Released >= half of Enrolled, so Present+Absent can be far below Enrolled.",
        f"{cs['rows_attendance_rate_lt_0.5']:,} school-days have an attendance rate below 0.5.",
        f"{cs['rows_enrolled_lt_20']:,} rows have fewer than 20 enrolled students (rates are very noisy).",
        "Date stored as an integer, not an ISO date.",
        "No documentation of field definitions inside the file.",
    ]
    L.extend(f"- {i}" for i in issues)
    L.append("\n## 11. Derived reference profile\n")
    L.append(f"Written to `forecasting/data/processed/us_reference_profile.json`. Uses schools with >= "
             f"{MIN_RECORDS_PER_SCHOOL} records and dates with >= {MIN_DATE_COVERAGE:.0%} of maximum coverage "
             f"({profile['filters']['schools_used']:,} schools, {profile['filters']['school_days_used']:,} school-days). "
             "Values are on the logit scale of the attendance rate, relative to each school's own mean.\n")
    L.append(md_table([[k, v] for k, v in profile["dow_logit_offsets"].items()], ["Weekday", "Logit offset"]))
    L.append(f"\n- Within-school residual SD (logit): {profile['within_school_residual_sd_logit']}")
    L.append(f"- Within-school residual robust SD (1.4826 x MAD, logit): {profile['within_school_residual_robust_sd_logit']} "
             "(less sensitive to the heavy-tailed low-attendance days)")
    L.append(f"- Lag-1 autocorrelation of residuals: {profile['within_school_residual_lag1_autocorr']}")
    L.append(f"- Last day before a >=4-day break, mean logit offset: {profile['pre_break_logit_offset']}")
    L.append(f"- First day after a >=4-day break, mean logit offset: {profile['post_break_logit_offset']}")
    L.append(f"- Mean school-day attendance rate: {profile['mean_attendance_rate']} (reported only; not reused as the Kenyan base rate)\n")
    return "\n".join(L)


def main():
    ensure_output_dirs()
    info, daily, profile = inspect(RAW_US_DATASET)
    write_json(US_INSPECTION_JSON, info)
    write_json(US_REFERENCE_PROFILE, profile)
    daily.to_csv(US_REFERENCE_DAILY, index=False)
    US_INSPECTION_MD.write_text(render_markdown(info, profile), encoding="utf-8")
    print(f"Inspected {info['file']['filename']}: {info['shape']['rows']:,} rows x {info['shape']['columns']} columns, "
          f"{info['dates']['unique_dates']} dates ({info['dates']['min']} to {info['dates']['max']}).")
    print(f"Raw file unchanged: {info['raw_file_unchanged']}")
    for p in (US_INSPECTION_MD, US_INSPECTION_JSON, US_REFERENCE_DAILY, US_REFERENCE_PROFILE):
        print(f"  wrote {p}")


if __name__ == "__main__":
    main()
