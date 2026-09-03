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
const { checkPost, crossCheck } = require('./blog/qualityCheck');
// applyLinks is NOT used here — the plugin substitutes tokens, so it can
// esc_html the prose first. See the note on `rendered` below.
const { buildLinkPlan } = require('./blog/linkPlan');

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
    slug: slot.slug || undefined,
    sections: (post.sections || []).map(section => ({
      heading: section.heading || null,
      paragraphs: (section.paragraphs || []).slice(),
    })),

    // Where each token should point, in the shape IE_Links::render() reads.
    // snake_case because it is consumed by PHP; every other field here is
    // camelCase because it is consumed by JavaScript first.
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
  let lastError = null;

  for (let attempt = 1; attempt <= WRITE_ATTEMPTS; attempt++) {
    try {
      await onProgress({
        stage: attempt === 1 ? 'Writing' : `Writing (retry ${attempt - 1})`,
        current: slot.topic,
      });

      post = await writePost(planSlot, ctx, {
        // Both are the first knobs to turn if the writing disappoints, and
        // both are environment-tunable so a prompt experiment does not need a
        // deploy.
        model: process.env.BLOG_MODEL,
        effort: process.env.BLOG_EFFORT || 'low',
        verbosity: process.env.BLOG_VERBOSITY || 'high',
      });

      break;

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

  // checkPost takes THE SLOT, not an options bag. That matters more than it
  // looks: qualityCheck.js uses slot.money.anchor, slot.nextAnchor and
  // slot.prevAnchor to confirm the model emitted each required link token
  // verbatim. Passed anything else, those three checks silently skip, and a
  // post that dropped its money-page link passes as clean — which defeats the
  // most important check in the file.
  //
  // A post that fails does NOT release the slot: it was written, so it was
  // paid for. The warnings are recorded and it ships. The alternative is
  // charging for nothing, or rewriting and charging twice.
  const quality = checkPost(post, planSlot);

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

  await BlogCampaign.updateOne(
    { _id: campaign._id },
    { $set: { status: 'writing', 'batch.job': job._id, 'batch.startedAt': new Date() } }
  );

  await onProgress({ stage: 'Writing posts', total, done, current: '' });

  for (const slot of inScope) {
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

  // Nothing written at all means nothing to publish. Back to draft so the
  // customer can fix whatever it was and approve again, rather than leaving a
  // campaign stuck in 'writing' that no code will ever move.
  const anythingLive = (campaign.slots || []).some(
    s => s.status === 'ready' || s.status === 'scheduled' || s.status === 'published'
  );

  await BlogCampaign.updateOne(
    { _id: campaign._id },
    {
      $set: {
        status: anythingLive ? 'active' : 'draft',
        crossCheck: cross,
        'batch.finishedAt': new Date(),
        'batch.written': written.length,
        'batch.failed': failedIndexes.length,
        'batch.creditsCharged': creditsCharged,
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
  });

  // Thrown only when the batch achieved nothing. A partial batch is a success
  // with a caveat: eleven posts were written and paid for, and marking the job
  // failed would hide them behind an error page.
  if (!written.length && !alreadyWritten) {
    throw new Error(
      stoppedForCredits
        ? 'Not enough credits to write any posts in this campaign.'
        : 'None of the posts in this campaign could be written.'
    );
  }

  await onProgress({ stage: 'completed', total, done, current: '' });

  return {
    creditsCharged,
    result: {
      written,
      failed: failedIndexes,
      total,
      stoppedForCredits,
      crossCheck: cross,
    },
  };
}

module.exports = { writeCampaign, repairAroundFailures };