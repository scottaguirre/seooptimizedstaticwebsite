// routes/jobRoute.js
//
// Progress for a background generation job.
//
//   GET /jobs/:id           the progress page the wizard lands on
//   GET /api/jobs/:id       JSON the page polls
//
// Both check ownership. A job id in the URL would otherwise let anyone watch
// — or learn the business details of — another customer's build.

const express = require('express');
const router = express.Router();

const Job = require('../models/Job');
const requireAuth = require('../middleware/requireAuth');
const { log } = require('../utils/logger');

/**
 * Load a job the current user is allowed to see.
 * Returns null rather than throwing, so callers decide the response.
 */
async function loadOwnedJob(req) {
  // A malformed id makes Mongoose throw rather than return null, and an
  // invalid id is a 404 not a 500.
  if (!/^[a-f0-9]{24}$/i.test(String(req.params.id || ''))) return null;

  const job = await Job.findById(req.params.id).lean();
  if (!job) return null;

  const isOwner = String(job.user) === String(req.session.userId);
  const isAdmin = req.session.role === 'admin';

  if (!isOwner && !isAdmin) {
    log.security('jobs.accessDenied', {
      requestId: req.id,
      userId: req.session.userId,
      jobId: String(job._id),
    });
    return null;
  }

  return job;
}

/* -------------------------------------------------------------------------
 * Polled by the progress page
 * ---------------------------------------------------------------------- */

router.get('/api/jobs/:id', requireAuth, async (req, res) => {
  try {
    const job = await loadOwnedJob(req);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    res.json({
      id: String(job._id),
      status: job.status,
      siteMode: job.siteMode,
      progress: job.progress || { done: 0, total: 0 },
      skipped: job.skippedPages || [],
      creditsCharged: job.creditsCharged || 0,
      // The message only — never the stack, which discloses file paths and
      // dependency versions.
      error: job.status === 'failed' ? (job.error?.message || 'Generation failed') : null,
    });

  } catch (err) {
    log.error('jobs.statusFailed', err, { requestId: req.id });
    res.status(500).json({ error: 'Could not read the job status' });
  }
});

/* -------------------------------------------------------------------------
 * The page the user watches
 * ---------------------------------------------------------------------- */

router.get('/jobs/:id', requireAuth, async (req, res) => {
  const job = await loadOwnedJob(req);

  if (!job) {
    return res.status(404).send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>Not found</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
</head><body class="bg-dark text-white">
  <div class="container py-5" style="max-width:600px;">
    <h1>We could not find that build</h1>
    <a href="/dashboard" class="btn btn-primary mt-3">My Dashboard</a>
  </div>
</body></html>`);
  }

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Building your website</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-dark text-white">
  <div class="container py-5" style="max-width: 720px;">

    <h1 id="title" class="mb-2">Building your website</h1>
    <p id="subtitle" class="text-white-50">
      This can take a few minutes. You can leave this page open, or come back
      to it from your dashboard — the build carries on either way.
    </p>

    <div class="progress mt-4" style="height: 28px;">
      <div id="bar" class="progress-bar progress-bar-striped progress-bar-animated bg-success"
           role="progressbar" style="width: 0%;">0%</div>
    </div>

    <p id="stage" class="mt-3 mb-0">Starting…</p>
    <p id="detail" class="text-white-50 small"></p>

    <div id="done" class="mt-4 d-none">
      <a href="/dashboard" class="btn btn-primary btn-lg">See your website</a>
    </div>

    <div id="failed" class="alert alert-danger mt-4 d-none" role="alert"></div>

    <div id="skipped" class="alert alert-warning mt-4 d-none" role="alert"></div>
  </div>

  <script>
    (function () {
      const jobId = ${JSON.stringify(String(job._id))};

      const bar      = document.getElementById('bar');
      const stage    = document.getElementById('stage');
      const detail   = document.getElementById('detail');
      const doneBox  = document.getElementById('done');
      const failBox  = document.getElementById('failed');
      const skipBox  = document.getElementById('skipped');
      const title    = document.getElementById('title');
      const subtitle = document.getElementById('subtitle');

      // Backs off when nothing is changing, so a long build does not make
      // hundreds of needless requests.
      let interval = 1500;
      let unchanged = 0;
      let lastDone = -1;

      async function poll() {
        try {
          const res = await fetch('/api/jobs/' + jobId, { headers: { Accept: 'application/json' } });
          if (!res.ok) throw new Error('Could not read progress');

          const job = await res.json();
          const { done = 0, total = 0 } = job.progress || {};

          // Indeterminate until the first page lands.
          //
          // Setup takes 15-20 seconds before anything completes, and a bar
          // frozen at 0% reads as "hung". A full-width striped animation is
          // honest — it says work is happening without claiming a percentage
          // nobody can calculate yet.
          if (done === 0) {
            bar.style.width = '100%';
            bar.textContent = '';
            bar.classList.add('progress-bar-striped', 'progress-bar-animated');
            bar.classList.add('bg-secondary');
            bar.classList.remove('bg-success');
          } else {
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            bar.style.width = pct + '%';
            bar.textContent = pct + '%';
            bar.classList.add('bg-success');
            bar.classList.remove('bg-secondary');
          }

          // 'queued' is the raw status; say something a person would say.
          const rawStage = job.progress?.stage || '';
          stage.textContent = rawStage === 'queued'
            ? 'Waiting for a free slot…'
            : rawStage === 'resuming'
              ? 'Resuming where it left off…'
              : rawStage;
          detail.textContent = job.progress?.current
            ? job.progress.current + (total ? '  —  ' + done + ' of ' + total : '')
            : '';

          if (done !== lastDone) { unchanged = 0; lastDone = done; }
          else if (++unchanged > 8) { interval = Math.min(interval + 500, 5000); }

          if (job.status === 'completed') {
            bar.classList.remove('progress-bar-animated', 'progress-bar-striped', 'bg-secondary');
            bar.classList.add('bg-success');
            bar.style.width = '100%';
            bar.textContent = '100%';
            title.textContent = 'Your website is ready';
            subtitle.textContent = job.creditsCharged
              ? job.creditsCharged.toLocaleString() + ' credits were used.'
              : '';
            stage.textContent = '';
            detail.textContent = '';
            doneBox.classList.remove('d-none');

            if (job.skipped && job.skipped.length) {
              skipBox.textContent =
                job.skipped.length + ' page(s) could not be generated: ' +
                job.skipped.map(s => s.page).join(', ') +
                '. The rest of your site is ready.';
              skipBox.classList.remove('d-none');
            }
            return;   // stop polling
          }

          if (job.status === 'failed') {
            bar.classList.remove('progress-bar-animated');
            bar.classList.replace('bg-success', 'bg-danger');
            title.textContent = 'The build did not finish';
            subtitle.textContent = '';
            failBox.textContent = job.error || 'Something went wrong. Please try again.';
            failBox.classList.remove('d-none');
            return;   // stop polling
          }

          setTimeout(poll, interval);

        } catch (err) {
          // A network blip should not end the page — keep trying, slower.
          setTimeout(poll, 5000);
        }
      }

      poll();
    })();
  </script>
</body>
</html>`);
});

module.exports = router;