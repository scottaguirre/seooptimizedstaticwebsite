// utils/runProductionBuild.js
//
// The static production build, extracted so both /production and
// /download-zip can use it.
//
// It used to live inline in the route handler, which meant /download-zip
// could only 404 when no ZIP existed — the user had to go back and click
// "Run Production" first, a step that exists for no reason they can see.
//
// The build is non-destructive: dist/user_<id>/ is copied, the copy is
// optimised, and only the copy is zipped. The generated site is untouched,
// so the preview keeps working and this can be re-run safely.

const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');
const { zip } = require('zip-a-folder');
const { buildLimiter } = require('./concurrencyLimiter');

const { replaceInProd } = require('./replaceInProd');
const { removeScriptAndLinkTags } = require('./removeScriptAndLinkTags');
const { cleanDirectory, copyDirRecursive } = require('./helpers');

const projectRoot = path.join(__dirname, '..');
const baseDistDir = path.join(projectRoot, 'dist');

// Build artifacts live OUTSIDE dist/, which is served statically.
const buildsRoot = path.join(projectRoot, 'builds');
const workRoot = path.join(buildsRoot, 'work');
const zipRoot = path.join(buildsRoot, 'zips');

// One build per user at a time. Two concurrent runs would share the work
// folder and overwrite each other mid-build.
const inFlight = new Set();

// After Webpack, the HTML only references content-hashed bundles. The
// originals copied in for the preview are dead weight in the ZIP.
const HASHED = /\.[a-f0-9]{8,}\.(css|js)$/i;

function getPaths(userId) {
  const safeId = String(userId);
  return {
    sourceDir: path.join(baseDistDir, `user_${safeId}`),
    workDir: path.join(workRoot, `user_${safeId}`),
    zipPath: path.join(zipRoot, `user_${safeId}.zip`),
  };
}

function pruneUnhashedAssets(workDir) {
  ['css', 'js'].forEach(sub => {
    const dir = path.join(workDir, sub);
    if (!fs.existsSync(dir)) return;

    fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
      if (!entry.isFile()) return;
      if (HASHED.test(entry.name)) return;
      fs.unlinkSync(path.join(dir, entry.name));
    });
  });
}

function isBuilding(userId) {
  return inFlight.has(String(userId));
}

function zipExists(userId) {
  return fs.existsSync(getPaths(userId).zipPath);
}

/**
 * Copy → optimise → zip.
 *
 * @returns {Promise<{ok: boolean, zipPath?: string, reason?: string, error?: Error}>}
 *          Never throws; callers decide how to present a failure.
 */
async function runProductionBuild(userId) {
  const id = String(userId);
  const { sourceDir, workDir, zipPath } = getPaths(id);

  if (!fs.existsSync(sourceDir)) {
    return { ok: false, reason: 'no-site' };
  }

  if (inFlight.has(id)) {
    return { ok: false, reason: 'in-progress' };
  }

  inFlight.add(id);

  // Webpack is CPU-bound and holds a few hundred MB. Several at once on a
  // small VPS invites the OOM killer, which takes the whole server with it —
  // so builds queue globally, not just per user.
  let releaseSlot = () => {};

  try {
    releaseSlot = await buildLimiter.acquire({ userId: id });
  } catch (err) {
    inFlight.delete(id);
    return {
      ok: false,
      reason: err.code === 'QUEUE_FULL' ? 'too-busy' : 'timed-out',
      error: err,
    };
  }

  try {
    fs.mkdirSync(workRoot, { recursive: true });
    fs.mkdirSync(zipRoot, { recursive: true });

    // 1. Fresh copy every run, so repeated builds are idempotent
    cleanDirectory(workDir);
    copyDirRecursive(sourceDir, workDir);

    // 2. Prepare the COPY for production
    replaceInProd(workDir);           // "dist/" -> "" in href/src
    removeScriptAndLinkTags(workDir); // strip dev-only tags

    // 3. Webpack, against the copy
    await new Promise((resolve, reject) => {
      exec(
        'npm run build:webpack',
        {
          cwd: projectRoot,
          env: { ...process.env, NODE_ENV: 'production', BUILD_DIR: workDir },
          maxBuffer: 1024 * 1024 * 10,
        },
        (error, stdout, stderr) => {
          if (stdout) console.log(stdout);
          if (stderr) console.error(stderr);
          if (error) return reject(error);
          resolve();
        }
      );
    });

    // 4. Strip build-only files
    cleanDirectory(path.join(workDir, '_src'));
    pruneUnhashedAssets(workDir);

    // 5. Zip
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
    await zip(workDir, zipPath);
    console.log(`✅ Zipped user site to: ${zipPath}`);

    // 6. The ZIP is the deliverable; drop the working copy
    cleanDirectory(workDir);

    return { ok: true, zipPath };

  } catch (err) {
    console.error('Production build failed:', err);
    try { cleanDirectory(workDir); } catch (_) { /* best effort */ }
    return { ok: false, reason: 'build-failed', error: err };

  } finally {
    // Both always released, including on failure. Leaking the build slot
    // would shrink the pool permanently; leaking the per-user lock would
    // stop that user rebuilding until a restart.
    releaseSlot();
    inFlight.delete(id);
  }
}

module.exports = {
  runProductionBuild,
  getPaths,
  isBuilding,
  zipExists,
  zipRoot,
};