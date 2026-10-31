// utils/jobGenerator.js
//
// The bridge between a Job record and whichever builder its mode needs.
//
// Kept separate from both so neither has to know about the other: the runner
// deals in jobs and knows nothing about site building, and the builders take
// a plain context and know nothing about queues. This is the only file that
// understands both.
//
// AND IT IS THE ONLY FILE THAT CHOOSES BETWEEN THE TWO BUILDERS.
// Rank Fast, Rank GBPs and One-Page Design go through runGeneration();
// Local Website Options goes through runLocalOptions(). The reason they are
// separate files rather than a branch inside the big one is written at the
// top of utils/runLocalOptions.js. The reason the choice is made HERE is
// that both take the identical context and return the identical result, so
// this is the one place where that fact is worth anything.

const User = require('../models/User');
const { runGeneration } = require('./runGeneration');
const { runLocalOptions } = require('./runLocalOptions');
const { cleanupJobUploads, filesFromJob } = require('./jobUploads');
const { clearForUsers } = require('./jobPayloads');
const { MODES, normalizeSiteMode } = require('./seoPresets');
const { log } = require('./logger');

/**
 * Which builder this job needs.
 *
 * READ OUT OF THE PAYLOAD, NOT OFF job.siteMode.
 *
 * Both are written by the route and they agree — but the payload is what
 * every builder actually reads, and runGeneration resolves the mode from it
 * again on its own. Taking the decision from the same place keeps the two
 * from ever disagreeing about one job. The `siteMode` column exists so lists
 * and support queries can filter without opening the payload; that is a
 * different job from this one.
 *
 * normalizeSiteMode() falls back to 'lead', so a job with no mode at all —
 * every row written before the field existed — builds the way it always did.
 */
function builderFor(job) {
  const siteMode = normalizeSiteMode(
    job.payload?.global?.siteMode ?? job.payload?.['global[siteMode]']
  );

  return siteMode === MODES.LOCAL_OPTIONS
    ? { siteMode, build: runLocalOptions }
    : { siteMode, build: runGeneration };
}

/**
 * @param {object} job                 the Job document
 * @param {object} handlers
 * @param {Function} handlers.onProgress
 */
async function generateForJob(job, { onProgress }) {
  // Loaded fresh rather than taken from the job: the balance may have
  // changed since it was queued, and charging is based on the live value.
  const user = await User.findById(job.user);
  if (!user) {
    throw new Error('The user who queued this job no longer exists');
  }

  /* THE PREVIOUS SITE IS ABOUT TO BE DELETED, SO ITS FORM CAN GO TOO.
   *
   * runGeneration's step 2 calls resetUserDirs(), which rmSyncs
   * dist/user_<id>. There is one folder per USER, not one per site, so
   * starting this build destroys whatever was there — the 48-hour sweep is
   * not the only way a site disappears, and it is not even the common one.
   *
   * Their payloads describe a website that is seconds from not existing, and
   * a swept or overwritten site is gone for good rather than rebuildable, so
   * nothing will read them again.
   *
   * `except` is belt and braces: this job is 'running', and clearForUsers
   * only touches 'completed' ones, so it could not be hit. Naming it anyway
   * means a future change to either rule cannot quietly empty the form of
   * the build currently using it.
   *
   * BEFORE runGeneration rather than after, and the window that opens is
   * harmless: if this build fails before step 2 the old site survives with
   * its payload cleared, and that payload was only ever going to be read by
   * a resume of the OLD job, which has already completed. Doing it
   * afterwards would miss every build that crashes half way — exactly the
   * ones that leave the most behind. */
  await clearForUsers([job.user], {
    except: job._id,
    reason: 'replaced by a new build',
  });

  const { siteMode, build } = builderFor(job);

  log.info('jobs.builderChosen', {
    jobId: String(job._id),
    siteMode,
    builder: build === runLocalOptions ? 'runLocalOptions' : 'runGeneration',
  });

  try {
    const result = await build({
      body: job.payload,
      files: filesFromJob(job.uploads || {}),
      user,
      requestId: `job:${job._id}`,

      // Forwarded straight through. The builder calls this as each page
      // completes; the runner persists it, which is what makes a restart
      // resume rather than start over.
      onProgress,

      /* Pages already written by an earlier attempt. runGeneration skips
       * them rather than paying to regenerate content the user has.
       *
       * runLocalOptions IGNORES THIS, on purpose. Its build is seven model
       * calls and about nineteen cents, and a half-written eleven-page site
       * is worth nothing to hand back — so a restart starts over. Passed
       * anyway rather than conditionally, because a context that changes
       * shape by mode is a context where the next field gets forgotten for
       * one of them. */
      alreadyCompleted: job.completedPages || [],
    });

    return result;

  } finally {
    // The logo and favicon are no longer needed once the site is built —
    // they have been copied into the user's assets folder.
    await cleanupJobUploads(job._id).catch(err =>
      log.error('jobs.uploadCleanupFailed', err, { jobId: String(job._id) })
    );
  }
}

module.exports = {
  generateForJob,

  /* Exported for test-local-options-wiring.js. Which builder a job gets is
   * the whole decision this file makes, and the only honest way to test it
   * is to ask — generateForJob() would have to load a User out of Mongo and
   * run a build to tell you the same thing. */
  builderFor,
};