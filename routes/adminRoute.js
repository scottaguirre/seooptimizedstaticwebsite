// routes/adminRoute.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const requireAdmin = require('../middleware/requireAdmin');

// GET /admin - list users (with optional filters)
router.get('/admin', requireAdmin, async (req, res) => {
  try {
    const { q, role } = req.query;

    const filter = {};
    const validRoles = ['admin', 'subscriber', 'free'];

    // Search by email (case-insensitive substring)
    if (q && q.trim()) {
      filter.email = { $regex: q.trim(), $options: 'i' };
    }

    // Filter by role if valid
    if (role && validRoles.includes(role)) {
      filter.role = role;
    }

    const users = await User.find(filter).sort({ createdAt: -1 }).lean();

    const rows = users.map(u => {
      const isSelf = String(u._id) === String(req.user._id);

      return `
        <tr>
          <td>${u.email}</td>
          <td>
            <span class="badge bg-${u.role === 'admin' ? 'danger' : u.role === 'subscriber' ? 'primary' : 'secondary'}">
              ${u.role}
            </span>
          </td>
          <td>${u.credits}</td>
          <td>${u.verified ? '<span class="badge bg-success">Yes</span>' : '<span class="badge bg-warning text-dark">No</span>'}</td>
          <td>${new Date(u.createdAt).toLocaleString()}</td>

          <!-- Change Role -->
          <td>
            <form action="/admin/users/${u._id}/role" method="POST" class="d-inline">
              <select name="role" class="form-select form-select-sm d-inline w-auto" ${isSelf ? 'disabled' : ''}>
                <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
                <option value="subscriber" ${u.role === 'subscriber' ? 'selected' : ''}>subscriber</option>
                <option value="free" ${u.role === 'free' ? 'selected' : ''}>free</option>
              </select>
              <button type="submit" class="btn btn-sm btn-secondary ms-1" ${isSelf ? 'disabled' : ''}>
                Update
              </button>
            </form>
          </td>

          <!-- Set Credits -->
          <td>
            <form action="/admin/users/${u._id}/credits" method="POST" class="d-inline">
              <input 
                type="number" 
                name="credits" 
                value="${u.credits}" 
                class="form-control form-control-sm d-inline w-auto" 
                min="0"
              />
              <button type="submit" class="btn btn-sm btn-primary ms-1">Save</button>
            </form>
          </td>

          <!-- Verify / Delete -->
          <td>
            <form action="/admin/users/${u._id}/verify" method="POST" class="d-inline">
              <button 
                type="submit" 
                class="btn btn-sm ${u.verified ? 'btn-outline-success' : 'btn-success'}"
              >
                ${u.verified ? 'Re-Verify' : 'Mark Verified'}
              </button>
            </form>

            <form 
              action="/admin/users/${u._id}/delete" 
              method="POST" 
              class="d-inline ms-1"
              onsubmit="return confirm('Are you sure you want to delete this user?');"
            >
              <button 
                type="submit" 
                class="btn btn-sm btn-danger"
                ${isSelf ? 'disabled' : ''}
              >
                Delete
              </button>
            </form>
          </td>
        </tr>
      `;
    }).join('');

    const currentQ = q ? q : '';
    const currentRole = role ? role : '';

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Admin - Users</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="bg-dark text-white">
        <div class="container mt-5 mb-5">
          <h1 class="mb-3">Admin - Users</h1>
          <p class="mb-3">Logged in as: <strong>${req.user.email}</strong> (admin)</p>

          <div class="mb-3 d-flex gap-2">
            <a href="/" class="btn btn-primary btn-sm">Back to Generator</a>
            <a href="/dashboard" class="btn btn-secondary btn-sm">Dashboard</a>
          </div>

          <!-- Search / Filter -->
          <div class="card mb-4 bg-secondary text-white">
            <div class="card-body">
              <h5 class="card-title mb-3">Search & Filter</h5>
              <form method="GET" action="/admin" class="row g-2 align-items-end">
                <div class="col-md-4 col-sm-12">
                  <label class="form-label">Search by email</label>
                  <input 
                    type="text" 
                    name="q" 
                    value="${currentQ}" 
                    class="form-control form-control-sm" 
                    placeholder="Enter email..."
                  />
                </div>

                <div class="col-md-3 col-sm-6">
                  <label class="form-label">Filter by role</label>
                  <select name="role" class="form-select form-select-sm">
                    <option value="">All roles</option>
                    <option value="admin" ${currentRole === 'admin' ? 'selected' : ''}>admin</option>
                    <option value="subscriber" ${currentRole === 'subscriber' ? 'selected' : ''}>subscriber</option>
                    <option value="free" ${currentRole === 'free' ? 'selected' : ''}>free</option>
                  </select>
                </div>

                <div class="col-md-3 col-sm-6">
                  <button type="submit" class="btn btn-sm btn-success me-1">Apply</button>
                  <a href="/admin" class="btn btn-sm btn-outline-light">Clear</a>
                </div>
              </form>
            </div>
          </div>

          <!-- Create User Manually -->
          <div class="card mb-4 bg-secondary text-white">
            <div class="card-body">
              <h5 class="card-title mb-3">Create User Manually</h5>
              <form action="/admin/users" method="POST" class="row g-2">
                <div class="col-md-3 col-sm-6">
                  <label class="form-label">Email</label>
                  <input type="email" name="email" required class="form-control form-control-sm" placeholder="user@example.com" />
                </div>
                <div class="col-md-3 col-sm-6">
                  <label class="form-label">Password</label>
                  <input type="password" name="password" required class="form-control form-control-sm" />
                </div>
                <div class="col-md-2 col-sm-4">
                  <label class="form-label">Role</label>
                  <select name="role" class="form-select form-select-sm">
                    <option value="free">free</option>
                    <option value="subscriber">subscriber</option>
                    <option value="admin">admin</option>
                  </select>
                </div>
                <div class="col-md-2 col-sm-4">
                  <label class="form-label">Credits</label>
                  <input type="number" name="credits" value="10" min="0" class="form-control form-control-sm" />
                </div>
                <div class="col-md-2 col-sm-4">
                  <div class="form-check mt-4">
                    <input class="form-check-input" type="checkbox" name="verified" id="manualVerified" checked>
                    <label class="form-check-label" for="manualVerified">
                      Mark as verified
                    </label>
                  </div>
                </div>
                <div class="col-12 mt-2">
                  <button type="submit" class="btn btn-sm btn-warning">Create User</button>
                </div>
              </form>
            </div>
          </div>

          <!-- Users Table -->
          <div class="table-responsive bg-light text-dark rounded p-3">
            <table class="table table-sm table-striped align-middle mb-0">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Credits</th>
                  <th>Verified</th>
                  <th>Created</th>
                  <th>Change Role</th>
                  <th>Set Credits</th>
                  <th>Verify / Delete</th>
                </tr>
              </thead>
              <tbody>
                ${rows || '<tr><td colspan="8" class="text-center">No users found.</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </body>
      </html>
    `);
  } catch (err) {
    console.error('Admin GET /admin error:', err);
    res.status(500).send('Error loading admin dashboard');
  }
});

// POST /admin/users - create a user manually
router.post('/admin/users', requireAdmin, async (req, res) => {
  try {
    const { email, password, role, credits, verified } = req.body;

    if (!email || !password) {
      return res.status(400).send('Email and password are required');
    }

    const validRoles = ['admin', 'subscriber', 'free'];
    const finalRole = validRoles.includes(role) ? role : 'free';

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).send('Email is already registered');
    }

    const user = new User({
      email,
      role: finalRole,
      credits: Number.isNaN(parseInt(credits, 10)) ? 10 : parseInt(credits, 10),
      verified: !!verified,
      verificationToken: null
    });

    // Use the model method to hash password
    await user.setPassword(password);
    await user.save();

    res.redirect('/admin');
  } catch (err) {
    console.error('Admin create user error:', err);
    res.status(500).send('Error creating user');
  }
});

// POST /admin/users/:id/role - update role
router.post('/admin/users/:id/role', requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    const validRoles = ['admin', 'subscriber', 'free'];

    if (!validRoles.includes(role)) {
      return res.status(400).send('Invalid role');
    }

    // Prevent removing your own admin role
    if (String(req.params.id) === String(req.user._id) && role !== 'admin') {
      return res.status(400).send('You cannot remove your own admin role.');
    }

    await User.findByIdAndUpdate(req.params.id, { role });
    res.redirect('/admin');
  } catch (err) {
    console.error('Admin update role error:', err);
    res.status(500).send('Error updating role');
  }
});

// POST /admin/users/:id/credits - set credits
router.post('/admin/users/:id/credits', requireAdmin, async (req, res) => {
  try {
    const credits = parseInt(req.body.credits, 10);
    if (Number.isNaN(credits) || credits < 0) {
      return res.status(400).send('Invalid credits');
    }
    await User.findByIdAndUpdate(req.params.id, { credits });
    res.redirect('/admin');
  } catch (err) {
    console.error('Admin update credits error:', err);
    res.status(500).send('Error updating credits');
  }
});

// POST /admin/users/:id/verify - mark user as verified (or re-verify)
router.post('/admin/users/:id/verify', requireAdmin, async (req, res) => {
  try {
    await User.findByIdAndUpdate(req.params.id, {
      verified: true,
      verificationToken: null
    });
    res.redirect('/admin');
  } catch (err) {
    console.error('Admin verify user error:', err);
    res.status(500).send('Error verifying user');
  }
});

// POST /admin/users/:id/delete - delete user
router.post('/admin/users/:id/delete', requireAdmin, async (req, res) => {
  try {
    // Safety: don't let admin delete themselves
    if (String(req.params.id) === String(req.user._id)) {
      return res.status(400).send('You cannot delete your own admin account.');
    }

    await User.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
  } catch (err) {
    console.error('Admin delete user error:', err);
    res.status(500).send('Error deleting user');
  }
});

module.exports = router;
