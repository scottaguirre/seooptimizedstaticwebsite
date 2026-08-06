// utils/wpThemeBuilder/generators/sectionRendererPhp.js
//
// THE core of the WordPress rework.
//
// The old theme stored each block's frozen HTML in `block_N_html` and echoed
// it. The meta boxes edited different keys, and nothing rebuilt the HTML from
// them — so editing in wp-admin had no visible effect at all.
//
// This renderer builds every section from individual meta fields on each
// page load, so an edit in wp-admin shows up immediately. The markup and CSS
// class names mirror src/template.html exactly, because the theme reuses the
// stylesheet the user picked in the wizard.

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

function generateSectionRendererPhp(options = {}) {
  const { themeSlug = 'local-business-theme' } = options;
  const p = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Section Renderer
 *
 * Renders page sections from editable post meta.
 * Markup mirrors the generated static site so the same CSS applies.
 *
 * @package ${themeSlug}
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/* -------------------------------------------------------------------------
 * Field helpers
 * ---------------------------------------------------------------------- */

/**
 * Meta key for a section field.
 * e.g. ${p}_s_section1_heading
 */
function ${p}_key( $section_key, $field ) {
    return '${p}_s_' . $section_key . '_' . $field;
}

/**
 * Plain-text field (headings). Escaped on output.
 */
function ${p}_field( $post_id, $section_key, $field ) {
    $v = get_post_meta( $post_id, ${p}_key( $section_key, $field ), true );
    return is_string( $v ) ? $v : '';
}

/**
 * Rich-text field (paragraphs). Saved through wp_kses_post(), so links,
 * bold, and highlights survive. Output unescaped by design.
 */
function ${p}_rich( $post_id, $section_key, $field ) {
    $v = get_post_meta( $post_id, ${p}_key( $section_key, $field ), true );
    return is_string( $v ) ? $v : '';
}

/**
 * Resolve an image field to a URL.
 *
 * Values are either:
 *   - a numeric WordPress attachment ID (client picked from the media library)
 *   - a theme-relative path such as "assets/foo.webp" (as generated)
 */
function ${p}_image_url( $value ) {
    if ( empty( $value ) ) {
        return '';
    }

    if ( is_numeric( $value ) ) {
        $url = wp_get_attachment_image_url( (int) $value, 'full' );
        return $url ? $url : '';
    }

    $value = ltrim( (string) $value, '/' );

    if ( preg_match( '#^https?://#i', $value ) ) {
        return $value;
    }

    return trailingslashit( get_template_directory_uri() ) . $value;
}

/**
 * One image, by role, within a section.
 */
function ${p}_image( $post_id, $section_key, $role ) {
    $raw = get_post_meta( $post_id, ${p}_key( $section_key, 'img_' . $role ), true );
    $alt = get_post_meta( $post_id, ${p}_key( $section_key, 'img_' . $role . '_alt' ), true );
    $dim = get_post_meta( $post_id, ${p}_key( $section_key, 'img_' . $role . '_dim' ), true );

    if ( ! is_array( $dim ) ) {
        $dim = array( 'width' => '', 'height' => '' );
    }

    return array(
        'url'    => ${p}_image_url( $raw ),
        'alt'    => is_string( $alt ) ? $alt : '',
        'width'  => isset( $dim['width'] ) ? $dim['width'] : '',
        'height' => isset( $dim['height'] ) ? $dim['height'] : '',
    );
}

/**
 * Echo an <img> tag, or nothing when the image is unset.
 */
function ${p}_img_tag( $img, $class = '', $lazy = true ) {
    if ( empty( $img['url'] ) ) {
        return;
    }

    printf(
        '<img class="%s" %s src="%s" alt="%s" title="%s"%s%s>',
        esc_attr( $class ),
        $lazy ? 'loading="lazy"' : '',
        esc_url( $img['url'] ),
        esc_attr( $img['alt'] ),
        esc_attr( $img['alt'] ),
        $img['width']  ? ' width="'  . esc_attr( $img['width'] )  . '"' : '',
        $img['height'] ? ' height="' . esc_attr( $img['height'] ) . '"' : ''
    );
}

/**
 * All paragraphs for a section, in order.
 */
function ${p}_paragraphs( $post_id, $section_key ) {
    $count = (int) get_post_meta( $post_id, ${p}_key( $section_key, 'p_count' ), true );
    $out   = array();

    for ( $i = 0; $i < $count; $i++ ) {
        $text = ${p}_rich( $post_id, $section_key, 'p_' . $i );
        if ( trim( wp_strip_all_tags( $text ) ) !== '' ) {
            $out[] = $text;
        }
    }

    return $out;
}

function ${p}_echo_paragraphs( $post_id, $section_key ) {
    foreach ( ${p}_paragraphs( $post_id, $section_key ) as $text ) {
        echo '<p>' . wp_kses_post( $text ) . '</p>';
    }
}


/* -------------------------------------------------------------------------
 * Section renderers — markup mirrors src/template.html
 * ---------------------------------------------------------------------- */

/**
 * Responsive hero image.
 *
 * The four hero files are different CROPS, not one image at four sizes
 * (600x350 is 1.71:1, 1400x700 is 2.00:1), so this uses <picture> with
 * media queries rather than srcset — srcset would let the browser swap
 * between differently-framed images.
 *
 * The old markup printed all four <img> tags and hid three with CSS, but
 * browsers download images hidden by display:none. A phone was fetching
 * every size and showing one. Now exactly one file is requested.
 *
 * Breakpoints match the generated stylesheets: 601 / 720 / 1250.
 */
function ${p}_hero_picture( $post_id, $key, $class = 'hero-img img-fluid' ) {
    // A single uploaded hero takes precedence. Clients pick one image; the
    // sizes registered in functions.php give us the smaller files, so a phone
    // still downloads a small one. Generated pages leave this empty and use
    // their four purpose-cropped files below.
    $single = get_post_meta( $post_id, ${p}_key( $key, 'img_hero' ), true );

    if ( ! empty( $single ) && is_numeric( $single ) ) {
        ${p}_hero_from_attachment( (int) $single, $post_id, $key, $class );
        return;
    }

    $mobile  = ${p}_image( $post_id, $key, 'hero-mobile' );
    $tablet  = ${p}_image( $post_id, $key, 'hero-tablet' );
    $desktop = ${p}_image( $post_id, $key, 'hero-desktop' );
    $large   = ${p}_image( $post_id, $key, 'hero-large' );

    // Fall back to whichever size exists, so a partly filled hero still works
    $base = $mobile;
    foreach ( array( $mobile, $tablet, $desktop, $large ) as $candidate ) {
        if ( ! empty( $candidate['url'] ) ) {
            $base = $candidate;
            break;
        }
    }

    if ( empty( $base['url'] ) ) {
        return;
    }

    $sources = array(
        array( '(min-width:1250px)', $large ),
        array( '(min-width:720px)',  $desktop ),
        array( '(min-width:601px)',  $tablet ),
    );

    echo '<picture>';

    foreach ( $sources as $source ) {
        list( $media, $img ) = $source;
        if ( empty( $img['url'] ) ) {
            continue;
        }
        printf(
            '<source media="%s" srcset="%s"%s%s>',
            esc_attr( $media ),
            esc_url( $img['url'] ),
            $img['width']  ? ' width="'  . esc_attr( $img['width'] )  . '"' : '',
            $img['height'] ? ' height="' . esc_attr( $img['height'] ) . '"' : ''
        );
    }

    printf(
        '<img class="%s" src="%s" alt="%s" title="%s"%s%s fetchpriority="high">',
        esc_attr( $class ),
        esc_url( $base['url'] ),
        esc_attr( $base['alt'] ),
        esc_attr( $base['alt'] ),
        $base['width']  ? ' width="'  . esc_attr( $base['width'] )  . '"' : '',
        $base['height'] ? ' height="' . esc_attr( $base['height'] ) . '"' : ''
    );

    echo '</picture>';
}

/**
 * Hero built from one media-library upload.
 *
 * WordPress generated the four sizes when the image was uploaded, so each
 * breakpoint gets its own file from a single client action.
 */
function ${p}_hero_from_attachment( $attachment_id, $post_id, $key, $class ) {
    $alt = get_post_meta( $post_id, ${p}_key( $key, 'img_hero_alt' ), true );
    if ( $alt === '' ) {
        $alt = get_post_meta( $attachment_id, '_wp_attachment_image_alt', true );
    }

    $sizes = array(
        array( '(min-width:1250px)', '${p}-hero-large' ),
        array( '(min-width:720px)',  '${p}-hero-desktop' ),
        array( '(min-width:601px)',  '${p}-hero-tablet' ),
    );

    $fallback = wp_get_attachment_image_src( $attachment_id, '${p}-hero-mobile' );
    if ( ! $fallback ) {
        $fallback = wp_get_attachment_image_src( $attachment_id, 'full' );
    }
    if ( ! $fallback ) {
        return;
    }

    echo '<picture>';

    foreach ( $sizes as $entry ) {
        list( $media, $size ) = $entry;
        $src = wp_get_attachment_image_src( $attachment_id, $size );
        if ( ! $src ) {
            continue;
        }
        printf(
            '<source media="%s" srcset="%s" width="%s" height="%s">',
            esc_attr( $media ),
            esc_url( $src[0] ),
            esc_attr( $src[1] ),
            esc_attr( $src[2] )
        );
    }

    printf(
        '<img class="%s" src="%s" alt="%s" title="%s" width="%s" height="%s" fetchpriority="high">',
        esc_attr( $class ),
        esc_url( $fallback[0] ),
        esc_attr( $alt ),
        esc_attr( $alt ),
        esc_attr( $fallback[1] ),
        esc_attr( $fallback[2] )
    );

    echo '</picture>';
}

/**
 * Hero trust badges. About Us only.
 *
 * Renders nothing when neither image is set, so the markup stays clean on
 * pages and sites without them.
 */
function ${p}_hero_badges( $post_id, $key ) {
    $award    = ${p}_image( $post_id, $key, 'award-badge' );
    $licensed = ${p}_image( $post_id, $key, 'licensed-badge' );

    if ( empty( $award['url'] ) && empty( $licensed['url'] ) ) {
        return;
    }

    echo '<div class="badges">';

    if ( ! empty( $award['url'] ) ) {
        printf(
            '<img class="award" src="%s" alt="%s" loading="lazy">',
            esc_url( $award['url'] ),
            esc_attr( $award['alt'] )
        );
    }

    if ( ! empty( $licensed['url'] ) ) {
        printf(
            '<img class="licensed" src="%s" alt="%s" loading="lazy">',
            esc_url( $licensed['url'] ),
            esc_attr( $licensed['alt'] )
        );
    }

    echo '</div>';
}

function ${p}_render_hero( $post_id, $s ) {
    $key     = $s['key'];
    $h1      = ${p}_field( $post_id, $key, 'heading' );
    $tagline = ${p}_field( $post_id, $key, 'subheading' );
    ?>
    <div class="container-fluid hero-container">
      <div class="row align-items-center justify-content-center">
        <div class="col-lg-6 order-lg-2 hero-img-wrap">
          <?php ${p}_hero_picture( $post_id, $key ); ?>
          <?php ${p}_hero_badges( $post_id, $key ); ?>
        </div>
        <div class="col-lg-6 order-lg-1 text-hero">
          <h1 class="display-4 text-primary"><?php echo esc_html( $h1 ); ?></h1>
          <div class="line-divider"></div>
          <h2 class="lead"><?php echo esc_html( $tagline ); ?></h2>
        </div>
      </div>
    </div>

    <div class="container-fluid hero-container-for-style-and-style3-992px hero-container-for-style4">
      <div class="style-4-image-wrap">
        <?php ${p}_hero_picture( $post_id, $key ); ?>
        <?php ${p}_hero_badges( $post_id, $key ); ?>
      </div>
      <div class="text-hero-for-style-and-style3 text-hero-for-style4">
        <h1 class="display-4 text-primary"><?php echo esc_html( $h1 ); ?></h1>
        <div class="line-divider"></div>
        <h2 class="lead"><?php echo esc_html( $tagline ); ?></h2>
      </div>
    </div>
    <?php
}

/**
 * Click-to-call button. Reads the phone from global settings, so changing it
 * once in Theme Settings updates every button on every page.
 */
function ${p}_render_cta_button( $position_class ) {
    $phone = ${p}_get_setting( 'phone' );
    if ( empty( $phone ) ) {
        return;
    }
    $href = 'tel:' . preg_replace( '/[^0-9+]/', '', $phone );
    ?>
    <div class="text-center btn-container <?php echo esc_attr( $position_class ); ?>">
      <div class="cta-btn">
        <a href="<?php echo esc_attr( $href ); ?>"><p><?php echo esc_html( $phone ); ?></p></a>
      </div>
    </div>
    <?php
}

function ${p}_render_text( $post_id, $s, $index ) {
    $key        = $s['key'];
    $heading    = ${p}_field( $post_id, $key, 'heading' );
    $subheading = ${p}_field( $post_id, $key, 'subheading' );
    $class      = ! empty( $s['css_class'] ) ? $s['css_class'] : 'section-' . $index;

    // Legal pages lead with an <h1>; generated sections use <h2>
    $tag = ! empty( $s['heading_tag'] ) ? strtolower( $s['heading_tag'] ) : 'h2';
    if ( ! in_array( $tag, array( 'h1', 'h2', 'h3' ), true ) ) {
        $tag = 'h2';
    }
    ?>
    <section class="<?php echo esc_attr( $class ); ?>">
      <div class="container section-padding">
        <div class="row">
          <div class="col-lg-10">
            <?php if ( $heading ) : ?>
              <<?php echo $tag; ?>><?php echo esc_html( $heading ); ?></<?php echo $tag; ?>>
            <?php endif; ?>
            <?php if ( $subheading ) : ?><h3><?php echo esc_html( $subheading ); ?></h3><?php endif; ?>
            <?php ${p}_echo_paragraphs( $post_id, $key ); ?>
          </div>
        </div>
      </div>
    </section>
    <?php
}

function ${p}_render_text_images( $post_id, $s, $index ) {
    $key     = $s['key'];
    $heading = ${p}_field( $post_id, $key, 'heading' );
    $roles   = isset( $s['image_roles'] ) && is_array( $s['image_roles'] ) ? $s['image_roles'] : array();

    // A video URL on this section replaces its image entirely — never both.
    // Matches buildAboutMediaHtml() on the static side.
    $video_url = ${p}_field( $post_id, $key, 'video_url' );
    if ( $video_url !== '' ) {
        $roles = array();
    }
    $class   = ! empty( $s['css_class'] ) ? $s['css_class'] : 'section-' . $index;
    $rowclass = ! empty( $s['row_class'] ) ? $s['row_class'] : 'row-first-section-2-img';
    ?>
    <section class="bg-secondary-subtle text-two-images-section <?php echo esc_attr( $class ); ?>">
      <div class="container section-padding">
        <?php if ( $video_url !== '' ) : ?>
        <div class="row">
          <div class="col-12">
            <?php ${p}_render_video_embed( $video_url ); ?>
          </div>
        </div>
        <?php endif; ?>

        <?php if ( ! empty( $roles ) ) : ?>
        <div class="row <?php echo esc_attr( $rowclass ); ?>">
          <?php
          $slot = 1;
          foreach ( $roles as $role ) {
              $img = ${p}_image( $post_id, $key, $role );
              if ( empty( $img['url'] ) ) {
                  continue;
              }
              echo '<div class="col-md-6 text-center img-' . esc_attr( $slot ) . '-div">';
              ${p}_img_tag( $img, 'img-fluid' );
              echo '</div>';
              $slot++;
          }
          ?>
        </div>
        <?php endif; ?>
        <div class="row">
          <div class="col-lg-10">
            <?php if ( $heading ) : ?><h2><?php echo esc_html( $heading ); ?></h2><?php endif; ?>
            <?php ${p}_echo_paragraphs( $post_id, $key ); ?>
          </div>
        </div>
      </div>
    </section>
    <?php
}

/**
 * The YouTube embed markup, shared by the standalone video section and by
 * any text-images section that has a video URL.
 */
function ${p}_render_video_embed( $url ) {
    if ( empty( $url ) ) {
        return;
    }

    $embed = $url;
    if ( preg_match( '#(?:youtu\\.be/|v=|embed/|shorts/)([A-Za-z0-9_-]{6,})#', $url, $m ) ) {
        $embed = 'https://www.youtube.com/embed/' . $m[1];
    }
    ?>
    <div class="ratio ratio-16x9 about-video-wrapper">
      <iframe src="<?php echo esc_url( $embed ); ?>"
              title="<?php echo esc_attr( sprintf( __( 'Intro video for %s', '${themeSlug}' ), ${p}_get_setting( 'business_name' ) ) ); ?>"
              loading="lazy"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              referrerpolicy="strict-origin-when-cross-origin"
              allowfullscreen></iframe>
    </div>
    <?php
}

function ${p}_render_video( $post_id, $s ) {
    $url = ${p}_field( $post_id, $s['key'], 'video_url' );
    if ( empty( $url ) ) {
        return;
    }

    $embed = $url;
    if ( preg_match( '#(?:youtu\\.be/|v=|embed/|shorts/)([A-Za-z0-9_-]{6,})#', $url, $m ) ) {
        $embed = 'https://www.youtube.com/embed/' . $m[1];
    }
    ?>
    <section class="section-video">
      <div class="container about-video-section py-5">
        <div class="ratio ratio-16x9 about-video-wrapper">
          <iframe src="<?php echo esc_url( $embed ); ?>"
                  title="<?php echo esc_attr( sprintf( __( 'Intro video for %s', '${themeSlug}' ), ${p}_get_setting( 'business_name' ) ) ); ?>"
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  referrerpolicy="strict-origin-when-cross-origin"
                  allowfullscreen></iframe>
        </div>
      </div>
    </section>
    <?php
}

/**
 * Contact form. Submits over Ajax to inc/contact-form-handler.php.
 */
function ${p}_render_form( $post_id, $s ) {
    ?>
    <section class="form-container">
      <div class="bg-secondary-subtle">
        <form class="contact-form" id="contactForm" method="POST"
              action="<?php echo esc_url( admin_url( 'admin-ajax.php' ) ); ?>">
          <?php wp_nonce_field( 'contact_form', 'contact_nonce' ); ?>
          <input type="hidden" name="action" value="submit_contact_form">
          <input type="text" name="website" style="display:none;" tabindex="-1" autocomplete="off">

          <h2><?php esc_html_e( 'Get In Touch', '${themeSlug}' ); ?></h2>

          <div class="form-group">
            <label for="name"><?php esc_html_e( 'Full Name', '${themeSlug}' ); ?></label>
            <input type="text" id="name" name="name" required>
          </div>
          <div class="form-group">
            <label for="email"><?php esc_html_e( 'Email Address', '${themeSlug}' ); ?></label>
            <input type="email" id="email" name="email" required>
          </div>
          <div class="form-group">
            <label for="message"><?php esc_html_e( 'Message', '${themeSlug}' ); ?></label>
            <textarea id="message" name="message" rows="5" required></textarea>
          </div>

          <button type="submit" class="submit-btn">
            <span class="btn-text"><?php esc_html_e( 'Send Message', '${themeSlug}' ); ?></span>
          </button>
        </form>
      </div>
    </section>
    <?php
}

/**
 * Pricing rows, read back from the numbered meta fields.
 */
function ${p}_pricing_rows( $post_id, $key ) {
    $count = (int) get_post_meta( $post_id, ${p}_key( $key, 'price_count' ), true );
    $rows = array();

    for ( $i = 0; $i < $count; $i++ ) {
        $name = ${p}_field( $post_id, $key, 'price_name_' . $i );
        $low  = ${p}_field( $post_id, $key, 'price_low_' . $i );
        $high = ${p}_field( $post_id, $key, 'price_high_' . $i );

        // Skip anything unusable rather than rendering an empty or
        // inverted range on a live page.
        if ( $name === '' || $low === '' || $high === '' ) {
            continue;
        }
        if ( ! is_numeric( $low ) || ! is_numeric( $high ) || (float) $high <= (float) $low ) {
            continue;
        }

        $rows[] = array(
            'name' => $name,
            'low'  => (float) $low,
            'high' => (float) $high,
            'unit' => ${p}_field( $post_id, $key, 'price_unit_' . $i ),
            'note' => ${p}_field( $post_id, $key, 'price_note_' . $i ),
        );
    }

    return $rows;
}

function ${p}_money( $value ) {
    return '$' . number_format( (float) $value, 0 );
}

/**
 * Typical pricing table.
 *
 * The figures are estimates generated for the business rather than supplied
 * by it, so the notice below the table is not optional decoration — it is
 * what keeps the section honest. It is editable, but always rendered.
 */
function ${p}_render_pricing( $post_id, $s ) {
    $key  = $s['key'];
    $rows = ${p}_pricing_rows( $post_id, $key );
    if ( empty( $rows ) ) {
        return;
    }

    $heading = ${p}_field( $post_id, $key, 'heading' );
    if ( $heading === '' ) {
        $heading = __( 'Typical Service Pricing', '${themeSlug}' );
    }

    $notice = ${p}_field( $post_id, $key, 'notice' );
    if ( $notice === '' ) {
        $notice = __( 'The figures above are typical ranges for this area and are provided for planning purposes only. Final cost varies with the size of the job, the materials selected, access and site conditions, and current supply prices. Contact us for a free, no-obligation quote for your property.', '${themeSlug}' );
    }
    ?>
    <section class="pricing-section">
      <div class="container section-padding">
        <div class="row">
          <!-- Narrower and centred; matches the static build -->
          <div class="col-lg-8 mx-auto">
            <h2><?php echo esc_html( $heading ); ?></h2>

            <div class="table-responsive">
              <table class="pricing-table">
                <caption class="visually-hidden">
                  <?php esc_html_e( 'Typical price ranges for commonly requested services', '${themeSlug}' ); ?>
                </caption>
                <thead>
                  <tr>
                    <th scope="col"><?php esc_html_e( 'Service', '${themeSlug}' ); ?></th>
                    <th scope="col"><?php esc_html_e( 'Typical Range', '${themeSlug}' ); ?></th>
                  </tr>
                </thead>
                <tbody>
                  <?php foreach ( $rows as $row ) : ?>
                    <tr>
                      <th scope="row" class="pricing-service">
                        <?php echo esc_html( $row['name'] ); ?>
                        <?php if ( $row['note'] !== '' ) : ?>
                          <span class="pricing-note"><?php echo esc_html( $row['note'] ); ?></span>
                        <?php endif; ?>
                      </th>
                      <td class="pricing-range">
                        <span class="pricing-amount">
                          <?php echo esc_html( ${p}_money( $row['low'] ) ); ?>
                          &ndash;
                          <?php echo esc_html( ${p}_money( $row['high'] ) ); ?>
                        </span>
                        <?php if ( $row['unit'] !== '' ) : ?>
                          <span class="pricing-unit"><?php echo esc_html( $row['unit'] ); ?></span>
                        <?php endif; ?>
                      </td>
                    </tr>
                  <?php endforeach; ?>
                </tbody>
              </table>
            </div>

            <p class="pricing-disclaimer">
              <strong><?php esc_html_e( 'Estimates only.', '${themeSlug}' ); ?></strong>
              <?php echo esc_html( $notice ); ?>
            </p>
          </div>
        </div>
      </div>
    </section>
    <?php
}

/**
 * FAQ, from Google's People Also Ask questions.
 *
 * Stored as numbered question/answer pairs so the admin can show one labelled
 * field per entry, and so the FAQPage schema can be rebuilt from whatever the
 * client has edited rather than from the original generated text.
 */
function ${p}_faq_items( $post_id, $key ) {
    $count = (int) get_post_meta( $post_id, ${p}_key( $key, 'faq_count' ), true );
    $items = array();

    for ( $i = 0; $i < $count; $i++ ) {
        $question = ${p}_field( $post_id, $key, 'faq_q_' . $i );
        $answer   = ${p}_rich( $post_id, $key, 'faq_a_' . $i );

        if ( $question === '' || trim( wp_strip_all_tags( $answer ) ) === '' ) {
            continue;
        }
        $items[] = array( 'question' => $question, 'answer' => $answer );
    }

    return $items;
}

function ${p}_render_faq( $post_id, $s ) {
    $key   = $s['key'];
    $items = ${p}_faq_items( $post_id, $key );
    if ( empty( $items ) ) {
        return;
    }

    $heading = ${p}_field( $post_id, $key, 'heading' );
    if ( $heading === '' ) {
        $heading = __( 'Frequently Asked Questions', '${themeSlug}' );
    }

    // Two columns: first half left, second half right. Six questions gives
    // 3/3; an odd count puts the extra one on the left. They stack below the
    // lg breakpoint so mobile reads as a single list.
    $half = (int) ceil( count( $items ) / 2 );
    $columns = array_filter( array(
        array_slice( $items, 0, $half ),
        array_slice( $items, $half ),
    ) );

    $index = 0;
    ?>
    <section class="faq-section">
      <div class="container section-padding">
        <div class="row">
          <div class="col-12">
            <h2><?php echo esc_html( $heading ); ?></h2>
          </div>
        </div>
        <div class="row g-3">
          <?php foreach ( $columns as $column ) : ?>
            <div class="col-lg-6">
              <div class="accordion faq-accordion">
                <?php foreach ( $column as $item ) : $id = $index++; ?>
                  <div class="accordion-item">
                    <h3 class="accordion-header" id="faqHeading<?php echo (int) $id; ?>">
                      <button class="accordion-button collapsed" type="button"
                              data-bs-toggle="collapse" data-bs-target="#faqCollapse<?php echo (int) $id; ?>"
                              aria-expanded="false" aria-controls="faqCollapse<?php echo (int) $id; ?>">
                        <?php echo esc_html( $item['question'] ); ?>
                      </button>
                    </h3>
                    <div id="faqCollapse<?php echo (int) $id; ?>" class="accordion-collapse collapse"
                         aria-labelledby="faqHeading<?php echo (int) $id; ?>">
                      <div class="accordion-body">
                        <p><?php echo wp_kses_post( $item['answer'] ); ?></p>
                      </div>
                    </div>
                  </div>
                <?php endforeach; ?>
              </div>
            </div>
          <?php endforeach; ?>
        </div>
      </div>
    </section>
    <?php
}

/**
 * Name / address / phone + map. Everything here comes from global settings,
 * so one edit updates every page.
 */
function ${p}_render_nap_map( $post_id, $s ) {
    $name    = ${p}_get_setting( 'business_name' );
    $address = ${p}_get_setting( 'address' );
    $phone   = ${p}_get_setting( 'phone' );
    $email   = ${p}_get_setting( 'email' );
    $hours   = ${p}_get_setting( 'hours_text' );
    $map     = ${p}_field( $post_id, $s['key'], 'map_embed' );

    // Location pages show their own city instead of the head office address
    $override = ${p}_field( $post_id, $s['key'], 'address_override' );
    if ( $override ) {
        $address = $override;
    }
    ?>
    <section class="nap-map-section">
      <div class="container section-padding">
        <div class="row">
          <div class="col-lg-6 div-text-padding-bottom">
            <div class="nap">
              <?php if ( $name ) : ?><p><?php echo esc_html( $name ); ?></p><?php endif; ?>
              <?php if ( $address ) : ?><p><?php echo esc_html( $address ); ?></p><?php endif; ?>
              <?php if ( $phone ) : ?><p><?php echo esc_html( $phone ); ?></p><?php endif; ?>
              <hr>
            </div>

            <?php if ( $email ) : ?>
            <div class="nap">
              <p><?php echo esc_html( $email ); ?></p>
              <hr>
            </div>
            <?php endif; ?>

            <?php if ( $hours ) : ?>
            <div class="nap">
              <p><?php esc_html_e( 'Hours of Operation', '${themeSlug}' ); ?></p>
              <p><?php echo wp_kses_post( $hours ); ?></p>
            </div>
            <?php endif; ?>
          </div>

          <?php if ( $map ) : ?>
          <div class="col-lg-5 google-map">
            <iframe title="<?php echo esc_attr( sprintf( __( 'Map of %s', '${themeSlug}' ), $name ) ); ?>"
                    src="<?php echo esc_url( $map ); ?>"
                    width="600" height="400" style="border:0;"
                    allowfullscreen loading="lazy"
                    referrerpolicy="no-referrer-when-downgrade"></iframe>
          </div>
          <?php endif; ?>
        </div>
      </div>
    </section>
    <?php
}


/* -------------------------------------------------------------------------
 * Client-added sections (appended to the end of a page)
 * ---------------------------------------------------------------------- */

/**
 * Stored as one array of:
 *   array( 'heading' => '', 'body' => '', 'image' => '', 'image_alt' => '', 'layout' => 'text|image|text-image' )
 */
function ${p}_get_custom_sections( $post_id ) {
    $rows = get_post_meta( $post_id, '${p}_custom_sections', true );
    return is_array( $rows ) ? $rows : array();
}

function ${p}_render_custom_sections( $post_id ) {
    $rows = ${p}_get_custom_sections( $post_id );
    if ( empty( $rows ) ) {
        return;
    }

    $i = 0;
    foreach ( $rows as $row ) {
        $heading = isset( $row['heading'] ) ? $row['heading'] : '';
        $body    = isset( $row['body'] ) ? $row['body'] : '';
        $layout  = isset( $row['layout'] ) ? $row['layout'] : 'text';
        $img     = array(
            'url'    => ${p}_image_url( isset( $row['image'] ) ? $row['image'] : '' ),
            'alt'    => isset( $row['image_alt'] ) ? $row['image_alt'] : '',
            'width'  => '',
            'height' => '',
        );

        $has_text  = ( $heading !== '' || trim( wp_strip_all_tags( $body ) ) !== '' );
        $has_image = ! empty( $img['url'] );

        if ( ! $has_text && ! $has_image ) {
            continue;
        }

        $alt_bg = ( $i % 2 === 1 ) ? ' bg-secondary-subtle' : '';
        $i++;
        ?>
        <section class="custom-section<?php echo esc_attr( $alt_bg ); ?>">
          <div class="container section-padding">
            <?php if ( $layout === 'text-image' && $has_image ) : ?>
              <div class="row align-items-center">
                <div class="col-md-6">
                  <?php if ( $heading ) : ?><h2><?php echo esc_html( $heading ); ?></h2><?php endif; ?>
                  <?php echo wp_kses_post( wpautop( $body ) ); ?>
                </div>
                <div class="col-md-6 text-center">
                  <?php ${p}_img_tag( $img, 'img-fluid' ); ?>
                </div>
              </div>
            <?php elseif ( $layout === 'image' && $has_image ) : ?>
              <div class="row">
                <div class="col-12 text-center">
                  <?php if ( $heading ) : ?><h2><?php echo esc_html( $heading ); ?></h2><?php endif; ?>
                  <?php ${p}_img_tag( $img, 'img-fluid' ); ?>
                </div>
              </div>
            <?php else : ?>
              <div class="row">
                <div class="col-lg-10">
                  <?php if ( $heading ) : ?><h2><?php echo esc_html( $heading ); ?></h2><?php endif; ?>
                  <?php echo wp_kses_post( wpautop( $body ) ); ?>
                </div>
              </div>
            <?php endif; ?>
          </div>
        </section>
        <?php
    }
}


/* -------------------------------------------------------------------------
 * Main entry point
 * ---------------------------------------------------------------------- */

/**
 * The section skeleton a client-created page starts with.
 *
 * It mirrors a generated service page, so a new page gets the same shape:
 * a hero with its own four responsive images, alternating text and
 * text+images sections, and the shared contact/map block. Every field is
 * empty until the client fills it in, and empty sections are skipped when
 * rendering — so a half-filled page looks finished, not broken.
 */
function ${p}_default_section_skeleton() {
    return array(
        array(
            'key' => 'hero', 'label' => __( 'Hero', '${themeSlug}' ), 'type' => 'hero',
            // ONE hero slot, not four. WordPress generates the smaller sizes
            // on upload, so a single image still serves phones a small file.
            // Generated pages keep their four purpose-cropped roles.
            'image_roles' => array( 'hero' ),
            'p_count' => 0,
        ),
        array(
            'key' => 'section1', 'label' => __( 'Section 1', '${themeSlug}' ), 'type' => 'text',
            'css_class' => 'section-1', 'image_roles' => array(), 'p_count' => 2,
        ),
        array(
            'key' => 'section2', 'label' => __( 'Section 2', '${themeSlug}' ), 'type' => 'text-images',
            'css_class' => 'section-2', 'row_class' => 'row-first-section-2-img',
            'cta_after' => true,
            'image_roles' => array( 'section2-img1', 'section2-img2' ), 'p_count' => 2,
        ),
        array(
            'key' => 'section3', 'label' => __( 'Section 3', '${themeSlug}' ), 'type' => 'text',
            'css_class' => 'section-3', 'image_roles' => array(), 'p_count' => 2,
        ),
        array(
            'key' => 'section4', 'label' => __( 'Section 4', '${themeSlug}' ), 'type' => 'text-images',
            'css_class' => 'section-4', 'row_class' => 'row-second-section-2-img',
            'image_roles' => array( 'section4-img1', 'section4-img2' ), 'p_count' => 2,
        ),
        array(
            'key' => 'napMap', 'label' => __( 'Contact Details & Map', '${themeSlug}' ),
            'type' => 'nap-map', 'image_roles' => array(), 'p_count' => 0,
        ),
    );
}

/**
 * Descriptor list built from the skeleton, WITHOUT touching the database.
 *
 * A brand new page in WordPress is an 'auto-draft' until first saved, and
 * writing meta to those leaves orphan rows behind when WordPress garbage
 * collects them. So the editor renders from this, and only persists once the
 * page is really saved.
 */
function ${p}_skeleton_descriptors() {
    $out = array();

    foreach ( ${p}_default_section_skeleton() as $s ) {
        $d = array(
            'key'     => $s['key'],
            'label'   => $s['label'],
            'type'    => $s['type'],
            'p_count' => (int) $s['p_count'],
        );
        foreach ( array( 'css_class', 'row_class', 'image_roles', 'cta_after' ) as $extra ) {
            if ( isset( $s[ $extra ] ) ) {
                $d[ $extra ] = $s[ $extra ];
            }
        }
        $out[] = $d;
    }

    return $out;
}

/**
 * Give a page the default skeleton if it has none.
 *
 * Global values — phone, email, address, logo, hours — are not copied here.
 * They are read from Theme Settings at render time, so a new page shows the
 * same contact details as every other page automatically, and one edit
 * updates them all.
 */
function ${p}_seed_sections( $post_id ) {
    $existing = get_post_meta( $post_id, '${p}_sections', true );
    if ( is_array( $existing ) && ! empty( $existing ) ) {
        return $existing;
    }

    $skeleton = ${p}_default_section_skeleton();
    $descriptors = array();

    foreach ( $skeleton as $s ) {
        $base = '${p}_s_' . $s['key'] . '_';

        // Paragraph slots, so the editors appear
        update_post_meta( $post_id, $base . 'p_count', (int) $s['p_count'] );

        // Map embed for the contact block, inherited from the front page
        if ( $s['type'] === 'nap-map' ) {
            $front = (int) get_option( 'page_on_front' );
            $map = $front ? get_post_meta( $front, '${p}_s_napMap_map_embed', true ) : '';
            update_post_meta( $post_id, $base . 'map_embed', $map );
        }

        $d = array(
            'key'     => $s['key'],
            'label'   => $s['label'],
            'type'    => $s['type'],
            'p_count' => (int) $s['p_count'],
        );
        foreach ( array( 'css_class', 'row_class', 'image_roles', 'cta_after' ) as $extra ) {
            if ( isset( $s[ $extra ] ) ) {
                $d[ $extra ] = $s[ $extra ];
            }
        }
        $descriptors[] = $d;
    }

    update_post_meta( $post_id, '${p}_sections', $descriptors );

    return $descriptors;
}

/**
 * True when a section has nothing to show, so it can be skipped rather than
 * rendering an empty band of padding.
 */
function ${p}_section_is_empty( $post_id, $s ) {
    // Structural sections always render
    if ( in_array( $s['type'], array( 'nap-map', 'form' ), true ) ) {
        return false;
    }

    if ( $s['type'] === 'video' ) {
        return ${p}_field( $post_id, $s['key'], 'video_url' ) === '';
    }

    if ( $s['type'] === 'faq' ) {
        return empty( ${p}_faq_items( $post_id, $s['key'] ) );
    }

    if ( $s['type'] === 'pricing' ) {
        return empty( ${p}_pricing_rows( $post_id, $s['key'] ) );
    }

    if ( ${p}_field( $post_id, $s['key'], 'heading' ) !== '' ) {
        return false;
    }
    if ( ${p}_field( $post_id, $s['key'], 'subheading' ) !== '' ) {
        return false;
    }
    if ( ! empty( ${p}_paragraphs( $post_id, $s['key'] ) ) ) {
        return false;
    }

    $roles = isset( $s['image_roles'] ) && is_array( $s['image_roles'] ) ? $s['image_roles'] : array();
    foreach ( $roles as $role ) {
        $img = ${p}_image( $post_id, $s['key'], $role );
        if ( ! empty( $img['url'] ) ) {
            return false;
        }
    }

    return true;
}


/**
 * JSON-LD for a page.
 *
 * Generated pages carry schema built at generation time. A page the client
 * creates in WordPress has none, which left it with no structured data at
 * all. Rather than ask a client to write JSON-LD, build a WebPage node from
 * the values already in Theme Settings and attach the business as a linked
 * LocalBusiness, matching how the generated location pages are structured.
 */
function ${p}_get_page_schema( $post_id ) {
    $stored = get_post_meta( $post_id, '${p}_page_schema_json', true );
    if ( ! empty( $stored ) ) {
        return $stored;
    }

    $home = untrailingslashit( home_url( '/' ) );
    $url = get_permalink( $post_id );

    $title = get_post_meta( $post_id, '${p}_page_title', true );
    if ( empty( $title ) ) {
        $title = get_the_title( $post_id );
    }

    $description = get_post_meta( $post_id, '${p}_page_description', true );

    $business = array(
        '@type' => 'LocalBusiness',
        '@id'   => $home . '/#localbusiness',
        'name'  => ${p}_get_setting( 'business_name', get_bloginfo( 'name' ) ),
        'url'   => $home,
    );

    $phone = ${p}_get_setting( 'phone' );
    if ( $phone ) {
        $business['telephone'] = $phone;
    }

    $address = ${p}_get_setting( 'address' );
    if ( $address ) {
        $business['address'] = array(
            '@type'         => 'PostalAddress',
            'streetAddress' => $address,
        );
    }

    $webpage = array(
        '@type' => 'WebPage',
        '@id'   => $url . '#webpage',
        'url'   => $url,
        'name'  => $title,
        'about' => array( '@id' => $home . '/#localbusiness' ),
    );

    // Posts describe themselves as BlogPosting: it carries dates, author and
    // headline, which WebPage does not, and search engines treat it as an
    // article rather than a generic page.
    if ( 'post' === get_post_type( $post_id ) ) {
        $webpage = array(
            '@type'         => 'BlogPosting',
            '@id'           => $url . '#article',
            'mainEntityOfPage' => $url,
            'url'           => $url,
            'headline'      => $title,
            'datePublished' => get_the_date( 'c', $post_id ),
            'dateModified'  => get_the_modified_date( 'c', $post_id ),
            'author'        => array(
                '@type' => 'Organization',
                'name'  => ${p}_get_setting( 'business_name', get_bloginfo( 'name' ) ),
            ),
            'publisher'     => array( '@id' => $home . '/#localbusiness' ),
        );

        $thumb = get_the_post_thumbnail_url( $post_id, 'full' );
        if ( $thumb ) {
            $webpage['image'] = $thumb;
        }
    }

    if ( $description ) {
        $webpage['description'] = wp_strip_all_tags( $description );
    }

    return wp_json_encode( array(
        '@context' => 'https://schema.org',
        '@graph'   => array( $business, $webpage ),
    ) );
}


/* -------------------------------------------------------------------------
 * Blog listing
 * ---------------------------------------------------------------------- */

/**
 * Card grid for the blog index, archives and search results.
 *
 * The generated static site has no blog listing to mirror, so this is built
 * from Bootstrap cards — already loaded — laid out with the same container
 * and spacing as the rest of the site.
 *
 * Note the grid deliberately uses col-sm-6 / col-lg-4 rather than col-md-6:
 * the generated stylesheets style .col-md-6 img with a drop shadow and
 * rounded corners meant for section images, which would fight the card.
 */
function ${p}_render_post_grid() {
    if ( ! have_posts() ) {
        ?>
        <div class="container section-padding">
          <p><?php esc_html_e( 'No posts have been published yet.', '${themeSlug}' ); ?></p>
        </div>
        <?php
        return;
    }
    ?>
    <div class="container py-5">
      <div class="row g-4">
        <?php
        while ( have_posts() ) :
            the_post();
            $permalink = get_permalink();
            ?>
            <div class="col-sm-6 col-lg-4">
              <article <?php post_class( 'card h-100 border-0 shadow-sm' ); ?>>

                <?php if ( has_post_thumbnail() ) : ?>
                  <a href="<?php echo esc_url( $permalink ); ?>" aria-hidden="true" tabindex="-1">
                    <?php the_post_thumbnail( 'medium_large', array(
                        'class'   => 'card-img-top',
                        'loading' => 'lazy',
                        'alt'     => '',
                    ) ); ?>
                  </a>
                <?php endif; ?>

                <div class="card-body">
                  <h2 class="h5 card-title mb-2">
                    <a href="<?php echo esc_url( $permalink ); ?>" class="stretched-link text-decoration-none">
                      <?php the_title(); ?>
                    </a>
                  </h2>
                  <p class="text-muted small mb-2">
                    <time datetime="<?php echo esc_attr( get_the_date( 'c' ) ); ?>">
                      <?php echo esc_html( get_the_date() ); ?>
                    </time>
                  </p>
                  <p class="card-text">
                    <?php echo esc_html( wp_trim_words( wp_strip_all_tags( get_the_excerpt() ), 22 ) ); ?>
                  </p>
                </div>

              </article>
            </div>
            <?php
        endwhile;
        ?>
      </div>

      <?php ${p}_render_pagination(); ?>
    </div>
    <?php
}

/**
 * Pagination in Bootstrap markup.
 *
 * WordPress's own the_posts_pagination() emits .page-numbers, which Bootstrap
 * does not style, so the links would render as bare text.
 */
function ${p}_render_pagination() {
    $links = paginate_links( array(
        'type'      => 'array',
        'mid_size'  => 2,
        'prev_text' => __( '&laquo; Previous', '${themeSlug}' ),
        'next_text' => __( 'Next &raquo;', '${themeSlug}' ),
    ) );

    if ( empty( $links ) ) {
        return;
    }
    ?>
    <nav class="mt-5" aria-label="<?php esc_attr_e( 'Posts navigation', '${themeSlug}' ); ?>">
      <ul class="pagination justify-content-center">
        <?php foreach ( $links as $link ) : ?>
          <li class="page-item <?php echo strpos( $link, 'current' ) !== false ? 'active' : ''; ?>">
            <?php
            // paginate_links returns anchors; give them Bootstrap's class
            echo str_replace(
                array( 'page-numbers', '<a ', '<span ' ),
                array( 'page-link', '<a class="page-link" ', '<span class="page-link" ' ),
                $link
            );
            ?>
          </li>
        <?php endforeach; ?>
      </ul>
    </nav>
    <?php
}


/**
 * Render a page body.
 *
 * Imported pages have a section model and are rebuilt from their fields.
 * Pages created by hand in WordPress have none, so their editor content is
 * shown instead — otherwise a brand new page would render the "no content"
 * notice, which is not something a client should ever see.
 *
 * Client-added extra sections are appended in both cases.
 */
function ${p}_render_page_body( $post_id ) {
    if ( ${p}_get_sections( $post_id ) ) {
        ${p}_render_sections( $post_id );
        return;
    }

    $content = apply_filters( 'the_content', get_post_field( 'post_content', $post_id ) );

    if ( trim( wp_strip_all_tags( $content ) ) !== '' ) {
        echo '<section class="section-1"><div class="container section-padding"><div class="row"><div class="col-lg-10">';
        echo '<h1>' . esc_html( get_the_title( $post_id ) ) . '</h1>';
        echo $content;
        echo '</div></div></div></section>';
    }

    ${p}_render_custom_sections( $post_id );
}


/**
 * Ordered section descriptors for a page:
 *   array( array( 'key' => 'section1', 'label' => 'Section 1', 'type' => 'text', ... ), ... )
 */
function ${p}_get_sections( $post_id ) {
    $sections = get_post_meta( $post_id, '${p}_sections', true );
    return is_array( $sections ) ? $sections : array();
}

/**
 * Render the whole page, section by section, from meta.
 */
function ${p}_render_sections( $post_id ) {
    $sections = ${p}_get_sections( $post_id );

    if ( empty( $sections ) ) {
        // Visitors should never see a maintenance message. Only show it to
        // someone who can actually act on it.
        if ( current_user_can( 'edit_theme_options' ) ) {
            echo '<div class="container section-padding"><div class="alert alert-warning">';
            echo esc_html__( 'No content has been imported for this page yet.', '${themeSlug}' );
            echo ' <a href="' . esc_url( admin_url( 'themes.php?page=${themeSlug}-settings' ) ) . '">';
            echo esc_html__( 'Re-import content', '${themeSlug}' );
            echo '</a> ';
            echo esc_html__( '(only administrators can see this message).', '${themeSlug}' );
            echo '</div></div>';
        }
        return;
    }

    $text_index = 1;

    foreach ( $sections as $s ) {
        if ( empty( $s['type'] ) || empty( $s['key'] ) ) {
            continue;
        }

        // A seeded-but-unfilled section renders nothing rather than an
        // empty band of padding.
        if ( ${p}_section_is_empty( $post_id, $s ) ) {
            continue;
        }

        switch ( $s['type'] ) {
            case 'hero':
                ${p}_render_hero( $post_id, $s );
                // CTA directly under the hero, as in the static build
                ${p}_render_cta_button( 'first-button-container' );
                break;

            case 'text':
                ${p}_render_text( $post_id, $s, $text_index );
                $text_index++;
                break;

            case 'text-images':
                ${p}_render_text_images( $post_id, $s, $text_index );
                $text_index++;
                // Second CTA after the first image section, as in the static build
                if ( ! empty( $s['cta_after'] ) ) {
                    ${p}_render_cta_button( 'second-button-container' );
                }
                break;

            case 'video':
                ${p}_render_video( $post_id, $s );
                break;

            case 'pricing':
                ${p}_render_pricing( $post_id, $s );
                break;

            case 'faq':
                ${p}_render_faq( $post_id, $s );
                break;

            case 'form':
                ${p}_render_form( $post_id, $s );
                break;

            case 'nap-map':
                ${p}_render_nap_map( $post_id, $s );
                break;
        }
    }

    // Anything the client added goes at the end
    ${p}_render_custom_sections( $post_id );
}
`;
}

module.exports = {
  generateSectionRendererPhp,
};