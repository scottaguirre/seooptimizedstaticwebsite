const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');
const { buildNavMenu } = require('./buildNavMenu');
const { normalizeDomain}  = require('./normalizeDomain');
const { getFullStateName } = require('./getFullStateName');

const isDev = process.env.NODE_ENV !== 'production';
const basePath = isDev ? '/dist/' : '/';


const buildTermsOfUsePage = function (
        distDir,
        cssDir,
        globalValues,
        pages
) {
    // Replace {{DOMAIN}}, {{BUSINESS_NAME}} from accessibility.html & save in dist
    let termsOfUse = fs.readFileSync(path.join(__dirname, '../src/termsOfUseTemplate.html'), 'utf-8');
    let termsOfUsePageExists = fs.existsSync(path.join(distDir, '/terms-of-use.html'), 'utf-8');
   
    if(!termsOfUsePageExists){
       
        const fullStateName = getFullStateName(globalValues.location);

         // ✅ Build & inject Services / Locations menus (and remove wrappers if empty)
         const context = 'termsofuse';
         termsOfUse = buildNavMenu(termsOfUse, globalValues, pages, basePath, slugify(globalValues.location), globalValues.location, context);
 
       
        termsOfUse = termsOfUse
        .replace(/{{BUSINESS_NAME}}/g, globalValues.businessName.toUpperCase())
        .replace(/{{DOMAIN}}/g, normalizeDomain(globalValues.domain))
        .replace(/{{FAVICON_PATH}}/g, globalValues.favicon)
        .replace(/{{LOGO_PATH}}/g, globalValues.logo)
        .replace(/{{LOGO_TITLE}}/g, `Logo image of ${globalValues.businessName}`)
        .replace(/{{LOGO_ALT}}/g, `Logo image of ${globalValues.businessName}`)
        .replace(/{{CURRENT_YEAR}}/g, new Date().getFullYear())
        .replace(/{{EMAIL}}/g, globalValues.email)
        .replace(/{{STATE}}/g, fullStateName)
        .replace(/{{FACEBOOK_URL}}/g, globalValues.facebookUrl)
        .replace(/{{TWITTER_URL}}/g, globalValues.twitterUrl)
        .replace(/{{PINTEREST_URL}}/g, globalValues.pinterestUrl)
        .replace(/{{YOUTUBE_URL}}/g, globalValues.youtubeUrl)
        .replace('</head>', `<link rel="stylesheet" href="./css/bootstrap.min.css">
                            <link rel="stylesheet" href="./css/terms-of-use.css"></head>`)
        .replace('</body>', `<script src="./js/bootstrap.bundle.min.js"></script>
                             <script src="./js/terms-of-use.js"></script>
                  </body>`);

        fs.writeFileSync(path.join(distDir, `terms-of-use.html`), termsOfUse);

        // === Auto-create termsOfUse.css if it doesn't exist 
        const cssFilePath = path.join(__dirname, '../', 'src/css', `terms-of-use.css`);

        // Create termsOfUse.css in src/css for webpack use
        const fallbackStyle = path.join(__dirname, '../', 'src/css/style.css');
        fs.copyFileSync(fallbackStyle, cssFilePath);
        
        // Copy generated termsOfUse.css to dist/css for dev use
        fs.copyFileSync(
        path.join(__dirname, '../', `src/css/terms-of-use.css`),
        path.join(cssDir, `terms-of-use.css`) // result = dist/css/termsOfUse.css
        );


        // === Create JS stub ( for prod, needed for Webpack build)
        const jsFilePath = path.join(__dirname, '../src/js', `terms-of-use.js`);
        const jsContent = `
        // Auto-generated JS stub for terms-of-use.js
        import '../css/bootstrap.min.css';
        import '../css/terms-of-use.css';
        import './bootstrap.bundle.min.js';
        // Add your JS logic for terms-of-use.js here
        `;

        if (!fs.existsSync(jsFilePath)) {
            // Create js file.js in src/js for webpack use
            fs.writeFileSync(jsFilePath, jsContent);
        } 

    }

}

module.exports = { buildTermsOfUsePage };
