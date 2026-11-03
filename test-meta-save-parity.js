// test-meta-save-parity.js
//
// Every field the page meta box renders must have a line that saves it.
//
// WHY THIS FILE EXISTS — Edwin, 3 November. He generated a site, converted it
// to WordPress, imported the theme, cleared the review texts to make the
// reviews section disappear, pressed Update, and nothing changed. Edits to
// every other section saved normally.
//
// The reviews fields were rendered by ..._render_content_meta_box and read
// back by ..._render_reviews, and no line in ..._save_meta ever wrote them.
// Four fields — review_text_N, review_name_N, review_stars_N, note — existed
// on both ends of the round trip and were missing from the middle.
//
//     A FIELD THAT IS RENDERED AND READ BUT NEVER WRITTEN LOOKS EXACTLY LIKE
//     A FIELD THAT SAVES AND KEEPS BEING OVERRULED.
//
// That is the reason this is a PARITY test and not a reviews test. A test that
// only asserted "reviews save" would have been written the day the bug was
// found and would have said nothing about the next section type added. The
// meta box and the save handler are two hand-maintained lists of the same
// field names in one 36KB file, nine hundred lines apart, and nothing but a
// person's attention has ever kept them in step. The symptom when they drift
// is not an error — it is a form that displays the database and cannot change
// it, which reports success. There is no error message to go looking for.
//
// WHAT IT DOES NOT COVER, SAID PLAINLY. This reads the generated PHP as text.
// It proves a field name appears on the save side; it does not prove the
// branch is reachable, correctly keyed, or sanitised appropriately. A test
// that proved that would have to run PHP. This catches the absence, which is
// the failure that has actually happened.
//
//   node test-meta-save-parity.js

const assert = require('assert');
const { generateMetaBoxesPhp } = require('./utils/wpThemeBuilder/generators/metaBoxesPhp');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}\n`); }

/* ===================================================================== */

const PHP = generateMetaBoxesPhp({ themeSlug: 'local-business-theme' });

/**
 * The body of one top-level PHP function, by name suffix.
 *
 * BRACE COUNTING, NOT A REGEX TO THE NEXT `}`. These functions contain
 * closures, arrays and heredoc-ish `?> ... <?php` islands full of braces, and
 * the save handler is the LAST function but one in the file — a lazy match
 * would stop inside the first nested block and the test would pass by reading
 * almost nothing.
 */
function bodyOf(suffix) {
  const at = PHP.indexOf(`function local_business_theme_${suffix}(`);
  assert.ok(at >= 0, `no function ..._${suffix} in the generated PHP`);

  const open = PHP.indexOf('{', at);
  assert.ok(open > at, `..._${suffix} has no body`);

  let depth = 0;
  for (let i = open; i < PHP.length; i += 1) {
    if (PHP[i] === '{') depth += 1;
    else if (PHP[i] === '}') {
      depth -= 1;
      if (depth === 0) return PHP.slice(open, i + 1);
    }
  }

  throw new Error(`..._${suffix} is never closed`);
}

const RENDER = bodyOf('render_content_meta_box');
const SAVE = bodyOf('save_meta');

/**
 * Field names the meta box renders, as the save handler would have to spell
 * them.
 *
 * TWO SHAPES, because the generator writes both:
 *
 *   a whole name      _text_field( $post->ID, $key, 'heading', ... )
 *   a row prefix      _text_field( $post->ID, $key, 'review_text_' . $i, ... )
 *
 * A prefix is kept WITH its trailing underscore. That is the string the save
 * side builds its key from, so it is the string to look for — and keeping the
 * underscore is what stops 'p_' matching the word "post" somewhere in a
 * comment.
 *
 * IMAGES ARE NOT HERE, deliberately. They go through _image_field with the
 * role as a variable, so there is no literal to compare; the save handler
 * drives them off the same $s['image_roles'] array the renderer does, which
 * is one list, not two.
 */
function renderedFields(php) {
  const names = new Set();
  const call = /_(?:text|rich)_field\(\s*\$post->ID,\s*\$key,\s*'([^']+)'(\s*\.\s*\$i)?/g;

  let m;
  while ((m = call.exec(php)) !== null) names.add(m[1]);

  return [...names].sort();
}

const FIELDS = renderedFields(RENDER);

/* ===================================================================== */

section('The two lists are actually being read');

test('the meta box renders a believable number of fields', () => {
  /* A floor, not an exact count — adding a section type should not fail this
   * file, only adding one without a save path should. If this ever drops to
   * single digits the extractor has broken and every assertion below has
   * quietly stopped testing anything. */
  assert.ok(FIELDS.length >= 15,
    `only found ${FIELDS.length} rendered fields: ${FIELDS.join(', ')}`);
});

test('and the fields we know by name are among them', () => {
  for (const known of ['heading', 'subheading', 'note', 'notice', 'p_', 'trust_',
    'faq_q_', 'faq_a_', 'card_name_', 'price_name_', 'review_text_']) {
    assert.ok(FIELDS.includes(known), `extractor missed '${known}'`);
  }
});

test('the save handler was sliced, not the whole file', () => {
  assert.ok(SAVE.includes('update_post_meta'), 'no update_post_meta in the save body');
  assert.ok(!SAVE.includes('_render_content_meta_box'),
    'the slice ran past the end of the save handler');
  assert.ok(SAVE.length < PHP.length / 2, 'the slice is suspiciously large');
});

/* ===================================================================== */

section('Every rendered field has a save path');

test('no field is rendered that the save handler never writes', () => {
  const orphans = FIELDS.filter((f) => !SAVE.includes(`'${f}'`));

  assert.deepStrictEqual(orphans, [],
    `rendered in the meta box but never saved: ${orphans.join(', ')}\n`
    + '        A field in this list is a box the owner can type into that\n'
    + '        changes nothing, and reports success. Add a branch to\n'
    + '        ..._save_meta in utils/wpThemeBuilder/generators/metaBoxesPhp.js.');
});

/* ===================================================================== */

section('The reviews section specifically — the one that was broken');

test('all three review row fields are saved', () => {
  for (const f of ['review_text_', 'review_name_', 'review_stars_']) {
    assert.ok(SAVE.includes(`'${f}'`), `${f} is still not saved`);
  }
});

test('the rows are counted off review_count, as the renderer counts them', () => {
  /* The render side and the front end both loop to review_count. A save that
   * looped to a different bound would write some rows and not others, which
   * is the same bug with a smaller blast radius. */
  assert.ok(/review_count/.test(SAVE), 'the save handler never reads review_count');
});

test("'note' and 'notice' are both saved, one character apart", () => {
  /* The near-miss that most likely caused the original omission: pricing's
   * footnote is 'notice', reviews' intro is 'note'. Having one is not having
   * the other, and the file reads as though it does. */
  assert.ok(SAVE.includes("'notice'"), "pricing's 'notice' is not saved");
  assert.ok(SAVE.includes("'note'"), "reviews' 'note' is not saved");
});

test('an empty review text can reach the database', () => {
  /* CLEARING IS THE DELETE. ..._render_reviews returns early when every
   * review_text_N is empty, so '' has to be writable or the section cannot be
   * removed from wp-admin at all — which is exactly what Edwin hit. isset()
   * allows '', `! empty()` would not. */
  const block = SAVE.slice(SAVE.indexOf('review_count'));
  const upTo = block.slice(0, block.indexOf('faq_count') + 1 || block.length);

  assert.ok(/isset\(\s*\$_POST\[\s*\$review_key\s*\]\s*\)/.test(upTo),
    'the reviews save is not gated on isset()');
  assert.ok(!/!\s*empty\(\s*\$_POST\[\s*\$review_key/.test(upTo),
    'the reviews save uses ! empty(), so clearing a review cannot delete it');
});

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
