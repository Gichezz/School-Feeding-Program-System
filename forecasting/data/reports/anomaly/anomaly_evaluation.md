# Anomaly detection: evaluation on synthetic school feeding records

Protocol: [`forecasting\config\anomaly_evaluation.yaml`](../../../config/anomaly_evaluation.yaml) version 7, committed before it was run; what changed from each earlier version, and why, is recorded in the protocol. Data: 40 synthetic schools ([generator](../../../scripts/generate_feeding_dataset.py)); tuning period 13,600 school-days (588 anomalous, tuning types only), test period 6,760 school-days (417 anomalous, every type). The held-out types (backdated_bulk_entry, round_number_entry, ghost_learners) never appear before the test run.

The fixed rules flag a day when it breaks at least one rule, as the protocol sets; their threshold is not tuned.

## Weekly review list (primary metric: precision@10)

Each week, the 10 school-weeks with the highest scores across the programme. Precision@10 is the share of them that really contain an anomaly; the interval is a 1,000-sample bootstrap over weeks of the difference against the best method.

| Method | Precision@10 | Anomalous school-weeks listed | Difference from the best (points, 95% interval) |
|---|---|---|---|
| Fixed rules | 13.3% | 48.0% | -9.2 (-12.5 to -5.8) |
| Robust z-score | 15.8% | 57.0% | -6.7 (-8.9 to -4.4) |
| Isolation Forest | 20.6% | 74.0% | -1.9 (-3.3 to -0.8) |
| Extended Isolation Forest | 22.5% | 81.0% | +0.0 (+0.0 to +0.0) |
| One-class SVM | 20.3% | 73.0% | -2.2 (-3.9 to -0.8) |
| SGD one-class SVM | 20.6% | 74.0% | -1.9 (-3.9 to -0.3) |
| Local Outlier Factor | 18.3% | 66.0% | -4.2 (-6.4 to -1.9) |

**Recommended under the decision rule: Extended Isolation Forest** (best precision@10: Extended Isolation Forest; among learned methods not distinguishable from the best, the rule prefers the fastest to fit on 50,000 rows). 

The best precision@10 any method could reach is 27.8%: most weeks have fewer than 10 school-weeks with an anomaly, so a full list must include some ordinary ones. Precision@10 is therefore best read against that ceiling, together with the share of anomalous school-weeks that make the list.

## School-day flags (threshold chosen on the selection year, 2025)

| Method | Precision | Recall | F1 | Recall, held-out types | False flags per 1,000 ordinary days |
|---|---|---|---|---|---|
| Fixed rules | 64.5% | 42.7% | 51.4% | 62.7% | 15.5 |
| Robust z-score | 42.0% | 44.6% | 43.3% | 55.5% | 40.5 |
| Isolation Forest | 44.4% | 48.9% | 46.6% | 56.6% | 40.2 |
| Extended Isolation Forest | 33.5% | 76.0% | 46.5% | 94.7% | 99.2 |
| One-class SVM | 52.4% | 60.7% | 56.2% | 78.0% | 36.3 |
| SGD one-class SVM | 50.8% | 60.7% | 55.3% | 78.3% | 38.6 |
| Local Outlier Factor | 33.8% | 64.0% | 44.3% | 95.4% | 82.3 |

## Recall by anomaly type (test)

| Method | backdated_bulk_entry (held out) | consumption_drift | ghost_learners (held out) | inflated_headcount | round_number_entry (held out) | stock_leakage |
|---|---|---|---|---|---|---|
| Fixed rules | 100.0% | 17.7% | 71.0% | 2.1% | 0.0% | 2.3% |
| Robust z-score | 100.0% | 58.1% | 28.4% | 4.2% | 80.0% | 4.5% |
| Isolation Forest | 100.0% | 53.2% | 48.6% | 43.8% | 30.9% | 2.3% |
| Extended Isolation Forest | 100.0% | 62.9% | 97.3% | 47.9% | 81.8% | 13.6% |
| One-class SVM | 100.0% | 69.3% | 74.3% | 10.4% | 63.6% | 0.0% |
| SGD one-class SVM | 100.0% | 67.7% | 76.3% | 10.4% | 60.0% | 0.0% |
| Local Outlier Factor | 100.0% | 3.2% | 100.0% | 27.1% | 78.2% | 2.3% |

Stock leakage leaves a trace only on days the store is counted (6 such days in the test period). Recall on those days: Fixed rules 16.7%; Robust z-score 33.3%; Isolation Forest 16.7%; Extended Isolation Forest 100.0%; One-class SVM 0.0%; SGD one-class SVM 0.0%; Local Outlier Factor 16.7%.

## Settings chosen on the selection year (fitted on 2024, judged on 2025)

| Method | Setting | F1 on 2025 |
|---|---|---|
| Fixed rules | fixed | 0.079 |
| Robust z-score | history_days=80 | 0.274 |
| Isolation Forest | n_estimators=300, max_samples=1024 | 0.278 |
| Extended Isolation Forest | n_estimators=100, ndim=15 | 0.309 |
| One-class SVM | nu=0.1, gamma_factor=0.3 | 0.322 |
| SGD one-class SVM | nu=0.1, n_components=100 | 0.323 |
| Local Outlier Factor | n_neighbors=100 | 0.289 |

## Time to fit and score

Seconds to fit the chosen setting on n school-days, and to score 5,000. The one-class SVM fits on a sample of 5,000 rows and Isolation Forest on its max_samples, so their fitting time levels off by design.

| Method | Fit, 5,000 rows | Fit, 20,000 rows | Fit, 50,000 rows | Score 5,000 rows |
|---|---|---|---|---|
| Fixed rules | 0.00 | 0.00 | 0.00 | 0.00 |
| Robust z-score | 0.01 | 0.03 | 0.06 | 0.30 |
| Isolation Forest | 0.41 | 0.52 | 0.78 | 0.08 |
| Extended Isolation Forest | 0.67 | 0.70 | 0.74 | 0.74 |
| One-class SVM | 0.17 | 0.14 | 0.16 | 0.14 |
| SGD one-class SVM | 0.03 | 0.11 | 0.24 | 0.01 |
| Local Outlier Factor | 0.65 | 7.47 | 39.92 | 3.93 |

## Feature ablation (Extended Isolation Forest)

The recommended method refitted without one feature, or one group, at a time; precision@k on the selection year (2025) and the test year (2026), and the share of each problem type's school-weeks listed in the test year. Reported only: features are not chosen from it (protocol version 7).

| Variant | Precision@k 2025 | Change (points) | Precision@k 2026 | Change (points) | backdated_bulk_entry | consumption_drift | ghost_learners | inflated_headcount | round_number_entry | stock_leakage |
|---|---|---|---|---|---|---|---|---|---|---|
| all features | 16.7% | +0.0 | 22.5% | +0.0 | 100.0% | 75.0% | 100.0% | 66.7% | 78.6% | 42.9% |
| without fed_rate | 15.0% | -1.7 | 22.8% | +0.3 | 100.0% | 68.8% | 100.0% | 75.0% | 78.6% | 50.0% |
| without fed_vs_own | 16.4% | -0.3 | 22.5% | +0.0 | 100.0% | 68.8% | 100.0% | 66.7% | 78.6% | 50.0% |
| without fed_vs_peers | 15.3% | -1.4 | 23.1% | +0.6 | 100.0% | 75.0% | 100.0% | 75.0% | 78.6% | 50.0% |
| without fed_rate_vs_last_term | 15.8% | -0.8 | 21.9% | -0.6 | 100.0% | 75.0% | 100.0% | 58.3% | 71.4% | 42.9% |
| without enrolment_change | 16.7% | +0.0 | 19.4% | -3.1 | 100.0% | 75.0% | 61.3% | 66.7% | 78.6% | 50.0% |
| without uptake | 15.8% | -0.8 | 21.9% | -0.6 | 100.0% | 75.0% | 100.0% | 58.3% | 71.4% | 42.9% |
| without cereal_ratio | 16.1% | -0.6 | 22.8% | +0.3 | 100.0% | 75.0% | 100.0% | 75.0% | 78.6% | 42.9% |
| without pulse_ratio | 15.6% | -1.1 | 22.5% | +0.0 | 100.0% | 68.8% | 100.0% | 66.7% | 78.6% | 50.0% |
| without usage_trend | 15.3% | -1.4 | 22.2% | -0.3 | 100.0% | 68.8% | 100.0% | 58.3% | 78.6% | 50.0% |
| without count_gap_change | 15.8% | -0.8 | 20.8% | -1.7 | 100.0% | 75.0% | 100.0% | 58.3% | 78.6% | 0.0% |
| without entry_delay | 16.1% | -0.6 | 22.5% | +0.0 | 100.0% | 75.0% | 100.0% | 66.7% | 78.6% | 42.9% |
| without entry_batch | 15.6% | -1.1 | 22.8% | +0.3 | 100.0% | 75.0% | 100.0% | 75.0% | 78.6% | 42.9% |
| without after_hours_share | 16.4% | -0.3 | 22.8% | +0.3 | 100.0% | 75.0% | 100.0% | 66.7% | 78.6% | 50.0% |
| without round_share | 15.8% | -0.8 | 20.6% | -1.9 | 100.0% | 75.0% | 100.0% | 75.0% | 14.3% | 50.0% |
| without fed_steadiness | 14.7% | -1.9 | 22.8% | +0.3 | 100.0% | 75.0% | 100.0% | 75.0% | 78.6% | 42.9% |
| without the entry timing group | 17.2% | +0.5 | 21.9% | -0.6 | 78.6% | 75.0% | 100.0% | 66.7% | 85.7% | 42.9% |
| without the made up figures group | 13.9% | -2.8 | 20.0% | -2.5 | 100.0% | 75.0% | 100.0% | 58.3% | 14.3% | 50.0% |
| without the headcount group | 16.4% | -0.3 | 22.8% | +0.3 | 100.0% | 75.0% | 100.0% | 66.7% | 78.6% | 50.0% |
| without the food group | 12.2% | -4.5 | 20.3% | -2.2 | 100.0% | 12.5% | 100.0% | 75.0% | 78.6% | 50.0% |

## Example review-list entries (Extended Isolation Forest)

| School | Date | Injected anomaly | What the officer sees |
|---|---|---|---|
| S19 | 2026-08-24 | backdated_bulk_entry | Needs review: 28 dates entered in the same sitting; 80% of the school's recent records entered outside school hours |
| S19 | 2026-07-31 | backdated_bulk_entry | Needs review: 28 dates entered in the same sitting; 70% of the school's recent records entered outside school hours |
| S10 | 2026-03-06 | backdated_bulk_entry | Needs review: 17 dates entered in the same sitting; 50% of the school's recent records entered outside school hours |
| S24 | 2026-07-27 | backdated_bulk_entry | Needs review: 40% of the school's recent records entered outside school hours; enrolment 1% down on last term (431 learners) |
| S23 | 2026-07-30 | none | Needs review: enrolment 29% down on last term (558 learners); entered 2 school days after the date |
| S23 | 2026-06-08 | none | Needs review: enrolment 29% down on last term (558 learners); pulses issued at 1.07 times the ration for learners fed |

These results are on synthetic data with injected anomalies, so they show how the methods compare under the stated assumptions, not how often they would be right at real schools.
