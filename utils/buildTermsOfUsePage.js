const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');
const { writePageAssets } = require('./buildAssets');
const { buildSocialLinks } = require('./buildSocialLinks');
const CM = require('./contentModel');
const { buildNavMenu } = require('./buildNavMenu');
const { normalizeDomain}  = require('./normalizeDomain');
const { getFullStateName } = require('./getFullStateName');

const basePath = '';


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
        .replace(/{{LOGO_WIDTH}}/g, String(globalValues.logoWidth))
        .replace(/{{LOGO_HEIGHT}}/g, String(globalValues.logoHeight))
        .replace(/{{CURRENT_YEAR}}/g, new Date().getFullYear())
        .replace(/{{SOCIAL_LINKS}}/g, buildSocialLinks(globalValues))
        .replace(/{{EMAIL}}/g, globalValues.email)
        .replace(/{{STATE}}/g, fullStateName)
        .replace('</head>', `<link rel="stylesheet" href="./css/bootstrap.min.css">
                            <link rel="stylesheet" href="./css/terms-of-use.css"></head>`)
        .replace('</body>', `<script src="./js/bootstrap.bundle.min.js"></script>
                             <script src="./js/terms-of-use.js"></script>
                  </body>`);

        fs.writeFileSync(path.join(distDir, `terms-of-use.html`), termsOfUse);

        // === Stylesheet + Webpack entry stub, inside this user's folder
        writePageAssets({
            distDir,
            cssDir,
            entryName: 'terms-of-use',
            cssName: 'terms-of-use',
            styleKey: globalValues.styleKey
        });

        // === Semantic model for the WordPress exporter ===
        // The policy text only exists in the template, so pull it into the
        // model here. Without this the exported theme had blank legal pages.
        return CM.legalPage({
            slug: 'terms-of-use',
            title: 'Terms of Use',
            menuOrder: 9999,
            meta: {
                title: `Terms of Use | ${globalValues.businessName}`,
                description: `Terms of Use for ${globalValues.businessName}.`,
            },
            sections: CM.sectionsFromLegalHtml(termsOfUse),
        });

 

    }

}

module.exports = { buildTermsOfUsePage };