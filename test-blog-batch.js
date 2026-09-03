// test-blog-batch.js
//
// The write-ahead batch: one job writing a whole campaign.
//
//   MONGO_URI=... node test-blog-batch.js
//
// NEEDS A DATABASE. Everything here turns on conditional updates — charge
// once, claim once, stop cleanly — and a mock of Mongo would only prove that
// the mock agrees with itself. It creates its own throwaway user, site and
// campaigns, and deletes them at the end.
//
// THE MODEL IS STUBBED, NOTHING ELSE IS.
//
// writePost() is the one function here that calls OpenAI. It is replaced
// through the require cache before blogGenerator loads, which keeps the stub
// out of the shipped code — an env var that silently swaps real posts for fake
// ones is one typo away from charging a customer 900 credits for twelve pages
// of filler.
//
// Everything else is the real thing: the real claim, the real charge, the real
// BlogPost writes, the real quality check, the real link repair.

const assert = require('assert');
const mongoose = require('mongoose');

if (!process.env.MONGO_URI) {
  console.log('\ntest-blog-batch: set MONGO_URI to run this.\n');
  process.exit(0);
}

/* -------------------------------------------------------------------------
 * The stub, installed before anything requires the real one
 * ---------------------------------------------------------------------- */

const writePostPath = require.resolve('./utils/blog/writePost');
const realWritePost = require(writePostPath);

// How the next writes should behave. Set per test.
//
// These are read INSIDE the stub, at call time, and that is deliberate.
// blogGenerator destructures writePost at module load, so it holds a reference
// to whatever function was in the cache at that moment — swapping the cache
// entry later changes nothing. The stub has to be one stable function whose
// behaviour is steered from outside.
let failOn = new Set();          // slot indexes whose write always throws
let failOnce = new Set();        // slot indexes that throw once, then succeed
let identicalOpenings = false;   // make every post start the same way
const writeCalls = [];           // every slot the model was asked for

/**
 * A post carrying every token the slot demands.
 *
 * checkPost() verifies the anchors appear VERBATIM inside their wrappers, so
 * the stub has to emit them exactly — a stub that skipped them would make
 * every post in these tests fail its quality check for the wrong reason.
 */
function fakeWritePost(slot) {
  writeCalls.push(slot.index);

  if (failOn.has(slot.index)) {
    throw new Error(`stub: refusing to write slot ${slot.index}`);
  }

  // Transient: fails the first attempt, succeeds on the retry.
  if (failOnce.has(slot.index)) {
    failOnce.delete(slot.index);
    throw new Error(`stub: transient failure on slot ${slot.index}`);
  }

  const opening = identicalOpenings
    ? 'Every one of these posts opens with exactly the same sentence, which is the thing crossCheck exists to notice.'
    : `Slot ${slot.index} opens on its own terms, with a detail specific to this topic and no other.`;

  const sections = [
    { heading: null, paragraphs: [opening] },
    {
      heading: 'What usually goes wrong',
      paragraphs: [
        `Sediment and age account for most of it, and past a certain point a {{money}}${slot.money.anchor}{{/money}} is the practical next step.`,
      ],
    },
  ];

  if (slot.prevAnchor) {
    sections.push({
      heading: 'Earlier',
      paragraphs: [`We went through {{prev}}${slot.prevAnchor}{{/prev}} already, and the same checks apply.`],
    });
  }

  if (slot.nextAnchor) {
    sections.push({
      heading: 'Worth knowing',
      paragraphs: [`This is where people start weighing up {{next}}${slot.nextAnchor}{{/next}} instead.`],
    });
  }

  return Promise.resolve({
    title: `Post ${slot.index}: ${slot.topic}`,
    metaDescription: `A short description for slot ${slot.index}, under the limit.`,
    sections,
  });
}

require.cache[writePostPath] = {
  id: writePostPath,
  filename: writePostPath,
  loaded: true,
  exports: { ...realWritePost, writePost: fakeWritePost },
};

/* -------------------------------------------------------------------------
 * Now the real modules, which will pick up the stub
 * ---------------------------------------------------------------------- */

const User = require('./models/User');
const Job = require('./models/Job');
const BlogSite = require('./models/BlogSite');
const BlogCampaign = require('./models/BlogCampaign');
const BlogPost = require('./models/BlogPost');
const { writeCampaign } = require('./utils/blogGenerator');
const { CREDITS_PER_POST } = require('./utils/blogPricing');

let passed = 0, failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

const TOPICS = [
  'why a water heater rumbles',
  'how long a water heater lasts',
  'what a thermal expansion tank does',
  'when a pilot light keeps going out',
  'signs a tank is about to leak',
];

/** The same progress handler jobRunner gives a generator. */
function progressWriter(job) {
  return async function onProgress({ done, total, current, stage, completedPage, skippedPage }) {
    const set = {};
    if (typeof done === 'number') set['progress.done'] = done;
    if (typeof total === 'number') set['progress.total'] = total;
    if (current !== undefined) set['progress.current'] = current;
    if (stage !== undefined) set['progress.stage'] = stage;

    const update = { $set: set };
    if (completedPage) update.$addToSet = { completedPages: completedPage };
    if (skippedPage) update.$push = { skippedPages: skippedPage };

    await Job.updateOne({ _id: job._id }, update);
  };
}

(async () => {

await mongoose.connect(process.env.MONGO_URI);

const made = { users: [], sites: [], campaigns: [], jobs: [] };

async function seed({ credits = 10000, slots = 5, status = 'draft' } = {}) {
  const user = await User.create({
    email: `batch-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.invalid`,
    password: 'x'.repeat(60),
    credits,
  });
  made.users.push(user._id);

  const site = await BlogSite.create({
    user: user._id,
    licenceKeyHash: require('crypto').randomBytes(32).toString('hex'),
    secret: require('crypto').randomBytes(32).toString('hex'),
    siteUrl: 'example.invalid',
    status: 'active',
    business: { name: 'Hill Country Plumbing', type: 'plumber', location: 'Leander, TX' },
  });
  made.sites.push(site._id);

  const campaign = await BlogCampaign.create({
    user: user._id,
    site: site._id,
    name: 'batch test',
    targetPage: {
      url: 'https://example.invalid/water-heater-repair.html',
      keyword: 'water heater repair',
      intent: 'Someone whose water heater has stopped working.',
    },
    status,
    slots: TOPICS.slice(0, slots).map((topic, i) => ({
      index: i,
      topic,
      targetQuery: topic,
      linkPhrase: topic,
      slug: `post-${i}`,
      moneyAnchor: 'water heater repair',
      anchorType: 'semantic',
      status: 'pending',
      publishAt: new Date(Date.now() + (i + 1) * 7 * 86400000),
    })),
  });
  made.campaigns.push(campaign._id);

  const job = await Job.create({
    user: user._id,
    kind: 'blog',
    status: 'running',
    payload: { campaignId: String(campaign._id) },
    progress: { total: slots, done: 0, stage: 'queued', current: '' },
  });
  made.jobs.push(job._id);

  return { user, site, campaign, job };
}

function reset() {
  failOn = new Set();
  failOnce = new Set();
  identicalOpenings = false;
  writeCalls.length = 0;
}

/* ====================================================================== */

console.log('\nThe happy path');

await test('writes every slot and charges exactly once per post', async () => {
  reset();
  const { user, campaign, job } = await seed({ slots: 5, credits: 10000 });

  const out = await writeCampaign(job, { onProgress: progressWriter(job) });

  assert.strictEqual(out.result.written.length, 5, 'not every slot was written');
  assert.strictEqual(out.creditsCharged, 5 * CREDITS_PER_POST);

  const after = await User.findById(user._id);
  assert.strictEqual(after.credits, 10000 - 5 * CREDITS_PER_POST,
    'the balance does not match what was reported as charged');

  const saved = await BlogCampaign.findById(campaign._id);
  assert.ok(saved.slots.every(s => s.status === 'ready'), 'some slot is not ready');
  assert.ok(saved.slots.every(s => s.chargedAt), 'a slot was written without being charged');
  assert.strictEqual(saved.status, 'active');
  assert.strictEqual(saved.batch.written, 5);
});

await test('one BlogPost per slot, with its tokens still intact', async () => {
  reset();
  const { campaign, job } = await seed({ slots: 3 });
  await writeCampaign(job, { onProgress: progressWriter(job) });

  const posts = await BlogPost.forCampaign(campaign._id);
  assert.strictEqual(posts.length, 3);
  assert.deepStrictEqual(posts.map(p => p.slotIndex), [0, 1, 2]);

  const text = posts[0].sections.flatMap(s => s.paragraphs).join('\n');
  assert.ok(/\{\{money\}\}water heater repair\{\{\/money\}\}/.test(text),
    'the money token was rendered away — the plugin can no longer link it, and ' +
    'the server must never ship finished HTML');
  assert.ok(!/<a /.test(text), 'the payload contains markup it should not');
});

await test('forward links are placeholders, because nothing is live yet', async () => {
  reset();
  const { campaign, job } = await seed({ slots: 3 });
  await writeCampaign(job, { onProgress: progressWriter(job) });

  const first = await BlogPost.forSlot(campaign._id, 0);

  assert.ok(first.targets.money.url, 'the money link must always be real');
  assert.ok(first.targets.next.pending_id,
    'slot 0 links forward to a post that is scheduled but not public — that has ' +
    'to be a placeholder, not an <a> to a URL that 404s for a week');
  assert.strictEqual(first.targets.next.pending_id, 'slot-1');
});

console.log('\nCharging, and not charging twice');

await test('a requeued job writes nothing again and charges nothing again', async () => {
  reset();
  const { user, campaign, job } = await seed({ slots: 4, credits: 10000 });

  await writeCampaign(job, { onProgress: progressWriter(job) });
  const midway = await User.findById(user._id);

  writeCalls.length = 0;
  const second = await writeCampaign(job, { onProgress: progressWriter(job) });

  assert.strictEqual(writeCalls.length, 0,
    'the model was called again for slots that were already written');
  assert.strictEqual(second.creditsCharged, 0);

  const after = await User.findById(user._id);
  assert.strictEqual(after.credits, midway.credits, 'the customer was charged twice');

  const saved = await BlogCampaign.findById(campaign._id);
  assert.strictEqual(saved.slots.filter(s => s.chargedAt).length, 4);
});

await test('a batch that runs out of credits stops where it stands', async () => {
  reset();
  // Enough for two posts and change, on a five-post campaign.
  const credits = CREDITS_PER_POST * 2 + 10;
  const { user, campaign, job } = await seed({ slots: 5, credits });

  const out = await writeCampaign(job, { onProgress: progressWriter(job) });

  assert.strictEqual(out.result.written.length, 2, `expected 2 written, got ${out.result.written.length}`);
  assert.strictEqual(out.result.stoppedForCredits, true);

  const after = await User.findById(user._id);
  assert.strictEqual(after.credits, 10, 'the balance went somewhere unexpected');
  assert.ok(after.credits >= 0, 'the balance went negative');

  // It must stop, not grind through the rest failing the same check.
  assert.strictEqual(writeCalls.length, 2,
    `the model was called ${writeCalls.length} times after the credits ran out at 2`);

  const saved = await BlogCampaign.findById(campaign._id);
  assert.strictEqual(saved.status, 'active', 'two paid-for posts must still be publishable');
  assert.strictEqual(saved.slots.filter(s => s.status === 'ready').length, 2);
  assert.strictEqual(saved.slots.filter(s => s.status === 'pending').length, 3);
});

await test('a campaign that could not afford a single post fails the job', async () => {
  reset();
  const { job } = await seed({ slots: 3, credits: 10 });

  await assert.rejects(
    () => writeCampaign(job, { onProgress: progressWriter(job) }),
    /Not enough credits/,
    'a batch that wrote nothing should fail loudly, not report success with zero posts'
  );

  const saved = await BlogCampaign.findById(made.campaigns[made.campaigns.length - 1]);
  assert.strictEqual(saved.status, 'draft',
    'a campaign that wrote nothing must go back to draft, not sit in writing forever');
});

console.log('\nWhen a post fails');

await test('one failed slot does not take the batch with it', async () => {
  reset();
  failOn = new Set([2]);

  const { campaign, job } = await seed({ slots: 5 });
  const out = await writeCampaign(job, { onProgress: progressWriter(job) });

  assert.strictEqual(out.result.written.length, 4);
  assert.deepStrictEqual(out.result.failed, [2]);

  const saved = await BlogCampaign.findById(campaign._id);
  assert.strictEqual(saved.status, 'active');
  assert.strictEqual(saved.batch.failed, 1);
});

await test('a failed slot is left failed, not pending', async () => {
  reset();
  failOn = new Set([1]);

  const { campaign, job } = await seed({ slots: 3 });
  await writeCampaign(job, { onProgress: progressWriter(job) });

  const saved = await BlogCampaign.findById(campaign._id);
  assert.strictEqual(saved.slots[1].status, 'failed',
    'a pending slot after the batch is waiting for a weekly run that no longer exists');
  assert.ok(saved.slots[1].error, 'the reason was not recorded');
});

await test('reopenSlot gives up once a slot has burned through its attempts', async () => {
  reset();
  failOn = new Set([0]);

  const { campaign, job } = await seed({ slots: 2 });
  await writeCampaign(job, { onProgress: progressWriter(job) });

  // One claim so far, so a low cap is already spent.
  assert.strictEqual(await BlogCampaign.reopenSlot(campaign._id, 0, 1), null,
    'a topic the model keeps refusing must stop costing API calls');
  assert.ok(await BlogCampaign.reopenSlot(campaign._id, 0, 3));
});

await test('a failed slot is reported on the job, the way skipped pages are', async () => {
  reset();
  failOn = new Set([1]);

  const { job } = await seed({ slots: 3 });
  await writeCampaign(job, { onProgress: progressWriter(job) });

  const saved = await Job.findById(job._id);
  assert.strictEqual(saved.skippedPages.length, 1,
    'nothing tells the customer which post is missing');
  assert.ok(saved.skippedPages[0].reason, 'the skipped entry carries no reason');
});

await test('a failed slot leaves no dangling placeholder in its neighbour', async () => {
  reset();
  failOn = new Set([2]);

  const { campaign, job } = await seed({ slots: 5 });
  await writeCampaign(job, { onProgress: progressWriter(job) });

  // Slot 1 was written BEFORE slot 2 was attempted, so at the time it was
  // written its forward link pointed at slot 2 as a placeholder.
  const before = await BlogPost.forSlot(campaign._id, 1);
  assert.ok(before, 'slot 1 should have been written');
  assert.strictEqual(before.targets.next, undefined,
    'slot 1 still points forward at a post that will never exist — that becomes ' +
    'a span in a published post that nothing can ever activate');

  assert.ok(!(before.pending || []).some(p => Number(p.slotIndex) === 2),
    'slot 1 is still waiting on slot 2');

  // Slot 3 points BACK at slot 2 and must be cleared too.
  const after = await BlogPost.forSlot(campaign._id, 3);
  assert.strictEqual(after.targets.prev, undefined,
    'slot 3 still points back at the slot that failed');

  // The money link is untouched by any of this.
  assert.ok(before.targets.money.url, 'the repair removed the money link');
});

await test('a transient failure is retried inside the run, not given up on', async () => {
  reset();
  failOnce = new Set([1]);

  const { campaign, job } = await seed({ slots: 3 });
  const out = await writeCampaign(job, { onProgress: progressWriter(job) });

  assert.strictEqual(out.result.failed.length, 0,
    'a failure that would have succeeded on a second try cost the customer a post');
  assert.strictEqual(out.result.written.length, 3);

  // Four calls for three slots: slot 1 was asked for twice.
  assert.strictEqual(writeCalls.length, 4, `expected 4 model calls, got ${writeCalls.length}`);

  const saved = await BlogCampaign.findById(campaign._id);
  assert.strictEqual(saved.slots[1].status, 'ready');
  assert.strictEqual(saved.slots.filter(s => s.chargedAt).length, 3,
    'the retried slot was charged twice');
});

console.log('\nThe set as a whole');

await test('crossCheck runs across the batch and is stored on the campaign', async () => {
  reset();
  identicalOpenings = true;

  const { campaign, job } = await seed({ slots: 4 });
  const out = await writeCampaign(job, { onProgress: progressWriter(job) });

  assert.ok(out.result.crossCheck, 'crossCheck did not run');
  assert.ok(out.result.crossCheck.dupOpenings.length > 0,
    'four posts opening with the same sentence went unnoticed — this is the check ' +
    'that could never run before, and it has to actually fire');

  const saved = await BlogCampaign.findById(campaign._id);
  assert.ok(saved.crossCheck, 'the report was not persisted');
  assert.ok(saved.crossCheck.repeats.length > 0);
});

await test('varied posts produce a clean report', async () => {
  reset();
  const { campaign, job } = await seed({ slots: 4 });
  await writeCampaign(job, { onProgress: progressWriter(job) });

  const saved = await BlogCampaign.findById(campaign._id);
  assert.strictEqual(saved.crossCheck.dupOpenings.length, 0,
    'posts with distinct openings were flagged as duplicates');
});

console.log('\nScope');

await test('a legacy single-slot job writes one slot, not the whole campaign', async () => {
  reset();
  const { user, campaign } = await seed({ slots: 5, credits: 10000 });

  // The payload an older instance would have queued.
  const legacy = await Job.create({
    user: user._id,
    kind: 'blog',
    status: 'running',
    payload: { campaignId: String(campaign._id), slotIndex: 3 },
    progress: { total: 1, done: 0, stage: 'queued', current: '' },
  });
  made.jobs.push(legacy._id);

  const out = await writeCampaign(legacy, { onProgress: progressWriter(legacy) });

  assert.deepStrictEqual(out.result.written, [3],
    'an old one-post job wrote more than one post — and charged for all of them');
  assert.strictEqual(out.creditsCharged, CREDITS_PER_POST);

  const after = await User.findById(user._id);
  assert.strictEqual(after.credits, 10000 - CREDITS_PER_POST);
});

await test('slotIndexes fills a gap without touching written slots', async () => {
  reset();
  failOn = new Set([2]);

  const { user, campaign, job } = await seed({ slots: 5, credits: 10000 });
  await writeCampaign(job, { onProgress: progressWriter(job) });

  const afterFirst = await User.findById(user._id);
  reset();

  // The batch leaves a slot it could not write as 'failed', on purpose —
  // nothing runs weekly any more, so 'pending' would mean waiting for nothing.
  // Reopening it is an explicit act, and it is the gap-fill route's job.
  const reopened = await BlogCampaign.reopenSlot(campaign._id, 2);
  assert.ok(reopened, 'reopenSlot refused a slot that failed once');

  const fill = await Job.create({
    user: user._id,
    kind: 'blog',
    status: 'running',
    payload: { campaignId: String(campaign._id), slotIndexes: [2] },
    progress: { total: 1, done: 0, stage: 'queued', current: '' },
  });
  made.jobs.push(fill._id);

  const out = await writeCampaign(fill, { onProgress: progressWriter(fill) });

  assert.deepStrictEqual(out.result.written, [2]);
  assert.strictEqual(writeCalls.length, 1, 'the fill run rewrote posts that already existed');

  const after = await User.findById(user._id);
  assert.strictEqual(after.credits, afterFirst.credits - CREDITS_PER_POST,
    'the gap fill charged for more than the one post it wrote');
});

/* ------------------------------------------------------------------ tidy */

await BlogPost.deleteMany({ campaign: { $in: made.campaigns } });
await BlogCampaign.deleteMany({ _id: { $in: made.campaigns } });
await Job.deleteMany({ _id: { $in: made.jobs } });
await BlogSite.deleteMany({ _id: { $in: made.sites } });
await User.deleteMany({ _id: { $in: made.users } });
await mongoose.disconnect();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})();