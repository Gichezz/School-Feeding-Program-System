"""
Flask entry point for the meal-demand forecasting service.

The Prophet model is trained offline (scripts/train_forecasting_model.py) and
loaded once at startup; requests never retrain it. This service does not
connect to PostgreSQL. Errors use the backend's {"error": "..."} JSON shape.
"""

import os

from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

from services.forecast_service import ForecastError, ForecastService


def create_app(model_dir=None, config=None, today=None):
    app = Flask(__name__)
    service = ForecastService(model_dir=model_dir, config=config, today=today)
    service.load()  # load once at startup; a missing artifact is reported, not fatal
    app.extensions["forecast_service"] = service

    @app.get("/health")
    def health():
        status = service.status()
        return jsonify(
            {
                "status": "ok",
                "service": "school-feeding-forecasting",
                "forecasting": "ready" if status["model_loaded"] else "model_not_loaded",
                "model": status,
            }
        )

    @app.get("/api/forecast")
    def forecast():
        """
        Query parameters (all optional):
          horizon_days  calendar days to cover (default 14, 1..60)
          start_date    first date, YYYY-MM-DD (default: today)
          enrollment    current enrollment from school records
        """
        start, horizon, enrollment = service.parse_request(request.args)
        return jsonify(service.forecast(start, horizon, enrollment))

    @app.errorhandler(ForecastError)
    def handle_forecast_error(err):
        return jsonify({"error": str(err)}), err.status_code

    @app.errorhandler(404)
    def not_found(_):
        return jsonify({"error": "Not found"}), 404

    @app.errorhandler(405)
    def method_not_allowed(_):
        return jsonify({"error": "Method not allowed"}), 405

    @app.errorhandler(Exception)
    def unexpected(err):
        if isinstance(err, HTTPException):
            return jsonify({"error": err.description}), err.code
        app.logger.exception("Unhandled error: %s", err)
        return jsonify({"error": "Internal server error"}), 500

    return app


app = create_app()


if __name__ == "__main__":
    # Port from FLASK_RUN_PORT (see .env.example); default 5000.
    app.run(host="0.0.0.0", port=int(os.environ.get("FLASK_RUN_PORT", 5000)), debug=True)
