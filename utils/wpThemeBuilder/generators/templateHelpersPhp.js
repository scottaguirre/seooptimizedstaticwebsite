// utils/wpThemeBuilder/generators/templateHelpersPhp.js

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

/**
 * Generate the inc/template-helpers.php file
 * This provides helper functions for use in theme templates
 *
 * @param {object} options - Configuration options
 * @param {string} options.themeSlug - Theme slug
 * @returns {string} - Complete PHP code for template-helpers.php
 */
function generateTemplateHelpersPhp(options = {}) {
  const {
    themeSlug = 'local-business-theme',
  } = options;

  const funcPrefix = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Template Helper Functions
 * 
 * Convenient functions for retrieving content in theme templates
 *
 * @package ${themeSlug}
 */

// Prevent direct access
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Get a page-specific field from post meta
 *
 * Usage: get_page_field( 'hero_h1' )
 *        get_page_field( 'section_0_h2_0' )
 *        get_page_field( 'hero_tagline', $post_id )
 *
 * @param string $field_key - The field key (without theme prefix)
 * @param int|null $post_id - Optional post ID (defaults to current post)
 * @return string - The field value or empty string
 */
function get_page_field( $field_key, $post_id = null ) {
    if ( ! $post_id ) {
        $post_id = get_the_ID();
    }

    $full_key = '${funcPrefix}_' . $field_key;
    $value = get_post_meta( $post_id, $full_key, true );

    return $value ? $value : '';
}

/**
 * Echo a page-specific field
 *
 * Usage: the_page_field( 'hero_h1' )
 *
 * @param string $field_key - The field key (without theme prefix)
 * @param int|null $post_id - Optional post ID
 */
function the_page_field( $field_key, $post_id = null ) {
    echo esc_html( get_page_field( $field_key, $post_id ) );
}

/**
 * Get a global setting
 *
 * Usage: get_global_setting( 'phone' )
 *        get_global_setting( 'business_name' )
 *        get_global_setting( 'social_facebook' )
 *
 * @param string $key - The setting key
 * @param string $default - Default value if not set
 * @return string - The setting value
 */
function get_global_setting( $key, $default = '' ) {
    $settings = get_option( '${funcPrefix}_global_settings', array() );
    return isset( $settings[ $key ] ) ? $settings[ $key ] : $default;
}

/**
 * Echo a global setting
 *
 * Usage: the_global_setting( 'phone' )
 *
 * @param string $key - The setting key
 * @param string $default - Default value if not set
 */
function the_global_setting( $key, $default = '' ) {
    echo esc_html( get_global_setting( $key, $default ) );
}

/**
 * Get all social links that have been set
 * Returns only non-empty social links
 *
 * Usage: $socials = get_social_links();
 *        foreach ( $socials as $platform => $url ) { ... }
 *
 * @return array - Associative array of platform => url
 */
function get_social_links() {
    $platforms = array( 'facebook', 'twitter', 'instagram', 'linkedin', 'youtube', 'pinterest' );
    $links = array();

    foreach ( $platforms as $platform ) {
        $url = get_global_setting( 'social_' . $platform );
        if ( ! empty( $url ) ) {
            $links[ $platform ] = $url;
        }
    }

    return $links;
}

/**
 * Check if any social links are set
 *
 * Usage: if ( has_social_links() ) { ... }
 *
 * @return bool
 */
function has_social_links() {
    return ! empty( get_social_links() );
}

/**
 * Get phone number formatted for tel: link
 *
 * Usage: <a href="tel:<?php echo get_phone_href(); ?>">
 *
 * @return string - Phone number with only digits and + sign
 */
function get_phone_href() {
    $phone = get_global_setting( 'phone' );
    // Remove everything except digits and + sign
    return preg_replace( '/[^0-9+]/', '', $phone );
}

/**
 * Display content only if field exists
 * Useful for conditional display of sections
 *
 * Usage: 
 * if_page_field( 'hero_tagline', '<p class="lead">', '</p>' );
 *
 * @param string $field_key - The field key
 * @param string $before - HTML before the content
 * @param string $after - HTML after the content
 * @param int|null $post_id - Optional post ID
 */
function if_page_field( $field_key, $before = '', $after = '', $post_id = null ) {
    $value = get_page_field( $field_key, $post_id );
    if ( ! empty( $value ) ) {
        echo $before . esc_html( $value ) . $after;
    }
}

/**
 * Display global setting only if it exists
 *
 * Usage:
 * if_global_setting( 'phone', '<p>Call us: ', '</p>' );
 *
 * @param string $key - The setting key
 * @param string $before - HTML before the content
 * @param string $after - HTML after the content
 */
function if_global_setting( $key, $before = '', $after = '' ) {
    $value = get_global_setting( $key );
    if ( ! empty( $value ) ) {
        echo $before . esc_html( $value ) . $after;
    }
}

/**
 * Get all fields for a specific section
 * Dynamically retrieves all content for a section number
 *
 * Usage: $section = get_section_content( 0 );
 *        echo $section['h2'][0]; // First H2 in section 0
 *        echo $section['p'][0];  // First paragraph in section 0
 *
 * @param int $section_index - The section index (0, 1, 2, etc.)
 * @param int|null $post_id - Optional post ID
 * @return array - Array with 'h2', 'h3', 'p', 'li' keys containing arrays of content
 */
function get_section_content( $section_index, $post_id = null ) {
    if ( ! $post_id ) {
        $post_id = get_the_ID();
    }

    $section = array(
        'id'    => get_page_field( "section_{$section_index}_id", $post_id ),
        'class' => get_page_field( "section_{$section_index}_class", $post_id ),
        'h1'    => array(),
        'h2'    => array(),
        'h3'    => array(),
        'h4'    => array(),
        'p'     => array(),
        'li'    => array(),
    );

    // Get all meta for this post
    $all_meta = get_post_meta( $post_id );
    $prefix = '${funcPrefix}_section_' . $section_index . '_';

    foreach ( $all_meta as $key => $values ) {
        if ( strpos( $key, $prefix ) !== 0 ) {
            continue;
        }

        // Parse key: section_0_h2_0 -> h2, 0
        $field_part = substr( $key, strlen( '${funcPrefix}_section_' . $section_index . '_' ) );

        // Match patterns like h2_0, p_1, li_0
        if ( preg_match( '/^(h[1-6]|p|li)_(\\d+)$/', $field_part, $matches ) ) {
            $tag = $matches[1];
            $index = intval( $matches[2] );
            $section[ $tag ][ $index ] = isset( $values[0] ) ? $values[0] : '';
        }
    }

    // Sort arrays by index
    foreach ( array( 'h1', 'h2', 'h3', 'h4', 'p', 'li' ) as $tag ) {
        ksort( $section[ $tag ] );
        $section[ $tag ] = array_values( $section[ $tag ] ); // Re-index
    }

    return $section;
}

/**
 * Count how many sections exist on a page
 *
 * Usage: $count = get_section_count();
 *        for ( $i = 0; $i < $count; $i++ ) { ... }
 *
 * @param int|null $post_id - Optional post ID
 * @return int - Number of sections
 */
function get_section_count( $post_id = null ) {
    if ( ! $post_id ) {
        $post_id = get_the_ID();
    }

    $all_meta = get_post_meta( $post_id );
    $prefix = '${funcPrefix}_section_';
    $sections = array();

    foreach ( $all_meta as $key => $values ) {
        if ( strpos( $key, $prefix ) !== 0 ) {
            continue;
        }

        // Extract section number
        if ( preg_match( '/^${funcPrefix}_section_(\\d+)_/', $key, $matches ) ) {
            $sections[ $matches[1] ] = true;
        }
    }

    return count( $sections );
}

/**
 * Check if a section exists
 *
 * Usage: if ( has_section( 2 ) ) { ... }
 *
 * @param int $section_index - The section index
 * @param int|null $post_id - Optional post ID
 * @return bool
 */
function has_section( $section_index, $post_id = null ) {
    $section = get_section_content( $section_index, $post_id );
    
    // Check if section has any content
    return ! empty( $section['h1'] ) ||
           ! empty( $section['h2'] ) ||
           ! empty( $section['h3'] ) ||
           ! empty( $section['p'] ) ||
           ! empty( $section['li'] );
}

/**
 * Render a section dynamically
 * Outputs all content for a section with proper HTML tags
 *
 * Usage: render_section( 0 );
 *
 * @param int $section_index - The section index
 * @param int|null $post_id - Optional post ID
 */
function render_section( $section_index, $post_id = null ) {
    if ( ! has_section( $section_index, $post_id ) ) {
        return;
    }

    $section = get_section_content( $section_index, $post_id );
    $id_attr = ! empty( $section['id'] ) ? ' id="' . esc_attr( $section['id'] ) . '"' : '';
    $class_attr = ! empty( $section['class'] ) ? ' class="' . esc_attr( $section['class'] ) . '"' : '';

    echo '<section' . $id_attr . $class_attr . '>';
    echo '<div class="container">';

    // Output headings
    foreach ( $section['h1'] as $h1 ) {
        echo '<h1>' . esc_html( $h1 ) . '</h1>';
    }
    foreach ( $section['h2'] as $h2 ) {
        echo '<h2>' . esc_html( $h2 ) . '</h2>';
    }
    foreach ( $section['h3'] as $h3 ) {
        echo '<h3>' . esc_html( $h3 ) . '</h3>';
    }
    foreach ( $section['h4'] as $h4 ) {
        echo '<h4>' . esc_html( $h4 ) . '</h4>';
    }

    // Output paragraphs
    foreach ( $section['p'] as $p ) {
        echo '<p>' . esc_html( $p ) . '</p>';
    }

    // Output list if exists
    if ( ! empty( $section['li'] ) ) {
        echo '<ul>';
        foreach ( $section['li'] as $li ) {
            echo '<li>' . esc_html( $li ) . '</li>';
        }
        echo '</ul>';
    }

    echo '</div>';
    echo '</section>';
}
`;
}

module.exports = {
  generateTemplateHelpersPhp
};