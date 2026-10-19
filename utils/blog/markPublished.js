// utils/blog/markPublished.js
//
// What went live, written back to the slots that went live.
//
// WHY THIS IS NOT IN publishBlog.js
//
// Because publishBlog.js says so, and it is right:
//
//   "NOTHING IS WRITTEN BACK HERE EXCEPT THE DEPLOY'S OWN RECORD. Marking
//    slots `published` belongs to whoever called this and knows why — a
//    scheduled run and somebody pressing a button want different things
//    logged, and a renderer that quietly advanced campaign state would make
//    a dry run impossible."
//
// So the renderer stays pure and this is a separate step the caller takes
// once the deploy has actually succeeded. It is a module rather than ten
// lines in the route because the scheduler is about to be the second
// caller, and the two must not drift.
//
// WHAT 'published' MEANS ON A STATIC BLOG, WHICH IS NOT WHAT IT MEANS ON WORDPRESS
//
// WordPress runs pending -> generating -> ready -> scheduled -> published,
// and the step that matters is `scheduled`: the post EXISTS, with an id and
// a URL, but the public cannot read it yet. That distinction is why
// markSlotPublished() was deleted from BlogCampaign.js years of commits ago
// — skipping straight to published lost it.
//
// A Cloudflare blog has no such state. A Pages deployment IS the site: a
// file is in it and readable, or it is not in it at all. There is nothing
// for `scheduled` to describe, so the transition here really is
// ready -> published, and that is not the old mistake wearing a new hat.
//
// Until this file existed, a Cloudflare slot sat at `ready` forever. The
// articles were on the internet and the app had no idea which.

'use strict';

const BlogCampaign = require('../../models/BlogCampaign');
const { log } = require('../logger');

/**
 * Record that these pages are now on the internet.
 *
 * @param {object}   opts
 * @param {Array}    opts.pages      what renderSite/publishBlog actually deployed
 * @param {Date}     opts.now
 * @param {string}   opts.requestId
 * @param {object}   opts.Campaign   injected for tests
 *
 * @returns {Promise<{ marked: number }>}
 */
async function markPublished({ pages, now = new Date(), requestId, Campaign = BlogCampaign } = {}) {
  /* ONE EMPTY CHECK, NOT TWO. There was an `if (!live.length) return` here
   * as well, and mutation testing showed it was dead: an empty list makes
   * an empty `ops`, and the guard below already catches that. Two guards
   * doing one job means either can be deleted without a test noticing,
   * which is how a line stops being checked — the same finding as the
   * double .filter(Boolean) in parseTopics. */
  const live = Array.isArray(pages) ? pages : [];

  const ops = [];

  for (const page of live) {
    const campaignId = page && page.campaign && page.campaign._id;
    const index = page && page.index;

    /* A page with no campaign or no index cannot address a slot. Skipped
     * rather than guessed at: an $elemMatch on undefined would match the
     * FIRST slot of the campaign and mark the wrong article live. */
    if (!campaignId || !Number.isInteger(index)) continue;

    const set = {
      'slots.$.status': 'published',
      'slots.$.publishedAt': now,
      'slots.$.publishedUrl': page.url || '',
    };

    /* THE DATE IS PULLED BACK WHEN IT IS IN THE FUTURE — Edwin's call.
     *
     * "Publish everything now" ignores the schedule and puts every written
     * article up, including ones dated weeks out. Left alone, the article
     * is live today carrying a date that has not happened: the reader sees
     * next month on a page they are reading now, the sitemap says so, and
     * the schedule disagrees with the site.
     *
     * Only the ones that actually went up are touched. A slot still
     * waiting keeps the date it was planned for, so pressing the button
     * does not flatten the rest of the campaign onto today. */
    /* NO EXPLICIT NaN CHECK, AND THAT IS NOT AN OVERSIGHT. An unreadable
     * date gives NaN, and NaN > anything is false, so a junk date falls
     * out of this branch on its own and the slot keeps whatever it had.
     * A `!Number.isNaN(...)` here was tried and mutation testing showed it
     * changed no outcome — a guard nothing can break is a guard nothing is
     * checking. The behaviour is pinned by the test instead, which is
     * where it belongs. */
    const at = page.slot && page.slot.publishAt ? new Date(page.slot.publishAt) : null;

    if (at && at.getTime() > now.getTime()) {
      set['slots.$.publishAt'] = now;
    }

    ops.push({
      updateOne: {
        /* ALREADY-PUBLISHED SLOTS ARE NOT MATCHED, and that is what makes a
         * re-deploy free. Every deploy sends the whole site, so without
         * this filter publishedAt would be rewritten to today on every
         * press and the field would mean "last deploy" instead of "when
         * this article went live" — which is the only thing anyone would
         * ever want it for. */
        filter: {
          _id: campaignId,
          slots: { $elemMatch: { index, status: { $ne: 'published' } } },
        },
        update: { $set: set },
      },
    });
  }

  if (!ops.length) return { marked: 0 };

  const result = await Campaign.bulkWrite(ops, { ordered: false });

  /* modifiedCount, NOT ops.length. On the second deploy of an unchanged
   * blog every filter misses and nothing is modified, which is correct and
   * is worth being able to see in the log rather than inferring. */
  const marked = (result && result.modifiedCount) || 0;

  if (marked) {
    log.info('blog.publish.slotsMarked', {
      requestId,
      marked,
      of: ops.length,
    });
  }

  return { marked };
}

module.exports = { markPublished };
