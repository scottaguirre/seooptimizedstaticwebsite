// utils/editSiteJob.js
//
// Re-render the build in dist/user_<id> from its own edited words.
//
//   jobRunner.registerGenerator('siteedit', rebuildForJob);
//
//
// WHY A JOB AND NOT PART OF THE SAVE
//
// The same reason utils/cloudflareSites/rebuildJob.js is one, and that file
// records how it was found out: nginx closes a proxied connection after
// sixty seconds, a re-render takes longer than that, and every save ended in
//
//     504 Gateway Time-out — nginx/1.24.0 (Ubuntu)
//
// while the build carried on happily behind it with nobody left to tell.
//
//     A REQUEST IS A PROMISE TO ANSWER SOON. Work that cannot answer soon
//     does not belong in one, however well it works.
//
//
// WHY IT IS NOT rebuildJob.js WITH A FLAG
//
// They do different things at both ends. That one reads its words off a
// Mongo row and finishes by deploying to Cloudflare; this one reads a folder
// and finishes by putting a verification tag back. What they SHARE is the
// middle — runGeneration with `reuse` — and that is already one function
// called from both.
//
//     THE SHARED PART IS THE RE-RENDER, NOT THE ERRAND AROUND IT. A flag
//     threaded through the other file would have made every line in it ask
//     which kind of job it was in.
//
//
// WHAT IT DOES NOT DO: SAVE THE WORDS
//
// They are already on disk. routes/editSiteRoute.js writes content.json
// before it enqueues, and that order is the one thing here that must not
// change — a failed or abandoned rebuild has to leave the edited words in
// place, so pressing Save again retries rather than asking somebody to
// retype what they typed.
//
//
// IT CHARGES NOTHING
//
// runGeneration.js, line 267: `const charged = reuse ? 0 : credit.totalCost`.
// Every sentence comes from the stored model, so there is no model call to
// pay for. The job still returns what runGeneration reports rather than a
// hard zero — if that rule ever changes, the Job row should say what really
// happened, not what this file assumed.

'use strict';

const fs = require('fs');
const path = require('path');

const { log } = require('./logger');
const { readModel } = require('./contentModel');
const { readRecipe } = require('./buildRecipe');
const verificationHead = require('./cloudflareSites/verificationHead');

/* THROUGH THE MODULE OBJECT. See the note in utils/buildDir.js: a
 * destructured import is captured at require() and a test that moves the
 * build folder would be watched reading the real one. */
const buildDir = require('./buildDir');

/**
 * @param {object}   job            the Job row
 * @param {function} [opts.onProgress]
 * @returns {Promise<{creditsCharged: number}>}
 *
 * THROWS RATHER THAN RETURNING A FAILURE, like rebuildJob.js: the runner
 * catches, marks the job failed and keeps the message, which is what the
 * progress page shows. A returned error object would be a second way of
 * failing that only this file knows about.
 */
async function rebuildForJob(job, { onProgress } = {}) {
  const jobId = String(job._id);
  const userId = String(job.user);
  const distDir = buildDir.distDirFor(userId);

  /* REQUIRED INSIDE THE FUNCTION, NOT AT THE TOP. utils/runGeneration pulls
   * in the OpenAI client, which THROWS AT LOAD when OPENAI_API_KEY is unset.
   * This module is required by server.js at startup, so a top-level import
   * would take the whole app down on a machine without the key rather than
   * only the path that needs it. rebuildJob.js carries the same note after
   * the same failing suite. */
  const { runGeneration } = require('./runGeneration');

  /* READ AGAIN, NOT TAKEN FROM THE PAYLOAD. Minutes can pass between the
   * save and the runner picking this up — long enough for a new build to
   * have replaced this folder, or the sweep to have cleared it. The folder
   * is the truth; the job is only a pointer to the account. */
  if (!fs.existsSync(distDir)) {
    throw new Error(
      'That build is no longer here, so there was nothing to rebuild. '
      + 'Generating a new website replaces the previous one.'
    );
  }

  const model = readModel(distDir);
  const recipe = readRecipe(distDir);

  if (!model) {
    throw new Error('The edited words could not be read back, so nothing was rebuilt.');
  }

  if (!recipe || !recipe.body) {
    throw new Error(
      'The record of what this website was asked for is missing, so it '
      + 'could not be put back together.'
    );
  }

  /* THE TAG, READ BEFORE THE REBUILD WIPES THE PAGES CARRYING IT.
   *
   * runGeneration writes every page from scratch, so whatever
   * injectIntoDir() put in the <head>s a moment ago is about to be gone. The
   * token lives in _src/verification.json, which the rebuild does not touch,
   * and it goes back in below.
   *
   *     A SETTING STORED ONLY IN THE THING IT CONFIGURES IS A SETTING
   *     THAT SURVIVES UNTIL THE NEXT BUILD.
   *
   * Read through the route's own helper rather than re-implementing the
   * filename and the shape here, which is how the two would drift. */
  const { readTags } = require('../routes/editSiteRoute');
  const tags = readTags(distDir);

  if (onProgress) {
    await onProgress({ stage: 'rebuilding', current: '', done: 0, total: 0 });
  }

  /* `files: []` — NO UPLOADS. The logo and favicon are not re-uploaded; with
   * `reuse` set, runGeneration takes their paths off the stored model. See
   * the note beside its required-files guard, which used to refuse exactly
   * this call. */
  const built = await runGeneration({
    body: recipe.body,
    files: [],
    user: { _id: job.user },
    requestId: jobId,
    reuse: model,
  });

  const touched = verificationHead.injectIntoDir(built.distDir || distDir, tags);

  log.info('editSite.rebuilt', {
    jobId,
    userId,
    charged: built.creditsCharged,
    reused: Boolean(built.reused),
    tags: tags.length,
    tagged: touched.written.length,
  });

  return { creditsCharged: built.creditsCharged || 0 };
}

module.exports = { rebuildForJob };
