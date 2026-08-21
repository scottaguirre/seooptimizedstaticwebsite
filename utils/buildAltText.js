const { slugify } = require('./slugify');
const imageDesc = require('./altText');

/**
 * Picks an alt text set for a page and stamps the location onto it — plus the
 * business name, but ONLY on the About Us / home page.
 *
 * WHY THE BUSINESS NAME IS LIMITED
 * Repeating it in every alt attribute across every page adds nothing for a
 * screen reader and reads as keyword stuffing to a search engine. The home
 * page is where the business identity belongs; a service or location page is
 * better served by describing the image and naming the place.
 *
 * Set selection:
 *   - index === 'aboutIndex'  -> set 0 (reserved for the About Us page)
 *   - any other index         -> sets 1-10, cycling via (index % 10) + 1
 */
function buildAltText(globalValues, index) {
  const location = globalValues.location;
  const businessType = slugify(globalValues.businessType);
  const imageSets = imageDesc[businessType];

  if (!imageSets) {
    console.warn(`⚠️ No image descriptions found for business type: ${globalValues.businessType}`);
    return {};
  }

  const isAboutPage = index === 'aboutIndex';

  const setIndex = isAboutPage ? 0 : (index % 10) + 1;
  const selectedSet = imageSets[setIndex];

  if (!selectedSet) {
    console.warn(`⚠️ Missing alt text set ${setIndex} for business type: ${businessType}`);
    return {};
  }

  const result = {};

  for (const [key, desc] of Object.entries(selectedSet)) {
    result[key] = isAboutPage
      ? `${desc} from ${globalValues.businessName} in ${location}`
      : `${desc} in ${location}`;
  }

  return result;
}

module.exports = { buildAltText };