// utils/cloudflareSites/rebuildJob.js
//
// Re-render a published website from its stored words, and put it back up.
//
//   jobRunner.registerGenerator('cfedit', rebuildForJob);
//
//
// WHY THIS IS A JOB AND NOT PART OF THE SAVE
//
// It used to be part of the save. The handler took the edited words, wrote
// them, rebuilt the site and deployed it to Cloudflare — all on the browser's
// own connection, with the person watching a spinner.
//
// nginx closes a proxied connection after 60 seconds. A re-render of a
// 38-page site takes more than ten minutes, nearly all of it waiting on one
// model call per service page. So every save ended the same way:
//
//     504 Gateway Time-out — nginx/1.24.0 (Ubuntu)
//
// while the build carried on quite happily behind it and finished unobserved.
// Express does not abort a handler when the client goes away, so the work was
// never the problem. The REPORTING was: there was no longer anybody to report
// to.
//
//     A REQUEST IS A PROMISE TO ANSWER SOON. Work that cannot answer soon
//     does not belong in one, however well it works.
//
// The generator wizard learned this already — it enqueues and redirects to
// /jobs/:id. This is the same move for the edit screen, using the same
// runner, the same Job rows and the same progress page.
//
//
// WHAT IT DOES NOT DO: SAVE THE WORDS
//
// They are already saved. The handler writes them before it enqueues, and
// that order is the one thing here that must not change — a failed or
// abandoned rebuild has to leave the edited words in place, so pressing Save
// again retries rather than asking somebody to retype what they typed.
//
// So this job starts from the model that is ALREADY on the row. It takes no
// words in its payload, which also means a payload that cannot be stale.

'use strict';

const CloudflareSite = require('../../models/CloudflareSite');
const siteStore = require('./siteStore');
const { log } = require('../logger');

/**
 * @param {object} job                the Job row, with `payload.siteId`
 * @param {function} [opts.onProgress] the runner's progress reporter
 * @returns {Promise<{creditsCharged: number}>}
 *
 * THROWS RATHER THAN RETURNING A FAILURE. The runner catches, marks the job
 * failed and keeps the message, which is what the progress page shows. A
 * returned error object would be a second way of failing that only this file
 * knows about.
 */
async function rebuildForJob(job, { onProgress } = {}) {
  const jobId = String(job._id);
  const siteId = String((job.payload && job.payload.siteId) || '');

  /* REQUIRED INSIDE THE FUNCTION, NOT AT THE TOP, AND A FAILING SUITE IS WHY.
   *
   * utils/runGeneration pulls in the OpenAI client, which THROWS AT LOAD when
   * OPENAI_API_KEY is unset. The route file learned this the hard way; this
   * one is required by server.js at startup, so a top-level import here would
   * take the whole app down on a machine without the key rather than only the
   * path that needs it. */
  const { runGeneration } = require('../runGeneration');
  const { publishNow, whyNotEditable } = require('../../routes/cloudflareSitesRoute');

  /* READ AGAIN, NOT TAKEN FROM THE PAYLOAD. Minutes can pass between the save
   * and the runner picking this up — long enough for the site to be deleted,
   * or for a second save to land. The row is the truth; the payload is only a
   * pointer to it. */
  const site = await CloudflareSite.findOne({ _id: siteId, user: job.user });

  if (!site) {
    throw new Error('That website is no longer here, so there was nothing to rebuild.');
  }

  /* THE SAME RULE THE SCREEN CHECKED, CHECKED AGAIN. Not defensiveness for
   * its own sake: the screen checked it before the words were saved, and this
   * runs afterwards, in another process, possibly after a deploy. */
  const why = whyNotEditable(site);
  if (why) throw new Error(why);

  if (onProgress) {
    await onProgress({ stage: 'rebuilding', current: site.siteUrl, done: 0, total: 0 });
  }

  /* `files: []` — NO UPLOADS, DELIBERATELY. The images are not regenerated;
   * they are copied back out of the site's own store below. runGeneration
   * takes the logo and favicon paths off the stored model when `reuse` is
   * set — see the note beside its required-files guard, which used to refuse
   * this call outright. */
  const built = await runGeneration({
    body: site.buildRecipe.body,
    files: [],
    user: { _id: site.user },
    requestId: jobId,
    reuse: site.contentModel,
  });

  /* THE IMAGES, PUT BACK BEFORE ANYTHING IS READ FOR DEPLOY.
   *
   * wrangler ships a DIRECTORY as the whole site, so a file absent from dist/
   * is absent from the deployment — every <img> would be correct and every
   * one would 404. See siteStore.js. */
  const assets = await siteStore.restoreAssets(String(site._id), built.distDir);

  log.info('cfSites.edit.rebuilt', {
    jobId,
    siteId: String(site._id),
    charged: built.creditsCharged,
    reused: Boolean(built.reused),
    assetsRestored: assets.restored,
    assetsAlreadyThere: assets.skipped,
    hadStoredAssets: assets.had,
  });

  if (onProgress) {
    await onProgress({ stage: 'publishing', current: site.siteUrl });
  }

  const result = await publishNow({ userId: site.user, requestId: jobId, site });

  if (!result.ok) {
    /* THE DEPLOY'S OWN WORDS, KEPT. deploy.js writes messages that name the
     * account and say whether the thing is worth retrying; replacing them
     * with "publish failed" would throw away the only useful part. */
    throw new Error(result.error || 'The website was rebuilt but could not be published.');
  }

  log.info('cfSites.edit.published', {
    jobId,
    siteId: String(site._id),
    files: result.count,
  });

  /* CREDITS ARE REPORTED, NOT CHARGED HERE. runGeneration decides — and with
   * `reuse` set it charges nothing for the words. It is not zero in general:
   * generateReview still costs one call per service page, which is why this
   * job takes minutes rather than seconds. The runner copies this onto the
   * job, and the progress page shows it. */
  return {
    creditsCharged: built.creditsCharged || 0,
    result: {
      siteUrl: site.siteUrl,
      files: result.count,
    },
  };
}

module.exports = { rebuildForJob };
