# Anomaly detection: robustness study

Plan: [`forecasting\config\anomaly_robustness.yaml`](../../../../config/anomaly_robustness.yaml), committed before it was run. 21 runs: 7 data scenarios × 3 seeds, each generated afresh and evaluated with the unchanged protocol (same methods, tuning grid, periods, held-out anomaly types, metric and decision rule).

**No single method is robustly best. Extended Isolation Forest has the best average rank but is recommended or tied with the recommended method in only 3 of 21 runs.**

## Across all runs

| Method | Average rank | Precision@k (mean) | Range | Share of best possible | F1 | Recall, held-out types | Recommended (of 21) | Recommended or tied (of 21) |
|---|---|---|---|---|---|---|---|---|
| Extended Isolation Forest | 1.43 | 24.6% | 19.2% – 36.1% | 74.5% | 45.0% | 59.0% | 2 | 3 |
| SGD one-class SVM | 2.21 | 23.9% | 19.7% – 36.7% | 72.3% | 47.5% | 68.7% | 7 | 7 |
| One-class SVM | 3.55 | 23.0% | 17.2% – 34.4% | 69.6% | 44.7% | 59.6% | 10 | 10 |
| Isolation Forest | 3.83 | 22.5% | 16.4% – 32.5% | 68.2% | 37.7% | 50.8% | 0 | 0 |
| Local Outlier Factor | 4.19 | 22.0% | 17.2% – 31.4% | 66.9% | 42.3% | 83.0% | 0 | 0 |
| Robust z-score | 5.86 | 18.0% | 13.3% – 21.7% | 54.9% | 33.3% | 50.6% | 2 | 2 |
| Fixed rules | 6.93 | 14.2% | 8.3% – 16.7% | 43.4% | 32.6% | 35.3% | 0 | 0 |

Rank is by precision@k within each run (1 = best). "Share of best possible" divides precision@k by the most any method could reach in that run, given how many school-weeks contain an anomaly.

## Average rank by scenario

| Method | baseline | noisier_days | subtle_anomalies | larger_programme | fortnightly_counts | connectivity_outages | irregular_entry |
|---|---|---|---|---|---|---|---|
| Extended Isolation Forest | 1.3 | 2.0 | 1.5 | 1.7 | 1.2 | 1.3 | 1.0 |
| SGD one-class SVM | 1.7 | 2.7 | 2.7 | 1.5 | 1.8 | 1.7 | 3.5 |
| One-class SVM | 3.7 | 3.0 | 3.8 | 3.3 | 3.2 | 3.7 | 4.2 |
| Isolation Forest | 3.7 | 5.5 | 3.7 | 3.5 | 4.2 | 3.7 | 2.7 |
| Local Outlier Factor | 4.7 | 2.3 | 4.0 | 5.0 | 5.0 | 4.7 | 3.7 |
| Robust z-score | 6.0 | 5.7 | 5.3 | 6.0 | 5.7 | 6.0 | 6.3 |
| Fixed rules | 7.0 | 6.8 | 7.0 | 7.0 | 7.0 | 7.0 | 6.7 |

Scenarios: **baseline**: The main dataset's assumptions, with new seeds; **noisier_days**: More day-to-day variation in learners fed (upper end of what real schools show); **subtle_anomalies**: Every anomaly half as strong, so harder to see; **larger_programme**: Twice as many schools (80 in 8 sub-counties), the same number of anomaly episodes per school; **fortnightly_counts**: Store counted every 10 school days instead of 20; **connectivity_outages**: Version 7 - outages twice as common and up to five weeks long, so many honest records arrive late and together; **irregular_entry**: Schools that often enter late and sync rarely, so ordinary records look more like backdating.

All runs use synthetic data, so the study shows how stable the comparison is under different assumptions, not how the methods would do at real schools.
