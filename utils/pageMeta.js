// utils/pageMeta.js
//
// The <title> and <meta name="description"> for every page.
//
// These were previously written in four different places — buildAboutUsPage,
// buildContactPage, buildLocationPages, and an AI call for service pages —
// each with its own format. Changing the wording meant finding all four, and
// they had already drifted apart.
//
// THE FORMATS
//   index      Contact 24/7 Emergency Plumber Austin in Austin, TX - Call 5125551234
//   contact    Plumbing in Leander, TX
//   service    Water Heater Repair in Leander, TX
//   location   Quality Plumbing Leander in Austin, TX
//
// The description currently mirrors the title. That is deliberate for now:
// a description has roughly 160 characters to a title's 60, so this leaves
// most of the space unused and search engines may substitute page text
// instead. Worth revisiting once you can see how they look in results.

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

/** Strip anything that would break out of an HTML attribute. */
function clean(value) {
  return String(value || '')
    .replace(/["<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * How the business refers to itself in prose: "our law firm", "our practice",
 * "our plumbing company".
 *
 * "our <type> company" works for the trades but not for everything the app
 * supports — "our law firm company" and "our dentist company" both read as
 * mistakes, and a visitor notices. So the noun is chosen by what kind of
 * business it is.
 *
 * The match is on substrings, so "Lemon Law Firm" and "Personal Injury Law"
 * both find the law-firm entry.
 */
const BUSINESS_NOUNS = [
  // Professional services — "company" is wrong for all of these.
  [['law', 'attorney', 'lawyer', 'legal'],                    'law firm'],
  [['dentist', 'dental', 'orthodont'],                        'dental practice'],
  [['doctor', 'physician', 'medical', 'clinic', 'chiropract',
    'veterinar', 'therapy', 'therapist'],                     'practice'],
  [['accounting', 'accountant', 'cpa', 'bookkeep'],           'firm'],
  [['insurance'],                                             'agency'],
  [['real estate', 'realtor'],                                'team'],

  // Project-based services.
  [['web design', 'web development', 'marketing', 'seo',
    'advertis', 'design agency', 'digital'],                  'agency'],
];

/**
 * @param {string} businessType  e.g. "Plumbing", "Law Firm", "Web Design"
 * @returns {string}             e.g. "plumbing company", "law firm", "agency"
 *
 * Prefix with "our" at the call site: `our ${businessNoun(type)}`.
 */
function businessNoun(businessType = '') {
  const type = String(businessType).toLowerCase().trim();

  if (!type) return 'team';

  for (const [keywords, noun] of BUSINESS_NOUNS) {
    if (keywords.some(k => type.includes(k))) return noun;
  }

  // A trade. "our plumbing company", "our roofing company" — reads correctly
  // for every home service currently supported, and for new ones added later.
  //
  // Acronyms keep their capitals: "our hvac company" looks like a typo.
  const ACRONYMS = ['hvac', 'ac', 'seo', 'it'];
  const trade = ACRONYMS.includes(type) ? type.toUpperCase() : type;

  return `${trade} company`;
}

/**
 * The home page.
 *
 *   Contact 24/7 Emergency Plumber Austin in Austin, TX - Call 5125551234
 *
 * @param {object} globalValues
 * @returns {{title: string, description: string}}
 */
function indexMeta(globalValues = {}) {
  const name = clean(globalValues.businessName);
  const location = clean(globalValues.location);
  const phone = clean(globalValues.phone);

  const parts = [`Contact ${emergencyPrefix(name)}${name}`];

  if (location) parts.push(`in ${location}`);

  let title = parts.join(' ');
  if (phone) title += ` - Call ${phone}`;

  // The description extends the title rather than repeating it exactly.
  //
  // A description has roughly 160 characters against a title's 60, so an
  // identical one wastes most of the space — and a search engine that judges
  // it too thin will substitute page text instead. The call to action uses
  // some of that room.
  const description = phone
    ? `${title} to get a free quote. Available Now.`
    : title;

  return { title, description };
}

/**
 * The contact page: the trade and the place, nothing more.
 *
 *   Plumbing in Leander, TX
 */
function contactMeta(globalValues = {}) {
  const businessType = clean(globalValues.businessType);
  const location = clean(globalValues.location);

  const title = location
    ? `${businessType} in ${location}`
    : businessType;

  return { title, description: title };
}

/**
 * A service page, named for the service itself.
 *
 *   Water Heater Repair in Leander, TX
 *
 * @param {string} serviceName  the page's filename/keyword, e.g. "Water Heater Repair"
 */
function serviceMeta(serviceName, globalValues = {}) {
  const service = clean(serviceName);
  const location = clean(globalValues.location);

  const title = location
    ? `${service} in ${location}`
    : service;

  return { title, description: title };
}

/**
 * A location page, named for the business and that location.
 *
 *   Quality Plumbing Leander in Austin, TX
 *
 * @param {string} locationDisplay  e.g. "Austin, TX" — NOT the site's main
 *                                  location, but the one this page covers
 */
function locationMeta(locationDisplay, globalValues = {}) {
  const name = clean(globalValues.businessName);
  const place = clean(locationDisplay);

  const title = place ? `${name} in ${place}` : name;

  return { title, description: title };
}

module.exports = {
  businessNoun,
  indexMeta,
  contactMeta,
  serviceMeta,
  locationMeta,
  emergencyPrefix,
};