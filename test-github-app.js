// test-github-app.js
//
// The App's own credentials, and the token it trades them for.
//
// EVERY TEST HERE GENERATES ITS OWN KEY PAIR. Nothing reads GITHUB_APP_KEY,
// nothing touches the network, and the signatures are verified with the
// matching public key rather than compared against a recorded string — a
// fixture signature would only prove the output had not changed, not that it
// is a signature GitHub would accept.
//
//   node test-github-app.js

'use strict';

const assert = require('assert');
const crypto = require('crypto');

const {
  appJwt, installationToken, normaliseKey, JWT_SECONDS, CLOCK_SKEW_SECONDS,
} = require('./utils/github/app');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

const asyncTests = [];
function asyncTest(name, fn) { asyncTests.push([name, fn]); }

/* A real RSA pair, made once. 2048 is what GitHub issues. */
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

const NOW = new Date('2026-10-28T20:00:00Z');
const APP_ID = '1234567';

/** The three segments of a JWT, decoded. */
function parts(jwt) {
  const [header, payload, signature] = jwt.split('.');

  const decode = seg => JSON.parse(
    Buffer.from(seg.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()
  );

  return { header: decode(header), payload: decode(payload), signature, body: `${header}.${payload}` };
}

console.log('\nGitHub App credentials\n');

/* =========================================================================
 * The JWT
 * ====================================================================== */

test('it signs something GitHub could actually verify', () => {
  /* THE POINT OF THE WHOLE FILE. A JWT that parses but does not verify is a
   * 401 from GitHub with no explanation, and comparing against a recorded
   * string would not catch it — only checking the signature against the
   * public key does. */
  const { body, signature } = parts(appJwt({ appId: APP_ID, privateKey, now: NOW }));

  const raw = Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(body), publicKey, raw),
    'the signature does not verify against the matching public key');
});

test('and a different key does not verify it', () => {
  /* The companion. Without this, a verify() that always returned true would
   * pass the test above. */
  const other = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  const { body, signature } = parts(appJwt({ appId: APP_ID, privateKey, now: NOW }));
  const raw = Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

  assert.ok(!crypto.verify('RSA-SHA256', Buffer.from(body), other.publicKey, raw));
});

test('the header says RS256, which is the only algorithm GitHub takes', () => {
  const { header } = parts(appJwt({ appId: APP_ID, privateKey, now: NOW }));

  assert.strictEqual(header.alg, 'RS256');
  assert.strictEqual(header.typ, 'JWT');
});

test('it is issued in the past and expires inside ten minutes', () => {
  /* BOTH MARGINS MATTER AND THEY PULL OPPOSITE WAYS. A clock slow on our
   * side puts `iat` in GitHub's future and it refuses; a clock fast on our
   * side pushes `exp` past the ten minutes it allows and it refuses. Both
   * failures are a bare 401 that says nothing about clocks. */
  const { payload } = parts(appJwt({ appId: APP_ID, privateKey, now: NOW }));

  const seconds = Math.floor(NOW.getTime() / 1000);

  assert.strictEqual(payload.iat, seconds - CLOCK_SKEW_SECONDS, 'iat is not backdated');
  assert.strictEqual(payload.exp - payload.iat, JWT_SECONDS);

  assert.ok(payload.exp - seconds < 600, 'the token outlives what GitHub accepts');
  assert.ok(payload.iat < seconds, 'iat is not in the past');
});

test('the issuer is the App id, as a string', () => {
  /* GitHub wants `iss` as a string. A number is accepted by some of their
   * endpoints and not others, which is the worst kind of working. */
  const { payload } = parts(appJwt({ appId: 1234567, privateKey, now: NOW }));

  assert.strictEqual(payload.iss, '1234567');
  assert.strictEqual(typeof payload.iss, 'string');
});

/* =========================================================================
 * The key, as it survives .env
 * ====================================================================== */

test('a key whose newlines became \\n still works', () => {
  /* A PEM IS MULTI-LINE AND .env IS NOT. This is the mangling that actually
   * happens, and it produces a crypto error that names an OpenSSL decoder
   * routine rather than the problem. */
  const flattened = privateKey.replace(/\n/g, '\\n');

  const { body, signature } = parts(appJwt({ appId: APP_ID, privateKey: flattened, now: NOW }));
  const raw = Buffer.from(signature.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(body), publicKey, raw),
    'a key flattened into .env no longer signs');
});

test('and one wrapped in quotes', () => {
  const quoted = `"${privateKey.replace(/\n/g, '\\n')}"`;

  assert.doesNotThrow(() => appJwt({ appId: APP_ID, privateKey: quoted, now: NOW }));
});

test('normaliseKey leaves a clean PEM alone', () => {
  assert.strictEqual(normaliseKey(privateKey), privateKey.trim());
});

/* =========================================================================
 * What the errors say — and do not say
 * ====================================================================== */

test('a missing key is named, never quoted', () => {
  /* These messages are written to a log. The whole estate is one file: a
   * credential that can mint a token for every client who ever installed
   * the App. Nothing in this module may echo it. */
  assert.throws(
    () => appJwt({ appId: APP_ID, privateKey: '' }),
    /GITHUB_APP_KEY is not set/
  );
});

test('and a malformed key does not leak itself into the error', () => {
  const secretish = '-----BEGIN RSA PRIVATE KEY-----\nSUPERSECRETMATERIAL\n-----END RSA PRIVATE KEY-----';

  try {
    appJwt({ appId: APP_ID, privateKey: secretish });
    assert.fail('a nonsense key was accepted');
  } catch (err) {
    assert.ok(!err.message.includes('SUPERSECRETMATERIAL'),
      'the error message quotes the key material');

    /* AND IT SAYS SOMETHING USEFUL. node's own error here is
     * "error:1E08010C:DECODER routines::unsupported", which has sent people
     * looking at OpenSSL versions for an afternoon. */
    assert.match(err.message, /whole .pem file|BEGIN and END/);
  }
});

test('a missing App id says where to find it', () => {
  assert.throws(() => appJwt({ appId: '', privateKey }), /settings page/);
});

/* =========================================================================
 * The installation token
 * ====================================================================== */

asyncTest('it posts the JWT to the installation it was asked about', async () => {
  const seen = [];

  await installationToken({
    installationId: 98765,
    appId: APP_ID,
    privateKey,
    now: NOW,
    api: async (req) => {
      seen.push(req);
      return { token: 'ghs_x', expires_at: '2026-10-28T21:00:00Z', permissions: {} };
    },
  });

  assert.strictEqual(seen.length, 1);
  assert.strictEqual(seen[0].method, 'POST');
  assert.strictEqual(seen[0].path, '/app/installations/98765/access_tokens');

  /* THE APP'S JWT, NOT AN INSTALLATION TOKEN. This endpoint is the one
   * place the JWT is used; everything after it uses what comes back. */
  const { payload } = parts(seen[0].token);
  assert.strictEqual(payload.iss, APP_ID);
});

asyncTest('and returns the expiry as a Date, not the string GitHub sent', async () => {
  /* A caller comparing `expiresAt > new Date()` against a string gets a
   * silent false, and mints a fresh token on every call for ever. */
  const out = await installationToken({
    installationId: 1,
    appId: APP_ID,
    privateKey,
    now: NOW,
    api: async () => ({ token: 'ghs_x', expires_at: '2026-10-28T21:00:00Z', permissions: { pages: 'write' } }),
  });

  assert.ok(out.expiresAt instanceof Date);
  assert.strictEqual(out.expiresAt.toISOString(), '2026-10-28T21:00:00.000Z');
  assert.strictEqual(out.token, 'ghs_x');
});

asyncTest('it carries back what the client actually granted', async () => {
  /* GitHub lets an installer narrow the permissions the App asked for. A
   * deploy that knows this can say "Pages was not granted" instead of
   * failing with a 403 four calls later, on a different endpoint. */
  const out = await installationToken({
    installationId: 1,
    appId: APP_ID,
    privateKey,
    now: NOW,
    api: async () => ({
      token: 'ghs_x',
      expires_at: '2026-10-28T21:00:00Z',
      permissions: { contents: 'write', metadata: 'read' },
    }),
  });

  assert.deepStrictEqual(out.permissions, { contents: 'write', metadata: 'read' });
  assert.ok(!out.permissions.pages, 'the fixture is not exercising a missing permission');
});

asyncTest('no installation id is refused before any call is made', async () => {
  let called = false;

  await assert.rejects(
    () => installationToken({ appId: APP_ID, privateKey, api: async () => { called = true; } }),
    /No installation id/
  );

  assert.strictEqual(called, false, 'it asked GitHub about nobody');
});

asyncTest('an uninstalled App is explained, not just failed', async () => {
  await assert.rejects(
    () => installationToken({
      installationId: 42,
      appId: APP_ID,
      privateKey,
      now: NOW,
      api: async () => ({}),
    }),
    /uninstalled the App/
  );
});

/* ---------------------------------------------------------------------- */

(async () => {
  for (const [name, fn] of asyncTests) {
    try { await fn(); console.log(`  ok    ${name}`); passed++; }
    catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
  }

  console.log('');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('');
  process.exit(failed === 0 ? 0 : 1);
})();
