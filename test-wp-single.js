// test-wp-single.js
//
// What single.php actually renders for a blog post.
//
// THE BUG
//
// The theme had every part of a featured image except the one that draws it:
// functions.php declared `post-thumbnails` support and registered four hero
// sizes, the blog card grid rendered a thumbnail, and the BlogPosting schema
// published it as `image`. single.php went title, date, the_content(). So a
// customer could set a Featured Image, see it on the blog listing, click
// through, and get plain text.
//
// HOW THIS TESTS IT
//
// The generated single.php is real PHP, so it is run as real PHP against a
// stub of the WordPress functions it touches, twice: once with a featured
// image and once without. Asserting on the generator's source would prove a
// string was written, not that the branch is reached — and "the branch is
// never reached" is precisely the bug being fixed.
//
//   node test-wp-single.js        (needs php on PATH — skips cleanly without)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { generateSinglePhp } = require('./utils/wpThemeBuilder/generators/pageTemplatesPhp');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

/* -------------------------------------------------------------------------
 * Is there a PHP to run?
 * ---------------------------------------------------------------------- */

const phpCheck = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (phpCheck.error) {
  console.log('\ntest-wp-single: php is not on PATH — skipping.');
  console.log('This suite runs the generated template as real PHP. Matching');
  console.log('the generator source with a regex instead would pass whether');
  console.log('or not the image branch is ever reached.');
  process.exit(0);
}

const THEME_SLUG = 'local-business-theme';
const PREFIX = 'local_business_theme';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-single-'));
fs.writeFileSync(path.join(tmp, 'single.php'), generateSinglePhp({ themeSlug: THEME_SLUG }));

/* -------------------------------------------------------------------------
 * The stub
 *
 * Only the functions single.php calls, and only as much of each as the
 * template can tell apart.
 * ---------------------------------------------------------------------- */

const STUB = `<?php
function flag($k) { return !empty($GLOBALS['state'][$k]); }

function get_header() {}
function get_footer() {}

// One post, then stop.
function have_posts() {
  if (!isset($GLOBALS['served'])) { $GLOBALS['served'] = 0; }
  return $GLOBALS['served']++ < 1;
}
function the_post() {}
function get_the_ID() { return 7; }

function the_title() { echo 'A Post Title'; }
function get_the_date($f = '') { return $f === 'c' ? '2026-09-12T00:00:00+00:00' : 'September 12, 2026'; }
function the_content() { echo '<p>BODY-TEXT</p>'; }

function has_post_thumbnail() { return flag('has_thumb'); }
function the_post_thumbnail($size = '', $attr = array()) {
  // Echo the arguments rather than an <img>: the test needs to know which
  // size was asked for and what loading behaviour was requested, and a real
  // <img> would hide both.
  echo '<img data-size="' . $size . '"';
  foreach ($attr as $k => $v) { echo ' ' . $k . '="' . $v . '"'; }
  echo ' />';
}
function get_the_post_thumbnail_caption() {
  return isset($GLOBALS['state']['caption']) ? $GLOBALS['state']['caption'] : '';
}

function esc_html($s) { return htmlspecialchars($s, ENT_QUOTES); }
function esc_attr($s) { return htmlspecialchars($s, ENT_QUOTES); }
function esc_url($s)  { return $s; }
function esc_html_e($s, $d = '') { echo htmlspecialchars($s, ENT_QUOTES); }
function esc_html__($s, $d = '') { return $s; }

function ${PREFIX}_render_custom_sections($id) {}
`;

fs.writeFileSync(path.join(tmp, 'stub.php'), STUB);

/** Render single.php with a given state, return what it echoed. */
function render(state = {}) {
  const runner = path.join(tmp, 'run.php');
  fs.writeFileSync(runner, `<?php
$GLOBALS['state'] = json_decode('${JSON.stringify(state).replace(/'/g, "\\'")}', true) ?: array();
require __DIR__ . '/stub.php';
require __DIR__ . '/single.php';
`);
  return execFileSync('php', [runner], { encoding: 'utf8' });
}

console.log('\nsingle.php\n');

/* -------------------------------------------------------------------------
 * It is valid PHP at all
 * ---------------------------------------------------------------------- */

test('the generated template parses', () => {
  const lint = spawnSync('php', ['-l', path.join(tmp, 'single.php')], { encoding: 'utf8' });
  assert.strictEqual(lint.status, 0, lint.stdout + lint.stderr);
});

/* -------------------------------------------------------------------------
 * The image itself
 * ---------------------------------------------------------------------- */

test('a post WITH a featured image renders it', () => {
  const html = render({ has_thumb: true });
  assert.ok(/<img\b/.test(html), 'no image in the output — this is the original bug');
});

test('a post WITHOUT one renders no image and no empty figure', () => {
  const html = render({ has_thumb: false });
  assert.ok(!/<img\b/.test(html), 'rendered an image for a post that has none');
  assert.ok(!/<figure/.test(html), 'left an empty <figure> behind');
});

test('the image comes before the body text', () => {
  // Below the_content() it is not a hero, it is a footnote.
  const html = render({ has_thumb: true });
  assert.ok(html.indexOf('<img') < html.indexOf('BODY-TEXT'), 'image rendered after the content');
});

test('the image comes after the <h1>', () => {
  // The heading stays the first thing on the page; a full-width image above
  // it pushes the title below the fold on a phone.
  const html = render({ has_thumb: true });
  assert.ok(html.indexOf('</h1>') < html.indexOf('<img'), 'image rendered above the title');
});

test("it asks for the theme's registered hero size", () => {
  // functions.php registers this one at 1250x700. Falling back to 'full'
  // would ship the customer's original upload — often several megabytes.
  const html = render({ has_thumb: true });
  assert.ok(
    html.includes(`data-size="${PREFIX}-hero-desktop"`),
    `wrong size requested: ${(html.match(/data-size="[^"]*"/) || ['none'])[0]}`
  );
});

/* -------------------------------------------------------------------------
 * Loading behaviour
 * ---------------------------------------------------------------------- */

test('the hero is NOT lazy-loaded', () => {
  // WordPress lazy-loads thumbnails by default, so this has to be set
  // explicitly. The hero is the LCP element on a post page: lazy means the
  // browser finds it late and the metric measures the wait.
  const html = render({ has_thumb: true });
  assert.ok(!/loading="lazy"/.test(html), 'the hero is lazy-loaded');
  assert.ok(/loading="eager"/.test(html), 'loading="eager" is missing');
});

test('the hero declares fetchpriority high', () => {
  const html = render({ has_thumb: true });
  assert.ok(/fetchpriority="high"/.test(html), 'fetchpriority="high" is missing');
});

/* -------------------------------------------------------------------------
 * Alt text and captions
 * ---------------------------------------------------------------------- */

test('no alt is forced onto the image', () => {
  // the_post_thumbnail() uses the attachment's own alt text. Passing the post
  // title instead would make every hero announce the heading printed directly
  // above it, which is worse than silence.
  const html = render({ has_thumb: true });
  assert.ok(!/\balt="/.test(html), 'an alt attribute was passed, overriding the media library');
});

test('a caption is rendered when the attachment has one', () => {
  const html = render({ has_thumb: true, caption: 'Outside the Leander store' });
  assert.ok(/<figcaption/.test(html), 'no figcaption');
  assert.ok(html.includes('Outside the Leander store'), 'caption text missing');
});

test('no empty figcaption when the attachment has no caption', () => {
  const html = render({ has_thumb: true });
  assert.ok(!/<figcaption/.test(html), 'rendered an empty figcaption');
});

test('a caption carrying markup is escaped', () => {
  const html = render({ has_thumb: true, caption: '<script>x</script>' });
  assert.ok(!/<script>/.test(html), 'caption was not escaped');
});

/* -------------------------------------------------------------------------
 * The rest of the template still works
 * ---------------------------------------------------------------------- */

test('the post body still renders either way', () => {
  assert.ok(render({ has_thumb: true }).includes('BODY-TEXT'), 'body missing with an image');
  assert.ok(render({ has_thumb: false }).includes('BODY-TEXT'), 'body missing without one');
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
