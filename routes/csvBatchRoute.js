// routes/csvBatchRoute.js
//
// Build a batch of websites from one CSV.
//
//   GET  /batch-sites                 the screen
//   POST /api/batch-sites/preview     the file, checked, before anything runs
//
// WHY A DOOR OF ITS OWN — Edwin, 20 November: *"I want it on the sidebar and
// it should say build a batch of 7 sites. When the user clicks it should show
// a screen where the user can upload the csv and it validates the information
// and if everything is right then a button to press to generate the sites."*
//
// NOT A STEP ON THE WIZARD, AND THE REASON IS THE SHAPE OF THE ANSWERS.
// Seven sites that differ by a business and share everything else do not
// need a seven-step form; they need one file. Every question the wizard asks
// is either a column here or a default this door sets — 24 hours, a wordmark
// logo, one city per site and no service areas.
//
//     THE WIZARD ASKS A PERSON SEVEN TIMES WHAT A SPREADSHEET
//     ALREADY SAYS ONCE.
//
// IT BUILDS NOTHING. The preview validates and prices; the browser then
// posts the rows to /api/generate-batch, which is the route that has
// validated, enqueued and priced batches since 18 November, and
// utils/batchGenerator.js builds them one after another in a single job.
// A second enqueue path would be a second place for the credit check, the
// address check and the job shape to drift.
//
//   node test-csv-batch-route.js

'use strict';

const express = require('express');

const requireAuth = require('../middleware/requireAuth');
const Domain = require('../models/Domain');

const { siteDomains } = require('../utils/domainPool');
const { designsFor } = require('../utils/localOptions/designs');
const { expand, COLUMNS, HEADINGS, MAX_ROWS } = require('../utils/localOptions/csvBatch');
const { checkCredits } = require('../utils/helpers');
const { MODES } = require('../utils/seoPresets');
const { withAppHeader } = require('../utils/appHeader');
const { pageTitle } = require('../utils/pageTitle');
const { log } = require('../utils/logger');

const router = express.Router();

/**
 * The design list this door hands out, in order.
 *
 * 'cloudflaresites', WHICH IS ALL SEVEN. /local-automation offers Designs
 * 4-8 and /github-sites offers 1-3; the Cloudflare websites door offers the
 * lot, and this is that door with a file instead of a form.
 *
 * A BATCH OF SEVEN WANTS SEVEN DIFFERENT ONES — that is the whole of why
 * row N takes layout N. Handing out a list of five would silently cap the
 * batch at five, with the sixth row refused for a reason that reads like a
 * bug.
 */
const DESIGN_MODE = 'cloudflaresites';

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @param {object} [res]  so the page can carry the CSRF token
 *
 * THE TOKEN IS EMITTED HERE OR THE SCREEN CANNOT POST — found the hard way
 * on 20 November, with a preview that rendered NOTHING.
 *
 * The browser reads `meta[name="csrf-token"]` and sends it as the
 * X-CSRF-Token header, exactly as spinner.js does. That meta tag is written
 * by routes/formRoute.js, for the wizard — and this screen is not the
 * wizard. It read a tag no page had put there, sent an empty token, and
 * middleware/csrf.js refused the POST.
 *
 *     THIS SCREEN BORROWED A CONVENTION AND NOT THE LINE
 *     THAT ESTABLISHES IT.
 */
function page({ title, body, status = 200 }, res) {
  const csrf = (res && res.locals && res.locals.csrfToken) || '';

  return {
    status,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="csrf-token" content="${esc(csrf)}">
  <title>${pageTitle(title)}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
{{HEADER_ASSETS}}
</head>
<body style="background:#082d5b;" class="text-white">
{{HEADER}}
{{SIDEBAR}}
  <div class="container py-5" style="max-width: 1000px;">
    ${body}
  </div>
{{HEADER_SCRIPTS}}
</body>
</html>`,
  };
}

function send(res, spec) {
  return res.status(spec.status).send(withAppHeader(spec.html, res));
}

/**
 * The pool and the layouts, in the order the pairing walks them.
 *
 * SORTED BY DOMAIN, the same order /api/cloudflare-domains returns and the
 * same order the wizard's dropdown lists. The preview shows which row gets
 * which, so the order only has to be STABLE — but it has to be the same
 * stable order somebody saw on the other screen, or the two disagree about
 * what "the first domain" means.
 */
async function poolFor() {
  const rows = await Domain.find(siteDomains()).select('domain').sort({ domain: 1 }).lean();

  /* THE id, NOT THE LABEL OR THE STRUCTURE — and the first version of this
   * read `design.value`, which does not exist. Every row would have been
   * paired with `undefined`, the pairing would have refused nothing, and
   * the build would have resolved a design nobody chose.
   *
   *     A FIELD THAT IS NOT THERE READS AS undefined, NOT AS AN
   *     ERROR. THE LIST WAS THE RIGHT LENGTH AND EMPTY.
   *
   * `global[design]` is what the wizard posts and buildOptionsFor() resolves
   * — an id like "1", which carries both a structure and an image set, so
   * row N taking design N is what gives seven sites seven layouts AND seven
   * sets of photographs. */
  const designs = designsFor(DESIGN_MODE);

  return {
    domains: rows.map(row => row.domain),
    designs: designs.map(design => String(design.id)),

    /* FOR THE PREVIEW TABLE ONLY. "1" is the value the build needs and
     * "Design 1 — Ledger" is what somebody reading the table needs, and
     * showing the first would make the whole column meaningless. */
    labels: Object.fromEntries(
      designs.map(design => [String(design.id), `${design.label} — ${design.structure}`])),
  };
}

/* -------------------------------------------------------------------------
 * The screen
 * ---------------------------------------------------------------------- */

router.get('/batch-sites', requireAuth, async (req, res) => {
  try {
    const { domains, designs } = await poolFor();

    /* HOW MANY THIS CAN ACTUALLY BUILD, said before a file is chosen.
     * The pairing runs out at whichever list is shorter, and finding that
     * out from a row-by-row refusal on the eighth line is a worse way to
     * learn you have six domains. */
    const capacity = Math.min(domains.length, designs.length, MAX_ROWS);

    const cost = checkCredits(req.user, {}, { siteMode: MODES.LOCAL_OPTIONS });

    send(res, page({
      title: 'Build a batch of websites',
      body: `
        <h1 class="h2 mb-1">Build a batch of websites</h1>
        <p class="lead text-white-50">
          One row per website. Everything else is the same for all of them:
          open 24 hours, a drawn logo, one city each and no service areas.
        </p>

        ${capacity ? '' : `
        <div class="alert alert-warning">
          <strong>There is nothing to build on.</strong>
          <div class="small mt-1">
            This needs at least one domain in the Cloudflare websites pool.
            Add one on <a href="/admin/blog-domains" class="alert-link">the domains screen</a>.
          </div>
        </div>`}

        ${/* THE HOUSE PANEL, NOT A BLACK SLAB — Edwin, 20 November: *"I
              also don't like that dark screen, could you follow the theme
              design colors?"*

              `bg-dark border-secondary` is Bootstrap's own near-black, and
              on this navy body it reads as a hole cut in the page rather
              than a panel on it. /cloudflare-sites already had the answer:
              `bg-transparent border-light`, which lets the body colour
              through and draws the edge in the page's own white.

                  A DEFAULT FROM THE FRAMEWORK IS NOT A NEUTRAL
                  CHOICE ON A PAGE THAT HAS A COLOUR OF ITS OWN. */''}
        <div class="card bg-transparent border-light text-white mb-4">
          <div class="card-body">
            <h2 class="h5 mb-2">The file</h2>
            <p class="small text-white-50 mb-2">
              ${COLUMNS.length} columns, in this order. A heading row is optional.
            </p>
            ${/* A TINT OF THE PAGE, NOT A COLOUR OF ITS OWN. rgba white
                  over the navy stays on theme at any future body colour,
                  which a hard-coded darker blue would not. */''}
            <pre class="small mb-3 p-3 rounded" style="background:rgba(255,255,255,.07)"><code class="text-white">${esc(HEADINGS.join(', '))}</code></pre>

            ${/* THE EXAMPLE IS ON THE PAGE AND NOT IN THE TEMPLATE, which is
                  the whole reason it is here rather than in the download. An
                  example row in the file is an example row somebody forgets
                  to delete. */''}
            <p class="small text-white-50 mb-1">One row looks like this:</p>
            <pre class="small mb-3 p-3 rounded" style="background:rgba(255,255,255,.07)"><code class="text-white-50">air-conditioning,"Austin, TX",78729,Cold Air Austin,9601 Amberglen Blvd,(737) 239-8011,you@example.com</code></pre>

            <a class="btn btn-sm btn-outline-light" href="/batch-sites/template.csv" download>
              Download the template
            </a>
          </div>
        </div>

        <div class="mb-4">
          <label class="form-label" for="csvFile">Choose your CSV</label>
          <input class="form-control" type="file" id="csvFile" accept=".csv,text/csv">
          <div class="form-text text-white-50">
            Up to ${capacity} website${1 === capacity ? '' : 's'} — you have
            ${domains.length} domain${1 === domains.length ? '' : 's'} in the pool
            and ${designs.length} layouts.
            ${cost.totalCost ? `Each one costs ${cost.totalCost} credits; you have ${cost.available}.` : ''}
          </div>
        </div>

        <div id="preview"></div>

        <div class="mb-5">
          <button class="btn btn-primary" id="buildBtn" type="button" disabled>
            Build them
          </button>
          <a href="/cloudflare-sites" class="btn btn-outline-light ms-2">My websites</a>
        </div>

        <script>
          /* THE FILE IS READ IN THE BROWSER AND THE TEXT IS POSTED.
           *
           * No multipart upload, no file on disk, nothing to clean up on a
           * failure path. A CSV of ten businesses is a couple of kilobytes,
           * and the server never has a file to forget about.
           *
           * THE CHECKING IS ALL SERVER-SIDE. utils/localOptions/csvBatch.js
           * knows which trades have photographs, what normalisePrefix
           * refuses and how many sites the enqueue route accepts. A copy of
           * any of that in here would be a second set of rules, agreeing
           * right up until the day one of them is changed. */
          (function () {
            var fileInput = document.getElementById('csvFile');
            var preview = document.getElementById('preview');
            var buildBtn = document.getElementById('buildBtn');
            var ready = [];

            function token() {
              var tag = document.querySelector('meta[name="csrf-token"]');
              return tag ? tag.getAttribute('content') : '';
            }

            function escape(value) {
              return String(value == null ? '' : value)
                .replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            }

            function draw(answer) {
              var html = '';

              /* AN ANSWER THIS DOES NOT UNDERSTAND IS SAID OUT LOUD.
               *
               * THE BUG THAT PUT THIS HERE: a CSRF refusal replies with an
               * error field and nothing else -- no rows, no errors -- and
               * the version of this function without these six lines
               * rendered an EMPTY STRING for it. The table was blank, no
               * warning appeared, the button stayed disabled, and the
               * screen said nothing at all about why.
               *
               * NO BACKTICKS IN THIS COMMENT, and that is not style. This
               * whole script is inside a template literal, so a backtick
               * here ENDS THE STRING -- the fifth time this project has
               * been bitten by exactly that.
               *
               *     A RENDERER THAT DRAWS NOTHING FOR A SHAPE IT
               *     DID NOT EXPECT IS INDISTINGUISHABLE FROM A
               *     SCREEN THAT IS STILL THINKING. */
              if (!answer || (!answer.rows && !answer.errors)) {
                preview.innerHTML = '<div class="alert alert-danger">'
                  + escape((answer && answer.error)
                    || 'That file could not be checked.')
                  + '</div>';
                buildBtn.disabled = true;

                return;
              }

              if (answer.errors && answer.errors.length) {
                html += '<div class="alert alert-danger"><strong>'
                  + answer.errors.length + ' row'
                  + (1 === answer.errors.length ? '' : 's')
                  + ' cannot be built.</strong><ul class="small mb-0 mt-2">';

                answer.errors.forEach(function (fault) {
                  html += '<li>' + (fault.line ? 'Row ' + fault.line + ': ' : '')
                    + escape(fault.reason) + '</li>';
                });

                html += '</ul></div>';
              }

              if (answer.rows && answer.rows.length) {
                html += '<h2 class="h5 mb-2">' + answer.rows.length + ' website'
                  + (1 === answer.rows.length ? '' : 's') + '</h2>'
                  + '<div class="table-responsive mb-3"><table class="table table-navy table-hover table-sm align-middle">'
                  + '<thead><tr><th>Row</th><th>Business</th><th>Address</th><th>Layout</th></tr></thead><tbody>';

                answer.rows.forEach(function (row) {
                  html += '<tr><td class="rownum">' + row.line + '</td><td>'
                    + escape(row.businessName) + '</td><td><code>'
                    + escape(row.address) + '</code></td><td class="text-white-50">'
                    + escape(row.designLabel || row.design) + '</td></tr>';
                });

                html += '</tbody></table></div>';

                if (answer.needed > answer.available) {
                  html += '<div class="alert alert-warning">This batch needs '
                    + answer.needed + ' credits and you have '
                    + answer.available + '.</div>';
                }
              }

              preview.innerHTML = html;

              /* NOT ONE BAD ROW. A batch half built is seven addresses with
               * some taken and some free, and no way to re-run the file
               * without picking out which. */
              buildBtn.disabled = !(answer.rows && answer.rows.length)
                || (answer.errors && answer.errors.length > 0)
                || answer.needed > answer.available;
            }

            fileInput.addEventListener('change', function () {
              var file = fileInput.files && fileInput.files[0];

              ready = [];
              buildBtn.disabled = true;

              if (!file) { preview.innerHTML = ''; return; }

              var reader = new FileReader();

              reader.onload = function () {
                fetch('/api/batch-sites/preview', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-CSRF-Token': token()
                  },
                  body: JSON.stringify({ csv: String(reader.result || '') })
                })
                  .then(function (r) { return r.json(); })
                  .then(function (answer) {
                    ready = (answer.rows || []).map(function (row) { return row.entry; });
                    draw(answer);
                  })
                  .catch(function () {
                    preview.innerHTML =
                      '<div class="alert alert-danger">That file could not be checked. Try again.</div>';
                  });
              };

              reader.readAsText(file);
            });

            buildBtn.addEventListener('click', function () {
              if (!ready.length) return;

              buildBtn.disabled = true;
              buildBtn.textContent = 'Queueing ' + ready.length + ' websites…';

              /* THE SAME ENDPOINT THE WIZARD'S "Build all" POSTS TO, with
               * the same body. This screen composes the entries; it does
               * not enqueue, price or validate them a second time. */
              fetch('/api/generate-batch', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Accept': 'application/json',
                  'X-CSRF-Token': token()
                },
                body: JSON.stringify({ sites: ready })
              })
                .then(function (r) { return r.json().then(function (b) { return { ok: r.ok, body: b }; }); })
                .then(function (answer) {
                  if (answer.ok && answer.body && answer.body.jobId) {
                    window.location.href = '/jobs/' + answer.body.jobId;
                    return;
                  }

                  buildBtn.disabled = false;
                  buildBtn.textContent = 'Build them';

                  preview.insertAdjacentHTML('beforeend',
                    '<div class="alert alert-danger mt-3">'
                    + escape((answer.body && answer.body.error) || 'That batch was not accepted.')
                    + '</div>');
                })
                .catch(function () {
                  buildBtn.disabled = false;
                  buildBtn.textContent = 'Build them';
                });
            });
          })();
        </script>`,
    }, res));

  } catch (err) {
    log.error('csvBatch.screen.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: '<h1 class="h3">We could not load that</h1>',
    }, res));
  }
});

/* -------------------------------------------------------------------------
 * The template
 * ---------------------------------------------------------------------- */

/**
 * GET /batch-sites/template.csv
 *
 * BUILT FROM COLUMNS, NOT TYPED OUT. A template file with the headings
 * written by hand is a second statement of the column order — correct on
 * the day it is written and silently wrong the first time a column moves.
 * Somebody would then fill in a file this screen refuses row by row, and
 * the file came from this screen.
 *
 *     A TEMPLATE THAT CAN DISAGREE WITH THE PARSER IS WORSE THAN
 *     NO TEMPLATE. IT IS A WRONG ANSWER WITH OUR NAME ON IT.
 *
 * HEADINGS ONLY, AND NO EXAMPLE ROW. An example in the file is an example
 * somebody forgets to delete, and a batch that quietly builds a website for
 * "Cold Air Austin" on the first domain in the pool. The screen shows one
 * on the page instead, where it cannot be uploaded by accident.
 */
router.get('/batch-sites/template.csv', requireAuth, (req, res) => {
  /* A BOM, DELIBERATELY, AND THIS IS THE ONE PLACE IT HELPS. Excel on
   * Windows reads a CSV without one as the system codepage, so an accented
   * town name comes back mangled in the very file we handed over. The
   * parser strips it on the way back in. */
  const body = `\uFEFF${HEADINGS.join(',')}\n`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="website-batch-template.csv"');

  res.send(body);
});

/* -------------------------------------------------------------------------
 * The check
 * ---------------------------------------------------------------------- */

/**
 * POST /api/batch-sites/preview
 *
 * Body: `{ csv: '<the file as text>' }`
 * Returns: `{ rows, errors, needed, available }`
 *
 * IT WRITES NOTHING AND QUEUES NOTHING. Somebody will upload the wrong file
 * and upload it again; a preview that cost anything, or left a row behind,
 * would make that an expensive way to find a typo.
 */
router.post('/api/batch-sites/preview', requireAuth,
  express.json({ limit: '256kb' }), async (req, res) => {
    try {
      const csv = String((req.body && req.body.csv) || '');

      if (!csv.trim()) {
        return res.status(400).json({
          rows: [],
          errors: [{ line: 0, reason: 'That file is empty.' }],
          needed: 0,
          available: 0,
        });
      }

      const { domains, designs, labels } = await poolFor();
      const { rows, errors } = expand({ csv, domains, designs });

      /* THE READABLE NAME, ATTACHED HERE RATHER THAN KNOWN BY csvBatch.js.
       * That module pairs ids with rows and has no business knowing what a
       * design is called — it would be a second place to learn the design
       * list, for a string that only ever reaches a table. */
      for (const row of rows) row.designLabel = labels[row.design] || row.design;

      const cost = checkCredits(req.user, {}, { siteMode: MODES.LOCAL_OPTIONS });
      const needed = (cost.totalCost || 0) * rows.length;

      log.info('csvBatch.previewed', {
        requestId: req.id,
        rows: rows.length,
        errors: errors.length,
        needed,
      });

      res.json({
        rows,
        errors,
        needed,
        available: cost.available || 0,
      });

    } catch (err) {
      log.error('csvBatch.preview.failed', err, { requestId: req.id });

      res.status(500).json({
        rows: [],
        errors: [{ line: 0, reason: 'That file could not be checked.' }],
        needed: 0,
        available: 0,
      });
    }
  });

module.exports = router;
module.exports.DESIGN_MODE = DESIGN_MODE;
module.exports.poolFor = poolFor;
