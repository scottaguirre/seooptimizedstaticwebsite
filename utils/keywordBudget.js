// utils/keywordBudget.js
//
// A daily ceiling on how much of the DataForSEO balance one customer can
// spend.
//
// WHY A CAP AND NOT A PRICE
//
// This was the alternative to charging credits, and the numbers are what
// decided it. The cache is keyed by trade, town and month and is shared
// across every customer — so the second plumber asking about Austin pays
// nothing. Cost scales with DISTINCT town-and-trade combinations, not with
// customers: a hundred contractors in Texas metros cost roughly what one
// does.
//
// Charging credits would put friction on the feature that sells websites, to
// recover a cost that mostly is not there. What IS there is the risk of one
// person working through towns at $0.09 a time — and a cap handles that
// without touching anybody who is using the tool as intended.
//
// The number: on 23 September, three and a half hours of deliberate testing
// produced 30 paid lookups. A customer researching one town properly uses
// five to ten. Twenty is comfortably above real use and well below anything
// that could hurt.
//
// WHY ONLY PAID LOOKUPS COUNT
//
// A cache hit costs nothing, so spending an allowance on one would mean
// punishing the customer who arrived second — exactly the person the cache
// was built to serve for free. Only a lookup that actually reached
// DataForSEO is recorded. See recordSpend, which the routes call after the
// fact rather than before.
//
// WHAT THIS DELIBERATELY IS NOT
//
// EXACT. It checks, then charges, so two requests racing each other can both
// pass a check at 19 and leave the customer on 21. Making it exact means
// incrementing first and refunding on a cache hit, which is more moving
// parts than a spend guard is worth: the failure it prevents is somebody
// working through three hundred towns, not somebody getting a twenty-first.

/** The ceiling. Overridable without a deploy, because the right number is a guess. */
const DAILY_LIMIT = Number(process.env.KEYWORD_DAILY_LIMIT) || 20;

/**
 * Who the cap does not apply to.
 *
 * Edwin's own testing ran 30 paid lookups in an afternoon and would have hit
 * this at lunchtime. An operator locked out of their own tool mid-session
 * stops investigating, which is worse than the cost of the lookups.
 *
 * The trade is that he stops feeling the limit his customers feel — which
 * matters less now the log records what they actually use.
 */
const EXEMPT_ROLES = new Set(['admin', 'superadmin']);

/** Rows outlive the day they count, so Mongo can clear them unattended. */
const KEEP_DAYS = 2;

/**
 * The day a lookup belongs to, in UTC.
 *
 * UTC rather than the customer's timezone, which the server does not know.
 * The consequence is that the reset lands mid-evening in Texas rather than at
 * midnight — so the message never says "midnight", it says how many hours
 * are left, which is true wherever they are.
 */
function dayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/** When the current day's allowance is replaced. */
function resetsAt(now = new Date()) {
  const next = new Date(now);
  next.setUTCHours(24, 0, 0, 0);
  return next;
}

/** "in about 5 hours", for a message a customer can act on. */
function resetPhrase(now = new Date()) {
  const ms = resetsAt(now) - now;
  const hours = Math.round(ms / (60 * 60 * 1000));

  if (hours <= 1) return 'in under an hour';
  return `in about ${hours} hours`;
}

function isExempt(user) {
  return !!(user && EXEMPT_ROLES.has(String(user.role || '')));
}

function keyFor(userId, now) {
  return `${String(userId || '')}:${dayKey(now)}`;
}

/**
 * How much of today's allowance this customer has spent.
 *
 * A READ FAILURE RETURNS ZERO, on purpose. If Mongo is unreachable the choice
 * is between locking everybody out of a working feature and letting the day's
 * spending run unguarded. The cap exists to stop a slow drain, not to hold a
 * line during an outage — and an outage of the database is already visible
 * elsewhere.
 */
async function spentToday(userId, opts = {}) {
  const Model = opts.Model || require('../models/KeywordBudget');
  const now = opts.now ? opts.now() : new Date();

  if (!userId) return 0;

  try {
    const row = await Model.findOne({ key: keyFor(userId, now) }).lean();
    return (row && Number(row.count)) || 0;
  } catch (err) {
    require('./logger').log.error('keywords.budgetReadFailed', err, {
      userId: String(userId),
    });
    return 0;
  }
}

/**
 * May this customer spend again?
 *
 * @returns {{ allowed, used, limit, exempt, resetsAt, resetPhrase }}
 *   Everything the caller needs for the message, so the wording lives in one
 *   place and the route does not recompute any of it.
 */
async function checkBudget(user, opts = {}) {
  const now = opts.now ? opts.now() : new Date();
  const limit = Number(opts.limit) || DAILY_LIMIT;

  if (isExempt(user)) {
    return {
      allowed: true, exempt: true, used: 0, limit,
      resetsAt: resetsAt(now), resetPhrase: resetPhrase(now),
    };
  }

  const userId = user && user._id;
  const used = await spentToday(userId, { ...opts, now: () => now });

  return {
    allowed: used < limit,
    exempt: false,
    used,
    limit,
    resetsAt: resetsAt(now),
    resetPhrase: resetPhrase(now),
  };
}

/**
 * Record a lookup that actually cost money.
 *
 * CALLED AFTER THE FACT, never before, because whether a lookup costs
 * anything is not known until it comes back — a cache hit and a miss are the
 * same request until then.
 *
 * Never throws. A counter that fails to increment costs one uncounted
 * lookup; a counter that throws costs the customer the answer they just paid
 * for.
 */
async function recordSpend(user, opts = {}) {
  if (isExempt(user)) return;

  const userId = user && user._id;
  if (!userId) return;

  const Model = opts.Model || require('../models/KeywordBudget');
  const now = opts.now ? opts.now() : new Date();
  const costUsd = Number(opts.costUsd) || 0;

  // Nothing was spent, so nothing is recorded. This is the cache-hit path and
  // it is the common one.
  if (costUsd <= 0) return;

  try {
    await Model.updateOne(
      { key: keyFor(userId, now) },
      {
        $inc: { count: 1, costUsd },
        $set: {
          userId: String(userId),
          day: dayKey(now),
          expiresAt: new Date(now.getTime() + KEEP_DAYS * 24 * 60 * 60 * 1000),
        },
      },
      { upsert: true }
    );
  } catch (err) {
    require('./logger').log.error('keywords.budgetWriteFailed', err, {
      userId: String(userId),
    });
  }
}

/** What the customer is told when the day's allowance is gone. */
function limitMessage(budget) {
  return `You have used all ${budget.limit} keyword lookups for today. `
    + `More ${budget.resetPhrase}. Searches you have already run are still `
    + 'free to repeat.';
}

module.exports = {
  checkBudget,
  recordSpend,
  spentToday,
  limitMessage,
  isExempt,
  dayKey,
  resetsAt,
  resetPhrase,
  keyFor,
  DAILY_LIMIT,
  EXEMPT_ROLES,
  KEEP_DAYS,
};
