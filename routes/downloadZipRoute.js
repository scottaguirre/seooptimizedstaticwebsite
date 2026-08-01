const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');

const projectRoot = path.join(__dirname, '..');
const zipRoot = path.join(projectRoot, 'builds', 'zips');

// DOWNLOAD-ZIP route to download this user's zipped website.
//
// The zip is NOT deleted after download: a dropped connection or a second
// download attempt shouldn't force the user to re-run the whole production
// build. Expiry is handled centrally by utils/cleanupScheduler.js.
router.get('/download-zip', (req, res) => {
  const userId = req.user._id.toString();
  const zipPath = path.join(zipRoot, `user_${userId}.zip`);

  if (!fs.existsSync(zipPath)) {
    return res.status(404).send(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>ZIP Not Found</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" />
  </head>
  <body class="bg-dark text-light d-flex align-items-center justify-content-center" style="min-height:100vh;">
    <div class="container text-center" style="max-width:700px;">
      <h1 class="mb-4">ZIP file not found</h1>
      <p class="lead mb-4">
        Your download may have expired, or the production build hasn't been run yet.
      </p>
      <a href="/production" class="btn btn-primary btn-lg me-2">Run Production</a>
      <a href="/" class="btn btn-outline-light btn-lg">Back to Generator</a>
    </div>
  </body>
</html>`);
  }

  res.download(zipPath, 'website.zip', err => {
    if (err) {
      console.error(`Error sending zip for user ${userId}:`, err);
    }
  });
});

module.exports = router;