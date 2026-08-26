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
const { locationMeta } = require('./pageMeta');
const { fillLegalLinks } = require('./legalLinks');
const { formatPhoneForHref } = require('./formatPhoneForHref');
const { injectPagesInterlinks } = require('./injectPagesInterlinks');
const { getHoursTimeText } = require('./formatDaysAndHoursForDisplay');
const { copyAllPredefinedImages } = require("./copyAllPredefinedImages");
const { buildLocationPagesSchema } = require("./buildLocationPagesSchema");
const { generateLocationPagesContent } = require("./generateLocationPagesContent");
const { imageAlt, getPreset, normalizeSiteMode, MODES } = require('./seoPresets');
const { canonicalTag } = require('./canonicalUrl');
const { interlinkSlugs } = require('./buildRankFastLinks');
const { buildFaqSection, buildFaqSchemaTag } = require('./buildFaqSection');
const { generateLocationFaq } = require('./generateLocationFaq');
const { LOCATION_ANGLES } = require('./createLocationPagesPrompt');



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
    interlinkMap,
    // Map<normalisedKey, questionText>, created once per generation in
    // runGeneration and seeded there with the home page's FAQ questions.
    //
    // Shared and MUTATED as we go: town two sees town one's questions, town
    // three sees both. That is what makes the no-repeat guarantee hold across
    // the whole site rather than within one page.
    //
    // Defaults to an empty Map so this builder still runs standalone.
    usedFaqQuestions = new Map()
) {

  if (!(globalValues.wantsLocationPages && globalValues.locationPages.length)) return [];

  const baseTemplatePath = path.join(__dirname, '../src/locationPagesTemplate.html');
  const fallbackTemplatePath = path.join(__dirname, '../src/template.html');
  const hasLocationTpl = fs.existsSync(baseTemplatePath);

  if (!hasLocationTpl) return []; // use your fallback if you prefer

  // Used to copy images inside the main loop.
  //
  // `const`, not a bare assignment. This was an implicit global — it worked
  // only because the file is not in strict mode, and it leaked the value onto
  // globalThis for anything else in the process to read.
  const locationPages = globalValues.locationPages;
  const imageContext = "imageLocationPages";

  // Mode, resolved once. Two things read it below:
  //
  //   preset.schema.faqPage  Rank Fast ships the visible FAQ but no FAQPage
  //                          JSON-LD, exactly as on the home page.
  //   isSample               Defensive. runGeneration does not call this
  //                          builder at all in One-Page Design mode, so the
  //                          guard below should never fire — but it means no
  //                          future caller can spend a ValueSERP credit per
  //                          town on a look-and-feel preview by accident.
  const siteMode = normalizeSiteMode(globalValues.siteMode);
  const preset = getPreset(siteMode);
  const isSample = siteMode === MODES.SAMPLE;

  // Semantic model for the WordPress exporter
  const modelPages = [];

  // Locations whose content could not be generated. Reported at the end so
  // a short site is visible in the log rather than discovered later from a
  // missing link.
  const skipped = [];


  for (const [index, locationPage] of locationPages.entries()) {
    let locationSlug = locationPage.slug || locationPage.display || ''; // e.g., "Austin TX"
    const globalForLoc = { ...globalValues, location: locationPage.display };


     // Copy predefined images into dist/assets and track them.
     //
     // The location prefix (businessType-keyword) does NOT vary by mode and
     // must not: every location page copies from a different source folder
     // into the same field names, so without it the last location built
     // overwrites every earlier one's images.

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
    // From utils/pageMeta.js. globalForLoc.location is THIS page's location,
    // not the site's main one, which is what we want here.
    //
    // The location-page format is the same in every mode; only the index
    // page's differs.
    const { title: metaTitle, description: metaDesc } =
      locationMeta(globalForLoc.location, globalForLoc);
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

    // Flattened to plain slugs for the content prompt, which reads the list
    // positionally and asks the model to include each one verbatim. The Rank
    // Fast ring carries objects; handed straight through, the prompt would
    // request the literal text "[object Object]".
    const contentKeywords = interlinkSlugs(pagesInterlinks);


    // Page content + alts
    // Pass the index so each location page gets a different angle — without
    // it every page opens on the same topic and reads as templated.
    const sections = await generateLocationPagesContent(globalForLoc, contentKeywords, Number(index));

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


    // === FAQ for this town ===
    //
    // Generated from this page's ANGLE, not fetched from Google. The PAA
    // version of this shipped and failed: Google has no question data for a
    // small town and returns the STATE's block, so three towns and the home
    // page all carried "How much does a plumber charge in Texas?".
    // utils/generateLocationFaq.js has the full account.
    //
    // The angle index is the SAME one passed to generateLocationPagesContent
    // above, so the questions are about whatever this page's copy is about —
    // arrival windows on the response-times page, cold snaps on the seasonal
    // one. That is what makes two towns differ by more than their name.
    //
    // usedFaqQuestions is shared across the whole build and mutated here, so
    // no question can appear on two pages. It is seeded with the home page's
    // questions before the first town is built.
    //
    // Deliberately AFTER the skip guard: a town whose content could not be
    // generated never reaches this point and never spends a GPT call on a page
    // that will not be written.
    //
    // COST: 0 ValueSERP credits. Two GPT calls — a small one for the
    // questions, then answers for the survivors only. Every failure path
    // returns [] and the page is written without the section.
    const faqHeading = `Frequently Asked Questions — ${locationPage.display}`;

    const angle = LOCATION_ANGLES[Number(index) % LOCATION_ANGLES.length] || {};

    const faqs = isSample ? [] : await generateLocationFaq({
      businessName: globalValues.businessName,
      businessType: globalValues.businessType,
      // THIS town, not the site's main location — the FAQ is about the page
      // it sits on.
      location: locationPage.display,
      angleFocus: angle.focus || '',
      angleIndex: Number(index),
      usedQuestions: usedFaqQuestions,
      // Every place name on the site, so the shape filter can strip them and
      // catch "…in Cedar Park?" / "…in Round Rock?" as one question.
      placeNames: [
        ...locationPages.map(l => (l && l.display) || '').filter(Boolean),
        globalValues.location,
      ],
    });

    // globalForLoc carries siteMode, so buildAltText applies the mode's
    // format: "…in Austin, TX" for Rank GBPs, the bare description for
    // Rank Fast.
    const altTexts = buildAltText(globalForLoc, Number(index));

    // ONE definition of each image's alt/title, used by the template fill
    // AND by the WordPress model at the bottom of this loop.
    //
    // NO LOCATION SUFFIX. The two passes disagreed here: the template appended
    // " - austin-tx" while the model stored the bare text, so the downloaded
    // page and the exported theme carried different alt attributes for the
    // same image. The comment above the old `altSuffix` variable says why the
    // suffix was meant to go — buildAltText already ends with "in Austin, TX",
    // so appending the slug repeated the location and read badly:
    // "…fittings in Austin, TX - austin-tx". It was removed from the model
    // pass and missed in the template pass. Both now match, on the bare form
    // the comment intended. (`altSuffix` itself was assigned and never read.)
    const alt = (base) => imageAlt(globalForLoc, base);

    const heroAlt      = alt(altTexts['hero-mobile']);
    const section2Alt1 = alt(altTexts['section2-1']);
    const section2Alt2 = alt(altTexts['section2-2']);
    const section4Alt1 = alt(altTexts['section4-1']);
    const section4Alt2 = alt(altTexts['section4-2']);

    //console.log(`from buildLocationPages ${sections.section1.paragraphs[0]}`);

    // Build & inject interlinks for this location page (Home + next two in the combined ring)
    const locKey = locationPage.slug || locationPage.display || '';
    const locInterlinks = (interlinkMap && interlinkMap[locKey]) || [];
    const pseudoPage = { slug: locKey }; // so injector can avoid self-linking

    // Called even when locInterlinks is empty — every Rank Fast build, and
    // any build whose ring is empty. The injector also strips stray markdown
    // links out of the AI's paragraphs, and that has to happen in every mode.
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
      // Self-referencing canonical. pagePath is the same string the schema
      // above uses and the same file this loop writes at the bottom, so the
      // tag, the JSON-LD and the sitemap all name one address.
      .replace(/{{CANONICAL}}/g, canonicalTag(globalForLoc, pagePath))
      .replace(/{{JSON_LD_SCHEMA}}/g, jsonLdString)
      // FIRST PASS of the FAQ. The heading const is reused by the model at the
      // bottom of this loop; buildFaqSection returns '' with no FAQ, so the
      // placeholder disappears rather than leaving an empty section behind.
      //
      // Rank Fast drops the FAQPage JSON-LD and keeps the visible questions,
      // matching the home page.
      //
      // Both use a FUNCTION replacer, not a string. A string replacement
      // interprets "$&" and "$`" inside the replacement text, and this text is
      // model-written — an answer containing "$&" would inject the literal
      // "{{FAQ_SECTION}}" back into the page. A function replacer is inserted
      // verbatim.
      .replace(/{{FAQ_SCHEMA}}/g, () => preset.schema.faqPage ? buildFaqSchemaTag(faqs) : '')
      .replace(/{{FAQ_SECTION}}/g, () => buildFaqSection(faqs, faqHeading))
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
      .replace(/{{HERO_IMG_ALT}}/g, heroAlt)
      .replace(/{{HERO_IMG_TITLE}}/g, heroAlt)
      .replace(/{{SECTION2_IMG1}}/g, uploadedImages[index]?.section2Img1 || '')
      .replace(/{{SECTION2_IMG2}}/g, uploadedImages[index]?.section2Img2 || '')
      .replace(/{{SECTION2_IMG_ALT1}}/g, section2Alt1)
      .replace(/{{SECTION2_IMG_TITLE1}}/g, section2Alt1)
      .replace(/{{SECTION2_IMG_ALT2}}/g, section2Alt2)
      .replace(/{{SECTION2_IMG_TITLE2}}/g, section2Alt2)
      .replace(/{{SECTION4_IMG1}}/g, uploadedImages[index]?.section4Img1 || '')
      .replace(/{{SECTION4_IMG2}}/g, uploadedImages[index]?.section4Img2 || '')
      .replace(/{{SECTION4_IMG_ALT1}}/g, section4Alt1)
      .replace(/{{SECTION4_IMG_TITLE1}}/g, section4Alt1)
      .replace(/{{SECTION4_IMG_ALT2}}/g, section4Alt2)
      .replace(/{{SECTION4_IMG_TITLE2}}/g, section4Alt2)
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
    //
    // SECOND PASS. The alt consts above are reused verbatim — rebuilding them
    // here is how the two passes drifted apart in the first place.
    //
    // The FAQ section is built the same way: same `faqs` array, same
    // `faqHeading` string the static page above used. CM.faqSection returns
    // null when there is nothing to show, which is why it is pushed rather
    // than written inline in the array literal — an inline null would render
    // as an empty section in the exported theme.
    //
    // It sits between Section 5 and the map, matching the static page. The
    // home page learned this the hard way: a section placed in a different
    // order here than in the template gives the downloaded site and the
    // exported theme two different page layouts.
    const modelSections = [
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
        CM.section({
          key: 'section5', label: 'Service Area',
          type: CM.SECTION_TYPES.TEXT,
          source: sectionsWithLinks.section5 || {},
        }),
    ];

    // FAQ, between Section 5 and the map — the same slot the template above
    // puts it in. Null when there is no FAQ, so nothing is pushed.
    //
    // No emitFaqSchema flag is set here. The exported theme does not rebuild
    // FAQPage JSON-LD from a section — sectionRendererPhp renders the visible
    // accordion only — so the flag the home page carries is inert, and adding
    // it here would suggest a behaviour that does not exist.
    const faqModelSection = CM.faqSection(faqs, 'FAQ', faqHeading);
    if (faqModelSection) modelSections.push(faqModelSection);

    modelSections.push({
      key: 'napMap', label: 'Contact Details & Map',
      type: CM.SECTION_TYPES.NAP_MAP,
      heading: '', paragraphs: [], images: [],
      mapEmbed: globalForLoc.mapEmbed || '',
    });

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
      sections: modelSections,
      // Slugs, matching what the classic ring stores.
      interlinks: interlinkSlugs(locInterlinks),
    });


  }

  if (skipped.length) {
    console.warn(`   ⚠️ ${skipped.length} location page(s) skipped: ${skipped.join(', ')}`);
  }

  return modelPages;
};

module.exports = { buildLocationPages };