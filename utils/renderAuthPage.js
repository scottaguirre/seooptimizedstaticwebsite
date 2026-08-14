// utils/renderAuthPage.js
//
// Renders login.html / signup.html with an optional error message.
//
// Failed logins previously returned res.status(400).send('Invalid email or
// password') — a blank white page with one line of text and no way back
// except the browser's back button, which also cleared the form.
//
// This re-renders the same form with the message above it and the email
// already filled in, so a mistyped password means retyping only the password.

const fs = require('fs');
const path = require('path');

const VIEWS_DIR = path.join(__dirname, '..', 'src', 'views');

// Read once at startup: these files do not change while the server runs, and
// re-reading them on every failed login is needless disk work on a path an
// attacker can hit repeatedly.
const cache = new Map();

function loadView(name) {
  if (!cache.has(name)) {
    cache.set(name, fs.readFileSync(path.join(VIEWS_DIR, `${name}.html`), 'utf8'));
  }
  return cache.get(name);
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * @param {string} view      'login' | 'signup'
 * @param {object} options
 * @param {string} [options.error]    message shown in a red alert
 * @param {string} [options.notice]   message shown in a blue alert
 * @param {string} [options.email]    prefills the email field
 * @param {string} [options.action]   optional extra HTML inside the alert
 */
function renderAuthPage(view, { error, notice, email = '', action = '', csrfField = '' } = {}) {
  let html = loadView(view);

  let alert = '';

  if (error) {
    alert = `
        <div class="alert alert-danger d-flex align-items-start gap-2" role="alert">
          <span aria-hidden="true">&#9888;</span>
          <div>
            ${escapeHtml(error)}
            ${action}
          </div>
        </div>`;
  } else if (notice) {
    alert = `
        <div class="alert alert-info" role="alert">
          ${escapeHtml(notice)}
          ${action}
        </div>`;
  }

  return html
    // The token comes from the caller, not from here: this module has no
    // request and therefore no session to read it from.
    .replace(/{{CSRF}}/g, csrfField)
    .replace(/{{ALERT}}/g, alert)
    // The email is echoed back into an attribute, so it must be escaped —
    // otherwise a crafted address becomes markup on the page.
    .replace(/{{EMAIL}}/g, escapeHtml(email));
}

module.exports = { renderAuthPage, escapeHtml };