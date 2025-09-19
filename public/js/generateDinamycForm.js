// /public/js/generateDinamycForm.js
(function () {
    function generateDynamicForm() {
      const count = parseInt(document.getElementById('pageCount').value);
      const errorEl = document.getElementById('pageCountError');
      const container = document.getElementById('dynamicFormContainer');
  
      if (isNaN(count) || count < 1) {
        errorEl.style.display = 'block';
        container.innerHTML = '';
        return;
      } else {
        errorEl.style.display = 'none';
      }
  
      container.innerHTML = '';
  
      // GLOBAL SECTION
      const globalHTML = `
        <!-- 1) Business Type -->
        <div class="mb-4">
          <h4>Global Information</h4>
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
  
          <!-- 2) LOGO -->
          <div class="mb-3">
            <label class="form-label"> 2) Logo </label>
            <input type="file" name="global[logo]" class="form-control" accept="image/*" />
          </div>
  
          <!-- 3) Business Name-->
          <div class="mb-3">
            <label class="form-label">3) Business Name</label>
            <input type="text" name="global[businessName]" class="form-control" required />
          </div>
          
          <hr>
  
          <!-- 4) Near Me-->
          <div class="form-check">
            <input class="form-check-input" type="checkbox" id="useNearMe" name="global[useNearMe]" value="true" checked>
            <label class="form-check-label" for="useNearMe">
              4) Check to optimize About Us page with "Near Me" term
            </label>
          </div>
  
          <hr>
  
          <!-- 5) Domain-->
          <div class="mb-3">
            <label class="form-label">5) Domain</label>
            <input type="text" name="global[domain]" class="form-control" placeholder="example.com" required />
          </div>
  
          <!-- 6) Address -->
          <div class="mb-3">
            <label class="form-label">6) Address</label>
            <input type="text" name="global[address]" class="form-control" required />
          </div>
  
          <!-- 7) Location-->
          <div class="mb-3">
            <label class="form-label">7) Main Location</label>
            <input type="text" name="global[location]" class="form-control" required />
          </div>

          <hr>

          <!-- 8) Location Pages -->
          <div class="form-check form-switch mb-2">
            <input class="form-check-input" type="checkbox"
                  id="addLocations" name="global[addLocations]" value="true" checked>
            <label class="form-check-label" for="addLocations">
              8) Add location pages
            </label>
          </div>

          <div id="locationsBlock" class="border rounded p-3 mb-3" style="display:none;">
            <div id="locationsList" class="mb-2"></div>
              <button type="button" class="btn btn-sm btn-success" id="addLocationBtn">
                + Add another location
              </button>
            <div class="form-text">
              Format: <code>City, ST</code> or <code>City ST</code> (e.g., <em>Austin, TX</em>).
            </div>
          </div>
  
          <hr>

          <!-- 9) Phone -->
          <div class="mb-3">
            <label class="form-label">9) Phone</label>
            <input type="tel" name="global[phone]" class="form-control" required />
          </div>
  
          <!-- 10) Email-->
          <div class="mb-3">
            <label class="form-label">10) Email</label>
            <input type="email" name="global[email]" class="form-control" required />
          </div>
  
          <!-- 11) Business Hours-->
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
  
          <!-- 12) Social Profiles-->
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

      // Initialize Location pages toggle to be on (it starts on at the beginning)
      // Force-on by default and initialize the UI
      setTimeout(() => {
        const locToggle = document.getElementById('addLocations');
        const block = document.getElementById('locationsBlock');
        const list  = document.getElementById('locationsList');
        if (!locToggle || !block || !list) return;

        // 💡 If you want it ON by default, keep this line. If not, remove it.
        locToggle.checked = true;

        // Prefer centralized behavior: trigger the document 'change' handler
        locToggle.dispatchEvent(new Event('change', { bubbles: true }));

        // Fallback in case the handler wasn’t attached for some reason
        if (block.style.display === 'none') block.style.display = 'block';
        if (list.children.length === 0 && typeof window.addLocationInput === 'function') {
          window.addLocationInput();
        }
      }, 0);

  
      // PAGE ACCORDION
      const accordion = document.createElement('div');
      accordion.className = 'accordion';
      accordion.id = 'formAccordion';
  
      for (let i = 0; i < count; i++) {
        const item = document.createElement('div');
        item.className = 'accordion-item';
        item.innerHTML = `
          <h2 class="accordion-header" id="heading${i}">
            <button class="accordion-button ${i !== 0 ? 'collapsed' : ''}" type="button"
              data-bs-toggle="collapse" data-bs-target="#collapse${i}" aria-expanded="${i === 0}"
              aria-controls="collapse${i}">
              Page ${i + 1}
            </button>
          </h2>
          <div id="collapse${i}" class="accordion-collapse collapse ${i === 0 ? 'show' : ''}"
            aria-labelledby="heading${i}" data-bs-parent="#formAccordion">
            <div class="accordion-body">
              <div class="mb-3">
                <label class="form-label">Page Filename</label>
                <input type="text" name="pages[${i}][filename]" class="form-control" required />
              </div>
            </div>
          </div>
        `;
        accordion.appendChild(item);
      }
  
      container.appendChild(accordion);
  
      const submitBtn = document.createElement('div');
      submitBtn.className = 'd-grid mt-4';
      submitBtn.innerHTML = `<button type="submit" class="btn btn-submit btn-success btn-lg">Create Website</button>`;
      container.appendChild(submitBtn);
  
      if (window.attachHours) window.attachHours();
    }
  
    // expose globally so your button's onclick can call it
    window.generateDynamicForm = generateDynamicForm;

    // Block Enter/submit until the dynamic fields exist
    document.addEventListener('DOMContentLoaded', () => {
      const form = document.getElementById('websiteForm');
      const pageCount = document.getElementById('pageCount');
      const container = document.getElementById('dynamicFormContainer');

      if (!form || !pageCount) return;

      // If user entered a number in the input that asks "How Many Pages?
      // and presses the "Enter" key instead of "Start Process" button
      // it builds the Form by calling generateDynamicForm
      pageCount.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          // Only build the dynamic fields if they don't exist yet
          if (container.children.length === 0 && typeof window.generateDynamicForm === 'function') {
            window.generateDynamicForm();
          }
        }
      });


      // FORM-LEVEL ENTER GUARD HERE:
      // It prevents submitting the form if user presses "Enter" without pressing the submit button
      form.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && container.children.length === 0) {
          e.preventDefault(); // ignore Enter anywhere in the form until fields are generated
        }
      });


      // Extra safety: if the dynamic section isn’t built yet, block submits
      form.addEventListener('submit', (e) => {
        if (!container || container.children.length === 0) {
          e.preventDefault();      // nothing happens
        }
      });
    });

  })();
  