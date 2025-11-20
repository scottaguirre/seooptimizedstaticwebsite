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
  cleanDevFolders,
  resolveThemeCss,
  jsonValidationError,
  validateGlobalFields,
  moveOrCopyThenDelete,
  validateEachPageInputs,
  validateAndNormalizeLocationPages
 } = require('../utils/helpers');


const isDev = process.env.NODE_ENV !== 'production';
const basePath = '';


// === Directory Setup ===
const tempUploadDir = path.join(__dirname, '../public/uploads');
const srcCssDir = path.join(__dirname, '../src/css');
const srcJsDir = path.join(__dirname, '../src/js');
const baseDistDir = path.join(__dirname, '../dist');



// Helper to build per-user dist paths
function getUserDirs(userId) {
  const safeId = String(userId);
  const distDir = path.join(baseDistDir, `user_${safeId}`);
  const assetsDir = path.join(distDir, 'assets');
  const cssDir = path.join(distDir, 'css');
  const jsDir = path.join(distDir, 'js');
  return { distDir, assetsDir, cssDir, jsDir };
}



// === Multer Setup
const upload = multer({ dest: tempUploadDir });


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
    const { distDir, assetsDir, cssDir, jsDir } = getUserDirs(userId);

    // Make sure this user's folders exist
    await fs.promises.mkdir(distDir, { recursive: true });
    await Promise.all([
      fs.promises.mkdir(assetsDir, { recursive: true }),
      fs.promises.mkdir(cssDir, { recursive: true }),
      fs.promises.mkdir(jsDir, { recursive: true })
    ]);


    // Clean js and css file from src (except bootstrap and style.css) when running dev
    if (isDev) {
      cleanDevFolders({
        srcJsDir,
        srcCssDir,
        distDir,
        assetsDir,
        cssDir,
        jsDir,
        tempUploadDir
      });

 

      // Make sure at least one page is submitted and it's subitted the right way
      if (!pages || typeof pages !== 'object' || Object.keys(pages).length === 0) {
        return jsonValidationError(res, 400, '❌ No pages submitted.');
      }

  

      // Validate global text fields from req.body
      const validGlobal = validateGlobalFields(global);
      if (!validGlobal.ok) {
        return jsonValidationError(res, 400, validGlobal.error, validGlobal.fields);
      }

  
  
      // ✅ Initialize uploadedImages early
      const uploadedImages = { global: {} };
      const files = req.files;

      

      for (const file of files) {
        const globalMatch = file.fieldname.match(/global\[(.*?)\]/);
        const ext = path.extname(file.originalname);

        const businessSlug = slugify(global.businessName);
        const keywordSlug = slugify(pages[0]?.filename || '');
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
        const fields = [];
        if (!uploadedImages.global.logo)     fields.push({ name: 'global[logo]', message: 'Logo is required' });
        
        return jsonValidationError(res, 400, '❌ Global image uploads are missing.', fields);
      }
      
  
      
      // Validate Each Page inputs
      const validPages = validateEachPageInputs(pages);
      if (!validPages.ok) {
        return jsonValidationError(res, 400, validPages.error, validPages.fields);
      }
  

      
      // Near Me Logic
      // after you’ve parsed req.body and before you build/normalize `globalValues`:
      const rawUseNearMe = req.body.global?.useNearMe ?? req.body.global?.useNearMe ?? req.body['global[useNearMe]'];
     

      
      // LOCATION PAGES: read array from inputs named global[locationPages][]
      const wantsLocationPages = truthy(global.addLocations);
      const { ok: locOK, locations, fields: locFields, error: locError } =
        validateAndNormalizeLocationPages(global.locationPages, global.addLocations);
      if (!locOK) return jsonValidationError(res, 400, locError, locFields);
        


      const globalValues = {
        
        showAboutForm,
        wantsLocationPages,    // true/false
        locationPages: locations,
        hours: global.hours || {},
        styleKey: global.styleKey,
        is24Hours: global.is24Hours,    // ✅ new: store 24hr toggle (may be 'on' or undefined)
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

      // the two sizes we need
      
      if(globalValues.logoType === 'square'){
        globalValues.logoWidth  = 100;
        globalValues.logoHeight = 100;
      } else {
        globalValues.logoWidth  = 130;
        globalValues.logoHeight = 100;
      }

      
      // Build interlink map 
      // AFTER you’ve validated pages & locations and built globalValues
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
      globalValues.mapEmbed = await googleMap(globalValues.address);;

      // Used to copy images inside the main loop
      const imageContext = "imageServicePages";

    
      // Main loop that creates html pages from the template file
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
          index: Number(index), // pass the index so we can cycle with % 4
          imageContext
        });


      

        // Build Alt descrptions in object format
        const altTexts =  buildAltText(globalValues, Number(index));

       
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
          .replace(/{{PAGE_TITLE}}/g, meta.title)
          .replace(/{{META_DESCRIPTION}}/g, meta.description)
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
          .replace(/{{FACEBOOK_URL}}/g, globalValues.facebookUrl)
          .replace(/{{TWITTER_URL}}/g, globalValues.twitterUrl)
          .replace(/{{PINTEREST_URL}}/g, globalValues.pinterestUrl)
          .replace(/{{YOUTUBE_URL}}/g, globalValues.youtubeUrl)
          .replace(/{{LINKEDIN_URL}}/g, globalValues.linkedinUrl);

           // === Remove the email line + <hr> when email is empty ===
           const emailVal = (globalValues.email || '').trim();
           if (!emailVal) {
               // Remove: <p> {{EMAIL or undefined or empty}} </p> + optional <hr...>
               template = template.replace(
                   /<p[^>]*>\s*(?:{{EMAIL}}|undefined|&nbsp;|\s)*<\/p>\s*(?:<hr[^>]*>\s*)?/gi,
                   ''
               );
           }

        
  
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
  
  

         
          // === Auto-create CSS file.css if it doesn't exist & save in src/css
          const destCss = path.join(__dirname, '../src/css', `${filename}.css`);
    
          if (isDev && !fs.existsSync(destCss)) {
            // Create CSS file.css in src/css for webpack use
            const styleKey = (globalValues.styleKey || 'style');
            const srcCssTheme = resolveThemeCss(styleKey);


            fs.copyFileSync(srcCssTheme, destCss);
           
  
  
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



      // Create about-us.html, & save in dist
      await buildAboutUsPage(
              distDir,
              cssDir,
              globalValues,
              globalValues.jsonLdString,
              indexInterlinks,
              pages 
      );




      // Create privacy-policy.html, & save in dist
      buildPrivacyPolicyPage(
              distDir, 
              cssDir, 
              globalValues, 
              pages
      );



      // Create terms-of-use.html, & save in dist
      buildTermsOfUsePage(
              distDir,
              cssDir,
              globalValues,
              pages
      );



      // Create accessibility.html, & save in dist
      buildAccessibilityPage(
              distDir,
              cssDir,
              globalValues,
              pages
      );



      // Create location pages
      await buildLocationPages(
              distDir,
              cssDir,
              globalValues,
              pages,           // ⬅️ pass pages so Services dropdown can be built
              uploadedImages,
              interlinkMap
      );
    
    


      // Register this build so /export-wp can convert THIS exact output
      const buildId = createBuildRecord(distDir, {
        businessName: globalValues?.businessName || 'Site',
        location:     globalValues?.location || '',
      });


    
      return res.send(`
        <html>
          <head>
            <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"/>
            <style>
              
              .container {
                width: 90%;
                margin: auto;
                text-align: center;
                padding-top: 100px;
              }

              .index-page {
                text-decoration: none;
                font-size: 20px;
                color: darkgreen;
              }

              li{
                list-style-type: none;
              }

              h2 {
                margin-bottom:50px;
              }
              
              ul {
                margin-bottom: 50px;
              }

            </style>
          </head>
          <body>
            <div class="container">
           
              <h2>Visit website but is not minified yet!</h2>
              <ul>
                <li>
                  <a href="./dist/user_${userId}" class="index-page" target="_blank"> Click Here to Visit Website</a>
                </li>
              </ul>
           
              <a href="/" class="btn btn-warning mt-3">Go Back</a>
              <a href="/production" class="btn btn-primary mt-3 ">Run Production</a>
              <a href="/export-wp-theme" class="btn btn-success mt-3 ">Convert into Wordpress</a>
              
          
            </div>
          </body>
        </html>
      `);
     } 

  } catch (err) {
    console.error('Error during /generate:', err);
    return jsonValidationError(res, 500, 'Generation failed.');
  } finally {
    // delete any temp files that weren’t moved (or if an error happened)
    await Promise.allSettled(tempFiles.map(p => fsp.unlink(p).catch(() => {})));
  }
    
});

module.exports = router;
