// utils/seoPresets.js
//
// Every format that differs between site modes, in one place.
//
// The app has three modes. Two of them build the same site; what separates
// them is how titles, descriptions, alt text and image filenames are written:
//
//   'rankfast'  Rank Fast       new formats — see RANK_FAST below
//   'sample'    One-Page Design a one-page design sample
//   'lead'      Rank GBPs       the original formats, unchanged
//
// 'lead' keeps its value because Job records and content.json files already
// hold it; only its wizard label changed, from "Rank Fast" to "Rank GBPs".
// Nothing needs migrating.
//
// WHY A MODULE RATHER THAN AN `if` AT EACH CALL SITE
// The formats are read from at least eight files, and several builders render
// the static page and build the WordPress model in two separate passes over
// the same data. An inline branch has to be repeated in both passes or the
// downloaded site and the exported theme disagree — which has already
// happened here more than once. A preset is looked up once and both passes
// read the same object.

const { slugify } = require('./slugify');

const MODES = {
  RANK_FAST: 'rankfast',
  SAMPLE: 'sample',
  LEAD: 'lead',
};

// Anything unrecognised builds a full 'lead' site. A malformed request must
// never silently produce a stripped-down site, and it must never silently
// produce the new formats either.
const DEFAULT_MODE = MODES.LEAD;

/** Strip anything that would break out of an HTML attribute. */
function clean(value) {
  return String(value || '')
    .replace(/["<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * "Leander, TX" -> { city: 'Leander', state: 'TX' }
 *
 * globalValues.location goes through formatCityState, so the comma form is
 * what actually arrives. The no-comma fallback catches a hand-edited job
 * record rather than anything the wizard produces.
 */
function splitLocation(location) {
  const value = clean(location);
  if (!value) return { city: '', state: '' };

  if (value.includes(',')) {
    const [city, ...rest] = value.split(',');
    return { city: city.trim(), state: rest.join(',').trim() };
  }

  const trailingState = value.match(/^(.*)\s+([A-Za-z]{2})$/);
  if (trailingState) {
    return { city: trailingState[1].trim(), state: trailingState[2].trim() };
  }

  return { city: value, state: '' };
}

/**
 * "24/7" is prepended only when the business name already says "emergency".
 *
 * The point is to reinforce a claim the business is making about itself, not
 * to invent one — a plumber who does not advertise emergency work should not
 * have a title promising round-the-clock service.
 */
function emergencyPrefix(businessName) {
  return /\bemergency\b/i.test(String(businessName || '')) ? '24/7 ' : '';
}

/**
 * What the business sells, as a noun phrase: "plumbing services",
 * "legal services", "HVAC services".
 *
 * "<type> services" works for most of the trades but not for all of the
 * business types the wizard offers — "painter services", "electrician
 * services" and "law firm services" all read as mistakes, and this string
 * goes in the meta description where a visitor sees it.
 *
 * Matched on substrings, so "Lemon Law Firm" and "Personal Injury Law" both
 * find the legal entry.
 */
const SERVICE_NOUNS = [
  [['law', 'attorney', 'lawyer', 'legal'],            'legal services'],
  [['dentist', 'dental', 'orthodont'],                'dental services'],
  [['doctor', 'physician', 'medical', 'clinic'],      'medical services'],
  [['chiropract'],                                    'chiropractic services'],
  [['veterinar'],                                     'veterinary services'],
  [['accounting', 'accountant', 'cpa', 'bookkeep'],   'accounting services'],
  [['insurance'],                                     'insurance services'],
  [['real estate', 'realtor'],                        'real estate services'],
  [['painter', 'painting'],                           'painting services'],
  [['electrician', 'electrical'],                     'electrical services'],
  [['swimming pool'],                                 'swimming pool services'],
  [['concrete'],                                      'concrete services'],
  [['web design', 'web development'],                 'web design services'],
];

// Acronyms keep their capitals: "hvac services" looks like a typo.
const ACRONYMS = ['hvac', 'ac', 'seo', 'it'];

/**
 * @param {string} businessType  e.g. "Plumbing", "Law Firm", "HVAC"
 * @returns {string}             e.g. "plumbing services", "legal services"
 */
function serviceNoun(businessType = '') {
  const type = String(businessType).toLowerCase().trim();

  if (!type) return 'our services';

  for (const [keywords, noun] of SERVICE_NOUNS) {
    if (keywords.some(k => type.includes(k))) return noun;
  }

  const trade = ACRONYMS.includes(type) ? type.toUpperCase() : type;
  return `${trade} services`;
}

// ---------------------------------------------------------------------------
// Index page meta
// ---------------------------------------------------------------------------

/**
 * Rank GBPs / One-Page Design — the original format, unchanged.
 *
 *   Contact 24/7 Emergency Plumber Austin in Austin, TX - Call 5125551234
 */
function leadIndexMeta(globalValues = {}) {
  const name = clean(globalValues.businessName);
  const location = clean(globalValues.location);
  const phone = clean(globalValues.phone);

  const parts = [`Contact ${emergencyPrefix(name)}${name}`];
  if (location) parts.push(`in ${location}`);

  let title = parts.join(' ');
  if (phone) title += ` - Call ${phone}`;

  // The description extends the title rather than repeating it exactly.
  // A description has roughly 160 characters against a title's 60, so an
  // identical one wastes most of the space.
  const description = phone
    ? `${title} to get a free quote. Available Now.`
    : title;

  return { title, description };
}

/**
 * Rank Fast.
 *
 *   title        Emergency Plumber Leander, TX. Call (512) 894-6167
 *   description  Call Emergency Plumber Leander, TX at (512) 894-6167 to get
 *                plumbing services.
 *
 * The business name carries the place, so the title adds the state alone:
 * "Emergency Plumber Leander" + ", TX". A name that does not already say
 * where it is gets the city too — "Acme Plumbing, Leander, TX" — because
 * otherwise the title names a state and no town.
 *
 * No "Contact" prefix and no 24/7 prefix here: both were spending characters
 * before the words a searcher is scanning for.
 */
function rankFastIndexMeta(globalValues = {}) {
  const name = clean(globalValues.businessName);
  const phone = clean(globalValues.phone);
  const { city, state } = splitLocation(globalValues.location);

  const nameHasCity =
    !!city && new RegExp(`\\b${escapeRegex(city)}\\b`, 'i').test(name);

  // State alone when the name already says the city, otherwise city + state.
  // With no state on record, fall back to whatever place we do have.
  const place = nameHasCity
    ? (state || '')
    : [city, state].filter(Boolean).join(', ');

  // "Emergency Plumber Leander, TX" — reused by both the title and the
  // description, so they can never disagree about the business's name.
  const subject = [name, place].filter(Boolean).join(', ');

  const title = phone ? `${subject}. Call ${phone}` : subject;

  const services = serviceNoun(globalValues.businessType);
  const description = phone
    ? `Call ${subject} at ${phone} to get ${services}.`
    : `${subject} — ${services}.`;

  return { title, description };
}

// ---------------------------------------------------------------------------
// Image filename prefixes
// ---------------------------------------------------------------------------
//
// READ THIS BEFORE CHANGING A PREFIX.
//
// Every page's images are copied into ONE assets/ folder, so the prefix is
// the only thing keeping them apart. The index page can drop its prefix
// entirely because a site has exactly one index page, and
// assets/section2Img1.webp therefore has exactly one writer.
//
// Service and location pages do NOT have that guarantee. Each one copies from
// a different source folder into the same field names, so dropping their
// prefix would make every service page overwrite the previous page's images
// and the whole site would show one page's photographs.

const PREFIXES = {
  /**
   * The index page's own images.
   *
   * The "-in-" reads as a phrase rather than two slugs run together:
   *   quality-plumbing-leander-in-leander-tx-hero-desktop.webp
   * rather than
   *   quality-plumbing-leander-leander-tx-hero-desktop.webp
   * where "leander-leander" looks like a mistake.
   */
  leadIndex({ businessName, nearMeTerm, location }) {
    const name = slugify(businessName || '');
    const place = slugify(location || '');
    const nearMe = nearMeTerm ? slugify(nearMeTerm) : '';

    return nearMe
      ? `${name}-${nearMe}-in-${place}`
      : `${name}-in-${place}`;
  },

  /** Rank Fast: no prefix. Safe for the index page only — see above. */
  rankFastIndex() {
    return '';
  },

  /** Logo, favicon and anything else uploaded as a global[...] file field. */
  leadGlobal({ businessName, location }) {
    return `${slugify(businessName || '')}-${slugify(location || '')}`;
  },

  /**
   * Rank Fast: business name only.
   *   assets/emergency-plumber-leander-logo.png
   *   assets/emergency-plumber-leander-favicon-42x42.png
   */
  rankFastGlobal({ businessName }) {
    return slugify(businessName || '');
  },
};

// ---------------------------------------------------------------------------
// The presets
// ---------------------------------------------------------------------------

const RANK_FAST = {
  key: MODES.RANK_FAST,
  label: 'Rank Fast',

  indexMeta: rankFastIndexMeta,

  // Alt and title are the raw image description and nothing else:
  //   a male plumber fixing a water heater
  // No business name, no location, no "near me", no page name — and alt and
  // title are identical to each other.
  alt: {
    businessNameOnIndex: false,
    location: false,
    decorate: false,
  },

  images: {
    indexPrefix: PREFIXES.rankFastIndex,
    globalPrefix: PREFIXES.rankFastGlobal,
  },

  schema: {
    // The visible FAQ section stays on the page; only the JSON-LD block goes.
    faqPage: false,
    localBusiness: true,
  },

  links: {
    interlinks: true,

    // Rank Fast has its OWN ring — utils/buildRankFastLinks.js.
    //
    // Every page links home, then forward to the next two, with contact
    // closing the circle. What changes with site size is only the anchor text
    // used to link home: naked URL on a small site, the business name on the
    // first page (or first two) once there are 3+ pages.
    //
    // A separate builder rather than branches inside buildInterlinksMap: the
    // two structures genuinely differ, and a shared function would be one
    // edit away from changing the ring nobody asked to change.
    //
    // The Services and Locations NAV menus are unaffected either way — those
    // come from buildNavMenu and are a different thing.
    ring: 'rankfast',
  },
};

const LEAD = {
  key: MODES.LEAD,
  label: 'Rank GBPs',

  indexMeta: leadIndexMeta,

  alt: {
    businessNameOnIndex: true,
    location: true,
    decorate: true,
  },

  images: {
    indexPrefix: PREFIXES.leadIndex,
    globalPrefix: PREFIXES.leadGlobal,
  },

  schema: {
    faqPage: true,
    localBusiness: true,
  },

  links: {
    interlinks: true,
    // The original ring: every page links home plus the next two, and contact
    // links onward like any other node. utils/buildInterlinksMap.js.
    ring: 'classic',
  },
};

// A design sample is a 'lead' site with most of its pages left unbuilt. The
// formats it does render are the 'lead' ones, so it shares the preset rather
// than keeping a third copy that could drift.
const SAMPLE = Object.assign({}, LEAD, {
  key: MODES.SAMPLE,
  label: 'One-Page Design',
});

const PRESETS = {
  [MODES.RANK_FAST]: RANK_FAST,
  [MODES.SAMPLE]: SAMPLE,
  [MODES.LEAD]: LEAD,
};

/**
 * The one place a site mode string is validated.
 *
 * Call this instead of comparing to 'sample' and falling through to 'lead' —
 * that pattern is what silently flattened the third mode into the second
 * everywhere it appeared.
 */
function normalizeSiteMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return PRESETS[mode] ? mode : DEFAULT_MODE;
}

/** @returns {object} the preset for this mode; never undefined. */
function getPreset(siteMode) {
  return PRESETS[normalizeSiteMode(siteMode)];
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * The filename an image is written under.
 *
 * An empty prefix means the field name alone — "section2Img1.webp", NOT
 * "-section2Img1.webp". Both the copy and the URL that points at it go
 * through this, because a leading dash on one side and not the other is a
 * silent 404 on every image on the page.
 */
function assetFile(prefix, field, ext = '.webp') {
  return prefix ? `${prefix}-${field}${ext}` : `${field}${ext}`;
}

/** The same name as a site-relative URL. */
function assetPath(prefix, field, ext = '.webp') {
  return `assets/${assetFile(prefix, field, ext)}`;
}

/**
 * The alt/title text for one image.
 *
 * Rank Fast returns the description untouched. Every other mode appends
 * whatever the calling page appends today — the page name on a service page,
 * the "near me" term on the index page.
 *
 * Callers should stop building these strings themselves: the decoration is
 * part of the format, and a format that lives at the call site is a format
 * that gets applied in the HTML pass and forgotten in the model pass.
 *
 * @param {object} globalValues  needs .siteMode
 * @param {string} baseAlt       the raw description from buildAltText
 * @param {object} [extra]
 * @param {string} [extra.pageName]     e.g. "Water Heater Repair" -> "- Water Heater Repair"
 * @param {string} [extra.suffix]       same shape, for a trailing part that is
 *                                      not a page name (the contact page
 *                                      appends its location this way)
 * @param {string} [extra.nearMeTerm]   e.g. "Plumber near me"
 */
function imageAlt(globalValues, baseAlt, extra = {}) {
  const base = String(baseAlt || '').replace(/\s+/g, ' ').trim();
  const preset = getPreset(globalValues && globalValues.siteMode);

  if (!preset.alt.decorate) return base;

  const tail = extra.pageName || extra.suffix;

  const parts = [base];
  if (tail) parts.push(`- ${String(tail).trim()}`);
  if (extra.nearMeTerm) parts.push(String(extra.nearMeTerm).trim());

  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

module.exports = {
  MODES,
  DEFAULT_MODE,
  PRESETS,
  getPreset,
  normalizeSiteMode,
  assetFile,
  assetPath,
  imageAlt,
  serviceNoun,
  splitLocation,
  emergencyPrefix,
  clean,
};