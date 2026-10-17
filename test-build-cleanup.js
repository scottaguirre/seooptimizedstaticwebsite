// test-build-cleanup.js
//
// When a customer's generated website gets deleted from the server.
//
// WHAT THIS IS GUARDING
//
// utils/cleanupScheduler.js was written months ago to delete expired build
// folders. It exported startCleanupScheduler(). Nothing in the app ever
// called it. So it never ran — not once — and nobody noticed, because a
// sweeper that deletes nothing looks exactly like a sweeper with nothing to
// delete. The only other mention of it in the whole tree was a comment.
//
// On 16 October it was measured before being switched on: dist/ was 32 MB
// and builds/ 41 MB, against 33 GB free. Six months of never running had
// cost nothing. Edwin wired it up anyway, at 48 hours, for the policy rather
// than the disk: *"48 hours is enough time for a customer to download the
// site. If they have to spend more credits it's ok."*
//
// THIS IS THE MOST DESTRUCTIVE CODE IN THE APP. It deletes customers' paid
// work, recursively, with force: true, on a timer. Everything below is aimed
// at the two ways that goes wrong — deleting something it should not have,
// and quietly not running at all.
//
//   node test-build-cleanup.js

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

let passed = 0, failed = 0;

function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
function section(n) { console.log(`\n${n}\n`); }

const code = file => fs.readFileSync(require.resolve(file), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

// ---------------------------------------------------------------------------
section('THE LINE THAT WAS MISSING FOR SIX MONTHS');
// ---------------------------------------------------------------------------

const server = code('./server.js');

test('server.js actually starts it', function () {
  /* The entire bug. The module was complete and correct and never ran. */
  assert.match(server, /require\('\.\/utils\/cleanupScheduler'\)/,
    'cleanupScheduler is not imported — it cannot run');
  assert.match(server, /startCleanupScheduler\(\)/,
    'cleanupScheduler is imported and never started');
});

test('and it starts with the other workers, not somewhere of its own', function () {
  /* One list of background workers is what would have made the absence
   * visible. A start call hidden elsewhere is the same mistake with a
   * different address. */
  const workers = server.slice(
    server.indexOf('const startWorkers'),
    server.indexOf('mongoose.connection.once')
  );

  assert.ok(workers.length > 0, 'the startWorkers block could not be found');
  assert.match(workers, /jobRunner\.start\(\)/);
  assert.match(workers, /blogScheduler\.start\(\)/);
  assert.match(workers, /startCleanupScheduler\(\)/,
    'the sweeper starts outside the one place every other worker starts');
});

// ---------------------------------------------------------------------------
section('Forty-eight hours, and the number is visible');
// ---------------------------------------------------------------------------

test('the default is 48 hours, not 24', function () {
  /* 24 was the old default. Someone who generates on a Friday evening and
   * opens their laptop on Sunday would find it gone. */
  delete require.cache[require.resolve('./utils/cleanupScheduler')];
  delete process.env.BUILD_TTL_HOURS;

  const { TTL_MS } = require('./utils/cleanupScheduler');

  assert.strictEqual(TTL_MS, 48 * 60 * 60 * 1000,
    `the TTL is ${TTL_MS / 3600000} hours`);
});

test('AND IT IS A DEFAULT, NOT AN ENV VAR NOBODY SET', function () {
  /* The distinction matters. A sweeper whose window lives only in a .env on
   * one server is a window nobody reading this repo can see — and the server
   * has no BUILD_TTL_HOURS set. */
  const src = code('./utils/cleanupScheduler.js');

  assert.match(src, /BUILD_TTL_HOURS \|\| 48/,
    'the 48 is not the fallback, so the real window depends on the environment');
});

test('the env var still wins, for a server that needs something else', function () {
  delete require.cache[require.resolve('./utils/cleanupScheduler')];
  process.env.BUILD_TTL_HOURS = '72';

  const { TTL_MS } = require('./utils/cleanupScheduler');
  assert.strictEqual(TTL_MS, 72 * 60 * 60 * 1000);

  delete process.env.BUILD_TTL_HOURS;
  delete require.cache[require.resolve('./utils/cleanupScheduler')];
});

// ---------------------------------------------------------------------------
section('IT DELETES WHAT IS OLD AND NOTHING ELSE');
// ---------------------------------------------------------------------------

/* Driven for real against a temporary folder tree.
 *
 * NOT A SOURCE CHECK. This function calls fs.rmSync with recursive and force
 * on paths built from a directory listing. Reading it and nodding is how you
 * ship a sweeper that deletes a customer's site a day early. */
function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cleanup-'));

  for (const dir of ['dist', 'builds/work', 'builds/zips']) {
    fs.mkdirSync(path.join(root, dir), { recursive: true });
  }
  return root;
}

function site(root, name, ageHours) {
  const dir = path.join(root, 'dist', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');

  const when = new Date(Date.now() - ageHours * 3600000);
  fs.utimesSync(path.join(dir, 'index.html'), when, when);
  fs.utimesSync(dir, when, when);

  return dir;
}

/** sweepDir(), lifted out and run against a real tree. */
function sweeper() {
  const src = fs.readFileSync(require.resolve('./utils/cleanupScheduler.js'), 'utf8');

  const start = src.indexOf('function newestMtime');

  /* BACK TO THE START OF THE LINE, not to the word.
   *
   * runCleanup became `async function runCleanup` when it started clearing
   * job payloads, and indexOf('function runCleanup') then pointed INSIDE
   * that phrase — so the slice ended with a dangling `async ` and every
   * test here failed with "async is not defined". Cutting at the newline
   * before the line survives whatever keyword goes in front of it next. */
  const end = src.lastIndexOf('\n', src.indexOf('function runCleanup'));

  assert.ok(start > -1 && end > start, 'cleanupScheduler has changed shape');

  return new Function('fs', 'path', 'TTL_MS', 'console',
    `${src.slice(start, end)}; return sweepDir;`
  )(fs, path, 48 * 3600000, { log() {}, error() {} });
}

test('a site older than the window is removed', function () {
  const root = makeTree();
  const old = site(root, 'user_old', 50);

  const removed = sweeper()(path.join(root, 'dist'), /^user_/, 'site');

  /* NAMES, NOT A COUNT. sweepDir reports what it deleted so the job
   * payloads can follow the files — a number cannot say whose wizard form
   * to clear. */
  assert.deepStrictEqual(removed, ['user_old']);
  assert.ok(!fs.existsSync(old), 'the expired site is still there');
});

test('A SITE INSIDE THE WINDOW IS NOT', function () {
  /* The failure that costs a customer their paid work. 47 hours is inside
   * 48, and an off-by-one in the comparison deletes it. */
  const root = makeTree();
  const fresh = site(root, 'user_fresh', 47);

  const removed = sweeper()(path.join(root, 'dist'), /^user_/, 'site');

  assert.deepStrictEqual(removed, [], 'a site 47 hours old was swept under a 48-hour window');
  assert.ok(fs.existsSync(fresh), 'the fresh site was deleted');
});

test('a build written seconds ago is never touched', function () {
  /* The sweep runs hourly and a webpack build takes two and a half minutes.
   * Deleting a folder mid-build would fail the job and charge the customer
   * for it. */
  const root = makeTree();
  const now = site(root, 'user_now', 0);

  assert.deepStrictEqual(sweeper()(path.join(root, 'dist'), /^user_/, 'site'), []);
  assert.ok(fs.existsSync(now));
});

test('AND A LONG BUILD IS JUDGED BY ITS NEWEST FILE, NOT THE FOLDER', function () {
  /* A directory's own mtime only changes when its direct children are added
   * or removed. A build that started three days ago and is still writing
   * into existing files would look stale by the folder alone — and get
   * deleted out from under itself. */
  const root = makeTree();
  const dir = path.join(root, 'dist', 'user_long');
  fs.mkdirSync(dir, { recursive: true });

  const stale = new Date(Date.now() - 100 * 3600000);

  fs.writeFileSync(path.join(dir, 'old.html'), 'x');
  fs.utimesSync(path.join(dir, 'old.html'), stale, stale);

  fs.writeFileSync(path.join(dir, 'just-written.html'), 'x');   // now
  fs.utimesSync(dir, stale, stale);                             // folder looks old

  assert.deepStrictEqual(sweeper()(path.join(root, 'dist'), /^user_/, 'site'), [],
    'a folder with a file written seconds ago was swept because the folder looked old');
});

test('ONLY user_ ENTRIES ARE EVEN CONSIDERED', function () {
  /* This runs against dist/ and builds/. Anything else that ends up in
   * there — a README, a shared asset folder, something a future feature puts
   * beside the per-user folders — must survive, however old it is. */
  const root = makeTree();

  const keep = path.join(root, 'dist', 'shared-assets');
  fs.mkdirSync(keep);
  fs.writeFileSync(path.join(keep, 'logo.png'), 'x');

  const stale = new Date(Date.now() - 500 * 3600000);
  fs.utimesSync(path.join(keep, 'logo.png'), stale, stale);
  fs.utimesSync(keep, stale, stale);

  const readme = path.join(root, 'dist', 'README.md');
  fs.writeFileSync(readme, 'x');
  fs.utimesSync(readme, stale, stale);

  assert.deepStrictEqual(sweeper()(path.join(root, 'dist'), /^user_/, 'site'), []);
  assert.ok(fs.existsSync(keep), 'a non-user folder was deleted');
  assert.ok(fs.existsSync(readme), 'a non-user file was deleted');
});

test('a missing folder is not an error', function () {
  /* builds/zips does not exist until the first download. */
  const root = makeTree();
  assert.deepStrictEqual(sweeper()(path.join(root, 'nope'), /^user_/, 'site'), []);
});

test('and the zip pattern does not match a folder of the same name', function () {
  /* The three sweeps use three patterns. The zips one ends in \\.zip$ for a
   * reason: builds/zips and builds/work sit next to each other. */
  const src = code('./utils/cleanupScheduler.js');

  assert.match(src, /sweepDir\(ZIP_DIR, \/\^user_\.\*\\\.zip\$\/,/,
    'the zip sweep no longer requires the .zip extension');
});

// ---------------------------------------------------------------------------
section('It says so every time it runs');
// ---------------------------------------------------------------------------

const sched = code('./utils/cleanupScheduler.js');

test('EVERY RUN IS LOGGED, INCLUDING THE ZEROS', function () {
  /* The lesson of this file's first six months, in one assertion. "0
   * removed" is the only thing that tells "nothing was due" from "it is not
   * running", and from outside the process those look the same. The old
   * version spoke only when it deleted something — which is exactly why
   * nobody could tell it had never spoken. */
  const run = sched.slice(sched.indexOf('function runCleanup'),
                          sched.indexOf('function startCleanupScheduler'));

  assert.match(run, /log\.info\(/, 'a sweep that removed nothing says nothing');
  assert.ok(!/if \(total > 0\)|if \(total\)/.test(run),
    'the log line is conditional on having deleted something');
});

test('through the logger, not console.log', function () {
  /* app.log can be grepped in three months. stdout is rotated away by pm2. */
  const run = sched.slice(sched.indexOf('function runCleanup'),
                          sched.indexOf('function startCleanupScheduler'));

  assert.ok(!/console\.log/.test(run),
    'the sweep result goes to stdout, where it cannot be found later');
});

test('and the SWEEP line carries the window it used', function () {
  /* So a log from a server with BUILD_TTL_HOURS set says what it actually
   * did, rather than leaving the reader to assume the default.
   *
   * SCOPED TO runCleanup, found by mutation. The first version searched the
   * whole file — and startCleanupScheduler() logs ttlHours too, so deleting
   * it from the sweep line left the assertion matching the other one. */
  const run = sched.slice(sched.indexOf('function runCleanup'),
                          sched.indexOf('function startCleanupScheduler'));

  assert.match(run, /ttlHours/, 'the sweep log does not record the window it used');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
