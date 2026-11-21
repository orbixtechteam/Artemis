#!/usr/bin/env bash
# Restores a backup made by backup.sh into the server's data volume. The server is stopped while it runs.
#   deploy/server/restore.sh artemis-backup-<time>.tar.gz
set -euo pipefail
F=${1:?usage: restore.sh <artemis-backup-*.tar.gz>}
DIR=$(cd "$(dirname "$0")" && pwd)
COMPOSE="docker compose -f $DIR/docker-compose.yml"
$COMPOSE stop artemis
$COMPOSE run --rm --no-deps -T --entrypoint sh artemis -c '
  set -e
  mkdir -p /data/restore-previous
  for f in /data/*; do case "$f" in /data/restore-previous) ;; *) mv "$f" /data/restore-previous/ ;; esac; done
  tar -C /data -xzf -
  if [ -f /data/artemis.backup.db ]; then mv /data/artemis.backup.db /data/artemis.db; fi
' < "$F"
$COMPOSE start artemis
echo "Restored. The data that was there before is in the volume under restore-previous/ (delete it when all is well)."
