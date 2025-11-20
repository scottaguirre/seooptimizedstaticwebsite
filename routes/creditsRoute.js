// routes/creditsRoute.js
const requireAuth = require('../middleware/requireAuth');
const { checkCredits } = require("../utils/helpers");
const express = require('express');
const router = express.Router();

// GET /buy-credits – simple page to show current credits + placeholder
router.get("/buy-credits", (req, res) => {
  const user = req.user; // requireAuth puts user on req

  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <title>Buy Credits</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"/>
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css">
      <style>
        body {
          background: #082d5b;
          color: #fff;
        }
        .card {
          background: #0c3a7a;
          border: none;
          border-radius: 12px;
          box-shadow: 0 10px 25px rgba(0,0,0,0.4);
        }
      </style>
    </head>
    <body class="d-flex align-items-center justify-content-center min-vh-100">
      <div class="container" style="max-width: 700px;">
        <div class="card p-4">
          <h1 class="h3 mb-3">
            <i class="bi bi-credit-card-2-front me-2"></i>
            Buy Credits
          </h1>
          <p class="mb-3">
            Logged in as <strong>${user.email}</strong>
          </p>
          <p class="mb-4">
            Current credits:
            <span class="badge bg-warning text-dark">${user.credits}</span>
          </p>

          <div class="alert alert-info text-dark">
            <strong>Heads up:</strong> Payment integration (Stripe/PayPal) is not wired in yet.
            For now, you can manually adjust credits from the
            <a href="/admin" class="alert-link">User Management</a> page if you're an admin/superadmin.
          </div>

          <div class="mt-4 d-flex justify-content-between">
            <a href="/" class="btn btn-outline-light">
              <i class="bi bi-arrow-left-circle me-1"></i>
              Back to Generator
            </a>
            <a href="/admin" class="btn btn-primary">
              <i class="bi bi-people-fill me-1"></i>
              Go to User Management
            </a>
          </div>
        </div>
      </div>
    </body>
    </html>
  `);
});

// POST /api/check-credits – used by frontend before generating pages
router.post("/api/check-credits", requireAuth, async (req, res) => {
  try {
    const pages = req.body.pages;

    const { ok, pagesCount, totalCost } = await checkCredits(req.user, pages);

    res.json({
      ok,
      pagesCount,
      totalCost,
      available: req.user.credits
    });

  } catch (err) {
    console.error("check-credits error:", err);
    res.status(500).json({
      ok: false,
      error: "Server error"
    });
  }
});

module.exports = router;
