const { slugify } = require('./slugify');
const { googleMap } = require('./googleMap');
const { buildSchema } = require('./buildSchema');
const { buildAltText } = require('./buildAltText');
const { buildNavMenu } = require('./buildNavMenu');
const { normalizeText } = require('./normalizeText');
const { replaceInProd } = require('./replaceInProd');
const { generateReview } = require('./generateReview');
const { smartTitleCase } = require('./smartTitleCase');
const { createBuildRecord } = require('./buildRegistry');
const { formatCityState } = require('./formatCityState');
const { buildAboutUsPage } = require('./buildAboutUsPage');
const { generateMetadata } = require('./generateMetadata');
const { getFullStateName } = require('./getFullStateName');
const { buildAltAttribute } = require('./buildAltAttribute');
const { buildServicesPage } = require('./buildServicesPage');
const { buildLocationPages} = require('./buildLocationPages');
const { buildInterlinksMap } = require('./buildInterlinksMap');
const { formatPhoneForHref } = require('./formatPhoneForHref');
const { formatCityForSchema } = require('./formatCityForSchema');
const { buildTermsOfUsePage } = require('./buildTermsOfUsePage');
const { generatePagesContent } = require('./generatePagesContent');
const { injectPagesInterlinks } = require('./injectPagesInterlinks');
const { buildAccessibilityPage } = require('./buildAccessibilityPage');
const { buildPrivacyPolicyPage } = require('./buildPrivacyPolicyPage');
const { generateAboutUsContent } = require('./generateAboutUsContent');
const { removeScriptAndLinkTags } = require('./removeScriptAndLinkTags');
const { copyAllPredefinedImages } = require('./copyAllPredefinedImages');
const { getCoordinatesFromAddress } = require('./getCoordinatesFromAddress');
const { generateServiceAreaContent } = require('./generateServiceAreaContent');
const { generateTaglineFromHeading } = require('./generateTaglineFromHeading');
const { getHoursDaysText, getHoursTimeText } = require('./formatDaysAndHoursForDisplay');






module.exports = {
  slugify,
  googleMap,
  buildSchema,
  buildAltText,
  buildNavMenu,
  normalizeText,
  replaceInProd,
  generateReview,
  smartTitleCase,
  formatCityState,
  getFullStateName,
  buildAboutUsPage,
  getHoursDaysText,
  getHoursTimeText,
  generateMetadata,
  buildServicesPage,
  buildAltAttribute,
  createBuildRecord,
  formatPhoneForHref,
  buildLocationPages,
  buildInterlinksMap,
  buildTermsOfUsePage,
  formatCityForSchema,
  generatePagesContent,
  injectPagesInterlinks,
  generateAboutUsContent,
  buildAccessibilityPage,
  buildPrivacyPolicyPage,
  removeScriptAndLinkTags,
  copyAllPredefinedImages,
  getCoordinatesFromAddress,
  generateServiceAreaContent,
  generateTaglineFromHeading
 
};

