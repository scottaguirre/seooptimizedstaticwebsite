const express = require('express');
const router = express.Router();

const { runProductionBuild } = require('../utils/runProductionBuild');

// PRODUCTION route.
//
// The build itself lives in utils/runProductionBuild.js so /download-zip can
// run it too — a user shouldn't have to know that "Run Production" exists
// before "Download" will work.
//
// The build is non-destructive: it copies dist/user_<id>/, optimises the copy
// and zips that, so the preview link keeps working and it can be re-run.

function page({ title, heading, body, actions, status = 200 }) {
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

function send(res, spec) {
  return res.status(spec.status).send(spec.html);
}

// POST, not GET.
//
// A GET with side effects can be triggered from any other website — an
// <img src="https://yourapp.com/production"> on a hostile page would make a
// logged-in user's browser start a build. The session cookie is sameSite:lax,
// which blocks cross-site POSTs but still sends cookies on cross-site GETs,
// so the method is what closes this.
router.post('/production', async (req, res) => {
  const userId = req.user._id.toString();
  const result = await runProductionBuild(userId);

  if (result.ok) {
    return send(res, page({
      title: 'Production Build Complete',
      heading: '✅ Your static website is ready!',
      body: '<p class="lead">Webpack has optimized your pages and your ZIP file is ready.</p>',
      actions: `
        <a href="/download-zip" class="btn btn-success btn-lg me-2">Download Website ZIP</a>
        <a href="/" class="btn btn-outline-light btn-lg">Back to Generator</a>`,
    }));
  }

  const messages = {
    'no-site': {
      status: 400,
      heading: '❌ No generated site found',
      body: '<p class="lead">Please generate your website first.</p>',
    },
    'in-progress': {
      status: 429,
      heading: '⏳ Already building',
      body: '<p class="lead">A production build is already running for your account. Please wait for it to finish.</p>',
    },
    'build-failed': {
      status: 500,
      heading: '❌ Production build failed',
      body: '<p class="lead">Something went wrong during the build. Check the server logs.</p>',
    },
  };

  const spec = messages[result.reason] || messages['build-failed'];

  return send(res, page({
    title: 'Production Build',
    heading: spec.heading,
    body: spec.body,
    status: spec.status,
    actions: '<a href="/" class="btn btn-primary btn-lg">Back to Generator</a>',
  }));
});

module.exports = router;