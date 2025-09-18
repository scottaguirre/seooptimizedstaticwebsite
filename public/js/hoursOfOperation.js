// /public/js/hoursOfOperation.js
(function () {
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
  
    function syncDay(day) {
      const is24 = document.getElementById('is24Hours')?.checked;
      const closed = document.getElementById(`closed-${day}`)?.checked;
      const open = document.querySelector(`[data-open-for="${day}"]`);
      const close = document.querySelector(`[data-close-for="${day}"]`);
  
      if (closed) {
        if (open) { open.value = ''; open.disabled = true; setRequired(open, false); }
        if (close){ close.value = ''; close.disabled = true; setRequired(close, false); }
        return;
      }
      // not closed
      if (open)  { open.disabled  = !!is24; setRequired(open,  !is24); }
      if (close) { close.disabled = !!is24; setRequired(close, !is24); }
    }
  
    function syncAllDays() {
      ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].forEach(syncDay);
      const hoursContainer = document.getElementById('hoursContainer');
      const is24 = document.getElementById('is24Hours')?.checked;
      if (hoursContainer) hoursContainer.style.display = is24 ? 'none' : 'block';
    }
  
    // Delegated listeners (work with dynamically inserted form)
    document.addEventListener('change', function(e) {
      if (e.target && e.target.id === 'is24Hours') syncAllDays();
      if (e.target && e.target.classList.contains('day-closed')) {
        syncDay(e.target.dataset.day);
      }
    });
  
    // Expose to page so you can call it after rendering the dynamic form
    window.attachHours = function attachHours() {
      syncAllDays();
    };
  })();
  