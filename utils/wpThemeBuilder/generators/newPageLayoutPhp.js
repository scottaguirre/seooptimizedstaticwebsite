// utils/wpThemeBuilder/generators/newPageLayoutPhp.js

const { makePhpIdentifier } = require('../wpHelpers/phpHelpers');

function generateNewPageLayoutPhp(options = {}) {
  const {
    themeSlug = 'local-business-theme',
  } = options;

  const funcPrefix = makePhpIdentifier(themeSlug);

  return `<?php
/**
 * Template Name: New Page Layout
 * Description: Reusable layout for new service pages
 *
 * @package ${themeSlug}
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

get_header();
?>

<main id="main-content" class="site-main new-page-layout">

    <?php
    while ( have_posts() ) :
        the_post();

        // Get global settings
        $settings = get_option( '${funcPrefix}_global_settings', array() );
        $global_phone = isset( $settings['phone'] ) ? $settings['phone'] : '';

        // Hero section fields
        $hero_h1 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_hero_h1', true );
        $hero_h2 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_hero_h2', true );
        $hero_image = get_post_meta( get_the_ID(), '${funcPrefix}_npl_hero_image', true );
        $hero_phone = get_post_meta( get_the_ID(), '${funcPrefix}_npl_hero_phone', true );
        
        // Use page-specific phone or fall back to global
        $phone = ! empty( $hero_phone ) ? $hero_phone : $global_phone;

        // Section 1 fields
        $section1_h2 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section1_h2', true );
        $section1_h3 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section1_h3', true );
        $section1_p1 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section1_p1', true );
        $section1_p2 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section1_p2', true );

        // Section 2 fields
        $section2_h2 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section2_h2', true );
        $section2_img1 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section2_img1', true );
        $section2_img1_alt = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section2_img1_alt', true );
        $section2_img2 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section2_img2', true );
        $section2_img2_alt = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section2_img2_alt', true );
        $section2_p1 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section2_p1', true );
        $section2_p2 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section2_p2', true );

        // Section 3 fields
        $section3_h2 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section3_h2', true );
        $section3_p1 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section3_p1', true );
        $section3_p2 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section3_p2', true );

        // Section 4 fields
        $section4_h2 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section4_h2', true );
        $section4_img1 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section4_img1', true );
        $section4_img1_alt = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section4_img1_alt', true );
        $section4_img2 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section4_img2', true );
        $section4_img2_alt = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section4_img2_alt', true );
        $section4_p1 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section4_p1', true );
        $section4_p2 = get_post_meta( get_the_ID(), '${funcPrefix}_npl_section4_p2', true );
    ?>

    <!-- Hero Section -->
    <div class="container-fluid hero-container">
        <div class="row align-items-center justify-content-center">
            <div class="col-lg-6 order-lg-2 hero-img-wrap">
                <?php if ( $hero_image ) : ?>
                    <img class="hero-img img-fluid hero-img-mobile" 
                         width="600" 
                         height="350" 
                         src="<?php echo esc_url( $hero_image ); ?>" 
                         alt="<?php echo esc_attr( $hero_h1 ? $hero_h1 : get_the_title() ); ?>">
                    <img class="hero-img img-fluid hero-img-tablet" 
                         width="750" 
                         height="400" 
                         src="<?php echo esc_url( $hero_image ); ?>" 
                         alt="<?php echo esc_attr( $hero_h1 ? $hero_h1 : get_the_title() ); ?>">
                    <img class="hero-img img-fluid hero-img-desktop" 
                         width="1250" 
                         height="700" 
                         src="<?php echo esc_url( $hero_image ); ?>" 
                         alt="<?php echo esc_attr( $hero_h1 ? $hero_h1 : get_the_title() ); ?>">
                    <img class="hero-img img-fluid hero-img-large" 
                         width="1400" 
                         height="700" 
                         src="<?php echo esc_url( $hero_image ); ?>" 
                         alt="<?php echo esc_attr( $hero_h1 ? $hero_h1 : get_the_title() ); ?>">
                <?php endif; ?>
            </div>
            <div class="col-lg-6 order-lg-1 text-hero">
                <?php if ( $hero_h1 ) : ?>
                    <h1 class="display-4 text-primary"><?php echo esc_html( $hero_h1 ); ?></h1>
                <?php else : ?>
                    <h1 class="display-4 text-primary"><?php the_title(); ?></h1>
                <?php endif; ?>
                
                <div class="line-divider"></div>
                
                <?php if ( $hero_h2 ) : ?>
                    <h2 class="lead"><?php echo esc_html( $hero_h2 ); ?></h2>
                <?php endif; ?>
            </div>
        </div>
    </div>

    <!-- Duplicate hero container for responsive styles -->
    <div class="container-fluid hero-container-for-style-and-style3-992px hero-container-for-style4">
        <div class="style-4-image-wrap">
            <?php if ( $hero_image ) : ?>
                <img class="hero-img img-fluid hero-img-mobile" 
                     width="600" 
                     height="350" 
                     src="<?php echo esc_url( $hero_image ); ?>" 
                     alt="<?php echo esc_attr( $hero_h1 ? $hero_h1 : get_the_title() ); ?>">
                <img class="hero-img img-fluid hero-img-tablet" 
                     width="750" 
                     height="400" 
                     src="<?php echo esc_url( $hero_image ); ?>" 
                     alt="<?php echo esc_attr( $hero_h1 ? $hero_h1 : get_the_title() ); ?>">
                <img class="hero-img img-fluid hero-img-desktop" 
                     width="1250" 
                     height="700" 
                     src="<?php echo esc_url( $hero_image ); ?>" 
                     alt="<?php echo esc_attr( $hero_h1 ? $hero_h1 : get_the_title() ); ?>">
                <img class="hero-img img-fluid hero-img-large" 
                     width="1400" 
                     height="700" 
                     src="<?php echo esc_url( $hero_image ); ?>" 
                     alt="<?php echo esc_attr( $hero_h1 ? $hero_h1 : get_the_title() ); ?>">
            <?php endif; ?>
        </div>
        
        <div class="text-hero-for-style-and-style3 text-hero-for-style4">
            <?php if ( $hero_h1 ) : ?>
                <h1 class="display-4 text-primary"><?php echo esc_html( $hero_h1 ); ?></h1>
            <?php else : ?>
                <h1 class="display-4 text-primary"><?php the_title(); ?></h1>
            <?php endif; ?>
            <div class="line-divider"></div>
            <?php if ( $hero_h2 ) : ?>
                <h2 class="lead"><?php echo esc_html( $hero_h2 ); ?></h2>
            <?php endif; ?>
        </div>
    </div>

    <!-- Phone Button (First) -->
    <?php if ( $phone ) : ?>
        <div class="text-center btn-container first-button-container">
            <div class="cta-btn">
                <a href="tel:<?php echo esc_attr( preg_replace( '/[^0-9+]/', '', $phone ) ); ?>">
                    <p><?php echo esc_html( preg_replace( '/[^0-9]/', '', $phone ) ); ?></p>
                </a>
            </div>
        </div>
    <?php endif; ?>

    <!-- Section 1: Text Content -->
    <?php if ( $section1_h2 || $section1_h3 || $section1_p1 || $section1_p2 ) : ?>
        <section class="section-1">
            <div class="container section-padding">
                <div class="row">
                    <div class="col-lg-10">
                        <?php if ( $section1_h2 ) : ?>
                            <h2><?php echo esc_html( $section1_h2 ); ?></h2>
                        <?php endif; ?>
                        
                        <?php if ( $section1_h3 ) : ?>
                            <h3><?php echo esc_html( $section1_h3 ); ?></h3>
                        <?php endif; ?>
                        
                        <?php if ( $section1_p1 ) : ?>
                            <p><?php echo wp_kses_post( nl2br( $section1_p1 ) ); ?></p>
                        <?php endif; ?>
                        
                        <?php if ( $section1_p2 ) : ?>
                            <p><?php echo wp_kses_post( nl2br( $section1_p2 ) ); ?></p>
                        <?php endif; ?>
                    </div>
                </div>
            </div>
        </section>
    <?php endif; ?>

    <!-- Section 2: Two Images + Text -->
    <?php if ( $section2_h2 || $section2_img1 || $section2_img2 || $section2_p1 || $section2_p2 ) : ?>
        <section class="bg-secondary-subtle text-two-images-section section-2">
            <div class="container section-padding">
                <?php if ( $section2_img1 || $section2_img2 ) : ?>
                    <div class="row row-first-section-2-img">
                        <?php if ( $section2_img1 ) : ?>
                            <div class="col-md-6 text-center img-1-div">
                                <img class="img-fluid" 
                                     loading="lazy" 
                                     src="<?php echo esc_url( $section2_img1 ); ?>" 
                                     width="600" 
                                     height="400" 
                                     alt="<?php echo esc_attr( $section2_img1_alt ); ?>">
                            </div>
                        <?php endif; ?>
                        
                        <?php if ( $section2_img2 ) : ?>
                            <div class="col-md-6 text-center img-2-div">
                                <img class="img-fluid" 
                                     loading="lazy" 
                                     src="<?php echo esc_url( $section2_img2 ); ?>" 
                                     width="600" 
                                     height="400" 
                                     alt="<?php echo esc_attr( $section2_img2_alt ); ?>">
                            </div>
                        <?php endif; ?>
                    </div>
                <?php endif; ?>
                
                <div class="row">
                    <div class="col-lg-10">
                        <?php if ( $section2_h2 ) : ?>
                            <h2><?php echo esc_html( $section2_h2 ); ?></h2>
                        <?php endif; ?>
                        
                        <?php if ( $section2_p1 ) : ?>
                            <p><?php echo wp_kses_post( nl2br( $section2_p1 ) ); ?></p>
                        <?php endif; ?>
                        
                        <?php if ( $section2_p2 ) : ?>
                            <p><?php echo wp_kses_post( nl2br( $section2_p2 ) ); ?></p>
                        <?php endif; ?>
                    </div>
                </div>
            </div>
        </section>
    <?php endif; ?>

    <!-- Phone Button (Second) -->
    <?php if ( $phone ) : ?>
        <div class="text-center btn-container second-button-container">
            <div class="cta-btn">
                <a href="tel:<?php echo esc_attr( preg_replace( '/[^0-9+]/', '', $phone ) ); ?>">
                    <p><?php echo esc_html( preg_replace( '/[^0-9]/', '', $phone ) ); ?></p>
                </a>
            </div>
        </div>
    <?php endif; ?>

    <!-- Section 3: Text Content -->
    <?php if ( $section3_h2 || $section3_p1 || $section3_p2 ) : ?>
        <section class="section-3">
            <div class="container section-padding">
                <div class="row">
                    <div class="col-lg-10 div-text-padding-bottom">
                        <?php if ( $section3_h2 ) : ?>
                            <h2><?php echo esc_html( $section3_h2 ); ?></h2>
                        <?php endif; ?>
                        
                        <?php if ( $section3_p1 ) : ?>
                            <p><?php echo wp_kses_post( nl2br( $section3_p1 ) ); ?></p>
                        <?php endif; ?>
                        
                        <?php if ( $section3_p2 ) : ?>
                            <p><?php echo wp_kses_post( nl2br( $section3_p2 ) ); ?></p>
                        <?php endif; ?>
                    </div>
                </div>
            </div>
        </section>
    <?php endif; ?>

    <!-- Section 4: Two Images + Text -->
    <?php if ( $section4_h2 || $section4_img1 || $section4_img2 || $section4_p1 || $section4_p2 ) : ?>
        <section class="bg-secondary-subtle text-two-images-section section-4">
            <div class="container section-padding">
                <?php if ( $section4_img1 || $section4_img2 ) : ?>
                    <div class="row row-second-section-2-img">
                        <?php if ( $section4_img1 ) : ?>
                            <div class="col-md-6 text-center img-1-div">
                                <img class="img-fluid" 
                                     loading="lazy" 
                                     src="<?php echo esc_url( $section4_img1 ); ?>" 
                                     width="600" 
                                     height="400" 
                                     alt="<?php echo esc_attr( $section4_img1_alt ); ?>">
                            </div>
                        <?php endif; ?>
                        
                        <?php if ( $section4_img2 ) : ?>
                            <div class="col-md-6 text-center img-2-div">
                                <img class="img-fluid" 
                                     loading="lazy" 
                                     src="<?php echo esc_url( $section4_img2 ); ?>" 
                                     width="600" 
                                     height="400" 
                                     alt="<?php echo esc_attr( $section4_img2_alt ); ?>">
                            </div>
                        <?php endif; ?>
                    </div>
                <?php endif; ?>
                
                <div class="row">
                    <div class="col-lg-10">
                        <?php if ( $section4_h2 ) : ?>
                            <h2><?php echo esc_html( $section4_h2 ); ?></h2>
                        <?php endif; ?>
                        
                        <?php if ( $section4_p1 ) : ?>
                            <p><?php echo wp_kses_post( nl2br( $section4_p1 ) ); ?></p>
                        <?php endif; ?>
                        
                        <?php if ( $section4_p2 ) : ?>
                            <p><?php echo wp_kses_post( nl2br( $section4_p2 ) ); ?></p>
                        <?php endif; ?>
                    </div>
                </div>
            </div>
        </section>
    <?php endif; ?>

    <?php endwhile; ?>

</main>

<?php
get_footer();
`;
}

module.exports = {
  generateNewPageLayoutPhp,
};