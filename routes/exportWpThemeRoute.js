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

function page({ title, heading, body, actions, status = 200 }) {
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
    </div></div>
  </div>
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
router.get('/export-wp-theme', requireAuth, async (req, res) => {
  const userId = req.user._id.toString();
  const distDir = path.join(baseDistDir, `user_${userId}`);
  const workDir = path.join(wpWorkRoot, `user_${userId}`);
  const zipPath = path.join(wpZipRoot, `user_${userId}_wp-theme.zip`);

  if (!fs.existsSync(distDir)) {
    return send(res, page({
      status: 400,
      title: 'No Site Found',
      heading: '❌ No site found',
      body: '<p>Generate a website first, then convert it to WordPress.</p>',
      actions: '<a href="/" class="btn btn-primary">Go to Generator</a>',
    }));
  }

  if (!fs.existsSync(path.join(distDir, '_src', 'content.json'))) {
    return send(res, page({
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
        <a href="/" class="btn btn-outline-secondary">← Back to Generator</a>`,
    }));

  } catch (err) {
    console.error('❌ Error during /export-wp-theme:', err);
    try { cleanDirectory(workDir); } catch (_) {}

    return send(res, page({
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
      status: 404,
      title: 'Theme Not Found',
      heading: '⚠️ Theme not found',
      body: '<p>Your download may have expired, or the theme has not been exported yet.</p>',
      actions: `
        <a href="/export-wp-theme" class="btn btn-primary">Export WordPress Theme</a>
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