// utils/wpThemeBuilder/buildFromModel.js
//
// Builds a WordPress theme from content.json instead of scraping the
// generated HTML.
//
// The old path (index.js) regex-parsed the HTML back into structure, which
// lost every field name and produced admin labels like "Block 3 -> Heading 2 #1".
// This path reads the semantic model the generator already produced, so each
// field keeps its real name and the theme renders pages from those fields.

const path = require('path');

const {
  writeFile,
  ensureDir,
  fileExists,
  copyDirRecursive,
  deleteFile,
} = require('./wpHelpers/fileHelpers');

const { makePhpIdentifier } = require('./wpHelpers/phpHelpers');

// Unchanged generators, reused as-is
const { generateFunctionsPhp } = require('./generators/functionsPhp');
const { generateHeaderPhp, generateNavHelpersPhp } = require('./generators/headerPhp');
const { generateFooterPhp } = require('./generators/footerPhp');
const { generateThemeSettingsPhp } = require('./generators/themeSettingsPhp');
const { generateTemplateHelpersPhp } = require('./generators/templateHelpersPhp');
const { generateContactFormHandlerPhp } = require('./generators/contactFormHandlerPhp');
const { generateContactFormJs } = require('./generators/contactFormJs');
const { generateStyleCss } = require('./generators/styleCss');

// NOTE: blog automation used to be generated here (blog-automation-settings /
// -engine / -scheduler). It has been removed. Scheduled posting now lives in
// the Interlink Engine plugin, which keeps the OpenAI key on our server rather
// than in the customer's WordPress database, and which survives a theme change.
// The theme still styles and lists posts via single.php / home.php.

// New / rewritten
const { generateSectionRendererPhp } = require('./generators/sectionRendererPhp');
const { generateMetaBoxesPhp } = require('./generators/metaBoxesPhp');
const { generateThemeActivationPhp } = require('./generators/themeActivationPhp');
const { generateThemeModelPhp } = require('./dataFiles/themeModel');
const {
  generateFrontPagePhp,
  generateSinglePhp,
  generateHomePhp,
  generatePagePhp,
  generatePageSlugTemplate,
  generateIndexPhp,
} = require('./generators/pageTemplatesPhp');

const { readModel } = require('../contentModel');
const { getHoursTimeText } = require('../formatDaysAndHoursForDisplay');


/**
 * Build a theme from the generator's semantic model.
 *
 * @param {string} distDir  dist/user_<id>
 * @param {object} options  themeSlug, themeName, themeAuthor, themeVersion
 * @returns {Promise<object>} { themeSlug, themeDir, summary }
 */
async function buildWordPressThemeFromModel(distDir, options = {}) {
  const {
    themeSlug = 'local-business-theme',
    themeName = 'Local Business Theme',
    themeAuthor = 'Static Website Generator',
    themeVersion = '1.0.0',
    // Where the theme folder is created. Defaults to inside distDir for
    // backwards compatibility, but callers should pass a path OUTSIDE dist/
    // so the theme never ends up inside the static site's ZIP.
    outputRoot = null,
  } = options;

  const model = readModel(distDir);
  if (!model) {
    throw new Error('No content.json found. Regenerate the site before exporting to WordPress.');
  }

  console.log('🚀 Building WordPress theme from content model...');
  console.log(`   Model version ${model.version}, ${model.pages.length} page(s)`);

  const funcPrefix = makePhpIdentifier(themeSlug);

  // 1. Directories
  const wpThemeRoot = outputRoot
    ? path.join(outputRoot, themeSlug)
    : path.join(distDir, 'wp-theme', themeSlug);
  const incDir = path.join(wpThemeRoot, 'inc');
  const jsDir = path.join(wpThemeRoot, 'js');

  await ensureDir(wpThemeRoot);
  await ensureDir(incDir);
  await ensureDir(jsDir);

  // 2. Hours are stored structurally in the model; render once for display
  const hoursText = getHoursTimeText(
    model.global.is24Hours,
    model.global.hours || {}
  );

  // 3. Detect assets so functions.php enqueues the right stylesheets
  const fs = require('fs');
  const cssDir = path.join(distDir, 'css');
  const jsSourceDir = path.join(distDir, 'js');

  let cssFiles = [];
  let hasBootstrapJs = false;

  if (fileExists(cssDir)) {
    cssFiles = fs.readdirSync(cssDir).filter(f => f.endsWith('.css'));
  }
  if (fileExists(jsSourceDir)) {
    hasBootstrapJs = fs.readdirSync(jsSourceDir).includes('bootstrap.bundle.min.js');
  }

  // 4. Core PHP
  await writeFile(
    path.join(wpThemeRoot, 'functions.php'),
    generateFunctionsPhp({
      themeSlug,
      themeName,
      cssFiles,
      hasBootstrapJs,
      // Changes on every export, which is the whole point: it answers "are
      // these theme files different from the ones already installed?"
      //
      // Not style.css's Version, which is the same string on every rebuild.
      // And not model.generatedAt, which is stamped when the SITE is
      // generated — re-exporting a theme after a generator fix would reuse
      // yesterday's stamp and skip the purge, which is exactly the case this
      // is here to catch.
      buildStamp: new Date().toISOString(),
    })
  );

  await writeFile(
    path.join(incDir, 'section-renderer.php'),
    generateSectionRendererPhp({ themeSlug, styleKey: model.global && model.global.styleKey })
  );

  await writeFile(
    path.join(incDir, 'meta-boxes.php'),
    generateMetaBoxesPhp({ themeSlug })
  );

  await writeFile(
    path.join(incDir, 'theme-activation.php'),
    generateThemeActivationPhp({ themeSlug, themeName })
  );

  await writeFile(
    path.join(incDir, 'theme-settings.php'),
    generateThemeSettingsPhp({ themeSlug, themeName })
  );

  await writeFile(
    path.join(incDir, 'template-helpers.php'),
    generateTemplateHelpersPhp({ themeSlug })
  );

  await writeFile(
    path.join(incDir, 'template-nav.php'),
    generateNavHelpersPhp({ themeSlug })
  );

  await writeFile(
    path.join(incDir, 'contact-form-handler.php'),
    generateContactFormHandlerPhp({ themeSlug })
  );

  await writeFile(
    path.join(jsDir, 'contact-form-handler.js'),
    generateContactFormJs()
  );

  // 4b. Remove blog-automation files left behind by an older build.
  //
  // buildFromModel() is often pointed at a theme directory that already
  // exists. Dropping the writeFile calls above stops NEW themes shipping the
  // old automation, but a rebuilt theme would keep the stale inc/*.php files
  // on disk — and functions.php no longer requires them, so they would sit
  // there dead, registering nothing but still visible to anyone reading the
  // folder. Delete them explicitly.
  for (const stale of [
    'blog-automation-settings.php',
    'blog-automation-engine.php',
    'blog-automation-scheduler.php',
  ]) {
    await deleteFile(path.join(incDir, stale));
  }

  // 5. Layout
  await writeFile(path.join(wpThemeRoot, 'header.php'), generateHeaderPhp({ themeSlug, themeName }));
  await writeFile(path.join(wpThemeRoot, 'footer.php'), generateFooterPhp({ themeSlug }));
  await writeFile(path.join(wpThemeRoot, 'front-page.php'), generateFrontPagePhp({ themeSlug }));
  await writeFile(path.join(wpThemeRoot, 'page.php'), generatePagePhp({ themeSlug }));
  await writeFile(path.join(wpThemeRoot, 'index.php'), generateIndexPhp({ themeSlug }));
  await writeFile(path.join(wpThemeRoot, 'single.php'), generateSinglePhp({ themeSlug }));
  await writeFile(path.join(wpThemeRoot, 'home.php'), generateHomePhp({ themeSlug }));

  // 6. One template per non-front page
  let templateCount = 0;
  for (const page of model.pages) {
    if (page.isFrontPage) continue;
    await writeFile(
      path.join(wpThemeRoot, `page-${page.slug}.php`),
      generatePageSlugTemplate(page.slug, page.title || page.slug, { themeSlug })
    );
    templateCount++;
  }

  // 7. style.css (theme header)
  await writeFile(
    path.join(wpThemeRoot, 'style.css'),
    generateStyleCss({ themeName, themeSlug, themeAuthor, themeVersion })
  );

  // 8. The content model itself
  await writeFile(
    path.join(wpThemeRoot, 'theme-content-model.php'),
    generateThemeModelPhp(model, { hoursText })
  );

  // 9. Assets
  for (const dirName of ['css', 'js', 'assets', 'images', 'fonts']) {
    const srcDir = path.join(distDir, dirName);
    if (fileExists(srcDir)) {
      await copyDirRecursive(srcDir, path.join(wpThemeRoot, dirName));
    }
  }

  // 9b. Canonical stylesheet.
  //
  // The generator writes one identical copy of the chosen theme per page.
  // functions.php enqueues theme.css on EVERY request, so without this file
  // client-created pages and blog posts 404 on their only stylesheet and lose
  // the whole design. Three sources are tried in order, and a failure throws
  // rather than warning, because a theme without it is broken.
  {
    const themeCssDir = path.join(wpThemeRoot, 'css');
    fs.mkdirSync(themeCssDir, { recursive: true });

    const target = path.join(themeCssDir, 'theme.css');
    let copiedFrom = null;

    const candidates = [];

    // 1. the front page's stylesheet, already copied into the theme
    candidates.push(path.join(themeCssDir, 'index.css'));

    // 2. any other non-vendor stylesheet in the theme
    if (fileExists(themeCssDir)) {
      fs.readdirSync(themeCssDir)
        .filter(f => f.endsWith('.css') && !/^bootstrap/i.test(f) && f !== 'theme.css')
        .forEach(f => candidates.push(path.join(themeCssDir, f)));
    }

    // 3. the original theme source, in case the per-page copies are missing
    try {
      const { resolveThemeCss } = require('../helpers');
      candidates.push(resolveThemeCss((model.global && model.global.styleKey) || 'style'));
    } catch (err) {
      console.warn('   Could not resolve the theme source stylesheet:', err.message);
    }

    for (const candidate of candidates) {
      if (candidate && fileExists(candidate)) {
        fs.copyFileSync(candidate, target);
        copiedFrom = candidate;
        break;
      }
    }

    if (!copiedFrom || !fileExists(target)) {
      throw new Error(
        'Could not create css/theme.css — the theme would render unstyled. ' +
        `Looked in ${themeCssDir} and the theme sources.`
      );
    }

    console.log(`   Canonical stylesheet: css/theme.css (from ${path.basename(copiedFrom)})`);
  }

  // 10. Counts for the success screen
  let fieldCount = 0;
  let imageCount = 0;
  for (const page of model.pages) {
    for (const s of page.sections || []) {
      if (s.heading) fieldCount++;
      if (s.subheading) fieldCount++;
      fieldCount += (s.paragraphs || []).length;
      imageCount += (s.images || []).length;
    }
  }

  await writeFile(path.join(wpThemeRoot, 'README.md'), `# ${themeName}

Generated from the site generator's content model.

## Installing

1. Appearance -> Themes -> Add New -> Upload Theme
2. Upload the ZIP and activate
3. Pages, content and the menu are created automatically

## Editing

**Pages -> All Pages -> (any page)**

Every section appears with its own name. You can:

- edit any heading or paragraph
- select text and add a link, or highlight it with the colour buttons
- replace any image from the media library
- add extra sections at the bottom of a page (text, image, or both)

**Appearance -> Theme Settings** holds the business name, phone, email,
address and social links. Change the phone number once and it updates
everywhere on the site.

## Theme info

- Version: ${themeVersion}
- Author: ${themeAuthor}
- Generated: ${new Date().toISOString()}
- Pages: ${model.pages.length}
- Editable text fields: ${fieldCount}
- Replaceable images: ${imageCount}
`);

  console.log('✅ WordPress theme built from model');

  return {
    themeSlug,
    themeDir: wpThemeRoot,
    summary: {
      pages: model.pages.length,
      contentFields: fieldCount,
      images: imageCount,
      templates: templateCount,
      globalSettings: Object.keys(model.global || {}).length,
    },
  };
}

module.exports = {
  buildWordPressThemeFromModel,
};