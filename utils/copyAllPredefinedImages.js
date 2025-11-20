const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');

/**
 * Copy a single predefined image into the *per-user* distDir/assets folder,
 * and register its relative path in uploadedImages[index][field].
 */
function copyPageImage({
  srcDir,
  filename,
  field,
  businessName,
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

  let seoPrefix = `${slugify(businessName)}-`;
  seoPrefix += (imageContext === 'imageLocationPages')
    ? `${slugify(keyword)}`
    : `${slugify(keyword)}-${slugify(location)}`;

  const newFilename = `${seoPrefix}-${field}${ext}`;
  const dest = path.join(assetsDir, newFilename);

  fs.copyFileSync(src, dest);

  const imagePath = `assets/${newFilename}`;

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
    businessName: globalValues.businessName,
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
