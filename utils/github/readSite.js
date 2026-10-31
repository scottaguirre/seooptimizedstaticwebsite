// utils/github/readSite.js
//
// A built site, read off disk, as the publisher wants it.
//
// WHY THIS EXISTS AT ALL — 29 October, found by a broken logo on the first
// site published automatically.
//
// The job held a `files` map in memory, wrote it to dist/user_<id>, and
// published the MAP. That is not the site. The uploaded logo is copied
// straight onto disk by placeLogo() in runLocalOptions.js and never passes
// through the map at all — so the published repository had eleven pages,
// four photographs, the stylesheet, the sitemap, and an <img> pointing at a
// logo that was never sent.
//
// The bench tool had been right the whole time: tools/github-push.js reads
// the FOLDER, which is why yesterday's manual push carried the logo and the
// automatic one did not.
//
//     TWO DESCRIPTIONS OF ONE SITE DISAGREE THE MOMENT SOMETHING IS
//     WRITTEN BY A PATH THE OTHER ONE DOES NOT KNOW ABOUT.
//
// So there is one description now, and it is the folder: the same bytes the
// customer downloads, the same bytes the re-render tool reads, the same
// bytes that go to GitHub.

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Every file under `dir`, keyed by its path relative to it.
 *
 * READ AS BYTES, ALWAYS. The photographs are binary and the pages are text;
 * commit.js decides which is which by whether it was handed a Buffer, so
 * reading everything as utf-8 here would corrupt the images into valid files
 * that are no longer pictures.
 *
 * @param {string} dir
 * @param {string} [base]  internal, for the recursion
 * @param {object} [out]   internal, for the recursion
 * @returns {Object<string, Buffer>}
 */
function readSiteDir(dir, base = dir, out = {}) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      readSiteDir(full, base, out);
      continue;
    }

    /* SYMLINKS AND SOCKETS ARE NOT FILES A WEBSITE IS MADE OF, and
     * readFileSync on one would either follow it somewhere unexpected or
     * throw in the middle of a publish. */
    if (!entry.isFile()) continue;

    /* .DS_Store IS NOT PART OF ANYBODY'S WEBSITE. macOS writes one into
     * every folder somebody opens in Finder, and without this it would be
     * committed to a customer's repository and served by Pages. */
    if ('.DS_Store' === entry.name) continue;

    out[path.relative(base, full).split(path.sep).join('/')] = fs.readFileSync(full);
  }

  return out;
}

module.exports = { readSiteDir };
