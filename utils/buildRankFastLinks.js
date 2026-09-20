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
// HOW THE LINK HOME IS WORDED
//
// The home page is the money page in this mode, and its keyword is the
// BUSINESS NAME — "Emergency Plumber Round Rock" is both at once, which is the
// whole reason the mode exists. So the set of links pointing at './' is the
// inbound anchor profile of a single target, exactly like a blog campaign's,
// and it is planned the same way: allocate the mix across the whole set up
// front, then fill each slot from a pool.
//
//     exact        40%   the business name, verbatim
//     semantic     40%   the query variations around it
//     descriptive  20%   what the reader gets by clicking
//
// Allocated with allocateAnchorTypes() — the same largest-remainder function
// the blog campaigns use, so the counts always total the number of links and
// no bucket clumps. See utils/homeAnchorPool.js for where the phrases come
// from, and why there is no `branded` bucket here when there is one there.
//
// WHAT THIS REPLACED, AND WHY
//
// The wording used to vary with SITE SIZE, and mostly meant a naked URL:
//
//   1-2 pages    every page uses the naked URL
//   3-10 pages   the FIRST page uses the business name, the rest naked
//   11+ pages    the first TWO use the business name, the rest naked
//
// Naked URLs are now 0%. Google's own link documentation names a bare URL as a
// bad anchor, and on a site whose money page IS its home page that spent the
// most valuable slot on the site saying nothing. businessNameAnchorCount() is
// kept and still exported — the rule is worth being able to read, and
// test-business-shape.js asserts on it — but nothing calls it any more.
//
// WHY THE ENTRIES ARE OBJECTS
//
// The classic ring returns plain slugs and lets the injector work out the
// anchor and href. Here the same target needs different anchor text depending
// on where it sits, so each entry carries its own. injectPagesInterlinks
// accepts both shapes: a string behaves exactly as it always has.

const { slugify } = require('./slugify');
const { siteBaseUrl } = require('./buildSitemap');
const { allocateAnchorTypes, pickAnchors } = require('./blog/anchors');
const { HOME_MIX, buildHomeAnchorPool } = require('./homeAnchorPool');

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
 * Plan the anchor text for every link that points at the home page.
 *
 * Planned as a SET rather than per page, for the same reason a blog campaign
 * is: choosing a bucket independently for each page is how a six-page site
 * ends up with six exact-match anchors. Random is not varied. The counts are
 * computed once from HOME_MIX and then spread so no bucket clumps.
 *
 * @param {number} count         how many links point home (every ring node,
 *                               plus contact)
 * @param {object} globalValues  needs .businessName and .location
 * @returns {Array<{type: string, phrase: string}>} one entry per link, in ring
 *          order, contact last
 */
function planHomeAnchors(count, globalValues = {}) {
  if (!Number.isInteger(count) || count < 1) return [];

  const businessName = String(globalValues.businessName || '').trim();

  // No business name is not a Rank Fast site — it is a broken one. The pool
  // would throw, and a throw here would fail the whole generation over anchor
  // text. Fall back to the naked URL, which is exactly what this mode used to
  // do everywhere, and let the site build.
  if (!businessName) {
    const fallback = homeUrl(globalValues) || 'our home page';
    return Array.from({ length: count }, () => ({ type: 'exact', phrase: fallback }));
  }

  const { pool } = buildHomeAnchorPool({
    businessName,
    location: globalValues.location,
  });

  const types = allocateAnchorTypes(count, HOME_MIX);

  // `used` is left empty on purpose. It exists so a SECOND campaign against the
  // same URL avoids the first one's phrases; a generated site is built once, so
  // there is no history to avoid. The exact bucket holds a single phrase and is
  // meant to repeat — pickAnchors marks those `reused: true`, which is expected
  // here rather than a warning.
  return pickAnchors(types, pool);
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

  const interlinkMap = {};

  // The home page. Unchanged from the classic ring: up to five SERVICE pages,
  // plain slugs, so injectIndexInterlinks handles them exactly as it does
  // today. Location pages are deliberately not here.
  interlinkMap['index'] = serviceSlugs.slice(0, 5);

  // Nothing but home links out of contact, so it is excluded from the walk.
  const walkable = order.slice(0, n - 1);

  // Every ring node links home, and so does contact — so the number of links
  // pointing at './' is the walk plus one. Planned as a single set, up front,
  // because the mix describes the WHOLE set and cannot be decided one page at
  // a time. Contact takes the last slot.
  const homeAnchors = planHomeAnchors(walkable.length + 1, globalValues);

  walkable.forEach((curr, i) => {
    const links = [];

    // 1. Home. The phrase comes from the plan; the href never varies.
    //
    // `anchorType` is carried through so injectPagesInterlinks can pick a
    // sentence that reads correctly around this KIND of phrase — "Learn more
    // about our company X" is right for the business name and wrong for
    // "see everything we do". It is metadata for the injector, not markup.
    links.push({
      slug: 'index',
      href: HOME_HREF,
      anchor: homeAnchors[i].phrase,
      anchorType: homeAnchors[i].type,
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

  // Contact: home and nothing else. It takes the last slot of the plan, so it
  // is part of the mix rather than the exception it used to be — it was the
  // one page hard-coded to the naked URL regardless of site size.
  const last = homeAnchors[homeAnchors.length - 1];
  interlinkMap['contact'] = [{
    slug: 'index',
    href: HOME_HREF,
    anchor: last.phrase,
    anchorType: last.type,
  }];

  return { interlinkMap };
}

module.exports = {
  buildRankFastInterlinksMap,
  interlinkSlugs,
  businessNameAnchorCount,
  planHomeAnchors,
  homeUrl,
  HOME_HREF,
};