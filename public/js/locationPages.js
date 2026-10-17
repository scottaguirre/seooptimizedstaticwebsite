// /public/js/locationPages.js
//
// The rows on the Location Pages step: adding one, deleting one, and the
// number each one wears.
(function () {
    /* THE NUMBER ON EACH ROW.
     *
     * The service pages step numbers its rows — "Page 1", "Page 2" — and
     * this step did not, so the only screen that said how many towns had
     * been added was the review step, one click later. A customer ticking
     * suggested towns and typing a few of their own had to count the fields
     * to know what they were about to pay for.
     *
     * DERIVED FROM POSITION, EVERY TIME, and never stored on the row. A
     * number written once goes wrong the first time row 2 of 5 is deleted:
     * the rows below keep the labels they were born with and the list reads
     * 1, 3, 4, 5 — which is worse than no numbers, because it looks like a
     * row went missing.
     *
     * Published on `window` because this file does not own every way a row
     * arrives or leaves. generateDinamycForm.js adds one when a suggested
     * town is ticked and removes one when it is unticked, and that happens
     * without going through either handler below.
     */
    function renumberLocationRows() {
      const list = document.getElementById('locationsList');
      if (!list) return;

      list.querySelectorAll('.location-label').forEach((label, idx) => {
        label.textContent = `Location ${idx + 1}`;
      });
    }

    // --- Location Pages UI helpers ---
    function addLocationInput(initialValue = '') {
      const list = document.getElementById('locationsList');
      if (!list) return;
      const row = document.createElement('div');

      /* align-items-END, not -center. With a label above the input the two
       * columns are no longer the same height, and centring leaves Delete
       * floating half a line above the field it deletes. The service page
       * rows reached the same class for the same reason. */
      row.className = 'row g-2 align-items-end mb-2';
      row.innerHTML = `
        <div class="col-8">
          <label class="form-label location-label">Location</label>
          <input type="text" class="form-control location-input"
                 name="global[locationPages][]" placeholder="City, ST">
        </div>
        <div class="col-4">
          <button type="button" class="btn btn-danger w-100 remove-location">Delete</button>
        </div>
      `;

      /* SET AS A PROPERTY, not interpolated into the markup above.
       *
       * It used to be `value="${initialValue}"`. These values come back from
       * a saved draft in sessionStorage and from the suggestion panel, and a
       * single double quote in one of them would have closed the attribute
       * early and put the rest of the string into the tag. Assigning the
       * property cannot do that, whatever the text is. */
      row.querySelector('input').value = initialValue;

      list.appendChild(row);
      renumberLocationRows();
    }

    // Toggle block visibility + ensure one input when turned on
    document.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'addLocations') {
        const block = document.getElementById('locationsBlock');
        const list  = document.getElementById('locationsList');
        const on = e.target.checked;
        if (!block || !list) return;
        block.style.display = on ? 'block' : 'none';
        if (on && list.children.length === 0) addLocationInput();
        // Optional: clear rows when toggled off
        if (!on) list.innerHTML = '';
      }
    });

    // Add/remove rows
    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'addLocationBtn') {
        addLocationInput();
      }
      if (e.target && e.target.classList.contains('remove-location')) {
        e.target.closest('.row')?.remove();

        /* AFTER the row is gone, so the positions counted are the ones left.
         * Deleting the middle row is the whole reason the numbers are
         * recomputed rather than assigned once. */
        renumberLocationRows();
      }
    });

    // Prevent Enter in location inputs from submitting the form
    document.addEventListener('keydown', (e) => {
      if (e.target && e.target.classList.contains('location-input') && e.key === 'Enter') {
        e.preventDefault();
      }
    });

    // Expose if you ever want to add programmatically
    window.addLocationInput = addLocationInput;

    // Published for generateDinamycForm.js, which adds and removes rows of
    // its own when suggested towns are ticked and unticked.
    window.renumberLocationRows = renumberLocationRows;
  })();

