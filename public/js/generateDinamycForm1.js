// /public/js/generateDinamycForm.js (REPLACE ENTIRE FILE)
(function () {
    // Helpers to create elements
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
  
    // =============== Pages UI Logic ===============
    function reindexPageRows(container) {
      const rows = container.querySelectorAll('.page-row');
      rows.forEach((row, idx) => {
        const input = row.querySelector('input[type="text"]');
        if (input) input.name = `pages[${idx}][filename]`;
        row.querySelector('.page-label').textContent = `Page ${idx + 1}`;
      });
    }
  
    function addPageRow(container, initialValue = '') {
      const row = el('div', { class: 'row g-3 align-items-end page-row mb-2' });
      row.innerHTML = `
        <div class="col-12 col-md-7">
          <label class="form-label page-label">Page</label>
          <input type="text" class="form-control" placeholder="services-keyword"
                 required />
        </div>
        <div class="col-6 col-md-3">
          <button type="button" class="btn btn-outline-danger w-100 btn-remove-page">
            Delete
          </button>
        </div>
      `;
      container.appendChild(row);
      // name gets assigned by reindex
      reindexPageRows(container);
  
      // focus the new input
      row.querySelector('input')?.focus();
    }
  
    function buildPagesSection(parent) {
      const wrap = el('div', { class: 'mb-4' });
      wrap.appendChild(el('h4', { class: 'mb-3' }, 'Pages'));
  
      const list = el('div', { id: 'pagesList' });
      wrap.appendChild(list);
  
      const addBtn = el('button', {
        type: 'button',
        class: 'btn btn-success'
      }, '+ Add page');
      wrap.appendChild(addBtn);
  
      // one row by default
      addPageRow(list);
  
      // Events
      addBtn.addEventListener('click', () => addPageRow(list));
  
      wrap.addEventListener('click', (e) => {
        if (e.target && e.target.classList.contains('btn-remove-page')) {
          const row = e.target.closest('.page-row');
          row?.remove();
          reindexPageRows(list);
        }
      });
  
      // Prevent Enter from submitting while typing page filename
      wrap.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target?.closest('#pagesList')) {
          e.preventDefault();
        }
      });
  
      parent.appendChild(wrap);
    }
  
    // =============== Global Section (mostly unchanged) ===============
    function buildGlobalSection(container) {
      const globalHTML = `
        <div class="mb-4">
          <h4>Global Information</h4>
  
          <!-- Business Type -->
          <div class="mb-3">
            <label for="businessType" class="form-label">1) Business Type</label>
            <select class="form-select" id="businessType" name="global[businessType]" required>
              <option value="">Choose...</option>
              <option>Plumbing</option>
              <option>Electrician</option>
              <option>Concrete Contractor</option>
              <option>Roofing</option>
              <option>HVAC</option>
              <option>Landscaping</option>
              <option>Law Firm</option>
            </select>
          </div>
  
          <!-- Logo -->
          <div class="mb-3">
            <label class="form-label">2) Logo</label>
            <input type="file" name="global[logo]" class="form-control" accept="image/*" required />
          </div>
  
          <!-- Business Name-->
          <div class="mb-3">
            <label class="form-label">3) Business Name</label>
            <input type="text" name="global[businessName]" class="form-control" required />
          </div>
  
          <hr>
  
          <!-- Near Me -->
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="useNearMe" name="global[useNearMe]" value="true" checked>
            <label class="form-check-label" for="useNearMe">
              4) Check to optimize About Us page with "Near Me" term
            </label>
          </div>
  
          <hr>
  
          <!-- Domain -->
          <div class="mb-3">
            <label class="form-label">5) Domain</label>
            <input type="text" name="global[domain]" class="form-control" placeholder="example.com" required />
          </div>
  
          <!-- Address -->
          <div class="mb-3">
            <label class="form-label">6) Address</label>
            <input type="text" name="global[address]" class="form-control" required />
          </div>
  
          <!-- Main Location-->
          <div class="mb-3">
            <label class="form-label">7) Main Location</label>
            <input type="text" name="global[location]" class="form-control" required />
          </div>
  
          <hr>
  
          <!-- Location Pages -->
          <div class="form-check form-switch mb-2">
            <input class="form-check-input" type="checkbox" id="addLocations" name="global[addLocations]" value="true" checked>
            <label class="form-check-label" for="addLocations">8) Add location pages</label>
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
            <label class="form-label">9) Phone</label>
            <input type="tel" name="global[phone]" class="form-control" required />
          </div>
  
          <!-- Email-->
          <div class="mb-3">
            <label class="form-label">10) Email</label>
            <input type="email" name="global[email]" class="form-control" required />
          </div>
  
          <!-- Business Hours-->
          <div class="mb-3">
            <label class="form-label">11) Business Hours</label>
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
          <label class="form-label">12) Social Profiles</label>
          ${['facebookUrl','twitterUrl','linkedinUrl','youtubeUrl','instagramUrl','pinterestUrl'].map(field => `
            <div class="mb-3">
              <label class="form-label">${field.replace('Url','').replace(/([A-Z])/g,' $1')} URL</label>
              <input type="url" name="global[${field}]" class="form-control" />
            </div>
          `).join('')}
  
          <hr>
        </div>
      `;
      container.insertAdjacentHTML('beforeend', globalHTML);
  
      // Auto-show Location Pages block + seed one row
      setTimeout(() => {
        const locToggle = document.getElementById('addLocations');
        const block = document.getElementById('locationsBlock');
        const list  = document.getElementById('locationsList');
        if (!locToggle || !block || !list) return;
        locToggle.checked = true;
        locToggle.dispatchEvent(new Event('change', { bubbles: true }));
        if (block.style.display === 'none') block.style.display = 'block';
        if (list.children.length === 0 && typeof window.addLocationInput === 'function') {
          window.addLocationInput();
        }
      }, 0);
  
      // Activate hours logic from your existing script
      if (window.attachHours) window.attachHours();
    }
  
    // =============== Entry point ===============
    function generateDynamicForm() {
      const container = document.getElementById('dynamicFormContainer');
      if (!container) return;
      container.innerHTML = '';
  
      // Global section (same as before)
      buildGlobalSection(container);
  
      // Pages section with dynamic add/remove
      buildPagesSection(container);
  
      // Submit button (unchanged)
      const submitBtn = document.createElement('div');
      submitBtn.className = 'd-grid mt-4';
      submitBtn.innerHTML = `<button type="submit" class="btn btn-submit btn-success btn-lg">Create Website</button>`;
      container.appendChild(submitBtn);
    }
  
    // Expose globally so your "Start Process" button in form.html can call it
    window.generateDynamicForm = generateDynamicForm;
  
    // Keep your Enter-key guards from the old file: block submit if fields not yet generated
    document.addEventListener('DOMContentLoaded', () => {
      const form = document.getElementById('websiteForm');
      const pageCount = document.getElementById('pageCount');
      const container = document.getElementById('dynamicFormContainer');
      if (!form) return;
  
      // If user presses Enter inside the "How many pages?" input, just build the form
      pageCount?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          if (container.children.length === 0) generateDynamicForm();
        }
      });
  
      // Don’t allow submit until dynamic fields exist
      form.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && container.children.length === 0) e.preventDefault();
      });
      form.addEventListener('submit', (e) => {
        if (container.children.length === 0) e.preventDefault();
      });
    });
  })();
  