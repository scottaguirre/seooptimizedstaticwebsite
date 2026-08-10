// utils/legalLinks.js
//
// Where the three footer legal links point.
//
// A one-page design sample has no legal pages — it is a mock shown to a
// prospective client, never published — so the links return to the sample
// rather than 404ing. The anchor text stays, because the point is showing
// what the finished site would look like.

const LEGAL_SLUGS = {
    LEGAL_PRIVACY:       'privacy-policy.html',
    LEGAL_TERMS:         'terms-of-use.html',
    LEGAL_ACCESSIBILITY: 'accessibility.html',
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