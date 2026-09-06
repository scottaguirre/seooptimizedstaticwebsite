// utils/pluginPackage.js
//
// Turns the plugin source in wp-plugin/interlink-engine into the ZIP a
// customer downloads.
//
// WHY THIS BUILDS RATHER THAN SERVING A COMMITTED FILE
//
// The alternative is a finished interlink-engine.zip sitting in the repo. It
// is less code and it is wrong, because it can be stale and nothing notices.
// The plugin and the server are two halves of one protocol — 0.1.0 and 0.2.0
// call endpoints that no longer exist — so a customer downloading last
// month's ZIP gets 404s from a server that is working perfectly. Building
// from source means the version they download is the version in the
// repository, always, with no step for anyone to forget.
//
// THE CACHE IS KEYED ON MTIME, NOT ONLY ON VERSION
//
// Keying on the version alone would be enough in production and useless in
// development, where files change constantly and the version is bumped once
// at the end. So the archive is rebuilt whenever any source file is newer
// than it. Zipping 150 KB of PHP takes a few milliseconds; there is nothing
// to protect here that is worth the risk of serving a stale build.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const archiver = require('archiver');
const { log } = require('./logger');

const PLUGIN_SLUG = 'interlink-engine';

const SOURCE_DIR = path.join(__dirname, '..', 'wp-plugin', PLUGIN_SLUG);
const MAIN_FILE = path.join(SOURCE_DIR, `${PLUGIN_SLUG}.php`);

// builds/ is already in .gitignore, so the cache never reaches a commit.
const CACHE_DIR = path.join(__dirname, '..', 'builds', 'plugin');

// Everything here is shipped to a stranger's WordPress install. Dotfiles are
// dropped wholesale by `dot: false` below — that is what keeps .DS_Store and
// .git out — and these are the rest.
const EXCLUDE = ['node_modules/**', '**/*.zip', '**/*.log'];

/* -------------------------------------------------------------------------
 * Version
 * ---------------------------------------------------------------------- */

let versionCache = { mtimeMs: -1, value: null };

/**
 * The version from the plugin's own header — the same line WordPress reads.
 *
 * Read from the file rather than kept in a constant here, because a constant
 * is a second place to update and would eventually disagree with the header.
 * WordPress believes the header; so does this.
 */
function readVersion() {
  const stat = fs.statSync(MAIN_FILE);

  if (versionCache.value && versionCache.mtimeMs === stat.mtimeMs) {
    return versionCache.value;
  }

  // The header is inside the opening docblock, well within the first few KB.
  const head = fs.readFileSync(MAIN_FILE, 'utf8').slice(0, 8192);
  const match = /^[\s*]*Version:\s*([0-9][0-9A-Za-z.\-+]*)/m.exec(head);

  if (!match) {
    throw new Error(`No "Version:" header found in ${MAIN_FILE}`);
  }

  versionCache = { mtimeMs: stat.mtimeMs, value: match[1] };
  return match[1];
}

/* -------------------------------------------------------------------------
 * Packaging
 * ---------------------------------------------------------------------- */

/** The newest mtime anywhere in the source tree. */
function newestSourceMtime(dir) {
  let newest = 0;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;

    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestSourceMtime(full));
    } else if (entry.isFile()) {
      newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  }

  return newest;
}

/**
 * Write the archive.
 *
 * Built to a temporary name and renamed into place, because rename is atomic
 * and a plain write is not: a second request arriving mid-build would
 * otherwise find a file that exists, is the right age, and is half a ZIP.
 */
async function build(zipPath, version) {
  await fsp.mkdir(CACHE_DIR, { recursive: true });

  const tmp = `${zipPath}.${process.pid}.${Date.now()}.tmp`;

  try {
    await new Promise((resolve, reject) => {
      const out = fs.createWriteStream(tmp);
      const archive = archiver('zip', { zlib: { level: 9 } });

      out.on('close', resolve);
      out.on('error', reject);
      archive.on('error', reject);

      // A missing-file warning means the archive is incomplete, which is
      // exactly the thing not to hand to a customer.
      archive.on('warning', reject);

      archive.pipe(out);

      // `prefix` puts everything under interlink-engine/ inside the ZIP.
      // WordPress takes the plugin's folder name from that top-level
      // directory, not from the filename — so without it the plugin would
      // install as a pile of loose files and not appear in the plugin list
      // at all.
      archive.glob('**/*', { cwd: SOURCE_DIR, dot: false, ignore: EXCLUDE }, { prefix: PLUGIN_SLUG });

      archive.finalize();
    });

    await fsp.rename(tmp, zipPath);

    log.info('plugin.packaged', { version, zip: path.basename(zipPath) });

  } catch (err) {
    await fsp.rm(tmp, { force: true }).catch(() => {});
    throw err;
  }
}

// One build at a time. Without this, ten people clicking Download in the same
// second start ten archivers over the same output path.
//
// It is not a lock, and does not need to be. A request arriving in the exact
// moment between the build finishing and this being cleared will start a
// second, identical build — which is harmless, because the write goes to a
// temporary file and lands by rename. The failure this prevents is ten
// concurrent builds; the failure the rename prevents is anyone reading a
// half-written archive. Neither needs to be perfect on its own.
let inFlight = null;

/**
 * The path to a current ZIP, building one if there isn't one.
 *
 * @returns {Promise<{ zipPath: string, version: string, filename: string }>}
 */
async function ensureZip() {
  const version = readVersion();
  const filename = `${PLUGIN_SLUG}-${version}.zip`;
  const zipPath = path.join(CACHE_DIR, filename);

  const newest = newestSourceMtime(SOURCE_DIR);

  try {
    const stat = await fsp.stat(zipPath);
    if (stat.mtimeMs >= newest) {
      return { zipPath, version, filename };
    }
  } catch (_) {
    // No cached archive yet. Build one.
  }

  if (!inFlight) {
    inFlight = build(zipPath, version).finally(() => { inFlight = null; });
  }

  await inFlight;

  return { zipPath, version, filename };
}

/**
 * Is the plugin source actually present?
 *
 * Called by the pages that offer a download link, so a missing folder shows
 * up as an honest "not available" rather than a button that 500s. That is not
 * hypothetical: the deploy rsync excludes several directories, and adding a
 * new one to the tree is exactly the kind of thing that gets left out of it.
 */
function isAvailable() {
  try {
    return fs.existsSync(MAIN_FILE);
  } catch (_) {
    return false;
  }
}

/** The version, or null if the source is missing. Never throws. */
function versionOrNull() {
  try {
    return isAvailable() ? readVersion() : null;
  } catch (_) {
    return null;
  }
}

module.exports = {
  PLUGIN_SLUG,
  SOURCE_DIR,
  CACHE_DIR,
  ensureZip,
  readVersion,
  versionOrNull,
  isAvailable,
};