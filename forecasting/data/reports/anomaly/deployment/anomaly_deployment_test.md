# Anomaly detection: deployment-matching test

Plan: [`forecasting\config\anomaly_deployment_test.yaml`](../../../../config/anomaly_deployment_test.yaml), committed before it was run. Each sub-county is refitted every 20 school days on its last 125 school days, with the settings fixed from the main evaluation and no labels or threshold; each week every officer gets the top 3 school-weeks; school-weeks the officer marks follow-up are left out of later fits. 4 datasets × 5 model seeds; scored 2025-01-06 to 2026-10-23.

**The evaluation's conclusion holds in deployment: One-class SVM is within 1 point of the best (Extended Isolation Forest).**

| Method | Precision@3 (mean) | Spread across runs (sd, points) | Share of best possible | Problem school-weeks listed | Seconds per refit |
|---|---|---|---|---|---|
| Extended Isolation Forest | 15.7% | ±0.7 | 73.4% | 73.2% | 0.10 |
| One-class SVM | 15.4% | ±0.9 | 71.6% | 71.4% | 0.01 |
| Isolation Forest | 15.0% | ±0.8 | 70.0% | 69.8% | 0.37 |
| Local Outlier Factor | 14.2% | ±1.0 | 66.2% | 66.0% | 0.04 |
| Fixed rules | 9.7% | ±0.6 | 45.3% | 45.2% | 0.00 |

## Problem school-weeks listed, by type

| Method | backdated_bulk_entry | consumption_drift | ghost_learners | inflated_headcount | round_number_entry | stock_leakage |
|---|---|---|---|---|---|---|
| Extended Isolation Forest | 100.0% | 71.4% | 84.6% | 77.8% | 85.2% | 49.8% |
| One-class SVM | 100.0% | 79.3% | 85.4% | 76.4% | 82.3% | 37.3% |
| Isolation Forest | 100.0% | 66.0% | 84.8% | 79.3% | 82.6% | 40.4% |
| Local Outlier Factor | 100.0% | 78.7% | 82.7% | 54.3% | 77.6% | 37.3% |
| Fixed rules | 100.0% | 49.0% | 52.0% | 26.6% | 21.2% | 43.2% |

## Precision by kind of week

Weeks holding the last day of the school year (closing day), the first day, and all others. The best possible differs by kind of week, so the share of it is the fair comparison.

| Method | Kind of week | Precision@3 | Best possible | Share of best possible |
|---|---|---|---|---|
| Extended Isolation Forest | other | 16.4% | 22.4% | 73.5% |
| Extended Isolation Forest | school_year_end | 6.2% | 8.3% | 83.3% |
| Extended Isolation Forest | school_year_start | 2.1% | 4.2% | 50.0% |
| Isolation Forest | other | 15.7% | 22.4% | 70.1% |
| Isolation Forest | school_year_end | 6.0% | 8.3% | 81.1% |
| Isolation Forest | school_year_start | 2.1% | 4.2% | 50.0% |
| Local Outlier Factor | other | 14.8% | 22.4% | 66.2% |
| Local Outlier Factor | school_year_end | 4.2% | 8.3% | 63.9% |
| Local Outlier Factor | school_year_start | 3.1% | 4.2% | 75.0% |
| One-class SVM | other | 16.1% | 22.4% | 71.8% |
| One-class SVM | school_year_end | 4.2% | 8.3% | 63.9% |
| One-class SVM | school_year_start | 3.1% | 4.2% | 75.0% |
| Fixed rules | other | 10.1% | 22.4% | 45.4% |
| Fixed rules | school_year_end | 3.1% | 8.3% | 52.8% |
| Fixed rules | school_year_start | 2.1% | 4.2% | 50.0% |

**Closing-week check (One-class SVM):** share of the best possible 7.9 points lower in school-year-end weeks than in other weeks - within the plan's 10 points, so the closing-week problem counts as fixed. Under version 4's features: 11.1% in school-year-end weeks against 70.8% in other weeks.

## Precision by dataset

| Method | main | seed_101 | seed_202 | seed_303 |
|---|---|---|---|---|
| Extended Isolation Forest | 16.6% | 14.7% | 15.9% | 15.8% |
| One-class SVM | 15.4% | 14.0% | 16.2% | 15.9% |
| Isolation Forest | 15.9% | 13.9% | 15.4% | 14.9% |
| Local Outlier Factor | 13.8% | 12.8% | 15.2% | 15.0% |
| Fixed rules | 9.8% | 10.1% | 10.1% | 8.9% |

Synthetic data: the test shows the methods behave in deployment as in the evaluation, not how often they would be right at real schools.
