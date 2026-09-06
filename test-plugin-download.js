// test-plugin-download.js
//
// The plugin download, end to end, against the real wp-plugin/ folder.
//
// What it proves:
//   1. The version served matches the header WordPress will read
//   2. The archive has the plugin under ONE top-level folder named for the
//      slug — get this wrong and WordPress installs a pile of loose files
//      that never appear in the plugin list
//   3. Nothing that should stay behind is in the archive
//   4. The cache rebuilds when source changes and does not when it doesn't
//   5. Concurrent downloads produce one archive, not a torn one
//   6. The route is behind auth
//
//   node test-plugin-download.js

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

// The packager logs through utils/logger, which is the only thing it needs
// from the app. Nothing here touches Mongo.
const pkg = require('./utils/pluginPackage');

const MAIN_FILE = path.join(pkg.SOURCE_DIR, `${pkg.PLUGIN_SLUG}.php`);

/**
 * The FILE entries in an archive.
 *
 * Directory entries are dropped — a zip carries them as their own records
 * ending in a slash, and counting 'interlink-engine/includes/' as a file
 * makes every by-name comparison below wrong.
 */
function entriesIn(zipPath) {
  const out = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  return out.split('\n').map(s => s.trim()).filter(e => e && !e.endsWith('/'));
}

(async () => {

  console.log('\nSource');

  await test('the plugin source is present in the repo', () => {
    assert.ok(pkg.isAvailable(), `expected ${MAIN_FILE} to exist`);
  });

  await test('the version is read from the plugin header', () => {
    const header = fs.readFileSync(MAIN_FILE, 'utf8');
    const declared = /^[\s*]*Version:\s*([0-9][0-9A-Za-z.\-+]*)/m.exec(header)[1];
    assert.strictEqual(pkg.readVersion(), declared);
  });

  await test('the header version and IE_VERSION agree', () => {
    // These are read by different things — WordPress reads the header, the
    // server reads the X-IE-Version the constant produces — so they drift
    // silently. A site reporting a version the plugin list disagrees with is
    // the exact confusion this catches.
    const src = fs.readFileSync(MAIN_FILE, 'utf8');
    const header = /^[\s*]*Version:\s*([0-9][0-9A-Za-z.\-+]*)/m.exec(src)[1];
    const constant = /define\(\s*'IE_VERSION'\s*,\s*'([^']+)'\s*\)/.exec(src)[1];
    assert.strictEqual(constant, header,
      `IE_VERSION is ${constant} but the plugin header says ${header}`);
  });

  console.log('\nPackaging');

  let built;

  await test('an archive is produced', async () => {
    built = await pkg.ensureZip();
    assert.ok(fs.existsSync(built.zipPath), 'no file at the returned path');
    assert.ok(fs.statSync(built.zipPath).size > 1000, 'archive is suspiciously small');
  });

  await test('the filename carries the version', () => {
    assert.strictEqual(built.filename, `interlink-engine-${built.version}.zip`);
  });

  await test('the archive is a valid zip', () => {
    // -t tests every entry's CRC. Throws on a truncated or torn file, which
    // is the failure the atomic rename exists to prevent.
    execFileSync('unzip', ['-tqq', built.zipPath]);
  });

  await test('everything sits under exactly one top-level folder', () => {
    const roots = new Set(entriesIn(built.zipPath).map(e => e.split('/')[0]));
    assert.deepStrictEqual([...roots], ['interlink-engine'],
      `WordPress would install this wrong. Roots: ${[...roots].join(', ')}`);
  });

  await test('the main plugin file is where WordPress looks for it', () => {
    const names = entriesIn(built.zipPath);
    assert.ok(names.includes('interlink-engine/interlink-engine.php'),
      'the main file is missing from the archive');
  });

  await test('every include travelled', () => {
    const onDisk = fs.readdirSync(path.join(pkg.SOURCE_DIR, 'includes'))
      .filter(n => n.endsWith('.php')).sort();
    const inZip = entriesIn(built.zipPath)
      .filter(e => e.startsWith('interlink-engine/includes/'))
      .map(e => path.basename(e)).sort();
    assert.deepStrictEqual(inZip, onDisk);
  });

  await test('no dotfiles, archives or logs are shipped', () => {
    for (const entry of entriesIn(built.zipPath)) {
      assert.ok(!path.basename(entry).startsWith('.'), `shipped a dotfile: ${entry}`);
      assert.ok(!/\.(zip|log)$/i.test(entry), `shipped ${entry}`);
      assert.ok(!entry.includes('node_modules/'), `shipped ${entry}`);
    }
  });

  console.log('\nCaching');

  await test('a second call reuses the archive rather than rebuilding', async () => {
    const before = fs.statSync(built.zipPath).mtimeMs;
    await new Promise(r => setTimeout(r, 20));
    const again = await pkg.ensureZip();
    assert.strictEqual(fs.statSync(again.zipPath).mtimeMs, before, 'it rebuilt unnecessarily');
  });

  await test('touching a source file forces a rebuild', async () => {
    const before = fs.statSync(built.zipPath).mtimeMs;

    // Forward in time, so the check is "source is newer than archive" and not
    // an accident of same-millisecond timestamps.
    const future = new Date(Date.now() + 5000);
    const target = path.join(pkg.SOURCE_DIR, 'includes', 'class-ie-signing.php');
    const original = fs.statSync(target);
    fs.utimesSync(target, future, future);

    try {
      const rebuilt = await pkg.ensureZip();
      assert.ok(fs.statSync(rebuilt.zipPath).mtimeMs > before, 'the stale archive was served');
    } finally {
      fs.utimesSync(target, original.atime, original.mtime);
    }
  });

  await test('ten simultaneous requests all get one intact archive', async () => {
    fs.rmSync(built.zipPath, { force: true });

    const results = await Promise.all(
      Array.from({ length: 10 }, () => pkg.ensureZip())
    );

    for (const r of results) {
      assert.strictEqual(r.zipPath, built.zipPath);
      assert.ok(fs.existsSync(r.zipPath));
    }

    // The thing that actually matters: nobody got a half-written file.
    execFileSync('unzip', ['-tqq', built.zipPath]);

    // And no temporary file was orphaned. A build that threw between write
    // and rename would leave one behind, and they would accumulate silently
    // in a directory nobody looks at.
    const strays = fs.readdirSync(pkg.CACHE_DIR).filter(n => n.includes('.tmp'));
    assert.deepStrictEqual(strays, [], `orphaned temp files: ${strays.join(', ')}`);
  });

  console.log('\nThe route');

  await test('/plugin/download is behind requireAuth', () => {
    // Read rather than exercised: standing up Express and a session store to
    // prove one middleware is mounted costs more than it tells us, and the
    // failure mode — someone deletes requireAuth — is textual.
    const src = fs.readFileSync(path.join(__dirname, 'routes', 'pluginDownloadRoute.js'), 'utf8');
    assert.ok(/router\.get\(\s*'\/plugin\/download'\s*,\s*requireAuth\s*,/.test(src),
      'the route is not guarded by requireAuth');
  });

  await test('server.js mounts it', () => {
    const src = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    assert.ok(/require\('\.\/routes\/pluginDownloadRoute'\)/.test(src), 'not required');
    assert.ok(/app\.use\([^)]*pluginDownloadRoute\)/.test(src), 'not mounted');
    assert.ok(/requireAuth,\s*pluginDownloadRoute/.test(src), 'mounted without requireAuth');
  });

  await test('the dashboard links to Blog Automation', () => {
    const src = fs.readFileSync(path.join(__dirname, 'routes', 'authRoute.js'), 'utf8');
    assert.ok(src.includes('href="/blog-sites"'), 'no link to /blog-sites on the dashboard');
  });

  await test('the setup page offers the download', () => {
    const src = fs.readFileSync(path.join(__dirname, 'routes', 'blogSitesRoute.js'), 'utf8');
    assert.ok(src.includes('href="/plugin/download"'), 'no download link on /blog-sites');
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
