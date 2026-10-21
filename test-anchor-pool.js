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
const { DEFAULT_MIX, bucketCounts } = require('./utils/blog/anchors');

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

test('A PAST PARTICIPLE IS NOT PLURALISED', () => {
  /* SHIPPED AS LIVE ANCHOR TEXT on hilltophomeloans.net: a post linked to its
   * pillar with the words "loan terms explaineds".
   *
   * The gerund guard above already knew the shape of this mistake — a gerund
   * is not a countable noun, so `-ing` is excluded. `-ed` is the same fact
   * about a different suffix, and nobody had met it because until pillar
   * campaigns every keyword was a service name. A PILLAR'S KEYWORD COMES FROM
   * ITS POST TITLE, and titles end in words that service names never do. */
  assert.strictEqual(pluralise('loan terms explained'), 'loan terms explained');
  assert.strictEqual(pluralise('mortgage rates compared'), 'mortgage rates compared');
  assert.strictEqual(pluralise('fees itemised'), 'fees itemised');
});

test('a real noun ending in -ed still pluralises', () => {
  /* The guard must not be so keen that it refuses words which genuinely are
   * nouns. Few enough to name, and each is one syllable with no verb behind
   * it here. The wrong direction to err is "sheds" where the phrase meant
   * "shed light" — not "shed" where it meant the building. */
  assert.strictEqual(pluralise('garden shed'), 'garden sheds');
  assert.strictEqual(pluralise('hospital bed'), 'hospital beds');
  assert.strictEqual(pluralise('grass seed'), 'grass seeds');
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

test('THE MIX IS WHAT THE COMMENTS SAY IT IS', () => {
  /* A COMMENT NOBODY CAN CHECK IS A COMMENT THAT GOES STALE.
   *
   * anchorPool.js's header described exact as "only 15%" and semantic as
   * "50%" for weeks after the code moved to 30/40/20/10, and the docblock on
   * bucketCounts() carried a third set again. Nothing failed, because prose
   * is not executed — the file's own description of itself was simply wrong,
   * and a comment that contradicts the code is worse than none, since the
   * next reader believes it and stops reading.
   *
   * The header no longer restates the numbers at all; it points at
   * DEFAULT_MIX. This pins the one example that still has to carry them. */
  assert.deepStrictEqual(DEFAULT_MIX,
    { exact: 30, semantic: 40, descriptive: 20, branded: 10 },
    'the mix changed — the worked example in anchors.js needs rewriting with it');

  /* The example in bucketCounts()'s docblock, asserted rather than trusted.
   *
   * NINE, not four, and that is the point of the example: at 4, 7 and 12
   * plain rounding happens to total correctly. Nine is where it gives ten
   * slots for a nine-post campaign. An example chosen from the cases where
   * the bug does not bite argues for the wrong thing. */
  const plain = Object.entries(DEFAULT_MIX)
    .map(([, share]) => Math.round((share / 100) * 9))
    .reduce((a, b) => a + b, 0);

  assert.strictEqual(plain, 10, 'nine posts no longer demonstrate the rounding fault');

  assert.deepStrictEqual(bucketCounts(9),
    { exact: 3, semantic: 3, descriptive: 2, branded: 1 },
    'bucketCounts(9) no longer matches the worked example in its own docblock');
});

/* -------------------------------------------------------------------------
 * A BLOG IS NOT A BUSINESS — 20 October 2026
 *
 * `branded` was the one bucket never split between a local business and an
 * informational site. `semantic` was split after "professional carbon offset
 * programs" shipped; `descriptive` was split after "what the work involves"
 * went out on a blog about a subject nobody performs. `branded` kept its four
 * templates for everyone, so Edwin's blogs linked to their own pillar with:
 *
 *     All About Plumbing's plumbing jobsite injuries
 *     the team at All About Plumbing
 *
 * There is no team, nobody is hiring anyone, and the blog does not HAVE
 * plumbing jobsite injuries. Two fixes had already been made for exactly this
 * and neither crossed to the third bucket.
 *
 * Not rare: 10% of links are branded and `the team at …` is second in the
 * list, so it ships from roughly fifteen posts up. Edwin runs twenty-five.
 * ---------------------------------------------------------------------- */

const BLOG = { name: 'All About Plumbing' };          // no location: not local
const blogPool = (keyword, count = 25) =>
  buildAnchorPool({ targetPage: { keyword }, business: BLOG, count });
const localPool = (keyword, count = 25) =>
  buildAnchorPool({ targetPage: { keyword }, business: BUSINESS, count });

test('A BLOG GETS NO BRANDED ANCHORS AT ALL', () => {
  assert.deepStrictEqual(blogPool('plumbing jobsite injuries').pool.branded, [],
    'a blog is still linking to itself by name');
});

test('and in particular not the two that invent a company', () => {
  /* The plain name is at least a true statement. These two are not: one
   * asserts the blog performs the service, the other that it has staff. */
  const flat = JSON.stringify(blogPool('plumbing jobsite injuries').pool);

  assert.ok(!/the team at/i.test(flat), 'a blog still claims to have a team');
  assert.ok(!/All About Plumbing's/i.test(flat), 'a blog still claims to do the work');
});

test('BUT A LOCAL BUSINESS KEEPS ITS NAME, WHICH IS THE POINT OF THE BUCKET', () => {
  /* The fix is a split, not a deletion. For a real business this is the one
   * bucket a competitor cannot imitate. */
  const { pool } = localPool('water heater repair');

  assert.ok(pool.branded.includes('Acme Plumbing'), 'the business name itself is gone');
  assert.ok(pool.branded.length >= 2, 'a local business lost its branded anchors');
});

test('THE SHARE A BLOG WOULD HAVE SPENT ON BRANDED GOES TO SEMANTIC', () => {
  /* Edwin's call, 20 October. It could have gone to descriptive — that
   * bucket had room and semantic did not — so the four new templates below
   * exist to make this the right answer rather than merely the chosen one. */
  const { mix } = blogPool('plumbing jobsite injuries');

  assert.strictEqual(mix.branded, 0, 'a blog still spends part of its links on branded');
  assert.strictEqual(mix.semantic, DEFAULT_MIX.semantic + DEFAULT_MIX.branded,
    'the branded share went somewhere other than semantic');
  assert.strictEqual(mix.exact, DEFAULT_MIX.exact, 'the exact share moved');
  assert.strictEqual(mix.descriptive, DEFAULT_MIX.descriptive, 'the descriptive share moved');
});

test('AND A LOCAL BUSINESS IS LEFT ON THE ORIGINAL MIX', () => {
  assert.deepStrictEqual(localPool('water heater repair').mix, DEFAULT_MIX,
    'a local business no longer uses the default mix');
});

test('A SHARE OF ZERO IS NEVER ALLOCATED A SLOT', () => {
  /* bucketCounts hands leftovers to the largest fractional parts, and a zero
   * share has a fraction of zero — so it should sort last and never be
   * reached. That is an argument, and an argument is not a test: one branded
   * anchor appearing on a blog would undo the whole change. */
  const { allocateAnchorTypes } = require('./utils/blog/anchors');
  const mix = { exact: 30, semantic: 50, descriptive: 20, branded: 0 };

  for (let n = 2; n <= 60; n++) {
    const counts = bucketCounts(n, mix);

    assert.strictEqual(counts.branded, 0, `bucketCounts(${n}) gave a branded slot to a blog`);
    assert.strictEqual(counts.exact + counts.semantic + counts.descriptive, n,
      `bucketCounts(${n}) did not fill every slot`);
    assert.ok(!allocateAnchorTypes(n, mix).includes('branded'),
      `allocateAnchorTypes(${n}) put a branded anchor in a blog campaign`);
  }
});

test('A BLOG HAS FOUR MORE WAYS TO SAY ITS KEYWORD', () => {
  /* WHY PREFIXES AND NOT SUFFIXES. Two of Edwin's own keywords — "plumber
   * return to work injury" and "exoskeletons for plumbers" — carry a
   * preposition, so `suffixable` is false and every appending template is
   * dropped. A prefix cannot be tripped that way, which is the same reason
   * the templates already in this branch wrap the keyword. */
  const { pool } = blogPool('plumbing jobsite injuries');

  for (const phrase of [
    'what to know about plumbing jobsite injuries',
    'the basics of plumbing jobsite injuries',
    'a guide to plumbing jobsite injuries',
    'an overview of plumbing jobsite injuries',
  ]) {
    assert.ok(pool.semantic.includes(phrase), `missing: ${phrase}`);
  }
});

test('AND THEY SURVIVE A KEYWORD WITH A PREPOSITION IN IT', () => {
  /* The case that made them prefixes. If these four were suffixes the bucket
   * would be back where it started on exactly this keyword. */
  const { pool } = blogPool('exoskeletons for plumbers');

  assert.ok(pool.semantic.includes('a guide to exoskeletons for plumbers'),
    'a keyword with a preposition lost the new anchors too');
});

test('A LOCAL BUSINESS DOES NOT GET THEM', () => {
  /* They live in the general branch. Putting them in both is how two sets
   * stop being two sets. */
  assert.ok(!localPool('water heater repair').pool.semantic.includes('a guide to water heater repair'),
    'the blog templates leaked into the local set');
});

test('THEY NARROW THE SHORTFALL THE CHANGE WAS MEASURED AGAINST', () => {
  /* The number that started this: 25 posts, "only 5 semantic anchor(s)
   * available for 10 needed". With branded folded in, semantic now needs 13
   * — so WITHOUT the four new templates this change would have made Edwin's
   * warning worse. That is the thing worth pinning. */
  const { pool, shortfalls } = blogPool('plumbing jobsite injuries', 25);
  const semantic = shortfalls.find(s => 'semantic' === s.type);

  assert.ok(pool.semantic.length >= 10,
    `the semantic bucket is still too small: ${pool.semantic.length}`);

  if (semantic) {
    assert.ok(semantic.needed - semantic.have <= 3,
      `the shortfall grew instead of shrinking: short ${semantic.needed - semantic.have}`);
  }
});

test('AND THE SHORTFALL IS MEASURED AGAINST THE MIX THAT WILL BE USED', () => {
  /* Checking a blog's buckets against the default mix would warn about a
   * bucket that is about to be given no slots at all. */
  assert.ok(!blogPool('plumbing jobsite injuries', 25).shortfalls.some(s => 'branded' === s.type),
    'a blog is warned that it is short of anchors it will never use');
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');
process.exit(failed === 0 ? 0 : 1);
