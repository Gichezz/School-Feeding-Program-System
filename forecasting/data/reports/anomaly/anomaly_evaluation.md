# Anomaly detection: evaluation on synthetic school feeding records

Protocol: [`forecasting\config\anomaly_evaluation.yaml`](../../../config/anomaly_evaluation.yaml) version 6, committed before it was run; what changed from each earlier version, and why, is recorded in the protocol. Data: 40 synthetic schools ([generator](../../../scripts/generate_feeding_dataset.py)); tuning period 13,600 school-days (588 anomalous, tuning types only), test period 6,760 school-days (417 anomalous, every type). The held-out types (backdated_bulk_entry, round_number_entry, ghost_learners) never appear before the test run.

The fixed rules flag a day when it breaks at least one rule, as the protocol sets; their threshold is not tuned.

## Weekly review list (primary metric: precision@10)

Each week, the 10 school-weeks with the highest scores across the programme. Precision@10 is the share of them that really contain an anomaly; the interval is a 1,000-sample bootstrap over weeks of the difference against the best method.

| Method | Precision@10 | Anomalous school-weeks listed | Difference from the best (points, 95% interval) |
|---|---|---|---|
| Fixed rules | 12.8% | 46.0% | -8.3 (-11.1 to -5.6) |
| Robust z-score | 15.3% | 55.0% | -5.8 (-8.1 to -3.6) |
| Isolation Forest | 18.6% | 67.0% | -2.5 (-3.9 to -0.8) |
| Extended Isolation Forest | 21.1% | 76.0% | +0.0 (+0.0 to +0.0) |
| One-class SVM | 20.0% | 72.0% | -1.1 (-2.8 to +0.6) |
| SGD one-class SVM | 18.9% | 68.0% | -2.2 (-3.9 to -0.6) |
| Local Outlier Factor | 18.9% | 68.0% | -2.2 (-4.7 to +0.0) |

**Recommended under the decision rule: One-class SVM** (best precision@10: Extended Isolation Forest; among learned methods not distinguishable from the best, the rule prefers the fastest to fit on 50,000 rows). Not distinguishable from it at 95%: Local Outlier Factor, One-class SVM.

The best precision@10 any method could reach is 27.8%: most weeks have fewer than 10 school-weeks with an anomaly, so a full list must include some ordinary ones. Precision@10 is therefore best read against that ceiling, together with the share of anomalous school-weeks that make the list.

## School-day flags (threshold chosen on the selection year, 2025)

| Method | Precision | Recall | F1 | Recall, held-out types | False flags per 1,000 ordinary days |
|---|---|---|---|---|---|
| Fixed rules | 52.2% | 43.2% | 47.2% | 63.1% | 26.0 |
| Robust z-score | 41.1% | 44.6% | 42.8% | 55.5% | 41.9 |
| Isolation Forest | 36.2% | 57.3% | 44.4% | 65.4% | 66.4 |
| Extended Isolation Forest | 40.8% | 67.6% | 50.9% | 82.5% | 64.5 |
| One-class SVM | 52.2% | 59.5% | 55.6% | 76.8% | 35.8 |
| SGD one-class SVM | 49.5% | 59.7% | 54.1% | 77.2% | 40.0 |
| Local Outlier Factor | 37.1% | 64.5% | 47.1% | 95.4% | 71.9 |

## Recall by anomaly type (test)

| Method | backdated_bulk_entry (held out) | consumption_drift | ghost_learners (held out) | inflated_headcount | round_number_entry (held out) | stock_leakage |
|---|---|---|---|---|---|---|
| Fixed rules | 100.0% | 17.7% | 71.0% | 2.1% | 1.8% | 4.5% |
| Robust z-score | 100.0% | 58.1% | 28.4% | 4.2% | 80.0% | 4.5% |
| Isolation Forest | 98.3% | 64.5% | 68.2% | 47.9% | 21.8% | 9.1% |
| Extended Isolation Forest | 100.0% | 61.3% | 87.8% | 43.8% | 49.1% | 13.6% |
| One-class SVM | 100.0% | 67.7% | 73.0% | 8.3% | 61.8% | 0.0% |
| SGD one-class SVM | 100.0% | 67.7% | 74.3% | 8.3% | 60.0% | 0.0% |
| Local Outlier Factor | 100.0% | 4.8% | 100.0% | 29.2% | 78.2% | 2.3% |

Stock leakage leaves a trace only on days the store is counted (6 such days in the test period). Recall on those days: Fixed rules 16.7%; Robust z-score 33.3%; Isolation Forest 66.7%; Extended Isolation Forest 100.0%; One-class SVM 0.0%; SGD one-class SVM 0.0%; Local Outlier Factor 16.7%.

## Settings chosen on the selection year (fitted on 2024, judged on 2025)

| Method | Setting | F1 on 2025 |
|---|---|---|
| Fixed rules | fixed | 0.074 |
| Robust z-score | history_days=80 | 0.274 |
| Isolation Forest | n_estimators=500, max_samples=256 | 0.329 |
| Extended Isolation Forest | n_estimators=300, ndim=2 | 0.342 |
| One-class SVM | nu=0.1, gamma_factor=0.3 | 0.321 |
| SGD one-class SVM | nu=0.1, n_components=100 | 0.320 |
| Local Outlier Factor | n_neighbors=100 | 0.306 |

## Time to fit and score

Seconds to fit the chosen setting on n school-days, and to score 5,000. The one-class SVM fits on a sample of 5,000 rows and Isolation Forest on its max_samples, so their fitting time levels off by design.

| Method | Fit, 5,000 rows | Fit, 20,000 rows | Fit, 50,000 rows | Score 5,000 rows |
|---|---|---|---|---|
| Fixed rules | 0.00 | 0.00 | 0.00 | 0.00 |
| Robust z-score | 0.02 | 0.04 | 0.07 | 0.40 |
| Isolation Forest | 0.86 | 1.27 | 1.43 | 0.15 |
| Extended Isolation Forest | 0.40 | 0.57 | 0.59 | 0.86 |
| One-class SVM | 0.19 | 0.17 | 0.21 | 0.18 |
| SGD one-class SVM | 0.04 | 0.13 | 0.33 | 0.03 |
| Local Outlier Factor | 0.88 | 10.96 | 64.73 | 5.64 |

## Example review-list entries (One-class SVM)

| School | Date | Injected anomaly | What the officer sees |
|---|---|---|---|
| S19 | 2026-07-23 | backdated_bulk_entry | Needs review: 32 dates sent together in one sync; entered 21 school days after the date |
| S19 | 2026-07-17 | backdated_bulk_entry | Needs review: 32 dates sent together in one sync; entered 25 school days after the date |
| S19 | 2026-07-27 | backdated_bulk_entry | Needs review: 32 dates sent together in one sync; entered 19 school days after the date |
| S19 | 2026-08-24 | backdated_bulk_entry | Needs review: 32 dates sent together in one sync; 80% of the school's recent records entered outside school hours |
| S10 | 2026-07-31 | none | Needs review: food issued per learner up 16% on the weeks before; cereals issued at 0.59 times the ration for learners fed |
| S19 | 2026-09-04 | none | Needs review: 32 dates sent together in one sync; round numbers on 71% of recent days |

These results are on synthetic data with injected anomalies, so they show how the methods compare under the stated assumptions, not how often they would be right at real schools.
