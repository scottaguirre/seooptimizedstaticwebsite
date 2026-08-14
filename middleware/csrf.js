// middleware/csrf.js
//
// Cross-Site Request Forgery protection.
//
// THE ATTACK
// A logged-in user visits a hostile page. It submits a form to your site.
// The browser attaches their session cookie automatically — that is what
// cookies do — so the server sees a valid, authenticated request and acts on
// it. The user clicked nothing.
//
// WHAT ALREADY PROTECTS US
// The session cookie is sameSite: 'lax', which stops browsers sending it on
// cross-site POSTs at all. That closes the common case on any current
// browser. This adds a second layer for older browsers, and for the day
// someone changes that cookie setting without realising what it was for.
//
// WHY NOT csurf
// It is deprecated and archived. This is the synchroniser token pattern it
// implemented, in about sixty lines, with no unmaintained dependency.

const crypto = require('crypto');

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Paths that must NOT be checked.
 *
 * The Stripe webhook is a POST from Stripe's servers, not from a browser.
 * It carries no session and no token — it is authenticated by its signature
 * instead, which is a stronger check than this one.
 */
const EXEMPT = [
  '/api/stripe-webhook',
];

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Compare in constant time.
 *
 * A plain === leaks information through timing: an attacker can learn the
 * token character by character from how long the comparison takes. Unlikely
 * to be practical over a network, but the safe comparison costs nothing.
 */
function safeCompare(a, b) {
  const bufA = Buffer.from(String(a || ''), 'utf8');
  const bufB = Buffer.from(String(b || ''), 'utf8');

  // timingSafeEqual throws on length mismatch, which itself leaks length —
  // hash first so the buffers are always the same size.
  const hashA = crypto.createHash('sha256').update(bufA).digest();
  const hashB = crypto.createHash('sha256').update(bufB).digest();

  return crypto.timingSafeEqual(hashA, hashB);
}

/**
 * Issue a token for the session and expose it to templates.
 *
 * One token per session rather than per request: a per-request token breaks
 * the back button, breaks two tabs open at once, and gains little.
 */
function csrfToken(req, res, next) {
  if (!req.session) return next();

  if (!req.session.csrfToken) {
    req.session.csrfToken = generateToken();
  }

  req.csrfToken = req.session.csrfToken;

  // Ready to drop into a form
  res.locals.csrfField =
    `<input type="hidden" name="_csrf" value="${req.session.csrfToken}">`;
  res.locals.csrfToken = req.session.csrfToken;

  next();
}

/**
 * Reject unsafe requests whose token is missing or wrong.
 *
 * The token is read from the body, a header, or the query string — in that
 * order. The header matters for multipart/form-data: multer has not parsed
 * the body yet when this runs, so a form field would be invisible here.
 */
function csrfProtect(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (EXEMPT.some(path => req.path.startsWith(path))) return next();

  // No session means no token to compare against. Let it through and rely on
  // requireAuth to reject it — otherwise logging in would be impossible,
  // since the login POST happens before a session exists.
  if (!req.session) return next();

  const expected = req.session.csrfToken;
  if (!expected) {
    req.session.csrfToken = generateToken();
    return rejectCsrf(req, res);
  }

  const supplied =
    (req.body && req.body._csrf) ||
    req.headers['x-csrf-token'] ||
    (req.query && req.query._csrf);

  if (!supplied || !safeCompare(supplied, expected)) {
    return rejectCsrf(req, res);
  }

  next();
}

function rejectCsrf(req, res) {
  // Required lazily: utils/logger pulls in pino, and middleware loaded at
  // startup should not force that ordering.
  const { log } = require('../utils/logger');

  log.security('csrf.rejected', {
    requestId: req.id,
    method: req.method,
    path: req.path,
    userId: req.session?.userId,
    ip: req.ip,
  });

  const wantsJson =
    req.xhr ||
    (req.headers.accept || '').includes('application/json') ||
    (req.headers['content-type'] || '').includes('multipart/form-data');

  if (wantsJson) {
    return res.status(403).json({
      error: 'Your session expired. Please refresh the page and try again.',
      fields: [],
    });
  }

  return res.status(403).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Session expired</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-dark text-white">
  <div class="container py-5" style="max-width: 600px;">
    <h1>Session expired</h1>
    <p class="lead">
      For your security we could not verify that request. This usually means
      the page was open for a long time.
    </p>
    <a href="${req.get('Referrer') || '/'}" class="btn btn-primary mt-3">Go back and try again</a>
  </div>
</body>
</html>`);
}

module.exports = { csrfToken, csrfProtect, EXEMPT };