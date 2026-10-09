// /public/js/hoursOfOperation.js
//
// The Business Hours rows: enabling, disabling, and saying back what was typed.
//
// WHY THE PREVIEW IS HERE
//
// The two boxes are <input type="time">. Whether they show an AM/PM spinner or
// a 24-hour box is decided by the viewer's own computer, not by this app — so
// one person sees "5:00 PM" where another sees "17:00", and the first question
// anybody asks is how to choose AM or PM. There is no answer: you cannot, the
// browser decides. What can be done is to show, beside the row, exactly what
// the published site will say. Then the format of the box stops mattering, and
// a 9pm typed as 9am is visible before Generate is pressed.
//
// The wording comes from utils/formatDaysAndHoursForDisplay.js — the same
// module that renders the real page, loaded here as window.HoursFormat. A
// second copy of that formatting would be a preview that quietly disagrees
// with the site.
(function () {
    const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

    function setRequired(el, should) {
      if (!el) return;
      if (should) {
        el.required = true;
        el.setAttribute('required', 'required');
      } else {
        el.required = false;
        el.removeAttribute('required');
      }
    }

    /** The row's preview element, created on first use. */
    function previewFor(day) {
      let el = document.querySelector(`[data-hours-preview="${day}"]`);
      if (el) return el;

      const close = document.querySelector(`[data-close-for="${day}"]`);
      const row = close && close.closest('.row');
      if (!row) return null;

      el = document.createElement('div');
      el.className = 'small text-muted mt-1';
      el.setAttribute('data-hours-preview', day);
      row.appendChild(el);
      return el;
    }

    function renderPreview(day) {
      const el = previewFor(day);
      if (!el) return;

      const fmt = window.HoursFormat;
      if (!fmt) { el.textContent = ''; return; }   // script missing; do not guess

      const is24 = document.getElementById('is24Hours')?.checked;
      if (is24) { el.textContent = ''; return; }

      const closed = document.getElementById(`closed-${day}`)?.checked;
      const open = document.querySelector(`[data-open-for="${day}"]`)?.value || '';
      const shut = document.querySelector(`[data-close-for="${day}"]`)?.value || '';

      if (!closed && (!open || !shut)) { el.textContent = ''; return; }

      // The one case worth more than grey text: a day that opens and closes at
      // the same moment is refused on submit, and saying so here saves the
      // round trip.
      if (!closed && open && shut && open === shut) {
        el.className = 'small text-warning mt-1';
        el.textContent =
          'Opening and closing times are the same — use the "Open 24 Hours" switch instead.';
        return;
      }

      el.className = 'small text-muted mt-1';
      el.textContent =
        'On your site: ' + fmt.describeDay(day, { open, close: shut, closed }, { long: true });
    }

    function syncDay(day) {
      const is24 = document.getElementById('is24Hours')?.checked;
      const closed = document.getElementById(`closed-${day}`)?.checked;
      const open = document.querySelector(`[data-open-for="${day}"]`);
      const close = document.querySelector(`[data-close-for="${day}"]`);

      if (closed) {
        if (open) { open.value = ''; open.disabled = true; setRequired(open, false); }
        if (close){ close.value = ''; close.disabled = true; setRequired(close, false); }
        renderPreview(day);
        return;
      }
      // not closed
      if (open)  { open.disabled  = !!is24; setRequired(open,  !is24); }
      if (close) { close.disabled = !!is24; setRequired(close, !is24); }
      renderPreview(day);
    }

    /**
     * One line under the section heading, because the boxes themselves carry
     * no label, no placeholder and no clue about the format.
     */
    function addFormatHint() {
      if (document.querySelector('[data-hours-hint]')) return;

      const container = document.getElementById('hoursContainer');
      if (!container || !container.parentNode) return;

      const hint = document.createElement('p');
      hint.className = 'small text-muted mb-2';
      hint.setAttribute('data-hours-hint', '');
      hint.textContent =
        'Enter an opening and a closing time for each day, or tick Closed. ' +
        'Whether these boxes show AM/PM or a 24-hour clock depends on your ' +
        'computer’s settings — either way, the line under each day shows ' +
        'exactly what your site will say. Closing after midnight is fine.';
      container.parentNode.insertBefore(hint, container);
    }

    function syncAllDays() {
      addFormatHint();
      DAYS.forEach(syncDay);
      const hoursContainer = document.getElementById('hoursContainer');
      const is24 = document.getElementById('is24Hours')?.checked;
      if (hoursContainer) hoursContainer.style.display = is24 ? 'none' : 'block';
    }

    function dayOf(el) {
      return el && el.dataset ? (el.dataset.openFor || el.dataset.closeFor) : null;
    }

    // Delegated listeners (work with dynamically inserted form)
    document.addEventListener('change', function(e) {
      if (e.target && e.target.id === 'is24Hours') syncAllDays();
      if (e.target && e.target.classList.contains('day-closed')) {
        syncDay(e.target.dataset.day);
      }
      const d = dayOf(e.target);
      if (d) renderPreview(d);
    });

    // `change` on a time input only fires when it loses focus in some
    // browsers, and a preview that arrives a click late is worth much less.
    document.addEventListener('input', function (e) {
      const d = dayOf(e.target);
      if (d) renderPreview(d);
    });

    // Expose to page so you can call it after rendering the dynamic form
    window.attachHours = function attachHours() {
      syncAllDays();
    };
  })();
