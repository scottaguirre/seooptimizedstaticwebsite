// utils/wpThemeBuilder/generators/functionsPhp.js

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

function generateFunctionsPhp(options = {}) {
  const {
    themeSlug = 'local-business-theme',
    themeName = 'Local Business Theme',
    cssFiles = [],
    hasBootstrapJs = false,
  } = options;

  const funcPrefix = makePhpIdentifier(themeSlug);

  // Build the CSS files PHP array
  const cssPhpArray = cssFiles.length > 0
    ? "array( '" + cssFiles.join("', '") + "' )"
    : 'array()';

  const bootstrapJsCode = hasBootstrapJs
    ? `
    // Enqueue Bootstrap JS
    wp_enqueue_script(
        '${themeSlug}-bootstrap',
        get_template_directory_uri() . '/js/bootstrap.bundle.min.js',
        array(),
        '5.3.0',
        true
    );`
    : '';

  return `<?php
/**
 * Theme functions and definitions
 * Theme: ${themeName}
 *
 * @package ${themeSlug}
 */

// Prevent direct access
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Include required files
 */
require_once get_template_directory() . '/inc/theme-activation.php';
require_once get_template_directory() . '/inc/meta-boxes.php';
require_once get_template_directory() . '/inc/theme-settings.php';
require_once get_template_directory() . '/inc/template-helpers.php';

/**
 * Theme setup
 */
function ${funcPrefix}_setup() {
    // Let WordPress manage the document title
    add_theme_support( 'title-tag' );

    // Enable support for post thumbnails
    add_theme_support( 'post-thumbnails' );

    // HTML5 support for search form, gallery, etc.
    add_theme_support( 'html5', array(
        'search-form',
        'comment-form',
        'comment-list',
        'gallery',
        'caption',
        'style',
        'script',
    ) );

    // Register navigation menu
    register_nav_menus( array(
        'primary' => __( 'Primary Menu', '${themeSlug}' ),
    ) );
}
add_action( 'after_setup_theme', '${funcPrefix}_setup' );

/**
 * Enqueue styles and scripts
 */
function ${funcPrefix}_enqueue_assets() {
    $theme_uri = get_template_directory_uri();

    // Always enqueue Bootstrap CSS
    wp_enqueue_style(
        '${themeSlug}-bootstrap',
        $theme_uri . '/css/bootstrap.min.css',
        array(),
        '5.3.0'
    );

    // Get current page slug
    $page_slug = '';
    if ( is_front_page() || is_home() ) {
        // Try both 'index' and 'about' for front page
        if ( file_exists( get_template_directory() . '/css/index.css' ) ) {
            $page_slug = 'index';
        } elseif ( file_exists( get_template_directory() . '/css/about.css' ) ) {
            $page_slug = 'about';
        }
    } elseif ( is_page() ) {
        global $post;
        $page_slug = $post->post_name;
    }

    // Enqueue page-specific CSS if it exists
    if ( $page_slug ) {
        $page_css_path = get_template_directory() . '/css/' . $page_slug . '.css';
        
        if ( file_exists( $page_css_path ) ) {
            wp_enqueue_style(
                '${themeSlug}-' . $page_slug,
                $theme_uri . '/css/' . $page_slug . '.css',
                array( '${themeSlug}-bootstrap' ),
                '1.0.0'
            );
        }
    }
${bootstrapJsCode}
}
add_action( 'wp_enqueue_scripts', '${funcPrefix}_enqueue_assets' );

/**
 * Register widget areas
 */
function ${funcPrefix}_widgets_init() {
    register_sidebar( array(
        'name'          => __( 'Footer Widgets', '${themeSlug}' ),
        'id'            => 'footer-1',
        'description'   => __( 'Add widgets here to appear in the footer.', '${themeSlug}' ),
        'before_widget' => '<div class="footer-widget mb-3">',
        'after_widget'  => '</div>',
        'before_title'  => '<h4 class="widget-title">',
        'after_title'   => '</h4>',
    ) );
}
add_action( 'widgets_init', '${funcPrefix}_widgets_init' );

/**
 * Add custom body classes
 */
function ${funcPrefix}_body_classes( $classes ) {
    // Add page slug as body class
    if ( is_singular() ) {
        global $post;
        $classes[] = 'page-' . $post->post_name;
    }

    return $classes;
}
add_filter( 'body_class', '${funcPrefix}_body_classes' );

/**
 * Customize excerpt length
 */
function ${funcPrefix}_excerpt_length( $length ) {
    return 30;
}
add_filter( 'excerpt_length', '${funcPrefix}_excerpt_length' );

/**
 * Filter content to convert PHP template tags into actual URLs
 * This executes the template tags stored in post meta
 */
function ${funcPrefix}_process_content_php( $content ) {
    // Only process if content contains PHP tags
    if ( strpos( $content, '<' . '?php' ) === false ) {
        return $content;
    }

    // Start output buffering
    ob_start();
    
    // Evaluate the PHP code in the content
    // This converts template tags into actual URLs
    eval( '?' . '>' . $content );
    
    // Get the processed content
    $processed = ob_get_clean();
    
    return $processed;
}

/**
 * Filter post meta to process PHP template tags
 */
function ${funcPrefix}_filter_meta_content( $value, $object_id, $meta_key, $single ) {
    // Only process our theme's meta fields
    if ( strpos( $meta_key, '${funcPrefix}_' ) !== 0 ) {
        return $value;
    }

    // Remove this filter to prevent infinite loops
    remove_filter( 'get_post_metadata', '${funcPrefix}_filter_meta_content', 10 );
    
    // Get the actual meta value
    $meta_value = get_post_meta( $object_id, $meta_key, $single );
    
    // Re-add the filter
    add_filter( 'get_post_metadata', '${funcPrefix}_filter_meta_content', 10, 4 );
    
    // Process PHP tags if present
    if ( is_string( $meta_value ) && strpos( $meta_value, '<' . '?php' ) !== false ) {
        $meta_value = ${funcPrefix}_process_content_php( $meta_value );
    }
    
    return $meta_value;
}
add_filter( 'get_post_metadata', '${funcPrefix}_filter_meta_content', 10, 4 );

/**
 * Additional fallback: Filter the_content for any PHP tags
 * This catches content displayed via the_content() instead of meta fields
 */
function ${funcPrefix}_process_the_content( $content ) {
    if ( strpos( $content, '<' . '?php' ) !== false ) {
        return ${funcPrefix}_process_content_php( $content );
    }
    return $content;
}
add_filter( 'the_content', '${funcPrefix}_process_the_content', 5 );
`;
}

module.exports = {
  generateFunctionsPhp,
};