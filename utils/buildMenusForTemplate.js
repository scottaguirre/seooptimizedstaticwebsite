// utils/buildMenusForTemplate.js
const { slugify } = require('./slugify');
const { smartTitleCase } = require('./smartTitleCase');
const { formatCityForSchema } = require('./formatCityForSchema');

// Helper: normalize pages array (your "pages" can be object-like)
function toArray(pages) {
  if (!pages) return [];
  return Array.isArray(pages) ? pages : Object.values(pages);
}

/**
 * Build strings for {{FIRST_PAGE_NAME*}}, {{SERVICES_NAV_MENU}}, {{LOCATIONS_NAV_MENU}}
 * and inject them into the given template HTML. Also removes empty dropdown wrappers.
 *
 * @param {string} template - the HTML string (your page template after other replacements)
 * @param {object} opts
 *   - pages: array|object of { filename }
 *   - basePath: '/dist/' in dev or '/' in prod
 *   - globalValues: { location, wantsLocationPages, locationPages:[{cityForSchema, display, slug}] }
 *   - context: { type:'service'|'location', serviceSlug?, locationSlug? }
 *
 * @returns {string} modified template
 */
function buildAndInjectMenusForTemplate(template, opts) {
  const { pages, basePath, globalValues, context } = opts;
  const pagesArr = toArray(pages);

  // ---------- FIRST PAGE (top-level when only one service) ----------
  let FIRST_PAGE_NAME = '';
  let FIRST_PAGE_NAME_ACTIVE = '';
  let LINK_OUTSIDE_NAV_MENU = '';

  const primaryLocationSlug = slugify(globalValues.location || '');

  if (pagesArr.length === 1) {
    const only = pagesArr[0];
    const onlySlug = slugify(only.filename || '');
    LINK_OUTSIDE_NAV_MENU = `${basePath}${onlySlug}-${primaryLocationSlug}.html`;
    FIRST_PAGE_NAME = smartTitleCase(only.filename || '');
    const isActiveService = context?.type === 'service' && context?.serviceSlug === onlySlug;
    FIRST_PAGE_NAME_ACTIVE = isActiveService ? 'active' : '';
  } else {
    // Using Services dropdown; remove the top-level first-page <li>
    LINK_OUTSIDE_NAV_MENU = '';
    FIRST_PAGE_NAME = '';
    FIRST_PAGE_NAME_ACTIVE = '';
  }

  // ---------- SERVICES DROPDOWN ----------
  let SERVICES_NAV_MENU = '';

  if (pagesArr.length > 1) {
    SERVICES_NAV_MENU = pagesArr.map(p => {
      const svcSlug = slugify(p.filename || '');
      const href = `${basePath}${svcSlug}-${primaryLocationSlug}.html`;
      const isActive = context?.type === 'service' && context?.serviceSlug === svcSlug;
      const label = smartTitleCase(p.filename || '');
      return `
        <li class="nav-item">
          <a class="dropdown-item ${isActive ? 'active' : ''}" href="${href}">
            ${label}
          </a>
        </li>
      `;
    }).join('').trim();
  } // else keep empty; wrapper will be removed

  // ---------- LOCATIONS DROPDOWN ----------
  let LOCATIONS_NAV_MENU = '';
  const hasLocations = !!(globalValues.wantsLocationPages &&
                          Array.isArray(globalValues.locationPages) &&
                          globalValues.locationPages.length);

  if (hasLocations) {
    const sorted = [...globalValues.locationPages].sort((a, b) => {
      const ca = (a.cityForSchema || (a.display || '').split(',')[0] || '').toLowerCase();
      const cb = (b.cityForSchema || (b.display || '').split(',')[0] || '').toLowerCase();
      return ca.localeCompare(cb);
    });

    LOCATIONS_NAV_MENU = sorted.map(loc => {
      const href = `${basePath}location-${loc.slug}.html`;
      const cityLabel = (loc.cityForSchema || (loc.display || '').split(',')[0] || '').trim();
      const isActive = context?.type === 'location' && context?.locationSlug === loc.slug;
      return `
        <li>
          <a class="dropdown-item ${isActive ? 'active' : ''}" href="${href}">
            ${cityLabel}
          </a>
        </li>
      `;
    }).join('').trim();
  }

  // ---------- Inject placeholders ----------
  let out = template
    .replace(/{{FIRST_PAGE_NAME_ACTIVE}}/g, FIRST_PAGE_NAME_ACTIVE)
    .replace(/{{LINK_OUTSIDE_NAV_MENU}}/g, LINK_OUTSIDE_NAV_MENU)
    .replace(/{{FIRST_PAGE_NAME}}/g, FIRST_PAGE_NAME)
    .replace(/{{SERVICES_NAV_MENU}}/g, SERVICES_NAV_MENU)
    .replace(/{{LOCATIONS_NAV_MENU}}/g, LOCATIONS_NAV_MENU);

  // ---------- Remove wrappers when empty ----------
  // Remove the top-level "first page" <li> entirely if empty
  if (!LINK_OUTSIDE_NAV_MENU || !FIRST_PAGE_NAME) {
    out = out.replace(
      // Match the single "first page" <li> line safely
      /<li class="nav-item">\s*<a class="nav-link\s*{{FIRST_PAGE_NAME_ACTIVE}}"\s*href="{{LINK_OUTSIDE_NAV_MENU}}">\s*{{FIRST_PAGE_NAME}}\s*<\/a>\s*<\/li>\s*/g,
      ''
    )
    // Also handle the case after placeholders were already replaced with empties
    .replace(
      /<li class="nav-item">\s*<a class="nav-link\s*"?\s*href="\s*">\s*<\/a>\s*<\/li>\s*/g,
      ''
    );
  }

  // Remove Services dropdown wrapper if its menu is empty
  if (!SERVICES_NAV_MENU) {
    out = out.replace(
      /<li class="nav-item dropdown services-dropdown-option">[\s\S]*?<\/li>\s*/g,
      ''
    );
  }

  // Remove Locations dropdown wrapper if its menu is empty
  if (!LOCATIONS_NAV_MENU) {
    out = out.replace(
      /<li class="nav-item dropdown locations-dropdown-option">[\s\S]*?<\/li>\s*/g,
      ''
    );
  }

  return out;
}

module.exports = { buildAndInjectMenusForTemplate };
