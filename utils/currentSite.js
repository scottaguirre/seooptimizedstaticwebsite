// utils/currentSite.js
//
// Describes the site a user last generated, so the dashboard can offer
// preview / download / convert links.
//
// Without this, those buttons exist on exactly one page — the one shown
// immediately after generating. Pressing "Go Back", converting to WordPress,
// closing the tab or returning tomorrow all lose them, and the only way back
// is to regenerate, which spends credits and produces different copy.

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const DEFAULT_DIST = path.join(projectRoot, 'dist');

/**
 * Where builds live, read at CALL time rather than captured at load.
 *
 * THE SAME MOVE siteStore.storeRoot() MAKES, AND IT EARNED ITS NOTE THERE:
 * that module first exported `STORE_ROOT` as a const, a suite reassigned
 * the export believing it had redirected the module, and every test in it
 * wrote into the real builds/sites/ while fifteen of sixteen still passed.
 *
 *     A CONST CAPTURED AT LOAD CANNOT BE REDIRECTED BY ASSIGNING
 *     TO THE EXPORT THAT LOOKS LIKE IT.
 *
 * WITHOUT THIS, getCurrentSite() CANNOT BE TESTED AT ALL. It builds its own
 * path from the user id, so a suite can only reach the helpers underneath
 * it — which is how the first draft of test-current-site.js ended up with
 * two tests that asserted their own fixture and proved nothing about this
 * file.
 */
function distRoot() {
  return process.env.DIST_ROOT || DEFAULT_DIST;
}
const zipRoot = path.join(projectRoot, 'builds', 'zips');

/**
 * Folders this never descends into, for the page count.
 *
 * THE SAME THREE siteFiles.js REFUSES TO PUBLISH. `_src/` holds the words,
 * not pages; the other two are somebody's mistake if they are there at all.
 * Kept as its own set rather than imported because that module is about
 * what Cloudflare may receive and this one is about what to tell somebody
 * they built — two questions that happen to share an answer today.
 */
const SKIP_DIRS = new Set(['_src', 'node_modules', '.git']);

/**
 * Written by the build, served by the host, visited by nobody.
 *
 * NOT A PAGE OF THE SITE, and counting it put this card one above every
 * number the rest of the app uses. `TOTAL_PAGES` in runLocalOptions.js is
 * `1 + LOCAL_OPTIONS_SERVICE_PAGES + FIXED_PAGES.length` — eleven — while
 * the folder holds twelve .html files. A card saying "12 pages" for the
 * mode that calls itself eleven-page is a disagreement somebody has to
 * stop and resolve.
 */
const NOT_A_PAGE = new Set(['404.html']);

/**
 * Every .html file in a build, however deep.
 *
 * IT USED TO READ ONE LEVEL AND THE CARD SAID "2 pages" FOR AN ELEVEN-PAGE
 * SITE — Edwin, 19 November, looking at his dashboard with seven live sites
 * behind it.
 *
 *     fs.readdirSync(distDir).filter(f => f.endsWith('.html'))
 *
 * The generator writes `about.html` and `contact.html` at the top level, so
 * a flat read was the whole truth for it. Local Website Options writes
 * DIRECTORY-STYLE pages — `air-conditioner-repair/index.html`, so the URL
 * is `/air-conditioner-repair/` with no extension — and the top level holds
 * `index.html` and `404.html`. Two.
 *
 *     A COUNT THAT MATCHES THE OLDER LAYOUT IS NOT A COUNT
 *     THAT IS WRONG FOR THE NEWER ONE. IT IS A COUNT OF
 *     SOMETHING ELSE ENTIRELY.
 *
 * THE DEPLOY ALWAYS WALKED. siteFiles.walk() is recursive, which is why all
 * eleven pages went up while the card claimed two — the kind of disagreement
 * that makes somebody doubt a deploy that was fine.
 */
function htmlPages(dir, depth = 0) {
  /* A FLOOR, BECAUSE THIS RUNS ON EVERY DASHBOARD VIEW. No build nests
   * deeper than one folder today; four is room for a layout nobody has
   * designed yet and still a bounded walk on a folder somebody has pointed
   * at something unexpected. */
  if (depth > 4) return [];

  const out = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;

      out.push(...htmlPages(path.join(dir, entry.name), depth + 1)
        .map(rel => path.join(entry.name, rel)));

      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.html') && !NOT_A_PAGE.has(entry.name)) {
      out.push(entry.name);
    }
  }

  return out;
}

/** "2 hours ago", "just now" — friendlier than a timestamp for a 24h TTL. */
function relativeTime(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * @returns {object|null} null when the user has no generated site, so the
 *          dashboard can simply omit the card.
 */
function getCurrentSite(userId) {
  const id = String(userId);
  const distDir = path.join(distRoot(), `user_${id}`);

  try {
    if (!fs.existsSync(distDir)) return null;

    const pages = htmlPages(distDir);
    if (!pages.length) return null;

    // Business name and page counts come from the model the generator wrote.
    let businessName = '';
    let location = '';
    let generatedAt = null;
    let serviceCount = 0;
    let locationCount = 0;

    const modelPath = path.join(distDir, '_src', 'content.json');
    if (fs.existsSync(modelPath)) {
      try {
        const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
        businessName = (model.global && model.global.businessName) || '';
        location = (model.global && model.global.location) || '';
        generatedAt = model.generatedAt ? new Date(model.generatedAt) : null;
        serviceCount = (model.pages || []).filter(p => p.type === 'service').length;
        locationCount = (model.pages || []).filter(p => p.type === 'location').length;
      } catch (err) {
        // Corrupt model shouldn't hide the card; fall back to file mtime.
      }
    }

    /* THE OTHER BUILDER'S SOURCE, WHEN THERE IS NO content.json.
     *
     * Local Website Options writes _src/localoptions.json and deliberately
     * never writes the other — see the note at the top of runLocalOptions.js.
     * So this card showed a BLANK BUSINESS NAME for every site that mode has
     * ever built, and fell back to a file mtime for the date.
     *
     * THE THIRD PLACE THAT ASSUMED ONE BUILDER, found the same afternoon as
     * the other two: capture() refused those builds outright, and
     * rebuildJob required runGeneration and nothing else.
     *
     *     A HELPER THAT READS "THE" MODEL FILE IS CORRECT UNTIL
     *     THERE ARE TWO, AND SILENT ABOUT IT AFTERWARDS.
     *
     * READ DIRECTLY RATHER THAN THROUGH siteStore. That module is about
     * KEEPING a published site's words; this one describes a folder on
     * disk and is loaded by the dashboard on every page view. One
     * fs.existsSync and a JSON.parse is the whole of what is shared. */
    if (!businessName || !generatedAt) {
      const sourcePath = path.join(distDir, '_src', 'localoptions.json');

      if (fs.existsSync(sourcePath)) {
        try {
          const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
          const business = source.business || {};

          businessName = businessName || business.name || '';

          /* `city, state` — THE SHAPE THE OTHER BRANCH PRODUCES. The
           * generator stores `location` as one string and the card prints
           * it beside the name; this source keeps the two apart. */
          location = location
            || [business.city, business.state].filter(Boolean).join(', ');

          /* `now` IS AN ISO STRING HERE, which new Date() takes. An
           * unparseable one leaves generatedAt null and the mtime fallback
           * below still runs — the same answer this card gave before. */
          if (!generatedAt && source.now) {
            const stamped = new Date(source.now);
            if (!Number.isNaN(stamped.getTime())) generatedAt = stamped;
          }

          serviceCount = serviceCount || (source.services || []).length;
        } catch (err) {
          // Same as above: a corrupt source must not hide the card.
        }
      }
    }

    if (!generatedAt) {
      try {
        generatedAt = fs.statSync(path.join(distDir, pages[0])).mtime;
      } catch (err) {
        generatedAt = new Date();
      }
    }

    return {
      distDir,
      businessName,
      location,
      generatedAt,
      generatedAgo: relativeTime(generatedAt),
      pageCount: pages.length,
      serviceCount,
      locationCount,
      previewUrl: `/dist/user_${id}`,
      hasStaticZip: fs.existsSync(path.join(zipRoot, `user_${id}.zip`)),
      hasWpZip: fs.existsSync(path.join(zipRoot, `user_${id}_wp-theme.zip`)),
    };

  } catch (err) {
    console.error('Could not read current site:', err.message);
    return null;
  }
}

module.exports = {
  getCurrentSite, relativeTime, htmlPages, distRoot,
  SKIP_DIRS, NOT_A_PAGE, DEFAULT_DIST,
};