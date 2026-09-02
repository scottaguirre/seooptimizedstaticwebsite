// utils/blogPricing.js
//
// What one generated blog post costs.
//
// Separate from utils/pricing.js for now because that module prices a SITE —
// quote() takes service pages and location pages and returns a total. A post
// is a different unit with a different cost basis, and bolting it into quote()
// would mean every caller of that function has to care about a field it never
// sets. Fold the two together when there is a second thing to price per post.
//
// ONE NUMBER, ONE PLACE. The wizard's displayed price and the server's charge
// have disagreed before — see the note in helpers.js about pricing moving out
// of checkCredits for exactly that reason. Anything that shows a customer a
// price for blog posts must read it from here.

// Roughly what a 1,200-word post costs to produce: one topic call amortised
// across the batch, one content call, plus the quality pass. Set well above
// raw API cost — this is a product, not a passthrough.
const CREDITS_PER_POST = Number(process.env.BLOG_CREDITS_PER_POST) || 75;

/**
 * Price a campaign before anything is generated.
 *
 * Read-only, like checkCredits: it never mutates the user. Charging happens
 * one slot at a time, after each post actually exists.
 */
function quotePosts(count) {
  const posts = Math.max(0, Number(count) || 0);
  return {
    posts,
    creditsPerPost: CREDITS_PER_POST,
    total: posts * CREDITS_PER_POST,
  };
}

/**
 * Can this user afford one more post?
 *
 * Checked per slot rather than per campaign, and checked again inside the job
 * rather than trusted from planning time. A ten-post campaign planned in March
 * may reach its last slot in May, by which time the balance has moved.
 */
function canAffordPost(user) {
  const available = Number(user?.credits || 0);
  return {
    ok: available >= CREDITS_PER_POST,
    cost: CREDITS_PER_POST,
    available,
  };
}

module.exports = { CREDITS_PER_POST, quotePosts, canAffordPost };