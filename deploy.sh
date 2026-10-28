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
  test-suggest-prompt.js \
  test-site-kind.js \
  test-keyword-coverage.js \
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
  test-batch-cancel.js \
  test-ie-video.js \
  test-ie-topics.js \
  test-signup-result.js \
  test-email-health.js \
  test-hours.js \
  test-pages-to-build.js \
  test-trust-points.js \
  test-job-uploads.js \
  test-ping-detail.js \
  test-job-requeue.js \
  test-ping-health.js \
  test-theme-header.js \
  test-brand-name.js \
  test-dashboard-card.js \
  test-build-progress.js \
  test-blog-retention.js \
  test-probe-log.js \
  test-build-cleanup.js \
  test-job-payloads.js \
  test-blog-json.js \
  test-static-site.js \
  test-plan-contract.js \
  test-static-blogs.js \
  test-write-contract.js \
  test-scheduler-target.js \
  test-suggest-contract.js \
  test-blog-render.js \
  test-mark-published.js \
  test-publish-due.js \
  test-cloudflare-deploy.js \
  test-redirects.js \
  test-restore-blog.js \
  test-blog-scheduler.js \
  test-csv-topics.js \
  test-inline-handlers.js \
  test-theme-activation.js \
  test-blog-api.js \
  test-blog-pages.js \
  test-service-names.js \
  test-plugin-download.js \
  test-verification-tags.js \
  test-secret-box.js \
  test-cloudflare-accounts.js \
  test-blog-domains.js
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
    wp-plugin/test-server-url.php \
    wp-plugin/test-business-keys.php \
    wp-plugin/test-api-body.php \
    wp-plugin/test-writing-progress.php \
    wp-plugin/test-host-blocked.php \
    wp-plugin/test-blog-image.php \
    wp-plugin/test-business-source.php \
    wp-plugin/test-blog-style.php
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

# THE TWO SUITES THAT NEED A DATABASE, AND WHY THEY REFUSE RATHER THAN SKIP.
#
# test-blog-batch.js and test-blog-routes.js were written on 3 September 2026
# and first run on 25 October. Seven weeks. In that time:
#
#   - models/User.js renamed `password` to `passwordHash` on 5 September, two
#     days after the fixtures were written, and every test in both files died
#     in its own setup from then on
#   - the quality gate learned to ask for a rewrite, which doubled the model
#     calls the fixtures were counting
#   - crossCheck started keying an opening on its first six words
#
# None of that was anybody's carelessness. They were not in the loop above, so
# nothing ran them, so nothing complained. A test nobody runs is a test that
# rots, and it rots silently.
#
# THEY ARE NOT IN THE LOOP ABOVE because both begin:
#
#     if (!process.env.MONGO_URI) { console.log('…set MONGO_URI…'); exit(0) }
#
# Dropped into that loop they would exit 0 having run nothing, and the deploy
# would go green on 36 tests that never executed. That is worse than today,
# because it LOOKS like coverage.
#
# SO THIS BLOCK STARTS THE DATABASE ITSELF, and if it cannot, it REFUSES the
# deploy. These 36 tests are the only thing covering charging a customer per
# post — charged once, never twice, not charged for a post that failed. A
# warning you see fifty times is not a warning.
#
# SKIP_DB_TESTS=1 is the deliberate way out, and it is deliberately ugly to
# type. Skipping should be a decision, not a habit.
#
# A SCRATCH DATABASE, ALWAYS. The suites create a user, a site and campaigns
# and delete them at the end, but a crash mid-run leaves rows behind. The name
# below exists for this script and nothing else, and it is never the database
# in .env.
DB_SUITES=(test-blog-batch.js test-blog-routes.js)
SCRATCH_URI="mongodb://127.0.0.1:27017/tc-deploy-scratch"
SCRATCH_DBPATH="${HOME}/mongo-scratch"

# A TCP CONNECT, NOT `mongosh`. mongosh is a separate Homebrew formula from
# the server and may not be installed; something listening on the port is
# enough to try, and if it is not actually MongoDB the suites say so loudly.
db_up() {
  node -e '
    const net = require("net");
    const s = net.connect(27017, "127.0.0.1");
    s.setTimeout(1500);
    s.on("connect", () => { s.end(); process.exit(0); });
    s.on("error",   () => process.exit(1));
    s.on("timeout", () => { s.destroy(); process.exit(1); });
  ' > /dev/null 2>&1
}

if [[ -n "${SKIP_DB_TESTS:-}" ]]; then
  echo "SKIP_DB_TESTS is set — the two database suites were SKIPPED, not passed."
else
  if ! db_up && command -v mongod > /dev/null 2>&1; then
    echo "Starting MongoDB for the database suites..."
    mkdir -p "$SCRATCH_DBPATH"
    mongod --dbpath "$SCRATCH_DBPATH" --port 27017 --fork \
           --logpath "${SCRATCH_DBPATH}/mongod.log" > /dev/null 2>&1 || true
    sleep 2
  fi

  if ! db_up; then
    echo
    echo "MongoDB is not answering on 127.0.0.1:27017, so these cannot run:"
    echo
    for suite in "${DB_SUITES[@]}"; do echo "  ${suite}"; done
    echo
    echo "They are the only tests covering charging a customer per post."
    echo
    echo "Start it by hand:"
    echo
    echo "  mkdir -p ~/mongo-scratch"
    echo "  mongod --dbpath ~/mongo-scratch --port 27017 --fork --logpath ~/mongo-scratch/mongod.log"
    echo
    echo "Or deploy without them, on purpose:"
    echo
    echo "  SKIP_DB_TESTS=1 ./deploy.sh"
    echo
    echo "Nothing was deployed. The server is still running the previous build."
    exit 1
  fi

  echo "Running the database suites..."
  for suite in "${DB_SUITES[@]}"; do
    if ! MONGO_URI="$SCRATCH_URI" node "$suite" > /dev/null; then
      echo
      echo "FAILED: ${suite}"
      echo "Run it directly to see which assertion failed:"
      echo
      echo "  MONGO_URI=\"${SCRATCH_URI}\" node ${suite}"
      echo
      echo "Nothing was deployed. The server is still running the previous build."
      exit 1
    fi
  done
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
