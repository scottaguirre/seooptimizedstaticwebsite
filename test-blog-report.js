// test-blog-report.js
//
// The blog report: every post across every site, and the CSV of it.
//
// WHAT THIS GUARDS
//
// Three things, in order of how badly they would go wrong.
//
// 1. THE PAGE AND THE CSV MUST NOT DRIFT. They share rowsFor() for exactly
//    that reason. A report and its export disagreeing is the kind of thing
//    nobody notices until a customer quotes one of them back at you.
//
// 2. A REMOVED CAMPAIGN STILL APPEARS. That is the whole point of recording
//    removal on the server instead of in WordPress — the WordPress record is
//    gone, and the posts it published are usually still on the site earning
//    their keep. Dropping those rows would make the report lie by omission.
//
// 3. CSV INJECTION. Post titles come from a customer's WordPress. A title
//    beginning with "=" is a formula the moment someone opens the file in
//    Excel, on their own machine, with their own data in front of them.
//
// Mongoose is NOT loaded here. rowsFor() is exercised with a stub that
// answers the two queries it makes, so this runs anywhere and needs no
// database — and it still runs the real function rather than reading its
// source, which is the lesson from the last three bugs in this codebase.
//
//   node test-blog-report.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');
const { execFileSync } = require('child_process');

let passed = 0, failed = 0;
const DECLARED = 102;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}\n        ${err.message}`);
    failed++;
  }
}

async function atest(name, fn) {
  try {
    await fn();
    console.log(`  ok    ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}\n        ${err.message}`);
    failed++;
  }
}

const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');

/* ------------------------------------------------------------------ *
 * A stand-in for the two models, injected before the route loads.
 *
 * Mongoose would want a connection and the schemas would want an index
 * build; neither has anything to do with whether the report is right.
 * ------------------------------------------------------------------ */

const DB = { sites: [], campaigns: [] };

function chainable(rows) {
  const api = {
    sort() { return api; },
    // The route projects two fields to build the filter dropdowns. The stub
    // hands back the whole document, which is fine — nothing under test reads
    // a field the projection would have dropped.
    select() { return api; },
    lean() { return Promise.resolve(rows); },
    then(resolve, reject) { return Promise.resolve(rows).then(resolve, reject); },
  };
  return api;
}

/* A Router that KEEPS the handlers it is given.
 *
 * It used to throw them away, on the reasoning that express is not what is
 * being tested — true, but it meant the route handler itself was never run by
 * anything, and the report's two empty pages live in the handler and nowhere
 * else. One of them shipped wrong: filter to a state with no matches and the
 * page announced "Nothing yet. Once a campaign publishes its first post..."
 * to an account with forty-eight posts, and dropped the filter bar with it.
 *
 * Every pure helper around it passed. Keeping the handlers costs four lines.
 */
const ROUTES = {};

function fakeRouter() {
  const r = function () {};
  r.get = (route, ...rest) => { ROUTES[`GET ${route}`] = rest[rest.length - 1]; return r; };
  r.post = (route, ...rest) => { ROUTES[`POST ${route}`] = rest[rest.length - 1]; return r; };
  r.use = () => r;
  return r;
}

/** Run a route handler and hand back what it sent. */
async function render(route, query = {}) {
  const handler = ROUTES[`GET ${route}`];
  assert.ok(handler, `no handler registered for GET ${route}`);

  const res = {
    statusCode: 200,
    body: '',
    headers: {},
    status(code) { this.statusCode = code; return this; },
    send(payload) { this.body = String(payload); return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    locals: {},
  };

  await handler({ user: { _id: 'u1' }, query, id: 'test-request' }, res);
  return res;
}

const stubs = {
  express: Object.assign(function () { return fakeRouter(); }, { Router: fakeRouter }),
  '../models/BlogSite': { find: () => chainable(DB.sites) },
  /* settleFinishedForUser() is a reconciliation the page runs as it builds.
   * Stubbed as a no-op rather than left out: a stub that throws on a method
   * the route calls takes down every render test, which says "the harness is
   * behind" rather than anything about the report. */
  '../models/BlogCampaign': {
    find: () => chainable(DB.campaigns),
    settleFinishedForUser: () => Promise.resolve(0),
  },
  '../middleware/requireAuth': (req, res, next) => next(),
  '../utils/logger': { log: { error() {}, info() {}, security() {} } },
  '../utils/appHeader': { withAppHeader: html => html },
  '../utils/pageTitle': { pageTitle: name => `${name} · Three Comets` },
};

const realLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) {
    return stubs[request];
  }
  return realLoad.apply(this, arguments);
};

const report = require('./routes/blogReportRoute');

Module._load = realLoad;

const { rowsFor, day, shownDay, esc, stateOf, readFilters } = report;

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

function given({ sites, campaigns }) {
  DB.sites = sites;
  DB.campaigns = campaigns;
}

const SITE_A = { _id: 'site-a', siteUrl: 'roofingamerica.xyz', status: 'revoked' };
const SITE_B = { _id: 'site-b', siteUrl: 'hilltophomeloans.net', status: 'active' };

function slot(over = {}) {
  return Object.assign({
    index: 0,
    topic: 'A Warm Floor Spot',
    targetQuery: 'slab leak detection leander',
    moneyAnchor: 'slab leak detection',
    status: 'published',
    publishAt: new Date('2026-09-12T09:00:00Z'),
    publishedAt: new Date('2026-09-12T09:00:00Z'),
    publishedUrl: 'https://roofingamerica.xyz/warm-floor-spot',
    publishedTitle: 'A Warm Floor Spot Is a Reason to Find the Source',
    credits: 75,
  }, over);
}

function campaign(over = {}) {
  return Object.assign({
    _id: 'c-1',
    site: 'site-a',
    name: 'Slab Leak Detection',
    status: 'active',
    removedAt: null,
    targetPage: { title: 'Slab Leak Detection', url: 'https://roofingamerica.xyz/slab-leak' },
    createdAt: new Date('2026-09-01T00:00:00Z'),
    slots: [slot()],
  }, over);
}

console.log('\nBlog report\n');

/* ------------------------------------------------------------------ *
 * The rows
 * ------------------------------------------------------------------ */

(async () => {

await atest('one row per slot, carrying the money page it links to', async () => {
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const rows = await rowsFor('u1');

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].site, 'roofingamerica.xyz');
  assert.strictEqual(rows[0].moneyPage, 'Slab Leak Detection');
  assert.strictEqual(rows[0].moneyPageUrl, 'https://roofingamerica.xyz/slab-leak');
  assert.strictEqual(rows[0].keyword, 'slab leak detection leander');
  assert.strictEqual(rows[0].anchor, 'slab leak detection');
  assert.strictEqual(rows[0].credits, 75);
});

await atest('A REMOVED CAMPAIGN STILL APPEARS, WITH ITS REMOVAL DATE', async () => {
  /* The reason the record lives on the server at all. The WordPress copy is
   * gone; the posts are usually still up. Dropping these rows would under-
   * report what the customer actually has on their site. */
  given({
    sites: [SITE_A],
    campaigns: [campaign({ removedAt: new Date('2026-09-27T12:00:00Z'), status: 'completed' })],
  });

  const rows = await rowsFor('u1');

  assert.strictEqual(rows.length, 1, 'the removed campaign vanished from the report');
  assert.strictEqual(day(rows[0].removedAt), '2026-09-27');
  assert.strictEqual(rows[0].campaignStatus, 'completed',
    'removal overwrote the status instead of sitting beside it');
});

await atest('removal is a date beside the status, not a replacement for it', async () => {
  // "completed, then removed" and "cancelled halfway, then removed" are
  // different stories. One field cannot hold both.
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', status: 'completed', removedAt: new Date('2026-09-27') }),
      campaign({ _id: 'c-2', status: 'cancelled', removedAt: new Date('2026-09-27') }),
    ],
  });

  const rows = await rowsFor('u1');
  const statuses = rows.map(r => r.campaignStatus).sort();

  assert.deepStrictEqual(statuses, ['cancelled', 'completed']);
});

await atest('THE PAGE A CAMPAIGN FEEDS IS NAMED, NOT LEFT BLANK', async () => {
  /* The report read targetPage.title, which is not in the schema — /plan
   * stores url, keyword and intent and nothing else. So "Links to" and the
   * CSV's links_to_page were blank on every row ever produced: an anchor
   * phrase under an empty heading, and a bare link. */
  given({
    sites: [SITE_A],
    campaigns: [campaign({
      targetPage: { url: 'https://roofingamerica.xyz/slab-leak', keyword: 'slab leak detection austin' },
    })],
  });

  const rows = await rowsFor('u1');

  assert.strictEqual(rows[0].moneyPage, 'slab leak detection austin',
    'the page a campaign feeds has no name');
});

await atest('a stored title still wins over the keyword', async () => {
  // The more human answer, if one is ever stored.
  given({
    sites: [SITE_A],
    campaigns: [campaign({
      targetPage: { url: 'https://x.test/p', keyword: 'slab leak detection austin', title: 'Slab Leak Detection' },
    })],
  });

  assert.strictEqual((await rowsFor('u1'))[0].moneyPage, 'Slab Leak Detection');
});

await atest('a slot that never published still has a row', async () => {
  // A planned post is part of what the customer bought. Listing only the
  // published ones would hide a campaign that stalled.
  given({
    sites: [SITE_A],
    campaigns: [campaign({ slots: [slot({ status: 'pending', publishedAt: null, publishedUrl: '', publishedTitle: '' })] })],
  });

  const rows = await rowsFor('u1');

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].slotStatus, 'pending');
  assert.strictEqual(rows[0].url, '');
  // Falls back to the topic, so the row is never blank.
  assert.strictEqual(rows[0].topic, 'A Warm Floor Spot');
});

await atest('newest publication first', async () => {
  given({
    sites: [SITE_A],
    campaigns: [campaign({ slots: [
      slot({ index: 0, publishedAt: new Date('2026-09-12T09:00:00Z'), topic: 'older' }),
      slot({ index: 1, publishedAt: new Date('2026-09-24T09:00:00Z'), topic: 'newer' }),
    ] })],
  });

  const rows = await rowsFor('u1');

  assert.strictEqual(rows[0].topic, 'newer');
  assert.strictEqual(rows[1].topic, 'older');
});

await atest('a campaign whose site record is missing does not crash the report', async () => {
  /* A BlogSite can be deleted while its campaigns survive — the whole point
   * of keeping campaign history. The row should still render, just without a
   * site name, rather than throwing on a null. */
  given({ sites: [], campaigns: [campaign()] });

  const rows = await rowsFor('u1');

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].site, '');
});

await atest('rows span every site, not just one', async () => {
  given({
    sites: [SITE_A, SITE_B],
    campaigns: [
      campaign({ _id: 'c-1', site: 'site-a' }),
      campaign({ _id: 'c-2', site: 'site-b', name: 'Water Softener' }),
    ],
  });

  const rows = await rowsFor('u1');
  const sites = new Set(rows.map(r => r.site));

  assert.strictEqual(sites.size, 2, 'the report is not crossing sites');
});

// Read once, here, because the checks below and the CSV checks further down
// both read it. `const` is not hoisted — declaring it lower would leave every
// test above it throwing on the temporal dead zone.
const source = read('routes/blogReportRoute.js');

/* ------------------------------------------------------------------ *
 * Deleted posts
 *
 * The report said "26 published of 48 planned" for a site carrying 12 posts.
 * Fourteen of those rows named a post that had been deleted weeks earlier,
 * each with a live-looking link and a 75-credit charge against it.
 *
 * The slot's stored status is 'published' and always will be — that is the
 * record of what was written and paid for, and it is correct. What was
 * missing was anything recording that the post is no longer there.
 * ------------------------------------------------------------------ */

await atest('A DELETED POST CARRIES ITS DATE THROUGH TO THE ROW', async () => {
  given({
    sites: [SITE_A],
    campaigns: [campaign({ slots: [slot({ deletedAt: new Date('2026-09-25T10:00:00Z') })] })],
  });

  const rows = await rowsFor('u1');

  assert.strictEqual(day(rows[0].deletedAt), '2026-09-25');
  assert.strictEqual(rows[0].slotStatus, 'published',
    'the stored status was overwritten — it is the record that credits bought something');
});

await atest('a post that is still there has no deleted date', async () => {
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const rows = await rowsFor('u1');

  assert.strictEqual(rows[0].deletedAt, null);
});

test('A DELETED POST IS NOT COUNTED AS PUBLISHED', () => {
  /* The headline is the one line everybody reads, so it is the one that must
   * not flatter. Counting deleted posts as published is exactly how it came
   * to claim 26 for a site carrying 12.
   *
   * Asked of the FUNCTION, not of the source. This used to match a regex
   * against the filter expression, which broke the moment the counts were
   * rewritten even though the behaviour was unchanged — and would equally
   * have passed on a rewrite that broke it. */
  assert.strictEqual(stateOf({ slotStatus: 'published', deletedAt: new Date() }), 'deleted');
  assert.strictEqual(stateOf({ slotStatus: 'published' }), 'published');
});

test('A POST UNDER A REMOVED CAMPAIGN IS NOT COUNTED AS PUBLISHED EITHER', () => {
  /* 26 of the 48 on one real site. The campaign was deleted from its
   * WordPress, so nothing can check whether the posts survive — and most of
   * their links 404. */
  assert.strictEqual(stateOf({ slotStatus: 'published', removedAt: new Date() }), 'removed');
});

test('DELETED BEATS REMOVED, BECAUSE IT IS THE MORE SPECIFIC FACT', () => {
  // A deleted post under a removed campaign: we know it is gone, so say so.
  assert.strictEqual(
    stateOf({ slotStatus: 'published', removedAt: new Date(), deletedAt: new Date() }),
    'deleted',
  );
});

test('THE DEAD LINK IS NOT RENDERED AS A LINK', () => {
  /* The URL is still stored and still looks perfectly good. Following it gets
   * a 404, and a report whose links fail is one nobody trusts again. Only a
   * post that is on the site right now gets an anchor. */
  assert.match(source, /r\.url && r\.state === 'published'/,
    'the post title links for states that are not live');
});

test('THE PILL, THE FILTER AND THE COUNTS SHARE ONE DEFINITION', () => {
  /* Three definitions of "published" would disagree, and the plugin already
   * learned that the expensive way: the same post was "waiting to collect" in
   * one table and "not written yet" in another, on one screen. */
  assert.strictEqual(typeof stateOf, 'function');

  // The pill and the counts render, so they live with the route. The filter
  // is pure, so it lives in utils/blog/reportFilters.js — all three read the
  // one function.
  const filters = read('utils/blog/reportFilters.js');

  assert.match(source, /PILLS\[row\.state \|\| stateOf\(row\)\]/,
    'the pill computes its own idea of the state');
  assert.match(filters, /stateOf\(row\) !== f\.state/,
    'the filter computes its own idea of the state');
  assert.match(source, /r\.state === state/,
    'the counts compute their own idea of the state');
  assert.match(source, /require\('\.\.\/utils\/blog\/reportFilters'\)/,
    'the route defines its own copy instead of importing the shared one');
});

/* ------------------------------------------------------------------ *
 * Filtering
 *
 * Server-side, INSIDE rowsFor(), and the CSV reads the same filters. A
 * browser-side filter over the rendered table would have been quicker to
 * build and would silently break the export — which is the exact drift the
 * shared rowsFor() exists to prevent, arriving by a different door.
 * ------------------------------------------------------------------ */

await atest('FILTERING BY CAMPAIGN RETURNS ONLY THAT CAMPAIGN', async () => {
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', name: 'Slab Leak Detection' }),
      campaign({ _id: 'c-2', name: 'Water Softener' }),
    ],
  });

  const rows = await rowsFor('u1', { campaign: 'Water Softener' });

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].campaign, 'Water Softener');
});

await atest('filtering by site returns only that site', async () => {
  given({
    sites: [SITE_A, SITE_B],
    campaigns: [
      campaign({ _id: 'c-1', site: 'site-a' }),
      campaign({ _id: 'c-2', site: 'site-b' }),
    ],
  });

  const rows = await rowsFor('u1', { site: 'hilltophomeloans.net' });

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].site, 'hilltophomeloans.net');
});

await atest('filtering by state uses the same definition as the pill', async () => {
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', slots: [slot({ deletedAt: new Date('2026-09-25') })] }),
      campaign({ _id: 'c-2', slots: [slot()] }),
    ],
  });

  const deleted = await rowsFor('u1', { state: 'deleted' });
  const published = await rowsFor('u1', { state: 'published' });

  assert.strictEqual(deleted.length, 1);
  assert.strictEqual(deleted[0].state, 'deleted');
  assert.strictEqual(published.length, 1);
});

await atest('"under a removed campaign" is filterable, though it is stored nowhere', async () => {
  /* The state is computed from the campaign's removedAt and the slot's
   * status together. Pushing that into the database query would mean a second
   * definition of it, drifting from the one the pills use. */
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', removedAt: new Date('2026-09-28') }),
      campaign({ _id: 'c-2' }),
    ],
  });

  const rows = await rowsFor('u1', { state: 'removed' });

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].campaign, 'Slab Leak Detection');
});

await atest('A DATE RANGE INCLUDES THE WHOLE OF THE LAST DAY', async () => {
  /* "to=2026-09-12" meaning "up to 00:00 on the 12th" silently drops
   * everything published that day — the day somebody filtering to today cares
   * about most. */
  given({ sites: [SITE_A], campaigns: [campaign()] });   // published 2026-09-12T09:00Z

  const inclusive = await rowsFor('u1', readFilters({ from: '2026-09-12', to: '2026-09-12' }));

  assert.strictEqual(inclusive.length, 1, 'a post published on the end date was excluded');
});

await atest('a date range excludes what falls outside it', async () => {
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const before = await rowsFor('u1', readFilters({ from: '2026-09-13' }));
  const after = await rowsFor('u1', readFilters({ to: '2026-09-11' }));

  assert.strictEqual(before.length, 0);
  assert.strictEqual(after.length, 0);
});

await atest('filters combine rather than override each other', async () => {
  given({
    sites: [SITE_A, SITE_B],
    campaigns: [
      campaign({ _id: 'c-1', site: 'site-a', name: 'Slab Leak Detection' }),
      campaign({ _id: 'c-2', site: 'site-b', name: 'Slab Leak Detection' }),
    ],
  });

  const rows = await rowsFor('u1', { campaign: 'Slab Leak Detection', site: 'roofingamerica.xyz' });

  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].site, 'roofingamerica.xyz');
});

/* ------------------------------------------------------------------ *
 * Campaign status — a DIFFERENT question from post state
 * ------------------------------------------------------------------ */

await atest('CAMPAIGN STATUS IS FILTERABLE SEPARATELY FROM POST STATE', async () => {
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', name: 'Done',    status: 'completed' }),
      campaign({ _id: 'c-2', name: 'Going',   status: 'active' }),
      campaign({ _id: 'c-3', name: 'Stopped', status: 'cancelled' }),
      campaign({ _id: 'c-4', name: 'Held',    status: 'paused' }),
    ],
  });

  const names = async campaignStatus =>
    (await rowsFor('u1', readFilters({ campaignStatus }))).map(r => r.campaign);

  assert.deepStrictEqual(await names('completed'), ['Done']);
  assert.deepStrictEqual(await names('running'), ['Going']);
  assert.deepStrictEqual(await names('cancelled'), ['Stopped']);
  assert.deepStrictEqual(await names('paused'), ['Held']);
});

await atest('draft, writing and active all read as in progress', async () => {
  // Stages of the same thing. Somebody asking "what is still going?" does not
  // distinguish them, and three near-identical dropdown entries would only
  // make the box harder to use.
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', name: 'D', status: 'draft' }),
      campaign({ _id: 'c-2', name: 'W', status: 'writing' }),
      campaign({ _id: 'c-3', name: 'A', status: 'active' }),
    ],
  });

  const rows = await rowsFor('u1', readFilters({ campaignStatus: 'running' }));

  assert.deepStrictEqual(rows.map(r => r.campaign).sort(), ['A', 'D', 'W']);
});

await atest('A REMOVED CAMPAIGN KEEPS THE STATUS IT HAD WHEN IT WAS REMOVED', async () => {
  /* THE POINT OF STORING REMOVAL AS A DATE. Collapsing 'removed' into the
   * status list would make "completed, then deleted from WordPress" and
   * "cancelled halfway, then deleted" the same row, and the report exists to
   * tell those apart. */
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', name: 'Finished then removed',  status: 'completed', removedAt: new Date('2026-09-28') }),
      campaign({ _id: 'c-2', name: 'Abandoned then removed', status: 'cancelled', removedAt: new Date('2026-09-28') }),
    ],
  });

  const done = await rowsFor('u1', readFilters({ campaignStatus: 'completed' }));

  assert.deepStrictEqual(done.map(r => r.campaign), ['Finished then removed'],
    'removal swallowed the status the campaign had when it was removed');
});

await atest('campaign status and post state COMPOSE rather than override', async () => {
  // The combination a single merged dropdown could not express: campaigns
  // that finished their run and were then deleted from WordPress.
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', name: 'Finished and removed', status: 'completed', removedAt: new Date('2026-09-28') }),
      campaign({ _id: 'c-2', name: 'Finished, still there', status: 'completed' }),
      campaign({ _id: 'c-3', name: 'Running and removed', status: 'active', removedAt: new Date('2026-09-28') }),
    ],
  });

  const rows = await rowsFor('u1', readFilters({ campaignStatus: 'completed', state: 'removed' }));

  assert.deepStrictEqual(rows.map(r => r.campaign), ['Finished and removed']);
});

await atest('the campaign status box is on the page, beside the post state box', async () => {
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const res = await render('/blog-report', {});

  assert.ok(res.body.includes('name="campaignStatus"'), 'the campaign status filter is missing');
  assert.ok(res.body.includes('name="state"'), 'the post state filter went away');
  assert.ok(res.body.includes('>In progress<'), 'the in-progress option is missing');
  assert.ok(res.body.includes('>Completed<'), 'the completed option is missing');
});

/* ------------------------------------------------------------------ *
 * The two tabs
 *
 * "How many campaigns did I remove, when, and how big were they" cannot be
 * answered by filtering a list of posts. The removal date sits on every one
 * of a campaign's rows, so counting campaigns meant reading thirty-six lines
 * and deduplicating by eye.
 * ------------------------------------------------------------------ */

await atest('THE REPORT SETTLES FINISHED CAMPAIGNS AS IT BUILDS', async () => {
  /* A campaign whose posts have all gone live is finished, and this side can
   * see that from its own slots without asking anybody. It used to be decided
   * only when a site reported in — and a site with nothing new to say
   * correctly stays quiet, so two campaigns with every post live sat at
   * "In progress" through four deploys and a dozen presses of the button,
   * with both ends behaving perfectly. */
  given({ sites: [SITE_A], campaigns: [campaign()] });

  let calledFor = null;
  const real = stubs['../models/BlogCampaign'].settleFinishedForUser;
  stubs['../models/BlogCampaign'].settleFinishedForUser = id => {
    calledFor = String(id);
    return Promise.resolve(0);
  };

  await render('/blog-report', {});

  stubs['../models/BlogCampaign'].settleFinishedForUser = real;

  assert.strictEqual(calledFor, 'u1',
    'the report does not repair stale campaign statuses as it builds');
});

await atest('THE REPORT HAS A CAMPAIGNS TAB AND A POSTS TAB', async () => {
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const res = await render('/blog-report', {});

  assert.ok(res.body.includes('>Campaigns'), 'the campaigns tab is missing');
  assert.ok(res.body.includes('>Posts'), 'the posts tab is missing');
});

await atest('THE TABS LOOK LIKE TABS', async () => {
  /* The first version carried its state in an underline and nothing else.
   * Quiet, tidy, and invisible: the reader never saw them and went looking
   * for the posts list in the filter bar instead. A control nobody notices is
   * not a subtle control, it is a missing one. */
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const res = await render('/blog-report', {});

  assert.ok(/\.report-tab\s*\{[^}]*border:/.test(res.body),
    'the tabs have no border, so they do not read as tabs');
  assert.ok(/\.report-tab\s*\{[^}]*border-radius:/.test(res.body),
    'the tabs have no tab shape');
  assert.ok(res.body.includes('report-tab-on'), 'no tab is marked as the current one');
});

await atest('the way into a campaign is a green button, not another grey one', async () => {
  // It sits in a table of muted text and dotted underlines; a light outline
  // disappeared into it.
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const res = await render('/blog-report', {});

  assert.ok(res.body.includes('btn-outline-success'), 'the Check posts button is not marked out');
});

await atest('ONE LINE PER CAMPAIGN, NOT PER POST', async () => {
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', name: 'Slab Leak Detection', slots: [slot(), slot({ index: 1 }), slot({ index: 2 })] }),
      campaign({ _id: 'c-2', name: 'Water Softener', slots: [slot(), slot({ index: 1 })] }),
    ],
  });

  const res = await render('/blog-report', {});

  /* COUNTED INSIDE <tbody>, because the campaign name is also an <option> in
   * the filter dropdown above. Counting the whole page said three and read
   * exactly like the bug this test is named after. */
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(res.body)[1];

  // Five posts, two campaigns. One line each.
  assert.strictEqual((body.match(/Slab Leak Detection/g) || []).length, 1,
    'a campaign was listed once per post');
  assert.strictEqual((body.match(/<tr>/g) || []).length, 2,
    'the campaigns tab is showing post rows');
  assert.ok(body.includes('Water Softener'), 'a campaign is missing from the tab');
});

await atest('A REMOVED CAMPAIGN\'S STATUS IS SAID IN THE PAST', async () => {
  /* The table read "In progress" beside a removal date, for seven campaigns
   * that do not exist anywhere. A removed campaign's status is frozen at the
   * moment it was deleted — the hourly sweep reports the campaigns a site
   * still HAS, so a removed one is never mentioned again by anyone. */
  given({
    sites: [SITE_A],
    campaigns: [campaign({ status: 'active', removedAt: new Date('2026-09-28') })],
  });

  const res = await render('/blog-report', {});
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(res.body)[1];

  assert.ok(body.includes('Was in progress'),
    'a removed campaign still claims to be in progress');

  /* THE STATUS CELL, not just the page. text-danger is already on the removal
   * date beside it, so asking whether the body contains it at all answers
   * nothing — and a mutation putting the status back to muted grey passed. */
  const flat = body.replace(/\s+/g, ' ');

  assert.match(flat, /<td class="text-danger"[^>]*>\s*Was in progress\s*<\/td>/,
    'the status of a removed campaign is not marked out');
});

await atest('a live campaign is still said in the present', async () => {
  given({ sites: [SITE_A], campaigns: [campaign({ status: 'active' })] });

  const res = await render('/blog-report', {});
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(res.body)[1];

  assert.ok(body.includes('In progress'), 'a running campaign lost its status');
  assert.ok(!body.includes('Was in progress'), 'a live campaign was described as removed');
});

await atest('FINISHED-THEN-REMOVED READS DIFFERENTLY FROM CUT-SHORT', async () => {
  /* The whole reason removal is a date rather than a status: these are two
   * different stories and the table has to tell them apart. */
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', name: 'Ran its course', status: 'completed', removedAt: new Date('2026-09-28') }),
      campaign({ _id: 'c-2', name: 'Cut short', status: 'active', removedAt: new Date('2026-09-28') }),
    ],
  });

  const res = await render('/blog-report', {});
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(res.body)[1];

  assert.ok(body.includes('Was completed'), 'a finished campaign lost that fact');
  assert.ok(body.includes('Was in progress'), 'an unfinished campaign lost that fact');
});

await atest('THE CAMPAIGNS TAB SHOWS THE REMOVAL DATE', async () => {
  /* The whole reason the tab exists: how many were removed, and when. */
  given({
    sites: [SITE_A],
    campaigns: [campaign({ removedAt: new Date('2026-09-28T10:00:00Z') })],
  });

  const res = await render('/blog-report', {});

  /* mm-dd-yyyy on screen, Edwin's format. The ISO spelling is asserted to be
   * ABSENT as well: a page printing both would satisfy a test that only
   * looked for one, and "2026-09-28" appearing anywhere in this table would
   * mean a date cell somewhere still reads the machine format. */
  assert.ok(res.body.includes('09-28-2026'), 'the removal date is not on the campaign line');
  assert.ok(!res.body.includes('>2026-09-28<'), 'a date cell is still printing ISO');
});

await atest('the campaigns tab counts a campaign\'s posts', async () => {
  given({
    sites: [SITE_A],
    campaigns: [campaign({
      slots: [
        slot(),
        slot({ index: 1 }),
        slot({ index: 2, deletedAt: new Date('2026-09-20') }),
      ],
    })],
  });

  const res = await render('/blog-report', {});

  // Whitespace collapsed first: a cell wrapped across lines is the same cell,
  // and a test that breaks on indentation is a test nobody trusts.
  const row = /<tbody>([\s\S]*?)<\/tbody>/.exec(res.body)[1]
    .replace(/>\s+/g, '>').replace(/\s+</g, '<');

  assert.ok(row.includes('>3</td>'), 'the post count is wrong');
  assert.ok(row.includes('>2</td>'), 'the live count is wrong');
});

await atest('REMOVED CAMPAIGNS SORT TO THE TOP', async () => {
  // The tab exists mostly to answer questions about them.
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', name: 'Still here' }),
      campaign({ _id: 'c-2', name: 'Long gone', removedAt: new Date('2026-09-28') }),
    ],
  });

  const res = await render('/blog-report', {});

  /* INSIDE <tbody> AGAIN. The filter dropdown lists campaigns alphabetically,
   * so "Long gone" precedes "Still here" on the page whatever the table does
   * — and a test reading the whole body passed with the sort deleted. */
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(res.body)[1];

  assert.ok(body.indexOf('Long gone') < body.indexOf('Still here'),
    'a removed campaign was buried below a live one');
});

await atest('THE SAME CAMPAIGN NAME ON TWO SITES IS TWO LINES', async () => {
  /* An agency running "Emergency Plumber" for four clients has four
   * campaigns, not one with the posts of four sites piled together. */
  given({
    sites: [SITE_A, SITE_B],
    campaigns: [
      campaign({ _id: 'c-1', site: 'site-a', name: 'Emergency Plumber' }),
      campaign({ _id: 'c-2', site: 'site-b', name: 'Emergency Plumber' }),
    ],
  });

  const res = await render('/blog-report', {});
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(res.body)[1];

  assert.strictEqual((body.match(/<tr>/g) || []).length, 2,
    'two sites\' campaigns were merged into one line');
  assert.ok(body.includes('roofingamerica.xyz') && body.includes('hilltophomeloans.net'),
    'both sites are not shown');
});

await atest('EVERY CAMPAIGN HAS A CHECK POSTS BUTTON', async () => {
  given({ sites: [SITE_A], campaigns: [campaign({ _id: 'c-1', name: 'Slab Leak Detection' })] });

  const res = await render('/blog-report', {});

  assert.ok(res.body.includes('Check posts'), 'the button is missing');
  assert.ok(res.body.includes('view=posts') && res.body.includes('campaignId=c-1'),
    'the button does not open that campaign\'s posts');
});

await atest('DRILLING IN GOES BY ID, NOT BY NAME', async () => {
  /* Two campaigns can share a name on one site — re-planning a money page
   * does it, and this account has three such pairs. A drill-through filtered
   * by name showed both campaigns' posts with no way to tell them apart,
   * which is the one question the button exists to answer. */
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', name: 'Residential Plumbing', slots: [slot()] }),
      campaign({ _id: 'c-2', name: 'Residential Plumbing', slots: [slot(), slot({ index: 1 })] }),
    ],
  });

  const rows = await rowsFor('u1', readFilters({ campaignId: 'c-2' }));

  assert.strictEqual(rows.length, 2,
    'filtering by campaign id returned the other campaign\'s posts too');
});

await atest('the name filter still browses by name', async () => {
  // The dropdown is a browse: pick a name, see everything that ever ran under
  // it. That is a different question from drilling into one line.
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', name: 'Residential Plumbing', slots: [slot()] }),
      campaign({ _id: 'c-2', name: 'Residential Plumbing', slots: [slot()] }),
    ],
  });

  const rows = await rowsFor('u1', readFilters({ campaign: 'Residential Plumbing' }));

  assert.strictEqual(rows.length, 2, 'the name filter stopped browsing by name');
});

await atest('an empty result from a campaign id still keeps the filter bar', async () => {
  // anyFilter() has to know about this one too, or it falls back into the
  // brand-new-account page with no way out. That door has been opened twice.
  given({ sites: [SITE_A], campaigns: [campaign({ _id: 'c-1' })] });

  const res = await render('/blog-report', { campaignId: 'nope', view: 'posts' });

  assert.ok(!res.body.includes('Nothing yet'),
    'an unmatched campaign id claimed the account is empty');
  assert.ok(res.body.includes('No posts match those filters'));
});

await atest('THE POSTS TAB IS STILL THE OLD TABLE', async () => {
  // The guard against the tabs quietly replacing what was there.
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const res = await render('/blog-report', { view: 'posts' });

  assert.ok(res.body.includes('A Warm Floor Spot'), 'the posts table lost its rows');
  assert.ok(res.body.includes('Published'), 'the state pill is gone');
});

await atest('A POST STATE TAKES YOU TO THE POSTS TAB', async () => {
  /* The filter bar asks two questions at once — Campaign status is about
   * campaigns, Post state is about articles. Picking "Deleted from site" on
   * the campaigns tab changed the counts in the table and nothing else, so
   * pressing Filter looked like it had done nothing at all.
   *
   * Nobody picks a post state wanting a list of campaigns. */
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const res = await render('/blog-report', { view: 'campaigns', state: 'published' });

  assert.ok(res.body.includes('A Warm Floor Spot'),
    'a post state left the reader looking at campaigns');
});

await atest('the campaigns tab is unaffected by anything else', async () => {
  // Campaign status is a campaign question and belongs on this tab. Only a
  // POST state means the reader has switched subject.
  given({ sites: [SITE_A], campaigns: [campaign({ status: 'active' })] });

  const res = await render('/blog-report', { view: 'campaigns', campaignStatus: 'running' });
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(res.body)[1];

  assert.ok(body.includes('Check posts'), 'a campaign filter threw the reader onto the posts tab');
});

await atest('FILTERING KEEPS YOU ON THE TAB YOU WERE ON', async () => {
  /* The form posts every box on the screen. Without the tab riding along,
   * pressing Filter on the posts tab silently threw you back to campaigns. */
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const res = await render('/blog-report', { view: 'posts' });

  assert.ok(res.body.includes('<input type="hidden" name="view" value="posts">'),
    'the tab is not carried through the filter form');
});

await atest('the CSV link carries the tab too', async () => {
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const res = await render('/blog-report', { view: 'posts' });

  assert.ok(res.body.includes('/blog-report.csv?view=posts'),
    'the export link dropped the tab');
});

await atest('TWO CAMPAIGNS SHARING A NAME ON ONE SITE STAY APART', async () => {
  /* Re-planning the same money page produces exactly this. Grouping the tab
   * by name merged them, so six removed campaigns showed as four — on a page
   * whose own headline said six, in the same sentence. */
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', name: 'Water Softener', removedAt: new Date('2026-09-28') }),
      campaign({ _id: 'c-2', name: 'Water Softener' }),
    ],
  });

  const res = await render('/blog-report', {});
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(res.body)[1];

  assert.strictEqual((body.match(/<tr>/g) || []).length, 2,
    'two campaigns with one name were merged into a single line');
});

await atest('THE HEADLINE AND THE TAB CANNOT DISAGREE ABOUT REMOVALS', async () => {
  /* They did, in public: "7 campaigns · 4 removed ... 36 under 6 removed
   * campaigns". Both numbers were computed honestly and one was wrong, which
   * means neither can be trusted again. */
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', name: 'Water Softener', removedAt: new Date('2026-09-28') }),
      campaign({ _id: 'c-2', name: 'Water Softener', removedAt: new Date('2026-09-28') }),
      campaign({ _id: 'c-3', name: 'Slab Leak' }),
    ],
  });

  const res = await render('/blog-report', {});
  const line = res.body.match(/<p class="muted mb-4">([\s\S]*?)<\/p>/)[1].replace(/<[^>]*>/g, ' ');

  const headline = /(\d+)\s+removed/.exec(line);
  const under = /under\s+(\d+)\s+removed campaigns?/.exec(line);

  assert.ok(headline, 'the headline does not say how many campaigns were removed');
  assert.ok(under, 'the headline does not say how many posts sit under them');

  assert.strictEqual(headline[1], under[1],
    `the two removal counts disagree: ${headline[1]} and ${under[1]}`);

  /* AND BOTH ARE RIGHT. Checking only that they agree passes when they are
   * wrong together — which is exactly what happened when both counted
   * distinct NAMES and two removed campaigns shared one. */
  assert.strictEqual(headline[1], '2',
    `two campaigns were removed, the headline says ${headline[1]}`);
});

await atest('A REMOVED CAMPAIGN SHOWS UNKNOWN, NOT ZERO, FOR LIVE POSTS', async () => {
  /* Its posts are almost certainly still up — the note under the table says
   * so — but the site stopped tracking them. "0" beside "12 posts" reads as
   * "this campaign produced nothing", the same lie the headline used to tell
   * with "0 published of 36". Unknown is not zero. */
  given({
    sites: [SITE_A],
    campaigns: [campaign({ removedAt: new Date('2026-09-28'), slots: [slot(), slot({ index: 1 })] })],
  });

  const res = await render('/blog-report', {});
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(res.body)[1];

  assert.ok(!/>\s*0\s*</.test(body), 'a removed campaign reports zero live posts');
  assert.ok(body.includes('&mdash;'), 'nothing marks the live count as unknowable');
});

await atest('THE CAMPAIGN STATUS BOX OFFERS REMOVED', async () => {
  /* Where people look for it. Removal is a date rather than a status, and
   * that distinction is real — but it is not worth making somebody hunt
   * three times for the filter they came to use. */
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const res = await render('/blog-report', {});

  assert.ok(res.body.includes('<option value="removed">Removed</option>'),
    'the campaign status box does not offer Removed');
});

await atest('CAMPAIGN STATUS "REMOVED" MATCHES EVERY REMOVED CAMPAIGN', async () => {
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', name: 'Gone, finished', status: 'completed', removedAt: new Date('2026-09-28') }),
      campaign({ _id: 'c-2', name: 'Gone, running', status: 'active', removedAt: new Date('2026-09-28') }),
      campaign({ _id: 'c-3', name: 'Still here', status: 'completed' }),
    ],
  });

  const rows = await rowsFor('u1', readFilters({ campaignStatus: 'removed' }));

  assert.deepStrictEqual(rows.map(r => r.campaign).sort(), ['Gone, finished', 'Gone, running'],
    'the removed filter did not match on the removal date');
});

await atest('ASKING FOR REMOVED DOES NOT HIDE IT FROM THE OTHER STATUSES', async () => {
  /* THE DISTINCTION THAT HAD TO SURVIVE. Removal is stored as a date so that
   * "completed, then deleted" and "cancelled halfway, then deleted" stay
   * tellable apart. Folding it into campaignStatusOf() would make Completed
   * silently drop every completed campaign since removed. */
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', name: 'Finished then removed', status: 'completed', removedAt: new Date('2026-09-28') }),
      campaign({ _id: 'c-2', name: 'Finished, still here', status: 'completed' }),
    ],
  });

  const rows = await rowsFor('u1', readFilters({ campaignStatus: 'completed' }));

  assert.deepStrictEqual(rows.map(r => r.campaign).sort(),
    ['Finished then removed', 'Finished, still here'],
    'a completed campaign vanished from Completed because it had been removed');
});

await atest('EVERY OPTION IS A STATUS SOMETHING ACTUALLY WRITES', async () => {
  /* This box used to offer 'cancelled', which nothing anywhere set — a filter
   * guaranteed to return nothing, for everybody, for ever. It also offered
   * 'paused' meaning "the licence was revoked", because the plugin never told
   * this side about a pause at all.
   *
   * Both are real now: the plugin's hourly reconciliation carries each
   * campaign's status, so pausing and cancelling in wp-admin reach this side
   * on their own. The rule the old test was defending still holds — offer
   * only what something writes — and the list simply got longer. */
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const res = await render('/blog-report', {});

  for (const [value, label] of [
    ['running', 'In progress'],
    ['paused', 'Paused'],
    ['completed', 'Completed'],
    ['cancelled', 'Cancelled'],
    ['removed', 'Removed'],
  ]) {
    assert.ok(res.body.includes(`<option value="${value}">${label}</option>`),
      `the campaign status box does not offer ${label}`);
  }

  assert.ok(!res.body.includes('Site disconnected'),
    'the old euphemism for paused is still on the screen');
});

await atest('A PAUSED CAMPAIGN IS FILTERABLE AS PAUSED', async () => {
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', name: 'Held', status: 'paused' }),
      campaign({ _id: 'c-2', name: 'Going', status: 'active' }),
    ],
  });

  const rows = await rowsFor('u1', readFilters({ campaignStatus: 'paused' }));

  assert.deepStrictEqual(rows.map(r => r.campaign), ['Held']);
});

await atest('A CANCELLED CAMPAIGN IS FILTERABLE AS CANCELLED', async () => {
  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', name: 'Abandoned', status: 'cancelled' }),
      campaign({ _id: 'c-2', name: 'Going', status: 'active' }),
    ],
  });

  const rows = await rowsFor('u1', readFilters({ campaignStatus: 'cancelled' }));

  assert.deepStrictEqual(rows.map(r => r.campaign), ['Abandoned']);
});

await atest('the campaigns tab says Paused rather than Site disconnected', async () => {
  given({ sites: [SITE_A], campaigns: [campaign({ status: 'paused' })] });

  const res = await render('/blog-report', {});
  const body = /<tbody>([\s\S]*?)<\/tbody>/.exec(res.body)[1];

  assert.ok(body.includes('Paused'), 'a paused campaign is not labelled');
});

await atest('an abandoned campaign would NOT read as in progress', async () => {
  /* Not offered in the dropdown, but still mapped. If anything ever starts
   * writing 'cancelled', it must not fall through to 'running' and quietly
   * report an abandoned campaign as under way. */
  given({ sites: [SITE_A], campaigns: [campaign({ status: 'cancelled' })] });

  const rows = await rowsFor('u1', readFilters({ campaignStatus: 'running' }));

  assert.strictEqual(rows.length, 0,
    'a cancelled campaign is counted as in progress');
});

await atest('AN EMPTY CAMPAIGN-STATUS RESULT IS STILL NOT AN EMPTY ACCOUNT', async () => {
  /* THE SAME DEAD END, THROUGH A NEW DOOR. anyFilter() decides which of the
   * two empty pages is right, and a filter it does not know about falls
   * straight back into the brand-new-account message with the bar stripped
   * off. A mutation removing campaignStatus from anyFilter() passed every
   * other test in this file, which is exactly how the first one shipped. */
  given({ sites: [SITE_A], campaigns: [campaign({ status: 'active' })] });

  const res = await render('/blog-report', { campaignStatus: 'cancelled' });

  assert.ok(!res.body.includes('Nothing yet'),
    'a campaign-status filter that matched nothing claimed the account is empty');
  assert.ok(res.body.includes('No posts match those filters'));
  assert.ok(res.body.includes('name="campaignStatus"'), 'the bar went away again');
  assert.ok(res.body.includes('Clear'), 'there is no way to clear the filter');
});

await atest('THE CSV CARRIES THE CAMPAIGN STATUS FILTER TOO', async () => {
  /* The export has to match the screen it came from — the same drift the
   * shared rowsFor() exists to stop, arriving through the download link. */
  given({ sites: [SITE_A], campaigns: [campaign({ status: 'completed' })] });

  const res = await render('/blog-report', { campaignStatus: 'completed' });

  assert.ok(res.body.includes('campaignStatus=completed'),
    'the CSV link drops the campaign status, so the export stops matching the page');
});

await atest('no filters means everything, exactly as before', async () => {
  given({ sites: [SITE_A], campaigns: [campaign({ slots: [slot(), slot({ index: 1 })] })] });

  assert.strictEqual((await rowsFor('u1')).length, 2);
});

test('THE DATE BOUNDARIES ARE UTC, WHATEVER THE SERVER\'S TIMEZONE IS', () => {
  /* THE BUG THIS PINS, and why it is run in a CHILD PROCESS.
   *
   * A date-only string parses as UTC midnight. setHours() works in LOCAL
   * time. Mixing them made "to=2026-09-12" mean 04:59Z in Chicago, so a post
   * published at 09:00Z that day fell outside its own date and vanished from
   * the report with nothing to say it had been dropped.
   *
   * ON A UTC MACHINE THE BUG DOES NOT EXIST — setHours and setUTCHours are
   * the same call — so no test running in this process can see it. It shipped
   * green from a UTC container and failed the moment the suite ran on a laptop
   * in Texas. The only way to catch it anywhere is to force a timezone, and
   * TZ has to be set before the process starts.
   *
   * So: a child, in a zone with a large offset, asserting the instants rather
   * than filtering rows — a row test only fails in the zones where the bug
   * bites, which is what let it hide in the first place. */
  const script = `
    const { readFilters } = require('${path.join(__dirname, 'utils/blog/reportFilters.js').replace(/\\/g, '/')}');
    const f = readFilters({ from: '2026-09-12', to: '2026-09-12' });
    process.stdout.write(f.from.toISOString() + ' ' + f.to.toISOString());
  `;

  const out = execFileSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    env: { ...process.env, TZ: 'America/Chicago' },
  }).trim();

  assert.strictEqual(out, '2026-09-12T00:00:00.000Z 2026-09-12T23:59:59.999Z',
    `date boundaries drift with the server timezone — got ${out}`);
});

/* ------------------------------------------------------------------ *
 * The two empty pages
 *
 * THE BUG: filtering to a state with no matches produced the brand-new-
 * account page — "Nothing yet. Once a campaign publishes its first post..." —
 * on an account with forty-eight posts, AND dropped the filter bar, so the
 * only way back was the browser's Back arrow.
 *
 * An empty RESULT and an empty ACCOUNT are different facts. These are
 * rendered rather than grepped, because every pure helper involved was
 * already correct when this shipped.
 * ------------------------------------------------------------------ */

await atest('AN EMPTY RESULT IS NOT AN EMPTY ACCOUNT', async () => {
  // Posts exist; none of them is deleted. Exactly Edwin's screenshot.
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const res = await render('/blog-report', { state: 'deleted' });

  assert.ok(!res.body.includes('Nothing yet'),
    'a filter that matched nothing claimed the account has never published');
  assert.ok(res.body.includes('No posts match those filters'),
    'the page does not say why it is empty');
});

await atest('a truly empty account still gets the welcome page', async () => {
  // The other half of the same decision — this message has to survive, or the
  // fix above has just broken a first-run screen to mend a filtered one.
  given({ sites: [], campaigns: [] });

  const res = await render('/blog-report', {});

  assert.ok(res.body.includes('Nothing yet'),
    'a brand-new account lost its welcome message');
  assert.ok(res.body.includes('/blog-sites'),
    'the way to get started is gone');
});

await atest('A FILTERED-EMPTY PAGE KEEPS THE TABS', async () => {
  /* Same reason it keeps the filter bar. Filtering to nothing stripped the
   * tabs off, so the one screen where a reader most wants to go and look
   * somewhere else was the one screen with no way to move. */
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const res = await render('/blog-report', { state: 'deleted' });

  assert.ok(res.body.includes('report-tabs'), 'the tab strip is gone');
  assert.ok(res.body.includes('report-tab-on'), 'no tab is marked as the current one');
  assert.ok(res.body.includes('view=posts'), 'there is no way to the posts tab');
});

await atest('A FILTERED-EMPTY PAGE KEEPS THE FILTER BAR', async () => {
  /* The part that made it a dead end rather than a wrong sentence. Without
   * the bar there is no Clear, no other state to pick, and no way back. */
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const res = await render('/blog-report', { state: 'deleted' });

  assert.ok(res.body.includes('name="state"'), 'the state filter is gone');
  assert.ok(res.body.includes('name="campaign"'), 'the campaign filter is gone');
  assert.ok(res.body.includes('href="/blog-report"'),
    'there is no way back to every post');
});

await atest('THE DROPDOWNS STILL OFFER EVERY CAMPAIGN AND SITE WHEN NOTHING MATCHED', async () => {
  /* Built from the rows on screen, these would empty themselves exactly when
   * the reader most needs to change their mind. So they are built from
   * everything the user has, filters or no filters. */
  given({
    sites: [SITE_A, SITE_B],
    campaigns: [
      campaign({ _id: 'c-1', site: 'site-a', name: 'Slab Leak Detection' }),
      campaign({ _id: 'c-2', site: 'site-b', name: 'Water Softener' }),
    ],
  });

  const res = await render('/blog-report', { state: 'failed' });

  assert.ok(res.body.includes('Slab Leak Detection'), 'a campaign vanished from the dropdown');
  assert.ok(res.body.includes('Water Softener'), 'a campaign vanished from the dropdown');
  assert.ok(res.body.includes('hilltophomeloans.net'), 'a site vanished from the dropdown');
});

await atest('the chosen filter is still selected on the empty page', async () => {
  // Otherwise the page says "no matches" while the box reads "Any state",
  // and the reader cannot tell what they asked for.
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const res = await render('/blog-report', { state: 'deleted' });

  assert.match(res.body, /<option value="deleted" selected>/,
    'the state that produced the empty page is not shown as chosen');
});

await atest('THE DROPDOWN OFFERS THE SAME NAME THE ROWS CARRY', async () => {
  /* A campaign with no name falls back to its money page title. If the
   * dropdown and the rows derive that separately they drift, and selecting
   * such a campaign returns nothing — indistinguishable, on screen, from a
   * campaign that genuinely has no posts. */
  given({
    sites: [SITE_A],
    campaigns: [campaign({ name: '', targetPage: { title: 'Water Softener Repair', url: 'https://x.test/ws' } })],
  });

  const res = await render('/blog-report', {});
  const rows = await rowsFor('u1');

  assert.strictEqual(rows[0].campaign, 'Water Softener Repair');
  assert.ok(res.body.includes('<option value="Water Softener Repair"'),
    'the dropdown names the campaign differently from the rows it filters');
});

await atest('a filtered page that DOES match still shows the table', async () => {
  // The guard against fixing the empty case by making every page empty.
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const res = await render('/blog-report', { state: 'published', view: 'posts' });

  assert.ok(!res.body.includes('No posts match those filters'));
  assert.ok(res.body.includes('<table'), 'the table is gone from a page with matches');
  assert.ok(res.body.includes('A Warm Floor Spot'), 'the matching row is missing');
});

await atest('THE HEADLINE LEADS WITH THE POST COUNT, NOT THE CONFIRMED COUNT', async () => {
  /* It used to open "0 published of 36" on an account holding thirty-six real
   * articles — every one of which HAD published, before its campaign was
   * deleted from WordPress and the site stopped tracking it. The caution is
   * right; leading with the 0 was not. */
  given({
    sites: [SITE_A],
    campaigns: [campaign({ status: 'completed', removedAt: new Date('2026-09-28') })],
  });

  const res = await render('/blog-report', {});
  const line = res.body.match(/<p class="muted mb-4">([\s\S]*?)<\/p>/)[1].replace(/<[^>]*>/g, ' ');

  assert.match(line, /1\s+post\b/, 'the headline no longer leads with how many posts there are');
  assert.match(line, /0\s+confirmed live/, 'the verifiable count is gone');

  /* AND NO CREDIT TOTAL. Every post costs the same, so the figure was the
   * post count times 75 — no information the line did not already carry, and
   * a money number in front of somebody who opened the page to find out what
   * is live. The per-row figure stays in the CSV, which is where anybody
   * actually adds them up. */
  assert.ok(!/credits/i.test(line), 'the credit total is back in the headline');
  assert.ok(!/^\s*0\s+published of/.test(line),
    'the headline still opens with a bare 0 in front of real articles');
});

await atest('one post is not "1 posts"', async () => {
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const res = await render('/blog-report', {});

  assert.ok(!res.body.includes('1 posts'), 'the plural is not guarded');
});

test('A BAD DATE IS IGNORED, NOT AN ERROR PAGE', () => {
  /* This arrives in a URL somebody may have hand-edited or kept in a
   * bookmark. Refusing it helps nobody. */
  const f = readFilters({ from: 'not-a-date', to: '', campaign: '  ' });

  assert.strictEqual(f.from, null);
  assert.strictEqual(f.to, null);
  assert.strictEqual(f.campaign, '');
});

/* ------------------------------------------------------------------ *
 * The CSV
 * ------------------------------------------------------------------ */

test('THE PAGE AND THE CSV READ THE SAME FUNCTION', () => {
  /* Two separate queries would drift, and the drift would be invisible until
   * somebody compared a screen against a spreadsheet. */
  assert.strictEqual((source.match(/await rowsFor\(req\.user\._id/g) || []).length, 2,
    'the page and the CSV are not both built from rowsFor()');

  // And both must apply the SAME filters, or the export stops matching the
  // screen it came from — which is the drift the shared function exists to
  // prevent, arriving by a different door.
  assert.strictEqual((source.match(/readFilters\(req\.query\)/g) || []).length, 2,
    'the page and the CSV do not both read the filters');
});

test('CSV INJECTION IS BLOCKED', () => {
  /* A post title is customer data from a WordPress install we do not control.
   * "=HYPERLINK(...)" in a title becomes a live formula the moment the file
   * opens in Excel — on the machine of the person running this report. */
  assert.match(source, /\/\^\[=\+\\-@\\t\\r\]\//,
    'the formula guard is gone, so a post title starting with = is executable');
});

test('quotes inside a field are doubled, not dropped', () => {
  assert.match(source, /replace\(\/"\/g, '""'\)/);
});

test('the file carries a BOM so Excel reads it as UTF-8', () => {
  // Without it, every accented character in a post title arrives mangled on
  // Windows — and these are local business names.
  assert.match(source, /const EXCEL_BOM = '\\uFEFF';/,
    'the BOM constant is gone, or went back to a raw invisible character');
  assert.match(source, /res\.send\( *EXCEL_BOM \+ lines/);
});

test('every column in the header has a value in the row', () => {
  // A header and a row of different lengths silently shifts every column.
  const header = source.match(/const header = \[([\s\S]*?)\];/)[1];
  const values = source.match(/lines\.push\(\[([\s\S]*?)\]\.map\(cell\)/)[1];

  /* COMMENTS ARE STRIPPED FIRST, because this counts commas in source text
   * and prose is full of them. A comment inside either array inflated the
   * count and failed a correct change — and the same weakness could just as
   * easily have hidden a real mismatch behind a comma in a comment. */
  const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const count = s => strip(s).split(',').map(x => x.trim()).filter(Boolean).length;

  assert.strictEqual(count(header), count(values),
    `header has ${count(header)} columns, the row has ${count(values)}`);
});

/* ------------------------------------------------------------------ *
 * Wired, not just written
 * ------------------------------------------------------------------ */

test('THE ROUTE IS MOUNTED, or the page is a 404', () => {
  const server = read('server.js');

  assert.match(server, /require\('\.\/routes\/blogReportRoute'\)/);
  assert.match(server, /app\.use\('\/', requireAuth, blogReportRoute\)/,
    'the report is not mounted behind requireAuth');
});

test('the router is exported the way server.js mounts it', () => {
  // module.exports = { router } would break app.use() with a confusing error.
  assert.strictEqual(typeof report, 'function', 'the route no longer exports a router');
  assert.strictEqual(typeof report.rowsFor, 'function');
});

test('there is a way to reach it from the sites page', () => {
  const sites = read('routes/blogSitesRoute.js');
  assert.match(sites, /href="\/blog-report"/,
    'nothing links to the report, so nobody will find it');
});

/* ------------------------------------------------------------------ *
 * Row numbers
 *
 * A number is meant to be a NAME — something to say out loud or put in an
 * email and have the other person find the same row. That only works if it
 * is the same number for everybody, which means it cannot be a position in
 * the filtered list: post 12 becoming post 3 when somebody picks a site from
 * the dropdown is the failure this whole design is arranged to avoid.
 * ------------------------------------------------------------------ */

console.log('\nRow numbers\n');

/** Three campaigns across two sites, six posts, all distinguishable. */
function numbered() {
  const at = d => new Date(`2026-09-${d}T09:00:00Z`);

  given({
    sites: [SITE_A, SITE_B],
    campaigns: [
      campaign({
        _id: 'c-1', site: 'site-a', name: 'Slab Leak Detection',
        slots: [
          slot({ index: 0, topic: 'A1', publishedAt: at(20), publishAt: at(20) }),
          slot({ index: 1, topic: 'A2', publishedAt: at(14), publishAt: at(14) }),
        ],
      }),
      campaign({
        _id: 'c-2', site: 'site-b', name: 'Water Cleanup',
        targetPage: { title: 'Water Cleanup', url: 'https://hilltophomeloans.net/water' },
        slots: [
          slot({ index: 0, topic: 'B1', publishedAt: at(18), publishAt: at(18) }),
          slot({ index: 1, topic: 'B2', publishedAt: at(10), publishAt: at(10) }),
        ],
      }),
      campaign({
        _id: 'c-3', site: 'site-a', name: 'Mold Mitigation',
        targetPage: { title: 'Mold Mitigation', url: 'https://roofingamerica.xyz/mold' },
        slots: [
          slot({ index: 0, topic: 'C1', publishedAt: at(16), publishAt: at(16) }),
          slot({ index: 1, topic: 'C2', publishedAt: at(12), publishAt: at(12) }),
        ],
      }),
    ],
  });
}

await atest('EVERY POST IS NUMBERED, 1 THROUGH N', async () => {
  numbered();

  const rows = await rowsFor('u1', {});

  assert.deepStrictEqual(rows.map(r => r.n), [1, 2, 3, 4, 5, 6],
    'the posts are not numbered 1..6 in the order they are shown');

  // ...and in the order the table actually sorts them: newest first.
  assert.deepStrictEqual(rows.map(r => r.topic), ['A1', 'B1', 'C1', 'A2', 'C2', 'B2'],
    'the numbering does not follow the sort the reader sees');
});

await atest('A FILTER RENUMBERS FROM 1 — IT IS A ROW COUNTER', async () => {
  /* This asserted the exact opposite first. The numbers were made stable
   * across filters, so a filtered report read 2, 6, 17 and a row kept its
   * number whatever was hidden — an identifier, which is a different and
   * more interesting thing than what was asked for.
   *
   * What was asked for is what a numbered list normally does: count the rows
   * in front of you. "Row 7" means the seventh line on the screen.
   *
   * SO THE SAME POST HAS A DIFFERENT NUMBER UNDER A DIFFERENT FILTER, and
   * that is correct. The number describes a position in a list, not a post.
   * Spelled out here because it looks like a bug to anybody who meets it
   * without this sentence. */
  numbered();

  const all = await rowsFor('u1', {});
  assert.deepStrictEqual(all.map(r => r.n), [1, 2, 3, 4, 5, 6], 'the full list is not 1..6');

  const justB = await rowsFor('u1', { site: 'hilltophomeloans.net' });

  assert.deepStrictEqual(justB.map(r => r.topic), ['B1', 'B2'], 'the filter did not apply');
  assert.deepStrictEqual(justB.map(r => r.n), [1, 2],
    'a filtered report is carrying the numbers from the unfiltered one');

  // B1 is row 2 unfiltered and row 1 filtered. Asserted directly, because
  // "the rows are numbered 1..n" is also true of a list that never changed.
  assert.strictEqual(all.find(r => r.topic === 'B1').n, 2);
});

await atest('CAMPAIGN NUMBERS FOLLOW THE CAMPAIGNS TAB, NOT THE POST LIST', async () => {
  /* The campaigns tab re-sorts — removed first, then by last activity — so
   * numbering campaigns by where they first appear among the POSTS would
   * give a tab whose numbers run down the page out of order. */
  numbered();

  const rows = await rowsFor('u1', {});
  const seen = new Map();
  for (const r of rows) if (!seen.has(r.campaign)) seen.set(r.campaign, r.campaignN);

  assert.deepStrictEqual([...seen.values()].sort((a, b) => a - b), [1, 2, 3],
    'the three campaigns are not numbered 1..3');

  const html = (await render('/blog-report')).body;
  const shown = [...html.matchAll(/<td class="rownum">(\d+)<\/td>/g)].map(m => Number(m[1]));

  assert.deepStrictEqual(shown, [1, 2, 3],
    'the campaigns tab does not show its numbers in order down the page');
});

await atest('AND THE TWO ORDERS ARE NOT THE SAME ORDER', async () => {
  /* The test above could not tell the two implementations apart, and passed
   * a mutation that numbered campaigns by where they first appear among the
   * posts. With no removed campaigns both orders agree, so the fixture had
   * nothing to say — the same fault as a fixture whose pages had distinct
   * titles AND distinct urls.
   *
   * A REMOVED CAMPAIGN SEPARATES THEM. The campaigns tab puts removed first
   * whatever their dates; the post list does not care. So a campaign that is
   * removed but whose newest post is NOT the newest overall comes out first
   * on the tab and third in the posts, and the two orderings disagree. */
  const at = d => new Date(`2026-09-${d}T09:00:00Z`);

  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-1', name: 'Newest', removedAt: null,
        slots: [slot({ topic: 'N1', publishedAt: at(20), publishAt: at(20) })] }),
      campaign({ _id: 'c-2', name: 'Middle', removedAt: null,
        slots: [slot({ topic: 'M1', publishedAt: at(18), publishAt: at(18) })] }),
      campaign({ _id: 'c-3', name: 'Gone', removedAt: at(28),
        slots: [slot({ topic: 'G1', publishedAt: at(16), publishAt: at(16) })] }),
    ],
  });

  const rows = await rowsFor('u1', {});

  // Post order is by publication: Newest, Middle, Gone.
  assert.deepStrictEqual(rows.map(r => r.campaign), ['Newest', 'Middle', 'Gone'],
    'the posts are not in publication order');

  // Campaign order is removed-first: Gone, Newest, Middle.
  const number = new Map(rows.map(r => [r.campaign, r.campaignN]));
  assert.deepStrictEqual(
    [number.get('Gone'), number.get('Newest'), number.get('Middle')], [1, 2, 3],
    'campaigns were numbered by the post list rather than by the campaigns tab');

  // ...and that is what the tab prints, top to bottom.
  const html = (await render('/blog-report')).body;
  const shown = [...html.matchAll(/<td class="rownum">(\d+)<\/td>\s*<td>\s*<a[^>]*>([^<]+)</g)]
    .map(m => [Number(m[1]), m[2].trim()]);

  assert.deepStrictEqual(shown, [[1, 'Gone'], [2, 'Newest'], [3, 'Middle']],
    'the numbers do not run in order down the campaigns tab');
});

await atest('the campaigns tab counts its rows the same way', async () => {
  numbered();

  const all = (await render('/blog-report')).body;
  assert.deepStrictEqual(
    [...all.matchAll(/<td class="rownum">(\d+)<\/td>/g)].map(m => Number(m[1])),
    [1, 2, 3], 'the unfiltered campaigns tab is not 1..3');

  const one = (await render('/blog-report', { campaign: 'Mold Mitigation' })).body;

  assert.deepStrictEqual(
    [...one.matchAll(/<td class="rownum">(\d+)<\/td>/g)].map(m => Number(m[1])),
    [1], 'the one surviving campaign did not become row 1');
});

await atest('THE CSV CARRIES THE SAME NUMBERS THE PAGE SHOWS', async () => {
  /* The export exists so somebody can quote a row back at you. A number that
   * only exists on the web page is the one thing they cannot quote. */
  numbered();

  const rows = await rowsFor('u1', { site: 'hilltophomeloans.net' });
  const csv = (await render('/blog-report.csv', { site: 'hilltophomeloans.net' })).body;

  const [head, ...body] = csv.replace(/^﻿/, '').trim().split('\r\n');
  const cols = head.split(',');

  assert.strictEqual(cols[0], 'post_number', 'the CSV does not lead with the post number');
  assert.ok(cols.includes('campaign_number'), 'the CSV has no campaign number');

  const postCol = cols.indexOf('post_number');
  const campCol = cols.indexOf('campaign_number');
  const cell = (line, i) => line.split(',')[i].replace(/^"|"$/g, '');

  assert.deepStrictEqual(body.map(l => Number(cell(l, postCol))), rows.map(r => r.n),
    'the CSV and the page disagree about which row is which');
  assert.deepStrictEqual(body.map(l => Number(cell(l, postCol))), [1, 2],
    'the CSV of a filtered report is not numbered 1..n');
  assert.deepStrictEqual(body.map(l => Number(cell(l, campCol))), rows.map(r => r.campaignN),
    'the CSV campaign numbers do not match the page');
});

await atest('THE CAMPAIGNS TAB SHOWS WHEN EACH ONE WAS APPROVED', async () => {
  /* APPROVED, NOT CREATED, and the difference is the whole point. Creation
   * is when the plan was drawn up — a draft, nothing written, nothing
   * charged, and it may never be approved at all. Approval is when the
   * writing was enqueued and the credits went. "When did this campaign
   * start" means the second one.
   *
   * Two campaigns on one site can share a name, and this account has several
   * such pairs; the approval date is what tells them apart at a glance. */
  const planned  = new Date('2026-08-04T10:00:00Z');
  const approved = new Date('2026-08-21T14:00:00Z');
  const published = new Date('2026-09-10T09:00:00Z');

  given({
    sites: [SITE_A],
    campaigns: [
      campaign({
        _id: 'c-live', name: 'quality plumbing leander',
        createdAt: planned,
        batch: { startedAt: approved },
        slots: [slot({ topic: 'Older', publishedAt: published, publishAt: published })],
      }),
    ],
  });

  const html = (await render('/blog-report')).body;

  assert.match(html, /<th>Approved<\/th>/, 'the campaigns tab has no Approved column');
  assert.ok(html.includes(shownDay(approved)), 'the approval date is not shown');

  /* ALL THREE DATES ARE DIFFERENT IN THIS FIXTURE, which is the only thing
   * that makes the assertion mean anything. A version showing the planning
   * date, or the publication date, would also "show a date" — and both would
   * be wrong. */
  assert.ok(!html.includes(shownDay(planned)),
    'the column is showing the planning date, not the approval date');

  const rows = await rowsFor('u1', {});
  assert.strictEqual(day(rows[0].campaignApprovedAt), day(approved));
  assert.notStrictEqual(day(approved), day(planned), 'the fixture cannot tell the two apart');
  assert.notStrictEqual(day(approved), day(published), 'the fixture cannot tell the two apart');
});

await atest('a campaign nobody has approved yet shows a dash', async () => {
  /* A REAL ANSWER, not missing data: planned, not started, credits still
   * yours. A blank cell reads as a page that failed to render. */
  given({
    sites: [SITE_A],
    campaigns: [campaign({
      _id: 'c-draft', status: 'draft',
      createdAt: new Date('2026-09-02T10:00:00Z'),
      slots: [slot({ status: 'pending', publishedAt: null, publishedUrl: '', publishedTitle: '' })],
    })],
  });

  const rows = await rowsFor('u1', {});
  assert.strictEqual(rows[0].campaignApprovedAt, null, 'an unapproved campaign carries a date');

  const html = (await render('/blog-report')).body;
  assert.ok(html.includes('&mdash;'), 'the unapproved campaign has an empty cell, not a dash');
});

await atest('and the CSV carries both dates', async () => {
  /* The planning date stays in the export even though the screen dropped it.
   * A campaign that sat unapproved for three weeks is a fact about the
   * customer that only the two dates together can tell. */
  const planned  = new Date('2026-08-04T10:00:00Z');
  const approved = new Date('2026-08-21T14:00:00Z');

  given({
    sites: [SITE_A],
    campaigns: [campaign({ createdAt: planned, batch: { startedAt: approved } })],
  });

  const csv = (await render('/blog-report.csv')).body;
  const [head, row] = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
  const cols = head.split(',');
  const cell = i => row.split(',')[i].replace(/^"|"$/g, '');

  assert.ok(cols.includes('campaign_created_date'), 'the CSV lost the planning date');
  assert.ok(cols.includes('campaign_approved_date'), 'the CSV has no approval date');

  assert.strictEqual(cell(cols.indexOf('campaign_created_date')), day(planned));
  assert.strictEqual(cell(cols.indexOf('campaign_approved_date')), day(approved));
});


await atest('THE DATE BOXES STILL SPEAK ISO, OR THE FILTER SILENTLY EMPTIES', async () => {
  /* THE REASON day() WAS NOT SIMPLY REFORMATTED.
   *
   * The screen shows mm-dd-yyyy now. Three of day()'s callers are not screen
   * text, and the worst of them is <input type="date">: the HTML spec
   * requires its value to be yyyy-mm-dd, and a browser given anything else
   * does not complain — it renders the box EMPTY. Reformatting day() would
   * have left somebody who filtered to a date range looking at a filter bar
   * that appeared to have forgotten it, with the table filtered anyway.
   *
   * The query string is the same story: readFilters() parses from= and to=
   * with /^(\d{4})-(\d{2})-(\d{2})$/, so a reformatted link would fall
   * through to Date's loose parsing, and "09-28-2026" is not a date it
   * reliably reads. */
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const html = (await render('/blog-report', { from: '2026-09-01', to: '2026-09-30' })).body;

  assert.match(html, /name="from"[^>]*value="2026-09-01"/,
    'the From box is not carrying an ISO value — it will render empty');
  assert.match(html, /name="to"[^>]*value="2026-09-30"/,
    'the To box is not carrying an ISO value — it will render empty');

  // The CSV link this page builds has to survive readFilters() on the way back.
  assert.ok(html.includes('from=2026-09-01') && html.includes('to=2026-09-30'),
    'the CSV link carries dates the filter parser cannot read');
});

await atest('the CSV keeps ISO dates, whatever the screen shows', async () => {
  /* Not a copy of the screen, on purpose. ISO sorts correctly as plain text
   * and is the one spelling a spreadsheet cannot read as the wrong day:
   * 09-10 is the 9th of October to most of the world and the 10th of
   * September here, and the file says nothing about which was meant. */
  given({
    sites: [SITE_A],
    campaigns: [campaign({ removedAt: new Date('2026-09-28T10:00:00Z') })],
  });

  const csv = (await render('/blog-report.csv')).body;

  assert.ok(csv.includes('2026-09-28'), 'the CSV is no longer using ISO dates');
  assert.ok(!csv.includes('09-28-2026'), 'the display format leaked into the export');

  assert.match(String((await render('/blog-report.csv')).headers['content-disposition']),
    /blog-report-\d{4}-\d{2}-\d{2}\.csv/, 'the filename no longer sorts by date');
});


/* ------------------------------------------------------------------ *
 * The date column says which kind of date it is
 *
 * From Edwin's own export: eight rows with published_date empty and
 * planned_date filled, every one of them `scheduled`, under two removed
 * campaigns. The screen showed eight dates in a column headed PUBLISHED,
 * immediately under a headline reading "0 confirmed live".
 *
 * The CSV was right the whole time. Only the screen conflated the two, and
 * nothing here asserted the cell at all — the fix passed 94 tests without
 * changing one of them, which is how it stayed wrong.
 * ------------------------------------------------------------------ */

console.log('\nThe date column\n');

await atest('A PUBLISHED POST SHOWS ITS DATE PLAINLY', async () => {
  given({
    sites: [SITE_A],
    campaigns: [campaign({
      slots: [slot({
        status: 'published',
        publishAt:   new Date('2026-09-12T09:00:00Z'),
        publishedAt: new Date('2026-09-12T09:00:00Z'),
      })],
    })],
  });

  const html = (await render('/blog-report', { view: 'posts' })).body;

  assert.ok(html.includes('09-12-2026'), 'the publication date is missing');
  assert.ok(!html.includes('due 09-12-2026'), 'a published post is marked as merely due');
});

await atest('A POST THAT HAS NOT PUBLISHED IS MARKED DUE', async () => {
  /* Edwin's case exactly: scheduled, never published, campaign since
   * removed. The planned date is worth showing — it is the main reason to
   * look at a scheduled row — but not under a claim that it happened. */
  given({
    sites: [SITE_A],
    campaigns: [campaign({
      removedAt: new Date('2026-09-28T10:00:00Z'),
      slots: [slot({
        status: 'scheduled',
        publishAt:   new Date('2026-09-16T09:00:00Z'),
        publishedAt: null,
        publishedUrl: '',
        publishedTitle: '',
      })],
    })],
  });

  const html = (await render('/blog-report', { view: 'posts' })).body;

  assert.ok(html.includes('due 09-16-2026'),
    'the planned date is not marked as planned');

  /* AND THE BARE DATE IS ABSENT. Asserting "due" is present would pass just
   * as well on a page printing both — which is the shape the bug had. */
  assert.ok(!/>\s*09-16-2026/.test(html),
    'the date is still shown bare somewhere, as though it had happened');
});

await atest('THE HEADING NO LONGER PROMISES MORE THAN THE COLUMN DELIVERS', async () => {
  given({ sites: [SITE_A], campaigns: [campaign()] });

  const html = (await render('/blog-report', { view: 'posts' })).body;

  assert.ok(html.includes('<th>Date</th>'), 'the column has no heading');
  assert.ok(!html.includes('<th>Published</th>'),
    'the column still claims every date in it is a publication date');
});

await atest('eight scheduled posts do not read as eight published ones', async () => {
  /* The whole export, reproduced: two campaigns, four scheduled posts each,
   * both removed. The headline and the table have to agree. */
  const at = d => new Date(`2026-09-${d}T09:00:00Z`);
  const four = start => [0, 1, 2, 3].map(i => slot({
    index: i,
    topic: `T${start + i}`,
    status: 'scheduled',
    publishAt: at(start + i),
    publishedAt: null,
    publishedUrl: '',
    publishedTitle: '',
  }));

  given({
    sites: [SITE_A],
    campaigns: [
      campaign({ _id: 'c-a', name: 'Commercial Kitchen Faucet Installation',
        removedAt: at(28), slots: four(13) }),
      campaign({ _id: 'c-b', name: 'Slab Leak Detection',
        removedAt: at(28), slots: four(13) }),
    ],
  });

  const html = (await render('/blog-report', { view: 'posts' })).body;

  assert.ok(html.includes('0 confirmed live'), 'the headline changed meaning');

  const due = (html.match(/due \d\d-\d\d-\d{4}/g) || []).length;
  assert.strictEqual(due, 8, `expected 8 dates marked due, got ${due}`);
});


await atest('THE ANCHOR TEXT SAYS WHAT IT IS', async () => {
  /* Quotation marks alone do not name the thing. A grey quoted fragment
   * under a page name reads as a subtitle or a tagline; that it is the
   * clickable words carrying the link is the one fact somebody auditing
   * this page came for. */
  given({
    sites: [SITE_A],
    campaigns: [campaign({ slots: [slot({ moneyAnchor: 'what the work involves' })] })],
  });

  const html = (await render('/blog-report', { view: 'posts' })).body;

  assert.ok(html.includes('Anchor text: &ldquo;what the work involves&rdquo;'),
    'the anchor phrase is shown without saying that is what it is');
});

await atest('A POST THAT PUBLISHED BEFORE ITS CAMPAIGN WENT SAYS SO', async () => {
  /* Two facts that look contradictory side by side: a real publication date
   * next to a pill reading "Campaign removed". The order reconciles them —
   * it went out, THEN the campaign was deleted — and the pill has one word
   * to work with, so the row has to say it. */
  given({
    sites: [SITE_A],
    campaigns: [campaign({
      removedAt: new Date('2026-09-28T10:00:00Z'),
      slots: [slot({
        status: 'published',
        publishAt:   new Date('2026-09-20T09:00:00Z'),
        publishedAt: new Date('2026-09-20T09:00:00Z'),
      })],
    })],
  });

  const html = (await render('/blog-report', { view: 'posts' })).body;

  assert.ok(html.includes('09-20-2026'), 'the publication date is gone');
  assert.ok(html.includes('published, but the campaign was removed'),
    'nothing explains a real date beside a "Campaign removed" pill');
});

await atest('and a post that NEVER published does not claim it did', async () => {
  /* The note must not fire on a row reading "due". Explaining a publication
   * that did not happen is the fault this whole column was fixed for. */
  given({
    sites: [SITE_A],
    campaigns: [campaign({
      removedAt: new Date('2026-09-28T10:00:00Z'),
      slots: [slot({
        status: 'scheduled',
        publishAt:   new Date('2026-09-14T09:00:00Z'),
        publishedAt: null,
        publishedUrl: '',
        publishedTitle: '',
      })],
    })],
  });

  const html = (await render('/blog-report', { view: 'posts' })).body;

  assert.ok(html.includes('due 09-14-2026'), 'the planned date is not marked due');
  assert.ok(!html.includes('published, but the campaign was removed'),
    'a post that never published is described as published');
});

await atest('a published post on a LIVE campaign gets no note', async () => {
  // Nothing happened to it, so there is nothing to explain.
  given({
    sites: [SITE_A],
    campaigns: [campaign({
      removedAt: null,
      slots: [slot({
        status: 'published',
        publishedAt: new Date('2026-09-20T09:00:00Z'),
      })],
    })],
  });

  const html = (await render('/blog-report', { view: 'posts' })).body;

  assert.ok(!html.includes('the campaign was removed'),
    'an ordinary published post carries a note about nothing');
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);

if (passed + failed !== DECLARED) {
  console.log(`  MISCOUNT: ${passed + failed} ran, ${DECLARED} declared`);
  process.exit(1);
}

console.log('');
process.exit(failed === 0 ? 0 : 1);

})();
