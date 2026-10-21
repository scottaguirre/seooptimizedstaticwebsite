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

/* THE CSV PARSER'S OWN SOURCE, for inlining into the campaign form. See
 * utils/blog/csvTopics.js: the file is read in the browser rather than
 * uploaded, and the page is handed the tested function rather than a
 * hand-written copy of it. */
const { browserSource } = require('../utils/blog/csvTopics');
const { suggestForSite } = require('../utils/blog/suggestForSite');
const { publishBlog } = require('../utils/blog/render/publishBlog');

/* DESTRUCTURED AT LOAD, like publishBlog above it — which means a test that
 * stubs it has to do so BEFORE requiring this router. That trap has been
 * walked into three times on this file; see the note at the top of
 * test-static-blogs.js, which now lists this one too. */
const { markPublished } = require('../utils/blog/markPublished');
const {
  deleteProject, releaseDomain, childEnv,
  /* ADDED 19 OCTOBER, for the domain check at blog creation. Destructured at
   * load like the rest of this file, so a test that stubs them has to do it
   * before requiring the router — see the note at the top of
   * test-static-blogs.js, which has now caught five features. */
  findZone, listZones, suggestZoneFix,
} = require('../utils/blog/cloudflare/deploy');
const { approveCampaign } = require('../utils/blog/approveCampaign');

/* THE SAME CONVERSION THE SCHEDULER USES, not a second one. A start date
 * resolved here by different arithmetic than publishDates() resolves the
 * rest of the run by is a campaign whose first post is a day out from the
 * others — and nothing on screen would say which of the two was wrong. */
const { zonedWallTimeToUtc } = require('../utils/blog/schedule');
const { baseUrl } = require('../utils/baseUrl');
const { withAppHeader } = require('../utils/appHeader');
/* APP_NAME AS WELL AS pageTitle, AND test-brand-name.js IS WHY.
 *
 * The delete page said "gone from Three Comets" in plain text and broke
 * a suite whose entire job is to stop exactly that: one file writing the
 * brand by hand is one file that still says the old name on the day it
 * changes. It is imported from the one place that defines it. */
const { pageTitle, APP_NAME, TOOL_CF_BLOGS } = require('../utils/pageTitle');
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

/* -------------------------------------------------------------------------
 * Timezones
 *
 * A WordPress site tells us its zone on every call. A Cloudflare blog has
 * no plugin and never calls in, so somebody has to pick one — and until
 * somebody does, campaignPlan.js falls back to UTC and schedules a Texas
 * business's posts for four in the morning.
 * ---------------------------------------------------------------------- */

/**
 * Every zone this Node build knows, with the ones Edwin's customers are
 * actually in at the top.
 *
 * FROM Intl, NOT A HAND-WRITTEN LIST. The IANA database changes several
 * times a year — a country moves its clocks, a zone is renamed, a new one
 * is split off — and a list frozen in this file would slowly disagree with
 * the Intl that schedule.js uses to do the arithmetic. Reading it from the
 * same source means the dropdown cannot offer something the scheduler will
 * then reject.
 *
 * THE FALLBACK IS NOT DECORATION. Intl.supportedValuesOf arrived in Node
 * 18. The server runs something newer, but a route that renders an empty
 * <select> on an older runtime is a form nobody can submit, and it would
 * fail at the one moment nobody is watching — a deploy to a box with a
 * different Node. The short list below is enough to keep the screen usable.
 *
 * COMPUTED ONCE AT LOAD. The list is a few hundred strings and does not
 * change while the process runs; rebuilding it per request would sort it
 * again on every page view for no reason.
 */
const COMMON_ZONES = [
  'America/Chicago',
  'America/New_York',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
  'UTC',
];

const ALL_ZONES = (() => {
  let zones = [];

  try {
    if ('function' === typeof Intl.supportedValuesOf) {
      zones = Intl.supportedValuesOf('timeZone');
    }
  } catch (_) {
    zones = [];
  }

  if (!zones.length) zones = COMMON_ZONES.slice();

  /* The common ones hoisted, the rest alphabetical. Not deduplicated by
   * hand — a Set keeps the first occurrence, which is the hoisted one. */
  return [...new Set([...COMMON_ZONES, ...zones])];
})();

/**
 * Is this a zone we are willing to store?
 *
 * ASKED OF Intl RATHER THAN OF OUR OWN LIST, and the difference matters on
 * the day the two disagree. ALL_ZONES is what the dropdown offers; this is
 * what the scheduler can actually use. A zone that Intl accepts and our
 * list has not caught up with should be stored, not refused.
 */
function isKnownZone(tz) {
  if (!tz || 'string' !== typeof tz) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * An instant -> the calendar day it falls on, in the blog's own zone.
 *
 * THIS REPLACED toLocaleDateString(), WHICH WAS WRONG TWICE OVER.
 *
 * Called bare it takes the locale AND the timezone from the process. The
 * server runs UTC; the blog is in Texas. A post stored for 20:00 Central
 * is 02:00 UTC the next day, so the confirmation page would name a day the
 * reader's own blog never publishes on — off by one, only in the evening,
 * only for customers behind UTC. Nothing would ever look broken.
 *
 * The locale half is the same fault in a smaller coat: 3/11 and 11/3 are
 * the same instant to a machine and opposite months to a person, decided
 * by an environment variable on a server nobody is reading.
 *
 * SO BOTH ARE NAMED EXPLICITLY, and the format is ISO rather than
 * American, because a page that already shows a customer in Phoenix their
 * dates by a Texas clock should not also guess at their date order.
 *
 * Found by running the suite under TZ=Asia/Tokyo. It passed under UTC and
 * under Chicago and failed under Tokyo — which is the same lesson as the
 * missing-wrangler test, in a different costume: a suite that only passes
 * in the environment it was written in is not testing the code.
 */
function dayIn(value, timezone) {
  const at = value ? new Date(value) : null;
  if (!at || Number.isNaN(at.getTime())) return '';

  const zone = isKnownZone(timezone) ? timezone : 'UTC';

  const parts = {};
  for (const p of new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(at)) parts[p.type] = p.value;

  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** The dropdown, with `selected` on whatever the blog already has. */
function zoneOptions(selected) {
  const want = String(selected || 'UTC');

  return ALL_ZONES.map(tz =>
    `<option value="${esc(tz)}"${tz === want ? ' selected' : ''}>${esc(tz)}</option>`
  ).join('');
}

/**
 * A date the person picked -> the instant the scheduler should start from.
 *
 * ANCHORED AT NOON, WHICH IS THE WHOLE POINT OF THIS FUNCTION.
 *
 * The form sends 'YYYY-MM-DD'. `new Date('2026-10-20')` is midnight UTC,
 * and in every American zone midnight UTC on the 20th is still the evening
 * of the 19th. publishDates() immediately reads that instant back as a
 * calendar date in the blog's zone — so the campaign would start a day
 * early, every time, for every customer west of Greenwich.
 *
 * Noon is far enough from both midnights that no zone offset and no
 * daylight-saving jump can push it onto a neighbouring day. The plugin
 * does exactly this, in start_date_instant(), and for exactly this reason:
 * two implementations of the same trick would be two chances to get it
 * wrong, so this one is deliberately the same shape.
 *
 * EMPTY STAYS EMPTY. campaignPlan.js tests `schedule.startAt ? ... :
 * undefined`, so '' means "as soon as the cadence allows" — which is what
 * leaving the box alone should mean.
 */
function startInstant(date, timezone) {
  const text = String(date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';

  const [year, month, day] = text.split('-').map(Number);
  const zone = isKnownZone(timezone) ? timezone : 'UTC';

  const at = zonedWallTimeToUtc({ year, month, day, hour: 12, minute: 0 }, zone);

  return Number.isNaN(at.getTime()) ? '' : at.toISOString();
}

/**
 * 'HH:MM' from an <input type="time">, or the 9am default.
 *
 * VALIDATED HERE RATHER THAN TRUSTED. parseTimeOfDay() in schedule.js
 * already falls back to 09:00 on anything malformed, so a bad value cannot
 * crash a campaign — but it would be stored on the campaign as typed and
 * then displayed back as if it had been honoured.
 */
function publishTimeFrom(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return '09:00';

  const hour = Math.min(23, Math.max(0, Number(m[1])));
  const minute = Math.min(59, Math.max(0, Number(m[2])));

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
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
 *
 * AND A THIRD FIELD AFTER A SECOND PIPE: the link phrase, which is how
 * SIBLING POSTS refer to this one mid-sentence. It exists because the
 * plugin's CSV has carried three columns since it was written, and until
 * the CSV loader arrived this box could read only two — so loading a file
 * threw the third away silently.
 *
 * IT STAYS OPTIONAL, AND EMPTY MEANS ABSENT RATHER THAN BLANK. A trailing
 * pipe is a typing accident, not an instruction to use an empty anchor, and
 * an empty linkPhrase reaching the planner would render a link with no
 * words in it. Unset, linkPlan.referTo() falls back to the keyword — which
 * is what it was changed to do on 19 October.
 *
 * THE LIMIT OF THREE ON THE SPLIT IS DOCUMENTATION, NOT BEHAVIOUR, and that
 * is worth saying plainly because it reads like a guard. Destructuring three
 * names already ignores a fourth field; removing the limit changes nothing
 * any test can observe, and mutation confirmed it. It stays because it says
 * out loud how many fields this format has — not because anything depends
 * on it.
 */
function parseTopics(raw) {
  return String(raw || '')
    .split('\n')
    .map(line => line.trim())
    .map(line => {
      const [topic, query, phrase] = line.split('|', 3).map(part => (part || '').trim());
      return {
        topic,
        targetQuery: query || topic,
        /* OMITTED RATHER THAN EMPTY — AND TODAY THAT IS A DISTINCTION
         * NOTHING DOWNSTREAM CAN SEE. campaignPlan stores `s.linkPhrase ||
         * ''`, planCampaign passes `t.linkPhrase || null` and qualityCheck
         * tests `!t.linkPhrase`: all three coalesce the two cases, so
         * `linkPhrase: ''` would behave identically. Mutation says so
         * outright, and the honest word for that is an equivalent mutant —
         * not a hole in the tests, and not something to contrive an
         * assertion around.
         *
         * It is written this way because "no phrase was given" is what a
         * trailing pipe MEANS, and the first consumer to tell '' from
         * absent should find the right answer already here rather than a
         * blank somebody has to go and interpret. */
        ...(phrase ? { linkPhrase: phrase } : {}),
      };
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

    /* NUMBERED FROM THE POSITION, NOT FROM THE BLOG. The sort above is
       newest-first, so the only thing that knows a row is "the fourth one"
       is where it landed in THIS list. Nothing on the document could say
       it, which is why the map takes an index. */
    const rows = blogs.map((blog, i) => `
      <tr>
        <td class="rownum">${i + 1}</td>
        <td><a href="/static-blogs/${blog._id}" class="link-light">${esc((blog.business && blog.business.name) || 'Untitled blog')}</a></td>
        <td class="text-white-50">${esc(blog.siteUrl || '—')}</td>
        <td class="text-end">${byId.get(String(blog._id)) || 0}</td>
      </tr>`).join('');

    const list = blogs.length
      ? `<table class="table table-navy table-hover align-middle">
           <thead><tr><th></th><th>Blog</th><th>Domain</th><th class="text-end">Articles</th></tr></thead>
           <tbody>${rows}</tbody>
         </table>`
      : `<p class="lead text-white-50">You have no static blogs yet.</p>`;

    send(res, page({
      title: TOOL_CF_BLOGS,
      body: `
        <h1 class="mb-4">${TOOL_CF_BLOGS}</h1>

        <p class="text-white-50">
          Blogs published as plain pages, with no WordPress and no plugin.
          You plan their campaigns here rather than in wp-admin.
        </p>

        ${list}

        <h2 class="h4 mt-5 mb-3">Add a blog</h2>

        <form method="post" action="/static-blogs" class="row g-2">
          ${res.locals.csrfField || ''}
          <div class="col-md-4">
            <label class="form-label" for="name">Name</label>
            <input class="form-control" id="name" name="name" required maxlength="200"
                   placeholder="Leander Water Heaters">
          </div>
          <div class="col-md-4">
            <label class="form-label" for="domain">Domain</label>
            <input class="form-control" id="domain" name="domain" required maxlength="253"
                   placeholder="leanderwaterheaters.com">
          </div>

          <!-- ASKED AT THE START, not buried in a settings screen. It
               decides what "post at 9am" means for every campaign this blog
               will ever have, and the cost of getting it wrong is posts
               going out at four in the morning — which is the single most
               recognisable sign of an automated blog, and the thing this
               product exists to avoid.

               DEFAULTED TO CENTRAL rather than to UTC. A default has to be
               something, and UTC is wrong for every customer; Central is at
               least right for the ones this is being built for. It is a
               dropdown, so changing it costs one click. -->
          <div class="col-md-3">
            <label class="form-label" for="timezone">Timezone</label>
            <select class="form-select" id="timezone" name="timezone">
              ${zoneOptions('America/Chicago')}
            </select>
          </div>

          <div class="col-md-1 d-flex align-items-end">
            <button class="btn btn-primary w-100" type="submit">Add</button>
          </div>

          <div class="col-12">
            <div class="form-text text-white-50">
              The timezone is where the business is, not where you are. Posts
              are scheduled by its clock, and it survives daylight saving.
            </div>
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
    /* CHECKED AGAINST Intl, NOT AGAINST THE DROPDOWN. The list the form
     * offers and the list the scheduler can use are the same today and are
     * not guaranteed to stay that way — Intl is the one that has to agree,
     * because it does the arithmetic. Anything it refuses falls back to
     * UTC rather than being stored and failing later, at 3am, in a job. */
    const timezone = isKnownZone(req.body.timezone) ? String(req.body.timezone) : 'UTC';

    const blog = await BlogSite.create({
      user: req.user._id,
      target: 'cloudflare',
      status: 'active',
      siteUrl: domain,
      timezone,
      business: { name },
    });

    log.info('staticBlogs.created', {
      requestId: req.id,
      userId: String(req.user._id),
      siteId: String(blog._id),
      domain,
      timezone,
    });

    /* AND NOW, BEFORE ANYTHING HAS BEEN WRITTEN OR PAID FOR, IS THE DOMAIN
     * REACHABLE AT ALL?
     *
     * ON 19 OCTOBER EDWIN TYPED `all-bout-hvac-explr-home.com` meaning
     * `all-about-hvac.explr-home.com` — one dot became a hyphen, which
     * turns a subdomain of a domain he owns into a brand new .com nobody
     * owns. Nothing noticed. A campaign was approved, three articles were
     * written and charged for, the site deployed, and only the publish
     * screen said "No zone in this Cloudflare account matches" — by which
     * point every canonical, the sitemap and the feed named an address that
     * does not exist.
     *
     * The same findZone() call, moved to the one moment when a typo is
     * still free to fix.
     *
     * IT WARNS, IT DOES NOT BLOCK. A blog on a domain Cloudflare does not
     * host is a legitimate thing to want: the owner points the DNS himself
     * and everything else works. Refusing would break that for the sake of
     * catching a typo.
     *
     * AND A FAILURE TO ASK IS NOT A FAILURE TO MATCH. No credentials, or a
     * token without Zone:Read, also comes back ok:false — saying "that
     * domain is not in your account" then would be a confident lie. Only
     * the noZone branch warns. */
    const zone = await findZone({ domain });

    if (!zone.ok && zone.noZone) {
      const owned = await listZones();
      const { suggestion } = owned.ok ? suggestZoneFix({ domain, zones: owned.names }) : {};

      log.info('staticBlogs.domainNotInAccount', {
        requestId: req.id,
        siteId: String(blog._id),
        domain,
        suggestion: suggestion || '',
      });

      return send(res, page({
        title: 'Blog added',
        body: `
          <h1 class="h2 mb-3">Blog added \u2014 but check the domain</h1>

          <div class="alert alert-warning">
            <p><strong>No domain in your Cloudflare account matches
            <code>${esc(domain)}</code>.</strong></p>

            ${suggestion ? `
            <p class="mb-0">
              Did you mean <strong><code>${esc(suggestion)}</code></strong>?
              A hyphen where a dot should be turns a subdomain of a domain you
              own into a different domain entirely.
            </p>` : `
            <p class="mb-0">
              That is fine if you point the DNS yourself. If it was a typo,
              now is the moment to fix it \u2014 before any articles are written.
            </p>`}
          </div>

          <p class="lead">
            You can carry on either way. The blog will publish to its Cloudflare
            address, but the DNS record will not be created automatically and
            every link on the site will name <code>${esc(domain)}</code>.
          </p>

          <a href="/static-blogs/${blog._id}" class="btn btn-primary">
            Carry on with this domain
          </a>
          <a href="/static-blogs/${blog._id}/delete" class="btn btn-outline-light ms-2">
            Delete it and start again
          </a>`,
      }));
    }

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

/**
 * The blog's page, including the plan form.
 *
 * ONE COPY, BECAUSE TWO ROUTES RENDER IT. The GET shows it empty; the
 * suggestion POST shows it again with the ideas already in the topics box
 * and the fields the person typed still filled in. Written inline in both
 * handlers, the two forms would drift — a field added to one and not the
 * other, and the only symptom is that suggestion quietly stops carrying
 * something through.
 *
 * @param {object}   blog
 * @param {object[]} campaigns
 * @param {object}   form    what to pre-fill the inputs with
 * @param {string}   notice  HTML shown above the form, already escaped
 * @param {number}   status
 *
 * RETURNS page(), NOT A BARE { title, body }. The first version of this
 * returned the two fields on their own and send() read spec.status as
 * undefined — res.status(undefined) — while the whole page lost its shell:
 * no header, no sidebar, no doctype. The existing suite caught it on the
 * first run, which is the entire reason /static-blogs has a suite.
 */
function blogPageSpec({ blog, campaigns, articles = [], form = {}, notice = '', status = 200, suggestions = [] }) {
  /* THE ARTICLE COUNT IS articles.length, AND IT IS WATCHED.
   *
   * It was briefly a parameter of its own, so the count could come from a
   * countDocuments() while the list stayed a list. Mutation killed that
   * idea rather than the code: nothing passed it, so the parameter and its
   * default were an untested branch dressed up as foresight.
   *
   * The two are the same number today because the front-page dropdown names
   * every article, so this page loads every article. IF THAT DROPDOWN IS
   * EVER CAPPED — and it should be; 171 <option> elements is why it is in
   * CLAUDE.md — then articles.length silently becomes "how many the dropdown
   * offers" while still reading as "how many exist", and the button below
   * starts understating the blog. At that point the count must come from
   * countDocuments(), and this comment is the warning that it has to move
   * in the same commit. */

  /* THE SUGGESTIONS, AS A LIST TO TICK RATHER THAN TEXT TO EDIT.
   *
   * They used to be appended straight into the topics box. Twelve of
   * them, each wrapping onto a second line in a monospace block, and the
   * only way to reject one was to select exactly the right half and press
   * delete. Edwin's words were "this looks very crowded", and he was
   * describing a list he was meant to be CHOOSING from being presented as
   * a thing to EDIT.
   *
   * Ticking is the right verb for choosing. The textarea stays for typing
   * and pasting, which is the thing it is actually good at.
   *
   * ONE DIRECTION ONLY: the table writes into the box and never reads it
   * back. Two things that could each be the real list would need a rule
   * for which wins, and the first time they disagreed somebody would plan
   * a campaign they had not read. What is in the textarea when you press
   * Plan is what gets planned — nothing else, ever.
   *
   * THE SCRIPT IS INLINE, which the CSP allows. The alternative is a
   * round trip to the server to copy text between two fields on one page.
   * Without JavaScript the table simply does not add anything, and the
   * box still works — which is the same place this screen was before. */
  const suggestionList = suggestions.length ? `
      <div class="card bg-dark border-secondary mb-3">
        <div class="card-body">
          <h3 class="h6 mb-3">Suggested topics</h3>

          <table class="table table-navy table-striped table-sm align-middle mb-3">
            <thead>
              <tr>
                <th style="width:2.5rem">
                  <!-- THE HEADER BOX TICKS AND UNTICKS THE LOT. With
                       twelve rows, "I want most of these" and "I want two
                       of these" both start with one click here. -->
                  <input class="form-check-input" type="checkbox" id="ieTickAll" checked
                         aria-label="Tick or untick every suggestion">
                </th>
                <th>Topic</th>
                <th>Search phrase</th>
              </tr>
            </thead>
            <tbody>
              ${suggestions.map((t, i) => `
              <tr>
                <td>
                  <input class="form-check-input ie-suggestion" type="checkbox" checked
                         id="ieSuggest${i}"
                         data-line="${esc(`${t.topic}${t.targetQuery ? ` | ${t.targetQuery}` : ''}`)}"
                         aria-label="Include this topic">
                </td>
                <td><label class="mb-0" for="ieSuggest${i}">${esc(t.topic)}</label></td>
                <td class="text-white-50">${esc(t.targetQuery || '')}</td>
              </tr>`).join('')}
            </tbody>
          </table>

          <!-- WHAT IS ON SCREEN, CARRIED BACK SO "DIFFERENT ONES" CAN
               AVOID IT. These ideas exist nowhere else: not in the
               topics box, not in the database. Without this the button
               asks the model to avoid an empty list and hands back the
               same six. -->
          <input type="hidden" name="shown" value="${esc(suggestions
            .map(t => `${t.topic}${t.targetQuery ? ` | ${t.targetQuery}` : ''}`)
            .join('\n'))}">

          <button class="btn btn-primary btn-sm" type="button" id="ieAddTicked">
            Add ticked to my topics
          </button>
          <span class="text-white-50 small ms-2">
            Nothing is added until you press this. The box below is what gets planned.
          </span>
        </div>
      </div>

      <script>
      /* WAITS FOR THE DOCUMENT, AND THE FIRST VERSION DID NOT.
       *
       * This card is rendered ABOVE the topics box, because the order on
       * screen should be the order of the work — look at the ideas, tick
       * some, see them land. That put the script above the textarea too,
       * so getElementById('topics') ran before the browser had parsed it
       * and returned null. The guard below then returned, every listener
       * went unbound, and pressing the button did nothing at all: no
       * error, no console message, nothing.
       *
       * Edwin found it in the first thirty seconds. "I pressed Add ticked
       * to my topics and nothing happened."
       *
       * Deferring is the fix rather than moving the script to the bottom
       * of the page, because the position of a <script> is then a thing
       * somebody has to know not to change. This way it does not matter. */
      (function () {
      function ieInitSuggestions() {
        var all = document.getElementById('ieTickAll');
        var boxes = Array.prototype.slice.call(
          document.querySelectorAll('.ie-suggestion'));
        var add = document.getElementById('ieAddTicked');
        var topics = document.getElementById('topics');

        if (!all || !add || !topics) return;

        all.addEventListener('change', function () {
          boxes.forEach(function (b) { b.checked = all.checked; });
        });

        /* The header box reflects the rows, so it cannot sit there ticked
         * over twelve empty ones and invite a click that does nothing. */
        boxes.forEach(function (b) {
          b.addEventListener('change', function () {
            all.checked = boxes.every(function (x) { return x.checked; });
            all.indeterminate = !all.checked && boxes.some(function (x) { return x.checked; });
          });
        });

        add.addEventListener('click', function () {
          var lines = boxes
            .filter(function (b) { return b.checked; })
            .map(function (b) { return b.getAttribute('data-line'); });

          if (!lines.length) return;

          /* APPENDED, AND THE EXISTING TEXT DECIDES THE SEPARATOR. A
             textarea that does not end in a newline would otherwise get
             the first suggestion welded onto the last line somebody
             typed — one topic where there were meant to be two. */
          var now = topics.value.replace(/\\s+$/, '');
          topics.value = now ? now + '\\n' + lines.join('\\n') : lines.join('\\n');

          /* Ticked rows are now in the box, so leaving them ticked would
             invite adding them twice. */
          boxes.forEach(function (b) { b.checked = false; });
          all.checked = false;
          all.indeterminate = false;

          topics.focus();
          topics.selectionStart = topics.selectionEnd = topics.value.length;
        });
      }

      if ('loading' === document.readyState) {
        document.addEventListener('DOMContentLoaded', ieInitSuggestions);
      } else {
        ieInitSuggestions();
      }
      })();
      </script>` : '';

  /* EVERY CAMPAIGN GETS AN ACTION, and which one depends on its state.
   *
   * Approving is where the money is committed, so a campaign that is
   * already written must not offer a button that looks like it would
   * charge again — approveCampaign refuses, but a button nobody should
   * press is a button that will be pressed. */
  const actionFor = (c) => {
    if ('writing' === c.status) {
      return `<button class="btn btn-sm btn-outline-light" type="submit"
                      formaction="/static-blogs/${blog._id}/campaigns/${c._id}/approve">
                Check progress
              </button>`;
    }
    if ('draft' === c.status) {
      return `<button class="btn btn-sm btn-primary" type="submit"
                      formaction="/static-blogs/${blog._id}/campaigns/${c._id}/approve">
                Approve &amp; write
              </button>`;
    }
    return '';
  };

  /* WHEN THE POSTS ACTUALLY GO OUT, ON THE ROW.
   *
   * THIS COLUMN EXISTS BECAUSE OF A WASTED AFTERNOON. Edwin approved a
   * campaign, saw three articles written, pressed Publish and was told
   * nothing was due. All three were dated a week out and no screen said
   * so — the table showed a status and a count, and the publish note said
   * future articles wait, without ever naming a date. He went looking for
   * a bug in the deploy.
   *
   * SPELT OUT AS A DATE RANGE, NOT A COUNTDOWN. "In 6 days" has to be
   * recomputed against a clock to mean anything and reads differently at
   * either end of a day; a date is the same fact every time you look.
   *
   * RENDERED IN THE BLOG'S OWN ZONE. It said UTC here until the blog had a
   * timezone to render in; it does now, and a column showing a Texas
   * business UTC dates would be off by one every evening — the same fault
   * dayIn() was written to end on the confirmation page. */
  const scheduleOf = (c) => {
    const dates = (c.slots || [])
      .map(s => (s.publishAt ? new Date(s.publishAt) : null))
      .filter(d => d && !Number.isNaN(d.getTime()))
      .sort((a, b) => a - b);

    if (!dates.length) return '<span class="text-white-50">—</span>';

    const day = (d) => dayIn(d, blog.timezone);
    const now = Date.now();
    const next = dates.find(d => d.getTime() > now);

    const span = 1 === dates.length
      ? day(dates[0])
      : `${day(dates[0])} → ${day(dates[dates.length - 1])}`;

    return `${esc(span)}<br>
            <small class="text-white-50">${
              next
                ? `next ${esc(day(next))}`
                : 'all dates have passed'
            }</small>`;
  };

  const rows = campaigns.map((c, i) => `
      <tr>
        <td class="rownum">${i + 1}</td>
        <td>${esc(c.name || 'Untitled')}</td>
        <td><span class="badge bg-secondary">${esc(c.status)}</span></td>
        <td class="text-end">${(c.slots || []).length}</td>
        <td class="small">${scheduleOf(c)}</td>
        <td class="text-white-50">${esc(c.targetPage && c.targetPage.keyword ? c.targetPage.keyword : (c.isPillar ? 'pillar' : '—'))}</td>
        <td class="text-end">${actionFor(c)}</td>
      </tr>`).join('');

    const plannedTable = `<form method="post">
           ${form.csrfField || ''}
           <table class="table table-navy align-middle">
             <thead><tr><th></th><th>Campaign</th><th>Status</th><th class="text-end">Posts</th><th>Publishes</th><th>Keyword</th><th></th></tr></thead>
             <tbody>${rows}</tbody>
           </table>
         </form>
         <p class="text-white-50 small">
           Nothing is written or charged until a campaign is approved.
           Approving writes every post in it and charges for them.
         </p>`;

    /* THE FOLD, AND WHY IT IS <details> RATHER THAN A BUTTON.
     *
     * Asked for by Edwin on 21 October. This table sits between the
     * timezone form and the front-page picker, so a worked blog pushes
     * both off the screen — the same crowding the Articles list caused,
     * one table along.
     *
     * NO JAVASCRIPT AT ALL. helmet sets script-src-attr to 'none', so an
     * onclick toggle would render, look right and do nothing — which is
     * exactly how the Clear topics button failed on 20 October: silently,
     * with the only evidence in a console nobody had open. <details> is
     * the browser's own disclosure control. It needs no script, no CSP
     * exception, and it keeps working with scripting off entirely.
     *
     * IT HIDES, IT DOES NOT WITHHOLD. Everything is in the page; opening
     * it costs no request. That is what makes it safe to default shut.
     *
     * A FOLD, NOT A SECOND SCREEN — the difference from what the Articles
     * list got. Articles are a destination: you go there to edit one.
     * Campaigns are read in place and then acted on in the Plan form
     * directly below. Moving them would put the list and the form on
     * different screens, which is worse than the crowding. */
    const FOLD_ABOVE = 5;

    /* OPEN WHEN THERE IS LITTLE TO SEE. A control that hides a blog's only
     * campaign is worse than no control: it costs a click to find out
     * there was nothing behind it. Five is roughly what fits without
     * pushing the form below the fold. */
    const folded = campaigns.length > FOLD_ABOVE;

    const planned = !campaigns.length
      ? '<p class="text-white-50">No campaigns yet.</p>'
      : !folded
        ? plannedTable
        : `<details class="mb-3">
             <summary class="text-white-50" style="cursor:pointer">
               ${campaigns.length} campaigns &mdash; show
             </summary>
             <div class="mt-3">${plannedTable}</div>
           </details>`;

  return page({
    status,
    title: esc((blog.business && blog.business.name) || 'Blog'),
    body: `
      <p><a href="/static-blogs" class="link-light">&larr; Your blogs</a></p>

      <h1 class="mb-1">${esc((blog.business && blog.business.name) || 'Untitled blog')}</h1>
      <p class="text-white-50">
        ${esc(blog.siteUrl)}
        <!-- A LINK TO A CONFIRMATION, NOT A BUTTON THAT DELETES. The
             destructive step is behind a page that counts what will go and
             asks for the domain to be typed — see the route. A one-click
             delete here would sit a few pixels from "Publish". -->
        &middot; <a href="/static-blogs/${blog._id}/delete" class="link-danger small">Delete this blog</a>
      </p>

      <h2 class="h4 mt-5 mb-3">Campaigns</h2>
      ${planned}

      ${articles.length ? `
      <h2 class="h4 mt-5 mb-3">Publish</h2>

      <!-- FOUR BUTTONS, ONE FORM, AND TWO SEPARATE QUESTIONS:
           whether to send, and what to send.

           Preview renders everything and sends nothing, which is how a
           first deploy gets checked before it goes anywhere. It exists
           because a Pages deployment IS the site: whatever is not in it is
           gone, so seeing the file list first is the difference between
           publishing a blog and replacing one.

           SCOPE EXISTS BECAUSE OF THE DAY EDWIN APPROVED HIS FIRST
           CAMPAIGN. Three articles written, three articles dated in the
           future, and both buttons refusing with "nothing is due" — which
           was true and was useless. A new blog has nothing on the site on
           the day it is set up, and waiting a week to find out whether the
           Cloudflare token even works is not a plan.

           PREVIEW HAS ITS OWN SCOPE BUTTON rather than previewing only
           what is due. The override is the one that replaces a live site
           with more than it had, so it is the one most worth looking at
           before pressing. A preview that could not show it would be a
           preview of the safe path only.

           THE OVERRIDE DOES NOT MOVE ANY DATES. An article planned for
           next week goes up today still saying next week. Changing that
           means rewriting campaign state, which no renderer should do from
           behind a button labelled "publish". The note below says so. -->
      <form method="post" action="/static-blogs/${blog._id}/publish" class="mb-4">
        ${form.csrfField || ''}

        <!-- BOTH ADDRESSES, AND THE BLOG'S OWN ONE FIRST.
             This showed only the pages.dev address, because that is what
             the deploy reports back. Edwin published to
             all-about-plumbing.explr-home.com, pressed the link, and
             landed on all-about-plumbing-explr-home-com.pages.dev — and
             reasonably asked why the subdomain had not been used. It had
             been: every canonical on the site names it. Only the link on
             this page was wrong.

             THE DOMAIN IS WHAT THE SITE CLAIMS TO BE. It is in the
             canonical, the sitemap and the feed, so it is the address
             that will be indexed and the address anyone is given. The
             pages.dev one is Cloudflare's own and stays as a fallback —
             useful in the minutes after a first deploy while the
             certificate is issued, and the only one that works at all if
             the domain failed to attach.

             BOTH, RATHER THAN A STORED FLAG SAYING WHICH IS LIVE. Such a
             flag is set once, on the first deploy, and is then wrong the
             moment somebody attaches or removes a domain in Cloudflare —
             a thing this app never hears about. Two links cannot go
             stale; one of them simply always works. -->
        <p class="text-white-50 mb-2">
          ${blog.lastDeployAt
            ? `Last published ${esc(new Date(blog.lastDeployAt).toUTCString())}.`
            : 'This blog has never been published.'}
          ${blog.lastDeployAt ? `
            <br>
            <a href="https://${esc(blog.siteUrl)}/" target="_blank" rel="noopener"
               class="link-light">https://${esc(blog.siteUrl)}/</a>
            <span class="small">— your domain, and what every page on the site says it is.</span>
            ${blog.lastDeployUrl ? `
            <br>
            <a href="${esc(blog.lastDeployUrl)}" target="_blank" rel="noopener"
               class="link-light">${esc(blog.lastDeployUrl)}</a>
            <span class="small">— Cloudflare's own address, if the one above is not answering yet.</span>`
            : ''}` : ''}
        </p>

        <!-- ONE FIELD, FOUR VALUES, rather than two buttons plus a scope
             checkbox. A submit button sends one name and one value, so the
             scope would have to live in a checkbox beside them — and a
             checkbox is a thing you forget you left ticked. Each button
             here says exactly what it does. -->
        <div class="mb-2">
          <button class="btn btn-outline-light" type="submit" name="mode" value="preview">
            Preview what is due
          </button>
          <button class="btn btn-primary ms-2" type="submit" name="mode" value="publish">
            Publish what is due
          </button>
        </div>
        <div class="form-text text-white-50 mb-3">
          Replaces the whole site with the articles whose date has arrived.
          Articles dated in the future wait for their day.
        </div>

        <div class="mb-2">
          <button class="btn btn-outline-warning btn-sm" type="submit" name="mode" value="previewAll">
            Preview everything
          </button>
          <button class="btn btn-warning btn-sm ms-2" type="submit" name="mode" value="publishAll">
            Publish everything now
          </button>
        </div>
        <div class="form-text text-white-50">
          <!-- THIS USED TO SAY THE OPPOSITE, and said it confidently: that
               an article pushed up ahead of its day kept its planned date
               and that Google would read that date. True until
               markPublished began pulling a future date back, which is
               what was asked for. The sentence outlived the change and was
               the only place either screen explained the rule, so it was
               not a stale note — it was an instruction to expect the wrong
               thing.

               THE OLD SENTENCE IS NOT QUOTED HERE, on purpose. Quoting it
               put the exact words back on the page inside this comment,
               and the test that bans them failed — correctly. A comment is
               not a safe place to keep text you have forbidden: comments
               ship to the browser. Third time this file has taught that. -->
          Puts <strong>every written article</strong> on the site immediately,
          schedule ignored. Use it to get a new blog live on the day you set
          it up. An article pushed up before its day is <strong>redated to
          today</strong>, so nobody lands on a page dated next month.
          Articles still waiting keep the dates they were planned for.
        </div>
      </form>

      <h2 class="h4 mt-5 mb-3">Timezone</h2>

      <!-- A SETTING ON THE BLOG, AND EDITABLE AFTER THE FACT.
           It could have been asked for once on the Add form and never
           again. Two reasons it is here as well:

           THE BLOGS THAT ALREADY EXIST. Edwin has two, created before this
           field did, and both are sitting on the 'UTC' default. Without a
           way to change it the only fix is to delete the blog — which on a
           Cloudflare blog means losing the project and every URL with it.

           AND IT IS A FACT ABOUT THE BUSINESS, not about the campaign.
           Putting it on the plan form would ask the same question on every
           campaign and let two campaigns on one blog disagree about what
           time of day it is. -->
      <form method="post" action="/static-blogs/${blog._id}/timezone" class="mb-4">
        ${form.csrfField || ''}

        <div class="row g-2 align-items-end">
          <div class="col-md-8">
            <label class="form-label" for="timezone">Where is this business?</label>
            <select class="form-select" id="timezone" name="timezone">
              ${zoneOptions(blog.timezone)}
            </select>
            <div class="form-text text-white-50">
              Posting times are this clock, and they stay put across daylight
              saving. Currently <strong>${esc(blog.timezone || 'UTC')}</strong>,
              where it is now ${esc(
                new Intl.DateTimeFormat('en-US', {
                  timeZone: isKnownZone(blog.timezone) ? blog.timezone : 'UTC',
                  hour: 'numeric', minute: '2-digit', hour12: true,
                }).format(new Date())
              )}.
            </div>
          </div>
          <div class="col-md-4">
            <button class="btn btn-outline-light" type="submit">Save</button>
          </div>
        </div>
      </form>

      <!-- THE WRITTEN ARTICLES — A COUNT AND A DOOR, NOT THE LIST.
           Until a list existed there was no route to an article at all:
           the only thing that named them was the front-page dropdown,
           which selects one and opens nothing. An editor nothing links to
           is an editor nobody finds.

           SO IT WAS BUILT AS A WAY IN, AND GREW INTO A REPORT. On Edwin's
           plumbing blog it reached 171 unpaged rows, sitting above the
           campaign form and the front-page picker — the two things anybody
           opens this page for. The list moved to its own screen on 21
           October; what belongs here is the number and the door to it. -->
      <h2 class="h4 mt-5 mb-3">Articles</h2>

      <p>
        <a href="/static-blogs/${blog._id}/articles" class="btn btn-outline-light">
          ${articles.length} ${1 === articles.length ? 'article' : 'articles'}
        </a>
        <span class="text-white-50 small ms-2">
          Edits reach the live site the next time you publish.
        </span>
      </p>

      <h2 class="h4 mt-5 mb-3">Front page</h2>

      <!-- WHY THERE IS A PICKER AT ALL. This blog has no listing page, so
           something has to answer for the bare domain. One article is
           served at / and that article is NOT also served at its own slug
           — two addresses for one article is one article competing with
           itself.

           CHOSEN ON THE BLOG, not on a campaign. A blog can have several
           campaigns, and a per-campaign flag would let two of them claim
           the root with nothing to decide between them. -->
      <form method="post" action="/static-blogs/${blog._id}/home" class="mb-4">
        ${form.csrfField || ''}

        <div class="row g-2 align-items-end">
          <div class="col-md-8">
            <label class="form-label" for="homeSlug">Which article is the front page?</label>
            <select class="form-select" id="homeSlug" name="homeSlug">
              <option value="">Oldest published article</option>
              ${articles.map(a => `
                <option value="${esc(a.slug)}"${a.slug === blog.homeSlug ? ' selected' : ''}>
                  ${esc(a.title || a.slug)}
                </option>`).join('')}
            </select>
            <div class="form-text text-white-50">
              It is served at the domain itself, not at its own address. If the
              one you pick is not published yet, the oldest one stands in.
            </div>
          </div>
          <div class="col-md-4">
            <button class="btn btn-outline-light" type="submit">Save</button>
          </div>
        </div>
      </form>` : ''}

      <h2 class="h4 mt-5 mb-3">Plan a campaign</h2>

      ${notice}

      <form method="post" action="/static-blogs/${blog._id}/plan" id="iePlanForm">
        ${form.csrfField || ''}

        <div class="mb-3">
          <label class="form-label" for="name">Campaign name</label>
          <input class="form-control" id="name" name="name" maxlength="200"
                 value="${esc(form.name)}"
                 placeholder="Autumn water heaters">
        </div>

        <!-- A PILLAR CAMPAIGN HAS NO MONEY PAGE, AND IS NOT MISSING ONE.
             Its posts link to each other in a ring and to nothing else —
             a cluster built to rank on its own rather than to feed a
             service page.

             READ FROM THIS BOX, NEVER INFERRED FROM AN EMPTY TARGET URL.
             An ordinary campaign whose target page went missing is a bug,
             and reading the absence as intent would quietly drop a third
             of the links from every article in it — a failure that
             surfaces months later as posts that never fed anything.
             createCampaign makes exactly that argument; this is the
             screen obeying it rather than inventing its own rule. -->
        <div class="form-check mb-3">
          <input class="form-check-input" type="checkbox" value="1"
                 id="isPillar" name="isPillar"${form.isPillar ? ' checked' : ''}>
          <label class="form-check-label" for="isPillar">
            Pillar campaign — the posts link to each other and to no money page
          </label>
          <div class="form-text text-white-50">
            Needs at least two topics. Leave the two fields below empty.
          </div>
        </div>

        <div class="row g-2 mb-3">
          <div class="col-md-7">
            <label class="form-label" for="targetUrl">Page you want to rank</label>

            <!-- NEITHER FIELD IS MARKED REQUIRED, AND THE CHECKBOX IS WHY.
                 The browser cannot know that ticking Pillar excuses these
                 two, so marking them required would refuse to submit a
                 valid pillar campaign — the button would do nothing and
                 nothing on screen would say why. It is the same trap that
                 formnovalidate exists for on the suggestion button above.

                 Toggling the attribute with script would put the rule in
                 two places, here and in createCampaign, and they would
                 disagree the first time either changed. So the server
                 decides, as it already does: it refuses an ordinary
                 campaign with no target page, in a sentence. -->
            <input class="form-control" id="targetUrl" name="targetUrl"
                   value="${esc(form.targetUrl)}"
                   placeholder="https://example.com/water-heater-repair/">
            <div class="form-text text-white-50">
              Your own site, a client's, or a page on this blog. The posts link to it.
              Leave empty for a pillar campaign.
            </div>
          </div>
          <div class="col-md-5">
            <label class="form-label" for="targetKeyword">Its search phrase</label>
            <input class="form-control" id="targetKeyword" name="targetKeyword"
                   value="${esc(form.targetKeyword)}"
                   placeholder="water heater repair leander">
          </div>
        </div>

        <!-- ABOVE THE BOX IT WRITES INTO, so the order on screen is the
             order of the work: look at the ideas, tick some, see them
             land. Below it, the button would scroll the thing it changes
             out of view at the moment it changed. -->
        ${suggestionList}

        <div class="mb-3">
          <label class="form-label" for="topics">Topics, one per line</label>
          <textarea class="form-control font-monospace" id="topics" name="topics"
                    rows="10" required
                    placeholder="Signs your water heater is about to fail&#10;What repair costs in Central Texas | water heater repair cost">${esc(form.topics)}</textarea>
          <div class="form-text text-white-50">
            Add <code>| the search phrase</code> after a topic to say what it
            should win. Without one the topic is used as its own phrase.
          </div>
        </div>

        <!-- SUGGESTION RIDES THIS FORM rather than having one of its own.
             A second form would need its own copy of the two target-page
             inputs, and the person would then have to type the page twice
             — once to get ideas and again to plan from them.

             formnovalidate because the topics box is marked required and is
             empty at exactly the moment somebody wants suggestions. Without
             it the browser refuses to submit and the button looks broken.

             formaction so one form can post to two places. Both go through
             POST, so both carry the CSRF field above. -->
        <div class="mb-4">
          <button class="btn btn-outline-light btn-sm" type="submit"
                  data-busy="Thinking"
                  formaction="/static-blogs/${blog._id}/suggest" formnovalidate>
            Suggest topics
          </button>

          <!-- A SECOND SUGGESTION BUTTON, NOT A SECOND SUGGESTER.
               Same route, same rules; the only difference is that this one
               sends what is in the box as the avoid list, so the model is
               asked for ideas it has not already given you.

               WITHOUT IT, "CLEAR AND ASK AGAIN" RETURNS THE SAME SIX.
               suggestForSite's avoid list is built from topics saved in
               earlier CAMPAIGNS. Nothing you have merely typed is in it, so
               emptying the box changes nothing the model sees — you would
               press Suggest, get the identical list back, and reasonably
               conclude the button was broken. -->
          <button class="btn btn-outline-light btn-sm ms-2" type="submit"
                  data-busy="Thinking"
                  name="fresh" value="1"
                  formaction="/static-blogs/${blog._id}/suggest" formnovalidate>
            Suggest different ones
          </button>

          <!-- PLAIN JS, NO ROUND TRIP, NO COST. Emptying a textarea is not
               worth a request, and a server-side clear would lose anything
               typed into the other fields on the way back.

               NOT type="reset" — that would restore the box to whatever the
               server rendered into it, which after a suggestion is the
               suggestions. "Start over" has to mean empty.

               BOUND IN A SCRIPT, NOT BY AN onclick ATTRIBUTE, AND THIS IS
               NOT A STYLE CHOICE. It was an onclick for months and it never
               once ran: the app's CSP sets script-src-attr to 'none', so
               the browser refuses inline handlers outright. The button was
               pressed, nothing happened, and no page in the app said why.
               Edwin found it. See test-inline-handlers.js. -->
          <button class="btn btn-outline-secondary btn-sm ms-2" type="button"
                  id="ieClearTopics">
            Clear topics
          </button>

          <!-- A CSV, READ HERE AND NEVER UPLOADED.
               The plugin takes a real upload because WordPress hands it
               one. This app cannot cheaply: csrfProtect runs app-wide
               BEFORE any route and reads its token out of req.body, which
               for multipart/form-data nothing has parsed yet — its own
               comment says so. A plain form with a hidden _csrf and an
               enctype is therefore REFUSED, and making it work means
               posting by script with a header, a multer instance with its
               own limits, and a local error handler because server.js
               answers every multipart request with JSON. All of that to
               put text into a box you can already paste into.

               NO name ATTRIBUTE, AND THAT IS NOT AN OVERSIGHT. This form
               is urlencoded, and a urlencoded form submits a file input's
               FILENAME as the field's value. Named, it would post a
               stray string on every Plan. Unnamed, it is not submitted at
               all — which is the whole point.

               A LABEL RATHER THAN A BUTTON, so it matches the two beside
               it; the input itself is hidden because the browser's own
               file control cannot be styled to. -->
          <label class="btn btn-outline-light btn-sm ms-2 mb-0" for="topicsCsv">Load a CSV</label>
          <input type="file" id="topicsCsv" class="d-none"
                 accept=".csv,text/csv,text/plain">

          <div class="form-text text-white-50" id="topicsCsvNote"></div>

          <div class="form-text text-white-50">
            Free. Fill in the page and its search phrase first.
            <strong>Suggest topics</strong> adds to the list;
            <strong>Suggest different ones</strong> avoids everything already
            in the box.
            <!-- SAID HERE RATHER THAN LEFT TO THE ERROR PAGE. suggestForSite
                 builds its entire prompt around the target page, so with no
                 keyword it has nothing to suggest FROM and refuses by
                 saying a target page is required — which reads as a
                 contradiction on a screen that has just told you to leave
                 those two fields empty. -->
            Pillar campaigns have no target page, so suggestions are not
            available for them — type those topics yourself.
          </div>
        </div>

        <!-- THE LOADER, AND THE PARSER IT RUNS.
             csvTopics.js hands over its OWN SOURCE rather than this page
             keeping a hand-written copy, so there is one parser and
             test-csv-topics.js tests it. Two copies would be one tested
             parser and one that is whatever somebody typed, with no way
             to notice the day they stopped agreeing.

             NOT A BACKSLASH IN SIGHT, deliberately. This script is inside
             a template literal, where an unrecognised escape quietly
             becomes the letter after it — a hand-written /\\s+$/ would
             reach the browser as /s+$/ and a '\\n' as a real line break
             inside a string. So: String.fromCharCode for the newline,
             trimEnd instead of a regex. -->
        <script>
        (function () {
        ${browserSource()}

        function ieInitTopicTools() {
          var input = document.getElementById('topicsCsv');
          var box = document.getElementById('topics');
          var note = document.getElementById('topicsCsvNote');

          if (!input || !box) return;

          /* CLEAR TOPICS LIVES HERE NOW. It was an onclick attribute and the
           * CSP refused to run it — see the note on the button. Bound in the
           * one script that already holds a reference to the box. */
          var clear = document.getElementById('ieClearTopics');

          if (clear) {
            clear.addEventListener('click', function () {
              box.value = '';
              if (note) note.textContent = '';
              box.focus();
            });
          }

          var NL = String.fromCharCode(10);

          input.addEventListener('change', function () {
            var file = input.files && input.files[0];
            if (!file) return;

            var reader = new FileReader();

            reader.onload = function () {
              var lines = csvToTopicLines(String(reader.result || ''));

              /* ADDED, NOT SUBSTITUTED — the rule Suggest topics already
               * follows. Replacing the box would destroy a list somebody
               * had typed, and Clear topics exists for people who want it
               * gone. */
              var current = box.value.trimEnd();
              box.value = (current ? current + NL : '') + lines.join(NL);
              box.focus();

              /* WHAT LANDED, SAID OUT LOUD. A file with one usable row
               * and a file with none look identical in a box that is
               * already full, and the whole argument for reading it here
               * is that you can see what you got before you spend
               * anything. */
              if (note) {
                note.textContent = lines.length
                  ? lines.length + (1 === lines.length ? ' topic' : ' topics') + ' added from ' + file.name
                  : 'No topics found in ' + file.name;
              }

              /* CLEARED SO THE SAME FILE CAN BE PICKED TWICE. Without it
               * the change event does not fire again and the button looks
               * broken to anyone who edited the file and came back. */
              input.value = '';
            };

            reader.onerror = function () {
              if (note) note.textContent = 'That file could not be read.';
              input.value = '';
            };

            reader.readAsText(file);
          });
        }

        /* DEFERRED, LIKE THE TWO SCRIPTS EITHER SIDE OF THIS ONE. It works
         * today because it sits below the box it binds — and this file
         * already learned, with "Add ticked to my topics", that the
         * position of a <script> must not be a thing somebody has to know
         * not to change. */
        if ('loading' === document.readyState) {
          document.addEventListener('DOMContentLoaded', ieInitTopicTools);
        } else {
          ieInitTopicTools();
        }
        })();
        </script>

        <div class="row g-2 mb-4">
          <div class="col-md-4">
            <label class="form-label" for="startDate">First post</label>
            <input class="form-control" type="date" id="startDate" name="startDate"
                   value="${esc(form.startDate)}">
          </div>
          <div class="col-md-4">
            <label class="form-label" for="gapDays">Days between posts</label>
            <input class="form-control" type="number" id="gapDays" name="gapDays"
                   min="1" max="90" value="${esc(form.gapDays || 7)}">
          </div>
          <!-- type="time", THE SAME INPUT THE PLUGIN USES.
               It was type="number", 0 to 23 — which asked for 24-hour time
               and then had the answer read as UTC, so "9" meant four in the
               morning in Texas. The browser's own time control shows am/pm
               where the operating system says to, accepts minutes, and
               cannot produce a value the parser has to guess at.

               THE LABEL NAMES THE ZONE. A time field with no zone beside it
               is the bug this whole change exists to fix. -->
          <div class="col-md-4">
            <label class="form-label" for="publishTime">Time of day</label>
            <input class="form-control" type="time" id="publishTime" name="publishTime"
                   value="${esc(form.publishTime || '09:00')}">
            <div class="form-text text-white-50">
              ${esc(blog.timezone || 'UTC')} time.
            </div>
          </div>
        </div>

        <button class="btn btn-primary" type="submit" data-busy="Planning">Plan it</button>
        <span class="text-white-50 ms-2">Planning is free. Nothing is charged here.</span>
      </form>

      <script>
      /* A BUTTON THAT SAYS IT IS WORKING.
       *
       * Suggesting topics is a model call: several seconds of a page that
       * looks exactly as it did before it was pressed. The honest reading
       * of that screen is "nothing happened" — which is what Edwin said,
       * twice, about two different things on this page. One of those was
       * a real bug; a slow button that looks dead costs the same
       * confidence either way.
       *
       * ON THE FORM, NOT ON EACH BUTTON. The form has five submit buttons
       * and will grow more; a listener per button is four chances to
       * forget one. The submit event names the button that was pressed.
       *
       * DISABLED ON A TIMEOUT, AND THIS IS THE PART THAT LOOKS WRONG AND
       * IS NOT. A disabled submit button's name and value are left OUT of
       * the submission — so disabling it inside the submit handler can
       * drop fresh=1 or mode=publishAll and silently run the wrong
       * action. Deferring by a tick lets the browser serialise the form
       * first. The button is visibly busy either way.
       *
       * NO SPINNER ON "CLEAR TOPICS": it never submits at all,
       * and finishes before the finger leaves the mouse. */
      (function () {
      function ieInitBusy() {
        var form = document.getElementById('iePlanForm');
        if (!form) return;

        form.addEventListener('submit', function (event) {
          var button = event.submitter;
          if (!button || !button.getAttribute) return;

          var label = button.getAttribute('data-busy');
          if (!label) return;

          button.innerHTML =
            '<span class="spinner-border spinner-border-sm me-1" role="status"'
            + ' aria-hidden="true"></span>' + label + '&hellip;';

          /* Every other submit button goes quiet too, so a second press
             while the first is in flight cannot start a different action
             on top of it. */
          var all = form.querySelectorAll('button[type="submit"]');

          setTimeout(function () {
            for (var i = 0; i < all.length; i++) all[i].disabled = true;
          }, 0);
        });
      }

      if ('loading' === document.readyState) {
        document.addEventListener('DOMContentLoaded', ieInitBusy);
      } else {
        ieInitBusy();
      }
      })();
      </script>`,
  });
}

/** The blog and its campaigns, or null if it is not this person's. */
async function blogAndCampaigns(req) {
  const blog = await ownedBlog(req);
  if (!blog) return null;

  const campaigns = await BlogCampaign.find({ site: blog._id })
    .sort({ createdAt: -1 })
    .select('name status slots createdAt targetPage isPillar')
    .lean();

  /* The written articles, for the front-page picker.
   *
   * TITLE AND SLUG ONLY. The prose is several kilobytes an article and
   * this page shows a dropdown; selecting the whole document to read two
   * fields would load a 52-post blog's entire text to draw one <select>. */
  /* STILL NOT THE PROSE, now that the Articles list links to each
   * one's editor. The link needs the id, which Mongoose returns anyway,
   * and the title — never the sections. A 52-post blog's full text to
   * draw a table of titles is the thing this select exists to avoid. */
  const articles = await BlogPost.find({ site: blog._id })
    .select('title slug')
    .sort({ createdAt: 1 })
    .lean();

  return { blog, campaigns, articles };
}

/* -------------------------------------------------------------------------
 * The Articles screen
 *
 * Its own page because the list outgrew the blog's. 171 rows on Edwin's
 * plumbing blog, unpaged, above the campaign form.
 *
 * FIFTY A PAGE. Long enough that a blog of ordinary size is one screen and
 * the paging is never noticed; short enough that the longest blog is a
 * handful of pages rather than forty.
 * ---------------------------------------------------------------------- */

const ARTICLES_PER_PAGE = 50;

/**
 * The page number from a query string, as a number we are willing to use.
 *
 * EVERYTHING HERE ARRIVES FROM ANYBODY. `?page=-3` becomes skip(-150), which
 * Mongo rejects with an error that reaches the customer as "Something went
 * wrong"; `?page=abc` becomes NaN, which is neither zero nor a number and
 * skips an undefined amount. Both are one typed character away in the
 * address bar.
 *
 * Math.floor AFTER the guard, so '2.7' lands on 2 rather than being refused:
 * a fractional page is a nonsense request with an obvious intention.
 */
function pageNumber(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

router.get('/static-blogs/:id/articles', requireAuth, async (req, res) => {
  try {
    const blog = await ownedBlog(req);
    if (!blog) return notFound(res);

    const current = pageNumber(req.query && req.query.page);
    const skip = (current - 1) * ARTICLES_PER_PAGE;

    /* THE COUNT AND THE PAGE TOGETHER. The count is what makes "page 4 of 4"
     * possible and what the blog page's button reads; neither can be got
     * from a page of fifty rows. */
    const [total, articles] = await Promise.all([
      BlogPost.countDocuments({ site: blog._id }),
      BlogPost.find({ site: blog._id })
        .select('title slug')
        .sort({ createdAt: 1 })
        .skip(skip)
        .limit(ARTICLES_PER_PAGE)
        .lean(),
    ]);

    /* Math.max(1, …) IS AN EQUIVALENT MUTANT TODAY, recorded rather than
       tested around. On an empty blog ceil(0/50) is 0, and `pages > 1`
       hides the paging block either way — nothing a reader can see tells 0
       from 1. It stays because the day the empty state changes, 0 is what
       would print as "Page 1 of 0". */
    const pages = Math.max(1, Math.ceil(total / ARTICLES_PER_PAGE));
    const name = (blog.business && blog.business.name) || 'Untitled blog';

    /* NUMBERED FROM THE SKIP, NOT FROM THE ROW. Restarting at 1 on page two
     * would make "the fourth article" mean two different things on two
     * screens of one blog. */
    const rows = articles.map((a, i) => `
      <tr>
        <td class="rownum">${skip + i + 1}</td>
        <td>${esc(a.title || a.slug)}</td>
        <td class="text-white-50 small"><code>/${esc(a.slug)}/</code></td>
        <td class="text-end">
          <a href="/static-blogs/${blog._id}/articles/${a._id}/edit"
             class="btn btn-sm btn-outline-light">Edit</a>
        </td>
      </tr>`).join('');

    const list = articles.length
      ? `<table class="table table-navy table-striped align-middle">
           <thead><tr><th></th><th>Article</th><th>Address</th><th></th></tr></thead>
           <tbody>${rows}</tbody>
         </table>`
      /* A SENTENCE, NOT AN EMPTY TABLE. Headings over nothing read as a
         screen that failed to load rather than a blog that has not been
         written yet. */
      : `<p class="lead text-white-50">${
          total
            ? 'There is nothing on this page. Go back to the first one.'
            : 'Nothing has been written for this blog yet.'
        }</p>`;

    /* PREVIOUS AND NEXT ONLY, not a row of numbered pages. Four pages of
       articles is a thing you step through; it is not a thing you jump
       around in, and a number strip would be the widest element on the
       screen for no use anybody has. */
    const step = (to, label, enabled) => (enabled
      ? `<a href="/static-blogs/${blog._id}/articles?page=${to}"
            class="btn btn-outline-light">${label}</a>`
      : `<span class="btn btn-outline-light disabled">${label}</span>`);

    const paging = pages > 1
      ? `<div class="d-flex align-items-center gap-2 mt-3">
           ${step(current - 1, '&larr; Previous', current > 1)}
           <span class="text-white-50 small">Page ${current} of ${pages}</span>
           ${step(current + 1, 'Next &rarr;', current < pages)}
         </div>`
      : '';

    send(res, page({
      title: `Articles — ${esc(name)}`,
      body: `
        <p><a href="/static-blogs/${blog._id}" class="link-light">&larr; ${esc(name)}</a></p>

        <h1 class="mb-1">Articles</h1>
        <p class="text-white-50">
          ${total} ${1 === total ? 'article' : 'articles'} on
          <strong>${esc(blog.siteUrl || name)}</strong>.
          Edits reach the live site the next time you publish.
        </p>

        ${list}
        ${paging}`,
    }));

  } catch (err) {
    log.error('staticBlogs.articles.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not list those articles</h1>
             <a href="/static-blogs/${esc(req.params.id)}" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

router.get('/static-blogs/:id', requireAuth, async (req, res) => {
  try {
    const found = await blogAndCampaigns(req);
    if (!found) return notFound(res);

    send(res, blogPageSpec({
      blog: found.blog,
      campaigns: found.campaigns,
      articles: found.articles,
      form: { csrfField: res.locals.csrfField },
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
 * Topic suggestion
 *
 * The same rules /api/blog/suggest runs for the plugin, from a screen that
 * has no plugin and no signature. utils/blog/suggestForSite.js is where
 * they live; this translates a form into its arguments and the answer back
 * into the same page, with the ideas in the topics box.
 * ---------------------------------------------------------------------- */

router.post('/static-blogs/:id/suggest', requireAuth, async (req, res) => {
  try {
    const found = await blogAndCampaigns(req);
    if (!found) return notFound(res);

    const { blog, campaigns, articles } = found;

    /* WHAT THE PERSON TYPED, CARRIED BACK WHATEVER HAPPENS. A suggestion
     * that cleared the form would cost them the schedule and the campaign
     * name every time they asked for ideas. */
    const form = {
      csrfField: res.locals.csrfField,
      name: req.body.name,
      /* CARRIED BACK LIKE EVERY OTHER FIELD. A suggestion that silently
       * unticked the Pillar box would hand back a form that looks the
       * same and plans a different campaign. */
      isPillar: '1' === String(req.body.isPillar || ''),
      targetUrl: String(req.body.targetUrl || '').trim(),
      targetKeyword: String(req.body.targetKeyword || '').trim(),
      topics: req.body.topics,
      startDate: req.body.startDate,
      gapDays: req.body.gapDays,
      publishTime: req.body.publishTime,
    };

    /* "SUGGEST DIFFERENT ONES" IS THIS AND NOTHING ELSE.
     *
     * suggestForSite already takes an `avoid` list — it is how a second
     * campaign against the same page stops proposing the first campaign's
     * topics. Nothing ever passed one from here, so the only thing the
     * model avoided was what had been SAVED, and what you had merely typed
     * or just been given was invisible to it.
     *
     * THE TOPIC, NOT THE WHOLE LINE. A line is `topic | search phrase`;
     * sending it whole would hand the model a string no topic will ever
     * equal, and the avoid list would quietly match nothing. parseTopics
     * already splits it the right way, so it does the splitting here too
     * rather than a second reading of the same format. */
    const fresh = '1' === String(req.body.fresh || '');

    /* WHAT "DIFFERENT ONES" HAS TO AVOID, AND IT IS TWO LISTS NOW.
     *
     * It used to be one: the suggestions were appended straight into the
     * topics box, so the box held everything you had seen. Since they
     * come back as a tick-list instead, the ideas you just rejected are
     * on screen and NOWHERE ELSE — not in the box, not in the database.
     * Avoid only the box and pressing the button hands you the same six
     * back, which is precisely the broken-feeling behaviour the avoid
     * list was added to prevent.
     *
     * So the card carries them in a hidden field and they come back here.
     * Not a session, not a cache: the page already knows them, and the
     * form is already a round trip. */
    const avoid = fresh
      ? [
          ...parseTopics(req.body.topics).map(t => t.topic),
          ...parseTopics(req.body.shown).map(t => t.topic),
        ]
      : [];

    const result = await suggestForSite({
      site: blog,
      requestId: req.id,
      body: {
        targetPage: { url: form.targetUrl, keyword: form.targetKeyword },
        avoid,
      },
    });

    if (!result.ok) {
      return send(res, blogPageSpec({
        blog,
        campaigns,
        articles,
        form,
        status: result.code,
        notice: `<div class="alert alert-warning">${esc(result.body.error)}</div>`,
      }));
    }

    const { topics, warnings, avoided } = result.body;

    /* THE SUGGESTIONS NO LONGER GO STRAIGHT INTO THE BOX — 18 October.
     *
     * They used to be joined into lines and appended, which made the
     * textarea the one place ideas lived. Edwin's screenshot of twelve
     * wrapped lines is what ended it: a monospace block where every row
     * spans two lines and the only way to reject one is to select the
     * right half of it and press delete. "This looks very crowded."
     *
     * So they come back as a list to tick, and the box keeps only what
     * was typed. Ticking is a click; rejecting is leaving a box alone.
     *
     * NOTHING IS ADDED UNTIL THE PERSON SAYS SO, which is the part worth
     * stating: the suggestions are not in the textarea, so pressing Plan
     * without ticking anything plans what you typed and nothing else.
     * That is a change in behaviour and the screen says it. */
    const notes = [
      fresh
        ? `<strong>${topics.length} different ideas.</strong>`
        : `<strong>${topics.length} ideas.</strong>`,
      'Tick the ones you want and add them to your list.',
      fresh && avoid.length
        ? `We avoided the ${avoid.length} you already had.`
        : '',
      avoided > avoid.length
        ? `We avoided ${avoided - avoid.length} topic${1 === avoided - avoid.length ? '' : 's'} already used for this page.`
        : '',
    ].filter(Boolean).join(' ');

    send(res, blogPageSpec({
      blog,
      campaigns,
      articles,
      form,
      suggestions: topics,
      notice: `
        <div class="alert alert-success">${notes}</div>
        ${warnings && warnings.length
          ? `<div class="alert alert-warning">
               <strong>Worth a look:</strong>
               <ul class="mb-0">${warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul>
             </div>`
          : ''}`,
    }));

  } catch (err) {
    log.error('staticBlogs.suggest.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not suggest topics</h1>
             <a href="/static-blogs/${esc(req.params.id)}" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

/* -------------------------------------------------------------------------
 * Approving
 *
 * The rules are utils/blog/approveCampaign.js's — the credit gate, the
 * conditional claim that stops two approvals starting two batches, the
 * poll, the lost-batch detection. The plugin reaches them through
 * /api/blog/write; this screen reaches the same function directly, because
 * requireSite refuses anything that is not a WordPress site.
 *
 * ONE ROUTE FOR APPROVING AND FOR CHECKING, exactly as the plugin has it.
 * The question is the same either way — "is this campaign written yet?" —
 * and approveCampaign answers it. Pressing the button again is a poll, not
 * a second batch: the campaign's status is the lock.
 *
 * THE WRITING ITSELF IS THE EXISTING JOB. approveCampaign enqueues a
 * `blog` job and server.js already runs those through writeCampaign, which
 * knows nothing about WordPress — it works from the campaign and the link
 * plan. Nothing new writes posts for Cloudflare blogs.
 * ---------------------------------------------------------------------- */

router.post('/static-blogs/:id/campaigns/:campaignId/approve', requireAuth, async (req, res) => {
  try {
    const blog = await ownedBlog(req);
    if (!blog) return notFound(res);

    const result = await approveCampaign({
      site: blog,
      body: { campaignId: req.params.campaignId },
      requestId: req.id,
      baseUrl: baseUrl(req),
    });

    const body = result.body || {};

    if (!result.ok) {
      /* THE CREDIT REFUSAL GETS ITS OWN ANSWER, because it is the one a
       * person can act on. Everything else is a sentence; this is a
       * shortfall and a way to fix it. */
      const buy = body.buyCreditsUrl
        ? `<a href="${esc(body.buyCreditsUrl)}" class="btn btn-primary mt-3">Buy credits</a>`
        : '';

      return send(res, page({
        status: result.code,
        title: 'Not approved',
        body: `<h1 class="h2">That campaign was not approved</h1>
               <p class="lead">${esc(body.error)}</p>
               ${body.quote ? `<p class="text-white-50">It needs ${esc(body.quote.total)} credits.</p>` : ''}
               ${buy}
               <a href="/static-blogs/${blog._id}" class="btn btn-outline-light mt-3 ms-2">Back to the blog</a>`,
      }));
    }

    if ('written' === body.status) {
      return send(res, page({
        title: 'Already written',
        body: `<h1 class="h2">Every post is written</h1>
               <p class="lead">
                 ${esc(body.written)} of ${esc(body.total)} written.
                 ${body.failed && body.failed.length
                   ? `<span class="text-warning">${esc(body.failed.length)} failed.</span>`
                   : ''}
               </p>
               <p class="text-white-50">Publish the blog to put them on the site.</p>
               <a href="/static-blogs/${blog._id}" class="btn btn-primary mt-3">Back to the blog</a>`,
      }));
    }

    /* WRITING. The batch runs in the background, so this is a snapshot and
     * says so — a page that looked final while a job was still running is
     * how somebody concludes it has stalled and presses the button again. */
    send(res, page({
      title: 'Writing',
      body: `<h1 class="h2">Writing</h1>
             <p class="lead">
               ${esc(body.done ?? 0)} of ${esc(body.total ?? 0)} done.
               ${body.cancelling ? '<span class="text-warning">Stopping.</span>' : ''}
             </p>
             ${body.quote
               ? `<p class="text-white-50">
                    ${esc(body.toWrite)} posts this run, ${esc(body.quote.total)} credits.
                  </p>`
               : ''}
             <p class="text-white-50">
               This takes a few minutes. Press Check progress on the blog's page
               to see where it has got to.
             </p>
             <a href="/static-blogs/${blog._id}" class="btn btn-primary mt-3">Back to the blog</a>`,
    }));

  } catch (err) {
    log.error('staticBlogs.approve.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not approve that campaign</h1>
             <a href="/static-blogs/${esc(req.params.id)}" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

/* -------------------------------------------------------------------------
 * Publishing
 *
 * The one place a blog actually reaches the internet. Everything it needs
 * is in utils/blog/render/publishBlog.js; this translates a button into a
 * call and the answer into a page.
 *
 * BY HAND BEFORE BY SCHEDULE, deliberately. A job that failed quietly at
 * 3am is a bad way to discover that the token has the wrong permission.
 * ---------------------------------------------------------------------- */

router.post('/static-blogs/:id/publish', requireAuth, async (req, res) => {
  try {
    const blog = await ownedBlog(req);
    if (!blog) return notFound(res);

    /* THE BUTTON IS READ ONCE, INTO TWO BOOLEANS.
     *
     * An allow-list rather than a pair of string tests, because this value
     * comes from the browser and the safe answer to anything unrecognised
     * is the cautious one: preview, due only. A typo in the HTML then
     * shows a preview instead of deploying a site.
     *
     * includeScheduled IS A REAL BOOLEAN BY THE TIME IT LEAVES HERE.
     * isLive insists on exactly `true` — see the note there — and the
     * reason that insistence exists is this line, which is the one place a
     * form string could otherwise walk into the renderer. */
    const MODES = {
      preview:    { dryRun: true,  includeScheduled: false },
      publish:    { dryRun: false, includeScheduled: false },
      previewAll: { dryRun: true,  includeScheduled: true },
      publishAll: { dryRun: false, includeScheduled: true },
    };

    const { dryRun, includeScheduled } =
      MODES[String(req.body.mode || '')] || MODES.preview;

    const result = await publishBlog({
      blog,
      requestId: req.id,
      dryRun,
      includeScheduled,
    });

    if (!result.ok) {
      return send(res, page({
        status: 400,
        title: dryRun ? 'Nothing to preview' : 'Not published',
        body: `<h1 class="h2">${dryRun ? 'Nothing to preview' : 'That did not publish'}</h1>
               <p class="lead">${esc(result.error)}</p>
               ${!dryRun && result.projectMissing
                 /* THE ONE FAILURE WHERE WAITING IS THE ANSWER, and until
                  * 19 October the screen could not say so. A campaign died
                  * on Cloudflare's `[code: 8000000]` — their own "unknown
                  * error", carrying nothing to act on — and all this page
                  * offered was two wrangler errors, the second of them
                  * merely the consequence of the first. Hours later the
                  * same publish worked with nothing changed.
                  *
                  * NO CAUSE IS NAMED, because none is known. Cloudflare
                  * said "unknown error" and meant it; a sentence here
                  * blaming a subdomain still being released would be a
                  * guess in the voice of an explanation. What is certain
                  * is what survived and what to do next, so that is all
                  * this says.
                  *
                  * AND ONLY WHEN deploy.js SAYS SO. Both halves of that
                  * judgement — a create that did not succeed and a deploy
                  * that says the project is missing — are things only
                  * deploy.js saw. See the note there for why either half
                  * alone would send somebody off to wait for a permission
                  * error to heal. */
                 ? '<p>Nothing was lost: your articles are still written and still '
                   + 'scheduled. This is usually temporary. Try publishing again in a '
                   + 'few minutes.</p>'
                 : ''}
               ${result.output
                 ? `<pre class="p-3 bg-dark text-white-50 small" style="white-space:pre-wrap">${esc(String(result.output).slice(-2000))}</pre>`
                 : ''}
               <a href="/static-blogs/${blog._id}" class="btn btn-primary mt-3">Back to the blog</a>`,
      }));
    }

    /* RECORDED ONLY ON A REAL DEPLOY. A preview that stamped lastDeployAt
     * would tell you the blog is live when nothing had moved. */
    if (!dryRun) {
      await BlogSite.updateOne(
        { _id: blog._id },
        { $set: {
          project: result.project || blog.project || '',
          lastDeployAt: new Date(),
          lastDeployUrl: result.url || '',
        } }
      );

      /* AND THE SLOTS THEMSELVES, WHICH NOTHING DID UNTIL 19 OCTOBER.
       *
       * A Cloudflare slot used to sit at `ready` for ever: the article was
       * on the internet and the campaign record did not know it. The
       * scheduler cannot be written on top of that — "what still needs
       * publishing" has no answer — so this is the step that gives it one.
       *
       * AFTER the deploy and inside the !dryRun branch, deliberately. A
       * preview must leave the campaign exactly as it found it, and an
       * article is not published until Cloudflare has actually taken it.
       *
       * utils/blog/markPublished.js rather than ten lines here, because
       * the scheduler is about to be the second caller. */
      await markPublished({ pages: result.pages, requestId: req.id });
    }

    /* NUMBERED, BECAUSE THIRTY-SEVEN ROWS CANNOT BE COUNTED BY EYE. Edwin
     * published 37 articles and this table listed them bare, so "how many
     * went up" and "which one is the twentieth" both meant counting down a
     * screen. The plan table has numbered its slots since it was written;
     * this one and the Articles list had not caught up.
     *
     * THE ROW'S POSITION, NOT THE SLOT INDEX. This is what was deployed in
     * the order it was deployed. Slot numbers would be three campaigns'
     * sequences interleaved, so two rows would both be "1". */
    const rows = result.pages.map((p, i) => `
      <tr>
        <td class="rownum">${i + 1}</td>
        <td>${esc(p.post.title || p.post.slug)}</td>
        <td class="text-white-50">${esc(p.url)}</td>
        <td class="text-white-50">${p.isHome ? 'front page' : ''}</td>
      </tr>`).join('');

    /* TWO DIFFERENT MISTAKES, TWO DIFFERENT SENTENCES. A missing money,
     * prev or next means the writer dropped a marker it was told to use
     * — nothing for the owner to do but rewrite. A missing link means the
     * owner filled in "Your own link" and never wrote {{link}} around any
     * words, which is HIS to fix and is fixed in ten seconds once he is
     * told the truth. One message blaming the writer for both sends him
     * hunting through prose he did not write. */
    const everyToken = result.missing.flatMap(m => m.tokens);
    const ownerMissed = everyToken.some(t => OWNER_TOKENS.has(t));
    const writerMissed = everyToken.some(t => !OWNER_TOKENS.has(t));

    const warnings = result.missing.length
      ? `<div class="alert alert-warning">
           <strong>Some articles are missing a link:</strong>
           <ul class="mb-0">${result.missing.map(m =>
             `<li>${esc(m.slug)} — ${esc(m.tokens.join(', '))}</li>`).join('')}</ul>
           <p class="mb-0 mt-2 small">
             They are published anyway — those links are plain text on the page.
           </p>
           ${writerMissed ? `<p class="mb-0 mt-2 small">
             For <code>money</code>, <code>prev</code> and <code>next</code>:
             the writer did not use the phrase it was given.
           </p>` : ''}
           ${ownerMissed ? `<p class="mb-0 mt-2 small">
             For <code>link</code>: you filled in <strong>Your own link</strong>
             but no words in the article are wrapped in
             <code>{{link}}…{{/link}}</code>. Edit the article and wrap the
             phrase you want to be the link.
           </p>` : ''}
         </div>`
      : '';

    send(res, page({
      title: dryRun ? 'Preview' : 'Published',
      body: `
        <h1 class="h2 mb-3">${dryRun ? 'This is what would go' : 'Published'}</h1>

        ${includeScheduled
          ? `<div class="alert alert-warning">
               <strong>Schedule ignored.</strong> Every written article is
               included, whatever its date. Anything that was dated in the
               future is now dated today, so no page on the site carries a
               date that has not happened.
             </div>`
          : ''}

        <!-- WHAT THE FIRST DEPLOY DID BESIDES DEPLOYING.
             Only ever present on a blog's first publish. The domain half
             is the one worth a warning: the deploy succeeds whether or
             not the domain attaches, so without this the blog goes live
             at a pages.dev address while every canonical on it names a
             domain that answers nothing — and the screen would say
             "Published" and nothing else. -->
        <!-- THE TWO HALVES REPORTED SEPARATELY, BECAUSE THEY FAILED
             SEPARATELY. This said "the domain was attached" and meant
             only that Cloudflare had registered it on the project — true,
             and useless: the DNS record was never created, so the address
             returned NXDOMAIN while the screen and the log both reported
             success. One sentence could not tell that story, so there are
             now two. -->
        ${result.setup ? (() => {
          const attached = result.setup.attached || {};
          const dns = result.setup.dns || {};
          const done = attached.ok && dns.ok;

          return `
          <div class="alert ${done ? 'alert-info' : 'alert-warning'}">
            <strong>First publish for this blog.</strong>
            ${result.setup.created
              ? 'The Cloudflare project was created.'
              : 'The Cloudflare project was already there.'}

            <ul class="mb-0 mt-2">
              <li>
                <strong>Registered on the project:</strong>
                ${attached.ok
                  ? 'yes'
                  : `no — ${esc(String(attached.error || 'unknown reason'))}`}
              </li>
              <li>
                <strong>DNS record:</strong>
                ${dns.ok
                  ? (false === dns.created ? 'already there' : 'created')
                  : `not created — ${esc(String(dns.error || 'unknown reason'))}`}
              </li>
            </ul>

            ${done
              ? `<p class="mb-0 mt-2">
                   ${esc(blog.siteUrl)} should answer within a minute or two,
                   once Cloudflare has issued its certificate.
                 </p>`
              : `<!-- THE EXACT THING TO DO, because the last time this
                      failed it took an evening to work out. -->
                 <p class="mb-0 mt-2">
                   The blog is live at the Cloudflare address below, but
                   every canonical on it names <strong>${esc(blog.siteUrl)}</strong>,
                   so that is the address Google will try to index.
                 </p>
                 <p class="mb-0 mt-2">
                   To finish it by hand: in Cloudflare, open the DNS tab for
                   that domain and add a <strong>CNAME</strong> named
                   <code>${esc(String(blog.siteUrl).split('.')[0])}</code>
                   pointing at
                   <code>${esc(String(result.url || '').replace(/^https:\/\//, '').replace(/\/$/, ''))}</code>,
                   with the proxy <strong>on</strong>.
                 </p>
                 <p class="mb-0 mt-2 small">
                   To make this automatic next time, the API token needs
                   <strong>Zone → Zone → Read</strong> and
                   <strong>Zone → DNS → Edit</strong>.
                 </p>`}
          </div>`;
        })() : ''}

        <p class="lead">
          ${result.pages.length} article${1 === result.pages.length ? '' : 's'},
          ${result.files} file${1 === result.files ? '' : 's'}.
          ${dryRun ? 'Nothing has been sent.' : ''}
        </p>

        <!-- BOTH ADDRESSES, THE BLOG'S OWN ONE FIRST — the same change
             the blog page got, and for the same reason. "See it" linked
             to the pages.dev address because that is what the deploy
             reports, so Edwin published to a subdomain, pressed the link
             and landed somewhere else. The domain is what every canonical
             on the site names, so it is the address that matters; the
             Cloudflare one stays because it is the one that works while
             DNS is still catching up. -->
        ${!dryRun && result.url ? `
        <p class="mb-4">
          <a href="https://${esc(blog.siteUrl)}/" target="_blank" rel="noopener">https://${esc(blog.siteUrl)}/</a>
          <span class="text-white-50 small">— your domain, and what the pages say they are.</span>
          <br>
          <a href="${esc(result.url)}" target="_blank" rel="noopener" class="link-light">${esc(result.url)}</a>
          <span class="text-white-50 small">— Cloudflare's address, which always works.</span>
        </p>` : ''}

        ${warnings}

        <table class="table table-navy align-middle">
          <thead><tr><th></th><th>Article</th><th>Address</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>

        <a href="/static-blogs/${blog._id}" class="btn btn-primary">Back to the blog</a>`,
    }));

  } catch (err) {
    log.error('staticBlogs.publish.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not publish that blog</h1>
             <a href="/static-blogs/${esc(req.params.id)}" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

/* -------------------------------------------------------------------------
 * Deleting a blog
 *
 * THE WORDPRESS ONE REFUSES WHEN THERE ARE CAMPAIGNS. This one must not,
 * and the difference is not an oversight in either.
 *
 * /blog-sites/:id/delete removes a LICENCE ROW. Its campaigns are posts on
 * somebody's live WordPress site that this app does not control, so a row
 * with history is a record of work that still exists out there, and
 * deleting it would orphan the record while the posts carry on.
 *
 * A Cloudflare blog is the opposite: we own every part of it. The articles
 * exist in Mongo and on a Pages project we created. Refusing to delete a
 * blog that has campaigns would mean the only blogs you can remove are the
 * ones you never used — which is not a delete button, it is a cancel
 * button for a typo.
 *
 * SO IT CASCADES, AND THAT IS WHY THERE IS A CONFIRMATION SCREEN. Posts,
 * campaigns, the blog, and optionally the Pages project. Credits already
 * spent are not refunded and the page says so, because the one thing
 * nobody should learn afterwards is what it cost.
 * ---------------------------------------------------------------------- */

router.get('/static-blogs/:id/delete', requireAuth, async (req, res) => {
  try {
    const blog = await ownedBlog(req);
    if (!blog) return notFound(res);

    /* COUNTED NOW, NOT TRUSTED FROM A PAGE THAT MAY BE MINUTES OLD. The
     * same reasoning as the WordPress delete, and the numbers here are
     * what somebody is about to agree to destroy. */
    const campaigns = await BlogCampaign.countDocuments({ site: blog._id });
    const articles = await BlogPost.countDocuments({ site: blog._id });

    send(res, page({
      title: 'Delete this blog?',
      body: `
        <h1 class="h2 mb-3">Delete ${esc((blog.business && blog.business.name) || 'this blog')}?</h1>
        <p class="text-white-50">${esc(blog.siteUrl)}</p>

        <div class="alert alert-danger">
          <strong>This cannot be undone.</strong>
          <ul class="mb-0 mt-2">
            <li>${campaigns} campaign${1 === campaigns ? '' : 's'}</li>
            <li>${articles} written article${1 === articles ? '' : 's'}</li>
            ${blog.project
              ? `<li>the Cloudflare project <code>${esc(blog.project)}</code>, if you tick the box</li>`
              : '<li>no Cloudflare project — this blog has never published</li>'}
          </ul>
          <p class="mb-0 mt-2">
            Credits already spent on those articles are not refunded.
          </p>
        </div>

        <form method="post" action="/static-blogs/${blog._id}/delete">
          ${res.locals.csrfField || ''}

          ${blog.project ? `
          <!-- OFFERED, BECAUSE LEAVING IT BEHIND HAS A COST THAT IS NOT
               OBVIOUS. A Pages project holds its pages.dev subdomain for
               as long as it exists, so adding the same domain again gets
               a project with a suffix — which is where
               appliancerepaircedarpark-com-bx6 came from. Ticked by
               default for that reason; untick it to keep the project. -->
          <div class="form-check mb-3">
            <input class="form-check-input" type="checkbox" value="1"
                   id="dropProject" name="dropProject" checked>
            <label class="form-check-label" for="dropProject">
              Also delete the Cloudflare project, so the name is free again
            </label>
          </div>` : ''}

          <!-- TYPED, NOT CLICKED. Everything else on this screen is one
               button press away from the next; this one destroys work that
               was paid for. Typing the domain is a few seconds and it
               makes the wrong blog almost impossible to delete. -->
          <div class="mb-3">
            <label class="form-label" for="confirm">
              Type <code>${esc(blog.siteUrl)}</code> to confirm
            </label>
            <input class="form-control" id="confirm" name="confirm" autocomplete="off">
          </div>

          <button class="btn btn-danger" type="submit">Delete it</button>
          <a href="/static-blogs/${blog._id}" class="btn btn-outline-light ms-2">Cancel</a>
        </form>`,
    }));

  } catch (err) {
    log.error('staticBlogs.deleteForm.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not load that</h1>
             <a href="/static-blogs" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

router.post('/static-blogs/:id/delete', requireAuth, async (req, res) => {
  try {
    const blog = await ownedBlog(req);
    if (!blog) return notFound(res);

    /* THE TYPED DOMAIN, COMPARED TO THE STORED ONE. Trimmed because a
     * copy-paste brings a space with it often enough to matter, and
     * refusing a correct answer over whitespace would just teach somebody
     * to stop reading the screen. */
    const typed = String(req.body.confirm || '').trim().toLowerCase();

    if (typed !== String(blog.siteUrl || '').toLowerCase()) {
      return send(res, page({
        status: 400,
        title: 'Not deleted',
        body: `<h1 class="h2">That did not match</h1>
               <p class="lead">
                 Nothing was deleted. Type the domain exactly as it is shown.
               </p>
               <a href="/static-blogs/${blog._id}/delete" class="btn btn-primary mt-3">Try again</a>`,
      }));
    }

    /* THE CLOUDFLARE SIDE FIRST, AND FAILING IT DOES NOT STOP THE REST.
     *
     * If the project cannot be removed — a token short a permission, a
     * project somebody already deleted by hand — the right outcome is
     * still to clear our own records, because the alternative is a blog
     * nobody can delete at all. The reason is logged and shown. */
    let project = null;
    let released = null;

    if (blog.project && '1' === String(req.body.dropProject || '')) {
      /* THE DOMAIN COMES OFF FIRST, AND THAT ORDER IS THE WHOLE FIX.
       *
       * Cloudflare refuses to delete a Pages project that is still
       * serving an active custom domain. It showed in the log as three
       * deletes that worked and one that did not: the three had domains
       * still `pending`, and the fourth — all-about-roofing — had one
       * that had gone live. Edwin read the warning and thought his blog
       * had not been deleted. It had; the project had not.
       *
       * `expected` IS WHAT MAKES THIS SAFE TO RUN. It is the pages.dev
       * host this blog actually deploys to, so removeDnsRecord() can
       * refuse any record that is not the one we created. The zone may
       * hold a live site on the same domain — Edwin's does — and one
       * careless delete in here would take it down. */
      const expected = String(blog.lastDeployUrl || '')
        .replace(/^https:\/\//, '')
        .replace(/\/$/, '');

      released = await releaseDomain({
        project: blog.project,
        domain: blog.siteUrl,
        expected: expected || undefined,
      });

      project = await deleteProject({ project: blog.project, env: childEnv() });

      log.info('staticBlogs.projectDeleted', {
        requestId: req.id,
        siteId: String(blog._id),
        project: blog.project,
        domainDetached: Boolean(released.detached && released.detached.ok),
        dnsRemoved: Boolean(released.dns && released.dns.ok && released.dns.removed),
        dnsError: released.dns && released.dns.ok ? '' : String((released.dns || {}).error || ''),
        ok: project.ok,
      });
    }

    /* CHILDREN BEFORE THE PARENT. Delete the blog first and a failure
     * half way through leaves campaigns and posts pointing at a site that
     * is gone — invisible rows nothing lists and nothing cleans up. */
    const posts = await BlogPost.deleteMany({ site: blog._id });
    const campaigns = await BlogCampaign.deleteMany({ site: blog._id });
    await BlogSite.deleteOne({ _id: blog._id, user: req.user._id });

    log.info('staticBlogs.deleted', {
      requestId: req.id,
      userId: String(req.user._id),
      siteId: String(blog._id),
      siteUrl: blog.siteUrl,
      campaigns: campaigns.deletedCount || 0,
      articles: posts.deletedCount || 0,
      projectDeleted: Boolean(project && project.ok),
    });

    send(res, page({
      title: 'Deleted',
      body: `
        <h1 class="h2 mb-3">The blog is deleted</h1>

        <!-- THE HEADING SAYS THE BLOG, NOT "Deleted".
             It read "Deleted" with a warning underneath about the
             Cloudflare project, and Edwin reasonably took the whole page
             to mean the delete had failed. It had not: the blog, its
             campaign and three articles were gone, and only the project
             remained. The page has to say which of several things went
             before it says what did not. -->
        <p class="lead">
          <strong>${esc(blog.siteUrl)}</strong> is gone from ${esc(APP_NAME)}, with
          ${campaigns.deletedCount || 0} campaign${1 === campaigns.deletedCount ? '' : 's'}
          and ${posts.deletedCount || 0} article${1 === posts.deletedCount ? '' : 's'}.
          That part cannot fail and did not.
        </p>

        ${released || project ? (() => {
          const detached = (released && released.detached) || {};
          const dns = (released && released.dns) || {};
          const gone = (!project || project.ok) && detached.ok && dns.ok;

          return `
          <div class="alert ${gone ? 'alert-info' : 'alert-warning'}">
            <strong>What happened in Cloudflare</strong>
            <ul class="mb-0 mt-2">
              <li>
                <strong>Domain unlinked from the project:</strong>
                ${detached.ok ? 'yes' : `no — ${esc(String(detached.error || 'unknown reason'))}`}
              </li>
              <li>
                <strong>DNS record removed:</strong>
                ${dns.ok
                  ? (dns.removed ? 'yes' : 'there was none to remove')
                  : `no — ${esc(String(dns.error || 'unknown reason'))}`}
              </li>
              <li>
                <strong>Pages project deleted:</strong>
                ${!project ? 'not asked for' : (project.ok ? 'yes' : 'no')}
              </li>
            </ul>

            ${project && !project.ok ? `
            <pre class="mb-0 mt-2 small" style="white-space:pre-wrap">${esc(String(project.output || '').slice(-1000))}</pre>` : ''}

            ${gone ? '' : `
            <!-- ONLY THIS BLOG'S OWN HOSTNAME IS EVER TOUCHED. Said out
                 loud because it is the first thing anyone worries about
                 on a domain that also runs something they care about. -->
            <p class="mb-0 mt-2">
              Anything left over is in the Cloudflare dashboard, under
              <strong>Workers &amp; Pages</strong> and the
              <strong>DNS</strong> tab for that domain. Only
              <code>${esc(blog.siteUrl)}</code> is involved — the rest of
              the domain was never touched.
            </p>`}
          </div>`;
        })() : ''}

        <a href="/static-blogs" class="btn btn-primary">Your blogs</a>`,
    }));

  } catch (err) {
    log.error('staticBlogs.delete.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not delete that blog</h1>
             <a href="/static-blogs/${esc(req.params.id)}" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

/* -------------------------------------------------------------------------
 * The blog's timezone
 *
 * ONE SETTING, ONE ROUTE, AND IT CHANGES NOTHING ALREADY PLANNED.
 *
 * A campaign's slots are stored as real instants, decided when it was
 * planned. Moving the blog's zone afterwards does NOT move them, and it
 * deliberately does not: rewriting the dates of a campaign that is part way
 * through posting would shuffle articles that are already on the site, and
 * an article that moved backwards would be republished with a date earlier
 * than the one Google first saw.
 *
 * So this affects the NEXT campaign. The screen says so, because a setting
 * that silently applies to some things and not others is worse than one
 * that applies to nothing.
 * ---------------------------------------------------------------------- */

router.post('/static-blogs/:id/timezone', requireAuth, async (req, res) => {
  try {
    const blog = await ownedBlog(req);
    if (!blog) return notFound(res);

    const wanted = String(req.body.timezone || '').trim();

    /* REFUSED RATHER THAN QUIETLY DEFAULTED. On the Add form an unusable
     * zone falls back to UTC, because the alternative is losing the whole
     * blog over a dropdown. Here there is something to go back to, and a
     * silent fall back to UTC is exactly the failure this field was added
     * to end — somebody picks their zone, the screen says UTC, and nobody
     * reads it again. */
    if (!isKnownZone(wanted)) {
      return send(res, page({
        status: 400,
        title: 'That timezone is not one we know',
        body: `<h1 class="h2">That is not a timezone we can use</h1>
               <p class="lead">
                 It has to be a name the scheduler recognises, such as
                 <code>America/Chicago</code>.
               </p>
               <a href="/static-blogs/${blog._id}" class="btn btn-primary mt-3">Back to the blog</a>`,
      }));
    }

    await BlogSite.updateOne({ _id: blog._id }, { $set: { timezone: wanted } });

    log.info('staticBlogs.timezoneSet', {
      requestId: req.id,
      siteId: String(blog._id),
      from: blog.timezone || '(unset)',
      to: wanted,
    });

    res.redirect(`/static-blogs/${blog._id}`);

  } catch (err) {
    log.error('staticBlogs.timezone.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not save that</h1>
             <a href="/static-blogs/${esc(req.params.id)}" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

/* -------------------------------------------------------------------------
 * Editing an article
 *
 * WHY THIS CAN EXIST AT ALL, AND ONLY HERE.
 *
 * A WordPress post is written once and then repaired in place, one span
 * at a time, because rewriting a published post is expensive. A static
 * blog is re-rendered from scratch on every deploy — so an edit is just
 * a different document in Mongo, and the next publish picks it up with
 * no repair step, no sync, and nothing to go stale. That is the whole
 * reason this is two routes and not a subsystem.
 *
 * WHAT IS EDITABLE: the title (which is the H1), the meta description,
 * each section's heading (H2) and its paragraphs, and the URL this one
 * article's money link points at.
 *
 * WHAT IS NOT: the slug. It is in the canonical, the sitemap, the feed
 * and every internal link, so changing it after a publish kills the old
 * address and breaks anything pointing at it. Edwin asked for it to stay
 * locked, and it is locked here rather than merely absent from the form
 * — see the save handler.
 * ---------------------------------------------------------------------- */

/**
 * The tokens applyLinks() reads, and what they mean to a person.
 *
 * SHOWN RATHER THAN HIDDEN. The alternative is a rich editor that turns
 * {{money}}…{{/money}} into a styled span and back, which is a lot of
 * machinery and a new way to corrupt an article. The tokens are three
 * words of syntax; the screen explains them and the save checks them.
 */
const LINK_TOKENS = [
  ['money', 'the link to the page you are promoting'],
  ['prev', 'the link back to the previous article'],
  ['next', 'the link on to the next article'],
  /* THE ONE YOU ADD YOURSELF. The other three are placed by the planner
   * and the writer; this one is written into a sentence by hand and
   * pointed at whatever the field below names. It is also the only link
   * a PILLAR article can have, since a pillar has no money page. */
  ['link', 'a link of your own, wherever you point it'],
];

/* WHO PLACES EACH ONE, which is the difference that matters when a token
 * is missing. money, prev and next are put into the prose by the writer
 * from the plan — if one is absent the writer dropped it. link is typed
 * by the owner by hand, so an absent one is the owner's own omission and
 * telling him the writer did it sends him looking in the wrong place. */
const OWNER_TOKENS = new Set(['link']);

/** English for a small count, so a heading can say how many there are. */
function countWord(n) {
  return ['no', 'one', 'two', 'three', 'four', 'five', 'six'][n] || String(n);
}

/** Which link tokens a body still contains, by name. */
function tokensIn(text) {
  return LINK_TOKENS
    .map(([name]) => name)
    .filter(name => new RegExp(`\\{\\{${name}\\}\\}[\\s\\S]*?\\{\\{/${name}\\}\\}`).test(text));
}

/**
 * Sections <-> the text in a textarea.
 *
 * ONE TEXTAREA PER SECTION, PARAGRAPHS SEPARATED BY A BLANK LINE.
 *
 * The alternative — a field per paragraph — means the number of inputs
 * changes as you type, and adding or removing a paragraph becomes a
 * button rather than a keystroke. A blank line is how people already
 * separate paragraphs, and it survives copy and paste from anywhere.
 *
 * A SINGLE NEWLINE IS NOT A PARAGRAPH BREAK, deliberately. Textareas
 * wrap, people hit Enter mid-sentence, and treating that as a new
 * paragraph would quietly split a sentence across two <p> tags.
 */
function paragraphsToText(paragraphs) {
  return (paragraphs || []).map(p => String(p || '').trim()).filter(Boolean).join('\n\n');
}

function textToParagraphs(text) {
  return String(text || '')
    /* \r\n AND A LONE \r, NOT JUST THE PAIR.
     *
     * Written as /\r\n/ this line did nothing: the trim() below already
     * strips a trailing carriage return, so removing it changed no
     * behaviour and killed no test. Mutation found that, and the honest
     * fix was to make it handle the case nothing else does — a lone \r,
     * which some clipboards still produce and which trim() cannot reach
     * when it is BETWEEN two paragraphs rather than at an edge. */
    .replace(/\r\n?/g, '\n')
    .split(/\n\s*\n/)
    /* The inner newlines go, because a paragraph is one run of prose and
     * postPage wraps it in one <p>. Keeping them would put line breaks
     * in the HTML source that the browser ignores anyway. */
    .map(block => block.split('\n').map(line => line.trim()).filter(Boolean).join(' '))
    .filter(Boolean);
}

/**
 * The edit form.
 *
 * SEPARATE FROM THE HANDLER for the same reason blogPageSpec() is: more
 * than one route renders it, and two inline copies drift until one of
 * them quietly stops carrying a field through.
 */
function articleFormBody({ blog, post, campaign, form }) {
  const campaignUrl = (campaign && campaign.targetPage && campaign.targetPage.url) || '';
  const isPillar = Boolean(campaign && campaign.isPillar);

  return `
    <p><a href="/static-blogs/${blog._id}" class="link-light">&larr; ${esc((blog.business && blog.business.name) || 'the blog')}</a></p>

    <h1 class="h3 mb-1">Edit this article</h1>
    <p class="text-white-50">
      <code>/${esc(post.slug)}/</code>
      <!-- SAID, NOT JUST OMITTED. Somebody who cannot find the slug field
           should learn why rather than assume it is a missing feature. -->
      — the address is fixed. Changing it would kill the old one and break
      every link to it.
    </p>

    <form method="post" action="/static-blogs/${blog._id}/articles/${post._id}/edit">
      ${form.csrfField || ''}

      <div class="mb-3">
        <label class="form-label" for="title">Title</label>
        <input class="form-control" id="title" name="title" maxlength="300"
               value="${esc(form.title)}">
        <div class="form-text text-white-50">
          This is the page's H1 and the first half of its browser title.
        </div>
      </div>

      <div class="mb-4">
        <label class="form-label" for="metaDescription">Meta description</label>
        <textarea class="form-control" id="metaDescription" name="metaDescription"
                  rows="2" maxlength="400">${esc(form.metaDescription)}</textarea>
        <div class="form-text text-white-50">
          What Google shows under the title. Not on the page itself.
        </div>
      </div>

      <!-- THE MONEY LINK'S DESTINATION, ON THIS ARTICLE ALONE.
           The campaign's page is the default and stays the default for
           every article nobody has edited — an empty field here means
           "use the campaign's", never a copy of it. -->
      ${isPillar ? `
      <div class="alert alert-info">
        This is a <strong>pillar</strong> campaign, so its articles link to
        each other and to no money page — there is no campaign page to
        point them at. Use <strong>Your own link</strong> below to give
        this article a link of its own.
      </div>` : `
      <div class="mb-4">
        <label class="form-label" for="targetUrl">Where this article's link points</label>
        <input class="form-control" id="targetUrl" name="targetUrl"
               value="${esc(form.targetUrl)}"
               placeholder="${esc(campaignUrl)}">
        <div class="form-text text-white-50">
          Leave empty to use the campaign's page${campaignUrl ? ` — <code>${esc(campaignUrl)}</code>` : ''}.
          The words that become the link are in the prose below, between
          <code>{{money}}</code> and <code>{{/money}}</code>.
        </div>
      </div>`}

      <!-- A LINK OF YOUR OWN, ON EVERY ARTICLE INCLUDING A PILLAR'S.
           Outside the pillar branch above, because this is the slot a
           pillar article has INSTEAD of a money link — gate it the same
           way and a pillar is back to having no link it can control. -->
      <div class="mb-4">
        <label class="form-label" for="extraUrl">Your own link</label>
        <input class="form-control" id="extraUrl" name="extraUrl"
               value="${esc(form.extraUrl)}"
               placeholder="https://somewhere-you-choose.com/page/">
        <div class="form-text text-white-50">
          Write <code>{{link}}the words{{/link}}</code> around a phrase in
          the prose below and it points here. Leave this empty and that
          phrase stays ordinary text.
        </div>
      </div>

      <!-- THE TOKENS ARE EXPLAINED ONCE, HERE, rather than hidden behind
           an editor that turns them into styled spans and back. That is a
           lot of machinery and a new way to corrupt an article; this is
           three words of syntax and a note. -->
      <div class="card bg-dark border-secondary mb-4">
        <div class="card-body py-3">
          <!-- COUNTED, NOT TYPED. This said "three" for as long as there
               were three, and went on saying it the day a fourth was
               added while the list below rendered four. -->
          <h2 class="h6 mb-2">The ${countWord(LINK_TOKENS.length)} link markers</h2>
          <ul class="mb-0 small text-white-50">
            ${LINK_TOKENS.map(([name, what]) => `
            <li><code>{{${name}}}the words{{/${name}}}</code> — ${esc(what)}</li>`).join('')}
          </ul>
          <p class="mb-0 mt-2 small text-white-50">
            Edit the words between them freely. Delete a marker and that
            sentence stops being a link — you will be told if that happens.
          </p>
        </div>
      </div>

      <h2 class="h5 mb-3">The article</h2>

      ${form.sections.map((s, i) => `
      <div class="card bg-dark border-secondary mb-3">
        <div class="card-body">
          <div class="mb-2">
            <label class="form-label small" for="heading${i}">
              ${0 === i ? 'Heading (the opening usually has none)' : 'Heading — an H2 on the page'}
            </label>
            <input class="form-control" id="heading${i}" name="heading" value="${esc(s.heading)}">
          </div>
          <div>
            <label class="form-label small" for="body${i}">
              Paragraphs — leave a blank line between them
            </label>
            <textarea class="form-control" id="body${i}" name="body" rows="8">${esc(s.text)}</textarea>
          </div>
        </div>
      </div>`).join('')}

      <button class="btn btn-primary" type="submit" data-busy="Saving">Save</button>
      <a href="/static-blogs/${blog._id}" class="btn btn-outline-light ms-2">Cancel</a>
      <div class="form-text text-white-50 mt-2">
        Saving changes the article here. It reaches the live site the next
        time you publish this blog.
      </div>
    </form>`;
}

/** The article, scoped to a blog this person owns. */
async function ownedArticle(req) {
  const blog = await ownedBlog(req);
  if (!blog) return null;

  if (!/^[a-f0-9]{24}$/i.test(String(req.params.postId || ''))) return null;

  /* SCOPED IN THE QUERY, NOT CHECKED AFTERWARDS. The same rule the rest
   * of this file follows: an ownership test written as a separate `if` is
   * one careless early return away from not happening. */
  const post = await BlogPost.findOne({ _id: req.params.postId, site: blog._id }).lean();
  if (!post) return null;

  const campaign = await BlogCampaign.findOne({ _id: post.campaign, site: blog._id })
    .select('name isPillar targetPage')
    .lean();

  return { blog, post, campaign };
}

router.get('/static-blogs/:id/articles/:postId/edit', requireAuth, async (req, res) => {
  try {
    const found = await ownedArticle(req);
    if (!found) return notFound(res);

    const { blog, post, campaign } = found;

    send(res, page({
      title: esc(post.title || 'Edit article'),
      body: articleFormBody({ blog, post, campaign, form: {
        csrfField: res.locals.csrfField,
        title: post.title || '',
        metaDescription: post.metaDescription || '',
        targetUrl: post.targetUrl || '',
        extraUrl: post.extraUrl || '',
        sections: (post.sections || []).map(s => ({
          heading: s.heading || '',
          text: paragraphsToText(s.paragraphs),
        })),
      } }),
    }));

  } catch (err) {
    log.error('staticBlogs.articleForm.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not open that article</h1>
             <a href="/static-blogs/${esc(req.params.id)}" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

router.post('/static-blogs/:id/articles/:postId/edit', requireAuth, async (req, res) => {
  try {
    const found = await ownedArticle(req);
    if (!found) return notFound(res);

    const { blog, post, campaign } = found;

    /* THE SECTIONS COME BACK AS PARALLEL ARRAYS, which is what a form
     * sends for repeated fields. Express gives a single occurrence as a
     * string rather than a one-element array, so both shapes are
     * normalised before anything indexes into them — a one-section
     * article would otherwise read the first CHARACTER of its heading. */
    const asArray = (value) => (Array.isArray(value) ? value : (undefined === value ? [] : [value]));

    const headings = asArray(req.body.heading);
    const bodies = asArray(req.body.body);

    const sections = bodies.map((text, i) => ({
      heading: String(headings[i] || '').trim(),
      paragraphs: textToParagraphs(text),
    })).filter(s => s.heading || s.paragraphs.length);

    if (!sections.length) {
      return send(res, page({
        status: 400,
        title: 'Not saved',
        body: `<h1 class="h2">An article needs some words in it</h1>
               <p class="lead">Nothing was saved.</p>
               <a href="/static-blogs/${blog._id}/articles/${post._id}/edit"
                  class="btn btn-primary mt-3">Back to the article</a>`,
      }));
    }

    /* BOTH URLS CHECKED THE SAME WAY createCampaign CHECKS ITS OWN.
     *
     * Each becomes the href of a link on a published page, so the two
     * things that matter are that it parses and that its scheme is one a
     * browser should follow. javascript:, data: and file: all parse
     * perfectly well and none of them belong in a link we generate.
     *
     * ONE HELPER RATHER THAN THE SAME TEN LINES TWICE. The second URL
     * arrived a day after the first, and a copy is how one of them ends
     * up accepting data: on the afternoon somebody loosens the other. */
    const webUrl = (value) => {
      const typed = String(value || '').trim();
      if (!typed) return { ok: true, url: '' };

      let scheme = '';
      try { scheme = new URL(typed).protocol; } catch (_) { scheme = ''; }

      if ('http:' !== scheme && 'https:' !== scheme) return { ok: false };

      return { ok: true, url: typed };
    };

    const target = webUrl(req.body.targetUrl);
    const extra = webUrl(req.body.extraUrl);

    if (!target.ok || !extra.ok) {
      return send(res, page({
        status: 400,
        title: 'Not saved',
        body: `<h1 class="h2">That link is not a web address</h1>
               <p class="lead">
                 ${!target.ok ? 'The page this article points at' : 'Your own link'}
                 has to start with <code>http://</code> or <code>https://</code>.
                 Nothing was saved.
               </p>
               <a href="/static-blogs/${blog._id}/articles/${post._id}/edit"
                  class="btn btn-primary mt-3">Back to the article</a>`,
      }));
    }

    const targetUrl = target.url;

    /* THE SLUG IS NOT IN THIS UPDATE, AND THAT IS THE POINT. It is in the
     * canonical, the sitemap, the feed and every internal link, so
     * changing it after a publish kills the old address. Leaving it out
     * of the form would be a convention; leaving it out of the update is
     * a rule. */
    await BlogPost.updateOne({ _id: post._id, site: blog._id }, { $set: {
      title: String(req.body.title || '').trim(),
      metaDescription: String(req.body.metaDescription || '').trim(),
      targetUrl,
      extraUrl: extra.url,
      sections,
    } });

    /* WHAT THE EDIT DID TO THE LINKS, COUNTED BEFORE AND AFTER.
     *
     * The tokens are plain text in a textarea, so they can be deleted by
     * accident — and a deleted one is silent: the sentence still reads,
     * the page still builds, and a third of the article's links are
     * simply gone. The screen says which were lost. */
    const was = tokensIn((post.sections || []).map(s => paragraphsToText(s.paragraphs)).join('\n'));
    const now = tokensIn(sections.map(s => paragraphsToText(s.paragraphs)).join('\n'));
    const lost = was.filter(name => !now.includes(name));

    log.info('staticBlogs.articleEdited', {
      requestId: req.id,
      siteId: String(blog._id),
      postId: String(post._id),
      sections: sections.length,
      targetUrl: targetUrl || '(the campaign\'s)',
      extraUrl: extra.url || '(none)',
      tokensLost: lost.join(',') || '',
    });

    send(res, page({
      title: 'Saved',
      body: `
        <h1 class="h2 mb-3">Saved</h1>
        <p class="lead">
          <strong>${esc(req.body.title || post.slug)}</strong> is updated.
          It goes live the next time you publish this blog.
        </p>

        ${lost.length ? `
        <div class="alert alert-warning">
          <strong>This article lost ${lost.length === 1 ? 'a link' : 'links'}.</strong>
          <ul class="mb-0 mt-2">
            ${lost.map(name => {
              const [, what] = LINK_TOKENS.find(([n]) => n === name) || [name, name];
              return `<li><code>{{${esc(name)}}}</code> — ${esc(what)}</li>`;
            }).join('')}
          </ul>
          <p class="mb-0 mt-2">
            The words are still there; they are no longer a link. Put the
            tokens back around the phrase if that was not deliberate.
          </p>
        </div>` : ''}

        <a href="/static-blogs/${blog._id}/articles/${post._id}/edit"
           class="btn btn-outline-light">Keep editing</a>
        <a href="/static-blogs/${blog._id}" class="btn btn-primary ms-2">Back to the blog</a>`,
    }));

  } catch (err) {
    log.error('staticBlogs.articleSave.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not save that article</h1>
             <a href="/static-blogs/${esc(req.params.id)}" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

/* -------------------------------------------------------------------------
 * The front page
 * ---------------------------------------------------------------------- */

router.post('/static-blogs/:id/home', requireAuth, async (req, res) => {
  try {
    const blog = await ownedBlog(req);
    if (!blog) return notFound(res);

    const wanted = String(req.body.homeSlug || '').trim();

    /* VALIDATED AGAINST THIS BLOG'S OWN ARTICLES, not just stored.
     *
     * The value arrives from a <select>, so in a browser it is always one
     * of the options — which is exactly why it cannot be trusted. A POST
     * is a POST, and without this check the field would accept any string,
     * including another blog's slug. It would not leak anything (the
     * renderer only ever matches it against this blog's own articles and
     * falls back when it misses) but it would store a setting that can
     * never come true and show it selected in the dropdown for ever. */
    if (wanted) {
      const exists = await BlogPost.exists({ site: blog._id, slug: wanted });
      if (!exists) {
        return send(res, page({
          status: 400,
          title: 'No such article',
          body: `<h1>That article is not on this blog</h1>
                 <a href="/static-blogs/${blog._id}" class="btn btn-primary mt-3">Back</a>`,
        }));
      }
    }

    // Empty is a real choice: it means "whichever is oldest", which is also
    // what an unset blog does.
    await BlogSite.updateOne({ _id: blog._id }, { $set: { homeSlug: wanted } });

    log.info('staticBlogs.homeSet', {
      requestId: req.id,
      siteId: String(blog._id),
      slug: wanted || '(oldest)',
    });

    res.redirect(`/static-blogs/${blog._id}`);

  } catch (err) {
    log.error('staticBlogs.home.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not save that</h1>
             <a href="/static-blogs/${esc(req.params.id)}" class="btn btn-primary mt-3">Back</a>`,
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

        /* SENT BOTH WAYS ROUND, ALWAYS, which is how the plugin sends it
         * too. createCampaign reads `body.isPillar === true`, so an
         * absent key and a false one mean the same thing to it — but a
         * payload with one consistent shape is one fewer thing to reason
         * about when a campaign comes out wrong. */
        isPillar: '1' === String(req.body.isPillar || ''),

        targetPage: {
          url: String(req.body.targetUrl || '').trim(),
          keyword: String(req.body.targetKeyword || '').trim(),
        },
        topics,

        /* THE NAMES campaignPlan.js ACTUALLY READS, and this is the fix for
         * a bug that cost an afternoon on 17 October.
         *
         * This object used to be { startDate, gapDays, hour }. Nothing
         * reads those. planForCampaign destructures everyDays, publishTime,
         * timezone and startAt — so every one of them fell through to its
         * default, and every campaign ever planned on this screen was
         * weekly, at 09:00 UTC, starting now, no matter what was typed.
         *
         * IT FAILED SILENTLY, WHICH IS THE PART WORTH REMEMBERING. No
         * error, no warning, a confirmation page listing dates nobody had
         * asked for. Edwin set "1 day between posts", got three articles a
         * week apart, pressed Publish and was told nothing was due —
         * because 09:00 UTC had already gone, so publishDates shifted the
         * whole run forward by a full gap. He went looking for a broken
         * deploy. The deploy was fine.
         *
         * THE PLUGIN WAS NEVER AFFECTED. class-ie-admin.php has sent the
         * right names since schedule.js was written. Only this screen —
         * the newest code — was wrong, which is exactly where a mismatch
         * like this hides: the older caller keeps working and so nobody
         * suspects the shared function.
         *
         * THERE IS NOW A TEST ASSERTING THE KEYS, not just the values. A
         * test that only checked the dates would keep passing if someone
         * renamed a field on either side. */
        schedule: {
          everyDays: Number(req.body.gapDays) || 7,
          publishTime: publishTimeFrom(req.body.publishTime),
          timezone: isKnownZone(blog.timezone) ? blog.timezone : 'UTC',
          startAt: startInstant(req.body.startDate, blog.timezone),
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
        <td class="text-white-50">${esc(dayIn(s.publishAt, blog.timezone) || '—')}</td>
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

        <table class="table table-navy align-middle">
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
          charged. Approve it from the blog's page when you are ready.
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
