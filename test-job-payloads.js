// test-job-payloads.js
//
// Throwing away the stored wizard form once the site it describes is gone.
//
// WHY THIS EXISTS
//
// Job.payload holds the whole wizard submission — business details, every
// service, every town, hours, social links. It is there because generation is
// a background job: the request stores the form and a worker reads it later,
// and a crashed build resumes from it. Nothing reads it after the job
// completes; that was checked by grep, not assumed.
//
// Edwin, 17 October, having just asked why it was kept for ever:
//
//     "can we delete the payload once a site is deleted either because
//      another site was built or because the 48 hours went by?"
//
// It follows from his other decision the same day — a deleted site is gone
// for good, no rebuild — which is what makes the payload genuinely dead
// rather than a last resort.
//
// THE TWO WAYS A SITE DIES, and the second is the common one:
//
//   1. the 48-hour sweep removes dist/user_<id>
//   2. A NEW BUILD. resetUserDirs() rmSyncs the same folder before writing.
//      One folder per user, so generating again destroys the previous site
//      immediately.
//
// WHAT MUST SURVIVE, and this is the trap: the Job ROW. The dashboard's
// expired card reads kind 'site', status 'completed', finishedAt to tell
// "your website was removed" from "you have never made one". Deleting the
// row would take the card with it and restore the exact message the card was
// built to replace.
//
//   node test-job-payloads.js

const fs = require('fs');
const assert = require('assert');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
const deferred = [];
function testAsync(name, fn) {
  deferred.push(async () => {
    try { await fn(); console.log(`  ok    ${name}`); passed++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
  });
}
function section(n) { console.log(`\n${n}\n`); }

/* Source with comments removed — JS block, JS line, AND HTML.
 *
 * The HTML pass is not decoration. authRoute.js renders markup inside
 * template literals, and the comment explaining why the old label went
 * quotes the old label. Without this the check below matched that
 * quotation and failed on a file that was already correct.
 *
 * Eighth time this project has been bitten by a comment describing the
 * thing it forbids, and the first where the comment was HTML. */
const code = file => fs.readFileSync(require.resolve(file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/* A stand-in for the Job model, so the query can be driven rather than read.
 *
 * What matters here is the SHAPE OF THE FILTER — which jobs it would touch —
 * and a source check cannot tell `status: 'completed'` from
 * `status: { $ne: 'completed' }`. */
function fakeJobModel() {
  const calls = [];

  return {
    calls,
    async updateMany(where, update) {
      calls.push({ where, update });
      return { modifiedCount: 2 };
    },
  };
}

function withFakeJob(fn) {
  const jobPath = require.resolve('./models/Job');
  const modPath = require.resolve('./utils/jobPayloads');
  const saved = require.cache[jobPath];
  const fake = fakeJobModel();

  require.cache[jobPath] = { id: jobPath, filename: jobPath, loaded: true, exports: fake };
  delete require.cache[modPath];

  try {
    return fn(require('./utils/jobPayloads'), fake);
  } finally {
    if (saved) require.cache[jobPath] = saved;
    else delete require.cache[jobPath];
    delete require.cache[modPath];
  }
}

// ---------------------------------------------------------------------------
section('Which jobs it empties');
// ---------------------------------------------------------------------------

testAsync('ONLY COMPLETED SITE JOBS', async function () {
  /* A queued or running job is about to be handed its payload by the worker.
   * Clearing one hands runGeneration an empty form and builds a website out
   * of nothing — a paid-for job turned into rubbish by a housekeeping task.
   *
   * A failed job keeps its payload too: it is the only record of what was
   * attempted, and what a retry would read. */
  await withFakeJob(async (payloads, job) => {
    await payloads.clearForUsers(['u1']);

    const { where } = job.calls[0];

    assert.strictEqual(where.status, 'completed',
      `the filter would touch ${JSON.stringify(where.status)} jobs`);
    assert.strictEqual(where.kind, 'site',
      'the filter is not restricted to site jobs');
    assert.deepStrictEqual(where.user, { $in: ['u1'] });
  });
});

testAsync('it empties the two heavy fields AND NOTHING ELSE', async function () {
  /* The row has to survive. The expired card reads kind, status and
   * finishedAt off it, and the credits history lives there too. */
  await withFakeJob(async (payloads, job) => {
    await payloads.clearForUsers(['u1']);

    assert.deepStrictEqual(job.calls[0].update, { $set: { payload: {}, uploads: {} } });
  });
});

testAsync('AND IT NEVER DELETES THE ROW', async function () {
  /* The trap. Deleting the Job would take the expired card with it and put
   * back "You haven't generated a website yet" for somebody whose site was
   * removed an hour ago. */
  const src = code('./utils/jobPayloads.js');

  assert.ok(!/deleteMany|deleteOne|findOneAndDelete|findByIdAndDelete/.test(src),
    'the payload cleaner deletes Job records, which breaks the expired card');

  await withFakeJob(async (payloads, job) => {
    await payloads.clearForUsers(['u1']);
    assert.strictEqual(typeof job.calls[0].update.$set, 'object');
  });
});

testAsync('already-empty payloads are skipped by the query, not rewritten', async function () {
  /* A sweep over a user who has been here for months should cost one
   * indexed lookup and no writes. */
  await withFakeJob(async (payloads, job) => {
    await payloads.clearForUsers(['u1']);

    assert.deepStrictEqual(job.calls[0].where.payload, { $nin: [null, {}] },
      'the filter rewrites payloads that are already empty');
  });
});

testAsync('a named job is left alone', async function () {
  await withFakeJob(async (payloads, job) => {
    await payloads.clearForUsers(['u1'], { except: 'job-7' });

    assert.deepStrictEqual(job.calls[0].where._id, { $ne: 'job-7' });
  });
});

testAsync('no users means no query at all', async function () {
  await withFakeJob(async (payloads, job) => {
    for (const nothing of [undefined, null, [], ['', null]]) {
      await payloads.clearForUsers(nothing);
    }
    assert.strictEqual(job.calls.length, 0, 'an empty list still hit the database');
  });
});

testAsync('duplicates are collapsed', async function () {
  await withFakeJob(async (payloads, job) => {
    await payloads.clearForUsers(['u1', 'u1', 'u2']);
    assert.deepStrictEqual(job.calls[0].where.user, { $in: ['u1', 'u2'] });
  });
});

testAsync('A DATABASE ERROR DOES NOT TAKE THE CALLER DOWN', async function () {
  /* This runs after the real work: inside the hourly sweep, and just before
   * a generation the customer has paid for. A failed clear leaves a few
   * kilobytes behind and is retried next time that user's site goes.
   * Throwing would cost either the sweep or the build. */
  const jobPath = require.resolve('./models/Job');
  const modPath = require.resolve('./utils/jobPayloads');
  const saved = require.cache[jobPath];

  require.cache[jobPath] = {
    id: jobPath, filename: jobPath, loaded: true,
    exports: { updateMany: async () => { throw new Error('mongo is down'); } },
  };
  delete require.cache[modPath];

  try {
    const payloads = require('./utils/jobPayloads');
    assert.strictEqual(await payloads.clearForUsers(['u1']), 0);
  } finally {
    if (saved) require.cache[jobPath] = saved; else delete require.cache[jobPath];
    delete require.cache[modPath];
  }
});

// ---------------------------------------------------------------------------
section('Turning swept folder names back into owners');
// ---------------------------------------------------------------------------

const { usersFromSwept } = require('./utils/jobPayloads');

test('it reads the id out of a folder name and a zip name', function () {
  assert.deepStrictEqual(
    usersFromSwept(['user_abc123', 'user_def456.zip']),
    ['abc123', 'def456']
  );
});

test('the same owner twice is one owner', function () {
  assert.deepStrictEqual(usersFromSwept(['user_abc', 'user_abc.zip']), ['abc']);
});

test('ANYTHING THAT IS NOT A user_ ENTRY IS DROPPED, NOT GUESSED AT', function () {
  /* The sweeper's patterns and this one are two places that would otherwise
   * have to agree about a filename format. Returning an id for something
   * that is not a user folder would clear a stranger's payload. */
  for (const junk of ['README.md', 'shared-assets', 'user_', 'users_abc', '', null, undefined, 'user_a/b']) {
    assert.deepStrictEqual(usersFromSwept([junk]), [],
      `${JSON.stringify(junk)} was read as a user id`);
  }
});

test('and an empty list is an empty list', function () {
  assert.deepStrictEqual(usersFromSwept(), []);
  assert.deepStrictEqual(usersFromSwept([]), []);
});

// ---------------------------------------------------------------------------
section('THE TWO WAYS A SITE DIES, AND BOTH CLEAR THE FORM');
// ---------------------------------------------------------------------------

const sched = code('./utils/cleanupScheduler.js');

test('the 48-hour sweep clears the payloads of whoever it swept', function () {
  assert.match(sched, /clearForUsers\(usersFromSwept\(/,
    'the sweep deletes the site and leaves its wizard form behind');
});

test('AND ONLY FOR THE DIST FOLDERS, NOT THE ZIPS', function () {
  /* A swept zip is a lost download and a swept work folder is build
   * scratch. Neither means the site has gone, and clearing a payload on
   * either would throw away the form for a website still on disk. */
  const run = sched.slice(sched.indexOf('async function runCleanup'),
                          sched.indexOf('function startCleanupScheduler'));

  assert.match(run, /clearForUsers\(usersFromSwept\(sweptSites\)/,
    'the clear is driven by something other than the swept site folders');
  assert.ok(!/sweptZips\)|sweptWork\)/.test(run.slice(run.indexOf('clearForUsers'))),
    'zips or work folders are being treated as "the site has gone"');
});

test('a new build clears the form of the site it is about to overwrite', function () {
  /* The common case, and the one the 48-hour rule does not cover.
   * resetUserDirs() rmSyncs dist/user_<id> at step 2 of every generation. */
  const gen = code('./utils/jobGenerator.js');

  assert.match(gen, /clearForUsers\(\[job\.user\]/,
    'generating a new site leaves the previous one\'s form behind for ever');
  assert.match(gen, /except: job\._id/,
    'the running job is not excluded, so a rule change could empty the form it is using');
});

test('AND IT HAPPENS BEFORE THE BUILD, NOT AFTER', function () {
  /* Afterwards would miss every build that crashes half way — exactly the
   * ones that leave the most behind. The window it opens is harmless: a
   * build that fails before step 2 leaves the old site with a cleared
   * payload, and that payload would only ever have been read by a resume of
   * the OLD job, which already completed. */
  const gen = code('./utils/jobGenerator.js');

  /* THE CALL, NOT THE IMPORT. Found by mutation: moving the clear to after
   * the build left this passing, because `clearForUsers` appears first in
   * the require line at the top of the file and indexOf found that.
   *
   * `await build(` AND NOT `await runGeneration(`, SINCE 28 OCTOBER.
   *
   * jobGenerator stopped calling one builder by name on that date: it now
   * chooses between runGeneration and runLocalOptions, because Local Website
   * Options builds a fixed eleven pages out of utils/localOptions/ and
   * shares none of runGeneration's page-at-a-time steps.
   *
   * THIS TEST FAILED, AND FAILING WAS CORRECT — "jobGenerator has changed
   * shape" is exactly what had happened, and the message said so. What this
   * test guards did NOT change: the clear still has to run before whatever
   * does the building, for both builders, because both of them wipe
   * dist/user_<id> and neither can give the old payload back.
   *
   * The mutation trap is still live, and still handled: `runLocalOptions`
   * and `runGeneration` BOTH appear in require lines at the top of the file,
   * so matching either name would find the import. `await build(` appears
   * once, at the call. */
  const cleared = gen.indexOf('clearForUsers([job.user]');
  const built = gen.indexOf('await build(');

  assert.ok(cleared > -1 && built > -1, 'jobGenerator has changed shape');
  assert.ok(cleared < built,
    'the clear runs after the build, so a crashed build keeps its old payload for ever');

  /* AND THE BUILDER IS NOT ALSO CALLED BY NAME. If a later edit put
   * `await runGeneration(...)` back alongside the chosen one, the check
   * above would still pass and every job would get the old builder. */
  assert.ok(!/await runGeneration\(/.test(gen),
    'runGeneration is called directly as well, so the choice is decorative');
});

test('the sweep reports WHICH entries it removed, not how many', function () {
  /* A count cannot say whose payload to clear. This is the change that made
   * the whole thing possible, and reverting it to a number would silently
   * stop the clearing while the sweep carried on looking healthy. */
  assert.match(sched, /removed\.push\(entry\.name\)/,
    'sweepDir counts removals instead of naming them');
  assert.ok(!/let removed = 0;/.test(sched),
    'sweepDir is back to returning a count');
});

// ---------------------------------------------------------------------------
section('The card no longer promises a rebuild');
// ---------------------------------------------------------------------------

const auth = code('./routes/authRoute.js');

test('"GENERATE IT AGAIN" IS GONE', function () {
  /* clearDraft() wipes the saved form the moment Generate is pressed, so
   * that link opens an EMPTY wizard. The label described a one-click
   * rebuild that does not exist — and that Edwin decided should not exist. */
  assert.ok(!/Generate it again/.test(auth),
    'the card still offers a rebuild the app cannot do');
  assert.match(auth, /Build a new website/,
    'the expired card has no way forward at all');
});

test('and the card says the site cannot be restored', function () {
  assert.match(auth, /cannot be restored/i,
    'nothing tells them the removal is permanent');
});

(async function () {
  if (deferred.length) section('Driven against a stubbed model');
  for (const run of deferred) await run();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
