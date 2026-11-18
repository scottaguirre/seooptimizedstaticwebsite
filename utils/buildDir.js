// utils/buildDir.js
//
// Where an account's one build lives.
//
//   distDirFor(userId)  ->  <project>/dist/user_<id>
//
//
// WHY A FILE FOR ONE path.join — 17 November
//
// THREE PLACES NEEDED IT AND A FOURTH WAS ABOUT TO. utils/currentSite.js
// computes it to describe the build, routes/editSiteRoute.js to read and
// write its words, utils/editSiteJob.js to rebuild it. Each had its own
// `path.join(__dirname, '..', 'dist')` walking a different number of
// directories up, which is three chances to point at the wrong folder and
// no way to tell from any one of them.
//
// AND IT IS THE ONE THING A TEST HAS TO MOVE. Everything about the edit
// screen is about a FOLDER, so a suite has to put that folder somewhere
// disposable. A module-local function cannot be replaced from outside:
//
//     editSite.distDirFor = () => tmp;   // changes the EXPORT
//     distDirFor(userId)                 // the route still calls ITS OWN
//
// which is how six tests in test-edit-site.js passed their arrangement and
// then asserted against the real dist/ folder. test-cloudflare-sites.js
// states the same rule at the top of the file — "everything this suite
// stubs is read off its module at call time" — and this is the shape that
// makes that possible here.
//
//     A FUNCTION CALLED THROUGH ITS MODULE OBJECT CAN BE REPLACED.
//     ONE CALLED BY ITS BARE NAME CANNOT, AND NOTHING SAYS SO AT THE
//     CALL SITE.
//
// So callers write `buildDir.distDirFor(id)`, never a destructured import.

'use strict';

const path = require('path');

/** The project root, resolved once from this file's own location. */
const projectRoot = path.join(__dirname, '..');

const baseDistDir = path.join(projectRoot, 'dist');

/**
 * @param {string|object} userId
 * @returns {string} absolute path to that account's build folder
 *
 * ONE FOLDER PER ACCOUNT, NOT PER SITE, which is the fact every caller has
 * to know: starting a build destroys whatever was there, and the 48-hour
 * sweep clears what survives that. utils/cleanupScheduler.js and the
 * dashboard card both say so to the customer; this is where the shape comes
 * from.
 */
function distDirFor(userId) {
  return path.join(baseDistDir, `user_${String(userId)}`);
}

module.exports = { distDirFor, baseDistDir, projectRoot };
