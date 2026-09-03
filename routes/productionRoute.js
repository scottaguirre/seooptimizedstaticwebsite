const express = require('express');
const router = express.Router();

const Job = require('../models/Job');
const { getPaths, isBuilding } = require('../utils/runProductionBuild');
const { log } = require('../utils/logger');
const fs = require('fs');

// PRODUCTION route.
//
// The build itself lives in utils/runProductionBuild.js so /download-zip can
// serve what it produces — a user shouldn't have to know that "Run Production"
// exists before "Download" will work.
//
// The build is non-destructive: it copies dist/user_<id>/, optimises the copy
// and zips that, so the preview link keeps working and it can be re-run.
//
// IT IS NOW A JOB, NOT A REQUEST
//
// This used to `await runProductionBuild(userId)` and render the result.
// Webpack on a hundred entry points takes minutes; browsers abandon a request
// long before that, and proxies usually cut it at 30-60 seconds. The build
// carried on server-side and finished into a ZIP the customer was never told
// about — they saw a hung tab, and often pressed the button again.
//
// So this enqueues and redirects to the progress page that site generation
// already uses. Same Job model, same polling, same resume-after-crash.

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

/**
 * Answer in the shape the caller can actually use.
 *
 * THREE callers, and they are not alike:
 *
 *   authRoute.js         the dashboard's Download button, via fetch()
 *   exportWpThemeRoute   the WordPress export, via fetch()
 *   downloadZipRoute     a plain <form method="POST">, which needs to navigate
 *
 * A bare res.redirect() serves the form and breaks both fetches; bare JSON
 * does the opposite. So the two that ask for JSON get { ok, jobId, redirect }
 * — the same shape /generate already returns, so there is one convention
 * rather than a third — and anything else gets a real 302.
 */
function queued(req, res, job) {
  if (req.accepts(['html', 'json']) === 'json') {
    return res.json({
      ok: true,
      jobId: String(job._id),
      redirect: `/jobs/${job._id}`,
    });
  }

  return res.redirect(`/jobs/${job._id}`);
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

  try {
    const { sourceDir } = getPaths(userId);

    // Checked here rather than inside the job. A user with no site should be
    // told immediately, not sent to a progress page that fails a second later.
    if (!fs.existsSync(sourceDir)) {
      return send(res, page({
        status: 400,
        title: 'Production Build',
        heading: '❌ No generated site found',
        body: '<p class="lead">Please generate your website first.</p>',
        actions: '<a href="/" class="btn btn-primary btn-lg">Back to Generator</a>',
      }));
    }

    // Already running, in this process or another. Two guards, because they
    // catch different things: isBuilding() is in-memory and only knows about
    // this process, the Job query covers a build claimed by any instance.
    const running = await Job.findOne({
      user: req.user._id,
      kind: 'build',
      status: { $in: ['queued', 'running'] },
    }).sort({ createdAt: -1 });

    if (running || isBuilding(userId)) {
      // Not an error — send them to watch the one already in flight rather
      // than telling them off for pressing the button twice.
      if (running) {
        return queued(req, res, running);
      }

      return send(res, page({
        status: 429,
        title: 'Production Build',
        heading: '⏳ Already building',
        body: '<p class="lead">A build is already running for your account. Please wait for it to finish.</p>',
        actions: '<a href="/dashboard" class="btn btn-primary btn-lg">My Dashboard</a>',
      }));
    }

    const job = await Job.create({
      user: req.user._id,
      kind: 'build',
      status: 'queued',
      // The generator needs only the user id, which is already on the job.
      // Mixed and required, so it cannot be empty.
      payload: { userId },
      progress: { total: 1, done: 0, stage: 'queued', current: '' },
    });

    log.info('build.queued', { requestId: req.id, userId, jobId: String(job._id) });

    return queued(req, res, job);

  } catch (err) {
    log.error('build.queueFailed', err, { requestId: req.id, userId });

    return send(res, page({
      status: 500,
      title: 'Production Build',
      heading: '❌ Could not start the build',
      body: '<p class="lead">Nothing was changed. Please try again.</p>',
      actions: '<a href="/dashboard" class="btn btn-primary btn-lg">My Dashboard</a>',
    }));
  }
});

module.exports = router;