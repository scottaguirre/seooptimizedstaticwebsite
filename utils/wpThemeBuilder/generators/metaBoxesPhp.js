// utils/wpThemeBuilder/generators/metaBoxesPhp.js

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

/**
 * Generate the inc/meta-boxes.php file
 * This creates the admin interface for editing page content
 *
 * @param {object} options - Configuration options
 * @param {string} options.themeSlug - Theme slug
 * @returns {string} - Complete PHP code for meta-boxes.php
 */
function generateMetaBoxesPhp(options = {}) {
  const {
    themeSlug = 'local-business-theme',
  } = options;

  const funcPrefix = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Custom Meta Boxes for Page Content
 * 
 * Displays only editable text fields to users,
 * hiding HTML structure fields for safety
 *
 * @package ${themeSlug}
 */

// Prevent direct access
if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Register meta boxes for pages
 * ONLY shows "Page Content" for imported static pages
 * New Page Layout meta boxes are handled in newpage-meta-boxes.php
 */
function ${funcPrefix}_register_meta_boxes() {
    global $post;
    
    if ( ! $post ) {
        return;
    }
    
    // Get the template for this page
    $template = get_post_meta( $post->ID, '_wp_page_template', true );
    
    // Show "Page Content" meta box ONLY for pages NOT using New Page Layout
    if ( $template !== 'page-new-page-layout.php' ) {
        add_meta_box(
            '${funcPrefix}_page_content',
            __( 'Page Content', '${themeSlug}' ),
            '${funcPrefix}_render_content_meta_box',
            'page',
            'normal',
            'high'
        );
    }
}
add_action( 'add_meta_boxes', '${funcPrefix}_register_meta_boxes' );

/**
 * Render the meta box content for imported static pages
 * Groups fields by block for organized display
 */
function ${funcPrefix}_render_content_meta_box( $post ) {
    // Security nonce
    wp_nonce_field( '${funcPrefix}_save_meta', '${funcPrefix}_meta_nonce' );

    // Get all post meta for this page
    $all_meta = get_post_meta( $post->ID );

    // Group fields by block
    $blocks = array();
    $prefix = '${funcPrefix}_';

    foreach ( $all_meta as $key => $values ) {
        // Skip non-theme fields
        if ( strpos( $key, $prefix ) !== 0 ) {
            continue;
        }

        // Skip HTML and type fields (these should be hidden from users)
        if ( strpos( $key, '_html' ) !== false || strpos( $key, '_type' ) !== false ) {
            continue;
        }

        // Skip New Page Layout fields (handled in newpage-meta-boxes.php)
        if ( strpos( $key, $prefix . 'npl_' ) === 0 ) {
            continue;
        }

        // Parse block fields: local_business_theme_block_0_h2_0
        if ( preg_match( '/^' . preg_quote( $prefix, '/' ) . 'block_(\\d+)_(.+)$/', $key, $matches ) ) {
            $block_index = $matches[1];
            $field_name = $matches[2];

            if ( ! isset( $blocks[ $block_index ] ) ) {
                $blocks[ $block_index ] = array(
                    'fields' => array(),
                    'type'   => get_post_meta( $post->ID, $prefix . 'block_' . $block_index . '_type', true ),
                );
            }

            $blocks[ $block_index ]['fields'][ $field_name ] = array(
                'key'   => $key,
                'value' => isset( $values[0] ) ? $values[0] : '',
            );
        }
    }

    // If no blocks exist yet, show a message
    if ( empty( $blocks ) ) {
        echo '<p class="description">';
        echo esc_html__( 'No content fields found. Content will appear here after importing your static site.', '${themeSlug}' );
        echo '</p>';
        return;
    }

    // Sort blocks by index
    ksort( $blocks );

    // Render the fields
    echo '<div class="${funcPrefix}-meta-box-wrapper">';
    echo '<style>
        .${funcPrefix}-meta-box-wrapper { max-width: 100%; }
        .${funcPrefix}-block-group { margin-bottom: 25px; padding: 20px; background: #f9f9f9; border-left: 4px solid #2271b1; border-radius: 3px; }
        .${funcPrefix}-block-group h3 { margin: 0 0 15px 0; color: #2271b1; font-size: 14px; font-weight: 600; text-transform: uppercase; }
        .${funcPrefix}-field { margin-bottom: 15px; }
        .${funcPrefix}-field:last-child { margin-bottom: 0; }
        .${funcPrefix}-field label { display: block; font-weight: 600; margin-bottom: 5px; color: #1d2327; font-size: 13px; }
        .${funcPrefix}-field input[type="text"],
        .${funcPrefix}-field textarea { width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 14px; }
        .${funcPrefix}-field textarea { min-height: 100px; resize: vertical; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif; }
    </style>';

    foreach ( $blocks as $block_index => $block_data ) {
        $block_type = ! empty( $block_data['type'] ) ? ucfirst( $block_data['type'] ) : 'Content';

        echo '<div class="${funcPrefix}-block-group">';
        echo '<h3>' . sprintf( esc_html__( 'Block %d (%s)', '${themeSlug}' ), $block_index, esc_html( $block_type ) ) . '</h3>';

        // Sort fields for consistent order
        ksort( $block_data['fields'] );

        foreach ( $block_data['fields'] as $field_name => $field_data ) {
            ${funcPrefix}_render_field( $field_name, $field_data );
        }

        echo '</div>';
    }

    echo '</div>';
}

/**
 * Render a single field for imported static blocks
 */
function ${funcPrefix}_render_field( $field_name, $field_data ) {
    $field_id    = $field_data['key'];
    $field_value = $field_data['value'];
    $label       = ${funcPrefix}_format_field_label( $field_name );

    // Determine if this should be a textarea
    $is_textarea = ${funcPrefix}_is_textarea_field( $field_name, $field_value );

    echo '<div class="${funcPrefix}-field">';
    echo '<label for="' . esc_attr( $field_id ) . '">' . esc_html( $label ) . '</label>';

    if ( $is_textarea ) {
        echo '<textarea id="' . esc_attr( $field_id ) . '" name="' . esc_attr( $field_id ) . '" rows="4">';
        echo esc_textarea( $field_value );
        echo '</textarea>';
    } else {
        echo '<input type="text" id="' . esc_attr( $field_id ) . '" name="' . esc_attr( $field_id ) . '" value="' . esc_attr( $field_value ) . '" />';
    }

    echo '</div>';
}

/**
 * Format field name into readable label
 */
function ${funcPrefix}_format_field_label( $field_name ) {
    // Handle h1_0, h2_0, p_0, etc.
    if ( preg_match( '/^([a-z]+\\d?)_(\\d+)$/', $field_name, $matches ) ) {
        $tag   = $matches[1];
        $index = intval( $matches[2] ) + 1;

        $tag_labels = array(
            'h1' => __( 'Heading 1', '${themeSlug}' ),
            'h2' => __( 'Heading 2', '${themeSlug}' ),
            'h3' => __( 'Heading 3', '${themeSlug}' ),
            'h4' => __( 'Heading 4', '${themeSlug}' ),
            'h5' => __( 'Heading 5', '${themeSlug}' ),
            'h6' => __( 'Heading 6', '${themeSlug}' ),
            'p'  => __( 'Paragraph', '${themeSlug}' ),
            'li' => __( 'List Item', '${themeSlug}' ),
        );

        $tag_label = isset( $tag_labels[ $tag ] ) ? $tag_labels[ $tag ] : strtoupper( $tag );

        return sprintf( '%s #%d', $tag_label, $index );
    }

    // Handle link_text_0
    if ( preg_match( '/^link_text_(\\d+)$/', $field_name, $matches ) ) {
        $index = intval( $matches[1] ) + 1;
        return sprintf( __( 'Link Text #%d', '${themeSlug}' ), $index );
    }

    // Default: convert underscores to spaces and capitalize
    return ucwords( str_replace( '_', ' ', $field_name ) );
}

/**
 * Determine if a field should be a textarea
 */
function ${funcPrefix}_is_textarea_field( $field_name, $field_value ) {
    // Paragraphs and list items should be textareas
    if ( strpos( $field_name, 'p_' ) === 0 || strpos( $field_name, 'li_' ) === 0 ) {
        return true;
    }

    // If value is long or contains multiple words, use textarea
    if ( strlen( $field_value ) > 100 ) {
        return true;
    }

    return false;
}

/**
 * Save meta box data
 */
function ${funcPrefix}_save_meta( $post_id ) {
    // Security checks
    if ( ! isset( $_POST['${funcPrefix}_meta_nonce'] ) ) {
        return;
    }

    if ( ! wp_verify_nonce( $_POST['${funcPrefix}_meta_nonce'], '${funcPrefix}_save_meta' ) ) {
        return;
    }

    if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
        return;
    }

    if ( ! current_user_can( 'edit_post', $post_id ) ) {
        return;
    }

    // Save all theme meta fields
    $prefix = '${funcPrefix}_';

    foreach ( $_POST as $key => $value ) {
        if ( strpos( $key, $prefix ) !== 0 ) {
            continue;
        }

        // Don't allow saving HTML or type fields
        if ( strpos( $key, '_html' ) !== false || strpos( $key, '_type' ) !== false ) {
            continue;
        }

        // Sanitize based on field type
        $clean_key = substr( $key, strlen( $prefix ) );

        // Paragraph-type fields and long text
        if (
            strpos( $clean_key, 'p_' ) === 0
            || strpos( $clean_key, 'li_' ) === 0
        ) {
            $sanitized = sanitize_textarea_field( $value );
        } else {
            // Headings, URLs, short text, etc.
            $sanitized = sanitize_text_field( $value );
        }

        update_post_meta( $post_id, $key, $sanitized );
    }
}
add_action( 'save_post', '${funcPrefix}_save_meta' );

/**
 * Hide default custom fields meta box
 * We're replacing it with our custom ones
 */
function ${funcPrefix}_hide_default_custom_fields() {
    remove_meta_box( 'postcustom', 'page', 'normal' );
}
add_action( 'admin_menu', '${funcPrefix}_hide_default_custom_fields' );
`;
}

module.exports = {
  generateMetaBoxesPhp
};