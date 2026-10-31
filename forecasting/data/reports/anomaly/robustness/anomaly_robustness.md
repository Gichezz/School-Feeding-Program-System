# Anomaly detection: robustness study

Plan: [`forecasting\config\anomaly_robustness.yaml`](../../../../config/anomaly_robustness.yaml), committed before it was run. 18 runs: 6 data scenarios × 3 seeds, each generated afresh and evaluated with the unchanged protocol (same methods, tuning grid, periods, held-out anomaly types, metric and decision rule).

**One-class SVM is robustly best: best average rank, and recommended or tied with the recommended method in 18 of 18 runs.**

## Across all runs

| Method | Average rank | Precision@k (mean) | Range | Share of best possible | F1 | Recall, held-out types | Recommended (of 18) | Recommended or tied (of 18) |
|---|---|---|---|---|---|---|---|---|
| One-class SVM | 1.22 | 25.0% | 19.7% – 37.8% | 74.9% | 41.5% | 86.7% | 14 | 18 |
| Local Outlier Factor | 2.03 | 23.2% | 19.7% – 32.2% | 70.0% | 36.8% | 88.6% | 3 | 12 |
| Isolation Forest | 3.39 | 20.9% | 14.2% – 31.7% | 62.4% | 28.5% | 54.9% | 1 | 3 |
| Autoencoder | 3.58 | 19.9% | 15.3% – 25.6% | 59.8% | 33.9% | 67.9% | 0 | 5 |
| Fixed rules | 5.19 | 13.8% | 8.6% – 16.7% | 41.9% | 28.6% | 39.6% | 0 | 0 |
| Robust z-score | 5.58 | 13.3% | 10.6% – 17.2% | 40.2% | 19.1% | 42.9% | 0 | 0 |

Rank is by precision@k within each run (1 = best). "Share of best possible" divides precision@k by the most any method could reach in that run, given how many school-weeks contain an anomaly.

## Average rank by scenario

| Method | baseline | noisier_days | subtle_anomalies | larger_programme | fortnightly_counts | irregular_entry |
|---|---|---|---|---|---|---|
| One-class SVM | 1.3 | 1.3 | 1.3 | 1.0 | 1.3 | 1.0 |
| Local Outlier Factor | 2.0 | 1.7 | 2.0 | 2.3 | 1.8 | 2.3 |
| Isolation Forest | 3.0 | 4.7 | 3.0 | 3.0 | 3.3 | 3.3 |
| Autoencoder | 3.7 | 3.7 | 3.7 | 3.7 | 3.5 | 3.3 |
| Fixed rules | 5.5 | 4.0 | 5.3 | 5.7 | 5.0 | 5.7 |
| Robust z-score | 5.5 | 5.7 | 5.7 | 5.3 | 6.0 | 5.3 |

Scenarios: **baseline**: The main dataset's assumptions, with new seeds; **noisier_days**: More day-to-day variation in learners fed (upper end of what real schools show); **subtle_anomalies**: Every anomaly half as strong, so harder to see; **larger_programme**: Twice as many schools (80 in 8 sub-counties), the same number of anomaly episodes per school; **fortnightly_counts**: Store counted every 10 school days instead of 20; **irregular_entry**: Schools that often enter late and sync rarely, so ordinary records look more like backdating.

All runs use synthetic data, so the study shows how stable the comparison is under different assumptions, not how the methods would do at real schools.
