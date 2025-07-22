const path = require('path');
const fs = require('fs');
const { normalizeDomain}  = require('./normalizeDomain');


const buildPrivacyPolicyPage = function (
        distDir, 
        cssDir, 
        globalValues, 
        navMenu,
        page, 
        firstPageNameActive, 
        linkOutsideNavMenu, 
        firstPageName
    ) {
    // Replace {{DOMAIN}}, {{BUSINESS_NAME}} from privacyPolicyTamplate.html & save in dist
    let privacyPolicy = fs.readFileSync(path.join(__dirname, '../src/privacyPolicyTemplate.html'), 'utf-8');
    let privacyPolicyPageExists = fs.existsSync(path.join(distDir, '/privacy-policy.html'), 'utf-8');
    

    if(!privacyPolicyPageExists){
   
        const cleanedNavMenu = navMenu.replace(/active/g, '');
        linkOutsideNavMenu = linkOutsideNavMenu.replace(/active/g, '');
        firstPageName = firstPageName.replace(/active/g, '');
        firstPageNameActive = firstPageNameActive.replace(/active/g, '');

        privacyPolicy = privacyPolicy
        .replace(/{{BUSINESS_NAME}}/g, globalValues.businessName)
        .replace(/{{DOMAIN}}/g, normalizeDomain(globalValues.domain))
        .replace(/{{FAVICON_PATH}}/g, globalValues.favicon)
        .replace(/{{LOGO_PATH}}/g, globalValues.logo)
        .replace(/{{DYNAMIC_NAV_MENU}}/g, cleanedNavMenu)
        .replace(/{{FIRST_PAGE_NAME_ACTIVE}}/g, firstPageNameActive)
        .replace(/{{LINK_OUTSIDE_NAV_MENU}}/g, linkOutsideNavMenu)
        .replace(/{{FIRST_PAGE_NAME}}/g, firstPageName)
        .replace(/{{LOGO_TITLE}}/g, `Logo image of ${globalValues.businessName}`)
        .replace(/{{LOGO_ALT}}/g, `Logo image of ${globalValues.businessName}`)
        .replace(/{{CURRENT_YEAR}}/g, new Date().getFullYear())
        .replace(/{{EMAIL}}/g, page.email)
        .replace(/{{FACEBOOK_URL}}/g, globalValues.facebookUrl)
        .replace(/{{TWITTER_URL}}/g, globalValues.twitterUrl)
        .replace(/{{PINTEREST_URL}}/g, globalValues.pinterestUrl)
        .replace(/{{YOUTUBE_URL}}/g, globalValues.youtubeUrl)
        .replace('</head>', `<link rel="stylesheet" href="./css/bootstrap.min.css">
                            <link rel="stylesheet" href="./css/privacy-policy.css"></head>`)
        .replace('</body>', `<script src="./js/bootstrap.bundle.min.js"></script>
                             <script src="./js/privacy-policy.js"></script>
                 </body>`);

        fs.writeFileSync(path.join(distDir, `privacy-policy.html`), privacyPolicy);

        // === Auto-create privacy-policy.css if it doesn't exist 
        const cssFilePath = path.join(__dirname, '../', 'src/css', `privacy-policy.css`);

        // Create privacy-policy.css in src/css for webpack use
        const fallbackStyle = path.join(__dirname, '../', 'src/css/style.css');
        fs.copyFileSync(fallbackStyle, cssFilePath);
        
        // Copy generated privacy-policy.css to dist/css for dev use
        fs.copyFileSync(
        path.join(__dirname, '../', `src/css/privacy-policy.css`),
        path.join(cssDir, `privacy-policy.css`) // result = dist/css/privacy-policy.css
        );


        // === Create JS stub ( for prod, needed for Webpack build)
        const jsFilePath = path.join(__dirname, '../src/js', `privacy-policy.js`);
        const jsContent = `
        // Auto-generated JS stub for privacy-policy.js
        import '../css/bootstrap.min.css';
        import '../css/privacy-policy.css';
        import './bootstrap.bundle.min.js';
        // Add your JS logic for privacy-policy.js here
        `;

        if (!fs.existsSync(jsFilePath)) {
            // Create js file.js in src/js for webpack use
            fs.writeFileSync(jsFilePath, jsContent);
        } 

    }

}

module.exports = { buildPrivacyPolicyPage };
