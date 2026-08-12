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
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,   // only failed attempts count
  message: 'Too many attempts. Please wait 15 minutes and try again.',
});

/**
 * Password reset and email verification. Slower still, because these send
 * mail — an attacker could otherwise use them to spam a third party.
 */
const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Please wait an hour and try again.',
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
  message: 'You have generated a lot of sites in the last hour. Please wait before generating again.',
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
  message: 'Too many requests. Please slow down.',
});

module.exports = {
  authLimiter,
  emailLimiter,
  generateLimiter,
  generalLimiter,
};