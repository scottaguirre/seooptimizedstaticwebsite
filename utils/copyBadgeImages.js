// utils/copyBadgeImages.js
//
// Copies the two hero badges into the per-user assets folder.
//
// These differ from the other predefined images in two ways: they live in
// src/predefined-images/badges/ rather than under a business-type folder,
// and they are the same two files for every site. Only the About Us page
// uses them.
//
// Missing files are warned about and skipped rather than thrown — a site
// without badges is fine; a site with two broken image icons is not.

const fs = require('fs');
const path = require('path');
const { slugify } = require('./slugify');

const BADGE_SRC_DIR = path.join(__dirname, '../src/predefined-images/badges');

const BADGES = [
  {
    field: 'awardBadge',
    filename: 'award-winning-badge.webp',
    alt: (type, location) => `Award winning ${type} in ${location}`,
  },
  {
    field: 'licensedBadge',
    filename: 'licensed-badge.webp',
    alt: (type, location) => `Licensed and insured ${type} in ${location}`,
  },
];

/**
 * @returns {{awardBadge, awardBadgeAlt, licensedBadge, licensedBadgeAlt}}
 *          Missing badges come back as empty strings, so the caller can
 *          render nothing rather than an empty src.
 */
function copyBadgeImages(distDir, globalValues = {}) {
  const result = {
    awardBadge: '',
    awardBadgeAlt: '',
    licensedBadge: '',
    licensedBadgeAlt: '',
  };

  const businessName = globalValues.businessName || '';
  const businessType = globalValues.businessType || 'services';
  const location = globalValues.location || '';

  const assetsDir = path.join(distDir, 'assets');

  try {
    fs.mkdirSync(assetsDir, { recursive: true });
  } catch (err) {
    console.warn('   ⚠️ Could not create assets folder for badges:', err.message);
    return result;
  }

  for (const badge of BADGES) {
    const src = path.join(BADGE_SRC_DIR, badge.filename);

    if (!fs.existsSync(src)) {
      console.warn(`   ⚠️ Missing badge image: ${src}`);
      continue;
    }

    const ext = path.extname(badge.filename);
    const seoPrefix = `${slugify(businessName)}-${slugify(location)}`;
    const newFilename = `${seoPrefix}-${slugify(badge.field)}${ext}`;
    const dest = path.join(assetsDir, newFilename);

    try {
      fs.copyFileSync(src, dest);
      result[badge.field] = `assets/${newFilename}`;
      result[`${badge.field}Alt`] = badge.alt(businessType, location);
    } catch (err) {
      console.warn(`   ⚠️ Could not copy ${badge.filename}:`, err.message);
    }
  }

  const copied = BADGES.filter(b => result[b.field]).length;
  if (copied) {
    console.log(`   Hero badges copied: ${copied}/${BADGES.length}`);
  }

  return result;
}

/**
 * The badge block for the hero. Returns '' when neither image exists, so the
 * markup stays clean on a site with no badges.
 */
function buildBadgesHtml(badges = {}) {
  const items = [];

  if (badges.awardBadge) {
    items.push(
      `<img class="award" src="${badges.awardBadge}" alt="${escapeAttr(badges.awardBadgeAlt)}" loading="lazy">`
    );
  }

  if (badges.licensedBadge) {
    items.push(
      `<img class="licensed" src="${badges.licensedBadge}" alt="${escapeAttr(badges.licensedBadgeAlt)}" loading="lazy">`
    );
  }

  if (!items.length) return '';

  return `<div class="badges">
        ${items.join('\n        ')}
      </div>`;
}

function escapeAttr(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

module.exports = { copyBadgeImages, buildBadgesHtml, BADGES, BADGE_SRC_DIR };