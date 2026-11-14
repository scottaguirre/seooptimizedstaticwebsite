// routes/cloudflareSitesRoute.js
//
// /cloudflare-sites — publish a generated website to a subdomain on
// Cloudflare Pages.
//
//     hvac + acmesites.com   ->   https://hvac.acmesites.com
//
// Edwin, 5 November: *"I just would like to have an option maybe to use the
// generator to create a website and then upload it to a subdomains in
// cloudflare."* And on what must NOT change: *"I want to keep github as we
// have it right now. I don't want to replace it, and I dont want to replace
// what we have with the blog cloudflares either."*
//
// So this is a third screen beside two working ones, sharing their plumbing
// and owning none of it:
//
//   utils/blog/cloudflare/deploy.js    the Pages deploy, unchanged
//   utils/blog/cloudflare/accounts.js  the credentials, unchanged
//   models/Domain                      the pool, with a third `target`
//
//
// WHY THERE IS NO SITE PICKER, WHICH IS THE ONE THING ABOUT THIS PAGE
// SOMEBODY WILL ASK ABOUT
//
// The obvious design is a dropdown of every site you have generated. It
// cannot exist, and the reason is two lines of other people's code:
//
//   utils/buildAssets.js   getUserDirs() -> dist/user_<id>
//                          ONE folder per user, wiped and refilled by the
//                          next build
//
//   utils/buildRegistry.js const registry = new Map()
//                          prune(maxAgeMs = 60 * 60 * 1000)
//                          in memory, an hour, gone on restart
//
// There is no archive of past builds to pick from. What exists is THE BUILD
// YOU HAVE NOW. So the page shows that one build and asks where to put it.
//
// That turns out to cost nothing, because CLOUDFLARE HOLDS THE PUBLISHED
// FILES. Regenerate the site, come back, press Publish again on the row, and
// it deploys over the same project at the same address. The thing kept
// between publishes is the hostname, not the HTML — which is what a
// CloudflareSite row is.
//
//
// AND WHY PUBLISHING STARTS HERE RATHER THAN ON /my-sites
//
// /my-sites lists sites already published to GitHub Pages and is the only
// place one can be edited. A Cloudflare button there would read as "move
// this GitHub site", which is the one thing Edwin said not to build.

'use strict';

const express = require('express');
const router = express.Router();

const path = require('path');

const CloudflareSite = require('../models/CloudflareSite');
const BlogSite = require('../models/BlogSite');
const CloudflareAccount = require('../models/CloudflareAccount');
const Domain = require('../models/Domain');
const Job = require('../models/Job');

const requireAuth = require('../middleware/requireAuth');

/* NAMESPACE IMPORTS FOR EVERYTHING A TEST HAS TO STUB, AND THAT CHOICE IS
 * DELIBERATE RATHER THAN A STYLE PREFERENCE.
 *
 * A destructured function is captured at require() time, so stubbing it
 * afterwards replaces the module's copy and NOT the one this file closed
 * over — and the symptom is not a failure, it is a test that reaches the
 * live thing. staticBlogsRoute.js carries a note recording that trap being
 * walked into three times, and test-blog-domains.js records what it costs:
 * a forgotten stub there does not go red, it makes a live HTTPS call to
 * Cloudflare and hangs inside ./deploy.sh.
 *
 * So anything that talks to Cloudflare, reads the disk, or has to be made to
 * fail on demand is reached through its module. Pure functions —
 * childEnv(), accountCapacity() — are destructured, because there is no
 * reason to replace them and reading them off a namespace would only
 * obscure that they are arithmetic. */
const cfDeploy = require('../utils/blog/cloudflare/deploy');
const cloudflare = require('../utils/blog/cloudflare/accounts');
const siteFiles = require('../utils/cloudflareSites/siteFiles');
const currentSite = require('../utils/currentSite');

/* WHAT A PUBLISHED SITE NEEDS KEPT SO IT CAN BE RENDERED AGAIN — the model
 * and the recipe onto the row, the images onto disk. See the note at the top
 * of utils/cloudflareSites/siteStore.js for why the images are kept at all
 * when an edit never touches them. */
const siteStore = require('../utils/cloudflareSites/siteStore');

/* WHICH PARAGRAPHS AN OWNER MAY CHANGE, AND PUTTING THEIR EDITS BACK. Every
 * paragraph goes through safeParagraph() in there — runGeneration writes
 * these into the template unescaped, which is fine while the only writer is
 * the generator and is a script tag on a published page the moment it is
 * not. */
const editableText = require('../utils/cloudflareSites/editableText');


const { childEnv } = require('../utils/blog/cloudflare/deploy');
const { accountCapacity } = require('../utils/blog/cloudflare/accounts');

const { getUserDirs } = require('../utils/buildAssets');
const { siteDomains } = require('../utils/domainPool');
const { normalisePrefix } = require('../utils/dnsLabel');

const { withAppHeader } = require('../utils/appHeader');
const { pageTitle, TOOL_CF_SITES } = require('../utils/pageTitle');
const { log } = require('../utils/logger');

/* THE SAME ROOT runGeneration.js AND generateRoute.js USE. Resolved here
 * from __dirname rather than imported, because all three resolve it the same
 * way from their own location and none of them exports it. */
const baseDistDir = path.join(__dirname, '..', 'dist');

/** The shell every other tool page uses, so this does not look bolted on. */
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
 * Every value on this page was typed by the account holder — the site name,
 * the prefix — or came from their own build. That is not a reason to skip
 * it: it is their own dashboard, and the cheapest way to find out you forgot
 * is a business name with an apostrophe in it.
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
 * The site named in the URL, IF IT BELONGS TO WHOEVER IS ASKING.
 *
 * SCOPED IN THE QUERY rather than loaded and compared afterwards. Both are
 * correct today; only one of them stays correct when somebody adds an early
 * return above the comparison.
 *
 * 'removed' IS NOT EXCLUDED HERE, deliberately. A removed site must still be
 * loadable — otherwise the page that says "this was deleted" cannot find the
 * row it is about. The handlers that must refuse one say so themselves.
 */
async function ownedSite(req) {
  if (!isObjectId(req.params.id)) return null;

  return CloudflareSite.findOne({ _id: req.params.id, user: req.user._id });
}

function notFound(res) {
  return send(res, page({
    status: 404,
    title: 'Website not found',
    body: `<h1>That website is not here</h1>
           <p class="lead">It may have been removed, or it belongs to another account.</p>
           <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back to your websites</a>`,
  }));
}

/** Where this user's current build is. One folder, overwritten each build. */
function buildDirFor(userId) {
  return getUserDirs(baseDistDir, userId).distDir;
}

/* -------------------------------------------------------------------------
 * Publishing
 * ---------------------------------------------------------------------- */

/**
 * Read the current build and deploy it to one site's project.
 *
 * ONE FUNCTION FOR BOTH BUTTONS, because "publish" and "publish again" are
 * the same act: read dist/user_<id>, hand it to deployBlog, write down what
 * came back. The only thing that differs is whether `site.project` is
 * already set, and deployBlog decides that for itself — an empty project is
 * its signal to create the project and attach the domain.
 *
 * Written as a separate function rather than inlined twice so that the two
 * paths cannot drift in which fields they record. The first draft of this
 * file had the create handler forget `lastFileCount` and the republish
 * handler forget `domainAttached`.
 *
 * @returns the deployBlog result, plus `count`/`bytes` from the read, or
 *          `{ ok: false, error }` when there was nothing to send.
 */
/* TAKES AN ID AND A REQUEST ID, NOT A REQUEST, and the change was forced by
 * the one caller that has neither.
 *
 * This only ever read `req.user._id` and `req.id` off the request — the whole
 * object was threaded through for two strings. That was harmless while every
 * publish happened inside an HTTP handler. The edit rebuild now runs in a
 * background job, where there is no request at all and never will be, and a
 * function that demands one cannot be called from there.
 *
 *     A PARAMETER THAT NAMES WHAT IT NEEDS CAN BE CALLED FROM ANYWHERE. One
 *     that names where it was first called from can only be called there
 *     again. */
async function publishNow({ userId, requestId, site }) {
  const read = siteFiles.readSite(buildDirFor(userId));
  if (!read.ok) return { ok: false, error: read.error };

  /* THE ACCOUNT THIS SITE BELONGS TO, AND A FAILURE TO GET IT IS FATAL.
   *
   * credsFor() returns undefined for a site that names no account, which
   * reaches the env fallback in childEnv() — the server's own Cloudflare
   * credentials. For a blog that is correct: blogs existed before the pool
   * did. For a site it is not, because every site is created with an
   * account bound to it, so a missing one means something is wrong and
   * deploying into OUR account is the worst available answer.
   *
   * It THROWS for an account that is disabled, deleted, or whose token will
   * not decrypt, and each of those messages already names which account and
   * carries neither the token nor the key. */
  let creds;

  try {
    creds = await cloudflare.credsFor(site);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  if (!creds) {
    return {
      ok: false,
      error: 'This website is not bound to a Cloudflare account, so there is '
           + 'nowhere to publish it. Ask us to re-add its domain.',
    };
  }

  const result = await cfDeploy.deployBlog({
    blog: site,
    files: read.files,
    requestId,
    creds,
  });

  if (!result.ok) return result;

  /* WHAT CAME BACK, WRITTEN DOWN IN ONE PLACE.
   *
   * `setup` only exists on a first publish — deployBlog does the project
   * create and the domain attach once and returns null for `setup` on every
   * deploy after. So the two domain booleans are written CONDITIONALLY: an
   * unconditional `Boolean(setup.attached && ...)` would set them back to
   * false on the second publish of a site whose domain is working. */
  const setup = result.setup || {};

  site.project = result.project || site.project;
  site.status = 'live';
  site.publishedAt = new Date();
  site.publishCount = (site.publishCount || 0) + 1;
  site.lastFileCount = read.count;

  /* ONLY WHEN THERE IS A NEW ONE. urlFrom() returns null when wrangler's
   * output does not carry an address, and overwriting a working link with
   * null would lose the only address that answers before the certificate is
   * issued — and the `expected` value the delete path needs. */
  if (result.url) site.lastDeployUrl = result.url;

  if (setup.attached) site.domainAttached = Boolean(setup.attached.ok);
  if (setup.dns) site.dnsCreated = Boolean(setup.dns.ok);

  /* KEEP WHAT IT TAKES TO RENDER THIS AGAIN — after the deploy, not before.
   *
   * The site is up by this point. Capturing first would mean a failed deploy
   * leaving a stored model for a site that is not published, which the edit
   * screen would then offer to edit.
   *
   * NOTHING HERE CAN FAIL THE PUBLISH. The files are on Cloudflare and the
   * customer's site is live; being unable to keep a copy for later is a
   * reason to say the site cannot be edited yet, never a reason to report a
   * successful publish as a failure. `editable` carries that answer rather
   * than leaving the screen to infer it from two nullable fields.
   *
   * dist/user_<id> IS THE SOURCE AND IT IS BORROWED. The next build of
   * anything wipes it, which is the whole reason this runs now. */
  try {
    const kept = await siteStore.capture(buildDirFor(userId), String(site._id));

    if (kept.ok) {
      site.contentModel = kept.model;
      site.buildRecipe = kept.recipe;

      /* BOTH, OR IT IS NOT EDITABLE. The model is the words and the recipe
       * is the decisions; a re-render with one and not the other builds a
       * site from half an answer. See models/CloudflareSite.js. */
      site.editable = Boolean(kept.model && kept.recipe);

      log.info('cfSites.captured', {
        requestId,
        siteId: String(site._id),
        editable: site.editable,
        hasRecipe: Boolean(kept.recipe),
        assetFiles: kept.assets.files,
        assetBytes: kept.assets.bytes,
        /* A SUB-FOLDER IN assets/ WOULD BE SKIPPED SILENTLY OTHERWISE, and
         * the first sign would be a re-render missing images. No build has
         * ever had one; this is how we find out when one does. */
        assetsSkipped: kept.assets.skipped.join(',') || '',
      });
    } else {
      site.editable = false;
      log.info('cfSites.capture.incomplete', {
        requestId,
        siteId: String(site._id),
        reason: kept.error,
      });
    }
  } catch (err) {
    site.editable = false;
    log.error('cfSites.capture.failed', err, {
      requestId,
      siteId: String(site._id),
    });
  }

  await site.save();

  return Object.assign({}, result, { count: read.count, bytes: read.bytes });
}

/** The page shown when a publish did not work. Shared by both handlers. */
function failedSpec({ site, result }) {
  return page({
    status: 400,
    title: 'Not published',
    body: `<h1 class="h2">That did not publish</h1>
           <p class="lead">${esc(result.error)}</p>
           ${result.projectMissing
             /* THE ONE PUBLISH FAILURE A RETRY ACTUALLY FIXES, and only
              * deploy.js can tell. Both halves of that judgement — a create
              * that did not succeed AND a deploy saying the project is
              * missing — are things it saw and this page did not. See the
              * note beside `projectMissing` there for why either half alone
              * would send somebody off to wait for a permissions error to
              * heal on its own. */
             ? '<p>Nothing was lost. This is usually temporary — try '
               + 'publishing again in a few minutes.</p>'
             : ''}
           ${result.output
             /* THE LAST 2000 CHARACTERS, scrubbed upstream. scrub() in
              * deploy.js removes the token and the account id from wrangler
              * output before it ever gets here; this only decides how much
              * of it to show. The tail rather than the head because
              * wrangler puts the error last. */
             ? `<pre class="p-3 bg-dark text-white-50 small" style="white-space:pre-wrap">${esc(String(result.output).slice(-2000))}</pre>`
             : ''}
           <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back to your websites</a>
           ${site ? `<a href="/cloudflare-sites/${site._id}/delete" class="btn btn-outline-light mt-3 ms-2">Delete it</a>` : ''}`,
  });
}

/* -------------------------------------------------------------------------
 * The list, the current build, and the publish form
 * ---------------------------------------------------------------------- */

router.get('/cloudflare-sites', requireAuth, async (req, res) => {
  try {
    const sites = await CloudflareSite.find({
      user: req.user._id,
      status: { $ne: 'removed' },
    }).sort({ createdAt: -1 }).lean();

    /* THE DOMAINS ON OFFER, AND ONLY THE WEBSITE ONES — Edwin, 5 November:
     * *"these domains will be separate than the ones for blogs. So the
     * dropdown for these domains has to be separate from the dropdown of
     * those for blogs."*
     *
     * siteDomains() rather than a filter written here. The pool holds three
     * kinds of row in one collection and the mistake this guards against
     * already happened once on /static-blogs; the note at the top of
     * utils/domainPool.js is the whole story. */
    const pool = await Domain.find(siteDomains()).sort({ domain: 1 }).lean();

    /* WHAT IS IN dist/user_<id> RIGHT NOW. Null when the user has never
     * generated anything, or when a cleanup sweep has removed it — in which
     * case there is nothing to publish and the form has no business being
     * on screen. */
    const build = currentSite.getCurrentSite(req.user._id);

    /* THE REGISTRAR, THEN THE LABEL, AND BOTH ARE OPTIONAL.
     *
     * Edwin, 14 November: the picker should read "1-1o.com — Namecheap".
     * The label was already here and is a different fact — a client's
     * trading name — so a row carrying both prints both rather than one
     * winning. Carried in a list so two empties do not leave a stray dash
     * or a double one. */
    const describe = (d) => {
      const parts = [d.registrar, d.label].filter(v => String(v || '').trim());
      return parts.length ? ` — ${parts.map(esc).join(' · ')}` : '';
    };

    const domainOptions = pool.map(d => `
      <option value="${esc(d.domain)}">${esc(d.domain)}${describe(d)}</option>`).join('');

    const rows = sites.map((s, i) => {
      /* THE HOSTNAME IS THE ADDRESS; THE pages.dev ONE IS THE FALLBACK.
       *
       * Both are shown, and that is not clutter. A custom domain can sit on
       * "DNS Check in Progress" for hours — 2-r.net did, with correct
       * records — and during that window the hostname link is the one that
       * does not work. Showing only it makes a working deploy look dead. */
      const live = `https://${s.siteUrl}`;

      return `
      <tr>
        <td class="rownum">${i + 1}</td>
        <td>
          ${esc(s.name || 'Untitled')}
          ${'draft' === s.status
            ? '<span class="badge bg-warning text-dark ms-1">never published</span>'
            : ''}
          ${'live' === s.status && !s.dnsCreated
            /* THE HALF THAT FAILS ON ITS OWN. deployBlog registers the
             * domain on the project and writes the CNAME as two separate
             * calls, and its own log once reported the first as fine while
             * the browser said NXDOMAIN. A row that knows this says so,
             * instead of leaving somebody to work out why their address
             * does not resolve. */
            ? '<span class="badge bg-warning text-dark ms-1" title="The Pages project is serving, but no DNS record was written for this hostname.">DNS pending</span>'
            : ''}
        </td>
        <td><a href="${esc(live)}" class="link-light" target="_blank" rel="noopener">${esc(s.siteUrl)}</a>
          ${s.lastDeployUrl
            ? `<div class="small text-white-50"><a href="${esc(s.lastDeployUrl)}" class="link-light" target="_blank" rel="noopener">${esc(String(s.lastDeployUrl).replace(/^https:\/\//, ''))}</a></div>`
            : ''}</td>
        <td class="text-white-50 small">${s.publishedAt
          ? esc(new Date(s.publishedAt).toDateString())
          : '—'}${s.publishCount ? ` · ${s.publishCount}×` : ''}</td>
        <td class="text-end">
          ${build ? `
          <form method="post" action="/cloudflare-sites/${s._id}/publish" class="d-inline">
            ${res.locals.csrfField || ''}
            <button class="btn btn-sm btn-outline-light" type="submit">${
              'draft' === s.status ? 'Publish' : 'Publish again'}</button>
          </form>` : ''}

          ${/* EDIT, AND IT ALMOST SHIPPED WITHOUT THIS LINE.
                The whole edit screen was written, tested and reachable only
                by typing its URL — which is the failure appSidebar()'s own
                comment describes and the one Edwin had to ask about the day
                Static Blogs went live. A feature nothing links to is a
                feature nobody uses.

                SHOWN ONLY WHEN THE SITE CAN ACTUALLY BE EDITED. `editable`
                is false for anything published before its words were kept,
                and the handler refuses those with a sentence — a button
                that explains why it cannot work is worse than no button. */''}
          ${s.editable ? `
          <a href="/cloudflare-sites/${s._id}/edit" class="btn btn-sm btn-outline-light">Edit words</a>` : ''}

          <a href="/cloudflare-sites/${s._id}/delete" class="btn btn-sm btn-outline-danger">Delete</a>
        </td>
      </tr>`;
    }).join('');

    const list = sites.length
      ? `<div class="table-responsive">
         <table class="table table-navy table-hover align-middle">
           <thead><tr><th></th><th>Website</th><th>Address</th><th>Published</th><th></th></tr></thead>
           <tbody>${rows}</tbody>
         </table>
         </div>`
      : '<p class="lead text-white-50">You have not published any websites to Cloudflare yet.</p>';

    /* THE BUILD CARD, AND IT IS THE HONEST VERSION OF THE SITE PICKER.
     *
     * It names the one build that can be published and says when it was
     * made, because "publish" on this page means "publish THIS" and the
     * only way to publish something else is to generate it. A dropdown
     * here would imply an archive that does not exist. */
    const buildCard = build
      /* text-white IS ON THE CARD, NOT ON THE HEADING, and that is the whole
       * point. Bootstrap's .card sets its own `color: var(--bs-body-color)` —
       * near-black — so a card on this dark page darkens everything inside it
       * that has not been told otherwise. The paragraph below was readable
       * only because .text-white-50 happened to override it; the business
       * name, with no colour class, came out black on navy and was invisible.
       * Setting the colour on the card fixes the heading AND anything added
       * inside it later, which setting it on the heading would not. */
      ? `<div class="card bg-transparent border-light text-white mb-4">
           <div class="card-body">
             <h2 class="h5 mb-1">${esc(build.businessName || 'Your latest build')}</h2>
             <p class="text-white-50 mb-2">
               ${esc(build.location || '')}${build.location ? ' · ' : ''}${build.pageCount} page${1 === build.pageCount ? '' : 's'} · generated ${esc(build.generatedAgo)}
             </p>
             <a href="${esc(build.previewUrl)}" class="btn btn-sm btn-outline-light" target="_blank" rel="noopener">Preview it</a>
           </div>
         </div>`
      : `<div class="alert alert-secondary">
           <strong>There is no build to publish yet.</strong>
           <div class="small mt-1">
             Generate a website first, then come back here to put it on a
             subdomain. Only your most recent build can be published — the
             generator keeps one at a time.
           </div>
           <a href="/" class="btn btn-sm btn-primary mt-2">Build a website</a>
         </div>`;

    send(res, page({
      title: TOOL_CF_SITES,
      body: `
        <h1 class="h2 mb-1">${TOOL_CF_SITES}</h1>
        <p class="lead text-white-50 mb-4">
          Put the website you have just generated on a subdomain of one of
          our domains. Cloudflare writes the DNS record itself, so there is
          nothing to paste anywhere.
        </p>

        ${buildCard}

        <h2 class="h4 mb-3">Your websites</h2>
        ${list}

        ${build && pool.length ? `
        <h2 class="h4 mt-5 mb-3">Publish it to a subdomain</h2>

        <form method="post" action="/cloudflare-sites" class="row g-2">
          ${res.locals.csrfField || ''}
          <div class="col-md-4">
            <label class="form-label" for="name">Name</label>
            <input class="form-control" id="name" name="name" required maxlength="200"
                   value="${esc(build.businessName || '')}">
          </div>
          <div class="col-md-3">
            <label class="form-label" for="prefix">Subdomain</label>
            <input class="form-control" id="prefix" name="prefix" required maxlength="63"
                   placeholder="hvac" spellcheck="false"
                   autocorrect="off" autocapitalize="off">
          </div>
          <div class="col-md-4">
            <label class="form-label" for="domain">Domain</label>
            <select class="form-select" id="domain" name="domain" required>
              ${domainOptions}
            </select>
          </div>
          <div class="col-md-1 d-flex align-items-end">
            <button class="btn btn-primary" type="submit">Publish</button>
          </div>
          <div class="form-text text-white-50">
            One word in front of the domain — letters, numbers and hyphens.
            To change a website later, generate it again and press
            <em>Publish again</em> on its row: it goes out at the same
            address.
          </div>
        </form>` : ''}

        ${build && !pool.length ? `
        <div class="alert alert-secondary mt-4">
          <strong>There are no domains set up for websites yet.</strong>
          <div class="small mt-1">
            Websites use their own list of domains, separate from the one
            the blogs use. Ask us to add one.
          </div>
        </div>` : ''}`,
    }));

  } catch (err) {
    log.error('cfSites.show.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not load that</h1>
             <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

/* -------------------------------------------------------------------------
 * Creating a site and publishing it, which is one button
 * ---------------------------------------------------------------------- */

router.post('/cloudflare-sites', requireAuth, async (req, res) => {
  try {
    const name = String(req.body.name || '').trim().slice(0, 200);
    const prefix = normalisePrefix(req.body.prefix);

    if (!name || !prefix) {
      return send(res, page({
        status: 400,
        title: 'Publish a website',
        body: `<h1 class="h3">A website needs a name and a subdomain</h1>
               <p class="lead">
                 The subdomain is a single word — letters, numbers and
                 hyphens — in front of the domain you picked.
               </p>
               <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back</a>`,
      }));
    }

    /* THE DOMAIN MUST BE ONE OF OURS, AND ONE OF THE WEBSITE ONES.
     *
     * The form is a dropdown, so an unknown domain only arrives on a posted
     * request — which is to say, from anybody. `target` is in the filter
     * rather than checked afterwards: without it, a posted BLOG domain
     * would create a website on a hostname the blog screen also offers, and
     * whichever published second would overwrite the other.
     *
     * `enabled` is the same door. A domain taken off the list when a client
     * left must not come back through a replayed form. */
    const pick = await Domain.findOne({
      domain: String(req.body.domain || '').trim().toLowerCase(),
      ...siteDomains(false),
    });

    if (!pick || false === pick.enabled) {
      return send(res, page({
        status: 400,
        title: 'Not a domain we host',
        body: `<h1 class="h3">That domain is not available for websites</h1>
               <p class="lead">Pick one from the list.</p>
               <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back</a>`,
      }));
    }

    const domain = `${prefix}.${pick.domain}`;

    /* ACROSS EVERY ACCOUNT AND ACROSS BOTH PRODUCTS, BY THE WHOLE HOSTNAME.
     *
     * UNSCOPED, so the refusal can be about a site belonging to somebody
     * this person cannot see. That is worth the vague wording: the
     * alternative is letting them create something that silently destroys
     * another customer's site, which is what /static-blogs discovered about
     * its own user-scoped check on 22 October.
     *
     * AND BlogSite TOO, even though a Domain row is either a blog domain or
     * a website domain and never both. It costs one indexed lookup and it
     * is the check that still holds on the day somebody edits a row's
     * `target` — at which point every hostname under it becomes reachable
     * from the other screen. */
    const [clashSite, clashBlog] = await Promise.all([
      CloudflareSite.findOne({ siteUrl: domain }),
      BlogSite.findOne({ siteUrl: domain }),
    ]);

    if (clashSite || clashBlog) {
      return send(res, page({
        status: 400,
        title: 'Already taken',
        body: `<h1 class="h3">${esc(domain)} is already in use</h1>
               <p class="lead">Pick a different word in front of the domain.</p>
               <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back</a>`,
      }));
    }

    /* A RUNAWAY GUARD, NOT A PRODUCT LIMIT, and the difference matters
     * because it was read as one.
     *
     * The oldest of the three copies, in routes/blogSitesRoute.js, says what
     * it is for: "a cap, because nothing else limits this and a loop against
     * the form would otherwise fill the collection." The two later copies
     * took the number and left the sentence behind, so a bare `|| 50` sat
     * here looking like a decision about how many sites a customer may have.
     * It is not. Nothing about 50 was ever chosen.
     *
     *     A NUMBER WITH NO REASON BESIDE IT GETS READ AS A REASON.
     *
     * 300 rather than 50 because the guard has to be past what a person
     * reaches by hand and nowhere near what a loop reaches in seconds — and
     * at 50 it was the FIRST ceiling hit, in front of the real one.
     *
     * THE REAL CEILING IS BELOW THIS AND IS CLOUDFLARE'S: 100 Pages projects
     * per account, counted live a few lines down. That one is external,
     * documented and worth refusing on. This one only has to stop a bug. */
    const limit = Number(process.env.CF_MAX_SITES_PER_USER) || 300;
    const existing = await CloudflareSite.countDocuments({
      user: req.user._id,
      status: { $ne: 'removed' },
    });

    if (existing >= limit) {
      return send(res, page({
        status: 400,
        title: 'Too many websites',
        body: `<h1 class="h3">You have reached the limit of ${limit} websites</h1>
               <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back</a>`,
      }));
    }

    /* IS THERE ROOM ON THAT CLOUDFLARE ACCOUNT?
     *
     * Cloudflare caps Pages projects at 100 per account and says the limit
     * is not routinely raised. One website is one project — and so is one
     * blog, so the two products share the ceiling on any account that holds
     * both kinds of domain.
     *
     * ASKED LIVE, NOT READ OFF THE ROW. `CloudflareAccount.projects` is a
     * snapshot for the admin screen and can be weeks old; a refusal built
     * on a stale number refuses people who have room.
     *
     * AND A CHECK THAT CANNOT RUN LETS THEM THROUGH. A revoked token, an
     * outage, a rate limit all come back ok:false, and refusing on that
     * basis would turn a transient Cloudflare problem into "you cannot
     * publish", for somebody who has done nothing wrong and can see
     * nothing to fix. The worst case of letting it through is the error
     * that would have happened anyway. A failure to ask is not an answer. */
    if (pick.account) {
      const owner = await CloudflareAccount.findById(pick.account);
      const room = owner ? await cloudflare.recountAccount(owner) : { ok: false };

      /* accountCapacity CLAMPS AT ZERO, so an account filled past 100 by
       * something other than this app reads as full rather than as negative
       * room. A `=== 100` test here would wave those through. */
      if (room.ok && accountCapacity({ projects: room.projects }).left <= 0) {
        log.info('cfSites.accountFull', {
          requestId: req.id,
          userId: String(req.user._id),
          domain: pick.domain,
          projects: room.projects,
        });

        return send(res, page({
          status: 400,
          title: 'That domain is full',
          body: `<h1 class="h3">${esc(pick.domain)} has no room left</h1>
                 <p class="lead">
                   Cloudflare allows 100 sites per account and this one is
                   full. Pick a different domain from the list, or ask us to
                   add another.
                 </p>
                 <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back</a>`,
        }));
      }
    }

    /* THE BUILD IS READ BEFORE THE ROW IS WRITTEN.
     *
     * Not for speed — for the order of the two failures. A build with no
     * index.html, or none at all, is the likeliest reason this whole form
     * does not work, and discovering it AFTER creating the row leaves a
     * hostname permanently claimed by a site that was never published. The
     * unique index on siteUrl means that claim cannot be given back without
     * deleting the row.
     *
     * READ TWICE, and that is deliberate. publishNow() reads it again a few
     * lines down, because it is also the republish path and cannot take the
     * files as an argument without the create path and the republish path
     * disagreeing about which build went out. Two reads of a folder of
     * files already in the page cache is a cost worth paying for one code
     * path instead of two. */
    const check = siteFiles.readSite(buildDirFor(req.user._id));

    if (!check.ok) {
      return send(res, page({
        status: 400,
        title: 'Nothing to publish',
        body: `<h1 class="h3">There is nothing to publish</h1>
               <p class="lead">${esc(check.error)}</p>
               <a href="/" class="btn btn-primary mt-3">Build a website</a>`,
      }));
    }

    const site = await CloudflareSite.create({
      user: req.user._id,
      siteUrl: domain,
      name,
      status: 'draft',

      /* BOUND TO THE DOMAIN'S ACCOUNT, ONCE, HERE. Not looked up again at
       * publish time: a Domain row can be re-pointed later, and resolving
       * live would silently move an existing site's deploys to an account
       * where its Pages project does not exist. */
      cloudflareAccount: pick.account,
    });

    log.info('cfSites.created', {
      requestId: req.id,
      userId: String(req.user._id),
      siteId: String(site._id),
      domain,
    });

    const result = await publishNow({ userId: req.user._id, requestId: req.id, site });

    /* THE ROW SURVIVES A FAILED FIRST PUBLISH, ON PURPOSE.
     *
     * It stays as a draft with a Publish button and a Delete button. The
     * alternative — deleting it here — would be tidier and wrong: by this
     * point deployBlog may already have created the Pages project, and
     * throwing away the only record of it leaves an orphan in Cloudflare
     * that nothing in the app can ever reach again. */
    if (!result.ok) {
      log.error('cfSites.firstPublish.failed',
        new Error(result.error || 'deploy failed'),
        { requestId: req.id, siteId: String(site._id), domain });

      return send(res, failedSpec({ site, result }));
    }

    return send(res, publishedSpec({ site, result, first: true }));

  } catch (err) {
    /* A DUPLICATE KEY HERE IS THE RACE THE CLASH CHECK CANNOT WIN. Two
     * requests for the same hostname can both pass the findOne and only one
     * can pass the index. The index is the real answer; this turns its
     * error into the same sentence the check would have produced. */
    if (11000 === err.code) {
      return send(res, page({
        status: 400,
        title: 'Already taken',
        body: `<h1 class="h3">That address was just taken</h1>
               <p class="lead">Pick a different word in front of the domain.</p>
               <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back</a>`,
      }));
    }

    log.error('cfSites.create.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not publish that</h1>
             <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

/** The page shown after a successful publish. */
function publishedSpec({ site, result, first }) {
  const live = `https://${site.siteUrl}`;

  /* THE DNS RECORD IS THE HALF THAT FAILS ALONE, and the page says which
   * address to use while it has not been written. deployBlog's own log once
   * reported the domain attached while the browser returned NXDOMAIN; both
   * were true, and one sentence could not have said so. */
  const dnsOk = !first || site.dnsCreated;

  return page({
    title: 'Published',
    body: `<h1 class="h2">${esc(site.name || site.siteUrl)} is published</h1>

           <p class="lead">
             ${result.count} file${1 === result.count ? '' : 's'} went out.
           </p>

           ${dnsOk
             ? `<p><a href="${esc(live)}" class="btn btn-primary" target="_blank" rel="noopener">Open ${esc(site.siteUrl)}</a></p>
                ${first ? `<p class="text-white-50 small">
                  A brand-new address can take a few minutes while Cloudflare
                  issues its certificate. The ${esc(String(site.lastDeployUrl || '').replace(/^https:\/\//, '') || 'pages.dev')}
                  address below works immediately.
                </p>` : ''}`
             : `<div class="alert alert-warning">
                  <strong>The site is up, but ${esc(site.siteUrl)} has no DNS record yet.</strong>
                  <div class="small mt-1">
                    The Pages project is serving and the domain is registered
                    on it, but the CNAME was not written — usually a token
                    short of Zone:DNS:Edit, or a zone on a different
                    Cloudflare account. Until it is added, use the address
                    below.
                  </div>
                </div>`}

           ${site.lastDeployUrl
             ? `<p><a href="${esc(site.lastDeployUrl)}" class="link-light" target="_blank" rel="noopener">${esc(site.lastDeployUrl)}</a></p>`
             : ''}

           <a href="/cloudflare-sites" class="btn btn-outline-light mt-3">Back to your websites</a>`,
  });
}

/* -------------------------------------------------------------------------
 * Publishing again
 * ---------------------------------------------------------------------- */

/**
 * Deploy the CURRENT build over an existing site's project.
 *
 * THIS IS WHAT REPLACES AN EDIT. There is nothing to edit here — the files
 * come from dist/user_<id>, which the generator rewrites. So the loop is:
 * generate the site again, come back, press this. The address, the project
 * and the DNS record all stay as they are.
 *
 * IT IS ALSO THE RETRY for a first publish that failed, which is why it does
 * not care whether `status` is draft or live.
 */
router.post('/cloudflare-sites/:id/publish', requireAuth, async (req, res) => {
  try {
    const site = await ownedSite(req);
    if (!site) return notFound(res);

    /* A REMOVED SITE IS NOT REPUBLISHED. Its project and DNS record have
     * been deleted at Cloudflare; deploying would create a new project
     * under the same name and leave the hostname pointing at nothing,
     * because the attach only runs when `project` is empty — and on a
     * removed row it is not. */
    if ('removed' === site.status) {
      return send(res, page({
        status: 400,
        title: 'That website was deleted',
        body: `<h1 class="h3">${esc(site.siteUrl)} was deleted</h1>
               <p class="lead">Publish it again as a new website.</p>
               <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back</a>`,
      }));
    }

    const result = await publishNow({ userId: req.user._id, requestId: req.id, site });

    if (!result.ok) {
      log.error('cfSites.publish.failed',
        new Error(result.error || 'deploy failed'),
        { requestId: req.id, siteId: String(site._id), domain: site.siteUrl });

      return send(res, failedSpec({ site, result }));
    }

    return send(res, publishedSpec({ site, result, first: false }));

  } catch (err) {
    log.error('cfSites.publish.threw', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not publish that</h1>
             <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

/* -------------------------------------------------------------------------
 * Editing the words
 * ---------------------------------------------------------------------- */

/**
 * Why a site cannot be edited, as a sentence, or '' when it can.
 *
 * ONE FUNCTION FOR BOTH HANDLERS. The GET has to decide whether to draw the
 * form and the POST has to decide whether to accept it, and two readings of
 * the same three fields is how a screen ends up offering a button that the
 * handler behind it refuses.
 */
function whyNotEditable(site) {
  if ('removed' === site.status) {
    return 'That website was deleted.';
  }

  if ('live' !== site.status || !site.project) {
    return 'That website has not been published yet, so there is nothing to edit. '
         + 'Publish it first.';
  }

  if (!site.editable || !site.contentModel || !site.buildRecipe) {
    /* PUBLISHED BEFORE ANY OF THIS EXISTED, most likely. The words were
     * never kept, so there is nothing to load — and re-rendering from
     * nothing would generate a different site and charge for it. */
    return 'This website was published before its words were kept, so it cannot '
         + 'be edited yet. Generate it again and publish it once more, and the '
         + 'edit screen will work from then on.';
  }

  return '';
}

router.get('/cloudflare-sites/:id/edit', requireAuth, async (req, res) => {
  try {
    const site = await ownedSite(req);
    if (!site) return notFound(res);

    const why = whyNotEditable(site);

    if (why) {
      return send(res, page({
        status: 400,
        title: 'Cannot edit this website',
        body: `<h1 class="h3">${esc(site.name || site.siteUrl)} cannot be edited</h1>
               <p class="lead">${esc(why)}</p>
               <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back to your websites</a>`,
      }));
    }

    const blocks = editableText.collect(site.contentModel);

    /* GROUPED BY PAGE, in the model's own order, because that is the order
     * the site reads in and the only way somebody finds the sentence they
     * came here to change. */
    const byPage = new Map();

    for (const block of blocks) {
      if (!byPage.has(block.pageSlug)) byPage.set(block.pageSlug, []);
      byPage.get(block.pageSlug).push(block);
    }

    /* ONE COLUMN, AT EVERY WIDTH. The boxes are full-width text; a grid
     * would only put two half-width paragraphs side by side and make both
     * harder to read. Nothing here needs a breakpoint, which is the right
     * amount of responsive layout for a form of stacked fields. */
    const sections = [...byPage.entries()].map(([slug, list]) => `
      <h2 class="h4 mt-5 mb-3">${esc(list[0].pageTitle)}</h2>
      <p class="text-white-50 small mb-3">${esc(slug)}</p>
      ${list.map(block => `
        <div class="mb-4">
          <div class="small text-white-50 mb-1">${esc(block.sectionLabel)}</div>

          ${block.headingField ? `
            <label class="form-label small text-white-50 mb-1"
                   for="${esc(block.headingField)}">Heading</label>
            <input class="form-control mb-2" type="text"
                   id="${esc(block.headingField)}"
                   name="${esc(block.headingField)}"
                   value="${esc(block.heading)}" spellcheck="true">` : ''}

          ${block.subheadingField ? `
            <label class="form-label small text-white-50 mb-1"
                   for="${esc(block.subheadingField)}">Subheading</label>
            <input class="form-control mb-2" type="text"
                   id="${esc(block.subheadingField)}"
                   name="${esc(block.subheadingField)}"
                   value="${esc(block.subheading)}" spellcheck="true">` : ''}

          ${/* THE LIST GOES WHERE THE PAGE PUTS IT, WHICH IS BETWEEN THE TWO
                PARAGRAPHS — not after them. aboutUsTemplate.html reads
                P1, LIST, P2, and a screen that draws P1, P2, LIST is a screen
                that does not look like the thing it edits. The position comes
                from editableText.trustAfterParagraph; see the note there.

                EIGHT BOXES WHETHER OR NOT EIGHT ARE FILLED. The empty ones
                are how a claim is added and emptying a full one is how a
                claim is removed — no add button and no delete button,
                because the boxes already are both. */''}
          ${(() => {
            const boxes = block.paragraphs.map((text, i) => `
              <textarea class="form-control mb-2 cf-edit"
                        name="${esc(editableText.fieldName(block.pageSlug, block.sectionKey, i))}"
                        rows="4" spellcheck="true">${esc(text)}</textarea>`);

            if (!block.trustPoints) return boxes.join('');

            const list = `
              <div class="small text-white-50 mt-3 mb-1">
                Ticked list — empty a box to remove that line, type in an empty one to add
              </div>
              ${block.trustPoints.map((text, i) => `
                <input class="form-control form-control-sm mb-1" type="text"
                       name="${esc(editableText.trustName(block.pageSlug, block.sectionKey, i))}"
                       value="${esc(text)}" spellcheck="true"
                       aria-label="Trust point ${i + 1}">`).join('')}
              <div class="mb-3"></div>`;

            const at = block.trustAfterParagraph;

            return [...boxes.slice(0, at), list, ...boxes.slice(at)].join('');
          })()}

          ${/* THE REVIEW CARDS.

                AFTER the paragraphs rather than spliced into them, because
                on the page they ARE after: the reviews section is its own
                block under the case study, not a list threaded between two
                sentences the way the ticked list is.

                FOUR CARDS WHETHER OR NOT FOUR ARE FILLED, the same bargain
                the ticked list makes — emptying the body removes that
                review and typing into an empty card adds one back. No add
                button and no delete button, because the boxes are both.

                NO STARS. There is no sensible control for a rating in a row
                of text boxes, so the stored value rides through untouched;
                see REVIEW_DEFAULT_STARS for what a re-added card gets. */''}
          ${!block.reviews ? '' : `
            <div class="small text-white-50 mt-3 mb-2">
              Reviews — empty the review to remove that card, type in an empty one to add
            </div>
            ${block.reviews.map((row, i) => `
              <div class="border border-secondary rounded p-2 mb-2">
                <textarea class="form-control form-control-sm mb-1 cf-edit"
                          name="${esc(editableText.reviewName(block.pageSlug, block.sectionKey, i))}"
                          rows="3" spellcheck="true"
                          aria-label="Review ${i + 1}">${esc(row.text)}</textarea>
                <input class="form-control form-control-sm" type="text"
                       name="${esc(editableText.reviewerName(block.pageSlug, block.sectionKey, i))}"
                       value="${esc(row.name)}" spellcheck="true"
                       placeholder="Who wrote it"
                       aria-label="Reviewer name ${i + 1}">
              </div>`).join('')}
            <div class="mb-3"></div>` }
        </div>`).join('')}`).join('');

    send(res, page({
      title: 'Edit the words',
      body: `
        <h1 class="h2 mb-1">Edit ${esc(site.name || site.siteUrl)}</h1>
        <p class="lead text-white-50">
          Change the wording and the headings. Images, your business details
          and the address of the site all stay as they are.
        </p>

        ${/* THE LINK FORMAT, SHOWN RATHER THAN EXPLAINED ELSEWHERE. The
              stored paragraphs already contain anchors — the generator put
              them there — so somebody editing is going to see one and needs
              to know what it is before they delete it by accident. */''}
        <div class="alert alert-secondary">
          <strong>To link a phrase</strong>, wrap it like this:
          <code>&lt;a href="/contact.html"&gt;get in touch&lt;/a&gt;</code>.
          ${/* text-muted, NOT text-white-50 — the same fault authRoute.js
                carries a note about. Every OTHER text-white-50 on this page
                sits on the navy body, where it is correct; this one is inside
                an .alert-secondary, which is a LIGHT panel, so the line came
                out white on pale grey and was all but unreadable.

                The giveaway is the sibling above: the other two
                .alert-secondary blocks on this page write `small mt-1` with
                no colour at all and inherit the alert's own dark text. This
                one had a colour copied in from the dark part of the page. */''}
          <div class="small mt-1 text-muted">
            Links already in the text are the ones the site uses to connect its
            own pages. Anything else you type is shown as plain words, and a
            link typed into a heading is shown as words too — the page puts
            its headings in capitals, which would break the address.
          </div>
        </div>

        <form method="post" action="/cloudflare-sites/${site._id}/edit">
          ${res.locals.csrfField || ''}
          ${sections}

          <div class="mt-4 mb-5">
            <button class="btn btn-primary" type="submit">Save and publish</button>
            <a href="/cloudflare-sites" class="btn btn-outline-light ms-2">Cancel</a>

            <div class="form-text text-white-50 mt-2">
              Saving rebuilds the site from these words and publishes it to
              ${esc(site.siteUrl)}. Your words are not generated again, so this
              costs no credits.
            </div>
          </div>
        </form>`,
    }));

  } catch (err) {
    log.error('cfSites.editForm.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not load that</h1>
             <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

router.post('/cloudflare-sites/:id/edit', requireAuth, async (req, res) => {
  try {
    const site = await ownedSite(req);
    if (!site) return notFound(res);

    const why = whyNotEditable(site);

    if (why) {
      return send(res, page({
        status: 400,
        title: 'Cannot edit this website',
        body: `<h1 class="h3">That website cannot be edited</h1>
               <p class="lead">${esc(why)}</p>
               <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back</a>`,
      }));
    }

    const applied = editableText.apply(site.contentModel, req.body);

    if (!applied.changed.length) {
      return send(res, page({
        title: 'Nothing changed',
        body: `<h1 class="h3">Nothing changed</h1>
               <p class="lead">
                 The words are the same as they were, so the site was not
                 rebuilt.
               </p>
               ${applied.blanked.length ? `<div class="alert alert-warning">
                 <strong>${applied.blanked.length} box${1 === applied.blanked.length ? ' was' : 'es were'} left empty.</strong>
                 <div class="small mt-1">
                   A paragraph or a heading cannot be deleted here — the page
                   keeps a slot for it and would show a blank space. Put some
                   words back, or leave it as it was. A line of the ticked
                   list is the exception: emptying one of those removes it.
                 </div>
               </div>` : ''}
               <a href="/cloudflare-sites/${site._id}/edit" class="btn btn-primary mt-3">Back to the words</a>`,
      }));
    }

    /* SAVED BEFORE THE REBUILD, AND THAT ORDER IS DELIBERATE.
     *
     * A rebuild takes a while and can fail — Cloudflare, a disk, a wrangler
     * version. Saving after would mean an edit that failed to publish was
     * also an edit that was lost, and the person would have to type it
     * again with no idea which half went wrong.
     *
     * Saved first, a failed publish leaves the words stored and the live site
     * as it was. Press Save again and it retries. */
    site.contentModel = applied.model;
    site.markModified('contentModel');
    await site.save();

    log.info('cfSites.edited', {
      requestId: req.id,
      siteId: String(site._id),
      changed: applied.changed.length,
      rejected: applied.rejected.length,
      blanked: applied.blanked.length,
    });

    /* THE REBUILD IS HANDED OFF, NOT AWAITED, AND THAT IS THE WHOLE POINT.
     *
     * This handler used to rebuild the site and deploy it to Cloudflare
     * before replying. On a 38-page site that is more than ten minutes —
     * nearly all of it one model call per service page — and nginx closes a
     * proxied connection at sixty seconds. So every save ended in
     *
     *     504 Gateway Time-out — nginx/1.24.0 (Ubuntu)
     *
     * while the build ran happily on behind it, finished, and deployed, with
     * nobody left to tell. The work was never broken. A request is a promise
     * to answer soon, and this work cannot answer soon.
     *
     * THE WORDS ARE ALREADY SAVED, above, and that order still matters for
     * the same reason it always did: a rebuild that fails or is abandoned
     * leaves the edited words on the row, so pressing Save again retries
     * instead of asking somebody to retype what they typed.
     *
     * THE PAYLOAD IS A POINTER, NOT A COPY. Only the site id travels — the
     * job reads the model off the row when it starts, so a payload cannot go
     * stale and a second save cannot be overtaken by the first. */
    const job = await Job.create({
      kind: 'cfedit',
      user: req.user._id,
      status: 'queued',
      payload: { siteId: String(site._id) },
      progress: {
        /* INDETERMINATE, LIKE THE ZIP JOB. A re-render has no page count to
         * count down: the pages come from a stored recipe and are written in
         * one pass. A bar that claimed a total it could not measure would be
         * a worse lie than no bar. */
        total: 0,
        done: 0,
        stage: 'queued',
      },
    });

    log.info('cfSites.edit.queued', {
      requestId: req.id,
      siteId: String(site._id),
      jobId: String(job._id),
      changed: applied.changed.length,
      blanked: applied.blanked.length,
    });

    /* THE BLANKED BOXES ARE REPORTED ON THE WAY PAST, because the job knows
     * nothing about them — they were refused up here, before anything was
     * saved, and the progress page has no idea they happened. Carried in the
     * query string rather than the session: it survives a reload, and there
     * is nothing in it worth hiding. */
    const note = applied.blanked.length ? `?blanked=${applied.blanked.length}` : '';

    return res.redirect(`/jobs/${job._id}${note}`);

  } catch (err) {
    log.error('cfSites.editSave.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not save that</h1>
             <p class="lead">Your words were kept. The site was not rebuilt.</p>
             <a href="/cloudflare-sites/${esc(req.params.id)}/edit" class="btn btn-primary mt-3">Back to the words</a>`,
    }));
  }
});

/* -------------------------------------------------------------------------
 * Deleting
 * ---------------------------------------------------------------------- */

router.get('/cloudflare-sites/:id/delete', requireAuth, async (req, res) => {
  try {
    const site = await ownedSite(req);
    if (!site) return notFound(res);

    send(res, page({
      title: 'Delete this website',
      body: `<h1 class="h2">Delete ${esc(site.name || site.siteUrl)}?</h1>

             <p class="lead">
               ${esc(site.siteUrl)} will stop answering. This cannot be
               undone.
             </p>

             <form method="post" action="/cloudflare-sites/${site._id}/delete">
               ${res.locals.csrfField || ''}

               ${site.project ? `
               <div class="form-check mb-3">
                 <input class="form-check-input" type="checkbox" value="1"
                        id="dropProject" name="dropProject" checked>
                 <label class="form-check-label" for="dropProject">
                   Also remove it from Cloudflare — the Pages project, the
                   custom domain and the DNS record.
                 </label>
                 ${/* CHECKED BY DEFAULT, AND IT IS THE RIGHT DEFAULT.
                      Leaving it on removes everything this app created;
                      leaving it off leaves a Pages project holding its
                      pages.dev name for ever and a CNAME pointing at it,
                      with nothing in the app able to reach either again.
                      The blogs screen learned this the hard way: deleting
                      a blog used to remove none of the three. */''}
                 <div class="form-text text-white-50">
                   Leave this on unless you want the project kept in
                   Cloudflare. Nothing in this app can reach it afterwards.
                 </div>
               </div>` : ''}

               ${/* TYPING THE HOSTNAME, NOT A YES/NO. The confirm page and
                    the row's Delete button look the same for every site a
                    customer has, and the one thing that distinguishes the
                    site about to go is its address. Typing it is the only
                    step that cannot be done by muscle memory on the wrong
                    row. */''}
               <div class="mb-3">
                 <label class="form-label" for="confirm">
                   Type <code>${esc(site.siteUrl)}</code> to confirm
                 </label>
                 <input class="form-control" id="confirm" name="confirm"
                        required spellcheck="false" autocomplete="off"
                        autocorrect="off" autocapitalize="off">
               </div>

               <button class="btn btn-danger" type="submit">Delete it</button>
               <a href="/cloudflare-sites" class="btn btn-outline-light ms-2">Keep it</a>
             </form>`,
    }));

  } catch (err) {
    log.error('cfSites.deleteForm.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not load that</h1>
             <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

router.post('/cloudflare-sites/:id/delete', requireAuth, async (req, res) => {
  try {
    const site = await ownedSite(req);
    if (!site) return notFound(res);

    /* THE TYPED HOSTNAME, COMPARED TO THE STORED ONE. Trimmed because a
     * copy-paste brings a space with it often enough to matter, and
     * refusing a correct answer over whitespace teaches people to stop
     * reading the screen. */
    const typed = String(req.body.confirm || '').trim().toLowerCase();

    if (typed !== String(site.siteUrl || '').toLowerCase()) {
      return send(res, page({
        status: 400,
        title: 'Not deleted',
        body: `<h1 class="h2">That did not match</h1>
               <p class="lead">
                 Nothing was deleted. Type the address exactly as it is shown.
               </p>
               <a href="/cloudflare-sites/${site._id}/delete" class="btn btn-primary mt-3">Try again</a>`,
      }));
    }

    /* THE CLOUDFLARE SIDE FIRST, AND FAILING IT DOES NOT STOP THE REST.
     *
     * If the project cannot be removed — a token short a permission, a
     * project somebody already deleted by hand — the right outcome is still
     * to mark our own row removed, because the alternative is a website
     * nobody can delete at all. The reason is logged and shown. */
    let project = null;
    let released = null;

    if (site.project && '1' === String(req.body.dropProject || '')) {
      /* `expected` IS WHAT MAKES THIS SAFE TO RUN. It is the pages.dev host
       * this site actually deploys to, so removeDnsRecord() can refuse any
       * record that is not the one we created. The zone may hold a live
       * site on the same domain — Edwin's do — and one careless delete in
       * here would take it down. */
      const expected = String(site.lastDeployUrl || '')
        .replace(/^https:\/\//, '')
        .replace(/\/$/, '');

      /* WHICH ACCOUNT, RESOLVED BEFORE ANYTHING IS TOUCHED.
       *
       * This path is more dangerous to get wrong than the deploy.
       * releaseDomain() detaches a hostname and deletes a DNS record;
       * pointed at the wrong account it either does nothing, or finds
       * something of the same name and removes it. Project names are
       * derived from the hostname, and two accounts can host domains that
       * look alike.
       *
       * A SITE THAT NAMES AN UNREADABLE ACCOUNT IS NOT TORN DOWN REMOTELY.
       * The local row still goes — the customer asked for the site to be
       * deleted and the credentials are our problem, not theirs — but
       * nothing is detached or deleted at Cloudflare, and the log says why.
       * Falling back to the env here would aim a delete at the server's own
       * account. */
      let creds;

      try {
        creds = await cloudflare.credsFor(site);
      } catch (err) {
        log.error('cfSites.delete.credentials', err, {
          requestId: req.id,
          siteId: String(site._id),
          project: site.project,
        });

        released = { skipped: true, error: err.message };
        project = { ok: false, output: err.message };
      }

      if (!released) {
        /* THE DOMAIN COMES OFF BEFORE THE PROJECT GOES, and that order is
         * not tidiness: Cloudflare refuses to delete a Pages project that
         * is still serving an active custom domain. On the blogs screen it
         * showed as three deletes that worked and one that did not — the
         * three had domains still `pending` and the fourth had one that had
         * gone live. Edwin read the warning and thought his blog had not
         * been deleted. It had; the project had not. */
        released = await cfDeploy.releaseDomain({
          project: site.project,
          domain: site.siteUrl,
          expected: expected || undefined,
          creds,
        });

        project = await cfDeploy.deleteProject({
          project: site.project,
          env: childEnv(creds),
          creds,
        });
      }

      log.info('cfSites.projectDeleted', {
        requestId: req.id,
        siteId: String(site._id),
        project: site.project,
        domainDetached: Boolean(released.detached && released.detached.ok),
        dnsRemoved: Boolean(released.dns && released.dns.ok && released.dns.removed),
        projectDeleted: Boolean(project && project.ok),
      });
    }

    /* MARKED REMOVED, NOT DELETED, and models/CloudflareSite.js says why:
     * the row is the only record that this hostname was ever used, and a
     * hard delete frees the subdomain for somebody else while Cloudflare
     * may still be holding the project. */
    site.status = 'removed';

    /* AND THE KEPT COPY GOES WITH IT.
     *
     * The row survives so the hostname is not silently handed to somebody
     * else; the model, the recipe and the images do not — there is nothing
     * left to render them into. Leaving them would mean every deleted site
     * costs disk and database for ever, and the first sign would be a
     * builds/sites/ folder nobody could account for.
     *
     * THE ROW IS CLEARED BEFORE THE DISK, so a failure on the filesystem
     * cannot leave a row pointing at images that are gone — which would read
     * as an editable site whose re-render ships 404s. The other order fails
     * the useful way round: a folder with no row is an orphan on disk, which
     * is cheap and findable.
     *
     * NOT FATAL. A website nobody can delete because of a disk they cannot
     * see is worse than some tidying left undone; forget() reports rather
     * than throws. */
    site.contentModel = null;
    site.buildRecipe = null;
    site.editable = false;

    await site.save();

    const forgotten = await siteStore.forget(String(site._id));

    if (!forgotten.ok) {
      log.error('cfSites.forget.failed', new Error(forgotten.error), {
        requestId: req.id,
        siteId: String(site._id),
      });
    }

    log.info('cfSites.deleted', {
      requestId: req.id,
      userId: String(req.user._id),
      siteId: String(site._id),
      domain: site.siteUrl,
    });

    const trouble = [];

    if (released && released.skipped) {
      trouble.push('Its Cloudflare account could not be read, so nothing was '
                 + 'removed there.');
    } else if (released) {
      if (released.detached && !released.detached.ok) {
        trouble.push('The custom domain could not be taken off the project.');
      }
      if (released.dns && !released.dns.ok) {
        trouble.push('The DNS record could not be removed.');
      }
      if (project && !project.ok) {
        trouble.push('The Pages project could not be deleted.');
      }
    }

    return send(res, page({
      title: 'Deleted',
      body: `<h1 class="h2">${esc(site.siteUrl)} is gone</h1>

             ${trouble.length
               /* SAID OUT LOUD RATHER THAN LOGGED AND HIDDEN. Every one of
                * these leaves something behind in Cloudflare that only
                * somebody with the dashboard open can clear, and a page
                * that says "deleted" with no qualification is how a
                * leftover project goes unnoticed until the account is
                * full. */
               ? `<div class="alert alert-warning">
                    <strong>Some tidying up was left undone at Cloudflare.</strong>
                    <ul class="mb-0 small mt-1">
                      ${trouble.map(t => `<li>${esc(t)}</li>`).join('')}
                    </ul>
                  </div>`
               : '<p class="lead">Its Cloudflare project and DNS record were removed too.</p>'}

             <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back to your websites</a>`,
    }));

  } catch (err) {
    log.error('cfSites.delete.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not delete that</h1>
             <a href="/cloudflare-sites" class="btn btn-primary mt-3">Back</a>`,
    }));
  }
});

module.exports = router;

/* PUBLISHED OFF THE ROUTER, FOR THE BACKGROUND JOB AND NOTHING ELSE.
 *
 * The rebuild that used to run inside the save handler now runs in the job
 * runner, which has no request and no router. It still has to publish the
 * same way — the same credentials lookup, the same wrangler call, the same
 * capture of the result into the site's store — and a second implementation
 * of that is a second thing to keep in step.
 *
 * Attached rather than moved to a util because publishNow closes over this
 * file's namespace imports (cfDeploy, cloudflare, siteFiles, siteStore),
 * which the test harness stubs at call time. Moving it would move those too,
 * and the stubbing would have to be rebuilt around the new home for no gain.
 *
 * whyNotEditable goes with it so the job re-checks the same rule the screen
 * checked, rather than trusting that nothing changed between the save and
 * the moment the runner picks the job up. */
module.exports.publishNow = publishNow;
module.exports.whyNotEditable = whyNotEditable;
module.exports.buildDirFor = buildDirFor;
