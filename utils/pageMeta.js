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
//   index      by site mode — see utils/seoPresets.js
//                Rank GBPs  Contact 24/7 Emergency Plumber Austin in Austin, TX - Call 5125551234
//                Rank Fast  Emergency Plumber Leander, TX. Call (512) 894-6167
//   contact    Plumbing in Leander, TX
//   service    Driveway Repair in Leander, TX | Call us at (512) 894-6167
//   location   Quality Plumbing Leander in Austin, TX
//
// Only the index page differs by mode. The other three are the same in every
// mode, so they are written here rather than duplicated into both presets.

const { getPreset, clean, emergencyPrefix, serviceNoun } = require('./seoPresets');

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
 * The home page. Its format is the one thing that differs between site modes,
 * so it is looked up rather than written here.
 *
 * globalValues.siteMode is set in runGeneration and travels with everything
 * else, so this needs no extra argument and no call site has to be told which
 * mode it is in.
 *
 * @param {object} globalValues
 * @returns {{title: string, description: string}}
 */
function indexMeta(globalValues = {}) {
  return getPreset(globalValues.siteMode).indexMeta(globalValues);
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
 *   title        Driveway Repair in Leander, TX | Call us at (512) 894-6167
 *   description  Driveway Repair in Leander, TX | Call us at (512) 894-6167 for concrete services.
 *
 * The same format in EVERY mode. Only the index page's format varies by site
 * mode; a service page reads the same on Rank Fast and Rank GBPs.
 *
 * WHAT CHANGED AND WHY
 * Title and description used to be the identical string — "Driveway Repair in
 * Leander, TX" — which spent 34 of the description's ~155 characters and put
 * nothing in the search result a visitor could act on. The phone number now
 * appears in both, so someone with a burst pipe can call straight from the
 * result without opening the page.
 *
 * NO BUSINESS NAME, deliberately. The home page is the page that should own
 * the business name, and on these sites the name often contains the primary
 * keyword ("Emergency Plumber Leander"). Keeping it off the service pages
 * keeps them aimed at the service and the town instead.
 *
 * The title runs past 60 characters for longer service names, so Google will
 * sometimes cut the phone number off the end. Accepted: the service and the
 * town lead, and those are the words a searcher typed.
 *
 * @param {string} serviceName  the page's filename/keyword, e.g. "Driveway Repair"
 */
function serviceMeta(serviceName, globalValues = {}) {
  const service = clean(serviceName);
  const location = clean(globalValues.location);
  const phone = clean(globalValues.phone);

  // The half that identifies the page. Shared by the title and the
  // description so the two can never disagree about what this page is.
  const subject = location ? `${service} in ${location}` : service;

  const title = phone ? `${subject} | Call us at ${phone}` : subject;

  // "concrete services", "plumbing services", "legal services" — from the
  // business type, via the same helper the Rank Fast home page uses. It knows
  // the awkward ones: Law Firm is not "law firm services", HVAC keeps its
  // capitals.
  const services = serviceNoun(globalValues.businessType);

  const description = phone
    ? `${subject} | Call us at ${phone} for ${services}.`
    : `${subject} — ${services}.`;

  return { title, description };
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