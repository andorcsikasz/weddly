#!/usr/bin/env bash
# Restore a Weddly SQLite snapshot produced by `scripts/backup.sh`.
#
# Usage:
#   scripts/restore.sh <source> <target> [--force]
#
#     <source>  Either a local path (`/tmp/weddly-20260509T030000Z.db.age`)
#               OR an s3:// URL (`s3://weddly-backups/prod/weddly-...db.age`).
#     <target>  Where to write the restored DB. Refuses to overwrite an
#               existing file unless --force is also passed.
#     --force   Allow overwriting <target> if it exists.
#
# Required env (only when needed):
#   AGE_IDENTITY           Path to age private-key file. Required if the
#                          source is `.age`-encrypted.
#   AWS_*                  Standard AWS creds for s3:// sources. Same vars
#                          backup.sh uses (works for Cloudflare R2 with
#                          AWS_ENDPOINT_URL).
#
# What this script does (in order):
#   1. Resolve <source> to a local file (download from S3/R2 if needed).
#   2. age-decrypt with $AGE_IDENTITY if the file ends in .age.
#   3. PRAGMA integrity_check on the result. Abort if anything other than `ok`.
#   4. Move into place at <target>. Refuses to clobber unless --force.
#
# Anti-footgun: if <target> looks like a live production path (e.g. /data/...),
# you must pass --force AND the script logs a loud warning. There is no
# silent overwrite path.

set -euo pipefail

usage() {
  sed -n '1,40p' "$0" | sed 's/^# \?//'
  exit "${1:-1}"
}

SOURCE=""
TARGET=""
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -h|--help) usage 0 ;;
    *)
      if [ -z "$SOURCE" ]; then SOURCE="$arg"
      elif [ -z "$TARGET" ]; then TARGET="$arg"
      else echo "[restore] unexpected arg: $arg" >&2; usage
      fi
      ;;
  esac
done
[ -z "$SOURCE" ] && usage
[ -z "$TARGET" ] && usage

WORKDIR="$(mktemp -d -t weddly-restore-XXXXXXXX)"
cleanup() { rm -rf "$WORKDIR" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

# Step 1 — resolve <source> to a local file.
if [[ "$SOURCE" =~ ^s3:// ]]; then
  command -v aws >/dev/null 2>&1 || {
    echo "[restore] FATAL: aws CLI required to fetch s3:// sources" >&2; exit 1; }
  LOCAL="$WORKDIR/$(basename "$SOURCE")"
  echo "[restore] fetching $SOURCE"
  aws s3 cp "$SOURCE" "$LOCAL"
else
  [ -f "$SOURCE" ] || { echo "[restore] FATAL: $SOURCE not found" >&2; exit 1; }
  LOCAL="$WORKDIR/$(basename "$SOURCE")"
  cp "$SOURCE" "$LOCAL"
fi

# Step 2 — decrypt if needed.
if [[ "$LOCAL" == *.age ]]; then
  command -v age >/dev/null 2>&1 || {
    echo "[restore] FATAL: \`age\` not installed" >&2; exit 1; }
  [ -n "${AGE_IDENTITY:-}" ] || {
    echo "[restore] FATAL: source is encrypted; AGE_IDENTITY must point to the private key file" >&2
    exit 1; }
  [ -f "$AGE_IDENTITY" ] || {
    echo "[restore] FATAL: AGE_IDENTITY=$AGE_IDENTITY not readable" >&2; exit 1; }
  PLAIN="${LOCAL%.age}"
  echo "[restore] decrypting with age"
  age -d -i "$AGE_IDENTITY" -o "$PLAIN" "$LOCAL"
  LOCAL="$PLAIN"
fi

# Step 3 — integrity check.
echo "[restore] PRAGMA integrity_check"
INTEGRITY="$(sqlite3 "$LOCAL" 'PRAGMA integrity_check;')"
if [ "$INTEGRITY" != "ok" ]; then
  echo "[restore] FATAL: integrity_check failed: $INTEGRITY" >&2
  exit 1
fi

# Step 4 — move into place.
if [ -e "$TARGET" ]; then
  if [ "$FORCE" -ne 1 ]; then
    echo "[restore] FATAL: $TARGET exists; pass --force to overwrite" >&2
    exit 1
  fi
  echo "[restore] WARNING: overwriting existing $TARGET (--force)"
fi

mkdir -p "$(dirname "$TARGET")"
cp "$LOCAL" "$TARGET"
echo "[restore] done: $TARGET"
echo "[restore] reminder: if the app is running, restart it so it reopens the new DB"
