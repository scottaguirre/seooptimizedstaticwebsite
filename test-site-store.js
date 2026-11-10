// test-site-store.js
//
// What a published website needs kept so it can be rendered again.
//
//   node test-site-store.js
//
// REAL FILES ON REAL DISK, like test-cloudflare-sites' reader tests, because
// that is what this module is. A stubbed fs would make every test here a test
// of the stub, and the two things actually worth proving — that the images
// survive a wipe of dist/, and that a stale set does not linger — are both
// properties of the real syscalls.
//
//
// THE RULE THIS FILE EXISTS FOR
//
// Editing a site changes words, never image paths. But a re-render writes a
// FRESH dist/user_<id>, and `wrangler pages deploy` ships a directory as the
// whole site — a file absent from the folder is absent from the deployment.
//
//     THE PATHS STAYING CORRECT IS NOT THE SAME AS THE FILES BEING THERE.
//
// Without the copy these tests cover, an edit publishes a site whose <img>
// tags are all correct and all 404.

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const CM = require('./utils/contentModel');
const { writeRecipe, readRecipe, RECIPE_FILENAME } = require('./utils/buildRecipe');
const siteStore = require('./utils/cloudflareSites/siteStore');

let passed = 0, failed = 0;

async function test(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

/* ------------------------------------------------------------ scratch */

const temps = [];

function tempDir(prefix = 'sitestore-') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

function cleanup() {
  for (const dir of temps) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

/** A 24-hex id, because dirFor() refuses anything else — see below. */
const SITE_ID = 'a'.repeat(23) + '1';
const OTHER_ID = 'b'.repeat(23) + '2';

/** A build folder with the three things capture() looks for. */
function buildDir({ model = true, recipe = true, assets = ['hero.webp', 'logo.png'] } = {}) {
  const dir = tempDir();

  fs.writeFileSync(path.join(dir, 'index.html'), '<h1>hi</h1>');

  if (model) {
    const m = CM.createModel({ businessName: 'Acme', businessType: 'plumbing', location: 'Leander, TX' });
    CM.addPages(m, [{ slug: 'about', type: CM.PAGE_TYPES.ABOUT, sections: [] }]);
    CM.writeModel(dir, m);
  }

  if (recipe) {
    writeRecipe(dir, { global: { businessName: 'Acme', email: 'owner@example.com' }, pages: { 0: { keyword: 'leak repair' } } });
  }

  for (const [i, name] of assets.entries()) {
    fs.mkdirSync(path.join(dir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'assets', name), Buffer.from([0x89, 0x50, i]));
  }

  return dir;
}

/* THE STORE ROOT IS REDIRECTED INTO A TEMP FOLDER, so these tests never
 * write into the real builds/sites/.
 *
 * THROUGH THE ENVIRONMENT, AND THE FIRST VERSION OF THIS GOT IT WRONG. It
 * reassigned `siteStore.STORE_ROOT` and believed it had redirected the
 * module — but dirFor() closed over a module-level const, so every test
 * below wrote into the REAL builds/sites/ and fifteen of sixteen still
 * passed. The one that failed did so for a reason that had nothing to do
 * with its own assertion.
 *
 *     A SUITE THAT PASSES WHILE WRITING SOMEWHERE IT DID NOT INTEND
 *     IS A SUITE THAT IS TESTING SOMETHING ELSE.
 *
 * siteStore now reads the root per call, from SITE_STORE_ROOT. Asserted
 * below rather than assumed: redirectStore() checks the module agrees. */
const REAL_ROOT = siteStore.DEFAULT_ROOT;

function redirectStore() {
  const root = tempDir('sitestore-root-');
  process.env.SITE_STORE_ROOT = root;

  assert.strictEqual(siteStore.storeRoot(), root,
    'the store root was not redirected — these tests would write into builds/sites/');

  return root;
}

(async () => {

/* ===================================================================== */
section('THE RECIPE: WHAT THE WIZARD WAS ASKED FOR');

await test('IT ROUND-TRIPS, AND CARRIES THE CHECKBOXES THE MODEL CANNOT', () => {
  /* THE WHOLE REASON build.json EXISTS. A checkbox is a decision and
   * content.json records outcomes — an unticked price table and a trade that
   * is not allowed one look identical in the model. */
  const dir = tempDir();

  const body = {
    global: { businessName: 'Acme', showPricingTable: 'false', showReviews: 'on', useNearMe: 'true' },
    pages: { 0: { keyword: 'leak repair' }, 1: { keyword: 'drain cleaning' } },
  };

  writeRecipe(dir, body);

  const back = readRecipe(dir);

  assert.ok(back, 'the recipe did not read back');
  assert.deepStrictEqual(back.body, body);
  assert.strictEqual(back.body.global.showPricingTable, 'false');
});

await test('AND IT LANDS IN _src/, WHICH NEVER SHIPS', () => {
  /* siteFiles.js refuses to publish anything under _src/. That matters more
   * for this file than for content.json: the recipe carries the owner's
   * email address, and published it would sit at a guessable URL on their
   * own domain. */
  const dir = tempDir();
  writeRecipe(dir, { global: { email: 'owner@example.com' } });

  assert.ok(fs.existsSync(path.join(dir, '_src', RECIPE_FILENAME)),
    'the recipe is not in _src/');

  const { readSite } = require('./utils/cloudflareSites/siteFiles');
  fs.writeFileSync(path.join(dir, 'index.html'), 'x');

  const read = readSite(dir);
  assert.ok(read.ok, read.error);

  const leaked = Object.keys(read.files).filter(k => k.includes('build.json'));
  assert.deepStrictEqual(leaked, [], 'the build recipe reached the deploy');

  /* AND NOT BY ACCIDENT OF THE FILENAME. Asserted on the contents too,
   * because a file published under another name is the same leak. */
  for (const [name, buf] of Object.entries(read.files)) {
    assert.ok(!String(buf).includes('owner@example.com'),
      `the owner's email reached the deploy, in ${name}`);
  }
});

await test('A RECIPE FROM A SHAPE THIS BUILD DOES NOT KNOW IS REFUSED', () => {
  /* Absent means "generate normally", which merely costs money. A recipe
   * whose fields may mean something else would build a site from a
   * misunderstanding. */
  const dir = tempDir();
  writeRecipe(dir, { global: {} });

  const file = path.join(dir, '_src', RECIPE_FILENAME);
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));

  fs.writeFileSync(file, JSON.stringify({ ...parsed, version: 99 }));

  assert.strictEqual(readRecipe(dir), null);
});

await test('AND A MISSING ONE IS null, NOT A THROW', () => {
  assert.strictEqual(readRecipe(tempDir()), null);
  assert.strictEqual(readRecipe(path.join(os.tmpdir(), 'not-there-' + Date.now())), null);
});

/* ===================================================================== */
section('CAPTURE: KEEPING WHAT A RE-RENDER NEEDS');

await test('IT TAKES THE MODEL, THE RECIPE AND THE IMAGES', async () => {
  redirectStore();

  const dir = buildDir();
  const kept = await siteStore.capture(dir, SITE_ID);

  assert.ok(kept.ok, kept.error);
  assert.ok(kept.model, 'no model captured');
  assert.ok(kept.recipe, 'no recipe captured');
  assert.strictEqual(kept.assets.files, 2);
  assert.ok(kept.assets.bytes > 0);

  const stored = await siteStore.sizeOf(SITE_ID);
  assert.strictEqual(stored.files, 2, 'the images are not on disk');
});

await test('AND THE IMAGES SURVIVE dist BEING WIPED', async () => {
  /* THE POINT OF THE WHOLE MODULE. dist/user_<id> is one folder per user and
   * the next build of anything empties it. */
  redirectStore();

  const dir = buildDir({ assets: ['hero.webp'] });
  await siteStore.capture(dir, SITE_ID);

  fs.rmSync(dir, { recursive: true, force: true });

  const fresh = tempDir();
  const back = await siteStore.restoreAssets(SITE_ID, fresh);

  assert.strictEqual(back.had, true);
  assert.strictEqual(back.restored, 1);
  assert.ok(fs.existsSync(path.join(fresh, 'assets', 'hero.webp')),
    'the image did not come back into the fresh build folder');
});

await test('A BUILD WITH NO content.json IS REFUSED, AND SAYS WHY', async () => {
  /* Without the words there is nothing to edit, so capturing would store a
   * record promising an edit screen it cannot fill. */
  redirectStore();

  const kept = await siteStore.capture(buildDir({ model: false }), SITE_ID);

  assert.strictEqual(kept.ok, false);
  assert.match(kept.error, /content\.json/);
});

await test('BUT A MISSING RECIPE IS NOT FATAL — IT IS JUST NOT EDITABLE', async () => {
  /* A site published from a build made before build.json existed. The
   * capture succeeds; the caller sets editable:false from the null recipe.
   * Refusing outright would mean the images were never kept either. */
  redirectStore();

  const kept = await siteStore.capture(buildDir({ recipe: false }), SITE_ID);

  assert.strictEqual(kept.ok, true);
  assert.ok(kept.model);
  assert.strictEqual(kept.recipe, null);
  assert.strictEqual(kept.assets.files, 2, 'the images were not kept');
});

await test('AND A BUILD WITH NO assets/ CAPTURES CLEANLY', async () => {
  redirectStore();

  const kept = await siteStore.capture(buildDir({ assets: [] }), SITE_ID);

  assert.strictEqual(kept.ok, true);
  assert.strictEqual(kept.assets.files, 0);
});

await test('A SECOND CAPTURE REPLACES THE IMAGES RATHER THAN ADDING TO THEM', async () => {
  /* A site re-published after its images changed would otherwise keep both
   * sets, and the stale ones would go back up on every later re-render under
   * names nothing references — growing the folder and the deploy for ever. */
  redirectStore();

  await siteStore.capture(buildDir({ assets: ['old-1.webp', 'old-2.webp'] }), SITE_ID);
  await siteStore.capture(buildDir({ assets: ['new-1.webp'] }), SITE_ID);

  const stored = await siteStore.sizeOf(SITE_ID);
  assert.strictEqual(stored.files, 1, 'the previous build\'s images are still there');

  const fresh = tempDir();
  await siteStore.restoreAssets(SITE_ID, fresh);

  assert.deepStrictEqual(fs.readdirSync(path.join(fresh, 'assets')), ['new-1.webp']);
});

await test('AND ONE SITE\'S IMAGES ARE NOT ANOTHER\'S', async () => {
  redirectStore();

  await siteStore.capture(buildDir({ assets: ['a.webp'] }), SITE_ID);
  await siteStore.capture(buildDir({ assets: ['b.webp', 'c.webp'] }), OTHER_ID);

  assert.strictEqual((await siteStore.sizeOf(SITE_ID)).files, 1);
  assert.strictEqual((await siteStore.sizeOf(OTHER_ID)).files, 2);
});

/* ===================================================================== */
section('RESTORE: PUTTING THEM BACK');

await test('IT DOES NOT OVERWRITE AN IMAGE THE BUILD PRODUCED ITSELF', async () => {
  /* A re-render copies the predefined images itself; only uploads are
   * irrecoverable. A stored copy written over the top would be the same
   * bytes at best and a stale version at worst. */
  redirectStore();

  await siteStore.capture(buildDir({ assets: ['shared.webp', 'kept.webp'] }), SITE_ID);

  const fresh = tempDir();
  fs.mkdirSync(path.join(fresh, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(fresh, 'assets', 'shared.webp'), 'freshly built');

  const back = await siteStore.restoreAssets(SITE_ID, fresh);

  assert.strictEqual(back.restored, 1);
  assert.strictEqual(back.skipped, 1);
  assert.strictEqual(fs.readFileSync(path.join(fresh, 'assets', 'shared.webp'), 'utf8'),
    'freshly built', 'the stored copy overwrote the one this build made');
});

await test('AND A SITE WITH NOTHING KEPT SAYS SO RATHER THAN THROWING', async () => {
  /* Every site published before this existed. The caller needs to tell
   * "there are no stored images" from "there were none to restore". */
  redirectStore();

  const back = await siteStore.restoreAssets(SITE_ID, tempDir());

  assert.strictEqual(back.had, false);
  assert.strictEqual(back.restored, 0);
});

/* ===================================================================== */
section('FORGET: WHEN THE SITE GOES');

await test('IT REMOVES THAT SITE\'S FOLDER AND LEAVES THE OTHERS', async () => {
  redirectStore();

  await siteStore.capture(buildDir({ assets: ['a.webp'] }), SITE_ID);
  await siteStore.capture(buildDir({ assets: ['b.webp'] }), OTHER_ID);

  const gone = await siteStore.forget(SITE_ID);

  assert.strictEqual(gone.ok, true);
  assert.strictEqual((await siteStore.sizeOf(SITE_ID)).files, 0);
  assert.strictEqual((await siteStore.sizeOf(OTHER_ID)).files, 1,
    'forgetting one site took another site\'s images with it');
});

await test('AND FORGETTING A SITE THAT KEPT NOTHING IS NOT AN ERROR', async () => {
  redirectStore();
  assert.strictEqual((await siteStore.forget(SITE_ID)).ok, true);
});

/* ===================================================================== */
section('THE PATH IS BUILT FROM A CHECKED ID');

await test('A NON-ObjectId IS REFUSED, NOT INTERPOLATED', async () => {
  /* It is a Mongo ObjectId today and therefore hex. But this builds a
   * FILESYSTEM PATH out of it, and a path built from an identifier is a
   * traversal the first time that identifier comes from somewhere else.
   * `../../etc` is a string too. */
  for (const bad of ['../../etc', 'a/b', '', null, undefined, 'zzz', 'a'.repeat(23)]) {
    assert.throws(() => siteStore.dirFor(bad),
      /Refusing to build a store path/,
      `dirFor(${JSON.stringify(bad)}) did not refuse`);
  }

  assert.doesNotThrow(() => siteStore.dirFor(SITE_ID));
});

await test('AND THE REAL STORE ROOT SITS BESIDE builds/zips', () => {
  /* Asserted against the module's own default rather than the redirected
   * one, so a move shows up here rather than as a folder nobody can find. */
  assert.ok(/builds[\\/]sites$/.test(REAL_ROOT), `the store root is ${REAL_ROOT}`);

  /* AND THE DEFAULT IS WHAT YOU GET WITHOUT THE OVERRIDE, which is the half
   * that matters in production — a server with no SITE_STORE_ROOT set must
   * not quietly keep files in a temp folder. */
  const was = process.env.SITE_STORE_ROOT;
  delete process.env.SITE_STORE_ROOT;

  try {
    assert.strictEqual(siteStore.storeRoot(), REAL_ROOT);
  } finally {
    if (undefined !== was) process.env.SITE_STORE_ROOT = was;
  }
});

/* ===================================================================== */

cleanup();

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);

})().catch(err => { cleanup(); console.error(err); process.exit(1); });
