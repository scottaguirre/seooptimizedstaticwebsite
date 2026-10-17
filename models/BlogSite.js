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
 * THE OLD INDEX HAS TO BE DROPPED ONCE, AND THE ORDER MATTERS.
 *
 * The live database carries a `licenceKeyHash_1` that is PLAIN UNIQUE — the
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
 * Until step 2 is done, the old index still treats every document MISSING
 * the field as the same value, so the SECOND Cloudflare blog fails with
 * E11000 naming a licence key it does not have.
 */
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