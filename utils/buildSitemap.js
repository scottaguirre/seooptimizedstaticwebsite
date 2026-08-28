// utils/buildSitemap.js
//
// Writes sitemap.xml and robots.txt into the generated site.
//
// Webpack leaves both alone: its entry discovery only reads *.html, PurgeCSS
// only globs {html,js}, and the production prune only touches css/ and js/.
// So these are written once at generation time and survive into the ZIP.
//
// NOT used for the WordPress export — WordPress serves its own sitemap at
// /wp-sitemap.xml, and these URLs (with .html, and dist-relative) would be
// wrong there. Two competing sitemaps is worse than one.

const fs = require('fs');
const path = require('path');
const { normalizeDomain } = require('./normalizeDomain');

/**
 * Absolute site root, e.g. https://www.example.com
 * Returns '' when there is no usable domain, which disables sitemap output.
 */
function siteBaseUrl(domain) {
  const raw = String(domain || '').trim();
  if (!raw) return '';

  // Must still look like a hostname after cleaning. normalizeDomain no longer
  // prepends "www." (it used to, which is why this check ran on `raw` first —
  // a bare word like "notadomain" became "www.notadomain" and passed a naive
  // dot check). Validating the normalised form is now both correct and
  // simpler, and it catches a pasted path that would otherwise survive.
  const bare = normalizeDomain(raw);
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(bare)) return '';

  const normalized = normalizeDomain(raw);
  return normalized ? `https://${normalized}` : '';
}

function xmlEscape(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** YYYY-MM-DD, the form sitemaps expect for lastmod. */
function today() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * The legal pages, which are deliberately kept OUT of the sitemap.
 *
 * Their templates carry <meta name="robots" content="noindex, follow">, and a
 * sitemap is a request to index. Listing a noindexed page tells a crawler two
 * opposite things about the same URL — so they are excluded here rather than
 * demoted to priority 0.3 as they used to be.
 *
 * Keep this list in step with the three templates. If you ever drop the
 * noindex tag, delete the filter below in the same change.
 */
const NOINDEX_PAGES = [
  'privacy-policy.html',
  'terms-of-use.html',
  'accessibility.html',
];

/**
 * Build the URL list from the pages actually written to disk.
 *
 * Reading the directory rather than re-deriving filenames means the sitemap
 * can never list a page that failed to generate, or miss one that was added.
 *
 * priority/changefreq are hints only — Google ignores them these days — but
 * they cost nothing and other crawlers still read them.
 */
function collectUrls(distDir, baseUrl) {
  let files = [];
  try {
    files = fs.readdirSync(distDir)
      .filter(f => f.endsWith('.html'))
      .filter(f => !NOINDEX_PAGES.includes(f));
  } catch (err) {
    return [];
  }

  const rank = (file) => {
    if (file === 'index.html') {
      return { loc: `${baseUrl}/`, priority: '1.0', changefreq: 'weekly' };
    }
    if (file.startsWith('location-')) {
      return { loc: `${baseUrl}/${file}`, priority: '0.7', changefreq: 'monthly' };
    }
    // service pages
    return { loc: `${baseUrl}/${file}`, priority: '0.8', changefreq: 'monthly' };
  };

  const urls = files.map(rank);

  // Home first, then by descending priority, then alphabetically — so the
  // file reads sensibly if a human opens it.
  return urls.sort((a, b) => {
    if (a.priority !== b.priority) return Number(b.priority) - Number(a.priority);
    return a.loc.localeCompare(b.loc);
  });
}

function renderSitemap(urls) {
  const lastmod = today();

  const entries = urls.map(u => `  <url>
    <loc>${xmlEscape(u.loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${u.changefreq}</changefreq>
    <priority>${u.priority}</priority>
  </url>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries}
</urlset>
`;
}

function renderRobots(baseUrl) {
  return `User-agent: *
Allow: /

Sitemap: ${baseUrl}/sitemap.xml
`;
}

/**
 * Write sitemap.xml and robots.txt.
 *
 * Never throws: a missing sitemap should not fail a site generation.
 *
 * @returns {{ sitemap: boolean, robots: boolean, urlCount: number }}
 */
function buildSitemap(distDir, globalValues = {}) {
  const result = { sitemap: false, robots: false, urlCount: 0 };

  try {
    const baseUrl = siteBaseUrl(globalValues.domain);
    if (!baseUrl) {
      console.warn('   ⚠️ No usable domain — skipping sitemap.xml and robots.txt');
      return result;
    }

    const urls = collectUrls(distDir, baseUrl);
    if (!urls.length) {
      console.warn('   ⚠️ No HTML pages found — skipping sitemap.xml');
      return result;
    }

    fs.writeFileSync(path.join(distDir, 'sitemap.xml'), renderSitemap(urls), 'utf8');
    result.sitemap = true;
    result.urlCount = urls.length;

    fs.writeFileSync(path.join(distDir, 'robots.txt'), renderRobots(baseUrl), 'utf8');
    result.robots = true;

    console.log(`🗺️  sitemap.xml written (${urls.length} URLs) + robots.txt → ${baseUrl}`);
    return result;

  } catch (err) {
    console.error('   ⚠️ Could not write sitemap/robots:', err.message);
    return result;
  }
}

module.exports = { buildSitemap, siteBaseUrl, collectUrls, renderSitemap, renderRobots, NOINDEX_PAGES };