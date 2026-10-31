// test-local-options-heroes.js
//
// The four photographs, and what happens when they are not there.
//
// THE WHOLE POINT OF THIS SUITE IS THE MISSING CASE. Only `plumbing` has
// pictures. Every other trade points at a folder that does not exist, and
// the rule is that a site still builds: eleven pages of written, billed-for
// content must not be withheld because a decoration was absent.
//
// Built against a temporary directory rather than src/predefined-images, so
// the "no pictures at all" case can actually be tested — which it cannot be
// against a tree where plumbing exists.
//
//   node test-local-options-heroes.js

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  IMAGES_ROOT,
  heroNames,
  folderFor,
  altFor,
  coverFor,
  heroFiles,
  heroSet,
  setsIn,
  pickSet,
  completeSets,
  tradesWithImages,
} = require('./utils/localOptions/render/heroes');

const { HERO_COUNT } = require('./utils/localOptions/render/shape');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

function section(name) { console.log(`\n${name}\n`); }

/* ------------------------------------------------------- a fake image tree */

const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'localoptions-heroes-'));

/* plumbing: all four, plus alt text. */
fs.mkdirSync(path.join(ROOT, 'plumbing'), { recursive: true });
for (const name of heroNames()) {
  fs.writeFileSync(path.join(ROOT, 'plumbing', name), Buffer.from(`fake ${name}`));
}
fs.writeFileSync(path.join(ROOT, 'plumbing', 'alt.json'), JSON.stringify({
  cover: 4,
  1: 'A plumber beside an open service van',
  2: 'A plumber tightening a trap under a sink',
  3: 'New pipework under a vanity',
  4: 'A wrench on the supply lines',
}));

/* roofing: two of four, which is the half-finished case nobody plans for. */
fs.mkdirSync(path.join(ROOT, 'roofing'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'roofing', 'hero-1.webp'), Buffer.from('fake'));
fs.writeFileSync(path.join(ROOT, 'roofing', 'hero-3.webp'), Buffer.from('fake'));

/* electrical: the folder exists and is empty. */
fs.mkdirSync(path.join(ROOT, 'electrical'), { recursive: true });

/* hvac: no folder at all. */

/* alt.json that is not JSON. */
fs.mkdirSync(path.join(ROOT, 'locksmith'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'locksmith', 'alt.json'), 'not json {');

/* ------------------------------------------------------------------------ */

section('A TRADE WITH ALL FOUR');

test('all four come back, named for the assets folder', () => {
  const { files, found, missing } = heroFiles('plumbing', { root: ROOT });

  assert.strictEqual(found.length, HERO_COUNT);
  assert.deepStrictEqual(missing, []);
  assert.deepStrictEqual(Object.keys(files).sort(), [
    'assets/hero-1.webp', 'assets/hero-2.webp',
    'assets/hero-3.webp', 'assets/hero-4.webp',
  ]);
});

test('AS BUFFERS, so an image and a page travel through the same pipe', () => {
  /* writeSite() in cloudflare/deploy.js passes contents straight to
   * fs.writeFile, which takes a Buffer. A string would corrupt a .webp. */
  const { files } = heroFiles('plumbing', { root: ROOT });

  for (const body of Object.values(files)) {
    assert.ok(Buffer.isBuffer(body), 'an image came back as something other than bytes');
  }
});

test('and the trade name is matched case-insensitively', () => {
  assert.strictEqual(heroFiles('Plumbing', { root: ROOT }).found.length, HERO_COUNT);
  assert.strictEqual(heroFiles('  PLUMBING ', { root: ROOT }).found.length, HERO_COUNT);
});

/* ------------------------------------------------------------------------ */

section('A TRADE WITH NONE — THE CASE THIS FILE EXISTS FOR');

test('NO FOLDER AT ALL DOES NOT THROW', () => {
  /* Eleven pages of written, billed-for content must not be withheld
   * because a photograph was absent. */
  assert.doesNotThrow(() => heroFiles('hvac', { root: ROOT }));
});

test('it reports all four missing and returns no files', () => {
  const { files, found, missing } = heroFiles('hvac', { root: ROOT });

  assert.deepStrictEqual(Object.keys(files), []);
  assert.deepStrictEqual(found, []);
  assert.strictEqual(missing.length, HERO_COUNT);
});

test('an empty folder behaves the same as no folder', () => {
  const { found, missing } = heroFiles('electrical', { root: ROOT });

  assert.deepStrictEqual(found, []);
  assert.strictEqual(missing.length, HERO_COUNT);
});

test('and a missing trade name does not throw either', () => {
  assert.doesNotThrow(() => heroFiles('', { root: ROOT }));
  assert.doesNotThrow(() => heroFiles(undefined, { root: ROOT }));
});

/* ------------------------------------------------------------------------ */

section('A TRADE WITH SOME — THE HALF-FINISHED CASE');

test('THE TWO THAT EXIST ARE COPIED, the two that do not are named', () => {
  /* Nobody plans for this one. Somebody adds two pictures, gets
   * interrupted, and the next site built on that trade is silently a
   * two-picture site. It should still build, and the log should say which
   * two are absent. */
  const { files, found, missing } = heroFiles('roofing', { root: ROOT });

  assert.deepStrictEqual(found, ['hero-1.webp', 'hero-3.webp']);
  assert.deepStrictEqual(missing, ['hero-2.webp', 'hero-4.webp']);
  assert.deepStrictEqual(Object.keys(files).sort(),
    ['assets/hero-1.webp', 'assets/hero-3.webp']);
});

/* ------------------------------------------------------------------------ */

section('THE ALT TEXT BESIDE THE PICTURES');

test('it is read from alt.json', () => {
  const alt = altFor('plumbing', ROOT);

  assert.strictEqual(alt[1], 'A plumber beside an open service van');
  assert.strictEqual(Object.keys(alt).length, HERO_COUNT);
});

test('MISSING alt.json IS AN EMPTY OBJECT, NOT AN EXCEPTION', () => {
  /* An image with no alt text is a worse page. An exception here is no page
   * at all. */
  assert.deepStrictEqual(altFor('roofing', ROOT), {});
  assert.deepStrictEqual(altFor('hvac', ROOT), {});
});

test('AND SO IS alt.json THAT IS NOT JSON', () => {
  assert.doesNotThrow(() => altFor('locksmith', ROOT));
  assert.deepStrictEqual(altFor('locksmith', ROOT), {});
});

/* ------------------------------------------------------------------------ */

section('WHICH PICTURE REPRESENTS THE BUSINESS');

test('IT COMES FROM THE TRADE FOLDER, NOT FROM A NUMBER IN THE CODE', () => {
  /* THE BUG THIS EXISTS BECAUSE OF. schema.js said hero-1.webp, with a
   * comment explaining that hero-1 was the only one of the four taken
   * outdoors with the van. On 28 October the four plumbing pictures were
   * reordered — 1 and 4 swapped — and the line kept pointing at number one,
   * which was by then a close-up of a wrench under a basin.
   *
   * NOTHING FAILED. No test broke, no page looked wrong, and the image a
   * search result may show beside the business was the wrong one. */
  assert.strictEqual(coverFor('plumbing', ROOT), 4);
});

test('and "cover" does not leak into the alt text', () => {
  /* altFor() is the alt map. A lookup for image 0 finding a number would
   * put "4" into an alt attribute. */
  const alt = altFor('plumbing', ROOT);

  assert.strictEqual(alt.cover, undefined);
  assert.strictEqual(Object.keys(alt).length, HERO_COUNT);
});

test('a folder that has not said defaults to the first picture', () => {
  assert.strictEqual(coverFor('roofing', ROOT), 1);
  assert.strictEqual(coverFor('hvac', ROOT), 1);
});

test('AND SO DOES A VALUE THAT CANNOT BE AN IMAGE', () => {
  /* A cover of 9 puts /assets/hero-9.webp into the LocalBusiness schema —
   * a 404 handed to Google as the business's photograph. */
  fs.mkdirSync(path.join(ROOT, 'painting'), { recursive: true });

  for (const bad of [0, 9, -2, 'four', null, 2.5]) {
    fs.writeFileSync(path.join(ROOT, 'painting', 'alt.json'),
      JSON.stringify({ cover: bad }));

    assert.strictEqual(coverFor('painting', ROOT), 1,
      `cover ${JSON.stringify(bad)} was accepted`);
  }
});

section('WHICH TRADES ARE READY');

test('only the ones with a COMPLETE set', () => {
  /* roofing has two of four. A trade that is half ready is not ready, and
   * listing it would send somebody to build a site with two gaps in it. */
  assert.deepStrictEqual(tradesWithImages(ROOT), ['plumbing']);
});

test('and an images root that is not there returns nothing, not an error', () => {
  assert.doesNotThrow(() => tradesWithImages(path.join(ROOT, 'nope')));
  assert.deepStrictEqual(tradesWithImages(path.join(ROOT, 'nope')), []);
});

/* ------------------------------------------------------------------------ */

section('THE REAL TREE');

test('IMAGES_ROOT points at src/predefined-images/local-website-options', () => {
  /* Resolved from __dirname, so moving the render folder breaks this test
   * rather than silently producing sites with no pictures. */
  assert.ok(IMAGES_ROOT.endsWith(
    path.join('src', 'predefined-images', 'local-website-options')),
    `IMAGES_ROOT is ${IMAGES_ROOT}`);
});

test('and plumbing is the trade that has pictures today', () => {
  /* If this ever fails because ANOTHER trade got a full set, that is good
   * news and the assertion below is the one to widen. If it fails because
   * plumbing lost its pictures, the sites built on it have gaps. */
  const ready = tradesWithImages();

  assert.ok(ready.includes('plumbing'),
    `no complete set for plumbing; ready trades are [${ready.join(', ')}]`);
});

/* ======================================================================= */

section('SETS, SO TWO SITES IN ONE TRADE DO NOT SHARE PHOTOGRAPHS');

/* A trade with two complete sets and a third somebody is halfway through. */
const SETS = fs.mkdtempSync(path.join(os.tmpdir(), 'localoptions-sets-'));

for (const [set, cover] of [['set-1', 4], ['set-2', 2]]) {
  const dir = path.join(SETS, 'plumbing', set);
  fs.mkdirSync(dir, { recursive: true });

  for (const name of heroNames()) fs.writeFileSync(path.join(dir, name), Buffer.from(`${set} ${name}`));

  fs.writeFileSync(path.join(dir, 'alt.json'), JSON.stringify({
    cover,
    1: `${set} picture one`,
    2: `${set} picture two`,
    3: `${set} picture three`,
    4: `${set} picture four`,
  }));
}

/* set-3: two of four, which is what a folder being filled looks like. */
fs.mkdirSync(path.join(SETS, 'plumbing', 'set-3'), { recursive: true });
fs.writeFileSync(path.join(SETS, 'plumbing', 'set-3', 'hero-1.webp'), Buffer.from('x'));

/* set-4: ALL FOUR PICTURES AND NO ALT TEXT — which is exactly how set-2
 * arrived in the real tree on 30 October, images first and words later. */
fs.mkdirSync(path.join(SETS, 'plumbing', 'set-4'), { recursive: true });
for (const name of heroNames()) {
  fs.writeFileSync(path.join(SETS, 'plumbing', 'set-4', name), Buffer.from(`set-4 ${name}`));
}

/* set-10, to catch the sort. */
const ten = path.join(SETS, 'plumbing', 'set-10');
fs.mkdirSync(ten, { recursive: true });
for (const name of heroNames()) fs.writeFileSync(path.join(ten, name), Buffer.from(`set-10 ${name}`));
fs.writeFileSync(path.join(ten, 'alt.json'), JSON.stringify({
  cover: 3, 1: 'set-10 picture one', 2: 'set-10 picture two',
  3: 'set-10 picture three', 4: 'set-10 picture four',
}));

test('the sets are found, and NUMBERED RATHER THAN SORTED AS TEXT', () => {
  /* As strings, set-10 sorts before set-2 — so adding a tenth set would
   * silently reshuffle which site gets which pictures, all at once, on the
   * next rebuild, for no reason anybody could see. */
  assert.deepStrictEqual(
    setsIn('plumbing', SETS),
    ['set-1', 'set-2', 'set-3', 'set-4', 'set-10']
  );
});

test('and a half-filled set is not a set a site can be given', () => {
  const picks = new Set();

  for (let i = 0; i < 400; i += 1) picks.add(pickSet('plumbing', `Business ${i}`, SETS));

  assert.ok(!picks.has('set-3'), 'a site was given a folder somebody was still filling');
});

test('NOR IS ONE WITH FOUR PICTURES AND NOTHING WRITTEN ABOUT THEM', () => {
  /* There is no fallback to borrow: set-1's words describe set-1's
   * photographs and are simply false about any other set. So a set with no
   * alt.json can only publish undescribed images — which no test fails and
   * no page breaks over, and only the people who cannot see them notice.
   *
   * This is how set-2 arrived in the real tree: four files, no words. */
  assert.deepStrictEqual(completeSets('plumbing', SETS), ['set-1', 'set-2', 'set-10']);

  const picks = new Set();

  for (let i = 0; i < 400; i += 1) picks.add(pickSet('plumbing', `Business ${i}`, SETS));

  assert.ok(!picks.has('set-4'), 'a site was published with undescribed photographs');
});

test('and a set with no alt text borrows none from its neighbour', () => {
  /* If it is ever reached deliberately, it comes back empty rather than
   * wrong. Wrong is worse. */
  const out = heroSet('plumbing', { root: SETS, key: 'x', set: 'set-4' });

  assert.deepStrictEqual(out.alt, {});
  assert.strictEqual(out.cover, 1);
});

test('THE SAME BUSINESS ALWAYS GETS THE SAME SET', () => {
  /* THE REQUIREMENT THE WHOLE DESIGN RESTS ON. A random pick would hand a
   * site different photographs every time it was rebuilt — and the stored
   * alt text, which describes specific pictures, would then be describing
   * the previous set. */
  const once = pickSet('plumbing', 'The Chicago Plumber', SETS);

  for (let i = 0; i < 20; i += 1) {
    assert.strictEqual(pickSet('plumbing', 'The Chicago Plumber', SETS), once);
  }

  assert.strictEqual(pickSet('plumbing', '  the chicago PLUMBER ', SETS), once);
});

test('and different businesses do not all land on one', () => {
  const picks = new Set();

  for (let i = 0; i < 200; i += 1) picks.add(pickSet('plumbing', `Plumber ${i}`, SETS));

  assert.strictEqual(picks.size, 3, `every business landed on ${[...picks].join(', ')}`);
});

test('THE PICTURES, THE ALT TEXT AND THE COVER ALL COME FROM ONE SET', () => {
  /* THE BUG heroSet() EXISTS TO MAKE IMPOSSIBLE. Three separate lookups is
   * three chances to read set-1's words over set-2's pictures, and nothing
   * fails: the site renders, and every photograph is described as something
   * it is not, to exactly the people who cannot see it. */
  for (const name of ['One Plumbing', 'Two Plumbing', 'Three Plumbing', 'Four Plumbing']) {
    const out = heroSet('plumbing', { root: SETS, key: name });

    const covers = { 'set-1': 4, 'set-2': 2, 'set-10': 3 };

    assert.strictEqual(out.files['assets/hero-1.webp'].toString(), `${out.set} hero-1.webp`);
    assert.strictEqual(out.alt['1'], `${out.set} picture one`);
    assert.strictEqual(out.cover, covers[out.set], `${out.set} got another set's cover`);
  }
});

test('an explicit set beats the business name, for a re-render', () => {
  /* A site already published has alt text describing the pictures it has.
   * Rebuilding it has to use those pictures, not whichever the hash would
   * choose today. */
  const out = heroSet('plumbing', { root: SETS, key: 'One Plumbing', set: 'set-2' });

  assert.strictEqual(out.set, 'set-2');
  assert.strictEqual(out.alt['1'], 'set-2 picture one');
});

test('A TRADE WITH NO SETS STILL WORKS, which is every trade before today', () => {
  /* The old shape — four files sitting in the trade folder. A deploy that
   * lost its images over a folder rename is the worse failure. */
  assert.deepStrictEqual(setsIn('plumbing', ROOT), ['']);

  const out = heroSet('plumbing', { root: ROOT, key: 'Anything' });

  assert.strictEqual(out.set, '');
  assert.strictEqual(out.found.length, HERO_COUNT);
  assert.strictEqual(out.cover, 4);
  assert.strictEqual(out.alt['1'], 'A plumber beside an open service van');
});

test('and folderFor with no set named finds the first one', () => {
  assert.strictEqual(folderFor('plumbing', SETS), path.join(SETS, 'plumbing', 'set-1'));
  assert.strictEqual(folderFor('plumbing', ROOT), path.join(ROOT, 'plumbing'));
});

test('a trade is ready when ANY of its sets is complete', () => {
  assert.deepStrictEqual(tradesWithImages(SETS), ['plumbing']);
});

test('BOTH REAL PLUMBING SETS ARE COMPLETE AND DESCRIBED', () => {
  /* Against the actual tree, not a fixture. A set with no alt.json is worse
   * than it looks: there is no sensible fallback, because set-1's words
   * describe set-1's photographs and would be wrong on any other set. */
  for (const set of completeSets('plumbing')) {
    const alt = altFor('plumbing', undefined, set);

    for (let i = 1; i <= HERO_COUNT; i += 1) {
      assert.ok(alt[String(i)], `plumbing/${set} has no alt text for hero-${i}`);
    }

    const cover = coverFor('plumbing', undefined, set);

    assert.ok(cover >= 1 && cover <= HERO_COUNT, `plumbing/${set} has a nonsense cover`);
  }
});

/* ------------------------------------------------------------------------ */

fs.rmSync(SETS, { recursive: true, force: true });
fs.rmSync(ROOT, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
