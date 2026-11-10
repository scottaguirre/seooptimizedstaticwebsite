// utils/cloudflareSites/siteFiles.js
//
// Read a generated website off disk into the map deployBlog() uploads.
//
//   const read = readSite('/path/to/dist/user_abc');
//   read.ok -> { 'index.html': <Buffer>, 'css/index.css': <Buffer>, ... }
//
// NOTHING HERE RENDERS ANYTHING. The generator already wrote the site; this
// turns a folder into `{ path: contents }` and refuses the folders and files
// that must not leave the box. The blog half of this product builds its map
// in memory and never touches the disk, which is why that path needs no
// equivalent of this file.
//
//
// BUFFERS, NOT STRINGS
//
// A generated site is mostly images — .webp heroes, .png logos, .ico
// favicons. Read as utf8 and written back out, every one of them is
// corrupted in a way nothing notices until a browser refuses to draw it.
// writeSite() in utils/blog/cloudflare/deploy.js takes `string | Buffer`
// precisely so this can hand it bytes.
//
//
// POSIX SEPARATORS, ALWAYS
//
// The keys become URL paths. On this server path.relative() already returns
// forward slashes, so normalising looks like superstition — until the day
// somebody runs the suite on Windows and every nested page deploys to a
// filename with a backslash in it rather than to a folder.

'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Directories never deployed, whatever is inside them.
 *
 * `_src` IS THE ONE THAT MATTERS, and it is not tidiness. It holds
 * `content.json` — the model the generator wrote, carrying the business
 * name, address, phone, every service, every location and every line of
 * generated copy — alongside the webpack entry stubs. Uploaded, that file
 * sits at `https://<customer-domain>/_src/content.json`, readable by
 * anybody who guesses it, on the customer's own domain.
 *
 * utils/contentModel.js already records that `_src/` is stripped from the
 * production copy before zipping. This is the same rule applied to the
 * other way out of the folder, and there are now two ways out.
 */
const SKIP_DIRS = new Set(['_src', 'node_modules', '.git']);

/**
 * Files that belong to the machine rather than to the site.
 *
 * `.DS_Store` is the one that actually turns up: Finder writes it into any
 * folder somebody opens, and Edwin's builds live on his Desktop.
 */
const SKIP_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

/** Cloudflare Pages' own ceilings, so the refusal happens here and says why. */
const MAX_FILES = 20000;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

/**
 * Walk a directory into a flat list of [posixRelativePath, absolutePath].
 *
 * SYMLINKS ARE SKIPPED, NOT FOLLOWED. The generator creates none, so one
 * here means something unexpected put it there — and following it would
 * read, and then publish, a file from outside the build folder. The same
 * reasoning as resolveInside() in deploy.js: a path that leaves the
 * directory is not a path with a typo in it.
 *
 * `withFileTypes` IS WHAT MAKES THAT POSSIBLE. readdirSync without it
 * returns names, and the obvious follow-up — statSync — follows the link,
 * so a symlink to a directory reads as a directory and gets walked.
 * lstatSync would work; Dirent is one syscall instead of two.
 */
function walk(root, current, out, skipped) {
  const entries = fs.readdirSync(current, { withFileTypes: true });

  for (const entry of entries) {
    const full = path.join(current, entry.name);
    const rel = path.relative(root, full).split(path.sep).join('/');

    if (entry.isSymbolicLink()) {
      skipped.push({ path: rel, why: 'a symbolic link' });
      continue;
    }

    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) {
        skipped.push({ path: `${rel}/`, why: 'not published' });
        continue;
      }

      walk(root, full, out, skipped);
      continue;
    }

    if (!entry.isFile()) {
      skipped.push({ path: rel, why: 'not a regular file' });
      continue;
    }

    if (SKIP_FILES.has(entry.name)) {
      skipped.push({ path: rel, why: 'not part of the site' });
      continue;
    }

    out.push([rel, full]);
  }
}

/**
 * @param {string} dir  a build folder, normally dist/user_<id>
 *
 * @returns {{ ok: true, files, count, bytes, skipped }}
 *        | {{ ok: false, error, skipped? }}
 *
 * RETURNS A RESULT RATHER THAN THROWING, because every caller is a route
 * handler that has to turn the answer into a sentence on a page. The one
 * thing it does let through is an unreadable file mid-walk: that is a disk
 * or permissions problem, not a decision this function gets to make, and
 * swallowing it would publish a site with a page missing from it.
 */
function readSite(dir) {
  const root = path.resolve(String(dir || ''));

  if (!root || !fs.existsSync(root)) {
    return {
      ok: false,
      error: 'There is no build to publish. Generate a website first.',
    };
  }

  let stat;
  try {
    stat = fs.statSync(root);
  } catch (err) {
    return { ok: false, error: `Could not read the build folder: ${err.message}` };
  }

  if (!stat.isDirectory()) {
    return { ok: false, error: 'That build path is not a folder.' };
  }

  const found = [];
  const skipped = [];

  try {
    walk(root, root, found, skipped);
  } catch (err) {
    return { ok: false, error: `Could not read the build folder: ${err.message}`, skipped };
  }

  /* AN index.html IS THE ONE THING A SITE MUST HAVE, and the check is here
   * rather than in the route because it is a fact about the folder.
   *
   * Without it Cloudflare serves the subdomain and returns 404 at the root,
   * which reads as a broken deploy rather than as a build that was never
   * finished — and the publish will have already created a project and a
   * DNS record by then. */
  if (!found.some(([rel]) => 'index.html' === rel)) {
    return {
      ok: false,
      error: 'That build has no index.html, so there is no home page to serve. '
           + 'Generate the website again.',
      skipped,
    };
  }

  if (found.length > MAX_FILES) {
    return {
      ok: false,
      error: `That build has ${found.length} files and Cloudflare Pages allows `
           + `${MAX_FILES}.`,
      skipped,
    };
  }

  const files = {};
  let bytes = 0;

  for (const [rel, full] of found) {
    const size = fs.statSync(full).size;

    /* REFUSED BEFORE IT IS READ, not after. A 2GB file in a build folder
     * would otherwise be loaded into memory in full, on a 2GB box, to find
     * out it is too big to upload. */
    if (size > MAX_FILE_BYTES) {
      return {
        ok: false,
        error: `${rel} is ${Math.round(size / 1024 / 1024)}MB and Cloudflare `
             + `Pages allows 25MB per file.`,
        skipped,
      };
    }

    files[rel] = fs.readFileSync(full);
    bytes += size;
  }

  return { ok: true, files, count: found.length, bytes, skipped };
}

module.exports = {
  readSite, walk, SKIP_DIRS, SKIP_FILES, MAX_FILES, MAX_FILE_BYTES,
};
