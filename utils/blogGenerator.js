// utils/blogGenerator.js
//
// The bridge between a Job of kind 'blog' and the post writer.
//
// Mirrors utils/jobGenerator.js, which does the same for site builds: the
// runner knows about jobs and nothing about writing, the writer knows about
// prompts and nothing about queues, and this is the only file that knows both.
//
// WHERE THE MONEY IS SPENT AND RECORDED
// One post = one charge, and the charge happens HERE, at the moment the post
// exists — not when the plugin asks for it, and not when WordPress publishes
// it. Two reasons:
//
//   1. The OpenAI call is what costs us. If it succeeded, we paid, whether or
//      not the customer's site was up to receive the result.
//
//   2. Publishing happens on hardware we do not control and will sometimes
//      fail. Charging at publish would mean a site that goes down after
//      generation gets its posts free, and a site that retries gets charged
//      twice — depending on which way the race fell.
//
// markSlotReady() writes the charge and the status in one conditional update
// that only matches a slot still in 'generating'. A repeat changes nothing.

const User = require('../models/User');
const BlogCampaign = require('../models/BlogCampaign');
const { chargeCredits } = require('./helpers');
const { canAffordPost } = require('./blogPricing');
const { log } = require('./logger');

// The content engine, moved from blog-engine-preview/ into utils/blog/.
// These are the files proved against real output before any of this existed,
// and they are called with THEIR signatures — writePost(slot, ctx, opts) and
// checkPost(post, slot), not the object-shaped ones an earlier draft of this
// file invented.
const { writePost } = require('./blog/writePost');
const { checkPost } = require('./blog/qualityCheck');
// applyLinks is NOT used here — the plugin substitutes tokens, so it can
// esc_html the prose first. See the note on `rendered` below.
const { buildLinkPlan } = require('./blog/linkPlan');

// A slot that has failed this many times stops retrying. Without a cap, a
// topic the model consistently refuses would be retried on every scheduled
// run forever, and each attempt costs an API call even when it fails late.
const MAX_ATTEMPTS = Number(process.env.BLOG_MAX_ATTEMPTS) || 3;

/**
 * @param {object} job  Job document, kind 'blog'
 * @param {object} handlers
 * @param {Function} handlers.onProgress
 * @returns {Promise<{creditsCharged: number, result: object}>}
 */
async function generateBlogPost(job, { onProgress }) {
  const { campaignId, slotIndex } = job.payload || {};

  if (!campaignId || typeof slotIndex !== 'number') {
    throw new Error('Blog job is missing campaignId or slotIndex');
  }

  const campaign = await BlogCampaign.findById(campaignId).populate('site');
  if (!campaign) {
    throw new Error('The campaign this post belongs to no longer exists');
  }

  const slot = (campaign.slots || []).find(s => s.index === slotIndex);
  if (!slot) {
    throw new Error(`Campaign has no slot ${slotIndex}`);
  }

  // Loaded fresh rather than taken from the job, for the same reason
  // jobGenerator does it: the balance may have moved since this was queued,
  // and a campaign planned weeks ago is exactly the case where it has.
  const user = await User.findById(job.user);
  if (!user) {
    throw new Error('The user who owns this campaign no longer exists');
  }

  const afford = canAffordPost(user);
  if (!afford.ok) {
    // Released rather than failed: the customer can top up and the slot will
    // be picked up on the next run. Nothing was spent, so nothing is owed.
    await BlogCampaign.releaseSlot(campaignId, slotIndex, {
      message: `Not enough credits: needs ${afford.cost}, has ${afford.available}.`,
      giveUp: false,
    });
    throw new Error(
      `Not enough credits for this post: needs ${afford.cost}, you have ${afford.available}.`
    );
  }

  await onProgress({ stage: 'Planning links', total: 1, done: 0, current: slot.topic });

  // What this post links to, and what it leaves a placeholder for.
  //
  // Computed from the campaign's CURRENT state, not from the plan made when
  // the campaign was created: by now some later posts may already exist, and
  // a link that can be real should be real rather than a placeholder waiting
  // to be swapped.
  const { slot: planSlot, ctx, targets, pending } = buildLinkPlan(campaign, slotIndex);

  await onProgress({ stage: 'Writing the post', done: 0, current: slot.topic });

  let post;
  try {
    post = await writePost(planSlot, ctx, {
      // Both are the first knobs to turn if the writing disappoints, and both
      // are environment-tunable so a prompt experiment does not need a deploy.
      model: process.env.BLOG_MODEL,
      effort: process.env.BLOG_EFFORT || 'low',
      verbosity: process.env.BLOG_VERBOSITY || 'high',
    });
  } catch (err) {
    const giveUp = (slot.attempts || 0) >= MAX_ATTEMPTS;

    await BlogCampaign.releaseSlot(campaignId, slotIndex, {
      message: err.message,
      giveUp,
    });

    log.external('openai', 'blogPostFailed', {
      campaignId: String(campaignId),
      slotIndex,
      attempts: slot.attempts,
      givingUp: giveUp,
    });

    throw err;
  }

  // checkPost takes THE SLOT, not a options bag. That matters more than it
  // looks: qualityCheck.js lines 152-160 use slot.money.anchor,
  // slot.nextAnchor and slot.prevAnchor to confirm the model actually emitted
  // each required link token verbatim. Passed anything else, those three
  // checks silently skip, and a post that dropped its money-page link passes
  // as clean — which defeats the most important check in the file.
  //
  // A post that fails does NOT release the slot: it was generated, so it was
  // paid for. The warnings are recorded and it ships. The alternative is
  // charging for nothing, or regenerating and charging twice.
  const quality = checkPost(post, planSlot);

  if (!quality.ok) {
    log.info('blog.post.qualityWarnings', {
      campaignId: String(campaignId),
      slotIndex,
      failures: quality.failures.slice(0, 5),
      warnings: quality.warnings.slice(0, 5),
      words: quality.stats.words,
      density: quality.stats.density,
    });
  }

  // The post is handed over with its {{money}}…{{/money}} tokens INTACT, and
  // the plugin substitutes them.
  //
  // An earlier version of this file called applyLinks() here and shipped
  // finished HTML. That was wrong, and subtly: IE_Links::render() on the
  // plugin side esc_html's each paragraph BEFORE substituting tokens, so the
  // only markup that can survive into post_content is markup we put there.
  // Rendering here would have sent pre-formed HTML the plugin cannot escape
  // without destroying its own anchors — turning model output into trusted
  // markup on someone else's site.
  //
  // Tokens survive esc_html because they contain no HTML. That is the whole
  // reason the writer emits them rather than <a> tags.
  const rendered = {
    title: post.title,
    metaDescription: post.metaDescription,
    slug: slot.slug || undefined,
    sections: (post.sections || []).map(section => ({
      heading: section.heading || null,
      paragraphs: (section.paragraphs || []).slice(),
    })),

    // Where each token should point, in the shape IE_Links::render() reads.
    // snake_case because it is consumed by PHP; every other field on this
    // object is camelCase because it is consumed by JavaScript first.
    targets: {
      money: { url: targets.money.url },
      ...(targets.prev ? {
        prev: targets.prev.url
          ? { url: targets.prev.url }
          : { pending_id: targets.prev.pendingId },
      } : {}),
      ...(targets.next ? {
        next: targets.next.url
          ? { url: targets.next.url }
          : { pending_id: targets.next.pendingId },
      } : {}),
    },
  };

  // Every token the writer was told to emit but did not. checkPost already
  // reports this as a failure; recorded here too so the plugin can see which
  // links a published post is actually missing.
  const missingLinks = Object.keys(targets).filter(name => {
    const text = (post.sections || [])
      .flatMap(s => s.paragraphs || [])
      .join('\n');
    return !new RegExp(`\\{\\{${name}\\}\\}`).test(text);
  });

  // Charge and mark ready in one conditional update. If this returns null the
  // slot was not in 'generating' — meaning something else already completed
  // it — so the charge must NOT happen.
  const updated = await BlogCampaign.markSlotReady(campaignId, slotIndex, {
    credits: afford.cost,
    jobId: job._id,
  });

  if (!updated) {
    log.info('blog.post.slotAlreadyResolved', {
      campaignId: String(campaignId),
      slotIndex,
      jobId: String(job._id),
    });

    // The work was done and thrown away, which costs us an API call. That is
    // the right side to err on: the alternative is charging a customer twice
    // for one slot.
    return { creditsCharged: 0, result: { post: rendered, quality, duplicate: true } };
  }

  const remaining = await chargeCredits(user, afford.cost);

  log.info('blog.post.generated', {
    campaignId: String(campaignId),
    slotIndex,
    userId: String(user._id),
    creditsCharged: afford.cost,
    creditsRemaining: remaining,
    qualityOk: quality.ok,
  });

  await onProgress({ stage: 'completed', done: 1, total: 1, current: post.title });

  return {
    creditsCharged: afford.cost,
    // Stored on the job, which is what a retry reads instead of paying for a
    // second generation. See models/Job.js `result`.
    //
    // `pending` tells the plugin which placeholder spans this post carries, so
    // it knows what to swap later without re-parsing the HTML.
    result: { post: rendered, quality, pending, missingLinks },
  };
}

module.exports = { generateBlogPost };