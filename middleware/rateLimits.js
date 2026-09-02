// middleware/rateLimits.js
//
// Rate limiting.
//
// Two distinct problems, so two distinct limits:
//
//   AUTH      — login and signup were unlimited, so a password could be
//               brute-forced at whatever rate the network allowed.
//
//   GENERATE  — each run costs real money: ~22 OpenAI calls for a small site,
//               plus 2 ValueSERP credits. Unlimited means a single logged-in
//               user, or a stolen session, can run up a bill.
//
// Limits are per IP for auth (the user is not known yet) and per USER for
// generation (so an office behind one IP is not throttled collectively).

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

/**
 * Key by user, falling back to IP when logged out.
 *
 * ipKeyGenerator rather than req.ip directly: an IPv6 user is typically
 * allocated a whole /64 block, so keying on the raw address would let them
 * send each request from a different one and never hit the limit. The helper
 * normalises to the subnet.
 */
function userOrIp(req) {
  return req.session?.userId
    ? `u:${req.session.userId}`
    : `ip:${ipKeyGenerator(req.ip)}`;
}

/**
 * Login and signup. Deliberately tight: a real person does not attempt ten
 * logins a minute, and an attacker needs thousands.
 */
/**
 * "Please try again in 12 minutes" rather than "wait an hour".
 *
 * The window is a rolling one, so someone who hit the limit 55 minutes ago
 * only needs to wait five — telling them an hour is both wrong and likely to
 * lose them. express-rate-limit exposes the real reset time on the request,
 * so the number is available; it just was not being used.
 */
function retryMessage(req, res, what = 'requests') {
  const resetAt = req.rateLimit?.resetTime;

  if (!resetAt) {
    return `Too many ${what}. Please try again shortly.`;
  }

  const seconds = Math.max(1, Math.ceil((new Date(resetAt) - Date.now()) / 1000));

  const wait =
    seconds < 60  ? `${seconds} second${seconds === 1 ? '' : 's'}` :
    seconds < 3600 ? `${Math.ceil(seconds / 60)} minute${Math.ceil(seconds / 60) === 1 ? '' : 's'}` :
                     `${Math.ceil(seconds / 3600)} hour${Math.ceil(seconds / 3600) === 1 ? '' : 's'}`;

  return `Too many ${what}. Please try again in ${wait}.`;
}

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,   // only failed attempts count
  message: (req, res) => retryMessage(req, res, 'login attempts'),
});

/**
 * Password reset and email verification. Slower still, because these send
 * mail — an attacker could otherwise use them to spam a third party.
 */
const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,

  // Raised from 5.
  //
  // The limit is per IP, so everyone behind one address shares it — an
  // office where three people forget their password in the same morning
  // would block the fourth. 15 still stops enumeration and mail-bombing
  // while leaving room for a handful of genuine users.
  //
  // It also made local testing painful: two browsers on localhost are both
  // ::1, so they spent the same budget.
  max: Number(process.env.EMAIL_RATE_LIMIT) || 15,

  standardHeaders: true,
  legacyHeaders: false,
  // A function, not a string: it is evaluated per request, so the countdown
  // reflects that user's actual remaining time.
  message: (req, res) => retryMessage(req, res, 'password reset requests'),

  // Development is exempt. Testing a reset flow means requesting several
  // links in a row, and being locked out for an hour mid-test helps nobody.
  skip: () => process.env.NODE_ENV !== 'production',
});

/**
 * Site generation. The per-user lock in generateRoute already prevents two
 * concurrent runs; this caps the total over time, so a compromised account
 * cannot burn through an API budget overnight.
 */
const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: userOrIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: (req, res) => retryMessage(req, res, 'site generations'),
});

/**
 * Everything else. Generous — this exists to blunt scraping and accidental
 * request storms, not to inconvenience anyone.
 */
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator: userOrIp,
  standardHeaders: true,
  legacyHeaders: false,
  // Static assets are served from disk and cost nothing; counting them would
  // exhaust the budget on a single page load.
  skip: (req) => req.path.startsWith('/css/')
              || req.path.startsWith('/js/')
              || req.path.startsWith('/images/')
              || req.path.startsWith('/previews/'),
  message: (req, res) => retryMessage(req, res, 'requests'),
});

/* -------------------------------------------------------------------------
 * The Interlink Engine plugin
 *
 * Keyed by SITE, not by IP. A plugin usually runs on shared hosting, where
 * one IP is hundreds of unrelated WordPress installs — keying by IP would let
 * one busy neighbour exhaust the budget for every customer on that host, and
 * would let one customer's misbehaving plugin lock out everyone else's.
 *
 * The site id is unauthenticated at this point (the signature is checked
 * afterwards, in requireSite), so it identifies rather than authorises. That
 * is fine for a limiter: a forged id can only spend its own bucket, and an
 * absent one falls back to the IP.
 * ---------------------------------------------------------------------- */

function siteOrIp(req) {
  const siteId = req.headers['x-il-site'];
  return typeof siteId === 'string' && /^[a-f0-9]{24}$/i.test(siteId)
    ? `site:${siteId}`
    : `ip:${ipKeyGenerator(req.ip)}`;
}

/**
 * Plan, generate and complete.
 *
 * Generous, because /generate is POLLED: the plugin calls it every few
 * seconds while a post is being written, and a post takes 30-60 seconds.
 * A campaign publishing weekly makes a handful of bursts a week, so this is
 * far above any legitimate need and still well below what would cost us
 * anything — the expensive part is behind the job queue, not this endpoint.
 */
const blogApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.BLOG_API_RATE_LIMIT) || 300,
  keyGenerator: siteOrIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: (req, res) => retryMessage(req, res, 'requests'),
});

/**
 * Activation. Deliberately tight, and keyed by IP rather than site — the
 * caller has no site id yet.
 *
 * This is the only endpoint in the set that takes the licence key, which
 * makes it the only guessable surface. A key is 20 random bytes, so guessing
 * is hopeless anyway; this exists so that trying is also slow, and so the
 * attempt shows up in the logs as a rate-limit trip rather than as noise.
 */
const blogActivateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.BLOG_ACTIVATE_RATE_LIMIT) || 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: (req, res) => retryMessage(req, res, 'activation attempts'),
});

/**
 * Topic suggestion and enrichment.
 *
 * These are NOT billed — someone deciding whether the product is worth buying
 * should not be charged to find out — so this limit is the only thing standing
 * between a licence key and a free text generator.
 *
 * Ten batches an hour is far more than planning a campaign needs (a customer
 * plans once, reviews six topics, maybe regenerates twice) and far less than
 * the endpoint is worth stealing. Keyed by site, so one customer's exploration
 * never blocks another's.
 */
const blogSuggestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: Number(process.env.BLOG_SUGGEST_RATE_LIMIT) || 10,
  keyGenerator: siteOrIp,
  standardHeaders: true,
  legacyHeaders: false,
  message: (req, res) => retryMessage(req, res, 'topic requests'),
});

module.exports = {
  authLimiter,
  emailLimiter,
  generateLimiter,
  generalLimiter,
  blogApiLimiter,
  blogActivateLimiter,
  blogSuggestLimiter,
};