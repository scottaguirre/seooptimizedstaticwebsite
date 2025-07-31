const path = require('path');
const fs = require('fs');
const { slugify } = require('./slugify');
const { injectIndexInterlinks } = require('./injectIndexInterlinks'); 
const { formatPhoneForHref } = require('./formatPhoneForHref');
const { generateAboutUsContent } = require('./generateAboutUsContent');
const { getHoursDaysText, getHoursTimeText} = require('./formatDaysAndHoursForDisplay');
const { buildAltText } = require('./buildAltText');



const predefinedImagesDir = path.join(__dirname, '../src/predefined-images');

function copyPageImage (srcDir, seoPrefix, filename, field) {
  const src = path.join(srcDir, filename);
  if (fs.existsSync(src)) {
    const newFilename = `${seoPrefix}-${field}.webp`;
    const dest = path.join(__dirname, `../dist/assets/${newFilename}`);
    fs.copyFileSync(src, dest);
  }
};

    
const  buildAboutUsPage =  async function (
        distDir,
        cssDir,
        globalValues,
        navMenu,
        jsonLdString,
        linkOutsideNavMenu,
        firstPageName,
        firstPageNameActive,
        indexInterlinks,
        pages

    ){  
        const categoryMap = {
            'plumbing':        'Plumber',
            'electrician':     'Electrician',
            'roofing':         'Roofing Contractor',
            'concrete-contractor': 'Concrete Contractor',
            'hvac':            'Hvac Technician',
            'landscaping':     'Landscaper',
            'law-firm':      'Lawyer'
          };

        const businessType = slugify(globalValues.businessType);
        
        const category = categoryMap[businessType] || businessType;

        // Creating Section Content
        const seoPrefix = `${slugify(globalValues.businessName)}-${slugify(category)}-near-me-${slugify(globalValues.location)}`;

       
        
        const pageImageDirs = {
                aboutHero: path.join(predefinedImagesDir, businessType, `aboutUs/hero`),
                aboutSection2: path.join(predefinedImagesDir, businessType, `aboutUs/section2`),
                aboutSection4: path.join(predefinedImagesDir, businessType, `aboutUs/section4`)    
            };

        
        // Create About Us page from aboutUsTamplate.html & save in dist
        let aboutus = fs.readFileSync(path.join(__dirname, '../src/aboutUsTemplate.html'), 'utf-8');
        let aboutUsPageExists = fs.existsSync(path.join(distDir, '/index.html'), 'utf-8');
        

        if(!aboutUsPageExists){

            navMenu = navMenu.replace(/active/g, ''); 
            linkOutsideNavMenu = linkOutsideNavMenu.replace(/active/g, '');
            firstPageName = firstPageName.replace(/active/g, '');
            firstPageNameActive = firstPageNameActive.replace(/active/g, '');

            
            // === Copy hero images
            copyPageImage(pageImageDirs.aboutHero, seoPrefix, 'hero-mobile.webp',  'heroMobile');
            copyPageImage(pageImageDirs.aboutHero, seoPrefix, 'hero-tablet.webp',  'heroTablet');
            copyPageImage(pageImageDirs.aboutHero, seoPrefix, 'hero-desktop.webp', 'heroDesktop');
            copyPageImage(pageImageDirs.aboutHero, seoPrefix, 'hero-large.webp',   'heroLarge');

            // === Copy section2 images
            copyPageImage(pageImageDirs.aboutSection2, seoPrefix, 'section2-1.webp', 'section2Img1');
            copyPageImage(pageImageDirs.aboutSection2, seoPrefix, 'section2-2.webp', 'section2Img2');

            // === Copy section4 images
            copyPageImage(pageImageDirs.aboutSection4, seoPrefix, 'section4-1.webp', 'section4Img1');
            copyPageImage(pageImageDirs.aboutSection4, seoPrefix, 'section4-2.webp', 'section4Img2');

            
            
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
              
            aboutus = aboutus
                .replace(/{{JSON_LD_SCHEMA}}/g, jsonLdString)
                .replace(/{{FAVICON_PATH}}/g, globalValues.favicon)
                .replace(/{{LOGO_PATH}}/g, globalValues.logo)
                .replace(/{{LOGO_ALT}}/g, `Logo image of ${globalValues.businessName} in ${globalValues.location} - ${category} Near Me`)
                .replace(/{{LOGO_TITLE}}/g, `Logo image of ${globalValues.businessName} in ${globalValues.location} - ${category} Near Me`)
                .replace(/{{PAGE_TITLE}}/g, `${globalValues.businessName} in ${globalValues.location} - ${category} Near Me`)
                .replace(/{{META_DESCRIPTION}}/g, `We are ${globalValues.businessName} in ${globalValues.location}. Call us if you are looking for ${category} Near Me`)
                .replace(/{{BUSINESS_NAME}}/g, globalValues.businessName)
                .replace(/{{LOCATION}}/g, globalValues.location)
                .replace(/{{HERO_IMG_MOBILE}}/g, `assets/${seoPrefix}-heroMobile.webp`)
                .replace(/{{HERO_IMG_TABLET}}/g, `assets/${seoPrefix}-heroTablet.webp`)
                .replace(/{{HERO_IMG_DESKTOP}}/g, `assets/${seoPrefix}-heroDesktop.webp`)
                .replace(/{{HERO_IMG_LARGE}}/g, `assets/${seoPrefix}-heroLarge.webp`)
                .replace(/{{HERO_IMG_ALT}}/g, `${altTexts['hero-mobile']} - ${category} Near Me`)
                .replace(/{{HERO_IMG_TITLE}}/g,  `${altTexts['hero-mobile']} - ${category} Near Me`)
                .replace(/{{SECTION2_IMG1}}/g, `assets/${seoPrefix}-section2Img1.webp`)
                .replace(/{{SECTION2_IMG2}}/g, `assets/${seoPrefix}-section2Img2.webp`)
                .replace(/{{SECTION2_IMG_ALT1}}/g, `${altTexts['section2-1']} - ${category} Near Me`)
                .replace(/{{SECTION2_IMG_TITLE1}}/g, `${altTexts['section2-1']} - ${category} Near Me`)
                .replace(/{{SECTION2_IMG_ALT2}}/g, `${altTexts['section2-2']} - ${category} Near Me`)
                .replace(/{{SECTION2_IMG_TITLE2}}/g, `${altTexts['section2-2']} - ${category} Near Me`)
                .replace(/{{SECTION4_IMG1}}/g, `assets/${seoPrefix}-section4Img1.webp`)
                .replace(/{{SECTION4_IMG2}}/g, `assets/${seoPrefix}-section4Img2.webp`)
                .replace(/{{SECTION4_IMG_ALT1}}/g, `${altTexts['section4-1']} - ${category} Near Me`)
                .replace(/{{SECTION4_IMG_TITLE1}}/g, `${altTexts['section4-1']} - ${category} Near Me`)
                .replace(/{{SECTION4_IMG_ALT2}}/g, `${altTexts['section4-2']} - ${category} Near Me`)
                .replace(/{{SECTION4_IMG_TITLE2}}/g, `${altTexts['section4-2']} - ${category} Near Me`)
                .replace(/{{MAP_IMAGE}}/g, globalValues.mapImage || '')
                .replace(/{{MAP_ALT}}/g, `Google Map image of ${globalValues.businessName} in ${globalValues.location} - ${category} Near Me`)
                .replace(/{{MAP_TITLE}}/g, `Google Map image of ${globalValues.businessName} in ${globalValues.location} - ${category} Near Me`)    
                .replace(/{{SECTION1_H2}}/g, sectionsWithLinks.section1.heading)
                .replace(/{{SECTION1_H3}}/g, sectionsWithLinks.section1.subheading)
                .replace(/{{SECTION1_P1}}/g, sectionsWithLinks.section1.paragraphs[0])
                .replace(/{{SECTION1_P2}}/g, sectionsWithLinks.section1.paragraphs[1])
                .replace(/{{SECTION2_H2}}/g, sectionsWithLinks.section2.heading)
                .replace(/{{SECTION2_P1}}/g, sectionsWithLinks.section2.paragraphs[0])
                .replace(/{{SECTION2_P2}}/g, sectionsWithLinks.section2.paragraphs[1])
                .replace(/{{SECTION3_H2}}/g, sectionsWithLinks.section3.heading)
                .replace(/{{SECTION3_P1}}/g, sectionsWithLinks.section3.paragraphs[0])
                .replace(/{{SECTION3_P2}}/g, sectionsWithLinks.section3.paragraphs[1])
                .replace(/{{SECTION4_H2}}/g, sectionsWithLinks.section4.heading)
                .replace(/{{SECTION4_P1}}/g, sectionsWithLinks.section4.paragraphs[0])
                .replace(/{{SECTION4_P2}}/g, sectionsWithLinks.section4.paragraphs[1])
                .replace(/{{NEAR_ME_H2}}/g, sectionsWithLinks.section5.heading)
                .replace(/{{NEAR_ME_P1}}/g, sectionsWithLinks.section5.paragraphs[0])
                .replace(/{{NEAR_ME_P2}}/g, sectionsWithLinks.section5.paragraphs[1])
                .replace(/{{ADDRESS}}/g, globalValues.address)
                .replace(/{{EMAIL}}/g, globalValues.email)
                .replace(/{{HOURS_DAYS}}/g, getHoursDaysText(globalValues.is24Hours, globalValues.hours))
                .replace(/{{HOURS_TIME}}/g, getHoursTimeText(globalValues.is24Hours, globalValues.hours))
                .replace(/{{PHONE_RAW}}/g, formatPhoneForHref(globalValues.phone))
                .replace(/{{PHONE_DISPLAY}}/g, globalValues.phone)
                .replace(/{{CURRENT_YEAR}}/g, new Date().getFullYear())
                .replace(/{{FACEBOOK_URL}}/g, globalValues.facebookUrl)
                .replace(/{{TWITTER_URL}}/g, globalValues.twitterUrl)
                .replace(/{{PINTEREST_URL}}/g, globalValues.pinterestUrl)
                .replace(/{{YOUTUBE_URL}}/g, globalValues.youtubeUrl)
                .replace(/{{LINKEDIN_URL}}/g, globalValues.linkedinUrl)
                .replace(/{{DYNAMIC_NAV_MENU}}/g, navMenu)
                .replace(/{{FIRST_PAGE_NAME_ACTIVE}}/g, firstPageNameActive)
                .replace(/{{LINK_OUTSIDE_NAV_MENU}}/g, linkOutsideNavMenu)
                .replace(/{{FIRST_PAGE_NAME}}/g, firstPageName)
                .replace('</head>', `<link rel="stylesheet" href="./css/bootstrap.min.css">
                                    <link rel="stylesheet" href="./css/index.css"></head>`)
                .replace('</body>', `<script src="./js/bootstrap.bundle.min.js"></script>
                                     <script src="./js/index.js"></script>
                          </body>`);

                          
                          
                          const debugPath = path.join(__dirname, '../debug-about-us.html');
                          fs.writeFileSync(debugPath, aboutus);
                          
                    
                          

            fs.writeFileSync(path.join(distDir, `index.html`), aboutus);

            // === Auto-create index.css if it doesn't exist 
            const cssFilePath = path.join(__dirname, '../', 'src/css', `index.css`);

            // Create index.css in src/css for webpack use
            const fallbackStyle = path.join(__dirname, '../', 'src/css/style.css');
            fs.copyFileSync(fallbackStyle, cssFilePath);
           

            // Copy generated index.css to dist/css for dev use
            fs.copyFileSync(
                path.join(__dirname, '../', `src/css/index.css`),
                path.join(cssDir, `index.css`) // result = dist/css/index.css   
            );
            

            // === Create JS stub ( for prod, needed for Webpack build)
            const jsFilePath = path.join(__dirname, '../src/js', `index.js`);
            const jsContent = `
            // Auto-generated JS stub for index.js
            import '../css/bootstrap.min.css';
            import '../css/index.css';
            import './bootstrap.bundle.min.js';
            // Add your JS logic for index.js here
            `;
    
            if (!fs.existsSync(jsFilePath)) {
                // Create js file.js in src/js for webpack use
                fs.writeFileSync(jsFilePath, jsContent);
                
            } 

        }

    }

module.exports = { buildAboutUsPage };




