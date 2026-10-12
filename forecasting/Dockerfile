# Lishe forecasting service (Flask + Prophet), served by gunicorn.
# The model is trained offline; the image only loads models/artifacts at startup.
FROM python:3.12-slim

WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt ./
RUN pip install -r requirements.txt

# Only what the running service needs (no datasets, notebooks or tests)
COPY app.py ./
COPY config ./config
COPY models ./models
COPY services ./services

RUN useradd --create-home --uid 10001 forecasting
USER forecasting

EXPOSE 5001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5001/health', timeout=4)" || exit 1

# One worker keeps memory low (the Prophet model is loaded per worker); threads handle concurrency
CMD ["gunicorn", "--bind", "0.0.0.0:5001", "--workers", "1", "--threads", "4", "--timeout", "60", "app:app"]
