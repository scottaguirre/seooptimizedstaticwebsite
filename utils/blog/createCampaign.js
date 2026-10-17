// utils/blog/createCampaign.js
//
// Costing a campaign and saving it as a draft.
//
// WHY THIS IS NOT IN THE ROUTE ANY MORE
//
// It was, for its whole life — 200 lines inside POST /api/blog/plan, which
// only a signed request from the WordPress plugin can reach.
//
// The Cloudflare blogs have no WordPress and no plugin. Their campaigns are
// planned from a screen on our own site, by a logged-in user, and that screen
// needs every rule in here: the pillar flag, the topic ceiling, the prior
// anchors, the business refresh, the cannibalisation check, the draft status,
// the quote. The choice was to copy those rules or to move them.
//
// Copying is how two versions of one decision end up disagreeing — the
// mistake this project has paid for more than any other. So they moved, once,
// to a place both callers can reach.
//
// WHAT CHANGED IN THE MOVE: NOTHING THE PLUGIN CAN SEE
//
// The body below is the handler's body, with four names swapped —
// req.site → site, req.body → body, req.id → requestId — and the two ways it
// used to answer replaced by two ways it now returns. No rule was rewritten,
// reordered or "tidied" on the way across. A refactor that also improves
// things is two changes wearing one coat, and when it breaks you cannot tell
// which half did it.
//
// test-plan-contract.js was written FIRST, against the handler untouched, and
// pins the exact ten keys wp-admin reads plus the two things this does that
// leave no mark on the answer — the prior-anchor lookup and the business
// refresh. It passed before the move and has to pass after it.
//
// IT STILL DOES NOT BLOCK ON CREDITS. It reports whether the balance covers
// the campaign and saves the draft either way: planning is free, and someone
// who plans more than they can afford should be able to go and buy credits
// without losing their work. The gate is at /write, where the money is
// actually committed.

'use strict';

const User = require('../../models/User');
const BlogSite = require('../../models/BlogSite');
const BlogCampaign = require('../../models/BlogCampaign');

const { quotePosts } = require('../blogPricing');
const { planForCampaign } = require('./campaignPlan');
const { conflictMessage } = require('./planCampaign');
const { log } = require('../logger');
const { readBusiness, businessChanged, mergeBusiness } = require('./businessShape');

/**
 * Every refusal in here is the customer's fault rather than the server's, so
 * they all carry 400 and a sentence somebody can act on.
 *
 * `extra` is for the conflict case, which sends the list as well as the
 * sentence so wp-admin can highlight the offending topics.
 */
function refuse(error, extra = {}) {
  return Object.assign({ ok: false, status: 400, error }, extra);
}

/**
 * @param {object} opts
 * @param {object} opts.site       the BlogSite this campaign belongs to
 * @param {object} opts.body       the planning request
 * @param {string} opts.requestId  for the log lines
 *
 * @returns {Promise<object>}
 *   { ok: true,  status: 200, campaign, plan, response }  response is the
 *                             exact object /api/blog/plan used to send
 *   { ok: false, status: 400, error, conflicts? }
 *
 * THROWS RATHER THAN SWALLOWING. The route's try/catch stays in the route,
 * where it can turn a failure into a 500 — and the new screen's catch turns
 * the same failure into a page. A function that caught its own errors and
 * returned ok:false for both would make "the customer typed something wrong"
 * and "the database is down" indistinguishable to every caller.
 */
async function createCampaign({ site, body, requestId }) {
    const { targetPage, topics, schedule, linkMode, extendsCampaign, name } = body || {};

    /* A PILLAR CAMPAIGN HAS NO TARGET PAGE, AND IS NOT MISSING ONE.
     *
     * It writes the hub articles a later campaign will point at, so its posts
     * carry only the ring they already had. See the flag on BlogCampaign for
     * why pillars never link down to their children.
     *
     * READ FROM THE BODY AS A FLAG, never inferred from an absent targetPage.
     * A client that forgot to send one is a bug, and treating the absence as
     * intent would turn it into a campaign quietly missing a third of its
     * links — a failure that only surfaces months later, as posts that never
     * fed anything. */
    const isPillar = body.isPillar === true || body.isPillar === 'true';

    if (!isPillar && (!targetPage || !targetPage.url || !targetPage.keyword)) {
      return refuse('A target page with a URL and keyword is required.');
    }

    if (!Array.isArray(topics) || !topics.length) {
      return refuse('At least one topic is required.');
    }

    /* TWO IS THE FLOOR FOR A PILLAR CAMPAIGN, and nothing downstream would
     * have caught one.
     *
     * With no money page and no sibling, a single post has NO outbound links
     * at all — and it passes every check, because every link assertion in
     * qualityCheck.js is conditional on the link having been asked for. An
     * ordinary single-post campaign is fine: it still carries its money link.
     *
     * Refused here as well as in planCampaign() because this is where the
     * customer finds out, with a sentence they can act on, rather than a 500
     * from a thrown Error. */
    if (isPillar && topics.length < 2) {
      return refuse('A pillar campaign needs at least two posts — they link to each other, so a single post would have no links at all.');
    }

    if (topics.length > 52) {
      // A year of weekly posts. Beyond this the ring stops being a ring and
      // the plan is almost certainly a mistake.
      return refuse('A campaign can hold at most 52 posts.');
    }

    /* Anchors already pointing at this page from earlier runs. Passed so the
     * planner does not reuse them: a second campaign repeating the first
     * campaign's phrases adds link volume without adding any variety, which
     * is the thing the anchor mix exists to produce.
     *
     * SKIPPED FOR A PILLAR CAMPAIGN. The query keys on targetPage.url, so with
     * no target page it would match every OTHER pillar campaign on the site —
     * all of which store '' — and feed their empty anchors in as "already
     * used". There are no money anchors to avoid reusing. */
    const priorCampaigns = isPillar ? [] : await BlogCampaign.find({
      site: site._id,
      'targetPage.url': String(targetPage.url),
    }).select('slots.moneyAnchor').lean();

    /* REFRESHED HERE, BEFORE THE ANCHORS ARE CHOSEN.
     *
     * This is the one moment the value is actually used: planForCampaign()
     * builds the branded anchor phrases from it and freezes them into the
     * slots, where they stay for the life of the campaign. Refreshing after
     * planning would be a copy nothing reads.
     *
     * Persisted rather than merely used, so the report and any later plan
     * see the same name, and so a site that renames once does not have to
     * keep re-sending before anything is right. */
    const reportedBusiness = readBusiness(body.business, body.businessFields);

    if (businessChanged(site.business, reportedBusiness)) {
      site.business = mergeBusiness(site.business, reportedBusiness);
      await BlogSite.updateOne({ _id: site._id }, { $set: { business: site.business } });

      log.info('blog.business.updated', {
        requestId: requestId,
        siteId: String(site._id),
        at: 'plan',
      });
    }

    const plan = planForCampaign({
      targetPage,
      topics,
      isPillar,
      business: site.business || {},
      schedule: schedule || {},
      priorCampaigns,
      linkMode: linkMode === 'extend' ? 'extend' : 'standalone',
    });

    if (plan.conflicts && plan.conflicts.length) {
      /* Refused rather than silently adjusted. A post that cannibalises the
       * page it is meant to feed is worse than no post, and the customer is
       * the one who should decide how to reword it.
       *
       * THE SENTENCE NOW NAMES THE CONFLICT THAT ACTUALLY FIRED — 7 October.
       * It read "Some topics would compete with the target page" for all three
       * kinds queryConflicts raises, and only one of them is about the target
       * page. Edwin hit it on a pair of HIS OWN topics overlapping each other,
       * read the sentence, and went to look at the pillar — exactly where it
       * sent him, and the wrong place. The detail was in the panel above
       * saying "duplicate:", so the screen disagreed with itself.
       *
       * THE SENTENCES LIVE WITH THE KINDS, in planCampaign.js, because that is
       * where the kinds are invented. A sentence per kind written here would
       * be a second copy of a decision made there — the mistake this project
       * has paid for more than any other. */
      return refuse(conflictMessage(plan.conflicts), { conflicts: plan.conflicts });
    }

    const campaign = await BlogCampaign.create({
      user: site.user,
      site: site._id,
      name: String(name || '').slice(0, 200) || plan.suggestedName,
      isPillar,

      /* OMITTED, NOT WRITTEN EMPTY. The schema's `required` is now conditional
       * on isPillar, so a sub-document of three empty strings would validate —
       * and then buildLinkPlan() would read a url of '' and hand the writer a
       * money link pointing nowhere. The absence has to stay an absence all
       * the way down. */
      ...(isPillar ? {} : {
        targetPage: {
          url: String(targetPage.url),
          keyword: String(targetPage.keyword),
          intent: String(targetPage.intent || ''),
        },
      }),

      linkMode: plan.linkMode,
      extendsCampaign: plan.linkMode === 'extend' ? extendsCampaign || null : null,
      schedule: plan.schedule,
      slots: plan.slots,

      // A DRAFT, not active. Before write-ahead there was no separate approval
      // step — planning and starting were one act, so this was created active.
      // Now approval is what triggers a large charge, and the two have to be
      // distinct: nothing happens to this campaign until someone says yes.
      status: 'draft',
    });

    const quote = quotePosts(plan.slots.length);
    const user = await User.findById(site.user).lean();
    const available = Number(user?.credits || 0);

    log.info('blog.plan.created', {
      requestId: requestId,
      campaignId: String(campaign._id),
      siteId: String(site._id),
      posts: plan.slots.length,
      estimatedCredits: quote.total,
      affordable: available >= quote.total,
    });

    return { ok: true, status: 200, campaign, plan, response: {
      campaignId: String(campaign._id),
      status: campaign.status,
      slots: campaign.slots.map(s => ({
        index: s.index,
        topic: s.topic,
        targetQuery: s.targetQuery,
        publishAt: s.publishAt,
        status: s.status,
      })),
      quote,

      /* ECHOED SO THE PLUGIN READS THE SERVER'S RECORD, NOT ITS OWN FORM.
       *
       * wp-admin posted the checkbox, so it already "knows" — and that is
       * exactly the trap. Two copies of one fact, written by two sides, will
       * disagree the first time a request is retried, a form is resubmitted,
       * or this route rejects the flag for a reason the plugin did not model.
       * The campaign that EXISTS is the only authority on what it is.
       *
       * IE_Campaigns::create_from_plan() reads it from here, and
       * wp-plugin/test-pillar-plugin.php proves it prefers this over the
       * form's own copy. */
      isPillar: campaign.isPillar,

      // Shown in wp-admin so the customer knows the whole cost before they
      // approve, rather than after the third post fails.
      creditsAvailable: available,
      enoughCredits: available >= quote.total,
      schedule: campaign.schedule,
      anchorSummary: plan.anchorSummary,
      // Not errors — several posts may end up linking with the same phrase.
      // Worth a line in wp-admin so the customer can widen the pool.
      warnings: plan.anchorWarnings,
    } };
}

module.exports = { createCampaign };
