// routes/blogApiRoute.js
//
// The API the Interlink Engine WordPress plugin talks to.
//
//   POST /api/blog/activate   licence key -> site id + signing secret
//   POST /api/blog/plan       create a campaign and its slots
//   POST /api/blog/generate   ask for one post; poll the same endpoint
//   POST /api/blog/complete   confirm what WordPress published
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
// THE POLLING MODEL
// Generation takes 30-60 seconds. Rather than hold a connection open — which
// the plugin's own HTTP timeout, and any proxy between us, will eventually
// cut — /generate enqueues a Job and returns immediately. The plugin calls the
// same endpoint again until it gets the post back. Calling it twice never
// generates twice: the slot is claimed atomically, and the second caller reads
// the stored result.

const express = require('express');
const router = express.Router();

const Job = require('../models/Job');
const User = require('../models/User');
const BlogSite = require('../models/BlogSite');
const BlogCampaign = require('../models/BlogCampaign');

const { requireSite } = require('../middleware/requireSite');
const { blogActivateLimiter, blogApiLimiter } = require('../middleware/rateLimits');
const { quotePosts, CREDITS_PER_POST } = require('../utils/blogPricing');
const { planForCampaign } = require('../utils/blog/campaignPlan');
const { log } = require('../utils/logger');

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
 * generated and nothing is charged here — this is the plan the customer
 * approves before any money is spent.
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
      status: 'active',
    });

    const quote = quotePosts(plan.slots.length);
    const user = await User.findById(req.site.user).lean();

    log.info('blog.plan.created', {
      requestId: req.id,
      campaignId: String(campaign._id),
      siteId: String(req.site._id),
      posts: plan.slots.length,
      estimatedCredits: quote.total,
    });

    res.json({
      campaignId: String(campaign._id),
      slots: campaign.slots.map(s => ({
        index: s.index,
        topic: s.topic,
        targetQuery: s.targetQuery,
        publishAt: s.publishAt,
        status: s.status,
      })),
      quote,
      // Shown in wp-admin so the customer knows before they start, not after
      // the third post fails.
      creditsAvailable: Number(user?.credits || 0),
      enoughCredits: Number(user?.credits || 0) >= quote.total,
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
 * Generation
 *
 * Called to start a post AND to poll for it. One endpoint, because the
 * question is the same either way: "give me the post for this slot".
 * ---------------------------------------------------------------------- */

router.post('/api/blog/generate', blogApiLimiter, requireSite, async (req, res) => {
  try {
    const { campaignId, slotIndex } = req.body || {};

    if (!/^[a-f0-9]{24}$/i.test(String(campaignId || ''))) {
      return res.status(400).json({ error: 'A valid campaignId is required.' });
    }

    const index = Number(slotIndex);
    if (!Number.isInteger(index) || index < 0) {
      return res.status(400).json({ error: 'A valid slotIndex is required.' });
    }

    const campaign = await BlogCampaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    // The signature proved which SITE is calling; this proves the campaign
    // belongs to it. Without the check, any activated site could read any
    // other customer's posts by guessing a campaign id.
    if (String(campaign.site) !== String(req.site._id)) {
      log.security('blog.generate.wrongSite', {
        requestId: req.id,
        siteId: String(req.site._id),
        campaignId: String(campaignId),
      });
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    if (campaign.status === 'paused' || campaign.status === 'cancelled') {
      return res.status(409).json({ error: `Campaign is ${campaign.status}.`, status: campaign.status });
    }

    const slot = (campaign.slots || []).find(s => s.index === index);
    if (!slot) {
      return res.status(404).json({ error: `No slot ${index} in this campaign.` });
    }

    // ---- Already done, in one direction or another ----

    if (slot.status === 'published') {
      return res.json({ status: 'published', url: slot.publishedUrl, wpPostId: slot.wpPostId });
    }

    if (slot.status === 'failed') {
      return res.status(409).json({ status: 'failed', error: slot.error || 'Generation failed.' });
    }

    // Generated and paid for, waiting to be published. THIS is the branch that
    // makes a failed publish free to retry: the post comes back from storage,
    // no OpenAI call, no charge.
    if (slot.status === 'ready') {
      const job = slot.job ? await Job.findById(slot.job).lean() : null;
      const stored = job?.result?.post;

      if (stored) {
        return res.json({ status: 'ready', post: stored, slotIndex: index });
      }

      // Marked ready but the result is gone — a job record deleted by hand, or
      // a crash between the two writes. Nothing to hand over and nothing to
      // charge again for, so say so plainly rather than silently regenerating.
      log.error('blog.generate.readyWithoutResult', new Error('Slot ready but job result missing'), {
        campaignId: String(campaignId), slotIndex: index, jobId: String(slot.job || ''),
      });
      return res.status(500).json({ error: 'The generated post could not be found. Contact support.' });
    }

    // ---- Still working ----

    if (slot.status === 'generating') {
      const job = slot.job ? await Job.findById(slot.job).lean() : null;

      if (job && job.status === 'failed') {
        return res.status(409).json({
          status: 'failed',
          error: job.error?.message || 'Generation failed.',
        });
      }

      return res.json({
        status: 'queued',
        stage: job?.progress?.stage || 'queued',
        slotIndex: index,
      });
    }

    // ---- Pending: try to claim it ----

    const job = await Job.create({
      user: campaign.user,
      kind: 'blog',
      status: 'queued',
      payload: { campaignId: String(campaign._id), slotIndex: index },
      progress: { total: 1, done: 0, stage: 'queued', current: slot.topic },
    });

    const claimed = await BlogCampaign.claimSlot(campaign._id, index, job._id);

    if (!claimed) {
      // Another request claimed it between our read and our write. Ours loses:
      // remove the job we just created so the runner never picks it up, and
      // report queued — the winner's job is doing the work.
      await Job.deleteOne({ _id: job._id });

      log.info('blog.generate.raceLost', {
        requestId: req.id, campaignId: String(campaignId), slotIndex: index,
      });

      return res.json({ status: 'queued', stage: 'queued', slotIndex: index });
    }

    log.info('blog.generate.queued', {
      requestId: req.id,
      campaignId: String(campaignId),
      slotIndex: index,
      jobId: String(job._id),
    });

    res.json({ status: 'queued', stage: 'queued', slotIndex: index });

  } catch (err) {
    log.error('blog.generate.failed', err, { requestId: req.id });
    res.status(500).json({ error: 'Could not generate that post.' });
  }
});

/* -------------------------------------------------------------------------
 * Completion
 *
 * The plugin reports what WordPress actually created. The response tells it
 * which earlier posts now need their placeholder turned into a real link.
 * ---------------------------------------------------------------------- */

router.post('/api/blog/complete', blogApiLimiter, requireSite, async (req, res) => {
  try {
    const { campaignId, slotIndex, wpPostId, url, title, slug } = req.body || {};

    const index = Number(slotIndex);
    if (!/^[a-f0-9]{24}$/i.test(String(campaignId || '')) || !Number.isInteger(index)) {
      return res.status(400).json({ error: 'campaignId and slotIndex are required.' });
    }

    const campaign = await BlogCampaign.findById(campaignId);
    if (!campaign || String(campaign.site) !== String(req.site._id)) {
      return res.status(404).json({ error: 'Campaign not found.' });
    }

    // The URL is recorded as WordPress reports it, NOT as we asked for it.
    // WordPress appends -2 to a slug that is already taken, so a link built
    // from the requested slug would 404 — which is the whole reason the
    // plugin sends this back rather than us assuming.
    const updated = await BlogCampaign.markSlotPublished(campaign._id, index, {
      wpPostId: Number(wpPostId) || undefined,
      url: String(url || ''),
      title: String(title || ''),
    });

    if (!updated) {
      // Not in 'ready'. Either already published — a duplicate confirmation,
      // which is fine — or never generated, which is not.
      const slot = (campaign.slots || []).find(s => s.index === index);

      if (slot && slot.status === 'published') {
        return res.json({ ok: true, duplicate: true, activate: [] });
      }

      return res.status(409).json({
        error: `Slot ${index} is ${slot ? slot.status : 'missing'}, not ready to publish.`,
      });
    }

    /**
     * Which published posts hold a placeholder pointing at the slot that just
     * went live.
     *
     * Post 1 shipped with a span where its link to post 2 belongs. Now post 2
     * exists and has a real URL, so post 1 can be edited and the span becomes
     * an anchor. The ring's closing link — the last post pointing back at the
     * first — is the same mechanism.
     */
    const justPublished = updated.slots.find(s => s.index === index);

    const activate = (updated.slots || [])
      .filter(s => s.status === 'published' && s.wpPostId)
      .filter(s => s.index === index - 1 || (index === 0 && s.index === updated.slots.length - 1))
      .map(s => ({
        wpPostId: s.wpPostId,
        token: `slot-${index}`,
        url: justPublished.publishedUrl,
        anchor: justPublished.publishedTitle || (justPublished.topic || ''),
      }));

    const remaining = updated.slots.filter(s => s.status === 'pending').length;
    if (!remaining && updated.status === 'active') {
      updated.status = 'completed';
      await updated.save();
    }

    log.info('blog.complete.ok', {
      requestId: req.id,
      campaignId: String(campaignId),
      slotIndex: index,
      wpPostId,
      placeholdersToActivate: activate.length,
      remaining,
    });

    res.json({ ok: true, activate, remaining });

  } catch (err) {
    log.error('blog.complete.failed', err, { requestId: req.id });
    res.status(500).json({ error: 'Could not record that post.' });
  }
});

module.exports = router;