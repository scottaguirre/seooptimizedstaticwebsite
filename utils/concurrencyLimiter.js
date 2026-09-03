// utils/concurrencyLimiter.js
//
// Caps how many expensive operations run at once, queueing the rest.
//
// WHY
// Generation is mostly `await` on OpenAI, so Node is not blocked and a few
// simultaneous users interleave fine. Three things break beyond that:
//
//   1. The builders use synchronous file I/O (readFileSync, copyFileSync).
//      Those block the WHOLE event loop, so while one user's images are
//      being copied nobody else gets served at all.
//
//   2. Webpack is a separate process per build. Five people clicking Download
//      together spawns five, and on a small VPS that is an out-of-memory kill
//      which takes the server with it.
//
//   3. OpenAI rate limits are per account, not per user. Ten users arriving
//      at once is ~240 API calls in a burst, and there is no backoff on the
//      content calls — those generations simply fail.
//
// The per-user lock already in generateRoute stops one person running two
// generations. This caps the TOTAL across everyone, which is the part that
// was missing.
//
// WHAT THIS IS NOT
// This is per-process. Two Node instances behind a load balancer would each
// allow their own N. It also does not fix the request timeout — a browser
// still gives up after ~60s, so this suits many users with normal-sized
// sites, not one user with a hundred pages. That needs a job queue.

const { log } = require('./logger');

class ConcurrencyLimiter {
  /**
   * @param {object} opts
   * @param {string} opts.name         for logging, e.g. 'generation'
   * @param {number} opts.limit        how many may run at once
   * @param {number} [opts.maxQueue]   reject beyond this rather than queue
   * @param {number} [opts.queueTimeoutMs] give up waiting after this long
   */
  constructor({ name, limit, maxQueue = 50, queueTimeoutMs = 5 * 60 * 1000 }) {
    this.name = name;
    this.limit = limit;
    this.maxQueue = maxQueue;
    this.queueTimeoutMs = queueTimeoutMs;

    this.running = 0;
    this.queue = [];
  }

  get stats() {
    return { running: this.running, queued: this.queue.length, limit: this.limit };
  }

  /**
   * Run fn() when a slot is free.
   *
   * @param {Function} fn
   * @param {object} [meta] included in logs — e.g. { userId, requestId }
   * @returns whatever fn returns
   * @throws {Error} with code 'QUEUE_FULL' or 'QUEUE_TIMEOUT'
   */
  async run(fn, meta = {}) {
    if (this.running >= this.limit) {
      if (this.queue.length >= this.maxQueue) {
        const err = new Error(`Too many ${this.name} requests are already waiting.`);
        err.code = 'QUEUE_FULL';

        log.security(`limiter.${this.name}.queueFull`, {
          ...meta, running: this.running, queued: this.queue.length,
        });
        throw err;
      }

      await this._waitForSlot(meta);
    }

    this.running += 1;

    try {
      return await fn();
    } finally {
      this.running -= 1;
      this._releaseNext();
    }
  }

  /**
   * Take a slot, returning the function that gives it back.
   *
   * run() suits a small block you can wrap in a callback. Route handlers that
   * already have a long try/finally are cleaner served by this: acquire at
   * the top, release in the finally, no restructuring.
   *
   *   const release = await limiter.acquire({ userId });
   *   try { ...long body... } finally { release(); }
   *
   * @returns {Promise<Function>} release — safe to call more than once
   */
  async acquire(meta = {}) {
    if (this.running >= this.limit) {
      if (this.queue.length >= this.maxQueue) {
        const err = new Error(`Too many ${this.name} requests are already waiting.`);
        err.code = 'QUEUE_FULL';
        log.security(`limiter.${this.name}.queueFull`, {
          ...meta, running: this.running, queued: this.queue.length,
        });
        throw err;
      }
      await this._waitForSlot(meta);
    }

    this.running += 1;

    let released = false;
    return () => {
      // Guard against a double release: that would let the limiter run more
      // than `limit` jobs, which is worse than leaking a slot.
      if (released) return;
      released = true;
      this.running -= 1;
      this._releaseNext();
    };
  }

  _waitForSlot(meta) {
    const waitedFrom = Date.now();

    log.info(`limiter.${this.name}.queued`, {
      ...meta, running: this.running, queued: this.queue.length + 1,
    });

    return new Promise((resolve, reject) => {
      // Without a timeout a queued request could wait forever behind a stuck
      // build, holding an open connection the whole time.
      const timer = setTimeout(() => {
        this.queue = this.queue.filter(entry => entry.resolve !== resolve);

        const err = new Error(`Timed out waiting to start ${this.name}.`);
        err.code = 'QUEUE_TIMEOUT';

        log.error(`limiter.${this.name}.queueTimeout`, err, {
          ...meta, waitedMs: Date.now() - waitedFrom,
        });
        reject(err);
      }, this.queueTimeoutMs);

      this.queue.push({
        resolve: () => {
          clearTimeout(timer);
          log.info(`limiter.${this.name}.started`, {
            ...meta, waitedMs: Date.now() - waitedFrom,
          });
          resolve();
        },
      });
    });
  }

  _releaseNext() {
    const next = this.queue.shift();
    if (next) next.resolve();
  }
}

/* -------------------------------------------------------------------------
 * The limiters
 *
 * Two, because the constraints are different:
 *
 *   GENERATION is I/O-bound — mostly waiting on OpenAI — so several can
 *   overlap usefully. The ceiling here is the OpenAI rate limit.
 *
 *   BUILDS are CPU-bound. Webpack saturates a core and holds a few hundred MB,
 *   so running several concurrently on a small VPS risks the OOM killer. One
 *   at a time is deliberately conservative; raise it if you have the cores.
 *
 * Both are overridable by environment variable so they can be tuned on the
 * server without a code change.
 * ---------------------------------------------------------------------- */

const generationLimiter = new ConcurrencyLimiter({
  name: 'generation',
  limit: Number(process.env.MAX_CONCURRENT_GENERATIONS) || 3,
  maxQueue: Number(process.env.MAX_QUEUED_GENERATIONS) || 20,
  queueTimeoutMs: 5 * 60 * 1000,
});

/**
 * The queue timeout is 30 minutes, not 5.
 *
 * Five was right when a build ran inside an HTTP request: nobody's browser
 * waits longer than that, so a longer wait was pointless. Builds are now
 * background jobs with a progress page, and nothing is holding a connection —
 * so waiting is exactly what a queued build should do.
 *
 * The old value had a specific failure. Three customers press Download
 * together, a 100-page build takes four minutes, and the third waits eight —
 * past the timeout. It got 'timed-out', which productionRoute had no message
 * for, so it fell through to "Something went wrong during the build. Check the
 * server logs." A build that had not even started was reported as a failure.
 */
const buildLimiter = new ConcurrencyLimiter({
  name: 'build',
  limit: Number(process.env.MAX_CONCURRENT_BUILDS) || 1,
  maxQueue: Number(process.env.MAX_QUEUED_BUILDS) || 20,
  queueTimeoutMs: Number(process.env.BUILD_QUEUE_TIMEOUT_MS) || 30 * 60 * 1000,
});

module.exports = {
  ConcurrencyLimiter,
  generationLimiter,
  buildLimiter,
};