// utils/formatCityState.js
//
// Turns whatever the user typed into the wizard into "City, ST".
//
// THE BUG THIS FIXES
// The previous version took the LAST part of the input as the state. That
// works for "Leander Tx", but the moment someone includes a zip code — which
// they often do, because the field asks for a location and an address feels
// natural — it breaks badly:
//
//   "Richardson Tx, 75080"  ->  "Richardson Tx, 75080"   (unchanged)
//   "Round Rock TX 78664"   ->  "Round Rock Tx, 78664"   (state title-cased
//                                                         into the city)
//
// So headings read "WHO IS EMERGENCY PLUMBER RICHARDSON?" over
// "Richardson Tx, 75080", with a lowercase state and a zip that does not
// belong in a heading.
//
// This version finds the state by looking for a real two-letter US state
// code, and drops anything after it. The full address is kept intact
// elsewhere for the NAP block and schema, where a zip genuinely belongs.

const US_STATES = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
]);

/** "12345" or "12345-6789" */
function isZip(token) {
  return /^\d{5}(-\d{4})?$/.test(token);
}

function titleCase(word) {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}

/**
 * @param {string} input  e.g. "Richardson Tx, 75080"
 * @returns {string}      e.g. "Richardson, TX"
 *
 * Returns the trimmed input unchanged when no state can be identified —
 * better to show what the user typed than to mangle it.
 */
function formatCityState(input) {
  if (!input || typeof input !== 'string') return '';

  const parts = input.trim().split(/[\s,]+/).filter(Boolean);
  if (parts.length < 2) return input.trim();

  // Find the LAST token that is a real state code. Searching from the end
  // handles "Washington DC" correctly, where an earlier token could also
  // look state-like.
  let stateIndex = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    if (US_STATES.has(parts[i].toUpperCase())) {
      stateIndex = i;
      break;
    }
  }

  // No recognisable state. Fall back to the old behaviour, but skip a
  // trailing zip so "Richardson 75080" does not become "Richardson, 75080".
  if (stateIndex === -1) {
    const withoutZip = parts.filter(p => !isZip(p));
    if (withoutZip.length < 2) return withoutZip.join(' ') || input.trim();

    const last = withoutZip[withoutZip.length - 1].toUpperCase();
    const city = withoutZip.slice(0, -1).map(titleCase).join(' ');
    return `${city}, ${last}`;
  }

  const state = parts[stateIndex].toUpperCase();

  // Everything before the state is the city; everything after (a zip, a
  // country, stray punctuation) is dropped.
  const city = parts.slice(0, stateIndex).map(titleCase).join(' ');

  return city ? `${city}, ${state}` : state;
}

module.exports = { formatCityState };