// utils/blog/render/feeds.js
//
// sitemap.xml, rss.xml and robots.txt.
//
// PURE, like the rest of the renderer. The deploy plan goes in, three
// strings come out. No clock — and that matters more here than anywhere
// else in this folder, because every one of these formats has a
// conventional "when was this generated" field and all three are left out
// on purpose. See *No build dates* below.
//
// XML IS NOT HTML, AND THE ESCAPING IS NOT THE SAME
//
// The HTML escaper in postPage.js turns `'` into `&#39;`, which is valid
// HTML and NOT valid XML — `&#39;` is fine, but `&apos;` is the XML name
// and HTML's named entities mostly are not XML's. The only five entities
// XML defines are &amp; &lt; &gt; &quot; &apos;, so this file has its own
// escaper rather than importing one that happens to look similar.
//
// A feed that fails to parse is worse than no feed: a reader shows an
// error, and Search Console reports the sitemap as broken rather than
// empty.
//
// NO BUILD DATES, AND IT IS DELIBERATE
//
// RSS has `lastBuildDate`, sitemaps are often written with a generation
// stamp, and both would change on every deploy even when not one article
// had. Cloudflare Direct Upload hashes each file and uploads only what it
// does not already have, so a timestamp here means three files re-upload
// every single run, for ever, to say nothing new.
//
// `pubDate` and `lastmod` are kept, because those describe the ARTICLE and
// come off the article. They change when it changes, which is the point.

'use strict';

/**
 * The five entities XML actually defines.
 *
 * `&` FIRST, always. Escape it after the others and the `&` in `&lt;` gets
 * escaped a second time into `&amp;lt;`, which renders as the literal text
 * `&lt;` — the classic double-escape, and it looks like a content bug
 * rather than an escaping one.
 */
function xml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/* RFC 822 day and month names, written out.
 *
 * The spec requires these exact English abbreviations, so toUTCString()
 * would do — but only because Node's is English regardless of locale, and
 * that is a property of the runtime rather than a promise of the API. The
 * same reasoning as the month names in postPage.js: a rendered file has to
 * be a pure function of its input, not of the host.
 *
 * AN EQUIVALENT MUTANT LIVES HERE, and it is recorded rather than worked
 * around. Replacing the whole of rfc822() with `d.toUTCString()` produces
 * byte-identical output on Node today, so no test can kill it and none
 * should be contrived to. The reason for the longhand is the sentence
 * above — it is about what the API guarantees, not about what it
 * currently returns. */
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function two(n) {
  return String(n).padStart(2, '0');
}

/** RFC 822, which is what RSS wants, in GMT. */
function rfc822(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(d.getTime())) return null;

  return `${DAYS[d.getUTCDay()]}, ${two(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} `
    + `${d.getUTCFullYear()} ${two(d.getUTCHours())}:${two(d.getUTCMinutes())}:`
    + `${two(d.getUTCSeconds())} GMT`;
}

/** W3C date, which is what a sitemap wants. */
function isoDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function origin(blog) {
  return `https://${String((blog && blog.siteUrl) || '').replace(/\/+$/, '')}`;
}

/**
 * Newest first — the order a feed reader and a person both expect.
 *
 * A COPY, not a sort in place. renderPlan() returns its pages in slot
 * order and the deploy writes them in that order; sorting the caller's
 * array would quietly reorder the file list too.
 */
function newestFirst(pages) {
  return pages.slice().sort((a, b) => {
    const at = new Date((a.slot && a.slot.publishAt) || 0).getTime();
    const bt = new Date((b.slot && b.slot.publishAt) || 0).getTime();
    if (bt !== at) return bt - at;

    // A tie has to break on something stable, or two deploys of the same
    // articles produce different files.
    return b.index - a.index;
  });
}

/**
 * @param {object}   opts
 * @param {Array}    opts.pages  renderPlan() output — only what is live
 * @param {object}   opts.blog
 */
function sitemapXml({ pages = [], blog = {} } = {}) {
  const entries = newestFirst(pages).map(page => {
    const lastmod = isoDate(page.slot && page.slot.publishAt);

    return `  <url>\n    <loc>${xml(page.url)}</loc>\n`
      + (lastmod ? `    <lastmod>${lastmod}</lastmod>\n` : '')
      + '  </url>';
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.join('\n')}
</urlset>
`;
}

/**
 * The feed.
 *
 * DESCRIPTIONS, NOT FULL ARTICLES. A full-text feed is a second copy of
 * every article at a second URL, and the meta description was written to
 * be the one-line summary. It also keeps the file small enough not to
 * matter in a deploy.
 */
function rssXml({ pages = [], blog = {} } = {}) {
  const site = origin(blog);
  const name = (blog.business && blog.business.name) || '';

  const items = newestFirst(pages).map(page => {
    const post = page.post || {};
    const date = rfc822(page.slot && page.slot.publishAt);

    return '    <item>\n'
      + `      <title>${xml(post.title || '')}</title>\n`
      + `      <link>${xml(page.url)}</link>\n`
      /* THE GUID IS THE URL, AND isPermaLink SAYS SO. A reader that sees
       * a guid change treats the item as new and shows it again; tying it
       * to the address means it only changes when the article genuinely
       * moves. */
      + `      <guid isPermaLink="true">${xml(page.url)}</guid>\n`
      + (post.metaDescription ? `      <description>${xml(post.metaDescription)}</description>\n` : '')
      + (date ? `      <pubDate>${date}</pubDate>\n` : '')
      + '    </item>';
  });

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(name)}</title>
    <link>${xml(site)}/</link>
    <description>${xml(name)}</description>
    <language>en</language>
    <atom:link href="${xml(site)}/rss.xml" rel="self" type="application/rss+xml"/>
${items.join('\n')}
  </channel>
</rss>
`;
}

/**
 * robots.txt.
 *
 * EVERYTHING IS ALLOWED. There is nothing on a static blog that is not
 * meant to be read — it is a blog. The one thing this file is actually for
 * is naming the sitemap, which is the only way a crawler finds it without
 * being told in Search Console.
 *
 * `_data/blog.json` IS NOT DISALLOWED, and that is a decision rather than
 * an oversight. A Disallow line is a public index of what you would rather
 * people did not look at, so it advertises the file to exactly the person
 * who would go looking. The backup is deliberately public — see
 * blogJson.js — and if that trade ever changes the answer is a Pages
 * Function in front of it, not a line here.
 */
function robotsTxt({ blog = {} } = {}) {
  return `User-agent: *
Allow: /

Sitemap: ${origin(blog)}/sitemap.xml
`;
}

/**
 * All three, keyed by the path they are served at.
 *
 * The same shape the deploy wants: a map of path to contents, so adding a
 * file is one entry here rather than a change at the call site too.
 */
function feedFiles({ pages = [], blog = {} } = {}) {
  return {
    'sitemap.xml': sitemapXml({ pages, blog }),
    'rss.xml': rssXml({ pages, blog }),
    'robots.txt': robotsTxt({ blog }),
  };
}

module.exports = { feedFiles, sitemapXml, rssXml, robotsTxt, xml, rfc822, isoDate, newestFirst };
