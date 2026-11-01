# Lishe review scoring service (Flask, scikit-learn, isotree), served by gunicorn.
# Stateless: the backend sends a sub-county's records with each request.

# isotree (Extended Isolation Forest) has no ready-built Linux wheel for its pinned version,
# so it is compiled here; the compiler stays in this stage and only the wheel is kept
FROM python:3.12-slim AS isotree-build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir $(grep -E '^(numpy|scipy|pandas|scikit-learn)==' requirements.txt) \
    && pip wheel --no-cache-dir --no-deps --wheel-dir /wheels "$(grep '^isotree==' requirements.txt)"

FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# isotree's OpenMP runtime
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY --from=isotree-build /wheels /wheels
COPY requirements.txt ./
RUN pip install --find-links /wheels -r requirements.txt && rm -rf /wheels

# Only what the running service needs (no datasets, notebooks or tests)
COPY app.py ./
COPY anomaly ./anomaly
COPY services/__init__.py services/scoring_service.py ./services/

RUN useradd --create-home --uid 10001 scoring
USER scoring

EXPOSE 5001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5001/health', timeout=4)" || exit 1

# Scoring a sub-county takes about a second; threads handle concurrency
CMD ["gunicorn", "--bind", "0.0.0.0:5001", "--workers", "2", "--threads", "4", "--timeout", "60", "app:app"]
