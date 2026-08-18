// utils/authTokens.js
//
// One-time tokens for email verification and password reset.
//
// TWO THINGS THAT MATTER
//
// 1. The token is HASHED in the database.
//    The user gets the raw value in their email; we store only its SHA-256.
//    A leaked database backup then contains no working links. This costs
//    nothing — the lookup hashes the incoming token and compares.
//
// 2. Comparison is by hash lookup, not by scanning.
//    Finding a user by the hashed token is a single indexed query, and
//    avoids the timing differences of comparing secrets one by one.

const crypto = require('crypto');

// A reset link sits in an inbox. Short, because the user is waiting for it.
const RESET_TTL_MS = 30 * 60 * 1000;          // 30 minutes

// Longer: someone signs up, gets distracted, comes back that evening. Too
// short and they return to a dead account with no way in.
const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;   // 24 hours

/**
 * @returns {{ raw: string, hashed: string, expiresAt: Date }}
 *          `raw` goes in the email; `hashed` goes in the database.
 */
function createToken(ttlMs) {
  const raw = crypto.randomBytes(32).toString('hex');

  return {
    raw,
    hashed: hashToken(raw),
    expiresAt: new Date(Date.now() + ttlMs),
  };
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw || '')).digest('hex');
}

const createResetToken = () => createToken(RESET_TTL_MS);
const createVerificationToken = () => createToken(VERIFICATION_TTL_MS);

/**
 * Is a stored expiry still valid?
 *
 * A MISSING expiry counts as valid. Accounts created before expiries
 * existed have no such field, and treating that as expired would lock out
 * everyone mid-signup at the moment this shipped.
 */
function notExpired(expiresAt) {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() > Date.now();
}

module.exports = {
  createResetToken,
  createVerificationToken,
  hashToken,
  notExpired,
  RESET_TTL_MS,
  VERIFICATION_TTL_MS,
};