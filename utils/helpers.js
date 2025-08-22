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
function validateGlobalFields(global) {
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

  const missing = requiredGlobalFields.filter(field => !(global[field] || '').toString().trim());

  const fields = [];
  for (const f of missing) {
    // Map to your form field names so the client can highlight them
    fields.push({ name: `global[${f}]`, message: 'Required' });
  }


  // Validate business hours input
  if (!global.is24Hours) {
    const hours = global.hours || {};
    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    const missingHours = [];

    for (const d of days) {
      const open = hours?.[d]?.open;
      const close = hours?.[d]?.close;
      if (!open || !close) {
        missingHours.push(d);
        fields.push({ name: `global[hours][${d}][open]`,  message: 'Required' });
        fields.push({ name: `global[hours][${d}][close]`, message: 'Required' });
      }
    }

    if (missingHours.length) {
      return {
        ok: false,
        error: '❌ Missing business hours configuration.',
        fields
      };
    }
  }

  if (fields.length) {
    return {
      ok: false,
      error: `❌ Missing required global fields.`,
      fields
    };
  }

  return { ok: true };
}



// 4. Send error message in JSON format. This is for form validation
function jsonValidationError(res, status, message, fields = []) {
  // fields = [{ name: 'global[favicon]', message: 'Invalid type' }, ...]
  return res.status(status).json({ error: message, fields });
}



// 5. Validate Each Page Inputs: returns { ok, error, fields } and NEVER sends a response
const validateEachPageInputs = function (pages) {
  const fields = [];

  if (!pages || typeof pages !== 'object') {
    return { ok: false, error: '❌ No pages submitted.', fields };
  }

  // Support both array-like and object-like "pages"
  for (const [index, page] of Object.entries(pages)) {
    const i = parseInt(index, 10);
    const filename = (page?.filename || '').toString().trim();

    if (!filename) {
      fields.push({ name: `pages[${i}][filename]`, message: 'Required' });
    }
    
  }

  if (fields.length) {
    return {
      ok: false,
      error: '❌ Some pages are missing required fields.',
      fields
    };
  }

  // (Optional) server-side duplicate filename check (case-insensitive)
  const names = Object.entries(pages).map(([_, p]) => (p?.filename || '').toString().trim().toLowerCase());
  const seen = new Set();
  const dupFields = [];
  names.forEach((name, i) => {
    if (!name) return;
    if (seen.has(name)) {
      dupFields.push({ name: `pages[${i}][filename]`, message: 'Duplicate filename' });
    } else {
      seen.add(name);
    }
  });
  if (dupFields.length) {
    return {
      ok: false,
      error: '❌ Duplicate page filenames detected. Filenames must be unique.',
      fields: dupFields
    };
  }

  return { ok: true };
};


module.exports = {
  cleanDirectory,
  cleanDevFolders,
  validateGlobalFields,
  jsonValidationError,
  validateEachPageInputs
  
};
