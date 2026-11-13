// utils/logoSizes.js
//
// Rendered logo dimensions, by shape.
//
// These are the width/height attributes written into every template, so they
// reserve the right space and prevent layout shift.
//
// THIS LIVES IN ITS OWN FILE BECAUSE THREE CALLERS NEED THE SAME NUMBERS.
// It used to be a const inside runGeneration.js, which was correct while the
// only consumer was the build. A wordmark has to be DRAWN at this size, and
// the review step has to PREVIEW it at this size, so the table is now read by:
//
//   utils/runGeneration.js        writes logoWidth/logoHeight into globalValues
//   utils/wordmarkLogo.js         sizes the canvas it draws on
//   routes/logoPreviewRoute.js    renders the preview the user approves
//
// A second copy anywhere means the preview can disagree with the site, which
// is the one defect a preview exists to prevent.

const LOGO_SIZES = {
  square: { width: 120, height: 120 },  // 1:1
  rect:   { width: 150, height: 100 },  // 3:2
  wide:   { width: 250, height: 100 },  // 5:2 — long horizontal logos
};

/**
 * The box for a shape, falling back to `rect`.
 *
 * Rectangular is the fallback because it is what an absent or unrecognised
 * logoType has always meant here — see the `|| 'rect'` the wizard's hidden
 * field has been defaulted to since the shape radios went in. Changing the
 * fallback would silently resize the logo on every historical job replayed
 * from a payload written before the field existed.
 */
function logoSize(logoType) {
  const key = String(logoType == null ? '' : logoType).trim().toLowerCase();
  return LOGO_SIZES[key] || LOGO_SIZES.rect;
}

module.exports = { LOGO_SIZES, logoSize };
