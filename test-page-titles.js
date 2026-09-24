// test-page-titles.js
//
// The name in the browser tab, on every page of the APP.
//
// NOT test-page-meta.js, which is a different thing with a similar name: that
// one covers the <title> and description of a GENERATED CUSTOMER SITE, built
// from utils/pageMeta.js. This one covers the app Edwin's customers log into.
// Until now nothing tested those at all, which is how fourteen pages ended up
// with bare titles — "Dashboard", "Log In", "Generate Website Pages" — and no
// product name anywhere in the tab.
//
// WHAT THIS IS REALLY GUARDING
//
// Not the wording. The wording is a preference. What it guards is that the
// product name lives in ONE constant, so the rename that took the app from
// fastwebsitegenerator.com to threecomets.com is the last one that has to be
// done by grep. A title that hardcodes "Three Comets" passes today and is a
// lie the day the name changes again.
//
//   node test-page-titles.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { pageTitle, APP_NAME, TITLE_SEPARATOR } = require('./utils/pageTitle');
const { appHeader } = require('./utils/appHeader');

let passed = 0, failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ok    ${name}`);
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}\n        ${err.message}`);
    failed++;
  }
}

const read = p => fs.readFileSync(path.join(__dirname, p), 'utf8');

/** Every file in the app that renders a <title>. */
const ROUTES = [
  'routes/adminRoute.js', 'routes/authRoute.js', 'routes/billingRoute.js',
  'routes/blogSitesRoute.js', 'routes/creditsRoute.js',
  'routes/downloadZipRoute.js', 'routes/exportWpThemeRoute.js',
  'routes/jobRoute.js', 'routes/passwordRoute.js',
  'routes/pluginDownloadRoute.js',
];

const VIEWS = [
  'src/views/form.html', 'src/views/keyword-research.html',
  'src/views/login.html', 'src/views/signup.html',
];

const titlesIn = source => [...source.matchAll(/<title>([\s\S]*?)<\/title>/g)].map(m => m[1].trim());

console.log('\nApp page titles\n');

/* ------------------------------------------------------------------ *
 * The helper
 * ------------------------------------------------------------------ */

test('a page name gains the product name', () => {
  assert.strictEqual(pageTitle('Dashboard'), `Dashboard${TITLE_SEPARATOR}${APP_NAME}`);
});

test('THE PAGE COMES FIRST, AND THAT IS THE WHOLE POINT', () => {
  // A tab shows about twenty characters. Brand-first means ten open tabs all
  // read "Three Comets…" and none of them tells you which is which.
  const title = pageTitle('Keyword Research');

  assert.ok(title.startsWith('Keyword Research'),
    `the distinguishing word is not first: ${title}`);
  assert.ok(title.indexOf(APP_NAME) > title.indexOf('Keyword Research'));
});

test('THE APP\'S OWN FRONT PAGE IS JUST THE NAME', () => {
  // The wizard is the product, not a task inside it. A naive suffix gives
  // "Three Comets · Three Comets".
  assert.strictEqual(pageTitle(APP_NAME), APP_NAME);
});

test('a missing title degrades to the product name, not to a bare separator', () => {
  // `${title}` where title is undefined would otherwise render " · Three
  // Comets" — which looks like a bug to everyone who sees it.
  for (const nothing of ['', '   ', null, undefined]) {
    assert.strictEqual(pageTitle(nothing), APP_NAME, JSON.stringify(nothing));
  }
});

test('an already-branded title is not branded twice', () => {
  // Two callers wrapping the same string is a refactor away, and
  // "Dashboard · Three Comets · Three Comets" would ship silently.
  const once = pageTitle('Dashboard');
  assert.strictEqual(pageTitle(once), once);
});

test('surrounding space is trimmed', () => {
  assert.strictEqual(pageTitle('  Log In  '), `Log In${TITLE_SEPARATOR}${APP_NAME}`);
});

/* ------------------------------------------------------------------ *
 * Every page, wired
 * ------------------------------------------------------------------ */

test('EVERY ROUTE THAT RENDERS A TITLE GOES THROUGH THE HELPER', () => {
  /* The unit tests above prove the rule. This proves the rule is USED — the
   * gap that has caught this codebase repeatedly, most recently when a brand
   * filter's own suite passed while its caller forgot to pass the geography.
   *
   * A route that hardcodes "Something · Three Comets" would read correctly
   * today and be wrong the day APP_NAME changes, which is exactly the
   * situation this whole rename exists to clean up. */
  for (const file of ROUTES) {
    const source = read(file);
    const found = titlesIn(source);

    assert.ok(found.length, `${file} renders no <title> — has it moved?`);

    for (const title of found) {
      assert.match(title, /^\$\{pageTitle\(/,
        `${file} sets <title>${title}</title> without pageTitle()`);
    }

    assert.match(source, /require\('\.\.\/utils\/pageTitle'\)/,
      `${file} uses pageTitle without importing it`);
  }
});

test('every route that calls the helper actually imports it', () => {
  // A ReferenceError on a page nobody visits often is a 500 found by a
  // customer rather than by a test.
  for (const file of ROUTES) {
    const source = read(file);
    if (!/pageTitle\(/.test(source)) continue;

    assert.match(source, /\{[^}]*\bpageTitle\b[^}]*\}\s*=\s*require\('\.\.\/utils\/pageTitle'\)/,
      `${file} calls pageTitle but does not destructure it from utils/pageTitle`);
  }
});

test('THE STATIC VIEWS CARRY THE NAME TOO, and are checked against the constant', () => {
  /* form.html, login.html, signup.html and keyword-research.html are served
   * as files with placeholders substituted; no JavaScript runs over their
   * <head>, so the brand is written out literally.
   *
   * That is the drift risk this whole file exists to catch, so the literal is
   * compared against APP_NAME rather than against a copy of the string. */
  for (const file of VIEWS) {
    const [title, ...rest] = titlesIn(read(file));

    assert.ok(title, `${file} has no <title>`);
    assert.strictEqual(rest.length, 0, `${file} has more than one <title>`);

    assert.ok(
      title === APP_NAME || title.endsWith(`${TITLE_SEPARATOR}${APP_NAME}`),
      `${file} reads "${title}" — it does not end with "${TITLE_SEPARATOR}${APP_NAME}"`
    );
  }
});

test('the wizard is the product, so its tab is just the name', () => {
  assert.strictEqual(titlesIn(read('src/views/form.html'))[0], APP_NAME);
});

test('NO PAGE STILL CARRIES THE OLD NAME', () => {
  // The point of the exercise. "Generate Website Pages" was the wizard's
  // title; "Fast Website Generator" and "SEO Site Generator" are the two
  // names the product had before this one.
  for (const file of [...ROUTES, ...VIEWS]) {
    const source = read(file);

    for (const old of ['Fast Website Generator', 'SEO Site Generator', 'fastwebsitegenerator']) {
      assert.ok(!source.includes(old), `${file} still says "${old}"`);
    }
  }
});

/* ------------------------------------------------------------------ *
 * One name, one place
 * ------------------------------------------------------------------ */

test('THE PRODUCT NAME IS NOT REPEATED IN THE ROUTE FILES', () => {
  /* Fourteen titles, one constant. A route that spells the name out passes
   * every other test in this file and quietly survives the next rename —
   * which is the failure mode that produced this work in the first place. */
  for (const file of ROUTES) {
    assert.ok(!read(file).includes(APP_NAME),
      `${file} hardcodes "${APP_NAME}" instead of using APP_NAME`);
  }
});

test('the name the header SHOWS is the same constant, not a copy of it', () => {
  /* The logo's alt text is the product name said out loud, so it reads
   * APP_NAME rather than spelling it again. Asserted against the RENDERED
   * header, not the source: a source check would pass on a hardcoded string
   * that happens to match today. */
  assert.match(appHeader(''), new RegExp(`alt="${APP_NAME}"`),
    'the rendered logo alt text and APP_NAME disagree');

  assert.ok(!/alt="Three Comets"/.test(read('utils/appHeader.js')),
    'appHeader spells the product name out instead of reading APP_NAME');
});

test('A SIGNED-OUT PAGE DOES NOT IMPORT THE LOGGED-IN HEADER TO GET A TAB TITLE', () => {
  /* This is why pageTitle is its own module. It began life inside
   * utils/appHeader.js, and test-app-header.js caught it within the minute:
   *
   *   signed-out pages do NOT get the header
   *   routes/passwordRoute.js renders the logged-in header on a signed-out page
   *
   * That test matches the module name rather than the header being rendered,
   * so strictly it was a false positive — and splitting the file was still
   * the right answer. A boundary that holds only because nobody has had a
   * good excuse to cross it is not a boundary. */
  for (const file of ['routes/passwordRoute.js', 'utils/renderAuthPage.js']) {
    assert.ok(!read(file).includes('appHeader'),
      `${file} is a signed-out page and imports the logged-in header`);
  }

  assert.ok(!read('utils/pageTitle.js').includes("require('./appHeader')"),
    'pageTitle depends on the header, which puts the cycle back');
});

console.log('');
console.log(`  ${passed} passed, ${failed} failed`);
console.log('');
process.exit(failed === 0 ? 0 : 1);
