// routes/exportWpThemeRoute.js
const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const archiver = require('archiver');
const requireAuth = require('../middleware/requireAuth');

const { buildWordPressThemeFromModel } = require('../utils/wpThemeBuilder/buildFromModel');
const { cleanDirectory } = require('../utils/helpers');

const projectRoot = path.join(__dirname, '..');
const baseDistDir = path.join(projectRoot, 'dist');

// Themes are built OUTSIDE dist/ for two reasons:
//   1. dist/ is served statically, so a theme inside it would be public
//   2. /production copies dist/user_<id>, so a theme in there would end up
//      inside the static site's ZIP
const wpWorkRoot = path.join(projectRoot, 'builds', 'wp');
const wpZipRoot = path.join(projectRoot, 'builds', 'zips');

const THEME_SLUG = 'local-business-theme';

const inFlight = new Set();

function zipDirectory(sourceDir, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', resolve);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(sourceDir, path.basename(sourceDir));
    archive.finalize();
  });
}

/**
 * @param {object} opts
 * @param {string} [opts.csrfToken]  passed in, NOT read from res.
 *
 * This helper is a standalone function with no request in scope. An earlier
 * version interpolated ${res.locals.csrfToken} here, which threw
 * "res is not defined" AFTER the theme had already been built — so the
 * response was never sent and the browser span forever.
 */
function page({ title, heading, body, actions, status = 200, csrfToken = '' }) {
  return { status, html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet" />
</head>
<body class="bg-light">
  <div class="container py-5" style="max-width: 800px;">
    <div class="card shadow-lg"><div class="card-body p-5">
      <h1 class="h3 mb-3">${heading}</h1>
      ${body}
      <div class="d-grid gap-3 mt-4">${actions}</div>
      <div id="siteAlert" class="alert alert-danger mt-3 d-none" role="alert"></div>
    </div></div>
  </div>

  <div id="overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.8);display:none;
       flex-direction:column;align-items:center;justify-content:center;z-index:9999;color:#fff;">
    <div class="spinner-border text-light" role="status" style="width:4rem;height:4rem;">
      <span class="visually-hidden">Working...</span>
    </div>
    <p class="mt-3 fs-5" id="overlayText">Optimizing your website... please wait</p>
    <p class="text-white-50">This can take up to a minute.</p>
  </div>

  <script>
    (function () {
      const btn = document.getElementById('dlStatic');
      if (!btn) return;

      const overlay     = document.getElementById('overlay');
      const overlayText = document.getElementById('overlayText');
      const alertBox    = document.getElementById('siteAlert');

      btn.addEventListener('click', async () => {
        alertBox.classList.add('d-none');
        btn.disabled = true;
        overlay.style.display = 'flex';

        try {
          // POST: /production performs an expensive build, so it must not be
                  // reachable by a cross-site GET.
                  // The token is baked into the page when it renders — these
                  // are server-rendered strings, so there is no meta tag to
                  // read. Without it /production returns 403 and the user
                  // sees "The build failed", which is misleading: the build
                  // never started.
                  //
                  // Accept: application/json, because /production answers in
                  // whichever shape the caller asks for — JSON here, a real
                  // 302 for the plain form in downloadZipRoute.
                  const buildRes = await fetch('/production', {
                    method: 'POST',
                    headers: {
                      'Accept': 'application/json',
                      'X-CSRF-Token': '${csrfToken}',
                    },
                  });

                  if (buildRes.status === 403) {
                    throw new Error('Your session expired. Please refresh the page and try again.');
                  }
                  if (!buildRes.ok) {
                    throw new Error('The build could not be started. Please try again.');
                  }

          // Queued, not finished — see the note in authRoute.js. Going to
          // /download-zip here would arrive before the ZIP exists.
          const data = await buildRes.json().catch(() => ({}));

          overlayText.textContent = 'Preparing your download...';
          window.location.href = data.redirect || '/dashboard';

        } catch (err) {
          overlay.style.display = 'none';
          btn.disabled = false;
          alertBox.textContent = err.message || 'Something went wrong.';
          alertBox.classList.remove('d-none');
        }
      });
    })();
  </script>
</body>
</html>` };
}

function send(res, spec) {
  return res.status(spec.status).send(spec.html);
}


/**
 * GET /export-wp-theme
 * Build a WordPress theme from the generated content model.
 */
// POST for the same reason as /production: building a theme is expensive and
// must not be triggerable from another site.
router.post('/export-wp-theme', requireAuth, async (req, res) => {
  const userId = req.user._id.toString();
  const distDir = path.join(baseDistDir, `user_${userId}`);
  const workDir = path.join(wpWorkRoot, `user_${userId}`);
  const zipPath = path.join(wpZipRoot, `user_${userId}_wp-theme.zip`);

  if (!fs.existsSync(distDir)) {
    return send(res, page({
      csrfToken: res.locals.csrfToken || '',
      status: 400,
      title: 'No Site Found',
      heading: '❌ No site found',
      body: '<p>Generate a website first, then convert it to WordPress.</p>',
      actions: '<a href="/" class="btn btn-primary">Go to Generator</a>',
    }));
  }

  if (!fs.existsSync(path.join(distDir, '_src', 'content.json'))) {
    return send(res, page({
      csrfToken: res.locals.csrfToken || '',
      status: 400,
      title: 'Regenerate Required',
      heading: '⚠️ Please regenerate your site',
      body: `<p>This site was built before the WordPress exporter was updated,
             so it has no content model. Regenerating takes a moment and produces
             a far better WordPress theme — every field properly named and editable.</p>`,
      actions: '<a href="/" class="btn btn-primary">Back to Generator</a>',
    }));
  }

  if (inFlight.has(userId)) {
    return send(res, page({
      csrfToken: res.locals.csrfToken || '',
      status: 429,
      title: 'Build In Progress',
      heading: '⏳ Already building',
      body: '<p>A WordPress export is already running for your account.</p>',
      actions: '<a href="/" class="btn btn-primary">Back to Generator</a>',
    }));
  }

  inFlight.add(userId);

  try {
    fs.mkdirSync(wpWorkRoot, { recursive: true });
    fs.mkdirSync(wpZipRoot, { recursive: true });

    // Fresh build every time
    cleanDirectory(workDir);
    fs.mkdirSync(workDir, { recursive: true });

    const businessName = req.user.businessName || '';

    // A design sample is a one-page mock with links that all return to
    // itself. Exporting it as a WordPress theme would produce a site whose
    // menu goes nowhere, so refuse rather than ship something broken.
    let siteMode = 'lead';
    try {
      const modelJson = JSON.parse(
        fs.readFileSync(path.join(distDir, '_src', 'content.json'), 'utf8')
      );
      siteMode = modelJson?.global?.siteMode || 'lead';
    } catch (err) {
      // Unreadable model: fall through and let the build report the problem
    }

    if (siteMode === 'sample') {
      return send(res, page({
        csrfToken: res.locals.csrfToken || '',
        status: 400,
        title: 'Not available for samples',
        heading: 'WordPress export is not available for design samples',
        body: '<p class="lead">A design sample is a single page for showing a client. Generate a Lead Generation website to export a WordPress theme.</p>',
        actions: `
          <a href="/" class="btn btn-primary btn-lg">Back to Generator</a>
          <a href="/dashboard" class="btn btn-outline-secondary">My Dashboard</a>`,
      }));
    }

    const { themeDir, summary } = await buildWordPressThemeFromModel(distDir, {
      themeSlug: THEME_SLUG,
      themeName: businessName ? `${businessName} Theme` : 'Local Business Theme',
      themeAuthor: 'Static Website Generator',
      themeVersion: '1.0.0',
      outputRoot: workDir,
    });

    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }
    await zipDirectory(themeDir, zipPath);

    // The ZIP is the deliverable; drop the working copy
    cleanDirectory(workDir);

    const stat = fs.statSync(zipPath);
    const sizeMb = (stat.size / 1024 / 1024).toFixed(1);

    return send(res, page({
      csrfToken: res.locals.csrfToken || '',
      title: 'WordPress Theme Ready',
      heading: '✅ WordPress theme ready',
      body: `
        <div class="row text-center my-4">
          <div class="col-md-4"><div class="display-6">${summary.pages}</div>
            <div class="text-muted small text-uppercase">Pages</div></div>
          <div class="col-md-4"><div class="display-6">${summary.contentFields}</div>
            <div class="text-muted small text-uppercase">Editable text fields</div></div>
          <div class="col-md-4"><div class="display-6">${summary.images}</div>
            <div class="text-muted small text-uppercase">Replaceable images</div></div>
        </div>
        <div class="alert alert-info">
          <strong>What your client can edit:</strong>
          <ul class="mb-0 mt-2">
            <li>Any heading or paragraph, with links and highlighting</li>
            <li>Every image, from the WordPress media library</li>
            <li>Business name, phone, email and social links in one place</li>
            <li>Extra sections added to the bottom of any page</li>
          </ul>
        </div>
        <p class="text-muted small mb-0">ZIP size: ${sizeMb} MB</p>`,
      actions: `
        <a href="/download-wp-theme" class="btn btn-primary btn-lg">📥 Download WordPress Theme</a>
        <button type="button" id="dlStatic" class="btn btn-outline-primary">Download HTML Site</button>
        <a href="/dashboard" class="btn btn-outline-secondary">My Dashboard</a>
        <a href="/" class="btn btn-outline-secondary">← Back to Generator</a>`,
    }));

  } catch (err) {
    console.error('❌ Error during /export-wp-theme:', err);
    try { cleanDirectory(workDir); } catch (_) {}

    return send(res, page({
      csrfToken: res.locals.csrfToken || '',
      status: 500,
      title: 'Export Failed',
      heading: '❌ Could not build the theme',
      body: `<div class="alert alert-danger"><strong>Error:</strong> ${err.message}</div>`,
      actions: '<a href="/" class="btn btn-primary">Back to Generator</a>',
    }));
  } finally {
    inFlight.delete(userId);
  }
});


/**
 * GET /download-wp-theme
 */
router.get('/download-wp-theme', requireAuth, (req, res) => {
  const userId = req.user._id.toString();
  const zipPath = path.join(wpZipRoot, `user_${userId}_wp-theme.zip`);

  if (!fs.existsSync(zipPath)) {
    return send(res, page({
      csrfToken: res.locals.csrfToken || '',
      status: 404,
      title: 'Theme Not Found',
      heading: '⚠️ Theme not found',
      body: '<p>Your download may have expired, or the theme has not been exported yet.</p>',
      actions: `
        <form action="/export-wp-theme" method="POST" class="d-inline">
              ${res.locals.csrfField || ''}
          <button type="submit" class="btn btn-primary">Export WordPress Theme</button>
        </form>
        <a href="/" class="btn btn-outline-secondary">← Back to Generator</a>`,
    }));
  }

  res.download(zipPath, 'wordpress-theme.zip', err => {
    if (err) {
      console.error(`Error sending WP theme zip for user ${userId}:`, err);
    }
  });
});

module.exports = router;