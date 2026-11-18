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
const { appHeader, appHeaderAssets, appHeaderScripts, appSidebar, appSidebarAssets } = require('../utils/appHeader');
const { pageTitle } = require('../utils/pageTitle');
const { siteTargetOf } = require('../utils/cloudflareSites/wanted');

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

/**
 * WHERE THIS JOB WAS TRYING TO PUBLISH, if anywhere.
 *
 * WHY THE PAGE NEEDS IT AT ALL. The amber "built but not published" box was
 * written when exactly one kind of job published anything, so its sentence
 * ends *"could not be pushed to GitHub"* — a hard-coded destination in a
 * message about a failure. A Cloudflare build that failed to go live read as
 * a GitHub problem, and the recovery — /cloudflare-sites, press Publish —
 * was named nowhere.
 *
 *     A FAILURE MESSAGE THAT NAMES THE WRONG SYSTEM
 *     COSTS MORE THAN NO MESSAGE.
 *
 * READ OFF THE JOB, NOT STORED SECOND. `siteTarget` is in the payload
 * because generateRoute.js keeps the whole posted body, and the mode is a
 * column — so both are already here, and a third copy would be a third
 * thing to keep in step.
 *
 * ORDER MATTERS: a Local Website Options build can also carry a Cloudflare
 * destination one day, and the destination is the thing that just failed.
 *
 * @returns {'cloudflare'|'github'|''}
 */
function publishDestination(job) {
  if ('cloudflare' === siteTargetOf(job.payload)) return 'cloudflare';
  if ('localoptions' === job.siteMode) return 'github';

  return '';
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
      // The page shows different wording and a different finish link per kind.
      // Absent on rows written before `kind` existed — those are site builds.
      kind: job.kind || 'site',
      siteMode: job.siteMode,
      progress: job.progress || { done: 0, total: 0 },
      skipped: job.skippedPages || [],
      creditsCharged: job.creditsCharged || 0,

      /* WHETHER THE SITE ACTUALLY WENT LIVE. Absent on every kind but a
       * Local Website Options build, and absent on jobs written before this
       * shipped — the page treats missing as "nothing to say", which is the
       * honest reading of a job that never recorded it. */
      published: (job.result && job.result.published) || null,

      /* WHICH HOST THE LINE ABOVE IS ABOUT. '' on a build that publishes
       * nowhere, which is most of them. */
      publishedTo: publishDestination(job),
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
    // The header goes on the 404 too. This page is reached by an expired or
    // mistyped job id, and without it the only way out is the one link in the
    // body — which is the dead-end problem the header exists to fix.
    return res.status(404).send(`<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><title>${pageTitle('Not found')}</title>
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
${appHeaderAssets()}${appSidebarAssets()}
</head><body style="background:#082d5b;" class="text-white">
${appHeader(res.locals.csrfField || '')}
${appSidebar('/jobs')}
  <div class="container py-5" style="max-width:600px;">
    <h1>We could not find that build</h1>
    <a href="/dashboard" class="btn btn-primary mt-3">My Dashboard</a>
  </div>
${appHeaderScripts()}
</body></html>`);
  }

  const kind = job.kind || 'site';

  // One page, three jobs. The wording and the finish link differ because the
  // outcomes do: a generated site is viewed, a ZIP is downloaded, a blog post
  // is read. A page that said "See your website" after a build would send
  // someone to the preview rather than the file they were waiting for.
  const COPY = {
    site:  { title: 'Building your website', done: 'Your website is ready',   cta: 'See your website', href: '/dashboard' },
    build: { title: 'Packaging your website', done: 'Your download is ready', cta: 'Download the ZIP', href: '/download-zip' },
    // Defensive only: a blog job is polled by the WordPress plugin, not
    // watched here. Pointing it at the dashboard rather than a WordPress path
    // that does not exist on this server.
    blog:  { title: 'Writing your post',      done: 'Your post is ready',     cta: 'My Dashboard',     href: '/dashboard' },
    /* The edit screen's re-render. "Updating" rather than "building":
     * nothing new is being made, and somebody who has just pressed Save on
     * two sentences should not be told their website is being built. */
    cfedit: { title: 'Updating your website', done: 'Your website is updated', cta: 'My websites', href: '/cloudflare-sites' },
    /* The Rank Fast edit screen's re-render. "Updating" for the same reason
     * cfedit says it — nothing new is being made — and the finish link goes
     * to the dashboard card, where Preview, Download and Convert are. */
    siteedit: { title: 'Updating your website', done: 'Your website is updated', cta: 'My Dashboard', href: '/dashboard' },
    /* Several websites from one submission — 18 November. PLURAL
     * throughout, because the one thing this page must not do is tell
     * somebody who queued three that "your website is ready" when two of
     * them went live and one did not.
     *
     * THE FINISH LINK GOES TO THE LIST, NOT TO A SITE. There is no single
     * site to see, and the batch's report — which of them went live, and
     * why the others did not — belongs beside the websites it is about. */
    sitebatch: { title: 'Building your websites', done: 'Your websites are ready', cta: 'My websites', href: '/cloudflare-sites' },
  };
  const copy = COPY[kind] || COPY.site;

  /* NEVER SERVE THIS PAGE FROM THE BACK BUTTON'S FROZEN COPY.
   *
   * Browsers keep a snapshot of a page you navigate away from — markup, and
   * the JavaScript paused mid-flight — so pressing Back brings it straight
   * back without asking the server anything. For almost every page that is a
   * feature. For this one it is a lie: Edwin pressed Back and saw "40% —
   * Writing location pages", the figure from the moment he left, on a build
   * that had moved on. He asked whether it was stuck.
   *
   * A progress page is the one kind where a stale number is worse than a
   * slow one. no-store is what disables that cache in Chrome and Firefox;
   * it costs a round trip on a page that is already polling every second.
   *
   * The POLLING WOULD NOT HAVE SAVED IT, which is the part that is easy to
   * get wrong: the snapshot's timers are frozen too, so the page does not
   * resume and quietly correct itself. It simply sits there, wrong. */
  res.set('Cache-Control', 'no-store, must-revalidate');

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${pageTitle(copy.title)}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
${appHeaderAssets()}${appSidebarAssets()}
</head>
<body style="background:#082d5b;" class=" text-white">
${appHeader(res.locals.csrfField || '')}
${appSidebar('/jobs')}
  <div class="container py-5" style="max-width: 720px;">

    <h1 id="title" class="mb-2">${copy.title}</h1>
    <p id="subtitle" class="text-white-50">
      This can take a few minutes. You can leave this page open, or come back
      to it from your dashboard — the work carries on either way.
    </p>

    <div class="progress mt-4" style="height: 28px;">
      <div id="bar" class="progress-bar progress-bar-striped progress-bar-animated bg-success"
           role="progressbar" style="width: 0%;">0%</div>
    </div>

    <p id="stage" class="mt-3 mb-0">Starting…</p>
    <p id="detail" class="text-white-50 small"></p>

    <div id="done" class="mt-4 d-none">
      <a href="${copy.href}" class="btn btn-primary btn-lg">${copy.cta}</a>
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
      /**
       * What the line under the heading says once the build has finished.
       *
       * A PURE FUNCTION RETURNING PIECES, NOT MARKUP, for two reasons. The
       * DOM is built from these by hand a few lines down — never from a
       * string — so a hostname can never be parsed as HTML. And this page
       * lives inside a template literal in a route, where the only way a
       * test can reach a decision is to lift it out and run it.
       *
       * https ONLY. The value comes from our own database, by way of
       * jobGenerator joining "https://" to a hostname this app validated.
       *
       * NO BACKTICKS IN THIS COMMENT, and that is not style. Everything in
       * this script lives inside a template literal in the route, so a
       * backtick here ENDS THE PAGE — the first draft of this note quoted a
       * URL scheme in backticks and node --check failed sixty lines above,
       * on the line that interpolates the job id. The same family as
       * form.html's rule about never naming a placeholder in a comment.
       * Checked anyway: this ends up in an href, and a scheme test here is
       * one line against a class of bug that is somebody else's mistake
       * three files away.
       */
      function finishedLine(job) {
        const credits = job.creditsCharged
          ? job.creditsCharged.toLocaleString() + ' credits were used.'
          : '';

        const p = job.published;

        /* NO REGEX, AND NO BACKSLASH ANYWHERE IN THIS FUNCTION.
         *
         * THIS LINE SHIPPED BROKEN ON 17 NOVEMBER, and it took the whole
         * page with it. It was written as a regular expression anchored on
         * the scheme, with a backslash before each slash: correct
         * JavaScript, in a file that is also a TEMPLATE LITERAL.
         *
         * A backslash inside a template literal is an ESCAPE. So each
         * backslash-slash collapsed to a bare slash on the way out, the
         * browser received a short regex followed by what it read as a line
         * comment, and the rest of the statement vanished into it.
         *
         * A SYNTAX ERROR IS REFUSED WHOLE. Not the line: the script. So
         * nothing on this page ran at all -- no polling, no progress, no
         * finish. The bar sat at nought per cent and the stage said
         * "Starting..." while the build ran, finished and published behind
         * it. Edwin: "i tried to build a githun site and it got stuck and
         * never even started". It had not; it was already done.
         *
         *     IN A FILE THAT IS ALSO A STRING, THE SOURCE AND THE OUTPUT
         *     ARE NOT THE SAME TEXT -- and node --check only ever reads
         *     the first one.
         *
         * The same trap as the backtick in a comment one screen above,
         * found in the same week, in the same file. indexOf and slice carry
         * no escapes at all, so this version cannot differ between the file
         * and the page.
         *
         * test-build-progress.js now renders this page and parses the
         * script it emits, which is the only check that reads what the
         * browser reads. */
        const PREFIX = 'https://';

        const url = (p && false !== p.ok && 'string' === typeof p.url
          && 0 === p.url.indexOf(PREFIX)) ? p.url : '';

        return { url: url, host: url.slice(PREFIX.length), credits: credits };
      }

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

          // A build and a blog post are one unit of work with no meaningful
          // fraction — webpack reports nothing through exec(). Forcing the
          // indeterminate bar is more honest than a bar that sits at 0% and
          // then jumps to 100%.
          /* NO BAR FOR THESE THREE. A ZIP, a campaign and a re-render each
           * run in one pass with no countable units — a re-render writes its
           * pages from a stored recipe rather than generating them one at a
           * time. A bar claiming a total it cannot measure is a worse lie
           * than no bar: it stalls at a number and looks stuck. */
          const indeterminate = job.kind === 'build' || job.kind === 'blog' || job.kind === 'cfedit';

          // Indeterminate until the first page lands.
          //
          // Setup takes 15-20 seconds before anything completes, and a bar
          // frozen at 0% reads as "hung". A full-width striped animation is
          // honest — it says work is happening without claiming a percentage
          // nobody can calculate yet.
          if (done === 0 || indeterminate) {
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
          // "Leander, TX  —  37 of 60 pages", or just "37 of 60 pages".
          //
          // THE COUNT USED TO BE HIDDEN BEHIND THE PAGE NAME: it was only
          // drawn when progress.current was non-empty, and the generator
          // clears that field at exactly the moments a person most wants a
          // number — entering the location batch, finishing it, writing the
          // sitemap. The one honest figure on the page disappeared for the
          // longest stretch of the build, leaving a bare percentage to
          // argue with.
          const count = total ? done + ' of ' + total + ' pages' : '';
          detail.textContent = [job.progress?.current || '', count]
            .filter(Boolean)
            .join('  —  ');

          if (done !== lastDone) { unchanged = 0; lastDone = done; }
          else if (++unchanged > 8) { interval = Math.min(interval + 500, 5000); }

          if (job.status === 'completed') {
            bar.classList.remove('progress-bar-animated', 'progress-bar-striped', 'bg-secondary');
            bar.classList.add('bg-success');
            bar.style.width = '100%';
            bar.textContent = '100%';
            title.textContent = ${JSON.stringify(copy.done)};
            /* THE ADDRESS, UNDER THE HEADING — 17 November, Edwin's ask.
             *
             * A Cloudflare build finishes on a hostname nobody has seen: it
             * was typed on the review step, several minutes and a whole
             * build earlier, and this page said only "Your website is
             * ready" over a button. The one fact somebody wants at that
             * moment — WHERE IS IT — was a click away, or a trip to the
             * list.
             *
             * The old two-step flow did not have this problem, because you
             * had typed the address on the previous screen. Shortening the
             * errand is what moved it out of sight.
             *
             *     FINISHING IS WHEN AN ADDRESS BECOMES THE ANSWER, NOT A
             *     DETAIL.
             *
             * The button still says "See it live"; this is the address
             * itself, readable and copyable without leaving the page. */
            const finished = finishedLine(job);

            subtitle.textContent = '';

            if (finished.url) {
              subtitle.appendChild(document.createTextNode('Live at '));

              const link = document.createElement('a');
              link.href = finished.url;
              link.target = '_blank';
              link.rel = 'noopener';
              link.className = 'link-light';
              link.textContent = finished.host;
              subtitle.appendChild(link);

              if (finished.credits) {
                subtitle.appendChild(document.createTextNode(' · ' + finished.credits));
              }
            } else {
              subtitle.textContent = finished.credits;
            }
            stage.textContent = '';
            detail.textContent = '';
            doneBox.classList.remove('d-none');

            /* BUILT, PAID FOR, AND NOT ON THE INTERNET.
             *
             * runLocalOptions will not fail a build over a publish, and
             * that is right: the pages exist and the writing is paid for.
             * But the job then said "Your website is ready" over a
             * repository holding one file, which is the version of this
             * the customer cannot act on.
             *
             * Not red, because nothing was lost — amber, because something
             * is owed. */
            /* LIVE, AND SAY SO WITH THE ADDRESS.
             *
             * A Cloudflare build finishes on a hostname nobody has seen
             * yet, and "See your website" pointing at the dashboard is the
             * long way round to the one link that matters. The button
             * becomes that link when the publish reported one. */
            if (job.published && false !== job.published.ok && job.published.url) {
              const go = doneBox.querySelector('a');
              if (go) {
                go.href = job.published.url;
                go.target = '_blank';
                go.rel = 'noopener';
                go.textContent = 'See it live';
              }
            }

            if (job.published && false === job.published.ok) {
              bar.classList.remove('bg-success');
              bar.classList.add('bg-warning');
              title.textContent = 'Built, but not published';

              /* THE DESTINATION IS NAMED BY THE JOB, NOT BY THIS SENTENCE.
               * It used to read "pushed to GitHub" whatever had failed. */
              const where = 'cloudflare' === job.publishedTo
                ? 'put on its subdomain'
                : 'pushed to GitHub';

              failBox.textContent =
                'The pages were written and your credits were used, but the '
                + 'site could not be ' + where + ': '
                + (job.published.error || 'no reason given')
                + ' — nothing is live yet.';

              /* AND WHERE TO GO NEXT. The build is still on disk and the
               * website row was created before the deploy was attempted,
               * so this is one button away from done — see the note on the
               * first-publish failure in routes/cloudflareSitesRoute.js.
               * A link rather than innerHTML, so the error text above
               * stays text. */
              if ('cloudflare' === job.publishedTo) {
                const again = document.createElement('a');
                again.href = '/cloudflare-sites';
                again.className = 'btn btn-sm btn-light mt-2 d-block';
                again.style.width = 'fit-content';
                again.textContent = 'Try publishing it again';
                failBox.appendChild(again);
              }

              failBox.classList.remove('d-none');
            }

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
${appHeaderScripts()}
</body>
</html>`);
});

module.exports = router;