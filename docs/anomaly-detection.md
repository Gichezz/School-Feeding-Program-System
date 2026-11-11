# Anomaly detection for programme officers

The machine learning in the system ranks a sub-county's school-weeks by how unusual their records look, so a programme officer knows which schools to look into first. It does not decide anything: every listed school is worded "needs review", the officer marks it explained or follow-up with a note, and the list says which figures stood out.

## 1. Why monitoring and not demand forecasting

The project first forecast meals per school day (Prophet). On 15 real school canteens (Sweden, 2010–2020; [report](../forecasting/data/reports/swedish/forecast_evaluation.md)), cooking for every enrolled pupil was 15.5% wrong over a two-week window, a 10-day moving average 6.0%, and Prophet 7.2%. A model that does not beat a moving average cannot justify itself, so school-side planning uses the moving average (with the term's enrolment and the school calendar, worked out on the device) and the Prophet work is archived ([archive/forecasting-prophet.md](archive/forecasting-prophet.md)).

**The planning average, and what it is not.** Meal planning is decision support for the school, separate from the anomaly detection research.
- **Why 10 days:** the window was chosen on a validation year (2017) of the Swedish data, before the test years. Its error was 6.28% with 5 school days, **6.24% with 10** and 6.33% with 20. The three are close; 10 was the most accurate.
- **What it averages:** the device averages learners fed over the school's last 10 days **with feeding**. Days without feeding (no food, school closed) and holidays are not records, so they don't pull it down.
- **Its known gaps:**
  - At the start of a term it still uses the last days of the previous term.
  - A closing day with few learners stays in the average for the next 10 days.
- **What the evidence covers:** canteens in Sweden, not Kenyan schools. How well the window works in Kenyan schools is not yet measured; the first terms of real records would show it.

The harder, unmet need is oversight. Feeding programmes pay and deliver by headcount, and audits keep finding inflated numbers: India's 2015 audit of the mid-day meal scheme described "institutionalised exaggeration" of children fed, and Kenya's Auditor-General reported about 87,000 fictitious learners in capitation records (Sh3.7 billion). Health information systems already handle this with data-quality checks (the WHO Data Quality Review, DHIS2 outlier checks). A sub-county officer with dozens of schools cannot check every record, so the system ranks them.

Real attendance data also shows why the kind of day matters: in the Swedish data the last day of the school year was 101% wrong for "cook for everyone enrolled", because most pupils are not there. A closing day is expected, not suspicious; the features below allow for it.

## 2. Data

No real school feeding records were available, so methods are compared on a synthetic dataset built from real Kenyan inputs ([`forecasting/config/kenya_inputs.yaml`](../forecasting/config/kenya_inputs.yaml), [`feeding_dataset.yaml`](../forecasting/config/feeding_dataset.yaml)): 40 schools in 4 sub-counties, the Ministry of Education term dates and public holidays for 2024–2026, the School Meals Programme ration (150 g cereals and 40 g pulses per learner per day), deliveries, losses, store counts, when each record was captured and synced, and (protocol version 7) **connectivity outages**, during which a device records on time but cannot sync. How each problem is generated (frequency, severity, duration, distribution) is in [synthetic-dataset.md](synthetic-dataset.md). The results show that detection is **feasible under simulated Kenyan school-feeding conditions**; they don't measure accuracy on naturally occurring irregularities at real schools.

Six kinds of problem are injected, each with a start, an end and a strength, and labelled day by day. Three are used for tuning; three are **held out** and appear only in the single test run, to see whether a method finds problems it was never tuned on:

| Tuning | Held out |
|---|---|
| inflated headcount (more learners recorded as fed than were fed) | backdated bulk entry (many past days entered together, long after the fact) |
| consumption drift (food issued per learner creeps up) | round-number entry (figures made up, not counted) |
| stock leakage (food leaves the store unrecorded; shows only at store counts) | ghost learners (enrolment inflated for a term) |

## 3. Features

Fifteen per school-day, each a figure an officer could check by hand ([`forecasting/anomaly/features.py`](../forecasting/anomaly/features.py); fixed in the protocol). The kind of day (opening days, closing day, days before and after a break) adjusts what is normal; it is never evidence.

**Entering late is not the same as syncing late** (version 7). Entry delay and entry batches are measured from when a record was entered on the device. **Sync delay** (from entry to arrival at the server) and **sync batch size** are computed for analytics but are not features: a school that recorded every day on time during an outage, then sent it all at once, gets no higher score for it. Version 6 measured delay to the server, and the connectivity check below shows what that did.

| Feature | Measures |
|---|---|
| `fed_rate`, `fed_vs_own`, `fed_vs_peers`, `fed_rate_vs_last_term` | learners fed for that kind of day: against enrolment, the school's usual number, similar schools nearby that day, and the school's share last term |
| `enrolment_change`, `uptake` | enrolment against last term; learners fed against learners present |
| `cereal_ratio`, `pulse_ratio`, `usage_trend` | food issued against the ration for learners fed, and its recent rise |
| `count_gap_change` | the new gap between a store count and the ledger, in days of food |
| `entry_delay`, `entry_batch`, `after_hours_share` | how many school days after the date a record was **entered** on the device, how many dates were entered in the same sitting, and how often the school enters records out of hours |
| `round_share`, `fed_steadiness` | round numbers, and learners fed hardly changing from day to day |

## 4. Protocol

The comparison follows a protocol written and committed before each run ([`anomaly_evaluation.yaml`](../forecasting/config/anomaly_evaluation.yaml)); every change between versions is recorded there with its reason. Version 7 is current:

- **Methods:** fixed rules and a robust z-score (baselines), and learned methods from the main families of unsupervised detectors: Isolation Forest and Extended Isolation Forest (isolation), the one-class SVM and SGDOneClassSVM (kernel boundary), Local Outlier Factor (density). Each gets six settings.
- **Periods:** models fitted on 2024; settings and the threshold chosen on 2025; the choice refitted on 2024–2025; January–October 2026 tested once.
- **No future records:** every feature uses only records up to the day it describes, as the deployed service can; a test checks that a day's features do not change when later records arrive.
- **Units:** every method scores the same school-days; lists are built from school-weeks (each school's highest-scoring day that week). The deployment test is judged on school-weeks within each sub-county-week.
- **Primary metric:** precision@10 for the weekly review list (the share of the week's top school-weeks that contain a real problem), with a 95% block bootstrap over weeks. Also precision, recall and F1 on school-days, recall per type and on held-out types, false flags per 1,000 ordinary days, and fit time.
- **Decision rule:** the highest precision@10; a method within the bootstrap interval of the leader counts as tied, and ties go to the simpler method, then to the faster fit on 50,000 rows. The deployment-matching test then checks the choice the way the system runs it.

Version 7 separated entry from sync timing, added connectivity outages to the data, and added the review threshold, Recall@3, workload, wider fairness, a connectivity check and a feature ablation, all written before the run. Version 6 came from an audit of version 5 ([anomaly-model-audit.md](anomaly-model-audit.md)): four statistics in the features used whole-dataset values including the test months; settings were chosen on the same years the models were fitted on; the grids were narrow; and food rounded to the nearest 0.5 kg read as unusual at small schools. Versions 3 and 5 had also changed the features after finding problems (context flags read as evidence; closing days read as a collapse). Every change was committed before the run it affected, and every earlier version's results stay in git history.

## 5. Results (version 7)

**Main evaluation** ([report](../forecasting/data/reports/anomaly/anomaly_evaluation.md)). The best precision@10 any method could reach is 27.8%, because most weeks have fewer than 10 problem school-weeks.

| Method | Precision@10 | Recall, held-out types | False flags per 1,000 ordinary days | Fit on 50,000 rows |
|---|---|---|---|---|
| Fixed rules (baseline) | 13.1% | 62.7% | **15.5** | 0.00 s |
| Robust z-score (baseline) | 15.0% | 55.5% | 40.5 | 0.06 s |
| Isolation Forest | 20.0% | 56.7% | 40.2 | 0.83 s |
| **Extended Isolation Forest** | **21.7%** | 94.7% | 99.2 | 0.75 s |
| One-class SVM | 19.7% | 78.0% | 36.3 | 0.17 s |
| SGD one-class SVM | 19.4% | 78.3% | 38.6 | 0.28 s |
| Local Outlier Factor | 18.1% | 95.4% | 82.3 | 55.1 s |

Extended Isolation Forest leads. Isolation Forest is within its bootstrap interval, and the speed tie-break names Extended Isolation Forest (0.75 s against 0.83 s).
- **By type,** Extended Isolation Forest found 97% of ghost-learner days, 82% of round-number days, 63% of consumption-drift days and 48% of inflated-headcount days.
- **Stock leakage,** which only shows on store-count days, remains the hardest (14%).
- **Its day-level false flags are the highest,** which is why the deployed list uses a review threshold rather than flagging single days.

**Feature ablation** (in the same report; reported, not used to choose features). Removing any single feature changes test precision@10 by less than 3 points; no feature carries the result alone. The ones that matter most:
- the **food** group: −5.3 points in 2025 and −2.5 in 2026 without it;
- **round numbers:** −1.9 and −2.2;
- **enrolment change:** −2.8 in 2026, where the ghost learners are.

The entry-timing features change little on their own, because bulk entry also shows in round numbers and steadiness.

**Robustness** ([report](../forecasting/data/reports/anomaly/robustness/anomaly_robustness.md)): 7 differently generated scenarios × 3 seeds, including a new one with outages twice as common and up to five weeks long. No method is robustly best under the plan's strict rule. Extended Isolation Forest has the best average rank (**1.50**; SGD one-class SVM 2.33, LOF 3.48, one-class SVM 3.88). It ranks first or close to it in every scenario (1.5 under heavy outages), and is weakest with noisier day-to-day figures (3.2).

**Deployment-matching test** ([report](../forecasting/data/reports/anomaly/deployment/anomaly_deployment_test.md)): each sub-county is refitted every 20 school days on its last 125, with no labels. Up to 3 school-weeks a week are listed **above a review threshold**, and follow-up weeks are left out of later fits; 4 datasets × 5 model seeds. The threshold is the q-quantile of the school-week scores in the model's own training window ("more unusual than q of the last two terms' weeks"), chosen per method on 2025 by F1@3. The figures are for 2026:

| | Precision@3 | Recall@3 | Schools listed per officer-week | Ordinary schools listed per officer-term | Weeks with nothing listed |
|---|---|---|---|---|---|
| **Extended Isolation Forest, threshold q = 0.98 (deployed)** | **43.8%** | 30.3% | 0.52 | **3.8** | 68% |
| Extended Isolation Forest, no threshold (always 3) | 18.9% | **75.0%** | 3 | 31.6 | 0% |
| Isolation Forest, q = 0.95 | 39.1% | 43.7% | 0.84 | 6.6 | 41% |
| Fixed rules (only breaches listed) | 32.1% | 31.1% | 0.71 | 6.2 | 53% |

Extended Isolation Forest has the highest Precision@3 of every method at its chosen threshold, so the evaluation's conclusion holds in deployment. **The threshold is a trade-off, reported as such:**
- **Gains:** an officer sees about one school every two weeks instead of three every week, and 44% of the schools listed have a real problem instead of 19%.
- **Costs:** 30% of problem school-weeks make the short list instead of 75%. At their own thresholds Isolation Forest has the higher F1@3 (41.2% against 35.7%), because Extended Isolation Forest's chosen threshold is stricter.
- **Mitigation:** the **fixed checks still show every rule breach for every school**, whatever the list says, so a school that breaks a rule is never hidden by the threshold.

**Connectivity check.** The same deployed method run with version 6's timing features (delay to the server, dates sent in one sync) on the same data:

| Timing features | Ordinary school-weeks listed, in an outage week | In other weeks |
|---|---|---|
| Version 6 (to the server) | **7.1%** | 2.7% |
| **Version 7 (to entry, deployed)** | **2.8%** | 3.2% |

With version 6's features, ordinary schools were listed 2.6 times as often in weeks they had an outage; with version 7's they are not, and precision and recall are unchanged. **A connectivity outage is no longer read as evidence.**

**Fairness (preliminary).** At the deployed threshold, no group is listed for nothing more than 1.5 times the overall rate. The highest are medium schools and in-kind schools, both 1.24. That covers school size, programme type, each of the four sub-counties, schools that sync every 1–2 days against every 3–5 days, and outage weeks (0.89). Detection rates are reported by group in the report. With 40 synthetic schools these are indications, not conclusions.

**Decision.** Extended Isolation Forest stays the deployed method: it leads the main evaluation and the deployment test at its threshold, has the best robustness rank, and finds the most problems it was never tuned on. The one-class SVM stays as the benchmark, and SGDOneClassSVM as the option if one model is ever fitted on far more records than a sub-county's.

**Are the reasons faithful?** ([plan](../forecasting/config/explanation_faithfulness.yaml), [report](../forecasting/data/reports/anomaly/explanations/explanation_faithfulness.md)). The reasons come from resetting each feature to the sub-county's median (section 6). The method gives the same answer every time, unlike LIME's random sampling, and works with Extended Isolation Forest's slanted splits, which the fast tree version of SHAP cannot handle. To check that the two named features really are what the model reacted to, the deployed method was run as in the deployment test (4 datasets, 3,456 listed school-weeks). On each listing's top day, the named pair was reset together and compared with every other pair of features:
- Resetting the named pair lowers the score by 98.1% of what the best possible pair does (version 7).
- The named pair beats the median pair in every listing.

For listings holding one injected problem, at least one reason is a figure that problem changes:

| Problem | How often | By chance |
|---|---|---|
| Backdated bulk entry | 100% | 57% |
| Round-number entry | 96% | 26% |
| Consumption drift | 96% | 37% |
| Ghost learners | 93% | 66% |
| Stock leakage | 63% | 13% |
| Inflated headcount | 63% | 57% |

Inflated headcount is only just above chance. On the main dataset, its listings were most often given day-to-day steadiness, recent food trends or after-hours entry as reasons, rather than the headcount comparisons. The school-week is found, but the reasons point the officer at the wrong figures, so this is a known weakness of the explanations. A second model seed gives the same two reasons for 90.1% of school-weeks listed under both, and at least one of them for 99.5%.

**How to read the reasons.** Resetting one feature to the sub-county's median while the others stay as they are can create a combination of values that never happens. For example, learners fed is reset to normal but food issued is left high, although the two move together. So the two reasons are **signals the model reacted to, not a causal explanation** of what happened. The officer sees them as observations to check against the school's register and store book ("learners fed 22% above the school's usual number"), next to the week's actual records and the fixed checks, and always worded "needs review".

**Behaviour tests** ([`test_anomaly_behaviour.py`](../forecasting/tests/test_anomaly_behaviour.py), CheckList style). These run the deployed scorer on a generated sub-county:
- **Must be listed:** a feeding day with nobody fed but food issued (validation lets this through; it refuses food on a day marked not fed); more learners fed than enrolled; a store count ten days of food short; three weeks entered together long after.
- **Must not change the list:** the order records arrive in; renamed sync batches; the hour of a record within school hours; scoring the same records twice.
- **Must not lower the score:** more learners recorded as fed; more food for the same learners; records entered later.
- **Must not change the score (version 7):** records entered on time but sent days later, together, as after an outage.

## 6. In the system

The scoring service ([`forecasting/services/scoring_service.py`](../forecasting/services/scoring_service.py)) receives one sub-county's records from the API and returns the week's ranking; it stores nothing and never reads the database.

1. The model is Extended Isolation Forest (isotree, 300 trees, splits on combinations of 2 features, 1,024-row samples) on robust-scaled features, fitted on the sub-county's previous 125 school days, about two terms. Refit points fall every 20 school days, so the model changes about monthly and no model file is kept; the seed is fixed, so the same week gives the same list.
2. School-weeks an officer marked follow-up are left out of the fit, so a confirmed problem does not become normal.
3. Each school's week takes its highest-scoring day. Up to 3 are the week's list: the highest-scoring, and only those above the **review threshold**, the 98th percentile of the school-week scores in the model's training window (protocol version 7). A quiet week can list fewer than 3, or none. Every school is returned in order.
4. Reasons come from the model itself: each feature of the top day is set in turn to its median in the sub-county's training records, and the two that lower the score most are named in plain words ("learners fed 16% below the school's usual number"). They are signals to check, not causes (section 5).
5. Fixed rules run alongside, and their breaches are shown for every school, whatever its rank.
6. A sub-county with fewer than 60 school days of records is ranked by the fixed rules alone. Only schools that broke a rule are listed then: with no model, a school that broke none has nothing to point the officer at.
7. A school listed again shows the officer's latest decision on it from the previous four weeks, and whether it was on last week's list.
8. The API scores each finished week by itself, and scores a recent week again when its records change. Officers find the list waiting instead of starting it ([architecture](architecture.md#monitoring)).

## 7. Limitations

- **Synthetic data only.** The comparison shows that anomaly detection is feasible under simulated Kenyan school-feeding conditions: how the methods behave on records shaped like real ones, with planted irregularities. It does not measure how often they would be right about naturally occurring irregularities at real schools, and it is not a measure of real-world fraud detection. Before officers rely on the list, a pilot should compare a few terms of lists with schools' registers and store books and recalibrate the settings; the evaluation scripts re-run on any dataset in the same format.
- **The review threshold trades recall for precision.** With it, 44% of listed schools have a real problem and an officer sees about one school every two weeks, but 30% of problem school-weeks are listed, against 75% when the top 3 are always shown. The fixed checks still show every rule breach, but problems that break no rule (such as a modest inflated headcount) are more often missed. A pilot should revisit the threshold with the programme's own capacity for visits.
- **More single-day false alarms.** At a day-level threshold Extended Isolation Forest flags 99.2 of every 1,000 ordinary school-days, against the one-class SVM's 36.3. The system never flags single days from the model; it lists school-weeks above the review threshold.
- **The same school can stay on the list.** In the deployment test 44% of ordinary listings had the same school listed the week before (42% for the SVM), because some features stay unusual for a whole term (an ordinary enrolment change, for example). The list shows the officer's earlier decision on such a school, but does not drop it; suppressing explained schools would change the ranking and needs its own evaluation.
- **Fairness is preliminary.** At the deployed threshold no school size, programme type, sub-county, sync interval or outage week is listed for nothing more than 1.24 times the overall rate (the limit is 1.5), and outages no longer raise a school's listing rate. With 40 synthetic schools, these are indications, not conclusions.
- **Small sub-counties.** Each model is fitted on one sub-county (10 schools in the data), so "similar schools nearby" is the median of the other 9. A sub-county with very few schools gives less stable comparisons; peer comparisons are indications, not statistical tests. A sub-county with too little history is ranked by the fixed checks alone.
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

Runtimes on a 12-core laptop: about 3 minutes (with the feature ablation), 22, 35 (in parallel, every threshold) and 4 minutes for the last four. `run_anomaly_deployment_test.py --report-only` rebuilds its report from the saved results. The faithfulness check reads the datasets the deployment test generates, so run it after that test. `isotree` (Extended Isolation Forest) is in `requirements.txt`; on Windows and macOS pip installs a ready-built package, on Linux it compiles (the Docker image does this in a build stage).
