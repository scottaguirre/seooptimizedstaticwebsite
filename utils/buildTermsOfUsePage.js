const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');
const { writePageAssets } = require('./buildAssets');
const { buildSocialLinks } = require('./buildSocialLinks');
const CM = require('./contentModel');
const { buildNavMenu } = require('./buildNavMenu');
const { normalizeDomain}  = require('./normalizeDomain');
const { getFullStateName } = require('./getFullStateName');
const { canonicalTag } = require('./canonicalUrl');
const { escapeAttr } = require('./helpers');

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


        // ONE definition of this page's title and description, used by the
        // HTML below AND by the WordPress model at the bottom.
        //
        // The template used to hardcode <title>Terms of Use</title>, identical
        // on every site ever generated, while the model carried
        // "Terms of Use | <business>". So the downloaded page and the exported
        // theme disagreed, and every customer's terms page shared one title.
        const meta = {
            title: `Terms of Use | ${globalValues.businessName}, ${globalValues.location}`,
            description: `The terms that apply when you use the ${globalValues.businessName} website, covering acceptable use, liability and intellectual property.`,
        };

        termsOfUse = termsOfUse
        .replace(/{{PAGE_TITLE}}/g, escapeAttr(meta.title))
        .replace(/{{META_DESCRIPTION}}/g, escapeAttr(meta.description))
        // Self-referencing canonical, using the same filename this builder
        // writes below and the sitemap picks up off disk. Empty string when
        // the wizard's domain is unusable, so the placeholder disappears
        // rather than emitting href="".
        .replace(/{{CANONICAL}}/g, canonicalTag(globalValues, 'terms-of-use.html'))
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
        //
        // No canonical here on purpose: WordPress emits its own on singular
        // pages, and its permalink is /terms-of-use/ rather than
        // terms-of-use.html — so carrying the static URL across would name an
        // address that does not exist on the WordPress site.
        return CM.legalPage({
            slug: 'terms-of-use',
            title: 'Terms of Use',
            menuOrder: 9999,
            meta,
            sections: CM.sectionsFromLegalHtml(termsOfUse),
        });



    }

}

module.exports = { buildTermsOfUsePage };