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
const { generateServiceCards } = require('./buildServiceCards');
const { generatePricing } = require('./buildPricingTable');
const { buildSitemap } = require('./buildSitemap');
const { stripUnusedHero } = require('./stripUnusedHero');
const { log } = require('./logger');
const { generationLimiter } = require('./concurrencyLimiter');
const { fillLegalLinks } = require('./legalLinks');
const { buildContactPage } = require('./buildContactPage');
const { buildContactFormHtml } = require('./pageParts');
const CM = require('./contentModel');
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

  const userId = ctx.user._id.toString();
  const { distDir, assetsDir, cssDir, jsDir, entryDir } = getUserDirs(baseDistDir, userId);

  const isSample =
    (ctx.body.global?.siteMode ?? ctx.body['global[siteMode]']) === 'sample';

  const wantsLocationPages = truthy(global.addLocations);
  const { locations } = validateAndNormalizeLocationPages(global.locationPages, global.addLocations);

  const locationCount = (isSample || !wantsLocationPages)
    ? 0
    : (Array.isArray(locations) ? locations.length : 0);

  // Re-checked here rather than trusted from enqueue time: the balance may
  // have changed while the job sat in the queue.
  const credit = checkCredits(ctx.user, pages, {
    siteMode: isSample ? 'sample' : 'lead',
    locationPages: locationCount,
  });

  if (!credit.ok) {
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
      const ext = path.extname(file.originalname);

      const businessSlug = slugify(global.businessName);
      const locationSlug = slugify(global.location || '');
      const seoPrefix = `${businessSlug}-${locationSlug}`;


      if (globalMatch) {
        const field = globalMatch[1];
        const newFilename = `${seoPrefix}-${field}${ext}`;
        const destPath = path.join(assetsDir, newFilename);

        // If it's the logo, generate the favicon FROM THE TEMP FILE first
        if (field === 'logo') {
          const faviconFilename = `${seoPrefix}-favicon-42x42.png`;
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
    if (!uploadedImages.global.logo) {
      throw new Error('The logo could not be processed. Please try uploading it again.');
    }


    // Near Me Logic
    const rawUseNearMe = ctx.body.global?.useNearMe ?? ctx.body['global[useNearMe]'];


    const globalValues = {

      showAboutForm,
      // Owner name is opt-in; when opted in, the name itself is optional and
      // the model invents one if left blank.
      // 'lead' (full site) or 'sample' (one-page design sample). Anything
      // unrecognised falls back to a full build, so a malformed request can
      // never silently produce a stripped-down site.
      siteMode: global.siteMode === 'sample' ? 'sample' : 'lead',
      includeOwner: global.includeOwner,
      ownerName: (global.ownerName || '').trim(),
      wantsLocationPages,    // true/false
      locationPages: locations,
      hours: global.hours || {},
      styleKey: global.styleKey,
      is24Hours: global.is24Hours,    // ✅ store 24hr toggle (may be 'on' or undefined)
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


    console.log(`🎨 Theme: ${globalValues.styleKey || '(none — will fall back to style.css)'}  |  Logo: ${globalValues.logoType} ${globalValues.logoWidth}x${globalValues.logoHeight}`);


    // Semantic model handed to the WordPress exporter (written at the end).
    // This is the same data used to render the HTML, kept in structured form
    // so the WP builder never has to regex-scrape the output back apart.
    const contentModel = CM.createModel(globalValues);


    // Build interlink map
    // AFTER you've validated pages & locations and built globalValues
    await report({ stage: 'Preparing images and links', current: '' });

    const { interlinkMap } = await buildInterlinksMap(pagesArray, globalValues.locationPages);
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


      // Copy predefined images into dist/assets and track them
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


      page.filename = normalizeText(page.filename);
      page.keyword = page.filename;



      // ===  Services Nav Menu Creation =====
      const context = "services";
      template = buildNavMenu(template, globalValues, pages, basePath, slugify(globalValues.location), page.filename, context);


      // Meta Title
      const meta = await generateMetadata(globalValues.businessName, page.keyword, globalValues.location, formatCityState);



      // Building Schema
      const coordinates = await getCoordinatesFromAddress(globalValues.address);
      const reviews     = await generateReview(globalValues.businessName);
      const jsonLdString = buildSchema(globalValues, uploadedImages, index, coordinates, reviews);
      globalValues['jsonLdString'] = jsonLdString;



      //  Insert Interlinks to Pages Content
      const pagesInterlinks = interlinkMap[page.slug] || [];


      // Generate Page Sections Content
      const sections = await generatePagesContent(globalValues, page, pagesInterlinks);

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

      const sectionsWithLinks = injectPagesInterlinks(
                                        globalValues,
                                        pagesArray,
                                        page,
                                        pagesInterlinks,
                                        sections,
                                        globalValues.location
                                      );


      template = template
        .replace(/{{JSON_LD_SCHEMA}}/g, jsonLdString)
        .replace(/{{FAVICON_PATH}}/g, globalValues.favicon)
        .replace(/{{LOGO_PATH}}/g, globalValues.logo)
        .replace(/{{LOGO_ALT}}/g, `Logo image of ${globalValues.businessName} in ${globalValues.location} - ${page.filename}`)
        .replace(/{{LOGO_TITLE}}/g, `Logo image of ${globalValues.businessName} in ${globalValues.location} - ${page.filename}`)
        .replace(/{{LOGO_WIDTH}}/g, String(globalValues.logoWidth))
        .replace(/{{LOGO_HEIGHT}}/g, String(globalValues.logoHeight))
        .replace(/{{PAGE_TITLE}}/g, `${page.filename} | ${globalValues.location}`)
        .replace(/{{META_DESCRIPTION}}/g, `${page.filename} | ${globalValues.location}. Call us now to get a free quote.`)
        .replace(/{{PAGE_NAME}}/g, page.filename.toUpperCase())
        .replace(/{{BUSINESS_NAME}}/g, globalValues.businessName.toUpperCase())
        .replace(/{{HERO_IMG_MOBILE}}/g, uploadedImages[index]?.heroMobile || '')
        .replace(/{{HERO_IMG_TABLET}}/g, uploadedImages[index]?.heroTablet || '')
        .replace(/{{HERO_IMG_DESKTOP}}/g, uploadedImages[index]?.heroDesktop || '')
        .replace(/{{HERO_IMG_LARGE}}/g, uploadedImages[index]?.heroLarge || '')
        .replace(/{{HERO_IMG_ALT}}/g, `${altTexts['hero-mobile']} - ${page.filename}`)
        .replace(/{{HERO_IMG_TITLE}}/g, `${altTexts['hero-mobile']} - ${page.filename}`)
        .replace(/{{SECTION2_IMG1}}/g, uploadedImages[index]?.section2Img1 || '')
        .replace(/{{SECTION2_IMG2}}/g, uploadedImages[index]?.section2Img2 || '')
        .replace(/{{SECTION2_IMG_ALT1}}/g, `${altTexts['section2-1']} - ${page.filename}`)
        .replace(/{{SECTION2_IMG_TITLE1}}/g, `${altTexts['section2-1']} - ${page.filename}`)
        .replace(/{{SECTION2_IMG_ALT2}}/g,  `${altTexts['section2-2']} - ${page.filename}`)
        .replace(/{{SECTION2_IMG_TITLE2}}/g, `${altTexts['section2-2']} - ${page.filename}`)
        .replace(/{{SECTION4_IMG1}}/g, uploadedImages[index]?.section4Img1 || '')
        .replace(/{{SECTION4_IMG2}}/g, uploadedImages[index]?.section4Img2 || '')
        .replace(/{{SECTION4_IMG_ALT1}}/g, `${altTexts['section4-1']} - ${page.filename}`)
        .replace(/{{SECTION4_IMG_TITLE1}}/g,  `${altTexts['section4-1']} - ${page.filename}`)
        .replace(/{{SECTION4_IMG_ALT2}}/g,  `${altTexts['section4-2']} - ${page.filename}`)
        .replace(/{{SECTION4_IMG_TITLE2}}/g, `${altTexts['section4-2']} - ${page.filename}`)
        .replace(/{{MAP_IFRAME_SRC}}/g, globalValues.mapEmbed || '')
        .replace(/{{MAP_IFRAME_TITLE}}/g, escapeAttr(`Google map of ${globalValues.businessName} — ${globalValues.address || globalValues.location}`))
        .replace(/{{SECTION1_H2}}/g, sectionsWithLinks.section1.heading.toUpperCase())
        .replace(/{{SECTION1_H3}}/g, sectionsWithLinks.section1.subheading)
        .replace(/{{SECTION1_P1}}/g, sectionsWithLinks.section1.paragraphs[0])
        .replace(/{{SECTION1_P2}}/g, sectionsWithLinks.section1.paragraphs[1])
        .replace(/{{SECTION2_H2}}/g, sectionsWithLinks.section2.heading.toUpperCase())
        .replace(/{{SECTION2_P1}}/g, sectionsWithLinks.section2.paragraphs[0])
        .replace(/{{SECTION2_P2}}/g, sectionsWithLinks.section2.paragraphs[1])
        .replace(/{{SECTION3_H2}}/g, sectionsWithLinks.section3.heading.toUpperCase())
        .replace(/{{SECTION3_P1}}/g, sectionsWithLinks.section3.paragraphs[0])
        .replace(/{{SECTION3_P2}}/g, sectionsWithLinks.section3.paragraphs[1])
        .replace(/{{SECTION4_H2}}/g, sectionsWithLinks.section4.heading.toUpperCase())
        .replace(/{{SECTION4_P1}}/g, sectionsWithLinks.section4.paragraphs[0])
        .replace(/{{SECTION4_P2}}/g, sectionsWithLinks.section4.paragraphs[1])
        .replace(/{{LOCATION_AREA}}/g, globalValues.location)
        .replace(/{{ADDRESS}}/g, globalValues.address)
        .replace(/{{EMAIL}}/g, globalValues.email)
        .replace(/{{HOURS_TIME}}/g, getHoursTimeText(globalValues.is24Hours, globalValues.hours))
        .replace(/{{PHONE_RAW}}/g, formatPhoneForHref(globalValues.phone))
        .replace(/{{PHONE_DISPLAY}}/g, globalValues.phone)
        .replace(/{{CURRENT_YEAR}}/g, new Date().getFullYear())
        .replace(/{{SOCIAL_LINKS}}/g, buildSocialLinks(globalValues));

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
      const heroAlt = `${altTexts['hero-mobile']} - ${page.filename}`;
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
          title: `${page.filename} | ${globalValues.location}`,
          description: `${page.filename} | ${globalValues.location}. Call us now to get a free quote.`,
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
                         alt:`${altTexts['section2-1']} - ${page.filename}`, width:600, height:400 }),
              CM.image({ role:'section2-img2', src:uploadedImages[index]?.section2Img2,
                         alt:`${altTexts['section2-2']} - ${page.filename}`, width:600, height:400 }),
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
                         alt:`${altTexts['section4-1']} - ${page.filename}`, width:600, height:400 }),
              CM.image({ role:'section4-img2', src:uploadedImages[index]?.section4Img2,
                         alt:`${altTexts['section4-2']} - ${page.filename}`, width:600, height:400 }),
            ],
          }),
          {
            key: 'napMap', label: 'Contact Details & Map',
            type: CM.SECTION_TYPES.NAP_MAP,
            heading: '', paragraphs: [], images: [],
            mapEmbed: globalValues.mapEmbed || '',
          },
        ],
        interlinks: pagesInterlinks || [],
      });
    }



    // === FAQ from Google's "People Also Ask" ===
    //
    // Home page only. Two ValueSERP queries are merged to reach six questions,
    // cached for 30 days so regenerating costs nothing. Any failure here leaves
    // faqs empty and the page builds without the section.
    console.log(isSample ? '❓ Skipping FAQ (design sample)' : '❓ Fetching People Also Ask questions...');
    const paaQuestions = isSample ? [] : await fetchPeopleAlsoAsk({
      keyword: globalValues.useNearMe === 'true'
        ? `${globalValues.businessType} near me`
        : globalValues.businessType,
      businessType: globalValues.businessType,
      location: globalValues.location,
    });

    const faqs = paaQuestions.length
      ? await generateFaqAnswers({
          questions: paaQuestions,
          businessName: globalValues.businessName,
          businessType: globalValues.businessType,
          location: globalValues.location,
        })
      : [];


    // Six service cards for the home page. These sit under the existing
    // Services paragraphs rather than replacing them.
    console.log('🧩 Generating service cards...');
    const serviceCards = await generateServiceCards({
      businessType: globalValues.businessType,
      businessName: globalValues.businessName,
      location: globalValues.location,
    });


    // Typical price ranges. Framed as estimates for the area, not as the
    // business's own price list — the figures are generated, not supplied.
    console.log(isSample ? '💲 Skipping pricing (design sample)' : '💲 Generating pricing table...');
    const pricing = isSample ? [] : await generatePricing({
      businessType: globalValues.businessType,
      location: globalValues.location,
    });


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
            pricing
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
            interlinkMap['contact'] || []
    );


    // Create location pages
    await report({ stage: 'Writing location pages', current: '', done: pagesDone });

    const locationModelPages = isSample ? [] : await buildLocationPages(
            distDir,
            cssDir,
            globalValues,
            pages,           // ⬅️ pass pages so Services dropdown can be built
            uploadedImages,
            interlinkMap
    );




    // === sitemap.xml + robots.txt ===
    // Written after every page exists, so the URL list is derived from what
    // was actually generated rather than from what we intended to generate.
    if (!isSample) {
      await report({ stage: 'Finishing up', current: 'sitemap.xml', done: pagesDone });
      buildSitemap(distDir, globalValues);
    }


    // === Assemble and persist the semantic model ===
    // Order matters: front page first, then services, then locations, then legal.
    contentModel.pages.unshift(...(aboutPage ? [aboutPage] : []));
    // Location pages are built in a batch, so they are counted together
    // once buildLocationPages returns rather than one at a time.
    //
    // `|| []` because buildLocationPages returns undefined when there are no
    // locations to build — reading .length on that threw and killed the job
    // right at the end, after every page had already been written.
    const builtLocations = locationModelPages || [];
    pagesDone += builtLocations.length;
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

    CM.writeModel(distDir, contentModel);


    // Charge only now that the build has succeeded
    const remaining = await chargeCredits(ctx.user, credit.totalCost);
    console.log(`💳 Charged ${credit.totalCost} credit(s); ${remaining} remaining`);

    // The counterpart to generation.started. Without it there is no record of
    // how long a build took or what it cost — which is exactly what you want
    // when a customer says "it was slow" or queries their credit balance.
    log.generation('generation.completed', {
      requestId: ctx.requestId,
      userId,
      siteMode: isSample ? 'sample' : 'lead',
      durationMs: Date.now() - startedAt,
      servicePages: Object.keys(pages || {}).length,
      locationPages: locationCount,
      creditsCharged: credit.totalCost,
      creditsRemaining: remaining,
    });


    // Register this build so /export-wp can convert THIS exact output
    const buildId = createBuildRecord(distDir, {
      businessName: globalValues?.businessName || 'Site',
      location:     globalValues?.location || '',
    });



  return {
    creditsCharged: credit.totalCost,
    creditsRemaining: remaining,
    buildId,
    distDir,
  };
}

module.exports = { runGeneration };