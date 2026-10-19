#!/usr/bin/env bash
# Publishes docs/wiki/*.md to the GitHub wiki (the separate repo "<repo>.wiki.git").
# Usage: scripts/publish-wiki.sh            (commit + push)
#        scripts/publish-wiki.sh --dry-run  (show what would change, push nothing)
# The wiki must exist once on GitHub (Wiki tab → create the first page), otherwise the clone fails.
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="docs/wiki"
WIKI_URL="$(git remote get-url origin | sed -E 's#\.git$##').wiki.git"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git clone --quiet "$WIKI_URL" "$TMP/wiki"
# mirror the pages (the wiki's own .git stays), removing pages that no longer exist here
rsync -a --delete --exclude '.git' --include '*.md' --exclude '*' "$SRC"/ "$TMP/wiki"/
cd "$TMP/wiki"
git add -A
if git diff --cached --quiet; then echo "Wiki is already up to date."; exit 0; fi
git --no-pager diff --cached --stat
[ "${1:-}" = "--dry-run" ] && { echo "(dry run: nothing pushed)"; exit 0; }
git commit --quiet -m "Update wiki from docs/wiki ($(date +%F))"
git push --quiet origin HEAD
echo "Wiki updated: ${WIKI_URL%.wiki.git}/wiki"
