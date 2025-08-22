window.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('websiteForm');
  let isSubmitting = false;

  form.addEventListener('submit', async function (e) {
    if (isSubmitting) return;

    // ✅ Check for duplicate filenames
    const filenameInputs = form.querySelectorAll('input[name^="pages"][name$="[filename]"]');
    const filenames = Array.from(filenameInputs).map(input => input.value.trim().toLowerCase());
    const duplicates = filenames.filter((item, index) => filenames.indexOf(item) !== index);

    if (duplicates.length > 0) {
      e.preventDefault();

      // Clear previous highlighting
      filenameInputs.forEach(input => input.classList.remove('is-invalid'));

      // Highlight the duplicates
      filenameInputs.forEach(input => {
        const value = input.value.trim().toLowerCase();
        if (duplicates.includes(value)) {
          input.classList.add('is-invalid');
        }
      });


      alert('Duplicate filenames detected: ' + [...new Set(duplicates)].join(', '));
      return;
    }

    // ✅ Proceed with submission
    isSubmitting = true;
    e.preventDefault();

    document.querySelector(".btn-submit").disabled = true;

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
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
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

    try {
      const formData = new FormData(form);
      const response = await fetch('/generate', {
        method: 'POST',
        body: formData
      });

      const resultHtml = await response.text();
      document.open();
      document.write(resultHtml);
      document.close();
    } catch (err) {
      alert('Something went wrong. Please try again.');
      console.error(err);
      document.body.removeChild(loadingOverlay);
      document.querySelector(".btn-submit").disabled = false;
      isSubmitting = false;
    }
  });
});
