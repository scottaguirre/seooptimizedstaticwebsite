// utils/localOptions/render/renderSite.js
//
// A business and six written service pages -> the whole site, as files.
//
// THE SEAM, AND IT IS DELIBERATELY BORING. Every decision worth arguing
// about was made in shape.js, chrome.js, pages.js or schema.js. This calls
// them in order and returns a { path: contents } map, exactly as
// utils/blog/render/publishBlog.js does.
//
// NO MONGO, NO CLOUDFLARE, NO FILESYSTEM. The images are the one thing this
// cannot produce — they are bytes on disk — so they are named here and
// copied by heroes.js at deploy time. A renderer that read a directory could
// not be tested without one.
//
// WHY THE WHOLE SITE, EVERY TIME
//
// A Pages deployment IS the site — whatever is not in it is gone — so a
// deploy of "just the page that changed" deletes the other ten. Direct
// Upload hashes each file and skips the ones it already has, which is why
// this is careful to be deterministic: `now` is an argument, nothing reads
// the clock, and an unchanged site re-renders to byte-identical output and
// costs nothing to re-send.

'use strict';

const { ring, fileFor, urlFor, LEGAL_SLUGS, HERO_COUNT } = require('./shape');

/* THE STRUCTURE BRINGS ITS OWN PAGE BUILDERS — 30 October, when Beacon
 * arrived. This file used to import Ledger's pages.js directly and take the
 * stylesheet from a structure object, which meant `structure: 'beacon'`
 * would have produced Beacon's CSS over Ledger's markup: every selector
 * missing, no error anywhere, a site that renders as unstyled text.
 *
 *     A STYLESHEET AND ITS MARKUP ARE ONE CHOICE, NOT TWO.
 *
 * structures.js is the only file that knows which goes with which. */
const { structureFor, CSS_PATH } = require('./structures');

const { contextFor } = require('./common');

/**
 * The sitemap.
 *
 * THE LEGAL PAGES ARE IN IT. They are indexable pages of the site, and
 * leaving them out of the sitemap while linking them from every footer is a
 * disagreement between two things Google reads.
 *
 * ONE lastmod FOR THE WHOLE SITE, and it is the build date. Per-page dates
 * would be a lie: every page is rewritten on every deploy, so they all
 * changed at the same moment whether or not their bytes differ.
 */
function sitemap({ site, services, now }) {
  const base = String(site).replace(/\/$/, '');
  const day = now.toISOString().slice(0, 10);

  const urls = [...ring(services), ...LEGAL_SLUGS]
    .map(slug => `<url><loc>${base}${urlFor(slug)}</loc><lastmod>${day}</lastmod></url>`)
    .join('');

  return '<?xml version="1.0" encoding="UTF-8"?>\n'
    + '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    + urls
    + '</urlset>\n';
}

/** robots.txt — everything allowed, and the sitemap named absolutely. */
function robots({ site }) {
  const base = String(site).replace(/\/$/, '');

  return `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`;
}

/** What the hero images will be called once heroes.js has copied them. */
function heroPaths() {
  return Array.from({ length: HERO_COUNT }, (_, i) => `assets/hero-${i + 1}.webp`);
}

/**
 * Every file this site is.
 *
 * @param {object}   site
 * @param {object}   site.business   name, trade, address, phone, social
 * @param {Array}    site.services   six, each with slug, name, blurb, h1,
 *                                   meta and sections — written by the model
 * @param {object}   site.home       the home page's own copy
 * @param {object}   [site.contact]  the contact page's own copy
 * @param {string[]} [site.areas]    towns named in the footer and schema
 * @param {Array}    [site.hours]    [{ day, open }], open null for closed
 * @param {object}   [site.alt]      { 1..4: 'alt text' } for the heroes
 * @param {number}   [site.cover]    which hero represents the business, 1..4
 * @param {string}   [site.url]      https://domain, no trailing slash
 * @param {string}   [site.structure] 'ledger'
 * @param {Date}     [site.now]      so a build is reproducible
 * @returns {Object<string,string>}  path -> contents
 */
function renderSite(site = {}) {
  const ctx = contextFor(site);
  const structure = structureFor(site.structure);

  const { homePage, servicePage, contactPage, legalPage, notFoundPage } = structure.pages;

  const files = {};

  files['index.html'] = homePage(ctx, site.home || {});

  for (const service of ctx.services) {
    files[fileFor(service.slug)] = servicePage(ctx, service);
  }

  files[fileFor('contact')] = contactPage(ctx, site.contact || {});

  for (const slug of LEGAL_SLUGS) {
    files[fileFor(slug)] = legalPage(ctx, slug);
  }

  files[CSS_PATH] = `${structure.css.trim()}\n`;
  files['sitemap.xml'] = sitemap({ site: ctx.site, services: ctx.services, now: ctx.now });
  files['robots.txt'] = robots({ site: ctx.site });

  /* 404.html IS NOT ONE OF THE ELEVEN. The eleven are the pages the owner
   * paid for and the progress bar counts; this is infrastructure, like the
   * stylesheet and the sitemap. Cloudflare Pages and GitHub Pages both serve
   * it automatically from the root. */
  files['404.html'] = notFoundPage(ctx);

  return files;
}

module.exports = { renderSite, sitemap, robots, heroPaths };
