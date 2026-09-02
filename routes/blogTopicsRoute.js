// routes/blogTopicsRoute.js
//
// Topic ideas, and filling in the machinery for topics the owner typed.
//
//   POST /api/blog/suggest   keyword -> topics, with target queries
//   POST /api/blog/enrich    their own topics -> the two fields /plan requires
//
// WHY THESE EXIST AT ALL
//
// /api/blog/plan REFUSES a topic without a targetQuery, and refuses the whole
// campaign if any query would compete with the page it is meant to feed.
// Without these two endpoints the customer meets that refusal with no way to
// fix it — they typed six sentences and got back a rejection naming a field
// they have never heard of.
//
// WHY THEY ARE FREE
//
// Deliberately not billed. Someone deciding whether this product is worth
// buying should not be charged to find out, and a customer who cannot see a
// good topic will not buy any posts at all. The call is cheap and the rate
// limit caps the abuse — 10 batches an hour is far more than anyone planning a
// campaign needs and far less than a free text generator is worth stealing.
//
// WHY THEY ARE SYNCHRONOUS
//
// Unlike /generate, which enqueues a job. These take 10-30 seconds against
// /generate's 30-60, the plugin already allows a long timeout, and making them
// jobs would mean a second polling loop in the plugin for a result the
// customer is sitting and waiting for anyway.

const express = require('express');
const router = express.Router();

const BlogCampaign = require('../models/BlogCampaign');
const { requireSite } = require('../middleware/requireSite');
const { blogSuggestLimiter } = require('../middleware/rateLimits');
const { buildContext } = require('../utils/blog/context');
const { suggestTopics } = require('../utils/blog/suggestTopics');
const { enrichTopics } = require('../utils/blog/enrichTopic');
const { checkTopicSet } = require('../utils/blog/qualityCheck');
const { log } = require('../utils/logger');

// The model call is not allowed to hold a connection open indefinitely. The
// SDK's own timeouts vary; this is the backstop that guarantees the plugin
// gets an answer rather than a hung socket.
const CALL_TIMEOUT_MS = Number(process.env.BLOG_TOPICS_TIMEOUT_MS) || 90000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function validTargetPage(body) {
  const targetPage = body && body.targetPage;
  if (!targetPage || !targetPage.keyword) return null;

  return {
    url: String(targetPage.url || ''),
    keyword: String(targetPage.keyword).slice(0, 200),
    title: String(targetPage.title || '').slice(0, 200),
    intent: String(targetPage.intent || '').slice(0, 500),
  };
}

/**
 * Topics already used against this page, so a second campaign proposes
 * something new.
 *
 * suggestTopics takes `avoid` for exactly this. Without it, a customer running
 * a second campaign for the same service page gets the same six ideas back —
 * the model has no memory of the first run.
 */
async function topicsAlreadyUsed(siteId, targetUrl) {
  if (!targetUrl) return [];

  const campaigns = await BlogCampaign.find({
    site: siteId,
    'targetPage.url': targetUrl,
  }).select('slots.topic').lean();

  return campaigns.flatMap(c => (c.slots || []).map(s => s.topic)).filter(Boolean);
}

/* -------------------------------------------------------------------------
 * Suggestions
 * ---------------------------------------------------------------------- */

router.post('/api/blog/suggest', blogSuggestLimiter, requireSite, async (req, res) => {
  try {
    const targetPage = validTargetPage(req.body);
    if (!targetPage) {
      return res.status(400).json({ error: 'A target page with a keyword is required.' });
    }

    // Six is what the prompt's angle spread is tuned for — it asks for at
    // least four distinct angles, which needs room. Capped at twelve because
    // beyond that the model starts repeating itself and the customer is
    // choosing from a worse list, not a longer one.
    const count = Math.min(12, Math.max(3, Number(req.body.count) || 6));

    const ctx = buildContext(req.site, targetPage);

    const avoid = [
      ...(Array.isArray(req.body.avoid) ? req.body.avoid.map(String) : []),
      ...await topicsAlreadyUsed(req.site._id, targetPage.url),
    ].slice(0, 60);

    const topics = await withTimeout(
      suggestTopics(ctx, {
        count,
        avoid,
        model: process.env.BLOG_MODEL,
        effort: process.env.BLOG_TOPIC_EFFORT || 'medium',
        verbosity: 'low',
      }),
      CALL_TIMEOUT_MS,
      'topic suggestion'
    );

    // The same check the preview harness runs. A prompt is not a guarantee —
    // it asks for distinct queries and varied titles and does not always
    // deliver, and the topic list is the cheapest possible place to catch it.
    // Reported, never enforced: these are suggestions the customer edits.
    const review = checkTopicSet(topics, ctx.targetPage, ctx.business);

    log.info('blog.topics.suggested', {
      requestId: req.id,
      siteId: String(req.site._id),
      count: topics.length,
      warnings: review.warnings.length,
    });

    res.json({
      topics,
      warnings: review.warnings,
      // So wp-admin can say "we avoided 14 topics you have already used"
      // rather than leaving the customer wondering why the list looks
      // different from last time.
      avoided: avoid.length,
    });

  } catch (err) {
    log.error('blog.topics.suggestFailed', err, {
      requestId: req.id,
      siteId: String(req.site?._id || ''),
    });
    res.status(502).json({ error: 'Could not generate topic ideas. Please try again.' });
  }
});

/* -------------------------------------------------------------------------
 * Enrichment
 * ---------------------------------------------------------------------- */

router.post('/api/blog/enrich', blogSuggestLimiter, requireSite, async (req, res) => {
  try {
    const targetPage = validTargetPage(req.body);
    if (!targetPage) {
      return res.status(400).json({ error: 'A target page with a keyword is required.' });
    }

    const topics = (Array.isArray(req.body.topics) ? req.body.topics : [])
      .map(t => String(typeof t === 'string' ? t : (t && t.topic) || '').trim())
      .filter(Boolean)
      .slice(0, 52);

    if (!topics.length) {
      return res.status(400).json({ error: 'At least one topic is required.' });
    }

    const ctx = buildContext(req.site, targetPage);

    // Topics already in this campaign, so the model keeps its new queries
    // distinct from them. enrichTopics takes this as `existing` and it is the
    // difference between adding one topic cleanly and adding one that
    // duplicates a query already in the plan.
    const existing = Array.isArray(req.body.existing)
      ? req.body.existing
          .filter(e => e && e.targetQuery)
          .map(e => ({ topic: String(e.topic || ''), targetQuery: String(e.targetQuery) }))
          .slice(0, 60)
      : [];

    const enriched = await withTimeout(
      enrichTopics(topics, ctx, {
        existing,
        model: process.env.BLOG_MODEL,
        effort: process.env.BLOG_TOPIC_EFFORT || 'medium',
        verbosity: 'low',
      }),
      CALL_TIMEOUT_MS,
      'topic enrichment'
    );

    const review = checkTopicSet(enriched, ctx.targetPage, ctx.business);

    log.info('blog.topics.enriched', {
      requestId: req.id,
      siteId: String(req.site._id),
      count: enriched.length,
      warnings: review.warnings.length,
    });

    res.json({
      topics: enriched,
      warnings: review.warnings,
    });

  } catch (err) {
    log.error('blog.topics.enrichFailed', err, {
      requestId: req.id,
      siteId: String(req.site?._id || ''),
    });
    res.status(502).json({ error: 'Could not work out the search terms for those topics.' });
  }
});

module.exports = router;