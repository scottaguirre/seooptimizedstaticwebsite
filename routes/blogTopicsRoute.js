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

const { requireSite } = require('../middleware/requireSite');
const { blogSuggestLimiter } = require('../middleware/rateLimits');
const { buildContext } = require('../utils/blog/context');
const { enrichTopics } = require('../utils/blog/enrichTopic');
const { checkTopicSet } = require('../utils/blog/qualityCheck');
const { log } = require('../utils/logger');

/* /suggest's rules moved to utils/blog/suggestForSite.js so the Cloudflare
 * screen can reach them — it has no plugin and no signature, and requireSite
 * refuses anything that is not a WordPress site. /enrich has no second
 * caller yet and stays here.
 *
 * validTargetPage comes from there rather than being kept in both places.
 * Two copies of one validation rule is how /suggest and /enrich end up
 * disagreeing about what a target page is. */
const { suggestForSite, validTargetPage } = require('../utils/blog/suggestForSite');

// One copy, shared with suggestForSite. See callTimeout.js.
const { withTimeout, CALL_TIMEOUT_MS } = require('../utils/blog/callTimeout');

/* -------------------------------------------------------------------------
 * Suggestions
 * ---------------------------------------------------------------------- */

router.post('/api/blog/suggest', blogSuggestLimiter, requireSite, async (req, res) => {
  try {
    const result = await suggestForSite({
      site: req.site,
      body: req.body || {},
      requestId: req.id,
    });

    /* NO SPREADING, and no `if (!result.ok)` branch either: a refusal and an
     * answer are both just a code and a body here. suggestForSite turns the
     * model's own failures into a 502 itself rather than throwing, because
     * that answer is the same for every caller and two catch blocks would
     * eventually word it differently. */
    res.status(result.code).json(result.body);

  } catch (err) {
    /* STILL HERE, even though suggestForSite catches the model. This is for
     * everything it does not catch — a database that is down during the
     * already-used lookup, a bug in buildContext. Without it those become an
     * unhandled rejection and the request hangs. */
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