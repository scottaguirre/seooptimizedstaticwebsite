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

  licenceKeyHash: { type: String, required: true, unique: true, index: true },

  // Shown once, at creation, so the customer can copy it into wp-admin. Kept
  // only so support can confirm "the key ending 4F2A" without being able to
  // reconstruct the key itself.
  licenceKeyLast4: { type: String, default: '' },

  secret: { type: String, required: true },

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
  lastPingAt: { type: Date },

  // Consecutive failures. Cleared by any successful ping, and by any
  // authenticated request the site makes of its own accord — a site that can
  // still talk to us is not gone, whatever our outbound attempts suggest.
  pingFailures: { type: Number, default: 0, index: true },

  // Kept so support can answer "why did my posts stop?" without reading logs.
  lastPingError: { type: String, default: '' },

  createdAt: { type: Date, default: Date.now },
});

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