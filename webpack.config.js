const path = require('path');
const fs = require('fs');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const Critters = require('critters-webpack-plugin');
const { PurgeCSSPlugin } = require('purgecss-webpack-plugin');
const glob = require('glob');

// ========== Dynamic build folder (per user) ==========
// Example: BUILD_SUBDIR=user_653f2a... -> dist/user_653f2a...
const buildSubdir = process.env.BUILD_SUBDIR || '';
const distPath = path.resolve(__dirname, 'dist', buildSubdir);

// Collect HTML files for this build
let htmlFiles = [];
if (fs.existsSync(distPath)) {
  htmlFiles = fs.readdirSync(distPath).filter(f => f.endsWith('.html'));
} else {
  console.warn(`⚠️ distPath "${distPath}" does not exist. No HTML files found for Webpack.`);
}

// Build JS entrypoints for pages that have a matching stub in src/js/<name>.js
// e.g. index.html -> src/js/index.js, privacy-policy.html -> src/js/privacy-policy.js
const entries = {};
htmlFiles.forEach(file => {
  const name = path.basename(file, '.html');
  const jsPath = path.resolve(__dirname, 'src/js', `${name}.js`);
  if (fs.existsSync(jsPath)) {
    entries[name] = jsPath;
  }
});

module.exports = {
  mode: 'production',
  entry: entries,
  output: {
    // IMPORTANT: write back into the same user's folder, not global dist/
    path: distPath,
    filename: 'js/[name].[contenthash].js',
    // Do NOT clean the folder; we don't want to delete HTML or assets
    clean: false
  },
  module: {
    rules: [
      // Keep JS simple – no Babel needed if you're just using basic syntax
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

    // One HtmlWebpackPlugin instance per HTML file in this user's folder
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

    // Purge unused CSS per user's HTML/JS
    new PurgeCSSPlugin({
      // Look only inside this user's dist folder
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
