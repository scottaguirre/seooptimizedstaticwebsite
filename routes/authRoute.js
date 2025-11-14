// routes/authRoute.js
const path = require('path');
const express = require('express');
const router = express.Router();
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
      return res.status(400).send('This email is already registered');
    }

    // 👉 check how many users exist
    const userCount = await User.countDocuments();

    const user = new User({
      email,
      // 👉 FIRST user in the DB becomes admin, others are subscribers
      role: userCount === 0 ? 'admin' : 'subscriber'
    });

    await user.setPassword(password);
    await user.save();

    // log the user in
    req.session.userId = user._id;

    res.redirect('/'); // send them to the main generator
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

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).send('Invalid email or password');
    }

    const valid = await user.validatePassword(password);
    if (!valid) {
      return res.status(400).send('Invalid email or password');
    }

    req.session.userId = user._id;
    res.redirect('/');
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).send('Error logging in');
  }
});

// POST /logout – destroy session
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
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
      credits: user.credits
    });
  } catch (err) {
    console.error('api/me error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});


module.exports = router;
