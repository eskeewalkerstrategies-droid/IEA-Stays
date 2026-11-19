#!/usr/bin/env bash
# Weekly copy of Docker volumes (uploads, config) to off-site storage.
set -euo pipefail

VOLUMES="${VOLUMES:-$(docker volume ls -q | grep -E 'twenty|listmonk|umami' || true)}"
RCLONE_REMOTE="${RCLONE_REMOTE:-b2:ew-ops-backups}"
KEEP_DAYS="${KEEP_DAYS:-30}"
WORK="${WORK:-/opt/ew-ops/backups}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "$WORK"
for VOL in $VOLUMES; do
  FILE="$WORK/${VOL}-${STAMP}.tar.gz"
  echo "[$(date -u +%FT%TZ)] archiving volume $VOL"
  docker run --rm -v "$VOL":/data:ro -v "$WORK":/out alpine \
    tar czf "/out/$(basename "$FILE")" -C /data .
  rclone copy "$FILE" "$RCLONE_REMOTE/volumes/$VOL/"
  rm -f "$FILE"
done

rclone delete --min-age "${KEEP_DAYS}d" "$RCLONE_REMOTE/volumes/"
echo "[$(date -u +%FT%TZ)] volume backup OK"
