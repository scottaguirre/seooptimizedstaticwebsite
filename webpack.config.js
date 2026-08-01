const path = require('path');
const fs = require('fs');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const Critters = require('critters-webpack-plugin');
const { PurgeCSSPlugin } = require('purgecss-webpack-plugin');
const glob = require('glob');

// ========== Build folder resolution ==========
// Preferred: BUILD_DIR is an absolute path to the folder being optimized.
//   e.g. BUILD_DIR=/srv/app/builds/work/user_653f2a...
// Fallback (legacy): BUILD_SUBDIR names a folder inside dist/
//   e.g. BUILD_SUBDIR=user_653f2a...  ->  dist/user_653f2a...
const buildDirEnv = process.env.BUILD_DIR || '';
const buildSubdir = process.env.BUILD_SUBDIR || '';

const distPath = buildDirEnv
  ? path.resolve(buildDirEnv)
  : path.resolve(__dirname, 'dist', buildSubdir);

// Entry stubs live INSIDE the build folder so concurrent builds never collide.
// (They used to live in the shared src/js folder.)
const entryDir = path.join(distPath, '_src', 'js');

// Collect HTML files for this build (top level only)
let htmlFiles = [];
if (fs.existsSync(distPath)) {
  htmlFiles = fs.readdirSync(distPath).filter(f => f.endsWith('.html'));
} else {
  console.warn(`⚠️ distPath "${distPath}" does not exist. No HTML files found for Webpack.`);
}

// Build JS entrypoints for pages that have a matching stub in <build>/_src/js/<name>.js
// e.g. index.html -> _src/js/index.js, privacy-policy.html -> _src/js/privacy-policy.js
const entries = {};
htmlFiles.forEach(file => {
  const name = path.basename(file, '.html');
  const jsPath = path.join(entryDir, `${name}.js`);
  if (fs.existsSync(jsPath)) {
    entries[name] = jsPath;
  } else {
    console.warn(`⚠️ No entry stub for "${file}" (looked for ${jsPath})`);
  }
});

module.exports = {
  mode: 'production',
  entry: entries,
  output: {
    // Write back into the same build folder
    path: distPath,
    filename: 'js/[name].[contenthash].js',
    // Do NOT clean the folder; we don't want to delete HTML or assets
    clean: false
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: [MiniCssExtractPlugin.loader, 'css-loader']
      },
      {
        // If you ever import images in JS/CSS, they'll go into assets/
        test: /\.(png|jpe?g|gif|webp|svg)$/i,
        type: 'asset/resource',
        generator: {
          filename: 'assets/[name][ext]'
        }
      }
    ]
  },
  plugins: [
    // One CSS bundle per entry (index, privacy-policy, etc.)
    new MiniCssExtractPlugin({
      filename: 'css/[name].[contenthash].css'
    }),

    // One HtmlWebpackPlugin instance per HTML file in this build folder
    ...htmlFiles.map(file => {
      const name = path.basename(file, '.html');
      const chunks = entries[name] ? [name] : [];

      return new HtmlWebpackPlugin({
        filename: file,                       // overwrite same filename
        template: path.join(distPath, file),  // use the already-generated HTML
        chunks,
        inject: 'body',
        minify: {
          collapseWhitespace: true,
          removeComments: true,
          removeRedundantAttributes: true,
          removeEmptyAttributes: true,
          useShortDoctype: true
        }
      });
    }),

    // Inline critical CSS into each HTML
    new Critters({
      preload: 'swap',
      pruneSource: false
    }),

    // Purge unused CSS against this build's HTML/JS only
    new PurgeCSSPlugin({
      paths: glob.sync(`${distPath}/**/*.{html,js}`, { nodir: true }),
      safelist: {
        standard: [
          // Bootstrap & common layout classes you don't want PurgeCSS to kill
          /^nav/, /^navbar/, /^collapse/, /^show/, /^dropdown/,
          /^modal/, /^fade/, /^btn/, /^row/, /^col-/,
          /^container/, /^offcanvas/, /^accordion/, /^alert/
        ]
      }
    })
  ]
};