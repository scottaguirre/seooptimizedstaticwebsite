// utils/blog/render/blogJson.js
//
// The articles themselves, shipped alongside the pages.
//
// WHY THIS FILE EXISTS AT ALL — and the reason is not the one it started with
//
// The original plan had `_data/blog.json` moving article prose OUT of Mongo:
// the database would keep an index, and an edit would fetch this file back
// from Cloudflare, merge, re-render. That was a storage argument.
//
// ON 17 OCTOBER THE STORAGE ARGUMENT DIED, measured rather than argued. The
// live database holds 12.5 MB of a 512 MB tier — 2.4% — and 604 articles
// weigh 7.7 KB each, not the 12 KB the plan assumed. There is room for about
// 68,000 of them. Nothing needs moving anywhere.
//
// What survived is a different and better reason. A WordPress article exists
// twice: in Mongo and in `wp_posts`, which is why it can be deleted here
// after fifteen days. A CLOUDFLARE ARTICLE EXISTS ONCE. Cloudflare stores a
// rendered page, not the article — there is no database over there, and the
// Pages API has no endpoint that returns a deployed file's contents. Lose
// Mongo and the blog cannot be rebuilt, only scraped back out of its own
// HTML, which this codebase has already done once and already regretted.
//
// So this file is a BACKUP, and that changes the design in one important way:
//
//   it is written, and never read back.
//
// No fetch, no merge, no staleness, no "what if the file is older than the
// database". Mongo stays the source of truth. The copy on Cloudflare exists
// for the day Mongo is not there.
//
// WHAT IS PUBLIC, AND THE RULE THAT KEEPS IT SAFE
//
// Pages serves this at a guessable URL. Anyone can read it.
//
// The article text is public anyway — it is the blog. What must never appear
// is anything else on the BlogSite document, which carries `secret`, the
// HMAC signing key, and `licenceKeyHash`. So nothing here copies a document.
// Every field is named, one at a time, and a field nobody named cannot
// escape. A spread of the site document would have worked perfectly and
// published the signing key.
//
// THE LINK PLAN IS IN HERE, DELIBERATELY. `targets` says which article points
// at which, and the paragraphs still carry their {{money}} tokens. That is
// the SEO strategy, readable by anyone who finds the path. It is included
// because without it the backup cannot rebuild the interlinks, which is most
// of what the blog is for — a backup that restores the prose and loses the
// structure is half a backup. Edwin's call if that trade changes.
//
// NO TIMESTAMP, AND THAT IS NOT AN OVERSIGHT
//
// Cloudflare Direct Upload hashes every file and asks which ones it is
// missing. A `generatedAt` field would make this file different on every
// deploy even when not one word had changed, so it would upload every time
// and the hashing would buy nothing. The output is a pure function of the
// content: same articles in, byte-identical file out. The deployment itself
// is what carries the date.

'use strict';

/**
 * Bumped when the SHAPE changes, not when the content does.
 *
 * Anything reading an old backup needs to know which shape it is holding,
 * and the only moment that information exists is now.
 */
const SCHEMA_VERSION = 1;

/** Trim to a string, whatever arrived. */
function text(value) {
  return 'string' === typeof value ? value : (null === value || undefined === value ? '' : String(value));
}

/**
 * One section.
 *
 * `heading` IS NULLABLE AND THE NULL MEANS SOMETHING. The writer's prompt
 * says the opening section has no heading, and the model file says an empty
 * string arriving instead is a signal worth being able to see. Collapsing
 * both to '' here would erase that distinction in the only copy that
 * survives a database loss.
 */
function section(raw) {
  const paragraphs = Array.isArray(raw && raw.paragraphs)
    ? raw.paragraphs.filter(p => null !== p && undefined !== p).map(text)
    : [];

  const heading = raw && null !== raw.heading && undefined !== raw.heading
    ? text(raw.heading)
    : null;

  return { heading, paragraphs };
}

/**
 * One article, field by field.
 *
 * NAMED RATHER THAN SPREAD. See the note at the top: a spread would publish
 * `quality` (an internal report), `pending`, `deletableAt`, the campaign and
 * job ids, and would keep publishing whatever anybody adds to the model next
 * year without anyone deciding to.
 */
function post(raw) {
  const doc = raw || {};

  return {
    id: text(doc._id || doc.id),
    slug: text(doc.slug),
    title: text(doc.title),
    metaDescription: text(doc.metaDescription),
    words: Number(doc.words) || 0,
    sections: Array.isArray(doc.sections) ? doc.sections.map(section) : [],

    /* The link plan. Mixed on the model — the values are { url } or
     * { pending_id } depending on whether the target was live when the batch
     * was written — so it is passed through as it is rather than reshaped
     * into something a rebuild would have to translate back. */
    targets: doc.targets && 'object' === typeof doc.targets ? doc.targets : {},
  };
}

/**
 * Sort key: the order a rebuild should see them in.
 *
 * DETERMINISTIC OR THE HASHING IS POINTLESS. Mongo returns documents in no
 * guaranteed order without a sort, so without this the same unchanged blog
 * would produce a different file on every deploy and upload every time.
 *
 * createdAt first because that is publication order; slotIndex to break a
 * tie inside one batch, where every post was written in the same second; the
 * id last, which is unique, so the comparison can never fall through to
 * "equal" and leave the order up to the engine.
 */
function order(a, b) {
  const at = new Date(a.createdAt || 0).getTime() || 0;
  const bt = new Date(b.createdAt || 0).getTime() || 0;
  if (at !== bt) return at - bt;

  const ai = Number(a.slotIndex) || 0;
  const bi = Number(b.slotIndex) || 0;
  if (ai !== bi) return ai - bi;

  return text(a._id || a.id) < text(b._id || b.id) ? -1 : 1;
}

/**
 * Build the payload.
 *
 * @param {object} opts
 * @param {object} opts.site    a BlogSite document or plain object
 * @param {Array}  opts.posts   that site's BlogPost documents
 * @returns {object} ready for JSON.stringify
 *
 * TAKES DOCUMENTS, TOUCHES NO DATABASE. The caller does the query; this does
 * the shaping. That is what makes every rule above testable without a Mongo
 * connection and without a Cloudflare account.
 */
function buildBlogJson({ site, posts } = {}) {
  const blog = site || {};

  return {
    version: SCHEMA_VERSION,

    /* THREE FIELDS, NAMED. `secret` and `licenceKeyHash` live on this same
     * document; this is a public file. */
    blog: {
      id: text(blog._id || blog.id),
      name: text((blog.business && blog.business.name) || blog.name),
      domain: text(blog.siteUrl || blog.domain),
    },

    posts: (Array.isArray(posts) ? posts.slice() : []).sort(order).map(post),
  };
}

/**
 * The file, as it is uploaded.
 *
 * @returns {{path: string, contents: string}}
 *
 * Two spaces of indentation rather than none. It costs perhaps 15% on a file
 * nobody pays for — Cloudflare bandwidth is free and this is not on the
 * reading path — and it buys a backup somebody can open and understand in
 * the situation it exists for, which is the one where everything else is on
 * fire.
 */
function blogJsonFile(opts) {
  return {
    path: '_data/blog.json',
    contents: JSON.stringify(buildBlogJson(opts), null, 2),
  };
}

module.exports = { buildBlogJson, blogJsonFile, SCHEMA_VERSION };
