/**
 * test-licence-binding.js
 *
 * One licence key, one WordPress site.
 *
 * THE BUG THIS EXISTS TO STOP COMING BACK
 *
 * Paste a licence key into a second WordPress — or, far more easily, CLONE a
 * site, because the id and secret live in wp_options and a duplicate carries
 * them without anyone typing anything — and the second site works while the
 * first one dies. Activation mints a fresh secret, so the original install is
 * left holding a dead key: every call refused, for ever, and the only thing
 * anyone sees is "Not authorised".
 *
 * On the site this was written for it ran for eight days. Every "this post
 * went live" callback was rejected, the server's record drifted from the
 * site's, and the customer's own report claimed 26 published posts for a site
 * carrying 12. Nothing anywhere said why.
 *
 * models/BlogSite.js had described siteUrl as "compared on every subsequent
 * request" since the day it was written. It never was — a comment describing
 * a protection that did not exist, which is worse than no comment, because
 * everyone who read it stopped looking.
 *
 * TWO GUARDS, AND THE SECOND IS THE IMPORTANT ONE
 *
 *   requireSite   refuses a request whose reported URL is not the one the
 *                 licence is registered to. Catches it after the fact.
 *   activate      refuses to move a licence off a live site unless the
 *                 request says plainly that is the intention. Stops it
 *                 happening at all.
 *
 * AND THE COMPATIBILITY RULE THAT MATTERS MORE THAN EITHER: a plugin that
 * does not send the header is not refused. Older installs must keep working
 * on upgrade day, or this fix is worse than the bug.
 *
 * Run:  node test-licence-binding.js
 */

const assert = require('assert');
const crypto = require('crypto');
const Module = require('module');

let passed = 0;
let failed = 0;
const DECLARED = 20;

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
 * The real BlogSite helpers, without mongoose
 * ------------------------------------------------------------------ */

function normaliseSiteUrl(url) {
  return String(url || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

const SECRET = 'a'.repeat(64);
const SITE_ID = 'aaaaaaaaaaaaaaaaaaaaaaaa';

let DB = {};

const fakeBlogSite = {
  normaliseSiteUrl,
  findById: id => Promise.resolve(String(id) === SITE_ID ? DB.site : null),
  updateOne: () => Promise.resolve({}),
};

const logged = [];

const stubs = {
  '../models/BlogSite': fakeBlogSite,
  '../utils/logger': {
    log: {
      error() {},
      info() {},
      security(event, ctx) { logged.push({ event, ctx }); },
    },
  },
};

const realLoad = Module._load;
Module._load = function (request) {
  if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
  return realLoad.apply(this, arguments);
};

const { requireSite } = require('./middleware/requireSite');

Module._load = realLoad;

/* ------------------------------------------------------------------ *
 * Signing exactly as the plugin does
 * ------------------------------------------------------------------ */

function sign({ timestamp, method, path, rawBody, secret }) {
  const bodyHash = crypto
    .createHash('sha256')
    .update(rawBody && rawBody.length ? rawBody : Buffer.alloc(0))
    .digest('hex');

  return crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}\n${method}\n${path}\n${bodyHash}`)
    .digest('hex');
}

function call({ reportedUrl, registeredTo = 'roofingamerica.xyz', status = 'active', secret = SECRET }) {
  DB.site = {
    _id: SITE_ID,
    status,
    secret: SECRET,
    siteUrl: registeredTo,
    failedAuthCount: 0,
  };

  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = Buffer.from('{}');
  const path = '/api/blog/suggest';

  const headers = {
    'x-il-site': SITE_ID,
    'x-il-timestamp': timestamp,
    'x-il-signature': sign({ timestamp, method: 'POST', path, rawBody, secret }),
  };

  if (reportedUrl !== undefined) headers['x-il-site-url'] = reportedUrl;

  const req = { headers, method: 'POST', path, rawBody, id: 'r1', ip: '1.2.3.4' };

  const res = {
    code: 200,
    body: null,
    status(c) { this.code = c; return this; },
    json(b) { this.body = b; return this; },
  };

  let passedThrough = false;
  return requireSite(req, res, () => { passedThrough = true; })
    .then(() => ({ res, passedThrough, req }));
}

console.log('\nOne licence, one site\n');

(async () => {

/* ---------------- requireSite ---------------- */

await atest('the right site is let through', async () => {
  const { passedThrough, res } = await call({ reportedUrl: 'https://roofingamerica.xyz' });

  assert.strictEqual(passedThrough, true, `refused with ${res.code}: ${JSON.stringify(res.body)}`);
});

await atest('A DIFFERENT SITE ON THE SAME LICENCE IS REFUSED', async () => {
  /* The whole point. Same id, same secret — a cloned install — but a
   * different domain. */
  const { passedThrough, res } = await call({
    reportedUrl: 'https://hilltophomeloans.net',
    registeredTo: 'roofingamerica.xyz',
  });

  assert.strictEqual(passedThrough, false, 'a second site was allowed through');
  assert.strictEqual(res.code, 409, 'expected 409 Conflict, not an auth failure');
  assert.strictEqual(res.body.reason, 'site-url-mismatch');
});

await atest('the refusal names the site the licence belongs to', async () => {
  // "Not authorised" cost eight days. The message has to be actionable.
  const { res } = await call({
    reportedUrl: 'https://hilltophomeloans.net',
    registeredTo: 'roofingamerica.xyz',
  });

  assert.match(res.body.error, /roofingamerica\.xyz/);
  assert.match(res.body.error, /own licence key/i);
});

await atest('A PLUGIN THAT SENDS NO URL STILL WORKS', async () => {
  /* THE COMPATIBILITY RULE. Every install older than this version sends no
   * such header. Refusing them would break every existing customer on the
   * day this ships — a fix worse than the bug it fixes. */
  const { passedThrough } = await call({ reportedUrl: undefined });

  assert.strictEqual(passedThrough, true, 'an older plugin was locked out');
});

await atest('an empty header is treated as absent, not as a mismatch', async () => {
  const { passedThrough } = await call({ reportedUrl: '' });

  assert.strictEqual(passedThrough, true);
});

await atest('http and https are the same site', async () => {
  // An SSL certificate arriving must not disconnect the site.
  const { passedThrough } = await call({
    reportedUrl: 'http://roofingamerica.xyz',
    registeredTo: 'roofingamerica.xyz',
  });

  assert.strictEqual(passedThrough, true, 'switching to https disconnected the site');
});

await atest('www and a trailing slash are the same site', async () => {
  const { passedThrough } = await call({
    reportedUrl: 'https://www.roofingamerica.xyz/',
    registeredTo: 'roofingamerica.xyz',
  });

  assert.strictEqual(passedThrough, true, 'a www prefix disconnected the site');
});

await atest('THE URL IS CHECKED AFTER THE SIGNATURE, NOT BEFORE', async () => {
  /* The mismatch message names the other site, which is information. It must
   * only ever reach a caller that has already proved it holds the secret —
   * otherwise it is a way to ask which domain any site id belongs to. */
  const { res, passedThrough } = await call({
    reportedUrl: 'https://hilltophomeloans.net',
    secret: 'b'.repeat(64),   // wrong secret AND wrong site
  });

  assert.strictEqual(passedThrough, false);
  assert.strictEqual(res.body.reason, 'bad-signature',
    'a bad signature leaked the registered domain');
  assert.ok(!String(JSON.stringify(res.body)).includes('roofingamerica'),
    'the registered site name leaked to an unsigned caller');
});

await atest('a revoked licence is refused before any of this', async () => {
  const { passedThrough, res } = await call({
    reportedUrl: 'https://roofingamerica.xyz',
    status: 'revoked',
  });

  assert.strictEqual(passedThrough, false);
  assert.strictEqual(res.body.reason, 'site-revoked');
});

await atest('EVERY REFUSAL IS LOGGED, INCLUDING THE ONES THAT WERE SILENT', async () => {
  /* site-revoked, missing-headers, bad-site-id and bad-timestamp wrote
   * nothing at all. The likeliest support call of all left no trace, and we
   * spent an evening on a failure that had been happening daily for over a
   * week because silence looked the same as nothing happening. */
  logged.length = 0;

  await call({ reportedUrl: 'https://roofingamerica.xyz', status: 'revoked' });

  const denied = logged.find(l => l.event === 'blog.auth.denied');
  assert.ok(denied, 'a revoked site was refused without a log line');
  assert.strictEqual(denied.ctx.reason, 'site-revoked');
});

await atest('a mismatch is logged with both domains', async () => {
  logged.length = 0;

  await call({ reportedUrl: 'https://hilltophomeloans.net', registeredTo: 'roofingamerica.xyz' });

  const hit = logged.find(l => l.event === 'blog.auth.siteUrlMismatch');
  assert.ok(hit, 'no log line for a licence used on a second site');
  assert.strictEqual(hit.ctx.registeredTo, 'roofingamerica.xyz');
  assert.strictEqual(hit.ctx.reported, 'hilltophomeloans.net');
});

/* ---------------- activate ---------------- */

/* THIS USED TO BE ONE TEST, AND IT READ THE ROUTE'S SOURCE FOR PHRASES.
 *
 * It asserted /body\.moveSite/ against routes/blogApiRoute.js. The phrase was
 * there, in this line:
 *
 *     if (movingFrom && site.lastSeenAt && !body.moveSite) {
 *
 * `body` was never declared in that handler — the request is `req.body`. So
 * the moment the first two conditions held, that line threw a ReferenceError,
 * the handler's catch turned it into "Activation failed. Please try again.",
 * and the guard had never run once in its life. This test was green
 * throughout, because the phrase it looked for was the bug.
 *
 * READING A LINE IS NOT RUNNING IT — and a guard that throws cannot be told
 * apart from one that refuses, because the request fails either way. Even
 * trying it by hand would have shown a refusal. The only thing that could have
 * caught it was calling the rule.
 *
 * So the rules now live in utils/blog/activationGuards.js as plain functions
 * over plain values, and these tests call them. The source checks that remain
 * assert only that the ROUTE still calls them, in the right place — which is
 * the one property a unit test genuinely cannot see.
 */

const { refuseMove, refuseOccupiedDomain } = require('./utils/blog/activationGuards');

const SEEN = new Date('2026-10-01T00:00:00Z');
const OWNER = 'ffffffffffffffffffffffff';
const OTHER_OWNER = 'eeeeeeeeeeeeeeeeeeeeeeee';
const OTHER_SITE = 'bbbbbbbbbbbbbbbbbbbbbbbb';

const LIVE = { _id: SITE_ID, user: OWNER, siteUrl: 'roofingamerica.xyz', lastSeenAt: SEEN };

await atest('ACTIVATION REFUSES TO STEAL A LICENCE FROM A LIVE SITE', () => {
  /* The case the ReferenceError hid for as long as it existed. */
  const out = refuseMove({ site: LIVE, reportedUrl: 'hilltophomeloans.net', moveSite: false });

  assert.ok(out, 'a licence was moved off a live site without a word');
  assert.strictEqual(out.reason, 'licence-in-use');
  assert.match(out.error, /roofingamerica\.xyz/, 'the refusal does not name the site at risk');
});

await atest('ticking the box lets the move through', () => {
  /* The refusal is a speed bump, not a wall. If this stops passing, somebody
   * legitimately moving a licence has no way forward at all. */
  assert.strictEqual(
    refuseMove({ site: LIVE, reportedUrl: 'hilltophomeloans.net', moveSite: true }),
    null,
  );
});

await atest('reconnecting the same site is not a move', () => {
  assert.strictEqual(
    refuseMove({ site: LIVE, reportedUrl: 'roofingamerica.xyz', moveSite: false }),
    null,
    'reinstalling the plugin on your own site is refused',
  );
});

await atest('a licence that has never connected has nothing to protect', () => {
  assert.strictEqual(
    refuseMove({ site: { ...LIVE, lastSeenAt: null }, reportedUrl: 'hilltophomeloans.net', moveSite: false }),
    null,
  );
});

await atest('A SECOND KEY ON ONE DOMAIN IS REFUSED', () => {
  /* The question nobody asked. refuseMove looks from the KEY's side — "where
   * is this key registered?" — so two different keys could both be activated
   * against one WordPress and neither would notice the other.
   *
   * roofingamerica.xyz had exactly that: two records, the abandoned one still
   * carrying the business of the domain's previous life, and the scheduler
   * pinging it with a secret that matched nothing. */
  const out = refuseOccupiedDomain({
    site: { _id: OTHER_SITE, user: OWNER },
    occupant: { _id: SITE_ID, user: OWNER, siteUrl: 'roofingamerica.xyz' },
  });

  assert.ok(out, 'a second licence key was allowed onto a site that already has one');
  assert.strictEqual(out.reason, 'domain-taken');
  assert.match(out.error, /[Rr]evoke/, 'the refusal does not say how to get past it');
});

await atest('ANOTHER ACCOUNT\'S SITE IS REFUSED WITHOUT SAYING WHOSE', () => {
  /* This endpoint is reachable by anyone holding any valid licence key. A
   * reply confirming "yes, that domain is registered here" would turn it into
   * a way to ask which of our customers owns which site — and the helpful
   * message names a page the caller could not act on anyway. */
  const out = refuseOccupiedDomain({
    site: { _id: OTHER_SITE, user: OWNER },
    occupant: { _id: SITE_ID, user: OTHER_OWNER, siteUrl: 'roofingamerica.xyz' },
  });

  assert.ok(out, 'a licence was activated onto another account\'s site');
  assert.ok(!out.error.includes('roofingamerica'),
    'the refusal confirms which domain another account holds');
  assert.ok(!('registeredTo' in out), 'the domain leaked in a field instead of the sentence');
});

await atest('the same record is not its own occupant', () => {
  /* Reconnecting an existing site finds ITSELF on that url. Refusing would
   * lock every customer out of their own reinstall. */
  assert.strictEqual(
    refuseOccupiedDomain({
      site: { _id: SITE_ID, user: OWNER },
      occupant: { _id: SITE_ID, user: OWNER, siteUrl: 'roofingamerica.xyz' },
    }),
    null,
  );
});

await atest('an empty domain is nobody\'s, so nothing is refused', () => {
  assert.strictEqual(refuseOccupiedDomain({ site: LIVE, occupant: null }), null);
  assert.strictEqual(refuseMove({ site: LIVE, reportedUrl: '', moveSite: false }), null);
});

await atest('THE ROUTE STILL CALLS BOTH GUARDS, BEFORE THE SECRET IS MINTED', () => {
  /* The one property the tests above cannot see. After the secret is
   * regenerated the damage is already done — the other install is dead
   * whatever happens next — so this is about position, not presence.
   *
   * Comments are stripped first. The notes in that route quote both guard
   * names while explaining this bug, and a raw search would find the
   * explanation and report the fix as present. */
  const fs = require('fs');
  const path = require('path');

  const src = fs.readFileSync(path.join(__dirname, 'routes/blogApiRoute.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^[ \t]*\/\/.*$/gm, ' ');

  const activate = src.slice(
    src.indexOf("'/api/blog/activate'"),
    src.indexOf('site.secret = BlogSite.generateSecret()'),
  );

  assert.ok(activate.length > 0, 'the secret is minted before the handler, or not at all');

  assert.match(activate, /refuseMove\(/,
    'nothing stops a licence being moved off a live site any more');
  assert.match(activate, /refuseOccupiedDomain\(/,
    'nothing stops a second key landing on a site that already has one');
  assert.match(activate, /req\.body\.moveSite/,
    'the move flag is read from somewhere other than the request again');

  /* The occupant has to be LOOKED UP, or the guard is handed undefined on
   * every call and politely approves everything. */
  /* The CONDITION as well as the call. Asserting only that findOne appears
   * passes against `const occupant = false ? await BlogSite.findOne(...)`,
   * where the query is present, never runs, and hands the guard undefined —
   * which it politely approves. Found by mutation; the looser version of this
   * line was the one mutation that got through. */
  assert.match(activate, /const occupant\s*=\s*reportedUrl\s*\?\s*await BlogSite\.findOne\(/,
    'the occupant lookup is no longer reached, so the guard approves everything');
  assert.match(activate, /status:\s*\{\s*\$ne:\s*'revoked'\s*\}/,
    'a revoked licence would block its own replacement, with no way out');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);

if (passed + failed !== DECLARED) {
  console.log(`  MISCOUNT: ${passed + failed} ran, ${DECLARED} declared`);
  process.exit(1);
}

process.exit(failed === 0 ? 0 : 1);

})();
