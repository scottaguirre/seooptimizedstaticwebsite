// test-brand-name.js
//
// The product's name is typed out in a known, short list of places. Anywhere
// else is a bug waiting for the next rename.
//
// WHY THIS EXISTS
//
// utils/pageTitle.js holds APP_NAME and says, in its own comment, that
// renaming the product "should be one edit, not a grep". In two days this
// project found three separate places that had ignored it:
//
//   utils/emailLayout.js        the wordmark and copyright line of every
//                               transactional email — "Fast Website
//                               Generator" went to real customers for weeks,
//                               and was invisible because the SENDER name in
//                               the inbox was already correct
//   the three theme-header files  Author: Static Website Generator, a brand
//                               two renames out of date, next to the new logo
//                               in every customer's Appearance → Themes
//   scripts/check-email-health.js  the alert subject and body
//
// Each was one person typing six characters instead of importing a constant.
// None was caught by anything, because a hard-coded string that happens to be
// correct today is indistinguishable from a wired one — until the day it is
// not.
//
// SO THIS IS AN ALLOW-LIST, NOT A SEARCH. Every legitimate holder is named
// below with its reason and its exact count. A new occurrence anywhere fails,
// and so does an extra occurrence in a file that was already allowed one.
//
//   node test-brand-name.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { APP_NAME } = require('./utils/pageTitle');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(n) { console.log(`\n${n}\n`); }

/* Every name this product has traded under, plus the domains. A rename leaves
 * all of them behind, which is the whole problem. */
const BRANDS = [
  APP_NAME,
  'Fast Website Generator',
  'Static Website Generator',
  'SEO Site Generator',
  'threecomets.com',
  'fastwebsitegenerator.com',
];

/* Where the name may legitimately be written out, why, and how many times.
 *
 * THE COUNT IS PART OF THE RULE. Allowing a file without bounding it means
 * the next five copies land in a file already on the list and nothing
 * notices. */
const ALLOWED = [
  {
    file: 'utils/pageTitle.js',
    count: 1,
    why: 'the source of truth — APP_NAME itself',
  },
  {
    file: 'utils/sendEmail.js',
    count: 1,
    why: 'DEFAULT_FROM_ADDRESS. An email address is a DNS fact, not a display '
       + 'string: renaming the product does not move the mailbox, and a From '
       + 'address built from a display name would be invalid the moment the '
       + 'name had a space in it',
  },
  { file: 'src/views/form.html', count: 1, why: 'static HTML tab title' },
  { file: 'src/views/login.html', count: 1, why: 'static HTML tab title' },
  { file: 'src/views/signup.html', count: 1, why: 'static HTML tab title' },
  { file: 'src/views/keyword-research.html', count: 1, why: 'static HTML tab title' },
];

/* Files served to a browser as-is cannot import a constant. test-page-titles.js
 * already asserts each of these <title> tags MATCHES APP_NAME, so they are
 * checked rather than wired — which is the most that is available here. */

/* The WordPress plugin is a second codebase in another language. It cannot
 * require() a JavaScript constant, and its occurrences are translatable
 * strings where WordPress convention keeps a brand literal so the extractor
 * can see it. Out of scope, deliberately and with a reason. */
const OUT_OF_SCOPE = ['wp-plugin'];

/**
 * What deploy.sh actually sends to the server, read from .rsync-exclude.
 *
 * WHY THIS AND NOT A HAND-WRITTEN SKIP LIST — and this cost a refused deploy
 * within the hour.
 *
 * The first version listed the directories to ignore by hand: node_modules,
 * .git, logs, dist. It passed here and failed on Edwin's machine, because his
 * tree has a `Claude outputs/` folder holding mockups and an old email
 * preview — five brand strings in a file that has never been part of the app.
 * The guard was right that the strings were there and wrong about what it was
 * guarding.
 *
 * The honest definition of "the app" is "what gets deployed", and that
 * already exists in .rsync-exclude, maintained because getting it wrong takes
 * production down. So this reads that file. A directory the deploy never
 * sends cannot break a deploy, and a new scratch folder needs no edit here.
 */
function deployExcludes() {
  const lines = fs.readFileSync(path.join(__dirname, '.rsync-exclude'), 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#'));

  const dirs = new Set();
  const names = new Set();
  const globs = [];

  for (const line of lines) {
    if (line.endsWith('/')) { dirs.add(line.slice(0, -1)); continue; }

    if (line.includes('*')) {
      globs.push(new RegExp('^' + line.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'));
      continue;
    }

    names.add(line);
  }

  return { dirs, names, globs };
}

const EXCLUDED = deployExcludes();

/** Belt and braces: things rsync happens not to list but that are not the app. */
const ALSO_SKIP = ['_server_copy', ...OUT_OF_SCOPE];

const CODE_EXT = new Set(['.js', '.html', '.css', '.json', '.sh']);

function skipDir(name) {
  return EXCLUDED.dirs.has(name) || EXCLUDED.names.has(name) || ALSO_SKIP.includes(name);
}

function skipFile(name) {
  return EXCLUDED.names.has(name) || EXCLUDED.globs.some(re => re.test(name));
}

/**
 * The file with its comments removed.
 *
 * NOT OPTIONAL, and this project has learned it four times. These files quote
 * old brands, bad outputs and the exact strings they warn about, because that
 * is what a useful comment does. On 13 October a comment explaining that the
 * theme Author had carried a stale brand tripped exactly this kind of check
 * and stopped a deploy on correct code.
 */
function code(file) {
  const src = fs.readFileSync(path.join(__dirname, file), 'utf8');

  if (file.endsWith('.html')) return src.replace(/<!--[\s\S]*?-->/g, '');

  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/^\s*#.*$/gm, '');
}

/** Every code file in the app, as repo-relative paths. */
function codeFiles(dir = '.', out = []) {
  for (const entry of fs.readdirSync(path.join(__dirname, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name).replace(/^\.\//, '');

    if (entry.isDirectory()) {
      if (!skipDir(entry.name)) codeFiles(rel, out);
      continue;
    }

    if (skipFile(entry.name)) continue;
    if (!CODE_EXT.has(path.extname(entry.name))) continue;

    // The suites quote every brand on purpose — that is what they are for.
    if (/(^|\/)test-/.test(rel)) continue;

    out.push(rel);
  }
  return out;
}

function hits(file) {
  const src = code(file);
  let n = 0;
  for (const brand of BRANDS) n += src.split(brand).length - 1;
  return n;
}

section('Where the name is allowed to be typed out');

test('every allowed file still holds exactly what it is allowed to hold', function () {
  for (const { file, count, why } of ALLOWED) {
    const n = hits(file);

    assert.strictEqual(
      n, count,
      `${file} writes the brand ${n} time(s), not ${count} — allowed because: ${why}`
    );
  }
});

test('NOTHING ELSE IN THE APP WRITES IT AT ALL', function () {
  /* The whole point. Three files had quietly joined this list in two days and
   * nothing said so. */
  const allowed = new Set(ALLOWED.map(a => a.file));
  const offenders = [];

  for (const file of codeFiles()) {
    if (allowed.has(file)) continue;
    const n = hits(file);
    if (n > 0) offenders.push(`${file} (${n})`);
  }

  assert.deepStrictEqual(
    offenders, [],
    'these files write the brand by hand instead of importing APP_NAME:\n          '
      + offenders.join('\n          ')
      + '\n        If one of them is legitimate, add it to ALLOWED with a reason.'
  );
});

section('The list itself stays honest');

test('every allowed file exists', function () {
  /* A list that names a deleted file quietly stops protecting anything, and
   * reads as though it still does. */
  for (const { file } of ALLOWED) {
    assert.ok(
      fs.existsSync(path.join(__dirname, file)),
      `${file} is on the allow-list and is not in the repo`
    );
  }
});

test('and every entry says why', function () {
  for (const entry of ALLOWED) {
    assert.ok(
      entry.why && entry.why.length > 10,
      `${entry.file} is allowed without a reason — the next person cannot tell whether to remove it`
    );
  }
});

test('NOTHING THE DEPLOY EXCLUDES IS EVER SCANNED', function () {
  /* THE BUG THIS FILE SHIPPED WITH, now a permanent guard.
   *
   * The first version listed skip directories by hand and was validated
   * against a partial copy of the repo. On Edwin's machine it found five
   * brand strings in `Claude outputs/email-preview-reset.html` — mockups from
   * an old session, a folder .rsync-exclude has blocked from deploys for
   * months — and refused the deploy over a file that is not part of the app.
   *
   * A guard that fails on things the product does not ship is not protecting
   * the product; it is training its owner to ignore it. */
  const scanned = codeFiles();

  for (const file of scanned) {
    const parts = file.split(path.sep);

    for (const part of parts.slice(0, -1)) {
      assert.ok(
        !skipDir(part),
        `${file} is inside "${part}", which the deploy never sends — it should not be scanned`
      );
    }

    assert.ok(!skipFile(path.basename(file)), `${file} is excluded from the deploy and was scanned anyway`);
  }
});

test('and the exclusions are read from .rsync-exclude, in all three shapes', function () {
  /* Asserted structurally rather than against one folder name: the point is
   * that the parser understands a directory ("node_modules/"), a bare name
   * (".env") and a glob ("*.zip"), because getting any one of them wrong
   * silently widens or narrows what counts as the app. */
  assert.ok(EXCLUDED.dirs.has('node_modules'), 'a trailing-slash directory entry was not parsed');
  assert.ok(EXCLUDED.names.has('.env'), 'a bare filename entry was not parsed');
  assert.ok(EXCLUDED.globs.some(re => re.test('plugin.zip')), 'a glob entry was not parsed');
});

test('the sweep actually looks at a meaningful number of files', function () {
  /* A walker that silently matched nothing — a bad skip rule, a wrong path —
   * would make every case above pass by examining an empty list. */
  const files = codeFiles();

  assert.ok(files.length > 40, `only ${files.length} file(s) were scanned; the walker is not finding the app`);
  assert.ok(files.includes('utils/emailLayout.js'), 'the file that started this is not being scanned');
  assert.ok(files.includes('routes/exportWpThemeRoute.js'), 'the theme route is not being scanned');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
