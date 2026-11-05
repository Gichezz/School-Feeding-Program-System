# Faithfulness of the weekly list's reasons

Plan: [`forecasting/config/explanation_faithfulness.yaml`](../../../../config/explanation_faithfulness.yaml), written before it was run. Extended Isolation Forest deployed as in the deployment-matching test (main, seed_101, seed_202, seed_303; 3456 listed school-weeks). Each listing's two reasons are the features whose own reset to the sub-county's median lowers the score most.

## 1. Do the reasons name what the model reacted to?

On each listing's highest-scoring day, the two named features are reset together, and so is every other pair of the 15 features (105 pairs).

| Measure | Result | Plan's bar |
|---|---|---|
| Named pair's drop, as a share of the best pair's (mean) | 98.0% | ≥ 80% |
| Listings where the named pair drops more than the median pair | 100.0% | ≥ 90% |
| Where the named pair falls among all pairs (mean percentile) | 99.6 | – |

| Listings | Count | Share of best pair | Beats the median pair |
|---|---|---|---|
| with a problem | 547 | 98.9% | 100.0% |
| ordinary | 2909 | 97.9% | 100.0% |

**The reasons are faithful by the plan's rule.**

## 2. Do the reasons point at the problem that was there?

Listings holding one injected problem type: the share where at least one reason is a figure that type changes (fixed in the plan), against two features drawn at random.

| Problem type | Listings | A reason matches | Chance | Better than chance |
|---|---|---|---|---|
| inflated_headcount | 115 | 62.6% | 57.1% | yes |
| consumption_drift | 114 | 94.7% | 37.1% | yes |
| stock_leakage | 85 | 56.5% | 13.3% | yes |
| backdated_bulk_entry | 56 | 100.0% | 57.1% | yes |
| round_number_entry | 49 | 91.8% | 25.7% | yes |
| ghost_learners | 126 | 95.2% | 65.7% | yes |

Better than chance for 6 of the 6 types with at least 20 listings.

## 3. Does a second model seed give the same reasons?

On the main dataset, 98.6% of school-weeks listed under seed 1 are listed under seed 2 too. Of those (852), 94.5% get the same two reasons and 99.9% share at least one. Reported, not judged.

Synthetic data: this shows the reasons describe the model and the injected problems; whether officers find them useful needs real use.
