// routes/blogSitesRoute.js
//
// Where a customer gets the licence key they paste into wp-admin.
//
// Nothing else creates a BlogSite, so without this page /api/blog/activate can
// only ever answer "that licence key is not valid" — the plugin is unusable.
//
// THE KEY IS SHOWN ONCE
//
// Only its SHA-256 is stored, so it cannot be shown again — the same rule the
// rest of this app applies to verification and reset tokens, and for the same
// reason: a database backup that leaks contains no working keys. The page
// makes that explicit rather than letting someone close the tab and discover
// it later.
//
// Losing a key is not a disaster. Issue another and revoke the old one; a
// licence is a row, not a purchase.
//
// WHAT REVOKE ACTUALLY DOES
//
// Sets status to 'revoked'. requireSite then rejects every signed request from
// that install, and activate refuses the key. It deliberately does NOT delete
// the record: campaigns reference it, and their history — what was published,
// what was charged — has to survive.

const express = require('express');
const router = express.Router();

const BlogSite = require('../models/BlogSite');
const BlogCampaign = require('../models/BlogCampaign');
const requireAuth = require('../middleware/requireAuth');
const { CREDITS_PER_POST } = require('../utils/blogPricing');
const { log } = require('../utils/logger');

/** The same shell billingRoute and creditsRoute use, so this does not look bolted on. */
function page({ title, body, status = 200 }) {
  return {
    status,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css">
</head>
<body class="bg-dark text-white">
  <div class="container py-5" style="max-width: 900px;">
    ${body}
  </div>
</body>
</html>`,
  };
}

function send(res, spec) {
  return res.status(spec.status).send(spec.html);
}

/**
 * Escape anything that came from a user or from their WordPress install.
 *
 * siteUrl is reported BY THE PLUGIN, which means it is attacker-controlled if
 * someone points a hostile install at us. Interpolating it into HTML unescaped
 * would be stored XSS against the customer's own dashboard.
 */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function statusBadge(status) {
  const map = {
    active: 'bg-success',
    suspended: 'bg-warning text-dark',
    revoked: 'bg-secondary',
  };
  return `<span class="badge ${map[status] || 'bg-secondary'}">${esc(status)}</span>`;
}

function when(date) {
  if (!date) return '<span class="text-white-50">never</span>';

  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
  const text = new Date(date).toLocaleDateString();

  // A site that has not checked in for a fortnight has lost its plugin or its
  // cron, and the customer will not notice on their own — they will just see
  // no posts appearing. Worth flagging where they are already looking.
  return days > 14
    ? `<span class="text-warning">${text} (${days} days ago)</span>`
    : esc(text);
}

/* -------------------------------------------------------------------------
 * The list
 * ---------------------------------------------------------------------- */

router.get('/blog-sites', requireAuth, async (req, res) => {
  try {
    const sites = await BlogSite.find({ user: req.user._id }).sort({ createdAt: -1 }).lean();

    // One query for every site rather than one per site.
    const counts = await BlogCampaign.aggregate([
      { $match: { user: req.user._id } },
      { $group: { _id: '$site', campaigns: { $sum: 1 } } },
    ]);
    const bySite = new Map(counts.map(c => [String(c._id), c.campaigns]));

    const rows = sites.map(s => `
      <tr>
        <td>
          ${s.siteUrl
            ? `<strong>${esc(s.siteUrl)}</strong>`
            : '<span class="text-white-50">not connected yet</span>'}
          ${s.licenceKeyLast4
            ? `<div class="small text-white-50">key ending ${esc(s.licenceKeyLast4)}</div>`
            : ''}
        </td>
        <td>${statusBadge(s.status)}</td>
        <td>${bySite.get(String(s._id)) || 0}</td>
        <td class="small">${when(s.lastSeenAt)}</td>
        <td class="text-end">
          ${s.status === 'revoked' ? '' : `
          <form action="/blog-sites/${s._id}/revoke" method="POST" class="d-inline"
                onsubmit="return confirm('Revoke this licence? The plugin on that site will stop working immediately.');">
            ${res.locals.csrfField || ''}
            <button type="submit" class="btn btn-sm btn-outline-danger">Revoke</button>
          </form>`}
        </td>
      </tr>`).join('');

    send(res, page({
      title: 'Blog Automation — Sites',
      body: `
        <h1 class="mb-2">Blog Automation</h1>
        <p class="text-white-50">
          Each WordPress site running the Interlink Engine plugin needs its own
          licence key. You have <strong>${Number(req.user.credits || 0).toLocaleString()}</strong>
          credits; each published post costs <strong>${CREDITS_PER_POST}</strong>.
        </p>

        ${sites.length ? `
        <div class="table-responsive bg-light text-dark rounded p-3 mt-4">
          <table class="table table-sm align-middle mb-0">
            <thead>
              <tr>
                <th>Site</th><th>Status</th><th>Campaigns</th><th>Last seen</th><th></th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>` : `
        <div class="alert alert-secondary mt-4">
          No sites yet. Create a licence key below, then paste it into
          <strong>Settings &rarr; Interlink Engine</strong> in that site's WordPress admin.
        </div>`}

        <div class="card bg-secondary text-white mt-4">
          <div class="card-body">
            <h5 class="card-title">Add a site</h5>
            <p class="small mb-3">
              This creates a new licence key. You will see it once — copy it
              straight into WordPress.
            </p>
            <form action="/blog-sites" method="POST">
              ${res.locals.csrfField || ''}
              <button type="submit" class="btn btn-primary">
                <i class="bi bi-key me-1"></i> Create a licence key
              </button>
            </form>
          </div>
        </div>

        <a href="/dashboard" class="btn btn-outline-light mt-4">Back to Dashboard</a>`,
    }));

  } catch (err) {
    log.error('blogSites.list.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not load your sites</h1>
             <a href="/dashboard" class="btn btn-primary mt-3">Back to Dashboard</a>`,
    }));
  }
});

/* -------------------------------------------------------------------------
 * Minting a key
 * ---------------------------------------------------------------------- */

router.post('/blog-sites', requireAuth, async (req, res) => {
  try {
    // A cap, because nothing else limits this and a loop against the form
    // would otherwise fill the collection.
    const existing = await BlogSite.countDocuments({
      user: req.user._id,
      status: { $ne: 'revoked' },
    });

    const limit = Number(process.env.BLOG_MAX_SITES_PER_USER) || 50;
    if (existing >= limit) {
      return send(res, page({
        status: 400,
        title: 'Too many sites',
        body: `<h1>You have reached the limit of ${limit} connected sites</h1>
               <p class="lead">Revoke one you are no longer using, or contact support.</p>
               <a href="/blog-sites" class="btn btn-primary mt-3">Back to sites</a>`,
      }));
    }

    // Generated here and never stored in this form. What goes to the database
    // is its SHA-256 plus the last four characters, which is enough for
    // support to confirm which key someone means and useless to anyone who
    // reads the database.
    const licenceKey = BlogSite.generateLicenceKey();

    const site = await BlogSite.create({
      user: req.user._id,
      licenceKeyHash: BlogSite.hashLicenceKey(licenceKey),
      licenceKeyLast4: licenceKey.slice(-4),
      // Replaced at activation with a fresh one. Set now because the schema
      // requires it, and because a record without a secret is a record that
      // would fail in a confusing way if anything ever read it early.
      secret: BlogSite.generateSecret(),
      status: 'active',
    });

    log.info('blogSites.created', {
      requestId: req.id,
      userId: String(req.user._id),
      siteId: String(site._id),
    });

    send(res, page({
      title: 'Your licence key',
      body: `
        <h1 class="mb-3">Your licence key</h1>

        <div class="alert alert-warning">
          <strong>Copy this now.</strong> It is stored encrypted and cannot be
          shown again. If you lose it, revoke this site and create another —
          that costs nothing.
        </div>

        <div class="card bg-light text-dark">
          <div class="card-body">
            <code class="fs-4 user-select-all d-block text-center py-2"
                  id="key">${esc(licenceKey)}</code>
          </div>
        </div>

        <h5 class="mt-4">What to do with it</h5>
        <ol class="text-white-50">
          <li>Install the Interlink Engine plugin on the site</li>
          <li>Go to <strong>Settings &rarr; Interlink Engine</strong></li>
          <li>Paste the key and click Connect</li>
        </ol>

        <p class="text-white-50 small">
          The site reports its address when it connects, and it will appear in
          your list. Each post published costs ${CREDITS_PER_POST} credits from
          your balance.
        </p>

        <a href="/blog-sites" class="btn btn-primary mt-3">Done</a>`,
    }));

  } catch (err) {
    log.error('blogSites.create.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not create that licence</h1>
             <a href="/blog-sites" class="btn btn-primary mt-3">Back to sites</a>`,
    }));
  }
});

/* -------------------------------------------------------------------------
 * Revoking
 * ---------------------------------------------------------------------- */

router.post('/blog-sites/:id/revoke', requireAuth, async (req, res) => {
  try {
    if (!/^[a-f0-9]{24}$/i.test(String(req.params.id || ''))) {
      return res.redirect('/blog-sites');
    }

    // Scoped to this user in the QUERY, not checked afterwards. A findById
    // followed by an ownership check is the same thing until someone edits
    // one line out; this cannot be got wrong.
    const site = await BlogSite.findOneAndUpdate(
      { _id: req.params.id, user: req.user._id },
      {
        $set: {
          status: 'revoked',
          // Rotated as well as revoked. Belt and braces: even if a future
          // change made status checking conditional, the old install's
          // signatures would no longer verify.
          secret: BlogSite.generateSecret(),
        },
      },
      { new: true }
    );

    if (!site) {
      log.security('blogSites.revoke.notOwned', {
        requestId: req.id,
        userId: String(req.user._id),
        siteId: req.params.id,
      });
      return res.redirect('/blog-sites');
    }

    // Campaigns are paused rather than cancelled. The site may be reconnected
    // with a new key, and losing a customer's planned topics because their
    // licence was cycled would be its own bug.
    await BlogCampaign.updateMany(
      { site: site._id, status: 'active' },
      { $set: { status: 'paused' } }
    );

    log.info('blogSites.revoked', {
      requestId: req.id,
      userId: String(req.user._id),
      siteId: String(site._id),
    });

    res.redirect('/blog-sites');

  } catch (err) {
    log.error('blogSites.revoke.failed', err, { requestId: req.id });
    res.redirect('/blog-sites');
  }
});

module.exports = router;