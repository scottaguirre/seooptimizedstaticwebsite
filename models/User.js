// models/User.js
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    unique: true,
    required: true,
    lowercase: true,
    trim: true
  },
  passwordHash: {
    type: String,
    required: true
  },
  credits: {
    type: Number,
    default: 0
  },
  role: {
    type: String,
    enum: ['superadmin', 'admin', 'subscriber', 'free'],  // 👈 add superadmin here
    default: 'subscriber'   // new users become "subscriber" by default
  },

  /**
   * Where this customer's generated sites get published.
   *
   * THE ID GITHUB GAVE WHEN THEY INSTALLED THE APP on their own GitHub
   * account. One number, recorded once, and everything else is derivable
   * from it: utils/github/publishSite.js trades it for an hour-long token
   * and asks GitHub which account it belongs to.
   *
   * WHY A NUMBER AND NOT A TOKEN. CloudflareAccount stores a credential the
   * customer pasted — sealed, but permanent until somebody rotates it. This
   * is not a secret. It is useless without the App's private key, and a
   * customer who uninstalls the App revokes everything by doing so. The
   * header of utils/github/app.js makes the same argument at length.
   *
   * UNSET MEANS "DO NOT PUBLISH", NOT "FAIL". A Local Website Options build
   * for a customer who has never installed the App still writes its eleven
   * pages and still charges for them; it simply has nowhere to push to, and
   * says so. Treating it as an error would break every existing account on
   * the day this shipped.
   */
  githubInstallationId: { type: String, default: '' },

  // 🔹 Email verification
  verified: { type: Boolean, default: false },

  // The original raw-token field. KEPT so accounts that signed up before the
  // hashed version shipped can still verify — their emails are already sent
  // and the links must keep working. New signups use the hashed field below.
  verificationToken: { type: String, default: null },

  /* -----------------------------------------------------------------------
   * One-time tokens, stored HASHED
   *
   * The user receives the raw token in their email; only its SHA-256 is
   * stored here. A leaked database backup then contains no working links,
   * and the lookup costs nothing extra — the incoming token is hashed and
   * matched against the index.
   * -------------------------------------------------------------------- */

  verificationTokenHash: { type: String, index: true },
  verificationExpiresAt: { type: Date },

  resetTokenHash: { type: String, index: true },
  resetExpiresAt: { type: Date },

  /**
   * When the password last changed.
   *
   * requireAuth compares this against the session's issue time and rejects
   * anything older, which is what signs a user out everywhere on reset.
   * Without that comparison this field is just a timestamp: an attacker
   * holding a session would keep it, and resetting would achieve nothing.
   */
  passwordChangedAt: { type: Date },

  createdAt: {
    type: Date,
    default: Date.now
  }
});

userSchema.methods.setPassword = async function (plain) {
  this.passwordHash = await bcrypt.hash(plain, 10);
};

userSchema.methods.validatePassword = async function (plain) {
  return bcrypt.compare(plain, this.passwordHash);
};

/**
 * Would a session issued at this time still be valid?
 *
 * Kept on the model so requireAuth and any future check share one rule
 * rather than each reimplementing the comparison.
 */
userSchema.methods.sessionIsStale = function (sessionIssuedAt) {
  if (!this.passwordChangedAt) return false;   // never reset — nothing to invalidate
  if (!sessionIssuedAt) return true;           // pre-dates the field: treat as old

  return new Date(sessionIssuedAt) < this.passwordChangedAt;
};

module.exports = mongoose.model('User', userSchema);