const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');
const { writePageAssets } = require('./buildAssets');
const { buildSocialLinks } = require('./buildSocialLinks');
const CM = require('./contentModel');
const { buildNavMenu } = require('./buildNavMenu');
const { normalizeDomain } = require('./normalizeDomain');
const { canonicalTag } = require('./canonicalUrl');
const { escapeAttr } = require('./helpers');

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


        // ONE definition of this page's title and description, used by the
        // HTML below AND by the WordPress model at the bottom.
        //
        // The template used to hardcode <title>Accessibility</title>, identical
        // on every site ever generated, while the model carried
        // "Accessibility | <business>". So the downloaded page and the exported
        // theme disagreed, and every customer's page shared one title.
        const meta = {
            title: `Accessibility | ${globalValues.businessName}, ${globalValues.location}`,
            description: `${globalValues.businessName} in ${globalValues.location} is committed to keeping this website usable for everyone. Read our accessibility statement.`,
        };

        accessibility = accessibility
        .replace(/{{PAGE_TITLE}}/g, escapeAttr(meta.title))
        .replace(/{{META_DESCRIPTION}}/g, escapeAttr(meta.description))
        // Self-referencing canonical, using the same filename this builder
        // writes below and the sitemap picks up off disk. Empty string when
        // the wizard's domain is unusable, so the placeholder disappears
        // rather than emitting href="".
        .replace(/{{CANONICAL}}/g, canonicalTag(globalValues, 'accessibility.html'))
        .replace(/{{BUSINESS_NAME}}/g, globalValues.businessName.toUpperCase())
        // normalizeDomain, matching the privacy and terms builders.
        //
        // This passed globalValues.domain RAW while the other two normalised
        // it, and the template compensated by writing "www.{{DOMAIN}}". That
        // held together only for someone who typed a bare domain: type
        // "www.example.com" and the page read www.www.example.com; type
        // "https://example.com" and it read www.https://example.com. The
        // literal "www." is gone from the template and this now behaves like
        // its two siblings.
        .replace(/{{DOMAIN}}/g, normalizeDomain(globalValues.domain))
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
        //
        // No canonical here on purpose: WordPress emits its own on singular
        // pages, and its permalink is /accessibility/ rather than
        // accessibility.html — so carrying the static URL across would name an
        // address that does not exist on the WordPress site.
        return CM.legalPage({
            slug: 'accessibility',
            title: 'Accessibility',
            menuOrder: 10000,
            meta,
            sections: CM.sectionsFromLegalHtml(accessibility),
        });



    }

}

module.exports = { buildAccessibilityPage };