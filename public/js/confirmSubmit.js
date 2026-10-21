// public/js/confirmSubmit.js
//
// "Are you sure?" before a form that cannot be undone.
//
// THE BUG THIS REPLACES, 19 October. These prompts were written as
// onsubmit="return confirm('...')" attributes, and the app's
// Content-Security-Policy sets script-src-attr to 'none' — so the browser
// refused to run every one of them. Delete user deleted. Revoke licence
// revoked. No prompt was ever shown, on any of them, ever.
//
// A FILE RATHER THAN AN INLINE BLOCK. The policy allows inline blocks, so
// one would work — but these prompts belong to three pages built by two
// routes that do not share a layout, and the version of this that lives in
// three template literals is the version where one of them quietly loses
// its binding again. A file is served under 'self', cached, and reads the
// same on every page that includes it.
//
// MARKUP IS THE INTERFACE: put the question on the form.
//
//   <form method="POST" action="..." data-confirm="Delete this user?">
//
// Nothing else is needed, and a form without the attribute is untouched.
//
// WHY IT IS SHAPED FOR A TEST RATHER THAN WRITTEN STRAIGHT DOWN. What this
// file guards is the three most destructive buttons in the app, and the
// thing it replaces failed by being plausible on the page and absent in the
// browser. "I clicked it once and a box appeared" is the standard that just
// cost us those three prompts. So the binder takes its document and its
// ask() as arguments, runs itself only where there IS a document, and is
// exported where there is a module — see test-inline-handlers.js, which
// drives it against a fake form and checks what actually happened.

(function (root) {
  'use strict';

  /**
   * Bind every form that carries a question.
   *
   * @param {Document} doc
   * @param {function(string): boolean} ask   window.confirm, or a test's own
   */
  function bindConfirmations(doc, ask) {
    var forms = doc.querySelectorAll('form[data-confirm]');

    for (var i = 0; i < forms.length; i++) {
      /* ON THE FORM'S submit EVENT, NOT THE BUTTON'S click. A form can be
       * submitted by pressing Enter in a field, and a guard bound to the
       * button is simply not there when that happens — which is the
       * quietest way for an "are you sure" to be missing exactly when it
       * is needed. */
      forms[i].addEventListener('submit', function (event) {
        var question = this.getAttribute('data-confirm');

        /* AN EMPTY ATTRIBUTE ASKS NOTHING AND BLOCKS NOTHING. A form
         * carrying data-confirm="" is a mistake in a template, and the safe
         * reading of a missing question is to let the submission through
         * rather than to show a dialog with no words in it. */
        if (!question) return;

        if (!ask(question)) {
          event.preventDefault();

          /* AND STOPS THE BUSY-SPINNER HANDLER TOO. staticBlogsRoute binds
           * its own submit listener that disables every button on the form.
           * If that still runs after a cancelled confirm, the page is left
           * with its controls greyed out and nothing in flight to turn them
           * back on. */
          event.stopPropagation();
        }
      });
    }
  }

  /* ONLY WHERE THERE IS A PAGE. Required into a test there is no document,
   * and reaching for one would throw before a single assertion ran. */
  if (root && root.document) {
    var start = function () {
      bindConfirmations(root.document, function (question) {
        return root.confirm(question);
      });
    };

    /* THE SAME GUARD THE PAGE'S OWN SCRIPTS USE. This file is loaded with
     * `defer`, so the document is parsed by the time it runs — but `defer`
     * is one attribute on one tag in two different routes, and this costs
     * three lines to not depend on it. */
    if ('loading' === root.document.readyState) {
      root.document.addEventListener('DOMContentLoaded', start);
    } else {
      start();
    }
  }

  if ('undefined' !== typeof module && module.exports) {
    module.exports = { bindConfirmations };
  }
})(typeof window !== 'undefined' ? window : null);
