// === Required Modules and Setup ===
const requireAuth = require('../middleware/requireAuth');
const User = require('../models/User');
const express = require('express');
const multer = require('multer');
// For minting a job's id before the job exists, so its uploads can be
// attached in the same write that makes it claimable. See below.
const mongoose = require('mongoose');
const router = express.Router();
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;


const {
  truthy,
  escapeAttr,
  checkCredits,
  chargeCredits,
  resetUserDirs,
  jsonValidationError,
  validateGlobalFields,
  moveOrCopyThenDelete,
  validateEachPageInputs,
  validateAndNormalizeLocationPages
 } = require('../utils/helpers');

const {
  getUserDirs,
  copyVendorAssets,
  writePageAssets
} = require('../utils/buildAssets');
const { buildSocialLinks } = require('../utils/buildSocialLinks');
const { fetchPeopleAlsoAsk } = require('../utils/fetchPeopleAlsoAsk');
const { generateFaqAnswers } = require('../utils/generateFaqAnswers');
const { generateServiceCards } = require('../utils/buildServiceCards');
const { generatePricing } = require('../utils/buildPricingTable');
const { buildSitemap } = require('../utils/buildSitemap');
const { stripUnusedHero } = require('../utils/stripUnusedHero');
const Job = require('../models/Job');
const { moveUploadsForJob } = require('../utils/jobUploads');
const { log } = require('../utils/logger');
const { generationLimiter } = require('../utils/concurrencyLimiter');
const { fillLegalLinks } = require('../utils/legalLinks');
const { buildContactPage } = require('../utils/buildContactPage');
const { buildContactFormHtml } = require('../utils/pageParts');
const { MODES, normalizeSiteMode, pagesToBuild } = require('../utils/seoPresets');
const { localAddress } = require('../utils/localOptions/address');

const CM = require('../utils/contentModel');


// NOTE: there is deliberately no `isDev` flag here any more.
//
// Generation is a user action, not an environment. It must run identically
// whether the server was started with `npm run dev` or `npm start`.
// The dev/production split is expressed by the two ROUTES:
//   POST /generate   -> writes the site into dist/user_<id>/
//   GET  /production -> copies that folder, optimises the copy, zips it
const basePath = '';


// === Directory Setup ===
const tempUploadDir = path.join(__dirname, '../public/uploads');
const baseDistDir = path.join(__dirname, '../dist');


// === Multer Setup
// Uploads are logos and favicons — small images, nothing else.
//
// Previously there was no size limit and no type check. Two consequences:
// a single request could fill the disk, and a file named .png containing PHP
// would be copied into a generated WordPress theme, where the server might
// execute it. The extension check matters as much as the MIME type, because
// the MIME type is supplied by the client and can simply be lied about.
const ALLOWED_IMAGE_MIME = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'image/x-icon',
  'image/vnd.microsoft.icon',
]);

const ALLOWED_IMAGE_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.svg', '.ico',
]);

const upload = multer({
  dest: tempUploadDir,
  limits: {
    fileSize: 5 * 1024 * 1024,  // 5 MB — a logo is far smaller
    files: 4,                   // logo, favicon, and room to spare
    fields: 200,                // the wizard posts a lot of fields
    fieldSize: 100 * 1024,      // 100 KB per field
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();

    if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
      return cb(new Error(`Unsupported file type: ${file.mimetype}. Please upload a PNG, JPG, WebP, SVG or ICO.`));
    }

    if (!ALLOWED_IMAGE_EXT.has(ext)) {
      return cb(new Error(`Unsupported file extension: ${ext || '(none)'}. Please upload a PNG, JPG, WebP, SVG or ICO.`));
    }

    cb(null, true);
  },
});


// One generation per user at a time.
//
// Two concurrent builds share dist/user_<id>/: the second wipes the first
// mid-flight, then skips any page the first had already written (the
// builders all guard with fs.existsSync). That produced sites whose HTML and
// content.json disagreed. The client only submits once now, but this closes
// the door on double-clicks, two tabs, and direct POSTs.
const generating = new Set();


// === Custom Utility Functions ===
const {
    slugify,
    googleMap,
    buildSchema,
    buildNavMenu,
    buildAltText,
    normalizeText,
    smartTitleCase,
    generateReview,
    formatCityState,
    generateMetadata,
    buildAboutUsPage,
    getHoursTimeText,
    createBuildRecord,
    buildInterlinksMap,
    buildLocationPages,
    formatPhoneForHref,
    buildTermsOfUsePage,
    generatePagesContent,
    injectPagesInterlinks,
    buildPrivacyPolicyPage,
    buildAccessibilityPage,
    copyAllPredefinedImages,
    getCoordinatesFromAddress

  } = require('../utils/pageGenerator');




// === Generate Route: POST (handles form submission) ===
router.post('/generate', upload.any(), async (req, res) => {

  const tempFiles = (req.files || []).map(f => f.path);

  // Declared OUT here, not inside the try. `finally` is a separate block, so
  // a `let` declared inside `try` is not in scope there — releasing the slot
  // would throw a ReferenceError, get swallowed by the catch around it, and
  // the slot would leak until the pool was empty and every generation hung.
  // Once uploads belong to a job they must NOT be deleted by the cleanup
  // below — the job runs long after this response returns.
  let movedUploads = false;

  try {
    let pages = req.body.pages;
    const global = req.body.global;
    const showAboutForm = (v => v === true || v === 'true' || v === 'on' || v === '1')(global?.showAboutForm);


    // 🔐 Per-user dist directories
    const userId = req.user._id.toString();
    const { distDir, assetsDir, cssDir, jsDir, entryDir } = getUserDirs(baseDistDir, userId);


    // =========================================================
    // 1. VALIDATE FIRST
    // These checks run before anything is deleted, so a bad
    // submission no longer destroys the user's previous site.
    // =========================================================

    // THE site mode for this submission, resolved once.
    //
    // This used to be a boolean — `siteMode === 'sample'` — and every use of
    // it below re-derived a string as `isSample ? 'sample' : 'lead'`. With two
    // modes that was correct. With three it silently rewrites 'rankfast' as
    // 'lead' in the credit check, in both log lines and, worst of all, in the
    // Job record that is this build's permanent history.
    //
    // normalizeSiteMode() knows all four and still falls back to 'lead' for
    // anything unrecognised, so a hand-crafted POST cannot invent a mode.
    //
    // A design sample is one page shown to a prospective client. It skips the
    // service, location and legal pages, the pricing table, the FAQ and the
    // sitemap — everything that only matters for a published site. Rank Fast
    // builds all of them; only the SEO formats differ.
    //
    // Read from the request rather than globalValues, which does not exist in
    // this handler at all — generation happens in the background job.
    //
    // RESOLVED FIRST, AND IT USED TO BE RESOLVED LAST. "Once" was true and
    // the position was wrong twice over: the address check below needs the
    // mode, and so does the pages check immediately after this, which is the
    // first thing in the handler that can reject a submission. Nothing
    // between the old position and this one reads it, so moving it changes
    // nothing for the other three modes.
    const siteMode = normalizeSiteMode(
      req.body.global?.siteMode ?? req.body['global[siteMode]']
    );
    const isSample = siteMode === MODES.SAMPLE;

    /* Make sure at least one page is submitted and it's submitted the right way.
     *
     * EXCEPT WHERE THE CUSTOMER WAS NEVER ASKED.
     *
     * Local Website Options has no service-pages step: the model names the
     * six, so `pages` arrives empty and that is the correct submission. This
     * guard refused it with "No pages submitted" — a message about a step
     * that is not in that wizard, on a form with nothing to go back and fix.
     *
     * The shape is still checked. An empty object is fine; a string or an
     * array of nulls is not, in any mode.
     *
     * THE COUNT IS NOT TRUSTED FROM HERE EITHER WAY. utils/runLocalOptions.js
     * asks utils/suggestServices.js for exactly six and throws on anything
     * else, before it wipes the customer's previous site. */
    /* ABSENT, NOT EMPTY — and that distinction cost a second attempt.
     *
     * The first version of this exception read `!Object.keys(pages).length`
     * and left the shape check above it alone, on the assumption that an
     * empty `pages` object would arrive. Nothing posts one. The wizard names
     * its service rows `pages[0][filename]`, so with no rows there are no
     * such fields at all and Express never creates the key: `req.body.pages`
     * is `undefined`, and `!pages` rejected it before the exception below
     * was ever reached.
     *
     * Normalised HERE rather than guarded at each use, because `pages` is
     * read four more times before this handler ends — validateEachPageInputs
     * refuses `undefined` with the same message, and would have been the
     * next wall. One `{}` fixes all of them. */
    if (pages === undefined && siteMode === MODES.LOCAL_OPTIONS) {
      pages = {};
    }

    if (!pages || typeof pages !== 'object') {
      return jsonValidationError(res, 400, '❌ No pages submitted.');
    }

    if (!Object.keys(pages).length && siteMode !== MODES.LOCAL_OPTIONS) {
      return jsonValidationError(res, 400, '❌ No pages submitted.');
    }

    /* LOCAL WEBSITE OPTIONS ASKS FOR THE ADDRESS IN FOUR BOXES.
     *
     * Its renderer needs street, city, state and ZIP apart — PostalAddress
     * has a field for each, and a LocalBusiness node with the town sitting
     * inside streetAddress is read wrong rather than not at all. So that mode
     * shows four boxes in place of the single Address and Main Location pair,
     * and both of those strings are composed from them here.
     *
     * BEFORE validateGlobalFields(), which requires `address` and `location`
     * for every mode. Composing first means that function needs no knowledge
     * of this mode at all, and the four boxes remain the only place the
     * address is typed. utils/localOptions/address.js records why they are
     * not split out of one free-text box instead. */
    if (siteMode === MODES.LOCAL_OPTIONS) {
      const addr = localAddress(global);
      if (!addr.ok) {
        return jsonValidationError(res, 400, addr.error, addr.fields);
      }
      global.address = addr.address;
      global.location = addr.location;
    }

    /* THE MODE IS HANDED OVER, because this handler has already worked it
     * out of a body that carries it in one of two shapes — and the domain
     * field this mode requires depends on it. */
    const validGlobal = validateGlobalFields(global, { siteMode });
    if (!validGlobal.ok) {
      return jsonValidationError(res, 400, validGlobal.error, validGlobal.fields);
    }

    // Validate Each Page inputs
    const validPages = validateEachPageInputs(pages);
    if (!validPages.ok) {
      return jsonValidationError(res, 400, validPages.error, validPages.fields);
    }

    /**
     * Near-duplicate services: recorded, not refused.
     *
     * The wizard warns about these before submitting and offers to carry on,
     * because two similar-looking services are sometimes two real services.
     * By the time a request arrives here that decision has been made — so
     * this exists to make the pattern VISIBLE. Nothing else in the app would
     * ever tell us that customers are routinely buying two pages that compete
     * with each other, and that is worth knowing: it is a wasted 100 credits
     * every time, and the customer blames the product when neither ranks.
     */
    if (validPages.warnings && validPages.warnings.length) {
      log.info('generate.similarServices', {
        requestId: req.id,
        userId: String(req.user?._id || ''),
        pairs: validPages.warnings.map(w => w.names),
      });
    }

    // LOCATION PAGES: read array from inputs named global[locationPages][]
    //
    // global.location is the third argument so a page for the site's OWN town
    // is rejected — it duplicates the home page. This is the call site that
    // reports the problem to the customer; runGeneration.js passes it too, but
    // by then the job is queued and nobody is watching.
    const wantsLocationPages = truthy(global.addLocations);
    const { ok: locOK, locations, fields: locFields, error: locError } =
      validateAndNormalizeLocationPages(global.locationPages, global.addLocations, global.location);
    if (!locOK) return jsonValidationError(res, 400, locError, locFields);


    /* Reject a second build while one is already queued or running.
     *
     * Checks the job collection rather than an in-memory Set: the work no
     * longer happens in this request, so nothing in memory would know about
     * it — and a user could otherwise queue ten builds in ten seconds.
     *
     * `kind` MATTERS, AND LEAVING IT OUT COST A WHOLE BUILD.
     *
     * This query asked for ANY queued or running job belonging to the user.
     * Job.kind has been 'site' | 'blog' | 'build' since the Interlink Engine
     * shipped, so a fifteen-article blog campaign — one job, queued for as
     * long as it takes to write fifteen posts — blocked every website build
     * on the account.
     *
     * AND IT DID NOT LOOK LIKE A REFUSAL. The 409 carries a redirect, and
     * public/js/spinner.js follows it without showing the message. Edwin
     * approved a campaign, started a site build, was sent to a progress page
     * and watched a bar fill to 15 of 15 — the campaign's bar, for a site
     * build that was never created. The articles arrived; the website did
     * not exist, and nothing anywhere said so.
     *
     * The error text was wrong in the same way: "A website is already being
     * generated for your account" when no website was being generated at
     * all.
     *
     * THE RULE IS NOT "ONE JOB", IT IS "ONE JOB THAT TOUCHES THIS USER'S
     * BUILD FOLDER", which is what the guard was always for. A site build
     * wipes and refills dist/user_<id>; a production build copies and zips
     * that same folder, so a wipe part way through it yields a corrupt
     * download. Those two must not overlap. A blog campaign writes to Mongo
     * and to Cloudflare and never opens that folder, so it has no business
     * being in this query.
     *
     * The `$exists: false` arm is for rows written before `kind` existed —
     * those are site builds, and utils/jobRunner.js's claimNextJob() treats
     * them the same way for the same reason. */
    const DIST_KINDS = ['site', 'build'];

    const activeJob = await Job.findOne({
      user: req.user._id,
      status: { $in: ['queued', 'running'] },
      $or: [
        { kind: { $in: DIST_KINDS } },
        { kind: { $exists: false } },
      ],
    }).lean();

    if (activeJob) {
      return res.status(409).json({
        error: 'A website is already being generated for your account. Please wait for it to finish.',
        jobId: String(activeJob._id),
        redirect: `/jobs/${activeJob._id}`,
        fields: [],
      });
    }

    /* `siteMode` and `isSample` are resolved up beside the validation now,
     * because the address check needs the mode. They were declared here. */

    const startedAt = Date.now();
    log.generation('generation.started', {
      requestId: req.id,
      userId: String(req.user._id),
      siteMode,
      servicePages: Object.keys(pages || {}).length,
    });

    // Location pages and the site mode both affect the price now, so they
    // have to reach checkCredits — previously only service pages counted,
    // which made locations free and samples free entirely.
    // Use the VALIDATED list, not the raw input: validateAndNormalizeLocationPages
    // drops duplicates and blanks, so charging on the raw array would bill for
    // locations that were never generated.
    const locationCount = (isSample || !wantsLocationPages)
      ? 0
      : (Array.isArray(locations) ? locations.length : 0);

    // The real mode goes through, so this quote and the one runGeneration
    // re-checks at build time are computed from the same input. Sending
    // 'lead' here and the real mode there would let a user be quoted one
    // price and charged another.
    const credit = checkCredits(req.user, pages, {
      siteMode,
      locationPages: locationCount,
    });
    if (!credit.ok) {
      return res.status(402).json({
        error: 'Not enough credits.',
        creditsError: true,
        pagesCount: credit.pagesCount,
        totalCost: credit.totalCost,
        available: credit.available,
        fields: [],
      });
    }

    // NOTE: no concurrency slot is taken here.
    //
    // Enqueueing is instant, and jobRunner applies the same limiter when it
    // picks the job up. Acquiring here would hold a slot for the whole
    // background build — with a limit of 3, four users would block the
    // fourth from even submitting.
    //
    // The per-user lock also goes: it prevented two simultaneous builds,
    // which the job queue now handles by running them in order.


    // =========================================================
    // 2. ENQUEUE — the work happens in the background
    //
    // Generation used to run right here, inside the request. A one-page
    // site took 59 seconds; a hundred pages is closer to a hundred minutes,
    // which no browser or proxy will wait for. Worse, a failure part way
    // through lost every page already written.
    //
    // The job is saved and the id returned immediately. utils/jobRunner.js
    // picks it up, and /jobs/:id shows progress.
    // =========================================================

    /* THE ID IS MINTED HERE, BEFORE THE JOB EXISTS.
     *
     * This used to be Job.create({ status: 'queued' }) followed by moving the
     * uploads and a second write to attach them. A job is claimable the
     * instant it is created, so the runner could — and on 9 October did —
     * start it 48ms before the logo had been attached. It read `uploads` as
     * the empty default, found no files, and failed with "The logo could not
     * be processed"; then jobGenerator's cleanup deleted the folder the route
     * had just filled, leaving a path in the database pointing at nothing.
     *
     * Narrowing the window would not have fixed it. The uploads now move
     * first, into the folder this id names, and the job is created ONCE with
     * them already on it. There is no moment when a claimable job is missing
     * its files. */
    const jobId = new mongoose.Types.ObjectId();

    // Out of multer's temp directory before the response returns — the
    // finally below deletes whatever is left there, and the job runs long
    // afterwards.
    const uploads = await moveUploadsForJob(req.files || [], jobId);

    // The paths belong to the job now, so the cleanup below must not touch
    // them. Set before Job.create: if that throws, the catch returns 500 and
    // these files are orphaned, which costs a few KB — deleting them while a
    // job might still be created would cost the build.
    movedUploads = true;

    const job = await Job.create({
      _id: jobId,
      uploads,
      user: req.user._id,
      status: 'queued',
      // The REAL mode. The build itself reads siteMode out of `payload`, so
      // it was always going to run as Rank Fast — but this column is what
      // every list, filter and support query reads, and it was recording
      // "lead" for a site that is not one.
      //
      // ⚠️ models/Job.js: if siteMode is declared with an enum, 'rankfast'
      // has to be added to it or Job.create throws a ValidationError here and
      // the wizard reports "Generation failed."
      siteMode,
      payload: req.body,
      progress: {
        // A design sample writes one page. The wizard still collects
        // service pages on the step before, and counting them here made the
        // bar start at "0 of 2" and stop at "1 of 2".
        total: pagesToBuild(siteMode, pages, locationCount),
        done: 0,
        stage: 'queued',
      },
    });

    log.generation('generation.queued', {
      requestId: req.id,
      userId: String(req.user._id),
      jobId: String(job._id),
      siteMode,
      servicePages: Object.keys(pages || {}).length,
      locationPages: locationCount,
      estimatedCredits: credit.totalCost,
    });

    return res.json({
      ok: true,
      jobId: String(job._id),
      redirect: `/jobs/${job._id}`,
    });

  } catch (err) {
    console.error('Error during /generate:', err);
    return jsonValidationError(res, 500, 'Generation failed.');
  } finally {
    // Delete temp uploads ONLY if they were not handed to a job. Deleting
    // them after a successful enqueue would leave the job with no logo.
    if (!movedUploads) {
      await Promise.allSettled(tempFiles.map(p => fsp.unlink(p).catch(() => {})));
    }
  }

});

module.exports = router;