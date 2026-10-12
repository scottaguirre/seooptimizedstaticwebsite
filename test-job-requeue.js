// test-job-requeue.js
//
// A job whose owner died has to be found again.
//
// WHAT THIS IS GUARDING
//
// requeueStaleJobs() looks for jobs marked `running` whose heartbeat has gone
// quiet, and puts them back on the queue. Resuming is safe — completedPages
// means a resumed job skips the posts it already wrote and charged for.
//
// IT RAN ONLY AT STARTUP, which is the one moment it cannot help.
//
// A deploy restarts the process mid-batch. The job it was running has a
// heartbeat a few seconds old, so the sweep at startup does not touch it:
// STALE_AFTER_MS has not passed. Nothing looked again — the sweep was not on
// the polling loop. So the job stayed `running` with nobody running it, the
// campaign stayed `writing`, and the owner watched a spinner over a batch that
// had died. Until the NEXT restart, whenever that happened to be, by which
// time the heartbeat was finally old enough to qualify.
//
// The recovery existed and could not reach itself.
//
// Edwin found it by asking whether deploying mid-batch would stop his
// campaign. It would have stranded twenty-three written posts and seven never
// written, on a campaign already paid for, with the card insisting it was
// still working.
//
// WHAT IS WORTH ASSERTING, which is not "the sweep exists"
//
//   - it runs on the LOOP, not only at startup
//   - it does not run on every tick, two seconds apart, for a condition that
//     cannot change in under ninety
//   - it runs BEFORE work is claimed, so a job rescued this pass can be
//     picked up in the same pass
//   - it only touches jobs that are genuinely stale
//
//   node test-job-requeue.js
//
// Needs no database: the Job model is stubbed through the loader, the way
// test-licence-binding.js does it.

const assert = require('assert');
const Module = require('module');

let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}\n`); }

/* ------------------------------------------------------------------ *
 * Mongo, as far as the runner touches it
 * ------------------------------------------------------------------ */

const calls = { updateMany: [], claim: [] };

/** What claimNextJob will find. Set to null for an empty queue. */
let nextJob = null;

const fakeJob = {
  updateMany(filter, update) {
    calls.updateMany.push({ filter, update });
    return Promise.resolve({ modifiedCount: 0 });
  },
  findOneAndUpdate(filter) {
    calls.claim.push({ filter, at: calls.updateMany.length });
    return Promise.resolve(nextJob);
  },
  updateOne() { return Promise.resolve({}); },
  findById() { return Promise.resolve(null); },
};

const stubs = {
  '../models/Job': fakeJob,
  './logger': { log: { info() {}, error() {}, security() {}, external() {} } },
  './concurrencyLimiter': {
    generationLimiter: {
      stats: { running: 0, limit: 2 },
      run: fn => Promise.resolve(fn()),
    },
  },
};

const realLoad = Module._load;
Module._load = function (request) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return realLoad.apply(this, arguments);
};

const runner = require('./utils/jobRunner');

Module._load = realLoad;

/** Back to a clean slate between cases. */
function reset() {
  calls.updateMany.length = 0;
  calls.claim.length = 0;
  nextJob = null;
  runner.stop();   // also clears the sweep stamp
}

/* ===================================================================== */

(async () => {

  section('The sweep runs on the loop, not only at startup');

  await test('THE FIRST TICK SWEEPS', async () => {
    /* The whole bug. A process that restarted mid-batch swept once, found the
     * job too fresh to qualify, and never looked again. */
    reset();

    await runner.tick();

    assert.strictEqual(calls.updateMany.length, 1,
      'the polling loop never looks for jobs whose owner died');
  });

  await test('it does not sweep again two seconds later', async () => {
    /* The loop polls every two seconds. A job has to go ninety seconds without
     * a heartbeat to qualify at all, so sweeping every pass is an updateMany
     * against Mongo for a condition that cannot have changed. */
    reset();

    await runner.tick();
    await runner.tick();
    await runner.tick();

    assert.strictEqual(calls.updateMany.length, 1,
      'the sweep runs on every tick — 30 pointless updateMany calls a minute');
  });

  await test('BUT IT DOES SWEEP AGAIN ONCE THE INTERVAL HAS PASSED', async () => {
    /* The other half. Throttling that never releases is the original bug with
     * extra steps. */
    reset();

    await runner.tick();

    const real = Date.now;
    Date.now = () => real() + 31000;

    try {
      await runner.tick();
    } finally {
      Date.now = real;
    }

    assert.strictEqual(calls.updateMany.length, 2,
      'the sweep never runs a second time, so a stranded job stays stranded');
  });

  /* ===================================================================== */

  section('It sweeps before it claims');

  await test('A JOB RESCUED THIS PASS CAN BE CLAIMED THIS PASS', async () => {
    /* Otherwise every rescue waits another poll for no reason. Asserted by
     * recording how many sweeps had happened when the claim was made. */
    reset();

    await runner.tick();

    assert.strictEqual(calls.claim.length, 1, 'nothing tried to claim work');
    assert.strictEqual(calls.claim[0].at, 1,
      'work was claimed before the sweep, against a queue about to change');
  });

  await test('a full limiter stops the claim but not the sweep', async () => {
    /* The cap is about how much work runs at once. A job whose owner died is
     * not running — leaving it marked `running` while the limiter is busy is
     * how it would stay stuck through a long queue. */
    reset();

    stubs['./concurrencyLimiter'].generationLimiter.stats.running = 2;

    try {
      await runner.tick();
    } finally {
      stubs['./concurrencyLimiter'].generationLimiter.stats.running = 0;
    }

    assert.strictEqual(calls.updateMany.length, 1, 'a busy limiter also skipped the sweep');
    assert.strictEqual(calls.claim.length, 0, 'the cap was ignored');
  });

  /* ===================================================================== */

  section('It only touches jobs that are genuinely stale');

  await test('THE FILTER IS RUNNING PLUS A QUIET HEARTBEAT', async () => {
    reset();

    await runner.requeueStaleJobs();

    const { filter, update } = calls.updateMany[0];

    assert.strictEqual(filter.status, 'running',
      'the sweep no longer limits itself to jobs claimed by somebody');

    assert.ok(Array.isArray(filter.$or), 'the heartbeat test is gone');

    const olderThan = filter.$or.find(c => c.heartbeatAt && c.heartbeatAt.$lt);
    assert.ok(olderThan, 'nothing tests how long ago the heartbeat was');

    const age = Date.now() - olderThan.heartbeatAt.$lt.getTime();
    assert.ok(age >= 60000,
      `the cutoff is only ${Math.round(age / 1000)}s old — a live job would be requeued under it`);

    assert.ok(filter.$or.some(c => c.heartbeatAt && c.heartbeatAt.$exists === false),
      'a job that died before its first heartbeat is never rescued');

    assert.strictEqual(update.$set.status, 'queued',
      'the sweep marks them something other than queued, so nothing claims them');
  });

  await test('a live job is outside the cutoff', async () => {
    /* The property stated the other way round, because the assertion above is
     * about the shape of a query and this is about what it would match. A
     * heartbeat from five seconds ago must not be inside the window. */
    reset();

    await runner.requeueStaleJobs();

    const cutoff = calls.updateMany[0].filter.$or
      .find(c => c.heartbeatAt && c.heartbeatAt.$lt).heartbeatAt.$lt;

    const beatingFiveSecondsAgo = new Date(Date.now() - 5000);

    assert.ok(beatingFiveSecondsAgo > cutoff,
      'a job that beat five seconds ago would be taken off its own process');
  });

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
