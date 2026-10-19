// utils/blog/approveCampaign.js
//
// Approving a draft: the credit gate, the lock, the poll and the pause.
//
// WHY THIS IS NOT IN THE ROUTE ANY MORE
//
// It was, for its whole life — the body of POST /api/blog/write, which only
// a signed request from the WordPress plugin can reach.
//
// The Cloudflare blogs have no WordPress and no plugin. Their campaigns are
// approved from a screen on our own site, by a logged-in user, and that
// screen needs every rule in here: the refusal when the balance is short,
// the conditional claim that stops two approvals enqueueing two batches, the
// lost-batch detection, the gap fill, and the cancel that rides on the poll.
// The choice was to copy those rules or to move them.
//
// Copying is how two versions of one decision end up disagreeing — the
// mistake this project has paid for more than any other, and the reason
// createCampaign.js sits next to this file. So they moved, once, to a place
// both callers can reach.
//
// WHAT CHANGED IN THE MOVE: NOTHING THE PLUGIN CAN SEE
//
// The body below is the handler's body, with four names swapped —
// req.body → body, req.site → site, req.id → requestId, baseUrl(req) → the
// baseUrl string the caller computes — and the eight ways it used to answer
// replaced by eight ways it now returns. No rule was rewritten, reordered or
// "tidied" on the way across. A refactor that also improves things is two
// changes wearing one coat, and when it breaks you cannot tell which half
// did it.
//
// test-write-contract.js was written FIRST, against the handler untouched,
// and pins all of it: the 402 and its buyCreditsUrl, the job scope against
// the remainder, the claim filter, the losing job being deleted, the
// cancelling flag, the lost batch being released back to draft, the terminal
// written shape, the gap fill, and the 404 that will not say which kind it
// is. It passed before the move and has to pass after it.
//
// ONE KNOWN WART CAME ACROSS UNCHANGED, AND WAS THEN FIXED ON ITS OWN.
//
// `slotIndexes` was filtered with `.map(Number).filter(Number.isInteger)`,
// and Number(null), Number(false), Number('') and Number([]) are all 0 — so
// a malformed list silently reopened slot 0, which no one named, and
// charged for rewriting it.
//
// It came across the move untouched and pinned by a test that said so,
// because a relocation that also fixes things is two changes wearing one
// coat. The fix is the commit after, and it is slotNumber() below.

'use strict';

const Job = require('../../models/Job');
const User = require('../../models/User');
const BlogCampaign = require('../../models/BlogCampaign');

const { quotePosts } = require('../blogPricing');
const { ownedCampaign } = require('./ownedCampaign');
const { log } = require('../logger');

/** Statuses meaning "this slot has been written and paid for". */
const WRITTEN = ['ready', 'scheduled', 'published'];

/* WHY THIS SHAPE IS NOT createCampaign'S SHAPE
 *
 * That one returns { ok, status, error, ...rest } and the route spreads the
 * rest into the body. Doing the same here was the one mistake the move
 * actually made, and the contract test caught it on the first run:
 *
 *   refuse('This campaign was cancelled.', 409, { status: 'cancelled' })
 *
 * `status` is BOTH the HTTP code and a key the plugin reads off the body —
 * two different meanings of one word in one object. The extras overwrote
 * the code, the route called res.status('cancelled'), and a campaign that
 * had been cancelled answered with a crash instead.
 *
 * So the code and the body are kept apart here. `code` is the HTTP status
 * and NOTHING else; `body` is the exact object the route sends, refusal or
 * not. There is no spreading on the other side and so nothing left to
 * collide.
 */

/**
 * One entry in `slotIndexes`, or null if it does not name a slot.
 *
 * WHY THIS IS NOT Number().
 *
 * It was. The filter read `.map(Number).filter(Number.isInteger)`, and
 * Number(null), Number(false), Number('') and Number([]) are every one of
 * them 0 — all four survive the filter and reopen slot 0, a slot nobody
 * named. That is the exact thing the branch below exists to prevent:
 * reopening a failed slot is meant to be explicit, so that a retry can
 * never quietly rewrite — and recharge for — a post the customer was told
 * had failed. A malformed list did it anyway.
 *
 * Numeric STRINGS still count, because they have to: this arrives as JSON
 * over HTTP from wp-admin, and a form field is a string whether it holds a
 * number or not. "3" is somebody naming slot three. Nothing else is.
 */
function slotNumber(value) {
  if ('number' === typeof value) return Number.isInteger(value) ? value : null;
  if ('string' === typeof value && /^-?\d+$/.test(value.trim())) return Number(value);
  return null;
}

/** 404 not yours, 409 wrong state, 402 balance too short. */
function refuse(error, code, extra = {}) {
  return { ok: false, code, body: Object.assign({ error }, extra) };
}

/** Everything that is not a refusal. */
function answer(body) {
  return { ok: true, code: 200, body };
}

/**
 * @param {object} opts
 * @param {object} opts.site       the BlogSite approving the campaign
 * @param {object} opts.body       { campaignId, slotIndexes?, cancel? }
 * @param {string} opts.requestId  for the log lines
 * @param {string} opts.baseUrl    this server's address, for buyCreditsUrl
 *
 * @returns {Promise<object>}
 *   { ok, code, body }   `code` is the HTTP status and `body` is the exact
 *                        object /api/blog/write sent. See the note above
 *                        refuse() for why those are two fields and not one.
 *
 * THROWS RATHER THAN SWALLOWING, for the same reason createCampaign does.
 * The route's try/catch turns a failure into a 500 and the screen's into a
 * page; a function that caught its own errors and returned ok:false for both
 * would make "not enough credits" and "the database is down" look the same.
 */
async function approveCampaign({ site, body, requestId, baseUrl }) {
  const { campaignId, slotIndexes, cancel } = body || {};

  const campaign = await ownedCampaign({ site, campaignId, requestId });
  if (!campaign) {
    return refuse('Campaign not found.', 404);
  }

  if (campaign.status === 'cancelled') {
    return refuse('This campaign was cancelled.', 409, { status: 'cancelled' });
  }

  /* ---- stop the batch, carried on the poll that is already happening ---- */

  /* NO NEW ENDPOINT, AND DELIBERATELY SO. The plugin polls this route every
   * few seconds for as long as the spinner turns, so a paused campaign
   * re-asserts the cancel on every poll: a request that fails costs a few
   * seconds instead of being lost for ever.
   *
   * That matters more here than anywhere. Four facts have already been lost
   * in this plugin to one-shot calls with no retry behind them — the note
   * above campaigns_present() in class-ie-api.php lists them — and a cancel
   * is the worst of all of them to deliver once and hope, because the
   * failure mode is writing and charging for everything the owner just said
   * to stop. Which is precisely what happened: eleven posts, 825 credits,
   * after Pause was pressed.
   *
   * ONLY MEANINGFUL WHILE A BATCH IS RUNNING. Set at any other moment the
   * flag would sit there and cancel the NEXT batch, so it is ignored unless
   * the campaign is writing. runBatch() also clears it as it claims the
   * campaign, which closes the race where a cancel lands in between. */
  if (true === cancel || 'true' === cancel) {
    if ('writing' === campaign.status) {
      await BlogCampaign.updateOne(
        { _id: campaign._id },
        { $set: { 'batch.cancelRequested': true } }
      );

      log.info('blog.write.cancelRequested', {
        requestId,
        campaignId: String(campaign._id),
      });
    }

    /* FALLS THROUGH to the status branches below rather than returning.
     *
     * The caller asked what is happening as well as for it to stop, and a
     * cancel that answered nothing would leave the spinner unable to say
     * whether it had been heard — which is the thing that made the original
     * bug so unpleasant to watch. */
  }

  /* ---- already running: report, do not start a second ---- */

  if (campaign.status === 'writing') {
    const job = campaign.batch?.job ? await Job.findById(campaign.batch.job).lean() : null;

    // A job that died leaves the campaign stuck in 'writing' forever, so a
    // failed job has to be reported as failure rather than as progress. The
    // runner requeues genuinely stale jobs; this is for one that gave up.
    //
    // A MISSING job is the same problem wearing different clothes: a record
    // deleted by hand, or a crash between creating the job and recording it.
    // Without this branch the campaign polls "writing, 0 of 12" forever and
    // no amount of pressing the button will ever start it again.
    if (!job || job.status === 'failed') {
      await BlogCampaign.updateOne({ _id: campaign._id }, { $set: { status: 'draft' } });

      log.error('blog.write.batchLost', new Error('Campaign was writing with no live job'), {
        campaignId: String(campaign._id),
        jobId: String(campaign.batch?.job || ''),
        jobStatus: job?.status || 'missing',
      });

      return refuse(
        job?.error?.message || 'The batch stopped. Approve the campaign again to restart it.',
        409,
        { status: 'failed' }
      );
    }

    return answer({
      status: 'writing',
      done: job?.progress?.done ?? 0,
      total: job?.progress?.total ?? campaign.slots.length,
      current: job?.progress?.current || '',
      stage: job?.progress?.stage || 'queued',
      /* SO THE SPINNER CAN SAY IT WAS HEARD. Without this the plugin shows
       * an unchanged progress bar for as long as the post in flight takes
       * to finish, which is exactly the minute in which somebody decides
       * the Pause button does not work — and presses it again. */
      cancelling: !!(campaign.batch && campaign.batch.cancelRequested),
    });
  }

  /* ---- gap fill: reopen the named slots first ---- */

  // A failed slot stays failed. Reopening it is explicit, and it happens
  // here rather than inside the writer so that "write the campaign" can
  // never quietly retry something the customer was told had failed.
  const scope = Array.isArray(slotIndexes) && slotIndexes.length
    ? slotIndexes.map(slotNumber).filter(n => n !== null)
    : null;

  if (scope) {
    for (const index of scope) {
      await BlogCampaign.reopenSlot(campaign._id, index);
    }
  }

  /* ---- what is left to write, and what it costs ---- */

  const fresh = await BlogCampaign.findById(campaign._id);

  const inScope = (fresh.slots || []).filter(s => !scope || scope.includes(s.index));
  const toWrite = inScope.filter(s => s.status === 'pending');

  if (!toWrite.length) {
    const remaining = (fresh.slots || []).filter(s => s.status === 'ready').length;

    // Nothing to do is a success, not an error: the plugin polls this and
    // needs a terminal answer it can act on.
    return answer({
      status: 'written',
      written: (fresh.slots || []).filter(s => WRITTEN.includes(s.status)).length,
      failed: (fresh.slots || []).filter(s => s.status === 'failed').map(s => s.index),
      readyToCollect: remaining,
      total: fresh.slots.length,
    });
  }

  const quote = quotePosts(toWrite.length);
  const user = await User.findById(fresh.user).lean();
  const available = Number(user?.credits || 0);

  if (available < quote.total) {
    // REFUSED, not reported. This is the difference between the old design
    // and this one: a batch allowed to start underfunded writes four posts,
    // stops, and leaves a ring with a hole in it that the customer paid for.
    log.info('blog.write.refused', {
      requestId,
      campaignId: String(campaign._id),
      needs: quote.total,
      has: available,
    });

    return refuse(
      `This campaign needs ${quote.total} credits and you have ${available}.`,
      402,
      {
        creditsError: true,
        quote,
        creditsAvailable: available,

        // Where to fix it.
        //
        // This is the most common wall a self-serve customer hits, and until
        // now it was a dead end: WordPress showed them the shortfall and
        // nothing else. They are standing in wp-admin on their own site, and
        // nothing on that screen says the balance lives somewhere else, let
        // alone where. Sent as an absolute URL because the plugin has no idea
        // what this server's address is beyond the one it was configured
        // with, and building it there would guess wrong on every custom
        // domain.
        buyCreditsUrl: `${baseUrl}/buy-credits`,
      }
    );
  }

  /* ---- start it ---- */

  const job = await Job.create({
    user: fresh.user,
    kind: 'blog',
    status: 'queued',
    payload: {
      campaignId: String(fresh._id),
      ...(scope ? { slotIndexes: scope } : {}),
    },
    progress: {
      // The SCOPE, not the number left to write.
      //
      // writeCampaign counts everything in scope and seeds `done` with what
      // is already written, so a re-approval of a half-written campaign
      // reports 9 of 12 rather than 0 of 3. If this said 3, the first
      // response and every poll after it would disagree about the
      // denominator, and the progress bar would jump the moment the job
      // started.
      total: inScope.length,
      done: 0,
      stage: 'queued',
      current: toWrite[0]?.topic || '',
    },
  });

  // Conditional on the campaign NOT already being in 'writing', so two
  // approvals arriving together cannot both enqueue a batch. The loser
  // deletes its job and reports the winner's progress.
  const claimed = await BlogCampaign.findOneAndUpdate(
    { _id: fresh._id, status: { $ne: 'writing' } },
    { $set: { status: 'writing', 'batch.job': job._id, 'batch.startedAt': new Date() } },
    { new: true }
  );

  if (!claimed) {
    await Job.deleteOne({ _id: job._id });

    log.info('blog.write.raceLost', {
      requestId, campaignId: String(campaign._id),
    });

    return answer({ status: 'writing', done: 0, total: inScope.length, stage: 'queued' });
  }

  log.info('blog.write.queued', {
    requestId,
    campaignId: String(campaign._id),
    jobId: String(job._id),
    posts: toWrite.length,
    estimatedCredits: quote.total,
  });

  return answer({
    status: 'writing',
    jobId: String(job._id),
    done: 0,
    total: inScope.length,
    // What this run will actually write and charge for, which is not the
    // same number when a partly written campaign is approved again.
    toWrite: toWrite.length,
    stage: 'queued',
    quote,
  });
}

module.exports = { approveCampaign, WRITTEN };
