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
    // Remove the directory and everything inside it
    fs.rmSync(dirPath, { recursive: true, force: true });
  }
}


// 2. Utility to Reset a Single User's Build Folder ===
//
// IMPORTANT: this used to also delete files from the shared src/js and
// src/css folders. That made concurrent generations unsafe: one user's
// request would delete another user's Webpack entry stubs mid-build.
//
// src/ is now treated as a READ-ONLY template source. Everything a build
// writes lives under the user's own dist folder, so resetting one user
// can never affect another.
function resetUserDirs({
  distDir,
  assetsDir,
  cssDir,
  jsDir,
  entryDir,
  tempUploadDir
}) {
  // Wipe this user's previous build entirely (distDir contains the others)
  cleanDirectory(distDir);

  // Recreate the folder structure
  [tempUploadDir, distDir, assetsDir, cssDir, jsDir, entryDir].forEach(dir => {
    if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  });
}


// 2.05 Recursive directory copy (used by the production build step)
// Implemented manually rather than via fs.cp so this works on Node < 16.7
function copyDirRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
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

    // Compare case-insensitively. "Austin, TX" and "austin, tx" both slugify
    // to austin-tx, so treating them as distinct produced two location pages
    // writing to the same file and sharing one interlink key.
    const dedupeKey = slug.toLowerCase().replace(/\s+/g, ' ').trim();

    if (seen.has(dedupeKey)) {
      fields.push({ name:`global[locationPages][${i}]`, message:'Duplicate location' });
      return;
    }
    seen.add(dedupeKey);

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

// 10  ======= CREDITS =======
//
// Checking and charging are deliberately separate.
//
// The old checkCredits() deducted inside the check, which meant
// /api/check-credits spent a user's balance without generating anything,
// nothing was refunded when a build failed, and POSTing straight to
// /generate skipped billing entirely.
//
// Now: count -> check (read only) -> generate -> charge on success.

function countPages(pagesData) {
  if (Array.isArray(pagesData)) return pagesData.length;
  if (pagesData && typeof pagesData === 'object') return Object.keys(pagesData).length;
  return 0;
}

/**
 * Read-only affordability check. Never mutates the user.
 */
function checkCredits(user, pagesData, costPerPage = 1) {
  const pagesCount = countPages(pagesData);
  const totalCost = pagesCount * costPerPage;
  const available = Number(user?.credits || 0);

  return {
    ok: pagesCount > 0 && available >= totalCost,
    pagesCount,
    totalCost,
    available,
  };
}

/**
 * Deduct credits. Call only after the work has actually succeeded.
 */
async function chargeCredits(user, totalCost) {
  const cost = Number(totalCost || 0);
  if (!user || cost <= 0) return user ? user.credits : 0;

  user.credits = Math.max(0, Number(user.credits || 0) - cost);
  await user.save();
  return user.credits;
}


// 11 ======= YouTube Video Iframe for About Us Page =======
function buildYouTubeEmbedHtml(videoUrl, businessName, location) {
  if (!videoUrl) return '';

  const trimmed = String(videoUrl).trim();
  if (!trimmed) return '';

  // Try to extract video ID from different YouTube URL formats
  const match = trimmed.match(
    /(?:youtu\.be\/|v=|embed\/|shorts\/)([A-Za-z0-9_-]{6,})/
  );
  const videoId = match ? match[1] : null;
  const embedUrl = videoId
    ? `https://www.youtube.com/embed/${videoId}`
    : trimmed; // fallback: use the URL as-is

  const title = `Intro video for ${businessName || ''} in ${location || ''}`.trim();

  // Just the embed — the surrounding column now lives in the template,
  // because a fallback image occupies it when there is no video.
  //
  // The .ratio wrapper matters: a bare <iframe> with no width or height
  // falls back to the browser default of 300x150px, which is what made the
  // video look tiny before.
  return `
        <div class="ratio ratio-16x9 about-video-wrapper">
          <iframe
            src="${embedUrl}"
            title="${escapeAttr(title)}"
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerpolicy="strict-origin-when-cross-origin"
            allowfullscreen></iframe>
        </div>`;
}

/**
 * The media for the location section: the YouTube embed when a URL was
 * given, otherwise the fallback image.
 *
 * Deliberately ONE decision in ONE place. Rendering both placeholders and
 * blanking one leaves two slots in the template whose relationship is not
 * visible in the markup — easy to break later.
 */
function buildAboutMediaHtml({ videoUrl, businessName, location, image, imageAlt, imageTitle }) {
  const embed = buildYouTubeEmbedHtml(videoUrl, businessName, location);
  if (embed) return embed;

  if (!image) return '';

  return `
        <img class="img-fluid" loading="lazy" src="${image}" width="400" height="600"
             alt="${escapeAttr(imageAlt || '')}" title="${escapeAttr(imageTitle || imageAlt || '')}">`;
}



module.exports = {
  truthy,
  escapeAttr,
  countPages,
  checkCredits,
  chargeCredits,
  cleanDirectory,
  resetUserDirs,
  copyDirRecursive,
  resolveThemeCss,
  jsonValidationError,
  validateGlobalFields,
  moveOrCopyThenDelete,
  buildYouTubeEmbedHtml,
  buildAboutMediaHtml,
  validateEachPageInputs,
  validateAndNormalizeLocationPages
};