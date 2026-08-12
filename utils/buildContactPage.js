// utils/buildContactPage.js
//
// The contact page: hero -> AI intro -> form -> NAP/map.
//
// The form and the NAP block are the SAME ones the home page uses, reached
// through the same {{FORM}} placeholder and the same NAP markup. Nothing is
// duplicated: change the form once and both pages follow.
//
// When the user opts out of the contact form, formHtml arrives empty. In that
// case the whole <section id="contact-form-section"> wrapper is stripped from
// the HTML and the FORM entry is left out of the semantic model, so neither the
// static page nor the WordPress export carries an empty form block.
//
// The hero is the only image on this page.

const fs = require('fs');
const path = require('path');

const { slugify } = require('./slugify');
const { escapeAttr } = require('./helpers');
const { getHoursTimeText } = require('./formatDaysAndHoursForDisplay');
const { formatPhoneForHref } = require('./formatPhoneForHref');
const { writePageAssets } = require('./buildAssets');
const { buildSocialLinks } = require('./buildSocialLinks');
const { buildNavMenu } = require('./buildNavMenu');
const { fillLegalLinks } = require('./legalLinks');
const { buildAltText } = require('./buildAltText');
const { generateContactContent } = require('./generateContactContent');
const { copyPageImage } = require('./pageParts');
const CM = require('./contentModel');

const basePath = '';

const buildContactPage = async function (
  distDir,
  cssDir,
  globalValues,
  pages,
  formHtml = ''
) {
  const contactPath = path.join(distDir, 'contact.html');
  if (fs.existsSync(contactPath)) {
    return null;
  }

  let contact = fs.readFileSync(path.join(__dirname, '../src/contactTemplate.html'), 'utf-8');

  // Did the user opt in to the contact form?
  const hasForm = Boolean((formHtml || '').trim());

  const businessType = slugify(globalValues.businessType || '');
  const seoPrefix = `${slugify(globalValues.businessName)}-${slugify(globalValues.location)}-contact`;

  // Nav: this page is the CONTACT tab
  contact = buildNavMenu(
    contact,
    globalValues,
    pages,
    basePath,
    slugify(globalValues.location),
    'contact',
    'contact'
  );

  // Hero images — the only images on this page. Reuses the About Us hero
  // folder rather than needing its own set.
  const heroDir = path.join(__dirname, '../src/predefined-images', businessType, 'aboutUs/hero');
  copyPageImage(heroDir, seoPrefix, 'hero-mobile.webp',  'heroMobile',  distDir);
  copyPageImage(heroDir, seoPrefix, 'hero-tablet.webp',  'heroTablet',  distDir);
  copyPageImage(heroDir, seoPrefix, 'hero-desktop.webp', 'heroDesktop', distDir);
  copyPageImage(heroDir, seoPrefix, 'hero-large.webp',   'heroLarge',   distDir);

  const altTexts = buildAltText(globalValues, 0);
  const heroAlt = `${altTexts['hero-mobile'] || globalValues.businessType} - ${globalValues.location}`;

  // The intro
  const intro = await generateContactContent({
    businessName: globalValues.businessName,
    businessType: globalValues.businessType,
    location: globalValues.location,
    phone: globalValues.phone,
  });

  contact = contact
    .replace(/{{JSON_LD_SCHEMA}}/g, globalValues.contactSchema || globalValues.jsonLdString || '')
    .replace(/{{FAVICON_PATH}}/g, globalValues.favicon)
    .replace(/{{LOGO_PATH}}/g, globalValues.logo)
    .replace(/{{LOGO_ALT}}/g, `Logo image of ${globalValues.businessName} in ${globalValues.location}`)
    .replace(/{{LOGO_TITLE}}/g, `Logo image of ${globalValues.businessName} in ${globalValues.location}`)
    .replace(/{{LOGO_WIDTH}}/g, String(globalValues.logoWidth))
    .replace(/{{LOGO_HEIGHT}}/g, String(globalValues.logoHeight))
    .replace(/{{PAGE_TITLE}}/g, `Contact ${globalValues.businessName} | ${globalValues.location}`)
    .replace(/{{META_DESCRIPTION}}/g,
      `Contact ${globalValues.businessName} in ${globalValues.location}. Call ${globalValues.phone} or send a message for a free estimate.`)

    .replace(/{{HERO_IMG_MOBILE}}/g,  `assets/${seoPrefix}-heroMobile.webp`)
    .replace(/{{HERO_IMG_TABLET}}/g,  `assets/${seoPrefix}-heroTablet.webp`)
    .replace(/{{HERO_IMG_DESKTOP}}/g, `assets/${seoPrefix}-heroDesktop.webp`)
    .replace(/{{HERO_IMG_LARGE}}/g,   `assets/${seoPrefix}-heroLarge.webp`)
    .replace(/{{HERO_IMG_ALT}}/g, escapeAttr(heroAlt))
    .replace(/{{HERO_IMG_TITLE}}/g, escapeAttr(heroAlt))

    .replace(/{{BUSINESS_NAME}}/g, globalValues.businessName.toUpperCase())
    .replace(/{{LOCATION}}/g, globalValues.location)

    .replace(/{{CONTACT_H2}}/g, escapeAttr(intro.heading).toUpperCase())
    .replace(/{{CONTACT_P1}}/g, intro.paragraphs[0] || '')
    .replace(/{{CONTACT_P2}}/g, intro.paragraphs[1] || '')

    // The home page's form, unchanged
    .replace(/{{FORM}}/g, formHtml || '')

    .replace(/{{ADDRESS}}/g, globalValues.address || '')
    .replace(/{{EMAIL}}/g, globalValues.email || '')
    .replace(/{{HOURS_TIME}}/g, getHoursTimeText(globalValues.is24Hours, globalValues.hours))
    .replace(/{{PHONE_RAW}}/g, formatPhoneForHref(globalValues.phone))
    .replace(/{{PHONE_DISPLAY}}/g, globalValues.phone || '')
    .replace(/{{MAP_IFRAME_SRC}}/g, globalValues.mapEmbed || '')
    .replace(/{{MAP_IFRAME_TITLE}}/g,
      escapeAttr(`Google map of ${globalValues.businessName} — ${globalValues.address || globalValues.location}`))

    .replace(/{{CURRENT_YEAR}}/g, new Date().getFullYear())
    .replace(/{{SOCIAL_LINKS}}/g, buildSocialLinks(globalValues));

  // Remove the form section (and its comment) when no form was selected,
  // so the page isn't left with an empty <section></section>.
  if (!hasForm) {
    contact = contact
      .replace(/<section id="contact-form-section">[\s\S]*?<\/section>\s*/i, '')
      .replace(/<!--\s*Contact form:[\s\S]*?-->\s*/i, '');
  }

  // Remove the email line and its rule when no email was given
  if (!(globalValues.email || '').trim()) {
    contact = contact.replace(
      /<p[^>]*>\s*(?:{{EMAIL}}|undefined|&nbsp;|\s)*<\/p>\s*(?:<hr[^>]*>\s*)?/gi,
      ''
    );
  }

  contact = contact.replace('</head>', `
    <link rel="stylesheet" href="./css/bootstrap.min.css">
    <link rel="stylesheet" href="./css/contact.css">
  </head>`);

  contact = contact.replace('</body>', `
    <script src="./js/bootstrap.bundle.min.js"></script>
  </body>`);

  contact = fillLegalLinks(contact, globalValues);

  fs.writeFileSync(contactPath, contact);

  writePageAssets({
    distDir,
    cssDir,
    entryName: 'contact',
    cssName: 'contact',
    styleKey: globalValues.styleKey,
  });

  // === Semantic model for the WordPress exporter ===
  return {
    type: CM.PAGE_TYPES.CONTACT,
    htmlFile: 'contact.html',
    slug: 'contact',
    cssName: 'contact',
    title: 'Contact',
    isFrontPage: false,
    menuOrder: 9000,
    meta: {
      title: `Contact ${globalValues.businessName} | ${globalValues.location}`,
      description: `Contact ${globalValues.businessName} in ${globalValues.location}.`,
    },
    schema: globalValues.contactSchema || '',
    sections: [
      CM.heroSection({
        h1: globalValues.businessName.toUpperCase(),
        tagline: globalValues.location,
        imageList: CM.heroImages({
          heroMobile:  `assets/${seoPrefix}-heroMobile.webp`,
          heroTablet:  `assets/${seoPrefix}-heroTablet.webp`,
          heroDesktop: `assets/${seoPrefix}-heroDesktop.webp`,
          heroLarge:   `assets/${seoPrefix}-heroLarge.webp`,
        }, heroAlt, heroAlt),
      }),
      CM.section({
        key: 'contactIntro',
        label: 'Contact Intro',
        type: CM.SECTION_TYPES.TEXT,
        source: { heading: intro.heading, paragraphs: intro.paragraphs },
      }),
      // Only exported when the user opted in to the form
      ...(hasForm
        ? [{
            key: 'form', label: 'Contact Form',
            type: CM.SECTION_TYPES.FORM,
            heading: '', paragraphs: [], images: [],
          }]
        : []),
      {
        key: 'napMap', label: 'Contact Details & Map',
        type: CM.SECTION_TYPES.NAP_MAP,
        heading: '', paragraphs: [], images: [],
        mapEmbed: globalValues.mapEmbed || '',
      },
    ],
    interlinks: [],
  };
};

module.exports = { buildContactPage };