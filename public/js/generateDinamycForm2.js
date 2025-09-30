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
      <div class="col-8 ">
        
        <input type="text" class="form-control" placeholder="service page" required />
      </div>
      <div class="col-4 ">
        <button type="button" class="btn btn-danger w-100 btn-remove-page">Delete</button>
      </div>
    `;
    container.appendChild(row);
    if (initialValue) row.querySelector('input').value = initialValue;
    reindexPageRows(container);
    row.querySelector('input')?.focus();
  }

  function buildPagesSection(parent) {
    const wrap = el('div', { class: 'mb-4' });
    wrap.appendChild(el('h4', { class: 'mb-3' }, 'Service Pages'));
  
    const outerWrap = el('div', { class: 'border rounded p-3 mb-4' });
    outerWrap.appendChild(wrap); // put wrap inside the outer container
  
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
  
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target?.closest('#pagesList')) e.preventDefault();
    });
  
    // ✅ append the OUTER wrapper to the parent
    parent.appendChild(outerWrap);
  }
  

 
// ---------- Step 2: Logo-only step (square vs rectangular) ----------
function renderLogoStep(container, businessType) {
  container.innerHTML = '';

  const wrap = el('div', { class: 'card shadow-sm' });
  wrap.innerHTML = `
    <div class="card-body">
      <div class="d-flex align-items-center justify-content-between mb-3">
        <h3 class="card-title m-0">Upload your Logo</h3>
        <div class="d-flex gap-2">
          <span class="badge text-bg-primary">Business Type: ${businessType}</span>
          <button type="button" class="btn btn-sm btn-dark" id="changeBusinessTypeBtn">Change</button>
        </div>
      </div>

      <!-- shape selector -->
      <div class="d-flex gap-3 mb-3">
        <div class="form-check">
          <input class="form-check-input" type="radio" name="global[logoType]" id="logoTypeSquare" value="square" checked>
          <label class="form-check-label" for="logoTypeSquare">Square (recommended 250×250 px)</label>
        </div>
        <div class="form-check">
          <input class="form-check-input" type="radio" name="global[logoType]" id="logoTypeRect" value="rect">
          <label class="form-check-label" for="logoTypeRect">Rectangular (recommended 260×200 px)</label>
        </div>
      </div>

      <!-- square input -->
      <div id="logoSquareWrap" class="mb-2">
        <label class="form-label" for="logoSquare">Upload square logo</label>
        <input type="file" id="logoSquare" name="global[logoSquare]" class="form-control" accept="image/*" required>
        <div class="form-text logo-size-hint" id="squareSizeHint">
          <span class="text-muted" id="squareUploadedInfo"></span>
        </div>
      </div>

      <!-- rectangular input -->
      <div id="logoRectWrap" class="mb-2" style="display:none;">
        <label class="form-label" for="logoRect">Upload rectangular logo</label>
        <input type="file" id="logoRect" name="global[logoRect]" class="form-control" accept="image/*">
        <div class="form-text logo-size-hint" id="rectSizeHint">
          <span class="text-muted" id="rectUploadedInfo"></span>
        </div>
      </div>

      <div class="d-flex justify-content-between mt-3">
        <button type="button" class="btn btn-outline-secondary" id="backToBT">Back</button>
        <button type="button" class="btn btn-primary" id="toDetails">Next</button>
      </div>
    </div>
  `;
  container.appendChild(wrap);

  // allow returning to business type
  wrap.querySelector('#changeBusinessTypeBtn')?.addEventListener('click', () => {
    renderBusinessTypeStep(container, businessType);
  });

  wrap.querySelector('#backToBT')?.addEventListener('click', () => {
    renderBusinessTypeStep(container, businessType);
  });

  // toggle shape
  const typeRadios = wrap.querySelectorAll('input[name="global[logoType]"]');
  const squareWrap  = wrap.querySelector('#logoSquareWrap');
  const rectWrap    = wrap.querySelector('#logoRectWrap');
  const squareInput = wrap.querySelector('#logoSquare');
  const rectInput   = wrap.querySelector('#logoRect');

  function applyLogoType(type) {
    const isSquare = type === 'square';
    squareWrap.style.display = isSquare ? '' : 'none';
    rectWrap.style.display   = isSquare ? 'none' : '';
    squareInput.required = isSquare;
    rectInput.required   = !isSquare;
  }

  typeRadios.forEach(r => r.addEventListener('change', () => applyLogoType(r.value)));
  applyLogoType(wrap.querySelector('input[name="global[logoType]"]:checked')?.value || 'square');

  // advisory-only dimension preview
  function showImageDimensions(file, infoElId) {
    const infoEl = wrap.querySelector('#' + infoElId);
    if (!file || !infoEl) return (infoEl && (infoEl.textContent = ''));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      infoEl.textContent = ` • Uploaded: ${img.width} × ${img.height}px (recommendation only)`;
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      infoEl.textContent = ` • Couldn’t read image size (that’s fine).`;
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }
  squareInput?.addEventListener('change', (e) => showImageDimensions(e.target.files?.[0], 'squareUploadedInfo'));
  rectInput?.addEventListener('change',   (e) => showImageDimensions(e.target.files?.[0], 'rectUploadedInfo'));

  // NEXT: move to details WITHOUT losing the file input
  wrap.querySelector('#toDetails')?.addEventListener('click', () => {
    // Require a file for the chosen shape
    const type = wrap.querySelector('input[name="global[logoType]"]:checked')?.value || 'square';
    if (type === 'square' && !squareInput.files?.length) { squareInput.focus(); return; }
    if (type === 'rect'   && !rectInput.files?.length)   { rectInput.focus(); return; }
  
    // Create (or get) a hidden zone inside the real <form> so inputs submit, but never show.
    const form = document.getElementById('websiteForm');
    let hidden = form.querySelector('#hiddenUploads');
    if (!hidden) {
      hidden = document.createElement('div');
      hidden.id = 'hiddenUploads';
      hidden.style.display = 'none';
      form.appendChild(hidden);
    }
  
    // Move (NOT clone) the actual DOM nodes so the selected file is preserved.
    const radiosRow = wrap.querySelector('.d-flex.gap-3.mb-3');
    const sq = wrap.querySelector('#logoSquareWrap');
    const rc = wrap.querySelector('#logoRectWrap');
    if (radiosRow) hidden.appendChild(radiosRow);
    if (sq)        hidden.appendChild(sq);
    if (rc)        hidden.appendChild(rc);
  
    // Proceed to the rest of the form (no logo shown there)
    renderMainForm(container, businessType);
  });
}

function renderMainForm(container, businessType) {
    container.innerHTML = '';

    // keep the chosen business type in a hidden input (so backend gets it)
    const hiddenBT = `<input type="hidden" name="global[businessType]" value="${businessType}">`;

    const header = el('div', { class: 'd-flex align-items-center justify-content-between mb-3' });
    header.innerHTML = `
      <h4 class="m-0">1.  Global Information</h4>
      <div class="d-flex gap-2">
        <span class="badge text-bg-primary">Business Type: ${businessType}</span>
        <button type="button" class="btn btn-sm btn-dark" id="changeBusinessTypeBtn">Change</button>
      </div>
    `;
    container.appendChild(header);

    const globalHTML = `
      ${hiddenBT}
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

        <hr>


        <div class="form-check mt-2">
          <input class="form-check-input" type="checkbox" id="showAboutForm" name="global[showAboutForm]" checked>
          <label class="form-check-label" for="showAboutForm">
            Include contact form on About page
          </label>
        </div>

         <hr>

        <!-- Near Me -->
        <div class="form-check">
          <input class="form-check-input" type="checkbox" id="useNearMe" name="global[useNearMe]" value="true" checked>
          <label class="form-check-label" for="useNearMe">
            Check to optimize About Us page with "Near Me" term
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
        <label class="form-label">Social Profiles (OPTIONAL)</label>
        ${['facebookUrl','twitterUrl','linkedinUrl','youtubeUrl','instagramUrl','pinterestUrl'].map(field => `
          <div class="mb-3">
            <label class="form-label">${field.replace('Url','').replace(/([A-Z])/g,' $1')} URL</label>
            <input type="url" name="global[${field}]" class="form-control" />
          </div>
        `).join('')}

        <hr>


        <!-- Location Pages -->
        <div class="form-check form-switch mb-2">
          <label class="form-check-label" for="addLocations"><h4>Add location pages</h4></label>
          <input class="form-check-input" type="checkbox" id="addLocations" name="global[addLocations]" value="true" checked>
          
        </div>

        <div id="locationsBlock" class="border rounded p-3 mb-3" style="display:none;">
          <div id="locationsList" class="mb-2"></div>
          <button type="button" class="btn btn-sm btn-success" id="addLocationBtn">+ Add another location</button>
          <div class="form-text">
            Format: <code>City, ST</code> or <code>City ST</code> (e.g., <em>Austin, TX</em>).
          </div>
        </div>

  
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
          <div class="col-12">
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
          <button style="background:rgb(31, 174, 31); margin:auto; color:white; padding: 10px; font-size: 24px; min-width: 150px;" type="button" id="nextBtn" class="btn btnHover">Next</button>
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
      renderLogoStep(container, bt);
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
