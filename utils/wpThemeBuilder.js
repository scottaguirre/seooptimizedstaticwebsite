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

// NEW: simple helper to escape single quotes for PHP strings
function phpEscapeSingle(str) {
  return String(str || '').replace(/'/g, "\\'");
}

// Remove inline CSS/JS tags that point to css/ and js/ folders
function cleanInlineAssets(html) {
  if (!html) return html;

  // Remove <link ... href="css/..."> or "./css/..."
  html = html.replace(
    /<link[^>]+href=["']\.?\/?css\/[^"']+["'][^>]*>\s*/gi,
    ''
  );

  // Remove <script ... src="js/..."></script> or "./js/..."
  html = html.replace(
    /<script[^>]+src=["']\.?\/?js\/[^"']+["'][^>]*>\s*<\/script>\s*/gi,
    ''
  );

  return html;
}


function rewriteWpPageLinks(html) {
  if (!html) return html;

  const mapping = [
    { file: 'accessibility.html', slug: 'accessibility' },
    { file: 'terms-of-use.html', slug: 'terms-of-use' },
    { file: 'privacy-policy.html', slug: 'privacy-policy' },
  ];

  let out = html;

  mapping.forEach(({ file, slug }) => {
    const regex = new RegExp(`href=["']${file}["']`, 'gi');
    out = out.replace(
      regex,
      `href="<?php echo esc_url( home_url( '/${slug}/' ) ); ?>"`
    );
  });

  return out;
}


// Rewrite assets/ paths (images, favicon) to use get_template_directory_uri()
function rewriteAssetUrls(html) {
  if (!html) return html;

  const themeUriPhp = `<?php echo esc_url( get_template_directory_uri() ); ?>`;

  return html
    // Images / favicon in assets: src="assets/..." or href="assets/..."
    .replace(/(src=["'])(\.?\/?assets\/)/gi, `$1${themeUriPhp}/assets/`)
    .replace(/(href=["'])(\.?\/?assets\/)/gi, `$1${themeUriPhp}/assets/`);
}


function rewriteHtmlInternalLinks(html) {
  if (!html) return html;

  return html.replace(/href=["']([^"']+\.html)["']/gi, (match, file) => {
    const slug = file.replace(/\.html$/i, "");
    return `href="/${slug}/"`;
  });
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
  
    // Inject footer widget area into <footer> (if footer exists)
    let footerPhpWithWidgets = footerPhp;
    if (footerPhpWithWidgets) {
      footerPhpWithWidgets = footerPhpWithWidgets.replace(
        /<footer([^>]*)>/i,
        (match, attrs) => `
  <footer${attrs}>
    <?php if ( is_active_sidebar( 'footer-1' ) ) : ?>
      <div class="container py-4">
        <div class="row">
          <div class="col-12 footer-widgets-area">
            <?php dynamic_sidebar( 'footer-1' ); ?>
          </div>
        </div>
      </div>
    <?php endif; ?>`
      );
    }
  
    // Inject wp_nav_menu into the existing Bootstrap nav
    let headerPhpWithMenu = injectWpNavMenu(headerPhp);
  
    // Clean + fix assets + rewrite links for WP (HEADER)
    headerPhpWithMenu = cleanInlineAssets(headerPhpWithMenu);
    headerPhpWithMenu = rewriteAssetUrls(headerPhpWithMenu);
    headerPhpWithMenu = rewriteWpPageLinks(headerPhpWithMenu);
  
    // Clean + fix assets + rewrite links for WP (FOOTER, using the WIDGET VERSION)
    let footerProcessed = footerPhpWithWidgets || '';
    footerProcessed = cleanInlineAssets(footerProcessed);
    footerProcessed = rewriteAssetUrls(footerProcessed);
    footerProcessed = rewriteWpPageLinks(footerProcessed);
  
    // 6. Write header.php and footer.php
    const headerPhpPath = path.join(wpThemeRoot, 'header.php');
    const footerPhpPath = path.join(wpThemeRoot, 'footer.php');
  
    if (headerPhpWithMenu) {
      await fsp.writeFile(headerPhpPath, headerPhpWithMenu, 'utf8');
    } else {
      // fallback minimal header...
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
  
    if (footerProcessed) {
      await fsp.writeFile(footerPhpPath, footerProcessed, 'utf8');
    } else {
      await fsp.writeFile(
        footerPhpPath,
        `<?php wp_footer(); ?>
  </body>
  </html>
  `,
        'utf8'
      );
    }
  
  // 7. Create front-page.php: just content + get_header/get_footer
  const frontPagePhpPath = path.join(wpThemeRoot, 'front-page.php');
  let content = bodyContent || indexHtml;

  // 🔧 Remove inline CSS/JS and fix asset paths
  content = cleanInlineAssets(content);
  content = rewriteAssetUrls(content);
  content = rewriteHtmlInternalLinks(content);

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

  // Collect CSS files in /css to enqueue (except style.css itself)
  const cssDir = path.join(wpThemeRoot, 'css');
  let cssFiles = [];
  if (fs.existsSync(cssDir)) {
    const allCss = await fsp.readdir(cssDir);
    cssFiles = allCss
      .filter(name => name.toLowerCase().endsWith('.css'))
      .filter(name => name.toLowerCase() !== 'style.css'); // WP uses root style.css
  }

  // Check if bootstrap JS exists
  const jsDir = path.join(wpThemeRoot, 'js');
  let hasBootstrapJs = false;
  if (fs.existsSync(jsDir)) {
    const allJs = await fsp.readdir(jsDir);
    hasBootstrapJs = allJs.includes('bootstrap.bundle.min.js');
  }

  const cssPhpArray =
    cssFiles.length > 0
      ? "array('" + cssFiles.join("','") + "')"
      : 'array()';

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

  /**
   * Enqueue styles and scripts
   */
  function ${phpFuncBase}_enqueue_assets() {
      $theme_uri = get_template_directory_uri();

      // Enqueue all generated CSS files in /css
      $css_files = ${cssPhpArray};
      foreach ( $css_files as $css_file ) {
          $handle = 'lb-' . sanitize_title( basename( $css_file, '.css' ) );
          wp_enqueue_style(
              $handle,
              $theme_uri . '/css/' . $css_file,
              array(),
              '1.0.0'
          );
      }

      // Enqueue Bootstrap JS if present
      ${hasBootstrapJs ? `
      wp_enqueue_script(
          'lb-bootstrap',
          $theme_uri . '/js/bootstrap.bundle.min.js',
          array(),
          '5.3.0',
          true
      );` : ''}
  }
  add_action( 'wp_enqueue_scripts', '${phpFuncBase}_enqueue_assets' );

  /**
   * Register widget areas
   */
  function ${phpFuncBase}_widgets_init() {
      register_sidebar( [
          'name'          => __( 'Footer Widgets', '${themeSlug}' ),
          'id'            => 'footer-1',
          'before_widget' => '<div class="footer-widget mb-3">',
          'after_widget'  => '</div>',
          'before_title'  => '<h2 class="h6 mb-2">',
          'after_title'   => '</h2>',
      ] );
  }
  add_action( 'widgets_init', '${phpFuncBase}_widgets_init' );

  /**
   * On theme activation:
   * - Create/update pages from theme-pages.php
   * - Set front page
   * - Build main menu with:
   *   - Home (About/front-page)
   *   - Services: pattern you requested
   *   - Locations: parent with children
   */
  function ${phpFuncBase}_on_activate() {
      // Load theme-pages.php if present
      $theme_pages_file = get_template_directory() . '/theme-pages.php';
      if ( ! file_exists( $theme_pages_file ) ) {
          return;
      }

      $page_defs = include $theme_pages_file;
      if ( ! is_array( $page_defs ) ) {
          return;
      }

      $slug_to_id   = [];
      $about_id     = 0;
      $about_title  = '';
      $service_pages  = [];
      $location_pages = [];

      // Create or update pages
      foreach ( $page_defs as $def ) {
          $slug     = isset( $def['slug'] ) ? sanitize_title( $def['slug'] ) : '';
          $title    = isset( $def['title'] ) ? sanitize_text_field( $def['title'] ) : '';
          $template = isset( $def['template'] ) ? sanitize_text_field( $def['template'] ) : '';
          $order    = isset( $def['menu_order'] ) ? intval( $def['menu_order'] ) : 0;

          if ( ! $slug || ! $title ) {
              continue;
          }

          // See if page already exists
          $existing = get_page_by_path( $slug );
          if ( $existing ) {
              $page_id = $existing->ID;

              // Update title/menu_order if needed
              wp_update_post( [
                  'ID'         => $page_id,
                  'post_title' => $title,
                  'menu_order' => $order,
              ] );
          } else {
              // Create new page
              $page_id = wp_insert_post( [
                  'post_title'   => $title,
                  'post_name'    => $slug,
                  'post_type'    => 'page',
                  'post_status'  => 'publish',
                  'menu_order'   => $order,
                  'post_content' => '', // content is in template
              ] );
          }

          if ( ! $page_id || is_wp_error( $page_id ) ) {
              continue;
          }

          $slug_to_id[ $slug ] = $page_id;

          // Assign page template if given
          if ( $template ) {
              update_post_meta( $page_id, '_wp_page_template', $template );
          }

          // Detect About/front-page page
          if ( $template === 'front-page.php' || $slug === 'about' ) {
              $about_id    = $page_id;
              $about_title = $title;
          }

          // Classify pages
          if ( in_array( $slug, [ 'privacy-policy', 'terms-of-use', 'accessibility' ], true ) ) {
              // legal pages -> footer only, skip from main menu
              continue;
          } elseif ( strpos( $slug, 'location-' ) === 0 ) {
              $location_pages[] = [
                  'slug'  => $slug,
                  'id'    => $page_id,
                  'title' => $title,
                  'order' => $order,
              ];
          } elseif ( $template !== 'front-page.php' && $slug !== 'about' ) {
              // Treat everything else as a service page
              $service_pages[] = [
                  'slug'  => $slug,
                  'id'    => $page_id,
                  'title' => $title,
                  'order' => $order,
              ];
          }
      }

      // Set front page if we found About/front-page
      if ( $about_id ) {
          update_option( 'show_on_front', 'page' );
          update_option( 'page_on_front', $about_id );
      }

      // If a primary menu already exists, don't overwrite user changes
      $locations = get_nav_menu_locations();
      if ( isset( $locations['primary'] ) && $locations['primary'] ) {
          return;
      }

      // Create a new menu
      $menu_id = wp_create_nav_menu( 'Main Menu' );
      if ( is_wp_error( $menu_id ) ) {
          return;
      }

      // Attach it to primary location
      $locations['primary'] = $menu_id;
      set_theme_mod( 'nav_menu_locations', $locations );

      // Optional: sort service/location pages by menu_order
      usort( $service_pages, function( $a, $b ) {
          return $a['order'] <=> $b['order'];
      });
      usort( $location_pages, function( $a, $b ) {
          return $a['order'] <=> $b['order'];
      });

      // 1) Home / About
      if ( $about_id ) {
          wp_update_nav_menu_item( $menu_id, 0, [
              'menu-item-title'  => $about_title ? $about_title : __( 'Home', '${themeSlug}' ),
              'menu-item-object' => 'page',
              'menu-item-object-id' => $about_id,
              'menu-item-type'   => 'post_type',
              'menu-item-status' => 'publish',
          ] );
      }

      // 2) Services logic (your pattern)
      $service_count = count( $service_pages );

      if ( $service_count === 1 ) {
          // Single service: top-level "Service1"
          $svc = $service_pages[0];
          wp_update_nav_menu_item( $menu_id, 0, [
              'menu-item-title'  => $svc['title'],
              'menu-item-object' => 'page',
              'menu-item-object-id' => $svc['id'],
              'menu-item-type'   => 'post_type',
              'menu-item-status' => 'publish',
          ] );
      } elseif ( $service_count > 1 ) {
          // First service as top-level
          $first = $service_pages[0];
          wp_update_nav_menu_item( $menu_id, 0, [
              'menu-item-title'  => $first['title'],
              'menu-item-object' => 'page',
              'menu-item-object-id' => $first['id'],
              'menu-item-type'   => 'post_type',
              'menu-item-status' => 'publish',
          ] );

          // "Services" parent
          $services_parent_id = wp_update_nav_menu_item( $menu_id, 0, [
              'menu-item-title'  => __( 'Services', '${themeSlug}' ),
              'menu-item-url'    => '#',
              'menu-item-type'   => 'custom',
              'menu-item-status' => 'publish',
          ] );

          // Remaining services as children under "Services"
          for ( $i = 1; $i < $service_count; $i++ ) {
              $svc = $service_pages[ $i ];
              wp_update_nav_menu_item( $menu_id, 0, [
                  'menu-item-title'      => $svc['title'],
                  'menu-item-object'     => 'page',
                  'menu-item-object-id'  => $svc['id'],
                  'menu-item-type'       => 'post_type',
                  'menu-item-parent-id'  => $services_parent_id,
                  'menu-item-status'     => 'publish',
              ] );
          }
      }

      // 3) Locations logic
      $location_count = count( $location_pages );
      if ( $location_count >= 1 ) {
          // "Locations" parent
          $locations_parent_id = wp_update_nav_menu_item( $menu_id, 0, [
              'menu-item-title'  => __( 'Locations', '${themeSlug}' ),
              'menu-item-url'    => '#',
              'menu-item-type'   => 'custom',
              'menu-item-status' => 'publish',
          ] );

          foreach ( $location_pages as $loc ) {
              wp_update_nav_menu_item( $menu_id, 0, [
                  'menu-item-title'      => $loc['title'],
                  'menu-item-object'     => 'page',
                  'menu-item-object-id'  => $loc['id'],
                  'menu-item-type'       => 'post_type',
                  'menu-item-parent-id'  => $locations_parent_id,
                  'menu-item-status'     => 'publish',
              ] );
          }
      }
  }
  add_action( 'after_switch_theme', '${phpFuncBase}_on_activate' );
  `;
    

  await fsp.writeFile(functionsPhpPath, functionsPhpContent, 'utf8');

  // 12. Generate page-*.php templates for every other HTML file
  const distFiles = await fsp.readdir(distDir);

  // NEW: collect metadata for theme-pages.php
  const themePages = [];

  // ALWAYS include About page, coming from index.html → front-page.php
  themePages.push({
    title: "About",
    slug: "about",
    template: "front-page.php",
    menu_order: 0
  });

  let menuOrder = 1;

  for (const file of distFiles) {
    if (!file.endsWith('.html')) continue;
    if (file === 'index.html') continue; // already used as front-page.php

    const fullPath = path.join(distDir, file);
    const html = await fsp.readFile(fullPath, 'utf8');

    // Reuse the same splitter to grab just the body content
    const { bodyContent: pageBodyContent } = splitHtmlLayout(html);
    let pageContent = pageBodyContent || html;

    // 🔧 Remove inline CSS/JS and fix asset paths
    pageContent = cleanInlineAssets(pageContent);
    pageContent = rewriteAssetUrls(pageContent).trim();
    pageContent = rewriteHtmlInternalLinks(pageContent); 

    
    // Turn "water-heater-repair-leander-tx.html" into "Water Heater Repair Leander"
    const baseName = file.replace(/\.html$/i, '');
    let words = baseName
      .split('-')
      .map(w => w.trim())
      .filter(Boolean);

    // If last word is a 2-letter state abbreviation like tx, az, ca, etc – drop it
    if (words.length > 1) {
      const last = words[words.length - 1].toLowerCase();
      const stateAbbr = ['tx', 'az', 'ca', 'fl', 'co', 'ny', 'wa', 'or', 'nm', 'ga', 'nc', 'sc', 'oh', 'mi', 'il', 'va', 'pa']; // extend if you want
      if (stateAbbr.includes(last)) {
        words.pop();
      }
    }

    const prettyName = words
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
    

    // 🔹 Path for this page template: page-{slug}.php
    const pagePhpPath = path.join(wpThemeRoot, `page-${baseName}.php`);

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

    // NEW: push metadata for theme-pages.php
    themePages.push({
      title: prettyName,
      slug: baseName,
      template: `page-${baseName}.php`,
      menu_order: menuOrder++,
    });
  }

  // NEW 13. Write theme-pages.php with all page definitions
  if (themePages.length > 0) {
    const themePagesPhpPath = path.join(wpThemeRoot, 'theme-pages.php');

    const entries = themePages
      .map((p) => {
        return `    [
        'title' => '${phpEscapeSingle(p.title)}',
        'slug'  => '${phpEscapeSingle(p.slug)}',
        'template' => '${phpEscapeSingle(p.template)}',
        'menu_order' => ${p.menu_order},
    ]`;
      })
      .join(',\n\n');

    const themePagesPhp = `<?php
return [
${entries}
];
`;
    await fsp.writeFile(themePagesPhpPath, themePagesPhp, 'utf8');
  }

  return {
    themeSlug,
    themeDir: wpThemeRoot,
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
  buildWordPressTheme,
};
