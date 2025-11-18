// public/js/currentUserInfo.js
document.addEventListener('DOMContentLoaded', async () => {
  const userInfoEl = document.getElementById('user-info');
  const userActionsEl = document.getElementById('user-actions');

  if (!userInfoEl || !userActionsEl) return;

  try {
    const res = await fetch('/api/me', {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!res.ok) {
      // Not logged in or error
      userInfoEl.textContent = 'Not logged in';
      userActionsEl.innerHTML = '';
      return;
    }

    const user = await res.json();

    // Top-left info text
    userInfoEl.innerHTML = `${user.email} <span class="badge bg-success" style="font-size:14px; margin-left:15px;"> ${user.role}  </span>`;

    // Treat both admin and superadmin as admins for UI purposes
    const isAdmin =
      user.role === 'admin' ||
      user.role === 'superadmin';

    // Base actions: credits badge + Buy Credits button
    let html = `
      <span class="badge bg-secondary">
        <i class="bi bi-lightning-charge-fill me-1"></i>
        Credits: ${user.credits}
      </span>

      <a href="/buy-credits" class="btn btn-warning btn-sm ms-2">
        <i class="bi bi-cart-plus me-1"></i>
        Buy Credits
      </a>
    `;

    // Admin badge + dropdown with down arrow
    if (isAdmin) {
      html += `
        <div class="dropdown d-inline ms-2">
          <button
            class="btn btn-outline-info btn-sm dropdown-toggle"
            type="button"
            id="adminMenuButton"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          >
            <i class="bi bi-shield-lock-fill me-1"></i>
            Admin
          </button>
          <ul class="dropdown-menu dropdown-menu-end dropdown-menu-dark"
              aria-labelledby="adminMenuButton">
            <li>
              <a class="dropdown-item" href="/admin">
                User management
              </a>
            </li>
            <li>
              <a class="dropdown-item" href="/dashboard">
                My dashboard
              </a>
            </li>
          </ul>
        </div>
      `;
    }

    userActionsEl.innerHTML = html;
  } catch (err) {
    console.error('Error loading current user info:', err);
    userInfoEl.textContent = 'Error loading user info';
    userActionsEl.innerHTML = '';
  }
});
