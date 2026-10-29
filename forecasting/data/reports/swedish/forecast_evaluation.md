# Does forecasting improve school meal planning? Evaluation on real school data

Data: 15 Swedish primary school canteens, daily counts of pupils who ate lunch, school days from 2010 to February 2020 ([inspection](inspection.md)). Training before 2017, validation 2017, test 2018 – February 2020. Errors are WAPE (total absolute error / total eaten).

Validation chose a moving-average window of 10 school days and a level half-life of 5 school days.

## Day ahead (the evening before, when beans and maize are soaked)

| Day type | Days | Cook for enrolled | Yesterday's count | Moving average | Level × day effects | Gradient boosting |
|---|---|---|---|---|---|---|
| all | 5636 | 15.5% | 6.4% | 5.7% | 5.3% | 5.9% |
| ordinary | 4425 | 15.1% | 5.7% | 5.3% | 4.9% | 5.2% |
| first days after a break | 585 | 15.0% | 6.9% | 5.8% | 5.3% | 6.1% |
| last days before a break | 556 | 16.9% | 6.8% | 5.9% | 5.8% | 8.6% |
| first day of school year | 28 | 10.6% | 44.5% | 15.0% | 8.2% | 12.8% |
| last day of school year | 24 | 101.4% | 59.7% | 71.8% | 77.1% | 72.8% |
| event noted | 18 | 34.5% | 34.6% | 32.2% | 28.1% | 24.6% |

Difference in WAPE against the moving average (negative = more accurate), 95% block-bootstrap interval over canteen-weeks:

| Model | Difference | 95% interval |
|---|---|---|
| Level × day effects | -0.4% | -0.6% to -0.2% |
| Gradient boosting | +0.2% | -0.1% to +0.5% |

## Two-week window (ordering food; 538 forecast origins)

| Day type | Days | Cook for enrolled | Yesterday's count | Moving average | Level × day effects | Gradient boosting | Prophet |
|---|---|---|---|---|---|---|---|
| all | 5265 | 15.5% | 7.2% | 6.0% | 5.7% | 7.1% | 7.2% |
| ordinary | 4167 | 15.1% | 6.8% | 5.7% | 5.3% | 6.3% | 6.8% |
| first days after a break | 500 | 15.4% | 6.8% | 5.3% | 5.1% | 6.6% | 6.5% |
| last days before a break | 528 | 16.5% | 7.9% | 6.3% | 6.3% | 9.1% | 7.9% |
| first day of school year | 28 | 10.6% | 11.0% | 9.7% | 7.4% | 42.1% | 8.4% |
| last day of school year | 24 | 101.4% | 72.4% | 77.6% | 78.0% | 74.6% | 70.2% |
| event noted | 18 | 34.5% | 35.2% | 29.9% | 27.9% | 27.9% | 30.1% |

| Model | Difference vs moving average | 95% interval |
|---|---|---|
| Yesterday's count | +1.2% | +0.8% to +1.7% |
| Level × day effects | -0.3% | -0.5% to -0.1% |
| Gradient boosting | +1.1% | +0.7% to +1.5% |
| Prophet | +1.2% | +0.8% to +1.6% |

## The planning decision: food prepared for the same risk of running short

At the start of each test year both plans are recalibrated on the most recent 180 school days, as the system would do. The moving average gets one buffer for every day; the level × day effects plan prepares for each kind of day at the same quantile of that day type's own recent errors.

**Planned risk: short on 2% of days**

| Plan | Days short (test) | Meals short | Food prepared but not eaten |
|---|---|---|---|
| cook for enrolled | 14.1% | 1.2% | 14.3% |
| moving average fixed buffer | 1.9% | 0.2% | 20.3% |
| day effect type buffer | 3.0% | 0.4% | 16.2% |

**Planned risk: short on 5% of days**

| Plan | Days short (test) | Meals short | Food prepared but not eaten |
|---|---|---|---|
| cook for enrolled | 14.1% | 1.2% | 14.3% |
| moving average fixed buffer | 4.6% | 0.5% | 13.8% |
| day effect type buffer | 5.7% | 0.7% | 10.3% |

**Planned risk: short on 10% of days**

| Plan | Days short (test) | Meals short | Food prepared but not eaten |
|---|---|---|---|
| cook for enrolled | 14.1% | 1.2% | 14.3% |
| moving average fixed buffer | 9.1% | 0.8% | 9.6% |
| day effect type buffer | 11.3% | 1.0% | 7.3% |

**At equal realised risk** (each plan's trade-off curve on test, read at the same share of days short)

| Days short | Left over: moving average + fixed buffer | Left over: level × day effects |
|---|---|---|
| 2% | 20.1% | 21.1% |
| 5% | 13.2% | 11.3% |
| 10% | 9.2% | 7.8% |

**Days short by day type, at the 5% planned risk**

| Day type | cook for enrolled | moving average fixed buffer | day effect type buffer |
|---|---|---|---|
| ordinary | 14.1% | 4.1% | 5.4% |
| first days after a break | 13.0% | 7.2% | 5.5% |
| last days before a break | 14.8% | 2.7% | 3.8% |
| first day of school year | 17.9% | 53.6% | 21.4% |
| last day of school year | 8.3% | 0.0% | 62.5% |
| event noted | 22.2% | 22.2% | 27.8% |

## What it means for a Kenyan school (illustration)

At the School Meals Programme ration (197 g of dry food per meal) and 2026 WFP median retail prices, one meal costs about Ksh 15.51 in commodities. Every 1% of surplus for 500 learners over 170 school days is about 167 kg of food and Ksh 13,184. This applies Swedish error rates to a Kenyan ration and price; it shows scale, not a measured Kenyan saving.
