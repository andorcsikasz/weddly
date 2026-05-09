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
#   AGE_RECIPIENT          age public key for encryption-at-rest. If set, `age`
#                          must be installed — a missing binary is FATAL, not
#                          a silent skip (we'd rather fail loud than ship
#                          plaintext backups by accident).
#   S3_BUCKET, S3_PREFIX   destination prefix, e.g. s3://weddly-backups/prod/.
#                          If S3_BUCKET is set, `aws` must be installed.
#   AWS_*                  standard AWS creds — works for Cloudflare R2 too
#                          when AWS_ENDPOINT_URL is set to the R2 endpoint.
#   RETENTION_DAYS         delete local snapshots older than N days (default 14).
#                          Remote retention is handled by S3/R2 lifecycle rules.
#   HEALTHCHECK_URL        optional Healthchecks.io ping URL. If set, the script
#                          pings .../start at the top, the URL on success, and
#                          .../fail on any error so a missed run pages someone.

set -euo pipefail

DB_PATH="${DB_PATH:?DB_PATH is required}"
BACKUP_DIR="${BACKUP_DIR:-/tmp/weddly-backup}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

ping() {
  local suffix="$1"
  [ -z "${HEALTHCHECK_URL:-}" ] && return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${HEALTHCHECK_URL%/}${suffix}" || true
}

ping "/start"
trap 'ping "/fail"' ERR

if [ -n "${AGE_RECIPIENT:-}" ] && ! command -v age >/dev/null 2>&1; then
  echo "[backup] FATAL: AGE_RECIPIENT is set but \`age\` is not installed" >&2
  exit 1
fi
if [ -n "${S3_BUCKET:-}" ] && ! command -v aws >/dev/null 2>&1; then
  echo "[backup] FATAL: S3_BUCKET is set but \`aws\` is not installed" >&2
  exit 1
fi

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

if [ -n "${AGE_RECIPIENT:-}" ]; then
  echo "[backup] encrypting with age"
  age -r "$AGE_RECIPIENT" -o "$SNAPSHOT.age" "$SNAPSHOT"
  rm -f "$SNAPSHOT"
  OUT="$SNAPSHOT.age"
fi

if [ -n "${S3_BUCKET:-}" ]; then
  DEST="s3://$S3_BUCKET/${S3_PREFIX:-}$(basename "$OUT")"
  echo "[backup] uploading to $DEST"
  aws s3 cp "$OUT" "$DEST"
fi

echo "[backup] retention sweep (>$RETENTION_DAYS days)"
find "$BACKUP_DIR" -type f \( -name 'weddly-*.db' -o -name 'weddly-*.db.age' \) \
  -mtime +"$RETENTION_DAYS" -print -delete || true

echo "[backup] done: $OUT"
ping ""
