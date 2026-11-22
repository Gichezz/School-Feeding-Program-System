# Anomaly detection: protocol version 11

Plan: [`forecasting/config/anomaly_v11.yaml`](../../../../config/anomaly_v11.yaml). The protocol and each of its three amendments were committed before the runs they affect, and the frozen setting was committed before the test datasets were generated. Figures:
- **Development:** [`development.json`](development.json), [`development_amendment.json`](development_amendment.json), [`development_amendment_2.json`](development_amendment_2.json), [`development_amendment_3.json`](development_amendment_3.json)
- **Checks:** [`cache_check.json`](cache_check.json), [`robustness.json`](robustness.json)
- **Final test:** [`final.json`](final.json)

Version 11 asks whether the deployed model, version 8 (Extended Isolation Forest), can be improved without replacing it. Each experiment changes one thing, and version 8 is the benchmark throughout.

**How each change was evaluated.**
- **As the system runs it:** each week is scored on its Sunday with only the records that had arrived by then. It is then scored again on each day its late records arrive, for up to 28 days.
- **Development data:** 10 new datasets (seeds 8001–8010), 2025 only, holding the three problem types used for tuning.
- **Final test:** 20 new datasets (seeds 9201–9220), each scored once over its 2026, with all six types (three never seen in development); 5 model seeds; 95% intervals from a bootstrap over datasets.
- **Adoption rules:** a change is adopted only if all of these hold:
  - F1@3 rises by at least 1.0 point, with a paired interval above 0;
  - problems caught falls by no more than 2 points;
  - ordinary schools listed rise by no more than 1.0 per officer-term;
  - no group of schools is listed for nothing more than 1.5 times the overall rate.

**Result:**
- **Development:** one-sided scoring and listing store shortfalls directly were adopted. F1@3 rose from 32.7% to 47.0%, and robustness passed in every scenario.
- **Final test:** the development gain did not carry over. **F1@3 is level: 41.6% against 41.5%** (difference +0.1, 95% interval −2.8 to +2.9).
  - **Better:** listings are more often right (precision 66.3% against 52.5%), and ordinary schools listed are halved (1.6 against 3.1 per officer-term). More problems are caught (74.6% against 69.4%, interval above 0), and stock leaks caught rise from 41% to 87%.
  - **Worse:** fewer problem school-weeks are listed (recall 30.5% against 34.8%), round-number entry is caught less (62% against 82%), and leaks take longer to find (median 21 days against 16).
- **What it means:** version 11 is a better list for an officer with limited time, not a more accurate detector overall. As with version 10, development overstated the gain, because the development years hold only the three tuning types.
- **Two findings for the deployment:**
  - the threshold q is a policy choice (at q 0.95 version 11 leads on F1@3, 45.8% against 43.4%);
  - rescoring weeks for 56 days instead of 28 finds backdated entry far more often (95% against 53%). Both are below.

## Development

| Step | Change | F1@3 | Outcome |
|---|---|---|---|
| 1 | Version 8 as deployed (q 0.98), measured as the system runs it | 32.7% | Benchmark. Problems caught 66.9%, PR-AUC 0.30 |
| 1 | Version 8 as first evaluated (100 trees, 15th-percentile threshold) | 31.3% at its best q | The deployed settings stay |
| 3 | Floor on each feature's scale (stops tiny spreads blowing up) | 31.5% | Not adopted |
| 4 | Harrell–Davis estimate of the threshold | 32.9% (+0.2) | Not adopted: under the 1.0-point margin |
| 5 | Score the week over two weeks (amendment 1) | 31.2% | Not adopted |
| 6 | 150-day training window instead of 125 (amendment 1) | 32.6% | Not adopted |
| 7 | **One-sided scoring** (amendment 2) | **42.4%** (+9.7; interval +6.7 to +13.0) | **Adopted** |
| 8 | **List a store count more than 2 days short** (amendment 3) | **47.0%** at q 0.99 (+4.6; +1.0 to +7.2) | **Adopted** |

**Amendment 1: two changes to how version 8 is measured, decided before results.**
- **How stock leaks count:** a leak only shows at the next store count. A leak now counts as caught if the week of that count is listed. Before, only weeks inside the leak counted, which most often fall before any count. The old figure is still reported as "caught in own weeks".
- **Longer rescoring:** scoring a week again for up to 56 days instead of 28 changed nothing.

**Step 7: one-sided scoring.**
- **What changed:** an isolation forest finds a value unusual whichever way it lies. For an oversight list, fewer learners recorded as fed, or less food issued, is not the risk being looked for. Each feature is therefore scaled as before, and its harmless side is then set to the centre:
  - a store-count gap is risky when it is short (low);
  - every other feature is risky when high.
- **Why:** in the error analysis, many ordinary listings were schools feeding *fewer* learners than usual (a sports day, a closure, a term starting slowly).
- **Result:**
  - F1@3 rose 9.7 points;
  - PR-AUC rose from 0.30 to 0.44;
  - problems caught rose from 66.9% to 71.9%.
- **Cost:** stock leaks caught fell from 47% to 32%. Store-count gaps are one feature among fifteen, and the gain elsewhere pushed leak weeks below the threshold. The store behaviour test, a count ten days short, failed: scored 0.529 against a threshold of 0.540.

**Step 8: list the store shortfall directly.**
- **The evidence, from the development data:**
  - 0 of 3,118 ordinary store counts were more than 2 days of food short;
  - 45 of the 82 counts that followed a leak were.
- **What changed:** a school whose week has a count more than 2 days short is listed first, within the 3, whatever its score. The 2-day line was fixed from those counts before the run.
- **Why it isn't a rule hidden in the model:** the listing's first reason says it plainly ("the store count 4.1 days of food short of the records"), and the officer checks it against the store book.
- **Result:**
  - leaks caught rose to 88%;
  - the store behaviour test passes again;
  - with q 0.99 chosen on development, F1@3 47.0% and precision 60.6%;
  - ordinary schools listed fell from 3.1 to 1.75 per officer-term.

**Robustness** (7 scenarios × 3 datasets × 3 model seeds, as the system runs it):
- **Passed.** Mean F1@3 48.7% against version 8's 33.4%.
- **Higher in every scenario,** by 12.0 to 19.1 points: baseline, connectivity outages, fortnightly store counts, irregular entry, a larger programme, noisier days, subtler problems.
- **Behaviour tests:** all 12 pass with the scoring service set to version 11.
- **Parity:** the scoring service and the evaluation give identical scores for every setting tried.

## Final test (20 untouched datasets, 2026, all six types, 1,800 planted problems)

As the system runs it (scored on the week's Sunday, rescored as late records arrive, up to 28 days):

| Measure | Version 8 (q 0.98) | **Version 11 (q 0.99)** | Difference (95% interval) |
|---|---|---|---|
| Precision@3 | 52.5% | **66.3%** | +13.8 (+11.4 to +16.7) |
| Recall@3 | **34.8%** | 30.5% | −4.2 (−7.4 to −1.1) |
| **F1@3** | 41.5% | 41.6% | **+0.1 (−2.8 to +2.9)** |
| PR-AUC (school-weeks) | 0.438 | 0.461 | +0.022 (−0.005 to +0.052) |
| **Problems caught** | 69.4% | **74.6%** | +5.1 (+0.8 to +9.8) |
| Caught within 2 weeks | 32.2% | 32.1% | −0.1 (−5.1 to +5.2) |
| Median days to catch | 16 | 21 | +2.3 (−0.8 to +5.5), mean over datasets |
| **Ordinary schools listed per officer-term** | 3.1 | **1.6** | −1.6 (−1.8 to −1.3) |
| Schools listed per officer-week | 0.51 | 0.36 | −0.15 |
| Highest fairness ratio (limit 1.5) | 1.10 | 1.16 | |

**Problems caught, by type:**

| Type | Version 8 | Version 11 | |
|---|---|---|---|
| Stock leakage | 41% | **87%** | tuning |
| Inflated headcount | 53% | 61% | tuning |
| Consumption drift | 95% | 97% | tuning |
| Backdated bulk entry | 53% | 53% | held out |
| Ghost learners | 92% | 87% | held out |
| Round-number entry | **82%** | 62% | held out |

**Reported only, decided before the run:**

| Run | Version 8 F1@3 | Version 11 F1@3 | Version 11 problems caught | Ordinary listed per officer-term (8 / 11) |
|---|---|---|---|---|
| Whole dataset (continuity with earlier versions) | 50.6% | 51.6% | 86.5% (v8 80.0%) | 3.4 / 2.0 |
| Rescored for 56 days instead of 28 | 47.3% | 47.3% | 82.3% (v8 78.3%) | 3.4 / 1.7 |
| q 0.95, as the system runs it | 43.4% | **45.8%** | **88.5%** (v8 82.1%) | 7.7 / 7.8 |

**Why development overstated the gain.**
- **Only three types in development.** Every change was chosen where inflated headcount, consumption drift and stock leakage are the only problems. Version 11 improves all three, most of all leaks.
- **The threshold was chosen on them too.** q 0.99 was best in development, where the held-out types are absent. In the test year, version 8 already finds the held-out types well. The stricter threshold, and the shortfall listings taking places in the 3, cost round-number entry and ghost learners some listings.
- **At the same threshold (q 0.95), version 11 matches version 8 on the held-out types** (round numbers 94% against 95%, ghost learners 97% against 98%) and leads on the tuning types (inflated headcount 95% against 79%, leaks 90% against 66%). The drop is therefore mostly the threshold, not one-sided scoring.

**Two findings that bear on the deployment, from the test (they need confirming before they change anything):**
- **The rescoring window, not the model, limits backdated entry.**
  - A backdated week is entered long after it ended. The system scores a week again only for 4 weeks after it ends (backend `LOOK_BACK_WEEKS = 4`), so a week entered later is never rescored with its records.
  - With 56 days, backdated entry is caught 95% of the time instead of 53%, and F1@3 rises by about 6 points for both versions.
  - This is a backend setting, and the evidence comes from the test year, the only year with backdated entries. It should be confirmed on fresh datasets before the setting changes.
- **The threshold is the lever between workload and catching problems.**
  - **q 0.99:** an officer sees about one school every three weeks, and two in three are real.
  - **q 0.95:** about one a week, two in five real, and 88.5% of problems caught.
  - Which one fits depends on how many visits officers can make. That is a programme decision for a pilot, not something to set from synthetic data.

**Reasons** ([report](../explanations/v11/explanation_faithfulness.md)), re-checked with the one-sided model on the same datasets and plan as version 8's check:
- **Faithful:** the named pair lowers the score by 96.5% of what the best pair does (98.1% for version 8), and beats the median pair in every listing.
- **Stable:** a second model seed gives the same two reasons for 98.5% of school-weeks (90.1% for version 8).
- **Point at the problem:** better than chance for all six types. Inflated headcount is still only just above chance (62.1% against 57.1%).
- **Store shortfalls:** a school listed for one now has it as its first reason, from the day of the count.

## Audit of the dataset and the whole pipeline

The audit asked whether better results were still available, and where the limits are. It used the development data only.

**1. Ceilings set by the data and the list.**
- **Problems are rare:** 5.1% of school-weeks have one, and 59% of sub-county-weeks have none.
- **Why the threshold is essential:** a perfect ranker that always lists 3 schools reaches only 17% precision (F1@3 29%), because most weeks have nothing to find. With a threshold, a perfect ranker reaches F1@3 99.9%. So the threshold matters as much as the ranking.
- **Leak weeks with no store count:** 22% of problem school-weeks are leak weeks with no store count in them. Nothing in those weeks' records differs from normal, so no method can list them in their own week; they can only be found at the next count. That is why amendment 1 counts a leak as caught at its next count, and why version 11's median time to catch is longer (leaks wait for a count).

**2. How well each feature separates its problem** (AUC of the feature alone, 0.5 = no signal):

| Problem | Strongest features | AUC |
|---|---|---|
| Inflated headcount | learners fed vs last term, vs enrolment, vs peers, vs own usual | 0.87–0.91 |
| Consumption drift | cereals and pulses per learner fed, recent trend | 0.80–0.85 |
| Stock leakage | store-count gap (only on count days) | 0.50 over all days |

The features carry the signal; the question was whether the model uses it. The entry features (lateness, batches, after-hours, round numbers) are at 0.50 for the development types, as expected: they are there for the held-out types (backdated entry, round numbers).

**3. Model structure: alternatives tried before the amendments (exploratory, not adopted).**
- **One model per family of features** (who ate, food used, store, entry), combined by the highest: F1@3 28% against 31% for one model. It missed more headcount problems, so it was dropped.
- **One-sided scoring:** 42.6% against 31.1%. This became step 7, tested under its own amendment.

**4. Upper bound with labels (not deployable).** A gradient-boosting classifier was trained on the planted labels, with each development dataset left out in turn. It reached:
- **F1@3:** about 63%;
- **PR-AUC:** 0.64, against version 11's 0.44 on development;
- **stock leaks:** at the thresholds that give its best F1@3, it catches 0–25% of leaks, against version 11's 88% with the store rule. A leak's weeks look normal until the count.

This is a ceiling, not an option. A real programme has no labels until officers have reviewed lists, and a classifier trained on planted problems would only learn what was planted. It shows where the remaining gap is: the order across weeks (PR-AUC), not the features.

## Gaps, and which can and cannot be closed now

**Closed in this version:**
- **Lower feeding read as suspicious:** removed by one-sided scoring.
- **Store shortfalls diluted among fifteen features:** listed directly.
- **Leaks miscounted:** a leak is now counted as caught at its revealing count.

**Not closable with the current data, and why:**
- **Leaks between counts.** Food that leaves the store unrecorded is invisible until someone counts it. Detection is as fast as the counts:
  - With fortnightly counts, F1@3 rose to 57.7% (robustness).
  - The lever is operational: count the store more often, for example every two weeks. Changing the model won't help.
- **The remaining gap to the labelled upper bound** (F1@3 ~47% against ~63% in development) needs labels:
  - **Where labels come from:** officers' "explained" and "follow-up" decisions, recorded with each listing.
  - **How to use them:** after a few terms of real decisions, a re-ranker trained on them could close part of the gap.
  - **Conditions:** it needs its own protocol, a check that it does not just learn which schools officers visit most, and a comparison with version 11.
- **Timeliness.** In the final test, the median time to catch is 21 days against 16 for version 8, because twice as many leaks are caught, at their next count. Problems caught within two weeks are level (32%). Catching a leak at its count is earlier than not catching it.
- **Backdated entry, at 4 weeks of rescoring.** See the final test: the fix is a backend setting, to be confirmed first.

**Accepted trade-offs:**
- **Under-recording is no longer ranked by the model.** A school recording fewer learners than it fed, or under-issuing food, is not looked for. The fixed rules still report every breach (more food issued than the ration allows, nobody fed with food issued), for every school.
- **The threshold is a policy choice.**
  - **q 0.99 (deployed):** fewer, more reliable listings.
  - **q 0.95:** catches more problems (88.5%) for about five times as many ordinary listings; in the final test it has the higher F1@3.
  - A pilot should set q from how many visits officers can make.

**Before real-world use:**
- **Synthetic data:** the evidence is from data generated from real Kenyan inputs, not real records. A pilot should compare lists with registers and store books for a few terms, then re-run these scripts on the pilot's records, which share the same format.
- **The 2-day store line:** it was set on synthetic counts. Real store books have rounding and spoilage, so the line should be checked against a term of real counts.
- **Feedback:** officers' decisions are already stored with each listing, which is what a later supervised step needs.

## Reproducing

```bash
cd forecasting
python scripts/run_anomaly_v11.py --step development --workers 6
python scripts/run_anomaly_v11.py --step amendment --workers 6
python scripts/run_anomaly_v11.py --step amendment_2 --workers 6
python scripts/run_anomaly_v11.py --step amendment_3 --workers 6
python scripts/run_anomaly_v11.py --step robustness --workers 6
python scripts/run_anomaly_v11.py --step final --workers 4
```

The final step generates the test datasets from the frozen generator commit (050703a) and refuses to run without a frozen setting in the plan. Use at most 4–6 workers: the first final run with 8 ran out of memory before producing any result, and was re-run unchanged with 4.
