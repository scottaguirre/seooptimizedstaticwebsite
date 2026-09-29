/**
 * test-blog-sites-delete.js
 *
 * Removing a dead licence from the Blog Automation list.
 *
 * WHY THIS IS THE DANGEROUS BUTTON ON THAT PAGE
 *
 * A BlogCampaign's `site` is required. Delete the row its campaigns point at
 * and they reference something that no longer exists — and those campaigns
 * are the record of what was CHARGED. The blog report survives it (a row
 * whose site is missing renders with a blank site name; test-blog-report.js
 * covers that) but surviving is not being right: the customer would lose,
 * permanently and irreversibly, the ability to say which site a post was
 * published on. By pressing a tidy-up button.
 *
 * So there are two conditions, and this suite exists to keep them:
 *
 *   revoked only        an active licence is a working site
 *   no campaigns        a licence with history cannot be removed at all
 *
 * plus the ownership scoping, which is in the QUERY rather than in a check
 * afterwards, for the reason the revoke handler above it gives.
 *
 * Express and the models are stubbed. The handler is pulled off a recording
 * Router and called directly, so what is tested is the handler's own logic
 * rather than a description of it.
 *
 * Run:  node test-blog-sites-delete.js
 */

const assert = require('assert');
const Module = require('module');

let passed = 0;
let failed = 0;
const DECLARED = 9;

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

/* ------------------------------------------------------------------ *
 * A Router that remembers what was registered on it
 * ------------------------------------------------------------------ */

const routes = [];

function recordingRouter() {
  const r = function () {};
  r.get = (path, ...handlers) => { routes.push({ method: 'get', path, handlers }); return r; };
  r.post = (path, ...handlers) => { routes.push({ method: 'post', path, handlers }); return r; };
  r.use = () => r;
  return r;
}

const DB = { sites: [], campaigns: 0, deleted: [] };

const stubs = {
  express: Object.assign(function () { return recordingRouter(); }, { Router: recordingRouter }),
  '../models/BlogSite': {
    /* A FIELD THE QUERY DOES NOT MENTION IS NOT FILTERED ON — which is how
     * Mongo behaves, and the only way this stub can detect a guard being
     * removed. An earlier version compared `query.user` unconditionally, so
     * deleting the ownership line from the handler made the stub match
     * NOTHING and the suite failed the wrong tests: it looked like the guard
     * was covered when the stub was simply breaking. */
    findOne: query => Promise.resolve(
      DB.sites.find(s =>
        String(s._id) === String(query._id) &&
        (query.user === undefined || String(s.user) === String(query.user)) &&
        (query.status === undefined || s.status === query.status)
      ) || null,
    ),
    deleteOne: query => {
      DB.deleted.push(String(query._id));
      return Promise.resolve({ deletedCount: 1 });
    },
    findOneAndUpdate: () => Promise.resolve(null),
    find: () => ({ sort: () => ({ lean: () => Promise.resolve([]) }) }),
    countDocuments: () => Promise.resolve(0),
    generateSecret: () => 'x',
    generateLicenceKey: () => 'K',
    hashLicenceKey: () => 'h',
  },
  '../models/BlogCampaign': {
    countDocuments: () => Promise.resolve(DB.campaigns),
    updateMany: () => Promise.resolve({}),
    aggregate: () => Promise.resolve([]),
  },
  '../middleware/requireAuth': (req, res, next) => next(),
  '../utils/blogPricing': { CREDITS_PER_POST: 75 },
  '../utils/pluginPackage': { versionOrNull: () => '0.6.0' },
  '../utils/baseUrl': { baseUrl: () => 'https://threecomets.com' },
  '../utils/logger': { log: { error() {}, info() {}, security() {} } },
  '../utils/appHeader': { withAppHeader: html => html },
  '../utils/pageTitle': { pageTitle: name => name },
};

const realLoad = Module._load;
Module._load = function (request) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return realLoad.apply(this, arguments);
};

require('./routes/blogSitesRoute');

Module._load = realLoad;

/* ------------------------------------------------------------------ *
 * Fixtures
 * ------------------------------------------------------------------ */

const ME = '0123456789abcdef01234567';
const OTHER = 'ffffffffffffffffffffffff';
const SITE = 'aaaaaaaaaaaaaaaaaaaaaaaa';

const deleteRoute = routes.find(r => r.method === 'post' && r.path === '/blog-sites/:id/delete');
const handler = deleteRoute && deleteRoute.handlers[deleteRoute.handlers.length - 1];

function call(id, user = ME) {
  const res = { redirected: null, redirect(to) { this.redirected = to; } };
  return handler({ params: { id }, user: { _id: user }, id: 'req-1' }, res).then(() => res);
}

function given({ status = 'revoked', campaigns = 0, user = ME } = {}) {
  DB.sites = [{ _id: SITE, user, status, siteUrl: 'roofingamerica.xyz' }];
  DB.campaigns = campaigns;
  DB.deleted = [];
}

console.log('\nRemoving a revoked licence\n');

(async () => {

await atest('THE ROUTE IS REGISTERED, or the button posts into nothing', async () => {
  assert.ok(deleteRoute, 'no POST /blog-sites/:id/delete route exists');
  assert.strictEqual(typeof handler, 'function');
});

await atest('a revoked licence with no campaigns is removed', async () => {
  given({ status: 'revoked', campaigns: 0 });

  const res = await call(SITE);

  assert.deepStrictEqual(DB.deleted, [SITE], 'the row was not deleted');
  assert.strictEqual(res.redirected, '/blog-sites');
});

await atest('A REVOKED LICENCE WITH CAMPAIGNS IS KEPT', async () => {
  /* The whole point. Those campaigns are the record of what was charged, and
   * this row is the only thing that says which site their posts went to. */
  given({ status: 'revoked', campaigns: 3 });

  await call(SITE);

  assert.deepStrictEqual(DB.deleted, [], 'a licence with history was deleted');
});

await atest('AN ACTIVE LICENCE IS NEVER REMOVED', async () => {
  // It is a working site. Removing it would break the plugin on it silently.
  given({ status: 'active', campaigns: 0 });

  await call(SITE);

  assert.deepStrictEqual(DB.deleted, [], 'an active licence was deleted');
});

await atest('a suspended licence is not removed either', async () => {
  // Suspension is temporary by design; the row has to come back.
  given({ status: 'suspended', campaigns: 0 });

  await call(SITE);

  assert.deepStrictEqual(DB.deleted, []);
});

await atest('ANOTHER ACCOUNT\'S LICENCE IS NEVER REMOVED', async () => {
  /* The ownership test is in the findOne query, not a separate if. This
   * asserts the query really carries it. */
  given({ status: 'revoked', campaigns: 0, user: OTHER });

  await call(SITE, ME);

  assert.deepStrictEqual(DB.deleted, [], 'it deleted a row belonging to another account');
});

await atest('a malformed id never reaches the database', async () => {
  given({ status: 'revoked', campaigns: 0 });

  const res = await call('not-an-object-id');

  assert.deepStrictEqual(DB.deleted, []);
  assert.strictEqual(res.redirected, '/blog-sites');
});

await atest('an unknown id is refused quietly', async () => {
  given({ status: 'revoked', campaigns: 0 });

  await call('bbbbbbbbbbbbbbbbbbbbbbbb');

  assert.deepStrictEqual(DB.deleted, []);
});

await atest('THE CAMPAIGN COUNT IS READ AT DELETION, NOT TRUSTED FROM THE PAGE', async () => {
  /* The page that drew the button may be minutes old, and a campaign can
   * arrive in between. If this ever stops querying, the button becomes a way
   * to delete a row that has just gained history. */
  let asked = 0;
  stubs['../models/BlogCampaign'].countDocuments = () => {
    asked++;
    return Promise.resolve(0);
  };

  given({ status: 'revoked', campaigns: 0 });
  await call(SITE);

  assert.strictEqual(asked, 1, 'the handler did not count campaigns before deleting');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);

if (passed + failed !== DECLARED) {
  console.log(`  MISCOUNT: ${passed + failed} ran, ${DECLARED} declared`);
  process.exit(1);
}

process.exit(failed === 0 ? 0 : 1);

})();
