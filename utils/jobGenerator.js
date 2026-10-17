// utils/jobGenerator.js
//
// The bridge between a Job record and runGeneration().
//
// Kept separate from both so neither has to know about the other: the runner
// deals in jobs and knows nothing about site building, and runGeneration
// takes a plain context and knows nothing about queues. This is the only
// file that understands both.

const User = require('../models/User');
const { runGeneration } = require('./runGeneration');
const { cleanupJobUploads, filesFromJob } = require('./jobUploads');
const { clearForUsers } = require('./jobPayloads');
const { log } = require('./logger');

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

  try {
    const result = await runGeneration({
      body: job.payload,
      files: filesFromJob(job.uploads || {}),
      user,
      requestId: `job:${job._id}`,

      // Forwarded straight through. runGeneration calls this as each page
      // completes; the runner persists it, which is what makes a restart
      // resume rather than start over.
      onProgress,

      // Pages already written by an earlier attempt. runGeneration skips
      // them rather than paying to regenerate content the user has.
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

module.exports = { generateForJob };