// utils/blog/businessShape.js
//
// The business details a site reports about itself.
//
// SPLIT OUT OF routes/blogApiRoute.js because three endpoints now write the
// same four fields — activation, planning and the hourly sweep — and three
// copies of a truncation is three places for one of them to be forgotten.
// It also takes plain values, so the rules below can be tested without a
// signed request against a database.
//
// WHY THIS EXISTS AT ALL. `site.business` was written in exactly ONE place —
// the licence activation handler — and read in exactly one — the planner, to
// choose branded anchor text. Nothing in between ever updated it. So a site
// that changed its Business Name in Theme Settings went on planning
// campaigns under whatever it was called the day the licence was pasted in.
//
// roofingamerica.xyz is the worked example: live posts linking with the
// anchor "TK Water Damage Restoration", and others reading "…in Leander",
// months after it had become Emergency Plumber Austin in Austin, TX.

/** Longest we will store for each field. Generous, and bounded. */
const LIMITS = { name: 200, type: 200, location: 200, phone: 50 };

/**
 * Normalise what a site sent, or null when it sent nothing usable.
 *
 * NULL RATHER THAN AN EMPTY SHAPE, and the difference matters: an empty
 * shape written over a good one would wipe the business name every time an
 * older plugin — which sends no business at all — completed a sweep. The
 * caller only writes when this returns something.
 *
 * A field that is present but blank is likewise dropped rather than stored,
 * so a half-filled Theme Settings page cannot erase a name the customer
 * entered elsewhere.
 */
function readBusiness(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const out = {};

  for (const [field, max] of Object.entries(LIMITS)) {
    const text = String(value[field] == null ? '' : value[field]).trim();
    if (text) out[field] = text.slice(0, max);
  }

  return Object.keys(out).length ? out : null;
}

/**
 * Has the site's idea of itself actually changed?
 *
 * Asked so the common case — a sweep every hour reporting the same name for
 * months — costs no write at all. Compares only the fields that arrived: a
 * plugin sending three of the four must not read as "location removed".
 */
function businessChanged(stored, reported) {
  if (!reported) return false;

  const was = stored || {};

  return Object.keys(reported).some(field => {
    const before = String(was[field] == null ? '' : was[field]).trim();
    return before !== reported[field];
  });
}

/**
 * The value to store: what was there, with what arrived written over it.
 *
 * MERGED, NOT REPLACED. Only the fields the site actually sent are touched,
 * so a plugin that reports a name and a town cannot silently drop a phone
 * number an older version had stored.
 */
function mergeBusiness(stored, reported) {
  return Object.assign({}, stored || {}, reported || {});
}

module.exports = { readBusiness, businessChanged, mergeBusiness, LIMITS };
