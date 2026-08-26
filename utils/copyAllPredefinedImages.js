const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');
const { assetFile, assetPath } = require('./seoPresets');

/**
 * Copy a single predefined image into the *per-user* distDir/assets folder,
 * and register its relative path in uploadedImages[index][field].
 */
function copyPageImage({
  srcDir,
  filename,
  field,
  businessType,
  keyword,
  location,
  index,
  uploadedImages,
  imageContext,
  distDir
}) {
  const src = path.join(srcDir, filename);
  if (!fs.existsSync(src)) {
    console.warn(`⚠️ Missing: ${src}`);
    return;
  }

  // ✅ Use the per-user distDir instead of a global ../dist/assets
  const assetsDir = path.join(distDir, 'assets');
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }

  const ext = path.extname(filename); // get original extension

  // The business name is deliberately NOT here.
  //
  // It used to lead every filename on every page, which repeated it dozens of
  // times across a site for no benefit — the home page is where the business
  // identity belongs. buildAboutUsPage keeps it for that page alone.
  //
  //   service page   water-heater-repair-leander-tx-hero-desktop.webp
  //   location page  plumbing-austin-tx-hero-desktop.webp
  //
  // A location page leads with the TRADE rather than the location alone, so
  // the filename says what the image is of as well as where.
  //
  // THIS PREFIX DOES NOT VARY BY SITE MODE, AND MUST NOT.
  //
  // Rank Fast drops the prefix on the index page, which is safe there because
  // a site has exactly one index page. Every service page and every location
  // page copies from a DIFFERENT source folder into the SAME field names
  // ('heroMobile', 'section2Img1', ...) inside this one assets/ folder. Drop
  // the prefix here and the last page built silently overwrites every earlier
  // page's images — the build succeeds, every page renders, and every page
  // shows the same photographs.
  const seoPrefix = (imageContext === 'imageLocationPages')
    ? `${slugify(businessType)}-${slugify(keyword)}`
    : `${slugify(keyword)}-${slugify(location)}`;

  const dest = path.join(assetsDir, assetFile(seoPrefix, field, ext));

  fs.copyFileSync(src, dest);

  // Same helper as the filename above, so the <img src> and the file on disk
  // can never disagree about the naming convention.
  const imagePath = assetPath(seoPrefix, field, ext);

  // Assign this image to every page that cycles to this set
  uploadedImages[index] ||= {};
  uploadedImages[index][field] = imagePath;
}

/**
 * Copy ALL predefined images (hero + section2 + section4) for a given page
 * into the *per-user* distDir/assets folder.
 */
function copyAllPredefinedImages({
  distDir,
  globalValues,
  uploadedImages,
  keyword,
  index,
  imageContext
}) {
  const imageIndex = index % 10;
  const folder = `page${imageIndex + 1}`;
  const businessType = slugify(globalValues.businessType);

  const baseDir = path.join(
    __dirname,
    `../src/predefined-images/${businessType}/${folder}`
  );
  const heroDir = path.join(baseDir, 'hero');
  const section2Dir = path.join(baseDir, 'section2');
  const section4Dir = path.join(baseDir, 'section4');

  const params = {
    // businessType, not businessName: see the filename comment in
    // copyPageImage above.
    businessType: globalValues.businessType,
    keyword,
    location: globalValues.location,
    index,
    uploadedImages,
    imageContext,
    distDir             // 👈 pass distDir down to copyPageImage
  };

  // Hero images
  copyPageImage({ ...params, srcDir: heroDir, filename: 'hero-mobile.webp',  field: 'heroMobile' });
  copyPageImage({ ...params, srcDir: heroDir, filename: 'hero-tablet.webp',  field: 'heroTablet' });
  copyPageImage({ ...params, srcDir: heroDir, filename: 'hero-desktop.webp', field: 'heroDesktop' });
  copyPageImage({ ...params, srcDir: heroDir, filename: 'hero-large.webp',   field: 'heroLarge' });

  // Section 2 images
  copyPageImage({ ...params, srcDir: section2Dir, filename: 'section2-1.webp', field: 'section2Img1' });
  copyPageImage({ ...params, srcDir: section2Dir, filename: 'section2-2.webp', field: 'section2Img2' });

  // Section 4 images
  copyPageImage({ ...params, srcDir: section4Dir, filename: 'section4-1.webp', field: 'section4Img1' });
  copyPageImage({ ...params, srcDir: section4Dir, filename: 'section4-2.webp', field: 'section4Img2' });
}

module.exports = { copyAllPredefinedImages };