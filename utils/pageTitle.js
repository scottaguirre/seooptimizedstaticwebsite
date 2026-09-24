// utils/pageTitle.js
//
// The product's name, and the name in the browser tab.
//
// WHY THIS IS ITS OWN FILE AND NOT PART OF appHeader
//
// It started there — the logo's alt text is the product name, so that looked
// like where the name lived. Then the signed-out pages needed it: the
// password-reset pages have tab titles like everything else, and importing
// the helper meant importing utils/appHeader.
//
// A test in test-app-header.js caught that within the minute:
//
//   signed-out pages do NOT get the header
//   routes/passwordRoute.js renders the logged-in header on a signed-out page
//
// It matches the module NAME rather than the header being rendered, so
// strictly it was a false positive — and splitting the file was still the
// right answer. A signed-out page has no business importing the logged-in
// header for any reason, and a boundary that holds only because nobody has
// had a good excuse to cross it is not a boundary.
//
// So the name lives here, appHeader reads it for the logo, and a page that
// only wants a tab title only takes a tab title.

/**
 * The product's name, in ONE place.
 *
 * Renaming the product should be one edit, not a grep. This app was called
 * SEO Site Generator and then Fast Website Generator before it was called
 * Three Comets, and each rename left strings behind in files nobody thought
 * to search.
 */
const APP_NAME = 'Three Comets';

/**
 * What separates the page from the product.
 *
 * A middle dot rather than a pipe or a dash: it reads as a separator rather
 * than as punctuation belonging to either side, so "Log In · Three Comets"
 * cannot be misread as a page called "Log In -".
 */
const TITLE_SEPARATOR = ' · ';

/**
 * "Dashboard" -> "Dashboard · Three Comets".
 *
 * WHY THE PAGE COMES FIRST. A tab shows maybe twenty characters before it
 * truncates, and brand-first means ten open tabs all read "Three Comets…" —
 * identical, and useless for finding the one you want. Putting the page first
 * means the distinguishing word survives the truncation.
 *
 * THE APP'S OWN FRONT PAGE IS JUST THE NAME. "Three Comets · Three Comets" is
 * what a naive suffix produces for the wizard, so a name that already IS the
 * product comes back unchanged — as does an empty one, which is how a missing
 * title degrades to something correct rather than to " · Three Comets".
 */
function pageTitle(name) {
  const page = String(name == null ? '' : name).trim();

  if (!page || page === APP_NAME) return APP_NAME;

  // Already branded — a caller that passed a whole title, or a double wrap
  // after a refactor. Either way, once is enough.
  if (page.endsWith(`${TITLE_SEPARATOR}${APP_NAME}`)) return page;

  return `${page}${TITLE_SEPARATOR}${APP_NAME}`;
}

module.exports = { pageTitle, APP_NAME, TITLE_SEPARATOR };
