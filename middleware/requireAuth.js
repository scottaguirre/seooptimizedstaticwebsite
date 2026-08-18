// middleware/requireAuth.js
const User = require('../models/User');

module.exports = async function requireAuth(req, res, next) {
  try {
    // If session or userId is missing, send to login
    if (!req.session || !req.session.userId) {
      return res.redirect('/login');
    }

    const user = await User.findById(req.session.userId);

    if (!user) {
      // If user not found, clear session just in case
      if (req.session) {
        req.session.destroy(() => {});
      }
      return res.redirect('/login');
    }

    // A password reset ends every session issued before it.
    //
    // Setting passwordChangedAt on its own does nothing: an existing session
    // still holds a valid userId and keeps working. This is the check that
    // makes the reset mean something — without it, someone resetting because
    // they had been compromised would leave the attacker logged in.
    //
    // Sessions created before issuedAt existed have no such field, so they
    // are treated as stale too. That signs out anyone who was logged in when
    // this shipped, which is the safe direction to be wrong in.
    if (user.sessionIsStale && user.sessionIsStale(req.session.issuedAt)) {
      const userId = String(user._id);

      return req.session.destroy(() => {
        try {
          const { log } = require('../utils/logger');
          log.security('auth.session.invalidated', {
            requestId: req.id,
            userId,
            reason: 'password changed',
          });
        } catch (_) { /* logging must never block the redirect */ }

        res.redirect('/login');
      });
    }

    // Attach user to request for later use
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).send('Authentication error');
  }
};