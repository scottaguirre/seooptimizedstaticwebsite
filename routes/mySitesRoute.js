// routes/mySitesRoute.js
//
// The sites a customer has published, and the only place they can change one.
//
// WHY THIS SCREEN EXISTS — Edwin, 29 October: "every owner of the site and
// only the owner of the site will be able to edit the site nobody else",
// and on what editing means: "the user will enter just the anchor text or a
// new line or update the paragraph but I dont want to redo the whole
// content."
//
// So this is not a rebuild behind a different button. It loads what the site
// already says, lets one paragraph change, and re-renders. The seven model
// calls are not repeated and nothing is charged.
//
//     THE WORDS WERE PAID FOR ONCE.
//     FIXING A SENTENCE IS NOT NEW WORDS.
//
// WHERE THE CONTENT COMES FROM, AND WHY IT IS NOT THIS SERVER
//
// dist/user_<id> holds the LAST build and is wiped by the next one. The
// repository holds the site — every publish carries _src/localoptions.json
// up with the pages. So a customer can edit a site they made last month,
// which is the whole point, and the server needs to remember nothing but a
// pointer. models/GeneratedSite.js is that pointer.
//
// OWNERSHIP IS IN EVERY QUERY, NEVER CHECKED AFTERWARDS. A find by id that
// compares the user later passes a "does it load the right site" test and
// leaks on the next early return somebody adds — which is the rule
// ownedBlog() follows on the blog side, for the same reason.

'use strict';

const express = require('express');
const router = express.Router();

const requireAuth = require('../middleware/requireAuth');

const GeneratedSite = require('../models/GeneratedSite');
const Domain = require('../models/Domain');

const { pageTitle } = require('../utils/pageTitle');
const { withAppHeader } = require('../utils/appHeader');
const { log } = require('../utils/logger');

const { readSiteSource } = require('../utils/github/siteSource');
const { publishSite } = require('../utils/github/publishSite');
const { deleteSite } = require('../utils/github/deleteSite');
const { findSites } = require('../utils/github/adoptSites');
const { renderSite } = require('../utils/localOptions/render/renderSite');
const { structureFor } = require('../utils/localOptions/render/structures');
const { parseVerificationTags } = require('../utils/blog/verificationTags');

/* ------------------------------------------------------------------ page */

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

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

function notFound(res) {
  return send(res, page({
    status: 404,
    title: 'Not here',
    body: `<h1 class="h3">That site is not here</h1>
           <p class="lead">It may belong to another account.</p>
           <a href="/my-sites" class="btn btn-primary mt-3">My sites</a>`,
  }));
}

/** The site, loaded scoped to this login. Never by id alone. */
function ownedSite(req) {
  return GeneratedSite.findOne({
    _id: req.params.id,
    user: req.session.userId,
  }).lean();
}

/* ----------------------------------------------------------- adoption */

/**
 * Rebuild the pointer rows from what is actually on GitHub.
 *
 * WHY IT HAS TO EXIST — Edwin, 30 October: "the chicago plumber is not
 * showing on local and it's still live and I want to keep it." A build
 * writes its row into whatever database it ran against, so a site built on a
 * laptop is invisible to the server and vice versa.
 *
 * ONLY UNCLAIMED REPOSITORIES ARE TAKEN. A repository that already has a row
 * is left exactly as it is, whoever owns it — otherwise pressing this button
 * would quietly move another customer's site into your list. The domains are
 * a shared pool with no owner of their own, so "whoever asked first" is the
 * only claim this can honestly make, and it can only ever be made once.
 *
 * ONE DOMAIN FAILING DOES NOT STOP THE REST. A client who uninstalled the
 * App leaves an installation id that no longer resolves; that is one domain's
 * problem and not a reason to find nothing.
 */
async function adoptFor(userId) {
  const domains = await Domain.find({
    target: 'github',
    enabled: true,
    githubInstallationId: { $nin: ['', null] },
  }).lean();

  let found = 0;
  let added = 0;
  const problems = [];

  for (const domain of domains) {
    try {
      const { sites } = await findSites({ installationId: domain.githubInstallationId });

      found += sites.length;

      for (const site of sites) {
        const already = await GeneratedSite.findOne({
          owner: site.owner,
          repo: site.repo,
        }).lean();

        if (already) continue;

        await GeneratedSite.create({
          user: userId,
          domain: domain._id,
          domainName: domain.domain,
          owner: site.owner,
          repo: site.repo,
          businessName: site.businessName,
          trade: site.trade,
          publishedAt: site.publishedAt || new Date(),
          commitSha: '',
        });

        added += 1;
      }

    } catch (err) {
      problems.push(`${domain.domain}: ${err.message}`);
    }
  }

  return { found, added, problems, domains: domains.length };
}

router.post('/my-sites/adopt', requireAuth, async (req, res) => {
  try {
    const { found, added, problems, domains } = await adoptFor(req.session.userId);

    log.info('mySites.adopted', { requestId: req.id, found, added, domains });

    if (!domains) {
      return send(res, page({
        title: 'Nothing to look in',
        body: `<h1 class="h3 mb-3">There are no GitHub domains set up</h1>
               <p class="lead text-white-50">
                 Sites are found by looking at the GitHub account behind each
                 domain in the pool, and none of them is a GitHub domain yet.
               </p>
               <a href="/my-sites" class="btn btn-primary mt-3">My sites</a>`,
      }));
    }

    send(res, page({
      title: 'Looked for your sites',
      body: `
        <h1 class="h3 mb-3">
          ${added
            ? `${added} site${1 === added ? '' : 's'} added to your list`
            : 'Nothing new to add'}
        </h1>

        <p class="lead text-white-50">
          ${found} published site${1 === found ? '' : 's'} found across
          ${domains} domain${1 === domains ? '' : 's'}.
          ${found && !added
            ? ' They were all in your list already, or already belong to another account.'
            : ''}
        </p>

        ${problems.length ? `
        <div class="alert alert-warning py-2 px-3 small">
          <strong>Some domains could not be read:</strong>
          <ul class="mb-0">${problems.map(p => `<li>${esc(p)}</li>`).join('')}</ul>
        </div>` : ''}

        <a href="/my-sites" class="btn btn-primary mt-3">My sites</a>`,
    }));

  } catch (err) {
    log.error('mySites.adopt.failed', err, { requestId: req.id });

    send(res, page({
      status: 500,
      title: 'Could not look',
      body: `<h1 class="h3">We could not read your GitHub account</h1>
             <p class="lead text-white-50">${esc(err.message)}</p>
             <a href="/my-sites" class="btn btn-primary mt-3">My sites</a>`,
    }));
  }
});

/* ------------------------------------------------------------- the list */

/** The button, shown in both states — there is no harm in pressing it twice. */
function adoptButton(csrfField) {
  return `
    <form method="post" action="/my-sites/adopt" class="d-inline">
      ${csrfField || ''}
      <button class="btn btn-sm btn-outline-light" type="submit">
        Find my published sites
      </button>
    </form>`;
}

router.get('/my-sites', requireAuth, async (req, res) => {
  try {
    let sites = await GeneratedSite.find({ user: req.session.userId })
      .sort({ publishedAt: -1 })
      .lean();

    /* AN EMPTY LIST LOOKS ONCE BEFORE IT BELIEVES ITSELF.
     *
     * "Nothing published yet" is a claim about GitHub, and until this ran it
     * was really a claim about this database — which is how a live site came
     * to be invisible on one machine and present on another. The customer
     * should not have to know a button exists to be told the truth.
     *
     * ONLY WHEN EMPTY, because it is a request per repository and running it
     * on every visit would spend a client's rate limit on a question already
     * answered. */
    if (!sites.length) {
      try {
        const { added } = await adoptFor(req.session.userId);

        if (added) {
          sites = await GeneratedSite.find({ user: req.session.userId })
            .sort({ publishedAt: -1 })
            .lean();
        }
      } catch (err) {
        /* NOT FATAL. An unreachable GitHub means the list is empty, which is
         * what the page was about to say anyway. */
        log.info('mySites.autoAdoptFailed', { requestId: req.id, error: err.message });
      }
    }

    if (!sites.length) {
      return send(res, page({
        title: 'My sites',
        body: `<h1 class="h3 mb-3">My sites</h1>
               <p class="lead text-white-50">
                 Nothing published yet. A Local Website Options build puts its
                 site here as soon as it goes up.
               </p>
               <p class="text-white-50">
                 If you know a site is live and it is not here — built on
                 another machine, or before this screen existed — look for it:
               </p>
               ${adoptButton(res.locals.csrfField)}`,
      }));
    }

    const rows = sites.map((site, i) => `
      <tr>
        <td class="rownum">${i + 1}</td>
        <td>
          <strong>${esc(site.businessName || site.repo)}</strong><br>
          <a href="https://${esc(site.domainName)}/${esc(site.repo)}/"
             target="_blank" rel="noopener" class="link-light small">
            ${esc(site.domainName)}/${esc(site.repo)}/
          </a>
        </td>
        <td class="text-white-50">${esc(site.trade || '')}</td>
        <td class="text-white-50 small">
          ${site.publishedAt ? esc(new Date(site.publishedAt).toDateString()) : ''}
        </td>
        <td class="text-end text-nowrap">
          <a class="btn btn-sm btn-outline-light" href="/my-sites/${site._id}/edit">Edit</a>
          <!-- A LINK TO A CONFIRMATION, NOT A POST FROM HERE. Deleting is
               irreversible and the repository is the only copy of the
               site's words, so the button that does it lives on a page
               that says so and asks for the name to be typed. -->
          <a class="btn btn-sm btn-outline-danger ms-1"
             href="/my-sites/${site._id}/delete">Delete</a>
        </td>
      </tr>`).join('');

    send(res, page({
      title: 'My sites',
      body: `
        <h1 class="h3 mb-3">My sites</h1>

        <div class="d-flex justify-content-between align-items-start gap-3">
          <p class="text-white-50">
            Editing a site changes its words and publishes them again. It costs
            no credits — the writing is already done.
          </p>
          ${adoptButton(res.locals.csrfField)}
        </div>

        <table class="table table-navy align-middle">
          <thead><tr><th></th><th>Site</th><th>Trade</th><th>Published</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`,
    }));

  } catch (err) {
    log.error('mySites.list.failed', err, { requestId: req.id });
    send(res, page({ status: 500, title: 'Something went wrong', body: '<h1>We could not load your sites</h1>' }));
  }
});

/* ------------------------------------------------------------- the form */

/**
 * One page's headings and paragraphs, as fields.
 *
 * NAMED BY POSITION — page[2][sections][1][paragraphs][0]. The stored source
 * is an array of pages, each with an array of sections, each with an array
 * of paragraphs, and the form has to put every one back exactly where it
 * came from. Names that carry the position are how a flat POST body
 * reassembles into the same shape without anything having to guess.
 */
function sectionFields(prefix, sections = []) {
  return sections.map((section, s) => `
    <div class="mb-3 ps-3 border-start border-secondary">
      ${undefined === section.heading ? '' : `
      <label class="form-label small text-white-50">Heading</label>
      <input class="form-control mb-2" name="${prefix}[sections][${s}][heading]"
             value="${esc(section.heading)}" maxlength="200">`}

      ${(section.paragraphs || []).map((para, p) => `
      <textarea class="form-control mb-2" rows="4"
                name="${prefix}[sections][${s}][paragraphs][${p}]">${esc(para)}</textarea>`).join('')}
    </div>`).join('');
}

router.get('/my-sites/:id/edit', requireAuth, async (req, res) => {
  try {
    const site = await ownedSite(req);
    if (!site) return notFound(res);

    const domain = await Domain.findById(site.domain).lean();

    if (!domain || !domain.githubInstallationId) {
      return send(res, page({
        status: 409,
        title: 'Cannot reach that site',
        body: `<h1 class="h3">That site's domain is no longer set up</h1>
               <p class="lead">
                 The site is still on the internet. Its words cannot be loaded
                 because the GitHub account behind
                 <code>${esc(site.domainName)}</code> is no longer in the pool.
               </p>
               <a href="/my-sites" class="btn btn-primary mt-3">My sites</a>`,
      }));
    }

    const { source } = await readSiteSource({
      installationId: domain.githubInstallationId,
      repo: site.repo,
      owner: site.owner,
    });

    const b = source.business || {};

    /* THE DEFAULT THIS SITE'S STRUCTURE WOULD USE, so the box shows what is
     * actually on the page rather than an empty field beside a line the
     * owner can see. A site built before the field existed has no value
     * stored — the renderer falls back, and so does this. */
    const structure = structureFor(source.structure);
    const ledeDefault = structure.pages.defaultServicesLede();
    const servicesHeading = 'beacon' === structure.key ? 'What we do' : 'Services we offer';

    send(res, page({
      title: `Edit ${site.businessName || site.repo}`,
      body: `
        <h1 class="h3 mb-1">${esc(site.businessName || site.repo)}</h1>
        <p class="text-white-50 mb-4">
          <a href="https://${esc(site.domainName)}/${esc(site.repo)}/" target="_blank"
             rel="noopener" class="link-light">${esc(site.domainName)}/${esc(site.repo)}/</a>
        </p>

        <form method="post" action="/my-sites/${site._id}/edit">
          ${res.locals.csrfField || ''}

          <h2 class="h5 mt-4 mb-3">Business details</h2>

          <div class="row g-2 mb-3">
            <div class="col-md-6">
              <label class="form-label">Phone</label>
              <input class="form-control" name="business[phone]" value="${esc(b.phone)}">
            </div>
            <div class="col-md-6">
              <label class="form-label">Email</label>
              <input class="form-control" name="business[email]" value="${esc(b.email)}">
            </div>
            <div class="col-md-12">
              <label class="form-label">Street</label>
              <input class="form-control" name="business[street]" value="${esc(b.street)}">
            </div>
            <div class="col-md-6">
              <label class="form-label">City</label>
              <input class="form-control" name="business[city]" value="${esc(b.city)}">
            </div>
            <div class="col-md-2">
              <label class="form-label">State</label>
              <input class="form-control text-uppercase" name="business[state]"
                     maxlength="2" value="${esc(b.state)}">
            </div>
            <div class="col-md-4">
              <label class="form-label">ZIP</label>
              <input class="form-control" name="business[zip]" value="${esc(b.zip)}">
            </div>
          </div>

          <!-- LINKS, EXPLAINED WHERE THEY ARE TYPED. Nobody reads a help
               page for a syntax they use once a month. -->
          <div class="alert alert-secondary py-2 px-3 small">
            To link a few words, write them like this:
            <code>[our Leander office](https://example.com/leander)</code> —
            as many as you like, anywhere in a paragraph.
          </div>

          <!-- SEARCH CONSOLE, WHERE THE OWNER CAN ACTUALLY REACH IT.
               30 October. Google hands the tag over when a property is
               CREATED, and a client creates the property once their site
               exists — so the usual order is build, give them the address,
               they make a property, and only then does anybody have a
               value to put on the page.

               The wizard asks at build time, which covers the client who
               already has one. That is the minority. Until now everybody
               else needed tools/site-verification.js from a terminal, on
               the one machine whose dist/ folder happened to hold that
               site — which means the LAST build and nothing older.

               IT COSTS NOTHING. The seven model calls are not repeated:
               the site's words come from its repository and only the head
               changes. Same path the paragraphs below take.

               PREFILLED WITH WHAT THE SITE ALREADY CARRIES, as the tokens
               rather than as the tag Google gave — the tag is not stored
               and could not be shown back. Clearing the box removes
               verification from every page, which is why the help text
               says so out loud. -->
          <h2 class="h5 mt-4 mb-3">Google Search Console</h2>

          <label class="form-label small text-white-50">
            Verification tag <span class="text-white-50">— optional</span>
          </label>
          <textarea class="form-control mb-2" name="verification" rows="2" spellcheck="false"
                    placeholder='&lt;meta name="google-site-verification" content="..." /&gt;'>${
                      esc((source.verification || []).join('\n'))}</textarea>
          <div class="form-text mb-4">
            Paste the whole tag Google gives you. It goes on every page of the
            site. Emptying this box removes it.
          </div>

          <h2 class="h5 mt-4 mb-3">The home page</h2>

          <!-- NO HEADLINE BOX — 30 October. The home page's H1 is built from
               the business name and the town now, not written, so a box
               here would be a control that saves and changes nothing. The
               business name is not editable from this screen either: it is
               the repository name and the path in every canonical. -->
          <label class="form-label small text-white-50">Line under the headline</label>
          <input class="form-control mb-2" name="home[sub]" value="${esc((source.home || {}).sub)}">

          <label class="form-label small text-white-50">About heading</label>
          <input class="form-control mb-2" name="home[aboutHeading]"
                 value="${esc((source.home || {}).aboutHeading)}">

          ${((source.home || {}).about || []).map((para, i) => `
          <textarea class="form-control mb-2" rows="3" name="home[about][${i}]">${esc(para)}</textarea>`).join('')}

          <label class="form-label small text-white-50 mt-3">Line above the services</label>
          <textarea class="form-control mb-1" rows="2"
                    name="home[servicesLede]"
                    placeholder="${esc(ledeDefault)}">${
                      esc(undefined === (source.home || {}).servicesLede
                        ? ledeDefault
                        : (source.home || {}).servicesLede)}</textarea>
          <div class="form-text mb-2">
            Sits between the “${esc(servicesHeading)}” heading and the list.
            Empty it to show no line at all.
          </div>

          ${(source.services || []).map((service, i) => `
          <h2 class="h5 mt-5 mb-2">${esc(service.name)}</h2>
          <p class="text-white-50 small mb-3">
            ${esc(site.domainName)}/${esc(site.repo)}/${esc(service.slug)}/
          </p>

          <label class="form-label small text-white-50">Page heading</label>
          <input class="form-control mb-2" name="page[${i}][h1]" value="${esc(service.h1)}">

          <label class="form-label small text-white-50">One line for the home page list</label>
          <input class="form-control mb-3" name="page[${i}][blurb]" value="${esc(service.blurb)}">

          ${sectionFields(`page[${i}]`, service.sections)}`).join('')}

          <div class="d-flex justify-content-between mt-5">
            <a href="/my-sites" class="btn btn-outline-light">Cancel</a>
            <button class="btn btn-primary" type="submit">Save and publish</button>
          </div>
        </form>`,
    }));

  } catch (err) {
    log.error('mySites.edit.failed', err, { requestId: req.id, siteId: req.params.id });

    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1 class="h3">We could not load that site</h1>
             <p class="lead text-white-50">${esc(err.message)}</p>
             <a href="/my-sites" class="btn btn-primary mt-3">My sites</a>`,
    }));
  }
});

/* ------------------------------------------------------------- the save */

/**
 * `{ '0': x, '1': y }` or `[x, y]` — Express gives either.
 *
 * POSITIONS ARE KEPT, HOLES AND ALL, and the first version did not keep
 * them: it sorted the keys and mapped them, so `{ '1': … }` came back as a
 * one-element array and an edit meant for section TWO was applied to
 * section one. Every paragraph after a missing field shifts up by one, and
 * the page still renders.
 *
 *     A FORM THAT POSTS EVERY FIELD HIDES THIS FOR EVER,
 *     UNTIL ONE FIELD IS NOT POSTED.
 *
 * An unchecked box, a disabled input, a field a future version stops
 * rendering — any of those is a hole, and silently renumbering somebody's
 * paragraphs is not a thing to find out about later.
 */
function asList(value) {
  if (Array.isArray(value)) return value;
  if (!value || 'object' !== typeof value) return [];

  const out = [];

  for (const key of Object.keys(value)) {
    const at = Number(key);

    /* A KEY THAT IS NOT AN INDEX IS NOT A POSITION. `{ length: 5 }` from a
     * crafted body would otherwise become an array of that length. */
    if (Number.isInteger(at) && at >= 0 && at < 5000) out[at] = value[key];
  }

  return out;
}

const text = value => String(value == null ? '' : value).trim();

/**
 * The paragraphs a form sent, over the ones the site had.
 *
 * ABSENT IS NOT EMPTY, AND THE DIFFERENCE IS A DELETION.
 *
 *   a box that came back blank   the owner cleared it   -> drop it
 *   a box that did not come back it was never sent      -> keep what was there
 *
 * Treating both as "gone" was the first version, and on a body missing one
 * field it silently deleted a paragraph nobody had touched. This codebase
 * has met the same distinction before — `req.body.pages` being undefined
 * rather than {} cost an afternoon in October.
 *
 * AN EMPTIED ONE IS DROPPED RATHER THAN STORED AS ''. The renderer would
 * emit <p></p>, which reads on the page as a rendering fault rather than as
 * a deletion somebody meant.
 */
function keptParagraphs(sent, had = []) {
  const given = asList(sent);

  /* A PLAIN LOOP, BECAUSE Array.map SKIPS HOLES. `[ , 'Changed.' ]` has no
   * element at 0 — not an undefined one, NO element — so map never calls
   * the callback there and the "keep what was there" branch never ran. The
   * paragraph was dropped and the test said so; the code read as if it
   * could not happen. */
  const out = [];
  const length = Math.max(given.length, (had || []).length);

  for (let i = 0; i < length; i += 1) {
    const value = Object.prototype.hasOwnProperty.call(given, i)
      ? text(given[i])
      : (had || [])[i];

    if (value) out.push(value);
  }

  return out;
}

/**
 * The stored source with what was typed put back into it.
 *
 * EDITED IN PLACE, FIELD BY FIELD, AND THAT IS THE REQUIREMENT. Edwin: "I
 * dont want to redo the whole content." So this does not rebuild the source
 * from the form — it takes the source the site already has and replaces the
 * strings the form carried. Anything the form never showed — the stances,
 * the hero rotation, the areas, the verification tokens — survives because
 * nothing here touches it.
 *
 * A PARAGRAPH THAT CAME BACK EMPTY IS DROPPED, not stored as an empty
 * string: the renderer would emit <p></p>, which is a gap on the page that
 * looks like a rendering fault rather than a deletion somebody meant.
 */
function applyEdit(source, body) {
  const next = { ...source };

  next.business = { ...(source.business || {}) };

  for (const field of ['phone', 'email', 'street', 'city', 'state', 'zip']) {
    const given = (body.business || {})[field];
    if (undefined !== given) next.business[field] = text(given);
  }

  if (next.business.state) next.business.state = next.business.state.toUpperCase();

  const home = body.home || {};

  next.home = { ...(source.home || {}) };

  /* `servicesLede` IS IN THIS LIST AND NOT IN keptParagraphs(), because an
   * emptied one means NO LINE rather than a dropped paragraph — the
   * renderer tells '' (cleared on purpose) from undefined (never set, use
   * the default), and storing '' is what makes that box honest. */
  for (const field of ['h1', 'sub', 'aboutHeading', 'servicesLede']) {
    if (undefined !== home[field]) next.home[field] = text(home[field]);
  }

  if (undefined !== home.about) {
    next.home.about = keptParagraphs(home.about, (source.home || {}).about);
  }

  /* SEARCH CONSOLE — the one field on this form that is not words.
   *
   * ABSENT IS NOT EMPTY, AGAIN. A form that did not show the box must not
   * strip the tokens a site already carries; a box that came back blank
   * is somebody removing them on purpose. The same distinction the
   * paragraphs make, and the same one that cost an afternoon in October.
   *
   * PARSED WITH THE BLOGS' OWN PARSER, not a second one. It accepts the
   * whole tag off the clipboard or a bare token, refuses anything that is
   * not token-shaped, and caps how many there can be — and it is already
   * what the wizard and the blogs use. */
  if (undefined !== body.verification) {
    next.verification = parseVerificationTags(body.verification);
  }

  const pages = asList(body.page);

  next.services = (source.services || []).map((service, i) => {
    const given = pages[i];
    if (!given) return service;

    const out = { ...service };

    if (undefined !== given.h1) out.h1 = text(given.h1);
    if (undefined !== given.blurb) out.blurb = text(given.blurb);

    if (undefined !== given.sections) {
      const sections = asList(given.sections);

      out.sections = (service.sections || []).map((section, s) => {
        const sent = sections[s];
        if (!sent) return section;

        return {
          ...section,
          heading: undefined === sent.heading ? section.heading : text(sent.heading),
          paragraphs: undefined === sent.paragraphs
            ? section.paragraphs
            : keptParagraphs(sent.paragraphs, section.paragraphs),
        };
      });
    }

    return out;
  });

  return next;
}

router.post('/my-sites/:id/edit', requireAuth, async (req, res) => {
  try {
    const site = await ownedSite(req);
    if (!site) return notFound(res);

    const domain = await Domain.findById(site.domain).lean();

    if (!domain || !domain.githubInstallationId) {
      return notFound(res);
    }

    /* READ, EDIT, RENDER, PUSH — and the read is not optional. The form
     * carries only what it showed; everything else about the site lives in
     * the stored source and has to come from there. */
    const { source, owner } = await readSiteSource({
      installationId: domain.githubInstallationId,
      repo: site.repo,
      owner: site.owner,
    });

    const edited = applyEdit(source, req.body);

    const files = renderSite(edited);

    /* THE SOURCE GOES BACK UP WITH THE PAGES, or the next edit would load
     * the words this one replaced. */
    files['_src/localoptions.json'] = JSON.stringify(
      { ...edited, version: 1, now: edited.now }, null, 2
    );

    const published = await publishSite({
      installationId: domain.githubInstallationId,
      businessName: site.businessName || site.repo,
      files,
      message: `Edit ${site.businessName || site.repo}`,

      /* THE PHOTOGRAPHS AND THE LOGO ARE NOT RE-RENDERED AND CANNOT BE —
       * that logo was an upload, long gone. They are carried forward by the
       * sha the repository already holds. */
      keepOthers: true,
    });

    await GeneratedSite.updateOne(
      { _id: site._id, user: req.session.userId },
      { $set: { publishedAt: new Date(), commitSha: published.commitSha || '' } }
    );

    log.info('mySites.edited', {
      requestId: req.id,
      siteId: String(site._id),
      repo: `${owner}/${site.repo}`,
      commit: published.commitSha,
      unchanged: published.unchanged,
      uploaded: published.uploaded,
    });

    send(res, page({
      title: 'Saved',
      body: `
        <h1 class="h3 mb-3">Saved and published</h1>
        <p class="lead">
          ${published.unchanged
            ? 'Nothing had changed, so nothing was published.'
            : `${published.uploaded} page${1 === published.uploaded ? '' : 's'} updated.`}
        </p>
        <p class="text-white-50">
          GitHub takes a minute or two to serve the new version.
        </p>
        <a href="https://${esc(site.domainName)}/${esc(site.repo)}/" target="_blank"
           rel="noopener" class="btn btn-outline-light">Open the site</a>
        <a href="/my-sites" class="btn btn-primary ms-2">My sites</a>`,
    }));

  } catch (err) {
    log.error('mySites.save.failed', err, { requestId: req.id, siteId: req.params.id });

    /* THE SITE IS UNTOUCHED WHEN THIS HAPPENS. Nothing is written until the
     * push, and a failed push leaves the repository exactly as it was — so
     * the honest thing to say is "not saved", not "something went wrong". */
    send(res, page({
      status: 500,
      title: 'Not saved',
      body: `<h1 class="h3">We could not publish that change</h1>
             <p class="lead text-white-50">${esc(err.message)}</p>
             <p class="text-white-50">
               The site is as it was. Nothing was changed.
             </p>
             <a href="/my-sites/${esc(req.params.id)}/edit" class="btn btn-primary mt-3">Try again</a>`,
    }));
  }
});

/* ----------------------------------------------------------- the delete */

/**
 * What the owner has to type before a site is destroyed.
 *
 * THE BUSINESS NAME, MATCHED LOOSELY. Case and surrounding space are not the
 * point — the point is that somebody read the name of the site they are
 * about to delete and copied it out. A checkbox or an "are you sure" dialog
 * is dismissed by muscle memory; a name has to be looked at.
 *
 * THE REPOSITORY NAME IS ACCEPTED TOO, because that is what the list shows
 * in the URL under each site, and a site whose businessName row is empty —
 * an adopted one, later — would otherwise be impossible to confirm.
 */
function typedMatches(typed, site = {}) {
  const given = String(typed == null ? '' : typed).trim().toLowerCase();

  if (!given) return false;

  return [site.businessName, site.repo]
    .map(v => String(v == null ? '' : v).trim().toLowerCase())
    .filter(Boolean)
    .includes(given);
}

/** Shared by the confirmation page and by a refused POST. */
function confirmBody(site, { error = '' } = {}) {
  return `
    <h1 class="h3 mb-3">Delete ${esc(site.businessName || site.repo)}?</h1>

    ${error ? `<div class="alert alert-danger py-2 px-3">${esc(error)}</div>` : ''}

    <p class="lead">
      This takes the site off the internet and cannot be undone.
    </p>

    <ul class="text-white-50">
      <li>The repository <code>${esc(site.owner)}/${esc(site.repo)}</code> is deleted.</li>
      <li><code>${esc(site.domainName)}/${esc(site.repo)}/</code> stops working, with
          every service page under it.</li>
      <li>The site's words go with it — the repository is the only copy, so the
          site cannot be edited back into existence. Building it again costs
          credits and writes new words.</li>
    </ul>

    <form method="post" action="/my-sites/${site._id}/delete" class="mt-4">
      ${site.csrfField || ''}

      <label class="form-label">
        Type <strong>${esc(site.businessName || site.repo)}</strong> to confirm
      </label>
      <input class="form-control mb-3" name="confirm" autocomplete="off"
             style="max-width:28rem" required>

      <a href="/my-sites" class="btn btn-outline-light">Keep it</a>
      <button class="btn btn-danger ms-2" type="submit">Delete this site</button>
    </form>`;
}

router.get('/my-sites/:id/delete', requireAuth, async (req, res) => {
  try {
    const site = await ownedSite(req);
    if (!site) return notFound(res);

    send(res, page({
      title: `Delete ${site.businessName || site.repo}`,
      body: confirmBody({ ...site, csrfField: res.locals.csrfField || '' }),
    }));

  } catch (err) {
    log.error('mySites.deleteForm.failed', err, { requestId: req.id, siteId: req.params.id });
    send(res, page({ status: 500, title: 'Something went wrong', body: '<h1>We could not load that site</h1>' }));
  }
});

router.post('/my-sites/:id/delete', requireAuth, async (req, res) => {
  const site = await ownedSite(req).catch(() => null);
  if (!site) return notFound(res);

  const csrfField = res.locals.csrfField || '';

  if (!typedMatches(req.body && req.body.confirm, site)) {
    return send(res, page({
      status: 400,
      title: `Delete ${site.businessName || site.repo}`,
      body: confirmBody({ ...site, csrfField }, {
        error: 'That is not the name of this site, so nothing was deleted.',
      }),
    }));
  }

  try {
    const domain = await Domain.findById(site.domain).lean();

    /* NO INSTALLATION MEANS NO WAY TO DELETE THE REPOSITORY — and the row
     * must still be removable, or a site whose domain left the pool is a
     * line in the list for ever. So this says plainly that the site is
     * STILL LIVE and removes only the pointer. Claiming a deletion that did
     * not happen would be the worse answer. */
    if (!domain || !domain.githubInstallationId) {
      await GeneratedSite.deleteOne({ _id: site._id, user: req.session.userId });

      log.info('mySites.rowRemoved', {
        requestId: req.id,
        siteId: String(site._id),
        repo: `${site.owner}/${site.repo}`,
        reason: 'no installation for the domain',
      });

      return send(res, page({
        title: 'Removed from your list',
        body: `<h1 class="h3 mb-3">Removed from your list</h1>
               <p class="lead">
                 The site itself is <strong>still on the internet</strong>. The
                 GitHub account behind <code>${esc(site.domainName)}</code> is no
                 longer in the pool, so this app cannot delete the repository.
               </p>
               <p class="text-white-50">
                 To take it down, delete
                 <code>${esc(site.owner)}/${esc(site.repo)}</code> on GitHub.
                 Do not touch <code>${esc(site.owner)}.github.io</code> — that one
                 holds the domain.
               </p>
               <a href="/my-sites" class="btn btn-primary mt-3">My sites</a>`,
      }));
    }

    /* THE REPOSITORY FIRST, THE ROW SECOND, AND THE ORDER MATTERS.
     *
     * A row deleted before a failed repository delete leaves a live site
     * nothing in the app can see, edit or remove — the exact state this
     * screen was built to end. The other way round, a failure leaves both
     * standing and the button can simply be pressed again. */
    const gone = await deleteSite({
      installationId: domain.githubInstallationId,
      repo: site.repo,
      owner: site.owner,
    });

    await GeneratedSite.deleteOne({ _id: site._id, user: req.session.userId });

    log.info('mySites.deleted', {
      requestId: req.id,
      siteId: String(site._id),
      repo: `${gone.owner}/${gone.repo}`,
      already: gone.already,
    });

    send(res, page({
      title: 'Deleted',
      body: `<h1 class="h3 mb-3">${esc(site.businessName || site.repo)} is gone</h1>
             <p class="lead">
               ${gone.already
                 ? 'The repository had already been deleted, so only the entry in your list was removed.'
                 : 'The repository is deleted and the site is off the internet.'}
             </p>
             <p class="text-white-50">
               GitHub can take a few minutes to stop serving the old pages.
             </p>
             <a href="/my-sites" class="btn btn-primary mt-3">My sites</a>`,
    }));

  } catch (err) {
    log.error('mySites.delete.failed', err, { requestId: req.id, siteId: req.params.id });

    send(res, page({
      status: 500,
      title: 'Not deleted',
      body: `<h1 class="h3">We could not delete that site</h1>
             <p class="lead text-white-50">${esc(err.message)}</p>
             <p class="text-white-50">
               The site is still there and still yours. Nothing was removed.
             </p>
             <a href="/my-sites/${esc(req.params.id)}/delete" class="btn btn-primary mt-3">Try again</a>`,
    }));
  }
});

module.exports = router;
module.exports.applyEdit = applyEdit;
module.exports.asList = asList;
module.exports.typedMatches = typedMatches;
