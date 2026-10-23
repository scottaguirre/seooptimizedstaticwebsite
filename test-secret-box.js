// test-secret-box.js
//
// Storing a Cloudflare API token we have to be able to USE again.
//
// WHY THIS IS NOT HASHING, WHICH IS THE QUESTION TO ASK FIRST
//
// Licence keys in this system are hashed: SHA-256 and the last four, because
// nothing ever needs the original back — a key is only ever compared against
// one somebody typed. That is the right shape for a secret you VERIFY.
//
// A Cloudflare token is the opposite. The server has to present it to
// Cloudflare on every deploy, so it has to come back out. Encryption, not
// hashing, and the difference is not a detail: a hashed token is a token
// nobody can use, including us.
//
// WHAT THAT COSTS AND WHY IT IS STILL WORTH DOING
//
// Encryption at rest does not protect against a compromised server — the key
// is on that server. It protects against everything short of that: a database
// backup on somebody's laptop, a Mongo instance briefly exposed, a dump
// attached to a support ticket, a stolen Atlas snapshot. Ten customers'
// Cloudflare tokens in plaintext in a collection is a different kind of bad
// day from ten encrypted ones.
//
// IT IS AES-256-GCM, SO TAMPERING IS DETECTED RATHER THAN DECRYPTED. A
// ciphertext somebody edited comes back as an error, not as a different
// token. CBC would hand back plausible-looking rubbish and the first thing
// anybody would do with it is send it to Cloudflare.
//
//   node test-secret-box.js

const assert = require('assert');
const crypto = require('crypto');

const KEY_A = crypto.randomBytes(32).toString('hex');
const KEY_B = crypto.randomBytes(32).toString('hex');

/* SET BEFORE THE MODULE IS REQUIRED, because a module that reads its key at
 * load would otherwise cache the absence of one. Which is itself worth
 * knowing — see the test about a key added after boot. */
process.env.CF_TOKEN_KEY = KEY_A;

const {
  seal, open, isSealed, KEY_BYTES,
} = require('./utils/blog/cloudflare/secretBox');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

/** Run with a particular key in the environment, then put it back. */
function withKey(key, fn) {
  const before = process.env.CF_TOKEN_KEY;
  if (key === null) delete process.env.CF_TOKEN_KEY;
  else process.env.CF_TOKEN_KEY = key;

  try { return fn(); }
  finally {
    if (before === undefined) delete process.env.CF_TOKEN_KEY;
    else process.env.CF_TOKEN_KEY = before;
  }
}

const TOKEN = 'cf-live-token-W3jK9qLmNpR2sT5vX8zB1dF4gH7';

console.log('\nSealing and opening\n');

test('A SEALED TOKEN COMES BACK EXACTLY', () => {
  assert.strictEqual(open(seal(TOKEN)), TOKEN);
});

test('AND THE SEALED FORM DOES NOT CONTAIN THE TOKEN', () => {
  /* The entire point, stated as the one assertion that would catch an
   * implementation that base64'd the thing and called it done. */
  const sealed = seal(TOKEN);

  assert.ok(!sealed.includes(TOKEN), 'the token is sitting in the ciphertext');
  assert.ok(!Buffer.from(sealed, 'base64').toString('utf8').includes(TOKEN),
    'the token survives a base64 decode of the sealed value');
});

test('SEALING THE SAME TOKEN TWICE GIVES DIFFERENT CIPHERTEXT', () => {
  /* A FRESH IV EVERY TIME, and the reason is not theoretical here: ten
   * accounts' rows sit in one collection, and identical ciphertext would
   * say "these two customers gave us the same token" to anybody reading
   * the database. It also means a repeated value cannot be recognised
   * across a backup. */
  assert.notStrictEqual(seal(TOKEN), seal(TOKEN));
});

test('AND BOTH STILL OPEN', () => {
  assert.strictEqual(open(seal(TOKEN)), TOKEN);
  assert.strictEqual(open(seal(TOKEN)), TOKEN);
});

test('A TOKEN WITH AWKWARD CHARACTERS SURVIVES', () => {
  /* Cloudflare's tokens are base64url today. They are not contractually
   * so, and a round trip that only works for [A-Za-z0-9_-] is a round trip
   * waiting for a format change. */
  for (const value of ['a', 'x'.repeat(500), 'tök€n with spaces', '{"json":"shaped"}', '====']) {
    assert.strictEqual(open(seal(value)), value, `did not survive: ${value}`);
  }
});

console.log('\nWhat it refuses\n');

test('A TAMPERED CIPHERTEXT IS AN ERROR, NOT A DIFFERENT TOKEN', () => {
  /* WHY GCM AND NOT CBC. A mode without authentication hands back
   * plausible-looking rubbish for an edited ciphertext, and the first
   * thing anybody would do with the result is send it to Cloudflare —
   * which answers with an authentication failure that reads like a revoked
   * token. The tampering never surfaces. */
  const sealed = seal(TOKEN);
  const bytes = Buffer.from(sealed, 'base64');

  bytes[bytes.length - 1] ^= 0xff;

  assert.throws(() => open(bytes.toString('base64')),
    /could not be read|decrypt/i,
    'an edited ciphertext was accepted');
});

test('AND SO IS ONE SEALED WITH A DIFFERENT KEY', () => {
  /* The rotated-key case. It has to fail loudly: a token that silently
   * decodes to nonsense would be sent to Cloudflare and come back as an
   * auth error, and somebody would spend the afternoon on the token
   * instead of on the key. */
  const sealed = withKey(KEY_B, () => seal(TOKEN));

  assert.throws(() => withKey(KEY_A, () => open(sealed)),
    /could not be read|decrypt/i);
});

test('AND SO IS SOMETHING THAT WAS NEVER SEALED AT ALL', () => {
  /* A plaintext token written straight into the field by a migration, a
   * script, or somebody editing the database by hand. It must not be
   * returned as though it had been encrypted — the whole guarantee is that
   * what comes out of this function went through it. */
  for (const junk of ['', 'not-sealed', TOKEN, 'eyJhIjoxfQ==']) {
    assert.throws(() => open(junk), /could not be read|decrypt|not sealed/i,
      `accepted unsealed input: ${junk}`);
  }
});

test('A VALUE THAT IS NOT CANONICAL BASE64 IS NOT SEALED', () => {
  /* ADDED AFTER MUTATION FOUND THIS AND THE TEST BELOW COVERING FOR EACH
   * OTHER — 22 October.
   *
   * isSealed() does two checks: the value round-trips through base64
   * unchanged, and the first byte is the version. Removing EITHER one
   * survived every test, because whatever the first check let through, the
   * second caught, and vice versa. Two guards, each tested only by the
   * other's failure, is the same as neither being tested.
   *
   * This one needs the round-trip check specifically: the bytes are a real
   * sealed value, so the version byte is right — only the encoding is off.
   * Buffer.from is famously forgiving and decodes it anyway. */
  const sealed = seal(TOKEN);

  assert.strictEqual(isSealed(`${sealed} `), false, 'trailing whitespace was accepted');
  assert.strictEqual(isSealed(`${sealed}!!`), false, 'junk on the end was accepted');
  assert.strictEqual(isSealed(sealed.replace(/=+$/, '')), false,
    'a value with its padding stripped was accepted');
});

test('AND ONE WITH THE WRONG VERSION BYTE IS NOT EITHER', () => {
  /* The other half of that pair. This value IS canonical base64 and IS
   * long enough — only the version is wrong, which is exactly what a blob
   * written by some future scheme would look like. Opening it with this
   * build's layout would slice the IV and tag out of the wrong offsets. */
  const bytes = Buffer.from(seal(TOKEN), 'base64');
  bytes[0] = 99;

  assert.strictEqual(isSealed(bytes.toString('base64')), false,
    'a blob from a different sealing scheme was treated as ours');
});

test('A TRUNCATED BLOB IS REPORTED AS MALFORMED, NOT AS A KEY PROBLEM', () => {
  /* THE TWO MESSAGES ARE DIFFERENT ON PURPOSE AND NOTHING CHECKED IT —
   * mutation found that removing the length floor changed nothing any test
   * could see, because both paths end in a throw and every test here only
   * asserted that SOMETHING was thrown.
   *
   * They want different actions. "The key has changed" means re-enter the
   * tokens on every account. "Not in the sealed format" means look at that
   * one row. Sending somebody to rotate ten credentials over a truncated
   * field is an afternoon.
   *
   * A two-byte buffer whose first byte is the version is canonical base64
   * and passes every other check, so the floor is the only thing standing
   * between it and being sliced into an IV that does not exist. */
  const stub = Buffer.from([1, 2]).toString('base64');

  assert.strictEqual(isSealed(stub), false, 'a two-byte value was called sealed');
  assert.throws(() => open(stub), /not in the sealed format/i,
    'a truncated row was blamed on the key');
});

test('isSealed SAYS WHICH IS WHICH WITHOUT THROWING', () => {
  /* So a caller can tell a plaintext row from an encrypted one — during a
   * migration, or when an admin screen has to decide whether to show
   * "stored" or "needs re-entering". A question you have to ask inside a
   * try/catch is a question that gets skipped. */
  assert.strictEqual(isSealed(seal(TOKEN)), true);
  assert.strictEqual(isSealed(TOKEN), false);
  assert.strictEqual(isSealed(''), false);
  assert.strictEqual(isSealed(null), false);
  assert.strictEqual(isSealed(undefined), false);
});

console.log('\nThe key itself\n');

test('NO KEY IS A CLEAR ERROR, NOT A SILENT PASSTHROUGH', () => {
  /* THE DANGEROUS DEFAULT THIS RULES OUT. A seal() that returned the
   * plaintext when no key was configured would work perfectly in
   * development and write ten live Cloudflare tokens into the database in
   * clear on the first server that was missing the variable. Nothing would
   * look wrong. */
  withKey(null, () => {
    assert.throws(() => seal(TOKEN), /CF_TOKEN_KEY/,
      'it sealed something with no key');
    assert.throws(() => open('anything'), /CF_TOKEN_KEY/);
  });
});

test('A KEY OF THE WRONG LENGTH IS REFUSED', () => {
  /* Somebody generating one with `openssl rand -hex 16` instead of 32, or
   * pasting a truncated value. Half a key is not half the security, it is
   * an error at a random later moment. */
  for (const bad of ['short', crypto.randomBytes(16).toString('hex'), 'z'.repeat(64)]) {
    withKey(bad, () => {
      assert.throws(() => seal(TOKEN), /CF_TOKEN_KEY/,
        `accepted a bad key: ${bad.slice(0, 12)}`);
    });
  }
});

test('THE KEY IS READ AT CALL TIME, NOT CACHED AT LOAD', () => {
  /* A module that read its key once at require() would be permanently
   * broken on a server that loaded it before the environment was
   * populated — and the symptom is "encryption is off", which nobody
   * notices. It also makes key rotation a restart rather than a redeploy.
   *
   * SEALED UNDER ONE KEY AND OPENED UNDER THE OTHER, which is the only
   * arrangement that can see caching. The first version sealed and opened
   * under the SAME key: a cached key gives a perfect round trip, because
   * both halves use the same wrong value. It passed against a module that
   * ignored the environment entirely. */
  const sealed = withKey(KEY_B, () => seal(TOKEN));

  assert.strictEqual(withKey(KEY_B, () => open(sealed)), TOKEN);

  assert.throws(() => withKey(KEY_A, () => open(sealed)), /could not be read/i,
    'the key was cached, so the second key was never consulted');
});

test('AND THE KEY LENGTH IS STATED, NOT LEFT TO BE GUESSED', () => {
  /* So the note telling Edwin how to generate one cannot drift from what
   * the code accepts. */
  assert.strictEqual(KEY_BYTES, 32);
});

console.log('\nWhat gets said out loud\n');

test('AN ERROR NEVER CARRIES THE TOKEN OR THE KEY', () => {
  /* These errors are thrown inside the deploy path and end up in the log,
   * which is the one place a secret must never be. */
  withKey(KEY_B, () => {
    const sealed = seal(TOKEN);

    try {
      withKey(KEY_A, () => open(sealed));
      assert.fail('it did not throw');
    } catch (err) {
      const said = `${err.message}\n${err.stack || ''}`;
      assert.ok(!said.includes(TOKEN), 'the token reached the error');
      assert.ok(!said.includes(KEY_A), 'the key reached the error');
      assert.ok(!said.includes(KEY_B), 'the other key reached the error');
    }
  });
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
