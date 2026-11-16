# Anomaly detection: protocol version 8

Plan: [`forecasting/config/anomaly_v8.yaml`](../../../../config/anomaly_v8.yaml), committed before it was run. Four changes tested in order, each chosen on 2025 only and adopted only if it beat the current setting by the plan's margin. 2026 was then scored once for the final settings and for version 7's. Extended Isolation Forest, the version 7 deployment loop, 4 datasets × 5 model seeds.

**Final setting:** top2_mean; v7 features; one model; model list, review threshold q = 0.98.

## Test year (2026)

|  | Precision@3 | Recall@3 | F1@3 | Schools listed per officer-week | Ordinary schools listed per officer-term | Problems caught | Caught within 2 weeks | Median weeks to catch |
|---|---|---|---|---|---|---|---|---|
| Version 8 | 53.1% | 52.4% | 52.6% | 0.74 | 4.5 | 88.3% | 53.6% | 1 |
| Version 7 | 43.8% | 30.3% | 35.7% | 0.52 | 3.8 | 70.3% | 36.1% | 1 |

A problem is one injected episode (one school, one type, first to last day); it is caught if any school-week it covers is listed. Weeks to catch counts from the episode's first week (0 = its first week).

### Problems caught, by type

| Type | Version 8 | Version 7 |
|---|---|---|
| backdated_bulk_entry | 100.0% | 100.0% |
| consumption_drift | 83.3% | 71.7% |
| ghost_learners | 100.0% | 75.0% |
| inflated_headcount | 63.3% | 25.0% |
| round_number_entry | 91.7% | 58.3% |
| stock_leakage | 91.7% | 91.7% |

### Problem school-weeks listed, by type

| Type | Version 8 | Version 7 |
|---|---|---|
| backdated_bulk_entry | 100.0% | 100.0% |
| consumption_drift | 46.4% | 27.3% |
| ghost_learners | 59.2% | 16.8% |
| inflated_headcount | 20.7% | 5.7% |
| round_number_entry | 51.0% | 20.7% |
| stock_leakage | 31.0% | 31.9% |

**Fairness (version 8, preliminary):** highest false listing ratio 1.17 (limit 1.5); over-listed: none.

## Stages (2025, the selection year)

### Stage 1 aggregation

Current: max; v7 features; one model; model list. Margin to adopt: 1.0 F1 points.

| Candidate | Setting | q | Precision@3 | Recall@3 | F1@3 |
|---|---|---|---|---|---|
| max | max; v7 features; one model; model list | 0.98 | 37.7% | 25.7% | 30.6% |
| top2_mean | top2_mean; v7 features; one model; model list | 0.98 | 47.2% | 36.2% | 40.8% |
| weighted | weighted; v7 features; one model; model list | 0.98 | 46.2% | 35.3% | 39.8% |

Best: top2_mean (+10.2 points). Adopted.

### Stage 2 features

Current: top2_mean; v7 features; one model; model list. Margin to adopt: 1.0 F1 points.

| Candidate | Setting | q | Precision@3 | Recall@3 | F1@3 |
|---|---|---|---|---|---|
| fed_vs_peers_trend | top2_mean; +fed_vs_peers_trend; one model; model list | 0.98 | 45.9% | 38.3% | 41.5% |
| count_gap_recent | top2_mean; +count_gap_recent; one model; model list | 0.98 | 44.4% | 38.8% | 41.2% |
| both | top2_mean; +fed_vs_peers_trend, +count_gap_recent; one model; model list | 0.98 | 44.1% | 38.7% | 41.1% |

Best: fed_vs_peers_trend (+0.8 points). Not adopted: the current setting stays.

### Stage 3 grouped models

Current: top2_mean; v7 features; one model; model list. Margin to adopt: 2.0 F1 points.

| Candidate | Setting | q | Precision@3 | Recall@3 | F1@3 |
|---|---|---|---|---|---|
| grouped | top2_mean; v7 features; grouped; model list | 0.95 | 16.4% | 22.6% | 18.9% |

Best: grouped (-21.8 points). Not adopted: the current setting stays.

### Stage 4 rules first

Current: top2_mean; v7 features; one model; model list. Margin to adopt: 1.0 F1 points.

| Candidate | Setting | q | Precision@3 | Recall@3 | F1@3 |
|---|---|---|---|---|---|
| rules_first | top2_mean; v7 features; one model; rules first | 0.95 | 22.4% | 46.9% | 30.4% |

Best: rules_first (-10.4 points). Not adopted: the current setting stays.

Synthetic data: these figures show how the list behaves on records shaped like Kenyan school feeding records with planted problems, not how often it would be right at real schools.
