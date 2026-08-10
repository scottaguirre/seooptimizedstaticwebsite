// Auto-loads every category file in this folder.
//
// To add a new business category: drop in <slug>.js exporting an array of 11
// objects. The filename must match the slug produced by slugify(businessType).
//
// Files starting with '_' are treated as shared helpers and skipped.

const fs = require('fs');
const path = require('path');

const EXPECTED_SETS = 11;

const imageDesc = {};

for (const file of fs.readdirSync(__dirname)) {
  if (file === 'index.js' || file.startsWith('_') || !file.endsWith('.js')) continue;

  const slug = path.basename(file, '.js');
  const sets = require(path.join(__dirname, file));

  if (!Array.isArray(sets)) {
    console.warn(`⚠️ altText/${file}: expected an array, got ${typeof sets}. Skipping.`);
    continue;
  }

  if (sets.length !== EXPECTED_SETS) {
    console.warn(
      `⚠️ altText/${file}: expected ${EXPECTED_SETS} sets (1 About + 10 rotation), got ${sets.length}. ` +
      `Pages may fall back to empty alt text.`
    );
  }

  imageDesc[slug] = sets;
}

module.exports = imageDesc;