// utils/appHeader.js
//
// The logged-in header: business name, credits, profile menu.
//
// WHY THIS EXISTS
//
// The app had THREE different navigation patterns, one per page:
//
//   /            (form.html)   a real <header> with credits and a profile menu
//   /dashboard                 no header; three buttons at the BOTTOM of the page
//   /jobs/:id                  nothing at all — an <h1> and one CTA when done
//
// So a customer had to relearn where the controls were on every screen, and
// the page they sit on longest — the build progress page — was a dead end with
// no way to reach the dashboard, buy credits or log out.
//
// The progress page mattered most: it is the page shown immediately after a
// build charges 500 credits, and it was the one page that never showed the
// balance.
//
// WHY THIS IS A COPY OF form.html's HEADER RATHER THAN ITS SOURCE
//
// The generator form was explicitly out of scope, so form.html keeps its own
// copy of this markup and this module serves /dashboard and /jobs/:id. That is
// duplication, and duplication drifts — an item added to one menu and not the
// other is exactly the kind of thing nobody notices for months.
//
// test-app-header.js reads BOTH this file and form.html and asserts they offer
// the same links and the same actions. It does not compare markup character by
// character, because classes and whitespace are allowed to differ; it compares
// what the header DOES.
//
// When form.html is eventually switched over, delete its <header> block and
// call appHeader() instead. The drift test then has nothing to compare and
// should be replaced with a plain "form.html has no inline header" assertion.
//
// NOTHING HERE IS NEW. Every link, label and id is reproduced from form.html
// unchanged — same profile menu, same three items, same dynamic credits badge.

/**
 * Stylesheets and CSS the header needs, for the <head>.
 *
 * Bootstrap's own CSS is NOT included: both pages that use this already load
 * it, and loading it twice is a wasted request.
 *
 * bootstrap-icons IS included, because neither page loads it and the profile
 * menu is an icon — without this the header renders an invisible control that
 * still opens a menu when clicked.
 *
 * The two rules are lifted from form.html's inline <style>. Without them the
 * header falls back to Bootstrap's `bg-dark`, which is nearly black, while the
 * generator's header is the navy the rest of the app uses. Same markup, two
 * different-looking headers, which would defeat the point.
 */
function appHeaderAssets() {
  return `
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.1/font/bootstrap-icons.css">
  <style>
    /* All three rules moved here from form.html's inline <style>.
       The bare "header" element rule was the easy one to miss: it gives the
       header its border and drop shadow, and while it lived only in form.html
       the generator's header had them and the other two did not. */
    header {
      border-bottom: 2px #171717 solid;
      box-shadow: 1px 8px 5px #171717;
    }
    .header-background { background: #082d5b !important; }
    .padding-right-header { padding-right: 50px !important; }
  </style>`;
}

/**
 * Scripts the header needs, for just before </body>.
 *
 *   bootstrap.bundle  the profile dropdown does not open without it
 *   currentUserInfo   fills #user-info and #user-actions from /api/me
 *
 * currentUserInfo.js is what makes the credits badge, the Buy Credits button
 * and the Admin menu appear. It is the SAME script the generator uses, so the
 * header shows exactly the same things in exactly the same states — including
 * the admin-only menu, which appears for admins here as it does there.
 *
 * It returns silently when #user-info or #user-actions are missing, so it is
 * safe on any page that includes it without the header.
 */
function appHeaderScripts() {
  return `
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
  <script src="/js/currentUserInfo.js" defer></script>`;
}

/**
 * The header itself.
 *
 * @param {string} [csrfField]  the hidden CSRF input, as res.locals.csrfField.
 *        The logout form POSTs, so without it the POST is rejected and Logout
 *        silently does nothing. Defaults to '' rather than throwing, matching
 *        how the dashboard already writes `${res.locals.csrfField || ''}`.
 */
function appHeader(csrfField = '') {
  // NOT the default parameter alone. `= ''` fires only for undefined, so
  // appHeader(null) interpolated the literal string "null" into the logout
  // form. Both call sites write `res.locals.csrfField || ''` and never pass
  // null today, but a third one will, and a stray "null" in a form is the kind
  // of thing that ships.
  const token = csrfField == null ? '' : String(csrfField);

  return `
  <header class="d-flex justify-content-between align-items-center p-3 bg-dark text-white header-background padding-right-header">
    <div class="d-flex align-items-center">
      <!-- The wordmark is a LINK, and links to "/" — which is the generator.
           The name in the top-left going home is the one navigation
           convention every visitor already knows, and before this it was
           inert <strong> text that did nothing when clicked.

           It also closed a real gap: from the build progress page, starting a
           second site was finish -> dashboard -> Go to Generator. Three clicks
           for the action you most want someone to take right after one
           succeeds. Nothing was added to the header to fix it.

           A HEADER-ONLY CROP OF THE LOGO, not the full lockup.

           three-comets-logo.png is 452x162 and includes the
           "BUILD - OPTIMIZE - RANK FAST" strapline as a separate strip below
           the name (the artwork has two clean bands: y=4-122 is the comets
           and the name, y=131-149 is the strapline).

           In a header that strapline is texture — nobody reads a positioning
           line in app chrome — but it was eating a third of the height. So
           the header uses a crop to 452x127 with the strapline removed,
           and the NAME gets that height instead:

               full logo   @ 50px tall  ->  name renders 37px
               cropped     @ 50px tall  ->  name renders 47px

           Same 82px header, a 27% bigger name. It also beats growing the full
           logo to 63px, which gave a 46px name and a 95px header.

           This is the ordinary brand practice: a full lockup for the site and
           the deck, a compact version for UI. The full file stays in
           public/img for everything else.

           width and height are explicit so the header does not jump while the
           image loads. They must match the FILE, which is 452x127 here. -->
      <a href="/" class="d-inline-flex align-items-center text-decoration-none">
        <img src="/img/three-comets-logo-header.png"
             alt="Three Comets"
             width="178" height="50">
      </a>

      <!-- THE PRIMARY ACTION, named in the customer's words.
           "Build a Website", not "Generator" — generator is our internal name
           for the tool; a customer is thinking about the outcome. It also
           matches the logo's own strapline, BUILD - OPTIMIZE - RANK FAST, so
           the brand's verb and the app's main action are the same word.

           A BUTTON. It shipped as a plain text link for about an hour, on the
           reasoning that a second button would compete with the yellow Buy
           Credits one. That was the wrong thing to optimise: Edwin looked at
           it and said it read as a phrase rather than something clickable, and
           an affordance nobody recognises is worth nothing however tidy the
           hierarchy. Discoverability first.

           ON THE LEFT, beside the logo, because it is navigation as much as
           an action — this is where people look for "take me to the thing".

           "Build a Website", NOT "Website Builder". A button takes a VERB: it
           says what happens when you press it. "Website Builder" is a noun
           that names a tool, so on a button it reads as a label. It is also
           the category name — Wix and Squarespace are website builders — so
           it describes the software rather than what the customer gets.

           The logo links here too, by convention. This is the visible version
           of the same destination. -->
      <a href="/" class="btn btn-primary ms-4">Build a Website</a>
    </div>

    <div class="d-flex align-items-center gap-3">

      <!-- Actions area (Buy credits + Admin menu) -->
      <div id="user-actions"></div>

      <!-- Profile Icon + Dropdown -->
      <div class="dropdown">
        <i class="bi bi-person-circle fs-4 dropdown-toggle"
           role="button"
           id="profileMenuButton"
           data-bs-toggle="dropdown"
           aria-expanded="false"
           style="cursor: pointer;">
        </i>

        <ul class="dropdown-menu dropdown-menu-end dropdown-menu-dark" aria-labelledby="profileMenuButton">

          <!-- WHO AM I SIGNED IN AS. Moved here from the left of the header
               on 21 September.

               It is identity, not navigation, and it was sitting in the slot
               where navigation belongs — which is why there was no room for
               "Build a Website". Behind the profile icon is where every app
               puts the account address and where people look for it.

               It was also the widest thing in the header, so the header no
               longer overflows on a narrow screen.

               KEEP id="user-info". public/js/currentUserInfo.js fills it from
               /api/me and does not care where it sits, so moving the element
               needed no JavaScript change at all. Renaming the id would
               silently empty it — the script returns early when the id is
               missing, with no error anywhere. -->
          <li>
            <span id="user-info" class="dropdown-item-text small text-white-50"></span>
          </li>
          <li><hr class="dropdown-divider"></li>

          <li><a class="dropdown-item" href="/dashboard">My Dashboard</a></li>
          <li><a class="dropdown-item" href="/buy-credits">Buy Credits</a></li>
          <li><hr class="dropdown-divider"></li>
          <li>
            <form action="/logout" method="POST" class="px-3">
              ${token}
              <button class="btn btn-danger btn-sm w-100">Logout</button>
            </form>
          </li>
        </ul>
      </div>

    </div>
  </header>`;
}

/**
 * Fill {{HEADER_ASSETS}}, {{HEADER}} and {{HEADER_SCRIPTS}} in a page's HTML.
 *
 * WHY THIS EXISTS RATHER THAN CALLING THE THREE FUNCTIONS AT EACH PAGE
 *
 * billingRoute, blogSitesRoute and exportWpThemeRoute each build their pages
 * through a `page({ title, body })` helper and then `send(res, spec)`. Between
 * them that is TWENTY call sites — but `page()` never receives `res`, so the
 * CSRF token the logout form needs is not in scope there.
 *
 * `send()` is: it already takes `res`. So `page()` writes the placeholders and
 * `send()` fills them, which is one line changed per route file instead of
 * twenty, and the token comes from the one place that has it.
 *
 * Same placeholder names as src/views/form.html, on purpose — one pattern for
 * "this page has the app header", whether the page is a file or a template
 * literal.
 *
 * NOTE: no {{CSRF}} hazard here. These files interpolate
 * `${res.locals.csrfField}` directly into their own forms rather than using a
 * placeholder, so there is no second substitution pass to order this against.
 *
 * @param {string} html  a page containing the placeholders
 * @param {object} res   Express response, for res.locals.csrfField
 */
function withAppHeader(html, res) {
  const token = (res && res.locals && res.locals.csrfField) || '';

  return String(html == null ? '' : html)
    .replace(/{{HEADER_ASSETS}}/g, appHeaderAssets())
    .replace(/{{HEADER_SCRIPTS}}/g, appHeaderScripts())
    .replace(/{{HEADER}}/g, appHeader(token));
}

module.exports = { appHeader, appHeaderAssets, appHeaderScripts, withAppHeader };
