# Anomaly detection: deployment-matching test (protocol version 7)

Plan: [`forecasting/config/anomaly_deployment_test.yaml`](../../../../config/anomaly_deployment_test.yaml), written before it was run. Each sub-county is refitted every 20 school days on its last 125, with the settings fixed from the main evaluation and no labels. Each week the officer gets up to 3 school-weeks: the highest-scoring, above the review threshold. School-weeks marked follow-up are left out of later fits. 4 datasets × 5 model seeds. The unit is the school-week. The threshold is chosen on 2025; the figures below are for 2026.

**The evaluation's conclusion holds in deployment: Extended Isolation Forest has the highest mean Precision@3.**

| Method | Review threshold (q) | Precision@3 | Recall@3 | F1@3 | Weeks with nothing listed | Schools listed per officer-week | Ordinary schools listed per officer-term |
|---|---|---|---|---|---|---|---|
| Extended Isolation Forest | 0.98 | 43.8% | 30.3% | 35.7% | 68.4% | 0.52 | 3.8 |
| Isolation Forest | 0.95 | 39.1% | 43.7% | 41.2% | 41.1% | 0.84 | 6.6 |
| SGD one-class SVM | 0.95 | 37.2% | 44.2% | 40.1% | 43.3% | 0.89 | 7.3 |
| Local Outlier Factor | 0.95 | 37.0% | 42.3% | 39.1% | 45.7% | 0.85 | 6.9 |
| One-class SVM | 0.95 | 35.3% | 37.5% | 36.1% | 47.9% | 0.80 | 6.7 |
| Fixed rules | none (always 3) | 32.1% | 31.1% | 31.4% | 53.1% | 0.71 | 6.2 |

## The same methods without a threshold (always 3 a week)

| Method | Precision@3 | Recall@3 | F1@3 | Ordinary schools listed per officer-term |
|---|---|---|---|---|
| Extended Isolation Forest | 18.9% | 75.0% | 30.1% | 31.6 |
| Isolation Forest | 17.7% | 70.4% | 28.3% | 32.1 |
| Local Outlier Factor | 17.7% | 70.4% | 28.3% | 32.1 |
| One-class SVM | 17.5% | 69.5% | 27.9% | 32.2 |
| Fixed rules | 32.1% | 31.1% | 31.4% | 6.2 |
| SGD one-class SVM | 18.2% | 72.1% | 29.0% | 31.9 |

## Choosing the threshold (2025, the selection year)

The protocol chooses each method's q by the highest F1@3 on the selection year; ties go to the lower q.

| Method | q | Precision@3 | Recall@3 | F1@3 |
|---|---|---|---|---|
| Extended Isolation Forest | 0.90 | 22.6% | 44.2% | 29.9% |
| Extended Isolation Forest | 0.95 | 27.0% | 35.0% | 30.4% |
| Extended Isolation Forest | 0.98 | 37.7% | 25.7% | 30.6% |
| Extended Isolation Forest | none (always 3) | 12.3% | 68.6% | 20.8% |
| Isolation Forest | 0.90 | 18.9% | 44.9% | 26.6% |
| Isolation Forest | 0.95 | 24.3% | 31.3% | 27.3% |
| Isolation Forest | 0.98 | 31.2% | 17.2% | 22.2% |
| Isolation Forest | none (always 3) | 11.2% | 62.6% | 19.0% |
| Local Outlier Factor | 0.90 | 20.0% | 43.8% | 27.4% |
| Local Outlier Factor | 0.95 | 25.1% | 31.0% | 27.6% |
| Local Outlier Factor | 0.98 | 33.6% | 21.2% | 25.4% |
| Local Outlier Factor | none (always 3) | 11.2% | 62.6% | 19.0% |
| One-class SVM | 0.90 | 19.1% | 44.0% | 26.5% |
| One-class SVM | 0.95 | 25.6% | 34.4% | 29.1% |
| One-class SVM | 0.98 | 34.9% | 25.1% | 28.6% |
| One-class SVM | none (always 3) | 11.4% | 63.5% | 19.3% |
| Fixed rules | none (always 3) | 16.5% | 20.2% | 18.1% |
| SGD one-class SVM | 0.90 | 19.4% | 47.6% | 27.5% |
| SGD one-class SVM | 0.95 | 26.9% | 36.3% | 30.6% |
| SGD one-class SVM | 0.98 | 33.0% | 21.8% | 25.9% |
| SGD one-class SVM | none (always 3) | 11.8% | 65.5% | 19.9% |

## Problem school-weeks listed, by type

| Method | backdated_bulk_entry | consumption_drift | ghost_learners | inflated_headcount | round_number_entry | stock_leakage |
|---|---|---|---|---|---|---|
| Extended Isolation Forest | 100.0% | 27.3% | 16.8% | 5.7% | 20.7% | 31.9% |
| Isolation Forest | 92.5% | 27.3% | 51.6% | 39.3% | 37.6% | 10.4% |
| SGD one-class SVM | 100.0% | 56.3% | 46.6% | 32.6% | 33.3% | 6.0% |
| Local Outlier Factor | 100.0% | 51.2% | 46.1% | 13.5% | 31.5% | 10.7% |
| One-class SVM | 100.0% | 57.0% | 31.8% | 30.4% | 20.6% | 4.8% |
| Fixed rules | 100.0% | 25.4% | 31.4% | 8.0% | 4.2% | 19.4% |

## Fairness (Extended Isolation Forest, preliminary)

For each group, ordinary school-weeks listed (false listing rate) and problem school-weeks listed (detection rate), against the overall rates (3.2% and 30.0%). A group is over-listed above 1.5 times the overall false listing rate. 40 synthetic schools: small groups, so these are indications, not conclusions.

| Group | By | Ordinary weeks | False listing rate | Against overall | Detection rate |
|---|---|---|---|---|---|
| medium schools | size | 8295 | 4.0% | 1.24 | 26.1% |
| small schools | size | 8980 | 2.9% | 0.92 | 34.7% |
| large schools | size | 9350 | 2.7% | 0.86 | 29.0% |
| cash transfer | programme | 7710 | 1.3% | 0.40 | 25.1% |
| food delivered | programme | 18915 | 4.0% | 1.24 | 31.8% |
| Mfano East | sub county | 6730 | 3.4% | 1.06 | 26.4% |
| Mfano North | sub county | 6670 | 3.3% | 1.02 | 35.3% |
| Mfano South | sub county | 6605 | 3.0% | 0.95 | 28.4% |
| Mfano West | sub county | 6620 | 3.1% | 0.96 | 29.8% |
| syncs every 3-5 days | sync | 17505 | 3.2% | 0.99 | 31.4% |
| syncs every 1-2 days | sync | 9120 | 3.2% | 1.01 | 27.6% |
| week without | in outage | 24550 | 3.2% | 1.01 | 29.3% |
| week with an outage | in outage | 2075 | 2.8% | 0.89 | 40.0% |

**Over-listed:** none.

## Connectivity check

Ordinary school-weeks listed, in weeks when the school's device could not sync and in other weeks, with version 7's features (entry measured from capture) and with version 6's (entry measured from server receipt), on the same data.

| Timing features | Ordinary outage weeks listed | Ordinary other weeks listed | Precision@3 | Recall@3 |
|---|---|---|---|---|
| Version 7 (capture) | 2.8% | 3.2% | 43.5% | 30.0% |
| Version 6 timing (server receipt) | 7.1% | 2.7% | 44.7% | 30.0% |

Synthetic data: this shows how the methods behave in deployment on records shaped like Kenyan school feeding records, not how often they would be right at real schools.
