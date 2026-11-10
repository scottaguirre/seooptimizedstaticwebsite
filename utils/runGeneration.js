// utils/runGeneration.js
//
// The site generation itself, lifted out of the HTTP route.
//
// It used to run inside the request handler. A one-page site took 59 seconds
// and a hundred pages would take roughly a hundred minutes — far beyond what
// browsers and proxies allow — and a failure part way through lost every
// page already written.
//
// Extracting it changes nothing about HOW a site is built. The body below is
// the same code that ran in the route; only its inputs changed. Instead of
// reading req.files, req.body and req.user it takes a plain context object,
// so the same function serves a request or a background job.
//
// PROGRESS
// report() is called as each page completes. The job runner persists that,
// which is what lets a restarted job resume rather than regenerating pages
// the user has already paid for.

const User = require('../models/User');
const { fullAddress } = require('./fullAddress');
const { checkPlaceholders } = require('./checkPlaceholders');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
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
 } = require('./helpers');
const {
  getUserDirs,
  copyVendorAssets,
  writePageAssets
} = require('./buildAssets');
const { buildSocialLinks } = require('./buildSocialLinks');
const { fetchPeopleAlsoAsk } = require('./fetchPeopleAlsoAsk');
const { generateFaqAnswers } = require('./generateFaqAnswers');
const { addUsedQuestions } = require('./generateLocationFaq');
const { generateServiceCards } = require('./buildServiceCards');
const { generatePricing } = require('./buildPricingTable');
// The shape rules — what each kind of business is allowed to render. Used
// here so a table that will never be shown is never paid for either.
const { capabilities } = require('./businessShape');
const { keptOn } = require('./sectionToggle');
const { generateCaseStudy } = require('./generateCaseStudy');
const { generateSampleReviews } = require('./generateSampleReviews');
const { buildSitemap } = require('./buildSitemap');
const { buildHtaccess } = require('./buildHtaccess');
const { stripUnusedHero } = require('./stripUnusedHero');
const { serviceMeta } = require('./pageMeta');
const { log } = require('./logger');
const { generationLimiter } = require('./concurrencyLimiter');
const { fillLegalLinks } = require('./legalLinks');
const { buildContactPage } = require('./buildContactPage');
const { buildContactFormHtml } = require('./pageParts');
const { MODES, getPreset, normalizeSiteMode, assetFile, assetPath, imageAlt, FIXED_PAGES } = require('./seoPresets');
const { buildRankFastInterlinksMap, interlinkSlugs } = require('./buildRankFastLinks');
const { canonicalTag } = require('./canonicalUrl');
const { siteBaseUrl } = require('./buildSitemap');
const { imageExtension } = require('./uploadExtension');
const CM = require('./contentModel');

/* THE OTHER DIRECTION: a stored content.json read back as the shapes the
 * generators return, so an edited site can be rendered again without paying
 * for the same words twice. See utils/reuseModel.js. */
const { reuseFrom } = require('./reuseModel');

/* AND WHAT THE WIZARD WAS ASKED FOR — the half of a re-render that
 * content.json cannot carry. See utils/buildRecipe.js. */
const { writeRecipe } = require('./buildRecipe');
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

  } = require('./pageGenerator');

// dist/ lives at the project root. The route computed this relative to
// routes/; from utils/ the path is the same one level up.
const baseDistDir = path.join(__dirname, '..', 'dist');

// Where multer drops uploads. resetUserDirs is told to leave it alone, so
// this only needs to point at the same folder the route configured.
const tempUploadDir = path.join(__dirname, '..', 'public', 'uploads');

// Every generated page sits at the site root, so links between them need no
// prefix. Kept as a constant because the nav builder takes it as a parameter.
const basePath = '';

/**
 * @param {object}   ctx
 * @param {object}   ctx.body        the wizard payload (was req.body)
 * @param {Array}    ctx.files       uploads (was req.files)
 * @param {object}   ctx.user        the User document (was req.user)
 * @param {string}   ctx.requestId   for logging (was req.id)
 * @param {Function} [ctx.onProgress]
 */
async function runGeneration(ctx) {
  const report = ctx.onProgress || (async () => {});

  // Pages already written by an earlier attempt at this job. Skipping them
  // is the difference between resuming and paying to generate the same
  // content twice.
  const alreadyDone = new Set(ctx.alreadyCompleted || []);

  let pagesDone = alreadyDone.size;

  /* RENDERING A SITE THAT ALREADY HAS ITS WORDS.
   *
   * `ctx.reuse` is a parsed content.json from an earlier build of this site.
   * When it is present, every generation call below asks it first and only
   * reaches the model for what it cannot answer.
   *
   * NULL IS THE NORMAL CASE, and must behave exactly as this function always
   * did. Every test below is written `reuse && …` in that order so that an
   * absent or unreadable model falls through to generating rather than
   * rendering a shell — and reuseFrom() returns null for a model version it
   * does not understand, for the same reason.
   *
   * WHAT IT DOES NOT COVER: generateReview, which produces the JSON-LD review
   * and is not recorded in the model. It still runs, once per service page.
   * So a re-render is CHEAPER, NOT FREE, and no screen should say otherwise.
   */
  const reuse = ctx.reuse ? reuseFrom(ctx.reuse) : null;

  if (ctx.reuse && !reuse) {
    /* ASKED FOR AND REFUSED. Falling through silently would charge for a
     * site the customer was told would cost nothing — the one outcome here
     * worth a line in the log. */
    log.generation('generation.reuse_refused', {
      requestId: ctx.requestId,
      version: ctx.reuse && ctx.reuse.version,
    });
  }

  // ---------------------------------------------------------------------
  // Setup the route used to do before calling this.
  //
  // These were computed in the request handler and were simply in scope for
  // the generation code below. Extracting that code left them undefined —
  // the job failed instantly with "distDir is not defined" — so the same
  // setup is repeated here from the context.
  //
  // The route still validates; this only derives what generation needs.
  // ---------------------------------------------------------------------
  const pages = ctx.body.pages;
  const global = ctx.body.global;
  const showAboutForm = (v => v === true || v === 'true' || v === 'on' || v === '1')(global?.showAboutForm);

  /* The price range table and the hero trust badges: opt-OUT checkboxes.
   *
   * The rules they follow — absent means on, only present-and-falsy turns a
   * section off, and a preference can only ever SUBTRACT from what
   * capabilities(businessType) permits — live in utils/sectionToggle.js,
   * beside keptOn() itself, because buildAboutUsPage has to follow exactly
   * the same ones and two copies of them drifted once already. */
  const showPricingTable = keptOn(global?.showPricingTable);

  const showBadges = keptOn(global?.showBadges);

  /* The four example reviews on the About page: the same opt-OUT checkbox,
   * added 3 November because there had never been one. Every build generated
   * the section, so a customer who did not want it had to delete it after the
   * fact — and in WordPress that meant the database, because the theme's
   * reviews meta box could not save a deletion either.
   *
   * GATED HERE AND NOWHERE ELSE, which is the whole design and is different
   * from how pricing and badges are done. Those are read twice, once to
   * decide whether to PAY and once to decide whether to RENDER, and
   * utils/sectionToggle.js exists because the two readings drifted. This one
   * cannot drift, because an unticked box does not produce a `false` that two
   * files have to agree about — it produces no reviews at all:
   *
   *   reviews === null  ->  buildReviewsSection(null)    returns ''
   *                     ->  reviewRows(null)             returns []
   *                     ->  CM.reviewsSection([])        returns null
   *                     ->  nothing is pushed into the model, so the
   *                         exported WordPress theme has no reviews section
   *                         either, with no second rule to keep in step
   *
   * THE ABSENCE IS THE DECISION. buildAboutUsPage is the only caller and it
   * already defaults `reviews = null`, so there is one gate, in front of the
   * model call that costs the credits. Adding a keptOn() down there as well
   * would be the second reading this codebase has already been bitten by. */
  const showReviews = keptOn(global?.showReviews);

  const userId = ctx.user._id.toString();
  const { distDir, assetsDir, cssDir, jsDir, entryDir } = getUserDirs(baseDistDir, userId);

  // THE site mode for this build, resolved once.
  //
  // This used to read `siteMode === 'sample' ? 'sample' : 'lead'`, which was
  // fine while there were two modes and silently wrong the moment there were
  // three: 'rankfast' fell through to 'lead' and the new formats never ran.
  // normalizeSiteMode() knows all three and still falls back to 'lead' for
  // anything unrecognised, so a malformed request can never produce a
  // stripped-down site — or, now, the wrong SEO formats.
  const siteMode = normalizeSiteMode(
    ctx.body.global?.siteMode ?? ctx.body['global[siteMode]']
  );
  const preset = getPreset(siteMode);

  const isSample = siteMode === MODES.SAMPLE;

  const wantsLocationPages = truthy(global.addLocations);

  // Same three arguments as the route. This call only destructures `locations`
  // and ignores `ok`, so a town matching the site's own is silently DROPPED
  // here rather than reported — which is the right outcome for a job already
  // in the queue, and is also why the route must pass global.location too. If
  // only this call had it, an older queued job would lose a page with no
  // explanation anywhere.
  const { locations } = validateAndNormalizeLocationPages(
    global.locationPages,
    global.addLocations,
    global.location
  );

  const locationCount = (isSample || !wantsLocationPages)
    ? 0
    : (Array.isArray(locations) ? locations.length : 0);

  // Re-checked here rather than trusted from enqueue time: the balance may
  // have changed while the job sat in the queue.
  //
  // The real mode goes through. Rank Fast builds the same page set as Rank
  // GBPs, so it should price the same — but that is utils/pricing.js's call
  // to make, not this file's, and flattening it to 'lead' here would hide a
  // pricing bug rather than surface it.
  const credit = checkCredits(ctx.user, pages, {
    siteMode,
    locationPages: locationCount,
  });

  /* THE CHECK HAS TO MATCH THE CHARGE, AND FOR A WHILE IT DID NOT.
   *
   * A re-render charges nothing — `const charged = reuse ? 0 : credit.totalCost`
   * further down, because the words were paid for when they were generated
   * and fixing a sentence is not new words. The CHECK was left asking for
   * the full price anyway, so editing two paragraphs on a published site
   * was refused with
   *
   *     Not enough credits: this build needs 3500, you have 0.
   *
   * for a build that was about to take nothing. Nobody hit it until the
   * re-render got far enough to reach this line; the logo guard above was
   * failing first.
   *
   *     A CHECK THAT REFUSES MORE THAN THE CHARGE TAKES IS A CHECK FOR A
   *     DIFFERENT FEATURE. One condition, written once, read twice.
   *
   * NOT FREE IN REAL TERMS, and the distinction is worth keeping straight:
   * generateReview still makes one model call per service page, so a
   * re-render costs the business money even though it costs the customer no
   * credits. If that is ever to be charged for, it is a price to add here —
   * not a refusal to leave in place and hope nobody notices. */
  if (!reuse && !credit.ok) {
    throw new Error(
      `Not enough credits: this build needs ${credit.totalCost}, you have ${credit.available}.`
    );
  }

  const businessType = slugify(global.businessType || '');

  // `pages` arrives from the form as an object keyed by index. Some helpers
  // iterate it with Object.entries(), but buildInterlinksMap and
  // injectPagesInterlinks expect a real array — they call .forEach and
  // .find on it. Converted once here rather than at each call site.
  const pagesArray = Array.isArray(pages) ? pages : Object.values(pages || {});

  // For the duration in generation.completed. The route used to set this
  // before enqueueing; it now measures the build itself, which is the
  // number that actually matters.
  const startedAt = Date.now();

  // Report immediately. The first page takes 15-20 seconds to arrive, and
  // without this the user watches a 0% bar with no indication anything is
  // happening — the most common moment to assume it has hung and refresh.
  await report({ stage: 'Preparing your website', current: '' });


    // =========================================================
    // 2. RESET THIS USER'S BUILD FOLDER
    // Only touches dist/user_<id>/ — never the shared src/ folders.
    // =========================================================
    await report({ stage: 'Setting up your build folder', current: '' });

    resetUserDirs({
      distDir,
      assetsDir,
      cssDir,
      jsDir,
      entryDir,
      tempUploadDir
    });

    // Copy bootstrap css/js out of src/ into this user's folder once
    copyVendorAssets({ cssDir, jsDir });


    // =========================================================
    // 3. PROCESS UPLOADS
    // =========================================================

    // ✅ Initialize uploadedImages early
    const uploadedImages = { global: {} };
    const files = ctx.files || [];


    for (const file of files) {
      const globalMatch = file.fieldname.match(/global\[(.*?)\]/);

      // Not path.extname(file.originalname).
      //
      // That returns '' for an upload whose name has no extension — a logo
      // pasted from the clipboard, dragged from another tab, or picked on a
      // phone. assetFile()'s '.webp' default does not rescue it, because a
      // default only applies to `undefined` and '' is a value, so the site
      // shipped <img src="assets/acme-logo"> and the logo silently did not
      // load. imageExtension falls back to the MIME type.
      const ext = imageExtension(file);

      // Logo and favicon naming, by mode:
      //
      //   Rank GBPs   emergency-plumber-leander-leander-tx-logo.png
      //   Rank Fast   emergency-plumber-leander-logo.png
      //
      // The business name alone. These two files sit at the site root's
      // assets/ folder and there is exactly one of each, so the location adds
      // length without adding uniqueness.
      const seoPrefix = preset.images.globalPrefix({
        businessName: global.businessName,
        location: global.location || '',
      });


      if (globalMatch) {
        const field = globalMatch[1];
        const newFilename = assetFile(seoPrefix, field, ext);
        const destPath = path.join(assetsDir, newFilename);

        // If it's the logo, generate the favicon FROM THE TEMP FILE first
        if (field === 'logo') {
          const faviconFilename = assetFile(seoPrefix, 'favicon-42x42', '.png');
          const faviconPath = path.join(assetsDir, faviconFilename);

          try {
            // Use the temp upload as source – it definitely exists at this point
            await sharp(file.path)
              .resize(42, 42, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 }
              })
              .png()
              .toFile(faviconPath);

            uploadedImages.global.favicon = `assets/${faviconFilename}`;
          } catch (err) {
            console.error('Error generating favicon from logo:', err);
            // Fallback: we'll at least have the logo; favicon can default to it later if needed
            uploadedImages.global.favicon = `assets/${newFilename}`;
          }
        }

        // Now move the uploaded file into the per-user assets folder
        await moveOrCopyThenDelete(file.path, destPath);
        uploadedImages.global[field] = `assets/${newFilename}`;
      }

    }


    // Check required global files
    //
    // Throws rather than returning a validation response: there is no `res`
    // in a background job. The runner catches this, marks the job failed and
    // shows the message on the progress page.
    //
    // TWO FAILURES, TWO MESSAGES. "Try uploading it again" was shown for both
    // for months, and it was the wrong advice for the one that kept
    // happening: the file had uploaded perfectly, and the job simply started
    // before it was attached (see the comment on jobId in generateRoute.js).
    // Re-uploading an innocent file is the one action that cannot help, and
    // being told to do it hides a bug in the queue behind a bug in the logo.
    /* A RE-RENDER HAS NO UPLOADS, AND THE LOGO IS STILL REQUIRED.
     *
     * The edit screen calls this with `files: []` on purpose — the images are
     * not regenerated, they are copied back out of the site's own store after
     * the build (see utils/cloudflareSites/siteStore.js). But the guard below
     * only ever saw a request with no files as a job that outran its upload,
     * so every save on a published website failed with
     *
     *     "This build started before its logo was attached. Nothing is wrong
     *      with the file — please press Generate again."
     *
     * — advice that could not be followed, on a screen with no Generate
     * button, for a file that was sitting in the store the whole time.
     *
     * THE PATHS ARE IN THE STORED MODEL, which is the same place the words
     * come from: `global.logo` and `global.favicon` hold the exact filenames
     * the previous build wrote, and restoreAssets puts those same files back
     * under those same names. Taking them from there is not a fallback — it
     * is the only correct source for a rebuild, because a re-uploaded logo
     * would land under a NEW hashed filename and the restored assets would
     * then be the ones nothing references.
     *
     * Seeded before the check rather than special-casing the check, so
     * everything downstream — the <img>, the JSON-LD, the favicon link — goes
     * on reading one field and does not learn that two kinds of build
     * exist. */
    if (reuse && !uploadedImages.global.logo) {
      const stored = reuse.global || {};

      if (stored.logo) uploadedImages.global.logo = String(stored.logo);
      if (stored.favicon) uploadedImages.global.favicon = String(stored.favicon);
    }

    if (!uploadedImages.global.logo) {
      /* A THIRD FAILURE, AND IT NEEDS ITS OWN SENTENCE TOO. Neither message
       * below fits a re-render: there was no upload to outrun and no file to
       * try again. This one means the stored site never recorded a logo, so
       * it cannot be rebuilt from what was kept. */
      if (reuse) {
        throw new Error(
          'This website was published without a logo recorded, so its words ' +
          'cannot be re-rendered. Generate the site again to repair it.'
        );
      }

      if (!files.length) {
        throw new Error(
          'This build started before its logo was attached. Nothing is wrong ' +
          'with the file — please press Generate again.'
        );
      }
      throw new Error('The logo could not be processed. Please try uploading it again.');
    }


    // Near Me Logic
    const rawUseNearMe = ctx.body.global?.useNearMe ?? ctx.body['global[useNearMe]'];


    const globalValues = {

      showAboutForm,
      showPricingTable,
      showBadges,
      showReviews,
      // Owner name is opt-in; when opted in, the name itself is optional and
      // the model invents one if left blank.
      //
      // 'rankfast' (Rank Fast), 'lead' (Rank GBPs — the full site as it has
      // always been built) or 'sample' (one-page design sample). Resolved
      // above by normalizeSiteMode, which is the ONLY place this string is
      // validated. Everything downstream — pageMeta, buildAltText, the image
      // prefixes, the FAQ schema — reads it from here via getPreset().
      siteMode,
      includeOwner: global.includeOwner,
      ownerName: (global.ownerName || '').trim(),
      wantsLocationPages,    // true/false
      locationPages: locations,
      hours: global.hours || {},
      styleKey: global.styleKey,
      is24Hours: global.is24Hours,    // ✅ store 24hr toggle (may be 'on' or undefined)
      // Which trust points this business has confirmed are true of it, as a
      // comma-separated list of claim ids. '-' means "none of them"; absent
      // means the field was never posted (a job replayed from before this
      // existed), which falls back to the shape's defaults — every historical
      // claim for home services, nothing for anyone else.
      // See utils/businessShape.js.
      trustClaims: global.trustClaims ?? ctx.body['global[trustClaims]'],
      phone: global.phone?.trim(),
      domain: global.domain?.trim(),
      useNearMe: String(rawUseNearMe),
      logo: uploadedImages.global.logo || '',
      businessType: global.businessType?.trim(),
      email: normalizeText(global.email?.trim()),
      twitterUrl: (global.twitterUrl || '').trim(),
      youtubeUrl: (global.youtubeUrl || '').trim(),
      favicon: uploadedImages.global.favicon || '',
      facebookUrl: (global.facebookUrl || '').trim(),
      linkedinUrl: (global.linkedinUrl || '').trim(),
      address: normalizeText(global.address?.trim()),
      pinterestUrl: (global.pinterestUrl || '').trim(),
      instagramUrl: (global.instagramUrl || '').trim(),
      googleMapCid: (global.googleMapCid || '').trim(),
      youtubeVideoUrl: (global.youtubeVideoUrl || '').trim(),
      businessName: normalizeText(global.businessName?.trim()),
      location: formatCityState(smartTitleCase(normalizeText(global.location?.trim()))),
    };


    // read the posted value (fallback = rectangular)
    globalValues.logoType = String(global.logoType || 'rect').toLowerCase();

    // Rendered logo dimensions, by shape.
    // These are the width/height attributes written into every template, so
    // they reserve the right space and prevent layout shift.
    const LOGO_SIZES = {
      square: { width: 120, height: 120 },  // 1:1
      rect:   { width: 150, height: 100 },  // 3:2
      wide:   { width: 250, height: 100 },  // 5:2 — long horizontal logos
    };

    const logoSize = LOGO_SIZES[globalValues.logoType] || LOGO_SIZES.rect;
    globalValues.logoWidth  = logoSize.width;
    globalValues.logoHeight = logoSize.height;


    // The domain has to survive siteBaseUrl(), not merely be non-empty.
    //
    // siteBaseUrl() returns '' for anything that does not normalise to a
    // hostname — "qualityplumberleander" with no TLD, a pasted path, a typo.
    // Everything downstream then fails SOFT and SEPARATELY:
    //
    //   canonicalTag()   returns '' -> every page ships with no canonical,
    //                    which is exactly the state Search Console reports as
    //                    "Duplicate without user-selected canonical"
    //   buildSitemap()   skips itself
    //   buildHtaccess()  warns to the console and writes nothing
    //
    // Three warnings in a build log nobody reads, a generation that reports
    // success, and a site with no canonical tags anywhere. Better to refuse:
    // the customer has spent credits either way, and a site they have to
    // rebuild is worse than a form they have to correct.
    //
    // Throws rather than returning a validation response for the same reason
    // the logo check above does — there is no `res` in a background job. The
    // runner catches this, marks the job failed and shows the message.
    if (!siteBaseUrl(globalValues.domain)) {
      throw new Error(
        `"${globalValues.domain || ''}" is not a usable domain. ` +
        'Enter it as example.com or www.example.com — no https://, no path, ' +
        'and it must include a dot. Without one the site cannot have canonical ' +
        'tags, a sitemap, or the redirects that keep its address consistent.'
      );
    }


    console.log(`🎨 Mode: ${siteMode}  |  Theme: ${globalValues.styleKey || '(none — will fall back to style.css)'}  |  Logo: ${globalValues.logoType} ${globalValues.logoWidth}x${globalValues.logoHeight}`);


    // Semantic model handed to the WordPress exporter (written at the end).
    // This is the same data used to render the HTML, kept in structured form
    // so the WP builder never has to regex-scrape the output back apart.
    const contentModel = CM.createModel(globalValues);


    // Build interlink map
    // AFTER you've validated pages & locations and built globalValues
    await report({ stage: 'Preparing images and links', current: '' });

    // Which interlink structure this site uses.
    //
    //   'classic'   every page links home plus the next two, contact links
    //               onward like any other node. Rank GBPs and One-Page Design.
    //   'rankfast'  contact closes the circle and links only home; the anchor
    //               used to link home changes with site size.
    //
    // Both builders tag every page object with its slug as a side effect —
    //
    //     pages.forEach(p => { p.slug = ... })
    //
    // — which is not about links at all. `interlinkMap[page.slug]` below reads
    // it, and so does anything else downstream that expects page.slug to
    // exist. Whichever builder runs, that has to happen.
    const { interlinkMap } = preset.links.ring === 'rankfast'
      ? await buildRankFastInterlinksMap(pagesArray, globalValues.locationPages, globalValues)
      : await buildInterlinksMap(pagesArray, globalValues.locationPages);

    const indexInterlinks = interlinkMap['index'] || [];

    const seen = new Set();
    const duplicates = [];

    indexInterlinks.forEach(slug => {
      if (seen.has(slug)) duplicates.push(slug);
      seen.add(slug);
    });

    if (duplicates.length) {
      console.warn('⚠️ Duplicate slugs in indexInterlinks:', duplicates);
    }



    // Google Maps
    globalValues.mapEmbed = await googleMap(globalValues.address);

    // Used to copy images inside the main loop
    const imageContext = "imageServicePages";


    // =========================================================
    // 4. MAIN LOOP — one HTML page per submitted service page
    // =========================================================
    for (const [index, page] of Object.entries(isSample ? {} : pages)) {

      // Resume: this page was written before the job was interrupted.
      if (alreadyDone.has(page.keyword)) {
        continue;
      }

      await report({ stage: 'Writing service pages', current: page.keyword, done: pagesDone });
      const filename = slugify(page.filename);
      const templatePath = path.join(__dirname, '../src/template.html');
      let template = fs.readFileSync(templatePath, 'utf-8');
      const locationSlug = slugify(global.location || '');


      // Copy predefined images into dist/assets and track them.
      //
      // The service-page filename prefix does NOT vary by mode, in any mode.
      // Each service page copies from a different source folder into the same
      // field names, so the prefix is the only thing stopping the last page
      // built from overwriting every earlier page's images.
      copyAllPredefinedImages({
        distDir,
        globalValues,
        uploadedImages,
        keyword: slugify(page.filename || ''),
        index: Number(index), // pass the index so we can cycle with % 10
        imageContext
      });


      // Build Alt descriptions in object format
      const altTexts = buildAltText(globalValues, Number(index), filename);

      // One definition of this page's alt/title text, used by the template
      // replacements AND by the WordPress model at the bottom of this loop.
      //
      //   Rank GBPs   a male plumber fixing a water heater in Leander, TX - Water Heater Repair
      //   Rank Fast   a male plumber fixing a water heater
      //
      // Built here rather than inline at each replacement so the two passes
      // cannot disagree — that is how the exported theme and the downloaded
      // site drifted apart the last three times.
      const alt = (base) => imageAlt(globalValues, base, { pageName: page.filename });


      page.filename = normalizeText(page.filename);
      page.keyword = page.filename;

      const heroAlt      = alt(altTexts['hero-mobile']);
      const section2Alt1 = alt(altTexts['section2-1']);
      const section2Alt2 = alt(altTexts['section2-2']);
      const section4Alt1 = alt(altTexts['section4-1']);
      const section4Alt2 = alt(altTexts['section4-2']);


      // ===  Services Nav Menu Creation =====
      const context = "services";
      template = buildNavMenu(template, globalValues, pages, basePath, slugify(globalValues.location), page.filename, context);


      // Meta title and description.
      //
      // These used to be an OpenAI call per service page — two on a 10-page
      // site's worth of tokens, and unpredictable output. The format is fixed
      // now, so the call is gone: one less API request per page, and no
      // chance of the model returning something malformed.
      //
      // The service-page format is the same in every mode; only the index
      // page differs. See utils/pageMeta.js.
      const meta = serviceMeta(page.filename || page.keyword, globalValues);



      // Building Schema
      const coordinates = await getCoordinatesFromAddress(globalValues.address);
      const reviews     = await generateReview(globalValues.businessName);
      const jsonLdString = buildSchema(globalValues, uploadedImages, index, coordinates, reviews);
      globalValues['jsonLdString'] = jsonLdString;



      //  Insert Interlinks to Pages Content
      const pagesInterlinks = interlinkMap[page.slug] || [];

      // The content prompt reads this list POSITIONALLY — keywords[1],
      // keywords[2] — and drops each into "include this exact lowercase
      // phrase". The Rank Fast ring carries objects, so it has to be flattened
      // to slugs first or the prompt asks the model for "[object Object]".
      // The injector below still gets the full entries; only the prompt needs
      // the plain form.
      const contentKeywords = interlinkSlugs(pagesInterlinks);


      // Generate Page Sections Content
      // Number(index) decides this page's section topics and heading style.
      // Every service page used to get the same four briefs in the same order,
      // which is how two related services came back near-identical.
      //
      /* UNLESS THIS SITE ALREADY HAS ITS WORDS. reuse.pageContent() returns
       * null for a page the stored model does not hold — a service added
       * since the last build, most obviously — so a part-matching model
       * generates the new pages and reuses the rest. */
      const storedContent = reuse ? reuse.pageContent(page.slug) : null;

      const sections = storedContent
        || await generatePagesContent(globalValues, page, contentKeywords, Number(index));

      // Skip this service page rather than failing the whole generation.
      // The same guard the location pages needed: unparseable model output
      // used to throw here and take every page with it, including ones that
      // had already been written.
      if (!sections || !sections.section1 || !Array.isArray(sections.section1.paragraphs)) {
        console.warn(`   ⚠️ Skipping service page "${page.keyword}": content could not be generated`);
        log.external('openai', 'servicePageContentFailed', {
          requestId: ctx.requestId,
          keyword: page.keyword,
        });
        continue;
      }

      // Called in EVERY mode, including the ones with no interlinks.
      //
      // Injecting links is not all this does. Its first act on every
      // paragraph is stripMarkdownLinks(), which turns the [text](url) the
      // content generator sometimes emits back into plain text. Handed an
      // empty target list it strips that markdown and injects nothing —
      // precisely what Rank Fast wants. Skip the call instead and raw
      // [water heater repair](…) shows up verbatim in the page copy.
      //
      // Verified against the empty list: MAX_BACKLINKS becomes 0, the guard
      // on the first line returns the stripped paragraph, and the injection
      // loop never runs.
      /* NOT ON A REUSED PAGE, AND THIS IS THE ONE PLACE REUSE CHANGES THE
       * RULE RATHER THAN SKIPPING A COST.
       *
       * The paragraphs in content.json are POST-injection: the model is built
       * from `sectionsWithLinks`, so the <a href> tags are already in the
       * stored text. Running the injector over them again would find the
       * phrases it is meant to link already inside anchors and nest them.
       *
       * Its other job is already done too. stripMarkdownLinks() ran on the
       * way in, which is why the note above says this is called in every mode
       * including the ones with no interlinks — stored text has no [text](url)
       * left for it to strip. */
      const sectionsWithLinks = storedContent
        ? sections
        : injectPagesInterlinks(
                                        globalValues,
                                        pagesArray,
                                        page,
                                        pagesInterlinks,
                                        sections,
                                        globalValues.location
                                      );


      template = template
        // Self-referencing canonical. `${filename}-${locationSlug}.html` is
        // the same name htmlName builds below and the same one the sitemap
        // picks up off disk, so all three agree on this page's address.
        .replace(/{{CANONICAL}}/g, () => (canonicalTag(globalValues, `${filename}-${locationSlug}.html`)))
        .replace(/{{JSON_LD_SCHEMA}}/g, () => (jsonLdString))
        .replace(/{{FAVICON_PATH}}/g, () => (globalValues.favicon))
        .replace(/{{LOGO_PATH}}/g, () => (globalValues.logo))
        .replace(/{{LOGO_ALT}}/g, () => (`Logo image of ${globalValues.businessName} in ${globalValues.location} - ${page.filename}`))
        .replace(/{{LOGO_TITLE}}/g, () => (`Logo image of ${globalValues.businessName} in ${globalValues.location} - ${page.filename}`))
        .replace(/{{LOGO_WIDTH}}/g, () => (String(globalValues.logoWidth)))
        .replace(/{{LOGO_HEIGHT}}/g, () => (String(globalValues.logoHeight)))
        // From utils/pageMeta.js. The `meta` computed above was previously
        // never used here — the title was built inline instead, so the
        // OpenAI call that produced it was paid for and discarded.
        .replace(/{{PAGE_TITLE}}/g, () => (meta.title))
        .replace(/{{META_DESCRIPTION}}/g, () => (meta.description))
        .replace(/{{PAGE_NAME}}/g, () => (page.filename.toUpperCase()))
        .replace(/{{BUSINESS_NAME}}/g, () => (globalValues.businessName.toUpperCase()))
        .replace(/{{HERO_IMG_MOBILE}}/g, () => (uploadedImages[index]?.heroMobile || ''))
        .replace(/{{HERO_IMG_TABLET}}/g, () => (uploadedImages[index]?.heroTablet || ''))
        .replace(/{{HERO_IMG_DESKTOP}}/g, () => (uploadedImages[index]?.heroDesktop || ''))
        .replace(/{{HERO_IMG_LARGE}}/g, () => (uploadedImages[index]?.heroLarge || ''))
        .replace(/{{HERO_IMG_ALT}}/g, () => (heroAlt))
        .replace(/{{HERO_IMG_TITLE}}/g, () => (heroAlt))
        .replace(/{{SECTION2_IMG1}}/g, () => (uploadedImages[index]?.section2Img1 || ''))
        .replace(/{{SECTION2_IMG2}}/g, () => (uploadedImages[index]?.section2Img2 || ''))
        .replace(/{{SECTION2_IMG_ALT1}}/g, () => (section2Alt1))
        .replace(/{{SECTION2_IMG_TITLE1}}/g, () => (section2Alt1))
        .replace(/{{SECTION2_IMG_ALT2}}/g, () => (section2Alt2))
        .replace(/{{SECTION2_IMG_TITLE2}}/g, () => (section2Alt2))
        .replace(/{{SECTION4_IMG1}}/g, () => (uploadedImages[index]?.section4Img1 || ''))
        .replace(/{{SECTION4_IMG2}}/g, () => (uploadedImages[index]?.section4Img2 || ''))
        .replace(/{{SECTION4_IMG_ALT1}}/g, () => (section4Alt1))
        .replace(/{{SECTION4_IMG_TITLE1}}/g, () => (section4Alt1))
        .replace(/{{SECTION4_IMG_ALT2}}/g, () => (section4Alt2))
        .replace(/{{SECTION4_IMG_TITLE2}}/g, () => (section4Alt2))
        .replace(/{{MAP_IFRAME_SRC}}/g, () => (globalValues.mapEmbed || ''))
        .replace(/{{MAP_IFRAME_TITLE}}/g, () => (escapeAttr(`Google map of ${globalValues.businessName} — ${globalValues.address || globalValues.location}`)))
        .replace(/{{SECTION1_H2}}/g, () => (sectionsWithLinks.section1.heading.toUpperCase()))
        .replace(/{{SECTION1_H3}}/g, () => (sectionsWithLinks.section1.subheading))
        .replace(/{{SECTION1_P1}}/g, () => (sectionsWithLinks.section1.paragraphs[0]))
        .replace(/{{SECTION1_P2}}/g, () => (sectionsWithLinks.section1.paragraphs[1]))
        .replace(/{{SECTION2_H2}}/g, () => (sectionsWithLinks.section2.heading.toUpperCase()))
        .replace(/{{SECTION2_P1}}/g, () => (sectionsWithLinks.section2.paragraphs[0]))
        .replace(/{{SECTION2_P2}}/g, () => (sectionsWithLinks.section2.paragraphs[1]))
        .replace(/{{SECTION3_H2}}/g, () => (sectionsWithLinks.section3.heading.toUpperCase()))
        .replace(/{{SECTION3_P1}}/g, () => (sectionsWithLinks.section3.paragraphs[0]))
        .replace(/{{SECTION3_P2}}/g, () => (sectionsWithLinks.section3.paragraphs[1]))
        .replace(/{{SECTION4_H2}}/g, () => (sectionsWithLinks.section4.heading.toUpperCase()))
        .replace(/{{SECTION4_P1}}/g, () => (sectionsWithLinks.section4.paragraphs[0]))
        .replace(/{{SECTION4_P2}}/g, () => (sectionsWithLinks.section4.paragraphs[1]))
        .replace(/{{LOCATION_AREA}}/g, () => (globalValues.location))
        .replace(/{{ADDRESS}}/g, () => (globalValues.address))

        /* The hero NAP bar's address, with the city and state added when the
           Address box did not already have them. {{ADDRESS}} above is left
           exactly as it was — the footer, the contact block and the map all
           still get what the owner typed. */
        .replace(/{{ADDRESS_FULL}}/g, () => (fullAddress(globalValues.address, globalValues.location)))
        .replace(/{{EMAIL}}/g, () => (globalValues.email))
        .replace(/{{HOURS_TIME}}/g, () => (getHoursTimeText(globalValues.is24Hours, globalValues.hours)))
        .replace(/{{PHONE_RAW}}/g, () => (formatPhoneForHref(globalValues.phone)))
        .replace(/{{PHONE_DISPLAY}}/g, () => (globalValues.phone))
        .replace(/{{CURRENT_YEAR}}/g, () => (new Date().getFullYear()))
        .replace(/{{SOCIAL_LINKS}}/g, () => (buildSocialLinks(globalValues)));

      // === Remove the email line + <hr> when email is empty ===
      const emailVal = (globalValues.email || '').trim();
      if (!emailVal) {
        // Remove: <p> {{EMAIL or undefined or empty}} </p> + optional <hr...>
        template = template.replace(
            /<p[^>]*>\s*(?:{{EMAIL}}|undefined|&nbsp;|\s)*<\/p>\s*(?:<hr[^>]*>\s*)?/gi,
            ''
        );
      }


      // Add bootstrap.min.css link to template
      template = template.replace('</head>', `
        <link rel="stylesheet" href="./css/bootstrap.min.css">
        <link rel="stylesheet" href="./css/${filename}.css">
      </head>`);


      // Add bootstrap.bundle.min.js link to template
      template = template.replace('</body>', `
        <script src="./js/bootstrap.bundle.min.js"></script>
      </body>`);



      // Create file.html from template
      const htmlName = `${filename}-${locationSlug}`;
      // Drop the unused hero block (see utils/stripUnusedHero.js)
      template = fillLegalLinks(template, globalValues);
      template = stripUnusedHero(template, globalValues.styleKey);

      fs.writeFileSync(path.join(distDir, `${htmlName}.html`), template);
      pagesDone += 1;
      await report({
        done: pagesDone,
        current: page.keyword,
        completedPage: page.keyword,   // recorded so a resume skips it
      });


      // === Stylesheet + Webpack entry stub, both inside this user's folder.
      // entryName must match the HTML filename; cssName matches the <link> above.
      writePageAssets({
        distDir,
        cssDir,
        entryName: htmlName,
        cssName: filename,
        styleKey: globalValues.styleKey
      });


      // === Record this page in the semantic model ===
      //
      // SECOND PASS. Every alt string below is one of the consts resolved
      // above, not a fresh interpolation — the two passes must not be able to
      // produce different text for the same image.
      CM.addPage(contentModel, {
        type: CM.PAGE_TYPES.SERVICE,
        htmlFile: `${htmlName}.html`,
        slug: htmlName,
        cssName: filename,
        title: smartTitleCase(page.filename),
        keyword: page.keyword,
        isFrontPage: false,
        menuOrder: Number(index) + 1,
        meta: {
          // The same `meta` the template above uses — hardcoding it here
          // separately is how the WordPress export drifted from the static
          // site in the first place.
          title: meta.title,
          description: meta.description,
        },
        schema: jsonLdString || '',
        sections: [
          CM.heroSection({
            h1: page.filename.toUpperCase(),
            tagline: globalValues.location,
            imageList: CM.heroImages(uploadedImages[index] || {}, heroAlt, heroAlt),
          }),
          CM.section({
            key: 'section1', label: 'Section 1',
            type: CM.SECTION_TYPES.TEXT,
            source: sectionsWithLinks.section1 || {},
          }),
          CM.section({
            key: 'section2', label: 'Section 2',
            type: CM.SECTION_TYPES.TEXT_IMAGES,
            source: sectionsWithLinks.section2 || {},
            imageList: [
              CM.image({ role:'section2-img1', src:uploadedImages[index]?.section2Img1,
                         alt:section2Alt1, width:600, height:400 }),
              CM.image({ role:'section2-img2', src:uploadedImages[index]?.section2Img2,
                         alt:section2Alt2, width:600, height:400 }),
            ],
          }),
          CM.section({
            key: 'section3', label: 'Section 3',
            type: CM.SECTION_TYPES.TEXT,
            source: sectionsWithLinks.section3 || {},
          }),
          CM.section({
            key: 'section4', label: 'Section 4',
            type: CM.SECTION_TYPES.TEXT_IMAGES,
            source: sectionsWithLinks.section4 || {},
            imageList: [
              CM.image({ role:'section4-img1', src:uploadedImages[index]?.section4Img1,
                         alt:section4Alt1, width:600, height:400 }),
              CM.image({ role:'section4-img2', src:uploadedImages[index]?.section4Img2,
                         alt:section4Alt2, width:600, height:400 }),
            ],
          }),
          {
            key: 'napMap', label: 'Contact Details & Map',
            type: CM.SECTION_TYPES.NAP_MAP,
            heading: '', paragraphs: [], images: [],
            mapEmbed: globalValues.mapEmbed || '',
          },
        ],
        // Slugs, matching what the classic ring stores — the exporter reads
        // this as a list of page names, not link definitions.
        interlinks: contentKeywords,
      });
    }



    // === FAQ from Google's "People Also Ask" ===
    //
    // HOME PAGE ONLY, and that is now a deliberate limit rather than an
    // unfinished feature. Location pages briefly used PAA too, one query per
    // town, and it produced the same state-level question on every page —
    // Google has no PAA data at the level of a small town. They now generate
    // their own questions from each page's angle; see generateLocationFaq.js.
    //
    // On the home page the problem does not arise: one query, one place, and
    // the questions are real search demand, which is worth the two credits.
    //
    // Two ValueSERP queries are merged to reach six questions, cached for 30
    // days so regenerating costs nothing. Any failure here leaves faqs empty
    // and the page builds without the section.
    //
    // Fetched in Rank Fast too: that mode drops the FAQPage JSON-LD, not the
    // visible questions on the page.
    /* THE STORED ANSWERS SKIP BOTH CALLS, NOT ONE.
     *
     * The questions come from a People Also Ask lookup and the answers from
     * the model, so a reused FAQ has to short-circuit the fetch as well —
     * otherwise the cheaper half of this still costs a third-party request
     * on every edit, to produce questions that are then thrown away. */
    const storedFaqs = reuse ? reuse.faqs() : null;

    console.log(
      storedFaqs ? '❓ Reusing the stored FAQ'
        : isSample ? '❓ Skipping FAQ (design sample)'
        : '❓ Fetching People Also Ask questions...'
    );

    const paaQuestions = (storedFaqs || isSample) ? [] : await fetchPeopleAlsoAsk({
      keyword: globalValues.useNearMe === 'true'
        ? `${globalValues.businessType} near me`
        : globalValues.businessType,
      businessType: globalValues.businessType,
      location: globalValues.location,
    });

    const faqs = storedFaqs || (paaQuestions.length
      ? await generateFaqAnswers({
          questions: paaQuestions,
          businessName: globalValues.businessName,
          businessType: globalValues.businessType,
          location: globalValues.location,
        })
      : []);


    // Every FAQ question used anywhere on this site, keyed on a normalised
    // form so case and punctuation cannot smuggle a repeat through.
    //
    //     Map<normalisedKey, questionText>
    //
    // Seeded with the home page's questions BEFORE any location page is built,
    // then handed to buildLocationPages, which mutates it town by town. This
    // is the hard guarantee behind "no question appears on two pages" — the
    // model is also told what to avoid, but that is a courtesy and this is the
    // enforcement.
    const usedFaqQuestions = addUsedQuestions(new Map(), faqs);


    // Six service cards for the home page. These sit under the existing
    // Services paragraphs rather than replacing them.
    const storedCards = reuse ? reuse.serviceCards() : null;

    console.log(storedCards ? '🧩 Reusing the stored service cards' : '🧩 Generating service cards...');

    const serviceCards = storedCards || await generateServiceCards({
      businessType: globalValues.businessType,
      businessName: globalValues.businessName,
      location: globalValues.location,
    });


    /* Typical price ranges. Framed as estimates for the area, not as the
     * business's own price list — the figures are generated, not supplied.
     *
     * THREE REASONS TO SKIP, and they are not the same reason:
     *
     *   isSample            the one-page design sample has no About page to
     *                       put a table on.
     *   !showPricingTable   the customer unticked the box on the form.
     *   !caps.pricingTable  the shape is not allowed one — medical and legal.
     *                       Checked HERE as well as at render time, because
     *                       this is the call that costs money and a table
     *                       that will never be rendered should never be
     *                       generated. buildAboutUsPage checks it again; the
     *                       duplication is deliberate, since the render gate
     *                       is the one that must not be bypassable.
     *
     * Skipping does not change the price of the build. utils/pricing.js
     * charges a flat base plus per-page; the About page sections are not
     * itemised, so turning this off saves an API call and nothing else. */
    const pricingAllowed = capabilities(globalValues.businessType).pricingTable;
    const wantPricing = !isSample && showPricingTable && pricingAllowed;

    console.log(
      wantPricing ? '💲 Generating pricing table...'
        : isSample ? '💲 Skipping pricing (design sample)'
        : !pricingAllowed ? `💲 Skipping pricing (${globalValues.businessType} cannot have a price table)`
        : '💲 Skipping pricing (turned off on the form)'
    );

    /* THE THREE GATES ABOVE STILL DECIDE, AND REUSE DOES NOT OVERRIDE THEM.
     *
     * `wantPricing` is the answer to "should this site have a price table" —
     * the mode, the checkbox and the business shape. A stored table from a
     * build made before the customer unticked the box, or before the shape
     * was corrected, must not come back: untick it, re-render, and the table
     * has to go. So the stored rows are consulted INSIDE the gate, never
     * instead of it. */
    const storedPricing = (wantPricing && reuse) ? reuse.pricing() : null;

    const pricing = wantPricing
      ? (storedPricing || await generatePricing({
          businessType: globalValues.businessType,
          location: globalValues.location,
        }))
      : [];


    // A short case study for the home page, above the FAQ.
    //
    // Describes a REPRESENTATIVE job rather than a particular one — no client
    // name, no address, no date, no figures. A case study is a claim about
    // work that was done, and left to itself the model invents the customer
    // along with it. See utils/generateCaseStudy.js.
    //
    // Returns null for medical and legal practices, where a case study is a
    // past-results claim.
    /* INSIDE THE isSample GATE, for the same reason pricing is inside its
     * own: a case study is a claim about work done, and a design sample does
     * not get to make one just because an earlier build did. */
    const storedCaseStudy = (!isSample && reuse) ? reuse.caseStudy() : null;

    console.log(
      storedCaseStudy ? '📄 Reusing the stored case study'
        : isSample ? '📄 Skipping case study (design sample)'
        : '📄 Generating case study...'
    );

    const caseStudy = isSample ? null : (storedCaseStudy || await generateCaseStudy({
      businessType: globalValues.businessType,
      businessName: globalValues.businessName,
      location: globalValues.location,
    }));


    // Four EXAMPLE reviews for the home page, below the case study.
    //
    // RUNS ON SAMPLE BUILDS TOO, unlike the pricing table and the case study
    // above. Those are skipped for a design sample because they are claims —
    // a price the business has not set, a job it has not done. These are the
    // opposite: the section EXISTS to be looked at, and a design sample with
    // the reviews section missing fails to show the one thing it was built to
    // show.
    //
    // THAT IS A DEFAULT, NOT A REFUSAL, and the distinction arrived with the
    // checkbox on 3 November. isSample still does not skip this section —
    // only an unticked box does, in every mode including sample. "We think
    // you want this" and "you may not decline this" are not the same
    // sentence, and for eight months this code said the second one.
    //
    // THE SKIP IS BEFORE THE MODEL CALL, not around the render. Unticking the
    // box has to stop the spend, which is the only reason the gate is up here
    // rather than in buildAboutUsPage — see showReviews above for why there
    // is no second gate down there.
    //
    // None of it reaches the JSON-LD. See utils/generateSampleReviews.js.
    //
    // A PARAGRAPH WAS REMOVED HERE ON 7 NOVEMBER, and what it said is worth
    // recording because it was not true. It read:
    //
    //     Every review opens with "This is an example review, not a real
    //     customer review." That sentence is added in code rather than asked
    //     of the model, so it cannot be dropped, reworded, or lost to a retry.
    //
    // Nothing in the codebase adds that sentence. generateSampleReviews.js
    // has no such prefix, buildReviewsSection() renders r.text as it is, and
    // SECTION_NOTE — the line above the cards that said the same thing — is
    // now the empty string.
    //
    //     A COMMENT DESCRIBING A SAFEGUARD THAT IS NOT IN THE CODE
    //     IS WORSE THAN NO COMMENT. It stops the next reader looking.
    //
    // Found while wiring the re-render path, because the stored reviews had
    // to be checked field by field. The behaviour is deliberate and unchanged
    // — Edwin, 7 November: "leave the reviews section alone" — so only the
    // claim went.
    /* INSIDE showReviews, like the two gates above it. The comment above is
     * explicit that unticking the box has to stop the spend; it also has to
     * stop the SECTION, and a stored copy returned past the gate would put
     * back the thing the customer just turned off. */
    const storedReviews = (showReviews && reuse) ? reuse.sampleReviews() : null;

    console.log(
      storedReviews ? '⭐ Reusing the stored example reviews'
        : showReviews ? '⭐ Generating example reviews...'
        : '⭐ Skipping example reviews (unticked)'
    );

    const reviews = showReviews
      ? (storedReviews || await generateSampleReviews({
          businessType: globalValues.businessType,
          businessName: globalValues.businessName,
          location: globalValues.location,
        }))
      : null;


    // Create about-us.html, & save in dist
    await report({ stage: 'Writing the home page', current: 'About Us', done: pagesDone });

    const aboutPage = await buildAboutUsPage(
            distDir,
            cssDir,
            globalValues,
            globalValues.jsonLdString,
            indexInterlinks,
            pagesArray,   // array form: the interlink injectors call .find on it
            faqs,
            serviceCards,
            pricing,
            caseStudy,
            reviews,

            /* The About page's OWN copy comes from in there, so the resolver
             * has to go in with it. The five blocks above were already
             * resolved from the model up here. */
            { reuse }
    );




    // Create privacy-policy.html, & save in dist
    const privacyPage = isSample ? null : buildPrivacyPolicyPage(
            distDir,
            cssDir,
            globalValues,
            pages
    );



    // Create terms-of-use.html, & save in dist
    const termsPage = isSample ? null : buildTermsOfUsePage(
            distDir,
            cssDir,
            globalValues,
            pages
    );



    // Create accessibility.html, & save in dist
    const accessibilityPage = isSample ? null : buildAccessibilityPage(
            distDir,
            cssDir,
            globalValues,
            pages
    );



    // The home page counts toward the total, so the bar moves rather than
    // sitting at 33% until everything finishes.
    pagesDone += 1;
    await report({ done: pagesDone, current: 'About Us', completedPage: 'index' });


    // Create contact.html — hero, AI intro, the same form the home page
    // uses, then the shared NAP/map block.
    // The Contact link points back to the sample, so no contact page.
    const contactPage = isSample ? null : await buildContactPage(
            distDir,
            cssDir,
            globalValues,
            pagesArray,   // array form: the interlink injectors call .find on it
            // Respect the wizard checkbox. This was passing the form
            // unconditionally, so unticking "Include contact form" hid it on
            // the home page but not here — the setting appeared to do
            // nothing on the page most likely to have a form.
            showAboutForm ? buildContactFormHtml(globalValues) : '',
            // Contact's targets from the ring, so its copy interlinks the
            // same way every other page does.
            interlinkMap['contact'] || [],

            // The contact intro is generated in there, so the resolver goes too.
            { reuse }
    );


    /* CONTACT AND THE THREE LEGAL PAGES COUNT TOWARD THE TOTAL.
     *
     * pagesToBuild() adds FIXED_PAGES to the denominator, so all four have
     * to be counted here. Miss them and the bar stops four pages short of
     * 100% on every build — a failure that is invisible until the end of a
     * twenty-minute run, and that nothing else would report.
     *
     * ONE REPORT RATHER THAN FOUR. The three legal pages are template fills
     * that finish in milliseconds, and contact is a single model call, so
     * all four land within a second or two of each other. Splitting them
     * would mean splitting FIXED_PAGES.length into a 3 and a 1 — two magic
     * numbers that have to add back up to a list defined in another file.
     *
     * COUNTED WITHOUT LOOKING AT THE RETURN VALUES, deliberately. Each
     * builder returns undefined when its file already exists, which is the
     * normal case for a RESUMED build picking up a dist folder that already
     * has privacy-policy.html in it. Counting only what was freshly written
     * would leave every resumed build permanently short.
     *
     * Not for a sample: it writes one page and no contact or legal pages,
     * and pagesToBuild returns 1 for it. */
    if (!isSample) {
      pagesDone += FIXED_PAGES.length;
      await report({ done: pagesDone, current: 'Contact and legal pages' });
    }


    // Create location pages
    await report({ stage: 'Writing location pages', current: '', done: pagesDone });

    const locationModelPages = isSample ? [] : await buildLocationPages(
            distDir,
            cssDir,
            globalValues,
            pages,           // ⬅️ pass pages so Services dropdown can be built
            uploadedImages,
            interlinkMap,
            usedFaqQuestions, // ⬅️ mutated per town; no question repeats a page

            /* THE BAR MOVES THROUGH THE LONGEST PHASE OF THE BUILD.
             *
             * This used to be two reports — one above, one after the batch
             * returned — with twenty minutes and up to forty towns in
             * between. Edwin had fifty-seven files on disk and a bar reading
             * 40%, and asked whether it was stuck.
             *
             * The town's name goes in `current` so the line underneath says
             * which one, the way the service-page loop does.
             *
             * `pagesDone` is incremented HERE and nowhere else for
             * locations — the `+= builtLocations.length` that used to follow
             * this call is gone. Leaving both would have counted every town
             * twice and taken the bar past 100%. */
            async function (written) {
              pagesDone += 1;
              await report({
                stage: 'Writing location pages',
                current: written.display,
                done: pagesDone,
              });
            },

            /* Towns generate their own copy and their own FAQ in there, so
             * the resolver goes with them. It answers per town, which is
             * what lets a site that has gained one reuse the rest. */
            { reuse }
    );




    // === sitemap.xml + robots.txt ===
    // Written after every page exists, so the URL list is derived from what
    // was actually generated rather than from what we intended to generate.
    if (!isSample) {
      await report({ stage: 'Finishing up', current: 'sitemap.xml', done: pagesDone });
      buildSitemap(distDir, globalValues);

      // Written alongside the sitemap on purpose: both declare the site's one
      // true address, and both read it from siteBaseUrl()/normalizeDomain().
      // Keeping them together is what stops the redirect and the canonical
      // ever pointing at different hostnames.
      buildHtaccess(distDir, globalValues);
    }


    // === Assemble and persist the semantic model ===
    // Order matters: front page first, then services, then locations, then legal.
    contentModel.pages.unshift(...(aboutPage ? [aboutPage] : []));
    // `|| []` because buildLocationPages returns undefined when there are no
    // locations to build — reading .length on that threw and killed the job
    // right at the end, after every page had already been written.
    const builtLocations = locationModelPages || [];

    /* NOTHING IS ADDED TO `pagesDone` HERE ANY MORE.
     *
     * There used to be a line here that added the whole batch to the counter
     * in one go — which is why the bar stood still for twenty minutes and
     * then jumped. The callback passed to buildLocationPages above now
     * counts each town as it lands, and the two together would count every
     * town twice.
     *
     * (The old statement is not quoted, deliberately. A source check that
     * forbids it would match the quotation and refuse a deploy on correct
     * code — which this project has already had happen twice.)
     *
     * The report stays: it is the one that clears `current` so the stage
     * line stops naming a town that has finished. */
    await report({ done: pagesDone, stage: 'Location pages written', current: '' });

    CM.addPages(contentModel, builtLocations);
    if (contactPage) CM.addPage(contentModel, contactPage);
    // The legal builders return their content. Fall back to a bare record if
    // one of them skipped work because the file already existed.
    CM.addPages(contentModel, [
      // A sample has no legal pages at all, so the usual fallback record
      // must not run — it would put pages in the model that were never
      // written to disk.
      ...(isSample ? [] : [
        privacyPage       || CM.legalPage({ slug: 'privacy-policy', title: 'Privacy Policy', menuOrder: 9998 }),
        termsPage         || CM.legalPage({ slug: 'terms-of-use',   title: 'Terms of Use',   menuOrder: 9999 }),
        accessibilityPage || CM.legalPage({ slug: 'accessibility',  title: 'Accessibility',  menuOrder: 10000 }),
      ]),
    ]);

    // The mode and its structured-data flag are stamped by CM.createModel()
    // into model.global, which is where the WordPress exporter already looks
    // for siteMode. Setting a second copy at the top level here would give
    // the exporter two fields that could disagree.

    CM.writeModel(distDir, contentModel);

    /* AND WHAT THE WIZARD WAS ASKED FOR, beside what it produced.
     *
     * content.json is the site's words. It cannot rebuild the site on its
     * own, because the checkboxes are decisions and the model records
     * outcomes — a site whose owner unticked the price table looks exactly
     * like a trade that is not allowed one. See utils/buildRecipe.js.
     *
     * Written inside _src/, which siteFiles.js refuses to publish, so the
     * owner's email address does not end up at a guessable URL on their own
     * domain. */
    writeRecipe(distDir, ctx.body);

    // STRUCTURE PARITY.
    //
    // The static pages and content.json are two independent passes over the
    // same data, and every time they have drifted the symptom has been the
    // same: the exported WordPress site lays out differently to the site the
    // customer downloaded. This compares them and says so in the log.
    //
    // It WARNS, it does not throw. The static site is already written and
    // already correct — it is the ground truth this checks against — so a
    // mismatch is a reason to look at the exporter, never a reason to fail a
    // build the customer has waited for and is about to be charged for.
    try {
      const { checkSite } = require('./checkStructureParity');
      const parity = checkSite(distDir);

      if (parity.skipped) {
        // no content.json — writeModel already logged why
      } else if (parity.ok) {
        console.log(parity.text);
      } else {
        console.warn(parity.text);
        log.generation('generation.structure_drift', {
          requestId: ctx.requestId,
          userId,
          differences: parity.problems.length,
          // The first few are enough to identify the section; the full report
          // is in the build log directly above this.
          sample: parity.problems.slice(0, 5).map(p => `${p.where}: ${p.what}`),
        });
      }
    } catch (err) {
      // A bug in the checker must never take down a successful generation.
      console.warn('⚠️ structure check could not run:', err.message);
    }


    // UNFILLED PLACEHOLDERS — AND THIS ONE THROWS.
    //
    // Deliberately unlike the structure check directly above, which warns.
    // The difference is what the customer ends up with. A parity drift means
    // two internal representations disagree while the page itself is still
    // right; an unfilled {{PLACEHOLDER}} means the PAGE is wrong, in public,
    // in the place a street address or a phone number was meant to be.
    //
    //     IT THROWS BEFORE chargeCredits(), WHICH IS THE POINT.
    //     A site with {{ADDRESS_FULL}} written across its hero is not a site
    //     anybody should be billed for.
    //
    // This happened on 4 November and nothing caught it: the build reported
    // success, every suite was green, and the placeholder was found by
    // somebody looking at the page. utils/checkPlaceholders.js records why
    // the scan is HTML and CSS only and why comments are stripped first —
    // both were decided by scanning a real build, not by reasoning about it.
    //
    // NOT WRAPPED IN try/catch, unlike its neighbour. A checker that cannot
    // run is a failed check, and the entire value of this one is that it
    // stops the build instead of logging something nobody reads.
    const placeholders = checkPlaceholders(distDir);

    if (placeholders.ok) {
      console.log(placeholders.text);
    } else {
      console.error(placeholders.text);

      const names = [...new Set(placeholders.problems.map(p => p.name))];

      log.generation('generation.unfilled_placeholders', {
        requestId: ctx.requestId,
        userId,
        siteMode,
        count: placeholders.problems.length,
        names,
        sample: placeholders.problems.slice(0, 5)
          .map(p => `${p.file}:${p.line} {{${p.name}}}`),
      });

      throw new Error(
        `The finished site still contains ${placeholders.problems.length} ` +
        `unfilled placeholder(s): ${names.map(n => `{{${n}}}`).join(', ')}. ` +
        `Nothing has been charged. If this server has been running since ` +
        `before those templates changed, restart it — templates are read from ` +
        `disk on every build, but the builders are require()d once at startup.`
      );
    }


    /* CHARGE ONLY NOW THAT THE BUILD HAS SUCCEEDED — AND NOT AT ALL FOR A
     * RE-RENDER.
     *
     * The words were paid for the first time. Re-rendering a site whose copy
     * came out of its own stored model is not new words, and utils/pricing.js
     * has no concept of a cheaper build — it charges a flat base plus per
     * page, which is the right shape for a generation and the wrong one for
     * an edit.
     *
     * `reuse`, NOT `ctx.reuse`. A model that was offered and refused —
     * unreadable, or a version this build does not understand — generated
     * everything from scratch, and that genuinely costs what a build costs.
     * Testing the raw input here would hand out free sites on a corrupt
     * file, which is the expensive direction to be wrong in.
     *
     * NOT FREE, THOUGH. generateReview still runs once per service page; it
     * is simply not something utils/pricing.js itemises. */
    let remaining = null;

    /* THE NUMBER REPORTED IS THE NUMBER TAKEN, computed once here and used
     * by both the log and the return value below. Written separately in the
     * two places, a re-render would have gone on announcing `credit.totalCost`
     * while charging nothing — a figure that is wrong in the customer's
     * favour and therefore the kind nobody reports. */
    const charged = reuse ? 0 : credit.totalCost;

    if (reuse) {
      console.log('💳 Not charged — rendered from this site\'s stored content');
    } else {
      remaining = await chargeCredits(ctx.user, charged);
      console.log(`💳 Charged ${charged} credit(s); ${remaining} remaining`);
    }

    // The counterpart to generation.started. Without it there is no record of
    // how long a build took or what it cost — which is exactly what you want
    // when a customer says "it was slow" or queries their credit balance.
    log.generation('generation.completed', {
      requestId: ctx.requestId,
      userId,
      siteMode,
      durationMs: Date.now() - startedAt,
      servicePages: Object.keys(pages || {}).length,
      locationPages: locationCount,
      creditsCharged: charged,
      /* null ON A RE-RENDER: nothing was taken, so nothing was counted back.
       * A number here would have to come from a second query, and a stale
       * one read as a balance is worse than an absent one. */
      creditsRemaining: remaining,
      reused: Boolean(reuse),
    });


    // Register this build so /export-wp can convert THIS exact output
    const buildId = createBuildRecord(distDir, {
      businessName: globalValues?.businessName || 'Site',
      location:     globalValues?.location || '',
    });



  return {
    creditsCharged: charged,
    creditsRemaining: remaining,
    /* SO THE CALLER CAN SAY WHICH HAPPENED. A screen that reports "0 credits"
     * after a re-render reads like a bug; one that says the site was rendered
     * from its stored content reads like the feature. */
    reused: Boolean(reuse),
    buildId,
    distDir,
  };
}

module.exports = { runGeneration };