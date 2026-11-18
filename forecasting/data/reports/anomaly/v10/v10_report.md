# Anomaly detection: protocol version 10

Plan: [`forecasting/config/anomaly_v10.yaml`](../../../../config/anomaly_v10.yaml), committed before any run. The freeze was committed before the test datasets were generated. Figures: [`development.json`](development.json), [`robustness.json`](robustness.json), [`final.json`](final.json).

Data:
- **Development:** 10 new datasets (seeds 8001–8010), 2025 only, with the three types present.
- **Final test:** 20 new datasets (seeds 9101–9120), each scored once over its 2026, with all six types; 1,800 planted problems; 5 model seeds; 95% intervals from bootstrap over datasets.

**Result:**
- **Development:** version 10 (the isolation model and an over-recording signal, each against its own threshold) cleared every adoption rule, by a wide margin.
- **Final test:** it catches **more problems** than version 8 (92.8% against 88.4%) but has **the same F1@3** (53.0% against 53.4%). It's worse on PR-AUC, day-level F1 and catching problems within two weeks.
- **Behaviour tests:** two that version 8 passes fail with version 10 in the scorer.
- **Recommendation:** keep version 8 deployed, and report version 10 as an option that trades those for finding inflated headcount.

## Development (2025, the three types present)

| Step | Finding |
|---|---|
| 1. Baseline | Version 8 at q = 0.98: F1@3 33.6%, problems caught 63.0%, PR-AUC 0.328 |
| 2. Complementarity | Over-recording lists 20.1% of problem school-weeks the isolation model misses, almost all inflated headcount (716 of 741). Stock variance: 5.8%. The fixed rules: 4.3%, with many false listings. Both new signals passed the 2% go/no-go. |
| 3. Combination | **Independent** (each detector above its own threshold, ranked by the higher percentile) beat day-level max (46.3% against 39.8% F1@3). Adopted: F1@3 +12.7 points, problems caught 82.7%, inflated headcount caught 26% → 90%, ordinary listings 3.1 → 2.4 per officer-term, highest fairness ratio 1.19. |
| 4. Stock variance | Best carry 10 days: +0.4 points, under the margin. Not adopted. |
| 5. Threshold | q = 0.99, the top of the fixed grid |
| 6. Persistence (extended option) | Problems caught 90.4%, for 5.7 more ordinary listings per officer-term |

**Robustness** (deployment loop, 7 scenarios × 3 seeds × 3 model seeds):
- **Passed:** mean F1@3 was 44.2% for version 8 and 47.6% for version 10.
- **Worst scenario:** subtle anomalies, −0.4 points.
- **Connectivity outages** gave exactly the baseline's figures for both versions. Lateness is measured from when a record was entered, not when it synced, so outages change nothing the models see.

## Final test (20 untouched datasets, 2026, all six types)

| Measure | Version 8 | **Version 10** | Difference (95% interval) | Version 10 + persistence (extended) |
|---|---|---|---|---|
| Precision@3 | 53.9% | 54.5% | +0.7 (−1.6 to +2.8) | 38.3% |
| Recall@3 | 53.4% | 51.8% | −1.5 (−3.7 to +0.5) | 58.2% |
| **F1@3** | **53.4%** | **53.0%** | **−0.4 (−2.5 to +1.4)** | 46.1% |
| PR-AUC (school-weeks) | 0.576 | 0.462 | −0.114 (−0.132 to −0.099) | 0.462 |
| Day-level F1 | 47.0% | 42.0% | −5.0 (−6.8 to −3.3) | 42.3% |
| **Problems caught** | 88.4% | **92.8%** | **+4.4 (+2.2 to +6.6)** | 95.7% |
| Caught within 2 weeks | 51.6% | 47.1% | −4.5 (−8.2 to −0.8) | 59.8% |
| Ordinary schools per officer-term | 4.7 | 4.5 | −0.2 (−0.5 to +0.1) | 9.7 |
| Highest fairness ratio | 1.14 | 1.15 | | 1.07 |

**Problems caught, by type:**

| Type | Version 8 | Version 10 |
|---|---|---|
| Inflated headcount | 57% | **94%** |
| Backdated entry | 100% | 100% |
| Consumption drift | 97% | 97% |
| Round numbers | 98% | 97% |
| Ghost learners | 98% | 94% |
| Stock leakage | 80% | 75% |

**Why development overstated the gain.**
- **Development only covers three types.** In 2024–2025, inflated headcount is one of only three problem types, so finding it is a large share of all problems. In the test year there are six, and the isolation model already finds the three held-out ones well.
- **The extra listings displace other problems.** With at most 3 schools a week, the over-recording signal's listings take places that version 8 gave to ghost learners, round numbers and stock leakage. So inflated headcount improves while the others slip, and F1@3 comes out level.
- **The ordering across all weeks is worse.** Ranking by the higher of two percentiles bunches many school-weeks near the top, which is why PR-AUC falls.

**Behaviour tests** (run on the scorer with version 10's setting): two that version 8 passes fail.
- **"A store count ten days of food short must be listed."** It isn't. The shortfall is a one-day spike that doesn't reach the isolation model's 99th percentile, while version 8 listed it at 0.98. The fixed check still shows it to the officer as a breach.
- **"Entering later must raise the score."** It doesn't. The score is the higher of the two percentiles, and when the over-recording signal is already high, a rise in the isolation model's score doesn't show.

Version 10's adoption rules only included the growth behaviour test. They should have included all of them, a gap in the protocol, reported here.

## Conclusion

Version 10 met its development rules, and the protocol adopted it. The final test shows that adoption was justified on what it targeted:
- **The gain:** inflated headcount caught 57% → 94%, and all problems caught 88% → 93%, both clearly outside chance.
- **No gain on the list's quality:** F1@3 is level.
- **Losses:** PR-AUC and day-level F1 fall, problems are caught a little later, and two behaviour guarantees no longer hold.

**Recommendation:** keep **version 8** deployed, the more balanced of the two, with its behaviour guarantees intact. Report version 10 as a tested option for a programme that is most concerned about inflated headcount. Present the measured trade-off rather than one headline number.

On the 80% target:
- **F1@3:** about 53% on fresh data for both versions. The labelled benchmark (about 70%) remains the practical ceiling with these records.
- **Problems caught while still going on:** 88% for version 8 and 93% for version 10, both above 80%.

Synthetic data: this describes how the list behaves on records shaped like Kenyan school feeding records with planted problems, not how often it would be right at real schools.
