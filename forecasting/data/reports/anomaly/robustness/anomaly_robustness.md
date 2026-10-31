# Anomaly detection: robustness study

Plan: [`forecasting\config\anomaly_robustness.yaml`](../../../../config/anomaly_robustness.yaml), committed before it was run. 18 runs: 6 data scenarios × 3 seeds, each generated afresh and evaluated with the unchanged protocol (same methods, tuning grid, periods, held-out anomaly types, metric and decision rule).

**One-class SVM is robustly best: best average rank, and recommended or tied with the recommended method in 14 of 18 runs.**

## Across all runs

| Method | Average rank | Precision@k (mean) | Range | Share of best possible | F1 | Recall, held-out types | Recommended (of 18) | Recommended or tied (of 18) |
|---|---|---|---|---|---|---|---|---|
| One-class SVM | 1.17 | 16.2% | 10.6% – 24.2% | 66.5% | 31.0% | 84.8% | 13 | 14 |
| Local Outlier Factor | 2.56 | 14.4% | 10.3% – 18.3% | 59.9% | 26.0% | 85.8% | 0 | 9 |
| Isolation Forest | 2.58 | 14.1% | 9.2% – 20.6% | 58.6% | 22.6% | 73.8% | 1 | 7 |
| Autoencoder | 4.42 | 12.1% | 5.6% – 20.3% | 49.3% | 25.2% | 69.2% | 0 | 3 |
| Robust z-score | 4.53 | 11.9% | 8.9% – 15.8% | 49.7% | 18.0% | 82.0% | 4 | 4 |
| Fixed rules | 5.75 | 9.4% | 5.6% – 14.7% | 38.5% | 23.0% | 65.1% | 0 | 0 |

Rank is by precision@k within each run (1 = best). "Share of best possible" divides precision@k by the most any method could reach in that run, given how many school-weeks contain an anomaly.

## Average rank by scenario

| Method | baseline | noisier_days | subtle_anomalies | larger_programme | fortnightly_counts | irregular_entry |
|---|---|---|---|---|---|---|
| One-class SVM | 1.0 | 1.7 | 1.0 | 1.0 | 1.3 | 1.0 |
| Local Outlier Factor | 2.7 | 2.0 | 2.0 | 3.3 | 3.0 | 2.3 |
| Isolation Forest | 2.5 | 2.8 | 3.0 | 2.8 | 1.7 | 2.7 |
| Autoencoder | 4.0 | 5.3 | 4.8 | 3.0 | 4.7 | 4.7 |
| Robust z-score | 5.0 | 3.5 | 4.3 | 5.3 | 4.3 | 4.7 |
| Fixed rules | 5.8 | 5.7 | 5.8 | 5.5 | 6.0 | 5.7 |

Scenarios: **baseline**: The main dataset's assumptions, with new seeds; **noisier_days**: More day-to-day variation in learners fed (upper end of what real schools show); **subtle_anomalies**: Every anomaly half as strong, so harder to see; **larger_programme**: Twice as many schools (80 in 8 sub-counties), the same number of anomaly episodes per school; **fortnightly_counts**: Store counted every 10 school days instead of 20; **irregular_entry**: Schools that often enter late and sync rarely, so ordinary records look more like backdating.

All runs use synthetic data, so the study shows how stable the comparison is under different assumptions, not how the methods would do at real schools.
