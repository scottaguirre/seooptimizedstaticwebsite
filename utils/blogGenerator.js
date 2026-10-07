// utils/blogGenerator.js
//
// The bridge between a Job of kind 'blog' and the post writer.
//
// ONE JOB WRITES A WHOLE CAMPAIGN
//
// It used to write one post. The campaign was a plan, and each week the
// scheduler woke the site, the site asked for the next post, and this file
// produced it. Twelve posts meant twelve jobs spread over twelve weeks.
//
// Now approval triggers one batch: every post written in a single job while
// the customer is still on the page. Three things fall out of that, and they
// are the reasons for the change:
//
//   1. crossCheck() becomes possible. It compares posts against each other for
//      repeated sentences and shared openings, and it could never run before —
//      there was never more than one post in hand at a time.
//
//   2. Running out of credits happens with the customer present, in the first
//      ten minutes, rather than silently in week seven.
//
//   3. A failed post is visible immediately, while it can still be fixed.
//
// WHERE THE MONEY IS SPENT AND RECORDED
//
// Per post, at the moment that post exists — not per campaign, and not at
// publication. The batch does NOT charge up front for twelve posts and refund
// what it fails to write: a refund path is a second way for the balance to
// move, and every one of those is a way for it to move wrongly. Eleven posts
// written is eleven posts charged, and there is nothing to reconcile.
//
// markSlotReady() writes the charge and the status in one conditional update
// that only matches a slot still in 'generating'. A repeat changes nothing.
//
// SERIAL, DELIBERATELY
//
// Twelve posts at roughly forty seconds each is about eight minutes. Writing
// them concurrently would be faster and is tempting, but it forecloses the one
// improvement this architecture exists to make possible: passing earlier
// titles and opening lines into later prompts, so posts avoid repeating each
// other rather than being checked for it afterwards. Serial keeps that door
// open. If eight minutes proves too long, write in groups of three or four
// rather than all at once.

const User = require('../models/User');
const BlogCampaign = require('../models/BlogCampaign');
const BlogPost = require('../models/BlogPost');
const { chargeCredits } = require('./helpers');
const { canAffordPost } = require('./blogPricing');
const { log } = require('./logger');

// The content engine, moved from blog-engine-preview/ into utils/blog/.
// These are the files proved against real output before any of this existed,
// and they are called with THEIR signatures — writePost(slot, ctx, opts) and
// checkPost(post, slot), not the object-shaped ones an earlier draft of this
// file invented.
const { writePost } = require('./blog/writePost');
const { checkPost, crossCheck, worthRewriting } = require('./blog/qualityCheck');
// applyLinks is NOT used here — the plugin substitutes tokens, so it can
// esc_html the prose first. See the note on `rendered` below.
const { buildLinkPlan } = require('./blog/linkPlan');
// The URL is cut from the headline the model actually wrote. See renderPayload.
const { slugify } = require('./blog/planCampaign');

// How many times to call the model for one slot within a run. Most write
// failures are a timeout or a malformed JSON response, and a second attempt
// costs seconds while the customer is still watching.
//
// A slot that exhausts these is marked 'failed', not returned to 'pending',
// and that is a change from how this worked before. It used to go back to
// pending because the scheduler would come round again next week and try it.
// Nothing does that any more — under write-ahead the batch is the only thing
// that writes, so a slot left pending after the batch is a slot no code will
// ever pick up. Calling it pending would be a lie told to a customer looking
// at a campaign that has quietly stopped.
//
// Reopening a failed slot is deliberate and explicit: BlogCampaign.reopenSlot(),
// called by the gap-fill route, and capped by slot.attempts.
const WRITE_ATTEMPTS = Number(process.env.BLOG_WRITE_ATTEMPTS) || 2;

/* THE RETRY RULE LIVES IN qualityCheck.js NOW — moved 4 October.
 *
 * REWRITE_WORTHY and worthRewriting() were defined here, two files away from
 * the fail() calls that raise the codes they name. A code renamed in one file
 * and not the other left a set member that could never match, and nothing
 * failed when that happened: the post just shipped unretried.
 *
 * And the rule could not be unit tested from here, because this file requires
 * models/User.js and so requires Mongoose. The only check on it read this
 * file as a STRING. qualityCheck.js requires nothing, so the rule is now
 * asserted by calling it.
 *
 * worthRewriting is imported at the top of this file with checkPost.
 */

/**
 * Turn a written post into the payload the plugin receives.
 *
 * The tokens are left INTACT and the plugin substitutes them.
 *
 * An earlier version of this file called applyLinks() here and shipped
 * finished HTML. That was wrong, and subtly: IE_Links::render() on the plugin
 * side esc_html's each paragraph BEFORE substituting tokens, so the only
 * markup that can survive into post_content is markup we put there. Rendering
 * here would have sent pre-formed HTML the plugin cannot escape without
 * destroying its own anchors — turning model output into trusted markup on
 * someone else's site.
 *
 * Tokens survive esc_html because they contain no HTML. That is the whole
 * reason the writer emits them rather than <a> tags.
 */
function renderPayload(post, slot, targets) {
  return {
    title: post.title,
    metaDescription: post.metaDescription,
    /* THE SLUG FOLLOWS THE PUBLISHED HEADLINE, NOT THE TOPIC — 7 October.
     *
     * It used to be `slot.slug`, cut at PLAN time from the topic the owner
     * ticked. The title is written at WRITE time, by the model, hours or days
     * later, and nothing reconciled them. Found on a live post of Edwin's:
     *
     *   topic  Conditional Approval Can Still Leave a Business Loan Unfunded
     *   title  Conditional Approval for a Business Loan: What the Meaning Is
     *          Before Funding
     *   url    /conditional-approval-can-still-leave-a-business-loan-unfunded/
     *
     * Two different headlines for one post, and the URL — the part a person
     * reads before clicking and the part that can never be changed afterwards
     * — recorded the one nobody published. Its neighbour was worse: the slug
     * dropped "business loan" entirely, so the post's own keyword was absent
     * from its address.
     *
     * THE FORWARD LINKS DO NOT DEPEND ON THIS, which is what makes the move
     * safe. A post links to siblings that may not exist yet, so a plan-time
     * slug looks load-bearing — but linkPlan.js already builds every URL from
     * the one WORDPRESS ASSIGNED, precisely because WordPress appends -2 to a
     * slug already in use. Nothing downstream ever trusted the requested one.
     *
     * FALLS BACK TO THE PLAN SLUG for a post whose title somehow slugifies to
     * nothing — all punctuation, say. An empty post_name makes WordPress
     * invent one from the post id, which is the worst URL available. */
    slug: slugify(post.title) || slot.slug || undefined,
    sections: (post.sections || []).map(section => ({
      heading: section.heading || null,
      paragraphs: (section.paragraphs || []).slice(),
    })),

    /* Where each token should point, in the shape IE_Links::render() reads.
     * snake_case because it is consumed by PHP; every other field here is
     * camelCase because it is consumed by JavaScript first.
     *
     * THE THIRD UNCONDITIONAL MONEY READ, and the same asymmetry as the other
     * two: prev and next are spread behind a test and money was not, because
     * for as long as every campaign had a money page the test looked like
     * dead weight. A pillar campaign has none, and this one would have thrown
     * AFTER the model was paid for — the slot written, the credits taken, and
     * the payload that carries it to WordPress unbuildable. The two in
     * writePost.js at least fail before spending anything. */
    targets: {
      ...(targets.money ? { money: { url: targets.money.url } } : {}),
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
}

/** Every token the writer was told to emit but did not. */
function findMissingLinks(post, targets) {
  const text = (post.sections || [])
    .flatMap(s => s.paragraphs || [])
    .join('\n');

  return Object.keys(targets).filter(
    name => !new RegExp(`\\{\\{${name}\\}\\}`).test(text)
  );
}

/**
 * Write one slot, charge for it, and store it.
 *
 * Returns { ok, credits, reason }. It never throws for a content failure: the
 * batch has eleven other posts to write and one bad topic must not take them
 * with it. It DOES throw for a broken campaign, because that is not survivable.
 */
async function writeOneSlot({ campaign, slot, user, job, onProgress }) {
  const campaignId = campaign._id;
  const index = slot.index;

  // Checked per slot, not once for the batch, and checked against a freshly
  // loaded balance. The customer may be spending credits elsewhere while this
  // runs — a site generation in another tab is the obvious case.
  const afford = canAffordPost(user);
  if (!afford.ok) {
    return { ok: false, outOfCredits: true, reason: `needs ${afford.cost}, has ${afford.available}` };
  }

  // Claimed BEFORE any model call. Of two callers exactly one gets a document
  // back; the other gets null and must not generate. On a requeued job this is
  // also what skips the slots the previous run already finished — they are no
  // longer 'pending', so they no longer match.
  const claimed = await BlogCampaign.claimSlot(campaignId, index, job._id);
  if (!claimed) {
    return { ok: false, alreadyResolved: true, reason: 'claimed elsewhere or already written' };
  }

  // What this post links to, and what it leaves a placeholder for.
  //
  // Computed from the campaign's CURRENT state rather than from the plan. In a
  // write-ahead batch nothing is published yet, so nearly every inter-post link
  // is a placeholder — but not all of them: a campaign extending an earlier
  // one links to posts that ARE live, and buildLinkPlan is what tells the two
  // cases apart.
  const { slot: planSlot, ctx, targets, pending } = buildLinkPlan(campaign, index);

  let post = null;
  let quality = null;
  let lastError = null;

  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt++) {
    try {
      await onProgress({
        stage: attempt === 1 ? 'Writing' : `Writing (retry ${attempt - 1})`,
        current: slot.topic,
      });

      const candidate = await writePost(planSlot, ctx, {
        // Both are the first knobs to turn if the writing disappoints, and
        // both are environment-tunable so a prompt experiment does not need a
        // deploy.
        model: process.env.BLOG_MODEL,
        effort: process.env.BLOG_EFFORT || 'low',
        verbosity: process.env.BLOG_VERBOSITY || 'high',
      });

      post = candidate;
      quality = checkPost(candidate, planSlot);

      /* THE CHECK MOVED INSIDE THE LOOP, AND NOTHING HAS BEEN CHARGED YET.
       *
       * It used to run after this loop, which is after the point of no
       * return: the comment there said a failing post ships because "it was
       * written, so it was paid for", and rewriting would mean "charging
       * twice". That was true where it stood. Up here the charge has not
       * happened — markSlotReady() and chargeCredits() are both below — so a
       * second attempt costs us one API call and the customer nothing. The
       * same economics as the existing retry on a thrown error.
       *
       * ONLY FOR FAULTS A REWRITE CAN FIX, by code rather than by message.
       * Three links in one paragraph, a post half the length asked for, a
       * missing money-page link: all of those are a different roll of the
       * dice away from being right. A "guide" title or filler phrasing is a
       * prompt problem, and asking the same model the same question again
       * mostly buys another identical answer. */
      if (quality.ok || attempt === WRITE_ATTEMPTS || !worthRewriting(quality)) {
        break;
      }

      log.info('blog.post.rewriting', {
        campaignId: String(campaignId),
        slotIndex: index,
        attempt,
        of: WRITE_ATTEMPTS,
        codes: (quality.codes || []).slice(0, 5),
      });

    } catch (err) {
      lastError = err;

      log.external('openai', 'blogPostAttemptFailed', {
        campaignId: String(campaignId),
        slotIndex: index,
        attempt,
        of: WRITE_ATTEMPTS,
        message: err.message,
      });
    }
  }

  if (!post) {
    // Marked failed, not returned to pending. See the note on WRITE_ATTEMPTS:
    // there is no longer a weekly run that would come back to a pending slot,
    // so 'pending' after the batch would mean "waiting for nothing".
    //
    // Nothing was charged either way — a failed write costs us an API call and
    // costs the customer nothing.
    await BlogCampaign.releaseSlot(campaignId, index, {
      message: lastError?.message || 'The writer produced nothing.',
      giveUp: true,
    });

    return { ok: false, reason: lastError?.message || 'no post produced' };
  }

  /* The verdict was computed in the loop above, on the copy that survived.
   *
   * checkPost takes THE SLOT, not an options bag. That matters more than it
   * looks: qualityCheck.js uses slot.money.anchor, slot.nextAnchor and
   * slot.prevAnchor to confirm the model emitted each required link token
   * verbatim. Passed anything else, those three checks silently skip, and a
   * post that dropped its money-page link passes as clean — which defeats the
   * most important check in the file.
   *
   * A post that still fails after its rewrites does NOT release the slot: it
   * was written, so it is charged for, and the warnings are recorded against
   * it. The alternative is charging for nothing. */
  quality = quality || checkPost(post, planSlot);

  // Logged, not just stored.
  //
  // The verdict goes onto the BlogPost either way, but a `qualityOk: false` in
  // the batch log with no way to see WHY is a dead end for whoever is reading
  // it — and the log is where anyone looks first. This line existed before the
  // batch rewrite and I dropped it; putting it back costs nothing and answers
  // the only question that matters when a post comes back marked bad.
  if (!quality.ok) {
    log.info('blog.post.qualityWarnings', {
      campaignId: String(campaignId),
      slotIndex: index,
      failures: (quality.failures || []).slice(0, 5),
      warnings: (quality.warnings || []).slice(0, 5),
      words: quality?.stats?.words,
      density: quality?.stats?.density,
    });
  }

  const payload = renderPayload(post, slot, targets);

  // Stored BEFORE the charge, so a crash between the two leaves a post that
  // was never billed for. The other order leaves a customer billed for a post
  // that does not exist, and only one of those is recoverable by looking.
  await BlogPost.storeForSlot(campaign, index, {
    ...payload,
    jobId: job._id,
    quality,
    pending,
    missingLinks: findMissingLinks(post, targets),
  });

  // Charge and mark ready in one conditional update. If this returns null the
  // slot was not in 'generating' — something else completed it — so the charge
  // must NOT happen.
  const updated = await BlogCampaign.markSlotReady(campaignId, index, {
    credits: afford.cost,
    jobId: job._id,
  });

  if (!updated) {
    log.info('blog.post.slotAlreadyResolved', {
      campaignId: String(campaignId),
      slotIndex: index,
      jobId: String(job._id),
    });

    // The work was done and thrown away, which costs us an API call. That is
    // the right side to err on: the alternative is charging a customer twice
    // for one slot.
    return { ok: false, alreadyResolved: true, reason: 'resolved by another writer' };
  }

  const remaining = await chargeCredits(user, afford.cost);

  // Kept in step with the database so the NEXT slot's affordability check sees
  // the balance this one just spent. Without it a batch would price all twelve
  // posts against the balance the job started with.
  user.credits = remaining;

  log.info('blog.post.written', {
    campaignId: String(campaignId),
    slotIndex: index,
    userId: String(user._id),
    creditsCharged: afford.cost,
    creditsRemaining: remaining,
    qualityOk: quality.ok,
    words: quality?.stats?.words,
  });

  return { ok: true, credits: afford.cost, quality };
}

/**
 * Clear the link tokens that point at slots which never got written.
 *
 * Slot 8 fails. Slot 7 was written before slot 8 was attempted, so its prose
 * already carries a {{next}} token naming slot 8's topic, and its stored
 * targets carry a pending_id for a post that will never exist. Left alone,
 * that becomes a placeholder span in a published post that nothing will ever
 * activate — an invisible dead end.
 *
 * Removing the target is enough: IE_Links::render() unwraps a token whose
 * target is missing and emits the phrase as plain text. Slot 7's sentence
 * survives, one link lighter.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO is re-point slot 7 at slot 9 to close the
 * ring. The anchor phrase in slot 7's prose describes slot 8's topic; aiming
 * it at slot 9 would produce a link whose text is about something else. That
 * repair needs slot 7 rewritten, which is a decision with a price on it, not
 * something to do quietly inside a job.
 */
async function repairAroundFailures(campaign, failedIndexes) {
  if (!failedIndexes.length) return 0;

  const failed = new Set(failedIndexes);
  const posts = await BlogPost.forCampaign(campaign._id);
  let repaired = 0;

  for (const post of posts) {
    const targets = post.targets || {};
    let changed = false;

    for (const [name, target] of Object.entries(targets)) {
      if (!target || !target.pending_id) continue;

      // pending_id is 'slot-<n>' — the id form used in the content, so this is
      // the same string the placeholder span would have carried.
      const match = /^slot-(\d+)$/.exec(target.pending_id);
      if (!match || !failed.has(Number(match[1]))) continue;

      delete targets[name];
      changed = true;
    }

    if (!changed) continue;

    post.targets = targets;
    post.pending = (post.pending || []).filter(p => !failed.has(Number(p?.slotIndex)));

    // Mixed fields are not tracked by Mongoose's change detection — it cannot
    // see into an object it was told nothing about. Without this the save is a
    // no-op and the dangling target survives, silently.
    post.markModified('targets');
    await post.save();

    repaired++;
  }

  log.info('blog.batch.repairedLinks', {
    campaignId: String(campaign._id),
    failedSlots: failedIndexes,
    postsEdited: repaired,
  });

  return repaired;
}

/**
 * Write every unwritten slot in a campaign.
 *
 * @param {object} job  Job document, kind 'blog', payload { campaignId, slotIndexes? }
 * @param {object} handlers
 * @param {Function} handlers.onProgress
 * @returns {Promise<{creditsCharged: number, result: object}>}
 */
async function writeCampaign(job, { onProgress }) {
  const { campaignId, slotIndexes, slotIndex } = job.payload || {};

  if (!campaignId) {
    throw new Error('Blog job is missing campaignId');
  }

  // A job queued before this change carries slotIndex (singular) and means
  // "write exactly this one". Treated as a one-element scope rather than
  // ignored — ignoring it would make an old single-post job write the entire
  // campaign and charge for all of it, which is the worst possible way to
  // survive a rolling deploy.
  const scope = Array.isArray(slotIndexes) && slotIndexes.length
    ? slotIndexes
    : (Number.isInteger(slotIndex) ? [slotIndex] : null);

  /* Read fresh from the collection, never from the in-memory campaign.
   *
   * `campaign` below is loaded once, before the first post. Reading
   * `campaign.batch.cancelRequested` off it would be a snapshot taken minutes
   * before anyone could possibly have pressed Pause — a check that compiles,
   * runs, and can never be true.
   *
   * The same mistake already cost this file a worse bug: the finish used to
   * test the stale in-memory `slots`, decided nothing had been written, and
   * set the campaign back to 'draft' immediately after charging for every
   * post in it. See the note above `const fresh = ...` further down. */
  const cancelRequested = async id => {
    const row = await BlogCampaign.findById(id).select('batch.cancelRequested').lean();
    return !!(row && row.batch && row.batch.cancelRequested);
  };

  const campaign = await BlogCampaign.findById(campaignId).populate('site');
  if (!campaign) {
    throw new Error('The campaign this batch belongs to no longer exists');
  }

  // Loaded fresh rather than taken from the job, for the same reason
  // jobGenerator does it: the balance may have moved since this was queued.
  const user = await User.findById(job.user);
  if (!user) {
    throw new Error('The user who owns this campaign no longer exists');
  }

  // A scope is how a later run fills a specific gap without touching the rest
  // of the campaign. Absent, the whole campaign is in scope.
  const wanted = scope ? new Set(scope.map(Number)) : null;

  const inScope = (campaign.slots || [])
    .slice()
    .sort((a, b) => a.index - b.index)
    .filter(s => !wanted || wanted.has(s.index));

  // Counted, not filtered out. A requeued job should report 7 of 12 rather
  // than restarting the count at 0 of 5 — the customer watching the bar has
  // no idea a worker died and should not see it go backwards.
  const alreadyWritten = inScope.filter(
    s => s.status === 'ready' || s.status === 'scheduled' || s.status === 'published'
  ).length;

  const total = inScope.length;
  let done = alreadyWritten;
  let creditsCharged = 0;

  const written = [];
  const failedIndexes = [];
  let stoppedForCredits = false;
  let stoppedForPause = false;

  /* CLEARED AS THE BATCH STARTS, in the same write that claims it.
   *
   * A cancel left over from the previous run would stop this one before it
   * wrote anything — the campaign would resume, halt instantly, and look as
   * though it had failed for no reason. Done here rather than at the end so
   * that a worker killed mid-batch cannot leave the flag behind either. */
  await BlogCampaign.updateOne(
    { _id: campaign._id },
    {
      $set: {
        status: 'writing',
        'batch.job': job._id,
        'batch.startedAt': new Date(),
        'batch.cancelRequested': false,
        'batch.cancelledAt': null,
      },
    }
  );

  await onProgress({ stage: 'Writing posts', total, done, current: '' });

  for (const slot of inScope) {
    /* STOP IF SOMEBODY ASKED, BEFORE PAYING FOR THE NEXT POST.
     *
     * Re-read every iteration, because the flag is set by a different process
     * minutes after this loop started. One tiny indexed read per post, beside
     * a model call that takes tens of seconds and costs 75 credits.
     *
     * BETWEEN POSTS IS THE ONLY HONEST PLACE FOR IT. A model call in flight
     * has been paid for already; abandoning it spends the credits and keeps
     * nothing. So pause means "no more after this one", and the plugin's
     * confirm dialog now says exactly that rather than "nothing new is
     * written" — which is what it promised while writing eleven articles. */
    if (await cancelRequested(campaign._id)) {
      stoppedForPause = true;

      await onProgress({
        stage: 'Stopped: paused',
        total,
        done,
        current: '',
        skippedPage: { page: slot.topic, reason: 'The campaign was paused.' },
      });

      log.info('blog.batch.cancelled', {
        campaignId: String(campaign._id),
        stoppedBeforeSlot: slot.index,
        written: written.length,
        of: total,
        creditsCharged,
      });

      break;
    }

    const outcome = await writeOneSlot({ campaign, slot, user, job, onProgress });

    if (outcome.ok) {
      creditsCharged += outcome.credits;
      written.push(slot.index);
      done += 1;

      await onProgress({
        stage: 'Writing posts',
        total,
        done,
        current: slot.topic,
        completedPage: `slot-${slot.index}`,
      });
      continue;
    }

    if (outcome.alreadyResolved) {
      // Not a failure and not new work — another run got there first.
      continue;
    }

    if (outcome.outOfCredits) {
      // Stop cleanly rather than grinding through five more slots that will
      // all fail the same check. What is written is written and paid for.
      stoppedForCredits = true;

      await onProgress({
        stage: 'Stopped: out of credits',
        total,
        done,
        current: slot.topic,
        skippedPage: { page: slot.topic, reason: `Not enough credits — ${outcome.reason}` },
      });

      log.info('blog.batch.outOfCredits', {
        campaignId: String(campaign._id),
        stoppedAtSlot: slot.index,
        written: written.length,
        of: total,
      });

      break;
    }

    failedIndexes.push(slot.index);

    await onProgress({
      stage: 'Writing posts',
      total,
      done,
      current: slot.topic,
      skippedPage: { page: slot.topic, reason: String(outcome.reason || 'failed').slice(0, 300) },
    });
  }

  // Anything the batch could not write leaves dangling link tokens in the
  // posts around it. Cleaned before the campaign is handed over, not after
  // WordPress has already published the post carrying them.
  await repairAroundFailures(campaign, failedIndexes);

  /* -------------------------------------------------------------- the set */

  // The check that could not exist before. Every quality signal until now was
  // per-post, and "all twelve of these open the same way" is not a per-post
  // fact — it is only visible with the whole batch in hand.
  let cross = null;

  try {
    const posts = await BlogPost.forCampaign(campaign._id);

    if (posts.length > 1) {
      cross = crossCheck(posts.map(p => ({ sections: p.sections })));

      if (cross.dupOpenings.length || cross.repeats.length) {
        log.info('blog.batch.repetition', {
          campaignId: String(campaign._id),
          duplicateOpenings: cross.dupOpenings.length,
          repeatedSentences: cross.repeats.length,
          sample: cross.repeats.slice(0, 2),
        });
      }
    }
  } catch (err) {
    // A report is not worth failing a batch of paid-for posts over.
    log.error('blog.batch.crossCheckFailed', err, { campaignId: String(campaign._id) });
  }

  /* ------------------------------------------------------------ the finish */

  /* Nothing written at all means nothing to publish. Back to draft so the
   * customer can fix whatever it was and approve again, rather than leaving a
   * campaign stuck in 'writing' that no code will ever move.
   *
   * RE-READ, AND THAT IS THE WHOLE BUG THIS LINE ONCE HAD.
   *
   * `campaign` was loaded before the batch started. Every slot written since
   * was marked ready by markSlotReady(), which is a findOneAndUpdate on the
   * COLLECTION — it never touches this in-memory document. So this test read
   * slots that still said 'pending', decided nothing had been written, and
   * set the campaign back to 'draft' — immediately after writing and charging
   * for every post in it.
   *
   * Nothing then ever reached 'active', so the completion check in
   * /api/blog/published (which requires 'active') could never fire either.
   * Campaigns with every post live sat at "In progress" for ever, and every
   * campaign on the account read as an unapproved draft. */
  const fresh = await BlogCampaign.findById(campaign._id).select('slots').lean();

  const anythingLive = ((fresh && fresh.slots) || []).some(
    s => s.status === 'ready' || s.status === 'scheduled' || s.status === 'published'
  );

  /* A CANCELLED BATCH LEAVES THE CAMPAIGN PAUSED, not active and not draft.
   *
   * 'active' would be a lie the report repeats: the campaign is not running,
   * somebody stopped it. 'draft' would be worse — it is the state a campaign
   * that never wrote anything goes to, and it would hide however many posts
   * this batch DID write and charge for behind a word meaning "nothing has
   * happened yet".
   *
   * It also matches what WordPress already believes. IE_Publisher::pause()
   * set the local record to paused before this flag was ever read, so any
   * other answer here puts the two sides out of step until the next sweep. */
  const finalStatus = stoppedForPause ? 'paused' : (anythingLive ? 'active' : 'draft');

  await BlogCampaign.updateOne(
    { _id: campaign._id },
    {
      $set: {
        status: finalStatus,
        crossCheck: cross,
        'batch.finishedAt': new Date(),
        'batch.written': written.length,
        'batch.failed': failedIndexes.length,
        'batch.creditsCharged': creditsCharged,
        // Cleared however the batch ended, so a resume is not cancelled by a
        // flag nobody set this time round.
        'batch.cancelRequested': false,
        ...(stoppedForPause ? { 'batch.cancelledAt': new Date() } : {}),
      },
    }
  );

  log.info('blog.batch.finished', {
    campaignId: String(campaign._id),
    userId: String(user._id),
    written: written.length,
    failed: failedIndexes.length,
    of: total,
    creditsCharged,
    stoppedForCredits,
    stoppedForPause,
  });

  // Thrown only when the batch achieved nothing. A partial batch is a success
  // with a caveat: eleven posts were written and paid for, and marking the job
  // failed would hide them behind an error page.
  /* A PAUSE THAT CAUGHT THE BATCH BEFORE ITS FIRST POST IS NOT A FAILURE.
   *
   * Without the third clause, pressing Pause quickly enough would write
   * nothing — exactly what was asked for — and then throw, which marks the
   * job failed and shows the owner an error about posts that "could not be
   * written". Nothing went wrong; they stopped it. */
  if (!written.length && !alreadyWritten && !stoppedForPause) {
    throw new Error(
      stoppedForCredits
        ? 'Not enough credits to write any posts in this campaign.'
        : 'None of the posts in this campaign could be written.'
    );
  }

  await onProgress({ stage: stoppedForPause ? 'Stopped: paused' : 'completed', total, done, current: '' });

  return {
    creditsCharged,
    result: {
      written,
      failed: failedIndexes,
      total,
      stoppedForCredits,
      stoppedForPause,
      crossCheck: cross,
    },
  };
}

/* renderPayload is exported FOR THE TESTS, and that is the honest reason.
 *
 * It builds the object the plugin receives, and the money target inside it was
 * the third unconditional read of a value a pillar campaign does not have —
 * the one that would have thrown after the model was already paid for. The
 * alternative was a test that greps this file for the `targets.money ?`, and
 * source greps have now missed four real bugs in this project. A test that
 * CALLS the function cannot be fooled by the condition being written
 * correctly and reached never. */
module.exports = { writeCampaign, repairAroundFailures, renderPayload };