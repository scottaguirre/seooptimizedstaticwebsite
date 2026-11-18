// utils/cloudflareSites/wanted.js
//
// Where a generator submission wants its finished website to go.
//
//   siteTargetOf(body)    'cloudflare' | ''
//   wantedAddress(body)   { name, prefix, domain }
//
//
// WHY THIS IS A FILE AND NOT TWO LINES AT EACH CALL SITE
//
// The posted body arrives in TWO SHAPES. The wizard submits multipart, and
// multer expands bracket notation through `append-field`, so the fields
// land as `body.global.cloudflare.prefix`. A urlencoded post — the suites,
// anything hand-made, an `extended: false` parser — leaves them flat, as
// `body['global[cloudflare][prefix]']`.
//
// routes/generateRoute.js already carries the scar: the site mode is read as
//
//     req.body.global?.siteMode ?? req.body['global[siteMode]']
//
// and the note above it explains that reading only the first shape is what
// refused a whole mode's builds. THREE places now need the destination —
// that route, utils/jobGenerator.js when the build finishes, and the tests —
// and three copies of a two-shape read is three chances to write one of
// them with a single shape.
//
//     THE BUG THIS PREVENTS IS SILENT. A missed destination does not
//     throw: the build succeeds, goes nowhere, and says nothing.
//
//
// NOTHING IS VALIDATED HERE
//
// This reads a request. checkWant() in routes/cloudflareSitesRoute.js
// decides whether what it read is usable — the name, the subdomain's shape,
// the domain's membership of the website pool, the hostname being free, the
// per-user cap. Splitting the reading from the judging is what lets the
// generator form run those checks before it charges anybody and the publish
// run them again afterwards, out of one implementation.

'use strict';

/** The set of destinations that mean anything. Mirrors SITE_TARGETS in
 *  public/js/generateDinamycForm.js — the browser's copy guards the meta
 *  tag, this one guards the POST, and neither trusts the other. */
const TARGETS = new Set(['cloudflare']);

/**
 * Read one `global[...]` field out of either body shape.
 *
 * @param {object} body  req.body, or a job's payload
 * @param {string} path  e.g. 'siteTarget' or 'cloudflare.prefix'
 */
function globalField(body, path) {
  if (!body || 'object' !== typeof body) return undefined;

  const parts = String(path).split('.');

  // Shape one: expanded. body.global.cloudflare.prefix
  let node = body.global;
  for (const part of parts) {
    if (!node || 'object' !== typeof node) { node = undefined; break; }
    node = node[part];
  }
  if (undefined !== node && null !== node) return node;

  // Shape two: flat. body['global[cloudflare][prefix]']
  return body[`global[${parts.join('][')}]`];
}

/**
 * Where this submission publishes, if anywhere.
 *
 * AGAINST THE LIST, NOT TRUSTED AS POSTED. An unknown value reads as "no
 * destination", which is the safe end: the build stays in the build folder
 * and the customer can publish it by hand. Trusting it would have
 * utils/jobGenerator.js branch on a destination nothing implements.
 *
 * @returns {string} 'cloudflare', or '' for "leave it where it is built"
 */
function siteTargetOf(body) {
  const v = String(globalField(body, 'siteTarget') || '').trim();

  return TARGETS.has(v) ? v : '';
}

/**
 * The address the review step asked for.
 *
 * ALWAYS AN OBJECT, never undefined, so callers do not each write their own
 * `|| {}` — and checkWant() refuses an empty one with `badName`, which is
 * the right answer for a Cloudflare submission that carried no address.
 *
 * STRINGS, TRIMMED, AND NOTHING ELSE. A repeated field arrives from
 * append-field as an array, and `String(['a','b'])` is 'a,b' — which
 * normalisePrefix then rejects, rather than a prefix of [object Object]
 * reaching a hostname.
 */
function wantedAddress(body) {
  const read = (k) => {
    const v = globalField(body, `cloudflare.${k}`);

    return Array.isArray(v) ? String(v[0] || '').trim() : String(v || '').trim();
  };

  return { name: read('name'), prefix: read('prefix'), domain: read('domain') };
}

/**
 * Rewrite the posted domain to the hostname the site will actually live at.
 *
 * WHY THIS EXISTS — 17 November, Edwin.
 *
 * The wizard asks for a DOMAIN on step 4 (`acmesites.com`, from the pool)
 * and a SUBDOMAIN on the review step (`hvac`), and the site publishes to
 * `hvac.acmesites.com`. But `utils/canonicalUrl.js` and
 * `utils/buildSitemap.js` both build from `global.domain`, so every page
 * shipped saying
 *
 *     <link rel="canonical" href="https://acmesites.com/contact.html">
 *
 * on a page served from `hvac.acmesites.com`. A canonical is an INSTRUCTION
 * — *index this address, not the one you are on* — and that address is a
 * different site, or nothing at all. Worst case the subdomain's pages are
 * dropped from the index in favour of an address that does not serve them.
 *
 *     THE PAGES WERE TELLING GOOGLE TO INDEX SOMEWHERE THEY DO NOT LIVE.
 *
 * AND THE SITEMAP AGREED WITH THE CANONICAL, which is the only reason this
 * was not noticed sooner: the two were consistent with each other and both
 * wrong, which is the state canonicalUrl.js's own header says is worse than
 * having no canonical at all.
 *
 * NOT A REGRESSION FROM THE TWO-STEP VERSION. The generator never knew the
 * subdomain, because it was typed on a different screen afterwards. The fix
 * is only possible now that both arrive in one submit.
 *
 * WHY REWRITE THE BODY RATHER THAN THREAD AN ARGUMENT THROUGH. `global.domain`
 * is read in `utils/runGeneration.js`, and from there reaches the canonical
 * of seven page builders, the sitemap, and the htaccess redirects. The ONE
 * thing they agree on is that the address comes from that field, so the
 * narrow change is to make that field right — rather than to add a second
 * source of truth and seven places that have to choose between them.
 *
 * THE PAYLOAD IS THE BODY, so this also fixes the rebuild: the job stores
 * `req.body`, and a site rebuilt later gets the hostname it is published at.
 *
 * BOTH SHAPES, like every read above. Only the shapes that were already
 * there are written — a flat body does not grow a `global` object and an
 * expanded one does not grow a bracketed key, because either would leave
 * two spellings of the domain in the payload for the next reader to pick
 * between.
 *
 * @param {object} body      req.body, mutated in place
 * @param {string} hostname  e.g. 'hvac.acmesites.com'
 * @returns {boolean} whether anything was written
 */
function setGlobalDomain(body, hostname) {
  const value = String(hostname || '').trim();
  if (!body || 'object' !== typeof body || !value) return false;

  let wrote = false;

  if (body.global && 'object' === typeof body.global) {
    body.global.domain = value;
    wrote = true;
  }

  if (Object.prototype.hasOwnProperty.call(body, 'global[domain]')) {
    body['global[domain]'] = value;
    wrote = true;
  }

  return wrote;
}

module.exports = { siteTargetOf, wantedAddress, setGlobalDomain, globalField, TARGETS };
