#!/usr/bin/env bash
# Daily SQLite backup. Designed to be triggered by cron / Railway scheduled
# job. Uses `sqlite3 .backup` (an online, transaction-safe snapshot) — never
# `cp` a live WAL'd database. Encrypts with age (https://age-encryption.org)
# if AGE_RECIPIENT is set, then optionally uploads to S3-compatible storage.
#
# Required env (set in Railway / wherever you run this):
#   DB_PATH                e.g. /data/weddly.db
#   BACKUP_DIR             local working dir (transient), e.g. /tmp/weddly-backup
# Optional:
#   AGE_RECIPIENT          age public key for encryption-at-rest
#   S3_BUCKET, S3_PREFIX   destination prefix, e.g. s3://weddly-backups/prod/
#   AWS_*                  standard AWS creds — works for Cloudflare R2 too
#                          when AWS_ENDPOINT_URL is set to the R2 endpoint
#   RETENTION_DAYS         delete local snapshots older than N days (default 14)

set -euo pipefail

DB_PATH="${DB_PATH:?DB_PATH is required}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/weddly-backup}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SNAPSHOT="$BACKUP_DIR/weddly-$STAMP.db"

echo "[backup] snapshotting $DB_PATH → $SNAPSHOT"
sqlite3 "$DB_PATH" ".backup '$SNAPSHOT'"

# Integrity check on the snapshot — fails loud if the copy is corrupt.
INTEGRITY="$(sqlite3 "$SNAPSHOT" 'PRAGMA integrity_check;')"
if [ "$INTEGRITY" != "ok" ]; then
  echo "[backup] FATAL: integrity_check failed: $INTEGRITY" >&2
  rm -f "$SNAPSHOT"
  exit 1
fi

OUT="$SNAPSHOT"

if [ -n "${AGE_RECIPIENT:-}" ] && command -v age >/dev/null 2>&1; then
  echo "[backup] encrypting with age"
  age -r "$AGE_RECIPIENT" -o "$SNAPSHOT.age" "$SNAPSHOT"
  rm -f "$SNAPSHOT"
  OUT="$SNAPSHOT.age"
fi

if [ -n "${S3_BUCKET:-}" ] && command -v aws >/dev/null 2>&1; then
  DEST="s3://$S3_BUCKET/${S3_PREFIX:-}$(basename "$OUT")"
  echo "[backup] uploading to $DEST"
  aws s3 cp "$OUT" "$DEST"
fi

echo "[backup] retention sweep (>$RETENTION_DAYS days)"
find "$BACKUP_DIR" -type f \( -name 'weddly-*.db' -o -name 'weddly-*.db.age' \) \
  -mtime +"$RETENTION_DAYS" -print -delete || true

echo "[backup] done: $OUT"
