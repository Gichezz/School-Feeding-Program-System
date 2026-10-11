"""Flask API: request validation, school-day filtering and error handling."""

import pandas as pd
import pytest

from app import create_app
from models.features import future_school_days


@pytest.fixture
def client(trained_model_dir):
    app = create_app(model_dir=trained_model_dir, today="2024-01-08")
    return app.test_client()


@pytest.fixture
def client_without_model(tmp_path):
    return create_app(model_dir=tmp_path / "empty", today="2024-01-08").test_client()


def test_health_reports_loaded_model(client):
    body = client.get("/health").get_json()
    assert body["status"] == "ok" and body["service"] == "school-feeding-forecasting"
    assert body["forecasting"] == "ready"
    assert body["model"]["model_loaded"] is True


def test_default_forecast(client):
    r = client.get("/api/forecast")
    assert r.status_code == 200
    body = r.get_json()
    assert body["model"] == "prophet"
    assert body["target"] == "estimated_meal_demand"
    assert body["start_date"] == "2024-01-08" and body["horizon_days"] == 14
    assert body["school_days_forecast"] == len(body["forecast"]) > 0
    assert body["school_days_forecast"] + body["non_school_days_excluded"] == 14
    assert "synthetic" in body["data_notice"].lower()


@pytest.mark.parametrize("horizon", [7, 14, 30])
def test_forecast_returns_only_school_days(client, horizon):
    body = client.get(f"/api/forecast?start_date=2024-03-25&horizon_days={horizon}").get_json()
    expected, _ = future_school_days("2024-03-25", pd.Timestamp("2024-03-25") + pd.Timedelta(days=horizon - 1))
    assert [f["date"] for f in body["forecast"]] == list(expected["date"].dt.strftime("%Y-%m-%d"))
    for f in body["forecast"]:
        assert pd.Timestamp(f["date"]).dayofweek < 5
        assert 0 <= f["lower_bound"] <= f["predicted_demand"] <= f["upper_bound"]
        assert isinstance(f["predicted_demand"], int)


def test_holiday_window_returns_empty_forecast(client):
    body = client.get("/api/forecast?start_date=2024-12-01&horizon_days=20").get_json()
    assert body["forecast"] == [] and body["non_school_days_excluded"] == 20


def test_enrollment_parameter_changes_forecast(client):
    a = client.get("/api/forecast?start_date=2024-02-05&horizon_days=7&enrollment=400").get_json()
    b = client.get("/api/forecast?start_date=2024-02-05&horizon_days=7&enrollment=700").get_json()
    assert a["forecast"][0]["predicted_demand"] < b["forecast"][0]["predicted_demand"]
    assert any("700" in s for s in b["assumptions"])


def test_missing_enrollment_uses_documented_default(client):
    body = client.get("/api/forecast?start_date=2024-02-05&horizon_days=7").get_json()
    assert any("last enrollment in the training data (540)" in s for s in body["assumptions"])


@pytest.mark.parametrize("query,message", [
    ("horizon_days=0", "between"),
    ("horizon_days=61", "between"),
    ("horizon_days=abc", "integer"),
    ("horizon_days=7.5", "integer"),
    ("start_date=08-01-2024", "YYYY-MM-DD"),
    ("start_date=2024-02-30", "YYYY-MM-DD"),
    ("start_date=2023-06-01", "after the training data end"),
    ("start_date=2027-01-01", "retrain"),
    ("enrollment=-5", "between"),
    ("enrollment=lots", "positive integer"),
    ("horizon=7", "Unknown parameter"),
])
def test_invalid_requests_return_400(client, query, message):
    r = client.get(f"/api/forecast?{query}")
    assert r.status_code == 400
    assert message in r.get_json()["error"]


def test_missing_model_returns_503(client_without_model):
    r = client_without_model.get("/api/forecast")
    assert r.status_code == 503
    assert "train_forecasting_model.py" in r.get_json()["error"]
    health = client_without_model.get("/health").get_json()
    assert health["status"] == "ok" and health["forecasting"] == "model_not_loaded"


def test_unknown_route_and_method_return_json(client):
    r = client.get("/api/nope")
    assert r.status_code == 404 and "error" in r.get_json()
    r = client.post("/api/forecast")
    assert r.status_code == 405 and "error" in r.get_json()
