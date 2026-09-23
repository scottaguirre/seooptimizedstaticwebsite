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
      <!-- THE BUILD BUTTON MOVED TO THE SIDEBAR on 23 September. It was here,
           blue and beside the logo, until the tools column existed — and then
           "Build a Website" appeared twice on the same screen, which Edwin
           spotted immediately. One action, one place.

           It kept its colour. appSidebar() renders it as the same solid blue
           button, because the reasoning behind that colour did not change:
           building a website is the end, buying credits is the means, and the
           hierarchy has to say so.

           THE COST, recorded rather than hidden: pages WITHOUT a sidebar —
           /dashboard, /buy-credits, /blog-sites, /admin — now reach the
           wizard only through the logo, and "the wordmark links home" is a
           real convention but an invisible one. The fix is to give those
           pages the sidebar too, not to put the button back. -->
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
/**
 * The tools a signed-in customer can reach, as a left-hand column.
 *
 * WHY THIS LIVES HERE, BESIDE THE HEADER
 *
 * For the reason the header does: the moment a nav exists in two files, one
 * of them falls behind. A tool added to the sidebar has to appear on every
 * page that has a sidebar, and the only way to guarantee that is for there to
 * be one sidebar.
 *
 * WHY A SIDEBAR AT ALL
 *
 * Blog Automation spent weeks with no entry point anywhere in the app — it
 * was reachable only by typing /blog-sites, which means for every customer
 * who had not been told about it, the feature did not exist. The dashboard
 * card fixed that one. This fixes the general case: a tool that is not linked
 * from somewhere a customer looks is a tool nobody uses.
 *
 * It sits in the empty column beside the wizard card, which was dead space.
 * On a phone it drops above the content rather than squeezing it.
 *
 * @param {string} current  the path of the page being rendered, so its own
 *   entry is marked rather than offered as somewhere to go.
 */
function appSidebar(current = '') {
  const here = String(current || '').split('?')[0].replace(/\/+$/, '') || '/';

  const tools = [
    // `cta` marks the primary action, which wears the solid blue the header
    // used to. It is the END the other tools are means to.
    { href: '/', icon: 'bi-magic', label: 'Build a Website', cta: true },
    { href: '/keyword-research', icon: 'bi-search', label: 'Keyword Research' },
    { href: '/blog-sites', icon: 'bi-journal-text', label: 'Blog Automation' },
    { href: '/dashboard', icon: 'bi-speedometer2', label: 'Dashboard' },
  ];

  const items = tools.map(({ href, icon, label, cta }) => {
    const active = here === href.replace(/\/+$/, '') || (href === '/' && here === '/');

    const classes = ['app-sidebar-link'];
    if (cta) classes.push('app-sidebar-cta');
    if (active) classes.push('app-sidebar-link-active');

    return `
      <a href="${href}"
         class="${classes.join(' ')}"
         ${active ? 'aria-current="page"' : ''}>
        <i class="bi ${icon}" aria-hidden="true"></i>
        <span>${label}</span>
      </a>`;
  }).join('');

  // Wrapped in a SHELL that the stylesheet positions. Every page includes the
  // sidebar the same way — immediately after the header, outside its own
  // content container — so the column lands in the same place whatever that
  // page's layout is. Putting it inside each page's grid is what made the
  // wizard's tools sit 250px right of the research page's.
  return `
    <div class="app-sidebar-shell">
      <nav class="app-sidebar" aria-label="Tools">
        <div class="app-sidebar-title">Tools</div>
        ${items}
      </nav>
    </div>`;
}

/**
 * The sidebar's styles, for pages that include one.
 *
 * Separate from appHeaderAssets so a page without a sidebar does not carry
 * rules for one. Appended by the page's own route.
 */
function appSidebarAssets() {
  return `
  <style>
    /* The column's width, named once. It is needed in three places now — the
       body's padding, the column itself, and the negative margin that lets
       the header escape that padding — and three copies of 232px is three
       chances to change two of them. */
    :root { --app-sidebar-width: 232px; }

    .app-sidebar {
      display: flex;
      flex-direction: column;
      gap: .25rem;
      /* Roomier at the top, so the list starts clear of the header instead of
         crowding up under its shadow. */
      padding: 1.75rem .75rem 1rem;
    }

    .app-sidebar-title {
      color: rgba(255,255,255,.55);
      font-size: .75rem;
      letter-spacing: .08em;
      text-transform: uppercase;
      padding: 0 .75rem .5rem;
    }

    .app-sidebar-link {
      display: flex;
      align-items: center;
      gap: .6rem;
      padding: .6rem .75rem;
      border-radius: .5rem;
      color: rgba(255,255,255,.8);
      text-decoration: none;
      font-size: 1rem;
      line-height: 1.2;
    }

    .app-sidebar-link:hover {
      background: rgba(255,255,255,.08);
      color: #fff;
    }

    /* The page you are already on is marked, not offered. */
    .app-sidebar-link-active {
      background: rgba(255,255,255,.14);
      color: #fff;
      font-weight: 600;
    }

    .app-sidebar-link i { font-size: 1.05rem; opacity: .85; }

    /* THE PRIMARY ACTION, in the blue it wore in the header. Bootstrap's own
       --bs-primary, so it stays in step with the rest of the app rather than
       being a hard-coded hex that drifts. */
    .app-sidebar-cta {
      background: var(--bs-primary, #0d6efd);
      color: #fff;
      font-weight: 600;
      margin-bottom: .5rem;
    }

    .app-sidebar-cta:hover {
      background: var(--bs-primary, #0b5ed7);
      filter: brightness(1.08);
      color: #fff;
    }

    .app-sidebar-cta i { opacity: 1; }

    /* Being the current page must not make the button look disabled or grey,
       which the plain active rule would do by overriding its background. */
    .app-sidebar-cta.app-sidebar-link-active {
      background: var(--bs-primary, #0d6efd);
      box-shadow: inset 0 0 0 2px rgba(255,255,255,.55);
    }

    /* FIXED, and the two earlier attempts are worth recording because both
       looked right in the file and wrong on screen.

       ABSOLUTE WITH NO TOP OFFSET was the first. It keeps the element at its
       STATIC position — wherever the {{SIDEBAR}} placeholder happens to sit
       in that page's markup, after whatever precedes it. So the column began
       near the top of step 2 of the wizard and most of the way down step 1,
       and the divider was a floating segment in the middle of the page rather
       than a line down the side of it.

       ADDING bottom:0 AND A POSITIONED BODY fixed the length and not the
       start: the top still came from the markup, so the line ran from an
       arbitrary point to the end of the page.

       Fixed has neither problem — it ignores where the element sits in the
       document — and it is also what the column should do anyway: the tools
       stay put while the page scrolls.

       Its one cost is needing the header's height for the top offset, which
       the comment here previously called a number that goes stale. It is,
       so it is not hard-coded: the script below measures the header and
       writes --app-header-height, and the value in the CSS is only the
       fallback for the moment before that runs.

       Below 992px it stacks above the content in normal flow, because a
       column that narrow is worse than no column. */
    @media (min-width: 992px) {
      body:has(.app-sidebar-shell) {
        padding-left: var(--app-sidebar-width);
      }

      /* THE HEADER SPANS THE PAGE, the column does not push it.

         body's padding-left is what holds the content clear of the column,
         and the header is inside that body, so it was being indented by the
         same 232px — leaving a bite out of the top-left corner where the
         column met it. Pulling it back by the padding and widening it by the
         same amount puts it back across the full width. */
      body:has(.app-sidebar-shell) > header {
        margin-left: calc(var(--app-sidebar-width) * -1);
        width: calc(100% + var(--app-sidebar-width));
      }

      .app-sidebar-shell {
        position: fixed;
        left: 0;

        /* From the bottom edge of the header to the bottom of the window.
           The fallback is the header's height today — 1rem padding, a 50px
           logo, 1rem padding, a 2px border — and it is only ever on screen
           for the instant before the script measures the real one. */
        top: var(--app-header-height, 84px);
        bottom: 0;

        width: var(--app-sidebar-width);
        border-right: 1px solid rgba(255,255,255,.1);

        /* A tools list longer than the window scrolls inside its own column
           rather than being cut off by the fixed height above. */
        overflow-y: auto;
      }
    }
  </style>
  <script>
    /* The header's real height, measured rather than assumed.

       Everything about the header is fluid — the logo swaps, the padding is
       Bootstrap's, a second row could appear at a narrow width — so any
       number written into the CSS is right until somebody edits the header
       and then silently wrong. This reads it and keeps reading it.

       Defensive throughout: the script is in the HEAD, so the header does not
       exist yet on first run, and it ships on pages that may have no header
       at all. Every path returns quietly rather than throwing into a page
       whose only fault is not having a sidebar. */
    (function () {
      function measure() {
        var header = document.querySelector('header');
        if (!header) return;

        var height = Math.round(header.getBoundingClientRect().height);
        if (!height) return;

        document.documentElement.style.setProperty(
          '--app-header-height', height + 'px');
      }

      function watch() {
        measure();

        var header = document.querySelector('header');
        if (!header) return;

        // The header grows when the credits badge loads, and again if the
        // window narrows enough to wrap it. A one-off measurement would be
        // taken before either.
        if (typeof ResizeObserver === 'function') {
          new ResizeObserver(measure).observe(header);
        } else {
          window.addEventListener('resize', measure);
        }
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', watch);
      } else {
        watch();
      }
    })();
  </script>`;
}

function withAppHeader(html, res) {
  const token = (res && res.locals && res.locals.csrfField) || '';

  // The path being rendered, so the sidebar can mark its own entry. Express
  // hangs the request off the response; a page rendered without one simply
  // marks nothing, which is the right failure.
  const here = (res && res.req && res.req.path) || '';

  return String(html == null ? '' : html)
    .replace(/{{HEADER_ASSETS}}/g, appHeaderAssets() + appSidebarAssets())
    .replace(/{{HEADER_SCRIPTS}}/g, appHeaderScripts())
    .replace(/{{HEADER}}/g, appHeader(token))
    .replace(/{{SIDEBAR}}/g, appSidebar(here));
}

module.exports = {
  appHeader,
  appHeaderAssets,
  appHeaderScripts,
  appSidebar,
  appSidebarAssets,
  withAppHeader,
};
