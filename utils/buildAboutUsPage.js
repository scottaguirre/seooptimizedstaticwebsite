const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');
const { buildAltText } = require('./buildAltText');
const { indexMeta } = require('./pageMeta');
const { buildNavMenu } = require('./buildNavMenu');
const { formatPhoneForHref } = require('./formatPhoneForHref');
const { injectIndexInterlinks } = require('./injectIndexInterlinks');
const { generateAboutUsContent } = require('./generateAboutUsContent');
const { getHoursTimeText } = require('./formatDaysAndHoursForDisplay');
const { escapeAttr, buildAboutMediaHtml } = require('./helpers');
const { writePageAssets } = require('./buildAssets');
const { buildSocialLinks } = require('./buildSocialLinks');
const CM = require('./contentModel');
const { stripUnusedHero } = require('./stripUnusedHero');
const { fillLegalLinks } = require('./legalLinks');
const { buildFaqSection, buildFaqSchemaTag } = require('./buildFaqSection');
const { buildServiceCards } = require('./buildServiceCards');
const { buildPricingTable } = require('./buildPricingTable');
const { copyBadgeImages, buildBadgesHtml } = require('./copyBadgeImages');
const { copyPageImage, buildContactFormHtml } = require('./pageParts');
const { getPreset, assetPath, imageAlt } = require('./seoPresets');
const { canonicalTag } = require('./canonicalUrl');

/**
 * The trust points under Section 1's opening paragraph.
 *
 * Rendered as a real <ul> rather than inside a <p>: a list nested in a
 * paragraph is invalid HTML and browsers repair it unpredictably. Returns ''
 * when the model gives us nothing, so the page simply shows two paragraphs.
 */
function buildTrustList(points = []) {
  const items = (points || [])
    .map(p => String(p || '').trim())
    .filter(Boolean)
    .slice(0, 8);

  if (!items.length) return '';

  const rows = items.map(point => `
              <li>${String(point)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')}</li>`).join('');

  return `<ul class="trust-points">${rows}
            </ul>`;
}


const basePath = '';


const predefinedImagesDir = path.join(__dirname, '../src/predefined-images');

// copyPageImage and the contact form markup now live in ./pageParts so the
// contact page can use the same ones. Two copies of the form would drift.


const  buildAboutUsPage =  async function (
            distDir,
            cssDir,
            globalValues,
            jsonLdString,
            indexInterlinks,
            pages,
            faqs = [],
            serviceCards = [],
            pricing = []

    ){
        const categoryMap = {
            'plumbing':        'Plumber',
            'electrician':     'Electrician',
            'roofing':         'Roofing Contractor',
            'concrete-contractor': 'Concrete Contractor',
            'hvac':            'Hvac Technician',
            'air-conditioning': 'Air Conditioning Technician',
            'landscaping':     'Landscaper',
            'law-firm':        'Lawyer',
            'junk-removal':    'Junk Removal',
            'tree-removal':    'Tree Removal',
            'paving':          'Paving',
            'swimming pool contractor': 'Swimming Pool Contractor',
            'water damage restoration': 'Water Damage Restoration'
          };

        const businessType = slugify(globalValues.businessType);

        const category = categoryMap[businessType] || businessType;

        // Everything that differs between Rank Fast and Rank GBPs on this
        // page — the image prefix, the alt/title wording, whether the FAQPage
        // JSON-LD is emitted — comes from here.
        //
        // Looked up ONCE and used by both passes below. This file renders the
        // static HTML and then builds the WordPress model from the same data,
        // and a format applied in one pass but not the other is exactly how
        // the downloaded site and the exported theme have drifted before.
        const preset = getPreset(globalValues.siteMode);

        // Creating Section Content

       // Near Me Term Logic
       const useNearMe = String(globalValues.useNearMe) === 'true';
        let nearMeTerm;

        if(useNearMe){
            nearMeTerm = `${category} near me`;
        } else{
            nearMeTerm = "";
        }


        // seoPrefix for this page's image filenames.
        //
        //   Rank GBPs   quality-plumbing-leander-in-leander-tx-section2Img1.webp
        //   Rank Fast   section2Img1.webp
        //
        // The "-in-" in the Rank GBPs form reads as a phrase rather than two
        // slugs run together — "leander-leander" looks like a mistake. The
        // business name belongs there, on the home page; service, location and
        // contact pages use their own prefix without it.
        //
        // Rank Fast drops the prefix entirely. That is safe HERE and ONLY here,
        // because a site has exactly one index page, so assets/section2Img1.webp
        // has exactly one writer. Service and location pages must keep their
        // prefixes — see the note in utils/copyAllPredefinedImages.js.
        const seoPrefix = preset.images.indexPrefix({
            businessName: globalValues.businessName,
            nearMeTerm,
            location: globalValues.location,
        });

        // One definition of "where this page's images live", used by the copy,
        // the <img src> and the WordPress model alike.
        const img = (field) => assetPath(seoPrefix, field);

        // One definition of "what this page's images are called". Rank Fast
        // returns the raw description; every other mode appends the near-me
        // term exactly as before.
        const alt = (base) => imageAlt(globalValues, base, { nearMeTerm });


        const pageImageDirs = {
                aboutHero: path.join(predefinedImagesDir, businessType, `aboutUs/hero`),
                aboutSection2: path.join(predefinedImagesDir, businessType, `aboutUs/section2`),
                aboutSection4: path.join(predefinedImagesDir, businessType, `aboutUs/section4`),
                // Fallback image for the location section, shown when the
                // user has not supplied a YouTube URL.
                aboutSection8: path.join(predefinedImagesDir, businessType, `aboutUs/section8`)
            };


        // Create About Us page from aboutUsTamplate.html & save in dist
        let aboutus = fs.readFileSync(path.join(__dirname, '../src/aboutUsTemplate.html'), 'utf-8');
        let aboutUsPageExists = fs.existsSync(path.join(distDir, 'index.html'));


        if(!aboutUsPageExists){


            // === Copy hero images
            copyPageImage(pageImageDirs.aboutHero, seoPrefix, 'hero-mobile.webp',  'heroMobile', distDir);
            copyPageImage(pageImageDirs.aboutHero, seoPrefix, 'hero-tablet.webp',  'heroTablet', distDir);
            copyPageImage(pageImageDirs.aboutHero, seoPrefix, 'hero-desktop.webp', 'heroDesktop', distDir);
            copyPageImage(pageImageDirs.aboutHero, seoPrefix, 'hero-large.webp',   'heroLarge', distDir);

            // === Copy section2 images
            copyPageImage(pageImageDirs.aboutSection2, seoPrefix, 'section2-1.webp', 'section2Img1', distDir);
            copyPageImage(pageImageDirs.aboutSection2, seoPrefix, 'section2-2.webp', 'section2Img2', distDir);

            // === Copy section4 images
            copyPageImage(pageImageDirs.aboutSection4, seoPrefix, 'section4-1.webp', 'section4Img1', distDir);
            copyPageImage(pageImageDirs.aboutSection4, seoPrefix, 'section4-2.webp', 'section4Img2', distDir);

            // === Copy section8 image (video fallback)
            copyPageImage(pageImageDirs.aboutSection8, seoPrefix, 'section8-1.webp', 'section8Img1', distDir);



            //Generate content for About Us page
            const sections = await generateAboutUsContent(globalValues, indexInterlinks);


            if (!sections || !sections.section1 || !sections.section1.heading) {
                console.error('❌ About Us content missing section1.heading: buildAboutUs.js');
                return;
            }


            // Insert links into all paragraphs.
            //
            // Called in EVERY mode, and unchanged by the Rank Fast ring: the
            // home page's own links are up to five service pages in its second
            // paragraph, which is the same in all three modes. Only the pages
            // linking BACK to home differ, and that happens elsewhere.
            //
            // Called even with an empty list, because injecting links is not
            // all this does — it also runs stripMarkdownLinks() over every
            // paragraph, turning the [text](url) the content generator
            // sometimes emits back into plain text. Guard the call away and
            // that markdown ships raw.
            const sectionsWithLinks = injectIndexInterlinks(globalValues, pages, indexInterlinks, sections);


            // Alt text for images
            const altTexts = buildAltText(globalValues, 'aboutIndex');

            // Hero trust badges. About Us only — the other page types don't
            // use them. Returns empty strings if the files are missing, and
            // buildBadgesHtml() then renders nothing at all.
            const badges = copyBadgeImages(distDir, globalValues);


            // ✅ Build & inject Services / Locations menus (and remove wrappers if empty)
            const context = 'aboutus';
            aboutus = buildNavMenu(aboutus, globalValues, pages, basePath, slugify(globalValues.location), globalValues.location, context);


            // Alt/title strings, resolved once so the HTML pass and the model
            // pass below cannot produce different text for the same image.
            const heroAlt     = alt(altTexts['hero-mobile']);
            const section2Alt1 = alt(altTexts['section2-1']);
            const section2Alt2 = alt(altTexts['section2-2']);
            const section4Alt1 = alt(altTexts['section4-1']);
            const section4Alt2 = alt(altTexts['section4-2']);
            const section8Alt  = alt(altTexts['section8-1'] || altTexts['section2-1'] || '');

            // Video if the user supplied a URL, otherwise the section8 image.
            const aboutMediaHtml = buildAboutMediaHtml({
                videoUrl: globalValues.youtubeVideoUrl,
                businessName: globalValues.businessName,
                location: globalValues.location,
                // Same path convention as the other About Us images: they are
                // copied to assets/[<seoPrefix>-]<field>.webp by copyPageImage.
                image: img('section8Img1'),
                imageAlt: section8Alt,
            });


            aboutus = aboutus
                // Self-referencing canonical: the home page's own address, as
                // https://www.example.com/ rather than /index.html. Matches the
                // URL the sitemap lists for this page exactly — see
                // utils/canonicalUrl.js. Empty when no usable domain was given.
                .replace(/{{CANONICAL}}/g, () => (canonicalTag(globalValues, 'index.html')))
                .replace(/{{JSON_LD_SCHEMA}}/g, () => (jsonLdString))
                // Rank Fast ships no FAQPage JSON-LD. The VISIBLE FAQ section
                // below stays: this drops the structured-data block only.
                .replace(/{{FAQ_SCHEMA}}/g, () => (preset.schema.faqPage ? buildFaqSchemaTag(faqs) : ''))
                .replace(/{{FAQ_SECTION}}/g, () => (buildFaqSection(faqs)))
                .replace(/{{SERVICE_CARDS}}/g, () => (buildServiceCards(serviceCards)))
                .replace(/{{PRICING_TABLE}}/g, () => (buildPricingTable(pricing)))
                .replace(/{{FAVICON_PATH}}/g, () => (globalValues.favicon))
                .replace(/{{LOGO_PATH}}/g, () => (globalValues.logo))
                .replace(/{{LOGO_ALT}}/g, () => (`Logo image of ${globalValues.businessName} in ${globalValues.location}. ${nearMeTerm}`))
                .replace(/{{LOGO_TITLE}}/g, () => (`Logo image of ${globalValues.businessName} in ${globalValues.location}. ${nearMeTerm}`))
                .replace(/{{LOGO_WIDTH}}/g, () => (String(globalValues.logoWidth)))
                .replace(/{{LOGO_HEIGHT}}/g, () => (String(globalValues.logoHeight)))
                // From utils/pageMeta.js so every page type's format lives in
                // one file rather than four. pageMeta reads the preset, so the
                // Rank Fast title/description arrive here without this file
                // knowing the difference.
                .replace(/{{PAGE_TITLE}}/g, () => (indexMeta(globalValues).title))
                .replace(/{{META_DESCRIPTION}}/g, () => (indexMeta(globalValues).description))
                .replace(/{{BUSINESS_NAME}}/g, () => (globalValues.businessName.toUpperCase()))
                .replace(/{{LOCATION}}/g, () => (globalValues.location))
                .replace(/{{HERO_IMG_MOBILE}}/g, () => (img('heroMobile')))
                .replace(/{{HERO_IMG_TABLET}}/g, () => (img('heroTablet')))
                .replace(/{{HERO_IMG_DESKTOP}}/g, () => (img('heroDesktop')))
                .replace(/{{HERO_IMG_LARGE}}/g, () => (img('heroLarge')))
                .replace(/{{HERO_IMG_ALT}}/g, () => (heroAlt))
                .replace(/{{HERO_IMG_TITLE}}/g, () => (heroAlt))
                .replace(/{{SECTION2_IMG1}}/g, () => (img('section2Img1')))
                .replace(/{{SECTION2_IMG2}}/g, () => (img('section2Img2')))
                .replace(/{{SECTION2_IMG_ALT1}}/g, () => (section2Alt1))
                .replace(/{{SECTION2_IMG_TITLE1}}/g, () => (section2Alt1))
                .replace(/{{SECTION2_IMG_ALT2}}/g, () => (section2Alt2))
                .replace(/{{SECTION2_IMG_TITLE2}}/g, () => (section2Alt2))
                .replace(/{{SECTION4_IMG1}}/g, () => (img('section4Img1')))
                .replace(/{{SECTION4_IMG2}}/g, () => (img('section4Img2')))
                .replace(/{{SECTION4_IMG_ALT1}}/g, () => (section4Alt1))
                .replace(/{{SECTION4_IMG_TITLE1}}/g, () => (section4Alt1))
                .replace(/{{SECTION4_IMG_ALT2}}/g, () => (section4Alt2))
                .replace(/{{SECTION4_IMG_TITLE2}}/g, () => (section4Alt2))
                .replace(/{{MAP_IFRAME_SRC}}/g, () => (globalValues.mapEmbed || ''))
                .replace(/{{MAP_IFRAME_TITLE}}/g, () => (escapeAttr(`Google map of ${globalValues.businessName} — ${globalValues.address || globalValues.location}`)))
                .replace(/{{SECTION1_H2}}/g, () => (sectionsWithLinks.section1.heading.toUpperCase()))
                .replace(/{{SECTION1_H3}}/g, () => (sectionsWithLinks.section1.subheading))
                .replace(/{{SECTION1_P1}}/g, () => (sectionsWithLinks.section1.paragraphs[0]))
                .replace(/{{SECTION1_LIST}}/g, () => (buildTrustList(sectionsWithLinks.section1.trustPoints)))
                .replace(/{{HERO_BADGES}}/g, () => (buildBadgesHtml(badges)))
                .replace(/{{SECTION1_P2}}/g, () => (sectionsWithLinks.section1.paragraphs[1]))
                .replace(/{{SECTION2_H2}}/g, () => (sectionsWithLinks.section2.heading.toUpperCase()))
                .replace(/{{SECTION2_P1}}/g, () => (sectionsWithLinks.section2.paragraphs[0]))
                .replace(/{{SECTION2_P2}}/g, () => (sectionsWithLinks.section2.paragraphs[1]))
                .replace(/{{SECTION3_H2}}/g, () => (sectionsWithLinks.section3.heading.toUpperCase()))
                .replace(/{{SECTION3_P1}}/g, () => (sectionsWithLinks.section3.paragraphs[0]))
                .replace(/{{SECTION3_P2}}/g, () => (sectionsWithLinks.section3.paragraphs[1]))
                .replace(/{{SECTION4_H2}}/g, () => (sectionsWithLinks.section4.heading.toUpperCase()))
                .replace(/{{SECTION4_P1}}/g, () => (sectionsWithLinks.section4.paragraphs[0]))
                .replace(/{{SECTION4_P2}}/g, () => (sectionsWithLinks.section4.paragraphs[1]));

                // === Section 5 ("Near Me") conditional block
                if (useNearMe && sectionsWithLinks.section5) {
                    aboutus = aboutus
                        .replace(/{{NEAR_ME_H2}}/g, () => (sectionsWithLinks.section5.heading.toUpperCase()))
                        .replace(/{{NEAR_ME_P1}}/g, () => (sectionsWithLinks.section5.paragraphs[0]))
                        .replace(/{{NEAR_ME_P2}}/g, () => (sectionsWithLinks.section5.paragraphs[1]));
                    } else {
                    // remove the text so the section appears empty
                    aboutus = aboutus.replace(/<section class="nearme">[\s\S]*?<\/section>\s*/i, '');
                    }

            // === Footer & misc replacements
            aboutus = aboutus
                .replace(/{{ADDRESS}}/g, () => (globalValues.address))
                .replace(/{{EMAIL}}/g, () => (globalValues.email))
                .replace(/{{HOURS_TIME}}/g, () => (getHoursTimeText(globalValues.is24Hours, globalValues.hours)))
                .replace(/{{PHONE_RAW}}/g, () => (formatPhoneForHref(globalValues.phone)))
                .replace(/{{PHONE_DISPLAY}}/g, () => (globalValues.phone))
                .replace(/{{CURRENT_YEAR}}/g, () => (new Date().getFullYear()))
                .replace(/{{SOCIAL_LINKS}}/g, () => (buildSocialLinks(globalValues)))
                .replace(/{{ABOUT_MEDIA}}/g, () => (aboutMediaHtml))
                .replace('</head>', `<link rel="stylesheet" href="./css/bootstrap.min.css">
                                    <link rel="stylesheet" href="./css/index.css"></head>`)
                .replace('</body>', `<script src="./js/bootstrap.bundle.min.js"></script>
                                     <script src="./js/index.js"></script>
                          </body>`);


                // NOTE: an earlier version stripped a hard-coded
                // <div class="container about-video-section"> here when no
                // video was supplied. That wrapper no longer exists in the
                // template — {{ABOUT_MEDIA}} sits directly inside the column
                // and buildAboutMediaHtml() decides what goes in it — so the
                // regex matched nothing and referenced a variable that had
                // been renamed, throwing on every build.



            // Normalize checkbox -> boolean
            const normalizeBool = (v) => {
                if (typeof v === 'boolean') return v;
                if (typeof v === 'number') return v === 1;
                if (!v) return false;
                const s = String(v).toLowerCase();
                return ['true','1','on','yes'].includes(s);
            };




            // === OPTIONAL Contact Form injection (replaces {{FORM}}) ===
            // The markup lives in ./pageParts so the contact page uses the
            // identical form. buildContactFormHtml returns '' when there is
            // no valid email, so the section is dropped rather than posting
            // nowhere.
            const showAboutForm = normalizeBool(globalValues.showAboutForm);
            const contactFormHtml = buildContactFormHtml(globalValues);
            const hasEmail = !!contactFormHtml;

            // Replace the placeholder with the form only if BOTH are true
            if (hasEmail && showAboutForm) {
                aboutus = aboutus.replace(/<section>\s*{{FORM}}\s*<\/section>/i, contactFormHtml);
            } else {
                aboutus = aboutus.replace(/<section>\s*{{FORM}}\s*<\/section>\s*/i, '');
            }



            // Write the About Us Page file (index.html)
            // Remove whichever hero block this design does not display, so
            // the page ships one hero and one <h1> instead of two.
            aboutus = fillLegalLinks(aboutus, globalValues);
            aboutus = stripUnusedHero(aboutus, globalValues.styleKey);

            fs.writeFileSync(path.join(distDir, `index.html`), aboutus);

            // === Stylesheet + Webpack entry stub, inside this user's folder
            writePageAssets({
                distDir,
                cssDir,
                entryName: 'index',
                cssName: 'index',
                styleKey: globalValues.styleKey
            });

            // === Semantic model for the WordPress exporter ===
            //
            // SECOND PASS OVER THE SAME DATA. Every format below reads the
            // same `img()`, `alt()` and `preset` the HTML above used. A branch
            // added to one pass and not the other means the downloaded site
            // and the exported theme disagree — which is why the alt strings
            // and image paths are resolved once, above, rather than rebuilt
            // here.

            const modelSections = [
                Object.assign(CM.heroSection({
                    h1: globalValues.businessName.toUpperCase(),
                    tagline: globalValues.location,
                    imageList: CM.heroImages({
                        heroMobile:  img('heroMobile'),
                        heroTablet:  img('heroTablet'),
                        heroDesktop: img('heroDesktop'),
                        heroLarge:   img('heroLarge'),
                    }, heroAlt, heroAlt),
                }), {
                    // Carried separately from the responsive hero images:
                    // these are fixed badges, not size variants.
                    badges: {
                        award: badges.awardBadge,
                        awardAlt: badges.awardBadgeAlt,
                        licensed: badges.licensedBadge,
                        licensedAlt: badges.licensedBadgeAlt,
                    },
                }),
                Object.assign(
                    CM.section({
                        key: 'section1', label: 'Who We Are',
                        type: CM.SECTION_TYPES.TEXT,
                        source: sectionsWithLinks.section1 || {},
                    }),
                    // Carried through so the WordPress admin can edit each
                    // trust point rather than losing them on export.
                    Array.isArray(sectionsWithLinks.section1?.trustPoints)
                        ? { trustPoints: sectionsWithLinks.section1.trustPoints.slice(0, 8) }
                        : {}
                ),
                CM.section({
                    key: 'section2', label: 'What Makes Us Stand Out',
                    type: CM.SECTION_TYPES.TEXT_IMAGES,
                    source: sectionsWithLinks.section2 || {},
                    imageList: [
                        CM.image({ role:'section2-img1', src:img('section2Img1'),
                                   alt:section2Alt1, width:600, height:400 }),
                        CM.image({ role:'section2-img2', src:img('section2Img2'),
                                   alt:section2Alt2, width:600, height:400 }),
                    ],
                }),
                CM.section({
                    key: 'section3', label: 'Services We Offer',
                    type: CM.SECTION_TYPES.TEXT_IMAGES,
                    source: sectionsWithLinks.section3 || {},
                    imageList: [
                        CM.image({ role:'section4-img1', src:img('section4Img1'),
                                   alt:section4Alt1, width:600, height:400 }),
                        CM.image({ role:'section4-img2', src:img('section4Img2'),
                                   alt:section4Alt2, width:600, height:400 }),
                    ],
                }),
            ];

            // useNearMe, not just "did the model return a section5".
            //
            // The AI generates section5 whether or not the wizard box was
            // ticked, and the static page checks useNearMe before rendering
            // it (see the conditional block above). The model checked only
            // for the section's existence — so a user who left "Near Me"
            // unticked got no such section on the downloaded site, but did
            // get one in the exported WordPress theme.
            if (useNearMe && sectionsWithLinks.section5) {
                modelSections.push(CM.section({
                    key: 'nearMe', label: 'Near Me',
                    type: CM.SECTION_TYPES.TEXT,
                    source: sectionsWithLinks.section5,
                }));
            }


            // NOTE: no standalone video section here.
            //
            // The video lives on section4 (the location section) as its
            // video_url, where it replaces the fallback image. Pushing it
            // again as its own section rendered the embed TWICE in WordPress
            // — once inside the location section and once after it.

            // Service cards sit directly after section3 on the static page
            // ({{SERVICE_CARDS}} is inside that section), so insert them there
            // rather than appending — pushing left them after the location
            // section in WordPress, in a different order to the static site.
            const serviceCardsSection = CM.serviceCardsSection(serviceCards);
            if (serviceCardsSection) {
                const afterServices = modelSections.findIndex(sec => sec.key === 'section3');
                if (afterServices >= 0) {
                    modelSections.splice(afterServices + 1, 0, serviceCardsSection);
                } else {
                    modelSections.push(serviceCardsSection);
                }
            }

            const pricingModelSection = CM.pricingSection(pricing, {
                notice: require('./buildPricingTable').DEFAULT_NOTICE,
            });
            if (pricingModelSection) {
                modelSections.push(pricingModelSection);
            }

            // The FAQ SECTION is kept in every mode — Rank Fast drops the
            // JSON-LD, not the questions on the page. The flag below tells the
            // WordPress exporter which it is; without it the theme would
            // re-emit FAQPage from this section and the exported site would
            // carry structured data the downloaded one does not.
            const faqModelSection = CM.faqSection(faqs);
            if (faqModelSection) {
                modelSections.push(Object.assign(faqModelSection, {
                    emitFaqSchema: preset.schema.faqPage,
                }));
            }

            // The location section sits AFTER the FAQ on the page, not before
            // pricing. Pushing it earlier put it above the pricing table in
            // WordPress while the static site had it below the FAQ.
            //
            // TEXT_IMAGES rather than TEXT: it carries the video-or-image
            // media slot alongside its paragraphs, so the WordPress renderer
            // falls back to the image the same way the static build does.
            modelSections.push(CM.section({
                key: 'section4', label: 'Our Service Area',
                type: CM.SECTION_TYPES.TEXT_IMAGES,
                source: sectionsWithLinks.section4 || {},
                imageList: [
                    CM.image({
                        role: 'section8-img1',
                        src: img('section8Img1'),
                        alt: section8Alt,
                        width: 400, height: 600,
                    }),
                ],
                extra: { videoUrl: globalValues.youtubeVideoUrl || '' },
            }));

            // Matches the static page's guard exactly: hasEmail AND the
            // normalised toggle.
            //
            // This checked the RAW value, so the string "false" from a form
            // post passed as truthy — and it ignored hasEmail entirely, so a
            // site with no email address got a form in WordPress that the
            // downloaded site did not have, pointing nowhere.
            if (hasEmail && showAboutForm) {
                modelSections.push({
                    key: 'form', label: 'Contact Form',
                    type: CM.SECTION_TYPES.FORM,
                    heading: '', paragraphs: [], images: [],
                });
            }

            modelSections.push({
                key: 'napMap', label: 'Contact Details & Map',
                type: CM.SECTION_TYPES.NAP_MAP,
                heading: '', paragraphs: [], images: [],
                mapEmbed: globalValues.mapEmbed || '',
            });

            return {
                type: CM.PAGE_TYPES.ABOUT,
                htmlFile: 'index.html',
                slug: 'about',
                cssName: 'index',
                title: `${globalValues.businessName}`,
                isFrontPage: true,
                menuOrder: 0,
                meta: {
                    // From pageMeta, the SAME source the static template uses.
                    //
                    // These were hardcoded separately, so updating the
                    // template left WordPress showing the old wording — the
                    // exported theme and the downloaded site disagreed on
                    // every title and description.
                    title: indexMeta(globalValues).title,
                    description: indexMeta(globalValues).description,
                },
                schema: jsonLdString || '',
                // Read by the exporter so it emits the same structured data
                // the static page did. Rank Fast ships LocalBusiness only.
                siteMode: preset.key,
                emitFaqSchema: preset.schema.faqPage,
                sections: modelSections,
                interlinks: indexInterlinks || [],
            };



        }

    }

module.exports = { buildAboutUsPage };