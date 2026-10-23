// models/BlogSite.js
//
// One WordPress site running the Interlink Engine plugin.
//
// THE TRUST BOUNDARY
// The plugin runs on hardware we do not control, on a site whose owner may not
// be our customer — an agency generates the site, hands it over, and the
// business now owns the WordPress. So this record is what connects a request
// arriving from somewhere on the internet back to an account with credits.
//
// TWO SECRETS, DIFFERENT JOBS
//
//   licenceKey    typed in by a person, once, in wp-admin. Stored HASHED,
//                 like every other user-facing token in this app: a leaked
//                 database backup then contains no usable keys.
//
//   secret        used to sign every subsequent request. Stored in PLAIN
//                 TEXT, because HMAC needs the same bytes on both sides —
//                 there is no way to verify a signature against a hash.
//                 It is never typed, never emailed, and never shown twice:
//                 it is generated at activation, returned in that one
//                 response, and stored by the plugin.
//
// That asymmetry is deliberate. The licence key is the thing a human handles
// and could paste into a support ticket, so it is hashed. The secret is
// machine-to-machine and must stay recoverable, so it is protected by never
// leaving the two systems that need it.

const mongoose = require('mongoose');
const crypto = require('crypto');

/**
 * Hash a licence key for storage and lookup.
 *
 * SHA-256, not bcrypt, and deliberately so. This value is looked up on every
 * activation by an indexed equality match, and it is 32 bytes of CSPRNG
 * output — there is no dictionary to attack and no work factor worth paying.
 * bcrypt would force a full collection scan to find the matching row.
 */
function hashLicenceKey(raw) {
  return crypto.createHash('sha256').update(String(raw || ''), 'utf8').digest('hex');
}

/** A fresh licence key, in the form the customer sees. */
function generateLicenceKey() {
  // Grouped for legibility: someone will read this over the phone.
  const raw = crypto.randomBytes(20).toString('hex').toUpperCase();
  return raw.match(/.{1,8}/g).join('-');
}

/** A fresh signing secret. Never shown to a person. */
function generateSecret() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Reduce a site URL to something two spellings of the same site agree on.
 *
 * https://Example.com/ and http://example.com both become example.com. Without
 * this, a plugin that reports its URL slightly differently after an SSL change
 * would look like a second, unknown site.
 */
function normaliseSiteUrl(url) {
  return String(url || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '');
}

const blogSiteSchema = new mongoose.Schema({
  // Whose credits this site spends. Not necessarily whoever administers the
  // WordPress — an agency's account pays for their client's site.
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  /**
   * The licence key's SHA-256. WORDPRESS SITES ONLY.
   *
   * A Cloudflare blog has no plugin to paste a key into and nothing that
   * calls in, so it has no key and no hash. `required` is conditional rather
   * than removed, because a WordPress site without one would be a site the
   * plugin can never activate — created silently and broken on arrival.
   *
   * THE UNIQUE INDEX MOVED, and it had to. `unique: true` on the field
   * builds a plain unique index, and a plain unique index treats every
   * document that is MISSING the field as holding the same value — null. One
   * Cloudflare blog would have been fine; the second would have been refused
   * by a duplicate-key error naming a field it does not have.
   *
   * It is declared below as a partial index over documents where the hash is
   * actually a string. See the note there: the existing index has to be
   * replaced on the server, once, by hand.
   */
  licenceKeyHash: {
    type: String,
    required: function () { return 'cloudflare' !== this.target; },

    /* A PLAIN INDEX AS WELL AS THE PARTIAL UNIQUE ONE BELOW, and the
     * duplication is on purpose.
     *
     * The obvious tidy-up is to delete this and let the partial index serve
     * findByLicenceKey as well as enforce uniqueness. MongoDB will only use
     * a partial index for a query it can PROVE falls inside the filter, and
     * whether an equality against a string counts as proving `$type:
     * 'string'` is a planner detail rather than a documented guarantee. Get
     * it wrong and every activation becomes a collection scan — which, on a
     * table this small, nothing would ever notice.
     *
     * Two indexes on seven documents cost nothing. A silent scan that
     * appears at ten thousand costs an afternoon. */
    index: true,
  },

  // Shown once, at creation, so the customer can copy it into wp-admin. Kept
  // only so support can confirm "the key ending 4F2A" without being able to
  // reconstruct the key itself.
  licenceKeyLast4: { type: String, default: '' },

  /**
   * The HMAC signing key every inbound plugin request is verified against.
   * WORDPRESS SITES ONLY, and the absence is load-bearing.
   *
   * AN EMPTY SECRET IS NOT A SECRET. HMAC with an empty key is a function
   * anybody can compute, so a site carrying '' here could have its
   * signatures forged by anyone holding the 24 characters of its id — which
   * is not secret and travels in a header. That would be an open door to
   * /api/blog/plan and /write, which spend credits.
   *
   * So two things guard it, not one. This field is only required for a
   * WordPress site, AND middleware/requireSite.js refuses any site whose
   * target is not 'wordpress' before it looks at a signature at all. The
   * second is the real protection; this comment exists so nobody removes it
   * on the grounds that the field is optional anyway.
   */
  secret: {
    type: String,
    required: function () { return 'cloudflare' !== this.target; },
  },

  // Set on activation from what the plugin reports. Compared on every
  // subsequent request: a signature valid for site A must not authorise work
  // against site B, even with the same licence key.
  siteUrl: { type: String, default: '', index: true },

  /**
   * WHICH ARTICLE IS SERVED AT `/`. CLOUDFLARE BLOGS ONLY.
   *
   * A static blog has no listing page — Edwin, 17 October: "the same blog
   * format, no blog page". The articles are reached by their own URLs and
   * by the ring of links between them, as the plugin produces on WordPress.
   * But the bare domain still has to answer, so one article is the root.
   *
   * ON THE SITE, NOT ON THE CAMPAIGN, and that is the whole decision.
   *
   * The plugin keeps this as a per-campaign checkbox and gets away with it
   * because WordPress simply overwrites `page_on_front`. A static site
   * cannot: two files would both want to be `/`. A blog with a campaign in
   * November and another in March would have two campaigns claiming the
   * root and nothing to decide between them — you would tick the box on the
   * second and watch nothing happen, with no explanation anywhere.
   *
   * Asked of the blog, the question has exactly one answer.
   *
   * A SLUG RATHER THAN AN ID, because the slug is what the URL is built
   * from and what a person picking from a list recognises. A slug does not
   * change once the article is written.
   *
   * EMPTY IS NOT BROKEN. Until one is chosen — and a blog's first deploy
   * happens before anybody has thought about it — the renderer uses the
   * oldest live article. The same if the chosen article is deleted or has
   * not reached its publish date: the root must never 404 because of a
   * stale setting. See homeOf() in utils/blog/render/interlinks.js.
   */
  homeSlug: { type: String, default: '' },

  /**
   * The Cloudflare Pages project this blog owns. CLOUDFLARE BLOGS ONLY.
   *
   * WRITTEN ON THE FIRST SUCCESSFUL DEPLOY, and read on every one after.
   * The name is derived from the domain — leanderwaterheaters.com becomes
   * leanderwaterheaters-com — but it is STORED rather than recomputed,
   * because a blog whose domain changes must keep deploying to the project
   * it already has. Recompute it and the old project goes on serving the
   * old pages for ever while a second one quietly appears beside it.
   */
  project: { type: String, default: '' },

  // When this blog was last pushed, and where it landed. Both for the
  // screen: "last published 3 days ago" is the first thing anyone wants to
  // know, and the pages.dev URL is how you check it without a custom domain.
  lastDeployAt: { type: Date },
  lastDeployUrl: { type: String, default: '' },

  /**
   * The business's own timezone, as an IANA name. CLOUDFLARE BLOGS ONLY.
   *
   * WHY IT IS STORED RATHER THAN ASKED FOR EACH TIME. A WordPress site
   * reports its zone on every call — wp_timezone_string() — so the plugin
   * never had to keep one. A Cloudflare blog has no plugin and nothing that
   * ever calls in, so there is nowhere for the zone to come from except the
   * blog itself.
   *
   * WHAT GOES WRONG WITHOUT IT, which is not a rounding error.
   * campaignPlan.js falls back to UTC, so "post at 9" becomes 9:00 UTC —
   * four in the morning in Texas, and the single most recognisable sign of
   * an automated blog there is. Worse, it MOVES: 9:00 UTC is 4am Central in
   * October and 3am in November, because UTC does not observe daylight
   * saving and Central does. schedule.js exists precisely to hold a
   * wall-clock time steady across that boundary, and handing it UTC throws
   * all of that away.
   *
   * DEFAULT 'UTC' AND NOT ''. The empty string is not a timezone, and
   * campaignPlan.js would pass it to Intl, which throws a RangeError on
   * anything it does not recognise. isValidTimeZone() in schedule.js
   * catches that and falls back — but a default that relies on somebody
   * else's guard is a default waiting for that guard to be refactored.
   *
   * NOT VALIDATED BY MONGOOSE with an enum. The IANA list changes a few
   * times a year as countries move their clocks, and a schema enum frozen
   * at deploy time would start refusing zones that Intl itself accepts.
   * The route validates against Intl, which is the thing that has to agree.
   */
  timezone: { type: String, default: 'UTC' },

  /**
   * Google Search Console verification tokens, for this blog's own pages.
   *
   * WHY IT BELONGS TO THE BLOG AND NOT TO US. Each customer monitors their
   * own blog from their own Search Console, so the token is theirs. A
   * Domain property verified on our side — one DNS TXT record covering
   * every subdomain — would verify the blogs to US and to nobody else,
   * which is the opposite of what this is for.
   *
   * A LIST, BECAUSE GOOGLE MATCHES ANY ONE OF THEM. Two Search Console
   * properties can own one site, so a customer's token and an agency's can
   * sit on the same page: they see their blog, we see an indexing problem
   * before they report it.
   *
   * TOKENS, NOT TAGS. What arrives in the field is the whole <meta> element
   * Google puts on the clipboard; parseVerificationTags() in
   * utils/blog/verificationTags.js pulls the value out and refuses anything
   * that is not token-shaped. The renderer builds the tag itself, so
   * customer-supplied markup never reaches a published page.
   *
   * EMPTY ON EVERY BLOG THAT EXISTS TODAY, and that is a working state
   * rather than a gap: a blog nobody has verified simply renders no tag.
   */
  verificationTags: { type: [String], default: () => [] },

  /**
   * The Cloudflare account this blog's Pages project lives on.
   *
   * SET ONCE, AT CREATION, FROM THE DOMAIN THAT WAS CHOSEN — and stored
   * rather than looked up again at deploy time, for a reason worth stating.
   * A Domain row can be re-pointed at a different account later. Resolving
   * through it on every deploy would silently move an existing blog's
   * deploys to an account where its project does not exist, and Cloudflare
   * would report a missing project for a blog that has been live for
   * months.
   *
   * EMPTY MEANS THE SERVER'S OWN ACCOUNT, which is every blog created
   * before 22 October 2026. credsFor() returns undefined for those and the
   * whole chain falls back to CF_ACCOUNT_ID / CF_API_TOKEN exactly as it
   * always did. Nothing backfills them.
   *
   * A BLOG THAT NAMES AN ACCOUNT NEVER FALLS BACK. If the account is gone,
   * disabled, or its token will not decrypt, the deploy stops. See
   * utils/blog/cloudflare/accounts.js for why that is not a convenience
   * worth having.
   */
  cloudflareAccount: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CloudflareAccount',
    default: null,
    index: true,
  },

  // The active theme's PHP function prefix, e.g. 'local_business_theme'.
  // The plugin writes meta descriptions to '<prefix>_page_description' so the
  // theme's own SEO output picks them up; the server needs to know it to
  // build the post payload.
  themePrefix: { type: String, default: '' },

  // Business details captured at activation, so generated posts can mention
  // the right business without the plugin re-sending them every time.
  business: {
    name: { type: String, default: '' },
    type: { type: String, default: '' },
    location: { type: String, default: '' },
    phone: { type: String, default: '' },
  },

  /**
   * Where this site's posts actually go.
   *
   *   'wordpress'  a WordPress install running the plugin. It collects posts
   *                and inserts them itself, so our stored copy is the SECOND
   *                copy and may be dropped after a window.
   *   'cloudflare' a static blog deployed to Cloudflare Pages. There is no
   *                WordPress database — every deploy is a fresh render from
   *                Mongo — so our copy is the ONLY copy and is never dropped.
   *
   * ONE FIELD, TWO JOBS, on purpose. It picks the publishing path, and
   * utils/blog/retention.js reads the same field to decide whether an article
   * may be deleted. Two separate flags would eventually disagree, and the
   * direction they would disagree in is "delete the only copy of a static
   * blog's article".
   *
   * NO SITE EVER CHANGES TARGET. A customer's WordPress install and a static
   * blog are different products, not two modes of one, so this is set when
   * the site is created and never migrated. Code that handles a site
   * switching sides would be solving a problem that does not exist.
   */
  target: {
    type: String,
    enum: ['wordpress', 'cloudflare'],
    default: 'wordpress',
    index: true,
  },

  status: {
    type: String,
    enum: ['active', 'suspended', 'revoked'],
    default: 'active',
    index: true,
  },

  // Updated on every authenticated request. A site that has not been seen in
  // weeks either lost the plugin or lost its cron — worth surfacing before the
  // customer notices no posts appeared.
  lastSeenAt: { type: Date },

  // Rejected signatures, for spotting a key someone is guessing at. Reset on
  // any successful request.
  failedAuthCount: { type: Number, default: 0 },

  /* --- scheduler state -------------------------------------------------- */

  // Written BEFORE each ping, not after, so a request that hangs for its whole
  // timeout still blocks the next tick from pinging the same site again.
  //
  // WHICH MEANS IT RECORDS THE ATTEMPT, NOT THE OUTCOME. A screen printing it
  // as "last contacted" would show a reassuring timestamp from sixty seconds
  // ago for a site that has refused every ping for a week. It is a scheduling
  // stamp; lastPingOkAt below is the one for people.
  lastPingAt: { type: Date },

  // When a ping last actually worked. Written only by the scheduler's success
  // branch, so "we have never got through" and "we got through an hour ago"
  // are finally distinguishable. See utils/blog/pingHealth.js.
  lastPingOkAt: { type: Date },

  // Consecutive failures. Cleared by any successful ping, and by any
  // authenticated request the site makes of its own accord — a site that can
  // still talk to us is not gone, whatever our outbound attempts suggest.
  pingFailures: { type: Number, default: 0, index: true },

  // Kept so support can answer "why did my posts stop?" without reading logs.
  lastPingError: { type: String, default: '' },

  createdAt: { type: Date, default: Date.now },
});

/**
 * One licence key per site — for the sites that have one.
 *
 * PARTIAL, NOT PLAIN, and that is the whole reason this index is declared
 * here instead of on the field. A plain unique index counts every document
 * missing the field as a duplicate of every other, so the second static blog
 * ever created would be refused with a duplicate-key error about a licence
 * key it does not have. The filter limits uniqueness to documents where the
 * hash is really there.
 *
 * THE MIGRATION IS DONE — 17 OCTOBER 2026, ON THE LIVE DATABASE.
 *
 * Verified in Atlas afterwards: `licenceKeyHash_1` is back as a REGULAR
 * index with no UNIQUE property, rebuilt at the restart (its stats start
 * that day and it is 20.5 kB against the others' 36.9), and
 * `licenceKeyHash_unique` carries UNIQUE and PARTIAL. Eight indexes, all
 * READY.
 *
 * NOTHING BELOW NEEDS DOING AGAIN. It is kept because it is the only
 * record of why the two indexes exist and why they were built in that
 * order, and because the same trap waits for anyone who ever changes the
 * options on an index that is already live.
 *
 * THE OLD INDEX HAD TO BE DROPPED ONCE, AND THE ORDER MATTERED.
 *
 * The live database carried a `licenceKeyHash_1` that was PLAIN UNIQUE — the
 * field used to declare `unique: true`. Mongoose creates indexes that are
 * missing; it does not alter one that already exists with different options,
 * and it does not warn. So:
 *
 *   1. deploy this code and restart. `licenceKeyHash_unique` is created, and
 *      from that moment uniqueness is enforced by BOTH indexes.
 *   2. then, once:  db.blogsites.dropIndex('licenceKeyHash_1')
 *   3. restart again. Mongoose recreates `licenceKeyHash_1` as the plain
 *      lookup index it is now declared to be.
 *
 * IN THAT ORDER, uniqueness is never unenforced — step 1 puts the new
 * constraint in place before step 2 removes the old one. Dropping first
 * would leave a window in which two sites could take the same licence key.
 *
 * Until step 2 was done, the old index treated every document MISSING the
 * field as the same value, so the SECOND Cloudflare blog failed with E11000
 * naming a licence key it did not have. That is now fixed.
 */
/**
 * ONE BLOG PER DOMAIN, PER ACCOUNT — in the database, not only in the code.
 *
 * staticBlogsRoute already refuses a duplicate: it does a findOne before
 * creating. That is a read and a write with a gap between them, and two
 * requests arriving together both find nothing and both insert. Rare; the
 * consequence is not. Two blogs on one domain produce the same Cloudflare
 * project name, so every deploy of either one replaces the other's site —
 * and the owner sees a blog that keeps losing its articles.
 *
 * It also had to be guarded by hand in scripts/restore-blog.js, which is
 * what a guarantee living in the wrong layer looks like.
 *
 * SCOPED TO THE ACCOUNT, matching the check in the route. Making it global
 * is defensible — two accounts on one domain collide in Cloudflare just as
 * badly — but it is a product decision about whose domain it is, not a
 * correctness fix, and it would refuse the second account with no way round
 * it. Left as it is, deliberately, and worth revisiting before the first
 * customer arrives.
 *
 * PARTIAL, BECAUSE THE DEFAULT IS A STRING. siteUrl defaults to '' and a
 * WordPress site can sit there for its whole life. A plain unique index
 * would allow an account exactly ONE site with no domain and refuse the
 * next with a duplicate-key error about a field neither had filled in —
 * the licence key trap, one field over.
 *
 * `$gt: ''` AND NOT `$type: 'string'`, which is what the licence key index
 * uses: here the empty default IS a string, so the type test would exclude
 * nothing. MongoDB's comparison operators do not match across BSON types,
 * so this reads as exactly "a non-empty string".
 *
 * NAMED, FOR THE REASON BELOW. An index over these keys would otherwise be
 * born as `user_1_siteUrl_1`, and so would any other declared over the same
 * pair later.
 *
 * BEFORE THIS SHIPS: a database that already holds two blogs on one domain
 * for one account will refuse to build this index. Check with
 *   db.blogsites.aggregate([
 *     { $match: { siteUrl: { $gt: '' } } },
 *     { $group: { _id: { u: '$user', s: '$siteUrl' }, n: { $sum: 1 } } },
 *     { $match: { n: { $gt: 1 } } },
 *   ])
 * and fix the duplicates first. Mongoose logs the failure and carries on,
 * so an unbuilt index looks exactly like a built one from the application.
 */
blogSiteSchema.index(
  { user: 1, siteUrl: 1 },
  {
    name: 'user_siteUrl_unique',
    unique: true,

    /* REVOKED SITES ARE EXCLUDED, AND THAT IS NOT A LOOPHOLE — IT IS THE
     * PRODUCT RULE, FOUND BY THE INDEX REFUSING TO BUILD.
     *
     * The first version of this filter was `{ siteUrl: { $gt: '' } }` and
     * nothing more. Run against the live database it found a duplicate on
     * hilltophomeloans.net and would have silently failed to build —
     * Mongoose logs that and carries on, so an unbuilt index looks exactly
     * like a working one.
     *
     * The duplicate was correct data. activationGuards.refuseOccupiedDomain
     * already enforces one blog per domain, and it tests against OTHER
     * NON-REVOKED sites only: revoking a licence is how an owner frees a
     * domain for a new key, and the revoked record stays behind as history.
     * A plain unique index would have made that remedy impossible — the
     * second activation would fail at the database with a duplicate-key
     * error, after the guard had already decided to allow it.
     *
     * $in RATHER THAN $ne: MongoDB documents $in as valid in a partial
     * filter and does not document $ne. A filter built on an undocumented
     * operator is one that may be refused by a future server version at
     * startup, which is the worst possible moment.
     *
     * THE STATUS LIST IS THE SCHEMA'S, MINUS 'revoked'. A fourth status
     * added later will NOT be covered here, and that is the safe direction
     * to be wrong in: it loosens the index rather than refusing writes. */
    partialFilterExpression: {
      siteUrl: { $gt: '' },
      status: { $in: ['active', 'suspended'] },
    },
  }
);

blogSiteSchema.index(
  { licenceKeyHash: 1 },
  {
    /* NAMED, AND IT HAS TO BE.
     *
     * MongoDB derives an index's name from its key specification unless you
     * give it one — so this and the plain lookup index on the field above
     * would BOTH be born as `licenceKeyHash_1`. The second one to be created
     * is then refused with IndexOptionsConflict, at startup, and which of
     * the two survives depends on nothing anybody chose.
     *
     * Caught before it shipped by printing the names rather than assuming
     * them. The test below pins both. */
    name: 'licenceKeyHash_unique',
    unique: true,
    partialFilterExpression: { licenceKeyHash: { $type: 'string' } },
  }
);

/** Does this raw secret match? Constant time, so timing reveals nothing. */
blogSiteSchema.methods.secretMatches = function (candidate) {
  const a = crypto.createHash('sha256').update(String(this.secret || ''), 'utf8').digest();
  const b = crypto.createHash('sha256').update(String(candidate || ''), 'utf8').digest();
  return crypto.timingSafeEqual(a, b);
};

/**
 * Find a site by the licence key a person typed.
 *
 * Returns null for anything malformed rather than querying, so a junk value
 * cannot become a collection scan.
 */
blogSiteSchema.statics.findByLicenceKey = function (rawKey) {
  const key = String(rawKey || '').trim().toUpperCase();
  if (!key) return Promise.resolve(null);
  return this.findOne({ licenceKeyHash: hashLicenceKey(key) });
};

module.exports = mongoose.model('BlogSite', blogSiteSchema);
module.exports.hashLicenceKey = hashLicenceKey;
module.exports.generateLicenceKey = generateLicenceKey;
module.exports.generateSecret = generateSecret;
module.exports.normaliseSiteUrl = normaliseSiteUrl;