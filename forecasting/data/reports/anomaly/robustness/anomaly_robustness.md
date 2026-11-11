# Anomaly detection: robustness study

Plan: [`forecasting\config\anomaly_robustness.yaml`](../../../../config/anomaly_robustness.yaml), committed before it was run. 21 runs: 7 data scenarios × 3 seeds, each generated afresh and evaluated with the unchanged protocol (same methods, tuning grid, periods, held-out anomaly types, metric and decision rule).

**No single method is robustly best. Extended Isolation Forest has the best average rank but is recommended or tied with the recommended method in only 8 of 21 runs.**

## Across all runs

| Method | Average rank | Precision@k (mean) | Range | Share of best possible | F1 | Recall, held-out types | Recommended (of 21) | Recommended or tied (of 21) |
|---|---|---|---|---|---|---|---|---|
| Extended Isolation Forest | 1.50 | 23.8% | 18.3% – 33.3% | 72.0% | 45.0% | 59.0% | 5 | 8 |
| SGD one-class SVM | 2.33 | 23.0% | 19.4% – 34.7% | 69.5% | 47.5% | 68.7% | 5 | 5 |
| Local Outlier Factor | 3.48 | 21.9% | 17.2% – 30.8% | 66.7% | 42.3% | 83.0% | 0 | 3 |
| One-class SVM | 3.88 | 21.8% | 17.5% – 30.3% | 66.1% | 44.7% | 59.6% | 10 | 10 |
| Isolation Forest | 4.02 | 21.7% | 16.1% – 30.0% | 65.8% | 37.7% | 50.8% | 0 | 4 |
| Robust z-score | 5.81 | 17.5% | 14.4% – 20.3% | 53.4% | 33.3% | 50.6% | 1 | 1 |
| Fixed rules | 6.98 | 14.1% | 8.3% – 16.7% | 43.3% | 32.6% | 35.3% | 0 | 0 |

Rank is by precision@k within each run (1 = best). "Share of best possible" divides precision@k by the most any method could reach in that run, given how many school-weeks contain an anomaly.

## Average rank by scenario

| Method | baseline | noisier_days | subtle_anomalies | larger_programme | fortnightly_counts | connectivity_outages | irregular_entry |
|---|---|---|---|---|---|---|---|
| Extended Isolation Forest | 1.5 | 3.2 | 1.0 | 1.3 | 1.0 | 1.5 | 1.0 |
| SGD one-class SVM | 1.8 | 2.5 | 2.3 | 2.0 | 2.3 | 1.8 | 3.5 |
| Local Outlier Factor | 4.0 | 1.2 | 2.7 | 4.3 | 4.3 | 4.0 | 3.8 |
| One-class SVM | 4.2 | 3.2 | 4.3 | 3.7 | 3.5 | 4.2 | 4.2 |
| Isolation Forest | 3.5 | 5.5 | 5.0 | 3.7 | 4.5 | 3.5 | 2.5 |
| Robust z-score | 6.0 | 5.7 | 5.7 | 6.0 | 5.3 | 6.0 | 6.0 |
| Fixed rules | 7.0 | 6.8 | 7.0 | 7.0 | 7.0 | 7.0 | 7.0 |

Scenarios: **baseline**: The main dataset's assumptions, with new seeds; **noisier_days**: More day-to-day variation in learners fed (upper end of what real schools show); **subtle_anomalies**: Every anomaly half as strong, so harder to see; **larger_programme**: Twice as many schools (80 in 8 sub-counties), the same number of anomaly episodes per school; **fortnightly_counts**: Store counted every 10 school days instead of 20; **connectivity_outages**: Version 7 - outages twice as common and up to five weeks long, so many honest records arrive late and together; **irregular_entry**: Schools that often enter late and sync rarely, so ordinary records look more like backdating.

All runs use synthetic data, so the study shows how stable the comparison is under different assumptions, not how the methods would do at real schools.
