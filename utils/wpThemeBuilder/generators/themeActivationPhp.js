// utils/wpThemeBuilder/generators/themeActivationPhp.js
//
// Imports the content model into WordPress on theme activation.
//
// The old version stored each block's frozen HTML. This one writes one meta
// field per editable value, which is what lets the renderer rebuild pages
// from fields and lets the admin label them meaningfully.

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

function generateThemeActivationPhp(options = {}) {
  const {
    themeSlug = 'local-business-theme',
    themeName = 'Local Business Theme',
  } = options;

  const p = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Theme Activation
 *
 * Creates the pages and imports content from theme-content-model.php
 * into individual editable meta fields.
 *
 * @package ${themeSlug}
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Load the generated content model.
 */
function ${p}_load_model() {
    $file = get_template_directory() . '/theme-content-model.php';
    if ( ! file_exists( $file ) ) {
        return array( 'global' => array(), 'pages' => array() );
    }

    $model = include $file;
    if ( ! is_array( $model ) ) {
        return array( 'global' => array(), 'pages' => array() );
    }

    return wp_parse_args( $model, array( 'global' => array(), 'pages' => array() ) );
}

/**
 * Write one section's fields onto a post.
 */
function ${p}_import_section( $post_id, $section ) {
    $key = isset( $section['key'] ) ? $section['key'] : '';
    if ( $key === '' ) {
        return;
    }

    $base = '${p}_s_' . $key . '_';

    update_post_meta( $post_id, $base . 'heading', isset( $section['heading'] ) ? $section['heading'] : '' );
    update_post_meta( $post_id, $base . 'subheading', isset( $section['subheading'] ) ? $section['subheading'] : '' );

    // Paragraphs, stored one per field so each gets its own editor
    $paragraphs = isset( $section['paragraphs'] ) && is_array( $section['paragraphs'] )
        ? array_values( $section['paragraphs'] )
        : array();

    update_post_meta( $post_id, $base . 'p_count', count( $paragraphs ) );
    foreach ( $paragraphs as $i => $text ) {
        update_post_meta( $post_id, $base . 'p_' . $i, wp_kses_post( $text ) );
    }

    // Images, keyed by their stable role
    $images = isset( $section['images'] ) && is_array( $section['images'] ) ? $section['images'] : array();
    foreach ( $images as $img ) {
        if ( empty( $img['role'] ) ) {
            continue;
        }
        $role = $img['role'];
        update_post_meta( $post_id, $base . 'img_' . $role, isset( $img['src'] ) ? $img['src'] : '' );
        update_post_meta( $post_id, $base . 'img_' . $role . '_alt', isset( $img['alt'] ) ? $img['alt'] : '' );
        update_post_meta( $post_id, $base . 'img_' . $role . '_dim', array(
            'width'  => isset( $img['width'] ) ? $img['width'] : '',
            'height' => isset( $img['height'] ) ? $img['height'] : '',
        ) );
    }

    // Service cards — name + one line each, numbered so both are editable.
    if ( isset( $section['cards'] ) && is_array( $section['cards'] ) ) {
        $cards = array_values( $section['cards'] );
        update_post_meta( $post_id, $base . 'card_count', count( $cards ) );
        foreach ( $cards as $i => $card ) {
            update_post_meta( $post_id, $base . 'card_name_' . $i, isset( $card['name'] ) ? $card['name'] : '' );
            update_post_meta( $post_id, $base . 'card_line_' . $i, isset( $card['line'] ) ? $card['line'] : '' );
        }
    }

    // Trust points — the ticked list under the opening paragraph. Numbered so
    // the admin can expose one field per point rather than a single textarea.
    if ( isset( $section['trust_points'] ) && is_array( $section['trust_points'] ) ) {
        $points = array_values( $section['trust_points'] );
        update_post_meta( $post_id, $base . 'trust_count', count( $points ) );
        foreach ( $points as $i => $point ) {
            update_post_meta( $post_id, $base . 'trust_' . $i, $point );
        }
    }

    // Hero trust badges. Stored with the same img_<role> naming as the other
    // images so the media picker in the meta box handles them unchanged.
    if ( isset( $section['badges'] ) && is_array( $section['badges'] ) ) {
        $badges = $section['badges'];

        update_post_meta( $post_id, $base . 'img_award-badge', isset( $badges['award'] ) ? $badges['award'] : '' );
        update_post_meta( $post_id, $base . 'img_award-badge_alt', isset( $badges['award_alt'] ) ? $badges['award_alt'] : '' );
        update_post_meta( $post_id, $base . 'img_licensed-badge', isset( $badges['licensed'] ) ? $badges['licensed'] : '' );
        update_post_meta( $post_id, $base . 'img_licensed-badge_alt', isset( $badges['licensed_alt'] ) ? $badges['licensed_alt'] : '' );
    }

    // Pricing rows, numbered so each service gets its own editable fields.
    // An owner can then replace generated estimates with real figures.
    if ( isset( $section['pricing'] ) && is_array( $section['pricing'] ) ) {
        $rows = array_values( $section['pricing'] );
        update_post_meta( $post_id, $base . 'price_count', count( $rows ) );
        foreach ( $rows as $i => $row ) {
            update_post_meta( $post_id, $base . 'price_name_' . $i, isset( $row['name'] ) ? $row['name'] : '' );
            update_post_meta( $post_id, $base . 'price_low_' . $i,  isset( $row['low'] ) ? $row['low'] : '' );
            update_post_meta( $post_id, $base . 'price_high_' . $i, isset( $row['high'] ) ? $row['high'] : '' );
            update_post_meta( $post_id, $base . 'price_unit_' . $i, isset( $row['unit'] ) ? $row['unit'] : '' );
            update_post_meta( $post_id, $base . 'price_note_' . $i, isset( $row['note'] ) ? $row['note'] : '' );
        }
    }

    if ( isset( $section['notice'] ) ) {
        update_post_meta( $post_id, $base . 'notice', $section['notice'] );
    }

    // FAQ pairs, numbered so each gets its own editable field
    if ( isset( $section['faqs'] ) && is_array( $section['faqs'] ) ) {
        $faqs = array_values( $section['faqs'] );
        update_post_meta( $post_id, $base . 'faq_count', count( $faqs ) );
        foreach ( $faqs as $i => $faq ) {
            update_post_meta( $post_id, $base . 'faq_q_' . $i, isset( $faq['question'] ) ? $faq['question'] : '' );
            update_post_meta( $post_id, $base . 'faq_a_' . $i, wp_kses_post( isset( $faq['answer'] ) ? $faq['answer'] : '' ) );
        }
    }

    // Type-specific extras
    if ( isset( $section['video_url'] ) ) {
        update_post_meta( $post_id, $base . 'video_url', $section['video_url'] );
    }
    if ( isset( $section['map_embed'] ) ) {
        update_post_meta( $post_id, $base . 'map_embed', $section['map_embed'] );
    }
    if ( isset( $section['address_override'] ) ) {
        update_post_meta( $post_id, $base . 'address_override', $section['address_override'] );
    }
}

/**
 * Descriptor list the renderer walks. Content lives in its own fields;
 * this only records order, type and layout hints.
 */
function ${p}_section_descriptors( $sections ) {
    $out = array();

    foreach ( $sections as $s ) {
        if ( empty( $s['key'] ) || empty( $s['type'] ) ) {
            continue;
        }

        $d = array(
            'key'   => $s['key'],
            'label' => isset( $s['label'] ) ? $s['label'] : $s['key'],
            'type'  => $s['type'],
        );

        foreach ( array( 'css_class', 'row_class', 'image_roles', 'cta_after', 'heading_tag' ) as $extra ) {
            if ( isset( $s[ $extra ] ) ) {
                $d[ $extra ] = $s[ $extra ];
            }
        }

        $out[] = $d;
    }

    return $out;
}

/**
 * Create (or reuse) a page and import its content.
 */
function ${p}_import_page( $page ) {
    $slug = isset( $page['slug'] ) ? $page['slug'] : '';
    if ( $slug === '' ) {
        return 0;
    }

    $existing = get_page_by_path( $slug );

    $postarr = array(
        'post_title'   => isset( $page['title'] ) ? $page['title'] : $slug,
        'post_name'    => $slug,
        'post_status'  => 'publish',
        'post_type'    => 'page',
        'post_content' => '',
        'menu_order'   => isset( $page['menu_order'] ) ? (int) $page['menu_order'] : 0,
    );

    if ( $existing ) {
        $postarr['ID'] = $existing->ID;
        $post_id = wp_update_post( $postarr );
    } else {
        $post_id = wp_insert_post( $postarr );
    }

    if ( is_wp_error( $post_id ) || ! $post_id ) {
        return 0;
    }

    // Template
    if ( ! empty( $page['template'] ) && ! empty( $page['is_front_page'] ) === false ) {
        update_post_meta( $post_id, '_wp_page_template', $page['template'] );
    }

    // SEO
    update_post_meta( $post_id, '${p}_page_title', isset( $page['meta_title'] ) ? $page['meta_title'] : '' );
    update_post_meta( $post_id, '${p}_page_description', isset( $page['meta_description'] ) ? $page['meta_description'] : '' );
    update_post_meta( $post_id, '${p}_page_schema_json', isset( $page['schema'] ) ? $page['schema'] : '' );
    update_post_meta( $post_id, '${p}_page_type', isset( $page['type'] ) ? $page['type'] : '' );
    update_post_meta( $post_id, '${p}_page_city', isset( $page['city'] ) ? $page['city'] : '' );

    // Sections
    $sections = isset( $page['sections'] ) && is_array( $page['sections'] ) ? $page['sections'] : array();
    update_post_meta( $post_id, '${p}_sections', ${p}_section_descriptors( $sections ) );

    foreach ( $sections as $section ) {
        ${p}_import_section( $post_id, $section );
    }

    return $post_id;
}

/**
 * Build the Primary menu so it mirrors the static site exactly:
 *
 *   ABOUT US            -> front page
 *   SERVICES            -> a plain link when there is one service; a custom
 *                          link "#" with all services under it when there
 *                          are two or more
 *   LOCATIONS           -> custom link "#" with each location under it
 *   CONTACT             -> contact page
 *
 * Creating it here means the client opens Appearance -> Menus and finds a
 * real, populated menu they can reorder, rename or extend — rather than an
 * empty screen. The Bootstrap walker renders it, so it still matches the
 * design.
 *
 * Re-running clears existing items first, so activation stays idempotent.
 */
function ${p}_build_menu( $front_page_id, $services, $locations, $contact = null ) {
    $menu_name = __( 'Primary Menu', '${themeSlug}' );
    $menu = wp_get_nav_menu_object( $menu_name );

    if ( $menu ) {
        $menu_id = $menu->term_id;
        $existing = wp_get_nav_menu_items( $menu_id );
        if ( $existing ) {
            foreach ( $existing as $item ) {
                wp_delete_post( $item->ID, true );
            }
        }
    } else {
        $menu_id = wp_create_nav_menu( $menu_name );
        if ( is_wp_error( $menu_id ) ) {
            return;
        }
    }

    $position = 1;

    $add_page = function( $post_id, $title, $parent = 0 ) use ( $menu_id, &$position ) {
        return wp_update_nav_menu_item( $menu_id, 0, array(
            'menu-item-title'     => $title,
            'menu-item-object'    => 'page',
            'menu-item-object-id' => $post_id,
            'menu-item-type'      => 'post_type',
            'menu-item-status'    => 'publish',
            'menu-item-parent-id' => $parent,
            'menu-item-position'  => $position++,
        ) );
    };

    $add_group = function( $title ) use ( $menu_id, &$position ) {
        return wp_update_nav_menu_item( $menu_id, 0, array(
            'menu-item-title'    => $title,
            'menu-item-url'      => '#',
            'menu-item-type'     => 'custom',
            'menu-item-status'   => 'publish',
            'menu-item-position' => $position++,
        ) );
    };

    // 1. About Us
    if ( $front_page_id ) {
        $add_page( $front_page_id, __( 'About Us', '${themeSlug}' ) );
    }

    // 2. Services
    //
    // Matches the static site's rule: ONE service renders as a plain link,
    // because a dropdown holding a single item reads oddly. Two or more all
    // go inside the dropdown.
    //
    // This previously pulled the first service out and put the rest in a
    // dropdown, which is what the static nav used to do before it changed —
    // so the exported theme's menu no longer matched the downloaded site.
    if ( count( $services ) === 1 ) {
        $only = $services[0];
        $add_page( $only['id'], $only['title'] );

    } elseif ( count( $services ) > 1 ) {
        $parent = $add_group( __( 'Services', '${themeSlug}' ) );
        if ( ! is_wp_error( $parent ) ) {
            foreach ( $services as $svc ) {
                $add_page( $svc['id'], $svc['title'], $parent );
            }
        }
    }

    // 4. Locations, labelled by city
    if ( ! empty( $locations ) ) {
        $parent = $add_group( __( 'Locations', '${themeSlug}' ) );
        if ( ! is_wp_error( $parent ) ) {
            foreach ( $locations as $loc ) {
                $add_page( $loc['id'], $loc['title'], $parent );
            }
        }
    }

    // 5. Contact, last
    if ( $contact ) {
        $add_page( $contact['id'], $contact['title'] );
    }

    // 6. Assign to the theme's Primary location
    $locations_mod = get_theme_mod( 'nav_menu_locations' );
    if ( ! is_array( $locations_mod ) ) {
        $locations_mod = array();
    }
    $locations_mod['primary'] = $menu_id;
    set_theme_mod( 'nav_menu_locations', $locations_mod );
}


/**
 * Run the full import. Idempotent: safe to run again.
 */
function ${p}_activate() {
    $model = ${p}_load_model();

    // 1. Global settings
    if ( ! empty( $model['global'] ) ) {
        $existing = get_option( '${p}_global_settings', array() );
        if ( ! is_array( $existing ) ) {
            $existing = array();
        }
        // Imported values win on first activation; later edits are preserved
        // because activation only runs when the theme is switched on.
        update_option( '${p}_global_settings', array_merge( $existing, $model['global'] ) );
    }

    // 2. Pages
    $front_page_id = 0;
    $services  = array();
    $locations = array();
    $contact   = null;

    foreach ( $model['pages'] as $page ) {
        $post_id = ${p}_import_page( $page );
        if ( ! $post_id ) {
            continue;
        }

        if ( ! empty( $page['is_front_page'] ) ) {
            $front_page_id = $post_id;
            continue;
        }

        $type = isset( $page['type'] ) ? $page['type'] : '';

        if ( $type === 'service' ) {
            $services[] = array(
                'id'    => $post_id,
                'title' => isset( $page['title'] ) ? $page['title'] : '',
            );
        } elseif ( $type === 'contact' ) {
            $contact = array(
                'id'    => $post_id,
                'title' => __( 'Contact', '${themeSlug}' ),
            );
        } elseif ( $type === 'location' ) {
            // Locations show the city only, as on the static site
            $label = ! empty( $page['city'] )
                ? $page['city']
                : trim( current( explode( ',', isset( $page['title'] ) ? $page['title'] : '' ) ) );

            $locations[] = array(
                'id'    => $post_id,
                'title' => $label,
            );
        }
    }

    // 3. Front page
    if ( $front_page_id ) {
        update_option( 'show_on_front', 'page' );
        update_option( 'page_on_front', $front_page_id );
    }

    // 4. Menu, mirroring the static site's structure
    ${p}_build_menu( $front_page_id, $services, $locations, $contact );

    // 5. Pretty permalinks
    flush_rewrite_rules();
}
add_action( 'after_switch_theme', '${p}_activate' );

/**
 * Manual re-import, in case activation ran before files were in place.
 */
function ${p}_reimport_notice() {
    if ( ! current_user_can( 'manage_options' ) ) {
        return;
    }

    if ( isset( $_GET['${p}_reimport'] ) && check_admin_referer( '${p}_reimport' ) ) {
        ${p}_activate();
        echo '<div class="notice notice-success"><p>' .
             esc_html__( 'Content re-imported from the theme model.', '${themeSlug}' ) .
             '</p></div>';
    }
}
add_action( 'admin_notices', '${p}_reimport_notice' );
`;
}

module.exports = {
  generateThemeActivationPhp,
};