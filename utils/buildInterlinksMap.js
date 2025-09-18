// utils/buildInterlinksMap.js
const { slugify } = require('./slugify');

async function buildInterlinksMap(pages, locationPages = []) {
  // 1) tag service page slugs (from filename without .html)
  pages.forEach(p => { p.slug = String(p.filename || '').replace(/\.html$/i, ''); });

  const serviceSlugs  = pages.map(p => p.slug).filter(Boolean);

  // 2) normalize location slugs (prefer explicit .slug, else from display)
  const locationSlugs = Array.isArray(locationPages)
    ? locationPages.map(l => l?.slug || l?.display || '').filter(Boolean)
    : [];

  // 3) combined ring order: all services, then locations
  const order = [...serviceSlugs, ...locationSlugs];
  const n = order.length;

  const interlinkMap = {};

  // Index/About links to first 5 SERVICES (unchanged behavior)
  interlinkMap['index'] = serviceSlugs.slice(0, 5);

  if (n === 0) return { interlinkMap };

  // 4) every item links to Home + next two (wrap)
  for (let i = 0; i < n; i++) {
    const curr = order[i];
    const next1 = order[(i + 1) % n];
    const next2 = order[(i + 2) % n];
    interlinkMap[curr] = ['index', ...(next1 === next2 ? [next1] : [next1, next2])];
  }

  return { interlinkMap };
}

module.exports = { buildInterlinksMap };
