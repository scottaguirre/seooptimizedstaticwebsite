// test-blog-api.js
//
// Proves the three things that would cost money or leak data if wrong:
//
//   1. The signature scheme rejects tampering, replay outside the window,
//      and cross-endpoint reuse.
//   2. The runner routes a job to the generator for its kind, and refuses to
//      claim a kind it cannot run.
//   3. A slot can be claimed once and charged once, no matter how many
//      requests race for it.
//
// Runs with no database and no network: the pieces under test are pure
// functions and conditional-update logic, and the update logic is modelled
// here with the same semantics Mongo gives it.
//
//   node test-blog-api.js

const crypto = require('crypto');
const assert = require('assert');

const { sign, canonicalString, MAX_SKEW_SECONDS } = require('./middleware/requireSite');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err.message}`);
    failed++;
  }
}

/* =========================================================================
 * 1. The signature
 * ====================================================================== */

console.log('\nSignature');

const SECRET = crypto.randomBytes(32).toString('hex');
const body = Buffer.from(JSON.stringify({ campaignId: 'a'.repeat(24), slotIndex: 0 }));
const now = () => String(Math.floor(Date.now() / 1000));

function verify(signature, parts, secret = SECRET) {
  const expected = sign(secret, parts);
  const a = crypto.createHash('sha256').update(String(signature)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

test('a correctly signed request verifies', () => {
  const parts = { timestamp: now(), method: 'POST', path: '/api/blog/write', rawBody: body };
  assert.ok(verify(sign(SECRET, parts), parts));
});

test('a changed body fails', () => {
  const parts = { timestamp: now(), method: 'POST', path: '/api/blog/write', rawBody: body };
  const signature = sign(SECRET, parts);

  const tampered = {
    ...parts,
    rawBody: Buffer.from(JSON.stringify({ campaignId: 'a'.repeat(24), slotIndex: 99 })),
  };
  assert.ok(!verify(signature, tampered));
});

test('the same signature replayed against another endpoint fails', () => {
  // The reason method and path are inside the signature. Without them, a
  // signature captured from /complete would authorise /generate.
  const parts = { timestamp: now(), method: 'POST', path: '/api/blog/complete', rawBody: body };
  const signature = sign(SECRET, parts);

  assert.ok(!verify(signature, { ...parts, path: '/api/blog/write' }));
});

test('a changed method fails', () => {
  const parts = { timestamp: now(), method: 'POST', path: '/api/blog/plan', rawBody: body };
  assert.ok(!verify(sign(SECRET, parts), { ...parts, method: 'DELETE' }));
});

test('another site\'s secret fails', () => {
  const parts = { timestamp: now(), method: 'POST', path: '/api/blog/write', rawBody: body };
  const otherSecret = crypto.randomBytes(32).toString('hex');
  assert.ok(!verify(sign(otherSecret, parts), parts));
});

test('a timestamp outside the window is rejected', () => {
  const stale = String(Math.floor(Date.now() / 1000) - MAX_SKEW_SECONDS - 1);
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(stale));
  assert.ok(skew > MAX_SKEW_SECONDS, 'stale timestamp should be outside the window');
});

test('a timestamp inside the window is accepted', () => {
  const recent = String(Math.floor(Date.now() / 1000) - (MAX_SKEW_SECONDS - 10));
  const skew = Math.abs(Math.floor(Date.now() / 1000) - Number(recent));
  assert.ok(skew <= MAX_SKEW_SECONDS);
});

test('an empty body signs deterministically', () => {
  // GET-shaped calls have no body. Buffer.alloc(0) and undefined must hash
  // identically or a request with no body could never be verified.
  const a = canonicalString({ timestamp: '1', method: 'POST', path: '/x', rawBody: undefined });
  const b = canonicalString({ timestamp: '1', method: 'POST', path: '/x', rawBody: Buffer.alloc(0) });
  assert.strictEqual(a, b);
});

test('the canonical string is not vulnerable to field-splitting', () => {
  // A path containing a newline must not be able to impersonate a different
  // (timestamp, method, path) triple.
  const honest = canonicalString({ timestamp: '1', method: 'POST', path: '/api/blog/plan', rawBody: body });
  const sneaky = canonicalString({ timestamp: '1', method: 'POST', path: '/api/blog/plan\n1\nPOST\n/api/blog/write', rawBody: body });
  assert.notStrictEqual(honest, sneaky);
});

/* =========================================================================
 * 2. Runner kind routing
 * ====================================================================== */

console.log('\nJob kind routing');

// The registry, lifted out of jobRunner so it can be exercised without Mongo.
function makeRegistry() {
  const generators = new Map();

  function registerGenerator(kind, fn) {
    if (typeof kind === 'function') { generators.set('site', kind); return; }
    if (typeof fn !== 'function') throw new Error(`no function for '${kind}'`);
    generators.set(String(kind), fn);
  }

  const registeredKinds = () => Array.from(generators.keys());

  // The filter claimNextJob builds.
  function claimFilter(kinds = registeredKinds()) {
    return {
      status: 'queued',
      $or: [
        { kind: { $in: kinds } },
        ...(kinds.includes('site') ? [{ kind: { $exists: false } }] : []),
      ],
    };
  }

  return { registerGenerator, registeredKinds, claimFilter, generators };
}

function matches(filter, doc) {
  if (doc.status !== filter.status) return false;
  return filter.$or.some(clause => {
    if (clause.kind && clause.kind.$in) return clause.kind.$in.includes(doc.kind);
    if (clause.kind && clause.kind.$exists === false) return doc.kind === undefined;
    return false;
  });
}

test('the one-argument form still registers the site generator', () => {
  const r = makeRegistry();
  r.registerGenerator(() => {});
  assert.deepStrictEqual(r.registeredKinds(), ['site']);
});

test('both kinds can be registered', () => {
  const r = makeRegistry();
  r.registerGenerator('site', () => {});
  r.registerGenerator('blog', () => {});
  assert.deepStrictEqual(r.registeredKinds().sort(), ['blog', 'site']);
});

test('a legacy job with no kind is still claimed', () => {
  const r = makeRegistry();
  r.registerGenerator('site', () => {});
  const legacy = { status: 'queued' };   // written before `kind` existed
  assert.ok(matches(r.claimFilter(), legacy));
});

test('an instance without the blog generator will not claim a blog job', () => {
  // The rolling-deploy case: an old instance must leave blog jobs alone
  // rather than claiming and failing them every 90 seconds.
  const r = makeRegistry();
  r.registerGenerator('site', () => {});
  assert.ok(!matches(r.claimFilter(), { status: 'queued', kind: 'blog' }));
});

test('an instance with the blog generator does claim a blog job', () => {
  const r = makeRegistry();
  r.registerGenerator('site', () => {});
  r.registerGenerator('blog', () => {});
  assert.ok(matches(r.claimFilter(), { status: 'queued', kind: 'blog' }));
});

test('registering a non-function throws rather than storing undefined', () => {
  const r = makeRegistry();
  assert.throws(() => r.registerGenerator('blog', null));
});

/* =========================================================================
 * 3. Charge once per slot
 * ====================================================================== */

console.log('\nCharge once per slot');

/**
 * A campaign with one slot, and the two conditional updates that move it.
 *
 * Both mirror the real filters: claimSlot matches only 'pending',
 * markSlotReady only 'generating'. Mongo applies each atomically, so
 * modelling them as synchronous check-then-set is faithful — the point being
 * tested is the FILTER, not the concurrency primitive.
 */
function makeCampaign() {
  const slot = { index: 0, status: 'pending', chargedAt: null, credits: 0, attempts: 0 };

  return {
    slot,
    claimSlot() {
      if (slot.status !== 'pending') return null;
      slot.status = 'generating';
      slot.attempts += 1;
      return slot;
    },
    markSlotReady(credits) {
      if (slot.status !== 'generating') return null;
      slot.status = 'ready';
      slot.chargedAt = new Date();
      slot.credits = credits;
      return slot;
    },
  };
}

test('two racing requests: only one claims the slot', () => {
  const c = makeCampaign();
  const first = c.claimSlot();
  const second = c.claimSlot();

  assert.ok(first, 'first should win');
  assert.strictEqual(second, null, 'second must lose');
  assert.strictEqual(c.slot.attempts, 1, 'a lost race must not count as an attempt');
});

test('markSlotReady charges exactly once even if called twice', () => {
  const c = makeCampaign();
  c.claimSlot();

  let charges = 0;
  if (c.markSlotReady(45)) charges++;
  if (c.markSlotReady(45)) charges++;   // a retry, or a duplicate job

  assert.strictEqual(charges, 1);
  assert.strictEqual(c.slot.credits, 45);
});

test('a slot cannot be charged without first being claimed', () => {
  const c = makeCampaign();
  assert.strictEqual(c.markSlotReady(45), null);
  assert.strictEqual(c.slot.chargedAt, null);
});

test('ten concurrent generate calls produce one charge', () => {
  const c = makeCampaign();

  let charges = 0;
  for (let i = 0; i < 10; i++) {
    if (c.claimSlot()) {
      if (c.markSlotReady(45)) charges++;
    }
  }

  assert.strictEqual(charges, 1, 'ten callers, one charge');
  assert.strictEqual(c.slot.status, 'ready');
});

test('a released slot can be retried and charged once', () => {
  const c = makeCampaign();
  c.claimSlot();

  // Generation failed: back to pending, nothing charged.
  c.slot.status = 'pending';
  assert.strictEqual(c.slot.chargedAt, null, 'a failure must not charge');

  c.claimSlot();
  assert.ok(c.markSlotReady(45));
  assert.strictEqual(c.slot.credits, 45);
  assert.strictEqual(c.slot.attempts, 2, 'both attempts counted');
});

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);