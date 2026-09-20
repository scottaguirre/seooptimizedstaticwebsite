// test-anchor-pool.js
//
// The anchor pool: what phrases each bucket is allowed to contain.
//
// WHY THIS EXISTS
//
// Every string in here is published as visible link text on a customer's site.
// A bad one is not a crash — it is a live post reading "…a plumber near mes
// can test the flow…", which is what shipped and is what prompted this file.
//
// Nothing about that was caught by the existing tests, because they check the
// SHAPE of the pool (four buckets, non-empty, no reuse) and never read a
// single phrase. These tests read the phrases.
//
//   node test-anchor-pool.js

const assert = require('assert');
const { buildAnchorPool, pluralise } = require('./utils/blog/anchorPool');
const { DEFAULT_MIX } = require('./utils/blog/anchors');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

const BUSINESS = { name: 'Acme Plumbing', location: 'Leander, TX' };
const poolFor = keyword =>
  buildAnchorPool({ targetPage: { keyword }, business: BUSINESS, count: 12 });

console.log('\nAnchor pool\n');

/* -------------------------------------------------------------------------
 * pluralise — the function that shipped "plumber near mes"
 * ---------------------------------------------------------------------- */

test('a plain service phrase pluralises on its last word', () => {
  assert.strictEqual(pluralise('water heater repair'), 'water heater repairs');
  assert.strictEqual(pluralise('roof replacement'), 'roof replacements');
});

test('a -y ending becomes -ies', () => {
  assert.strictEqual(pluralise('plumbing company'), 'plumbing companies');
});

test('a phrase with a preposition is NOT pluralised', () => {
  // THE BUG. The head noun is "plumber"; everything after the preposition is
  // a modifier, and an s on the end of a modifier is never right.
  assert.strictEqual(pluralise('plumber near me'), 'plumber near me');
  assert.strictEqual(pluralise('plumber in Leander'), 'plumber in Leander');
  assert.strictEqual(pluralise('repairs for older homes'), 'repairs for older homes');
});

test('a pronoun ending is NOT pluralised', () => {
  assert.strictEqual(pluralise('call me'), 'call me');
});

test('a gerund or mass noun is NOT pluralised', () => {
  // "plumbings" is not a word.
  assert.strictEqual(pluralise('emergency plumbing'), 'emergency plumbing');
  assert.strictEqual(pluralise('24 hour plumbing'), '24 hour plumbing');
  assert.strictEqual(pluralise('drain cleaning'), 'drain cleaning');
});

test('something already plural is left alone', () => {
  assert.strictEqual(pluralise('residential plumbing services'), 'residential plumbing services');
});

/* -------------------------------------------------------------------------
 * Exact means exact
 * ---------------------------------------------------------------------- */

test('the exact bucket holds the keyword and nothing else', () => {
  const { pool } = poolFor('water heater repair');
  assert.deepStrictEqual(pool.exact, ['water heater repair']);
});

test('the keyword never appears in the semantic bucket', () => {
  // It would be an exact-match anchor wearing the wrong label, quietly
  // inflating the exact share past its 30%.
  for (const kw of ['water heater repair', 'plumber near me', 'residential plumbing services']) {
    const { pool } = poolFor(kw);
    assert.ok(!pool.semantic.includes(kw), `"${kw}" leaked into semantic`);
  }
});

/* -------------------------------------------------------------------------
 * Nothing in any bucket reads as broken English
 * ---------------------------------------------------------------------- */

test('no anchor doubles a word', () => {
  // "residential plumbing services services" came from appending `services`
  // to a keyword that already ended in it.
  for (const kw of ['residential plumbing services', 'water heater repair', 'plumbing service']) {
    const { pool } = poolFor(kw);
    for (const phrase of Object.values(pool).flat()) {
      const words = phrase.toLowerCase().split(/\s+/);
      for (let i = 1; i < words.length; i++) {
        assert.notStrictEqual(words[i], words[i - 1], `"${phrase}" repeats "${words[i]}"`);
      }
    }
  }
});

test('a search-query keyword gets no suffixed anchors', () => {
  // "plumber near me services", "booking plumber near me", "plumber near me
  // near Leander" — every template that appends after the keyword breaks when
  // the keyword already ends in a modifier.
  const { pool } = poolFor('plumber near me');
  for (const phrase of Object.values(pool).flat()) {
    assert.ok(
      !/near me\s+\S/i.test(phrase),
      `something was appended after "near me": "${phrase}"`
    );
  }
});

test('a search-query keyword still gets prefixed anchors', () => {
  // Adjectives in FRONT read fine, so the guard must not empty the bucket.
  const { pool } = poolFor('plumber near me');
  assert.ok(pool.semantic.length >= 3, `only ${pool.semantic.length} semantic anchors`);
  assert.ok(pool.semantic.some(a => /^local /.test(a)), 'lost the simple prefixes too');
});

test('a normal keyword keeps its full set of variants', () => {
  // The guard above must not fire on an ordinary service name.
  const { pool } = poolFor('water heater repair');
  assert.ok(pool.semantic.length >= 12, `only ${pool.semantic.length} semantic anchors`);
  assert.ok(pool.semantic.includes('booking water heater repair'));
});

/* -------------------------------------------------------------------------
 * The branded bucket, when the business name is not a neutral string
 *
 * Rank Fast customers are named after their town and their service ON PURPOSE
 * — "Emergency Plumber Round Rock" — so the branded templates cannot assume
 * the name is a bare brand sitting next to the keyword.
 * ---------------------------------------------------------------------- */

const brandedFor = (name, location, keyword) =>
  buildAnchorPool({
    targetPage: { keyword },
    business: { name, location },
    count: 30,                       // enough to reach past the first phrase
  }).pool.branded;

test('a name that already contains the town does not gain it again', () => {
  // "Emergency Plumber Round Rock in Round Rock". Invisible on a 12-post
  // campaign — 10% of 12 is ONE branded anchor and `name` alone is first in
  // the list — and shipped from 15 posts up, where a second is needed. Not
  // rare, just second.
  for (const phrase of brandedFor('Emergency Plumber Round Rock', 'Round Rock, TX', 'water heater repair')) {
    assert.ok(
      (phrase.match(/Round Rock/gi) || []).length <= 1,
      `"${phrase}" names the town twice`
    );
  }
});

test('a name that already contains the service does not gain it again', () => {
  // "Water Heater Repair Leander's water heater repair".
  for (const phrase of brandedFor('Water Heater Repair Leander', 'Leander, TX', 'water heater repair')) {
    assert.ok(
      (phrase.match(/water heater repair/gi) || []).length <= 1,
      `"${phrase}" names the service twice`
    );
  }
});

test('an ordinary name still gets the full branded set', () => {
  // The guards must not fire on a business named like a business, or they
  // empty the bucket that is already the smallest one.
  const branded = brandedFor('Acme Plumbing', 'Leander, TX', 'water heater repair');
  assert.ok(branded.includes('Acme Plumbing in Leander'), branded.join(' | '));
  assert.ok(branded.includes("Acme Plumbing's water heater repair"), branded.join(' | '));
  assert.strictEqual(branded.length, 4, branded.join(' | '));
});

test('the town check is word-boundary, not substring', () => {
  // The needle has to be a SUBSTRING of the name without being a word in it,
  // or this proves nothing. "Rock Hill" inside "Rockwall Plumbing" was the
  // first fixture here and it is not a substring either way — a mutation
  // swapping the word-boundary check for .includes() survived against it.
  //
  // "Bell" IS inside "Bellaire". Both are real Texas towns, and a substring
  // check drops the perfectly good "Bellaire Plumbing in Bell".
  const branded = brandedFor('Bellaire Plumbing', 'Bell, TX', 'drain cleaning');
  assert.ok(branded.includes('Bellaire Plumbing in Bell'), branded.join(' | '));
});

test('the service check is word-boundary, not substring', () => {
  // "roof" is inside "Roofing", so a substring check drops
  // "Roofing Masters's roof" — a business whose name does not contain the
  // keyword at all, quietly losing a quarter of its branded bucket.
  const branded = brandedFor('Roofing Masters', 'Leander, TX', 'roof');
  assert.ok(branded.includes("Roofing Masters's roof"), branded.join(' | '));
});

test('a branded phrase is never the keyword verbatim', () => {
  // A business named exactly after the target keyword would put an exact-match
  // anchor in the branded bucket — inflating the exact share past its 30%
  // while it was counted as branded.
  for (const phrase of brandedFor('Water Heater Repair', 'Leander, TX', 'Water Heater Repair')) {
    assert.notStrictEqual(
      phrase.toLowerCase().trim(),
      'water heater repair',
      'the keyword is sitting in the branded bucket'
    );
  }
});

/* -------------------------------------------------------------------------
 * Every bucket can still feed a campaign
 * ---------------------------------------------------------------------- */

test('no bucket is empty, for any keyword shape', () => {
  // An empty bucket makes pickAnchors throw.
  for (const kw of ['water heater repair', 'plumber near me', 'residential plumbing services', 'plumbing']) {
    const { pool } = poolFor(kw);
    for (const [type, list] of Object.entries(pool)) {
      assert.ok(list.length > 0, `${type} is empty for "${kw}"`);
    }
  }
});

test('only the exact bucket is allowed to run short', () => {
  // Exact is meant to repeat; the others are not, and a shortfall there is
  // worth reporting.
  const { shortfalls } = poolFor('water heater repair');
  assert.ok(!shortfalls.some(s => s.type === 'exact'), 'exact was reported as short');
});

test('the mix still totals 100', () => {
  const total = Object.values(DEFAULT_MIX).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 100, JSON.stringify(DEFAULT_MIX));
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');
process.exit(failed === 0 ? 0 : 1);
