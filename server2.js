// === Required Modules and Setup ===
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { OpenAI } = require('openai');
require('dotenv').config();
const { exec } = require('child_process');
const { zip } = require('zip-a-folder');

// === Custom Utility Functions ===
const {
  generateMetadata,
  generateTaglineFromHeading,
  generateSection1Content,
  generateSection2Content,
  generateSection3Content,
  generateSection4Content,
  generateServiceAreaContent,
  getCoordinatesFromAddress,
  generateReview,
  normalizeText,
  smartTitleCase,
  formatPhoneForHref,
  formatCityState,
  slugify,
  buildAltAttribute,
  formatCityForSchema,
  replaceInProd
} = require('./utils/pageGenerator');



const app = express();
const PORT = 3000;
const isDev = process.env.NODE_ENV !== 'production';
const basePath = isDev ? '/dist/' : '/';



// === Directory Setup ===
const tempUploadDir = path.join(__dirname, 'public/uploads');
const distDir = path.join(__dirname, 'dist');
const assetsDir = path.join(distDir, 'assets');
const cssDir = path.join(distDir, 'css');
const jsDir = path.join(distDir, 'js');



// === Express Middleware ===
app.use(express.static('public'));
app.use('/dist', express.static(distDir));
app.use(express.urlencoded({ extended: true }));
const upload = multer({ dest: tempUploadDir });



// === Route: GET / (serves the form) ===
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/views/form.html'));
});



// === Route: POST /generate (handles form submission) ===
app.post('/generate', upload.any(), async (req, res) => {
  const pages = req.body.pages;
  const global = req.body.global;

  if (isDev) {
    // === Clean src/js/ except bootstrap.bundle.min.js (only in dev) ===
    // === Utility to Recursively Clean a Directory ===
    function cleanDirectory(dirPath) {
      if (fs.existsSync(dirPath)) {
        fs.readdirSync(dirPath).forEach(file => {
          const filePath = path.join(dirPath, file);
          if (fs.lstatSync(filePath).isDirectory()) {
            cleanDirectory(filePath);
            fs.rmdirSync(filePath);
          } else {
            fs.unlinkSync(filePath);
          }
        });
      }
    }
  
  
    // === Clean src/js/ except style.css and bootstrap.bundle.min.js ===
    const srcJsDir = path.join(__dirname, 'src/js');
    const keepJs = ['bootstrap.bundle.min.js'];
  
    fs.readdirSync(srcJsDir).forEach(file => {
      if (file.endsWith('.js') && !keepJs.includes(file)) {
        fs.unlinkSync(path.join(srcJsDir, file));
        console.log(`🧹 Deleted old JS: ${file}`);
      }
    });
  
    // === Clean src/css/ except style.css and bootstrap.min.css ===
    const srcCssDir = path.join(__dirname, 'src/css');
    const keepCss = ['style.css', 'bootstrap.min.css'];
  
    fs.readdirSync(srcCssDir).forEach(file => {
      if (file.endsWith('.css') && !keepCss.includes(file)) {
        fs.unlinkSync(path.join(srcCssDir, file));
        console.log(`🧹 Deleted old CSS: ${file}`);
      }
    });
  
    // Clean dist/ directories
    [distDir, assetsDir, cssDir, jsDir].forEach(cleanDirectory);
    [tempUploadDir, distDir, assetsDir, cssDir, jsDir].forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
  

    // Validate global fields
    if (!global.businessName?.trim() || !global.domain?.trim()) {
      return res.status(400).send('❌ Global fields "business name" and "domain" are required.');
    }
  
  
    // Validate each page
    for (const [index, page] of Object.entries(pages)) {
      const requiredFields = [
        'filename', 'location', 'keyword', 'phone', 'email',
        'heroHeading', 'section1H2', 'section2H2', 'section3H2', 'section4H2',
        'address', 'hoursDays', 'hoursTime'
      ];
  
      const missing = requiredFields.filter(field => !page[field]?.trim());
  
      if (missing.length > 0) {
        return res.status(400).send(`❌ Page ${parseInt(index) + 1} is missing required fields: ${missing.join(', ')}`);
      }
    }
  
  
    // Build a file map to validate per page
    const fileMap = {};
    for (const file of req.files) {
      const match = file.fieldname.match(/pages\[(\d+)\]\[(.*?)\]/);
      if (match) {
        const [_, index, field] = match;
        fileMap[index] ||= {};
        fileMap[index][field] = file;
      }
    }
  

    // Required file fields per page
    const requiredFileFields = [
      'heroLarge',
      'section2Img1',
      'section2Img2',
      'section4Img1',
      'section4Img2',
      'mapImage'
    ];
  
  
    // Validate each page has required files
    for (const [index, page] of Object.entries(pages)) {
      const filesForPage = fileMap[index] || {};
      const missingFiles = requiredFileFields.filter(field => !filesForPage[field]);
  
      if (missingFiles.length > 0) {
        return res.status(400).send(`❌ Page ${parseInt(index) + 1} is missing image uploads: ${missingFiles.join(', ')}`);
      }
  
      const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
      const invalidFiles = Object.entries(filesForPage)
      .filter(([_, file]) => !allowedTypes.includes(file.mimetype));
  
      if (invalidFiles.length > 0) {
        const badFields = invalidFiles.map(([field]) => field).join(', ');
        return res.status(400).send(`❌ Page ${parseInt(index) + 1} has invalid image types for: ${badFields}`);
      }
    }
  
  
  
    const uploadedImages = { global: {} };
    const imageCounter = {};
    const files = req.files;
  
  
    for (const file of files) {
      const globalMatch = file.fieldname.match(/global\[(.*?)\]/);
      const pageMatch = file.fieldname.match(/pages\[(\d+)\]\[(.*?)\]/);
      const ext = path.extname(file.originalname);
  
      if (globalMatch) {
        const field = globalMatch[1];
  
        if (field === 'favicon') {
          if (!allowedFaviconTypes.includes(file.mimetype)) {
            return res.status(400).send('❌ Invalid favicon file type. Allowed types: .ico, .png, .svg, .jpg');
          }
        }      
  
        const newFilename = `global-${field}${ext}`;
        const destPath = path.join(assetsDir, newFilename);
        fs.renameSync(file.path, destPath);
        uploadedImages.global[field] = `assets/${newFilename}`;
      } else if (pageMatch) {
        const [_, pageIndex, field] = pageMatch;
        const page = pages[pageIndex];
        const keywordSlug = slugify(page?.keyword || `page${pageIndex}`);
        const locationSlug = slugify(page?.location || '');
        const baseName = `${keywordSlug}-${locationSlug}`;
  
        uploadedImages[pageIndex] ||= {};
        imageCounter[pageIndex] ||= {};
        imageCounter[pageIndex][field] = (imageCounter[pageIndex][field] || 0) + 1;
  
        const originalPath = file.path;
  
        if (field === 'heroLarge') {
          const sizes = {
            heroLarge: 1366,
            heroDesktop: 1250,
            heroTablet: 750,
            heroMobile: 600
          };
  
          for (const [key, width] of Object.entries(sizes)) {
            const newFilename = `${baseName}-${key}${ext}`;
            const destPath = path.join(assetsDir, newFilename);
            await sharp(originalPath).resize({ width }).toFile(destPath);
            uploadedImages[pageIndex][key] = `assets/${newFilename}`;
          }
  
          fs.unlinkSync(originalPath);
        } else {
          const suffix = imageCounter[pageIndex][field] > 1 ? `-${imageCounter[pageIndex][field]}` : '';
          const newFilename = `${baseName}-${field}${suffix}${ext}`;
          const destPath = path.join(assetsDir, newFilename);
          fs.renameSync(file.path, destPath);
          uploadedImages[pageIndex][field] = `assets/${newFilename}`;
        }
      }
    }
  
  
    const globalValues = {
      businessName: global.businessName?.trim(),
      domain: global.domain?.trim(),
      facebookUrl: global.facebookUrl?.trim() || '#',
      twitterUrl: global.twitterUrl?.trim() || '#',
      pinterestUrl: global.pinterestUrl?.trim() || '#',
      youtubeUrl: global.youtubeUrl?.trim() || '#',
      logo: uploadedImages.global.logo || '',
      favicon: uploadedImages.global.favicon || ''
    };
  
  
  
    const locationLinks = Object.entries(pages).map(([_, p]) => {
      const slug = slugify(p.filename.trim());
      return `<p>Location <a href="${slug}.html">${formatCityState(p.location)}</a></p>`;
    });
  
    const half = Math.ceil(locationLinks.length / 2);
    const locationListLeft = locationLinks.slice(0, half).join('');
    const locationListRight = locationLinks.slice(half).join('');
  
  
  
    for (const [index, page] of Object.entries(pages)) {
      const filename = slugify(page.filename);
      const templatePath = path.join(__dirname, 'src/template.html');
      let template = fs.readFileSync(templatePath, 'utf-8');
  
  
      const navMenu = Object.entries(pages).map(([i, p]) => {
        const pageSlug = slugify(p.filename);
      
        // Clean the location string for display
        let displayCity = p.location
          .replace(/,?\s*TX|,?\s*Texas/i, '')  // Remove TX or Texas with optional comma/space
          .replace(/,/g, '')                  // Remove remaining commas
          .trim();
      
        displayCity = smartTitleCase(displayCity);
        const locationLabel = `${displayCity} Location`;
        const isActive = (pageSlug === filename) ? 'active' : '';
      
        return `<li class="nav-item">
          <a class="nav-link dropdown-item ${isActive}" href="${basePath}${pageSlug}.html">${locationLabel}</a>
        </li>`;
      }).join('');
  
      
      globalValues.businessName = smartTitleCase(normalizeText(globalValues.businessName));
      page.heroHeading = smartTitleCase(normalizeText(page.heroHeading));
      page.section1H2 = smartTitleCase(normalizeText(page.section1H2));
      page.section2H2 = smartTitleCase(normalizeText(page.section2H2));
      page.section3H2 = smartTitleCase(normalizeText(page.section3H2));
      page.section4H2 = smartTitleCase(normalizeText(page.section4H2));
      page.location = smartTitleCase(normalizeText(page.location));
  
      
      page.filename = normalizeText(page.filename);
      page.keyword = normalizeText(page.keyword);
      page.address = normalizeText(page.address);
      page.email = normalizeText(page.email);
  
  
      const meta = await generateMetadata(globalValues.businessName, page.keyword, page.location, formatCityState);
      const tagLine = await generateTaglineFromHeading(page.heroHeading);
      const section1H2 = page.section1H2;
      const section1 = await generateSection1Content(section1H2, globalValues.businessName);
      const section2H2 = page.section2H2;
      const section2 = await generateSection2Content(section2H2, globalValues.businessName);
      const section3H2 = page.section3H2;
      const section3P1 = await generateSection3Content(section3H2, globalValues.businessName);
      const section4H2 = page.section4H2;
      const section4P1 = await generateSection4Content(section4H2, globalValues.businessName);
      const serviceAreaParagraph = await generateServiceAreaContent(page.location);
      const coordinates = await getCoordinatesFromAddress(page.address);
      const reviews = await generateReview(globalValues.businessName);
  
  
      // Building Schema
      const jsonLdString = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        name: globalValues.businessName,
        url: globalValues.domain,
        telephone: page.phone,
        image: Object.values(uploadedImages[index] || {}),
        address: {
          "@type": "PostalAddress",
          streetAddress: page.address,
          addressLocality: formatCityForSchema(page.location),
          addressRegion: "Texas",
          postalCode: page.address.match(/\b\d{5}\b/)?.[0] || "",
          addressCountry: "United States"
        },
        geo: {
          "@type": "GeoCoordinates",
          latitude: coordinates.latitude,
          longitude: coordinates.longitude
        },
        openingHours: ["Mo 07:30-19:30", "Tu 07:30-19:30", "We 07:30-19:30", "Th 07:30-19:30", "Fr 07:30-19:30", "Sa 07:30-19:30", "Su 07:30-19:30"],
        review: reviews
      });
  
      // Ensure imageDesc is defined
      page.imageDesc = page.imageDesc || {};
  
      template = template
        .replace(/{{JSON_LD_SCHEMA}}/g, jsonLdString)
        .replace(/{{FAVICON_PATH}}/g, globalValues.favicon)
        .replace(/{{LOGO_PATH}}/g, globalValues.logo)
        .replace(/{{LOGO_ALT}}/g, `Logo image of ${globalValues.businessName} in ${page.location}`)
        .replace(/{{LOGO_TITLE}}/g, `Logo image of ${globalValues.businessName} in ${page.location}`)
        .replace(/{{PAGE_TITLE}}/g, meta.title)
        .replace(/{{META_DESCRIPTION}}/g, meta.description)
        .replace(/{{BUSINESS_NAME}}/g, globalValues.businessName)
        .replace(/{{TAG_LINE}}/g, tagLine)
        .replace(/{{HERO_IMG_MOBILE}}/g, uploadedImages[index]?.heroMobile || '')
        .replace(/{{HERO_IMG_TABLET}}/g, uploadedImages[index]?.heroTablet || '')
        .replace(/{{HERO_IMG_DESKTOP}}/g, uploadedImages[index]?.heroDesktop || '')
        .replace(/{{HERO_IMG_LARGE}}/g, uploadedImages[index]?.heroLarge || '')
        .replace(/{{HERO_IMG_ALT}}/g, buildAltAttribute(page.imageDesc.heroLarge, globalValues.businessName, page.location))
        .replace(/{{HERO_IMG_TITLE}}/g,  buildAltAttribute(page.imageDesc.heroLarge, globalValues.businessName, page.location))
        .replace(/{{SECTION2_IMG1}}/g, uploadedImages[index]?.section2Img1 || '')
        .replace(/{{SECTION2_IMG2}}/g, uploadedImages[index]?.section2Img2 || '')
        .replace(/{{SECTION2_IMG_ALT1}}/g, buildAltAttribute(page.imageDesc.section2Img1, globalValues.businessName, page.location))
        .replace(/{{SECTION2_IMG_TITLE1}}/g, buildAltAttribute(page.imageDesc.section2Img1, globalValues.businessName, page.location))
        .replace(/{{SECTION2_IMG_ALT2}}/g, buildAltAttribute(page.imageDesc.section2Img2, globalValues.businessName, page.location))
        .replace(/{{SECTION2_IMG_TITLE2}}/g, buildAltAttribute(page.imageDesc.section2Img2, globalValues.businessName, page.location))
        .replace(/{{SECTION4_IMG1}}/g, uploadedImages[index]?.section4Img1 || '')
        .replace(/{{SECTION4_IMG2}}/g, uploadedImages[index]?.section4Img2 || '')
        .replace(/{{SECTION4_IMG_ALT1}}/g, buildAltAttribute(page.imageDesc.section4Img1, globalValues.businessName, page.location))
        .replace(/{{SECTION4_IMG_TITLE1}}/g, buildAltAttribute(page.imageDesc.section4Img1, globalValues.businessName, page.location))
        .replace(/{{SECTION4_IMG_ALT2}}/g, buildAltAttribute(page.imageDesc.section4Img2, globalValues.businessName, page.location))
        .replace(/{{SECTION4_IMG_TITLE2}}/g, buildAltAttribute(page.imageDesc.section4Img2, globalValues.businessName, page.location))
        .replace(/{{MAP_IMAGE}}/g, uploadedImages[index]?.mapImage || '')
        .replace(/{{MAP_ALT}}/g, `Google Map image of ${globalValues.businessName} in ${formatCityState(page.location)}`)
        .replace(/{{MAP_TITLE}}/g, `Google Map image of ${globalValues.businessName} in ${formatCityState(page.location)}`)
        .replace(/{{SECTION1_H2}}/g, section1H2)
        .replace(/{{SECTION1_H3}}/g, section1.h3)
        .replace(/{{SECTION1_P1}}/g, section1.p1)
        .replace(/{{SECTION1_P2}}/g, section1.p2)
        .replace(/{{SECTION2_H2}}/g, section2H2)
        .replace(/{{SECTION2_P1}}/g, section2.p1)
        .replace(/{{SECTION2_P2}}/g, section2.p2)
        .replace(/{{SECTION3_H2}}/g, section3H2)
        .replace(/{{SECTION3_P1}}/g, section3P1)
        .replace(/{{SECTION4_H2}}/g, section4H2)
        .replace(/{{SECTION4_P1}}/g, section4P1)
        .replace(/{{LOCATION_AREA}}/g, formatCityState(page.location))
        .replace(/{{SERVICE_AREA_PARAGRAPH}}/g, serviceAreaParagraph)
        .replace(/{{ADDRESS}}/g, page.address)
        .replace(/{{EMAIL}}/g, page.email)
        .replace(/{{HOURS_DAYS}}/g, 'Mon–Sun')
        .replace(/{{HOURS_TIME}}/g, '7:30AM–7:30PM')
        .replace(/{{PHONE_RAW}}/g, formatPhoneForHref(page.phone))
        .replace(/{{PHONE_DISPLAY}}/g, page.phone)
        .replace(/{{CURRENT_YEAR}}/g, new Date().getFullYear())
        .replace(/{{FACEBOOK_URL}}/g, globalValues.facebookUrl)
        .replace(/{{TWITTER_URL}}/g, globalValues.twitterUrl)
        .replace(/{{PINTEREST_URL}}/g, globalValues.pinterestUrl)
        .replace(/{{YOUTUBE_URL}}/g, globalValues.youtubeUrl)
        .replace(/{{DYNAMIC_NAV_MENU}}/g, navMenu)
        .replace(/{{LOCATION_LIST_LEFT}}/g, locationListLeft)
        .replace(/{{LOCATION_LIST_RIGHT}}/g, locationListRight);
  
  
        
        // Remove Webpack placeholders if present:  ????
        template = template.replace(/<%= htmlWebpackPlugin\.tags\.headTags %>/g, '');
        template = template.replace(/<%= htmlWebpackPlugin\.tags\.bodyTags %>/g, '');


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
        fs.writeFileSync(path.join(distDir, `${filename}.html`), template);
  
  
        // === Auto-create CSS file.css if it doesn't exist 
        const cssFilePath = path.join(__dirname, 'src/css', `${filename}.css`);
  
        if (isDev && !fs.existsSync(cssFilePath)) {
          // Create CSS file.css in src/css for webpack use
          const fallbackStyle = path.join(__dirname, 'src/css/style.css');
          fs.copyFileSync(fallbackStyle, cssFilePath);
          console.log(`✅ Created CSS file: src/css/${filename}.css`);
  
          // Copy Bootstrap CSS to dist for dev use
          fs.copyFileSync(
            path.join(__dirname, 'src/css/bootstrap.min.css'),
            path.join(cssDir, 'bootstrap.min.css') // result = dist/css/bootstrap.min.css
          );
  
          // Copy CSS generated file.css to dist/css for dev use
          fs.copyFileSync(
            path.join(__dirname, `src/css/${filename}.css`),
            path.join(cssDir, `${filename}.css`) // result = dist/css/{filename}.css
          );
  
        }



        // === Auto-create JS stub (dev or prod, needed for Webpack build)
        const jsFilePath = path.join(__dirname, 'src/js', `${filename}.js`);
        const jsContent = `
        // Auto-generated JS stub for ${filename}
        import 'bootstrap/dist/js/bootstrap.bundle.js';
        import '../css/bootstrap.min.css';
        import '../css/${filename}.css';
        // Add your JS logic for ${filename} here
        `;

        if (isDev && !fs.existsSync(jsFilePath)) {
          // Copy bootstrap.bundle.min.js to dist
          fs.copyFileSync(
            path.join(__dirname, 'src/js/bootstrap.bundle.min.js'),
            path.join(jsDir, 'bootstrap.bundle.min.js'));    
            console.log('✅ Copied Bootstrap CSS and JS to dist');

          // Create js file.js in src/js for webpack use
          fs.writeFileSync(jsFilePath, jsContent);
          console.log(`✅ Created/Updated JS stub: src/js/${filename}.js`);
        }     
  
    }
  
  
    // === Generate Success Response with Links to Pages ===
    const links = Object.entries(pages).map(([_, page]) => {
      const filename = slugify(page.filename.trim());
      return `<li><a href="${basePath}${filename}.html" target="_blank">${filename}.html</a></li>`;
    }).join('');
  
    res.send(`
      <h2>✅ Pages generated in dev mode!</h2>
      <ul>${links}</ul>
      <a href="/" class="btn btn-secondary mt-3 d-block">Go Back</a>
      <a href="/prod" class="btn btn-primary mt-3 d-block">Run Production</a>
    `);
  }
  
});



// PRODUCTION route to replace 'dist/' with '/' and run webpack
app.get('/prod', (req,res) => {
 
  // Replace 'dist/' with '/' in Prod
  replaceInProd(distDir);
  

  // === Run Webpack and zip
  exec('npm run build:webpack', async (err, stdout, stderr) => {
    if (err) {
      console.error('❌ Webpack error:', stderr);
      return res.status(500).send('Webpack build failed.');
    }

    console.log('✅ Webpack build complete.');

    const zipPath = path.join(__dirname, 'dist.zip');
    await zip(distDir, zipPath);
    console.log('✅ Zipped site.');

    res.send(`
      <h2>✅ Pages generated and optimized successfully!</h2>
      <a href="/download-zip" class="btn btn-success mt-3">Download Website ZIP</a>
      <a href="/" class="btn btn-secondary mt-3 d-block">Go Back</a>
    `);
  });
  

});

// DOWNLOAD-ZIP route to download all zipped website pages 
app.get('/download-zip', (req, res) => {
  const zipPath = path.join(__dirname, 'dist.zip');
  if (fs.existsSync(zipPath)) {
    res.download(zipPath, 'website.zip', err => {
      if (!err) {
        fs.unlinkSync(zipPath); // Optional cleanup after download
      }
    });
  } else {
    res.status(404).send('❌ ZIP file not found.');
  }
});


app.listen(PORT, () => console.log(`🚀 Server listening on http://localhost:${PORT}`));
