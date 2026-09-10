// test-wp-canonical.js
//
// What the exported theme puts in <head> on the URLs WordPress invents.
//
// THE BUG
//
// Search Console reported "Duplicate without user-selected canonical". That
// label means the page was found duplicative AND declared no canonical at all
// — not "declared one Google disagreed with", which is a different report.
//
// The theme calls wp_head(), so core's rel_canonical() runs. Core's function
// opens `if ( ! is_singular() ) return;`, so pages and posts get a canonical
// and every archive gets nothing: categories, tags, author, date, the posts
// index, and page 2..n of each. All showing the same excerpts as each other.
//
// HOW THIS TESTS IT
//
// The generated functions.php is real PHP, so it is run as real PHP against a
// stub of the twelve WordPress functions it touches. Each case sets which
// is_*() predicates are true, fires the wp_head actions, and reads what was
// echoed. Asserting on the generator's SOURCE would only prove a string was
// written; this proves the branch is reached.
//
//   node test-wp-canonical.js        (needs php on PATH — skips cleanly without)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const { generateFunctionsPhp } = require('./utils/wpThemeBuilder/generators/functionsPhp');

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
  console.log('\ntest-wp-canonical: php is not on PATH — skipping.');
  console.log('This suite runs the generated theme as real PHP; there is no');
  console.log('point asserting on the generator source instead, because that');
  console.log('would pass whether or not the branch is ever reached.');
  process.exit(0);
}

const THEME_SLUG = 'local-business-theme';
const PREFIX = 'local_business_theme';
const functionsPhp = generateFunctionsPhp({ themeSlug: THEME_SLUG });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-canonical-'));
fs.writeFileSync(path.join(tmp, 'functions.php'), functionsPhp);

// functions.php require_once's seven sibling files. They are generated
// separately and none of them touches wp_head, so they are stubbed empty here
// rather than generated — this suite is about what reaches <head>, and pulling
// in 200KB of meta boxes and section renderers to find out would make every
// failure in those files look like a canonical failure.
//
// Read from the generated source rather than hard-coded, so adding an include
// does not silently break this harness.
const INC_DIR = path.join(tmp, 'inc');
fs.mkdirSync(INC_DIR, { recursive: true });

const includes = [...functionsPhp.matchAll(/get_template_directory\(\)\s*\.\s*'\/inc\/([\w-]+\.php)'/g)]
  .map(m => m[1]);

assert.ok(includes.length, 'no includes found — has the require block changed shape?');
for (const file of includes) {
  fs.writeFileSync(path.join(INC_DIR, file), '<?php // stubbed for test-wp-canonical.js\n');
}

/* -------------------------------------------------------------------------
 * The stub
 *
 * Only what functions.php actually calls. Anything it calls that is NOT here
 * raises a PHP fatal, which is the point — a silent no-op stub would let a
 * typo'd function name pass.
 * ---------------------------------------------------------------------- */

const HARNESS = `<?php
$GLOBALS['state']   = json_decode($argv[1], true);
$GLOBALS['actions'] = array();
$GLOBALS['echoed']  = '';
$GLOBALS['redirect'] = null;

function flag($name) { return !empty($GLOBALS['state'][$name]); }

function is_singular($t = '')        { return flag('is_singular'); }
function is_home()                   { return flag('is_home'); }
function is_front_page()             { return flag('is_front_page'); }
function is_category($t = '')        { return flag('is_category'); }
function is_tag($t = '')             { return flag('is_tag'); }
function is_tax($t = '', $x = '')    { return flag('is_tax'); }
function is_author($a = '')          { return flag('is_author'); }
function is_date()                   { return flag('is_date'); }
function is_attachment($a = '')      { return flag('is_attachment'); }
function is_post_type_archive($t='') { return flag('is_post_type_archive'); }
function is_search()                 { return flag('is_search'); }
function is_404()                    { return flag('is_404'); }

function get_query_var($k, $d = '') {
  return isset($GLOBALS['state'][$k]) ? $GLOBALS['state'][$k] : $d;
}

// Mirrors the real one closely enough to matter: it returns the CURRENT url
// for the given page number, query string and all, which is why the code under
// test has to strip the query itself.
function get_pagenum_link($n = 1, $escape = true) {
  $base = isset($GLOBALS['state']['base_url'])
    ? $GLOBALS['state']['base_url'] : 'https://example.com/category/news/';
  $url = ($n > 1) ? rtrim($base, '/') . '/page/' . (int) $n . '/' : $base;
  if (!empty($GLOBALS['state']['query_string'])) {
    $url .= '?' . $GLOBALS['state']['query_string'];
  }
  return $url;
}

function home_url($p = '/')          { return 'https://example.com' . $p; }
function get_permalink($id = 0)      { return 'https://example.com/parent-post/'; }
function esc_url($u)                 { return $u; }
function esc_attr($s)                { return htmlspecialchars((string) $s, ENT_QUOTES); }
function wp_strip_all_tags($s)       { return strip_tags((string) $s); }
function wp_trim_words($s, $n = 55, $m = '') { return $s; }

function get_queried_object_id()     { return isset($GLOBALS['state']['post_id']) ? $GLOBALS['state']['post_id'] : 0; }
function get_queried_object() {
  $o = new stdClass();
  $o->post_parent = isset($GLOBALS['state']['post_parent']) ? $GLOBALS['state']['post_parent'] : 0;
  return $o;
}
function get_post_meta($id, $key, $single = false) {
  $meta = isset($GLOBALS['state']['meta']) ? $GLOBALS['state']['meta'] : array();
  return isset($meta[$key]) ? $meta[$key] : '';
}
function get_post_type($id = 0)      { return isset($GLOBALS['state']['post_type']) ? $GLOBALS['state']['post_type'] : 'page'; }
function get_the_excerpt($id = 0)    { return ''; }
function get_bloginfo($what = '')    { return 'A tagline'; }
function get_option($k, $d = false)  { return $d; }
function update_option($k, $v)       { return true; }
function wp_clear_scheduled_hook($h) { return true; }

function wp_safe_redirect($url, $status = 302) {
  $GLOBALS['redirect'] = array('url' => $url, 'status' => $status);
  // The real one does not exit; the caller does. Throwing models that exit
  // without killing the harness, so the assertions can still read the result.
  throw new Exception('__redirected__');
}

function add_action($hook, $fn, $priority = 10, $args = 1) {
  $GLOBALS['actions'][$hook][] = array('fn' => $fn, 'priority' => $priority);
}
function add_filter($hook, $fn, $priority = 10, $args = 1) {}
function add_theme_support() {}
function add_image_size() {}
function register_nav_menus() {}
function load_theme_textdomain() {}
function get_template_directory_uri() { return 'https://example.com/wp-content/themes/t'; }
function get_template_directory()     { return __DIR__; }
function wp_enqueue_style() {}
function wp_enqueue_script() {}
function wp_get_theme() { $o = new stdClass(); $o->Version = '1.0.0'; return $o; }
function wp_localize_script() {}
function wp_create_nonce($a = '')     { return 'nonce'; }
function admin_url($p = '')           { return 'https://example.com/wp-admin/' . $p; }
function register_post_type() {}
function register_taxonomy() {}
function flush_rewrite_rules() {}
function add_meta_box() {}
function wp_nonce_field() {}
function current_user_can($c)         { return true; }
function sanitize_text_field($s)      { return $s; }
function sanitize_textarea_field($s)  { return $s; }
function wp_kses_post($s)             { return $s; }
function update_post_meta() {}
function delete_post_meta() {}
function wp_verify_nonce()            { return true; }
function get_posts()                  { return array(); }
function get_pages()                  { return array(); }
function wp_mail()                    { return true; }
function is_admin()                   { return false; }
function wp_doing_ajax()              { return false; }
function did_action($h)               { return 0; }
function do_action($h)                {}
function apply_filters($h, $v)        { return $v; }
function esc_html($s)                 { return $s; }
function esc_html__($s, $d = '')      { return $s; }
function __($s, $d = '')              { return $s; }
function _e($s, $d = '')              { echo $s; }
function absint($n)                   { return abs((int) $n); }
function wp_json_encode($v)           { return json_encode($v); }
function set_transient() {}
function get_transient()              { return false; }
function delete_transient() {}
function wp_next_scheduled($h)        { return false; }
function wp_schedule_event() {}
function plugin_dir_path($f = '')     { return __DIR__ . '/'; }
function trailingslashit($s)          { return rtrim($s, '/') . '/'; }
function untrailingslashit($s)        { return rtrim($s, '/'); }
function get_stylesheet_directory()   { return __DIR__; }
function get_stylesheet_directory_uri() { return 'https://example.com/t'; }

if (!defined('ABSPATH')) define('ABSPATH', __DIR__ . '/');

require __DIR__ . '/functions.php';

// Fire one hook, lowest priority first, and capture everything echoed.
function fire($hook) {
  $list = isset($GLOBALS['actions'][$hook]) ? $GLOBALS['actions'][$hook] : array();
  usort($list, function ($a, $b) { return $a['priority'] <=> $b['priority']; });

  ob_start();
  foreach ($list as $entry) {
    if (!is_string($entry['fn']) || !function_exists($entry['fn'])) continue;
    try { call_user_func($entry['fn']); }
    catch (Exception $e) { if ($e->getMessage() !== '__redirected__') throw $e; }
  }
  return ob_get_clean();
}

$head = fire('wp_head');
$tr   = fire('template_redirect');

echo json_encode(array(
  'head'     => $head,
  'redirect' => $GLOBALS['redirect'],
  'hooks'    => array_keys($GLOBALS['actions']),
));
`;

fs.writeFileSync(path.join(tmp, 'harness.php'), HARNESS);

/** Run one simulated request. @returns {{head: string, redirect: object|null}} */
function render(state) {
  const out = execFileSync('php', [path.join(tmp, 'harness.php'), JSON.stringify(state)], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(out);
}

const canonicalOf = head => {
  const m = head.match(/<link rel="canonical" href="([^"]*)">/);
  return m ? m[1] : null;
};
const robotsOf = head => {
  const m = head.match(/<meta name="robots" content="([^"]*)">/);
  return m ? m[1] : null;
};

/* ===================================================================== */

console.log('\nThe harness itself');

test('the generated theme is valid PHP', () => {
  const lint = spawnSync('php', ['-l', path.join(tmp, 'functions.php')], { encoding: 'utf8' });
  assert.strictEqual(lint.status, 0, lint.stdout + lint.stderr);
});

test('the new hooks are actually registered', () => {
  const { hooks } = render({ is_singular: true, post_id: 1 });
  assert.ok(hooks.includes('wp_head'), 'nothing hooks wp_head');
  assert.ok(hooks.includes('template_redirect'), 'the attachment redirect is not registered');
});

console.log('\nArchives now declare a canonical');

const ARCHIVES = [
  ['a category archive', { is_category: true }],
  ['a tag archive', { is_tag: true }],
  ['a custom taxonomy archive', { is_tax: true }],
  ['the posts index', { is_home: true }],
  ['an author archive', { is_author: true }],
  ['a date archive', { is_date: true }],
  ['a post type archive', { is_post_type_archive: true }],
];

for (const [name, state] of ARCHIVES) {
  test(`${name} gets one`, () => {
    const { head } = render({ ...state, base_url: 'https://example.com/archive/' });
    assert.strictEqual(canonicalOf(head), 'https://example.com/archive/',
      `no canonical on ${name} — this is the Search Console bug`);
  });
}

test('exactly one canonical is emitted, never two', () => {
  const { head } = render({ is_category: true, base_url: 'https://example.com/c/' });
  assert.strictEqual((head.match(/rel="canonical"/g) || []).length, 1);
});

console.log('\nWhat must NOT get one');

test('a singular page is left to WordPress core', () => {
  // Core's rel_canonical handles these. A second tag would give the crawler
  // two conflicting instructions on one page.
  const { head } = render({ is_singular: true, post_id: 12 });
  assert.strictEqual(canonicalOf(head), null, 'the theme is competing with core');
});

test('the is_singular guard is load-bearing, not decorative', () => {
  // The case above passes with the guard deleted, because a singular request
  // also fails every branch of the if/elseif chain and falls through to the
  // final return. So it proves the OUTCOME but not the GUARD, and a mutation
  // that removed the guard went undetected.
  //
  // This state — singular AND is_home — is not one WordPress produces. It is
  // the shape a future edit would create by adding a branch that overlaps with
  // singular, which is exactly what the guard is there to survive. If someone
  // deletes the guard on the grounds that it looks redundant, this fails.
  const { head } = render({ is_singular: true, is_home: true, post_id: 12 });
  assert.strictEqual(canonicalOf(head), null,
    'the is_singular() guard was removed — a singular page can now emit a second canonical');
});

test('a search results page declares nothing', () => {
  // Search URLs are unbounded — anyone can mint one by typing.
  const { head } = render({ is_search: true });
  assert.strictEqual(canonicalOf(head), null);
  assert.ok(/noindex/.test(robotsOf(head) || ''), 'search results are indexable');
});

test('a 404 declares nothing', () => {
  const { head } = render({ is_404: true });
  assert.strictEqual(canonicalOf(head), null);
  assert.ok(/noindex/.test(robotsOf(head) || ''));
});

console.log('\nPagination');

test('page 2 canonicalises to page 2, not to page 1', () => {
  // Pointing every paginated page at page 1 is the usual mistake and it is
  // worse than doing nothing: Google then treats 2..n as duplicates of 1 and
  // drops them, taking the only crawl path to the older posts with them.
  const { head } = render({
    is_category: true, paged: 2, base_url: 'https://example.com/category/news/',
  });
  assert.strictEqual(canonicalOf(head), 'https://example.com/category/news/page/2/');
});

test('page 1 has no /page/1/ in its canonical', () => {
  const { head } = render({
    is_category: true, paged: 1, base_url: 'https://example.com/category/news/',
  });
  assert.strictEqual(canonicalOf(head), 'https://example.com/category/news/');
});

test('a tracking parameter does not become part of the canonical', () => {
  // get_pagenum_link() carries the request's query string through, so
  // /category/news/?utm_source=facebook would otherwise canonicalise to itself
  // and split the page in two.
  const { head } = render({
    is_category: true, paged: 2,
    base_url: 'https://example.com/category/news/',
    query_string: 'utm_source=facebook',
  });
  assert.strictEqual(canonicalOf(head), 'https://example.com/category/news/page/2/');
});

console.log('\nThe archives WordPress invents');

test('author and date archives are noindexed', () => {
  // A one-author site's author archive is a copy of the blog index, and it
  // publishes the login name of an account that can edit the site.
  for (const state of [{ is_author: true }, { is_date: true }]) {
    const robots = robotsOf(render(state).head);
    assert.ok(robots && /noindex/.test(robots), JSON.stringify(state));
    assert.ok(/follow/.test(robots), 'the links out are a crawl path worth keeping');
  }
});

test('category and tag archives stay indexable', () => {
  // They group posts by something a visitor might search for. With a canonical
  // they are legitimate pages, and noindexing them would be overcorrecting.
  for (const state of [{ is_category: true }, { is_tag: true }]) {
    assert.strictEqual(robotsOf(render(state).head), null, JSON.stringify(state));
  }
});

test('a noindexed archive still declares its canonical', () => {
  // noindex and canonical answer different questions. Dropping the canonical
  // here would put the page straight back in the bucket this fixes.
  const { head } = render({ is_author: true, base_url: 'https://example.com/author/admin/' });
  assert.strictEqual(canonicalOf(head), 'https://example.com/author/admin/');
  assert.ok(/noindex/.test(robotsOf(head)));
});

console.log('\nAttachment pages');

test('an attachment redirects to its parent post, permanently', () => {
  const { redirect } = render({ is_attachment: true, post_parent: 7 });
  assert.ok(redirect, 'attachment pages are still being served');
  assert.strictEqual(redirect.url, 'https://example.com/parent-post/');
  assert.strictEqual(redirect.status, 301, '302 parks the link value instead of passing it');
});

test('a parentless attachment falls back to the home page', () => {
  // An image uploaded through the media library rather than into a post.
  const { redirect } = render({ is_attachment: true, post_parent: 0 });
  assert.strictEqual(redirect.url, 'https://example.com/');
  assert.strictEqual(redirect.status, 301);
});

test('an attachment is noindexed as well as redirected', () => {
  // Belt and braces: the redirect runs on template_redirect, which a caching
  // layer or another plugin can short-circuit.
  const { head } = render({ is_attachment: true, post_parent: 7 });
  assert.ok(/noindex/.test(robotsOf(head) || ''));
});

console.log('\nThe legal pages still behave as they did');

test('a legal page is noindexed, and nothing else is', () => {
  const legal = render({ is_singular: true, post_id: 3, meta: { [`${PREFIX}_page_type`]: 'legal' } });
  assert.ok(/noindex/.test(robotsOf(legal.head) || ''), 'the existing rule broke');

  const service = render({ is_singular: true, post_id: 4, meta: {} });
  assert.strictEqual(robotsOf(service.head), null, 'a service page became noindexed');
});

console.log('\nThe static build refuses a domain it cannot canonicalise');

const { siteBaseUrl } = require('./utils/buildSitemap');

test('siteBaseUrl rejects what would produce empty canonicals', () => {
  // Every one of these produces canonicalTag() === '', a skipped sitemap and
  // no .htaccess — three console warnings and a site with no canonical tags
  // anywhere, reported as a successful build.
  for (const bad of ['', '   ', 'qualityplumberleander', 'not a domain', 'https://', '.com']) {
    assert.strictEqual(siteBaseUrl(bad), '', `"${bad}" was accepted`);
  }
});

test('siteBaseUrl accepts what it should', () => {
  assert.strictEqual(siteBaseUrl('example.com'), 'https://example.com');
  assert.strictEqual(siteBaseUrl('www.example.com'), 'https://www.example.com');
});

test('runGeneration refuses to build rather than shipping a site with no canonicals', () => {
  const src = fs.readFileSync(path.join(__dirname, 'utils', 'runGeneration.js'), 'utf8');

  assert.ok(/if \(!siteBaseUrl\(globalValues\.domain\)\) \{[\s\S]{0,400}?throw new Error/.test(src),
    'a bad domain still produces a "successful" build with no canonical tags');

  // The message has to tell the customer what to type, not just that it failed.
  const message = src.slice(src.indexOf('if (!siteBaseUrl('), src.indexOf('if (!siteBaseUrl(') + 900);
  assert.ok(/example\.com/.test(message), 'the error does not show the expected format');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
