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

The comparison follows a protocol written and committed before each run ([`anomaly_evaluation.yaml`](../forecasting/config/anomaly_evaluation.yaml)); every change between versions is recorded there with its reason. Version 6 is current:

- **Methods:** fixed rules and a robust z-score (baselines), and learned methods from the main families of unsupervised detectors: Isolation Forest and Extended Isolation Forest (isolation), the one-class SVM and SGDOneClassSVM (kernel boundary), Local Outlier Factor (density). Each gets six settings.
- **Periods:** models fitted on 2024; settings and the threshold chosen on 2025; the choice refitted on 2024–2025; January–October 2026 tested once.
- **No future records:** every feature uses only records up to the day it describes, as the deployed service can; a test checks that a day's features do not change when later records arrive.
- **Primary metric:** precision@10 for the weekly review list (the share of the week's top school-weeks that contain a real problem), with a 95% block bootstrap over weeks. Also precision, recall and F1 on school-days, recall per type and on held-out types, false flags per 1,000 ordinary days, and fit time.
- **Decision rule:** the highest precision@10; a method within the bootstrap interval of the leader counts as tied, and ties go to the simpler method, then to the faster fit on 50,000 rows. The deployment-matching test then checks the choice the way the system runs it.

Version 6 came from an audit of version 5 ([anomaly-model-audit.md](anomaly-model-audit.md)): four statistics in the features used whole-dataset values including the test months; settings were chosen on the same years the models were fitted on; the grids were narrow; and food rounded to the nearest 0.5 kg read as unusual at small schools. Versions 3 and 5 had also changed the features after finding problems (context flags read as evidence; closing days read as a collapse). Every change was committed before the run it affected, and every earlier version's results stay in git history.

## 5. Results (version 6)

**Main evaluation** ([report](../forecasting/data/reports/anomaly/anomaly_evaluation.md)). The best precision@10 any method could reach is 27.8%, because most weeks have fewer than 10 problem school-weeks.

| Method | Precision@10 | Recall, held-out types | False flags per 1,000 ordinary days | Fit on 50,000 rows |
|---|---|---|---|---|
| Fixed rules | 12.8% | 63.1% | 26.0 | 0.00 s |
| Robust z-score | 15.3% | 55.5% | 41.9 | 0.07 s |
| Isolation Forest | 18.6% | 65.4% | 66.4 | 1.43 s |
| **Extended Isolation Forest** | **21.1%** | 82.5% | 64.5 | 0.59 s |
| One-class SVM | 20.0% | 76.8% | **35.8** | 0.21 s |
| SGD one-class SVM | 18.9% | 77.2% | 40.0 | 0.33 s |
| Local Outlier Factor | 18.9% | 95.4% | 71.9 | 64.73 s |

Extended Isolation Forest leads; the one-class SVM is not distinguishable from it at 95%, and the rule's speed tie-break names the SVM. By type, Extended Isolation Forest found all 6 store-count days of stock leakage (the SVM none), 44% of inflated-headcount days (8%) and 88% of ghost-learner days (73%); the SVM was better on round-number entry (62% against 49%) and consumption drift (68% against 61%).

**Robustness** ([report](../forecasting/data/reports/anomaly/robustness/anomaly_robustness.md)): the protocol on 6 differently generated scenarios × 3 seeds. No method is robustly best under the plan's rule. Extended Isolation Forest has the best average rank (1.69; SGD one-class SVM 2.78, the one-class SVM 3.81) and leads in 9 of 18 runs. As coded, it is "recommended or tied with the recommended method" in 6 of 18, because a method that leads but loses the speed tie-break is not counted as tied; counting it, 14 of 18. Its weaker scenarios are noisier day-to-day figures (ranks 2, 3.5 and 3.5, where the one-class SVM is best) and subtler problems (3, 1 and 2), each by less than 1 point of precision.

**Deployment-matching test** ([report](../forecasting/data/reports/anomaly/deployment/anomaly_deployment_test.md)): each sub-county refitted every 20 school days on its last 125, no labels and no threshold, the top 3 school-weeks a week, follow-up weeks left out of later fits; 4 datasets × 5 model seeds. Precision@3: Extended Isolation Forest 15.8%, SGD one-class SVM 15.2%, Isolation Forest 14.8%, Local Outlier Factor 14.6%, one-class SVM 14.6%, fixed rules 9.6%. The one-class SVM is 1.2 points behind, outside the plan's 1 point, so by the plan's rule the evaluation's tie-break does not carry over to deployment, and Extended Isolation Forest does best deployed. In school-year-end weeks it reaches 83% of the best possible (74% in other weeks).

**Decision.** Extended Isolation Forest is the deployed method: it leads the main evaluation and the deployment test, has the best robustness rank, and finds more of the problems it was never tuned on. The one-class SVM stays in the evaluation as the benchmark; SGDOneClassSVM is the documented option if one model is ever fitted on far more records than a sub-county's. Before the switch, the v6 results were reproduced (the main evaluation exactly, the deployment test's 40 runs for both methods, and two robustness runs), and the rules were checked against their code ([anomaly-model-audit.md](anomaly-model-audit.md#11-decision-verification-after-protocol-version-6)).

**Are the reasons faithful?** ([plan](../forecasting/config/explanation_faithfulness.yaml), [report](../forecasting/data/reports/anomaly/explanations/explanation_faithfulness.md)). The reasons come from resetting each feature to the sub-county's median (section 6). The method gives the same answer every time, unlike LIME's random sampling, and works with Extended Isolation Forest's slanted splits, which the fast tree version of SHAP cannot handle. To check that the two named features really are what the model reacted to, the deployed method was run as in the deployment test (4 datasets, 3,456 listed school-weeks). On each listing's top day, the named pair was reset together and compared with every other pair of features:
- Resetting the named pair lowers the score by 98% of what the best possible pair does.
- The named pair beats the median pair in every listing.

For listings holding one injected problem, at least one reason is a figure that problem changes:

| Problem | How often | By chance |
|---|---|---|
| Backdated bulk entry | 100% | 57% |
| Ghost learners | 95% | 66% |
| Consumption drift | 95% | 37% |
| Round-number entry | 92% | 26% |
| Inflated headcount | 63% | 57% |
| Stock leakage | 57% | 13% |

Inflated headcount is only just above chance. On the main dataset, its listings were most often given day-to-day steadiness, recent food trends or after-hours entry as reasons, rather than the headcount comparisons. The school-week is found, but the reasons point the officer at the wrong figures, so this is a known weakness of the explanations. A second model seed gives the same two reasons for 94.5% of school-weeks listed under both.

**Behaviour tests** ([`test_anomaly_behaviour.py`](../forecasting/tests/test_anomaly_behaviour.py), CheckList style). These run the deployed scorer on a generated sub-county:
- **Must be listed:** a feeding day with nobody fed but food issued (validation lets this through; it refuses food on a day marked not fed); more learners fed than enrolled; a store count ten days of food short; three weeks entered together long after.
- **Must not change the list:** the order records arrive in; renamed sync batches; the hour of a record within school hours; scoring the same records twice.
- **Must not lower the score:** more learners recorded as fed; more food for the same learners; records reaching the server later.

## 6. In the system

The scoring service ([`forecasting/services/scoring_service.py`](../forecasting/services/scoring_service.py)) receives one sub-county's records from the API and returns the week's ranking; it stores nothing and never reads the database.

1. The model is Extended Isolation Forest (isotree, 300 trees, splits on combinations of 2 features, 1,024-row samples) on robust-scaled features, fitted on the sub-county's previous 125 school days, about two terms. Refit points fall every 20 school days, so the model changes about monthly and no model file is kept; the seed is fixed, so the same week gives the same list.
2. School-weeks an officer marked follow-up are left out of the fit, so a confirmed problem does not become normal.
3. Each school's week takes its highest-scoring day. The top 3 are the week's list; every school is returned in order. No threshold is used.
4. Reasons come from the model itself: each feature of the top day is set in turn to its median in the sub-county's training records, and the two that lower the score most are named in plain words ("learners fed 16% below the school's usual number").
5. Fixed rules run alongside, and their breaches are shown for every school, whatever its rank.
6. A sub-county with fewer than 60 school days of records is ranked by the fixed rules alone.
7. A school listed again shows the officer's latest decision on it from the previous four weeks, and whether it was on last week's list.

## 7. Limitations

- **Synthetic data only.** The comparison shows how the methods behave on records shaped like Kenyan school feeding records, not how often they would be right at real schools. Before officers rely on the list, a pilot should compare a few terms of lists with schools' registers and store books and recalibrate the settings; the evaluation scripts re-run on any dataset in the same format.
- **More single-day false alarms, not more listings.** At a fixed threshold Extended Isolation Forest flags 64.5 of every 1,000 ordinary school-days, against the one-class SVM's 35.8. The deployed list uses no threshold: each officer gets exactly 3 schools a week, and in the deployment test Extended Isolation Forest's lists held fewer ordinary weeks than the SVM's. The cost would appear only if its scores were used to flag individual days.
- **The same school can stay on the list.** In the deployment test 44% of ordinary listings had the same school listed the week before (42% for the SVM), because some features stay unusual for a whole term (an ordinary enrolment change, for example). The list shows the officer's earlier decision on such a school, but does not drop it; suppressing explained schools would change the ranking and needs its own evaluation.
- **Fair across groups, at the weekly level.** No school-size third or programme type is listed for nothing more than 1.11 times its share (the plan's limit is 1.5). Single-day false alarms were uneven in the test year, but not in the selection year, and did not carry into the lists.
- **The problems are the ones that were imagined.** Held-out types test this partly; a new kind of misreporting may still be missed.
- **A list is not a finding.** Many listed weeks have an ordinary explanation (a school event, a late sync, a new term). The officer's notes are the only judgement in the system.
- **Records that never sync cannot be ranked.** Analytics show how far behind each school's synced records are, and should be read first.
- **A compiled dependency.** isotree has no ready-built Linux package for its pinned version, so the Docker image compiles it in a build stage, which lengthens the first build.

An audit of this comparison (scaling, leakage, training contamination, settings, scalability, SGDOneClassSVM and fairness across schools), with the checks made before the switch, is in [anomaly-model-audit.md](anomaly-model-audit.md).

## 8. Reproducing

```bash
python forecasting/scripts/generate_feeding_dataset.py
python forecasting/scripts/evaluate_anomaly_detection.py
python forecasting/scripts/run_anomaly_robustness.py
python forecasting/scripts/run_anomaly_deployment_test.py
python forecasting/scripts/check_explanation_faithfulness.py
```

Runtimes on a laptop: about 2, 23, 38 and 5 minutes for the last four. The faithfulness check reads the datasets the deployment test generates, so run it after that test. `isotree` (Extended Isolation Forest) is in `requirements.txt`; on Windows and macOS pip installs a ready-built package, on Linux it compiles (the Docker image does this in a build stage).
