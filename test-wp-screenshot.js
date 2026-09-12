// test-wp-screenshot.js
//
// The theme's screenshot.png — the tile in Appearance → Themes.
//
// WHY IT NEEDS A TEST AT ALL
//
// It is one file copy, and every way it can fail is silent. WordPress looks
// for that exact filename beside style.css and shows a grey placeholder when
// it is absent, so a broken copy produces a theme that installs, activates and
// works — and looks unfinished in the one screen where a customer compares it
// against everything else they have.
//
// The failure worth guarding is subtler than "it wasn't copied". The builder's
// own writeFile() is utf8-only. Push a PNG through it and the file appears,
// with a plausible size, and is no longer an image: every byte above 0x7F has
// been replaced. So this checks the bytes, not the path.
//
//   node test-wp-screenshot.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { copyFile } = require('./utils/wpThemeBuilder/wpHelpers/fileHelpers');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}
async function asyncTest(name, fn) {
  try { await fn(); console.log(`  ok    ${name}`); passed++; }
  catch (err) { console.log(`  FAIL  ${name}\n        ${err.message}`); failed++; }
}

const SOURCE = path.join(__dirname, 'utils', 'wpThemeBuilder', 'assets', 'screenshot.png');

/** Width and height straight out of the PNG's IHDR chunk. */
function pngSize(buf) {
  assert.ok(
    buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    'not a PNG — the signature is wrong'
  );
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

(async () => {
  console.log('\nTheme screenshot\n');

  test('the source image exists where the builder looks for it', () => {
    // buildFromModel.js resolves this path relative to itself. A rename that
    // misses one of the two is the likeliest way this breaks.
    assert.ok(fs.existsSync(SOURCE), `missing: ${SOURCE}`);
  });

  test('it is a real PNG', () => {
    pngSize(fs.readFileSync(SOURCE));
  });

  test('it is 1200x900, the size WordPress asks for', () => {
    // Displayed at 600x450. Shipping the display size means a blurry tile on
    // every retina screen, which is most of them.
    const { width, height } = pngSize(fs.readFileSync(SOURCE));
    assert.strictEqual(`${width}x${height}`, '1200x900');
  });

  test('it is small enough to ship in every theme', () => {
    // It goes inside every exported ZIP, for every customer, forever.
    const bytes = fs.statSync(SOURCE).size;
    assert.ok(bytes < 500 * 1024, `${Math.round(bytes / 1024)}KB — too heavy for a thumbnail`);
  });

  await asyncTest('copyFile reproduces the bytes exactly', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-shot-'));
    const dest = path.join(tmp, 'nested', 'screenshot.png');

    return copyFile(SOURCE, dest).then(() => {
      const before = fs.readFileSync(SOURCE);
      const after = fs.readFileSync(dest);

      assert.strictEqual(after.length, before.length, 'size changed in transit');
      assert.ok(after.equals(before), 'bytes changed in transit');

      // The specific corruption utf8 would cause, named so a failure here
      // points straight at the cause rather than at "the file is different".
      assert.ok(!after.includes(Buffer.from('�', 'utf8')), 'utf8 replacement characters — copied as text');

      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  await asyncTest('copyFile creates the destination directory', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-shot-'));
    const dest = path.join(tmp, 'a', 'b', 'c', 'screenshot.png');
    return copyFile(SOURCE, dest).then(() => {
      assert.ok(fs.existsSync(dest));
      fs.rmSync(tmp, { recursive: true, force: true });
    });
  });

  test('the builder copies it, and does not throw when it is missing', () => {
    // Read as source rather than run, because building a whole theme needs a
    // content model, a dist directory and a webpack build. The two properties
    // that matter are both visible here: the copy happens, and it is guarded.
    const src = fs.readFileSync(
      path.join(__dirname, 'utils', 'wpThemeBuilder', 'buildFromModel.js'),
      'utf8'
    );
    assert.ok(/screenshot\.png/.test(src), 'buildFromModel.js never mentions screenshot.png');
    assert.ok(/copyFile\(/.test(src), 'buildFromModel.js does not call copyFile');
    assert.ok(
      /if\s*\(\s*fileExists\(\s*screenshotSrc\s*\)\s*\)/.test(src),
      'the copy is unguarded — a missing image would fail the whole export'
    );
    assert.ok(
      !/writeFile\([^)]*screenshot/.test(src),
      'screenshot.png goes through writeFile, which is utf8-only and will corrupt it'
    );
  });

  console.log('');
  console.log(`  ${passed} passed, ${failed} failed`);
  console.log('');
  process.exit(failed === 0 ? 0 : 1);
})();
