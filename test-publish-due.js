// test-publish-due.js
//
// Static blogs publish themselves.
//
// WHAT THIS IS GUARDING. A deploy is the most destructive thing this app
// does on a schedule: a Pages deployment IS the site, so a job that runs at
// the wrong moment, on the wrong blog, or with the wrong flag does not
// produce a bad page — it replaces a working site. Every test here is about
// NOT deploying as much as about deploying.
//
// NO DATABASE AND NO CLOUDFLARE. The models, publishBlog and markPublished
// are all injected. What is worth testing is which blogs are chosen, what
// they are called with, and what happens when one fails.

'use strict';

const assert = require('assert');

let passed = 0;
let failed = 0;

const queue = [];

/* THE BACKOFF IS PROCESS MEMORY, so it leaks from one case into the next
 * unless something clears it. It did, on the first run of this file: six
 * cases failed against correct code because an earlier case had already
 * deployed the same blog at the same instant and the gap held it back.
 * Cleared before EVERY case rather than in the ones that look like they
 * need it — the next case added would not know to do it. */
function test(name, fn) {
  queue.push(() => Promise.resolve()
    .then(() => resetBackoff())
    .then(fn)
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }));
}
function section(n) { queue.push(async () => console.log(`\n${n}\n`)); }

const { publishDue, blogsWithWorkDue, resetBackoff, DUE_GAP_MS, MAX_PER_RUN } =
  require('./utils/blog/publishDue');

/* ------------------------------------------------------------------ fakes */

const NOW = new Date('2026-10-19T12:00:00Z');

function fakeCampaign(sites = ['b1']) {
  const queries = [];
  return {
    queries,
    find(q) {
      queries.push(q);
      const answer = { select: () => answer, lean: async () => sites.map(s => ({ site: s })) };
      return answer;
    },
  };
}

function fakeSite(blogs = [{ _id: 'b1', siteUrl: 'a.example', project: 'p' }]) {
  const queries = [];
  const updates = [];
  return {
    queries,
    updates,
    async find(q) { queries.push(q); return blogs; },
    async updateOne(filter, update) { updates.push({ filter, update }); },
  };
}

/** A publish that succeeds, recording what it was asked for. */
function fakePublish(answer) {
  const calls = [];
  const fn = async (opts) => {
    calls.push(opts);
    return typeof answer === 'function' ? answer(opts) : answer;
  };
  fn.calls = calls;
  return fn;
}

function fakeMark(marked = 2) {
  const calls = [];
  const fn = async (opts) => { calls.push(opts); return { marked }; };
  fn.calls = calls;
  return fn;
}

const OK = {
  ok: true,
  url: 'https://a.example/',
  project: 'a-example',
  pages: [{ index: 0 }, { index: 1 }],
};

/** Everything injected, with sane defaults, so a case states only its point. */
function run(over = {}) {
  return publishDue(Object.assign({
    now: NOW,
    Site: fakeSite(),
    Campaign: fakeCampaign(),
    publish: fakePublish(OK),
    mark: fakeMark(),
  }, over));
}

queue.push(async () => resetBackoff());

/* ======================================================================= */

section('WHICH BLOGS ARE CHOSEN');

test('A WRITTEN ARTICLE WHOSE DAY HAS COME IS WHAT COUNTS', async () => {
  /* Both conditions on the SAME slot, via $elemMatch. Without it a campaign
   * with any ready slot and any past-dated slot matches — which from week
   * two of a twelve-week campaign is every campaign there is. */
  const Campaign = fakeCampaign();

  await blogsWithWorkDue(NOW, Campaign);

  assert.deepStrictEqual(Campaign.queries[0], {
    slots: { $elemMatch: { status: 'ready', publishAt: { $lte: NOW } } },
  });
});

test('AND A BLOG IS LISTED ONCE HOWEVER MANY CAMPAIGNS ARE DUE', async () => {
  /* Three campaigns on one blog is still one deploy — a Pages deployment is
   * the whole site, so deploying three times would be two wasted rebuilds
   * of exactly the same files.
   *
   * THE IDS ARE OBJECTS, NOT STRINGS, AND THAT IS THE WHOLE TEST. With
   * plain strings this passed with or without the String() around the id,
   * because a Set already dedupes equal strings — mutation testing caught
   * it surviving. A real campaign.site is an ObjectId: two of them can be
   * equal and still be different objects, so a Set of the raw values
   * dedupes nothing and the blog is listed once per campaign. */
  const objectId = (hex) => ({ toString: () => hex });

  const Campaign = fakeCampaign([objectId('b1'), objectId('b1'), objectId('b2'), objectId('b1')]);

  assert.deepStrictEqual(await blogsWithWorkDue(NOW, Campaign), ['b1', 'b2']);
});

test('ONLY CLOUDFLARE BLOGS, AND ONLY ACTIVE ONES', async () => {
  /* The inverse of the whitelist in blogScheduler's ping query. A WordPress
   * site reaching this job would be redeployed as a static blog, which is
   * not a thing that can half-work. */
  const Site = fakeSite();

  await run({ Site });

  assert.strictEqual(Site.queries[0].target, 'cloudflare');
  assert.strictEqual(Site.queries[0].status, 'active');
});

test('AND NOTHING DUE MEANS NO SITE QUERY AT ALL', async () => {
  const Site = fakeSite();

  const out = await run({ Site, Campaign: fakeCampaign([]) });

  assert.deepStrictEqual(out, { deployed: 0, failed: 0, considered: 0 });
  assert.strictEqual(Site.queries.length, 0, 'it went looking for blogs with nothing to deploy');
});

section('WHAT THE DEPLOY IS ASKED FOR');

test('IT PUBLISHES FOR REAL, AND ONLY WHAT IS DUE', async () => {
  /* THE TWO FLAGS THAT MUST NOT BE SET, and they fail in opposite
   * directions. dryRun would mean the job quietly never publishes anything.
   * includeScheduled would mean the first tick puts the ENTIRE campaign on
   * the site at once — twelve weeks of articles on day one, which is the
   * exact opposite of posting weekly and cannot be undone. */
  const publish = fakePublish(OK);

  await run({ publish });

  assert.strictEqual(publish.calls.length, 1);
  assert.ok(!publish.calls[0].dryRun, 'the scheduled job ran as a dry run and published nothing');
  assert.ok(!publish.calls[0].includeScheduled,
    'the job ignored the schedule and published the whole campaign');
});

test('AND IT MARKS WHAT WENT LIVE, THROUGH THE SAME MODULE THE BUTTON USES', async () => {
  const mark = fakeMark();

  await run({ mark });

  assert.strictEqual(mark.calls.length, 1, 'a scheduled deploy left the slots unmarked');
  assert.strictEqual(mark.calls[0].pages, OK.pages);
});

test('AND IT RECORDS THE DEPLOY ON THE BLOG', async () => {
  const Site = fakeSite();

  await run({ Site });

  assert.strictEqual(Site.updates.length, 1);
  assert.strictEqual(Site.updates[0].update.$set.lastDeployUrl, OK.url);
  assert.strictEqual(Site.updates[0].update.$set.project, OK.project);
});

test('AND IT COUNTS WHAT IT DID', async () => {
  const out = await run();
  assert.deepStrictEqual(out, { deployed: 1, failed: 0, considered: 1 });
});

section('WHEN A DEPLOY FAILS');

test('A REFUSED DEPLOY MARKS NOTHING', async () => {
  /* It is not on the internet, so it is not published — and marking it would
   * make the filter skip it on the retry that would have fixed it. */
  const mark = fakeMark();
  const Site = fakeSite();

  const out = await run({
    publish: fakePublish({ ok: false, error: 'Cloudflare said no', pages: [] }),
    mark, Site,
  });

  assert.strictEqual(mark.calls.length, 0, 'a failed deploy was recorded as published');
  assert.strictEqual(Site.updates.length, 0, 'a failed deploy stamped lastDeployAt');
  assert.deepStrictEqual(out, { deployed: 0, failed: 1, considered: 1 });
});

test('AND A PUBLISH THAT RETURNS NOTHING IS A FAILURE, NOT A CRASH', async () => {
  const out = await run({ publish: fakePublish(undefined) });
  assert.strictEqual(out.failed, 1);
});

test('AND ONE BLOG THROWING DOES NOT ABANDON THE REST', async () => {
  /* The tick catches at the top, so an escaping error would skip every blog
   * after this one AND the WordPress pings behind it. */
  resetBackoff();

  const blogs = [
    { _id: 'b1', siteUrl: 'a.example' },
    { _id: 'b2', siteUrl: 'b.example' },
  ];

  const publish = fakePublish((opts) => {
    if ('b1' === String(opts.blog._id)) throw new Error('boom');
    return OK;
  });

  const out = await publishDue({
    now: NOW, Site: fakeSite(blogs), Campaign: fakeCampaign(['b1', 'b2']),
    publish, mark: fakeMark(),
  });

  assert.strictEqual(out.failed, 1);
  assert.strictEqual(out.deployed, 1, 'the second blog was abandoned after the first threw');
});

section('THE BACKOFF, WHICH IS WHY A FAILING BLOG IS NOT REDEPLOYED EVERY MINUTE');

test('A BLOG JUST TRIED IS LEFT ALONE', async () => {
  /* A successful deploy stops matching the query on its own — its slots are
   * published. This only ever holds back one that failed, which without it
   * would be redeployed every sixty seconds for ever. */
  resetBackoff();

  const publish = fakePublish({ ok: false, error: 'no', pages: [] });

  await run({ publish });
  await run({ publish });

  assert.strictEqual(publish.calls.length, 1, 'a failing blog was retried on the very next tick');
});

test('AND IS TRIED AGAIN ONCE THE GAP HAS PASSED', async () => {
  resetBackoff();

  const publish = fakePublish({ ok: false, error: 'no', pages: [] });

  await run({ publish });
  await run({ publish, now: new Date(NOW.getTime() + DUE_GAP_MS + 1000) });

  assert.strictEqual(publish.calls.length, 2, 'the blog was never retried');
});

test('AND A BLOG HELD BACK IS NOT COUNTED AS CONSIDERED', async () => {
  resetBackoff();

  const publish = fakePublish({ ok: false, error: 'no', pages: [] });

  await run({ publish });
  const out = await run({ publish });

  assert.deepStrictEqual(out, { deployed: 0, failed: 0, considered: 0 });
});

section('THE CAP, WHICH IS WHY ONE TICK CANNOT STALL THE LOOP');

test('NO MORE THAN MAX_PER_RUN BLOGS IN ONE PASS', async () => {
  /* The tick holds a flag so two ticks cannot overlap. A deploy takes
   * seconds to minutes, so an uncapped pass over twelve blogs would hold
   * that flag shut and stall every WordPress ping behind it. */
  resetBackoff();

  const many = Array.from({ length: MAX_PER_RUN + 4 }, (_, i) => ({ _id: `b${i}`, siteUrl: `${i}.example` }));
  const publish = fakePublish(OK);

  const out = await publishDue({
    now: NOW,
    Site: fakeSite(many),
    Campaign: fakeCampaign(many.map(b => b._id)),
    publish, mark: fakeMark(),
  });

  assert.strictEqual(publish.calls.length, MAX_PER_RUN, `it deployed ${publish.calls.length} blogs in one pass`);
  assert.strictEqual(out.deployed, MAX_PER_RUN);
});

test('AND A FAILURE STILL COUNTS AGAINST THE CAP', async () => {
  /* Otherwise a run where everything fails walks the whole list, which is
   * the case most likely to be slow — every one of them timing out. */
  resetBackoff();

  const many = Array.from({ length: MAX_PER_RUN + 4 }, (_, i) => ({ _id: `b${i}`, siteUrl: `${i}.example` }));
  const publish = fakePublish({ ok: false, error: 'no', pages: [] });

  await publishDue({
    now: NOW, Site: fakeSite(many), Campaign: fakeCampaign(many.map(b => b._id)),
    publish, mark: fakeMark(),
  });

  assert.strictEqual(publish.calls.length, MAX_PER_RUN, 'failures walked past the cap');
});

test('AND THE ONES IT SKIPPED ARE FREE TO GO NEXT PASS', async () => {
  /* The cap must not become a backoff for blogs that were never tried —
   * they were not attempted, so nothing should hold them back. */
  resetBackoff();

  const many = Array.from({ length: MAX_PER_RUN + 1 }, (_, i) => ({ _id: `b${i}`, siteUrl: `${i}.example` }));
  const ids = many.map(b => b._id);
  const publish = fakePublish(OK);

  await publishDue({ now: NOW, Site: fakeSite(many), Campaign: fakeCampaign(ids), publish, mark: fakeMark() });
  await publishDue({ now: NOW, Site: fakeSite(many), Campaign: fakeCampaign(ids), publish, mark: fakeMark() });

  const tried = publish.calls.map(c => String(c.blog._id));
  assert.ok(tried.includes(`b${MAX_PER_RUN}`),
    'the blog pushed past the cap was never picked up on the following pass');
});

section('AND THE TIMER ACTUALLY CALLS IT');

test('THE SCHEDULER TICK DEPLOYS DUE BLOGS', async () => {
  /* THE TEST THAT MAKES ALL THE OTHERS WORTH ANYTHING. Every case above
   * drives publishDue() directly, so every one of them would still pass if
   * the line in blogScheduler.tick() were deleted — and the symptom would
   * be the bug this whole file exists to fix, back again, silently.
   *
   * The precedent is sitting in the tree: utils/cleanupScheduler.js is a
   * complete, correct, exported scheduler that NOTHING EVER CALLED. It has
   * never run. Nobody noticed for months, because a job that does nothing
   * looks exactly like a job with nothing to do.
   *
   * THE STUB GOES IN BEFORE THE SCHEDULER IS REQUIRED. blogScheduler does
   * `const { publishDue: publishDueBlogs } = require(...)` at load, so one
   * installed afterwards is one the tick never sees. Fifth time that trap
   * has come up in this codebase; see the note at the top of
   * test-static-blogs.js for the other four.
   *
   * Mongoose complains all through this — there is no database in a test
   * run — and that is fine and is the point of the surrounding try/catch
   * in tick(). The assertion is only that OUR line ran before any of it. */
  const dueModule = require('./utils/blog/publishDue');
  const real = dueModule.publishDue;

  let called = 0;
  dueModule.publishDue = async () => { called += 1; return { deployed: 0, failed: 0, considered: 0 }; };

  try {
    const { tick } = require('./utils/blogScheduler');
    await tick();

    assert.strictEqual(called, 1, 'the scheduler tick does not deploy due static blogs');
  } finally {
    dueModule.publishDue = real;
  }
});

/* ======================================================================= */

(async () => {
  for (const run_ of queue) await run_();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
