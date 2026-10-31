"""
Generate synthetic school feeding records for several schools, with labelled anomalies.

What each simulated school records is what the system stores: termly enrolment, a
daily feeding record (learners fed, kilograms of cereals and pulses issued, a reason
when there was no feeding), deliveries or purchases, monthly store counts, and when each
record was captured, when it reached the server and in which sync batch.

Grounding:
  - Term dates, half-terms and public holidays: the Ministry of Education calendars in
    config/kenya_inputs.yaml.
  - Ration: the School Meals Programme ration (150 g cereals, 40 g pulses, 5 g oil, 2 g
    salt per learner per day).
  - Day-to-day variation in learners fed: the effects of the first and last days of
    terms and the size of the day-to-day noise, from the real Swedish school lunch
    series (scripts/evaluate_swedish_forecasts.py).
  - Everything else is an assumption, listed in config/feeding_dataset.yaml.

Anomalies are injected as episodes on one school, labelled per school-day:
  inflated_headcount    more learners recorded as fed than were fed; the food issued
                        follows the recorded number, so the store empties faster
  consumption_drift     food issued per learner creeps up over the episode
  stock_leakage         food leaves the store with no record; only store counts show it
  backdated_bulk_entry  the days of the episode are entered together, long after,
                        with figures from memory (steady, ration-exact)
  round_number_entry    figures made up rather than counted (round numbers)
The tuning period gets only the tuning types; the test period gets every type.

Outputs (data/processed/feeding_dataset/)
  schools.csv, enrolment.csv, feeding.csv, stock_movements.csv, stock_counts.csv,
  labels.csv, school_days.csv, metadata.json

Usage
  python forecasting/scripts/generate_feeding_dataset.py
"""

import datetime as dt
import sys
from pathlib import Path

FORECASTING_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(FORECASTING_DIR))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import yaml  # noqa: E402

from common import PROCESSED_DIR, write_json  # noqa: E402

CONFIG = FORECASTING_DIR / "config" / "feeding_dataset.yaml"
PROTOCOL = FORECASTING_DIR / "config" / "anomaly_evaluation.yaml"
OUT_DIR = PROCESSED_DIR / "feeding_dataset"
RATION_KG = {"cereals": 0.150, "pulses": 0.040, "oil": 0.005, "salt": 0.002}
COMMODITIES = list(RATION_KG)


def load_yaml(path):
    with open(path, encoding="utf-8") as f:
        return yaml.safe_load(f)


# -- calendar -------------------------------------------------------------------

def school_calendar(inputs, years, end_date):
    """School days with their term and day type, from the Ministry calendar."""
    holidays = set()
    for year in years:
        for h in inputs["public_holidays"]["fixed"]:
            d = dt.date(year, h["month"], h["day"])
            holidays.add(d + dt.timedelta(days=1) if d.weekday() == 6 else d)
        holidays |= {h["date"] for h in inputs["public_holidays"]["movable"].get(year, [])}
    rows = []
    for year in years:
        cal = inputs["school_calendar"][year]
        halves = {h["term"]: h for h in cal.get("half_terms", [])}
        for t in cal["terms"]:
            days = []
            d = t["open"]
            while d <= min(t["close"], end_date):
                h = halves.get(t["term"])
                if d.weekday() < 5 and d not in holidays and not (h and h["start"] <= d <= h["end"]):
                    days.append(d)
                d += dt.timedelta(days=1)
            for i, d in enumerate(days):
                after_break = i == 0 or (d - days[i - 1]).days > 3
                before_break = i == len(days) - 1 or (days[i + 1] - d).days > 3
                if i == 0 and t["term"] == 1:
                    day_type = "first day of school year"
                elif i == len(days) - 1 and t["term"] == 3:
                    day_type = "last day of school year"
                elif after_break:
                    day_type = "first days after a break"
                elif before_break:
                    day_type = "last days before a break"
                else:
                    day_type = "ordinary"
                rows.append({"date": d, "year": year, "term": t["term"], "term_id": f"{year}-T{t['term']}",
                             "term_day": i, "term_days": len(days), "day_type": day_type})
    return pd.DataFrame(rows)


# -- schools --------------------------------------------------------------------

def make_schools(cfg, rng):
    rows = []
    for sc in cfg["sub_counties"]:
        for i in range(cfg["schools_per_sub_county"]):
            s = cfg["school"]
            rows.append({
                "school_id": f"S{len(rows) + 1:02d}",
                "name": f"{sc} school {i + 1}",
                "sub_county": sc,
                "programme_type": "cash_transfer" if rng.random() < s["cash_transfer_share"] else "in_kind",
                "base_enrolment": int(rng.integers(s["enrolment"]["min"], s["enrolment"]["max"])),
                "participation": float(rng.uniform(s["participation"]["min"], s["participation"]["max"])),
                "sync_every": int(rng.integers(cfg["entry"]["sync_every_school_days"]["min"],
                                               cfg["entry"]["sync_every_school_days"]["max"] + 1)),
            })
    return pd.DataFrame(rows)


# -- anomaly episodes -----------------------------------------------------------

def plan_episodes(cfg, protocol, schools, calendar, rng):
    """Episodes per year on random schools; never two on one school at the same time."""
    tuning = protocol["anomaly_types"]["tuning"]
    every = tuning + protocol["anomaly_types"]["held_out"]
    test_start = pd.Timestamp(protocol["data"]["test_period"]["start"]).date()
    a = cfg["anomalies"]
    episodes = []
    busy = {s: [] for s in schools.school_id}
    for year in cfg["years"]:
        days = calendar[calendar.year == year].date.tolist()
        types = every if dt.date(year, 1, 1) >= test_start else tuning
        # The test year gets enough episodes of each type to measure recall per type
        count = a["episodes_per_year"] if types is tuning else max(a["episodes_per_year"], 3 * len(types))
        for k in range(count):
            kind = types[k % len(types)]
            for _ in range(50):
                school = rng.choice(schools.school_id)
                length = int(rng.integers(a["length_school_days"]["min"], a["length_school_days"]["max"] + 1))
                start = int(rng.integers(5, len(days) - length - 5))
                span = (days[start], days[start + length - 1])
                if all(span[1] < b[0] or span[0] > b[1] for b in busy[school]):
                    busy[school].append(span)
                    episodes.append({"school_id": school, "type": kind, "start": span[0], "end": span[1],
                                     "strength": float(rng.random())})
                    break
    return pd.DataFrame(episodes)


def episode_for(episodes, school, day):
    hit = episodes[(episodes.school_id == school) & (episodes.start <= day) & (episodes.end >= day)]
    return hit.iloc[0] if len(hit) else None


# -- simulation -----------------------------------------------------------------

def simulate_school(s, calendar, episodes, cfg, rng):
    a = cfg["anomalies"]
    stock_cfg = cfg["stock"]
    feeding, movements, counts, enrolment = [], [], [], []
    actual = {c: 0.0 for c in COMMODITIES}     # what is really in the store
    ledger = {c: 0.0 for c in COMMODITIES}     # what the records say
    noise = 0.0
    batch_no = 0
    pending = []                               # records captured but not yet synced
    days_since_sync = 0
    enrolled = s.base_enrolment

    def bank(kg, step):
        return float(np.round(kg / step) * step)

    def add_movement(day, commodity, kind, kg, note_kg=None, reference=None):
        actual[commodity] += kg if kind in ("delivery", "purchase") else -kg
        ledger[commodity] += kg if kind in ("delivery", "purchase") else -kg
        movements.append({"school_id": s.school_id, "date": day, "commodity": commodity, "kind": kind,
                          "quantity_kg": round(kg, 2), "note_quantity_kg": note_kg, "reference": reference})

    for term_id, term_days in calendar.groupby("term_id", sort=False):
        days = term_days.reset_index(drop=True)
        enrolled = max(120, int(round(enrolled * np.exp(rng.normal(0, cfg["school"]["enrolment_change_per_term"])))))
        enrolment.append({"school_id": s.school_id, "term_id": term_id, "learners": enrolled})
        delivery_day = int(rng.integers(stock_cfg["in_kind_delivery_week"]["min"] * 5 - 5,
                                        stock_cfg["in_kind_delivery_week"]["max"] * 5))
        share = rng.uniform(stock_cfg["in_kind_share_of_need"]["min"], stock_cfg["in_kind_share_of_need"]["max"])

        for i, row in days.iterrows():
            day = row.date
            ep = episode_for(episodes, s.school_id, day)
            kind = ep["type"] if ep is not None else None
            progress = 0.0 if ep is None else ((day - ep["start"]).days + 1) / ((ep["end"] - ep["start"]).days + 1)

            # Food arriving
            if s.programme_type == "in_kind" and i == min(delivery_day, len(days) - 1):
                for c in COMMODITIES:
                    need = enrolled * s.participation * len(days) * RATION_KG[c] * share
                    received = bank(need, 50 if c in ("cereals", "pulses") else 5)
                    note = None
                    if rng.random() < stock_cfg["short_delivery_probability"]:
                        note, received = received, bank(received * rng.uniform(0.85, 0.97), 5)
                    if received > 0:
                        add_movement(day, c, "delivery", received, note, f"DN-{term_id}-{s.school_id}")
            if s.programme_type == "cash_transfer" and i % stock_cfg["purchase_every_school_days"] == 0:
                for c in COMMODITIES:
                    days_ahead = min(stock_cfg["purchase_every_school_days"], len(days) - i)
                    need = enrolled * s.participation * days_ahead * RATION_KG[c] * rng.uniform(0.9, 1.1)
                    buy = max(0.0, bank(need - actual[c], 10 if c in ("cereals", "pulses") else 1))
                    if buy > 0:
                        add_movement(day, c, "purchase", buy, None, f"RCPT-{term_id}-{s.school_id}-{i}")

            # Learners fed
            noise = cfg["noise"]["ar1"] * noise + rng.normal(0, cfg["noise"]["log_sd"])
            effect = cfg["day_effects"].get(row.day_type, 1.0)
            true_fed = int(min(enrolled, round(enrolled * s.participation * effect * np.exp(noise))))
            closed = rng.random() < 0.008
            need_cereal = true_fed * RATION_KG["cereals"]
            fed_happened = not closed and actual["cereals"] >= need_cereal * 0.5
            reason = None if fed_happened else ("school_closed" if closed else "no_food")

            recorded_fed = true_fed if fed_happened else 0
            if fed_happened and kind == "inflated_headcount":
                infl = a["inflated_headcount"]["inflation"]
                recorded_fed = int(min(enrolled * 0.99, round(true_fed * (1 + infl["min"] + ep["strength"] * (infl["max"] - infl["min"])))))
            if fed_happened and kind == "round_number_entry":
                step = a["round_number_entry"]["round_to"][int(ep["strength"] > 0.5)]
                recorded_fed = int(min(enrolled, round(true_fed / step) * step))

            issued = {"cereals": 0.0, "pulses": 0.0}
            if fed_happened:
                for c in issued:
                    kg = recorded_fed * RATION_KG[c] * np.exp(rng.normal(0, cfg["issuing"]["log_sd"]))
                    if kind == "consumption_drift":
                        fx = a["consumption_drift"]["final_excess"]
                        kg *= 1 + progress * (fx["min"] + ep["strength"] * (fx["max"] - fx["min"]))
                    if kind in ("backdated_bulk_entry", "round_number_entry"):
                        kg = recorded_fed * RATION_KG[c]           # written from the ration, not weighed
                    issued[c] = min(actual[c], bank(kg, cfg["issuing"]["rounding_kg"]))
            if fed_happened and kind == "backdated_bulk_entry":
                # Figures from memory: the usual number, rounded, every day
                recorded_fed = int(round(enrolled * s.participation / 10) * 10)
                issued = {c: min(actual[c], bank(recorded_fed * RATION_KG[c], 0.5)) for c in issued}

            for c in issued:
                actual[c] -= issued[c]
                ledger[c] -= issued[c]
            for c in ("oil", "salt"):
                use = recorded_fed * RATION_KG[c]
                actual[c] -= min(actual[c], use)
                ledger[c] -= use
            if kind == "stock_leakage" and fed_happened:
                lk = a["stock_leakage"]["share_of_daily_use"]
                for c in ("cereals", "pulses"):
                    actual[c] -= min(actual[c], true_fed * RATION_KG[c] * (lk["min"] + ep["strength"] * (lk["max"] - lk["min"])))

            # Monthly store count of what is really there
            if i > 0 and i % stock_cfg["count_every_school_days"] == 0:
                for c in ("cereals", "pulses"):
                    err = rng.normal(0, stock_cfg["count_error_kg_share"] * max(actual[c], 1))
                    counts.append({"school_id": s.school_id, "date": day, "commodity": c,
                                   "counted_kg": bank(max(0.0, actual[c] + err), 0.5), "ledger_kg": round(ledger[c], 2)})

            # When the record was captured and when it reached the server
            if kind == "backdated_bulk_entry":
                # The whole episode is entered in one sitting, some school days after it ended
                lag = a["backdated_bulk_entry"]["delay_school_days"]
                delay = int(round(lag["min"] + ep["strength"] * (lag["max"] - lag["min"])))
                capture_index = min(len(calendar) - 1, int(calendar.index[calendar.date == ep["end"]][0]) + delay)
            else:
                delay = 0 if rng.random() < cfg["entry"]["same_day_probability"] else int(rng.integers(1, 4))
                capture_index = min(len(calendar) - 1, int(calendar.index[calendar.date == day][0]) + delay)
            feeding.append({
                "school_id": s.school_id, "date": day, "feeding_happened": fed_happened,
                "learners_fed": recorded_fed, "cereals_kg": issued["cereals"], "pulses_kg": issued["pulses"],
                "reason_code": reason, "capture_index": capture_index,
                "version": 1 + int(rng.random() < cfg["entry"]["edit_probability"]),
                "label": kind or "",
            })
    return feeding, movements, counts, enrolment


def assign_sync_batches(feeding, calendar, schools):
    """A school's device syncs every few school days: each record goes up in the first
    sync on or after the day it was captured, together with the others waiting."""
    every = dict(zip(schools.school_id, schools.sync_every))
    dates = calendar.date.tolist()
    received, batch = [], []
    for s, idx in zip(feeding.school_id, feeding.capture_index):
        sync_index = min(len(dates) - 1, ((idx // every[s]) + 1) * every[s] - 1)
        received.append(dates[max(idx, sync_index)])
        batch.append(f"{s}-B{sync_index}")
    feeding["captured_date"] = [dates[i] for i in feeding.capture_index]
    feeding["received_date"] = received
    feeding["sync_batch_id"] = batch
    return feeding.drop(columns="capture_index")


def main():
    cfg = load_yaml(CONFIG)
    protocol = load_yaml(PROTOCOL)
    inputs = load_yaml(FORECASTING_DIR.parent / cfg["calendar"])
    rng = np.random.default_rng(cfg["seed"])
    calendar = school_calendar(inputs, cfg["years"], pd.Timestamp(cfg["end_date"]).date())
    schools = make_schools(cfg, rng)
    episodes = plan_episodes(cfg, protocol, schools, calendar, rng)

    feeding, movements, counts, enrolment = [], [], [], []
    for s in schools.itertuples():
        f, m, c, e = simulate_school(s, calendar, episodes, cfg, rng)
        feeding += f
        movements += m
        counts += c
        enrolment += e
    feeding = assign_sync_batches(pd.DataFrame(feeding), calendar, schools)
    labels = feeding[feeding.label != ""][["school_id", "date", "label"]]
    # A leak is only visible when the store is counted: the first count after a leak
    # episode is the day it can be found, so it needs review too
    counts_df = pd.DataFrame(counts)
    revealed = []
    for ep in episodes[episodes.type == "stock_leakage"].itertuples():
        later = counts_df[(counts_df.school_id == ep.school_id) & (counts_df.date > ep.end)].date
        if len(later):
            revealed.append({"school_id": ep.school_id, "date": later.min(), "label": "stock_leakage"})
    labels = pd.concat([labels, pd.DataFrame(revealed)]).drop_duplicates(["school_id", "date"])

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    schools.to_csv(OUT_DIR / "schools.csv", index=False)
    pd.DataFrame(enrolment).to_csv(OUT_DIR / "enrolment.csv", index=False)
    feeding.drop(columns="label").to_csv(OUT_DIR / "feeding.csv", index=False)
    pd.DataFrame(movements).to_csv(OUT_DIR / "stock_movements.csv", index=False)
    pd.DataFrame(counts).to_csv(OUT_DIR / "stock_counts.csv", index=False)
    labels.to_csv(OUT_DIR / "labels.csv", index=False)
    episodes.to_csv(OUT_DIR / "episodes.csv", index=False)
    calendar.to_csv(OUT_DIR / "school_days.csv", index=False)
    write_json(OUT_DIR / "metadata.json", {
        "schools": len(schools), "school_days": len(calendar), "feeding_records": len(feeding),
        "labelled_school_days": labels.groupby("label").size().to_dict(),
        "episodes": episodes.groupby("type").size().to_dict(),
        "not_fed_days": int((~feeding.feeding_happened).sum()),
        "source_type": "synthetic",
    })
    print(f"{len(schools)} schools, {len(feeding)} school-days, {len(labels)} labelled; wrote {OUT_DIR}")
    print(labels.groupby("label").size().to_string())


if __name__ == "__main__":
    main()
