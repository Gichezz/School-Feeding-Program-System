# Reading guide for the project documentation

Lishe is an offline-first information system for school feeding and food-store records in Kenyan
public primary and junior schools, with anomaly-based oversight for sub-county programme officers.
This guide says where each part of the write-up comes from, so every claim can be traced to a
document, a report or the code.

## Where to find each part

| Part of the write-up | Read first | Then, for detail |
|---|---|---|
| What the system does, for whom | [../README.md](../README.md) | [architecture.md](architecture.md) (Roles) |
| System design: components, data, offline capture and sync, conflicts, calendar, sign-in, record integrity | [architecture.md](architecture.md) | `database/schema.sql`, `database/migrations/`, `backend/src/`, `frontend/src/sync/` |
| Feeding record rules: more learners fed than enrolled, and why the limits are where they are | [feeding-record-rules.md](feeding-record-rules.md) | `frontend/src/features/feeding/planning.js`, `database/migrations/023_new_learners_reason.sql` |
| Synchronisation evaluation (success rate, conflict detection, latency) | [sync-evaluation.md](sync-evaluation.md) | `frontend/evaluation/sync/results/sync_evaluation_report.md` |
| Why the system monitors records instead of forecasting meal demand | [anomaly-detection.md](anomaly-detection.md), section 1 | `forecasting/data/reports/swedish/forecast_evaluation.md`; [archive/forecasting-prophet.md](archive/forecasting-prophet.md) |
| Evaluation data: what is real, what is assumed | [synthetic-dataset.md](synthetic-dataset.md) | `forecasting/config/kenya_inputs.yaml`, `forecasting/config/feeding_dataset.yaml`, `forecasting/config/feeding_dataset_realistic.yaml` |
| The anomaly model, its features and how it was chosen | [anomaly-detection.md](anomaly-detection.md), sections 2 to 5 | [anomaly-model-audit.md](anomaly-model-audit.md) |
| The final model results (protocol version 12) | `forecasting/data/reports/anomaly/v12/v12_report.md` | `forecasting/config/anomaly_v12.yaml` (the plan, written before the data existed), `final.json` |
| How the model runs in the system | [anomaly-detection.md](anomaly-detection.md), section 6 | `forecasting/services/scoring_service.py`, `backend/src/services/weeklyReviewSchedule.js` |
| Limitations | [anomaly-detection.md](anomaly-detection.md), section 7; [../README.md](../README.md), Known limitations | the Limits section of the version 12 report |
| Deployment and testing | [deployment.md](deployment.md) | `.github/workflows/ci.yml`, `backend/tests/`, `forecasting/tests/`, `frontend/src/**/*.test.js` |

## How the model was developed

Each protocol version had a written plan (`forecasting/config/anomaly_v*.yaml`) before it ran, and
a report (`forecasting/data/reports/anomaly/v*/`). Earlier versions are the evidence trail; the
running system comes from versions 11 and 12.

- **Versions 1 to 7:** method comparison (Isolation Forest, Extended Isolation Forest, one-class SVM,
  Local Outlier Factor, fixed rules), robustness, and a deployment-style test.
- **Version 8:** the weekly score (the mean of a school's two highest days).
- **Versions 9 and 10:** an investigation of a weak year, and two detectors kept apart (not adopted).
- **Version 11:** one-sided scoring and store shortfalls listed first. This is the model that runs.
- **Version 12:** controlled experiments on harsher, more realistic data. It tested 24 changes;
  none passed. It kept version 11's model, rescores late records for 8 weeks instead of 4, and has
  the programme set the review threshold from its officers' capacity for visits.

## Measures: always say which recall

- **Problem-level recall:** the share of distinct planted problems the list found at least once.
- **Problem-level precision:** the share of officer visits that find a problem.
- **Problem-level F1:** combines the two. This is the headline measure, declared before the data
  existed.
- **Week-level precision@3, recall@3 and F1@3:** for each week's list of up to 3 schools. These are
  reported beside the headline. They are lower because a problem lasting several weeks counts once
  per week.
- **False listings per officer-term:** needless visits. Every comparison is made at the same
  workload.

## Headline figures

All figures come from synthetic data.

- **Final test, realistic data**, generated after the plan was frozen, at the same workload of about
  3.3 needless visits per officer-term:

  | | Version 8 | Version 12 |
  |---|---|---|
  | Problem-level F1 | 25% | 34% (+9.1 points, interval +5.5 to +12.9) |
  | Problem-level recall | 39% | 56% |

- **Standard data:** problem-level F1 72% (precision 75%, recall 71%).
- **The running system uses q 0.99, not the frozen 0.999,** so that impossible records (more
  learners fed than enrolled) are listed. At that workload (about 4.9 needless visits per
  officer-term), on the final realistic data, it finds 66% of problems against version 8's 45%
  (problem-level F1 31.4% against 23.8%). The deployment note in the version 12 report explains why.

## Gaps to state, not hide

- No real school records were available. The data is synthetic, built from real Kenyan inputs
  (calendar, ration) and stated assumptions; a pilot must check the results against real records.
- How precise store counts are is an assumption (2% error), and it drives most needless visits.
- One-day claims (4.5% caught), round-number entry (20%) and inflated headcount (22%) remain hard to
  find.
- The data has 10 schools per sub-county; real sub-counties have 30 to 80.
- Follow-up outcomes were taken from the labels. In a pilot, the officer's recorded outcome replaces
  them.
- The workload figure for each review quantile is from synthetic data.

## Archived

The earlier meal-demand forecasting (Prophet, SARIMA, machine-learning forecasters, and a one-school
synthetic dataset) was retired, because a 10-day moving average was as accurate on real Swedish
school canteens. Its notes are in [archive/](archive/), and its code is kept at the git tag
`forecasting-archive`.
