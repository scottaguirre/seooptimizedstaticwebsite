// utils/wpThemeBuilder.js
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

/**
 * Split a full HTML document into:
 *  - headerHtml  (<!DOCTYPE> .. </header> OR up to <body>)
 *  - bodyContent (between </header> and <footer>)
 *  - footerHtml  (<footer> .. end of document)
 *
 * This assumes your layout follows your template:
 *  <header id="headerColor"> ... </header>
 *  ...
 *  <footer ...> ... </footer>
 */

function makePhpIdentifier(slug) {
    return slug.replace(/[^a-zA-Z0-9_]/g, '_') || 'lb_theme';
}


function injectWpNavMenu(headerPhp) {
    if (!headerPhp) return headerPhp;
  
    // Replace the whole Bootstrap nav container with a wp_nav_menu() block
    const navRegex = /<div class="collapse navbar-collapse container-nav-menu" id="navbarNav">[\s\S]*?<\/div>/i;
  
    if (!navRegex.test(headerPhp)) {
      return headerPhp; // fallback: do nothing if pattern isn't found
    }
  
    const wpNavBlock = `
        <div class="collapse navbar-collapse container-nav-menu" id="navbarNav">
            <?php
            wp_nav_menu([
                'theme_location' => 'primary',
                'container'      => false,
                'menu_class'     => 'navbar-nav ms-auto',
                'fallback_cb'    => false
            ]);
            ?>
        </div>`.trim();
  
    return headerPhp.replace(navRegex, wpNavBlock);
  }
  

  
function splitHtmlLayout(html) {
  let footerHtml = '';
  let headerAndBody = html;

  // 1) Extract footer: everything from <footer ...> to the end
  const footerMatch = html.match(/<footer[\s\S]*$/i);
  if (footerMatch) {
    footerHtml = footerMatch[0];
    headerAndBody = html.slice(0, footerMatch.index);
  }

  // 2) Split header/body at </header> if present
  let headerHtml = '';
  let bodyContent = headerAndBody;

  const headerMatch = headerAndBody.match(/<\/header>\s*/i);
  if (headerMatch) {
    const headerEndIdx = headerMatch.index + headerMatch[0].length;
    headerHtml = headerAndBody.slice(0, headerEndIdx);
    bodyContent = headerAndBody.slice(headerEndIdx);
  } else {
    // Fallback: split after <body> tag if no </header> is found
    const bodyTagMatch = headerAndBody.match(/<body[^>]*>/i);
    if (bodyTagMatch) {
      const bodyStartIdx = bodyTagMatch.index + bodyTagMatch[0].length;
      headerHtml = headerAndBody.slice(0, bodyStartIdx);
      bodyContent = headerAndBody.slice(bodyStartIdx);
    } else {
      // Worst case: treat everything as content
      headerHtml = '';
      bodyContent = headerAndBody;
    }
  }

  return { headerHtml, bodyContent, footerHtml };
}

/**
 * Inject basic WordPress hooks into header/footer chunks.
 * - Adds wp_head() before </head>
 * - Adds body_class() to <body>
 * - Adds wp_footer() before </body>
 */
function applyWordPressHooks(headerHtml, footerHtml) {
  let newHeader = headerHtml;
  let newFooter = footerHtml;

  if (newHeader) {
    // Add wp_head() before </head>
    if (newHeader.includes('</head>')) {
      newHeader = newHeader.replace(
        /<\/head>/i,
        '    <?php wp_head(); ?>\n</head>'
      );
    }

    // Add body_class() to <body>
    // Your template's <body> is plain <body>, so this is safe.
    newHeader = newHeader.replace(
      /<body([^>]*)>/i,
      (match, attrs) => `<body${attrs} <?php body_class(); ?>>`
    );
  }

  if (newFooter) {
    // Add wp_footer() before </body>
    if (newFooter.includes('</body>')) {
      newFooter = newFooter.replace(
        /<\/body>/i,
        '  <?php wp_footer(); ?>\n</body>'
      );
    }
  }

  return { headerPhp: newHeader, footerPhp: newFooter };
}

/**
 * Build a WordPress theme from the generated static build.
 *
 * distDir example: /.../dist/user_6916ceb0a6232fe9097fdcbf
 *
 * Now:
 *  - Splits index.html into header.php, footer.php, front-page.php
 *  - Adds wp_head(), wp_footer(), body_class()
 *  - Keeps index.php as simple fallback
 *  - Copies /css, /js, /assets into theme folder
 */
async function buildWordPressTheme(distDir, options = {}) {
    // 1. Check that index.html exists
    const indexHtmlPath = path.join(distDir, 'index.html');
    if (!fs.existsSync(indexHtmlPath)) {
      throw new Error(`index.html not found in ${distDir}. Run /generate first.`);
    }
  
    // 2. Theme slug & root folder
    const themeSlug = options.themeSlug || 'local-business-theme';
    const wpThemeRoot = path.join(distDir, 'wp-theme', themeSlug);
  
    // Ensure theme root exists
    await fsp.mkdir(wpThemeRoot, { recursive: true });
  
    // 3. Read index.html content
    const indexHtml = await fsp.readFile(indexHtmlPath, 'utf8');
  
    // 4. Split into header/body/footer parts
    const { headerHtml, bodyContent, footerHtml } = splitHtmlLayout(indexHtml);
  
    // 5. Apply WordPress hooks into header/footer
    const { headerPhp, footerPhp } = applyWordPressHooks(headerHtml, footerHtml);

    // 🔹 Inject wp_nav_menu into the existing Bootstrap nav
    const headerPhpWithMenu = injectWpNavMenu(headerPhp);

    // 6. Write header.php and footer.php
    const headerPhpPath = path.join(wpThemeRoot, 'header.php');
    const footerPhpPath = path.join(wpThemeRoot, 'footer.php');

    if (headerPhpWithMenu) {
    await fsp.writeFile(headerPhpPath, headerPhpWithMenu, 'utf8');
    } else {
    // fallback: minimal header if split failed badly
    await fsp.writeFile(
        headerPhpPath,
        `<!DOCTYPE html>
            <html <?php language_attributes(); ?>>
            <head>
            <meta charset="<?php bloginfo('charset'); ?>" />
            <meta name="viewport" content="width=device-width, initial-scale=1" />
            <?php wp_head(); ?>
            </head>
            <body <?php body_class(); ?>>
            `,
                'utf8'
        );
    }

  
    if (footerPhp) {
      await fsp.writeFile(footerPhpPath, footerPhp, 'utf8');
    } else {
      // Fallback: minimal footer
      await fsp.writeFile(
        footerPhpPath,
        `  <?php wp_footer(); ?>
            </body>
            </html>
         `,
        'utf8'
      );
    }
  
    // 7. Create front-page.php: just content + get_header/get_footer
    const frontPagePhpPath = path.join(wpThemeRoot, 'front-page.php');
    const content = bodyContent || indexHtml; // fallback if split fails
  
    const frontPagePhp = `<?php
    /**
     * Front Page Template
     * Auto-generated from static index.html
     */
    get_header();
    ?>
  
  ${content.trim()}
  
  <?php
  get_footer();
  `;
    await fsp.writeFile(frontPagePhpPath, frontPagePhp, 'utf8');
  
    // 8. Create index.php that simply loads front-page.php (fallback)
    const indexPhpPath = path.join(wpThemeRoot, 'index.php');
    const indexPhpContent = `<?php
    /**
     * Fallback index.php for WordPress theme.
     * For now, this simply loads front-page.php so the theme always shows the generated homepage.
     */
    if ( file_exists( get_template_directory() . '/front-page.php' ) ) {
        require get_template_directory() . '/front-page.php';
    } else {
        get_header();
        echo '<p>No front-page.php found.</p>';
        get_footer();
    }
    `;
    await fsp.writeFile(indexPhpPath, indexPhpContent, 'utf8');
  
    // 9. Create style.css with WordPress theme header
    const styleCssPath = path.join(wpThemeRoot, 'style.css');
  
    const themeName = options.themeName || 'Local Business Static Theme';
    const themeAuthor = options.themeAuthor || 'Static Website Generator';
  
    const styleCssHeader = `/*
  Theme Name: ${themeName}
  Theme URI: https://example.com/
  Author: ${themeAuthor}
  Author URI: https://example.com/
  Description: Generated from static HTML by the Static Website Generator.
  Version: 1.0.0
  License: GNU General Public License v2 or later
  License URI: https://www.gnu.org/licenses/gpl-2.0.html
  Text Domain: ${themeSlug}
  */
  `;
  
    await fsp.writeFile(styleCssPath, styleCssHeader, 'utf8');


  
    // 10. Copy css, js, assets folders if they exist in distDir
    const dirsToCopy = ['css', 'js', 'assets'];
  
    for (const dirName of dirsToCopy) {
      const srcDir = path.join(distDir, dirName);
      if (!fs.existsSync(srcDir)) continue;
  
      const destDir = path.join(wpThemeRoot, dirName);
      await copyDirRecursive(srcDir, destDir);
    }


    // 11. Create functions.php with menu registration, theme supports
const functionsPhpPath = path.join(wpThemeRoot, 'functions.php');
const phpFuncBase = makePhpIdentifier(themeSlug);

const functionsPhpContent = `<?php
/**
 * Theme setup for ${themeName}
 */
function ${phpFuncBase}_setup() {
    // Let WordPress manage the document title
    add_theme_support( 'title-tag' );

    // Support featured images if needed later
    add_theme_support( 'post-thumbnails' );

    // Register primary navigation menu
    register_nav_menus( [
        'primary' => __( 'Primary Menu', '${themeSlug}' ),
    ] );
}
add_action( 'after_setup_theme', '${phpFuncBase}_setup' );
`;

await fsp.writeFile(functionsPhpPath, functionsPhpContent, 'utf8');



  
    // 12. Generate page-*.php templates for every other HTML file
    const distFiles = await fsp.readdir(distDir);
  
    for (const file of distFiles) {
      if (!file.endsWith('.html')) continue;
      if (file === 'index.html') continue; // already used as front-page.php
  
      const fullPath = path.join(distDir, file);
      const html = await fsp.readFile(fullPath, 'utf8');
  
      // Reuse the same splitter to grab just the body content
      const { bodyContent: pageBodyContent } = splitHtmlLayout(html);
      const pageContent = (pageBodyContent || html).trim();
  
      const slug = path.basename(file, '.html');  // e.g., "appliances-removal-san-antonio-tx"
      const pagePhpPath = path.join(wpThemeRoot, `page-${slug}.php`);
  
      const prettyName = slug
        .replace(/-/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/\b\w/g, c => c.toUpperCase());
  
      const pagePhp = `<?php
  /**
   * Page Template for ${prettyName}
   *
   * Auto-generated from ${file}
   */
  get_header();
  ?>
  
  ${pageContent}
  
  <?php
  get_footer();
  `;
      await fsp.writeFile(pagePhpPath, pagePhp, 'utf8');
    }
  
    return {
      themeSlug,
      themeDir: wpThemeRoot
    };
}
  

/**
 * Recursively copy a directory.
 */
async function copyDirRecursive(src, dest) {
  await fsp.mkdir(dest, { recursive: true });
  const entries = await fsp.readdir(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await fsp.copyFile(srcPath, destPath);
    }
  }
}

module.exports = {
  buildWordPressTheme
};
