// utils/wpThemeBuilder/generators/headerPhp.js
//
// Emits the SAME markup as src/template.html so the generated stylesheet
// (#headerColor, .navbar-vertical-padding, .container-nav-menu, the
// services/locations dropdown classes) applies unchanged.
//
// The old version echoed a stored header_html blob and fell back to generic
// Bootstrap markup when that was missing. The model path never stores that
// blob, so the fallback was always used and none of the theme CSS matched.
//
// The nav is rebuilt from page type (stored on each page at activation),
// mirroring utils/buildNavMenu.js:
//   - ABOUT US            -> front page
//   - first service       -> top-level link
//   - remaining services  -> SERVICES dropdown
//   - locations           -> LOCATIONS dropdown

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

function generateHeaderPhp(options = {}) {
  const {
    themeSlug = 'local-business-theme',
    themeName = 'Local Business Theme',
  } = options;

  const p = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Header Template
 *
 * Markup mirrors the generated static site so the chosen stylesheet applies.
 *
 * @package ${themeSlug}
 */
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo( 'charset' ); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">

    <?php
    // Favicon from the generated assets, unless a Site Icon is set
    if ( ! has_site_icon() ) {
        $favicon = ${p}_get_setting( 'favicon' );
        if ( $favicon ) {
            echo '<link rel="icon" href="' . esc_url( ${p}_image_url( $favicon ) ) . '">' . "\\n";
        }
    }

    // Per-page JSON-LD captured at generation time
    // Per-page JSON-LD. Generated pages carry schema from build time; pages
    // created in WordPress get one built from Theme Settings.
    $schema_json = is_singular() ? ${p}_get_page_schema( get_the_ID() ) : '';
    if ( ! empty( $schema_json ) ) {
        echo '<script type="application/ld+json">' . $schema_json . '</script>' . "\\n";
    }

    wp_head();
    ?>
</head>

<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<div id="page" class="site">
    <a class="skip-link screen-reader-text" href="#main-content">
        <?php esc_html_e( 'Skip to content', '${themeSlug}' ); ?>
    </a>

<header id="headerColor">
  <!-- Navbar -->
  <div class="container">
    <nav class="navbar navbar-expand-lg navbar-light bg-light px-3 navbar-vertical-padding">
      <a class="navbar-brand d-flex align-items-center" href="<?php echo esc_url( home_url( '/' ) ); ?>">
        <?php ${p}_the_logo(); ?>
      </a>
      <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav" aria-label="<?php esc_attr_e( 'Open mobile menu', '${themeSlug}' ); ?>">
        <span class="navbar-toggler-icon"></span>
      </button>
      <?php ${p}_the_nav_menu(); ?>
    </nav>
  </div>
</header>
`;
}


/**
 * Nav + logo helpers. Written into inc/template-nav.php so header.php stays
 * readable and the same functions can be reused by the footer.
 */
function generateNavHelpersPhp(options = {}) {
  const { themeSlug = 'local-business-theme' } = options;
  const p = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Navigation helpers
 *
 * Rebuilds the static site's nav structure from page type, which activation
 * stores on every page as ${p}_page_type.
 *
 * @package ${themeSlug}
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

/**
 * Pages of a given type, in menu order.
 */
function ${p}_pages_of_type( $type ) {
    $pages = get_posts( array(
        'post_type'      => 'page',
        'post_status'    => 'publish',
        'numberposts'    => -1,
        'orderby'        => 'menu_order',
        'order'          => 'ASC',
        'meta_key'       => '${p}_page_type',
        'meta_value'     => $type,
        'suppress_filters' => false,
    ) );

    return is_array( $pages ) ? $pages : array();
}

/**
 * Logo, honouring a Customizer custom logo when one is set.
 */
function ${p}_the_logo() {
    $name = get_bloginfo( 'name' );
    $business = ${p}_get_setting( 'business_name' );
    $alt = $business ? $business : $name;

    $width  = ${p}_get_setting( 'logo_width', 150 );
    $height = ${p}_get_setting( 'logo_height', 100 );

    if ( has_custom_logo() ) {
        $id  = get_theme_mod( 'custom_logo' );
        $url = wp_get_attachment_image_url( $id, 'full' );
        if ( $url ) {
            printf(
                '<img src="%s" alt="%s" title="%s" width="%s" height="%s" class="me-2">',
                esc_url( $url ), esc_attr( $alt ), esc_attr( $alt ),
                esc_attr( $width ), esc_attr( $height )
            );
            return;
        }
    }

    $logo = ${p}_get_setting( 'logo' );
    if ( $logo ) {
        printf(
            '<img src="%s" alt="%s" title="%s" width="%s" height="%s" class="me-2">',
            esc_url( ${p}_image_url( $logo ) ), esc_attr( $alt ), esc_attr( $alt ),
            esc_attr( $width ), esc_attr( $height )
        );
        return;
    }

    echo '<span class="site-title">' . esc_html( $alt ) . '</span>';
}

/**
 * City label for a location page, e.g. "Round Rock, TX" -> "ROUND ROCK".
 */
function ${p}_location_label( $post_id, $fallback_title ) {
    $city = get_post_meta( $post_id, '${p}_page_city', true );
    if ( ! $city ) {
        $parts = explode( ',', $fallback_title );
        $city = trim( $parts[0] );
    }
    return strtoupper( $city );
}

/**
 * Entry point used by header.php.
 *
 * If the client has built a menu and assigned it to the Primary location,
 * that wins — rendered through the Bootstrap walker so it still matches the
 * theme. Otherwise the automatic page-type nav below is used, so a freshly
 * installed site has a correct menu without anyone touching it.
 */
function ${p}_the_nav_menu() {
    if ( has_nav_menu( 'primary' ) && class_exists( '${p}_Nav_Walker' ) ) {
        echo '<div class="collapse navbar-collapse container-nav-menu" id="navbarNav">';
        wp_nav_menu( array(
            'theme_location' => 'primary',
            'container'      => false,
            'menu_class'     => 'navbar-nav ms-auto',
            'depth'          => 2,
            'walker'         => new ${p}_Nav_Walker(),
        ) );
        echo '</div>';
        return;
    }

    ${p}_the_nav_menu_auto();
}

/**
 * The automatic nav, matching the static build's structure exactly.
 */
function ${p}_the_nav_menu_auto() {
    $current  = is_singular() ? get_the_ID() : 0;
    $services = ${p}_pages_of_type( 'service' );
    $locations = ${p}_pages_of_type( 'location' );

    $is_front = is_front_page() || is_home();
    ?>
    <div class="collapse navbar-collapse container-nav-menu" id="navbarNav">
      <ul class="navbar-nav ms-auto">

        <li class="nav-item">
          <a class="nav-link <?php echo $is_front ? 'active' : ''; ?>"
             href="<?php echo esc_url( home_url( '/' ) ); ?>">
            <?php esc_html_e( 'ABOUT US', '${themeSlug}' ); ?>
          </a>
        </li>

        <?php
        // First service sits outside the dropdown, as in the static build
        if ( ! empty( $services ) ) :
            $first = array_shift( $services );
        ?>
          <li class="nav-item">
            <a class="nav-link <?php echo ( $current === $first->ID ) ? 'active' : ''; ?>"
               href="<?php echo esc_url( get_permalink( $first->ID ) ); ?>">
              <?php echo esc_html( strtoupper( $first->post_title ) ); ?>
            </a>
          </li>
        <?php endif; ?>

        <?php if ( ! empty( $services ) ) : ?>
          <li class="nav-item dropdown services-dropdown-option">
            <a class="nav-link dropdown-toggle" href="#" id="servicesDropdown" role="button"
               data-bs-toggle="dropdown" aria-expanded="false">
              <?php esc_html_e( 'SERVICES', '${themeSlug}' ); ?>
            </a>
            <ul class="dropdown-menu">
              <?php foreach ( $services as $svc ) : ?>
                <li class="nav-item">
                  <a class="dropdown-item nav-link <?php echo ( $current === $svc->ID ) ? 'active' : ''; ?>"
                     href="<?php echo esc_url( get_permalink( $svc->ID ) ); ?>">
                    <?php echo esc_html( strtoupper( $svc->post_title ) ); ?>
                  </a>
                </li>
              <?php endforeach; ?>
            </ul>
          </li>
        <?php endif; ?>

        <?php if ( ! empty( $locations ) ) : ?>
          <li class="nav-item dropdown locations-dropdown-option">
            <a class="nav-link dropdown-toggle" href="#" id="locationsDropdown" role="button"
               data-bs-toggle="dropdown" aria-expanded="false">
              <?php esc_html_e( 'LOCATIONS', '${themeSlug}' ); ?>
            </a>
            <ul class="dropdown-menu">
              <?php foreach ( $locations as $loc ) : ?>
                <li class="nav-item">
                  <a class="nav-link dropdown-item <?php echo ( $current === $loc->ID ) ? 'active' : ''; ?>"
                     href="<?php echo esc_url( get_permalink( $loc->ID ) ); ?>">
                    <?php echo esc_html( ${p}_location_label( $loc->ID, $loc->post_title ) ); ?>
                  </a>
                </li>
              <?php endforeach; ?>
            </ul>
          </li>
        <?php endif; ?>

      </ul>
    </div>
    <?php
}


/**
 * Bootstrap 5 walker.
 *
 * WordPress's default markup has none of the classes Bootstrap needs, so a
 * client-built menu would render unstyled without this. It emits:
 *
 *   top level          <li class="nav-item"><a class="nav-link">
 *   top level w/ kids  <li class="nav-item dropdown"><a class="nav-link dropdown-toggle" data-bs-toggle="dropdown">
 *   submenu            <ul class="dropdown-menu">
 *   submenu item       <li class="nav-item"><a class="dropdown-item nav-link">
 *
 * A parent titled "Services" also gets services-dropdown-option (and the same
 * for "Locations"), matching the class names in the generated stylesheet.
 */
if ( class_exists( 'Walker_Nav_Menu' ) ) :

class ${p}_Nav_Walker extends Walker_Nav_Menu {

    public function start_lvl( &$output, $depth = 0, $args = null ) {
        $output .= '<ul class="dropdown-menu">';
    }

    public function end_lvl( &$output, $depth = 0, $args = null ) {
        $output .= '</ul>';
    }

    public function start_el( &$output, $item, $depth = 0, $args = null, $id = 0 ) {
        $classes = empty( $item->classes ) ? array() : (array) $item->classes;

        $has_children = in_array( 'menu-item-has-children', $classes, true );
        $is_active = in_array( 'current-menu-item', $classes, true )
                  || in_array( 'current-menu-ancestor', $classes, true )
                  || in_array( 'current_page_item', $classes, true );

        $slug = sanitize_title( $item->title );

        // <li>
        $li = array( 'nav-item' );
        if ( 0 === $depth && $has_children ) {
            $li[] = 'dropdown';
            if ( $slug ) {
                $li[] = $slug . '-dropdown-option';
            }
        }

        // Carry through classes from the menu editor's "CSS Classes" field and
        // from plugins, so menu extensions keep working.
        //
        // Dropped:
        //   menu-item-type-*, menu-item-object-*, menu-item-<id>
        //     WordPress bookkeeping; nothing styles it, it only adds noise.
        //   menu-item-has-children
        //     the generated stylesheets give this padding-bottom: 20px above
        //     992px, which would change dropdown spacing. Bootstrap's own
        //     .dropdown class already provides the positioning it needs.
        $carried = array_filter( $classes, function ( $class ) {
            if ( ! is_string( $class ) || $class === '' ) {
                return false;
            }
            if ( $class === 'menu-item-has-children' ) {
                return false;
            }
            return ! preg_match( '/^menu-item-(type|object|[0-9])/', $class );
        } );

        $li = array_values( array_unique( array_merge( $li, $carried ) ) );

        // <a>
        $a = array();
        if ( 0 === $depth ) {
            $a[] = 'nav-link';
            if ( $has_children ) {
                $a[] = 'dropdown-toggle';
            }
        } else {
            $a[] = 'dropdown-item';
            $a[] = 'nav-link';
        }
        if ( $is_active ) {
            $a[] = 'active';
        }

        $atts = ' href="' . esc_url( $item->url ) . '"';
        if ( 0 === $depth && $has_children ) {
            $atts .= ' id="' . esc_attr( $slug . 'Dropdown' ) . '"';
            $atts .= ' role="button" data-bs-toggle="dropdown" aria-expanded="false"';
        }
        if ( ! empty( $item->target ) ) {
            $atts .= ' target="' . esc_attr( $item->target ) . '"';
        }
        if ( ! empty( $item->xfn ) ) {
            $atts .= ' rel="' . esc_attr( $item->xfn ) . '"';
        }

        $output .= '<li class="' . esc_attr( implode( ' ', $li ) ) . '">';
        $output .= '<a class="' . esc_attr( implode( ' ', $a ) ) . '"' . $atts . '>';
        $output .= esc_html( strtoupper( $item->title ) );
        $output .= '</a>';
    }

    public function end_el( &$output, $item, $depth = 0, $args = null ) {
        $output .= '</li>';
    }
}

endif;
`;
}

module.exports = {
  generateHeaderPhp,
  generateNavHelpersPhp,
};