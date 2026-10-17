// routes/staticBlogsRoute.js
//
// Where a Cloudflare blog is created and its campaigns are planned.
//
// WHY THERE HAS TO BE A SCREEN AT ALL
//
// Every screen that plans a campaign today lives in wp-admin, inside the
// plugin. The server only exposes an API, and every route on it is locked to
// a signed request from a plugin.
//
// A Cloudflare blog has no WordPress, so it has no plugin, so there is no
// screen anywhere to type a topic into. The plan went straight from "render
// the pages" to "deploy them" and never said where the topics come from.
// This is that missing step.
//
// THE RULES ARE NOT HERE. They are in utils/blog/createCampaign.js, which
// /api/blog/plan also calls. The whole point of moving them out was to have
// one copy, so a rule appearing in this file is a bug: it means the plugin
// and the screen can now disagree about what a valid campaign is.
//
// WHAT THIS DOES NOT DO YET
//
// Nothing is published. Approving a campaign — the step that charges credits
// and writes the posts — is /api/blog/write, which is another 250 lines
// behind the same plugin lock and needs the same extraction, with its own
// contract test first. And even once written, the posts sit in Mongo until
// the renderer and the Cloudflare upload exist.
//
// So: this creates blogs and plans campaigns. It is deliberately a dead end
// after that, rather than a half-built path that looks finished.
//
// ONE OWNER, CHECKED ON EVERY ROUTE. A blog id is in the URL, so every
// handler loads it scoped to req.user — never by id alone. Loading first and
// comparing afterwards is the same bug with a longer fuse.

const express = require('express');
const router = express.Router();

const BlogSite = require('../models/BlogSite');
const BlogCampaign = require('../models/BlogCampaign');
const BlogPost = require('../models/BlogPost');

const requireAuth = require('../middleware/requireAuth');
const { createCampaign } = require('../utils/blog/createCampaign');
const { withAppHeader } = require('../utils/appHeader');
const { pageTitle } = require('../utils/pageTitle');
const { log } = require('../utils/logger');

/** The shell blogSitesRoute and creditsRoute use, so this does not look bolted on. */
function page({ title, body, status = 200 }) {
  return {
    status,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${pageTitle(title)}</title>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
{{HEADER_ASSETS}}
</head>
<body style="background:#082d5b;" class="text-white">
{{HEADER}}
{{SIDEBAR}}
  <div class="container py-5" style="max-width: 900px;">
    ${body}
  </div>
{{HEADER_SCRIPTS}}
</body>
</html>`,
  };
}

function send(res, spec) {
  return res.status(spec.status).send(withAppHeader(spec.html, res));
}

/**
 * Escape everything that came from a person.
 *
 * Every value on this page was typed by the account holder — the blog name,
 * the domain, the topics, the target page URL. That is not a reason to skip
 * this: it is their own dashboard, and the cheapest way to find out you
 * forgot is a customer pasting something with an apostrophe in it.
 */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isObjectId(value) {
  return /^[a-f0-9]{24}$/i.test(String(value || ''));
}

/**
 * The blog named in the URL, IF IT BELONGS TO WHOEVER IS ASKING.
 *
 * Scoped in the query rather than loaded and compared afterwards. Both are
 * correct today; only one of them stays correct when somebody adds an early
 * return above the comparison.
 *
 * `target` is in the filter too. A WordPress site opened through this screen
 * would render a plan form for a site whose campaigns are collected by a
 * plugin — two ways to drive one site, which is how two sides end up
 * disagreeing about what has been published.
 */
async function ownedBlog(req) {
  if (!isObjectId(req.params.id)) return null;

  return BlogSite.findOne({
    _id: req.params.id,
    user: req.user._id,
    target: 'cloudflare',
  });
}

function notFound(res) {
  return send(res, page({
    status: 404,
    title: 'Blog not found',
    body: `<h1>That blog is not here</h1>
           <p class="lead">It may have been removed, or it belongs to another account.</p>
           <a href="/static-blogs" class="btn btn-primary mt-3">Back to your blogs</a>`,
  }));
}

/**
 * Topics, one per line.
 *
 * A TEXTAREA RATHER THAN A ROW OF FIELDS, because the list usually arrives
 * from somewhere else — a spreadsheet, a notes file, the suggestion list —
 * and pasting twelve lines into one box beats adding twelve rows by hand.
 *
 * The query each post should win is optional and goes after a pipe. Without
 * one the topic is used as its own query, which is what the planner does
 * with a topic it is given nothing else for.
 */
function parseTopics(raw) {
  return String(raw || '')
    .split('\n')
    .map(line => line.trim())
    .map(line => {
      const [topic, query] = line.split('|').map(part => (part || '').trim());
      return { topic, targetQuery: query || topic };
    })
    /* ONE FILTER, NOT TWO. There was a .filter(Boolean) on the trimmed lines
     * as well, and it was dead: this one already drops anything with no
     * topic, including a blank line and a line that is just a pipe. Two
     * guards doing one job means mutating either of them changes nothing,
     * which is how a line stops being checked. */
    .filter(t => t.topic);
}

/* -------------------------------------------------------------------------
 * The list
 * ---------------------------------------------------------------------- */

router.get('/static-blogs', requireAuth, async (req, res) => {
  try {
    const blogs = await BlogSite.find({ user: req.user._id, target: 'cloudflare' })
      .sort({ createdAt: -1 })
      .lean();

    /* ONE QUERY FOR THE COUNTS, NOT ONE PER BLOG. Twenty blogs is twenty
     * round trips done the obvious way, on a page whose whole job is to be
     * opened constantly. */
    const counts = blogs.length
      ? await BlogPost.aggregate([
          { $match: { site: { $in: blogs.map(b => b._id) } } },
          { $group: { _id: '$site', n: { $sum: 1 } } },
        ])
      : [];

    const byId = new Map(counts.map(c => [String(c._id), c.n]));

    const rows = blogs.map(blog => `
      <tr>
        <td><a href="/static-blogs/${blog._id}" class="link-light">${esc((blog.business && blog.business.name) || 'Untitled blog')}</a></td>
        <td class="text-white-50">${esc(blog.siteUrl || '—')}</td>
        <td class="text-end">${byId.get(String(blog._id)) || 0}</td>
      </tr>`).join('');

    const list = blogs.length
      ? `<table class="table table-dark table-hover align-middle">
           <thead><tr><th>Blog</th><th>Domain</th><th class="text-end">Articles</th></tr></thead>
           <tbody>${rows}</tbody>
         </table>`
      : `<p class="lead text-white-50">You have no static blogs yet.</p>`;

    send(res, page({
      title: 'Static blogs',
      body: `
        <h1 class="mb-4">Static blogs</h1>

        <p class="text-white-50">
          Blogs published as plain pages, with no WordPress and no plugin.
          You plan their campaigns here rather than in wp-admin.
        </p>

        ${list}

        <h2 class="h4 mt-5 mb-3">Add a blog</h2>

        <form method="post" action="/static-blogs" class="row g-2">
          ${res.locals.csrfField || ''}
          <div class="col-md-5">
            <label class="form-label" for="name">Name</label>
            <input class="form-control" id="name" name="name" required maxlength="200"
                   placeholder="Leander Water Heaters">
          </div>
          <div class="col-md-5">
            <label class="form-label" for="domain">Domain</label>
            <input class="form-control" id="domain" name="domain" required maxlength="253"
                   placeholder="leanderwaterheaters.com">
          </div>
          <div class="col-md-2 d-flex align-items-end">
            <button class="btn btn-primary w-100" type="submit">Add</button>
          </div>
        </form>`,
    }));

  } catch (err) {
    log.error('staticBlogs.list.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not load your blogs</h1>
             <a href="/dashboard" class="btn btn-primary mt-3">Dashboard</a>`,
    }));
  }
});

/* -------------------------------------------------------------------------
 * Creating one
 * ---------------------------------------------------------------------- */

router.post('/static-blogs', requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 200);
    const domain = BlogSite.normaliseSiteUrl(req.body.domain);

    if (!name || !domain) {
      return send(res, page({
        status: 400,
        title: 'Add a blog',
        body: `<h1>A blog needs a name and a domain</h1>
               <a href="/static-blogs" class="btn btn-primary mt-3">Back</a>`,
      }));
    }

    /* NORMALISED BEFORE THE CHECK, not after. 'https://Blog.Example.com/'
     * and 'blog.example.com' are one domain, and a uniqueness test against
     * the raw strings would happily store both — then two blogs would deploy
     * over each other and the second would look like it had eaten the first. */
    const clash = await BlogSite.findOne({ user: req.user._id, siteUrl: domain });

    if (clash) {
      return send(res, page({
        status: 400,
        title: 'Already added',
        body: `<h1>You already have a blog on ${esc(domain)}</h1>
               <p class="lead">Two blogs on one domain would publish over each other.</p>
               <a href="/static-blogs" class="btn btn-primary mt-3">Back to your blogs</a>`,
      }));
    }

    const limit = Number(process.env.BLOG_MAX_SITES_PER_USER) || 50;
    const existing = await BlogSite.countDocuments({
      user: req.user._id,
      status: { $ne: 'revoked' },
    });

    if (existing >= limit) {
      return send(res, page({
        status: 400,
        title: 'Too many blogs',
        body: `<h1>You have reached the limit of ${limit} blogs</h1>
               <a href="/static-blogs" class="btn btn-primary mt-3">Back</a>`,
      }));
    }

    /* NO LICENCE KEY AND NO SECRET, and that is the whole difference between
     * this and /blog-sites. There is no plugin to paste a key into and
     * nothing that ever calls in — and middleware/requireSite.js refuses any
     * site that is not a WordPress one before it looks at a signature, so a
     * blog created here cannot be used as a way in. See test-static-site.js. */
    const blog = await BlogSite.create({
      user: req.user._id,
      target: 'cloudflare',
      status: 'active',
      siteUrl: domain,
      business: { name },
    });

    log.info('staticBlogs.created', {
      requestId: req.id,
      userId: String(req.user._id),
      siteId: String(blog._id),
      domain,
    });

    res.redirect(`/static-blogs/${blog._id}`);

  } catch (err) {
    log.error('staticBlogs.create.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not add that blog</h1>
             <a href="/static-blogs" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

/* -------------------------------------------------------------------------
 * One blog
 * ---------------------------------------------------------------------- */

router.get('/static-blogs/:id', requireAuth, async (req, res) => {
  try {
    const blog = await ownedBlog(req);
    if (!blog) return notFound(res);

    const campaigns = await BlogCampaign.find({ site: blog._id })
      .sort({ createdAt: -1 })
      .select('name status slots createdAt targetPage isPillar')
      .lean();

    const rows = campaigns.map(c => `
      <tr>
        <td>${esc(c.name || 'Untitled')}</td>
        <td><span class="badge bg-secondary">${esc(c.status)}</span></td>
        <td class="text-end">${(c.slots || []).length}</td>
        <td class="text-white-50">${esc(c.targetPage && c.targetPage.keyword ? c.targetPage.keyword : (c.isPillar ? 'pillar' : '—'))}</td>
      </tr>`).join('');

    const planned = campaigns.length
      ? `<table class="table table-dark align-middle">
           <thead><tr><th>Campaign</th><th>Status</th><th class="text-end">Posts</th><th>Keyword</th></tr></thead>
           <tbody>${rows}</tbody>
         </table>
         <p class="text-white-50 small">
           Nothing is written or charged until a campaign is approved, and
           approving is not built yet.
         </p>`
      : '<p class="text-white-50">No campaigns yet.</p>';

    send(res, page({
      title: esc((blog.business && blog.business.name) || 'Blog'),
      body: `
        <p><a href="/static-blogs" class="link-light">&larr; Your blogs</a></p>

        <h1 class="mb-1">${esc((blog.business && blog.business.name) || 'Untitled blog')}</h1>
        <p class="text-white-50">${esc(blog.siteUrl)}</p>

        <h2 class="h4 mt-5 mb-3">Campaigns</h2>
        ${planned}

        <h2 class="h4 mt-5 mb-3">Plan a campaign</h2>

        <form method="post" action="/static-blogs/${blog._id}/plan">
          ${res.locals.csrfField || ''}

          <div class="mb-3">
            <label class="form-label" for="name">Campaign name</label>
            <input class="form-control" id="name" name="name" maxlength="200"
                   placeholder="Autumn water heaters">
          </div>

          <div class="row g-2 mb-3">
            <div class="col-md-7">
              <label class="form-label" for="targetUrl">Page you want to rank</label>
              <input class="form-control" id="targetUrl" name="targetUrl" required
                     placeholder="https://example.com/water-heater-repair/">
            </div>
            <div class="col-md-5">
              <label class="form-label" for="targetKeyword">Its search phrase</label>
              <input class="form-control" id="targetKeyword" name="targetKeyword" required
                     placeholder="water heater repair leander">
            </div>
          </div>

          <div class="mb-3">
            <label class="form-label" for="topics">Topics, one per line</label>
            <textarea class="form-control font-monospace" id="topics" name="topics"
                      rows="10" required
                      placeholder="Signs your water heater is about to fail&#10;What repair costs in Central Texas | water heater repair cost"></textarea>
            <div class="form-text text-white-50">
              Add <code>| the search phrase</code> after a topic to say what it
              should win. Without one the topic is used as its own phrase.
            </div>
          </div>

          <div class="row g-2 mb-4">
            <div class="col-md-4">
              <label class="form-label" for="startDate">First post</label>
              <input class="form-control" type="date" id="startDate" name="startDate">
            </div>
            <div class="col-md-4">
              <label class="form-label" for="gapDays">Days between posts</label>
              <input class="form-control" type="number" id="gapDays" name="gapDays"
                     min="1" max="90" value="7">
            </div>
            <div class="col-md-4">
              <label class="form-label" for="hour">Hour of day</label>
              <input class="form-control" type="number" id="hour" name="hour"
                     min="0" max="23" value="9">
            </div>
          </div>

          <button class="btn btn-primary" type="submit">Plan it</button>
          <span class="text-white-50 ms-2">Planning is free. Nothing is charged here.</span>
        </form>`,
    }));

  } catch (err) {
    log.error('staticBlogs.show.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not load that blog</h1>
             <a href="/static-blogs" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

/* -------------------------------------------------------------------------
 * Planning
 * ---------------------------------------------------------------------- */

router.post('/static-blogs/:id/plan', requireAuth, async (req, res) => {
  try {
    const blog = await ownedBlog(req);
    if (!blog) return notFound(res);

    const topics = parseTopics(req.body.topics);

    /* THE FORM IS TRANSLATED, NOT VALIDATED. Whether the topic list is empty,
     * too long, cannibalising or missing a target page is createCampaign's
     * question — it is the same question /api/blog/plan asks, and asking it
     * here too would be the second copy the extraction existed to prevent.
     *
     * So this builds the body the shared function expects and hands over. */
    const result = await createCampaign({
      site: blog,
      requestId: req.id,
      body: {
        name: req.body.name,
        targetPage: {
          url: String(req.body.targetUrl || '').trim(),
          keyword: String(req.body.targetKeyword || '').trim(),
        },
        topics,
        schedule: {
          startDate: String(req.body.startDate || '').trim(),
          gapDays: Number(req.body.gapDays) || 7,
          hour: Number(req.body.hour) || 9,
        },
      },
    });

    if (!result.ok) {
      /* THE CONFLICT LIST IS SHOWN, NOT JUST THE SENTENCE. wp-admin marks the
       * offending rows with it; on a plain form the nearest equivalent is
       * printing them, and the alternative is telling somebody that some of
       * their fifty topics compete without saying which. */
      const detail = Array.isArray(result.conflicts) && result.conflicts.length
        ? `<ul class="mt-3">${result.conflicts.map(c => `<li>${esc(c.detail || c.kind)}</li>`).join('')}</ul>`
        : '';

      return send(res, page({
        status: result.status,
        title: 'That campaign was not saved',
        body: `<h1 class="h2">That campaign was not saved</h1>
               <p class="lead">${esc(result.error)}</p>
               ${detail}
               <a href="/static-blogs/${blog._id}" class="btn btn-primary mt-3">Back to the form</a>`,
      }));
    }

    const { response } = result;

    const slots = response.slots.map(s => `
      <tr>
        <td class="text-end text-white-50">${s.index + 1}</td>
        <td>${esc(s.topic)}</td>
        <td class="text-white-50">${esc(s.targetQuery)}</td>
        <td class="text-white-50">${s.publishAt ? esc(new Date(s.publishAt).toLocaleDateString()) : '—'}</td>
      </tr>`).join('');

    send(res, page({
      title: 'Campaign planned',
      body: `
        <h1 class="h2 mb-3">Campaign planned</h1>

        <p class="lead">
          ${response.slots.length} posts, ${response.quote.total} credits.
          ${response.enoughCredits
            ? `You have ${response.creditsAvailable}.`
            : `<span class="text-warning">You have ${response.creditsAvailable} — not enough yet.</span>`}
        </p>

        <table class="table table-dark align-middle">
          <thead><tr><th></th><th>Topic</th><th>Search phrase</th><th>Publishes</th></tr></thead>
          <tbody>${slots}</tbody>
        </table>

        ${response.warnings && response.warnings.length
          ? `<div class="alert alert-warning">
               <strong>Worth a look:</strong>
               <ul class="mb-0">${response.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
             </div>`
          : ''}

        <div class="alert alert-secondary">
          Saved as a draft. Nothing has been written and nothing has been
          charged. Approving a campaign is not built yet.
        </div>

        <a href="/static-blogs/${blog._id}" class="btn btn-primary">Back to the blog</a>`,
    }));

  } catch (err) {
    /* THROWN, NOT RETURNED. createCampaign refuses a bad form with ok:false
     * and throws when something is actually broken, so landing here means
     * the database or the planner failed — not that somebody typed the wrong
     * thing. Those two deserve different pages. */
    log.error('staticBlogs.plan.failed', err, {
      requestId: req.id,
      siteId: String(req.params.id || ''),
    });

    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not plan that campaign</h1>
             <p class="lead">Nothing was saved. Please try again.</p>
             <a href="/static-blogs/${esc(req.params.id)}" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

module.exports = router;
