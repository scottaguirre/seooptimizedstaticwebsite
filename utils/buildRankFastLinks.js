// utils/buildRankFastLinks.js
//
// The Rank Fast interlink ring.
//
// Rank GBPs and One-Page Design keep utils/buildInterlinksMap.js exactly as it
// is. This is a separate builder because the two structures genuinely differ,
// and a shared function with mode branches inside it would be one edit away
// from changing the mode nobody asked to change.
//
// THE STRUCTURE
//
//   ring order   every service page, then every location page, then contact
//   home         NOT in the ring. It links out to up to 5 service pages from
//                its second paragraph — unchanged from the classic ring.
//   every node   links home, then forward to the next two in the ring,
//                wrapping at the end so the circle closes
//   contact      is a TARGET in the ring but links only home. Nothing follows
//                it, which is what stops the chain running off the end.
//
// WHAT VARIES WITH SITE SIZE
//
// Only the anchor text used for the link home:
//
//   1-2 pages    every page uses the naked URL
//   3-10 pages   the FIRST page uses the business name, the rest naked
//   11+ pages    the first TWO use the business name, the rest naked
//
// "Pages" counts service pages AND location pages together. Services come
// first in the ring, so the business-name anchor lands on a service page on
// any site that has one.
//
// WHY THE ENTRIES ARE OBJECTS
//
// The classic ring returns plain slugs and lets the injector work out the
// anchor and href. Here the same target needs different anchor text depending
// on where it sits, so each entry carries its own. injectPagesInterlinks
// accepts both shapes: a string behaves exactly as it always has.

const { slugify } = require('./slugify');
const { siteBaseUrl } = require('./buildSitemap');

/**
 * Where a home link POINTS. Always relative, like every other link on the site.
 *
 *   <a href="./">https://www.example.com</a>
 *
 * The naked URL is the visible text — that is the whole point of the format —
 * but the href stays './' because that is the only form that works everywhere
 * the generated site goes: opened from the ZIP as a local file, previewed on a
 * temporary host, or live on the real domain. An absolute href would send a
 * visitor to the live site from a preview, and would hard-code a host the
 * customer may not actually resolve at.
 *
 * WordPress rewrites './' to home_url() (see ${p}_fix_links in the section
 * renderer), so the exported theme resolves it correctly too, subdirectory
 * installs included.
 */
const HOME_HREF = './';

/**
 * What a naked-URL link SAYS.
 *
 * siteBaseUrl() is the SAME function the sitemap, robots.txt and the canonical
 * tags use, so the URL a visitor reads matches the one the site declares
 * everywhere else — normalizeDomain() prepends "www.", and a hand-rolled
 * https://example.com here would have shown a different host to the one the
 * sitemap and schema name.
 *
 * Returns '' for an unusable domain; the caller falls back to the business
 * name, because "./" as visible link text would read as a mistake.
 */
function homeUrl(globalValues = {}) {
  return siteBaseUrl(globalValues && globalValues.domain) || '';
}

/**
 * The plain slugs behind a target list, whichever shape it is in.
 *
 * The Rank Fast ring returns { slug, href, anchor } objects; the classic ring
 * returns plain strings. injectPagesInterlinks understands both — but the
 * CONTENT prompts do not, and they read the list positionally:
 *
 *     Include this exact lowercase phrase: ${keywords[1]}
 *
 * Hand an object to that and the prompt asks the model to include the literal
 * text "[object Object]" in the page copy. Any call site that passes the list
 * to a prompt rather than to the injector must send it through here first.
 *
 * @param {Array<string|{slug:string}>} entries
 * @returns {string[]}
 */
function interlinkSlugs(entries = []) {
  return (entries || [])
    .map(e => (e && typeof e === 'object') ? String(e.slug || '') : String(e || ''))
    .filter(Boolean);
}

/**
 * How many pages lead with the business name rather than the naked URL.
 *
 * @param {number} pageCount  service pages + location pages
 */
function businessNameAnchorCount(pageCount) {
  if (pageCount >= 11) return 2;
  if (pageCount >= 3) return 1;
  return 0;
}

/**
 * @param {Array}  pages          service pages
 * @param {Array}  locationPages
 * @param {object} globalValues   needs .domain and .businessName
 * @returns {{interlinkMap: object}}
 */
async function buildRankFastInterlinksMap(pages, locationPages = [], globalValues = {}) {
  // Tag every page object with its slug.
  //
  // This is the same side effect buildInterlinksMap performs, and it is NOT
  // about links: runGeneration reads page.slug afterwards to look the page up
  // in the map. Both builders must do it or the caller breaks depending on
  // which mode is running.
  pages.forEach(p => { p.slug = String(p.filename || '').replace(/\.html$/i, ''); });

  const serviceSlugs = pages.map(p => p.slug).filter(Boolean);

  const locationSlugs = Array.isArray(locationPages)
    ? locationPages.map(l => (l && (l.slug || l.display)) || '').filter(Boolean)
    : [];

  // Contact always closes the ring.
  const order = [...serviceSlugs, ...locationSlugs, 'contact'];
  const n = order.length;

  const businessName = String(globalValues.businessName || '').trim();

  // The text of a naked-URL link. Falls back to the business name when there
  // is no usable domain to show.
  const nakedText = homeUrl(globalValues) || businessName || 'our home page';

  const named = businessNameAnchorCount(serviceSlugs.length + locationSlugs.length);

  const interlinkMap = {};

  // The home page. Unchanged from the classic ring: up to five SERVICE pages,
  // plain slugs, so injectIndexInterlinks handles them exactly as it does
  // today. Location pages are deliberately not here.
  interlinkMap['index'] = serviceSlugs.slice(0, 5);

  // Nothing but home links out of contact, so it is excluded from the walk.
  const walkable = order.slice(0, n - 1);

  walkable.forEach((curr, i) => {
    const links = [];

    // 1. Home. The first `named` pages use the business name; everyone else
    //    uses the naked URL. Same href either way.
    links.push({
      slug: 'index',
      href: HOME_HREF,
      anchor: (i < named && businessName) ? businessName : nakedText,
    });

    // 2. The next two in the ring, wrapping.
    //
    // A page is filtered out of its own target list — with a two-node ring the
    // second step comes back round to the page itself, and a page linking to
    // itself is a wasted link and a confusing one.
    const forward = [order[(i + 1) % n], order[(i + 2) % n]]
      .filter(t => t && t !== curr);

    for (const target of new Set(forward)) {
      links.push(
        target === 'contact'
          // Fixed anchor, per spec.
          ? { slug: 'contact', href: 'contact.html', anchor: 'Contact Us' }
          // Anchor and href resolved by the injector from the slug, exactly as
          // in the classic ring — "drain cleaning", "Austin TX".
          : { slug: target }
      );
    }

    interlinkMap[curr] = links;
  });

  // Contact: home and nothing else, always the naked URL.
  interlinkMap['contact'] = [{ slug: 'index', href: HOME_HREF, anchor: nakedText }];

  return { interlinkMap };
}

module.exports = {
  buildRankFastInterlinksMap,
  interlinkSlugs,
  businessNameAnchorCount,
  homeUrl,
  HOME_HREF,
};