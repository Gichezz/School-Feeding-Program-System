"""
Flask entry point for the meal-demand forecasting service.

Phase 1: architecture placeholder only.
Forecasting with Facebook Prophet will be implemented in a later phase.
"""

from flask import Flask, jsonify

app = Flask(__name__)


@app.get("/health")
def health():
    return jsonify(
        {
            "status": "ok",
            "service": "school-feeding-forecasting",
            "forecasting": "not_implemented_yet",
        }
    )


@app.get("/api/forecast")
def forecast_placeholder():
    return (
        jsonify(
            {
                "error": "Forecasting is not implemented in this phase",
                "message": "Prophet-based meal demand forecasting comes later",
            }
        ),
        501,
    )


if __name__ == "__main__":
    # Default Flask port; override with FLASK_RUN_PORT if needed
    app.run(host="0.0.0.0", port=5000, debug=True)
