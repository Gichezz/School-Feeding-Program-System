# Anomaly detection: version 9 investigation report (protocol part A)

Plan: [`forecasting/config/anomaly_v9.yaml`](../../../../config/anomaly_v9.yaml), part A, committed before any of this was run. Everything here uses **2025 only** (the development year), and 2024 for the labelled diagnostic's training. **Nothing from 2026 of any dataset was read.** Code: [`forecasting/scripts/v9_investigation/`](../../../../scripts/v9_investigation/). Figures: [`analysis_2025.json`](analysis_2025.json), [`diagnostic_2025.json`](diagnostic_2025.json), [`persistence_2025.json`](persistence_2025.json).

Data: the four version 8 deployment datasets × 5 model seeds; 28,800 school-weeks in 2025, of which 1,545 (5.4%) contain a planted problem. **2024 and 2025 hold only three of the six problem types** (consumption drift, inflated headcount, stock leakage); the other three appear only in 2026 by design. Everything below is about those three.

Version 8 re-run as deployed over 2025 reproduces its reported selection-year figures: Precision@3 47.2%, Recall@3 36.2%, **F1@3 40.7%** (reported 40.8%). Version 8's 2026 figures (F1@3 52.6%) are higher because 2026 adds three types that are easier to find (backdated entry, ghost learners, round numbers).

## 1. Capacity: a list of 3 is not the limit

| Problem school-weeks in a sub-county-week (2025) | 0 | 1 | 2 | 3 | more than 3 |
|---|---|---|---|---|---|
| Sub-county-weeks | 328 | 192 | 51 | 5 | **0** |

No sub-county-week ever holds more than 3 problem school-weeks. A perfect list of at most 3 (empty in quiet weeks) would reach **100% Precision@3, Recall@3 and F1@3**. Version 8 is 59 F1 points short of that, and none of the gap comes from review capacity.

## 2. What the features can separate

### Each feature alone (area under the ROC curve, 2025 school-days; 0.5 = no signal)

| Feature | Consumption drift | Inflated headcount | Stock leakage |
|---|---|---|---|
| usage_trend | **0.90** | 0.56 | 0.53 |
| pulse_ratio | **0.90** | 0.51 | 0.50 |
| cereal_ratio | **0.90** | 0.51 | 0.51 |
| fed_rate_vs_last_term | 0.56 | **0.88** | 0.52 |
| fed_vs_peers_trend (version 8 candidate) | 0.53 | **0.86** | 0.53 |
| fed_vs_peers | 0.51 | **0.85** | 0.52 |
| fed_rate | 0.52 | **0.84** | 0.51 |
| fed_vs_own | 0.55 | **0.83** | 0.57 |
| uptake | 0.59 | 0.81 | 0.58 |
| fed_steadiness | 0.53 | 0.79 | 0.51 |
| count_gap_recent (version 8 candidate) | 0.56 | 0.50 | **0.63** |
| count_gap_change | 0.51 | 0.50 | 0.53 |
| Every other feature | ≤ 0.62 | ≤ 0.62 | ≤ 0.57 |

- **Consumption drift and inflated headcount are clearly visible**, each in several features that measure the same thing.
- **Stock leakage is nearly invisible.** Food that leaves the store unrecorded leaves every daily record looking normal; it shows only on a store-count day. The best feature reaches 0.63, and it's one of version 8's unused candidates.
- **No existing feature needs replacing with a near-duplicate.** The school's own baseline (`fed_vs_own`), the same school last term (`fed_rate_vs_last_term`) and peers in the sub-county (`fed_vs_peers`) already exist, and each model is already per sub-county. Investigation 4's ideas are mostly in place. A programme-type comparison would split 40 schools into two groups, too few to be stable.

### The labelled diagnostic: a benchmark, not a ceiling

A gradient boosting model trained on **2024 with the labels**, evaluated on 2025, with its weekly threshold chosen on 2024 by grouped cross-validation. It is a benchmark of what the features can tell apart. A better model could do better, and it can't be used in the system, because real schools have no labels.

| | F1@3 | Precision@3 | Recall@3 | Drift weeks listed | Inflated headcount listed | Stock leakage listed |
|---|---|---|---|---|---|---|
| Labelled model, version 8's 15 features | 66.0% | 92.9% | 51.1% | 74% | 81% | **1%** |
| Labelled model, + the two version 8 candidates | **70.0%** | 71.9% | 68.0% | 81% | **87%** | **38%** |
| **Version 8 (no labels, as deployed)** | **40.9%** | 46.9% | 36.3% | 62% | **16%** | 22% |

Even with the labels, the features reach about **70% F1@3** on these three types. That's below 80%, and the main reason is stock leakage. Choosing the threshold on 2025 itself, an optimistic figure, gives 70.0% too. So the features hold real information that version 8 doesn't use: **inflated headcount (16% against 81–87%)** is the biggest gap.

## 3. Where version 8 loses (error analysis, 2025)

**Why problem school-weeks are missed.** 63.8% are missed:

| Reason | Share of misses |
|---|---|
| **Below the review threshold** | **99.2%** |
| Above it, but outranked by 3 others | 0.8% |

- Half the misses (518 of 986) are the **highest-ranked school in their sub-county that week**, ranks 1–3, but below the threshold. The ranking often puts the problem school at or near the top; its score just isn't extreme enough.
- Lowering the threshold doesn't fix this. Version 8 already chose q = 0.98 by F1@3 on 2025, and lower q values gave lower F1, because ordinary weeks score just as high.

**By type:**

| Type | Problem weeks listed | Missed: below threshold |
|---|---|---|
| Consumption drift | 62% | 38% |
| Inflated headcount | **16%** | 82% |
| Stock leakage | 22% | 78% |

**By time since the problem began:**

| Week of the problem | First | Second | Third | 4th–6th | Later |
|---|---|---|---|---|---|
| Listed | **7%** | 25% | 40% | 50–53% | 36% |

Problems are rarely caught in their first week. Version 8 needs a problem to build up.

**By how many of the week's days the problem covers:**

| Days of the problem in the week | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| Listed | 52% | 25% | 20% | 36% | 38% |

The one-day weeks are mostly stock-count days.

**By group (problem weeks listed), with no strong pattern:**
- **School size:** small 34%, medium 40%, large 36%.
- **Sub-county:** 30–44%.
- **Programme type:** cash transfer 29%, food delivered 39%.
- **Problem length:** 1–4 weeks 37%, 5–8 weeks 39%, 9–13 weeks 23%. Long problems become part of the training window, which the follow-up exclusion only partly prevents.

**False listings.** 638 of 1,197 listed school-weeks (53%) were ordinary weeks.
- **Rule breaches:** 36% of those also broke a fixed rule, so the officer would have seen something real-looking anyway.
- **Aftermath of a problem:** only 4% came in the two weeks right after the same school's problem ended, so the label boundary isn't a cause.
- **By size:** false listing rates are small schools 3.0%, medium 2.3%, large 1.8%.

## 4. Temporal signals and calibration

**Other ways to score a school-week.** Each was compared at version 8's workload, listing the same number of school-weeks per run. The new signals have no training-window distribution, so the threshold rule can't be applied to them.

| Weekly signal | Area under ROC | F1@3 at equal workload |
|---|---|---|
| **Top-2 day mean (version 8)** | 0.783 | **41.4%** |
| Mean of this week and last | **0.799** | 40.0% |
| Days in the week above the window's 90th percentile | 0.754 | 40.1% |
| Longest run of such days | 0.754 | 38.3% |
| This week against the school's own last 8 weeks | 0.737 | 36.2% |
| Last week's score (recurrence) | 0.708 | 28.7% |
| Change from last week (trend) | 0.602 | 16.8% |

None beats the top-2 mean where it matters, at the top of the list. The two-week mean separates better overall but worse among the highest scores.

**Persistence as a listing rule.** Problem school-weeks are above the window's 90th percentile two weeks running far more often than ordinary ones (31.4% against 2.4%).
- **The rule tested:** also list a school-week above q = 0.90 two weeks running.
- **What it adds:** 9.4% of problem weeks and 1.7% of ordinary weeks. That's about three false listings for each problem found, for an estimated F1@3 gain of 1–2 points.

**Calibration isn't a problem.** Each list is one sub-county-week scored by one model, with its threshold from that model's own window, so scores never compete across sub-counties.
- **Raw score against its percentile in the window:** area under ROC 0.783 against 0.780.
- **Ordinary schools' median score:** 0.411–0.416 in every sub-county, and 0.408–0.418 in every term.

## 5. Conclusions

### The ceiling

| | F1@3 on 2025 (three types) |
|---|---|
| Review capacity (a perfect list of at most 3) | 100% |
| Labelled benchmark with the current features (and with version 8's two candidates) | 66% (70%) |
| Version 8 | 41% |

The capacity ceiling isn't the binding one. The features are.

### The three most promising improvements (for part B)

**1. A second, transparent signal for sustained over-recording of learners fed.**
- **Hypothesis:** inflated headcount is visible in single features (area under ROC 0.84–0.88) and to a labelled model (81–87% listed). Version 8 lists 16%, because one isolation model on 15 features gives a moderate, steady rise in a few features a score that isn't extreme.
- **Change:** an unsupervised robust z-score of the school's learners fed against its peers and its own last term, over the last 10 school days, from the training window. Combined with the isolation model by **averaging** the two scores' percentiles in the training window, not taking the higher. Taking the highest of five models is what failed in version 8.
- **Data needed:** existing features (`fed_vs_peers_trend`, `fed_rate_vs_last_term`).
- **Complexity:** moderate.
- **Expected value:** the highest of the three.
- **Risks:**
  - genuinely growing schools listed;
  - more listings for small schools, where one learner is a bigger share;
  - averaging can dilute the other types.
- **Ablation:** isolation model alone; averaged with each signal alone; averaged with both.

**2. The store count's gap carried forward, in the model** (`count_gap_recent`, already built and tested in version 8).
- **Hypothesis:** with it, the labelled model goes from 1% to 38% of stock-leakage weeks listed, so the information is real. Version 8 tested it alone and gained 0.8 F1 points, under the margin. It may help more next to change 1, or as part of its transparent signal.
- **Complexity:** low.
- **Risks:**
  - it depends on how often schools count (the fortnightly-count robustness scenario is the check);
  - a school that counts often but carelessly is listed for its counts.
- **Ablation:** with and without it, given change 1's decision.

**3. A persistence rule.**
- **The rule:** list a school-week above q = 0.98, or above q = 0.90 two weeks running (at most 3).
- **Hypothesis:** problems persist and ordinary weeks rarely do (31% against 2.4%).
- **Complexity:** low; no new model.
- **Expected value:** the lowest, an estimated 1–2 F1 points.
- **Risks:**
  - more workload;
  - it helps later weeks, not the first week, where version 8 is weakest (7%).
- **Ablation:** with and without; q = 0.90 against 0.95 for the second level.

**Not recommended, from the evidence:**
- **Calibration changes:** scores never compete across sub-counties.
- **Trend or recurrence as the weekly score:** both worse.
- **Programme-type comparisons:** too few schools.
- **A labelled second-stage ranker:** no labels in the system.
- **More features in general:** the strongest separators already exist.

### Recommended order

1, then 2, then 3, as version 8's staged order:
- **Change 1** carries the most expected value.
- **Change 2** depends on how change 1 combines signals.
- **Change 3** is cheapest, and is judged last on what's left.

### Exact evaluation protocol (to be written into part B before any experiment)

- **Development on 2025 only:**
  - at most these three changes, tested in this order;
  - version 8's margins (1.0 F1@3 point; 2.0 for a change that adds a model, which includes change 1);
  - the review threshold re-chosen for each candidate from [none, 0.90, 0.95, 0.98] by F1@3.
- **Co-primary measures, all reported:** problems caught, weeks to catch, and F1@3. A change is adopted on F1@3 by the margin, provided problems caught doesn't fall.
- **Robustness and fairness:** a change is rejected if Extended Isolation Forest's average robustness rank worsens by more than 0.25, any scenario by more than 1.0, or any group's false listing ratio passes 1.5.
- **Freeze:** model, features, combination, thresholds and listing rule committed before any fresh data is generated.
- **Final test:**
  - 10 fresh datasets from the main configuration, with seeds never used before;
  - each scored once over its 2026 (all six types), with 5 model seeds;
  - version 8 scored on the same data, as the comparison.
- **Report:**
  - Precision@3, Recall@3 and F1@3;
  - problems caught, caught within 2 weeks, and weeks to catch;
  - ordinary schools listed per officer-term, and schools listed per officer-week;
  - results by all six types;
  - fairness by group.

### Is 80% F1@3 realistic?

**Not on the evidence.**
- **The labelled benchmark tops out at about 70%** on the three development types, even with labels the system will never have.
- **Stock leakage is largely invisible by construction** between store counts. A better model can't recover what the records don't show.
- **A realistic aim for part B** is to close part of the 41%-against-70% gap on 2025, mostly through inflated headcount. Fresh-data results will be higher than 2025's (as version 8's 2026 was), because the three held-out types are easier to find.
- **80% "problems caught" is already exceeded:** version 8 caught 88% of 2026's problems while they were still going on. That's the measure that matches the officer's job.

Synthetic data: this describes how the list behaves on records shaped like Kenyan school feeding records with planted problems, not how often it would be right at real schools.
