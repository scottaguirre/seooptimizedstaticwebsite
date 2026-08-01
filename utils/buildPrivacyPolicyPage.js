const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');
const { writePageAssets } = require('./buildAssets');
const { buildSocialLinks } = require('./buildSocialLinks');
const CM = require('./contentModel');
const { buildNavMenu } = require('./buildNavMenu');
const { normalizeDomain}  = require('./normalizeDomain');

const basePath = '';



const buildPrivacyPolicyPage = function (
        distDir, 
        cssDir, 
        globalValues, 
        pages
    ) {
    // Replace {{DOMAIN}}, {{BUSINESS_NAME}} from privacyPolicyTamplate.html & save in dist
    let privacyPolicy = fs.readFileSync(path.join(__dirname, '../src/privacyPolicyTemplate.html'), 'utf-8');
    let privacyPolicyPageExists = fs.existsSync(path.join(distDir, '/privacy-policy.html'), 'utf-8');
    

    if(!privacyPolicyPageExists){



        // ✅ Build & inject Services / Locations menus (and remove wrappers if empty)
        const context = 'privacypolicy';
        privacyPolicy = buildNavMenu(privacyPolicy, globalValues, pages, basePath, slugify(globalValues.location), globalValues.location, context);


        privacyPolicy = privacyPolicy
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
        .replace('</head>', `<link rel="stylesheet" href="./css/bootstrap.min.css">
                            <link rel="stylesheet" href="./css/privacy-policy.css"></head>`)
        .replace('</body>', `<script src="./js/bootstrap.bundle.min.js"></script>
                             <script src="./js/privacy-policy.js"></script>
                 </body>`);

        fs.writeFileSync(path.join(distDir, `privacy-policy.html`), privacyPolicy);

        // === Stylesheet + Webpack entry stub, inside this user's folder
        writePageAssets({
            distDir,
            cssDir,
            entryName: 'privacy-policy',
            cssName: 'privacy-policy',
            styleKey: globalValues.styleKey
        });

        // === Semantic model for the WordPress exporter ===
        // The policy text only exists in the template, so pull it into the
        // model here. Without this the exported theme had blank legal pages.
        return CM.legalPage({
            slug: 'privacy-policy',
            title: 'Privacy Policy',
            menuOrder: 9998,
            meta: {
                title: `Privacy Policy | ${globalValues.businessName}`,
                description: `Privacy Policy for ${globalValues.businessName}.`,
            },
            sections: CM.sectionsFromLegalHtml(privacyPolicy),
        });

 

    }

}

module.exports = { buildPrivacyPolicyPage };