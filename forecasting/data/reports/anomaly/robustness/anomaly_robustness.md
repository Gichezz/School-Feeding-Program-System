# Anomaly detection: robustness study

Plan: [`forecasting\config\anomaly_robustness.yaml`](../../../../config/anomaly_robustness.yaml), committed before it was run. 18 runs: 6 data scenarios × 3 seeds, each generated afresh and evaluated with the unchanged protocol (same methods, tuning grid, periods, held-out anomaly types, metric and decision rule).

**One-class SVM is robustly best: best average rank, and recommended or tied with the recommended method in 18 of 18 runs.**

## Across all runs

| Method | Average rank | Precision@k (mean) | Range | Share of best possible | F1 | Recall, held-out types | Recommended (of 18) | Recommended or tied (of 18) |
|---|---|---|---|---|---|---|---|---|
| One-class SVM | 1.11 | 24.6% | 19.7% – 37.5% | 73.5% | 40.7% | 87.0% | 18 | 18 |
| Isolation Forest | 2.36 | 22.2% | 16.9% – 32.2% | 66.6% | 34.6% | 56.0% | 0 | 9 |
| Local Outlier Factor | 2.78 | 21.0% | 16.9% – 27.5% | 63.4% | 30.4% | 88.1% | 0 | 4 |
| Robust z-score | 3.86 | 17.5% | 14.4% – 20.6% | 52.9% | 26.6% | 55.8% | 0 | 0 |
| Fixed rules | 4.89 | 13.8% | 8.6% – 16.7% | 41.9% | 28.6% | 39.6% | 0 | 0 |

Rank is by precision@k within each run (1 = best). "Share of best possible" divides precision@k by the most any method could reach in that run, given how many school-weeks contain an anomaly.

## Average rank by scenario

| Method | baseline | noisier_days | subtle_anomalies | larger_programme | fortnightly_counts | irregular_entry |
|---|---|---|---|---|---|---|
| One-class SVM | 1.0 | 1.3 | 1.3 | 1.0 | 1.0 | 1.0 |
| Isolation Forest | 2.2 | 2.8 | 3.0 | 2.2 | 2.0 | 2.0 |
| Local Outlier Factor | 2.8 | 2.0 | 2.7 | 2.8 | 3.3 | 3.0 |
| Robust z-score | 4.3 | 4.2 | 3.0 | 4.0 | 3.7 | 4.0 |
| Fixed rules | 4.7 | 4.7 | 5.0 | 5.0 | 5.0 | 5.0 |

Scenarios: **baseline**: The main dataset's assumptions, with new seeds; **noisier_days**: More day-to-day variation in learners fed (upper end of what real schools show); **subtle_anomalies**: Every anomaly half as strong, so harder to see; **larger_programme**: Twice as many schools (80 in 8 sub-counties), the same number of anomaly episodes per school; **fortnightly_counts**: Store counted every 10 school days instead of 20; **irregular_entry**: Schools that often enter late and sync rarely, so ordinary records look more like backdating.

All runs use synthetic data, so the study shows how stable the comparison is under different assumptions, not how the methods would do at real schools.
