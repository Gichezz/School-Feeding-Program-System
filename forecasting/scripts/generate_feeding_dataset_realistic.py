"""
The realistic generator (protocol version 12): the standard generator
(scripts/generate_feeding_dataset.py, unchanged) with honest behaviour that real Kenyan
school records show and the standard generator leaves out, and with each problem carried
out in more varied ways. Every value is a stated assumption in
config/feeding_dataset_realistic.yaml; none was fitted to a detector.

Why: on the standard generator an honest school always weighs food, never estimates its
register, never enters a week late, never changes enrolment by much and counts its store
almost exactly, so several problems are separable by one feature. A detector that learnt
those shortcuts would look better than it is. This generator keeps the six problem types
and their labels and adds:

Honest behaviour (no label)
  C1 recording habits per school: register estimated to the nearest 5 or 10; food issued
     computed from the ration; the week's records entered together on the Friday
  C2 honest catch-up: a run of days entered in one sitting days after (broken device,
     teacher away)
  C3 food measured with tins: more issuing noise
  C4 genuine enrolment changes of 8-25% in a term
  C5 attendance shocks shared by a sub-county; participation moving between terms
  C6 store counts less precise, and some written down wrongly
  R1 the delivery note's figure written in the ledger instead of the weighed amount, so a
     short delivery shows later as a store shortfall
  R2 the mobile network down across a sub-county, so no device there syncs
  R3 records never entered (food eaten, no record, the ledger keeps it) and learners
     present left blank
  R4 store counts at a chosen interval, with some counts not done; count errors from their
     own random stream

Problems (labelled)
  A1-A6 the six standard types, with milder and more varied mechanisms (inflated headcount
     on 70% of the episode's days, backdated figures from memory that vary, food written
     from the ration in half the backdated episodes, round numbers to 5, 10 or 50)
  A7 one_day_claim: a single padded day with food issued to match

Usage
  python forecasting/scripts/generate_feeding_dataset_realistic.py --out DIR --seeds 8101-8130 [--count-every 20]
"""

import argparse
import copy
import sys
import zlib
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

FORECASTING_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(FORECASTING_DIR))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import yaml  # noqa: E402

import generate_feeding_dataset as g  # noqa: E402
from generate_feeding_dataset import COMMODITIES, RATION_KG, episode_for  # noqa: E402

REALISTIC = FORECASTING_DIR / "config" / "feeding_dataset_realistic.yaml"
VERSION = 1


def deep_merge(a, b):
    out = copy.deepcopy(a)
    for k, v in b.items():
        out[k] = deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


def load_config(seed, count_every=None):
    spec = g.load_yaml(REALISTIC)
    cfg = deep_merge(g.load_yaml(FORECASTING_DIR.parent / spec["base"]), spec["overrides"])
    cfg["realism"] = spec["realism"]
    cfg["seed"] = seed
    if count_every:
        cfg["stock"]["count_every_school_days"] = int(count_every)
    return cfg


def _stream(cfg, tag, school_id=""):
    """A random stream of its own, so one behaviour can change without moving the others."""
    return np.random.default_rng([cfg["seed"], tag, zlib.crc32(school_id.encode())])


_base_make_schools = g.make_schools
_base_plan_outages = g.plan_outages


def make_schools(cfg, rng):
    s = _base_make_schools(cfg, rng)
    r = cfg["realism"]
    h = _stream(cfg, 101)
    est = r["estimates_register"]
    s["estimates_to"] = [int(h.choice(est["round_to"])) if h.random() < est["share"] else 0 for _ in range(len(s))]
    s["computes_issues"] = h.random(len(s)) < r["computes_issues_share"]
    s["weekly_enterer"] = h.random(len(s)) < r["weekly_entry"]["share"]
    s["records_note"] = h.random(len(s)) < r["records_delivery_note_share"]
    lo, hi = r["missing_records_share"]
    s["missing_share"] = h.uniform(lo, hi, len(s))
    return s


def plan_outages(cfg, calendar, schools):
    """The standard per-school outages, and the network down across a sub-county (R2)."""
    out = _base_plan_outages(cfg, calendar, schools)
    spec = cfg["realism"]["network_outage"]
    rng = np.random.default_rng(cfg["seed"] + spec["seed_offset"])
    for sc, group in schools.groupby("sub_county", sort=True):
        for _, term in calendar.groupby("term_id", sort=False):
            if rng.random() >= spec["per_term_probability"]:
                continue
            length = int(rng.integers(spec["length_school_days"][0], spec["length_school_days"][1] + 1))
            first, last = int(term.index.min()), int(term.index.max())
            start = int(rng.integers(first, max(first + 1, last - length + 2)))
            for school in group.school_id:
                out.append({"school_id": school, "start_index": start, "end_index": min(last, start + length - 1)})
    return out


_SHOCKS = {}
ONE_DAY = []


def shocks(cfg, sub_county, calendar):
    """C5: per sub-county and term, runs of days when fewer learners come (shared)."""
    key = (cfg["seed"], sub_county)
    if key not in _SHOCKS:
        spec = cfg["realism"]["attendance_shocks"]
        r = _stream(cfg, 202, sub_county)
        effect = {}
        for _, t in calendar.groupby("term_id", sort=False):
            days = t.date.tolist()
            for _ in range(spec["per_term"]):
                n = int(r.integers(spec["run_school_days"][0], spec["run_school_days"][1] + 1))
                st = int(r.integers(0, max(1, len(days) - n)))
                factor = 1 - r.uniform(*spec["drop"])
                for d in days[st:st + n]:
                    effect[d] = factor
        _SHOCKS[key] = effect
    return _SHOCKS[key]


def simulate_school(s, calendar, episodes, cfg, rng):
    a = cfg["anomalies"]
    r = cfg["realism"]
    stock_cfg = cfg["stock"]
    feeding, movements, counts, enrolment = [], [], [], []
    actual = {c: 0.0 for c in COMMODITIES}
    ledger = {c: 0.0 for c in COMMODITIES}
    noise = 0.0
    enrolled = s.base_enrolment
    participation = s.participation
    loss_probability = cfg["losses"]["per_school_year"] / 170
    hours = cfg["entry"]["school_hours"]
    shock = shocks(cfg, s.sub_county, calendar)
    cal_index = {d: i for i, d in enumerate(calendar.date)}
    claim_rng = _stream(cfg, 7919, s.school_id)
    count_rng = _stream(cfg, 4049, s.school_id)
    miss_rng = _stream(cfg, 5051, s.school_id)
    claim_p = r["one_day_claim"]["per_school_year"] / 170

    def bank(kg, step):
        return float(np.round(kg / step) * step)

    def add_movement(day, commodity, kind, kg, note_kg=None, reference=None):
        sign = 1 if kind in ("delivery", "purchase") else -1
        actual[commodity] += sign * kg
        # R1: a school that copies the delivery note writes the note's figure, not the weight
        written = note_kg if (kind == "delivery" and note_kg is not None and s.records_note) else kg
        ledger[commodity] += sign * written
        movements.append({"school_id": s.school_id, "date": day, "commodity": commodity, "kind": kind,
                          "quantity_kg": round(written, 2), "note_quantity_kg": note_kg, "reference": reference})

    for term_id, term_days in calendar.groupby("term_id", sort=False):
        days = term_days.reset_index(drop=True)
        enrolled = max(120, int(round(enrolled * np.exp(rng.normal(0, cfg["school"]["enrolment_change_per_term"])))))
        if rng.random() < r["enrolment_shift"]["per_term_probability"]:                      # C4
            enrolled = max(120, int(round(enrolled * (1 + rng.choice([-1, 1]) * rng.uniform(*r["enrolment_shift"]["size"])))))
        participation = float(np.clip(participation + rng.normal(0, r["participation_drift_sd"]), 0.75, 0.98))   # C5
        catch = None                                                                          # C2
        cu = r["catch_up"]
        if rng.random() < cu["per_term_probability"] and len(days) > 20:
            n = int(rng.integers(cu["run_school_days"][0], cu["run_school_days"][1] + 1))
            st = int(rng.integers(0, len(days) - n))
            catch = (st, st + n - 1, int(rng.integers(cu["delay_school_days"][0], cu["delay_school_days"][1] + 1)))
        ghost_ep = episode_for(episodes, s.school_id, days.date.iloc[0])
        ghosts, ghost_cover = 0, 0.0
        if ghost_ep is not None and ghost_ep["type"] == "ghost_learners":
            gl = a["ghost_learners"]
            ghosts = int(round(enrolled * (gl["inflation"]["min"] + ghost_ep["strength"] * (gl["inflation"]["max"] - gl["inflation"]["min"]))))
            ghost_cover = float(rng.uniform(gl["recorded_as_fed"]["min"], gl["recorded_as_fed"]["max"]))
        registered = enrolled + ghosts
        enrolment.append({"school_id": s.school_id, "term_id": term_id, "learners": registered})
        delivery_day = int(rng.integers(stock_cfg["in_kind_delivery_week"]["min"] * 5 - 5, stock_cfg["in_kind_delivery_week"]["max"] * 5))
        share = rng.uniform(stock_cfg["in_kind_share_of_need"]["min"], stock_cfg["in_kind_share_of_need"]["max"])

        for i, row in days.iterrows():
            day = row.date
            ep = episode_for(episodes, s.school_id, day)
            kind = ep["type"] if ep is not None else None
            progress = 0.0 if ep is None else ((day - ep["start"]).days + 1) / ((ep["end"] - ep["start"]).days + 1)
            if s.programme_type == "in_kind" and i == min(delivery_day, len(days) - 1):
                for c in COMMODITIES:
                    need = registered * participation * len(days) * RATION_KG[c] * share
                    received = bank(need, 50 if c in ("cereals", "pulses") else 5)
                    note = None
                    if rng.random() < stock_cfg["short_delivery_probability"]:
                        note, received = received, bank(received * rng.uniform(0.85, 0.97), 5)
                    if received > 0:
                        add_movement(day, c, "delivery", received, note, f"DN-{term_id}-{s.school_id}")
                        if ghosts:
                            actual[c] -= received * ghosts / registered * (1 - ghost_cover)
            if s.programme_type == "cash_transfer" and i % stock_cfg["purchase_every_school_days"] == 0:
                for c in COMMODITIES:
                    days_ahead = min(stock_cfg["purchase_every_school_days"], len(days) - i)
                    need = registered * participation * days_ahead * RATION_KG[c] * rng.uniform(0.9, 1.1)
                    buy = max(0.0, bank(need - actual[c], 10 if c in ("cereals", "pulses") else 1))
                    if buy > 0:
                        add_movement(day, c, "purchase", buy, None, f"RCPT-{term_id}-{s.school_id}-{i}")

            noise = cfg["noise"]["ar1"] * noise + rng.normal(0, cfg["noise"]["log_sd"])
            effect = cfg["day_effects"].get(row.day_type, 1.0) * shock.get(day, 1.0)
            true_fed = int(min(enrolled, round(enrolled * participation * effect * np.exp(noise))))
            closed = rng.random() < 0.008
            fed_happened = not closed and actual["cereals"] >= true_fed * RATION_KG["cereals"] * 0.5
            reason = None if fed_happened else ("school_closed" if closed else "no_food")

            recorded_fed = true_fed if fed_happened else 0
            label_kind = kind
            if kind is None and fed_happened and claim_rng.random() < claim_p:                  # A7
                pad = claim_rng.uniform(*r["one_day_claim"]["padding"])
                recorded_fed = int(min(enrolled, round(true_fed * (1 + pad))))
                label_kind = "one_day_claim"
                ONE_DAY.append({"school_id": s.school_id, "type": "one_day_claim", "start": day, "end": day, "strength": float(pad)})
            if fed_happened and s.estimates_to:                                                 # C1
                recorded_fed = int(max(s.estimates_to, round(recorded_fed / s.estimates_to) * s.estimates_to))
            if fed_happened and ghosts:
                recorded_fed = int(min(registered, recorded_fed + round(ghosts * participation * ghost_cover)))
            if fed_happened and kind == "inflated_headcount" and rng.random() < 0.7:            # A1
                infl = a["inflated_headcount"]["inflation"]
                recorded_fed = int(min(enrolled * 0.99, round(true_fed * (1 + infl["min"] + ep["strength"] * (infl["max"] - infl["min"])))))
            if fed_happened and kind == "round_number_entry":                                   # A5
                step = [5, 10, 50][min(2, int(ep["strength"] * 3))]
                recorded_fed = int(min(enrolled, max(step, round(true_fed / step) * step)))

            issued = {"cereals": 0.0, "pulses": 0.0}
            from_ration = s.computes_issues or kind == "round_number_entry" or (kind == "backdated_bulk_entry" and ep["strength"] < 0.5)
            if fed_happened:
                for c in issued:
                    kg = recorded_fed * RATION_KG[c] * (1.0 if from_ration else np.exp(rng.normal(0, cfg["issuing"]["log_sd"])))
                    if kind == "consumption_drift":
                        fx = a["consumption_drift"]["final_excess"]
                        kg *= 1 + progress * (fx["min"] + ep["strength"] * (fx["max"] - fx["min"]))
                    issued[c] = min(actual[c], bank(kg, cfg["issuing"]["rounding_kg"]))
            if fed_happened and kind == "backdated_bulk_entry":                                 # A4
                recorded_fed = int(max(5, round(enrolled * participation * np.exp(rng.normal(0, 0.03)) / 5) * 5))
                for c in issued:
                    kg = recorded_fed * RATION_KG[c] * (1.0 if from_ration else np.exp(rng.normal(0, cfg["issuing"]["log_sd"])))
                    issued[c] = min(actual[c], bank(kg, 0.5))

            for c in issued:
                actual[c] -= issued[c]
                ledger[c] -= issued[c]
            minor = {}
            for c in ("oil", "salt"):
                minor[c] = recorded_fed * RATION_KG[c]
                actual[c] -= min(actual[c], minor[c])
                ledger[c] -= minor[c]
            if rng.random() < loss_probability:
                c = "cereals" if rng.random() < 0.7 else "pulses"
                lost = bank(actual[c] * rng.uniform(cfg["losses"]["share_of_stock"]["min"], cfg["losses"]["share_of_stock"]["max"]), 0.5)
                if lost > 0:
                    add_movement(day, c, "loss", lost)
            if kind == "stock_leakage" and fed_happened:
                lk = a["stock_leakage"]["share_of_daily_use"]
                for c in ("cereals", "pulses"):
                    actual[c] -= min(actual[c], true_fed * RATION_KG[c] * (lk["min"] + ep["strength"] * (lk["max"] - lk["min"])))

            # R4: the store count, from its own random stream; some scheduled counts not done
            count_day = i > 0 and i % stock_cfg["count_every_school_days"] == 0
            if count_day and count_rng.random() < r["count_skipped_probability"]:
                count_day = False
            if count_day:
                for c in ("cereals", "pulses"):
                    err = count_rng.normal(0, stock_cfg["count_error_kg_share"] * max(actual[c], 1))
                    if count_rng.random() < r["count_misrecorded"]["probability"]:            # C6
                        err += count_rng.choice([-1, 1]) * count_rng.uniform(*r["count_misrecorded"]["size"]) * max(actual[c], 1)
                    counts.append({"school_id": s.school_id, "date": day, "commodity": c,
                                   "counted_kg": bank(max(0.0, actual[c] + err), 0.5), "ledger_kg": round(ledger[c], 2)})

            here = cal_index[day]
            after_p = cfg["entry"]["after_hours_probability"]
            if kind == "backdated_bulk_entry":
                lag = a["backdated_bulk_entry"]["delay_school_days"]
                delay = int(round(lag["min"] + ep["strength"] * (lag["max"] - lag["min"])))
                capture_index = min(len(calendar) - 1, cal_index[ep["end"]] + delay)
                after_p = cfg["entry"]["catch_up_after_hours_probability"]
            elif catch is not None and catch[0] <= i <= catch[1]:                                 # C2
                capture_index = min(len(calendar) - 1, cal_index[days.date.iloc[catch[1]]] + catch[2])
                after_p = cu["after_hours_probability"]
            elif s.weekly_enterer:                                                                # C1
                weekday = pd.Timestamp(day).weekday()
                capture_index = min(len(calendar) - 1, here + max(0, 4 - weekday))
                after_p = r["weekly_entry"]["after_hours_probability"]
            else:
                delay = 0 if rng.random() < cfg["entry"]["same_day_probability"] else int(rng.integers(1, 4))
                capture_index = min(len(calendar) - 1, here + delay)
            present = None
            if s.records_present:
                true_present = int(min(enrolled, round(true_fed / s.uptake)))
                if not fed_happened:
                    present = true_present if reason == "no_food" else 0
                elif kind in ("inflated_headcount", "backdated_bulk_entry") or ghosts:
                    present = recorded_fed if kind != "ghost_learners" or rng.random() < 0.5 else int(round(recorded_fed / s.uptake))
                elif kind == "round_number_entry" or s.estimates_to:
                    step = s.estimates_to or 10
                    present = max(recorded_fed, int(round(true_present / step) * step))
                else:
                    present = max(recorded_fed, true_present)
            hour = int(rng.integers(18, 23)) if rng.random() < after_p else int(rng.integers(hours["start"], hours["end"]))
            version = 1 + int(rng.random() < cfg["entry"]["edit_probability"])

            # R3: a record never entered (never on a count day): the food was eaten, but the
            # ledger keeps it. Learners present left blank on some days.
            if present is not None and miss_rng.random() < r["present_blank_probability"]:
                present = None
            if not count_day and miss_rng.random() < s.missing_share:
                for c in issued:
                    ledger[c] += issued[c]
                for c in minor:
                    ledger[c] += minor[c]
                if label_kind == "one_day_claim":
                    ONE_DAY.pop()
                continue
            feeding.append({
                "school_id": s.school_id, "date": day, "feeding_happened": fed_happened,
                "learners_present": present, "learners_fed": recorded_fed,
                "cereals_kg": issued["cereals"], "pulses_kg": issued["pulses"],
                "reason_code": reason, "capture_index": capture_index, "capture_hour": hour,
                "version": version, "label": label_kind or "",
            })
    return feeding, movements, counts, enrolment


g.make_schools = make_schools
g.simulate_school = simulate_school
g.plan_outages = plan_outages


def generate(seed, out_dir, count_every=None):
    cfg = load_config(seed, count_every)
    ONE_DAY.clear()
    _SHOCKS.clear()
    g.generate(cfg, Path(out_dir), quiet=True)
    ep = pd.read_csv(Path(out_dir) / "episodes.csv")
    pd.concat([ep, pd.DataFrame(ONE_DAY, columns=ep.columns)]).to_csv(Path(out_dir) / "episodes.csv", index=False)


def _one(task):
    seed, root, count_every = task
    d = Path(root) / f"seed_{seed}"
    if not (d / "labels.csv").exists():
        generate(seed, d, count_every)
    return seed


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--out", required=True)
    p.add_argument("--seeds", required=True, help="first-last, e.g. 8101-8130")
    p.add_argument("--count-every", type=int, default=None)
    p.add_argument("--workers", type=int, default=2)
    a = p.parse_args()
    first, last = (int(x) for x in a.seeds.split("-"))
    with ProcessPoolExecutor(a.workers) as pool:
        for s in pool.map(_one, [(s, a.out, a.count_every) for s in range(first, last + 1)]):
            print("generated", s, flush=True)


if __name__ == "__main__":
    main()
