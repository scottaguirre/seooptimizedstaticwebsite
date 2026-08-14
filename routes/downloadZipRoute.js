const express = require('express');
const router = express.Router();
const fs = require('fs');

const {
  getPaths,
  isBuilding,
} = require('../utils/runProductionBuild');

// DOWNLOAD-ZIP route.
//
// If no ZIP exists yet, this builds one rather than 404ing. Previously the
// user had to click "Run Production" first — a step that meant nothing to
// them and produced a dead end if skipped.
//
// The ZIP is NOT deleted after download: a dropped connection or a second
// attempt shouldn't force a full rebuild. Expiry is handled centrally by
// utils/cleanupScheduler.js.

function errorPage({ title, heading, body, actions, status }) {
  return { status, html: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>${title}</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" />
  </head>
  <body class="bg-dark text-light d-flex align-items-center justify-content-center" style="min-height:100vh;">
    <div class="container text-center" style="max-width:700px;">
      <h1 class="mb-4">${heading}</h1>
      ${body}
      <div class="mt-4">${actions}</div>
    </div>
  </body>
</html>` };
}

router.get('/download-zip', async (req, res) => {
  const userId = req.user._id.toString();
  const { zipPath } = getPaths(userId);

  // This route stays GET because a browser download needs a navigation, but
  // it must NOT build.
  //
  // It used to run the production build when no ZIP existed. That made an
  // expensive operation reachable by GET, which any other site could trigger
  // in a logged-in user's browser — the same hole that moving /production to
  // POST was meant to close. Serving an existing file is cheap and safe;
  // creating one is not, so that now needs the POST route.
  if (!fs.existsSync(zipPath)) {
    const spec = errorPage({
      status: 404,
      title: 'Nothing to download yet',
      heading: 'Your download is not ready',
      body: '<p class="lead">Use the Download HTML Site button to build your site first.</p>',
      actions: `
        <form action="/production" method="POST" class="d-inline">
              ${res.locals.csrfField || ''}
          <button type="submit" class="btn btn-primary btn-lg">Build my site now</button>
        </form>
        <a href="/dashboard" class="btn btn-outline-secondary">My Dashboard</a>`,
    });
    return res.status(spec.status).send(spec.html);
  }

  res.download(zipPath, 'website.zip', err => {
    if (err) {
      console.error(`Error sending zip for user ${userId}:`, err);
    }
  });
});

module.exports = router;