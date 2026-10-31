# Anomaly detection: evaluation on synthetic school feeding records

Protocol: [`forecasting\config\anomaly_evaluation.yaml`](../../../config/anomaly_evaluation.yaml), committed before any method was run. Data: 40 synthetic schools ([generator](../../../scripts/generate_feeding_dataset.py)); tuning period 13,600 school-days (588 anomalous, tuning types only), test period 6,760 school-days (417 anomalous, every type). The held-out types (backdated_bulk_entry, round_number_entry, ghost_learners) never appear before the test run.

The fixed rules flag a day when it breaks at least one rule, as the protocol sets; their threshold is not tuned.

## Weekly review list (primary metric: precision@10)

Each week, the 10 school-weeks with the highest scores across the programme. Precision@10 is the share of them that really contain an anomaly; the interval is a 1,000-sample bootstrap over weeks of the difference against the best method.

| Method | Precision@10 | Anomalous school-weeks listed | Difference from the best (points, 95% interval) |
|---|---|---|---|
| Fixed rules | 12.8% | 46.0% | -7.8 (-10.0 to -5.3) |
| Robust z-score | 14.7% | 53.0% | -5.8 (-8.3 to -3.3) |
| Isolation Forest | 20.0% | 72.0% | -0.6 (-1.7 to +0.8) |
| Extended Isolation Forest | 20.6% | 74.0% | +0.0 (+0.0 to +0.0) |
| One-class SVM | 20.6% | 74.0% | +0.0 (-1.7 to +1.7) |
| Local Outlier Factor | 17.8% | 64.0% | -2.8 (-5.3 to -0.3) |

**Recommended under the decision rule: One-class SVM** (best precision@10: Extended Isolation Forest; among learned methods not distinguishable from the best, the rule prefers the fastest to fit on 50,000 rows). Not distinguishable from it at 95%: Isolation Forest, One-class SVM.

The best precision@10 any method could reach is 27.8%: most weeks have fewer than 10 school-weeks with an anomaly, so a full list must include some ordinary ones. Precision@10 is therefore best read against that ceiling, together with the share of anomalous school-weeks that make the list.

## School-day flags (threshold chosen on the tuning period)

| Method | Precision | Recall | F1 | Recall, held-out types | False flags per 1,000 ordinary days |
|---|---|---|---|---|---|
| Fixed rules | 52.6% | 43.9% | 47.8% | 63.1% | 26.0 |
| Robust z-score | 23.8% | 47.2% | 31.7% | 59.7% | 99.2 |
| Isolation Forest | 35.4% | 52.8% | 42.4% | 63.5% | 63.2 |
| Extended Isolation Forest | 48.7% | 55.6% | 52.0% | 71.1% | 38.5 |
| One-class SVM | 38.8% | 72.4% | 50.5% | 95.8% | 75.0 |
| Local Outlier Factor | 20.5% | 68.6% | 31.6% | 95.4% | 174.4 |

## Recall by anomaly type (test)

| Method | backdated_bulk_entry (held out) | consumption_drift | ghost_learners (held out) | inflated_headcount | round_number_entry (held out) | stock_leakage |
|---|---|---|---|---|---|---|
| Fixed rules | 100.0% | 22.6% | 71.0% | 2.1% | 1.8% | 4.5% |
| Robust z-score | 100.0% | 58.1% | 35.8% | 4.2% | 80.0% | 4.5% |
| Isolation Forest | 100.0% | 46.8% | 58.1% | 37.5% | 38.2% | 13.6% |
| Extended Isolation Forest | 100.0% | 50.0% | 71.6% | 20.8% | 38.2% | 9.1% |
| One-class SVM | 100.0% | 51.6% | 100.0% | 37.5% | 80.0% | 0.0% |
| Local Outlier Factor | 100.0% | 21.0% | 99.3% | 35.4% | 80.0% | 11.4% |

Stock leakage leaves a trace only on days the store is counted (6 such days in the test period). Recall on those days: Fixed rules 16.7%; Robust z-score 33.3%; Isolation Forest 100.0%; Extended Isolation Forest 66.7%; One-class SVM 0.0%; Local Outlier Factor 33.3%.

## Settings chosen on the tuning period

| Method | Setting | Tuning F1 |
|---|---|---|
| Fixed rules | fixed | 0.071 |
| Robust z-score | history_days=80 | 0.212 |
| Isolation Forest | n_estimators=100, max_samples=1024 | 0.279 |
| Extended Isolation Forest | n_estimators=100, ndim=2 | 0.269 |
| One-class SVM | nu=0.05, gamma=scale | 0.282 |
| Local Outlier Factor | n_neighbors=50 | 0.132 |

## Time to fit and score

Seconds to fit the chosen setting on n school-days, and to score 5,000. The one-class SVM fits on a sample of 5,000 rows and Isolation Forest on its max_samples, so their fitting time levels off by design.

| Method | Fit, 5,000 rows | Fit, 20,000 rows | Fit, 50,000 rows | Score 5,000 rows |
|---|---|---|---|---|
| Fixed rules | 0.00 | 0.00 | 0.00 | 0.00 |
| Robust z-score | 0.01 | 0.03 | 0.06 | 0.31 |
| Isolation Forest | 0.14 | 0.18 | 0.28 | 0.03 |
| Extended Isolation Forest | 0.10 | 0.12 | 0.14 | 0.13 |
| One-class SVM | 0.08 | 0.09 | 0.11 | 0.09 |
| Local Outlier Factor | 0.58 | 8.32 | 42.87 | 4.12 |

## Example review-list entries (One-class SVM)

| School | Date | Injected anomaly | What the officer sees |
|---|---|---|---|
| S19 | 2026-07-23 | backdated_bulk_entry | Needs review: 32 different dates sent together in one sync; entered 21 school days after the date |
| S19 | 2026-07-17 | backdated_bulk_entry | Needs review: 32 different dates sent together in one sync; entered 25 school days after the date |
| S19 | 2026-07-27 | backdated_bulk_entry | Needs review: 32 different dates sent together in one sync; entered 19 school days after the date |
| S19 | 2026-07-10 | backdated_bulk_entry | Needs review: 32 different dates sent together in one sync; entered 30 school days after the date |
| S19 | 2026-09-04 | none | Needs review: 32 different dates sent together in one sync; round numbers on 71% of recent days |
| S19 | 2026-09-08 | none | Needs review: 32 different dates sent together in one sync; round numbers on 57% of recent days |

These results are on synthetic data with injected anomalies, so they show how the methods compare under the stated assumptions, not how often they would be right at real schools.
