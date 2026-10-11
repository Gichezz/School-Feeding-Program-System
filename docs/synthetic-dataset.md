# Historical Dataset and Synthetic Kenyan School Data (Phase 9)

This phase prepares a historical dataset for the later meal-demand forecasting phase. It does **not** implement forecasting, connect data to PostgreSQL, or change the application.

> **What this dataset is.** A synthetic dataset for **one simulated Kenyan school**, generated under documented, configurable assumptions. It is not observed Kenyan data, and it is not representative of all Kenyan schools. Calendar dates are illustrative (not official Ministry of Education dates), and rainfall is simulated (not Kenya Meteorological Department observations).

## 1. Files

```text
forecasting/
├── config/
│   └── synthetic_kenya_school.yaml          # all simulation assumptions + random seed
├── scripts/
│   ├── common.py                            # shared paths/helpers
│   ├── inspect_us_dataset.py                # step 1: inspect raw US data (read-only)
│   ├── generate_synthetic_dataset.py        # step 2: generate synthetic dataset
│   ├── validate_synthetic_dataset.py        # step 3: automated validation checks
│   └── data_quality_report.py               # step 4: data-quality assessment
└── data/
    ├── raw/
    │   └── us_school_attendance.csv         # original Kaggle file - never modified
    ├── processed/
    │   ├── us_reference_daily.csv           # US all-school daily aggregate (transformed)
    │   ├── us_reference_profile.json        # US-derived reference patterns (transformed)
    │   ├── synthetic_kenya_school_daily.csv # the synthetic dataset
    │   └── synthetic_kenya_school_metadata.json
    └── reports/
        ├── us_dataset_inspection.{md,json}
        ├── validation_report.{md,json}
        └── data_quality_report.md
```

Raw, processed (transformed US) and synthetic data are kept in separate files. Nothing is merged into one table.

## 2. Commands

Run from the repository root (Python 3.10+, dependencies in `forecasting/requirements.txt`):

```bash
python forecasting/scripts/inspect_us_dataset.py
python forecasting/scripts/generate_synthetic_dataset.py
python forecasting/scripts/validate_synthetic_dataset.py
python forecasting/scripts/data_quality_report.py
```

`validate_synthetic_dataset.py` exits with status 1 if any check fails. It regenerates the dataset in memory and compares it byte-for-byte with the saved file (use `--skip-reproducibility` to skip this; the skipped check is then reported as failed, not passed).

## 3. The original US dataset

Full findings: [`forecasting/data/reports/us_dataset_inspection.md`](../forecasting/data/reports/us_dataset_inspection.md).

| Property | Value |
|---|---|
| File | `us_school_attendance.csv` (CSV, 8.1 MB) |
| Size | 277,153 rows × 6 columns |
| Columns | `School DBN` (text), `Date` (int, YYYYMMDD), `Enrolled`, `Absent`, `Present`, `Released` (int) |
| Dates | 2018-09-04 to 2019-06-26, 185 unique dates, weekdays only (one US school year) |
| Schools | 1,583 (DBN codes in New York City Department of Education format) |
| Missing values | none |
| Duplicates | no duplicate rows, no duplicate (School DBN, Date) keys |
| Identity | `Present + Absent + Released = Enrolled` on every row |

Data-quality issues: only one school year; 7 dates with very low coverage (1 to 519 schools reporting, e.g. 2019-02-19..21 with a single school); schools with short histories; `Released` is undocumented and sometimes large; 3,161 school-days with attendance below 50%; no meal, weather, holiday, exam or event fields; non-school days are simply absent.

## 4. Suitability assessment

The dataset is US school data. It is **not** treated as Kenyan data and no US attendance values are copied into the synthetic dataset.

**Useful (as reference patterns only)**

| Derived from US data | How it is used |
|---|---|
| Relative weekday pattern of attendance (logit offsets relative to each school's mean) | `attendance.dow_logit_offsets: us_reference` — Friday lowest, midweek highest |
| Lag-1 autocorrelation of within-school daily deviations (0.47) | `attendance.noise_ar1: us_reference` — day-to-day persistence |
| Dip on the last school day before a break (−0.16 logit) | `attendance.pre_break_logit: us_reference` |
| Attendance rate level and spread | Reported for comparison only |

**Unsuitable for direct reuse**

- `Enrolled` / `Present` / `Absent` counts: US school sizes and US attendance levels.
- `Date`: US calendar (September–June year, US holidays). Kenyan terms run January–November.
- `School DBN`, `Released`: US-specific or undocumented.
- The mean US attendance rate (0.898) is **not** used as the Kenyan base rate. The noise level (US robust SD 0.35 logit) mixes many schools and district-wide shocks, so the single-school noise level is a separate assumption (0.22).

**Generated for the Kenyan context** (no US equivalent): the full calendar (terms, half-terms, public holidays, exam periods), enrollment trajectory, rainfall and weather category, special events, meal planning/preparation/serving, latent meal demand, supply shortfalls, and provenance fields.

## 5. Field dictionary

One record per calendar day, 1998-01-01 to 2025-12-31 (10,227 records).

| Field | Description |
|---|---|
| `date` | ISO date. Unique, contiguous, chronological. |
| `day_of_week` | Monday..Sunday, derived from `date`. |
| `is_school_day` | School operates: configured weekday, inside a term, not half-term, not a public holiday. |
| `is_school_holiday` | Inter-term holiday, half-term, or public holiday. In-term weekends are neither school days nor holidays. |
| `is_public_holiday` | Date is in the simplified public-holiday list (extra field). |
| `term` | `YYYY-T1`/`T2`/`T3` for every date inside a term span (weekends and half-term included); `holiday` otherwise. |
| `school_year` | Academic year = calendar year (Kenyan year runs Jan–Dec). |
| `week_of_term` | Week number within the term (week 1 = the Monday-to-Sunday week containing the term start). Null outside term. |
| `is_half_term` | Simulated half-term break. |
| `is_exam_period` | Simulated exam school day (mid-term or end-of-term). Only true on school days. |
| `students_enrolled` | Simulated register size. Changes only at term starts and weekly in-term transfers; constant during holidays. |
| `rainfall_mm` | Simulated daily rainfall (0.1 mm resolution). |
| `weather_category` | `dry` < 1 mm ≤ `light_rain` < 10 mm ≤ `moderate_rain` < 30 mm ≤ `heavy_rain`. |
| `is_special_event` / `special_event_type` | Scheduled event on a school day; type is null when there is no event. |
| `students_present` | Simulated attendance. Null on non-school days. |
| `meals_planned` | Meals planned before the day (see §6.5). Null on non-school days. |
| `meals_prepared` | Meals actually prepared. |
| `meals_served` | `min(estimated_meal_demand, meals_prepared)`. |
| `estimated_meal_demand` | Latent demand: present students who would take a meal if enough were available. |
| `is_supply_shortfall` | A supply shortfall reduced preparation below plan (extra field). |
| `source_type` | `synthetic` for every record in this file (`transformed` in the US reference files). |
| `synthetic_scenario` | Scenario name from the config (`baseline_v1`). |

Attendance and meal fields are **null, not zero**, on non-school days: no session took place, so there is no observation.

## 6. Generation process and assumptions

All values below live in `forecasting/config/synthetic_kenya_school.yaml`. The seed (`random_seed: 20250901`) feeds a NumPy `SeedSequence` that is split into independent streams (enrollment, rainfall, events, attendance, shocks, effects, uptake, preparation), so changing one component's parameters does not reshuffle the others.

### 6.1 Period and record count
28 full school years (1998–2025) × 365/366 days = **10,227 records**, of which 4,867 are school days. The period was chosen to reach approximately 10,000 daily records without duplicating dates or inventing calendar days. Real-world disruptions in this period (for example the 2020 COVID-19 closures and the compressed 2021–2022 calendars) are **not** modelled; `calendar.term_overrides` can be used to insert real dates.

### 6.2 Calendar (illustrative)
Three terms per year, each starting on the first Monday on/after an anchor date: T1 from 3 Jan (13 weeks), T2 from 28 Apr (14 weeks), T3 from 25 Aug (10 weeks). Half-terms of 2–3 weekdays mid-term. Exams: 3 school days before half-term in T1/T2, the last 5 school days of T1/T2 and the last 10 of T3. Public holidays: New Year, Good Friday, Easter Monday, Labour Day, Madaraka Day, Mashujaa Day, Jamhuri Day, Christmas, Boxing Day, with Sunday holidays observed on Monday. Idd-ul-Fitr and holidays that changed during the period (e.g. Moi/Utamaduni Day) are omitted. Saturday classes are not modelled. The result is 172–175 school days per year.

### 6.3 Enrollment
Starts at 480. At each T1 start: growth ~ Normal(1.8%, 2.5%) (new intake minus leavers). At T2/T3 starts: change ~ Normal(−0.3%, 0.8%). Each in-term Monday: Poisson(0.5) transfers in, Poisson(0.55) out. Bounded to [200, 1500]. Result: 480 → 594 over 28 years, largest daily change 5.7%.

### 6.4 Rainfall
A two-state (wet/dry) Markov chain per day with month-specific wet-day probability and gamma-distributed wet-day amounts, peaking in the long rains (Mar–May) and short rains (Oct–Dec). Each season in each year gets a lognormal multiplier (SD 0.30) for year-to-year variability. This is a simplified illustration of Kenya's bimodal pattern, not a climate model.

### 6.5 Attendance
`students_present ~ Binomial(students_enrolled, p)`, which guarantees `0 ≤ present ≤ enrolled`. `logit(p)` is the sum of:
- base rate 0.92 (Kenyan-context assumption);
- weekday offset (US reference);
- school-year effect ~ N(0, 0.08);
- first day of term −0.45, week 1 −0.30, last week −0.10, day before an in-term break (US reference), exam period +0.35;
- weather effect **drawn per day** from Normal(mean, sd) for the category (heavy rain: mean −0.25, sd 0.15), so rainy days reduce attendance only on average;
- event effect drawn per day (e.g. sports day +0.15, school meeting −0.15);
- occasional multi-day shock episodes (≈0.3 per term, 3–10 school days, e.g. illness outbreaks);
- AR(1) noise across consecutive school days (SD 0.22, persistence from US reference).

### 6.6 Meals
- **Demand**: `estimated_meal_demand ~ Binomial(students_present, uptake)`, with uptake ≈ 0.97 varied by event and day-level noise. It is generated separately from preparation, so it measures what *would* have been served with unlimited supply. In a real deployment demand is not directly observed; this field exists because the data is synthetic.
- **Planning** (no leakage): `meals_planned = ceil_to_5( mean attendance rate over the previous 10 school days × previous day's enrollment × calendar/event adjustments × 1.03 )`. Adjustments use only information known in advance: first day/week of term, exam period, scheduled event type. Same-day attendance and rainfall are never used.
- **Preparation**: normally planned × (1 + N(0, 1%)); on a supply shortfall (3% of school days, ×1.5 in rainy-season months) preparation falls 10–40% below plan.
- **Serving**: `meals_served = min(demand, prepared)`, so `0 ≤ served ≤ min(prepared, present)`. The gap between prepared and served is not labelled food waste.

### 6.7 Special events
Per term, Poisson(3) events on eligible school days (not exam days, not the first 3 school days), with term-specific type weights (e.g. more academic events in T3, more cultural days in T2).

## 7. Validation and quality reporting

`validate_synthetic_dataset.py` runs 79 checks across structure, dates, calendar consistency, events, enrollment/weather, attendance/meals, leakage, provenance and reproducibility. The leakage checks re-run the planning function on the saved CSV and confirm (a) every `meals_planned` value is reproduced, and (b) setting a day's `students_present` to 0 and `rainfall_mm` to 999 does not change that day's plan. Results: [`validation_report.md`](../forecasting/data/reports/validation_report.md).

`data_quality_report.py` summarises distributions and relationships and checks that the data follows the configured assumptions: [`data_quality_report.md`](../forecasting/data/reports/data_quality_report.md). It measures internal consistency, **not** real-world accuracy.

## 8. Forecasting readiness (for the next phase)

- **Target**: `estimated_meal_demand`. `meals_served` is censored by `meals_prepared` on shortfall days (demand exceeded preparation on ~4% of school days), so it understates demand. If only real served data were available, shortfall days should be treated as censored or excluded.
- **Date field**: `date` (Prophet `ds`), filtered to `is_school_day == True`. Non-school days have no target and should not be passed as zeros.
- **Candidate predictors known in advance**: `day_of_week`, `term`, `week_of_term`, `is_exam_period`, `is_half_term`/holiday adjacency, `is_special_event`/`special_event_type`, `students_enrolled` (previous day's value), lagged attendance or demand (strictly prior days). `rainfall_mm`/`weather_category` may only be used as a *forecast* input (a weather forecast), not same-day observed rainfall, unless the evaluation explicitly assumes perfect weather forecasts.
- **Leakage risks**: same-day `students_present`, `meals_served`, `meals_prepared`, `is_supply_shortfall` and observed same-day rainfall are not available before the day and must not be predictors. `meals_planned` is a legitimate *baseline for comparison* (it uses prior information only), but it is not a target.
- **Evaluation**: chronological splits only — never random shuffling. Suggested: train 1998–2021, validate 2022–2023, test 2024–2025; or a rolling-origin evaluation by term. Compare against `meals_planned` and against simple baselines in the next phase.
- **Limitations**: all relationships were written into the generator, so a model can at best rediscover the configured assumptions. Results on this data demonstrate that the pipeline works, not that forecasts would be accurate for a real Kenyan school. The same seed produces one realisation; robustness can be explored with other seeds or scenarios.
