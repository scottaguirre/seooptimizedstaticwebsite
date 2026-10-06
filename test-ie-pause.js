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

$GLOBALS['options']   = array();
$GLOBALS['posts']     = array();
$GLOBALS['meta']      = array();
$GLOBALS['log']       = array();
$GLOBALS['api_calls'] = array();

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

/* IE_Campaigns::upcoming() has called post_missing() since 0.4.3, and that
 * asks WordPress which of these posts still exist. Without this the whole
 * stub dies with "Call to undefined function get_posts()" the moment any
 * case touches upcoming() — a missing stub, not a broken feature, but it
 * fails a suite deploy.sh runs and so blocks every deploy.
 *
 * $GLOBALS['posts'] is what seed_campaign() writes, so it is already the
 * right source of truth for "what is on this site". */
function absint($n) { return abs((int) $n); }

function get_posts($args) {
  $wanted   = isset($args['post__in']) ? array_map('intval', $args['post__in']) : array();
  $statuses = isset($args['post_status']) ? (array) $args['post_status'] : array('publish');

  $out = array();
  foreach ($wanted as $id) {
    if (!isset($GLOBALS['posts'][$id])) { continue; }
    if (!in_array($GLOBALS['posts'][$id]['post_status'], $statuses, true)) { continue; }
    $out[] = $id;
  }
  return $out;
}

function sanitize_text_field($s) { return $s; }
function esc_url($s) { return $s; }
function esc_attr($s) { return $s; }
function esc_html($s) { return $s; }
function __($s, $d = '') { return $s; }
function _n($a, $b, $n, $d = '') { return 1 === (int) $n ? $a : $b; }

/* get_error_data() IS PART OF THE REAL CLASS, and this stub did not have it.
 *
 * run_campaign() reads it to tell a definite refusal from a lost message: a
 * 402 for credits is an answer, a timeout is not, and only the first should
 * clear approved_at. Without the method the whole case died with "Call to
 * undefined method" — which is how the stub told me, rather than quietly
 * passing. A stub LESS capable than the real class fails loudly; a stub MORE
 * forgiving than the real class is the one that ships bugs. */
class WP_Error {
  public $code; public $message; public $data;
  public function __construct($c = '', $m = '', $d = null) {
    $this->code = $c; $this->message = $m; $this->data = $d;
  }
  public function get_error_message() { return $this->message; }
  public function get_error_data() { return $this->data; }
}
function is_wp_error($t) { return $t instanceof WP_Error; }

// The publisher's siblings. Only the members pause/resume reach are needed.
//
// write() RECORDS ITS ARGUMENTS, and its signature matches the real one on
// purpose. PHP lets a user-defined function be called with extra arguments and
// silently drops them, so a stub declared \`write($id)\` accepts
// \`write($id, array(), true)\` without complaint — and every test written
// against it would pass whether the cancel flag was sent or not. A stub more
// forgiving than the real thing is how more than one bug has already reached
// production here.
class IE_Api {
  public static function published($a, $b, $c) {}

  public static function write($id, $slot_indexes = array(), $cancel = false) {
    $GLOBALS['api_calls'][] = array(
      'method' => 'write',
      'id'     => $id,
      'cancel' => (bool) $cancel,
    );

    /* TWO KINDS OF FAILURE, because run_campaign() now treats them
     * differently and a stub with only one could not tell them apart.
     *
     * api_fail is a lost message — a timeout, a dropped connection. Nobody
     * knows whether the server acted on it, so the approval must survive.
     *
     * api_402 is an answer: not enough credits. The shape matches what
     * IE_Api::post() really builds on a non-2xx, data and all, because the
     * code under test reads that data to tell the two apart. A stub that
     * returned a bare WP_Error here would make the 402 look like a
     * timeout and the case would prove nothing. */
    if ( ! empty($GLOBALS['api_fail']) ) {
      return new WP_Error('http', 'the server did not answer');
    }

    if ( ! empty($GLOBALS['api_402']) ) {
      return new WP_Error('ie_api', 'This campaign needs 225 credits and you have 0.', array(
        'status' => 402,
        'body'   => '',
        'data'   => array( 'creditsError' => true, 'creditsAvailable' => 0 ),
      ));
    }

    return array('status' => 'writing');
  }
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

  /* batch_started IS PART OF THE FIXTURE, and leaving it out was a campaign
   * that cannot exist.
   *
   * Every slot above is 'scheduled' with a real post at 'future' — posts that
   * were written, charged for and inserted. A campaign in that state has
   * necessarily been approved, and batch_started is the record of approval.
   * Without it these rows described something impossible: a campaign whose
   * posts had been written and paid for and which nobody had agreed to pay
   * for.
   *
   * It did not matter until run_campaign() started asking the question. It
   * matters now, and a fixture that cannot occur in production is worth
   * fixing rather than working around — tests written against it prove
   * things about a state no customer will ever be in. unapprove() below is
   * for the cases that genuinely need the other state. */
  $GLOBALS['options']['ie_campaigns'][$id] = array(
    'id'            => $id,
    'status'        => 'active',
    'label'         => 'Test',
    'publish_mode'  => 'future',
    'batch_started' => gmdate('Y-m-d H:i:s', time() - 3600),
    'slots'         => $rows,
  );
}

/** A campaign that was planned and never approved. */
function unapprove($id) {
  $all = get_option('ie_campaigns', array());
  $all[$id]['batch_started'] = '';
  $all[$id]['approved_at']   = '';
  update_option('ie_campaigns', $all, false);
}

/** A campaign as it exists the instant planning finishes: nothing written. */
function seed_planned($id, $count) {
  $rows = array();
  for ($i = 0; $i < $count; $i++) {
    $rows[] = array(
      'index'      => $i,
      'topic'      => 'Topic ' . $i,
      'status'     => 'pending',
      'post_id'    => 0,
      'publish_at' => '',
    );
  }

  $GLOBALS['options']['ie_campaigns'][$id] = array(
    'id'           => $id,
    'status'       => 'active',
    'label'        => 'Never approved',
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

/* ------------------------------------------------------------------ *
 * Stopping a batch that is already running — 6 October
 *
 * PAUSE USED TO BE WORDPRESS-ONLY. It set the local status and held
 * scheduled posts back as drafts, and the server learned about it on the
 * hourly reconciliation — long after a batch that takes minutes had
 * finished. Edwin approved eleven articles, pressed Pause a few seconds
 * later, and watched the spinner carry on: all eleven were written and 825
 * credits were charged.
 *
 * None of the twenty tests above could have caught it, and they are not
 * wrong. Every one of them asks what pause does to WORDPRESS — the post
 * statuses, the held dates, the schedule screens — and the whole failure was
 * that pause said nothing to anybody else.
 * ------------------------------------------------------------------ */

test('PAUSE TELLS THE SERVER TO STOP, IMMEDIATELY', () => {
  /* Not on the next sweep. A batch writes roughly one article a minute at 75
   * credits each, so an hour's delay is the entire campaign. */
  const r = run(`
    seed_campaign('c1', 3, array(3, 10, 17));
    $GLOBALS['api_calls'] = array();
    IE_Publisher::pause('c1');
    out(array('calls' => $GLOBALS['api_calls']));
  `);

  const cancels = r.calls.filter(c => c.method === 'write' && c.cancel === true);

  assert.strictEqual(cancels.length, 1,
    'pause did not send a cancel — the server will keep writing and charging');
  assert.strictEqual(cancels[0].id, 'c1');
});

test('PAUSE CLEARS writing_since, SO A RESUME DOES NOT INHERIT A STALE SPINNER', () => {
  /* writing_since is what the campaign card now watches: the moment the
   * server last said it was writing, replacing a ten-minute timer started at
   * approval that a resumed batch was always past.
   *
   * run_campaign() clears it when the server stops saying 'writing', which is
   * correct and can be an hour away — the sweep is hourly and a paused
   * campaign is polled on no other schedule.
   *
   * WITHOUT THIS LINE the value survives the pause. The card hides the
   * spinner anyway while paused, so nothing is visible until Resume — and
   * then a stale timestamp from before the pause makes the page claim it is
   * writing before the first poll has even happened. A spinner that is wrong
   * in the other direction is the same bug wearing the other hat. */
  const r = run(`
    seed_campaign('c1', 3, array(3, 10, 17));
    $all = IE_Campaigns::all();
    $all['c1']['writing_since'] = current_time('mysql');
    update_option('ie_campaigns', $all, false);

    IE_Publisher::pause('c1');

    $c = IE_Campaigns::get('c1');
    out(array(
      'status' => $c['status'],
      'writing_since' => isset($c['writing_since']) ? $c['writing_since'] : null,
    ));
  `);

  assert.strictEqual(r.status, 'paused');
  assert.strictEqual(r.writing_since, '',
    'pause left writing_since set — a resume would show a spinner before anything was writing');
});

test('THE CANCEL GOES BEFORE THE POSTS ARE HELD', () => {
  /* Holding walks every slot and calls wp_update_post on each. On a 52-post
   * campaign that is not instant, and every moment of it is potentially
   * another article written and charged. Order is the whole point, so it is
   * asserted rather than assumed from the reading order of the source. */
  const r = run(`
    seed_campaign('c1', 3, array(3, 10, 17));
    $GLOBALS['api_calls'] = array();
    $GLOBALS['hold_order'] = array();
    IE_Publisher::pause('c1');
    out(array('calls' => $GLOBALS['api_calls'], 'log' => $GLOBALS['log']));
  `);

  assert.ok(r.calls.length >= 1, 'no API call was made at all');
  assert.strictEqual(r.calls[0].cancel, true,
    'something else happened before the cancel was sent');
});

test('A FAILED CANCEL DOES NOT ROLL BACK THE PAUSE', () => {
  /* The pause is local and has already happened. Undoing it because a network
   * call failed would leave a campaign that the owner believes is stopped and
   * that WordPress will go on publishing from — the worse of the two
   * failures by a distance. The retry below is what covers the lost call. */
  const r = run(`
    seed_campaign('c1', 2, array(3, 10));
    $GLOBALS['api_fail'] = true;
    IE_Publisher::pause('c1');
    $c = IE_Campaigns::get('c1');
    out(array(
      'status' => $c['status'],
      'log'    => array_column(IE_Publisher::get_log(), 'message'),
    ));
  `);

  assert.strictEqual(r.status, 'paused', 'a network error undid the pause');
  assert.ok(r.log.join(' ').includes('could not tell the server to stop'),
    'the failure was swallowed without a word');
});

test('EVERY SWEEP RE-SENDS THE CANCEL WHILE THE CAMPAIGN STAYS PAUSED', () => {
  /* THE RETRY, and the reason pause() alone is not enough.
   *
   * Four facts have already been lost in this plugin to one-shot calls with
   * nothing behind them, and a lost cancel is the most expensive of them:
   * the failure mode is writing and charging for everything the owner just
   * said to stop.
   *
   * run_campaign() used to return before this on `'active' !== status`,
   * which is right for collecting and publishing and was wrong for the one
   * message that matters. */
  const r = run(`
    seed_campaign('c1', 2, array(3, 10));
    IE_Publisher::pause('c1');
    $GLOBALS['api_calls'] = array();
    $first  = IE_Publisher::run_campaign('c1');
    $second = IE_Publisher::run_campaign('c1');
    out(array('calls' => $GLOBALS['api_calls'], 'first' => $first, 'second' => $second));
  `);

  const cancels = r.calls.filter(c => c.cancel === true);

  assert.strictEqual(cancels.length, 2,
    'the sweep stopped re-sending the cancel — one lost request loses the campaign');
  assert.strictEqual(r.first.cancelSent, true);
  assert.strictEqual(r.second.skipped, true, 'a paused campaign was given work to do');
});

test('a paused campaign is still not collected or published', () => {
  /* The early return it replaces was doing a real job. A paused campaign must
   * send its cancel and then stop — not fall through into the collect and
   * publish steps below it, which is the obvious way to get this wrong. */
  const r = run(`
    seed_campaign('c1', 2, array(3, 10));
    IE_Publisher::pause('c1');
    $GLOBALS['api_calls'] = array();
    $out = IE_Publisher::run_campaign('c1');
    out(array('out' => $out, 'calls' => $GLOBALS['api_calls']));
  `);

  assert.strictEqual(r.out.skipped, true);
  assert.strictEqual(r.out.reason, 'campaign is paused');
  assert.strictEqual(r.calls.length, 1,
    'a paused campaign made more than the one call it is allowed');
});

test('AN ACTIVE CAMPAIGN NEVER SENDS A CANCEL', () => {
  /* The opposite failure, and the one that would be silent: a cancel sent on
   * an ordinary run would stop every batch the moment it started, and the
   * owner would see a campaign that writes one post and halts. */
  const r = run(`
    seed_campaign('c1', 2, array(3, 10));
    $GLOBALS['api_calls'] = array();
    IE_Publisher::run_campaign('c1');
    out(array('calls' => $GLOBALS['api_calls']));
  `);

  const writes = r.calls.filter(c => c.method === 'write');

  assert.ok(writes.length >= 1, 'an active campaign made no write call at all');
  assert.ok(writes.every(c => c.cancel === false),
    'an active campaign sent a cancel — every batch would stop after one post');
});

/* ------------------------------------------------------------------ *
 * Starting it again — the other half of the same pair
 *
 * The five cases above are all about pause telling the server something.
 * Resume told it nothing. It moved the dates, set the status, redirected,
 * and left the unwritten posts waiting for the next ping — so the screen
 * sat dead and "Check now", which is meant to be a fallback, was the only
 * thing that actually restarted the work.
 *
 * Every resume test in this file predates that and still passes, because
 * every one of them asks what resume does to WORDPRESS. seed_campaign()
 * sets no batch_started, so none of them is approved and none of them
 * polls. That is deliberate: the poll's guard is the approval, and tests
 * that set it are the ones below.
 * ------------------------------------------------------------------ */

test('RESUME TELLS THE SERVER TO CARRY ON, IMMEDIATELY', () => {
  /* The mirror of PAUSE TELLS THE SERVER TO STOP. Without this the posts
   * that had not been written yet wait for the hourly cron, and the owner
   * is looking at a page that gives no sign anything is happening. */
  const r = run(`
    seed_campaign('c1', 3, array(3, 10, 17));
    IE_Publisher::pause('c1');
    $GLOBALS['api_calls'] = array();
    IE_Publisher::resume('c1');
    out(array('calls' => $GLOBALS['api_calls']));
  `);

  assert.strictEqual(r.calls.length, 1,
    'resume did not contact the server — the remaining posts wait for the sweep');
  assert.strictEqual(r.calls[0].method, 'write');
  assert.strictEqual(r.calls[0].id, 'c1');
});

test('RESUME SENDS A POLL, NOT A CANCEL', () => {
  /* The opposite failure, and it would be invisible on the screen: a
   * cancel here would stop the batch resume had just restarted, and the
   * campaign would sit active with work pending and nothing writing. The
   * paused branch of run_campaign() sends cancels, so the order of the two
   * things resume does — status to active FIRST, poll second — is what
   * keeps this a poll. Asserted, because reading the source cannot tell
   * you which branch ran. */
  const r = run(`
    seed_campaign('c1', 3, array(3, 10, 17));
    IE_Publisher::pause('c1');
    $GLOBALS['api_calls'] = array();
    IE_Publisher::resume('c1');
    out(array('calls' => $GLOBALS['api_calls']));
  `);

  assert.ok(r.calls.length >= 1, 'no call was made at all');
  assert.ok(r.calls.every(c => c.cancel === false),
    'resume sent a cancel — it stopped the batch it had just restarted');
});

test('THE POLL IS WHAT SETS writing_since, SO THE SPINNER APPEARS', () => {
  /* THE REASON IT GOES THROUGH run_campaign() AND NOT IE_Api::write().
   *
   * writing_since is what the card watches, and it is stamped from the
   * server's reply inside run_campaign(). Calling the API directly would
   * start the batch and still leave the screen silent — the same dead page
   * with one more request behind it.
   *
   * pause() clears writing_since, so a value here cannot be left over. */
  const r = run(`
    seed_campaign('c1', 3, array(3, 10, 17));
    IE_Publisher::pause('c1');

    $paused = IE_Campaigns::get('c1');
    IE_Publisher::resume('c1');
    $after = IE_Campaigns::get('c1');

    out(array(
      'before' => isset($paused['writing_since']) ? $paused['writing_since'] : null,
      'after'  => isset($after['writing_since']) ? $after['writing_since'] : null,
      'status' => $after['status'],
    ));
  `);

  assert.strictEqual(r.before, '', 'the pause did not clear writing_since');
  assert.ok(r.after, 'writing_since was never stamped — the card shows no spinner');
  assert.strictEqual(r.status, 'active');
});

test('AN UNAPPROVED CAMPAIGN IS RESUMED WITHOUT BEING CHARGED FOR', () => {
  /* THE GUARD, and the thing I got wrong when I planned this.
   *
   * pause() has no approval check — it refuses a finished campaign and
   * nothing else — so a campaign that was planned and never approved can
   * be paused and resumed like any other. run_campaign() on an active
   * campaign with pending slots does not ask whether anyone agreed to pay:
   * it posts to /api/blog/write, which starts a job and charges per post.
   *
   * So an unguarded poll here would turn Resume into "write all of this
   * now", at 75 credits a post, on a campaign whose own card is still
   * showing the price as a question. The release still has to happen —
   * resume's local job is unchanged. */
  const r = run(`
    seed_campaign('c1', 3, array(3, 10, 17));
    unapprove('c1');
    IE_Publisher::pause('c1');
    $GLOBALS['api_calls'] = array();
    $released = IE_Publisher::resume('c1');
    $c = IE_Campaigns::get('c1');
    out(array(
      'calls'    => $GLOBALS['api_calls'],
      'released' => $released,
      'status'   => $c['status'],
    ));
  `);

  assert.strictEqual(r.calls.length, 0,
    'an unapproved campaign was written and charged for by pressing Resume');
  assert.strictEqual(r.released, 3, 'the posts were not put back on the schedule');
  assert.strictEqual(r.status, 'active');
});

test('A FAILED POLL DOES NOT FAIL THE RESUME', () => {
  /* The same rule the pause side already has, in the same direction. The
   * posts are already back on the schedule: that happened locally, before
   * this, and a network error must not undo it. The campaign is left
   * active with work pending, which is precisely what the sweep collects —
   * so the cost of the lost request is a delay, not a stuck campaign. */
  const r = run(`
    seed_campaign('c1', 2, array(3, 10));
    IE_Publisher::pause('c1');
    $GLOBALS['api_fail'] = true;
    $released = IE_Publisher::resume('c1');
    $c = IE_Campaigns::get('c1');
    out(array(
      'released'  => is_object($released) ? 'WP_Error' : $released,
      'status'    => $c['status'],
      'scheduled' => count(array_filter($GLOBALS['posts'], function ($p) {
        return 'future' === $p['post_status'];
      })),
      'log' => array_column(IE_Publisher::get_log(), 'message'),
    ));
  `);

  assert.strictEqual(r.released, 2,
    'a network error turned resume into an error and the owner sees it as a failed resume');
  assert.strictEqual(r.status, 'active', 'a failed poll left the campaign paused');
  assert.strictEqual(r.scheduled, 2, 'the posts were not released');
  assert.ok(r.log.join(' ').includes('the server could not be reached'),
    'the failure was swallowed without a word');
});

test('RESUMING A CAMPAIGN THAT IS NOT PAUSED CONTACTS NOBODY', () => {
  /* resume() returns 0 for a campaign that is not paused, and has since it
   * was written. The poll must sit behind that return, not in front of it:
   * a Resume link followed twice, or pressed from a stale tab, would
   * otherwise fire a second write at the server for no reason. */
  const r = run(`
    seed_campaign('c1', 2, array(3, 10));
    $GLOBALS['api_calls'] = array();
    $out = IE_Publisher::resume('c1');
    out(array('out' => $out, 'calls' => $GLOBALS['api_calls']));
  `);

  assert.strictEqual(r.out, 0);
  assert.strictEqual(r.calls.length, 0,
    'resuming a running campaign poked the server anyway');
});

/* ------------------------------------------------------------------ *
 * Who is allowed to spend money — 6 October
 *
 * A campaign is 'active' from the moment it is created, before approval,
 * and all its slots are 'pending'. That is exactly the pair
 * campaigns_with_work() looks for, so a freshly planned campaign sat at
 * the top of the hourly cron's list — and run_campaign() posted it to
 * /api/blog/write, which starts a job and charges per post.
 *
 * Nothing asked whether anyone had agreed to pay. The server cannot ask
 * on our behalf: it has no approvedAt field, because calling that
 * endpoint IS the approval. Approval exists in one place in this system,
 * and run_campaign() is the gate in front of it.
 * ------------------------------------------------------------------ */

test('THE SWEEP WILL NOT WRITE A CAMPAIGN NOBODY APPROVED', () => {
  /* THE BUG, as it actually existed. Ten unapproved posts is 750 credits,
   * charged within the hour, while the campaign's own card still shows
   * the price as a question on a button nobody pressed. */
  const r = run(`
    seed_planned('c1', 10);
    $GLOBALS['api_calls'] = array();
    $out = IE_Publisher::run_campaign('c1');
    out(array('calls' => $GLOBALS['api_calls'], 'out' => $out));
  `);

  assert.strictEqual(r.calls.length, 0,
    'an unapproved campaign was sent to the server, which starts a job and charges');
  assert.strictEqual(r.out.skipped, true);
  assert.strictEqual(r.out.reason, 'campaign has not been approved');
});

test('AND IT IS NOT EVEN PUT IN THE QUEUE', () => {
  /* THE SECOND GUARD, AND IT IS NOT BELT-AND-BRACES — it stops a different
   * failure from the gate above.
   *
   * run_catch_up() deliberately does ONE campaign per run and takes
   * $pending[0]. A campaign that is listed and then refused downstream eats
   * the whole sweep in silence, so a single never-approved draft would sit
   * at the head of the queue for ever and every real campaign behind it
   * would stop being collected. The gate alone would have traded "charges
   * for work nobody approved" for "never collects anything again", which is
   * not a fix.
   *
   * campaigns_with_work() means posts still to COLLECT FROM THE SERVER. An
   * unapproved campaign has nothing to collect because nothing was written
   * for it, so excluding it is the function matching its own description. */
  const r = run(`
    seed_planned('c1', 5);           // planned, never approved — was first in the list
    seed_campaign('c2', 2, array(3, 10));
    $all = IE_Campaigns::all();
    $all['c2']['slots'][0]['status'] = 'pending';   // real work, waiting behind it
    update_option('ie_campaigns', $all, false);

    out(array('work' => IE_Campaigns::campaigns_with_work()));
  `);

  assert.ok(!r.work.includes('c1'),
    'an unapproved campaign is still queued — it will eat one sweep per hour for ever');
  assert.ok(r.work.includes('c2'),
    'the guard swallowed a campaign that genuinely has work');
  assert.strictEqual(r.work[0], 'c2',
    'the approved campaign is not at the head of the queue, so the sweep never reaches it');
});

test('THE QUEUE LISTS A CAMPAIGN WHOSE APPROVING CALL WAS LOST', () => {
  /* THE CASE THAT NEEDS BOTH WITNESSES HERE TOO, and it survived a mutation
   * run until this case existed.
   *
   * The owner presses approve and the response never arrives. approved_at is
   * stamped, batch_started is not — the server may well be writing, and this
   * site does not know. The gate in run_campaign() lets the sweep act on it.
   * But if the QUEUE only looked at batch_started, the sweep would never be
   * handed the campaign in the first place, so the gate would never be
   * reached and nothing would arrive until the owner found "Check now" by
   * themselves.
   *
   * Which is the resume bug exactly: a fallback button as the only thing
   * that works. Two guards have to agree about what "approved" means, or the
   * narrower one silently decides. */
  const r = run(`
    seed_planned('c1', 3);
    $GLOBALS['api_fail'] = true;
    IE_Publisher::run_campaign('c1', true);   // approved; the reply is lost
    $GLOBALS['api_fail'] = false;

    $c = IE_Campaigns::get('c1');
    out(array(
      'approved_at'   => isset($c['approved_at']) ? $c['approved_at'] : null,
      'batch_started' => isset($c['batch_started']) ? $c['batch_started'] : null,
      'work'          => IE_Campaigns::campaigns_with_work(),
    ));
  `);

  assert.ok(r.approved_at, 'the approval was not recorded at all');
  assert.ok(!r.batch_started, 'the fixture no longer reproduces a lost reply');
  assert.ok(r.work.includes('c1'),
    'the sweep will never pick this up — the posts only arrive if the owner presses Check now');
});

test('THE QUEUE STILL LISTS A CAMPAIGN APPROVED UNDER AN OLDER VERSION', () => {
  /* The same fleet problem as the gate's. Every campaign in flight today has
   * batch_started and no approved_at. Testing approved_at alone here would
   * have emptied the queue on every site at once — posts written and paid
   * for, never collected, and nothing on any screen to say why. */
  const r = run(`
    seed_planned('c1', 3);
    $all = IE_Campaigns::all();
    $all['c1']['batch_started'] = gmdate('Y-m-d H:i:s', time() - 86400);
    update_option('ie_campaigns', $all, false);
    out(array('work' => IE_Campaigns::campaigns_with_work()));
  `);

  assert.ok(r.work.includes('c1'),
    'a campaign approved before approved_at existed was dropped from the queue');
});

test('THE OWNER PRESSING THE BUTTON STILL STARTS IT', () => {
  /* The other half, and the reason this is a parameter rather than a flat
   * refusal. handle_run_now() is the approve button AND "Check now", and
   * both go through run_campaign(). A guard that could not tell the owner
   * from the cron would have broken approval altogether — the whole
   * product. */
  const r = run(`
    seed_planned('c1', 3);
    $GLOBALS['api_calls'] = array();
    $out = IE_Publisher::run_campaign('c1', true);
    out(array('calls' => $GLOBALS['api_calls'], 'out' => $out));
  `);

  assert.strictEqual(r.calls.length, 1, 'the approve button no longer starts anything');
  assert.strictEqual(r.calls[0].cancel, false);
  assert.ok(!r.out.skipped, 'the owner was refused');
});

test('APPROVAL IS RECORDED BEFORE THE REQUEST GOES OUT, NOT AFTER', () => {
  /* WHY THERE ARE TWO WITNESSES AND NOT ONE.
   *
   * batch_started is stamped from the SERVER'S reply. If the guard read
   * only that, a lost response on the approving call would leave the
   * server writing, this site unapproved, and the sweep refusing to poll
   * or collect for ever: a paid-for campaign whose posts never arrive.
   *
   * approved_at is what the owner did, recorded by their own site before
   * anyone is asked anything. Here the call fails outright and the record
   * must survive it. */
  const r = run(`
    seed_planned('c1', 3);
    $GLOBALS['api_fail'] = true;
    IE_Publisher::run_campaign('c1', true);
    $c = IE_Campaigns::get('c1');
    out(array(
      'approved_at'   => isset($c['approved_at']) ? $c['approved_at'] : null,
      'batch_started' => isset($c['batch_started']) ? $c['batch_started'] : null,
    ));
  `);

  assert.ok(r.approved_at,
    'a failed request lost the approval — the sweep would never touch this campaign again');
  assert.ok(!r.batch_started,
    'batch_started was stamped without the server ever confirming anything');
});

test('ONCE APPROVED, THE SWEEP CARRIES THE CAMPAIGN ON ITS OWN', () => {
  /* The guard must not turn into a permanent refusal. The automatic
   * collection is how posts arrive; "Check now" is a fallback and should
   * never be the only thing that works — the exact bug resume had. */
  const r = run(`
    seed_planned('c1', 3);
    $GLOBALS['api_fail'] = true;
    IE_Publisher::run_campaign('c1', true);   // the owner approves; the call fails
    $GLOBALS['api_fail'] = false;
    $GLOBALS['api_calls'] = array();
    $out = IE_Publisher::run_campaign('c1');  // the sweep, with no permission to start
    out(array('calls' => $GLOBALS['api_calls'], 'out' => $out));
  `);

  assert.strictEqual(r.calls.length, 1,
    'the sweep abandoned a campaign the owner had already approved');
  assert.ok(!r.out.skipped);
});

test('A CAMPAIGN APPROVED BEFORE approved_at EXISTED IS NOT STRANDED', () => {
  /* BACKWARD COMPATIBILITY, and it is not belt-and-braces. Every campaign
   * in flight across the fleet right now has batch_started and no
   * approved_at, because the field did not exist when they were approved.
   * Testing approved_at alone would have stopped all of them dead on the
   * next sweep — posts written and paid for, never collected. */
  const r = run(`
    seed_planned('c1', 3);
    $all = IE_Campaigns::all();
    $all['c1']['batch_started'] = gmdate('Y-m-d H:i:s', time() - 86400);
    update_option('ie_campaigns', $all, false);

    $GLOBALS['api_calls'] = array();
    $out = IE_Publisher::run_campaign('c1');
    out(array('calls' => $GLOBALS['api_calls'], 'out' => $out));
  `);

  assert.strictEqual(r.calls.length, 1,
    'a campaign approved under an older version was abandoned mid-flight');
  assert.ok(!r.out.skipped);
});

test('A REFUSAL FOR CREDITS CLEARS THE APPROVAL, SO IT CANNOT START ITSELF LATER', () => {
  /* A 402 is an ANSWER, not a lost message, and the difference decides
   * what approved_at should say afterwards. Left stamped, the sweep keeps
   * trying — and the moment the owner tops up for something else, a
   * campaign they never got to start writes itself an hour later. They
   * pressed the button once, were told no, and get to press it again
   * themselves. */
  const r = run(`
    seed_planned('c1', 3);
    $GLOBALS['api_402'] = true;
    $out = IE_Publisher::run_campaign('c1', true);
    $c = IE_Campaigns::get('c1');

    $GLOBALS['api_402'] = false;
    $GLOBALS['api_calls'] = array();
    $sweep = IE_Publisher::run_campaign('c1');

    out(array(
      'was_error'   => is_object($out),
      'approved_at' => isset($c['approved_at']) ? $c['approved_at'] : null,
      'calls'       => $GLOBALS['api_calls'],
      'sweep'       => $sweep,
    ));
  `);

  assert.strictEqual(r.was_error, true, 'the credits refusal was not reported as an error');
  assert.ok(!r.approved_at, 'the approval survived a refusal for money');
  assert.strictEqual(r.calls.length, 0,
    'the sweep started a campaign the server had already refused for credits');
  assert.strictEqual(r.sweep.reason, 'campaign has not been approved');
});

test('A PAUSED CAMPAIGN STILL SENDS ITS CANCEL, APPROVED OR NOT', () => {
  /* THE ORDER OF THE TWO GUARDS, and the asymmetry is deliberate.
   *
   * The approval gate sits AFTER the paused branch. If it ever wrongly
   * judged a campaign unapproved, blocking its cancel would mean writing
   * and charging for a batch the owner had stopped — the 825-credit
   * failure, again. Blocking a START costs an hour's delay. Only one of
   * those two mistakes is recoverable, so the cancel goes first. */
  const r = run(`
    seed_campaign('c1', 2, array(3, 10));
    unapprove('c1');
    IE_Publisher::pause('c1');
    $GLOBALS['api_calls'] = array();
    $out = IE_Publisher::run_campaign('c1');
    out(array('calls' => $GLOBALS['api_calls'], 'out' => $out));
  `);

  assert.strictEqual(r.calls.length, 1,
    'an unapproved paused campaign could not tell the server to stop');
  assert.strictEqual(r.calls[0].cancel, true);
  assert.strictEqual(r.out.reason, 'campaign is paused');
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');

fs.rmSync(tmp, { recursive: true, force: true });
process.exit(failed === 0 ? 0 : 1);
