// public/js/sidebarBusy.js
//
// The sidebar row you clicked looks clicked, until the next page arrives.
//
//
// WHY THIS EXISTS — 17 November, Edwin
//
//   *"I noticed we are not using ajax, right? For instance when I press
//   Website and then go to Cloudflare websites the page refreshes and there
//   is nothing telling the user that request has been sent."*
//
// Correct, and the conclusion is not ajax. Every screen here is a full page
// load, and the browser does report it — in the tab, at the very top of a
// window nobody is looking at while their eyes are on the row they just
// clicked. Inside the app nothing changes at all, so a slow response is
// indistinguishable from a click that missed.
//
//     THE PROBLEM IS NOT THE NAVIGATION. IT IS THAT THE PAGE SAYS NOTHING
//     WHILE IT HAPPENS.
//
// Ajax navigation would mean every screen rendering as a fragment, a client
// router, and a second way for every page to be wrong — to buy exactly this
// feedback. This buys it for a dozen lines.
//
//
// THE LIFETIME IS THE WHOLE TRICK
//
// Nothing clears the busy state, and nothing should: the document is
// replaced when the new page arrives, which takes the spinner with it. A
// timeout would be a guess about how long a page takes, and clearing it
// early is worse than never showing it — it would say "finished" over a
// page that has not moved.
//
// THE ONE CASE THAT NEEDS CLEARING IS THE BACK BUTTON. Browsers restore a
// page from the back/forward cache exactly as it was, frozen mid-navigation
// — the same snapshot behaviour routes/jobRoute.js disables caching for.
// So a row left spinning would still be spinning when somebody came back to
// the page. `pageshow` with `persisted` is what fires then, and it is the
// only reset here.
//
//
// WHAT IS NOT MARKED
//
//   - The row that is already the current page. Clicking it reloads, and a
//     spinner on the row you are already on reads as "something is wrong
//     with this page" rather than "going there".
//   - Anything but a left click with no modifier. Cmd-click and middle-click
//     open a new tab and leave THIS page exactly where it is, so marking the
//     row would leave it spinning for ever on a page that never navigates.
//   - Links to another origin or with a download attribute, for the same
//     reason: this page stays.
//
// NO INLINE HANDLERS. The CSP blocks them and test-inline-handlers.js
// enforces it, which is why this is a file rather than an onclick.

(function () {
  'use strict';

  var OVERLAY_ID = 'app-nav-overlay';

  /**
   * A spinner over the whole screen while the next page is on its way.
   *
   * ASKED FOR 17 November, Edwin, on top of the busy row. The row answers
   * "did my click register"; this answers "the app is doing something and
   * it is not ready for you yet", which on a slow load is the part the row
   * alone does not carry — a single dimmed line in a column is easy to miss
   * when you are looking at the content area.
   *
   * NO DELAY, ON PURPOSE. The obvious refinement is to arm it and show it
   * only after ~300ms, so a page that arrives quickly never flashes one up.
   * Edwin's call, in his words: *"don't worry about the flashing that looks
   * like glitch"* — so it appears on the click, every time. The delay is
   * four lines whenever that stops being the preference.
   *
   * NO TEXT. A plain navigation has nothing to report: no step, no
   * percentage, nothing but "wait". The wizard's own overlay says
   * "Generating your website" because there IS something happening that
   * takes a name; this would only be able to say "Loading", which is what a
   * spinner already means.
   *
   * BUILT, NOT WRITTEN AS innerHTML with a value in it — there is no value
   * here to escape, and this keeps it that way by construction.
   */
  function showOverlay() {
    if (document.getElementById(OVERLAY_ID)) return;

    var overlay = document.createElement('div');
    overlay.id = OVERLAY_ID;
    overlay.className = 'app-nav-overlay';

    /* ROLE status, NOT alert. Alert interrupts; this is a progress report
     * nobody asked to be told about. aria-live is deliberately absent for
     * the same reason: there is no message to read out. */
    overlay.setAttribute('role', 'status');
    overlay.setAttribute('aria-label', 'Loading');

    var spinner = document.createElement('div');
    spinner.className = 'app-nav-overlay__spinner';
    overlay.appendChild(spinner);

    document.body.appendChild(overlay);
  }

  function hideOverlay() {
    var overlay = document.getElementById(OVERLAY_ID);
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  /** The row's icon becomes a spinner; the row stops responding to hover. */
  function markBusy(link) {
    if (link.classList.contains('app-sidebar-link-busy')) return;

    link.classList.add('app-sidebar-link-busy');

    /* aria-busy, because the spinner is decoration. A screen reader is told
     * the row is working; it is not told about a glyph. */
    link.setAttribute('aria-busy', 'true');
  }

  function clearBusy() {
    const busy = document.querySelectorAll('.app-sidebar-link-busy');

    for (let i = 0; i < busy.length; i += 1) {
      busy[i].classList.remove('app-sidebar-link-busy');
      busy[i].removeAttribute('aria-busy');
    }
  }

  /** Will this click actually replace the page we are looking at? */
  function navigatesHere(event, link) {
    // Anything but a plain left click: a new tab, or the browser's menu.
    if (event.defaultPrevented) return false;
    if (event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;

    if (link.target && link.target !== '_self') return false;
    if (link.hasAttribute('download')) return false;

    // Same site only. `link.href` is resolved by the browser, so this
    // compares origins rather than the spelling of the attribute.
    if (link.origin && link.origin !== window.location.origin) return false;

    // The page we are already on. A reload is not a journey.
    if (link.classList.contains('app-sidebar-link-active')) return false;

    return true;
  }

  function onClick(event) {
    const link = event.target.closest ? event.target.closest('.app-sidebar-link') : null;
    if (!link) return;

    if (!navigatesHere(event, link)) return;

    markBusy(link);
    showOverlay();
  }

  /* DELEGATED FROM THE DOCUMENT, so it works whether this file runs before
   * or after the sidebar is in the DOM, and keeps working if a row is ever
   * added to it later. */
  document.addEventListener('click', onClick);

  /* Restored from the back/forward cache, frozen as it was. See above. */
  window.addEventListener('pageshow', function (event) {
    if (!event.persisted) return;

    clearBusy();

    /* AND THE CURTAIN, which matters more than the row: a restored page
     * frozen behind a full-screen overlay is a page nobody can use. */
    hideOverlay();
  });
}());
