// utils/wpThemeBuilder/generators/headerPhp.js

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

function generateHeaderPhp(options = {}) {
  const {
    themeSlug = 'local-business-theme',
    themeName = 'Local Business Theme',
  } = options;

  const funcPrefix = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Header Template
 * 
 * Outputs the stored header HTML from the database
 *
 * @package ${themeSlug}
 */
?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
    <meta charset="<?php bloginfo( 'charset' ); ?>">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <link rel="profile" href="https://gmpg.org/xfn/11">

    <?php
    // Custom meta description from page field or global
    if ( is_singular() ) {
        $meta_desc = get_page_field( 'meta_description' );
        if ( $meta_desc ) {
            echo '<meta name="description" content="' . esc_attr( $meta_desc ) . '">' . "\\n";
        }
    }
    ?>

    <?php wp_head(); ?>
</head>

<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<div id="page" class="site">
    <a class="skip-link screen-reader-text" href="#main-content">
        <?php esc_html_e( 'Skip to content', '${themeSlug}' ); ?>
    </a>

    <?php
    // Output the stored header HTML from the page meta
    $header_html = '';
    
    // Try to get from current page first
    if ( is_singular() ) {
        $header_html = get_post_meta( get_the_ID(), '${funcPrefix}_header_html', true );
    }
    
    // Fallback: get from front page
    if ( empty( $header_html ) ) {
        $front_page_id = get_option( 'page_on_front' );
        if ( $front_page_id ) {
            $header_html = get_post_meta( $front_page_id, '${funcPrefix}_header_html', true );
        }
    }
    
    // Output the stored header HTML
    if ( ! empty( $header_html ) ) {
        echo $header_html;
    } else {
        // Fallback header if no stored HTML exists
        ?>
        <header id="masthead" class="site-header">
            <nav class="navbar navbar-expand-lg">
                <div class="container">
                    <a class="navbar-brand" href="<?php echo esc_url( home_url( '/' ) ); ?>" rel="home">
                        <?php
                        $custom_logo_id = get_theme_mod( 'custom_logo' );
                        if ( $custom_logo_id ) {
                            echo wp_get_attachment_image( $custom_logo_id, 'full', false, array(
                                'class' => 'custom-logo',
                                'alt'   => get_bloginfo( 'name' ),
                            ) );
                        } else {
                            $logo_path = get_template_directory() . '/assets/';
                            $logo_url = '';
                            
                            $logo_files = glob( $logo_path . '*logo*' );
                            if ( ! empty( $logo_files ) ) {
                                $logo_file = basename( $logo_files[0] );
                                $logo_url = get_template_directory_uri() . '/assets/' . $logo_file;
                            }

                            if ( $logo_url ) {
                                echo '<img src="' . esc_url( $logo_url ) . '" alt="' . esc_attr( get_bloginfo( 'name' ) ) . '" class="site-logo">';
                            } else {
                                echo '<span class="site-title">' . esc_html( get_bloginfo( 'name' ) ) . '</span>';
                            }
                        }
                        ?>
                    </a>

                    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#primary-navigation" aria-controls="primary-navigation" aria-expanded="false" aria-label="<?php esc_attr_e( 'Toggle navigation', '${themeSlug}' ); ?>">
                        <span class="navbar-toggler-icon"></span>
                    </button>

                    <div class="collapse navbar-collapse" id="primary-navigation">
                        <?php
                        wp_nav_menu( array(
                            'theme_location' => 'primary',
                            'container'      => false,
                            'menu_class'     => 'navbar-nav ms-auto',
                            'fallback_cb'    => '${funcPrefix}_fallback_menu',
                            'depth'          => 2,
                        ) );
                        ?>

                        <?php
                        $phone = get_global_setting( 'phone' );
                        if ( $phone ) :
                        ?>
                            <a href="tel:<?php echo esc_attr( get_phone_href() ); ?>" class="btn btn-primary ms-lg-3 header-cta">
                                <span class="phone-icon">&#9742;</span>
                                <?php echo esc_html( $phone ); ?>
                            </a>
                        <?php endif; ?>
                    </div>
                </div>
            </nav>
        </header>
        <?php
    }
    ?>

<?php
function ${funcPrefix}_fallback_menu() {
    echo '<ul class="navbar-nav ms-auto">';
    echo '<li class="nav-item"><a class="nav-link" href="' . esc_url( home_url( '/' ) ) . '">' . esc_html__( 'Home', '${themeSlug}' ) . '</a></li>';
    
    $pages = get_pages( array(
        'sort_column' => 'menu_order',
        'number'      => 5,
    ) );

    foreach ( $pages as $page ) {
        if ( $page->ID === (int) get_option( 'page_on_front' ) ) {
            continue;
        }
        echo '<li class="nav-item"><a class="nav-link" href="' . esc_url( get_permalink( $page->ID ) ) . '">' . esc_html( $page->post_title ) . '</a></li>';
    }

    echo '</ul>';
}
`;
}

module.exports = {
  generateHeaderPhp,
};