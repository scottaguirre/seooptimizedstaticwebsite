// middleware/requireAdmin.js
const User = require('../models/User');

module.exports = async function requireAdmin(req, res, next) {
  try {
    if (!req.session.userId) {
      return res.redirect('/login');
    }

    const user = await User.findById(req.session.userId);

    // Allow both admin and superadmin
    if (!user || (user.role !== 'admin' && user.role !== 'superadmin')){
      return res.status(403).send('Access denied — Admins only');
    }

    // attach the admin user if needed
    req.user = user;
    next();
  } catch (err) {
    console.error('requireAdmin error:', err);
    res.status(500).send('Server error');
  }
};
