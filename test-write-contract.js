// test-write-contract.js
//
// What /api/blog/write promises, before any of it moves.
//
// WHY, AND WHY FIRST
//
// This is the credit gate. It is the only route in the blog API that commits
// money, and the Cloudflare screen needs every rule in it: the cancel path,
// the poll, the lost-batch detection, the gap fill, the refusal when the
// balance is short, and the conditional claim that stops two approvals
// enqueueing two batches.
//
// Those rules are about to move into a function the screen can also call.
// The planner moved the same way last week and the lesson from that is the
// reason this file exists first: NOTHING TESTED THAT HANDLER EITHER.
// test-blog-plan.js covered the planner it called, not the handler. The same
// is true here — checked, not assumed.
//
// WHAT BREAKING IT LOOKS LIKE
//
// wp-admin polls this route every few seconds while the spinner turns and
// reads about ten fields off the answer: the status it branches on, the
// done/total the progress bar draws, the quote it prints, the buyCreditsUrl
// it sends people to when the balance is short. Drop one in the move and the
// screen shows a frozen bar, or a dead end, and says nothing.
//
// AND THE MONEY IS REAL. A mistake here does not show the wrong margin — it
// starts a batch that cannot finish, or charges for one that was already
// written.
//
// So this pins the CURRENT behaviour, passing against the handler untouched.
//
//   node test-write-contract.js

const assert = require('assert');

const router = require('./routes/blogApiRoute');
const BlogCampaign = require('./models/BlogCampaign');
const User = require('./models/User');
const Job = require('./models/Job');

let passed = 0, failed = 0;

/** Tests and headings together, so the output reads in order. */
const queue = [];

function test(name, fn) {
  queue.push(() => fn()
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }));
}
function section(n) { queue.push(async () => console.log(`\n${n}\n`)); }

/* ------------------------------------------------------------------------
 * The real handler, off the real router
 * --------------------------------------------------------------------- */

function handlerFor(path) {
  const layer = router.stack.find(l => l.route && l.route.path === path);
  assert.ok(layer, `${path} is not on the router any more`);

  const stack = layer.route.stack;
  return stack[stack.length - 1].handle;   // past the limiter and requireSite
}

const write = handlerFor('/api/blog/write');

/* ------------------------------------------------------------------------
 * Just enough database
 * --------------------------------------------------------------------- */

const SITE_ID = '507f1f77bcf86cd799439011';
const USER_ID = '507f1f77bcf86cd799439022';
const CAMPAIGN_ID = '507f1f77bcf86cd799439033';
const JOB_ID = '507f1f77bcf86cd799439044';

let db;

function slot(index, status, extra = {}) {
  return Object.assign({ index, status, topic: `Topic ${index}` }, extra);
}

function install(over = {}) {
  db = Object.assign({
    campaign: {
      _id: CAMPAIGN_ID,
      site: SITE_ID,
      user: USER_ID,
      status: 'draft',
      slots: [slot(0, 'pending'), slot(1, 'pending'), slot(2, 'pending')],
      batch: {},
    },
    job: null,
    credits: 100000,
    reopened: [],
    created: null,
    deleted: [],
    updates: [],
    claimFails: false,
  }, over);

  BlogCampaign.findById = async (id) =>
    (String(id) === CAMPAIGN_ID ? JSON.parse(JSON.stringify(db.campaign)) : null);

  /* Reopening actually reopens. The first version of this stub only recorded
   * the call, so every gap-fill test fell through to "nothing left to write"
   * and the assertion about the job never ran. */
  BlogCampaign.reopenSlot = async (id, index) => {
    db.reopened.push(index);
    const s = db.campaign.slots.find(x => x.index === index);
    if (s && 'failed' === s.status) s.status = 'pending';
  };

  BlogCampaign.updateOne = async (where, update) => {
    db.updates.push({ where, update });
    return { modifiedCount: 1 };
  };

  BlogCampaign.findOneAndUpdate = async (where, update, opts) => {
    /* THE CONDITIONAL CLAIM. Two approvals arriving together must not both
     * enqueue a batch: the filter says "only if not already writing", and
     * the loser gets null. */
    db.claimWhere = where;
    if (db.claimFails) return null;
    return Object.assign({}, db.campaign, { status: 'writing' });
  };

  Job.create = async (doc) => { db.created = doc; return Object.assign({ _id: JOB_ID }, doc); };

  /* .lean(), not a bare promise. The handler reads the job with
   * `Job.findById(id).lean()`, so a stub that resolves to the document
   * directly throws inside the try and every poll test comes back 500 —
   * which is what the first run of this file did. */
  Job.findById = (id) => ({ lean: async () => (db.job && String(id) === String(db.job._id) ? db.job : null) });
  Job.deleteOne = async (where) => { db.deleted.push(String(where._id)); return { deletedCount: 1 }; };

  User.findById = () => ({ lean: async () => ({ _id: USER_ID, credits: db.credits }) });
}

function req(body = {}) {
  return {
    id: 'req-write',
    site: { _id: SITE_ID, user: USER_ID },
    protocol: 'https',
    get: () => 'threecomets.com',
    headers: { host: 'threecomets.com' },
    body: Object.assign({ campaignId: CAMPAIGN_ID }, body),
  };
}

async function run(body = {}) {
  const out = { status: 200, json: null };

  const res = {
    status(code) { out.status = code; return this; },
    json(payload) { out.json = payload; return this; },
  };

  await write(req(body), res);
  return out;
}

/* ======================================================================= */

section('THE CREDIT GATE');

test('A CAMPAIGN NOBODY CAN AFFORD IS REFUSED, NOT STARTED', async () => {
  /* The difference between this design and the one before it. A batch
   * allowed to start underfunded writes four posts, stops, and leaves a ring
   * with a hole in it that the customer paid for. */
  install({ credits: 1 });

  const { status, json } = await run();

  assert.strictEqual(status, 402);
  assert.strictEqual(json.creditsError, true);
  assert.ok(json.quote && json.quote.total > 0, 'the refusal does not say what it would cost');
  assert.strictEqual(json.creditsAvailable, 1);
  assert.strictEqual(db.created, null, 'a job was queued for a campaign nobody can afford');
});

test('and it says where to fix it', async () => {
  /* The most common wall a self-serve customer hits. They are standing in
   * wp-admin on their own site, and nothing on that screen says the balance
   * lives somewhere else — let alone where. */
  install({ credits: 1 });

  const { json } = await run();

  assert.ok(/^https?:\/\/.+\/buy-credits$/.test(String(json.buyCreditsUrl)),
    `the refusal is a dead end: ${json.buyCreditsUrl}`);
});

test('a campaign that can be afforded is queued', async () => {
  install();

  const { status, json } = await run();

  assert.strictEqual(status, 200);
  assert.strictEqual(json.status, 'writing');
  assert.strictEqual(json.jobId, JOB_ID);
  assert.strictEqual(json.toWrite, 3);
  assert.strictEqual(json.total, 3);
  assert.strictEqual(json.done, 0);
  assert.ok(json.quote.total > 0);
});

test('THE JOB CARRIES THE SCOPE, NOT THE NUMBER LEFT', async () => {
  /* writeCampaign seeds `done` with what is already written, so a
   * re-approval of a half-written campaign reports 9 of 12 rather than 0 of
   * 3. If total were the remainder, the first response and every poll after
   * it would disagree about the denominator and the bar would jump. */
  install({
    campaign: {
      _id: CAMPAIGN_ID, site: SITE_ID, user: USER_ID, status: 'draft', batch: {},
      slots: [slot(0, 'ready'), slot(1, 'ready'), slot(2, 'pending')],
    },
  });

  const { json } = await run();

  assert.strictEqual(db.created.progress.total, 3, 'the job counts only what is left');
  assert.strictEqual(json.total, 3);
  assert.strictEqual(json.toWrite, 1, 'the answer does not say what this run will charge for');
});

section('TWO APPROVALS CANNOT BOTH START A BATCH');

test('the claim is conditional on not already writing', async () => {
  install();
  await run();

  assert.ok(db.claimWhere, 'the campaign is claimed unconditionally');
  assert.deepStrictEqual(db.claimWhere.status, { $ne: 'writing' },
    'the claim does not exclude a campaign that is already writing');
});

test('AND THE LOSER DELETES ITS JOB', async () => {
  /* Otherwise an orphaned queued job sits in the collection for ever, and
   * the runner may pick it up and write the campaign twice. */
  install({ claimFails: true });

  const { status, json } = await run();

  assert.strictEqual(status, 200);
  assert.strictEqual(json.status, 'writing', 'the loser reports something other than the winner\'s state');
  assert.deepStrictEqual(db.deleted, [JOB_ID], 'the losing job was left behind');
});

section('POLLING THE SAME ROUTE');

test('a campaign already writing reports progress rather than starting again', async () => {
  install({
    campaign: {
      _id: CAMPAIGN_ID, site: SITE_ID, user: USER_ID, status: 'writing',
      batch: { job: JOB_ID },
      slots: [slot(0, 'pending'), slot(1, 'pending')],
    },
    job: { _id: JOB_ID, status: 'running', progress: { done: 1, total: 2, stage: 'writing', current: 'Topic 1' } },
  });

  const { status, json } = await run();

  assert.strictEqual(status, 200);
  assert.strictEqual(json.status, 'writing');
  assert.strictEqual(json.done, 1);
  assert.strictEqual(json.total, 2);
  assert.strictEqual(json.stage, 'writing');
  assert.strictEqual(json.current, 'Topic 1');
  assert.strictEqual(db.created, null, 'polling queued a second job');
});

test('AND IT SAYS WHEN A PAUSE HAS BEEN HEARD', async () => {
  /* Without this the plugin shows an unchanged bar for as long as the post
   * in flight takes to finish — which is exactly the minute in which
   * somebody decides Pause does not work and presses it again. */
  install({
    campaign: {
      _id: CAMPAIGN_ID, site: SITE_ID, user: USER_ID, status: 'writing',
      batch: { job: JOB_ID, cancelRequested: true },
      slots: [slot(0, 'pending')],
    },
    job: { _id: JOB_ID, status: 'running', progress: { done: 0, total: 1 } },
  });

  const { json } = await run();

  assert.strictEqual(json.cancelling, true, 'a requested pause is invisible to the spinner');
});

test('A BATCH WHOSE JOB IS GONE IS REPORTED AS FAILED, NOT AS RUNNING', async () => {
  /* The silent one. A campaign left in 'writing' with no live job behind it
   * polls for ever and the bar never moves. */
  install({
    campaign: {
      _id: CAMPAIGN_ID, site: SITE_ID, user: USER_ID, status: 'writing',
      batch: { job: JOB_ID },
      slots: [slot(0, 'pending')],
    },
    job: null,
  });

  const { status, json } = await run();

  assert.strictEqual(status, 409);
  assert.strictEqual(json.status, 'failed');
  assert.ok(json.error, 'nothing tells the owner what to do about it');

  /* AND THE CAMPAIGN IS PUT BACK TO DRAFT. The error says "approve the
   * campaign again to restart it" — which is a lie unless this happens.
   * Left in 'writing' the next approval walks straight back into the branch
   * above and the campaign is stuck for good, with the owner pressing a
   * button that can never work. A mutation that changed 'draft' to
   * 'writing' passed the three assertions above. */
  const set = db.updates.map(u => u.update.$set || {});
  assert.ok(set.some(s => 'draft' === s.status),
    'the dead campaign was never released, so approving it again cannot help');
});

test("THE JOB'S OWN TOTAL WINS, AND THE CAMPAIGN IS ONLY THE FALLBACK", async () => {
  /* Two numbers could draw this bar and they disagree whenever the run is a
   * gap fill: the scope the job was given, and the length of the whole
   * campaign. The job's wins. The campaign length is for a job claimed but
   * not yet started, which has no progress at all — without it the bar
   * reads "0 of undefined".
   *
   * Pinned with seven slots and a scope of two so reading the number off
   * the wrong object cannot look right by accident. */
  install({
    campaign: {
      _id: CAMPAIGN_ID, site: SITE_ID, user: USER_ID, status: 'writing',
      batch: { job: JOB_ID },
      slots: [slot(0, 'pending'), slot(1, 'pending'), slot(2, 'pending'),
              slot(3, 'pending'), slot(4, 'pending'), slot(5, 'pending'), slot(6, 'pending')],
    },
    job: { _id: JOB_ID, status: 'queued', progress: { total: 2, done: 0 } },
  });

  const { json } = await run();

  assert.strictEqual(json.total, 2,
    'the poll reports the campaign length instead of the scope the job was given');

  db.job = { _id: JOB_ID, status: 'queued' };   // claimed, nothing recorded yet

  const bare = await run();

  assert.strictEqual(bare.json.total, 7, 'a job with no progress yet leaves the bar with no denominator');
  assert.strictEqual(bare.json.done, 0);
  assert.strictEqual(bare.json.stage, 'queued');
  assert.strictEqual(bare.json.current, '');
});

section('PAUSE RIDES ON THE POLL');

test('A CANCEL IS RECORDED AND THE POLL STILL ANSWERS', async () => {
  /* No new endpoint, deliberately. The plugin polls this route every few
   * seconds for as long as the spinner turns, so a paused campaign
   * re-asserts the cancel on every poll instead of losing it to one failed
   * request — which is how eleven posts and 825 credits were written after
   * Pause was pressed.
   *
   * And it must still ANSWER. A cancel that returned nothing would leave the
   * spinner unable to say whether it had been heard. */
  install({
    campaign: {
      _id: CAMPAIGN_ID, site: SITE_ID, user: USER_ID, status: 'writing',
      batch: { job: JOB_ID },
      slots: [slot(0, 'pending'), slot(1, 'pending')],
    },
    job: { _id: JOB_ID, status: 'running', progress: { done: 1, total: 2, stage: 'writing' } },
  });

  const { status, json } = await run({ cancel: true });

  const set = db.updates.map(u => u.update.$set || {});
  assert.ok(set.some(s => true === s['batch.cancelRequested']),
    'the cancel was never recorded, so the batch runs to the end');

  assert.strictEqual(status, 200, 'the cancel answered nothing the spinner could read');
  assert.strictEqual(json.status, 'writing');
  assert.strictEqual(json.done, 1, 'the cancel swallowed the progress it was riding on');
});

test('the string "true" counts, because it arrives over HTTP', async () => {
  install({
    campaign: {
      _id: CAMPAIGN_ID, site: SITE_ID, user: USER_ID, status: 'writing',
      batch: { job: JOB_ID }, slots: [slot(0, 'pending')],
    },
    job: { _id: JOB_ID, status: 'running', progress: { done: 0, total: 1 } },
  });

  await run({ cancel: 'true' });

  assert.ok(db.updates.length, 'a cancel sent as a form field was ignored');
});

test('AND A CANCEL ON A CAMPAIGN THAT IS NOT WRITING IS IGNORED', async () => {
  /* Set at any other moment the flag would sit there and cancel the NEXT
   * batch — a pause pressed today stopping a campaign approved next week. */
  install();   // status: 'draft'

  await run({ cancel: true });

  assert.deepStrictEqual(db.updates, [],
    'a cancel was stored on a draft and will kill the next batch');
  assert.ok(db.created, 'the fall-through stopped: the campaign never started');
});

section('WHEN THERE IS NOTHING LEFT TO WRITE');

test('a finished campaign answers written, with a terminal shape', async () => {
  /* Nothing to do is a success, not an error: the plugin polls this and
   * needs an answer it can stop on. */
  install({
    campaign: {
      _id: CAMPAIGN_ID, site: SITE_ID, user: USER_ID, status: 'draft', batch: {},
      slots: [slot(0, 'ready'), slot(1, 'scheduled'), slot(2, 'failed')],
    },
  });

  const { status, json } = await run();

  assert.strictEqual(status, 200);
  assert.strictEqual(json.status, 'written');
  assert.strictEqual(json.written, 2, 'ready and scheduled are not both counted as written');
  assert.deepStrictEqual(json.failed, [2], 'the failed slots are not named');
  assert.strictEqual(json.readyToCollect, 1);
  assert.strictEqual(json.total, 3);
  assert.strictEqual(db.created, null, 'a job was queued for a campaign with nothing to write');
});

section('THE GAP FILL');

test('NAMED SLOTS ARE REOPENED, AND ONLY THE NAMED ONES', async () => {
  /* A failed slot stays failed unless somebody asks for it by number.
   * Reopening is explicit so that "write the campaign" can never quietly
   * retry something the customer was told had failed. */
  install({
    campaign: {
      _id: CAMPAIGN_ID, site: SITE_ID, user: USER_ID, status: 'draft', batch: {},
      slots: [slot(0, 'ready'), slot(1, 'failed'), slot(2, 'failed')],
    },
  });

  const { json } = await run({ slotIndexes: [1] });

  assert.deepStrictEqual(db.reopened, [1], 'the wrong slots were reopened');
  assert.deepStrictEqual(db.created.payload.slotIndexes, [1],
    'the job does not record which slots it was asked for');

  /* AND THE SCOPE IS THE DENOMINATOR. A gap fill of one slot in a campaign
   * of three is "0 of 1", not "0 of 3": the bar belongs to this run. A
   * mutation that dropped the scope filter and counted every slot passed
   * both assertions above, because the number of slots to WRITE happened to
   * be the same either way. */
  assert.strictEqual(json.total, 1, 'the gap fill draws its bar against the whole campaign');
  assert.strictEqual(db.created.progress.total, 1, 'the job was given the whole campaign as its scope');
});

test('and junk in the slot list is dropped rather than guessed at', async () => {
  install({
    campaign: {
      _id: CAMPAIGN_ID, site: SITE_ID, user: USER_ID, status: 'draft', batch: {},
      slots: [slot(0, 'failed'), slot(1, 'failed')],
    },
  });

  await run({ slotIndexes: ['x', 1.5, 2.7, undefined, {}] });

  assert.deepStrictEqual(db.reopened, [], 'a non-integer slot index reached reopenSlot');
});

test('AND NOTHING THAT IS NOT A NUMBER IS READ AS SLOT ZERO', async () => {
  /* THE BUG THIS TEST WAS WRITTEN TO PIN, AND NOW GUARDS AGAINST.
   *
   * The filter used to be `.map(Number).filter(Number.isInteger)`, and
   * Number(null) is 0, Number(false) is 0, Number('') is 0, Number('  ') is
   * 0 and Number([]) is 0. Every one of them survived the filter and
   * reopened slot 0 — a slot nobody named — which was then rewritten and
   * charged for.
   *
   * That is precisely what the branch exists to prevent: reopening a failed
   * slot is explicit, so that "write the campaign" can never quietly retry
   * something the customer was told had failed.
   *
   * Each value gets its own run rather than sharing one array, because one
   * array would still pass with six of the seven fixed and the last not. */
  /* The strings that LOOK numeric are the ones that matter. A loose test
   * like /\d/ lets '3px' through, Number('3px') is NaN, and NaN is neither
   * null nor an integer — so it sails past a null check and reaches
   * reopenSlot. A mutation that loosened the pattern survived the first
   * version of this list, which had no such string in it. */
  for (const junk of [null, false, true, '', '   ', [], {},
                      '1a', '3px', 'slot 2', '1.5', '0x1', '1e3', '+1', '١']) {
    install({
      campaign: {
        _id: CAMPAIGN_ID, site: SITE_ID, user: USER_ID, status: 'draft', batch: {},
        slots: [slot(0, 'failed'), slot(1, 'failed')],
      },
    });

    await run({ slotIndexes: [junk] });

    assert.deepStrictEqual(db.reopened, [],
      `${JSON.stringify(junk)} was read as a slot number and reopened slot 0`);
  }
});

test('while a slot named as a string still counts, because HTTP has no numbers', async () => {
  /* wp-admin sends this as JSON over an HTTP call, and a field is a string
   * whether it holds a number or not. "1" is somebody naming slot one, and
   * tightening the filter must not take that away. */
  install({
    campaign: {
      _id: CAMPAIGN_ID, site: SITE_ID, user: USER_ID, status: 'draft', batch: {},
      slots: [slot(0, 'failed'), slot(1, 'failed'), slot(2, 'failed')],
    },
  });

  await run({ slotIndexes: ['1', ' 2 '] });

  assert.deepStrictEqual(db.reopened, [1, 2], 'a slot named as a string was dropped');
  assert.deepStrictEqual(db.created.payload.slotIndexes, [1, 2],
    'the job was handed strings where the runner expects numbers');
});

section('OWNERSHIP AND STATE');

test('A CAMPAIGN BELONGING TO ANOTHER SITE IS NOT FOUND', async () => {
  install();
  db.campaign.site = '507f1f77bcf86cd799439099';

  const { status, json } = await run();

  assert.strictEqual(status, 404);
  assert.ok(json.error);
  assert.strictEqual(db.created, null);
});

test('a junk campaign id never reaches the database', async () => {
  install();
  let asked = false;
  BlogCampaign.findById = async () => { asked = true; return null; };

  const { status } = await run({ campaignId: 'not-an-id' });

  assert.strictEqual(status, 404);
  assert.ok(!asked, 'a malformed id was sent to Mongo');
});

test('and a cancelled campaign cannot be restarted', async () => {
  install();
  db.campaign.status = 'cancelled';

  const { status, json } = await run();

  assert.strictEqual(status, 409);
  assert.strictEqual(json.status, 'cancelled');
  assert.strictEqual(db.created, null);
});

/* ======================================================================= */

(async () => {
  for (const run of queue) await run();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
