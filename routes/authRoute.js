// routes/authRoute.js
const path = require('path');
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const requireAuth = require('../middleware/requireAuth');
const { getCurrentSite } = require('../utils/currentSite');


// GET /signup – show signup form
router.get('/signup', (req, res) => {
  res.sendFile(path.join(__dirname, '../src/views/signup.html'));
});



// POST /signup – create user
router.post('/signup', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).send('Email and password are required');
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).send('Email is already registered');
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
  res.sendFile(path.join(__dirname, '../src/views/login.html'));
});


// POST /login – authenticate user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).send('Email and password are required');
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).send('Invalid email or password');
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(400).send('Invalid email or password');
    }

    // 🔹 Block login if not verified
    if (!user.verified) {
      return res.send(`
        <h2>Email not verified</h2>
        <p>Please verify your email before logging in.</p>
        <p>If you didn't receive the email, contact support or ask for a new verification link.</p>
        <a href="/login">Back to login</a>
      `);
    }

    // 🔹 OK, verified → log in
    req.session.userId = user._id;
    res.redirect('/');
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
    res.clearCookie('connect.sid'); // optional, but nice
    res.redirect('/login');
  });
});


// GET /dashboard - simple logged-in dashboard
router.get('/dashboard', requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.userId).lean();
    if (!user) {
      return res.redirect('/login');
    }

    // The download/convert buttons otherwise live on one page only — the one
    // shown right after generating. This gives them a permanent home.
    const site = getCurrentSite(req.session.userId);

    const siteCard = site ? `
      <div class="card bg-secondary-subtle text-dark mb-4">
        <div class="card-body">
          <div class="d-flex justify-content-between align-items-start flex-wrap gap-2">
            <div>
              <h5 class="card-title mb-1">
                ${site.businessName ? site.businessName : 'Your current website'}
              </h5>
              <p class="card-subtitle text-muted mb-0">
                ${site.location ? site.location + ' &middot; ' : ''}
                ${site.pageCount} page${site.pageCount === 1 ? '' : 's'}
                &middot; generated ${site.generatedAgo}
              </p>
            </div>
          </div>

          <div class="d-flex flex-wrap gap-2 mt-3">
            <a href="${site.previewUrl}" target="_blank" rel="noopener"
               class="btn btn-outline-dark">Preview</a>

            <button type="button" id="dlStatic" class="btn btn-primary">
              Download HTML Site
            </button>

            <a href="/export-wp-theme" id="dlWp" class="btn btn-success">
              Convert to WordPress
            </a>
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

          <div class="card bg-dark border-secondary mb-4">
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
                  const res = await fetch('/production', { headers: { 'Accept': 'text/html' } });
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
    const { token } = req.query;

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