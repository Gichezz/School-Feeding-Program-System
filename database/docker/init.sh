#!/bin/sh
# First start of the Docker database only (an empty data volume): create the tables,
# and load the demo school and demo accounts when LOAD_DEMO_DATA=true.
# The demo accounts have published passwords: keep LOAD_DEMO_DATA=false on any
# server other people can reach, and create the first administrator with
# backend/scripts/create-admin.js instead (see docs/deployment.md).
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /database/schema.sql

if [ "$LOAD_DEMO_DATA" = "true" ]; then
  echo "Loading demo data (local use only)"
  psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /database/seed.sql
fi
