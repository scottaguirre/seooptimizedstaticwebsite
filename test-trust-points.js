// test-trust-points.js
//
// The ticked list under the About page's opening paragraph.
//
// WHAT THIS IS GUARDING
//
// The list rendered as "new patients welcome", "flexible appointment times" —
// four lower-case fragments in a row, which reads as an oversight rather than
// a style. The phrases are written lower case in businessShape.js on purpose:
// they are also handed to the model as raw material for prose, where "we
// offer flexible appointment times" has to sit inside a sentence.
//
// So the case belongs to the DISPLAY, and the fix has to hold in two places —
// the static About page and the WordPress theme model — because a rule applied
// to one of them means a customer's exported theme disagrees with the site it
// was exported from.
//
// THE RISK THIS FILE EXISTS FOR
//
// Capitalising the first character sounds like it cannot go wrong. It can, in
// three ways that all look fine on the one example anybody checks:
//
//   - "5-star rated by local customers" starts with a digit. A naive
//     toUpperCase on the first character leaves it alone, but a naive
//     "capitalise each word" would produce "5-Star Rated By Local Customers".
//   - "Visa, Mastercard and most major cards accepted" is already capitalised
//     and contains proper nouns. Anything that lower-cases the remainder
//     to "normalise" it would write "Visa, mastercard and..." .
//   - The model returns points of its own invention alongside ours. A rule
//     applied to the vocabulary rather than to the output would capitalise
//     some items in a list and not others.
//
//   node test-trust-points.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { displayTrustPoint, TRUST_POINTS } = require('./utils/businessShape');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}\n`); }

/* ===================================================================== */

section('A point starts with a capital');

test('the medical points Edwin saw are capitalised', () => {
  /* The exact four from the screenshot. */
  assert.strictEqual(displayTrustPoint('new patients welcome'), 'New patients welcome');
  assert.strictEqual(displayTrustPoint('flexible appointment times'), 'Flexible appointment times');
  assert.strictEqual(displayTrustPoint('clear treatment plans before you begin'),
    'Clear treatment plans before you begin');
  assert.strictEqual(displayTrustPoint('questions answered before you decide'),
    'Questions answered before you decide');
});

test('every point in the vocabulary comes out capitalised or unchanged', () => {
  /* Not one shape, all of them. A list with a single stray lower-case item is
   * exactly as noticeable as a list of them. */
  for (const [shape, set] of Object.entries(TRUST_POINTS)) {
    const all = [...(set.always || []), ...(set.optIn || []).map(c => c.label)];
    for (const label of all) {
      const out = displayTrustPoint(label);
      assert.ok(/^[^a-z]/.test(out),
        `${shape}: "${label}" still displays as "${out}"`);
    }
  }
});

/* ===================================================================== */

section('What must NOT be touched');

test('a point starting with a digit is left alone', () => {
  assert.strictEqual(displayTrustPoint('5-star rated by local customers'),
    '5-star rated by local customers');
  assert.strictEqual(displayTrustPoint('24/7 availability'), '24/7 availability');
});

test('the rest of the phrase is never re-cased', () => {
  /* Title-casing or lower-casing the remainder are both one line away, and
   * both ruin a brand name. */
  assert.strictEqual(
    displayTrustPoint('Visa, Mastercard and most major cards accepted'),
    'Visa, Mastercard and most major cards accepted');
  assert.strictEqual(
    displayTrustPoint('licensed, insured and bonded'),
    'Licensed, insured and bonded',
    'only the first letter should change');
});

test('an already-capitalised point is unchanged', () => {
  assert.strictEqual(displayTrustPoint('Open 24 hours, 7 days a week'),
    'Open 24 hours, 7 days a week');
});

test('a point the model invented is treated the same as ours', () => {
  assert.strictEqual(displayTrustPoint('evening and weekend visits'),
    'Evening and weekend visits');
});

/* ===================================================================== */

section('Nothing is not something');

test('empty and missing values stay empty', () => {
  for (const nothing of ['', '   ', null, undefined]) {
    assert.strictEqual(displayTrustPoint(nothing), '',
      `${JSON.stringify(nothing)} produced a point`);
  }
});

test('surrounding whitespace goes', () => {
  /* It arrives from a model response. A leading space would defeat the
   * capitalisation and print an indented bullet. */
  assert.strictEqual(displayTrustPoint('  flexible scheduling  '), 'Flexible scheduling');
});

/* ===================================================================== */

section('Both renderers use the same rule');

test('the WordPress theme model capitalises its points', () => {
  /* The theme bakes these strings into post meta at export, so whatever is
   * written at that moment is what the site shows forever. An exported theme
   * that disagreed with the site it came from would be found by a customer,
   * not by us. */
  const { normaliseSection } = require('./utils/wpThemeBuilder/dataFiles/themeModel');
  if (typeof normaliseSection !== 'function') {
    // Not exported; fall back to reading the mapping.
    const src = fs.readFileSync(
      path.join(__dirname, 'utils', 'wpThemeBuilder', 'dataFiles', 'themeModel.js'), 'utf8');
    assert.match(src, /trust_points\s*=\s*section\.trustPoints\.map\(displayTrustPoint\)/,
      'the theme model no longer routes trust points through displayTrustPoint');
    return;
  }
  const out = normaliseSection({ trustPoints: ['new patients welcome'] });
  assert.deepStrictEqual(out.trust_points, ['New patients welcome']);
});

test('the static About page capitalises its points', () => {
  /* buildTrustList is not exported and the module cannot be loaded in
   * isolation, so this reads the one line that matters. A source check is a
   * weak test; it is here because the alternative is no test at all on the
   * renderer that produces the page in the screenshot. */
  const src = fs.readFileSync(path.join(__dirname, 'utils', 'buildAboutUsPage.js'), 'utf8');
  assert.match(src, /\.map\(displayTrustPoint\)/,
    'buildTrustList no longer routes points through displayTrustPoint');
  assert.match(src, /displayTrustPoint/,
    'buildAboutUsPage no longer imports displayTrustPoint');
});

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
