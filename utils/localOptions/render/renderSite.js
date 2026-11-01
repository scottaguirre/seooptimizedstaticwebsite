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
 * The host this site owns, or '' when it does not own one.
 *
 * WHY A FILE AND NOT AN API CALL — 1 November, when sites moved from
 * `domain.com/business-name/` to `business-name.domain.com`.
 *
 * A CUSTOM DOMAIN ON GITHUB PAGES *IS* A FILE NAMED CNAME IN THE REPOSITORY
 * ROOT. The settings box writes one; the Pages API writes one. Both are ways
 * of putting this file there.
 *
 * AND THAT MATTERS BECAUSE OF HOW WE PUSH. commit.js builds the tree FROM THE
 * GIVEN FILES ALONE — deliberately, so a page deleted from a site is deleted
 * from the repository. A CNAME placed by the API would therefore survive
 * exactly until the next publish, and then vanish: the site would come off
 * its subdomain on the SECOND deploy, not the first, which is the worst way
 * to find anything.
 *
 *     A FILE THE PUSH DOES NOT KNOW ABOUT IS A FILE THE PUSH DELETES.
 *
 * Rendering it makes the domain part of the site rather than a setting beside
 * it, so it cannot drift, cannot be wiped, and needs no call to put it back.
 *
 * ONLY WHEN THE SITE OWNS THE WHOLE HOST. A site served at
 * `7-y.xyz/chicago-plumber/` shares its host with every other site on that
 * apex, and a CNAME in one of their repositories would try to claim the apex
 * for that one repository — which is how a root site gets taken down. The
 * path is the test: no path, the host is ours; any path, it is not.
 *
 * NO TRAILING NEWLINE QUESTION TO ARGUE ABOUT: GitHub writes the file with
 * one, so this does too, and a re-render matches what is already there rather
 * than showing as a change on every deploy.
 */
function cnameFor(url) {
  let parsed;

  try {
    parsed = new URL(String(url || ''));
  } catch (_) {
    /* Not a URL at all. The suite builds sites with no url, and a renderer
     * that threw on one would fail a test that is about something else. */
    return '';
  }

  if ('/' !== parsed.pathname.replace(/\/+$/, '/')) return '';

  return parsed.hostname;
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

  /* THE CUSTOM DOMAIN, AS A FILE. See cnameFor() above for why it is
   * rendered rather than set through the Pages API: the push rebuilds the
   * tree from these files, so a CNAME it does not know about is a CNAME it
   * deletes on the next deploy.
   *
   * ABSENT, NOT EMPTY, when the site shares a host. An empty CNAME file is
   * not "no custom domain" to GitHub — it is a custom domain of "", and the
   * behaviour of that is nobody's business to find out on a client's site. */
  const host = cnameFor(ctx.site);

  if (host) files.CNAME = `${host}\n`;

  return files;
}

module.exports = { renderSite, sitemap, robots, heroPaths, cnameFor };
