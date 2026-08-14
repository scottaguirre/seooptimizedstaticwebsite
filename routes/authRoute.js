// routes/authRoute.js
const path = require('path');
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const requireAuth = require('../middleware/requireAuth');
const { getCurrentSite } = require('../utils/currentSite');
const { log } = require('../utils/logger');
const { renderAuthPage } = require('../utils/renderAuthPage');


// GET /signup – show signup form
router.get('/signup', (req, res) => {
  res.send(renderAuthPage('signup', { csrfField: res.locals.csrfField }));
});



// POST /signup – create user
router.post('/signup', async (req, res) => {
  try {
    const { password } = req.body;

    // Cast to a string: req.body.email could be an object such as
    // { "$ne": null }, which Mongo would treat as a query operator and match
    // an arbitrary user. This is the NoSQL equivalent of SQL injection.
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!email || !password) {
      return res.status(400).send(renderAuthPage('signup', {
        csrfField: res.locals.csrfField,
        error: 'Please enter both your email and a password.',
        email,
      }));
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).send(renderAuthPage('signup', {
        csrfField: res.locals.csrfField,
        error: 'That email address already has an account.',
        email,
        action: '<div class="mt-2"><a href="/login" class="alert-link">Log in instead</a></div>',
      }));
    }

    const hashed = await bcrypt.hash(password, 10);

    // 🔹 Determine role for this new user
    const userCount = await User.countDocuments();
    const role = userCount === 0 ? 'admin' : 'free';

    // 🔹 Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');

    const user = await User.create({
      email,
      passwordHash: hashed,
      role,
      credits: role === 'admin' ? 9999 : 10, // whatever logic you like
      verified: false,
      verificationToken
    });

    // 🔹 In production you’d send an email here.
    // For now, just log the URL so you can click it in dev:
    const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
    console.log(`📧 Verify this account: ${baseUrl}/verify?token=${verificationToken}`);

    // 🔹 Do NOT log them in yet; require verification first
    res.send(`
      <h2>Account created</h2>
      <p>We sent you a verification link. Please check your email and click it to activate your account.</p>
      <p><strong>Dev only:</strong> If you're on localhost, check the server console for the verification URL.</p>
      <a href="/login">Go to Login</a>
    `);
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).send('Error signing up');
  }
});


// GET /login – show login form
router.get('/login', (req, res) => {
  // Rendered rather than sent as a file: the template now carries {{ALERT}}
  // and {{EMAIL}} placeholders which would otherwise show up literally.
  res.send(renderAuthPage('login', { csrfField: res.locals.csrfField }));
});


// POST /login – authenticate user
router.post('/login', async (req, res) => {
  try {
    const { password } = req.body;

    // Cast to a string: req.body.email could be an object such as
    // { "$ne": null }, which Mongo would treat as a query operator and match
    // an arbitrary user. This is the NoSQL equivalent of SQL injection.
    const email = String(req.body.email || '').trim().toLowerCase();

    if (!email || !password) {
      return res.status(400).send(renderAuthPage('login', {
        csrfField: res.locals.csrfField,
        error: 'Please enter both your email and password.',
        email,
      }));
    }

    const user = await User.findOne({ email });
    if (!user) {
      // Logged separately from a wrong password so repeated attempts against
      // addresses that do not exist stand out as enumeration.
      log.security('auth.login.unknownEmail', { requestId: req.id, ip: req.ip });
      // Deliberately the same message as a wrong password: saying "no account
      // with that email" tells an attacker which addresses exist. The logs
      // above distinguish the two; the page does not.
      return res.status(400).send(renderAuthPage('login', {
        csrfField: res.locals.csrfField,
        error: 'Invalid email or password.',
        email,
      }));
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      log.security('auth.login.wrongPassword', {
        requestId: req.id,
        userId: String(user._id),
        ip: req.ip,
      });
      return res.status(400).send(renderAuthPage('login', {
        csrfField: res.locals.csrfField,
        error: 'Invalid email or password.',
        email,
      }));
    }

    // 🔹 Block login if not verified
    if (!user.verified) {
      log.security('auth.login.unverified', {
        requestId: req.id,
        userId: String(user._id),
      });

      return res.send(renderAuthPage('login', {
        csrfField: res.locals.csrfField,
        notice: 'Please verify your email address before logging in. Check your inbox for the verification link.',
        email,
        action: '<div class="mt-2"><a href="/resend-verification" class="alert-link">Send it again</a></div>',
      }));
    }

    // 🔹 OK, verified → log in
    //
    // Regenerate the session id first. Without this, an attacker who can set
    // a victim's session cookie before login (session fixation) keeps a valid
    // session afterwards — they knew the id all along, and it never changed.
    req.session.regenerate((err) => {
      if (err) {
        console.error('Session regeneration failed:', err);
        return res.status(500).send('Something went wrong. Please try again.');
      }

      req.session.userId = user._id;
      // Cached on the session so requireOwnDist and the rate limiters do not
      // hit the database on every request.
      req.session.role = user.role;

      // Wait for the store to persist before redirecting, or the next request
      // can arrive before the session exists.
      req.session.save((saveErr) => {
        if (saveErr) {
          console.error('Session save failed:', saveErr);
          return res.status(500).send('Something went wrong. Please try again.');
        }
        log.info('auth.login.success', {
          requestId: req.id,
          userId: String(user._id),
          role: user.role,
        });
        res.redirect('/');
      });
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).send('Error logging in');
  }
});


// POST /logout – destroy session
router.post('/logout', (req, res) => {
  if (!req.session) {
    // No session object at all, just go to login
    return res.redirect('/login');
  }

  req.session.destroy((err) => {
    if (err) {
      console.error('Logout error:', err);
      return res.status(500).send('Error logging out');
    }

    // The options MUST match how the cookie was set, or the browser keeps it.
    //
    // Previously this was clearCookie('connect.sid') with no options, so the
    // cookie survived logout. The browser then sent that dead session id on
    // the next login; the store had destroyed it, so Express issued a new
    // session and the login landed in one the response did not reference —
    // which is why logging in appeared to fail the first time and work the
    // second.
    res.clearCookie('connect.sid', {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    res.redirect('/login');
  });
});


// GET /dashboard - logged-in dashboard
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).lean();
    if (!user) {
      return res.redirect('/login');
    }

    // The download and convert buttons otherwise live on one page only — the
    // one shown right after generating. Pressing Go Back, converting to
    // WordPress, closing the tab or returning tomorrow all lose them, and the
    // only way back would be to regenerate and spend credits again.
    const site = getCurrentSite(req.session.userId);

    const siteCard = site ? `
      <div class="card bg-secondary-subtle text-dark mb-4">
        <div class="card-body">
          <h5 class="card-title mb-1">
            ${site.businessName ? site.businessName : 'Your current website'}
          </h5>
          <p class="card-subtitle text-muted mb-0">
            ${site.location ? site.location + ' &middot; ' : ''}
            ${site.pageCount} page${site.pageCount === 1 ? '' : 's'}
            &middot; generated ${site.generatedAgo}
          </p>

          <div class="d-flex flex-wrap gap-2 mt-3">
            <a href="${site.previewUrl}/" target="_blank" rel="noopener"
               class="btn btn-outline-dark">Preview</a>

            <button type="button" id="dlStatic" class="btn btn-primary">
              Download HTML Site
            </button>

            <form action="/export-wp-theme" method="POST" class="d-inline">
              ${res.locals.csrfField || ''}
              <button type="submit" id="dlWp" class="btn btn-success">
                Convert to WordPress
              </button>
            </form>
          </div>

          <p class="text-muted small mb-0 mt-3">
            Generated sites are kept for 24 hours. After that you'll need to generate again.
          </p>

          <div id="siteAlert" class="alert alert-danger mt-3 d-none" role="alert"></div>
        </div>
      </div>
    ` : `
      <div class="alert alert-secondary">
        You haven't generated a website yet.
        <a href="/" class="alert-link">Create one now</a>.
      </div>
    `;

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Dashboard</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
        <style>
          #overlay {
            position: fixed; inset: 0; background: rgba(0,0,0,.8);
            display: none; flex-direction: column; align-items: center;
            justify-content: center; z-index: 9999; color: #fff;
          }
          #overlay.show { display: flex; }
        </style>
      </head>
      <body class="bg-dark text-white">
        <div class="container mt-5 mb-5" style="max-width: 820px;">
          <h1 class="mb-4">Dashboard</h1>

          ${siteCard}

          <!-- text-white is required: Bootstrap 5.3's .card sets
               color: var(--bs-body-color), which is dark, and that overrides
               the text-white inherited from <body>. Without it the contents
               are dark text on a dark card — present, but invisible. -->
          <div class="card bg-dark border-secondary text-white mb-4">
            <div class="card-body">
              <p class="mb-1"><strong>Email:</strong> ${user.email}</p>
              <p class="mb-1"><strong>Role:</strong> ${user.role}</p>
              <p class="mb-0"><strong>Credits:</strong> ${user.credits}</p>
            </div>
          </div>

          <div class="d-flex gap-2">
            <a href="/" class="btn btn-primary">Go to Generator</a>
            <a href="/buy-credits" class="btn btn-warning">Buy Credits</a>
            <form action="/logout" method="POST" class="m-0">
              ${res.locals.csrfField || ''}
              <button type="submit" class="btn btn-danger">Logout</button>
            </form>
          </div>
        </div>

        <div id="overlay">
          <div class="spinner-border text-light" role="status" style="width:4rem;height:4rem;">
            <span class="visually-hidden">Working...</span>
          </div>
          <p class="mt-3 fs-5" id="overlayText">Optimizing your website... please wait</p>
          <p class="text-white-50">This can take up to a minute.</p>
        </div>

        <script>
          (function () {
            const overlay     = document.getElementById('overlay');
            const overlayText = document.getElementById('overlayText');
            const alertBox    = document.getElementById('siteAlert');
            const dlStatic    = document.getElementById('dlStatic');
            const dlWp        = document.getElementById('dlWp');

            if (dlWp) {
              dlWp.addEventListener('click', () => {
                overlayText.textContent = 'Building your WordPress theme... please wait';
                overlay.classList.add('show');
              });
            }

            if (dlStatic) {
              dlStatic.addEventListener('click', async () => {
                if (alertBox) alertBox.classList.add('d-none');
                dlStatic.disabled = true;
                overlayText.textContent = 'Optimizing your website... please wait';
                overlay.classList.add('show');

                try {
                  // POST: /production performs an expensive build, so it must not be
                  // reachable by a cross-site GET.
                  const res = await fetch('/production', {
                    method: 'POST',
                    headers: { 'Accept': 'text/html' },
                  });
                  if (!res.ok) throw new Error('The build failed. Please try again.');

                  overlayText.textContent = 'Starting your download...';
                  window.location.href = '/download-zip';

                  setTimeout(() => {
                    overlay.classList.remove('show');
                    dlStatic.disabled = false;
                  }, 3000);

                } catch (err) {
                  overlay.classList.remove('show');
                  dlStatic.disabled = false;
                  if (alertBox) {
                    alertBox.textContent = err.message || 'Something went wrong.';
                    alertBox.classList.remove('d-none');
                  }
                }
              });
            }
          })();
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).send('Error loading dashboard');
  }
});


// GET /api/me - returns current logged in user data as JSON
router.get('/api/me', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).lean();
    if (!user) return res.status(401).json({ error: 'Not logged in' });

    res.json({
      email: user.email,
      role: user.role,
      credits: user.credits,
      verified: user.verified
    });    

  } catch (err) {
    console.error('api/me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


// GET /verify?token=...
router.get('/verify', async (req, res) => {
  try {
    // Cast: ?token[$ne]=null arrives as an object and would match the first
    // unverified account in the collection.
    const token = String(req.query.token || '').trim();

    if (!token) {
      return res.status(400).send('Invalid verification link (missing token).');
    }

    const user = await User.findOne({ verificationToken: token });

    if (!user) {
      return res.status(400).send('Invalid or expired verification link.');
    }

    user.verified = true;
    user.verificationToken = null;
    await user.save();

    res.send(`
      <h2>Email verified 🎉</h2>
      <p>Your account is now active. You can log in and start using the app.</p>
      <a href="/login">Go to login</a>
    `);
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).send('Error verifying email.');
  }
});



module.exports = router;