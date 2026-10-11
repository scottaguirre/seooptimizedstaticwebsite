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
 * A field that is present but blank is dropped rather than stored, so a
 * half-filled Theme Settings page cannot erase a name the customer entered
 * elsewhere.
 *
 * `authoritative` IS THE WAY BACK OUT OF THAT, and it exists because the rule
 * above has no opposite. A blank meant "I am not telling you", and there was
 * no way at all to say "I am telling you: there is nothing here". So a value
 * could be changed and never removed.
 *
 * WHAT THAT COST, on roofingamerica.xyz, 11 October. The site was wiped and
 * rebuilt as a roofing company and reconnected with its old licence. Its theme
 * settings were empty, so the plugin reported blanks, so the server kept what
 * the record held from the domain's previous life — type "Plumbing", location
 * "Austin, TX". Ninety-five articles were then written for an Austin plumber,
 * and nothing on any screen said why. Edwin found it by noticing that roofing
 * topics kept mentioning Austin weather.
 *
 * So the site may now name the fields it is ANSWERING FOR. A field in that
 * list is taken at its word — blank means blank, and the stored value is
 * cleared. A field outside it keeps the old behaviour exactly.
 *
 * THE PLUGIN ONLY SENDS THE LIST WHEN IT ACTUALLY LOOKED SOMEWHERE. If no
 * settings source can be found at all — the theme is gone, the options row is
 * missing — it has learned nothing and says nothing, which is the case the
 * original guard was written for and which this must not break.
 *
 * @param {object} value          the business the site reported
 * @param {string[]} authoritative fields whose blanks are deliberate
 */
function readBusiness(value, authoritative = []) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

  const clearable = new Set(
    Array.isArray(authoritative) ? authoritative.map(f => String(f)) : []
  );

  const out = {};

  for (const [field, max] of Object.entries(LIMITS)) {
    const text = String(value[field] == null ? '' : value[field]).trim();

    if (text) {
      out[field] = text.slice(0, max);
      continue;
    }

    /* Listed AND present. A site that claims to answer for `location` but
     * never sends the key has not answered for it — that is a client bug, and
     * reading it as "clear the location" would turn one into data loss. */
    if (clearable.has(field) && Object.prototype.hasOwnProperty.call(value, field)) {
      out[field] = '';
    }
  }

  return Object.keys(out).length ? out : null;
}

/**
 * Has the site's idea of itself actually changed?
 *
 * Asked so the common case — a sweep every hour reporting the same name for
 * months — costs no write at all. Compares only the fields that arrived: a
 * plugin sending three of the four must not read as "location removed".
 *
 * A DELIBERATE CLEAR IS A CHANGE, and it already is one here: readBusiness()
 * puts an explicit '' in `reported`, and '' !== 'Austin, TX'. Worth stating
 * because the obvious tightening — skipping falsy reported values to avoid
 * "needless" writes — would silently restore the bug this pair exists to end,
 * and every test would still pass except the one that names it.
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
