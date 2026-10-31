// utils/localOptions/render/shape.js
//
// Local Website Options — what the site is made of, before any HTML exists.
//
// THE RING, THE ROTATION, AND THE PAGE LIST. Nothing in here renders
// anything. It answers four questions, and every one of them was got wrong
// at least once in the mock-up this is transcribed from:
//
//   which pages exist          allPaths()
//   what links to what         ring(), ringNext()
//   which photograph a page shows   heroFor()
//   what a page is called      titleOf()
//
// PURE, AND THAT IS THE POINT. No Mongo, no Cloudflare, no filesystem. The
// same shape as utils/blog/render/: values in, values out, so the ring can
// be asserted without building a site.
//
// THE LISTS ARE NOT RE-TYPED HERE. The page set comes from
// utils/seoPresets.js — FIXED_PAGES and LOCAL_OPTIONS_SERVICE_PAGES — which
// is also what prices the mode and what sets the progress bar's denominator.
// A second copy of "six" is a site that builds eight pages, bills for six,
// and shows a bar that stops at 73%.

'use strict';

const {
  FIXED_PAGES,
  LOCAL_OPTIONS_SERVICE_PAGES,
} = require('../../seoPresets');

/**
 * How many service pages. Always this many.
 *
 * Re-exported rather than redeclared so that the renderer, the price and the
 * progress total are one number.
 */
const SERVICE_COUNT = LOCAL_OPTIONS_SERVICE_PAGES;

/**
 * The home page, and then the ring.
 *
 * FIXED_PAGES is ['contact', 'privacy-policy', 'terms-of-use',
 * 'accessibility'] — contact first, because contact is IN the ring and the
 * three legal pages are not. Split here rather than restated, so adding a
 * fifth fixed page to seoPresets puts it in one of these two buckets instead
 * of being silently absent from both.
 */
const CONTACT_SLUG = FIXED_PAGES[0];
const LEGAL_SLUGS = FIXED_PAGES.slice(1);

/**
 * What the legal pages are called.
 *
 * A MAP RATHER THAN A LIST, so the slugs stay owned by seoPresets and only
 * the wording lives here. The suite asserts every FIXED_PAGES entry has a
 * title — a fifth fixed page with no name would otherwise render a tab
 * called "terms-of-sale".
 */
const PAGE_TITLES = {
  contact: 'Contact',
  'privacy-policy': 'Privacy Policy',
  'terms-of-use': 'Terms of Use',
  accessibility: 'Accessibility',
};

/**
 * How many of the six the home page BODY links to.
 *
 * EDWIN, TWICE, BECAUSE I GOT IT WRONG TWICE.
 *
 *   first draft   six rows, all six linked      wrong
 *   second draft  three rows, three linked      wrong
 *   third         six rows, first three linked  right
 *
 * The second draft is the instructive one: the function computed the first
 * three, never used them, and then enumerated all six. THE VARIABLE PROVING
 * THE RULE WAS KNOWN SAT ONE LINE ABOVE THE LOOP THAT BROKE IT.
 *
 * What is capped is links in the BODY, which is what shapes the ring. The
 * nav and the footer are navigation and carry all six.
 *
 * THREE BECAME TWO ON 30 OCTOBER — Edwin: "could you make only the home page
 * to link to only 2 services instead of 3?"
 *
 * "ONLY THE HOME PAGE" IS WHAT THIS CONSTANT ALREADY MEANT, which is why the
 * change is one number and not a fourth draft. homeRows() is its only
 * caller. The header menu, the footer and the ring sentence at the foot of
 * every service page are untouched, so all six services stay reachable —
 * four of them now arrive one click further in from the front page rather
 * than not at all.
 *
 * STILL SIX ROWS SHOWN. The other four are rendered and visibly muted, which
 * is the third draft's rule and the one that took two tries to get right.
 */
const HOME_BODY_LINKS = 2;

/**
 * A small number as a word, for prose that has to agree with a constant.
 *
 * WHY THIS EXISTS. Both structures' home pages carried the sentence "The
 * first three are linked here" — typed out, beside the list the rule
 * actually governs. Cutting HOME_BODY_LINKS to 2 on 30 October left the page
 * SAYING three and SHOWING two, and nothing failed: the rule and its
 * description are in the same file, six lines apart, and only one of them is
 * code.
 *
 *     A SENTENCE DESCRIBING A RULE IS NOT THE RULE.
 *     IT IS THE THIRD TIME THIS PROJECT HAS LEARNED THAT.
 *
 * So the sentence is built from the constant and cannot disagree with it.
 * Words rather than digits because it is prose a customer reads.
 */
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

function inWords(n) {
  return NUMBER_WORDS[n] || String(n);
}

/**
 * How many hero photographs a trade folder holds.
 *
 * The rotation is `index % HERO_COUNT`, so this is the number that decides
 * whether page five reuses page one's picture. Four is what the predefined
 * folders hold; a trade with fewer is handled by heroes.js, not here.
 */
const HERO_COUNT = 4;

/** Anything that would break out of an HTML attribute or a text node. */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * The ring, in order.
 *
 *   index -> service 1 -> ... -> service 6 -> contact -> (back to index)
 *
 * THE LEGAL PAGES ARE NOT IN IT. They sit in the footer, reachable from
 * everywhere and linking onward to nothing. A privacy policy in the ring
 * would put a page nobody reads between two that people do.
 *
 * @param {Array<{slug:string}>} services  in the order they were chosen
 * @returns {string[]}
 */
function ring(services) {
  return ['index', ...(services || []).map(s => s.slug), CONTACT_SLUG];
}

/**
 * The next page in the ring, or null at the end.
 *
 * NULL AT CONTACT, NOT index. Contact closes the circle by linking home in
 * its own markup; returning 'index' here would make "onward" and "home" the
 * same link rendered twice on the last page of the site.
 *
 * @returns {string|null}
 */
function ringNext(order, slug) {
  const at = order.indexOf(slug);

  if (at < 0) return null;

  return at + 1 < order.length ? order[at + 1] : null;
}

/**
 * Which hero photograph a page shows: 1..HERO_COUNT.
 *
 * THE ROTATION WAS REPORTED BROKEN TWICE AND WAS CORRECT BOTH TIMES. Read
 * out of the built HTML it is exactly `index % 4`:
 *
 *   home      1
 *   service 1 2    service 2 3    service 3 4    service 4 1
 *   service 5 2    service 6 3
 *   contact   4
 *
 * What was actually wrong was the pictures: hero-2, hero-3 and hero-4 were
 * the same photograph with different plumbing in it. FOUR IMAGES THAT ARE
 * VARIATIONS OF ONE SHOT GIVE YOU ONE IMAGE, AND A ROTATION YOU CANNOT SEE
 * IS NOT A ROTATION. That is a content problem; this function is not where
 * it gets fixed.
 *
 * A slug outside the ring — a legal page — has no hero and gets 0.
 */
function heroFor(order, slug) {
  const at = order.indexOf(slug);

  if (at < 0) return 0;

  return (at % HERO_COUNT) + 1;
}

/**
 * Where a page is served.
 *
 * A DIRECTORY, NOT A .html FILE. Cloudflare Pages and GitHub Pages both
 * serve /drain-cleaning/ from drain-cleaning/index.html, which is the URL
 * every link, the canonical and the sitemap all name. A file at
 * drain-cleaning.html would be served at /drain-cleaning.html and every one
 * of those three would point somewhere else.
 */
function urlFor(slug) {
  return 'index' === slug ? '/' : `/${slug}/`;
}

/** The file that URL is served from. */
function fileFor(slug) {
  return 'index' === slug ? 'index.html' : `${slug}/index.html`;
}

/**
 * How deep a page's FILE sits below the site root.
 *
 * Two values, because this site is two levels: index.html at the root and
 * <slug>/index.html one below. fileFor() directly above is the authority on
 * that, and this has to agree with it.
 */
function depthOf(slug) {
  return 'index' === slug ? 0 : 1;
}

/** The `../` prefix that climbs from `depth` back to the site root. */
function upTo(depth = 0) {
  return depth > 0 ? '../'.repeat(depth) : '';
}

/**
 * A link from a page AT `depth` to another page.
 *
 * RELATIVE, AND urlFor() IS NOT. The two answer different questions, which
 * is why both exist:
 *
 *   urlFor   where a page LIVES, as a path from the domain root. Correct for
 *            the canonical tag and the sitemap, which are absolute by
 *            definition and must stay that way.
 *   linkTo   how to GET THERE from the page being written.
 *
 * Both were urlFor until 28 October, so every href in every page read
 * `/contact/`. That is right only when the site is served at a domain root,
 * and wrong in three places that matter:
 *
 *   - opened from the filesystem, where `/` is the disk root
 *   - served under a path, as the app's own /dist/user_<id>/ preview does
 *   - ON GITHUB PAGES, where a project site lives at /<repo>/ — and
 *     models/Job.js says this mode is "published to GitHub Pages"
 *
 * So it was never only a preview inconvenience; it was broken for the
 * destination this mode was built for. Edwin met it three times in one
 * afternoon as an unstyled page with a broken hero and a logo that worked —
 * the logo being the one path that happened to be written relative.
 *
 * `depth: null` MEANS ABSOLUTE, and 404.html is the page that needs it: the
 * server returns it for whatever URL was missing, so "where this page is"
 * has no fixed answer and `../` would climb from the wrong place.
 */
function linkTo(slug, depth = 0) {
  if (null === depth) return urlFor(slug);

  const up = upTo(depth);

  /* './' RATHER THAN '' for the home page at the root. An empty href means
   * the current URL including its query and fragment, which is a different
   * thing and behaves oddly on a page reached with one. */
  return 'index' === slug ? (up || './') : `${up}${slug}/`;
}

/**
 * An asset path from a page at `depth`.
 *
 * `file` is the path as renderSite() writes it — 'assets/site.css',
 * 'assets/hero-2.webp' — with no leading slash, so it is already correct
 * for a page at the root.
 */
function assetTo(file, depth = 0) {
  if (null === depth) return `/${file}`;

  return `${upTo(depth)}${file}`;
}

/**
 * What a page is called, for a <title>, a nav item or a breadcrumb.
 *
 * NOT THE H1. A service page's H1 carries the town — "Drain cleaning in
 * Leander, TX" — and repeating that in a nav menu reads as a mistake. This
 * is the short name; the H1 comes from the model with the page.
 */
function titleOf(slug, { business = {}, services = [] } = {}) {
  if ('index' === slug) return business.name || '';
  if (CONTACT_SLUG === slug) return `${PAGE_TITLES.contact} ${business.name || ''}`.trim();

  const service = (services || []).find(s => s.slug === slug);
  if (service) return service.name;

  return PAGE_TITLES[slug] || slug;
}

/**
 * Every file this site writes, in ring order then legal.
 *
 * THE LENGTH OF THIS IS THE PROGRESS BAR'S DENOMINATOR, and it must equal
 * pagesToBuild('localoptions'). The suite asserts that against seoPresets
 * rather than against 11, so that changing the service count moves both.
 */
function allPaths(services) {
  return [
    ...ring(services).map(fileFor),
    ...LEGAL_SLUGS.map(fileFor),
  ];
}

/**
 * The six rows the home page shows, and which of them are links.
 *
 * RETURNED AS DATA RATHER THAN DECIDED IN THE TEMPLATE. The rule above was
 * broken twice inside a rendering function, where it was invisible. Here it
 * is one flag per row and the suite can count them.
 */
function homeRows(services, depth = 0) {
  return (services || []).map((service, i) => ({
    service,
    index: i,
    linked: i < HOME_BODY_LINKS,

    /* linkTo, NOT urlFor — and this was the last absolute href left in the
     * site after the rest were converted. The three linked service rows on
     * the home page still read `/drain-cleaning/`, which is invisible in a
     * diff and obvious in a render: every other path on the page was
     * relative and these three were not. Found by listing every href in
     * every rendered page rather than by reading the change. */
    href: linkTo(service.slug, depth),
  }));
}

module.exports = {
  SERVICE_COUNT,
  inWords,
  HOME_BODY_LINKS,
  HERO_COUNT,
  CONTACT_SLUG,
  LEGAL_SLUGS,
  PAGE_TITLES,
  esc,
  ring,
  ringNext,
  heroFor,
  urlFor,
  linkTo,
  assetTo,
  depthOf,
  upTo,
  fileFor,
  titleOf,
  allPaths,
  homeRows,
};
