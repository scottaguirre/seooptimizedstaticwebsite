// routes/keywordVolumesRoute.js
//
//   POST /api/keyword-volumes   service names -> how often people search them
//
// WHY THIS IS NOT BILLED, WHEN IT COSTS REAL MONEY
//
// Every other paid thing in this app charges credits. This does not, and the
// reason is the same one written at the top of suggestServicesRoute: somebody
// working out how big a site to buy should not be charged to find out.
//
// It is stronger here. A service page is 100 credits, and this endpoint's
// whole job is to show a customer that "water heater replacement" gets 390
// searches a month — which is an argument for buying one. One extra page is
// roughly $0.90 of revenue against $0.18 of cost. Charging for the lookup
// would tax the thing that drives the sale, and would make the customer
// hesitate at exactly the wrong moment.
//
// WHAT PROTECTS IT INSTEAD
//
//   1. THE CACHE, which is most of the answer. A trade and a town, not a
//      person: every plumber in Austin asks the same question. See
//      utils/keywordVolumes.js.
//   2. THE RATE LIMIT, for what the cache cannot absorb — and deliberately
//      SKIPPED on a cache hit, because charging somebody's hourly budget for
//      an answer that cost nothing would lock out the customers the cache
//      exists to serve. That is what `spendOnlyOnMisses` below does.
//   3. THE COST LOG, so "what is this costing me?" has a number in a month
//      rather than an estimate. Same reason services.suggested logs tokens.
//
// WHY IT ASKS ABOUT TWO PLACES
//
// Because one is useless. Google will not report under about ten searches a
// month, and in Cedar Park that swallowed 774 of 780 keywords — in AUSTIN it
// still swallowed 930 of 993. A list of the customer's own town is therefore
// a list of zeros, which reads as "your website is pointless". The metro
// orders the list; the town says how it looks locally. Both, or neither.

const express = require('express');
const router = express.Router();

const { keywordVolumesLimiter } = require('../middleware/rateLimits');
const {
  volumesForArea,
  cachedVolumesFor,
  keywordList,
  isBillingError,
  NOISE_FLOOR,
} = require('../utils/keywordVolumes');
const { metroFor } = require('../utils/nearbyPlaces');
const { log } = require('../utils/logger');

/** The most the page may ask about at once. A wizard step has twenty rows. */
const MAX_REQUESTED = 60;

/** The model call is slower than this; a local sort plus one HTTP call is not. */
const CALL_TIMEOUT_MS = Number(process.env.KEYWORD_VOLUMES_TIMEOUT_MS) || 30000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** The keywords the page sent, trimmed and capped. */
function requestedKeywords(value) {
  return keywordList(Array.isArray(value) ? value : []).slice(0, MAX_REQUESTED);
}

/** "Cedar Park, TX" as the wizard writes it -> what DataForSEO wants. */
function toLocationName(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const [city, state] = text.split(',').map(p => String(p || '').trim());
  if (!city) return '';

  // Already a full name — "Austin,Texas,United States" — so leave it alone.
  if (/united states/i.test(text)) return text;

  const full = STATES[String(state || '').toUpperCase()];
  return full ? `${city},${full},United States` : '';
}

/**
 * Two-letter codes to the names Google's geo targets use.
 *
 * DataForSEO matches location_name against Google's own list, where the state
 * is spelled out. "Cedar Park,TX,United States" matches nothing and comes back
 * as an error rather than an empty list, which is at least loud.
 */
const STATES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan',
  MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
  NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey',
  NM: 'New Mexico', NY: 'New York', NC: 'North Carolina', ND: 'North Dakota',
  OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

/**
 * The two places to ask about, worked out from the one the customer typed.
 *
 * THE PAGE DOES NOT DO GEOGRAPHY. It knows the business is in "Cedar Park,
 * TX"; it has no business knowing that Austin is the market that describes
 * it. utils/nearbyPlaces.js already holds the gazetteer the location
 * suggester uses, so the metro is a population lookup, not a new input on an
 * already long form.
 *
 * When there is no metro — an isolated town, or one the gazetteer does not
 * know — the town stands in for itself. That is the honest failure: fewer
 * usable numbers, never numbers from a market the business does not serve.
 */
function placesFor(body) {
  const typed = String((body && body.location) || '').trim();

  // An explicit metro wins, so a caller that knows better can say so. Nothing
  // in the app sends one today; it exists for the standalone research screen,
  // where the customer picks the market deliberately.
  const explicit = toLocationName(body && body.metro);
  const city = toLocationName(typed);

  if (explicit) return { metro: explicit, city };
  if (!city) return { metro: '', city: '' };

  const metro = metroFor(typed);

  return metro
    ? { metro: toLocationName(metro.display), city }
    : { metro: city, city: '' };
}

/**
 * Run the limiter only when the answer will actually cost something.
 *
 * THE ORDERING IS THE WHOLE TRICK. A limiter runs before the handler, so by
 * the time `volumesForArea` could report `cached: true` the budget has already
 * been spent. So this peeks the cache first and, on a full hit, calls next()
 * without the limiter ever seeing the request.
 *
 * A peek that throws is treated as a miss, which is the safe direction: the
 * customer pays a rate-limit slot for a call that might have been free,
 * rather than getting unlimited free calls because Mongo is down.
 */
function spendOnlyOnMisses(limiter) {
  return async (req, res, next) => {
    try {
      const keywords = requestedKeywords(req.body && req.body.keywords);
      const { metro, city } = placesFor(req.body);

      if (keywords.length && metro) {
        const metroHit = await cachedVolumesFor(keywords, { location: metro });

        const cityHit = !city || city === metro
          ? true
          : await cachedVolumesFor(keywords, { location: city });

        if (metroHit && cityHit) {
          req.keywordsWereCached = true;
          return next();
        }
      }
    } catch (_) {
      // Fall through to the limiter. See the note above about which way to
      // fail: a slot spent is recoverable, a free-for-all is not.
    }

    return limiter(req, res, next);
  };
}

router.post('/api/keyword-volumes', spendOnlyOnMisses(keywordVolumesLimiter), async (req, res) => {
  const keywords = requestedKeywords(req.body && req.body.keywords);
  const businessType = String((req.body && req.body.businessType) || '').trim().slice(0, 100);

  if (!keywords.length) {
    return res.status(400).json({
      error: 'Add some services first, then we can look up how often people search for them.',
    });
  }

  const { metro, city } = placesFor(req.body);

  if (!metro) {
    return res.status(400).json({
      error: 'We need the business location in "City, ST" form before we can '
           + 'look up search volumes.',
    });
  }

  try {
    const { rows, cached, costUsd } = await withTimeout(
      volumesForArea(keywords, { metro, city, businessType }),
      CALL_TIMEOUT_MS,
      'keyword volumes'
    );

    // THE COST LINE. The endpoint is free to the customer, so this is the only
    // record of what it costs to run — and `cached` is the number that says
    // whether the decision not to charge is holding up.
    log.info('keywords.looked', {
      requestId: req.id,
      userId: String((req.user && req.user._id) || ''),
      businessType,
      metro,
      city: city || null,
      count: rows.length,
      brands: rows.filter(r => r.brand).length,
      cached,
      costUsd,
    });

    res.json({
      rows,
      metro,
      city: city || null,
      // The page needs this to draw the line between a number worth acting on
      // and one that only looks like one. It is not a preference, so it is not
      // the page's to choose.
      noiseFloor: NOISE_FLOOR,
      cached,
    });

  } catch (err) {
    // An empty DataForSEO account is not a glitch, and it gets its own event
    // name so "the feature is down because nobody topped up" is one grep away
    // rather than a stack trace read at the wrong moment. Same reasoning, and
    // the same event name, as keywordResearchRoute's reportLookupFailure.
    //
    // The customer-facing wording is left alone here: this endpoint's message
    // already says the right thing for both cases, because the wizard can
    // carry on without the numbers either way.
    const billing = isBillingError(err);

    log.error(billing ? 'keywords.accountEmpty' : 'keywords.lookupFailed', err, {
      requestId: req.id,
      userId: String((req.user && req.user._id) || ''),
      metro,
      city: city || null,
      ...(billing ? { action: 'top up the DataForSEO balance at app.dataforseo.com' } : {}),
    });

    res.status(billing ? 503 : 502).json({
      error: 'Could not look up search volumes just now. Your services are '
           + 'still here — you can carry on without the numbers and try again '
           + 'later.',
    });
  }
});

module.exports = router;
module.exports.toLocationName = toLocationName;
module.exports.requestedKeywords = requestedKeywords;
module.exports.spendOnlyOnMisses = spendOnlyOnMisses;
module.exports.placesFor = placesFor;
module.exports.MAX_REQUESTED = MAX_REQUESTED;
