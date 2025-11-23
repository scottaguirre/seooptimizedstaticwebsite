// utils/wpThemeBuilder/index.js

const path = require('path');

// File helpers
const {
  readFile,
  writeFile,
  listHtmlFiles,
  copyDirRecursive,
  ensureDir,
  fileExists,
} = require('./wpHelpers/fileHelpers');

// Extractors
const {
  extractPageContent,
  flattenContentForMeta,
  getExtractionSummary,
} = require('./extractors/contentExtractor');

// Generators
const { generateFunctionsPhp } = require('./generators/functionsPhp');
const { generateThemeActivationPhp } = require('./generators/themeActivationPhp');
const { generateMetaBoxesPhp } = require('./generators/metaBoxesPhp');
const { generateThemeSettingsPhp } = require('./generators/themeSettingsPhp');
const { generateTemplateHelpersPhp } = require('./generators/templateHelpersPhp');
const { generateHeaderPhp } = require('./generators/headerPhp');
const { generateFooterPhp } = require('./generators/footerPhp');
const { generateFrontPagePhp } = require('./generators/frontPagePhp');
const {
  generatePagePhp,
  generatePageSlugTemplate,
  generateIndexPhp,
} = require('./generators/pageTemplatePhp');
const { generateStyleCss } = require('./generators/styleCss');

// Data file generators
const {
  generateThemePagesPhp,
  buildPageDefinitions,
  addLegalPages,
  sortPagesByMenuOrder,
} = require('./dataFiles/themePages');
const {
  generateThemeContentPhp,
  filterEmptyFields,
  getContentSummary,
} = require('./dataFiles/themeContent');
const {
  generateGlobalSettingsPhp,
  extractGlobalFromContent,
  mergeGlobalSettings,
  normalizeSocialUrls,
} = require('./dataFiles/globalSettings');

/**
 * Main function: Build a complete WordPress theme from static HTML
 *
 * @param {string} distDir - Path to the static build directory (e.g., /dist/user_123)
 * @param {object} options - Configuration options
 * @param {string} options.themeSlug - Theme slug (default: 'local-business-theme')
 * @param {string} options.themeName - Theme display name
 * @param {string} options.themeAuthor - Theme author name
 * @param {string} options.themeVersion - Theme version
 * @param {object} options.globalSettings - Manual global settings (optional)
 * @returns {Promise<object>} - { themeSlug, themeDir }
 */
async function buildWordPressTheme(distDir, options = {}) {
  console.log('🚀 Starting WordPress theme build...');

  // Extract options with defaults
  const {
    themeSlug = 'local-business-theme',
    themeName = 'Local Business Theme',
    themeAuthor = 'Static Website Generator',
    themeVersion = '1.0.0',
    globalSettings = {},
  } = options;

  // 1. Setup theme directory structure
  console.log('📁 Creating theme directory structure...');
  const wpThemeRoot = path.join(distDir, 'wp-theme', themeSlug);
  const incDir = path.join(wpThemeRoot, 'inc');

  await ensureDir(wpThemeRoot);
  await ensureDir(incDir);

  // 2. Find and process HTML files
  console.log('🔍 Scanning HTML files...');
  const htmlFiles = await listHtmlFiles(distDir);

  if (htmlFiles.length === 0) {
    throw new Error('No HTML files found in dist directory. Cannot build WordPress theme.');
  }

  console.log(`   Found ${htmlFiles.length} HTML file(s)`);

  // Storage for extracted content
  const allPageContent = {};
  const pageDefinitions = [];
  let extractedGlobalSettings = {};

  // 3. Process each HTML file
  for (const filename of htmlFiles) {
    const filePath = path.join(distDir, filename);
    const html = await readFile(filePath);
    const baseName = filename.replace(/\.html$/i, '');

    console.log(`   Processing: ${filename}`);

    // Extract content from HTML
    const extracted = extractPageContent(html);
    const summary = getExtractionSummary(extracted);

    console.log(`      - Sections: ${summary.sectionCount}`);
    console.log(`      - Has hero: ${summary.hasHeroH1}`);
    console.log(`      - Social links: ${summary.socialPlatforms.join(', ') || 'none'}`);

    // Flatten content for post meta (this preserves HTML in paragraphs)
    const flatContent = flattenContentForMeta(extracted);

    // Log if we found images in the content
    const hasImages = Object.values(flatContent).some(val => 
      String(val).includes('<img') || String(val).includes('src=')
    );
    if (hasImages) {
      console.log(`      - Contains images: Yes`);
    }

    // Determine page slug and title
    let slug = baseName;
    let title = extracted.hero?.h1 || extracted.meta?.title || baseName;

    // Clean up title
    title = title.replace(/\s*\|.*$/, '').trim(); // Remove " | Business Name"
    if (title.length > 60) {
      title = title.substring(0, 60).trim() + '...';
    }

    // Format title (capitalize words)
    title = title
      .split(/[\s-]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');

    // Determine if this is the front page
    const isFrontPage = baseName === 'index' || baseName === 'about' || baseName === 'home';

    // Store content
    if (isFrontPage) {
      slug = 'about'; // Normalize to "about"
      allPageContent[slug] = flatContent;
    } else {
      allPageContent[slug] = flatContent;
    }

    // Add to page definitions
    pageDefinitions.push({
      title,
      slug,
      isFrontPage,
      menuOrder: isFrontPage ? 0 : pageDefinitions.length + 1,
    });

    // Extract global settings from first file (usually index.html)
    if (filename === 'index.html' || filename === htmlFiles[0]) {
      extractedGlobalSettings = extractGlobalFromContent(extracted);
    }
  }

  // 4. Merge global settings (manual options override extracted)
  console.log('⚙️  Processing global settings...');
  const finalGlobalSettings = normalizeSocialUrls(
    mergeGlobalSettings(extractedGlobalSettings, globalSettings)
  );

  console.log(`   Business: ${finalGlobalSettings.business_name || 'N/A'}`);
  console.log(`   Phone: ${finalGlobalSettings.phone || 'N/A'}`);
  console.log(`   Email: ${finalGlobalSettings.email || 'N/A'}`);

  // 5. Add legal pages
  const allPages = addLegalPages(pageDefinitions);
  const sortedPages = sortPagesByMenuOrder(allPages);

  // 6. Filter empty content
  const cleanedContent = filterEmptyFields(allPageContent);
  const contentSummary = getContentSummary(cleanedContent);

  console.log('📊 Content summary:');
  Object.entries(contentSummary).forEach(([slug, count]) => {
    console.log(`   ${slug}: ${count} fields`);
  });

  // 7. Generate core PHP files
  console.log('✏️  Generating PHP files...');

  // Detect CSS and JS files
  const cssDir = path.join(distDir, 'css');
  const jsDir = path.join(distDir, 'js');

  let cssFiles = [];
  let hasBootstrapJs = false;

  if (fileExists(cssDir)) {
    const fs = require('fs');
    cssFiles = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
  }

  if (fileExists(jsDir)) {
    const fs = require('fs');
    const jsFiles = fs.readdirSync(jsDir);
    hasBootstrapJs = jsFiles.includes('bootstrap.bundle.min.js');
  }

  // Generate functions.php
  await writeFile(
    path.join(wpThemeRoot, 'functions.php'),
    generateFunctionsPhp({ themeSlug, themeName, cssFiles, hasBootstrapJs })
  );

  // Generate inc/ files
  await writeFile(
    path.join(incDir, 'theme-activation.php'),
    generateThemeActivationPhp({ themeSlug, themeName })
  );

  await writeFile(
    path.join(incDir, 'meta-boxes.php'),
    generateMetaBoxesPhp({ themeSlug })
  );

  await writeFile(
    path.join(incDir, 'theme-settings.php'),
    generateThemeSettingsPhp({ themeSlug, themeName })
  );

  await writeFile(
    path.join(incDir, 'template-helpers.php'),
    generateTemplateHelpersPhp({ themeSlug })
  );

  // Generate templates
  await writeFile(
    path.join(wpThemeRoot, 'header.php'),
    generateHeaderPhp({ themeSlug, themeName })
  );

  await writeFile(
    path.join(wpThemeRoot, 'footer.php'),
    generateFooterPhp({ themeSlug })
  );

  await writeFile(
    path.join(wpThemeRoot, 'front-page.php'),
    generateFrontPagePhp({ themeSlug })
  );

  await writeFile(
    path.join(wpThemeRoot, 'page.php'),
    generatePagePhp({ themeSlug })
  );

  await writeFile(
    path.join(wpThemeRoot, 'index.php'),
    generateIndexPhp({ themeSlug })
  );

  // Generate page-specific templates (except front page)
  for (const page of sortedPages) {
    if (!page.isFrontPage && page.slug !== 'about') {
      await writeFile(
        path.join(wpThemeRoot, `page-${page.slug}.php`),
        generatePageSlugTemplate(page.slug, page.title, { themeSlug })
      );
    }
  }

  // Generate style.css
  await writeFile(
    path.join(wpThemeRoot, 'style.css'),
    generateStyleCss({
      themeName,
      themeSlug,
      themeAuthor,
      themeVersion,
    })
  );

  console.log(`   Generated ${sortedPages.length + 5} PHP files`);

  // 8. Generate data files
  console.log('📄 Generating data files...');

  await writeFile(
    path.join(wpThemeRoot, 'theme-pages.php'),
    generateThemePagesPhp(sortedPages)
  );

  await writeFile(
    path.join(wpThemeRoot, 'theme-page-content.php'),
    generateThemeContentPhp(cleanedContent)
  );

  await writeFile(
    path.join(wpThemeRoot, 'theme-global-settings.php'),
    generateGlobalSettingsPhp(finalGlobalSettings)
  );

  // 9. Copy assets
  console.log('📦 Copying assets...');

  const assetDirs = ['css', 'js', 'assets', 'images', 'fonts'];

  for (const dirName of assetDirs) {
    const srcDir = path.join(distDir, dirName);
    if (fileExists(srcDir)) {
      const destDir = path.join(wpThemeRoot, dirName);
      await copyDirRecursive(srcDir, destDir);
      console.log(`   Copied: ${dirName}/`);
    }
  }

  // 10. Create README
  const readme = `# ${themeName}

This WordPress theme was automatically generated from a static HTML website.

## Installation

1. Upload the theme folder to \`wp-content/themes/\`
2. Activate the theme through the WordPress admin
3. The theme will automatically:
   - Create pages from your static site
   - Import all content
   - Set up the navigation menu
   - Configure global settings

## Editing Content

### Page Content
Edit any page through **Pages → All Pages** in WordPress admin. Each page has a "Page Content" meta box where you can edit:
- Hero section (heading, tagline)
- Section headings and paragraphs
- All text content
- Images (via HTML or media library)

### Global Settings
Edit site-wide settings through **Appearance → Theme Settings**:
- Business information
- Contact details
- Social media links

### Navigation Menu
Customize the menu through **Appearance → Menus**.

## Theme Info

- **Version**: ${themeVersion}
- **Author**: ${themeAuthor}
- **Generated**: ${new Date().toISOString()}
- **Pages**: ${sortedPages.length}
- **Sections extracted**: ${Object.values(contentSummary).reduce((a, b) => a + b, 0)} fields

## Notes

- Images are stored with WordPress template tags and will work automatically
- CSS is enqueued properly through functions.php
- All content is editable through the WordPress admin

## Support

For issues or questions, contact your developer.
`;

  await writeFile(path.join(wpThemeRoot, 'README.md'), readme);

  console.log('✅ WordPress theme build complete!');
  console.log(`   Theme directory: ${wpThemeRoot}`);

  return {
    themeSlug,
    themeDir: wpThemeRoot,
    summary: {
      pages: sortedPages.length,
      contentFields: Object.values(contentSummary).reduce((a, b) => a + b, 0),
      globalSettings: Object.keys(finalGlobalSettings).length,
    },
  };
}

module.exports = {
  buildWordPressTheme,
};