const { slugify } = require('./slugify');
const imageDesc = require('./altText');

/**
 * Picks an alt text set for a page and stamps the business name + location onto it.
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

  const setIndex = index === 'aboutIndex' ? 0 : (index % 10) + 1;
  const selectedSet = imageSets[setIndex];

  if (!selectedSet) {
    console.warn(`⚠️ Missing alt text set ${setIndex} for business type: ${businessType}`);
    return {};
  }

  const result = {};

  for (const [key, desc] of Object.entries(selectedSet)) {
    result[key] = `${desc} from ${globalValues.businessName} in ${location}`;
  }

  return result;
}

module.exports = { buildAltText };