// test-ie-video.js
//
// The campaign's video, and where it lands in a post.
//
// WHAT MATTERS HERE
//
// This writes into post_content, which is the one thing in the system that
// outlives the plugin. A mistake is therefore permanent across every post in
// a campaign, and there is no migration to run afterwards — the owner would
// be editing twelve posts by hand.
//
// So the properties worth pinning down are: it goes at a section boundary and
// never inside a paragraph; it never appears twice; an empty or hostile URL
// changes nothing; and the block is a CORE shortcode, because ours would rot
// into visible litter the day the plugin is deleted.
//
//   node test-ie-video.js        (needs php on PATH — skips cleanly without)

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

const phpCheck = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (phpCheck.error) {
  console.log('\ntest-ie-video: php is not on PATH — skipping.');
  process.exit(0);
}

const PLUGIN = path.join(__dirname, 'wp-plugin', 'interlink-engine', 'includes');

const STUB = `<?php
define('ABSPATH', '/tmp/');
$GLOBALS['options'] = array();

function get_option($k, $d = false) { return isset($GLOBALS['options'][$k]) ? $GLOBALS['options'][$k] : $d; }
function update_option($k, $v, $a = null) { $GLOBALS['options'][$k] = $v; return true; }

// Core's esc_url_raw, near enough: it drops schemes outside the allow list.
function esc_url_raw($u) {
  $u = trim((string) $u);
  return preg_match('#^(https?|mailto)://#i', $u) || preg_match('#^mailto:#i', $u) ? $u : '';
}
function esc_url($u) { return esc_url_raw($u); }
function sanitize_text_field($s) { return trim(strip_tags((string) $s)); }
function esc_html($s) { return htmlspecialchars($s, ENT_QUOTES); }
function esc_attr($s) { return htmlspecialchars($s, ENT_QUOTES); }
function __($s, $d = '') { return $s; }
function _n($a, $b, $n, $d = '') { return 1 === (int) $n ? $a : $b; }
function current_time($t, $gmt = 0) { return gmdate('Y-m-d H:i:s'); }
function get_date_from_gmt($s) { return $s; }
function get_post($id) { return null; }
function get_post_meta($i, $k, $s = false) { return ''; }
function update_post_meta($i, $k, $v) { return true; }
function delete_post_meta($i, $k) { return true; }
function get_post_time($f, $g = false, $i = 0) { return ''; }
function wp_update_post($a, $e = false) { return 1; }
function get_permalink($i) { return 'https://example.com/x/'; }
function wp_date($f, $t = null) { return gmdate($f, $t ? $t : time()); }

class WP_Error {
  public $message;
  public function __construct($c = '', $m = '') { $this->message = $m; }
  public function get_error_message() { return $this->message; }
}
function is_wp_error($t) { return $t instanceof WP_Error; }
class IE_Api { public static function published($a,$b,$c){} public static function write($i){ return array(); } }
class IE_Settings { public static function get($k,$d=null){ return $d; } public static function active_theme_prefix(){ return 't'; } }
class IE_Links {
  public static function activate($c,$t,$u){ return array('count'=>0,'content'=>$c); }
  public static function render($s,$t){ return array('content'=>'','missing'=>array()); }
}

require '${PLUGIN}/class-ie-campaigns.php';
require '${PLUGIN}/class-ie-publisher.php';

function out($v) { echo json_encode($v); }
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-video-'));
fs.writeFileSync(path.join(tmp, 'stub.php'), STUB);

function run(body) {
  const file = path.join(tmp, 'case.php');
  fs.writeFileSync(file, `<?php\nrequire __DIR__ . '/stub.php';\n${body}\n`);
  const raw = execFileSync('php', [file], { encoding: 'utf8' });
  try { return JSON.parse(raw); }
  catch (e) { throw new Error(`PHP did not return JSON:\n${raw}`); }
}

/** A post with three sections, as the writer produces them. */
const POST = [
  '<h2>One</h2>', '<p>Alpha.</p>',
  '<h2>Two</h2>', '<p>Beta.</p>',
  '<h2>Three</h2>', '<p>Gamma.</p>',
].join('\n');

const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

function insert(content, url) {
  return run(`out(IE_Publisher::insert_video(
    ${JSON.stringify(content)},
    ${JSON.stringify(url)}
  ));`);
}

console.log('\nCampaign video\n');

/* ------------------------------------------------------------------------ */

test('a video is inserted', () => {
  assert.ok(insert(POST, YT).includes('[embed]'), 'nothing was inserted');
});

test('it uses the CORE [embed] shortcode, not a raw iframe', () => {
  // Core's shortcode survives the plugin being deleted, gets the responsive
  // wrapper and the lazy-loading. A hand-written iframe gets none of it and is
  // what security plugins strip.
  const html = insert(POST, YT);
  assert.ok(html.includes(`[embed]${YT}[/embed]`), 'no core embed shortcode');
  assert.ok(!/<iframe/i.test(html), 'wrote a raw iframe');
});

test('it lands before the SECOND heading', () => {
  // A section boundary: past the opening prose, not buried at the end.
  const html = insert(POST, YT);
  const at = html.indexOf('[embed]');
  assert.ok(at > html.indexOf('<h2>One</h2>'), 'inserted before the first section');
  assert.ok(at < html.indexOf('<h2>Two</h2>'), 'inserted after the second heading');
});

test('it never splits a paragraph', () => {
  // The failure that would look broken on a live site.
  const html = insert(POST, YT);
  const before = html.slice(0, html.indexOf('[embed]'));
  const opens = (before.match(/<p>/g) || []).length;
  const closes = (before.match(/<\/p>/g) || []).length;
  assert.strictEqual(opens, closes, 'inserted inside an open <p>');
});

test('the whole post survives intact', () => {
  const html = insert(POST, YT);
  for (const frag of ['<h2>One</h2>', 'Alpha.', '<h2>Two</h2>', 'Beta.', '<h2>Three</h2>', 'Gamma.']) {
    assert.ok(html.includes(frag), `lost: ${frag}`);
  }
});

test('the shortcode sits on its own block', () => {
  // autoembed and wpautop both work on blank-line boundaries. Glued to a
  // </p> the shortcode is not a block and does not become a player.
  const html = insert(POST, YT);
  assert.ok(/\n\n\[embed\]/.test(html), 'no blank line before the shortcode');
  assert.ok(/\[\/embed\]\n\n/.test(html), 'no blank line after the shortcode');
});

/* --- nothing to insert --------------------------------------------------- */

test('an empty url changes nothing at all', () => {
  assert.strictEqual(insert(POST, ''), POST);
});

test('whitespace is treated as empty', () => {
  assert.strictEqual(insert(POST, '   '), POST);
});

test('a javascript: url is refused', () => {
  // The one that matters. This value has been sitting in a WordPress option
  // since the form validated it, and options get edited by other plugins,
  // by WP-CLI and by hand.
  const html = insert(POST, 'javascript:alert(1)');
  assert.ok(!/javascript:/i.test(html), 'javascript: url reached the post');
  assert.strictEqual(html, POST);
});

test('a data: url is refused', () => {
  assert.strictEqual(insert(POST, 'data:text/html,<script>x</script>'), POST);
});

test('a protocol-relative url is refused', () => {
  assert.strictEqual(insert(POST, '//evil.example/x'), POST);
});

/* --- idempotence and edge shapes ----------------------------------------- */

test('inserting twice does not duplicate the video', () => {
  // run_campaign() is meant to be safe to press repeatedly.
  const once = insert(POST, YT);
  const twice = insert(once, YT);
  assert.strictEqual(twice, once, 'a second pass changed the content');
  assert.strictEqual((twice.match(/\[embed\]/g) || []).length, 1);
});

test('a post with one heading gets the video appended', () => {
  const short = '<h2>Only</h2>\n<p>Alpha.</p>';
  const html = insert(short, YT);
  assert.ok(html.includes('[embed]'), 'nothing inserted');
  assert.ok(html.indexOf('[embed]') > html.indexOf('Alpha.'), 'inserted before the only section');
});

test('a post with no headings still works', () => {
  const flat = '<p>Alpha.</p>\n<p>Beta.</p>';
  const html = insert(flat, YT);
  assert.ok(html.includes('[embed]'), 'nothing inserted');
  assert.ok(html.startsWith('<p>Alpha.</p>'), 'content was reordered');
});

test('H2 with attributes is still recognised as a heading', () => {
  // The writer does not emit these today, but an owner editing in the block
  // editor produces <h2 class="wp-block-heading"> constantly.
  const withAttrs = '<h2 class="x">One</h2>\n<p>A.</p>\n<h2 class="x">Two</h2>\n<p>B.</p>';
  const html = insert(withAttrs, YT);
  assert.ok(html.indexOf('[embed]') < html.indexOf('>Two<'), 'missed an h2 carrying attributes');
});

test('H2 in capitals is recognised', () => {
  const caps = '<H2>One</H2>\n<p>A.</p>\n<H2>Two</H2>\n<p>B.</p>';
  assert.ok(insert(caps, YT).includes('[embed]'), 'case-sensitive heading match');
});

/* --- storage ------------------------------------------------------------- */

test('the campaign stores the video url', () => {
  const r = run(`
    IE_Campaigns::create_from_plan(
      array('campaignId' => 'c1', 'slots' => array()),
      array('video_url' => '${YT}', 'label' => 'x')
    );
    out(array('url' => IE_Campaigns::get('c1')['video_url']));
  `);
  assert.strictEqual(r.url, YT);
});

/* --- per-article override ------------------------------------------------ */

test('a slot video wins over the campaign video', () => {
  const r = run(`out(IE_Publisher::video_for(
    array('video_url' => 'https://youtu.be/CAMPAIGN'),
    array('video_url' => 'https://youtu.be/SLOT')
  ));`);
  assert.strictEqual(r, 'https://youtu.be/SLOT');
});

test('a slot with no video falls back to the campaign', () => {
  const r = run(`out(IE_Publisher::video_for(
    array('video_url' => 'https://youtu.be/CAMPAIGN'),
    array('video_url' => '')
  ));`);
  assert.strictEqual(r, 'https://youtu.be/CAMPAIGN');
});

test('no video anywhere yields an empty string', () => {
  const r = run(`out(IE_Publisher::video_for(array(), array()));`);
  assert.strictEqual(r, '');
});

test('a slot video works when the campaign has none', () => {
  const r = run(`out(IE_Publisher::video_for(
    array(), array('video_url' => 'https://youtu.be/SLOT')
  ));`);
  assert.strictEqual(r, 'https://youtu.be/SLOT');
});

test('slot videos are matched to slots by TOPIC, not by row number', () => {
  // The rows are ours; the slots come back from the server. Matching on index
  // would look right and be wrong the moment the server drops or reorders a
  // topic — every video landing on its neighbour's article.
  const r = run(`
    IE_Campaigns::create_from_plan(
      array('campaignId' => 'c3', 'slots' => array(
        array('index' => 0, 'topic' => 'Slab leaks'),
        array('index' => 1, 'topic' => 'Water heaters'),
      )),
      array('label' => 'x', 'slot_videos' => array(
        'water heaters' => 'https://youtu.be/HEATER',
        'slab leaks'    => 'https://youtu.be/SLAB',
      ))
    );
    $s = IE_Campaigns::get('c3')['slots'];
    out(array($s[0]['topic'] => $s[0]['video_url'], $s[1]['topic'] => $s[1]['video_url']));
  `);
  assert.strictEqual(r['Slab leaks'], 'https://youtu.be/SLAB');
  assert.strictEqual(r['Water heaters'], 'https://youtu.be/HEATER');
});

test('a reordered plan still gets the right video on the right article', () => {
  // Same input, slots returned in the other order. Index matching fails here.
  const r = run(`
    IE_Campaigns::create_from_plan(
      array('campaignId' => 'c4', 'slots' => array(
        array('index' => 0, 'topic' => 'Water heaters'),
        array('index' => 1, 'topic' => 'Slab leaks'),
      )),
      array('label' => 'x', 'slot_videos' => array(
        'water heaters' => 'https://youtu.be/HEATER',
        'slab leaks'    => 'https://youtu.be/SLAB',
      ))
    );
    $s = IE_Campaigns::get('c4')['slots'];
    out(array($s[0]['topic'] => $s[0]['video_url'], $s[1]['topic'] => $s[1]['video_url']));
  `);
  assert.strictEqual(r['Water heaters'], 'https://youtu.be/HEATER');
  assert.strictEqual(r['Slab leaks'], 'https://youtu.be/SLAB');
});

test('topic matching ignores case', () => {
  const r = run(`
    IE_Campaigns::create_from_plan(
      array('campaignId' => 'c5', 'slots' => array(array('index' => 0, 'topic' => 'Slab Leaks'))),
      array('label' => 'x', 'slot_videos' => array('slab leaks' => 'https://youtu.be/SLAB'))
    );
    out(IE_Campaigns::get('c5')['slots'][0]['video_url']);
  `);
  assert.strictEqual(r, 'https://youtu.be/SLAB');
});

test('a slot with no matching video stores an empty string', () => {
  const r = run(`
    IE_Campaigns::create_from_plan(
      array('campaignId' => 'c6', 'slots' => array(array('index' => 0, 'topic' => 'Unrelated'))),
      array('label' => 'x', 'slot_videos' => array('slab leaks' => 'https://youtu.be/SLAB'))
    );
    $s = IE_Campaigns::get('c6')['slots'][0];
    out(array('set' => isset($s['video_url']), 'val' => $s['video_url']));
  `);
  assert.strictEqual(r.set, true);
  assert.strictEqual(r.val, '');
});

test('a campaign with no video stores an empty string, not null', () => {
  // isset() checks downstream read '' correctly and null badly.
  const r = run(`
    IE_Campaigns::create_from_plan(
      array('campaignId' => 'c2', 'slots' => array()),
      array('label' => 'x')
    );
    $c = IE_Campaigns::get('c2');
    out(array('set' => isset($c['video_url']), 'val' => $c['video_url']));
  `);
  assert.strictEqual(r.set, true, 'video_url key missing entirely');
  assert.strictEqual(r.val, '');
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
