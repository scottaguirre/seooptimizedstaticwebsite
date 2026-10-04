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

# A MISSING PACKAGE LOOKS EXACTLY LIKE A FAILING TEST, and that cost a day.
#
# The location suggester arrived with a new dependency (all-the-cities, the
# gazetteer). It was added to package.json but never installed here, so
# `node test-nearby-places.js` threw "Cannot find module", `set -e` stopped
# the script before the rsync, and the deploy did nothing at all. The server
# went on serving the previous build; the feature was simply absent from the
# page, with no error anywhere to explain why.
#
# The failure was on screen the whole time — buried in a stack trace among
# twenty test runs. So: check what package.json declares is actually on disk,
# first, and say plainly what to do about it.
echo "Checking dependencies..."
MISSING="$(node -e '
  const fs = require("fs");
  const path = require("path");
  const deps = Object.keys(require("./package.json").dependencies || {});
  const gone = deps.filter(name =>
    !fs.existsSync(path.join("node_modules", name, "package.json")));
  process.stdout.write(gone.join(" "));
')"

if [[ -n "$MISSING" ]]; then
  echo
  echo "Not installed here: ${MISSING}"
  echo "Run this first, then deploy again:"
  echo
  echo "  npm install --legacy-peer-deps"
  echo
  exit 1
fi

# Tests before the push, not after.
#
# A deploy that ships a broken build and then tells you is worse than one that
# refuses. The loop names the suite that failed instead of leaving you to find
# it in the scrollback.
echo "Running tests..."
for suite in \
  test-generators-parse.js \
  test-business-shape.js \
  test-business-type-picker.js \
  test-page-meta.js \
  test-page-titles.js \
  test-reviews-section.js \
  test-wp-video-slot.js \
  test-location-pages.js \
  test-phone.js \
  test-app-header.js \
  test-auth-pages.js \
  test-cost-report.js \
  test-suggest-services.js \
  test-wizard-steps.js \
  test-nearby-places.js \
  test-keyword-volumes.js \
  test-keyword-research.js \
  test-keyword-seeds.js \
  test-keyword-intent.js \
  test-keyword-pairs.js \
  test-keyword-budget.js \
  test-blog-plan.js \
  test-pillar-campaign.js \
  test-blog-report.js \
  test-removal-time.js \
  test-business-refresh.js \
  test-post-quality.js \
  test-campaign-reconcile.js \
  test-blog-sites-delete.js \
  test-licence-binding.js \
  test-anchor-pool.js \
  test-home-anchors.js \
  test-blog-states.js \
  test-email-from.js \
  test-email-html.js \
  test-wp-screenshot.js \
  test-wp-canonical.js \
  test-wp-single.js \
  test-ie-pause.js \
  test-ie-video.js \
  test-ie-topics.js
do
  # The wp-* suites skip cleanly when php is not installed; see the top of
  # each file.
  if ! node "$suite" > /dev/null; then
    echo
    echo "FAILED: ${suite}"
    echo "Nothing was deployed. The server is still running the previous build."
    exit 1
  fi
done

# The PHP suites, which this loop cannot reach.
#
# test-deleted-posts.php sat outside the list for its whole life, because the
# loop above runs `node "$suite"` and it is a PHP file. So it ran on the days
# somebody remembered to run it. test-admin-tabs.php shows where that ends: it
# has been failing 23 of its 29 assertions since a stub fell behind the code,
# and nothing said so, because nothing ran it.
#
# A missing `php` is NOT a failure — plenty of machines that deploy this app do
# not have it — but it is said out loud, so a check that did not happen is
# never mistaken for one that passed.
if command -v php > /dev/null 2>&1; then
  for suite in \
    wp-plugin/test-deleted-posts.php \
    wp-plugin/test-topic-merge.php \
    wp-plugin/test-admin-tabs.php \
    wp-plugin/test-orphan-links.php \
    wp-plugin/test-pillar-plugin.php \
    wp-plugin/test-server-url.php
  do
    if ! php "$suite" > /dev/null; then
      echo
      echo "FAILED: ${suite}"
      echo "Nothing was deployed. The server is still running the previous build."
      echo "Run it directly to see which assertion failed:"
      echo
      echo "  php ${suite}"
      echo
      exit 1
    fi
  done
else
  echo "php is not installed here — the plugin's PHP suites were SKIPPED, not passed."
fi

echo "Tests passed."
echo

# CAN THE APP ACTUALLY BE LOADED?
#
# Every suite above passed on 30 September and the deploy shipped a build that
# could not start: a top-level `await` in utils/generateSampleReviews.js made
# Node treat it as an ES module, so `require()` of it threw, and the server
# died before it finished loading. pm2 restarted it 122 times and nginx
# answered 502 to everything.
#
# NO TEST IN THE LIST ABOVE COULD HAVE SEEN IT. Each suite loads the two or
# three files it is about; not one of them loads the app. They check the
# parts. This checks the engine turns over — and when it was first run against
# that build it named nine files, the whole chain hanging off the broken one.
#
# AFTER the suites, so a real test failure is still the first thing reported.
# BEFORE the rsync, so a build that cannot load never reaches the server.
echo "Checking the app loads..."
if ! node check-boot.js; then
  echo
  echo "Nothing was deployed. The server is still running the previous build."
  exit 1
fi
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
