// routes/pluginDownloadRoute.js
//
// Where a customer gets the plugin.
//
// Until this existed there was no way to get it at all. The licence key page
// told people to "install the Interlink Engine plugin" and then said nothing
// about where it comes from — so the one thing standing between a paying
// customer and a working feature was a file they had no way to obtain.
//
// WHY GET IS SAFE HERE, WHEN /download-zip WORRIED ABOUT IT
//
// downloadZipRoute deliberately refuses to BUILD on a GET, because building a
// customer's site is expensive and per-user, and any other website could make
// a logged-in browser fire that request. Neither applies here. This archive is
// the same handful of PHP files for everybody, it takes milliseconds, and it
// is cached after the first request. There is nothing worth protecting, and a
// download has to be a navigation.

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/requireAuth');
const { appHeader, appHeaderAssets, appHeaderScripts } = require('../utils/appHeader');
const { pageTitle } = require('../utils/pageTitle');
const { ensureZip } = require('../utils/pluginPackage');
const { log } = require('../utils/logger');

router.get('/plugin/download', requireAuth, async (req, res) => {
  try {
    const { zipPath, filename, version } = await ensureZip();

    log.info('plugin.downloaded', {
      requestId: req.id,
      userId: String(req.user._id),
      version,
    });

    // The filename carries the version so a customer can tell which build they
    // have on disk. It does NOT decide the installed folder name — WordPress
    // takes that from the top-level directory inside the archive — so
    // downloading 0.4.0 still upgrades the same plugin rather than installing
    // a second copy beside it.
    res.download(zipPath, filename, (err) => {
      // Fires on a cancelled or dropped download too, which is not an error
      // worth alarming anyone about. Recorded, not escalated.
      if (err && !res.headersSent) {
        log.error('plugin.download.sendFailed', err, { requestId: req.id });
      }
    });

  } catch (err) {
    log.error('plugin.download.failed', err, {
      requestId: req.id,
      userId: String(req.user?._id || ''),
    });

    res.status(500).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${pageTitle('Download failed')}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
${appHeaderAssets()}
</head>
<body style="background:#082d5b;" class=" text-white">
${appHeader(res.locals.csrfField || '')}
  <div class="container py-5" style="max-width: 700px;">
    <h1>We could not build the plugin download</h1>
    <p class="lead">This is our problem, not yours. Please try again in a moment.</p>
    <p class="text-white-50 small">Reference: ${req.id || 'unknown'}</p>
    <a href="/blog-sites" class="btn btn-primary mt-3">Back to Blog Automation</a>
  </div>
${appHeaderScripts()}
</body>
</html>`);
  }
});

module.exports = router;