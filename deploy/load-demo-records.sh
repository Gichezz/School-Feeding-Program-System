#!/bin/sh
# Load two years of synthetic feeding records into a demo database, so the officer screens
# (weekly review, analytics) have history to show. Run it from the project folder while the
# stack is up. Only for a database started with LOAD_DEMO_DATA=true; it refuses any other.
#
#   sh deploy/load-demo-records.sh
#
# Nothing extra needs installing: the synthetic dataset is generated with the scoring
# service's image (it has pandas and numpy) and loaded with the API's image.
set -eu

DATASET=forecasting/data/processed/feeding_dataset

if [ ! -f "$DATASET/schools.csv" ]; then
  echo "Generating the synthetic dataset into $DATASET"
  docker compose run --rm --no-deps --user "$(id -u):$(id -g)" \
    -v "$PWD:/repo" -w /repo \
    scoring python forecasting/scripts/generate_feeding_dataset.py
fi

echo "Loading the records"
docker compose run --rm --no-deps \
  -v "$PWD/$DATASET:/forecasting/data/processed/feeding_dataset:ro" \
  backend node scripts/load-demo-records.js "$@"
