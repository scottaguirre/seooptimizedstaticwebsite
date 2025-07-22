const path = require('path');
const fs = require('fs');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const Critters = require('critters-webpack-plugin');
const CopyPlugin = require('copy-webpack-plugin');
const { PurgeCSSPlugin } = require('purgecss-webpack-plugin');
const glob = require('glob');
const { zip } = require('zip-a-folder');

// === Paths ===
const distPath = path.resolve(__dirname, 'dist');
const htmlFiles = fs.readdirSync(distPath).filter(f => f.endsWith('.html'));

// ✅ Define before using
const entries = {};
const htmlPlugins = [];

htmlFiles.forEach(file => {
  const name = file.replace('.html', '');
  entries[name] = path.resolve(__dirname, `src/js/${name}.js`);
  htmlPlugins.push(
    new HtmlWebpackPlugin({
      filename: `${name}.html`,
      template: path.resolve(distPath, file),
      inject: 'body',
      chunks: [name], // ✅ THIS LINE prevents cross-injection
      publicPath: '/', 
      minify: {
        collapseWhitespace: true,
        removeComments: true,
        minifyCSS: true,
        minifyJS: true,
        removeRedundantAttributes: true
      }
    })
  );
});

module.exports = {
  mode: 'production',
  entry: entries,
  output: {
    path: distPath,
    filename: 'js/[name].[contenthash].js',
    clean: {
      keep: /assets\// // ✅ Retain images & uploaded files
    }
  },
  module: {
    rules: [
      {
        test: /\.css$/i,
        use: [
          MiniCssExtractPlugin.loader,
          'css-loader',
          'postcss-loader' // Make sure you have postcss.config.cjs setup
        ]
      },
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: ['babel-loader'] // Optional but helpful if using modern JS
      }
    ]
  },
  plugins: [
    new MiniCssExtractPlugin({
      filename: 'css/[name].[contenthash].css'
    }),
    ...htmlPlugins,
    new Critters({
      preload: 'swap',
      pruneSource: true
    }),
    new CopyPlugin({
      patterns: [
        { from: 'public/uploads', to: 'assets', noErrorOnMissing: true },
        { from: 'src/assets', to: 'assets', noErrorOnMissing: true }
      ]
    }),
    new PurgeCSSPlugin({
      paths: glob.sync(`${distPath}/**/*.html`, { nodir: true }),
      safelist: {
        standard: [
          /^navbar/, /^btn/, /^collapse/, /^show/, /^active/,
          /^container/, /^row/, /^col-/, /^d-/, /^text-/, /^bg-/,
          /^shadow/, /^rounded/, /^p-/, /^m-/, /^justify-/,
          /^align-/, /^mt-/, /^mb-/, /^pt-/, /^pb-/, /^dropdown/,
          /^dropdown-toggle/, /^dropdown-menu/, /^fab/
        ]
      }
    }),
    {
      apply: (compiler) => {
        compiler.hooks.afterEmit.tapPromise('ZipAfterBuildPlugin', async () => {
          const outputZip = path.join(__dirname, 'dist.zip');
          await zip(distPath, outputZip);
          console.log('✅ Zipped: dist.zip');
        });
      }
    }
  ]
};
