const path = require('path');
const fs  = require('fs');
const fsp = fs.promises;



const { formatCityForSchema } = require('../utils/formatCityForSchema'); // city only  :contentReference[oaicite:3]{index=3}
const { formatCityState }     = require('../utils/formatCityState');     // "City, ST"  :contentReference[oaicite:4]{index=4}
const { slugify }             = require('../utils/slugify');
const {
  slugCollisions,
  similarServices,
  collisionMessage,
  overlapMessage,
} = require('../utils/serviceNames');
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



/**
 * Is this a dialable North American phone number?
 *
 * WHY A FORMAT CHECK EXISTS AT ALL — 21 September
 *
 * `phone` was in requiredGlobalFields, so a BLANK one was rejected. Nothing
 * checked the format, and `<input type="tel">` does no format validation in
 * browsers — unlike type="email", it accepts any string. So "x", "555" and
 * "call me" all passed every layer and generated a complete site:
 *
 *     title   Acme Plumbing in Austin, TX | Call call me
 *     link    tel:+1
 *
 * That string goes into every page title, every meta description, the
 * LocalBusiness schema and every click-to-call link, and the build charges
 * 500 credits. The customer finds out when nobody rings.
 *
 * WHAT COUNTS AS VALID
 *
 * Ten digits, or eleven beginning with 1. Punctuation and spaces are ignored
 * entirely — "(512) 894-6167", "512-894-6167", "512.894.6167" and
 * "+1 512 894 6167" are the same number, and rejecting a customer's preferred
 * formatting would be a worse bug than the one this fixes.
 *
 * A leading + is allowed and stripped. Anything else non-numeric is allowed in
 * the input and ignored; what matters is the digit count, because that is what
 * decides whether tel: produces a working link.
 *
 * NOT an E.164 or international validator. This product sells US local-SEO
 * sites and every other part of it assumes that — formatPhoneForHref() hard-
 * codes +1, and the state list in validateAndNormalizeLocationPages is US
 * only. If that ever changes, this is one of the places that has to change
 * with it.
 */
function isDialablePhone(value) {
  const digits = String(value || '').replace(/\D/g, '');

  if (digits.length === 10) return true;
  if (digits.length === 11 && digits.startsWith('1')) return true;

  return false;
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

  // A phone that is present but not dialable. Only checked when one was
  // supplied — a blank phone is already reported as Required above, and two
  // messages on one field would be noise.
  const phone = (global.phone || '').toString().trim();
  if (phone && !isDialablePhone(phone)) {
    fields.push({
      name: 'global[phone]',
      message: 'Enter a 10-digit phone number, e.g. (512) 894-6167',
    });
  }


  // 4. Validate business hours input
  //
  // `hourFields`, NOT `fields`. This block used to declare its own
  // `const fields = []`, which SHADOWED the outer array — so when the hours
  // were wrong, the early return below sent back only the hours problems and
  // silently discarded every field error collected above it.
  //
  // A customer with a missing business name AND a bad closing time was told
  // about the closing time, fixed it, resubmitted, and only then learned about
  // the business name. Two round-trips for one form.
  //
  // It also swallowed the phone check added directly above, which is how this
  // was noticed.
  if (!global.is24Hours) {
    const hours = global.hours || {};
    const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
    const hourFields = [];

    const truthy = v => v === true || v === 'true' || v === 'on' || v === '1';

    for (const d of days) {
      const day = hours?.[d] || {};
      const isClosed = truthy(day.closed);
      const open = (day.open || '').toString().trim();
      const close = (day.close || '').toString().trim();

      if (!isClosed) {
        if (!open)  hourFields.push({ name: `global[hours][${d}][open]`,  message: 'Required' });
        if (!close) hourFields.push({ name: `global[hours][${d}][close]`, message: 'Required' });

        // Optional sanity: open must be before close (both "HH:MM" 24h)
        if (open && close && open >= close) {
          hourFields.push({ name: `global[hours][${d}][close]`, message: 'Must be after open' });
        }
      }
    }

    if (hourFields.length) {
      // Everything wrong with the form, in one response. The error line still
      // names the hours because that is the headline when they are broken.
      fields.push(...hourFields);
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

  /**
   * 6.1 Two services that would write to the same file.
   *
   * This compared the LOWERCASED TEXT, which is not the same question. The
   * filename comes from slugify(), which also strips commas and punctuation —
   * so "Drain Cleaning" and "Drain, Cleaning" are two different strings, pass
   * this check, and then both write drain-cleaning-austin-tx.html. The second
   * silently overwrites the first, and the customer has paid 100 credits for a
   * page that no longer exists. Nothing reported it.
   *
   * Comparing slugs asks the question that actually matters: will these two
   * end up as one file? Identical text still collides, so this is strictly
   * broader than the check it replaces.
   */
  const names = Object.entries(pages).map(([_, p]) => (p?.filename || '').toString().trim());
  const collisions = slugCollisions(names);

  if (collisions.length) {
    const dupFields = [];
    collisions.forEach(collision => {
      // Every name in the group is flagged, not just the later ones: the
      // customer has to choose which to rename, and highlighting one of a
      // pair implies the other is the correct one.
      collision.indexes.forEach(i => {
        dupFields.push({ name: `pages[${i}][filename]`, message: 'Would become the same page as another service' });
      });
    });

    return {
      ok: false,
      error: `❌ ${collisionMessage(collisions)}`,
      fields: dupFields
    };
  }

  /**
   * 6.2 Services that are not the same page, but are arguably the same thing.
   *
   * A warning, deliberately: "Water Heater Repair" and "Tankless Water Heater
   * Repair" score as similar and are a reasonable pair of pages to want. This
   * returns ok:true and lets the caller decide what to do about it.
   */
  const overlaps = similarServices(names);

  return overlaps.length
    ? { ok: true, warnings: overlaps, warning: overlapMessage(overlaps) }
    : { ok: true };
};


// 7. === Location Pages helpers

/**
 * Split "Austin, TX", "Austin TX" or bare "Austin" into comparable parts.
 *
 * Lower-cased with whitespace collapsed, because this is only ever used for
 * comparison — never for display. Returns null for anything with no city.
 */
function parsePlace(value) {
  const text = String(value || '').trim();
  if (!text) return null;

  const m = text.match(/^(.+?)[,\s]+([A-Za-z]{2})$/);
  const city = (m ? m[1] : text).toLowerCase().replace(/\s+/g, ' ').trim();
  const state = m ? m[2].toLowerCase() : '';

  return city ? { city, state } : null;
}

/**
 * Are these the same town?
 *
 * The state is compared only when BOTH sides have one. "Round Rock" and
 * "Round Rock, TX" are the same place typed two ways, and a customer who
 * entered their main location without a state should still be stopped from
 * adding it again as a location page.
 *
 * Two towns with the same name in different states — Austin, TX and Austin,
 * MN — are correctly treated as different.
 */
function samePlace(a, b) {
  if (!a || !b || a.city !== b.city) return false;
  return !a.state || !b.state || a.state === b.state;
}

/**
 * @param {Array}  rawList       the location page entries
 * @param {*}      toggleValue   global.addLocations
 * @param {string} [mainLocation] global.location — the site's own town
 *
 * WHY mainLocation IS CHECKED — 21 September
 *
 * A location page for the site's OWN town duplicates the home page. It always
 * did on content; what made it worth blocking was the Rank Fast home title
 * changing to "{name} in {city, state}", which made the location page's title
 * an exact prefix of it:
 *
 *     home      Emergency Plumber Round Rock in Round Rock, TX | Call (512) 894-6167
 *     location  Emergency Plumber Round Rock in Round Rock, TX
 *
 * Two pages, near-identical titles, near-identical content, no canonical
 * saying which wins — which is the "Duplicate without user-selected canonical"
 * report in Search Console, self-inflicted.
 *
 * The existing dedupe below compares entries against EACH OTHER. It never
 * looked at the site's own location, so this was reachable by a customer
 * typing their own town in the list — an easy thing to do, since the field
 * does not say not to.
 */
function validateAndNormalizeLocationPages(rawList, toggleValue, mainLocation = '') {
  if (!truthy(toggleValue)) return { ok: true, locations: [], fields: [] };

  const arr = Array.isArray(rawList) ? rawList : (rawList ? [rawList] : []);
  if (!arr.length) {
    return { ok:false, error:'❌ Location pages enabled but no locations provided.',
             fields:[{ name:'global[locationPages][]', message:'Add at least one location' }]};
  }

  const fields = [];
  const locations = [];
  const seen = new Set();

  // The site's own town, parsed once. null when no main location was supplied,
  // which disables the check rather than rejecting everything.
  const mainPlace = parsePlace(mainLocation);

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

    // The site's own town. A page for it duplicates the home page — same
    // content, and since 20 September a title that is a prefix of the home
    // page's. Checked before the dedupe below, which only ever compared
    // entries against each other.
    if (samePlace(parsePlace(`${cityRaw} ${state}`), mainPlace)) {
      fields.push({
        name: `global[locationPages][${i}]`,
        message: 'Your home page already covers this town — remove it, or use a different one',
      });
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

const { quote } = require('./pricing');

function countPages(pagesData) {
  if (Array.isArray(pagesData)) return pagesData.length;
  if (pagesData && typeof pagesData === 'object') return Object.keys(pagesData).length;
  return 0;
}

/**
 * Read-only affordability check. Never mutates the user.
 *
 * Pricing moved to utils/pricing.js so the wizard's displayed total and the
 * server's charge come from one place — they used to be able to disagree,
 * and the server's number is the one that takes the credits.
 *
 * @param {object} user
 * @param {object} pagesData        service pages
 * @param {object} [opts]
 * @param {string} [opts.siteMode]      'lead' | 'sample'
 * @param {number} [opts.locationPages] how many location pages
 */
function checkCredits(user, pagesData, opts = {}) {
  // Back-compat: this used to take a costPerPage number as the third
  // argument. Anything numeric is ignored rather than silently mispricing.
  const options = (typeof opts === 'object' && opts !== null) ? opts : {};

  const siteMode = options.siteMode === 'sample' ? 'sample' : 'lead';
  const pagesCount = countPages(pagesData);
  const locationPages = Math.max(0, Number(options.locationPages) || 0);

  const { total, lines } = quote({
    siteMode,
    servicePages: pagesCount,
    locationPages,
  });

  const available = Number(user?.credits || 0);

  // A sample needs no service pages; a lead-generation site does.
  const hasEnoughPages = siteMode === 'sample' ? true : pagesCount > 0;

  return {
    ok: hasEnoughPages && available >= total,
    siteMode,
    pagesCount,
    locationPages,
    totalCost: total,
    lines,
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
  validateAndNormalizeLocationPages,
  // Exported for test-location-pages.js, which tests the town comparison
  // directly rather than only through the validator.
  parsePlace,
  samePlace,
  isDialablePhone
};