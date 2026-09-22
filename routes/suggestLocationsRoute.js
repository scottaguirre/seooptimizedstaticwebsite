// routes/suggestLocationsRoute.js
//
//   POST /api/suggest-locations   the business's town -> the towns near it
//
// WHY THIS IS NOT THE SERVICE SUGGESTER WITH A DIFFERENT PROMPT
//
// It asks no model. See the header of utils/nearbyPlaces.js: a model asked for
// nearby towns invents them, and the invented ones look real enough that
// nobody checks. This reads a gazetteer instead.
//
// That changes the shape of the endpoint, not just its innards:
//
//   - no rate limiter of its own. The work is a filter over an array already
//     in memory. There is no per-call cost to protect, so the general limiter
//     is the only ceiling it needs.
//   - no timeout. Nothing can hang.
//   - pressing the button again is free, and gives the NEXT nearest towns
//     rather than the same ones, because the page sends back what it has
//     already shown. There is no two-press cap here: the cap on the service
//     suggester exists because each press costs a model call, and this one
//     costs a sort.
//
// WHAT IT SHARES with the service suggester is the part the customer sees:
// the balance decides how many boxes come back ticked, the list is shown in
// full regardless, and the arithmetic is the server's.

const express = require('express');
const router = express.Router();

const { nearbyPlaces, DEFAULT_RADIUS_MILES, MAX_PLACES } = require('../utils/nearbyPlaces');
const { affordableLocationPages } = require('../utils/pricing');
const { log } = require('../utils/logger');

/** The widest the customer may push the radius, in miles. */
const MAX_RADIUS_MILES = 150;

/** Towns already on the form, so the list does not offer them back. */
function formRows(value) {
  return (Array.isArray(value) ? value : [])
    .map(item => String(typeof item === 'string' ? item : (item && item.name) || '').trim())
    .filter(Boolean)
    .slice(0, 60);
}

router.post('/api/suggest-locations', async (req, res) => {
  const location = String(req.body.location || '').trim().slice(0, 120);

  if (!location) {
    return res.status(400).json({
      error: 'Fill in the business location first, then we can suggest nearby towns.',
    });
  }

  const radiusMiles = Math.min(
    MAX_RADIUS_MILES,
    Math.max(5, Number(req.body.radiusMiles) || DEFAULT_RADIUS_MILES)
  );

  // TWO DIFFERENT LISTS, and they are not interchangeable.
  //
  //   existing  the location ROWS on the form. Excluded from the results AND
  //             counted against the balance, because each one is 100 credits
  //             already committed.
  //   shown     towns already displayed as tick boxes, ticked or not.
  //             Excluded from the results so that pressing the button again
  //             gives the NEXT nearest towns rather than repeating the first
  //             twenty. NOT counted against the balance — an unticked box has
  //             bought nothing.
  const existing = formRows(req.body.existing);
  const shown = formRows(req.body.shown);

  try {
    const { places, home, withinRadius } = nearbyPlaces(location, {
      radiusMiles,
      exclude: existing.concat(shown),
      limit: MAX_PLACES,
    });

    // The business's own town is not in the gazetteer. Say so rather than
    // returning an empty list, which reads as "there is nothing near you":
    // with no coordinates for the centre there was nothing to measure from,
    // and the customer needs to know it is the lookup that failed, not their
    // town that is alone in the world.
    if (!home) {
      return res.status(404).json({
        error: `We could not find "${location}" in our list of towns, so we cannot `
             + 'work out what is nearby. Please add your locations by hand — and '
             + 'check the format is "City, ST".',
      });
    }

    const affordable = affordableLocationPages({
      credits: req.user && req.user.credits,
      siteMode: req.body.siteMode,
      servicePages: Number(req.body.servicePages) || 0,
      locationPages: existing.length,
    });

    log.info('locations.suggested', {
      requestId: req.id,
      userId: String(req.user && req.user._id || ''),
      home: home.display,
      radiusMiles,
      count: places.length,
      withinRadius,
      alreadyShown: shown.length,
      affordable,
    });

    res.json({
      places,
      home: home.display,
      radiusMiles,
      // How many exist inside the radius, so the page can say "20 of 37"
      // rather than implying the list is everything.
      withinRadius,
      // Tick this many, from the nearest. Never more than were found.
      checked: Math.min(affordable, places.length),
      affordable,
    });

  } catch (err) {
    log.error('locations.suggestFailed', err, {
      requestId: req.id,
      userId: String(req.user && req.user._id || ''),
      location,
    });
    res.status(500).json({
      error: 'Could not work out the towns near you just now. Please try again, '
           + 'or add your locations by hand.',
    });
  }
});

module.exports = router;
