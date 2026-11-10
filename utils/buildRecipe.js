// utils/buildRecipe.js
//
// What the wizard was asked for, written beside what it produced.
//
//   writeRecipe(distDir, ctx.body)   ->  <distDir>/_src/build.json
//   readRecipe(distDir)              ->  { version, body } | null
//
//
// WHY content.json IS NOT ENOUGH, WHICH IS THE WHOLE REASON THIS EXISTS
//
// content.json is the site's WORDS. It is written for the WordPress exporter
// and it holds what every page says — and a named subset of the business
// details, because the theme needs them.
//
// runGeneration needs more than that to run at all. It reads `ctx.body` for:
//
//   pages          the service pages, in wizard form, with their keywords
//   global         the business details AND the checkboxes
//   trustClaims    which hero badges this site claims
//   useNearMe      whether the copy is written for "near me" searches
//   showPricingTable, showReviews, showAboutForm
//
// None of those survive in the model. The checkboxes in particular cannot:
// they are decisions, and the model records outcomes. A site whose owner
// unticked the price table has no pricing section — which is
// indistinguishable, in the model, from a trade that is not allowed one.
//
//     THE MODEL SAYS WHAT THE SITE CAME OUT AS.
//     THIS SAYS WHAT IT WAS ASKED FOR.
//
// Both are needed to build it again. Re-rendering from the model alone would
// quietly turn optional sections back on, or off, depending on which way the
// defaults happen to fall.
//
//
// IT LIVES IN _src/, AND THAT IS LOAD-BEARING
//
// utils/cloudflareSites/siteFiles.js refuses to publish anything under _src/,
// so this never reaches Cloudflare. That matters more here than it does for
// content.json: the recipe carries the owner's email address and whatever
// else the wizard asked for, at a guessable URL on their own domain if it
// ever escaped.
//
// test-cloudflare-sites.js asserts the exclusion by prefix rather than by
// filename, so this file was covered by that test before it existed.
//
//
// NEVER THROWS, LIKE writeModel
//
// Failing to write the recipe must not fail a generation that otherwise
// succeeded. The cost of its absence is an edit that regenerates instead of
// reusing — expensive, not broken — and the log says so at both ends.

'use strict';

const fs = require('fs');
const path = require('path');

const RECIPE_FILENAME = 'build.json';

/**
 * Bumped when the SHAPE changes, not when a wizard field is added.
 *
 * The same contract contentModel.js states: anything reading an old recipe
 * needs to know which shape it is holding, and now is the only moment that
 * information exists.
 */
const RECIPE_VERSION = 1;

/**
 * The wizard payload, with anything that is not JSON removed.
 *
 * A ROUND TRIP THROUGH JSON RATHER THAN A SPREAD. `ctx.body` comes off a
 * multipart form, and what arrives is not guaranteed to be plain data —
 * express gives repeated fields as arrays, and a body-parser or a middleware
 * can leave prototypes, getters or circular references on it. JSON.stringify
 * resolves all of that the same way the file write would, but HERE, where a
 * failure is caught and reported rather than thrown halfway through writing.
 */
function plain(body) {
  return JSON.parse(JSON.stringify(body == null ? {} : body));
}

/**
 * @param {string} distDir
 * @param {object} body     ctx.body — the wizard payload
 * @returns {string|null}   the path written, or null
 */
function writeRecipe(distDir, body) {
  try {
    const dir = path.join(distDir, '_src');
    fs.mkdirSync(dir, { recursive: true });

    const target = path.join(dir, RECIPE_FILENAME);

    fs.writeFileSync(target, JSON.stringify({
      version: RECIPE_VERSION,
      writtenAt: new Date().toISOString(),
      body: plain(body),
    }, null, 2), 'utf8');

    console.log('🧾 build.json written');
    return target;

  } catch (err) {
    console.error('⚠️ Could not write build.json:', err.message);
    return null;
  }
}

/**
 * @returns {{version, writtenAt, body}|null}
 *
 * NULL FOR A VERSION THIS FILE DOES NOT KNOW, not a best effort. A recipe
 * whose shape has moved is one whose fields may mean something else, and
 * feeding it back into runGeneration would build a site from a
 * misunderstanding. Absent means "generate normally", which is correct and
 * merely costs money.
 */
function readRecipe(distDir) {
  try {
    const target = path.join(distDir, '_src', RECIPE_FILENAME);
    if (!fs.existsSync(target)) return null;

    const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));

    if (RECIPE_VERSION !== Number(parsed && parsed.version)) {
      console.warn(`⚠️ build.json is version ${parsed && parsed.version}; this build reads ${RECIPE_VERSION}`);
      return null;
    }

    return parsed;

  } catch (err) {
    console.error('⚠️ Could not read build.json:', err.message);
    return null;
  }
}

module.exports = { writeRecipe, readRecipe, RECIPE_FILENAME, RECIPE_VERSION, plain };
