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

// Helper to escape for single-quoted PHP strings
function phpEscapeSingle(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\') // escape backslashes
    .replace(/'/g, "\\'");  // escape single quotes
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

// Rewrite internal .html links in page content into /slug/ paths
function rewriteHtmlInternalLinks(html) {
  if (!html) return html;

  return html.replace(/href=["']([^"']+\.html)["']/gi, (match, file) => {
    const slug = file.replace(/\.html$/i, '');
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
 * Extract text from <title> and <meta name="description"> in the HEADER,
 * replace it with calls to lb_get_page_text(), and return:
 *  - modifiedHeader
 *  - fields: [{ key, tag, index, defaultText }]
 */
function extractHeadTextFields(headerHtml) {
  if (!headerHtml) {
    return { modifiedHeader: headerHtml, fields: [] };
  }

  const fields = [];
  let modified = headerHtml;

  // <title>...</title>
  modified = modified.replace(/<title>([\s\S]*?)<\/title>/i, (match, inner) => {
    const plainInner = inner.replace(/<[^>]+>/g, '').trim();
    if (!plainInner) return match;

    const key = 'front_head_title';
    const phpKey = phpEscapeSingle(key);
    const phpDefault = phpEscapeSingle(plainInner);

    fields.push({
      key,
      tag: 'title',
      index: 1,
      defaultText: plainInner,
    });

    return `<title><?php echo esc_html( lb_get_page_text( '${phpKey}', '${phpDefault}' ) ); ?></title>`;
  });

  // <meta name="description" content="...">
  modified = modified.replace(
    /<meta[^>]+name=["']description["'][^>]*>/i,
    (match) => {
      const contentMatch = match.match(/content=["']([^"']*)["']/i);
      const existing = contentMatch ? contentMatch[1] : '';
      const plainInner = existing.trim();
      if (!plainInner) return match;

      const key = 'front_meta_description';
      const phpKey = phpEscapeSingle(key);
      const phpDefault = phpEscapeSingle(plainInner);

      fields.push({
        key,
        tag: 'meta_description',
        index: 1,
        defaultText: plainInner,
      });

      // regenerate tag with PHP-powered content
      return `<meta name="description" content="<?php echo esc_attr( lb_get_page_text( '${phpKey}', '${phpDefault}' ) ); ?>">`;
    }
  );

  return { modifiedHeader: modified, fields };
}

/**
 * For the FRONT PAGE ONLY (BODY):
 * - Find every <h1>, <h2>, <h3>, and <p>
 * - Extract plain text (strip inner HTML)
 * - Replace inner text with:
 *     <?php echo esc_html( lb_get_page_text( 'front_tag_index', 'Default text' ) ); ?>
 * - Return modified HTML + list of fields for per-page custom fields
 */
function extractFrontPageTextFields(frontHtml) {
  if (!frontHtml) {
    return { modifiedHtml: frontHtml, fields: [] };
  }

  const counters = { h1: 0, h2: 0, h3: 0, p: 0 };
  const fields = [];

  const modifiedHtml = frontHtml.replace(
    /<(h[1-3]|p)([^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, tag, attrs, inner) => {
      const tagLower = tag.toLowerCase();

      // Strip any inner HTML for default text (we only want text)
      const plainInner = inner.replace(/<[^>]+>/g, '').trim();
      if (!plainInner) {
        // no pure text, skip this one
        return match;
      }

      counters[tagLower] = (counters[tagLower] || 0) + 1;
      const index = counters[tagLower];
      const key = `front_${tagLower}_${index}`;

      fields.push({
        key,
        tag: tagLower,
        index,
        defaultText: plainInner,
      });

      const phpKey = phpEscapeSingle(key);
      const phpDefault = phpEscapeSingle(plainInner);

      // keep the tag + attributes, but make the text dynamic from post meta
      return `<${tag}${attrs}><?php echo esc_html( lb_get_page_text( '${phpKey}', '${phpDefault}' ) ); ?></${tag}>`;
    }
  );

  return { modifiedHtml, fields };
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

  // === We’ll collect both page metadata and content ===
  const themePages = [];
  const themeContent = {};
  let frontTextFields = []; // all text pieces (head + body) for the FRONT PAGE

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

  // Inject wp_nav_menu into the existing Bootstrap nav (HEADER)
  let headerPhpWithMenu = injectWpNavMenu(headerPhp);

  // Clean + fix assets + rewrite links for WP (HEADER)
  headerPhpWithMenu = cleanInlineAssets(headerPhpWithMenu);
  headerPhpWithMenu = rewriteAssetUrls(headerPhpWithMenu);
  headerPhpWithMenu = rewriteWpPageLinks(headerPhpWithMenu);

  // Extract title/meta description text into fields & inject lb_get_page_text placeholders
  const headExtraction = extractHeadTextFields(headerPhpWithMenu);
  headerPhpWithMenu = headExtraction.modifiedHeader;
  frontTextFields = frontTextFields.concat(headExtraction.fields || []);

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

  // === FRONT PAGE (ABOUT) ===

  // Capture content for About/index for front-page template ONLY (text via post meta)
  let frontContent = bodyContent || indexHtml;

  // Clean inline CSS/JS and fix asset paths + internal links
  frontContent = cleanInlineAssets(frontContent);
  frontContent = rewriteAssetUrls(frontContent);
  frontContent = rewriteHtmlInternalLinks(frontContent);

  // Extract all H1/H2/H3/P texts into fields and inject lb_get_page_text() calls
  const frontExtraction = extractFrontPageTextFields(frontContent);
  const frontDynamicHtml = frontExtraction.modifiedHtml;
  frontTextFields = frontTextFields.concat(frontExtraction.fields || []);

  // 7. Create front-page.php: full layout HTML, but text pulled from post meta
  const frontPagePhpPath = path.join(wpThemeRoot, 'front-page.php');

  const frontPagePhp = `<?php
/**
 * Front Page Template
 * Auto-generated from static index.html
 *
 * All main text (title, meta description, H1/H2/H3/P) is loaded from
 * per-page custom fields (post meta) via lb_get_page_text().
 */
get_header();
?>

${frontDynamicHtml}

<?php
get_footer();
`;
  await fsp.writeFile(frontPagePhpPath, frontPagePhp, 'utf8');

  // NOTE: We are NO LONGER storing the About/front-page HTML in themeContent.
  // The front page uses per-page custom fields instead of post_content.

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

  // 11. Create functions.php with menu registration, theme supports, activation logic, and meta box
  const functionsPhpPath = path.join(wpThemeRoot, 'functions.php');
  const phpFuncBase = makePhpIdentifier(themeSlug);

  // Collect CSS files in /css to enqueue (except style.css itself)
  const cssDir = path.join(wpThemeRoot, 'css');
  let cssFiles = [];
  if (fs.existsSync(cssDir)) {
    const allCss = await fsp.readdir(cssDir);
    cssFiles = allCss
      .filter((name) => name.toLowerCase().endsWith('.css'))
      .filter((name) => name.toLowerCase() !== 'style.css'); // WP uses root style.css
  }

  // Check if bootstrap JS exists
  const jsDir = path.join(wpThemeRoot, 'js');
  let hasBootstrapJs = false;
  if (fs.existsSync(jsDir)) {
    const allJs = await fsp.readdir(jsDir);
    hasBootstrapJs = allJs.includes('bootstrap.bundle.min.js');
  }

  const cssPhpArray =
    cssFiles.length > 0 ? "array('" + cssFiles.join("','") + "')" : 'array()';

  // Build PHP array of front-page text fields for meta box + activation
  let frontFieldsPhpArray;
  if (frontTextFields.length > 0) {
    const items = frontTextFields
      .map((f) => {
        const labelText = `${f.tag.toUpperCase()} ${f.index}`;
        return `  [
    'key'     => '${phpEscapeSingle(f.key)}',
    'tag'     => '${phpEscapeSingle(f.tag)}',
    'index'   => ${f.index},
    'label'   => '${phpEscapeSingle(labelText)}',
    'default' => '${phpEscapeSingle(f.defaultText)}',
  ]`;
      })
      .join(',\n');

    frontFieldsPhpArray = `$lb_front_fields = [\n${items}\n];`;
  } else {
    frontFieldsPhpArray = `$lb_front_fields = [];\n`;
  }

  const functionsPhpContent = `<?php
${frontFieldsPhpArray}

/**
 * Helper: get page text from post meta with default fallback.
 */
if ( ! function_exists( 'lb_get_page_text' ) ) {
    function lb_get_page_text( $key, $default = '' ) {
        $page_id = get_queried_object_id();
        if ( ! $page_id ) {
            return $default;
        }
        $value = get_post_meta( $page_id, $key, true );
        if ( $value !== '' ) {
            return $value;
        }
        return $default;
    }
}

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
 * Fix asset URLs inside post content.
 * Rewrites src="assets/..." and href="assets/..." to use the theme directory URL.
 */
function ${phpFuncBase}_filter_content_asset_urls( $content ) {
    $theme_uri = get_template_directory_uri();

    $search  = [
        'src="assets/',
        "src='assets/",
        'href="assets/',
        "href='assets/"
    ];
    $replace = [
        'src="' . esc_url( $theme_uri ) . '/assets/',
        "src='" . esc_url( $theme_uri ) . "/assets/",
        'href="' . esc_url( $theme_uri ) . '/assets/',
        "href='" . esc_url( $theme_uri ) . "/assets/"
    ];

    return str_replace( $search, $replace, $content );
}
add_filter( 'the_content', '${phpFuncBase}_filter_content_asset_urls' );

/**
 * Meta box for editing all front-page text fields (title, description, H1/H2/H3/P).
 */
function ${phpFuncBase}_add_frontpage_metabox() {
    global $lb_front_fields;

    // Only add if we actually have fields
    if ( empty( $lb_front_fields ) ) {
        return;
    }

    add_meta_box(
        'lb_frontpage_fields',
        __( 'Front Page Text', '${themeSlug}' ),
        '${phpFuncBase}_render_frontpage_metabox',
        'page',
        'normal',
        'high'
    );
}
add_action( 'add_meta_boxes', '${phpFuncBase}_add_frontpage_metabox' );

function ${phpFuncBase}_render_frontpage_metabox( $post ) {
    global $lb_front_fields;

    $front_page_id = (int) get_option( 'page_on_front' );
    $template      = get_page_template_slug( $post->ID );

    // Show only on the front page (or page using front-page.php)
    if ( $post->ID !== $front_page_id && $template !== 'front-page.php' ) {
        echo '<p>' . esc_html__( 'This meta box is only used for the front page.', '${themeSlug}' ) . '</p>';
        return;
    }

    wp_nonce_field( 'lb_frontpage_fields_nonce', 'lb_frontpage_fields_nonce_field' );

    echo '<table class="form-table">';
    foreach ( $lb_front_fields as $field ) {
        $key   = isset( $field['key'] ) ? $field['key'] : '';
        if ( ! $key ) {
            continue;
        }
        $label = isset( $field['label'] ) ? $field['label'] : $key;
        $value = get_post_meta( $post->ID, $key, true );

        echo '<tr>';
        echo '<th scope="row"><label for="' . esc_attr( $key ) . '">' . esc_html( $label ) . '</label></th>';
        echo '<td><textarea style="width:100%;min-height:60px;" id="' . esc_attr( $key ) . '" name="' . esc_attr( $key ) . '">' . esc_textarea( $value ) . '</textarea></td>';
        echo '</tr>';
    }
    echo '</table>';
}

function ${phpFuncBase}_save_frontpage_metabox( $post_id ) {
    global $lb_front_fields;

    if ( ! isset( $_POST['lb_frontpage_fields_nonce_field'] ) ||
         ! wp_verify_nonce( $_POST['lb_frontpage_fields_nonce_field'], 'lb_frontpage_fields_nonce' ) ) {
        return;
    }

    if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
        return;
    }

    if ( isset( $_POST['post_type'] ) && 'page' === $_POST['post_type'] ) {
        if ( ! current_user_can( 'edit_page', $post_id ) ) {
            return;
        }
    } else {
        return;
    }

    foreach ( $lb_front_fields as $field ) {
        $key = isset( $field['key'] ) ? $field['key'] : '';
        if ( ! $key ) {
            continue;
        }
        if ( isset( $_POST[ $key ] ) ) {
            $value = sanitize_text_field( wp_unslash( $_POST[ $key ] ) );
            update_post_meta( $post_id, $key, $value );
        }
    }
}
add_action( 'save_post_page', '${phpFuncBase}_save_frontpage_metabox' );

/**
 * On theme activation:
 * - Create/update pages from theme-pages.php
 * - Fill post_content from theme-content.php (for non-front pages)
 * - Set front page
 * - Build main menu with:
 *   - Home (About/front-page)
 *   - Services
 *   - Locations
 * - Pre-fill front-page custom fields with default text
 */
function ${phpFuncBase}_on_activate() {
    global $lb_front_fields;

    // Load theme-pages.php if present
    $theme_pages_file = get_template_directory() . '/theme-pages.php';
    $page_defs = [];
    if ( file_exists( $theme_pages_file ) ) {
        $maybe_defs = include $theme_pages_file;
        if ( is_array( $maybe_defs ) ) {
            $page_defs = $maybe_defs;
        }
    }

    if ( empty( $page_defs ) ) {
        return;
    }

    // Load theme-content.php if present
    $theme_content_file = get_template_directory() . '/theme-content.php';
    $content_map = [];
    if ( file_exists( $theme_content_file ) ) {
        $maybe_content = include $theme_content_file;
        if ( is_array( $maybe_content ) ) {
            $content_map = $maybe_content;
        }
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

        // Front page content now comes from custom fields, not theme-content.php
        $page_content = '';
        if ( $template !== 'front-page.php' && isset( $content_map[ $slug ] ) ) {
            $page_content = $content_map[ $slug ];
        }

        // See if page already exists
        $existing = get_page_by_path( $slug );
        if ( $existing ) {
            $page_id = $existing->ID;

            // Update title/menu_order/content
            wp_update_post( [
                'ID'           => $page_id,
                'post_title'   => $title,
                'menu_order'   => $order,
                'post_content' => $page_content,
            ] );
        } else {
            // Create new page
            $page_id = wp_insert_post( [
                'post_title'   => $title,
                'post_name'    => $slug,
                'post_type'    => 'page',
                'post_status'  => 'publish',
                'menu_order'   => $order,
                'post_content' => $page_content,
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

    // Pre-fill front-page custom fields (meta) with defaults
    if ( $about_id && ! empty( $lb_front_fields ) ) {
        foreach ( $lb_front_fields as $field ) {
            $key     = isset( $field['key'] ) ? $field['key'] : '';
            $default = isset( $field['default'] ) ? $field['default'] : '';
            if ( ! $key ) {
                continue;
            }
            $existing = get_post_meta( $about_id, $key, true );
            if ( $existing === '' && $default !== '' ) {
                update_post_meta( $about_id, $key, $default );
            }
        }
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
            'menu-item-title'      => $about_title ? $about_title : __( 'Home', '${themeSlug}' ),
            'menu-item-object'     => 'page',
            'menu-item-object-id'  => $about_id,
            'menu-item-type'       => 'post_type',
            'menu-item-status'     => 'publish',
        ] );
    }

    // 2) Services logic
    $service_count = count( $service_pages );

    if ( $service_count === 1 ) {
        // Single service: top-level
        $svc = $service_pages[0];
        wp_update_nav_menu_item( $menu_id, 0, [
            'menu-item-title'      => $svc['title'],
            'menu-item-object'     => 'page',
            'menu-item-object-id'  => $svc['id'],
            'menu-item-type'       => 'post_type',
            'menu-item-status'     => 'publish',
        ] );
    } elseif ( $service_count > 1 ) {
        // First service as top-level
        $first = $service_pages[0];
        wp_update_nav_menu_item( $menu_id, 0, [
            'menu-item-title'      => $first['title'],
            'menu-item-object'     => 'page',
            'menu-item-object-id'  => $first['id'],
            'menu-item-type'       => 'post_type',
            'menu-item-status'     => 'publish',
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

  // ALWAYS include About page, coming from index.html → front-page.php
  themePages.push({
    title: 'About',
    slug: 'about',
    template: 'front-page.php',
    menu_order: 0,
  });

  let menuOrder = 1;

  for (const file of distFiles) {
    if (!file.endsWith('.html')) continue;
    if (file === 'index.html') continue; // already used as front-page.php / About

    const fullPath = path.join(distDir, file);
    const html = await fsp.readFile(fullPath, 'utf8');

    // Reuse the same splitter to grab just the body content
    const { bodyContent: pageBodyContent } = splitHtmlLayout(html);

    let pageContent = pageBodyContent || html;

    // Remove inline CSS/JS and rewrite internal links
    pageContent = cleanInlineAssets(pageContent);
    pageContent = rewriteHtmlInternalLinks(pageContent);
    pageContent = pageContent.trim();

    // Turn "water-heater-repair-leander-tx.html" into "Water Heater Repair Leander"
    const baseName = file.replace(/\.html$/i, '');
    let words = baseName
      .split('-')
      .map((w) => w.trim())
      .filter(Boolean);

    // If last word is a 2-letter state abbreviation like tx, az, ca, etc – drop it
    if (words.length > 1) {
      const last = words[words.length - 1].toLowerCase();
      const stateAbbr = [
        'tx',
        'az',
        'ca',
        'fl',
        'co',
        'ny',
        'wa',
        'or',
        'nm',
        'ga',
        'nc',
        'sc',
        'oh',
        'mi',
        'il',
        'va',
        'pa',
      ];
      if (stateAbbr.includes(last)) {
        words.pop();
      }
    }

    const prettyName = words
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');

    // 🔹 Path for this page template: page-{slug}.php (generic template)
    const pagePhpPath = path.join(wpThemeRoot, `page-${baseName}.php`);

    const pagePhp = `<?php
/**
 * Page Template for ${prettyName}
 *
 * Auto-generated from ${file}
 */
get_header();
?>
<?php if ( have_posts() ) : ?>
  <?php while ( have_posts() ) : the_post(); ?>
    <?php the_content(); ?>
  <?php endwhile; ?>
<?php endif; ?>
<?php
get_footer();
`;
    await fsp.writeFile(pagePhpPath, pagePhp, 'utf8');

    // Store content in themeContent for DB (other pages only)
    themeContent[baseName] = pageContent;

    // Metadata for theme-pages.php
    themePages.push({
      title: prettyName,
      slug: baseName,
      template: `page-${baseName}.php`,
      menu_order: menuOrder++,
    });
  }

  // 13. Write theme-pages.php with all page definitions
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

  // 14. Write theme-content.php with slug => HTML content (for NON-front pages)
  const themeContentPhpPath = path.join(wpThemeRoot, 'theme-content.php');

  const entries = Object.entries(themeContent)
    .map(([slug, html]) => {
      return `  '${phpEscapeSingle(slug)}' => '${phpEscapeSingle(html)}'`;
    })
    .join(',\n');

  const themeContentPhp = `<?php
return [
${entries}
];
`;
  await fsp.writeFile(themeContentPhpPath, themeContentPhp, 'utf8');

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
  buildWordPressTheme
};
