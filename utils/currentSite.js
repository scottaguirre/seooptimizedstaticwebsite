// utils/currentSite.js
//
// Describes the site a user last generated, so the dashboard can offer
// preview / download / convert links.
//
// Without this, those buttons exist on exactly one page — the one shown
// immediately after generating. Pressing "Go Back", converting to WordPress,
// closing the tab or returning tomorrow all lose them, and the only way back
// is to regenerate, which spends credits and produces different copy.

const fs = require('fs');
const path = require('path');

const projectRoot = path.join(__dirname, '..');
const baseDistDir = path.join(projectRoot, 'dist');
const zipRoot = path.join(projectRoot, 'builds', 'zips');

/** "2 hours ago", "just now" — friendlier than a timestamp for a 24h TTL. */
function relativeTime(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

/**
 * @returns {object|null} null when the user has no generated site, so the
 *          dashboard can simply omit the card.
 */
function getCurrentSite(userId) {
  const id = String(userId);
  const distDir = path.join(baseDistDir, `user_${id}`);

  try {
    if (!fs.existsSync(distDir)) return null;

    const pages = fs.readdirSync(distDir).filter(f => f.endsWith('.html'));
    if (!pages.length) return null;

    // Business name and page counts come from the model the generator wrote.
    let businessName = '';
    let location = '';
    let generatedAt = null;
    let serviceCount = 0;
    let locationCount = 0;

    const modelPath = path.join(distDir, '_src', 'content.json');
    if (fs.existsSync(modelPath)) {
      try {
        const model = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
        businessName = (model.global && model.global.businessName) || '';
        location = (model.global && model.global.location) || '';
        generatedAt = model.generatedAt ? new Date(model.generatedAt) : null;
        serviceCount = (model.pages || []).filter(p => p.type === 'service').length;
        locationCount = (model.pages || []).filter(p => p.type === 'location').length;
      } catch (err) {
        // Corrupt model shouldn't hide the card; fall back to file mtime.
      }
    }

    if (!generatedAt) {
      try {
        generatedAt = fs.statSync(path.join(distDir, pages[0])).mtime;
      } catch (err) {
        generatedAt = new Date();
      }
    }

    return {
      distDir,
      businessName,
      location,
      generatedAt,
      generatedAgo: relativeTime(generatedAt),
      pageCount: pages.length,
      serviceCount,
      locationCount,
      previewUrl: `/dist/user_${id}`,
      hasStaticZip: fs.existsSync(path.join(zipRoot, `user_${id}.zip`)),
      hasWpZip: fs.existsSync(path.join(zipRoot, `user_${id}_wp-theme.zip`)),
    };

  } catch (err) {
    console.error('Could not read current site:', err.message);
    return null;
  }
}

module.exports = { getCurrentSite, relativeTime };