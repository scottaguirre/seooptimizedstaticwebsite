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
require_once get_template_directory() . '/inc/newpage-meta-boxes.php';
require_once get_template_directory() . '/inc/theme-settings.php';
require_once get_template_directory() . '/inc/template-helpers.php';
require_once get_template_directory() . '/inc/contact-form-handler.php';

/**
 * Theme setup
 */
function ${funcPrefix}_setup() {
    // Make theme available for translation
    load_theme_textdomain( '${themeSlug}', get_template_directory() . '/languages' );

    // Let WordPress manage the document title
    add_theme_support( 'title-tag' );

    // Enable support for post thumbnails
    add_theme_support( 'post-thumbnails' );
    
    // Enable custom logo support
    add_theme_support( 'custom-logo', array(
        'height'      => 100,
        'width'       => 100,
        'flex-height' => true,
        'flex-width'  => true,
        'header-text' => array( 'site-title', 'site-description' ),
    ) );

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
 * Customize the Customizer
 * Add custom settings for logo and favicon
 */
function ${funcPrefix}_customize_register( $wp_customize ) {
    // Modify the logo section to add helper text
    $logo_control = $wp_customize->get_control( 'custom_logo' );
    if ( null !== $logo_control ) {
        $logo_control->description = __( 'Upload a custom logo to replace the default theme logo.', '${themeSlug}' );
    }
    
    // Add helper text for Site Icon (Favicon)
    $site_icon_control = $wp_customize->get_control( 'site_icon' );
    if ( null !== $site_icon_control ) {
        $site_icon_control->description = __( 'Upload a custom favicon (Site Icon). Recommended size: 512x512 pixels.', '${themeSlug}' );
    }
}

add_action( 'customize_register', '${funcPrefix}_customize_register' );

/**
 * Get the logo URL - custom logo or fallback to theme default
 */
function ${funcPrefix}_get_logo_url() {
    // Check if custom logo is set
    if ( has_custom_logo() ) {
        $custom_logo_id = get_theme_mod( 'custom_logo' );
        $logo_data = wp_get_attachment_image_src( $custom_logo_id, 'full' );
        
        if ( $logo_data ) {
            return $logo_data[0];
        }
    }
    
    // Fallback to theme default logo
    $logo_path = get_template_directory() . '/assets/';
    $logo_files = glob( $logo_path . '*logo*.{png,jpg,jpeg,webp,svg}', GLOB_BRACE );
    
    if ( ! empty( $logo_files ) ) {
        $logo_file = basename( $logo_files[0] );
        return get_template_directory_uri() . '/assets/' . $logo_file;
    }
    
    return '';
}

/**
 * Display the logo (custom or default)
 */
function ${funcPrefix}_display_logo() {
    $logo_url = ${funcPrefix}_get_logo_url();
    
    if ( $logo_url ) {
        echo '<img src="' . esc_url( $logo_url ) . '" alt="' . esc_attr( get_bloginfo( 'name' ) ) . '" width="100" height="100" class="me-2">';
    } else {
        echo '<span class="site-title">' . esc_html( get_bloginfo( 'name' ) ) . '</span>';
    }
}

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
        
        // Check if this page uses New Page Layout template
        $template = get_page_template_slug( $post->ID );
        
        if ( $template === 'page-new-page-layout.php' ) {
            // New pages use generic service page CSS
            // Try to find any service page CSS to reuse
            $service_css_files = array(
                'water-heater-repair',
                'faucet-installation',
                'drain-cleaning',
                'emergency-plumbing',
                'service-page', // Generic fallback
            );
            
            foreach ( $service_css_files as $css_file ) {
                if ( file_exists( get_template_directory() . '/css/' . $css_file . '.css' ) ) {
                    $page_slug = $css_file;
                    break;
                }
            }
        } else {
            // For imported pages, use page-specific CSS
            $page_slug = $post->post_name;
            
            // CRITICAL FIX: Try to find CSS file with or without location suffix
            // Service pages have slugs like "water-heater-repair-leander-tx"
            // But CSS files are named "water-heater-repair.css"
            
            $page_css_path = get_template_directory() . '/css/' . $page_slug . '.css';
            
            // If exact match doesn't exist, try removing location suffix
            if ( ! file_exists( $page_css_path ) ) {
                // Remove common location patterns: "-leander-tx", "-austin-tx", etc.
                // Pattern: remove "-[city]-[state]" from the end
                $slug_without_location = preg_replace( '/-[a-z]+-[a-z]{2}$/i', '', $page_slug );
                
                if ( $slug_without_location !== $page_slug ) {
                    $alternate_css_path = get_template_directory() . '/css/' . $slug_without_location . '.css';
                    
                    if ( file_exists( $alternate_css_path ) ) {
                        $page_slug = $slug_without_location;
                    }
                }
            }
        }
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

    // Enqueue contact form JavaScript on front page
    if ( is_front_page() || is_home() ) {
        wp_enqueue_script(
            '${themeSlug}-contact-form',
            $theme_uri . '/js/contact-form-handler.js',
            array(),
            '1.0.0',
            true
        );
    }
}
add_action( 'wp_enqueue_scripts', '${funcPrefix}_enqueue_assets' );

/**
 * Register widget areas and sidebar
 */
function ${funcPrefix}_widgets_init() {
    // Main sidebar (not yet used in templates)
    register_sidebar( array(
        'name'          => __( 'Sidebar', '${themeSlug}' ),
        'id'            => 'sidebar-1',
        'description'   => __( 'Add widgets here to appear in the sidebar.', '${themeSlug}' ),
        'before_widget' => '<section id="%1$s" class="widget %2$s">',
        'after_widget'  => '</section>',
        'before_title'  => '<h2 class="widget-title">',
        'after_title'   => '</h2>',
    ) );

    // Footer widget area (existing)
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
 * SEO: Custom document title for New Page Layout pages
 */
function ${funcPrefix}_filter_document_title( $title ) {
    if ( ! is_page() ) {
        return $title;
    }

    $post_id = get_queried_object_id();
    if ( ! $post_id ) {
        return $title;
    }

    $template = get_page_template_slug( $post_id );
    if ( $template !== 'page-new-page-layout.php' ) {
        return $title;
    }

    $seo_title = get_post_meta( $post_id, '${funcPrefix}_npl_seo_title', true );
    if ( ! empty( $seo_title ) ) {
        return $seo_title;
    }

    return $title;
}
add_filter( 'pre_get_document_title', '${funcPrefix}_filter_document_title' );

/**
 * SEO: Meta description for New Page Layout pages
 */
function ${funcPrefix}_output_newpage_meta_description() {
    if ( ! is_page() ) {
        return;
    }

    $post_id = get_queried_object_id();
    if ( ! $post_id ) {
        return;
    }

    $template = get_page_template_slug( $post_id );
    if ( $template !== 'page-new-page-layout.php' ) {
        return;
    }

    $seo_description = get_post_meta( $post_id, '${funcPrefix}_npl_seo_description', true );
    if ( ! empty( $seo_description ) ) {
        echo '<meta name="description" content="' . esc_attr( $seo_description ) . '">' . "\\n";
    }
}
add_action( 'wp_head', '${funcPrefix}_output_newpage_meta_description', 5 );

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