// test-pages-to-build.js
//
// How many pages does the progress bar think it is building?
//
// WHAT THIS IS GUARDING
//
// Edwin generated a one-page design sample and the progress bar read
// "About Us — 0 of 2". A sample writes exactly one page: runGeneration
// iterates `isSample ? {} : pages`, so the service pages are skipped. But the
// wizard still collects them on the step before and still posts them, and the
// route counted what was posted rather than what would be written.
//
// So the bar started one short of the truth and finished at "1 of 2" —
// stopping just before the end, on the one mode whose whole purpose is being
// shown to a prospective client.
//
// THE RISK THIS FILE EXISTS FOR
//
// A denominator is invisible when it is right and embarrassing when it is
// wrong, and nothing fails either way: the site builds, the credits are
// correct, only the number lies. The same mistake returns the moment a fourth
// mode is added and this sum is written out inline again.
//
//   node test-pages-to-build.js

const assert = require('assert');
const { pagesToBuild, MODES, FIXED_PAGES } = require('./utils/seoPresets');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}\n`); }

/* ===================================================================== */

section('A design sample is one page');

/* AND STILL ONE PAGE NOW THAT FULL SITES COUNT FOUR MORE. A sample writes
 * no contact page and no legal pages — runGeneration guards all four behind
 * `!isSample` — so the fixed four belong in the other branch only. Adding
 * them to the early return would put a sample's bar at 20% when it
 * finished. */

test('a sample with service pages entered still counts one', () => {
  /* The bug exactly. The wizard does not hide the Service Pages step for a
   * sample, so this is the ordinary case, not an edge. */
  assert.strictEqual(pagesToBuild(MODES.SAMPLE, { 0: { keyword: 'Drain Cleaning' } }, 0), 1);
});

test('a sample with several services and locations still counts one', () => {
  const pages = { 0: {}, 1: {}, 2: {}, 3: {} };
  assert.strictEqual(pagesToBuild('sample', pages, 5), 1);
});

test('a sample with nothing entered counts one', () => {
  assert.strictEqual(pagesToBuild('sample', {}, 0), 1);
});

/* ===================================================================== */

section('Every other mode counts what it writes');

test('a full site counts services, locations, home AND the fixed pages', () => {
  /* 3 services + 2 towns + home + contact + privacy + terms + accessibility.
   *
   * The fixed four were left out at first, on the reasoning that the total
   * should match what the customer is billed per page. It does not match
   * what gets WRITTEN, which is what a progress bar is about: Edwin's
   * dashboard climbed to 63 files against a total of 60 and he asked which
   * number was wrong. */
  assert.strictEqual(pagesToBuild('lead', { 0: {}, 1: {}, 2: {} }, 2), 3 + 2 + 1 + 4);
});

test('and the fixed pages are counted from the list, not from a 4', () => {
  /* The generator adds FIXED_PAGES.length to its counter. If this sum used
   * a literal instead, adding a fifth fixed page would move the counter and
   * not the total, and the bar would finish at 98%. */
  assert.strictEqual(
    pagesToBuild('lead', { 0: {}, 1: {}, 2: {} }, 2),
    3 + 2 + 1 + FIXED_PAGES.length
  );
});

test('the fixed list is the four pages every site gets', () => {
  /* Spelled out because two files count these: the route sets the total
   * from this list and runGeneration advances the counter by its length. A
   * page added here without a builder would leave every bar one short. */
  assert.deepStrictEqual(
    [...FIXED_PAGES].sort(),
    ['accessibility', 'contact', 'privacy-policy', 'terms-of-use']
  );
});

test('rank fast counts the same way as lead', () => {
  /* Only the SEO formats differ between them; both build every page. A
   * `siteMode === 'sample' ? 1 : …` written as a two-way check elsewhere in
   * this codebase silently flattened rankfast into lead. */
  const pages = { 0: {}, 1: {} };
  assert.strictEqual(pagesToBuild('rankfast', pages, 1), pagesToBuild('lead', pages, 1));
});

test('a site with no service pages still counts home and the fixed pages', () => {
  /* Zero would leave the bar dividing by zero and reading NaN. */
  assert.strictEqual(pagesToBuild('lead', {}, 0), 1 + FIXED_PAGES.length);
});

/* ===================================================================== */

section('Nothing posted is still a number');

test('missing pages are treated as none, not as a crash', () => {
  for (const nothing of [undefined, null, {}, []]) {
    assert.strictEqual(pagesToBuild('lead', nothing, 0), 1 + FIXED_PAGES.length,
      `${JSON.stringify(nothing)} did not count as zero service pages`);
  }
});

test('a nonsense location count cannot drag the total below one', () => {
  /* It arrives from a request. A negative total would render a bar that runs
   * backwards. */
  for (const bad of [-4, NaN, 'three', null, undefined]) {
    assert.ok(pagesToBuild('lead', {}, bad) >= 1,
      `locationCount ${JSON.stringify(bad)} produced ${pagesToBuild('lead', {}, bad)}`);
  }
});

test('an unknown mode is counted like a full site, not like a sample', () => {
  /* normalizeSiteMode falls back to the full build. Falling back to a sample
   * would under-count a real site, and the bar would claim it was finished
   * while pages were still being written. */
  assert.strictEqual(pagesToBuild('something-else', { 0: {}, 1: {} }, 0), 2 + 1 + FIXED_PAGES.length);
});

/* ===================================================================== */

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
