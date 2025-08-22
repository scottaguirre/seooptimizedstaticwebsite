// /public/js/spinner.js
window.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('websiteForm');
  if (!form) return;

  // Reusable alert helper (won't destroy the close button)
  function showAlert(message) {
    const alertBox = document.getElementById('formAlert');
    if (!alertBox) return;

    // Ensure the message span exists
    let textEl = document.getElementById('formAlertText');
    if (!textEl) {
      textEl = document.createElement('span');
      textEl.id = 'formAlertText';
      alertBox.prepend(textEl);
    }

    // Ensure a close button exists
    if (!alertBox.querySelector('.btn-close')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-close';
      btn.setAttribute('aria-label', 'Close');
      btn.addEventListener('click', () => alertBox.classList.add('d-none'));
      alertBox.appendChild(btn);
    }

    textEl.textContent = message || '';
    alertBox.classList.remove('d-none');
  }

  // Helper to clear (hide) the alert without removing its children
  function clearAlert() {
    const alertBox = document.getElementById('formAlert');
    if (!alertBox) return;
    alertBox.classList.add('d-none');
    const textEl = document.getElementById('formAlertText');
    if (textEl) textEl.textContent = '';
  }

  // Overlay helpers
  function showOverlay() {
    const loadingOverlay = document.createElement('div');
    loadingOverlay.id = 'loading-overlay';
    loadingOverlay.innerHTML = `
      <div class="spinner-border text-primary" role="status" style="width: 4rem; height: 4rem;">
        <span class="visually-hidden">Generating page...</span>
      </div>
      <p class="mt-3 text-white">Generating your page... please wait</p>
    `;
    Object.assign(loadingOverlay.style, {
      position: 'fixed',
      inset: 0,
      backgroundColor: 'rgba(0,0,0,0.75)',
      zIndex: 9999,
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#fff',
      fontSize: '1.25rem',
      cursor: 'wait'
    });
    document.body.appendChild(loadingOverlay);
  }

  function hideOverlay() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) document.body.removeChild(overlay);
  }

  let isSubmitting = false;

  form.addEventListener('submit', async (e) => {
    // Never let the browser navigate away
    e.preventDefault();
    if (isSubmitting) return;

    // Clear any previous alert
    clearAlert();

    // Client-side duplicate filename check
    const filenameInputs = form.querySelectorAll('input[name^="pages"][name$="[filename]"]');
    const filenames = Array.from(filenameInputs).map(input => input.value.trim().toLowerCase());
    const duplicates = filenames.filter((val, idx) => filenames.indexOf(val) !== idx);

    if (duplicates.length > 0) {
      // Clear previous highlights, then re-highlight duplicates
      filenameInputs.forEach(i => i.classList.remove('is-invalid'));
      filenameInputs.forEach(i => {
        const val = i.value.trim().toLowerCase();
        if (duplicates.includes(val)) i.classList.add('is-invalid');
      });
      showAlert('Duplicate filenames detected: ' + [...new Set(duplicates)].join(', '));
      return;
    }

    // Show overlay & lock submit
    isSubmitting = true;
    const submitBtn = document.querySelector('.btn-submit');
    if (submitBtn) submitBtn.disabled = true;
    showOverlay();

    try {
      const formData = new FormData(form);
      const response = await fetch('/generate', { method: 'POST', body: formData });

      // Treat ANY JSON as an error payload in this app
      const ct = response.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        let message = 'Please fix the highlighted fields and try again.';
        let fieldErrors = [];

        try {
          const data = await response.json();
          if (data?.error) message = data.error;
          if (Array.isArray(data.fields)) fieldErrors = data.fields;
        } catch {
          // ignore JSON parse error; fall back to default message
        }

        // Status-specific messages
        if (response.status === 413) message = 'Your upload is too large. Try smaller images/files.';
        if (response.status === 429) message = 'Too many requests. Please wait a moment and try again.';
        if (response.status >= 500) message = 'Server error. Please try again shortly.';

        // Clear previous invalids & auto-added feedback
        form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
        form.querySelectorAll('.invalid-feedback[data-auto]').forEach(el => el.remove());

        // Highlight fields + add inline messages
        let firstInvalidEl = null;
        fieldErrors.forEach(({ name, message: fieldMsg }) => {
          const el = form.querySelector(`[name="${name}"]`);
          if (!el) return;
          el.classList.add('is-invalid');
          if (!firstInvalidEl) firstInvalidEl = el;

          const hasFeedback = el.nextElementSibling && el.nextElementSibling.classList.contains('invalid-feedback');
          if (!hasFeedback && fieldMsg) {
            const fb = document.createElement('div');
            fb.className = 'invalid-feedback';
            fb.dataset.auto = 'true';
            fb.textContent = fieldMsg;
            el.insertAdjacentElement('afterend', fb);
          }
        });

        // Show alert
        showAlert(message);

        // Ensure the invalid field is visible (open its accordion section)
        if (firstInvalidEl) {
          const collapse = firstInvalidEl.closest('.accordion-collapse');
          if (collapse && !collapse.classList.contains('show')) {
            const btn = document.querySelector(`[data-bs-target="#${collapse.id}"]`);
            if (btn) btn.click();
          }
          firstInvalidEl.focus({ preventScroll: true });
          firstInvalidEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        return; // STOP: don't document.write on errors
      }

      // SUCCESS (HTML returned)
      if (response.ok) {
        const resultHtml = await response.text();
        document.open();
        document.write(resultHtml);
        document.close();
        return;
      }

      // Unexpected non-JSON error fallback
      const text = await response.text().catch(() => '');
      const message = (text || 'Something went wrong.').replace(/<[^>]*>/g, '').trim();
      showAlert(message);

    } catch (err) {
      console.error(err);
      showAlert('Network error. Please try again.');
    } finally {
      hideOverlay();
      if (submitBtn) submitBtn.disabled = false;
      isSubmitting = false;
    }
  });
});
