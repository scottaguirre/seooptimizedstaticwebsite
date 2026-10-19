// utils/blog/callTimeout.js
//
// The backstop on a model call that never comes back.
//
// WHY IT HAS ITS OWN FILE
//
// It had one home — blogTopicsRoute.js — and two users there, /suggest and
// /enrich. Moving /suggest's rules into suggestForSite.js would have left a
// copy behind in the route for /enrich, and two copies of one timeout is
// how the two endpoints end up waiting different lengths of time without
// anybody deciding that they should.
//
// So it moved out rather than being duplicated. The copy was a regression
// the move would have introduced, not a tidy-up the move went looking for.
//
// WHAT IT IS FOR
//
// The provider SDK's own timeouts vary by version and by call. This is the
// guarantee that the caller gets an answer rather than a socket held open
// until something between us gives up — which is worse than an error,
// because a spinner that never stops tells nobody to try again.

'use strict';

const CALL_TIMEOUT_MS = Number(process.env.BLOG_TOPICS_TIMEOUT_MS) || 90000;

/**
 * Reject if `promise` has not settled within `ms`.
 *
 * The timer is ALWAYS cleared, win or lose. Without the finally, a fast
 * call still leaves a pending timer holding the event loop open for the
 * full ninety seconds — which turns a test suite that passes in a second
 * into one that sits there, and a short-lived script into one that will
 * not exit.
 */
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { withTimeout, CALL_TIMEOUT_MS };
