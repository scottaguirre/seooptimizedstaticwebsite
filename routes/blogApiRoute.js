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
const { baseUrl } = require('../utils/baseUrl');
const { log } = require('../utils/logger');
const { parseReportedRemoval } = require('../utils/blog/removalTime');
const { readBusiness, businessChanged, mergeBusiness } = require('../utils/blog/businessShape');

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

    /* IS THIS LICENCE ALREADY LIVING SOMEWHERE ELSE?
     *
     * THIS LINE IS WHERE THE DAMAGE HAPPENS. A new secret is minted below,
     * and the moment it is, whatever install held the old one is dead — every
     * call it makes is refused, for ever, with no explanation anywhere.
     *
     * That is correct and necessary when a site is reconnecting. It is a
     * disaster when someone pastes their key into a SECOND site, which the
     * page invites by saying "each site needs its own key" and then not
     * enforcing it. It cost eight days of silently failing callbacks on a
     * real site, and the owner had no way to know: the second site worked
     * perfectly, so nothing looked wrong until a report was read closely.
     *
     * So a licence that is already registered to a different domain is
     * REFUSED, unless the request says plainly that it is being moved. The
     * refusal is not a wall — it takes one tick of a box to pass — but it
     * turns a silent, invisible, irreversible act into a deliberate one.
     *
     * Only when we have actually SEEN the other site. A row whose siteUrl was
     * never filled in, or a site that has never once called home, has nothing
     * to protect. */
    const reportedUrl = BlogSite.normaliseSiteUrl(siteUrl);
    const movingFrom = site.siteUrl && reportedUrl && site.siteUrl !== reportedUrl;

    if (movingFrom && site.lastSeenAt && !body.moveSite) {
      log.security('blog.activate.wouldDisconnect', {
        requestId: req.id,
        siteId: String(site._id),
        registeredTo: site.siteUrl,
        reported: reportedUrl,
      });

      return res.status(409).json({
        error: `This licence key is already connected to ${site.siteUrl}. `
             + 'Connecting it here will disconnect that site, and its posts will stop publishing. '
             + 'If you are moving the licence, tick "this licence is moving from another site" and save again. '
             + 'If both sites should keep working, create a second key on your account page.',
        reason: 'licence-in-use',
        registeredTo: site.siteUrl,
      });
    }

    // A NEW secret on every activation, which is what makes "deactivate and
    // reactivate" a real remedy: whatever the old install knew stops working.
    // It also means a site moved to a new host cannot be impersonated by
    // whoever still has the files on the old one.
    site.secret = BlogSite.generateSecret();
    site.siteUrl = reportedUrl;
    site.themePrefix = String(themePrefix || '').slice(0, 100);
    site.failedAuthCount = 0;
    site.lastSeenAt = new Date();

    /* Through the shared reader now. This was the ONLY place site.business
     * was ever written, which is the whole reason the planner spent months
     * choosing anchor text from a name the customer had since changed. */
    const activating = readBusiness(business);
    if (activating) site.business = mergeBusiness(site.business, activating);

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
    const isPillar = req.body.isPillar === true || req.body.isPillar === 'true';

    if (!isPillar && (!targetPage || !targetPage.url || !targetPage.keyword)) {
      return res.status(400).json({ error: 'A target page with a URL and keyword is required.' });
    }

    if (!Array.isArray(topics) || !topics.length) {
      return res.status(400).json({ error: 'At least one topic is required.' });
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
      return res.status(400).json({
        error: 'A pillar campaign needs at least two posts — they link to each other, so a single post would have no links at all.',
      });
    }

    if (topics.length > 52) {
      // A year of weekly posts. Beyond this the ring stops being a ring and
      // the plan is almost certainly a mistake.
      return res.status(400).json({ error: 'A campaign can hold at most 52 posts.' });
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
      site: req.site._id,
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
    const reportedBusiness = readBusiness(req.body.business);

    if (businessChanged(req.site.business, reportedBusiness)) {
      req.site.business = mergeBusiness(req.site.business, reportedBusiness);
      await BlogSite.updateOne({ _id: req.site._id }, { $set: { business: req.site.business } });

      log.info('blog.business.updated', {
        requestId: req.id,
        siteId: String(req.site._id),
        at: 'plan',
      });
    }

    const plan = planForCampaign({
      targetPage,
      topics,
      isPillar,
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
        buyCreditsUrl: `${baseUrl(req)}/buy-credits`,
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


/**
 * The customer removed this campaign from their WordPress.
 *
 * WHY THE SERVER NEEDS TELLING AT ALL
 *
 * "Remove campaign" in wp-admin used to wipe the local record and tell nobody.
 * The campaign lived on here reading 'active' or 'completed' forever, so the
 * history this app keeps described a site that had moved on without it — and
 * nothing could tell a campaign that finished from one the customer threw
 * away.
 *
 * THIS CHANGES NOTHING BUT A DATE. Not the status, not the slots, not what was
 * charged. See BlogCampaign.removedAt for why removal is a date rather than a
 * state of its own.
 *
 * ALWAYS 200 WHEN THE CAMPAIGN IS OURS, including when nothing was written
 * because it had already been recorded. The plugin deletes its local copy
 * immediately after calling this, so answering 4xx for "already removed"
 * would leave a customer unable to clear a campaign off their own screen over
 * bookkeeping they cannot see and did not cause.
 */
router.post('/api/blog/removed', blogApiLimiter, requireSite, async (req, res) => {
  try {
    const body = req.body || {};
    const campaign = await ownedCampaign(req, body.campaignId);

    if (!campaign) {
      // Genuinely unknown, or belongs to a different site — ownedCampaign has
      // already logged the second as a security event.
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    /* THE SITE'S OWN TIMESTAMP, AND IT IS NOT TRUSTED BLINDLY.
     *
     * The server used to stamp its own clock here, which is the right answer
     * only when the report arrives at once. It does not always: a site whose
     * licence was being refused went eight days without being heard, and six
     * campaigns ended up recorded as removed on the day the server finally
     * learned rather than the day the customer pressed the button.
     *
     * So the plugin sends the moment it happened. THIS IS CLIENT INPUT — it
     * arrives from a WordPress whose clock is not ours and whose plugin
     * anybody can edit — so it is bounded rather than believed:
     *
     *   - unparseable, or missing (an older plugin) -> our clock, as before
     *   - in the future -> our clock. Five minutes of skew is allowed
     *     because ordinary servers disagree by seconds and a removal is
     *     reported immediately; beyond that it is wrong or invented.
     *   - before the campaign existed -> our clock. A removal cannot precede
     *     the thing removed, and this is the bound that stops a bad clock
     *     writing a date that reorders the customer's own history.
     *
     * Rejection is silent on purpose. The report must still succeed: a
     * customer cannot be left unable to clear a campaign off their screen
     * because their server's clock is wrong. The log records which was used. */
    const reported = parseReportedRemoval(req.body.removedAt, campaign);
    const when = reported || new Date();

    const recorded = await BlogCampaign.markRemoved(campaign._id, when);

    log.info('blog.removed.ok', {
      requestId: req.id,
      siteId: String(req.site._id),
      campaignId: String(campaign._id),
      // false means it was already on record — a retry, or a reinstall.
      // Worth seeing in the log, not worth failing over.
      recorded,
      // Which clock the date came from. A run of 'server' here means sites
      // are not sending the time, which is what the old silence looked like.
      clock: reported ? 'site' : 'server',
    });

    res.json({ ok: true, recorded });

  } catch (err) {
    log.error('blog.removed.failed', err, { requestId: req.id });
    res.status(500).json({ error: 'Could not record that removal.' });
  }
});

/* -------------------------------------------------------------------------
 * Posts deleted from the site
 *
 * A DIFFERENT EVENT FROM /removed ABOVE, and conflating them was the bug.
 *
 *   /removed        the owner threw the CAMPAIGN away. The plan is gone; the
 *                   posts it published usually stay on the site.
 *   /posts-deleted  the owner deleted POSTS. The campaign is still there and
 *                   still running; some of what it produced is not.
 *
 * Until this existed, only the first was reported. The plugin could see a
 * deleted post — 0.4.3 taught it to — but the knowledge never left wp-admin,
 * so the blog report went on billing for posts that answered 404.
 *
 * WHY THE SLOT INDEX AND NOT THE WORDPRESS POST ID. The id is the plugin's
 * handle on its own site; the index is the identity we share. A site restored
 * from a backup renumbers its posts, and matching on wpPostId would then mark
 * the wrong slots, or none. The index cannot drift: it is fixed when the plan
 * is made and never reused.
 *
 * ALWAYS 200 WHEN THE CAMPAIGN IS OURS, including when every slot named was
 * already on record — which is the COMMON case, because the plugin's hourly
 * sweep re-reports what it still sees missing. A 4xx there would fill a
 * customer's log with failures for a system working exactly as designed.
 * ---------------------------------------------------------------------- */

// One campaign's worth, with room to spare. A campaign is a dozen posts; a
// body naming thousands of slots is not a customer tidying their blog.
const MAX_DELETED_SLOTS = 200;

router.post('/api/blog/posts-deleted', blogApiLimiter, requireSite, async (req, res) => {
  try {
    const body = req.body || {};
    const campaign = await ownedCampaign(req, body.campaignId);

    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    const slots = Array.isArray(body.slots)
      ? body.slots.slice(0, MAX_DELETED_SLOTS)
      : [];

    /* TWO SHAPES OF CALL, and the flag is what tells them apart.
     *
     *   reconcile: false   the delete hook firing. "This slot just went."
     *                      Says nothing about any other slot.
     *   reconcile: true    the hourly sweep. "These and ONLY these are
     *                      missing." Authoritative for the whole campaign.
     *
     * The second is what lets a post restored from the trash come back to
     * life here. Without it a customer who trashed a post by accident and put
     * it straight back would carry a Deleted mark against a live post
     * forever, in the document they would reach for to check a bill.
     *
     * An empty list is therefore MEANINGFUL when reconciling — it means
     * nothing is missing any more — and a mistake otherwise. */
    const reconcile = body.reconcile === true;

    if (!slots.length && !reconcile) {
      return res.status(400).json({ error: 'No slots named.' });
    }

    const recorded = await BlogCampaign.markSlotsDeleted(campaign._id, slots);
    const restored = reconcile
      ? await BlogCampaign.clearSlotsDeleted(campaign._id, slots)
      : 0;

    /* AND WHICH SLOTS ARE LIVE.
     *
     * The route's name is now narrower than its job — this reconciles slot
     * STATE, not only deletions — but it keeps the name because renaming it
     * would 404 on every plugin older than 0.7.1.
     *
     * The live half exists because /published is an EVENT with no retry: one
     * rejected call and a post that is plainly live on the customer's blog is
     * recorded here as pending, for ever. Older plugins send no `live` key at
     * all, so they are unaffected.
     *
     * AFTER the deletion handling, deliberately. If a slot appears in both
     * lists the plugin has contradicted itself, and markSlotsLive refuses to
     * resurrect a deleted slot — the deletion is the more recent truth. */
    const live = Array.isArray(body.live)
      ? await BlogCampaign.markSlotsLive(campaign._id, body.live.slice(0, MAX_DELETED_SLOTS))
      : 0;

    log.info('blog.postsDeleted.ok', {
      requestId: req.id,
      siteId: String(req.site._id),
      campaignId: String(campaign._id),
      named: slots.length,
      reconcile,
      // Usually 0 on a sweep: everything named was already known gone.
      recorded,
      restored,
      // Anything but 0 means a "this post went live" message was lost.
      live,
    });

    res.json({ ok: true, recorded, restored, live });

  } catch (err) {
    log.error('blog.postsDeleted.failed', err, { requestId: req.id });
    res.status(500).json({ error: 'Could not record those deletions.' });
  }
});

/* -------------------------------------------------------------------------
 * Which campaigns the site still has
 *
 * The slot sweep reconciles the campaigns the plugin HOLDS. This reconciles
 * which campaigns it holds at all — and those are different questions, with
 * the second one unanswerable from the first.
 *
 * /api/blog/removed reports a campaign being removed, but only from plugin
 * 0.4.4 onward. Anything removed before that was never reported and cannot be
 * recovered from anywhere: the campaign simply stops being mentioned, while
 * this side goes on counting its posts as live work. On one real site that was
 * six campaigns and fourteen published posts that existed nowhere but here.
 *
 * AN EMPTY LIST IS REFUSED, and that is the important guard. A plugin whose
 * options have been lost — a partial database restore, a botched migration, a
 * fresh install on an old domain — reports zero campaigns, which is
 * indistinguishable from a site that has genuinely removed every one. The
 * second case is already covered: each of those removals fires /removed as it
 * happens. So the ambiguous message is the one worth ignoring.
 * ---------------------------------------------------------------------- */

// Generous. A site running fifty campaigns is unusual but not suspicious; a
// body naming ten thousand ids is not a WordPress.
const MAX_PRESENT_CAMPAIGNS = 500;

router.post('/api/blog/campaigns-present', blogApiLimiter, requireSite, async (req, res) => {
  try {
    const body = req.body || {};

    /* TWO SHAPES, BECAUSE OLDER PLUGINS ARE STILL OUT THERE.
     *
     *   campaignIds: ['abc…']                      up to 0.9.0
     *   campaigns:   [{ id: 'abc…', status: '…' }] from 0.9.1
     *
     * A site running the old plugin must keep working exactly as before, and
     * silently: it is not broken, it is just older. */
    const reported = Array.isArray(body.campaigns)
      ? body.campaigns
      : (Array.isArray(body.campaignIds) ? body.campaignIds.map(id => ({ id })) : []);

    /* BEFORE THE EARLY RETURN BELOW, deliberately.
     *
     * A site with no campaigns takes that return on every run, and a site
     * that has just been renamed and has not planned anything yet is exactly
     * that site. Putting this after it would mean the rename did not reach
     * the server until the customer planned a campaign — which is the moment
     * the stale name would be used. */
    const sweptBusiness = readBusiness(body.business);

    if (businessChanged(req.site.business, sweptBusiness)) {
      const merged = mergeBusiness(req.site.business, sweptBusiness);
      await BlogSite.updateOne({ _id: req.site._id }, { $set: { business: merged } });

      log.info('blog.business.updated', {
        requestId: req.id,
        siteId: String(req.site._id),
        at: 'sweep',
      });
    }

    const seen = [];

    for (const entry of reported) {
      const id = String((entry && entry.id) || '');

      if (!/^[a-f0-9]{24}$/i.test(id)) continue;

      seen.push({ id, status: String((entry && entry.status) || '') });

      if (seen.length >= MAX_PRESENT_CAMPAIGNS) break;
    }

    const ids = seen.map(c => c.id);

    if (!ids.length) {
      // 200, not 4xx. Nothing is wrong with the site and nothing it can do
      // would change this answer — the plugin is not at fault for having no
      // campaigns, and an error here would show up in a customer's log as a
      // failure every hour forever.
      log.info('blog.campaignsPresent.skipped', {
        requestId: req.id,
        siteId: String(req.site._id),
        reason: 'empty-list',
      });
      return res.json({ ok: true, removed: 0, skipped: 'empty-list' });
    }

    const removed = await BlogCampaign.markMissingRemoved(req.site._id, ids);

    /* THE SITE IS THE AUTHORITY ON WHAT THE OWNER DID, and only on that.
     *
     * Pausing and cancelling happen in wp-admin and used to reach this side
     * not at all — no event, no sweep, nothing. So a campaign the customer
     * stopped weeks ago still read "In progress" here, and the report's
     * filter could not honestly offer either word.
     *
     * CARRIED BY THE SWEEP RATHER THAN FIRED AS AN EVENT, deliberately. This
     * codebase has lost the same fact four times to one-shot events with no
     * retry behind them — deleted posts, removed campaigns, publications. A
     * status that rides on a reconciliation is re-sent every run, so a failed
     * send costs an hour rather than being wrong forever, and it repairs
     * campaigns that drifted before this code existed. */
    const statuses = await BlogCampaign.applyReportedStatuses(req.site._id, seen);

    /* AND THEN LOOK AT THE SLOTS. The completion check used to live only in
     * /api/blog/published, but slots also become published through the live
     * reconciliation — which is how everything repaired after the orphaned
     * publish bug got there. Campaigns finished by that road stayed 'active'
     * for ever: the plugin's own screen called them Completed while the
     * account page called them In progress. Run here so the hourly sweep
     * settles it whichever road the slots took. */
    const finished = await BlogCampaign.settleFinished(req.site._id, ids);

    log.info('blog.campaignsPresent.ok', {
      requestId: req.id,
      siteId: String(req.site._id),
      present: ids.length,
      statuses,
      finished,
      // Almost always 0. Anything else is a campaign that was removed in
      // WordPress without this side ever being told.
      removed,
    });

    res.json({ ok: true, removed, statuses, finished });

  } catch (err) {
    log.error('blog.campaignsPresent.failed', err, { requestId: req.id });
    res.status(500).json({ error: 'Could not reconcile campaigns.' });
  }
});

module.exports = router;