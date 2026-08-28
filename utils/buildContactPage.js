// utils/buildContactPage.js
//
// The contact page: hero -> AI intro -> form -> NAP/map.
//
// The form and the NAP block are the SAME ones the home page uses, reached
// through the same {{FORM}} placeholder and the same NAP markup. Nothing is
// duplicated: change the form once and both pages follow.
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
const { injectPagesInterlinks } = require('./injectPagesInterlinks');
const { stripUnusedHero } = require('./stripUnusedHero');
const { contactMeta, businessNoun } = require('./pageMeta');
const { copyPageImage } = require('./pageParts');
const { assetPath, imageAlt } = require('./seoPresets');
const { canonicalTag } = require('./canonicalUrl');
const CM = require('./contentModel');

const basePath = '';

/**
 * The services list: plain names, not links.
 *
 * The nav already links to every service page — repeating those links here
 * adds nothing for a visitor and dilutes the one link that matters on this
 * page, which is the business name going home.
 */
function buildServicesList(pages = []) {
  const names = (Array.isArray(pages) ? pages : Object.values(pages || {}))
    .map(p => String(p && p.filename || '').trim())
    .filter(Boolean);

  if (!names.length) return '';

  const items = names
    .map(name => `          <li>${escapeAttr(name)}</li>`)
    .join('\n');

  return `<h3>Our Services</h3>
        <ul class="contact-services-list">
${items}
        </ul>`;
}

const buildContactPage = async function (
  distDir,
  cssDir,
  globalValues,
  pages,
  formHtml = '',
  contactInterlinks = []
) {
  const contactPath = path.join(distDir, 'contact.html');
  if (fs.existsSync(contactPath)) {
    return null;
  }

  let contact = fs.readFileSync(path.join(__dirname, '../src/contactTemplate.html'), 'utf-8');

  const businessType = slugify(globalValues.businessType || '');
  // No business name: it belongs on the home page, not repeated into every
  // filename across the site. "contact" leads so the page is identifiable
  // from the filename alone.
  //
  // UNCHANGED IN EVERY MODE, including Rank Fast. Only the index page drops
  // its prefix, and only because there is exactly one index page.
  const seoPrefix = `contact-${slugify(globalValues.location)}`;

  // One definition of where this page's images live, used by the <img src>
  // and by the WordPress model at the bottom of this file.
  const img = (field) => assetPath(seoPrefix, field);

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

  // The hero's alt/title.
  //
  //   Rank GBPs   a plumber's van in Leander, TX - Leander, TX
  //   Rank Fast   a plumber's van
  //
  // Built through the preset rather than interpolated here, so the mode's
  // format reaches this page too. buildAltText has already dropped the
  // location for Rank Fast; appending it back at this call site is exactly
  // how a format ends up half applied.
  const heroAlt = imageAlt(
    globalValues,
    altTexts['hero-mobile'] || globalValues.businessType,
    { suffix: globalValues.location }
  );

  // The intro
  const intro = await generateContactContent({
    businessName: globalValues.businessName,
    businessType: globalValues.businessType,
    location: globalValues.location,
    phone: globalValues.phone,
  });

  // Weave the ring targets into the intro copy — the same treatment service
  // and location pages get. Falls back to the raw intro if the injector
  // cannot find a natural place, so a failure here never blanks the page.
  let introSections = { section1: { heading: intro.heading, paragraphs: intro.paragraphs } };

  try {
    // Called even with NO targets — which is every Rank Fast build, and any
    // build whose ring is empty.
    //
    // Injecting links is not all this does: its first act on each paragraph
    // is stripMarkdownLinks(), turning the [text](url) the content generator
    // sometimes emits back into plain text. Handed an empty list it strips
    // that markdown and injects nothing. The old `if (contactInterlinks.length)`
    // guard skipped the call, so a stray markdown link in the intro shipped
    // raw — the one page on the site where that is most visible.
    introSections = injectPagesInterlinks(
      globalValues,
      // Array form: the injector calls .find on this, and `pages` arrives
      // from the form as an object keyed by index.
      Array.isArray(pages) ? pages : Object.values(pages || {}),
      { slug: 'contact' },     // so the injector does not self-link
      contactInterlinks,
      introSections,
      globalValues.location,
      {
        // Link the trade, not the business name. The intro is written to
        // say "our plumbing company", and this turns that phrase into the
        // link home.
        // businessNoun picks the right word: "our law firm", "our practice",
        // "our plumbing company". Appending "company" to everything gave
        // "our law firm company".
        homeAnchor: `our ${businessNoun(globalValues.businessType)}`,
      }
    );
  } catch (err) {
    console.warn('   ⚠️ Could not interlink the contact intro:', err.message);
  }

  const introHeading = introSections.section1?.heading || intro.heading;
  const introParas = introSections.section1?.paragraphs || intro.paragraphs;

  contact = contact
    // Self-referencing canonical, matching the sitemap's entry for this page.
    .replace(/{{CANONICAL}}/g, () => (canonicalTag(globalValues, 'contact.html')))
    .replace(/{{JSON_LD_SCHEMA}}/g, () => (globalValues.contactSchema || globalValues.jsonLdString || ''))
    .replace(/{{FAVICON_PATH}}/g, () => (globalValues.favicon))
    .replace(/{{LOGO_PATH}}/g, () => (globalValues.logo))
    .replace(/{{LOGO_ALT}}/g, () => (`Logo image of ${globalValues.businessName} in ${globalValues.location}`))
    .replace(/{{LOGO_TITLE}}/g, () => (`Logo image of ${globalValues.businessName} in ${globalValues.location}`))
    .replace(/{{LOGO_WIDTH}}/g, () => (String(globalValues.logoWidth)))
    .replace(/{{LOGO_HEIGHT}}/g, () => (String(globalValues.logoHeight)))
    // From utils/pageMeta.js — the trade and the place, no business name.
    // Identical in every mode: only the index page's format varies.
    .replace(/{{PAGE_TITLE}}/g, () => (contactMeta(globalValues).title))
    .replace(/{{META_DESCRIPTION}}/g, () => (contactMeta(globalValues).description))

    .replace(/{{HERO_IMG_MOBILE}}/g, () => (img('heroMobile')))
    .replace(/{{HERO_IMG_TABLET}}/g, () => (img('heroTablet')))
    .replace(/{{HERO_IMG_DESKTOP}}/g, () => (img('heroDesktop')))
    .replace(/{{HERO_IMG_LARGE}}/g, () => (img('heroLarge')))
    .replace(/{{HERO_IMG_ALT}}/g, () => (escapeAttr(heroAlt)))
    .replace(/{{HERO_IMG_TITLE}}/g, () => (escapeAttr(heroAlt)))

    .replace(/{{BUSINESS_NAME}}/g, () => (globalValues.businessName.toUpperCase()))
    .replace(/{{LOCATION}}/g, () => (globalValues.location))

    .replace(/{{CONTACT_DETAILS_H3}}/g, () => ('Contact Details'))
    // The hero heading is "Contact Us", not the business name.
    //
    // The name is already in the nav, the details block, the NAP block and
    // the footer; as an H1 here it says nothing about what the page is for.
    // "Contact Us" tells a visitor they are in the right place.
    .replace(/{{HERO_H1}}/g, () => ('Contact Us'))

    .replace(/{{BUSINESS_NAME_TITLE}}/g, () => (escapeAttr(globalValues.businessName || '')))
    .replace(/{{SERVICES_LIST}}/g, () => (buildServicesList(pages)))

    .replace(/{{CONTACT_H2}}/g, () => (escapeAttr(introHeading).toUpperCase()))
    // NOT escaped: the interlinker has inserted <a> tags, and escaping here
    // would render them as visible markup.
    .replace(/{{CONTACT_P1}}/g, () => (introParas[0] || ''))
    .replace(/{{CONTACT_P2}}/g, () => (introParas[1] || ''))

    // The home page's form, unchanged
    .replace(/{{FORM}}/g, () => (formHtml || ''))

    .replace(/{{ADDRESS}}/g, () => (globalValues.address || ''))
    .replace(/{{EMAIL}}/g, () => (globalValues.email || ''))
    .replace(/{{HOURS_TIME}}/g, () => (getHoursTimeText(globalValues.is24Hours, globalValues.hours)))
    .replace(/{{PHONE_RAW}}/g, () => (formatPhoneForHref(globalValues.phone)))
    .replace(/{{PHONE_DISPLAY}}/g, () => (globalValues.phone || ''))
    .replace(/{{MAP_IFRAME_SRC}}/g, () => (globalValues.mapEmbed || ''))
    .replace(/{{MAP_IFRAME_TITLE}}/g, () => (escapeAttr(`Google map of ${globalValues.businessName} — ${globalValues.address || globalValues.location}`)))

    .replace(/{{CURRENT_YEAR}}/g, () => (new Date().getFullYear()))
    .replace(/{{SOCIAL_LINKS}}/g, () => (buildSocialLinks(globalValues)));

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

  // Remove whichever hero block this theme does not use.
  //
  // The template carries both — a standard side-by-side layout and an overlay
  // one — and the CSS shows the right one per theme. Without this the contact
  // page shipped BOTH in the markup, so the hero appeared twice.
  //
  // Every other page builder already did this; the contact page was missed
  // when it was added.
  contact = stripUnusedHero(contact, globalValues.styleKey);

  fs.writeFileSync(contactPath, contact);

  writePageAssets({
    distDir,
    cssDir,
    entryName: 'contact',
    cssName: 'contact',
    styleKey: globalValues.styleKey,
  });

  // === Semantic model for the WordPress exporter ===
  //
  // SECOND PASS. `img()` and `heroAlt` are the same ones the HTML above used,
  // so the exported theme cannot disagree with the downloaded page.
  return {
    type: CM.PAGE_TYPES.CONTACT,
    htmlFile: 'contact.html',
    slug: 'contact',
    cssName: 'contact',
    title: 'Contact',
    isFrontPage: false,
    menuOrder: 9000,
    meta: {
      // From pageMeta, the same source the static template uses — these were
      // hardcoded separately and had drifted from it.
      title: contactMeta(globalValues).title,
      description: contactMeta(globalValues).description,
    },
    schema: globalValues.contactSchema || '',
    sections: [
      CM.heroSection({
        // Must match the static page, or the exported WordPress theme shows
        // the business name where the downloaded site shows "Contact Us".
        h1: 'CONTACT US',
        tagline: globalValues.location,
        imageList: CM.heroImages({
          heroMobile:  img('heroMobile'),
          heroTablet:  img('heroTablet'),
          heroDesktop: img('heroDesktop'),
          heroLarge:   img('heroLarge'),
        }, heroAlt, heroAlt),
      }),
      CM.section({
        key: 'contactIntro',
        label: 'Contact Intro',
        type: CM.SECTION_TYPES.TEXT,
        // introParas, NOT intro.paragraphs.
        //
        // intro.paragraphs is the raw model output; introParas is the same
        // text after the interlinker has added the link home. Storing the raw
        // version meant the WordPress contact page had no link back to the
        // front page at all, while the static one did.
        source: { heading: introHeading, paragraphs: introParas },
      }),
      // Only modelled when the page actually has one, or the exported
      // WordPress theme would show a form the downloaded site does not.
      ...(formHtml ? [{
        key: 'form', label: 'Contact Form',
        type: CM.SECTION_TYPES.FORM,
        heading: '', paragraphs: [], images: [],
      }] : []),
      {
        key: 'napMap', label: 'Contact Details & Map',
        type: CM.SECTION_TYPES.NAP_MAP,
        heading: '', paragraphs: [], images: [],
        mapEmbed: globalValues.mapEmbed || '',
      },
    ],
    interlinks: contactInterlinks || [],
  };
};

module.exports = { buildContactPage };