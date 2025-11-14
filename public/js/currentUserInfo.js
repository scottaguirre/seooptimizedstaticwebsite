
(function () {
  // Fetch current user info (email, role, credits) and show in header
  fetch('/api/me')
    .then(res => res.json())
    .then(data => {
      const infoEl = document.getElementById('user-info');
      const actionsEl = document.getElementById('user-actions');

      if (!infoEl) return;

      // ---- Credits Badge Dynamic Colors ----
      let badgeClass = 'bg-success';
      if (data.credits <= 0) badgeClass = 'bg-danger';
      else if (data.credits <= 5) badgeClass = 'bg-warning';
      else if (data.credits <= 15) badgeClass = 'bg-info';

      // ---- Role Badge (Hide Subscribers) ----
      let roleBadgeHTML = '';
      if (data.role !== 'subscriber') {
        roleBadgeHTML = `<span class="badge bg-secondary me-2">${data.role.toUpperCase()}</span>`;
      }

      // ---- User Info Output ----
      infoEl.innerHTML = `
        <span class="me-2">${data.email}</span>
        ${roleBadgeHTML}
        <span class="badge ${badgeClass}">Credits: ${data.credits}</span>
      `;

      // ---- Build Action Buttons ----
      let actionsHTML = `
        <a href="/buy-credits" class="btn btn-sm btn-outline-warning">Buy more credits</a>
      `;

      // ---- Admin Only ----
      if (data.role === 'admin') {
        actionsHTML += `
          <div class="dropdown d-inline ms-2">
            <button class="btn btn-sm btn-outline-light dropdown-toggle" 
                    type="button"
                    id="adminMenuButton"
                    data-bs-toggle="dropdown"
                    aria-expanded="false">
              Admin
            </button>
            <ul class="dropdown-menu dropdown-menu-end dropdown-menu-dark" aria-labelledby="adminMenuButton">
              <li><a class="dropdown-item" href="/admin">User Management</a></li>
              <li><a class="dropdown-item" href="/dashboard">My Dashboard</a></li>
            </ul>
          </div>
        `;
      }

      actionsEl.innerHTML = actionsHTML;
    })
    .catch(err => console.error(err));
})();

