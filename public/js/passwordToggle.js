// public/js/passwordToggle.js
//
// A show/hide button on every password field, built here rather than written
// into the markup.
//
// WHY THE SCRIPT BUILDS THE BUTTON INSTEAD OF THE PAGES CARRYING IT
//
// There are six password fields across four pages: log in, sign up, and the
// two spellings of the reset form — each of which has "New password" and
// "Confirm new password". Hand-written markup would mean the same input-group
// six times, and the seventh field somebody adds next year silently not
// having one.
//
// This finds them instead. A page gets the behaviour by loading the script,
// and a new password field gets it by existing.
//
// WHAT HAPPENS WITH NO JAVASCRIPT
//
// Nothing, and that is the point. The field stays an ordinary password field
// and the form submits exactly as it did before — the button is the only
// thing that does not appear. Nobody is locked out of their account because a
// script failed to load.
//
// THE BUG THIS WAS WRITTEN TO AVOID
//
// A <button> inside a <form> with no type attribute defaults to SUBMIT. The
// eye would have posted the login form on the first click, before the
// password was finished. Every button made here is type="button", and a test
// asserts it.

(function () {
  'use strict';

  /* The two states, as one object each, because the label, the title and the
   * icon have to agree and three separate ternaries is how they stop
   * agreeing. */
  var STATES = {
    hidden: {
      type: 'password',
      pressed: 'false',
      label: 'Show password',
      // An eye. Drawn here rather than loaded: these pages pull in Bootstrap's
      // CSS and nothing else, and one icon is not worth a second request on
      // the page somebody is trying to log in from.
      icon: '<path d="M8 3C4.5 3 1.7 5.1.6 7.6a1 1 0 0 0 0 .8C1.7 10.9 4.5 13 8 13s6.3-2.1 7.4-4.6a1 1 0 0 0 0-.8C14.3 5.1 11.5 3 8 3z"/>'
          + '<circle cx="8" cy="8" r="2.5" fill="#082d5b"/>',
    },
    shown: {
      type: 'text',
      pressed: 'true',
      label: 'Hide password',
      // The same eye with a stroke through it.
      icon: '<path d="M8 3C4.5 3 1.7 5.1.6 7.6a1 1 0 0 0 0 .8C1.7 10.9 4.5 13 8 13s6.3-2.1 7.4-4.6a1 1 0 0 0 0-.8C14.3 5.1 11.5 3 8 3z"/>'
          + '<circle cx="8" cy="8" r="2.5" fill="#082d5b"/>'
          + '<path d="M2.1 13.2 13.2 2.1l.9.9L3 14.1z" fill="#082d5b"/>'
          + '<path d="M2.6 12.7 12.7 2.6l.4.4L3 13.1z"/>',
    },
  };

  function svg(state) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" '
      + 'viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" '
      + 'focusable="false">' + state.icon + '</svg>';
  }

  function apply(input, button, state) {
    input.setAttribute('type', state.type);
    button.setAttribute('aria-pressed', state.pressed);
    // Both, and they are not the same thing: the label is what a screen
    // reader announces, the title is what a mouse user sees on hover.
    button.setAttribute('aria-label', state.label);
    button.setAttribute('title', state.label);
    button.innerHTML = svg(state);
  }

  function attach(input) {
    // Already wrapped. Guards against the script being included twice, which
    // is easy to do when three different pages add the tag separately.
    if (input.getAttribute('data-toggle-wrapped') === 'yes') return;
    if (!input.parentNode) return;

    input.setAttribute('data-toggle-wrapped', 'yes');

    var group = document.createElement('div');
    group.className = 'input-group';

    var button = document.createElement('button');
    // NOT optional. See the header: the default is submit.
    button.type = 'button';
    button.className = 'btn btn-outline-light';

    // Bootstrap's input-group corners: the field keeps its left radius, the
    // button takes the right one, and neither looks bolted on.
    input.parentNode.insertBefore(group, input);
    group.appendChild(input);
    group.appendChild(button);

    apply(input, button, STATES.hidden);

    button.addEventListener('click', function () {
      var showing = input.getAttribute('type') === 'text';

      apply(input, button, showing ? STATES.hidden : STATES.shown);

      /* THE CARET GOES BACK WHERE IT WAS.
       *
       * Changing an input's type moves the caret to the end in every browser
       * that allows it at all. Somebody who has typed eight characters,
       * noticed a typo in the third, and pressed the eye should not then find
       * the caret at the end. Read before the type changes, restored after.
       *
       * Wrapped because selectionStart throws on some input types in Safari,
       * and a thrown error here would leave the field mid-toggle. */
      try {
        var at = input.selectionStart;
        input.focus();
        if (at !== null && at !== undefined) input.setSelectionRange(at, at);
      } catch (err) {
        input.focus();
      }
    });
  }

  function wire() {
    var fields = document.querySelectorAll('input[type="password"]');
    for (var i = 0; i < fields.length; i++) attach(fields[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    // The script is loaded with defer, so this is the usual path.
    wire();
  }
})();
