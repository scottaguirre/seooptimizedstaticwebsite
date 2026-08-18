// /public/js/spinner.js
//
// The ONE submit handler for #websiteForm.
//
// There used to be three. generateDinamycForm.js injected its hidden fields,
// then checkUserCredits.js called form.submit() while this file fired its own
// fetch() POST — so a single click started TWO concurrent generations. They
// shared dist/user_<id>/, so the second wiped the first mid-build and then
// skipped every page the first had already written, leaving sites whose HTML
// and content.json disagreed.
//
// Flow now: validate -> check credits -> POST once -> show the result.
// Credits are charged server-side only after the build succeeds.
//
// NOTE: checkUserCredits.js is no longer loaded. Its logic lives here.

window.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('websiteForm');
    if (!form) return;
  
    let isSubmitting = false;
  
    /* ---------------------------------------------------------- alerts */
  
    function showAlert(message) {
      const alertBox = document.getElementById('formAlert');
      if (!alertBox) return;
  
      let textEl = document.getElementById('formAlertText');
      if (!textEl) {
        textEl = document.createElement('span');
        textEl.id = 'formAlertText';
        alertBox.prepend(textEl);
      }
  
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
      alertBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  
    function clearAlert() {
      const alertBox = document.getElementById('formAlert');
      if (!alertBox) return;
      alertBox.classList.add('d-none');
      const textEl = document.getElementById('formAlertText');
      if (textEl) textEl.textContent = '';
    }
  
    /* --------------------------------------------------------- overlay */
  
    function showOverlay() {
      if (document.getElementById('loading-overlay')) return;
  
      const overlay = document.createElement('div');
      overlay.id = 'loading-overlay';
      overlay.innerHTML =
        '<div class="spinner-border text-primary" role="status" style="width:4rem;height:4rem;">' +
        '<span class="visually-hidden">Generating page...</span></div>' +
        '<p class="mt-3 text-white">Generating your website... please wait</p>';
  
      Object.assign(overlay.style, {
        position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.75)',
        zIndex: 9999, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        color: '#fff', fontSize: '1.25rem', cursor: 'wait',
      });
  
      document.body.appendChild(overlay);
    }
  
    function hideOverlay() {
      const overlay = document.getElementById('loading-overlay');
      if (overlay) overlay.remove();
    }
  
    /* ---------------------------------------------------- credits modal */
  
    function showCreditsModal({ pagesCount, totalCost, available }) {
      const messageEl = document.getElementById('creditsModalMessage');
      if (messageEl) {
        messageEl.innerHTML =
          'You tried to generate <strong>' + (pagesCount ?? '?') + '</strong> page(s), ' +
          'which costs <strong>' + (totalCost ?? '?') + '</strong> credits, ' +
          'but you only have <strong>' + (available ?? '?') + '</strong>.<br><br>' +
          'Please buy more credits to continue.';
      }
  
      const modalEl = document.getElementById('creditsModal');
      if (modalEl && window.bootstrap && window.bootstrap.Modal) {
        new window.bootstrap.Modal(modalEl).show();
      } else {
        showAlert('Not enough credits to generate these pages.');
      }
    }
  
    /* -------------------------------------------------- field highlight */
  
    function markInvalidFields(fieldErrors) {
      form.querySelectorAll('.is-invalid').forEach(el => el.classList.remove('is-invalid'));
      form.querySelectorAll('.invalid-feedback[data-auto]').forEach(el => el.remove());
  
      let first = null;
  
      (fieldErrors || []).forEach(({ name, message }) => {
        const el = form.querySelector('[name="' + name + '"]');
        if (!el) return;
  
        el.classList.add('is-invalid');
        if (!first) first = el;
  
        const hasFeedback = el.nextElementSibling &&
          el.nextElementSibling.classList.contains('invalid-feedback');
  
        if (!hasFeedback && message) {
          const fb = document.createElement('div');
          fb.className = 'invalid-feedback';
          fb.dataset.auto = 'true';
          fb.textContent = message;
          el.insertAdjacentElement('afterend', fb);
        }
      });
  
      if (first) {
        const collapse = first.closest('.accordion-collapse');
        if (collapse && !collapse.classList.contains('show')) {
          const btn = document.querySelector('[data-bs-target="#' + collapse.id + '"]');
          if (btn) btn.click();
        }
        first.focus({ preventScroll: true });
        first.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  
    /* ------------------------------------------------- duplicate check */
  
    function duplicateFilenames() {
      const inputs = form.querySelectorAll('input[name^="pages"][name$="[filename]"]');
      const names = Array.from(inputs).map(i => i.value.trim().toLowerCase());
      const dupes = names.filter((v, i) => v && names.indexOf(v) !== i);
  
      if (!dupes.length) return null;
  
      inputs.forEach(i => i.classList.remove('is-invalid'));
      inputs.forEach(i => {
        if (dupes.includes(i.value.trim().toLowerCase())) i.classList.add('is-invalid');
      });
  
      return [...new Set(dupes)];
    }
  
    /* ------------------------------------------------------ submission */
  
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (isSubmitting) return;
  
      clearAlert();
  
      const dupes = duplicateFilenames();
      if (dupes) {
        showAlert('Duplicate filenames detected: ' + dupes.join(', '));
        return;
      }
  
      const submitBtn = document.querySelector('.btn-submit');
      isSubmitting = true;
      if (submitBtn) submitBtn.disabled = true;
      showOverlay();
  
      try {
        const formData = new FormData(form);
  
        // 1. Credit pre-check, so we don't upload a large payload only to be
        //    rejected. The server re-checks before doing any work.
        const pages = {};
        for (const [key, value] of formData.entries()) {
          if (key.startsWith('pages[')) pages[key] = value;
        }
  
        try {
          // Same token as the /generate call below. Without it this POST is
          // rejected and the credit pre-check silently never runs — the user
          // only finds out they cannot afford it after the generation starts.
          const preCsrf = document
            .querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  
          const pre = await fetch('/api/check-credits', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-CSRF-Token': preCsrf,
            },
            body: JSON.stringify({ pages }),
          });
  
          if (pre.ok) {
            const data = await pre.json();
            if (!data.ok) {
              hideOverlay();
              showCreditsModal(data);
              return;
            }
          }
        } catch (err) {
          // A failed pre-check shouldn't block submission; /generate checks too
          console.warn('Credit pre-check failed, continuing:', err);
        }
  
        // 2. The single POST
        // The token goes in a HEADER, not a form field.
        //
        // /generate posts multipart/form-data, which multer parses — and the
        // CSRF check runs before multer, so req.body is still empty at that
        // point and a hidden field would be invisible. A header is readable
        // either way.
        const csrfToken = document
          .querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
  
        const response = await fetch('/generate', {
          method: 'POST',
          headers: { 'X-CSRF-Token': csrfToken },
          body: formData,
        });
        const contentType = response.headers.get('content-type') || '';
  
        // JSON used to mean an error. It no longer does: generation now runs
        // in the background, so a SUCCESS is also JSON — { ok, jobId, redirect }
        // — and the browser goes to the progress page.
        if (contentType.includes('application/json')) {
          let data = {};
          try { data = await response.json(); } catch (_) { /* fall through */ }
  
          if (response.ok && data.ok && data.redirect) {
            window.location.href = data.redirect;
            return;
          }
  
          if (response.status === 402 || data.creditsError) {
            showCreditsModal(data);
            return;
          }
  
          // A 409 means a build is already running — send them to watch it
          // rather than leaving them stuck on a form that will not submit.
          if (response.status === 409 && data.redirect) {
            window.location.href = data.redirect;
            return;
          }
  
          let message = data.error || 'Please fix the highlighted fields and try again.';
          if (response.status === 409) message = data.error || 'A generation is already running.';
          if (response.status === 413) message = 'Your upload is too large. Try smaller images.';
          if (response.status === 429) message = 'Too many requests. Please wait and try again.';
          if (response.status >= 500) message = data.error || 'Server error. Please try again shortly.';
  
          markInvalidFields(data.fields);
          showAlert(message);
          return;
        }
  
        // Kept for safety: nothing returns HTML from /generate any more, but
        // a stale cached page would still be handled rather than hanging.
        if (response.ok) {
          const html = await response.text();
          document.open();
          document.write(html);
          document.close();
          return;
        }
  
        const text = await response.text().catch(() => '');
        showAlert((text || 'Something went wrong.').replace(/<[^>]*>/g, '').trim());
  
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