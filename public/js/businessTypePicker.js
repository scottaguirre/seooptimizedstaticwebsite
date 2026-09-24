// public/js/businessTypePicker.js
//
// Step 1 of the wizard: choose a business type, from a list that is going to
// keep growing.
//
// WHY THIS REPLACED A <select>
//
// It was a plain dropdown of 23 options. Edwin is adding categories and asked
// the obvious question: at sixty types, how does somebody find theirs?
//
// A search box over a <select> is not possible in any way that can be relied
// on. Hiding <option> elements works in some browsers and is quietly ignored
// in others, and "quietly ignored" on the first step of the wizard means the
// customer sees a list that did not narrow and concludes the box is broken.
// So the control is a text input and a list, which is a thing every browser
// agrees about.
//
// THE LIST IS ALWAYS VISIBLE. IT DOES NOT DROP DOWN.
//
// A dropdown needs open/close state, and its classic bug is that clicking an
// option fires blur first, the list closes, and the click lands on nothing.
// Avoiding that means mousedown handlers and focus juggling, all to hide a
// list on a wizard step whose entire job is showing that list. So it stays
// open, scrolls inside a fixed height, and there is no state to get wrong.
//
// THE NUMBERS ARE POSITIONS, AND TYPING ONE JUMPS TO IT
//
// Edwin's reason: "if I know that plumbing is #20 it's easier to remember."
// So typing 20 filters to #20 — the number is a way in, not decoration.
//
// What that costs: they are POSITIONS, not identities. Insert a type in the
// middle of the list and everything after it shifts by one, and a number
// somebody memorised now points at their neighbour. Adding to the END is
// free. This was a deliberate trade — Edwin's words were "it's not a big
// deal" — and an ID that never moves would mean carrying one in the registry
// for the sake of a mnemonic.
//
// THE VALUE CAN ONLY EVER BE A REAL TYPE
//
// The <select> guaranteed that; a text input does not. So the typed text is
// only ever a FILTER. The chosen value lives in its own variable and is set
// from an option, never from what was typed — otherwise "plumbin" reaches
// the server, matches no registry entry, and the customer gets a generic
// site with none of their trade's pages on it.

(function (global) {
  'use strict';

  /** Rows shown before the list scrolls. See the stylesheet. */
  function norm(text) {
    return String(text == null ? '' : text).toLowerCase().trim();
  }

  /**
   * Build the picker.
   *
   * @param {object} opts
   * @param {string[]} opts.labels     every type, in order. Position is the number.
   * @param {string} [opts.value]      the type already chosen, from a draft
   * @param {string} [opts.id]         id prefix, so two pickers never collide
   * @param {function} [opts.onSelect] called with the label when one is picked
   * @param {Document} [opts.document] injected for tests
   *
   * @returns {{el, value, focus, markInvalid, clearInvalid, options}}
   */
  function createBusinessTypePicker(opts) {
    const options = opts || {};
    const doc = options.document || global.document;
    const idBase = options.id || 'businessType';

    /* ALPHABETICAL, AND SORTED HERE RATHER THAN IN THE REGISTRY.
     *
     * utils/businessShape.js keeps its types grouped under section comments —
     * Home services, Medical, Professional services, Project based — which is
     * what makes that file editable by a human. Sorting the source would
     * scatter those groups to put Air Conditioning next to Appliance Repair,
     * trading a file somebody maintains for a list nobody reads in source
     * order anyway. Order on screen is a screen concern.
     *
     * localeCompare, not <, so that a type with an accent in it lands where a
     * reader expects rather than after Z.
     *
     * WHAT THIS COSTS THE NUMBERS. They were positions in the registry's own
     * order, where a new type appended to the end shifted nothing. Now they
     * are positions in the alphabet, so adding "Carpet Cleaning" moves
     * everything from C onwards by one. In exchange the list is predictable
     * without being memorised at all, which is the better deal for a customer
     * seeing it once. */
    const labels = (Array.isArray(options.labels) ? options.labels.slice() : [])
      .sort((a, b) => String(a).localeCompare(String(b)));

    /** Is this a type the registry actually has? */
    function isKnown(label) {
      return labels.indexOf(label) >= 0;
    }

    /* The chosen type. NOT read from the input — see the header.
     *
     * A DRAFT IS NOT TO BE TRUSTED. Types get removed; a draft saved before
     * that still names one, and putting it back would hand the rest of the
     * wizard a type nothing downstream recognises. */
    let chosen = isKnown(options.value) ? options.value : '';
    let active = -1;
    let shown = [];

    const root = doc.createElement('div');
    root.className = 'bt-picker';

    const input = doc.createElement('input');
    // TYPE TEXT, NOT SEARCH, and that is about looks rather than behaviour:
    // form.html styles `input[type=text]` with the page's own field colour,
    // and a search input would arrive white against everything around it.
    input.type = 'text';
    input.className = 'form-control';
    input.id = idBase;
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', idBase + '-list');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('placeholder', 'Search business types, or type a number');

    const list = doc.createElement('ul');
    list.className = 'list-group bt-picker-list';
    list.id = idBase + '-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Business types');

    const status = doc.createElement('div');
    status.className = 'form-text';
    // Announced when it changes, so a screen-reader user hears the choice
    // land without having to go looking for it.
    status.setAttribute('role', 'status');
    status.id = idBase + '-status';

    root.appendChild(input);
    root.appendChild(list);
    root.appendChild(status);

    /**
     * Which types match what has been typed.
     *
     * A QUERY OF DIGITS IS A POSITION, not text to find inside a name. Typing
     * 2 would otherwise match nothing at all, since no business type has a
     * digit in it, and the number would be decoration.
     */
    function matches(query) {
      const q = norm(query);

      if (!q) return labels.map((label, i) => ({ label, number: i + 1 }));

      if (/^\d+$/.test(q)) {
        const wanted = Number(q);
        return labels
          .map((label, i) => ({ label, number: i + 1 }))
          .filter(row => String(row.number).indexOf(q) === 0 || row.number === wanted);
      }

      return labels
        .map((label, i) => ({ label, number: i + 1 }))
        .filter(row => norm(row.label).indexOf(q) !== -1);
    }

    function describe() {
      status.textContent = chosen
        ? `Selected: ${chosen} (#${labels.indexOf(chosen) + 1})`
        : 'You can adjust this later.';
    }

    function render() {
      shown = matches(input.value);
      list.innerHTML = '';

      if (!shown.length) {
        const empty = doc.createElement('li');
        empty.className = 'list-group-item bt-picker-empty';
        empty.textContent = 'Nothing matches that. Try a shorter word.';
        list.appendChild(empty);
        active = -1;
        input.removeAttribute('aria-activedescendant');
        return;
      }

      shown.forEach((row, index) => {
        const item = doc.createElement('li');

        item.className = 'list-group-item list-group-item-action bt-picker-option';
        item.id = `${idBase}-option-${row.number}`;
        item.setAttribute('role', 'option');
        item.setAttribute('data-label', row.label);
        item.setAttribute('aria-selected', row.label === chosen ? 'true' : 'false');

        if (row.label === chosen || index === active) item.className += ' active';

        const num = doc.createElement('span');
        num.className = 'bt-picker-num';
        num.textContent = `${row.number}.`;

        const name = doc.createElement('span');
        name.className = 'bt-picker-name';
        name.textContent = row.label;

        item.appendChild(num);
        item.appendChild(name);

        // mousedown, not click: the input keeps focus, so choosing with the
        // mouse and then carrying on with the keyboard does not lose the
        // caret.
        item.addEventListener('mousedown', function (event) {
          if (event && event.preventDefault) event.preventDefault();
          choose(row.label);
        });

        list.appendChild(item);
      });

      if (active >= 0 && list.children[active]) {
        input.setAttribute('aria-activedescendant', list.children[active].id);
      } else {
        input.removeAttribute('aria-activedescendant');
      }
    }

    function choose(label) {
      /* NO isKnown() CHECK HERE, and that is deliberate rather than an
       * oversight. Every caller passes a label out of `shown`, which is built
       * from `labels` — so the check could never fail, and a mutation test
       * proved it: deleting it changed nothing anywhere.
       *
       * The gate that CAN fire is the one on options.value in the
       * constructor, where a stale draft really can carry a type that has
       * since been removed. */
      chosen = label;
      clearInvalid();
      render();
      describe();

      if (typeof options.onSelect === 'function') options.onSelect(label);
    }

    function move(by) {
      if (!shown.length) return;

      // Wraps, because a list this long is quicker to reach from the bottom.
      active = active < 0
        ? (by > 0 ? 0 : shown.length - 1)
        : (active + by + shown.length) % shown.length;

      render();

      const item = list.children[active];
      if (item && item.scrollIntoView) item.scrollIntoView({ block: 'nearest' });
    }

    function markInvalid() {
      input.className = 'form-control is-invalid';
    }

    function clearInvalid() {
      input.className = 'form-control';
    }

    input.addEventListener('input', function () {
      // A new query, so nothing is highlighted until they move or a single
      // match settles it. Highlighting the first row automatically would mean
      // Enter picking something they never looked at.
      active = -1;
      clearInvalid();
      render();
    });

    input.addEventListener('keydown', function (event) {
      const key = event.key;

      if (key === 'ArrowDown') { move(1); event.preventDefault(); return; }
      if (key === 'ArrowUp') { move(-1); event.preventDefault(); return; }

      if (key === 'Escape') {
        input.value = '';
        active = -1;
        render();
        event.preventDefault();
        return;
      }

      if (key === 'Enter') {
        // Enter must not submit the wizard from here.
        event.preventDefault();

        if (active >= 0 && shown[active]) { choose(shown[active].label); return; }

        // ONE MATCH IS AN ANSWER. Typing "plumb" and pressing Enter should
        // choose Plumbing rather than asking which one — there is no which.
        if (shown.length === 1) choose(shown[0].label);
      }
    });

    render();
    describe();

    return {
      el: root,
      input: input,
      list: list,
      /** The chosen type, or '' — never what was typed. */
      value: function () { return chosen; },
      focus: function () { input.focus(); },
      markInvalid: markInvalid,
      clearInvalid: clearInvalid,
      /** For tests: what is on screen right now. */
      options: function () { return shown.slice(); },
    };
  }

  global.createBusinessTypePicker = createBusinessTypePicker;

  // For node, so the tests can run it without a browser.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { createBusinessTypePicker };
  }
})(typeof window !== 'undefined' ? window : globalThis);
