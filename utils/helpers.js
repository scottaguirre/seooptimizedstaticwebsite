const path = require('path');
const fs  = require('fs');
const fsp = fs.promises;



const { formatCityForSchema } = require('../utils/formatCityForSchema'); // city only  :contentReference[oaicite:3]{index=3}
const { formatCityState }     = require('../utils/formatCityState');     // "City, ST"  :contentReference[oaicite:4]{index=4}
const { slugify }             = require('../utils/slugify');
function truthy(v){ return v === true || v === 'true' || v === 'on' || v === '1'; }

const US = new Set(['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME',
  'MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN',
  'TX','UT','VT','VA','WA','WV','WI','WY','DC']);



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

  // Clean src/css/ but keep theme files and bootstrap.min.css
  const themesDir = path.join(srcCssDir, 'themes');

  fs.readdirSync(srcCssDir, { withFileTypes: true }).forEach(entry => {
    // Skip the themes directory entirely
    if (entry.isDirectory() && entry.name === 'themes') return;

    if (entry.isFile() && entry.name.endsWith('.css') && entry.name !== 'bootstrap.min.css') {
      fs.unlinkSync(path.join(srcCssDir, entry.name));
    }
  });



  // Clean dist subdirectories
  [distDir, assetsDir, cssDir, jsDir].forEach(cleanDirectory);

  // Ensure folders exist
  [tempUploadDir, distDir, assetsDir, cssDir, jsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });

}

  // 2.1 Cleand temp upload files
  async function moveOrCopyThenDelete(src, dest) {
    try {
      await fsp.rename(src, dest);           // same disk: atomic move (src gone)
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;   // different device: copy+delete
      await fsp.copyFile(src, dest);
      await fsp.unlink(src);
    }
  }



// 3. Validate Global Fields
function validateGlobalFields(global) {
  const requiredGlobalFields = [
    'businessName',
    'businessType',
    'domain',
    'phone',
    'address',
    'location',
    'email'
  ];

  const missing = requiredGlobalFields.filter(field => !(global[field] || '').toString().trim());

  const fields = [];
  for (const f of missing) {
    // Map to your form field names so the client can highlight them
    fields.push({ name: `global[${f}]`, message: 'Required' });
  }


  // 4. Validate business hours input
  if (!global.is24Hours) {
    const hours = global.hours || {};
    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    const fields = [];

    const truthy = v => v === true || v === 'true' || v === 'on' || v === '1';

    for (const d of days) {
      const day = hours?.[d] || {};
      const isClosed = truthy(day.closed);
      const open = (day.open || '').toString().trim();
      const close = (day.close || '').toString().trim();

      if (!isClosed) {
        if (!open)  fields.push({ name: `global[hours][${d}][open]`,  message: 'Required' });
        if (!close) fields.push({ name: `global[hours][${d}][close]`, message: 'Required' });

        // Optional sanity: open must be before close (both "HH:MM" 24h)
        if (open && close && open >= close) {
          fields.push({ name: `global[hours][${d}][close]`, message: 'Must be after open' });
        }
      }
    }

    if (fields.length) {
      return { ok: false, error: '❌ Missing/invalid business hours.', fields };
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



// 5. Send error message in JSON format. This is for form validation
function jsonValidationError(res, status, message, fields = []) {
  return res.status(status).json({ error: message, fields });
}



// 6. Validate Each Page Inputs: returns { ok, error, fields } and NEVER sends a response
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

  // 6.1 (Optional) server-side duplicate filename check (case-insensitive)
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


// 7. === Location Pages helpers
function validateAndNormalizeLocationPages(rawList, toggleValue) {
  if (!truthy(toggleValue)) return { ok: true, locations: [], fields: [] };

  const arr = Array.isArray(rawList) ? rawList : (rawList ? [rawList] : []);
  if (!arr.length) {
    return { ok:false, error:'❌ Location pages enabled but no locations provided.',
             fields:[{ name:'global[locationPages][]', message:'Add at least one location' }]};
  }

  const fields = [];
  const locations = [];
  const seen = new Set();

  arr.forEach((raw, i) => {
    const s = (raw || '').trim();
    const m = s.match(/^(.+?)[,\s]+([A-Za-z]{2})$/); // "City, ST" or "City ST"
    if (!m) {
      fields.push({ name:`global[locationPages][${i}]`, message:'Use "City, ST" or "City ST" (e.g., "Austin, TX")' });
      return;
    }
    const cityRaw  = m[1].trim();
    const state    = m[2].toUpperCase();
    if (!US.has(state)) {
      fields.push({ name:`global[locationPages][${i}]`, message:'Invalid state code' });
      return;
    }

    // Normalized display (for titles/H1/etc.) e.g., "Austin, TX"
    const display = formatCityState(`${cityRaw} ${state}`);  // :contentReference[oaicite:5]{index=5}
    // City-only for JSON-LD addressLocality e.g., "Austin"
    const cityForSchema = formatCityForSchema(`${cityRaw} ${state}`); // :contentReference[oaicite:6]{index=6}
    // File/URL slug e.g., "austin-tx"
    const slug = `${cityRaw} ${state}`;

    if (seen.has(slug)) {
      fields.push({ name:`global[locationPages][${i}]`, message:'Duplicate location' });
      return;
    }
    seen.add(slug);

    locations.push({ cityForSchema, state, display, slug });
  });

  if (fields.length) return { ok:false, error:'❌ Some location entries are invalid.', fields };
  return { ok:true, locations, fields };
}

// 8 Escape Attribute Helper
const escapeAttr = (s = '') =>
  String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');


// 9 Select CSS Them. Prefer /src/css/themes/<styleKey>.css, else /src/css/<styleKey>.css
function resolveThemeCss(styleKey) {
  const safe = String(styleKey || 'style').trim().replace(/[^a-z0-9_-]/gi, '');
  const themesPath = path.join(__dirname, '../src/css/themes', `${safe}.css`);
  const rootPath   = path.join(__dirname, '../src/css',        `${safe}.css`);
  if (fs.existsSync(themesPath)) return themesPath;
  if (fs.existsSync(rootPath))   return rootPath;
  throw new Error(
    `Theme CSS not found for "${safe}". Looked in:\n- ${themesPath}\n- ${rootPath}`
  );
}






module.exports = {
  truthy,
  escapeAttr,
  cleanDirectory,
  cleanDevFolders,
  resolveThemeCss,
  jsonValidationError,
  validateGlobalFields,
  moveOrCopyThenDelete,
  validateEachPageInputs,
  validateAndNormalizeLocationPages
};
