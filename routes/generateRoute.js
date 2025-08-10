// === Required Modules and Setup ===
const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { cleanDevFolders, validateGlobalFields } = require('../utils/helpers');
const isDev = process.env.NODE_ENV !== 'production';
const basePath = isDev ? '/dist/' : '/';


// === Directory Setup ===
const srcJsDir = path.join(__dirname, '../src/js');
const srcCssDir = path.join(__dirname, '../src/css');
const tempUploadDir = path.join(__dirname, '../public/uploads');
const distDir = path.join(__dirname, '../dist');
const assetsDir = path.join(distDir, 'assets');
const cssDir = path.join(distDir, 'css');
const jsDir = path.join(distDir, 'js');


// === Multer Setup
const upload = multer({ dest: tempUploadDir });


// === Custom Utility Functions ===
const {
    generateMetadata,
    getCoordinatesFromAddress,
    generateReview,
    normalizeText,
    smartTitleCase,
    formatPhoneForHref,
    formatCityState,
    slugify,
    buildAccessibilityPage,
    validateEachPageInputs,
    buildSchema,
    buildTermsOfUsePage,
    buildPrivacyPolicyPage,
    buildAboutUsPage,
    buildAltText,
    buildNavMenu,
    copyAllPredefinedImages,
    buildInterlinksMap,
    generatePagesContent,
    injectPagesInterlinks,
    getHoursDaysText,
    getHoursTimeText
  } = require('../utils/pageGenerator');
 

// === Generate Route: POST (handles form submission) ===
router.post('/generate', upload.any(), async (req, res) => {
    const pages = req.body.pages;
    const global = req.body.global;
   
  
    if (isDev) {
      // Clean js and css file from src (except bootstrap and style.css) when running dev
      cleanDevFolders({
        srcJsDir,
        srcCssDir,
        distDir,
        assetsDir,
        cssDir,
        jsDir,
        tempUploadDir
      });
      
    
      const allowedFaviconTypes = [
        'image/vnd.microsoft.icon',  // .ico
        'image/x-icon',              // .ico (alternative)
        'image/png',
        'image/svg+xml',
        'image/jpeg',
        'image/jpg'
      ];
    
      
    
      if (!pages || typeof pages !== 'object') {
          return res.status(400).send('❌ No pages submitted.');
      }
  

      // Validate global text fields from req.body
      if(!validateGlobalFields(global, res)) return;

  
  
      // ✅ Initialize uploadedImages early
      const uploadedImages = { global: {} };
      const files = req.files;
        

      for (const file of files) {
          const globalMatch = file.fieldname.match(/global\[(.*?)\]/);
          const ext = path.extname(file.originalname);


          const businessSlug = slugify(global.businessName);
          const keywordSlug = slugify(pages[0]?.keyword || '');
          const locationSlug = slugify(global.location || '');
          const seoPrefix = `${businessSlug}-${keywordSlug}-${locationSlug}`;


          if(globalMatch){
              const field = globalMatch[1];

              if (field === 'favicon') {
                if (!allowedFaviconTypes.includes(file.mimetype)) {
                    return res.status(400).send('❌ Invalid favicon file type. Allowed types: .ico, .png, .svg, .jpg');
                }
              }      

              const newFilename = `${seoPrefix}-${field}${ext}`;
              const destPath = path.join(assetsDir, newFilename);
              fs.renameSync(file.path, destPath);
              uploadedImages.global[field] = `assets/${newFilename}`;
          }
      }
      
  
      // Check required global files
      if (
        !uploadedImages.global.logo ||
        !uploadedImages.global.favicon ||
        !uploadedImages.global.mapImage
      ) {
        return res.status(400).send('❌ Global image uploads are missing.');
      }


      
      // Validate Each Page inputs
      validateEachPageInputs(pages, res);
   
  

      // Build interlink map 
      const { interlinkMap } = await buildInterlinksMap(pages);
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


      const globalValues = {
        businessName: normalizeText(global.businessName?.trim()),
        domain: global.domain?.trim(),
        businessType: global.businessType?.trim(),
        email: normalizeText(global.email?.trim()),
        phone: global.phone?.trim(),
        address: normalizeText(global.address?.trim()),
        location: formatCityState(smartTitleCase(normalizeText(global.location?.trim()))),
        is24Hours: global.is24Hours,               // ✅ new: store 24hr toggle (may be 'on' or undefined)
        hours: global.hours || {}, 
        facebookUrl: global.facebookUrl?.trim() || '#',
        twitterUrl: global.twitterUrl?.trim() || '#',
        pinterestUrl: global.pinterestUrl?.trim() || '#',
        youtubeUrl: global.youtubeUrl?.trim() || '#',
        linkedinUrl: global.linkedinUrl?.trim() || '#',
        instagramUrl: global.instagramUrl?.trim() || '#',
        logo: uploadedImages.global.logo || '',
        favicon: uploadedImages.global.favicon || '',
        mapImage: uploadedImages.global.mapImage || ''
      };


      // Copy all predefined images to dist/assets and track them 
      const seenImageSets = new Set();

      for (let i = 0; i < pages.length; i++) {
        const setIndex = i % 10;
        if (seenImageSets.has(setIndex)) continue;

        copyAllPredefinedImages({
          globalValues,
          uploadedImages,
          keyword: slugify(pages[i].keyword),
          index: i,
          totalPages: pages.length
        });

        seenImageSets.add(setIndex);
      }



    
      // Main loop that creates html pages from the template file
      for (const [index, page] of Object.entries(pages)) {
        const filename = slugify(page.filename);
        const templatePath = path.join(__dirname, '../src/template.html');
        let template = fs.readFileSync(templatePath, 'utf-8');
        const locationSlug = slugify(global.location || '');


        // Copy predefined images into dist/assets and track them 
        copyAllPredefinedImages({
          globalValues,
          uploadedImages,
          keyword: slugify(page.keyword || ''),
          index: Number(index) // pass the index so we can cycle with % 4,

        });



        // ===  NavMenu Creation =====
        const navMenuObject = buildNavMenu(pages, basePath, locationSlug, filename);    
        let { linkOutsideNavMenu, firstPageName, firstPageNameActive } = navMenuObject;
        const { navMenu } = navMenuObject;
    
      
        // Build Alt descrptions in object format
        const altTexts =  buildAltText(globalValues, Number(index));

       
        page.filename = normalizeText(page.filename);
        page.keyword = normalizeText(page.keyword);
    
    
        const meta        = await generateMetadata(globalValues.businessName, page.keyword, globalValues.location, formatCityState);
        const coordinates = await getCoordinatesFromAddress(globalValues.address);
        const reviews     = await generateReview(globalValues.businessName);


        // Building Schema
        const jsonLdString = buildSchema(globalValues, uploadedImages, index, page, coordinates, reviews);
      

        //  Insert Interlinks to Pages Content 
        const pagesInterlinks = interlinkMap[page.slug] || [];


        // Generate Page Sections Content
        const sections = await generatePagesContent(globalValues, page, pagesInterlinks);
        const sectionsWithLinks = injectPagesInterlinks(globalValues, pages, page, pagesInterlinks, sections);
      

        template = template
          .replace(/{{JSON_LD_SCHEMA}}/g, jsonLdString)
          .replace(/{{FAVICON_PATH}}/g, globalValues.favicon)
          .replace(/{{LOGO_PATH}}/g, globalValues.logo)
          .replace(/{{LOGO_ALT}}/g, `Logo image of ${globalValues.businessName} in ${globalValues.location} - ${page.filename}`)
          .replace(/{{LOGO_TITLE}}/g, `Logo image of ${globalValues.businessName} in ${globalValues.location} - ${page.filename}`)
          .replace(/{{PAGE_TITLE}}/g, meta.title)
          .replace(/{{META_DESCRIPTION}}/g, meta.description)
          .replace(/{{BUSINESS_NAME}}/g, globalValues.businessName)
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
          .replace(/{{MAP_IMAGE}}/g, globalValues.mapImage || '')
          .replace(/{{MAP_ALT}}/g, `Google Map image of ${globalValues.businessName} in ${globalValues.location} - ${page.filename}`)
          .replace(/{{MAP_TITLE}}/g, `Google Map image of ${globalValues.businessName} in ${globalValues.location} - ${page.filename}`)
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
          .replace(/{{LOCATION_AREA}}/g, globalValues.location)
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
          .replace(/{{FIRST_PAGE_NAME}}/g, firstPageName);
    
  
  
          // Remove old hashed JS from dist
          const files = fs.readdirSync(jsDir);
          for (const file of files) {
            if (/^[\w-]+\.[a-f0-9]{20}\.js$/.test(file)) {
              fs.unlinkSync(path.join(jsDir, file));
            }
          }
        
  
          // Remove old hashed CSS from dist
          const cssFiles = fs.readdirSync(cssDir);
          for (const file of cssFiles) {
            if (/^[\w-]+\.[a-f0-9]{20}\.css$/.test(file)) {
              fs.unlinkSync(path.join(cssDir, file));
            }
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
          fs.writeFileSync(path.join(distDir, `${filename}-${locationSlug}.html`), template);
  
  
  
          // Create accessibility.html, & save in dist
          buildAccessibilityPage(
                                  distDir,
                                  cssDir,
                                  globalValues,
                                  navMenu,
                                  linkOutsideNavMenu,
                                  firstPageName,
                                  firstPageNameActive
                                );
  
  
          // Create terms-of-use.html, & save in dist
          buildTermsOfUsePage(
                              distDir,
                              cssDir,
                              globalValues,
                              navMenu,
                              page,
                              linkOutsideNavMenu,
                              firstPageName,
                              firstPageNameActive
                             );
  
  
          // Create about-us.html, & save in dist
          await buildAboutUsPage(
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
                              );
  

         
          // Create privacy-policy.html, & save in dist
          buildPrivacyPolicyPage(
                                  distDir, 
                                  cssDir, 
                                  globalValues, 
                                  navMenu,
                                  page, 
                                  firstPageNameActive, 
                                  linkOutsideNavMenu, 
                                  firstPageName
                                );

         
          // === Auto-create CSS file.css if it doesn't exist & save in src/css
          const cssFilePath = path.join(__dirname, '../src/css', `${filename}.css`);
    
          if (isDev && !fs.existsSync(cssFilePath)) {
            // Create CSS file.css in src/css for webpack use
            const fallbackStyle = path.join(__dirname, '../src/css/style.css');
            fs.copyFileSync(fallbackStyle, cssFilePath);
           
  
  
            // Copy Bootstrap CSS to dist for dev use. It only needs to be copied 1 time to dist
            if(!fs.existsSync(path.join(cssDir, 'bootstrap.min.css'))){
              fs.copyFileSync(
                path.join(__dirname, '../src/css/bootstrap.min.css'),
                path.join(cssDir, 'bootstrap.min.css') // result = dist/css/bootstrap.min.css
              );
            }
    
    
            // Copy CSS generated file.css to dist/css for dev use
            fs.copyFileSync(
              path.join(__dirname, `../src/css/${filename}.css`),
              path.join(cssDir, `${filename}.css`) // result = dist/css/{filename}.css
            );
    
          }
  
  
  
          // === Auto-create JS stub (dev or prod, needed for Webpack build)
          const jsFilePath = path.join(__dirname, '../src/js', `${filename}-${slugify(globalValues.location)}.js`);
          const jsContent = `
          // Auto-generated JS stub for ${filename}
          import '../css/bootstrap.min.css';
          import '../css/${filename}.css';
          import './bootstrap.bundle.min.js';
          // Add your JS logic for ${filename} here
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
    
    
      // === Generate Success Response with Links to Pages ===
      const links = Object.entries(pages).map(([_, page]) => {
        const filename = `${slugify(page.filename.trim())}-${slugify(normalizeText(globalValues.location))}`;
        return `<li><a href="${basePath}${filename}.html" target="_blank">${filename}.html</a></li>`;
      }).join('');
    
      res.send(`
        <html>
          <head>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"/>
          </head>
          <body>
            <div class="container">
              <h2 class="mt-5">✅ Pages generated but not minified yet!</h2>
              <ul>${links}</ul>
              <a href="/" class="btn btn-warning mt-3">Go Back</a>
              <a href="/production" class="btn btn-primary mt-3 ">Run Production</a>
            </div>
          </body>
        </html>
      `);
    }
    
});

module.exports = router;
