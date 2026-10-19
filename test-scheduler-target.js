// test-scheduler-target.js
//
// Who the scheduler knocks on the door of.
//
// WHY THIS EXISTS
//
// Every minute, tick() asks "which sites have work waiting?" and sends each
// one a signed POST to <site>/wp-json/interlink/v1/run. That path is
// WordPress. The signature is built from the site's secret.
//
// A Cloudflare blog has neither. It has no WordPress, no plugin, no secret —
// and nothing in the site query excludes it. So the first time a Cloudflare
// campaign is approved, the scheduler starts knocking on a WordPress door
// that does not exist, signing with `String(undefined)`, and counting the
// failures against the blog until it gives up on it for good.
//
// Nothing crashes. Nothing appears on any screen. That is the problem.
//
// THE TRAP IN THE OBVIOUS FIX
//
// `target: 'wordpress'` looks right and is wrong. The field has
// `default: 'wordpress'`, but a Mongoose default is applied when a document
// is SAVED — it does not reach back and fill documents already in the
// database. Rows created before `target` existed have no `target` at all,
// and that spelling would not match a single one of them. Every legacy
// WordPress site would quietly stop being pinged.
//
// It is the same mistake as the licenceKeyHash index, one layer up: a
// missing field is not the same as the default value.
//
// HOW THIS IS TESTED
//
// The query is captured as tick() builds it, then run against fixture
// documents with `sift` — the same operators MongoDB would apply, evaluated
// here. So these are not assertions about the shape of an object; they are
// assertions about which sites get knocked on.
//
//   node test-scheduler-target.js

const assert = require('assert');
const sift = require('sift').default || require('sift');

const scheduler = require('./utils/blogScheduler');
const BlogSite = require('./models/BlogSite');
const BlogCampaign = require('./models/BlogCampaign');
const BlogPost = require('./models/BlogPost');

let passed = 0, failed = 0;

const queue = [];
function test(name, fn) {
  queue.push(() => fn()
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }));
}
function section(n) { queue.push(async () => console.log(`\n${n}\n`)); }

/* ------------------------------------------------------------------------
 * Fixtures: the three kinds of row that are actually in the database
 * --------------------------------------------------------------------- */

const WP_ID     = '507f1f77bcf86cd799439001';
const LEGACY_ID = '507f1f77bcf86cd799439002';
const CF_ID     = '507f1f77bcf86cd799439003';

function sites() {
  return [
    {
      _id: WP_ID, siteUrl: 'wordpress.example', status: 'active',
      pingFailures: 0, target: 'wordpress',
    },
    {
      /* NO `target` KEY AT ALL. Not 'wordpress', not null — absent. This is
       * what a row created before the field existed looks like, and the
       * live database has them. */
      _id: LEGACY_ID, siteUrl: 'legacy.example', status: 'active',
      pingFailures: 0,
    },
    {
      _id: CF_ID, siteUrl: 'static.example', status: 'active',
      pingFailures: 0, target: 'cloudflare',
    },
  ];
}

/* ------------------------------------------------------------------------
 * Run one tick and capture the query it builds
 * --------------------------------------------------------------------- */

/**
 * Returns the object tick() passed to BlogSite.find.
 *
 * find is stubbed to return NOTHING, so the loop body never runs and no
 * ping is ever attempted. The query is the whole subject here; what tick()
 * does with the sites it gets back is other tests' business.
 */
async function captureQuery() {
  let captured = null;

  const campaigns = sites().map((s, i) => ({
    _id: `507f1f77bcf86cd7994390${10 + i}`,
    site: s._id,
    status: 'writing',
    slots: [],
  }));

  BlogCampaign.find = () => ({
    select: () => ({ lean: async () => campaigns }),
  });

  // sweepArticles runs first, every tick. It must find nothing to delete.
  BlogPost.find = () => ({ select: () => ({ lean: async () => [] }) });
  BlogPost.deleteMany = async () => ({ deletedCount: 0 });
  BlogCampaign.updateMany = async () => ({ modifiedCount: 0 });

  BlogSite.find = async (where) => { captured = where; return []; };
  BlogSite.updateOne = async () => ({ modifiedCount: 1 });

  await scheduler.tick();

  assert.ok(captured, 'tick() never queried for sites — the fixtures are wrong, not the code');
  return captured;
}

/** Which of the three fixture rows does this query actually select? */
function selected(query) {
  return sites().filter(sift(query)).map(s => s._id);
}

/* ======================================================================= */

section('WHO GETS KNOCKED ON');

test('a WordPress site with work is pinged', async () => {
  const query = await captureQuery();
  assert.ok(selected(query).includes(WP_ID), 'the scheduler stopped pinging WordPress sites');
});

test('AND SO IS A ROW WITH NO target FIELD AT ALL', async () => {
  /* The legacy row. If this ever fails, every site created before `target`
   * existed has gone silent — no posts collected, no posts published, and
   * not one error anywhere to say so. It is the most expensive way this
   * change could go wrong and the easiest to not notice. */
  const query = await captureQuery();
  assert.ok(selected(query).includes(LEGACY_ID),
    'a site created before `target` existed is no longer pinged');
});

test('A CLOUDFLARE BLOG IS NOT', async () => {
  /* It has no WordPress to answer /wp-json/interlink/v1/run and no secret
   * to sign with — pingSite would sign with String(undefined) and count the
   * failure against the blog. */
  const query = await captureQuery();
  assert.ok(!selected(query).includes(CF_ID),
    'a Cloudflare blog is on the ping list');
});

section('AND THE RULES THAT WERE ALREADY THERE');

test('the gap rule survives — two $or keys would silently eat one', async () => {
  /* An object literal cannot hold two `$or` keys: the second wins and the
   * first is gone, with no error. The gap rule is the one that would be
   * lost, and losing it means pinging every site on every tick. */
  const query = await captureQuery();

  const fresh = { _id: WP_ID, siteUrl: 'wordpress.example', status: 'active',
                  pingFailures: 0, target: 'wordpress', lastPingAt: new Date() };

  assert.ok(![fresh].filter(sift(query)).length,
    'a site pinged seconds ago is on the list again — the lastPingAt rule was dropped');
});

test('a suspended site is still left alone', async () => {
  const query = await captureQuery();
  const off = { _id: WP_ID, siteUrl: 'wordpress.example', status: 'suspended',
                pingFailures: 0, target: 'wordpress' };

  assert.ok(![off].filter(sift(query)).length, 'a suspended site is being pinged');
});

test('and so is one that has failed too many times', async () => {
  const query = await captureQuery();
  const dead = { _id: WP_ID, siteUrl: 'wordpress.example', status: 'active',
                 pingFailures: 99, target: 'wordpress' };

  assert.ok(![dead].filter(sift(query)).length,
    'a site that has failed 99 pings is still being knocked on');
});

test('and one with no address at all', async () => {
  const query = await captureQuery();
  const blank = { _id: WP_ID, siteUrl: '', status: 'active',
                  pingFailures: 0, target: 'wordpress' };

  assert.ok(![blank].filter(sift(query)).length, 'a site with no URL is being pinged');
});

/* ======================================================================= */

(async () => {
  for (const run of queue) await run();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
