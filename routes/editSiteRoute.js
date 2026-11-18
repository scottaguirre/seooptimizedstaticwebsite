// routes/editSiteRoute.js
//
// Change the words of the build sitting in dist/user_<id>, before it is
// downloaded or exported.
//
//   GET  /edit-site   the boxes
//   POST /edit-site   save, and rebuild if the words changed
//
//
// WHY — Edwin, 17 November
//
//     *"in Rank Fast mode if I want to change something in the content
//     before exporting to wordpress or static sites with webpack at the
//     moment I don't have the option to update the content … say I press
//     preview I check the site and I want to make a change I want to have
//     an option for that"*
//
// Until today the only way to change a word was to generate the whole site
// again — a fresh set of model calls, a fresh bill, and a different site,
// because the generator does not write the same sentences twice.
//
//     THE ONLY CONTROL OVER THE WORDS WAS AN EXPENSIVE RE-ROLL.
//
//
// ALMOST NONE OF THIS IS NEW, AND THAT IS THE POINT
//
// Every build already writes both halves of what an edit needs:
//
//   _src/content.json   the site's WORDS        (utils/contentModel.js)
//   _src/build.json     what it was ASKED FOR   (utils/buildRecipe.js)
//
// and runGeneration({ body: recipe.body, reuse: model }) already re-renders
// from stored words instead of calling the model. The Cloudflare edit screen
// has used that path since 8 November. This screen is the same three moves
// — collect, apply, re-render — over a FOLDER instead of over a database
// row.
//
//     A RE-RENDER CHARGES NOTHING. runGeneration.js, line 267:
//     `const charged = reuse ? 0 : credit.totalCost`. Editing your own
//     sentences is free, which is the fact that makes this worth having
//     rather than a cheaper-looking "generate it again".
//
//
// THE BUILD FOLDER IS THE RECORD, AND IT IS NOT FOREVER
//
// There is one dist/user_<id> per ACCOUNT. The next generation wipes it and
// the 48-hour sweep clears it, so edits — and the Search Console tag below —
// live exactly as long as the build does. Edwin, told this: *"i understand
// this, no problem"*. The screen says so anyway, because the person reading
// it in a month will not have been in this conversation.
//
//
// WHY THE VERIFICATION TAG IS HERE TOO
//
// Edwin, the same message: *"I also need a way to add the verification for
// google search console"*. A Cloudflare website gets its tags at publish
// time, from the row. A Rank Fast build has no row — it is a folder that
// gets previewed, zipped and exported — so the tag has to go into the built
// pages themselves.
//
// IT DOES NOT NEED A REBUILD. A verification tag is a line in the <head>; it
// has nothing to do with the words. So saving the tag alone writes it
// straight into the built pages and answers immediately, and only a change
// to the WORDS costs a re-render.

'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const Job = require('../models/Job');
const requireAuth = require('../middleware/requireAuth');
const { log } = require('../utils/logger');
const { pageTitle } = require('../utils/pageTitle');
const { appHeader, appHeaderAssets, appHeaderScripts, appSidebar, appSidebarAssets } =
  require('../utils/appHeader');

const editableText = require('../utils/cloudflareSites/editableText');
const { renderSections } = require('../utils/editForm');
const { readModel, writeModel } = require('../utils/contentModel');
const { readRecipe } = require('../utils/buildRecipe');
const { parseVerificationTags, MAX_TAGS } = require('../utils/blog/verificationTags');
const verificationHead = require('../utils/cloudflareSites/verificationHead');

/* CALLED THROUGH THE MODULE OBJECT, NEVER DESTRUCTURED, and six failing
 * tests are why. A bare `distDirFor(id)` is resolved inside this file and
 * cannot be replaced from outside it, so a suite that moved the build folder
 * arranged a temporary one and then watched this route read the real dist/.
 * See the note at the top of utils/buildDir.js. */
const buildDir = require('../utils/buildDir');

/**
 * The tag this build is carrying, kept beside the words.
 *
 * ITS OWN FILE, NOT A FIELD ON THE RECIPE. build.json is "what the wizard
 * was asked for" — its own header says so — and the wizard was never asked
 * for this. Writing it in there would make the recipe a record of two
 * different things, and the next person reading it would have to know which
 * parts came from the form.
 *
 * UNDER _src/, so utils/cloudflareSites/siteFiles.js refuses to publish it
 * and runProductionBuild strips it from the ZIP, for the same reason it
 * keeps content.json and build.json out: these are the site's workings, at a
 * guessable URL on somebody's own domain if they ever escaped.
 */
const TAGS_FILENAME = 'verification.json';

function tagsPath(distDir) {
  return path.join(distDir, '_src', TAGS_FILENAME);
}

function readTags(distDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(tagsPath(distDir), 'utf8'));

    return Array.isArray(raw.tags) ? raw.tags : [];
  } catch (_) {
    /* ABSENT IS THE NORMAL CASE, not an error: every build made before today
     * has no such file, and so does every build nobody has verified. */
    return [];
  }
}

/** Never throws, like writeModel and writeRecipe, and for the same reason. */
function writeTags(distDir, tags) {
  try {
    fs.mkdirSync(path.join(distDir, '_src'), { recursive: true });
    fs.writeFileSync(tagsPath(distDir), JSON.stringify({ tags }, null, 2), 'utf8');

    return true;
  } catch (err) {
    log.error('editSite.tags.writeFailed', err, { distDir });

    return false;
  }
}

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
${appHeaderAssets()}${appSidebarAssets()}
</head>
<body style="background:#082d5b;" class="text-white">
${appHeader('{{CSRF}}')}
${appSidebar('/edit-site')}
  <div class="container py-5" style="max-width: 900px;">
    ${body}
  </div>
${appHeaderScripts()}
</body>
</html>`,
  };
}

function send(res, spec) {
  return res.status(spec.status)
    .send(spec.html.replace(/{{CSRF}}/g, res.locals.csrfField || ''));
}

/**
 * The build, its words and its recipe — or a reason there is nothing to edit.
 *
 * ALL THREE OR NOTHING. A folder with pages but no content.json is a build
 * from before the model was written, or one whose write failed; either way
 * there is nothing to collect and a screen of zero boxes would read as "this
 * site has no words".
 */
function loadBuild(userId) {
  const distDir = buildDir.distDirFor(userId);

  if (!fs.existsSync(distDir)) {
    return { ok: false, code: 'noBuild', distDir };
  }

  const model = readModel(distDir);
  if (!model) return { ok: false, code: 'noModel', distDir };

  const recipe = readRecipe(distDir);
  if (!recipe || !recipe.body) return { ok: false, code: 'noRecipe', distDir };

  return { ok: true, distDir, model, recipe };
}

function cannotEdit(res, code) {
  const SAY = {
    noBuild: [
      'There is no website to edit yet',
      'Build one first — its words can be changed here before you download '
      + 'it or convert it to WordPress.',
    ],
    noModel: [
      'This build cannot be edited',
      'It was made before its words were kept separately, so there is '
      + 'nothing stored to change. Generating it again will fix that.',
    ],
    noRecipe: [
      'This build cannot be rebuilt',
      'Its words are here, but the record of what the wizard was asked for '
      + 'is not — so it cannot be put back together after an edit. '
      + 'Generating it again will fix that.',
    ],
  };

  const [heading, lead] = SAY[code] || SAY.noBuild;

  return send(res, page({
    status: 400,
    title: 'Nothing to edit',
    body: `<h1 class="h3">${esc(heading)}</h1>
           <p class="lead text-white-50">${esc(lead)}</p>
           <a href="/" class="btn btn-primary mt-3">Build a website</a>
           <a href="/dashboard" class="btn btn-outline-light mt-3 ms-2">My Dashboard</a>`,
  }));
}

/* -------------------------------------------------------------------------
 * The screen
 * ---------------------------------------------------------------------- */

router.get('/edit-site', requireAuth, (req, res) => {
  try {
    const build = loadBuild(req.user._id);
    if (!build.ok) return cannotEdit(res, build.code);

    const sections = renderSections(build.model, esc);
    const tags = readTags(build.distDir);

    const saved = 'saved' === req.query.ok;
    const blanked = Number(req.query.blanked) || 0;

    send(res, page({
      title: 'Edit your website',
      body: `
        <h1 class="h2 mb-1">Edit your website</h1>
        <p class="lead text-white-50">
          Change the wording and the headings, then download it or convert it
          to WordPress. Images, your business details and the address stay as
          they are.
        </p>

        ${saved ? `
        <div class="alert alert-success">
          Saved. ${blanked ? `${blanked} box${1 === blanked ? ' was' : 'es were'} left
          empty and kept its previous wording.` : ''}
        </div>` : ''}

        ${/* SAID ON THE SCREEN, NOT ONLY IN A COMMENT. One build folder per
              account: the next generation overwrites this one and the sweep
              clears it after 48 hours. The dashboard card already warns
              about both; somebody who has just spent ten minutes rewriting
              paragraphs is the person who most needs to know. */''}
        <div class="alert alert-secondary">
          <strong>These edits live with the build.</strong>
          <div class="small mt-1">
            Generating a new website replaces this one, and builds are kept
            for a limited time. Download or convert it once you are happy.
          </div>
        </div>

        <div class="alert alert-secondary">
          <strong>To link a phrase</strong>, wrap it like this:
          <code>&lt;a href="/contact.html"&gt;get in touch&lt;/a&gt;</code>.
          <div class="small text-muted mt-1">
            The generator already put links in some paragraphs. Leaving one
            alone keeps it; deleting the tag removes the link.
          </div>
        </div>

        <form method="post" action="/edit-site">
          ${res.locals.csrfField || ''}

          ${/* THE TAG FIRST, BECAUSE IT IS THE CHEAP ERRAND. Somebody here
                only to verify a property should not have to scroll past
                forty paragraph boxes to find the one field they came for —
                and saving it alone does not rebuild anything. */''}
          <h2 class="h4 mt-4 mb-1">Google Search Console</h2>
          <p class="text-white-50 mb-2">
            Paste the verification tag Google gave you, or just the code
            inside it. It goes into every page of this build, so the preview
            and the download both carry it.
          </p>

          <textarea class="form-control mb-1" name="verification" rows="2"
                    spellcheck="false"
                    placeholder='&lt;meta name="google-site-verification" content="..."&gt;'
                    >${esc(tags.join('\n'))}</textarea>
          <div class="form-text text-white-50 mb-2">
            One per line, up to ${MAX_TAGS}. Empty the box to remove it.
            Saving this on its own takes effect immediately — no rebuild.
          </div>

          <h2 class="h4 mt-5 mb-0">The words</h2>
          ${sections}

          <div class="mt-4 mb-5 d-flex gap-2">
            <button class="btn btn-primary btn-lg" type="submit">Save</button>
            <a href="/dashboard" class="btn btn-outline-light btn-lg">Cancel</a>
          </div>
        </form>`,
    }));

  } catch (err) {
    log.error('editSite.show.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not open that</h1>
             <a href="/dashboard" class="btn btn-primary mt-3">My Dashboard</a>`,
    }));
  }
});

/* -------------------------------------------------------------------------
 * Saving
 * ---------------------------------------------------------------------- */

router.post('/edit-site', requireAuth, async (req, res) => {
  try {
    const build = loadBuild(req.user._id);
    if (!build.ok) return cannotEdit(res, build.code);

    /* THE TAG, FIRST AND WHATEVER ELSE HAPPENS.
     *
     * Written into the pages that are on disk RIGHT NOW. If the words also
     * changed, the rebuild below rewrites those pages from scratch and the
     * job puts the tag back — see utils/editSiteJob.js. Doing it here as
     * well is not a wasted write: it is what makes a tag-only save
     * instant. */
    const tags = parseVerificationTags(req.body.verification);
    const tagsBefore = readTags(build.distDir);
    const tagsChanged = tags.join('\n') !== tagsBefore.join('\n');

    if (tagsChanged) {
      writeTags(build.distDir, tags);

      const touched = verificationHead.injectIntoDir(build.distDir, tags);

      log.info('editSite.verification', {
        requestId: req.id,
        userId: String(req.user._id),
        tags: tags.length,
        written: touched.written.length,
        headless: touched.headless.length,
      });
    }

    const applied = editableText.apply(build.model, req.body);

    /* NOTHING TO REBUILD. A save that only touched the tag — or touched
     * nothing at all — must not spend ten minutes re-rendering a site that
     * would come out identical. The answer is the screen again, which is
     * also where somebody who mistyped the tag will look. */
    if (!applied.changed.length) {
      return res.redirect('/edit-site?ok=saved');
    }

    /* SAVED BEFORE THE REBUILD IS QUEUED, the same order the Cloudflare
     * screen uses and for the same reason: a rebuild that fails or is
     * abandoned has to leave the edited words in place, so pressing Save
     * again retries rather than asking somebody to retype what they
     * typed. */
    writeModel(build.distDir, applied.model);

    log.info('editSite.saved', {
      requestId: req.id,
      userId: String(req.user._id),
      changed: applied.changed.length,
      rejected: applied.rejected.length,
      blanked: applied.blanked.length,
    });

    /* HANDED OFF, NOT AWAITED. nginx closes a proxied connection at sixty
     * seconds; a re-render of a large site takes longer than that even
     * reusing every sentence, because the pages are still written one at a
     * time. The Cloudflare edit screen learned this as a 504 on every save
     * while the build carried on unobserved behind it.
     *
     * THE PAYLOAD CARRIES NO WORDS. They are on disk; the job reads them
     * when it starts, so a payload cannot go stale and a second save cannot
     * be overtaken by the first. */
    const job = await Job.create({
      kind: 'siteedit',
      user: req.user._id,
      status: 'queued',
      payload: {},
      progress: { total: 0, done: 0, stage: 'queued' },
    });

    log.info('editSite.queued', {
      requestId: req.id,
      userId: String(req.user._id),
      jobId: String(job._id),
    });

    const note = applied.blanked.length ? `?blanked=${applied.blanked.length}` : '';

    return res.redirect(`/jobs/${job._id}${note}`);

  } catch (err) {
    log.error('editSite.save.failed', err, { requestId: req.id });
    send(res, page({
      status: 500,
      title: 'Something went wrong',
      body: `<h1>We could not save that</h1>
             <p class="lead">Your website was not changed.</p>
             <a href="/edit-site" class="btn btn-primary mt-3">Back to the words</a>`,
    }));
  }
});

module.exports = router;
module.exports.readTags = readTags;
module.exports.writeTags = writeTags;
module.exports.TAGS_FILENAME = TAGS_FILENAME;
