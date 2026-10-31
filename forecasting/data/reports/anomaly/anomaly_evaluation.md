# Anomaly detection: evaluation on synthetic school feeding records

Protocol: [`forecasting\config\anomaly_evaluation.yaml`](../../../config/anomaly_evaluation.yaml), committed before any method was run. Data: 40 synthetic schools ([generator](../../../scripts/generate_feeding_dataset.py)); tuning period 13,600 school-days (512 anomalous, tuning types only), test period 6,760 school-days (322 anomalous, every type). The held-out types (backdated_bulk_entry, round_number_entry) never appear before the test run.

## Weekly review list (primary metric: precision@10)

Each week, the 10 school-weeks with the highest scores across the programme. Precision@10 is the share of them that really contain an anomaly; the interval is a 1,000-sample bootstrap over weeks of the difference against the best method.

| Method | Precision@10 | Anomalous school-weeks listed | Difference from the best (points, 95% interval) |
|---|---|---|---|
| Fixed rules | 12.5% | 53.6% | -5.3 (-8.1 to -2.8) |
| Robust z-score | 14.4% | 61.9% | -3.3 (-5.8 to -1.1) |
| Isolation Forest | 17.2% | 73.8% | -0.6 (-2.2 to +0.8) |
| Local Outlier Factor | 15.8% | 67.9% | -1.9 (-3.9 to +0.3) |
| One-class SVM | 17.8% | 76.2% | +0.0 (+0.0 to +0.0) |
| Autoencoder | 13.6% | 58.3% | -4.2 (-6.7 to -1.7) |

**Recommended under the decision rule: One-class SVM** (best precision@10: One-class SVM). Not distinguishable from it at 95%: Isolation Forest, Local Outlier Factor.

The best precision@10 any method could reach is 23.3%: most weeks have fewer than 10 school-weeks with an anomaly, so a full list must include some ordinary ones. Precision@10 is therefore best read against that ceiling, together with the share of anomalous school-weeks that make the list.

## School-day flags (threshold chosen on the tuning period)

| Method | Precision | Recall | F1 | Recall, held-out types | False flags per 1,000 ordinary days |
|---|---|---|---|---|---|
| Fixed rules | 29.6% | 27.0% | 28.2% | 50.0% | 32.2 |
| Robust z-score | 12.9% | 56.2% | 20.9% | 87.5% | 190.3 |
| Isolation Forest | 26.7% | 35.7% | 30.6% | 55.9% | 48.9 |
| Local Outlier Factor | 19.3% | 54.7% | 28.6% | 89.0% | 114.0 |
| One-class SVM | 27.0% | 57.5% | 36.7% | 89.0% | 77.8 |
| Autoencoder | 30.5% | 28.6% | 29.5% | 49.3% | 32.6 |

## Recall by anomaly type (test)

| Method | backdated_bulk_entry (held out) | consumption_drift | inflated_headcount | round_number_entry (held out) | stock_leakage |
|---|---|---|---|---|---|
| Fixed rules | 100.0% | 20.3% | 6.1% | 2.9% | 4.9% |
| Robust z-score | 100.0% | 55.9% | 36.4% | 75.7% | 8.2% |
| Isolation Forest | 93.9% | 25.4% | 30.3% | 20.0% | 6.6% |
| Local Outlier Factor | 100.0% | 33.9% | 43.9% | 78.6% | 9.8% |
| One-class SVM | 100.0% | 54.2% | 43.9% | 78.6% | 4.9% |
| Autoencoder | 98.5% | 13.6% | 16.7% | 2.9% | 9.8% |

Stock leakage leaves a trace only on days the store is counted (6 such days in the test period). Recall on those days: Fixed rules 50.0%; Robust z-score 50.0%; Isolation Forest 50.0%; Local Outlier Factor 83.3%; One-class SVM 33.3%; Autoencoder 83.3%.

## Settings chosen on the tuning period

| Method | Setting | Tuning F1 |
|---|---|---|
| Fixed rules | fixed | 0.129 |
| Robust z-score | history_days=80 | 0.118 |
| Isolation Forest | n_estimators=300, max_samples=1024 | 0.186 |
| Local Outlier Factor | n_neighbors=50 | 0.151 |
| One-class SVM | nu=0.05, gamma=scale | 0.257 |
| Autoencoder | hidden=[16, 8, 16] | 0.147 |

## Example review-list entries (One-class SVM)

| School | Date | Injected anomaly | What the officer sees |
|---|---|---|---|
| S23 | 2026-03-30 | backdated_bulk_entry | Needs review: 34 different dates sent together in one sync; entered 23 school days after the date |
| S23 | 2026-03-27 | backdated_bulk_entry | Needs review: 34 different dates sent together in one sync; entered 24 school days after the date |
| S23 | 2026-03-19 | backdated_bulk_entry | Needs review: 34 different dates sent together in one sync; entered 29 school days after the date |
| S23 | 2026-04-27 | backdated_bulk_entry | Needs review: 34 different dates sent together in one sync; entered 19 school days after the date |
| S28 | 2026-10-23 | none | Needs review: learners fed 62% below the school's usual number; cereals issued at 0.55 times the ration for learners fed |
| S23 | 2026-05-18 | none | Needs review: 34 different dates sent together in one sync; round numbers on 60% of recent days |

These results are on synthetic data with injected anomalies, so they show how the methods compare under the stated assumptions, not how often they would be right at real schools.
