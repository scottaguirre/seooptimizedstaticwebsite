// utils/legalLinks.js
//
// Where the footer legal links point — and, since Design 7, the one other
// in-site page a template links to by name.
//
// A one-page design sample has no legal pages — it is a mock shown to a
// prospective client, never published — so the links return to the sample
// rather than 404ing. The anchor text stays, because the point is showing
// what the finished site would look like.
//
// THE CONTACT PAGE JOINED THIS MAP RATHER THAN GETTING ITS OWN FUNCTION, and
// the reason is the sample rule above. Design 7's hero has a "Book
// Appointment" button that points at contact.html, and a design sample has no
// contact page either — so the button needed exactly the behaviour these
// three already had, at the same four call sites, resolved at the same
// moment. A second function would have been a second place to remember the
// sample fallback, and the one that got forgotten would 404 only on a mock
// shown to a prospective client, which is the worst page on the site to break.
//
//     THE NAME OF THIS FILE IS NOW SLIGHTLY WRONG. That is the cost, and it
//     is smaller than the duplication it bought off.

const LEGAL_SLUGS = {
    LEGAL_PRIVACY:       'privacy-policy.html',
    LEGAL_TERMS:         'terms-of-use.html',
    LEGAL_ACCESSIBILITY: 'accessibility.html',

    // Not legal. See the note above.
    CONTACT_PAGE:        'contact.html',
  };

  /**
   * @param {string} html
   * @param {object} globalValues
   * @param {string} basePath  '' for root pages
   */
  function fillLegalLinks(html, globalValues = {}, basePath = '') {
    const isSample = globalValues.siteMode === 'sample';

    return Object.entries(LEGAL_SLUGS).reduce((out, [token, slug]) => {
      const href = isSample ? './' : `${basePath}${slug}`;
      return out.replace(new RegExp(`{{${token}}}`, 'g'), href);
    }, html);
  }

  module.exports = { fillLegalLinks, LEGAL_SLUGS };
