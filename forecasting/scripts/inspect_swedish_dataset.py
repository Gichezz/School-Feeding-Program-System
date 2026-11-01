"""
Inspect the Swedish school lunch dataset and prepare it for the planning evaluation.

The dataset (Eriksson, Malefors, Secondi and Marchetti, 2021) counts the plates
used at lunch in Swedish public school canteens every day from 2010 to 2020,
with enrollment and canteen notes on special events. It is the only openly
published daily school meal series found, so it is used to test whether
forecasting improves on how schools plan today, on real data.

Cleaning (each rule is reported with the rows it removes):
  - primary school canteens only (SchoolData.xlsx); preschools are left out
  - school days only: weekdays that are not in the municipality's holiday list.
    During holidays only after-school care eats, a different population
  - days before 2020-03-01, so the COVID-19 period does not distort the series
  - zero counts are treated as missing, as the dataset authors do
  - canteens with fewer than MIN_SCHOOL_DAYS school days are left out

Day types come from the published holiday calendar, not from gaps in the
records, because only the calendar is known before the day.

Outputs
  data/processed/swedish_school_lunch_daily.csv   one row per canteen and school day
  data/reports/swedish/inspection.json
  data/reports/swedish/inspection.md

Usage
  python forecasting/scripts/fetch_open_datasets.py
  python forecasting/scripts/inspect_swedish_dataset.py
"""

import sys

import numpy as np
import pandas as pd

from common import PROCESSED_DIR, REPORTS_DIR, md_table, sha256_of, write_json
from fetch_open_datasets import SWEDISH_DIR

SWEDISH_DAILY = PROCESSED_DIR / "swedish_school_lunch_daily.csv"
SWEDISH_REPORTS = REPORTS_DIR / "swedish"

COVID_CUTOFF = pd.Timestamp("2020-03-01")
MIN_SCHOOL_DAYS = 600
MOVING_AVERAGE_DAYS = 20
LONG_BREAK_WEEKDAYS = 20  # summer holiday; other breaks are 1-10 weekdays

HOLIDAY_SHEETS = {
    "Sala": "Sala municipality",
    "Tierp": "Tierp municipality",
    "Härnösand": "Härnösand municipality",
}


def municipality(organization):
    return organization.replace(" kommun", "").replace("s kommun", "").rstrip("s")


def load():
    paths = {name: SWEDISH_DIR / name for name in ("SchoolData.xlsx", "Holidays.xlsx", "KitchenInformation.xlsx")}
    missing = [str(p) for p in paths.values() if not p.exists()]
    if missing:
        sys.exit("ERROR: dataset files not found: " + ", ".join(missing) +
                 "\nRun forecasting/scripts/fetch_open_datasets.py first.")
    meals = pd.read_excel(paths["SchoolData.xlsx"])
    holidays = pd.read_excel(paths["Holidays.xlsx"], sheet_name=None)
    kitchens = pd.read_excel(paths["KitchenInformation.xlsx"])
    files = {name: sha256_of(p) for name, p in paths.items()}
    return meals, holidays, kitchens, files


def school_day_calendar(holiday_dates, start, end):
    """
    Every weekday from start to end, with its position in the run of school days
    between breaks. A break is one or more weekdays in the holiday list.
    """
    days = pd.DataFrame({"date": pd.bdate_range(start, end)})
    days["school_day"] = ~days.date.isin(holiday_dates)
    run = (days.school_day != days.school_day.shift()).cumsum()
    days["run"] = run
    days["run_length"] = days.groupby("run").date.transform("size")
    school = days[days.school_day].copy()
    breaks = days[~days.school_day].groupby("run").size()
    school["day_in_run"] = school.groupby("run").cumcount() + 1
    school["days_to_break"] = school.run_length - school.day_in_run + 1
    school["break_before"] = (school.run - 1).map(breaks).fillna(0).astype(int)
    school["break_after"] = (school.run + 1).map(breaks).fillna(0).astype(int)
    return school.drop(columns=["school_day", "run", "run_length"])


def day_type(row):
    """One label per school day, most specific first."""
    if row.has_event:
        return "event noted"
    if row.day_in_run == 1 and row.break_before >= LONG_BREAK_WEEKDAYS:
        return "first day of school year"
    if row.days_to_break == 1 and row.break_after >= LONG_BREAK_WEEKDAYS:
        return "last day of school year"
    if row.day_in_run <= 2 and row.break_before > 0:
        return "first days after a break"
    if row.days_to_break <= 2 and row.break_after > 0:
        return "last days before a break"
    return "ordinary"


def prepare(meals, holidays, kitchens):
    steps = [("rows in SchoolData.xlsx", len(meals))]
    meals = meals.rename(columns={"CanteenCode": "canteen", "Students": "students",
                                  "EnrolledStudents": "enrolled", "Comments": "comment"})
    meals["municipality"] = meals.Organization.map(municipality)
    meals = meals[meals.Date.dt.dayofweek < 5]
    steps.append(("weekdays", len(meals)))

    frames = []
    for name, g in meals.groupby("municipality"):
        cal = school_day_calendar(set(holidays[HOLIDAY_SHEETS[name]].Date), g.Date.min(), g.Date.max())
        frames.append(g.merge(cal, left_on="Date", right_on="date"))
    df = pd.concat(frames)
    steps.append(("school days (not in the municipality's holiday list)", len(df)))

    df = df[df.date < COVID_CUTOFF]
    steps.append(("before 2020-03-01", len(df)))
    df = df[df.students.notna() & (df.students > 0)]
    steps.append(("with a recorded student count", len(df)))

    counts = df.groupby("canteen").size()
    kept = counts[counts >= MIN_SCHOOL_DAYS].index
    df = df[df.canteen.isin(kept)]
    steps.append((f"canteens with at least {MIN_SCHOOL_DAYS} school days", len(df)))

    df["has_event"] = df.comment.notna()
    df["day_type"] = df.apply(day_type, axis=1)
    df = df.merge(kitchens.rename(columns={"Code": "canteen", "KitchenType": "kitchen_type",
                                           "Urban/Rural": "urban_rural"})[["canteen", "kitchen_type", "urban_rural"]],
                  on="canteen", how="left")
    cols = ["canteen", "municipality", "kitchen_type", "urban_rural", "date", "students", "enrolled",
            "day_in_run", "days_to_break", "break_before", "break_after", "has_event", "day_type", "comment"]
    return df[cols].sort_values(["canteen", "date"]).reset_index(drop=True), steps


def wape(forecast, actual):
    mask = forecast.notna() & actual.notna()
    return float((forecast[mask] - actual[mask]).abs().sum() / actual[mask].sum())


def baselines(df):
    """
    Two ways a school can plan without a model, both using only earlier days:
    prepare for everyone enrolled, or for the average of the last 20 school days.
    """
    df = df.copy()
    df["cook_for_enrolled"] = df.enrolled
    df["moving_average"] = (df.groupby("canteen").students
                              .transform(lambda s: s.shift(1).rolling(MOVING_AVERAGE_DAYS, min_periods=5).mean()))
    # Error that no forecast can remove: each enrolled pupil eats or not
    # independently with the canteen's typical participation rate.
    part = (df.students / df.enrolled).clip(upper=1)
    p = part.groupby(df.canteen).transform("median")
    df["noise_floor_mae"] = np.sqrt(df.enrolled * p * (1 - p)) * np.sqrt(2 / np.pi)
    return df


def summarise(df):
    per_canteen = []
    for c, g in df.groupby("canteen"):
        per_canteen.append({
            "canteen": int(c),
            "municipality": g.municipality.iloc[0],
            "kitchen": g.kitchen_type.iloc[0],
            "area": g.urban_rural.iloc[0],
            "first_day": str(g.date.min().date()),
            "last_day": str(g.date.max().date()),
            "school_days": int(len(g)),
            "mean_students": round(float(g.students.mean()), 1),
            "median_enrolled": float(g.enrolled.median()) if g.enrolled.notna().any() else None,
            "participation": round(float((g.students / g.enrolled).median()), 3) if g.enrolled.notna().any() else None,
            "wape_cook_for_enrolled": round(wape(g.cook_for_enrolled, g.students), 4) if g.enrolled.notna().any() else None,
            "wape_moving_average": round(wape(g.moving_average, g.students), 4),
            "wape_noise_floor": round(float(g.noise_floor_mae.sum() / g.students.sum()), 4),
        })

    scored = df[df.moving_average.notna()]
    err = (scored.students - scored.moving_average) / scored.moving_average
    by_type = []
    for t, g in scored.groupby("day_type"):
        e = err[g.index]
        by_type.append({
            "day_type": t,
            "days": int(len(g)),
            "share": round(len(g) / len(scored), 3),
            "wape_moving_average": round(wape(g.moving_average, g.students), 4),
            "mean_error": round(float(e.mean()), 4),
            "share_of_total_abs_error": round(float((g.moving_average - g.students).abs().sum()
                                                    / (scored.moving_average - scored.students).abs().sum()), 3),
        })
    order = ["ordinary", "first days after a break", "last days before a break", "first day of school year",
             "last day of school year", "event noted"]
    by_type.sort(key=lambda r: order.index(r["day_type"]))

    has_enrolled = df.enrolled.notna()
    overall = {
        "canteens": int(df.canteen.nunique()),
        "school_days": int(len(df)),
        "wape_cook_for_enrolled": round(wape(df.cook_for_enrolled[has_enrolled], df.students[has_enrolled]), 4),
        "wape_moving_average": round(wape(scored.moving_average, scored.students), 4),
        "wape_noise_floor": round(float(df.noise_floor_mae.sum() / df.students.sum()), 4),
        "mean_error_cook_for_enrolled": round(float(((df.enrolled - df.students) / df.students)[has_enrolled].mean()), 4),
    }
    # How much of the moving average's error is explained by day type and weekday
    # alone: the share a calendar-aware model can at most hope to remove.
    group_mean = err.groupby([scored.canteen, scored.day_type, scored.date.dt.dayofweek, scored.date.dt.month]).transform("mean")
    overall["error_variance_explained_by_calendar"] = round(float(group_mean.var() / err.var()), 3)
    return overall, per_canteen, by_type


def write_report(overall, per_canteen, by_type, steps, files):
    SWEDISH_REPORTS.mkdir(parents=True, exist_ok=True)
    write_json(SWEDISH_REPORTS / "inspection.json",
               {"files_sha256": files, "cleaning": steps, "overall": overall,
                "per_canteen": per_canteen, "by_day_type": by_type})
    pct = lambda v: "–" if v is None else f"{v * 100:.1f}%"
    lines = [
        "# Swedish school lunch dataset: inspection",
        "",
        "Source: Eriksson, Malefors, Secondi and Marchetti (2021), *Guest attendance data from 34 Swedish "
        "pre-schools and primary schools*, Data in Brief; Mendeley Data doi:10.17632/4zr5dwnbbv.2 (CC BY-NC 3.0). "
        "Plates used at lunch stand for the number of pupils who ate.",
        "",
        "## Cleaning",
        "",
        md_table([[s, n] for s, n in steps], ["Step", "Rows left"]),
        "",
        "The three canteens in Tierp and Härnösand (16–18) drop out at the student-count step: they record only "
        "totals of pupils and staff together, on fewer than 160 days from September 2019, mostly in the COVID-19 period.",
        "",
        "## How schools plan without a model",
        "",
        f"Across {overall['canteens']} primary school canteens and {overall['school_days']:,} school days:",
        "",
        md_table([
            ["Prepare for every enrolled pupil", pct(overall["wape_cook_for_enrolled"])],
            [f"Average of the last {MOVING_AVERAGE_DAYS} school days", pct(overall["wape_moving_average"])],
            ["Noise floor (pupils eating independently; no forecast can beat it)", pct(overall["wape_noise_floor"])],
        ], ["Plan", "Error (WAPE)"]),
        "",
        f"Preparing for everyone enrolled over-prepares by {pct(overall['mean_error_cook_for_enrolled'])} on average. "
        "The moving average halves that error, but stays well above the noise floor, so there is room for a forecast to improve on it.",
        "",
        "## Where the moving average goes wrong",
        "",
        md_table([[r["day_type"], r["days"], pct(r["share"]), pct(r["wape_moving_average"]),
                   f"{r['mean_error'] * 100:+.1f}%", pct(r["share_of_total_abs_error"])] for r in by_type],
                 ["Day type", "Days", "Share of days", "Error (WAPE)", "Mean error (actual vs average)", "Share of all error"]),
        "",
        "A positive mean error means more pupils ate than the average expected. Day types come from the published "
        "holiday calendar; `event noted` means the canteen wrote a note for the day (trips, work placements, sports days).",
        "",
        f"Day type, weekday and month together explain {pct(overall['error_variance_explained_by_calendar'])} of the "
        "variance in the moving average's relative error. That is an upper bound on what calendar knowledge alone can remove; "
        "the rest is day-to-day noise and events that were not recorded.",
        "",
        "## Canteens",
        "",
        md_table([[r["canteen"], r["municipality"], r["kitchen"], r["area"], f"{r['first_day']} – {r['last_day']}",
                   r["school_days"], r["mean_students"], r["median_enrolled"], pct(r["participation"]),
                   pct(r["wape_cook_for_enrolled"]), pct(r["wape_moving_average"]), pct(r["wape_noise_floor"])]
                  for r in per_canteen],
                 ["Canteen", "Municipality", "Kitchen", "Area", "Period", "School days", "Mean pupils eating",
                  "Enrolled", "Participation", "Error: cook for enrolled", "Error: moving average", "Noise floor"]),
        "",
    ]
    (SWEDISH_REPORTS / "inspection.md").write_text("\n".join(lines), encoding="utf-8")


def main():
    meals, holidays, kitchens, files = load()
    df, steps = prepare(meals, holidays, kitchens)
    df = baselines(df)
    overall, per_canteen, by_type = summarise(df)
    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    df.drop(columns=["cook_for_enrolled", "moving_average", "noise_floor_mae"]).to_csv(SWEDISH_DAILY, index=False)
    write_report(overall, per_canteen, by_type, steps, files)
    print(f"Wrote {SWEDISH_DAILY} and {SWEDISH_REPORTS / 'inspection.md'}")
    print(overall)


if __name__ == "__main__":
    main()
