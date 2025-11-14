// middleware/requireAuth.js
const User = require('../models/User');

module.exports = async function requireAuth(req, res, next) {
  try {
    if (!req.session.userId) {
      return res.redirect('/login');
    }

    const user = await User.findById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.redirect('/login');
    }

    // make user available downstream
    req.user = user;
    next();
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.redirect('/login');
  }
};
