// utils/batchGenerator.js
//
// One job, several websites, built one after another.
//
// WHY — Edwin, 18 November: *"i would like to be able to fill out the
// information for at least the 3 sites we have available and the build
// starts and after one is deployed the app starts the second build and so
// on?"*
//
// WHY IT IS ONE JOB AND NOT THREE, WHICH IS THE WHOLE DESIGN.
//
// Three jobs looks like the obvious answer: the queue already runs them one
// after another and the runner already claims them atomically. It is wrong,
// and the reason is four files away.
//
// EVERY LOCAL WEBSITE OPTIONS BUILD CALLS resetUserDirs(), WHICH WIPES AND
// REFILLS dist/user_<id>. One folder per user, reused by every build they
// ever run. And generationLimiter allows three jobs at once.
//
//     THREE QUEUED SITE JOBS FOR ONE USER WOULD RUN TOGETHER,
//     AND SITE TWO WOULD WIPE SITE ONE'S FOLDER HALF WAY THROUGH.
//
// Nothing would throw. Both sites would publish something; at least one of
// them would be wrong. That is also exactly why generateRoute.js refuses a
// second site build while one is queued or running — the guard is correct
// and it stays.
//
// So the batch is ONE job that owns the folder for its whole run and uses it
// serially, which is what resetUserDirs() has always expected.
//
// THE SHAPE IS NOT NEW. An Interlink Engine campaign is one `kind: 'blog'`
// job that writes fifteen posts, with progress.total set to the scope. This
// is the same thing with sites in place of posts, and it reuses the same two
// persisted fields to survive a restart.
//
// IT CALLS generateForJob() RATHER THAN REBUILDING WHAT IT DOES.
//
// That function loads the user, clears stale payloads, chooses the builder,
// runs it, reads the destination, publishes to Cloudflare or GitHub and
// reports the outcome — about a hundred lines of decisions, every one of
// which has a comment recording what it cost to learn. A batch that
// reimplemented any of it would be a second copy, and the next fix would
// land in one of the two.
//
//     A SITE IN A BATCH IS NOT A DIFFERENT KIND OF SITE.
//     IT IS THE SAME BUILD WITH SOMETHING ELSE WAITING BEHIND IT.
//
//   node test-site-batch.js

'use strict';

/* NOT `require('./jobGenerator')` AT THE TOP.
 *
 * That module pulls in runGeneration, which pulls in
 * generateLocationPagesContent, which builds an OpenAI client at load time
 * and throws "Missing credentials" without an API key. A top-level require
 * here means tagFor() — eight lines of string handling that touch no
 * network at all — cannot be loaded to be tested.
 *
 * The same reasoning utils/suggestServices.js gives for building its client
 * lazily, and the same thing jobGenerator.js itself does with
 * cloudflareSitesRoute: *a dependency should take down the one feature that
 * needs it, not everything in the file.* Required inside the loop below, at
 * the moment it is used. */
const { wantedAddress } = require('./cloudflareSites/wanted');
const { log } = require('./logger');

/**
 * What one site in a batch is called, in the report and in completedPages.
 *
 * THE ADDRESS, BECAUSE THAT IS WHAT THE OWNER RECOGNISES. A batch report
 * saying "site 2 failed" is a report nobody can act on; one saying
 * "hvac.acmesites.com failed" names the thing.
 *
 * FALLS BACK TO THE POSITION rather than throwing. A batch whose second
 * entry carried no address is a batch that will fail on that entry for a
 * better reason a moment later, and it must still be able to say which one
 * it was. An empty tag would collide with every other empty tag and make
 * the resume skip the wrong site.
 */
function tagFor(body, i) {
  const want = wantedAddress(body);
  const host = [want.prefix, want.domain].filter(Boolean).join('.');

  return host || `site-${i + 1}`;
}

/**
 * A single-site job, borrowed from the batch it belongs to.
 *
 * NOT A Job DOCUMENT AND NEVER SAVED. generateForJob() reads five fields off
 * what it is given — `_id`, `user`, `payload`, `uploads`, `completedPages` —
 * and writes none of them. Handing it a plain object with those five is what
 * lets the batch reuse it whole.
 *
 * `completedPages` IS EMPTIED, DELIBERATELY. The batch's own
 * completedPages holds SITE tags; handing those to a builder that expects
 * PAGE slugs would have it skip pages whose names happened to match a
 * hostname. It is a short list of strings either way, which is exactly the
 * kind of confusion that does not announce itself.
 *
 * `uploads` IS EMPTY TOO, and that is a constraint rather than an oversight.
 * A batch takes the generated wordmark, not an uploaded logo: uploads are
 * keyed by job id and cleaned up by job id, so three sites sharing one job
 * would share one upload folder and the first site's cleanup would take the
 * third site's logo with it. The route refuses a batch entry that asks for
 * an upload, where it can say so.
 */
function oneSite(job, body) {
  return {
    _id: job._id,
    user: job.user,
    payload: body,
    uploads: {},
    completedPages: [],
  };
}

/**
 * Build every site in a batch, in order, reporting as it goes.
 *
 * @param {object}   job                  the Job document
 * @param {object}   handlers
 * @param {Function} handlers.onProgress
 * @param {Function} [handlers.build]     injected single-site builder
 * @returns {Promise<{creditsCharged: number, result: object}>}
 *
 * THE SAME CONTRACT AS EVERY OTHER GENERATOR, because jobRunner.js calls
 * all of them the same way and persists `result.result` onto the job. The
 * extra handler is ignored by the runner and is how the suite exercises the
 * order, the carry-on and the resume without an API key or a Mongo — the
 * same injection generateLocalOptionsSite() takes for `ask` and `suggest`.
 */
async function generateForBatch(job, { onProgress, build } = {}) {
  const runOne = build || require('./jobGenerator').generateForJob;

  const sites = Array.isArray(job.payload?.sites) ? job.payload.sites : [];
  const total = sites.length;

  if (!total) {
    throw new Error('This batch has no sites in it.');
  }

  /* WHAT A PREVIOUS ATTEMPT ALREADY DECIDED.
   *
   * completedPages holds the tag of every site that finished, and
   * skippedPages holds { page, reason } for every site that failed. Both are
   * written through onProgress as each site ends, so both are already on the
   * job when a killed process comes back.
   *
   *     A RESTART MUST NOT REBUILD A SITE THAT IS ALREADY LIVE.
   *     IT COSTS THE CREDITS AGAIN AND REPUBLISHES OVER A GOOD SITE.
   *
   * THE TWO FIELDS ARE REUSED RATHER THAN A THIRD ONE ADDED, and the names
   * are a stretch — the unit here is a site, not a page. The semantics are
   * exactly right though: done, and not-done-with-a-reason. A new array on
   * the Job schema would need the runner taught to persist it, which is the
   * one part of this that is already written and already survives a crash.
   *
   * A FAILED SITE COUNTS AS DECIDED. Only a site the process died in the
   * middle of has neither tag, and that is precisely the one worth retrying. */
  const already = new Set(job.completedPages || []);
  const failedBefore = new Map(
    (job.skippedPages || []).map(row => [row.page, row.reason])
  );

  /* The report is rebuilt from what is on the job, so a resume reports the
   * whole batch rather than only the part it personally built. */
  const report = [];
  let credits = 0;
  let built = 0;

  for (let i = 0; i < total; i += 1) {
    const body = sites[i];
    const tag = tagFor(body, i);
    const place = `Site ${i + 1} of ${total}`;

    if (already.has(tag)) {
      report.push({ site: tag, ok: true, error: '', resumed: true });
      built += 1;
      continue;
    }

    if (failedBefore.has(tag)) {
      report.push({ site: tag, ok: false, error: failedBefore.get(tag), resumed: true });
      built += 1;
      continue;
    }

    await onProgress({
      done: built,
      total,
      current: `${place}: ${tag}`,
      stage: 'building',
    });

    try {
      const out = await runOne(oneSite(job, body), {
        /* THE INNER BUILD'S PROGRESS BECOMES TEXT, NOT NUMBERS.
         *
         * It reports eleven pages; the batch reports three sites. Forwarded
         * straight through, `done: 7, total: 11` would overwrite the batch's
         * own counters and the bar would jump to 7 of 11 and then back.
         *
         * AND `completedPage` IS DROPPED ON PURPOSE. It is a page slug, and
         * this job's completedPages is the list of finished SITES — the list
         * the resume above reads. One leaked page name in there and a
         * restart skips a site that was never built. */
        onProgress: async (p = {}) => {
          await onProgress({
            done: built,
            total,
            current: p.current ? `${place}: ${p.current}` : `${place}: ${tag}`,
            stage: p.stage || 'building',
          });
        },
      });

      credits += Number(out?.creditsCharged) || 0;

      /* THE BUILD CAN SUCCEED AND THE PUBLISH CAN FAIL, and the job is the
       * only place that knows. generateForJob reports it through
       * `result.published` precisely so it is not lost — see the note there
       * about two builds that said `completed` with 800 credits charged and
       * nothing live.
       *
       *     A SITE THAT WAS PAID FOR AND DID NOT GO LIVE IS NOT A SITE THAT
       *     SUCCEEDED, AND A BATCH REPORT THAT SAYS IT DID IS WORSE THAN NO
       *     REPORT.
       *
       * `published` is null for an account with no GitHub installation,
       * which is not a failure — it is a GitHub build nobody asked to
       * publish. Only an explicit `ok: false` is one. */
      const published = out?.result?.published;
      const live = !published || false !== published.ok;
      const why = published && false === published.ok
        ? (published.error || 'The site was built but could not be published.')
        : '';

      report.push({
        site: tag,
        ok: live,
        error: why,
        url: (published && published.url) || '',
      });

      await onProgress({
        done: built + 1,
        total,
        current: `${place}: ${tag}`,
        stage: 'building',
        ...(live ? { completedPage: tag } : { skippedPage: { page: tag, reason: why } }),
      });

    } catch (err) {
      /* CARRY ON — Edwin, 18 November, choosing it over stopping the batch:
       * sites one and three deploy, site two is reported. A batch that stops
       * on the first problem throws away the builds that would have worked,
       * and the owner is sitting in front of neither.
       *
       * LOGGED AS WELL AS REPORTED. The report tells the owner; the log is
       * the only place the stack survives. */
      log.error('batch.siteFailed', err, {
        jobId: String(job._id),
        site: tag,
        position: i + 1,
        of: total,
      });

      report.push({ site: tag, ok: false, error: err.message || 'The build failed.' });

      await onProgress({
        done: built + 1,
        total,
        current: `${place}: ${tag}`,
        stage: 'building',
        skippedPage: { page: tag, reason: err.message || 'The build failed.' },
      });
    }

    built += 1;
  }

  const live = report.filter(r => r.ok).length;

  log.info('batch.finished', {
    jobId: String(job._id),
    userId: String(job.user),
    sites: total,
    live,
    failed: total - live,
    creditsCharged: credits,
  });

  /* THE JOB COMPLETES EVEN WHEN EVERY SITE FAILED, and that is deliberate.
   *
   * `failed` on a job means the batch itself could not run. Three sites that
   * each failed for their own reason is a batch that ran perfectly and has
   * three things to tell you — and a job marked `failed` shows an error page
   * instead of the report, which is the one thing the owner needs to read.
   *
   * The report carries the count, so the page can say "1 of 3 published"
   * without pretending that is a success. */
  return {
    creditsCharged: credits,
    result: {
      batch: {
        total,
        live,
        failed: total - live,
        sites: report,
      },
    },
  };
}

module.exports = { generateForBatch, tagFor, oneSite };
