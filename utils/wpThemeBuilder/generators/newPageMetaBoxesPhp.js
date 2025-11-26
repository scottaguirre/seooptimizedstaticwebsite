// utils/wpThemeBuilder/generators/newPageMetaBoxesPhp.js

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

function generateNewPageMetaBoxesPhp(options = {}) {
  const {
    themeSlug = 'local-business-theme',
  } = options;

  const funcPrefix = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Meta Boxes for New Page Layout
 * ONLY shows for pages using "New Page Layout" template
 *
 * @package ${themeSlug}
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Register meta boxes ONLY for pages using New Page Layout template
 */
function ${funcPrefix}_register_newpage_meta_boxes() {
    global $post;
    
    if ( ! $post ) {
        return;
    }
    
    $template = get_post_meta( $post->ID, '_wp_page_template', true );
    
    // Only show these meta boxes if page uses page-new-page-layout.php
    if ( $template !== 'page-new-page-layout.php' ) {
        return;
    }

    // SEO Settings
    add_meta_box(
        '${funcPrefix}_newpage_seo',
        'SEO Settings',
        '${funcPrefix}_render_newpage_seo_metabox',
        'page',
        'normal',
        'high'
    );

    // Hero Section
    add_meta_box(
        '${funcPrefix}_newpage_hero',
        'Hero Section',
        '${funcPrefix}_render_newpage_hero_metabox',
        'page',
        'normal',
        'high'
    );

    // Section 1
    add_meta_box(
        '${funcPrefix}_newpage_section1',
        'Section 1: Text Content',
        '${funcPrefix}_render_newpage_section1_metabox',
        'page',
        'normal',
        'default'
    );

    // Section 2
    add_meta_box(
        '${funcPrefix}_newpage_section2',
        'Section 2: Images + Text',
        '${funcPrefix}_render_newpage_section2_metabox',
        'page',
        'normal',
        'default'
    );

    // Section 3
    add_meta_box(
        '${funcPrefix}_newpage_section3',
        'Section 3: Text Content',
        '${funcPrefix}_render_newpage_section3_metabox',
        'page',
        'normal',
        'default'
    );

    // Section 4
    add_meta_box(
        '${funcPrefix}_newpage_section4',
        'Section 4: Images + Text',
        '${funcPrefix}_render_newpage_section4_metabox',
        'page',
        'normal',
        'default'
    );
}
add_action( 'add_meta_boxes', '${funcPrefix}_register_newpage_meta_boxes' );

/**
 * Render SEO Settings meta box
 */
function ${funcPrefix}_render_newpage_seo_metabox( $post ) {
    wp_nonce_field( '${funcPrefix}_save_newpage', '${funcPrefix}_newpage_nonce' );

    $seo_title = get_post_meta( $post->ID, '${funcPrefix}_npl_seo_title', true );
    $seo_description = get_post_meta( $post->ID, '${funcPrefix}_npl_seo_description', true );
    ?>
    
    <table class="form-table">
        <tr>
            <th><label>SEO Title</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_seo_title" 
                       value="<?php echo esc_attr( $seo_title ); ?>" 
                       class="large-text"
                       placeholder="e.g., Emergency Plumbing Services in Austin, TX | Real and Actual">
                <p class="description">This appears in search results and browser tabs. Recommended: 50-60 characters.</p>
            </td>
        </tr>
        <tr>
            <th><label>Meta Description</label></th>
            <td>
                <textarea name="${funcPrefix}_npl_seo_description" 
                          rows="3" 
                          class="large-text"
                          placeholder="e.g., Professional emergency plumbing services available 24/7 in Austin, TX. Fast response times. Call (512) 555-1234."><?php echo esc_textarea( $seo_description ); ?></textarea>
                <p class="description">This appears in search results. Recommended: 150-160 characters.</p>
            </td>
        </tr>
    </table>
    <?php
}

/**
 * Render Hero Section meta box
 */
function ${funcPrefix}_render_newpage_hero_metabox( $post ) {
    $hero_h1 = get_post_meta( $post->ID, '${funcPrefix}_npl_hero_h1', true );
    $hero_h2 = get_post_meta( $post->ID, '${funcPrefix}_npl_hero_h2', true );
    $hero_image = get_post_meta( $post->ID, '${funcPrefix}_npl_hero_image', true );
    $hero_phone = get_post_meta( $post->ID, '${funcPrefix}_npl_hero_phone', true );
    ?>
    
    <table class="form-table">
        <tr>
            <th><label>Main Heading (H1)</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_hero_h1" 
                       value="<?php echo esc_attr( $hero_h1 ); ?>" 
                       class="large-text"
                       placeholder="e.g., EMERGENCY PLUMBING">
            </td>
        </tr>
        <tr>
            <th><label>Tagline (H2)</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_hero_h2" 
                       value="<?php echo esc_attr( $hero_h2 ); ?>" 
                       class="large-text"
                       placeholder="e.g., Austin, TX">
            </td>
        </tr>
        <tr>
            <th><label>Hero Image URL</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_hero_image" 
                       value="<?php echo esc_url( $hero_image ); ?>" 
                       class="large-text"
                       placeholder="<?php echo esc_attr( get_template_directory_uri() ); ?>/assets/hero.webp">
                <p class="description">Upload image to Media Library, then paste URL here.</p>
            </td>
        </tr>
        <tr>
            <th><label>Phone Number</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_hero_phone" 
                       value="<?php echo esc_attr( $hero_phone ); ?>" 
                       class="regular-text"
                       placeholder="(512) 555-1234">
                <p class="description">This will appear in the phone button twice (after hero and after section 2).</p>
            </td>
        </tr>
    </table>
    <?php
}

/**
 * Render Section 1 meta box
 */
function ${funcPrefix}_render_newpage_section1_metabox( $post ) {
    $section1_h2 = get_post_meta( $post->ID, '${funcPrefix}_npl_section1_h2', true );
    $section1_h3 = get_post_meta( $post->ID, '${funcPrefix}_npl_section1_h3', true );
    $section1_p1 = get_post_meta( $post->ID, '${funcPrefix}_npl_section1_p1', true );
    $section1_p2 = get_post_meta( $post->ID, '${funcPrefix}_npl_section1_p2', true );
    ?>
    
    <table class="form-table">
        <tr>
            <th><label>Section Heading (H2)</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_section1_h2" 
                       value="<?php echo esc_attr( $section1_h2 ); ?>" 
                       class="large-text"
                       placeholder="e.g., EXPERT EMERGENCY PLUMBING SERVICES">
            </td>
        </tr>
        <tr>
            <th><label>Subheading (H3)</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_section1_h3" 
                       value="<?php echo esc_attr( $section1_h3 ); ?>" 
                       class="large-text"
                       placeholder="e.g., Reliable Solutions for Your Plumbing Needs">
            </td>
        </tr>
        <tr>
            <th><label>Paragraph 1</label></th>
            <td>
                <textarea name="${funcPrefix}_npl_section1_p1" 
                          rows="4" 
                          class="large-text"
                          placeholder="First paragraph of content..."><?php echo esc_textarea( $section1_p1 ); ?></textarea>
            </td>
        </tr>
        <tr>
            <th><label>Paragraph 2</label></th>
            <td>
                <textarea name="${funcPrefix}_npl_section1_p2" 
                          rows="4" 
                          class="large-text"
                          placeholder="Second paragraph of content..."><?php echo esc_textarea( $section1_p2 ); ?></textarea>
            </td>
        </tr>
    </table>
    <?php
}

/**
 * Render Section 2 meta box
 */
function ${funcPrefix}_render_newpage_section2_metabox( $post ) {
    $section2_h2 = get_post_meta( $post->ID, '${funcPrefix}_npl_section2_h2', true );
    $section2_img1 = get_post_meta( $post->ID, '${funcPrefix}_npl_section2_img1', true );
    $section2_img1_alt = get_post_meta( $post->ID, '${funcPrefix}_npl_section2_img1_alt', true );
    $section2_img2 = get_post_meta( $post->ID, '${funcPrefix}_npl_section2_img2', true );
    $section2_img2_alt = get_post_meta( $post->ID, '${funcPrefix}_npl_section2_img2_alt', true );
    $section2_p1 = get_post_meta( $post->ID, '${funcPrefix}_npl_section2_p1', true );
    $section2_p2 = get_post_meta( $post->ID, '${funcPrefix}_npl_section2_p2', true );
    ?>
    
    <table class="form-table">
        <tr>
            <th><label>Section Heading (H2)</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_section2_h2" 
                       value="<?php echo esc_attr( $section2_h2 ); ?>" 
                       class="large-text">
            </td>
        </tr>
        <tr>
            <th><label>Image 1 URL</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_section2_img1" 
                       value="<?php echo esc_url( $section2_img1 ); ?>" 
                       class="large-text">
            </td>
        </tr>
        <tr>
            <th><label>Image 1 Alt Text</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_section2_img1_alt" 
                       value="<?php echo esc_attr( $section2_img1_alt ); ?>" 
                       class="large-text"
                       placeholder="e.g., Plumber fixing water heater in Austin">
            </td>
        </tr>
        <tr>
            <th><label>Image 2 URL</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_section2_img2" 
                       value="<?php echo esc_url( $section2_img2 ); ?>" 
                       class="large-text">
            </td>
        </tr>
        <tr>
            <th><label>Image 2 Alt Text</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_section2_img2_alt" 
                       value="<?php echo esc_attr( $section2_img2_alt ); ?>" 
                       class="large-text"
                       placeholder="e.g., Emergency plumbing repair service">
            </td>
        </tr>
        <tr>
            <th><label>Paragraph 1</label></th>
            <td>
                <textarea name="${funcPrefix}_npl_section2_p1" 
                          rows="4" 
                          class="large-text"><?php echo esc_textarea( $section2_p1 ); ?></textarea>
            </td>
        </tr>
        <tr>
            <th><label>Paragraph 2</label></th>
            <td>
                <textarea name="${funcPrefix}_npl_section2_p2" 
                          rows="4" 
                          class="large-text"><?php echo esc_textarea( $section2_p2 ); ?></textarea>
            </td>
        </tr>
    </table>
    <?php
}

/**
 * Render Section 3 meta box
 */
function ${funcPrefix}_render_newpage_section3_metabox( $post ) {
    $section3_h2 = get_post_meta( $post->ID, '${funcPrefix}_npl_section3_h2', true );
    $section3_p1 = get_post_meta( $post->ID, '${funcPrefix}_npl_section3_p1', true );
    $section3_p2 = get_post_meta( $post->ID, '${funcPrefix}_npl_section3_p2', true );
    ?>
    
    <table class="form-table">
        <tr>
            <th><label>Section Heading (H2)</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_section3_h2" 
                       value="<?php echo esc_attr( $section3_h2 ); ?>" 
                       class="large-text">
            </td>
        </tr>
        <tr>
            <th><label>Paragraph 1</label></th>
            <td>
                <textarea name="${funcPrefix}_npl_section3_p1" 
                          rows="4" 
                          class="large-text"><?php echo esc_textarea( $section3_p1 ); ?></textarea>
            </td>
        </tr>
        <tr>
            <th><label>Paragraph 2</label></th>
            <td>
                <textarea name="${funcPrefix}_npl_section3_p2" 
                          rows="4" 
                          class="large-text"><?php echo esc_textarea( $section3_p2 ); ?></textarea>
            </td>
        </tr>
    </table>
    <?php
}

/**
 * Render Section 4 meta box
 */
function ${funcPrefix}_render_newpage_section4_metabox( $post ) {
    $section4_h2 = get_post_meta( $post->ID, '${funcPrefix}_npl_section4_h2', true );
    $section4_img1 = get_post_meta( $post->ID, '${funcPrefix}_npl_section4_img1', true );
    $section4_img1_alt = get_post_meta( $post->ID, '${funcPrefix}_npl_section4_img1_alt', true );
    $section4_img2 = get_post_meta( $post->ID, '${funcPrefix}_npl_section4_img2', true );
    $section4_img2_alt = get_post_meta( $post->ID, '${funcPrefix}_npl_section4_img2_alt', true );
    $section4_p1 = get_post_meta( $post->ID, '${funcPrefix}_npl_section4_p1', true );
    $section4_p2 = get_post_meta( $post->ID, '${funcPrefix}_npl_section4_p2', true );
    ?>
    
    <table class="form-table">
        <tr>
            <th><label>Section Heading (H2)</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_section4_h2" 
                       value="<?php echo esc_attr( $section4_h2 ); ?>" 
                       class="large-text">
            </td>
        </tr>
        <tr>
            <th><label>Image 1 URL</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_section4_img1" 
                       value="<?php echo esc_url( $section4_img1 ); ?>" 
                       class="large-text">
            </td>
        </tr>
        <tr>
            <th><label>Image 1 Alt Text</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_section4_img1_alt" 
                       value="<?php echo esc_attr( $section4_img1_alt ); ?>" 
                       class="large-text">
            </td>
        </tr>
        <tr>
            <th><label>Image 2 URL</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_section4_img2" 
                       value="<?php echo esc_url( $section4_img2 ); ?>" 
                       class="large-text">
            </td>
        </tr>
        <tr>
            <th><label>Image 2 Alt Text</label></th>
            <td>
                <input type="text" 
                       name="${funcPrefix}_npl_section4_img2_alt" 
                       value="<?php echo esc_attr( $section4_img2_alt ); ?>" 
                       class="large-text">
            </td>
        </tr>
        <tr>
            <th><label>Paragraph 1</label></th>
            <td>
                <textarea name="${funcPrefix}_npl_section4_p1" 
                          rows="4" 
                          class="large-text"><?php echo esc_textarea( $section4_p1 ); ?></textarea>
            </td>
        </tr>
        <tr>
            <th><label>Paragraph 2</label></th>
            <td>
                <textarea name="${funcPrefix}_npl_section4_p2" 
                          rows="4" 
                          class="large-text"><?php echo esc_textarea( $section4_p2 ); ?></textarea>
            </td>
        </tr>
    </table>
    <?php
}

/**
 * Save all meta box data
 */
function ${funcPrefix}_save_newpage_meta( $post_id ) {
    // Check nonce
    if ( ! isset( $_POST['${funcPrefix}_newpage_nonce'] ) ) {
        return;
    }

    if ( ! wp_verify_nonce( $_POST['${funcPrefix}_newpage_nonce'], '${funcPrefix}_save_newpage' ) ) {
        return;
    }

    // Check autosave
    if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
        return;
    }

    // Check permissions
    if ( ! current_user_can( 'edit_post', $post_id ) ) {
        return;
    }

    // Only save if using New Page Layout template
    $template = get_post_meta( $post_id, '_wp_page_template', true );
    if ( $template !== 'page-new-page-layout.php' ) {
        return;
    }

    // List of all fields to save
    $fields = array(
        // SEO
        '${funcPrefix}_npl_seo_title' => 'text',
        '${funcPrefix}_npl_seo_description' => 'textarea',
        // Hero
        '${funcPrefix}_npl_hero_h1' => 'text',
        '${funcPrefix}_npl_hero_h2' => 'text',
        '${funcPrefix}_npl_hero_image' => 'url',
        '${funcPrefix}_npl_hero_phone' => 'text',
        // Section 1
        '${funcPrefix}_npl_section1_h2' => 'text',
        '${funcPrefix}_npl_section1_h3' => 'text',
        '${funcPrefix}_npl_section1_p1' => 'textarea',
        '${funcPrefix}_npl_section1_p2' => 'textarea',
        // Section 2
        '${funcPrefix}_npl_section2_h2' => 'text',
        '${funcPrefix}_npl_section2_img1' => 'url',
        '${funcPrefix}_npl_section2_img1_alt' => 'text',
        '${funcPrefix}_npl_section2_img2' => 'url',
        '${funcPrefix}_npl_section2_img2_alt' => 'text',
        '${funcPrefix}_npl_section2_p1' => 'textarea',
        '${funcPrefix}_npl_section2_p2' => 'textarea',
        // Section 3
        '${funcPrefix}_npl_section3_h2' => 'text',
        '${funcPrefix}_npl_section3_p1' => 'textarea',
        '${funcPrefix}_npl_section3_p2' => 'textarea',
        // Section 4
        '${funcPrefix}_npl_section4_h2' => 'text',
        '${funcPrefix}_npl_section4_img1' => 'url',
        '${funcPrefix}_npl_section4_img1_alt' => 'text',
        '${funcPrefix}_npl_section4_img2' => 'url',
        '${funcPrefix}_npl_section4_img2_alt' => 'text',
        '${funcPrefix}_npl_section4_p1' => 'textarea',
        '${funcPrefix}_npl_section4_p2' => 'textarea',
    );

    // Save each field with appropriate sanitization
    foreach ( $fields as $field => $type ) {
        if ( isset( $_POST[ $field ] ) ) {
            $value = $_POST[ $field ];
            
            // Sanitize based on type
            if ( $type === 'url' ) {
                $value = esc_url_raw( $value );
            } elseif ( $type === 'textarea' ) {
                $value = wp_kses_post( $value );
            } else {
                $value = sanitize_text_field( $value );
            }
            
            update_post_meta( $post_id, $field, $value );
        }
    }
}
add_action( 'save_post', '${funcPrefix}_save_newpage_meta' );
`;
}

module.exports = {
  generateNewPageMetaBoxesPhp,
};