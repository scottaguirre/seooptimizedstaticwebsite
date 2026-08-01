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
require_once get_template_directory() . '/inc/section-renderer.php';
require_once get_template_directory() . '/inc/template-nav.php';
require_once get_template_directory() . '/inc/theme-settings.php';
require_once get_template_directory() . '/inc/template-helpers.php';
require_once get_template_directory() . '/inc/contact-form-handler.php';
require_once get_template_directory() . '/inc/blog-automation-settings.php';
require_once get_template_directory() . '/inc/blog-automation-engine.php';
require_once get_template_directory() . '/inc/blog-automation-scheduler.php';

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

    // Hero sizes.
    //
    // A client uploads ONE hero image; WordPress generates these on upload so
    // the theme can serve a phone the small file instead of the 1400px one.
    // Generated pages keep their four purpose-cropped files and do not use
    // these sizes.
    //
    // Cropped to the same proportions the generated heroes use at each
    // breakpoint, so a single upload still fills the space correctly.
    add_image_size( '${funcPrefix}-hero-mobile',  600,  350,  true );
    add_image_size( '${funcPrefix}-hero-tablet',  750,  400,  true );
    add_image_size( '${funcPrefix}-hero-desktop', 1250, 700,  true );
    add_image_size( '${funcPrefix}-hero-large',   1400, 700,  true );
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


    // Exactly one theme stylesheet per page.
    //
    // Every generated page ships its own copy (index.css, location-x.css,
    // ...) so it can be edited independently. Resolve that first.
    //
    // Pages a client creates in WordPress, and blog posts, have no matching
    // file — they fall back to theme.css. Without that fallback they would
    // load Bootstrap only and lose the entire design.
    $page_css = '';

    if ( is_front_page() || is_home() ) {
        $page_css = 'index';
    } elseif ( is_singular() ) {
        $post_obj = get_queried_object();
        if ( $post_obj && ! empty( $post_obj->post_name ) ) {
            $slug = $post_obj->post_name;

            if ( file_exists( get_template_directory() . '/css/' . $slug . '.css' ) ) {
                $page_css = $slug;
            } else {
                // Service pages are slugged "<service>-<city>-<st>" but their
                // stylesheet is named "<service>.css".
                $trimmed = preg_replace( '/-[a-z]+-[a-z]{2}$/i', '', $slug );
                if ( $trimmed !== $slug
                     && file_exists( get_template_directory() . '/css/' . $trimmed . '.css' ) ) {
                    $page_css = $trimmed;
                }
            }
        }
    }

    // Fallback for anything without its own stylesheet
    if ( $page_css === '' || ! file_exists( get_template_directory() . '/css/' . $page_css . '.css' ) ) {
        $page_css = 'theme';
    }

    wp_enqueue_style(
        '${themeSlug}-page',
        $theme_uri . '/css/' . $page_css . '.css',
        array( '${themeSlug}-bootstrap' ),
        '1.0.0'
    );
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
 * SEO: document title.
 *
 * These filters used to be gated on 'page-new-page-layout.php' and read
 * ${funcPrefix}_npl_seo_* meta — a template and meta keys that no longer
 * exist, so neither ever ran. Every page fell back to WordPress's default
 * "Page Title - Site Name", discarding the generated SEO title entirely.
 */
function ${funcPrefix}_filter_document_title( $title ) {
    if ( ! is_singular() ) {
        return $title;
    }

    $post_id = get_queried_object_id();
    if ( ! $post_id ) {
        return $title;
    }

    $seo_title = get_post_meta( $post_id, '${funcPrefix}_page_title', true );

    return ! empty( $seo_title ) ? $seo_title : $title;
}
add_filter( 'pre_get_document_title', '${funcPrefix}_filter_document_title' );

/**
 * SEO: meta description.
 *
 * Stored on every generated page, and editable per page in the SEO box.
 * Falls back to the site tagline so no page ships without one.
 */
function ${funcPrefix}_output_meta_description() {
    $description = '';

    if ( is_singular() ) {
        $post_id = get_queried_object_id();
        if ( $post_id ) {
            $description = get_post_meta( $post_id, '${funcPrefix}_page_description', true );

            // Posts published by the blog automation have no SEO fields set,
            // so derive something useful rather than repeating the tagline on
            // every one of them.
            if ( empty( $description ) && 'post' === get_post_type( $post_id ) ) {
                $excerpt = get_the_excerpt( $post_id );
                if ( $excerpt ) {
                    $description = wp_trim_words( wp_strip_all_tags( $excerpt ), 30, '' );
                }
            }
        }
    }

    if ( empty( $description ) ) {
        $description = get_bloginfo( 'description' );
    }

    if ( ! empty( $description ) ) {
        echo '<meta name="description" content="' . esc_attr( wp_strip_all_tags( $description ) ) . '">' . "\n";
    }
}
add_action( 'wp_head', '${funcPrefix}_output_meta_description', 1 );

/**
 * NOTE: this file used to define ${funcPrefix}_filter_meta_content(), hooked to
 * get_post_metadata, which eval()'d any meta value containing PHP tags.
 *
 * It was removed for two reasons:
 *
 * 1. CORRECTNESS. A get_post_metadata filter that returns non-null
 *    short-circuits WordPress own lookup, and WordPress then does:
 *
 *        if ( $single && is_array( $check ) ) { return $check[0]; }
 *
 *    Several of this theme's meta values are arrays - the ordered section
 *    descriptors, image dimensions, custom sections - so every one of them
 *    was silently reduced to its first element. Pages rendered empty.
 *
 * 2. SECURITY. It executed stored post meta as PHP. Nothing in this theme
 *    stores PHP in meta; asset paths are resolved by the section renderer.
 */
`;
}

module.exports = {
  generateFunctionsPhp,
};