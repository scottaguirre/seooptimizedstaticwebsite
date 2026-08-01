const express = require('express');
const router = express.Router();
const path = require('path');
const { exec } = require('child_process');
const { zip } = require('zip-a-folder');
const fs = require('fs');

// === Custom Utility Functions ===
const { replaceInProd } = require('../utils/replaceInProd');
const { removeScriptAndLinkTags } = require('../utils/removeScriptAndLinkTags');
const { cleanDirectory, copyDirRecursive } = require('../utils/helpers');

const projectRoot = path.join(__dirname, '..');
const baseDistDir = path.join(projectRoot, 'dist');

// Build artifacts live OUTSIDE dist/ because server.js serves dist/ statically.
// Keeping zips out of the static tree stops anyone downloading another
// user's site by guessing their id.
const buildsRoot = path.join(projectRoot, 'builds');
const workRoot = path.join(buildsRoot, 'work');
const zipRoot = path.join(buildsRoot, 'zips');

// Guard against a user double-clicking "Run Production" and having two
// builds write into the same work folder at once.
// NOTE: this is per-process only. It is not a substitute for the global
// build queue we still want before real traffic.
const inFlight = new Set();

function getPaths(userId) {
  const safeId = String(userId);
  return {
    sourceDir: path.join(baseDistDir, `user_${safeId}`),
    workDir: path.join(workRoot, `user_${safeId}`),
    zipPath: path.join(zipRoot, `user_${safeId}.zip`),
  };
}

// After Webpack runs, the only css/js the HTML references are the
// content-hashed bundles. The originals we copied in for the preview
// are now dead weight, so drop them from the zip.
const HASHED = /\.[a-f0-9]{8,}\.(css|js)$/i;

function pruneUnhashedAssets(workDir) {
  ['css', 'js'].forEach(sub => {
    const dir = path.join(workDir, sub);
    if (!fs.existsSync(dir)) return;

    fs.readdirSync(dir, { withFileTypes: true }).forEach(entry => {
      if (!entry.isFile()) return;
      if (HASHED.test(entry.name)) return; // keep the Webpack output
      fs.unlinkSync(path.join(dir, entry.name));
    });
  });
}

function sendError(res, status, message) {
  return res.status(status).send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Production Build Failed</title>
    <link rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" />
  </head>
  <body class="bg-dark text-light d-flex align-items-center justify-content-center"
        style="min-height:100vh;">
    <div class="container text-center" style="max-width:700px;">
      <h1 class="mb-4">❌ Production build failed</h1>
      <p class="lead mb-4">${message}</p>
      <a href="/" class="btn btn-outline-light btn-lg">Back to Generator</a>
    </div>
  </body>
</html>`);
}


// PRODUCTION route.
//
// This step no longer modifies the generated site. It:
//   1) copies dist/user_<id>/  ->  builds/work/user_<id>/
//   2) cleans + Webpack-optimises the COPY
//   3) zips the copy into builds/zips/user_<id>.zip
//   4) deletes the working copy
//
// Because the source is untouched, the preview link keeps working and
// this route can be re-run as many times as the user likes.
router.get('/production', async (req, res) => {
  const userId = req.user._id.toString();
  const { sourceDir, workDir, zipPath } = getPaths(userId);

  if (!fs.existsSync(sourceDir)) {
    return sendError(res, 400, 'No generated site found for this user. Please run Generate first.');
  }

  if (inFlight.has(userId)) {
    return sendError(res, 429, 'A production build is already running for your account. Please wait for it to finish.');
  }

  inFlight.add(userId);

  try {
    // Ensure the build folders exist
    fs.mkdirSync(workRoot, { recursive: true });
    fs.mkdirSync(zipRoot, { recursive: true });

    // 1) Fresh copy every run, so repeated builds are idempotent
    cleanDirectory(workDir);
    copyDirRecursive(sourceDir, workDir);

    // 2) Prepare the COPY for production
    try {
      replaceInProd(workDir);           // replace "dist/" -> "" in href/src
      removeScriptAndLinkTags(workDir); // strip dev-only <script>/<link> tags
    } catch (err) {
      console.error('Error while preparing HTML for production:', err);
      return sendError(res, 500, 'Error preparing HTML for production. Check server logs.');
    }

    // 3) Run Webpack against the copy.
    // BUILD_DIR is an absolute path, so the build folder does not have to
    // live inside dist/.
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

    // 4) Strip build-only files so they never reach the user
    cleanDirectory(path.join(workDir, '_src'));
    pruneUnhashedAssets(workDir);

    // 5) Zip the optimised copy
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
    await zip(workDir, zipPath);
    console.log(`✅ Zipped user site to: ${zipPath}`);

    // 6) Drop the working copy — the zip is the deliverable
    cleanDirectory(workDir);

    return res.send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Production Build Complete</title>
    <link rel="stylesheet"
          href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" />
  </head>
  <body class="bg-dark text-light d-flex align-items-center justify-content-center"
        style="min-height:100vh;">
    <div class="container text-center">
      <h1 class="mb-4">✅ Your static website is ready!</h1>
      <p class="lead mb-4">
        Webpack has optimized your pages and your ZIP file is ready.
      </p>
      <a href="/download-zip" class="btn btn-success btn-lg me-2">Download Website ZIP</a>
      <a href="/" class="btn btn-outline-light btn-lg">Back to Generator</a>
    </div>
  </body>
</html>`);

  } catch (err) {
    console.error('Production build failed:', err);
    // Don't leave a half-built folder behind
    try { cleanDirectory(workDir); } catch (_) {}
    return sendError(res, 500, 'Webpack production build failed. Check server logs.');
  } finally {
    inFlight.delete(userId);
  }
});

module.exports = router;