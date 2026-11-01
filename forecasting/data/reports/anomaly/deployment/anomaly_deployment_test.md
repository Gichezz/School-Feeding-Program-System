# Anomaly detection: deployment-matching test

Plan: [`forecasting\config\anomaly_deployment_test.yaml`](../../../../config/anomaly_deployment_test.yaml), committed before it was run. Each sub-county is refitted every 20 school days on its last 125 school days, with the settings fixed from the main evaluation and no labels or threshold; each week every officer gets the top 3 school-weeks; school-weeks the officer marks follow-up are left out of later fits. 4 datasets × 5 model seeds; scored 2025-01-06 to 2026-10-23.

**Deployed, the methods rank differently from the evaluation: Extended Isolation Forest does best, 1.2 points above One-class SVM.**

| Method | Precision@3 (mean) | Spread across runs (sd, points) | Share of best possible | Problem school-weeks listed | Seconds per refit |
|---|---|---|---|---|---|
| Extended Isolation Forest | 15.8% | ±0.7 | 73.6% | 73.4% | 0.36 |
| SGD one-class SVM | 15.2% | ±0.9 | 70.7% | 70.5% | 0.02 |
| Isolation Forest | 14.8% | ±1.0 | 69.1% | 68.9% | 0.77 |
| Local Outlier Factor | 14.6% | ±0.6 | 68.2% | 68.0% | 0.06 |
| One-class SVM | 14.6% | ±0.9 | 67.9% | 67.8% | 0.01 |
| Fixed rules | 9.6% | ±0.5 | 44.6% | 44.5% | 0.00 |

## Problem school-weeks listed, by type

| Method | backdated_bulk_entry | consumption_drift | ghost_learners | inflated_headcount | round_number_entry | stock_leakage |
|---|---|---|---|---|---|---|
| Extended Isolation Forest | 100.0% | 71.9% | 87.3% | 76.2% | 87.4% | 48.6% |
| SGD one-class SVM | 100.0% | 82.0% | 83.9% | 74.2% | 71.7% | 36.9% |
| Isolation Forest | 97.9% | 65.8% | 84.1% | 81.9% | 68.7% | 39.6% |
| Local Outlier Factor | 100.0% | 77.9% | 85.3% | 62.6% | 73.8% | 38.9% |
| One-class SVM | 100.0% | 82.8% | 78.0% | 70.5% | 68.3% | 33.5% |
| Fixed rules | 100.0% | 46.7% | 51.4% | 26.6% | 21.2% | 43.2% |

## Precision by kind of week

Weeks holding the last day of the school year (closing day), the first day, and all others. The best possible differs by kind of week, so the share of it is the fair comparison.

| Method | Kind of week | Precision@3 | Best possible | Share of best possible |
|---|---|---|---|---|
| Extended Isolation Forest | other | 16.5% | 22.4% | 73.7% |
| Extended Isolation Forest | school_year_end | 6.2% | 8.3% | 83.3% |
| Extended Isolation Forest | school_year_start | 2.1% | 4.2% | 50.0% |
| Isolation Forest | other | 15.5% | 22.4% | 69.3% |
| Isolation Forest | school_year_end | 5.2% | 8.3% | 72.2% |
| Isolation Forest | school_year_start | 2.1% | 4.2% | 50.0% |
| Local Outlier Factor | other | 15.3% | 22.4% | 68.3% |
| Local Outlier Factor | school_year_end | 4.2% | 8.3% | 63.9% |
| Local Outlier Factor | school_year_start | 3.1% | 4.2% | 75.0% |
| One-class SVM | other | 15.2% | 22.4% | 68.1% |
| One-class SVM | school_year_end | 4.2% | 8.3% | 63.9% |
| One-class SVM | school_year_start | 3.1% | 4.2% | 75.0% |
| Fixed rules | other | 10.0% | 22.4% | 44.7% |
| Fixed rules | school_year_end | 3.1% | 8.3% | 52.8% |
| Fixed rules | school_year_start | 2.1% | 4.2% | 50.0% |
| SGD one-class SVM | other | 15.9% | 22.4% | 70.9% |
| SGD one-class SVM | school_year_end | 4.2% | 8.3% | 63.9% |
| SGD one-class SVM | school_year_start | 3.1% | 4.2% | 75.0% |

**Closing-week check (One-class SVM):** share of the best possible 4.2 points lower in school-year-end weeks than in other weeks - within the plan's 10 points, so the closing-week problem counts as fixed. Under version 4's features: 11.1% in school-year-end weeks against 70.8% in other weeks.

## Who is listed for nothing

For each group, its share of the listed school-weeks that contain no problem, over its share of all school-weeks with no problem: 1.00 means it is listed for nothing exactly as often as its size says; over 1.50 counts as over-listed (plan: fairness_check).

| Method | large schools | small schools | medium schools | food delivered | cash transfer |
|---|---|---|---|---|---|
| Extended Isolation Forest | 1.01 | 1.03 | 0.95 | 0.97 | 0.98 |
| SGD one-class SVM | 1.06 | 0.97 | 0.96 | 0.93 | 1.07 |
| Isolation Forest | 1.02 | 1.03 | 0.94 | 0.95 | 1.03 |
| Local Outlier Factor | 1.03 | 0.97 | 1.00 | 0.96 | 1.04 |
| One-class SVM | 1.06 | 0.99 | 0.94 | 0.93 | 1.08 |
| Fixed rules | 0.88 | 1.10 | 1.01 | 0.92 | 1.11 |

**Fairness check (One-class SVM):** no group over 1.50; the highest is cash transfer at 1.08.

## Precision by dataset

| Method | main | seed_101 | seed_202 | seed_303 |
|---|---|---|---|---|
| Extended Isolation Forest | 16.6% | 14.8% | 16.2% | 15.6% |
| SGD one-class SVM | 15.6% | 13.8% | 16.0% | 15.3% |
| Isolation Forest | 15.8% | 13.4% | 15.3% | 14.9% |
| Local Outlier Factor | 14.5% | 14.0% | 15.5% | 14.6% |
| One-class SVM | 15.4% | 13.1% | 15.2% | 14.7% |
| Fixed rules | 9.8% | 10.0% | 9.7% | 8.8% |

Synthetic data: the test shows the methods behave in deployment as in the evaluation, not how often they would be right at real schools.
