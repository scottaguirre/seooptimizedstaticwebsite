// /public/js/generateDinamycForm.js
(function () {
  // -----------------------------
  // Small helpers
  // -----------------------------
  const el = (tag, attrs = {}, html = '') => {
    const node = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k === 'style') node.setAttribute('style', v);
      else if (k.startsWith('data-')) node.setAttribute(k, v);
      else node[k] = v;
    });
    if (html) node.innerHTML = html;
    return node;
  };

  // Dismissible alert (no auto-dismiss)
  function showAlert(container, msg) {
    container.querySelectorAll('.js-inline-alert').forEach(n => n.remove());
    const box = document.createElement('div');
    box.className = 'alert alert-danger js-inline-alert';
    box.setAttribute('role', 'alert');
    box.style.marginBottom = '1rem';
    box.style.display = 'flex';
    box.style.alignItems = 'center';
    box.style.justifyContent = 'space-between';

    const msgSpan = document.createElement('span');
    msgSpan.textContent = msg;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn-close';
    closeBtn.setAttribute('aria-label', 'Close');
    closeBtn.addEventListener('click', () => box.remove());

    box.append(msgSpan, closeBtn);
    container.prepend(box);
  }

  // Advisory image size note (never blocks)
  function advisoryImageNote(file, expectedW, expectedH, hintEl) {
    if (!file || !hintEl) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      hintEl.textContent = `Uploaded: ${img.width}×${img.height}px. Recommended ~${expectedW}×${expectedH}px (not required).`;
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      hintEl.textContent = 'Could not read image dimensions (advisory only).';
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  // Snapshot / restore non-file inputs in the main form
  function snapshotFormValues(root) {
    const data = {};
    root.querySelectorAll('input, select, textarea').forEach((el) => {
      if (!el.name) return;
      if (el.type === 'file') return;
      if (el.type === 'checkbox') data[el.name] = el.checked;
      else if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; }
      else data[el.name] = el.value;
    });
    return data;
  }
  function restoreFormValues(root, data) {
    if (!data) return;
    root.querySelectorAll('input, select, textarea').forEach((el) => {
      if (!el.name) return;
      if (!(el.name in data)) return;
      if (el.type === 'file') return;
      if (el.type === 'checkbox') el.checked = !!data[el.name];
      else if (el.type === 'radio') el.checked = (el.value === data[el.name]);
      else el.value = data[el.name];
    });
  }

  // -----------------------------
  // State
  // -----------------------------
  const state = {
    businessType: '',
    logoType: 'square',     // 'square' | 'rect'
    logoFile: null,
    logoPreviewURL: '',
    mainFormSnapshot: null, // snapshot of main form fields

    // Final step data
    pages: [],            // service pages strings
    addLocations: true,   // toggle default ON
    locations: []         // array of strings
  };

  // DOM refs
  let container, form, hiddenLogoInput;

  // -----------------------------
  // Shared nav renderer
  // -----------------------------
  function renderNav(container, { showBack = false, nextText = 'Next', backText = 'Back', onBack, onNext } = {}) {
    const nav = el('div', { class: 'd-flex gap-2 mt-4 justify-content-between flex-wrap' });
    const back = el('button', {
      type: 'button',
      id: 'backBtn',
      class: 'btn',
      style: `background:#148ec6;color:#fff;min-width:150px;font-size:18px;display:${showBack ? 'inline-block' : 'none'}`
    }, backText);
    const next = el('button', {
      type: 'button',
      id: 'nextBtn',
      class: 'btn btn-success ms-auto',
      style: 'min-width:150px;font-size:18px;'
    }, nextText);
    nav.append(back, next);
    container.appendChild(nav);

    if (onBack) back.addEventListener('click', onBack);
    if (onNext) next.addEventListener('click', onNext);
    return { back, next };
  }

  // -----------------------------
  // Step 0: Business Type
  // -----------------------------
  function renderBusinessTypeStep() {
    container.innerHTML = '';

    const card = el('div', { class: 'card shadow-sm' });
    card.innerHTML = `
      <div class="card-body">
        <h3 class="card-title mb-3">Choose your Business Type</h3>
        <div class="row g-3">
          <div class="col-12">
            <select class="form-select" id="businessType" required>
              <option value="">Choose...</option>
              ${['Plumbing','Electrician','Concrete Contractor','Roofing','HVAC','Landscaping','Law Firm']
                .map(bt => `<option ${state.businessType===bt?'selected':''}>${bt}</option>`).join('')}
            </select>
            <div class="form-text">You can adjust this later.</div>
          </div>
        </div>
      </div>
    `;
    container.appendChild(card);

    const select = card.querySelector('#businessType');
    select.addEventListener('change', () => select.classList.remove('is-invalid'));

    renderNav(container, {
      showBack: false,
      nextText: 'Next',
      onNext: () => {
        const val = (select.value || '').trim();
        if (!val) {
          select.classList.add('is-invalid');
          select.focus();
          showAlert(container, 'Please choose a business type.');
          return;
        }
        state.businessType = val;
        go(1);
      }
    });
  }

  // -----------------------------
  // Step 1: Logo
  // -----------------------------
  function renderLogoStep() {
    container.innerHTML = '';

    const header = el('div', { class: 'd-flex align-items-center justify-content-between mb-3' });
    header.innerHTML = `
      <h4 class="m-0">Logo</h4>
      <span class="badge text-bg-primary">Business Type: ${state.businessType}</span>
    `;
    container.appendChild(header);

    const wrap = el('div', { class: 'mb-2' });
    wrap.innerHTML = `
      <fieldset class="mb-3">
        <legend class="form-label mb-2">Choose logo shape & upload</legend>
        <div class="d-flex gap-3 mb-3">
          <div class="form-check">
            <input class="form-check-input" type="radio" name="logoTypeStep" id="logoTypeSquare" value="square" ${state.logoType==='square'?'checked':''}>
            <label class="form-check-label" for="logoTypeSquare">Square (recommended 250×250 px)</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="logoTypeStep" id="logoTypeRect" value="rect" ${state.logoType==='rect'?'checked':''}>
            <label class="form-check-label" for="logoTypeRect">Rectangular (recommended 260×200 px)</label>
          </div>
        </div>

        <div id="logoSquareWrap" class="mb-3">
          <label class="form-label" for="logoSquare">Upload square logo</label>
          <input type="file" id="logoSquare" class="form-control" accept="image/*">
          <div class="form-text">Recommended: <strong>250×250</strong> (advisory only).</div>
          <div class="form-text" id="logoSquareHint"></div>
        </div>

        <div id="logoRectWrap" class="mb-3">
          <label class="form-label" for="logoRect">Upload rectangular logo</label>
          <input type="file" id="logoRect" class="form-control" accept="image/*">
          <div class="form-text">Recommended: <strong>260×200</strong> (advisory only).</div>
          <div class="form-text" id="logoRectHint"></div>
        </div>

        <div id="logoPreview" class="mt-3" style="display:none;">
          <div class="form-text mb-1"><strong>Current selection:</strong> <span id="logoFileName"></span></div>
          <img id="logoImgPreview" alt="Logo preview" style="max-height:120px; max-width:260px; display:block;">
        </div>
      </fieldset>
    `;
    container.appendChild(wrap);

    const radios = container.querySelectorAll('input[name="logoTypeStep"]');
    radios.forEach(r => r.addEventListener('change', () => applyLogoTypeForStep(container, r.value)));

    function applyLogoTypeForStep(container, type) {
      state.logoType = type;
      const squareWrap  = container.querySelector('#logoSquareWrap');
      const rectWrap    = container.querySelector('#logoRectWrap');
      const isSquare = type === 'square';
      if (squareWrap) squareWrap.style.display = isSquare ? '' : 'none';
      if (rectWrap)   rectWrap.style.display   = isSquare ? 'none' : '';
      container.querySelector('#logoSquare')?.classList.remove('is-invalid');
      container.querySelector('#logoRect')?.classList.remove('is-invalid');
    }
    applyLogoTypeForStep(container, state.logoType);

    const squareInput = container.querySelector('#logoSquare');
    const rectInput   = container.querySelector('#logoRect');
    const squareHint  = container.querySelector('#logoSquareHint');
    const rectHint    = container.querySelector('#logoRectHint');
    const previewWrap = container.querySelector('#logoPreview');
    const previewImg  = container.querySelector('#logoImgPreview');
    const previewName = container.querySelector('#logoFileName');

    // restore chosen file if returning to this step
    if (state.logoFile) {
      const isSquare = state.logoType === 'square';
      const target = isSquare ? squareInput : rectInput;
      if (target) {
        const dt = new DataTransfer();
        dt.items.add(state.logoFile);
        target.files = dt.files;
      }
      if (state.logoPreviewURL) {
        previewWrap.style.display = 'block';
        previewImg.src = state.logoPreviewURL;
        previewName.textContent = state.logoFile.name || '(selected)';
      }
    }

    squareInput?.addEventListener('change', e => {
      const f = e.target.files?.[0];
      if (f) {
        state.logoType = 'square';
        state.logoFile = f;
        if (state.logoPreviewURL) URL.revokeObjectURL(state.logoPreviewURL);
        state.logoPreviewURL = URL.createObjectURL(f);
        previewWrap.style.display = 'block';
        previewImg.src = state.logoPreviewURL;
        previewName.textContent = f.name || '(selected)';
        advisoryImageNote(f, 250, 250, squareHint);
        squareInput.classList.remove('is-invalid');
        rectInput?.classList.remove('is-invalid');
      } else { squareHint && (squareHint.textContent = ''); }
    });
    rectInput?.addEventListener('change', e => {
      const f = e.target.files?.[0];
      if (f) {
        state.logoType = 'rect';
        state.logoFile = f;
        if (state.logoPreviewURL) URL.revokeObjectURL(state.logoPreviewURL);
        state.logoPreviewURL = URL.createObjectURL(f);
        previewWrap.style.display = 'block';
        previewImg.src = state.logoPreviewURL;
        previewName.textContent = f.name || '(selected)';
        advisoryImageNote(f, 260, 200, rectHint);
        rectInput.classList.remove('is-invalid');
        squareInput?.classList.remove('is-invalid');
      } else { rectHint && (rectHint.textContent = ''); }
    });

    renderNav(container, {
      showBack: true,
      nextText: 'Continue',
      onBack: () => go(0),
      onNext: () => {
        const activeEl = state.logoType === 'square' ? squareInput : rectInput;
        const file = activeEl?.files?.[0];
        if (!file) {
          activeEl?.classList.add('is-invalid');
          activeEl?.focus();
          showAlert(container, 'Please choose a logo to continue.');
          return;
        }
        state.logoFile = file;
        go(2);
      }
    });
  }

  // -----------------------------
  // Step 2: Main Form (no logo, no pages/locations here)
  // -----------------------------
  // -----------------------------
  // Step 2: Main Form (no logo, no pages/locations here) — with validation
  // -----------------------------
  // -----------------------------
// Step 2: Main Form (no logo, no pages/locations here) — with validation incl. hours
// -----------------------------
function renderMainForm() {
  container.innerHTML = '';

  const header = el('div', { class: 'd-flex align-items-center justify-content-between mb-3' });
  header.innerHTML = `
    <h4 class="m-0">1. Global Information</h4>
    <div class="d-flex flex-wrap gap-2">
      <span class="badge text-bg-primary">Business Type: ${state.businessType}</span>
      <span class="badge text-bg-secondary">Logo: ${state.logoFile ? (state.logoFile.name || 'selected') : '—'}</span>
    </div>
  `;
  container.appendChild(header);

  const block = el('div');
  block.innerHTML = `
    <input type="hidden" name="global[businessType]" value="${state.businessType}">

    <div class="mb-4">
      <!-- Business Name-->
      <div class="mb-3">
        <label class="form-label">Business Name</label>
        <input type="text" name="global[businessName]" class="form-control" required />
      </div>

      <hr>

      <!-- Near Me -->
      <div class="form-check">
        <input class="form-check-input" type="checkbox" id="useNearMe" name="global[useNearMe]" value="true" checked>
        <label class="form-check-label" for="useNearMe">
          Check to optimize About Us page with "Near Me" term
        </label>
      </div>

      <hr>

      <!-- Domain -->
      <div class="mb-3">
        <label class="form-label">Domain</label>
        <input type="text" name="global[domain]" class="form-control" placeholder="example.com" required />
      </div>

      <!-- Address -->
      <div class="mb-3">
        <label class="form-label">Address</label>
        <input type="text" name="global[address]" class="form-control" required />
      </div>

      <!-- Main Location-->
      <div class="mb-3">
        <label class="form-label">Main Location</label>
        <input type="text" name="global[location]" class="form-control" required />
      </div>

      <hr>

      <!-- Phone -->
      <div class="mb-3">
        <label class="form-label">Phone</label>
        <input type="tel" name="global[phone]" class="form-control" required />
      </div>

      <!-- Email-->
      <div class="mb-3">
        <label class="form-label">Email</label>
        <input type="email" name="global[email]" class="form-control" required />
      </div>
      <div class="form-check mt-2">
        <input class="form-check-input" type="checkbox" id="showAboutForm" name="global[showAboutForm]" checked>
        <label class="form-check-label" for="showAboutForm">
          Include contact form on About page
        </label>
      </div>

      <!-- Business Hours-->
      <hr>
      <div class="mb-3">
        <label class="form-label">Business Hours</label>
        <div class="form-check form-switch">
          <input class="form-check-input" type="checkbox" id="is24Hours" name="global[is24Hours]">
          <label class="form-check-label" for="is24Hours">Open 24 Hours</label>
        </div>
      </div>

      <div id="hoursContainer">
        ${['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day => `
          <div class="row mb-2 align-items-center">
            <div class="col-sm-2"><strong>${day}</strong></div>
            <div class="col-sm-3">
              <input type="time" class="form-control"
                name="global[hours][${day.toLowerCase()}][open]"
                data-open-for="${day.toLowerCase()}">
            </div>
            <div class="col-sm-3">
              <input type="time" class="form-control"
                name="global[hours][${day.toLowerCase()}][close]"
                data-close-for="${day.toLowerCase()}">
            </div>
            <div class="col-sm-4">
              <div class="form-check">
                <input class="form-check-input day-closed" type="checkbox"
                  id="closed-${day.toLowerCase()}"
                  name="global[hours][${day.toLowerCase()}][closed]"
                  value="true"
                  data-day="${day.toLowerCase()}">
                <label class="form-check-label" for="closed-${day.toLowerCase()}">Closed</label>
              </div>
            </div>
          </div>
        `).join('')}
      </div>

      <hr>

      <!-- Social Profiles-->
      <label class="form-label">Social Profiles</label>
      ${['facebookUrl','twitterUrl','linkedinUrl','youtubeUrl','instagramUrl','pinterestUrl'].map(field => `
        <div class="mb-3">
          <label class="form-label">${field.replace('Url','').replace(/([A-Z])/g,' $1')} URL</label>
          <input type="url" name="global[${field}]" class="form-control" />
        </div>
      `).join('')}
    </div>
  `;
  container.appendChild(block);

  // Hours hookup (from hoursOfOperation.js)
  if (window.attachHours) window.attachHours();

  // Footer: Back/Next (Next validates)
  const footer = el('div', { class: 'd-flex gap-2 mt-4' });
  const backBtn = el('button', { type: 'button', class: 'btn', style: 'background:#148ec6;color:#fff;min-width:150px;font-size:18px;' }, 'Back');
  const nextBtn = el('button', { type: 'button', class: 'btn btn-success ms-auto', style: 'min-width:150px;font-size:18px;' }, 'Continue');
  footer.append(backBtn, nextBtn);
  container.appendChild(footer);

  // Restore any previously typed main-form values
  restoreFormValues(form, state.mainFormSnapshot);

  // Remove red outline when user fixes input (text/time/checkbox)
  container.addEventListener('input', (ev) => {
    if (ev.target.classList?.contains('is-invalid')) ev.target.classList.remove('is-invalid');
  });
  container.addEventListener('change', (ev) => {
    if (ev.target.classList?.contains('is-invalid')) ev.target.classList.remove('is-invalid');
  });

  backBtn.addEventListener('click', () => {
    state.mainFormSnapshot = snapshotFormValues(form);
    go(1);
  });

  nextBtn.addEventListener('click', () => {
    // Validate required text/email/tel fields
    const requiredFields = [
      'global[businessName]',
      'global[domain]',
      'global[address]',
      'global[location]',
      'global[phone]',
      'global[email]'
    ];
    const inputs = requiredFields.map(name => container.querySelector(`[name="${name}"]`));

    let firstInvalid = null;
    inputs.forEach(input => {
      if (!input) return;
      const val = String(input.value || '').trim();
      const ok = input.checkValidity() && val !== '';
      if (!ok) {
        if (!firstInvalid) firstInvalid = input;
        input.classList.add('is-invalid');
      } else {
        input.classList.remove('is-invalid');
      }
    });

    if (firstInvalid) {
      firstInvalid.focus();
      const labels = {
        'global[businessName]': 'Business Name',
        'global[domain]': 'Domain',
        'global[address]': 'Address',
        'global[location]': 'Main Location',
        'global[phone]': 'Phone',
        'global[email]': 'Email'
      };
      const name = firstInvalid.getAttribute('name');
      showAlert(container, `Please fill out ${labels[name] || 'all required fields'}.`);
      return;
    }

    // ===== Business Hours validation =====
    const is24 = container.querySelector('#is24Hours')?.checked;
    if (!is24) {
      const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
      let hoursValid = true;
      let firstInvalidHoursControl = null;

      for (const day of days) {
        const openEl  = container.querySelector(`[name="global[hours][${day}][open]"]`);
        const closeEl = container.querySelector(`[name="global[hours][${day}][close]"]`);
        const closedEl = container.querySelector(`#closed-${day}`);

        const isClosed = !!closedEl?.checked;
        const openVal = (openEl?.value || '').trim();
        const closeVal = (closeEl?.value || '').trim();

        // Rule: for EACH day, either mark Closed OR provide BOTH open & close times.
        if (!isClosed) {
          if (!openVal || !closeVal) {
            hoursValid = false;
            openEl?.classList.add('is-invalid');
            closeEl?.classList.add('is-invalid');
            if (!firstInvalidHoursControl) firstInvalidHoursControl = openEl || closeEl;
          } else {
            openEl?.classList.remove('is-invalid');
            closeEl?.classList.remove('is-invalid');
          }
        } else {
          openEl?.classList.remove('is-invalid');
          closeEl?.classList.remove('is-invalid');
        }
      }

      if (!hoursValid) {
        firstInvalidHoursControl?.focus();
        showAlert(container, 'Please complete Business Hours: for each day, either enter BOTH Open & Close times or check "Closed". Or turn on "Open 24 Hours".');
        return;
      }
    }

    // All good — snapshot and move on
    state.mainFormSnapshot = snapshotFormValues(form);
    go(3);
  });
}



  // -----------------------------
  // Step 3 (final): Service Pages + Location Pages
  // -----------------------------
  function renderPagesAndLocationsStep() {
    container.innerHTML = '';

    // ===== SERVICE PAGES =====
    const svcWrap = el('div', { class: 'mb-4' });
    svcWrap.appendChild(el('h4', { class: 'mb-3' }, 'Service Pages'));
    const pagesList = el('div', { id: 'pagesList' });
    svcWrap.appendChild(pagesList);

    const addPageBtn = el('button', { type: 'button', class: 'btn btn-success me-2' }, '+ Add page');
    const svcHint = el('div', { class: 'form-text mt-2' }, 'At least one service page is required.');
    svcWrap.append(addPageBtn, svcHint);

    const addRow = (val='') => addPageRow(pagesList, val);
    if (state.pages.length) state.pages.forEach(p => addRow(p)); else addRow('');

    svcWrap.addEventListener('click', (e) => {
      if (e.target && e.target.classList.contains('btn-remove-page')) {
        e.preventDefault(); e.stopPropagation();
        e.target.closest('.page-row')?.remove();
        reindexPageRows(pagesList);
      }
    });
    addPageBtn.addEventListener('click', () => addRow(''));
    svcWrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target?.closest('#pagesList')) e.preventDefault();
    });
    container.appendChild(svcWrap);

    // ===== LOCATION PAGES =====
    const locToggleWrap = el('div', { class: 'form-check form-switch mb-2' });
    locToggleWrap.innerHTML = `
      <input class="form-check-input" type="checkbox" id="addLocations" ${state.addLocations ? 'checked' : ''}>
      <label class="form-check-label" for="addLocations">Add location pages</label>
    `;
    container.appendChild(locToggleWrap);

    const locBlock = el('div', { id: 'locationsBlock', class: 'border rounded p-3 mb-3' });
    const locList  = el('div', { id: 'locationsList', class: 'mb-2' });
    const addLocBtn = el('button', { type: 'button', class: 'btn btn-sm btn-success', id: 'addLocationBtn' }, '+ Add another location');
    const locHint = el('div', { class: 'form-text mt-2' }, 'Format: City, ST (e.g., Austin, TX). When toggle is ON, at least one location is required.');
    locBlock.append(locList, addLocBtn, locHint);
    container.appendChild(locBlock);

    const locToggle = locToggleWrap.querySelector('#addLocations');
    const ensureVisible = () => locBlock.style.display = locToggle.checked ? 'block' : 'none';
    locToggle.addEventListener('change', ensureVisible);

    const seedLocations = () => {
      locList.innerHTML = '';
      if (state.locations.length) {
        state.locations.forEach(loc => {
          if (window.addLocationInput) {
            window.addLocationInput(loc); // if helper accepts a value
          } else {
            const input = el('input', { type:'text', class:'form-control mb-2', name:'global[locationPages][]', value: loc });
            locList.appendChild(input);
          }
        });
      } else {
        if (window.addLocationInput) window.addLocationInput();
        else locList.appendChild(el('input', { type:'text', class:'form-control mb-2', name:'global[locationPages][]' }));
      }
    };
    ensureVisible(); seedLocations();

    addLocBtn.addEventListener('click', () => {
      if (window.addLocationInput) window.addLocationInput();
      else locList.appendChild(el('input', { type:'text', class:'form-control mb-2', name:'global[locationPages][]' }));
    });

    // ===== NAV (Back to Main Form, Submit) =====
    const footer = el('div', { class: 'd-flex gap-2 mt-4' });
    const backBtn = el('button', { type: 'button', class: 'btn', style: 'background:#148ec6;color:#fff;min-width:150px;font-size:18px;' }, 'Back');
    const submitBtn = el('button', { type: 'button', class: 'btn btn-success ms-auto', style: 'min-width:180px;font-size:18px;' }, 'Create Website');
    footer.append(backBtn, submitBtn);
    container.appendChild(footer);

    backBtn.addEventListener('click', () => {
      // save current edits in this step
      const pi = container.querySelectorAll('#pagesList input[type="text"]');
      state.pages = [...pi].map(i => i.value.trim()).filter(Boolean);

      const li = container.querySelectorAll('#locationsList input[name="global[locationPages][]"]');
      state.addLocations = !!locToggle.checked;
      state.locations = state.addLocations ? [...li].map(i => i.value.trim()).filter(Boolean) : [];
      go(2);
    });

    submitBtn.addEventListener('click', () => {
      // capture values
      const pi = container.querySelectorAll('#pagesList input[type="text"]');
      const pagesVals = [...pi].map(i => i.value.trim()).filter(Boolean);
      if (pagesVals.length === 0) {
        pi[0]?.classList.add('is-invalid');
        pi[0]?.focus();
        showAlert(container, 'Please add at least one service page.');
        return;
      }
      const addLoc = !!locToggle.checked;
      const li = container.querySelectorAll('#locationsList input[name="global[locationPages][]"]');
      const locVals = addLoc ? [...li].map(i => i.value.trim()).filter(Boolean) : [];
      if (addLoc && locVals.length === 0) {
        li[0]?.classList.add('is-invalid');
        li[0]?.focus();
        showAlert(container, 'Please add at least one location, or turn off “Add location pages”.');
        return;
      }
      state.pages = pagesVals;
      state.addLocations = addLoc;
      state.locations = locVals;

      // ensure logo mirrored to backend field name="global[logo]"
      if (!state.logoFile) {
        showAlert(container, 'Please choose a logo to continue.');
        go(1);
        return;
      }
      const dt = new DataTransfer();
      dt.items.add(state.logoFile);
      hiddenLogoInput.files = dt.files;

      // remove any previous mirrors
      form.querySelectorAll('.js-hidden-mirror').forEach(n => n.remove());

      // inject hidden service pages
      const hiddenPagesWrap = el('div', { class: 'js-hidden-mirror', style: 'display:none;' });
      state.pages.forEach((p, idx) => {
        hiddenPagesWrap.appendChild(el('input', { type:'hidden', name:`pages[${idx}][filename]`, value:p }));
      });
      form.appendChild(hiddenPagesWrap);

      // inject hidden location config
      const hiddenLocWrap = el('div', { class: 'js-hidden-mirror', style: 'display:none;' });
      hiddenLocWrap.appendChild(el('input', {
        type:'hidden', name:'global[addLocations]', value: state.addLocations ? 'true' : ''
      }));
      if (state.addLocations) {
        state.locations.forEach(loc => {
          hiddenLocWrap.appendChild(el('input', { type:'hidden', name:'global[locationPages][]', value: loc }));
        });
      }
      form.appendChild(hiddenLocWrap);

      // submit real form
      form.submit();
    });

    container.addEventListener('input', (ev) => {
      if (ev.target.classList?.contains('is-invalid')) ev.target.classList.remove('is-invalid');
    }, { once: true });
  }

  // -----------------------------
  // Pages section helpers (reused)
  // -----------------------------
  function reindexPageRows(container) {
    const rows = container.querySelectorAll('.page-row');
    rows.forEach((row, idx) => {
      const input = row.querySelector('input[type="text"]');
      if (input) input.name = `pages[${idx}][filename]`;
      const lab = row.querySelector('.page-label');
      if (lab) lab.textContent = `Page ${idx + 1}`;
    });
  }
  function addPageRow(container, initialValue = '') {
    const row = el('div', { class: 'row g-3 align-items-end page-row mb-2' });
    row.innerHTML = `
      <div class="col-8">
        <label class="form-label page-label">Pages</label>
        <input type="text" class="form-control" placeholder="service page" required />
      </div>
      <div class="col-4">
        <button type="button" class="btn btn-danger w-100 btn-remove-page">Delete</button>
      </div>
    `;
    container.appendChild(row);
    if (initialValue) row.querySelector('input').value = initialValue;
    reindexPageRows(container);
    row.querySelector('input')?.focus();
  }

  // -----------------------------
  // Stepper driver
  // -----------------------------
  const steps = [
    renderBusinessTypeStep,     // 0
    renderLogoStep,             // 1
    renderMainForm,             // 2
    renderPagesAndLocationsStep // 3
  ];
  let current = 0;
  function go(index) {
    if (index < 0 || index >= steps.length) return;
    current = index;
    steps[current]();
  }

  // -----------------------------
  // Bootstrap
  // -----------------------------
  document.addEventListener('DOMContentLoaded', () => {
    container = document.getElementById('dynamicFormContainer');
    form = document.getElementById('websiteForm');
    if (!container || !form) return;

    // single hidden logo input (backend expects this exact name)
    hiddenLogoInput = document.createElement('input');
    hiddenLogoInput.type = 'file';
    hiddenLogoInput.id = 'hiddenLogo';
    hiddenLogoInput.name = 'global[logo]';
    hiddenLogoInput.style.display = 'none';
    form.appendChild(hiddenLogoInput);

    // Defensive guard if someone submits outside the final step
    form.addEventListener('submit', (e) => {
      if (!state.logoFile) {
        e.preventDefault();
        go(1);
        const activeEl = state.logoType === 'square'
          ? container.querySelector('#logoSquare')
          : container.querySelector('#logoRect');
        activeEl?.classList.add('is-invalid');
        activeEl?.focus();
        showAlert(container, 'Please choose a logo to continue.');
        return;
      }
      if (state.pages.length === 0) {
        e.preventDefault();
        go(3);
        showAlert(container, 'Please add at least one service page.');
        return;
      }
      if (state.addLocations && state.locations.length === 0) {
        e.preventDefault();
        go(3);
        showAlert(container, 'Please add at least one location, or turn off “Add location pages”.');
        return;
      }
      // Mirror logo into hidden input (in case submit came from somewhere else)
      const dt = new DataTransfer();
      dt.items.add(state.logoFile);
      hiddenLogoInput.files = dt.files;
    });

    go(0);
  });
})();
