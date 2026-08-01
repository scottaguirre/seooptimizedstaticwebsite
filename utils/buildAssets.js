// utils/buildAssets.js
//
// Everything a generated site needs now lives inside that user's own
// dist folder (dist/user_<id>/). Nothing is written to the shared src/
// folders, so two users generating at the same time can never clobber
// each other's files.
//
// Layout inside a user's build folder:
//   dist/user_<id>/
//     index.html, <page>-<location>.html, ...
//     assets/                 images
//     css/                    bootstrap.min.css + one .css per page
//     js/                     bootstrap.bundle.min.js
//     _src/js/                Webpack entry stubs (stripped before zipping)

const fs = require('fs');
const path = require('path');
const { resolveThemeCss } = require('./helpers');

const srcCssDir = path.join(__dirname, '../src/css');
const srcJsDir = path.join(__dirname, '../src/js');

/**
 * Standard sub-paths for one user's build folder.
 */
function getUserDirs(baseDistDir, userId) {
  const distDir = path.join(baseDistDir, `user_${String(userId)}`);
  return {
    distDir,
    assetsDir: path.join(distDir, 'assets'),
    cssDir: path.join(distDir, 'css'),
    jsDir: path.join(distDir, 'js'),
    entryDir: path.join(distDir, '_src', 'js'),
  };
}

/**
 * Copy the read-only vendor files out of src/ into this user's build folder.
 * Safe to call repeatedly; only copies when missing.
 */
function copyVendorAssets({ cssDir, jsDir }) {
  fs.mkdirSync(cssDir, { recursive: true });
  fs.mkdirSync(jsDir, { recursive: true });

  const vendorCss = path.join(srcCssDir, 'bootstrap.min.css');
  const vendorJs = path.join(srcJsDir, 'bootstrap.bundle.min.js');

  const destCss = path.join(cssDir, 'bootstrap.min.css');
  const destJs = path.join(jsDir, 'bootstrap.bundle.min.js');

  if (fs.existsSync(vendorCss) && !fs.existsSync(destCss)) {
    fs.copyFileSync(vendorCss, destCss);
  } else if (!fs.existsSync(vendorCss)) {
    console.warn(`⚠️ Missing vendor CSS: ${vendorCss}`);
  }

  if (fs.existsSync(vendorJs) && !fs.existsSync(destJs)) {
    fs.copyFileSync(vendorJs, destJs);
  } else if (!fs.existsSync(vendorJs)) {
    console.warn(`⚠️ Missing vendor JS: ${vendorJs}`);
  }
}

/**
 * Copy the chosen theme stylesheet into this user's css folder as <cssName>.css.
 * Replaces the old "write to src/css then copy to dist/css" double-write.
 */
function writePageCss({ cssDir, cssName, styleKey }) {
  fs.mkdirSync(cssDir, { recursive: true });

  const dest = path.join(cssDir, `${cssName}.css`);
  if (fs.existsSync(dest)) return dest;

  const srcCssTheme = resolveThemeCss(styleKey || 'style');
  fs.copyFileSync(srcCssTheme, dest);
  return dest;
}

/**
 * Write the Webpack entry stub for a page.
 *
 * entryName MUST match the HTML filename without the extension, because
 * webpack.config.js pairs each <name>.html with _src/js/<name>.js.
 *
 * cssName is the stylesheet the page's HTML links to, which is not always
 * the same as entryName (service pages link ./css/<filename>.css but their
 * HTML file is <filename>-<location>.html).
 */
function writeEntryStub({ distDir, entryName, cssName }) {
  const entryDir = path.join(distDir, '_src', 'js');
  fs.mkdirSync(entryDir, { recursive: true });

  const stubPath = path.join(entryDir, `${entryName}.js`);
  if (fs.existsSync(stubPath)) return stubPath;

  // Paths are relative to _src/js/ -> ../../css and ../../js
  const content = `// Auto-generated Webpack entry stub for ${entryName}
import '../../css/bootstrap.min.css';
import '../../css/${cssName}.css';
import '../../js/bootstrap.bundle.min.js';
`;

  fs.writeFileSync(stubPath, content);
  return stubPath;
}

/**
 * Convenience: create both the stylesheet and the entry stub for one page.
 */
function writePageAssets({ distDir, cssDir, entryName, cssName, styleKey }) {
  const css = cssName || entryName;
  writePageCss({ cssDir, cssName: css, styleKey });
  writeEntryStub({ distDir, entryName, cssName: css });
}

module.exports = {
  getUserDirs,
  copyVendorAssets,
  writePageCss,
  writeEntryStub,
  writePageAssets,
};