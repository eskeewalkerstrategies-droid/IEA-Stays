#!/usr/bin/env bash
# Nightly dump of every database on the Postgres service to off-site storage.
# Requires: pg_dump (postgresql-client), rclone configured with a remote named in RCLONE_REMOTE.
set -euo pipefail

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
DATABASES="${DATABASES:-ops twenty listmonk umami}"
RCLONE_REMOTE="${RCLONE_REMOTE:-b2:ew-ops-backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
WORK="${WORK:-/opt/ew-ops/backups}"
STATUS_FILE="${STATUS_FILE:-/opt/ew-ops/backups/last-success}"

mkdir -p "$WORK"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

for DB in $DATABASES; do
  FILE="$WORK/${DB}-${STAMP}.dump"
  echo "[$(date -u +%FT%TZ)] dumping $DB"
  pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -Fc -f "$FILE" "$DB"
  rclone copy "$FILE" "$RCLONE_REMOTE/postgres/$DB/"
  rm -f "$FILE"
done

echo "[$(date -u +%FT%TZ)] pruning copies older than $KEEP_DAYS days"
rclone delete --min-age "${KEEP_DAYS}d" "$RCLONE_REMOTE/postgres/"

date -u +%FT%TZ > "$STATUS_FILE"
echo "[$(date -u +%FT%TZ)] postgres backup OK"
