// test-email-health.js
//
// Does the system notice when its own email stops working?
//
// WHAT THIS IS GUARDING
//
// A fortnight of refused sends went unseen because nothing counted them. The
// count now appears on the admin page and drives a nightly alert, which means
// a bug in THIS file reproduces the original outage exactly: silence that
// looks like health. A counter that reads zero when it should read three is
// worse than no counter, because it is believed.
//
// Hence the emphasis below on the ways a parser returns zero by accident —
// an unrecognised timestamp format, a truncated first line, a log line from
// another event that happens to mention email.
//
//   node test-email-health.js

const assert = require('assert');
const { summariseEmailFailures } = require('./utils/emailHealth');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}\n`); }

const NOW = Date.parse('2026-10-08T22:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();
const HOUR = 3600 * 1000;

function failure({ at = ago(HOUR), to = 'her@example.com', message = 'The threecomets.com domain is not verified' } = {}) {
  return JSON.stringify({
    level: 50, time: at, env: 'production', event: 'email.failed',
    err: { type: 'Object', message, name: 'Error' },
    to, subject: 'Confirm your email address', msg: message,
  });
}

const sum = (text, opts) => summariseEmailFailures(text, { now: NOW, ...opts });

/* ===================================================================== */

section('Counting');

test('a quiet log reports nothing', () => {
  const r = sum('');
  assert.strictEqual(r.count, 0);
  assert.strictEqual(r.latest, null);
});

test('three failures in the window are three', () => {
  const text = [failure(), failure({ at: ago(2 * HOUR) }), failure({ at: ago(3 * HOUR) })].join('\n');
  assert.strictEqual(sum(text).count, 3);
});

test('failures older than the window are not counted', () => {
  /* The window is what makes the number actionable. Without it the count only
   * ever rises and stops meaning "something is wrong right now". */
  const text = [failure({ at: ago(2 * HOUR) }), failure({ at: ago(30 * HOUR) })].join('\n');
  assert.strictEqual(sum(text).count, 1);
});

test('a failure exactly at the window edge is excluded, one inside is not', () => {
  /* Pinned rather than argued about: an off-by-one here is invisible. */
  const DAY = 24 * HOUR;
  assert.strictEqual(sum(failure({ at: ago(DAY + 1) })).count, 0);
  assert.strictEqual(sum(failure({ at: ago(DAY - 1000) })).count, 1);
});

test('other events in the same log are ignored', () => {
  const noise = [
    JSON.stringify({ level: 50, time: ago(HOUR), event: 'blog.post.failed', msg: 'email' }),
    JSON.stringify({ level: 30, time: ago(HOUR), event: 'email.sent', to: 'x@y.z' }),
    failure(),
  ].join('\n');
  assert.strictEqual(sum(noise).count, 1,
    'email.sent and an unrelated error must not be counted as failures');
});

/* ===================================================================== */

section('The ways a parser quietly returns zero');

test('an epoch-millisecond timestamp is understood', () => {
  /* pino's own default is a number, not an ISO string. A parser that only
   * handled one format would read zero on a real production log and look
   * exactly like a healthy system. */
  const line = JSON.stringify({
    level: 50, time: NOW - HOUR, event: 'email.failed',
    err: { message: 'nope' }, to: 'a@b.c',
  });
  assert.strictEqual(sum(line).count, 1);
});

test('a truncated final line does not abort the count', () => {
  /* The tail read starts mid-file, so the FIRST line is usually a fragment,
   * and a log being written to can end mid-line. Either must not throw. */
  const text = ['e":"email.failed","to":"x"}', failure(), '{"level":50,"ev'].join('\n');
  assert.strictEqual(sum(text).count, 1);
});

test('a line that is not JSON at all is skipped', () => {
  const text = ['Signup error: TypeError: boom', failure()].join('\n');
  assert.strictEqual(sum(text).count, 1);
});

test('a failure with an unparseable timestamp is not counted as current', () => {
  /* Better to miss it than to report a permanent phantom failure that never
   * ages out and trains the reader to ignore the badge. */
  const line = JSON.stringify({ level: 50, time: 'yesterday', event: 'email.failed', to: 'a@b.c' });
  assert.strictEqual(sum(line).count, 0);
});

test('a timestamp far in the future is rejected', () => {
  /* A clock skew or a corrupted line should not pin the badge on forever. */
  const line = JSON.stringify({ level: 50, time: NOW + 10 * HOUR, event: 'email.failed', to: 'a@b.c' });
  assert.strictEqual(sum(line).count, 0);
});

test('a missing `now` is refused rather than defaulted', () => {
  /* Defaulting to Date.now() inside would make every test here pass against a
   * frozen fixture by accident, and hide a caller that forgot to pass it. */
  assert.throws(() => summariseEmailFailures(failure(), {}), TypeError);
});

/* ===================================================================== */

section('What the latest failure says');

test('the latest failure carries the reason and the recipient', () => {
  const r = sum(failure({ message: 'The threecomets.com domain is not verified', to: 'her@example.com' }));
  assert.match(r.latest.message, /domain is not verified/);
  assert.strictEqual(r.latest.to, 'her@example.com');
});

test('latest is the most recent, not the last line in the file', () => {
  /* Log order is usually chronological but a tail can straddle a rotation. */
  const text = [failure({ at: ago(HOUR), to: 'recent@x.com' }),
                failure({ at: ago(5 * HOUR), to: 'older@x.com' })].join('\n');
  assert.strictEqual(sum(text).latest.to, 'recent@x.com');
});

test('a failure with no error message still reports something readable', () => {
  const line = JSON.stringify({ level: 50, time: ago(HOUR), event: 'email.failed', to: 'a@b.c' });
  const r = sum(line);
  assert.strictEqual(r.count, 1);
  assert.ok(r.latest.message && r.latest.message.length, 'latest.message must never be empty');
});

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
