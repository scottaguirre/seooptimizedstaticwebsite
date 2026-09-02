// middleware/requireSite.js
//
// Authenticates a request from an Interlink Engine plugin.
//
// WHY NOT requireAuth
// requireAuth reads req.session and redirects to /login. There is no session
// here and no browser to redirect: this is one server calling another. Reusing
// it would send the plugin an HTML login page and call it a day.
//
// WHY NOT A BEARER TOKEN
// A bearer token in a header is replayable and, more to the point, is sent in
// full on every request — so it exists in the plugin's logs, any proxy in
// between, and our own access log. A signature proves possession of the secret
// without ever transmitting it.
//
// THE SCHEME
//   X-IL-Site        the site's id. Not secret; it only says who is calling.
//   X-IL-Timestamp   unix seconds, as a string
//   X-IL-Signature   hex HMAC-SHA256 over the canonical string below
//
//   canonical = timestamp + "\n" + METHOD + "\n" + path + "\n" + sha256(body)
//
// The method and path are inside the signature deliberately. Without them a
// signature captured from a harmless call could be replayed against a
// different endpoint, which is the classic way this scheme is got wrong.
//
// WHAT THE TIMESTAMP DOES AND DOES NOT DO
// It bounds replay to a five-minute window; it does not prevent it. Real
// prevention needs a nonce store rejecting any signature seen before, which
// costs a round trip to Mongo on every request. The window is the right
// trade here because these calls are not money movements — the worst a
// replayed /generate does is claim a slot that is already claimed, which the
// slot state machine rejects anyway. Revisit this if an endpoint is ever
// added whose repetition would cost something.

const crypto = require('crypto');
const BlogSite = require('../models/BlogSite');
const { log } = require('../utils/logger');

// How far apart the two clocks may be. Generous, because a WordPress host
// with a drifting clock is common and the failure is invisible to the
// customer — they just see "nothing publishes".
const MAX_SKEW_SECONDS = Number(process.env.IL_MAX_SKEW_SECONDS) || 300;

// A site that fails this many signatures in a row is either misconfigured or
// under attack. Either way, stop answering.
const MAX_FAILED_AUTH = Number(process.env.IL_MAX_FAILED_AUTH) || 50;

/**
 * The exact bytes to sign.
 *
 * The body is hashed rather than included, so the canonical string stays a
 * fixed size no matter how large the payload.
 */
function canonicalString({ timestamp, method, path, rawBody }) {
  const bodyHash = crypto
    .createHash('sha256')
    .update(rawBody && rawBody.length ? rawBody : Buffer.alloc(0))
    .digest('hex');

  return `${timestamp}\n${String(method).toUpperCase()}\n${path}\n${bodyHash}`;
}

function sign(secret, parts) {
  return crypto
    .createHmac('sha256', String(secret))
    .update(canonicalString(parts), 'utf8')
    .digest('hex');
}

/**
 * Compare two hex signatures in constant time.
 *
 * timingSafeEqual throws when the buffers differ in length, and that throw is
 * itself a timing signal, so both sides are hashed to a fixed width first.
 */
function signaturesMatch(a, b) {
  const ha = crypto.createHash('sha256').update(String(a || ''), 'utf8').digest();
  const hb = crypto.createHash('sha256').update(String(b || ''), 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

function deny(res, reason, status = 401) {
  // Deliberately vague to the caller, specific in the log. Telling a caller
  // whether the site id was unknown, the signature wrong, or the clock skewed
  // hands an attacker a debugging tool.
  return res.status(status).json({ error: 'Not authorised', reason });
}

/**
 * Verify the signature and attach the site as req.site.
 *
 * Requires req.rawBody — the unparsed bytes. server.js captures those for
 * /api/blog paths via express.json's verify hook; without it every signature
 * over a non-empty body fails, because a re-serialised object does not
 * reproduce the original bytes (key order and whitespace both differ).
 */
async function requireSite(req, res, next) {
  try {
    const siteId = String(req.headers['x-il-site'] || '');
    const timestamp = String(req.headers['x-il-timestamp'] || '');
    const signature = String(req.headers['x-il-signature'] || '');

    if (!siteId || !timestamp || !signature) {
      return deny(res, 'missing-headers');
    }

    if (!/^[a-f0-9]{24}$/i.test(siteId)) {
      // Not a possible ObjectId. Rejected before querying so a malformed id
      // cannot become a database error.
      return deny(res, 'bad-site-id');
    }

    const sent = Number(timestamp);
    if (!Number.isFinite(sent)) {
      return deny(res, 'bad-timestamp');
    }

    const skew = Math.abs(Math.floor(Date.now() / 1000) - sent);
    if (skew > MAX_SKEW_SECONDS) {
      log.security('blog.auth.clockSkew', {
        requestId: req.id, siteId, skewSeconds: skew,
      });
      return deny(res, 'clock-skew');
    }

    const site = await BlogSite.findById(siteId);
    if (!site) {
      log.security('blog.auth.unknownSite', { requestId: req.id, siteId, ip: req.ip });
      return deny(res, 'unknown-site');
    }

    if (site.status !== 'active') {
      return deny(res, `site-${site.status}`, 403);
    }

    if ((site.failedAuthCount || 0) >= MAX_FAILED_AUTH) {
      log.security('blog.auth.lockedOut', {
        requestId: req.id, siteId, failures: site.failedAuthCount,
      });
      return deny(res, 'locked', 403);
    }

    const expected = sign(site.secret, {
      timestamp,
      method: req.method,
      // req.path, not req.originalUrl: the query string is not signed, so a
      // proxy appending a cache-buster cannot invalidate a valid request.
      path: req.path,
      rawBody: req.rawBody,
    });

    if (!signaturesMatch(signature, expected)) {
      // $inc rather than save(): two bad requests at once would otherwise
      // record one failure between them.
      await BlogSite.updateOne({ _id: site._id }, { $inc: { failedAuthCount: 1 } });

      log.security('blog.auth.badSignature', {
        requestId: req.id,
        siteId,
        ip: req.ip,
        path: req.path,
      });
      return deny(res, 'bad-signature');
    }

    // Success clears both counters.
    //
    // failedAuthCount, so a customer who fixed their configuration is not
    // still locked out by failures from before the fix.
    //
    // pingFailures, because a site that just made an authenticated request is
    // demonstrably reachable and running the plugin. Our outbound pings may
    // still be failing — a firewall that blocks inbound REST calls, a host
    // that rejects our user agent — but the site is working, and the
    // scheduler should not give up on a site that is talking to us.
    await BlogSite.updateOne(
      { _id: site._id },
      { $set: { lastSeenAt: new Date(), failedAuthCount: 0, pingFailures: 0 } }
    );

    req.site = site;
    next();

  } catch (err) {
    log.error('blog.auth.failed', err, { requestId: req.id });
    return res.status(500).json({ error: 'Authentication error' });
  }
}

module.exports = {
  requireSite,
  sign,
  canonicalString,
  MAX_SKEW_SECONDS,
};