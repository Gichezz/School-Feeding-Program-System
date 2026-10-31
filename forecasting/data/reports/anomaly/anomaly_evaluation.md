# Anomaly detection: evaluation on synthetic school feeding records

Protocol: [`forecasting\config\anomaly_evaluation.yaml`](../../../config/anomaly_evaluation.yaml), committed before any method was run. Data: 40 synthetic schools ([generator](../../../scripts/generate_feeding_dataset.py)); tuning period 13,600 school-days (588 anomalous, tuning types only), test period 6,760 school-days (417 anomalous, every type). The held-out types (backdated_bulk_entry, round_number_entry, ghost_learners) never appear before the test run.

The fixed rules flag a day when it breaks at least one rule, as the protocol sets; their threshold is not tuned.

## Weekly review list (primary metric: precision@10)

Each week, the 10 school-weeks with the highest scores across the programme. Precision@10 is the share of them that really contain an anomaly; the interval is a 1,000-sample bootstrap over weeks of the difference against the best method.

| Method | Precision@10 | Anomalous school-weeks listed | Difference from the best (points, 95% interval) |
|---|---|---|---|
| Fixed rules | 12.8% | 46.0% | -7.5 (-10.8 to -4.4) |
| Robust z-score | 13.3% | 48.0% | -7.0 (-10.0 to -4.2) |
| Isolation Forest | 18.1% | 65.0% | -2.2 (-4.7 to +0.0) |
| Local Outlier Factor | 20.3% | 73.0% | +0.0 (+0.0 to +0.0) |
| One-class SVM | 19.7% | 71.0% | -0.6 (-2.2 to +0.8) |
| Autoencoder | 19.7% | 71.0% | -0.6 (-2.5 to +1.7) |

**Recommended under the decision rule: Local Outlier Factor** (best precision@10: Local Outlier Factor). Not distinguishable from it at 95%: Autoencoder, Isolation Forest, One-class SVM.

The best precision@10 any method could reach is 27.8%: most weeks have fewer than 10 school-weeks with an anomaly, so a full list must include some ordinary ones. Precision@10 is therefore best read against that ceiling, together with the share of anomalous school-weeks that make the list.

## School-day flags (threshold chosen on the tuning period)

| Method | Precision | Recall | F1 | Recall, held-out types | False flags per 1,000 ordinary days |
|---|---|---|---|---|---|
| Fixed rules | 52.6% | 43.9% | 47.8% | 63.1% | 26.0 |
| Robust z-score | 15.4% | 48.0% | 23.3% | 56.6% | 173.7 |
| Isolation Forest | 29.4% | 31.2% | 30.3% | 38.0% | 49.2 |
| Local Outlier Factor | 21.0% | 71.9% | 32.5% | 95.8% | 178.0 |
| One-class SVM | 38.5% | 71.7% | 50.1% | 96.2% | 75.2 |
| Autoencoder | 33.7% | 67.4% | 44.9% | 97.3% | 87.3 |

## Recall by anomaly type (test)

| Method | backdated_bulk_entry (held out) | consumption_drift | ghost_learners (held out) | inflated_headcount | round_number_entry (held out) | stock_leakage |
|---|---|---|---|---|---|---|
| Fixed rules | 100.0% | 22.6% | 71.0% | 2.1% | 1.8% | 4.5% |
| Robust z-score | 100.0% | 53.2% | 36.5% | 8.3% | 63.6% | 31.8% |
| Isolation Forest | 90.0% | 29.0% | 22.3% | 20.8% | 23.6% | 4.5% |
| Local Outlier Factor | 100.0% | 30.6% | 99.3% | 37.5% | 81.8% | 25.0% |
| One-class SVM | 100.0% | 41.9% | 100.0% | 41.7% | 81.8% | 0.0% |
| Autoencoder | 100.0% | 4.8% | 100.0% | 41.7% | 87.3% | 4.5% |

Stock leakage leaves a trace only on days the store is counted (6 such days in the test period). Recall on those days: Fixed rules 16.7%; Robust z-score 33.3%; Isolation Forest 33.3%; Local Outlier Factor 33.3%; One-class SVM 0.0%; Autoencoder 16.7%.

## Settings chosen on the tuning period

| Method | Setting | Tuning F1 |
|---|---|---|
| Fixed rules | fixed | 0.071 |
| Robust z-score | history_days=80 | 0.130 |
| Isolation Forest | n_estimators=100, max_samples=1024 | 0.210 |
| Local Outlier Factor | n_neighbors=50 | 0.171 |
| One-class SVM | nu=0.05, gamma=scale | 0.278 |
| Autoencoder | hidden=[8] | 0.175 |

## Example review-list entries (Local Outlier Factor)

| School | Date | Injected anomaly | What the officer sees |
|---|---|---|---|
| S19 | 2026-07-07 | backdated_bulk_entry | Needs review: 0 learners fed of 806 enrolled (0%); 32 different dates sent together in one sync |
| S19 | 2026-07-23 | backdated_bulk_entry | Needs review: 32 different dates sent together in one sync; entered 21 school days after the date |
| S19 | 2026-07-17 | backdated_bulk_entry | Needs review: 32 different dates sent together in one sync; entered 25 school days after the date |
| S19 | 2026-07-01 | backdated_bulk_entry | Needs review: 32 different dates sent together in one sync; entered 37 school days after the date |
| S19 | 2026-09-10 | none | Needs review: 32 different dates sent together in one sync; learners fed 2% above the school's usual number |
| S10 | 2026-05-04 | none | Needs review: 22 different dates sent together in one sync; almost the same number of learners fed day after day |

These results are on synthetic data with injected anomalies, so they show how the methods compare under the stated assumptions, not how often they would be right at real schools.
