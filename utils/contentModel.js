// utils/contentModel.js
//
// The generator already knows exactly what every piece of content IS:
// "section 2's heading", "the hero tablet image", "the business phone".
// Until now that knowledge was rendered into HTML and thrown away, forcing
// the WordPress exporter to regex-scrape it back out — which loses the
// meaning and produces admin labels like "Block 3 → Heading 2 #1".
//
// This module captures the semantic model as it is generated and writes it
// to <distDir>/_src/content.json. The WordPress builder reads that file
// instead of parsing HTML, so every editable field keeps a real name.
//
// _src/ is stripped from the production copy before zipping, so this file
// never ships to the end user.

const fs = require('fs');
const path = require('path');

const MODEL_VERSION = 1;
const MODEL_FILENAME = 'content.json';

/**
 * Section vocabulary. The WordPress renderer switches on these, so keep the
 * list small and stable — adding a value means teaching the renderer about it.
 *
 *   hero         big heading + tagline + responsive image set
 *   text         heading (+ optional subheading) + paragraphs
 *   text-images   heading + paragraphs + images
 *   video        single embedded video
 *   form         contact form placeholder
 *   nap-map      name/address/phone block + map embed
 */
const SECTION_TYPES = {
  HERO: 'hero',
  TEXT: 'text',
  TEXT_IMAGES: 'text-images',
  VIDEO: 'video',
  FORM: 'form',
  FAQ: 'faq',
  PRICING: 'pricing',
  NAP_MAP: 'nap-map',
};

const PAGE_TYPES = {
  ABOUT: 'about',
  SERVICE: 'service',
  LOCATION: 'location',
  LEGAL: 'legal',
};


/**
 * One image. `role` is the stable identifier the WordPress media picker
 * binds to, so it must not change between builds.
 */
function image({ role, src, alt = '', title = '', width = null, height = null }) {
  if (!src) return null;
  return {
    role,
    src: String(src).replace(/^\.?\//, ''),
    alt: String(alt || ''),
    title: String(title || ''),
    width,
    height,
    swappable: true,
  };
}

/** Drop nulls so a missing image never becomes an empty media slot. */
function images(list = []) {
  return list.filter(Boolean);
}


/**
 * Normalise a { heading, subheading, paragraphs[] } object from the AI
 * output into a model section. Tolerates a missing or partial section.
 */
function section({ key, label, type = SECTION_TYPES.TEXT, source = {}, imageList = [], extra = {} }) {
  const paragraphs = Array.isArray(source.paragraphs)
    ? source.paragraphs.filter(p => p !== undefined && p !== null).map(String)
    : [];

  const s = {
    key,
    label,
    type,
    heading: source.heading ? String(source.heading) : '',
    paragraphs,
    images: images(imageList),
  };

  if (source.subheading) s.subheading = String(source.subheading);

  return Object.assign(s, extra);
}


/**
 * Standard hero section shared by every generated page type.
 */
function heroSection({ h1, tagline, imageList = [] }) {
  return {
    key: 'hero',
    label: 'Hero',
    type: SECTION_TYPES.HERO,
    heading: String(h1 || ''),
    subheading: String(tagline || ''),
    paragraphs: [],
    images: images(imageList),
  };
}


/**
 * Build the four hero image variants from a src map.
 * srcMap: { heroMobile, heroTablet, heroDesktop, heroLarge }
 */
function heroImages(srcMap = {}, alt = '', title = '') {
  return images([
    image({ role: 'hero-mobile',  src: srcMap.heroMobile,  alt, title, width: 600,  height: 350 }),
    image({ role: 'hero-tablet',  src: srcMap.heroTablet,  alt, title, width: 750,  height: 400 }),
    image({ role: 'hero-desktop', src: srcMap.heroDesktop, alt, title, width: 1250, height: 700 }),
    image({ role: 'hero-large',   src: srcMap.heroLarge,   alt, title, width: 1400, height: 700 }),
  ]);
}


/**
 * Create the empty model. Global values are flattened into exactly the
 * fields the WordPress Theme Settings page exposes, so no inference is
 * needed at export time.
 */
function createModel(globalValues = {}) {
  return {
    version: MODEL_VERSION,
    generatedAt: new Date().toISOString(),

    global: {
      businessName: globalValues.businessName || '',
      businessType: globalValues.businessType || '',
      location: globalValues.location || '',

      phone: globalValues.phone || '',
      email: globalValues.email || '',
      address: globalValues.address || '',
      domain: globalValues.domain || '',

      logo: globalValues.logo || '',
      favicon: globalValues.favicon || '',
      logoType: globalValues.logoType || 'rect',
      logoWidth: globalValues.logoWidth || null,
      logoHeight: globalValues.logoHeight || null,

      styleKey: globalValues.styleKey || 'style',

      hours: globalValues.hours || {},
      is24Hours: globalValues.is24Hours || false,

      social: {
        facebook: globalValues.facebookUrl || '',
        twitter: globalValues.twitterUrl || '',
        instagram: globalValues.instagramUrl || '',
        linkedin: globalValues.linkedinUrl || '',
        youtube: globalValues.youtubeUrl || '',
        pinterest: globalValues.pinterestUrl || '',
      },

      googleMapCid: globalValues.googleMapCid || '',
      mapEmbed: globalValues.mapEmbed || '',
      youtubeVideoUrl: globalValues.youtubeVideoUrl || '',
      useNearMe: String(globalValues.useNearMe) === 'true',
      showAboutForm: !!globalValues.showAboutForm,
    },

    pages: [],
  };
}


/**
 * Append a page. Ignores falsy input so callers can pass through a builder
 * that decided not to produce a page.
 */
function addPage(model, page) {
  if (!model || !page) return model;
  model.pages.push(page);
  return model;
}

function addPages(model, pages = []) {
  (pages || []).forEach(p => addPage(model, p));
  return model;
}


/**
 * FAQ section built from People Also Ask questions and their generated
 * answers. Stored as a list of pairs so the WordPress admin can show one
 * labelled field per question.
 */
function faqSection(faqs = [], label = 'FAQ') {
  const items = (faqs || []).filter(f => f && f.question && f.answer);
  if (!items.length) return null;

  return {
    key: 'faq',
    label,
    type: SECTION_TYPES.FAQ,
    heading: 'Frequently Asked Questions',
    paragraphs: [],
    images: [],
    faqs: items.map(f => ({
      question: String(f.question).trim(),
      answer: String(f.answer).trim(),
    })),
  };
}

/**
 * Pricing section. Rows are stored individually so the WordPress admin can
 * expose one labelled field per service, letting an owner replace generated
 * estimates with their real figures.
 */
function pricingSection(rows = [], opts = {}) {
  const items = (rows || []).filter(r => r && r.name && r.low && r.high);
  if (!items.length) return null;

  return {
    key: 'pricing',
    label: 'Pricing',
    type: SECTION_TYPES.PRICING,
    heading: opts.heading || 'Typical Service Pricing',
    paragraphs: [],
    images: [],
    notice: opts.notice || '',
    pricing: items.map(r => ({
      name: String(r.name).trim(),
      low: Number(r.low),
      high: Number(r.high),
      unit: String(r.unit || 'per job').trim(),
      note: String(r.note || '').trim(),
    })),
  };
}

/**
 * Turn a legal page's rendered template into model sections.
 *
 * The privacy / terms / accessibility templates are boilerplate: one
 * <section> containing an <h1>, some <p>s, and occasionally an <h2> that
 * starts a new block. Their text lives only in those templates, so without
 * this the WordPress export produced blank legal pages — which are linked
 * from every footer.
 *
 * Content is split at each heading so the original order is preserved, and
 * the first heading keeps its <h1> level.
 */
function sectionsFromLegalHtml(html) {
  if (!html) return [];

  const sectionMatch = String(html).match(/<section[^>]*>([\s\S]*?)<\/section>/i);
  if (!sectionMatch) return [];

  const inner = sectionMatch[1];
  const clean = str => String(str)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();

  // Headings and paragraphs, in document order
  const blocks = [...inner.matchAll(/<(h1|h2|h3|p)[^>]*>([\s\S]*?)<\/\1>/gi)]
    .map(m => ({ tag: m[1].toLowerCase(), text: clean(m[2]) }))
    .filter(b => b.text !== '');

  const sections = [];
  let current = null;
  let index = 0;

  for (const block of blocks) {
    if (block.tag === 'p') {
      if (!current) {
        current = { heading: '', headingTag: 'h2', paragraphs: [] };
      }
      current.paragraphs.push(block.text);
      continue;
    }

    // A heading starts a new block
    if (current) sections.push(current);
    current = { heading: block.text, headingTag: block.tag, paragraphs: [] };
  }

  if (current) sections.push(current);

  return sections.map(s => {
    const key = index === 0 ? 'content' : `content${index}`;
    index++;
    return {
      key,
      label: s.heading || 'Page Content',
      type: SECTION_TYPES.TEXT,
      heading: s.heading,
      headingTag: s.headingTag,
      paragraphs: s.paragraphs,
      images: [],
    };
  });
}


/**
 * Minimal record for the boilerplate legal pages. They have no AI content
 * and no images, so the WordPress side only needs to know they exist.
 */
function legalPage({ slug, title, menuOrder, sections = [], meta = null }) {
  return {
    type: PAGE_TYPES.LEGAL,
    htmlFile: `${slug}.html`,
    slug,
    cssName: slug,
    title,
    isFrontPage: false,
    menuOrder,
    meta: meta || { title, description: title },
    sections,
  };
}


/**
 * Write the model. Never throws: failing to write content.json must not
 * fail a generation that otherwise succeeded.
 */
function writeModel(distDir, model) {
  try {
    const dir = path.join(distDir, '_src');
    fs.mkdirSync(dir, { recursive: true });

    const target = path.join(dir, MODEL_FILENAME);
    fs.writeFileSync(target, JSON.stringify(model, null, 2), 'utf8');

    const count = (model.pages || []).length;
    console.log(`🧩 content.json written (${count} page${count === 1 ? '' : 's'})`);
    return target;
  } catch (err) {
    console.error('⚠️ Could not write content.json:', err.message);
    return null;
  }
}


/**
 * Read the model back. Returns null when absent, so the WordPress builder
 * can fall back to the old HTML scraper during migration.
 */
function readModel(distDir) {
  try {
    const target = path.join(distDir, '_src', MODEL_FILENAME);
    if (!fs.existsSync(target)) return null;
    return JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (err) {
    console.error('⚠️ Could not read content.json:', err.message);
    return null;
  }
}


module.exports = {
  MODEL_VERSION,
  MODEL_FILENAME,
  SECTION_TYPES,
  PAGE_TYPES,
  image,
  images,
  section,
  heroSection,
  heroImages,
  createModel,
  addPage,
  addPages,
  legalPage,
  sectionsFromLegalHtml,
  faqSection,
  pricingSection,
  writeModel,
  readModel,
};