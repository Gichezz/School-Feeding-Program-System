#!/bin/sh
# Daily database backups for Docker Compose (the "backup" service in docker-compose.yml).
#
# One backup when the service starts, then one every 24 hours, into /backups (./backups
# on the host) as lishe-YYYY-MM-DD-HHMM.sql.gz. Backups older than BACKUP_KEEP_DAYS days
# are removed. Restore: see docs/deployment.md.
set -eu

KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p /backups

while true; do
  stamp="$(date +%Y-%m-%d-%H%M)"
  file="/backups/lishe-${stamp}.sql.gz"
  # Written under a temporary name, so a half-written backup is never mistaken for a good one
  if pg_dump --no-owner | gzip > "${file}.partial"; then
    mv "${file}.partial" "${file}"
    echo "Backup written: ${file}"
  else
    rm -f "${file}.partial"
    echo "Backup failed at ${stamp}; trying again in 24 hours" >&2
  fi
  find /backups -name 'lishe-*.sql.gz' -type f -mtime +"${KEEP_DAYS}" -exec rm -f {} \;
  sleep 86400
done
