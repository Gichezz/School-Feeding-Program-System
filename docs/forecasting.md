# Meal-Demand Forecasting (Phase 10)

> **Synthetic data only.** Every model here is trained and evaluated on the Phase 9 synthetic dataset, which represents **one simulated Kenyan school** under documented assumptions ([synthetic-dataset.md](synthetic-dataset.md)). No model has been validated against real Kenyan school records. The results compare methods on simulated data; they are not evidence of real-world accuracy.

## 1. Dataset

`forecasting/data/processed/synthetic_kenya_school_daily.csv`: 10,227 daily records, 1998-01-01 to 2025-12-31, one row per calendar day, no duplicate dates, no gaps. 4,867 are school days and 5,360 are non-school days (weekends, holidays, half-terms, public holidays). The pipeline re-checks all of this on every run (`models/data.py`) and records the dataset SHA-256 with each result.

## 2. Target

`estimated_meal_demand`: the number of present students who would take a meal if enough were prepared. It is the target rather than `meals_served`, because `meals_served = min(demand, meals_prepared)` is capped on supply-shortfall days and would teach a model to under-forecast.

## 3. Preprocessing (`forecasting/models/data.py`)

1. Load the CSV and parse `date` as a datetime (an unparseable date is an error).
2. Sort chronologically, then reject duplicate dates and record whether the daily sequence has gaps.
3. Parse the boolean columns and select school days (`is_school_day == True`).
4. Check the target: present on every school day (an error otherwise), absent on non-school days, and never negative.
5. Keep **school days only**. Non-school days are dropped, **not** set to zero: no session takes place, so there is no demand to observe or predict. Consequences:
   - Models learn from 4,867 irregularly spaced dates. Prophet handles irregular dates natively; the baselines work on the sequence of school days.
   - Forecasts are produced only for dates the configured school calendar marks as school days. A request covering a holiday returns no forecast for those dates rather than a misleading zero or a weekday-like value.
   - Future school days come from the Phase 9 calendar rules (`config/synthetic_kenya_school.yaml`, built by `generate_synthetic_dataset.build_calendar`). The evaluation script checks that these rules reproduce the dataset's own school days and calendar flags exactly.

## 4. Chronological split

| Split | Configured dates | First school day | Last school day | School days |
|---|---|---|---|---|
| Train | 1998-01-01 to 2021-12-31 | 1998-01-05 | 2021-11-05 | 4,173 |
| Validation | 2022-01-01 to 2023-12-31 | 2022-01-03 | 2023-11-03 | 347 |
| Test | 2024-01-01 to 2025-12-31 | 2024-01-08 | 2025-10-31 | 347 |

The split from the Phase 9 report is fully covered by the data. Validation is used for all selection and tuning; the test period is evaluated once, for the selected configurations only. There is no random shuffling. Prophet standardises regressors using only the data it is fitted on, so no statistics leak from later periods.

## 5. Baselines (`forecasting/models/baselines.py`)

The average baselines compute one level from school days **strictly before** the forecast origin and use it for every school day in the horizon. Later days never use actual values from earlier days in the same horizon.

- **Historical average**, two variants:
  - `expanding`: mean of all previous school days.
  - `trailing_365d`: mean of school days in the previous 365 calendar days. It falls back to the expanding mean if that window is empty.

  The expanding mean is included to show the cost of ignoring the enrollment trend. Validation chooses between the two.
- **Moving average** over the last 5, 10 or 20 school days; validation chooses the window. With fewer past school days than the window it averages those available. With none it raises `InsufficientHistoryError`, and that origin is skipped for that model. This never happens with this dataset, because evaluation origins start after 24 years of history.
- **Seasonal naive** (same weekday last week): each school day gets the demand of the most recent school day before the origin that fell on the same weekday. It is the textbook minimum benchmark for daily data: a model that cannot beat it is not worth deploying.

## 6. Prophet configuration (`forecasting/models/prophet_model.py`)

Input: `ds` = school date, `y` = `estimated_meal_demand`. All candidates use weekly and yearly seasonality and no daily seasonality, with an 80% interval width and 1,000 uncertainty samples.

- **Stage 1** compares regressor sets with default parameters (`changepoint_prior_scale` 0.05, additive seasonality):
  - `prophet_basic`: no regressors.
  - `prophet_calendar`: first day of term, first week of term, exam period.
  - `prophet_calendar_enrollment`: the calendar regressors plus enrollment.
- **Stage 2** tunes the best stage-1 set with `changepoint_prior_scale` 0.01 and 0.5, and with multiplicative seasonality.

The grid is deliberately small, to avoid over-tuning on synthetic data.

## 7. Regressors and their availability

| Regressor | Source at forecast time | Used? |
|---|---|---|
| `first_day_of_term`, `first_week_of_term`, `exam_period` | Configured school calendar (known in advance) | Candidate |
| `students_enrolled` | School records. The last value known before the origin, held constant over the horizon (the API accepts the current value) | Candidate |
| Day of week, time of year | Derived from the date by Prophet's seasonality | Yes (seasonality) |
| `rainfall_mm`, `weather_category` | Not known for future dates without a weather-forecast integration | **No** |
| `students_present`, `meals_served`, `meals_prepared`, `is_supply_shortfall` | Only known after the day; using them would leak the target | **No** |
| `is_special_event`, `special_event_type` | Scheduled in advance in reality, but no event schedule exists for future dates in this system yet | **No** (possible later) |
| `meals_planned` | Derived from prior attendance; it is the school's own plan, not an input signal | **No** |

During evaluation, training rows use each day's recorded enrollment. Forecast rows use the enrollment from the last school day before the origin, not the actual (future) value.

## 8. Alternative models compared with Prophet (issue #48)

The literature review compares Prophet with ARIMA, LSTM and Random Forest. The evaluation tests those claims with evidence: every alternative is run through the same rolling-origin windows, splits, horizons and metrics as Prophet, and validation picks one configuration per family before the test period is scored once. Gradient-boosted trees are included as well, as the strongest widely used tree method.

| Family | Module | How it sees time | Candidates (validation picks one) |
|---|---|---|---|
| Seasonal naive | `models/baselines.py` | Same weekday last week | – |
| SARIMA (statistical) | `models/sarima_model.py` | ARIMA on the sequence of school days with a 5-step weekly season. Calendar regressors: first day/week of term, exam period, enrollment (last known value held constant), position in the year (sine/cosine). Refitted at each origin on the latest 750 school days (about three school years). | (1,0,1)(1,0,1)₅, (2,0,1)(1,0,1)₅, (0,1,1)(0,1,1)₅ |
| Random Forest (machine learning) | `models/ml_models.py` | Features: weekday, month, position in the year, term number, week of term, the term and exam flags, enrollment, and lagged demand (mean over 30–58 days back, and the value 35 days back, the same weekday). Refitted at each origin on all earlier school days. | 300 trees, `min_samples_leaf` 1 or 10 |
| Gradient boosting (machine learning) | `models/ml_models.py` | Same features as Random Forest; scikit-learn's histogram gradient boosting (the LightGBM algorithm). | learning rate 0.05 / 400 rounds / 15 leaves, or 0.1 / 200 / 31 |

**No leakage.** Lagged demand always comes from at least 30 days before the day being forecast, which is the longest horizon. Every day in a 30-day window can therefore be forecast from history before the origin alone, with the same features the model was trained on, and no forecast is fed back as an input. SARIMA forecasts the window in one step from history before the origin. Tests check that hiding the actual values being forecast does not change any model's forecast (`tests/test_alternative_models.py`).

**Not included: LSTM.** The project's delimitations exclude deep-learning models such as LSTM because of their data and computing needs, which do not suit a lightweight service for low-resource schools.

These models are used for evaluation only: `scikit-learn` and `statsmodels` are listed in `requirements-dev.txt`, and the production service and Docker image serve Prophet alone.

## 9. Evaluation methodology (`forecasting/models/evaluation.py`)

Rolling-origin evaluation with an expanding window:

- Forecast origins are placed every 14 calendar days through the validation (or test) period. A forecast made at origin *o* uses data up to *o − 1 day*.
- At each origin every model forecasts all school days in the next 30 calendar days that fall in the same split. Prophet, SARIMA, Random Forest and gradient boosting are refitted at every origin.
- Horizon *H* ∈ {7, 14, 30} scores the forecasts for targets up to *H* days ahead. Because no model feeds its own predictions or later actuals back in, a target's forecast is the same whichever horizon it is scored under.
- All models are scored on exactly the same origins and target dates.
- Metrics:
  - MAE and RMSE.
  - **WAPE** = Σ|error| / Σ|actual| (the primary percentage metric).
  - MAPE, computed only over actuals ≥ 1 so it never divides by zero (demand is never below 333 here, so no observations are excluded).
  - Bias = mean(forecast − actual).
- Selection: the lowest mean MAE across the three horizons on validation, one configuration per model family.
- Consistency: for each model, the number of test origins at which Prophet's error over the 30-day window was lower.
- Speed: the mean time to fit a model and forecast one window (seconds per origin).
- Prophet intervals: empirical coverage of 80% and 95% intervals on validation and test.

## 10. Evaluation results

Full tables: [`forecasting/data/reports/forecast_evaluation_report.md`](../forecasting/data/reports/forecast_evaluation_report.md). Per-forecast predictions: `forecast_evaluation_predictions.csv`. Design: 45 validation origins and 45 test origins, a 14-day step, and every fitted model refitted at every origin. The run took about 18 minutes.

**Selected on validation (one per family, mean MAE over the three horizons):**
- `historical_average_trailing_365d` (13.08; the expanding mean had MAE ≈ 74, because it ignores enrollment growth);
- `moving_average_20` (12.58; windows 5 / 10 / 20 had 14.35 / 12.73 / 12.58);
- `seasonal_naive_weekly` (16.75);
- `sarima_201_101_5` (11.70; the other orders had 11.73 and 12.10);
- `random_forest_leaf1` (12.87; `min_samples_leaf` 10 had 13.31);
- `gradient_boosting_lr005` (11.99; the faster learning rate had 12.11);
- `prophet_calendar_enrollment` with `changepoint_prior_scale = 0.01` (10.99): calendar regressors plus enrollment, weekly and yearly seasonality, additive.

**Test period (2024–2025), averaged over the 7, 14 and 30-day horizons:**

| Rank | Model | MAE | RMSE | MAPE | Bias | MAE better than seasonal naive | Test origins where Prophet is more accurate | Seconds per origin |
|---|---|---|---|---|---|---|---|---|
| 1 | **Prophet** (calendar + enrollment) | **11.87** | **15.33** | **2.32%** | +3.17 | 39.0% | – | 0.86 |
| 2 | SARIMA (2,0,1)(1,0,1)₅ | 12.37 | 16.12 | 2.41% | +3.20 | 36.5% | 30 of 45 | 2.68 |
| 3 | Gradient boosting | 12.83 | 16.30 | 2.50% | +2.43 | 34.1% | 33 of 45 | 0.55 |
| 4 | Random Forest | 13.49 | 16.79 | 2.61% | −0.25 | 30.7% | 40 of 45 | 0.83 |
| 5 | Historical average (trailing 365 d) | 13.61 | 17.64 | 2.64% | −0.17 | 30.1% | 37 of 45 | – |
| 6 | Moving average (20 school days) | 14.15 | 18.17 | 2.75% | +0.38 | 27.4% | 38 of 45 | – |
| 7 | Seasonal naive (same weekday last week) | 19.48 | 25.00 | 3.77% | +0.97 | – | 43 of 45 | – |

Prophet also has the lowest test MAE at each horizon on its own: 11.85 / 11.86 / 11.91 at 7 / 14 / 30 days, against SARIMA's 12.21 / 12.46 / 12.44 and gradient boosting's 12.63 / 12.93 / 12.93. Prophet, SARIMA and gradient boosting rank in the same order on validation as on test. Per-horizon tables for every model are in the full report.

The validation forecasts target 2022–2023 school days. The test forecasts target 2024-01-08 to 2025-10-31 for the 14- and 30-day horizons, and 2024-01-15 to 2025-10-24 for the 7-day horizon. The 7-day range is shorter because 8–12 January 2024 and 27–31 October 2025 fall 8 or more days after the nearest earlier origin (2024-01-01 and 2025-10-20), so they are only scored at the 14- and 30-day horizons. Within each split, all models are scored on identical dates.

`n` counts forecasts, not unique dates. Origins are 14 days apart but forecasts look up to 30 days ahead, so one date can be forecast from up to three origins. For example, the 752 test forecasts at the 30-day horizon cover 347 unique school days, each scored 1–3 times. This is normal for rolling-origin evaluation, but the forecasts are not independent samples, which is why the origin-by-origin comparison is reported as well. MAPE is within about 0.05 percentage points of WAPE for every model. No actuals were excluded from MAPE, because the lowest demand is 333 meals.

**What this means, in plain language:**
- On the held-out test years, Prophet is off by about **12 meals per school day** on average (about 2.3% of demand). SARIMA, the closest rival, is off by about **12.4 meals**, gradient boosting by **12.8**, Random Forest by **13.5**, and the best simple baseline by **13.6**.
- Prophet's lead is **small but consistent**: it is more accurate than SARIMA at 30 of the 45 test origins, and than every other model at 33 or more. Every model beats the seasonal naive benchmark by 27–39%.
- **SARIMA comes close** once it is given the same calendar and enrollment information, as expected of a well-specified statistical model. It is about three times slower to fit than Prophet here and needs the most recent 750 days of actual demand at every forecast.
- **The tree models need feature engineering to see time**, as the literature review notes. Even with lagged demand and calendar features, Random Forest is barely better than a trailing average; gradient boosting does better but still trails SARIMA and Prophet.
- Prophet's gain over the simple baselines comes mainly from **enrollment**. Without it, Prophet was no better than the moving average on validation (`prophet_basic` MAE 13.1–13.3, `prophet_calendar` 12.8–12.9, versus moving average 12.4–12.7). Tuning made almost no difference: all four enrollment variants were within 0.1 MAE of each other.
- Error barely grows from 7 to 30 days, because the series has no short-term shocks a model could exploit.
- Prophet and SARIMA over-forecast slightly on test (bias about +3 meals); the averages and Random Forest are nearly unbiased. Over-forecasting is usually safer for food preparation than under-forecasting, but this is an observation, not a design guarantee.
- All models do somewhat worse on test than on validation (Prophet MAE 10.8–11.2 rising to 11.9). The cause was not investigated, so no explanation is offered here.

**Prediction intervals (selected Prophet configuration):**

| Split | Horizon | 80% interval coverage | 95% interval coverage |
|---|---|---|---|
| Validation | 7 / 14 / 30 | 76.7% / 78.4% / 77.3% | 94.3% / 92.2% / 92.7% |
| Test | 7 / 14 / 30 | 76.8% / 74.6% / 73.7% | 88.7% / 87.3% / 87.1% |

The intervals are somewhat too narrow, especially on test: about 74–77% of actuals fell inside the nominal 80% interval, and about 87–89% inside the nominal 95% interval. Treat them as rough indications of spread, not guaranteed bounds. Because the noise is synthetic, this coverage says nothing reliable about real-world uncertainty.

**Decision: keep Prophet in production.**
1. **Most accurate:** the lowest error on validation and on test, at every horizon, against both alternatives from the literature review (SARIMA, Random Forest) and gradient boosting.
2. **Consistently so:** more accurate than each rival at most test origins (30 to 43 of 45), so the lower average is not driven by a few periods.
3. **Works from the calendar alone:** Prophet forecasts any future date range from the school calendar and the latest enrollment. SARIMA and the tree models need recent actual demand at every forecast (the last 750 school days, or lags 30–58 days back), which this service does not hold, because it is designed not to read PostgreSQL.
4. **Fast enough to refit:** under a second per fit, against about 2.7 seconds for SARIMA (timings vary a little between runs).
5. **Explainable:** it separates trend, weekly and yearly patterns and the calendar effects, and it gives prediction intervals; the tree models give neither.

**Caveat.** The margins are small: about 0.5 meals per day over SARIMA (4%). The synthetic data was generated from additive trend, seasonal, calendar and enrollment effects, a structure Prophet models directly, so the data may favour it. The comparison should be repeated on real school records before treating the ranking as settled; `scripts/evaluate_forecasting_models.py` reruns it unchanged on any dataset with the same columns.

## 11. Model artifact

| File | Contents |
|---|---|
| `forecasting/models/artifacts/prophet_model.json` | Prophet model (Prophet's own `model_to_json` serialisation) |
| `forecasting/models/artifacts/model_metadata.json` | Configuration, regressors and their availability, training range, last known enrollment, horizon settings, interval width, seed, evaluation metrics, dataset and calendar-config SHA-256, library versions, training timestamp |

The deployed model is the validation-selected Prophet configuration, refitted on **all** school days (1998-01-05 to 2025-10-31). The reported metrics come from the rolling-origin evaluation, not from this final fit.

**Reproducibility.** Prophet's Stan optimiser (L-BFGS) starts from fixed initial values, so the fitted parameters are deterministic for the same data and library versions. Interval sampling uses NumPy's global RNG, which is seeded before every prediction (`prophet.random_seed`). Remaining sources of nondeterminism are differences in library or CmdStan versions and floating-point differences between platforms.

## 12. Commands

From the repository root, using the forecasting virtualenv:

```bash
cd forecasting
python -m venv venv
venv\Scripts\activate
pip install -r requirements-dev.txt
cd ..
python forecasting/scripts/evaluate_forecasting_models.py
python forecasting/scripts/train_forecasting_model.py
```

`train_forecasting_model.py` reads the selected configuration from `forecasting/data/reports/forecast_evaluation.json`, so evaluation must run first. Training alone takes seconds; the full evaluation, with all seven model families, takes about 18 minutes.

## 13. Starting the Flask service

```bash
cd forecasting
venv\Scripts\activate
python app.py
```

The model loads once at startup and is never retrained per request. If the artifact is missing, the service still starts: `/health` reports `"forecasting": "model_not_loaded"` and `/api/forecast` returns 503 with the training command.

**Port note:** Flask runs on 5001 (`FLASK_RUN_PORT`) and the Express backend on 5000 (`PORT` in `backend/.env.example`), so both can run side by side. The backend reaches this service through `FORECASTING_SERVICE_URL=http://localhost:5001`.

## 14. Forecast endpoint

`GET /api/forecast` (the existing route). Query parameters, all optional:

| Parameter | Format | Default | Rules |
|---|---|---|---|
| `horizon_days` | integer | 14 | 1 to 60 calendar days |
| `start_date` | `YYYY-MM-DD` | today | after the training data end and within 730 days of it |
| `enrollment` | integer | last enrollment in training data | 1 to 20,000; used only if the model uses enrollment |

Unknown parameters are rejected. Errors use the backend's shape, `{"error": "<message>"}`, with these statuses: 400 for invalid requests, 404 or 405 for unknown routes or methods, 503 when the model artifact is missing, and 500 for unexpected errors.

Example (the values shown are illustrative):

```bash
curl "http://localhost:5001/api/forecast?start_date=2026-10-05&horizon_days=7&enrollment=600"
```

```json
{
  "model": "prophet",
  "model_name": "...",
  "target": "estimated_meal_demand",
  "trained_at": "...",
  "training_data_end": "2025-10-31",
  "start_date": "2026-10-05",
  "end_date": "2026-10-11",
  "horizon_days": 7,
  "interval_width": 0.8,
  "school_days_forecast": 5,
  "non_school_days_excluded": 2,
  "forecast": [
    {"date": "2026-10-05", "day_of_week": "Monday", "predicted_demand": 0, "lower_bound": 0, "upper_bound": 0}
  ],
  "assumptions": ["..."],
  "data_notice": "Trained on synthetic data for one simulated Kenyan school. Not validated against real school records."
}
```

Dates are ISO `YYYY-MM-DD`. The Express API presents dates to the frontend as `DD-MM-YYYY`, so converting dates will be part of the later integration phase. Predictions are rounded to whole meals and clipped at zero. The bounds are Prophet's 80% prediction interval.

## 15. Tests

```bash
cd forecasting
venv\Scripts\python -m pytest tests
```

The tests use a small two-year fixture built from the configured calendar and a tiny Prophet model trained in about a second. `test_alternative_models.py` covers the seasonal naive baseline, the SARIMA, Random Forest and gradient-boosting forecasters (no leakage, reproducibility, horizon limits) and the comparison helpers. One test checks the real dataset's documented structure and is skipped if the dataset has not been generated.

## 16. Known limitations

- **Synthetic data.** The data-generating process is known and relatively smooth, so every model can at best rediscover the Phase 9 assumptions. Good scores do not transfer to a real school.
- **Interval coverage is measured against synthetic noise** and does not describe real-world uncertainty.
- **The model comparison may favour Prophet**, because the synthetic data was generated from the kind of additive structure Prophet models; the margins over SARIMA and gradient boosting are small.
- **Enrollment is held constant over the horizon.** Term-start intake changes inside a horizon are not anticipated unless the caller supplies the new value.
- **Special events and weather are not used,** because no future event schedule or weather forecast is integrated yet.
- **The future calendar uses the illustrative Phase 9 rules.** A real deployment needs the school's actual term dates (`calendar.term_overrides`).
- **The deployed model is trained to 2025-10-31.** Forecasts far beyond that (up to 730 days are allowed) rely on trend extrapolation and should be retrained with recent data.
- **The service does not read PostgreSQL.** The Express backend calls it through `GET /api/forecasts`, supplies the enrollment from attendance records and stores the results; the React Forecast page displays them. The model itself is not retrained from records collected by the system.

## 17. Running the demonstration notebook in Google Colab

`forecasting/notebooks/forecasting_demo_colab.ipynb` walks through the whole pipeline by importing this project's own code (no separate implementation). It loads the saved evaluation results by default and can recompute them with `RUN_FULL_EVALUATION = True`.

1. Build the bundle (from the repository root), which zips the forecasting code, config, dataset, saved model and evaluation results:

   ```bash
   forecasting\venv\Scripts\python forecasting/scripts/make_colab_bundle.py
   ```

   This writes `school_feeding_forecasting_colab.zip` (about 0.5 MB) in the repository root. It is a build output; do not commit it.
2. In Colab: **File → Upload notebook** and choose the `.ipynb` file.
3. Run cell 0.1 and upload the zip when prompted, then run cell 0.2. When it finishes, use **Runtime → Restart session**.
4. Continue from cell 0.3 and run the rest top to bottom.

Rebuild the bundle after retraining or re-running the evaluation, so Colab gets the current artifacts.
