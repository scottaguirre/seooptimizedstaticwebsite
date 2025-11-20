const express = require('express');
const router = express.Router();
const path = require('path');
const { exec } = require('child_process');
const { zip } = require('zip-a-folder');
const fs = require('fs');

// === Custom Utility Functions ===
const { replaceInProd } = require('../utils/replaceInProd');
const { removeScriptAndLinkTags } = require('../utils/removeScriptAndLinkTags');

// PRODUCTION route to:
// 1) clean HTML links inside this user's folder
// 2) run Webpack only for this user
// 3) zip their site for download
router.get('/production', (req, res) => {
  if (!req.user) {
    return res.status(401).send('❌ Not authenticated.');
  }

  const userId = req.user._id.toString();
  const projectRoot = path.join(__dirname, '..');
  const distDir = path.join(projectRoot, 'dist', `user_${userId}`);

  if (!fs.existsSync(distDir)) {
    return res
      .status(400)
      .send('❌ No generated site found for this user. Please run Generate first.');
  }

  // 1) Fix HTML paths inside this user's build folder
  try {
    replaceInProd(distDir);          // replace "dist/" -> "" in href/src
    removeScriptAndLinkTags(distDir); // strip dev-only <script>/<link> tags
  } catch (err) {
    console.error('Error while preparing HTML for production:', err);
    return res
      .status(500)
      .send('❌ Error preparing HTML for production. Check server logs.');
  }

  // 2) Run Webpack with BUILD_SUBDIR=user_<id> so it builds only this folder
  const cmd = `NODE_ENV=production BUILD_SUBDIR=user_${userId} npm run build:webpack`;

  exec(cmd, { cwd: projectRoot }, async (error, stdout, stderr) => {
    console.log(stdout);
    if (stderr) console.error(stderr);

    if (error) {
      console.error('Webpack build failed:', error);
      return res
        .status(500)
        .send('❌ Webpack production build failed. Check server logs.');
    }

    // 3) Zip just this user's folder -> dist_user_<id>.zip
    try {
      const zipOutput = path.join(projectRoot, `dist_user_${userId}.zip`);
      await zip(distDir, zipOutput);
      console.log(`✅ Zipped user site to: ${zipOutput}`);
    } catch (zipErr) {
      console.error('Error zipping user site:', zipErr);
      return res
        .status(500)
        .send('❌ Failed to zip generated website. Check server logs.');
    }

    // Success HTML response
    res.send(`<!DOCTYPE html>
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
  });
});

module.exports = router;
