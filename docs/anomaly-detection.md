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

The comparison follows a protocol written and committed before each run ([`anomaly_evaluation.yaml`](../forecasting/config/anomaly_evaluation.yaml)); every change between versions is recorded there with its reason. Version 7 is the method comparison; version 8 ([`anomaly_v8.yaml`](../forecasting/config/anomaly_v8.yaml)) changed how the weekly list is built (section 5):

- **Methods:** fixed rules and a robust z-score (baselines), and learned methods from the main families of unsupervised detectors: Isolation Forest and Extended Isolation Forest (isolation), the one-class SVM and SGDOneClassSVM (kernel boundary), Local Outlier Factor (density). Each gets six settings.
- **Periods:** models fitted on 2024; settings and the threshold chosen on 2025; the choice refitted on 2024–2025; January–October 2026 tested once.
- **No future records:** every feature uses only records up to the day it describes, as the deployed service can; a test checks that a day's features do not change when later records arrive.
- **Units:** every method scores the same school-days; lists are built from school-weeks (since version 8, the mean of each school's two highest-scoring days that week; before, its highest day). The deployment test is judged on school-weeks within each sub-county-week.
- **Primary metric:** precision@10 for the weekly review list (the share of the week's top school-weeks that contain a real problem), with a 95% block bootstrap over weeks. Also precision, recall and F1 on school-days, recall per type and on held-out types, false flags per 1,000 ordinary days, and fit time.
- **Decision rule:** the highest precision@10; a method within the bootstrap interval of the leader counts as tied, and ties go to the simpler method, then to the faster fit on 50,000 rows. The deployment-matching test then checks the choice the way the system runs it.

Version 7 separated entry from sync timing, added connectivity outages to the data, and added the review threshold, Recall@3, workload, wider fairness, a connectivity check and a feature ablation, all written before the run. Version 6 came from an audit of version 5 ([anomaly-model-audit.md](anomaly-model-audit.md)): four statistics in the features used whole-dataset values including the test months; settings were chosen on the same years the models were fitted on; the grids were narrow; and food rounded to the nearest 0.5 kg read as unusual at small schools. Versions 3 and 5 had also changed the features after finding problems (context flags read as evidence; closing days read as a collapse). Every change was committed before the run it affected, and every earlier version's results stay in git history.

## 5. Results

**Version 8: improving the weekly list** ([plan](../forecasting/config/anomaly_v8.yaml), [report](../forecasting/data/reports/anomaly/v8/anomaly_v8.md)). Version 7's list was cautious: Recall@3 30.3%. A list of at most 3 does not cap it: most sub-county-weeks hold 0 or 1 problem school-weeks, so a perfect model would reach about 99% Recall@3. The gap was in the scoring.

The plan was written and committed before any run. It tested four changes in order, each chosen on 2025 only, and adopted a change only if it beat the current setting by a fixed margin (1 F1@3 point; 2 for the grouped models). The planted problems were not changed. F1@3 on 2025:

| Stage | Candidates (F1@3 on 2025) | Decision |
|---|---|---|
| 1. A school's weekly score | single highest day 30.6%; **mean of the two highest days 40.8%**; 0.6 × highest + 0.4 × second 39.8% | **Adopted** (+10.2 points) |
| 2. Two new features | 10-day trend against similar schools 41.5%; last store count's gap carried 10 days 41.2%; both 41.1% | Not adopted (+0.8, below the margin) |
| 3. One model per group of features, plus one on all | 18.9% | Not adopted (−21.8) |
| 4. Rule breaches listed first | 30.4% | Not adopted (−10.4) |

**Why the weekly score mattered.** With the single highest day, one unusual day at an ordinary school outranks a problem that runs all week. The mean of the two highest days needs a second unusual day. A week with one school day uses that day.

**Why the others did not help.**
- **The grouped models** gave each small model its own chance to look unusual. Taking the highest of five raised the false alarms more than the detections.
- **Listing rule breaches first** filled the list with breaches the model ranked lower and that are already shown to the officer beside the list.
- **The new features** helped a little, inside the run-to-run spread. They stay in the code, unused.

**2026, scored once, for version 8 and version 7:**

| | Precision@3 | Recall@3 | F1@3 | Schools listed per officer-week | Ordinary schools listed per officer-term | Problems caught | Caught within 2 weeks |
|---|---|---|---|---|---|---|---|
| **Version 8 (deployed)** | **53.1%** | **52.4%** | **52.6%** | 0.74 | 4.5 | **88.3%** | **53.6%** |
| Version 7 | 43.8% | 30.3% | 35.7% | 0.52 | 3.8 | 70.3% | 36.1% |

- **A problem** is one planted episode: one school, one type, from its first to its last day, about 37 days on average. It counts as caught if any school-week it covers is listed. The median time to catch one is 1 school week after it starts.
- **Problems caught, by type:**

  | Type | Caught |
  |---|---|
  | Backdated bulk entry | 100% |
  | Ghost learners | 100% (version 7: 75%) |
  | Round-number entry | 92% (58%) |
  | Stock leakage | 92% |
  | Consumption drift | 83% (72%) |
  | Inflated headcount | 63% (25%), the hardest |

- **Fairness:** no group is over-listed. The highest ratio is 1.17 (the limit is 1.5).
- **The cost:** about 0.7 ordinary schools more per officer per term (4.5 against 3.8).
- **Plain reading:** about half the schools listed have a real problem, about half of the problem weeks are listed, and 9 in 10 problems are noticed while they are still going on.

Version 8 did not reopen the choice of method. With the new weekly score the main evaluation still recommends Extended Isolation Forest, now ahead of every other method outside the bootstrap interval (precision@10 22.5%; Isolation Forest 20.6%). The explanation faithfulness check is unaffected: it explains each school's most unusual day, which the weekly score does not change.

One disclosure. While checking the code ran, before the stages, one 2026 figure was printed for a setting that was not the final one. Nothing used it: each stage was decided automatically by the margins on 2025.

**Version 9: an investigation, three changes and an independent test** ([plan](../forecasting/config/anomaly_v9.yaml), [investigation](../forecasting/data/reports/anomaly/v9_investigation/v9_investigation_report.md), [report](../forecasting/data/reports/anomaly/v9/v9_report.md)). 2026 had been looked at for versions 7 and 8, so version 9 developed on 2025 only and was judged once on 10 fresh datasets (seeds 9001–9010).

- **The investigation** (2025, the three types present):
  - a list of 3 is not the limit: a perfect list reaches 100% F1@3;
  - even a model trained with the labels reaches only about 70%, because stock leakage is nearly invisible between store counts;
  - version 8's largest gap is inflated headcount.
- **Three changes were tested in order on 2025, and none met every rule fixed in advance:**
  - **An over-recording signal averaged with the model** listed far more inflated headcount (16% → 70% of weeks), but much less of the other types (F1@3 −7.6 points).
  - **The carried store-count gap** gained +0.4 points, under the margin.
  - **A persistence rule** raised problems caught from 79% to 91%, but F1@3 gained only +0.4, and it listed 1.3 more ordinary schools per officer-term, over the limit of 1.0.
- **So version 9 is version 8,** and the fresh-data test is an independent estimate of the deployed list:

  | Fresh data | Result (95% interval) |
  |---|---|
  | F1@3 | **50.8%** (46.4–55.9%) |
  | Precision@3 | 53.8% |
  | Recall@3 | 48.5% |
  | Problems caught while still going on | **85.2%** (80.6–89.2%) |
  | Caught within 2 weeks | 47.8% |
  | Ordinary schools listed per officer-term | 4.3 |
  | Highest fairness ratio | 1.13 |

  These agree with version 8's 2026 figures, so those were not an artefact of having studied 2026. The weakness left is inflated headcount: 49% of those problems are caught.

**Version 10: two detectors kept apart** ([plan](../forecasting/config/anomaly_v10.yaml), [report](../forecasting/data/reports/anomaly/v10/v10_report.md)). Developed on 10 new datasets (2025), judged once on 20 others (2026, all six types, 1,800 problems).

- **Development:** the over-recording signal finds 20% of problem weeks the isolation model misses. Keeping each detector against its own threshold, rather than averaging them, was adopted with F1@3 +12.7 points.
- **The final test was mixed:**

  | | Version 8 | Version 10 |
  |---|---|---|
  | F1@3 | 53.4% | 53.0% (−0.4, interval −2.5 to +1.4) |
  | Problems caught | 88.4% | **92.8%** (+4.4, +2.2 to +6.6) |
  | Inflated headcount caught | 57% | **94%** |
  | PR-AUC | 0.576 | 0.462 |
  | Day-level F1 | 47.0% | 42.0% |
  | Caught within 2 weeks | 51.6% | 47.1% |

- **Behaviour tests:** two that version 8 passes fail with version 10 in the scorer. A ten-day store shortfall isn't listed, though the fixed check still shows it, and entering later no longer always raises the score.
- **Why development overstated the gain:** development holds only three types, and on all six the extra listings take places from other problems.
- **Version 8 stayed deployed.** Version 10 is reported as a tested option for a programme most concerned with inflated headcount.

**Version 11: repairing the deployed model, measured as it runs** ([plan](../forecasting/config/anomaly_v11.yaml), [report](../forecasting/data/reports/anomaly/v11/v11_report.md)). Version 11 kept Extended Isolation Forest and changed one thing at a time, with version 8 as the benchmark.
- **Measured as the system runs it:** each week is scored on its Sunday with only the records that had arrived, then rescored as late records arrive, up to 28 days. Its figures are lower than earlier versions', which scored every week with all of its records.
- **Developed on 10 new datasets (2025).** Judged once on 20 others (2026, all six types, 1,800 problems). The frozen setting was committed before the test data was generated.

- **Not adopted:** a floor on each feature's scale, a smoothed threshold estimate, a two-week score and a longer training window. None cleared the 1.0-point margin.
- **Adopted, one-sided scoring:** each feature counts only in the direction worth a look. A store count counts when it is short; every other feature counts when it is high. In development, many ordinary listings had been schools feeding *fewer* learners than usual (a sports day, a slow start to term).
- **Adopted, store shortfalls listed directly:**
  - **Evidence:** in development, no ordinary store count was more than 2 days of food short, while 45 of the 82 counts after a leak were.
  - **Rule:** such a school is listed first, with the shortfall as its first reason.
- **Development:** F1@3 rose from 32.7% to 47.0%, and robustness was higher in all 7 scenarios. All behaviour tests pass.
- **The final test:**

  | | Version 8 (q 0.98) | Version 11 (q 0.99) |
  |---|---|---|
  | F1@3 | 41.5% | 41.6% (+0.1, interval −2.8 to +2.9) |
  | Precision@3 | 52.5% | **66.3%** (+13.8, +11.4 to +16.7) |
  | Recall@3 | **34.8%** | 30.5% (−4.2, −7.4 to −1.1) |
  | Problems caught | 69.4% | **74.6%** (+5.1, +0.8 to +9.8) |
  | Ordinary schools listed per officer-term | 3.1 | **1.6** |
  | Stock leakage caught | 41% | **87%** |
  | Round-number entry caught | **82%** | 62% |
  | Median days to catch | 16 | 21 |

- **Version 11 is deployed.** On the primary measure it is level with version 8. It halves the ordinary schools an officer is sent to, two in three of its listings are real, and it catches more problems, especially stock leaks.
- **Why development overstated the gain:** as with version 10, development holds only three types, and q 0.99 was chosen there. At q 0.95 version 11 matches version 8 on the held-out types and leads on F1@3 (45.8% against 43.4%), so the threshold is a programme decision about officers' capacity, for a pilot.
- **Backdated entry and the rescoring window:**
  - The system rescores a week for 4 weeks after it ends, so a week entered later than that is never rescored with its records.
  - Rescored for 56 days, backdated entry is caught 95% of the time instead of 53%.
  - The evidence comes from the test year, the only year with backdated entries, so it should be confirmed on fresh data before the setting changes.

The rest of this section is version 7's method comparison, run again with version 8's weekly score where it applies.


**Main evaluation** (run again with version 8's weekly score; [report](../forecasting/data/reports/anomaly/anomaly_evaluation.md)). The best precision@10 any method could reach is 27.8%, because most weeks have fewer than 10 problem school-weeks.

| Method | Precision@10 | Recall, held-out types | False flags per 1,000 ordinary days | Fit on 50,000 rows |
|---|---|---|---|---|
| Fixed rules (baseline) | 13.3% | 62.7% | **15.5** | 0.00 s |
| Robust z-score (baseline) | 15.8% | 55.5% | 40.5 | 0.06 s |
| Isolation Forest | 20.6% | 56.6% | 40.2 | 0.83 s |
| **Extended Isolation Forest** | **22.5%** | 94.7% | 99.2 | 0.75 s |
| One-class SVM | 20.3% | 78.0% | 36.3 | 0.17 s |
| SGD one-class SVM | 20.6% | 78.3% | 38.6 | 0.28 s |
| Local Outlier Factor | 18.3% | 95.4% | 82.3 | 55.1 s |

Extended Isolation Forest leads, and with version 8's weekly score every other method is outside its bootstrap interval (with version 7's, Isolation Forest was inside it and the speed tie-break decided). Precision@10 is with version 8's weekly score; the day-level columns do not depend on it.
- **By type,** Extended Isolation Forest found 97% of ghost-learner days, 82% of round-number days, 63% of consumption-drift days and 48% of inflated-headcount days.
- **Stock leakage,** which only shows on store-count days, remains the hardest (14%).
- **Its day-level false flags are the highest,** which is why the deployed list uses a review threshold rather than flagging single days.

**Feature ablation** (in the same report; reported, not used to choose features). Removing any single feature changes test precision@10 by less than 3 points; no feature carries the result alone. The ones that matter most:
- the **food** group: −5.3 points in 2025 and −2.5 in 2026 without it;
- **round numbers:** −1.9 and −2.2;
- **enrolment change:** −2.8 in 2026, where the ghost learners are.

The entry-timing features change little on their own, because bulk entry also shows in round numbers and steadiness.

**Robustness** (run again with version 8's weekly score; [report](../forecasting/data/reports/anomaly/robustness/anomaly_robustness.md)): 7 differently generated scenarios × 3 seeds, including one with outages twice as common and up to five weeks long. No method is robustly best under the plan's strict rule. Extended Isolation Forest has the best average rank (**1.43**; SGD one-class SVM 2.21, one-class SVM 3.55, Isolation Forest 3.83; with version 7's weekly score it was 1.50). It ranks first or close to it in every scenario (1.3 under heavy outages), and is weakest with noisier day-to-day figures (2.0; 3.2 with version 7's).

**Deployment-matching test, version 7** ([report](../forecasting/data/reports/anomaly/deployment/anomaly_deployment_test.md)), which version 8 improved on: each sub-county is refitted every 20 school days on its last 125, with no labels. Up to 3 school-weeks a week are listed **above a review threshold**, and follow-up weeks are left out of later fits; 4 datasets × 5 model seeds. The threshold is the q-quantile of the school-week scores in the model's own training window ("more unusual than q of the last two terms' weeks"), chosen per method on 2025 by F1@3. The figures are for 2026:

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

**With version 11's one-sided model** ([report](../forecasting/data/reports/anomaly/explanations/v11/explanation_faithfulness.md); same plan and datasets):
- **Faithful:** the named pair lowers the score by 96.5% of what the best pair does, and beats the median pair in every listing.
- **Stable:** a second seed gives the same two reasons for 98.5% of school-weeks, against 90.1%.
- **Point at the problem:** better than chance for all six types. Inflated headcount is still only just above chance (62% against 57%).
- **Store shortfalls:** a school listed for one is now given the shortfall as its first reason.

**How to read the reasons.** Resetting one feature to the sub-county's median while the others stay as they are can create a combination of values that never happens. For example, learners fed is reset to normal but food issued is left high, although the two move together. So the two reasons are **signals the model reacted to, not a causal explanation** of what happened. The officer sees them as observations to check against the school's register and store book ("learners fed 22% above the school's usual number"), next to the week's actual records and the fixed checks, and always worded "needs review".

**Behaviour tests** ([`test_anomaly_behaviour.py`](../forecasting/tests/test_anomaly_behaviour.py), CheckList style). These run the deployed scorer on a generated sub-county:
- **Must be listed:** a feeding day with nobody fed but food issued (validation lets this through; it refuses food on a day marked not fed); more learners fed than enrolled; a store count ten days of food short; three weeks entered together long after.
- **Must not change the list:** the order records arrive in; renamed sync batches; the hour of a record within school hours; scoring the same records twice.
- **Must not lower the score:** more learners recorded as fed; more food for the same learners; records entered later (since version 8, within 1%: a record entered 5 and one entered 10 school days late are both far outside the usual range, and an isolation model scores both about as high as it can, so the random trees can put the later one a little lower).
- **Must not change the score (version 7):** records entered on time but sent days later, together, as after an outage.

## 6. In the system

The scoring service ([`forecasting/services/scoring_service.py`](../forecasting/services/scoring_service.py)) receives one sub-county's records from the API and returns the week's ranking; it stores nothing and never reads the database.

1. The model is Extended Isolation Forest (isotree, 300 trees, splits on combinations of 2 features, 1,024-row samples) on robust-scaled, **one-sided** features (protocol version 11: a store count counts when it is short, every other feature when it is high), fitted on the sub-county's previous 125 school days, about two terms. Refit points fall every 20 school days, so the model changes about monthly and no model file is kept; the seed is fixed, so the same week gives the same list.
2. School-weeks an officer marked follow-up are left out of the fit, so a confirmed problem does not become normal.
3. Each school's week is scored as the mean of its two highest-scoring days (protocol version 8; one school day: that day). Up to 3 are the week's list. First come schools whose store count is more than 2 days of food short of the records (version 11). Then the highest-scoring, only those above the **review threshold**: the 99th percentile of the school-week scores in the model's training window, scored the same way. A quiet week can list fewer than 3, or none. Every school is returned in order.
4. Reasons come from the model itself, for the school's most unusual day: each feature of that day is set in turn to its median in the sub-county's training records, and the two that lower the score most are named in plain words ("learners fed 16% above the school's usual number"). A school listed for a store shortfall has the shortfall as its first reason, from the day of the count. They are signals to check, not causes (section 5).
5. Fixed rules run alongside, and their breaches are shown for every school, whatever its rank.
6. A sub-county with fewer than 60 school days of records is ranked by the fixed rules alone. Only schools that broke a rule are listed then: with no model, a school that broke none has nothing to point the officer at.
7. A school listed again shows the officer's latest decision on it from the previous four weeks, and whether it was on last week's list.
8. The API scores each finished week by itself, and scores a recent week again when its records change. Officers find the list waiting instead of starting it ([architecture](architecture.md#monitoring)).

## 7. Limitations

- **Synthetic data only.** The comparison shows that anomaly detection is feasible under simulated Kenyan school-feeding conditions: how the methods behave on records shaped like real ones, with planted irregularities. It does not measure how often they would be right about naturally occurring irregularities at real schools, and it is not a measure of real-world fraud detection. Before officers rely on the list, a pilot should compare a few terms of lists with schools' registers and store books and recalibrate the settings; the evaluation scripts re-run on any dataset in the same format.
- **The review threshold trades recall for precision.** At q 0.99 (version 11, as the system runs it), two in three listed schools have a real problem and an officer sees about one school every three weeks, but 30.5% of problem school-weeks are listed. At q 0.95, 88.5% of problems are caught for about five times as many ordinary listings. The fixed checks still show every rule breach. A pilot should set the threshold from the programme's capacity for visits.
- **Under-recording is not ranked.** Since version 11 the model looks only for records that are higher than they should be (and store counts that are short). Fewer learners recorded than were fed, or less food issued, is left to the fixed checks.
- **Backdated entry depends on the rescoring window.** A week entered more than 4 weeks after it ended is never rescored with its records (section 5). Lengthening the window is the fix, to be confirmed first.
- **Leaks wait for a store count.** Food that leaves the store unrecorded shows only when the store is counted, so how quickly leaks are found depends on how often stores are counted, not on the model.
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
cd forecasting && python scripts/run_anomaly_v11.py --step final --workers 4   # version 11; other steps in its report
```

Runtimes on a 12-core laptop: about 3 minutes (with the feature ablation), 22, 35 (in parallel, every threshold) and 4 minutes for the last four. `run_anomaly_deployment_test.py --report-only` rebuilds its report from the saved results. The faithfulness check reads the datasets the deployment test generates, so run it after that test. `isotree` (Extended Isolation Forest) is in `requirements.txt`; on Windows and macOS pip installs a ready-built package, on Linux it compiles (the Docker image does this in a build stage).
