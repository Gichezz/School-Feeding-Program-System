# Anomaly detection: deployment-matching test

Plan: [`forecasting\config\anomaly_deployment_test.yaml`](../../../../config/anomaly_deployment_test.yaml), committed before it was run. Each sub-county is refitted every 20 school days on its last 125 school days, with the settings fixed from the main evaluation and no labels or threshold; each week every officer gets the top 3 school-weeks; school-weeks the officer marks follow-up are left out of later fits. 4 datasets × 5 model seeds; scored 2025-01-06 to 2026-10-23.

**The evaluation's conclusion holds in deployment: One-class SVM has the highest mean precision@k.**

| Method | Precision@3 (mean) | Spread across runs (sd, points) | Share of best possible | Problem school-weeks listed | Seconds per refit |
|---|---|---|---|---|---|
| One-class SVM | 15.0% | ±1.0 | 70.1% | 69.9% | 0.01 |

## Problem school-weeks listed, by type

| Method | backdated_bulk_entry | consumption_drift | ghost_learners | inflated_headcount | round_number_entry | stock_leakage |
|---|---|---|---|---|---|---|
| One-class SVM | 100.0% | 78.8% | 79.7% | 74.4% | 84.6% | 37.4% |

## Precision by kind of week

Weeks holding the last day of the school year (closing day), the first day, and all others. The best possible differs by kind of week, so the share of it is the fair comparison.

| Method | Kind of week | Precision@3 | Best possible | Share of best possible |
|---|---|---|---|---|
| One-class SVM | other | 15.8% | 22.4% | 70.8% |
| One-class SVM | school_year_end | 1.0% | 8.3% | 11.1% |
| One-class SVM | school_year_start | 2.1% | 4.2% | 50.0% |

**Closing-week check (One-class SVM):** share of the best possible 59.7 points lower in school-year-end weeks than in other weeks - more than the plan's 10 points, so the weakness remains.

## Precision by dataset

| Method | main | seed_101 | seed_202 | seed_303 |
|---|---|---|---|---|
| One-class SVM | 15.0% | 13.5% | 16.1% | 15.5% |

Synthetic data: the test shows the methods behave in deployment as in the evaluation, not how often they would be right at real schools.
