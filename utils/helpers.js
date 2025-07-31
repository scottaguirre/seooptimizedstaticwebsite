const fs = require('fs');
const path = require('path');


// 1.  Utility to Recursively Clean a Directory ===
function cleanDirectory(dirPath) {
  if (fs.existsSync(dirPath)) {
    fs.readdirSync(dirPath).forEach(file => {
      const filePath = path.join(dirPath, file);
      if (fs.lstatSync(filePath).isDirectory()) {
        cleanDirectory(filePath);
        fs.rmdirSync(filePath);
      } else {
        fs.unlinkSync(filePath);
      }
    });
  }
}

// 2. Utility to Clean JS/CSS & Ensure Dist Structure ===
function cleanDevFolders({
  srcJsDir,
  srcCssDir,
  distDir,
  assetsDir,
  cssDir,
  jsDir,
  tempUploadDir
}) {
  const keepJs = ['bootstrap.bundle.min.js'];
  const keepCss = ['style.css', 'bootstrap.min.css'];

  // Clean src/js/ but keep bootstrap.bundle.min.js 
  fs.readdirSync(srcJsDir).forEach(file => {
    if (file.endsWith('.js') && !keepJs.includes(file)) {
      fs.unlinkSync(path.join(srcJsDir, file));
  
    }
  });

  // Clean src/css/ but keep style.css & bootstrap.min.css
  fs.readdirSync(srcCssDir).forEach(file => {
    if (file.endsWith('.css') && !keepCss.includes(file)) {
      fs.unlinkSync(path.join(srcCssDir, file));
     
    }
  });

  // Clean dist subdirectories
  [distDir, assetsDir, cssDir, jsDir].forEach(cleanDirectory);

  // Ensure folders exist
  [tempUploadDir, distDir, assetsDir, cssDir, jsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}


// 3. Validate Global Fields
function validateGlobalFields(global, res) {
  const requiredGlobalFields = [
    'businessName',
    'businessType',
    'domain',
    'email',
    'phone',
    'address',
    'facebookUrl',
    'twitterUrl',
    'linkedinUrl',
    'youtubeUrl',
    'instagramUrl',
    'pinterestUrl'
  ];

  const missing = requiredGlobalFields.filter(field => !global[field]?.trim());

  if (missing.length > 0) {
    res.status(400).send(`❌ Missing required global fields: ${missing.join(', ')}`);
    return false;
  }

  // Validate business hours input
  if (!global.is24Hours && (!global.hours || Object.keys(global.hours).length === 0)) {
    res.status(400).send('❌ Missing business hours configuration.');
    return false;
  }


  return true;
}


module.exports = {
  cleanDirectory,
  cleanDevFolders,
  validateGlobalFields
  
};
