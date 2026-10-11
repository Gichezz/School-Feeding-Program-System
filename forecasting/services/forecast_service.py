"""
Forecasting service: loads the saved Prophet artifact once and produces
school-day meal-demand forecasts. It never retrains and never connects to
PostgreSQL. Train the artifact with scripts/train_forecasting_model.py.
"""

import datetime as dt
import threading

import pandas as pd

from models.data import load_forecast_config, resolve
from models.features import future_school_days
from models.prophet_model import load_model, predict_prophet

ALLOWED_PARAMS = {"horizon_days", "start_date", "enrollment"}
MAX_ENROLLMENT = 20000

DATA_NOTICE = ("Trained on synthetic data for one simulated Kenyan school. "
               "Not validated against real school records.")


class ForecastError(Exception):
    status_code = 500


class ForecastRequestError(ForecastError):
    status_code = 400


class ModelNotAvailableError(ForecastError):
    status_code = 503


class ForecastService:
    def __init__(self, model_dir=None, config=None, today=None):
        self.config = config or load_forecast_config()
        art = self.config["artifacts"]
        self.model_dir = resolve(model_dir or art["dir"])
        self.model_file, self.metadata_file = art["model_file"], art["metadata_file"]
        self._today = today  # injectable for tests
        self._lock = threading.Lock()
        self.model = None
        self.metadata = None
        self.load_error = None

    # -- loading ---------------------------------------------------------------
    def load(self):
        """Load the artifact if not loaded yet. Safe to call repeatedly."""
        if self.model is not None:
            return True
        with self._lock:
            if self.model is not None:
                return True
            try:
                self.model, self.metadata = load_model(self.model_dir, self.model_file, self.metadata_file)
                self.load_error = None
            except FileNotFoundError as e:
                self.load_error = f"{e}. Run: python forecasting/scripts/train_forecasting_model.py"
            except Exception as e:  # corrupt or incompatible artifact
                self.load_error = f"Model artifact could not be loaded: {e}"
        return self.model is not None

    @property
    def ready(self):
        return self.model is not None

    def status(self):
        if not self.ready:
            return {"model_loaded": False, "detail": self.load_error}
        m = self.metadata
        return {"model_loaded": True, "model": m["model_type"], "model_name": m["model_name"],
                "target": m["target"], "trained_at": m["trained_at_utc"],
                "training_data_end": m["training_data"]["last_date"]}

    # -- request handling ----------------------------------------------------
    def today(self):
        return pd.Timestamp(self._today or dt.date.today())

    def parse_request(self, args):
        unknown = set(args) - ALLOWED_PARAMS
        if unknown:
            raise ForecastRequestError(f"Unknown parameter(s): {', '.join(sorted(unknown))}. "
                                       f"Allowed: {', '.join(sorted(ALLOWED_PARAMS))}")
        h = (self.metadata or {}).get("horizon") or self.config["horizon"]
        raw_h = args.get("horizon_days", h["default_days"])
        try:
            horizon = int(str(raw_h).strip())
        except ValueError:
            raise ForecastRequestError("horizon_days must be an integer") from None
        if not h["min_days"] <= horizon <= h["max_days"]:
            raise ForecastRequestError(f"horizon_days must be between {h['min_days']} and {h['max_days']}")

        raw_start = args.get("start_date")
        if raw_start is None:
            start = self.today()
        else:
            try:
                start = pd.Timestamp(dt.date.fromisoformat(str(raw_start).strip()))
            except ValueError:
                raise ForecastRequestError("start_date must be a valid date in YYYY-MM-DD format") from None

        enrollment = args.get("enrollment")
        if enrollment is not None:
            try:
                enrollment = int(str(enrollment).strip())
            except ValueError:
                raise ForecastRequestError("enrollment must be a positive integer") from None
            if not 0 < enrollment <= MAX_ENROLLMENT:
                raise ForecastRequestError(f"enrollment must be between 1 and {MAX_ENROLLMENT}")
        return start, horizon, enrollment

    def forecast(self, start, horizon_days, enrollment=None):
        if not self.load():
            raise ModelNotAvailableError(self.load_error)
        meta = self.metadata
        train_end = pd.Timestamp(meta["training_data"]["last_date"])
        limit = meta.get("horizon", self.config["horizon"])["max_days_after_training_end"]
        if start <= train_end:
            raise ForecastRequestError(f"start_date must be after the training data end ({train_end.date()})")
        if start > train_end + pd.Timedelta(days=limit):
            raise ForecastRequestError(
                f"start_date is more than {limit} days after the training data end ({train_end.date()}); "
                "retrain the model with more recent data")

        end = start + pd.Timedelta(days=horizon_days - 1)
        days, calendar_days = future_school_days(start, end)
        regs = meta["regressors"]
        assumptions = ["Only school days from the configured school calendar are forecast; "
                       "weekends, holidays and half-terms are excluded."]
        if "students_enrolled" in regs:
            if enrollment is None:
                enrollment = meta["training_data"]["last_known_enrollment"]
                assumptions.append(f"No enrollment supplied; using the last enrollment in the training data "
                                   f"({enrollment}) for every forecast day.")
            else:
                assumptions.append(f"Enrollment {enrollment} (supplied) is held constant over the horizon.")
        elif enrollment is not None:
            assumptions.append("The enrollment parameter was ignored: this model does not use enrollment.")

        forecast = []
        if not days.empty:
            future = pd.DataFrame({"ds": days["date"].values})
            for r in regs:
                future[r] = float(enrollment) if r == "students_enrolled" else days[r].astype(float).values
            fc = predict_prophet(self.model, future, seed=meta.get("random_seed", 0))
            for d, row in zip(days.itertuples(), fc.itertuples()):
                forecast.append({
                    "date": d.date.strftime("%Y-%m-%d"),
                    "day_of_week": d.day_of_week,
                    "predicted_demand": int(round(row.yhat)),
                    "lower_bound": int(round(row.yhat_lower)),
                    "upper_bound": int(round(row.yhat_upper)),
                })

        return {
            "model": meta["model_type"],
            "model_name": meta["model_name"],
            "target": meta["target"],
            "trained_at": meta["trained_at_utc"],
            "training_data_end": meta["training_data"]["last_date"],
            "start_date": start.strftime("%Y-%m-%d"),
            "end_date": end.strftime("%Y-%m-%d"),
            "horizon_days": horizon_days,
            "interval_width": meta["interval_width"],
            "school_days_forecast": len(forecast),
            "non_school_days_excluded": calendar_days - len(forecast),
            "forecast": forecast,
            "assumptions": assumptions,
            "data_notice": DATA_NOTICE,
        }
