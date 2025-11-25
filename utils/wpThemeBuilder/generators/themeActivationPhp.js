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

            // Update existing page title
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

            // IMPORTANT: If we have a custom extracted page_name, update the page title
            // This ensures the admin page list shows clean names like "Water Heater Repair" 
            // instead of "Water Heater Repair Leander TX"
            if ( isset( $page_content[ $slug ]['page_name'] ) && ! empty( $page_content[ $slug ]['page_name'] ) ) {
                $custom_page_name = sanitize_text_field( $page_content[ $slug ]['page_name'] );
                
                // Update the page title with the extracted clean name
                wp_update_post( array(
                    'ID'         => $page_id,
                    'post_title' => $custom_page_name,
                ) );
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
    $menu_name = '${themeName} Menu';
    $menu = wp_get_nav_menu_object( $menu_name );

    // Create menu if it doesn't exist
    if ( ! $menu ) {
        $menu_id = wp_create_nav_menu( $menu_name );
        
        if ( is_wp_error( $menu_id ) ) {
            return;
        }
    } else {
        $menu_id = $menu->term_id;
        
        // Clear existing menu items to repopulate with current pages
        $menu_items = wp_get_nav_menu_items( $menu_id );
        if ( $menu_items ) {
            foreach ( $menu_items as $item ) {
                wp_delete_post( $item->ID, true );
            }
        }
    }

    // Assign menu to primary location
    $locations = get_nav_menu_locations();
    if ( ! is_array( $locations ) ) {
        $locations = array();
    }
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

    // Load page content to get extracted page names
    $content_file = get_template_directory() . '/theme-page-content.php';
    $page_content = array();
    if ( file_exists( $content_file ) ) {
        $maybe_content = include $content_file;
        if ( is_array( $maybe_content ) ) {
            $page_content = $maybe_content;
        }
    }

    // Helper function to get the best menu title
    $get_menu_title = function( $def ) use ( $page_content ) {
        $slug = isset( $def['slug'] ) ? $def['slug'] : '';
        
        // First, try to use extracted page_name from content
        if ( isset( $page_content[ $slug ]['page_name'] ) && ! empty( $page_content[ $slug ]['page_name'] ) ) {
            return $page_content[ $slug ]['page_name'];
        }
        
        // Fallback to title from definition
        if ( isset( $def['title'] ) && ! empty( $def['title'] ) ) {
            return $def['title'];
        }
        
        // Last resort: convert slug to title case
        return ucwords( str_replace( '-', ' ', $slug ) );
    };

    // Helper function to clean menu titles
    $clean_menu_title = function( $title, $is_location = false ) {
        if ( empty( $title ) ) {
            return $title;
        }
        
        // Remove common state abbreviations
        $states = array(
            'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
            'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
            'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
            'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
            'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY'
        );
        
        // Remove state abbreviations (case insensitive)
        foreach ( $states as $state ) {
            // Remove ", TX" or " TX" at the end
            $title = preg_replace( '/[,\\s]+' . $state . '\\s*$/i', '', $title );
            // Remove "TX " at the beginning
            $title = preg_replace( '/^' . $state . '\\s+/i', '', $title );
        }
        
        // For location pages, remove "Location" prefix
        if ( $is_location ) {
            $title = preg_replace( '/^Location\\s+/i', '', $title );
        }
        
        // For service pages, remove city names from the end
        $title = preg_replace( '/\\s+in\\s+[A-Z][a-z]+$/i', '', $title );
        
        // Remove common location words
        $location_words = array( 'Leander', 'Austin', 'Cedar Park', 'Round Rock', 'Georgetown' );
        foreach ( $location_words as $location ) {
            // Remove location at the end
            $title = preg_replace( '/\\s+' . preg_quote( $location, '/' ) . '\\s*$/i', '', $title );
            // Remove "in Location" pattern
            $title = preg_replace( '/\\s+in\\s+' . preg_quote( $location, '/' ) . '\\s*$/i', '', $title );
        }
        
        // Remove extra spaces and trim
        $title = preg_replace( '/\\s+/', ' ', $title );
        $title = trim( $title );
        
        return $title;
    };

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
        if ( $template === 'front-page.php' || $slug === 'about' || $slug === 'home' || $slug === 'index' ) {
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
            $menu_title = $get_menu_title( $home_page );
            
            // Special case: Override menu title for front page
            if ( $home_page['slug'] === 'index' || $home_page['slug'] === 'home' ) {
                $menu_title = 'About Us';
            }
            
            // Clean the title
            $menu_title = $clean_menu_title( $menu_title, false );
            
            wp_update_nav_menu_item( $menu_id, 0, array(
                'menu-item-title'     => $menu_title,
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
            $menu_title = $get_menu_title( $svc );
            $menu_title = $clean_menu_title( $menu_title, false );
            
            wp_update_nav_menu_item( $menu_id, 0, array(
                'menu-item-title'     => $menu_title,
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
                $menu_title = $get_menu_title( $svc );
                $menu_title = $clean_menu_title( $menu_title, false );
                
                wp_update_nav_menu_item( $menu_id, 0, array(
                    'menu-item-title'     => $menu_title,
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
                $menu_title = $get_menu_title( $loc );
                $menu_title = $clean_menu_title( $menu_title, true ); // true = is_location
                
                wp_update_nav_menu_item( $menu_id, 0, array(
                    'menu-item-title'     => $menu_title,
                    'menu-item-object'    => 'page',
                    'menu-item-object-id' => $page->ID,
                    'menu-item-type'      => 'post_type',
                    'menu-item-parent-id' => $locations_parent_id,
                    'menu-item-status'    => 'publish',
                ) );
            }
        }
    }

    // Add other pages that don't fit categories
    foreach ( $other_pages as $other ) {
        $page = get_page_by_path( $other['slug'] );
        if ( $page ) {
            $menu_title = $get_menu_title( $other );
            $menu_title = $clean_menu_title( $menu_title, false );
            
            wp_update_nav_menu_item( $menu_id, 0, array(
                'menu-item-title'     => $menu_title,
                'menu-item-object'    => 'page',
                'menu-item-object-id' => $page->ID,
                'menu-item-type'      => 'post_type',
                'menu-item-status'    => 'publish',
            ) );
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