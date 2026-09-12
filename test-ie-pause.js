// test-ie-pause.js
//
// Stopping a campaign, and starting it again.
//
// WHAT THIS IS GUARDING
//
// A campaign's status is a value in a WordPress option. Setting it to 'paused'
// stops THIS PLUGIN — nothing new is fetched, nothing is written. It does not
// stop the posts: a post at status 'future' is published by WordPress core on
// its date, and core has never heard of a campaign. So a pause that only wrote
// a status would leave the owner watching the content they just stopped go
// live on schedule, which is the exact failure the feature exists to prevent.
//
// The other half is arithmetic. Resume moves every remaining date forward by
// however long the campaign sat still. Restore the original dates instead and
// a three-week pause ends with three weeks of backdated posts appearing at
// once — the pattern that reads as automated, on a product sold for not
// reading as automated.
//
// HOW THIS TESTS IT
//
// The plugin classes are real PHP, so they run as real PHP against a stub of
// the WordPress functions they touch: options in an array, posts in an array,
// post meta in an array. Every assertion is about state after a real call, not
// about the shape of the source.
//
//   node test-ie-pause.js        (needs php on PATH — skips cleanly without)

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
  console.log('\ntest-ie-pause: php is not on PATH — skipping.');
  console.log('This suite runs the plugin as real PHP. Asserting on the source');
  console.log('would prove the code was written, not that a post stops.');
  process.exit(0);
}

const PLUGIN = path.join(__dirname, 'wp-plugin', 'interlink-engine', 'includes');

/* -------------------------------------------------------------------------
 * The stub
 *
 * Enough WordPress to run IE_Campaigns and the two new IE_Publisher methods.
 * Posts are an array of rows; the only behaviour that matters is that
 * wp_update_post merges and that get_post returns an object.
 * ---------------------------------------------------------------------- */

const STUB = `<?php
define('ABSPATH', '/tmp/');
define('HOUR_IN_SECONDS', 3600);

$GLOBALS['options'] = array();
$GLOBALS['posts']   = array();
$GLOBALS['meta']    = array();
$GLOBALS['log']     = array();

function get_option($k, $d = false) { return isset($GLOBALS['options'][$k]) ? $GLOBALS['options'][$k] : $d; }
function update_option($k, $v, $a = null) { $GLOBALS['options'][$k] = $v; return true; }

function get_post($id) {
  $id = (int) $id;
  return isset($GLOBALS['posts'][$id]) ? (object) $GLOBALS['posts'][$id] : null;
}
function wp_update_post($args, $err = false) {
  $id = (int) $args['ID'];
  if (!isset($GLOBALS['posts'][$id])) { return 0; }
  foreach ($args as $k => $v) { $GLOBALS['posts'][$id][$k] = $v; }
  return $id;
}

function get_post_meta($id, $key, $single = false) {
  $id = (int) $id;
  return isset($GLOBALS['meta'][$id][$key]) ? $GLOBALS['meta'][$id][$key] : '';
}
function update_post_meta($id, $key, $value) { $GLOBALS['meta'][(int) $id][$key] = $value; return true; }
function delete_post_meta($id, $key) { unset($GLOBALS['meta'][(int) $id][$key]); return true; }

// The plugin stores GMT dates on posts; get_post_time('c', true) is how it
// reads one back as an unambiguous ISO string.
function get_post_time($format, $gmt = false, $id = 0) {
  $p = get_post($id);
  if (!$p) { return ''; }
  return gmdate($format, strtotime($p->post_date_gmt . ' UTC'));
}
function get_date_from_gmt($s) { return $s; }
function current_time($type, $gmt = 0) {
  return 'mysql' === $type ? gmdate('Y-m-d H:i:s') : time();
}
function get_permalink($id) { return 'https://example.com/post-' . (int) $id . '/'; }
function wp_date($f, $t = null) { return gmdate($f, $t ? $t : time()); }

function sanitize_text_field($s) { return $s; }
function esc_url($s) { return $s; }
function esc_attr($s) { return $s; }
function esc_html($s) { return $s; }
function __($s, $d = '') { return $s; }
function _n($a, $b, $n, $d = '') { return 1 === (int) $n ? $a : $b; }

class WP_Error {
  public $code; public $message;
  public function __construct($c = '', $m = '') { $this->code = $c; $this->message = $m; }
  public function get_error_message() { return $this->message; }
}
function is_wp_error($t) { return $t instanceof WP_Error; }

// The publisher's siblings. Only the members pause/resume reach are needed.
class IE_Api {
  public static function published($a, $b, $c) {}
  public static function write($id) { return array(); }
}
class IE_Settings {
  public static function get($k, $d = null) { return $d; }
  public static function active_theme_prefix() { return 'theme'; }
}
class IE_Links {
  public static function activate($content, $token, $url) { return array('count' => 0, 'content' => $content); }
  public static function render($s, $t) { return array('content' => '', 'missing' => array()); }
}

require '${PLUGIN}/class-ie-campaigns.php';
require '${PLUGIN}/class-ie-publisher.php';

/* ---- helpers the cases use ---- */

/** A campaign of N slots, each with a post scheduled days apart from now. */
function seed_campaign($id, $slots, $offsets) {
  $rows = array();
  foreach ($offsets as $i => $days) {
    $post_id = 100 + $i;
    $when    = time() + ($days * 86400);

    $GLOBALS['posts'][$post_id] = array(
      'ID'            => $post_id,
      'post_status'   => 'future',
      'post_date_gmt' => gmdate('Y-m-d H:i:s', $when),
      'post_date'     => gmdate('Y-m-d H:i:s', $when),
    );
    $GLOBALS['meta'][$post_id] = array('_ie_campaign' => $id, '_ie_slot' => $i);

    $rows[] = array(
      'index'         => $i,
      'topic'         => 'Topic ' . $i,
      'publish_at'    => gmdate('c', $when),
      'status'        => 'scheduled',
      'post_id'       => $post_id,
      'scheduled_for' => gmdate('c', $when),
    );
  }

  $GLOBALS['options']['ie_campaigns'][$id] = array(
    'id'           => $id,
    'status'       => 'active',
    'label'        => 'Test',
    'publish_mode' => 'future',
    'slots'        => $rows,
  );
}

function out($v) { echo json_encode($v); }
`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-pause-'));
fs.writeFileSync(path.join(tmp, 'stub.php'), STUB);

/** Run a PHP fragment against the stub; returns whatever it json-encodes. */
function run(body) {
  const file = path.join(tmp, 'case.php');
  fs.writeFileSync(file, `<?php\nrequire __DIR__ . '/stub.php';\n${body}\n`);
  const raw = execFileSync('php', [file], { encoding: 'utf8' });
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`PHP did not return JSON:\n${raw}`);
  }
}

console.log('\nCampaign pause / resume\n');

/* -------------------------------------------------------------------------
 * Pause
 * ---------------------------------------------------------------------- */

test('pausing holds every scheduled post as a draft', () => {
  // The whole point. A post left at 'future' is published by WordPress on its
  // date no matter what the campaign status says.
  const r = run(`
    seed_campaign('c1', 3, array(3, 10, 17));
    $held = IE_Publisher::pause('c1');
    $statuses = array();
    foreach (array(100, 101, 102) as $id) { $statuses[] = $GLOBALS['posts'][$id]['post_status']; }
    out(array('held' => $held, 'statuses' => $statuses));
  `);
  assert.strictEqual(r.held, 3, `held ${r.held}`);
  assert.deepStrictEqual(r.statuses, ['draft', 'draft', 'draft'], JSON.stringify(r.statuses));
});

test('pausing sets the campaign status and a paused_at stamp', () => {
  const r = run(`
    seed_campaign('c1', 1, array(5));
    IE_Publisher::pause('c1');
    $c = IE_Campaigns::get('c1');
    out(array('status' => $c['status'], 'stamp' => isset($c['paused_at']) ? $c['paused_at'] : null));
  `);
  assert.strictEqual(r.status, 'paused');
  assert.ok(r.stamp, 'no paused_at recorded — resume cannot compute the shift without it');
});

test('pausing records the date each post was holding', () => {
  // Resume needs the original date, and it must not be read back off the post
  // after the post has been changed.
  const r = run(`
    seed_campaign('c1', 1, array(5));
    $before = $GLOBALS['posts'][100]['post_date_gmt'];
    IE_Publisher::pause('c1');
    out(array('before' => $before, 'meta' => $GLOBALS['meta'][100]['_ie_held_until']));
  `);
  assert.ok(r.meta, 'no _ie_held_until written');
  assert.strictEqual(
    new Date(r.meta).toISOString().slice(0, 16),
    new Date(r.before.replace(' ', 'T') + 'Z').toISOString().slice(0, 16)
  );
});

test('pausing leaves published posts alone', () => {
  // Taking live content down is not what anyone means by pause, and doing it
  // silently would be worse than not pausing.
  const r = run(`
    seed_campaign('c1', 2, array(3, 10));
    $GLOBALS['posts'][100]['post_status'] = 'publish';
    $held = IE_Publisher::pause('c1');
    out(array('held' => $held, 'first' => $GLOBALS['posts'][100]['post_status']));
  `);
  assert.strictEqual(r.first, 'publish', 'a published post was pulled down');
  assert.strictEqual(r.held, 1, 'the published post was counted as held');
});

test('pausing refuses a post it did not create', () => {
  // A slot record is a small integer pointing at a post id. A stale one aimed
  // at the customer's own page would be very hard to notice and impossible to
  // undo — the same refusal activate_for_slot() makes.
  const r = run(`
    seed_campaign('c1', 1, array(5));
    unset($GLOBALS['meta'][100]['_ie_campaign']);
    $held = IE_Publisher::pause('c1');
    out(array('held' => $held, 'status' => $GLOBALS['posts'][100]['post_status']));
  `);
  assert.strictEqual(r.status, 'future', 'edited a post the plugin did not create');
  assert.strictEqual(r.held, 0);
});

test('pausing twice is harmless', () => {
  const r = run(`
    seed_campaign('c1', 2, array(3, 10));
    IE_Publisher::pause('c1');
    $second = IE_Publisher::pause('c1');
    out(array('second' => $second, 'status' => IE_Campaigns::get('c1')['status']));
  `);
  assert.strictEqual(r.second, 0, 'a second pause did work');
  assert.strictEqual(r.status, 'paused');
});

test('pausing an unknown campaign is an error, not a crash', () => {
  const r = run(`
    $e = IE_Publisher::pause('nope');
    out(array('err' => is_wp_error($e)));
  `);
  assert.strictEqual(r.err, true);
});

/* -------------------------------------------------------------------------
 * Resume
 * ---------------------------------------------------------------------- */

test('resuming puts held posts back on the schedule', () => {
  const r = run(`
    seed_campaign('c1', 3, array(3, 10, 17));
    IE_Publisher::pause('c1');
    $released = IE_Publisher::resume('c1');
    $statuses = array();
    foreach (array(100, 101, 102) as $id) { $statuses[] = $GLOBALS['posts'][$id]['post_status']; }
    out(array('released' => $released, 'statuses' => $statuses, 'status' => IE_Campaigns::get('c1')['status']));
  `);
  assert.strictEqual(r.released, 3);
  assert.deepStrictEqual(r.statuses, ['future', 'future', 'future']);
  assert.strictEqual(r.status, 'active');
});

test('resuming shifts dates forward by the time paused', () => {
  // The arithmetic that keeps a weekly campaign weekly. Backdating instead
  // would publish the backlog at once.
  const r = run(`
    seed_campaign('c1', 2, array(3, 10));
    $orig = strtotime($GLOBALS['posts'][100]['post_date_gmt'] . ' UTC');
    IE_Publisher::pause('c1');

    // Pretend the campaign sat still for two days.
    $c = IE_Campaigns::get('c1');
    $c['paused_at'] = gmdate('c', time() - (2 * 86400));
    IE_Campaigns::save($c);

    IE_Publisher::resume('c1');
    $now = strtotime($GLOBALS['posts'][100]['post_date_gmt'] . ' UTC');
    out(array('shift_days' => round(($now - $orig) / 86400, 2)));
  `);
  assert.ok(Math.abs(r.shift_days - 2) < 0.05, `shifted ${r.shift_days} days, expected 2`);
});

test('resuming preserves the spacing between posts', () => {
  // Every date moves by the same amount, so a campaign planned a week apart
  // is still a week apart afterwards.
  const r = run(`
    seed_campaign('c1', 3, array(3, 10, 17));
    IE_Publisher::pause('c1');
    $c = IE_Campaigns::get('c1');
    $c['paused_at'] = gmdate('c', time() - (5 * 86400));
    IE_Campaigns::save($c);
    IE_Publisher::resume('c1');

    $t = array();
    foreach (array(100, 101, 102) as $id) { $t[] = strtotime($GLOBALS['posts'][$id]['post_date_gmt'] . ' UTC'); }
    out(array('gaps' => array(round(($t[1] - $t[0]) / 86400), round(($t[2] - $t[1]) / 86400))));
  `);
  assert.deepStrictEqual(r.gaps, [7, 7], JSON.stringify(r.gaps));
});

test('resuming updates the slot dates the schedule screens read', () => {
  // The screens read the slot, not the post. Leaving these stale shows the
  // owner dates the campaign is no longer running to.
  const r = run(`
    seed_campaign('c1', 1, array(3));
    $before = IE_Campaigns::get('c1')['slots'][0]['publish_at'];
    IE_Publisher::pause('c1');
    $c = IE_Campaigns::get('c1');
    $c['paused_at'] = gmdate('c', time() - 86400);
    IE_Campaigns::save($c);
    IE_Publisher::resume('c1');
    out(array('before' => $before, 'after' => IE_Campaigns::get('c1')['slots'][0]['publish_at']));
  `);
  assert.notStrictEqual(r.after, r.before, 'slot publish_at was left stale');
  assert.ok(new Date(r.after) > new Date(r.before), 'slot date moved backwards');
});

test('a post whose date passed while stopped publishes rather than sticking', () => {
  // Writing a past date back as 'future' is the classic missed-schedule post:
  // WordPress accepts it and then never publishes it.
  const r = run(`
    seed_campaign('c1', 1, array(-2));   // already overdue when paused
    IE_Publisher::pause('c1');
    IE_Publisher::resume('c1');
    out(array('status' => $GLOBALS['posts'][100]['post_status']));
  `);
  assert.strictEqual(r.status, 'publish', `left at ${r.status} — a post stuck in the past`);
});

test('resume does not touch a post the owner drafted themselves', () => {
  // No _ie_held_until means we did not hold it. Publishing it would undo a
  // deliberate decision the owner made while the campaign was stopped.
  const r = run(`
    seed_campaign('c1', 2, array(3, 10));
    $GLOBALS['posts'][101]['post_status'] = 'draft';   // owner drafted it BEFORE the pause
    IE_Publisher::pause('c1');
    $released = IE_Publisher::resume('c1');
    out(array('released' => $released, 'second' => $GLOBALS['posts'][101]['post_status']));
  `);
  assert.strictEqual(r.second, 'draft', "the owner's own draft was put back on the schedule");
  assert.strictEqual(r.released, 1);
});

test('resume respects a post the owner published while stopped', () => {
  const r = run(`
    seed_campaign('c1', 1, array(3));
    IE_Publisher::pause('c1');
    $GLOBALS['posts'][100]['post_status'] = 'publish';
    IE_Publisher::resume('c1');
    out(array('status' => $GLOBALS['posts'][100]['post_status'], 'meta' => $GLOBALS['meta'][100]));
  `);
  assert.strictEqual(r.status, 'publish', 'un-published something the owner published');
  assert.ok(!r.meta._ie_held_until, 'left a stale hold marker behind');
});

test('the hold marker is cleared on resume', () => {
  // A leftover marker would make the NEXT resume move a post nobody paused.
  const r = run(`
    seed_campaign('c1', 2, array(3, 10));
    IE_Publisher::pause('c1');
    IE_Publisher::resume('c1');
    out(array('a' => $GLOBALS['meta'][100], 'b' => $GLOBALS['meta'][101]));
  `);
  assert.ok(!r.a._ie_held_until && !r.b._ie_held_until, 'hold markers survived resume');
});

test('resuming a campaign that is not paused does nothing', () => {
  const r = run(`
    seed_campaign('c1', 1, array(3));
    $n = IE_Publisher::resume('c1');
    out(array('n' => $n, 'status' => $GLOBALS['posts'][100]['post_status']));
  `);
  assert.strictEqual(r.n, 0);
  assert.strictEqual(r.status, 'future');
});

/* -------------------------------------------------------------------------
 * What a paused campaign stops
 * ---------------------------------------------------------------------- */

test('a paused campaign is not offered work to collect', () => {
  const r = run(`
    seed_campaign('c1', 2, array(3, 10));
    $c = IE_Campaigns::get('c1');
    $c['slots'][0]['status'] = 'pending';
    IE_Campaigns::save($c);

    $before = IE_Campaigns::campaigns_with_work();
    IE_Publisher::pause('c1');
    out(array('before' => $before, 'after' => IE_Campaigns::campaigns_with_work()));
  `);
  assert.deepStrictEqual(r.before, ['c1'], 'the fixture was wrong — nothing was pending');
  assert.deepStrictEqual(r.after, [], 'a paused campaign is still being collected');
});

test('a paused campaign is not swept for missed schedules', () => {
  const r = run(`
    seed_campaign('c1', 1, array(-3));
    $before = count(IE_Campaigns::missed_schedule());
    IE_Publisher::pause('c1');
    out(array('before' => $before, 'after' => count(IE_Campaigns::missed_schedule())));
  `);
  assert.strictEqual(r.before, 1, 'the fixture was wrong — nothing looked missed');
  assert.strictEqual(r.after, 0, 'a paused campaign is still being swept');
});

test('a paused campaign does not fill the schedule screen with overdue rows', () => {
  // upcoming() used to name 'cancelled'. A paused campaign's drafts would
  // have shown as overdue — the alarm that means WP-Cron has died.
  const r = run(`
    seed_campaign('c1', 2, array(3, 10));
    $before = count(IE_Campaigns::upcoming(20));
    IE_Publisher::pause('c1');
    out(array('before' => $before, 'after' => count(IE_Campaigns::upcoming(20))));
  `);
  assert.strictEqual(r.before, 2);
  assert.strictEqual(r.after, 0, 'paused rows still showing on the schedule');
});

test('a paused campaign cannot collide with another', () => {
  const r = run(`
    seed_campaign('c1', 2, array(3, 10));
    $before = count(IE_Campaigns::collisions());
    IE_Publisher::pause('c1');
    out(array('before' => $before, 'after' => count(IE_Campaigns::collisions())));
  `);
  assert.strictEqual(r.after, 0);
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
