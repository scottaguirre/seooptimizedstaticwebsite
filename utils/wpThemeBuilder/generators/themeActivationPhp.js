// utils/wpThemeBuilder/generators/themeActivationPhp.js

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

/**
 * Generate the inc/theme-activation.php file
 * This handles importing content into WordPress on theme activation
 *
 * @param {object} options - Configuration options
 * @param {string} options.themeSlug - Theme slug
 * @param {string} options.themeName - Theme display name
 * @returns {string} - Complete PHP code for theme-activation.php
 */
function generateThemeActivationPhp(options = {}) {
  const {
    themeSlug = 'local-business-theme',
    themeName = 'Local Business Theme',
  } = options;

  const funcPrefix = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Theme Activation Handler
 * 
 * Imports content from static HTML build into WordPress database
 * Runs once when the theme is activated
 *
 * @package ${themeSlug}
 */

// Prevent direct access
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Run on theme activation
 */
function ${funcPrefix}_on_activation() {
    // Import global settings
    ${funcPrefix}_import_global_settings();

    // Import pages and their content
    ${funcPrefix}_import_pages();

    // Set up navigation menu
    ${funcPrefix}_setup_navigation();
}
add_action( 'after_switch_theme', '${funcPrefix}_on_activation' );

/**
 * Import global settings into wp_options
 */
function ${funcPrefix}_import_global_settings() {
    $settings_file = get_template_directory() . '/theme-global-settings.php';

    if ( ! file_exists( $settings_file ) ) {
        return;
    }

    $settings = include $settings_file;

    if ( ! is_array( $settings ) ) {
        return;
    }

    // Store in wp_options
    update_option( '${funcPrefix}_global_settings', $settings );
}

/**
 * Import pages and store content as post meta
 */
function ${funcPrefix}_import_pages() {
    // Load page definitions
    $pages_file = get_template_directory() . '/theme-pages.php';
    if ( ! file_exists( $pages_file ) ) {
        return;
    }

    $page_defs = include $pages_file;
    if ( ! is_array( $page_defs ) ) {
        return;
    }

    // Load page content
    $content_file = get_template_directory() . '/theme-page-content.php';
    $page_content = array();
    if ( file_exists( $content_file ) ) {
        $maybe_content = include $content_file;
        if ( is_array( $maybe_content ) ) {
            $page_content = $maybe_content;
        }
    }

    $front_page_id = 0;

    // Create or update each page
    foreach ( $page_defs as $def ) {
        $slug     = isset( $def['slug'] ) ? sanitize_title( $def['slug'] ) : '';
        $title    = isset( $def['title'] ) ? sanitize_text_field( $def['title'] ) : '';
        $template = isset( $def['template'] ) ? sanitize_text_field( $def['template'] ) : '';
        $order    = isset( $def['menu_order'] ) ? intval( $def['menu_order'] ) : 0;

        if ( empty( $slug ) || empty( $title ) ) {
            continue;
        }

        // Check if page already exists
        $existing = get_page_by_path( $slug );

        if ( $existing ) {
            $page_id = $existing->ID;

            // Update existing page
            wp_update_post( array(
                'ID'         => $page_id,
                'post_title' => $title,
                'menu_order' => $order,
            ) );
        } else {
            // Create new page
            $page_id = wp_insert_post( array(
                'post_title'  => $title,
                'post_name'   => $slug,
                'post_type'   => 'page',
                'post_status' => 'publish',
                'menu_order'  => $order,
            ) );
        }

        if ( ! $page_id || is_wp_error( $page_id ) ) {
            continue;
        }

        // Set page template if specified
        if ( ! empty( $template ) ) {
            update_post_meta( $page_id, '_wp_page_template', $template );
        }

        // Store content as post meta
        if ( isset( $page_content[ $slug ] ) && is_array( $page_content[ $slug ] ) ) {
            foreach ( $page_content[ $slug ] as $meta_key => $meta_value ) {
                update_post_meta( $page_id, '${funcPrefix}_' . $meta_key, $meta_value );
            }
        }

        // Track front page
        if ( $template === 'front-page.php' || $slug === 'about' || $slug === 'home' ) {
            $front_page_id = $page_id;
        }
    }

    // Set the front page
    if ( $front_page_id ) {
        update_option( 'show_on_front', 'page' );
        update_option( 'page_on_front', $front_page_id );
    }
}

/**
 * Set up the navigation menu
 */
function ${funcPrefix}_setup_navigation() {
    // Check if primary menu already exists
    $locations = get_nav_menu_locations();
    if ( isset( $locations['primary'] ) && $locations['primary'] ) {
        return; // Don't overwrite existing menu
    }

    // Create a new menu
    $menu_name = '${themeName} Menu';
    $menu_id = wp_create_nav_menu( $menu_name );

    if ( is_wp_error( $menu_id ) ) {
        return;
    }

    // Assign menu to primary location
    $locations['primary'] = $menu_id;
    set_theme_mod( 'nav_menu_locations', $locations );

    // Load page definitions to build menu
    $pages_file = get_template_directory() . '/theme-pages.php';
    if ( ! file_exists( $pages_file ) ) {
        return;
    }

    $page_defs = include $pages_file;
    if ( ! is_array( $page_defs ) ) {
        return;
    }

    // Sort pages by menu_order
    usort( $page_defs, function( $a, $b ) {
        $order_a = isset( $a['menu_order'] ) ? intval( $a['menu_order'] ) : 0;
        $order_b = isset( $b['menu_order'] ) ? intval( $b['menu_order'] ) : 0;
        return $order_a - $order_b;
    } );

    // Separate pages into categories
    $home_page = null;
    $service_pages = array();
    $location_pages = array();
    $other_pages = array();

    foreach ( $page_defs as $def ) {
        $slug     = isset( $def['slug'] ) ? $def['slug'] : '';
        $template = isset( $def['template'] ) ? $def['template'] : '';

        // Skip legal pages (they go in footer)
        if ( in_array( $slug, array( 'privacy-policy', 'terms-of-use', 'accessibility' ), true ) ) {
            continue;
        }

        // Identify home/about page
        if ( $template === 'front-page.php' || $slug === 'about' || $slug === 'home' ) {
            $home_page = $def;
            continue;
        }

        // Identify location pages
        if ( strpos( $slug, 'location-' ) === 0 ) {
            $location_pages[] = $def;
            continue;
        }

        // Everything else is a service page
        $service_pages[] = $def;
    }

    // Add Home to menu
    if ( $home_page ) {
        $page = get_page_by_path( $home_page['slug'] );
        if ( $page ) {
            wp_update_nav_menu_item( $menu_id, 0, array(
                'menu-item-title'     => isset( $home_page['title'] ) ? $home_page['title'] : 'Home',
                'menu-item-object'    => 'page',
                'menu-item-object-id' => $page->ID,
                'menu-item-type'      => 'post_type',
                'menu-item-status'    => 'publish',
            ) );
        }
    }

    // Add service pages
    if ( count( $service_pages ) === 1 ) {
        // Single service: add directly to menu
        $svc = $service_pages[0];
        $page = get_page_by_path( $svc['slug'] );
        if ( $page ) {
            wp_update_nav_menu_item( $menu_id, 0, array(
                'menu-item-title'     => isset( $svc['title'] ) ? $svc['title'] : 'Services',
                'menu-item-object'    => 'page',
                'menu-item-object-id' => $page->ID,
                'menu-item-type'      => 'post_type',
                'menu-item-status'    => 'publish',
            ) );
        }
    } elseif ( count( $service_pages ) > 1 ) {
        // Multiple services: create dropdown
        $services_parent_id = wp_update_nav_menu_item( $menu_id, 0, array(
            'menu-item-title'  => __( 'Services', '${themeSlug}' ),
            'menu-item-url'    => '#',
            'menu-item-type'   => 'custom',
            'menu-item-status' => 'publish',
        ) );

        foreach ( $service_pages as $svc ) {
            $page = get_page_by_path( $svc['slug'] );
            if ( $page ) {
                wp_update_nav_menu_item( $menu_id, 0, array(
                    'menu-item-title'     => isset( $svc['title'] ) ? $svc['title'] : '',
                    'menu-item-object'    => 'page',
                    'menu-item-object-id' => $page->ID,
                    'menu-item-type'      => 'post_type',
                    'menu-item-parent-id' => $services_parent_id,
                    'menu-item-status'    => 'publish',
                ) );
            }
        }
    }

    // Add location pages
    if ( count( $location_pages ) > 0 ) {
        $locations_parent_id = wp_update_nav_menu_item( $menu_id, 0, array(
            'menu-item-title'  => __( 'Locations', '${themeSlug}' ),
            'menu-item-url'    => '#',
            'menu-item-type'   => 'custom',
            'menu-item-status' => 'publish',
        ) );

        foreach ( $location_pages as $loc ) {
            $page = get_page_by_path( $loc['slug'] );
            if ( $page ) {
                wp_update_nav_menu_item( $menu_id, 0, array(
                    'menu-item-title'     => isset( $loc['title'] ) ? $loc['title'] : '',
                    'menu-item-object'    => 'page',
                    'menu-item-object-id' => $page->ID,
                    'menu-item-type'      => 'post_type',
                    'menu-item-parent-id' => $locations_parent_id,
                    'menu-item-status'    => 'publish',
                ) );
            }
        }
    }
}

/**
 * Helper: Get a global setting
 */
function ${funcPrefix}_get_global_setting( $key, $default = '' ) {
    $settings = get_option( '${funcPrefix}_global_settings', array() );
    return isset( $settings[ $key ] ) ? $settings[ $key ] : $default;
}
`;
}

module.exports = {
  generateThemeActivationPhp
};