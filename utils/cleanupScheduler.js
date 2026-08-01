// utils/cleanupScheduler.js
//
// Generated sites are build artifacts, not user data. Keeping every site
// from every user forever will fill the disk, so anything older than the
// TTL is deleted.
//
// Policy: if a user's build has expired, they generate again and spend
// credits again. Nothing is rebuilt automatically.
//
// Expiry is driven by the filesystem (mtime), not by an in-memory Map,
// so it survives a server restart.

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');

const DIST_DIR = path.join(projectRoot, 'dist');
const WORK_DIR = path.join(projectRoot, 'builds', 'work');
const ZIP_DIR = path.join(projectRoot, 'builds', 'zips');

// How long a build survives after its last write.
const TTL_MS = Number(process.env.BUILD_TTL_HOURS || 24) * 60 * 60 * 1000;

// How often to sweep.
const SWEEP_INTERVAL_MS = Number(process.env.BUILD_SWEEP_MINUTES || 60) * 60 * 1000;


/**
 * mtime of a folder only changes when its direct children change, so a
 * long build could look stale. Walk one level down and take the newest
 * timestamp we find.
 */
function newestMtime(targetPath) {
  let newest = 0;

  try {
    const stat = fs.statSync(targetPath);
    newest = stat.mtimeMs;

    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(targetPath, { withFileTypes: true })) {
        const child = path.join(targetPath, entry.name);
        try {
          const childStat = fs.statSync(child);
          if (childStat.mtimeMs > newest) newest = childStat.mtimeMs;
        } catch (_) { /* vanished mid-sweep; ignore */ }
      }
    }
  } catch (_) {
    return 0;
  }

  return newest;
}


function removePath(targetPath) {
  try {
    fs.rmSync(targetPath, { recursive: true, force: true });
    return true;
  } catch (err) {
    console.error(`🧹 Failed to remove ${targetPath}:`, err.message);
    return false;
  }
}


/**
 * Delete entries in `dir` matching `pattern` whose newest mtime is older
 * than the TTL.
 */
function sweepDir(dir, pattern, label) {
  if (!fs.existsSync(dir)) return 0;

  const cutoff = Date.now() - TTL_MS;
  let removed = 0;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.error(`🧹 Could not read ${dir}:`, err.message);
    return 0;
  }

  for (const entry of entries) {
    if (!pattern.test(entry.name)) continue;

    const fullPath = path.join(dir, entry.name);
    const mtime = newestMtime(fullPath);

    if (mtime && mtime < cutoff) {
      if (removePath(fullPath)) {
        removed++;
        console.log(`🧹 Removed expired ${label}: ${entry.name}`);
      }
    }
  }

  return removed;
}


/**
 * Run one sweep across all three artifact locations.
 * Exported so it can be triggered manually or from a test.
 */
function runCleanup() {
  const started = Date.now();

  const sites = sweepDir(DIST_DIR, /^user_/, 'site');
  const work = sweepDir(WORK_DIR, /^user_/, 'work folder');
  const zips = sweepDir(ZIP_DIR, /^user_.*\.zip$/, 'zip');

  const total = sites + work + zips;

  if (total > 0) {
    console.log(
      `🧹 Cleanup finished in ${Date.now() - started}ms — ` +
      `${sites} site(s), ${work} work folder(s), ${zips} zip(s) removed.`
    );
  }

  return { sites, work, zips };
}


/**
 * Start the periodic sweep. Call once from server.js.
 */
function startCleanupScheduler() {
  const ttlHours = (TTL_MS / 1000 / 60 / 60).toFixed(1);
  const everyMinutes = (SWEEP_INTERVAL_MS / 1000 / 60).toFixed(0);

  console.log(`🧹 Build cleanup active: TTL ${ttlHours}h, sweeping every ${everyMinutes}m`);

  // Sweep once at boot to clear anything left behind by a crash or restart
  runCleanup();

  const timer = setInterval(runCleanup, SWEEP_INTERVAL_MS);

  // Don't hold the process open just for the sweeper
  if (typeof timer.unref === 'function') timer.unref();

  return timer;
}


module.exports = {
  runCleanup,
  startCleanupScheduler,
  TTL_MS,
};