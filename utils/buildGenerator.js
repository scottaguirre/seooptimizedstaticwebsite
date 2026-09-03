// utils/buildGenerator.js
//
// The bridge between a Job of kind 'build' and runProductionBuild().
//
// Third of its kind, alongside jobGenerator.js (sites) and blogGenerator.js
// (posts). Same division: the runner knows about jobs, runProductionBuild
// knows about webpack, and this is the only file that knows both.
//
// WHY THE BUILD BECAME A JOB
//
// It was the one long operation still running inside an HTTP request. Its own
// concurrency limiter said so, in utils/concurrencyLimiter.js:
//
//     It also does not fix the request timeout — a browser still gives up
//     after ~60s... That needs a job queue.
//
// A job queue was then built, for generation only. Webpack on a hundred entry
// points is minutes, so /production would hand the customer a hung tab while
// the build carried on server-side and finished into a ZIP they were never
// told about.
//
// NOTHING IS CHARGED HERE
//
// The build produces no new content — it optimises and zips a site the
// customer already paid to generate. creditsCharged is 0, deliberately, and
// that is not an oversight to be fixed later.

const { runProductionBuild } = require('./runProductionBuild');
const { log } = require('./logger');

/**
 * Messages for the reasons runProductionBuild returns.
 *
 * It never throws — it returns { ok: false, reason }. The job runner marks a
 * job failed only when the generator throws, so each reason is turned into a
 * thrown Error carrying wording the customer can act on.
 *
 * 'timed-out' and 'too-busy' had no message at all in productionRoute, so both
 * were reported as "Something went wrong during the build. Check the server
 * logs" — telling someone whose build had not started that it had failed.
 */
const REASONS = {
  'no-site': 'No generated site was found. Generate your website first.',
  'in-progress': 'A build is already running for your account.',
  'too-busy': 'Too many builds are queued right now. Please try again shortly.',
  'timed-out': 'Your build waited too long for a free slot. Please try again.',
  'build-failed': 'The build did not complete. Please try again, or contact support with this job id.',
};

/**
 * @param {object} job  the Job document, kind 'build'
 * @param {object} handlers
 * @param {Function} handlers.onProgress
 */
async function buildForJob(job, { onProgress }) {
  const userId = String(job.user);

  // total 1 / done 0 so the progress page shows its indeterminate striped bar
  // rather than a percentage nobody can calculate — webpack reports nothing
  // through exec().
  await onProgress({ stage: 'Starting', total: 1, done: 0, current: '' });

  const result = await runProductionBuild(userId, {
    onProgress: ({ stage }) => onProgress({ stage, current: '' }),
  });

  if (!result.ok) {
    const message = REASONS[result.reason] || REASONS['build-failed'];

    log.error('build.failed', result.error || new Error(result.reason), {
      jobId: String(job._id),
      userId,
      reason: result.reason,
    });

    // Thrown, not returned: that is what marks the job failed and puts the
    // message on the progress page.
    const err = new Error(message);
    err.code = result.reason;
    throw err;
  }

  await onProgress({ stage: 'completed', done: 1, total: 1, current: '' });

  log.info('build.completed', { jobId: String(job._id), userId });

  return {
    // The build creates nothing new — it repackages a site already paid for.
    creditsCharged: 0,
    result: { zipPath: result.zipPath, ready: true },
  };
}

module.exports = { buildForJob };