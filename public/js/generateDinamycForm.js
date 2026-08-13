// /public/js/generateDinamycForm.js
(function () {

  // CSS Design options
  const THEMES = [
    { key: 'style',  label: 'Design 1', preview: '/previews/style.png'  },
    { key: 'style2', label: 'Design 2', preview: '/previews/style2.png' },
    { key: 'style3', label: 'Design 3', preview: '/previews/style3.png' },
    { key: 'style4', label: 'Design 4', preview: '/previews/style4.png' },
    { key: 'style5', label: 'Design 5', preview: '/previews/style5.png' }
    // add more later: { key: 'style3', label: 'Style 3', preview: '/previews/style3.jpg' }, ...
  ];

  
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


  
  // Create hidden inputs for each entry in a { name: value } map
  // Fields owned by wizard state rather than by the main form.
  //
  // snapshotFormValues() captures every input in the form, including hidden
  // mirrors injected on a previous pass. Re-injecting those alongside the
  // authoritative value produced two inputs with the same name — and the
  // stale one could win, which is how picking style5 generated style.css.
  const STATE_OWNED_FIELDS = [
    'global[styleKey]',
    'global[logoType]',
    'global[businessType]',
    'global[siteMode]',
  ];

  function injectHiddenSnapshot(form, snapshot, cssClass = 'js-hidden-mainform', filterFn) {
    // wipe any previous mirrors
    form.querySelectorAll('.' + cssClass).forEach(n => n.remove());

    const wrap = document.createElement('div');
    wrap.className = cssClass;
    wrap.style.display = 'none';

    Object.entries(snapshot || {}).forEach(([name, val]) => {
      if (filterFn && !filterFn(name, val)) return;

      // For checkboxes we stored true/false. Send "true" when checked, "" when not.
      const v = typeof val === 'boolean' ? (val ? 'true' : '') : (val ?? '');
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = v;
      wrap.appendChild(input);
    });

    form.appendChild(wrap);
  }



  // Snapshot / restore non-file inputs in the main form
  // Hidden mirrors are copies of the main form injected before submit. They
  // stay in the DOM, and because they are appended AFTER the visible fields,
  // walking every input let a stale mirror overwrite a value the user had
  // just changed — which is why editing the business name or the 24-hour
  // toggle appeared to have no effect on the review step.
  function isMirror(el) {
    return !!el.closest('.js-hidden-mainform, .js-hidden-mirror')
        || el.classList.contains('js-hidden-mirror');
  }

  function snapshotFormValues(root) {
    const data = {};
    root.querySelectorAll('input, select, textarea').forEach((el) => {
      if (!el.name) return;
      if (el.type === 'file') return;
      if (isMirror(el)) return;   // never let a stale copy win
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
      if (isMirror(el)) return;   // mirrors are rebuilt on submit, not restored
      if (el.type === 'checkbox') el.checked = !!data[el.name];
      else if (el.type === 'radio') el.checked = (el.value === data[el.name]);
      else el.value = data[el.name];
    });
  }

  // -----------------------------
  // State
  // -----------------------------
  // Named so inserting a step never means renumbering call sites by hand.
  // Mirrors utils/pricing.js. The server is authoritative — it is what
  // actually takes the credits — but the review step has to show the same
  // number, so any change here needs the same change there.
  const PRICING = {
    SAMPLE: 100,
    LEAD_BASE: 200,
    SERVICE_PAGE: 100,
    LOCATION_PAGE: 100,
  };

  function quoteCredits() {
    if (state.siteMode === 'sample') return PRICING.SAMPLE;

    const services = state.pages.length;
    const locs = state.addLocations ? state.locations.length : 0;

    return PRICING.LEAD_BASE
      + services * PRICING.SERVICE_PAGE
      + locs * PRICING.LOCATION_PAGE;
  }

  const STEP = {
    MODE:   0,
    TYPE:   1,
    LOGO:   2,
    DESIGN: 3,
    MAIN:   4,
    PAGES:  5,
    REVIEW: 6,
  };

  const state = {
    // 'lead' = the full optimised site. 'sample' = a one-page design sample
    // for showing a prospective client, with no service, location or legal
    // pages and no pricing or FAQ section.
    siteMode: 'lead',
    styleKey: 'style',
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
  // Step 0: What are we building?
  // -----------------------------
  function renderSiteModeStep() {
    container.innerHTML = '';

    const card = el('div', { class: 'card p-4' });
    card.innerHTML = `
      <div class="row g-3">
        <div class="col-md-6">
          <div class="mode-card h-100 p-4 rounded border text-center ${state.siteMode === 'lead' ? 'border-success border-3' : 'border-secondary'}"
               data-mode="lead" style="cursor:pointer;">
            <h4 class="m-0">Lead Generation</h4>
          </div>
        </div>

        <div class="col-md-6">
          <div class="mode-card h-100 p-4 rounded border text-center ${state.siteMode === 'sample' ? 'border-success border-3' : 'border-secondary'}"
               data-mode="sample" style="cursor:pointer;">
            <h4 class="m-0">One-Page Design Sample</h4>
          </div>
        </div>
      </div>
    `;
    container.appendChild(card);

    card.querySelectorAll('.mode-card').forEach(box => {
      box.addEventListener('click', () => {
        state.siteMode = box.dataset.mode;
        renderSiteModeStep();   // repaint so the chosen card is highlighted
      });
    });

    renderNav(container, {
      showBack: false,
      nextText: 'Next',
      onNext: () => go(STEP.TYPE),
    });
  }

  // -----------------------------
  // Step 1: Business Type
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
              ${['Plumbing', 'Fencing', 'Painter', 'Paving', 'Swimming Pool Contractor', 'Junk Removal', 'Appliance Repair', 'Water Damage Restoration', 'Tree Removal','Electrician', 'Coding', 'Concrete Contractor', 'French Drain Installation', 'Roofing','HVAC', 'Air Conditioning','Landscaping','Law Firm', "Web Design"]
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
      // Back to the mode step: this is no longer the first screen, so the
      // user needs a way to change their mind about what they are building.
      showBack: true,
      backText: 'Back',
      onBack: () => go(STEP.MODE),
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
        go(STEP.LOGO);
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
      <h4 class="m-0"><legend class="form-label mb-2">Choose logo shape & upload</legend></h4>
      <span class="badge text-bg-primary">Business Type: ${state.businessType}</span>
    `;
    container.appendChild(header);

    const wrap = el('div', { class: 'mb-2' });
    wrap.innerHTML = `
      <fieldset class="mb-3">
        <div class="d-flex gap-3 mb-3">
          <div class="form-check">
            <input class="form-check-input" type="radio" name="logoTypeStep" id="logoTypeSquare" value="square" ${state.logoType==='square'?'checked':''}>
            <label class="form-check-label" for="logoTypeSquare">Square (recommended 250×250 px)</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="logoTypeStep" id="logoTypeRect" value="rect" ${state.logoType==='rect'?'checked':''}>
            <label class="form-check-label" for="logoTypeRect">Rectangular (recommended 260×200 px)</label>
          </div>
          <div class="form-check">
            <input class="form-check-input" type="radio" name="logoTypeStep" id="logoTypeWide" value="wide" ${state.logoType==='wide'?'checked':''}>
            <label class="form-check-label" for="logoTypeWide">Wide (recommended 500×200 px)</label>
          </div>
        </div>

        <div id="logoSquareWrap" class="mb-3">
          <input type="file" id="logoSquare" class="form-control" accept="image/*">
          <div class="form-text" id="logoSquareHint"></div>
        </div>

        <div id="logoRectWrap" class="mb-3">
          <input type="file" id="logoRect" class="form-control" accept="image/*">
          <div class="form-text" id="logoRectHint"></div>
        </div>

        <div id="logoWideWrap" class="mb-3">
          <input type="file" id="logoWide" class="form-control" accept="image/*">
          <div class="form-text" id="logoWideHint"></div>
        </div>

        <div id="logoPreview" class="mt-3" style="display:none;">
          <div class="form-text mb-1"><strong></strong> <span id="logoFileName"></span></div>
          <img id="logoImgPreview" alt="Logo preview" style="max-height:120px; max-width:260px; display:block;">
        </div>
      </fieldset>
    `;
    container.appendChild(wrap);

    const radios = container.querySelectorAll('input[name="logoTypeStep"]');
    radios.forEach(r => r.addEventListener('change', () => applyLogoTypeForStep(container, r.value)));

    // Wrapper + file input for each logo shape, so adding a shape means
    // adding one entry rather than another branch.
    const LOGO_SHAPES = {
      square: { wrap: '#logoSquareWrap', input: '#logoSquare' },
      rect:   { wrap: '#logoRectWrap',   input: '#logoRect'   },
      wide:   { wrap: '#logoWideWrap',   input: '#logoWide'   },
    };

    function applyLogoTypeForStep(container, type) {
      if (!LOGO_SHAPES[type]) type = 'square';
      state.logoType = type;

      Object.entries(LOGO_SHAPES).forEach(([shape, sel]) => {
        const wrap = container.querySelector(sel.wrap);
        if (wrap) wrap.style.display = shape === type ? '' : 'none';
        container.querySelector(sel.input)?.classList.remove('is-invalid');
      });
    }
    applyLogoTypeForStep(container, state.logoType);

    const squareInput = container.querySelector('#logoSquare');
    const rectInput   = container.querySelector('#logoRect');
    const wideInput   = container.querySelector('#logoWide');
    const squareHint  = container.querySelector('#logoSquareHint');
    const rectHint    = container.querySelector('#logoRectHint');
    const wideHint    = container.querySelector('#logoWideHint');
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
        // advisoryImageNote(f, 250, 250, squareHint);
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
        //advisoryImageNote(f, 260, 200, rectHint);
        rectInput.classList.remove('is-invalid');
        squareInput?.classList.remove('is-invalid');
      } else { rectHint && (rectHint.textContent = ''); }
    });

        wideInput?.addEventListener('change', e => {
      const f = e.target.files?.[0];
      if (f) {
        state.logoType = 'wide';
        state.logoFile = f;
        if (state.logoPreviewURL) URL.revokeObjectURL(state.logoPreviewURL);
        state.logoPreviewURL = URL.createObjectURL(f);
        previewWrap.style.display = 'block';
        previewImg.src = state.logoPreviewURL;
        previewName.textContent = f.name || '(selected)';
        //advisoryImageNote(f, 260, 200, wideHint);
        rectInput.classList.remove('is-invalid');
        squareInput?.classList.remove('is-invalid');
      } else { wideHint && (wideHint.textContent = ''); }
    });

    renderNav(container, {
      showBack: true,
      nextText: 'Continue',
      onBack: () => go(STEP.TYPE),
      onNext: () => {
        const activeEl = state.logoType === 'square' ? squareInput
                       : state.logoType === 'wide'   ? wideInput
                       : rectInput;
        const file = activeEl?.files?.[0];
        if (!file) {
          activeEl?.classList.add('is-invalid');
          activeEl?.focus();
          showAlert(container, 'Please choose a logo to continue.');
          return;
        }
        state.logoFile = file;
        go(STEP.DESIGN);
      }
    });
  }

  // -----------------------------
  // Step 2: Main Form Theme/Design
  // THEMES already carries a human label ("Design 1"); use it rather than
  // showing the internal filename.
  function logoShapeLabel(key) {
    return ({ square: 'Square', rect: 'Rectangular', wide: 'Wide' })[key] || key || '';
  }

  function themeLabel(key) {
    const theme = THEMES.find(t => t.key === key);
    return theme ? theme.label : key;
  }

  // -----------------------------
  // Duplicate detection
  // -----------------------------
  // Compares case-insensitively and ignores surrounding/repeated whitespace,
  // because "Austin, TX" and "austin,  tx" both end up as the same slug and
  // would otherwise generate two pages writing to one file.
  function normaliseForCompare(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function findDuplicates(inputs) {
    const seen = new Map();      // normalised -> first input seen
    const dupes = [];            // inputs that repeat an earlier value
    const labels = new Set();

    inputs.forEach(input => {
      const key = normaliseForCompare(input.value);
      if (!key) return;
      if (seen.has(key)) {
        dupes.push(input);
        labels.add(input.value.trim());
        if (!seen.get(key).classList.contains('is-invalid')) {
          dupes.push(seen.get(key));   // highlight the original too
        }
      } else {
        seen.set(key, input);
      }
    });

    return { dupes, labels: [...labels] };
  }

  // -----------------------------
  // Context badges
  // -----------------------------
  // Shown on every step after the main form so the user can see what they are
  // building without going back. Values come from the step-3 snapshot, since
  // the main form fields are not in the DOM on later steps.
  function snapshotValue(key) {
    const snap = state.mainFormSnapshot;
    if (!snap) return '';
    const v = snap[`global[${key}]`];
    return (v === undefined || v === null) ? '' : String(v).trim();
  }

  function contextBadges(extra = []) {
    const businessName = snapshotValue('businessName');
    const location     = snapshotValue('location');

    // Deliberately just these four. Logo filename and domain added noise
    // without helping anyone decide what to type next; the review step
    // shows the full picture.
    const badges = [];
    if (businessName) badges.push(['text-bg-light text-dark', `Business: ${businessName}`]);
    if (state.businessType) badges.push(['text-bg-primary', `Type: ${state.businessType}`]);
    if (location) badges.push(['text-bg-success', `Location: ${location}`]);
    badges.push(['text-bg-info', themeLabel(state.styleKey)]);

    extra.forEach(b => badges.push(b));

    return badges
      .map(([cls, text]) => `<span class="badge ${cls}">${escapeHtml(text)}</span>`)
      .join('');
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, c => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  // -----------------------------
  function renderMainForm() {
    container.innerHTML = '';

    const header = el('div', { class: 'd-flex align-items-center justify-content-between mb-3' });
    header.innerHTML = `
      <h4 class="m-0">1. Global Information</h4>
      <div class="d-flex flex-wrap gap-2">${contextBadges()}</div>
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

        <!-- Owner / founder name. A design sample is not a real business
             page, so an invented owner would be noise. -->
        <div class="mb-3" ${state.siteMode === 'sample' ? 'style="display:none;"' : ''}>
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="includeOwner" name="global[includeOwner]">
            <label class="form-check-label" for="includeOwner">
              Include an owner or founder name on the About page
            </label>
          </div>

          <div id="ownerNameWrap" class="mt-2" style="display:none;">
            <input type="text" name="global[ownerName]" class="form-control"
                   placeholder="e.g. Marcus Delgado">
            <div class="form-text">
              Leave blank and we'll create a name that suits the area.
            </div>
          </div>
        </div>

        <!-- Main Location-->
        <div class="mb-3">
          <label class="form-label">Main Location</label>
          <input type="text" name="global[location]" class="form-control" required />
        </div>


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


         <!-- Google Map CID. Feeds the LocalBusiness schema, so it has no
              purpose in a design sample. -->
        <div class="mb-3 mt-3" ${state.siteMode === 'sample' ? 'style="display:none;"' : ''}>
          <label class="form-label" for="googleMapCid">Google Map CID</label>
        <input type="text"
                id="googleMapCid"
                name="global[googleMapCid]"
                class="form-control"
                placeholder="e.g. 12345678901234567890" />
        <div class="form-text">
          Optional. Paste the Google Business CID if you have it.
        </div>
        </div>

        <hr>

        <div class="form-check mt-2">
          <input class="form-check-input" type="checkbox" id="showAboutForm" name="global[showAboutForm]" checked>
          <label class="form-check-label" for="showAboutForm">
            Include contact form on About page
          </label>
        </div>

        <hr>

        <!-- Near Me. Hidden for design samples, and unchecked so the
             near-me section is not generated at all. -->
        <div class="form-check" ${state.siteMode === 'sample' ? 'style="display:none;"' : ''}>
          <input class="form-check-input" type="checkbox" id="useNearMe" name="global[useNearMe]" value="true"
                 ${state.siteMode === 'sample' ? '' : 'checked'}>
          <label class="form-check-label" for="useNearMe">
            Check to optimize About Us page with "Near Me" term
          </label>
        </div>

        <hr>


        <!-- Business Hours-->
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

        <hr>

        <div class="mb-3">
          <label for="youtubeVideoUrl" class="form-label">
            Provide a YouTube video URL (optional)
          </label>
          <input
            type="url"
            class="form-control"
            id="youtubeVideoUrl"
            name="global[youtubeVideoUrl]"
            placeholder="https://www.youtube.com/watch?v=XXXXXXXXXXX"
          >
          <div class="form-text">
            Paste a full YouTube link. This video will show on the About / Home page.
          </div>
        </div>



      </div>
    `;
    container.appendChild(block);

    // Footer: Back/Next (Next validates)
    const footer = el('div', { class: 'd-flex gap-2 mt-4' });
    const backBtn = el('button', { type: 'button', class: 'btn', style: 'background:#148ec6;color:#fff;min-width:150px;font-size:18px;' }, 'Back');
    const resetBtn = el('button', { type: 'button', class: 'btn btn-warning', style: 'min-width:150px;font-size:18px;margin-left:20px' }, 'Start Over');

    const nextBtn = el('button', { type: 'button', class: 'btn btn-success ms-auto', style: 'min-width:150px;font-size:18px;' }, 'Continue');
    footer.append(backBtn, resetBtn, nextBtn);
    container.appendChild(footer);
    resetBtn.addEventListener('click', startOver);

    // Drop any mirrors left over from a previous pass through the wizard.
    // They are rebuilt from state when the user moves forward again.
    form.querySelectorAll('.js-hidden-mainform, .js-hidden-mirror').forEach(n => n.remove());

    // Restore any previously typed main-form values
    restoreFormValues(form, state.mainFormSnapshot);

    // Hours hookup (from hoursOfOperation.js)
    if (window.attachHours) window.attachHours();

    // Owner name field: only shown when the box is ticked. Runs after
    // restoreFormValues so a previously ticked box reopens with its value.
    const ownerToggle = container.querySelector('#includeOwner');
    const ownerWrap   = container.querySelector('#ownerNameWrap');

    if (ownerToggle && ownerWrap) {
      const syncOwner = () => {
        ownerWrap.style.display = ownerToggle.checked ? '' : 'none';
      };
      syncOwner();
      ownerToggle.addEventListener('change', syncOwner);
    }

    // Remove red outline when user fixes input (text/time/checkbox)
    container.addEventListener('input', (ev) => {
      if (ev.target.classList?.contains('is-invalid')) ev.target.classList.remove('is-invalid');
    });
    container.addEventListener('change', (ev) => {
      if (ev.target.classList?.contains('is-invalid')) ev.target.classList.remove('is-invalid');
    });

    backBtn.addEventListener('click', () => {
      state.mainFormSnapshot = snapshotFormValues(form);
      go(STEP.DESIGN);
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
      go(STEP.PAGES);
    });
  }



  // -----------------------------
  // Step 3 : Service Pages + Location Pages
  // -----------------------------
  function renderPagesAndLocationsStep() {
    container.innerHTML = '';

    const header = el('div', { class: 'mb-3' });
    header.innerHTML = `
      <h4 class="mb-2">Service Pages</h4>
      <div class="d-flex flex-wrap gap-2">${contextBadges()}</div>
    `;
    container.appendChild(header);

    // ===== SERVICE PAGES =====
    const svcWrap = el('div', { class: 'mb-4' });
    const pagesList = el('div', { id: 'pagesList' });
    svcWrap.appendChild(pagesList);

    const addPageBtn = el('button', { type: 'button', class: 'btn btn-success me-2' }, '+ Add page');
    const svcHint = el('div', { class: 'form-text mt-2' }, 'At least one service page is required.');
    svcWrap.append(addPageBtn, svcHint);
    const hr = el('hr');
    svcWrap.append(hr);

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
      <input class="form-check-input" type="checkbox"
       id="addLocations"
       name="global[addLocations]"
       value="true"
       ${state.addLocations ? 'checked' : ''}>

      <label class="form-check-label" for="addLocations"><h4>Add location pages</h4></label>
    `;
    container.appendChild(locToggleWrap);

    const locBlock = el('div', { id: 'locationsBlock', class: ' p-3 mb-3' });
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


    // ===== NAV (Back to Main Form, Submit) =====
    const footer = el('div', { class: 'd-flex gap-2 mt-4' });
    const backBtn = el('button', { type: 'button', class: 'btn', style: 'background:#148ec6;color:#fff;min-width:150px;font-size:18px;' }, 'Back');
    const resetBtn = el('button', { type: 'button', class: 'btn btn-warning', style: 'min-width:150px;font-size:18px;margin-left:20px;' }, 'Start Over');
    const submitBtn = el('button', { type: 'button', class: 'btn btn-success ms-auto btn-submit', style: 'min-width:180px;font-size:18px;' }, 'Review →');
    footer.append(backBtn, resetBtn, submitBtn);
    container.appendChild(footer);

    // Clean and start over
    resetBtn.addEventListener('click', startOver);



    backBtn.addEventListener('click', () => {
      // save current edits in this step
      const pi = container.querySelectorAll('#pagesList input[type="text"]');
      state.pages = [...pi].map(i => i.value.trim()).filter(Boolean);

      const li = container.querySelectorAll('#locationsList input[name="global[locationPages][]"]');
      state.addLocations = !!locToggle.checked;
      state.locations = state.addLocations ? [...li].map(i => i.value.trim()).filter(Boolean) : [];
      go(STEP.MAIN);
    });

    submitBtn.addEventListener('click', () => {
      // capture values
      const pi = container.querySelectorAll('#pagesList input[type="text"]');
      const pagesVals = [...pi].map(i => i.value.trim()).filter(Boolean);

      // Duplicate service pages would overwrite each other's HTML file
      const pageDupes = findDuplicates([...pi]);
      if (pageDupes.dupes.length) {
        [...pi].forEach(i => i.classList.remove('is-invalid'));
        pageDupes.dupes.forEach(i => i.classList.add('is-invalid'));
        pageDupes.dupes[0]?.focus();
        showAlert(container, `Duplicate service page: ${pageDupes.labels.join(', ')}. Each page needs a different name.`);
        return false;
      }

      if (pagesVals.length === 0) {
        pi[0]?.classList.add('is-invalid');
        pi[0]?.focus();
        showAlert(container, 'Please add at least one service page.');
        return;
      }
      const addLoc = !!locToggle.checked;
      const li = container.querySelectorAll('#locationsList input[name="global[locationPages][]"]');
      const locVals = addLoc ? [...li].map(i => i.value.trim()).filter(Boolean) : [];

      // Duplicate cities would produce two location pages with one filename
      if (addLoc) {
        const locDupes = findDuplicates([...li]);
        if (locDupes.dupes.length) {
          [...li].forEach(i => i.classList.remove('is-invalid'));
          locDupes.dupes.forEach(i => i.classList.add('is-invalid'));
          locDupes.dupes[0]?.focus();
          showAlert(container, `Duplicate location: ${locDupes.labels.join(', ')}. Each location needs a different city.`);
          return false;
        }
      }

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
        go(STEP.LOGO);
        return;
      }
      // ===== ensure logo mirrored to backend field name="global[logo]" =====
      const dt2 = new DataTransfer();
      dt2.items.add(state.logoFile);
      hiddenLogoInput.files = dt2.files;

      // ===== inject hidden inputs for pages/locations (your existing code) =====
      // Clean any old mirrors (defense)
      // Rebuild hidden mirrors every submit (clean first)
      form.querySelectorAll('.js-hidden-mirror, .js-hidden-mainform').forEach(n => n.remove());

      // Only inject pages if page inputs are NOT currently in the DOM (prevents duplicates)
      const hasPageInputsInDom = !!form.querySelector('#pagesList input[name^="pages["]');
      if (!hasPageInputsInDom) {
        const hiddenPagesWrap = el('div', { class: 'js-hidden-mirror', style: 'display:none;' });
        state.pages.forEach((p, idx) => {
          hiddenPagesWrap.appendChild(el('input', { type:'hidden', name:`pages[${idx}][filename]`, value:p }));
        });
        form.appendChild(hiddenPagesWrap);
      }

      // Only inject locations if they are NOT currently in the DOM (prevents duplicates)
      const hasLocationInputsInDom = !!form.querySelector('#locationsList input[name="global[locationPages][]"]');
      if (!hasLocationInputsInDom) {
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
      }

      // Inject hidden inputs for the ENTIRE main form (includes hours!), but
      // if 24h is ON, drop per-day hour keys to avoid backend confusion.
      const is24 =
        state.mainFormSnapshot?.['global[is24Hours]'] === true ||
        state.mainFormSnapshot?.['global[is24Hours]'] === 'true';

      injectHiddenSnapshot(
        form,
        state.mainFormSnapshot,
        'js-hidden-mainform',
        (name) => {
          if (STATE_OWNED_FIELDS.includes(name)) return false;
          if (is24 && name.startsWith('global[hours][')) return false;
          return true;
        }
      );



      // === Inject logoType hidden field ===
      let logoTypeHidden = form.querySelector('input[name="global[logoType]"]');
      if (!logoTypeHidden) {
        logoTypeHidden = document.createElement('input');
        logoTypeHidden.type = 'hidden';
        logoTypeHidden.name = 'global[logoType]';
        logoTypeHidden.classList.add('js-hidden-mirror', 'js-hidden-logo-shape'); // so startOver() cleans it
        form.appendChild(logoTypeHidden);
      }

      logoTypeHidden.value = state.logoType; // "square" | "rect" | "wide"

      // === Inject styleKey here too ===
      // The submit handler also sets this, but injecting it now means the
      // review step reflects exactly what will be posted.
      form.querySelectorAll('input[name="global[styleKey]"]').forEach(n => n.remove());
      // Site mode: lead generation or design sample. Decides what the server
      // builds, so it travels with the other state-owned fields.
      form.querySelectorAll('input[name="global[siteMode]"]').forEach(n => n.remove());
      const siteModeEarly = document.createElement('input');
      siteModeEarly.type = 'hidden';
      siteModeEarly.name = 'global[siteMode]';
      siteModeEarly.classList.add('js-hidden-mirror');
      siteModeEarly.value = state.siteMode;
      form.appendChild(siteModeEarly);

      // Business type too, so the review step reflects what will be posted
      form.querySelectorAll('input[name="global[businessType]"]').forEach(n => n.remove());
      const businessTypeEarly = document.createElement('input');
      businessTypeEarly.type = 'hidden';
      businessTypeEarly.name = 'global[businessType]';
      businessTypeEarly.classList.add('js-hidden-mirror');
      businessTypeEarly.value = state.businessType;
      form.appendChild(businessTypeEarly);

      const styleKeyEarly = document.createElement('input');
      styleKeyEarly.type = 'hidden';
      styleKeyEarly.name = 'global[styleKey]';
      styleKeyEarly.classList.add('js-hidden-mirror');
      styleKeyEarly.value = state.styleKey;
      form.appendChild(styleKeyEarly);



      // 🔎 DEBUG: inspect exactly what will be sent
      const dbg = new FormData(form);
      for (const [k, v] of dbg.entries()) {
        console.log(k, v instanceof File ? `(File: ${v.name})` : v);
      }



      // Hidden fields are now in place. Show the review step rather than
      // submitting straight away — generating costs credits, so this is the
      // last chance to catch a typo.
      go(STEP.REVIEW);
    });

    container.addEventListener('input', (ev) => {
      if (ev.target.classList?.contains('is-invalid')) ev.target.classList.remove('is-invalid');
    }, { once: true });
  }


  // Step 4: Design and Theme Selection

  function renderDesignStep() {
    container.innerHTML = '';

    // No badge row here: the review step already summarises everything.
    const h = el('h3', {}, 'Design & Theme');
    const desc = el('p', {}, 'Pick a design. You can preview each one.');
    container.append(h, desc);
  
    const list = el('div', { class: 'row g-3' });
    THEMES.forEach(({ key, label, preview }) => {
      const col = el('div', { class: 'col-12' });
      col.innerHTML = `
        <div class="border rounded p-3 d-flex align-items-center justify-content-between" style="background:#0b3f7a33;">
          <div class="form-check">
            <input class="form-check-input" type="radio" name="global[styleKey]" id="theme-${key}" value="${key}" ${state.styleKey === key ? 'checked' : ''} required>
            <label class="form-check-label" for="theme-${key}">
              ${label}
            </label>
          </div>
          <div class="d-flex gap-2">
            <a class="btn btn-outline-light btn-sm" href="${preview}" target="_blank" rel="noopener">Preview</a>
          </div>
        </div>
      `;
      list.appendChild(col);
    });
    container.appendChild(list);
  
    const nav = renderNav(container, {
      showBack: true,
      backText: 'Back',
      nextText: 'Next',
      onBack: () => { go(STEP.LOGO); },
      onNext: () => {
        // update state from currently checked radio
        const picked = container.querySelector('input[name="global[styleKey]"]:checked');
        state.styleKey = picked ? picked.value : state.styleKey;
        go(STEP.MAIN); // go to Main Form step
      }
    });
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
    const row = el('div', { class: 'row g-2 align-items-end page-row mb-2' });
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

  // -----------------------------
  // Step 6: Review before generating
  // -----------------------------
  // Generation costs credits and takes a minute, so this is the last chance
  // to catch a typo. Every group links back to the step that owns it.
  const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];

  function reviewRow(label, value, opts = {}) {
    const shown = (value === undefined || value === null || String(value).trim() === '')
      ? '<span class="text-warning">— not set —</span>'
      : escapeHtml(String(value));

    // A card's Edit button goes to one step, but a card can hold fields from
    // several. Business Type is chosen on step 1 while the rest of the
    // Business card comes from step 3, so that row carries its own link.
    // Kept for rows whose owning step differs from their card's.
    const editLink = (opts.editStep === undefined)
      ? ''
      : ` <button type="button" class="btn btn-link btn-sm p-0 ms-2 align-baseline js-review-edit text-white"
                 data-step="${opts.editStep}">change</button>`;

    return `
      <div class="d-flex justify-content-between gap-3 py-1"
           style="border-bottom:1px solid rgba(255,255,255,.35);">
        <span class="flex-shrink-0" style="color:rgba(255,255,255,.85);">${escapeHtml(label)}</span>
        <span class="text-white text-end${opts.strong ? ' fw-bold' : ''}"
              style="min-width:0;overflow-wrap:anywhere;word-break:break-word;">${shown}${editLink}</span>
      </div>`;
  }

  // Card colours. Kept as constants so they can be changed in one place
  // rather than hunting through the markup.
  // #17801a rather than a brighter green: white body text on it clears
  // WCAG AA (5.07:1), where #1a8a1a came in just under at 4.47:1.
  const CARD_BG = '#378239';       // green card background
  const CARD_BORDER = '#2a6b2c';   // slightly darker edge
  const EDIT_BG = '#082d5b';       // Edit button, matching the site header

  function reviewCard(title, bodyHtml, editStep) {
    return `
      <div class="col-12">
        <div class="rounded p-3 h-100 text-white"
             style="background:${CARD_BG};border:2px solid ${CARD_BORDER};">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h5 class="m-0">${escapeHtml(title)}</h5>
            <button type="button" class="btn btn-sm js-review-edit text-white"
                    data-step="${editStep}"
                    style="background:${EDIT_BG};border:1px solid rgba(255,255,255,.35);">Edit</button>
          </div>
          ${bodyHtml}
        </div>
      </div>`;
  }

  // The owner row reads differently in three cases: not included, included
  // with a name, included and left to the AI.
  function ownerSummary() {
    const snap = state.mainFormSnapshot || {};
    const include = snap['global[includeOwner]'];
    const on = include === true || include === 'true' || include === 'on' || include === '1';

    if (!on) return 'Not included';

    const name = snapshotValue('ownerName');
    return name || 'We\'ll create one';
  }

  function hoursSummary() {
    const is24 = String(snapshotValue('is24Hours')).toLowerCase();
    if (is24 === 'true' || is24 === 'on' || is24 === '1') {
      return reviewRow('Hours', 'Open 24 hours');
    }

    const snap = state.mainFormSnapshot || {};
    const rows = DAYS.map(day => {
      const closed = snap[`global[hours][${day}][closed]`];
      const isClosed = closed === true || closed === 'true' || closed === 'on' || closed === '1';
      if (isClosed) return reviewRow(day[0].toUpperCase() + day.slice(1), 'Closed');
      const open  = snap[`global[hours][${day}][open]`]  || '';
      const close = snap[`global[hours][${day}][close]`] || '';
      return reviewRow(day[0].toUpperCase() + day.slice(1), open && close ? `${open} – ${close}` : '');
    });
    return rows.join('');
  }

  function socialSummary() {
    const socials = [
      ['Facebook','facebookUrl'], ['Instagram','instagramUrl'], ['Twitter/X','twitterUrl'],
      ['LinkedIn','linkedinUrl'], ['YouTube','youtubeUrl'], ['Pinterest','pinterestUrl'],
    ];
    const set = socials.filter(([, key]) => snapshotValue(key));
    if (!set.length) {
      return '<p class="text-white-50 m-0">No social links added.</p>';
    }
    return set.map(([label, key]) => reviewRow(label, snapshotValue(key))).join('');
  }

  function listSummary(items, emptyText) {
    if (!items.length) return `<p class="text-white-50 m-0">${escapeHtml(emptyText)}</p>`;
    return '<ol class="mb-0 ps-3 text-white">' +
      items.map(i => `<li>${escapeHtml(i)}</li>`).join('') +
      '</ol>';
  }

  function renderReviewStep() {
    container.innerHTML = '';

    const pages = state.pages || [];
    const locations = state.addLocations ? (state.locations || []) : [];
    const credits = quoteCredits();

    const header = el('div', { class: 'mb-3' });
    header.innerHTML = `
      <h3 class="mb-2">Review &amp; Generate</h3>
      <p class="text-white-50 mb-1">
        Check everything below before generating.
      </p>
      <p class="text-white-50 mb-0">
        This will use <strong>${credits.toLocaleString()}</strong> credits.
      </p>
    `;
    container.appendChild(header);

    const grid = el('div', { class: 'row g-3' });

    // Cards follow the wizard's own order, so reviewing walks back through
    // the same sequence the user just completed:
    //   0 business type -> 1 logo -> 2 design -> 3 details -> 4 pages
    grid.innerHTML = [
      reviewCard('What we are building', [
        reviewRow('Type',
          state.siteMode === 'sample' ? 'Design Sample (one page)' : 'Lead Generation Website',
          { strong: true, editStep: STEP.MODE }),
      ].join(''), STEP.MODE),

      reviewCard('Business Type', [
        reviewRow('Category', state.businessType, { strong: true }),
      ].join(''), STEP.TYPE),

      reviewCard('Logo', [
        reviewRow('Shape', logoShapeLabel(state.logoType)),
        reviewRow('File', state.logoFile ? (state.logoFile.name || 'selected') : ''),
      ].join('') + (state.logoPreviewURL
        ? `<img src="${state.logoPreviewURL}" alt="Logo preview" class="mt-3"
               style="max-height:80px;max-width:200px;background:#fff;padding:6px;border-radius:6px;">`
        : ''), STEP.LOGO),

      reviewCard('Design', [
        reviewRow('Selected', themeLabel(state.styleKey), { strong: true }),
      ].join(''), STEP.DESIGN),

      reviewCard('Business Details', [
        reviewRow('Name', snapshotValue('businessName'), { strong: true }),
        reviewRow('Domain', snapshotValue('domain')),
        reviewRow('Location', snapshotValue('location')),
        reviewRow('Address', snapshotValue('address')),
        ...(state.siteMode === 'sample' ? [] : [reviewRow('Owner name', ownerSummary())]),
      ].join(''), STEP.MAIN),

      reviewCard('Contact', [
        reviewRow('Phone', snapshotValue('phone')),
        reviewRow('Email', snapshotValue('email')),
        reviewRow('Map CID', snapshotValue('googleMapCid')),
        reviewRow('Intro video', snapshotValue('youtubeVideoUrl')),
      ].join(''), STEP.MAIN),

      reviewCard('Hours', hoursSummary(), STEP.MAIN),

      reviewCard('Social links', socialSummary(), STEP.MAIN),

      // Pages last: they are what the credit cost is based on, so they sit
      // closest to the Generate button.
      reviewCard(`Service pages (${pages.length})`,
        listSummary(pages, 'No service pages added.'), STEP.PAGES),

      reviewCard(`Location pages (${locations.length})`,
        listSummary(locations, state.addLocations ? 'No locations added.' : 'Location pages are turned off.'), STEP.PAGES),
    ].join('');
    container.appendChild(grid);

    // Edit buttons jump back to the owning step
    grid.querySelectorAll('.js-review-edit').forEach(btn => {
      btn.addEventListener('click', () => go(Number(btn.dataset.step)));
    });

    renderNav(container, {
      showBack: true,
      backText: 'Back',
      nextText: `Generate ${state.siteMode === 'sample' ? 'Sample' : 'Website'} (${credits.toLocaleString()} credits)`,
      onBack: () => go(STEP.PAGES),
      onNext: () => {
        // Hidden fields were injected on the previous step, so this only
        // needs to fire the submit that spinner.js listens for.
        if (typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        } else {
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        }
      }
    });
  }

  const steps = [
    renderSiteModeStep,          // 0  lead generation or design sample
    renderBusinessTypeStep,      // 1
    renderLogoStep,              // 2
    renderDesignStep,            // 3
    renderMainForm,              // 4
    renderPagesAndLocationsStep, // 5
    renderReviewStep             // 6
  ];
  let current = 0;
  function go(index) {
    if (index < 0 || index >= steps.length) return;
    current = index;
    steps[current]();
  }


  // Start Over (cleaner)
  // Reset everything and go back to the first step
  function startOver() {
  // 1) Remove any hidden mirrors that could leak stale values on submit
  //    (you create .js-hidden-mirror and .js-hidden-mainform before submitting)
  try {
    form?.querySelectorAll('.js-hidden-mirror, .js-hidden-mainform').forEach(n => n.remove());
  } catch {}

  // 2) Clear validation UI + inline alerts + top alert
  try {
    document.getElementById('formAlert')?.classList.add('d-none');
    container?.querySelectorAll('.is-invalid').forEach(n => n.classList.remove('is-invalid'));
    container?.querySelectorAll('.js-inline-alert')?.forEach(n => n.remove());
  } catch {}

  // 3) Reset the <form> fields that might currently exist in the DOM
  //    (this also clears text inputs like pages/locations if they’re visible)
  try { form?.reset(); } catch {}

  // 4) Reset logo state & UI (both visible inputs and the hidden file sent to backend)
  try {
    if (state.logoPreviewURL) {
      try { URL.revokeObjectURL(state.logoPreviewURL); } catch {}
    }
    state.logoPreviewURL = '';
    state.logoFile = null;
    state.logoType = 'square';

    // Clear visible file inputs if they’re present in the current step
    const square = container?.querySelector('#logoSquare');
    const rect   = container?.querySelector('#logoRect');
    if (square) square.value = '';
    if (rect)   rect.value   = '';

    // Hide/reset the preview UI if it exists
    const previewWrap = container?.querySelector('#logoPreview');
    const previewImg  = container?.querySelector('#logoImgPreview');
    const previewName = container?.querySelector('#logoFileName');
    if (previewWrap) previewWrap.style.display = 'none';
    if (previewImg)  previewImg.src = '';
    if (previewName) previewName.textContent = '';
    
    // Clear the hidden file input used at submit time
    if (hiddenLogoInput) hiddenLogoInput.value = '';
  } catch {}

  // 5) Reset wizard “brain” (your in-memory state)
  state.siteMode          = 'lead';
  state.businessType      = '';
  state.mainFormSnapshot  = null;  // wipes hours, near-me, CID, etc.
  state.pages             = [];
  state.locations         = [];
  state.addLocations      = true;
  state.styleKey = 'style';


  // 6) Jump back to the first step (Business Type)
  go(STEP.MODE);
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
      // Guard: must have a logo
      if (!state.logoFile) {
        e.preventDefault();
        e.stopImmediatePropagation(); // stop spinner.js submitting anyway
        go(STEP.LOGO);
        const activeEl = state.logoType === 'square' ? container.querySelector('#logoSquare')
                       : state.logoType === 'wide'   ? container.querySelector('#logoWide')
                       : container.querySelector('#logoRect');
        activeEl?.classList.add('is-invalid');
        activeEl?.focus();
        showAlert(container, 'Please choose a logo to continue.');
        return;
      }
    
      // ---- DOM-FIRST VALUES (avoid stale state) ----
      //
      // On the review step the pages/locations inputs are no longer rendered —
      // container was cleared — so only the injected hidden mirrors remain.
      // Reading just the visible inputs made this guard think there were zero
      // service pages and refuse to submit.
      const readValues = (visibleSelector, hiddenSelector, fallback) => {
        const visible = [...form.querySelectorAll(visibleSelector)]
          .map(i => i.value.trim()).filter(Boolean);
        if (visible.length) return visible;

        const hidden = [...form.querySelectorAll(hiddenSelector)]
          .map(i => i.value.trim()).filter(Boolean);
        if (hidden.length) return hidden;

        return (fallback || []).map(v => String(v).trim()).filter(Boolean);
      };

      const pageInputsDom = form.querySelectorAll(
        '#pagesList input[name^="pages"][name$="[filename]"]:not([type="hidden"])'
      );
      const pagesVals = readValues(
        '#pagesList input[name^="pages"][name$="[filename]"]:not([type="hidden"])',
        'input[type="hidden"][name^="pages"][name$="[filename]"]',
        state.pages
      );

      const hasLocToggle = !!form.querySelector('#addLocations');
      const addLoc = hasLocToggle ? form.querySelector('#addLocations').checked : !!state.addLocations;

      const locInputsDom = form.querySelectorAll(
        '#locationsList input[name="global[locationPages][]"]:not([type="hidden"])'
      );
      const locVals = addLoc
        ? readValues(
            '#locationsList input[name="global[locationPages][]"]:not([type="hidden"])',
            'input[type="hidden"][name="global[locationPages][]"]',
            state.locations
          )
        : [];
    
      // Guard: must have ≥1 service page
      if (pagesVals.length === 0) {
        e.preventDefault();
        e.stopImmediatePropagation(); // stop spinner.js submitting anyway
        go(STEP.PAGES);
        // highlight first page input if it's on screen
        pageInputsDom[0]?.classList.add('is-invalid');
        pageInputsDom[0]?.focus();
        showAlert(container, 'Please add at least one service page.');
        return;
      }

      // Guard: no duplicate service pages or locations. Two entries that
      // slugify the same would write to one file and overwrite each other.
      const submitPageDupes = findDuplicates([...pageInputsDom]);
      if (submitPageDupes.dupes.length) {
        e.preventDefault();
        e.stopImmediatePropagation(); // stop spinner.js submitting anyway
        go(STEP.PAGES);
        [...pageInputsDom].forEach(i => i.classList.remove('is-invalid'));
        submitPageDupes.dupes.forEach(i => i.classList.add('is-invalid'));
        submitPageDupes.dupes[0]?.focus();
        showAlert(container, `Duplicate service page: ${submitPageDupes.labels.join(', ')}. Each page needs a different name.`);
        return;
      }

      if (addLoc) {
        const submitLocDupes = findDuplicates([...locInputsDom]);
        if (submitLocDupes.dupes.length) {
          e.preventDefault();
          e.stopImmediatePropagation(); // stop spinner.js submitting anyway
          go(STEP.PAGES);
          [...locInputsDom].forEach(i => i.classList.remove('is-invalid'));
          submitLocDupes.dupes.forEach(i => i.classList.add('is-invalid'));
          submitLocDupes.dupes[0]?.focus();
          showAlert(container, `Duplicate location: ${submitLocDupes.labels.join(', ')}. Each location needs a different city.`);
          return;
        }
      }
    
      // Guard: if locations are ON, must have ≥1 location
      if (addLoc && locVals.length === 0) {
        e.preventDefault();
        e.stopImmediatePropagation(); // stop spinner.js submitting anyway
        go(STEP.PAGES);
        // highlight first location input if it's on screen
        locInputsDom[0]?.classList.add('is-invalid');
        locInputsDom[0]?.focus();
        showAlert(container, 'Please add at least one location, or turn off “Add location pages”.');
        return;
      }
    
      // Keep state in sync (useful if submit came from Enter key)
      state.pages = pagesVals;
      state.addLocations = addLoc;
      state.locations = locVals;
    
      // Mirror logo into the hidden input the backend expects
      const dt = new DataTransfer();
      dt.items.add(state.logoFile);
      hiddenLogoInput.files = dt.files;
    
      // Ensure we have the latest snapshot of the Main Form (includes hours)
      if (!state.mainFormSnapshot) {
        state.mainFormSnapshot = snapshotFormValues(form);
      }
    
      // Clean previous mirrors
      form.querySelectorAll('.js-hidden-mirror, .js-hidden-mainform').forEach(n => n.remove());


      // === Inject logoType hidden field (safety for Enter/other submits) ===
       
      // Same treatment as styleKey: one authoritative value, no stale mirrors
      form.querySelectorAll('input[name="global[logoType]"]').forEach(n => n.remove());
      const logoTypeHidden = document.createElement('input');
      logoTypeHidden.type = 'hidden';
      logoTypeHidden.name = 'global[logoType]';
      logoTypeHidden.classList.add('js-hidden-mirror', 'js-hidden-logo-shape');
      logoTypeHidden.value = state.logoType; // "square" | "rect" | "wide"
      form.appendChild(logoTypeHidden);



      // === Inject styleKey hidden field (ensures backend gets the chosen theme) ===
      form.querySelectorAll('input[name="global[siteMode]"]').forEach(n => n.remove());
      const siteModeHidden = document.createElement('input');
      siteModeHidden.type = 'hidden';
      siteModeHidden.name = 'global[siteMode]';
      siteModeHidden.classList.add('js-hidden-mirror');
      siteModeHidden.value = state.siteMode;
      form.appendChild(siteModeHidden);

      // Business type is chosen on step 1 but rendered as a hidden input
      // inside the main form, so the step-3 snapshot captures it. Going back
      // to change it left the snapshot holding the OLD value, which then
      // re-injected itself at submit — the review card showed the new type
      // while the generated site used the old one.
      form.querySelectorAll('input[name="global[businessType]"]').forEach(n => n.remove());
      const businessTypeHidden = document.createElement('input');
      businessTypeHidden.type = 'hidden';
      businessTypeHidden.name = 'global[businessType]';
      businessTypeHidden.classList.add('js-hidden-mirror');
      businessTypeHidden.value = state.businessType;
      form.appendChild(businessTypeHidden);

      // Remove every existing styleKey input (design-step radios or a stale
      // mirror) so exactly one value is submitted.
      form.querySelectorAll('input[name="global[styleKey]"]').forEach(n => n.remove());
      const styleKeyHidden = document.createElement('input');
      styleKeyHidden.type = 'hidden';
      styleKeyHidden.name = 'global[styleKey]';
      styleKeyHidden.classList.add('js-hidden-mirror');
      styleKeyHidden.value = state.styleKey;
      form.appendChild(styleKeyHidden);




    
      // ⬇️ Only inject HIDDEN PAGES if the visible page inputs are NOT present
      const hasPageInputsInDom = !!form.querySelector('#pagesList input[name^="pages"][name$="[filename]"]');
      if (!hasPageInputsInDom) {
        const hiddenPagesWrap = el('div', { class: 'js-hidden-mirror', style: 'display:none;' });
        state.pages.forEach((p, idx) => {
          hiddenPagesWrap.appendChild(el('input', { type:'hidden', name:`pages[${idx}][filename]`, value:p }));
        });
        form.appendChild(hiddenPagesWrap);
      }
    
      // ⬇️ Only inject HIDDEN LOCATIONS if the visible location inputs are NOT present
      const hasLocationInputsInDom = !!form.querySelector('#locationsList input[name="global[locationPages][]"]');
      if (!hasLocationInputsInDom) {
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
      }
    
      // Inject hidden inputs for the ENTIRE main form (includes hours!)
      // If 24h is ON, drop per-day hour keys.
      const is24 =
        state.mainFormSnapshot?.['global[is24Hours]'] === true ||
        state.mainFormSnapshot?.['global[is24Hours]'] === 'true';
    
      injectHiddenSnapshot(
        form,
        state.mainFormSnapshot,
        'js-hidden-mainform',
        (name) => {
          if (STATE_OWNED_FIELDS.includes(name)) return false;
          if (is24 && name.startsWith('global[hours][')) return false;
          return true;
        }
      );
    });   
    go(STEP.MODE);
  });
})();