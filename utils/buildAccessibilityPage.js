const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');
const { writePageAssets } = require('./buildAssets');
const { buildSocialLinks } = require('./buildSocialLinks');
const CM = require('./contentModel');
const { buildNavMenu } = require('./buildNavMenu');

const basePath = '';

const buildAccessibilityPage = 
function (
            distDir,
            cssDir,
            globalValues,
            pages
            
   ) {
    // Replace {{DOMAIN}}, {{BUSINESS_NAME}} from accessibility.html & save in dist
    let accessibility = fs.readFileSync(path.join(__dirname, '../src/accessibilityTemplate.html'), 'utf-8');
    let accessibilityExists = fs.existsSync(path.join(distDir, '/accessibility.html'), 'utf-8');
  

    if(!accessibilityExists){


        // ✅ Build & inject Services / Locations menus (and remove wrappers if empty)
        const context = 'accessibility';
        accessibility = buildNavMenu(accessibility, globalValues, pages, basePath, slugify(globalValues.location), globalValues.location, context);


        accessibility = accessibility
        .replace(/{{BUSINESS_NAME}}/g, globalValues.businessName.toUpperCase())
        .replace(/{{DOMAIN}}/g, globalValues.domain)
        .replace(/{{FAVICON_PATH}}/g, globalValues.favicon)
        .replace(/{{LOGO_PATH}}/g, globalValues.logo)
        .replace(/{{LOGO_TITLE}}/g, `Logo image of ${globalValues.businessName}`)
        .replace(/{{LOGO_ALT}}/g, `Logo image of ${globalValues.businessName}`)
        .replace(/{{LOGO_WIDTH}}/g, String(globalValues.logoWidth))
        .replace(/{{LOGO_HEIGHT}}/g, String(globalValues.logoHeight))
        .replace(/{{CURRENT_YEAR}}/g, new Date().getFullYear())
        .replace(/{{SOCIAL_LINKS}}/g, buildSocialLinks(globalValues))
        .replace('</head>', `<link rel="stylesheet" href="./css/bootstrap.min.css">
                            <link rel="stylesheet" href="./css/accessibility.css"></head>`)
        .replace('</body>', `<script src="./js/bootstrap.bundle.min.js"></script>
                             <script src="./js/accessibility.js"></script>
                  </body>`);

        fs.writeFileSync(path.join(distDir, `accessibility.html`), accessibility);

        // === Stylesheet + Webpack entry stub, inside this user's folder
        writePageAssets({
            distDir,
            cssDir,
            entryName: 'accessibility',
            cssName: 'accessibility',
            styleKey: globalValues.styleKey
        });

        // === Semantic model for the WordPress exporter ===
        // The policy text only exists in the template, so pull it into the
        // model here. Without this the exported theme had blank legal pages.
        return CM.legalPage({
            slug: 'accessibility',
            title: 'Accessibility',
            menuOrder: 10000,
            meta: {
                title: `Accessibility | ${globalValues.businessName}`,
                description: `Accessibility for ${globalValues.businessName}.`,
            },
            sections: CM.sectionsFromLegalHtml(accessibility),
        });

 

    }

}

module.exports = { buildAccessibilityPage };