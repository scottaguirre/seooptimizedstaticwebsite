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
 * Replaces static navigation with WordPress dynamic menu
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
    // Output custom title from post meta or fallback to WordPress default
    $custom_title = get_post_meta( get_the_ID(), '${funcPrefix}_page_title', true );
    if ( $custom_title ) :
    ?>
    <title><?php echo esc_html( $custom_title ); ?></title>
    <?php else : ?>
    <title><?php wp_title( '|', true, 'right' ); ?><?php bloginfo( 'name' ); ?></title>
    <?php endif; ?>

    <?php
    // Output custom meta description
    $custom_description = get_post_meta( get_the_ID(), '${funcPrefix}_page_description', true );
    if ( $custom_description ) :
    ?>
    <meta name="description" content="<?php echo esc_attr( $custom_description ); ?>">
    <?php endif; ?>

    <?php
    // Output custom meta author
    $custom_author = get_post_meta( get_the_ID(), '${funcPrefix}_page_author', true );
    if ( $custom_author ) :
    ?>
    <meta name="author" content="<?php echo esc_attr( $custom_author ); ?>">
    <?php endif; ?>

    <?php
    // Output custom favicon
    $custom_favicon = get_post_meta( get_the_ID(), '${funcPrefix}_page_favicon', true );
    if ( $custom_favicon ) :
        $favicon_url = get_template_directory_uri() . '/assets/' . $custom_favicon;
    ?>
    <link rel="icon" href="<?php echo esc_url( $favicon_url ); ?>" type="image/x-icon" />
    <?php endif; ?>

    <?php
    // Output JSON-LD Schema
    $schema_json = get_post_meta( get_the_ID(), '${funcPrefix}_page_schema_json', true );
    if ( $schema_json ) :
    ?>
    <script type="application/ld+json">
    <?php echo $schema_json; ?>
    </script>
    <?php endif; ?>

    <?php wp_head(); ?>
</head>

<body <?php body_class(); ?>>
<?php wp_body_open(); ?>

<div id="page" class="site">
    <a class="skip-link screen-reader-text" href="#main-content">
        <?php esc_html_e( 'Skip to content', '${themeSlug}' ); ?>
    </a>

    <?php
    // Get the stored header HTML
    $header_html = '';
    
    if ( is_singular() ) {
        $header_html = get_post_meta( get_the_ID(), '${funcPrefix}_header_html', true );
    }
    
    if ( empty( $header_html ) ) {
        $front_page_id = get_option( 'page_on_front' );
        if ( $front_page_id ) {
            $header_html = get_post_meta( $front_page_id, '${funcPrefix}_header_html', true );
        }
    }
    
    if ( ! empty( $header_html ) ) {
        // CRITICAL: Replace static navigation with WordPress dynamic menu
        
        // Find the nav element and replace it with WordPress menu
        $nav_pattern = '/<nav[^>]*>.*?<\\/nav>/is';
        
        if ( preg_match( $nav_pattern, $header_html, $matches ) ) {
            $original_nav = $matches[0];
            
            // Extract logo from original nav for reuse
            $logo_html = '';
            $logo_pattern = '/<img[^>]*(?:class="[^"]*"[^>]*|[^>]*)>/i';
            if ( preg_match( $logo_pattern, $original_nav, $logo_match ) ) {
                $logo_html = $logo_match[0];
                // Fix logo src path
                $template_uri = get_template_directory_uri();
                // Extract logo from original nav for reuse
                
                $logo_html = '';
                $logo_pattern = '/<img[^>]*(?:class="[^"]*"[^>]*|[^>]*)>/i';
                if ( preg_match( $logo_pattern, $original_nav, $logo_match ) ) {
                    $logo_html = $logo_match[0];
                    // Only fix relative paths, not absolute URLs
                    $template_uri = get_template_directory_uri();
                    $logo_html = preg_replace(
                        '/src=(["\\'])(?!https?:\\/\\/)(?:(?:\\.\\/)?assets\\/)?([^"\\']+)\\1/i',
                        'src=$1' . $template_uri . '/assets/$2$1',
                        $logo_html
                    );
                }
            }
            
            // Build WordPress menu with same structure
            ob_start();
            ?>
            <nav class="navbar navbar-expand-lg navbar-light bg-light px-3 navbar-vertical-padding">
                <div class="container">
                    <a class="navbar-brand d-flex align-items-center" href="<?php echo esc_url( home_url( '/' ) ); ?>">
                        <?php ${funcPrefix}_display_logo(); ?>
                    </a>

                    <button class="navbar-toggler" type="button" data-bs-toggle="collapse" data-bs-target="#navbarNav" aria-controls="navbarNav" aria-expanded="false" aria-label="<?php esc_attr_e( 'Toggle navigation', '${themeSlug}' ); ?>">
                        <span class="navbar-toggler-icon"></span>
                    </button>

                    <div class="collapse navbar-collapse container-nav-menu" id="navbarNav">
                        <?php
                        // Output WordPress dynamic menu
                        wp_nav_menu( array(
                            'theme_location' => 'primary',
                            'container'      => false,
                            'menu_class'     => 'navbar-nav ms-auto',
                            'fallback_cb'    => '${funcPrefix}_fallback_menu',
                            'depth'          => 2,
                        ) );
                        ?>
                    </div>
                </div>
            </nav>
            <?php
            $wordpress_nav = ob_get_clean();
            
            // Replace static nav with WordPress nav
            $header_html = str_replace( $original_nav, $wordpress_nav, $header_html );
        }
        
        echo $header_html;
    } else {
        // Fallback header if no stored HTML exists
        ?>
        <header id="masthead" class="site-header">
            <nav class="navbar navbar-expand-lg navbar-light bg-light px-3 navbar-vertical-padding">
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
                        $settings = get_option( '${funcPrefix}_global_settings', array() );
                        $phone = isset( $settings['phone'] ) ? $settings['phone'] : '';
                        if ( $phone ) :
                        ?>
                            <a href="tel:<?php echo esc_attr( str_replace( array( ' ', '-', '(', ')' ), '', $phone ) ); ?>" class="btn btn-primary ms-lg-3 header-cta">
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