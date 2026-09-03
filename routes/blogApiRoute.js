// routes/blogApiRoute.js
//
// The API the Interlink Engine WordPress plugin talks to.
//
//   POST /api/blog/activate   licence key -> site id + signing secret
//   POST /api/blog/plan       cost a campaign and save it as a draft
//   POST /api/blog/write      approve it: write every post. Poll the same route
//   POST /api/blog/collect    take the written posts, a few at a time
//   POST /api/blog/complete   record what WordPress scheduled
//   POST /api/blog/published  record what WordPress later made public
//
// EVERY ROUTE HERE IS SERVER-TO-SERVER. There is no session, no CSRF token and
// no browser. /api/blog is listed in middleware/csrf.js EXEMPT for the same
// reason the Stripe webhook is: it carries no session cookie, and it is
// authenticated by a signature instead — a stronger check than a CSRF token.
//
// /activate is the one route without a signature, because the plugin has no
// secret until it succeeds. It is protected instead by the licence key itself
// and by a tight rate limit: it is the only guessable surface here.
//
// WHAT CHANGED, AND WHY THE SHAPE IS DIFFERENT
//
// This used to be built around one post at a time: /generate asked for the
// next post, the server wrote it, charged for it, and handed it back, once a
// week for twelve weeks. Two problems with that, and the second is the one
// that mattered:
//
//   - a campaign could run out of credits in week seven, with nobody watching
//   - posts written weeks apart could never be compared with each other, so
//     crossCheck() — which finds repeated sentences and shared openings —
//     could not run at all
//
// Now approval writes everything in one batch. The consequences run right
// through this file: /plan no longer starts anything, /write is where the
// money is committed and therefore where the credit gate lives, and /collect
// is a read that neither generates nor charges.
//
// THE POLLING MODEL, WHICH SURVIVES
//
// A batch takes minutes. Rather than hold a connection open — which the
// plugin's own HTTP timeout, and any proxy between us, will eventually cut —
// /write enqueues a Job and returns immediately. The plugin calls the same
// endpoint again until the batch is done. Calling it twice never starts two
// batches: the campaign's status is the lock.

const express = require('express');
const router = express.Router();

const Job = require('../models/Job');
const User = require('../models/User');
const BlogSite = require('../models/BlogSite');
const BlogCampaign = require('../models/BlogCampaign');
const BlogPost = require('../models/BlogPost');

const { requireSite } = require('../middleware/requireSite');
const { blogActivateLimiter, blogApiLimiter } = require('../middleware/rateLimits');
const { quotePosts, CREDITS_PER_POST } = require('../utils/blogPricing');
const { planForCampaign } = require('../utils/blog/campaignPlan');
const { log } = require('../utils/logger');

// How many written posts one /collect hands over. The plugin inserts them one
// at a time anyway, and a 52-post campaign returned in a single response is
// most of a megabyte of JSON through a WordPress HTTP call that may well time
// out — at which point the whole thing is retried and nothing progresses.
const COLLECT_DEFAULT = 5;
const COLLECT_MAX = 20;

/** Statuses meaning "this slot has been written and paid for". */
const WRITTEN = ['ready', 'scheduled', 'published'];

/**
 * Find a campaign this site is allowed to touch.
 *
 * The signature proved which SITE is calling; this proves the campaign belongs
 * to it. Without the check, any activated site could read any other customer's
 * posts by guessing a campaign id — and campaign ids appear in wp-admin, so
 * they are not secret.
 *
 * Returns null for both "no such campaign" and "not yours", and the caller
 * answers 404 either way. Telling the two apart would turn this into a way to
 * enumerate other people's campaigns.
 */
async function ownedCampaign(req, campaignId) {
  if (!/^[a-f0-9]{24}$/i.test(String(campaignId || ''))) return null;

  const campaign = await BlogCampaign.findById(campaignId);
  if (!campaign) return null;

  if (String(campaign.site) !== String(req.site._id)) {
    log.security('blog.wrongSite', {
      requestId: req.id,
      siteId: String(req.site._id),
      campaignId: String(campaignId),
    });
    return null;
  }

  return campaign;
}

/* -------------------------------------------------------------------------
 * Activation
 *
 * Exchanges the licence key a person typed into wp-admin for a site id and a
 * signing secret. The key is not sent again after this.
 * ---------------------------------------------------------------------- */

router.post('/api/blog/activate', blogActivateLimiter, async (req, res) => {
  try {
    const { licenceKey, siteUrl, themePrefix, business, timezone } = req.body || {};

    const site = await BlogSite.findByLicenceKey(licenceKey);

    // One response for "no such key" and "key belongs to a revoked site".
    // Distinguishing them turns this endpoint into a way to test whether a
    // guessed key exists.
    if (!site || site.status === 'revoked') {
      log.security('blog.activate.rejected', { requestId: req.id, ip: req.ip });
      return res.status(401).json({ error: 'That licence key is not valid.' });
    }

    if (site.status === 'suspended') {
      return res.status(403).json({ error: 'This licence is suspended. Please contact support.' });
    }

    // A NEW secret on every activation, which is what makes "deactivate and
    // reactivate" a real remedy: whatever the old install knew stops working.
    // It also means a site moved to a new host cannot be impersonated by
    // whoever still has the files on the old one.
    site.secret = BlogSite.generateSecret();
    site.siteUrl = BlogSite.normaliseSiteUrl(siteUrl);
    site.themePrefix = String(themePrefix || '').slice(0, 100);
    site.failedAuthCount = 0;
    site.lastSeenAt = new Date();

    if (business && typeof business === 'object') {
      site.business = {
        name: String(business.name || '').slice(0, 200),
        type: String(business.type || '').slice(0, 200),
        location: String(business.location || '').slice(0, 200),
        phone: String(business.phone || '').slice(0, 50),
      };
    }

    await site.save();

    const user = await User.findById(site.user).lean();

    log.info('blog.activate.ok', {
      requestId: req.id,
      siteId: String(site._id),
      siteUrl: site.siteUrl,
      userId: String(site.user),
    });

    res.json({
      siteId: String(site._id),
      // The only time this is ever transmitted.
      secret: site.secret,
      timezone: String(timezone || 'UTC'),
      credits: Number(user?.credits || 0),
      creditsPerPost: CREDITS_PER_POST,
    });

  } catch (err) {
    log.error('blog.activate.failed', err, { requestId: req.id });
    res.status(500).json({ error: 'Activation failed. Please try again.' });
  }
});

/* -------------------------------------------------------------------------
 * Planning
 *
 * Turns a target page and a list of topics into dated slots. Nothing is
 * written and nothing is charged here.
 *
 * IT DELIBERATELY DOES NOT BLOCK ON CREDITS. It reports whether the balance
 * covers the campaign and saves the draft either way, because planning is free
 * and a customer who plans something they cannot yet afford should be able to
 * go and buy credits without losing their work. The gate belongs at /write,
 * which is where the money is actually committed.
 * ---------------------------------------------------------------------- */

router.post('/api/blog/plan', blogApiLimiter, requireSite, async (req, res) => {
  try {
    const { targetPage, topics, schedule, linkMode, extendsCampaign, name } = req.body || {};

    if (!targetPage || !targetPage.url || !targetPage.keyword) {
      return res.status(400).json({ error: 'A target page with a URL and keyword is required.' });
    }

    if (!Array.isArray(topics) || !topics.length) {
      return res.status(400).json({ error: 'At least one topic is required.' });
    }

    if (topics.length > 52) {
      // A year of weekly posts. Beyond this the ring stops being a ring and
      // the plan is almost certainly a mistake.
      return res.status(400).json({ error: 'A campaign can hold at most 52 posts.' });
    }

    // Anchors already pointing at this page from earlier runs. Passed so the
    // planner does not reuse them: a second campaign repeating the first
    // campaign's phrases adds link volume without adding any variety, which
    // is the thing the anchor mix exists to produce.
    const priorCampaigns = await BlogCampaign.find({
      site: req.site._id,
      'targetPage.url': String(targetPage.url),
    }).select('slots.moneyAnchor').lean();

    const plan = planForCampaign({
      targetPage,
      topics,
      business: req.site.business || {},
      schedule: schedule || {},
      priorCampaigns,
      linkMode: linkMode === 'extend' ? 'extend' : 'standalone',
    });

    if (plan.conflicts && plan.conflicts.length) {
      // Refused rather than silently adjusted. A post that cannibalises the
      // page it is meant to feed is worse than no post, and the customer is
      // the one who should decide how to reword it.
      return res.status(400).json({
        error: 'Some topics would compete with the target page.',
        conflicts: plan.conflicts,
      });
    }

    const campaign = await BlogCampaign.create({
      user: req.site.user,
      site: req.site._id,
      name: String(name || '').slice(0, 200) || plan.suggestedName,
      targetPage: {
        url: String(targetPage.url),
        keyword: String(targetPage.keyword),
        intent: String(targetPage.intent || ''),
      },
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
    const user = await User.findById(req.site.user).lean();
    const available = Number(user?.credits || 0);

    log.info('blog.plan.created', {
      requestId: req.id,
      campaignId: String(campaign._id),
      siteId: String(req.site._id),
      posts: plan.slots.length,
      estimatedCredits: quote.total,
      affordable: available >= quote.total,
    });

    res.json({
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
      // Shown in wp-admin so the customer knows the whole cost before they
      // approve, rather than after the third post fails.
      creditsAvailable: available,
      enoughCredits: available >= quote.total,
      schedule: campaign.schedule,
      anchorSummary: plan.anchorSummary,
      // Not errors — several posts may end up linking with the same phrase.
      // Worth a line in wp-admin so the customer can widen the pool.
      warnings: plan.anchorWarnings,
    });

  } catch (err) {
    log.error('blog.plan.failed', err, { requestId: req.id });
    res.status(500).json({ error: 'Could not create the campaign.' });
  }
});

/* -------------------------------------------------------------------------
 * Writing
 *
 * Approve a draft and write every post in it. Called to START the batch and to
 * POLL it — one endpoint, because the question is the same either way: "is
 * this campaign written yet?"
 *
 * THIS IS THE CREDIT GATE. It is the only route here that commits money, and
 * it refuses rather than reports: a batch that starts without enough credits
 * stops half way, and half a ring is worse than no ring.
 * ---------------------------------------------------------------------- */

router.post('/api/blog/write', blogApiLimiter, requireSite, async (req, res) => {
  try {
    const { campaignId, slotIndexes } = req.body || {};

    const campaign = await ownedCampaign(req, campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    if (campaign.status === 'cancelled') {
      return res.status(409).json({ error: 'This campaign was cancelled.', status: 'cancelled' });
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

        return res.status(409).json({
          status: 'failed',
          error: job?.error?.message || 'The batch stopped. Approve the campaign again to restart it.',
        });
      }

      return res.json({
        status: 'writing',
        done: job?.progress?.done ?? 0,
        total: job?.progress?.total ?? campaign.slots.length,
        current: job?.progress?.current || '',
        stage: job?.progress?.stage || 'queued',
      });
    }

    /* ---- gap fill: reopen the named slots first ---- */

    // A failed slot stays failed. Reopening it is explicit, and it happens
    // here rather than inside the writer so that "write the campaign" can
    // never quietly retry something the customer was told had failed.
    const scope = Array.isArray(slotIndexes) && slotIndexes.length
      ? slotIndexes.map(Number).filter(Number.isInteger)
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
      return res.json({
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
        requestId: req.id,
        campaignId: String(campaign._id),
        needs: quote.total,
        has: available,
      });

      return res.status(402).json({
        error: `This campaign needs ${quote.total} credits and you have ${available}.`,
        creditsError: true,
        quote,
        creditsAvailable: available,
      });
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
        requestId: req.id, campaignId: String(campaign._id),
      });

      return res.json({ status: 'writing', done: 0, total: inScope.length, stage: 'queued' });
    }

    log.info('blog.write.queued', {
      requestId: req.id,
      campaignId: String(campaign._id),
      jobId: String(job._id),
      posts: toWrite.length,
      estimatedCredits: quote.total,
    });

    res.json({
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

  } catch (err) {
    log.error('blog.write.failed', err, { requestId: req.id });
    res.status(500).json({ error: 'Could not start writing this campaign.' });
  }
});

/* -------------------------------------------------------------------------
 * Collection
 *
 * Hand over posts that have been written. This route WRITES NOTHING and
 * CHARGES NOTHING — it is a read against BlogPost, which is why it is called
 * collect rather than generate.
 *
 * Handing the same post over twice is free and expected: a site that fails
 * half way through inserting a batch comes back and collects the rest, and the
 * ones it already has are still in 'ready' because it never confirmed them.
 * ---------------------------------------------------------------------- */

router.post('/api/blog/collect', blogApiLimiter, requireSite, async (req, res) => {
  try {
    const { campaignId, slotIndex, limit } = req.body || {};

    const campaign = await ownedCampaign(req, campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    if (campaign.status === 'paused' || campaign.status === 'cancelled') {
      return res.status(409).json({ error: `Campaign is ${campaign.status}.`, status: campaign.status });
    }

    if (campaign.status === 'writing') {
      const job = campaign.batch?.job ? await Job.findById(campaign.batch.job).lean() : null;

      return res.json({
        status: 'writing',
        done: job?.progress?.done ?? 0,
        total: job?.progress?.total ?? campaign.slots.length,
        posts: [],
      });
    }

    // One named slot, for a targeted retry.
    const wanted = Number.isInteger(Number(slotIndex))
      ? campaign.slots.filter(s => s.index === Number(slotIndex))
      : campaign.uncollectedSlots();

    const take = Math.min(
      Math.max(1, Number(limit) || COLLECT_DEFAULT),
      COLLECT_MAX
    );

    const slots = wanted
      .filter(s => s.status === 'ready')
      .sort((a, b) => a.index - b.index)
      .slice(0, take);

    if (!slots.length) {
      return res.json({
        status: 'nothing-to-collect',
        posts: [],
        scheduled: campaign.slots.filter(s => s.status === 'scheduled').length,
        failed: campaign.slots.filter(s => s.status === 'failed').map(s => s.index),
      });
    }

    const stored = await BlogPost.find({
      campaign: campaign._id,
      slotIndex: { $in: slots.map(s => s.index) },
    }).lean();

    const bySlot = new Map(stored.map(p => [p.slotIndex, p]));
    const posts = [];
    const missing = [];

    for (const slot of slots) {
      const post = bySlot.get(slot.index);

      if (!post) {
        // Marked ready but the post is gone — a document deleted by hand, or a
        // crash between storing and marking. Nothing to hand over and nothing
        // to charge again for, so it is named rather than silently skipped.
        missing.push(slot.index);
        continue;
      }

      posts.push({
        slotIndex: slot.index,
        title: post.title,
        metaDescription: post.metaDescription,
        slug: post.slug || slot.slug || '',
        sections: post.sections,
        targets: post.targets,
        // WordPress needs this as post_date to schedule the post. Sent as an
        // ISO instant; the plugin converts to site local time, because 09:00
        // has to mean nine in the morning where the business is.
        publishAt: slot.publishAt,
        missingLinks: post.missingLinks || [],
      });
    }

    if (missing.length) {
      log.error('blog.collect.readyWithoutPost', new Error('Slot ready but no stored post'), {
        campaignId: String(campaign._id),
        slots: missing,
      });
    }

    log.info('blog.collect.ok', {
      requestId: req.id,
      campaignId: String(campaign._id),
      handedOver: posts.map(p => p.slotIndex),
    });

    res.json({
      status: 'ok',
      posts,
      missing,
      // So the plugin knows whether to come back for more.
      remaining: campaign.uncollectedSlots().length - posts.length,
    });

  } catch (err) {
    log.error('blog.collect.failed', err, { requestId: req.id });
    res.status(500).json({ error: 'Could not hand over those posts.' });
  }
});

/* -------------------------------------------------------------------------
 * Scheduling confirmed
 *
 * The plugin reports what WordPress created. These are FUTURE posts: they have
 * real ids and real permalinks and are not yet public.
 *
 * An array, because the plugin inserts a whole batch and then confirms it.
 * Twelve round trips became one. The single-item form is kept for the gap-fill
 * path, which really does deal with one post.
 * ---------------------------------------------------------------------- */

router.post('/api/blog/complete', blogApiLimiter, requireSite, async (req, res) => {
  try {
    const body = req.body || {};
    const campaign = await ownedCampaign(req, body.campaignId);

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    // One or many, same handler.
    const items = Array.isArray(body.posts) && body.posts.length
      ? body.posts
      : [body];

    if (items.length > 60) {
      return res.status(400).json({ error: 'Too many posts in one confirmation.' });
    }

    const recorded = [];
    const rejected = [];

    // The same slot twice in one payload. The stale campaign document below
    // would still say 'ready' for the second copy — it was loaded before this
    // request changed anything — so without this the duplicate is reported as
    // a rejection of a slot that was just recorded successfully.
    const seen = new Set();

    for (const item of items) {
      const index = Number(item.slotIndex);
      if (!Number.isInteger(index)) {
        rejected.push({ slotIndex: item.slotIndex, reason: 'not a slot index' });
        continue;
      }

      if (seen.has(index)) {
        recorded.push(index);
        continue;
      }
      seen.add(index);

      // The URL is recorded as WordPress reports it, NOT as we asked for it.
      // WordPress appends -2 to a slug that is already taken, so a link built
      // from the requested slug would 404 — which is the whole reason the
      // plugin sends this back rather than us assuming.
      const updated = await BlogCampaign.markSlotScheduled(campaign._id, index, {
        wpPostId: Number(item.wpPostId) || undefined,
        url: String(item.url || ''),
        title: String(item.title || ''),
        scheduledFor: item.scheduledFor ? new Date(item.scheduledFor) : null,
      });

      if (updated) {
        recorded.push(index);
        continue;
      }

      // Not in 'ready'. Either already confirmed — a duplicate, which is fine —
      // or never written, which is not.
      const slot = (campaign.slots || []).find(s => s.index === index);
      const status = slot ? slot.status : 'missing';

      if (status === 'scheduled' || status === 'published') {
        recorded.push(index);
      } else {
        rejected.push({ slotIndex: index, reason: `slot is ${status}` });
      }
    }

    const after = await BlogCampaign.findById(campaign._id);

    log.info('blog.complete.ok', {
      requestId: req.id,
      campaignId: String(campaign._id),
      recorded,
      rejected: rejected.length,
    });

    res.json({
      ok: true,
      recorded,
      rejected,
      // What is still waiting to be taken. The plugin uses this to decide
      // whether to call /collect again.
      readyToCollect: after.uncollectedSlots().length,

      // NOTE: there is no `activate` list any more.
      //
      // This route used to compute which earlier post held a placeholder
      // pointing at the post that just went live, and send instructions back.
      // It cannot do that now and does not need to: nothing is public at this
      // point — these are future posts — and by the time one does publish, the
      // plugin holds every post id and every token locally. It hooks
      // future_to_publish and does the swap itself, with no round trip.
    });

  } catch (err) {
    log.error('blog.complete.failed', err, { requestId: req.id });
    res.status(500).json({ error: 'Could not record those posts.' });
  }
});

/* -------------------------------------------------------------------------
 * Publication
 *
 * WordPress has made a scheduled post public. Reported by the plugin from its
 * future_to_publish hook.
 *
 * Nothing here changes the post — the id, URL and title were settled when it
 * was created. This is bookkeeping, and it is what lets the scheduler tell a
 * post that published on time from one WP-Cron never got round to.
 * ---------------------------------------------------------------------- */

router.post('/api/blog/published', blogApiLimiter, requireSite, async (req, res) => {
  try {
    const body = req.body || {};
    const campaign = await ownedCampaign(req, body.campaignId);

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    const items = Array.isArray(body.posts) && body.posts.length ? body.posts : [body];
    const live = [];

    for (const item of items) {
      const index = Number(item.slotIndex);
      if (!Number.isInteger(index)) continue;

      const updated = await BlogCampaign.markSlotLive(
        campaign._id,
        index,
        item.publishedAt ? new Date(item.publishedAt) : new Date()
      );

      if (updated) live.push(index);
    }

    // A campaign whose last post has gone live is done. Checked here rather
    // than on a timer, because this is the only moment the answer changes.
    const after = await BlogCampaign.findById(campaign._id);
    const outstanding = (after.slots || []).filter(
      s => s.status !== 'published' && s.status !== 'failed'
    ).length;

    if (!outstanding && after.status === 'active') {
      after.status = 'completed';
      await after.save();
    }

    log.info('blog.published.ok', {
      requestId: req.id,
      campaignId: String(campaign._id),
      live,
      outstanding,
    });

    res.json({ ok: true, live, outstanding, campaignStatus: after.status });

  } catch (err) {
    log.error('blog.published.failed', err, { requestId: req.id });
    res.status(500).json({ error: 'Could not record that publication.' });
  }
});

module.exports = router;