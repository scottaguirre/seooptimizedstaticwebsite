// utils/blog/publishDue.js
//
// Static blogs publish themselves.
//
// WHAT WAS WRONG UNTIL NOW
//
// A Cloudflare blog only ever went live when somebody pressed a button. The
// schedule was real — the dates were planned, stored and rendered — but
// nothing acted on them, so "every Monday at 09:00" meant "whenever Edwin
// next opens the screen". Twelve weeks of articles sat written and paid for
// behind a button nobody had told the customer to press.
//
// WHY IT IS NOT IN blogScheduler.js
//
// That file is the WordPress doorbell and says so in its own header:
//
//   "It does not write and it does not publish. Both happen on the far side
//    of the ping ... This end only ever decides WHEN to knock."
//
// Its whole ping path is a whitelist that deliberately EXCLUDES Cloudflare
// blogs, because they have no plugin, no secret and no REST route to knock
// on. Deploying from inside it would contradict the one sentence the file is
// built around.
//
// WHY IT RIDES THAT LOOP ANYWAY
//
// Same reason sweepArticles() does, and the comment there is the warning:
// utils/cleanupScheduler.js exists, exports a start function, and NOTHING IN
// THE APP EVER CALLED IT. It has never run. A scheduler nobody wired up looks
// exactly like a scheduler with nothing to do.
//
// So this is a function the existing, proven, already-started tick calls —
// not a second timer somebody has to remember.
//
// WHY A GAP WHEN THE QUERY ALREADY SELF-LIMITS
//
// A successful deploy marks its slots published, so they stop matching and
// the blog goes quiet on its own. The gap is for the UNSUCCESSFUL one:
// without it, a blog whose deploy fails is redeployed every sixty seconds
// for ever. It is a backoff, not a cadence.
//
// WHY A CAP PER RUN
//
// The tick holds a `ticking` flag so two ticks cannot overlap. A deploy takes
// seconds to minutes, so twelve of them in one pass would hold that flag shut
// and stall the WordPress pings behind it. Three at a time keeps the loop
// moving; the rest go on the next pass, and nothing is due more urgently than
// that.

'use strict';

const BlogSite = require('../../models/BlogSite');
const BlogCampaign = require('../../models/BlogCampaign');

const { publishBlog } = require('./render/publishBlog');
const { markPublished } = require('./markPublished');
const { log } = require('../logger');

/** How long to leave a blog alone after trying to deploy it. */
const DUE_GAP_MS = Number(process.env.BLOG_DUE_GAP_MS) || 5 * 60 * 1000;

/** How many blogs one pass may deploy, so the tick is never held open long. */
const MAX_PER_RUN = Number(process.env.BLOG_DUE_MAX_PER_RUN) || 3;

/** Last attempt per blog id. In memory on purpose — see publishDue(). */
const lastTriedAt = new Map();

/**
 * Which static blogs have an article whose day has come.
 *
 * A slot counts when it is WRITTEN and its date has PASSED and it is not
 * already live:
 *
 *   status 'ready'   written and waiting. 'published' is already on the
 *                    site; 'pending' and 'generating' have no article yet;
 *                    'failed' has none and is not getting one.
 *   publishAt <= now the whole point.
 *
 * $elemMatch because both conditions must hold for the SAME slot. Without it
 * a campaign with any ready slot and any past-dated slot matches, which on a
 * twelve-week campaign is every campaign from week two onward. The same trap
 * findWork() documents one file over.
 *
 * @returns {Promise<string[]>} site ids, deduplicated
 */
async function blogsWithWorkDue(now = new Date(), Campaign = BlogCampaign) {
  const campaigns = await Campaign.find({
    slots: { $elemMatch: { status: 'ready', publishAt: { $lte: now } } },
  }).select('site').lean();

  const ids = new Set();
  for (const campaign of campaigns) {
    if (campaign && campaign.site) ids.add(String(campaign.site));
  }

  return [...ids];
}

/**
 * Deploy every static blog with something due, up to the cap.
 *
 * @param {object} opts
 * @param {Date}   opts.now
 * @param {object} opts.Site, opts.Campaign, opts.publish, opts.mark  injected for tests
 *
 * @returns {Promise<{ deployed: number, failed: number, considered: number }>}
 */
async function publishDue({
  now = new Date(),
  Site = BlogSite,
  Campaign = BlogCampaign,
  publish = publishBlog,
  mark = markPublished,
} = {}) {
  const withWork = await blogsWithWorkDue(now, Campaign);
  if (!withWork.length) return { deployed: 0, failed: 0, considered: 0 };

  /* CLOUDFLARE ONLY, AND SPELLED EXACTLY.
   *
   * The inverse of the whitelist in blogScheduler's ping query, and safe to
   * write as an equality for the reason that one could not: `target` defaults
   * to 'wordpress', so a row predating the field has no `target` key and is a
   * WordPress site. There is no such thing as a legacy Cloudflare blog — the
   * field existed before the product did. */
  const blogs = await Site.find({
    _id: { $in: withWork },
    target: 'cloudflare',
    status: 'active',
  });

  let deployed = 0;
  let failed = 0;
  let considered = 0;

  for (const blog of blogs) {
    if (deployed + failed >= MAX_PER_RUN) break;

    const key = String(blog._id);
    const tried = lastTriedAt.get(key) || 0;

    /* THE BACKOFF. A blog that deployed successfully stops matching the query
     * above, so this only ever holds back one that failed — or one whose
     * slots did not all go live, which is the same thing from here. */
    if (now.getTime() - tried < DUE_GAP_MS) continue;

    considered += 1;
    lastTriedAt.set(key, now.getTime());

    try {
      /* NOT includeScheduled. The whole job is "publish what is DUE"; the
       * override exists for a person who has decided to ignore the schedule,
       * and a timer deciding that on its own would put the entire campaign up
       * on the first tick. dryRun is likewise absent and must stay absent. */
      const result = await publish({ blog, now, requestId: `due-${key}` });

      if (!result || !result.ok) {
        failed += 1;
        log.error('blog.due.deployFailed',
          new Error((result && result.error) || 'the deploy returned nothing'), {
            siteId: key,
            siteUrl: blog.siteUrl,
          });
        continue;
      }

      /* THE SAME TWO WRITES THE BUTTON DOES, in the same order and through
       * the same module. A second implementation of "what the deploy means"
       * is how the two paths start disagreeing about what is live. */
      await Site.updateOne(
        { _id: blog._id },
        { $set: {
          project: result.project || blog.project || '',
          lastDeployAt: new Date(),
          lastDeployUrl: result.url || '',
        } }
      );

      const { marked } = await mark({ pages: result.pages, now, requestId: `due-${key}` });

      deployed += 1;

      log.info('blog.due.deployed', {
        siteId: key,
        siteUrl: blog.siteUrl,
        pages: result.pages.length,
        marked,
      });

    } catch (err) {
      /* ONE BLOG'S FAILURE IS ONE BLOG'S FAILURE. Letting it out would abandon
       * every blog after it in the list and, because the tick catches at the
       * top, would silently skip the WordPress pings too. */
      failed += 1;
      log.error('blog.due.threw', err, { siteId: key, siteUrl: blog.siteUrl });
    }
  }

  /* LOGGED EVEN WHEN NOTHING HAPPENED, which is the lesson cleanupScheduler
   * taught the hard way: "0 deployed" in the log is the difference between
   * nothing being due and the job not running at all, and from the outside
   * those look identical. */
  log.info('blog.due.swept', { considered, deployed, failed });

  return { deployed, failed, considered };
}

/** Test seam: the backoff is process memory, so a suite must be able to clear it. */
function resetBackoff() {
  lastTriedAt.clear();
}

module.exports = { publishDue, blogsWithWorkDue, resetBackoff, DUE_GAP_MS, MAX_PER_RUN };
