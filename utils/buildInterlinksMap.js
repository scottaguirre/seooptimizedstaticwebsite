// utils/buildInterlinksMap.js
const { slugify } = require('./slugify');

/**
 * @param {Array}  pages           service pages
 * @param {Array}  locationPages
 * @param {object} [opts]
 * @param {boolean} [opts.includeContact]  put the contact page in the ring
 */
async function buildInterlinksMap(pages, locationPages = [], opts = {}) {
  // 1) tag service page slugs (from filename without .html)
  pages.forEach(p => { p.slug = String(p.filename || '').replace(/\.html$/i, ''); });

  const serviceSlugs  = pages.map(p => p.slug).filter(Boolean);

  // 2) normalize location slugs (prefer explicit .slug, else from display)
  const locationSlugs = Array.isArray(locationPages)
    ? locationPages.map(l => l?.slug || l?.display || '').filter(Boolean)
    : [];

  // 3) combined ring order: all services, then locations, then contact.
  //
  // Contact goes last so the pages before it link TO it — nothing did
  // before except the nav, which every page has anyway. It gets outbound
  // links like any other page in the ring, so the pattern is uniform.
  const includeContact = opts.includeContact !== false;
  const order = [
    ...serviceSlugs,
    ...locationSlugs,
    ...(includeContact ? ['contact'] : []),
  ];
  const n = order.length;

  const interlinkMap = {};

  // Index/About links to first 5 SERVICES (unchanged behavior)
  interlinkMap['index'] = serviceSlugs.slice(0, 5);

  if (n === 0) return { interlinkMap };

  // 4) every item links to Home + the next two in the ring (wrapping)
  //
  // With a small ring, "next two" wraps back round to the page itself —
  // with two items, page A's second target IS page A. A page linking to
  // itself is useless to a visitor and a wasted internal link, so filter
  // the current page out and de-duplicate.
  for (let i = 0; i < n; i++) {
    const curr = order[i];

    const targets = [order[(i + 1) % n], order[(i + 2) % n]]
      .filter(t => t && t !== curr);

    interlinkMap[curr] = ['index', ...new Set(targets)];
  }

  return { interlinkMap };
}

module.exports = { buildInterlinksMap };