// models/CloudflareAccount.js
//
// One Cloudflare account this app can publish blogs into.
//
// WHY THERE IS MORE THAN ONE
//
// Cloudflare caps Pages projects at 100 per account, and the documentation
// says the limit is not routinely increased. One blog is one project, so one
// account holds one hundred blogs. Edwin manages the DNS for twenty client
// domains and wants the headroom in place before it is needed rather than a
// migration at eighty.
//
// WHY IT IS A COLLECTION AND NOT CONFIGURATION
//
// So account eleven can be added without a deploy. Twenty accounts in .env
// is twenty variables to add, a restart to apply them, and twenty live
// Cloudflare tokens sitting in one file on one server.
//
// WHAT THIS DOES NOT DO: PICK ONE
//
// A blog's account is decided by its DOMAIN, never by which account happens
// to have room. The Pages project must sit on the same account as the zone,
// or Cloudflare will not write the DNS record itself and the customer is back
// to pasting a CNAME at their registrar — which is the entire thing this
// design exists to avoid. See models/Domain.js.

const mongoose = require('mongoose');

const cloudflareAccountSchema = new mongoose.Schema({
  /**
   * What a person calls it.
   *
   * REQUIRED, because the alternative is an admin screen listing ten rows
   * of 32-character hexadecimal and an error message that says
   * "cccc3333dddd4444eeee5555ffff6666 is disabled". Every error this
   * account produces names this string.
   */
  label: { type: String, required: true, trim: true },

  /** Cloudflare's own account id, as it appears in their dashboard URL. */
  accountId: { type: String, required: true, trim: true },

  /**
   * The API token, ENCRYPTED.
   *
   * Sealed by utils/blog/cloudflare/secretBox.js, which is AES-256-GCM
   * with a key from CF_TOKEN_KEY. Not hashed: the server has to present
   * this to Cloudflare on every deploy, so it has to come back out. A
   * hashed token is a token nobody can use, including us.
   *
   * NEVER SELECTED BY DEFAULT would be the next instinct, and it is wrong
   * here — credsFor() needs it on every deploy, so `select: false` would
   * mean every real caller asking for it explicitly and one forgetting.
   * It is encrypted instead, which is the protection that actually
   * survives somebody reading the collection.
   */
  token: { type: String, required: true },

  /**
   * The last four characters of the PLAINTEXT token, for the admin screen.
   *
   * So somebody can tell which token a row holds without decrypting it,
   * and so a replaced token is visibly different. Four characters identify
   * nothing on their own — the same reasoning as the licence keys, which
   * store a hash and the last four.
   */
  tokenLast4: { type: String, default: '' },

  /**
   * Whether new blogs may be created on it, and existing ones deployed.
   *
   * DISABLING IT STOPS ITS BLOGS DEPLOYING, and that is deliberate rather
   * than an oversight. The alternative — deploy them anyway — would mean
   * the control did nothing for the blogs that already exist, which are
   * the ones somebody disabling an account is usually thinking about.
   * credsFor() throws rather than falling back to the server account.
   */
  enabled: { type: Boolean, default: true, index: true },

  /**
   * Pages projects on this account, as last counted.
   *
   * CACHED RATHER THAN ASKED FOR, because the admin screen lists every
   * account and a live count would be one Cloudflare round trip per row on
   * a page nobody wants to wait for. Refreshed when the screen asks.
   */
  projects: { type: Number, default: 0 },
  projectsCountedAt: { type: Date, default: null },

}, { timestamps: true });

/* ONE ROW PER CLOUDFLARE ACCOUNT. Two rows naming the same account id would
 * hold two tokens for one place, and nothing would say which was current. */
cloudflareAccountSchema.index({ accountId: 1 }, { unique: true });

module.exports = mongoose.models.CloudflareAccount
  || mongoose.model('CloudflareAccount', cloudflareAccountSchema);
