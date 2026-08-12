// middleware/requireOwnDist.js
//
// Guards /dist/user_<id>/.
//
// Previously this was `app.use('/dist', express.static(distDir))` with no
// check at all: anyone who knew or guessed a user ID could read another
// customer's generated site before they had published it. That is OWASP A01,
// broken access control, and between paying customers it is a privacy leak
// rather than a theoretical one.
//
// Admins can view any site — they need to for support — but that access is
// logged, because "the admin can see everything" should be auditable.

const { log } = require('../utils/logger');

/**
 * Pull the user id out of a /dist path.
 *   /dist/user_abc123/index.html -> 'abc123'
 * Returns null when the path is not under a user folder.
 */
function userIdFromPath(urlPath) {
  const match = String(urlPath || '').match(/^\/?user_([A-Za-z0-9]+)(\/|$)/);
  return match ? match[1] : null;
}

function requireOwnDist(req, res, next) {
  // Decode before matching: /dist/user_%61bc would otherwise slip past a
  // literal comparison.
  let urlPath;
  try {
    urlPath = decodeURIComponent(req.path);
  } catch (err) {
    return res.status(400).send('Bad request');
  }

  // Reject traversal outright rather than trying to normalise it
  if (urlPath.includes('..')) {
    return res.status(400).send('Bad request');
  }

  const targetUserId = userIdFromPath(urlPath);

  // Not a per-user path (e.g. a stray asset) — nothing to protect
  if (!targetUserId) {
    return next();
  }

  if (!req.session || !req.session.userId) {
    return res.status(401).send('Please log in to view this site.');
  }

  const sessionUserId = String(req.session.userId);

  if (sessionUserId === targetUserId) {
    return next();
  }

  // Admins may view any site for support, but leave a trail
  if (req.session.role === 'admin') {
    log.security('dist.adminAccess', {
      requestId: req.id,
      adminId: sessionUserId,
      targetUserId,
      path: urlPath,
    });
    return next();
  }

  log.security('dist.accessDenied', {
    requestId: req.id,
    userId: sessionUserId,
    targetUserId,
    path: urlPath,
  });
  return res.status(403).send('You do not have access to this site.');
}

module.exports = { requireOwnDist, userIdFromPath };