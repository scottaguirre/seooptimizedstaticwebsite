// utils/blog/render/publishBlog.js
//
// A blog in the database -> a blog on the internet.
//
// THE ONE PIECE THAT KNOWS ABOUT ALL THE OTHERS. Everything under
// render/ is pure and knows nothing of Mongo or Cloudflare:
//
//   interlinks.js  which articles are live today, and what they link to
//   postPage.js    one article -> one HTML page
//   feeds.js       sitemap.xml, rss.xml, robots.txt
//   theme.js       the stylesheet, read from the plugin's own file
//   blogJson.js    the backup that ships with every deploy
//
// This reads the documents, calls those five, and hands the result to
// cloudflare/deploy.js. It is the seam, and it is deliberately boring:
// every decision worth arguing about was made in one of the files above.
//
// WHY THE WHOLE SITE, EVERY TIME
//
// Not a diff. A Pages deployment IS the site — whatever is not in it is
// gone — so a deploy of "just the new article" deletes the other eleven.
// Direct Upload hashes each file and skips the ones it already has, which
// is why the renderer is so careful to be deterministic: an unchanged
// article produces byte-identical HTML and costs nothing to re-send.
//
// NOTHING IS WRITTEN BACK HERE EXCEPT THE DEPLOY'S OWN RECORD. Marking
// slots `published` belongs to whoever called this and knows why — a
// scheduled run and somebody pressing a button want different things
// logged, and a renderer that quietly advanced campaign state would make
// a dry run impossible.

'use strict';

const BlogCampaign = require('../../../models/BlogCampaign');
const BlogPost = require('../../../models/BlogPost');

const { renderPlan } = require('./interlinks');
const { postPage } = require('./postPage');
const { feedFiles } = require('./feeds');
const { CSS, CSS_PATH } = require('./theme');
const { blogJsonFile } = require('./blogJson');
const { deployBlog, projectNameFor } = require('../cloudflare/deploy');
const { log } = require('../../logger');

/**
 * Where a page's HTML goes.
 *
 * `index.html` INSIDE THE SLUG'S OWN DIRECTORY. Cloudflare Pages serves
 * /my-post/ from my-post/index.html, which is the URL postUrl() builds and
 * the canonical the page carries. A file at my-post.html would be served
 * at /my-post.html and every link on the site would point somewhere else.
 */
function fileFor(page) {
  return page.isHome ? 'index.html' : `${page.post.slug}/index.html`;
}

/**
 * Everything this blog should be, as files.
 *
 * Separated from the deploy so a caller can look at what WOULD go up
 * without sending it — which is the whole of a dry run, and is how the
 * first real deploy was checked by eye.
 *
 * @returns {{ files: object, pages: Array, missing: Array }}
 */
function renderSite({ blog, campaigns, posts, now = new Date(), includeScheduled = false }) {
  /* CARRIED, NOT RE-DECIDED. interlinks.js owns what belongs on the site;
   * this file only passes the answer along. `now` stays the real now, so
   * every page is still dated and rendered as of today. */
  const pages = renderPlan({ blog, campaigns, posts, now, includeScheduled });

  const files = {};
  const missing = [];

  for (const page of pages) {
    const rendered = postPage({
      blog,
      post: page.post,
      targets: page.targets,
      isHome: page.isHome,
      publishAt: page.slot.publishAt,
    });

    files[fileFor(page)] = rendered.html;

    /* A WRITER THAT DROPPED A LINK TOKEN IS REPORTED, NOT REFUSED. The post
     * is worth less without its money link; refusing to publish it wastes
     * a credit already spent. The same call the plugin makes. */
    if (rendered.missing.length) {
      missing.push({ slug: page.post.slug, tokens: rendered.missing });
    }
  }

  Object.assign(files, feedFiles({ pages, blog }));
  files[CSS_PATH] = CSS;

  /* THE BACKUP SHIPS WITH THE SITE, and it carries every live article's
   * prose plus the link plan. See blogJson.js: it is written and never
   * read back, so Mongo stays the source of truth — but a blog can be
   * rebuilt from it if Mongo is ever not there. */
  const backup = blogJsonFile({ site: blog, posts: pages.map(p => p.post) });
  files[backup.path] = backup.contents;

  return { files, pages, missing };
}

/**
 * Render a blog and put it on Cloudflare.
 *
 * @param {object}   opts
 * @param {object}   opts.blog
 * @param {Date}     opts.now
 * @param {string}   opts.requestId
 * @param {boolean}  opts.dryRun   render and report, send nothing
 * @param {boolean}  opts.includeScheduled  put future-dated articles up too
 * @param {function} opts.deploy   injected for tests
 *
 * @returns {{ ok, url?, project?, files, pages, missing, error? }}
 */
async function publishBlog({
  blog, now = new Date(), requestId, dryRun = false, includeScheduled = false,
  deploy = deployBlog,
} = {}) {
  if (!blog || 'cloudflare' !== blog.target) {
    return { ok: false, error: 'This is not a Cloudflare blog.', files: 0, pages: [] };
  }

  /* EVERY CAMPAIGN AND EVERY POST OF THIS BLOG. Not the due ones — what is
   * live today is interlinks.js's decision, and it needs the whole set to
   * make it. Filtering here would mean two places deciding what belongs on
   * the site, which is how they start disagreeing. */
  const campaigns = await BlogCampaign.find({ site: blog._id }).lean();
  const posts = await BlogPost.find({ site: blog._id }).lean();

  const { files, pages, missing } = renderSite({ blog, campaigns, posts, now, includeScheduled });

  if (!pages.length) {
    /* TWO REASONS, TWO SENTENCES. With the override on, dates are not why
     * there is nothing — so saying "not due yet" would send somebody to
     * look at a schedule that is not the problem. What is left is a
     * campaign nobody has approved, or one whose writing failed. */
    return {
      ok: false,
      error: includeScheduled
        ? 'There are no written articles to publish. Approve a campaign first.'
        : 'Nothing is due to be published yet.',
      files: 0, pages, missing,
    };
  }

  if (missing.length) {
    log.info('blog.publish.missingLinks', {
      requestId,
      siteId: String(blog._id),
      posts: missing.map(m => m.slug),
    });
  }

  if (dryRun) {
    return { ok: true, dryRun: true, files: Object.keys(files).length, pages, missing };
  }

  const result = await deploy({ blog, files, requestId });

  if (!result.ok) {
    return { ok: false, error: result.error, output: result.output, files: 0, pages, missing };
  }

  return {
    ok: true,
    url: result.url,
    project: result.project,
    files: result.files,
    pages,
    missing,

    /* CARRIED UP, NOT LOGGED AND FORGOTTEN. On a blog's first deploy this
     * says whether the Pages project had to be created and whether the
     * domain attached. The domain failing is the one that matters: the
     * deploy succeeds either way, so without this the blog goes live at a
     * pages.dev address while every link and canonical on it names a
     * domain that points nowhere — and nothing on screen would say so.
     *
     * `undefined` on every later deploy, because the setup does not run
     * again. The screen tests for it rather than assuming. */
    setup: result.setup || null,
  };
}

module.exports = { publishBlog, renderSite, fileFor, projectNameFor };
