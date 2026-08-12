// middleware/requestId.js
//
// Gives every request a short id, available as req.id and returned in the
// X-Request-Id header.
//
// Without it, a customer saying "it failed around 3pm" leaves you reading
// every line logged in that minute across every user. With it, one generation
// produces a dozen log lines that all share an id, and the customer can be
// asked for the one shown on their error page.

const crypto = require('crypto');

function requestId(req, res, next) {
  // Honour an id set by a proxy or load balancer so a request can be traced
  // across systems, but sanitise it — it arrives from outside and would
  // otherwise be written straight into the logs.
  const incoming = req.headers['x-request-id'];

  req.id = (typeof incoming === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(incoming))
    ? incoming
    : crypto.randomBytes(6).toString('hex');

  res.setHeader('X-Request-Id', req.id);
  next();
}

module.exports = { requestId };