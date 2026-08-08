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
# throwaway git worktree, proves its SQLite migrations can upgrade both the
# parent revision and the currently running production revision, then runs
# `railway up`. The upload can only contain committed, migration-safe code. The
# worktree is removed on exit, including on failure.
#
# Usage:
#   scripts/deploy.sh                # deploy HEAD, return once the upload starts
#   scripts/deploy.sh v1.2.0         # deploy any ref (tag, branch, sha)
#   scripts/deploy.sh --wait         # stream the build and exit non-zero if it fails
#   scripts/deploy.sh --check-only   # run every production gate, do not upload
#   scripts/deploy.sh --wait main
#
# Project, service and environment come from the repo's existing Railway link
# (`railway status`), so this keeps working if the service is ever relinked.
# `.env` files stay out of the upload exactly as before: `railway up` honours
# .gitignore, and the VITE_* values are build ARGs supplied by Railway itself.

set -euo pipefail

WAIT=0
CHECK_ONLY=0
REF="HEAD"
for arg in "$@"; do
  case "$arg" in
    --wait) WAIT=1 ;;
    --check-only) CHECK_ONLY=1 ;;
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
TARGET_COMMIT=$(git rev-parse "$REF^{commit}")
PARENT_COMMIT=$(git rev-parse "$TARGET_COMMIT^") || {
  echo "deploy: cannot migration-check a root commit with no parent" >&2
  exit 1
}
SHA=$(git rev-parse --short "$TARGET_COMMIT")
SUBJECT=$(git log -1 --format=%s "$REF")

# Read the linkage from the repo checkout, where `railway link` was run.
LINK=$(railway status --json 2>/dev/null) || {
  echo "deploy: not linked to a Railway project (run 'railway link' in $REPO_ROOT)" >&2
  exit 1
}
read -r PROJECT_ID ENV_ID ENV_NAME SERVICE_ID <<EOF
$(printf '%s' "$LINK" | python3 -c '
import json, sys
d = json.load(sys.stdin)
env = d["environments"]["edges"][0]["node"]
svc = env.get("serviceInstances", {}).get("edges", [])
print(d["id"], env["id"], env["name"], svc[0]["node"]["serviceId"] if svc else "")
')
EOF
[ -n "${SERVICE_ID:-}" ] || {
  echo "deploy: could not resolve the service id from 'railway status --json'" >&2
  exit 1
}

# Do not allow production deployment while GitHub can bypass CI. This checks
# the live Railway trigger on every manual release, so configuration drift is
# visible and fails closed instead of silently weakening the repository gates.
TRIGGER_QUERY='query($projectId: String!, $environmentId: String!, $serviceId: String!) {
  deploymentTriggers(projectId: $projectId, environmentId: $environmentId, serviceId: $serviceId, first: 20) {
    edges { node { checkSuites validCheckSuites } }
  }
}'
TRIGGER_VARS=$(python3 -c '
import json, sys
print(json.dumps({"projectId": sys.argv[1], "environmentId": sys.argv[2], "serviceId": sys.argv[3]}))
' "$PROJECT_ID" "$ENV_ID" "$SERVICE_ID")
TRIGGERS=$(railway api "$TRIGGER_QUERY" --variables "$TRIGGER_VARS" 2>/dev/null) || {
  echo "deploy: cannot verify Railway Wait for CI; refusing deployment" >&2
  exit 1
}
WAIT_FOR_CI=$(printf '%s' "$TRIGGERS" | python3 -c '
import json, sys
edges = json.load(sys.stdin).get("data", {}).get("deploymentTriggers", {}).get("edges", [])
print("yes" if any(e["node"].get("checkSuites") and e["node"].get("validCheckSuites", 0) > 0 for e in edges) else "no")
')
[ "$WAIT_FOR_CI" = "yes" ] || {
  echo "deploy: Railway Wait for CI is disabled or has no valid check suite; refusing deployment" >&2
  exit 1
}

# Resolve the code revision backing the latest successful production deploy.
# Checking only TARGET^ is insufficient for a multi-commit release: an unsafe
# migration could sit in the first commit and be invisible from the last one's
# immediate parent. CLI uploads put the short SHA first in cliMessage; GitHub
# deploys expose the full commitHash.
DEPLOYMENTS=$(railway deployment list \
  --project "$PROJECT_ID" \
  --service "$SERVICE_ID" \
  --environment "$ENV_NAME" \
  --limit 50 \
  --json) || {
  echo "deploy: cannot read production deployment history; refusing an unchecked deploy" >&2
  exit 1
}
PRODUCTION_REF=$(printf '%s' "$DEPLOYMENTS" | python3 -c '
import json, re, sys
for deployment in json.load(sys.stdin):
    if deployment.get("status") != "SUCCESS":
        continue
    meta = deployment.get("meta") or {}
    candidate = meta.get("commitHash") or (meta.get("cliMessage") or "").split(" ", 1)[0]
    if re.fullmatch(r"[0-9a-fA-F]{7,40}", candidate or ""):
        print(candidate)
        break
')
[ -n "$PRODUCTION_REF" ] && git rev-parse --verify --quiet "$PRODUCTION_REF^{commit}" >/dev/null || {
  echo "deploy: cannot map the active production deployment to a git commit; refusing an unchecked deploy" >&2
  exit 1
}
PRODUCTION_COMMIT=$(git rev-parse "$PRODUCTION_REF^{commit}")

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

echo "deploy: checking SQLite upgrade from parent $(git rev-parse --short "$PARENT_COMMIT")"
bun scripts/check-db-migrations.ts --base "$PARENT_COMMIT"
if [ "$PRODUCTION_COMMIT" != "$PARENT_COMMIT" ]; then
  echo "deploy: checking SQLite upgrade from production $(git rev-parse --short "$PRODUCTION_COMMIT")"
  bun scripts/check-db-migrations.ts --base "$PRODUCTION_COMMIT"
fi

if [ "$CHECK_ONLY" = "1" ]; then
  echo "deploy: all production gates passed; --check-only requested, nothing uploaded"
  exit 0
fi

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
