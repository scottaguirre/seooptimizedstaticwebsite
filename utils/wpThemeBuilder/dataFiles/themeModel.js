// utils/wpThemeBuilder/dataFiles/themeModel.js
//
// Converts content.json (written by the site generator) into
// theme-content-model.php, which theme activation reads to populate
// every page's editable fields.
//
// No HTML is parsed anywhere in this path.

const { phpEscapeSingle } = require('../wpHelpers/phpHelpers');

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

  if (style.css_class) out.css_class = style.css_class;
  if (style.row_class) out.row_class = style.row_class;
  if (style.cta_after) out.cta_after = true;

  if (section.headingTag) out.heading_tag = section.headingTag;

  if (Array.isArray(section.faqs) && section.faqs.length) {
    out.faqs = section.faqs.map(f => ({
      question: String(f.question || ''),
      answer: String(f.answer || ''),
    }));
  }
  if (section.videoUrl) out.video_url = section.videoUrl;
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