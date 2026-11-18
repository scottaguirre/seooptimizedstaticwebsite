// routes/generateBatchRoute.js
//
// Queue several websites from one submission.
//
// WHY — Edwin, 18 November: *"i would like to be able to fill out the
// information for at least the 3 sites we have available and the build
// starts and after one is deployed the app starts the second build and so
// on?"*
//
// WHAT THIS ROUTE IS, AND WHAT IT IS NOT.
//
// It is the enqueue half. It validates every site, proves every address is
// free, checks the balance covers all of them, and writes ONE job. The
// building happens in utils/batchGenerator.js, which is where the note on
// why it is one job rather than three lives.
//
// WHY IT IS A SEPARATE ROUTE AND NOT A FLAG ON THE OLD ONE.
//
// routes/generateRoute.js is a four-hundred-line handler that composes an
// address, moves uploaded files, prices a submission, writes a job and
// cleans up after itself on six different failure paths. Threading "but
// sometimes there are three of these" through it would touch every one of
// those paths, and the mode that needs it has no uploads, no service-page
// rows and no location pages.
//
//     A BRANCH THROUGH A HANDLER THAT LONG IS NOT A SMALLER CHANGE
//     THAN A SHORTER HANDLER BESIDE IT.
//
// THE VALIDATION IS THE SAME FUNCTIONS IN THE SAME ORDER, NOT A SECOND
// COPY OF THE RULES. localAddress(), validateGlobalFields(), checkWant()
// and checkCredits() are the ones generateRoute.js calls, and they are
// called here for the same reasons in the same sequence — which is written
// down in vetOne() below, because the ORDER is the only part that is
// repeated and it is the part that has bitten before: checkWant must run
// after validateGlobalFields and setGlobalDomain must run after checkWant.
//
//   node test-site-batch.js

'use strict';

const express = require('express');
const mongoose = require('mongoose');

const requireAuth = require('../middleware/requireAuth');
const Job = require('../models/Job');

const {
  checkCredits,
  jsonValidationError,
  validateGlobalFields,
} = require('../utils/helpers');

const { MODES, normalizeSiteMode } = require('../utils/seoPresets');
const { localAddress } = require('../utils/localOptions/address');
const { siteTargetOf, wantedAddress, setGlobalDomain } = require('../utils/cloudflareSites/wanted');
const { log } = require('../utils/logger');

const router = express.Router();

/**
 * The most sites one submission may carry.
 *
 * TEN, AND THE NUMBER MATTERS LESS THAN HAVING ONE. A batch runs inside a
 * single job, so forty sites is a job that holds the build folder for two
 * hours and reports nothing anybody can act on until it ends. Ten is more
 * than the three Edwin asked for and short enough that the progress page
 * stays meaningful.
 *
 * AND IT IS A GUARD, NOT A PREFERENCE. Without it a hand-crafted POST
 * queues a thousand builds against one credit check.
 */
const MAX_SITES = 10;

/**
 * One `global` object, whichever shape the submission arrived in.
 *
 * A multipart post reaches Express as `body.global.city`. A batch entry is
 * captured with FormData in the browser and sent as JSON, where the key
 * stays the literal `global[city]` — JSON.parse expands no brackets.
 *
 * THE FLAT KEYS ARE REMOVED, NOT LEFT BESIDE THE NESTED ONES. setGlobalDomain()
 * rewrites the domain after checkWant() approves it, and a reader that
 * preferred the flat copy would get the pool domain the form posted rather
 * than the hostname the site will live at — the exact bug that put the wrong
 * canonical on every page of four sites on 17 November.
 *
 *     ONE DECISION MUST NOT BE READABLE UNDER TWO DIFFERENT KEYS.
 *
 * Handles the three shapes the wizard posts under `global`: a plain field,
 * a nested one (`global[cloudflare][prefix]`) and a repeated one
 * (`global[locationPages][]`). Anything already nested is returned as-is.
 */
function globalOf(body) {
  if (body.global && 'object' === typeof body.global && !Array.isArray(body.global)) {
    return body.global;
  }

  const out = {};

  for (const key of Object.keys(body)) {
    /* ANY DEPTH, AND THE FIRST VERSION ONLY DID TWO.
     *
     * It matched `global[a]` and `global[a][b]` and skipped anything
     * deeper — which is every opening time the wizard posts:
     * `global[hours][monday][open]`. The address came through, the hours
     * silently did not, and the refusal was about seven days of business
     * hours that had been filled in on screen.
     *
     *     A PARSER THAT HANDLES THE DEPTHS YOU THOUGHT OF
     *     DROPS THE ONES YOU DID NOT, QUIETLY. */
    const path = pathOf(key);

    if (!path || 'global' !== path[0] || path.length < 2) continue;

    place(out, path.slice(1), body[key]);
    delete body[key];
  }

  return out;
}

/**
 * `global[hours][monday][open]` -> ['global','hours','monday','open'].
 *
 * Returns null for anything that is not a bracketed path, so a plain key is
 * left exactly as it is.
 */
function pathOf(key) {
  const head = /^([^[\]]+)/.exec(key);

  if (!head) return null;

  const rest = key.slice(head[1].length);

  if (!rest) return null;

  const parts = [head[1]];
  const re = /\[([^\]]*)\]/g;
  let seen = 0;
  let m;

  while ((m = re.exec(rest))) {
    parts.push(m[1]);
    seen += m[0].length;
  }

  /* THE WHOLE TAIL HAS TO BE BRACKETS. `a[b]c` is not a path, and treating
   * it as one would silently drop the `c`. */
  return seen === rest.length ? parts : null;
}

/** Write `value` at `path` inside `root`, making the objects on the way. */
function place(root, path, value) {
  let at = root;

  for (let i = 0; i < path.length; i += 1) {
    const key = path[i];
    const last = i === path.length - 1;

    /* AN EMPTY KEY IS A REPEATED FIELD — `global[locationPages][]`. */
    if ('' === key) {
      if (!Array.isArray(at.__list)) at.__list = [];

      at.__list.push(...(Array.isArray(value) ? value : [value]));

      return;
    }

    if (last) {
      at[key] = value;

      return;
    }

    if ('' === path[i + 1]) {
      if (!Array.isArray(at[key])) at[key] = [];

      at[key].push(...(Array.isArray(value) ? value : [value]));

      return;
    }

    if (!at[key] || 'object' !== typeof at[key] || Array.isArray(at[key])) at[key] = {};

    at = at[key];
  }
}

/**
 * Everything that must be true of one site before any of them is built.
 *
 * THE ORDER IS THE PART THAT IS REPEATED FROM generateRoute.js, and it is
 * the part worth repeating carefully:
 *
 *   1. the mode and the destination, because the rest depends on both
 *   2. localAddress(), which composes `address` and `location` out of the
 *      four boxes this mode shows — BEFORE validateGlobalFields(), which
 *      requires both for every mode
 *   3. validateGlobalFields() with the destination, because a Cloudflare
 *      submission picks neither `domain` nor `domainId`
 *   4. checkWant(), which proves the address is free — BEFORE anybody is
 *      charged, even though the address is used last
 *   5. setGlobalDomain(), which rewrites the posted pool domain to the
 *      hostname the site will really live at — AFTER checkWant, never
 *      before, because checkWant is what proved the posted domain is in
 *      the pool
 *
 * Steps 4 and 5 in the wrong order refuse every submission; step 2 after
 * step 3 refuses every submission. Both are recorded in generateRoute.js
 * and both are easy to get wrong again here.
 *
 * MUTATES `body`, deliberately: steps 2 and 5 write into it, and what is
 * stored on the job has to be what they produced.
 *
 * @returns {Promise<{ok: true, tag: string} | {ok: false, message: string, field: string}>}
 */
async function vetOne(body, { user, index }) {
  const where = `Site ${index + 1}`;

  if (!body || 'object' !== typeof body || Array.isArray(body)) {
    return { ok: false, message: `${where} is not a submission.`, field: '' };
  }

  /* ⚠ THE BODY ARRIVES FLAT, AND THE FIRST VERSION OF THIS ASSUMED NESTED.
   *
   * A normal submission is multipart, and Express expands `global[city]`
   * into `body.global.city`. A batch entry is captured in the browser with
   * FormData and sent as JSON, and JSON.parse expands nothing — the key is
   * the literal string `global[city]`.
   *
   * So `body.global` was undefined, `localAddress({})` found no address and
   * every batch was refused with "Please check the business address" about
   * fields the owner had filled in.
   *
   *     THE SAME SUBMISSION ARRIVES IN TWO SHAPES, AND HALF THIS CODEBASE
   *     ALREADY KNOWS IT. siteTargetOf() and wantedAddress() read both,
   *     which is exactly why the mode and destination checks above PASSED
   *     and the address check did not.
   *
   * Normalised to the nested shape once, here, because the three functions
   * below — localAddress, validateGlobalFields and the stored payload — all
   * want the shape Express would have produced. */
  body.global = globalOf(body);

  const global = body.global;
  const siteMode = normalizeSiteMode(global.siteMode ?? body['global[siteMode]']);

  /* ONLY THIS MODE, AND ONLY THIS DESTINATION. A batch exists because the
   * Cloudflare door builds a fixed eleven-page site with no uploads and no
   * page rows. Rank Fast and Rank GBPs carry a logo, service rows and
   * location pages, none of which this route handles — so rather than
   * half-supporting them it says so.
   *
   *     A ROUTE THAT ACCEPTS A MODE IT CANNOT BUILD IS A ROUTE THAT
   *     FAILS LATER AND FOR A WORSE REASON. */
  if (MODES.LOCAL_OPTIONS !== siteMode) {
    return {
      ok: false,
      field: '',
      message: `${where} is not a Local Website Options submission. `
        + 'Batches are for the Cloudflare Local Automation wizard.',
    };
  }

  if ('cloudflare' !== siteTargetOf(body)) {
    return {
      ok: false,
      field: '',
      message: `${where} is not addressed to Cloudflare.`,
    };
  }

  /* NO UPLOADS IN A BATCH, AND THE REASON IS NOT TASTE.
   *
   * Uploads are keyed by JOB id and cleaned up by job id. Three sites
   * inside one job would share one upload folder, and the first site's
   * cleanup would take the third site's logo with it. The Cloudflare sites
   * already use the generated wordmark — utils/wordmarkLogo.js draws it
   * from the business name and the structure's own ink — so this costs
   * nothing today and says so where somebody can read it. */
  const source = String(global.logoSource ?? body['global[logoSource]'] ?? '').trim();

  if ('upload' === source) {
    return {
      ok: false,
      field: 'global[logoSource]',
      message: `${where} asks for an uploaded logo. A batch uses the generated `
        + 'wordmark — build that site on its own if it needs its own file.',
    };
  }

  const addr = localAddress(global);

  if (!addr.ok) {
    return { ok: false, message: `${where}: ${addr.error}`, field: (addr.fields || [])[0]?.name || '' };
  }

  global.address = addr.address;
  global.location = addr.location;
  body.global = global;

  const validGlobal = validateGlobalFields(global, { siteMode, siteTarget: 'cloudflare' });

  if (!validGlobal.ok) {
    return {
      ok: false,
      message: `${where}: ${validGlobal.error}`,
      field: (validGlobal.fields || [])[0]?.name || '',
    };
  }

  /* REQUIRED HERE RATHER THAN AT THE TOP, for the reason the job runner
   * gives about the same module: that route pulls in a dozen models. */
  const { checkWant } = require('./cloudflareSitesRoute');

  const ready = await checkWant({ userId: user._id, want: wantedAddress(body) });

  if (!ready.ok) {
    const SAY = {
      badName: ['Give the website a name and a subdomain.', 'global[cloudflare][prefix]'],
      badDomain: ['Choose one of the domains in the list.', 'global[cloudflare][domain]'],
      taken: [`${ready.domain || 'That address'} is already in use. Try another subdomain.`,
        'global[cloudflare][prefix]'],
      tooMany: [`You have reached the limit of ${ready.limit} websites.`,
        'global[cloudflare][prefix]'],
    };

    const [message, field] = SAY[ready.code]
      || ['That address could not be used.', 'global[cloudflare][prefix]'];

    return { ok: false, message: `${where}: ${message}`, field };
  }

  setGlobalDomain(body, ready.domain);

  return { ok: true, tag: ready.domain };
}

/**
 * POST /api/generate-batch
 *
 * Body: `{ sites: [ <one wizard submission>, ... ] }`, where each entry is
 * exactly the body a single build posts today. That is not a convenience:
 * utils/batchGenerator.js hands each one straight to generateForJob(), so
 * anything other than the real shape would be a second format to keep in
 * step with the first.
 */
router.post('/generate-batch', requireAuth, express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const sites = Array.isArray(req.body?.sites) ? req.body.sites : null;

    if (!sites || !sites.length) {
      return jsonValidationError(res, 400, 'Add at least one website to the batch.');
    }

    if (sites.length > MAX_SITES) {
      return jsonValidationError(res, 400,
        `A batch can hold up to ${MAX_SITES} websites. This one has ${sites.length}.`);
    }

    /* ONE BUILD FOLDER PER USER, SO ONE JOB THAT TOUCHES IT AT A TIME.
     *
     * The same guard generateRoute.js runs, against the same list of kinds
     * — which now includes 'sitebatch', because a batch holds the folder
     * for its whole run. Written here as well rather than shared, because
     * sharing it would mean exporting a query from a route that is
     * otherwise entirely about one submission; if a third caller appears,
     * that is the moment to lift it out. */
    const activeJob = await Job.findOne({
      user: req.user._id,
      status: { $in: ['queued', 'running'] },
      $or: [
        { kind: { $in: ['site', 'build', 'sitebatch'] } },
        { kind: { $exists: false } },
      ],
    }).lean();

    if (activeJob) {
      return res.status(409).json({
        error: 'A website is already being generated for your account. '
          + 'Please wait for it to finish.',
        jobId: String(activeJob._id),
        redirect: `/jobs/${activeJob._id}`,
        fields: [],
      });
    }

    /* EVERY SITE IS VETTED BEFORE ANY OF THEM IS QUEUED.
     *
     * The alternative — vet site one, queue, vet site two — would leave a
     * batch half-created when site three is wrong, and the owner looking at
     * a job that is building two of the three they typed.
     *
     *     A BATCH IS ACCEPTED WHOLE OR REFUSED WHOLE.
     *     WHAT HAPPENS AFTERWARDS IS A DIFFERENT PROMISE: ONCE IT IS
     *     RUNNING, ONE SITE FAILING DOES NOT STOP THE OTHERS.
     *
     * SEQUENTIALLY, NOT Promise.all. checkWant() asks Cloudflare and reads
     * the site collection; two of them racing for the same hostname would
     * both be told it is free. The loop is also what makes `seen` below
     * mean anything. */
    const seen = new Map();

    for (let i = 0; i < sites.length; i += 1) {
      const out = await vetOne(sites[i], { user: req.user, index: i });

      if (!out.ok) {
        return jsonValidationError(res, 400, out.message,
          out.field ? [{ name: out.field, message: out.message }] : []);
      }

      /* TWO SITES IN ONE BATCH MAY NOT ASK FOR THE SAME ADDRESS.
       *
       * checkWant() cannot catch this: it asks whether a hostname is taken
       * ALREADY, and neither of these is yet. Without this the batch would
       * build both and the second would publish over the first — one
       * address, two businesses, and the first one silently gone.
       *
       * CASE-FOLDED, because a hostname is. */
      const key = String(out.tag || '').trim().toLowerCase();

      if (seen.has(key)) {
        const message = `Site ${i + 1} and site ${seen.get(key) + 1} both ask for `
          + `${out.tag}. Give each website its own address.`;

        return jsonValidationError(res, 400, message,
          [{ name: 'global[cloudflare][prefix]', message }]);
      }

      seen.set(key, i);
    }

    /* THE BALANCE HAS TO COVER ALL OF THEM, NOT THE FIRST ONE.
     *
     * quote() prices this mode flat — a fixed eleven-page site — so N sites
     * is N times one site. Checking one would start a batch that runs out
     * half way through, and the sites that did build would have been paid
     * for out of a balance the owner thought was covering three.
     *
     *     A BATCH THAT CANNOT FINISH SHOULD NOT START.
     *
     * CHARGED PER SITE AS EACH ONE COMPLETES, not here. runLocalOptions
     * charges inside the build it is charging for, which is what makes a
     * site that never built a site that was never charged for — and that
     * stays true for each site in a batch. */
    const one = checkCredits(req.user, {}, { siteMode: MODES.LOCAL_OPTIONS });
    const needed = (one.totalCost || 0) * sites.length;
    const available = one.available || 0;

    if (available < needed) {
      return res.status(402).json({
        error: `This batch needs ${needed} credits for ${sites.length} websites `
          + `and you have ${available}.`,
        needed,
        available,
        fields: [],
      });
    }

    const jobId = new mongoose.Types.ObjectId();

    const job = await Job.create({
      _id: jobId,
      user: req.user._id,
      kind: 'sitebatch',
      status: 'queued',
      /* The column every list and support query reads. The builders read
       * the mode out of each site's own payload, as they always have. */
      siteMode: MODES.LOCAL_OPTIONS,
      payload: { sites },
      progress: {
        /* SITES, NOT PAGES. The batch owns this counter and translates the
         * inner build's page progress into `current` — see the note in
         * batchGenerator.js about a bar that would otherwise jump to 7 of
         * 11 and back. */
        total: sites.length,
        done: 0,
        stage: 'queued',
      },
    });

    log.generation('generation.batchQueued', {
      requestId: req.id,
      userId: String(req.user._id),
      jobId: String(job._id),
      sites: sites.length,
      addresses: [...seen.keys()],
      estimatedCredits: needed,
    });

    return res.json({
      ok: true,
      jobId: String(job._id),
      sites: sites.length,
      redirect: `/jobs/${job._id}`,
    });

  } catch (err) {
    log.error('generation.batchFailed', err, {
      requestId: req.id,
      userId: req.user ? String(req.user._id) : '',
    });

    return res.status(500).json({ error: 'The batch could not be queued.', fields: [] });
  }
});

module.exports = router;

/* Exported for test-site-batch.js. vetOne() is the whole decision this file
 * makes about one site, and the only honest way to test it is to ask — the
 * route around it needs express, an authenticated user and a Mongo. */
module.exports.vetOne = vetOne;
module.exports.MAX_SITES = MAX_SITES;
module.exports.globalOf = globalOf;
