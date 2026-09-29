/**
 * test-campaign-reconcile.js
 *
 * BlogCampaign.markMissingRemoved() — the campaign-level reconciliation.
 *
 * WHAT IT IS FOR
 *
 * The plugin's hourly sweep reconciles the SLOTS inside campaigns it holds.
 * A campaign REMOVED from the WordPress is not in its records at all, so
 * nothing walks it, and its posts stay on this side's books forever — counted
 * as published, billed for, and listed in the customer's own report with
 * links that 404.
 *
 * /api/blog/removed reports a removal as it happens, but only from plugin
 * 0.4.4. Everything removed before that was never reported and is reachable
 * by nothing except this reconciliation.
 *
 * WHY THIS SUITE EXISTS SEPARATELY
 *
 * This is the one call in the system that can DESTROY a record rather than
 * correct one — it marks campaigns removed on the strength of an absence, and
 * an absence has several innocent explanations. Two of them are guarded
 * against, and both guards are invisible in the happy path:
 *
 *   the grace window   a campaign is created here during /plan and stored by
 *                      the plugin when it reads the response. In between it
 *                      exists here and nowhere else.
 *
 *   the empty list     a plugin that has lost its options looks exactly like
 *                      a site that has removed everything. Refused in the
 *                      route; see test-blog-report.js and the route's own
 *                      comment.
 *
 * mongoose is NOT loaded. The static is a plain function on the schema, so it
 * is called with a hand-made `this` that records what it was asked to do.
 *
 * Run:  node test-campaign-reconcile.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

let passed = 0;
let failed = 0;
const DECLARED = 30;

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

/* ------------------------------------------------------------------ *
 * Just enough mongoose to let the schema file load.
 *
 * Schema() records nothing; model() hands back the statics bag, which is all
 * this suite needs. Loading the real thing would want a connection and an
 * index build, neither of which has anything to do with whether the rule is
 * right.
 * ------------------------------------------------------------------ */

function FakeSchema() {
  this.statics = {};
  this.methods = {};
  this.index = () => this;
  this.pre = () => this;
  this.post = () => this;
  this.virtual = () => ({ get: () => {}, set: () => {} });
}
FakeSchema.Types = { ObjectId: 'ObjectId', Mixed: 'Mixed' };

const fakeMongoose = {
  Schema: FakeSchema,
  model: (name, schema) => schema.statics,
  Types: { ObjectId: String },
};

const realLoad = Module._load;
Module._load = function (request) {
  if (request === 'mongoose') return fakeMongoose;
  return realLoad.apply(this, arguments);
};

const statics = require('./models/BlogCampaign');

Module._load = realLoad;

const { markMissingRemoved, applyReportedStatuses, settleFinished } = statics;

/* ------------------------------------------------------------------ *
 * A `this` that answers find() and remembers updateMany()
 * ------------------------------------------------------------------ */

const HOUR = 60 * 60 * 1000;
const old = () => new Date(Date.now() - 48 * HOUR);
const justNow = () => new Date();

/**
 * Does a row's status satisfy what the query asked for?
 *
 * HANDLES $in, because the real query uses it. A stub that only understood a
 * bare string reported "no match" for a perfectly good widened query, and
 * three correct tests failed against correct code. Third time this session a
 * stub could not express the thing it was meant to check.
 */
function matchStatus( have, wanted ) {
  if ( wanted === undefined ) return true;
  if ( wanted && Array.isArray( wanted.$in ) ) return wanted.$in.includes( have );
  return have === wanted;
}

function db(campaigns) {
  const calls = [];

  return {
    calls,
    find(query) {
      const rows = campaigns.filter(c => {
        if (String(c.site) !== String(query.site)) return false;
        if (query.removedAt === null && c.removedAt) return false;
        if (query.createdAt && query.createdAt.$lt) {
          if (!(c.createdAt < query.createdAt.$lt)) return false;
        }
        return true;
      });
      return { select: () => ({ lean: () => Promise.resolve(rows) }) };
    },
    updateMany(filter, update) {
      const ids = filter._id.$in.map(String);
      calls.push({ ids, update });
      return Promise.resolve({ modifiedCount: ids.length });
    },

    /* applyReportedStatuses() writes one row at a time and puts the status it
     * read into the filter, so a concurrent change loses rather than being
     * overwritten. The stub honours that: a filter naming a status the row no
     * longer has matches nothing, exactly as Mongo would. */
    updateOne(filter, update) {
      /* TOLERANT OF A MISSING FIELD, on purpose. A stub that REQUIRES the
       * ownership check makes every mutation removing it fail — loudly, and
       * in the wrong tests, which says "the stub broke" rather than "the
       * guard is gone". Each condition is checked only when the caller
       * actually asked for it, exactly as Mongo behaves. */
      const row = campaigns.find(c =>
        String(c._id) === String(filter._id)
        && (filter.site === undefined || String(c.site) === String(filter.site))
        && (filter.status === undefined || c.status === filter.status));

      if (!row) return Promise.resolve({ modifiedCount: 0 });

      calls.push({ id: String(row._id), update });
      Object.assign(row, update.$set);

      return Promise.resolve({ modifiedCount: 1 });
    },
  };
}

/** A find() that also answers the status query, which selects 'status'. */
function statusDb(campaigns) {
  const d = db(campaigns);
  const realFind = d.find;

  d.find = query => {
    /* The completion sweep asks for a site's active campaigns and selects
     * 'slots'. Honoured here rather than falling through, so a test can tell
     * a query that found the right campaigns from one that found none. */
    if (!query._id && query.status) {
      const rows = campaigns.filter(c =>
        String(c.site) === String(query.site)
        && matchStatus( c.status, query.status )
        && (query.removedAt !== null || !c.removedAt));

      return { select: () => ({ lean: () => Promise.resolve(rows) }) };
    }

    if (query._id && query._id.$in) {
      const want = query._id.$in.map(String);
      const rows = campaigns.filter(c =>
        want.includes(String(c._id))
        && (query.site === undefined || String(c.site) === String(query.site))
        /* EVERY CONDITION THE CALLER ASKED FOR, not just the ones this branch
         * was first written for. It honoured _id and site only, so a query
         * scoped to active, un-removed campaigns got back removed ones — and
         * the test for exactly that failed against correct code. A stub that
         * silently drops a condition cannot tell a guard working from a guard
         * missing. */
        && matchStatus( c.status, query.status )
        && (query.removedAt !== null || !c.removedAt));

      return { select: () => ({ lean: () => Promise.resolve(rows) }) };
    }

    return realFind(query);
  };

  return d;
}

console.log('\nCampaign reconciliation\n');

(async () => {

await atest('a campaign the site no longer lists is marked removed', async () => {
  const d = db([
    { _id: 'c-1', site: 's-1', createdAt: old(), removedAt: null },
    { _id: 'c-2', site: 's-1', createdAt: old(), removedAt: null },
  ]);

  const n = await markMissingRemoved.call(d, 's-1', ['c-1']);

  assert.strictEqual(n, 1, 'nothing was marked removed');
  assert.deepStrictEqual(d.calls[0].ids, ['c-2'], 'the wrong campaign was marked');
});

await atest('campaigns the site still lists are left alone', async () => {
  const d = db([
    { _id: 'c-1', site: 's-1', createdAt: old(), removedAt: null },
    { _id: 'c-2', site: 's-1', createdAt: old(), removedAt: null },
  ]);

  const n = await markMissingRemoved.call(d, 's-1', ['c-1', 'c-2']);

  assert.strictEqual(n, 0);
  assert.strictEqual(d.calls.length, 0, 'it wrote to the database with nothing to do');
});

await atest('A CAMPAIGN BORN IN THE LAST HALF HOUR IS SAFE', async () => {
  /* THE RACE THIS GUARD EXISTS FOR. A campaign is created here during /plan
   * and stored by the plugin only when it reads the response. Between those
   * two moments it exists on this side and nowhere else — and a sweep landing
   * in that window would mark a campaign removed on the day it was born, for
   * a customer who is watching the screen. */
  const d = db([
    { _id: 'c-new', site: 's-1', createdAt: justNow(), removedAt: null },
  ]);

  const n = await markMissingRemoved.call(d, 's-1', ['c-other']);

  assert.strictEqual(n, 0, 'a campaign created seconds ago was marked removed');
  assert.strictEqual(d.calls.length, 0);
});

await atest('an older campaign is not protected by the grace window', async () => {
  // The guard must not become a blanket amnesty.
  const d = db([
    { _id: 'c-old', site: 's-1', createdAt: old(), removedAt: null },
  ]);

  const n = await markMissingRemoved.call(d, 's-1', ['c-other']);

  assert.strictEqual(n, 1);
});

await atest('ANOTHER SITE\'S CAMPAIGNS ARE NEVER TOUCHED', async () => {
  /* One customer's plugin reporting its campaign list must not be able to
   * wipe another customer's record. The site id comes from the signed
   * request, not the body, but the query is the thing that enforces it. */
  const d = db([
    { _id: 'c-1', site: 's-1', createdAt: old(), removedAt: null },
    { _id: 'c-2', site: 's-2', createdAt: old(), removedAt: null },
  ]);

  const n = await markMissingRemoved.call(d, 's-1', []);

  assert.strictEqual(n, 1, 'expected only the one campaign on s-1');
  assert.deepStrictEqual(d.calls[0].ids, ['c-1'], 'it reached into another site');
});

await atest('a campaign already marked removed is not re-marked', async () => {
  // Otherwise every sweep would rewrite the date and lose the day it went.
  const d = db([
    { _id: 'c-1', site: 's-1', createdAt: old(), removedAt: new Date('2026-09-01') },
  ]);

  const n = await markMissingRemoved.call(d, 's-1', []);

  assert.strictEqual(n, 0);
  assert.strictEqual(d.calls.length, 0);
});

await atest('it writes removedAt, not a status', async () => {
  /* status is the record of what the campaign DID and stays true after the
   * campaign is thrown away. Overwriting it would make "completed then
   * removed" and "cancelled then removed" the same thing. */
  const d = db([
    { _id: 'c-1', site: 's-1', createdAt: old(), removedAt: null },
  ]);

  await markMissingRemoved.call(d, 's-1', []);

  const update = d.calls[0].update;
  assert.ok(update.$set.removedAt instanceof Date, 'removedAt was not set to a date');
  assert.strictEqual(update.$set.status, undefined, 'it overwrote the campaign status');
});

test('THE ROUTE REFUSES AN EMPTY LIST', () => {
  /* The guard that lives in the route rather than the model, because it is
   * about trusting the MESSAGE rather than applying the rule. A plugin whose
   * options have been lost reports zero campaigns, which is indistinguishable
   * from a site that has genuinely removed every one — and the second case is
   * already covered, because each of those removals fires /removed as it
   * happens. */
  const source = fs.readFileSync(path.join(__dirname, 'routes/blogApiRoute.js'), 'utf8');
  const handler = source.slice(source.indexOf("'/api/blog/campaigns-present'"));

  assert.match(handler.slice(0, 2000), /if \(!ids\.length\)/,
    'the campaigns-present route no longer refuses an empty list');
  assert.ok(
    handler.indexOf('skipped') < handler.indexOf('markMissingRemoved'),
    'the empty-list check does not come before the write',
  );
});

/* ------------------------------------------------------------------ *
 * The statuses the site reports
 *
 * Pausing and cancelling happen in wp-admin and used to reach this side not
 * at all — no event, no sweep, nothing. A campaign the customer stopped weeks
 * ago still read "In progress" on their account page, and the report's filter
 * could not honestly offer either word.
 * ------------------------------------------------------------------ */

await atest('A PAUSE IN WP-ADMIN REACHES THIS SIDE', async () => {
  const d = statusDb([{ _id: 'c-1', site: 's-1', status: 'active' }]);

  const n = await applyReportedStatuses.call(d, 's-1', [{ id: 'c-1', status: 'paused' }]);

  assert.strictEqual(n, 1, 'the pause was not applied');
  assert.strictEqual(d.calls[0].update.$set.status, 'paused');
});

await atest('A CANCELLATION REACHES THIS SIDE', async () => {
  const d = statusDb([{ _id: 'c-1', site: 's-1', status: 'active' }]);

  const n = await applyReportedStatuses.call(d, 's-1', [{ id: 'c-1', status: 'cancelled' }]);

  assert.strictEqual(n, 1, 'the cancellation was not applied');
});

await atest('a resume comes back too', async () => {
  const d = statusDb([{ _id: 'c-1', site: 's-1', status: 'paused' }]);

  const n = await applyReportedStatuses.call(d, 's-1', [{ id: 'c-1', status: 'active' }]);

  assert.strictEqual(n, 1, 'a resumed campaign stayed paused here');
});

await atest('A BATCH IN FLIGHT IS NEVER INTERRUPTED', async () => {
  /* 'writing' describes work running on THIS side. A sweep landing mid-batch
   * must not knock the campaign out of it — the batch would go on writing
   * posts for a campaign the records said was idle. */
  const d = statusDb([
    { _id: 'c-1', site: 's-1', status: 'writing' },
    { _id: 'c-2', site: 's-1', status: 'draft' },
  ]);

  const n = await applyReportedStatuses.call(d, 's-1', [
    { id: 'c-1', status: 'paused' },
    { id: 'c-2', status: 'active' },
  ]);

  assert.strictEqual(n, 0, 'a batch this side was running got interrupted');
});

await atest('A SITE CANNOT DECLARE ITSELF COMPLETED', async () => {
  /* This side sets 'completed' from the one moment the answer changes — the
   * last slot reporting live. A site that merely thinks it has finished would
   * be guessing, and the number it would be guessing about is the one the
   * customer is billed against. */
  const d = statusDb([{ _id: 'c-1', site: 's-1', status: 'active' }]);

  const n = await applyReportedStatuses.call(d, 's-1', [{ id: 'c-1', status: 'completed' }]);

  assert.strictEqual(n, 0, 'a site talked this side into calling a campaign finished');
});

await atest('A STATUS THAT IS NOT IN THE LIST IS IGNORED', async () => {
  // This arrives over the network from a customer's WordPress.
  const d = statusDb([{ _id: 'c-1', site: 's-1', status: 'active' }]);

  const n = await applyReportedStatuses.call(d, 's-1', [
    { id: 'c-1', status: 'nonsense' },
    { id: 'c-1', status: '' },
    { id: 'c-1' },
  ]);

  assert.strictEqual(n, 0, 'an unrecognised status was written to the database');
});

await atest('ANOTHER SITE\'S CAMPAIGN CANNOT BE TOUCHED', async () => {
  /* The ownership check is in the query, not in a branch above it — the same
   * rule the rest of this file follows. A hostile or misconfigured install
   * reporting somebody else's campaign id must change nothing. */
  const d = statusDb([{ _id: 'c-1', site: 'someone-else', status: 'active' }]);

  const n = await applyReportedStatuses.call(d, 's-1', [{ id: 'c-1', status: 'cancelled' }]);

  assert.strictEqual(n, 0, 'a site changed a campaign belonging to another site');
});

await atest('a status that has not changed is not written', async () => {
  // A write per campaign per hour, forever, for nothing.
  const d = statusDb([{ _id: 'c-1', site: 's-1', status: 'paused' }]);

  const n = await applyReportedStatuses.call(d, 's-1', [{ id: 'c-1', status: 'paused' }]);

  assert.strictEqual(n, 0);
  assert.strictEqual(d.calls.length, 0, 'it wrote to the database with nothing to do');
});

await atest('an empty report changes nothing', async () => {
  const d = statusDb([{ _id: 'c-1', site: 's-1', status: 'active' }]);

  assert.strictEqual(await applyReportedStatuses.call(d, 's-1', []), 0);
  assert.strictEqual(await applyReportedStatuses.call(d, 's-1', null), 0);
  assert.strictEqual(d.calls.length, 0);
});

await atest('REMOVAL IS NOT A STATUS AND IS NOT TOUCHED HERE', async () => {
  /* It is a date, so that "completed, then deleted" and "cancelled halfway,
   * then deleted" stay tellable apart. */
  const d = statusDb([{ _id: 'c-1', site: 's-1', status: 'active', removedAt: new Date('2026-09-28') }]);

  await applyReportedStatuses.call(d, 's-1', [{ id: 'c-1', status: 'cancelled' }]);

  assert.ok(d.calls[0].update.$set.removedAt === undefined,
    'the removal date was overwritten by a status report');
});

/* ------------------------------------------------------------------ *
 * Settling a campaign that has finished
 *
 * The completion check lived only in /api/blog/published. Slots ALSO become
 * published through the live reconciliation — which is how everything
 * repaired after the orphaned-publish bug got there — and that road had no
 * such check. Two campaigns sat at 'active' with six of six posts live: the
 * plugin's own screen called them Completed while the account page called
 * them In progress, and neither was lying.
 * ------------------------------------------------------------------ */

const done = n => Array.from({ length: n }, () => ({ status: 'published' }));

await atest('A CAMPAIGN WITH EVERY POST LIVE IS MARKED COMPLETED', async () => {
  const d = statusDb([
    { _id: 'c-1', site: 's-1', status: 'active', removedAt: null, slots: done(6) },
  ]);

  const n = await settleFinished.call(d, 's-1', ['c-1']);

  assert.strictEqual(n, 1, 'a finished campaign was left in progress');
  assert.strictEqual(d.calls[0].update.$set.status, 'completed');
});

await atest('A CAMPAIGN STUCK AT DRAFT WITH EVERY POST LIVE IS RESCUED', async () => {
  /* THE REPAIR THIS EXISTS FOR. blogGenerator.js decided a finished batch's
   * status from a STALE in-memory copy of the campaign, read "nothing was
   * written", and set every campaign back to 'draft' straight after writing
   * and charging for the whole thing. Nothing ever reached 'active', so the
   * completion check that requires it never fired.
   *
   * The generator is fixed, but every campaign written before that fix is
   * still at 'draft' with all its posts live, and no batch will ever run on
   * them again to put it right. */
  const d = statusDb([
    { _id: 'c-1', site: 's-1', status: 'draft', removedAt: null, slots: done(6) },
  ]);

  assert.strictEqual(await settleFinished.call(d, 's-1', ['c-1']), 1,
    'a campaign with six live posts was left reading as an unapproved draft');
});

await atest('a campaign stuck at writing is rescued too', async () => {
  // Same shape, different resting place: a batch whose bookkeeping never
  // closed because the job died at the last step.
  const d = statusDb([
    { _id: 'c-1', site: 's-1', status: 'writing', removedAt: null, slots: done(6) },
  ]);

  assert.strictEqual(await settleFinished.call(d, 's-1', ['c-1']), 1,
    'a campaign left mid-batch with every post live was not settled');
});

await atest('A REAL DRAFT IS NEVER TOUCHED', async () => {
  /* The guard that makes widening this safe. A campaign nobody has approved
   * has pending slots — nothing written, nothing charged — so the outstanding
   * count is never zero and it cannot reach the write below. */
  const d = statusDb([
    {
      _id: 'c-1', site: 's-1', status: 'draft', removedAt: null,
      slots: [{ status: 'pending' }, { status: 'pending' }],
    },
  ]);

  assert.strictEqual(await settleFinished.call(d, 's-1', ['c-1']), 0,
    'an unapproved campaign was marked completed');
  assert.strictEqual(d.calls.length, 0, 'it wrote to an untouched draft');
});

await atest('a half-written campaign is not rescued either', async () => {
  // Six planned, three written. Still has work to do.
  const d = statusDb([
    {
      _id: 'c-1', site: 's-1', status: 'draft', removedAt: null,
      slots: [...done(3), { status: 'pending' }, { status: 'pending' }, { status: 'pending' }],
    },
  ]);

  assert.strictEqual(await settleFinished.call(d, 's-1', ['c-1']), 0,
    'a campaign with posts still to write was called finished');
});

await atest('a campaign with a post still to come is left alone', async () => {
  const d = statusDb([
    {
      _id: 'c-1', site: 's-1', status: 'active', removedAt: null,
      slots: [...done(5), { status: 'scheduled' }],
    },
  ]);

  assert.strictEqual(await settleFinished.call(d, 's-1', ['c-1']), 0,
    'a campaign still publishing was called finished');
});

await atest('A FAILED POST DOES NOT HOLD A CAMPAIGN OPEN FOR EVER', async () => {
  /* It is not coming. A campaign held open by one failure is a campaign
   * nobody can close. */
  const d = statusDb([
    {
      _id: 'c-1', site: 's-1', status: 'active', removedAt: null,
      slots: [...done(5), { status: 'failed' }],
    },
  ]);

  assert.strictEqual(await settleFinished.call(d, 's-1', ['c-1']), 1,
    'one failed post kept the campaign in progress for ever');
});

await atest('A CAMPAIGN WITH NO SLOTS HAS NOT FINISHED, IT HAS NOT STARTED', async () => {
  // Every slot landed is trivially true of no slots at all.
  const d = statusDb([
    { _id: 'c-1', site: 's-1', status: 'active', removedAt: null, slots: [] },
  ]);

  assert.strictEqual(await settleFinished.call(d, 's-1', ['c-1']), 0,
    'an empty campaign was marked completed');
});

await atest('a paused campaign is not quietly completed', async () => {
  /* Its posts were pulled back to drafts by the pause, so their slots may
   * well read published from an earlier run. Finishing it behind the owner's
   * back would take away the campaign they meant to resume. */
  const d = statusDb([
    { _id: 'c-1', site: 's-1', status: 'paused', removedAt: null, slots: done(6) },
  ]);

  assert.strictEqual(await settleFinished.call(d, 's-1', ['c-1']), 0,
    'a paused campaign was completed without being resumed');
});

await atest('a removed campaign keeps the status it had when it went', async () => {
  // Nothing reports on it any more, and rewriting its history now would
  // erase the one fact the record was kept for.
  const d = statusDb([
    { _id: 'c-1', site: 's-1', status: 'active', removedAt: new Date('2026-09-28'), slots: done(6) },
  ]);

  assert.strictEqual(await settleFinished.call(d, 's-1', ['c-1']), 0,
    'a removed campaign had its frozen status rewritten');
});

await atest('ANOTHER SITE\'S CAMPAIGN IS NOT SETTLED EITHER', async () => {
  const d = statusDb([
    { _id: 'c-1', site: 'someone-else', status: 'active', removedAt: null, slots: done(6) },
  ]);

  assert.strictEqual(await settleFinished.call(d, 's-1', ['c-1']), 0,
    'a campaign belonging to another site was written to');
});

await atest('with no ids it settles everything the site has', async () => {
  // The hourly sweep names the campaigns the site still holds; a caller with
  // nothing to name should still get the whole site swept.
  const d = statusDb([
    { _id: 'c-1', site: 's-1', status: 'active', removedAt: null, slots: done(3) },
    { _id: 'c-2', site: 's-1', status: 'active', removedAt: null, slots: done(3) },
  ]);

  assert.strictEqual(await settleFinished.call(d, 's-1'), 2,
    'an unnamed sweep settled nothing');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);

if (passed + failed !== DECLARED) {
  console.log(`  MISCOUNT: ${passed + failed} ran, ${DECLARED} declared`);
  process.exit(1);
}

process.exit(failed === 0 ? 0 : 1);

})();
