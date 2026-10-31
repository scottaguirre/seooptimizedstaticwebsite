// utils/localOptions/render/schema.js
//
// The JSON-LD: one LocalBusiness on the home page, one Service on each
// service page.
//
// NO FAQPage, AND THAT IS A COST DECISION AS MUCH AS A FORMAT ONE. This mode
// has no FAQ section, which is what pulls in the People Also Ask fetch — so
// it makes no DataForSEO call at all. Edwin, 27 October: "will these new site
// use dataforseo?" No, and none is to be designed in. The preset says the
// same thing in seoPresets.js; this file is where it stops being an opinion.
//
// EVERY FIELD COMES FROM SOMETHING THE OWNER TYPED. Nothing is inferred,
// nothing is padded out to look complete. A schema block claiming an
// aggregateRating a business has not earned is the structured-data version
// of a fabricated review, and it is refused for the same reason.

'use strict';

/**
 * The @type for a trade.
 *
 * schema.org has a specific type for some trades and nothing for others.
 * A WRONG SPECIFIC TYPE IS WORSE THAN A RIGHT GENERAL ONE — "Plumber" on a
 * roofing company is a claim, where LocalBusiness is merely vague — so
 * anything not on this list falls back rather than guessing.
 */
const TRADE_TYPES = {
  plumbing: 'Plumber',
  plumber: 'Plumber',
  electrical: 'Electrician',
  electrician: 'Electrician',
  hvac: 'HVACBusiness',
  roofing: 'RoofingContractor',
  locksmith: 'Locksmith',
  moving: 'MovingCompany',
  painting: 'HousePainter',
  landscaping: 'LandscapingBusiness',
};

const DEFAULT_TYPE = 'LocalBusiness';

function typeForTrade(trade) {
  return TRADE_TYPES[String(trade || '').trim().toLowerCase()] || DEFAULT_TYPE;
}

/**
 * "7:00 AM – 6:00 PM" -> { opens: '07:00', closes: '18:00' }
 *
 * RETURNS null RATHER THAN GUESSING. The hours come from a form, and a value
 * this cannot parse — "by appointment", "24/7", an en dash swapped for a
 * hyphen, a missing minute — must leave the day OUT of the specification
 * rather than put a made-up time into it. Google reads this; a wrong opening
 * time sends somebody to a locked door.
 */
function parseHours(open) {
  const text = String(open || '').trim();
  if (!text) return null;

  const parts = text.split(/\s*[–—-]\s*/);
  if (2 !== parts.length) return null;

  const times = parts.map(toTwentyFour);
  if (times.some(t => null === t)) return null;

  return { opens: times[0], closes: times[1] };
}

/** "7:00 AM" -> "07:00"; "12:30 PM" -> "12:30"; "12:00 AM" -> "00:00". */
function toTwentyFour(value) {
  const m = String(value || '').trim()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?$/);

  if (!m) return null;

  const hour = Number(m[1]);
  const minute = m[2] || '00';

  if (hour < 1 || hour > 12) return null;

  /* NOON AND MIDNIGHT ARE THE TWO THAT GO WRONG. 12 AM is 00, 12 PM is 12,
   * and `hour % 12` is what makes both of them come out right. */
  const pm = 'P' === m[3].toUpperCase();
  const hour24 = (hour % 12) + (pm ? 12 : 0);

  return `${String(hour24).padStart(2, '0')}:${minute}`;
}

/**
 * openingHoursSpecification, with closed days left out.
 *
 * A DAY THAT IS CLOSED IS ABSENT, not present with equal opens and closes.
 * "opens 00:00, closes 00:00" is read by some consumers as open all day,
 * which is the opposite of what the owner typed.
 */
function openingHours(hours = []) {
  return hours.map(({ day, open }) => {
    const parsed = parseHours(open);

    if (!parsed) return null;

    return {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: day,
      opens: parsed.opens,
      closes: parsed.closes,
    };
  }).filter(Boolean);
}

/** A PostalAddress, with empty fields omitted rather than sent as "". */
function postalAddress(business = {}) {
  const address = { '@type': 'PostalAddress' };

  if (business.street) address.streetAddress = business.street;
  if (business.city) address.addressLocality = business.city;
  if (business.state) address.addressRegion = business.state;
  if (business.zip) address.postalCode = business.zip;

  address.addressCountry = business.country || 'US';

  return address;
}

/**
 * The home page's block.
 *
 * ONE PER SITE, ON THE HOME PAGE ONLY. Repeating a LocalBusiness on all
 * eleven pages does not make it more true and gives a crawler eleven
 * entities to reconcile.
 */
function localBusiness({ business = {}, site = '', areas = [], hours = [], cover = 1 } = {}) {
  const base = String(site).replace(/\/$/, '');

  const node = {
    '@context': 'https://schema.org',
    '@type': typeForTrade(business.trade),
    name: business.name || '',
    url: `${base}/`,
    address: postalAddress(business),
  };

  if (business.phone) node.telephone = business.phone;

  /* THE ESTABLISHING SHOT, AND ITS NUMBER COMES FROM THE TRADE FOLDER.
   *
   * This used to read `hero-1.webp`, with a comment explaining that hero-1
   * was the only one of the four taken outdoors with the van. On 28 October
   * the four plumbing pictures were reordered — hero-1 and hero-4 swapped —
   * and this line kept pointing at number one, which was by then a close-up
   * of a wrench under a basin.
   *
   * NOTHING FAILED. No test broke, no page looked wrong, and the image a
   * search result may show beside the business was simply the wrong one.
   *
   *     A COMMENT EXPLAINING WHY AN INDEX IS CORRECT DOES NOT MOVE WHEN
   *     THE THING IT INDEXES DOES.
   *
   * `cover` is declared in the trade's alt.json, beside the pictures, by
   * whoever reorders them. See coverFor() in heroes.js. */
  node.image = `${base}/assets/hero-${cover}.webp`;

  const served = areas.filter(Boolean);
  if (served.length) node.areaServed = served;

  const spec = openingHours(hours);
  if (spec.length) node.openingHoursSpecification = spec;

  const sameAs = Object.values(business.social || {}).filter(Boolean);
  if (sameAs.length) node.sameAs = sameAs;

  return node;
}

/**
 * One service page's block.
 *
 * `provider` REPEATS THE BUSINESS, NAME AND PHONE ONLY. A Service with no
 * provider is an orphan; a Service carrying a full second copy of the
 * LocalBusiness invites a crawler to decide the two disagree.
 */
function serviceNode({ service = {}, business = {}, site = '' } = {}) {
  const base = String(site).replace(/\/$/, '');

  const node = {
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: service.name || '',
    serviceType: service.name || '',
    url: `${base}/${service.slug}/`,
    provider: {
      '@type': typeForTrade(business.trade),
      name: business.name || '',
      url: `${base}/`,
    },
  };

  if (business.phone) node.provider.telephone = business.phone;

  if (business.city) {
    node.areaServed = { '@type': 'City', name: business.city };
  }

  return node;
}

module.exports = {
  TRADE_TYPES,
  DEFAULT_TYPE,
  typeForTrade,
  toTwentyFour,
  parseHours,
  openingHours,
  postalAddress,
  localBusiness,
  serviceNode,
};
