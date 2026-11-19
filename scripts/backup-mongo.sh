#!/usr/bin/env bash
#
# Backs up the trailmix database, gpg-encrypted to the backup key holders, and
# streams it straight into the backup bucket, so nothing is written to the VM's
# disk (issue #89). Runs nightly from root's crontab on the VM:
#
#   0 11 * * * /home/<user>/cpen321-m1/scripts/backup-mongo.sh   # 11:00 UTC is 04:00 in B.C. (a fixed UTC-7)
#
# Settings come from /etc/trailmix/backup.env (root only, never in git):
#   MONGO_BACKUP_PASSWORD   the trailmix_backup MongoDB user's password (leave unset for a local database without login)
#   BACKUP_GPG_RECIPIENTS   space-separated fingerprints of the key holders' public keys, imported into root's keyring
#
# Usage: scripts/backup-mongo.sh [destination]
#   destination defaults to gs://cpen321-m1-508304-trailmix-backups/mongo/trailmix-<UTC time>.archive.gz.gpg.
#   A local path writes there instead, for the restore drill.
#
# Success and failure go to the system log under "trailmix-backup" (journalctl -t trailmix-backup).

set -euo pipefail

CONFIG="${BACKUP_CONFIG:-/etc/trailmix/backup.env}"
MONGO_CONTAINER="${MONGO_CONTAINER:-cpen321-project-mongo-1}"
BUCKET="cpen321-m1-508304-trailmix-backups"

log() { logger -t trailmix-backup "$@" 2>/dev/null || printf '%s\n' "$*" >&2; }

set -a # exported, so docker exec -e can pass the password on without it appearing on a command line
# shellcheck source=/dev/null
source "$CONFIG"
set +a
: "${BACKUP_GPG_RECIPIENTS:?is not set in $CONFIG}"

destination="${1:-gs://$BUCKET/mongo/trailmix-$(date -u +%Y-%m-%dT%H%MZ).archive.gz.gpg}"
recipients=()
for fingerprint in $BACKUP_GPG_RECIPIENTS; do recipients+=(--recipient "$fingerprint"); done

dump() {
  if [[ -z "${MONGO_BACKUP_PASSWORD:-}" ]]; then
    docker exec -i "$MONGO_CONTAINER" mongodump --quiet --archive --gzip --db trailmix
    return
  fi
  # the password reaches mongodump through a config file descriptor, never as an argument that ps could show
  # shellcheck disable=SC2016 # expanded inside the container
  docker exec -i -e MONGO_BACKUP_PASSWORD "$MONGO_CONTAINER" bash -c \
    'mongodump --quiet --archive --gzip --db trailmix --username trailmix_backup --authenticationDatabase admin \
       --config <(printf "password: \"%s\"\n" "$MONGO_BACKUP_PASSWORD")'
}

upload() {
  if [[ "$destination" == gs://* ]]; then
    gcloud storage cp --quiet - "$destination"
  else
    cat > "$destination"
  fi
}

# --trust-model always: the key holders' public keys were imported deliberately, by fingerprint
if dump | gpg --batch --quiet --trust-model always --encrypt "${recipients[@]}" | upload; then
  log "backup written to $destination"
else
  log -p user.err "backup FAILED, $destination may be incomplete"
  exit 1
fi
