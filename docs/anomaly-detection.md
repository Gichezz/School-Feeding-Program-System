# Anomaly detection for programme officers

The machine learning in the system ranks a sub-county's school-weeks by how unusual their records look, so a programme officer knows which schools to look into first. It does not decide anything: every listed school is worded "needs review", the officer marks it explained or follow-up with a note, and the list says which figures stood out.

## 1. Why monitoring and not demand forecasting

The project first forecast meals per school day (Prophet). On 15 real school canteens (Sweden, 2010–2020; [report](../forecasting/data/reports/swedish/forecast_evaluation.md)), cooking for every enrolled pupil was 15.5% wrong over a two-week window, a 10-day moving average 6.0%, and Prophet 7.2%. A model that does not beat a moving average cannot justify itself, so school-side planning uses the moving average (with the term's enrolment and the school calendar, worked out on the device) and the Prophet work is archived ([archive/forecasting-prophet.md](archive/forecasting-prophet.md)).

The harder, unmet need is oversight. Feeding programmes pay and deliver by headcount, and audits keep finding inflated numbers: India's 2015 audit of the mid-day meal scheme described "institutionalised exaggeration" of children fed, and Kenya's Auditor-General reported about 87,000 fictitious learners in capitation records (Sh3.7 billion). Health information systems already handle this with data-quality checks (the WHO Data Quality Review, DHIS2 outlier checks). A sub-county officer with dozens of schools cannot check every record, so the system ranks them.

Real attendance data also shows why the kind of day matters: in the Swedish data the last day of the school year was 101% wrong for "cook for everyone enrolled", because most pupils are not there. A closing day is expected, not suspicious; the features below allow for it.

## 2. Data

No real school feeding records were available, so methods are compared on a synthetic dataset built from real Kenyan inputs ([`forecasting/config/kenya_inputs.yaml`](../forecasting/config/kenya_inputs.yaml), [`feeding_dataset.yaml`](../forecasting/config/feeding_dataset.yaml)): 40 schools in 4 sub-counties, the Ministry of Education term dates and public holidays for 2024–2026, the School Meals Programme ration (150 g cereals and 40 g pulses per learner per day), deliveries, losses, store counts, and when each record was captured and synced.

Six kinds of problem are injected, each with a start, an end and a strength, and labelled day by day. Three are used for tuning; three are **held out** and appear only in the single test run, to see whether a method finds problems it was never tuned on:

| Tuning | Held out |
|---|---|
| inflated headcount (more learners recorded as fed than were fed) | backdated bulk entry (many past days entered together, long after the fact) |
| consumption drift (food issued per learner creeps up) | round-number entry (figures made up, not counted) |
| stock leakage (food leaves the store unrecorded; shows only at store counts) | ghost learners (enrolment inflated for a term) |

## 3. Features

Fifteen per school-day, each a figure an officer could check by hand ([`forecasting/anomaly/features.py`](../forecasting/anomaly/features.py); fixed in the protocol). The kind of day (opening days, closing day, days before and after a break) adjusts what is normal; it is never evidence.

| Feature | Measures |
|---|---|
| `fed_rate`, `fed_vs_own`, `fed_vs_peers`, `fed_rate_vs_last_term` | learners fed for that kind of day: against enrolment, the school's usual number, similar schools nearby that day, and the school's share last term |
| `enrolment_change`, `uptake` | enrolment against last term; learners fed against learners present |
| `cereal_ratio`, `pulse_ratio`, `usage_trend` | food issued against the ration for learners fed, and its recent rise |
| `count_gap_change` | the new gap between a store count and the ledger, in days of food |
| `entry_delay`, `batch_dates`, `after_hours_share` | how late, in what batches and at what hours records were entered |
| `round_share`, `fed_steadiness` | round numbers, and learners fed hardly changing from day to day |

## 4. Protocol

The comparison follows a protocol written and committed before each run ([`anomaly_evaluation.yaml`](../forecasting/config/anomaly_evaluation.yaml)); every change between versions is recorded there with its reason. Version 5 is current:

- **Methods:** fixed rules and a robust z-score (baselines), and one learned method from each main family of unsupervised detectors: Isolation Forest (and Extended Isolation Forest), the one-class SVM, Local Outlier Factor.
- **Periods:** tuning 2024–2025, test January–October 2026.
- **Primary metric:** precision@10 for the weekly review list (the share of the week's top school-weeks that contain a real problem), with a 95% block bootstrap over weeks. Also precision, recall and F1 on school-days, recall per type and on held-out types, false flags per 1,000 ordinary days, and fit time.
- **Decision rule:** the highest precision@10; a method within the bootstrap interval of the leader counts as tied, and ties go to the simpler method, then to the faster fit on 50,000 rows.

Versions 3 and 5 changed the features after finding a problem: in version 2, rare yes/no context flags made ordinary days look unusual; in version 4, two features still compared the share fed without allowing for the kind of day, so in the last week of the school year every school's closing day looked unusual and the deployed list filled with ordinary schools. Both changes apply one stated principle (context adjusts what is normal) and were re-run in full.

## 5. Results (version 5)

**Main evaluation** ([report](../forecasting/data/reports/anomaly/anomaly_evaluation.md)). The best precision@10 any method could reach is 27.8%, because most weeks have fewer than 10 problem school-weeks.

| Method | Precision@10 | Recall, held-out types | False flags per 1,000 ordinary days | Fit on 50,000 rows |
|---|---|---|---|---|
| Fixed rules | 12.8% | 63.1% | 26.0 | 0.00 s |
| Robust z-score | 15.6% | 55.5% | 41.1 | 0.06 s |
| Isolation Forest | 20.0% | 60.8% | 34.1 | 0.85 s |
| Extended Isolation Forest | 20.8% | 74.5% | 39.7 | 0.19 s |
| **One-class SVM** | **21.4%** | **96.2%** | 81.8 | 0.13 s |
| Local Outlier Factor | 17.5% | 95.8% | 155.3 | 48.03 s |

The one-class SVM is recommended. Isolation Forest and Extended Isolation Forest are not distinguishable from it at 95%, and the decision rule then prefers the faster fit. Its clearest advantage is on problems it was never tuned on (96.2% of held-out problem days), which matters because real misreporting will not look like what was simulated. Its false flags at a fixed threshold are higher, but the deployed system does not use a threshold: each officer gets a fixed list of 3 a week.

**Its weak spot is stock leakage**, which only shows on days the store is counted: the SVM found 1 of 6 such days in the test period, Extended Isolation Forest all 6. In the system this is covered by the store-count checks (a count far from the ledger is flagged on the record and shown in analytics), not left to the model.

**Robustness** ([report](../forecasting/data/reports/anomaly/robustness/anomaly_robustness.md)): the same protocol on 6 differently generated scenarios × 3 seeds (noisier days, subtler problems, more problems, different schools). The SVM has the best average rank (1.50, Extended Isolation Forest 1.86) and is recommended in 17 of 18 runs.

**Deployment-matching test** ([report](../forecasting/data/reports/anomaly/deployment/anomaly_deployment_test.md)): each sub-county refitted every 20 school days on its last 125, no labels and no threshold, the top 3 school-weeks a week, follow-up weeks left out of later fits; 4 datasets × 5 model seeds. Precision@3: Extended Isolation Forest 15.7%, one-class SVM 15.4%, Isolation Forest 15.0%, Local Outlier Factor 14.2%, fixed rules 9.7%. The SVM is within the pre-set 1 point of the best, so the evaluation's conclusion holds. In school-year-end weeks the SVM reaches 63.9% of the best possible (71.8% in other weeks); under version 4's features it was 11.1%.

## 6. In the system

The scoring service ([`forecasting/services/scoring_service.py`](../forecasting/services/scoring_service.py)) receives one sub-county's records from the API and returns the week's ranking; it stores nothing and never reads the database.

1. The model is the one-class SVM (RBF kernel, `nu` 0.05, `gamma` "scale", on a robust-scaled sample of up to 5,000 school-days), fitted on the sub-county's previous 125 school days, about two terms. Refit points fall every 20 school days, so the model changes about monthly and no model file is kept.
2. School-weeks an officer marked follow-up are left out of the fit, so a confirmed problem does not become normal.
3. Each school's week takes its highest-scoring day. The top 3 are the week's list; every school is returned in order.
4. Reasons come from the model itself: each feature of the top day is set in turn to its median in the sub-county's training records, and the two that lower the score most are named in plain words ("learners fed 16% below the school's usual number").
5. Fixed rules run alongside and their breaches are shown for every school, whatever its rank.
6. A sub-county with fewer than 60 school days of records is ranked by the fixed rules alone.

## 7. Limitations

An audit of this comparison (scaling, leakage, training contamination, settings, scalability, SGDOneClassSVM and fairness across schools) is in [anomaly-model-audit.md](anomaly-model-audit.md).

- **Synthetic data only.** The comparison shows how the methods behave on records shaped like Kenyan school feeding records, not how often they would be right at real schools. The settings and the list length need checking against real records before use; the evaluation scripts re-run on any dataset in the same format.
- **The problems are the ones that were imagined.** Held-out types test this partly; a new kind of misreporting may still be missed.
- **A list is not a finding.** Many listed weeks have an ordinary explanation (a school event, a late sync, a new term). The officer's notes are the only judgement in the system.
- **Records that never sync cannot be ranked.** Analytics show how far behind each school's synced records are, and should be read first.

## 8. Reproducing

```bash
python forecasting/scripts/generate_feeding_dataset.py
python forecasting/scripts/evaluate_anomaly_detection.py
python forecasting/scripts/run_anomaly_robustness.py
python forecasting/scripts/run_anomaly_deployment_test.py
```

Runtimes on a laptop: about 2, 15 and 17 minutes for the last three. Extended Isolation Forest needs `isotree` from `requirements-dev.txt`; the deployed service needs only `requirements.txt`.
