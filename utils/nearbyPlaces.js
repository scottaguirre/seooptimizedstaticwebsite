// utils/nearbyPlaces.js
//
// The towns near a business, from real geography.
//
// WHY THIS IS NOT A MODEL CALL
//
// The service suggester asks a model, because naming the jobs a plumber does
// is recall and a model is good at it. This is the opposite. Ask a model for
// the towns near Leander and it answers confidently and wrongly: places a
// hundred miles away, places in the next state, places that do not exist. The
// errors are the dangerous kind — plausible names a customer will not think to
// check, that become pages for a service area the business does not cover.
//
// Edwin's own screenshot made the point: a location page for Dallas on a site
// for a Round Rock business. 190 miles.
//
// So this reads a gazetteer and does trigonometry. No tokens, no rate limit,
// no network, and the same answer every time.
//
// THE DATA
//
// `all-the-cities`, which packages the GeoNames cities1000 export: every
// populated place in the world with at least 1,000 people, with coordinates,
// population and (for the US) the state code.
//
// **The package is MIT but the DATA is GeoNames, which is CC BY 4.0 and wants
// attribution.** See ATTRIBUTION below; there is a credit line to put
// somewhere public before this ships.
//
// WHAT IT DELIBERATELY LEAVES OUT
//
// Neighbourhoods. GeoNames marks a district inside a city as PPLX, and a
// location page for a district of Austin is a different play from one for a
// suburb — mixing them in one list would confuse the choice. Abandoned places
// (PPLQ) go too, for obvious reasons.

const EARTH_RADIUS_MILES = 3958.8;

/**
 * The GeoNames feature codes that count as a town.
 *
 *   PPL    a populated place — the bulk of it
 *   PPLA   seat of a first-order division (a state capital)
 *   PPLA2  seat of a second-order division (a county seat)
 *   PPLA3  seat of a third-order division
 *   PPLC   the capital of the country
 *
 * Everything else is left out: PPLX is a section of a place (a neighbourhood),
 * PPLQ is abandoned, PPLL and PPLS are loose localities.
 */
const TOWN_FEATURE_CODES = new Set(['PPL', 'PPLA', 'PPLA2', 'PPLA3', 'PPLC']);

/** Put this where the public can see it, once, before shipping. */
const ATTRIBUTION = 'Place data from GeoNames (geonames.org), CC BY 4.0.';

/**
 * How far out to look, in miles.
 *
 * Not a service-area estimate — it is the point past which a location page
 * stops being about a place the business plausibly serves. A suburban
 * business fills its list long before reaching this; the cap only bites in
 * the country, where it is the difference between "the six towns that exist"
 * and a page for somewhere three hours away.
 */
const DEFAULT_RADIUS_MILES = 60;

/** The most to hand back. Matches the service suggester, for the same reason. */
const MAX_PLACES = 20;

let index = null;

/**
 * The US places, loaded once.
 *
 * Required lazily, like openaiClient: the dataset is a few megabytes and a
 * process that never suggests a location should not pay for it. After the
 * first call it stays, which is what we want — this runs while somebody waits.
 */
function usPlaces() {
  if (index) return index;

  const all = require('all-the-cities');

  index = all
    .filter(place => place.country === 'US' && TOWN_FEATURE_CODES.has(place.featureCode))
    .map(place => ({
      name: place.name,
      state: place.adminCode,
      population: place.population,
      // GeoNames stores GeoJSON order: longitude first.
      lon: place.loc.coordinates[0],
      lat: place.loc.coordinates[1],
    }));

  return index;
}

/**
 * A name reduced to something two spellings of one town agree on.
 *
 * "Ft. Worth" is not in the gazetteer; "Fort Worth" is. "St. Louis" is there
 * but somebody will type "Saint Louis". Neither is a typo — they are both how
 * people write the name — so the lookup has to meet them.
 */
function normalisePlaceName(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/\bst\b/g, 'saint')
    .replace(/\bft\b/g, 'fort')
    .replace(/\bmt\b/g, 'mount')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Miles between two points, over the curve of the earth. */
function milesBetween(a, b) {
  const rad = Math.PI / 180;

  const dLat = (b.lat - a.lat) * rad;
  const dLon = (b.lon - a.lon) * rad;

  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;

  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

/**
 * Find a town by name and state.
 *
 * A state may hold two towns of one name — Texas has two Fairviews — so the
 * bigger one wins. It is the one somebody naming the town without further
 * qualification almost always means, and the only way to choose without
 * asking.
 *
 * @param {string} name
 * @param {string} state  two-letter code; without it this returns null rather
 *   than guessing, because "Springfield" alone is thirty different towns.
 */
function findPlace(name, state) {
  const wanted = normalisePlaceName(name);
  const code = String(state || '').trim().toUpperCase();

  if (!wanted) return null;

  // NO GUARD ON THE STATE CODE, deliberately. Every state in the gazetteer is
  // two upper-case letters, so "", "Texas" and "T" all simply match nothing
  // in the filter below and the function returns null anyway. Guards for each
  // of those were here and mutation testing showed none of them ever decided
  // an answer — they only looked like they were doing the work.
  const matches = usPlaces().filter(place =>
    place.state === code && normalisePlaceName(place.name) === wanted);

  if (!matches.length) return null;

  return matches.reduce((best, place) =>
    place.population > best.population ? place : best);
}

/** "Cedar Park, TX" */
function displayName(place) {
  return `${place.name}, ${place.state}`;
}

/**
 * The towns nearest a business, closest first.
 *
 * ORDERED BY DISTANCE, not by size. The nearest town is the one the business
 * most plausibly serves, and a page about a place you do not serve is a page
 * that cannot convert whoever it does reach. Population comes back alongside
 * so the customer can tell a suburb from a subdivision — that judgement is
 * theirs, and the list is not the place to make it for them.
 *
 * @param {string} location            the business's own town, "Leander, TX"
 * @param {object} [opts]
 * @param {number} [opts.limit]
 * @param {number} [opts.radiusMiles]
 * @param {string[]} [opts.exclude]    towns already on the form
 *
 * @returns {{ places: Array, home: object|null, withinRadius: number }}
 *   `home` is null when the business's own town is not in the gazetteer, and
 *   the caller has to say so rather than pretending: with no coordinates for
 *   the centre there is nothing to measure from.
 */
function nearbyPlaces(location, opts = {}) {
  const limit = Math.min(MAX_PLACES, Math.max(1, Number(opts.limit) || MAX_PLACES));
  const radius = Math.max(1, Number(opts.radiusMiles) || DEFAULT_RADIUS_MILES);

  const [rawName, rawState] = String(location || '').split(',');
  const home = findPlace(rawName, rawState);

  if (!home) return { places: [], home: null, withinRadius: 0 };

  const skip = new Set(
    [displayName(home), ...(Array.isArray(opts.exclude) ? opts.exclude : [])]
      .map(entry => {
        const [name, state] = String(entry || '').split(',');
        return `${normalisePlaceName(name)}|${String(state || '').trim().toUpperCase()}`;
      })
  );

  const near = [];

  for (const place of usPlaces()) {
    const key = `${normalisePlaceName(place.name)}|${place.state}`;
    if (skip.has(key)) continue;

    const distance = milesBetween(home, place);
    if (distance > radius) continue;

    near.push({
      name: place.name,
      state: place.state,
      display: displayName(place),
      population: place.population,
      miles: Math.round(distance * 10) / 10,
    });
  }

  near.sort((a, b) => a.miles - b.miles);

  return {
    places: near.slice(0, limit),
    home: { ...home, display: displayName(home) },
    // How many there were before the limit, so the page can say "20 of 37"
    // rather than implying that is all there is.
    withinRadius: near.length,
  };
}

module.exports = {
  nearbyPlaces,
  findPlace,
  milesBetween,
  normalisePlaceName,
  displayName,
  TOWN_FEATURE_CODES,
  DEFAULT_RADIUS_MILES,
  MAX_PLACES,
  ATTRIBUTION,
};
