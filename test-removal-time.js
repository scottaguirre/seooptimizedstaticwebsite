// test-removal-time.js
//
// When a campaign was removed, as reported by the site it was removed from.
//
// Every branch in parseReportedRemoval() is a REJECTION, and a rejection is
// the kind of code that looks right for ever because nothing exercises it.
// These run with no database, no network and no express — the function takes
// two plain values.
//
//   node test-removal-time.js

const assert = require('assert');
const { parseReportedRemoval, FUTURE_SKEW_MS } = require('./utils/blog/removalTime');

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

const born = new Date('2026-09-01T09:00:00Z');
const campaign = { createdAt: born };

console.log('\nThe removal time a site reports\n');

test('A GOOD TIME IS TAKEN AS REPORTED', () => {
  /* The whole point. Six campaigns read "removed 09-28-2026" because the
   * server stamped its own clock when it finally heard, eight days after the
   * customer pressed the button. */
  const at = new Date('2026-09-20T14:00:00Z');

  assert.strictEqual(
    parseReportedRemoval(at.toISOString(), campaign).getTime(), at.getTime(),
    'a perfectly good reported time was thrown away');
});

test('no time at all falls back to the server clock', () => {
  // An older plugin sends only the campaign id. null means "use your own".
  assert.strictEqual(parseReportedRemoval(undefined, campaign), null);
  assert.strictEqual(parseReportedRemoval('', campaign), null);
  assert.strictEqual(parseReportedRemoval(null, campaign), null);
});

test('nonsense is refused rather than turned into a date', () => {
  /* new Date('yesterday') is Invalid Date, and Invalid Date written to Mongo
   * is a field that breaks every comparison it takes part in. */
  assert.strictEqual(parseReportedRemoval('yesterday', campaign), null);
  assert.strictEqual(parseReportedRemoval('not a date', campaign), null);
  assert.strictEqual(parseReportedRemoval({}, campaign), null);
  assert.strictEqual(parseReportedRemoval([], campaign), null);
});

test('A TIME IN THE FUTURE IS REFUSED', () => {
  const ahead = new Date(Date.now() + 26 * 60 * 60 * 1000);

  assert.strictEqual(parseReportedRemoval(ahead.toISOString(), campaign), null,
    'a site with a fast clock can date a removal tomorrow');
});

test('...but ordinary clock skew is not', () => {
  /* BOTH SIDES OF THE BOUNDARY, because a test that only checks the far side
   * passes just as happily against a guard that refuses everything. Servers
   * disagree by seconds; refusing those would mean the fallback fires on
   * almost every removal and the feature quietly does nothing. */
  const nearly = new Date(Date.now() + FUTURE_SKEW_MS - 30 * 1000);

  assert.ok(parseReportedRemoval(nearly.toISOString(), campaign),
    'a few minutes of ordinary skew was treated as a bad clock');

  const past = new Date(Date.now() + FUTURE_SKEW_MS + 60 * 1000);

  assert.strictEqual(parseReportedRemoval(past.toISOString(), campaign), null,
    'the skew window does not actually close');
});

test('A REMOVAL CANNOT PRECEDE THE CAMPAIGN IT REMOVES', () => {
  /* The bound that catches a clock set to the wrong year — the failure that
   * would otherwise write a date reordering the customer's own history. */
  const before = new Date('2025-09-20T14:00:00Z');

  assert.strictEqual(parseReportedRemoval(before.toISOString(), campaign), null,
    'a removal was accepted from before the campaign existed');
});

test('the campaign\'s own birthday is allowed', () => {
  // Planned and removed the same morning is a real thing customers do, and
  // an off-by-one here would reject it.
  assert.ok(parseReportedRemoval(born.toISOString(), campaign),
    'a campaign removed the moment it was created cannot report its time');
});

test('a campaign with no createdAt still accepts a sane time', () => {
  /* The bound is skipped rather than defaulting to 0 or to now. Old records
   * predate the field, and refusing their removals would make the fallback
   * permanent for exactly the accounts most likely to be tidying up. */
  const at = new Date('2026-09-20T14:00:00Z');

  assert.ok(parseReportedRemoval(at.toISOString(), {}),
    'a campaign with no creation date cannot report a removal time');
  assert.ok(parseReportedRemoval(at.toISOString(), null),
    'a missing campaign throws instead of falling back');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
