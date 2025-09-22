// /public/js/locations.js
(function () {
    // --- Location Pages UI helpers ---
    function addLocationInput(initialValue = '') {
      const list = document.getElementById('locationsList');
      if (!list) return;
      const row = document.createElement('div');
      row.className = 'row g-2 align-items-center mb-2';
      row.innerHTML = `
        <div class="col-8">
          <input type="text" class="form-control location-input"
                 name="global[locationPages][]" placeholder="City, ST" value="${initialValue}">
        </div>
        <div class="col-4">
          <button type="button" class="btn btn-danger w-100 remove-location">Delete</button>
        </div>
      `;
      list.appendChild(row);
    }
  
    // Toggle block visibility + ensure one input when turned on
    document.addEventListener('change', (e) => {
      if (e.target && e.target.id === 'addLocations') {
        const block = document.getElementById('locationsBlock');
        const list  = document.getElementById('locationsList');
        const on = e.target.checked;
        if (!block || !list) return;
        block.style.display = on ? 'block' : 'none';
        if (on && list.children.length === 0) addLocationInput();
        // Optional: clear rows when toggled off
        if (!on) list.innerHTML = '';
      }
    });
  
    // Add/remove rows
    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'addLocationBtn') {
        addLocationInput();
      }
      if (e.target && e.target.classList.contains('remove-location')) {
        e.target.closest('.row')?.remove();
      }
    });
  
    // Prevent Enter in location inputs from submitting the form
    document.addEventListener('keydown', (e) => {
      if (e.target && e.target.classList.contains('location-input') && e.key === 'Enter') {
        e.preventDefault();
      }
    });
  
    // Expose if you ever want to add programmatically
    window.addLocationInput = addLocationInput;
  })();
  