"""
Phase 9 - Step 2: generate the synthetic Kenyan school dataset.

Produces one record per calendar day for ONE SIMULATED Kenyan school, using the
assumptions in forecasting/config/synthetic_kenya_school.yaml and (optionally)
reference patterns derived from the US dataset by inspect_us_dataset.py.

US attendance values are never copied; only relative patterns (weekday offsets,
day-to-day persistence, pre-break dip) are reused where the config says so.

Outputs
  data/processed/synthetic_kenya_school_daily.csv
  data/processed/synthetic_kenya_school_metadata.json

Usage
  python forecasting/scripts/generate_synthetic_dataset.py [--config PATH]
"""

import argparse
import datetime as dt
import sys
from pathlib import Path

import numpy as np
import pandas as pd

from common import (
    CONFIG_PATH,
    SYNTHETIC_DATASET,
    SYNTHETIC_METADATA,
    US_REFERENCE_PROFILE,
    ensure_output_dirs,
    load_config,
    read_json,
    sha256_of,
    write_json,
)

DOW_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
US_REF = "us_reference"

COLUMNS = [
    "date", "day_of_week", "is_school_day", "is_school_holiday", "is_public_holiday",
    "term", "school_year", "week_of_term", "is_half_term", "is_exam_period",
    "students_enrolled", "rainfall_mm", "weather_category",
    "is_special_event", "special_event_type",
    "students_present", "meals_planned", "meals_prepared", "meals_served",
    "estimated_meal_demand", "is_supply_shortfall",
    "source_type", "synthetic_scenario",
]
BOOL_COLUMNS = [
    "is_school_day", "is_school_holiday", "is_public_holiday", "is_half_term",
    "is_exam_period", "is_special_event", "is_supply_shortfall",
]
INT_COLUMNS = [
    "school_year", "week_of_term", "students_enrolled", "students_present",
    "meals_planned", "meals_prepared", "meals_served", "estimated_meal_demand",
]


def logit(p):
    return np.log(p / (1 - p))


def sigmoid(x):
    return 1 / (1 + np.exp(-x))


# ---------------------------------------------------------------------------
# Reference profile
# ---------------------------------------------------------------------------

def resolve_reference_values(cfg):
    """Replace `us_reference` placeholders in the attendance config with US-derived values."""
    att = cfg["attendance"]
    keys = [k for k in ("dow_logit_offsets", "noise_ar1", "pre_break_logit") if att.get(k) == US_REF]
    used = {}
    if keys:
        if not US_REFERENCE_PROFILE.exists():
            sys.exit(
                f"ERROR: config requests US reference values for {keys} but {US_REFERENCE_PROFILE} "
                "does not exist. Run inspect_us_dataset.py first."
            )
        prof = read_json(US_REFERENCE_PROFILE)
        source = {
            "dow_logit_offsets": prof["dow_logit_offsets"],
            "noise_ar1": prof["within_school_residual_lag1_autocorr"],
            "pre_break_logit": prof["pre_break_logit_offset"],
        }
        for k in keys:
            att[k] = source[k]
            used[k] = source[k]
    return used


# ---------------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------------

def easter_sunday(year):
    """Gregorian Easter (anonymous algorithm)."""
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return dt.date(year, month, day)


def public_holidays(cal_cfg, year):
    ph = cal_cfg["public_holidays"]
    out = {}
    for h in ph["fixed"]:
        mm, dd = map(int, h["date"].split("-"))
        out[dt.date(year, mm, dd)] = h["name"]
    easter = easter_sunday(year)
    for h in ph["easter_based"]:
        out[easter + dt.timedelta(days=h["offset_days"])] = h["name"]
    if ph.get("sunday_observed_on_monday"):
        for d, name in sorted(out.copy().items()):
            if d.weekday() == 6:
                obs = d + dt.timedelta(days=1)
                while obs in out:
                    obs += dt.timedelta(days=1)
                out[obs] = name + "_observed"
    return out


def first_weekday_on_or_after(d, weekday):
    return d + dt.timedelta(days=(weekday - d.weekday()) % 7)


def build_terms(cal_cfg, years):
    terms = []
    overrides = cal_cfg.get("term_overrides") or {}
    for year in years:
        for t in cal_cfg["terms"]:
            term_id = f"{year}-{t['name']}"
            mm, dd = map(int, t["start_anchor"].split("-"))
            start = first_weekday_on_or_after(dt.date(year, mm, dd), 0)
            end = start + dt.timedelta(days=7 * t["weeks"] - 3)  # Friday of last week
            if term_id in overrides:
                start = dt.date.fromisoformat(overrides[term_id]["start"])
                end = dt.date.fromisoformat(overrides[term_id]["end"])
            ht = t["half_term"]
            week_monday = start - dt.timedelta(days=start.weekday()) + dt.timedelta(days=7 * (ht["week"] - 1))
            day = week_monday + dt.timedelta(days=DOW_NAMES.index(ht["start_weekday"]))
            half = []
            counted = 0
            while counted < ht["weekdays"]:
                half.append(day)
                if day.weekday() < 5:
                    counted += 1
                day += dt.timedelta(days=1)
            terms.append({"term_id": term_id, "name": t["name"], "year": year, "start": start,
                          "end": end, "half_term": set(half), "exams": t["exams"]})
    terms.sort(key=lambda x: x["start"])
    for a, b in zip(terms, terms[1:]):
        if b["start"] <= a["end"]:
            sys.exit(f"ERROR: terms {a['term_id']} and {b['term_id']} overlap; check the calendar config.")
    return terms


def build_calendar(cfg):
    cal = cfg["calendar"]
    start = pd.Timestamp(cfg["period"]["start_date"])
    end = pd.Timestamp(cfg["period"]["end_date"])
    dates = pd.date_range(start, end, freq="D")
    years = range(start.year, end.year + 1)
    terms = build_terms(cal, years)
    holidays = {}
    for y in years:
        holidays.update(public_holidays(cal, y))

    df = pd.DataFrame({"date": dates})
    d_date = df["date"].dt.date
    df["day_of_week"] = df["date"].dt.dayofweek.map(lambda i: DOW_NAMES[i])
    df["school_year"] = df["date"].dt.year
    df["term"] = "holiday"
    df["term_name"] = pd.NA
    df["week_of_term"] = pd.array([pd.NA] * len(df), dtype="Int64")
    df["is_half_term"] = False
    df["is_public_holiday"] = d_date.isin(holidays.keys())

    for t in terms:
        m = (d_date >= t["start"]) & (d_date <= t["end"])
        if not m.any():
            continue
        start_monday = pd.Timestamp(t["start"] - dt.timedelta(days=t["start"].weekday()))
        df.loc[m, "term"] = t["term_id"]
        df.loc[m, "term_name"] = t["name"]
        df.loc[m, "week_of_term"] = ((df.loc[m, "date"] - start_monday).dt.days // 7 + 1).astype("Int64")
        df.loc[m & d_date.isin(t["half_term"]), "is_half_term"] = True

    weekday_ok = df["day_of_week"].isin(cal["school_weekdays"])
    df["is_school_holiday"] = (df["term"] == "holiday") | df["is_half_term"] | df["is_public_holiday"]
    df["is_school_day"] = weekday_ok & ~df["is_school_holiday"]

    # Exam periods (school days only)
    df["is_exam_period"] = False
    for t in terms:
        sd_idx = df.index[(df["term"] == t["term_id"]) & df["is_school_day"]]
        if len(sd_idx) == 0:
            continue
        n_end = t["exams"]["end_of_term_school_days"]
        if n_end:
            df.loc[sd_idx[-n_end:], "is_exam_period"] = True
        n_mid = t["exams"]["mid_term_school_days"]
        if n_mid and t["half_term"]:
            first_half = pd.Timestamp(min(t["half_term"]))
            before = [i for i in sd_idx if df.at[i, "date"] < first_half]
            df.loc[before[-n_mid:], "is_exam_period"] = True

    # Helper flags (not exported) used by the attendance model
    sd = df[df["is_school_day"]]
    df["is_first_school_day_of_term"] = False
    df.loc[sd.index[~sd["term"].duplicated()], "is_first_school_day_of_term"] = True
    last_week = sd.groupby("term")["week_of_term"].transform("max")
    df["is_last_week_of_term"] = False
    df.loc[sd.index[sd["week_of_term"] == last_week], "is_last_week_of_term"] = True
    # School day whose next weekday is an in-term break (half-term or public holiday)
    nxt = df["date"] + pd.to_timedelta(np.where(df["date"].dt.dayofweek == 4, 3, 1), unit="D")
    lookup = df.set_index("date")
    nxt_in = nxt.isin(lookup.index)
    nxt_break = pd.Series(False, index=df.index)
    nxt_break[nxt_in] = (
        lookup.loc[nxt[nxt_in], "is_school_holiday"].values
        & (lookup.loc[nxt[nxt_in], "term"].values != "holiday")
    )
    df["is_pre_break"] = df["is_school_day"] & nxt_break
    return df, terms


# ---------------------------------------------------------------------------
# Enrollment, rainfall, events
# ---------------------------------------------------------------------------

def simulate_enrollment(df, terms, cfg, rng):
    e = cfg["enrollment"]
    term_starts = {pd.Timestamp(t["start"]): t for t in terms}
    value = float(e["initial"])
    out = np.empty(len(df), dtype=np.int64)
    for i, (date, term) in enumerate(zip(df["date"], df["term"])):
        if date in term_starts:
            t = term_starts[date]
            if t["name"] == cfg["calendar"]["terms"][0]["name"]:
                value *= 1 + rng.normal(e["annual_growth_mean"], e["annual_growth_sd"])
            else:
                value *= 1 + rng.normal(e["between_term_change_mean"], e["between_term_change_sd"])
        elif term != "holiday" and date.dayofweek == 0:
            value += rng.poisson(e["weekly_transfers_in_mean"]) - rng.poisson(e["weekly_transfers_out_mean"])
        value = float(np.clip(round(value), e["min"], e["max"]))
        out[i] = int(value)
    return out


def simulate_rainfall(df, cfg, rng):
    r = cfg["rainfall"]
    years = sorted(df["school_year"].unique())
    mult = {(y, s): float(np.exp(rng.normal(0, r["season_multiplier_sd"]))) for y in years for s in ("long", "short")}
    rain = np.zeros(len(df))
    wet_prev = False
    for i, date in enumerate(df["date"]):
        m = date.month
        season = "long" if m in r["long_rains_months"] else "short" if m in r["short_rains_months"] else None
        k = np.sqrt(mult[(date.year, season)]) if season else 1.0
        p = min(0.95, r["monthly_wet_day_probability"][m - 1] * k)
        p_ww = p + r["wet_day_persistence"] * (1 - p)
        p_dw = p * (1 - p_ww) / (1 - p)  # keeps the long-run wet-day frequency at p
        wet = rng.random() < (p_ww if wet_prev else p_dw)
        if wet:
            mean = r["monthly_mean_wet_day_mm"][m - 1] * k
            shape = r["wet_day_gamma_shape"]
            rain[i] = max(0.1, round(rng.gamma(shape, mean / shape), 1))
        wet_prev = wet
    return rain


def categorise_weather(rain, categories):
    cats = sorted(categories, key=lambda c: c["min_mm"])
    out = np.full(len(rain), cats[0]["name"], dtype=object)
    for c in cats[1:]:
        out[rain >= c["min_mm"]] = c["name"]
    return out


def simulate_events(df, terms, cfg, rng):
    ev = cfg["special_events"]
    types = np.full(len(df), None, dtype=object)
    for t in terms:
        idx = df.index[(df["term"] == t["term_id"]) & df["is_school_day"]]
        eligible = [i for i in idx[ev["skip_first_school_days"]:] if not df.at[i, "is_exam_period"]]
        n = min(rng.poisson(ev["mean_events_per_term"]), len(eligible))
        if n == 0:
            continue
        chosen = rng.choice(eligible, size=n, replace=False)
        w = ev["type_weights_by_term"][t["name"]]
        names = list(w.keys())
        probs = np.array([w[k] for k in names], dtype=float)
        types[chosen] = rng.choice(names, size=n, p=probs / probs.sum())
    return types


# ---------------------------------------------------------------------------
# Attendance and meals
# ---------------------------------------------------------------------------

def draw_effect(spec, rng):
    return rng.normal(spec["mean"], spec["sd"]) if spec["sd"] > 0 else spec["mean"]


def simulate_attendance(df, terms, cfg, rngs):
    a = cfg["attendance"]
    sd_idx = df.index[df["is_school_day"]].to_numpy()
    n = len(sd_idx)
    sub = df.loc[sd_idx]

    # Shock episodes (multi-day dips)
    shock = pd.Series(0.0, index=sd_idx)
    lo, hi = a["shock_duration_school_days"]
    for t in terms:
        tidx = sub.index[sub["term"] == t["term_id"]]
        for _ in range(rngs["shocks"].poisson(a["shock_episodes_per_term"])):
            if len(tidx) == 0:
                break
            dur = int(rngs["shocks"].integers(lo, hi + 1))
            start = int(rngs["shocks"].integers(0, len(tidx)))
            peak = rngs["shocks"].uniform(*a["shock_peak_logit_drop"])
            for k in range(dur):
                if start + k >= len(tidx):
                    break
                shape = 1 - abs(k - (dur - 1) / 2) / ((dur + 1) / 2)
                shock[tidx[start + k]] -= peak * shape

    # Persistent day-to-day noise (AR(1) over consecutive school days)
    ar = float(a["noise_ar1"])
    z = rngs["attendance"].normal(0, 1, n)
    noise = np.empty(n)
    noise[0] = a["noise_sd_logit"] * z[0]
    for i in range(1, n):
        noise[i] = ar * noise[i - 1] + np.sqrt(1 - ar ** 2) * a["noise_sd_logit"] * z[i]

    years = sorted(df["school_year"].unique())
    year_eff = {y: rngs["attendance"].normal(0, a["school_year_effect_sd_logit"]) for y in years}
    dow = a["dow_logit_offsets"]

    weather = np.array([draw_effect(a["weather_effects"][c], rngs["effects"]) for c in sub["weather_category"]])
    event = np.array([draw_effect(a["event_effects"][t], rngs["effects"]) if t else 0.0
                      for t in sub["special_event_type"]])

    lp = (
        logit(a["base_rate"])
        + sub["day_of_week"].map(lambda d: dow.get(d, 0.0)).to_numpy() * a["dow_scale"]
        + sub["school_year"].map(year_eff).to_numpy()
        + sub["is_first_school_day_of_term"].to_numpy() * a["first_day_of_term_logit"]
        + (sub["week_of_term"] == 1).to_numpy(dtype=bool) * a["first_week_of_term_logit"]
        + sub["is_last_week_of_term"].to_numpy() * a["last_week_of_term_logit"]
        + sub["is_pre_break"].to_numpy() * a["pre_break_logit"]
        + sub["is_exam_period"].to_numpy() * a["exam_logit"]
        + weather + event + shock.to_numpy() + noise
    )
    present = rngs["attendance"].binomial(sub["students_enrolled"].to_numpy(), sigmoid(lp))

    # Latent meal demand: present students who would take the meal
    u = cfg["meals"]["uptake"]
    ulp = (
        logit(u["base_rate"])
        + np.array([u["event_effects"].get(t, 0.0) if t else 0.0 for t in sub["special_event_type"]])
        + rngs["uptake"].normal(0, u["noise_sd_logit"], n)
    )
    demand = rngs["uptake"].binomial(present, sigmoid(ulp))
    return sd_idx, present, demand


def plan_meals(df, cfg):
    """
    Meals planned before each school day.

    Uses ONLY: attendance/enrollment of previous school days, the previous
    calendar day's enrollment, and calendar/scheduled-event fields known in
    advance. Same-day students_present, rainfall and weather are never used.
    The validator re-runs this function on the saved CSV to confirm it.
    """
    p = cfg["meals"]["planning"]
    adj_cfg = p["adjustments"]
    sd = df[df["is_school_day"].astype(bool)]
    rate = sd["students_present"].astype(float) / sd["students_enrolled"].astype(float)
    hist = rate.shift(1).rolling(p["lookback_school_days"], min_periods=1).mean()
    hist = hist.fillna(p["default_rate_without_history"])
    enr_prev = df["students_enrolled"].astype(float).shift(1).fillna(cfg["enrollment"]["initial"]).loc[sd.index]

    first_day = ~sd["term"].duplicated()
    adj = np.ones(len(sd))
    adj *= np.where(first_day, adj_cfg["first_day_of_term"], 1.0)
    adj *= np.where(sd["week_of_term"].astype(float) == 1, adj_cfg["first_week_of_term"], 1.0)
    adj *= np.where(sd["is_exam_period"].astype(bool), adj_cfg["exam_period"], 1.0)
    adj *= np.array([adj_cfg["event"].get(t, 1.0) if isinstance(t, str) else 1.0
                     for t in sd["special_event_type"]])

    step = p["round_up_to"]
    raw = hist.to_numpy() * adj * enr_prev.to_numpy() * (1 + p["buffer_fraction"])
    planned = (np.ceil(np.round(raw / step, 9)) * step).astype(np.int64)
    return pd.Series(planned, index=sd.index)


def prepare_meals(df, planned, cfg, rng):
    p = cfg["meals"]["preparation"]
    rainy = set(cfg["rainfall"]["long_rains_months"]) | set(cfg["rainfall"]["short_rains_months"])
    months = df.loc[planned.index, "date"].dt.month.to_numpy()
    prob = np.where(np.isin(months, list(rainy)), p["shortfall_probability"] * p["shortfall_rainy_month_multiplier"],
                    p["shortfall_probability"])
    shortfall = rng.random(len(planned)) < prob
    frac = rng.uniform(*p["shortfall_fraction_range"], len(planned))
    normal = planned.to_numpy() * (1 + rng.normal(0, p["deviation_sd_fraction"], len(planned)))
    prepared = np.where(shortfall, planned.to_numpy() * (1 - frac), normal)
    return np.maximum(0, np.round(prepared)).astype(np.int64), shortfall


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def generate(config_path=CONFIG_PATH):
    cfg = load_config(config_path)
    reference_used = resolve_reference_values(cfg)
    streams = ["enrollment", "rainfall", "events", "attendance", "shocks", "effects", "uptake", "preparation"]
    children = np.random.SeedSequence(cfg["random_seed"]).spawn(len(streams))
    rngs = {name: np.random.default_rng(s) for name, s in zip(streams, children)}

    df, terms = build_calendar(cfg)
    df["students_enrolled"] = simulate_enrollment(df, terms, cfg, rngs["enrollment"])
    df["rainfall_mm"] = simulate_rainfall(df, cfg, rngs["rainfall"])
    df["weather_category"] = categorise_weather(df["rainfall_mm"].to_numpy(), cfg["weather_categories"])
    df["special_event_type"] = simulate_events(df, terms, cfg, rngs["events"])
    df["is_special_event"] = df["special_event_type"].notna()

    sd_idx, present, demand = simulate_attendance(df, terms, cfg, rngs)
    for col in ("students_present", "estimated_meal_demand", "meals_planned", "meals_prepared", "meals_served"):
        df[col] = pd.array([pd.NA] * len(df), dtype="Int64")
    df["is_supply_shortfall"] = pd.array([pd.NA] * len(df), dtype="boolean")
    df.loc[sd_idx, "students_present"] = present
    df.loc[sd_idx, "estimated_meal_demand"] = demand

    planned = plan_meals(df, cfg)
    prepared, shortfall = prepare_meals(df, planned, cfg, rngs["preparation"])
    df.loc[planned.index, "meals_planned"] = planned.to_numpy()
    df.loc[planned.index, "meals_prepared"] = prepared
    df.loc[planned.index, "meals_served"] = np.minimum(demand, prepared)
    df.loc[planned.index, "is_supply_shortfall"] = shortfall

    df["source_type"] = "synthetic"
    df["synthetic_scenario"] = cfg["scenario"]["name"]
    df["date"] = df["date"].dt.strftime("%Y-%m-%d")
    for c in INT_COLUMNS:
        df[c] = df[c].astype("Int64")
    for c in BOOL_COLUMNS:
        df[c] = df[c].astype("boolean")
    return df[COLUMNS].reset_index(drop=True), cfg, reference_used


def load_dataset(path=SYNTHETIC_DATASET):
    """Read the generated CSV back with the intended nullable dtypes."""
    df = pd.read_csv(path, dtype=str, keep_default_na=False)
    for c in INT_COLUMNS:
        df[c] = pd.to_numeric(df[c].replace("", pd.NA)).astype("Int64")
    for c in BOOL_COLUMNS:
        df[c] = df[c].map({"True": True, "False": False, "": pd.NA}).astype("boolean")
    df["rainfall_mm"] = pd.to_numeric(df["rainfall_mm"].replace("", pd.NA))
    for c in ("special_event_type", "synthetic_scenario"):
        df[c] = df[c].replace("", pd.NA)
    return df


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", type=Path, default=CONFIG_PATH)
    args = ap.parse_args()

    ensure_output_dirs()
    df, cfg, reference_used = generate(args.config)
    df.to_csv(SYNTHETIC_DATASET, index=False)

    school = df[df["is_school_day"]]
    meta = {
        "dataset": SYNTHETIC_DATASET.name,
        "description": "Synthetic daily records for ONE SIMULATED Kenyan school. Not observed data.",
        "scenario": cfg["scenario"],
        "random_seed": cfg["random_seed"],
        "config_file": Path(args.config).resolve().relative_to(Path(args.config).resolve().parents[2]).as_posix(),
        "config_sha256": sha256_of(args.config),
        "us_reference_values_used": reference_used,
        "period": cfg["period"],
        "records": int(len(df)),
        "school_days": int(len(school)),
        "columns": COLUMNS,
        "dataset_sha256": sha256_of(SYNTHETIC_DATASET),
        "generated_at_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
    }
    write_json(SYNTHETIC_METADATA, meta)
    print(f"Generated {len(df):,} records ({meta['school_days']:,} school days), "
          f"{df['date'].iloc[0]} to {df['date'].iloc[-1]}, seed {cfg['random_seed']}.")
    print(f"  wrote {SYNTHETIC_DATASET}")
    print(f"  wrote {SYNTHETIC_METADATA}")


if __name__ == "__main__":
    main()
