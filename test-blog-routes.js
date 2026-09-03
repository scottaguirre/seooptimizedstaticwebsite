// test-blog-routes.js
//
// The four write-ahead endpoints, driven the way the plugin drives them:
// signed requests against a real Express app, against a real database.
//
//   MONGO_URI=... node test-blog-routes.js
//
// WHY IT MOUNTS THE ROUTER RATHER THAN CALLING THE HANDLERS
//
// Half of what these routes do happens before the handler runs. requireSite
// verifies an HMAC over the raw bytes, and the raw bytes are only raw if the
// body parser saw them — an earlier version of this system had a signing bug
// that only appeared through a real request, because a re-serialised object
// does not reproduce the bytes that were signed. Calling handlers directly
// would skip exactly the layer most likely to be wrong.
//
// So this starts the router on an ephemeral port and speaks HTTP to it.
//
// The model is stubbed, and only the model. Same require-cache swap as
// test-blog-batch.js, for the same reason: an env var that silently produces
// fake posts is one typo away from charging a customer for filler.

const assert = require('assert');
const crypto = require('crypto');
const express = require('express');
const mongoose = require('mongoose');

if (!process.env.MONGO_URI) {
  console.log('\ntest-blog-routes: set MONGO_URI to run this.\n');
  process.exit(0);
}

/* ------------------------------------------------------------- the stub */

const writePostPath = require.resolve('./utils/blog/writePost');
const realWritePost = require(writePostPath);

let failOn = new Set();

function fakeWritePost(slot) {
  if (failOn.has(slot.index)) {
    return Promise.reject(new Error(`stub: refusing slot ${slot.index}`));
  }

  const sections = [
    { heading: null, paragraphs: [`Slot ${slot.index} opens on its own terms with a specific detail.`] },
    {
      heading: 'The part that matters',
      paragraphs: [`Past a certain point a {{money}}${slot.money.anchor}{{/money}} is the practical next step.`],
    },
  ];

  if (slot.prevAnchor) {
    sections.push({ heading: 'Earlier', paragraphs: [`We covered {{prev}}${slot.prevAnchor}{{/prev}} already.`] });
  }
  if (slot.nextAnchor) {
    sections.push({ heading: 'Next', paragraphs: [`People then weigh up {{next}}${slot.nextAnchor}{{/next}}.`] });
  }

  return Promise.resolve({
    title: `Post ${slot.index}`,
    metaDescription: `Description for slot ${slot.index}.`,
    sections,
  });
}

require.cache[writePostPath] = {
  id: writePostPath, filename: writePostPath, loaded: true,
  exports: { ...realWritePost, writePost: fakeWritePost },
};

/* ----------------------------------------------------------- real modules */

const User = require('./models/User');
const Job = require('./models/Job');
const BlogSite = require('./models/BlogSite');
const BlogCampaign = require('./models/BlogCampaign');
const BlogPost = require('./models/BlogPost');
const blogApiRoute = require('./routes/blogApiRoute');
const { sign } = require('./middleware/requireSite');
const { writeCampaign } = require('./utils/blogGenerator');
const { CREDITS_PER_POST } = require('./utils/blogPricing');

let passed = 0, failed = 0;

function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}

(async () => {

await mongoose.connect(process.env.MONGO_URI);

/* ---------------------------------------------------------------- the app */

const app = express();

// COPIED FROM server.js, deliberately including the path check. requireSite
// verifies against req.rawBody, and server.js only captures it for /api/blog/
// paths — so if that prefix ever changes, this test should break rather than
// quietly pass on a config the real app does not have.
//
// The default body limit is left alone for the same reason: /complete carries
// a whole batch of confirmations, and if that ever grows past what the real
// server accepts, this is where it should show up.
app.use(express.json({
  verify: (req, res, buf) => {
    if (req.path.startsWith('/api/blog/')) {
      req.rawBody = buf;
    }
  },
}));
app.use('/', blogApiRoute);

const server = app.listen(0);
await new Promise(r => server.once('listening', r));
const base = `http://127.0.0.1:${server.address().port}`;

/* ------------------------------------------------------------ the fixture */

const made = { users: [], sites: [], campaigns: [], jobs: [] };

const secret = crypto.randomBytes(32).toString('hex');

const user = await User.create({
  email: `routes-test-${Date.now()}@example.invalid`,
  password: 'x'.repeat(60),
  credits: 10000,
});
made.users.push(user._id);

const site = await BlogSite.create({
  user: user._id,
  licenceKeyHash: crypto.randomBytes(32).toString('hex'),
  secret,
  siteUrl: 'example.invalid',
  status: 'active',
  business: { name: 'Hill Country Plumbing', type: 'plumber', location: 'Leander, TX' },
});
made.sites.push(site._id);

/**
 * One signed request, exactly as the plugin makes it.
 *
 * The body is serialised ONCE and those bytes are both signed and sent. Doing
 * it in two steps — signing an object, then letting fetch serialise it again —
 * is the encode-once mistake, and it produces a signature over bytes nobody
 * ever transmitted.
 */
async function call(path, payload, opts = {}) {
  const body = JSON.stringify(payload);
  const timestamp = String(Math.floor(Date.now() / 1000));

  const signature = sign(opts.secret || secret, {
    timestamp,
    method: 'POST',
    path,
    rawBody: Buffer.from(body, 'utf8'),
  });

  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-IL-Site': String(opts.siteId || site._id),
      'X-IL-Timestamp': timestamp,
      'X-IL-Signature': signature,
    },
    body,
  });

  let json = null;
  try { json = await res.json(); } catch (_) { /* some errors are not JSON */ }

  return { status: res.status, body: json };
}

const TOPICS = [
  { topic: 'why a water heater rumbles', targetQuery: 'water heater rumbling noise' },
  { topic: 'how long a water heater lasts', targetQuery: 'water heater lifespan' },
  { topic: 'what a thermal expansion tank does', targetQuery: 'thermal expansion tank purpose' },
];

const TARGET = {
  url: 'https://example.invalid/water-heater-repair.html',
  keyword: 'water heater repair',
  intent: 'Someone whose water heater has stopped working and wants it fixed.',
};

/** Run the campaign's queued batch inline, the way the job runner would. */
async function runBatch(campaignId) {
  const campaign = await BlogCampaign.findById(campaignId);
  const job = await Job.findById(campaign.batch.job);
  made.jobs.push(job._id);

  await writeCampaign(job, {
    async onProgress({ done, total, current, stage, skippedPage }) {
      const set = {};
      if (typeof done === 'number') set['progress.done'] = done;
      if (typeof total === 'number') set['progress.total'] = total;
      if (current !== undefined) set['progress.current'] = current;
      if (stage !== undefined) set['progress.stage'] = stage;
      const update = { $set: set };
      if (skippedPage) update.$push = { skippedPages: skippedPage };
      await Job.updateOne({ _id: job._id }, update);
    },
  });

  await Job.updateOne({ _id: job._id }, { $set: { status: 'completed' } });
}

/* ====================================================================== */

console.log('\nAuthentication');

await test('an unsigned request is refused', async () => {
  const res = await fetch(`${base}/api/blog/plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetPage: TARGET, topics: TOPICS }),
  });

  assert.ok(res.status === 401 || res.status === 403, `expected a rejection, got ${res.status}`);
});

await test('a signature from the wrong secret is refused', async () => {
  const res = await call('/api/blog/plan',
    { targetPage: TARGET, topics: TOPICS },
    { secret: crypto.randomBytes(32).toString('hex') }
  );

  assert.ok(res.status === 401 || res.status === 403, `expected a rejection, got ${res.status}`);
});

console.log('\nPlanning');

let campaignId = null;

await test('a plan is saved as a draft, not started', async () => {
  const res = await call('/api/blog/plan', {
    targetPage: TARGET,
    topics: TOPICS,
    schedule: { everyDays: 7, publishTime: '09:00', timezone: 'America/Chicago' },
  });

  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.status, 'draft',
    'a plan that starts itself is a plan that charges before anyone approved it');
  assert.strictEqual(res.body.slots.length, 3);
  assert.strictEqual(res.body.quote.total, 3 * CREDITS_PER_POST);
  assert.strictEqual(res.body.enoughCredits, true);

  campaignId = res.body.campaignId;
  made.campaigns.push(campaignId);
});

await test('planning charges nothing', async () => {
  const after = await User.findById(user._id);
  assert.strictEqual(after.credits, 10000, 'planning moved the balance');
});

await test('another site cannot see this campaign', async () => {
  const other = await BlogSite.create({
    user: user._id,
    licenceKeyHash: crypto.randomBytes(32).toString('hex'),
    secret: crypto.randomBytes(32).toString('hex'),
    siteUrl: 'other.invalid',
    status: 'active',
  });
  made.sites.push(other._id);

  const res = await call('/api/blog/collect', { campaignId },
    { siteId: other._id, secret: other.secret });

  assert.strictEqual(res.status, 404,
    'a campaign id is visible in wp-admin — it must not be enough to read someone else\'s posts');
});

console.log('\nThe credit gate');

await test('/write refuses when the balance will not cover the batch', async () => {
  await User.updateOne({ _id: user._id }, { $set: { credits: CREDITS_PER_POST } });

  const res = await call('/api/blog/write', { campaignId });

  assert.strictEqual(res.status, 402, JSON.stringify(res.body));
  assert.strictEqual(res.body.creditsError, true);
  assert.strictEqual(res.body.quote.total, 3 * CREDITS_PER_POST);

  const saved = await BlogCampaign.findById(campaignId);
  assert.strictEqual(saved.status, 'draft', 'a refused batch must leave the campaign alone');
  assert.ok(!saved.batch?.job, 'a job was queued for a batch that was refused');
});

await test('/write starts the batch once the balance covers it', async () => {
  await User.updateOne({ _id: user._id }, { $set: { credits: 10000 } });

  const res = await call('/api/blog/write', { campaignId });

  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.status, 'writing');
  assert.strictEqual(res.body.total, 3);

  const saved = await BlogCampaign.findById(campaignId);
  assert.strictEqual(saved.status, 'writing');
  assert.ok(saved.batch.job, 'no job was recorded on the campaign');
});

await test('a second /write reports the batch, it does not start another', async () => {
  const before = await BlogCampaign.findById(campaignId);

  const res = await call('/api/blog/write', { campaignId });

  assert.strictEqual(res.body.status, 'writing');

  const after = await BlogCampaign.findById(campaignId);
  assert.strictEqual(String(after.batch.job), String(before.batch.job),
    'a second approval started a second batch — every post would be written twice');

  const jobs = await Job.countDocuments({ 'payload.campaignId': String(campaignId) });
  assert.strictEqual(jobs, 1, `${jobs} jobs exist for one campaign`);
});

await test('/collect says "writing" while the batch runs, and hands over nothing', async () => {
  const res = await call('/api/blog/collect', { campaignId });

  assert.strictEqual(res.body.status, 'writing');
  assert.deepStrictEqual(res.body.posts, []);
});

console.log('\nCollection');

await test('the batch runs and the campaign goes active', async () => {
  await runBatch(campaignId);

  const saved = await BlogCampaign.findById(campaignId);
  assert.strictEqual(saved.status, 'active');
  assert.strictEqual(saved.batch.written, 3);

  const after = await User.findById(user._id);
  assert.strictEqual(after.credits, 10000 - 3 * CREDITS_PER_POST);
});

await test('/collect hands over the written posts with their tokens intact', async () => {
  const res = await call('/api/blog/collect', { campaignId });

  assert.strictEqual(res.body.status, 'ok');
  assert.strictEqual(res.body.posts.length, 3);

  const first = res.body.posts[0];
  assert.strictEqual(first.slotIndex, 0);
  assert.ok(first.publishAt, 'the plugin needs this as post_date to schedule the post');
  assert.ok(first.targets.money.url);

  const text = first.sections.flatMap(s => s.paragraphs).join('\n');
  assert.ok(/\{\{money\}\}/.test(text), 'the token was rendered away before it reached the plugin');
  assert.ok(!/<a /.test(text), 'the server shipped markup it must not ship');
});

await test('/collect charges nothing, however many times it is called', async () => {
  const before = await User.findById(user._id);

  await call('/api/blog/collect', { campaignId });
  await call('/api/blog/collect', { campaignId });

  const after = await User.findById(user._id);
  assert.strictEqual(after.credits, before.credits,
    'collect is a read — a site that retries an insert must not pay twice');
});

await test('/collect honours a limit, so a big campaign arrives in pieces', async () => {
  const res = await call('/api/blog/collect', { campaignId, limit: 2 });

  assert.strictEqual(res.body.posts.length, 2);
  assert.strictEqual(res.body.remaining, 1);
});

console.log('\nScheduling and publication');

await test('/complete records a whole batch in one call', async () => {
  const res = await call('/api/blog/complete', {
    campaignId,
    posts: [
      { slotIndex: 0, wpPostId: 101, url: 'https://example.invalid/p0/', title: 'Post 0', scheduledFor: '2026-09-10T14:00:00Z' },
      { slotIndex: 1, wpPostId: 102, url: 'https://example.invalid/p1-2/', title: 'Post 1' },
      { slotIndex: 2, wpPostId: 103, url: 'https://example.invalid/p2/', title: 'Post 2' },
    ],
  });

  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.deepStrictEqual(res.body.recorded, [0, 1, 2]);
  assert.strictEqual(res.body.readyToCollect, 0);

  const saved = await BlogCampaign.findById(campaignId);
  assert.ok(saved.slots.every(s => s.status === 'scheduled'),
    'the posts exist in WordPress but are not public — that is "scheduled", not "published"');

  // The -2 is the whole reason the plugin reports the URL back.
  assert.strictEqual(saved.slots[1].publishedUrl, 'https://example.invalid/p1-2/');
});

await test('/complete no longer returns an activate list', async () => {
  const res = await call('/api/blog/complete', {
    campaignId,
    posts: [{ slotIndex: 0, wpPostId: 101, url: 'https://example.invalid/p0/', title: 'Post 0' }],
  });

  assert.strictEqual(res.body.activate, undefined,
    'the server no longer computes the placeholder swap — the plugin does it locally on publish');
});

await test('a duplicate confirmation is accepted without changing anything', async () => {
  const res = await call('/api/blog/complete', {
    campaignId,
    posts: [{ slotIndex: 1, wpPostId: 999, url: 'https://example.invalid/wrong/', title: 'Wrong' }],
  });

  assert.deepStrictEqual(res.body.recorded, [1], 'a retry should be acknowledged, not rejected');

  const saved = await BlogCampaign.findById(campaignId);
  assert.strictEqual(saved.slots[1].wpPostId, 102, 'the retry overwrote the real post id');
  assert.strictEqual(saved.slots[1].publishedUrl, 'https://example.invalid/p1-2/');
});

await test('/published moves one slot live and leaves the rest scheduled', async () => {
  const res = await call('/api/blog/published', { campaignId, slotIndex: 0 });

  assert.strictEqual(res.body.ok, true);
  assert.deepStrictEqual(res.body.live, [0]);
  assert.strictEqual(res.body.outstanding, 2);
  assert.strictEqual(res.body.campaignStatus, 'active');

  const saved = await BlogCampaign.findById(campaignId);
  assert.strictEqual(saved.slots[0].status, 'published');
  assert.ok(saved.slots[0].publishedAt);
  assert.strictEqual(saved.slots[0].wpPostId, 101, 'publication rewrote the post id');
});

await test('the campaign completes when the last post goes live', async () => {
  await call('/api/blog/published', { campaignId, posts: [{ slotIndex: 1 }, { slotIndex: 2 }] });

  const saved = await BlogCampaign.findById(campaignId);
  assert.strictEqual(saved.status, 'completed');
});

console.log('\nGaps');

await test('a failed slot can be reopened and filled by slotIndexes', async () => {
  failOn = new Set([1]);

  const plan = await call('/api/blog/plan', { targetPage: TARGET, topics: TOPICS });
  const gapId = plan.body.campaignId;
  made.campaigns.push(gapId);

  await call('/api/blog/write', { campaignId: gapId });
  await runBatch(gapId);

  const partial = await BlogCampaign.findById(gapId);
  assert.strictEqual(partial.slots[1].status, 'failed');
  assert.strictEqual(partial.status, 'active', 'two good posts should still be publishable');

  // And the neighbour is not left pointing at a post that never happened.
  const zero = await BlogPost.forSlot(gapId, 0);
  assert.strictEqual(zero.targets.next, undefined,
    'slot 0 still holds a placeholder for a post that will never exist');

  failOn = new Set();
  const creditsBefore = (await User.findById(user._id)).credits;

  const fill = await call('/api/blog/write', { campaignId: gapId, slotIndexes: [1] });
  assert.strictEqual(fill.body.status, 'writing');
  assert.strictEqual(fill.body.total, 1, 'the fill run took more than the one slot it was given');

  await runBatch(gapId);

  const filled = await BlogCampaign.findById(gapId);
  assert.strictEqual(filled.slots[1].status, 'ready');

  const creditsAfter = (await User.findById(user._id)).credits;
  assert.strictEqual(creditsBefore - creditsAfter, CREDITS_PER_POST,
    'the gap fill charged for more than one post');
});

await test('/write on a fully written campaign reports done rather than erroring', async () => {
  const res = await call('/api/blog/write', { campaignId });

  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.status, 'written',
    'the plugin polls this — it needs a terminal answer, not a 4xx');
});

/* ------------------------------------------------------------------ tidy */

await BlogPost.deleteMany({ campaign: { $in: made.campaigns } });
await BlogCampaign.deleteMany({ _id: { $in: made.campaigns } });
await Job.deleteMany({ 'payload.campaignId': { $in: made.campaigns.map(String) } });
await BlogSite.deleteMany({ _id: { $in: made.sites } });
await User.deleteMany({ _id: { $in: made.users } });

server.close();
await mongoose.disconnect();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})();