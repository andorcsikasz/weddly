#!/usr/bin/env bash
#
# Deploy the COMMITTED code, never the working tree.
#
# `railway up` uploads whatever sits in the current directory, so running it
# straight from the repo ships every half-finished edit that happens to be on
# disk at that second. With several agents editing in parallel that is a race:
# on 2026-07-20 four production builds failed on TypeScript errors from files
# another session was still writing, each failure attributed to whoever
# happened to commit at that moment.
#
# This script cuts the race out. It exports HEAD (or any ref you pass) into a
# throwaway git worktree and runs `railway up` from there, so the upload can
# only ever contain committed code. The worktree is removed on exit, including
# on failure.
#
# Usage:
#   scripts/deploy.sh                # deploy HEAD, return once the upload starts
#   scripts/deploy.sh v1.2.0         # deploy any ref (tag, branch, sha)
#   scripts/deploy.sh --wait         # stream the build and exit non-zero if it fails
#   scripts/deploy.sh --wait main
#
# Project, service and environment come from the repo's existing Railway link
# (`railway status`), so this keeps working if the service is ever relinked.
# `.env` files stay out of the upload exactly as before: `railway up` honours
# .gitignore, and the VITE_* values are build ARGs supplied by Railway itself.

set -euo pipefail

WAIT=0
REF="HEAD"
for arg in "$@"; do
  case "$arg" in
    --wait) WAIT=1 ;;
    -h | --help)
      sed -n '3,26p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) REF="$arg" ;;
  esac
done

command -v railway >/dev/null || {
  echo "deploy: railway CLI not found (brew install railway)" >&2
  exit 1
}

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

git rev-parse --verify --quiet "$REF^{commit}" >/dev/null || {
  echo "deploy: '$REF' is not a commit" >&2
  exit 1
}
SHA=$(git rev-parse --short "$REF")
SUBJECT=$(git log -1 --format=%s "$REF")

# Read the linkage from the repo checkout, where `railway link` was run.
LINK=$(railway status --json 2>/dev/null) || {
  echo "deploy: not linked to a Railway project (run 'railway link' in $REPO_ROOT)" >&2
  exit 1
}
read -r PROJECT_ID ENV_NAME SERVICE_ID <<EOF
$(printf '%s' "$LINK" | python3 -c '
import json, sys
d = json.load(sys.stdin)
env = d["environments"]["edges"][0]["node"]
svc = env.get("serviceInstances", {}).get("edges", [])
print(d["id"], env["name"], svc[0]["node"]["serviceId"] if svc else "")
')
EOF
[ -n "${SERVICE_ID:-}" ] || {
  echo "deploy: could not resolve the service id from 'railway status --json'" >&2
  exit 1
}

# Informational only: uncommitted work is deliberately left behind, but the
# operator should see what is not going out.
DIRTY=$(git status --porcelain | wc -l | tr -d ' ')
if [ "$DIRTY" != "0" ]; then
  echo "deploy: $DIRTY uncommitted file(s) in the working tree are NOT being deployed"
fi

WORKTREE=$(mktemp -d "${TMPDIR:-/tmp}/weddly-deploy.XXXXXX")
cleanup() {
  git worktree remove --force "$WORKTREE" >/dev/null 2>&1 || rm -rf "$WORKTREE"
  git worktree prune >/dev/null 2>&1 || true
}
trap cleanup EXIT

# mktemp -d already created the directory; git insists on creating it itself.
rmdir "$WORKTREE"
git worktree add --detach --quiet "$WORKTREE" "$REF"

echo "deploy: $SHA \"$SUBJECT\" -> $ENV_NAME (clean worktree, no local edits)"
cd "$WORKTREE"

if [ "$WAIT" = "1" ]; then
  # --ci streams the build log and fails the command if the build fails.
  railway up --ci \
    --project "$PROJECT_ID" \
    --service "$SERVICE_ID" \
    --environment "$ENV_NAME" \
    --message "$SHA $SUBJECT"
else
  railway up --detach \
    --project "$PROJECT_ID" \
    --service "$SERVICE_ID" \
    --environment "$ENV_NAME" \
    --message "$SHA $SUBJECT"
fi
