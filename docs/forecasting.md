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

Both baselines compute one level from school days **strictly before** the forecast origin and use it for every school day in the horizon. Later days never use actual values from earlier days in the same horizon.

- **Historical average**, two variants:
  - `expanding`: mean of all previous school days.
  - `trailing_365d`: mean of school days in the previous 365 calendar days. It falls back to the expanding mean if that window is empty.

  The expanding mean is included to show the cost of ignoring the enrollment trend. Validation chooses between the two.
- **Moving average** over the last 5, 10 or 20 school days; validation chooses the window. With fewer past school days than the window it averages those available. With none it raises `InsufficientHistoryError`, and that origin is skipped for that model. This never happens with this dataset, because evaluation origins start after 24 years of history.

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

## 8. Evaluation methodology (`forecasting/models/evaluation.py`)

Rolling-origin evaluation with an expanding window:

- Forecast origins are placed every 14 calendar days through the validation (or test) period. A forecast made at origin *o* uses data up to *o − 1 day*.
- At each origin every model forecasts all school days in the next 30 calendar days that fall in the same split. Prophet is refitted at every origin.
- Horizon *H* ∈ {7, 14, 30} scores the forecasts for targets up to *H* days ahead. Because no model feeds its own predictions or later actuals back in, a target's forecast is the same whichever horizon it is scored under.
- All models are scored on exactly the same origins and target dates.
- Metrics:
  - MAE and RMSE.
  - **WAPE** = Σ|error| / Σ|actual| (the primary percentage metric).
  - MAPE, computed only over actuals ≥ 1 so it never divides by zero (demand is never below 333 here, so no observations are excluded).
  - Bias = mean(forecast − actual).
- Selection: the lowest mean MAE across the three horizons on validation.
- Prophet intervals: empirical coverage of 80% and 95% intervals on validation and test.

## 9. Evaluation results

Full tables: [`forecasting/data/reports/forecast_evaluation_report.md`](../forecasting/data/reports/forecast_evaluation_report.md). Per-forecast predictions: `forecast_evaluation_predictions.csv`. Design: 45 validation origins and 45 test origins, a 14-day step, and a Prophet refit at every origin. The run took 404 s.

**Selected on validation:**
- `historical_average_trailing_365d` (the expanding mean had MAE ≈ 74, because it ignores enrollment growth);
- `moving_average_20` (windows 5 / 10 / 20 had mean MAE 14.35 / 12.73 / 12.58);
- `prophet_calendar_enrollment` with `changepoint_prior_scale = 0.01`: calendar regressors plus enrollment, weekly and yearly seasonality, additive.

| Model | Horizon | Val MAE | Val RMSE | Val WAPE | Val n | Test MAE | Test RMSE | Test WAPE | Test n |
|---|---|---|---|---|---|---|---|---|---|
| Historical average (trailing 365 d) | 7 | 12.94 | 15.94 | 2.47% | 176 | 13.26 | 17.28 | 2.55% | 168 |
| Moving average (20 school days) | 7 | 12.42 | 15.32 | 2.37% | 176 | 13.57 | 17.69 | 2.61% | 168 |
| Prophet (selected) | 7 | 11.24 | 14.03 | 2.15% | 176 | 11.85 | 15.10 | 2.28% | 168 |
| Historical average (trailing 365 d) | 14 | 13.18 | 16.34 | 2.52% | 347 | 13.84 | 17.91 | 2.66% | 347 |
| Moving average (20 school days) | 14 | 12.68 | 15.89 | 2.42% | 347 | 14.61 | 18.63 | 2.81% | 347 |
| Prophet (selected) | 14 | 10.88 | 13.83 | 2.08% | 347 | 11.86 | 15.40 | 2.28% | 347 |
| Historical average (trailing 365 d) | 30 | 13.13 | 16.27 | 2.51% | 684 | 13.74 | 17.74 | 2.64% | 752 |
| Moving average (20 school days) | 30 | 12.63 | 15.82 | 2.41% | 684 | 14.26 | 18.20 | 2.74% | 752 |
| Prophet (selected) | 30 | 10.84 | 13.76 | 2.07% | 684 | 11.91 | 15.48 | 2.29% | 752 |

The validation forecasts target 2022–2023 school days. The test forecasts target 2024-01-08 to 2025-10-31 for the 14- and 30-day horizons, and 2024-01-15 to 2025-10-24 for the 7-day horizon. The 7-day range is shorter because 8–12 January 2024 and 27–31 October 2025 fall 8 or more days after the nearest earlier origin (2024-01-01 and 2025-10-20), so they are only scored at the 14- and 30-day horizons. Within each split, all three models are scored on identical dates.

`n` counts forecasts, not unique dates. Origins are 14 days apart but forecasts look up to 30 days ahead, so one date can be forecast from up to three origins. For example, the 752 test forecasts at the 30-day horizon cover 347 unique school days, each scored 1–3 times. This is normal for rolling-origin evaluation, but the forecasts are not independent samples. For the selected models, MAPE is within 0.05 percentage points of WAPE. No actuals were excluded from MAPE, because the lowest demand is 333 meals.

**What this means, in plain language:**
- On the held-out test years, the selected Prophet model is off by about **12 meals per school day** on average (about 2.3% of demand). The best baseline is off by about **13–14 meals** (2.6–2.8%). Prophet's advantage is real but small: roughly 1.4–2.8 meals per day.
- Simple baselines are already strong here because the simulated demand is stable from week to week. Prophet's gain comes mainly from **enrollment**. Without it, Prophet was no better than the moving average on validation (`prophet_basic` MAE 13.1–13.3, `prophet_calendar` 12.8–12.9, versus moving average 12.4–12.7).
- Tuning made almost no difference: all four enrollment variants were within 0.1 MAE of each other on validation. The selected `changepoint_prior_scale = 0.01` won by a margin that is not meaningful.
- Error barely grows from 7 to 30 days, because the series has no short-term shocks a model could exploit.
- Prophet over-forecasts slightly on test (bias +2.8 to +3.8 meals); the baselines are nearly unbiased there. Over-forecasting is usually safer for food preparation than under-forecasting, but this is an observation, not a design guarantee.
- All models do somewhat worse on test than on validation (Prophet MAE 10.8–11.2 rising to 11.9). The cause was not investigated, so no explanation is offered here.

**Prediction intervals (selected Prophet configuration):**

| Split | Horizon | 80% interval coverage | 95% interval coverage |
|---|---|---|---|
| Validation | 7 / 14 / 30 | 76.7% / 78.4% / 77.3% | 94.3% / 92.2% / 92.7% |
| Test | 7 / 14 / 30 | 76.8% / 74.6% / 73.7% | 88.7% / 87.3% / 87.1% |

The intervals are somewhat too narrow, especially on test: about 74–77% of actuals fell inside the nominal 80% interval, and about 87–89% inside the nominal 95% interval. Treat them as rough indications of spread, not guaranteed bounds. Because the noise is synthetic, this coverage says nothing reliable about real-world uncertainty.

**Selection and practical considerations.** Prophet had the lowest validation error and also the lowest test error, and it can produce forecasts for any future date range from the calendar alone. The moving average needs the latest actual demand values, which this service does not hold, because it is designed not to read PostgreSQL. Prophet is therefore the model served by the API. The baselines remain useful reference points, and they could be served in the integration phase if the backend supplies recent demand.

## 10. Model artifact

| File | Contents |
|---|---|
| `forecasting/models/artifacts/prophet_model.json` | Prophet model (Prophet's own `model_to_json` serialisation) |
| `forecasting/models/artifacts/model_metadata.json` | Configuration, regressors and their availability, training range, last known enrollment, horizon settings, interval width, seed, evaluation metrics, dataset and calendar-config SHA-256, library versions, training timestamp |

The deployed model is the validation-selected Prophet configuration, refitted on **all** school days (1998-01-05 to 2025-10-31). The reported metrics come from the rolling-origin evaluation, not from this final fit.

**Reproducibility.** Prophet's Stan optimiser (L-BFGS) starts from fixed initial values, so the fitted parameters are deterministic for the same data and library versions. Interval sampling uses NumPy's global RNG, which is seeded before every prediction (`prophet.random_seed`). Remaining sources of nondeterminism are differences in library or CmdStan versions and floating-point differences between platforms.

## 11. Commands

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

`train_forecasting_model.py` reads the selected configuration from `forecasting/data/reports/forecast_evaluation.json`, so evaluation must run first. Training alone takes seconds; the full evaluation takes several minutes.

## 12. Starting the Flask service

```bash
cd forecasting
venv\Scripts\activate
python app.py
```

The model loads once at startup and is never retrained per request. If the artifact is missing, the service still starts: `/health` reports `"forecasting": "model_not_loaded"` and `/api/forecast` returns 503 with the training command.

**Port note:** Flask runs on 5001 (`FLASK_RUN_PORT`) and the Express backend on 5000 (`PORT` in `backend/.env.example`), so both can run side by side. The backend reaches this service through `FORECASTING_SERVICE_URL=http://localhost:5001`.

## 13. Forecast endpoint

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

## 14. Tests

```bash
cd forecasting
venv\Scripts\python -m pytest tests
```

The tests use a small two-year fixture built from the configured calendar and a tiny Prophet model trained in about a second. One test checks the real dataset's documented structure and is skipped if the dataset has not been generated.

## 15. Known limitations

- **Synthetic data.** The data-generating process is known and relatively smooth, so every model can at best rediscover the Phase 9 assumptions. Good scores do not transfer to a real school.
- **Interval coverage is measured against synthetic noise** and does not describe real-world uncertainty.
- **Enrollment is held constant over the horizon.** Term-start intake changes inside a horizon are not anticipated unless the caller supplies the new value.
- **Special events and weather are not used,** because no future event schedule or weather forecast is integrated yet.
- **The future calendar uses the illustrative Phase 9 rules.** A real deployment needs the school's actual term dates (`calendar.term_overrides`).
- **The deployed model is trained to 2025-10-31.** Forecasts far beyond that (up to 730 days are allowed) rely on trend extrapolation and should be retrained with recent data.
- **The service does not read PostgreSQL.** The Express backend calls it through `GET /api/forecasts`, supplies the enrollment from attendance records and stores the results; the React Forecast page displays them. The model itself is not retrained from records collected by the system.

## 16. Running the demonstration notebook in Google Colab

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
