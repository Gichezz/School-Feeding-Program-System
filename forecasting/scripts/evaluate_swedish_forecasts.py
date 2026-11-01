"""
Does forecasting improve school meal planning? An evaluation on real data.

Uses the Swedish school lunch series (see inspect_swedish_dataset.py): 15
primary school canteens, daily counts of pupils who ate, 2010 to February 2020.

Hypotheses, stated before the evaluation was run:
  H1  On ordinary days the forecast is about as accurate as a moving average
      (it should be: on those days it is a smoothed recent average).
  H2  On irregular days (around breaks, the first day of the school year,
      noted events) the forecast is clearly more accurate than the average.
  H3  Over a two-week planning window the forecast is more accurate than the average.
  H4  Both are far more accurate than preparing for every enrolled pupil.
  H5  For the same share of days that run short, planning with the forecast's
      day-type uncertainty wastes less food than the average plus a fixed buffer.

Two planning decisions are evaluated, because they need different inputs:
  day ahead   the evening before, when dry beans and maize are soaked: each
              school day is forecast from every earlier day
  two weeks   ordering food: every 10 school days, the next 10 are forecast
              from what is known at that point

Models
  cook_for_enrolled  prepare for every enrolled pupil (common practice)
  last_day           yesterday's count
  moving_average     mean of the last k school days (k chosen on validation)
  day_effect         recent level x day effects (models/school_day.py)
  gradient_boosting  scikit-learn gradient boosting on calendar and recent-level features
  prophet            per-canteen Prophet with day-type regressors (two-week window
                     only: without refitting it cannot use yesterday's count)

Periods: training before 2017, validation 2017 (window and half-life
selection), test 2018 to February 2020, scored once. Food buffers are
recalibrated, and models refitted, at the start of each test year on earlier data.

Outputs
  data/reports/swedish/forecast_evaluation.json
  data/reports/swedish/forecast_evaluation.md

Usage
  python forecasting/scripts/evaluate_swedish_forecasts.py [--skip-prophet]
"""

import argparse
import json
import sys
import time
from pathlib import Path

FORECASTING_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(FORECASTING_DIR))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
from sklearn.ensemble import HistGradientBoostingRegressor  # noqa: E402

from common import PROCESSED_DIR, md_table, sha256_of, write_json  # noqa: E402
from inspect_swedish_dataset import SWEDISH_DAILY, SWEDISH_REPORTS  # noqa: E402
from models.school_day import DAY_TYPES, DayEffectModel, participation  # noqa: E402

VALIDATION_START = pd.Timestamp("2017-01-01")
TEST_START = pd.Timestamp("2018-01-01")
TEST_YEARS = [2018, 2019, 2020]
WINDOW_DAYS = 10
MA_CANDIDATES = [5, 10, 20]
HALF_LIFE_CANDIDATES = [5, 10, 20, 40]
SHORTAGE_TARGETS = [0.02, 0.05, 0.10]
BOOTSTRAP_SAMPLES = 1000
SEED = 20261026

# Kenyan illustration of what the errors mean in food and money: the School
# Meals Programme ration and 2026 WFP median retail prices (config/kenya_inputs.yaml).
RATION_KG = {"cereals": 0.150, "pulses": 0.040, "vegetable_oil": 0.005, "salt": 0.002}
PRICE_KES_PER_KG = {"cereals": 59.95, "pulses": 120.37, "vegetable_oil": 285.34 / 0.92, "salt": 15.0 / 0.2}
KENYA_SCHOOL_DAYS_PER_YEAR = 170


def load():
    if not SWEDISH_DAILY.exists():
        sys.exit("ERROR: run forecasting/scripts/inspect_swedish_dataset.py first.")
    df = pd.read_csv(SWEDISH_DAILY, parse_dates=["date"])
    return df.sort_values(["canteen", "date"]).reset_index(drop=True), sha256_of(SWEDISH_DAILY)


def wape(forecast, actual):
    f, a = np.asarray(forecast, float), np.asarray(actual, float)
    return float(np.abs(f - a).sum() / a.sum())


# -- simple plans -------------------------------------------------------------

def moving_average(df, k):
    return df.groupby("canteen").students.transform(lambda s: s.shift(1).rolling(k, min_periods=1).mean())


def last_day(df):
    return df.groupby("canteen").students.shift(1)


# -- gradient boosting --------------------------------------------------------

def gbm_features(df, h_values):
    """
    One row per (origin day, target day h school days later) within a canteen.
    The recent level is the mean participation over the 20 days up to the
    origin; the target is the log ratio of the target day's participation to it.
    """
    rows = []
    for c, g in df.groupby("canteen"):
        g = g.reset_index()
        p = np.log(participation(g))
        level = p.rolling(20, min_periods=5).mean()
        last1 = p - level
        last5 = p.rolling(5, min_periods=1).mean() - level
        for h in h_values:
            tgt = g.shift(-h)
            frame = pd.DataFrame({
                "row": tgt["index"], "canteen": c, "h": h,
                "origin_date": g.date, "date": tgt.date,
                "level": level, "last1": last1, "last5": last5,
                "dow": tgt.date.dt.dayofweek, "month": tgt.date.dt.month,
                "day_in_run": tgt.day_in_run, "days_to_break": tgt.days_to_break,
                "break_before": tgt.break_before, "break_after": tgt.break_after,
                "event": tgt.has_event.astype(float),
                "size": np.log(g.enrolled.fillna(g.students)),
                "enrolled": tgt.enrolled.where(tgt.enrolled > 0).fillna(1.0),
                "y": np.log(participation(tgt)) - level,
            })
            rows.append(frame.dropna(subset=["date", "level"]))
    out = pd.concat(rows, ignore_index=True)
    out["row"] = out.row.astype(int)
    return out


GBM_COLUMNS = ["h", "last1", "last5", "dow", "month", "day_in_run", "days_to_break",
               "break_before", "break_after", "event", "size"]


def gbm_fit_predict(train, test):
    """Forecast number who eat: predicted participation x the target day's enrollment."""
    model = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.05, max_leaf_nodes=31,
                                          min_samples_leaf=50, l2_regularization=1.0, random_state=SEED)
    model.fit(train[GBM_COLUMNS], train.y)
    return np.exp(test.level + model.predict(test[GBM_COLUMNS])) * test.enrolled


# -- prophet ------------------------------------------------------------------

def prophet_window(df, origins):
    import logging
    logging.getLogger("cmdstanpy").setLevel(logging.ERROR)
    from prophet import Prophet

    regressors = [d for d in DAY_TYPES if d != "ordinary"]
    out = []
    for c, g in df.groupby("canteen"):
        g = g.reset_index()
        frame = pd.DataFrame({"ds": g.date, "y": participation(g)})
        for d in regressors:
            frame[d] = (g.day_type == d).astype(float)
        for i in origins[c]:
            train = frame.iloc[:i + 1]
            m = Prophet(weekly_seasonality=True, yearly_seasonality=True, daily_seasonality=False,
                        changepoint_prior_scale=0.05)
            for d in regressors:
                m.add_regressor(d)
            m.fit(train)
            fut = frame.iloc[i + 1:i + 1 + WINDOW_DAYS]
            pred = m.predict(fut.drop(columns="y"))
            enrolled = g.enrolled.iloc[i + 1:i + 1 + WINDOW_DAYS].fillna(1.0).values
            out.append(pd.DataFrame({"row": g["index"].iloc[i + 1:i + 1 + WINDOW_DAYS].values,
                                     "origin": i, "forecast": pred.yhat.values * enrolled}))
    return pd.concat(out)


# -- evaluation helpers -------------------------------------------------------

def by_day_type(frame, models):
    rows = []
    for t in ["all"] + DAY_TYPES:
        g = frame if t == "all" else frame[frame.day_type == t]
        if g.empty:
            continue
        row = {"day_type": t, "days": int(len(g))}
        for m in models:
            row[m] = round(wape(g[m], g.students), 4)
            row[m + "_bias"] = round(float(((g[m] - g.students) / g.students).mean()), 4)
        rows.append(row)
    return rows


def bootstrap_difference(frame, a, b):
    """Mean WAPE(a) - WAPE(b) with a 95% interval; blocks are canteen-weeks."""
    rng = np.random.default_rng(SEED)
    block = frame.canteen.astype(str) + "-" + frame.date.dt.strftime("%G-%V")
    err_a = (frame[a] - frame.students).abs().groupby(block).sum()
    err_b = (frame[b] - frame.students).abs().groupby(block).sum()
    actual = frame.students.groupby(block).sum()
    n = len(actual)
    diffs = []
    for _ in range(BOOTSTRAP_SAMPLES):
        idx = rng.integers(0, n, n)
        diffs.append((err_a.values[idx].sum() - err_b.values[idx].sum()) / actual.values[idx].sum())
    point = (err_a.sum() - err_b.sum()) / actual.sum()
    lo, hi = np.percentile(diffs, [2.5, 97.5])
    return {"difference": round(float(point), 4), "ci_low": round(float(lo), 4), "ci_high": round(float(hi), 4)}


# -- the planning decision (H5) -----------------------------------------------

def plan_outcome(prepared, students):
    prepared, students = np.asarray(prepared, float), np.asarray(students, float)
    short = prepared < students
    return {
        "shortage_day_rate": float(short.mean()),
        "meals_short_pct": float(np.clip(students - prepared, 0, None).sum() / students.sum()),
        "surplus_pct": float(np.clip(prepared - students, 0, None).sum() / students.sum()),
    }


def cost_per_meal_kes():
    return sum(RATION_KG[k] * PRICE_KES_PER_KG[k] for k in RATION_KG)


# -- main ---------------------------------------------------------------------

def main(skip_prophet):
    started = time.time()
    df, data_sha = load()
    df["ma_k"] = np.nan

    # Validation: choose the moving-average window and the level half-life
    val = df[(df.date >= VALIDATION_START) & (df.date < TEST_START)]
    selection = {"moving_average": {}, "day_effect": {}}
    for k in MA_CANDIDATES:
        selection["moving_average"][k] = wape(moving_average(df, k)[val.index], val.students)
    best_k = min(selection["moving_average"], key=selection["moving_average"].get)
    for hl in HALF_LIFE_CANDIDATES:
        m = DayEffectModel(half_life=hl).fit(df[df.date < VALIDATION_START])
        pred = m.predict_day_ahead(df[df.date < TEST_START])
        f = pred.forecast.reindex(val.index)
        selection["day_effect"][hl] = wape(f[f.notna()], val.students[f.notna()])
    best_hl = min(selection["day_effect"], key=selection["day_effect"].get)
    print(f"validation: moving average k={best_k}, half-life={best_hl}  ({time.time() - started:.0f}s)")

    df["cook_for_enrolled"] = df.enrolled.fillna(df.students)
    df["last_day"] = last_day(df)
    df["moving_average"] = moving_average(df, best_k)

    # Day ahead: fit at the start of validation and each test year on all earlier days
    df["day_effect"] = np.nan
    df["gradient_boosting"] = np.nan
    pairs_1 = gbm_features(df, [1])
    models_by_year = {}
    for year in [2017] + TEST_YEARS:
        start, end = pd.Timestamp(f"{year}-01-01"), pd.Timestamp(f"{year + 1}-01-01")
        m = DayEffectModel(half_life=best_hl).fit(df[df.date < start])
        models_by_year[year] = m
        pred = m.predict_day_ahead(df[df.date < end])
        in_year = df[(df.date >= start) & (df.date < end)].index
        df.loc[in_year, "day_effect"] = pred.forecast.reindex(in_year)
        train = pairs_1[pairs_1.date < start]
        test = pairs_1[(pairs_1.date >= start) & (pairs_1.date < end)]
        df.loc[test.row, "gradient_boosting"] = gbm_fit_predict(train, test).values
    print(f"day-ahead forecasts done ({time.time() - started:.0f}s)")

    day_models = ["cook_for_enrolled", "last_day", "moving_average", "day_effect", "gradient_boosting"]
    test_day = df[(df.date >= TEST_START)].dropna(subset=day_models)
    val_day = df[(df.date >= VALIDATION_START) & (df.date < TEST_START)].dropna(subset=day_models)

    # Two-week window: origins every 10 school days in each canteen's test period
    origins = {}
    for c, g in df.groupby("canteen"):
        g = g.reset_index()
        first = g.index[g.date >= TEST_START]
        origins[c] = list(range(first[0] - 1, len(g) - WINDOW_DAYS, WINDOW_DAYS)) if len(first) else []
    window_rows = []
    pairs_w = gbm_features(df, list(range(1, WINDOW_DAYS + 1)))
    for year in TEST_YEARS:
        start, end = pd.Timestamp(f"{year}-01-01"), pd.Timestamp(f"{year + 1}-01-01")
        m = models_by_year[year]
        lv = m.levels_after(df)
        for c, g in lv.groupby("canteen"):
            g = g.reset_index()
            for i in origins[c]:
                if not (start <= g.date.iloc[i + 1] < end):
                    continue
                fut = g.iloc[i + 1:i + 1 + WINDOW_DAYS]
                level = pd.Series(g.level_after.iloc[i], index=fut.index)
                f = m.expected_given_level(fut.set_index(fut.index), level)
                ma = g.students.iloc[max(0, i + 1 - best_k):i + 1].mean()
                window_rows.append(pd.DataFrame({
                    "row": fut["index"].values, "origin": i, "canteen": c, "h": np.arange(1, len(fut) + 1),
                    "date": fut.date.values, "students": fut.students.values, "day_type": fut.day_type.values,
                    "cook_for_enrolled": fut.enrolled.fillna(fut.students).values,
                    "last_day": g.students.iloc[i], "moving_average": ma, "day_effect": f.values}))
    window = pd.concat(window_rows, ignore_index=True)
    window["key"] = window.canteen.astype(str) + "-" + window.origin.astype(str) + "-" + window.h.astype(str)
    gbm_parts = []
    for year in TEST_YEARS:
        start, end = pd.Timestamp(f"{year}-01-01"), pd.Timestamp(f"{year + 1}-01-01")
        train = pairs_w[pairs_w.date < start]
        o_dates = pairs_w.origin_date
        test = pairs_w[(o_dates >= start - pd.Timedelta(days=1)) & (pairs_w.date >= start) & (pairs_w.date < end)].copy()
        test["forecast"] = gbm_fit_predict(train, test).values
        gbm_parts.append(test)
    gbm_w = pd.concat(gbm_parts)
    canteen_rows = {c: g.reset_index() for c, g in df.groupby("canteen")}
    # Match gradient-boosting rows to window rows by canteen, origin index and h
    origin_index = {}
    for c, g in canteen_rows.items():
        origin_index.update({(c, d): i for i, d in enumerate(g.date)})
    gbm_w["origin"] = [origin_index.get((c, d)) for c, d in zip(gbm_w.canteen, gbm_w.origin_date)]
    gbm_w["key"] = gbm_w.canteen.astype(str) + "-" + gbm_w.origin.astype(str) + "-" + gbm_w.h.astype(str)
    window = window.merge(gbm_w[["key", "forecast"]].rename(columns={"forecast": "gradient_boosting"}),
                          on="key", how="left")
    window_models = ["cook_for_enrolled", "last_day", "moving_average", "day_effect", "gradient_boosting"]
    if not skip_prophet:
        cache = PROCESSED_DIR / f"swedish_prophet_window_{data_sha[:12]}.csv"
        if cache.exists():
            pw = pd.read_csv(cache)
        else:
            print(f"prophet: {sum(len(v) for v in origins.values())} fits ...")
            pw = prophet_window(df, origins)
            SWEDISH_REPORTS.mkdir(parents=True, exist_ok=True)
            pw.to_csv(cache, index=False)
        pw["canteen"] = df.loc[pw.row, "canteen"].values
        pw["key"] = pw.canteen.astype(str) + "-" + pw.origin.astype(str) + "-" + \
            pw.groupby(["canteen", "origin"]).cumcount().add(1).astype(str)
        window = window.merge(pw[["key", "forecast"]].rename(columns={"forecast": "prophet"}), on="key", how="left")
        window_models.append("prophet")
    window = window.dropna(subset=window_models)
    print(f"two-week forecasts done ({time.time() - started:.0f}s)")

    # Planning decision (H5), day ahead, as the system would run it: at the start of
    # each test year both plans are recalibrated on the most recent school days
    # (the day-effect model's own calibration window).
    m17 = models_by_year[2017]
    recent = {}
    for year in TEST_YEARS:
        m = models_by_year[year]
        start = pd.Timestamp(f"{year}-01-01")
        window_start = df[df.date < start].date.drop_duplicates().sort_values().iloc[-m.calibration_days]
        recent[year] = df[(df.date >= window_start) & (df.date < start)].dropna(subset=["moving_average"])
    test_day = test_day.assign(year=test_day.date.dt.year)

    def plan(name, level):
        """Food prepared under a plan at a buffer level, for every test day."""
        prepared = pd.Series(np.nan, index=test_day.index)
        for year in TEST_YEARS:
            rows = test_day.year == year
            if not rows.any():
                continue
            if name == "moving_average_fixed_buffer":
                # one buffer for every day: the level-quantile of recent actual / average
                r = recent[year]
                b = np.quantile(r.students / r.moving_average, level)
                prepared[rows] = test_day.moving_average[rows] * b
            else:
                # each kind of day at the level-quantile of its own recent errors
                errors = models_by_year[year].calibration_errors_
                f = test_day.day_type[rows].map(lambda d: np.exp(np.quantile(errors[d], level)))
                prepared[rows] = test_day.day_effect[rows] * f.values
        return prepared

    decision = []
    for target in SHORTAGE_TARGETS:
        plans = {"cook_for_enrolled": test_day.cook_for_enrolled,
                 "moving_average_fixed_buffer": plan("moving_average_fixed_buffer", 1 - target),
                 "day_effect_type_buffer": plan("day_effect_type_buffer", 1 - target)}
        for name, prepared in plans.items():
            overall = plan_outcome(prepared, test_day.students)
            per_type = {d: plan_outcome(prepared[test_day.day_type == d], test_day.students[test_day.day_type == d])
                        for d in DAY_TYPES if (test_day.day_type == d).any()}
            decision.append({"target_shortage_rate": target, "plan": name,
                             **{k: round(v, 4) for k, v in overall.items()},
                             "by_day_type": {d: {k: round(v, 4) for k, v in o.items()} for d, o in per_type.items()}})

    # The same comparison at equal realised risk: trace each plan's trade-off
    # between days short and food left over, and read off the food left over at
    # the same share of days short.
    levels = np.linspace(0.5, 0.995, 100)
    frontier = {}
    for name in ["moving_average_fixed_buffer", "day_effect_type_buffer"]:
        points = [plan_outcome(plan(name, q), test_day.students) for q in levels]
        short = np.array([p["shortage_day_rate"] for p in points])
        surplus = np.array([p["surplus_pct"] for p in points])
        order = np.argsort(short)
        frontier[name] = {str(t): round(float(np.interp(t, short[order], surplus[order])), 4) for t in SHORTAGE_TARGETS}

    results = {
        "dataset_sha256": data_sha,
        "selection": {"moving_average_window": best_k, "day_effect_half_life": best_hl,
                      "validation_wape": {k: {str(kk): round(vv, 4) for kk, vv in v.items()} for k, v in selection.items()}},
        "day_ahead": {"by_day_type": by_day_type(test_day, day_models),
                      "bootstrap_vs_moving_average": {m: bootstrap_difference(test_day, m, "moving_average")
                                                      for m in ["day_effect", "gradient_boosting"]}},
        "two_week": {"by_day_type": by_day_type(window, window_models),
                     "bootstrap_vs_moving_average": {m: bootstrap_difference(window, m, "moving_average")
                                                     for m in window_models if m not in ("moving_average", "cook_for_enrolled")},
                     "origins": int(window.groupby(["canteen", "origin"]).ngroups)},
        "decision": decision,
        "decision_equal_risk": frontier,
        "kenya_illustration": {"cost_per_meal_kes": round(cost_per_meal_kes(), 2),
                               "ration_kg_per_meal": round(sum(RATION_KG.values()), 3),
                               "school_days_per_year": KENYA_SCHOOL_DAYS_PER_YEAR},
        "example_parameters": m17.parameters(int(df.canteen.iloc[0])),
        "runtime_seconds": round(time.time() - started),
    }
    SWEDISH_REPORTS.mkdir(parents=True, exist_ok=True)
    write_json(SWEDISH_REPORTS / "forecast_evaluation.json", results)
    write_report(results, day_models, window_models)
    print(f"Wrote {SWEDISH_REPORTS / 'forecast_evaluation.md'} ({time.time() - started:.0f}s)")


LABELS = {"cook_for_enrolled": "Cook for enrolled", "last_day": "Yesterday's count",
          "moving_average": "Moving average", "day_effect": "Level × day effects",
          "gradient_boosting": "Gradient boosting", "prophet": "Prophet"}


def pct(v, signed=False):
    return "–" if v is None else (f"{v * 100:+.1f}%" if signed else f"{v * 100:.1f}%")


def accuracy_table(rows, models):
    return md_table([[r["day_type"], r["days"]] + [pct(r[m]) for m in models] for r in rows],
                    ["Day type", "Days"] + [LABELS[m] for m in models])


def write_report(r, day_models, window_models):
    sel = r["selection"]
    ki = r["kenya_illustration"]
    lines = [
        "# Does forecasting improve school meal planning? Evaluation on real school data",
        "",
        "Data: 15 Swedish primary school canteens, daily counts of pupils who ate lunch, school days from 2010 to "
        "February 2020 ([inspection](inspection.md)). Training before 2017, validation 2017, test 2018 – February 2020. "
        "Errors are WAPE (total absolute error / total eaten).",
        "",
        f"Validation chose a moving-average window of {sel['moving_average_window']} school days and a level half-life of "
        f"{sel['day_effect_half_life']} school days.",
        "",
        "## Day ahead (the evening before, when beans and maize are soaked)",
        "",
        accuracy_table(r["day_ahead"]["by_day_type"], day_models),
        "",
        "Difference in WAPE against the moving average (negative = more accurate), 95% block-bootstrap interval over canteen-weeks:",
        "",
        md_table([[LABELS[m], pct(v["difference"], True), f"{pct(v['ci_low'], True)} to {pct(v['ci_high'], True)}"]
                  for m, v in r["day_ahead"]["bootstrap_vs_moving_average"].items()],
                 ["Model", "Difference", "95% interval"]),
        "",
        f"## Two-week window (ordering food; {r['two_week']['origins']} forecast origins)",
        "",
        accuracy_table(r["two_week"]["by_day_type"], window_models),
        "",
        md_table([[LABELS[m], pct(v["difference"], True), f"{pct(v['ci_low'], True)} to {pct(v['ci_high'], True)}"]
                  for m, v in r["two_week"]["bootstrap_vs_moving_average"].items()],
                 ["Model", "Difference vs moving average", "95% interval"]),
        "",
        "## The planning decision: food prepared for the same risk of running short",
        "",
        "At the start of each test year both plans are recalibrated on the most recent 180 school days, as the system "
        "would do. The moving average gets one buffer for every day; the level × day effects plan prepares for each kind "
        "of day at the same quantile of that day type's own recent errors.",
        "",
    ]
    for target in SHORTAGE_TARGETS:
        rows = [d for d in r["decision"] if d["target_shortage_rate"] == target]
        lines += [f"**Planned risk: short on {target * 100:.0f}% of days**", "",
                  md_table([[d["plan"].replace("_", " "), pct(d["shortage_day_rate"]), pct(d["meals_short_pct"]),
                             pct(d["surplus_pct"])] for d in rows],
                           ["Plan", "Days short (test)", "Meals short", "Food prepared but not eaten"]), ""]
    eq = r["decision_equal_risk"]
    lines += ["**At equal realised risk** (each plan's trade-off curve on test, read at the same share of days short)", "",
              md_table([[f"{float(t) * 100:.0f}%", pct(eq["moving_average_fixed_buffer"][t]),
                         pct(eq["day_effect_type_buffer"][t])] for t in eq["moving_average_fixed_buffer"]],
                       ["Days short", "Left over: moving average + fixed buffer", "Left over: level × day effects"]), ""]
    d5 = [d for d in r["decision"] if d["target_shortage_rate"] == 0.05]
    lines += ["**Days short by day type, at the 5% planned risk**", "",
              md_table([[t] + [pct(d["by_day_type"].get(t, {}).get("shortage_day_rate")) for d in d5] for t in DAY_TYPES],
                       ["Day type"] + [d["plan"].replace("_", " ") for d in d5]), ""]
    lines += [
        "## What it means for a Kenyan school (illustration)",
        "",
        f"At the School Meals Programme ration ({ki['ration_kg_per_meal'] * 1000:.0f} g of dry food per meal) and 2026 WFP "
        f"median retail prices, one meal costs about Ksh {ki['cost_per_meal_kes']:.2f} in commodities. Every 1% of surplus "
        f"for 500 learners over {ki['school_days_per_year']} school days is about "
        f"{0.01 * 500 * ki['school_days_per_year'] * ki['ration_kg_per_meal']:.0f} kg of food and Ksh "
        f"{0.01 * 500 * ki['school_days_per_year'] * ki['cost_per_meal_kes']:,.0f}. This applies Swedish error rates to a "
        "Kenyan ration and price; it shows scale, not a measured Kenyan saving.",
        "",
    ]
    (SWEDISH_REPORTS / "forecast_evaluation.md").write_text("\n".join(lines), encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-prophet", action="store_true")
    main(parser.parse_args().skip_prophet)
