"""
Flask entry point for the review scoring service.

POST /score ranks one sub-county's school-weeks for review (services/scoring_service.py).
The backend sends the records with each request; this service keeps no data and never
connects to PostgreSQL. Errors use the backend's {"error": "..."} JSON shape.
"""

import os

from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

from services.scoring_service import ScoringError, score_week


def create_app():
    app = Flask(__name__)
    # A sub-county's two terms of records fit comfortably; larger bodies are refused
    app.config["MAX_CONTENT_LENGTH"] = 32 * 1024 * 1024

    @app.get("/health")
    def health():
        return jsonify({"status": "ok", "service": "school-feeding-scoring", "method": "one_class_svm"})

    @app.post("/score")
    def score():
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            raise ScoringError("Send the records as a JSON object")
        return jsonify(score_week(body))

    @app.errorhandler(ScoringError)
    def handle_scoring_error(err):
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
    # Port from FLASK_RUN_PORT (see .env.example); default 5001.
    app.run(host="0.0.0.0", port=int(os.environ.get("FLASK_RUN_PORT", 5001)), debug=True)
