// utils/wpThemeBuilder/dataFiles/themeModel.js
//
// Converts content.json (written by the site generator) into
// theme-content-model.php, which theme activation reads to populate
// every page's editable fields.
//
// No HTML is parsed anywhere in this path.

const { phpEscapeSingle } = require('../wpHelpers/phpHelpers');
const { displayTrustPoint } = require('../../businessShape');

/**
 * CSS classes the generated stylesheets expect, keyed by section.
 * Mirrors src/template.html so the chosen theme still applies.
 */
const SECTION_STYLE = {
  section1: { css_class: 'section-1' },
  section2: { css_class: 'section-2', row_class: 'row-first-section-2-img', cta_after: true },
  section3: { css_class: 'section-3' },
  section4: { css_class: 'section-4', row_class: 'row-second-section-2-img' },
  nearMe:   { css_class: 'nearme' },
  section5: { css_class: 'section-5' },
};

function php(value, indent) {
  const pad = '    '.repeat(indent);
  const inner = '    '.repeat(indent + 1);

  if (value === null || value === undefined) return "''";
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);

  if (Array.isArray(value)) {
    if (!value.length) return 'array()';
    const items = value.map(v => `${inner}${php(v, indent + 1)}`).join(",\n");
    return `array(\n${items},\n${pad})`;
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value);
    if (!keys.length) return 'array()';
    const items = keys
      .map(k => `${inner}'${phpEscapeSingle(k)}' => ${php(value[k], indent + 1)}`)
      .join(",\n");
    return `array(\n${items},\n${pad})`;
  }

  return `'${phpEscapeSingle(String(value))}'`;
}

/**
 * Turn one content.json section into the shape activation and the renderer
 * both expect.
 */
function normaliseSection(section) {
  const style = SECTION_STYLE[section.key] || {};

  const out = {
    key: section.key,
    label: section.label || section.key,
    type: section.type,
    heading: section.heading || '',
    subheading: section.subheading || '',
    paragraphs: Array.isArray(section.paragraphs) ? section.paragraphs : [],
    images: (section.images || []).map(img => ({
      role: img.role,
      src: img.src || '',
      alt: img.alt || '',
      width: img.width || '',
      height: img.height || '',
    })),
    image_roles: (section.images || []).map(img => img.role),
  };

  // SECTION_STYLE is a fallback keyed on the section key, and a key does not
  // uniquely identify a layout — 'section4' is a two-image block on a service
  // page and the service-area block on the About page. A section that names
  // its own class or layout therefore wins over the table.
  const cssClass = section.cssClass || style.css_class;
  const rowClass = section.rowClass || style.row_class;

  if (cssClass) out.css_class = cssClass;
  if (rowClass) out.row_class = rowClass;
  if (style.cta_after) out.cta_after = true;

  // 'side'  -> text and one media slot side by side (col-md-7 / col-md-5),
  //            which is what buildAboutMediaHtml() renders on the static page
  // absent  -> the stacked two-image layout used by sections 2 and 3
  if (section.mediaLayout) out.media_layout = section.mediaLayout;

  // Nesting, declared by the child. The renderer draws this section inside
  // the named section's .container instead of after it. Only types that emit
  // no wrapper of their own are eligible — see ${p}_nestable_types() in the
  // renderer, which ignores the hint for anything else rather than producing
  // a <section> inside a <section>.
  if (section.nestIn) out.nest_in = section.nestIn;

  if (section.headingTag) out.heading_tag = section.headingTag;

  if (Array.isArray(section.cards) && section.cards.length) {
    out.cards = section.cards.map(c => ({
      name: String(c.name || ''),
      line: String(c.line || ''),
    }));
  }

  if (Array.isArray(section.trustPoints) && section.trustPoints.length) {
    // Capitalised here rather than in the PHP renderer: the theme bakes
    // these strings into post meta at export, so whatever is written now is
    // what the site shows forever. Same function as the static page uses.
    out.trust_points = section.trustPoints.map(displayTrustPoint).filter(Boolean);
  }

  if (section.badges && (section.badges.award || section.badges.licensed)) {
    // Append the badge roles so the meta box renders a media picker for each.
    if (section.badges.award) out.image_roles.push('award-badge');
    if (section.badges.licensed) out.image_roles.push('licensed-badge');

    out.badges = {
      award: String(section.badges.award || ''),
      award_alt: String(section.badges.awardAlt || ''),
      licensed: String(section.badges.licensed || ''),
      licensed_alt: String(section.badges.licensedAlt || ''),
    };
  }

  if (Array.isArray(section.pricing) && section.pricing.length) {
    out.pricing = section.pricing.map(r => ({
      name: String(r.name || ''),
      low: Number(r.low) || 0,
      high: Number(r.high) || 0,
      unit: String(r.unit || ''),
      note: String(r.note || ''),
    }));
  }
  if (section.notice) out.notice = String(section.notice);

  /* REVIEWS.
   *
   * THIS FUNCTION IS A WHITELIST, AND THAT IS THE TRAP. `out` is built field
   * by field, so a section property with no line here is dropped silently on
   * the way to WordPress — no error, no warning, just a section that arrives
   * with its content missing and gets skipped as empty.
   *
   * That is what happened: the REVIEWS type was wired through the content
   * model, the activation import, the meta boxes and the renderer, every one
   * of them tested, and the reviews still never reached WordPress because
   * they were thrown away here, one step before the import.
   *
   * themeActivationPhp.js has a comment about the identical failure in its
   * own descriptor whitelist — "any hint added to the model later was
   * silently dropped on import" — which is the same lesson this file had not
   * yet learned. If a new structured section type is added, it needs a line
   * HERE as well as everywhere else, and a test that walks a real section
   * through normaliseSection rather than just checking the source. */
  if (Array.isArray(section.reviews) && section.reviews.length) {
    out.reviews = section.reviews.map(r => ({
      text: String(r.text || ''),
      name: String(r.name || ''),
      stars: Number(r.stars) || 0,
    }));
  }
  // The line that says the reviews are samples to be replaced. Separate from
  // `notice` above, which belongs to the pricing table.
  if (section.note) out.note = String(section.note);

  if (Array.isArray(section.faqs) && section.faqs.length) {
    out.faqs = section.faqs.map(f => ({
      question: String(f.question || ''),
      answer: String(f.answer || ''),
    }));
  }
  if (section.videoUrl) out.video_url = section.videoUrl;

  // Does this section have a video slot at all? Separate from whether one is
  // SET — a section with an empty video_url still needs the field in wp-admin
  // so the owner can add one, and a section without the slot must not show it.
  // See the comment on supportsVideo in buildAboutUsPage.js.
  if (section.supportsVideo) out.supports_video = true;
  if (section.mapEmbed) out.map_embed = section.mapEmbed;
  if (section.addressOverride) out.address_override = section.addressOverride;

  return out;
}

/**
 * Which PHP template file a page should use.
 */
function templateFor(page) {
  if (page.isFrontPage) return 'front-page.php';
  return `page-${page.slug}.php`;
}

function normalisePage(page) {
  return {
    type: page.type,
    slug: page.slug,
    title: page.title || page.slug,
    template: templateFor(page),
    is_front_page: !!page.isFrontPage,
    menu_order: typeof page.menuOrder === 'number' ? page.menuOrder : 0,
    meta_title: (page.meta && page.meta.title) || '',
    meta_description: (page.meta && page.meta.description) || '',
    schema: page.schema || '',
    city: page.cityForSchema || '',
    sections: (page.sections || []).map(normaliseSection),
  };
}

/**
 * Flatten global values into the keys the Theme Settings page exposes.
 */
function normaliseGlobal(global = {}, hoursText = '') {
  const social = global.social || {};
  return {
    business_name: global.businessName || '',
    business_type: global.businessType || '',
    location: global.location || '',
    phone: global.phone || '',
    email: global.email || '',
    contact_email: global.email || '',
    address: global.address || '',
    hours_text: hoursText || '',
    logo: global.logo || '',
    favicon: global.favicon || '',
    logo_width: global.logoWidth || 150,
    logo_height: global.logoHeight || 100,
    social_facebook: social.facebook || '',
    social_twitter: social.twitter || '',
    social_instagram: social.instagram || '',
    social_linkedin: social.linkedin || '',
    social_youtube: social.youtube || '',
    social_pinterest: social.pinterest || '',
    google_map_cid: global.googleMapCid || '',
  };
}

/**
 * Build theme-content-model.php from a content.json model.
 */
function generateThemeModelPhp(model, options = {}) {
  const { hoursText = '' } = options;

  if (!model || !Array.isArray(model.pages)) {
    return `<?php
/**
 * Theme Content Model
 * Empty: no content model was supplied.
 */
if ( ! defined( 'ABSPATH' ) ) { exit; }
return array( 'global' => array(), 'pages' => array() );
`;
  }

  const payload = {
    version: model.version || 1,
    generated_at: model.generatedAt || '',
    global: normaliseGlobal(model.global, hoursText),
    pages: model.pages.map(normalisePage),
  };

  return `<?php
/**
 * Theme Content Model
 *
 * Generated directly from the site generator's semantic model
 * (content.json) — no HTML was parsed to produce this file.
 *
 * Structure:
 *   'global' => site-wide settings (business info, contact, socials)
 *   'pages'  => ordered pages, each with ordered 'sections'
 *
 * Each section carries its own key, human label, type, heading,
 * paragraphs and images, so the admin can label every field properly
 * and the renderer can rebuild the page from fields on every request.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

return ${php(payload, 0)};
`;
}

module.exports = {
  generateThemeModelPhp,
  normalisePage,
  normaliseSection,
  normaliseGlobal,
  SECTION_STYLE,
};