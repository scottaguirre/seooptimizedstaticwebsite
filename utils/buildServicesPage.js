const path = require('path');
const fs = require('fs');
const { formatPhoneForHref } = require('./formatPhoneForHref');
const { generateServicesContent } = require('./generateServicesContent');
const { generateTaglineFromHeading } = require('./generateTaglineFromHeading');


const buildServicesPage = async function (
    distDir,
    cssDir,
    globalValues,
    navMenu,
    page,
    uploadedImages,
    index,
    altTexts
){
    
    // Replace {{DOMAIN}}, {{BUSINESS_NAME}} from servicesTamplate.html & save in dist
    const servicesContent = await generateServicesContent(globalValues.businessName, page.keyword);

    const tagline =  await generateTaglineFromHeading(globalValues.businessName);
    
    let services = fs.readFileSync(path.join(__dirname, '../src/servicesTemplate.html'), 'utf-8');
    let servicesPageExists = fs.existsSync(path.join(distDir, '/services.html'), 'utf-8');
    const cleanedNavMenu = navMenu.replace(/active/g, '');

    if(!servicesPageExists){
        services = services
        .replace(/{{BUSINESS_NAME}}/g, globalValues.businessName)
        .replace(/{{TAG_LINE}}/g, tagline)
        .replace(/{{HERO_IMG_MOBILE}}/g, uploadedImages[index]?.heroMobile || '')
        .replace(/{{HERO_IMG_TABLET}}/g, uploadedImages[index]?.heroTablet || '')
        .replace(/{{HERO_IMG_DESKTOP}}/g, uploadedImages[index]?.heroDesktop || '')
        .replace(/{{HERO_IMG_LARGE}}/g, uploadedImages[index]?.heroLarge || '')
        .replace(/{{HERO_IMG_ALT}}/g, `${altTexts.heroLarge} from ${globalValues.businessName}`)
        .replace(/{{HERO_IMG_TITLE}}/g,  `${altTexts.heroLarge} from ${globalValues.businessName}`)
        .replace(/{{FAVICON_PATH}}/g, globalValues.favicon)
        .replace(/{{LOGO_PATH}}/g, globalValues.logo)
        .replace(/{{DYNAMIC_NAV_MENU}}/g, cleanedNavMenu)
        .replace(/{{LOGO_TITLE}}/g, `Logo image of ${globalValues.businessName}`)
        .replace(/{{LOGO_ALT}}/g, `Logo image of ${globalValues.businessName}`)
        .replace(/{{SERVICES}}/g, servicesContent)
        .replace(/{{ADDRESS}}/g, globalValues.address)
        .replace(/{{HOURS_DAYS}}/g, globalValues.hoursDays)
        .replace(/{{HOURS_TIME}}/g, globalValues.hoursTime)
        .replace(/{{PHONE_RAW}}/g, formatPhoneForHref(globalValues.phone))
        .replace(/{{PHONE_DISPLAY}}/g, globalValues.phone)
        .replace(/{{CURRENT_YEAR}}/g, new Date().getFullYear())
        .replace(/{{EMAIL}}/g, globalValues.email)
        .replace(/{{FACEBOOK_URL}}/g, globalValues.facebookUrl)
        .replace(/{{TWITTER_URL}}/g, globalValues.twitterUrl)
        .replace(/{{PINTEREST_URL}}/g, globalValues.pinterestUrl)
        .replace(/{{YOUTUBE_URL}}/g, globalValues.youtubeUrl)
        .replace('</head>', `<link rel="stylesheet" href="./css/bootstrap.min.css">
                             <link rel="stylesheet" href="./css/services.css">
                  </head>`)
        .replace('</body>', `<script src="./js/bootstrap.bundle.min.js"></script>
                             <script src="./js/services.js"></script>
                  </body>`);

        fs.writeFileSync(path.join(distDir, `services.html`), services);

        // === Auto-create services.css if it doesn't exist 
        const cssFilePath = path.join(__dirname, '../', 'src/css', `services.css`);

        // Create services.css in src/css for webpack use
        const fallbackStyle = path.join(__dirname, '../', 'src/css/style.css');
        fs.copyFileSync(fallbackStyle, cssFilePath);

        // Copy generated services.css to dist/css for dev use
        fs.copyFileSync(
        path.join(__dirname, '../', `src/css/services.css`),
        path.join(cssDir, `services.css`) // result = dist/css/services.css
        );

        // === Create JS stub ( for prod, needed for Webpack build)
        const jsFilePath = path.join(__dirname, '../src/js', `services.js`);
        const jsContent = `
        // Auto-generated JS stub for services.js
        import '../css/bootstrap.min.css';
        import '../css/services.css';
        import './bootstrap.bundle.min.js';
        // Add your JS logic for services.js here
        `;

        if (!fs.existsSync(jsFilePath)) {
            // Create js file.js in src/js for webpack use
            fs.writeFileSync(jsFilePath, jsContent);
            
        } 

    }

}

module.exports = { buildServicesPage };
