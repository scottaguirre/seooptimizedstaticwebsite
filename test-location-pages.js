// test-location-pages.js
//
// Which location pages a site is allowed to have.
//
// WHY THIS EXISTS
//
// A location page for the site's OWN town duplicates the home page. It always
// duplicated it on content; what made it worth blocking was the Rank Fast home
// title changing on 20 September to "{name} in {city, state}", which made the
// location page's title an exact PREFIX of the home page's:
//
//     home      Emergency Plumber Round Rock in Round Rock, TX | Call (512) 894-6167
//     location  Emergency Plumber Round Rock in Round Rock, TX
//
// Two pages, near-identical titles, near-identical content, and no canonical
// saying which one wins — which is "Duplicate without user-selected canonical"
// in Search Console, self-inflicted.
//
// validateAndNormalizeLocationPages() already de-duplicated entries against
// EACH OTHER. It never compared them to the site's own location, so a customer
// typing their own town in the list got the page — an easy mistake, since
// nothing in the form says not to.
//
//   node test-location-pages.js

const assert = require('assert');
const {
  validateAndNormalizeLocationPages,
  parsePlace,
  samePlace,
} = require('./utils/helpers');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

/** Run the validator with location pages switched on. */
const check = (list, mainLocation) =>
  validateAndNormalizeLocationPages(list, '1', mainLocation);

const kept = result => (result.locations || []).map(l => l.display);
const messages = result => (result.fields || []).map(f => f.message);

console.log('\nLocation pages\n');

/* -------------------------------------------------------------------------
 * The block
 * ---------------------------------------------------------------------- */

test('a location page for the site\'s own town is rejected', () => {
  const r = check(['Round Rock, TX'], 'Round Rock, TX');
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(kept(r), []);
  assert.ok(
    messages(r).some(m => /home page already covers/i.test(m)),
    `the message does not explain why: ${JSON.stringify(messages(r))}`
  );
});

test('the rejection ignores case and comma style', () => {
  // "round rock tx", "ROUND ROCK, TX" and "Round Rock TX" are all the same
  // town typed differently, and all slugify to the same file.
  for (const typed of ['round rock tx', 'ROUND ROCK, TX', 'Round Rock TX', ' Round Rock ,  TX ']) {
    assert.strictEqual(check([typed], 'Round Rock, TX').ok, false, `"${typed}" got through`);
  }
});

test('a main location with no state still blocks its own town', () => {
  // The main location field does not force "City, ST", so a customer can have
  // typed just "Round Rock" there.
  assert.strictEqual(check(['Round Rock, TX'], 'Round Rock').ok, false);
});

test('only the offending entry is flagged, not the whole list', () => {
  const r = check(['Austin, TX', 'Round Rock, TX'], 'Round Rock, TX');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.fields.length, 1, JSON.stringify(r.fields));
  assert.ok(/\[1\]/.test(r.fields[0].name), `wrong index flagged: ${r.fields[0].name}`);
});

/* -------------------------------------------------------------------------
 * What must still be allowed
 * ---------------------------------------------------------------------- */

test('other towns pass through untouched', () => {
  const r = check(['Austin, TX', 'Cedar Park, TX', 'Georgetown, TX'], 'Round Rock, TX');
  assert.strictEqual(r.ok, true, JSON.stringify(messages(r)));
  assert.deepStrictEqual(kept(r), ['Austin, TX', 'Cedar Park, TX', 'Georgetown, TX']);
});

test('the same town name in a DIFFERENT state is allowed', () => {
  // Austin, TX and Austin, MN are different places. Comparing on city alone
  // would block a legitimate page.
  const r = check(['Austin, MN'], 'Austin, TX');
  assert.strictEqual(r.ok, true, JSON.stringify(messages(r)));
  assert.deepStrictEqual(kept(r), ['Austin, MN']);
});

test('a town whose name merely CONTAINS the main town is allowed', () => {
  // "Round Rock" vs "Round Rocks" or "North Round Rock" — different towns.
  // The comparison is whole-city, not substring.
  const r = check(['North Round Rock, TX'], 'Round Rock, TX');
  assert.strictEqual(r.ok, true, JSON.stringify(messages(r)));
});

test('no main location disables the check rather than rejecting everything', () => {
  // runGeneration can be handed an older queued job. A missing main location
  // must not empty the location list.
  for (const main of ['', null, undefined, '   ']) {
    const r = check(['Round Rock, TX'], main);
    assert.strictEqual(r.ok, true, `main=${JSON.stringify(main)}`);
    assert.deepStrictEqual(kept(r), ['Round Rock, TX']);
  }
});

/* -------------------------------------------------------------------------
 * The checks that were already there must still work
 * ---------------------------------------------------------------------- */

test('duplicate entries are still caught', () => {
  const r = check(['Austin, TX', 'austin tx'], 'Round Rock, TX');
  assert.strictEqual(r.ok, false);
  assert.ok(messages(r).some(m => /duplicate/i.test(m)), JSON.stringify(messages(r)));
});

test('a bad state code is still caught', () => {
  const r = check(['Austin, ZZ'], 'Round Rock, TX');
  assert.strictEqual(r.ok, false);
  assert.ok(messages(r).some(m => /state/i.test(m)), JSON.stringify(messages(r)));
});

test('an unparseable entry is still caught', () => {
  const r = check(['Austin'], 'Round Rock, TX');
  assert.strictEqual(r.ok, false);
  assert.ok(messages(r).some(m => /City, ST/.test(m)), JSON.stringify(messages(r)));
});

test('the toggle off returns an empty list without validating', () => {
  const r = validateAndNormalizeLocationPages(['Round Rock, TX'], '', 'Round Rock, TX');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.locations, []);
});

test('the toggle on with no entries is still an error', () => {
  const r = check([], 'Round Rock, TX');
  assert.strictEqual(r.ok, false);
  assert.ok(/no locations provided/i.test(r.error), r.error);
});

/* -------------------------------------------------------------------------
 * The comparison itself
 * ---------------------------------------------------------------------- */

test('parsePlace splits every spelling the form accepts', () => {
  assert.deepStrictEqual(parsePlace('Austin, TX'), { city: 'austin', state: 'tx' });
  assert.deepStrictEqual(parsePlace('Austin TX'),  { city: 'austin', state: 'tx' });
  assert.deepStrictEqual(parsePlace('Round  Rock,  TX'), { city: 'round rock', state: 'tx' });
  assert.deepStrictEqual(parsePlace('Austin'),     { city: 'austin', state: '' });
  assert.strictEqual(parsePlace(''), null);
  assert.strictEqual(parsePlace(null), null);
});

test('samePlace compares the state only when both sides have one', () => {
  const tx = { city: 'austin', state: 'tx' };
  const mn = { city: 'austin', state: 'mn' };
  const bare = { city: 'austin', state: '' };

  assert.ok(samePlace(tx, tx));
  assert.ok(samePlace(tx, bare), 'a stateless entry should match its town');
  assert.ok(samePlace(bare, mn), 'a stateless entry should match its town');
  assert.ok(!samePlace(tx, mn), 'different states are different towns');
  assert.ok(!samePlace(tx, { city: 'dallas', state: 'tx' }));
  assert.ok(!samePlace(null, tx));
  assert.ok(!samePlace(tx, null));
});

/* -------------------------------------------------------------------------
 * Both call sites must pass the main location
 * ---------------------------------------------------------------------- */

test('the route and the job runner both pass global.location', () => {
  // The route is the call that REPORTS the problem; runGeneration only
  // destructures `locations` and would silently drop the page. If the route
  // were missing the argument, a customer would sail through the form and
  // lose a page with no explanation anywhere.
  const fs = require('fs');
  const path = require('path');

  for (const file of ['routes/generateRoute.js', 'utils/runGeneration.js']) {
    const src = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const call = src.match(/validateAndNormalizeLocationPages\(([^;]*?)\)/s);
    assert.ok(call, `${file}: no call found`);
    assert.ok(
      /global\.location\b/.test(call[1]),
      `${file} does not pass global.location:\n        ${call[1].replace(/\s+/g, ' ').trim()}`
    );
  }
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');
process.exit(failed === 0 ? 0 : 1);
