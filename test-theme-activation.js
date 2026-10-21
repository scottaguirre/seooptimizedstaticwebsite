// test-theme-activation.js
//
// What theme activation is allowed to overwrite.
//
// THE BUG THIS FILE EXISTS FOR — 20 October 2026.
//
// Edwin generated a site, exported it as a WordPress theme, and put it live.
// A week later his social profiles went live, so he typed the six URLs into
// Theme Settings and saved. They stored correctly.
//
// The settings page also carries a button, "Re-import content from theme",
// which calls <prefix>_activate(). Activation seeds the settings blob from
// the generated model with:
//
//     update_option( ..., array_merge( $existing, $model['global'] ) );
//
// array_merge lets the SECOND array win, so every key the model carries
// overwrites what is stored — INCLUDING the keys the model carries as an
// empty string because they were blank at export. One press of that button
// and his six URLs are gone, with a green success notice.
//
// The comment above that line read: "Imported values win on first
// activation; later edits are preserved because activation only runs when
// the theme is switched on." That was true when it was written and is not
// true now — the button re-runs activation on demand, and so does switching
// themes away and back.
//
// IT IS NOT ONLY THE SOCIALS. phone, email, address, the business name, the
// SMTP block: anything edited after export and blank in the model is in the
// same position. The settings page's own save already understands this —
// its comment explains at length why it merges rather than replaces, for
// exactly this reason, about the logo. Activation never learned it.
//
// THE TESTS RUN THE GENERATED PHP rather than reading it. A regex over the
// source would pass on `array_merge($model['global'], $existing)` written
// the wrong way round in a later edit; running it cannot.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let passed = 0;
let failed = 0;

const queue = [];
function test(name, fn) {
  queue.push(() => Promise.resolve().then(fn)
    .then(() => { console.log(`  ok    ${name}`); passed++; })
    .catch(err => { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }));
}
function section(n) { queue.push(async () => console.log(`\n${n}\n`)); }

/* -------------------------------------------------------------------------
 * Is there a PHP to run?
 *
 * SKIPPED, NOT FAILED, WHEN THERE IS NOT. Edwin's Mac has no php, and
 * deploy.sh runs the whole suite list before it sends anything — so a hard
 * requirement here blocks every deploy from that machine. Every other
 * php-dependent suite in this project already skips this way, and
 * deploy.sh wraps the wp-plugin/*.php list in `command -v php` for the
 * same reason. I added this file without the guard and it stopped a
 * deploy on the first run.
 *
 * ASSERTING ON THE GENERATOR SOURCE INSTEAD IS NOT AN OPTION. The point of
 * this suite is that the merge is RUN; a regex over the source would pass
 * on `array_merge` written back the wrong way round, which is the bug.
 * ---------------------------------------------------------------------- */

const phpCheck = spawnSync('php', ['-v'], { encoding: 'utf8' });
if (phpCheck.error) {
  console.log('\ntest-theme-activation: php is not on PATH — skipping.');
  console.log('This suite runs the generated activation code as real PHP.');
  console.log('');
  console.log('0 passed, 0 failed');
  process.exit(0);
}

const { generateThemeActivationPhp } = require('./utils/wpThemeBuilder/generators/themeActivationPhp');

/* EVERY WARNING SHOWN, AND SHOWN ON STDERR.
 *
 * execFileSync throws when PHP exits non-zero, but a Warning does not
 * change the exit code — and this container's php.ini has display_errors
 * OFF, so the warning went nowhere at all. Dropping the is_array() guard
 * on the model therefore survived a suite that claimed to fail on any
 * stderr output: there was none to fail on.
 *
 * display_errors=stderr puts it where this harness can see it, and keeps
 * it out of the JSON on stdout that these tests parse. */
const PHP_STRICT = ['-d', 'error_reporting=E_ALL', '-d', 'display_errors=stderr'];

/**
 * Run PHP, and treat ANYTHING on stderr as a failure.
 *
 * spawnSync rather than execFileSync, because execFileSync returns only
 * stdout — so the stderr this is all about was piped into a variable
 * nothing read. The comment above claimed warnings were caught while the
 * code quietly ignored them, which is its own small version of the bug
 * this file exists for.
 */
function runPhp(args) {
  const run = spawnSync('php', args, { encoding: 'utf8' });

  if (run.error) throw run.error;

  if (run.stderr && run.stderr.trim()) {
    throw new Error(`PHP wrote to stderr, which a theme activation must never do:\n        ${run.stderr.trim()}`);
  }

  if (0 !== run.status) {
    throw new Error(`php exited ${run.status}: ${run.stdout}`);
  }

  return run.stdout;
}

/* ------------------------------------------------------------------ php */

/**
 * Run the generated activation PHP's settings merge, for real.
 *
 * ONLY THE MERGE. _activate() imports pages, builds menus and sets theme
 * mods; stubbing all of that would be a test of the stubs. The merge is
 * lifted into its own function in the generator precisely so it can be
 * called on its own — a pure function of two arrays, which is what it is.
 *
 * @param {object} stored    what the option already holds
 * @param {object} incoming  what the model carries
 * @returns {object} what would be written back
 */
function merge(stored, incoming) {
  const php = generateThemeActivationPhp({ themeSlug: 'local-business-theme' });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-activation-'));
  const file = path.join(dir, 'activation.php');

  /* THE STUBS ARE THE TWO FUNCTIONS THE FILE CALLS AT LOAD, and nothing
   * else: add_action twice. Everything beyond that is a function
   * definition, so the file loads without WordPress. */
  const harness = `<?php
function add_action() {}
function add_filter() {}
function __( $s, $d = '' ) { return $s; }
define( 'ABSPATH', '/' );
${php.replace(/^<\?php/, '')}

$stored   = json_decode( file_get_contents( $argv[1] ), true );
$incoming = json_decode( file_get_contents( $argv[2] ), true );

echo json_encode( local_business_theme_merge_global_settings( $stored, $incoming ) );
`;

  fs.writeFileSync(file, harness);
  fs.writeFileSync(path.join(dir, 'stored.json'), JSON.stringify(stored));
  fs.writeFileSync(path.join(dir, 'incoming.json'), JSON.stringify(incoming));

  /* STDERR IS A FAILURE, NOT NOISE.
   *
   * Dropping the is_array() guard on the model lets foreach run over a
   * string — which in PHP 8 is a Warning, not a fatal, so the merge still
   * returns and every assertion below still passed. Mutation caught that.
   *
   * A warning is not harmless here: this runs during theme activation, and
   * this project already has a case on record of a PHP notice printed into
   * a redirect blanking an admin screen. So anything on stderr fails. */
  const out = runPhp([...PHP_STRICT, file,
    path.join(dir, 'stored.json'), path.join(dir, 'incoming.json')]);

  fs.rmSync(dir, { recursive: true, force: true });

  return JSON.parse(out);
}

/**
 * The same merge, reached through ${p}_activate() as WordPress reaches it.
 *
 * THE WIRING, AND IT IS THE WHOLE POINT OF THIS SECOND HARNESS. The merge
 * can be perfect and activation can still call array_merge beside it —
 * mutation put the old line back and every test above stayed green, which
 * is the eighth time this project has met that shape.
 *
 * update_option records and then THROWS, so activation stops the instant
 * the settings are written. Everything after it imports pages and builds
 * menus, and stubbing that would be a test of the stubs.
 */
function viaActivate(stored, incomingGlobal) {
  const php = generateThemeActivationPhp({ themeSlug: 'local-business-theme' });

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ie-activate-'));
  const file = path.join(dir, 'activation.php');

  fs.writeFileSync(
    path.join(dir, 'theme-content-model.php'),
    `<?php return ${phpLiteral({ global: incomingGlobal, pages: [] })};`
  );

  const harness = `<?php
function add_action() {}
function add_filter() {}
function __( $s, $d = '' ) { return $s; }
function get_template_directory() { return __DIR__; }
function wp_parse_args( $a, $d ) { return array_merge( $d, (array) $a ); }
function get_option( $k, $default = false ) { return json_decode( file_get_contents( __DIR__ . '/stored.json' ), true ); }

class IE_Stop extends Exception { public $value; }

function update_option( $k, $v ) {
    $e = new IE_Stop( 'stop' );
    $e->value = $v;
    throw $e;
}

define( 'ABSPATH', '/' );
${php.replace(/^<\?php/, '')}

try {
    local_business_theme_activate();
    echo 'null';
} catch ( IE_Stop $e ) {
    echo json_encode( $e->value );
}
`;

  fs.writeFileSync(file, harness);
  fs.writeFileSync(path.join(dir, 'stored.json'), JSON.stringify(stored));

  const out = runPhp([...PHP_STRICT, file]);

  fs.rmSync(dir, { recursive: true, force: true });

  return JSON.parse(out);
}

/** A JS object as a PHP array literal. Strings only, which is all this needs. */
function phpLiteral(value) {
  if (null === value || undefined === value) return 'null';
  if (Array.isArray(value)) return `array(${value.map(phpLiteral).join(', ')})`;
  if ('object' === typeof value) {
    return `array(${Object.entries(value)
      .map(([k, v]) => `${JSON.stringify(String(k))} => ${phpLiteral(v)}`)
      .join(', ')})`;
  }
  return JSON.stringify(value);
}

/* ==================================================================== */

section('WHAT ACTIVATION MAY OVERWRITE');

test('A BLANK FROM THE MODEL DOES NOT ERASE WHAT THE OWNER TYPED', () => {
  /* EDWIN'S CASE, EXACTLY. He exported with no social profiles, so the
   * model carries six empty strings; a week later he typed the real URLs
   * into Theme Settings. Pressing "Re-import content from theme" used to
   * hand all six back as ''. */
  const out = merge(
    { social_facebook: 'https://www.facebook.com/EZLemonLawLawyerPhl', business_name: 'EZ Lemon Law' },
    { social_facebook: '', business_name: 'EZ Lemon Law' }
  );

  assert.strictEqual(out.social_facebook, 'https://www.facebook.com/EZLemonLawLawyerPhl',
    're-importing wiped a URL the owner entered after export');
});

test('BUT A REAL VALUE FROM THE MODEL STILL WINS', () => {
  /* The button's whole purpose is to put the generated content back. A
   * merge that never overwrote anything would be a button that does
   * nothing — the opposite mistake, and just as quiet. */
  const out = merge(
    { business_name: 'Typed by hand', phone: '(111) 111-1111' },
    { business_name: 'EZ Lemon Law Lawyer Philadelphia', phone: '(267) 930-5438' }
  );

  assert.strictEqual(out.business_name, 'EZ Lemon Law Lawyer Philadelphia',
    're-import no longer restores the generated content');
  assert.strictEqual(out.phone, '(267) 930-5438');
});

test('A KEY THE MODEL DOES NOT CARRY IS LEFT ALONE', () => {
  /* The logo is seeded at activation and has no field on the settings
   * page; the SMTP password has a field and is deliberately absent from
   * the model. Neither may be dropped by a merge. */
  const out = merge(
    { logo: '/assets/logo.png', smtp_pass: 'secret', logo_width: 250 },
    { business_name: 'EZ Lemon Law' }
  );

  assert.strictEqual(out.logo, '/assets/logo.png', 'the logo was dropped');
  assert.strictEqual(out.smtp_pass, 'secret', 'the SMTP password was dropped');
  assert.strictEqual(out.logo_width, 250, 'the logo width was dropped');
});

test('AND A KEY ONLY THE MODEL HAS IS ADDED', () => {
  /* A first activation has nothing stored at all, and a later export may
   * introduce a setting that did not exist before. Both arrive this way. */
  const out = merge({}, { business_name: 'EZ Lemon Law', google_map_cid: '8396527582829234927' });

  assert.strictEqual(out.business_name, 'EZ Lemon Law');
  assert.strictEqual(out.google_map_cid, '8396527582829234927');
});

test('EVEN WHEN WHAT THE MODEL HAS IS BLANK', () => {
  /* THE CASE TWO MUTANTS WALKED THROUGH. Written as "skip every blank from
   * the model", or as "treat every key as already stored", the guard is
   * indistinguishable from the real rule on every test above — because all
   * of them had something stored to protect.
   *
   * Here there is nothing to protect: the key does not exist yet. A first
   * activation of a site with no social profiles has to put the six empty
   * strings IN, or the settings page renders boxes for keys that are not
   * there and the next merge has nothing to recognise. */
  const out = merge({ business_name: 'EZ Lemon Law' }, { social_twitter: '', social_youtube: '' });

  assert.ok('social_twitter' in out, 'a blank the model introduced was dropped instead of stored');
  assert.strictEqual(out.social_twitter, '');
  assert.strictEqual(out.social_youtube, '');
  assert.strictEqual(out.business_name, 'EZ Lemon Law', 'the stored value was lost');
});

test('AN EMPTY STORED VALUE IS REPLACED BY A REAL ONE', () => {
  /* The guard is about not LOSING information, not about freezing the
   * first thing written. An empty string holds nothing to protect. */
  const out = merge({ phone: '' }, { phone: '(267) 930-5438' });

  assert.strictEqual(out.phone, '(267) 930-5438', 'a blank setting refused a real value');
});

test('AND NEITHER SIDE HAVING ANYTHING IS STILL EMPTY, NOT MISSING', () => {
  /* The settings page reads with isset(); a key that vanishes renders an
   * empty box either way, but a key that EXISTS and is empty survives the
   * next merge as a known blank rather than as an absence. */
  const out = merge({ social_twitter: '' }, { social_twitter: '' });

  assert.ok('social_twitter' in out, 'the key disappeared rather than staying empty');
  assert.strictEqual(out.social_twitter, '');
});

section('THE SHAPES WORDPRESS ACTUALLY HANDS IT');

test('A STORED VALUE THAT IS NOT AN ARRAY DOES NOT THROW', () => {
  /* get_option returns false when the row is missing, and the option has
   * been seen holding a string on sites where something else wrote it.
   * Activation runs at theme-switch time, where a fatal is a white screen
   * on a site that was working a moment ago. */
  for (const odd of [null, false, 'a string', 0]) {
    const out = merge(odd, { business_name: 'EZ Lemon Law' });
    assert.strictEqual(out.business_name, 'EZ Lemon Law', `broke on stored = ${JSON.stringify(odd)}`);
  }
});

test('AND NOR DOES A MODEL THAT CARRIES NOTHING', () => {
  for (const odd of [null, false, 'a string', 0]) {
    const out = merge({ social_facebook: 'https://x.test/a' }, odd);
    assert.strictEqual(out.social_facebook, 'https://x.test/a', `broke on incoming = ${JSON.stringify(odd)}`);
  }
});

test('A STORED ZERO IS A VALUE, NOT AN ABSENCE', () => {
  /* The trap in writing this guard with empty(): logo_width of 0 is
   * nonsense, but a setting that is the string "0" is not — and empty()
   * treats both as nothing. The rule has to be about an empty STRING. */
  const out = merge({ google_map_cid: '0' }, { google_map_cid: '' });

  assert.strictEqual(out.google_map_cid, '0', 'a stored "0" was treated as empty and overwritten');
});

section('AND ACTIVATION ACTUALLY USES IT');

test('RE-IMPORTING DOES NOT WIPE WHAT THE OWNER TYPED', () => {
  /* THE WIRING GAP, FOUND BY MUTATION FOR THE EIGHTH TIME IN THIS PROJECT.
   *
   * Every test above calls the merge directly. Putting the old
   * array_merge back inside ${p}_activate() left all of them green — two
   * correct halves and no wire, which is the exact shape of the bug this
   * file is named after.
   *
   * This drives the real ${p}_activate(), the way the "Re-import content
   * from theme" button does, and asserts on what update_option is handed. */
  const written = viaActivate(
    {
      social_facebook: 'https://www.facebook.com/EZLemonLawLawyerPhl',
      social_youtube: 'https://www.youtube.com/@EZLemonLawLawyerPhl',
      logo: '/assets/logo.png',
    },
    {
      business_name: 'EZ Lemon Law Lawyer Philadelphia',
      social_facebook: '',
      social_youtube: '',
    }
  );

  assert.strictEqual(written.social_facebook, 'https://www.facebook.com/EZLemonLawLawyerPhl',
    're-importing wiped a URL the owner entered after export');
  assert.strictEqual(written.social_youtube, 'https://www.youtube.com/@EZLemonLawLawyerPhl');

  assert.strictEqual(written.business_name, 'EZ Lemon Law Lawyer Philadelphia',
    're-import no longer restores the generated content');
  assert.strictEqual(written.logo, '/assets/logo.png', 'the logo was dropped');
});

/* ==================================================================== */

(async () => {
  for (const run of queue) await run();
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();
