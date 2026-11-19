#!/usr/bin/env bash
#
# Restores an encrypted backup into a database on the local docker compose
# MongoDB, for the restore drill or to inspect a backup (issue #89). Runs on a
# key holder's laptop, since only the key holders can decrypt a backup. It never
# writes to the trailmix database itself; restoring production is a manual step
# in the README.
#
# Usage: scripts/restore-mongo.sh <backup> [database]
#   backup     a gs:// object (needs a gcloud login that can read the bucket) or a local file
#   database   where to restore it, default trailmix_restore_drill. Its collections are replaced.
#
# List the backups with: gcloud storage ls -l gs://cpen321-m1-508304-trailmix-backups/mongo/

set -euo pipefail

MONGO_CONTAINER="${MONGO_CONTAINER:-cpen321-project-mongo-1}"

die() { printf '\033[31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $# -ge 1 ]] || die "Usage: scripts/restore-mongo.sh <backup> [database]"
backup="$1"
database="${2:-trailmix_restore_drill}"
[[ "$database" =~ ^[A-Za-z0-9_-]+$ ]] || die "Database names may only use letters, digits, _ and -."
[[ "$database" != trailmix ]] || die "Restore into another database, then follow the README to replace trailmix."

read_backup() {
  if [[ "$backup" == gs://* ]]; then
    gcloud storage cat "$backup"
  else
    cat "$backup"
  fi
}

read_backup | gpg --batch --quiet --decrypt |
  docker exec -i "$MONGO_CONTAINER" mongorestore --quiet --archive --gzip --drop \
    --nsFrom 'trailmix.*' --nsTo "$database.*"
printf 'Restored %s into %s\n' "$backup" "$database"
