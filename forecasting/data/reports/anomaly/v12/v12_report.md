# Anomaly detection, protocol version 12: controlled experiments on realistic data

Protocol: `config/anomaly_v12.yaml`, committed before any of its data existed, with two amendments
committed before any detector result on protocol data. Harness: `scripts/run_anomaly_v12.py` and
`anomaly/evaluation_v12.py`, which reproduces the scoring service's listings exactly for version 11
(`parity.json`). Results: `baselines.json`, `stage_*.json`, `final.json`.

## 1. Question

Can the model be made to find more problems, defensibly? Every change was tested one at a time
against the current setting:
- on data from a realistic generator that was frozen first;
- at the same officer workload;
- with problem-level measures declared before any data existed;
- under fixed adoption rules;
- with a validation set used once per stage, and a final test generated after the freeze.

## 2. Measures

Every recall, precision and F1 below is labelled problem-level or week-level.

### Problem-level (the headline)

| Measure | Definition |
|---|---|
| Problem-level recall | The share of problems (episodes of the six types) listed at least once while they ran, or, for a stock leak, at the store count that revealed it. |
| Problem-level precision | The share of officer visits that find a problem. A visit is a listing that is not a repeat of a confirmed listing in the previous 4 weeks. |
| Problem-level F1 | The harmonic mean of the two. |

### Week-level (as in versions 7–11)

| Measure | Definition |
|---|---|
| Precision@3 | The share of listed school-weeks that hold a problem. |
| Recall@3 | The share of problem school-weeks that were listed. |
| F1@3 | The harmonic mean of precision@3 and recall@3. |
| PR-AUC | Ranking quality over all school-weeks, across every threshold. |

### Workload

False listings per officer-term: listed school-weeks with no problem, per officer per 13 weeks.

Every comparison is made at one workload for both settings: 2.5 false listings per officer-term, or
the lowest level both can reach (amendment 1).

## 3. Data

### The realistic generator

`scripts/generate_feeding_dataset_realistic.py` with `config/feeding_dataset_realistic.yaml`
(version 1, hashed in the protocol). It adds honest behaviour that the standard generator lacks:

- registers estimated to the nearest 5 or 10 (20% of schools);
- food issued computed from the ration (35% of schools);
- entry on Friday (20%) and catch-up entry days later (15% of school-terms);
- tins instead of scales;
- genuine enrolment changes of 8–25%;
- attendance shocks shared by a sub-county;
- store counts with an error of 2% of stock, some written down wrongly;
- the delivery note's figure written in the ledger (30% of schools);
- mobile network outages across a sub-county;
- records never entered (up to 3% of days);
- learners present left blank.

The six problems are milder and more varied than in the standard generator, and a one-day padded
claim is added as a seventh type.

### Datasets

| Use | Seeds | Note |
|---|---|---|
| Development | 8101–8130 | |
| Validation | 8201–8220 | once per stage |
| Store-count intervals | 8101–8115 | counts every 10 and every 5 school days |
| Final, realistic | 9501–9520 | generated after the freeze |
| Final, standard | 9601–9620 | generated after the freeze |

### How hard it is

- **The store-shortfall listing alone misfires.** On the realistic data it gives 2.5 false listings
  per officer-term, because 11.5% of honest store counts come out more than 2 days of food short.
- **So 2.5 false listings can't be reached.** Version 11 at its highest q reaches 3.35 false
  listings per officer-term, and that is where the stages compare.

## 4. Baselines (development, realistic data)

At each setting's own lowest workload, q from the grid:

| Setting | False listings / officer-term | Problem-level F1 | Problem-level precision | Problem-level recall | F1@3 | Precision@3 | Recall@3 | PR-AUC |
|---|---|---|---|---|---|---|---|---|
| Version 8 as deployed, 28 days | 2.5 | 23.2% | 19.4% | 30.2% | 11.9% | 26.3% | 7.8% | 17.9% |
| Version 8, 56 days | 2.5 | 25.7% | 21.1% | 34.1% | 15.7% | 32.6% | 10.5% | 21.4% |
| Version 11, 28 days | 3.2 | 31.6% | 23.3% | 49.8% | 16.8% | 29.4% | 11.8% | 24.1% |
| **Version 11, 56 days** | 3.35 | **33.9%** | **24.5%** | **56.1%** | **20.0%** | **32.9%** | **14.4%** | **28.2%** |

Version 11 with 56-day rescoring, compared with each other setting at the same workload (3.35),
paired 95% intervals over 30 datasets, in percentage points:

| Against | Problem-level F1 | Problem-level recall | Problem-level precision | F1@3 | PR-AUC |
|---|---|---|---|---|---|
| Version 8 as deployed (28 days) | +10.1 (+7.5 to +12.8) | +19.9 (+15.5 to +24.4) | +6.5 (+4.4 to +8.5) | +5.9 (+4.0 to +7.6) | +10.3 (+8.9 to +11.6) |
| Version 8, 56 days | +8.5 (+6.1 to +11.1) | +16.3 | +5.6 | +2.0 | +6.8 |
| Version 11, 28 days | +2.5 (+1.5 to +3.5) | +5.6 (+3.8 to +7.4) | +1.5 | +2.6 | +4.2 |

Version 11 is ahead of version 8 at every workload on the grid. At about 3.5 false listings per
officer-term:

| Setting | Problem-level F1 | Problem-level recall |
|---|---|---|
| Version 11 | 33.7% | 57% |
| Version 8 | 23.9% | 37% |

### Problems caught by type (version 11, 56 days)

| Type | Caught |
|---|---|
| Stock leakage | 86% |
| Ghost learners | 71% |
| Backdated entry | 69% |
| Consumption drift | 68% |
| Inflated headcount | 27% |
| Round-number entry | 17% |
| One-day claim | 7% |

Inflated headcount and round numbers are hard because, on the realistic data, honest estimated
registers and attendance shocks look much the same.

### The workload trade-off (version 11, 56 days, development data)

The programme chooses q from how many needless visits it accepts.

| q | False listings / officer-term | Problem-level recall | Problem-level precision | Problem-level F1 | F1@3 |
|---|---|---|---|---|---|
| 0.95 | 10.5 | 77% | 14% | 24% | 30% |
| 0.98 | 6.3 | 69% | 19% | 29% | 27% |
| 0.99 | 4.9 | 64% | 21% | 32% | 25% |
| 0.999 | 3.35 | 56% | 25% | 34% | 20% |

## 5. The experiments

Each candidate was compared with the stage's starting setting at the same workload on 30
development datasets. The adoption rule required all four of:
- a problem-level F1 gain of at least 1.0 point, with the 95% interval above 0;
- problem-level recall no more than 2 points lower;
- no type's catch rate more than 10 points lower;
- F1@3 no more than 2 points lower.

**Nothing passed**, so no stage reached its validation run.

Figures are changes in percentage points against the stage's start. Problem-level F1 is shown with
its 95% interval.

### S: system

| Candidate | Problem-level F1 | Problem-level recall | F1@3 | Why it failed |
|---|---|---|---|---|
| S2 not re-listing schools under follow-up for 4 weeks | −0.6 (−1.5 to +0.2) | −1.4 | −6.6 | no gain |
| S3 summed store-count rule, counts every 20 days | 0.0 | 0.0 | 0.0 | identical |
| S3 counts every 10 days | −2.9 (−4.9 to −1.0) | −3.5 | −2.7 | worse: false listings from shortfalls 3.1 |
| S3 counts every 10 days, summed | −5.7 | −11.4 | −10.9 | worse: false listings from shortfalls 7.9 |
| S3 counts every 5 days | −5.8 | −9.9 | −6.4 | worse: false listings from shortfalls 4.4 |
| S3 counts every 5 days, summed | −13.7 | −7.4 | −12.9 | worse: false listings from shortfalls 25 |

### M1: features and scaling

| Candidate | Problem-level F1 | Problem-level recall | F1@3 |
|---|---|---|---|
| Scale floor | +0.2 (−0.5 to +0.8) | 0.0 | +0.5 |
| Leave out fed_rate | −0.3 | −0.4 | +0.2 |
| Leave out fed_vs_own | +0.1 | +1.0 | +0.2 |
| Leave out fed_vs_peers | −0.5 | −0.9 | −0.1 |
| Leave out fed_rate_vs_last_term | +0.3 | +0.9 | +0.2 |
| Leave out uptake | −0.9 (−1.8 to −0.1) | −1.7 | −1.1 |
| Leave out enrolment_change | +0.5 (−0.3 to +1.3) | +1.6 | +0.1 |
| Low headcount scored in both directions | +0.2 | +0.2 | +0.3 |
| Sample size 256 | −0.9 | −2.0 | −0.9 |
| Sample size 128 | −1.4 (−2.4 to −0.2) | −3.0 | −1.2 |

### M2: dense forest and sparse tail scores

| Candidate | Problem-level F1 | Problem-level recall | F1@3 | Note |
|---|---|---|---|---|
| Split (compared at 5.1, its lowest workload) | −0.8 (−1.9 to +0.3) | −0.6 | **+10.3** | inflated headcount −11 |
| Split without the store-shortfall listing | −3.8 (−6.0 to −1.4) | −7.2 | **+17.0** | stock leakage caught 86% → 15% |

### M3: temporal features and weekly aggregation

| Candidate | Problem-level F1 | Problem-level recall | F1@3 | Note |
|---|---|---|---|---|
| CUSUM | −1.0 | −2.1 | −0.5 | |
| Rolling means over 5, 10 and 20 days | −2.2 (−3.7 to −0.6) | −5.8 | −1.3 | |
| Existing trend candidates | −0.7 | −1.0 | −1.6 | |
| Weekly peak | +0.5 (−0.4 to +1.3) | −1.7 | −0.6 | one-day claims +5.4 |
| Weekly mean | +0.7 (−0.6 to +2.0) | +1.8 | +0.4 | |

## 6. What the experiments show

**1. Version 11 is not near a cheap improvement.**
- Twenty-three changes from the audit and from the brief's suggestions were tested: system, scaling,
  features, model structure, temporal features and aggregation.
- None found more problems at the same workload by a margin that clears the 95% interval.
- The largest point gains were +0.5 to +0.7, inside the noise.

**2. Week-level F1@3 can be raised a lot, but not by finding more problems.**
- The split model raised F1@3 by 10.3 points, and by 17.0 without the store-shortfall listing.
- Both found fewer distinct problems. The second stopped catching stock leaks (86% → 15%).
- They gain by listing problems already found, week after week.
- This is why problem-level measures were declared as the headline before any data existed.

**3. More frequent store counts make things worse when counts are imprecise.**
- Each count is another chance for an honest counting error to look like a shortfall.
- A shorter interval would only help if counts were also more precise. That is a procedure question
  for the programme, such as a recount before a visit.

**4. The store-shortfall listing is both the largest source of needless visits and essential.**
- It gives 2.5 false listings per officer-term on the realistic data.
- Removing it loses most stock leaks (86% → 15%).

**5. Not re-listing schools under follow-up does not free useful slots.**
- At this workload the shortfall listing and the threshold leave few slots to free.
- It cuts week-level F1@3 by 6.6 points, because F1@3 counts re-listing as success.

**6. Rescoring for 56 days instead of 28 is the one change that holds.**
- It gives +2.5 points of problem-level F1 and +5.6 of problem-level recall on the realistic data.
- It is a backend change, not a model change.

## 7. Final test

The frozen setting is version 11 with 56-day rescoring, at q 0.999 (the q of the lowest workload it
reaches on development data). It was run once, at that q, on data generated after the freeze, and
reported as it came out.

### Realistic data (seeds 9501–9520)

| Setting | False listings / officer-term | Problem-level F1 | Problem-level precision | Problem-level recall | F1@3 | Precision@3 | Recall@3 | PR-AUC |
|---|---|---|---|---|---|---|---|---|
| Version 8 as deployed (28 days, q 0.98) | 3.4 | 24.8% | 18.3% | 39.4% | 17.4% | 29.2% | 12.6% | 19.5% |
| Version 11 as committed (28 days, q 0.99) | 4.6 | 29.8% | 20.0% | 59.2% | 21.1% | 29.4% | 16.6% | 24.7% |
| **Version 12 = version 11, 56 days, q 0.999** | 3.3 | **33.9%** | **24.6%** | **55.8%** | 19.6% | **33.4%** | 14.0% | **27.9%** |

Version 12 against each setting, paired 95% intervals over 20 datasets, in percentage points:

| Measure | Against version 8 as deployed (about the same workload) | Against version 11 as committed |
|---|---|---|
| Problem-level F1 | **+9.1** (+5.5 to +12.9), wins 95% of datasets | **+4.1** (+2.0 to +6.1) |
| Problem-level recall | **+16.4** (+10.8 to +22.5) | −3.3 (−6.7 to 0.0) |
| Problem-level precision | **+6.3** (+3.5 to +9.4) | **+4.6** (+2.9 to +6.2) |
| F1@3 | +2.2 (−1.1 to +5.3) | −1.5 (−2.7 to −0.2) |
| PR-AUC | **+8.4** (+6.1 to +10.6) | **+3.2** (+2.1 to +4.3) |

Against version 11 as committed, version 12 also has 1.3 fewer false listings per officer-term.

**Workload curve (final realistic data).** Version 12 is ahead of version 8 at every q:

| Approximate false listings / officer-term | Version 12 problem-level recall | Version 8 problem-level recall | Version 12 problem-level F1 | Version 8 problem-level F1 |
|---|---|---|---|---|
| 3.3–3.4 | 57% | 37% | 34.1% | 24.1% |
| 4.7–4.9 | 66% | 45% | 31.4% | 23.8% |
| 7.5–7.9 | 76% | 56% | 27.4% | 22.6% |

**Seed stability.** Model seeds 1–5 on 5 final datasets gave problem-level F1 of 31.9% to 32.2%.

### By type and timing (realistic data)

| Type | Caught |
|---|---|
| Backdated entry | 70% |
| Stock leakage | 82% |
| Ghost learners | 70% |
| Consumption drift | 72% |
| Inflated headcount | 22% |
| Round-number entry | 20% |
| One-day claim | 4.5% |

Median days to catch: 28.

### Standard data (seeds 9601–9620)

At the same frozen q, version 12 lists far fewer schools here, because honest store counts rarely
misfire.

| Setting | False listings / officer-term | Problem-level F1 | Problem-level precision | Problem-level recall | F1@3 | Precision@3 | Recall@3 | PR-AUC |
|---|---|---|---|---|---|---|---|---|
| Version 8 as deployed | 3.1 | 41.7% | 30.2% | 69.7% | 40.6% | 52.6% | 33.6% | 42.4% |
| Version 11 as committed | 1.7 | 58.0% | 47.2% | 77.5% | 42.7% | 66.2% | 31.8% | 45.7% |
| **Version 12** | 0.5 | **72.0%** | **75.0%** | 70.6% | 39.0% | **84.8%** | 25.5% | **51.8%** |

These rows are at different workloads, so compare them along the curve:
- At 3.0–3.3 false listings per officer-term, version 12 has problem-level recall 91% and F1 50.1%;
  version 8 has 69% and 42.1%.
- At 1.6–1.8, version 12 has 84% and 60.3%; version 8 has 60% and 49.2%.

### Fairness (development data, realistic)

False listing rates among ordinary school-weeks, version 12 (overall 2.8%):

| Group | False listing rate |
|---|---|
| Food delivered | 3.4% |
| Cash transfer | 1.5% |
| Weekly enterers | 3.9% |
| Estimated registers | 3.3% |
| Copies the delivery note | 3.5% |

All are within 1.5 times the overall rate. Weekly enterers are the highest, at 1.4 times.

### Conclusion

Version 11 stays. Of the 24 changes tested, only rescoring for 56 days instead of 28 improves it;
it is a backend change. On fresh realistic data at the same workload, the system found 16 points
more distinct problems than version 8 as deployed, and had 9 points higher problem-level F1.

## 8. Limits

**Synthetic data**
- Every figure comes from synthetic data. The realistic generator's settings are stated assumptions,
  not measurements of real schools.
- The 2% count error, in particular, decides how often the shortfall listing misfires.
- A pilot measures the real rates: confirmed problems per visit, and how often honest counts are
  short.

**Simplifications**
- Ten schools per sub-county (real ones have 30–80).
- Problems never overlap at one school.
- Follow-up outcomes are taken from the labels. In a pilot, the officer's recorded outcome replaces
  them.

**Problems still hard to find**
- One-day claims: about 7% caught.
- Round-number entry and inflated headcount, when honest schools estimate their registers.
