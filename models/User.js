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
    default: 20
  },
  role: {
    type: String,
    enum: ['superadmin', 'admin', 'subscriber', 'free'],  // 👈 add superadmin here
    default: 'subscriber'   // new users become "subscriber" by default
  },

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