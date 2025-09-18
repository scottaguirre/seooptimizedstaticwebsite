const fs = require('fs');
const path = require('path');
const { googleMap } = require('./googleMap');
const { buildSchema } = require("./buildSchema");
const { buildAltText } = require("./buildAltText");
const { generateReview } = require("./generateReview");
const { formatCityState } = require('./formatCityState');
const { formatPhoneForHref } = require('./formatPhoneForHref');
const { getHoursTimeText } = require('./formatDaysAndHoursForDisplay');
const { getCoordinatesFromAddress } = require("./getCoordinatesFromAddress");
const { generateLocationPagesContent } = require("./generateLocationPagesContent");


const isDev = process.env.NODE_ENV !== 'production';
const basePath = isDev ? '/dist/' : '/';


const buildLocationPages = async function (
        distDir,
        cssDir,
        globalValues,
        uploadedImages,
        jsDir,
        servicesNavMenu,
        locationsNavMenu
    ){

    // === Separate Location Pages loop (different format / template)
    if (globalValues.wantsLocationPages && globalValues.locationPages.length) {
        const baseTemplatePath = path.join(__dirname, '../src/locationPagesTemplate.html');
        const fallbackTemplatePath = path.join(__dirname, '../src/template.html');
        const hasLocationTpl = fs.existsSync(baseTemplatePath);

        

        if(hasLocationTpl){

            console.log(globalValues.locationPages); 

            for (const [index, locationPage] of globalValues.locationPages.entries()) {

                //console.log(`from buildLocationPages: ${index}`);

                // You can choose a special filename for location pages:
                // e.g., "location-austin-tx.html"
                const locationSlug = locationPage.slug; // e.g., "austin-tx"
        
                // Override a few globals for this page
                const globalForLoc = { ...globalValues, location: locationPage.display };
            
                // Map can be centered on the city instead of street address (optional):
                // comment next line if you want to keep the exact business address map
                globalForLoc.mapEmbed = await googleMap(locationPage.display);
        
                // Load template (prefer dedicated locationTemplate.html if present)
                let template = fs.readFileSync(hasLocationTpl ? baseTemplatePath : fallbackTemplatePath, 'utf-8');
            
                // If you want a different nav for location pages, you can rebuild it here.
                // Otherwise, you can reuse the nav you build elsewhere (not strictly required).
                const locationSlugForNav = locationPage.slug;
                const filenameForNav = formatCityState(locationPage.display);
                const locationsNavMenu = buildNavMenuForLocationPages(globalValues, basePath, filenameForNav);
        
                // Minimal metadata/title for location page (tweak to your liking)
                const metaTitle = `${globalForLoc.businessName} in ${globalForLoc.location} - ${globalForLoc.businessType}`;
                const metaDesc  = `Serving ${globalForLoc.location}. Contact ${globalForLoc.businessName} for trusted ${globalForLoc.businessType.toLowerCase()} services.`;
            
                // You can also build schema for this page if you want:
                const coordinates = await getCoordinatesFromAddress(globalForLoc.location);
                const reviews     = await generateReview(globalForLoc.businessName);
                const jsonLdString = buildSchema(globalForLoc, uploadedImages, index, coordinates, reviews);
            
                // Replace tokens (use the tokens your template expects)
                 // Generate Page Sections Content
                
                const sections = await generateLocationPagesContent(globalForLoc);
                //const sectionsWithLinks = injectPagesInterlinks(globalValues, pages, page, pagesInterlinks, sections);
          
    
                // Build Alt descrptions in object format
                const altTexts =  buildAltText(globalForLoc, Number(index));


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
                    .replace(/{{HERO_IMG_ALT}}/g, `${altTexts['hero-mobile']} - ${locationSlugForNav}`)
                    .replace(/{{HERO_IMG_TITLE}}/g, `${altTexts['hero-mobile']} - ${locationSlugForNav}`)
                    .replace(/{{SECTION2_IMG1}}/g, uploadedImages[index]?.section2Img1 || '')
                    .replace(/{{SECTION2_IMG2}}/g, uploadedImages[index]?.section2Img2 || '')
                    .replace(/{{SECTION2_IMG_ALT1}}/g, `${altTexts['section2-1']} - ${locationSlugForNav}`)
                    .replace(/{{SECTION2_IMG_TITLE1}}/g, `${altTexts['section2-1']} - ${locationSlugForNav}`)
                    .replace(/{{SECTION2_IMG_ALT2}}/g,  `${altTexts['section2-2']} - ${locationSlugForNav}`)
                    .replace(/{{SECTION2_IMG_TITLE2}}/g, `${altTexts['section2-2']} - ${locationSlugForNav}`)
                    .replace(/{{SECTION4_IMG1}}/g, uploadedImages[index]?.section4Img1 || '')
                    .replace(/{{SECTION4_IMG2}}/g, uploadedImages[index]?.section4Img2 || '')
                    .replace(/{{SECTION4_IMG_ALT1}}/g, `${altTexts['section4-1']} - ${locationSlugForNav}`)
                    .replace(/{{SECTION4_IMG_TITLE1}}/g,  `${altTexts['section4-1']} - ${locationSlugForNav}`)
                    .replace(/{{SECTION4_IMG_ALT2}}/g,  `${altTexts['section4-2']} - ${locationSlugForNav}`)
                    .replace(/{{SECTION4_IMG_TITLE2}}/g, `${altTexts['section4-2']} - ${locationSlugForNav}`)
                    .replace(/{{MAP_IFRAME_SRC}}/g, globalForLoc.mapEmbed || '')
                    .replace(/{{SECTION1_H2}}/g, sections.section1.heading.toUpperCase())
                    .replace(/{{SECTION1_H3}}/g, sections.section1.subheading)
                    .replace(/{{SECTION1_P1}}/g, sections.section1.paragraphs[0])
                    .replace(/{{SECTION1_P2}}/g, sections.section1.paragraphs[1])
                    .replace(/{{SECTION2_H2}}/g, sections.section2.heading.toUpperCase())
                    .replace(/{{SECTION2_P1}}/g, sections.section2.paragraphs[0])
                    .replace(/{{SECTION2_P2}}/g, sections.section2.paragraphs[1])
                    .replace(/{{SECTION3_H2}}/g, sections.section3.heading.toUpperCase())
                    .replace(/{{SECTION3_P1}}/g, sections.section3.paragraphs[0])
                    .replace(/{{SECTION3_P2}}/g, sections.section3.paragraphs[1])
                    .replace(/{{SECTION4_H2}}/g, sections.section4.heading.toUpperCase())
                    .replace(/{{SECTION4_P1}}/g, sections.section4.paragraphs[0])
                    .replace(/{{SECTION4_P2}}/g, sections.section4.paragraphs[1])
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
                    

                    if(locationsNavMenu === ""){

                    } else{
                        template =  template.replace(/{{LOCATIONS_NAV_MENU}}/g, locationsNavMenu);

                    }
            
      
    
            
              
                // Add bootstrap.min.css link to template
                template = template.replace('</head>', `
                    <link rel="stylesheet" href="./css/bootstrap.min.css">
                    <link rel="stylesheet" href="./css/${locationSlug}.css">
                </head>`);
        
                
                // Add bootstrap.bundle.min.js link to template
                template = template.replace('</body>', `
                    <script src="./js/bootstrap.bundle.min.js"></script>
                </body>`);
          
                  
                // Create file.html from template
                fs.writeFileSync(path.join(distDir, `location-${locationSlug}.html`), template);


                // === Auto-create CSS file.css if it doesn't exist & save in src/css
                const cssFilePath = path.join(__dirname, '../src/css', `${locationSlug}.css`);
            
                if (isDev && !fs.existsSync(cssFilePath)) {
                    // Create CSS file.css in src/css for webpack use
                    const fallbackStyle = path.join(__dirname, '../src/css/style.css');
                    fs.copyFileSync(fallbackStyle, cssFilePath);
                
            
            
                    // Copy CSS generated file.css to dist/css for dev use
                    fs.copyFileSync(
                        path.join(__dirname, `../src/css/${locationSlug}.css`),
                        path.join(cssDir, `${locationSlug}.css`) // result = dist/css/{filename}.css
                    );
            
                }


                 // === Auto-create JS stub (dev or prod, needed for Webpack build)
                const jsFilePath = path.join(__dirname, '../src/js', `${locationSlug}.js`);
                const jsContent = `
                // Auto-generated JS stub for ${locationSlug}
                import '../css/bootstrap.min.css';
                import '../css/${locationSlug}.css';
                import './bootstrap.bundle.min.js';
                // Add your JS logic for ${locationSlug} here
                `;
        
                if (isDev && !fs.existsSync(jsFilePath)) {
                    // Copy bootstrap.bundle.min.js to dist
                    fs.copyFileSync(
                    path.join(__dirname, '../src/js/bootstrap.bundle.min.js'),
                    path.join(jsDir, 'bootstrap.bundle.min.js'));    
                    
        
                    // Create js file.js in src/js for webpack use
                    fs.writeFileSync(jsFilePath, jsContent);
                    
                } 
      
      
            }
        
        }
    
    } 
}
module.exports = { buildLocationPages };


  