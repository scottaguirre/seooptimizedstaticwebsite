const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');
const { buildAltText } = require('./buildAltText');
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

        // Creating Section Content

       // Near Me Term Logic
       const useNearMe = String(globalValues.useNearMe) === 'true';
        let nearMeTerm;
        
        if(useNearMe){
            nearMeTerm = `${category} near me`;
        } else{
            nearMeTerm = "";
        }
        

        // seoPrefix
        const seoPrefix = useNearMe
        ? `${slugify(globalValues.businessName)}-${slugify(nearMeTerm)}-${slugify(globalValues.location)}`
        : `${slugify(globalValues.businessName)}-${slugify(globalValues.location)}`;

        
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


            // Insert links into all paragraphs
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
 

            // Video if the user supplied a URL, otherwise the section8 image.
            const aboutMediaHtml = buildAboutMediaHtml({
                videoUrl: globalValues.youtubeVideoUrl,
                businessName: globalValues.businessName,
                location: globalValues.location,
                // Same path convention as the other About Us images: they are
                // copied to assets/<seoPrefix>-<field>.webp by copyPageImage.
                image: `assets/${seoPrefix}-section8Img1.webp`,
                imageAlt: `${altTexts['section8-1'] || altTexts['section2-1'] || ''} ${nearMeTerm}`.trim(),
            });
              
              
            aboutus = aboutus
                .replace(/{{JSON_LD_SCHEMA}}/g, jsonLdString)
                .replace(/{{FAQ_SCHEMA}}/g, buildFaqSchemaTag(faqs))
                .replace(/{{FAQ_SECTION}}/g, buildFaqSection(faqs))
                .replace(/{{SERVICE_CARDS}}/g, buildServiceCards(serviceCards))
                .replace(/{{PRICING_TABLE}}/g, buildPricingTable(pricing))
                .replace(/{{FAVICON_PATH}}/g, globalValues.favicon)
                .replace(/{{LOGO_PATH}}/g, globalValues.logo)
                .replace(/{{LOGO_ALT}}/g, `Logo image of ${globalValues.businessName} in ${globalValues.location}. ${nearMeTerm}`)
                .replace(/{{LOGO_TITLE}}/g, `Logo image of ${globalValues.businessName} in ${globalValues.location}. ${nearMeTerm}`)
                .replace(/{{LOGO_WIDTH}}/g, String(globalValues.logoWidth))
                .replace(/{{LOGO_HEIGHT}}/g, String(globalValues.logoHeight))
                .replace(/{{PAGE_TITLE}}/g, `${globalValues.businessName} | ${globalValues.location}. ${nearMeTerm}`)
                .replace(/{{META_DESCRIPTION}}/g, `We are ${globalValues.businessName}. We serve ${globalValues.location}. Call us now for a free quote. ${nearMeTerm}`)
                .replace(/{{BUSINESS_NAME}}/g, globalValues.businessName.toUpperCase())
                .replace(/{{LOCATION}}/g, globalValues.location)
                .replace(/{{HERO_IMG_MOBILE}}/g, `assets/${seoPrefix}-heroMobile.webp`)
                .replace(/{{HERO_IMG_TABLET}}/g, `assets/${seoPrefix}-heroTablet.webp`)
                .replace(/{{HERO_IMG_DESKTOP}}/g, `assets/${seoPrefix}-heroDesktop.webp`)
                .replace(/{{HERO_IMG_LARGE}}/g, `assets/${seoPrefix}-heroLarge.webp`)
                .replace(/{{HERO_IMG_ALT}}/g, `${altTexts['hero-mobile']} ${nearMeTerm}`)
                .replace(/{{HERO_IMG_TITLE}}/g,  `${altTexts['hero-mobile']} ${nearMeTerm}`)
                .replace(/{{SECTION2_IMG1}}/g, `assets/${seoPrefix}-section2Img1.webp`)
                .replace(/{{SECTION2_IMG2}}/g, `assets/${seoPrefix}-section2Img2.webp`)
                .replace(/{{SECTION2_IMG_ALT1}}/g, `${altTexts['section2-1']}  ${nearMeTerm}`)
                .replace(/{{SECTION2_IMG_TITLE1}}/g, `${altTexts['section2-1']}  ${nearMeTerm}`)
                .replace(/{{SECTION2_IMG_ALT2}}/g, `${altTexts['section2-2']}  ${nearMeTerm}`)
                .replace(/{{SECTION2_IMG_TITLE2}}/g, `${altTexts['section2-2']} ${nearMeTerm}`)
                .replace(/{{SECTION4_IMG1}}/g, `assets/${seoPrefix}-section4Img1.webp`)
                .replace(/{{SECTION4_IMG2}}/g, `assets/${seoPrefix}-section4Img2.webp`)
                .replace(/{{SECTION4_IMG_ALT1}}/g, `${altTexts['section4-1']} ${nearMeTerm}`)
                .replace(/{{SECTION4_IMG_TITLE1}}/g, `${altTexts['section4-1']}  ${nearMeTerm}`)
                .replace(/{{SECTION4_IMG_ALT2}}/g, `${altTexts['section4-2']}  ${nearMeTerm}`)
                .replace(/{{SECTION4_IMG_TITLE2}}/g, `${altTexts['section4-2']} ${nearMeTerm}`)
                .replace(/{{MAP_IFRAME_SRC}}/g, globalValues.mapEmbed || '')
                .replace(/{{MAP_IFRAME_SRC}}/g, globalValues.mapEmbed || '')
                .replace(/{{MAP_IFRAME_TITLE}}/g, escapeAttr(`Google map of ${globalValues.businessName} — ${globalValues.address || globalValues.location}`))
                .replace(/{{SECTION1_H2}}/g, sectionsWithLinks.section1.heading.toUpperCase())
                .replace(/{{SECTION1_H3}}/g, sectionsWithLinks.section1.subheading)
                .replace(/{{SECTION1_P1}}/g, sectionsWithLinks.section1.paragraphs[0])
                .replace(/{{SECTION1_LIST}}/g, buildTrustList(sectionsWithLinks.section1.trustPoints))
                .replace(/{{HERO_BADGES}}/g, buildBadgesHtml(badges))
                .replace(/{{SECTION1_P2}}/g, sectionsWithLinks.section1.paragraphs[1])
                .replace(/{{SECTION2_H2}}/g, sectionsWithLinks.section2.heading.toUpperCase())
                .replace(/{{SECTION2_P1}}/g, sectionsWithLinks.section2.paragraphs[0])
                .replace(/{{SECTION2_P2}}/g, sectionsWithLinks.section2.paragraphs[1])
                .replace(/{{SECTION3_H2}}/g, sectionsWithLinks.section3.heading.toUpperCase())
                .replace(/{{SECTION3_P1}}/g, sectionsWithLinks.section3.paragraphs[0])
                .replace(/{{SECTION3_P2}}/g, sectionsWithLinks.section3.paragraphs[1])
                .replace(/{{SECTION4_H2}}/g, sectionsWithLinks.section4.heading.toUpperCase())
                .replace(/{{SECTION4_P1}}/g, sectionsWithLinks.section4.paragraphs[0])
                .replace(/{{SECTION4_P2}}/g, sectionsWithLinks.section4.paragraphs[1]);
                
                // === Section 5 ("Near Me") conditional block
                if (useNearMe && sectionsWithLinks.section5) {
                    aboutus = aboutus
                        .replace(/{{NEAR_ME_H2}}/g, sectionsWithLinks.section5.heading.toUpperCase())
                        .replace(/{{NEAR_ME_P1}}/g, sectionsWithLinks.section5.paragraphs[0])
                        .replace(/{{NEAR_ME_P2}}/g, sectionsWithLinks.section5.paragraphs[1]);
                    } else {
                    // remove the text so the section appears empty
                    aboutus = aboutus.replace(/<section class="nearme">[\s\S]*?<\/section>\s*/i, '');
                    }
                
            // === Footer & misc replacements
            aboutus = aboutus
                .replace(/{{ADDRESS}}/g, globalValues.address)
                .replace(/{{EMAIL}}/g, globalValues.email)
                .replace(/{{HOURS_TIME}}/g, getHoursTimeText(globalValues.is24Hours, globalValues.hours))
                .replace(/{{PHONE_RAW}}/g, formatPhoneForHref(globalValues.phone))
                .replace(/{{PHONE_DISPLAY}}/g, globalValues.phone)
                .replace(/{{CURRENT_YEAR}}/g, new Date().getFullYear())
                .replace(/{{SOCIAL_LINKS}}/g, buildSocialLinks(globalValues))
                .replace(/{{ABOUT_MEDIA}}/g, aboutMediaHtml)
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
            const heroAlt = `${altTexts['hero-mobile']} ${nearMeTerm}`.trim();

            const modelSections = [
                Object.assign(CM.heroSection({
                    h1: globalValues.businessName.toUpperCase(),
                    tagline: globalValues.location,
                    imageList: CM.heroImages({
                        heroMobile:  `assets/${seoPrefix}-heroMobile.webp`,
                        heroTablet:  `assets/${seoPrefix}-heroTablet.webp`,
                        heroDesktop: `assets/${seoPrefix}-heroDesktop.webp`,
                        heroLarge:   `assets/${seoPrefix}-heroLarge.webp`,
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
                        CM.image({ role:'section2-img1', src:`assets/${seoPrefix}-section2Img1.webp`,
                                   alt:`${altTexts['section2-1']} ${nearMeTerm}`.trim(), width:600, height:400 }),
                        CM.image({ role:'section2-img2', src:`assets/${seoPrefix}-section2Img2.webp`,
                                   alt:`${altTexts['section2-2']} ${nearMeTerm}`.trim(), width:600, height:400 }),
                    ],
                }),
                CM.section({
                    key: 'section3', label: 'Services We Offer',
                    type: CM.SECTION_TYPES.TEXT_IMAGES,
                    source: sectionsWithLinks.section3 || {},
                    imageList: [
                        CM.image({ role:'section4-img1', src:`assets/${seoPrefix}-section4Img1.webp`,
                                   alt:`${altTexts['section4-1']} ${nearMeTerm}`.trim(), width:600, height:400 }),
                        CM.image({ role:'section4-img2', src:`assets/${seoPrefix}-section4Img2.webp`,
                                   alt:`${altTexts['section4-2']} ${nearMeTerm}`.trim(), width:600, height:400 }),
                    ],
                }),
            ];

            if (sectionsWithLinks.section5) {
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

            const faqModelSection = CM.faqSection(faqs);
            if (faqModelSection) {
                modelSections.push(faqModelSection);
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
                        src: `assets/${seoPrefix}-section8Img1.webp`,
                        alt: `${altTexts['section8-1'] || altTexts['section2-1'] || ''} ${nearMeTerm}`.trim(),
                        width: 400, height: 600,
                    }),
                ],
                extra: { videoUrl: globalValues.youtubeVideoUrl || '' },
            }));

            if (globalValues.showAboutForm) {
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
                    title: `${globalValues.businessName} | ${globalValues.location}. ${nearMeTerm}`,
                    description: `We are ${globalValues.businessName}. We serve ${globalValues.location}. Call us now for a free quote. ${nearMeTerm}`,
                },
                schema: jsonLdString || '',
                sections: modelSections,
                interlinks: indexInterlinks || [],
            };

 

        }

    }

module.exports = { buildAboutUsPage };