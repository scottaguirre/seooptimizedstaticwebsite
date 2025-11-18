// routes/authRoute.js
const path = require('path');
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const requireAuth = require('../middleware/requireAuth');


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

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Dashboard</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="bg-dark text-white">
        <div class="container mt-5">
          <h1 class="mb-4">Dashboard</h1>
          <p><strong>Email:</strong> ${user.email}</p>
          <p><strong>Role:</strong> ${user.role}</p>
          <p><strong>Credits:</strong> ${user.credits}</p>

          <div class="mt-4 d-flex gap-2">
            <a href="/" class="btn btn-primary">Go to Generator</a>

            <form action="/logout" method="POST" class="m-0">
              <button type="submit" class="btn btn-danger">Logout</button>
            </form>
          </div>
        </div>
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
