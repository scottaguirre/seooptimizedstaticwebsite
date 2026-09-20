// test-ie-topics.js
//
// Reading the campaign form's topics — the textarea, the table, and the
// per-article videos.
//
// WHY THIS EXISTS
//
// The Video column was added to the topics table and was unreachable for
// anyone who typed their own topics, because the table only ever appeared
// after pressing Suggest. The fix ("Review these topics") routes both paths
// through one reader, and these tests are what stop them drifting apart
// again: the same collect_topics() must handle a textarea of bare lines and
// a table of edited rows.
//
// The video map is the part with teeth. It is keyed by TOPIC TEXT rather than
// row number, and it is the last place a hostile URL can be stopped before it
// is stored in a WordPress option.
//
//   node test-ie-topics.js        (needs php on PATH — skips cleanly without)

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

if (spawnSync('php', ['-v'], { encoding: 'utf8' }).error) {
  console.log('\ntest-ie-topics: php is not on PATH — skipping.');
  process.exit(0);
}

const ADMIN = path.join(__dirname, 'wp-plugin', 'interlink-engine', 'includes', 'class-ie-admin.php');

const STUB = `<?php
define('ABSPATH', '/tmp/');
define('DAY_IN_SECONDS', 86400);

function sanitize_text_field($s) { return trim(strip_tags((string) $s)); }
function sanitize_textarea_field($s) { return trim(strip_tags((string) $s)); }
function wp_unslash($s) { return is_array($s) ? array_map('stripslashes', $s) : stripslashes((string) $s); }
function esc_url_raw($u) {
  $u = trim((string) $u);
  return preg_match('#^https?://#i', $u) ? $u : '';
}
function esc_url($u) { return esc_url_raw($u); }
function esc_attr($s) { return htmlspecialchars((string) $s, ENT_QUOTES); }
function esc_html($s) { return htmlspecialchars((string) $s, ENT_QUOTES); }
function esc_attr_e($s, $d = '') { echo esc_attr($s); }
function esc_html_e($s, $d = '') { echo esc_html($s); }
function esc_html__($s, $d = '') { return $s; }
function __($s, $d = '') { return $s; }
function _n($a, $b, $n, $d = '') { return 1 === (int) $n ? $a : $b; }
function add_action() {}
function checked() {}
function number_format_i18n($n) { return $n; }
function wp_timezone_string() { return 'UTC'; }
function admin_url($p = '') { return 'https://example.com/wp-admin/' . $p; }
function wp_nonce_url($u, $a = '') { return $u; }
function wp_nonce_field() {}
function current_user_can($c) { return true; }
function get_current_user_id() { return 1; }
function get_transient($k) { return isset($GLOBALS['transients'][$k]) ? $GLOBALS['transients'][$k] : false; }
function set_transient($k, $v, $t = 0) { $GLOBALS['transients'][$k] = $v; return true; }
function delete_transient($k) { unset($GLOBALS['transients'][$k]); return true; }
function wp_list_pluck($a, $f) { return array_map(function ($r) use ($f) { return isset($r[$f]) ? $r[$f] : null; }, $a); }
function get_post($id) { return null; }
function get_the_title($p = 0) { return 'Page'; }
function get_permalink($p = 0) { return 'https://example.com/page/'; }
function wp_safe_redirect($u) {}
function add_query_arg() { return ''; }
function wp_die($m = '') { throw new Exception($m); }
function check_admin_referer($a = '') { return true; }

class WP_Error { public function get_error_message() { return ''; } }
function is_wp_error($t) { return $t instanceof WP_Error; }
class IE_Settings {
  public static function target_pages() { return array(); }
  public static function get($k, $d = null) { return $d; }
  public static function business() { return array('name'=>'Acme','trade'=>'plumber','town'=>'Leander, TX','phone'=>''); }
}
class IE_Campaigns { public static function all() { return array(); } }
class IE_Publisher { public static function log($m) {} }
class IE_Api {}

require '${ADMIN}';

/** Reach a private static, which is where the parsing lives. */
function call_private($method, $args = array()) {
  $m = new ReflectionMethod('IE_Admin', $method);
  $m->setAccessible(true);
  return $m->invokeArgs(null, $args);
}

function out($v) { echo json_encode($v); }
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-topics-'));
fs.writeFileSync(path.join(tmp, 'stub.php'), STUB);

function run(body) {
  const file = path.join(tmp, 'case.php');
  fs.writeFileSync(file, `<?php\nrequire __DIR__ . '/stub.php';\n${body}\n`);
  const raw = execFileSync('php', [file], { encoding: 'utf8' });
  try { return JSON.parse(raw); }
  catch (e) { throw new Error(`PHP did not return JSON:\n${raw}`); }
}

const post = obj => `$_POST = ${php(obj)};`;
function php(v) {
  if (Array.isArray(v)) return 'array(' + v.map(php).join(',') + ')';
  if (v && typeof v === 'object') {
    return 'array(' + Object.entries(v).map(([k, x]) => `${JSON.stringify(String(k))}=>${php(x)}`).join(',') + ')';
  }
  return JSON.stringify(v);
}

console.log('\nCampaign topics\n');

/* --- the textarea path --------------------------------------------------- */

test('bare lines become topics', () => {
  const r = run(`${post({ topics: 'Slab leaks\nWater heaters\n' })}
    out(call_private('collect_topics'));`);
  assert.deepStrictEqual(r.map(t => t.topic), ['Slab leaks', 'Water heaters']);
});

test('blank lines are dropped', () => {
  const r = run(`${post({ topics: 'One\n\n  \nTwo\n' })}
    out(call_private('collect_topics'));`);
  assert.strictEqual(r.length, 2);
});

test('typed topics start with empty query and link phrase', () => {
  // They are filled in on the table afterwards. The point of the review step
  // is that there IS an afterwards.
  const r = run(`${post({ topics: 'One' })}
    out(call_private('collect_topics'));`);
  assert.strictEqual(r[0].targetQuery, '');
  assert.strictEqual(r[0].linkPhrase, '');
});

/* --- the table path ------------------------------------------------------ */

test('table rows are read with their query and link phrase', () => {
  const r = run(`${post({
    use: { 0: '1', 1: '1' },
    topic: { 0: 'Slab leaks', 1: 'Water heaters' },
    target_query: { 0: 'slab leak signs', 1: 'water heater noise' },
    link_phrase: { 0: 'finding a slab leak', 1: 'a noisy heater' },
  })}
    out(call_private('collect_topics'));`);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].targetQuery, 'slab leak signs');
  assert.strictEqual(r[1].linkPhrase, 'a noisy heater');
});

test('unticked rows are left out', () => {
  const r = run(`${post({
    use: { 0: '1' },
    topic: { 0: 'Kept', 1: 'Dropped' },
  })}
    out(call_private('collect_topics'));`);
  assert.deepStrictEqual(r.map(t => t.topic), ['Kept']);
});

test('the table wins when both are posted', () => {
  // The table is on screen; the textarea is not. Reading both would duplicate
  // every topic.
  const r = run(`${post({
    use: { 0: '1' },
    topic: { 0: 'FromTable' },
    topics: 'FromTextarea',
  })}
    out(call_private('collect_topics'));`);
  assert.deepStrictEqual(r.map(t => t.topic), ['FromTable']);
});

/* --- the video map ------------------------------------------------------- */

test('videos are keyed by topic text, lowercased', () => {
  const r = run(`${post({
    use: { 0: '1' },
    topic: { 0: 'Slab Leaks' },
    video: { 0: 'https://youtu.be/SLAB' },
  })}
    out(call_private('collect_topic_videos'));`);
  assert.deepStrictEqual(r, { 'slab leaks': 'https://youtu.be/SLAB' });
});

test('a row with no video contributes nothing', () => {
  // Absent, not ''. The publisher reads a missing key as "fall back to the
  // campaign video", and an empty string stored per slot means the same —
  // but a map full of empties is noise in the option.
  const r = run(`${post({
    use: { 0: '1', 1: '1' },
    topic: { 0: 'A', 1: 'B' },
    video: { 0: '', 1: 'https://youtu.be/B' },
  })}
    out(call_private('collect_topic_videos'));`);
  assert.deepStrictEqual(r, { b: 'https://youtu.be/B' });
});

test('an unticked row contributes no video', () => {
  const r = run(`${post({
    use: { 1: '1' },
    topic: { 0: 'Dropped', 1: 'Kept' },
    video: { 0: 'https://youtu.be/DROPPED', 1: 'https://youtu.be/KEPT' },
  })}
    out(call_private('collect_topic_videos'));`);
  assert.deepStrictEqual(r, { kept: 'https://youtu.be/KEPT' });
});

test('a javascript: url never enters the map', () => {
  // This value is about to be written into a WordPress option and read back
  // at publish time. It is the last chance to stop it.
  const r = run(`${post({
    use: { 0: '1' },
    topic: { 0: 'A' },
    video: { 0: 'javascript:alert(1)' },
  })}
    out(call_private('collect_topic_videos'));`);
  // An empty PHP array encodes as [], not {} — so assert emptiness rather
  // than deep-equality with an object literal.
  assert.strictEqual(Object.keys(r).length, 0, `map was not empty: ${JSON.stringify(r)}`);
});

test('a data: url never enters the map', () => {
  const r = run(`${post({
    use: { 0: '1' }, topic: { 0: 'A' }, video: { 0: 'data:text/html,x' },
  })}
    out(call_private('collect_topic_videos'));`);
  assert.strictEqual(Object.keys(r).length, 0, `map was not empty: ${JSON.stringify(r)}`);
});

test('surrounding whitespace is trimmed off a url', () => {
  const r = run(`${post({
    use: { 0: '1' }, topic: { 0: 'A' }, video: { 0: '  https://youtu.be/X  ' },
  })}
    out(call_private('collect_topic_videos'));`);
  assert.deepStrictEqual(r, { a: 'https://youtu.be/X' });
});

test('videos and topics agree on which rows are in', () => {
  // The two readers are separate functions over the same $_POST. If they ever
  // disagree about ticks, a video attaches to a topic that was dropped.
  const r = run(`${post({
    use: { 0: '1', 2: '1' },
    topic: { 0: 'A', 1: 'B', 2: 'C' },
    video: { 0: 'https://youtu.be/A', 1: 'https://youtu.be/B', 2: 'https://youtu.be/C' },
  })}
    out(array(
      'topics' => array_column(call_private('collect_topics'), 'topic'),
      'videos' => array_keys(call_private('collect_topic_videos'))
    ));`);
  assert.deepStrictEqual(r.topics, ['A', 'C']);
  assert.deepStrictEqual(r.videos, ['a', 'c']);
});

/* --- the search term, derived from the page title ------------------------- */

const kw = (title, town = 'Leander, TX') =>
  run(`out(IE_Admin::keyword_from_title(${JSON.stringify(title)}, ${JSON.stringify(town)}));`);

test('a plain service title passes through, lower-cased', () => {
  assert.strictEqual(kw('Residential Plumbing Services'), 'residential plumbing services');
});

test('the town and state are stripped', () => {
  // anchorPool.js adds these back from the business settings. Left in, they
  // produce "…services Leander, TX in Leander".
  assert.strictEqual(kw('Residential Plumbing Services in Leander, TX'), 'residential plumbing services');
  assert.strictEqual(kw('Residential Plumbing Services Leander, TX'), 'residential plumbing services');
  assert.strictEqual(kw('Residential Plumbing Services, Leander'), 'residential plumbing services');
});

test('a brand suffix is stripped', () => {
  // Otherwise the company name ends up inside every exact-match anchor.
  assert.strictEqual(kw('Water Heater Repair | Acme Plumbing'), 'water heater repair');
  assert.strictEqual(kw('Water Heater Repair - Acme Plumbing'), 'water heater repair');
  assert.strictEqual(kw('Water Heater Repair – Acme Plumbing'), 'water heater repair');
});

test('a hyphen inside a word is NOT a separator', () => {
  // "Whole-Home" and "24-Hour" are part of the phrase. Splitting on a bare
  // hyphen would amputate them.
  assert.strictEqual(kw('Whole-Home Repiping'), 'whole-home repiping');
  assert.strictEqual(kw('24-Hour Emergency Plumbing'), '24-hour emergency plumbing');
});

test('the state is stripped when the town setting has no state', () => {
  // The case the other tests masked. With town = "Leander, TX" the town pass
  // cleans the state up as a side effect; with town = "Leander" it cannot,
  // because "TX" sits between the town and the end of the string. This is
  // what makes the state strip load-bearing — and it has to run FIRST.
  assert.strictEqual(
    kw('Residential Plumbing Services in Leander, TX', 'Leander'),
    'residential plumbing services'
  );
});

test('a town inside the service name survives', () => {
  // Only a TRAILING town is stripped. This is the case that would silently
  // mangle a legitimate name.
  assert.strictEqual(kw('Leander Road Drain Clearing', 'Leander'), 'leander road drain clearing');
});

test('no town configured is handled', () => {
  assert.strictEqual(kw('Residential Plumbing Services', ''), 'residential plumbing services');
});

test('trailing punctuation is cleaned off', () => {
  assert.strictEqual(kw('Residential Plumbing Services -'), 'residential plumbing services');
});

test('whitespace is collapsed', () => {
  assert.strictEqual(kw('  Residential   Plumbing  Services  '), 'residential plumbing services');
});

test('read_keyword prefers what was typed', () => {
  const r = run(`${post({ keyword: 'slab leak detection' })}
    out(call_private('read_keyword', array(null)));`);
  assert.strictEqual(r, 'slab leak detection');
});

test('read_keyword falls back to the page title when the box is blank', () => {
  // Empty is a valid answer, so the form does not mark the field required.
  const r = run(`${post({ keyword: '   ' })}
    out(call_private('read_keyword', array(null)));`);
  assert.strictEqual(r, 'page');   // the stub's get_the_title() returns 'Page'
});

/* --- the intent dropdown -------------------------------------------------- */

test('the dropdown value is used when nothing is typed', () => {
  // The option values ARE sentences, so what is stored still reads as prose
  // to the writer downstream.
  const r = run(`${post({ intent_choice: 'have what they already own repaired, rather than replaced' })}
    out(call_private('read_intent'));`);
  assert.strictEqual(r, 'have what they already own repaired, rather than replaced');
});

test('typed text overrides the dropdown', () => {
  const r = run(`${post({
    intent_choice: 'get in touch about this service',
    intent: 'find out where the leak is before anyone breaks concrete',
  })}
    out(call_private('read_intent'));`);
  assert.strictEqual(r, 'find out where the leak is before anyone breaks concrete');
});

test('whitespace-only text does NOT override the dropdown', () => {
  // A stray space in the box would otherwise silently wipe the choice.
  const r = run(`${post({
    intent_choice: 'book a consultation to talk through their situation',
    intent: '   ',
  })}
    out(call_private('read_intent'));`);
  assert.strictEqual(r, 'book a consultation to talk through their situation');
});

test('typed text is trimmed', () => {
  // Note: sanitize_text_field() already trims, so this asserts the behaviour
  // rather than the explicit trim() in read_intent(). Both would have to go
  // for it to fail.
  const r = run(`${post({ intent: '  book a consultation  ' })}
    out(call_private('read_intent'));`);
  assert.strictEqual(r, 'book a consultation');
});

test('nothing posted yields an empty string, not a notice', () => {
  const r = run(`${post({})} out(call_private('read_intent'));`);
  assert.strictEqual(r, '');
});

test('every dropdown option is a sentence, not a keyword', () => {
  // The whole point. An option that reads as a noun phrase would reintroduce
  // the bug the dropdown exists to prevent.
  const src = fs.readFileSync(ADMIN, 'utf8');
  const block = src.slice(src.indexOf('$intent_options = array('), src.indexOf('$current = (string)'));
  // No length floor in the pattern: a short value is exactly the failure this
  // is looking for, and a regex that skips it cannot see the bug.
  const values = [...block.matchAll(/^\s*'([^']+)'\s*$/gm)].map(m => m[1]);
  assert.ok(values.length >= 5, `found ${values.length} option values, expected the full list`);
  for (const v of values) {
    assert.ok(/^[a-z]/.test(v), `option should start lower case to finish the stem: "${v}"`);
    assert.ok(/\s/.test(v), `option is a single word, not a sentence: "${v}"`);
  }
});

/* --- the busy state on submit --------------------------------------------- */

test('every submit button on the campaign form declares a busy label', () => {
  const src = fs.readFileSync(ADMIN, 'utf8');
  const form = src.slice(src.indexOf('id="ie-campaign-form"'), src.indexOf('</form>', src.indexOf('id="ie-campaign-form"')));
  const buttons = form.match(/<button type="submit"[\s\S]*?>/g) || [];
  assert.ok(buttons.length >= 3, `found ${buttons.length} submit buttons, expected 3`);
  for (const b of buttons) {
    assert.ok(/data-busy=/.test(b), `a submit button has no data-busy: ${b.slice(0, 70)}`);
  }
});

test('the clicked button is NEVER disabled', () => {
  // A disabled submit button is omitted from the POST, so `action=ie_suggest`
  // would never arrive and admin-post.php would have nothing to dispatch on.
  // The script must disable only the siblings.
  const src = fs.readFileSync(ADMIN, 'utf8');
  const script = src.slice(src.indexOf("getElementById('ie-campaign-form')"), src.indexOf('</script>', src.indexOf("getElementById('ie-campaign-form')")));
  assert.ok(/!==\s*b/.test(script), 'nothing excludes the clicked button from being disabled');
  assert.ok(!/\bb\.disabled\s*=/.test(script), 'the clicked button is disabled — its name/value will not post');
});

test('a second submit is blocked', () => {
  const src = fs.readFileSync(ADMIN, 'utf8');
  const script = src.slice(src.indexOf("getElementById('ie-campaign-form')"), src.indexOf('</script>', src.indexOf("getElementById('ie-campaign-form')")));
  assert.ok(/if\s*\(\s*busy\s*\)/.test(script), 'no guard against a double submit');
  assert.ok(/preventDefault/.test(script), 'the second submit is not prevented');
});

/* --- the review step is wired up ----------------------------------------- */

test('the review action is registered', () => {
  const src = fs.readFileSync(ADMIN, 'utf8');
  assert.ok(/admin_post_ie_review_topics/.test(src), 'no admin_post hook');
  assert.ok(/function handle_review_topics/.test(src), 'no handler');
  assert.ok(/value="ie_review_topics"/.test(src), 'no button posts the action');
});

test('the review status maps to the New campaign tab', () => {
  // Land anywhere else and the table the owner just asked for is off screen.
  const src = fs.readFileSync(ADMIN, 'utf8');
  const tabBlock = src.slice(src.indexOf('function tab_for_status'), src.indexOf('function tab_for_status') + 600);
  assert.ok(/case 'reviewing':/.test(tabBlock), "'reviewing' does not return the 'new' tab");
  assert.ok(/'reviewing' =>/.test(src), 'no notice text for the review step');
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
