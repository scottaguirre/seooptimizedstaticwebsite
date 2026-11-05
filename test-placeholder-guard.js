// test-placeholder-guard.js
//
//   node test-placeholder-guard.js
//
// The check that a finished site has no {{PLACEHOLDERS}} left in it.
//
// WHAT IT IS GUARDING AGAINST. On 4 November a generated site shipped with
// "Address: {{ADDRESS_FULL}}" across the hero bar. The build reported
// success. Thirty-odd suites were green. It was found by looking at the page.
//
// THE FAILURE MODE HAS A SHAPE, AND IT IS NOT "THROWS". The templates are
// read from disk on every build; the builders are require()d once when the
// server starts. A running server therefore pairs a NEW template with an OLD
// builder, and a placeholder the builder has never heard of passes straight
// through as text. Text renders. Nothing errors.
//
// So the tests here are about the two ways a guard like this dies:
//
//   it misses the thing it exists for   — the cases below that must FAIL
//   it fires on something harmless      — the cases that must PASS
//
// The second kills it faster than the first. A check that cries wolf on its
// own documentation gets commented out within a week, and both of its false
// positives were real: a PNG containing the bytes "{{", and a CSS comment in
// style7.css that quotes {{LOGO_WIDTH}} while explaining what the template
// writes.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { checkPlaceholders } = require('./utils/checkPlaceholders');

let passed = 0;
const failures = [];

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failures.push(name); }
}

/** A throwaway dist folder: { 'index.html': '...' } -> a real directory. */
function site(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ph-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

const names = r => [...new Set(r.problems.map(p => p.name))].sort();


/* =====================================================================
 * IT MUST CATCH
 * ================================================================== */

console.log('\nIT MUST CATCH\n');

test('the exact bug of 4 November', () => {
  const r = checkPlaceholders(site({
    'index.html': '<p>Address: {{ADDRESS_FULL}}</p>',
  }));

  assert.strictEqual(r.ok, false, 'an unfilled placeholder was not reported');
  assert.deepStrictEqual(names(r), ['ADDRESS_FULL']);
});

test('a placeholder on a page other than the home page', () => {
  const r = checkPlaceholders(site({
    'index.html': '<p>All good here</p>',
    'water-heater-repair/index.html': '<p>{{SECTION2_P1}}</p>',
  }));

  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.problems[0].file, path.join('water-heater-repair', 'index.html'));
});

test('a placeholder in a real CSS declaration', () => {
  const r = checkPlaceholders(site({
    'css/index.css': '.logo { width: {{LOGO_WIDTH}}px; }',
  }));

  assert.strictEqual(r.ok, false, 'CSS is served to the customer too');
});

test('several on one line are all reported', () => {
  const r = checkPlaceholders(site({
    'index.html': '<p>{{PHONE_DISPLAY}} — {{EMAIL}}</p>',
  }));

  assert.strictEqual(r.problems.length, 2);
  assert.deepStrictEqual(names(r), ['EMAIL', 'PHONE_DISPLAY']);
});

test('whitespace inside the braces does not hide one', () => {
  const r = checkPlaceholders(site({ 'index.html': '<p>{{ ADDRESS }}</p>' }));
  assert.strictEqual(r.ok, false);
});

/* THE LINE NUMBER HAS TO BE THE REAL ONE. Comments are blanked rather than
 * deleted precisely so this stays true — deleting them shifts every line
 * after and sends whoever is debugging to the wrong part of the file. */
test('the reported line number survives a comment above it', () => {
  const r = checkPlaceholders(site({
    'index.html': [
      '<!--',
      '  a comment that mentions {{ADDRESS_FULL}} while explaining things',
      '  and runs on for a few lines',
      '-->',
      '<p>{{PHONE_DISPLAY}}</p>',
    ].join('\n'),
  }));

  assert.strictEqual(r.problems.length, 1, 'the comment should not count');
  assert.strictEqual(r.problems[0].line, 5,
    `reported line ${r.problems[0].line}; the placeholder is on line 5`);
});


/* =====================================================================
 * IT MUST NOT FIRE
 * ---------------------------------------------------------------------
 * Every case here was found in a real build, not imagined.
 * ================================================================== */

console.log('\nIT MUST NOT FIRE\n');

test('a finished site is clean', () => {
  const r = checkPlaceholders(site({
    'index.html': '<h1>Leander Concrete</h1><p>1800 Sequoia Dr, Leander, TX</p>',
    'css/index.css': '.hero { color: #fff; }',
  }));

  assert.strictEqual(r.ok, true, r.text);
});

/* style7.css carries this today: a comment explaining that the template
 * writes <img width="{{LOGO_WIDTH}}">. It is documentation, it is not
 * rendered, and a guard that fails the build over it would be switched off. */
test('a CSS comment quoting a placeholder', () => {
  const r = checkPlaceholders(site({
    'css/index.css':
      '/* the template writes <img width="{{LOGO_WIDTH}}" height="{{LOGO_HEIGHT}}"> */\n' +
      '.logo { max-height: 72px; }',
  }));

  assert.strictEqual(r.ok, true, r.text);
});

test('an HTML comment quoting a placeholder', () => {
  const r = checkPlaceholders(site({
    'index.html': '<!-- {{ADDRESS_FULL}} is filled by fullAddress.js -->\n<p>Done</p>',
  }));

  assert.strictEqual(r.ok, true, r.text);
});

/* assets/logo.png and assets/hero-1.webp in the dist folder both contain the
 * bytes "{{". Reading them as UTF-8 and pattern-matching is meaningless. */
test('binary assets are not searched', () => {
  const dir = site({ 'index.html': '<p>fine</p>' });
  fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'assets', 'logo.png'),
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x7b, 0x7b, 0x41, 0x7d, 0x7d, 0xff]));

  assert.strictEqual(checkPlaceholders(dir).ok, true);
});

/* LOWER CASE IS NOT THIS APP'S SHAPE. Every placeholder it writes is
 * {{SHOUTED_WITH_UNDERSCORES}}. Matching any {{...}} would fail builds over
 * a customer's pasted content or a handlebars snippet in a review. */
test('lower-case braces in customer content', () => {
  const r = checkPlaceholders(site({
    'index.html': '<p>Our pricing uses the {{cost}} formula, as the sign says.</p>',
  }));

  assert.strictEqual(r.ok, true, r.text);
});

test('a single brace is not a placeholder', () => {
  const r = checkPlaceholders(site({ 'index.html': '<p>{ADDRESS} and {{ADDRESS</p>' }));
  assert.strictEqual(r.ok, true, r.text);
});

test('a missing dist folder is not a failure', () => {
  const r = checkPlaceholders(path.join(os.tmpdir(), 'definitely-not-here-' + Date.now()));
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.filesScanned, 0);
});


/* =====================================================================
 * THE REPORT IS THE WHOLE POINT
 * ---------------------------------------------------------------------
 * Whoever reads this is looking at a build that just failed. The message
 * has to say where to look and what to try first.
 * ================================================================== */

console.log('\nTHE REPORT\n');

test('it names the file, the line and the placeholder', () => {
  const r = checkPlaceholders(site({
    'index.html': '<p>x</p>\n<p>Address: {{ADDRESS_FULL}}</p>',
  }));

  assert.ok(r.text.includes('index.html'), 'the file is not named');
  assert.ok(r.text.includes('line 2'), 'the line is not named');
  assert.ok(r.text.includes('{{ADDRESS_FULL}}'), 'the placeholder is not named');
});

test('it names the cause that produced it the first time', () => {
  const r = checkPlaceholders(site({ 'index.html': '<p>{{ADDRESS_FULL}}</p>' }));

  assert.ok(/restart/i.test(r.text),
    'the report does not mention restarting — a stale server is the usual ' +
    'cause and the one that cost a morning');
});

test('a clean build says how many files it looked at', () => {
  const r = checkPlaceholders(site({ 'index.html': '<p>fine</p>' }));

  assert.ok(/1 file/.test(r.text),
    'a check that passes silently cannot be distinguished from one that ' +
    'never ran');
});


/* =====================================================================
 * IT IS WIRED IN, AND IT THROWS
 * ================================================================== */

console.log('\nIT IS WIRED IN\n');

/* `await chargeCredits(`, NOT `chargeCredits(`.
 *
 * The bare name appears in the comment block ABOVE the check, explaining
 * that the check runs before it — so searching for it found the comment
 * first and this test reported the opposite of the truth about code that was
 * correct. It is the same mistake as asserting on a function's whole file
 * instead of its body: the text you are looking for is also the text you
 * wrote about it. */
const CHARGE_CALL = 'await chargeCredits(';

test('runGeneration calls it, and before charging the customer', () => {
  const src = fs.readFileSync(path.join(__dirname, 'utils/runGeneration.js'), 'utf8');

  const call = src.indexOf('const placeholders = checkPlaceholders(distDir);');
  const charge = src.indexOf(CHARGE_CALL);

  assert.ok(call !== -1, 'runGeneration.js never runs the check');
  assert.ok(charge !== -1, 'chargeCredits has moved; this test needs updating');
  assert.ok(call < charge,
    'the check runs AFTER the customer is charged, so they pay for a site ' +
    'with raw placeholders on it');
});

test('it throws rather than warning', () => {
  const src = fs.readFileSync(path.join(__dirname, 'utils/runGeneration.js'), 'utf8');
  const after = src.slice(src.indexOf('const placeholders = checkPlaceholders(distDir);'));
  const block = after.slice(0, after.indexOf(CHARGE_CALL));

  assert.ok(/throw new Error/.test(block),
    'the result is not thrown. The neighbouring structure check warns on ' +
    'purpose; this one must not, or a broken page ships with a line in a log.');
});

/* THE CHECKER MUST NOT BE SWALLOWED. Its neighbour is wrapped in try/catch
 * so a bug in it cannot fail a build. That is right for a warning and wrong
 * here: a check that cannot run has not passed. */
test('the call is not inside a try/catch', () => {
  const src = fs.readFileSync(path.join(__dirname, 'utils/runGeneration.js'), 'utf8');
  const call = src.indexOf('const placeholders = checkPlaceholders(distDir);');
  assert.ok(call !== -1, 'the call has been renamed; this test needs updating');

  // Walk back to the nearest enclosing brace and confirm it is not a catch.
  const before = src.slice(0, call);
  const lastTry = before.lastIndexOf('try {');
  const lastCatch = before.lastIndexOf('} catch');

  assert.ok(lastCatch > lastTry,
    'the placeholder check sits inside a try block — a failure to run would ' +
    'be swallowed and the build would go on to charge the customer');
});


/* ---------------------------------------------------------------------- */

if (failures.length) {
  console.error(`\n  ${failures.length} failed: ${failures.join(', ')}\n`);
  process.exit(1);
}

console.log(`\n${passed} passed, 0 failed\n`);
