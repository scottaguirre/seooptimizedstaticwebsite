// utils/baseUrl.js
//
// This app's own public address.
//
// WHY THIS IS ITS OWN FILE
//
// There were three copies of this logic — billingRoute for Stripe redirects,
// sendEmail for verification links, blogSitesRoute for the address a customer
// pastes into WordPress — and they did not agree. Two fell back to the
// request host, one fell back to the string 'http://localhost:3000'.
//
// That disagreement was not cosmetic. sendEmail has no request to fall back
// to, so with BASE_URL unset every verification email in production sent a
// new customer to http://localhost:3000/verify?token=... — a link that can
// only ever work on the machine that sent it. Nobody could finish signing up,
// and nothing anywhere logged an error: the mail sent fine, the link was
// well-formed, it just pointed at the wrong computer.
//
// So there is now one answer, and a boot check that refuses to let production
// run without it.

/** Trailing slashes make `${base}/verify` into `//verify`. */
function trim(url) {
  return String(url || '').replace(/\/+$/, '');
}

/**
 * The address to build absolute links with.
 *
 * @param {object} [req] an Express request, when one is available. Without
 *   it — a background job, an email — only BASE_URL can answer.
 */
function baseUrl(req) {
  if (process.env.BASE_URL) return trim(process.env.BASE_URL);

  // A request knows the host the customer actually reached us on, which is
  // right on localhost, right behind ngrok, and right on a custom domain
  // without anyone configuring anything.
  if (req && typeof req.get === 'function') {
    const host = req.get('host');
    if (host) return trim(`${req.protocol}://${host}`);
  }

  return 'http://localhost:3000';
}

/**
 * Refuse to start in production without BASE_URL.
 *
 * The same trade the SESSION_SECRET check makes, for the same reason: a
 * process that will not boot is a five-minute problem someone notices
 * immediately. Emails that quietly point at localhost are a problem nobody
 * notices until a customer says they never received a working link — and by
 * then every signup since the deploy has been lost.
 *
 * Called from server.js before app.listen.
 */
function requireBaseUrlInProduction() {
  if (process.env.NODE_ENV === 'production' && !process.env.BASE_URL) {
    console.error(
      'FATAL: BASE_URL is not set. Verification and password-reset emails would ' +
      'link to http://localhost:3000 and no new customer could ever finish ' +
      'signing up. Set BASE_URL=https://your-domain.com in .env and restart.'
    );
    process.exit(1);
  }
}

module.exports = { baseUrl, requireBaseUrlInProduction };
