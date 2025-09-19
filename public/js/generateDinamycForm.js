// /public/js/generateDinamycForm.js
(function () {
  // ---------- helpers ----------
  const el = (tag, attrs = {}, html = '') => {
    const node = document.createElement(tag);
    Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') node.className = v;
      else if (k.startsWith('data-')) node.setAttribute(k, v);
      else node[k] = v;
    });
    if (html) node.innerHTML = html;
    return node;
  };

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
      <div class="col-12 col-md-7">
        <label class="form-label page-label">Pages</label>
        <input type="text" class="form-control" placeholder="service page" required />
      </div>
      <div class="col-6 col-md-3">
        <button type="button" class="btn btn-outline-danger w-100 btn-remove-page">Delete</button>
      </div>
    `;
    container.appendChild(row);
    if (initialValue) row.querySelector('input').value = initialValue;
    reindexPageRows(container);
    row.querySelector('input')?.focus();
  }

  function buildPagesSection(parent) {
    const wrap = el('div', { class: 'mb-4' });
    wrap.appendChild(el('h4', { class: 'mb-3' }, '2.  Service Pages'));

    const list = el('div', { id: 'pagesList' });
    wrap.appendChild(list);

    const addBtn = el('button', { type: 'button', class: 'btn btn-success' }, '+ Add page');
    wrap.appendChild(addBtn);

    // start with one row
    addPageRow(list);

    addBtn.addEventListener('click', () => addPageRow(list));
    wrap.addEventListener('click', (e) => {
      if (e.target && e.target.classList.contains('btn-remove-page')) {
        e.preventDefault();
        e.stopPropagation();
        const row = e.target.closest('.page-row');
        row?.remove();
        reindexPageRows(list);
      }
    });

    // prevent Enter from submitting while typing filenames
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target?.closest('#pagesList')) e.preventDefault();
    });

    parent.appendChild(wrap);
  }

  // ---------- Step 2: the full form (minus business type picker) ----------
  function renderMainForm(container, businessType) {
    container.innerHTML = '';

    // keep the chosen business type in a hidden input (so backend gets it)
    const hiddenBT = `<input type="hidden" name="global[businessType]" value="${businessType}">`;

    const header = el('div', { class: 'd-flex align-items-center justify-content-between mb-3' });
    header.innerHTML = `
      <h4 class="m-0">1.  Global Information</h4>
      <div class="d-flex gap-2">
        <span class="badge text-bg-primary">Business Type: ${businessType}</span>
        <button type="button" class="btn btn-sm btn-outline-secondary" id="changeBusinessTypeBtn">Change</button>
      </div>
    `;
    container.appendChild(header);

    const globalHTML = `
      ${hiddenBT}
      <div class="mb-4">
        <!-- Logo -->
        <div class="mb-3">
          <label class="form-label">Logo</label>
          <input type="file" name="global[logo]" class="form-control" accept="image/*" required />
        </div>

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

        <!-- Location Pages -->
        <div class="form-check form-switch mb-2">
          <input class="form-check-input" type="checkbox" id="addLocations" name="global[addLocations]" value="true" checked>
          <label class="form-check-label" for="addLocations">Add location pages</label>
        </div>

        <div id="locationsBlock" class="border rounded p-3 mb-3" style="display:none;">
          <div id="locationsList" class="mb-2"></div>
          <button type="button" class="btn btn-sm btn-success" id="addLocationBtn">+ Add another location</button>
          <div class="form-text">
            Format: <code>City, ST</code> or <code>City ST</code> (e.g., <em>Austin, TX</em>).
          </div>
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
      </div>
    `;
    container.insertAdjacentHTML('beforeend', globalHTML);

    // auto-show Locations block + seed one row
    setTimeout(() => {
      const locToggle = document.getElementById('addLocations');
      const block = document.getElementById('locationsBlock');
      const list  = document.getElementById('locationsList');
      if (locToggle && block && list) {
        locToggle.checked = true;
        locToggle.dispatchEvent(new Event('change', { bubbles: true }));
        block.style.display = 'block';
        if (list.children.length === 0 && typeof window.addLocationInput === 'function') {
          window.addLocationInput();
        }
      }
    }, 0);

    // activate your hours logic, if present
    if (window.attachHours) window.attachHours();

    // Pages section
    buildPagesSection(container);

    // Submit button
    const submitWrap = el('div', { class: 'd-grid mt-4' });
    submitWrap.innerHTML = `<button type="submit" class="btn btn-success btn-lg">Create Website</button>`;
    container.appendChild(submitWrap);

    // back to change business type
    container.querySelector('#changeBusinessTypeBtn')?.addEventListener('click', () => {
      renderBusinessTypeStep(container, businessType);
    });
  }

  // ---------- Step 1: only Business Type ----------
  function renderBusinessTypeStep(container, prefill = '') {
    container.innerHTML = '';
    const card = el('div', { class: 'card shadow-sm' });
    card.innerHTML = `
      <div class="card-body">
        <h3 class="card-title mb-3">Choose your Business Type</h3>
        <div class="row g-3">
          <div class="col-12 col-md-6">
            <select class="form-select" id="businessType" required>
              <option value="">Choose...</option>
              <option ${prefill==='Plumbing'?'selected':''}>Plumbing</option>
              <option ${prefill==='Electrician'?'selected':''}>Electrician</option>
              <option ${prefill==='Concrete Contractor'?'selected':''}>Concrete Contractor</option>
              <option ${prefill==='Roofing'?'selected':''}>Roofing</option>
              <option ${prefill==='HVAC'?'selected':''}>HVAC</option>
              <option ${prefill==='Landscaping'?'selected':''}>Landscaping</option>
              <option ${prefill==='Law Firm'?'selected':''}>Law Firm</option>
            </select>
            <div class="form-text">You can change this (Business Category) later</div>
          </div>
        </div>
        <div class="d-flex gap-2 mt-4">
          <button type="button" id="nextBtn" class="btn btn-primary btn-lg">Next</button>
        </div>
      </div>
    `;
    container.appendChild(card);

    const nextBtn = card.querySelector('#nextBtn');
    const select  = card.querySelector('#businessType');

    // allow Enter to advance
    select.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        nextBtn.click();
      }
    });

    nextBtn.addEventListener('click', () => {
      const bt = (select.value || '').trim();
      if (!bt) {
        select.classList.add('is-invalid');
        select.focus();
        return;
      }
      renderMainForm(container, bt);
    });
  }

  // ---------- attach / bootstrap ----------
  document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('dynamicFormContainer');
    const form = document.getElementById('websiteForm');
    if (!container || !form) return;

    // Step 1 first:
    renderBusinessTypeStep(container);

    // guard: block submit if user hasn't passed step 1
    form.addEventListener('submit', (e) => {
      // if Step 1 is showing, we don't have the hidden input yet
      const hasBT = !!form.querySelector('input[name="global[businessType]"]');
      if (!hasBT) {
        e.preventDefault();
        container.querySelector('#nextBtn')?.focus();
      }
    });
  });

  // Expose if you ever need to force a re-render from elsewhere
  window.renderBusinessTypeStep = renderBusinessTypeStep;
  window.renderMainForm = renderMainForm;
})();
