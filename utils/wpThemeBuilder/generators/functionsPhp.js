// utils/wpThemeBuilder/generators/functionsPhp.js

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

function generateFunctionsPhp(options = {}) {
  const {
    themeSlug = 'local-business-theme',
    themeName = 'Local Business Theme',
    cssFiles = [],
    hasBootstrapJs = false,
    // Changes on every export. Used as the upgrade stamp below, so a rebuilt
    // theme purges its caches once even though style.css still says 1.0.0.
    // An option rather than a value computed here so tests can pin it.
    buildStamp = '',
  } = options;

  const funcPrefix = makePhpIdentifier(themeSlug);
  // Upper-case, for the optional wp-config.php constant that keeps the SMTP
  // password out of the database.
  const constPrefix = funcPrefix.toUpperCase();

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
/**
 * Cache-busting version for a theme asset.
 *
 * Assets were previously enqueued with a hardcoded '1.0.0'. Since the URL
 * never changed between theme exports, browsers, LiteSpeed and any CDN were
 * entitled to keep serving the old file — which is why an updated theme
 * could still show the previous CSS.
 *
 * The file's modification time changes on every export, so the URL changes
 * with it and caches fetch the new copy. Falls back to the theme version if
 * the file cannot be read.
 *
 * @param string $relative e.g. 'css/index.css'
 */
function ${funcPrefix}_asset_version( $relative ) {
    $path = get_template_directory() . '/' . ltrim( $relative, '/' );

    if ( file_exists( $path ) ) {
        $mtime = filemtime( $path );
        if ( $mtime ) {
            return (string) $mtime;
        }
    }

    $theme = wp_get_theme();
    return $theme->get( 'Version' ) ? $theme->get( 'Version' ) : '1.0.0';
}

/**
 * True when the page being viewed contains a contact form section.
 *
 * Reads the section model rather than matching on page type, so it stays
 * correct if a form is added to another page later.
 */
function ${funcPrefix}_page_has_form() {
    if ( ! is_singular() ) {
        return false;
    }

    $post_id = get_queried_object_id();
    if ( ! $post_id ) {
        return false;
    }

    $sections = get_post_meta( $post_id, '${funcPrefix}_sections', true );
    if ( ! is_array( $sections ) ) {
        return false;
    }

    foreach ( $sections as $section ) {
        if ( isset( $section['type'] ) && $section['type'] === 'form' ) {
            return true;
        }
    }

    return false;
}

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
        ${funcPrefix}_asset_version( 'css/' . $page_css . '.css' )
    );
${bootstrapJsCode}

    // Contact form JavaScript.
    //
    // This used to load on the front page only. The contact page carries the
    // same form, so there the script was missing: the browser submitted the
    // form natively and the visitor landed on a page of raw JSON instead of
    // seeing a confirmation message.
    //
    // Load it wherever a page actually contains a form section, rather than
    // guessing from the URL.
    if ( ${funcPrefix}_page_has_form() ) {
        wp_enqueue_script(
            '${themeSlug}-contact-form',
            $theme_uri . '/js/contact-form-handler.js',
            array(),
            ${funcPrefix}_asset_version( 'js/contact-form-handler.js' ),
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

            // A post created by hand in wp-admin has no SEO field set, so
            // derive something from the excerpt rather than repeating the
            // tagline on every one. Posts published by the Interlink Engine
            // plugin DO set '${funcPrefix}_page_description', so they never
            // reach this branch.
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
 * SEO: keep the legal pages out of the index.
 *
 * The static build ships <meta name="robots" content="noindex, follow"> on
 * privacy, terms and accessibility, and leaves them out of sitemap.xml. Their
 * text is boilerplate shared near-verbatim with every other site on the web:
 * nobody searches for it, it never converts, and indexing it spends crawl
 * budget on the pages that matter least.
 *
 * Without this the exported theme would index pages the downloaded site
 * hides — the two would disagree about the same content.
 *
 * Read from ${funcPrefix}_page_type rather than matching on slug, so a page
 * the client renames stays correctly excluded.
 */
function ${funcPrefix}_noindex_legal_pages() {
    if ( ! is_singular() ) {
        return;
    }

    $post_id = get_queried_object_id();
    if ( ! $post_id ) {
        return;
    }

    if ( get_post_meta( $post_id, '${funcPrefix}_page_type', true ) === 'legal' ) {
        echo '<meta name="robots" content="noindex, follow">' . "\n";
    }
}
add_action( 'wp_head', '${funcPrefix}_noindex_legal_pages', 1 );

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

/* -------------------------------------------------------------------------
 * Email delivery
 * ---------------------------------------------------------------------- */

/**
 * Route mail through the SMTP account set in Theme Settings.
 *
 * WordPress sends via PHP mail() by default. Many hosts block that, and where
 * they do not, the message comes from the server rather than an authenticated
 * mailbox — so SPF and DKIM fail and it lands in spam. Sending through the
 * business's own mailbox fixes both.
 *
 * Does nothing when no host is set, so behaviour is unchanged until the
 * settings are filled in.
 */
function ${funcPrefix}_smtp_password() {
    // A wp-config.php constant is preferred: it keeps the password out of the
    // database, where an admin user or a dump would otherwise expose it.
    if ( defined( '${constPrefix}_SMTP_PASS' ) ) {
        return ${constPrefix}_SMTP_PASS;
    }
    return ${funcPrefix}_get_setting( 'smtp_pass', '' );
}

function ${funcPrefix}_configure_smtp( $phpmailer ) {
    $host = ${funcPrefix}_get_setting( 'smtp_host', '' );
    if ( empty( $host ) ) {
        return;
    }

    $phpmailer->isSMTP();
    $phpmailer->Host = $host;

    $port = (int) ${funcPrefix}_get_setting( 'smtp_port', 587 );
    $phpmailer->Port = $port > 0 ? $port : 587;

    $secure = ${funcPrefix}_get_setting( 'smtp_secure', 'tls' );
    $phpmailer->SMTPSecure  = ( $secure === 'none' ) ? '' : $secure;
    $phpmailer->SMTPAutoTLS = ( $secure !== 'none' );

    $user = ${funcPrefix}_get_setting( 'smtp_user', '' );
    if ( $user !== '' ) {
        $phpmailer->SMTPAuth = true;
        $phpmailer->Username = $user;
        $phpmailer->Password = ${funcPrefix}_smtp_password();
    } else {
        $phpmailer->SMTPAuth = false;
    }

    // The From address must be on the SMTP account's domain, or the receiving
    // server fails SPF and treats the message as spam.
    $from = ${funcPrefix}_get_setting( 'smtp_from', '' );
    if ( is_email( $from ) ) {
        $phpmailer->setFrom(
            $from,
            ${funcPrefix}_get_setting( 'smtp_from_name', ${funcPrefix}_get_setting( 'business_name', '' ) ),
            false
        );
    }
}
add_action( 'phpmailer_init', '${funcPrefix}_configure_smtp' );

/**
 * Record why a send failed. Without this a failure is silent: the visitor is
 * told the message was sent and the business receives nothing.
 */
function ${funcPrefix}_log_mail_failure( $wp_error ) {
    if ( is_wp_error( $wp_error ) ) {
        error_log( '[${themeSlug}] Mail failed: ' . $wp_error->get_error_message() );
        set_transient( '${funcPrefix}_last_mail_error', $wp_error->get_error_message(), DAY_IN_SECONDS );
    }
}
add_action( 'wp_mail_failed', '${funcPrefix}_log_mail_failure' );

/**
 * Warn when the From address is on a different domain to the SMTP host — the
 * most common reason mail is configured correctly yet still goes to spam.
 */
function ${funcPrefix}_smtp_admin_notice() {
    if ( ! current_user_can( 'edit_theme_options' ) ) {
        return;
    }

    $host = ${funcPrefix}_get_setting( 'smtp_host', '' );
    $from = ${funcPrefix}_get_setting( 'smtp_from', '' );
    if ( empty( $host ) || ! is_email( $from ) ) {
        return;
    }

    $from_domain = strtolower( ltrim( strrchr( $from, '@' ), '@' ) );
    $host_domain = strtolower( preg_replace( '/^(smtp|mail|send)\./i', '', $host ) );

    if ( $from_domain && $host_domain && strpos( $host_domain, $from_domain ) === false ) {
        printf(
            '<div class="notice notice-warning"><p>%s</p></div>',
            esc_html( sprintf(
                __( 'Email settings: the From address uses %1$s but mail is sent through %2$s. Messages may be marked as spam unless both are on the same domain.', '${themeSlug}' ),
                $from_domain,
                $host
            ) )
        );
    }
}
add_action( 'admin_notices', '${funcPrefix}_smtp_admin_notice' );

/**
 * Flush every cache this theme can reach whenever the theme's files change.
 *
 * Re-uploading a theme over itself does NOT fire 'after_switch_theme' — the
 * active theme never changed — so a rebuilt theme would keep serving pages
 * rendered from the previous content model until something else happened to
 * clear the cache. 'upgrader_process_complete' is the hook that actually
 * fires on an over-the-top upload, so both are wired here.
 */
function ${funcPrefix}_purge_caches() {
    // Core object cache and rewrite rules
    wp_cache_flush();
    flush_rewrite_rules();

    // Popular page caches, each a no-op when the plugin is absent
    if ( function_exists( 'wp_cache_clear_cache' ) )      { wp_cache_clear_cache(); }        // WP Super Cache
    if ( function_exists( 'w3tc_flush_all' ) )            { w3tc_flush_all(); }              // W3 Total Cache
    if ( function_exists( 'rocket_clean_domain' ) )       { rocket_clean_domain(); }         // WP Rocket
    if ( class_exists( 'LiteSpeed\\\\Purge' ) )              { do_action( 'litespeed_purge_all' ); }
    if ( has_action( 'cache_enabler_clear_complete_cache' ) ) { do_action( 'cache_enabler_clear_complete_cache' ); }
    if ( class_exists( 'autoptimizeCache' ) )             { autoptimizeCache::clearall(); }
    if ( function_exists( 'sg_cachepress_purge_cache' ) ) { sg_cachepress_purge_cache(); }   // SiteGround

    // PHP opcode cache — theme PHP files were just overwritten
    if ( function_exists( 'opcache_reset' ) ) {
        opcache_reset();
    }
}
add_action( 'after_switch_theme', '${funcPrefix}_purge_caches' );
add_action( 'upgrader_process_complete', '${funcPrefix}_purge_caches' );

/**
 * One-time cleanup after the theme files change.
 *
 * The two hooks above are not enough on their own. When a theme is uploaded
 * over itself, WordPress serves that request using the PREVIOUS functions.php
 * — the new file is not loaded until the next request — so a handler added in
 * this version cannot run during the upgrade that installs it. A build stamp
 * checked on admin_init closes that gap: the first admin page load after the
 * new files land runs the cleanup exactly once.
 *
 * The stamp is the export time, not style.css's Version. Every rebuild of a
 * site produces a new theme with the same declared version number, so the
 * version header cannot tell one export from the next.
 */
define( '${constPrefix}_BUILD', '${buildStamp || new Date().toISOString()}' );

function ${funcPrefix}_maybe_upgrade() {
    $current = ${constPrefix}_BUILD;
    $stored  = get_option( '${funcPrefix}_installed_build' );

    if ( $stored === $current ) {
        return;
    }

    ${funcPrefix}_purge_caches();

    // Blog automation used to live in this theme. It now lives in the
    // Interlink Engine plugin. The theme's cron event outlives the files that
    // registered it, so an upgraded site would keep waking a callback that no
    // longer exists, once a day, forever. Clear it.
    //
    // The saved settings are left in place deliberately: they hold the
    // customer's topics and publishing schedule, and deleting them on a theme
    // update would be destructive with nothing to gain. They are a few rows in
    // wp_options and can be removed by hand if wanted.
    wp_clear_scheduled_hook( '${funcPrefix}_generate_blog_post' );

    update_option( '${funcPrefix}_installed_build', $current );
}
add_action( 'admin_init', '${funcPrefix}_maybe_upgrade' );
`;
}

module.exports = {
  generateFunctionsPhp,
};