// buildLocationPages.js
const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');
const { googleMap } = require('./googleMap');
const { buildNavMenu } = require('./buildNavMenu'); 
const { buildAltText } = require("./buildAltText");
const { formatPhoneForHref } = require('./formatPhoneForHref');
const { injectPagesInterlinks } = require('./injectPagesInterlinks');
const { getHoursTimeText } = require('./formatDaysAndHoursForDisplay');
const { copyAllPredefinedImages } = require("./copyAllPredefinedImages");
const { buildLocationPagesSchema } = require("./buildLocationPagesSchema");
const { generateLocationPagesContent } = require("./generateLocationPagesContent");



const isDev = process.env.NODE_ENV !== 'production';
const basePath = isDev ? '/dist/' : '/';

/**
 * Build Location Pages
 * NOTE: accepts `pages` so Services dropdown can be built.
 */
const buildLocationPages = async function (
    distDir,
    cssDir,
    globalValues,
    pages,           
    uploadedImages,
    interlinkMap
) {
  
  if (!(globalValues.wantsLocationPages && globalValues.locationPages.length)) return;
  
  const baseTemplatePath = path.join(__dirname, '../src/locationPagesTemplate.html');
  const fallbackTemplatePath = path.join(__dirname, '../src/template.html');
  const hasLocationTpl = fs.existsSync(baseTemplatePath);

  if (!hasLocationTpl) return; // use your fallback if you prefer

  // Used to copy images inside the main loop
  const locationPages = globalValues.locationPages;
  imageContext = "imageLocationPages";


  for (const [index, locationPage] of locationPages.entries()) {
    let locationSlug = locationPage.slug || locationPage.display || ''; // e.g., "Austin TX"
    const globalForLoc = { ...globalValues, location: locationPage.display };


     // Copy predefined images into dist/assets and track them 
     
     copyAllPredefinedImages({
      globalValues,
      uploadedImages,
      keyword: slugify(locationSlug || ''),
      index: Number(index), // pass the index so we can cycle with % 4
      imageContext

    });


    // Center map on the city
    globalForLoc.mapEmbed = await googleMap(locationPage.display);

    // Load template
    let template = fs.readFileSync(hasLocationTpl ? baseTemplatePath : fallbackTemplatePath, 'utf-8');

    // Metadata / schema
    const metaTitle = `${globalForLoc.businessName} in ${globalForLoc.location} - ${globalForLoc.businessType}`;
    const metaDesc  = `Serving ${globalForLoc.location}. Contact ${globalForLoc.businessName} for trusted ${globalForLoc.businessType.toLowerCase()} services.`;
    const pagePath = `location-${slugify(locationPage.display)}.html`;
    
    const jsonLdString = buildLocationPagesSchema(
      globalForLoc,
      locationPage.display,               // e.g. "Dallas, TX"
      pagePath,
      uploadedImages[index]               // pass that page’s images (optional)
    );



    //  Insert Interlinks to Pages Content 
    const pagesInterlinks = interlinkMap[locationSlug] || [];


    // Page content + alts
    const sections = await generateLocationPagesContent(globalForLoc, pagesInterlinks);
    const altTexts = buildAltText(globalForLoc, Number(index));

    //console.log(`from buildLocationPages ${sections.section1.paragraphs[0]}`);

    // Build & inject interlinks for this location page (Home + next two in the combined ring)
    const locKey = locationPage.slug || locationPage.display || '';
    const locInterlinks = (interlinkMap && interlinkMap[locKey]) || [];
    const pseudoPage = { slug: locKey }; // so injector can avoid self-linking

    const sectionsWithLinks = injectPagesInterlinks(
                                    globalForLoc,   // per-location globals
                                    pages,          // service pages (used to detect service vs location)
                                    pseudoPage,     // identifies current page as a location
                                    locInterlinks,  // targets from the combined ring
                                    sections,       // original content
                                    globalValues.location  // Main location
                                  );
   

     // ✅ Build & inject Services / Locations menus (and remove wrappers if empty)
     const context = 'locations';
     template = buildNavMenu(template, globalValues, pages, basePath, slugify(globalValues.location), locationPage.display, context);
 

    // 🔁 Replace your standard placeholders
    template = template
      .replace(/{{JSON_LD_SCHEMA}}/g, jsonLdString)
      .replace(/{{FAVICON_PATH}}/g, globalForLoc.favicon)
      .replace(/{{LOGO_PATH}}/g, globalForLoc.logo)
      .replace(/{{LOGO_ALT}}/g, `Logo image of ${globalForLoc.businessName} in  - ${locationPage.display}`)
      .replace(/{{LOGO_TITLE}}/g, `Logo image of ${globalForLoc.businessName} in  - ${locationPage.display}`)
      .replace(/{{PAGE_TITLE}}/g, metaTitle)
      .replace(/{{META_DESCRIPTION}}/g, metaDesc)
      .replace(/{{BUSINESS_NAME}}/g, globalForLoc.businessName.toUpperCase())
      .replace(/{{HERO_IMG_MOBILE}}/g, uploadedImages[index]?.heroMobile || '')
      .replace(/{{HERO_IMG_TABLET}}/g, uploadedImages[index]?.heroTablet || '')
      .replace(/{{HERO_IMG_DESKTOP}}/g, uploadedImages[index]?.heroDesktop || '')
      .replace(/{{HERO_IMG_LARGE}}/g, uploadedImages[index]?.heroLarge || '')
      .replace(/{{HERO_IMG_ALT}}/g, `${altTexts['hero-mobile']} - ${locationSlug}`)
      .replace(/{{HERO_IMG_TITLE}}/g, `${altTexts['hero-mobile']} - ${locationSlug}`)
      .replace(/{{SECTION2_IMG1}}/g, uploadedImages[index]?.section2Img1 || '')
      .replace(/{{SECTION2_IMG2}}/g, uploadedImages[index]?.section2Img2 || '')
      .replace(/{{SECTION2_IMG_ALT1}}/g, `${altTexts['section2-1']} - ${locationSlug}`)
      .replace(/{{SECTION2_IMG_TITLE1}}/g, `${altTexts['section2-1']} - ${locationSlug}`)
      .replace(/{{SECTION2_IMG_ALT2}}/g, `${altTexts['section2-2']} - ${locationSlug}`)
      .replace(/{{SECTION2_IMG_TITLE2}}/g, `${altTexts['section2-2']} - ${locationSlug}`)
      .replace(/{{SECTION4_IMG1}}/g, uploadedImages[index]?.section4Img1 || '')
      .replace(/{{SECTION4_IMG2}}/g, uploadedImages[index]?.section4Img2 || '')
      .replace(/{{SECTION4_IMG_ALT1}}/g, `${altTexts['section4-1']} - ${locationSlug}`)
      .replace(/{{SECTION4_IMG_TITLE1}}/g, `${altTexts['section4-1']} - ${locationSlug}`)
      .replace(/{{SECTION4_IMG_ALT2}}/g, `${altTexts['section4-2']} - ${locationSlug}`)
      .replace(/{{SECTION4_IMG_TITLE2}}/g, `${altTexts['section4-2']} - ${locationSlug}`)
      .replace(/{{MAP_IFRAME_SRC}}/g, globalForLoc.mapEmbed || '')
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
      .replace(/{{LOCATION_AREA}}/g, globalForLoc.location)
      .replace(/{{ADDRESS}}/g, locationPage.display.toUpperCase())
      .replace(/{{EMAIL}}/g, globalForLoc.email)
      .replace(/{{HOURS_TIME}}/g, getHoursTimeText(globalValues.is24Hours, globalValues.hours))
      .replace(/{{PHONE_RAW}}/g, formatPhoneForHref(globalValues.phone))
      .replace(/{{PHONE_DISPLAY}}/g, globalForLoc.phone)
      .replace(/{{CURRENT_YEAR}}/g, new Date().getFullYear())
      .replace(/{{FACEBOOK_URL}}/g, globalForLoc.facebookUrl)
      .replace(/{{TWITTER_URL}}/g, globalForLoc.twitterUrl)
      .replace(/{{PINTEREST_URL}}/g, globalForLoc.pinterestUrl)
      .replace(/{{YOUTUBE_URL}}/g, globalForLoc.youtubeUrl)
      .replace(/{{LINKEDIN_URL}}/g, globalForLoc.linkedinUrl);


      // === Remove the email line + <hr> when email is empty ===
      const emailVal = (globalValues.email || '').trim();
      if (!emailVal) {
        // Remove: <p> {{EMAIL or undefined or empty}} </p> + optional <hr...>
        template = template.replace(
          /<p[^>]*>\s*(?:{{EMAIL}}|undefined|&nbsp;|\s)*<\/p>\s*(?:<hr[^>]*>\s*)?/gi,
          ''
        );
      }


    // Slugify locationSlug
    locationSlug = slugify(locationSlug);
   
    // CSS / JS includes
    template = template.replace('</head>', `
      <link rel="stylesheet" href="./css/bootstrap.min.css">
      <link rel="stylesheet" href="./css/location-${locationSlug}.css">
    </head>`);
    template = template.replace('</body>', `
      <script src="./js/bootstrap.bundle.min.js"></script>
    </body>`);

    // Write page
    fs.writeFileSync(path.join(distDir, `location-${locationSlug}.html`), template);

    // Dev: ensure CSS and JS stubs
    const cssFilePath = path.join(__dirname, '../src/css', `location-${locationSlug}.css`);
    if (isDev && !fs.existsSync(cssFilePath)) {
      const fallbackStyle = path.join(__dirname, '../src/css/style.css');
      fs.copyFileSync(fallbackStyle, cssFilePath);
      fs.copyFileSync(
        path.join(__dirname, `../src/css/location-${locationSlug}.css`),
        path.join(cssDir, `location-${locationSlug}.css`)
      );
    }

    const jsFilePath = path.join(__dirname, '../src/js', `location-${locationSlug}.js`);
    const jsContent = `
      // Auto-generated JS stub for ${locationSlug}
      import '../css/bootstrap.min.css';
      import '../css/location-${locationSlug}.css';
      import './bootstrap.bundle.min.js';
      // Add your JS logic for ${locationSlug} here
    `;
    if (isDev && !fs.existsSync(jsFilePath)) {
      fs.writeFileSync(jsFilePath, jsContent);
    }
  }
};

module.exports = { buildLocationPages };
