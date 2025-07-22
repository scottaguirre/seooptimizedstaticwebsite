// postcss.config.cjs
const purgecss = require('@fullhuman/postcss-purgecss').default;
const postcssImport = require('postcss-import');
const autoprefixer = require('autoprefixer');
const cssnano = require('cssnano');

module.exports = {
  plugins: [
    postcssImport,
    autoprefixer,
    cssnano({ preset: 'default' }),
    purgecss({
      content: ['./dist/**/*.html', './src/**/*.js'],
      defaultExtractor: content => content.match(/[\w-/:]+(?<!:)/g) || [],
      safelist: {
        standard: [
          'collapse', 'show', 'navbar', 'btn', 'btn-success', 'text-center', 'text-primary',
          'container', 'row', 'col', 'active', 'fab', 'dropdown', 'dropdown-toggle',
          'fa-facebook', 'fa-twitter', 'fa-instagram', 'fa-linkedin'
        ]
      }
    })
  ]
};
