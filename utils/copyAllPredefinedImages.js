
const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');
const assetsDir = path.join(__dirname, '../dist/assets');

function ensureAssetsDir() {
  if (!fs.existsSync(assetsDir)) {
    fs.mkdirSync(assetsDir, { recursive: true });
  }
}

function copyPageImage({
  srcDir,
  filename,
  field,
  businessName,
  keyword,
  location,
  index,
  uploadedImages
}) {
  const src = path.join(srcDir, filename);
  if (!fs.existsSync(src)) {
    console.warn(`⚠️ Missing: ${src}`);
    return;
  }

  ensureAssetsDir();
  const ext = path.extname(filename); // get original extension
  const seoPrefix = `${slugify(businessName)}-${slugify(keyword)}-${slugify(location)}`;
  const newFilename = `${seoPrefix}-${field}${ext}`;
  const dest = path.join(assetsDir, newFilename);

  fs.copyFileSync(src, dest);
  const imagePath = `assets/${newFilename}`;

  // Assign this image to every page that cycles to this set
  uploadedImages[index] ||= {};
  uploadedImages[index][field] = imagePath;
    
  
}



function copyAllPredefinedImages({ globalValues,
                                   uploadedImages,
                                   keyword,
                                   index
                                 }) {

    const imageIndex = index % 10;
    const folder = `page${imageIndex + 1}`;
    const businessType = slugify(globalValues.businessType);
  
    const baseDir = path.join(__dirname, `../src/predefined-images/${businessType}/${folder}`);
    const heroDir = path.join(baseDir, 'hero');
    const section2Dir = path.join(baseDir, 'section2');
    const section4Dir = path.join(baseDir, 'section4');
  
    const params = {
      businessName: globalValues.businessName,
      keyword,
      location: globalValues.location,
      index,
      uploadedImages
    };
  
    copyPageImage({ ...params, srcDir: heroDir, filename: 'hero-mobile.webp', field: 'heroMobile' });
    copyPageImage({ ...params, srcDir: heroDir, filename: 'hero-tablet.webp', field: 'heroTablet' });
    copyPageImage({ ...params, srcDir: heroDir, filename: 'hero-desktop.webp', field: 'heroDesktop' });
    copyPageImage({ ...params, srcDir: heroDir, filename: 'hero-large.webp', field: 'heroLarge' });
  
    copyPageImage({ ...params, srcDir: section2Dir, filename: 'section2-1.webp', field: 'section2Img1' });
    copyPageImage({ ...params, srcDir: section2Dir, filename: 'section2-2.webp', field: 'section2Img2' });
  
    copyPageImage({ ...params, srcDir: section4Dir, filename: 'section4-1.webp', field: 'section4Img1' });
    copyPageImage({ ...params, srcDir: section4Dir, filename: 'section4-2.webp', field: 'section4Img2' });
  }
  

  module.exports = { copyAllPredefinedImages };