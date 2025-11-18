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

    // Attach user to request for later use
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).send('Authentication error');
  }
};
