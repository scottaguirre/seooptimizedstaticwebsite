// routes/adminRoute.js
const express = require('express');
const router = express.Router();
const User = require('../models/User');
const requireAdmin = require('../middleware/requireAdmin');

// GET /admin - list users
router.get('/admin', requireAdmin, async (req, res) => {
  try {
    const users = await User.find().sort({ createdAt: -1 }).lean();

    const rows = users.map(u => `
      <tr>
        <td>${u.email}</td>
        <td>${u.role}</td>
        <td>${u.credits}</td>
        <td>${new Date(u.createdAt).toLocaleString()}</td>
        <td>
          <form action="/admin/users/${u._id}/role" method="POST" class="d-inline">
            <select name="role" class="form-select form-select-sm d-inline w-auto">
              <option value="admin" ${u.role === 'admin' ? 'selected' : ''}>admin</option>
              <option value="subscriber" ${u.role === 'subscriber' ? 'selected' : ''}>subscriber</option>
              <option value="free" ${u.role === 'free' ? 'selected' : ''}>free</option>
            </select>
            <button type="submit" class="btn btn-sm btn-secondary ms-1">Update Role</button>
          </form>
        </td>
        <td>
          <form action="/admin/users/${u._id}/credits" method="POST" class="d-inline">
            <input type="number" name="credits" value="${u.credits}" class="form-control form-control-sm d-inline w-auto" />
            <button type="submit" class="btn btn-sm btn-primary ms-1">Set Credits</button>
          </form>
        </td>
      </tr>
    `).join('');

    res.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <title>Admin - Users</title>
        <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
      </head>
      <body class="bg-dark text-white">
        <div class="container mt-5">
          <h1 class="mb-4">Admin - Users</h1>
          <p class="mb-3">Logged in as: <strong>${req.user.email}</strong> (admin)</p>
          <div class="mb-3">
            <a href="/" class="btn btn-primary btn-sm">Back to Generator</a>
          </div>
          <div class="table-responsive bg-light text-dark rounded p-3">
            <table class="table table-sm table-striped align-middle mb-0">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Credits</th>
                  <th>Created</th>
                  <th>Change Role</th>
                  <th>Set Credits</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
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

// POST /admin/users/:id/role - update role
router.post('/admin/users/:id/role', requireAdmin, async (req, res) => {
  try {
    const { role } = req.body;
    if (!['admin', 'subscriber', 'free'].includes(role)) {
      return res.status(400).send('Invalid role');
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

module.exports = router;
