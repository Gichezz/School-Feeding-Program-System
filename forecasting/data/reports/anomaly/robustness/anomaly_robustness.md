# Anomaly detection: robustness study

Plan: [`forecasting\config\anomaly_robustness.yaml`](../../../../config/anomaly_robustness.yaml), committed before it was run. 18 runs: 6 data scenarios × 3 seeds, each generated afresh and evaluated with the unchanged protocol (same methods, tuning grid, periods, held-out anomaly types, metric and decision rule).

**No single method is robustly best. Extended Isolation Forest has the best average rank but is recommended or tied with the recommended method in only 6 of 18 runs.**

## Across all runs

| Method | Average rank | Precision@k (mean) | Range | Share of best possible | F1 | Recall, held-out types | Recommended (of 18) | Recommended or tied (of 18) |
|---|---|---|---|---|---|---|---|---|
| Extended Isolation Forest | 1.69 | 24.3% | 19.2% – 34.7% | 72.6% | 46.3% | 62.3% | 3 | 6 |
| SGD one-class SVM | 2.78 | 23.2% | 18.9% – 35.3% | 69.4% | 47.6% | 67.8% | 6 | 8 |
| Local Outlier Factor | 3.39 | 22.7% | 17.8% – 33.3% | 68.3% | 44.3% | 84.2% | 0 | 4 |
| Isolation Forest | 3.42 | 22.7% | 18.1% – 33.6% | 68.1% | 40.8% | 50.6% | 0 | 3 |
| One-class SVM | 3.81 | 22.2% | 17.5% – 31.1% | 66.6% | 45.9% | 61.7% | 8 | 8 |
| Robust z-score | 6.03 | 17.7% | 14.4% – 20.6% | 53.6% | 33.8% | 51.7% | 1 | 1 |
| Fixed rules | 6.89 | 13.7% | 8.3% – 16.7% | 41.5% | 28.5% | 39.5% | 0 | 0 |

Rank is by precision@k within each run (1 = best). "Share of best possible" divides precision@k by the most any method could reach in that run, given how many school-weeks contain an anomaly.

## Average rank by scenario

| Method | baseline | noisier_days | subtle_anomalies | larger_programme | fortnightly_counts | irregular_entry |
|---|---|---|---|---|---|---|
| Extended Isolation Forest | 1.5 | 3.0 | 2.0 | 1.3 | 1.0 | 1.3 |
| SGD one-class SVM | 1.8 | 3.3 | 2.2 | 2.0 | 3.7 | 3.7 |
| Local Outlier Factor | 3.3 | 1.5 | 3.0 | 4.7 | 4.3 | 3.5 |
| Isolation Forest | 3.7 | 5.2 | 3.7 | 3.0 | 3.2 | 1.8 |
| One-class SVM | 4.7 | 2.2 | 4.2 | 4.0 | 3.2 | 4.7 |
| Robust z-score | 6.3 | 6.2 | 6.0 | 6.0 | 5.7 | 6.0 |
| Fixed rules | 6.7 | 6.7 | 7.0 | 7.0 | 7.0 | 7.0 |

Scenarios: **baseline**: The main dataset's assumptions, with new seeds; **noisier_days**: More day-to-day variation in learners fed (upper end of what real schools show); **subtle_anomalies**: Every anomaly half as strong, so harder to see; **larger_programme**: Twice as many schools (80 in 8 sub-counties), the same number of anomaly episodes per school; **fortnightly_counts**: Store counted every 10 school days instead of 20; **irregular_entry**: Schools that often enter late and sync rarely, so ordinary records look more like backdating.

All runs use synthetic data, so the study shows how stable the comparison is under different assumptions, not how the methods would do at real schools.
