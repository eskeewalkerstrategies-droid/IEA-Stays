#!/usr/bin/env bash
# Restores the newest dump of one database into a throwaway database and counts rows.
# Usage: restore-test.sh <database-name>   (default: ops)
set -euo pipefail

DB="${1:-ops}"
PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
RCLONE_REMOTE="${RCLONE_REMOTE:-b2:ew-ops-backups}"
WORK="${WORK:-/opt/ew-ops/backups}"
TEST_DB="restore_test_${DB}"

mkdir -p "$WORK"
LATEST="$(rclone lsf "$RCLONE_REMOTE/postgres/$DB/" | sort | tail -n 1)"
[ -n "$LATEST" ] || { echo "no backup found for $DB"; exit 1; }
echo "newest backup: $LATEST"
rclone copy "$RCLONE_REMOTE/postgres/$DB/$LATEST" "$WORK/"

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS $TEST_DB;"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -c "CREATE DATABASE $TEST_DB;"
pg_restore -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" --no-owner --no-privileges -d "$TEST_DB" "$WORK/$LATEST"

echo "row counts in $TEST_DB:"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$TEST_DB" -At -c "
  SELECT relname || ': ' || n_live_tup
  FROM pg_stat_user_tables
  ORDER BY n_live_tup DESC
  LIMIT 15;"

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -c "DROP DATABASE $TEST_DB;"
rm -f "$WORK/$LATEST"
echo "RESTORE OK"
