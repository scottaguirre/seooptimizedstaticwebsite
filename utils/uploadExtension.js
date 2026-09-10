// utils/uploadExtension.js
//
// What file extension an uploaded image should be saved with.
//
// runGeneration used to take this straight from the upload:
//
//   const ext = path.extname(file.originalname);
//
// and hand it to assetFile(prefix, field, ext). assetFile defaults to '.webp',
// but a default only applies to `undefined` — an empty string is a value, so
// an upload whose name carried no extension produced:
//
//   <img src="assets/san-jose-lemon-law-logo">
//
// A file on disk with no extension, referenced by a URL with no extension.
// The build succeeded, the HTML validated, and the logo did not load. The
// favicon on the same page was fine, because that path hardcodes '.png'.
//
// A browser will not always give a usable originalname. A logo pasted from the
// clipboard, dragged from another tab, or picked on a phone can arrive as
// "image", "blob", or a name whose only dot is in "logo.v2". So the extension
// is resolved from what the file actually IS — its MIME type — whenever the
// name does not already end in a real image extension.

const path = require('path');

// Kept as the extension the user uploaded wherever it is legitimate: '.jpeg'
// stays '.jpeg' rather than being normalised to '.jpg', because renaming a
// file nobody asked to rename is its own small surprise.
const IMAGE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg',
  '.avif', '.ico', '.bmp', '.tif', '.tiff',
]);

const BY_MIME = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/svg+xml': '.svg',
  'image/avif': '.avif',
  'image/x-icon': '.ico',
  'image/vnd.microsoft.icon': '.ico',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
};

/**
 * @param {{originalname?: string, mimetype?: string}} file  a multer upload
 * @param {string} [fallback]  used when neither the name nor the MIME type
 *        identifies an image. '.png' rather than '.webp': a mystery upload is
 *        far more likely to be a PNG, and either way the bytes are unchanged —
 *        only the name is being decided here.
 * @returns {string} an extension including the leading dot, never ''
 */
function imageExtension(file, fallback = '.png') {
  const named = path.extname(String((file && file.originalname) || '')).toLowerCase();
  if (IMAGE_EXTENSIONS.has(named)) return named;

  // 'image/png; charset=binary' turns up from some clients.
  const mime = String((file && file.mimetype) || '')
    .toLowerCase()
    .split(';')[0]
    .trim();

  if (BY_MIME[mime]) return BY_MIME[mime];

  return fallback;
}

module.exports = { imageExtension, IMAGE_EXTENSIONS, BY_MIME };
