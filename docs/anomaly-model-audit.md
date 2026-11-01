# Audit of the anomaly-detection models before final selection

An audit of the existing implementation and evaluation (protocol version 5), done before committing to a model. Nothing that the evaluation, the robustness study, the deployment test or the deployed service use was changed. The new experiments below are **exploratory**: they were run after version 5's results were known and were not pre-registered, so they test the existing conclusion rather than replace it. Script: [`forecasting/scripts/audit_anomaly_models.py`](../forecasting/scripts/audit_anomaly_models.py); results: [`anomaly_model_audit.json`](../forecasting/data/reports/anomaly/audit/anomaly_model_audit.json). All figures are on **synthetic data** (section 5); none comes from real school records.

Issues are classed **Critical** (must be resolved before model selection), **Important** (should be resolved to improve reliability) or **Future** (relevant to expansion, not to the prototype).

## 1. Executive summary

The evaluation is sound enough to select a model for the prototype, and the evidence supports keeping the one-class SVM. The audit found no critical flaw in the comparison. It found five things worth correcting or stating, and checked each one by experiment:

| Finding | Measured effect | Class |
|---|---|---|
| Feature statistics (the day-type effect, some medians used to fill gaps) were computed over the whole dataset, including test months | Rebuilding features from records up to each week only (as the deployed service does): SVM precision@10 21.4% → 20.8%, the ranking unchanged | Important |
| Settings and thresholds are chosen on the same period the models are fitted on; there is no separate validation period | Threshold-based F1 is optimistic; precision@10, the primary metric, uses no threshold | Important |
| The SVM's grid tried only `gamma = "scale"` and two values of `nu` | 15 settings tried: precision@10 18.3%–21.4%; one setting (`gamma` × 3) roughly doubles false alarms | Important |
| False alarms fall unevenly: small schools and cash-transfer schools are flagged more on ordinary days | SVM: 109 per 1,000 ordinary days at small schools, 46 at large ones | Important |
| SGDOneClassSVM had never been evaluated | Same protocol: precision@10 20.0%, held-out recall 95.8%, fit time linear in rows | Future |

The one condition that cannot be met before selection, and must be met before **operational** use, is checking the method and its settings on real records (section 8, item 1).

## 2. Current implementation

**Models implemented** ([`forecasting/anomaly/methods.py`](../forecasting/anomaly/methods.py)): fixed rules; robust z-score (each school against its own history); Isolation Forest (scikit-learn); Extended Isolation Forest (isotree, evaluation only); one-class SVM (scikit-learn, RBF kernel, fitted on a sample of up to 5,000 rows); Local Outlier Factor. **Not implemented:** SGDOneClassSVM (evaluated for the first time in this audit, in the audit script only).

**Models evaluated:** all six, in the main evaluation, the robustness study (6 scenarios × 3 seeds) and the deployment-matching test (4 datasets × 5 model seeds), all under protocol version 5.

**Data:** one synthetic dataset per run ([`feeding_dataset.yaml`](../forecasting/config/feeding_dataset.yaml)): 40 schools in 4 sub-counties, 2024 to October 2026, 20,360 school-days. Tuning period 2024–2025 (13,600 school-days, of which 588 are injected anomalies of the three tuning types); test period January–October 2026 (6,760 school-days, 417 anomalous, all six types; the three held-out types appear only here).

**Features:** the same 15 for every learned method, fixed in the protocol ([section 3 of anomaly-detection.md](anomaly-detection.md#3-features) and section 6 below). The robust z-score uses 14 of them per school; the rules use their own fixed thresholds.

**Evaluation scripts:** [`evaluate_anomaly_detection.py`](../forecasting/scripts/evaluate_anomaly_detection.py), [`run_anomaly_robustness.py`](../forecasting/scripts/run_anomaly_robustness.py), [`run_anomaly_deployment_test.py`](../forecasting/scripts/run_anomaly_deployment_test.py), each following a protocol committed before it was run.

**Same conditions?** Yes: every method gets the same rows, split, features, anomaly scenarios, threshold rule (the score quantile with the best F1 on the tuning period) and metrics, and the same size of settings grid.

## 3. Scalability assessment

Fit and score times on rows resampled from the real feature matrix (audit E5; one laptop core; scoring is 5,000 rows):

| Rows | One-class SVM as deployed (5,000-row sample) | One-class SVM on all rows | Isolation Forest (100 trees) | SGDOneClassSVM (Nystroem, 300 components) |
|---|---|---|---|---|
| 5,000 | fit 0.09 s · score 0.11 s | fit 0.09 s | fit 0.15 s · score 0.03 s | fit 0.14 s · score 0.06 s |
| 20,000 | fit 0.11 s | fit 1.36 s (1,053 support vectors) | fit 0.21 s | fit 0.41 s |
| 50,000 | fit 0.08 s | fit 11.5 s (2,542 support vectors) | fit 0.28 s | fit 0.92 s |
| 200,000 | fit 0.09 s | not run (grows with the square of the rows) | fit 0.40 s | fit 3.80 s |

- **Kernel:** RBF (`gamma = "scale"`). A full RBF one-class SVM grows roughly with the square of the rows (×13 for ×4 rows here) and its model with the number of support vectors, so on all rows it would become impractical in the hundreds of thousands.
- **Why the deployed one is not:** it is fitted per sub-county on the last 125 school days, and on at most 5,000 of those rows. A sub-county of 10–40 schools gives 1,250–5,000 rows, so the sample rarely even applies, and the cost stays the same however many sub-counties the programme has: each is scored separately.
- **Isolation Forest** is the cheapest at every size and would be the practical choice if one model were ever fitted on a whole county's or the country's records.
- **SGDOneClassSVM** with a Nystroem approximation of the same kernel grows linearly (3.8 s at 200,000 rows) and, in E1, ranks almost as well as the kernel SVM. It is the natural successor *if* a single pooled model were needed; with per-sub-county fitting it brings no advantage now. **Future.**
- **Different schools:** the features compare each school with its own usual numbers, its enrolment, its peers on the same day and its last term, so a large school is not unusual for being large. The uneven false alarms in section 7 show this is not complete. **Important.**
- **Memory** was not measured directly; model size (support vectors, trees) is reported above. **Future.**

## 4. Feature scaling and preprocessing audit

| Question | Finding |
|---|---|
| Scaler | `RobustScaler` (median and interquartile range), then clipping to ±10, inside every learned method's `fit` ([`_Learned`](../forecasting/anomaly/methods.py)). Robust scaling suits counts and ratios with long tails better than a standard scaler. |
| Same for every model | Yes for Isolation Forest, Extended Isolation Forest, the one-class SVM and LOF (tree methods do not need it, and it does not hurt them). The z-score scales per school; the rules use raw values against fixed thresholds. |
| Fitted only on training data | Yes: on the tuning period in the evaluation, and on the 125-day window in deployment. |
| Validation and test transformed with the training scaler | Yes: scoring uses the scaler fitted in `fit`. |
| scikit-learn `Pipeline` | Not a `Pipeline` object, but the scaler lives inside each model's fit and score, which prevents the same leakage. Converting is optional. |
| Missing and extreme values | Days without feeding are neutral on the feeding features; an unrecorded "learners present" takes the typical value, so schools that leave it empty are not singled out; extremes are clipped after scaling; invalid values are refused earlier by validation and database constraints. |
| Feature selection | Fixed in the protocol with a reason for each feature; identical for every learned method. |

**Leakage found (Important).** The scaler does not leak, but four statistics in [`features.py`](../forecasting/anomaly/features.py) are computed over all the rows given to `build_features`: the effect of each kind of day on learners fed, the school median used to fill `fed_rate` on non-feeding days, the median used to fill `uptake`, and the daily use that turns a store-count gap into days of food. They use no labels, but in the evaluation they include test months, so a test day's features can depend on later days. The deployed service is not affected in the same way: it builds features only from records up to the end of the week being scored. Audit E4 rebuilt every test week's features from records up to that week only:

| Method | Precision@10, whole-dataset features | Precision@10, records up to each week | F1, before → after |
|---|---|---|---|
| Fixed rules | 12.8% | 12.8% | 47.8% → 49.8% |
| Isolation Forest (100 trees, 256 rows) | 18.3% | 16.9% | 40.5% → 40.0% |
| One-class SVM | 21.4% | 20.8% | 50.0% → 49.5% |
| SGDOneClassSVM | 20.0% | 20.0% | 51.1% → 51.0% |

The effect is small and does not change the ranking; the leakage-free figures are the more honest ones to quote. The fix is to compute these statistics from earlier records only, then re-run all three studies as protocol version 6.

## 5. Training data quality audit

**What the data is.** Synthetic, generated from documented assumptions; not real operational records, and not validated against any. Assumptions for **normal** operation: school enrolment 180–950 and term-to-term changes; participation 82–95%; day effects for opening, closing and break days; day-to-day noise; food issued close to the ration with rounding; in-kind deliveries 1–4 weeks into the term, 15% of them short of the note; monthly purchases at cash-transfer schools; monthly store counts with small errors; genuine losses about 1.5 times a school year; most records entered the same day, some 1–3 days late, synced in batches every 1–5 school days, a few entered after hours. Assumptions for **anomalies**: 14 episodes a year across all schools, 10–30 school days each, of six types with stated strengths (for example headcount inflated by 12–35%).

**Contamination.** The tuning period deliberately contains its injected anomalies (588 of 13,600 school-days, 4.3%), because a deployed model is fitted on unlabelled records that may contain problems. The fitted models never see labels; labels are used only to choose settings and thresholds. Audit E2 refitted on the tuning period with the labelled anomalies removed:

| Method | Precision@10, as evaluated | Precision@10, trained on clean rows | F1, as evaluated → clean |
|---|---|---|---|
| One-class SVM | 21.4% | 21.7% | 50.0% → 58.6% |
| SGDOneClassSVM | 20.0% | 20.8% | 51.1% → 57.3% |
| Isolation Forest (100 trees, 256 rows) | 18.3% | 16.9% | 40.5% → 35.8% |

At 4% contamination the ranking hardly changes; `nu = 0.05` already allows 5% of training rows outside the boundary. A cleaner baseline would sharpen the threshold-based flags.

**Representativeness.** The data covers ordinary variation in attendance, the school calendar (including closing days), late and short deliveries, losses, days without food and late syncing. It does not cover shocks that real programmes see (drought, floods, strikes, a change in the ration, a new school joining mid-term), boarding schools, or real staff behaviour. **Important**: until real records exist, a list from the model can also reflect events the data never contained.

**Recommended baseline strategy** (most of it is already built): fit each sub-county on its own last 125 school days; leave out school-weeks an officer marked follow-up; rank by the fixed rules alone until a sub-county has 60 school days; and in a pilot, review the first terms' lists against schools' paper registers before relying on them. The records officers mark "explained" become the first real check of how often the list is right.

## 6. Evaluation methodology audit

- **Fairness:** same rows, split, features, scenarios, threshold rule, metric and grid size for every method. **Met.**
- **Separation of normal and anomalous rows:** labels mark each school-day inside an injected episode; normal rows are everything else. **Met.**
- **Plausibility of the anomalies:** each type is a documented operational irregularity (inflated headcounts, food issued per learner creeping up, food leaving the store unrecorded, bulk backdated entry, made-up round numbers, inflated enrolment), not a random number change, and the robustness study halves their strength to check that subtle cases are found. Backdated bulk entry is found by every method, the rules included, so it is close to obvious; the comparison does not rest on it.
- **Information available at detection time:** features use only the school's records up to that day, apart from the whole-dataset statistics in section 4. Stock leakage is labelled on every day of its episode but can only show on store-count days, which lowers every method's recall on it; this is reported separately (recall on count days).
- **Validation (Important):** settings and thresholds are chosen on the tuning period that the models are fitted on, and the test period is used once. A model chosen on the data it was fitted on can look better there than it is, which affects the threshold-based figures (precision, recall, F1); precision@10 needs no threshold. Splitting the tuning period (fit on 2024, choose on 2025) would remove this.
- **Metrics:** precision@10 (primary), precision, recall, F1, false flags per 1,000 ordinary days, recall per type and on held-out types, the confusion counts, fit and score time. Not accuracy, which would be 93% for flagging nothing.
- **One-class SVM settings:** `nu` from {0.02, 0.05} and `gamma = "scale"`, chosen by tuning F1. Audit E3 widened this to `nu` {0.01, 0.02, 0.05, 0.1, 0.2} × `gamma` {0.3, 1, 3} × scale. Test precision@10 stays between 18.3% and 21.4%; `gamma` × 3 lowers tuning F1 (0.24) and raises false alarms to 17.8% of ordinary days, so it would rightly not be chosen. On tuning F1 alone, `gamma` × 0.3 would win (0.35 against 0.32), with test precision@10 of 20.3%, fewer false alarms (5.7%) and slightly lower recall (70.5%). The deployed setting is reasonable, but not the tuning optimum of the wider grid. **Important.**
- **Isolation Forest settings:** `n_estimators` {100, 300} × `max_samples` {256, 1,024}, chosen 300 / 1,024. E3: with 50–500 trees, precision@10 17.8%–20.0%; the larger sample helps a little. `contamination` only sets a threshold: E3 confirmed it leaves the scores unchanged, and the evaluation sets thresholds itself, so it plays no part.
- **Comparable scores:** each method's scores are only used to rank (precision@10) or are cut at the method's own threshold chosen on the tuning period, so scores from different algorithms are never compared directly. **Met.**

## 7. Model performance comparison

Test period (January–October 2026), the protocol's procedure; 417 anomalous and 6,343 ordinary school-days. One-class SVM and Isolation Forest from the version 5 evaluation (the audit reproduced the SVM's counts exactly); SGDOneClassSVM from audit E1 (`nu` 0.05, 300 components, chosen by tuning F1).

| Evaluation criterion | One-class SVM | Isolation Forest | SGDOneClassSVM |
|---|---|---|---|
| Detection performance (precision@10) | **21.4%** | 20.0% | 20.0% |
| Precision | 37.5% | **48.9%** | 38.8% |
| Recall | **74.8%** | 49.6% | **74.8%** |
| F1-score | 50.0% | 49.3% | **51.1%** |
| False-positive rate (ordinary days flagged) | 8.2% | **3.4%** | 7.8% |
| Confusion (TP / FP / FN / TN) | 312 / 519 / 105 / 5,824 | 207 / 216 / 210 / 6,127 | 312 / 493 / 105 / 5,850 |
| Recall on held-out problem types | **96.2%** | 60.8% | 95.8% |
| Precision@10, leakage-free features (E4) | **20.8%** | 16.9% (100 trees, 256 rows) | 20.0% |
| Feature scaling requirements | Needs scaling (distance kernel); robust scaling applied | None needed; applied anyway | Needs scaling; robust scaling applied |
| Sensitivity to training contamination (E2, precision@10 as-is → clean) | Low (21.4% → 21.7%) | Low (18.3% → 16.9%, 100 trees, 256 rows) | Low (20.0% → 20.8%) |
| Training time, 50,000 rows | 0.08–0.13 s as deployed (sample); 11.5 s on all rows | 0.28 s (100 trees); 0.85 s (300 trees, 1,024 rows) | 0.92 s |
| Prediction time, 5,000 rows | 0.1 s | 0.03–0.1 s | 0.06 s |
| Scalability | Quadratic on all rows; bounded as deployed (per sub-county, 5,000-row cap) | Near-linear, cheapest | Linear |
| Suitability for current prototype | Yes (recommended) | Yes (close alternative) | Yes, no advantage now |
| Suitability for future expansion | Yes while fitted per sub-county; not as one pooled model | Yes | Yes, the natural successor for one pooled model |

**What the errors cost.** A false positive sends an officer to look at a school whose week had an ordinary explanation (a delayed delivery, a sports day, a late sync): it costs an officer's time and, if handled badly, a school's goodwill, which is why every listing says "needs review" and the list is capped at 3 a week. A false negative leaves a real problem unseen until the next audit. The SVM trades more false alarms on individual days for many fewer missed problems, and the weekly cap keeps the officer's workload fixed whatever the false-alarm rate.

**Where false alarms fall (E6, Important).** On ordinary days the SVM flags 109 per 1,000 at the smallest third of schools, 93 at medium and 46 at the largest; 106 at cash-transfer schools and 66 at in-kind schools. Isolation Forest shows the same pattern, less strongly (95 / 69 / 51; 84 / 63). Small schools' shares move more from day to day (one absent class is a bigger share), and cash-transfer schools' monthly purchases make stock figures lumpier. A small or cash-transfer school is therefore more likely to be listed for nothing. This should be measured in the weekly lists and corrected (for example by scaling day-to-day noise by school size) before officers rely on the list. The analytics and the "needs review" wording reduce, but do not remove, the risk of unfair attention.

## 8. Identified problems and risks

1. **Critical for operational use (not for choosing between methods):** every result is on synthetic data. Before officers act on the list, a pilot must compare a few terms of real lists with schools' registers and store books, and recalibrate `nu` and the list length.
2. **Important:** whole-dataset feature statistics in the evaluation (section 4). Measured effect small; fix in code.
3. **Important:** no separate validation period (section 6).
4. **Important:** a narrow SVM grid; the wider grid prefers `gamma` × 0.3 on tuning F1 (section 6).
5. **Important:** uneven false alarms by school size and programme type (section 7).
6. **Important:** the data does not represent shocks such as drought, strikes or ration changes (section 5).
7. **Important:** the SVM's weak spot is stock leakage (1 of 6 count days); covered by the store-count checks and analytics, not by the model ([anomaly-detection.md](anomaly-detection.md#5-results-version-5)).
8. **Future:** SGDOneClassSVM for a pooled model; memory measurement; converting the scaler to a scikit-learn `Pipeline`.

**Reproducibility: met.** The dataset is regenerated from a fixed seed, its SHA-256 hashes are recorded in each report, and the files on disk match them. Model seeds come from the protocol; package versions are pinned (pandas, numpy, scikit-learn, scipy; isotree for evaluation); every script and protocol is committed. There is no saved model to version: the deployed service refits from the records it is sent, deterministically. This audit reproduced the version 5 one-class SVM's confusion counts exactly, and the audit script gives the same results when run twice (timings apart). The dataset itself is generated rather than committed, so reproduction needs the generator run first.

## 9. Recommended corrections and additional experiments

The smallest defensible set, in order:

1. **Protocol version 6** (Important, before the final write-up): compute the four whole-dataset statistics from earlier records only; split the tuning period into fit (2024) and selection (2025); widen the SVM grid to `nu` {0.02, 0.05, 0.1} × `gamma` {0.3, 1} × scale and Isolation Forest's to the same size; add SGDOneClassSVM as a candidate. Re-run the main evaluation, the robustness study and the deployment test, as before.
2. **Measure listing by school size and programme type** in the deployment test (Important), and if small or cash-transfer schools are over-listed, scale noise-sensitive features by school size.
3. **Pilot on real records** (Critical before operational use): a few terms in one sub-county, officers' decisions recorded, settings recalibrated on what they find.
4. **Future:** memory use at larger sizes, a scikit-learn `Pipeline`, and SGDOneClassSVM if a pooled model is ever needed.

## 10. Final model recommendation

**Keep the one-class SVM (RBF, `nu` 0.05, `gamma` "scale"), fitted per sub-county, as the primary method for the prototype.**

- It has the best weekly-list precision in the main evaluation (21.4%) and after the leakage correction (20.8%), the best robustness rank (recommended in 17 of 18 runs), and it is within 1 point of the best in the deployment test.
- It finds far more of the problems it was never tuned on (96% of held-out problem days, against 61% for Isolation Forest). Real misreporting will not look exactly like what was simulated, so this weighs most.
- Its cost is bounded as deployed (under 0.15 s per fit at any programme size, because each sub-county is fitted separately).

**Answers to the audit's questions:**

1. *Is the one-class SVM sufficiently evaluated to select it?* For the prototype, yes: three pre-registered studies, and this audit's checks for leakage, contamination, settings and fairness do not overturn it. For operational use, not yet: that needs real records.
2. *Is Isolation Forest more practical now?* It is cheaper and raises fewer false alarms on single days, but it finds a third fewer problems and far fewer of the unseen types; at the prototype's scale the SVM's cost is not a constraint. It is the close alternative, not the better choice.
3. *Does SGDOneClassSVM offer a meaningful advantage at the expected scale?* Not now: with per-sub-county fitting the kernel SVM is already fast. It matches the SVM closely (precision@10 20.0%, held-out recall 95.8%), so it is the documented upgrade path if one pooled model is ever needed.
4. *Are the features and training data suitable?* The features measure things officers can check, are computed from records the system collects, and are scaled correctly. The training data is plausible but synthetic and lacks shocks; contamination at its level does not change the ranking.
5. *Are the results reliable enough for a final decision?* For choosing between these methods, yes: the conclusion survives every check here. The absolute figures are synthetic and will move on real data.
6. *What else is needed before committing?* Items 1 and 2 of section 9 strengthen the evaluation; item 3 is needed before officers rely on the list.

**Limitations of this recommendation:** synthetic data only; uneven false alarms by school size not yet corrected; weak on stock leakage, which relies on the store-count checks; settings to be recalibrated in a pilot.
