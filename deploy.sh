#!/usr/bin/env bash
#
# Deploy to the OVH VPS.
#
#   ./deploy.sh            push, then restart
#   ./deploy.sh --dry-run  show exactly what WOULD change, touch nothing
#
# Always dry-run first after a session's worth of edits. rsync --delete removes
# anything on the server that is not here, and the dry run is the only chance
# to notice that a path you meant to keep is missing locally.

set -euo pipefail

# ---------------------------------------------------------------------------
# The one line to check before the first run.
# ---------------------------------------------------------------------------
REMOTE_USER="ubuntu"
REMOTE_HOST="15.204.123.104"
REMOTE_PATH="/home/ubuntu/app"
PM2_APP="webgen"

# ---------------------------------------------------------------------------

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

DRY=""
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY="--dry-run"
  echo "DRY RUN — nothing will be written."
  echo
fi

# Tests before the push, not after.
#
# A deploy that ships a broken build and then tells you is worse than one that
# refuses. `set -e` means a failing suite stops the script here.
echo "Running tests..."
node test-business-shape.js > /dev/null
node test-blog-plan.js      > /dev/null
node test-blog-states.js    > /dev/null
# Skips cleanly when php is not installed; see the top of the file.
node test-wp-canonical.js   > /dev/null
echo "Tests passed."
echo

echo "Syncing to ${REMOTE_HOST}:${REMOTE_PATH}"
rsync -avz --delete $DRY \
  --exclude-from="${HERE}/.rsync-exclude" \
  ./ "${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_PATH}/"

if [[ -n "$DRY" ]]; then
  echo
  echo "Dry run finished. Re-run without --dry-run to apply."
  exit 0
fi

echo
echo "Installing dependencies and restarting..."

# NOT --omit=dev. That looks obviously right for a production server and is
# wrong for this one.
#
# utils/runProductionBuild.js runs WEBPACK at request time to build each
# customer's site — so webpack, webpack-cli, babel-loader, css-loader,
# postcss, purgecss and the rest are runtime dependencies here despite living
# in devDependencies. Pruning them put the app into a restart loop.
#
# They are misfiled rather than misused: the honest fix is to move the ones
# runProductionBuild needs into "dependencies". Until that is done, install
# everything.
ssh "${REMOTE_USER}@${REMOTE_HOST}" \
  "cd ${REMOTE_PATH} && npm install --legacy-peer-deps && pm2 restart ${PM2_APP} && pm2 save"

echo
echo "Deployed. Check the log with:"
echo "  ssh ${REMOTE_USER}@${REMOTE_HOST} 'pm2 logs --lines 40'"
