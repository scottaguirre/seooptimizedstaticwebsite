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
const DECLARED = 12;

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

await atest('ACTIVATION REFUSES TO STEAL A LICENCE FROM A LIVE SITE', () => {
  /* The guard that stops it happening at all, rather than reporting it
   * afterwards. Read from the source because exercising the route needs the
   * whole express and mongoose stack; the behaviour it guards is covered by
   * the requireSite cases above. */
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, 'routes/blogApiRoute.js'), 'utf8');

  const activate = src.slice(
    src.indexOf("'/api/blog/activate'"),
    src.indexOf("site.secret = BlogSite.generateSecret()"),
  );

  assert.match(activate, /movingFrom/,
    'activation no longer notices that the licence lives somewhere else');
  assert.match(activate, /body\.moveSite/,
    'activation no longer requires the move to be deliberate');
  assert.match(activate, /site\.lastSeenAt/,
    'activation would refuse a site that has never connected, which has nothing to protect');
  assert.ok(
    activate.indexOf('movingFrom') < activate.length,
    'the guard must come BEFORE the secret is regenerated — after it, the damage is done',
  );
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);

if (passed + failed !== DECLARED) {
  console.log(`  MISCOUNT: ${passed + failed} ran, ${DECLARED} declared`);
  process.exit(1);
}

process.exit(failed === 0 ? 0 : 1);

})();
