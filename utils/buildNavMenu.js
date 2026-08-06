// utils/buildNavMenu.js
//
// Builds the primary navigation, injected into every generated page.
//
// STRUCTURE
//   ABOUT US | SERVICES | LOCATIONS | CONTACT
//
// The previous version pulled the FIRST service out of the dropdown and put
// it top-level, which is why it needed several near-duplicate branches. All
// services now sit in the dropdown, so the branching collapses to one rule:
// a single service renders as a plain link (a dropdown holding one item is
// odd), two or more render as a dropdown.
//
// LOCATIONS appears only when the user asked for location pages.

const { slugify } = require('./slugify.js');
const { formatCityForSchema } = require('./formatCityForSchema');

/** `pages` may arrive as an object keyed by index rather than an array. */
function toArray(pages) {
  if (!pages) return [];
  return Array.isArray(pages) ? pages : Object.values(pages);
}

function escapeHtml(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const buildNavMenu = function (template, globalValues, pages, basePath, mainLocationSlug, filename, context) {
  const pagesArr = toArray(pages);
  const currentSlug = slugify(filename || '');

  const isAbout    = context === 'aboutus';
  const isContact  = context === 'contact';
  const isService  = context === 'services';
  const isLocation = context === 'locations';

  /* ---------------------------------------------------------- ABOUT US */

  let items = `
                                <li class="nav-item">
                                  <a class="nav-link ${isAbout ? 'active' : ''}" href="./">ABOUT US</a>
                                </li>`;

  /* ---------------------------------------------------------- SERVICES */

  if (pagesArr.length === 1) {
    // One service: a dropdown containing a single item reads oddly, so link
    // straight to it.
    const only = pagesArr[0];
    const slug = slugify(only.filename || '');
    const href = `${basePath}${slug}-${mainLocationSlug}.html`;
    const active = isService && slug === currentSlug ? 'active' : '';

    items += `
                                <li class="nav-item">
                                  <a class="nav-link ${active}" href="${href}">${escapeHtml(String(only.filename || '').toUpperCase())}</a>
                                </li>`;

  } else if (pagesArr.length > 1) {
    const links = pagesArr.map(page => {
      const slug = slugify(page.filename || '');
      const href = `${basePath}${slug}-${mainLocationSlug}.html`;
      const active = isService && slug === currentSlug ? 'active' : '';

      return `
                                      <li class="nav-item">
                                        <a class="dropdown-item nav-link ${active}" href="${href}">${escapeHtml(String(page.filename || '').toUpperCase())}</a>
                                      </li>`;
    }).join('');

    items += `
                                <li class="nav-item dropdown services-dropdown-option">
                                  <a class="nav-link dropdown-toggle ${isService ? 'active' : ''}" href="#" id="servicesDropdown"
                                     role="button" data-bs-toggle="dropdown" aria-expanded="false">
                                    SERVICES
                                  </a>
                                  <ul class="dropdown-menu">${links}
                                  </ul>
                                </li>`;
  }

  /* --------------------------------------------------------- LOCATIONS */

  const locationPages = Array.isArray(globalValues.locationPages) ? globalValues.locationPages : [];

  if (globalValues.wantsLocationPages && locationPages.length) {
    const links = locationPages.map(loc => {
      const locSlug = slugify(loc.slug || loc.display || '');
      const href = `${basePath}location-${locSlug}.html`;
      const active = isLocation && locSlug === currentSlug ? 'active' : '';

      // Show the city only: "Round Rock", not "Round Rock, TX"
      const label = loc.cityForSchema
        || formatCityForSchema(loc.display || '')
        || String(loc.display || '').split(',')[0];

      return `
                                      <li class="nav-item">
                                        <a class="nav-link dropdown-item ${active}" href="${href}">${escapeHtml(String(label).toUpperCase())}</a>
                                      </li>`;
    }).join('');

    items += `
                                <li class="nav-item dropdown locations-dropdown-option">
                                  <a class="nav-link dropdown-toggle ${isLocation ? 'active' : ''}" href="#" id="locationsDropdown"
                                     role="button" data-bs-toggle="dropdown" aria-expanded="false">
                                    LOCATIONS
                                  </a>
                                  <ul class="dropdown-menu">${links}
                                  </ul>
                                </li>`;
  }

  /* ----------------------------------------------------------- CONTACT */

  items += `
                                <li class="nav-item">
                                  <a class="nav-link ${isContact ? 'active' : ''}" href="${basePath}contact.html">CONTACT</a>
                                </li>`;

  const containerMenu = `<div class="collapse navbar-collapse container-nav-menu" id="navbarNav">
                            <ul class="navbar-nav ms-auto">${items}
                            </ul>
                          </div>`;

  // The templates ship with a placeholder nav block rather than a
  // {{PLACEHOLDER}} token, so replace that block. Non-greedy up to the first
  // </div> is safe here because the shipped block contains no nested divs —
  // only <ul>/<li>. Keep it that way in the templates.
  return template.replace(
    /<div class="collapse navbar-collapse container-nav-menu" id="navbarNav">[\s\S]*?<\/div>\s*/i,
    containerMenu
  );
};

module.exports = { buildNavMenu };