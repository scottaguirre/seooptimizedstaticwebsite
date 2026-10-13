// test-theme-header.js
//
// The first thing a customer reads about who built their site.
//
// WHAT THIS IS GUARDING
//
// Every exported theme carries a comment block at the top of style.css.
// WordPress parses it and shows it under Appearance → Themes: the theme's
// name, and "By <author>" beside the screenshot tile.
//
// That block said:
//
//     Author: Static Website Generator
//     Author URI: https://example.com/
//     Theme URI: https://example.com/
//
// A brand two renames out of date, and a dead placeholder link under it —
// shipped inside every theme this product has ever exported, sitting next to
// the Three Comets logo on the same screen.
//
// THE SHAPE OF THE BUG IS THE INTERESTING PART, and it is the second instance
// of it in two days. utils/pageTitle.js holds APP_NAME and says in its own
// comment that renaming the product "should be one edit, not a grep". THREE
// files hard-coded the author string anyway — the route, the builder, and the
// generator — none of them knowing about the others. utils/emailLayout.js did
// exactly the same thing with the same constant, and that one reached
// customers' inboxes for weeks.
//
// A single source of truth that callers are free to ignore is not one.
//
//   node test-theme-header.js

const assert = require('assert');
const fs = require('fs');

const { generateStyleCss } = require('./utils/wpThemeBuilder/generators/styleCss');
const { APP_NAME } = require('./utils/pageTitle');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(n) { console.log(`\n${n}\n`); }

/** Just the WordPress header block, which is all of this that WordPress reads. */
function header(opts = {}) {
  return generateStyleCss(opts).split('*/')[0];
}

/** Every name this product has traded under. */
const OLD_NAMES = ['Static Website Generator', 'Fast Website Generator', 'SEO Site Generator'];

section('Who built it');

test('the author is the product name', function () {
  assert.match(header(), new RegExp(`Author:\\s*${APP_NAME}`),
    'the theme does not say who built it, or says the wrong thing');
});

test('AND IT IS READ FROM pageTitle, NOT COPIED BESIDE IT', function () {
  /* The assertion above passes just as happily against a fourth hard-coded
   * 'Three Comets' — which is the same bug again, waiting for the next
   * rename. This is the one that insists on the wiring.
   *
   * Comments are stripped first: this project's files quote the old names
   * while explaining the bug, and a naive search matches those. Three
   * source-reading tests have produced false alarms here for exactly that
   * reason. */
  const strip = src => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  for (const file of [
    './utils/wpThemeBuilder/generators/styleCss.js',
    './utils/wpThemeBuilder/buildFromModel.js',
    './routes/exportWpThemeRoute.js',
  ]) {
    const src = strip(fs.readFileSync(require.resolve(file), 'utf8'));

    assert.ok(
      !src.includes(`'${APP_NAME}'`) && !src.includes(`"${APP_NAME}"`),
      `${file} hard-codes the product name again instead of importing APP_NAME`
    );

    /* AND NO OLD NAME EITHER — found by mutation.
     *
     * Everything above tests generateStyleCss() directly, so putting the old
     * brand back in the ROUTE, which overrides the generator's default,
     * survived the whole suite. That is precisely where it lived: the route
     * passed 'Static Website Generator' explicitly, and the generator's
     * default was never reached in production at all.
     *
     * Testing the function the caller bypasses is testing the wrong thing. */
    for (const old of OLD_NAMES) {
      assert.ok(
        !src.includes(old),
        `${file} still passes "${old}" — the generator's default is never reached`
      );
    }

    /* AND NO PLACEHOLDER LINK — found by the same mutation, one field over.
     *
     * Putting 'https://example.com/' back in the ROUTE also survived: the
     * generator stopped defaulting to it, and the caller handed it straight
     * back in. Both halves of this bug were in callers, not in the function
     * everyone would think to test. */
    assert.ok(
      !src.includes('example.com'),
      `${file} still ships a placeholder link to customers`
    );
  }
});

test('NO NAME THE PRODUCT USED TO HAVE SURVIVES', function () {
  const css = generateStyleCss({ themeName: 'Acme Plumbing Theme' });

  for (const old of OLD_NAMES) {
    assert.ok(!css.includes(old), `the theme still says "${old}"`);
  }
});

section('The dead placeholder links');

test('example.com is nowhere in a generated theme', function () {
  /* It was in two fields, in every theme ever exported. "Author URI" is a
   * link a customer can click to find out who made their site; pointing it at
   * the IETF's reserved example domain is worse than leaving it out. */
  assert.ok(!generateStyleCss({}).includes('example.com'),
    'a placeholder link is still being shipped to customers');
});

test('and the lines are OMITTED rather than left blank', function () {
  /* `Author URI:` with nothing after it is not better than example.com. It is
   * a field WordPress will render as an empty link. */
  const h = header();

  assert.ok(!/Author URI:/.test(h), 'an empty Author URI line is still printed');
  assert.ok(!/Theme URI:/.test(h), 'an empty Theme URI line is still printed');
});

test('but they appear when there is something true to say', function () {
  const h = header({ authorUri: 'https://threecomets.com', themeUri: 'https://threecomets.com/themes' });

  assert.match(h, /Author URI:\s*https:\/\/threecomets\.com/);
  assert.match(h, /Theme URI:\s*https:\/\/threecomets\.com\/themes/);
});

section('Still a theme WordPress will accept');

test('the header is the first thing in the file', function () {
  /* WordPress reads only the first 8KB of style.css and expects the block at
   * the top. A header pushed below anything else stops being found, and the
   * theme shows as "Broken Themes" with no name at all. */
  assert.ok(generateStyleCss({}).startsWith('/*'), 'style.css no longer opens with the header block');
});

test('Theme Name comes first inside it, and is the one passed in', function () {
  const lines = header({ themeName: 'Acme Plumbing Theme' })
    .split('\n').map(l => l.trim()).filter(Boolean);

  assert.strictEqual(lines[0], '/*');
  assert.strictEqual(lines[1], 'Theme Name: Acme Plumbing Theme');
});

test('the text domain follows the slug', function () {
  assert.match(header({ themeSlug: 'acme-plumbing-theme' }), /Text Domain:\s*acme-plumbing-theme/);
});

test('every header line is indented, as WordPress examples are', function () {
  /* Cosmetic, and the reason it is here: the block is now assembled from an
   * array rather than written out as one template literal, and losing the
   * indent is exactly the kind of thing that refactor does silently. */
  const body = header().split('\n').slice(1).filter(l => l.trim());

  for (const line of body) {
    assert.ok(/^ {2}\S/.test(line), `header line is not indented: ${JSON.stringify(line)}`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
