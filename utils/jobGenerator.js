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