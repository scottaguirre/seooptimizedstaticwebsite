const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();

const {
  appHeader, appHeaderAssets, appHeaderScripts, appSidebar, appSidebarAssets,
} = require('../utils/appHeader');

const { designsFor, designsKeyFor } = require('../utils/localOptions/designs');

const FORM_PATH = path.join(__dirname, '../src/views/form.html');

/** For a double-quoted HTML attribute. The list is literals, but this goes
 *  into markup and that should not depend on an invariant two files away. */
function escAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Read once at startup. The file does not change while the server runs, and
// re-reading it on every page load is needless disk work.
let formHtml = null;

/**
 * The wizard, optionally already decided about what it is building.
 *
 * ONE PAGE, TWO DOORS. /github-sites is this same wizard with its mode
 * fixed — see LOCKED_MODE in public/js/generateDinamycForm.js. It is not a
 * second wizard: a copy would be a second place to fix every bug, and the
 * two would differ within a week.
 *
 * WHY THE MODE TRAVELS IN A META TAG. generateDinamycForm.js is a static
 * file, served and cached as one; the mode is per-request. The CSRF token
 * above has the same shape of problem and the same answer, which is also
 * why this route renders the page rather than sending the file. A query
 * string would work right up until somebody bookmarked /?mode=localoptions
 * without it, or stripped it sharing the link.
 *
 * A DESTINATION IS NOT A MODE, and the whole change rests on that one
 * distinction. `mode` decides WHAT gets built — Local Website Options
 * builds its own eleven pages and publishes itself, which is why
 * /github-sites locks a mode and hides three steps. `target` decides WHERE
 * the finished build goes, and a Cloudflare website is an ordinary build of
 * ANY mode with an address on the end. Locking one has nothing to do with
 * locking the other, so they are two parameters rather than one, and
 * /cloudflare-sites/new leaves step 1 exactly as it is.
 *
 * @param {object} opts
 * @param {string} opts.mode     '' for the open wizard
 * @param {string} opts.target   '' leaves the build in the build folder
 * @param {string} opts.row      the sidebar row to mark as the way in
 * @param {string} opts.heading  what this door says it is building
 * @param {string} opts.blurb    one line under it, saying where it ends up
 */
function renderWizard({
  mode = '', target = '', row = '/', heading = '', blurb = '',
} = {}) {
  const lockedMode = mode;

  /* WHICH DESIGNS THIS DOOR OFFERS, WHICH IS NOT ALWAYS ITS MODE.
   *
   * It was the mode until 17 November, and that held while one mode had one
   * set of layouts. Cloudflare Local Automation breaks it: the same
   * `localoptions` build, the same eleven pages, a different destination —
   * and its own five layouts, which must never appear on /github-sites and
   * vice versa.
   *
   *     A LAYOUT BELONGS TO A DOOR, NOT TO A BUILDER. Two doors can run the
   *     same builder and still have nothing to offer each other.
   *
   * ⚠ DERIVED, NOT PASSED IN, AND THAT CHANGED AFTER IT SHIPPED. This was
   * a `designs` argument the route set to CF_MODE by hand — and the BUILD
   * went on resolving the picked design against the siteMode, so it looked
   * up a Cloudflare layout under `localoptions`, found nothing, and fell
   * back to Ledger. Design 4 built Design 1, and nothing failed. Edwin:
   * *"but this is a copy of design 1. i thoght design 4 was different"*.
   *
   *     A DOOR THAT DECIDES ITS OWN LIST CAN OFFER SOMETHING THE BUILD
   *     CANNOT LOOK UP. Both ends now ask designsKeyFor() the same
   *     question with the same two facts, so they cannot disagree.
   *
   * Returns the mode unchanged for the three doors that existed before, so
   * none of them notices. */
  const designsKey = designsKeyFor({ siteMode: mode, siteTarget: target });

  return (req, res) => {
  try {
    if (formHtml === null) {
      formHtml = fs.readFileSync(FORM_PATH, 'utf8');
    }

    // Rendered rather than sent as a file, so the CSRF token can be injected.
    //
    // It goes in a META TAG rather than a hidden input because the wizard
    // submits through fetch() with FormData. The CSRF check runs before
    // multer parses that multipart body, so a form field would be invisible
    // at the point of checking — spinner.js reads this meta tag and sends it
    // as the X-CSRF-Token header instead.
    const meta = `<meta name="csrf-token" content="${res.locals.csrfToken || ''}">`
      + (lockedMode ? `\n  <meta name="site-mode" content="${lockedMode}">` : '')
      + (target ? `\n  <meta name="site-target" content="${target}">` : '')

      /* THE DESIGNS THIS DOOR OFFERS, AND ONLY THOSE — 17 November.
       *
       * Edwin, planning five new layouts for the automated Cloudflare mode:
       * *"can we just show each group of designs mapped out to either
       * github/cloudflare so the user never has to worry about mixing them
       * up?"*
       *
       * FILTERED HERE, ON THE SERVER, where designs.js lives. The browser
       * on /github-sites is never told the other designs exist, so there is
       * no wrong option to pick rather than a wrong option to warn about —
       * and structureFor() falls back silently, so a wrong pick would have
       * built the default and said nothing.
       *
       * IN A META TAG, like the mode and the target above it and for the
       * same reason: this file is static and cached, the list is
       * per-request.
       *
       * JSON IN AN ATTRIBUTE, so the wizard does not have to parse a
       * delimiter somebody will one day put in a label. esc() handles the
       * quotes; the list is literals from designs.js, never user input. */
      + (designsKey && designsFor(designsKey).length
        ? `\n  <meta name="site-designs" content="${escAttr(JSON.stringify(
            designsFor(designsKey).map(d => ({ id: d.id, label: d.label, note: d.note }))
          ))}">`
        : '');

    // The logout form on this page needs a token too — it is a POST like any
    // other, and without this it is rejected with "Session expired".
    const csrfField = res.locals.csrfField || '';

    // The header, from utils/appHeader.js — the same source the dashboard and
    // the build page use. form.html carries three placeholders instead of the
    // markup, so the header exists in exactly ONE file and updating it cannot
    // leave a page behind.
    //
    // {{HEADER}} is filled BEFORE {{CSRF}}, deliberately: appHeader() already
    // puts the token in the logout form itself, so if the order were reversed
    // the {{CSRF}} pass would run before the header existed and the logout
    // button would silently post without a token.
    res.send(
      formHtml
        .replace('</head>', `  ${meta}\n</head>`)
        .replace(/{{HEADER_ASSETS}}/g, appHeaderAssets() + appSidebarAssets())
        .replace(/{{HEADER_SCRIPTS}}/g, appHeaderScripts())
        .replace(/{{HEADER}}/g, appHeader(csrfField))
        /* THE SIDEBAR MARKS THE ROW YOU CAME IN BY, which is the whole
         * point of giving GitHub a row: on /github-sites it is GitHub
         * Websites that is highlighted, not Websites. The row is passed in
         * rather than worked out from the mode, because /cloudflare-sites/new
         * locks no mode and still belongs to its own row. */
        .replace(/{{SIDEBAR}}/g, appSidebar(row))

        /* AND THE PAGE SAYS WHICH DOOR TOO — 17 November, Edwin.
         *
         * One wizard serves three routes and said so nowhere. All three
         * opened on "1. What are we building?", and the only thing on
         * screen that differed was which sidebar row was lit — which is at
         * the far left, in a column people stop reading once they have
         * clicked in it.
         *
         *     THE LIT ROW IS WHERE YOU CAME FROM. A HEADING IS WHERE YOU
         *     ARE, AND ONLY ONE OF THOSE SURVIVES A BOOKMARK OR A
         *     RELOAD.
         *
         * The blurb carries the part a heading cannot: what happens when
         * it finishes. Those three endings are the actual difference
         * between the doors, and before this nothing said them until the
         * review step — on /github-sites, not even then.
         *
         * ESCAPED? NO, AND DELIBERATELY. Every value here is a literal
         * written below in this file; none of it comes from a request. The
         * day one does, it is escaped at the call site. */
        .replace(/{{WIZARD_TITLE}}/g, heading
          ? `<h1 class="h3 mb-1">${heading}</h1>`
            + (blurb ? `\n            <p class="text-white-50 mb-4">${blurb}</p>` : '')
          : '')

        .replace(/{{CSRF}}/g, csrfField)
    );

  } catch (err) {
    console.error('Could not render the form page:', err);
    res.status(500).send('Something went wrong. Please try again.');
  }
  };
}

router.get('/', renderWizard({
  row: '/',
  heading: 'Build a website',
  blurb: 'The finished website waits here for you to download it or put it '
    + 'on a domain.',
}));

/* GITHUB WEBSITES — 16 November, on Edwin's instruction.
 *
 * What this mode builds has always been reachable; it was called "Local
 * Website Options" and it was the second of four cards on step 1. Nothing
 * on that card, or in the sidebar, or anywhere on the screen, said GitHub —
 * so the only way to find the host was to already know which caption meant
 * it. Its own manager, /my-sites, was a line in a dropdown under the avatar
 * until the same day.
 *
 *     A WHOLE HOST WAS RECOVERABLE ONLY FROM MEMORY. This file's siblings
 *     have the same note about four other screens; this is the first time
 *     it was true of a product rather than a page.
 */
router.get('/github-sites', renderWizard({
  mode: 'localoptions',
  row: '/github-sites',
  heading: 'Build a GitHub website',
  blurb: 'Eleven pages, published to GitHub Pages on one of your domains as '
    + 'soon as they are written.',
}));

/* CLOUDFLARE WEBSITES, IN ONE ERRAND INSTEAD OF TWO — 16 November.
 *
 * WHAT IT REPLACED. To put a website on a Cloudflare subdomain you built it
 * here, were returned to the build page, then went to /cloudflare-sites and
 * filled a second form which published "whatever was built last". Two
 * screens, and the second one silently depended on the first having been
 * the last thing you did. Build two sites and publish once and you publish
 * the wrong one.
 *
 *     THE SECOND STEP WAS NOT A STEP. It was the first step's output,
 *     re-entered by hand.
 *
 * WHY NOT A SECOND WIZARD. Edwin's own question — "we could duplicate the
 * wizard … right or am i wrong?" The answer is that a duplicate would
 * inherit nothing: every fix would need making twice, and GitHub already
 * showed what one locked door costs when it is the same door. This route
 * is /?target=cloudflare in everything but the URL.
 *
 * WHY NO MODE IS LOCKED. Cloudflare takes any build — Rank Fast, a sample,
 * a lead page. GitHub is a mode because Local Website Options builds
 * different pages; Cloudflare is a destination, so step 1 is untouched and
 * all four cards stay on offer.
 *
 * THE ADDRESS IS ASKED LAST, on the review step, by renderCloudflareFields()
 * — see public/js/generateDinamycForm.js. Nothing about it is a choice about
 * what gets built, so it belongs with the other thing you need right before
 * pressing Generate.
 *
 * THE ROW IS THIS URL — CORRECTED 17 November. It was /cloudflare-sites for
 * a day, on the reasoning that the list and its wizard are one place in the
 * sidebar. They are not: /cloudflare-sites is the LIST, and pointing the
 * BUILD WEBSITES row at it meant the row beside GitHub Websites opened a
 * table while GitHub's opened a wizard. Edwin pressed it expecting the
 * wizard. The list now has its own row under MANAGE, beside GitHub's.
 */
router.get('/cloudflare-sites/new', renderWizard({
  target: 'cloudflare',
  row: '/cloudflare-sites/new',
  heading: 'Build a Cloudflare website',
  blurb: 'Published to a subdomain of one of our domains as soon as it is '
    + 'built. You choose the address on the last step.',
}));

/* CLOUDFLARE LOCAL AUTOMATION — 17 November, named by Edwin.
 *
 * THE FOURTH DOOR, AND THE FIRST THAT IS A PAIR WITH ANOTHER ONE. It runs
 * the same builder as /github-sites — the eleven-page Local Website Options
 * site — and sends it somewhere else. Everything a customer fills in is the
 * same; the ending is not.
 *
 *   /github-sites        eleven pages -> GitHub Pages, Designs 1-3
 *   /local-automation    eleven pages -> Cloudflare,   Designs 4-8
 *
 * BOTH PARAMETERS, WHICH IS WHY THEY WERE EVER TWO. `mode` picks the
 * builder and `target` picks the destination, and this is the first route
 * that sets both. The note on renderWizard above was written when nothing
 * did, and it ends "locking one has nothing to do with locking the other" —
 * which is exactly what makes this route three lines rather than a product.
 *
 * THE LAYOUTS FOLLOW FROM THE PAIR, which is the one thing the shape could
 * not already express. Quarry and the four after it must never appear on
 * /github-sites, and Ledger, Beacon and Anvil must never appear here — but
 * both doors lock the same mode, so the mode alone cannot decide it.
 * designsKeyFor() answers it from the mode AND the destination, and the
 * build asks the same function; see the warning on designsKey above for
 * what happened while only this end knew.
 *
 * THE PATH IS NOT THE LABEL. The sidebar says "Cloudflare Local Automation";
 * the URL is short because people type and share it. */
router.get('/local-automation', renderWizard({
  mode: 'localoptions',
  target: 'cloudflare',
  row: '/local-automation',
  heading: 'Build a Cloudflare Local Automation website',
  blurb: 'Eleven pages, published to a subdomain of one of our domains as '
    + 'soon as they are written. You choose the address on the last step.',
}));

module.exports = router;