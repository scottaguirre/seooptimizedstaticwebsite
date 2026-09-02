// utils/wpThemeBuilder/generators/metaBoxesPhp.js
//
// The editing UI the client actually uses.
//
// Replaces the old positional fields ("Block 3 -> Heading 2 #1", plain
// textareas, sanitize_text_field stripping every link) with:
//   - real labels taken from the section model
//   - wp_editor() for paragraphs, so links / bold / highlight survive
//   - the WordPress media library for every image
//   - an append-only repeater for extra sections
//
// Custom section slots are rendered server-side (not injected by JS) so
// TinyMCE initialises properly on each one.

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

const CUSTOM_SLOTS = 10;

function generateMetaBoxesPhp(options = {}) {
  const { themeSlug = 'local-business-theme' } = options;
  const p = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Page Content Meta Boxes
 *
 * @package ${themeSlug}
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

define( '${p.toUpperCase()}_CUSTOM_SLOTS', ${CUSTOM_SLOTS} );

/**
 * Media library scripts, only on the page editor.
 */
function ${p}_admin_assets( $hook ) {
    if ( ! in_array( $hook, array( 'post.php', 'post-new.php' ), true ) ) {
        return;
    }

    $screen = get_current_screen();
    if ( ! $screen || ! in_array( $screen->post_type, array( 'page', 'post' ), true ) ) {
        return;
    }

    wp_enqueue_media();
}
add_action( 'admin_enqueue_scripts', '${p}_admin_assets' );


/**
 * Register the meta boxes.
 */
function ${p}_register_meta_boxes() {
    add_meta_box(
        '${p}_page_content',
        __( 'Page Content', '${themeSlug}' ),
        '${p}_render_content_meta_box',
        'page',
        'normal',
        'high'
    );

    // SEO applies to posts too. The Interlink Engine plugin sets these fields
    // on the posts it publishes, and this box is how anyone edits them
    // afterwards — or fills them in on a post written by hand, which would
    // otherwise ship with no title tag and no meta description.
    foreach ( array( 'page', 'post' ) as $seo_type ) {
        add_meta_box(
            '${p}_seo',
            __( 'SEO', '${themeSlug}' ),
            '${p}_render_seo_meta_box',
            $seo_type,
            'side',
            'high'
        );
    }

    add_meta_box(
        '${p}_navigation',
        __( 'Navigation', '${themeSlug}' ),
        '${p}_render_nav_meta_box',
        'page',
        'side',
        'default'
    );

    add_meta_box(
        '${p}_extra_sections',
        __( 'Additional Sections', '${themeSlug}' ),
        '${p}_render_custom_meta_box',
        'page',
        'normal',
        'default'
    );
}
add_action( 'add_meta_boxes', '${p}_register_meta_boxes' );


/**
 * Shared admin styling.
 */
function ${p}_meta_styles() {
    ?>
    <style>
      .${p}-sec { margin-bottom: 22px; padding: 18px; background: #fff;
                  border: 1px solid #dcdcde; border-left: 4px solid #2271b1; border-radius: 3px; }
      .${p}-sec > h3 { margin: 0 0 14px; font-size: 14px; text-transform: uppercase;
                       letter-spacing: .03em; color: #2271b1; }
      .${p}-f { margin-bottom: 14px; }
      .${p}-f > label { display: block; font-weight: 600; margin-bottom: 4px; color: #1d2327; }
      .${p}-f input[type=text] { width: 100%; }
      .${p}-imgs { display: flex; flex-wrap: wrap; gap: 14px; }
      .${p}-img { border: 1px solid #e0e0e0; border-radius: 3px; padding: 10px;
                  width: 240px; background: #fafafa; }
      .${p}-img img { max-width: 100%; height: auto; display: block; margin-bottom: 8px;
                      background: #fff; border: 1px solid #eee; }
      .${p}-img .${p}-role { font-size: 11px; color: #646970; text-transform: uppercase; }
      .${p}-img input[type=text] { width: 100%; margin-top: 6px; }
      .${p}-slot.is-hidden { display: none; }
      .${p}-hint { color: #646970; font-style: italic; margin: 0 0 14px; }
    </style>
    <?php
}


/**
 * Human label for an image role.
 */
function ${p}_role_label( $role ) {
    $map = array(
        'hero'          => __( 'Hero image', '${themeSlug}' ),
        'award-badge'   => __( 'Award badge', '${themeSlug}' ),
        'licensed-badge' => __( 'Licensed badge', '${themeSlug}' ),
        'hero-mobile'   => __( 'Hero image (mobile)', '${themeSlug}' ),
        'hero-tablet'   => __( 'Hero image (tablet)', '${themeSlug}' ),
        'hero-desktop'  => __( 'Hero image (desktop)', '${themeSlug}' ),
        'hero-large'    => __( 'Hero image (large screens)', '${themeSlug}' ),
        'section2-img1' => __( 'First image', '${themeSlug}' ),
        'section2-img2' => __( 'Second image', '${themeSlug}' ),
        'section4-img1' => __( 'First image', '${themeSlug}' ),
        'section4-img2' => __( 'Second image', '${themeSlug}' ),
    );

    return isset( $map[ $role ] ) ? $map[ $role ] : ucwords( str_replace( array( '-', '_' ), ' ', $role ) );
}


/**
 * A media-library image field.
 */
function ${p}_image_field( $post_id, $section_key, $role ) {
    $name_src = '${p}_s_' . $section_key . '_img_' . $role;
    $name_alt = $name_src . '_alt';

    $raw = get_post_meta( $post_id, $name_src, true );
    $alt = get_post_meta( $post_id, $name_alt, true );
    $url = ${p}_image_url( $raw );
    ?>
    <div class="${p}-img">
      <span class="${p}-role"><?php echo esc_html( ${p}_role_label( $role ) ); ?></span>
      <img src="<?php echo esc_url( $url ); ?>" alt=""
           class="${p}-preview"
           style="<?php echo $url ? '' : 'display:none;'; ?>">
      <input type="hidden" class="${p}-src"
             name="<?php echo esc_attr( $name_src ); ?>"
             value="<?php echo esc_attr( $raw ); ?>">
      <button type="button" class="button ${p}-pick"><?php esc_html_e( 'Replace image', '${themeSlug}' ); ?></button>
      <input type="text"
             name="<?php echo esc_attr( $name_alt ); ?>"
             value="<?php echo esc_attr( $alt ); ?>"
             placeholder="<?php esc_attr_e( 'Alt text (describe the image)', '${themeSlug}' ); ?>">
    </div>
    <?php
}


/**
 * Main content meta box: every section, with real labels.
 */
function ${p}_render_content_meta_box( $post ) {
    wp_nonce_field( '${p}_save_meta', '${p}_meta_nonce' );
    ${p}_meta_styles();

    $sections = ${p}_get_sections( $post->ID );

    // A page created by hand in WordPress has no section model yet. Give it
    // the standard skeleton so it gets the same fields and image pickers as
    // a generated page. Contact details, logo and map come from Theme
    // Settings, so they match the rest of the site with nothing to fill in.
    //
    // An unsaved page is an 'auto-draft', and WordPress discards those. So we
    // render from the skeleton without writing anything; the first real save
    // persists it (see ${p}_save_meta).
    if ( empty( $sections ) ) {
        $sections = ( $post->post_status === 'auto-draft' )
            ? ${p}_skeleton_descriptors()
            : ${p}_seed_sections( $post->ID );
    }

    if ( empty( $sections ) ) {
        echo '<p class="description">' .
             esc_html__( 'No content sections available for this page.', '${themeSlug}' ) .
             '</p>';
        return;
    }

    echo '<p class="' . esc_attr( '${p}-hint' ) . '">' .
         esc_html__( 'Select any text below to add a link or highlight it. Formatting is preserved.', '${themeSlug}' ) .
         '</p>';

    foreach ( $sections as $s ) {
        $key   = $s['key'];
        $label = isset( $s['label'] ) ? $s['label'] : $key;
        $type  = isset( $s['type'] ) ? $s['type'] : 'text';

        // These are rendered from global settings, not per-page fields
        if ( in_array( $type, array( 'form', 'nap-map' ), true ) ) {
            continue;
        }

        echo '<div class="' . esc_attr( '${p}-sec' ) . '">';
        echo '<h3>' . esc_html( $label ) . '</h3>';

        if ( $type === 'service-cards' ) {
            $card_count = (int) get_post_meta( $post->ID, '${p}_s_' . $key . '_card_count', true );
            for ( $i = 0; $i < $card_count; $i++ ) {
                ${p}_text_field( $post->ID, $key, 'card_name_' . $i,
                    sprintf( __( 'Card %d — service', '${themeSlug}' ), $i + 1 ) );
                ${p}_text_field( $post->ID, $key, 'card_line_' . $i,
                    sprintf( __( 'Card %d — description', '${themeSlug}' ), $i + 1 ) );
            }
            echo '</div>';
            continue;
        }

        if ( $type === 'pricing' ) {
            ${p}_text_field( $post->ID, $key, 'heading', __( 'Heading', '${themeSlug}' ) );

            echo '<p class="description">' .
                 esc_html__( 'These prices were generated as typical estimates. Replace them with your real figures.', '${themeSlug}' ) .
                 '</p>';

            $price_count = (int) get_post_meta( $post->ID, '${p}_s_' . $key . '_price_count', true );
            for ( $i = 0; $i < $price_count; $i++ ) {
                echo '<div style="border-left:3px solid #2271b1;padding-left:12px;margin-bottom:14px;">';
                ${p}_text_field( $post->ID, $key, 'price_name_' . $i,
                    sprintf( __( 'Service %d', '${themeSlug}' ), $i + 1 ) );

                echo '<div style="display:flex;gap:10px;">';
                ${p}_text_field( $post->ID, $key, 'price_low_' . $i,  __( 'Low ($)', '${themeSlug}' ) );
                ${p}_text_field( $post->ID, $key, 'price_high_' . $i, __( 'High ($)', '${themeSlug}' ) );
                ${p}_text_field( $post->ID, $key, 'price_unit_' . $i, __( 'Charged', '${themeSlug}' ) );
                echo '</div>';

                ${p}_text_field( $post->ID, $key, 'price_note_' . $i,
                    __( 'What moves the price', '${themeSlug}' ) );
                echo '</div>';
            }

            ${p}_text_field( $post->ID, $key, 'notice', __( 'Estimate notice', '${themeSlug}' ) );

            echo '</div>';
            continue;
        }

        if ( $type === 'faq' ) {
            ${p}_text_field( $post->ID, $key, 'heading', __( 'Heading', '${themeSlug}' ) );

            $faq_count = (int) get_post_meta( $post->ID, '${p}_s_' . $key . '_faq_count', true );
            for ( $i = 0; $i < $faq_count; $i++ ) {
                ${p}_text_field( $post->ID, $key, 'faq_q_' . $i,
                    sprintf( __( 'Question %d', '${themeSlug}' ), $i + 1 ) );
                ${p}_rich_field( $post->ID, $key, 'faq_a_' . $i,
                    sprintf( __( 'Answer %d', '${themeSlug}' ), $i + 1 ) );
            }

            echo '</div>';
            continue;
        }

        if ( $type === 'video' ) {
            ${p}_text_field( $post->ID, $key, 'video_url', __( 'Video URL', '${themeSlug}' ) );
            echo '</div>';
            continue;
        }

        // Heading + optional subheading
        ${p}_text_field( $post->ID, $key, 'heading',
            $type === 'hero' ? __( 'Main heading', '${themeSlug}' ) : __( 'Heading', '${themeSlug}' ) );

        $sub = get_post_meta( $post->ID, '${p}_s_' . $key . '_subheading', true );
        if ( $type === 'hero' || $sub !== '' ) {
            ${p}_text_field( $post->ID, $key, 'subheading',
                $type === 'hero' ? __( 'Tagline', '${themeSlug}' ) : __( 'Subheading', '${themeSlug}' ) );
        }

        // Trust points — the ticked list. One field each so a client can
        // reword them without touching the surrounding prose.
        $trust_count = (int) get_post_meta( $post->ID, '${p}_s_' . $key . '_trust_count', true );
        for ( $i = 0; $i < $trust_count; $i++ ) {
            ${p}_text_field( $post->ID, $key, 'trust_' . $i,
                sprintf( __( 'Trust point %d', '${themeSlug}' ), $i + 1 ) );
        }

        // Paragraphs, each in its own rich-text editor.
        // On an unsaved page there is no stored count yet, so fall back to
        // the skeleton's — otherwise no editors would render at all.
        $count = (int) get_post_meta( $post->ID, '${p}_s_' . $key . '_p_count', true );
        if ( $count < 1 && isset( $s['p_count'] ) ) {
            $count = (int) $s['p_count'];
        }
        for ( $i = 0; $i < $count; $i++ ) {
            ${p}_rich_field(
                $post->ID,
                $key,
                'p_' . $i,
                sprintf( __( 'Paragraph %d', '${themeSlug}' ), $i + 1 )
            );
        }

        // Video URL. A text-images section with a video shows the video in
        // place of its images, so this is where a client changes or removes
        // it. Only offered on sections that actually support one.
        if ( $type === 'text-images' ) {
            ${p}_text_field( $post->ID, $key, 'video_url',
                __( 'Video URL (leave blank to show the image instead)', '${themeSlug}' ) );
        }

        // Images
        $roles = isset( $s['image_roles'] ) && is_array( $s['image_roles'] ) ? $s['image_roles'] : array();
        if ( ! empty( $roles ) ) {
            echo '<div class="' . esc_attr( '${p}-imgs' ) . '">';
            foreach ( $roles as $role ) {
                ${p}_image_field( $post->ID, $key, $role );
            }
            echo '</div>';
        }

        echo '</div>';
    }

    ${p}_media_picker_js();
}


/**
 * Plain text field.
 */
function ${p}_text_field( $post_id, $section_key, $field, $label ) {
    $name  = '${p}_s_' . $section_key . '_' . $field;
    $value = get_post_meta( $post_id, $name, true );
    ?>
    <div class="${p}-f">
      <label for="<?php echo esc_attr( $name ); ?>"><?php echo esc_html( $label ); ?></label>
      <input type="text" id="<?php echo esc_attr( $name ); ?>"
             name="<?php echo esc_attr( $name ); ?>"
             value="<?php echo esc_attr( $value ); ?>">
    </div>
    <?php
}


/**
 * Rich text field. The editor ID must be lowercase alphanumeric for TinyMCE,
 * so it is derived separately from the meta key.
 */
function ${p}_rich_field( $post_id, $section_key, $field, $label ) {
    $name  = '${p}_s_' . $section_key . '_' . $field;
    $value = get_post_meta( $post_id, $name, true );
    $id    = strtolower( preg_replace( '/[^a-z0-9]/i', '', '${p}' . $section_key . $field ) );
    ?>
    <div class="${p}-f">
      <label><?php echo esc_html( $label ); ?></label>
      <?php
      wp_editor(
          $value,
          $id,
          array(
              'textarea_name' => $name,
              'textarea_rows' => 6,
              'media_buttons' => false,
              'teeny'         => true,
              'quicktags'     => true,
              'tinymce'       => array(
                  'toolbar1' => 'bold,italic,link,unlink,forecolor,backcolor,bullist,numlist,undo,redo',
                  'toolbar2' => '',
              ),
          )
      );
      ?>
    </div>
    <?php
}


/**
 * Append-only extra sections.
 *
 * Slots are rendered up front so each gets a working editor; empty ones are
 * hidden in the admin and skipped when rendering the page.
 */
function ${p}_render_custom_meta_box( $post ) {
    ${p}_meta_styles();

    $rows = ${p}_get_custom_sections( $post->ID );
    ?>
    <p class="${p}-hint">
      <?php esc_html_e( 'Extra sections are added to the bottom of the page, in order.', '${themeSlug}' ); ?>
    </p>

    <div id="${p}-slots">
    <?php
    for ( $i = 0; $i < ${p.toUpperCase()}_CUSTOM_SLOTS; $i++ ) {
        $row = isset( $rows[ $i ] ) ? $rows[ $i ] : array();
        $has = ! empty( $row['heading'] ) || ! empty( $row['body'] ) || ! empty( $row['image'] );

        $base = '${p}_custom[' . $i . ']';
        $img  = isset( $row['image'] ) ? $row['image'] : '';
        $url  = ${p}_image_url( $img );
        ?>
        <div class="${p}-sec ${p}-slot <?php echo $has ? '' : 'is-hidden'; ?>">
          <h3><?php printf( esc_html__( 'Extra section %d', '${themeSlug}' ), $i + 1 ); ?></h3>

          <div class="${p}-f">
            <label><?php esc_html_e( 'Layout', '${themeSlug}' ); ?></label>
            <select name="<?php echo esc_attr( $base . '[layout]' ); ?>">
              <?php
              $layout = isset( $row['layout'] ) ? $row['layout'] : 'text';
              $opts = array(
                  'text'       => __( 'Text only', '${themeSlug}' ),
                  'image'      => __( 'Image only', '${themeSlug}' ),
                  'text-image' => __( 'Text and image side by side', '${themeSlug}' ),
              );
              foreach ( $opts as $v => $l ) {
                  printf( '<option value="%s" %s>%s</option>',
                      esc_attr( $v ), selected( $layout, $v, false ), esc_html( $l ) );
              }
              ?>
            </select>
          </div>

          <div class="${p}-f">
            <label><?php esc_html_e( 'Heading', '${themeSlug}' ); ?></label>
            <input type="text" name="<?php echo esc_attr( $base . '[heading]' ); ?>"
                   value="<?php echo esc_attr( isset( $row['heading'] ) ? $row['heading'] : '' ); ?>">
          </div>

          <div class="${p}-f">
            <label><?php esc_html_e( 'Text', '${themeSlug}' ); ?></label>
            <?php
            wp_editor(
                isset( $row['body'] ) ? $row['body'] : '',
                '${p}custom' . $i,
                array(
                    'textarea_name' => $base . '[body]',
                    'textarea_rows' => 6,
                    'media_buttons' => false,
                    'teeny'         => true,
                    'quicktags'     => true,
                    'tinymce'       => array(
                        'toolbar1' => 'bold,italic,link,unlink,forecolor,backcolor,bullist,numlist,undo,redo',
                        'toolbar2' => '',
                    ),
                )
            );
            ?>
          </div>

          <div class="${p}-imgs">
            <div class="${p}-img">
              <span class="${p}-role"><?php esc_html_e( 'Image', '${themeSlug}' ); ?></span>
              <img src="<?php echo esc_url( $url ); ?>" alt="" class="${p}-preview"
                   style="<?php echo $url ? '' : 'display:none;'; ?>">
              <input type="hidden" class="${p}-src"
                     name="<?php echo esc_attr( $base . '[image]' ); ?>"
                     value="<?php echo esc_attr( $img ); ?>">
              <button type="button" class="button ${p}-pick"><?php esc_html_e( 'Choose image', '${themeSlug}' ); ?></button>
              <input type="text" name="<?php echo esc_attr( $base . '[image_alt]' ); ?>"
                     value="<?php echo esc_attr( isset( $row['image_alt'] ) ? $row['image_alt'] : '' ); ?>"
                     placeholder="<?php esc_attr_e( 'Alt text', '${themeSlug}' ); ?>">
            </div>
          </div>
        </div>
        <?php
    }
    ?>
    </div>

    <button type="button" class="button button-primary" id="${p}-add">
      <?php esc_html_e( '+ Add section', '${themeSlug}' ); ?>
    </button>

    <script>
    (function($){
      $('#${p}-add').on('click', function(){
        var hidden = $('#${p}-slots .${p}-slot.is-hidden').first();
        if (!hidden.length) {
          window.alert(<?php echo wp_json_encode( __( 'You have reached the maximum number of extra sections.', '${themeSlug}' ) ); ?>);
          return;
        }
        hidden.removeClass('is-hidden');
        $('html, body').animate({ scrollTop: hidden.offset().top - 60 }, 250);
      });
    })(jQuery);
    </script>
    <?php
    ${p}_media_picker_js();
}


/**
 * Media picker wiring. Guarded so it only prints once per screen.
 */
function ${p}_media_picker_js() {
    static $printed = false;
    if ( $printed ) {
        return;
    }
    $printed = true;
    ?>
    <script>
    (function($){
      $(document).on('click', '.${p}-pick', function(e){
        e.preventDefault();
        var wrap = $(this).closest('.${p}-img');

        var frame = wp.media({
          title: <?php echo wp_json_encode( __( 'Choose an image', '${themeSlug}' ) ); ?>,
          library: { type: 'image' },
          button: { text: <?php echo wp_json_encode( __( 'Use this image', '${themeSlug}' ) ); ?> },
          multiple: false
        });

        frame.on('select', function(){
          var a = frame.state().get('selection').first().toJSON();
          wrap.find('.${p}-src').val(a.id);
          wrap.find('.${p}-preview').attr('src', a.url).show();
          var altField = wrap.find('input[type=text]');
          if (altField.length && !altField.val() && a.alt) {
            altField.val(a.alt);
          }
        });

        frame.open();
      });
    })(jQuery);
    </script>
    <?php
}


/**
 * SEO meta box.
 *
 * These two values drive the <title> tag and the meta description. Generated
 * pages arrive with both filled in; pages created in WordPress start empty
 * and fall back to the page title and site tagline until set here.
 */
function ${p}_render_seo_meta_box( $post ) {
    wp_nonce_field( '${p}_save_seo', '${p}_seo_nonce' );

    $title = get_post_meta( $post->ID, '${p}_page_title', true );
    $desc  = get_post_meta( $post->ID, '${p}_page_description', true );
    ?>
    <p>
      <label for="${p}_page_title" style="display:block;font-weight:600;margin-bottom:4px;">
        <?php esc_html_e( 'SEO title', '${themeSlug}' ); ?>
      </label>
      <input type="text" id="${p}_page_title" name="${p}_page_title" style="width:100%;"
             value="<?php echo esc_attr( $title ); ?>"
             placeholder="<?php echo esc_attr( get_the_title( $post->ID ) ); ?>">
      <span class="description"><?php esc_html_e( 'Shown in browser tabs and search results. Around 60 characters.', '${themeSlug}' ); ?></span>
    </p>

    <p>
      <label for="${p}_page_description" style="display:block;font-weight:600;margin-bottom:4px;">
        <?php esc_html_e( 'Meta description', '${themeSlug}' ); ?>
      </label>
      <textarea id="${p}_page_description" name="${p}_page_description" rows="4" style="width:100%;"
                placeholder="<?php esc_attr_e( 'Short summary shown under the title in search results.', '${themeSlug}' ); ?>"><?php echo esc_textarea( $desc ); ?></textarea>
      <span class="description"><?php esc_html_e( 'Around 155 characters.', '${themeSlug}' ); ?></span>
    </p>
    <?php
}

/**
 * Save the SEO fields. Separate nonce so it works on pages with no sections.
 */
function ${p}_save_seo( $post_id ) {
    if ( ! isset( $_POST['${p}_seo_nonce'] ) ||
         ! wp_verify_nonce( $_POST['${p}_seo_nonce'], '${p}_save_seo' ) ) {
        return;
    }

    if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
        return;
    }

    if ( ! current_user_can( 'edit_post', $post_id ) ) {
        return;
    }

    if ( isset( $_POST['${p}_page_title'] ) ) {
        update_post_meta( $post_id, '${p}_page_title',
            sanitize_text_field( wp_unslash( $_POST['${p}_page_title'] ) ) );
    }

    if ( isset( $_POST['${p}_page_description'] ) ) {
        update_post_meta( $post_id, '${p}_page_description',
            sanitize_textarea_field( wp_unslash( $_POST['${p}_page_description'] ) ) );
    }
}
add_action( 'save_post', '${p}_save_seo' );


/**
 * Navigation meta box.
 *
 * The header is built from page type rather than from Appearance -> Menus,
 * so this is where a page joins (or leaves) the navigation. Pages created by
 * hand in WordPress start as "Not in navigation" until set here.
 *
 * Position within a menu comes from Page Attributes -> Order.
 */
function ${p}_render_nav_meta_box( $post ) {
    wp_nonce_field( '${p}_save_nav', '${p}_nav_nonce' );

    $type = get_post_meta( $post->ID, '${p}_page_type', true );

    // Legal pages are linked from the footer by slug, not the header
    if ( $type === 'legal' ) {
        echo '<p class="description">' .
             esc_html__( 'This is a legal page. It is linked from the footer and cannot be added to the main menu.', '${themeSlug}' ) .
             '</p>';
        return;
    }

    // The front page is always the first item
    if ( (int) get_option( 'page_on_front' ) === (int) $post->ID ) {
        echo '<p class="description">' .
             esc_html__( 'This is the front page. It always appears first in the menu.', '${themeSlug}' ) .
             '</p>';
        return;
    }

    // When a menu is assigned, the menu is what renders — say so, rather than
    // letting someone change this and see nothing happen.
    if ( has_nav_menu( 'primary' ) ) {
        printf(
            '<p class="description">%s</p><p><a href="%s" class="button">%s</a></p>',
            esc_html__( 'The header is using the menu under Appearance → Menus. Add or remove this page there.', '${themeSlug}' ),
            esc_url( admin_url( 'nav-menus.php' ) ),
            esc_html__( 'Edit menu', '${themeSlug}' )
        );
        echo '<hr><p class="description">' .
             esc_html__( 'The setting below is only used if that menu is deleted.', '${themeSlug}' ) .
             '</p>';
    }

    $options = array(
        ''         => __( 'Not in navigation', '${themeSlug}' ),
        'service'  => __( 'Services menu', '${themeSlug}' ),
        'location' => __( 'Locations menu', '${themeSlug}' ),
    );
    ?>
    <p>
      <label for="${p}_page_type" style="display:block;font-weight:600;margin-bottom:4px;">
        <?php esc_html_e( 'Show this page in:', '${themeSlug}' ); ?>
      </label>
      <select name="${p}_page_type" id="${p}_page_type" style="width:100%;">
        <?php foreach ( $options as $value => $label ) : ?>
          <option value="<?php echo esc_attr( $value ); ?>" <?php selected( $type, $value ); ?>>
            <?php echo esc_html( $label ); ?>
          </option>
        <?php endforeach; ?>
      </select>
    </p>
    <p class="description">
      <?php esc_html_e( 'Use Page Attributes → Order to control where it sits within the menu.', '${themeSlug}' ); ?>
    </p>
    <?php
}

/**
 * Save the navigation choice. Kept separate from the content nonce so it
 * still saves on pages that have no section fields.
 */
function ${p}_save_nav( $post_id ) {
    if ( ! isset( $_POST['${p}_nav_nonce'] ) ||
         ! wp_verify_nonce( $_POST['${p}_nav_nonce'], '${p}_save_nav' ) ) {
        return;
    }

    if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
        return;
    }

    if ( ! current_user_can( 'edit_post', $post_id ) ) {
        return;
    }

    if ( ! isset( $_POST['${p}_page_type'] ) ) {
        return;
    }

    $type = sanitize_key( wp_unslash( $_POST['${p}_page_type'] ) );
    if ( ! in_array( $type, array( '', 'service', 'location' ), true ) ) {
        $type = '';
    }

    update_post_meta( $post_id, '${p}_page_type', $type );
}
add_action( 'save_post', '${p}_save_nav' );


/**
 * Save.
 *
 * Headings use sanitize_text_field. Paragraphs use wp_kses_post so links,
 * bold and highlights survive — the old code stripped them.
 */
function ${p}_save_meta( $post_id ) {
    if ( ! isset( $_POST['${p}_meta_nonce'] ) ||
         ! wp_verify_nonce( $_POST['${p}_meta_nonce'], '${p}_save_meta' ) ) {
        return;
    }

    if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
        return;
    }

    if ( ! current_user_can( 'edit_post', $post_id ) ) {
        return;
    }

    // First save of a hand-made page: the descriptors do not exist yet, so
    // seed them before reading the posted values. Without this the client's
    // first edits would be silently dropped.
    $sections = ${p}_get_sections( $post_id );
    if ( empty( $sections ) ) {
        $sections = ${p}_seed_sections( $post_id );
    }

    foreach ( $sections as $s ) {
        $key  = $s['key'];
        $base = '${p}_s_' . $key . '_';

        foreach ( array( 'heading', 'subheading', 'video_url' ) as $field ) {
            if ( isset( $_POST[ $base . $field ] ) ) {
                update_post_meta( $post_id, $base . $field,
                    sanitize_text_field( wp_unslash( $_POST[ $base . $field ] ) ) );
            }
        }

        $count = (int) get_post_meta( $post_id, $base . 'p_count', true );
        if ( $count < 1 && isset( $s['p_count'] ) ) {
            $count = (int) $s['p_count'];
        }
        for ( $i = 0; $i < $count; $i++ ) {
            $name = $base . 'p_' . $i;
            if ( isset( $_POST[ $name ] ) ) {
                update_post_meta( $post_id, $name, wp_kses_post( wp_unslash( $_POST[ $name ] ) ) );
            }
        }

        // Pricing rows
        $price_count = (int) get_post_meta( $post_id, $base . 'price_count', true );
        for ( $i = 0; $i < $price_count; $i++ ) {
            foreach ( array( 'price_name_', 'price_low_', 'price_high_', 'price_unit_', 'price_note_' ) as $field ) {
                $meta_key = $base . $field . $i;
                if ( isset( $_POST[ $meta_key ] ) ) {
                    update_post_meta( $post_id, $meta_key,
                        sanitize_text_field( wp_unslash( $_POST[ $meta_key ] ) ) );
                }
            }
        }

        if ( isset( $_POST[ $base . 'notice' ] ) ) {
            update_post_meta( $post_id, $base . 'notice',
                sanitize_textarea_field( wp_unslash( $_POST[ $base . 'notice' ] ) ) );
        }

        // FAQ pairs
        $faq_count = (int) get_post_meta( $post_id, $base . 'faq_count', true );
        for ( $i = 0; $i < $faq_count; $i++ ) {
            $qk = $base . 'faq_q_' . $i;
            $ak = $base . 'faq_a_' . $i;
            if ( isset( $_POST[ $qk ] ) ) {
                update_post_meta( $post_id, $qk, sanitize_text_field( wp_unslash( $_POST[ $qk ] ) ) );
            }
            if ( isset( $_POST[ $ak ] ) ) {
                update_post_meta( $post_id, $ak, wp_kses_post( wp_unslash( $_POST[ $ak ] ) ) );
            }
        }

        // Service cards
        $card_count = (int) get_post_meta( $post_id, $base . 'card_count', true );
        for ( $i = 0; $i < $card_count; $i++ ) {
            foreach ( array( 'card_name_', 'card_line_' ) as $field ) {
                $card_key = $base . $field . $i;
                if ( isset( $_POST[ $card_key ] ) ) {
                    update_post_meta( $post_id, $card_key,
                        sanitize_text_field( wp_unslash( $_POST[ $card_key ] ) ) );
                }
            }
        }

        // Trust points
        $trust_count = (int) get_post_meta( $post_id, $base . 'trust_count', true );
        for ( $i = 0; $i < $trust_count; $i++ ) {
            $trust_key = $base . 'trust_' . $i;
            if ( isset( $_POST[ $trust_key ] ) ) {
                update_post_meta( $post_id, $trust_key,
                    sanitize_text_field( wp_unslash( $_POST[ $trust_key ] ) ) );
            }
        }

        $roles = isset( $s['image_roles'] ) && is_array( $s['image_roles'] ) ? $s['image_roles'] : array();
        foreach ( $roles as $role ) {
            $src = $base . 'img_' . $role;
            $alt = $src . '_alt';

            if ( isset( $_POST[ $src ] ) ) {
                update_post_meta( $post_id, $src, ${p}_sanitize_image( wp_unslash( $_POST[ $src ] ) ) );
            }
            if ( isset( $_POST[ $alt ] ) ) {
                update_post_meta( $post_id, $alt, sanitize_text_field( wp_unslash( $_POST[ $alt ] ) ) );
            }
        }
    }

    // Extra sections
    $rows = array();
    if ( isset( $_POST['${p}_custom'] ) && is_array( $_POST['${p}_custom'] ) ) {
        foreach ( $_POST['${p}_custom'] as $row ) {
            $heading = isset( $row['heading'] ) ? sanitize_text_field( wp_unslash( $row['heading'] ) ) : '';
            $body    = isset( $row['body'] ) ? wp_kses_post( wp_unslash( $row['body'] ) ) : '';
            $image   = isset( $row['image'] ) ? ${p}_sanitize_image( wp_unslash( $row['image'] ) ) : '';
            $alt     = isset( $row['image_alt'] ) ? sanitize_text_field( wp_unslash( $row['image_alt'] ) ) : '';
            $layout  = isset( $row['layout'] ) ? sanitize_key( $row['layout'] ) : 'text';

            if ( ! in_array( $layout, array( 'text', 'image', 'text-image' ), true ) ) {
                $layout = 'text';
            }

            // Drop empty slots so they never render
            if ( $heading === '' && trim( wp_strip_all_tags( $body ) ) === '' && $image === '' ) {
                continue;
            }

            $rows[] = compact( 'heading', 'body', 'image', 'alt', 'layout' ) + array( 'image_alt' => $alt );
        }
    }

    update_post_meta( $post_id, '${p}_custom_sections', $rows );
}
add_action( 'save_post', '${p}_save_meta' );


/**
 * An image value is either an attachment ID or a theme-relative path.
 */
function ${p}_sanitize_image( $value ) {
    $value = trim( (string) $value );

    if ( $value === '' ) {
        return '';
    }

    if ( is_numeric( $value ) ) {
        return (string) absint( $value );
    }

    if ( preg_match( '#^https?://#i', $value ) ) {
        return esc_url_raw( $value );
    }

    // Theme-relative path such as assets/foo.webp
    return ltrim( preg_replace( '#[^A-Za-z0-9._/-]#', '', $value ), '/' );
}


/**
 * Hide the raw custom fields box; everything is exposed properly above.
 */
function ${p}_hide_default_custom_fields() {
    remove_meta_box( 'postcustom', 'page', 'normal' );
}
add_action( 'admin_menu', '${p}_hide_default_custom_fields' );
`;
}

module.exports = {
  generateMetaBoxesPhp,
  CUSTOM_SLOTS,
};