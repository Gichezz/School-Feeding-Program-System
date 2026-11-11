# The synthetic school feeding dataset

The anomaly detection methods are compared on a **synthetic dataset**, because no real school feeding records were available. This document says exactly how it is generated, so its results can be read for what they are.

**What it can and cannot show.** It tests whether anomaly detection is **feasible under simulated Kenyan school-feeding conditions**: whether the methods find planted irregularities in records shaped like real ones, including irregularities they were never tuned on. It does **not** measure how often they would be right about **naturally occurring** irregularities at real schools. Real misreporting may look different from what was planted, and real schools vary in ways the generator does not imagine. A pilot comparing the weekly lists with schools' registers and store books is the step that would establish real-world accuracy.

- Generator: [`forecasting/scripts/generate_feeding_dataset.py`](../forecasting/scripts/generate_feeding_dataset.py)
- Settings: [`forecasting/config/feeding_dataset.yaml`](../forecasting/config/feeding_dataset.yaml)
- Real Kenyan inputs: [`forecasting/config/kenya_inputs.yaml`](../forecasting/config/kenya_inputs.yaml)

## 1. What is real and what is assumed

| Input | Source |
|---|---|
| Term dates, half-terms, public holidays 2024–2026 | **Real**: Ministry of Education calendar and gazetted holidays (`kenya_inputs.yaml`) |
| Ration: 150 g cereals, 40 g pulses, 5 g oil, 2 g salt per learner per meal | **Real**: School Meals Programme ration |
| How much learners fed varies from day to day, and on each kind of day (first days, closing day) | **Calibrated** from a real dataset: 15 Swedish school canteens, 2010–2020 |
| Enrolment 180–950, participation 82–95%, 30% cash-transfer schools, deliveries, losses, store counts, entry and sync behaviour, outages | **Assumptions**, stated in `feeding_dataset.yaml` |

## 2. Schools and the normal day

- **40 schools in 4 sub-counties** (10 each), from January 2024 to the last school day of Term 3 2026. Each school gets an enrolment, a participation rate, an in-kind or cash-transfer programme, how often its device syncs (every 1–5 school days), and whether it records learners present (70% do).
- **Learners fed** each school day = enrolment × participation × the effect of the kind of day × day-to-day noise (log-normal, sd 0.05, correlated day to day). Some days have no feeding, with a reason: no food in store, or the school closed.
- **Food issued** = learners fed × the ration, with small variation (sd 3%), rounded to 0.5 kg (cooks measure with tins). Oil and salt follow the ration.
- **Stock:**
  - in-kind schools get 75–100% of the term's need, 1–4 weeks into the term, and 15% of deliveries weigh less than the delivery note;
  - cash-transfer schools buy about every 20 school days;
  - genuine recorded losses (pests, damp) happen about 1.5 times a school a year;
  - the store is counted every 20 school days, with a small weighing error.
- **Entering and syncing:**
  - 85% of days are entered the same day, the rest 1–3 school days late, during school hours (5% after hours);
  - each device syncs every 1–5 school days, sending everything waiting in one batch;
  - **connectivity outages** (protocol version 7): in each term, each school has a 35% chance of one outage of 5–15 school days. The device keeps recording on time but cannot sync, then sends everything at once. Outages use their own random stream, so adding them changed no other value in the data.

## 3. The six planted problems

Each problem is an **episode** at one school, with a start, an end and a **strength** drawn uniformly between 0 and 1 that sets how severe it is. A school never has two episodes at once. Every school-day in an episode is labelled with its type; the labels are used only to score methods, never by a method.

| Problem | How it is generated | Severity (by strength) | Duration |
|---|---|---|---|
| **Inflated headcount** | More learners recorded as fed than were fed; food issued follows the recorded number, so the store empties faster | +12% to +35% learners fed, capped just below enrolment | 10–30 school days |
| **Consumption drift** | Food issued per learner creeps up over the episode | from 0 to +20%…+45% by the end | 10–30 school days |
| **Stock leakage** | Food leaves the store unrecorded each day; it only shows at the next store count, which is also labelled | 15%–40% of a day's real use, each day | 10–30 school days |
| **Backdated bulk entry** | The whole episode is entered in one sitting, 8–25 school days after it ended (60% after hours), with figures from memory: the usual number rounded to 10, food exactly at the ration | delay 8 → 25 school days | 10–30 school days |
| **Round-number entry** | Learners fed rounded to the nearest 10, or 50 for stronger episodes; food at exactly the ration | rounding to 10 or 50 | 10–30 school days |
| **Ghost learners** | Enrolment inflated for a whole term, so more food is allocated; part of the extra (0–100%) is recorded as fed, the rest leaves the store unrecorded | +10% to +30% enrolment | a whole term |

**How often, and where:**
- 2024 and 2025 (tuning): 14 episodes a year, cycling through the **three tuning types** (inflated headcount, consumption drift, stock leakage).
- 2026 (test): 18 episodes, **three of each of the six types**. The other three (backdated bulk entry, round-number entry, ghost learners) are **held out**: they never appear before the test year, so no method or setting is tuned on them.
- Schools are chosen at random for each episode, and start dates fall at random within the year.

Labelled school-days in the main dataset: inflated headcount 260, consumption drift 240, stock leakage 242, ghost learners 148, backdated bulk entry 60, round-number entry 55 (1,005 of 20,360 school-days, about 5%).

## 4. Guarding against learning the generator's quirks

A method could score well by spotting something only this generator does. These checks make that less likely:
1. **Held-out types.** Three of the six problems are only in the test year, so a method can't have been tuned to them.
2. **Context is not evidence.** The kind of day adjusts what is normal (protocol version 3); closing days and opening days are not flagged for being unusual.
3. **Timing reflects the records, not the network.** Entry delay and entry batches are measured from when records were entered, not when they arrived (protocol version 7), so connectivity outages, which are planted for ordinary schools too, are not a shortcut.
4. **No future records.** Every feature uses only records up to the day it describes, checked by a test.
5. **Different data, same conclusion.** The robustness study regenerates the data under 7 scenarios (noisier days, subtler problems, a larger programme, more frequent counts, irregular entry, heavy connectivity outages, and the baseline) with 3 seeds each.
6. **Run as deployed.** The deployment test refits monthly per sub-county without labels, on the main dataset and three more seeds.
7. **Feature ablation.** Each feature and group is removed in turn, to see which carry the results ([anomaly evaluation report](../forecasting/data/reports/anomaly/anomaly_evaluation.md)).

## 5. Limitations of the data itself
- **Small groups.** A sub-county has 10 schools, so a school's "similar schools nearby" is the median of the other 9. Peer comparisons are indications, not statistical conclusions, and so are fairness results by group.
- **Assumed behaviour.** How often schools enter late, sync, lose connection, or record learners present is assumed, not measured.
- **Imagined problems.** The six problems are the ones described in audits and programme reviews. Collusion that keeps every record consistent (including store counts) is not simulated, and no method here would find it from records alone.

## 6. Reproducing

```bash
python forecasting/scripts/generate_feeding_dataset.py
```

The same seed gives the same data. The robustness study and deployment test generate their own seeded copies.
