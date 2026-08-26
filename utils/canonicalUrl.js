// utils/canonicalUrl.js
//
// The <link rel="canonical"> for a generated page.
//
// WHAT IT IS FOR
// The same page is reachable at more addresses than anyone intends:
//
//   https://www.example.com/          https://example.com/
//   http://www.example.com/           https://www.example.com/index.html
//   https://www.example.com/?utm_source=facebook
//
// A crawler seeing five addresses has to decide whether that is one page or
// five. Guess wrong and the ranking signals split across versions, and none of
// them ranks as well as one consolidated page would. The canonical tag settles
// it: "however you got here, index THIS address."
//
// Every page here points at ITSELF. These sites have no duplicate content to
// consolidate, so the tag is not redirecting a crawler somewhere better — it is
// pinning down which of the several spellings of this page's own address is the
// real one.
//
// WHY IT SHARES siteBaseUrl WITH THE SITEMAP
// A canonical that disagrees with the URL in sitemap.xml is worse than no
// canonical at all: the site then makes two different claims about the same
// page. So the base URL comes from the exact function buildSitemap uses,
// including its www prefix and its domain validation. If the sitemap says
// https://www.example.com/contact.html, so does the canonical, character for
// character.
//
// NOT FOR WORDPRESS. WordPress emits its own rel=canonical on singular pages,
// and its permalinks are /water-heater-repair-leander-tx/ rather than .html —
// so a canonical baked into content.json would be actively wrong there. This
// is static-only, exactly like the sitemap.

const { siteBaseUrl } = require('./buildSitemap');

/**
 * @param {object} globalValues  needs .domain
 * @param {string} htmlFile      e.g. 'contact.html', 'index.html'
 * @returns {string} absolute URL, or '' when the domain is unusable
 *
 * index.html canonicalises to the bare root — https://www.example.com/ — not
 * to /index.html. Both serve the home page, so one has to be chosen, and the
 * root is both the conventional choice and the one collectUrls() already
 * writes into the sitemap.
 */
function canonicalUrl(globalValues = {}, htmlFile = '') {
  const base = siteBaseUrl(globalValues && globalValues.domain);
  if (!base) return '';

  const file = String(htmlFile || '').replace(/^\.?\//, '').trim();

  if (!file || file === 'index.html') return `${base}/`;

  return `${base}/${file}`;
}

/**
 * The tag itself, ready to drop into <head>.
 *
 * Returns '' when there is no usable domain, so the placeholder disappears
 * rather than emitting <link rel="canonical" href="">, which would tell a
 * crawler to canonicalise the page to nothing. Same call the sitemap makes
 * when it decides to skip itself.
 */
function canonicalTag(globalValues = {}, htmlFile = '') {
  const url = canonicalUrl(globalValues, htmlFile);
  if (!url) return '';

  // Filenames are slugified and the domain is regex-validated upstream, so
  // there is nothing here that needs escaping today. Done anyway: this string
  // goes inside an HTML attribute, and that should not depend on an invariant
  // held three files away.
  const safe = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  return `<link rel="canonical" href="${safe}">`;
}

module.exports = { canonicalUrl, canonicalTag };