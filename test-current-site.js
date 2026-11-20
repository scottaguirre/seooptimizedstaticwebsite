// test-current-site.js
//
// What the dashboard card says about the build sitting in dist/user_<id>.
//
//   node test-current-site.js
//
// REAL FOLDERS ON REAL DISK, like test-site-store.js and for the same
// reason: this module is a description of a directory, and a stubbed fs
// would make every test here a test of the stub.
//
//
// THE BUG THIS FILE EXISTS BECAUSE OF
//
// Edwin, 19 November, with seven live eleven-page sites behind it:
//
//     Your latest build — 2 pages · generated 14 hours ago
//
// getCurrentSite() read ONE LEVEL DEEP. The generator writes `about.html`
// and `contact.html` at the top, so a flat read was the whole truth for it.
// Local Website Options writes DIRECTORY-STYLE pages —
// `air-conditioner-repair/index.html`, served at `/air-conditioner-repair/`
// — so the top level holds `index.html` and `404.html`. Two.
//
//     A COUNT THAT MATCHES THE OLDER LAYOUT IS NOT A COUNT THAT IS
//     WRONG FOR THE NEWER ONE. IT IS A COUNT OF SOMETHING ELSE.
//
// It also read the business name out of `_src/content.json`, which that mode
// deliberately never writes — the third place in one afternoon that assumed
// a single builder, after capture() and rebuildJob.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const currentSite = require('./utils/currentSite');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

const temps = [];

function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'currentsite-'));
  temps.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of temps) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

function write(dir, rel, body) {
  const full = path.join(dir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, body);
}

/** A folder shaped the way renderSite() leaves one. */
function localOptionsBuild({ services = 6, source = {} } = {}) {
  const dir = tempDir();

  write(dir, 'index.html', '<h1>home</h1>');
  write(dir, '404.html', '<h1>not here</h1>');

  for (let i = 0; i < services; i += 1) {
    write(dir, path.join(`service-${i}`, 'index.html'), '<h1>service</h1>');
  }

  for (const fixed of ['contact', 'privacy-policy', 'terms-of-use', 'accessibility']) {
    write(dir, path.join(fixed, 'index.html'), '<h1>page</h1>');
  }

  write(dir, 'robots.txt', 'User-agent: *');
  write(dir, 'sitemap.xml', '<urlset/>');
  write(dir, path.join('assets', 'site.css'), 'body{}');
  write(dir, path.join('assets', 'hero-1.webp'), 'not really a webp');

  write(dir, path.join('_src', 'localoptions.json'), JSON.stringify({
    mode: 'localoptions',
    version: 1,
    business: { name: 'Cold Air Conditioning Austin', city: 'Austin', state: 'TX' },
    services: Array.from({ length: services }, (_, i) => ({ slug: `service-${i}` })),
    now: '2026-03-04T00:00:00.000Z',
    ...source,
  }, null, 2));

  return dir;
}

/* ===================================================================== */

section('COUNTING THE PAGES');

test('AN ELEVEN-PAGE SITE IS COUNTED AS ELEVEN, NOT TWO', () => {
  /* 1 home + 6 services + contact + 3 legal. The number the rest of the app
   * uses is TOTAL_PAGES in runLocalOptions.js, which is exactly this sum. */
  assert.strictEqual(currentSite.htmlPages(localOptionsBuild()).length, 11);
});

test('AND 404.html IS NOT ONE OF THEM', () => {
  /* Written by the build, served by the host, visited by nobody. Counting
   * it would put this card one above every other number in the app — "12
   * pages" for the mode that calls itself eleven-page. */
  const found = currentSite.htmlPages(localOptionsBuild());

  assert.ok(!found.includes('404.html'), '404.html was counted as a page');
  assert.ok(found.includes('index.html'), 'the home page went missing');
});

test('AND _src IS NOT WALKED, BECAUSE IT HOLDS WORDS AND NOT PAGES', () => {
  /* It is also the folder siteFiles.js refuses to publish, for the related
   * reason: a stored model served at /_src/content.json is the whole site's
   * copy, readable by anyone. */
  const dir = localOptionsBuild();
  write(dir, path.join('_src', 'leftover.html'), '<h1>not a page</h1>');

  assert.strictEqual(currentSite.htmlPages(dir).length, 11,
    'something inside _src was counted');
});

test('AND A FLAT GENERATOR BUILD STILL COUNTS THE SAME WAY', () => {
  /* The older layout, which the one-level read was right about. The walk
   * has to keep being right about it — this is the change's blast radius,
   * and every Rank Fast site is in it. */
  const dir = tempDir();

  write(dir, 'index.html', 'x');
  write(dir, 'about.html', 'x');
  write(dir, 'contact.html', 'x');
  write(dir, 'water-heater-repair.html', 'x');

  assert.strictEqual(currentSite.htmlPages(dir).length, 4);
});

test('AND A FOLDER OF IMAGES IS NOT A FOLDER OF PAGES', () => {
  const dir = tempDir();

  write(dir, 'index.html', 'x');
  write(dir, path.join('assets', 'hero.webp'), 'x');
  write(dir, path.join('assets', 'logo.png'), 'x');

  assert.deepStrictEqual(currentSite.htmlPages(dir), ['index.html']);
});

test('AND THE WALK IS BOUNDED, BECAUSE THIS RUNS ON EVERY DASHBOARD VIEW', () => {
  /* No build nests deeper than one folder. The floor is for a folder
   * somebody has pointed at something unexpected — a card that is one page
   * short beats a dashboard that walks a filesystem. */
  const dir = tempDir();

  write(dir, 'index.html', 'x');
  write(dir, path.join('a', 'b', 'c', 'd', 'e', 'f', 'deep.html'), 'x');

  assert.doesNotThrow(() => currentSite.htmlPages(dir));
  assert.ok(currentSite.htmlPages(dir).length < 2, 'the depth floor did not hold');
});

/* ===================================================================== */

section('READING THE BUSINESS OFF THE OTHER BUILDER\'S SOURCE');

/* THE DIST ROOT IS REDIRECTED INTO A TEMP FOLDER, so these tests never read
 * or describe the real dist/.
 *
 * THROUGH THE ENVIRONMENT, for the reason siteStore.storeRoot() records:
 * a const captured at module load cannot be redirected by assigning to the
 * export that looks like it. Without the override, getCurrentSite() builds
 * its own path from the user id and nothing below could reach it — which is
 * how the first draft of this section ended up asserting its own fixture.
 *
 *     A TEST THAT READS THE FILE IT JUST WROTE AND CHECKS THE
 *     CONTENTS IS A TEST OF JSON.parse. */
function asUser(dir) {
  const root = tempDir();
  const id = 'u1';

  fs.cpSync(dir, path.join(root, `user_${id}`), { recursive: true });
  process.env.DIST_ROOT = root;

  return id;
}

test('THE NAME AND THE PLACE COME FROM localoptions.json', () => {
  /* The card showed a BLANK name for every site this mode has ever built.
   * runLocalOptions.js says at the top of itself that it writes no
   * content.json, and this file went on asking for one. */
  const out = currentSite.getCurrentSite(asUser(localOptionsBuild()));

  assert.ok(out, 'no card was produced for a real build');
  assert.strictEqual(out.businessName, 'Cold Air Conditioning Austin');
  assert.strictEqual(out.location, 'Austin, TX',
    'the city and state are not joined the way the generator stores them');
});

test('AND THE DATE IS THE ONE THE BUILD WAS STAMPED WITH', () => {
  /* Not the file mtime, which is what this fell back to and which a copy,
   * a restore or a backup tool can move. */
  const out = currentSite.getCurrentSite(asUser(localOptionsBuild()));

  assert.strictEqual(out.generatedAt.toISOString(), '2026-03-04T00:00:00.000Z');
});

test('AND THE PAGE COUNT ON THE CARD IS ELEVEN', () => {
  /* The whole complaint, end to end rather than through the helper. */
  const out = currentSite.getCurrentSite(asUser(localOptionsBuild()));

  assert.strictEqual(out.pageCount, 11);
  assert.strictEqual(out.serviceCount, 6);
});

test('AND A USER WITH NO BUILD GETS NO CARD, RATHER THAN A THROW', () => {
  process.env.DIST_ROOT = tempDir();

  assert.strictEqual(currentSite.getCurrentSite('nobody'), null);
});

test('AND AN UNPARSEABLE `now` FALLS BACK INSTEAD OF FAILING', () => {
  /* A stamp nobody can read is not a reason to hide a build somebody can
   * still preview and download. */
  const out = currentSite.getCurrentSite(
    asUser(localOptionsBuild({ source: { now: 'not a date' } })));

  assert.ok(out, 'a bad date hid the card');
  assert.ok(!Number.isNaN(out.generatedAt.getTime()), 'the card carries an Invalid Date');
});

test('AND A CORRUPT SOURCE DOES NOT HIDE THE CARD', () => {
  /* The same rule the content.json branch already had: a build that cannot
   * be described is still a build somebody can preview and download. */
  const dir = localOptionsBuild();
  write(dir, path.join('_src', 'localoptions.json'), '{ not json');

  assert.strictEqual(currentSite.htmlPages(dir).length, 11,
    'a corrupt source file stopped the pages being counted');
});

/* ===================================================================== */

cleanup();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
