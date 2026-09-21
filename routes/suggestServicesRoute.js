// routes/suggestServicesRoute.js
//
//   POST /api/suggest-services   business type + town -> service page names
//
// WHY THIS EXISTS
//
// A Rank Fast site wants twenty-odd service pages, and until now every one of
// them was a row the customer typed by hand. Most people stop at five, not
// because five is what their business does but because the form is long. The
// site that results is smaller than the one they paid for.
//
// WHY IT REPORTS A BUDGET
//
// The list is only half the feature. Credits are checked as each row is
// added, so a customer with 300 credits who ticks eight boxes meets eight
// modals — a list that hands out rejections is worse than no list.
//
// So the server says how many boxes the balance covers and the page ticks
// exactly that many, from the top. The list is still shown in full and every
// box is still tickable: someone who wants a ninth page can tick it and buy
// the credits, which is the same path "Add page" has always taken. Nobody is
// told what they cannot have before they have seen it.
//
// WHY THE SERVER DOES THAT ARITHMETIC
//
// The page knows the balance — /api/me tells it — so it could work this out
// itself. It should not. Pricing lives in utils/pricing.js precisely so the
// number shown and the number charged cannot drift, and a second copy of
// "credits minus two hundred over one hundred" in a script tag is exactly how
// they would.
//
// WHY IT IS NOT BILLED
//
// Same reasoning as /api/blog/suggest: someone deciding how big a site to buy
// should not be charged to find out. One model call, capped by the rate limit
// below.

const express = require('express');
const router = express.Router();

const { suggestServicesLimiter } = require('../middleware/rateLimits');
const { suggestServices } = require('../utils/suggestServices');
const { affordableServicePages } = require('../utils/pricing');
const { log } = require('../utils/logger');

// The model call is not allowed to hold a connection open indefinitely; the
// customer is sitting in front of a spinner. Shorter than the blog engine's
// 90s because this is one short list, not six researched topics.
const CALL_TIMEOUT_MS = Number(process.env.SUGGEST_SERVICES_TIMEOUT_MS) || 45000;

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Names already on the form, so the list does not offer them back. */
function formRows(value) {
  return (Array.isArray(value) ? value : [])
    .map(item => String(typeof item === 'string' ? item : (item && item.name) || '').trim())
    .filter(Boolean)
    .slice(0, 60);
}

router.post('/api/suggest-services', suggestServicesLimiter, async (req, res) => {
  const businessType = String(req.body.businessType || '').trim().slice(0, 100);
  const location = String(req.body.location || '').trim().slice(0, 120);

  if (!businessType) {
    return res.status(400).json({
      error: 'Fill in the business type first, then we can suggest services.',
    });
  }

  const existing = formRows(req.body.existing);

  try {
    const { services, dropped, usage } = await withTimeout(
      suggestServices({ businessType, location }, { exclude: existing }),
      CALL_TIMEOUT_MS,
      'service suggestion'
    );

    // How many the balance covers, counting what is already on the form.
    // req.user is the server's own copy, not a number the page sent us.
    const affordable = affordableServicePages({
      credits: req.user && req.user.credits,
      siteMode: req.body.siteMode,
      servicePages: existing.length,
      locationPages: Number(req.body.locationPages) || 0,
    });

    // The token counts are here so that "is this costing me money?" can be
    // answered from the logs rather than estimated. The endpoint is free to
    // the customer, so this is the only record of what it costs to run.
    log.info('services.suggested', {
      requestId: req.id,
      userId: String(req.user && req.user._id || ''),
      businessType,
      count: services.length,
      dropped: dropped.length,
      affordable,
      inputTokens: usage && usage.input,
      outputTokens: usage && usage.output,
      totalTokens: usage && usage.total,
    });

    res.json({
      services,
      // Tick this many, from the top. Never more than were suggested.
      checked: Math.min(affordable, services.length),
      affordable,
    });

  } catch (err) {
    log.error('services.suggestFailed', err, {
      requestId: req.id,
      userId: String(req.user && req.user._id || ''),
      businessType,
    });
    res.status(502).json({
      error: 'Could not come up with service ideas just now. Please try again, '
           + 'or type your services in yourself.',
    });
  }
});

module.exports = router;
