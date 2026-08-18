// === Required Modules and Setup ===
const requireAuth = require('../middleware/requireAuth');
const User = require('../models/User');
const express = require('express');
const multer = require('multer');
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
    const pages = req.body.pages;
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

    // Make sure at least one page is submitted and it's submitted the right way
    if (!pages || typeof pages !== 'object' || Object.keys(pages).length === 0) {
      return jsonValidationError(res, 400, '❌ No pages submitted.');
    }

    // Validate global text fields from req.body
    const validGlobal = validateGlobalFields(global);
    if (!validGlobal.ok) {
      return jsonValidationError(res, 400, validGlobal.error, validGlobal.fields);
    }

    // Validate Each Page inputs
    const validPages = validateEachPageInputs(pages);
    if (!validPages.ok) {
      return jsonValidationError(res, 400, validPages.error, validPages.fields);
    }

    // LOCATION PAGES: read array from inputs named global[locationPages][]
    const wantsLocationPages = truthy(global.addLocations);
    const { ok: locOK, locations, fields: locFields, error: locError } =
      validateAndNormalizeLocationPages(global.locationPages, global.addLocations);
    if (!locOK) return jsonValidationError(res, 400, locError, locFields);


    // Reject a second build while one is already queued or running.
    //
    // Checks the job collection rather than an in-memory Set: the work no
    // longer happens in this request, so nothing in memory would know about
    // it — and a user could otherwise queue ten builds in ten seconds.
    const activeJob = await Job.findOne({
      user: req.user._id,
      status: { $in: ['queued', 'running'] },
    }).lean();

    if (activeJob) {
      return res.status(409).json({
        error: 'A website is already being generated for your account. Please wait for it to finish.',
        jobId: String(activeJob._id),
        redirect: `/jobs/${activeJob._id}`,
        fields: [],
      });
    }

    // Affordability check. Nothing is deducted yet — that happens only if
    // the build succeeds, so a failure never costs the user credits.
    // A design sample is one page shown to a prospective client. It skips
    // the service, location and legal pages, the pricing table, the FAQ and
    // the sitemap — everything that only matters for a published site.
    //
    // Read from the request rather than globalValues, which is not built
    // until later in this handler.
    const isSample =
      (req.body.global?.siteMode ?? req.body['global[siteMode]']) === 'sample';

    const startedAt = Date.now();
    log.generation('generation.started', {
      requestId: req.id,
      userId: String(req.user._id),
      siteMode: isSample ? 'sample' : 'lead',
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

    const credit = checkCredits(req.user, pages, {
      siteMode: isSample ? 'sample' : 'lead',
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

    const job = await Job.create({
      user: req.user._id,
      status: 'queued',
      siteMode: isSample ? 'sample' : 'lead',
      payload: req.body,
      progress: {
        total: Object.keys(pages || {}).length + locationCount + 1,
        done: 0,
        stage: 'queued',
      },
    });

    // Uploads must be moved out of multer's temp directory BEFORE this
    // response returns — the finally below deletes whatever is left there,
    // and the job runs long afterwards.
    const uploads = await moveUploadsForJob(req.files || [], job._id);
    await Job.updateOne({ _id: job._id }, { $set: { uploads } });

    // These paths now belong to the job, so the cleanup below must not
    // delete them.
    movedUploads = true;

    log.generation('generation.queued', {
      requestId: req.id,
      userId: String(req.user._id),
      jobId: String(job._id),
      siteMode: isSample ? 'sample' : 'lead',
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