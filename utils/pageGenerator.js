const { generateMetadata } = require('./generateMetadata');
const { generateTaglineFromHeading } = require('./generateTaglineFromHeading');
const { getCoordinatesFromAddress } = require('./getCoordinatesFromAddress');
const { generateServiceAreaContent } = require('./generateServiceAreaContent');
const { generateReview } = require('./generateReview');
const { normalizeText } = require('./normalizeText');
const { smartTitleCase } = require('./smartTitleCase');
const { formatPhoneForHref } = require('./formatPhoneForHref');
const { formatCityState } = require('./formatCityState');
const { slugify } = require('./slugify');
const { buildAltAttribute } = require('./buildAltAttribute');
const { formatCityForSchema } = require('./formatCityForSchema');
const { replaceInProd } = require('./replaceInProd');
const { removeScriptAndLinkTags } = require('./removeScriptAndLinkTags');
const { buildAccessibilityPage } = require('./buildAccessibilityPage');
const { validateEachPageInputs } = require('./validateEachPageInputs');
const { validateEachPageHasFiles } = require('./validateEachPageHasFiles');
const { buildSchema } = require('./buildSchema');
const { buildTermsOfUsePage } = require('./buildTermsOfUsePage');
const { getFullStateName } = require('./getFullStateName');
const { buildPrivacyPolicyPage } = require('./buildPrivacyPolicyPage');
const { buildAboutUsPage } = require('./buildAboutUsPage');
const { buildServicesPage } = require('./buildServicesPage');
const { buildAltText } = require('./buildAltText');
const { buildNavMenu } = require('./buildNavMenu');
const { copyAllPredefinedImages } = require('./copyAllPredefinedImages');
const { injectPagesInterlinks } = require('./injectPagesInterlinks');
const { generateAboutUsContent } = require('./generateAboutUsContent');
const { buildInterlinksMap } = require('./buildInterlinksMap');
const { generatePagesContent } = require('./generatePagesContent');

module.exports = {
  generateMetadata,
  generateTaglineFromHeading,
  getCoordinatesFromAddress,
  generateServiceAreaContent,
  generateReview,
  normalizeText,
  smartTitleCase,
  formatPhoneForHref,
  slugify,
  formatCityState,
  buildAltAttribute,
  formatCityForSchema,
  replaceInProd,
  removeScriptAndLinkTags,
  buildAccessibilityPage,
  validateEachPageInputs,
  validateEachPageHasFiles,
  buildSchema,
  buildTermsOfUsePage,
  getFullStateName,
  buildPrivacyPolicyPage,
  buildAboutUsPage,
  buildServicesPage,
  buildAltText,
  buildNavMenu,
  copyAllPredefinedImages,
  injectPagesInterlinks,
  generateAboutUsContent,
  buildInterlinksMap,
  generatePagesContent
};
