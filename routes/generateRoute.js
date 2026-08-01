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
const { buildSitemap } = require('../utils/buildSitemap');

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
const upload = multer({ dest: tempUploadDir });


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


    // Reject a second concurrent build for this user
    if (generating.has(userId)) {
      return res.status(409).json({
        error: 'A website is already being generated for your account. Please wait for it to finish.',
        fields: [],
      });
    }

    // Affordability check. Nothing is deducted yet — that happens only if
    // the build succeeds, so a failure never costs the user credits.
    const credit = checkCredits(req.user, pages);
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

    generating.add(userId);


    // =========================================================
    // 2. RESET THIS USER'S BUILD FOLDER
    // Only touches dist/user_<id>/ — never the shared src/ folders.
    // =========================================================
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
    const files = req.files || [];


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
    if (!uploadedImages.global.logo) {
      const fields = [{ name: 'global[logo]', message: 'Logo is required' }];
      return jsonValidationError(res, 400, '❌ Global image uploads are missing.', fields);
    }


    // Near Me Logic
    const rawUseNearMe = req.body.global?.useNearMe ?? req.body['global[useNearMe]'];


    const globalValues = {

      showAboutForm,
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
    const { interlinkMap } = await buildInterlinksMap(pages, globalValues.locationPages);
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
    for (const [index, page] of Object.entries(pages)) {
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
      const sectionsWithLinks = injectPagesInterlinks(
                                        globalValues,
                                        pages,
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
      fs.writeFileSync(path.join(distDir, `${htmlName}.html`), template);


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
    console.log('❓ Fetching People Also Ask questions...');
    const paaQuestions = await fetchPeopleAlsoAsk({
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


    // Create about-us.html, & save in dist
    const aboutPage = await buildAboutUsPage(
            distDir,
            cssDir,
            globalValues,
            globalValues.jsonLdString,
            indexInterlinks,
            pages,
            faqs
    );




    // Create privacy-policy.html, & save in dist
    const privacyPage = buildPrivacyPolicyPage(
            distDir,
            cssDir,
            globalValues,
            pages
    );



    // Create terms-of-use.html, & save in dist
    const termsPage = buildTermsOfUsePage(
            distDir,
            cssDir,
            globalValues,
            pages
    );



    // Create accessibility.html, & save in dist
    const accessibilityPage = buildAccessibilityPage(
            distDir,
            cssDir,
            globalValues,
            pages
    );



    // Create location pages
    const locationModelPages = await buildLocationPages(
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
    buildSitemap(distDir, globalValues);


    // === Assemble and persist the semantic model ===
    // Order matters: front page first, then services, then locations, then legal.
    contentModel.pages.unshift(...(aboutPage ? [aboutPage] : []));
    CM.addPages(contentModel, locationModelPages);
    // The legal builders return their content. Fall back to a bare record if
    // one of them skipped work because the file already existed.
    CM.addPages(contentModel, [
      privacyPage       || CM.legalPage({ slug: 'privacy-policy', title: 'Privacy Policy', menuOrder: 9998 }),
      termsPage         || CM.legalPage({ slug: 'terms-of-use',   title: 'Terms of Use',   menuOrder: 9999 }),
      accessibilityPage || CM.legalPage({ slug: 'accessibility',  title: 'Accessibility',  menuOrder: 10000 }),
    ]);

    CM.writeModel(distDir, contentModel);


    // Charge only now that the build has succeeded
    const remaining = await chargeCredits(req.user, credit.totalCost);
    console.log(`💳 Charged ${credit.totalCost} credit(s); ${remaining} remaining`);


    // Register this build so /export-wp can convert THIS exact output
    const buildId = createBuildRecord(distDir, {
      businessName: globalValues?.businessName || 'Site',
      location:     globalValues?.location || '',
    });



    return res.send(`
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>Website Ready</title>
          <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"/>
          <style>
            body { background:#082d5b; color:#fff; }
            .wrap { max-width: 720px; margin: 0 auto; padding: 80px 20px; text-align:center; }
            .actions { display:flex;  gap:18px; margin-top:40px; }
            .actions .btn { padding: 14px 20px; font-size: 18px; }
            #overlay {
              position: fixed; inset: 0; background: rgba(0,0,0,.8);
              display: none; flex-direction: column; align-items: center;
              justify-content: center; z-index: 9999; color:#fff;
            }
            #overlay.show { display: flex; }
          </style>
        </head>
        <body>
          <div class="wrap">
            <h1 class="mb-3">Your website is ready</h1>
            <p class="text-white-50 mb-0">
              Preview it, download it as a static site, or convert it to WordPress.
            </p>

            <div class="actions">
              <a href="./dist/user_${userId}" target="_blank" rel="noopener"
                 class="btn btn-light btn-lg">Click to Preview Website</a>

              <button type="button" id="downloadBtn" class="btn btn-primary btn-lg">
                Download HTML Site
              </button>

              <a href="/export-wp-theme" id="wpBtn" class="btn btn-success btn-lg">Convert to WordPress</a>

              <a href="/" class="btn btn-warning">Start Over</a>
            </div>

            <div id="alert" class="alert alert-danger mt-4 d-none" role="alert"></div>
          </div>

          <div id="overlay">
            <div class="spinner-border text-light" role="status" style="width:4rem;height:4rem;">
              <span class="visually-hidden">Working...</span>
            </div>
            <p class="mt-3 fs-5" id="overlayText">Optimizing your website... please wait</p>
            <p class="text-white-50">This can take up to a minute.</p>
          </div>

          <script>
            (function () {
              const btn      = document.getElementById('downloadBtn');
              const overlay  = document.getElementById('overlay');
              const overlayText = document.getElementById('overlayText');
              const alertBox = document.getElementById('alert');

              function showAlert(msg) {
                alertBox.textContent = msg;
                alertBox.classList.remove('d-none');
              }

              // Building the WordPress theme is a plain navigation, so the
              // page would sit blank while the server works. Show the overlay
              // on click; the response replaces the page when it arrives.
              const wpBtn = document.getElementById('wpBtn');
              wpBtn.addEventListener('click', () => {
                overlayText.textContent = 'Building your WordPress theme... please wait';
                overlay.classList.add('show');
              });

              btn.addEventListener('click', async () => {
                alertBox.classList.add('d-none');
                btn.disabled = true;
                overlay.classList.add('show');

                try {
                  // Build first. /production copies the generated site,
                  // optimises the copy with Webpack and zips it.
                  const res = await fetch('/production', { headers: { 'Accept': 'text/html' } });

                  if (!res.ok) {
                    throw new Error('The build failed. Please try again.');
                  }

                  // Then hand the browser the file. Navigating rather than
                  // fetching lets the browser handle the download itself.
                  overlayText.textContent = 'Starting your download...';
                  window.location.href = '/download-zip';

                  // The overlay is cleared once the download starts; there is
                  // no navigation event for a file download, so use a timer.
                  setTimeout(() => {
                    overlay.classList.remove('show');
                    overlayText.textContent = 'Optimizing your website... please wait';
                    btn.disabled = false;
                  }, 3000);

                } catch (err) {
                  overlay.classList.remove('show');
                  btn.disabled = false;
                  showAlert(err.message || 'Something went wrong. Please try again.');
                }
              });
            })();
          </script>
        </body>
      </html>
    `);

  } catch (err) {
    console.error('Error during /generate:', err);
    return jsonValidationError(res, 500, 'Generation failed.');
  } finally {
    // Always release the per-user lock
    try {
      generating.delete(req.user._id.toString());
    } catch (_) { /* no user on the request */ }

    // delete any temp files that weren't moved (or if an error happened)
    await Promise.allSettled(tempFiles.map(p => fsp.unlink(p).catch(() => {})));
  }

});

module.exports = router;