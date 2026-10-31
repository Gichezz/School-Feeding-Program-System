# Lishe review scoring service (Flask + scikit-learn), served by gunicorn.
# Stateless: the backend sends a sub-county's records with each request.
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt ./
RUN pip install -r requirements.txt

# Only what the running service needs (no datasets, notebooks or tests)
COPY app.py ./
COPY anomaly ./anomaly
COPY services/__init__.py services/scoring_service.py ./services/

RUN useradd --create-home --uid 10001 scoring
USER scoring

EXPOSE 5001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5001/health', timeout=4)" || exit 1

# Scoring a sub-county takes well under a second; threads handle concurrency
CMD ["gunicorn", "--bind", "0.0.0.0:5001", "--workers", "2", "--threads", "4", "--timeout", "60", "app:app"]
