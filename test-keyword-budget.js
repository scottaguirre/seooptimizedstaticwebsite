// test-keyword-budget.js
//
// The daily ceiling on DataForSEO spending.
//
// WHAT THIS IS REALLY GUARDING
//
// Two properties, and both of them fail silently if they break:
//
//   1. A CACHE HIT MUST NOT SPEND ANYTHING. The cache is shared across every
//      customer, so a hit is the answer somebody else already paid for.
//      Counting one would lock people out of free answers — punishing
//      exactly the customer the cache exists to serve.
//
//   2. THE COUNT MUST SURVIVE A RESTART. pm2 restarts on every deploy, and a
//      limit that forgets itself on deploy is a limit anybody can clear by
//      waiting for one. That is why it is a collection and not a counter in
//      memory, and why these tests use a stand-in model rather than a Map.
//
//   node test-keyword-budget.js

const assert = require('assert');

/* The logger pulls in pino; a counter does not need a logging stack. */
const Module = require('module');
const logged = [];
const realLoad = Module._load;

Module._load = function (request, parent, isMain) {
  if (/(^\.\/logger$|\/logger$)/.test(request)) {
    return {
      log: {
        info: (...a) => logged.push(['info', ...a]),
        error: (...a) => logged.push(['error', ...a]),
        warn: (...a) => logged.push(['warn', ...a]),
        security: (...a) => logged.push(['security', ...a]),
      },
    };
  }
  return realLoad.call(this, request, parent, isMain);
};

const {
  checkBudget, recordSpend, spentToday, limitMessage, isExempt,
  dayKey, resetsAt, resetPhrase, keyFor,
  DAILY_LIMIT, EXEMPT_ROLES, KEEP_DAYS,
} = require('./utils/keywordBudget');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r.then(
        () => { console.log(`  ok    ${name}`); passed++; },
        err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
      );
    }
    console.log(`  ok    ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}\n        ${err.message}`);
    failed++;
  }
}

/** A stand-in for the Mongo model, so the suite needs no database. */
function fakeModel(seed = []) {
  const store = new Map();
  for (const row of seed) store.set(row.key, row);

  return {
    store,
    writes: [],
    findOne: ({ key }) => ({ lean: async () => store.get(key) || null }),
    async updateOne(filter, update, options) {
      this.writes.push({ filter, update, options });

      const row = store.get(filter.key) || { key: filter.key, count: 0, costUsd: 0 };

      for (const [field, by] of Object.entries(update.$inc || {})) {
        row[field] = (row[field] || 0) + by;
      }
      Object.assign(row, update.$set || {});

      store.set(filter.key, row);
    },
  };
}

const AT = () => new Date('2026-09-23T14:00:00Z');
const customer = { _id: 'u1', role: 'subscriber' };
const admin = { _id: 'a1', role: 'admin' };

async function main() {
  console.log('\nKeyword budget\n');

  /* ---------------------------------------------------------------- *
   * A cache hit costs nothing and must spend nothing
   * ---------------------------------------------------------------- */

  await test('a free answer does not spend a lookup', async () => {
    // THE PROPERTY THIS WHOLE FILE EXISTS FOR. The cache is shared across
    // every customer, so a hit is somebody else's paid answer being given
    // away. Charging for it would lock people out of free results.
    const Model = fakeModel();

    await recordSpend(customer, { Model, now: AT, costUsd: 0 });

    assert.strictEqual(Model.writes.length, 0, 'a cache hit was recorded');
    assert.strictEqual(await spentToday('u1', { Model, now: AT }), 0);
  });

  await test('a paid answer spends exactly one', async () => {
    const Model = fakeModel();

    await recordSpend(customer, { Model, now: AT, costUsd: 0.09 });

    assert.strictEqual(await spentToday('u1', { Model, now: AT }), 1);
  });

  await test('the cost is recorded too, so the question can be revisited', async () => {
    // "Is this worth charging for?" needs a number behind it, not an
    // impression.
    const Model = fakeModel();

    await recordSpend(customer, { Model, now: AT, costUsd: 0.09 });
    await recordSpend(customer, { Model, now: AT, costUsd: 0.09 });

    const row = Model.store.get(keyFor('u1', AT()));
    assert.strictEqual(row.count, 2);
    assert.ok(Math.abs(row.costUsd - 0.18) < 1e-9);
  });

  /* ---------------------------------------------------------------- *
   * The ceiling
   * ---------------------------------------------------------------- */

  await test('under the limit is allowed, at the limit is not', async () => {
    const at = keyFor('u1', AT());

    const under = await checkBudget(customer, {
      Model: fakeModel([{ key: at, count: DAILY_LIMIT - 1 }]), now: AT,
    });
    assert.strictEqual(under.allowed, true);

    const at_ = await checkBudget(customer, {
      Model: fakeModel([{ key: at, count: DAILY_LIMIT }]), now: AT,
    });
    assert.strictEqual(at_.allowed, false);
    assert.strictEqual(at_.used, DAILY_LIMIT);
  });

  await test('the limit is twenty', async () => {
    // Guards the number itself. Thirty paid lookups came out of three and a
    // half hours of deliberate testing; a customer researching one town uses
    // five to ten.
    assert.strictEqual(DAILY_LIMIT, 20);
  });

  await test('a fresh customer has spent nothing', async () => {
    const out = await checkBudget(customer, { Model: fakeModel(), now: AT });
    assert.strictEqual(out.used, 0);
    assert.strictEqual(out.allowed, true);
  });

  /* ---------------------------------------------------------------- *
   * Admins
   * ---------------------------------------------------------------- */

  await test('an admin is never stopped', async () => {
    const at = keyFor('a1', AT());
    const out = await checkBudget(admin, {
      Model: fakeModel([{ key: at, count: 9999 }]), now: AT,
    });

    assert.strictEqual(out.allowed, true);
    assert.strictEqual(out.exempt, true);
  });

  await test('a superadmin is exempt too', () => {
    assert.ok(isExempt({ role: 'superadmin' }));
    assert.ok(isExempt({ role: 'admin' }));
    assert.ok(!isExempt({ role: 'subscriber' }));
    assert.ok(!isExempt({ role: 'free' }));
    assert.ok(!isExempt({}));
    assert.ok(!isExempt(null));
  });

  await test('an admin records nothing, so their testing is not counted', async () => {
    const Model = fakeModel();
    await recordSpend(admin, { Model, now: AT, costUsd: 0.09 });
    assert.strictEqual(Model.writes.length, 0);
  });

  await test('the exempt roles match the ones the app actually has', () => {
    // models/User.js: superadmin, admin, subscriber, free. A role listed
    // here that does not exist is a typo nobody would notice.
    for (const role of EXEMPT_ROLES) {
      assert.ok(['superadmin', 'admin'].includes(role), `unknown role: ${role}`);
    }
  });

  /* ---------------------------------------------------------------- *
   * The day, and when it turns over
   * ---------------------------------------------------------------- */

  await test('yesterday does not count against today', async () => {
    const Model = fakeModel([
      { key: 'u1:2026-09-22', count: DAILY_LIMIT },
    ]);

    const out = await checkBudget(customer, { Model, now: AT });
    assert.strictEqual(out.used, 0, 'yesterday is still being counted');
    assert.strictEqual(out.allowed, true);
  });

  await test('the day is UTC, and the same instant is always the same day', () => {
    assert.strictEqual(dayKey(new Date('2026-09-23T00:00:01Z')), '2026-09-23');
    assert.strictEqual(dayKey(new Date('2026-09-23T23:59:59Z')), '2026-09-23');
    assert.strictEqual(dayKey(new Date('2026-09-24T00:00:00Z')), '2026-09-24');
  });

  await test('the reset is the next UTC midnight', () => {
    assert.strictEqual(
      resetsAt(new Date('2026-09-23T14:00:00Z')).toISOString(),
      '2026-09-24T00:00:00.000Z'
    );
  });

  await test('the customer is told hours, never a clock time', () => {
    // The server does not know their timezone, so "midnight" would be wrong
    // for most of them. Hours remaining is true wherever they are.
    assert.strictEqual(resetPhrase(new Date('2026-09-23T14:00:00Z')), 'in about 10 hours');
    assert.strictEqual(resetPhrase(new Date('2026-09-23T23:30:00Z')), 'in under an hour');

    const message = limitMessage({ limit: 20, resetPhrase: 'in about 10 hours' });
    assert.ok(!/midnight|UTC|\d\s*(am|pm)/i.test(message),
      `the message names a clock time: ${message}`);
  });

  await test('the message says what the limit is and that cached searches still work', () => {
    const message = limitMessage({ limit: 20, resetPhrase: 'in about 3 hours' });

    assert.match(message, /20/);
    assert.match(message, /3 hours/);
    // The escape hatch: they can still re-run anything already answered,
    // which is true and worth saying rather than leaving them stuck.
    assert.match(message, /free to repeat|already run/i);
  });

  await test('rows outlive the day they count', async () => {
    const Model = fakeModel();
    await recordSpend(customer, { Model, now: AT, costUsd: 0.09 });

    const row = Model.store.get(keyFor('u1', AT()));
    const days = (row.expiresAt - AT()) / (24 * 60 * 60 * 1000);

    assert.strictEqual(days, KEEP_DAYS);
    assert.ok(KEEP_DAYS >= 2,
      'a row must survive until the day is over in every timezone');
  });

  /* ---------------------------------------------------------------- *
   * Failing safe
   * ---------------------------------------------------------------- */

  await test('a database that cannot be read does NOT lock everybody out', async () => {
    // The choice during an outage is between blocking a working feature and
    // letting a day run unguarded. The cap exists to stop a slow drain, not
    // to hold a line while Mongo is down.
    const Model = fakeModel();
    Model.findOne = () => ({ async lean() { throw new Error('mongo is down'); } });

    const out = await checkBudget(customer, { Model, now: AT });

    assert.strictEqual(out.allowed, true);
    assert.ok(logged.some(l => l[1] === 'keywords.budgetReadFailed'),
      'the failure was swallowed without a word');
  });

  await test('a counter that cannot be written does not lose the answer', async () => {
    // Failing to count costs one uncounted lookup. Throwing costs the
    // customer the answer they just paid for.
    const Model = fakeModel();
    Model.updateOne = async () => { throw new Error('mongo is down'); };

    await recordSpend(customer, { Model, now: AT, costUsd: 0.09 });

    assert.ok(logged.some(l => l[1] === 'keywords.budgetWriteFailed'));
  });

  await test('a request with no user spends nothing and is not counted', async () => {
    const Model = fakeModel();

    await recordSpend(undefined, { Model, now: AT, costUsd: 0.09 });
    await recordSpend({}, { Model, now: AT, costUsd: 0.09 });

    assert.strictEqual(Model.writes.length, 0);
    assert.strictEqual(await spentToday(null, { Model, now: AT }), 0);
  });

  /* ---------------------------------------------------------------- *
   * Two customers
   * ---------------------------------------------------------------- */

  await test('one customer running out does not stop another', async () => {
    const Model = fakeModel([{ key: keyFor('u1', AT()), count: DAILY_LIMIT }]);

    const spent = await checkBudget({ _id: 'u1', role: 'subscriber' }, { Model, now: AT });
    const fresh = await checkBudget({ _id: 'u2', role: 'subscriber' }, { Model, now: AT });

    assert.strictEqual(spent.allowed, false);
    assert.strictEqual(fresh.allowed, true);
  });

  console.log('');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('');
  process.exit(failed === 0 ? 0 : 1);
}

main();
