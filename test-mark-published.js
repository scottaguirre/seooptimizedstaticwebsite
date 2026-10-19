// test-mark-published.js
//
// What went live, written back to the slots that went live.
//
// THE BUG THIS WHOLE FILE EXISTS FOR: until 19 October a Cloudflare slot
// sat at `ready` forever. The articles were on the internet and the app
// had no idea which ones. A scheduler built on top of that would either
// publish the same article every run or skip it entirely, depending on
// which way you guessed — so this is the foundation, and it is tested
// like one.
//
// NO DATABASE. BlogCampaign is injected, so every case here is a plain
// object and an assertion about the ops that would be sent. The thing
// worth testing is WHICH slots are addressed and WHAT is set on them, and
// a real Mongo would only make that slower to find out.

'use strict';

const assert = require('assert');

let passed = 0;
let failed = 0;

const queue = [];
function test(name, fn) {
  queue.push(() => Promise.resolve().then(fn)
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }));
}
function section(n) { queue.push(async () => console.log(`\n${n}\n`)); }

const { markPublished } = require('./utils/blog/markPublished');

/* ------------------------------------------------------------------ fakes */

/** Records what bulkWrite was handed, and says how much it changed. */
function fakeCampaign(modifiedCount = 0) {
  const calls = [];
  return {
    calls,
    async bulkWrite(ops, options) {
      calls.push({ ops, options });
      return { modifiedCount };
    },
  };
}

const NOW = new Date('2026-10-19T12:00:00Z');

/** One deployed page, shaped the way renderPlan shapes it. */
function page(over = {}) {
  const { publishAt, ...rest } = over;
  return Object.assign({
    campaign: { _id: 'c1' },
    index: 0,
    url: 'https://blog.example/first/',
    slot: { index: 0, publishAt: publishAt || '2026-10-01T09:00:00Z' },
    post: { slug: 'first' },
  }, rest);
}

/** The $set of the nth op. */
function setOf(Campaign, n = 0) {
  return Campaign.calls[0].ops[n].updateOne.update.$set;
}

/** The filter of the nth op. */
function filterOf(Campaign, n = 0) {
  return Campaign.calls[0].ops[n].updateOne.filter;
}

/* ======================================================================= */

section('WHAT IS WRITTEN BACK');

test('A DEPLOYED ARTICLE BECOMES published', async () => {
  /* The whole point. Before this, nothing ever moved a Cloudflare slot off
   * `ready`, so the app could not tell a live article from a written one. */
  const Campaign = fakeCampaign(1);

  const out = await markPublished({ pages: [page()], now: NOW, Campaign });

  assert.strictEqual(setOf(Campaign)['slots.$.status'], 'published');
  assert.strictEqual(out.marked, 1);
});

test('AND CARRIES WHEN IT WENT LIVE, AND WHERE IT LIVES', async () => {
  const Campaign = fakeCampaign(1);

  await markPublished({ pages: [page()], now: NOW, Campaign });

  assert.strictEqual(setOf(Campaign)['slots.$.publishedAt'], NOW);
  assert.strictEqual(setOf(Campaign)['slots.$.publishedUrl'], 'https://blog.example/first/');
});

test('AND IT ADDRESSES THE RIGHT SLOT OF THE RIGHT CAMPAIGN', async () => {
  /* The ugliest possible bug in this file is marking the wrong article
   * live, so the filter is asserted whole rather than in pieces. */
  const Campaign = fakeCampaign(1);

  await markPublished({
    pages: [page({ campaign: { _id: 'c7' }, index: 4, slot: { index: 4, publishAt: '2026-10-01T09:00:00Z' } })],
    now: NOW, Campaign,
  });

  assert.deepStrictEqual(filterOf(Campaign), {
    _id: 'c7',
    slots: { $elemMatch: { index: 4, status: { $ne: 'published' } } },
  });
});

test('EVERY DEPLOYED PAGE GETS AN OP, IN ONE ROUND TRIP', async () => {
  /* Twelve articles must not be twelve awaits. */
  const Campaign = fakeCampaign(3);

  const pages = [0, 1, 2].map(i => page({
    index: i, slot: { index: i, publishAt: '2026-10-01T09:00:00Z' }, url: `https://blog.example/p${i}/`,
  }));

  await markPublished({ pages, now: NOW, Campaign });

  assert.strictEqual(Campaign.calls.length, 1, 'more than one database call');
  assert.strictEqual(Campaign.calls[0].ops.length, 3);
  assert.deepStrictEqual(Campaign.calls[0].ops.map(o => o.updateOne.filter.slots.$elemMatch.index),
    [0, 1, 2]);
});

section('A RE-DEPLOY MUST BE FREE');

test('AN ALREADY-PUBLISHED SLOT IS NOT MATCHED', async () => {
  /* Every deploy sends the WHOLE site — a Pages deployment IS the site —
   * so without this filter publishedAt would be rewritten on every press
   * and the field would mean "last deploy" rather than "when this went
   * live", which is the only thing anyone would want it for. */
  const Campaign = fakeCampaign(0);

  await markPublished({ pages: [page()], now: NOW, Campaign });

  assert.deepStrictEqual(filterOf(Campaign).slots.$elemMatch.status, { $ne: 'published' });
});

test('AND THE COUNT IS WHAT CHANGED, NOT WHAT WAS ATTEMPTED', async () => {
  /* On the second deploy of an unchanged blog every filter misses. Saying
   * "12 marked" there would be a lie the log then repeats forever. */
  const Campaign = fakeCampaign(0);

  const out = await markPublished({
    pages: [page({ index: 0 }), page({ index: 1, slot: { index: 1, publishAt: '2026-10-01T09:00:00Z' } })],
    now: NOW, Campaign,
  });

  assert.strictEqual(out.marked, 0, 'a no-op deploy reported slots marked');
});

section('A DATE IN THE FUTURE IS PULLED BACK');

test('AN ARTICLE FORCED LIVE EARLY IS REDATED TO TODAY', async () => {
  /* Edwin's call. "Publish everything now" ignores the schedule, so a slot
   * dated 15 November goes up in October. Left alone the reader sees next
   * month on a page they are reading now, and the sitemap says so too. */
  const Campaign = fakeCampaign(1);

  await markPublished({
    pages: [page({ slot: { index: 0, publishAt: '2026-11-15T09:00:00Z' } })],
    now: NOW, Campaign,
  });

  assert.strictEqual(setOf(Campaign)['slots.$.publishAt'], NOW,
    'a future-dated article kept a date that has not happened');
});

test('BUT AN ARTICLE WHOSE DAY HAS COME KEEPS ITS DATE', async () => {
  /* THE HALF THAT STOPS THIS BEING A REWRITE OF THE SCHEDULE. The ordinary
   * publish is every slot whose date has passed; redating those to today
   * would wipe the real publication history of the whole blog. */
  const Campaign = fakeCampaign(1);

  await markPublished({
    pages: [page({ slot: { index: 0, publishAt: '2026-10-01T09:00:00Z' } })],
    now: NOW, Campaign,
  });

  assert.ok(!('slots.$.publishAt' in setOf(Campaign)),
    'a past-dated article had its publication date rewritten to today');
});

test('AND ONLY THE ONES THAT WENT UP ARE TOUCHED AT ALL', async () => {
  /* A campaign of twelve with three live gets three ops. The other nine
   * keep their dates and their `ready`, because they are not on the site
   * — pages is what DEPLOYED, not what exists. */
  const Campaign = fakeCampaign(3);

  const pages = [0, 1, 2].map(i => page({
    index: i, slot: { index: i, publishAt: '2026-10-01T09:00:00Z' },
  }));

  await markPublished({ pages, now: NOW, Campaign });

  assert.strictEqual(Campaign.calls[0].ops.length, 3,
    'slots that were not deployed were written to anyway');
});

test('A SLOT DATED EXACTLY NOW IS NOT IN THE FUTURE', async () => {
  /* The boundary. `>` not `>=`, so an article whose minute has just
   * arrived is not pointlessly rewritten to the same instant. */
  const Campaign = fakeCampaign(1);

  await markPublished({
    pages: [page({ slot: { index: 0, publishAt: NOW.toISOString() } })],
    now: NOW, Campaign,
  });

  assert.ok(!('slots.$.publishAt' in setOf(Campaign)), 'a date equal to now was treated as future');
});

test('AN UNREADABLE DATE IS LEFT ALONE RATHER THAN GUESSED AT', async () => {
  /* NaN compares false against everything, so the guard has to be
   * explicit or a junk date silently becomes today. */
  const Campaign = fakeCampaign(1);

  for (const bad of ['not a date', '', null, undefined]) {
    Campaign.calls.length = 0;
    await markPublished({ pages: [page({ slot: { index: 0, publishAt: bad } })], now: NOW, Campaign });

    assert.ok(!('slots.$.publishAt' in setOf(Campaign)),
      `${JSON.stringify(bad)} was rewritten to today`);
    assert.strictEqual(setOf(Campaign)['slots.$.status'], 'published',
      `${JSON.stringify(bad)} stopped the slot being marked live`);
  }
});

section('WHAT IT REFUSES TO DO');

test('NOTHING DEPLOYED MEANS NO DATABASE CALL AT ALL', async () => {
  /* bulkWrite throws on an empty ops array, which would turn "nothing to
   * do" into a 500 on a screen that had just succeeded. */
  const Campaign = fakeCampaign(0);

  for (const pages of [[], null, undefined]) {
    const out = await markPublished({ pages, now: NOW, Campaign });
    assert.strictEqual(out.marked, 0);
  }

  assert.strictEqual(Campaign.calls.length, 0, 'it went to the database with nothing to say');
});

test('A PAGE WITH NO CAMPAIGN OR NO INDEX IS SKIPPED, NOT GUESSED', async () => {
  /* THE REASON THIS IS EXPLICIT. An $elemMatch on an undefined index
   * matches the FIRST slot of the campaign — so a malformed page would
   * not fail, it would mark the wrong article live. */
  const Campaign = fakeCampaign(1);

  await markPublished({
    pages: [
      page({ campaign: null }),
      page({ campaign: {} }),
      page({ index: undefined, slot: { index: 0, publishAt: '2026-10-01T09:00:00Z' } }),
      page({ index: '2' }),
      page({ index: 1, slot: { index: 1, publishAt: '2026-10-01T09:00:00Z' } }),
    ],
    now: NOW, Campaign,
  });

  assert.strictEqual(Campaign.calls[0].ops.length, 1, 'a malformed page reached the database');
  assert.strictEqual(filterOf(Campaign).slots.$elemMatch.index, 1, 'the wrong slot was addressed');
});

test('AND SLOT ZERO IS NOT MISTAKEN FOR A MISSING ONE', async () => {
  /* The classic. `if (!index)` would drop the front page of every blog,
   * which is the one article guaranteed to be live. */
  const Campaign = fakeCampaign(1);

  await markPublished({ pages: [page({ index: 0 })], now: NOW, Campaign });

  assert.strictEqual(Campaign.calls[0].ops.length, 1, 'slot 0 was treated as absent');
  assert.strictEqual(filterOf(Campaign).slots.$elemMatch.index, 0);
});

test('EVERY MALFORMED PAGE MEANS NO CALL, NOT AN EMPTY ONE', async () => {
  const Campaign = fakeCampaign(0);

  await markPublished({ pages: [page({ campaign: null })], now: NOW, Campaign });

  assert.strictEqual(Campaign.calls.length, 0, 'bulkWrite was called with no ops');
});

test('IT IS UNORDERED, SO ONE BAD SLOT DOES NOT STOP THE REST', async () => {
  /* Ordered would abandon the remaining articles on the first write
   * error, leaving a blog half-marked and no way to tell where it
   * stopped. */
  const Campaign = fakeCampaign(2);

  await markPublished({ pages: [page({ index: 0 }), page({ index: 1, slot: { index: 1 } })], now: NOW, Campaign });

  assert.strictEqual(Campaign.calls[0].options.ordered, false);
});

/* ======================================================================= */

(async () => {
  for (const run of queue) await run();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
