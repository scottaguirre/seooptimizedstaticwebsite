// utils/blog/render/postPage.js
//
// One article -> one HTML page.
//
// PURE. A BlogPost document and its blog go in, a string comes out. No
// database, no filesystem, no network, no clock — the publish date is read
// off the document rather than from `new Date()`. That is what makes a page
// testable in memory, and it is also what makes a deploy idempotent: the
// same article renders to a byte-identical file every time, so Cloudflare's
// Direct Upload hashing can skip a file that has not changed.
//
// THE ESCAPING RULE, AND IT IS NOT NEGOTIABLE
//
// The prose is model output. It is untrusted text, and the ONLY markup
// allowed to reach the page is markup we put there ourselves.
//
// So the order is: escape every paragraph and heading FIRST, then substitute
// the link tokens. The tokens survive escaping because `{{money}}` contains
// no HTML. Do it the other way round and the <a> tags we just inserted get
// escaped into visible text — or worse, a paragraph containing a < is
// treated as markup.
//
// This is the same property IE_Links::render() has on the WordPress side,
// and the comment above insert_post() in class-ie-publisher.php explains why
// the server deliberately does NOT pre-render for the plugin. Two renderers,
// one rule.
//
// THE LINKS THEMSELVES ARE NOT REIMPLEMENTED HERE. utils/blog/links.js has
// applyLinks(), the same function the preview harness uses, and it already
// handles all three token kinds, the pending span and the capital letter at
// the start of a sentence. A second copy of that logic is a second set of
// bugs.
//
// THE TWO CLASS NAMES, WHICH ARE EASY TO GET THE WRONG WAY ROUND
//
// They are the static blog's OWN names, and that is new as of 19 October.
// This page used to emit .ie-styled and .ie-post — the plugin's names — so
// both products could be served by the plugin's one stylesheet. Once Edwin
// wanted the two looks to differ the sheet was forked, and the names were
// forked with it; see the long note at the top of theme.js. A rule written
// for a static blog now CANNOT reach a WordPress page, because no
// WordPress page has an element it matches.
//
//   .cloudflare-styled   goes on <body>. It declares --cloudflare-gutter
//                        and carries the rule giving the <h1> its 26ch
//                        measure.
//   .cloudflare-post     wraps the ARTICLE BODY ONLY — not the title.
//
// The h1 and the date are SIBLINGS of the wrapper, not children of it, and
// that is load-bearing: `.cloudflare-post > :first-child` zeroes the top
// margin so the article's opening element sits tight under the title. Put
// the h1 inside the wrapper and that rule fires on the title instead, and
// the gap under it disappears. The SHAPE still matches WordPress's even
// though the names no longer do, which is worth keeping — the two products
// print the same articles, and the structure a reader gets should not
// depend on where the thing is hosted.
//
// THE NAMES COME FROM theme.js, NOT FROM LITERALS HERE. Six strings spelled
// out in both the stylesheet and the template is six chances to miss one in
// a rename. CLASSES is the one place they are named, and the suite asserts
// that every name in it reaches both the stylesheet and the page.
//
// WHAT A PENDING LINK MEANS ON A STATIC BLOG
//
// On WordPress a forward link is pending because the post it points at is
// dated in the future and returns 404 until then. On a static blog the same
// problem exists for a different reason: an article that has not been
// deployed yet has no page at all. So the caller — interlinks.js — decides
// which articles exist in THIS deploy and passes a `pendingId` for the rest.
// This file does not make that decision; it renders what it is handed.

'use strict';

const { applyLinks } = require('../links');

/* The six class names, from the stylesheet that defines them. theme.js
 * requires nothing from here, so there is no cycle. */
const { CLASSES } = require('./theme');

/** Text going into an element. */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * JSON for a <script> block.
 *
 * JSON.stringify ALONE IS NOT ENOUGH, and the test caught it. An HTML
 * parser does not know it is looking at JSON — it looks for `</script>`
 * and ends the element there, whatever the quoting. So a title reading
 *
 *     He said "it pops" </script><script>alert(1)</script>
 *
 * closes our block early and the rest of the line becomes live markup on a
 * page published under a customer's domain. The model writes these titles.
 *
 * Escaping `<`, `>` and `&` as unicode sequences fixes it without breaking
 * the JSON: they are legal escapes inside a JSON string, every parser
 * reads them back as the original characters, and nothing outside a string
 * literal in JSON output can be one of those three characters — so a
 * blanket replace cannot corrupt the structure.
 *
 * NOT esc(). HTML-escaping the block would turn `&` into `&amp;` INSIDE
 * the JSON text, and a parser reading the script's contents gets the five
 * literal characters, not an ampersand. The data would be wrong rather
 * than unsafe, which is harder to notice.
 */
function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

/* The months, written out, because toLocaleDateString() is not the same
 * function on two machines. It reads the host's locale and ICU data, so the
 * server could render "3 November 2026" and a laptop "11/3/2026" from the
 * same document — and the deploy would then upload every page because the
 * bytes changed. A rendered file has to be a pure function of its input. */
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * A date a reader can parse, and one a machine can.
 *
 * UTC throughout. The server's timezone is not the blog's, and letting the
 * host decide would move a post published at 23:00 to the previous day on
 * one machine and not another.
 */
function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;

  return {
    iso: date.toISOString().slice(0, 10),
    human: `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`,
  };
}

/**
 * Where this article lives.
 *
 * A TRAILING SLASH, and the same one everywhere. Cloudflare Pages serves
 * `/my-post/` from `my-post/index.html`, and a canonical that disagrees with
 * the URL the page is actually served at is a canonical pointing somewhere
 * else — which is worse than having none.
 *
 * ONE ARTICLE IS THE ROOT, and this is where that is decided.
 *
 * There is no listing page: Edwin, 17 October — *"the same blog format, no
 * blog page"*. The articles are reached by their own URLs and by the ring
 * of links between them, exactly as the plugin produces on WordPress. But a
 * static site still has to answer for the bare domain, so one article is
 * served at `/` — the same choice the plugin offers as its "home page"
 * checkbox.
 *
 * THAT ARTICLE LIVES AT `/` AND NOWHERE ELSE. Writing it to `/` and to
 * `/its-slug/` as well would put one article at two addresses, competing
 * with itself, and every link in the ring would have to pick one. The
 * renderer emits one file for it, and every reference — canonical, og:url,
 * JSON-LD, and whatever interlinks.js hands the other posts — comes through
 * this function, so there is one answer rather than several.
 */
function postUrl(blog, slug, isHome = false) {
  const host = String((blog && blog.siteUrl) || '').replace(/\/+$/, '');
  if (isHome) return `https://${host}/`;

  return `https://${host}/${String(slug || '').replace(/^\/+|\/+$/g, '')}/`;
}

/**
 * The same address, without the domain.
 *
 * WHY BOTH EXIST, AND WHICH BELONGS WHERE. Edwin found this on 18 October,
 * the morning after the first real deploy: every link inside an article
 * went to a 404.
 *
 *   He typed      appliancerepaircedarpark.com
 *   Cloudflare    appliancerepaircedarpark-com-bx6.pages.dev
 *
 * Both are correct and they are not the same place. postUrl() builds from
 * the domain on the BlogSite, so a site served anywhere else — a pages.dev
 * address, a staging deploy, a preview — has every one of its internal
 * links pointing at a host that is not serving it.
 *
 * A relative href has no such opinion. `/some-article/` resolves against
 * whatever address the reader is on, so the ring of links works on
 * pages.dev today and on the real domain the moment it is attached, with
 * no re-render in between.
 *
 * THIS IS NOT A LICENCE TO MAKE EVERYTHING RELATIVE. The canonical,
 * og:url, the sitemap and the RSS feed all have to name the one address
 * the article should be known by, because that is their entire job — a
 * relative canonical is not a canonical. Those keep postUrl().
 *
 * So: absolute for anything that TELLS A MACHINE where the page lives,
 * relative for anything a READER CLICKS.
 */
function postPath(slug, isHome = false) {
  if (isHome) return '/';

  return `/${String(slug || '').replace(/^\/+|\/+$/g, '')}/`;
}

/**
 * The body, escaped and then linked.
 *
 * Returns the html and whatever applyLinks could not place, so the caller
 * can log a writer that dropped a token. NOT fatal: a post missing its money
 * link is worth less, and refusing to publish it wastes a credit already
 * spent — the same call the plugin makes.
 */
function renderSections(sections, targets) {
  let html = '';

  for (const section of (sections || [])) {
    if (section && section.heading) {
      html += `<h2>${esc(section.heading)}</h2>\n`;
    }
    for (const paragraph of ((section && section.paragraphs) || [])) {
      if (!String(paragraph || '').trim()) continue;
      html += `<p>${esc(paragraph)}</p>\n`;
    }
    html += '\n';
  }

  return applyLinks(html, targets || {});
}

/**
 * @param {object} opts
 * @param {object} opts.post     a BlogPost document (or a plain object)
 * @param {object} opts.blog     the BlogSite — siteUrl and business.name
 * @param {object} opts.targets  resolved by interlinks.js: { money, prev, next }
 * @param {string} opts.publishAt  ISO date for this article
 * @param {boolean} opts.isHome  this is the article served at `/`
 *
 * @returns {{ html: string, missing: string[], url: string }}
 */
function postPage({ post = {}, blog = {}, targets = {}, publishAt = null, isHome = false } = {}) {
  const blogName = (blog.business && blog.business.name) || '';
  const title = post.title || '';
  const description = post.metaDescription || '';
  const url = postUrl(blog, post.slug, isHome);
  const date = formatDate(publishAt || post.publishAt);

  const body = renderSections(post.sections, targets);

  /* THE TITLE TAG CARRIES THE BLOG NAME, the <h1> does not.
   *
   * The h1 is the article's headline and nothing else — a heading that
   * repeats the site name on every page tells a reader nothing and dilutes
   * the one phrase the page is about. The tab and the search result are
   * where the blog's name earns its place. */
  const pageTitle = blogName ? `${title} — ${blogName}` : title;

  /* JSON-LD, and only the fields we actually know.
   *
   * No author, no publisher logo, no image: inventing them to satisfy a
   * validator is how structured data stops describing the page. An absent
   * field is honest; a fabricated one is a claim. */
  const schema = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: title,
    ...(description ? { description } : {}),
    ...(date ? { datePublished: date.iso } : {}),
    mainEntityOfPage: url,
  };

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pageTitle)}</title>
${description ? `<meta name="description" content="${esc(description)}">\n` : ''}<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
${description ? `<meta property="og:description" content="${esc(description)}">\n` : ''}<meta property="og:url" content="${esc(url)}">
<link rel="stylesheet" href="/assets/blog.css">
<link rel="alternate" type="application/rss+xml" title="${esc(blogName)}" href="/rss.xml">
<script type="application/ld+json">${jsonForScript(schema)}</script>
</head>
<body class="${CLASSES.body}">
<header class="${CLASSES.masthead}">
${isHome ? `<span class="${CLASSES.home}">${esc(blogName)}</span>` : `<a class="${CLASSES.home}" href="/">${esc(blogName)}</a>`}
</header>
<main>
<article>
<h1>${esc(title)}</h1>
${date ? `<p class="${CLASSES.date}"><time datetime="${esc(date.iso)}">${esc(date.human)}</time></p>\n` : ''}<div class="${CLASSES.post}">
${body.html}</div>
</article>
</main>
<footer class="${CLASSES.footer}">
${isHome ? esc(blogName) : `<a href="/">${esc(blogName)}</a>`}
</footer>
</body>
</html>
`;

  return { html, missing: body.missing, url };
}

module.exports = { postPage, postUrl, postPath, formatDate, renderSections };
