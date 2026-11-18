# Anomaly detection: protocol version 9 (part B and the fresh-data test)

Plan: [`forecasting/config/anomaly_v9.yaml`](../../../../config/anomaly_v9.yaml).
- **Part A,** the investigation, is reported in [`v9_investigation`](../v9_investigation/v9_investigation_report.md).
- **Part B** was written after it was reviewed and before any experiment.
- **The freeze** was committed before any fresh data was generated.

Figures: [`development.json`](development.json), [`final.json`](final.json).

**Result:**
- **No change was adopted, so version 9 is version 8.**
- **On 10 fresh datasets, scored once,** the deployed list reaches F1@3 50.8% and catches 85.2% of problems while they are still going on.

## Development (2025 only, the three types present)

Each change was tested in order against the current setting, over 4 datasets × 5 model seeds. To be adopted, a change had to meet all of these:
- gain its F1@3 margin (2.0 points for change 1, 1.0 for the others);
- not lower problems caught;
- add no more than 1.0 ordinary school listed per officer-term;
- keep every group under 1.5 times the overall false listing rate.

| | F1@3 | Precision@3 | Recall@3 | Problems caught | Ordinary schools per officer-term | Decision |
|---|---|---|---|---|---|---|
| Version 8 | 40.8% | | | 78.6% | 2.9 | |
| 1. Over-recording signal, averaged | 33.1% | 38.0% | 29.7% | 58.2% | 3.4 | Not adopted (−7.6; problems caught fell) |
| 2. Store-count gap carried | 41.2% | 44.4% | 38.8% | 80.4% | 3.4 | Not adopted (+0.4, under the margin) |
| 3. Persistence | 41.2% | 40.8% | 41.6% | **91.1%** | 4.2 | Not adopted (+0.4, under the margin; +1.3 ordinary per term, over the limit) |

**Change 1 did what it was designed to do for inflated headcount, and cost more elsewhere.**

| School-weeks listed | Version 8 | With change 1 |
|---|---|---|
| Inflated headcount | 16% | **70%** (problems caught 45% → 95%) |
| Consumption drift | 63% | 16% |
| Stock leakage | 30% | 6% |

- **Why:** averaging the two percentiles halves the isolation model's signal on days only it picks up.
- **Ruled out within version 9:** combining them differently (for example the higher of the two) would be a new design, chosen after seeing this result. If tried, it needs its own protocol version, written before it runs.

**Change 3 came closest.**
- It raised problems caught from 79% to 91%, and inflated-headcount problems caught from 45% to 80%.
- But F1@3 gained only 0.4 points, and it listed 1.3 more ordinary schools per officer per term than version 8, over the limit of 1.0 fixed in advance.
- Whether that extra workload is worth catching more problems is a programme decision, not a model one. The rule, fixed beforehand, says no.

## Fresh-data test (2026 of 10 new datasets, seeds 9001–9010)

The generator's code version is recorded in the protocol (commit `050703a`). Each dataset was scored once, with 5 model seeds; 900 planted problems in all, of all six types. The intervals are 95%, from 2,000 bootstrap resamples of the 10 datasets.

| Measure | Mean | Spread across datasets (SD) | 95% interval |
|---|---|---|---|
| Precision@3 | 53.8% | 4.9 | 51.0–56.9% |
| Recall@3 | 48.5% | 11.3 | 42.5–55.6% |
| **F1@3** | **50.8%** | 8.2 | 46.4–55.9% |
| **Problems caught while still going on** | **85.2%** | 7.7 | 80.6–89.2% |
| Caught within 2 weeks | 47.8% | 8.5 | 42.7–52.8% |
| Median weeks to catch | 1 | | |
| Ordinary schools listed per officer-term | 4.3 | 0.4 | 4.1–4.6 |
| Schools listed per officer-week | 0.73 | 0.12 | 0.66–0.81 |

Each dataset's F1@3 ranged from 42.5% to 65.4%, and its problems caught from 70% to 94%.

| Type | School-weeks listed | Problems caught |
|---|---|---|
| Backdated bulk entry | 100% | 100% |
| Round-number entry | 69% | 99% |
| Ghost learners | 40% | 94% |
| Consumption drift | 54% | 90% |
| Stock leakage | 31% | 80% |
| Inflated headcount | 15% | **49%** |

**Fairness:** no group is over-listed. The highest ratio is 1.13, against the limit of 1.5.

## What this means

- **Version 8's results hold up on data nobody had looked at.** Its 2026 figures (F1@3 52.6%, problems caught 88.3%) fall inside or just above the fresh-data intervals. So they were not an artefact of having studied 2026.
- **Inflated headcount is the weakness that remains.** About half of those problems are caught.
- **The one change that fixes it** (change 1) costs more on the other types than it gains.
- **The one that nearly helps overall** (persistence) costs officer time, a choice for the programme.
- **80% F1@3 is not reached and was not expected:** the labelled benchmark in part A reached about 70% on the development types. **Problems caught while still going on is 85%**, above 80%.

Synthetic data: this describes how the list behaves on records shaped like Kenyan school feeding records with planted problems, not how often it would be right at real schools.
