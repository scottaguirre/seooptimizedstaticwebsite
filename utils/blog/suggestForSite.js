// utils/blog/suggestForSite.js
//
// Topic ideas for a site: the clamp, the avoid list and the timeout.
//
// WHY THIS IS NOT IN THE ROUTE ANY MORE
//
// It was the body of POST /api/blog/suggest, which only a signed request
// from the WordPress plugin can reach — requireSite refuses anything whose
// target is not 'wordpress' before it looks at a signature at all.
//
// The Cloudflare screen has no plugin and no signature. It plans campaigns
// for a logged-in user from a page on our own site, and it needs the same
// ideas: the same clamp, the same memory of what has already been written
// for this page, the same cap on how long that memory is allowed to get.
// The choice was to copy those rules or to move them.
//
// Copying is how two versions of one decision end up disagreeing — the
// mistake this project has paid for more than any other, and the reason
// createCampaign.js and approveCampaign.js are already here. So they moved.
//
// WHAT CHANGED IN THE MOVE: NOTHING THE PLUGIN CAN SEE
//
// Three names swapped — req.body → body, req.site → site, req.id →
// requestId — and the three ways it used to answer replaced by three ways
// it returns. No rule was rewritten, reordered or tidied on the way across.
//
// test-suggest-contract.js was written FIRST, against the handler untouched,
// and pins all of it: the two refusals, the 3/6/12 clamp, the already-used
// lookup and its scoping, the sixty cap, the keyword reaching `services`,
// the field trims, the three response keys, the review being reported and
// never enforced, the 502 that does not leak the provider's error, and the
// timeout. It passed before the move and has to pass after it.
//
// A NOTE ON CLOUDFLARE BLOGS, SINCE THEY ARE WHY THIS MOVED
//
// A Cloudflare blog carries `business: { name }` and nothing else — no
// trade, no town. buildContext puts the target page's keyword into
// `services`, and that keyword is therefore the only real subject the
// suggester gets for such a site. It works, and it is worth knowing why it
// works, because an empty keyword would produce six topics about nothing
// rather than an error.

'use strict';

const BlogCampaign = require('../../models/BlogCampaign');

const { buildContext } = require('./context');
const { suggestTopics } = require('./suggestTopics');
const { checkTopicSet } = require('./qualityCheck');
const { log } = require('../logger');

/* Shared with /api/blog/enrich, which still lives in the route. One copy,
 * so the two endpoints cannot end up waiting different lengths of time
 * without anybody deciding that they should. See callTimeout.js. */
const { withTimeout, CALL_TIMEOUT_MS } = require('./callTimeout');

/**
 * The target page, or null if there is not enough of one to work from.
 *
 * THE KEYWORD IS THE REQUIREMENT, NOT THE URL. buildContext puts the
 * keyword into `services` and every prompt reads it, so a url on its own
 * produces six topics about nothing. A keyword on its own is fine — a
 * caller that wants ideas before it has picked a page gets them.
 */
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
 * suggestTopics takes `avoid` for exactly this. Without it, a customer
 * running a second campaign for the same service page gets the same six
 * ideas back — the model has no memory of the first run.
 */
async function topicsAlreadyUsed(siteId, targetUrl) {
  if (!targetUrl) return [];

  const campaigns = await BlogCampaign.find({
    site: siteId,
    'targetPage.url': targetUrl,
  }).select('slots.topic').lean();

  return campaigns.flatMap(c => (c.slots || []).map(s => s.topic)).filter(Boolean);
}

/* Same shape as approveCampaign's, and for the same reason: `code` is the
 * HTTP status and NOTHING else, `body` is the object to send. Flattening
 * the two into one object is how a refusal carrying its own `status` key
 * ended up calling res.status('cancelled'). */
function refuse(error, code) {
  return { ok: false, code, body: { error } };
}

function answer(body) {
  return { ok: true, code: 200, body };
}

/**
 * @param {object} opts
 * @param {object} opts.site       the BlogSite the ideas are for
 * @param {object} opts.body       { targetPage, count?, avoid? }
 * @param {string} opts.requestId  for the log lines
 *
 * @returns {Promise<object>} { ok, code, body }
 *
 * DOES NOT THROW FOR A MODEL FAILURE, unlike its two siblings — and the
 * difference is deliberate rather than an oversight.
 *
 * createCampaign and approveCampaign throw, so that "the customer typed
 * something wrong" and "the database is down" cannot look the same to a
 * caller. Here there is a third thing: the model itself failing or timing
 * out, which is neither a bug nor the customer's fault and happens
 * routinely. It has one correct answer — 502, with a sentence that does not
 * repeat whatever the provider said — and that answer is the same for every
 * caller, so it belongs here rather than in two catch blocks that would
 * drift.
 */
async function suggestForSite({ site, body, requestId }) {
  const targetPage = validTargetPage(body);
  if (!targetPage) {
    return refuse('A target page with a keyword is required.', 400);
  }

  // Six is what the prompt's angle spread is tuned for — it asks for at
  // least four distinct angles, which needs room. Capped at twelve because
  // beyond that the model starts repeating itself and the customer is
  // choosing from a worse list, not a longer one.
  const count = Math.min(12, Math.max(3, Number(body.count) || 6));

  const ctx = buildContext(site, targetPage);

  const avoid = [
    ...(Array.isArray(body.avoid) ? body.avoid.map(String) : []),
    ...await topicsAlreadyUsed(site._id, targetPage.url),
  ].slice(0, 60);

  try {
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
      requestId,
      siteId: String(site._id),
      count: topics.length,
      warnings: review.warnings.length,
    });

    return answer({
      topics,
      warnings: review.warnings,
      // So the caller can say "we avoided 14 topics you have already used"
      // rather than leaving the customer wondering why the list looks
      // different from last time.
      avoided: avoid.length,
    });

  } catch (err) {
    log.error('blog.topics.suggestFailed', err, {
      requestId,
      siteId: String(site?._id || ''),
    });

    // The provider's own message is NOT repeated. It is written for us, it
    // names models and quotas, and a customer can do nothing with it.
    return refuse('Could not generate topic ideas. Please try again.', 502);
  }
}

module.exports = { suggestForSite, validTargetPage, topicsAlreadyUsed };
