// buildLocationPages.js
const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');
const { googleMap } = require('./googleMap');
const { buildNavMenu } = require('./buildNavMenu'); 
const { buildAltText } = require("./buildAltText");
const { escapeAttr } = require("./helpers");
const { writePageAssets } = require('./buildAssets');
const { buildSocialLinks } = require('./buildSocialLinks');
const CM = require('./contentModel');
const { stripUnusedHero } = require('./stripUnusedHero');
const { fillLegalLinks } = require('./legalLinks');
const { formatPhoneForHref } = require('./formatPhoneForHref');
const { injectPagesInterlinks } = require('./injectPagesInterlinks');
const { getHoursTimeText } = require('./formatDaysAndHoursForDisplay');
const { copyAllPredefinedImages } = require("./copyAllPredefinedImages");
const { buildLocationPagesSchema } = require("./buildLocationPagesSchema");
const { generateLocationPagesContent } = require("./generateLocationPagesContent");



const basePath = '';

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
  
  if (!(globalValues.wantsLocationPages && globalValues.locationPages.length)) return [];
  
  const baseTemplatePath = path.join(__dirname, '../src/locationPagesTemplate.html');
  const fallbackTemplatePath = path.join(__dirname, '../src/template.html');
  const hasLocationTpl = fs.existsSync(baseTemplatePath);

  if (!hasLocationTpl) return []; // use your fallback if you prefer

  // Used to copy images inside the main loop
  const locationPages = globalValues.locationPages;
  imageContext = "imageLocationPages";

  // Semantic model for the WordPress exporter
  const modelPages = [];

  // Locations whose content could not be generated. Reported at the end so
  // a short site is visible in the log rather than discovered later from a
  // missing link.
  const skipped = [];


  for (const [index, locationPage] of locationPages.entries()) {
    let locationSlug = locationPage.slug || locationPage.display || ''; // e.g., "Austin TX"
    const altSuffix = locationSlug;
    const globalForLoc = { ...globalValues, location: locationPage.display };


     // Copy predefined images into dist/assets and track them 
     
     copyAllPredefinedImages({
      distDir,
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
      uploadedImages[index],               // pass that page’s images (optional)
      globalValues.location               
    );



    //  Insert Interlinks to Pages Content 
    const pagesInterlinks = interlinkMap[locationSlug] || [];


    // Page content + alts
    // Pass the index so each location page gets a different angle — without
    // it every page opens on the same topic and reads as templated.
    const sections = await generateLocationPagesContent(globalForLoc, pagesInterlinks, Number(index));

    // Skip this location rather than taking the whole generation with it.
    //
    // The content generator returns null when the model's JSON could not be
    // parsed after retrying. Previously that produced {}, and the template
    // fill below dereferenced sections.section1.heading — so one unparseable
    // location page threw and the user lost their entire site, including the
    // pages that had already generated successfully.
    if (!sections || !sections.section1 || !Array.isArray(sections.section1.paragraphs)) {
      console.warn(`   ⚠️ Skipping location page for ${locationPage.display || locationSlug}: content could not be generated`);
      skipped.push(locationPage.display || locationSlug);
      continue;
    }

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
      .replace(/{{LOGO_WIDTH}}/g, String(globalForLoc.logoWidth))
      .replace(/{{LOGO_HEIGHT}}/g, String(globalForLoc.logoHeight))
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
      // Section 5 is text-only. Fall back to empty strings rather than
      // "undefined" if the model returns four sections instead of five.
      .replace(/{{SECTION5_H2}}/g, (sectionsWithLinks.section5?.heading || '').toUpperCase())
      .replace(/{{SECTION5_P1}}/g, sectionsWithLinks.section5?.paragraphs?.[0] || '')
      .replace(/{{SECTION5_P2}}/g, sectionsWithLinks.section5?.paragraphs?.[1] || '')
      .replace(/{{LOCATION_AREA}}/g, globalForLoc.location)
      .replace(/{{ADDRESS}}/g, locationPage.display.toUpperCase())
      .replace(/{{EMAIL}}/g, globalForLoc.email)
      .replace(/{{HOURS_TIME}}/g, getHoursTimeText(globalValues.is24Hours, globalValues.hours))
      .replace(/{{PHONE_RAW}}/g, formatPhoneForHref(globalValues.phone))
      .replace(/{{PHONE_DISPLAY}}/g, globalForLoc.phone)
      .replace(/{{CURRENT_YEAR}}/g, new Date().getFullYear())
      .replace(/{{SOCIAL_LINKS}}/g, buildSocialLinks(globalForLoc));


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
    // Drop the unused hero block (see utils/stripUnusedHero.js)
    template = fillLegalLinks(template, globalForLoc);
    template = stripUnusedHero(template, globalForLoc.styleKey);

    fs.writeFileSync(path.join(distDir, `location-${locationSlug}.html`), template);

    // === Stylesheet + Webpack entry stub, inside this user's folder
    writePageAssets({
      distDir,
      cssDir,
      entryName: `location-${locationSlug}`,
      cssName: `location-${locationSlug}`,
      styleKey: globalValues.styleKey
    });

    // === Semantic model for this location page ===
    const heroAlt = `${altTexts['hero-mobile']} - ${altSuffix}`;
    modelPages.push({
      type: CM.PAGE_TYPES.LOCATION,
      htmlFile: `location-${locationSlug}.html`,
      slug: `location-${locationSlug}`,
      cssName: `location-${locationSlug}`,
      title: locationPage.display,
      isFrontPage: false,
      menuOrder: 100 + Number(index),
      display: locationPage.display,
      cityForSchema: locationPage.cityForSchema || '',
      state: locationPage.state || '',
      meta: { title: metaTitle, description: metaDesc },
      schema: jsonLdString || '',
      sections: [
        CM.heroSection({
          h1: globalForLoc.businessName.toUpperCase(),
          tagline: globalForLoc.location,
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
                       alt:`${altTexts['section2-1']} - ${altSuffix}`, width:600, height:400 }),
            CM.image({ role:'section2-img2', src:uploadedImages[index]?.section2Img2,
                       alt:`${altTexts['section2-2']} - ${altSuffix}`, width:600, height:400 }),
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
                       alt:`${altTexts['section4-1']} - ${altSuffix}`, width:600, height:400 }),
            CM.image({ role:'section4-img2', src:uploadedImages[index]?.section4Img2,
                       alt:`${altTexts['section4-2']} - ${altSuffix}`, width:600, height:400 }),
          ],
        }),
        CM.section({
          key: 'section5', label: 'Service Area',
          type: CM.SECTION_TYPES.TEXT,
          source: sectionsWithLinks.section5 || {},
        }),
        {
          key: 'napMap', label: 'Contact Details & Map',
          type: CM.SECTION_TYPES.NAP_MAP,
          heading: '', paragraphs: [], images: [],
          mapEmbed: globalForLoc.mapEmbed || '',
        },
      ],
      interlinks: locInterlinks || [],
    });


  }

  if (skipped.length) {
    console.warn(`   ⚠️ ${skipped.length} location page(s) skipped: ${skipped.join(', ')}`);
  }

  return modelPages;
};

module.exports = { buildLocationPages };