const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');
const { buildAltText } = require('./buildAltText');
const { buildNavMenu } = require('./buildNavMenu');
const { formatPhoneForHref } = require('./formatPhoneForHref');
const { injectIndexInterlinks } = require('./injectIndexInterlinks'); 
const { generateAboutUsContent } = require('./generateAboutUsContent');
const { getHoursTimeText } = require('./formatDaysAndHoursForDisplay');
const { escapeAttr, resolveThemeCss, buildYouTubeEmbedHtml } = require('./helpers');


const isDev = process.env.NODE_ENV !== 'production';
const basePath = '';


const predefinedImagesDir = path.join(__dirname, '../src/predefined-images');

function copyPageImage (srcDir, seoPrefix, filename, field, distDir) {
  const src = path.join(srcDir, filename);
  if (fs.existsSync(src)) {
    const newFilename = `${seoPrefix}-${field}.webp`;

    const assetsDir = path.join(distDir, 'assets');
    fs.mkdirSync(assetsDir, { recursive: true });
    
    const dest = path.join(assetsDir, newFilename);
    fs.copyFileSync(src, dest);
  }
};

    
const  buildAboutUsPage =  async function (
            distDir,
            cssDir,
            globalValues,
            jsonLdString,
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
            'law-firm':        'Lawyer',
            'junk-removal':    'junk removal'
          };

        const businessType = slugify(globalValues.businessType);
        
        const category = categoryMap[businessType] || businessType;

        // Creating Section Content

       // Near Me Term Logic
       const useNearMe = String(globalValues.useNearMe) === 'true';
        let nearMeTerm;
        
        if(useNearMe){
            nearMeTerm = "near me";
        } else{
            nearMeTerm = "";
        }
        

        // seoPrefix
        const seoPrefix = useNearMe
        ? `${slugify(globalValues.businessName)}-${slugify(category)}-${slugify(nearMeTerm)}-${slugify(globalValues.location)}`
        : `${slugify(globalValues.businessName)}-${slugify(category)}-${slugify(globalValues.location)}`;

        
        const pageImageDirs = {
                aboutHero: path.join(predefinedImagesDir, businessType, `aboutUs/hero`),
                aboutSection2: path.join(predefinedImagesDir, businessType, `aboutUs/section2`),
                aboutSection4: path.join(predefinedImagesDir, businessType, `aboutUs/section4`)    
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


            // ✅ Build & inject Services / Locations menus (and remove wrappers if empty)
            const context = 'aboutus';
            aboutus = buildNavMenu(aboutus, globalValues, pages, basePath, slugify(globalValues.location), globalValues.location, context);
 

            const aboutVideoHtml = buildYouTubeEmbedHtml(
                globalValues.youtubeVideoUrl,
                globalValues.businessName,
                globalValues.location
              );
              
              
            aboutus = aboutus
                .replace(/{{JSON_LD_SCHEMA}}/g, jsonLdString)
                .replace(/{{FAVICON_PATH}}/g, globalValues.favicon)
                .replace(/{{LOGO_PATH}}/g, globalValues.logo)
                .replace(/{{LOGO_ALT}}/g, `Logo image of ${globalValues.businessName} in ${globalValues.location} - ${category} ${nearMeTerm}`)
                .replace(/{{LOGO_TITLE}}/g, `Logo image of ${globalValues.businessName} in ${globalValues.location} - ${category} ${nearMeTerm}`)
                .replace(/{{LOGO_WIDTH}}/g, String(globalValues.logoWidth))
                .replace(/{{LOGO_HEIGHT}}/g, String(globalValues.logoHeight))
                .replace(/{{PAGE_TITLE}}/g, `${globalValues.businessName} in ${globalValues.location} - ${category} ${nearMeTerm}`)
                .replace(/{{META_DESCRIPTION}}/g, `We are ${globalValues.businessName} in ${globalValues.location}. Call us if you are looking for ${category} ${nearMeTerm}`)
                .replace(/{{BUSINESS_NAME}}/g, globalValues.businessName.toUpperCase())
                .replace(/{{LOCATION}}/g, globalValues.location)
                .replace(/{{HERO_IMG_MOBILE}}/g, `assets/${seoPrefix}-heroMobile.webp`)
                .replace(/{{HERO_IMG_TABLET}}/g, `assets/${seoPrefix}-heroTablet.webp`)
                .replace(/{{HERO_IMG_DESKTOP}}/g, `assets/${seoPrefix}-heroDesktop.webp`)
                .replace(/{{HERO_IMG_LARGE}}/g, `assets/${seoPrefix}-heroLarge.webp`)
                .replace(/{{HERO_IMG_ALT}}/g, `${altTexts['hero-mobile']} - ${category} ${nearMeTerm}`)
                .replace(/{{HERO_IMG_TITLE}}/g,  `${altTexts['hero-mobile']} - ${category} ${nearMeTerm}`)
                .replace(/{{SECTION2_IMG1}}/g, `assets/${seoPrefix}-section2Img1.webp`)
                .replace(/{{SECTION2_IMG2}}/g, `assets/${seoPrefix}-section2Img2.webp`)
                .replace(/{{SECTION2_IMG_ALT1}}/g, `${altTexts['section2-1']} - ${category} ${nearMeTerm}`)
                .replace(/{{SECTION2_IMG_TITLE1}}/g, `${altTexts['section2-1']} - ${category} ${nearMeTerm}`)
                .replace(/{{SECTION2_IMG_ALT2}}/g, `${altTexts['section2-2']} - ${category} ${nearMeTerm}`)
                .replace(/{{SECTION2_IMG_TITLE2}}/g, `${altTexts['section2-2']} - ${category} ${nearMeTerm}`)
                .replace(/{{SECTION4_IMG1}}/g, `assets/${seoPrefix}-section4Img1.webp`)
                .replace(/{{SECTION4_IMG2}}/g, `assets/${seoPrefix}-section4Img2.webp`)
                .replace(/{{SECTION4_IMG_ALT1}}/g, `${altTexts['section4-1']} - ${category} ${nearMeTerm}`)
                .replace(/{{SECTION4_IMG_TITLE1}}/g, `${altTexts['section4-1']} - ${category} ${nearMeTerm}`)
                .replace(/{{SECTION4_IMG_ALT2}}/g, `${altTexts['section4-2']} - ${category} ${nearMeTerm}`)
                .replace(/{{SECTION4_IMG_TITLE2}}/g, `${altTexts['section4-2']} - ${category} ${nearMeTerm}`)
                .replace(/{{MAP_IFRAME_SRC}}/g, globalValues.mapEmbed || '')
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
                .replace(/{{FACEBOOK_URL}}/g, globalValues.facebookUrl)
                .replace(/{{TWITTER_URL}}/g, globalValues.twitterUrl)
                .replace(/{{PINTEREST_URL}}/g, globalValues.pinterestUrl)
                .replace(/{{YOUTUBE_URL}}/g, globalValues.youtubeUrl)
                .replace(/{{LINKEDIN_URL}}/g, globalValues.linkedinUrl)
                .replace(/{{ABOUT_VIDEO}}/g, aboutVideoHtml)  
                .replace('</head>', `<link rel="stylesheet" href="./css/bootstrap.min.css">
                                    <link rel="stylesheet" href="./css/index.css"></head>`)
                .replace('</body>', `<script src="./js/bootstrap.bundle.min.js"></script>
                                     <script src="./js/index.js"></script>
                          </body>`);

            
                // If there's no video HTML, remove the entire YouTube container
                if (!aboutVideoHtml) {
                    aboutus = aboutus.replace(
                    /<div class="container about-video-section[^>]*>[\s\S]*?<\/div>\s*/i,
                    ''
                    );
                }
  
            
            
            // Normalize checkbox -> boolean
            const normalizeBool = (v) => {
                if (typeof v === 'boolean') return v;
                if (typeof v === 'number') return v === 1;
                if (!v) return false;
                const s = String(v).toLowerCase();
                return ['true','1','on','yes'].includes(s);
            };
  


            
            // === OPTIONAL Contact Form injection (replaces {{FORM}}) ===
            const hasEmail = !!(globalValues.email && /\S+@\S+/.test(globalValues.email.trim()));
            const showAboutForm = normalizeBool(globalValues.showAboutForm);

            // We’ll reuse the exact form markup from the template you previously had,
            // but now we inject it only when email is present.
            // If you prefer, you can put this string in a separate partial and fs.readFileSync it.
            const contactFormHtml = `
            <section class="form-container">
            <div class="bg-secondary-subtle">
                <form class="contact-form" id="contactForm" action="mailto:${globalValues.email}" method="POST" enctype="text/plain">
                    <h2>Get In Touch</h2>
                    <div class="form-group">
                        <label for="name">Full Name</label>
                        <input type="text" id="name" name="name" required>
                    </div>
                    <div class="form-group">
                        <label for="email">Email Address</label>
                        <input type="email" id="email" name="email" required>
                    </div>
                    <div class="form-group">
                        <label for="message">Message</label>
                        <textarea id="message" name="message" rows="5" required></textarea>
                    </div>
                    <button type="submit" class="submit-btn">
                        <span class="btn-text">Send Message</span>
                        <svg class="btn-icon" width="20" height="20" viewBox="0 0 24 24" fill="none"
                            xmlns="http://www.w3.org/2000/svg">
                            <path d="M22 2L11 13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                            <path d="M22 2L15 22L11 13L2 9L22 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </form>
            </div>
            </section>
            `;


            // Replace the placeholder with the form only if BOTH are true
            if (hasEmail && showAboutForm) {
                aboutus = aboutus.replace(/<section>\s*{{FORM}}\s*<\/section>/i, contactFormHtml);
            } else {
                aboutus = aboutus.replace(/<section>\s*{{FORM}}\s*<\/section>\s*/i, '');
            }


          
            // Write the About Us Page file (index.html)
            fs.writeFileSync(path.join(distDir, `index.html`), aboutus);

            // === Destination: Auto-create index.css if it doesn't exist 
            const cssFilePath = path.join(__dirname, '../', 'src/css', `index.css`);

            // Chosen theme key from the form (default 'style')
            const chosenKey = (globalValues.styleKey || 'style');
            console.log(`chosenKey: ${chosenKey}`);

            // Create index.css in src/css for webpack use
            // Source: selected theme
            const srcCss = resolveThemeCss(chosenKey);
            console.log(`srcCss: ${srcCss}`);
            fs.copyFileSync(srcCss, cssFilePath);
           

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




