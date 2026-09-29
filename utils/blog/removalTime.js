// utils/blog/removalTime.js
//
// When a campaign was removed, as reported by the site it was removed from.
//
// SPLIT OUT OF routes/blogApiRoute.js, for the reason reportFilters.js was:
// the route needs express, three models and a signed request before any of
// this can be reached, and every branch below is a REJECTION. A guard that
// can only be exercised through a signed HTTP request against a database is
// a guard somebody checks once and never again.
//
// Here it takes two plain values and returns a Date or null, and anything
// that can run node can ask it a question.

/**
 * A removal time reported by a site, or null when it cannot be believed.
 *
 * WHY THE SITE IS ASKED AT ALL. The server used to stamp its own clock when
 * the report arrived, which is the right answer only when the report arrives
 * at once. It does not always. A site whose licence was being refused went
 * eight days without being heard, and six campaigns were recorded as removed
 * on the day the server finally learned rather than the day the customer
 * pressed the button — a date that described the server's knowledge and was
 * read, reasonably, as a fact about the customer.
 *
 * WHY IT IS NOT BELIEVED. This arrives from a WordPress whose clock is not
 * ours, on a machine the customer administers, running a plugin anybody can
 * edit. A bad clock is the common case and a made-up value is the other one,
 * and neither should be able to write a date that reorders a customer's own
 * history. So:
 *
 *   - missing        -> null. An older plugin sends no time at all.
 *   - unparseable    -> null.
 *   - in the future  -> null, beyond five minutes of skew. Ordinary servers
 *                       disagree by seconds and a removal is reported as it
 *                       happens; further ahead than that is wrong.
 *   - before the campaign existed -> null. A removal cannot precede the
 *                       thing it removes, and this is the bound that catches
 *                       a clock set to the wrong year.
 *
 * null means "use your own clock", which is the old behaviour — so a site
 * that cannot be believed is no worse off than before the field existed.
 *
 * REJECTION IS SILENT, and the caller must still succeed. A customer cannot
 * be left unable to clear a campaign off their own screen because their
 * server's clock is wrong.
 *
 * @param {*} value      whatever arrived in the request body
 * @param {object} campaign  the campaign being removed, for its createdAt
 * @returns {Date|null}
 */
function parseReportedRemoval(value, campaign) {
  if (!value) return null;

  const when = new Date(String(value));
  if (Number.isNaN(when.getTime())) return null;

  if (when.getTime() > Date.now() + FUTURE_SKEW_MS) return null;

  const born = campaign && campaign.createdAt
    ? new Date(campaign.createdAt).getTime()
    : 0;

  if (born && !Number.isNaN(born) && when.getTime() < born) return null;

  return when;
}

/* Five minutes. Named rather than inline because the test asserts on both
 * sides of it, and a test carrying its own copy of a boundary is a test that
 * keeps passing after somebody moves it. */
const FUTURE_SKEW_MS = 5 * 60 * 1000;

module.exports = { parseReportedRemoval, FUTURE_SKEW_MS };
