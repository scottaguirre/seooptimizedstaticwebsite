// middleware/securityHeaders.js
//
// Every security header this app sends, in one place that can be read by a
// test rather than only by a person.
//
// WHY IT IS NOT AN OPTIONS OBJECT INSIDE server.js ANY MORE.
//
// 19 October. helmet's CSP sets `script-src-attr 'none'` by default. This
// app overrode `script-src` with 'unsafe-inline', wrote a comment saying so,
// and never touched script-src-attr — which is a SEPARATE directive that
// 'unsafe-inline' on script-src does not cover. Every onclick= and onsubmit=
// in the app was blocked by the browser, including the confirmation prompts
// on "delete this user" and "revoke this licence". They had never once run.
//
// Nothing could have caught it while the policy lived inside an app.use()
// call: the only way to know what the browser was told was to read the
// source and reason about helmet's defaults, and reasoning about them is
// precisely what went wrong. Extracted, the real header can be produced and
// asserted — see test-inline-handlers.js.
//
// SO: ADD DIRECTIVES HERE, AND ASSERT THEM THERE. A directive that matters
// is written down even when it matches helmet's default, because a default
// is a rule nobody states and therefore a rule nobody checks their code
// against.

'use strict';

const helmet = require('helmet');

/**
 * The configured helmet middleware.
 *
 * A FUNCTION RATHER THAN A CONFIGURED INSTANCE, so a test can build it
 * fresh — hsts reads NODE_ENV, and a module-level instance would freeze
 * whatever the environment was when it was first required.
 */
function securityHeaders() {
  return helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],

      // 'unsafe-inline' is needed for the inline <script> BLOCKS: the
      // generation success page, the suggestion table, the busy-button
      // spinner, the CSV loader. Worth removing later by moving those to
      // files and adding a nonce; noted, not urgent.
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net', 'https://js.stripe.com'],

      /* AND INLINE HANDLER ATTRIBUTES STAY FORBIDDEN, WRITTEN DOWN RATHER
       * THAN INHERITED.
       *
       * This has always been helmet's default. Stating it changes nothing a
       * browser does and everything a reader can see: the line above says
       * 'unsafe-inline' in a way that reads like permission for onclick=,
       * and it is not. script-src-attr is a separate directive and
       * 'unsafe-inline' on script-src does not reach it.
       *
       * Four handlers were written in this app on the strength of that
       * misreading — three of them the confirm() prompts on deleting a user
       * and revoking a licence — and not one of them ever ran. The prompts
       * were in the source and absent from the screen.
       *
       * DELETING THIS LINE BREAKS NOTHING, and mutation testing says so:
       * helmet's default takes over and the header is byte-identical. That
       * is the point. It earns its place as the sentence a reader sees
       * next to 'unsafe-inline', not as behaviour.
       *
       * DO NOT RELAX IT TO MAKE AN onclick WORK. Bind the handler in a
       * script instead; the line above already allows that, and there is a
       * test that fails the moment an inline handler reappears. */
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],

      imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      fontSrc: ["'self'", 'data:', 'https://cdn.jsdelivr.net'],
      // jsdelivr is here only so DevTools can fetch Bootstrap's source maps.
      // Without it the console fills with CSP errors that look alarming and
      // mean nothing — which makes real errors easy to miss.
      connectSrc: ["'self'", 'https://api.stripe.com', 'https://cdn.jsdelivr.net'],

      // Generated previews embed YouTube and Google Maps
      frameSrc: [
        "'self'",
        'https://www.youtube.com',
        'https://www.google.com',
        'https://maps.google.com',
        // 3-D Secure challenges are shown in a Stripe-hosted iframe
        'https://checkout.stripe.com',
        'https://js.stripe.com',
        'https://hooks.stripe.com',
      ],

      objectSrc: ["'none'"],          // no Flash/Java applets
      baseUri: ["'self'"],            // stop <base> hijacking relative URLs
      // Stripe Checkout is a redirect to Stripe's own domain, so it must be
      // allowed here. With 'self' alone the browser silently refuses the
      // redirect and the user just stays on the page — no error, no payment.
      formAction: ["'self'", 'https://checkout.stripe.com'],
      frameAncestors: ["'self'"],     // clickjacking protection
    },
  },

  // Generated site previews load images and iframes from other origins;
  // the strict default would block them.
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },

  // Tell browsers to use HTTPS for a year. Only meaningful over HTTPS, and
  // only enabled in production so local development still works.
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: false }
    : false,
});
}

module.exports = { securityHeaders };
