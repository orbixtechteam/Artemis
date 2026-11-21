#!/usr/bin/env bash
# Backs up the Artemis server's data volume to ./artemis-backup-<time>.tar.gz (consistent: the database is copied
# with SQLite's own backup, so the server can keep running).
#   deploy/server/backup.sh            restore: deploy/server/restore.sh <file>
set -euo pipefail
C=${ARTEMIS_CONTAINER:-artemis}
T=$(date +%Y%m%d-%H%M%S)
docker exec "$C" node -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/data/artemis.db');
db.exec(\"VACUUM INTO '/data/artemis.backup.db'\");
db.close();"
docker exec "$C" tar -C /data -czf - --exclude=./artemis.db --exclude=./artemis.db-wal --exclude=./artemis.db-shm --exclude=./migrate --exclude=./headless-browser --exclude=./spill . > "artemis-backup-$T.tar.gz"
docker exec "$C" rm -f /data/artemis.backup.db
echo "Saved artemis-backup-$T.tar.gz"
echo "Keep ARTEMIS_MASTER_KEY with it: the stored keys can only be read with it."
