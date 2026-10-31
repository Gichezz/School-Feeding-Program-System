# Anomaly detection: robustness study

Plan: [`forecasting\config\anomaly_robustness.yaml`](../../../../config/anomaly_robustness.yaml), committed before it was run. 18 runs: 6 data scenarios × 3 seeds, each generated afresh and evaluated with the unchanged protocol (same methods, tuning grid, periods, held-out anomaly types, metric and decision rule).

**One-class SVM is robustly best: best average rank, and recommended or tied with the recommended method in 17 of 18 runs.**

## Across all runs

| Method | Average rank | Precision@k (mean) | Range | Share of best possible | F1 | Recall, held-out types | Recommended (of 18) | Recommended or tied (of 18) |
|---|---|---|---|---|---|---|---|---|
| One-class SVM | 1.50 | 24.4% | 19.4% – 37.2% | 73.0% | 47.3% | 85.7% | 17 | 17 |
| Extended Isolation Forest | 1.86 | 23.9% | 20.0% – 32.5% | 71.8% | 45.1% | 60.9% | 0 | 7 |
| Isolation Forest | 3.28 | 22.1% | 16.7% – 32.8% | 66.3% | 39.8% | 57.0% | 0 | 4 |
| Local Outlier Factor | 3.56 | 21.2% | 17.8% – 27.2% | 64.1% | 30.4% | 88.7% | 0 | 3 |
| Robust z-score | 4.94 | 17.5% | 14.4% – 20.8% | 53.1% | 34.2% | 49.4% | 1 | 1 |
| Fixed rules | 5.86 | 13.8% | 8.6% – 16.7% | 41.9% | 28.6% | 39.6% | 0 | 0 |

Rank is by precision@k within each run (1 = best). "Share of best possible" divides precision@k by the most any method could reach in that run, given how many school-weeks contain an anomaly.

## Average rank by scenario

| Method | baseline | noisier_days | subtle_anomalies | larger_programme | fortnightly_counts | irregular_entry |
|---|---|---|---|---|---|---|
| One-class SVM | 1.3 | 1.7 | 1.7 | 1.3 | 1.3 | 1.7 |
| Extended Isolation Forest | 2.0 | 2.3 | 1.7 | 2.0 | 1.8 | 1.3 |
| Isolation Forest | 3.0 | 4.2 | 3.7 | 2.7 | 3.2 | 3.0 |
| Local Outlier Factor | 3.7 | 2.3 | 3.7 | 4.0 | 3.7 | 4.0 |
| Robust z-score | 5.3 | 5.0 | 4.3 | 5.0 | 5.0 | 5.0 |
| Fixed rules | 5.7 | 5.5 | 6.0 | 6.0 | 6.0 | 6.0 |

Scenarios: **baseline**: The main dataset's assumptions, with new seeds; **noisier_days**: More day-to-day variation in learners fed (upper end of what real schools show); **subtle_anomalies**: Every anomaly half as strong, so harder to see; **larger_programme**: Twice as many schools (80 in 8 sub-counties), the same number of anomaly episodes per school; **fortnightly_counts**: Store counted every 10 school days instead of 20; **irregular_entry**: Schools that often enter late and sync rarely, so ordinary records look more like backdating.

All runs use synthetic data, so the study shows how stable the comparison is under different assumptions, not how the methods would do at real schools.
