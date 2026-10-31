# Anomaly detection: deployment-matching test

Plan: [`forecasting\config\anomaly_deployment_test.yaml`](../../../../config/anomaly_deployment_test.yaml), committed before it was run. Each sub-county is refitted every 20 school days on its last 125 school days, with the settings fixed from the main evaluation and no labels or threshold; each week every officer gets the top 3 school-weeks; school-weeks the officer marks follow-up are left out of later fits. 4 datasets × 5 model seeds; scored 2025-01-06 to 2026-10-23.

**The evaluation's conclusion holds in deployment: One-class SVM is within 1 point of the best (Extended Isolation Forest).**

| Method | Precision@3 (mean) | Spread across runs (sd, points) | Share of best possible | Problem school-weeks listed | Seconds per refit |
|---|---|---|---|---|---|
| Extended Isolation Forest | 15.2% | ±0.7 | 71.0% | 70.8% | 0.15 |
| One-class SVM | 15.0% | ±1.0 | 70.1% | 69.9% | 0.02 |
| Isolation Forest | 14.7% | ±0.8 | 68.3% | 68.1% | 0.22 |
| Local Outlier Factor | 13.7% | ±1.1 | 64.0% | 63.8% | 0.06 |
| Fixed rules | 9.7% | ±0.6 | 45.3% | 45.2% | 0.00 |

## Problem school-weeks listed, by type

| Method | backdated_bulk_entry | consumption_drift | ghost_learners | inflated_headcount | round_number_entry | stock_leakage |
|---|---|---|---|---|---|---|
| Extended Isolation Forest | 100.0% | 71.7% | 85.4% | 70.6% | 81.2% | 46.1% |
| One-class SVM | 100.0% | 78.8% | 79.7% | 74.4% | 84.6% | 37.4% |
| Isolation Forest | 99.2% | 65.6% | 82.9% | 74.6% | 82.0% | 39.0% |
| Local Outlier Factor | 100.0% | 77.9% | 76.2% | 52.9% | 77.6% | 35.0% |
| Fixed rules | 100.0% | 49.0% | 52.0% | 26.6% | 21.2% | 43.2% |

## Precision by dataset

| Method | main | seed_101 | seed_202 | seed_303 |
|---|---|---|---|---|
| Extended Isolation Forest | 15.8% | 14.2% | 15.8% | 15.2% |
| One-class SVM | 15.0% | 13.5% | 16.1% | 15.5% |
| Isolation Forest | 15.2% | 13.4% | 15.3% | 14.8% |
| Local Outlier Factor | 13.4% | 12.2% | 15.0% | 14.4% |
| Fixed rules | 9.8% | 10.1% | 10.1% | 8.9% |

Synthetic data: the test shows the methods behave in deployment as in the evaluation, not how often they would be right at real schools.
