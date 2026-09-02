// utils/jobRunner.js
//
// Runs generation jobs in the background, in this same process.
//
// WHY NOT A SEPARATE PROCESS
// A separate worker isolates the CPU work properly, but needs a second
// process to start, deploy and monitor. Same-process solves the actual
// blockers — the request timeout and all-or-nothing failure — with none of
// that deployment risk. The generation logic is identical either way, so
// splitting it out later is a small change.
//
// WHAT THIS GUARANTEES
//   - the HTTP request returns immediately, so nothing times out
//   - progress is visible while the work runs
//   - a crash or deploy mid-job does not lose completed pages
//   - a job left 'running' by a killed process is picked up again
//
// WHAT IT DOES NOT
// Generation still shares this process with serving requests. The
// concurrency limiter caps how many run at once; heavy jobs may still make
// the app feel briefly sluggish, because the builders use synchronous file
// I/O which blocks the event loop in bursts.

const Job = require('../models/Job');
const { log } = require('./logger');
const { generationLimiter } = require('./concurrencyLimiter');

// How often the loop looks for work. Short enough that a user does not sit
// staring at "queued", long enough not to hammer Mongo when idle.
const POLL_INTERVAL_MS = Number(process.env.JOB_POLL_MS) || 2000;

// A running job writes a heartbeat this often.
const HEARTBEAT_MS = Number(process.env.JOB_HEARTBEAT_MS) || 15000;

// No heartbeat for this long means the process that owned it died.
const STALE_AFTER_MS = Number(process.env.JOB_STALE_MS) || 90000;

let running = false;
let timer = null;

/**
 * The functions that do the work, keyed by job kind. Injected rather than
 * required, to avoid a cycle: the generators import models and utilities that
 * would in turn import this file.
 *
 *   'site' -> utils/jobGenerator.js       the wizard's site build
 *   'blog' -> utils/blogGenerator.js      one Interlink Engine post
 */
const generators = new Map();

/**
 * @param {string}   kind  'site' | 'blog'
 * @param {Function} fn    async (job, { onProgress }) => ({ creditsCharged, result })
 *
 * Called with one argument for years. That form registered the site generator,
 * so it is still accepted and still means 'site' — an old call site keeps
 * working rather than silently registering nothing under the key `undefined`.
 */
function registerGenerator(kind, fn) {
  if (typeof kind === 'function') {
    generators.set('site', kind);
    return;
  }
  if (typeof fn !== 'function') {
    throw new Error(`jobRunner: no function supplied for job kind '${kind}'`);
  }
  generators.set(String(kind), fn);
}

/** Kinds this process can actually run. */
function registeredKinds() {
  return Array.from(generators.keys());
}

/**
 * Requeue jobs whose process died.
 *
 * Without this a job killed mid-run stays 'running' forever: the loop skips
 * it because it is not 'queued', and the user waits for something that will
 * never finish.
 *
 * Safe to run at startup because completedPages means a resumed job skips
 * the work it already did.
 */
async function requeueStaleJobs() {
  const cutoff = new Date(Date.now() - STALE_AFTER_MS);

  const result = await Job.updateMany(
    {
      status: 'running',
      $or: [
        { heartbeatAt: { $lt: cutoff } },
        { heartbeatAt: { $exists: false } },
      ],
    },
    {
      $set: { status: 'queued', 'progress.stage': 'resuming' },
    }
  );

  if (result.modifiedCount) {
    log.info('jobs.requeuedStale', { count: result.modifiedCount });
  }
}

/**
 * Claim one queued job this process knows how to run.
 *
 * findOneAndUpdate is atomic, so two runners — or two server instances —
 * cannot pick up the same job. A plain find-then-save would race.
 *
 * The kind filter matters during a rolling deploy. An instance running the
 * previous release has no 'blog' generator; without the filter it would claim
 * a blog job, mark it 'running', fail to find a generator and leave it stuck
 * until the stale-requeue rescued it 90 seconds later — repeatedly, for as
 * long as the old instance is up. Filtering means it simply leaves that job
 * for an instance that can do the work.
 *
 * $in with the registered kinds also matches nothing when the list is empty,
 * which is the correct behaviour for a process with no generators at all.
 */
async function claimNextJob(kinds = registeredKinds()) {
  return Job.findOneAndUpdate(
    {
      status: 'queued',
      // Rows written before `kind` existed have no such field. They are site
      // builds, so treat a missing value as 'site' rather than skipping them.
      $or: [
        { kind: { $in: kinds } },
        ...(kinds.includes('site') ? [{ kind: { $exists: false } }] : []),
      ],
    },
    {
      $set: {
        status: 'running',
        startedAt: new Date(),
        heartbeatAt: new Date(),
        'progress.stage': 'starting',
      },
    },
    { sort: { createdAt: 1 }, new: true }
  );
}

async function runJob(job) {
  const jobId = String(job._id);

  const heartbeat = setInterval(() => {
    Job.updateOne({ _id: job._id }, { $set: { heartbeatAt: new Date() } })
      .catch(err => log.error('jobs.heartbeatFailed', err, { jobId }));
  }, HEARTBEAT_MS);

  const startedAt = Date.now();
  const kind = job.kind || 'site';

  try {
    const generateFn = generators.get(kind);
    if (!generateFn) {
      // Should be unreachable: claimNextJob only claims registered kinds.
      // Throwing here rather than crashing the tick means the job is marked
      // failed with a readable message instead of being claimed forever.
      throw new Error(`No generator is registered for job kind '${kind}'`);
    }

    log.info('jobs.started', {
      jobId,
      kind,
      userId: String(job.user),
      siteMode: job.siteMode,
      resuming: (job.completedPages || []).length > 0,
    });

    const result = await generateFn(job, {
      /** Called by the generator as it finishes each unit of work. */
      async onProgress({ done, total, current, stage, completedPage, skippedPage }) {
        const set = {};
        if (typeof done === 'number') set['progress.done'] = done;
        if (typeof total === 'number') set['progress.total'] = total;
        if (current !== undefined) set['progress.current'] = current;
        if (stage !== undefined) set['progress.stage'] = stage;
        set.heartbeatAt = new Date();

        const update = { $set: set };

        // Recorded as they complete, so a restart resumes rather than
        // regenerating pages the user has already paid for.
        if (completedPage) update.$addToSet = { completedPages: completedPage };
        if (skippedPage) update.$push = { skippedPages: skippedPage };

        await Job.updateOne({ _id: job._id }, update);
      },
    });

    const completion = {
      status: 'completed',
      finishedAt: new Date(),
      creditsCharged: result?.creditsCharged || 0,
      'progress.stage': 'completed',
      'progress.current': '',
    };

    // Only for kinds whose output is data. A site build returns paths and
    // counts; writing those into `result` would just duplicate what is
    // already on the job.
    if (result && result.result !== undefined) {
      completion.result = result.result;
    }

    await Job.updateOne({ _id: job._id }, { $set: completion });

    log.info('jobs.completed', {
      jobId,
      kind,
      userId: String(job.user),
      durationMs: Date.now() - startedAt,
      creditsCharged: result?.creditsCharged || 0,
    });

  } catch (err) {
    await Job.updateOne({ _id: job._id }, {
      $set: {
        status: 'failed',
        finishedAt: new Date(),
        'progress.stage': 'failed',
        error: { message: err.message, stack: err.stack },
      },
    });

    log.error('jobs.failed', err, {
      jobId,
      kind,
      userId: String(job.user),
      durationMs: Date.now() - startedAt,
    });

  } finally {
    clearInterval(heartbeat);
  }
}

async function tick() {
  try {
    // Respect the same global cap as everything else, so a queue of jobs
    // cannot start ten generations at once.
    if (generationLimiter.stats.running >= generationLimiter.stats.limit) {
      return;
    }

    const job = await claimNextJob();
    if (!job) return;

    // Deliberately NOT awaited: the loop keeps polling so several jobs can
    // run concurrently, up to the limiter's cap.
    generationLimiter
      .run(() => runJob(job), { jobId: String(job._id) })
      .catch(err => log.error('jobs.runnerError', err, { jobId: String(job._id) }));

  } catch (err) {
    log.error('jobs.tickFailed', err);
  }
}

function start() {
  if (running) return;
  if (!generators.size) {
    throw new Error('jobRunner: registerGenerator() must be called before start()');
  }

  running = true;

  requeueStaleJobs().catch(err => log.error('jobs.requeueFailed', err));

  timer = setInterval(tick, POLL_INTERVAL_MS);
  log.info('jobs.runnerStarted', { pollMs: POLL_INTERVAL_MS, kinds: registeredKinds() });
  console.log(
    `⚙️  Job runner active: polling every ${POLL_INTERVAL_MS}ms ` +
    `(${registeredKinds().join(', ')})`
  );
}

function stop() {
  running = false;
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  start,
  stop,
  registerGenerator,
  registeredKinds,
  requeueStaleJobs,
  claimNextJob,
};