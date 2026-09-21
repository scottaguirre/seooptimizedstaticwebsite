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
  // clean(), not String() — same reason as serviceNoun() in seoPresets.js: the
  // unmatched branch returns the business type verbatim, and these strings are
  // substituted into HTML attributes unescaped by the static-site builder.
  const type = clean(businessType).toLowerCase().trim();

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
 * Up to three service names, read off the site's own service pages.
 *
 *   [{ filename: 'water-heater-repair.html' }, ...]  ->  'water heater repair,
 *   drain cleaning and slab leak repair'
 *
 * Lower case, because the result sits mid-sentence in a meta description.
 * Serial comma deliberately absent: "a, b and c" is how the rest of the copy
 * in this app reads.
 *
 * Three is a judgement, not a constraint — it fills roughly 45 characters of
 * a ~155 budget and leaves room for the town and the phone number. A site with
 * fewer service pages simply names fewer; One-Page Design sites have none at
 * all and get ''.
 */
function serviceList(pages = [], limit = 3) {
  const names = (Array.isArray(pages) ? pages : [])
    .map(p => clean(p && p.filename).replace(/\.html$/i, '').replace(/-/g, ' ').toLowerCase())
    .filter(Boolean)
    .slice(0, limit);

  if (!names.length) return '';
  if (names.length === 1) return names[0];

  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * A location page.
 *
 *   title        Emergency Plumber Round Rock in Austin, TX
 *   description  Plumbing services in Austin, TX — water heater repair, drain
 *                cleaning and slab leak repair. Call (512) 894-6167.
 *
 * THE DESCRIPTION IS NO LONGER A COPY OF THE TITLE — 21 September.
 *
 * It was `description: title` — 42 characters of a ~155 budget, on a page
 * whose entire job is to rank for a town that has no service page of its own.
 * The comment on leadIndexMeta already made this argument ("an identical one
 * wastes most of the space"); it had simply never been applied here.
 *
 * WHY THE DESCRIPTION LEADS WITH THE SERVICE AND THE TITLE LEADS WITH THE NAME
 *
 * They are two lines of one search result, so repeating the business name in
 * both spends the description's opening words on something the searcher has
 * already read. Leading with the trade and the town instead puts the words
 * they actually typed into the snippet twice across the two lines.
 *
 * NO BUSINESS NAME IN THE DESCRIPTION, for the same reason serviceMeta leaves
 * it off: on these sites the name contains the primary keyword, so repeating
 * it everywhere aims every page at the home page's term rather than its own.
 *
 * A NOTE ON WHAT THIS DOES NOT FIX. Every location page still says the same
 * thing with a different town, because the business offers the same services
 * everywhere. That is expected of location pages and is not what this changes.
 * What it changes is a description that said nothing.
 *
 * @param {string} locationDisplay  e.g. "Austin, TX" — NOT the site's main
 *                                  location, but the one this page covers
 * @param {object} globalValues
 * @param {Array}  [pages]          the site's service pages. Absent on a
 *                                  One-Page Design site, and absent from any
 *                                  caller that predates this change, which is
 *                                  why the clause is dropped rather than the
 *                                  description being wrong.
 */
function locationMeta(locationDisplay, globalValues = {}, pages = []) {
  const name = clean(globalValues.businessName);
  const place = clean(locationDisplay);
  const phone = clean(globalValues.phone);

  const title = place ? `${name} in ${place}` : name;

  // "plumbing services", "legal services" — the same helper the home page and
  // the service pages use, so the three never disagree about what the business
  // sells. It knows the awkward ones: Law Firm is not "law firm services".
  const services = serviceNoun(globalValues.businessType);

  // Capitalised because it opens the sentence.
  const opener = services.charAt(0).toUpperCase() + services.slice(1);

  const subject = place ? `${opener} in ${place}` : opener;
  const list = serviceList(pages);

  const parts = [list ? `${subject} — ${list}.` : `${subject}.`];
  if (phone) parts.push(`Call ${phone}.`);

  return { title, description: parts.join(' ') };
}

module.exports = {
  businessNoun,
  indexMeta,
  contactMeta,
  serviceMeta,
  locationMeta,
  serviceList,
  emergencyPrefix,
};