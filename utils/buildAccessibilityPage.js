const path = require('path');
const fs = require('fs');


const buildAccessibilityPage = 
function (
            distDir,
            cssDir,
            globalValues,
            navMenu,
            linkOutsideNavMenu,
            firstPageName,
            firstPageNameActive
   ) {
    // Replace {{DOMAIN}}, {{BUSINESS_NAME}} from accessibility.html & save in dist
    let accessibility = fs.readFileSync(path.join(__dirname, '../src/accessibilityTemplate.html'), 'utf-8');
    let accessibilityExists = fs.existsSync(path.join(distDir, '/accessibility.html'), 'utf-8');
  

    if(!accessibilityExists){

        const cleanedNavMenu = navMenu.replace(/active/g, '');
        linkOutsideNavMenu = linkOutsideNavMenu.replace(/active/g, '');
        firstPageName = firstPageName.replace(/active/g, '');
        firstPageNameActive = firstPageNameActive.replace(/active/g, '');

        accessibility = accessibility
        .replace(/{{BUSINESS_NAME}}/g, globalValues.businessName)
        .replace(/{{DOMAIN}}/g, globalValues.domain)
        .replace(/{{FAVICON_PATH}}/g, globalValues.favicon)
        .replace(/{{LOGO_PATH}}/g, globalValues.logo)
        .replace(/{{DYNAMIC_NAV_MENU}}/g, cleanedNavMenu)
        .replace(/{{FIRST_PAGE_NAME_ACTIVE}}/g, firstPageNameActive)
        .replace(/{{LINK_OUTSIDE_NAV_MENU}}/g, linkOutsideNavMenu)
        .replace(/{{FIRST_PAGE_NAME}}/g, firstPageName)
        .replace(/{{LOGO_TITLE}}/g, `Logo image of ${globalValues.businessName}`)
        .replace(/{{LOGO_ALT}}/g, `Logo image of ${globalValues.businessName}`)
        .replace(/{{CURRENT_YEAR}}/g, new Date().getFullYear())
        .replace(/{{FACEBOOK_URL}}/g, globalValues.facebookUrl)
        .replace(/{{TWITTER_URL}}/g, globalValues.twitterUrl)
        .replace(/{{PINTEREST_URL}}/g, globalValues.pinterestUrl)
        .replace(/{{YOUTUBE_URL}}/g, globalValues.youtubeUrl)
        .replace('</head>', `<link rel="stylesheet" href="./css/bootstrap.min.css">
                            <link rel="stylesheet" href="./css/accessibility.css"></head>`)
        .replace('</body>', `<script src="./js/bootstrap.bundle.min.js"></script>
                             <script src="./js/accessibility.js"></script>
                  </body>`);

        fs.writeFileSync(path.join(distDir, `accessibility.html`), accessibility);

        // === Auto-create accessibility.css if it doesn't exist 
        const cssFilePath = path.join(__dirname, '../', 'src/css', `accessibility.css`);

        // Create accessibility.css in src/css for webpack use
        const fallbackStyle = path.join(__dirname, '../', 'src/css/style.css');
        fs.copyFileSync(fallbackStyle, cssFilePath);
        
        // Copy generated accessibility.css to dist/css for dev use
        fs.copyFileSync(
        path.join(__dirname, '../', `src/css/accessibility.css`),
        path.join(cssDir, `accessibility.css`) // result = dist/css/accessibility.css
        );


        // === Create JS stub ( for prod, needed for Webpack build)
        const jsFilePath = path.join(__dirname, '../src/js', `accessibility.js`);
        const jsContent = `
        // Auto-generated JS stub for accessibility.js
        import '../css/bootstrap.min.css';
        import '../css/accessibility.css';
        import './bootstrap.bundle.min.js';
        // Add your JS logic for accessibility.js here
        `;

        if (!fs.existsSync(jsFilePath)) {
            // Create js file.js in src/js for webpack use
            fs.writeFileSync(jsFilePath, jsContent);
            
        } 

    }

}

module.exports = { buildAccessibilityPage };

