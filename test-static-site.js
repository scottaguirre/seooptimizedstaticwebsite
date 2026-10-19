// test-static-site.js
//
// A blog that lives on Cloudflare instead of in somebody's WordPress.
//
// WHAT THIS IS GUARDING, AND IT IS A SECURITY BOUNDARY
//
// Every BlogSite used to have a licence key and an HMAC secret, and the
// schema made both mandatory. A Cloudflare blog has neither: there is no
// plugin to paste a key into and nothing that ever calls in. So `required`
// became conditional — and that one change, on its own, opens a door.
//
//   HMAC WITH AN EMPTY KEY IS A FUNCTION ANYONE CAN COMPUTE.
//
// The site id is not secret; it travels in a header on every request. Given
// a site whose secret is '', anybody holding 24 hex characters can produce a
// signature that verifies, and /api/blog/plan and /api/blog/write spend the
// owner's credits.
//
// The fix is not "reject an empty secret". That is a rule about a value, and
// the next bug that puts a short string there walks straight round it. The
// rule is "a site with no inbound API is not reachable through the inbound
// API" — enforced on the target, before any signature is computed.
//
// THE FIRST TEST BELOW SIGNS A REQUEST CORRECTLY AND EXPECTS IT REFUSED.
// That is the whole point: it is not testing that a wrong signature fails,
// it is testing that a right one does.
//
//   node test-static-site.js

const assert = require('assert');
const crypto = require('crypto');
const mongoose = require('mongoose');

const BlogSite = require('./models/BlogSite');
const { requireSite, sign } = require('./middleware/requireSite');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function testAsync(name, fn) {
  return fn()
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; });
}
function section(n) { console.log(`\n${n}\n`); }

/* The async tests are collected and run in order at the end.
 *
 * A plain `test()` that takes an async function calls it, gets a promise
 * back, and throws the promise away — so the test reports "ok" without
 * having asserted anything. This project has shipped that mistake before. */
const deferred = [];
function later(name, fn) { deferred.push(() => testAsync(name, fn)); }

/* ------------------------------------------------------------------ fakes */

const SITE_ID = '507f1f77bcf86cd799439011';

/** A site document with just enough of the real one to drive the middleware. */
function fakeSite(over = {}) {
  return Object.assign({
    _id: SITE_ID,
    target: 'wordpress',
    status: 'active',
    failedAuthCount: 0,
    siteUrl: '',
    secret: 'a-real-secret',
  }, over);
}

/** A request signed correctly for whatever secret the site is holding. */
function signedRequest(secret, { path = '/api/blog/plan', method = 'POST' } = {}) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = Buffer.from('{}');

  return {
    id: 'req-1',
    ip: '203.0.113.9',
    method,
    path,
    rawBody,
    headers: {
      'x-il-site': SITE_ID,
      'x-il-timestamp': timestamp,
      'x-il-signature': sign(secret, { timestamp, method, path, rawBody }),
    },
  };
}

function fakeRes() {
  const out = { status: 200, body: null };
  return {
    out,
    status(code) { out.status = code; return this; },
    json(payload) { out.body = payload; return this; },
  };
}

/** Run the middleware against one site, and report what happened. */
async function attempt(site, req) {
  const realFind = BlogSite.findById;
  const realUpdate = BlogSite.updateOne;

  let updates = 0;
  BlogSite.findById = async () => site;
  BlogSite.updateOne = async () => { updates += 1; return { modifiedCount: 1 }; };

  const res = fakeRes();
  let passedThrough = false;

  try {
    await requireSite(req, res, () => { passedThrough = true; });
  } finally {
    BlogSite.findById = realFind;
    BlogSite.updateOne = realUpdate;
  }

  return { passedThrough, status: res.out.status, body: res.out.body, updates };
}

/* ========================================================================= */

section('A STATIC BLOG IS NOT REACHABLE THROUGH THE PLUGIN API');

later('A PERFECTLY SIGNED REQUEST IS STILL REFUSED', async () => {
  /* THE ONE THAT MATTERS. The signature here is correct — computed with the
   * same empty secret the site holds, by the same function the middleware
   * uses. An attacker needs nothing but the site id, which is not secret.
   *
   * If this ever starts passing, anyone who can read a site id can spend
   * that account's credits. */
  const site = fakeSite({ target: 'cloudflare', secret: '' });
  const result = await attempt(site, signedRequest(''));

  assert.ok(!result.passedThrough, 'a static blog authenticated with a forged signature');
  assert.strictEqual(result.status, 401);
});

later('and a real secret on a static blog does not help either', async () => {
  /* The rule is about what the site IS, not about whether its secret happens
   * to be weak. A static blog that somehow carries a secret — left over from
   * a migration, set by hand — is still a site with no inbound API. */
  const site = fakeSite({ target: 'cloudflare', secret: 'a-real-secret' });
  const result = await attempt(site, signedRequest('a-real-secret'));

  assert.ok(!result.passedThrough, 'a static blog with a secret was let in');
  assert.strictEqual(result.status, 401);
});

later('THE REFUSAL SAYS NOTHING ABOUT WHAT THE SITE IS', async () => {
  /* Every other refusal in this middleware is deliberately vague, so the
   * endpoint cannot be used to ask questions about an id. A reason reading
   * "not-a-wordpress-site" would turn it into exactly that. */
  const site = fakeSite({ target: 'cloudflare', secret: '' });
  const result = await attempt(site, signedRequest(''));

  assert.strictEqual(result.body.reason, 'unknown-site',
    `the refusal names the site's kind: ${result.body.reason}`);
});

later('and nothing is written to the site record', async () => {
  /* It happens before the signature comparison, so there is no failure to
   * count — and counting one would let a stranger lock a blog out by
   * sending rubbish to it. */
  const site = fakeSite({ target: 'cloudflare', secret: '' });
  const result = await attempt(site, signedRequest(''));

  assert.strictEqual(result.updates, 0, 'the refusal wrote to the database');
});

later('A SITE WITH NO TARGET AT ALL IS TREATED AS WORDPRESS', async () => {
  /* Every site created before the field existed has no value for it. They
   * are all WordPress installs, they are all live, and reading a missing
   * field as "not wordpress" would cut off every existing customer at once
   * on the morning of the deploy. */
  const site = fakeSite({ target: undefined });
  delete site.target;

  const result = await attempt(site, signedRequest('a-real-secret'));

  assert.ok(result.passedThrough, 'an existing customer was locked out by the upgrade');
});

later('and a WordPress site still gets in', async () => {
  const result = await attempt(fakeSite(), signedRequest('a-real-secret'));

  assert.ok(result.passedThrough, 'the plugin can no longer authenticate at all');
});

later('while a wrong signature still fails', async () => {
  /* The new check must not have replaced the old one. */
  const result = await attempt(fakeSite(), signedRequest('the-wrong-secret'));

  assert.ok(!result.passedThrough);
  assert.strictEqual(result.body.reason, 'bad-signature');
});

/* ========================================================================= */

section('The schema lets a static blog exist');

test('a Cloudflare blog needs no licence key and no secret', function () {
  const site = new BlogSite({
    user: new mongoose.Types.ObjectId(),
    target: 'cloudflare',
    business: { name: 'Leander Water Heaters' },
  });

  assert.strictEqual(site.validateSync(), undefined,
    'a static blog cannot be saved: ' + JSON.stringify(site.validateSync()?.errors || {}));
});

test('A WORDPRESS SITE STILL CANNOT BE CREATED WITHOUT THEM', function () {
  /* The other half. A WordPress site saved without a key is a site the
   * plugin can never activate — created silently, broken on arrival, and
   * discovered by the customer rather than by us. */
  const site = new BlogSite({ user: new mongoose.Types.ObjectId(), target: 'wordpress' });
  const err = site.validateSync();

  assert.ok(err, 'a WordPress site saved with no licence key and no secret');
  assert.ok(err.errors.licenceKeyHash, 'the licence key is no longer required');
  assert.ok(err.errors.secret, 'the secret is no longer required');
});

test('and the default target still demands them', function () {
  /* target defaults to 'wordpress', so a caller that sets nothing gets the
   * strict rules rather than the lenient ones. The wrong way round here
   * would make every omission a silently keyless site. */
  const site = new BlogSite({ user: new mongoose.Types.ObjectId() });

  assert.ok(site.validateSync(), 'a site with no target was created without a licence key');
});

section('ONE BLOG PER DOMAIN, ENFORCED BY THE DATABASE AND NOT ONLY BY CODE');

test('THERE IS A UNIQUE INDEX ON (user, siteUrl)', function () {
  /* THE CHECK EXISTED ONLY IN CODE. staticBlogsRoute does a findOne before
   * creating a blog, which is a read and a write with a gap between them —
   * two requests arriving together both find nothing and both insert. Rare,
   * and the consequence is not rare at all: two blogs on one domain share a
   * Cloudflare project name, so each deploy replaces the other's site.
   *
   * It also had to be guarded by hand in the restore script, which is the
   * sign that the guarantee was in the wrong place. */
  const onPair = BlogSite.schema.indexes()
    .filter(([fields]) => fields.user && fields.siteUrl);

  assert.ok(onPair.length, 'nothing stops two blogs taking the same domain');

  const unique = onPair.filter(([, options]) => options.unique);

  assert.strictEqual(unique.length, 1,
    `expected exactly one unique index on (user, siteUrl), found ${unique.length}`);
});

test('AND IT IS PARTIAL, BECAUSE AN EMPTY DOMAIN IS NOT A DOMAIN', function () {
  /* siteUrl DEFAULTS TO THE EMPTY STRING, and a WordPress site can sit at
   * that default for its whole life. A plain unique index would let an
   * account hold exactly ONE site with no domain and refuse the second with
   * a duplicate-key error naming a field neither of them had filled in —
   * the same trap the licence key index fell into, one field over.
   *
   * `$gt: ''` rather than `$type: 'string'`: the default IS a string, so
   * the type test alone excludes nothing. MongoDB's comparison operators do
   * not match across BSON types, so this is exactly "a non-empty string". */
  const unique = BlogSite.schema.indexes()
    .filter(([fields, options]) => fields.user && fields.siteUrl && options.unique);

  assert.deepStrictEqual(
    unique[0][1].partialFilterExpression,
    { siteUrl: { $gt: '' }, status: { $in: ['active', 'suspended'] } },
    'the unique index is not limited to blogs that actually have a domain'
  );
});

test('AND IT LEAVES REVOKED BLOGS OUT, BECAUSE THE PRODUCT DOES', function () {
  /* FOUND BY RUNNING THE CHECK AGAINST THE LIVE DATABASE, which is the only
   * reason this is right. The first filter was the domain alone, and it
   * found a real duplicate that turned out to be correct data.
   *
   * activationGuards.refuseOccupiedDomain enforces one blog per domain and
   * tests against other NON-REVOKED sites only: revoking a licence is how
   * an owner frees a domain for a new key, and the revoked record stays as
   * history. An index that counted it would have made that remedy
   * impossible — the guard would allow the activation and the database
   * would refuse the write.
   *
   * It would also have failed to build at all, and Mongoose logs that and
   * carries on. */
  const unique = BlogSite.schema.indexes()
    .filter(([fields, options]) => fields.user && fields.siteUrl && options.unique);

  const statuses = unique[0][1].partialFilterExpression.status.$in;

  assert.ok(!statuses.includes('revoked'),
    'a revoked blog still occupies its domain, so no licence can replace it');
  assert.ok(statuses.includes('active'), 'active blogs are not covered by the index at all');
});

test('AND IT IS NAMED, SO IT CANNOT COLLIDE WITH ANOTHER', function () {
  /* The lesson from licenceKeyHash: MongoDB derives an index name from its
   * keys, so two indexes over the same keys are born with the same name and
   * the second is refused at startup with IndexOptionsConflict. Which one
   * survives then depends on nothing anybody chose. */
  const unique = BlogSite.schema.indexes()
    .filter(([fields, options]) => fields.user && fields.siteUrl && options.unique);

  assert.ok(unique[0][1].name, 'the unique index has no explicit name');

  const all = BlogSite.schema.indexes().map(([fields, options]) =>
    options.name || Object.entries(fields).map(([k, v]) => `${k}_${v}`).join('_'));

  assert.strictEqual(new Set(all).size, all.length,
    `two indexes on BlogSite share a name: ${all.join(', ')}`);
});

section('ONE LICENCE KEY PER SITE, FOR THE SITES THAT HAVE ONE');

test('THE UNIQUE INDEX IS PARTIAL', function () {
  /* A plain unique index treats every document MISSING the field as holding
   * the same value. One static blog would have been fine; the second would
   * have been refused with a duplicate-key error about a licence key it does
   * not have — and the message would have sent whoever read it to entirely
   * the wrong place. */
  const onKey = BlogSite.schema.indexes()
    .filter(([fields]) => fields.licenceKeyHash && 1 === Object.keys(fields).length);

  assert.ok(onKey.length, 'there is no index on licenceKeyHash at all');

  /* FOUND BY THE TEST FAILING. There are TWO — a plain one from the field,
   * which serves findByLicenceKey, and the partial unique one declared on
   * the schema. The first version of this assertion took whichever came
   * first and checked that, which was the plain one, so it would have
   * reported the uniqueness missing while it was present and present while
   * it was missing. Both are deliberate; see the note on the field. */
  const unique = onKey.filter(([, options]) => options.unique);

  assert.strictEqual(unique.length, 1,
    `expected exactly one unique index on licenceKeyHash, found ${unique.length}`);

  assert.deepStrictEqual(
    unique[0][1].partialFilterExpression,
    { licenceKeyHash: { $type: 'string' } },
    'the unique index is not limited to sites that actually have a key'
  );

  /* THE TWO INDEXES MUST NOT SHARE A NAME, and without an explicit one they
   * would: MongoDB derives the name from the key specification, so both of
   * these are `licenceKeyHash_1` and the second to be created is refused
   * with IndexOptionsConflict at startup. Which one survives then depends on
   * nothing anybody decided. */
  const names = onKey.map(([fields, options]) =>
    options.name || Object.entries(fields).map(([k, v]) => `${k}_${v}`).join('_'));

  assert.strictEqual(new Set(names).size, names.length,
    `two indexes on licenceKeyHash share a name: ${names.join(', ')}`);

  assert.ok(onKey.some(([, options]) => !options.unique),
    'the plain lookup index is gone, so activation may be a collection scan');
});

test('AND THE FIELD NO LONGER DECLARES uniqueness ITSELF', function () {
  /* This is the line that caused the problem. `unique: true` on the field
   * builds a PLAIN unique index, which counts every document missing the
   * field as a duplicate of every other — so the second static blog ever
   * created is refused with a duplicate-key error about a licence key it
   * does not have, and whoever reads that message goes looking in entirely
   * the wrong place. Uniqueness belongs on the partial index or nowhere. */
  const path = BlogSite.schema.path('licenceKeyHash');

  assert.notStrictEqual(path.options.unique, true,
    'licenceKeyHash still carries unique:true, so a plain unique index is built as well');
});

test('THE MIGRATION IS WRITTEN DOWN WHERE IT WILL BE READ', function () {
  /* Mongoose creates indexes that are missing. It does NOT alter one that
   * already exists with different options, and it says nothing about the
   * difference — so on the live database the old plain index survives this
   * deploy and the second static blog fails with E11000. The command to run
   * has to be in the file somebody opens when that happens. */
  const src = require('fs').readFileSync(require.resolve('./models/BlogSite'), 'utf8');

  assert.match(src, /dropIndex\('licenceKeyHash_1'\)/,
    'the index migration is not recorded in the model');

  /* AND THE ORDER, which is the part that matters. Dropping the old unique
   * index before the new one exists leaves a window in which two sites
   * could take the same licence key. */
  assert.match(src, /IN THAT ORDER/,
    'the migration does not say which way round to do it');
});

/* ========================================================================= */

(async () => {
  for (const run of deferred) await run();

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
