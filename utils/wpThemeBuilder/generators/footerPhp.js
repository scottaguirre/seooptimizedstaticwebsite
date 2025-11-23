// utils/wpThemeBuilder/generators/footerPhp.js

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

function generateFooterPhp(options = {}) {
  const {
    themeSlug = 'local-business-theme',
  } = options;

  const funcPrefix = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Footer Template
 * 
 * Outputs the stored footer HTML from the database
 *
 * @package ${themeSlug}
 */
?>

    <?php
    // Output the stored footer HTML from the page meta
    $footer_html = '';
    
    // Try to get from current page first
    if ( is_singular() ) {
        $footer_html = get_post_meta( get_the_ID(), '${funcPrefix}_footer_html', true );
    }
    
    // Fallback: get from front page
    if ( empty( $footer_html ) ) {
        $front_page_id = get_option( 'page_on_front' );
        if ( $front_page_id ) {
            $footer_html = get_post_meta( $front_page_id, '${funcPrefix}_footer_html', true );
        }
    }
    
    // Output the stored footer HTML
    if ( ! empty( $footer_html ) ) {
        echo $footer_html;
    } else {
        // Fallback footer if no stored HTML exists
        ?>
        <footer id="colophon" class="site-footer">
            
            <?php if ( is_active_sidebar( 'footer-1' ) ) : ?>
            <div class="footer-widgets">
                <div class="container">
                    <div class="row">
                        <?php dynamic_sidebar( 'footer-1' ); ?>
                    </div>
                </div>
            </div>
            <?php endif; ?>

            <div class="footer-main">
                <div class="container">
                    <div class="row">
                        
                        <div class="col-lg-4 col-md-6 mb-4 mb-lg-0">
                            <div class="footer-brand">
                                <?php
                                $business_name = get_global_setting( 'business_name' );
                                if ( $business_name ) :
                                ?>
                                    <h4 class="footer-title"><?php echo esc_html( $business_name ); ?></h4>
                                <?php else : ?>
                                    <h4 class="footer-title"><?php bloginfo( 'name' ); ?></h4>
                                <?php endif; ?>

                                <?php
                                $business_type = get_global_setting( 'business_type' );
                                $location = get_global_setting( 'location' );
                                if ( $business_type || $location ) :
                                ?>
                                    <p class="footer-tagline">
                                        <?php
                                        if ( $business_type ) {
                                            echo esc_html( $business_type );
                                        }
                                        if ( $business_type && $location ) {
                                            echo ' in ';
                                        }
                                        if ( $location ) {
                                            echo esc_html( $location );
                                        }
                                        ?>
                                    </p>
                                <?php endif; ?>
                            </div>
                        </div>

                        <div class="col-lg-4 col-md-6 mb-4 mb-lg-0">
                            <?php
                            $phone = get_global_setting( 'phone' );
                            $email = get_global_setting( 'email' );
                            $address = get_global_setting( 'address' );

                            if ( $phone || $email || $address ) :
                            ?>
                            <div class="footer-contact">
                                <h4 class="footer-title"><?php esc_html_e( 'Contact Us', '${themeSlug}' ); ?></h4>
                                
                                <?php if ( $phone ) : ?>
                                    <p class="contact-phone">
                                        <span class="contact-icon">&#9742;</span>
                                        <a href="tel:<?php echo esc_attr( get_phone_href() ); ?>">
                                            <?php echo esc_html( $phone ); ?>
                                        </a>
                                    </p>
                                <?php endif; ?>

                                <?php if ( $email ) : ?>
                                    <p class="contact-email">
                                        <span class="contact-icon">&#9993;</span>
                                        <a href="mailto:<?php echo esc_attr( $email ); ?>">
                                            <?php echo esc_html( $email ); ?>
                                        </a>
                                    </p>
                                <?php endif; ?>

                                <?php if ( $address ) : ?>
                                    <p class="contact-address">
                                        <span class="contact-icon">&#9679;</span>
                                        <?php echo esc_html( $address ); ?>
                                    </p>
                                <?php endif; ?>
                            </div>
                            <?php endif; ?>
                        </div>

                        <div class="col-lg-4 col-md-12">
                            <?php if ( has_social_links() ) : ?>
                            <div class="footer-social">
                                <h4 class="footer-title"><?php esc_html_e( 'Follow Us', '${themeSlug}' ); ?></h4>
                                
                                <div class="social-links">
                                    <?php
                                    $socials = get_social_links();
                                    foreach ( $socials as $platform => $url ) :
                                    ?>
                                        <a href="<?php echo esc_url( $url ); ?>" 
                                           target="_blank" 
                                           rel="noopener noreferrer" 
                                           class="social-link social-<?php echo esc_attr( $platform ); ?>"
                                           aria-label="<?php echo esc_attr( sprintf( __( 'Visit our %s page', '${themeSlug}' ), ucfirst( $platform ) ) ); ?>">
                                            <span class="social-name"><?php echo esc_html( ucfirst( $platform ) ); ?></span>
                                        </a>
                                    <?php endforeach; ?>
                                </div>
                            </div>
                            <?php endif; ?>
                        </div>

                    </div>
                </div>
            </div>

            <div class="footer-bottom">
                <div class="container">
                    <div class="row align-items-center">
                        
                        <div class="col-md-6 text-center text-md-start">
                            <p class="copyright">
                                &copy; <?php echo esc_html( date( 'Y' ) ); ?>
                                <?php
                                $business_name = get_global_setting( 'business_name' );
                                if ( $business_name ) {
                                    echo esc_html( $business_name );
                                } else {
                                    bloginfo( 'name' );
                                }
                                ?>.
                                <?php esc_html_e( 'All rights reserved.', '${themeSlug}' ); ?>
                            </p>
                        </div>

                        <div class="col-md-6 text-center text-md-end">
                            <nav class="footer-legal-nav">
                                <?php
                                $legal_pages = array(
                                    'privacy-policy' => __( 'Privacy Policy', '${themeSlug}' ),
                                    'terms-of-use'   => __( 'Terms of Use', '${themeSlug}' ),
                                    'accessibility'  => __( 'Accessibility', '${themeSlug}' ),
                                );

                                $legal_links = array();

                                foreach ( $legal_pages as $slug => $title ) {
                                    $page = get_page_by_path( $slug );
                                    if ( $page ) {
                                        $legal_links[] = '<a href="' . esc_url( get_permalink( $page->ID ) ) . '">' . esc_html( $title ) . '</a>';
                                    }
                                }

                                if ( ! empty( $legal_links ) ) {
                                    echo implode( ' <span class="separator">|</span> ', $legal_links );
                                }
                                ?>
                            </nav>
                        </div>

                    </div>
                </div>
            </div>

        </footer><!-- #colophon -->
        <?php
    }
    ?>

</div><!-- #page -->

<?php wp_footer(); ?>

</body>
</html>
`;
}

module.exports = {
  generateFooterPhp,
};