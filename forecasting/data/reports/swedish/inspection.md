# Swedish school lunch dataset: inspection

Source: Eriksson, Malefors, Secondi and Marchetti (2021), *Guest attendance data from 34 Swedish pre-schools and primary schools*, Data in Brief; Mendeley Data doi:10.17632/4zr5dwnbbv.2 (CC BY-NC 3.0). Plates used at lunch stand for the number of pupils who ate.

## Cleaning

| Step | Rows left |
|---|---|
| rows in SchoolData.xlsx | 53381 |
| weekdays | 38208 |
| school days (not in the municipality's holiday list) | 26479 |
| before 2020-03-01 | 25409 |
| with a recorded student count | 24429 |
| canteens with at least 600 school days | 24429 |

The three canteens in Tierp and Härnösand (16–18) drop out at the student-count step: they record only totals of pupils and staff together, on fewer than 160 days from September 2019, mostly in the COVID-19 period.

## How schools plan without a model

Across 15 primary school canteens and 24,429 school days:

| Plan | Error (WAPE) |
|---|---|
| Prepare for every enrolled pupil | 13.1% |
| Average of the last 20 school days | 6.3% |
| Noise floor (pupils eating independently; no forecast can beat it) | 1.7% |

Preparing for everyone enrolled over-prepares by 14.8% on average. The moving average halves that error, but stays well above the noise floor, so there is room for a forecast to improve on it.

## Where the moving average goes wrong

| Day type | Days | Share of days | Error (WAPE) | Mean error (actual vs average) | Share of all error |
|---|---|---|---|---|---|
| ordinary | 19710 | 80.9% | 5.8% | +0.4% | 74.1% |
| first days after a break | 2168 | 8.9% | 6.7% | +1.5% | 9.5% |
| last days before a break | 2137 | 8.8% | 7.9% | -1.1% | 10.7% |
| first day of school year | 133 | 0.5% | 12.5% | +8.1% | 1.1% |
| last day of school year | 95 | 0.4% | 112.6% | -54.1% | 3.1% |
| event noted | 111 | 0.5% | 19.3% | -9.4% | 1.5% |

A positive mean error means more pupils ate than the average expected. Day types come from the published holiday calendar; `event noted` means the canteen wrote a note for the day (trips, work placements, sports days).

Day type, weekday and month together explain 26.8% of the variance in the moving average's relative error. That is an upper bound on what calendar knowledge alone can remove; the rest is day-to-day noise and events that were not recorded.

## Canteens

| Canteen | Municipality | Kitchen | Area | Period | School days | Mean pupils eating | Enrolled | Participation | Error: cook for enrolled | Error: moving average | Noise floor |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Sala | Production | Rural | 2010-01-11 – 2020-02-21 | 1787 | 41.7 | 43.0 | 95.0% | 9.2% | 6.9% | 2.8% |
| 2 | Sala | Production | Urban | 2010-01-11 – 2020-02-21 | 1732 | 243.6 | 257.0 | 90.8% | 10.7% | 3.6% | 1.6% |
| 3 | Sala | Satellite | Urban | 2010-01-11 – 2020-02-21 | 1760 | 171.2 | 179.0 | 95.4% | 7.3% | 5.1% | 1.3% |
| 4 | Sala | Production | Rural | 2010-03-08 – 2020-02-21 | 1766 | 69.4 | 78.0 | 91.0% | 14.2% | 8.7% | 2.9% |
| 5 | Sala | Production | Rural | 2010-01-18 – 2020-02-21 | 1792 | 113.8 | 122.0 | 96.0% | 6.6% | 4.8% | 1.5% |
| 6 | Sala | Production | Rural | 2010-01-11 – 2020-02-21 | 1797 | 71.6 | 80.0 | 94.1% | 10.6% | 6.6% | 2.3% |
| 7 | Sala | Satellite | Urban | 2010-01-11 – 2020-02-21 | 1789 | 189.2 | 206.0 | 93.2% | 9.0% | 4.4% | 1.5% |
| 8 | Sala | Production | Rural | 2010-01-11 – 2020-02-21 | 1793 | 62.4 | 61.0 | 96.0% | 8.2% | 6.6% | 2.0% |
| 9 | Sala | Production | Rural | 2010-01-11 – 2020-02-21 | 1762 | 109.2 | 106.0 | 95.7% | 10.0% | 6.2% | 1.6% |
| 10 | Sala | Production | Rural | 2010-01-11 – 2020-02-21 | 1784 | 96.0 | 101.0 | 95.6% | 9.8% | 7.0% | 1.7% |
| 11 | Sala | Production | Rural | 2010-03-08 – 2020-02-21 | 1698 | 107.6 | 98.0 | 92.9% | 12.2% | 7.3% | 2.0% |
| 12 | Sala | Production | Urban | 2010-01-11 – 2020-02-21 | 1781 | 163.2 | 214.0 | 92.2% | 17.3% | 7.0% | 1.8% |
| 13 | Sala | Production | Urban | 2010-01-11 – 2020-02-21 | 1769 | 550.9 | 652.0 | 83.8% | 19.5% | 7.7% | 1.4% |
| 14 | Sala | Satellite | Urban | 2015-08-19 – 2020-02-21 | 804 | 107.9 | 134.0 | 90.7% | 18.3% | 11.3% | 2.4% |
| 15 | Sala | Satellite | Urban | 2016-08-22 – 2020-02-21 | 615 | 102.4 | 113.0 | 92.1% | 10.0% | 4.9% | 2.2% |
