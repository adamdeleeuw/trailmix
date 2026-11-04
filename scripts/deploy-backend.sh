#!/usr/bin/env bash
#
# Runs ON the GCP VM (the GitHub Actions deploy job calls it over SSH; you can
# also run it by hand after ssh-ing in). Syncs the clone to origin/main, rebuilds
# and restarts the production stack, cleans up old images, and waits for the
# public health check.
#
# Assumes backend/.env exists on the VM (it is gitignored, so git never touches it).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BRANCH="${BRANCH:-main}"
SITE_ADDRESS="${SITE_ADDRESS:-136-67-54-50.sslip.io}"
HEALTH_URL="https://${SITE_ADDRESS}/health"
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)

info()  { printf '\033[34m==>\033[0m %s\n' "$*"; }
die()   { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[[ -f backend/.env ]] || die "Missing backend/.env on this machine."

if [[ -z "${DEPLOY_SYNCED:-}" ]]; then
  info "Syncing to origin/$BRANCH..."
  git fetch --quiet origin "$BRANCH"
  git reset --quiet --hard "origin/$BRANCH"
  info "At $(git log -1 --format='%h %s')"
  # the pull may have changed this script; re-run the new version
  DEPLOY_SYNCED=1 exec bash "$0" "$@"
fi

info "Building and starting containers..."
"${COMPOSE[@]}" up -d --build --remove-orphans

info "Removing unused images and old build cache..."
docker image prune -f >/dev/null
# the cache grows on every build and is never cleared otherwise, so drop anything unused for 3 days but keep recent layers for fast rebuilds
docker builder prune -af --filter until=72h >/dev/null

info "Waiting for $HEALTH_URL ..."
for _ in $(seq 1 30); do
  if curl -sf "$HEALTH_URL" >/dev/null 2>&1; then
    info "Deployed and healthy."
    exit 0
  fi
  sleep 2
done

"${COMPOSE[@]}" ps
"${COMPOSE[@]}" logs --tail 30 backend caddy
die "Health check failed: $HEALTH_URL"
