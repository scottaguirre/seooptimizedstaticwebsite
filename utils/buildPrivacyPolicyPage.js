const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');
const { writePageAssets } = require('./buildAssets');
const { buildSocialLinks } = require('./buildSocialLinks');
const CM = require('./contentModel');
const { buildNavMenu } = require('./buildNavMenu');
const { normalizeDomain}  = require('./normalizeDomain');
const { canonicalTag } = require('./canonicalUrl');
const { escapeAttr } = require('./helpers');

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


        // ONE definition of this page's title and description, used by the
        // HTML below AND by the WordPress model at the bottom.
        //
        // The template used to hardcode <title>Privicy Policy Page</title> —
        // misspelled, and identical on every site ever generated, while the
        // model carried the good string. So the downloaded page and the
        // exported theme disagreed, and the static one was the wrong one.
        const meta = {
            title: `Privacy Policy | ${globalValues.businessName}, ${globalValues.location}`,
            description: `How ${globalValues.businessName} in ${globalValues.location} collects, uses and protects your information when you use our website.`,
        };

        privacyPolicy = privacyPolicy
        .replace(/{{PAGE_TITLE}}/g, escapeAttr(meta.title))
        .replace(/{{META_DESCRIPTION}}/g, escapeAttr(meta.description))
        // Self-referencing canonical, using the same filename this builder
        // writes below and the sitemap picks up off disk. Empty string when
        // the wizard's domain is unusable, so the placeholder disappears
        // rather than emitting href="".
        .replace(/{{CANONICAL}}/g, canonicalTag(globalValues, 'privacy-policy.html'))
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
        //
        // No canonical here on purpose: WordPress emits its own on singular
        // pages, and its permalink is /privacy-policy/ rather than
        // privacy-policy.html — so carrying the static URL across would name
        // an address that does not exist on the WordPress site.
        return CM.legalPage({
            slug: 'privacy-policy',
            title: 'Privacy Policy',
            menuOrder: 9998,
            meta,
            sections: CM.sectionsFromLegalHtml(privacyPolicy),
        });



    }

}

module.exports = { buildPrivacyPolicyPage };